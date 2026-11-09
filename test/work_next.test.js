import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import worker from "../deploy/cloudflare/worker.js";
import { addNextToRefusal, jitteredWait, nextForError, resetLetGoCache } from "../deploy/cloudflare/work_next.js";

const BASE = "https://shim.teleionlabs.com";
const ctx = { waitUntil() {}, passThroughOnException() {} };
const call = (path, init) => worker.fetch(new Request(BASE + path, init), env, ctx);
const post = (path, body) => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
let n = 0;
const unique = (p) => `${p}-${Date.now().toString(36)}-${(n += 1)}`;

async function makeTask(title, { state = "ready", blockedBy = "", tier = "ngo_priority", priority = 99, producer = "maker-x", verbKind = "" } = {}) {
  const id = unique("verb_wn");
  const now = new Date().toISOString();
  const vis = tier === "public_general" ? "public_commons" : "public_ngo";
  await call("/q/pulse"); // tables exist after the first read
  await env.HERMA_DB.prepare(
    "INSERT INTO herma_durable_queue (task_id, tier, visibility, priority, title, prompt, simhash64_hex, producer_agent, created_at, updated_at, state, blocked_by_task_id, verb_kind, min_capability_milli) VALUES (?, ?, ?, ?, ?, ?, '0', ?, ?, ?, ?, ?, ?, 0)"
  ).bind(id, tier, vis, priority, title, `Do this desk work for ${title}.`, producer, now, now, state, blockedBy, verbKind).run();
  return id;
}
const hideAll = async () => env.HERMA_DB.prepare("UPDATE herma_durable_queue SET state = 'done' WHERE state = 'ready'").run();

describe("GET /q/next", () => {
  beforeEach(async () => {
    resetLetGoCache();
    await call("/q/pulse");
    await hideAll();
  }, 30000);

  it("names Tasks a claim can really lease, and leases nothing", async () => {
    const good = await makeTask("Write a one page sheet");
    const people = await makeTask("Run a live trial with a field team");
    const vectors = await makeTask("Index Enrichment of the catalog");
    const waiting = await makeTask("Second step", { blockedBy: good });
    const res = await call("/q/next?agent_id=wn-a&limit=10");
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.tasks.map((t) => t.task_id);
    expect(ids).toEqual([good]);
    for (const hidden of [people, vectors, waiting]) expect(ids).not.toContain(hidden);
    expect(body.next.action).toBe("claim");
    const row = await env.HERMA_DB.prepare("SELECT state FROM herma_durable_queue WHERE task_id = ?").bind(good).first();
    expect(row.state).toBe("ready");
    const lease = await (await call(`${new URL(body.next.url).pathname}${new URL(body.next.url).search}&format=json`)).json();
    expect(lease.lease.task_id).toBe(good);
    expect(lease.next.action).toBe("do_the_work");
    expect(lease.next.give_back_url).toContain(`/${lease.lease.fencing_token}?`);
  });

  it("a person with people can ask for field work; skip and own work are left out", async () => {
    const people = await makeTask("Run a live trial with a field team");
    expect((await (await call("/q/next?agent_id=wn-b")).json()).tasks).toEqual([]);
    expect((await (await call("/q/next?agent_id=wn-b&can_do_field_work=1")).json()).tasks.map((t) => t.task_id)).toEqual([people]);
    const a = await makeTask("Plain A");
    const b = await makeTask("Plain B");
    const mine = await makeTask("Plain mine", { producer: "wn-b" });
    const ids = (await (await call(`/q/next?agent_id=wn-b&limit=10&skip=${a}`)).json()).tasks.map((t) => t.task_id);
    expect(ids).toEqual([b]);
    expect(ids).not.toContain(mine);
  });

  it("an empty queue says stop with a wait, and never invents work", async () => {
    const body = await (await call("/q/next?agent_id=wn-c")).json();
    expect(body.tasks).toEqual([]);
    expect(body.next.action).toBe("stop");
    expect(body.next.retry_after_seconds).toBeGreaterThanOrEqual(1800);
  });

  it("only GET and HEAD", async () => {
    expect((await post("/q/next", {})).status).toBe(405);
    expect((await call("/q/next", { method: "HEAD" })).status).toBe(200);
  });
});

