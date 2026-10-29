import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { WorkConversation, WorkReasoningBudget } from "../deploy/cloudflare/conversation_state.js";
import { hash } from "../deploy/cloudflare/conversation.js";
import { freshHealth, admitHealth, settleHealth, retryGuidance } from "../deploy/cloudflare/provider_health.js";
import worker from "../deploy/cloudflare/worker.js";
import { resolveUpstream } from "../deploy/cloudflare/herma_engine.js";

const entry = { entry_id: "work.observation", kind: "noun", title: "Observation", summary: "SYNTHETIC", schema_or_body: { work_contract: {
  operation_id: "record_observation", category_id: "noun.eval_run", description: "Record SYNTHETIC evidence.", input_schema: { type: "object", properties: { value: { type: "object", properties: { message: { type: "string" }, synthetic: { type: "boolean", const: true } }, required: ["message", "synthetic"], additionalProperties: false } }, required: ["value"], additionalProperties: false }
} } };
const input = patch => ({ conversation_id: "conversation-one", request_id: "request-one", expected_version: 0, provider: "openai", message: "SYNTHETIC", context_refs: [entry.entry_id], ...patch });
// Pooled callers each hold their own exact operator grant from the vitest configuration.
let pooled = 0;
const caller = () => { const id = `key:synthetic-health-${pooled++}`; return { id, stub: env.WORK_CONVERSATIONS.getByName(id) }; };
const freshBudget = () => env.WORK_REASONING_BUDGET.getByName("health-" + crypto.randomUUID());
const outcome = patch => ({ outcome: "rejected", error_code: "provider_rate_limited", reason: "rate_limited", retry_after_seconds: null, http_status: 429, ...patch });
async function clearTime(stub, mutate = state => { state.available_after = 0; }) {
  await runInDurableObject(stub, (_instance, state) => {
    for (const row of state.storage.sql.exec("SELECT * FROM provider_health").toArray()) {
      const value = JSON.parse(row.state); mutate(value);
      state.storage.sql.exec("UPDATE provider_health SET state=? WHERE account=? AND provider=? AND model=?", JSON.stringify(value), row.account, row.provider, row.model);
    }
  });
}

