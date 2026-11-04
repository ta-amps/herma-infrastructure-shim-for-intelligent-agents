// Anyone reads public Task Objects with no key, by HTTP and MCP; every result says whether it was reviewed; a client chooses.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import worker from "../deploy/cloudflare/worker.js";
import { readClientPrefs } from "../deploy/cloudflare/client_prefs.js";
import { fitReply, reviewStateOf, reviewWhere } from "../deploy/cloudflare/public_read.js";

const limits = { ...env, OPEN_WORK_LIMITS: "on", PUBLIC_NAMES_FILTER: "on" };
const call = (request) => worker.fetch(request, limits, { waitUntil() {}, passThroughOnException() {} });
const get = async (path) => {
  const res = await call(new Request(`https://shim.teleionlabs.com${path}`, { headers: { accept: "application/json" } }));
  return { status: res.status, body: await res.json() };
};
const mcp = async (name, args) => {
  const res = await call(new Request("https://shim.teleionlabs.com/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
  return (await res.json()).result;
};
const unique = (name) => `${name}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const db = env.DB ?? env.HERMA_DB;

async function row(key, { summary = "open reading about shelters", payload = { note: "fine" }, visibility = "public_commons", evalCount = 0, verdict = "", tombstoned = 0 } = {}) {
  await get("/q/objects?limit=1"); // the gateway's setup
  await db.prepare(`INSERT INTO herma_task_objects (object_key, category, visibility, producer_agent, summary, payload_json, sha256_hash, simhash64_hex, lsh_band_0, eval_count, verification_verdict, is_tombstoned, created_at)
    VALUES (?, 'knowledge_noun', ?, 'test-maker', ?, ?, ?, 'aaaaaaaaaaaaaaaa', 'aaaa', ?, ?, ?, ?)`)
    .bind(key, visibility, summary, JSON.stringify(payload), `sha-${key}`, evalCount, verdict, tombstoned, new Date().toISOString()).run();
  return key;
}

describe("what stays closed", () => {
  it("infrastructure rows stay closed; personal data and credentials are replaced at display, by HTTP and MCP, in every form", async () => {
    const infra = await row(unique("infra"), { visibility: "server_infra" });
    const person = await row(unique("person"), { payload: { note: "write to jane.doe@gmail.com" } });
    const secret = await row(unique("secret"), { payload: { token: "ghp_" + "c".repeat(36) } });
    const code = await row(unique("code"), { payload: { note: "@dataclass class A and @app.route('/x')" } });
    expect((await get(`/q/object/${infra}`)).status).toBe(403);
    expect((await mcp("read_task_object", { key: infra })).isError).toBe(true);
    for (const [key, hidden] of [[person, "jane.doe"], [secret, "ghp_"]]) {
      for (const form of ["", "?raw=1", "?download=1"]) {
        const read = await get(`/q/object/${key}${form}`);
        expect(read.status).toBe(200);
        expect(JSON.stringify(read.body)).not.toContain(hidden);
      }
      const viaMcp = await mcp("read_task_object", { key });
      expect(viaMcp.isError).toBe(false);
      expect(JSON.stringify(viaMcp)).not.toContain(hidden);
    }
    const fine = await mcp("read_task_object", { key: code });
    expect(fine.isError).toBe(false);
    expect(fine.content[0].text).toContain("@dataclass");
    expect(JSON.parse(fine.content[0].text).review_state).toBe("unreviewed");
    const list = await get("/q/objects?limit=100&source_kinds=knowledge_noun");
    expect(list.body.objects.map((o) => o.object_key)).not.toContain(infra);
  });
});

describe("removed and restricted Task Objects, and rows other routes show", () => {
  it("a removed object is gone by every route; a restricted newest version closes the older ones", async () => {
    const gone = await row(unique("gone"), { tombstoned: 1 });
    expect((await get(`/q/object/${gone}`)).status).toBe(404);
    expect((await get(`/q/search?q=${gone}&include_payload=1&record_demand=0`)).body.results.map((r) => r.id)).not.toContain(gone);
    const held = unique("held");
    await row(held);
    await db.prepare("UPDATE herma_task_objects SET version_num = 1 WHERE object_key = ?").bind(held).run();
    await db.prepare(`INSERT INTO herma_task_objects (object_key, version_num, category, visibility, producer_agent, summary, payload_json, sha256_hash, simhash64_hex, lsh_band_0, verification_verdict, created_at)
      VALUES (?, 2, 'knowledge_noun', 'server_infra', 'test-maker', 'later', '{}', ?, 'aaaaaaaaaaaaaaaa', 'aaaa', '', ?)`).bind(held, `sha2-${held}`, new Date().toISOString()).run();
    expect((await get(`/q/object/${held}`)).status).toBe(403);
    expect((await get(`/q/object/${held}?version=1`)).status).toBe(403);
  });

  it("every route that shows stored rows replaces personal data", async () => {
    const hidden = await row(unique("hidden"), { summary: "write to bob.child@gmail.com", payload: { note: "open" } });
    expect(JSON.stringify((await get(`/q/object/${hidden}`)).body)).not.toContain("bob.child");
    const list = await get("/q/pulse");
    expect(JSON.stringify(list.body)).not.toContain("bob.child");
    const permalink = await call(new Request(`https://shim.teleionlabs.com/c/${hidden}?format=json`, { headers: { accept: "application/json" } }));
    expect(await permalink.text()).not.toContain("bob.child");
    expect((await get(`/q/graph?root=${hidden}`)).status).toBeLessThan(500);
    expect(JSON.stringify((await get(`/q/graph?root=${hidden}`)).body)).not.toContain("bob.child");
    expect(JSON.stringify((await get("/q/seeds")).body)).not.toContain("bob.child");
    expect(JSON.stringify((await get("/q/objects?limit=50")).body)).not.toContain("bob.child");
  });

  it("many kinds and a far date are a warning, not a failure", async () => {
    const many = Array.from({ length: 30 }, (_, i) => `k${i}`).join(",");
    for (const path of [`/q/objects?source_kinds=${many}`, `/q/tasks?source_kinds=${many}`, "/q/objects?updated_after=99999999999999999", "/q/search?q=x&limit=-3&record_demand=0"]) expect((await get(path)).status).toBe(200);
  });
});

