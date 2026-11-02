// Tests of the network map's merge (network_merge.mjs), with a made-up place table and made-up worker ids.
// Run: node --test network_merge.test.mjs   (Node 22; no packages)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CONTINENT_NAMES, FEED_SIZE, KINDS, MIN_WORKERS, REPLAY_ROWS, fromTessera, mergeNetwork, modelName, modelNamesFromCatalog, summarizeOwn } from "../../deploy/cloudflare/network_merge.js";

const NOW = Date.parse("2026-11-02T03:00:00Z");
const TESSERA = JSON.parse(readFileSync(new URL("./fixtures/tessera-activity-map.json", import.meta.url), "utf8"));
const PLACES = { FRA: { city: "Frankfurt", lat: 50.03, lon: 8.56 }, IAD: { city: "Ashburn", lat: 38.94, lon: -77.46 }, SYD: { city: "Sydney", lat: -33.95, lon: 151.18 } };
const NAMES = { "muse-spark-1.3": "Muse Spark 1.3", "muse-wonder-1.0": "Muse Wonder 1.0" };
const ago = (ms) => new Date(NOW - ms).toISOString();
const MIN = 60000;
const row = (worker, extra) => ({ worker, worker_kind: "volunteer", class: "shared", colo: "FRA", continent: "EU", show_on_map: true, model: null, declared: false, ...extra });
// Herma's claims: two volunteers through FRA, a third who left the map, one through SYD alone, one dedicated through IAD alone.
const OWN = [
  row("h-worker-1", { at: ago(30000), class: "nonprofit", model: "muse-spark-1.3", declared: true, title: "Plan the pantry shifts", place: "Kenya", object_key: "obj-1" }),
  row("h-worker-2", { at: ago(2 * MIN) }),
  row("h-worker-5", { at: ago(1 * MIN), class: "nonprofit", show_on_map: false }),
  row("h-worker-3", { at: ago(8 * MIN), colo: "SYD", continent: "OC" }),
  row("h-worker-4", { at: ago(12 * MIN), worker_kind: "dedicated", class: "check", colo: "IAD", continent: "NA", model: "muse-wonder-1.0", persona: "Careful checker" }),
  row("h-worker-6", { at: ago(25 * 3600 * 1000) }), // older than the window
  row("h-worker-7", { at: ago(MIN), class: "not-a-class" }), // not one of the four
];
const merge = (extra = {}) => mergeNetwork({ now: NOW, own: OWN, tessera: TESSERA, places: PLACES, modelNames: NAMES, ...extra });
const deepFreeze = (v) => (v && typeof v === "object" ? (Object.values(v).forEach(deepFreeze), Object.freeze(v)) : v);

test("each source applies the two-worker threshold to its own workers, and a worker that left the map counts in the totals only", () => {
  const own = summarizeOwn(OWN, { now: NOW });
  assert.equal(MIN_WORKERS, 2);
  // FRA: two shown volunteers; the third (hidden) is not placed. IAD and SYD have one worker each: continents.
  assert.deepEqual(own.places.map((p) => [p.level, p.code || p.continent, p.workers, p.claims]).sort(), [["colo", "FRA", 2, 2], ["continent", "NA", 1, 1], ["continent", "OC", 1, 1]]);
  assert.deepEqual(own.totals, { workers: 5, claims: 5, by_class: { nonprofit: 2, shared: 2, check: 1 } });
  assert.ok(own.rows.every((r) => r.shown) && own.rows.length === 4, "the feed holds only shown claims");
});

