// Claimed agent names (owner, Nov 6, round 3 item 4): a new name is claimed by its first write and gets a worker_token
// once; a write under a claimed name needs the token (header, field or ?wt=); a wrong or missing token gets 409
// agent_id_claimed with a fresh ID; bare names are not accepted as new IDs; older names are claimed by their next write
// with 48 hours of grace; the hub hello and reply follow the same rule; pages and logs never show the token.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../deploy/cloudflare/worker.js";
import { isBareAgentName, keyAgentId, signedMessage, suggestAgentId, verifyAgentSignature, sha256Hex } from "../deploy/cloudflare/agent_names.js";

const BASE = "https://shim.teleionlabs.com";
const ctx = { waitUntil() {}, passThroughOnException() {} };
const on = { ...env, AGENT_NAME_CLAIMS: "on" };
const call = (path, init = {}) => worker.fetch(new Request(BASE + path, init), on, ctx);
const post = (path, body, headers = {}) => call(path, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", ...headers }, body: JSON.stringify(body) });
const uid = (p) => `${p}-${crypto.randomUUID().slice(0, 8)}1`;

describe("claimed agent names", { timeout: 180000 }, () => {
  it("the first write claims a new name and shows the token once; later writes need it", async () => {
    const name = uid("names-owner");
    const first = await post("/q/claim", { agent_id: name });
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.agent_claim.claimed).toBe(true);
    expect(body.agent_claim.shown_once).toBe(true);
    const token = body.agent_claim.worker_token;
    expect(token).toMatch(/^wt_[0-9a-f]{32}$/);
    expect(body.worker_token).toBe(token);

    // For 15 minutes a write without the token still works, with a reminder; a wrong token never does.
    const soon = await post("/q/claim", { agent_id: name });
    expect(soon.status).toBe(200);
    expect((await soon.json()).agent_id_notice.code).toBe("send_your_worker_token");
    await env.HERMA_DB.prepare("UPDATE herma_agent_claims SET grace_until = '2000-01-01T00:00:00.000Z' WHERE agent_id = ?").bind(name).run();
    const again = await post("/q/claim", { agent_id: name });
    expect(again.status).toBe(409);
    const refused = await again.json();
    expect(refused.code).toBe("agent_id_claimed");
    expect(refused.next.suggested_agent_id).toMatch(new RegExp(`^${name}-[0-9a-f]{6}$`));
    expect(refused.next.make_one).toContain("/q/onboard?agent_id=");
    expect(JSON.stringify(refused)).not.toContain(token);

    const wrong = await post("/q/claim", { agent_id: name, worker_token: "wt_" + "0".repeat(32) });
    expect(wrong.status).toBe(409);
    expect((await wrong.json()).code).toBe("agent_id_claimed");

    for (const res of [
      await post("/q/claim", { agent_id: name, worker_token: token }),
      await post("/q/claim", { agent_id: name }, { "x-worker-token": token }),
      await post("/q/claim", { agent_id: name }, { "x-herma-worker-token": token }),
      await call(`/q/claim/${name}?wt=${token}`, { headers: { accept: "application/json" } }),
    ]) {
      expect(res.status).toBe(200);
      const out = await res.json();
      expect(out.agent_claim).toBeUndefined(); // shown once only
      expect(JSON.stringify(out)).not.toContain(token);
    }
    // A URL form without the token does not act as the owner.
    expect((await call(`/q/claim/${name}`, { headers: { accept: "application/json" } })).status).toBe(409);
  });

  it("the other test ID cannot write as the claimed one, and the release route is covered too", async () => {
    const owner = uid("names-a");
    const other = uid("names-b");
    const a = await (await post("/q/claim", { agent_id: owner })).json();
    const b = await (await post("/q/claim", { agent_id: other })).json();
    expect(a.agent_claim.worker_token).not.toBe(b.agent_claim.worker_token);
    const asOwner = await post("/q/claim", { agent_id: owner, worker_token: b.agent_claim.worker_token });
    expect(asOwner.status).toBe(409);
    await env.HERMA_DB.prepare("UPDATE herma_agent_claims SET grace_until = '2000-01-01T00:00:00.000Z' WHERE agent_id = ?").bind(owner).run();
    const release = await post("/q/release", { agent_id: owner, task_id: "verb_none_here" });
    expect(release.status).toBe(409);
    expect((await release.json()).code).toBe("agent_id_claimed");
  });

  it("a bare name is not accepted as a new ID; the reply gives a ready ID that works", async () => {
    expect(isBareAgentName("Muse")).toBe(true);
    expect(isBareAgentName("codex")).toBe(true);
    expect(isBareAgentName("myagent")).toBe(true); // 7 characters, no digit
    expect(isBareAgentName("muse-herma-worker")).toBe(true); // a copied placeholder
    expect(isBareAgentName("opencode-muse-3f9a1c")).toBe(false);
    expect(suggestAgentId("muse")).toMatch(/^muse-[0-9a-f]{6}$/);
    const bare = `zq${crypto.randomUUID().slice(0, 4).replace(/\d/g, "x")}`; // short, no digit, never used
    const res = await post("/q/claim", { agent_id: bare });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("agent_id_too_common");
    const ready = body.next.suggested_agent_id;
    expect(ready).toMatch(new RegExp(`^${bare}-[0-9a-f]{6}$`));
    const used = await post("/q/claim", { agent_id: ready });
    expect(used.status).toBe(200);
    expect((await used.json()).agent_claim.agent_id).toBe(ready);
  });

  it("an older name with history is claimed by its next write, with 48 hours of grace", async () => {
    const name = uid("names-legacy");
    const now = new Date().toISOString();
    await post("/q/pulse", {}); // the schema exists
    await env.HERMA_DB.prepare(
      "INSERT INTO herma_worker_registry (worker_uuid, agent_id, persona_id, persona_label, specialty_lens, created_at, updated_at) VALUES (?, ?, 'p', 'P', 'lens', ?, ?)"
    ).bind(`w_legacy_${crypto.randomUUID().slice(0, 8)}`, name, now, now).run();
    const first = await (await post("/q/claim", { agent_id: name })).json();
    expect(first.agent_claim.worker_token).toBeTruthy();
    expect(first.agent_claim.grace_until).toBeTruthy();
    const noToken = await post("/q/claim", { agent_id: name });
    expect(noToken.status).toBe(200);
    expect((await noToken.json()).agent_id_notice.code).toBe("send_your_worker_token");
    const wrong = await post("/q/claim", { agent_id: name, worker_token: "wt_" + "1".repeat(32) });
    expect(wrong.status).toBe(409);
    // After the grace, a write without the token is refused.
    await env.HERMA_DB.prepare("UPDATE herma_agent_claims SET grace_until = '2000-01-01T00:00:00.000Z' WHERE agent_id = ?").bind(name).run();
    expect((await post("/q/claim", { agent_id: name })).status).toBe(409);
  });

  it("a worker_token from /q/onboard is the one token for its name", async () => {
    const name = uid("names-onboard");
    const joined = await (await post("/q/onboard", { agent_id: name, mint_new: true })).json();
    const token = joined.worker_token;
    expect(token).toBeTruthy();
    expect(joined.agent_claim?.worker_token ?? token).toBe(token);
    expect((await post("/q/claim", { agent_id: name, worker_token: token })).status).toBe(200);
    await env.HERMA_DB.prepare("UPDATE herma_agent_claims SET grace_until = '2000-01-01T00:00:00.000Z' WHERE agent_id = ?").bind(name).run();
    expect((await post("/q/claim", { agent_id: name })).status).toBe(409);
  });

  it("every name field and every write route is covered (review of item 4, H1 and H2)", async () => {
    const name = uid("names-alias");
    const token = (await (await post("/q/claim", { agent_id: name })).json()).agent_claim.worker_token;
    await env.HERMA_DB.prepare("UPDATE herma_agent_claims SET grace_until = '2000-01-01T00:00:00.000Z' WHERE agent_id = ?").bind(name).run();
    const tries = [
      ["/q/onboard", { worker: name }],
      ["/q/submit", { worker: name, task_id: "self_seed", summary: "A note under a name that is not mine" }],
      ["/q/submit", { worker_id: name, task_id: "self_seed", summary: "A note under a name that is not mine" }],
      ["/q/objects", { worker: name, object_key: "names_alias_probe_v1", payload: { a: 1 } }],
      ["/q/object", { agent_id: name, object_key: "names_alias_probe_v2", payload: { a: 1 } }],
      ["/q/feedback", { agent_id: name, summary: "feedback under a name that is not mine" }],
      ["/q/reprioritize", { actor_agent_id: name, task_id: "verb_none_here", priority: 1 }],
      ["/q/chat", { user: name, message: "Claim a task" }],
    ];
    for (const [path, body] of tries) {
      const res = await post(path, body);
      expect(res.status, path + JSON.stringify(body)).toBe(409);
      expect((await res.json()).code).toBe("agent_id_claimed");
    }
    expect((await call(`/q/release/${name}/verb_none_here`, { headers: { accept: "application/json" } })).status).toBe(409);
    // With the token the same write goes through the gate.
    expect((await post("/q/submit", { worker: name, task_id: "self_seed", summary: "A note under my own name", worker_token: token })).status).not.toBe(409);
    // A hub message sent under a claimed name needs the token too.
    const inbox = await post("/bridge/names-hub/inbox", { sender: name, target_agent: "teleion-warm-agent", prompt: "a question" });
    expect(inbox.status).toBe(409);
  });

  it("round 2: a decoy field, a gzip body, a form body, a w_ name and the inbox URL form are all checked", async () => {
    const name = uid("names-decoy");
    const token = (await (await post("/q/claim", { agent_id: name })).json()).agent_claim.worker_token;
    await env.HERMA_DB.prepare("UPDATE herma_agent_claims SET grace_until = '2000-01-01T00:00:00.000Z' WHERE agent_id = ?").bind(name).run();
    const decoy = uid("names-decoy-other");
    for (const body of [{ producer_agent: decoy, worker: name }, { agent_id: decoy, worker: name, task_id: "self_seed", summary: "decoy try" }]) {
      const res = await post("/q/submit", body);
      expect(res.status, JSON.stringify(body)).toBe(409);
    }
    expect((await call(`/q/onboard?producer_agent=${decoy}&worker=${name}`, { headers: { accept: "application/json" } })).status).toBe(409);
    const gz = new Response(new Blob([JSON.stringify({ agent_id: name, task_id: "self_seed", summary: "gzip try" })]).stream().pipeThrough(new CompressionStream("gzip")));
    const gzRes = await call("/q/submit", { method: "POST", headers: { "content-type": "application/json", "content-encoding": "gzip", accept: "application/json" }, body: await gz.arrayBuffer() });
    expect(gzRes.status).toBe(409);
    const form = await call("/q/feedback", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: `agent_id=${name}&summary=form+try` });
    expect(form.status).toBe(409);
    // Feedback about a claimed agent (producer_agent) from another sender is not a write as that agent (round 3).
    const about = await post("/q/feedback", { agent_id: uid("names-reporter"), producer_agent: name, summary: "a report about another agent" });
    expect(about.status).not.toBe(409);
    // A write that names many different agents is refused with a plain reason.
    const many = { agent_id: uid("m1"), agent: uid("m2"), worker: uid("m3"), worker_id: uid("m4"), user: uid("m5"), sender: uid("m6"), actor_agent_id: uid("m7"), task_id: "self_seed", summary: "many names" };
    const manyRes = await post("/q/submit", many);
    expect(manyRes.status).toBe(400);
    expect((await manyRes.json()).code).toBe("too_many_agent_names");
    // A w_ name with no registered worker is still checked as a name.
    const wname = `w_names_${crypto.randomUUID().slice(0, 6).replace(/-/g, "")}1`;
    const wtoken = (await (await post("/q/claim", { agent_id: wname })).json()).agent_claim?.worker_token;
    expect(wtoken).toMatch(/^wt_/);
    await env.HERMA_DB.prepare("UPDATE herma_agent_claims SET grace_until = '2000-01-01T00:00:00.000Z' WHERE agent_id = ?").bind(wname).run();
    expect((await post("/q/submit", { agent_id: wname, task_id: "self_seed", summary: "w_ try" })).status).toBe(409);
    expect((await call(`/bridge/names-hub/inbox/${name}/a-question?format=json`, { headers: { accept: "application/json" } })).status).toBe(409);
    expect((await call(`/bridge/names-hub/inbox/${name}/a-question?format=json&wt=${token}`, { headers: { accept: "application/json" } })).status).toBe(200);
  });

  it("a first write that fails gives its claim back", async () => {
    const name = uid("names-failed");
    const bad = await post("/q/submit", { agent_id: name, task_id: "verb_no_such_task_zz", summary: "x" });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(await bad.json())).not.toMatch(/wt_[0-9a-f]{32}/);
    expect(await env.HERMA_DB.prepare("SELECT 1 FROM herma_agent_claims WHERE agent_id = ?").bind(name).first()).toBeNull();
    const ok = await post("/q/claim", { agent_id: name });
    expect((await ok.json()).agent_claim.worker_token).toMatch(/^wt_/);
  });

  it("the hub: a bare hello gets a suffix, a new name gets its token once, and a reply needs it", async () => {
    const bare = await call("/bridge/names-hub/hello/muse?format=json", { headers: { accept: "application/json" } });
    expect(bare.status).toBe(200);
    const b = await bare.json();
    expect(b.renamed_from).toBe("muse");
    expect(b.agent_name).toMatch(/^muse-[0-9a-f]{6}$/);
    expect(b.agent_claim.worker_token).toMatch(/^wt_/);
    expect(b.reply_url_template).toContain(`/reply/${b.agent_name}/`);

    const name = uid("names-hub");
    const hello = await (await call(`/bridge/names-hub/hello/${name}?format=json`, { headers: { accept: "application/json" } })).json();
    const token = hello.agent_claim.worker_token;
    await env.HERMA_DB.prepare("UPDATE herma_agent_claims SET grace_until = '2000-01-01T00:00:00.000Z' WHERE agent_id = ?").bind(name).run();
    const second = await call(`/bridge/names-hub/hello/${name}?format=json`, { headers: { accept: "application/json" } });
    expect(second.status).toBe(409);
    const reply = { agent: name, turn_tag: "t1", summary: "Split it in three steps.", subtasks: ["a"], generated_tasks: [] };
    const noToken = await post("/bridge/names-hub/reply", reply);
    expect(noToken.status).toBe(409);
    expect((await noToken.json()).code).toBe("agent_id_claimed");
    const withToken = await post("/bridge/names-hub/reply", { ...reply, worker_token: token });
    expect(withToken.status).toBe(200);
    const viaUrl = await call(`/bridge/names-hub/reply/${name}/t2/ack-online?wt=${token}`, { headers: { accept: "text/plain" } });
    expect(viaUrl.status).toBe(200);
  });

  it("pages say claimed, first seen and signed, and no page, log or error shows a token", async () => {
    const name = uid("names-page");
    const first = await (await post("/q/submit", { agent_id: name, task_id: "self_seed", summary: "A note for the page test", task_objects: [{ object_key: `${name.replace(/-/g, "_")}_v1`, summary: "Page note", payload: { a: 1 } }] })).json();
    const token = first.agent_claim?.worker_token;
    expect(token).toBeTruthy();
    const json = await (await call(`/c/agent/${name}?format=json`)).json();
    expect(json.identity.claimed).toBe(true);
    expect(json.identity.signed).toBe(false);
    expect(json.identity.first_seen_at).toBeTruthy();
    const html = await (await call(`/c/agent/${name}`)).text();
    expect(html).toContain("Claimed: yes");
    const text = await (await call(`/c/agent/${name}.txt`)).text();
    expect(text).toContain("Claimed: yes.");
    for (const page of [JSON.stringify(json), html, text]) expect(page).not.toContain(token);
    await post("/q/claim", { agent_id: name }, { "x-worker-token": token });
    await call(`/q/claim/${name}?wt=${token}`);
    const logs = await env.HERMA_DB.prepare("SELECT path, detail_json FROM herma_gateway_trace_log WHERE agent_id = ?").bind(name).all();
    expect(JSON.stringify(logs.results)).not.toContain(token);
    const stored = await env.HERMA_DB.prepare("SELECT * FROM herma_agent_claims WHERE agent_id = ?").bind(name).first();
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored.token_sha256).toBe(await sha256Hex(token));
  });

  it("the off switch leaves older behavior alone (the older tests run with it)", async () => {
    const name = uid("names-off");
    const off = (path, init) => worker.fetch(new Request(BASE + path, init), { ...env, AGENT_NAME_CLAIMS: "off" }, ctx);
    const init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent_id: name }) };
    const one = await (await off("/q/claim", init)).json();
    expect(one.agent_claim).toBeUndefined();
    expect((await off("/q/claim", init)).status).toBe(200);
  });
});

