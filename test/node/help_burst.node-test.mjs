// /q/help spends Meta calls only inside its caps, even when many requests arrive at once (owner rule 8: an allowance is a limit,
// and every failed or uncertain attempt stays recorded). The REAL Worker runs on an in-memory database; fetch is replaced for the
// whole run by a stub that plays the Meta API, counts its calls and refuses every other host, so nothing leaves this process.
// Run: node --no-warnings --test test/node/help_burst.node-test.mjs   (Node 22, no packages; `npm run check` runs it)
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { ensureGenerated } from "../../scripts/banned_list.mjs";
import { inMemoryD1 } from "../../scripts/memory_d1.mjs";

ensureGenerated({ fixtureOk: true });
const { default: worker } = await import("../../deploy/cloudflare/worker.js");

const BASE = "https://herma.teleionlabs.com";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const realFetch = globalThis.fetch;
let calls = [];
let behavior = {};
const reset = (extra = {}) => {
  calls = [];
  behavior = { delayMs: 40, status: 200, throws: false, usage: { prompt_tokens: 2500, completion_tokens: 1600 }, ...extra };
};
globalThis.fetch = async (url, init = {}) => {
  const host = new URL(String(url)).host;
  if (host !== "api.meta.ai") return new Response("hosts other than the Meta API are refused in this test", { status: 599 });
  let body = {};
  try { body = JSON.parse(init.body || "{}"); } catch { /* not JSON */ }
  calls.push({ host, model: body.model, reasoning_effort: body.reasoning_effort, max_tokens: body.max_tokens });
  await sleep(behavior.delayMs);
  if (behavior.throws) throw new TypeError("the network is down");
  if (behavior.status !== 200) return new Response("{}", { status: behavior.status });
  const content = '{"summary":"ok","step_by_step_plan":["a"],"how_to_reuse_matched_objects":[],"edge_cases_and_guardrails":[]}';
  return new Response(JSON.stringify({ model: body.model, choices: [{ message: { content } }], usage: behavior.usage }), { status: 200 });
};
after(() => { globalThis.fetch = realFetch; });

async function session(envExtra = {}) {
  const db = await inMemoryD1();
  const env = {
    STORAGE_MODE: "cloud", HERMA_DB: db, PUBLIC_URL: BASE, META_API_KEY: "test-meta-key-not-real", HERMA_META_BUDGET_USD: "5",
    HERMA_CONVERSATION_MAX_OUTPUT: "1600", FREE_ACCESS_UNAUTH_RPM_CAP: "100000", ...envExtra,
  };
  const help = async (i, body = {}) => {
    const request = new Request(`${BASE}/q/help`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: "burst-agent", question: `How do I reuse a shelter schema? variant ${i}`, task_id: "ngo_seed_disaster_shelter_schema", ...body }),
    });
    const response = await worker.fetch(request, env, { waitUntil() {} });
    return { status: response.status, json: await response.json().catch(() => null) };
  };
  const rows = () => db.sqlite.prepare("SELECT outcome, error_code, COUNT(*) AS n, COALESCE(SUM(estimated_microusd), 0) AS micro FROM herma_meta_call_log GROUP BY outcome, error_code ORDER BY n DESC").all();
  const spent = () => rows().reduce((sum, r) => sum + r.micro, 0);
  const counted = () => db.sqlite.prepare("SELECT COUNT(*) AS n FROM herma_meta_call_log WHERE outcome IN ('reserved','completed','rate_limited','upstream_error','rejected')").get().n;
  return { db, help, rows, spent, counted };
}
const burst = (s, size, body) => Promise.all(Array.from({ length: size }, (_, i) => s.help(i, body)));

test("300 simultaneous requests for the expensive model make at most 50 Meta calls and stay under the public day cap", async () => {
  reset();
  const s = await session();
  const answers = await burst(s, 300, { model: "muse-wonder-1.0" });
  assert.ok(answers.every((a) => a.status === 200), "every request is answered (a refusal still gives the deterministic guidance)");
  assert.ok(calls.length <= 50, `Meta was called ${calls.length} times, the cap is 50`);
  assert.ok(s.spent() <= 1_000_000, `recorded spend ${s.spent()} micro-USD is over the public day cap of 1,000,000`);
  assert.ok(s.spent() <= 5_000_000, "and over the total budget of $5");
  assert.equal(s.counted(), calls.length, "every call that was made is a counted row, and nothing else is");
  const after = await s.help(9999, { model: "muse-wonder-1.0" });
  assert.equal(after.json.meta_model_trace.outcome, "budget_capped", "the next request is refused");
});

test("150 simultaneous requests for the default model make exactly 50 calls and the rest are refused for the call cap", async () => {
  reset({ usage: { prompt_tokens: 1500, completion_tokens: 500 } });
  const s = await session();
  await burst(s, 150);
  assert.equal(calls.length, 50);
  const refused = s.rows().find((r) => r.outcome === "budget_capped");
  assert.equal(refused.n, 100);
  assert.equal(refused.error_code, "paid_muse_daily_calls_cap_reached");
  assert.ok(s.spent() <= 1_000_000);
});

