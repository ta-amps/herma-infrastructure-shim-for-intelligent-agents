// Copied from notes/claude-work-2026-11-01/activity-map/herma-network/network_merge.mjs (the map builder's pure merge, with its tests in
// test/node/network_merge.node-test.mjs).
// The network map's merge, for Herma's GET /q/network: pure, dependency-free (no imports, no clock, no
// network, no storage), so it can be copied into any Worker with its test.
//
// It turns two sources of claims into the response in notes/coordination-2026-10-31/claude-design-network-map.v1.json:
//   * Herma's own claims, as plain rows (see `summarizeOwn`);
//   * Tessera's aggregate, GET /v1/public/activity/map?window=24h (add &replay=1 for the replay), already
//     thresholded on Tessera's side.
//
// The privacy rules live here, in one place:
//   * a data center is shown only when at least MIN_WORKERS distinct workers of the same kind came through it
//     in the window; otherwise its workers and claims count under its continent. Each source applies the rule
//     to its own workers, never to a union, so the merge can only be more careful than the truth, never less;
//   * a worker with show_on_map false counts in the totals only: never under a data center, never in a feed;
//   * no worker identifier, key, address, city of a worker, coordinate of a worker, network or user agent
//     is read into the output. Coordinates in the output are the data centers' own public ones.
//
// Key names follow the contract exactly (`data_centres`, `totals.data_centres`); every visible string is for the
// caller to render from its own copy.
//
// Herma's rows (an array of plain objects, one per claim in the last 24 hours; extra fields are ignored):
//   { at: ISO string | ms | s, class: "nonprofit"|"shared"|"check"|"own", worker: <any opaque string that tells
//     two workers apart, never written to the output>, worker_kind: "volunteer"|"dedicated", colo: "FRA"|null,
//     continent: "EU"|null (request.cf.continent), show_on_map: boolean (false = totals only),
//     model: <model id>|null, declared: boolean (a volunteer's declared model), persona: string|null,
//     title: string|null, place: string|null, object_key: string|null }
//
// Usage:
//   import { mergeNetwork, modelNamesFromCatalog } from "./network_merge.mjs";
//   const body = mergeNetwork({ now: Date.now(), own: rows, tessera: await tesseraJsonOrNull,
//     places: coloPlaces.places, modelNames: modelNamesFromCatalog(modelsMeta), kind: "all", replay: false,
//     text: (s) => sharedListMask(s) });
//
// `text` is applied to every string that a worker or a producer wrote (titles, place labels) and to city names;
// pass the shared banned list's display mask (rule 16). Stored rows are never altered.

export const MIN_WORKERS = 2;
export const WINDOW_HOURS = 24;
export const RECENT_MINUTES = 10;
export const FEED_SIZE = 20;
export const REPLAY_SECONDS = 3600;
export const REPLAY_ROWS = 300;
export const KINDS = Object.freeze(["nonprofit", "shared", "check", "own"]);
export const KIND_LABELS = Object.freeze({ nonprofit: "Nonprofit Task", shared: "Shared Task", check: "Check", own: "Worker's own Task" });
export const CONTINENT_NAMES = Object.freeze({ AF: "Africa", AN: "Antarctica", AS: "Asia", EU: "Europe", NA: "North America", OC: "Oceania", SA: "South America" });

const KIND_SET = new Set(KINDS);
const WORKER_KINDS = new Set(["volunteer", "dedicated"]);
const DAY_MS = WINDOW_HOURS * 3600 * 1000;
const TIER_SUFFIXES = ["-contributor", "-standard"];

const count = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const code3 = (v) => (typeof v === "string" && /^[A-Z]{3}$/.test(v) ? v : null);
const continentCode = (v) => (typeof v === "string" && Object.hasOwn(CONTINENT_NAMES, v) ? v : null);
const string = (v) => (typeof v === "string" && v.trim() ? v : null);
const iso = (t) => new Date(t).toISOString();

