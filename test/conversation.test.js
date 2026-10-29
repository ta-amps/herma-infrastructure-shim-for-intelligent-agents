import { env, exports } from "cloudflare:workers";
import { runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { WorkConversation } from "../deploy/cloudflare/conversation_state.js";
import { hash, checkSchema, parseProposal, providerConfig, strictJson, buildRequest } from "../deploy/cloudflare/conversation.js";

const contract = {
  operation_id: "record_observation", category_id: "noun.eval_run", description: "Record one SYNTHETIC capability observation.",
  input_schema: { type: "object", properties: { value: { type: "object", properties: { message: { type: "string" }, synthetic: { type: "boolean", const: true } }, required: ["message", "synthetic"], additionalProperties: false } }, required: ["value"], additionalProperties: false }
};
const entry = { entry_id: "work.observation", kind: "noun", title: "Observation", summary: "SYNTHETIC capability observation", schema_or_body: { work_contract: contract } };
const turn = patch => ({ conversation_id: "conversation-one", request_id: "request-one", expected_version: 0, message: "SYNTHETIC hello", context_refs: [entry.entry_id], provider: "ollama", ...patch });
const scope = () => "key:" + crypto.randomUUID();
const caller = () => { const id = scope(); return { id, stub: env.WORK_CONVERSATIONS.getByName(id) }; };
const http = (path, body, headers = {}) => exports.default.fetch("https://example.com" + path, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
async function key(scopes = ["route", "configure"]) {
  const res = await http("/v1/admin/keys", { label: "SYNTHETIC test", harness_kind: "opencode", scopes }, { "X-Bootstrap-Secret": "synthetic-bootstrap-value" });
  expect(res.status).toBe(201);
  const issued = await res.json();
  return { "Authorization": "Bearer " + issued.key, "X-Herma-Harness": "opencode" };
}

describe("typed conversation in the Workers runtime", () => {
  it("publishes generated schemas and enabled state without invoking a model", async () => {
    const schema = await (await http("/api/conversation-schema")).json();
    expect(schema.conversation_turn.additionalProperties).toBe(false);
    expect(schema.conversation_turn.required).toContain("expected_version");
    const access = await (await http("/connect.json")).json();
    expect(access.work_conversations.enabled).toBe(true);
    expect(access.work_conversations.schema_endpoint).toBe("/api/conversation-schema");
  });
  it("authenticates route scope and resolves only caller-visible contracts", async () => {
    expect((await http("/v1/conversations/turn", turn())).status).toBe(403);
    const a = await key(), b = await key(), configureOnly = await key(["configure"]);
    expect((await http("/v1/context", entry, a)).status).toBe(200);
    expect((await http("/v1/conversations/turn", turn(), b)).status).toBe(422);
    expect((await http("/v1/conversations/turn", turn(), configureOnly)).status).toBe(403);
    expect((await http("/v1/admin/conversation-budget", undefined, a)).status).toBe(403);
    const res = await http("/v1/conversations/turn", turn(), a);
    expect(res.status).toBe(200);
    expect((await res.json()).proposal.status).toBe("ready");
    const other = await http("/v1/conversations/conversation-one", undefined, b);
    expect((await other.json()).history).toEqual([]);
    expect((await http("/v1/conversations/turn", turn(), { ...a, Cookie: "session=fixture" })).status).toBe(403);
  });

  it.each(["ollama", "meta", "openai"])("clarifies then proposes typed data with %s and replays exactly", async provider => {
    const { id, stub } = caller();
    const first = await stub.turn(id, turn({ message: "hi", provider }), [entry]);
    expect(first.body.proposal.status).toBe("clarify");
    const input = turn({ provider, expected_version: 1, request_id: "request-two" });
    const second = await stub.turn(id, input, [entry]);
    expect(second.body.proposal.status).toBe("ready");
    expect(second.body.proposal.arguments.value.synthetic).toBe(true);
    expect(second.body.executed).toBe(false);
    expect(second.body.max_output_tokens).toBe(16384);
    expect(second.body.server_exception).toMatchObject({ purpose: "caller_requested_typed_proposal", principal: id, payer: "operator", retry_policy: "no_automatic_retry_or_provider_fallback" });
    expect(second.body.usage).toEqual({ input_tokens: 100, output_tokens: 50 });
    expect(second.body.receipt_hash).toMatch(/^[a-f0-9]{64}$/);
    await runInDurableObject(stub, (_instance, state) => state.storage.sql.exec("UPDATE conversations SET history=?", JSON.stringify([{ role: "user", content: "x".repeat(40000) }])));
    expect(await stub.turn(id, input, [entry])).toEqual(second);
    expect((await stub.turn(id, { ...input, message: "different" }, [entry])).body.code).toBe("request_id_conflict");
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
    const requests = await Promise.all(Array.from({ length: 20 }, async (_, i) => { const id = await hash({ i }); return stub.reserve(id, "meta", id, 1000000); }));
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
    expect(() => providerConfig({}, "ollama")).toThrow("output_allowance_required");
    const config = providerConfig({ HERMA_CONVERSATION_OLLAMA_MAX_OUTPUT: "300000", HERMA_CONVERSATION_OLLAMA_GENERATION: '{"think":true,"options":{"num_ctx":524288,"temperature":0.4}}' }, "ollama");
    const { body, tokens } = buildRequest(config, turn(), [], []);
    expect(body.options).toEqual({ num_predict: 300000, num_ctx: 524288, temperature: 0.4 });
    expect(body.think).toBe(true);
    expect(config.caller_token_limit).toBe(null);
    expect(tokens).toBeGreaterThan(300000);
    expect(() => providerConfig({ HERMA_CONVERSATION_OPENAI_MODEL: "synthetic", HERMA_CONVERSATION_MAX_OUTPUT: "300000" }, "openai")).toThrow("invalid_provider_configuration");
    expect(() => providerConfig({ HERMA_CONVERSATION_MAX_OUTPUT: "300000", HERMA_CONVERSATION_OLLAMA_GENERATION: '{"options":{"num_predict":-1}}' }, "ollama")).toThrow("invalid_provider_configuration");
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
    expect(() => providerConfig({ HERMA_CONVERSATION_META_MODEL: "muse-spark-1.3-contributor" }, "meta")).toThrow();
    expect(() => strictJson('{"a":1,"a":2}')).toThrow();
    expect(parseProposal({ choices: [null] }, "meta", []).proposal.status).toBe("blocked");
  });
});
