// QA sweep of Nov 6: text copies of every page, index pages for agents and Tasks with test names left out, llms.txt names all
// MCP tools, connect.json aliases, Server-Timing, and plain store labels on /shim.
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { storeLabel } from "../deploy/cloudflare/herma_engine.js";
import { TEXT_COPY_PAGES, htmlToText } from "../deploy/cloudflare/worker.js";

const call = (path, init = {}) => exports.default.fetch("https://herma.ta-amps.workers.dev" + path, init);
const post = (path, body) => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("QA sweep fixes", () => {
  it("every listed page has a .txt copy with the agent line and the footer", async () => {
    expect(TEXT_COPY_PAGES).toEqual(expect.arrayContaining(["/dashboard", "/get-started", "/trust", "/prompts", "/shim", "/connect", "/starter"]));
    for (const page of TEXT_COPY_PAGES) {
      const res = await call(`${page}.txt`);
      expect(res.status, page).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/plain");
      const text = await res.text();
      expect(text.slice(0, 400), page).toContain("llms.txt");
      expect(text, page).toContain("We don’t accept private information at this stage.");
      expect(text, page).not.toMatch(/herma-worker\/\d/);
      expect(text, page).not.toMatch(/<\/?(?:div|span|p|a|section|table|tr|td|th|script|style|code|pre|li|ul|ol|h[1-6]|main|header|footer|nav)\b[^>]*>/i);
    }
    expect(htmlToText('<p>A <a href="/x">link</a> &amp; <b>bold</b></p><script>alert(1)</script>')).toBe("A link (/x) & bold\n");
  }, 240000);

  it("/c/agent/ and /c/task/ list recent public work, with test names left out", async () => {
    const real = `qa-real-${Date.now().toString(36)}`;
    const test = `claude-livetest-qa-${Date.now().toString(36)}`;
    for (const agent of [real, test]) {
      await post("/q/submit", { agent_id: agent, task_id: "self_seed", summary: "A note for the index test", task_objects: [{ object_key: `${agent.replace(/-/g, "_")}_v1`, summary: "Index note", payload: { a: 1 } }] });
    }
    const json = await (await call("/c/agent/?format=json")).json();
    const names = json.agents.map((a) => a.agent_id);
    expect(names).toContain(real);
    expect(names).not.toContain(test);
    const html = await (await call("/c/agent/")).text();
    expect(html).toContain(`/c/agent/${real}`);
    expect(html).not.toContain(test);
    expect((await call(`/c/agent/${test}`)).status).toBe(200); // the direct link keeps working
    const txt = await call("/c/agent/index.txt");
    expect(txt.headers.get("content-type")).toContain("text/plain");
    expect(await txt.text()).toContain(`/c/agent/${real}`);
    const tasks = await call("/c/task/");
    expect(tasks.status).toBe(200);
    expect((await (await call("/c/task/?format=json")).json()).tasks).toBeInstanceOf(Array);
    expect((await call("/c/task/index.txt")).headers.get("content-type")).toContain("text/plain");
  }, 240000);

  it("llms.txt names all 9 MCP tools with their real arguments and links the index pages", async () => {
    const llms = await (await call("/llms.txt")).text();
    for (const tool of ["search", "find", "list_task_objects", "read_task_object", "list_tasks", "read_task", "list_builtin_provisions", "preview_shim", "extract_entities"]) {
      expect(llms).toContain(`- ${tool}:`);
    }
    expect(llms).toContain("- find: q (required)");
    expect(llms).toContain("- read_task_object: key (required)");
    expect(llms).toContain("/c/agent/ and");
    expect(llms).not.toMatch(/;/);
  });

  it("connect.json names the shim's own alias only, and gateway answers carry Server-Timing", async () => {
    const connect = await (await call("/connect.json")).json();
    expect(connect.aliases).toEqual(["https://herma.teleionlabs.com"]);
    expect(JSON.stringify(connect.aliases)).not.toContain("fabric.");
    const pulse = await call("/q/pulse");
    expect(pulse.headers.get("server-timing")).toMatch(/app;dur=\d+/);
    expect(storeLabel("system_builtin")).toBe("Built in");
    expect(storeLabel("tessera_cloud:feeds.the")).toBe("Teleion Fabric, feeds.the");
    const shim = await (await call("/shim")).text();
    expect(shim).not.toContain("tessera_cloud:");
  }, 240000);
});
