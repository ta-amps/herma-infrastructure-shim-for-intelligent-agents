import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildIndex, resetFindIndex, reuseHintsForTask, searchIndex, stem, tokens } from "../deploy/cloudflare/unified_find.js";

const FAKE_TOKEN = `${"gh"}p_${"abcdefghijklmnopqrstuvwxyz0123456789"}`;
const index = buildIndex({
  objects: [
    { object_key: "shelter_intake_schema_v1", category: "verified_schema", summary: "Fields for a shelter intake form at the front desk.", reuse_count: 4 },
    { object_key: "shelter_intake_schema_v2", category: "verified_schema", summary: "Fields for a shelter intake form at the front desk, revised.", reuse_count: 1 },
    { object_key: "worker_memory_digest_v1", category: "worker_memory", summary: "Rolling memory of a worker about a shelter intake.", reuse_count: 90 },
    { object_key: "water_point_outage_menu_v1", category: "ngo_public_good", summary: "A phone menu to report a broken water pump.", reuse_count: 0 },
    // Enough other rows that a rare word weighs what it would on the live rows.
    ...Array.from({ length: 300 }, (_, i) => ({ object_key: `filler_note_${i}_v1`, category: "spec", summary: `Ordinary filler text about item number ${i}.`, reuse_count: 0 })),
  ],
  repos: [
    { repo: "acme/page-reader", name: "page-reader", feed: "ocr-llm", license: "MIT", language: "Python", stars: 40 },
    { repo: "acme/page-reader", name: "page-reader", feed: "eval-frameworks", license: "MIT", language: "Python", stars: 40 },
    { repo: "beta/page-reader", name: "page-reader", feed: "ocr-llm", license: null, language: "Go", stars: 900 },
    { repo: "acme/recall-store", name: "recall-store", feed: "memory-systems", license: "MIT", language: "TypeScript", stars: 5 },
  ],
  kits: [{ id: "KIT-THANKS-13", title: "Donor Thank-You Letters Kit", about: "Letters to donors, with privacy checks.", tags: "domain:nonprofit_ops" }],
  packs: [{ id: "accessibility-audit", title: "Accessibility audit", about: "Keyboard paths, contrast and focus order on a web page." }],
  feedWords: { "ocr-llm": "ocr scan scanned read document form", "memory-systems": "memory remember", "eval-frameworks": "evaluation" },
  terms: { "pack:accessibility-audit": ["screen reader", "wcag"] },
});
const refs = (r) => r.hits.map((d) => `${d.kind}:${d.id}`);

describe("searchIndex", () => {
  it("stems and splits", () => {
    expect(stem("schedules")).toBe("schedule");
    expect(tokens("readerApp_v2-forms")).toEqual(["reader", "app", "v2", "form"]);
  });
  it("puts an exact id first, for every kind", () => {
    for (const [q, ref] of [["KIT-THANKS-13", "kit:KIT-THANKS-13"], ["accessibility-audit", "pack:accessibility-audit"], ["shelter_intake_schema_v2", "obj:shelter_intake_schema_v2"], ["acme/page-reader", "repo:acme/page-reader"], ["ACME/PAGE-READER", "repo:acme/page-reader"]]) {
      const r = searchIndex(index, q);
      expect(r.match).toBe("exact");
      expect(refs(r)[0]).toBe(ref);
    }
  });
  it("finds a repository by name, most stars first, and one row per repository", () => {
    const r = searchIndex(index, "page-reader");
    expect(r.match).toBe("name");
    expect(refs(r)).toEqual(["repo:beta/page-reader", "repo:acme/page-reader"]);
  });
  it("finds an owner", () => {
    expect(searchIndex(index, "acme").match).toBe("owner");
    expect(searchIndex(index, "repositories by acme").match).toBe("owner");
  });
  it("finds a key by its start", () => {
    const r = searchIndex(index, "shelter_intake");
    expect(r.match).toBe("prefix");
    expect(refs(r)[0]).toBe("obj:shelter_intake_schema_v1");
  });
  it("mends a misspelling and says so", () => {
    const r = searchIndex(index, "acessibility-audit");
    expect(refs(r)[0]).toBe("pack:accessibility-audit");
    expect(r.match).toBe("title");
    const w = searchIndex(index, "shelter intkae form");
    expect(w.found).toBe(true);
    expect(w.rewrote).toContain("intkae>");
  });
  it("answers a plain need from any kind", () => {
    expect(refs(searchIndex(index, "something to read a scanned form"))).toContain("repo:beta/page-reader");
    expect(refs(searchIndex(index, "thank our donors with a letter"))[0]).toBe("kit:KIT-THANKS-13");
    expect(refs(searchIndex(index, "page with a screen reader"))[0]).toBe("pack:accessibility-audit");
  });
  it("keeps one row per version family and ranks an agent's own notes lower", () => {
    const r = refs(searchIndex(index, "shelter intake"));
    expect(r.filter((x) => x.startsWith("obj:shelter_intake")).length).toBe(1);
    expect(r[0]).toMatch(/^obj:shelter_intake/);
  });
  it("says found:false rather than guess", () => {
    for (const q of ["sourdough starter feeding", "qwertyuiop zxcvbnm", "   "]) {
      const r = searchIndex(index, q);
      expect(r.found).toBe(false);
      expect(r.hits).toEqual([]);
      expect(r.match).toBe("none");
    }
  });
});