describe("what review found", () => {
  it("field names don't hide credentials or personal data, and a stored map key is read", async () => {
    const key = await row(unique("fields"), { payload: { api_key: "sk-" + "a".repeat(30), secret_key: "ghp_" + "b".repeat(36), key: "ghp_" + "c".repeat(36), ref: "4111111111111111", employee_id: "123-45-6789", code: "mail jane@gmail.com SSN 123-45-6789", files: { notes: "jane@gmail.com" }, "jane.mapkey@gmail.com": "x", sha256: "ab".repeat(32), version: "1.2.3", model: "muse-spark-1.3" } });
    const text = JSON.stringify((await get(`/q/object/${key}`)).body);
    for (const hidden of ["sk-aaaa", "ghp_", "4111111111111111", "123-45-6789", "jane"]) expect(text).not.toContain(hidden);
    expect(text).toContain("ab".repeat(32));
    expect(text).toContain("muse-spark-1.3");
  });

  it("cards and addresses in common shapes are replaced; digests and ids stay", async () => {
    for (const line of ["4111 1111 1111 1111 12/28", "pay 4111 1111 1111 1111 123", "on 2025-11-04 4111 1111 1111 1111", "order 12 4111 1111 1111 1111", "4111.1111.1111.1111", "`4111 1111 1111 1111`", "card_4111111111111111", "zhang@163.com", "ivan@mail.md", "maria@empresa.com.py", "card=4111111111111111", "card_number=4111-1111-1111-1111", "SSN 123 45 6789"]) {
      const key = await row(unique("shape"), { payload: { note: line } });
      const text = JSON.stringify((await get(`/q/object/${key}`)).body.payload);
      expect(text, line).toMatch(/\[(?:card number|email|id number)\]/);
    }
    const fine = await row(unique("fine"), { payload: { note: "pkg@1.2.3 and 1793756663408 and 0.5 and a4111111111111111b" } });
    expect(JSON.stringify((await get(`/q/object/${fine}`)).body.payload)).toContain("a4111111111111111b");
  });

  it("a stranger can't read a lease from a permalink or set a Task's review", async () => {
    const who = unique("c-holder");
    const made = await (await call(new Request("https://shim.teleionlabs.com/q/enqueue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent_id: `${who}-maker`, title: "permalink lease test", prompt: "A labeled test Task for how no-key calls are read." }) }))).json();
    const taskId = made.enqueued_followup_tasks[0].task_id;
    await get(`/q/claim/${who}?task_id=${taskId}`);
    const page = await call(new Request(`https://shim.teleionlabs.com/c/${taskId}?format=json`, { headers: { accept: "application/json" } }));
    const shown = JSON.parse(await page.text());
    for (const field of ["fencing_token", "leased_by", "leased_worker_uuid"]) expect(shown.task?.[field], field).toBeUndefined();
    const peer = unique("peer");
    const sent = await call(new Request("https://shim.teleionlabs.com/q/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent_id: peer, summary: "peer", evaluations: [{ target_kind: "task", target_id: taskId, verification_verdict: "CONFIRMED", rationale: "did not read", actual_importance: 0.5, potential_importance: 0.5, estimated_priority: 50 }] }) }));
    expect(sent.status).toBeLessThan(500);
    const stored = await db.prepare("SELECT verification_verdict FROM herma_evaluations WHERE target_id = ?").bind(taskId).all();
    expect((stored.results || []).every((row) => row.verification_verdict === "UNREVIEWED")).toBe(true);
    expect((await get(`/q/task/${taskId}`)).body.review_state).toBe("unreviewed");
    expect((await get(`/q/object/x?offset=1e400`)).status).toBeLessThan(500);
    expect((await get("/q/objects?offset=1e400")).status).toBe(200);
  });

  it("MCP doesn't show a lease; a removed object is gone from its permalink; a bad number is a warning", async () => {
    const gone = await row(unique("gonec"), { tombstoned: 1, payload: { note: "removed text" } });
    const permalink = await call(new Request(`https://shim.teleionlabs.com/c/${gone}?format=json`, { headers: { accept: "application/json" } }));
    expect(await permalink.text()).not.toContain("removed text");
    for (const path of ["/q/objects?limit=abc", "/q/objects?offset=abc", "/q/tasks?limit=1.5&offset=1.5"]) expect((await get(path)).status).toBe(200);
    const who = unique("lease-holder");
    const made = await (await call(new Request("https://shim.teleionlabs.com/q/enqueue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent_id: `${who}-maker`, title: "lease test", prompt: "A labeled test Task for how no-key calls are read." }) }))).json();
    const taskId = made.enqueued_followup_tasks?.[0]?.task_id;
    expect(taskId).toBeTruthy();
    const claimed = await get(`/q/claim/${who}?task_id=${taskId}`);
    expect(claimed.status).toBe(200);
    const viaMcp = await mcp("read_task", { task_id: taskId });
    const viaHttp = await get(`/q/task/${taskId}`);
    const shownByMcp = JSON.parse(viaMcp.content[0].text);
    for (const field of ["fencing_token", "lease_epoch", "leased_worker_uuid", "leased_by"]) expect(shownByMcp.task?.[field], field).toEqual(viaHttp.body.task?.[field]);
    expect(viaMcp.content[0].text).not.toMatch(/"(?:fencing_token|lease_epoch)":\s*[1-9]/);
  });
});

describe("a client's choices", () => {
  it("reads the same names; only reviewed work when asked; a label either way", async () => {
    const reviewed = await row(unique("reviewed"), { evalCount: 2, verdict: "CONFIRMED" });
    const argued = await row(unique("argued"), { evalCount: 3, verdict: "MIXED" });
    const failed = await row(unique("failed"), { evalCount: 1, verdict: "FAIL" });
    const plain = await row(unique("plain"));
    expect(reviewStateOf({ eval_count: 1, verification_verdict: "FAIL" })).toBe("failed");
    const all = await get("/q/objects?limit=50");
    const seen = new Map(all.body.objects.map((o) => [o.object_key, o]));
    expect(seen.get(reviewed).review_state).toBe("reviewed");
    expect(seen.get(reviewed).reviewed).toBe(true);
    expect(seen.get(plain).review_state).toBe("unreviewed");
    expect(seen.get(failed).review_state).toBe("failed");
    const only = await get("/q/objects?include_unreviewed=false&limit=50");
    const onlyKeys = only.body.objects.map((o) => o.object_key);
    expect(onlyKeys).toContain(reviewed);
    expect(onlyKeys).not.toContain(plain);
    expect(onlyKeys).not.toContain(failed);
    expect(onlyKeys).not.toContain(argued);
    expect(reviewStateOf({ eval_count: 2, verification_verdict: "UNREVIEWED" })).toBe("unreviewed");
    const states = await get("/q/objects?review_state=failed&limit=50");
    expect(states.body.objects.map((o) => o.object_key)).toContain(failed);
    expect((await get(`/q/object/${plain}?include_unreviewed=false`)).body.code).toBe("not_in_chosen_review_state");
    expect((await get(`/q/object/${reviewed}?include_unreviewed=false`)).status).toBe(200);
    expect((await get("/q/objects?max_results=1")).body.objects.length).toBe(1);
    const firstPage = await get("/q/objects?max_results=1");
    expect(firstPage.body.next_offset).toBe(1);
    expect((await get(`/q/objects?max_results=1&offset=${firstPage.body.next_offset}`)).body.objects[0].object_key).not.toBe(firstPage.body.objects[0].object_key);
    const small = await get("/q/objects?max_bytes=100&limit=5");
    expect(small.body.objects.length).toBe(0);
    expect(small.body.preferences.left_out_by_max_bytes).toBeGreaterThan(0);
    expect((await get(`/q/object/${plain}?max_bytes=400`)).body.payload_left_out).toBe(true);
    const old = await get("/q/objects?updated_after=2099-01-01");
    expect(old.body.objects.length).toBe(0);
    const search = await get(`/q/search?q=${plain}&include_unreviewed=false&record_demand=0`);
    expect(search.body.results.every((r) => r.reviewed === true)).toBe(true);
    const anySearch = await get(`/q/search?q=${plain}&record_demand=0&compact=1`);
    expect(anySearch.body.results.every((r) => typeof r.review_state === "string")).toBe(true);
    const viaMcp = await mcp("search", { q: reviewed, record_demand: 0 });
    expect(viaMcp.isError).toBe(false);
    const tasks = await get("/q/tasks?limit=3");
    expect(tasks.body.tasks.every((t) => typeof t.review_state === "string")).toBe(true);
  });

  it("the shared parts behave", () => {
    expect(readClientPrefs(new URLSearchParams("include_unreviewed=no")).include_unreviewed).toBe(false);
    expect(reviewWhere(readClientPrefs({}))).toBe("");
    expect(reviewWhere(readClientPrefs({ include_unreviewed: false }))).toContain("> 0");
    const fitted = fitReply({ ok: true, lease: { id: 1 }, big: "x".repeat(500) }, 60);
    expect(fitted.big).toBeUndefined();
    expect(fitted.lease).toEqual({ id: 1 });
    expect(fitted.left_out_by_max_bytes).toEqual(["big"]);
  });

  it("a claim keeps its lease and takes source_kinds and max_bytes", async () => {
    const claim = await get(`/q/claim/${unique("claim-size")}?max_bytes=1500&source_kinds=nothing_of_this_kind`);
    expect(claim.status).toBe(200);
    expect(JSON.stringify(claim.body).length).toBeLessThan(40000);
  });
});