describe("a short list", () => {
  it("fills from the next tier, frontier general work first and build tasks before reviews by default, while honoring priority_regime=ngo_first", async () => {
    resetLetGoCache();
    await call("/q/pulse");
    await hideAll();
    const ngo = await makeTask("Plain nonprofit page");
    const pubReview = await makeTask("Review: check general page", { tier: "public_general", priority: 99, verbKind: "eval_and_rank" });
    const pubBuild = await makeTask("Build frontier engine module", { tier: "public_general", priority: 80 });

    const defaultIds = (await (await call("/q/next?agent_id=wn-z&limit=4")).json()).tasks.map((t) => t.task_id);
    expect(defaultIds).toEqual([pubBuild, pubReview, ngo]);

    const ngoFirstIds = (await (await call("/q/next?agent_id=wn-z&priority_regime=ngo_first&limit=4")).json()).tasks.map((t) => t.task_id);
    expect(ngoFirstIds[0]).toBe(ngo);
    expect(ngoFirstIds).toEqual([ngo, pubBuild, pubReview]);

    const preferRevIds = (await (await call("/q/next?agent_id=wn-z&prefer_reviews=1&limit=4")).json()).tasks.map((t) => t.task_id);
    expect(preferRevIds[0]).toBe(pubReview);
  });
});

describe("a dead Task stops trapping workers", () => {
  beforeEach(async () => {
    resetLetGoCache();
    await call("/q/pulse");
    await hideAll();
  }, 30000);

  it("after 3 different workers let it go, next and a plain claim leave it out; by id still works", async () => {
    const dead = await makeTask("Retest with whoever turns up");
    for (const who of ["wn-d1", "wn-d2", "wn-d3"]) {
      const got = await (await call(`/q/claim/${who}?task_id=${dead}&format=json`)).json();
      expect(got.lease.task_id).toBe(dead);
      const rel = await (await call(`/q/release/${who}/${dead}/${got.lease.fencing_token}?reason=needs-real-users`)).json();
      expect(rel.released).toBe(true);
      expect(rel.next.action).toBe("find_other");
      expect(rel.next.url).toContain(`skip=${dead}`);
    }
    resetLetGoCache();
    // Ranked lower, not dropped: another Task comes first, and it's still offered when nothing else is left.
    const other = await makeTask("Write a short sheet", { priority: 1 });
    const body = await (await call("/q/next?agent_id=wn-d4&limit=2")).json();
    expect(body.tasks.map((t) => t.task_id)).toEqual([other, dead]);
    expect(body.left_out.let_go_by_several_workers).toBeGreaterThanOrEqual(1);
    const listed = (await (await call("/q/tasks?state=ready&tier=ngo_priority&limit=50")).json()).tasks.find((t) => t.task_id === dead);
    expect(listed.let_go_by_workers).toBe(3);
    expect(listed.plain_claim_offers_it).toBe(true);
    expect(listed.offered_last).toBe(true);
    const first = await (await call("/q/claim/wn-d4?format=json")).json();
    expect(first.lease.task_id).toBe(other);
    const fallback = await (await call("/q/claim/wn-d5?format=json")).json();
    expect(fallback.lease.task_id).toBe(dead);
  });
});

describe("a claim with no lease says why", () => {
  beforeEach(async () => {
    resetLetGoCache();
    await call("/q/pulse");
    await hideAll();
  }, 30000);

  it("names the reason, as JSON, as plain text, and for POST", async () => {
    const people = await makeTask("Desk-sim fallback for a 40-trial block (no field team required)");
    const json = await (await call(`/q/claim/wn-e?task_id=${people}&format=json`)).json();
    expect(json.lease).toBeNull();
    expect(json.no_lease.reason).toBe("needs_people");
    expect(json.next.action).toBe("find_other");
    expect(json.next.url).toContain(`skip=${people}`);

    const text = await (await call(`/q/claim/wn-e?task_id=${people}`)).text();
    expect(text.split("\n")[0]).toContain(`NO LEASE for ${people}`);
    expect(text).toContain("REASON: needs_people");
    expect(text).not.toContain("ANTI-CONVERGENCE");
    expect(text.length).toBeLessThan(800);

    const viaPost = await (await post("/q/claim", { agent_id: "wn-e", task_id: people })).json();
    expect(viaPost.no_lease.reason).toBe("needs_people");

    const missing = await (await call(`/q/claim/wn-e?task_id=${unique("verb_none")}&format=json`)).json();
    expect(missing.no_lease.reason).toBe("no_such_task");

    const open = await makeTask("Plain work");
    await call(`/q/claim/wn-f?task_id=${open}&format=json`);
    const taken = await (await call(`/q/claim/wn-g?task_id=${open}&format=json`)).json();
    expect(taken.no_lease.reason).toBe("held_now");

    const later = await makeTask("Later step", { blockedBy: open });
    const blocked = await (await call(`/q/claim/wn-h?task_id=${later}&format=json`)).json();
    expect(blocked.no_lease.reason).toBe("waiting_on_another_task");

    expect((await (await call(`/q/claim/wn-e?task_id=${people}&can_do_field_work=1&format=json`)).json()).lease.task_id).toBe(people);
  });

  it("the list and the claim agree, and claimable=1 is the client's choice", async () => {
    const people = await makeTask("Run a live trial with a field team");
    const fine = await makeTask("Plain page");
    const all = await (await call("/q/tasks?state=ready&tier=ngo_priority&limit=50")).json();
    expect(all.tasks.find((t) => t.task_id === people).needs_people).toBe(true);
    expect(all.tasks.find((t) => t.task_id === fine).needs_people).toBe(false);
    const only = await (await call("/q/tasks?state=ready&tier=ngo_priority&limit=50&claimable=1")).json();
    expect(only.tasks.map((t) => t.task_id)).toEqual([fine]);
    const got = await (await call(`/q/claim/wn-list?task_id=${fine}&format=json`)).json();
    await post("/q/submit", { agent_id: "wn-list", task_id: fine, fencing_token: got.lease.fencing_token, summary: "labeled test row", task_objects: [{ object_key: unique("wn_obj"), category: "ngo_public_good", summary: "labeled test", payload: { a: "b" } }] });
    const done = await (await call("/q/tasks?state=done&tier=ngo_priority&limit=50&claimable=1")).json();
    expect(done.tasks.map((t) => t.task_id)).not.toContain(fine);
    const after = await makeTask("Runs after the plain page", { blockedBy: fine });
    const ready = await (await call("/q/tasks?state=ready&tier=ngo_priority&limit=50")).json();
    expect(ready.tasks.find((t) => t.task_id === after).plain_claim_offers_it).toBe(true);
  });
});

