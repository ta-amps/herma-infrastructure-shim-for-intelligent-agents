// The five plain numbers on the home page ("Today"), read from the same tables as the dashboard and with the same definitions:
// workers and the agent names behind them, Tasks waiting / being worked on / done for nonprofits and shared, Task Objects and their size,
// checks and searchable entries. Public rows only. Null when the tables are not there yet.

export async function readHomeTotals(db) {
  if (!db?.prepare) return null;
  try {
    const nowIso = new Date().toISOString();
    const [counts, workers, objects, checks, searchable] = await Promise.all([
      db
        .prepare(
          `SELECT tier,
                  CASE WHEN state = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ? THEN 'ready' ELSE state END AS live_state,
                  COUNT(*) AS cnt
             FROM herma_durable_queue
            WHERE visibility IN ('public_ngo', 'public_commons')
            GROUP BY tier, live_state`
        )
        .bind(nowIso)
        .all(),
      db
        .prepare(
          `SELECT (SELECT COUNT(*) FROM herma_worker_registry) AS cnt,
                  (SELECT COUNT(DISTINCT producer_agent) FROM herma_task_objects WHERE visibility IN ('public_ngo', 'public_commons')) AS names`
        )
        .first(),
      db
        .prepare(
          `SELECT COUNT(*) AS cnt, COALESCE(SUM(CASE WHEN total_payload_bytes > 0 THEN total_payload_bytes ELSE LENGTH(payload_json) END), 0) AS bytes
             FROM herma_task_objects WHERE visibility IN ('public_ngo', 'public_commons')`
        )
        .first(),
      db.prepare("SELECT COUNT(*) AS cnt FROM herma_evaluations").first(),
      db.prepare("SELECT COUNT(*) AS cnt FROM herma_search_sidecar").first(),
    ]);
    const tier = (name) => {
      const out = { ready: 0, leased: 0, done: 0 };
      for (const r of counts?.results || []) if (r.tier === name && out[r.live_state] !== undefined) out[r.live_state] += Number(r.cnt);
      return out;
    };
    return {
      workers: Number(workers?.cnt || 0),
      agent_names: Number(workers?.names || 0),
      nonprofit: tier("ngo_priority"),
      shared: tier("public_general"),
      task_objects: Number(objects?.cnt || 0),
      task_object_bytes: Number(objects?.bytes || 0),
      checks: Number(checks?.cnt || 0),
      searchable: Number(searchable?.cnt || 0),
    };
  } catch {
    return null;
  }
}
