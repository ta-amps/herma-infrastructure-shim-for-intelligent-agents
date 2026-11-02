import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../deploy/cloudflare/worker.js";
import { NETWORK_GRID, buildNetworkBody, networkKind, networkWorkerKind, parseShowOnMap, pruneClaimEdges, recordClaimEdge, resetNetworkCaches, setShowOnMap } from "../deploy/cloudflare/network_activity.js";

// GET /q/network (design contract claude-design-network-map.v1.json): where workers connect and what they pick up.
// Only request.cf.colo and request.cf.continent are kept per claim; a data center shows at 2 or more distinct workers.

const BASE = "https://herma.teleionlabs.com";
const call = (path, init) => exports.default.fetch(BASE + path, init);
const db = () => env.HERMA_DB;
const edge = (colo, continent) => ({ cf: { colo, continent } });
const task = (id, tier = "public_general", verb_kind = "general_verb") => ({ task_id: id, tier, verb_kind });

async function ready() {
  await call("/q/pulse"); // creates the queue tables
  await db().prepare("DELETE FROM herma_claim_edge").run().catch(() => {});
  resetNetworkCaches();
}

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

  it("reads the show_on_map choice from text, numbers and booleans", () => {
    for (const yes of [true, 1, "true", "1", "yes", "ON"]) expect(parseShowOnMap(yes)).toBe(true);
    for (const no of [false, 0, "false", "0", "no", "off"]) expect(parseShowOnMap(no)).toBe(false);
    for (const none of [undefined, null, "", "maybe"]) expect(parseShowOnMap(none)).toBeUndefined();
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

  it("shows a data center at 2 distinct workers, counts a lone worker under its continent, and leaves a hidden worker in the totals only", async () => {
    for (const [uuid, colo, continent, tier] of [["w_a", "FRA", "EU", "ngo_priority"], ["w_b", "FRA", "EU", "public_general"], ["w_c", "SYD", "OC", "public_general"], ["w_d", "FRA", "EU", "public_general"]]) {
      await recordClaimEdge(db(), edge(colo, continent), { task: task(`task_of_${uuid.slice(2)}_claim`, tier), workerUuid: uuid, agentId: `agent-${uuid}` });
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
    const fra = body.data_centres.find((d) => d.code === "FRA");
    expect(fra).toMatchObject({ continent: "Europe", workers: 2, claims: 2 });
    expect(body.data_centres.find((d) => d.code === "SYD")).toBeUndefined();
    expect(body.continents.find((c) => c.name === "Oceania")).toMatchObject({ workers: 1, claims: 1 });
    expect(body.recent_claims).toHaveLength(3); // the hidden worker is in no feed
    // No worker id, agent name or address leaves the Worker.
    for (const secret of ["w_a", "w_b", "w_c", "w_d", "agent-w_a", "x-herma-cors"]) expect(text).not.toContain(secret);
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

  it("stays public when the free window has ended or the kill switch is on, and is not counted against the per-address cap", async () => {
    const withEnv = (path, extra, init = {}) => worker.fetch(new Request(BASE + path, init), { ...env, ...extra });
    const ended = { HERMA_FREE_WINDOW_NOW_ISO: "2027-01-01T00:00:05-05:00" };
    expect((await withEnv("/q/network", ended)).status).toBe(200);
    expect((await withEnv("/q/network", ended, { method: "HEAD" })).status).toBe(200);
    expect((await withEnv("/q/network", ended, { method: "OPTIONS", headers: { origin: "https://eranosforgood.org" } })).status).toBe(204);
    expect((await withEnv("/q/network", { FREE_ACCESS_KILL_SWITCH: "1" })).status).toBe(200);
    // The guard itself is unchanged: other unauthenticated reads stop, and so does a POST to the map.
    expect((await withEnv("/q/search?q=cost+model", ended)).status).toBe(401);
    expect((await withEnv("/q/network", ended, { method: "POST", body: "{}" })).status).toBe(401);
    // With a cap of one request a minute, the same address can still read the map again and again.
    const capped = { FREE_ACCESS_UNAUTH_RPM_CAP: "1" };
    const address = { "cf-connecting-ip": "203.0.113.77" };
    for (let i = 0; i < 4; i += 1) expect((await withEnv("/q/network", capped, { headers: address })).status).toBe(200);
  });

  it("filters the feed by kind without changing the counts", async () => {
    await recordClaimEdge(db(), edge("FRA", "EU"), { task: task("t_n", "ngo_priority"), workerUuid: "w_a", agentId: "a" });
    await recordClaimEdge(db(), edge("FRA", "EU"), { task: task("t_s"), workerUuid: "w_b", agentId: "b" });
    const all = await (await call("/q/network")).json();
    const onlyNonprofit = await (await call("/q/network?kind=nonprofit")).json();
    expect(onlyNonprofit.totals).toEqual(all.totals);
    expect(all.recent_claims).toHaveLength(2);
    expect(onlyNonprofit.recent_claims.map((c) => c.kind)).toEqual(["nonprofit"]);
    expect((await (await call("/q/network?kind=nonsense")).json()).recent_claims).toHaveLength(2);
  });

  it("adds the last hour on request and merges Tessera's aggregate when it answers", async () => {
    await recordClaimEdge(db(), edge("FRA", "EU"), { task: task("t_1"), workerUuid: "w_a", agentId: "a" });
    await recordClaimEdge(db(), edge("FRA", "EU"), { task: task("t_2"), workerUuid: "w_b", agentId: "b" });
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
    expect(body.data_centres.find((d) => d.code === "FRA")).toMatchObject({ workers: 5, claims: 7 });
    expect(body.totals).toMatchObject({ workers: 5, claims: 7 });

    resetNetworkCaches();
    const down = await buildNetworkBody({ db: db(), env, nowMs: Date.now(), fetchImpl: async () => new Response("no", { status: 404 }) });
    expect(down.totals).toMatchObject({ workers: 2, claims: 2 });
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
    const join = await call("/q/onboard", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent_id: "map-test-volunteer-1", model_hint: "muse-spark-1.3", show_on_map: false }) });
    const joined = await join.json();
    expect(joined.workflow_guidance.map_notice).toContain("never by IP address or home");
    const uuid = joined.worker_profile.worker_uuid;
    const row = await db().prepare("SELECT show_on_map FROM herma_worker_registry WHERE worker_uuid = ?").bind(uuid).first();
    expect(Number(row.show_on_map)).toBe(0);

    const claim = await call("/q/claim", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: "map-test-volunteer-1", worker_uuid: uuid, worker_token: joined.worker_token, show_on_map: true }),
    });
    expect(claim.status).toBe(200);
    expect(Number((await db().prepare("SELECT show_on_map FROM herma_worker_registry WHERE worker_uuid = ?").bind(uuid).first()).show_on_map)).toBe(1);
    const claimed = await db().prepare("SELECT kind, worker_kind, model FROM herma_claim_edge WHERE worker_uuid = ?").bind(uuid).first();
    expect(claimed).toMatchObject({ worker_kind: "volunteer", model: "muse-spark-1.3" });
    expect(["nonprofit", "shared", "check", "own"]).toContain(claimed.kind);
  });
});