describe("GET /q/find on a real database", () => {
  const call = (path) => exports.default.fetch(new Request(`https://shim.teleionlabs.com${path}`, { headers: { accept: "application/json" } }));
  beforeAll(async () => {
    await call("/q/pulse");
  });
  beforeEach(async () => {
    await resetFindIndex();
    await env.HERMA_DB.prepare("DELETE FROM herma_task_objects WHERE object_key LIKE 'find_test_%'").run();
    const cols = "object_key, category, summary, visibility, is_tombstoned, reuse_count, producer_agent, payload_json, simhash64_hex, sha256_hash, created_at";
    const row = (k, c, s, v, t = 0) => env.HERMA_DB.prepare(`INSERT INTO herma_task_objects (${cols}) VALUES (?, ?, ?, ?, ?, 0, 'find-test', '{}', '0', ?, '2026-11-04T00:00:00Z')`).bind(k, c, s, v, t, k).run();
    await row("find_test_public_v1", "spec", "A rubric about glacier ropes and many other public things", "public_commons");
    await row("find_test_private_v1", "spec", "A rubric about glacier ropes kept private", "server_infra");
    await row("find_test_gone_v1", "spec", "A rubric about glacier ropes taken down", "public_commons", 1);
  });
  it("serves only public rows, short, with no key", async () => {
    const r = await call("/q/find?q=glacier+ropes");
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.found).toBe(true);
    const ids = b.hits.map((h) => h.id);
    expect(ids).toContain("find_test_public_v1");
    expect(ids).not.toContain("find_test_private_v1");
    expect(ids).not.toContain("find_test_gone_v1");
    expect(JSON.stringify(b).length).toBeLessThan(1500);
  });
  it("asks for q, and refuses other methods", async () => {
    expect((await call("/q/find")).status).toBe(400);
    const p = await exports.default.fetch(new Request("https://shim.teleionlabs.com/q/find?q=x", { method: "POST" }));
    expect(p.status).toBe(405);
  });
  it("does not store a query shaped like a credential", async () => {
    await call(`/q/find?q=${FAKE_TOKEN}`);
    const hit = await env.HERMA_DB.prepare("SELECT COUNT(*) AS c FROM herma_demand_signals WHERE raw_sample_query LIKE ?").bind(`%${FAKE_TOKEN.slice(0, 12)}%`).first();
    expect(hit.c).toBe(0);
  });
  it("gives a claim a short hint only on a clear match, and never throws", async () => {
    // No index yet: a claim neither builds one nor waits.
    let started = 0;
    expect(await reuseHintsForTask(env.HERMA_DB, "Rubric for glacier ropes", { waitUntil: () => { started += 1; } })).toEqual([]);
    expect(started).toBe(1);
    await call("/q/find?q=glacier+ropes");
    const hints = await reuseHintsForTask(env.HERMA_DB, "Rubric for glacier ropes");
    expect(hints.map((h) => h.id)).toContain("find_test_public_v1");
    expect(await reuseHintsForTask(env.HERMA_DB, "sourdough schedule")).toEqual([]);
    await resetFindIndex();
    expect(await reuseHintsForTask(null, "anything")).toEqual([]);
  });
  it("drops a row that left public view after the index was built, and hides objects if that can't be checked", async () => {
    await call("/q/find?q=glacier+ropes");
    await env.HERMA_DB.prepare("UPDATE herma_task_objects SET is_tombstoned = 1 WHERE object_key = 'find_test_public_v1'").run();
    const b = await (await call("/q/find?q=glacier+ropes")).json();
    expect(b.hits.map((h) => h.id)).not.toContain("find_test_public_v1");
    expect(b.found).toBe(false);
    expect(await reuseHintsForTask(env.HERMA_DB, "Rubric for glacier ropes")).toEqual([]);
  });
  it("MCP lists and answers find", async () => {
    const mcp = (body) => exports.default.fetch(new Request("https://shim.teleionlabs.com/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }) })).then((r) => r.json());
    const list = await mcp({ method: "tools/list" });
    expect(list.result.tools.map((t) => t.name)).toContain("find");
    const got = await mcp({ method: "tools/call", params: { name: "find", arguments: { q: "glacier ropes" } } });
    expect(got.result.content[0].text).toContain("find_test_public_v1");
  });
  it("/q/repos does not 500 on a long word, and matches the whole word", async () => {
    const r = await call(`/q/repos?q=${"a".repeat(80)}`);
    expect(r.status).toBe(200);
    expect((await r.json()).rows).toEqual([]);
  });
});
