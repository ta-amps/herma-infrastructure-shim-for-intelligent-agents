// Compact lookup of new GitHub repositories for agents (GET /q/repos). An agent asking about a repository should pay for a
// few hundred characters, not a page of unrelated Task Objects. Rows come from the feed scans (D1 table feed_repo_rows, loaded
// by scripts/repo_rows_refresh.py). A repository the scans never saw is read through to GitHub's public API with no credential;
// that answer is kept only in the edge cache, never in D1, and each request makes at most one upstream call.
import { tidyText } from "./page_shell.js";
import { nameLooksLikeToken } from "./credential_shapes.js";
import { publicNames } from "./public_names.js";

const COLS = ["repo", "license", "language", "created", "stars", "feed", "seen"];
const SEEN = 6;
const DIRECT_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const BACKOFF_MIN_S = 30;
const BACKOFF_MAX_S = 3600;
const isFresh = (row) => {
  const at = Date.parse(row[SEEN] || "");
  return Number.isFinite(at) && Date.now() - at <= DIRECT_MAX_AGE_MS;
};
const FULL_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const BARE_NAME = /^[A-Za-z0-9._-]{1,100}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const POSITIVE_TTL_S = 86400;
const NEGATIVE_TTL_S = 3600;
const MAX_LIMIT = 20;
const UPSTREAM_MS = 4000;

// A name the shared banned-word list or the last-step public-name filter would change is not served at all: changing it would
// make the row false.
const servable = (repo) => tidyText(repo, 400) === repo && publicNames(repo) === repo;

function rowFromDb(r) {
  return [r.repo, r.license || null, r.language || null, r.created || null, r.stars ?? null, r.feed || "", r.seen_at || null];
}

function rowFromGithub(g) {
  const lic = g.license && g.license.spdx_id;
  return [g.full_name, lic && lic !== "NOASSERTION" ? lic : null, g.language || null, String(g.created_at || "").slice(0, 10), g.stargazers_count ?? null, "", new Date().toISOString().slice(0, 10)];
}

async function queryRows(db, sql, binds) {
  try {
    const out = await db.prepare(sql).bind(...binds).all();
    return out?.results || [];
  } catch (err) {
    if (/no such table/i.test(String(err && err.message))) return [];
    throw err;
  }
}

async function asOf(db) {
  const rows = await queryRows(db, "SELECT value FROM feed_repo_meta WHERE key = ?", ["as_of"]);
  return rows[0]?.value || null;
}

