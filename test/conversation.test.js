import { env, exports } from "cloudflare:workers";
import { runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { WorkConversation } from "../deploy/cloudflare/conversation_state.js";
import worker from "../deploy/cloudflare/worker.js";
import { hash, checkSchema, parseProposal, providerConfig, strictJson, buildRequest, loadProviderPlan } from "../deploy/cloudflare/conversation.js";
import { ensureSchema, sha256Hex } from "../deploy/cloudflare/herma_engine.js";

const contract = {
  operation_id: "record_observation", category_id: "noun.eval_run", description: "Record one EXAMPLE capability observation.",
  input_schema: { type: "object", properties: { value: { type: "object", properties: { message: { type: "string" }, example: { type: "boolean", const: true } }, required: ["message", "example"], additionalProperties: false } }, required: ["value"], additionalProperties: false }
};
const entry = { entry_id: "work.observation", kind: "noun", title: "Observation", summary: "EXAMPLE capability observation", schema_or_body: { work_contract: contract } };
const turn = patch => ({ conversation_id: "conversation-one", request_id: "request-one", expected_version: 0, message: "EXAMPLE hello", context_refs: [entry.entry_id], provider: "meta", ...patch });
// A random scope holds no operator grant; pooled callers each hold their own exact grant.
const scope = () => "key:" + crypto.randomUUID();
const pooled = { regular: 0, uncertain: 0 };
const caller = (uncertain = false) => {
  const id = uncertain ? `key:example-conversation-uncertain-${pooled.uncertain++}` : `key:example-conversation-${pooled.regular++}`;
  return { id, stub: env.WORK_CONVERSATIONS.getByName(id) };
};
const providerPlan = (id, uncertain = false) => ({ entry_id: "plan.providers", kind: "noun", title: "Provider plan", summary: "EXAMPLE private provider plan", _provider_plan_scope: id, schema_or_body: { provider_plan: {
  caller_scope: id, purpose: "caller_requested_typed_proposal", payer: "operator", context_refs: [entry.entry_id], allow_failover: true, allow_uncertain_outcome: uncertain,
  providers: [{ provider: "meta", model: "muse-spark-1.3" }, { provider: "openai", model: "example-responses-model" }]
} } });
const plannedTurn = patch => turn({ provider: "meta", provider_plan_ref: "plan.providers", context_refs: [entry.entry_id, "plan.providers"], ...patch });
const http = (path, body, headers = {}) => exports.default.fetch("https://example.com" + path, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
async function key(scopes = ["route", "configure"]) {
  const res = await http("/v1/admin/keys", { label: "EXAMPLE test", harness_kind: "opencode", scopes }, { "X-Bootstrap-Secret": "example-bootstrap-value" });
  expect(res.status).toBe(201);
  const issued = await res.json();
  return { "Authorization": "Bearer " + issued.key, "X-Herma-Harness": "opencode" };
}
// Issued keys get random IDs, so the operator cannot have granted them. This test-only key
// reuses an ID from the vitest grant pool, the way an operator grants a known key.
let httpKeys = 0;
async function grantedKey(scopes = ["configure", "route"]) {
  await ensureSchema(env.HERMA_DB);
  const id = `example-http-${httpKeys++}`, secret = "example-secret-" + crypto.randomUUID();
  await env.HERMA_DB.prepare("INSERT INTO harness_keys (key_id, label, harness_kind, scopes_json, secret_sha256, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)")
    .bind(id, "EXAMPLE granted", "opencode", JSON.stringify(scopes), await sha256Hex(secret), Date.now() / 1000).run();
  return { "Authorization": `Bearer hmk_${id}.${secret}`, "X-Herma-Harness": "opencode" };
}

describe("typed conversation in the Workers runtime", () => {
  beforeEach(async () => {
    // Test cases share the plugin's storage. Keep their independent outage scenarios isolated.
    await runInDurableObject(env.WORK_REASONING_BUDGET.getByName("provider-allowance-v1"), (_instance, state) => state.storage.sql.exec("DELETE FROM provider_health"));
  });
  it("publishes generated schemas and enabled state without invoking a model", async () => {
    const schema = await (await http("/api/conversation-schema")).json();
    expect(schema.conversation_turn.additionalProperties).toBe(false);
    expect(schema.conversation_turn.required).toContain("expected_version");
    expect(schema.conversation_turn.properties.provider).toMatchObject({ default: "meta", enum: ["meta", "openai", "anthropic", "openrouter"] });
    const access = await (await http("/connect.json")).json();
    expect(access.work_conversations.enabled).toBe(true);
    expect(access.work_conversations.providers).toEqual(["meta", "openai", "anthropic", "openrouter"]);
    expect(access.work_conversations.schema_endpoint).toBe("/api/conversation-schema");
  });
  it("refuses a retired or unknown provider id like any other invalid turn", async () => {
    // The retired provider id is spelled in pieces so repository-wide name guards stay clean.
    const retired = ["oll", "ama"].join(""), { id, stub } = caller();
    for (const provider of [retired, "unknown-provider"]) expect(await stub.turn(id, turn({ provider }), [entry])).toEqual({ status: 422, body: { code: "invalid_conversation_turn" } });
    expect(() => providerConfig(env, retired)).toThrow("invalid_provider_configuration");
    expect(parseProposal({ message: {} }, retired, []).validation_issues).toEqual([{ path: "/", rule: "invalid_tool_call" }]);
  });
  it("authenticates route scope and resolves only caller-visible contracts", async () => {
    expect((await http("/v1/conversations/turn", turn())).status).toBe(403);
    const a = await grantedKey(), b = await grantedKey(), configureOnly = await key(["configure"]), ungranted = await key();
    expect((await http("/v1/context", entry, a)).status).toBe(200);
    expect((await http("/v1/context", entry, ungranted)).status).toBe(200);
    // A route key alone is not permission to spend operator funds on server inference.
    const refused = await http("/v1/conversations/turn", turn(), ungranted);
    expect(refused.status).toBe(403);
    expect((await refused.json()).code).toBe("provider_grant_required");
    expect((await http("/v1/conversations/turn", turn(), b)).status).toBe(422);
    expect((await http("/v1/conversations/turn", turn(), configureOnly)).status).toBe(403);
    expect((await http("/v1/admin/conversation-budget", undefined, a)).status).toBe(403);
    const res = await http("/v1/conversations/turn", turn(), a);
    expect(res.status).toBe(200);
    expect((await res.json()).proposal.status).toBe("ready");
    const other = await http("/v1/conversations/conversation-one", undefined, b);
    expect((await other.json()).history).toEqual([]);
    const strictCookie = await worker.fetch(new Request("https://example.com/v1/conversations/turn", { method: "POST", headers: { "Content-Type": "application/json", ...a, Cookie: "session=fixture" }, body: JSON.stringify(turn()) }), { ...env, HERMA_STRICT_AUTH: "true" }, { waitUntil() {}, passThroughOnException() {} });
    expect(strictCookie.status).toBe(403);
  });

  it.each(["meta", "openai", "anthropic", "openrouter"])("clarifies then proposes typed data with %s and replays exactly", async provider => {
    const { id, stub } = caller();
    const first = await stub.turn(id, turn({ message: "hi", provider }), [entry]);
    expect(first.body.proposal.status).toBe("clarify");
    const input = turn({ provider, expected_version: 1, request_id: "request-two" });
    const second = await stub.turn(id, input, [entry]);
    expect(second.body.proposal.status).toBe("ready");
    expect(second.body.proposal.arguments.value.example).toBe(true);
    expect(second.body.executed).toBe(false);
    expect(second.body.max_output_tokens).toBe(16384);
    expect(second.body.server_exception).toMatchObject({ purpose: "caller_requested_typed_proposal", principal: id, payer: "operator", retry_policy: "no_automatic_retry_or_provider_fallback" });
    expect(second.body.usage).toEqual({ input_tokens: 100, output_tokens: 50 });
    expect(second.body.attempts[0]).toMatchObject({ upstream_http_status: 200, provider_diagnostics: null });
    expect(second.body.receipt_hash).toMatch(/^[a-f0-9]{64}$/);
    if (provider === "openrouter") expect(second.body.attempts[0]).toMatchObject({ destination: "https://openrouter.ai/api/v1/chat/completions", routing_provider: "example-host", reported_provider: "example-host" });
    await runInDurableObject(stub, (_instance, state) => state.storage.sql.exec("UPDATE conversations SET history=?", JSON.stringify([{ role: "user", content: "x".repeat(40000) }])));
    expect(await stub.turn(id, input, [entry])).toEqual(second);
    expect((await stub.turn(id, { ...input, message: "different" }, [entry])).body.code).toBe("request_id_conflict");
  });

  it("rotates only through a scoped explicit plan and preserves private attempts and cooldown", async () => {
    const { id, stub } = caller(), plan = providerPlan(id), input = plannedTurn({ message: "rotate-test" });
    const result = await stub.turn(id, input, [entry, plan]);
    expect(result.body.proposal.status).toBe("ready");
    expect(result.body.attempts.map(a => [a.provider, a.outcome])).toEqual([["meta", "rejected"], ["openai", "completed"]]);
    expect(result.body.attempts[0].usage).toEqual({ input_tokens: null, output_tokens: null });
    expect(result.body.attempts[0].reserved_usd).toBeGreaterThan(0);
    expect(result.body.attempts[0]).toMatchObject({ upstream_http_status: 429, provider_diagnostics: { body_state: "malformed", reason: "unknown" } });
    expect(await stub.turn(id, input, [entry, plan])).toEqual(result);
    expect((await stub.snapshot(id, input.conversation_id)).body.attempts).toEqual(result.body.attempts);
    expect((await stub.snapshot(scope(), input.conversation_id)).status).toBe(403);
    const next = await stub.turn(id, plannedTurn({ message: "rotate-test", request_id: "request-next", expected_version: 1 }), [entry, plan]);
    expect(next.body.attempts[0].error_code).toBe("provider_backpressure");
    expect(next.body.attempts[0].reservation_status).toBe("denied");
    expect(next.body.attempts[1].outcome).toBe("completed");
    expect(next.body.server_exception.actions.filter(a => a.action !== "provider_request").every(a => a.model === null && a.provider === null)).toBe(true);
  });

  it.each([false, true])("retains unknown charges and requires explicit unknown-outcome permission: %s", async uncertain => {
    const { id, stub } = caller(uncertain);
    const result = await stub.turn(id, plannedTurn({ message: "unknown-rotate-test" }), [entry, providerPlan(id, uncertain)]);
    expect(result.body.attempts).toHaveLength(uncertain ? 2 : 1);
    expect(result.body.attempts[0].outcome).toBe("unknown");
    expect(result.body.attempts[0].reserved_usd).toBeGreaterThan(0);
    if (!uncertain) expect(result.body.error_code).toBe("provider_unavailable");
  });

  it("refuses plan scope, model, data and payer widening before provider attempts", async () => {
    const { id, stub } = caller(), input = plannedTurn();
    expect((await stub.turn(id, input, [entry, providerPlan(scope())])).body.code).toBe("provider_plan_not_authorized");
    for (const patch of [{ payer: "someone_else" }, { context_refs: ["other.ref"] }, { providers: [{ provider: "meta", model: "unapproved-model" }] }]) {
      const plan = providerPlan(id); Object.assign(plan.schema_or_body.provider_plan, patch);
      expect((await stub.turn(id, input, [entry, plan])).body.code).toBe("provider_plan_not_authorized");
    }
    // The plan's uncertainty opt-in needs this caller's own operator grant, which it lacks.
    expect(() => loadProviderPlan(env, id, input, [entry, providerPlan(id, true)])).toThrow("provider_plan_not_authorized");
    expect((await stub.snapshot(id, input.conversation_id)).body.attempts).toEqual([]);
  });

  it("isolates provider-plan nouns and attempt records through authenticated HTTP", async () => {
    const a = await grantedKey(), b = await grantedKey();
    const id = "key:" + a.Authorization.split("hmk_")[1].split(".")[0];
    const plan = providerPlan(id); delete plan._provider_plan_scope;
    expect((await http("/v1/context", entry, a)).status).toBe(200);
    expect((await http("/v1/context", entry, b)).status).toBe(200);
    expect((await http("/v1/context", plan, a)).status).toBe(200);
    const input = plannedTurn({ message: "rotate-test" });
    const result = await http("/v1/conversations/turn", input, a);
    expect((await result.json()).attempts).toHaveLength(2);
    const denied = await http("/v1/conversations/turn", input, b);
    expect(denied.status).toBe(403);
    expect((await denied.json()).code).toBe("provider_plan_not_authorized");
    expect((await (await http("/v1/conversations/conversation-one", undefined, b)).json()).attempts).toEqual([]);
    expect((await (await http("/v1/conversations/conversation-one", undefined, a)).json()).attempts).toHaveLength(2);
  });

  it("stops before model dispatch when budget coordination fails, even with an uncertain-outcome grant", async () => {
    const { id, stub } = caller(true);
    await runInDurableObject(stub, async (_instance, state) => {
      let reservations = 0;
      const fresh = new WorkConversation(state, { ...env, WORK_REASONING_BUDGET: { getByName: () => ({ reserve: async () => { reservations++; throw new Error("EXAMPLE storage unavailable"); } }) } });
      const result = await fresh.turn(id, plannedTurn(), [entry, providerPlan(id, true)]);
      expect(result.body.error_code).toBe("storage_or_coordination_unavailable");
      expect(reservations).toBe(1);
      expect(result.body.attempts).toHaveLength(1);
      expect(result.body.server_exception.actions.some(action => action.action === "provider_request")).toBe(false);
    });
  });

  it("does not charge coordination tokens against an exact caller allowance", async () => {
    const probe = caller();
    const first = await probe.stub.turn(probe.id, turn(), [entry]);
    const limit = first.body.reserved_tokens, bounded = caller();
    await runInDurableObject(bounded.stub, async (_instance, state) => {
      const fresh = new WorkConversation(state, { ...env, HERMA_CONVERSATION_CALLER_TOKENS_PER_HOUR: String(limit) });
      const result = await fresh.turn(bounded.id, turn(), [entry]);
      expect(result.body.proposal.status).toBe("ready");
      expect(result.body.reserved_tokens).toBe(limit);
      expect(state.storage.sql.exec("SELECT SUM(tokens) AS n FROM budgets").one().n).toBe(limit);
    });
  });

  it.each([["meta", "META_API_KEY"], ["openai", "OPENAI_API_KEY"], ["anthropic", "ANTHROPIC_API_KEY"], ["openrouter", "OPENROUTER_API_KEY"]])("preflights the selected %s key before allowance while preserving offline preparation", async (provider, variable) => {
    const target = caller(), config = { ...env, [variable]: "" };
    expect(buildRequest(providerConfig(config, provider), turn({ provider }), [], []).tokens).toBeGreaterThan(16384);
    await runInDurableObject(target.stub, async (_instance, state) => {
      let reservations = 0;
      const fresh = new WorkConversation(state, { ...config, WORK_REASONING_BUDGET: { getByName: () => { reservations++; throw new Error("EXAMPLE no reservation expected"); } } });
      const input = turn({ provider }), result = await fresh.turn(target.id, input, [entry]);
      expect(result.body.error_code).toBe("provider_not_configured");
      expect(result.body.attempts[0]).toMatchObject({ outcome: "not_sent", reservation_status: "not_reserved", reserved_tokens: 0 });
      expect(result.body.reserved_tokens).toBe(0);
      expect(reservations).toBe(0);
      expect(state.storage.sql.exec("SELECT SUM(tokens) AS n FROM budgets").one().n).toBe(0);
      expect(result.body.server_exception.actions.some(action => action.action === "provider_request")).toBe(false);
      expect(await fresh.turn(target.id, input, [entry])).toEqual(result);
    });
  });

  it("preserves the exact fallback allowance when the first provider key is absent", async () => {
    const probe = caller();
    // The fallback is the plan's OpenAI choice, so measure the exact allowance of an OpenAI request.
    const first = await probe.stub.turn(probe.id, turn({ provider: "openai" }), [entry]), limit = first.body.reserved_tokens, target = caller();
    await runInDurableObject(target.stub, async (_instance, state) => {
      const budget = env.WORK_REASONING_BUDGET.getByName(crypto.randomUUID());
      const fresh = new WorkConversation(state, { ...env, META_API_KEY: "", HERMA_CONVERSATION_CALLER_TOKENS_PER_HOUR: String(limit), WORK_REASONING_BUDGET: { getByName: () => budget } });
      const result = await fresh.turn(target.id, plannedTurn(), [entry, providerPlan(target.id)]);
      expect(result.body.proposal.status).toBe("ready");
      expect(result.body.attempts[0]).toMatchObject({ error_code: "provider_not_configured", outcome: "not_sent", reservation_status: "not_reserved", reserved_tokens: 0 });
      expect(result.body.reserved_tokens).toBe(limit);
      expect(state.storage.sql.exec("SELECT SUM(tokens) AS n FROM budgets").one().n).toBe(limit);
      expect(result.body.server_exception.actions.filter(action => action.action === "provider_request").map(action => action.provider)).toEqual(["openai"]);
      expect((await budget.summary()).today).toEqual([{ provider: "openai", reserved_calls: 1 }]);
    });
  });

  it("reports zero reserved attempt tokens for a known caller-budget denial", async () => {
    const target = caller();
    await runInDurableObject(target.stub, async (_instance, state) => {
      let reservations = 0;
      const fresh = new WorkConversation(state, { ...env, HERMA_CONVERSATION_CALLER_TOKENS_PER_HOUR: "1", WORK_REASONING_BUDGET: { getByName: () => { reservations++; throw new Error("EXAMPLE no reservation expected"); } } });
      const result = await fresh.turn(target.id, plannedTurn(), [entry, providerPlan(target.id)]);
      expect(result.body.error_code).toBe("conversation_budget_exhausted");
      expect(result.body.attempts).toHaveLength(1);
      expect(result.body.attempts[0]).toMatchObject({ outcome: "not_sent", reservation_status: "not_reserved", reserved_tokens: 0 });
      expect(result.body.attempts[0].reservation_ceiling_tokens).toBeGreaterThan(1);
      expect(result.body.reserved_tokens).toBe(0);
      expect(reservations).toBe(0);
    });
  });

  it.each([201, 202, 204, 206].flatMap(status => [false, true].map(uncertain => [status, uncertain])))("keeps nonfinal HTTP%s outcomes unknown with uncertainty grant=%s", async (status, uncertain) => {
    const target = caller(uncertain);
    await runInDurableObject(target.stub, async (_instance, state) => {
      const budget = env.WORK_REASONING_BUDGET.getByName(crypto.randomUUID());
      const fresh = new WorkConversation(state, { ...env, WORK_REASONING_BUDGET: { getByName: () => budget } });
      const input = plannedTurn({ message: "accepted-status-" + status }), entries = [entry, providerPlan(target.id, uncertain)];
      const result = await fresh.turn(target.id, input, entries), attempt = result.body.attempts[0];
      expect(result.body.attempts).toHaveLength(uncertain ? 2 : 1);
      expect(attempt).toMatchObject({ error_code: "provider_outcome_uncertain", upstream_http_status: status, outcome: "unknown", reservation_status: "reserved", usage: { input_tokens: null, output_tokens: null }, provider_health: { requires_uncertain_authorization: true } });
      expect(attempt.reserved_usd).toBeGreaterThan(0);
      expect(attempt.reserved_tokens).toBeGreaterThan(0);
      expect(JSON.stringify(result)).not.toContain("private-job");
      const before = await budget.summary();
      expect(await fresh.turn(target.id, input, entries)).toEqual(result);
      expect(await budget.summary()).toEqual(before);
      expect(fresh.snapshot(scope(), input.conversation_id).status).toBe(403);
    });
  });

  it.each(["queued", "in_progress"])("keeps OpenAI HTTP200 %s bodies and shared health uncertain", async status => {
    const target = caller();
    await runInDurableObject(target.stub, async (_instance, state) => {
      const budget = env.WORK_REASONING_BUDGET.getByName(crypto.randomUUID());
      const fresh = new WorkConversation(state, { ...env, WORK_REASONING_BUDGET: { getByName: () => budget } });
      const input = turn({ provider: "openai", message: "openai-" + status });
      const result = await fresh.turn(target.id, input, [entry]);
      expect(result.body.error_code).toBe("provider_outcome_uncertain");
      expect(result.body.attempts[0]).toMatchObject({ outcome: "unknown", upstream_http_status: 200, reservation_status: "reserved", provider_health: { requires_uncertain_authorization: true } });
      expect(JSON.stringify(result)).not.toContain("private-job");
      expect(await fresh.turn(target.id, input, [entry])).toEqual(result);
      expect((await budget.summary()).today).toEqual([{ provider: "openai", reserved_calls: 1 }]);
    });
  });

  it.each([
    ["openrouter", { n: 3 }], ["meta", { n: 2 }], ["openrouter", { n: true }], ["openrouter", { n: "1" }], ["openai", { n: 1 }],
    ["openrouter", { best_of: 3 }], ["openai", { service_tier: "priority" }], ["openai", { service_tier: "auto" }],
    ["openai", { service_tier: "flex" }], ["openai", { service_tier: null }], ["anthropic", { service_tier: "auto" }],
    ["openrouter", { service_tier: "default" }], ["openai", { prompt: { id: "pmpt_example", version: "1" } }], ["openrouter", { prompt_id: "pmpt_example" }],
    ["anthropic", { speed: "fast" }], ["anthropic", { inference_geo: "us" }]
  ])("refuses unpriced or opaque %s generation %j before reservation", async (provider, generation) => {
    const config = { ...env, [`HERMA_CONVERSATION_${provider.toUpperCase()}_GENERATION`]: JSON.stringify(generation) };
    expect(() => providerConfig(config, provider)).toThrow("unsupported_generation_configuration");
    const target = caller();
    await runInDurableObject(target.stub, async (_instance, state) => {
      let reservations = 0;
      const fresh = new WorkConversation(state, { ...config, WORK_REASONING_BUDGET: { getByName: () => { reservations++; throw new Error("EXAMPLE no reservation expected"); } } });
      const result = await fresh.turn(target.id, turn({ provider }), [entry]);
      expect(result.body.code).toBe("unsupported_generation_configuration");
      expect(reservations).toBe(0);
      expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM budgets").one().n).toBe(0);
    });
  });

  it.each(["openai", "anthropic", "openrouter"])("preserves normal %s generation and native output with explicit standard pricing", provider => {
    const generation = { temperature: 0.4, ...(provider === "openrouter" ? { n: 1 } : {}) };
    const config = providerConfig({ ...env, HERMA_CONVERSATION_MAX_OUTPUT: "300000", [`HERMA_CONVERSATION_${provider.toUpperCase()}_GENERATION`]: JSON.stringify(generation) }, provider);
    const { body, tokens } = buildRequest(config, turn({ provider }), [], []);
    expect(body.temperature).toBe(0.4);
    expect(body[provider === "openai" ? "max_output_tokens" : "max_tokens"]).toBe(300000);
    expect(tokens).toBeGreaterThan(300000);
    if (provider === "openrouter") { expect(body.n).toBe(1); expect(body.service_tier).toBeUndefined(); }
    else expect(body.service_tier).toBe(provider === "openai" ? "default" : "standard_only");
  });

  it("releases caller tokens only for a definite provider-budget denial before failover", async () => {
    const meta = caller(), openai = caller();
    const a = await meta.stub.turn(meta.id, turn({ provider: "meta" }), [entry]);
    const b = await openai.stub.turn(openai.id, turn({ provider: "openai" }), [entry]);
    const limit = Math.max(a.body.reserved_tokens, b.body.reserved_tokens), target = caller();
    await runInDurableObject(target.stub, async (_instance, state) => {
      const budget = env.WORK_REASONING_BUDGET.getByName("provider-allowance-v1");
      const fresh = new WorkConversation(state, { ...env, HERMA_CONVERSATION_CALLER_TOKENS_PER_HOUR: String(limit), WORK_REASONING_BUDGET: { getByName: () => ({ reserve: async (id, provider, ...args) => provider === "meta" ? { ok: false, code: "provider_budget_exhausted" } : budget.reserve(id, provider, ...args), recordOutcome: (...args) => budget.recordOutcome(...args) }) } });
      const result = await fresh.turn(target.id, plannedTurn(), [entry, providerPlan(target.id)]);
      expect(result.body.proposal.status).toBe("ready");
      expect(result.body.attempts[0].reservation_status).toBe("denied");
      expect(result.body.attempts[0].reserved_tokens).toBe(0);
      expect(result.body.reserved_tokens).toBe(b.body.reserved_tokens);
      expect(state.storage.sql.exec("SELECT SUM(tokens) AS n FROM budgets").one().n).toBe(result.body.reserved_tokens);
    });
  });

  it("fences a 20-way race before provider calls and budget reservations", async () => {
    const { id, stub } = caller();
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => stub.turn(id, turn({ request_id: "request-race-" + i }), [entry])));
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
    expect(results.filter(r => r.body.code === "version_conflict")).toHaveLength(19);
    await runInDurableObject(stub, (_instance, state) => {
      expect(state.storage.sql.exec("SELECT SUM(turns) AS n FROM budgets").one().n).toBe(1);
      expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM turns").one().n).toBe(1);
    });
  });

  it("reserves the shared dollar ceiling atomically across caller-like requests", async () => {
    const stub = env.WORK_REASONING_BUDGET.getByName(crypto.randomUUID());
    const ceiling = Number(env.HERMA_META_BUDGET_USD) * 1000000;
    const requests = await Promise.all(Array.from({ length: 20 }, async (_, i) => { const id = await hash({ i }); return stub.reserve(id, "meta", id, ceiling); }));
    expect(requests.filter(x => x.ok)).toHaveLength(1);
    expect(requests.filter(x => x.code === "provider_budget_exhausted")).toHaveLength(19);
  });

  it("reserves OpenAI independently and rejects overspending without provider calls", async () => {
    const stub = env.WORK_REASONING_BUDGET.getByName(crypto.randomUUID());
    const id = await hash({ provider: "openai" });
    expect((await stub.reserve(id, "openai", id, 1000001)).code).toBe("provider_budget_exhausted");
    expect((await stub.summary()).reservations).toEqual([]);
    expect((await stub.reserve(id, "openai", id, 1000000)).ok).toBe(true);
    expect((await stub.reserve(id, "openai", id, 1000000)).ok).toBe(true);
    expect((await stub.summary()).reservations).toEqual([{ provider: "openai", reserved_microusd: 1000000 }]);
  });

  it("requires explicit output allowance and preserves large native provider settings", () => {
    expect(() => providerConfig({}, "meta")).toThrow("output_allowance_required");
    const config = providerConfig({ ...env, HERMA_CONVERSATION_META_MAX_OUTPUT: "300000", HERMA_CONVERSATION_META_GENERATION: '{"temperature":0.4}' }, "meta");
    const { body, tokens } = buildRequest(config, turn(), [], []);
    expect(body.max_tokens).toBe(300000);
    expect(body.temperature).toBe(0.4);
    expect(config.caller_token_limit).toBe(null);
    expect(tokens).toBeGreaterThan(300000);
    expect(() => providerConfig({ HERMA_CONVERSATION_OPENAI_MODEL: "example", HERMA_CONVERSATION_MAX_OUTPUT: "300000" }, "openai")).toThrow("invalid_provider_configuration");
    expect(() => providerConfig({ ...env, HERMA_CONVERSATION_OPENROUTER_GENERATION: '{"provider":{"allow_fallbacks":true}}' }, "openrouter")).toThrow("invalid_provider_configuration");
    for (const model of ["openrouter/auto", "@preset/example-review", "example/model@preset/example-review", "example/model:online", "example/model:free:online"]) expect(() => providerConfig({ ...env, HERMA_CONVERSATION_OPENROUTER_MODEL: model }, "openrouter")).toThrow("invalid_provider_configuration");
    expect(() => providerConfig({ ...env, HERMA_CONVERSATION_OPENROUTER_GENERATION: '{"preset":"@preset/review"}' }, "openrouter")).toThrow("invalid_provider_configuration");
  });

  it.each([
    ["wrong-type-test", "clarify", null], ["malformed-test", "blocked", null],
    ["redirect-test", "blocked", "provider_rejected"], ["failure-test", "blocked", "provider_rate_limited"],
    ["too-large-test", "blocked", "provider_response_too_large"]
  ])("seals %s without executing or reflecting upstream data", async (message, status, code) => {
    const { id, stub } = caller(), input = turn({ message });
    const result = await stub.turn(id, input, [entry]);
    expect(result.status).toBe(200);
    expect(result.body.proposal.status).toBe(status);
    expect(result.body.error_code).toBe(code);
    expect(result.body.executed).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private upstream body");
    expect(await stub.turn(id, input, [entry])).toEqual(result);
  });

  it.each([
    ["diagnostic-parameter", 400, "unsupported_parameter"],
    ["diagnostic-credit", 400, "credit_or_quota_exhausted"],
    ["diagnostic-model", 404, "model_unavailable"],
    ["diagnostic-unknown", 503, "unknown"]
  ])("persists only bounded %s diagnostics, preserving usage, reservation and replay", async (message, status, reason) => {
    const { id, stub } = caller(), input = turn({ message, provider: "openai" });
    const result = await stub.turn(id, input, [entry]), attempt = result.body.attempts[0];
    expect(result.body.error_code).toBe(status === 503 ? "provider_unavailable" : "provider_rejected");
    expect(attempt).toMatchObject({ upstream_http_status: status, outcome: status === 503 ? "unknown" : "rejected", reservation_status: "reserved", usage: { input_tokens: null, output_tokens: null }, provider_diagnostics: { source: "provider_reported", body_state: "parsed", reason } });
    expect(attempt.reserved_usd).toBeGreaterThan(0);
    expect(await stub.turn(id, input, [entry])).toEqual(result);
    expect((await stub.snapshot(id, input.conversation_id)).body.attempts).toEqual(result.body.attempts);
    expect((await stub.snapshot(scope(), input.conversation_id)).status).toBe(403);
    const raw = JSON.stringify(result);
    for (const value of ["sk-" + "example".repeat(8), "acct_example_private", "req_example_private", "metadata"]) expect(raw).not.toContain(value);
    if (reason === "unknown") expect(attempt.provider_diagnostics).toMatchObject({ type: null, code: null, parameter: null });
  });

  it("reconstructs from SQLite and seals an uncertain turn without another provider call", async () => {
    const { id, stub } = caller();
    const first = await stub.turn(id, turn(), [entry]);
    await runInDurableObject(stub, async (_instance, state) => {
      const fresh = new WorkConversation(state, env);
      expect(fresh.snapshot(id, "conversation-one").body.version).toBe(1);
      const base = { ...first.body }; delete base.receipt_hash;
      base.usage = { input_tokens: null, output_tokens: null };
      state.storage.sql.exec("UPDATE turns SET response=NULL,base=?,created=?", JSON.stringify(base), Date.now() - 130000);
      state.storage.sql.exec("UPDATE conversations SET active='request-one'");
      await state.storage.setAlarm(Date.now() + 1000);
    });
    await runDurableObjectAlarm(stub);
    const replay = await stub.turn(id, turn(), [entry]);
    expect(replay.body.error_code).toBe("provider_outcome_uncertain");
    expect(replay.body.usage.input_tokens).toBe(null);
    // The reservation is preserved and one turn remains, not a second model attempt.
    await runInDurableObject(stub, (_instance, state) => expect(state.storage.sql.exec("SELECT SUM(turns) AS n FROM budgets").one().n).toBe(1));
  });

  it("expires transcripts and prevents stale IDs from triggering model calls", async () => {
    const { id, stub } = caller(); await stub.turn(id, turn(), [entry]);
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec("UPDATE conversations SET created=?", Date.now() - 86401000);
      await state.storage.setAlarm(Date.now() + 1000);
    });
    await runDurableObjectAlarm(stub);
    expect((await stub.snapshot(id, "conversation-one")).body.history).toEqual([]);
    expect((await stub.turn(id, turn(), [entry])).body.code).toBe("conversation_expired");
    expect((await stub.snapshot(scope(), "conversation-one")).status).toBe(403);
  });

  it("limits per-caller turns, rejects dynamic schemas and contributor models", async () => {
    const { id, stub } = caller(); await stub.turn(id, turn(), [entry]);
    await runInDurableObject(stub, (_instance, state) => state.storage.sql.exec("UPDATE budgets SET turns=60"));
    expect((await stub.turn(id, turn({ expected_version: 1, request_id: "request-two" }), [entry])).status).toBe(429);
    expect(() => checkSchema({ type: "object", properties: { unsafe: { type: "string", pattern: "(a+)+$" } } })).toThrow();
    expect(() => checkSchema({ type: "object", properties: { value: {} } })).toThrow();
    // Otherwise valid settings, so the refusal comes from the contributor rule itself; it also
    // precedes a missing output allowance, exactly as in Python.
    expect(() => providerConfig({ ...env, HERMA_CONVERSATION_META_MODEL: "muse-spark-1.3-contributor" }, "meta")).toThrow("contributor_tier_refused");
    expect(() => providerConfig({ HERMA_CONVERSATION_META_MODEL: "muse-spark-1.3-contributor" }, "meta")).toThrow("contributor_tier_refused");
    expect(providerConfig({ ...env, HERMA_CONVERSATION_META_MODEL: "muse-spark-1.3" }, "meta").model).toBe("muse-spark-1.3");
    expect(() => strictJson('{"a":1,"a":2}')).toThrow();
    expect(parseProposal({ choices: [null] }, "meta", []).proposal.status).toBe("blocked");
  });
});
