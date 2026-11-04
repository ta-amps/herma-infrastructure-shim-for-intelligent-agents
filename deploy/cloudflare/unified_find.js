// GET /q/find?q=...: one call, one short reply, over repositories, Task Objects, kits and seed packs. Plain code only: no model call, nothing a caller
// types leaves here. The index is built from public rows (same visibility as /q/search) plus a snapshot of the library's words made ahead of time.
import { tidyText } from "./page_shell.js";
import { publicNames } from "./public_names.js";
import CATALOG from "./find_catalog.generated.json" with { type: "json" };

const INDEX_TTL_MS = 10 * 60 * 1000;
const MAX_TOKENS = 800000;
const COLD_WAIT_MS = 3000;
const MAYBE_HITS = 3;
const SPARE_HITS = 3;
const HINT_TITLE_CHARS = 120;
const HINT_CHECK_MS = 300;
const RELOAD_GAP_MS = 60 * 1000;
const ROWS_TTL_S = 300;
const MAX_OBJECT_ROWS = 8000;
const MAX_REPO_ROWS = 12000;
const KITS_TTL_S = 900;
const KITS_FETCH_MS = 2500;
const ABOUT_CHARS = 140;
const MAX_LIMIT = 10;
const DEFAULT_LIMIT = 5;
const PUBLIC_VIS = "visibility IN ('public_ngo', 'public_commons')";
// A different worker found this false: it can't be offered for reuse. Asked for by its exact id, it still reads.
const REUSABLE = `${PUBLIC_VIS} AND is_tombstoned = 0 AND COALESCE(verification_verdict, '') != 'REFUTED'`;
const SITE = "https://shim.teleionlabs.com";
const LIBRARY = "https://github.com/ta-amps/seed-packs-library-of-nouns-and-verbs/tree/main/packs";
const ERANOS = "https://eranosforgood.org";
// Tuned on the dev questions only.
export const TUNE = {
  k1: 1.2, b: 0.5, name: 3, words: 1.5, about: 1, tags: 1,
  minCoverage: 0.6, minCoverageLong: 0.4, longTerms: 4, minScore: 2.0, phrase: 1.3, also: 0.7,
  maybeCoverage: 0.35, maybeCoverageLong: 0.2, maybeScore: 1.5,
  kindPrior: { pack: 1.6, kit: 1.6, obj: 1, repo: 0.75 }, askedKind: 3, junk: 0.55, reuse: 0.04, stars: 0.03,
};
const LOW_VALUE = new Set(["worker_memory", "system_feedback_signal", "worker_issue_report", "peer_review", "aggregate_review_digest", "version_propagation_recheck", "aggregate_review_plan", "eval_and_rank", "evaluation_rubric", "public_general", "discovery_candidate", "feed_run"]);
const STOP_WORDS = "a an and are as at be by can could do does for from get give go had has have help how i if in into is it its just let like looking make me my need needs of on or our please should show so some something someone sure that the their them there these this those to tool tools us use using want wants was way we were what when where which who why will with would you your find tell";
// Everyday word -> words the library uses. Plain code, reported in `rewrote` only when it fixed a misspelling. Tuned on the dev questions only.
const ALSO = Object.assign(Object.create(null), {
  scan: ["ocr"], scann: ["ocr", "scan"], read: ["ocr"], form: ["intake"], remember: ["memory", "recall"], session: ["memory"], helper: ["volunteer", "agent"], automat: ["agent"], recording: ["video"], clip: ["video", "cutdown"], picture: ["video", "frame"], handout: ["flyer"], leaflet: ["flyer"],
  spoken: ["voice", "narration"], voice: ["narration"], explainer: ["video"], fund: ["grant", "funding"], funder: ["grant", "funding"], donor: ["donation"], spend: ["cost"], bill: ["cost"], price: ["cost"], cheap: ["cost"], translate: ["translation", "multilingual"], translated: ["translation", "multilingual"],
  bug: ["defect", "regression"], ship: ["release", "launch"], publish: ["release"], law: ["policy", "rule"], government: ["policy", "public"], requirement: ["rule"], job: ["recruit", "contract"], abroad: ["overseas"], pressur: ["coerc"], outdated: ["freshness", "stale"], unsupported: ["claim"], unusual: ["edge", "corner"], evidence: ["research"], promise: ["claim"], assistance: ["aid", "support"], provider: ["partner", "directory"],
  privacy: ["pii", "anonymiz", "redaction"], identity: ["pii", "anonymiz"], anonym: ["pii", "kanon"], sparse: ["suppression"], boat: ["riverine"], phone: ["ussd", "sms"], menu: ["ussd"], pump: ["water"], cold: ["subzero", "arctic"], blind: ["tactile", "accessibility"], keyboard: ["accessibility"], tuning: ["tune"], improve: ["tune"], trial: ["pilot", "drill"], exercise: ["drill"], practice: ["drill"],
});
const ASK_KIND = [[/\b(?:repos?|repositor(?:y|ies)|github|projects?)\b/i, "repo"], [/\b(?:seed[- ]?packs?|packs?)\b/i, "pack"], [/\bkits?\b/i, "kit"], [/\b(?:task[- ]?objects?|objects?)\b/i, "obj"]];
const KIND_WORDS = /\b(?:repos?|repositor(?:y|ies)|github|seed[- ]?packs?|packs?|kits?|task[- ]?objects?)\b/gi;
const ID_LOOKUP = /^(?=.{3,128}$)(?=.*(?:[_:]|[0-9]{2}))[A-Za-z0-9]+(?:[-_.:][A-Za-z0-9]+)+$/;
const NAME_SHAPE = /^[A-Za-z0-9]+(?:[-_.:][A-Za-z0-9]+)+$/;
const ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,127}$/;

