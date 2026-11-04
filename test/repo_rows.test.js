import { env, exports } from "cloudflare:workers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { splitStrongAndNearby } from "../deploy/cloudflare/priority_work_gateway.js";
import { clearUpstreamBackoff, repoMatchesForSearch, repoRowsResponse } from "../deploy/cloudflare/repo_rows.js";

const TODAY = new Date().toISOString().slice(0, 10);
// Made up, and assembled here so the repository's own leak scan stays strict and clean.
const FAKE_TOKEN = `${"gh"}p_${"abcdefghijklmnopqrstuvwxyz0123456789"}`;

const db = () => env.HERMA_DB;
const ROWS = [
  ["acme/memfold", "memfold", "memory-systems", "MIT", "Python", "2026-09-03", 12, 1],
  ["other/memfold", "memfold", "memory-systems", "Apache-2.0", "Go", "2026-10-02", 0, 1],
  ["zed/kiln", "kiln", "agent-harnesses", "unknown", "Rust", "2026-10-30", 0, 1],
  ["noise/not-related", "not-related", "memory-systems", "MIT", "Python", "2026-09-09", 900, 0],
  ["acme/both", "both", "memory-systems", "MIT", "Python", "2026-09-10", 5, 1],
  ["acme/both", "both", "ocr-llm", "MIT", "Python", "2026-09-10", 5, 1],
  ["old/stale", "stale", "memory-systems", "MIT", "Zig", "2026-09-10", 5, 1, "2026-01-01"],
  ["acme/shared-name", "shared-name", "memory-systems", "MIT", "Zig", "2026-09-10", 5, 1],
];
const call = (qs, fetchImpl) => repoRowsResponse(new URL(`https://x/q/repos?${qs}`), db(), { fetchImpl: fetchImpl || vi.fn(async () => { throw new Error("no upstream expected"); }) });
const github = (status, body) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

