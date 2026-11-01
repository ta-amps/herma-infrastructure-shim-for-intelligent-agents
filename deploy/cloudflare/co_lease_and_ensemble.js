// Herma v6.9 Adaptive Multi-Worker Co-Leasing, Heartbeat (`/q/heartbeat`),
// Late-Finisher Grace Salvage, and Zero-Loss Ensemble Merge (`/q/lease-intelligence`).
//
// Strictly preserves universal `Task` (`herma_durable_queue`) and `Task Object` (`herma_task_objects`)
// primitives with zero rival work authorities, zero em-dashes, and zero legacy model names.

export const CO_LEASE_ENSEMBLE_GRID = Object.freeze({
  schema_id: "herma.co_lease_and_ensemble.grid.v6_9",
  lease_intel_schema_version: "herma.priority_work_gateway.lease_intelligence.v1",
  heartbeat_schema_version: "herma.priority_work_gateway.heartbeat.v1",
  max_co_leases_k: 3,
  straggler_hedge_ttl_fraction: 0.5,
  late_finisher_grace_ms: 1800000,
  heartbeat_default_extend_ms: 900000,
  heartbeat_min_extend_ms: 60000,
  heartbeat_max_extend_ms: 3600000,
  ms_per_second: 1000,
  diverse_model_bonus: 8.0,
  straggler_hedge_bonus: 6.0,
  explicit_co_lease_bonus: 4.0,
  fingerprint_hex_chars: 24,
  progress_note_max_len: 400,
  model_hint_max_len: 80,
  ema_old_weight: 3,
  ema_new_weight: 2,
  ema_total_weight: 5,
  milli_scale: 1000,
  default_reliability_milli: 850,
  default_ema_wall_ms: 12000,
  ensemble_list_limit: 25,
  min_dpo_solvers: 2,
  http_ok: 200,
  http_bad_request: 400,
  http_forbidden: 403,
  http_not_found: 404,
  http_method_not_allowed: 405,
  http_conflict: 409,
});

const INITIALIZED_CO_LEASE_DBS = new WeakSet();

export async function ensureCoLeaseAndEnsembleSchema(db) {
  if (!db || typeof db.prepare !== "function") return;
  if (db.__hermaSchemaV69Ready || INITIALIZED_CO_LEASE_DBS.has(db)) return;

  const ddl = [
    `CREATE TABLE IF NOT EXISTS herma_task_co_leases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      worker_uuid TEXT NOT NULL,
      model_hint TEXT NOT NULL DEFAULT '',
      instance_fingerprint TEXT NOT NULL DEFAULT '',
      lease_epoch INTEGER NOT NULL,
      co_lease_slot INTEGER NOT NULL DEFAULT 1,
      co_lease_mode TEXT NOT NULL DEFAULT 'primary_lease',
      progress_note TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'active',
      claimed_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      completed_at TEXT,
      produced_object_keys_json TEXT NOT NULL DEFAULT '[]',
      UNIQUE(task_id, worker_uuid, lease_epoch)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_htcl_task_state ON herma_task_co_leases (task_id, state, expires_at)`,
    `CREATE INDEX IF NOT EXISTS idx_htcl_worker_state ON herma_task_co_leases (worker_uuid, state, expires_at)`,
    `CREATE INDEX IF NOT EXISTS idx_htcl_agent_epoch ON herma_task_co_leases (task_id, agent_id, lease_epoch)`,
    `CREATE TABLE IF NOT EXISTS herma_worker_lease_telemetry (
      worker_uuid TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL DEFAULT '',
      model_hint TEXT NOT NULL DEFAULT '',
      claims_count INTEGER NOT NULL DEFAULT 0,
      completions_count INTEGER NOT NULL DEFAULT 0,
      heartbeats_count INTEGER NOT NULL DEFAULT 0,
      expired_count INTEGER NOT NULL DEFAULT 0,
      ema_wall_ms INTEGER NOT NULL DEFAULT 12000,
      reliability_milli INTEGER NOT NULL DEFAULT 850,
      updated_at TEXT NOT NULL
    )`,
  ];

  for (const stmt of ddl) {
    await db.prepare(stmt).run();
  }
  INITIALIZED_CO_LEASE_DBS.add(db);
}

export async function computeWorkerInstanceFingerprint(
  sha256HexFn,
  { workerUuid = "", workerToken = "", userAgent = "", modelHint = "" } = {}
) {
  const material =
    String(workerUuid || "").trim() ||
    String(workerToken || "").trim() ||
    `${String(userAgent || "").trim()}+${String(modelHint || "").trim().toLowerCase()}`;
  const fullHex = await sha256HexFn(material);
  return String(fullHex || "").slice(0, CO_LEASE_ENSEMBLE_GRID.fingerprint_hex_chars);
}