export function stem(t) {
  if (t.length > 4 && t.endsWith("ies")) return `${t.slice(0, -3)}y`;
  if (t.length > 5 && t.endsWith("ing")) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith("ed")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !/(?:ss|us|is)$/.test(t)) return t.slice(0, -1);
  return t;
}
export function tokens(text) {
  return String(text || "")
    .replace(/([\p{Ll}0-9])(\p{Lu})/gu, "$1 $2")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1)
    .map(stem);
}
const STOP = new Set(STOP_WORDS.split(" ").map(stem));
const familyOf = (key) => key.replace(/(?:[_-](?:v?\d+|muse.*|codex.*|scale-test.*))+$/i, "").toLowerCase();

function editWithin(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return false;
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      cur[j] = d;
      if (d < best) best = d;
    }
    if (best > limit) return false;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length] <= limit;
}

/** rows: the public rows. Pure, so tests can build an index with no database. */
export function buildIndex({ objects = [], repos = [], kits = [], packs = [], feedWords = {}, terms = {} }) {
  const docs = [];
  const tfs = [];
  let spent = 0;
  const add = (d, fields) => {
    const tf = new Map();
    let len = 0;
    for (const [text, w] of fields) {
      // Anyone may store text, so the index has a size it won't pass: past it, only names go in. Live rows use a fraction of this.
      if (w !== TUNE.name && spent >= MAX_TOKENS) continue;
      for (const t of tokens(text)) {
        spent += 1;
        tf.set(t, (tf.get(t) || 0) + w);
        len += w;
      }
    }
    tfs.push(tf);
    docs.push({ ...d, len });
  };
  for (const p of packs) add({ kind: "pack", id: p.id, title: p.title, about: p.about, url: `${LIBRARY}/${p.id}`, prior: TUNE.kindPrior.pack }, [[`${p.id} ${p.title}`, TUNE.name], [terms[`pack:${p.id}`]?.join(" "), TUNE.words], [p.about, TUNE.about], ["seed pack", TUNE.tags]]);
  for (const k of kits) add({ kind: "kit", id: k.id, title: k.title, about: k.about, url: `${ERANOS}/catalog/${k.id}`, prior: TUNE.kindPrior.kit }, [[`${k.id} ${k.title}`, TUNE.name], [terms[`kit:${k.id}`]?.join(" "), TUNE.words], [k.about, TUNE.about], [k.tags, TUNE.tags]]);
  const seenRepo = new Map();
  for (const r of repos) {
    const low = String(r.repo).toLowerCase();
    // A row the scan marked not relevant still answers to its exact name, but its feed's words don't describe it.
    const feeds = r.relevant === 0 ? [] : [r.feed];
    const got = seenRepo.get(low);
    if (got) got.feeds.push(...feeds);
    else seenRepo.set(low, { ...r, feeds });
  }
  for (const r of seenRepo.values()) {
    const feedText = r.feeds.map((f) => `${f} ${feedWords[f] || ""}`).join(" ");
    add({ kind: "repo", id: r.repo, title: r.repo, about: [r.language, r.license, r.stars != null ? `${r.stars} stars` : "", r.feeds[0]].filter(Boolean).join(", "), url: `https://github.com/${r.repo}`, prior: TUNE.kindPrior.repo * (1 + TUNE.stars * Math.log1p(Number(r.stars) || 0)), name: String(r.name).toLowerCase(), owner: String(r.repo).toLowerCase().split("/")[0], stars: Number(r.stars) || 0 }, [[r.repo, TUNE.name], [feedText, TUNE.tags], [`${r.language || ""} ${r.license || ""}`, TUNE.tags]]);
  }
  for (const o of objects) {
    const prior = (LOW_VALUE.has(o.category) ? TUNE.junk : TUNE.kindPrior.obj) * (1 + TUNE.reuse * Math.log1p(Number(o.reuse_count) || 0));
    add({ kind: "obj", id: o.object_key, title: o.object_key, about: o.summary, url: `${SITE}/q/object/${encodeURIComponent(o.object_key)}`, prior, family: familyOf(o.object_key), reuse: Number(o.reuse_count) || 0 }, [[o.object_key, TUNE.name], [terms[`obj:${o.object_key}`]?.join(" "), TUNE.words], [o.summary, TUNE.about], [o.category, TUNE.tags]]);
  }
  const postings = new Map();
  let total = 0;
  docs.forEach((d, i) => {
    total += d.len;
    for (const [t, w] of tfs[i]) {
      if (!postings.has(t)) postings.set(t, []);
      postings.get(t).push([i, w]);
    }
  });
  const exact = new Map();
  const names = new Map();
  const owners = new Map();
  docs.forEach((d, i) => {
    // The library's own names first: a stored object can't take a pack's, kit's or repository's exact name.
    if (!exact.has(d.id.toLowerCase())) exact.set(d.id.toLowerCase(), i);
    if (d.name) {
      if (!names.has(d.name)) names.set(d.name, []);
      names.get(d.name).push(i);
    }
    if (d.owner) {
      if (!owners.has(d.owner)) owners.set(d.owner, []);
      owners.get(d.owner).push(i);
    }
  });
  // Packs and kits are few and have real titles, so a whole title is worth checking, typos and all.
  const titles = [];
  docs.forEach((d, i) => {
    if (d.kind === "pack" || d.kind === "kit") titles.push([squash(d.title), i]);
  });
  const vocab = new Map();
  for (const [t, list] of postings) {
    if (t.length >= 4 && /^[a-z]+$/.test(t)) {
      const c = t[0];
      if (!vocab.has(c)) vocab.set(c, []);
      vocab.get(c).push([t, list.length]);
    }
  }
  return { docs, postings, exact, names, owners, vocab, titles, avgLen: total / Math.max(1, docs.length), size: docs.length };
}