beforeAll(async () => {
  await exports.default.fetch("https://herma.ta-amps.workers.dev/q/pulse");
  await db().exec("CREATE TABLE IF NOT EXISTS feed_repo_rows (repo TEXT NOT NULL COLLATE NOCASE, name TEXT NOT NULL COLLATE NOCASE, feed TEXT NOT NULL, license TEXT, language TEXT, created TEXT, stars INTEGER, relevant INTEGER NOT NULL DEFAULT 1, seen_at TEXT NOT NULL, PRIMARY KEY (repo, feed))");
  await db().exec("CREATE TABLE IF NOT EXISTS feed_repo_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  for (const r of ROWS) {
    await db().prepare("INSERT OR REPLACE INTO feed_repo_rows (repo,name,feed,license,language,created,stars,relevant,seen_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(...r.slice(0, 8), r[8] || TODAY).run();
  }
  await db().prepare("INSERT OR REPLACE INTO feed_repo_meta (key,value) VALUES ('as_of','2026-11-04T00:00Z')").run();
}, 60000);

describe("GET /q/repos", () => {
  it("answers an exact owner/name from the rows in a few hundred characters, ignoring case", async () => {
    const [body, status] = await call("repo=ACME/MemFold");
    expect(status).toBe(200);
    expect(body.rows).toEqual([["acme/memfold", "MIT", "Python", "2026-09-03", 12, "memory-systems", TODAY]]);
    expect(body.source).toBe("feed");
    expect(body.as_of).toBe("2026-11-04T00:00Z");
    expect(JSON.stringify(body).length).toBeLessThan(250);
  });

  it("returns every owner of a bare name, one row per repository, low-star ones included", async () => {
    const [body] = await call("name=memfold");
    expect(body.rows.map((r) => r[0])).toEqual(["other/memfold", "acme/memfold"]);
    expect((await call("name=memfold"))[0].other_owners_possible).toBe(true);
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
    expect(body.rows).toEqual([["new/thing", null, "Go", "2026-11-02", 0, "", TODAY]]);
  });

  it("finds a bare name at GitHub only on an exact name match", async () => {
    const fetchImpl = github(200, { items: [{ name: "fresh-tool", full_name: "a/fresh-tool", created_at: "2026-11-01T00:00:00Z", stargazers_count: 0 }, { name: "fresh-tool-extra", full_name: "b/fresh-tool-extra", created_at: "2026-11-01T00:00:00Z" }] });
    const [body] = await call("name=fresh-tool", fetchImpl);
    expect(body.rows.map((r) => r[0])).toEqual(["a/fresh-tool"]);
  });

  it("withholds a repository whose name the public-name filter would change, rather than serve a false name", async () => {
    const f = github(200, { full_name: "someone/tessera", license: null, language: "Go", created_at: "2026-11-02T01:00:00Z", stargazers_count: 0 });
    const [body] = await call("repo=someone/tessera", f);
    expect(body.rows).toEqual([]);
    expect(body.miss).toBe("withheld");
  });

  it("tells a missing repository apart from a limit it could not get past", async () => {
    const [gone] = await call("repo=nobody/never-was-here", github(404, {}));
    expect(gone.miss).toBe("no_such_repo");
    const [searched] = await call("name=never-seen-name", github(200, { total_count: 400, items: [] }));
    expect(searched.miss).toBe("not_in_github_search");
    expect(searched.note).toMatch(/may still exist/);
    const [refused] = await call("repo=nobody/refused-now", github(403, {}));
    expect(refused.miss).toBe("refused");
    expect(refused.note).toMatch(/not a statement/);
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
  const search = (items, total) => github(200, { total_count: total ?? items.length, incomplete_results: false, items });
  const item = (full, month) => ({ name: full.split("/")[1], full_name: full, created_at: `${month}-02T00:00:00Z`, stargazers_count: 0 });

  it("answers directly when one row fits a plain question about one repository", async () => {
    const [lic] = await ask("What software licence does the GitHub repository acme/memfold use?");
    expect([lic.direct, lic.answer, lic.field]).toEqual([true, "MIT", "license"]);
    const [lang] = await ask("What is the primary programming language of the GitHub repository zed/kiln?");
    expect([lang.direct, lang.answer]).toEqual([true, "Rust"]);
  });

  it("answers an owner question only once GitHub's search also shows every owner", async () => {
    const [own] = await ask('A public GitHub repository named "kiln", created in 2026-10. Which GitHub account or organization owns it? Answer with the owner name.', search([item("zed/kiln", "2026-10")]));
    expect([own.direct, own.answer]).toEqual([true, "zed"]);
    const [two] = await ask('A public GitHub repository named "kilnb". Which GitHub account owns it?', search([item("zed/kilnb", "2026-10"), item("someone/kilnb", "2024-01")]));
    expect(two.direct).toBe(false);
    const fetchWithForks = search([item("zed/kilnf", "2026-10")]);
    await ask('A public GitHub repository named "kilnf". Which GitHub account owns it?', fetchWithForks);
    expect(decodeURIComponent(fetchWithForks.mock.calls[0][0])).toContain("fork:true");
    const [partial] = await ask('A repository named "kilnc". Which GitHub account owns it?', search([item("zed/kilnc", "2026-10")], 400));
    expect(partial.direct).toBe(false);
    const [limited] = await ask('A repository named "both". Which GitHub account owns it?', vi.fn(async () => new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } })));
    expect(limited.direct).toBe(false);
    expect(limited.rows.length).toBe(1);
    await clearUpstreamBackoff();
  });

  it("uses a month in the question to choose between owners, and does not guess without one", async () => {
    const both = search([item("acme/memfold", "2026-09"), item("other/memfold", "2026-10")]);
    const [month] = await ask('A repository named "memfold", created in 2026-10. Which GitHub account owns it?', both);
    expect(month.answer).toBe("other");
    const [none] = await ask('A repository named "memfold". Which GitHub account owns it?', both);
    expect(none.direct).toBe(false);
    expect(none.answer).toBeUndefined();
    expect(none.rows.length).toBe(2);
  });

  it("does not answer from an unknown value, or a question with more in it than one repository and one field", async () => {
    expect((await ask("What licence does zed/kiln use?"))[0].direct).toBe(false);
    expect((await ask("Is acme/memfold any good?"))[0].direct).toBe(false);
    expect((await ask("Name a good memory system"))[0].direct).toBe(false);
    expect((await ask("What licence do acme/memfold and other/memfold use?"))[0].direct).toBe(false);
    expect((await ask("What licence and language does acme/memfold use?"))[0].direct).toBe(false);
    expect((await ask("What licence did acme/memfold have on 2026-10-15?"))[0].direct).toBe(false);
    expect((await ask("What license did acme/memfold use in 2024?"))[0].direct).toBe(false);
    expect((await ask("What licence does acme/memfold use in its fork?"))[0].direct).toBe(false);
    expect((await ask("Who owned acme/memfold before?"))[0].direct).toBe(false);
    expect((await ask('A repository named "both" is a private project. Which GitHub account owns it?', search([item("acme/both", "2026-09")])))[0].direct).toBe(false);
  });
});