export async function recordPrimaryLeaseInCoLeaseTable(
  db,
  {
    taskId = "",
    agentId = "",
    workerUuid = "",
    modelHint = "",
    instanceFingerprint = "",
    leaseEpoch = 1,
    claimedAt = new Date().toISOString(),
    expiresAt = "",
  } = {}
) {
  await ensureCoLeaseAndEnsembleSchema(db);
  const cleanModel = String(modelHint || "").trim().slice(0, CO_LEASE_ENSEMBLE_GRID.model_hint_max_len);
  await db
    .prepare(
      `INSERT OR REPLACE INTO herma_task_co_leases
       (task_id, agent_id, worker_uuid, model_hint, instance_fingerprint, lease_epoch,
        co_lease_slot, co_lease_mode, progress_note, state, claimed_at, heartbeat_at, expires_at, completed_at, produced_object_keys_json)
       VALUES (?, ?, ?, ?, ?, ?, 1, 'primary_lease', '', 'active', ?, ?, ?, NULL, '[]')`
    )
    .bind(
      String(taskId),
      String(agentId),
      String(workerUuid),
      cleanModel,
      String(instanceFingerprint || ""),
      Number(leaseEpoch || 1),
      claimedAt,
      claimedAt,
      expiresAt || claimedAt
    )
    .run();

  if (workerUuid) {
    await db
      .prepare(
        `INSERT INTO herma_worker_lease_telemetry
         (worker_uuid, agent_id, model_hint, claims_count, completions_count, heartbeats_count, expired_count, ema_wall_ms, reliability_milli, updated_at)
         VALUES (?, ?, ?, 1, 0, 0, 0, ?, ?, ?)
         ON CONFLICT(worker_uuid) DO UPDATE SET
           agent_id = excluded.agent_id,
           model_hint = CASE WHEN excluded.model_hint != '' THEN excluded.model_hint ELSE herma_worker_lease_telemetry.model_hint END,
           claims_count = herma_worker_lease_telemetry.claims_count + 1,
           updated_at = excluded.updated_at`
      )
      .bind(
        String(workerUuid),
        String(agentId),
        cleanModel,
        CO_LEASE_ENSEMBLE_GRID.default_ema_wall_ms,
        CO_LEASE_ENSEMBLE_GRID.default_reliability_milli,
        claimedAt
      )
      .run();
  }
}

export async function reapExpiredCoLeases(db, nowIso = new Date().toISOString()) {
  await ensureCoLeaseAndEnsembleSchema(db);
  const expRowsRes = await db
    .prepare(
      `SELECT id, worker_uuid FROM herma_task_co_leases
       WHERE state = 'active' AND expires_at < ?
       LIMIT 60`
    )
    .bind(nowIso)
    .all();
  const expRows = expRowsRes?.results || [];
  if (expRows.length === 0) return 0;

  await db
    .prepare(
      `UPDATE herma_task_co_leases
       SET state = 'expired'
       WHERE state = 'active' AND expires_at < ?`
    )
    .bind(nowIso)
    .run();

  for (const r of expRows) {
    if (r.worker_uuid) {
      await db
        .prepare(
          `UPDATE herma_worker_lease_telemetry
           SET expired_count = expired_count + 1,
               reliability_milli = CAST((completions_count * 1000) / MAX(1, claims_count) AS INTEGER),
               updated_at = ?
           WHERE worker_uuid = ?`
        )
        .bind(nowIso, String(r.worker_uuid))
        .run();
    }
  }
  return expRows.length;
}