function correctWord(index, t) {
  const limit = t.length >= 7 ? 2 : 1;
  let best = null;
  for (const [v, df] of index.vocab.get(t[0]) || []) {
    if (df >= 2 && editWithin(t, v, limit) && (!best || df > best[1])) best = [v, df];
  }
  return best ? best[0] : null;
}
function closestName(index, low) {
  const top = low.length >= 8 ? 2 : 1;
  for (let limit = 1; limit <= top; limit += 1) {
    for (const keys of [index.exact.keys(), index.names.keys()]) {
      for (const k of keys) if (editWithin(low, k, limit)) return k;
    }
  }
  return null;
}
const squash = (t) => String(t || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
/** Every pack and kit at the closest distance: a kit and a pack can share a title. */
function closestTitle(index, low) {
  const q = squash(low);
  if (q.length < 8) return null;
  const limit = q.length >= 16 ? 3 : 2;
  for (let l = 0; l <= limit; l += 1) {
    const near = index.titles.filter(([title]) => editWithin(q, title, l)).map(([, i]) => i);
    if (near.length) return near;
  }
  return null;
}

/** The ranking, on an index. Returns { found, match, hits, rewrote }. Pure. */
export function searchIndex(index, rawQuery, limit = DEFAULT_LIMIT) {
  const q = String(rawQuery || "").trim().slice(0, 300);
  const low = q.toLowerCase();
  if (!q) return { found: false, match: "none", hits: [] };
  const take = (list, match, extra = {}) => ({ found: list.length > 0, match: list.length ? match : "none", hits: list.slice(0, limit), ...extra });
  const askedKind = ASK_KIND.find(([re]) => re.test(q))?.[1] || null;
  const hit = (i) => index.docs[i];
  if (index.exact.has(low) && !hit(index.exact.get(low)).gone) return take([hit(index.exact.get(low))], "exact");
  const bareOwner = low.match(/^(?:(?:github\s+)?(?:repos?|repositor(?:y|ies)|projects?)\s+(?:by|from|of)\s+|(?:by|owner)\s+)([a-z0-9][a-z0-9-]*)$/);
  const ownerName = bareOwner ? bareOwner[1] : /^[a-z0-9][a-z0-9-]*$/.test(low) ? low : null;
  if (!/\s/.test(low) && index.names.has(low)) {
    return take(index.names.get(low).map(hit).sort((a, b) => b.stars - a.stars), "name");
  }
  if (ownerName && index.owners.has(ownerName)) {
    return take(index.owners.get(ownerName).map(hit).sort((a, b) => b.stars - a.stars), "owner");
  }
  if (!/\s/.test(low) && low.length >= 4 && /[_-]/.test(low)) {
    const pre = index.docs.filter((d) => d.kind === "obj" && !d.gone && d.id.toLowerCase().startsWith(low)).sort((a, b) => b.reuse - a.reuse || a.id.length - b.id.length);
    if (pre.length) return take(pre, "prefix");
  }
  const askedTitle = askedKind ? low.replace(KIND_WORDS, " ").replace(/^\s*for\s+/, "") : low;
  const titled = closestTitle(index, askedTitle);
  if (titled) return take(titled.map(hit).sort((a, b) => Number(b.kind === (askedKind || "kit")) - Number(a.kind === (askedKind || "kit"))), "title");
  let rewrote = null;
  if (!/\s/.test(low) && low.length >= 6 && ID_SHAPE.test(low)) {
    const near = closestName(index, low);
    if (near) {
      if (index.exact.has(near) && !hit(index.exact.get(near)).gone) return take([hit(index.exact.get(near))], "near_name", { rewrote: near });
      if (index.names.has(near)) return take(index.names.get(near).map(hit).sort((a, b) => b.stars - a.stars), "near_name", { rewrote: near });
    }
  }
  const stripped = askedKind ? q.replace(KIND_WORDS, " ") : q;
  let terms = [...new Set(tokens(stripped))].filter((t) => !STOP.has(t));
  if (!terms.length) terms = [...new Set(tokens(q))];
  const fixed = [];
  terms = terms.map((t) => {
    if (index.postings.has(t) || t.length < 4 || !/^[a-z]+$/.test(t)) return t;
    const c = correctWord(index, t);
    if (c) fixed.push(`${t}>${c}`);
    return c || t;
  });
  if (fixed.length) rewrote = fixed.join(" ");
  const N = index.size;
  const idf = (t) => {
    const df = index.postings.get(t)?.length || 0;
    return Math.log(1 + (N - df + 0.5) / (df + 0.5));
  };
  // A term's weight is its own rareness, but an everyday word missing from the library doesn't count against the match if a word it stands for is there.
  const weightOf = (t) => (index.postings.has(t) || !ALSO[t] ? idf(t) : Math.min(idf(t), ...ALSO[t].map(stem).map(idf)));
  const totalIdf = terms.reduce((s, t) => s + weightOf(t), 0) || 1;
  const scores = new Map();
  for (const t of terms) {
    const w = weightOf(t);
    const seen = new Map();
    for (const [form, gain] of [[t, 1], ...(ALSO[t] || []).map((a) => [stem(a), TUNE.also])]) {
      for (const [i, tf] of index.postings.get(form) || []) {
        const d = index.docs[i];
        const part = gain * (idf(form) * tf * (TUNE.k1 + 1)) / (tf + TUNE.k1 * (1 - TUNE.b + (TUNE.b * d.len) / index.avgLen));
        if (part > (seen.get(i) || 0)) seen.set(i, part);
      }
    }
    for (const [i, part] of seen) {
      const cur = scores.get(i) || { s: 0, m: 0, n: 0 };
      cur.s += part;
      cur.m += w;
      cur.n += 1;
      scores.set(i, cur);
    }
  }
  const minCoverage = terms.length >= TUNE.longTerms ? TUNE.minCoverageLong : TUNE.minCoverage;
  const phrase = terms.join(" ");
  const ranked = [];
  for (const [i, { s, m, n }] of scores) {
    const d = index.docs[i];
    if (d.gone) continue;
    const coverage = m / totalIdf;
    let v = s * d.prior * (0.25 + 0.75 * coverage);
    if (askedKind && d.kind === askedKind) v *= TUNE.askedKind;
    if (terms.length > 1 && tokens(`${d.id} ${d.title}`).join(" ").includes(phrase)) v *= TUNE.phrase;
    ranked.push({ d, v, coverage, raw: s, n });
  }
  ranked.sort((a, b) => b.v - a.v);
  const fits = (r) => r.raw >= TUNE.minScore && r.coverage >= minCoverage && (terms.length < TUNE.longTerms || r.n >= 2);
  const top = ranked.find(fits);
  if (!top) {
    // Not an answer, and it says so: found stays false. A caller with a model of its own can read these and decide, or ask again.
    const low2 = terms.length >= TUNE.longTerms ? TUNE.maybeCoverageLong : TUNE.maybeCoverage;
    const maybe = [];
    const fam = new Set();
    for (const r of ranked) {
      if (r.raw < TUNE.maybeScore || r.coverage < low2 || (r.d.family && fam.has(r.d.family))) continue;
      if (r.d.family) fam.add(r.d.family);
      maybe.push(r.d);
      if (maybe.length >= MAYBE_HITS) break;
    }
    return { found: false, match: "none", hits: [], maybe, ...(rewrote ? { rewrote } : {}) };
  }
  const seen = new Set();
  const list = [];
  for (const r of ranked) {
    if (!fits(r)) continue;
    const fam = r.d.family;
    if (fam) {
      if (seen.has(fam)) continue;
      seen.add(fam);
    }
    list.push(r.d);
    if (list.length >= limit) break;
  }
  return take(list, "words", rewrote ? { rewrote } : {});
}

function hitForReply(d) {
  return { ref: `${d.kind}:${d.id}`, kind: d.kind === "obj" ? "task_object" : d.kind === "pack" ? "seed_pack" : d.kind, id: d.id, title: tidyText(String(d.title || ""), 120), about: tidyText(String(d.about || ""), 400).slice(0, ABOUT_CHARS), url: d.url };
}

async function kitsLive() {
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request("https://find-index.invalid/kits-v1");
  try {
    const got = await cache?.match(key);
    if (got) return await got.json();
    const res = await fetch(`${ERANOS}/api/catalog`, { signal: AbortSignal.timeout(KITS_FETCH_MS), headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const body = await res.json();
    const kits = (body.kits || []).map((k) => ({ id: k.kit?.kit_id, title: k.kit?.title, about: k.kit?.summary, tags: (k.tags || []).filter((t) => /^(?:domain|track):/.test(t)).join(" ") })).filter((k) => k.id);
    if (!kits.length) return null;
    await cache?.put(key, new Response(JSON.stringify(kits), { headers: { "content-type": "application/json", "cache-control": `max-age=${KITS_TTL_S}` } }));
    return kits;
  } catch {
    return null;
  }
}

let held = null;
let coldLoadAt = 0;
/** For tests. */
export async function resetFindIndex() {
  held = null;
  coldLoadAt = 0;
  await caches.default.delete(new Request("https://find-index.invalid/rows-v1")).catch(() => {});
}
// The rows change slowly and every cold isolate needs them, so one copy per data center saves the database a full read each time.
async function publicRows(db) {
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request("https://find-index.invalid/rows-v1");
  try {
    const got = await cache?.match(key);
    if (got) return await got.json();
  } catch {
    // The database still answers.
  }
  const [objects, repos] = await Promise.all([
    db.prepare(`SELECT object_key, category, SUBSTR(summary, 1, 500) AS summary, reuse_count FROM herma_task_objects WHERE ${REUSABLE} ORDER BY id DESC LIMIT ?`).bind(MAX_OBJECT_ROWS).all().then((r) => r?.results || []),
    db.prepare("SELECT repo, name, feed, license, language, stars, relevant FROM feed_repo_rows LIMIT ?").bind(MAX_REPO_ROWS).all().then((r) => r?.results || []).catch(() => []),
  ]);
  const rows = { objects, repos };
  await cache?.put(key, new Response(JSON.stringify(rows), { headers: { "content-type": "application/json", "cache-control": `max-age=${ROWS_TTL_S}` } })).catch(() => {});
  return rows;
}
async function loadIndex(db) {
  const [{ objects, repos }, kits] = await Promise.all([publicRows(db), kitsLive()]);
  const servable = repos.filter((r) => tidyText(r.repo, 400) === r.repo && publicNames(r.repo) === r.repo);
  return buildIndex({ objects, repos: servable, kits: kits || CATALOG.kits, packs: CATALOG.packs, feedWords: CATALOG.feedWords, terms: CATALOG.terms });
}
function refreshLater(db, waitUntil) {
  // Old rows answer while new ones load. A promise can't be shared between requests on Workers, so nobody waits on this one.
  if (!waitUntil || (held.reloadedAt && Date.now() - held.reloadedAt < RELOAD_GAP_MS)) return;
  held.reloadedAt = Date.now();
  waitUntil(loadIndex(db).then((index) => {
    held = { index, at: Date.now() };
  }).catch(() => {}));
}
async function currentIndex(db, waitUntil) {
  if (held) {
    if (Date.now() - held.at >= INDEX_TTL_MS) {
      if (waitUntil) refreshLater(db, waitUntil);
      else if (Date.now() - (held.reloadedAt || 0) >= RELOAD_GAP_MS) {
        // No way to finish later on this path, so it waits, once a minute at most, and old rows still answer if this fails.
        held.reloadedAt = Date.now();
        const old = held;
        const fresh = await loadIndex(db).catch(() => null);
        if (fresh) held = { index: fresh, at: Date.now() };
        return fresh || old.index;
      }
    }
    return held.index;
  }
  // One cold load at a time in this isolate. A promise can't be shared between requests, so a later request looks again for a moment before starting its own.
  for (const end = Date.now() + COLD_WAIT_MS; coldLoadAt && Date.now() - coldLoadAt < COLD_WAIT_MS && Date.now() < end && !held; ) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (held) return held.index;
  coldLoadAt = Date.now();
  try {
    const index = await loadIndex(db);
    held = { index, at: Date.now() };
    return index;
  } finally {
    coldLoadAt = 0;
  }
}

/** Rows can leave public view after the index was built, so object hits are read again now. If that can't be done, they aren't shown. */
async function stillPublic(db, hits) {
  const keys = hits.filter((d) => d.kind === "obj").map((d) => d.id);
  if (!keys.length) return hits;
  let live = new Set();
  let failed = false;
  try {
    const out = await db.prepare(`SELECT object_key FROM herma_task_objects WHERE ${REUSABLE} AND object_key IN (${keys.map(() => "?").join(",")})`).bind(...keys).all();
    live = new Set((out?.results || []).map((r) => r.object_key));
  } catch {
    // Fail closed: the kinds that need no check still answer.
    failed = true;
  }
  // Marked gone in this index, so a newer version in the same family can answer until the next load.
  for (const d of hits) if (d.kind === "obj" && !live.has(d.id) && !failed) d.gone = true;
  return hits.filter((d) => d.kind !== "obj" || live.has(d.id));
}

async function lookupId(db, low) {
  // The same visibility as the index. The index on LOWER() exists once /q/search has run once; without it this is a scan of a small table.
  const task = await db.prepare(`SELECT task_id, title, prompt FROM herma_durable_queue WHERE ${PUBLIC_VIS} AND LOWER(task_id) = ? LIMIT 1`).bind(low).first();
  if (task) return { kind: "task", id: task.task_id, title: task.title, about: task.prompt, url: `${SITE}/q/task/${encodeURIComponent(task.task_id)}` };
  const obj = await db.prepare(`SELECT object_key, summary FROM herma_task_objects WHERE ${PUBLIC_VIS} AND is_tombstoned = 0 AND LOWER(object_key) = ? LIMIT 1`).bind(low).first();
  return obj ? { kind: "obj", id: obj.object_key, title: obj.object_key, about: obj.summary, url: `${SITE}/q/object/${encodeURIComponent(obj.object_key)}` } : null;
}

/** Hits for a Task's title, for the claim reply: only a clear words match, only things worth reading. A claim never builds the index and never waits for
 * one: with none here yet it starts one for the next claim and goes on. Never throws. */
export async function reuseHintsForTask(db, title, { limit = 3, waitUntil } = {}) {
  try {
    if (!held) {
      if (!coldLoadAt && waitUntil) {
        coldLoadAt = Date.now();
        waitUntil(loadIndex(db).then((index) => {
          held = { index, at: Date.now() };
        }).catch(() => {}).finally(() => {
          coldLoadAt = 0;
        }));
      }
      return [];
    }
    if (Date.now() - held.at >= INDEX_TTL_MS) refreshLater(db, waitUntil);
    const out = searchIndex(held.index, String(title || "").slice(0, HINT_TITLE_CHARS), limit * 2);
    if (!out.found || out.match !== "words") return [];
    // Optional, so it never holds up a lease that is already issued.
    let timer;
    const late = new Promise((resolve) => {
      timer = setTimeout(() => resolve([]), HINT_CHECK_MS);
    });
    const checked = await Promise.race([stillPublic(db, out.hits.filter((d) => d.kind !== "repo")), late]);
    clearTimeout(timer);
    return checked.slice(0, limit).map(hitForReply);
  } catch {
    return [];
  }
}

/** [body, status] for GET /q/find. Throws only if the rows can't be read. */
export async function findResponse(url, db, { waitUntil } = {}) {
  const q = url.searchParams.get("q") || url.searchParams.get("query") || "";
  if (!q.trim()) return [{ ok: false, code: "needs_q", detail: "Add q=<words>: a repository, an owner, a Task Object, a kit, a seed pack, or a need in plain words." }, 400];
  const asked = Number(url.searchParams.get("limit"));
  const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, MAX_LIMIT) : DEFAULT_LIMIT;
  const index = await currentIndex(db, waitUntil);
  // A few spare hits, so a row that just left public view doesn't shorten the answer.
  let out = searchIndex(index, q, limit + SPARE_HITS);
  // Tasks aren't in the index, and a new object may not be yet: a query shaped like an ID asks the rows directly.
  // An exact object name is a read by id: it follows that rule, not the rule for what's offered for reuse.
  const exactObject = out.match === "exact" && out.hits[0]?.kind === "obj";
  // A name with no ID shape can't take first place from a real match, since anyone may store an object under a common name.
  const askRows = ID_LOOKUP.test(q.trim()) || (!out.found && NAME_SHAPE.test(q.trim()));
  if (exactObject || (out.match !== "exact" && askRows)) {
    const direct = await lookupId(db, q.trim().toLowerCase());
    if (direct) out = { found: true, match: "exact", hits: [direct], read: true };
    else if (exactObject) out = { found: false, match: "none", hits: [] };
  }
  // `read`: those rows were just read, under the rule for a read by id.
  let hits = out.read ? out.hits : await stillPublic(db, out.hits);
  if (hits.length < out.hits.length && out.match !== "exact") {
    out = searchIndex(index, q, limit + SPARE_HITS);
    hits = await stillPublic(db, out.hits);
  }
  hits = hits.slice(0, limit);
  if (!hits.length) out = { found: false, match: "none", hits: [], maybe: out.maybe };
  const body = { ok: true, q: q.slice(0, 200), found: out.found, match: out.match, hits: hits.map(hitForReply) };
  if (out.rewrote) body.rewrote = out.rewrote;
  if (!out.found) {
    const maybe = out.maybe?.length ? (await stillPublic(db, out.maybe)).map(hitForReply) : [];
    if (maybe.length) body.maybe = maybe;
    body.note = maybe.length ? "No clear match. Items in maybe share only some of your words: read them before you trust one, or try again with 2 to 4 distinctive words." : "Nothing here fits. Try again with 2 to 4 distinctive words, or a name.";
  }
  return [body, 200];
}
