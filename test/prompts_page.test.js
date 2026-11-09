// The short /prompts page (Nov 6, round 3): one link per prompt, the universal worker prompt first, no prompt bodies and no
// internal or marketing words on the page; the raw texts are served for agents at /prompts/raw/<name>.txt.
import file from "../prompts/universal-worker.txt?raw";
import u6File from "../prompts/universal-worker-u6.txt?raw";
import previousFile from "../prompts/universal-worker-u5.txt?raw";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { buildPromptCatalog, findPrompt } from "../deploy/cloudflare/prompts_page.js";
import { UNIVERSAL_WORKER_PROMPT } from "../deploy/cloudflare/universal_worker_prompt.js";

void env;
const BASE = "https://herma.ta-amps.workers.dev";
const call = (path, init = {}) => exports.default.fetch(BASE + path, init);
const visible = (html) => html.replace(/<head[\s\S]*?<\/head>/i, "").replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " ");

describe("/prompts page", { timeout: 180000 }, () => {
  it("is short, lists every prompt with a .txt link, and puts the universal worker prompt first", async () => {
    const res = await call("/prompts");
    expect(res.status).toBe(200);
    const html = await res.text();
    const links = [...html.matchAll(/<li id="prompt-[^"]+"><a href="([^"]+)">/g)].map((m) => m[1]);
    const catalog = buildPromptCatalog(BASE);
    expect(links.length).toBe(catalog.length);
    expect(links[0]).toMatch(/^https:\/\/[^/]+\/prompts\/raw\/universal-worker\.txt$/);
    for (const link of links) expect(link).toMatch(/\/prompts\/raw\/[\w-]+\.txt$/);
    expect(html).not.toContain("<pre");
    expect(html).not.toContain("data-template");
    expect(html.length).toBeLessThan(20000);
    const words = visible(html);
    for (const bad of [/\bverif(y|ied|ication|iable)\b/i, /\bhash(es)?\b/i, /\bnouns?\b/i, /\bverbs?\b/i, /herma-worker/i, /muse-herma-worker/i, /\/tmp\//, /\bconfirmed\b/i]) {
      expect(words, String(bad)).not.toMatch(bad);
    }
  });

  it("has a .txt copy with the same links", async () => {
    const res = await call("/prompts.txt");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("/prompts/raw/universal-worker.txt");
    expect(text).not.toMatch(/\bverif(y|ied)\b/i);
  });

  it("serves the universal worker prompt byte for byte, with and without .txt", async () => {
    expect(UNIVERSAL_WORKER_PROMPT).toBe(file);
    for (const path of ["/prompts/raw/universal-worker.txt", "/prompts/raw/universal-worker", "/prompts/raw/universal_worker.txt", "/prompts/raw/universal-worker.txt?agent_id=someone-a1b2c3"]) {
      const res = await call(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/plain");
      expect(await res.text(), path).toBe(file);
    }
  });

  it("serves the other raw prompts at <name>.txt the same as <name>", async () => {
    for (const name of ["worker_loop", "master_v3", "scheduled_bounded_v6", "codex_unlimited_frontier_loop_v9"]) {
      const a = await (await call(`/prompts/raw/${name}?mutate=0&agent_id=raw-check-a1b2c3`)).text();
      const b = await (await call(`/prompts/raw/${name}.txt?mutate=0&agent_id=raw-check-a1b2c3`)).text();
      expect(b.length, name).toBeGreaterThan(500);
      expect(b, name).toBe(a);
    }
    // An unknown name still gets the worker loop, as before.
    const unknown = await (await call("/prompts/raw/no-such-prompt?mutate=0")).text();
    expect(unknown).toBe(await (await call("/prompts/raw/worker_loop?mutate=0")).text());
    expect(findPrompt(buildPromptCatalog(BASE), "worker_loop.txt").alias).toBe("worker_loop");
  });

  it("serves U7 as the universal worker prompt and keeps U6 and U5 at their own .txt routes", async () => {
    expect(file).toMatch(/^Version U7,/m);
    expect(u6File).toMatch(/^Version U6,/m);
    expect(previousFile).toMatch(/^Version U5,/m);
    for (const path of ["/prompts/raw/universal-worker-u6.txt", "/prompts/raw/universal-worker-u6", "/prompts/raw/universal_worker_u6.txt"]) {
      const res = await call(path);
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).toBe(u6File);
    }
    for (const path of ["/prompts/raw/universal-worker-u5.txt", "/prompts/raw/universal-worker-u5", "/prompts/raw/universal_worker_u5.txt"]) {
      const res = await call(path);
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).toBe(previousFile);
    }
    const catalog = buildPromptCatalog(BASE);
    expect(catalog[0].alias).toBe("universal-worker");
    expect(catalog[0].title).toContain("U7");
    expect(catalog.some((p) => p.alias === "universal-worker-u6" && p.title.includes("U6"))).toBe(true);
    expect(catalog.some((p) => p.alias === "universal-worker-u5" && p.title.includes("U5"))).toBe(true);
    const html = await (await call("/prompts")).text();
    expect(html).toContain("/prompts/raw/universal-worker-u6.txt");
    expect(html).toContain("/prompts/raw/universal-worker-u5.txt");
  });

  it("lists the universal worker prompt first in the JSON list", async () => {
    const json = await (await call("/prompts?format=json", { headers: { accept: "application/json" } })).json();
    expect(json.prompts[0].id).toBe("universal_worker");
  });
});
