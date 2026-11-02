import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

// A worker that has a token is claimed as only by a caller that presents it (review of 4c919d1, note 2: a claim with only an agent name was still
// accepted as that worker). Workers that never had a token, bare shared handles and a worker made in the same call are as they were.

const BASE = "https://herma.teleionlabs.com";
const call = (path, init) => exports.default.fetch(BASE + path, init);
const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const code = async (res) => (await res.json()).code;
const claims = async (uuid) => {
  await call("/q/network"); // the table is made by the first read or recorded claim
  return Number((await env.HERMA_DB.prepare("SELECT COUNT(*) AS n FROM herma_claim_edge WHERE worker_uuid = ?").bind(uuid).first())?.n ?? 0);
};

describe("claiming as a worker that has a token", () => {
  it("is refused without the token, by name or by id, and accepted with it, with or without the id", async () => {
    const joined = await (await call("/q/onboard", json({ agent_id: "claim-test-owner-1", model_hint: "muse-spark-1.3" }))).json(); // a POST: the worker gets a token
    const uuid = joined.worker_profile.worker_uuid;
    const token = joined.worker_token;
    expect(token).toBeTruthy();

    const attempts = [
      await call("/q/claim/claim-test-owner-1"), // a GET, by name
      await call("/q/claim", json({ agent_id: "claim-test-owner-1" })), // a POST, by name
      await call("/q/claim", json({ agent_id: "claim-test-owner-1", worker_uuid: uuid })), // by id
      await call(`/q/claim/claim-test-owner-1?worker_uuid=${uuid}`), // a GET, by id
    ];
    for (const res of attempts) {
      expect(res.status).toBe(403);
      expect(await code(res)).toBe("worker_token_required");
    }
    expect(await claims(uuid)).toBe(0); // nothing was leased or recorded in the worker's name

    const wrong = await call("/q/claim", json({ agent_id: "claim-test-owner-1", worker_uuid: uuid, worker_token: "not-the-token" }));
    expect(wrong.status).toBe(403);
    expect(await code(wrong)).toBe("invalid_worker_token"); // as before

    expect((await call("/q/claim", json({ agent_id: "claim-test-owner-1", worker_uuid: uuid, worker_token: token }))).status).toBe(200); // id and token
    expect((await call("/q/claim", json({ agent_id: "claim-test-owner-1", worker_token: token }))).status).toBe(200); // the token and the name only
    expect((await call("/q/claim/claim-test-owner-1", { headers: { "x-herma-worker-token": token } })).status).toBe(200); // the header
  });

  it("is as it was for a worker that never had a token, for a bare shared handle and for a worker the claim itself made", async () => {
    await call("/q/onboard?agent_id=claim-test-plain-1"); // a GET makes a worker without a token
    expect((await call("/q/claim/claim-test-plain-1")).status).toBe(200);
    expect((await call("/q/claim", json({ agent_id: "claim-test-plain-1" }))).status).toBe(200);
    expect((await call("/q/claim", json({ agent_id: "muse" }))).status).toBe(200); // a bare shared handle always gets a fresh worker
    const made = await call("/q/claim", json({ agent_id: "claim-test-made-1" }));
    expect(made.status).toBe(200);
    expect((await call("/q/claim", json({ agent_id: "claim-test-made-1" }))).status).toBe(200); // it has no token to ask for
  });

  it("holds for /q/chat too: a claim in chat needs the token, except in the call that creates the worker", async () => {
    const first = await call("/q/chat", json({ message: "Claim a task", agent_id: "claim-test-owner-2" }));
    expect(first.status).toBe(200); // this call made the worker and handed out its token
    const made = await first.json();
    const token = made.worker_token || made.worker_profile?.worker_token;
    expect(token).toBeTruthy();
    const stranger = await call("/q/chat", json({ message: "Claim a task", agent_id: "claim-test-owner-2" }));
    expect(stranger.status).toBe(403);
    expect(await code(stranger)).toBe("worker_token_required");
    const owner = await call("/q/chat", json({ message: "Claim a task", agent_id: "claim-test-owner-2", worker_token: token }));
    expect(owner.status).toBe(200);
  });
});
