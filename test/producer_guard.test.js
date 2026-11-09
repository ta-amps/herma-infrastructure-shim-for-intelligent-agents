// Regression for the producer-exclusion defect (muse-worker-02, Nov 3 to 6: verb_own_d20d48f35c60 leased back to its maker and
// released 43 times). Built on the worker's own spec: evaluator_must_differ_claim_routing_guard_spec_muse_worker02_v1 (G1 to G6)
// and its test vectors evaluator_routing_guard_test_vectors_muse_worker02_v1 (T1 to T3 here, plus the G4 submit backstop).
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { makerConflictIds, namedMakers, needsIndependentChecker, rowProducerConflict, targetObjectKeys } from "../deploy/cloudflare/producer_guard.js";

const HOST = "https://herma.ta-amps.workers.dev";
const call = (path, init = {}) => exports.default.fetch(HOST + path, init);
const post = (path, body) => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
let n = 0;
const uid = (p) => `${p}-${Date.now().toString(36)}${(n += 1)}`;

async function maker() {
  const agent = uid("pg-maker");
  const key = `pg_template_${agent.replace(/-/g, "_")}_v1`;
  const out = await (await post("/q/submit", { agent_id: agent, task_id: "self_seed", summary: "A trip-log template", task_objects: [{ object_key: key, category: "reference_spec", summary: "Template", payload: { rows: 3 } }] })).json();
  expect(out.ok).toBe(true);
  return { agent, key, uuid: out.worker_uuid };
}

