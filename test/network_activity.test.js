import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../deploy/cloudflare/worker.js";
import { NETWORK_GRID, buildNetworkBody, cleanDeclaredModel, modelNamesFor, networkKind, networkWorkerKind, parseShowOnMap, pruneClaimEdges, recordClaimEdge, resetNetworkCaches, setShowOnMap } from "../deploy/cloudflare/network_activity.js";

// GET /q/network (design contract claude-design-network-map.v1.json): where workers connect and what they pick up.
// Only request.cf.colo and request.cf.continent are kept per claim; a claim names a data center only when 2 or more workers of its kind
// made claims there in the 15 minutes up to it (the merge's tests cover that rule in detail: test/node/network_merge.node-test.mjs).

const BASE = "https://herma.teleionlabs.com";
const call = (path, init) => exports.default.fetch(BASE + path, init);
const callWith = (path, extra, init = {}) => worker.fetch(new Request(BASE + path, init), { ...env, ...extra });
const db = () => env.HERMA_DB;
const edge = (colo, continent) => ({ cf: { colo, continent } });
const task = (id, tier = "public_general", verb_kind = "general_verb") => ({ task_id: id, tier, verb_kind });
const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60000).toISOString(); // explicit times: claims in one millisecond would tie

/** A Task in the queue, public unless said otherwise (a claim names a Task the map may show only when the queue says it is public). */
async function queueTask(id, { tier = "public_general", visibility = "public_commons", title = `Plan for ${id}`, country = "" } = {}) {
  const at = new Date().toISOString();
  await db()
    .prepare(
      `INSERT OR REPLACE INTO herma_durable_queue (task_id, tier, visibility, priority, title, prompt, simhash64_hex, producer_agent, created_at, updated_at, locale_country)
       VALUES (?, ?, ?, 50, ?, 'p', '0', 'network-test', ?, ?, ?)`
    )
    .bind(id, tier, visibility, title, at, at, country)
    .run();
  return task(id, tier);
}

async function ready() {
  await call("/q/pulse"); // creates the queue tables
  await db().prepare("DELETE FROM herma_claim_edge").run().catch(() => {});
  await db().prepare("DELETE FROM herma_worker_registry WHERE agent_id LIKE 'agent-w_%' OR agent_id LIKE 'map-test-%'").run().catch(() => {});
  await db().prepare("DELETE FROM herma_durable_queue WHERE producer_agent = 'network-test'").run().catch(() => {});
  resetNetworkCaches();
}

const choiceOf = async (uuid) => Number((await db().prepare("SELECT show_on_map FROM herma_worker_registry WHERE worker_uuid = ?").bind(uuid).first()).show_on_map);

describe("the map's small rules", () => {
  it("names the kind of a Task and the kind of worker", () => {
    expect(networkKind({ tier: "ngo_priority", verb_kind: "x" })).toBe("nonprofit");
    expect(networkKind({ tier: "ngo_priority", verb_kind: "eval_and_rank" })).toBe("check");
    expect(networkKind({ task_id: "verb_evl_abc", tier: "public_general" })).toBe("check");
    expect(networkKind({ tier: "public_general", verb_kind: "worker_self_directed" })).toBe("own");
    expect(networkKind({ tier: "public_general", verb_kind: "general_verb" })).toBe("shared");
    expect(networkWorkerKind("eranos-worker-3")).toBe("dedicated");
    expect(networkWorkerKind("ta-amps.helper")).toBe("dedicated");
    expect(networkWorkerKind("someone-elses-agent")).toBe("volunteer");
  });

  it("cleans a declared model id to letters, digits, dots and hyphens, at most 40 characters", () => {
    expect(cleanDeclaredModel("My_Custom Model.v2!!")).toBe("my-custom-model.v2");
    expect(cleanDeclaredModel("  --Muse//Spark?? ")).toBe("muse-spark");
    expect(cleanDeclaredModel("x".repeat(60))).toBe("x".repeat(40));
    expect(cleanDeclaredModel("ab-".repeat(20)).length).toBeLessThanOrEqual(40);
    for (const none of ["", "   ", "!!!", "___", null, undefined]) expect(cleanDeclaredModel(none)).toBe("");
  });

  it("gives a name to each model a volunteer declared and the catalog does not list, and to nothing the word list would change", () => {
    const names = modelNamesFor([
      { declared: true, model: "muse-spark-open" }, // not in the catalog: shown as declared
      { declared: true, model: "muse-spark" }, // the family alias
      { declared: true, model: "muse-spark-1.3" }, // the catalog's own
      { declared: true, model: "a1b2c3d4e5f6a7b8c9d0" }, // a long hex string: the filter changes it, so it is not shown
      { declared: false, model: "some-team-model" }, // not declared by a volunteer: not named here
      { declared: true, model: "" },
    ]);
    expect(names["muse-spark-open"]).toBe("muse-spark-open");
    expect(names["muse-spark"]).toBe("Muse Spark");
    expect(names["muse-spark-1.3"]).toBe("Muse Spark 1.3");
    expect(names["a1b2c3d4e5f6a7b8c9d0"]).toBeUndefined();
    expect(names["some-team-model"]).toBeUndefined();
    expect(Object.keys(names)).not.toContain("__proto__");
  });

  it("reads a clear yes as shown and any other value that is given as off", () => {
    for (const yes of [true, 1, "true", "1", "yes", "ON", " True ", "y", "show"]) expect(parseShowOnMap(yes)).toBe(true);
    for (const no of [false, 0, "false", "0", "no", "off", "OFF", "disabled", "hide", " false ", "n", "none", "flase", "maybe", 2, "2", "[object Object]"]) expect(parseShowOnMap(no)).toBe(false);
    for (const none of [undefined, null, "", "   "]) expect(parseShowOnMap(none)).toBeUndefined();
  });
});

