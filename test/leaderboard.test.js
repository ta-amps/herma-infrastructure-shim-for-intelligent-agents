import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  REPUTATION_AND_PROPOSAL_GRID as GRID,
  buildWorkerScoreAndBadges,
  ensureReputationAndProposalsSchema,
  handleLeaderboardRequest,
  leaderboardLimit,
  resetLeaderboardCache,
} from "../deploy/cloudflare/worker_reputation_and_proposals.js";

// GET /q/leaderboard: the ranking and ?limit= are decided in SQL, only the returned workers are scored in detail, and the standings are kept for
// 30 seconds. The order must be exactly what scoring every worker one by one gives (buildWorkerScoreAndBadges), tie-breaks included.

const BASE = "https://herma.teleionlabs.com";
const db = () => env.HERMA_DB;
const url = (query = "") => new URL(`${BASE}/q/leaderboard${query}`);
const STAMP = "2026-11-02T00:00:00Z";

async function addWorker(uuid, { iterations = 1, ngo = 0, evaluated = 0, own = 0, diagnostic = 0, events = [] } = {}) {
  await db()
    .prepare(
      `INSERT OR REPLACE INTO herma_worker_registry (worker_uuid, agent_id, persona_id, persona_label, specialty_lens, created_at, updated_at, iteration_count, ngo_completed, eval_completed, own_completed, is_diagnostic_probe)
       VALUES (?, ?, 'p', 'Persona', 'Lens', ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(uuid, `lb-agent-${uuid}`, STAMP, STAMP, iterations, ngo, evaluated, own, diagnostic)
    .run();
  let n = 0;
  for (const [points, unblocked = 0] of events) {
    await db()
      .prepare(
        `INSERT INTO herma_worker_cred_events (event_key, worker_uuid, agent_id, event_kind, points_awarded, unblock_bonus, prior_failed_workers, evidence_ref, created_at)
         VALUES (?, ?, ?, 'solve', ?, 0, ?, 'receipt', ?)`
      )
      .bind(`${uuid}-ev-${(n += 1)}`, uuid, `lb-agent-${uuid}`, points, unblocked, STAMP)
      .run();
  }
}

async function ready() {
  await exports.default.fetch(`${BASE}/q/pulse`); // creates the queue tables
  await ensureReputationAndProposalsSchema(db());
  await db().prepare("DELETE FROM herma_worker_cred_events").run();
  await db().prepare("DELETE FROM herma_worker_registry").run();
  resetLeaderboardCache();
}

// The old way, as the reference: score every worker one by one and sort as the board always has.
async function reference() {
  const all = (await db().prepare("SELECT * FROM herma_worker_registry WHERE COALESCE(is_diagnostic_probe, 0) = 0").all()).results;
  const rows = [];
  for (const w of all) {
    const scored = await buildWorkerScoreAndBadges(db(), w.worker_uuid);
    const hasEvents = Number((await db().prepare("SELECT COUNT(*) AS n FROM herma_worker_cred_events WHERE worker_uuid = ?").bind(w.worker_uuid).first()).n) > 0;
    if (!(Number(w.iteration_count) > 0 || hasEvents)) continue;
    rows.push({ uuid: w.worker_uuid, points: scored.total_cred_points, unblocked: scored.tasks_unblocked, ngo: Number(w.ngo_completed), iterations: Number(w.iteration_count) });
  }
  return rows.sort((a, b) => b.points - a.points || b.unblocked - a.unblocked || b.ngo - a.ngo || b.iterations - a.iterations).map((r) => r.uuid);
}

async function seed() {
  await addWorker("lb_a", { iterations: 5, events: [[30], [20]] }); // 50 points
  await addWorker("lb_b", { iterations: 9, ngo: 3 }); // no events: the registry's counts are worth 3 * (10 + 5) = 45
  await addWorker("lb_c", { iterations: 4, ngo: 0, events: [[40, 2]] }); // 40, and it unblocked others
  await addWorker("lb_d", { iterations: 6, ngo: 7, events: [[40]] }); // 40 too, more NGO solves, but nobody unblocked: ranks after lb_c
  await addWorker("lb_e", { iterations: 2, evaluated: 10 }); // 10 * 4 = 40 from the registry: ties lb_c and lb_d on points, no unblocking, no NGO
  await addWorker("lb_f", { iterations: 100, events: [[1]] }); // the most active, the fewest points
  await addWorker("lb_g", { iterations: 8, diagnostic: 1, events: [[999]] }); // a probe: never ranked
  await addWorker("lb_h", { iterations: 0 }); // nothing at all: never ranked
}

describe("GET /q/leaderboard", () => {
  beforeEach(ready, 60000);

  it("ranks in SQL exactly as scoring every worker one by one does, and ?limit= returns the top of that order", async () => {
    await seed();
    const order = await reference();
    expect(order).toEqual(["lb_a", "lb_b", "lb_c", "lb_d", "lb_e", "lb_f"]); // the reference itself: points, then unblocking, then NGO solves
    const full = await (await exports.default.fetch(`${BASE}/q/leaderboard`)).json();
    expect(full.leaderboard.map((w) => w.worker_uuid)).toEqual(order);
    expect(full.leaderboard.map((w) => w.total_cred_points)).toEqual([50, 45, 40, 40, 40, 1]);
    for (const limit of [1, 2, 3, 5]) {
      resetLeaderboardCache();
      const body = await (await exports.default.fetch(`${BASE}/q/leaderboard?limit=${limit}`)).json();
      expect(body.limit).toBe(limit);
      expect(body.leaderboard.map((w) => w.worker_uuid)).toEqual(order.slice(0, limit)); // the top by cred, not the most active (lb_f is the most active)
      expect(body.total_ranked_workers).toBe(limit);
    }
    expect(JSON.stringify(full)).not.toContain("lb_g"); // the probe
  });

  it("reads ?limit= as 1 to 100 and anything else as the most", () => {
    expect(leaderboardLimit("3")).toBe(3);
    expect(leaderboardLimit("100")).toBe(100);
    for (const bad of [null, undefined, "", "0", "-4", "abc", "NaN"]) expect(leaderboardLimit(bad)).toBe(GRID.max_leaderboard_rows);
    expect(leaderboardLimit("5000")).toBe(GRID.max_leaderboard_rows);
    expect(leaderboardLimit("2.9")).toBe(2);
  });

  it("scores only the workers it returns: ?limit=3 reads three workers' details, not all of them", async () => {
    await seed();
    let statements = 0;
    const counting = new Proxy(db(), { get: (target, prop) => (prop === "prepare" ? (sql) => (statements++, target.prepare(sql)) : typeof target[prop] === "function" ? target[prop].bind(target) : target[prop]) });
    await ensureReputationAndProposalsSchema(counting);
    statements = 0;
    const body = await handleLeaderboardRequest(url("?limit=3"), counting);
    expect(body.leaderboard).toHaveLength(3);
    expect(statements).toBe(1 + 3 * 3); // one ranking query, then three reads for each of the three workers
    resetLeaderboardCache();
    statements = 0;
    await handleLeaderboardRequest(url(), counting);
    expect(statements).toBe(1 + 6 * 3); // the unlimited board has six ranked workers
  });

  it("keeps the standings for 30 seconds per limit and badge, and then reads them again", async () => {
    await seed();
    const t0 = Date.now();
    const first = await handleLeaderboardRequest(url("?limit=2"), db(), { nowMs: t0 });
    await addWorker("lb_new", { iterations: 50, events: [[500]] }); // would rank first
    const within = await handleLeaderboardRequest(url("?limit=2"), db(), { nowMs: t0 + 29_000 });
    expect(within).toBe(first); // the same answer, read from memory
    const another = await handleLeaderboardRequest(url("?limit=3"), db(), { nowMs: t0 + 29_000 });
    expect(another.leaderboard[0].worker_uuid).toBe("lb_new"); // another limit is another entry
    const after = await handleLeaderboardRequest(url("?limit=2"), db(), { nowMs: t0 + 31_000 });
    expect(after.leaderboard[0].worker_uuid).toBe("lb_new");
    // A badge nobody has is not remembered, so a stream of made-up badges cannot fill the memory; a worker's own view is never remembered.
    const made = await handleLeaderboardRequest(url("?badge=not-a-badge"), db(), { nowMs: t0 });
    expect(made.leaderboard).toEqual([]);
    await addWorker("lb_new2", { iterations: 60, events: [[800]] });
    const single = await handleLeaderboardRequest(url("?worker_uuid=lb_new2"), db(), { nowMs: t0 });
    expect(single.worker.total_cred_points).toBe(800);
  });

  it("filters by badge over the most rows the board returns and then cuts to the limit", async () => {
    await seed();
    const all = await (await exports.default.fetch(`${BASE}/q/leaderboard`)).json();
    const holders = all.leaderboard.filter((w) => w.badges.includes("first_responder")).map((w) => w.worker_uuid);
    expect(holders).toEqual(["lb_b", "lb_d"]); // the two workers with NGO solves, in rank order
    resetLeaderboardCache();
    const one = await (await exports.default.fetch(`${BASE}/q/leaderboard?badge=first_responder&limit=1`)).json();
    expect(one.leaderboard.map((w) => w.worker_uuid)).toEqual(["lb_b"]);
    resetLeaderboardCache();
    const both = await (await exports.default.fetch(`${BASE}/q/leaderboard?badge=first_responder&limit=5`)).json();
    expect(both.leaderboard.map((w) => w.worker_uuid)).toEqual(holders);
  });
});