describe("shared operator provider availability", () => {
  beforeEach(async () => {
    await runInDurableObject(env.WORK_REASONING_BUDGET.getByName("provider-allowance-v1"), (_instance, state) => state.storage.sql.exec("DELETE FROM provider_health"));
  });
  it("blocks another caller after credit exhaustion without another reservation or request", async () => {
    const a = caller(), b = caller();
    const first = await a.stub.turn(a.id, input({ message: "diagnostic-credit" }), [entry]);
    expect(first.body.attempts[0].provider_health.reason).toBe("credit_or_quota_exhausted");
    const second = await b.stub.turn(b.id, input(), [entry]);
    expect(second.body.error_code).toBe("provider_backpressure");
    expect(second.body.reserved_tokens).toBe(0);
    expect(second.body.server_exception.actions.some(action => action.action === "provider_request")).toBe(false);
    expect(second.body.attempts[0].usage).toEqual({ input_tokens: null, output_tokens: null });
    expect((await a.stub.snapshot(b.id, "conversation-one")).status).toBe(403);
    const unrelated = caller();
    expect((await unrelated.stub.turn(unrelated.id, input({ provider: "meta" }), [entry])).body.proposal.status).toBe("ready");
  });

  it.each([["diagnostic-payment", "payment_required"], ["diagnostic-timeout", "provider_unavailable"]])("limits %s even when the body is unrecognized", async (message, reason) => {
    const a = caller(), b = caller();
    const first = await a.stub.turn(a.id, input({ message }), [entry]);
    expect(first.body.attempts[0].provider_diagnostics.reason).toBe("unknown");
    expect(first.body.attempts[0].provider_health.reason).toBe(reason);
    expect((await b.stub.turn(b.id, input(), [entry])).body.error_code).toBe("provider_backpressure");
  });

  it("does not treat request/model incompatibility as a shared credit or rate limit", async () => {
    const a = caller(), b = caller();
    expect((await a.stub.turn(a.id, input({ message: "diagnostic-model" }), [entry])).body.error_code).toBe("provider_rejected");
    expect((await b.stub.turn(b.id, input(), [entry])).body.proposal.status).toBe("ready");
  });

  it("operator disable overrides recovery while leaving keys and health state intact", async () => {
    const target = caller();
    await runInDurableObject(target.stub, async (_instance, state) => {
      const configured = { ...env, HERMA_CONVERSATION_DISABLED_PROVIDERS: '["anthropic","openrouter"]', WORK_REASONING_BUDGET: { getByName() { throw new Error("disabled provider reached coordinator"); } } };
      const instance = new WorkConversation(state, configured);
      const result = await instance.turn(target.id, input({ provider: "anthropic" }), [entry]);
      expect(result.body.error_code).toBe("provider_operator_disabled");
      expect(result.body.attempts[0]).toMatchObject({ outcome: "not_sent", reservation_status: "not_reserved", provider_health: { state: "operator_disabled", available_after: null } });
      expect(configured.ANTHROPIC_API_KEY).toBe("synthetic-anthropic-key");
    });
    const budget = freshBudget(), id = await hash("credit");
    await budget.reserve(id, "meta", id, 1);
    await budget.recordOutcome(id, "meta", id, outcome({ error_code: "provider_rejected", reason: "credit_or_quota_exhausted", http_status: 400 }));
    await runInDurableObject(budget, (instance, state) => {
      const paused = new WorkReasoningBudget(state, { ...env, HERMA_CONVERSATION_DISABLED_PROVIDERS: '["meta"]' });
      expect(paused.reserve("a".repeat(64), "meta", "a".repeat(64), 1, { allow_probe: true }).code).toBe("provider_operator_disabled");
      expect(instance.reserve("b".repeat(64), "meta", "b".repeat(64), 1, { allow_probe: true }).code).toBe("provider_backpressure");
      expect(instance.summary().reservations[0].reserved_microusd).toBe(1);
    });
  });

  it.each([["anthropic", "https://api.anthropic.com/v1/messages", "/v1/messages"], ["openrouter", "https://openrouter.ai/api/v1/chat/completions", "/v1/chat/completions"]])("pauses the %s operator proxy key while preserving actual worker-funded forwarding", async (provider, upstream, path) => {
    const settings = { ...env, HERMA_CONVERSATION_DISABLED_PROVIDERS: '["anthropic","openrouter"]', UPSTREAM_LLM_URL: upstream, UPSTREAM_LLM_API_KEY: "synthetic-operator-key" };
    const issue = await worker.fetch(new Request("https://example.com/v1/admin/keys", { method: "POST", headers: { "Content-Type": "application/json", "X-Bootstrap-Secret": "synthetic-bootstrap-value" }, body: JSON.stringify({ label: "SYNTHETIC BYO", harness_kind: "opencode", scopes: ["route"] }) }), settings);
    expect(issue.status).toBe(201);
    const issued = await issue.json();
    const payload = { model: "synthetic-byo-model", max_tokens: 300000, messages: [{ role: "user", content: "byo-paused-provider" }] };
    const headers = { "Content-Type": "application/json", "Authorization": "Bearer " + issued.key, "X-Herma-Harness": "opencode", "anthropic-version": "2023-06-01" };
    const denied = await worker.fetch(new Request("https://example.com" + path, { method: "POST", headers, body: JSON.stringify(payload) }), settings);
    expect(denied.status).toBe(503);
    expect((await denied.json()).code).toBe("provider_operator_disabled");
    const response = await worker.fetch(new Request("https://example.com" + path, { method: "POST", headers: { ...headers, "X-Upstream-Api-Key": `synthetic-byo-${provider}-key` }, body: JSON.stringify(payload) }), settings);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ model: "synthetic-byo-model", observed_max_tokens: 300000, synthetic_byo: true });
  });

  it("does not parse operator policy for a selected caller key or use substring host matching", () => {
    const settings = { HERMA_CONVERSATION_DISABLED_PROVIDERS: "invalid operator policy", UPSTREAM_LLM_URL: "https://api.anthropic.com/v1/messages", UPSTREAM_LLM_API_KEY: "synthetic-operator-key" };
    const own = new Request("https://example.com/v1/messages", { headers: { "X-Upstream-Api-Key": "synthetic-worker-key" } });
    expect(resolveUpstream(own, settings, "/v1/messages").key).toBe("synthetic-worker-key");
    const alternate = { ...settings, HERMA_CONVERSATION_DISABLED_PROVIDERS: '["anthropic"]', UPSTREAM_LLM_URL: "https://api.anthropic.com.synthetic.example/v1/messages" };
    expect(resolveUpstream(new Request("https://example.com"), alternate, "/v1/messages").key).toBe("synthetic-operator-key");
    expect(() => resolveUpstream(new Request("https://example.com", { headers: { "X-Upstream-Base-Url": "https://api.anthropic.com" } }), alternate, "/v1/messages")).toThrow("Server credentials are bound");
  });

  it("admits exactly one account-wide probe across concurrent models and accounts remain isolated", async () => {
    const budget = freshBudget(), id = await hash("account-credit");
    await budget.reserve(id, "meta", id, 1);
    await budget.recordOutcome(id, "meta", id, outcome({ error_code: "provider_rejected", reason: "credit_or_quota_exhausted", http_status: 400 }));
    await clearTime(budget);
    const ids = await Promise.all(Array.from({ length: 20 }, (_, i) => hash({ probe: i })));
    const results = await Promise.all(ids.map(id => budget.reserve(id, "meta", id, 1, { allow_probe: true })));
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.filter(result => result.code === "provider_recovery_probe_inflight")).toHaveLength(19);
    await runInDurableObject(budget, (_instance, state) => {
      const alternateModel = new WorkReasoningBudget(state, { ...env, HERMA_CONVERSATION_META_MODEL: "muse-wonder-1.0" });
      expect(alternateModel.reserve("c".repeat(64), "meta", "c".repeat(64), 1, { allow_probe: true }).code).toBe("provider_recovery_probe_inflight");
      const independentAccount = new WorkReasoningBudget(state, { ...env, HERMA_CONVERSATION_META_ACCOUNT_SCOPE: "separate-authorized-account" });
      expect(independentAccount.reserve("d".repeat(64), "meta", "d".repeat(64), 1).ok).toBe(true);
    });
  });

  it("persists probe expiration on a denied request and keeps allowance plus unknown-outcome gating", async () => {
    const budget = freshBudget(), id = await hash("limited"), probe = await hash("lost-probe");
    await budget.reserve(id, "meta", id, 1);
    await budget.recordOutcome(id, "meta", id, outcome());
    await clearTime(budget);
    expect((await budget.reserve(probe, "meta", probe, 1, { allow_probe: true })).ok).toBe(true);
    await clearTime(budget, state => { state.probe_until = 1; });
    const denied = await hash("expire-denied");
    expect((await budget.reserve(denied, "meta", denied, 1, { allow_probe: true })).code).toBe("provider_backpressure");
    expect((await budget.summary()).reservations[0].reserved_microusd).toBe(2);
    await clearTime(budget);
    expect((await budget.reserve(denied, "meta", denied, 1, { allow_probe: true })).code).toBe("provider_outcome_reconciliation_required");
    expect((await budget.reserve(denied, "meta", denied, 1, { allow_probe: true, allow_uncertain: true })).ok).toBe(true);
    expect((await budget.summary()).reservations[0].reserved_microusd).toBe(3);
  });

  it.each([{ ok: true }, { ok: false }, { ok: false, code: "unrecognized_response" }])("rejects malformed coordination %j without dispatch or speculative refunds", async reservation => {
    const target = caller();
    await runInDurableObject(target.stub, async (_instance, state) => {
      const instance = new WorkConversation(state, { ...env, WORK_REASONING_BUDGET: { getByName: () => ({ reserve: async () => reservation }) } });
      const result = await instance.turn(target.id, input(), [entry]);
      expect(result.body.error_code).toBe("storage_or_coordination_unavailable");
      expect(result.body.server_exception.actions.some(action => action.action === "provider_request")).toBe(false);
      expect(result.body.attempts[0].reservation_status).toBe("pending");
      expect(result.body.reservation_status).toBe("pending");
      expect(state.storage.sql.exec("SELECT SUM(tokens) AS n FROM budgets").one().n).toBeGreaterThan(0);
    });
  });

  it("recovers on a fresh authorized single-provider request without changing the failed request replay", async () => {
    const first = caller(), next = caller();
    const failed = await first.stub.turn(first.id, input({ provider: "meta", message: "rotate-test" }), [entry]);
    await clearTime(env.WORK_REASONING_BUDGET.getByName("provider-allowance-v1"));
    const recovered = await next.stub.turn(next.id, input({ provider: "meta" }), [entry]);
    expect(recovered.body.proposal.status).toBe("ready");
    expect(recovered.body.attempts[0].provider_health.state).toBe("healthy");
    expect(await first.stub.turn(first.id, input({ provider: "meta", message: "rotate-test" }), [entry])).toEqual(failed);
  });

  it("admits one recovery dispatch across 20 concurrent caller turn lifecycles", async () => {
    const first = caller();
    await first.stub.turn(first.id, input({ provider: "meta", message: "rotate-test" }), [entry]);
    await clearTime(env.WORK_REASONING_BUDGET.getByName("provider-allowance-v1"));
    const clients = Array.from({ length: 20 }, caller);
    const results = await Promise.all(clients.map(client => client.stub.turn(client.id, input({ provider: "meta", message: "health-probe-race" }), [entry])));
    expect(results.filter(result => result.body.proposal?.status === "ready")).toHaveLength(1);
    expect(results.filter(result => result.body.error_code === "provider_recovery_probe_inflight")).toHaveLength(19);
    expect(results.flatMap(result => result.body.server_exception.actions).filter(action => action.action === "provider_request")).toHaveLength(1);
  });

  it("does not let a late successful request clear a newer limit", () => {
    const states = { "*": freshHealth(), model: freshHealth() }, a = admitHealth(states, "a", 1000, false, false), b = admitHealth(states, "b", 1000, false, false);
    settleHealth(states, a.ticket, "a", "model", 1000, "rejected", "provider_rate_limited", null, null);
    settleHealth(states, b.ticket, "b", "model", 1001, "completed", null, null, null);
    expect(states.model.failures).toBe(1);
  });

  it("keeps an active probe lease when an older failure arrives", () => {
    const states = { "*": freshHealth(), model: freshHealth() }, a = admitHealth(states, "a", 1000, true, false), b = admitHealth(states, "b", 1000, true, false);
    settleHealth(states, a.ticket, "a", "model", 1000, "rejected", "provider_rate_limited", null, 1);
    const probe = admitHealth(states, "p", 1001, true, false);
    settleHealth(states, b.ticket, "b", "model", 1002, "rejected", "provider_rate_limited", null, 1);
    expect(states.model.probe_id).toBe("p");
    expect(admitHealth(states, "q", 1003, true, false).code).toBe("provider_recovery_probe_inflight");
    settleHealth(states, probe.ticket, "p", "model", 1004, "completed", null, null, null);
    expect(states.model).toMatchObject({ probe_id: null, failures: 1, available_after: 1003 });
  });

  it("durably preserves a recovery lease against a late failure and retains that newer limit", async () => {
    const budget = freshBudget(), a = await hash("late-a"), b = await hash("late-b"), p = await hash("active-p"), q = await hash("denied-q");
    await budget.reserve(a, "meta", a, 1);
    await budget.reserve(b, "meta", b, 1);
    await budget.recordOutcome(a, "meta", a, outcome({ retry_after_seconds: 1 }));
    await clearTime(budget);
    expect((await budget.reserve(p, "meta", p, 1, { allow_probe: true })).ok).toBe(true);
    await budget.recordOutcome(b, "meta", b, outcome({ retry_after_seconds: 1 }));
    await clearTime(budget);
    expect((await budget.reserve(q, "meta", q, 1, { allow_probe: true })).code).toBe("provider_recovery_probe_inflight");
    const settled = await budget.recordOutcome(p, "meta", p, outcome({ outcome: "completed", error_code: null, reason: null, http_status: 200 }));
    expect(settled).toMatchObject({ state: "limited", reason: "rate_limited" });
    expect((await budget.summary()).reservations[0].reserved_microusd).toBe(3);
    await runInDurableObject(budget, (_instance, state) => {
      const stored = JSON.parse(state.storage.sql.exec("SELECT state FROM provider_health WHERE model='muse-spark-1.3'").one().state);
      expect(stored.probe_id).toBe(null);
      expect(stored.failures).toBe(1);
    });
  });

  it.each([
    [{ "retry-after": "7" }, 7, "retry_after"],
    [{ "retry-after": "Thu, 01 Jan 1970 00:16:50 GMT" }, 10, "retry_after"],
    [{ "x-ratelimit-reset-requests": "1s", "x-ratelimit-reset-tokens": "2m250ms" }, 120.25, "provider_reset"],
    [{ "anthropic-ratelimit-requests-reset": "1970-01-01T00:17:00Z" }, 20, "provider_reset"],
    [{ "retry-after": "NaN", "x-ratelimit-reset-tokens": "arbitrary private text" }, null, null]
  ])("normalizes reset guidance without retaining raw header values", (headers, seconds, source) => {
    expect(retryGuidance(new Headers(headers), 1000)).toEqual({ seconds, source });
  });
});