describe("GET /q/network", () => {
  beforeEach(ready, 60000); // the first /q/pulse creates every table and can be slow on a busy machine

  it("records only the data center and continent per claim, and nothing a client sends", async () => {
    await recordClaimEdge(db(), edge("FRA", "EU"), { task: task("t_one"), workerUuid: "w_a", agentId: "agent-a", modelHint: "Muse-Spark-1.3" });
    await recordClaimEdge(db(), edge("not a code", "ZZ"), { task: task("t_two"), workerUuid: "w_b", agentId: "agent-b" });
    const { results } = await db().prepare("SELECT * FROM herma_claim_edge ORDER BY id").all();
    expect(Object.keys(results[0]).sort()).toEqual(["claimed_at", "colo", "continent", "id", "kind", "model", "persona", "task_id", "worker_kind", "worker_uuid"]);
    expect(results[0]).toMatchObject({ colo: "FRA", continent: "EU", kind: "shared", worker_kind: "volunteer", model: "muse-spark-1.3", persona: "" });
    expect(results[1]).toMatchObject({ colo: "", continent: "" });
  });

  it("keeps no data center or continent for a worker that left the map, from its next claim on", async () => {
    const stamp = "2026-11-02T00:00:00Z";
    const addWorker = (uuid, show) =>
      db().prepare("INSERT INTO herma_worker_registry (worker_uuid, agent_id, persona_id, persona_label, specialty_lens, created_at, updated_at, show_on_map) VALUES (?, ?, 'p', 'Persona', 'Lens', ?, ?, ?)").bind(uuid, `agent-${uuid}`, stamp, stamp, show).run();
    await addWorker("w_hidden", 0);
    await addWorker("w_shown", 1);
    await recordClaimEdge(db(), edge("FRA", "EU"), { task: task("t_h"), workerUuid: "w_hidden", agentId: "agent-w_hidden" });
    await recordClaimEdge(db(), edge("FRA", "EU"), { task: task("t_s"), workerUuid: "w_shown", agentId: "agent-w_shown" });
    const rows = (await db().prepare("SELECT worker_uuid, colo, continent, kind FROM herma_claim_edge ORDER BY id").all()).results;
    expect(rows[0]).toMatchObject({ worker_uuid: "w_hidden", colo: "", continent: "" });
    expect(rows[1]).toMatchObject({ worker_uuid: "w_shown", colo: "FRA", continent: "EU" });
  });

  it("names a data center only for claims made with another worker of the kind in the 15 minutes before, and counts a lone worker under its continent and a hidden worker in the totals only", async () => {
    for (const [uuid, colo, continent, tier, minutes] of [["w_a", "FRA", "EU", "ngo_priority", 6], ["w_b", "FRA", "EU", "public_general", 5], ["w_c", "SYD", "OC", "public_general", 4], ["w_d", "FRA", "EU", "public_general", 3]]) {
      await recordClaimEdge(db(), edge(colo, continent), { task: await queueTask(`task_of_${uuid.slice(2)}_claim`, { tier }), workerUuid: uuid, agentId: `agent-${uuid}`, nowIso: minutesAgo(minutes) });
    }
    await setShowOnMap(db(), "w_d", false); // w_d has no registry row yet: nothing to update, and it stays shown
    await db().prepare("INSERT INTO herma_worker_registry (worker_uuid, agent_id, persona_id, persona_label, specialty_lens, created_at, updated_at, show_on_map) VALUES ('w_d', 'agent-w_d', 'p', 'Persona', 'Lens', '2026-11-02T00:00:00Z', '2026-11-02T00:00:00Z', 0)").run();
    resetNetworkCaches();

    const res = await call("/q/network");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(`public, max-age=${NETWORK_GRID.cache_seconds}, stale-while-revalidate=${NETWORK_GRID.stale_seconds}`);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.window_hours).toBe(24);
    expect(body.totals).toMatchObject({ workers: 4, claims: 4, nonprofit_claims: 1, data_centres: 1 });
    // w_a came first and was alone, so its claim counts under Europe; w_b's claim, with w_a there 1 minute before, is the one named at FRA.
    const fra = body.data_centres.find((d) => d.code === "FRA");
    expect(fra).toMatchObject({ continent: "Europe", workers: 2, claims: 1 });
    expect(body.data_centres.find((d) => d.code === "SYD")).toBeUndefined();
    expect(body.continents.find((c) => c.name === "Europe")).toMatchObject({ workers: 1, claims: 1 });
    expect(body.continents.find((c) => c.name === "Oceania")).toMatchObject({ workers: 1, claims: 1 });
    expect(body.recent_claims.map((c) => c.via.type)).toEqual(["continent", "data_centre", "continent"]); // newest first: w_c, w_b, w_a; the hidden worker is in no feed
    expect(body.recent_claims).toHaveLength(3);
    // No worker id, agent name or address leaves the Worker.
    for (const secret of ["w_a", "w_b", "w_c", "w_d", "agent-w_a", "x-herma-cors"]) expect(text).not.toContain(secret);
  });

  it("shows the same label for a claim in the feed, the replay and the place list: a worker that was alone is never named at its data center", async () => {
    const volunteer = async (uuid, minutes, taskId) =>
      recordClaimEdge(db(), edge("FRA", "EU"), { task: await queueTask(taskId), workerUuid: uuid, agentId: `agent-${uuid}`, nowIso: minutesAgo(minutes) });
    await volunteer("w_old", 20 * 60, "alone_old"); // another volunteer through FRA twenty hours ago
    await volunteer("w_alone", 3, "alone_now"); // the one that is alone now
    const label = (c) => (c.via.type === "data_centre" ? c.via.code : `(${c.via.continent})`);
    let body = await (await call("/q/network?replay=1")).json();
    expect(body.data_centres).toEqual([]); // FRA is named for nobody
    expect(body.recent_claims.map(label)).toEqual(["(Europe)", "(Europe)"]);
    expect(body.replay.claims.map(label)).toEqual(["(Europe)"]);
    expect(body.continents).toMatchObject([{ name: "Europe", workers: 2, claims: 2 }]);
    // A second volunteer comes through FRA a minute later: its own claim is named, the claims before it are not, and every view agrees.
    resetNetworkCaches();
    await volunteer("w_joined", 2, "joined_now");
    body = await (await call("/q/network?replay=1")).json();
    expect(body.data_centres.map((d) => [d.code, d.workers, d.claims])).toEqual([["FRA", 2, 1]]);
    const joinedAt = (await db().prepare("SELECT claimed_at FROM herma_claim_edge WHERE worker_uuid = 'w_joined'").first()).claimed_at;
    expect(body.data_centres[0].last_claim_at).toBe(joinedAt);
    expect(body.recent_claims.map(label)).toEqual(["FRA", "(Europe)", "(Europe)"]);
    expect(body.replay.claims.map(label)).toEqual(["(Europe)", "FRA"]); // oldest first; the 20-hour-old claim is outside the hour
  });

  it("names the model a volunteer declared: the family without a version, the catalog's name, or the cleaned id, and never one the word list changes", async () => {
    const declared = [["w_m1", "muse-spark"], ["w_m2", "muse-spark-1.3"], ["w_m3", "My_Custom Model.v2!!"], ["w_m4", "x".repeat(60)], ["w_m5", "a1b2c3d4e5f6a7b8c9"], ["w_m6", ""]];
    for (const [index, [uuid, model]] of declared.entries()) {
      await recordClaimEdge(db(), edge("FRA", "EU"), { task: await queueTask(`task_${uuid}`), workerUuid: uuid, agentId: `agent-${uuid}`, modelHint: model, nowIso: minutesAgo(30 - index) });
    }
    await recordClaimEdge(db(), edge("FRA", "EU"), { task: await queueTask("task_w_team"), workerUuid: "w_team", agentId: "ta-amps-model-test", modelHint: "muse-spark", nowIso: minutesAgo(2) });
    const body = await (await call("/q/network?replay=1")).json();
    const model = (uuid) => body.recent_claims.find((c) => c.title === `Plan for task_${uuid}`)?.model;
    expect(model("w_m1")).toEqual({ name: "Muse Spark", declared: true });
    expect(model("w_m2")).toEqual({ name: "Muse Spark 1.3", declared: true });
    expect(model("w_m3")).toEqual({ name: "my-custom-model.v2", declared: true });
    expect(model("w_m4")).toEqual({ name: "x".repeat(40), declared: true });
    expect(model("w_m5")).toBeNull(); // changed by the word list: not shown
    expect(model("w_m6")).toBeNull();
    expect(model("w_team")).toEqual({ name: "Muse Spark", declared: false }); // a team agent's model is not a volunteer's declaration
    expect(JSON.stringify(body)).not.toContain("a1b2c3d4e5f6a7b8c9");
  });

  it("keeps each claim for 30 days, then only a count per day and continent", async () => {
    await call("/q/network"); // creates the tables
    await db().prepare("DELETE FROM herma_claim_daily").run();
    const now = Date.parse("2026-12-15T12:00:00.000Z");
    const ago = (days, hour = 9) => new Date(now - days * 86400000 + (hour - 12) * 3600000).toISOString();
    for (const [colo, continent, uuid, days, hour] of [["FRA", "EU", "w_a", 40, 9], ["CDG", "EU", "w_b", 40, 15], ["SYD", "OC", "w_c", 35, 9], ["FRA", "EU", "w_a", 5, 9]]) {
      await recordClaimEdge(db(), edge(colo, continent), { task: task(`t_${uuid}_${days}`), workerUuid: uuid, agentId: `agent-${uuid}`, nowIso: ago(days, hour) });
    }
    await pruneClaimEdges(db(), new Date(now).toISOString());
    const left = (await db().prepare("SELECT worker_uuid, claimed_at FROM herma_claim_edge").all()).results;
    expect(left.map((r) => r.claimed_at)).toEqual([ago(5)]);
    const daily = (await db().prepare("SELECT day, continent, claims FROM herma_claim_daily ORDER BY day").all()).results;
    expect(daily).toEqual([{ day: "2026-11-05", continent: "EU", claims: 2 }, { day: "2026-11-10", continent: "OC", claims: 1 }]);
    expect(Object.keys(daily[0]).sort()).toEqual(["claims", "continent", "day"]); // no worker, model, data center or Task
    await pruneClaimEdges(db(), new Date(now).toISOString()); // again: nothing is counted twice
    expect((await db().prepare("SELECT day, continent, claims FROM herma_claim_daily ORDER BY day").all()).results).toEqual(daily);
    // Later pruning adds to the same day instead of replacing it.
    await recordClaimEdge(db(), edge("FRA", "EU"), { task: task("t_late"), workerUuid: "w_d", agentId: "agent-d", nowIso: ago(40, 20) });
    await pruneClaimEdges(db(), new Date(now).toISOString());
    expect((await db().prepare("SELECT claims FROM herma_claim_daily WHERE day = '2026-11-05' AND continent = 'EU'").first()).claims).toBe(3);
  });

  it("rolls old claims up when the map is read or a claim arrives, whatever the id of the newest row", async () => {
    await call("/q/network"); // creates the tables
    await db().prepare("DELETE FROM herma_claim_daily").run();
    const old = new Date(Date.now() - 40 * 86400000).toISOString();
    await recordClaimEdge(db(), edge("FRA", "EU"), { task: task("t_old_1"), workerUuid: "w_x", agentId: "agent-x", nowIso: old });
    await recordClaimEdge(db(), edge("FRA", "EU"), { task: task("t_old_2"), workerUuid: "w_y", agentId: "agent-y", nowIso: old });
    // The two inserts just above may already have looked (an isolate looks at most once an hour); make sure the rows are still there to find.
    expect(Number((await db().prepare("SELECT COUNT(*) AS n FROM herma_claim_edge").first()).n) + Number((await db().prepare("SELECT COALESCE(SUM(claims), 0) AS n FROM herma_claim_daily").first()).n)).toBe(2);
    resetNetworkCaches();
    await recordClaimEdge(db(), edge("FRA", "EU"), { task: task("t_old_3"), workerUuid: "w_z", agentId: "agent-z", nowIso: old }); // a stale row again, and the guard is fresh
    await call("/q/network"); // a read looks for stale rows first
    expect(Number((await db().prepare("SELECT COUNT(*) AS n FROM herma_claim_edge WHERE claimed_at < ?").bind(new Date(Date.now() - 30 * 86400000).toISOString()).first()).n)).toBe(0);
    expect(Number((await db().prepare("SELECT COALESCE(SUM(claims), 0) AS n FROM herma_claim_daily").first()).n)).toBe(3);
  });

  it("never lends the public map a private Task's title or link, or the title of a Task the queue no longer holds: those claims count in the totals only", async () => {
    const open = await queueTask("map_public_task_1", { title: "A public plan for the pantry" });
    const secret = await queueTask("map_private_task_1", { tier: "infra_private", visibility: "server_infra", title: "Private plan nobody outside may read" });
    // A row whose visibility says public but whose tier is private (the gateway tests both): the map treats it as private too.
    const mixed = await queueTask("map_mixed_task_1", { tier: "infra_private", visibility: "public_commons", title: "Mixed-up plan that is private by its tier" });
    for (const [uuid, claimed, minutes] of [["w_p1", secret, 9], ["w_p5", mixed, 7], ["w_p2", open, 6], ["w_p3", open, 4], ["w_p4", task("map_task_that_is_gone_1"), 2]]) {
      await recordClaimEdge(db(), edge("FRA", "EU"), { task: claimed, workerUuid: uuid, agentId: `agent-${uuid}`, nowIso: minutesAgo(minutes) });
    }
    resetNetworkCaches();
    const text = await (await call("/q/network?replay=1")).text();
    const body = JSON.parse(text);
    expect(text).not.toContain("Private plan");
    expect(text).not.toContain("map_private_task_1");
    expect(text).not.toContain("Mixed-up plan");
    expect(text).not.toContain("map_mixed_task_1");
    expect(text).not.toContain("map_task_that_is_gone_1");
    expect(body.totals).toMatchObject({ workers: 5, claims: 5 }); // all five are counted
    expect(body.recent_claims.map((c) => c.title)).toEqual(["A public plan for the pantry", "A public plan for the pantry"]);
    expect(body.recent_claims.map((c) => c.object_key)).toEqual(["map_public_task_1", "map_public_task_1"]);
    expect(body.data_centres.map((d) => [d.code, d.workers, d.claims])).toEqual([["FRA", 2, 1]]); // only the public pair is placed; the private claim is nowhere
  });

  it("stays public when the free window has ended or the kill switch is on, and is not counted against the free window's per-address cap", async () => {
    const ended = { HERMA_FREE_WINDOW_NOW_ISO: "2027-01-01T00:00:05-05:00" };
    expect((await callWith("/q/network", ended)).status).toBe(200);
    expect((await callWith("/q/network", ended, { method: "HEAD" })).status).toBe(200);
    expect((await callWith("/q/network", ended, { method: "OPTIONS", headers: { origin: "https://eranosforgood.org" } })).status).toBe(204);
    expect((await callWith("/q/network", { FREE_ACCESS_KILL_SWITCH: "1" })).status).toBe(200);
    // The guard itself is unchanged: other unauthenticated reads stop, and so does a POST to the map.
    expect((await callWith("/q/search?q=cost+model", ended)).status).toBe(401);
    expect((await callWith("/q/network", ended, { method: "POST", body: "{}" })).status).toBe(401);
    // With a cap of one request a minute, the same address can still read the map again and again.
    const capped = { FREE_ACCESS_UNAUTH_RPM_CAP: "1" };
    const address = { "cf-connecting-ip": "203.0.113.77" };
    for (let i = 0; i < 4; i += 1) expect((await callWith("/q/network", capped, { headers: address })).status).toBe(200);
  });

  it("has its own generous cap per address, and does not limit a caller that has no address", async () => {
    const small = { NETWORK_READS_PER_MINUTE: "3" };
    const address = { "cf-connecting-ip": "198.51.100.9" };
    const codes = [];
    for (let i = 0; i < 5; i += 1) codes.push((await callWith("/q/network", small, { headers: address })).status);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    const refused = await callWith("/q/network", small, { headers: address });
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await refused.json()).code).toBe("rate_limited");
    expect((await callWith("/q/network", small, { headers: { "cf-connecting-ip": "198.51.100.10" } })).status).toBe(200); // another address
    for (let i = 0; i < 8; i += 1) expect((await callWith("/q/network", small)).status).toBe(200); // a service binding has no address
    expect(NETWORK_GRID.reads_per_minute_per_address).toBeGreaterThanOrEqual(100);
  });

  it("filters the feed by kind without changing the counts", async () => {
    await recordClaimEdge(db(), edge("FRA", "EU"), { task: await queueTask("t_n", { tier: "ngo_priority" }), workerUuid: "w_a", agentId: "a", nowIso: minutesAgo(3) });
    await recordClaimEdge(db(), edge("FRA", "EU"), { task: await queueTask("t_s"), workerUuid: "w_b", agentId: "b", nowIso: minutesAgo(2) });
    const all = await (await call("/q/network")).json();
    const onlyNonprofit = await (await call("/q/network?kind=nonprofit")).json();
    expect(onlyNonprofit.totals).toEqual(all.totals);
    expect(all.recent_claims).toHaveLength(2);
    expect(onlyNonprofit.recent_claims.map((c) => c.kind)).toEqual(["nonprofit"]);
    expect((await (await call("/q/network?kind=nonsense")).json()).recent_claims).toHaveLength(2);
  });

  it("adds the last hour on request and merges Tessera's aggregate when it answers", async () => {
    await recordClaimEdge(db(), edge("FRA", "EU"), { task: await queueTask("t_1"), workerUuid: "w_a", agentId: "a", nowIso: minutesAgo(3) });
    await recordClaimEdge(db(), edge("FRA", "EU"), { task: await queueTask("t_2"), workerUuid: "w_b", agentId: "b", nowIso: minutesAgo(2) });
    const replay = await (await call("/q/network?replay=1")).json();
    expect(replay.replay.claims).toHaveLength(2);
    expect(Date.parse(replay.replay.to) - Date.parse(replay.replay.from)).toBe(3600 * 1000);

    resetNetworkCaches();
    const tessera = {
      as_of: new Date().toISOString(), window_seconds: 86400,
      places: [{ place: "FRA", level: "colo", continent: "EU", workers: 3, claims: 5, by_class: { shared: 5 }, last_claim_at: new Date().toISOString() }],
      recent: [], totals: { claims: 5, workers: 3, places: 1 },
    };
    const calls = [];
    const body = await buildNetworkBody({ db: db(), env, nowMs: Date.now(), fetchImpl: async (url) => (calls.push(url), new Response(JSON.stringify(tessera), { status: 200 })) });
    expect(calls).toEqual([`${NETWORK_GRID.tessera_origin}${NETWORK_GRID.tessera_path}?window=24h`]);
    expect(body.data_centres.find((d) => d.code === "FRA")).toMatchObject({ workers: 5, claims: 6 }); // Herma's 2 workers (1 claim named there) + Tessera's 3 workers and 5 claims
    expect(body.totals).toMatchObject({ workers: 5, claims: 7 });

    resetNetworkCaches();
    const down = await buildNetworkBody({ db: db(), env, nowMs: Date.now(), fetchImpl: async () => new Response("no", { status: 404 }) });
    expect(down.totals).toMatchObject({ workers: 2, claims: 2 });
  });

  it("remembers a 404 from Tessera for five minutes, so a map without Tessera does not spend a call on it with every cold read", async () => {
    const calls = [];
    const missing = async (url) => (calls.push(url), new Response("not found", { status: 404 }));
    const t0 = Date.now();
    await buildNetworkBody({ db: db(), env, nowMs: t0, fetchImpl: missing });
    expect(calls).toHaveLength(1);
    await buildNetworkBody({ db: db(), env, nowMs: t0 + 20_000, fetchImpl: missing }); // the 15 s memory of the map is over; Tessera is still known to be missing
    await buildNetworkBody({ db: db(), env, nowMs: t0 + 200_000, fetchImpl: missing, replay: true });
    expect(calls).toHaveLength(1);
    await buildNetworkBody({ db: db(), env, nowMs: t0 + 301_000, fetchImpl: missing });
    expect(calls).toHaveLength(2); // asked again after five minutes
    // Any other failure is not remembered that long.
    resetNetworkCaches();
    const flaky = async () => new Response("busy", { status: 503 });
    let asked = 0;
    const counting = async (url) => (asked++, flaky(url));
    await buildNetworkBody({ db: db(), env, nowMs: t0, fetchImpl: counting });
    await buildNetworkBody({ db: db(), env, nowMs: t0 + 20_000, fetchImpl: counting });
    expect(asked).toBe(2);
  });

  it("answers the three sites' browsers (CORS) and nobody else's, and only GET, HEAD and OPTIONS", async () => {
    const withOrigin = (origin, init = {}) => call("/q/network", { ...init, headers: { origin } });
    const allowed = await withOrigin("https://agora.eranosforgood.org");
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://agora.eranosforgood.org");
    expect(allowed.headers.get("vary")).toContain("Origin");
    expect((await withOrigin("https://teleionlabs.com")).headers.get("access-control-allow-origin")).toBe("https://teleionlabs.com");
    expect((await withOrigin("https://eranosforgood.org")).headers.get("access-control-allow-origin")).toBe("https://eranosforgood.org");
    expect((await withOrigin("https://example.invalid")).headers.get("access-control-allow-origin")).toBeNull();
    const preflight = await call("/q/network", { method: "OPTIONS", headers: { origin: "https://eranosforgood.org" } });
    expect(preflight.status).toBe(204); // the Worker answers every /q/ preflight itself
    expect((await call("/q/network", { method: "HEAD" })).status).toBe(200);
    const post = await call("/q/network", { method: "POST", body: "{}" });
    expect(post.status).toBe(405);
  });
});