test("a small total budget holds under a burst", async () => {
  reset();
  const s = await session({ HERMA_META_BUDGET_USD: "0.05" });
  await burst(s, 100);
  assert.ok(s.spent() <= 50_000, `recorded spend ${s.spent()} micro-USD is over the $0.05 budget`);
  assert.ok(calls.length < 50, "the budget stops the calls before the call cap does");
});

test("a smaller call cap from the settings holds under a burst", async () => {
  reset({ usage: { prompt_tokens: 100, completion_tokens: 50 } });
  const s = await session({ HERMA_PAID_MUSE_CALLS_PER_DAY: "7" });
  await burst(s, 40);
  assert.equal(calls.length, 7);
});

test("failed calls stay counted: a network error keeps the reserved worst case and still uses up its slot", async () => {
  reset({ throws: true });
  const s = await session();
  for (let i = 0; i < 60; i += 1) await s.help(i);
  assert.ok(calls.length > 0 && calls.length <= 50, `${calls.length} calls were made, the cap is 50`);
  const failed = s.rows().find((r) => r.outcome === "upstream_error");
  assert.equal(failed.n, calls.length, "every attempt that was made is recorded as a failed attempt");
  assert.equal(failed.error_code, "provider_network_error");
  assert.ok(failed.micro > 0 && failed.micro <= 1_000_000, "a call that may have been billed keeps its reserved cost, and the day cap still holds");
  assert.equal(s.rows().find((r) => r.outcome === "budget_capped").n, 60 - calls.length, "the rest were refused");
  assert.equal(s.counted(), calls.length);
});

test("a refusal from the provider (429) is counted but costs nothing", async () => {
  reset({ status: 429 });
  const s = await session();
  for (let i = 0; i < 55; i += 1) await s.help(i);
  assert.equal(calls.length, 50);
  const limited = s.rows().find((r) => r.outcome === "rate_limited");
  assert.equal(limited.n, 50);
  assert.equal(limited.micro, 0);
});

test("one row per call: the reservation is updated with the outcome, never duplicated", async () => {
  reset();
  const s = await session();
  for (let i = 0; i < 5; i += 1) await s.help(i);
  const rows = s.db.sqlite.prepare("SELECT call_id, outcome, estimated_microusd FROM herma_meta_call_log").all();
  assert.equal(rows.length, 5);
  assert.equal(new Set(rows.map((r) => r.call_id)).size, 5);
  assert.ok(rows.every((r) => r.outcome === "completed" && r.estimated_microusd > 0), "no reservation is left open after an answer");
});

test("nothing but the Meta API is ever contacted", async () => {
  reset();
  const s = await session();
  await burst(s, 20);
  assert.ok(calls.length > 0 && calls.every((c) => c.host === "api.meta.ai"));
  assert.ok(calls.every((c) => c.reasoning_effort === "low"), "default Meta API reasoning_effort is low so output budget is preserved");
});

test("reasoning_effort defaults to low, accepts allowed overrides, and clamps unknown values to low", async () => {
  reset();
  const s = await session();
  await s.help(1, {});
  await s.help(2, { reasoning_effort: "medium" });
  await s.help(3, { reasoning_effort: "invalid-effort" });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].reasoning_effort, "low");
  assert.equal(calls[1].reasoning_effort, "medium");
  assert.equal(calls[2].reasoning_effort, "low");
});

test("supports minimal..max Meta rungs, adaptive effort calibration, JSON output floor, and reasoning_tokens telemetry", async () => {
  reset({
    usage: {
      prompt_tokens: 420,
      completion_tokens: 260,
      completion_tokens_details: { reasoning_tokens: 58 },
    },
  });
  const s = await session();
  const rMin = await s.help(1, { reasoning_effort: "minimal", max_tokens: 120 });
  const rAdaSimple = await s.help(2, {
    task_id: "",
    question: "Which HTTP code means rate limited?",
    reasoning_effort: "adaptive",
    max_tokens: 120,
  });
  const rAdaHard = await s.help(3, {
    task_id: "",
    question: "Derive the smallest valid Byzantine quorum intersection inequality given N=9, f=2, and b=1 simultaneously.",
    reasoning_effort: "adaptive",
    max_tokens: 120,
  });
  assert.equal(calls[0].reasoning_effort, "minimal");
  assert.equal(calls[0].max_tokens, 320);
  assert.equal(calls[1].reasoning_effort, "minimal");
  assert.equal(calls[1].max_tokens, 320);
  assert.equal(calls[2].reasoning_effort, "high");
  assert.equal(calls[2].max_tokens, 640);
  assert.equal(rMin.json.meta_model_trace.reasoning_tokens, 58);
  assert.equal(rAdaSimple.json.meta_model_trace.reasoning_effort_source, "trace_adaptive");
  const logRow = s.db.sqlite
    .prepare("SELECT reasoning_tokens, reasoning_effort FROM herma_meta_call_log WHERE call_id = ?")
    .get(rAdaHard.json.meta_model_trace.call_id);
  assert.equal(logRow.reasoning_tokens, 58);
  assert.equal(logRow.reasoning_effort, "high");
});
