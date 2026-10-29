import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { WorkConversation, WorkReasoningBudget } from "../deploy/cloudflare/conversation_state.js";
import { buildRequest, loadProviderPlan, operatorGrants, providerConfig, scaledInteger, upstreamIdentity } from "../deploy/cloudflare/conversation.js";

const entry = { entry_id: "work.observation", kind: "noun", title: "Observation", summary: "SYNTHETIC", schema_or_body: { work_contract: {
  operation_id: "record_observation", category_id: "noun.eval_run", description: "Record SYNTHETIC evidence.", input_schema: { type: "object", properties: { value: { type: "object", properties: { message: { type: "string" }, synthetic: { type: "boolean", const: true } }, required: ["message", "synthetic"], additionalProperties: false } }, required: ["value"], additionalProperties: false }
} } };
const turn = patch => ({ conversation_id: "conversation-one", request_id: "request-one", expected_version: 0, message: "SYNTHETIC hello", context_refs: [entry.entry_id], provider: "ollama", ...patch });
const plannedTurn = patch => turn({ provider: "meta", provider_plan_ref: "plan.providers", context_refs: [entry.entry_id, "plan.providers"], ...patch });
const providerPlan = (id, uncertain = false, providers = [{ provider: "meta", model: "muse-spark-1.3" }, { provider: "ollama", model: "muse-spark-open" }]) => ({ entry_id: "plan.providers", kind: "noun", title: "Provider plan", summary: "SYNTHETIC", _provider_plan_scope: id, schema_or_body: { provider_plan: {
  caller_scope: id, purpose: "caller_requested_typed_proposal", payer: "operator", context_refs: [entry.entry_id], allow_failover: true, allow_uncertain_outcome: uncertain, providers
} } });
// Pooled callers each hold their own exact operator grant from the vitest configuration.
const pooled = { regular: 0, uncertain: 0 };
const caller = (uncertain = false) => {
  const id = uncertain ? `key:synthetic-grants-uncertain-${pooled.uncertain++}` : `key:synthetic-grants-${pooled.regular++}`;
  return { id, stub: env.WORK_CONVERSATIONS.getByName(id) };
};
const freshBudget = () => env.WORK_REASONING_BUDGET.getByName("grants-" + crypto.randomUUID());
const rateLimited = { outcome: "rejected", error_code: "provider_rate_limited", reason: "rate_limited", retry_after_seconds: 60, http_status: 429 };
const GPT = { provider: "openai", model: "synthetic-gpt" }, ROUTED_GPT = { provider: "openrouter", model: "openai/synthetic-gpt", routing_provider: "openai" };
const OTHER = { provider: "openrouter", model: "synthetic/openrouter-model", routing_provider: "synthetic-host" };

