// Owner, Nov 6 (worker prompt test run and muse-worker-02's 400 cycles): "next" is advisory and accurate, Tasks given back are not
// handed straight back, /q/task says what to do, an empty completion is refused, refusals never say the expected fencing_token,
// /q/schema/validate runs the real submit rules, hub replies carry next, and hub messages meant for the server owner stay with the owner.
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { isServerOwnerWork } from "../deploy/cloudflare/bilateral_bridge.js";
import { nextForTask } from "../deploy/cloudflare/work_next.js";

const HOST = "https://herma.ta-amps.workers.dev";
const call = (path, init = {}) => exports.default.fetch(HOST + path, init);
const post = (path, body) => call(path, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
let n = 0;
const uid = (p) => `${p}-${Date.now().toString(36)}${(n += 1)}`;

async function makeTask(title = "Write a one page sheet for a food bank") {
  const id = `verb_nq_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  await call("/q/pulse");
  await env.HERMA_DB.prepare(
    "INSERT INTO herma_durable_queue (task_id, tier, visibility, priority, title, prompt, simhash64_hex, producer_agent, created_at, updated_at, state, min_capability_milli) VALUES (?, 'ngo_priority', 'public_ngo', 99, ?, ?, '0', 'nq-maker', ?, ?, 'ready', 0)"
  ).bind(id, title, `Do this desk work: ${title}. Use public sources and list them.`, now, now).run();
  return id;
}
const claim = async (agent, id) => {
  const out = await (await call(`/q/claim/${agent}?task_id=${id}&format=json`)).json();
  return out.lease?.fencing_token ?? out.fencing_token;
};

describe("next is advisory and accurate", () => {
  it("after a submit it may continue, and /q/next suggests rather than orders", async () => {
    const agent = uid("nq-sub");
    const out = await (await post("/q/submit", { agent_id: agent, task_id: "self_seed", summary: "A small reusable note about food bank hours", task_objects: [{ object_key: `nq_note_${n}_v1`, summary: "Hours", payload: { a: 1 } }] })).json();
    expect(out.next.action).toBe("report_then_continue_or_stop");
    expect(out.next.may_continue).toBe(true);
    expect(out.next.advisory).toBe(true);
    await makeTask();
    const next = await (await call(`/q/next?agent_id=${agent}`)).json();
    if (next.tasks.length) {
      expect(next.next.advisory).toBe(true);
      expect(typeof next.tasks[0].let_go_by_workers).toBe("number");
    }
  });

  it("a Task this agent gave back is not offered to it again for 2 hours, and a second give-back suggests self_seed or a review", async () => {
    const agent = uid("nq-rel");
    const a = await makeTask("First desk Task for the give-back test");
    const b = await makeTask("Second desk Task for the give-back test");
    const fa = await claim(agent, a);
    const r1 = await (await call(`/q/release/${agent}/${a}/${fa}?reason=needs-a-blocked-source`)).json();
    expect(r1.released).toBe(true);
    expect(r1.next.action).toBe("find_other");
    expect(r1.next.advisory).toBe(true);
    expect(r1.next.leases_still_held).toBe(0);
    const fb = await claim(agent, b);
    const r2 = await (await call(`/q/release/${agent}/${b}/${fb}?reason=mis-targeted`)).json();
    expect(r2.next.action).toBe("self_seed_or_review");
    expect(r2.next.given_back_last_hour).toBeGreaterThanOrEqual(2);
    expect(r2.next.self_seed.url).toContain("/q/submit");
    const next = await (await call(`/q/next?agent_id=${agent}&limit=10`)).json();
    const ids = next.tasks.map((t) => t.task_id);
    expect(ids).not.toContain(a);
    expect(ids).not.toContain(b);
    expect(next.left_out.given_back_by_you_lately).toBeGreaterThanOrEqual(2);
    const other = await (await call(`/q/next?agent_id=${uid("nq-other")}&limit=10`)).json();
    for (const t of other.tasks) expect(typeof t.let_go_by_workers).toBe("number");
    const asked = await (await call(`/q/next?agent_id=${agent}&limit=10&include_released=1`)).json();
    expect(asked.left_out.given_back_by_you_lately).toBe(0);
  });

  it("/q/task says what a worker can do now", async () => {
    const id = await makeTask("A Task to read before a claim");
    const ready = await (await call(`/q/task/${id}`)).json();
    expect(ready.next.action).toBe("claim");
    const agent = uid("nq-task");
    await claim(agent, id);
    const leased = await (await call(`/q/task/${id}`)).json();
    expect(leased.next.action).toBe("wait_or_take_another");
    expect(leased.next.heartbeat_url_template).toContain("/q/heartbeat");
    expect(nextForTask({ task_id: "x", state: "leased", lease_expires_at: "2020-01-01T00:00:00Z" }, HOST)).toMatchObject({ action: "claim_again", lease_ended: true });
    expect(nextForTask({ task_id: "x", state: "done" }, HOST).url).toContain("/c/task/x");
    const missing = await (await call("/q/task/verb_no_such_task_here")).json();
    expect(missing.next.action).toBe("find_other");
  });
});

describe("submit rules", () => {
  it("refuses an empty completion and keeps the lease", async () => {
    const agent = uid("nq-empty");
    const id = await makeTask("A Task that needs real work");
    const fence = await claim(agent, id);
    for (const body of [{ agent_id: agent, task_id: id, fencing_token: fence }, { agent_id: agent, task_id: id, fencing_token: fence, summary: "test probe" }]) {
      const res = await post("/q/submit", body);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("empty_completion");
    }
    const row = await env.HERMA_DB.prepare("SELECT state FROM herma_durable_queue WHERE task_id = ?").bind(id).first();
    expect(row.state).toBe("leased");
    const ok = await post("/q/submit", { agent_id: agent, task_id: id, fencing_token: fence, summary: "Wrote the sheet with the hours and three public sources." });
    expect(ok.status).toBe(200);
  });

  it("review M3: an empty result field is no result", async () => {
    const agent = uid("nq-emptyres");
    const id = await makeTask("A Task for the empty result test");
    const fence = await claim(agent, id);
    for (const result of ["", {}, []]) {
      const res = await post("/q/submit", { agent_id: agent, task_id: id, fencing_token: fence, result });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("empty_completion");
    }
    const v = await (await post("/q/schema/validate", { agent_id: agent, task_id: id, fencing_token: fence, result: "A short real answer" })).json();
    expect(v.submit_check.errors.map((e) => e.code)).not.toContain("empty_completion");
  }, 120000);

  it("review H1: the chat never tells another caller a lease's fencing_token", async () => {
    const holder = uid("nq-holder");
    const id = await makeTask("A Task for the chat fence test");
    const fence = Number(await claim(holder, id));
    const other = uid("nq-prober");
    for (const body of [
      { agent_id: other, message: "validate my draft", draft: { task_id: id, fencing_token: fence + 9, summary: "A long enough summary of the work." } },
      { agent_id: other, message: `what is the status of my task ${id}`, task_id: id },
      { agent_id: other, message: "submit my draft", draft: { task_id: id, fencing_token: fence + 9, summary: "A long enough summary of the work." } },
      { agent_id: other, message: "I'm stuck on this one, please help", task_id: id },
      // The next turn, with no Task named: the session remembers the Task, never the holder's fence (review H1-B).
      { agent_id: other, message: "what is the status of my task" },
    ]) {
      const text = await (await post("/q/chat", body)).text();
      expect(text).not.toMatch(new RegExp(`fencing_token["=: ]+${fence}\\b`));
      expect(text).not.toContain("expected_fencing_token");
    }
    // /q/help with a Task id another agent holds (review H1-C).
    const help = await (await post("/q/help", { agent_id: other, task_id: id, message: "stuck on this Task" })).text();
    expect(help).not.toMatch(new RegExp(`fencing_token["=: ]+${fence}\\b`));
  }, 240000);

  it("refusals do not say the expected fencing_token", async () => {
    const agent = uid("nq-fence");
    const id = await makeTask("A Task for the fence test");
    const fence = await claim(agent, id);
    const stale = await post("/q/submit", { agent_id: agent, task_id: id, fencing_token: Number(fence) + 7, summary: "A long enough summary of the work." });
    expect(stale.status).toBe(409);
    const body = await stale.json();
    expect(body.expected_fencing_token).toBeUndefined();
    expect(body.detail).not.toMatch(/expected=|\(\d+\)\.?$/);
    const none = await post("/q/submit", { agent_id: agent, task_id: id, summary: "A long enough summary of the work." });
    const noneBody = await none.json();
    expect(JSON.stringify(noneBody)).not.toContain(`(${fence})`);
    const rel = await (await call(`/q/release/${agent}/${id}/${Number(fence) + 5}?reason=x`)).json();
    expect(rel.expected_lease_epoch).toBeUndefined();
  });

  it("/q/schema/validate checks the real submit rules", async () => {
    const v = async (body) => (await post("/q/schema/validate", body)).json();
    const empty = await v({});
    expect(empty.valid).toBe(false);
    expect(empty.submit_check.errors.map((e) => e.code)).toContain("missing_submit_fields");
    const badKey = await v({ agent_id: "nq-val", task_id: "self_seed", summary: "A note", task_objects: [{ object_key: "Bad Key!", summary: "x", payload: "a string" }] });
    expect(badKey.valid).toBe(true);
    expect(badKey.submit_check.changes.join(" ")).toContain('would be stored as "Bad_Key"');
    expect(badKey.submit_check.changes.join(" ")).toContain("payload is not a JSON object");
    const unknown = await v({ agent_id: "nq-val", task_id: "verb_no_such_task_xyz", summary: "done" });
    expect(unknown.submit_check.errors.map((e) => e.code)).toContain("task_not_found");
    const id = await makeTask("A Task for the validate test");
    const notLeased = await v({ agent_id: "nq-val", task_id: id, summary: "A long enough summary of the work." });
    expect(notLeased.submit_check.errors.map((e) => e.code)).toContain("task_not_leased");
    const sample = await (await call("/q/schema/validate")).json();
    expect(sample.valid_for_open_world_submit).toBe(true);
  });
});