test("the merge adds claims, workers and continents of both sources, and totals count everything", () => {
  const body = merge();
  assert.deepEqual(body.data_centres.map((d) => [d.code, d.city, d.continent, d.workers, d.claims]), [["IAD", "Ashburn", "North America", 3, 9], ["FRA", "Frankfurt", "Europe", 4, 6]]);
  assert.deepEqual(body.data_centres.find((d) => d.code === "FRA").by_kind, { nonprofit: 2, shared: 4, check: 0, own: 0 });
  assert.deepEqual(body.continents.map((c) => [c.name, c.workers, c.claims]).sort(), [["Asia", 1, 1], ["North America", 1, 1], ["Oceania", 1, 1]]);
  assert.deepEqual(body.totals, { workers: 13, data_centres: 2, continents: 4, claims: 21, nonprofit_claims: 8 });
  assert.deepEqual([body.window_hours, body.recent_minutes, body.generated_at], [24, 10, new Date(NOW).toISOString()]);
  // The newest claim at a data center, from either source; lat and lon are the data center's own.
  assert.equal(body.data_centres.find((d) => d.code === "FRA").last_claim_at, ago(30000));
  assert.deepEqual([body.data_centres[0].lat, body.data_centres[0].lon], [38.94, -77.46]);
});

test("a source that is missing or malformed counts no direct claims, and the rest still answers", () => {
  for (const tessera of [null, undefined, {}, { places: "x", totals: {} }, { places: [], totals: null }, "nope", 7]) {
    const body = merge({ tessera });
    assert.deepEqual(body.data_centres.map((d) => d.code), ["FRA"]);
    assert.deepEqual(body.totals, { workers: 5, data_centres: 1, continents: 3, claims: 5, nonprofit_claims: 2 });
  }
  assert.equal(fromTessera(null), null);
  const odd = fromTessera({ totals: { workers: -4, claims: "x", by_class: { nonprofit: 2, nope: 9 } }, places: [{ level: "colo", place: "fra", continent: "EU" }, { level: "continent", place: "ZZ" }, null], recent: [{ at: "bad", class: "shared", worker: "volunteer" }] });
  assert.deepEqual([odd.totals.workers, odd.totals.claims, odd.totals.by_class.nonprofit, odd.places.length, odd.rows.length], [0, 0, 2, 0, 0]);
  assert.deepEqual(mergeNetwork({ now: NOW }).totals, { workers: 0, data_centres: 0, continents: 0, claims: 0, nonprofit_claims: 0 });
});

test("a data center the table cannot place rolls up to its continent", () => {
  const rows = [row("a", { at: ago(MIN), colo: "ZZZ", continent: "AS" }), row("b", { at: ago(2 * MIN), colo: "ZZZ", continent: "AS" })];
  const body = mergeNetwork({ now: NOW, own: rows, places: PLACES });
  assert.deepEqual(body.data_centres, []);
  assert.deepEqual(body.continents.map((c) => [c.name, c.workers, c.claims]), [["Asia", 2, 2]]);
  assert.deepEqual(body.recent_claims.map((r) => r.via), [{ type: "continent", code: null, city: null, continent: "Asia" }, { type: "continent", code: null, city: null, continent: "Asia" }]);
});

test("the feed is newest first, names where a claim came through by what the threshold allows, and the kind filters it only", () => {
  const all = merge();
  assert.deepEqual(all.recent_claims.map((r) => [r.kind, r.via.type, r.via.code || r.via.continent]), [
    ["nonprofit", "data_centre", "FRA"], // Herma's h-worker-1, 30 s ago
    ["nonprofit", "data_centre", "IAD"], // Tessera, 90 s ago
    ["shared", "data_centre", "FRA"], // Herma's h-worker-2
    ["check", "data_centre", "IAD"], // Tessera, 4 min
    ["shared", "continent", "Oceania"], // h-worker-3 alone at SYD
    ["check", "continent", "North America"], // h-worker-4 alone of its kind at IAD (Tessera's IAD does not make it a data center for Herma's worker)
    ["shared", "data_centre", "FRA"], // Tessera, 25 min
    ["shared", "continent", "Asia"], // Tessera, 50 min
  ]);
  assert.ok(all.recent_claims.every((r, i, rows) => i === 0 || r.at <= rows[i - 1].at));
  const first = all.recent_claims[0];
  assert.deepEqual([first.kind_label, first.title, first.place, first.worker_kind, first.model, first.object_key], ["Nonprofit Task", "Plan the pantry shifts", "Kenya", "volunteer", { name: "Muse Spark 1.3", declared: true }, "obj-1"]);
  assert.deepEqual(all.recent_claims[3].model, null); // Tessera: the work used no model
  assert.deepEqual(all.recent_claims[5].model, { name: "Muse Wonder 1.0", declared: false });
  assert.equal(all.recent_claims[5].persona, "Careful checker");
  const checks = merge({ kind: "check" });
  assert.deepEqual(checks.recent_claims.map((r) => r.kind), ["check", "check"]);
  assert.deepEqual([checks.totals, checks.data_centres], [all.totals, all.data_centres], "a kind filters the feeds, never the counts");
  assert.deepEqual(merge({ kind: "everything" }).recent_claims, all.recent_claims, "an unknown kind means all");
  assert.deepEqual(KINDS, ["nonprofit", "shared", "check", "own"]);
});