describe("/q/search with an exact repository name", () => {
  it("names the repository and leaves plain word searches alone", async () => {
    const res = await exports.default.fetch("https://herma.ta-amps.workers.dev/q/search?compact=1&q=acme/memfold");
    const body = await res.json();
    expect(body.match).toBe("exact_repo");
    expect(body.repo_matches.rows[0][0]).toBe("acme/memfold");
    expect(Array.isArray(body.results)).toBe(true);
    const plain = await (await exports.default.fetch("https://herma.ta-amps.workers.dev/q/search?q=memory")).json();
    expect(plain.repo_matches).toBeUndefined();
  });

  it("returns nothing, rather than failing, when no one has the name", async () => {
    expect(await repoMatchesForSearch(db(), "no-such-thing-here")).toBeNull();
    expect(await repoMatchesForSearch(db(), "plainword")).toBeNull();
  });
});

describe("/q/search is honest about what matched", () => {
  const raw = async (q, extra = "") => (await exports.default.fetch(`https://herma.ta-amps.workers.dev/q/search?q=${encodeURIComponent(q)}${extra}`)).json();
  const search = (q, extra = "") => raw(q, `&compact=1${extra}`);
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
  }, 60000);

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
    const body = await raw("shelter intake", "&full=1");
    expect(body.schema).toBe("herma.priority_work_gateway.search.v2");
    expect(body.query_analysis.query_simhash_bands).toBeTruthy();
    expect(body.nearby).toBeUndefined();
    expect(body.match).toBeUndefined();
  });

  it("gives an existing caller every old field by default, with the new ones beside them", async () => {
    const body = await raw("shelter intake");
    const old = await raw("shelter intake", "&full=1");
    expect(body.schema).toBe(old.schema);
    for (const key of Object.keys(old)) expect(body).toHaveProperty(key);
    for (const key of Object.keys(old.query_analysis)) expect(body.query_analysis).toHaveProperty(key);
    expect(body.total_matches).toBe(old.total_matches);
    expect(body.results.map((r) => r.id)).toEqual([...new Set(old.results.map((r) => r.id))].slice(0, body.results.length));
    for (const key of Object.keys(old.results[0])) expect(body.results[0]).toHaveProperty(key);
    expect(body.match).toBe("words");
    expect(body.results[0].match_quality).toBeTruthy();
  });

  it("by default keeps neighbours in results for old callers, marked, and says plainly there was no match", async () => {
    const body = await raw("xyzzyplughqwertz");
    const old = await raw("xyzzyplughqwertz", "&full=1");
    expect(body.total_matches).toBe(old.total_matches);
    expect(body.match).toBe("none");
    expect(body.true_matches).toBe(0);
    expect(body.note).toMatch(/No match/);
    for (const r of body.results) expect(r.match_quality).toBe("nearby");
  });

  it("by default puts an exact ID at the top, in results and on its own", async () => {
    const body = await raw(objectKey);
    expect(body.match).toBe("exact_id");
    expect(body.exact_match.id).toBe(body.results[0].id);
    expect(body.results[0].match_quality).toBe("exact_id");
  });

  it("does not show a private task to the public through the exact path", async () => {
    const hidden = await db().prepare("SELECT task_id, title FROM herma_durable_queue WHERE tier = 'infra_private' LIMIT 1").first();
    expect(hidden).toBeTruthy();
    for (const body of [await raw(hidden.task_id), await search(hidden.task_id)]) {
      expect(JSON.stringify(body.results)).not.toContain(hidden.task_id);
      expect(JSON.stringify(body.nearby)).not.toContain(hidden.task_id);
      expect(body.match).not.toBe("exact_id");
    }
  });

});

