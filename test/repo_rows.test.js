import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { repoMatchesForSearch, repoRowsResponse } from "../deploy/cloudflare/repo_rows.js";

const db = () => env.HERMA_DB;
const ROWS = [
  ["acme/memfold", "memfold", "memory-systems", "MIT", "Python", "2026-09-03", 12, 1],
  ["other/memfold", "memfold", "memory-systems", "Apache-2.0", "Go", "2026-10-02", 0, 1],
  ["zed/kiln", "kiln", "agent-harnesses", "unknown", "Rust", "2026-10-30", 0, 1],
  ["noise/not-related", "not-related", "memory-systems", "MIT", "Python", "2026-09-09", 900, 0],
  ["acme/both", "both", "memory-systems", "MIT", "Python", "2026-09-10", 5, 1],
  ["acme/both", "both", "ocr-llm", "MIT", "Python", "2026-09-10", 5, 1],
];
const call = (qs, fetchImpl) => repoRowsResponse(new URL(`https://x/q/repos?${qs}`), db(), { fetchImpl: fetchImpl || vi.fn(async () => { throw new Error("no upstream expected"); }) });
const github = (status, body) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

beforeAll(async () => {
  await exports.default.fetch("https://herma.ta-amps.workers.dev/q/pulse");
  await db().exec("CREATE TABLE IF NOT EXISTS feed_repo_rows (repo TEXT NOT NULL COLLATE NOCASE, name TEXT NOT NULL COLLATE NOCASE, feed TEXT NOT NULL, license TEXT, language TEXT, created TEXT, stars INTEGER, relevant INTEGER NOT NULL DEFAULT 1, seen_at TEXT NOT NULL, PRIMARY KEY (repo, feed))");
  await db().exec("CREATE TABLE IF NOT EXISTS feed_repo_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  for (const r of ROWS) {
    await db().prepare("INSERT OR REPLACE INTO feed_repo_rows (repo,name,feed,license,language,created,stars,relevant,seen_at) VALUES (?,?,?,?,?,?,?,?,'2026-11-01')").bind(...r).run();
  }
  await db().prepare("INSERT OR REPLACE INTO feed_repo_meta (key,value) VALUES ('as_of','2026-11-04T00:00Z')").run();
});