export async function attemptDistinctWorkerCoLease(
  db,
  {
    cleanAgent = "",
    workerProfile = {},
    modelHint = "",
    instanceFingerprint = "",
    explicitTaskId = "",
    requestedTier = null,
    cleanFamilyFilter = "",
    cleanVerbKindFilter = "",
    cleanStepModeFilter = "",
    visAllowed = "visibility IN ('public_ngo', 'public_commons')",
    prereqReadyClause = "",
    effectiveLeaseTtlMs = CO_LEASE_ENSEMBLE_GRID.heartbeat_default_extend_ms,
    allowCoLeaseExplicit = null,
    scoreCandidateFn = null,
    poolLimit = 20,
  } = {}
) {
  await ensureCoLeaseAndEnsembleSchema(db);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const callerUuid = String(workerProfile.worker_uuid || "").trim();
  const callerModel = String(modelHint || workerProfile.model_hint || "")
    .trim()
    .toLowerCase()
    .slice(0, CO_LEASE_ENSEMBLE_GRID.model_hint_max_len);

  let sql = `SELECT * FROM herma_durable_queue
             WHERE state = 'leased' AND lease_expires_at > ? AND ${visAllowed} ${prereqReadyClause}`;
  const binds = [nowIso];

  if (explicitTaskId) {
    sql += " AND task_id = ?";
    binds.push(explicitTaskId);
  }
  if (requestedTier) {
    sql += " AND tier = ?";
    binds.push(requestedTier);
  }
  if (cleanVerbKindFilter) {
    sql += " AND LOWER(verb_kind) = ?";
    binds.push(cleanVerbKindFilter);
  }
  if (cleanStepModeFilter) {
    sql += " AND step_mode = ?";
    binds.push(cleanStepModeFilter);
  }
  if (cleanFamilyFilter) {
    const likePat = `%${cleanFamilyFilter}%`;
    sql +=
      " AND (LOWER(title) LIKE ? OR LOWER(prompt) LIKE ? OR LOWER(category) LIKE ? OR LOWER(labels_json) LIKE ? OR LOWER(branch_label) LIKE ?)";
    binds.push(likePat, likePat, likePat, likePat, likePat);
  }
  sql += " ORDER BY (CASE WHEN tier = 'ngo_priority' THEN 0 ELSE 1 END) ASC, priority DESC, id ASC LIMIT ?";
  binds.push(poolLimit);

  const candRes = await db.prepare(sql).bind(...binds).all();
  const leasedPool = candRes?.results || [];
  if (leasedPool.length === 0) return null;

  let sameWorkerExisting = null;
  let bestCoLease = null;

  for (const cand of leasedPool) {
    const activeRowsRes = await db
      .prepare(
        `SELECT * FROM herma_task_co_leases
         WHERE task_id = ? AND state = 'active' AND expires_at > ?
         ORDER BY co_lease_slot ASC, id ASC`
      )
      .bind(cand.task_id, nowIso)
      .all();
    const activeCoRows = activeRowsRes?.results || [];

    const primaryMatchesSameWorker =
      (callerUuid && cand.leased_worker_uuid === callerUuid) ||
      (cleanAgent && cand.leased_by === cleanAgent && (!callerUuid || !cand.leased_worker_uuid || cand.leased_worker_uuid === callerUuid));

    const matchingActiveCoRow = activeCoRows.find(
      (r) =>
        (callerUuid && r.worker_uuid === callerUuid) ||
        (cleanAgent &&
          r.agent_id === cleanAgent &&
          instanceFingerprint &&
          r.instance_fingerprint &&
          r.instance_fingerprint === instanceFingerprint) ||
        (cleanAgent && r.agent_id === cleanAgent && (!callerUuid || r.worker_uuid === callerUuid))
    );

    // Exact-Same-Worker Guard: NEVER double-lease the same task to the same worker!
    if (primaryMatchesSameWorker || matchingActiveCoRow) {
      if (!sameWorkerExisting) {
        sameWorkerExisting = {
          row: cand,
          leaseEpoch: matchingActiveCoRow ? Number(matchingActiveCoRow.lease_epoch) : Number(cand.fencing_token || 1),
          expiresAt: matchingActiveCoRow ? matchingActiveCoRow.expires_at : cand.lease_expires_at,
          workerUuid: matchingActiveCoRow
            ? matchingActiveCoRow.worker_uuid
            : cand.leased_worker_uuid || callerUuid,
        };
      }
      continue;
    }

    // Strict drafter != reviewer guard on feedback peer-review verbs (`verb_fbk_review_*`)
    if (
      String(cand.task_id || "").startsWith("verb_fbk_review_") &&
      ((callerUuid && cand.producer_worker_uuid === callerUuid) ||
        (cleanAgent && String(cand.producer_agent || "").toLowerCase() === cleanAgent))
    ) {
      continue;
    }

    // Check active holder count (counting primary lease if it predated co-lease table)
    const distinctActiveUuids = new Set(activeCoRows.map((r) => String(r.worker_uuid || r.agent_id)));
    if (cand.leased_worker_uuid || cand.leased_by) {
      distinctActiveUuids.add(String(cand.leased_worker_uuid || cand.leased_by));
    }
    if (distinctActiveUuids.size >= CO_LEASE_ENSEMBLE_GRID.max_co_leases_k) {
      continue;
    }

    // Determine straggler status (primary lease > 50% elapsed without fresh heartbeat)
    const primaryCoRow = activeCoRows[0] || null;
    const claimedMs = Date.parse(primaryCoRow?.claimed_at || cand.updated_at || nowIso) || nowMs;
    const heartbeatMs = Date.parse(primaryCoRow?.heartbeat_at || cand.updated_at || nowIso) || claimedMs;
    const expiresMs = Date.parse(cand.lease_expires_at || nowIso) || nowMs + effectiveLeaseTtlMs;
    const totalTtlMs = Math.max(1, expiresMs - claimedMs);
    const quietElapsedMs = Math.max(0, nowMs - heartbeatMs);
    const isStraggler =
      heartbeatMs <= claimedMs + 1000 &&
      quietElapsedMs >= CO_LEASE_ENSEMBLE_GRID.straggler_hedge_ttl_fraction * totalTtlMs;

    // If explicit task_id was requested without allow_co_lease, only co-lease when straggler hedging applies!
    if (explicitTaskId && allowCoLeaseExplicit !== true && !isStraggler) {
      continue;
    }
    // If caller explicitly disabled co-leasing (`allow_co_lease: false`), only allow straggler hedging
    if (allowCoLeaseExplicit === false && !isStraggler) {
      continue;
    }

    const holderModels = new Set(
      activeCoRows
        .map((r) => String(r.model_hint || "").trim().toLowerCase())
        .filter(Boolean)
    );
    const isDiverseModel = Boolean(callerModel && (holderModels.size === 0 || !holderModels.has(callerModel)));

    let coLeaseMode = "adaptive_idle_capacity_co_lease";
    let modeBonus = 0;
    if (isStraggler) {
      coLeaseMode = "straggler_hedged";
      modeBonus = CO_LEASE_ENSEMBLE_GRID.straggler_hedge_bonus;
    } else if (isDiverseModel) {
      coLeaseMode = "diverse_model_ensemble";
      modeBonus = CO_LEASE_ENSEMBLE_GRID.diverse_model_bonus;
    } else if (allowCoLeaseExplicit === true) {
      coLeaseMode = "explicit_co_lease";
      modeBonus = CO_LEASE_ENSEMBLE_GRID.explicit_co_lease_bonus;
    }

    const baseScored = scoreCandidateFn
      ? scoreCandidateFn(cand)
      : { totalScore: Number(cand.priority || 60), telemetry: {} };
    const effectiveScore = baseScored.totalScore + modeBonus;

    if (!bestCoLease || effectiveScore > bestCoLease.effectiveScore) {
      bestCoLease = {
        row: cand,
        baseScored,
        effectiveScore,
        coLeaseMode,
        nextSlot: distinctActiveUuids.size + 1,
      };
    }
  }

  // If no distinct-worker co-lease candidate is eligible, return caller's existing same-worker lease if present!
  if (!bestCoLease) {
    if (sameWorkerExisting) {
      return {
        reusedSameWorker: true,
        row: sameWorkerExisting.row,
        leaseEpoch: sameWorkerExisting.leaseEpoch,
        expiresAt: sameWorkerExisting.expiresAt,
        workerUuid: sameWorkerExisting.workerUuid,
      };
    }
    return null;
  }

  // Mint unique co-lease epoch > max(herma_durable_queue.fencing_token, max(herma_task_co_leases.lease_epoch))
  const maxEpochRow = await db
    .prepare("SELECT COALESCE(MAX(lease_epoch), 0) AS max_ep FROM herma_task_co_leases WHERE task_id = ?")
    .bind(bestCoLease.row.task_id)
    .first();
  const mintedEpoch = Math.max(Number(bestCoLease.row.fencing_token || 1), Number(maxEpochRow?.max_ep || 0)) + 1;
  const coExpiresIso = new Date(nowMs + effectiveLeaseTtlMs).toISOString();

  await db
    .prepare(
      `INSERT INTO herma_task_co_leases
       (task_id, agent_id, worker_uuid, model_hint, instance_fingerprint, lease_epoch,
        co_lease_slot, co_lease_mode, progress_note, state, claimed_at, heartbeat_at, expires_at, completed_at, produced_object_keys_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', 'active', ?, ?, ?, NULL, '[]')`
    )
    .bind(
      bestCoLease.row.task_id,
      cleanAgent,
      callerUuid,
      callerModel,
      String(instanceFingerprint || ""),
      mintedEpoch,
      bestCoLease.nextSlot,
      bestCoLease.coLeaseMode,
      nowIso,
      nowIso,
      coExpiresIso
    )
    .run();

  if (callerUuid) {
    await db
      .prepare(
        `INSERT INTO herma_worker_lease_telemetry
         (worker_uuid, agent_id, model_hint, claims_count, completions_count, heartbeats_count, expired_count, ema_wall_ms, reliability_milli, updated_at)
         VALUES (?, ?, ?, 1, 0, 0, 0, ?, ?, ?)
         ON CONFLICT(worker_uuid) DO UPDATE SET
           agent_id = excluded.agent_id,
           model_hint = CASE WHEN excluded.model_hint != '' THEN excluded.model_hint ELSE herma_worker_lease_telemetry.model_hint END,
           claims_count = herma_worker_lease_telemetry.claims_count + 1,
           updated_at = excluded.updated_at`
      )
      .bind(
        callerUuid,
        cleanAgent,
        callerModel,
        CO_LEASE_ENSEMBLE_GRID.default_ema_wall_ms,
        CO_LEASE_ENSEMBLE_GRID.default_reliability_milli,
        nowIso
      )
      .run();
  }

  return {
    reusedSameWorker: false,
    isCoLease: true,
    row: bestCoLease.row,
    leaseEpoch: mintedEpoch,
    coLeaseSlot: bestCoLease.nextSlot,
    coLeaseMode: bestCoLease.coLeaseMode,
    expiresAt: coExpiresIso,
    workerUuid: callerUuid,
    routingTelemetry: {
      ...(bestCoLease.baseScored?.telemetry || {}),
      co_leased_parallel_slot: bestCoLease.nextSlot,
      co_lease_mode: bestCoLease.coLeaseMode,
      max_co_leases_k: CO_LEASE_ENSEMBLE_GRID.max_co_leases_k,
    },
  };
}