describe("caller-scoped operator grants and upstream model identity", () => {
  beforeEach(async () => {
    await runInDurableObject(env.WORK_REASONING_BUDGET.getByName("provider-allowance-v1"), (_instance, state) => {
      state.storage.sql.exec("DELETE FROM provider_health");
      state.storage.sql.exec("DELETE FROM identity_cooldown");
    });
  });

  it("refuses a direct turn without this caller's exact operator grant", async () => {
    const id = "key:" + crypto.randomUUID(), stub = env.WORK_CONVERSATIONS.getByName(id);
    expect(await stub.turn(id, turn(), [entry])).toEqual({ status: 403, body: { code: "provider_grant_required" } });
    expect((await stub.snapshot(id, "conversation-one")).body.version).toBe(0);
    const granted = caller();
    await runInDurableObject(granted.stub, async (_instance, state) => {
      // An operator model change cannot silently widen what this caller was granted.
      const widened = new WorkConversation(state, { ...env, HERMA_CONVERSATION_OLLAMA_MODEL: "unlisted-model" });
      expect((await widened.turn(granted.id, turn(), [entry])).body.code).toBe("provider_grant_required");
      expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM turns").one().n).toBe(0);
    });
    const ready = await granted.stub.turn(granted.id, turn(), [entry]);
    expect(ready.body.proposal.status).toBe("ready");
    expect(ready.body.server_exception.operator_grant).toEqual({ caller_scope: granted.id, source: "caller_scoped_operator_grant" });
  });

  it.each([["HERMA_CONVERSATION_PROVIDER_PLAN_ALLOWLIST", '[{"provider":"meta","model":"muse-spark-1.3"}]'], ["HERMA_CONVERSATION_ALLOW_UNCERTAIN_FAILOVER", "true"], ["HERMA_CONVERSATION_ALLOW_UNCERTAIN_FAILOVER", "false"]])("refuses the deployment-wide %s setting loudly", async (name, value) => {
    const target = caller();
    await runInDurableObject(target.stub, async (_instance, state) => {
      const legacy = new WorkConversation(state, { ...env, [name]: value });
      expect((await legacy.turn(target.id, turn(), [entry])).body.code).toBe("invalid_provider_configuration");
      expect((await legacy.turn(target.id, plannedTurn(), [entry, providerPlan(target.id)])).body.code).toBe("invalid_provider_configuration");
      expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM turns").one().n).toBe(0);
    });
  });

  it("validates grants as exact caller scopes and explicit routes", () => {
    const choices = [{ provider: "ollama", model: "muse-spark-open" }];
    for (const grants of [[{ caller_scope: "*", providers: choices }], [{ caller_scope: "key:a", providers: choices }, { caller_scope: "key:a", providers: choices }], [{ caller_scope: "key:a", providers: [] }],
      [{ caller_scope: "key:a", providers: [{ provider: "openrouter", model: "a/b" }] }], [{ caller_scope: "key:a", providers: [{ provider: "meta", model: "muse-spark-1.3", routing_provider: "x" }] }],
      [{ caller_scope: "key:a", providers: choices, allow_uncertain_failover: "yes" }], [{ caller_scope: "key:a", providers: choices, budget_usd: 5 }]]) {
      expect(() => operatorGrants({ HERMA_CONVERSATION_PROVIDER_GRANTS: JSON.stringify(grants) })).toThrow("invalid_provider_configuration");
    }
    expect(() => operatorGrants({ HERMA_CONVERSATION_PROVIDER_GRANTS: '[{"caller_scope":"key:a","caller_scope":"key:b","providers":[]}]' })).toThrow("invalid_provider_configuration");
    expect(operatorGrants({ HERMA_CONVERSATION_PROVIDER_GRANTS: "  " }).size).toBe(0);
    expect([...operatorGrants({ HERMA_CONVERSATION_PROVIDER_GRANTS: JSON.stringify([{ caller_scope: "key:a", providers: choices, allow_uncertain_failover: true }]) }).values()])
      .toEqual([{ caller_scope: "key:a", providers: [{ provider: "ollama", model: "muse-spark-open", routing_provider: null }], allow_uncertain_failover: true }]);
  });

  it("records the possibly charged attempt that a scoped uncertain failover follows", async () => {
    const target = caller(true);
    const result = await target.stub.turn(target.id, plannedTurn({ message: "unknown-rotate-test" }), [entry, providerPlan(target.id, true)]);
    const [first, second] = result.body.attempts;
    expect(first).toMatchObject({ outcome: "unknown", reservation_status: "reserved", follows_uncertain_attempt_id: null, upstream_identity: "meta/muse-spark-1-3" });
    expect(first.reserved_usd).toBeGreaterThan(0);
    expect(second).toMatchObject({ outcome: "completed", follows_uncertain_attempt_id: first.attempt_id });
    expect(result.body.server_exception.uncertain_failover).toEqual({ plan_opt_in: true, operator_grant: true, allowed: true });
  });

  it("stops after an ambiguous outcome unless the plan also opts in", async () => {
    const target = caller(true);
    const result = await target.stub.turn(target.id, plannedTurn({ message: "unknown-rotate-test" }), [entry, providerPlan(target.id, false)]);
    expect(result.body.attempts).toHaveLength(1);
    expect(result.body.error_code).toBe("provider_unavailable");
    expect(result.body.server_exception.uncertain_failover).toEqual({ plan_opt_in: false, operator_grant: true, allowed: false });
  });

  it("cannot take uncertain failover from a plan or from another caller's grant", async () => {
    const target = caller(), lender = caller(true);
    expect((await target.stub.turn(target.id, plannedTurn(), [entry, providerPlan(target.id, true)])).body.code).toBe("provider_plan_not_authorized");
    const borrowed = { ...env, HERMA_CONVERSATION_PROVIDER_GRANTS: JSON.stringify([{ caller_scope: target.id, providers: [{ provider: "meta", model: "muse-spark-1.3" }, { provider: "ollama", model: "muse-spark-open" }] }, { caller_scope: lender.id, providers: [{ provider: "meta", model: "muse-spark-1.3" }], allow_uncertain_failover: true }]) };
    expect(() => loadProviderPlan(borrowed, target.id, plannedTurn(), [entry, providerPlan(target.id, true)])).toThrow("provider_plan_not_authorized");
    expect((await target.stub.snapshot(target.id, "conversation-one")).body.attempts).toEqual([]);
  });

  it("canonicalizes direct and gateway routes to one upstream identity", () => {
    expect(upstreamIdentity("openai", "gpt-x")).toBe(upstreamIdentity("openrouter", "openai/gpt-x"));
    expect(upstreamIdentity("anthropic", "claude-sonnet-4-5-20250929")).toBe(upstreamIdentity("openrouter", "anthropic/claude-sonnet-4.5:thinking"));
    expect(upstreamIdentity("openai", "gpt-x")).not.toBe(upstreamIdentity("openrouter", "openai/gpt-y"));
  });

  it("refuses a plan that reaches one upstream model through two credentials", () => {
    const id = "key:synthetic-grants-plan", input = plannedTurn({ provider: "openai" });
    const granted = { ...env, HERMA_CONVERSATION_PROVIDER_GRANTS: JSON.stringify([{ caller_scope: id, providers: [GPT, ROUTED_GPT, OTHER] }]) };
    expect(() => loadProviderPlan(granted, id, input, [entry, providerPlan(id, false, [GPT, ROUTED_GPT])])).toThrow("provider_plan_not_authorized");
    expect(loadProviderPlan(granted, id, input, [entry, providerPlan(id, false, [GPT, OTHER])]).providers).toHaveLength(2);
  });

  it("holds one upstream model against another provider's credential during its rate limit", async () => {
    const budget = freshBudget(), [a, b, c, d] = ["a", "b", "c", "d"].map(x => x.repeat(64));
    await runInDurableObject(budget, (_instance, state) => {
      const direct = new WorkReasoningBudget(state, { ...env, HERMA_CONVERSATION_OPENAI_MODEL: "synthetic-gpt" });
      const gateway = new WorkReasoningBudget(state, { ...env, HERMA_CONVERSATION_OPENROUTER_MODEL: "openai/synthetic-gpt" });
      expect(direct.reserve(a, "openai", a, 1).ok).toBe(true);
      direct.recordOutcome(a, "openai", a, rateLimited);
      const held = gateway.reserve(b, "openrouter", b, 1, { allow_probe: true });
      expect(held).toMatchObject({ ok: false, code: "provider_identity_cooldown", health: { state: "limited", reason: "rate_limited", scope: "upstream_model_identity" } });
      expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM reservations WHERE id=?", b).one().n).toBe(0);
      expect(direct.summary().identity_cooldowns).toEqual([expect.objectContaining({ identity: "openai/synthetic-gpt", reason: "rate_limited", route: "openai" })]);
      // The gateway route to this model stays held; another gateway model is unaffected.
      expect(gateway.reserve(c, "openrouter", c, 1).code).toBe("provider_identity_cooldown");
      const otherModel = new WorkReasoningBudget(state, env);
      expect(otherModel.reserve(c, "openrouter", c, 1).ok).toBe(true);
      // The rate-limited route itself keeps its existing shared health and recovery probe.
      expect(direct.reserve(d, "openai", d, 1, { allow_probe: true }).code).toBe("provider_backpressure");
      state.storage.sql.exec("UPDATE identity_cooldown SET available_after=0");
      expect(gateway.reserve(b, "openrouter", b, 1).ok).toBe(true);
    });
  });

  it("lets an explicit plan continue past an identity-cooldown skip", async () => {
    const target = caller();
    await runInDurableObject(target.stub, async (_instance, state) => {
      const budget = env.WORK_REASONING_BUDGET.getByName(crypto.randomUUID());
      const held = { ok: false, code: "provider_identity_cooldown", health: { state: "limited", reason: "rate_limited", available_after: Date.now() / 1000 + 60, requires_uncertain_authorization: false, scope: "upstream_model_identity" } };
      const fresh = new WorkConversation(state, { ...env, WORK_REASONING_BUDGET: { getByName: () => ({ reserve: async (id, provider, ...args) => provider === "meta" ? held : budget.reserve(id, provider, ...args), recordOutcome: (...args) => budget.recordOutcome(...args) }) } });
      const result = await fresh.turn(target.id, plannedTurn(), [entry, providerPlan(target.id)]);
      expect(result.body.proposal.status).toBe("ready");
      expect(result.body.attempts.map(a => [a.provider, a.error_code, a.reservation_status])).toEqual([["meta", "provider_identity_cooldown", "denied"], ["ollama", null, "reserved"]]);
      expect(result.body.attempts[0].reserved_tokens).toBe(0);
    });
  });

  it.each(["contributor", "muse-spark-1.3-contributor", "synthetic/contributor", "synthetic:contributor", "Muse-CONTRIBUTOR-preview"])("refuses contributor model %s in an otherwise valid granted plan and in grants", async model => {
    const target = caller(), plan = providerPlan(target.id);
    plan.schema_or_body.provider_plan.providers[1] = { provider: "ollama", model };
    expect(await target.stub.turn(target.id, plannedTurn(), [entry, plan])).toEqual({ status: 403, body: { code: "contributor_tier_refused" } });
    expect(() => operatorGrants({ HERMA_CONVERSATION_PROVIDER_GRANTS: JSON.stringify([{ caller_scope: "*", providers: [{ provider: "ollama", model }] }]) })).toThrow("contributor_tier_refused");
    expect(() => providerConfig({ ...env, HERMA_CONVERSATION_OLLAMA_MODEL: model }, "ollama")).toThrow("contributor_tier_refused");
  });

  it("admits a reservation of exactly the decimal dollar allowance", async () => {
    expect(Math.floor(2.01 * 1000000)).toBe(2009999);
    expect(scaledInteger(2.01, 6)).toBe(2010000);
    const budget = freshBudget(), [a, b] = ["e", "f"].map(x => x.repeat(64));
    await runInDurableObject(budget, (_instance, state) => {
      const exact = new WorkReasoningBudget(state, { ...env, HERMA_OPENAI_BUDGET_USD: "2.01" });
      expect(exact.reserve(a, "openai", a, 2010000).ok).toBe(true);
      expect(exact.reserve(b, "openai", b, 1).code).toBe("provider_budget_exhausted");
    });
  });

  it("prices reservations with exact integer picodollars", () => {
    const config = providerConfig({ ...env, HERMA_CONVERSATION_OPENAI_INPUT_USD_PER_MILLION: "0.1", HERMA_CONVERSATION_OPENAI_OUTPUT_USD_PER_MILLION: "0.3", HERMA_CONVERSATION_OPENAI_MAX_OUTPUT: "3" }, "openai");
    const { body, tokens, microusd } = buildRequest(config, turn({ provider: "openai", message: "日本語" }), [], []);
    const size = new TextEncoder().encode(JSON.stringify(body)).byteLength;
    expect(tokens).toBe(size + 4096 + 3);
    expect(microusd).toBe(Math.ceil(((size + 4096) * 100000 + 3 * 300000) / 1000000));
  });

  it("treats empty settings as unset, as in Python", () => {
    const config = providerConfig({ ...env, HERMA_CONVERSATION_OLLAMA_MODEL: " ", HERMA_CONVERSATION_OLLAMA_GENERATION: "", HERMA_CONVERSATION_CALLER_TOKENS_PER_HOUR: "" }, "ollama");
    expect([config.model, config.generation, config.caller_token_limit]).toEqual(["muse-spark-open", {}, null]);
    expect(() => providerConfig({ ...env, HERMA_META_BUDGET_USD: "" }, "meta")).toThrow("invalid_provider_configuration");
    expect(() => providerConfig({ ...env, HERMA_CONVERSATION_MAX_OUTPUT: "1e3" }, "ollama")).toThrow("invalid_provider_configuration");
  });

  it("records a duplicate-field reply as a possibly charged unknown outcome", async () => {
    const target = caller();
    const result = await target.stub.turn(target.id, turn({ provider: "meta", message: "duplicate-reply-test" }), [entry]);
    expect(result.body.error_code).toBe("provider_invalid_response");
    expect(result.body.attempts[0]).toMatchObject({ outcome: "unknown", reservation_status: "reserved" });
    expect(result.body.attempts[0].reserved_usd).toBeGreaterThan(0);
  });
});