// ISO text, milliseconds or seconds since the epoch, as milliseconds; null when it is none of them.
function millis(value) {
  const t = typeof value === "string" ? Date.parse(value) : typeof value === "number" && Number.isFinite(value) ? (value < 1e11 ? value * 1000 : value) : NaN;
  return Number.isFinite(t) ? Math.round(t) : null;
}

function bump(map, key, by = 1) {
  map[key] = (map[key] || 0) + by;
}

function kindCounts(source) {
  const out = Object.fromEntries(KINDS.map((k) => [k, 0]));
  if (source && typeof source === "object") for (const k of KINDS) out[k] = count(source[k]);
  return out;
}

// The model's display name from the catalog's table, with a tier suffix such as -contributor removed;
// null for an id the catalog does not name.
export function modelName(id, names) {
  if (typeof id !== "string" || !names || typeof names !== "object") return null;
  const bare = TIER_SUFFIXES.reduce((value, suffix) => (value.endsWith(suffix) ? value.slice(0, -suffix.length) : value), id);
  for (const key of [id, bare]) if (Object.hasOwn(names, key) && typeof names[key] === "string") return names[key];
  return null;
}

// id -> display name from the models catalog Task Object (models.meta), without agent apps: the map names models,
// never the app that ran one.
export function modelNamesFromCatalog(catalog) {
  const table = catalog?.runtime?.display_by_id;
  if (!table || typeof table !== "object") return {};
  const entries = [...(Array.isArray(catalog.meta_models) ? catalog.meta_models : []), ...(Array.isArray(catalog.film_models) ? catalog.film_models : [])];
  const apps = new Set(entries.filter((m) => /agent app/i.test(String(m?.kind ?? ""))).map((m) => String(m?.id)));
  return Object.fromEntries(Object.entries(table).filter(([id, name]) => !apps.has(id) && typeof name === "string"));
}

// Herma's own claims in the window: the source summary every merge step reads.
//   totals: every claim and distinct worker, those that left the map included;
//   places: the shown ones, a data center (level "colo") once MIN_WORKERS workers of one kind came through it,
//           otherwise their continent (level "continent");
//   rows:   the shown claims, newest first, each with the place it may be named by.
export function summarizeOwn(rows, { now, windowMs = DAY_MS } = {}) {
  const since = now - windowMs;
  const claims = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const t = millis(r?.at);
    if (t === null || t < since || t > now + 60000 || !KIND_SET.has(r?.class) || typeof r.worker !== "string" || !r.worker) continue;
    claims.push({
      t, klass: r.class, worker: r.worker, worker_kind: WORKER_KINDS.has(r.worker_kind) ? r.worker_kind : "volunteer", // never claim ta-amps runs what it may not
      shown: r.show_on_map !== false, colo: code3(r.colo), continent: continentCode(r.continent),
      model: string(r.model), declared: r.declared === true, persona: string(r.persona), title: string(r.title), place: string(r.place), object_key: string(r.object_key),
    });
  }
  const totals = { workers: new Set(claims.map((c) => c.worker)).size, claims: claims.length, by_class: {} };
  for (const c of claims) bump(totals.by_class, c.klass);
  const shown = claims.filter((c) => c.shown);
  const atColo = new Map();
  for (const c of shown) {
    if (!c.colo) continue;
    const key = `${c.colo}|${c.worker_kind}`;
    if (!atColo.has(key)) atColo.set(key, new Set());
    atColo.get(key).add(c.worker);
  }
  const placeOf = (c) => {
    if (c.colo && (atColo.get(`${c.colo}|${c.worker_kind}`)?.size || 0) >= MIN_WORKERS) return { level: "colo", code: c.colo, continent: c.continent };
    if (c.continent) return { level: "continent", code: null, continent: c.continent };
    return { level: "unknown", code: null, continent: null };
  };
  const places = new Map();
  for (const c of shown) {
    const where = placeOf(c);
    if (where.level === "unknown") continue;
    const key = `${where.level}|${where.code || where.continent}`;
    if (!places.has(key)) places.set(key, { ...where, tags: new Set(), claims: 0, by_class: {}, last_ms: 0 });
    const p = places.get(key);
    p.tags.add(c.worker);
    p.claims++;
    bump(p.by_class, c.klass);
    p.last_ms = Math.max(p.last_ms, c.t);
  }
  const out = [...places.values()].map((p) => ({ level: p.level, code: p.code, continent: p.continent, workers: p.tags.size, claims: p.claims, by_class: kindCounts(p.by_class), last_ms: p.last_ms }));
  const feed = shown.map((c) => ({ ...c, ...placeOf(c) })).sort((a, b) => b.t - a.t);
  return { totals, places: out, rows: feed, replayRows: [] };
}