export async function verifyLegitimateCoLeaseOrGrace(
  db,
  {
    taskId = "",
    agentId = "",
    workerUuid = "",
    reqToken = 0,
    hasSalvageableWork = false,
    nowIso = new Date().toISOString(),
  } = {}
) {
  await ensureCoLeaseAndEnsembleSchema(db);
  if (!taskId || !agentId || !Number.isInteger(reqToken) || reqToken <= 0) {
    return { matched: false };
  }

  const coRow = await db
    .prepare(
      `SELECT * FROM herma_task_co_leases
       WHERE task_id = ? AND agent_id = ? AND lease_epoch = ?
       ORDER BY id DESC LIMIT 1`
    )
    .bind(String(taskId), String(agentId), reqToken)
    .first();

  if (!coRow) {
    return { matched: false };
  }
  if (workerUuid && coRow.worker_uuid && coRow.worker_uuid !== workerUuid) {
    return { matched: false };
  }
  // Never allow a second non-idempotent overwrite once THIS exact co-lease slot already completed!
  if (coRow.state === "completed") {
    return { matched: false, alreadyCompletedThisSlot: true };
  }

  const nowMs = Date.parse(nowIso) || Date.now();
  const expMs = Date.parse(coRow.expires_at || "") || 0;
  const isExpired = expMs > 0 && expMs <= nowMs;
  if (isExpired) {
    const overdueMs = nowMs - expMs;
    if (!hasSalvageableWork || overdueMs > CO_LEASE_ENSEMBLE_GRID.late_finisher_grace_ms) {
      return { matched: false, graceExceeded: true };
    }
    return {
      matched: true,
      coRow,
      isLateFinisherGrace: true,
      resolutionRole: "late_finisher_salvaged",
    };
  }

  return {
    matched: true,
    coRow,
    isLateFinisherGrace: false,
    resolutionRole: Number(coRow.co_lease_slot || 1) > 1 ? "ensemble_co_solver" : "primary_or_ensemble_solver",
  };
}