describe("joining and claiming", () => {
  beforeEach(ready, 60000); // the first /q/pulse creates every table and can be slow on a busy machine

  it("takes show_on_map when a worker joins and records its claim with the model it declared", async () => {
    const join = await call("/q/onboard", json({ agent_id: "map-test-volunteer-1", model_hint: "muse-spark-1.3", show_on_map: false }));
    const joined = await join.json();
    expect(joined.workflow_guidance.map_notice).toContain("never by IP address or home");
    const uuid = joined.worker_profile.worker_uuid;
    expect(await choiceOf(uuid)).toBe(0);
    expect(joined.worker_profile.show_on_map).toBe(false); // applied: the profile says what was applied

    const claim = await call("/q/claim", json({ agent_id: "map-test-volunteer-1", worker_uuid: uuid, worker_token: joined.worker_token, show_on_map: true }));
    expect(claim.status).toBe(200);
    expect(await choiceOf(uuid)).toBe(1);
    const claimed = await db().prepare("SELECT kind, worker_kind, model FROM herma_claim_edge WHERE worker_uuid = ?").bind(uuid).first();
    expect(claimed).toMatchObject({ worker_kind: "volunteer", model: "muse-spark-1.3" });
    expect(["nonprofit", "shared", "check", "own"]).toContain(claimed.kind);
  });

  it("keeps a worker's map choice with its owner: nobody who only knows the agent name or the uuid can change it", async () => {
    const joined = await (await call("/q/onboard", json({ agent_id: "map-test-owner-1", model_hint: "muse-spark-1.3", show_on_map: " disabled " }))).json();
    const uuid = joined.worker_profile.worker_uuid;
    const token = joined.worker_token;
    expect(token).toBeTruthy();
    expect(await choiceOf(uuid)).toBe(0); // " disabled " is read as off when the worker is created

    // A stranger who knows the agent name (the dashboard and the worker page show it) and perhaps the uuid, with no token:
    const refused = await (await call("/q/onboard", json({ agent_id: "map-test-owner-1", show_on_map: true }))).json();
    expect(refused.worker_profile.show_on_map_note).toContain("Not applied");
    expect(refused.worker_profile.show_on_map).toBeUndefined(); // a refusal does not tell a stranger what the choice in force is
    const byName = await call("/q/claim", json({ agent_id: "map-test-owner-1", show_on_map: false }));
    expect(byName.status).toBe(403); // by agent name only, a worker that has a token is not taken as that worker (test/claim_token.test.js)
    const asked = await (await call("/q/claim", json({ agent_id: "map-test-owner-1", worker_uuid: uuid, show_on_map: false }))).json(); // with the id the claim is accepted, the choice is not
    expect(asked.bilateral_guidance.worker_profile.show_on_map).toBeUndefined();
    expect(asked.bilateral_guidance.worker_profile.show_on_map_note).toContain("Not applied");
    await call("/q/onboard", json({ agent_id: "map-test-owner-1", worker_uuid: uuid, show_on_map: "yes" }));
    await call("/q/claim/map-test-owner-1?show_on_map=true");
    await call("/q/claim", json({ agent_id: "map-test-owner-1", show_on_map: true }));
    await call("/q/claim", json({ agent_id: "map-test-owner-1", worker_uuid: uuid, show_on_map: true }));
    await call(`/q/claim/map-test-owner-1?worker_uuid=${uuid}&show_on_map=true`);
    expect(await choiceOf(uuid)).toBe(0);
    // A wrong token is refused outright and changes nothing.
    const wrong = await call("/q/claim", json({ agent_id: "map-test-owner-1", worker_uuid: uuid, worker_token: "not-the-token", show_on_map: true }));
    expect(wrong.status).toBe(403);
    expect(await choiceOf(uuid)).toBe(0);
    // The same holds the other way round: a stranger cannot switch a visible worker off.
    const open = await (await call("/q/onboard", json({ agent_id: "map-test-owner-2", show_on_map: true }))).json();
    await call("/q/onboard", json({ agent_id: "map-test-owner-2", show_on_map: false }));
    await call("/q/claim", json({ agent_id: "map-test-owner-2", worker_uuid: open.worker_profile.worker_uuid, show_on_map: "off" }));
    expect(await choiceOf(open.worker_profile.worker_uuid)).toBe(1);

    // The owner, with its token, can change it, at onboarding and on a claim, in any reasonable spelling.
    const back = await (await call("/q/onboard", json({ agent_id: "map-test-owner-1", worker_uuid: uuid, worker_token: token, show_on_map: "true" }))).json();
    expect(back.worker_profile.show_on_map_note).toBeUndefined();
    expect(back.worker_profile.show_on_map).toBe(true);
    expect(await choiceOf(uuid)).toBe(1);
    await call("/q/claim", json({ agent_id: "map-test-owner-1", worker_uuid: uuid, worker_token: token, show_on_map: "hide" }));
    expect(await choiceOf(uuid)).toBe(0);
    await call(`/q/claim/map-test-owner-1?worker_uuid=${uuid}&worker_token=${token}&show_on_map=yes`);
    expect(await choiceOf(uuid)).toBe(1);
  });

  it("honours a choice sent in the call that creates the worker, by onboarding or by a first claim, in any spelling of off", async () => {
    for (const [agent, spelling] of [["map-test-new-1", "n"], ["map-test-new-2", "Hide"], ["map-test-new-3", "false"], ["map-test-new-4", " disabled "]]) {
      const made = await (await call("/q/claim", json({ agent_id: agent, show_on_map: spelling }))).json();
      const uuid = made.bilateral_guidance.worker_profile.worker_uuid;
      expect(await choiceOf(uuid)).toBe(0);
      expect(made.bilateral_guidance.worker_profile.show_on_map).toBe(false);
    }
    const viaGet = await (await call("/q/onboard?agent_id=map-test-new-5&show_on_map=off")).json();
    expect(await choiceOf(viaGet.worker_profile.worker_uuid)).toBe(0);
    const unsaid = await (await call("/q/onboard", json({ agent_id: "map-test-new-6" }))).json();
    expect(await choiceOf(unsaid.worker_profile.worker_uuid)).toBe(1); // none given: shown, the default
  });
});
