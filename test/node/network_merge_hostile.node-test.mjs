import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeNetwork } from "../../deploy/cloudflare/network_merge.js";

// The reviewer's N4: Tessera's answer is not trusted. Whatever else it carries (a country, a city, coordinates, an address, a network owner,
// worker labels or ids, keys, titles), only counts, the class, the kind of worker, a model id, the two codes and times are read from it.
// This file is Herma's own; test/node/network_merge.node-test.mjs is the map builder's copy and is replaced when theirs changes.

const NOW = Date.parse("2026-11-02T12:00:00Z");
const MIN = 60000;
const at = (minutes) => new Date(NOW - minutes * MIN).toISOString();
const PLACES = { FRA: { city: "Frankfurt", lat: 50.03, lon: 8.56 }, IAD: { city: "Ashburn", lat: 38.94, lon: -77.46 } };
const NAMES = { "muse-spark-1.3": "Muse Spark 1.3" };

const dirty = {
  country: "KE", country_name: "HOSTILECOUNTRY", city: "HOSTILECITY", region: "HOSTILEREGION", postal_code: "HOSTILEPOSTAL", lat: 1.2921, lon: 36.8219,
  ip: "203.0.113.5", asn: 64500, network: "HOSTILENET", worker_id: "w_HOSTILE", worker_label: "HOSTILELABEL", user_agent: "HOSTILEAGENT",
  key_id: "tsk_HOSTILE", title: "HOSTILETITLE", object_key: "HOSTILEKEY", persona: "HOSTILEPERSONA", agent_id: "HOSTILEAGENTID",
};
// (`city` is a key of the contract: the data center's own public city, so a hostile city shows only as a value, and the marker check covers it.)
const FIELDS = ["country", "country_name", "region", "postal_code", "ip", "asn", "network", "worker_id", "worker_label", "user_agent", "key_id", "agent_id"];

test("nothing from Tessera's answer but counts, class, worker kind, model id, the two codes and times reaches the output", () => {
  const view = {
    service: "Tessera", ...dirty,
    totals: { claims: 12, workers: 7, places: 3, continents: 2, by_class: { shared: 12 }, ...dirty },
    places: [
      { place: "FRA", level: "colo", continent: "EU", workers: 2, claims: 4, last_claim_at: at(4), by_class: { shared: 4 }, ...dirty },
      { place: "KE", level: "country", continent: "AF", workers: 3, claims: 5, ...dirty }, // a country is not a place the map shows
      { place: "KE", level: "colo", continent: "AF", workers: 2, claims: 3, ...dirty }, // not a data center code: its continent
    ],
    recent: [
      { at: at(4), class: "shared", place: "FRA", level: "colo", placed: "data_center", continent: "EU", worker: "volunteer", model: "muse-spark-1.3", ...dirty },
      { at: at(6), class: "shared", level: "country", place: "KE", continent: "AF", worker: "volunteer", ...dirty },
    ],
    replay: { from: at(60), to: at(0), claims: [{ at: at(20), class: "check", level: "country", place: "KE", continent: "AF", worker: "dedicated", ...dirty }], ...dirty },
  };
  const body = mergeNetwork({ now: NOW, tessera: view, places: PLACES, modelNames: NAMES, replay: true });
  const text = JSON.stringify(body);
  for (const mark of ["HOSTILE", "Kenya", "203.0.113.5", "64500", "1.2921", "36.8219", "w_HOSTILE", "tsk_"]) assert.ok(!text.includes(mark), `the answer carries ${mark}`);
  for (const field of FIELDS) assert.ok(!text.includes(`"${field}"`), `the answer has a key called ${field}`);
  assert.deepEqual(body.data_centres.map((d) => [d.code, d.workers, d.claims]), [["FRA", 2, 4]]);
  assert.deepEqual(body.continents.map((c) => [c.code, c.workers, c.claims]), [["AF", 2, 3]]);
  assert.deepEqual(body.recent_claims.map((r) => [r.via.type, r.via.code, r.via.continent, r.title, r.object_key]), [["data_centre", "FRA", "Europe", null, null], ["continent", null, "Africa", null, null]]);
  assert.deepEqual(body.replay.claims.map((r) => [r.via.type, r.worker_kind]), [["continent", "dedicated"]]);
  assert.equal(body.recent_claims[0].model.name, "Muse Spark 1.3");
});

test("a Tessera answer whose data center has one worker, or whose rows are not marked, names no data center", () => {
  const lone = { totals: { workers: 1, claims: 2, by_class: { shared: 2 } }, places: [{ place: "IAD", level: "colo", continent: "NA", workers: 1, claims: 2, last_claim_at: at(2), by_class: { shared: 2 } }],
    recent: [{ at: at(2), class: "shared", place: "IAD", level: "colo", placed: "data_center", continent: "NA", worker: "volunteer" }] };
  let body = mergeNetwork({ now: NOW, tessera: lone, places: PLACES });
  assert.deepEqual(body.data_centres, []);
  assert.deepEqual(body.recent_claims.map((r) => r.via.type), ["continent"]);
  const unmarked = { totals: { workers: 3, claims: 4, by_class: { shared: 4 } }, places: [{ place: "FRA", level: "colo", continent: "EU", workers: 3, claims: 4, last_claim_at: at(2), by_class: { shared: 4 } }],
    recent: [{ at: at(2), class: "shared", place: "FRA", level: "colo", continent: "EU", worker: "volunteer" }] };
  body = mergeNetwork({ now: NOW, tessera: unmarked, places: PLACES });
  assert.deepEqual(body.data_centres.map((d) => d.code), ["FRA"]); // the place is listed with 3 workers
  assert.deepEqual(body.recent_claims.map((r) => r.via.type), ["continent"]); // but Tessera did not mark the row as placed there
});

test("one volunteer in each source, each alone at the same data center, never names it in the union", () => {
  const own = [{ at: at(3), class: "shared", worker: "h-only", worker_kind: "volunteer", colo: "FRA", continent: "EU", show_on_map: true }];
  const tessera = { totals: { workers: 1, claims: 1, by_class: { shared: 1 } }, places: [{ place: "EU", level: "continent", continent: "EU", workers: 1, claims: 1, last_claim_at: at(5), by_class: { shared: 1 } }],
    recent: [{ at: at(5), class: "shared", place: "FRA", level: "colo", placed: "continent", continent: "EU", worker: "volunteer" }] };
  const body = mergeNetwork({ now: NOW, own, tessera, places: PLACES, replay: true });
  assert.deepEqual(body.data_centres, []);
  assert.ok([...body.recent_claims, ...body.replay.claims].every((r) => r.via.type === "continent"));
  assert.deepEqual(body.continents.map((c) => [c.code, c.workers, c.claims]), [["EU", 2, 2]]);
});