function firstPerRepo(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    const k = String(r.repo).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function exactFromDb(db, { repo, name }) {
  const [where, value] = repo ? ["repo = ? COLLATE NOCASE", repo] : ["name = ? COLLATE NOCASE", name];
  const sql = `SELECT repo, license, language, created, stars, feed, seen_at FROM feed_repo_rows WHERE ${where} ORDER BY created DESC LIMIT 40`;
  return firstPerRepo(await queryRows(db, sql, [value]));
}

function cacheStore() {
  try {
    return globalThis.caches?.default || null;
  } catch {
    return null;
  }
}

const backoffKey = (kind) => new Request(`https://repo-rows.invalid/backoff/${kind}`);

async function inBackoff(kind) {
  const cache = cacheStore();
  return cache ? Boolean(await cache.match(backoffKey(kind)).catch(() => null)) : false;
}

// GitHub's public limit is shared by everyone who comes through here, so once it says stop, nobody asks until it says go.
async function startBackoff(kind, res) {
  const cache = cacheStore();
  if (!cache) return;
  const retryAfter = Number(res.headers.get("retry-after"));
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  const wanted = retryAfter > 0 ? retryAfter : reset > 0 ? reset - Math.floor(Date.now() / 1000) : BACKOFF_MIN_S;
  const seconds = Math.min(BACKOFF_MAX_S, Math.max(BACKOFF_MIN_S, wanted));
  await cache.put(backoffKey(kind), new Response("1", { headers: { "cache-control": `public, max-age=${seconds}` } })).catch(() => {});
}

/** For tests. */
export async function clearUpstreamBackoff() {
  const cache = cacheStore();
  if (!cache) return;
  await cache.delete(backoffKey("repos")).catch(() => {});
  await cache.delete(backoffKey("search")).catch(() => {});
}

// Returns { rows, state, complete }. state: found, no_such_repo (GitHub's own 404 for owner/name), not_in_github_search (a search
// page without that exact name, which does not prove absence), rate_limited, refused or unavailable. complete: every exact name is on this page.
async function upstream({ repo, name }, fetchImpl) {
  const path = repo
    ? `/repos/${repo.split("/").map(encodeURIComponent).join("/")}`
    : `/search/repositories?per_page=30&q=${encodeURIComponent(`${name} in:name fork:true`)}`;
  const cacheKey = new Request(`https://repo-rows.invalid${path.toLowerCase()}`);
  const cache = cacheStore();
  if (cache) {
    const hit = await cache.match(cacheKey).catch(() => null);
    if (hit) return hit.json();
  }
  // The rows were read first, so a real repository is still found. Only the trip to GitHub stops here.
  if (nameLooksLikeToken(repo || name)) return { rows: [], state: "not_sent" };
  const kind = repo ? "repos" : "search";
  if (await inBackoff(kind)) return { rows: [], state: "rate_limited" };
  let res;
  try {
    res = await fetchImpl(`https://api.github.com${path}`, {
      headers: { "user-agent": "teleion-fabric-repo-lookup/1 (public metadata only)", accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(UPSTREAM_MS),
    });
  } catch {
    return { rows: [], state: "unavailable" };
  }
  const refusal = res.status === 403 ? await res.clone().text().catch(() => "") : "";
  const limited = res.status === 429 || (res.status === 403 && (res.headers.get("x-ratelimit-remaining") === "0" || res.headers.has("retry-after") || /rate limit|abuse detection/i.test(refusal)));
  if (limited) {
    await startBackoff(kind, res);
    return { rows: [], state: "rate_limited" };
  }
  let out;
  if (res.status === 404) out = { rows: [], state: "no_such_repo" };
  else if (res.status === 403 || res.status === 451) out = { rows: [], state: "refused" };
  else if (!res.ok) return { rows: [], state: "unavailable" };
  else {
    const body = await res.json().catch(() => null);
    if (!body) return { rows: [], state: "unavailable" };
    const items = repo ? [body] : (body.items || []).filter((g) => String(g.name).toLowerCase() === name.toLowerCase());
    const complete = repo ? true : !body.incomplete_results && Number(body.total_count || 0) <= (body.items || []).length;
    out = { rows: items.map(rowFromGithub), state: items.length ? "found" : "not_in_github_search", complete };
  }
  if (cache) {
    const ttl = out.rows.length ? POSITIVE_TTL_S : NEGATIVE_TTL_S;
    await cache
      .put(cacheKey, new Response(JSON.stringify(out), { headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttl}` } }))
      .catch(() => {});
  }
  return out;
}

function withFeeds(rows, feedRows) {
  const feeds = new Map(feedRows.map((r) => [String(r[0]).toLowerCase(), r[5]]));
  return rows.map((r) => {
    const out = [...r];
    out[5] = feeds.get(String(r[0]).toLowerCase()) || r[5];
    return out;
  });
}

async function exactLookup(db, target, fetchImpl, { needFresh = false } = {}) {
  const fromDb = (await exactFromDb(db, target)).map(rowFromDb);
  if (fromDb.length && (!needFresh || fromDb.every(isFresh))) return { rows: fromDb, source: "feed", state: "found", complete: Boolean(target.repo) };
  let up = await upstream(target, fetchImpl);
  // GitHub's direct lookup and its search have separate limits. When the first is used up, the search can still find the exact repository.
  if (target.repo && !up.rows.length && up.state === "rate_limited") {
    const wanted = target.repo.toLowerCase();
    const found = await upstream({ name: target.repo.split("/")[1] }, fetchImpl);
    const exact = found.rows.filter((r) => String(r[0]).toLowerCase() === wanted);
    if (exact.length) up = { rows: exact, state: "found", complete: true };
    else if (found.state === "rate_limited") up = found;
    else up = { rows: [], state: "not_in_github_search", complete: false };
  }
  if (fromDb.length && !up.rows.length) return { rows: fromDb, source: "feed", state: "found", complete: false };
  return { rows: withFeeds(up.rows, fromDb), source: "github", state: up.state, complete: Boolean(up.complete) };
}

// For a question asked by bare name: every owner, or as many as can be known. The rows hold only what the scans saw, so GitHub is
// asked too. When GitHub's list is complete it wins, so an owner who moved or deleted the repository is not named.
async function allOwners(db, name, fetchImpl) {
  const fromDb = (await exactFromDb(db, { name })).map(rowFromDb);
  const up = await upstream({ name }, fetchImpl);
  if (up.complete && up.rows.length) return { rows: withFeeds(up.rows, fromDb), source: "github", state: "found", complete: true };
  const seen = new Set(fromDb.map((r) => String(r[0]).toLowerCase()));
  const rows = [...fromDb, ...up.rows.filter((r) => !seen.has(String(r[0]).toLowerCase()))];
  return { rows, source: fromDb.length ? "feed" : "github", state: rows.length ? "found" : up.state, complete: false };
}

// A direct answer is given only for these plain, present-tense sentences about one repository. Anything else goes to the caller's model.
const REPO_IN_ASK = "((?:[A-Za-z0-9][A-Za-z0-9-]{0,38})/[A-Za-z0-9._-]*[A-Za-z0-9_-])";
const ASK_FORMS = [
  [1, new RegExp(`^What (?:software )?licen[cs]e does (?:the )?(?:GitHub )?(?:repository |repo )?${REPO_IN_ASK} use\\?$`, "i")],
  [2, new RegExp(`^What is the (?:primary )?(?:programming )?language of (?:the )?(?:GitHub )?(?:repository |repo )?${REPO_IN_ASK}\\?$`, "i")],
  [0, new RegExp(`^Who owns (?:the )?(?:GitHub )?(?:repository |repo )?${REPO_IN_ASK}\\?$`, "i")],
];
const ASK_OWNER_BY_NAME = /^(?:An? )?(?:public )?(?:GitHub )?(?:repository|repo) named "([A-Za-z0-9._-]{2,100})"(?:, created in (20\d\d-\d\d))?\. Which GitHub (?:account|organi[sz]ation)(?: or organi[sz]ation)? owns it\?$/i;

function parseAsk(ask) {
  const text = String(ask).slice(0, 600).trim().replace(/\s+Answer with [a-z ]{1,40}\.$/i, "");
  for (const [field, form] of ASK_FORMS) {
    const m = text.match(form);
    if (m) return { field, repo: m[1], name: null, month: null };
  }
  const named = text.match(ASK_OWNER_BY_NAME);
  if (named) return { field: 0, repo: null, name: named[1], month: named[2] || null };
  const anyRepo = text.match(new RegExp(`(?:^|[\\s(\`"'])${REPO_IN_ASK}`));
  const quoted = text.match(/["`]([A-Za-z0-9._-]{2,100})["`]/);
  return { field: -1, repo: anyRepo ? anyRepo[1] : null, name: !anyRepo && quoted ? quoted[1] : null, month: null };
}

function directAnswer(parsed, found) {
  if (parsed.field < 0 || !found.complete) return null;
  const fits = parsed.month ? found.rows.filter((r) => String(r[3] || "").startsWith(parsed.month)) : found.rows;
  if (fits.length !== 1) return null;
  const row = fits[0];
  if (!isFresh(row)) return null;
  if (parsed.field === 0) return { answer: String(row[0]).split("/")[0], field: "owner", repo: row[0] };
  const value = row[parsed.field];
  if (!value || /^(unknown|other)$/i.test(String(value))) return null;
  return { answer: value, field: parsed.field === 1 ? "license" : "language", repo: row[0] };
}

async function listRows(db, p) {
  const where = ["relevant = 1"];
  const binds = [];
  const add = (clause, value) => {
    where.push(clause);
    binds.push(value);
  };
  if (p.feed) add("feed = ?", p.feed);
  if (p.language) add("language = ? COLLATE NOCASE", p.language);
  if (p.license) add("license = ? COLLATE NOCASE", p.license);
  if (p.since) add("created >= ?", p.since);
  if (p.until) add("created <= ?", p.until);
  if (p.maxStars !== null) add("stars <= ?", p.maxStars);
  // D1 refuses a LIKE pattern over 50 bytes with a 500, so a long word is matched on its first part.
  for (const word of p.words) add("repo LIKE ? ESCAPE '\\'", `%${word.slice(0, 20).replace(/[%_\\]/g, "\\$&")}%`);
  const order = p.sort === "new" ? "created DESC, repo" : "stars DESC, created DESC, repo";
  const sql = `SELECT repo, license, language, created, stars, MIN(feed) AS feed, MAX(seen_at) AS seen_at FROM feed_repo_rows WHERE ${where.join(" AND ")} GROUP BY repo ORDER BY ${order} LIMIT ? OFFSET ?`;
  return queryRows(db, sql, [...binds, p.limit + 1, p.offset]);
}

const missNote = {
  no_such_repo: "GitHub says there is no public repository at that address.",
  not_in_github_search: "Not in the feed rows, and GitHub's search shows no repository with that exact name. It may still exist.",
  rate_limited: "Not in the feed rows. GitHub's public limit is used up for now, so this is not a statement that it does not exist.",
  refused: "Not in the feed rows. GitHub refused to show this repository, so this is not a statement that it does not exist.",
  unavailable: "Not in the feed rows. GitHub did not answer, so this is not a statement that it does not exist.",
  not_sent: "Not in the feed rows. It looks like a credential, so it was not sent to GitHub. If it is a real repository name, ask GitHub directly.",
  withheld: "A repository matches, but its name can't be shown here.",
};

/** The handler for GET /q/repos. Returns [body, status]. */
export async function repoRowsResponse(url, db, { fetchImpl = (...a) => fetch(...a) } = {}) {
  const q = url.searchParams;
  const asked = q.get("ask");
  const parsed = asked ? parseAsk(asked) : null;
  const repo = ((parsed ? parsed.repo : q.get("repo")) || "").trim();
  const name = ((parsed ? parsed.name : q.get("name")) || "").trim();
  const as_of = await asOf(db);
  const base = { ok: true, as_of, cols: COLS };

  if (repo || name) {
    if (repo ? !FULL_NAME.test(repo) : !BARE_NAME.test(name)) {
      return [{ ok: false, code: "bad_name", detail: "Use repo=owner/name or name=repo-name." }, 400];
    }
    const found = parsed && name ? await allOwners(db, name, fetchImpl) : await exactLookup(db, repo ? { repo } : { name }, fetchImpl, { needFresh: Boolean(parsed) });
    const all = found.rows.slice(0, MAX_LIMIT);
    const rows = all.filter((r) => servable(String(r[0])));
    const withheld = all.length - rows.length;
    const body = { ...base, source: found.source, rows };
    if (withheld) body.withheld_count = withheld;
    if (name && rows.length && (!found.complete || withheld)) body.other_owners_possible = true;
    if (parsed) {
      const direct = directAnswer(parsed, { rows, complete: found.complete && !withheld });
      if (direct) Object.assign(body, { direct: true }, direct);
      else body.direct = false;
    }
    if (!rows.length) {
      const miss = withheld ? "withheld" : found.state;
      body.miss = miss;
      if (missNote[miss]) body.note = missNote[miss];
    }
    return [body, 200];
  }

  if (asked) return [{ ...base, direct: false, rows: [], note: "Name a repository as owner/name or in quotes." }, 200];

  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(q.get("limit") || "5", 10) || 5));
  const offset = Math.min(5000, Math.max(0, Number.parseInt(q.get("offset") || "0", 10) || 0));
  const since = q.get("since") || "";
  const until = q.get("until") || "";
  if ((since && !DATE.test(since)) || (until && !DATE.test(until))) {
    return [{ ok: false, code: "bad_date", detail: "Dates are YYYY-MM-DD." }, 400];
  }
  const maxRaw = q.get("max_stars");
  const params = {
    feed: q.get("feed") || "",
    language: q.get("language") || "",
    license: q.get("license") || "",
    since,
    until: until ? `${until}~` : "",
    maxStars: maxRaw !== null && /^\d+$/.test(maxRaw) ? Number(maxRaw) : null,
    words: (q.get("q") || "").split(/\s+/).filter(Boolean).slice(0, 5),
    sort: q.get("sort") || "stars",
    limit,
    offset,
  };
  if (!params.feed && !params.language && !params.license && !since && !params.words.length) {
    return [{ ok: false, code: "needs_a_filter", detail: "Use repo=owner/name, name=repo-name, ask=<question>, or filters: feed, language, license, since, until, max_stars, q, sort=stars|new, limit, offset.", feeds: ["memory-systems", "pii-redaction", "ocr-llm", "agent-harnesses", "eval-frameworks"] }, 400];
  }
  const got = await listRows(db, params);
  const rows = got.slice(0, limit).filter((r) => servable(String(r.repo))).map(rowFromDb);
  const body = { ...base, source: "feed", rows };
  if (got.length > limit) body.next_offset = offset + limit;
  return [body, 200];
}

/** Rows for an exact repository name typed into /q/search, from the rows only: nothing the caller typed leaves here. Never throws. */
export async function repoMatchesForSearch(db, query) {
  const text = String(query || "").trim();
  const target = FULL_NAME.test(text) ? { repo: text } : BARE_NAME.test(text) ? { name: text } : null;
  if (!target) return null;
  try {
    const all = (await exactFromDb(db, target)).map(rowFromDb).slice(0, MAX_LIMIT);
    if (!all.length) return null;
    const rows = all.filter((r) => servable(String(r[0])));
    const out = { cols: COLS, rows: rows.slice(0, 3), source: "feed" };
    const more = rows.length - out.rows.length;
    if (all.length !== rows.length) out.withheld_count = all.length - rows.length;
    if (more) out.more_rows = more;
    if (target.name) out.other_owners_possible = true;
    return out;
  } catch {
    return null;
  }
}

/** The one call that can look further, for a query shaped like a repository name. */
export function repoLookupHint(query) {
  const text = String(query || "").trim();
  if (!/[/_-]/.test(text) || nameLooksLikeToken(text)) return null;
  if (FULL_NAME.test(text)) return `/q/repos?repo=${text}`;
  return BARE_NAME.test(text) ? `/q/repos?name=${text}` : null;
}