export async function finalizeCoLeaseAndBuildEnsembleGroup(
  db,
  {
    taskId = "",
    agentId = "",
    workerUuid = "",
    leaseEpoch = 0,
    storedObjectKeys = [],
    wallMs = 0,
    modelHint = "",
    nowIso = new Date().toISOString(),
  } = {}
) {
  await ensureCoLeaseAndEnsembleSchema(db);
  if (!taskId || taskId === "self_seed") return null;

  if (Number.isInteger(leaseEpoch) && leaseEpoch > 0) {
    await db
      .prepare(
        `UPDATE herma_task_co_leases
         SET state = 'completed',
             completed_at = ?,
             heartbeat_at = ?,
             produced_object_keys_json = ?
         WHERE task_id = ? AND agent_id = ? AND lease_epoch = ?`
      )
      .bind(
        nowIso,
        nowIso,
        JSON.stringify(storedObjectKeys || []),
        String(taskId),
        String(agentId),
        leaseEpoch
      )
      .run();
  }

  if (workerUuid) {
    const measuredWall =
      Number.isFinite(Number(wallMs)) && Number(wallMs) > 0
        ? Math.round(Number(wallMs))
        : CO_LEASE_ENSEMBLE_GRID.default_ema_wall_ms;
    const cleanModel = String(modelHint || "").trim().slice(0, CO_LEASE_ENSEMBLE_GRID.model_hint_max_len);
    await db
      .prepare(
        `INSERT INTO herma_worker_lease_telemetry
         (worker_uuid, agent_id, model_hint, claims_count, completions_count, heartbeats_count, expired_count, ema_wall_ms, reliability_milli, updated_at)
         VALUES (?, ?, ?, 1, 1, 0, 0, ?, 1000, ?)
         ON CONFLICT(worker_uuid) DO UPDATE SET
           agent_id = excluded.agent_id,
           model_hint = CASE WHEN excluded.model_hint != '' THEN excluded.model_hint ELSE herma_worker_lease_telemetry.model_hint END,
           completions_count = herma_worker_lease_telemetry.completions_count + 1,
           ema_wall_ms = CAST((herma_worker_lease_telemetry.ema_wall_ms * ? + ? * ?) / ? AS INTEGER),
           reliability_milli = MIN(1000, CAST(((herma_worker_lease_telemetry.completions_count + 1) * 1000) / MAX(1, herma_worker_lease_telemetry.claims_count) AS INTEGER)),
           updated_at = excluded.updated_at`
      )
      .bind(
        String(workerUuid),
        String(agentId),
        cleanModel,
        measuredWall,
        nowIso,
        CO_LEASE_ENSEMBLE_GRID.ema_old_weight,
        measuredWall,
        CO_LEASE_ENSEMBLE_GRID.ema_new_weight,
        CO_LEASE_ENSEMBLE_GRID.ema_total_weight
      )
      .run();
  }

  const [completedSlotsRes, taskObjectsRes] = await Promise.all([
    db
      .prepare(
        `SELECT agent_id, worker_uuid, model_hint, lease_epoch, co_lease_slot, co_lease_mode, produced_object_keys_json, completed_at
         FROM herma_task_co_leases
         WHERE task_id = ? AND state = 'completed'
         ORDER BY completed_at ASC, id ASC`
      )
      .bind(String(taskId))
      .all(),
    db
      .prepare(
        `SELECT object_key, producer_agent, worker_uuid, version_num, quality_milli
         FROM herma_task_objects
         WHERE source_task_id = ?
         ORDER BY id ASC`
      )
      .bind(String(taskId))
      .all(),
  ]);

  const completedSlots = completedSlotsRes?.results || [];
  const taskObjs = taskObjectsRes?.results || [];
  const distinctSolvers = new Set([
    ...completedSlots.map((s) => String(s.worker_uuid || s.agent_id)),
    ...taskObjs.map((o) => String(o.worker_uuid || o.producer_agent)),
  ]);
  const solverCount = Math.max(1, distinctSolvers.size);
  const siblingObjectKeys = Array.from(new Set(taskObjs.map((o) => String(o.object_key))));

  return {
    task_id: String(taskId),
    solver_count: solverCount,
    sibling_object_keys: siblingObjectKeys,
    dpo_pair_ready: solverCount >= CO_LEASE_ENSEMBLE_GRID.min_dpo_solvers && siblingObjectKeys.length >= CO_LEASE_ENSEMBLE_GRID.min_dpo_solvers,
    solvers: completedSlots.map((s) => ({
      agent_id: s.agent_id,
      worker_uuid: s.worker_uuid,
      model_hint: s.model_hint || null,
      lease_epoch: Number(s.lease_epoch),
      co_lease_slot: Number(s.co_lease_slot || 1),
      co_lease_mode: s.co_lease_mode,
      completed_at: s.completed_at,
    })),
  };
}