// Tessera's aggregate as the same summary; null when it is missing or not the shape it should be (the merge
// then counts no direct claims). Tessera has already applied the threshold to its own workers.
export function fromTessera(view) {
  if (!view || typeof view !== "object" || !view.totals || typeof view.totals !== "object" || !Array.isArray(view.places)) return null;
  const totals = { workers: count(view.totals.workers), claims: count(view.totals.claims), by_class: kindCounts(view.totals.by_class) };
  const places = [];
  for (const p of view.places) {
    if (!p || (p.level !== "colo" && p.level !== "continent")) continue; // "unknown" places count in the totals only
    const code = p.level === "colo" ? code3(p.place) : null;
    const continent = p.level === "colo" ? continentCode(p.continent) : continentCode(p.place);
    if (!continent || (p.level === "colo" && !code)) continue;
    places.push({ level: p.level, code, continent, workers: count(p.workers), claims: count(p.claims), by_class: kindCounts(p.by_class), last_ms: millis(p.last_claim_at) });
  }
  const rowsOf = (list) => (Array.isArray(list) ? list : []).flatMap((r) => {
    const t = millis(r?.at);
    const worker_kind = r?.worker;
    if (t === null || !KIND_SET.has(r?.class) || !WORKER_KINDS.has(worker_kind)) return [];
    const colo = r.level === "colo" ? code3(r.place) : null;
    const continent = continentCode(r.continent) || (r.level === "continent" ? continentCode(r.place) : null);
    return [{ t, klass: r.class, worker_kind, level: colo ? "colo" : continent ? "continent" : "unknown", code: colo, continent,
      model: string(r.model), declared: worker_kind === "volunteer", persona: null, title: null, place: null, object_key: null }];
  });
  return { totals, places, rows: rowsOf(view.recent), replayRows: rowsOf(view.replay?.claims) };
}