describe("review findings, November 4", () => {
  const raw = async (q, extra = "") => (await exports.default.fetch(`https://herma.ta-amps.workers.dev/q/search?q=${encodeURIComponent(q)}${extra}`)).json();
  const limitHit = (reset) => vi.fn(async () => new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) } }));
  afterEach(async () => {
    vi.unstubAllGlobals();
    await clearUpstreamBackoff();
  });

  it("1. /q/search sends nothing the caller typed to anyone", async () => {
    const outbound = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", outbound);
    for (const q of [FAKE_TOKEN, "2026-11-03", "shelter-intake", "nobody/never-indexed"]) {
      await raw(q);
      await raw(q, "&compact=1");
    }
    const toGithub = outbound.mock.calls.filter(([u]) => String(u?.url || u).includes("github.com"));
    expect(toGithub).toEqual([]);
  });

  it("1. /q/search points a repository-shaped miss at the call that can look further, and never echoes a credential", async () => {
    expect((await raw("nobody/never-indexed")).repo_lookup).toBe("/q/repos?repo=nobody/never-indexed");
    const secret = await raw(FAKE_TOKEN);
    expect(secret.repo_lookup).toBeUndefined();
  });

  it("1. /q/repos refuses a credential-shaped name and calls no one", async () => {
    const f = vi.fn();
    for (const qs of [`name=${FAKE_TOKEN}`, "repo=github_pat_abcdefghij0123456789/x", "name=0123456789abcdef0123456789abcdef", "name=sk-proj-abc_def-ghi-jkl", `ask=${encodeURIComponent("What licence does the GitHub repository sk-abcdefghijklmnopqrstuvwx/x use?")}`]) {
      const [body, status] = await call(qs, f);
      expect([qs, status, body.code]).toEqual([qs, 400, "looks_like_a_secret"]);
      expect(JSON.stringify(body)).not.toContain("abcdefghij");
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("1. a real project name that only starts like a credential is still looked up", async () => {
    for (const name of ["sk-learn", "ghp_tools", "AKIA-notes", "eyJ-viewer", "cafe-babe"]) {
      const f = github(200, { total_count: 0, items: [] });
      const [body, status] = await call(`name=${name}`, f);
      expect([name, status, body.code]).toEqual([name, 200, undefined]);
      expect(f).toHaveBeenCalledTimes(1);
    }
  });

  it("2. a stored object named after a plain word does not take first place or exact_match", async () => {
    await exports.default.fetch("https://herma.ta-amps.workers.dev/q/objects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent_id: "t", object_key: "shelter", summary: "buy my thing", payload: { a: 1 } }) });
    const body = await raw("shelter");
    expect(body.match).not.toBe("exact_id");
    expect(body.exact_match).toBeUndefined();
    for (const r of body.results) expect(r.matched_channels).not.toContain("exact_id");
  });

  it("2. repo matches are computed even when an ID also matches exactly", async () => {
    await exports.default.fetch("https://herma.ta-amps.workers.dev/q/objects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent_id: "t", object_key: "shared-name", summary: "an object sharing a repository's name", payload: { a: 1 } }) });
    const body = await raw("shared-name");
    expect(body.match).toBe("exact_id");
    expect(body.repo_matches.rows[0][0]).toBe("acme/shared-name");
  });

  it("3. once GitHub says stop, no one asks again until the wait is over; a plain refusal is not a limit", async () => {
    const f = limitHit(Math.floor(Date.now() / 1000) + 600);
    expect((await call("repo=nobody/limit-one", f))[0].miss).toBe("rate_limited");
    const again = vi.fn();
    for (const n of ["two", "three", "four"]) expect((await call(`repo=nobody/limit-${n}`, again))[0].miss).toBe("rate_limited");
    expect(again).not.toHaveBeenCalled();
    await clearUpstreamBackoff();
    const refused = github(403, {});
    expect((await call("repo=nobody/blocked-one", refused))[0].miss).toBe("refused");
    const next = github(404, {});
    await call("repo=nobody/after-refusal", next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("4. the exact path runs only for one ID-shaped word and uses an index", async () => {
    for (const [table, col, index] of [["herma_task_objects", "object_key", "idx_hto_lower_key"], ["herma_durable_queue", "task_id", "idx_hdq_lower_task"]]) {
      const plan = await db().prepare(`EXPLAIN QUERY PLAN SELECT id FROM ${table} WHERE LOWER(${col}) = ? ORDER BY id DESC LIMIT 1`).bind("x-y").all();
      expect(JSON.stringify(plan.results)).toContain(index);
    }
    const prose = await raw("verb_pub_x and other words");
    expect(prose.exact_match).toBeUndefined();
    expect((await raw(`a-${"b".repeat(200)}`)).exact_match).toBeUndefined();
  });

  it("5. a bare-name match says other owners may exist", async () => {
    expect((await repoMatchesForSearch(db(), "kiln")).other_owners_possible).toBe(true);
    expect((await repoMatchesForSearch(db(), "zed/kiln")).other_owners_possible).toBeUndefined();
  });

  it("6. a withheld repository is counted and named as withheld, never as no match", async () => {
    await db().prepare("INSERT OR REPLACE INTO feed_repo_rows (repo,name,feed,license,language,created,stars,relevant,seen_at) VALUES ('someone/tessera','tessera','memory-systems','MIT','Go','2026-10-01',1,1,?), ('other/tessera','tessera','memory-systems','MIT','Go','2026-10-01',1,1,?)").bind(TODAY, TODAY).run();
    const search = await raw("tessera");
    expect(search.repo_matches.withheld_count).toBe(2);
    expect(search.repo_matches.rows).toEqual([]);
    const [named] = await call("name=tessera");
    expect([named.withheld_count, named.miss]).toEqual([2, "withheld"]);
    expect(named.note).toMatch(/can't be shown/);
    await db().prepare("INSERT OR REPLACE INTO feed_repo_rows (repo,name,feed,license,language,created,stars,relevant,seen_at) VALUES ('a/mixed-name','mixed-name','memory-systems','MIT','Go','2026-10-01',1,1,?)").bind(TODAY).run();
    const mixed = github(200, { total_count: 2, items: [{ name: "mixed-name", full_name: "a/mixed-name", created_at: "2026-10-01T00:00:00Z" }, { name: "mixed-name", full_name: "tessera/mixed-name", created_at: "2026-10-01T00:00:00Z" }] });
    const [asked] = await call(`ask=${encodeURIComponent('A repository named "mixed-name". Which GitHub account owns it?')}`, mixed);
    expect(asked.withheld_count).toBe(1);
    expect(asked.other_owners_possible).toBe(true);
    expect(asked.direct).toBe(false);
  });

  it("7. a direct answer is never given from an old row: it reads through, or gives none", async () => {
    const ask = encodeURIComponent("What software licence does the GitHub repository old/stale use?");
    const changed = github(200, { full_name: "old/stale", license: { spdx_id: "Apache-2.0" }, language: "Python", created_at: "2026-09-10T00:00:00Z", stargazers_count: 5 });
    const [fresh] = await call(`ask=${ask}`, changed);
    expect(changed).toHaveBeenCalledTimes(1);
    expect([fresh.direct, fresh.answer, fresh.source]).toEqual([true, "Apache-2.0", "github"]);
    expect(fresh.rows[0][6]).toBe(TODAY);
    expect(fresh.rows[0][5]).toBe("memory-systems");
    await caches.default.delete(new Request("https://repo-rows.invalid/repos/old/stale"));
    const [noUpstream] = await call(`ask=${ask}`, vi.fn(async () => { throw new Error("down"); }));
    expect(noUpstream.direct).toBe(false);
    expect(noUpstream.rows[0][6]).toBe("2026-01-01");
  });

  it("8. the default reply carries a payload once", async () => {
    await exports.default.fetch("https://herma.ta-amps.workers.dev/q/objects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent_id: "t", object_key: "payload_once_probe_v1", summary: "payload probe", payload: { marker: "only-one-copy-marker" } }) });
    const text = JSON.stringify(await raw("payload_once_probe_v1", "&include_payload=1"));
    expect(text.split("only-one-copy-marker").length - 1).toBe(1);
  });

  it("9. a task and an object sharing an ID both stay, and the same row twice does not", () => {
    const row = (kind, id) => ({ artifact_kind: kind, id, title: id, matched_channels: ["stem_bm25"] });
    const { unique } = splitStrongAndNearby([row("task_object", "same"), row("durable_task", "same"), row("task_object", "same")], "words here");
    expect(unique.map((r) => r.artifact_kind).sort()).toEqual(["durable_task", "task_object"]);
  });

  it("marks a made-up word plainly in the default reply and keeps total_matches", async () => {
    const body = await raw("xyzzyplughqwertzz");
    const old = await raw("xyzzyplughqwertzz", "&full=1");
    expect(body.total_matches).toBe(old.total_matches);
    expect(body.match).toBe("none");
    if (body.results.length) expect(body.results_are_nearby_only).toBe(true);
  });
});