describe("refusals carry next", () => {
  it("a stale fence and a closed Task say what to do; the fence is not in next", async () => {
    resetLetGoCache();
    const id = await makeTask("Plain close");
    const got = await (await call(`/q/claim/wn-i?task_id=${id}&format=json`)).json();
    const wrong = await post("/q/submit", { agent_id: "wn-i", task_id: id, fencing_token: got.lease.fencing_token + 7, summary: "x" });
    expect(wrong.status).toBe(409);
    const body = await wrong.json();
    expect(body.next.action).toBe("claim_again_then_resend");
    expect(JSON.stringify(body.next)).not.toMatch(/fencing_token=\d/);
  });

  it("bad JSON says resend every word; busy says retry with a random wait", async () => {
    const res = await call("/q/submit", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    const body = await res.json();
    expect(body.next.action).toBe("fix_json_and_resend");
    for (let i = 0; i < 20; i += 1) {
      const w = jitteredWait();
      expect(w).toBeGreaterThanOrEqual(5);
      expect(w).toBeLessThanOrEqual(15);
    }
    expect(nextForError("anything", 503, BASE).retry_same_call).toBe(true);
    expect(addNextToRefusal({ ok: true }, 200, BASE).next).toBeUndefined();
  });
});

describe("giving back after the lease moved", () => {
  it("does not say to resend work", async () => {
    resetLetGoCache();
    const id = await makeTask("Plain give back");
    const got = await (await call(`/q/claim/wn-j?task_id=${id}&format=json`)).json();
    const res = await call(`/q/release/wn-j/${id}/${got.lease.fencing_token + 5}?reason=x`);
    expect(res.status).toBe(409);
    expect((await res.json()).next.action).toBe("find_other");
    const ok = await post("/q/submit", { agent_id: "wn-j", task_id: id, fencing_token: got.lease.fencing_token, summary: "labeled test", task_objects: [{ object_key: unique("wn_obj"), category: "ngo_public_good", summary: "labeled test", payload: { a: "b" } }] });
    expect((await ok.json()).next.action).toBe("report_then_continue_or_stop");
    expect((await call("/q/next?agent_id=wn-j&skip=%00")).status).toBe(200);
  });
});

describe("/q/find preferences", () => {
  it("for_task and kinds answer; an unknown Task is plain", async () => {
    const id = await makeTask("Grant deadline calendar for a small group");
    const res = await call(`/q/find?for_task=${id}&kinds=pack,repo&record_demand=0`);
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const hit of [...(body.hits || []), ...(body.maybe || [])]) {
      expect(["seed_pack", "repo"]).toContain(hit.kind);
      expect(hit.reviewed).toBe(false);
      expect(hit.type).toBeTruthy();
    }
    expect((await call(`/q/find?for_task=${unique("nope")}`)).status).toBe(404);
    expect((await call("/q/find?q=grant&kinds=task_object&limit=10&record_demand=0")).status).toBe(200);
  });
});