// The response of GET /q/network. `now` is milliseconds since the epoch (the module reads no clock); `own` is Herma's
// rows; `tessera` is Tessera's JSON or null; `places` is the code -> {city, lat, lon} table (colo-places.json,
// `places`); `modelNames` is id -> name; `kind` filters the feeds only (never the counts); `replay` adds the last hour.
export function mergeNetwork({ now, own = [], tessera = null, places = {}, modelNames = {}, kind = "all", replay = false, text = (s) => s } = {}) {
  if (!Number.isFinite(now)) throw new TypeError("now (milliseconds since the epoch) is required: the module reads no clock");
  const mask = (value) => (value === null ? null : string(text(value)));
  const sources = [summarizeOwn(own, { now }), fromTessera(tessera)].filter(Boolean);
  const known = (code) => code !== null && Object.hasOwn(places, code) && Number.isFinite(places[code]?.lat) && Number.isFinite(places[code]?.lon);

  // Data centers the sources show; counts of a data center the table cannot place, and of a continent, roll up.
  const centers = new Map();
  const rolled = new Map();
  const add = (map, key, base, p) => {
    if (!map.has(key)) map.set(key, { ...base, workers: 0, claims: 0, by_class: kindCounts(null), last_ms: null });
    const m = map.get(key);
    m.workers += p.workers;
    m.claims += p.claims;
    for (const k of KINDS) m.by_class[k] += p.by_class[k] || 0;
    if (p.last_ms !== null && (m.last_ms === null || p.last_ms > m.last_ms)) m.last_ms = p.last_ms;
  };
  for (const s of sources) {
    for (const p of s.places) {
      if (p.level === "colo" && known(p.code)) add(centers, p.code, { code: p.code, continent: p.continent }, p);
      else add(rolled, p.continent, { continent: p.continent }, p);
    }
  }
  const data_centres = [...centers.values()].map((m) => ({
    code: m.code, city: mask(string(places[m.code].city)) || m.code, continent: CONTINENT_NAMES[m.continent], continent_code: m.continent,
    lat: Math.round(places[m.code].lat * 100) / 100, lon: Math.round(places[m.code].lon * 100) / 100,
    workers: m.workers, claims: m.claims, by_kind: m.by_class, last_claim_at: m.last_ms === null ? null : iso(m.last_ms),
  })).sort((a, b) => b.claims - a.claims || a.code.localeCompare(b.code));
  const continents = [...rolled.values()].filter((m) => m.workers > 0 || m.claims > 0).map((m) => ({
    name: CONTINENT_NAMES[m.continent], code: m.continent, workers: m.workers, claims: m.claims, by_kind: m.by_class,
  })).sort((a, b) => b.claims - a.claims || a.name.localeCompare(b.name));

  const nonprofit = sources.reduce((n, s) => n + (s.totals.by_class.nonprofit || 0), 0);
  const totals = {
    workers: sources.reduce((n, s) => n + s.totals.workers, 0),
    data_centres: data_centres.length,
    continents: new Set([...data_centres.map((d) => d.continent_code), ...continents.map((c) => c.code)]).size,
    claims: sources.reduce((n, s) => n + s.totals.claims, 0),
    nonprofit_claims: nonprofit,
  };

  // The feeds: the contract's recent_claims and replay claims, one row shape.
  const wanted = KIND_SET.has(kind) ? kind : "all";
  const keep = (r) => wanted === "all" || r.klass === wanted;
  const rowOut = (r) => {
    const center = r.level === "colo" && known(r.code) ? r.code : null;
    const name = modelName(r.model, modelNames);
    return {
      at: iso(r.t), kind: r.klass, kind_label: KIND_LABELS[r.klass], title: mask(r.title), place: mask(r.place),
      via: center ? { type: "data_centre", code: center, city: mask(string(places[center].city)) || center, continent: r.continent ? CONTINENT_NAMES[r.continent] : null }
        : { type: "continent", code: null, city: null, continent: r.continent ? CONTINENT_NAMES[r.continent] : null },
      worker_kind: r.worker_kind, model: name ? { name, declared: r.declared } : null, persona: mask(r.persona), object_key: r.object_key,
    };
  };
  const recent_claims = sources.flatMap((s) => s.rows).filter(keep).sort((a, b) => b.t - a.t).slice(0, FEED_SIZE).map(rowOut);
  const body = { generated_at: iso(now), window_hours: WINDOW_HOURS, recent_minutes: RECENT_MINUTES, totals, data_centres, continents, recent_claims };
  if (replay) {
    const from = now - REPLAY_SECONDS * 1000;
    const own_ = sources[0] === undefined ? [] : summarizeOwn(own, { now, windowMs: REPLAY_SECONDS * 1000 }).rows;
    const direct = fromTessera(tessera)?.replayRows ?? [];
    const claims = [...own_, ...direct].filter((r) => r.t >= from && keep(r)).sort((a, b) => b.t - a.t).slice(0, REPLAY_ROWS).reverse();
    body.replay = { from: iso(from), to: iso(now), claims: claims.map(rowOut) };
  }
  return body;
}