describe("signed identity (follow-up design, helpers only)", () => {
  it("derives key-<16 hex> and checks a signature over method, path, time and body, with 5 minutes of skew", async () => {
    const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    const pub = btoa(String.fromCharCode(...raw));
    expect(await keyAgentId(pub)).toMatch(/^key-[0-9a-f]{16}$/);
    const ts = Math.floor(Date.now() / 1000);
    const body = '{"agent_id":"x"}';
    const msg = new TextEncoder().encode(signedMessage("post", "/q/claim", String(ts), await sha256Hex(body)));
    const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, msg))));
    expect(await verifyAgentSignature({ publicKeyB64: pub, method: "POST", path: "/q/claim", timestamp: ts, body, signatureB64: sig })).toBe(true);
    expect(await verifyAgentSignature({ publicKeyB64: pub, method: "POST", path: "/q/claim", timestamp: ts, body: body + " ", signatureB64: sig })).toBe(false);
    expect(await verifyAgentSignature({ publicKeyB64: pub, method: "POST", path: "/q/submit", timestamp: ts, body, signatureB64: sig })).toBe(false);
    expect(await verifyAgentSignature({ publicKeyB64: pub, method: "POST", path: "/q/claim", timestamp: ts, body, signatureB64: sig, nowSeconds: ts + 301 })).toBe(false);
    expect(await verifyAgentSignature({ publicKeyB64: "not-a-key", method: "POST", path: "/q/claim", timestamp: ts, body, signatureB64: sig })).toBe(false);
  });
});