test("the replay is the last hour, oldest first, from both sources, shown claims only", () => {
  const { replay } = merge({ replay: true });
  assert.equal(Date.parse(replay.to) - Date.parse(replay.from), 3600000);
  assert.deepEqual(replay.claims.map((r) => r.at), [...replay.claims.map((r) => r.at)].sort());
  assert.equal(replay.claims.length, 4 + 4, "four of Herma's shown claims and Tessera's four");
  assert.equal(merge().replay, undefined);
  assert.ok(replay.claims.every((r) => Date.parse(r.at) >= Date.parse(replay.from)));
  assert.deepEqual(merge({ replay: true, kind: "nonprofit" }).replay.claims.map((r) => r.kind), ["nonprofit", "nonprofit"]);
  // Never more than REPLAY_ROWS, and the newest ones when there are more.
  const many = Array.from({ length: REPLAY_ROWS + 50 }, (_, i) => row(`w${i}`, { at: ago(i * 1000 + 1000), colo: null, continent: "EU" }));
  const long = mergeNetwork({ now: NOW, own: many, places: PLACES, replay: true }).replay.claims;
  assert.equal(long.length, REPLAY_ROWS);
  assert.equal(long.at(-1).at, ago(1000));
  assert.equal(mergeNetwork({ now: NOW, own: many, places: PLACES }).recent_claims.length, FEED_SIZE);
});

test("models are named from the catalog, never an agent app, with a tier suffix understood", () => {
  const catalog = {
    meta_models: [{ id: "muse-spark-1.3", kind: "model" }, { id: "muse-code", kind: "agent app by Meta (not a model)" }],
    film_models: [{ id: "facebook/musicgen-small", kind: "model" }],
    runtime: { display_by_id: { "muse-spark-1.3": "Muse Spark 1.3", "muse-code": "Muse Code 1.4.14", "facebook/musicgen-small": "MusicGen" } },
  };
  const names = modelNamesFromCatalog(catalog);
  assert.deepEqual(names, { "muse-spark-1.3": "Muse Spark 1.3", "facebook/musicgen-small": "MusicGen" });
  assert.equal(modelName("muse-spark-1.3-contributor", names), "Muse Spark 1.3");
  assert.equal(modelName("muse-spark-1.3-standard", names), "Muse Spark 1.3");
  assert.deepEqual([modelName("muse-code", names), modelName("unknown-model", names), modelName(null, names), modelName("x", null)], [null, null, null, null]);
  assert.deepEqual(modelNamesFromCatalog({}), {});
  // A claim whose model the catalog does not name shows none, not the id.
  const body = mergeNetwork({ now: NOW, own: [row("a", { at: ago(MIN), model: "muse-code" })], places: PLACES, modelNames: names });
  assert.equal(body.recent_claims[0].model, null);
});

