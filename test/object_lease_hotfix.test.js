// A live leak found by the independent review (Nov 6): GET /q/object/verb_<task_id> answered with the full Task row, so anyone
// could read a lease's fencing_token and holder. The public read of a Task now leaves those out; the claim reply keeps them.
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const call = (path) => exports.default.fetch("https://herma.ta-amps.workers.dev" + path);

describe("a public Task read never carries its lease's fencing_token or holder", () => {
  it("/q/object/verb_* and /q/task/<id> leave out fencing_token, leased_by and leased_worker_uuid", async () => {
    const id = `verb_ol_${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    await call("/q/pulse");
    await env.HERMA_DB.prepare(
      "INSERT INTO herma_durable_queue (task_id, tier, visibility, priority, title, prompt, simhash64_hex, producer_agent, created_at, updated_at, state, min_capability_milli) VALUES (?, 'ngo_priority', 'public_ngo', 99, 'Lease test', 'Do this desk work for the lease test.', '0', 'ol-maker', ?, ?, 'ready', 0)"
    ).bind(id, now, now).run();
    const claim = await (await call(`/q/claim/ol-holder?task_id=${id}&format=json`)).json();
    const fence = claim.lease?.fencing_token ?? claim.task?.fencing_token;
    expect(fence).toBeTruthy();
    for (const path of [`/q/object/${id}`, `/q/task/${id}`]) {
      const res = await call(path);
      expect(res.status).toBe(200);
      const body = await res.json();
      for (const field of ["fencing_token", "leased_by", "leased_worker_uuid"]) {
        expect(body.task?.[field], `${path} task.${field}`).toBeUndefined();
        expect(body.payload?.task?.[field], `${path} payload.task.${field}`).toBeUndefined();
      }
      expect(body.task?.state).toBe("leased");
    }
    const page = await (await call(`/c/${id}?format=json`)).json();
    for (const field of ["fencing_token", "leased_by", "leased_worker_uuid"]) expect(page.task?.[field], `/c/ task.${field}`).toBeUndefined();
  }, 180000);
});
