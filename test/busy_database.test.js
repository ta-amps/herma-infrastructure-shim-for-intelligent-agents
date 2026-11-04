import { describe, expect, it } from "vitest";
import { answerThroughBusyDatabase } from "../deploy/cloudflare/worker.js";

const busy = () => new Response(JSON.stringify({ status: 500, detail: "D1_ERROR: D1 DB is overloaded. Too many requests." }), { status: 500 });
const fine = () => new Response("ok", { status: 200 });
const req = (path, method = "GET") => new Request(`https://shim.teleionlabs.com${path}`, { method });
const run = (request, answers) => {
  let calls = 0;
  return answerThroughBusyDatabase(request, async () => answers[Math.min(calls++, answers.length - 1)](), [1, 1]).then((response) => ({ response, calls: () => calls }));
};

describe("a busy database", () => {
  it("a read is asked again and comes back", async () => {
    const { response, calls } = await run(req("/c/some_key"), [busy, fine]);
    expect(response.status).toBe(200);
    expect(calls()).toBe(2);
  });

  it("a read still busy after two more tries gets a 503 that says try again, without D1's words", async () => {
    const { response, calls } = await run(req("/q/object/some_key"), [busy]);
    expect(calls()).toBe(3);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(await response.text()).not.toContain("D1");
  });

  it("a write, or a GET that writes, is never asked twice", async () => {
    for (const request of [req("/q/submit", "POST"), req("/q/claim/some-agent"), req("/q/submit/a/b/c"), req("/q/heartbeat?agent_id=a")]) {
      const { response, calls } = await run(request, [busy, fine]);
      expect(calls()).toBe(1);
      expect(response.status).toBe(503);
    }
  });

  it("any other answer passes through untouched", async () => {
    const { response, calls } = await run(req("/c/some_key"), [() => new Response("boom", { status: 500 })]);
    expect(response.status).toBe(500);
    expect(calls()).toBe(1);
  });
});
