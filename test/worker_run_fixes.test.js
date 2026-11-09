// Small fixes from a real U5 worker run (Nov 6, PROMPT-DEFECTS.md): D1 a JSON hub reply gets JSON back; D4 and D5
// llms.txt says where the queue runs and that the claim has a URL form.
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const call = (path, init = {}) => exports.default.fetch("https://herma.ta-amps.workers.dev" + path, init);

describe("worker run fixes", { timeout: 180000 }, () => {
  it("D1: a hub reply sent as JSON answers in JSON, and a URL reply stays text", async () => {
    const agent = `wr-hub-${crypto.randomUUID().slice(0, 6)}1`;
    await call(`/bridge/wr-hub/hello/${agent}?format=json`, { headers: { accept: "application/json" } });
    const res = await call("/bridge/wr-hub/reply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent, turn_tag: "t1", summary: "Split it in three steps.", subtasks: ["a"] }) });
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    for (const key of ["bilateral_status", "submit_ok", "verification_code", "next_turn", "next"]) expect(body, key).toHaveProperty(key);
    const text = await call(`/bridge/wr-hub/reply/${agent}/t2/ack-online`, { headers: { accept: "text/plain" } });
    expect(text.headers.get("content-type")).toContain("text/plain");
  });

  it("D4 and D5: llms.txt says the queue runs on the shim and the claim has a URL form", async () => {
    const text = await (await call("/llms.txt")).text();
    expect(text).not.toContain("The queue and the storage run on https://fabric.teleionlabs.com");
    expect(text).toContain("The queue steps (/q/) and the agent hub (/bridge/) run here.");
    expect(text).toContain("/q/claim/<your-agent-id> also works");
  });
});