describe("GET /q/repos", () => {
  it("answers an exact owner/name from the rows in a few hundred characters, ignoring case", async () => {
    const [body, status] = await call("repo=ACME/MemFold");
    expect(status).toBe(200);
    expect(body.rows).toEqual([["acme/memfold", "MIT", "Python", "2026-09-03", 12, "memory-systems"]]);
    expect(body.source).toBe("feed");
    expect(body.as_of).toBe("2026-11-04T00:00Z");
    expect(JSON.stringify(body).length).toBeLessThan(250);
  });

  it("returns every owner of a bare name, one row per repository, low-star ones included", async () => {
    const [body] = await call("name=memfold");
    expect(body.rows.map((r) => r[0])).toEqual(["other/memfold", "acme/memfold"]);
    const [both] = await call("name=both");
    expect(both.rows.length).toBe(1);
  });

  it("filters by feed, language, licence and date, leaves out rows marked not relevant, and pages", async () => {
    const [body] = await call("feed=memory-systems&language=python&license=mit&since=2026-09-01&limit=1");
    expect(body.rows.map((r) => r[0])).toEqual(["acme/memfold"]);
    expect(body.next_offset).toBe(1);
    const [next] = await call("feed=memory-systems&language=python&license=mit&since=2026-09-01&limit=1&offset=1");
    expect(next.rows.map((r) => r[0])).toEqual(["acme/both"]);
    expect(next.next_offset).toBeUndefined();
    const [low] = await call("feed=memory-systems&max_stars=0");
    expect(low.rows.map((r) => r[0])).toEqual(["other/memfold"]);
  });

  it("reads a repository the scans never saw through GitHub, and keeps its licence honest", async () => {
    const fetchImpl = github(200, { full_name: "new/thing", license: { spdx_id: "NOASSERTION" }, language: "Go", created_at: "2026-11-02T01:00:00Z", stargazers_count: 0 });
    const [body] = await call("repo=new/thing", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(body.source).toBe("github");
    expect(body.rows).toEqual([["new/thing", null, "Go", "2026-11-02", 0, ""]]);
  });

  it("finds a bare name at GitHub only on an exact name match", async () => {
    const fetchImpl = github(200, { items: [{ name: "fresh-tool", full_name: "a/fresh-tool", created_at: "2026-11-01T00:00:00Z", stargazers_count: 0 }, { name: "fresh-tool-extra", full_name: "b/fresh-tool-extra", created_at: "2026-11-01T00:00:00Z" }] });
    const [body] = await call("name=fresh-tool", fetchImpl);
    expect(body.rows.map((r) => r[0])).toEqual(["a/fresh-tool"]);
  });

  it("tells a missing repository apart from a limit it could not get past", async () => {
    const [gone] = await call("repo=nobody/never-was-here", github(404, {}));
    expect(gone.miss).toBe("no_such_repo");
    const [limited] = await call("repo=nobody/limited-now", github(403, {}));
    expect(limited.miss).toBe("rate_limited");
    expect(limited.note).toMatch(/not a statement/);
    const [broken] = await call("repo=nobody/broken-now", vi.fn(async () => { throw new Error("down"); }));
    expect(broken.miss).toBe("unavailable");
  });

  it("refuses a malformed name or date and asks for a filter, with no upstream call", async () => {
    const fetchImpl = vi.fn();
    expect((await call("repo=../../etc/passwd", fetchImpl))[1]).toBe(400);
    expect((await call("name=a%20b", fetchImpl))[1]).toBe(400);
    expect((await call("feed=ocr-llm&since=yesterday", fetchImpl))[1]).toBe(400);
    expect((await call("", fetchImpl))[1]).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats a wildcard in q as text, and SQL in a filter as a value", async () => {
    expect((await call("q=%25"))[0].rows).toEqual([]);
    expect((await call("language=x'%20OR%201=1--"))[0].rows).toEqual([]);
  });
});

describe("GET /q/repos?ask=", () => {
  const ask = (q, f) => call(`ask=${encodeURIComponent(q)}`, f);
  it("answers directly when one row fits the question", async () => {
    const [lic] = await ask("What software licence does the GitHub repository acme/memfold use?");
    expect([lic.direct, lic.answer, lic.field]).toEqual([true, "MIT", "license"]);
    const [lang] = await ask("What is the primary programming language of the GitHub repository zed/kiln?");
    expect([lang.direct, lang.answer]).toEqual([true, "Rust"]);
    const [own] = await ask('A public GitHub repository named "kiln" is new. Which GitHub account owns it?');
    expect([own.direct, own.answer]).toEqual([true, "zed"]);
  });

  it("uses a month in the question to choose between owners, and does not guess without one", async () => {
    const [month] = await ask('A repository named "memfold", created in 2026-10. Which GitHub account owns it?');
    expect(month.answer).toBe("other");
    const [none] = await ask('A repository named "memfold". Which GitHub account owns it?');
    expect(none.direct).toBe(false);
    expect(none.answer).toBeUndefined();
    expect(none.rows.length).toBe(2);
  });

  it("does not answer from an unknown value or a question it can't read", async () => {
    const [lic] = await ask("What licence does zed/kiln use?");
    expect(lic.direct).toBe(false);
    const [other] = await ask("Is acme/memfold any good?");
    expect(other.direct).toBe(false);
    expect((await ask("Name a good memory system"))[0].direct).toBe(false);
  });
});

describe("/q/search with an exact repository name", () => {
  it("names the repository and leaves plain word searches alone", async () => {
    const res = await exports.default.fetch("https://herma.ta-amps.workers.dev/q/search?q=acme/memfold");
    const body = await res.json();
    expect(body.match).toBe("exact_repo");
    expect(body.repo_matches.rows[0][0]).toBe("acme/memfold");
    expect(Array.isArray(body.results)).toBe(true);
    const plain = await (await exports.default.fetch("https://herma.ta-amps.workers.dev/q/search?q=memory")).json();
    expect(plain.repo_matches).toBeUndefined();
  });

  it("returns nothing, rather than failing, when no one has the name", async () => {
    const f = github(404, {});
    expect(await repoMatchesForSearch(db(), "no-such-thing-here", { fetchImpl: f })).toBeNull();
    expect(await repoMatchesForSearch(db(), "plainword", { fetchImpl: f })).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("/q/search is honest about what matched", () => {
  const search = async (q, extra = "") => (await exports.default.fetch(`https://herma.ta-amps.workers.dev/q/search?q=${encodeURIComponent(q)}${extra}`)).json();
  const objectKey = "exact_first_probe_object_v1";

  beforeAll(async () => {
    const pulse = await (await exports.default.fetch("https://herma.ta-amps.workers.dev/q/objects?format=json&limit=1")).json().catch(() => ({}));
    expect(pulse).toBeTruthy();
    const put = await exports.default.fetch("https://herma.ta-amps.workers.dev/q/objects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: "t", summary: "A probe object about municipal shelter intake", object_key: objectKey, payload: { a: 1 } }),
    });
    expect([200, 201]).toContain(put.status);
  });

  it("puts an exact ID first, even with its case changed, with one row per ID", async () => {
    const stored = await search(objectKey);
    const id = stored.results[0]?.id;
    expect(stored.match).toBe("exact_id");
    expect(stored.results[0].exact).toBe(true);
    expect(new Set(stored.results.map((r) => r.id)).size).toBe(stored.results.length);
    const upper = await search(String(id).toUpperCase());
    expect(upper.match).toBe("exact_id");
    expect(upper.results[0].id).toBe(id);
  });

  it("says no match for a made-up word, and keeps neighbours apart from results", async () => {
    const body = await search("xyzzyplughqwertz");
    expect(body.match).toBe("none");
    expect(body.total_matches).toBe(0);
    expect(body.results).toEqual([]);
    expect(Array.isArray(body.nearby)).toBe(true);
    expect(body.note).toMatch(/No match/);
  });

  it("does not fail on a very long made-up word", async () => {
    const res = await exports.default.fetch("https://herma.ta-amps.workers.dev/q/search?q=xyzzyplughqwertzxyzzyplughqwertz");
    expect(res.status).toBe(200);
  });

  it("does not call a name-shaped query matched because one of its words matched", async () => {
    const body = await search("shelter-nonexistent-zzzz");
    expect(body.results).toEqual([]);
  });

  it("still finds things for ordinary prose, in a compact reply", async () => {
    const body = await search("shelter intake");
    expect(body.match).toBe("words");
    expect(body.results.length).toBeGreaterThan(0);
    for (const r of body.results) {
      expect(r.lsh_band_0).toBeUndefined();
      expect(r.summary.length).toBeLessThanOrEqual(160);
    }
    expect(body.query_analysis.query_simhash_bands).toBeUndefined();
  });

  it("keeps the older reply behind full=1", async () => {
    const body = await search("shelter intake", "&full=1");
    expect(body.schema).toBe("herma.priority_work_gateway.search.v2");
    expect(body.query_analysis).toBeTruthy();
    expect(body.nearby).toBeUndefined();
  });
});
