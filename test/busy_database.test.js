import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import worker, { answerThroughBusyDatabase } from "../deploy/cloudflare/worker.js";

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

  it("a write that isn't safe to repeat is never asked twice", async () => {
    for (const request of [
      req("/q/submit", "POST"), req("/q/submit/a/b/fence-1--summary-x"), req("/q/heartbeat?agent_id=a"), req("/q/release/a/b/1"), req("/q/onboard", "POST"),
      req("/q/claim", "POST"), req("/q/claim"), req("/q/claim/muse"), req("/q/claim/volunteer-agent"),
      req("/q/claim/some-agent?batch_size=4"), req("/q/claim/some-agent?force_new=1"),
    ]) {
      const { response, calls } = await run(request, [busy, fine]);
      expect(calls(), request.url).toBe(1);
      expect(response.status).toBe(503);
    }
  });

  it("a named single GET claim is asked again", async () => {
    for (const request of [req("/q/claim/some-agent"), req("/q/claim/some-agent?task_id=t1&format=json")]) {
      const { response, calls } = await run(request, [busy, fine]);
      expect(calls()).toBe(2);
      expect(response.status).toBe(200);
    }
  });

  it("any other answer passes through untouched", async () => {
    const { response, calls } = await run(req("/c/some_key"), [() => new Response("boom", { status: 500 })]);
    expect(response.status).toBe(500);
    expect(calls()).toBe(1);
  });
});

describe("a browser on a busy database", () => {
  it("gets a plain light page with Retry-After, and an agent still gets JSON", async () => {
    const page = await answerThroughBusyDatabase(new Request("https://shim.teleionlabs.com/dashboard", { headers: { accept: "text/html,*/*" } }), async () => busy(), [1]);
    expect(page.status).toBe(503);
    expect(page.headers.get("retry-after")).toBe("5");
    expect(page.headers.get("content-type")).toContain("text/html");
    const body = await page.text();
    expect(body).toContain("only light");
    expect(body).not.toContain("D1");
    const agent = await answerThroughBusyDatabase(new Request("https://shim.teleionlabs.com/dashboard"), async () => busy(), [1]);
    expect(agent.headers.get("content-type")).toContain("json");
  });
});

describe("the real claim handler with its answer lost", () => {
  const lost = async (path) => {
    const e = { ...env, OPEN_WORK_LIMITS: "on" };
    const ctx = { waitUntil() {}, passThroughOnException() {} };
    await worker.fetch(new Request("https://shim.teleionlabs.com/q/pulse", { headers: { accept: "application/json" } }), e, ctx);
    await env.HERMA_DB.prepare("UPDATE herma_durable_queue SET state='done' WHERE state IN ('ready','leased')").run();
    const now = new Date().toISOString();
    for (let i = 0; i < 6; i++) {
      await env.HERMA_DB.prepare("INSERT INTO herma_durable_queue (task_id, tier, visibility, priority, title, prompt, simhash64_hex, producer_agent, created_at, updated_at) VALUES (?, 'public_general', 'public_commons', 50, 'Busy test', 'Write one line.', '0', 'busy-test', ?, ?)").bind(`verb_pub_busy_${Date.now()}_${i}_${Math.floor(Math.random() * 1e6)}`, now, now).run();
    }
    let runs = 0;
    const request = new Request(`https://shim.teleionlabs.com${path}`, { headers: { accept: "application/json" } });
    const response = await answerThroughBusyDatabase(request, async () => {
      const r = await worker.fetch(new Request(request), e, ctx);
      if (runs++ < 2) { await r.text(); return busy(); }
      return r;
    }, [1, 1]);
    const leased = await env.HERMA_DB.prepare("SELECT count(*) AS n FROM herma_durable_queue WHERE state='leased'").first();
    return { status: response.status, runs, leased: leased.n };
  };

  it("a named claim runs again and holds one lease", async () => {
    const out = await lost(`/q/claim/busy-named-${Date.now()}?format=json`);
    expect(out).toMatchObject({ status: 200, runs: 3, leased: 1 });
  });

  it("a shared handle or a batch isn't run again, so it strands no more leases", async () => {
    for (const path of ["/q/claim/muse?format=json", `/q/claim/busy-batch-${Date.now()}?batch_size=2&format=json`, `/q/claim/busy-force-${Date.now()}?force_new=1&format=json`]) {
      const out = await lost(path);
      expect(out.runs, path).toBe(1);
      expect(out.status, path).toBe(503);
    }
  });
});
