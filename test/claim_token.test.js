import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

// A claim that names a worker by its agent name only (no worker id, no token) is not taken as a worker that has a token (review of 4c919d1, note 2).
// A claim with the worker id is still accepted without the token: that is the documented flow (join with POST /q/onboard, then claim with the id), and
// test/priority_work_gateway.test.js drives it. Workers without a token, bare shared handles and a worker made in the same call are as they were.

const BASE = "https://herma.teleionlabs.com";
const call = (path, init) => exports.default.fetch(BASE + path, init);
const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const code = async (res) => (await res.json()).code;
const claims = async (uuid) => {
  await call("/q/network"); // the table is made by the first read or recorded claim
  return Number((await env.HERMA_DB.prepare("SELECT COUNT(*) AS n FROM herma_claim_edge WHERE worker_uuid = ?").bind(uuid).first())?.n ?? 0);
};

describe("claiming by agent name only", () => {
  it("is refused for a worker that has a token, and accepted with the token or with the worker id", async () => {
    const joined = await (await call("/q/onboard", json({ agent_id: "claim-test-owner-1", model_hint: "muse-spark-1.3" }))).json(); // a POST: the worker gets a token
    const uuid = joined.worker_profile.worker_uuid;
    const token = joined.worker_token;
    expect(token).toBeTruthy();

    for (const res of [await call("/q/claim/claim-test-owner-1"), await call("/q/claim", json({ agent_id: "claim-test-owner-1" }))]) {
      expect(res.status).toBe(403); // a GET and a POST, by name only
      expect(await code(res)).toBe("worker_token_required");
    }
    expect(await claims(uuid)).toBe(0); // nothing was leased or recorded in the worker's name

    const wrong = await call("/q/claim", json({ agent_id: "claim-test-owner-1", worker_uuid: uuid, worker_token: "not-the-token" }));
    expect(wrong.status).toBe(403);
    expect(await code(wrong)).toBe("invalid_worker_token"); // as before
    const wrongByName = await call("/q/claim", json({ agent_id: "claim-test-owner-1", worker_token: "not-the-token" }));
    expect(wrongByName.status).toBe(403);

    expect((await call("/q/claim", json({ agent_id: "claim-test-owner-1", worker_token: token }))).status).toBe(200); // the token and the name only
    expect((await call("/q/claim/claim-test-owner-1", { headers: { "x-herma-worker-token": token } })).status).toBe(200); // the header
    expect((await call("/q/claim", json({ agent_id: "claim-test-owner-1", worker_uuid: uuid, worker_token: token }))).status).toBe(200); // id and token
    expect((await call("/q/claim", json({ agent_id: "claim-test-owner-1", worker_uuid: uuid }))).status).toBe(200); // the documented flow: the id alone, as before
    expect((await call(`/q/claim/claim-test-owner-1?worker_uuid=${uuid}`)).status).toBe(200);
  });

  it("is as it was for a worker that never had a token, for a bare shared handle and for a worker the claim itself made", async () => {
    await call("/q/onboard?agent_id=claim-test-plain-1"); // a GET makes a worker without a token
    expect((await call("/q/claim/claim-test-plain-1")).status).toBe(200);
    expect((await call("/q/claim", json({ agent_id: "claim-test-plain-1" }))).status).toBe(200);
    expect((await call("/q/claim", json({ agent_id: "muse" }))).status).toBe(200); // a bare shared handle always gets a fresh worker
    expect((await call("/q/claim", json({ agent_id: "claim-test-made-1" }))).status).toBe(200);
    expect((await call("/q/claim", json({ agent_id: "claim-test-made-1" }))).status).toBe(200); // it has no token to ask for
  });

  it("holds for /q/chat too: a claim in chat by name only needs the token, except in the call that creates the worker or with the worker id", async () => {
    const first = await call("/q/chat", json({ message: "Claim a task", agent_id: "claim-test-owner-2" }));
    expect(first.status).toBe(200); // this call made the worker and handed out its token
    const made = await first.json();
    const token = made.worker_token || made.worker_profile?.worker_token;
    const uuid = made.worker_profile?.worker_uuid || made.session?.worker_uuid || made.worker_uuid;
    expect(token).toBeTruthy();
    const stranger = await call("/q/chat", json({ message: "Claim a task", agent_id: "claim-test-owner-2" }));
    expect(stranger.status).toBe(403);
    expect(await code(stranger)).toBe("worker_token_required");
    expect((await call("/q/chat", json({ message: "Claim a task", agent_id: "claim-test-owner-2", worker_token: token }))).status).toBe(200);
    if (uuid) expect((await call("/q/chat", json({ message: "Claim a task", agent_id: "claim-test-owner-2", worker_uuid: uuid }))).status).toBe(200); // by id, as before
  });
});
