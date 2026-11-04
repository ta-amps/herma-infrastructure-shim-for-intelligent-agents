// A name is only a label. The newest version on a key is what the default read returns, so only the first version's
// own worker, showing its token, or our own infrastructure may add it. Everyone else's work is kept under its own key.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import worker from "../deploy/cloudflare/worker.js";

const limits = { ...env, OPEN_WORK_LIMITS: "on" };
const call = (request) => worker.fetch(request, limits, { waitUntil() {}, passThroughOnException() {} });
const post = async (path, body) =>
  call(new Request(`https://shim.teleionlabs.com${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const unique = (name) => `${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const join = async (body) => (await post("/q/onboard", body)).json();
const save = async (agent_id, key, summary, extra = {}) =>
  post("/q/submit", { agent_id, summary, task_objects: [{ object_key: key, summary, category: "knowledge_noun", visibility: "public_commons", payload: { summary } }], ...extra });
const read = async (key) => {
  const doc = await (await call(new Request(`https://shim.teleionlabs.com/q/object/${key}`))).json();
  return doc.object ?? doc;
};
const setup = async () => {
  const name = unique("owner-agent");
  const key = unique("owner_key").replaceAll("-", "_");
  const joined = await join({ agent_id: name });
  const own = { worker_uuid: joined.worker_profile.worker_uuid, worker_token: joined.worker_token };
  expect((await save(name, key, "the owner's first version", own)).status).toBe(200);
  return { name, key, own };
};

describe("the default read of a Task Object stays with its worker", () => {
  it("the owner's token adds a version the default read returns", async () => {
    const { name, key, own } = await setup();
    const out = await (await save(name, key, "the owner's second version", own)).json();
    expect(out.stored_task_objects[0].object_key).toBe(key);
    expect(out.stored_task_objects[0].version_num).toBe(2);
    expect((await read(key)).summary).toBe("the owner's second version");
  });

  it("the name alone goes to a key of its own, with a warning, and is kept", async () => {
    const { name, key } = await setup();
    const res = await save(name, key, "only the name was sent");
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.stored_task_objects[0].object_key).toBe(`${key}__by_${name}`);
    expect(out.warnings.join(" ")).toContain("stays with the worker that made it");
    expect((await read(key)).summary).toBe("the owner's first version");
    expect((await read(`${key}__by_${name}`)).summary).toBe("only the name was sent");
  });

  it("the public worker id with the name doesn't count as proof", async () => {
    const { name, key, own } = await setup();
    await save(name, key, "the id but no token", { worker_uuid: own.worker_uuid });
    expect((await read(key)).summary).toBe("the owner's first version");
  });

  it("a new worker started under the same name, with its own good token, doesn't replace it", async () => {
    const { name, key } = await setup();
    const minted = await join({ agent_id: name, mint_new: true });
    expect(minted.worker_token).toBeTruthy();
    const out = await (await save(name, key, "a fresh worker with the same name", { worker_uuid: minted.worker_profile.worker_uuid, worker_token: minted.worker_token })).json();
    expect(out.stored_task_objects[0].object_key).toBe(`${key}__by_${name}`);
    expect((await read(key)).summary).toBe("the owner's first version");
  });

  it("a busier worker started under the name can't lock the owner out of its token-only calls", async () => {
    const { name, key, own } = await setup();
    const minted = await join({ agent_id: name, mint_new: true });
    const mintedAuth = { worker_uuid: minted.worker_profile.worker_uuid, worker_token: minted.worker_token };
    for (let i = 0; i < 3; i++) await save(name, `${key}_other_${i}`, "busy work", mintedAuth);
    const res = await save(name, key, "the owner, token only", { worker_token: own.worker_token });
    expect(res.status).toBe(200);
    expect((await res.json()).stored_task_objects[0].object_key).toBe(key);
    expect((await read(key)).summary).toBe("the owner, token only");
    expect((await save(name, key, "a wrong token", { worker_token: `wt_${"0".repeat(32)}` })).status).toBe(403);
  });

  it("an object made with no token can't be replaced by its name either", async () => {
    const name = unique("nameonly-agent");
    const key = unique("nameonly_key").replaceAll("-", "_");
    await save(name, key, "made with only a name");
    const out = await (await save(name, key, "the same name again")).json();
    expect(out.stored_task_objects[0].object_key).toBe(`${key}__by_${name}`);
    expect((await read(key)).summary).toBe("made with only a name");
  });
});

describe("self_seed is not a page", () => {
  it("/c/self_seed goes to the dashboard, and a submit's Task link opens the work", async () => {
    const out = await call(new Request("https://shim.teleionlabs.com/c/self_seed", { redirect: "manual" }));
    expect(out.status).toBe(302);
    expect(out.headers.get("location")).toBe("/dashboard");
    const key = unique("self_seed_link").replaceAll("-", "_");
    const body = await (await save(unique("link-agent"), key, "a link test")).json();
    expect(body.task_permalink).toContain(`/c/${key}`);
  });
});

describe("other ways at a key, from the independent review", () => {
  const seedTask = async (tag) => {
    const made = await (await post("/q/enqueue", { agent_id: unique("req"), title: `labeled test ${tag}`, prompt: `Please do ${tag} with care and report back in a few plain lines.` })).json();
    return made.enqueued_followup_tasks[0].task_id;
  };

  it("another worker with the same name can't finish a lease with no fence", async () => {
    const { name, own } = await setup();
    const tid = await seedTask(unique("lease"));
    const claim = await post("/q/claim", { agent_id: name, task_id: tid, ...own });
    expect(claim.status).toBe(200);
    const minted = await join({ agent_id: name, mint_new: true });
    const out = await post("/q/submit", { agent_id: name, worker_token: minted.worker_token, task_id: tid, summary: "not the holder" });
    expect(out.status).toBe(409);
  });

  it("a malformed worker id with a same-name token doesn't count as the owner", async () => {
    const { name, key, own } = await setup();
    for (let i = 0; i < 2; i++) await save(name, `${key}_o${i}`, "busy", own);
    const minted = await join({ agent_id: name, mint_new: true });
    await save(name, key, "someone else", { worker_uuid: "___", worker_token: minted.worker_token });
    expect((await read(key)).summary).toBe("the owner's first version");
  });

  it("an upload to a key that's there keeps its own key", async () => {
    const { key } = await setup();
    const res = await call(new Request(`https://shim.teleionlabs.com/q/upload?object_key=${key}&agent_id=${unique("up")}&summary=other`, { method: "POST", headers: { "content-type": "text/plain" }, body: "some bytes" }));
    expect(res.status).toBeLessThan(300);
    expect((await read(key)).summary).toBe("the owner's first version");
  });

  it("a token taken later for an id that has rows but no registration doesn't prove anything", async () => {
    const key = unique("ckey").replaceAll("-", "_");
    const id = `w_someone_else_${Math.floor(Math.random() * 1e9)}`;
    await call(new Request(`https://shim.teleionlabs.com/q/upload?object_key=${key}&agent_id=${unique("alice")}&worker_uuid=${id}&summary=first`, { method: "POST", headers: { "content-type": "text/plain" }, body: "some bytes" }));
    const before = (await read(key)).summary;
    const name = unique("later");
    const joined = await join({ agent_id: name, worker_uuid: id });
    await save(name, key, "someone else", { worker_uuid: id, worker_token: joined.worker_token });
    expect((await read(key)).summary).toBe(before);
  });

  it("a long name can't cut the fallback key back onto the real key", async () => {
    const name = unique("owner-agent");
    const joined = await join({ agent_id: name });
    const own = { worker_uuid: joined.worker_profile.worker_uuid, worker_token: joined.worker_token };
    const agent = `t${Date.now()}abcdefghijklmnopqrstuvwxyz0123456789abcdefghij`.slice(0, 48);
    const longKey = `${"L".repeat(70)}${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}_${"m".repeat(100)}${agent}`;
    const real = (await (await save(name, longKey, "the owner's", own)).json()).stored_task_objects[0].object_key;
    const out = await (await save(agent, real, "someone else")).json();
    expect(out.stored_task_objects[0].object_key).not.toBe(real);
    expect((await read(real)).summary).toBe("the owner's");
  });

  it("a key that looks like a fallback key stays with its worker", async () => {
    const name = unique("owner-agent");
    const joined = await join({ agent_id: name });
    const own = { worker_uuid: joined.worker_profile.worker_uuid, worker_token: joined.worker_token };
    const stem = unique("stem").replaceAll("-", "_");
    const lookalike = `${stem}__by_bob`;
    await save(name, lookalike, "the owner's", own);
    await save(unique("other"), stem, "someone's stem");
    await save("bob", stem, "someone else");
    expect((await read(lookalike)).summary).toBe("the owner's");
  });

  it("a first row can't hide what a key reads through an alias", async () => {
    const target = unique("target").replaceAll("-", "_");
    const alias = unique("alias").replaceAll("-", "_");
    await save(unique("real"), target, "the real one");
    await env.HERMA_DB.prepare("INSERT INTO herma_object_aliases (alias_key, target_object_key, created_at) VALUES (?, ?, ?)").bind(alias, target, new Date().toISOString()).run();
    const out = await (await save(unique("other"), alias, "someone else")).json();
    expect(out.stored_task_objects[0].object_key).not.toBe(alias);
    expect((await read(alias)).summary).toBe("the real one");
  });

  it("a worker made busiest under a tokenless name can't take that name's new keys", async () => {
    const name = unique("tokenless");
    await save(name, unique("old").replaceAll("-", "_"), "early");
    const minted = await join({ agent_id: name, mint_new: true });
    const auth = { worker_uuid: minted.worker_profile.worker_uuid, worker_token: minted.worker_token };
    for (let i = 0; i < 4; i++) await save(name, unique("busy").replaceAll("-", "_"), "busy", auth);
    const key = unique("newkey").replaceAll("-", "_");
    await save(name, key, "the tokenless worker's own");
    await save(name, key, "someone else", auth);
    expect((await read(key)).summary).toBe("the tokenless worker's own");
  });

  it("the owner's token and its worker id still work across a lease and a replay", async () => {
    const { name, key, own } = await setup();
    const idem = unique("idem");
    const first = await (await save(name, key, "v2", { ...own, idempotency_key: idem })).json();
    const again = await (await save(name, key, "v2", { ...own, idempotency_key: idem })).json();
    expect(first.stored_task_objects[0].version_num).toBe(2);
    expect(again.idempotent_replay).toBe(true);
    expect((await read(key)).summary).toBe("v2");
  });
});

describe("from the second independent review", () => {
  const up = (qs, body = "some bytes") =>
    call(new Request(`https://shim.teleionlabs.com/q/upload?${qs}`, { method: "POST", headers: { "content-type": "application/octet-stream" }, body }));
  const key = (name) => unique(name).replaceAll("-", "_");
  const task = async () =>
    (await (await post("/q/enqueue", { agent_id: unique("req"), title: `labeled ${unique("t")}`, prompt: `Please do ${unique("x")} with care and report back in a few plain lines.` })).json()).enqueued_followup_tasks[0].task_id;

  it("a fallback key a token holder made resists the same name", async () => {
    const k = key("o");
    await save(unique("first"), k, "FIRST");
    const name = unique("bob");
    const j = await join({ agent_id: name });
    await save(name, k, "BOB", { worker_uuid: j.worker_profile.worker_uuid, worker_token: j.worker_token });
    await save(name, k, "SOMEONE");
    expect((await read(`${k}__by_${name}`)).summary).toBe("BOB");
  });

  it("an older row with a token taken later for its worker id stays put, and an older real owner still works", async () => {
    const k = key("legacy");
    const id = `w_legacy_${Math.floor(Math.random() * 1e9)}`;
    await up(`object_key=${k}&agent_id=alice&worker_uuid=${id}&summary=FIRST`);
    await env.HERMA_DB.prepare("UPDATE herma_task_objects SET created_at='2026-11-01T00:00:00.000Z' WHERE object_key=?").bind(k).run();
    const later = unique("later");
    const j = await join({ agent_id: later, worker_uuid: id });
    await save(later, k, "SOMEONE", { worker_uuid: id, worker_token: j.worker_token });
    expect((await read(k)).summary).toBe("FIRST");

    const name = unique("n");
    const own = await join({ agent_id: name });
    const auth = { worker_uuid: own.worker_profile.worker_uuid, worker_token: own.worker_token };
    const k2 = key("lg");
    await save(name, k2, "V1", auth);
    await env.HERMA_DB.prepare("UPDATE herma_task_objects SET labels_json='[]', created_at='2026-11-02T00:00:00.000Z' WHERE object_key=?").bind(k2).run();
    await env.HERMA_DB.prepare("UPDATE herma_worker_registry SET created_at='2026-11-01T00:00:00.000Z' WHERE worker_uuid=?").bind(auth.worker_uuid).run();
    await save(name, k2, "V2", auth);
    expect((await read(k2)).summary).toBe("V2");
  });

  it("an upload can't hide an alias or a Task", async () => {
    const t = key("t");
    const a = key("a");
    await save(unique("r"), t, "REAL");
    await env.HERMA_DB.prepare("INSERT INTO herma_object_aliases (alias_key, target_object_key, created_at) VALUES (?, ?, ?)").bind(a, t, new Date().toISOString()).run();
    await up(`object_key=${a}&agent_id=m&summary=SOMEONE`);
    expect((await read(a)).summary).toBe("REAL");
    const v = await task();
    await up(`object_key=${v}&agent_id=m&summary=SOMEONE`);
    expect((await read(v)).resolved_kind).toBe("durable_task_cross_resolved");
  });

  it("a submit can't hide a Task", async () => {
    const v = await task();
    await save(unique("m"), v, "SOMEONE");
    expect((await read(v)).resolved_kind).toBe("durable_task_cross_resolved");
  });

  it("the same bytes uploaded by someone else don't change another agent's upload key", async () => {
    const { key: k } = await setup();
    const a = await (await up(`object_key=${k}&agent_id=${unique("up-a")}&summary=A`, "same bytes")).json();
    const b = await (await up(`object_key=${k}&agent_id=${unique("up-b")}&summary=B`, "same bytes")).json();
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    const ka = a.registered_object?.object_key ?? a.object_key;
    if (ka) expect((await read(ka)).summary).toBe("A");
  });

  it("a label that only contains the words, or comes from an upload, doesn't pass as made with a token", async () => {
    const name = unique("forger");
    const j = await join({ agent_id: name });
    const auth = { worker_uuid: j.worker_profile.worker_uuid, worker_token: j.worker_token };
    const k = key("forge");
    await up(`object_key=${k}&agent_id=${name}&worker_uuid=${auth.worker_uuid}&summary=FIRST&category=made_with_worker_token:true`);
    const row = await env.HERMA_DB.prepare("SELECT labels_json FROM herma_task_objects WHERE object_key=?").bind(k).first();
    expect(JSON.parse(row.labels_json)).not.toContain("made_with_worker_token:true");
  });

  it("a page's text is filtered in the shared shell, and a dashboard row with self_seed opens the worker's page", async () => {
    const name = unique("dash");
    const res = await save(name, key("d"), "a page test");
    expect(res.status).toBe(200);
    const body = await res.json();
    const worker_uuid = body.stored_task_objects[0].worker_uuid;
    expect(body.task_permalink).toContain("/c/");
    const none = await (await post("/q/submit", { agent_id: unique("nobj"), summary: "a summary with no object, a test" })).json();
    expect(none.contribution_permalink ?? "").toMatch(/\/(w|c)\//);
    const html = await (await call(new Request("https://shim.teleionlabs.com/dashboard"))).text();
    expect(html).not.toContain('href="/c/self_seed"');
    expect(worker_uuid).toBeTruthy();
  });

  describe("a submit answered busy after its object was stored", () => {
    const ready = async () => {
      const name = unique("retry-agent");
      const key = unique("retry_key").replaceAll("-", "_");
      const task = `verb_ngo_retry_${unique("t").replaceAll("-", "_")}`;
      await env.HERMA_DB.prepare("INSERT INTO herma_durable_queue (task_id, tier, visibility, priority, title, prompt, simhash64_hex, producer_agent, created_at, updated_at) VALUES (?, 'public_general', 'public_commons', 50, 'Retry test', 'Write one line.', '0', 'retry-test', ?, ?)").bind(task, new Date().toISOString(), new Date().toISOString()).run();
      const claimed = await (await post("/q/claim", { agent_id: name, task_id: task })).json();
      const fence = claimed.lease.fencing_token;
      const body = { agent_id: name, task_id: task, fencing_token: fence, summary: "the work", task_objects: [{ object_key: key, summary: "the work", category: "ngo_public_good", payload: { full: "the full work" } }] };
      return { name, key, task, fence, body };
    };
    const rows = async (key) => (await env.HERMA_DB.prepare("SELECT object_key, version_num FROM herma_task_objects WHERE requested_object_key = ?").bind(key).all()).results;
    const plantHalfDone = async ({ name, key, task, body }) => {
      // Only the first step of a submit that then failed: its object row, with the Task still open.
      const raw = JSON.stringify(body.task_objects[0].payload);
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)))].map((b) => b.toString(16).padStart(2, "0")).join("");
      await env.HERMA_DB.prepare("INSERT INTO herma_task_objects (object_key, requested_object_key, version_num, category, visibility, producer_agent, source_task_id, summary, payload_json, simhash64_hex, sha256_hash, created_at, worker_uuid, labels_json) VALUES (?, ?, 1, 'ngo_public_good', 'public_commons', ?, ?, 'the work', ?, '0', ?, ?, ?, '[]')").bind(key, key, name, task, raw, hash, new Date().toISOString(), `w_agent_${name}`).run();
    };

    it("the same bytes sent again keep the key, add no row, and close the Task", async () => {
      const r = await ready();
      await plantHalfDone(r);
      const res = await post("/q/submit", r.body);
      expect(res.status).toBe(200);
      const out = await res.json();
      expect(out.stored_task_objects[0].object_key).toBe(r.key);
      expect(out.stored_task_objects[0].version_num).toBe(1);
      expect(out.warnings || []).toEqual([]);
      expect(await rows(r.key)).toHaveLength(1);
      const task = await env.HERMA_DB.prepare("SELECT state FROM herma_durable_queue WHERE task_id = ?").bind(r.task).first();
      expect(task.state).toBe("done");
    });

    it("different bytes on the same Task still go to a key of their own", async () => {
      const r = await ready();
      await plantHalfDone(r);
      const changed = { ...r.body, task_objects: [{ ...r.body.task_objects[0], payload: { full: "other work" } }] };
      const out = await (await post("/q/submit", changed)).json();
      expect(out.stored_task_objects[0].object_key).toBe(`${r.key}__by_${r.name}`);
      expect(await rows(r.key)).toHaveLength(2);
    });

    it("another worker sending the same bytes doesn't take the key", async () => {
      const r = await ready();
      await plantHalfDone({ ...r, name: unique("first-maker") });
      const out = await (await post("/q/submit", r.body)).json();
      expect(out.stored_task_objects[0].object_key).toBe(`${r.key}__by_${r.name}`);
    });
  });

  it("broken JSON on a submit says nothing was saved and not to shorten the work", async () => {
    const res = await call(new Request("https://shim.teleionlabs.com/q/submit", { method: "POST", headers: { "content-type": "application/json" }, body: '{"agent_id":"a"}}' }));
    expect(res.status).toBe(400);
    const out = await res.json();
    expect(out.code).toBe("invalid_json");
    expect(out.detail).toContain("Do not shorten");
  });
});