export async function handleLeaseHeartbeatRequest(
  request,
  url,
  db,
  { infraAllowed = false, gatewayOps = null } = {}
) {
  await ensureCoLeaseAndEnsembleSchema(db);
  const method = request.method.toUpperCase();
  if (method !== "POST" && method !== "GET") {
    return {
      status: CO_LEASE_ENSEMBLE_GRID.http_method_not_allowed,
      body: { ok: false, error: "method_not_allowed" },
    };
  }

  let params = Object.fromEntries(url.searchParams.entries());
  if (method === "POST") {
    try {
      const body = await request.json();
      params = { ...params, ...(body || {}) };
    } catch {
      return {
        status: CO_LEASE_ENSEMBLE_GRID.http_bad_request,
        body: { ok: false, code: "invalid_json" },
      };
    }
  }

  const taskId = String(params.task_id || params.id || "").trim();
  const cleanAgent = gatewayOps?.cleanAgentId
    ? gatewayOps.cleanAgentId(params.agent_id || params.agent || "")
    : String(params.agent_id || params.agent || "").trim();
  const workerUuid = String(params.worker_uuid || params.uuid || "").trim();
  const leaseEpoch = Number(params.lease_epoch ?? params.fencing_token ?? 0);
  const progressNote = String(params.progress_note || params.note || "")
    .trim()
    .slice(0, CO_LEASE_ENSEMBLE_GRID.progress_note_max_len);

  if (!taskId || !cleanAgent || !Number.isInteger(leaseEpoch) || leaseEpoch <= 0) {
    return {
      status: CO_LEASE_ENSEMBLE_GRID.http_bad_request,
      body: {
        ok: false,
        code: "missing_heartbeat_fields",
        detail: "Provide task_id, agent_id, and lease_epoch (or fencing_token).",
      },
    };
  }

  const presentedToken = String(
    params.worker_token || request.headers.get("x-herma-worker-token") || url.searchParams.get("worker_token") || ""
  ).trim();
  if (workerUuid && gatewayOps?.verifyWorkerUuidAccess) {
    const authRes = await gatewayOps.verifyWorkerUuidAccess({
      agentId: cleanAgent,
      workerUuid,
      workerToken: presentedToken,
      infraAllowed,
    });
    if (!authRes.ok) {
      return {
        status: CO_LEASE_ENSEMBLE_GRID.http_forbidden,
        body: { ok: false, code: authRes.code, detail: authRes.detail },
      };
    }
  }

  const extendSec = Number(params.extend_seconds || 0);
  const extendMs =
    Number.isFinite(extendSec) && extendSec > 0
      ? Math.max(
          CO_LEASE_ENSEMBLE_GRID.heartbeat_min_extend_ms,
          Math.min(
            CO_LEASE_ENSEMBLE_GRID.heartbeat_max_extend_ms,
            Math.round(extendSec * CO_LEASE_ENSEMBLE_GRID.ms_per_second)
          )
        )
      : CO_LEASE_ENSEMBLE_GRID.heartbeat_default_extend_ms;

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const newExpiresIso = new Date(nowMs + extendMs).toISOString();

  const coRow = await db
    .prepare(
      `SELECT * FROM herma_task_co_leases
       WHERE task_id = ? AND agent_id = ? AND lease_epoch = ? AND state = 'active'
       LIMIT 1`
    )
    .bind(taskId, cleanAgent, leaseEpoch)
    .first();

  const qRow = await db
    .prepare("SELECT * FROM herma_durable_queue WHERE task_id = ? LIMIT 1")
    .bind(taskId)
    .first();

  if (!coRow && (!qRow || qRow.state !== "leased" || qRow.leased_by !== cleanAgent || Number(qRow.fencing_token) !== leaseEpoch)) {
    return {
      status: CO_LEASE_ENSEMBLE_GRID.http_conflict,
      body: {
        ok: false,
        code: "active_lease_not_found",
        detail: `No active lease or co-lease found for task_id=${taskId}, agent_id=${cleanAgent}, lease_epoch=${leaseEpoch}.`,
      },
    };
  }

  if (coRow) {
    await db
      .prepare(
        `UPDATE herma_task_co_leases
         SET heartbeat_at = ?, expires_at = ?, progress_note = CASE WHEN ? != '' THEN ? ELSE progress_note END
         WHERE id = ?`
      )
      .bind(nowIso, newExpiresIso, progressNote, progressNote, coRow.id)
      .run();
  }

  if (qRow && qRow.state === "leased" && qRow.leased_by === cleanAgent && Number(qRow.fencing_token) === leaseEpoch) {
    await db
      .prepare(
        `UPDATE herma_durable_queue
         SET lease_expires_at = ?, updated_at = ?
         WHERE task_id = ? AND state = 'leased' AND fencing_token = ?`
      )
      .bind(newExpiresIso, nowIso, taskId, leaseEpoch)
      .run();
  }

  const effUuid = workerUuid || coRow?.worker_uuid || qRow?.leased_worker_uuid || "";
  if (effUuid) {
    await db
      .prepare(
        `UPDATE herma_worker_lease_telemetry
         SET heartbeats_count = heartbeats_count + 1, updated_at = ?
         WHERE worker_uuid = ?`
      )
      .bind(nowIso, effUuid)
      .run();
  }

  return {
    status: CO_LEASE_ENSEMBLE_GRID.http_ok,
    body: {
      ok: true,
      schema: CO_LEASE_ENSEMBLE_GRID.heartbeat_schema_version,
      task_id: taskId,
      agent_id: cleanAgent,
      worker_uuid: effUuid || null,
      lease_epoch: leaseEpoch,
      heartbeat_at: nowIso,
      expires_at: newExpiresIso,
      progress_note: progressNote || null,
    },
  };
}