async function insertTask({ producer = "system-seed", owner = "", producerUuid = "", kind = "general_verb", title, prompt, tier = "public_general", visibility = "public_commons", priority = 99 }) {
  const id = `verb_own_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  await env.HERMA_DB.prepare(
    `INSERT INTO herma_durable_queue (task_id, tier, visibility, priority, title, prompt, simhash64_hex, producer_agent, created_at, updated_at, state, min_capability_milli, verb_kind, owner_worker_uuid, producer_worker_uuid)
     VALUES (?, ?, ?, ?, ?, ?, '0', ?, ?, ?, 'ready', 0, ?, ?, ?)`
  ).bind(id, tier, visibility, priority, title, prompt, producer, now, now, kind, owner, producerUuid).run();
  return id;
}
const taskRow = (id) => env.HERMA_DB.prepare("SELECT * FROM herma_durable_queue WHERE task_id = ?").bind(id).first();

describe("producer_guard rules", () => {
  it("knows which Tasks need an independent checker, and who made the work", () => {
    expect(needsIndependentChecker({ title: "Independent review of the soft-start trip-log template" })).toBe(true);
    expect(needsIndependentChecker({ prompt: "Check it. Evaluator must differ from muse-worker-02." })).toBe(true);
    // The kind label alone does not trigger the guard; the Task's own words do.
    expect(needsIndependentChecker({ verb_kind: "eval_and_rank", title: "Rank these" })).toBe(false);
    expect(needsIndependentChecker({ verb_kind: "eval_and_rank", title: "Rank these", prompt: "The rater must differ from the author." })).toBe(true);
    expect(needsIndependentChecker({ title: "Re-rate the object after its fix" })).toBe(true);
    expect(needsIndependentChecker({ task_id: "verb_peer_review_x", title: "x" })).toBe(true);
    expect(needsIndependentChecker({ title: "Write a one page sheet", prompt: "Write it." })).toBe(false);
    expect(namedMakers({ prompt: "Evaluator must differ from muse-worker-02. A self-evaluation is invalid." })).toEqual(["muse-worker-02"]);
    expect(targetObjectKeys({ prompt: "Review softstart_trip_log_template_muse_worker02_v1 against GET https://shim.teleionlabs.com/q/object/other_key_v2." })).toEqual(
      expect.arrayContaining(["softstart_trip_log_template_muse_worker02_v1", "other_key_v2"])
    );
    const row = { title: "Independent review", prompt: "Evaluator must differ from a-maker.", producer_agent: "system", owner_worker_uuid: "w_a", producer_worker_uuid: "w_m" };
    expect(rowProducerConflict(row, { agentId: "a-maker" })).toBeTruthy();
    expect(rowProducerConflict(row, { agentId: "b", workerUuid: "w_m" })).toBeTruthy();
    // A checker the maker chose (the owner pin) may take it.
    expect(rowProducerConflict(row, { agentId: "b", workerUuid: "w_a" })).toBe("");
    expect(rowProducerConflict(row, { agentId: "someone-else", workerUuid: "w_b" })).toBe("");
    // D3: a Task that needs no checker is not touched.
    expect(rowProducerConflict({ title: "Write the next part", producer_agent: "a-maker" }, { agentId: "a-maker" })).toBe("");
  });
});

describe("maker != checker on the live routes", () => {
  it("T1 and T3: the maker's own pinned review is refused with 409 and a skip link, unpinned, and stays ready (G3)", async () => {
    const m = await maker();
    const id = await insertTask({
      producer: m.agent,
      owner: m.uuid,
      producerUuid: m.uuid,
      kind: "worker_self_directed",
      title: "Independent review of the trip-log template vs its parent protocol",
      prompt: `Independent review of ${m.key}: confirm the threshold is unchanged. Evaluator must differ from ${m.agent}.`,
    });
    const res = await call(`/q/claim/${m.agent}?task_id=${id}&worker_uuid=${m.uuid}&format=json`);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("producer_cannot_evaluate");
    expect(body.next.url).toContain(`skip=${id}`);
    expect(JSON.stringify(body)).not.toMatch(/fencing_token/);
    const after = await taskRow(id);
    expect(after.state).toBe("ready");
    expect(after.owner_worker_uuid).toBe("");
    expect(after.verb_kind).toBe("eval_and_rank");
    // A plain claim for its own beat does not hand it back either.
    for (const slot of ["own", "eval", "any"]) {
      const plain = await (await call(`/q/claim/${m.agent}?worker_uuid=${m.uuid}&slot=${slot}&format=json`)).json();
      expect(plain.task?.task_id).not.toBe(id);
      expect(plain.lease?.task_id).not.toBe(id);
    }
    expect((await taskRow(id)).state).toBe("ready");
  }, 120000);

  it("the defect itself: a plain own-beat claim never leases the maker's pinned review back to it", async () => {
    const m = await maker();
    await env.HERMA_DB.prepare("UPDATE herma_durable_queue SET owner_worker_uuid = '' WHERE owner_worker_uuid = ? AND state = 'ready'").bind(m.uuid).run();
    const id = await insertTask({
      producer: m.agent, owner: m.uuid, producerUuid: m.uuid, kind: "worker_self_directed", priority: 100,
      title: "Independent review of the soft-start trip-log template vs its parent protocol",
      prompt: `Independent review of ${m.key} against its parent. Evaluator must differ from ${m.agent}.`,
    });
    const plain = await (await call(`/q/claim/${m.agent}?worker_uuid=${m.uuid}&slot=own&format=json`)).json();
    expect(plain.task?.task_id ?? plain.lease?.task_id ?? null).not.toBe(id);
    const after = await taskRow(id);
    expect(after.state).toBe("ready");
    expect(after.leased_by).toBe(null);
  });

  it("G1 and T2: a review that names the maker's Task Object is left out for the maker everywhere, and leased to another agent", async () => {
    const m = await maker();
    const id = await insertTask({ title: "Independent check of a template", prompt: `Read GET https://shim.teleionlabs.com/q/object/${m.key} and check its arithmetic. Reviewer != author.` });
    const next = await (await call(`/q/next?agent_id=${m.agent}&limit=5`)).json();
    expect(next.tasks.map((t) => t.task_id)).not.toContain(id);
    const listed = await (await call(`/q/tasks?state=ready&agent_id=${m.agent}&limit=200`)).json();
    expect(listed.tasks.map((t) => t.task_id)).not.toContain(id);
    const refused = await call(`/q/claim/${m.agent}?task_id=${id}&format=json`);
    expect(refused.status).toBe(409);
    expect((await refused.json()).code).toBe("producer_cannot_evaluate");
    const mcp = await (await post("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_tasks", arguments: { state: "ready", agent_id: m.agent, limit: 200 } } })).json();
    expect(mcp.result.content[0].text).not.toContain(id);
    const other = uid("pg-checker");
    const ok = await (await call(`/q/claim/${other}?task_id=${id}&format=json`)).json();
    expect(ok.lease?.fencing_token ?? ok.task?.fencing_token).toBeTruthy();
    expect((await taskRow(id)).leased_by).toBe(other);
  });

  it("G4: a submit from the maker on a lease made before the fix is refused, and the lease stays", async () => {
    const m = await maker();
    const id = await insertTask({ title: "Independent review", prompt: `Review ${m.key}. Evaluator must differ from ${m.agent}.` });
    const expires = new Date(Date.now() + 600000).toISOString();
    await env.HERMA_DB.prepare("UPDATE herma_durable_queue SET state = 'leased', leased_by = ?, leased_worker_uuid = ?, fencing_token = 1, lease_expires_at = ? WHERE task_id = ?").bind(m.agent, m.uuid, expires, id).run();
    const res = await post("/q/submit", { agent_id: m.agent, worker_uuid: m.uuid, task_id: id, fencing_token: 1, summary: "Looks right to me." });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("producer_cannot_evaluate");
    expect(body.next.url).toContain(`skip=${id}`);
    const after = await taskRow(id);
    expect(after.state).toBe("leased");
    expect(after.completed_by).toBe(null);
  });

  it("a review follow-up from a submit is not pinned to the submitter", async () => {
    const m = await maker();
    const out = await (
      await post("/q/submit", {
        agent_id: m.agent,
        worker_uuid: m.uuid,
        task_id: "self_seed",
        summary: "Made a second template",
        task_objects: [{ object_key: `${m.key}_b`, category: "reference_spec", summary: "Template b", payload: { rows: 4 } }],
        queued_verbs: [{ tier: "public_general", verb_kind: "worker_self_directed", for_self: true, title: "Independent review of template b", prompt: `Independent review of ${m.key}_b against its parent. Evaluator must differ from ${m.agent}.` }],
      })
    ).json();
    expect(out.ok).toBe(true);
    const spawned = (out.enqueued_followup_tasks || []).find((t) => /Independent review of template b/.test(t.title || "")) || out.enqueued_followup_tasks?.[0];
    expect(spawned).toBeTruthy();
    const row = await taskRow(spawned.task_id);
    expect(row.owner_worker_uuid).toBe("");
    expect(row.verb_kind).toBe("eval_and_rank");
  });

  it("review fix H1: a checker who is not the maker keeps its pin, is not called the maker, and no row changes", async () => {
    const m = await maker();
    const checker = await maker();
    const id = `verb_fbk_review_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    await env.HERMA_DB.prepare(
      `INSERT INTO herma_durable_queue (task_id, tier, visibility, priority, title, prompt, simhash64_hex, producer_agent, created_at, updated_at, state, min_capability_milli, verb_kind, owner_worker_uuid, producer_worker_uuid)
       VALUES (?, 'public_general', 'public_commons', 90, 'Review a report', ?, '0', ?, ?, ?, 'ready', 0, 'eval_and_rank', ?, ?)`
    ).bind(id, `Review the report in ${m.key}. Reviewer != author.`, m.agent, now, now, checker.uuid, m.uuid).run();
    const before = await taskRow(id);
    const res = await call(`/q/claim/${checker.agent}?task_id=${id}&worker_uuid=${checker.uuid}&format=json`);
    const body = await res.json();
    if (res.status === 409) expect(body.detail).not.toContain("you made");
    const after = await taskRow(id);
    expect(before.owner_worker_uuid).toBe(checker.uuid);
    expect(after.owner_worker_uuid).toBe(checker.uuid);
    expect(after.verb_kind).toBe("eval_and_rank");
  });

  it("review fix M1: a co-lease never puts the maker on its own review held by another worker", async () => {
    const m = await maker();
    const id = await insertTask({ title: "Independent review of the template", prompt: `Independent review of ${m.key}. Evaluator must differ from ${m.agent}.` });
    const other = uid("pg-holder");
    await call(`/q/claim/${other}?task_id=${id}&format=json`);
    const res = await (await call(`/q/claim/${m.agent}?task_id=${id}&allow_co_lease=1&format=json`)).json();
    const got = res.lease?.task_id ?? res.task?.task_id;
    expect(got).not.toBe(id);
  });

  it("review fix M2: a chat claim by the maker is refused and lets the pin go", async () => {
    const m = await maker();
    const id = await insertTask({ producer: m.agent, owner: m.uuid, producerUuid: m.uuid, kind: "worker_self_directed", title: "Independent review of the template", prompt: `Independent review of ${m.key}. Evaluator must differ from ${m.agent}.` });
    const res = await post("/q/chat", { agent_id: m.agent, worker_uuid: m.uuid, message: `claim ${id}` });
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/"fencing_token":\s*\d/);
    const after = await taskRow(id);
    expect(after.state).toBe("ready");
    expect(after.owner_worker_uuid).toBe("");
    const audit = await env.HERMA_DB.prepare("SELECT outcome FROM herma_task_attempt_ledger WHERE task_id = ? AND outcome = 'maker_unpinned'").bind(id).first();
    expect(audit?.outcome).toBe("maker_unpinned");
  });

  it("matches the maker by worker id alone, and by name in any case", async () => {
    const row = { title: "Independent review", prompt: "Evaluator must differ from Muse-Worker-02.", producer_agent: "system", producer_worker_uuid: "w_m" };
    expect(rowProducerConflict(row, { agentId: "muse-worker-02" })).toBeTruthy();
    expect(rowProducerConflict(row, { agentId: "a-new-name", workerUuid: "w_m" })).toBeTruthy();
    expect(rowProducerConflict({ ...row, producer_agent: "Maker-X" }, { agentId: "maker-x" })).toBeTruthy();
  });

  it("makerConflictIds reads the named Task Objects in one bounded query", async () => {
    const m = await maker();
    const rows = [
      { task_id: "a", title: "Independent review", prompt: `Check ${m.key}.` },
      { task_id: "b", title: "Write a sheet", prompt: `Use ${m.key}.` },
      { task_id: "c", title: "Independent review", prompt: "Check other_thing_v9." },
    ];
    const ids = await makerConflictIds(env.HERMA_DB, rows, { agentId: m.agent });
    expect([...ids]).toEqual(["a"]);
  });
});
