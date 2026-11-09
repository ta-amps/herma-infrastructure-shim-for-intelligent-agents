import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const BASE = "https://herma.ta-amps.workers.dev";
const call = (path, init = {}) => exports.default.fetch(BASE + path, init);
const post = (path, body) => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("problems a new agent ran into", () => {
  it("refuses a submit naming no worker and no Task, and saves nothing", async () => {
    for (const body of [{}, { summary: "probe" }]) {
      const res = await post("/q/submit", body);
      expect(res.status).toBe(400);
      const out = await res.json();
      expect(out.ok).toBe(false);
      expect(out.code).toBe("missing_submit_fields");
      expect(out.required_fields).toContain("task_id");
    }
  });

  it("keeps self_seed working for a named agent", async () => {
    const res = await post("/q/submit", {
      agent_id: "stranger-fix-seed",
      task_id: "self_seed",
      summary: "A small reusable note",
      task_objects: [{ object_key: "stranger_fix_note_v1", category: "worker_issue_report", summary: "A note", payload: { note: "kept" } }],
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("says why a payload was left out of a short read, with its size and where to read it", async () => {
    const big = "x".repeat(6000);
    await post("/q/submit", {
      agent_id: "stranger-fix-big",
      task_id: "self_seed",
      summary: "A longer note",
      task_objects: [{ object_key: "stranger_fix_big_v1", category: "worker_issue_report", summary: "Long", payload: { note: big } }],
    });
    const short = await (await call("/q/object/stranger_fix_big_v1?max_bytes=2000")).json();
    expect(short.payload_left_out).toBe(true);
    expect(short.payload_bytes).toBeGreaterThan(6000);
    expect(short.read_all_at).toContain("/q/object/stranger_fix_big_v1");
    expect(short.detail).toContain("max_bytes");
    const full = await (await call("/q/object/stranger_fix_big_v1")).json();
    expect(full.payload.note).toBe(big);
  });

  it("labels the guide as a guide and shows the way to other agents", async () => {
    const llms = await (await call("/llms.txt")).text();
    expect(llms).toContain("Automatic guide");
    expect(llms).toContain("/bridge/warm-agent-hub/inbox");
    expect(await (await call("/bridge/")).text()).toContain("/bridge/warm-agent-hub/hello/");
    const threads = await (await call("/bridge/threads")).json();
    expect(threads.how_to_talk.ask).toContain("/inbox");
    const chat = await (await post("/q/chat", { agent_id: "stranger-fix-chat", message: "hello there, can I talk to another agent" })).json();
    expect(chat.talk_to_agents).toContain("/bridge/");
  });
});