test("the shared word list's mask applies to every string a worker or producer wrote, and to city names", () => {
  const text = (s) => s.replace(/zzbanned/gi, "…");
  const places = { ...PLACES, FRA: { ...PLACES.FRA, city: "Zzbanned Town" } };
  const own = [row("a", { at: ago(MIN), title: "Plan zzbanned list", place: "The zzbanned coast", persona: "zzbanned maker", class: "nonprofit" }), row("b", { at: ago(2 * MIN) })];
  const body = mergeNetwork({ now: NOW, own, places, text });
  const json = JSON.stringify(body);
  assert.ok(!/zzbanned/i.test(json));
  assert.deepEqual([body.recent_claims[0].title, body.recent_claims[0].place, body.recent_claims[0].persona, body.data_centres[0].city], ["Plan … list", "The … coast", "… maker", "… Town"]);
  // A title the mask empties out is no title.
  assert.equal(mergeNetwork({ now: NOW, own: [row("a", { at: ago(MIN), title: "zzbanned" })], places, text: () => "  " }).recent_claims[0].title, null);
});

test("the output names no worker, key, address or network: only the fields of the contract", () => {
  const body = merge({ replay: true });
  const json = JSON.stringify(body);
  for (const secret of ["h-worker", "worker_tag", "worker_uuid", "asn", "user_agent", "latitude", "longitude", "key_id", "tsk_", "tan_"]) {
    assert.ok(!json.includes(secret), `the output has ${secret}`);
  }
  assert.ok(!/"(ip|ip_hash|city_of_worker)"\s*:/.test(json));
  assert.deepEqual(Object.keys(body), ["generated_at", "window_hours", "recent_minutes", "totals", "data_centres", "continents", "recent_claims", "replay"]);
  assert.deepEqual(Object.keys(body.data_centres[0]), ["code", "city", "continent", "continent_code", "lat", "lon", "workers", "claims", "by_kind", "last_claim_at"]);
  assert.deepEqual(Object.keys(body.continents[0]), ["name", "code", "workers", "claims", "by_kind"]);
  assert.deepEqual(Object.keys(body.recent_claims[0]), ["at", "kind", "kind_label", "title", "place", "via", "worker_kind", "model", "persona", "object_key"]);
  assert.deepEqual(Object.keys(body.recent_claims[0].via), ["type", "code", "city", "continent"]);
  assert.ok(!/[0-9a-f]{12,}/i.test(json.replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, "")), "no identifier-like hex");
  assert.deepEqual(Object.values(CONTINENT_NAMES).sort(), ["Africa", "Antarctica", "Asia", "Europe", "North America", "Oceania", "South America"]);
});

test("it is pure: no clock, no change to its inputs, the same answer twice", () => {
  const own = deepFreeze(structuredClone(OWN));
  const tessera = deepFreeze(structuredClone(TESSERA));
  const places = deepFreeze(structuredClone(PLACES));
  const a = mergeNetwork({ now: NOW, own, tessera, places, modelNames: NAMES, replay: true });
  const b = mergeNetwork({ now: NOW, own, tessera, places, modelNames: NAMES, replay: true });
  assert.deepEqual(a, b);
  assert.throws(() => mergeNetwork({ own, tessera, places }), TypeError); // `now` is required: the module reads no clock
  // A claim from the future (a clock skew of more than a minute) is not counted.
  assert.equal(summarizeOwn([row("a", { at: new Date(NOW + 5 * MIN).toISOString() })], { now: NOW }).totals.claims, 0);
  // At, in seconds or milliseconds since the epoch, means the same instant.
  assert.equal(summarizeOwn([row("a", { at: Math.floor((NOW - MIN) / 1000) }), row("b", { at: NOW - MIN })], { now: NOW }).totals.claims, 2);
});

test("a worker's kind is never guessed to be run by ta-amps", () => {
  const own = [row("a", { at: ago(MIN), worker_kind: "robot" })];
  assert.equal(mergeNetwork({ now: NOW, own, places: PLACES }).recent_claims[0].worker_kind, "volunteer");
});