describe("agent hub", () => {
  it("hello and reply carry next; next_turn stays; hello says its server timing", async () => {
    const agent = uid("nq-hub");
    const hello = await call(`/bridge/nq-test-hub/hello/${agent}?format=json`, { headers: { accept: "application/json" } });
    expect(hello.headers.get("server-timing")).toMatch(/fabric;dur=\d+/);
    const h = await hello.json();
    expect(h.next.action).toBe("answer_turn");
    const reply = await (await post("/bridge/nq-test-hub/reply", { agent, turn_tag: "t1", summary: "Split it in three steps.", subtasks: ["a", "b", "c"], generated_tasks: ["d"] })).json();
    expect(reply.next).toBeTruthy();
    if (reply.next_turn) expect(reply.next.prompt).toBe(reply.next_turn.prompt);
    const status = await (await call("/bridge/nq-test-hub/status")).json();
    expect(status.next.action).toBe("read_status");
  });

  it("a message for the server owner is not given to a client agent as its turn", async () => {
    expect(isServerOwnerWork("Service owner: update the hello handler to emit Server-Timing")).toBe(true);
    expect(isServerOwnerWork("Wrap the hello handler in monotonic timers for each stage")).toBe(true);
    expect(isServerOwnerWork("Rerun the 20-request hello p50 loop and compare")).toBe(false);
    expect(isServerOwnerWork("Please contact the service owner for access")).toBe(false);
    expect(isServerOwnerWork("Update the login handler to trim spaces")).toBe(false);
    const agent = uid("nq-owner");
    await call(`/bridge/nq-owner-hub/hello/${uid("nq-seed")}?format=json`, { headers: { accept: "application/json" } });
    await post("/bridge/nq-owner-hub/inbox", { sender: "nq-sender", target_agent: agent, prompt: "Service owner: update the hello handler to emit Server-Timing headers." });
    const h = await (await call(`/bridge/nq-owner-hub/hello/${agent}?format=json`, { headers: { accept: "application/json" } })).json();
    expect(h.assigned_prompt).not.toContain("Service owner");
    const row = await env.HERMA_DB.prepare("SELECT claimed_by FROM herma_bridge_inbox WHERE channel_id = 'nq-owner-hub' AND target_agent = ?").bind(agent).first();
    expect(row.claimed_by).toBe("service-owner");
  });
});