export async function buildLeaseIntelligenceSnapshot(db, publicUrl = "https://herma.ta-amps.workers.dev") {
  await ensureCoLeaseAndEnsembleSchema(db);
  const nowIso = new Date().toISOString();
  const base = String(publicUrl || "https://herma.ta-amps.workers.dev").replace(/\/+$/, "");

  const [activeRes, completedTasksRes, workerTelRes] = await Promise.all([
    db
      .prepare(
        `SELECT task_id, agent_id, worker_uuid, model_hint, lease_epoch, co_lease_slot, co_lease_mode,
                progress_note, claimed_at, heartbeat_at, expires_at
         FROM herma_task_co_leases
         WHERE state = 'active' AND expires_at > ?
         ORDER BY task_id ASC, co_lease_slot ASC
         LIMIT ?`
      )
      .bind(nowIso, CO_LEASE_ENSEMBLE_GRID.ensemble_list_limit * 2)
      .all(),
    db
      .prepare(
        `SELECT task_id, COUNT(DISTINCT worker_uuid) AS solver_count,
                GROUP_CONCAT(produced_object_keys_json, '|') AS all_keys_concat
         FROM herma_task_co_leases
         WHERE state = 'completed'
         GROUP BY task_id
         HAVING COUNT(DISTINCT worker_uuid) >= 1
         ORDER BY solver_count DESC, MAX(id) DESC
         LIMIT ?`
      )
      .bind(CO_LEASE_ENSEMBLE_GRID.ensemble_list_limit)
      .all(),
    db
      .prepare(
        `SELECT worker_uuid, agent_id, model_hint, claims_count, completions_count,
                heartbeats_count, expired_count, ema_wall_ms, reliability_milli, updated_at
         FROM herma_worker_lease_telemetry
         ORDER BY completions_count DESC, reliability_milli DESC
         LIMIT ?`
      )
      .bind(CO_LEASE_ENSEMBLE_GRID.ensemble_list_limit)
      .all(),
  ]);

  const ensembleGroups = [];
  for (const row of completedTasksRes?.results || []) {
    const siblingKeys = new Set();
    for (const part of String(row.all_keys_concat || "").split("|")) {
      if (!part) continue;
      try {
        const arr = JSON.parse(part);
        if (Array.isArray(arr)) {
          for (const k of arr) if (k) siblingKeys.add(String(k));
        }
      } catch {
        // ignore malformed json fragment
      }
    }
    const solverCount = Number(row.solver_count || 1);
    const keysArr = Array.from(siblingKeys);
    ensembleGroups.push({
      task_id: row.task_id,
      solver_count: solverCount,
      sibling_object_keys: keysArr,
      dpo_pair_ready:
        solverCount >= CO_LEASE_ENSEMBLE_GRID.min_dpo_solvers &&
        keysArr.length >= CO_LEASE_ENSEMBLE_GRID.min_dpo_solvers,
      task_url: `${base}/q/task/${encodeURIComponent(row.task_id)}`,
    });
  }

  return {
    ok: true,
    schema: CO_LEASE_ENSEMBLE_GRID.lease_intel_schema_version,
    policy_grid: {
      max_co_leases_k: CO_LEASE_ENSEMBLE_GRID.max_co_leases_k,
      spread_first_priority: true,
      exact_same_worker_double_lease_blocked: true,
      straggler_hedge_ttl_fraction: CO_LEASE_ENSEMBLE_GRID.straggler_hedge_ttl_fraction,
      late_finisher_grace_ms: CO_LEASE_ENSEMBLE_GRID.late_finisher_grace_ms,
      zero_loss_ensemble_merge: true,
    },
    endpoints: {
      heartbeat_url: `${base}/q/heartbeat`,
      lease_intelligence_url: `${base}/q/lease-intelligence`,
      claim_url: `${base}/q/claim`,
      submit_url: `${base}/q/submit`,
    },
    active_co_leases: activeRes?.results || [],
    ensemble_task_groups: ensembleGroups,
    dpo_ready_group_count: ensembleGroups.filter((g) => g.dpo_pair_ready).length,
    worker_reliability_ewma: workerTelRes?.results || [],
  };
}
