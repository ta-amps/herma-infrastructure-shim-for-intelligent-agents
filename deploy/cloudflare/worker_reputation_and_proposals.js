// worker_reputation_and_proposals.js
// Universal Evidence-Backed Worker Reputation ("Cred" & 9 Auto-Badges), Cooperative Never-Stay-Blocked
// Relay Ledger, Suffix-Safe Object Key Sanitizer, Multimodal/Tiered Asset Metadata, and Peer-Evaluated
// `infra_proposal` / `retraining_request` Governance View for Herma v6.7.
//
// Zero custom primitives: everything operates strictly on universal `Tasks` (`verbs`) and `Task Objects` (`nouns`)
// governed by `REPUTATION_AND_PROPOSAL_GRID` (Rule 01 & Rule 02 compliant).

export const REPUTATION_AND_PROPOSAL_GRID = Object.freeze({
  schema_id: "herma.reputation_relay_proposals.grid.v1",
  object_key_max_len: 128,
  object_key_tail_preserve_len: 48,
  salted_ip_hash_chars: 16,
  max_prior_attempts_returned: 12,
  max_capabilities_per_task: 12,
  max_routes_per_task: 12,
  max_leaderboard_rows: 100,
  max_proposals_rows: 100,
  summary_clip_chars: 500,

  // Evidence-backed scoring parameters (never self-claimed; 0 without verified receipt/object/task link)
  solve_points: 10,
  ngo_bonus_points: 5,
  verify_points: 4,
  eagle_eye_defect_catch_points: 10,
  publish_relay_subproblem_points: 2,
  unblock_bonus_per_prior_worker: 8,
  unblock_bonus_cap: 24,
  milli_scale: 1000,
  gpu_multiplier_milli: 1500,
  high_bandwidth_multiplier_milli: 1250,

  // Auto-badge thresholds
  ngo_champion_min_solves: 3,
  marathoner_min_cycles: 5,
  heavy_lifter_min_bytes: 65536,
  eagle_eye_min_eval_delta_milli: 750,

  // Proposal governance thresholds (proposed -> worker_evaluated -> admin_review_ready)
  proposal_admin_ready_min_evals: 2,
  proposal_admin_ready_min_quality_milli: 750,
  inline_tier_max_bytes: 65536,
  chunked_tier_max_bytes: 2097152,
});

export const PROPOSAL_KINDS = Object.freeze([
  "infra_proposal",
  "retraining_request",
  "pipeline_step_proposal",
  "storage_evolution_proposal",
  "seed_pack_candidate",
]);

export const ASSET_MODALITIES = Object.freeze([
  "code_or_spec",
  "mesh_3d_stl",
  "engine_scene_kit",
  "sprite_sheet",
  "audio_music_stem",
  "video_render",
  "pipeline_registry",
  "infra_proposal",
  "retraining_request",
]);

export const BADGE_CATALOG = Object.freeze({
  first_responder: {
    id: "first_responder",
    label: "First Responder",
    rule: "Completed at least 1 public-good NGO priority task or urgent relay handoff with a verified receipt.",
  },
  bridge_builder: {
    id: "bridge_builder",
    label: "Bridge Builder",
    rule: "Solved a task via a documented alternative discovery/API route after an upstream rate-limit or endpoint block.",
  },
  unblocker: {
    id: "unblocker",
    label: "Unblocker",
    rule: "Cracked and verified a task that previously defeated or blocked at least 1 distinct worker.",
  },
  verifier: {
    id: "verifier",
    label: "Verifier",
    rule: "Submitted at least 1 independent cross-worker evaluation (evaluator != producer).",
  },
  eagle_eye: {
    id: "eagle_eye",
    label: "Eagle Eye",
    rule: "Caught a real formula, schema, or spec defect via a verified erratum, supersedes upgrade, or critical review.",
  },
  publisher: {
    id: "publisher",
    label: "Publisher",
    rule: "Published structured cooperative relay tasks with suggested_capabilities or alternative_routes for other workers.",
  },
  ngo_champion: {
    id: "ngo_champion",
    label: "NGO Champion",
    rule: "Completed 3 or more verified NGO priority tasks.",
  },
  heavy_lifter: {
    id: "heavy_lifter",
    label: "Heavy Lifter",
    rule: "Completed GPU-accelerated, high-bandwidth, or lossless multi-chunk/multimodal (>64 KiB) verified artifacts.",
  },
  marathoner: {
    id: "marathoner",
    label: "Marathoner",
    rule: "Sustained 5 or more verified autonomous contribution cycles under a stable worker identity.",
  },
});

async function sha256HexLocal(input) {
  const bytes = new TextEncoder().encode(String(input || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Preserves version (`_v1`, `_v2`), date (`_20261101`), and `agent_id` tail segments
 * instead of blindly slicing `.slice(0, 64)` and chopping off `_v1`!
 */
export function sanitizeObjectKeyPreservingSuffix(
  rawCandidate,
  maxLen = REPUTATION_AND_PROPOSAL_GRID.object_key_max_len
) {
  const cleaned = String(rawCandidate || "")
    .trim()
    .replace(/[^A-Za-z0-9_.:-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!cleaned) return "task_object_v1";
  if (cleaned.length <= maxLen) return cleaned;

  const tailKeep = Math.min(
    REPUTATION_AND_PROPOSAL_GRID.object_key_tail_preserve_len,
    Math.floor(maxLen / 2)
  );
  const sep = "__";
  const headKeep = Math.max(1, maxLen - tailKeep - sep.length);
  return `${cleaned.slice(0, headKeep)}${sep}${cleaned.slice(cleaned.length - tailKeep)}`;
}

/**
 * Computes a privacy-preserving one-way salted fingerprint of an IP address.
 * Raw IP addresses are NEVER stored in D1 or returned in responses.
 */
export async function computeSaltedIpFingerprint(clientIp, envSalt = "herma-cred-v1") {
  const raw = String(clientIp || "").trim();
  if (!raw || raw === "0.0.0.0" || raw === "127.0.0.1" || raw === "::1") return "";
  const full = await sha256HexLocal(`${envSalt}::ip_cred_signal::${raw}`);
  return `iph_${full.slice(0, REPUTATION_AND_PROPOSAL_GRID.salted_ip_hash_chars)}`;
}

export function classifyStorageTier(payloadBytes, explicitBlobUri = "") {
  if (explicitBlobUri) return "bucket_cas";
  const n = Number(payloadBytes || 0);
  if (n > REPUTATION_AND_PROPOSAL_GRID.chunked_tier_max_bytes) return "bucket_cas";
  if (n > REPUTATION_AND_PROPOSAL_GRID.inline_tier_max_bytes) return "chunked_d1";
  return "inline_d1";
}

export function normalizeAssetModality(item = {}, payloadObj = null) {
  const raw = String(
    item.asset_modality ||
      payloadObj?.asset_modality ||
      item.proposal_metadata?.proposal_kind ||
      payloadObj?.proposal_metadata?.proposal_kind ||
      item.category ||
      ""
  )
    .trim()
    .toLowerCase();
  if (ASSET_MODALITIES.includes(raw)) return raw;
  if (raw.includes("stl") || raw.includes("mesh") || raw.includes("3d")) return "mesh_3d_stl";
  if (raw.includes("godot") || raw.includes("tscn") || raw.includes("scene")) return "engine_scene_kit";
  if (raw.includes("sprite") || raw.includes("svg_atlas")) return "sprite_sheet";
  if (raw.includes("audio") || raw.includes("music") || raw.includes("wav")) return "audio_music_stem";
  if (raw.includes("video") || raw.includes("mp4")) return "video_render";
  if (raw.includes("registry")) return "pipeline_registry";
  if (raw.includes("retrain")) return "retraining_request";
  if (raw.includes("proposal")) return "infra_proposal";
  return "code_or_spec";
}

export function extractProposalMetadata(item = {}, payloadObj = null) {
  const pm =
    (item.proposal_metadata && typeof item.proposal_metadata === "object" ? item.proposal_metadata : null) ||
    (payloadObj?.proposal_metadata && typeof payloadObj.proposal_metadata === "object"
      ? payloadObj.proposal_metadata
      : null);
  const rawKind = String(
    pm?.proposal_kind || item.proposal_kind || payloadObj?.proposal_kind || item.category || ""
  )
    .trim()
    .toLowerCase();
  if (!PROPOSAL_KINDS.includes(rawKind) && !pm) return null;
  const kind = PROPOSAL_KINDS.includes(rawKind) ? rawKind : "infra_proposal";
  return {
    proposal_kind: kind,
    target_subsystem: String(pm?.target_subsystem || payloadObj?.target_subsystem || "herma_gateway").slice(0, 80),
    problem_evidence: String(pm?.problem_evidence || payloadObj?.problem_evidence || item.summary || "").slice(
      0,
      REPUTATION_AND_PROPOSAL_GRID.summary_clip_chars
    ),
    proposed_change: String(pm?.proposed_change || payloadObj?.proposed_change || "").slice(
      0,
      REPUTATION_AND_PROPOSAL_GRID.summary_clip_chars
    ),
    risk_and_rollback: String(pm?.risk_and_rollback || payloadObj?.risk_and_rollback || "").slice(
      0,
      REPUTATION_AND_PROPOSAL_GRID.summary_clip_chars
    ),
    success_metrics: String(pm?.success_metrics || payloadObj?.success_metrics || "").slice(
      0,
      REPUTATION_AND_PROPOSAL_GRID.summary_clip_chars
    ),
    admitted_by_admin: false,
  };
}

let _schemaReady = new WeakSet();

export async function ensureReputationAndProposalsSchema(db) {
  if (!db || _schemaReady.has(db)) return;
  const ddl = [
    `CREATE TABLE IF NOT EXISTS herma_task_attempt_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      worker_uuid TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      outcome TEXT NOT NULL,
      blocker_code TEXT NOT NULL DEFAULT '',
      error_summary TEXT NOT NULL DEFAULT '',
      alternative_route_used TEXT NOT NULL DEFAULT '',
      suggested_capabilities_json TEXT NOT NULL DEFAULT '[]',
      alternative_routes_json TEXT NOT NULL DEFAULT '[]',
      log_object_key TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_herma_attempt_task ON herma_task_attempt_ledger(task_id, outcome)`,
    `CREATE TABLE IF NOT EXISTS herma_worker_cred_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_key TEXT NOT NULL UNIQUE,
      worker_uuid TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      ip_fingerprint TEXT NOT NULL DEFAULT '',
      event_kind TEXT NOT NULL,
      points_awarded INTEGER NOT NULL DEFAULT 0,
      unblock_bonus INTEGER NOT NULL DEFAULT 0,
      prior_failed_workers INTEGER NOT NULL DEFAULT 0,
      multiplier_milli INTEGER NOT NULL DEFAULT 1000,
      evidence_ref TEXT NOT NULL,
      task_id TEXT NOT NULL DEFAULT '',
      object_key TEXT NOT NULL DEFAULT '',
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_herma_cred_worker ON herma_worker_cred_events(worker_uuid, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS herma_task_relay_meta (
      task_id TEXT PRIMARY KEY,
      suggested_capabilities_json TEXT NOT NULL DEFAULT '[]',
      alternative_routes_json TEXT NOT NULL DEFAULT '[]',
      parent_blocker_summary TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS herma_proposals_registry (
      object_key TEXT PRIMARY KEY,
      proposal_kind TEXT NOT NULL,
      target_subsystem TEXT NOT NULL,
      proposer_agent TEXT NOT NULL,
      proposer_worker_uuid TEXT NOT NULL,
      source_task_id TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL,
      proposal_meta_json TEXT NOT NULL DEFAULT '{}',
      independent_eval_count INTEGER NOT NULL DEFAULT 0,
      mean_eval_quality_milli INTEGER NOT NULL DEFAULT 0,
      governance_status TEXT NOT NULL DEFAULT 'proposed',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  ];
  for (const sql of ddl) {
    await db.prepare(sql).run();
  }
  _schemaReady.add(db);
}

function sanitizeStringList(rawList, maxItems) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  for (const item of rawList) {
    const s = String(item || "").trim().slice(0, 96);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

export async function recordTaskRelayMetadata(db, taskId, meta = {}, nowIso = new Date().toISOString()) {
  if (!db || !taskId) return;
  await ensureReputationAndProposalsSchema(db);
  const caps = sanitizeStringList(
    meta.suggested_capabilities || meta.capabilities_needed,
    REPUTATION_AND_PROPOSAL_GRID.max_capabilities_per_task
  );
  const routes = sanitizeStringList(
    meta.alternative_routes || meta.fallback_routes,
    REPUTATION_AND_PROPOSAL_GRID.max_routes_per_task
  );
  const blocker = String(meta.parent_blocker_summary || meta.blocker_summary || "").slice(
    0,
    REPUTATION_AND_PROPOSAL_GRID.summary_clip_chars
  );
  if (!caps.length && !routes.length && !blocker) return;
  await db
    .prepare(
      `INSERT INTO herma_task_relay_meta
       (task_id, suggested_capabilities_json, alternative_routes_json, parent_blocker_summary, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(task_id) DO UPDATE SET
         suggested_capabilities_json = CASE WHEN excluded.suggested_capabilities_json != '[]' THEN excluded.suggested_capabilities_json ELSE herma_task_relay_meta.suggested_capabilities_json END,
         alternative_routes_json = CASE WHEN excluded.alternative_routes_json != '[]' THEN excluded.alternative_routes_json ELSE herma_task_relay_meta.alternative_routes_json END,
         parent_blocker_summary = CASE WHEN excluded.parent_blocker_summary != '' THEN excluded.parent_blocker_summary ELSE herma_task_relay_meta.parent_blocker_summary END,
         updated_at = excluded.updated_at`
    )
    .bind(String(taskId), JSON.stringify(caps), JSON.stringify(routes), blocker, nowIso)
    .run();
}

export async function recordTaskAttemptEvent(db, entry = {}, nowIso = new Date().toISOString()) {
  if (!db || !entry.taskId || !entry.workerUuid) return;
  await ensureReputationAndProposalsSchema(db);
  const caps = sanitizeStringList(
    entry.suggestedCapabilities,
    REPUTATION_AND_PROPOSAL_GRID.max_capabilities_per_task
  );
  const routes = sanitizeStringList(
    entry.alternativeRoutes,
    REPUTATION_AND_PROPOSAL_GRID.max_routes_per_task
  );
  await db
    .prepare(
      `INSERT INTO herma_task_attempt_ledger
       (task_id, worker_uuid, agent_id, outcome, blocker_code, error_summary, alternative_route_used,
        suggested_capabilities_json, alternative_routes_json, log_object_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      String(entry.taskId),
      String(entry.workerUuid),
      String(entry.agentId || "worker"),
      String(entry.outcome || "released_blocked"),
      String(entry.blockerCode || "").slice(0, 64),
      String(entry.errorSummary || "").slice(0, REPUTATION_AND_PROPOSAL_GRID.summary_clip_chars),
      String(entry.alternativeRouteUsed || "").slice(0, 96),
      JSON.stringify(caps),
      JSON.stringify(routes),
      String(entry.logObjectKey || "").slice(0, REPUTATION_AND_PROPOSAL_GRID.object_key_max_len),
      nowIso
    )
    .run();

  if (caps.length || routes.length || entry.errorSummary) {
    await recordTaskRelayMetadata(
      db,
      entry.taskId,
      {
        suggested_capabilities: caps,
        alternative_routes: routes,
        parent_blocker_summary: entry.errorSummary || "",
      },
      nowIso
    );
  }
}

export async function fetchTaskRelayAndFailureContext(db, taskId) {
  if (!db || !taskId) {
    return {
      prior_failed_workers: 0,
      unblock_bounty_points: 0,
      suggested_capabilities: [],
      alternative_routes: [],
      parent_blocker_summary: "",
      prior_attempt_logs: [],
    };
  }
  await ensureReputationAndProposalsSchema(db);
  const metaRow = await db
    .prepare("SELECT * FROM herma_task_relay_meta WHERE task_id = ?")
    .bind(String(taskId))
    .first();
  const attemptsRes = await db
    .prepare(
      `SELECT worker_uuid, agent_id, outcome, blocker_code, error_summary, alternative_route_used,
              suggested_capabilities_json, alternative_routes_json, log_object_key, created_at
       FROM herma_task_attempt_ledger
       WHERE task_id = ?
       ORDER BY id DESC
       LIMIT ?`
    )
    .bind(String(taskId), REPUTATION_AND_PROPOSAL_GRID.max_prior_attempts_returned)
    .all();
  const attempts = attemptsRes?.results || [];
  const failedWorkerSet = new Set();
  for (const a of attempts) {
    if (a.outcome === "released_blocked" || a.outcome === "failed" || a.outcome === "expired") {
      failedWorkerSet.add(a.worker_uuid);
    }
  }
  const priorFailedCount = failedWorkerSet.size;
  const unblockBounty = Math.min(
    REPUTATION_AND_PROPOSAL_GRID.unblock_bonus_cap,
    priorFailedCount * REPUTATION_AND_PROPOSAL_GRID.unblock_bonus_per_prior_worker
  );

  let caps = [];
  let routes = [];
  try {
    caps = JSON.parse(metaRow?.suggested_capabilities_json || "[]");
  } catch {
    caps = [];
  }
  try {
    routes = JSON.parse(metaRow?.alternative_routes_json || "[]");
  } catch {
    routes = [];
  }

  return {
    prior_failed_workers: priorFailedCount,
    unblock_bounty_points: unblockBounty,
    suggested_capabilities: Array.isArray(caps) ? caps : [],
    alternative_routes: Array.isArray(routes) ? routes : [],
    parent_blocker_summary: metaRow?.parent_blocker_summary || "",
    prior_attempt_logs: attempts.map((a) => ({
      worker_uuid: a.worker_uuid,
      agent_id: a.agent_id,
      outcome: a.outcome,
      blocker_code: a.blocker_code,
      error_summary: a.error_summary,
      alternative_route_used: a.alternative_route_used,
      log_object_key: a.log_object_key,
      attempted_at: a.created_at,
    })),
  };
}

/**
 * Computes and records evidence-backed Worker Cred events on a verified submission,
 * plus registers/updates any `infra_proposal` or `retraining_request` Task Objects!
 */
export async function recordVerifiedSubmissionCredAndProposals(db, ctx = {}) {
  if (!db) return { points_earned_this_submit: 0, events: [], proposals_registered: [] };
  await ensureReputationAndProposalsSchema(db);

  const {
    workerUuid = "",
    agentId = "",
    clientIp = "",
    envSalt = "herma-cred-v1",
    taskId = "",
    existingTask = null,
    receiptHash = "",
    storedObjects = [],
    rawObjects = [],
    appliedEvaluations = [],
    enqueuedVerbs = [],
    rawVerbs = [],
    payload = {},
    salvagedConcurrentTwinAttempt = false,
    nowIso = new Date().toISOString(),
  } = ctx;

  // Rule: zero points without a cryptographic evidence link!
  if (!receiptHash || !workerUuid) {
    return { points_earned_this_submit: 0, events: [], proposals_registered: [] };
  }

  const ipFingerprint = await computeSaltedIpFingerprint(clientIp, envSalt);
  const eventsRecorded = [];
  let totalEarned = 0;

  // Resource multipliers (derived from verified artifact/telemetry attributes, bounded by grid)
  const totalBytes = storedObjects.reduce((s, o) => s + Number(o.total_payload_bytes || 0), 0);
  const usedGpu = Boolean(
    payload.execution_telemetry?.gpu_used ||
      existingTask?.category?.includes("gpu") ||
      existingTask?.category?.includes("qlora")
  );
  const usedHighBw = Boolean(
    totalBytes >= REPUTATION_AND_PROPOSAL_GRID.heavy_lifter_min_bytes ||
      payload.execution_telemetry?.high_bandwidth
  );
  let multiplierMilli = REPUTATION_AND_PROPOSAL_GRID.milli_scale;
  if (usedGpu) {
    multiplierMilli = REPUTATION_AND_PROPOSAL_GRID.gpu_multiplier_milli;
  } else if (usedHighBw) {
    multiplierMilli = REPUTATION_AND_PROPOSAL_GRID.high_bandwidth_multiplier_milli;
  }

  const insertCredEvent = async (evKey, kind, basePts, unblockPts, priorFailed, evRef, objKey, detail) => {
    if (!evRef) return 0;
    const scaled = Math.round(((basePts + unblockPts) * multiplierMilli) / REPUTATION_AND_PROPOSAL_GRID.milli_scale);
    if (scaled <= 0) return 0;
    const res = await db
      .prepare(
        `INSERT OR IGNORE INTO herma_worker_cred_events
         (event_key, worker_uuid, agent_id, ip_fingerprint, event_kind, points_awarded, unblock_bonus,
          prior_failed_workers, multiplier_milli, evidence_ref, task_id, object_key, detail_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        evKey,
        workerUuid,
        agentId,
        ipFingerprint,
        kind,
        scaled,
        unblockPts,
        priorFailed,
        multiplierMilli,
        evRef,
        String(taskId || ""),
        String(objKey || ""),
        JSON.stringify(detail || {}),
        nowIso
      )
      .run();
    if ((res?.meta?.changes ?? 1) > 0) {
      eventsRecorded.push({
        event_kind: kind,
        points_awarded: scaled,
        unblock_bonus: unblockPts,
        prior_failed_workers: priorFailed,
        evidence_ref: evRef,
      });
      totalEarned += scaled;
      return scaled;
    }
    return 0;
  };

  // 1. Task Solve + NGO Bonus + Decentralized Unblock Bonus (+8 per distinct prior failed worker, cap +24)
  if (existingTask && !salvagedConcurrentTwinAttempt) {
    const failedRows = await db
      .prepare(
        `SELECT DISTINCT worker_uuid
         FROM herma_task_attempt_ledger
         WHERE task_id = ?
           AND worker_uuid != ?
           AND outcome IN ('released_blocked', 'failed', 'expired')`
      )
      .bind(String(taskId), String(workerUuid))
      .all();
    const priorFailed = (failedRows?.results || []).length;
    const unblockBonus = Math.min(
      REPUTATION_AND_PROPOSAL_GRID.unblock_bonus_cap,
      priorFailed * REPUTATION_AND_PROPOSAL_GRID.unblock_bonus_per_prior_worker
    );
    const isNgo = existingTask.tier === "ngo_priority";
    const baseSolve =
      REPUTATION_AND_PROPOSAL_GRID.solve_points +
      (isNgo ? REPUTATION_AND_PROPOSAL_GRID.ngo_bonus_points : 0);
    const altRouteUsed = String(
      payload.alternative_route_used || payload.execution_telemetry?.alternative_route_used || ""
    ).slice(0, 96);

    await recordTaskAttemptEvent(
      db,
      {
        taskId,
        workerUuid,
        agentId,
        outcome: "solved",
        alternativeRouteUsed: altRouteUsed,
        logObjectKey: storedObjects[0]?.object_key || "",
      },
      nowIso
    );

    await insertCredEvent(
      `solve:${taskId}:${workerUuid}`,
      isNgo ? "ngo_task_solve" : "task_solve",
      baseSolve,
      unblockBonus,
      priorFailed,
      receiptHash,
      storedObjects[0]?.object_key || "",
      {
        is_ngo: isNgo,
        alternative_route_used: altRouteUsed,
        total_bytes: totalBytes,
      }
    );
  }

  // 2. Eagle Eye Bonus (verified erratum / supersedes defect fix backed by stored Task Object)
  for (let i = 0; i < storedObjects.length; i += 1) {
    const so = storedObjects[i];
    const rawItem = rawObjects[i]?.item || {};
    const hasSupersedes =
      (Array.isArray(rawItem.supersedes) && rawItem.supersedes.length > 0) ||
      Boolean(rawItem.erratum_for) ||
      String(so.object_key || "").includes("erratum");
    if (hasSupersedes && so.object_key) {
      await insertCredEvent(
        `eagle_eye:${so.object_key}:${workerUuid}`,
        "defect_erratum_caught",
        REPUTATION_AND_PROPOSAL_GRID.eagle_eye_defect_catch_points,
        0,
        0,
        so.sha256_hash || receiptHash,
        so.object_key,
        { supersedes: rawItem.supersedes || rawItem.erratum_for || [] }
      );
    }
  }

  // 3. Independent Cross-Worker Verification (`solver != verifier` strictly enforced!)
  for (const ev of appliedEvaluations) {
    const targetId = String(ev.target_id || "");
    if (!targetId) continue;
    let ownerAgent = "";
    let ownerUuid = "";
    if (ev.target_kind === "object") {
      const oRow = await db
        .prepare("SELECT producer_agent, worker_uuid FROM herma_task_objects WHERE object_key = ? LIMIT 1")
        .bind(targetId)
        .first();
      ownerAgent = oRow?.producer_agent || "";
      ownerUuid = oRow?.worker_uuid || "";
    } else {
      const tRow = await db
        .prepare("SELECT producer_agent, completed_by, owner_worker_uuid FROM herma_durable_queue WHERE task_id = ? LIMIT 1")
        .bind(targetId)
        .first();
      ownerAgent = tRow?.completed_by || tRow?.producer_agent || "";
      ownerUuid = tRow?.owner_worker_uuid || "";
    }
    const isSelfEval =
      (ownerUuid && ownerUuid === workerUuid) || (ownerAgent && ownerAgent === agentId);
    if (!isSelfEval) {
      const caughtDefect = Boolean(ev.defect_caught || Number(ev.quality_milli ?? 500) <= 300);
      const pts = caughtDefect
        ? REPUTATION_AND_PROPOSAL_GRID.eagle_eye_defect_catch_points
        : REPUTATION_AND_PROPOSAL_GRID.verify_points;
      await insertCredEvent(
        `verify:${targetId}:${workerUuid}`,
        caughtDefect ? "verify_caught_defect" : "independent_verify",
        pts,
        0,
        0,
        receiptHash,
        ev.target_kind === "object" ? targetId : "",
        { target_kind: ev.target_kind, target_id: targetId, quality_milli: ev.quality_milli }
      );

      // Update proposal governance status if evaluating an `infra_proposal` / `retraining_request`!
      if (ev.target_kind === "object") {
        const propRow = await db
          .prepare("SELECT * FROM herma_proposals_registry WHERE object_key = ?")
          .bind(targetId)
          .first();
        if (propRow && propRow.proposer_worker_uuid !== workerUuid && propRow.proposer_agent !== agentId) {
          const prevCnt = Number(propRow.independent_eval_count || 0);
          const prevMean = Number(propRow.mean_eval_quality_milli || 0);
          const nextCnt = prevCnt + 1;
          const nextMean = Math.round((prevMean * prevCnt + Number(ev.quality_milli || 0)) / nextCnt);
          const nextStatus =
            nextCnt >= REPUTATION_AND_PROPOSAL_GRID.proposal_admin_ready_min_evals &&
            nextMean >= REPUTATION_AND_PROPOSAL_GRID.proposal_admin_ready_min_quality_milli
              ? "admin_review_ready"
              : "worker_evaluated";
          await db
            .prepare(
              `UPDATE herma_proposals_registry
               SET independent_eval_count = ?, mean_eval_quality_milli = ?, governance_status = ?, updated_at = ?
               WHERE object_key = ?`
            )
            .bind(nextCnt, nextMean, nextStatus, nowIso, targetId)
            .run();
        }
      }
    }
  }

  // 4. Cooperative Relay Subproblem Publication (+2 when publishing tasks with suggested_capabilities / alternative_routes)
  let relayPublishedCount = 0;
  for (let i = 0; i < enqueuedVerbs.length; i += 1) {
    const evVerb = enqueuedVerbs[i];
    const rawV = rawVerbs[i] || {};
    const caps = sanitizeStringList(
      rawV.suggested_capabilities || rawV.capabilities_needed,
      REPUTATION_AND_PROPOSAL_GRID.max_capabilities_per_task
    );
    const routes = sanitizeStringList(
      rawV.alternative_routes || rawV.fallback_routes,
      REPUTATION_AND_PROPOSAL_GRID.max_routes_per_task
    );
    const blockerSummary = String(rawV.blocker_summary || rawV.parent_blocker_summary || "").slice(
      0,
      REPUTATION_AND_PROPOSAL_GRID.summary_clip_chars
    );
    if (evVerb?.task_id && (caps.length > 0 || routes.length > 0 || blockerSummary)) {
      await recordTaskRelayMetadata(
        db,
        evVerb.task_id,
        {
          suggested_capabilities: caps,
          alternative_routes: routes,
          parent_blocker_summary: blockerSummary,
        },
        nowIso
      );
      relayPublishedCount += 1;
    }
  }
  if (relayPublishedCount > 0) {
    await insertCredEvent(
      `relay_pub:${receiptHash.slice(0, 24)}:${workerUuid}`,
      "publish_relay_subproblem",
      REPUTATION_AND_PROPOSAL_GRID.publish_relay_subproblem_points,
      0,
      0,
      receiptHash,
      "",
      { relay_tasks_published: relayPublishedCount }
    );
  }

  // 5. Register clearly labeled `infra_proposal` / `retraining_request` / `pipeline_step_proposal` Task Objects
  const proposalsRegistered = [];
  for (let i = 0; i < storedObjects.length; i += 1) {
    const so = storedObjects[i];
    const rawItem = rawObjects[i]?.item || {};
    const pObj = rawItem.payload && typeof rawItem.payload === "object" ? rawItem.payload : null;
    const propMeta = extractProposalMetadata(rawItem, pObj);
    if (propMeta && so.object_key) {
      await db
        .prepare(
          `INSERT INTO herma_proposals_registry
           (object_key, proposal_kind, target_subsystem, proposer_agent, proposer_worker_uuid,
            source_task_id, summary, proposal_meta_json, independent_eval_count, mean_eval_quality_milli,
            governance_status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'proposed', ?, ?)
           ON CONFLICT(object_key) DO UPDATE SET
             summary = excluded.summary,
             proposal_meta_json = excluded.proposal_meta_json,
             updated_at = excluded.updated_at`
        )
        .bind(
          so.object_key,
          propMeta.proposal_kind,
          propMeta.target_subsystem,
          agentId,
          workerUuid,
          String(taskId || ""),
          String(rawItem.summary || so.object_key).slice(0, REPUTATION_AND_PROPOSAL_GRID.summary_clip_chars),
          JSON.stringify(propMeta),
          nowIso,
          nowIso
        )
        .run();
      proposalsRegistered.push({
        object_key: so.object_key,
        proposal_kind: propMeta.proposal_kind,
        target_subsystem: propMeta.target_subsystem,
        governance_status: "proposed",
      });
    }
  }

  return {
    points_earned_this_submit: totalEarned,
    events: eventsRecorded,
    proposals_registered: proposalsRegistered,
  };
}

export async function buildWorkerScoreAndBadges(db, workerUuid) {
  await ensureReputationAndProposalsSchema(db);
  const wRow = await db
    .prepare("SELECT * FROM herma_worker_registry WHERE worker_uuid = ?")
    .bind(String(workerUuid))
    .first();
  const evRes = await db
    .prepare(
      `SELECT event_kind, points_awarded, unblock_bonus, prior_failed_workers, multiplier_milli,
              evidence_ref, task_id, object_key, detail_json, ip_fingerprint, created_at
       FROM herma_worker_cred_events
       WHERE worker_uuid = ?
       ORDER BY id DESC`
    )
    .bind(String(workerUuid))
    .all();
  const events = evRes?.results || [];

  // Baseline historical solves in herma_worker_registry also contribute deterministic baseline cred
  const regNgo = Number(wRow?.ngo_completed || 0);
  const regEval = Number(wRow?.eval_completed || 0);
  const regOwn = Number(wRow?.own_completed || 0);
  const regIters = Number(wRow?.iteration_count || 0);
  const meanBytes = Number(wRow?.mean_artifact_bytes || 0);

  let ledgerPoints = 0;
  let unblockTotal = 0;
  let unblockedTasks = 0;
  let verifyCount = 0;
  let eagleEyeCount = 0;
  let relayPubCount = 0;
  let bridgeBuilderCount = 0;
  let heavyEventCount = 0;
  let latestIpFingerprint = "";

  for (const ev of events) {
    ledgerPoints += Number(ev.points_awarded || 0);
    unblockTotal += Number(ev.unblock_bonus || 0);
    if (Number(ev.prior_failed_workers || 0) > 0) unblockedTasks += 1;
    if (ev.event_kind === "independent_verify" || ev.event_kind === "verify_caught_defect") verifyCount += 1;
    if (ev.event_kind === "defect_erratum_caught" || ev.event_kind === "verify_caught_defect") eagleEyeCount += 1;
    if (ev.event_kind === "publish_relay_subproblem") relayPubCount += 1;
    if (Number(ev.multiplier_milli || 1000) > REPUTATION_AND_PROPOSAL_GRID.milli_scale) heavyEventCount += 1;
    if (!latestIpFingerprint && ev.ip_fingerprint) latestIpFingerprint = ev.ip_fingerprint;
    try {
      const det = JSON.parse(ev.detail_json || "{}");
      if (det.alternative_route_used) bridgeBuilderCount += 1;
    } catch {
      // ignore
    }
  }

  const baselineHistoricalPoints =
    events.length > 0
      ? 0
      : regNgo * (REPUTATION_AND_PROPOSAL_GRID.solve_points + REPUTATION_AND_PROPOSAL_GRID.ngo_bonus_points) +
        regOwn * REPUTATION_AND_PROPOSAL_GRID.solve_points +
        regEval * REPUTATION_AND_PROPOSAL_GRID.verify_points;

  const totalPoints = ledgerPoints + baselineHistoricalPoints;
  const badges = [];
  if (regNgo >= 1 || events.some((e) => e.event_kind === "ngo_task_solve")) {
    badges.push(BADGE_CATALOG.first_responder);
  }
  if (bridgeBuilderCount >= 1) {
    badges.push(BADGE_CATALOG.bridge_builder);
  }
  if (unblockedTasks >= 1) {
    badges.push(BADGE_CATALOG.unblocker);
  }
  if (verifyCount >= 1 || regEval >= 1) {
    badges.push(BADGE_CATALOG.verifier);
  }
  if (eagleEyeCount >= 1) {
    badges.push(BADGE_CATALOG.eagle_eye);
  }
  if (relayPubCount >= 1) {
    badges.push(BADGE_CATALOG.publisher);
  }
  if (regNgo >= REPUTATION_AND_PROPOSAL_GRID.ngo_champion_min_solves) {
    badges.push(BADGE_CATALOG.ngo_champion);
  }
  if (heavyEventCount >= 1 || meanBytes >= REPUTATION_AND_PROPOSAL_GRID.heavy_lifter_min_bytes) {
    badges.push(BADGE_CATALOG.heavy_lifter);
  }
  if (regIters >= REPUTATION_AND_PROPOSAL_GRID.marathoner_min_cycles) {
    badges.push(BADGE_CATALOG.marathoner);
  }

  return {
    worker_uuid: String(workerUuid),
    agent_id: wRow?.agent_id || events[0]?.agent_id || "",
    ip_signal_hash: latestIpFingerprint || null,
    total_cred_points: totalPoints,
    ledger_event_points: ledgerPoints,
    unblock_bonus_points: unblockTotal,
    tasks_unblocked: unblockedTasks,
    badges: badges.map((b) => b.id),
    badge_details: badges,
    recent_cred_events: events.slice(0, 15),
  };
}

export async function handleLeaderboardRequest(url, db) {
  await ensureReputationAndProposalsSchema(db);
  const badgeFilter = String(url.searchParams.get("badge") || "").trim().toLowerCase();
  const targetWorker = String(url.searchParams.get("worker_uuid") || "").trim();

  if (targetWorker) {
    const single = await buildWorkerScoreAndBadges(db, targetWorker);
    return {
      ok: true,
      schema: REPUTATION_AND_PROPOSAL_GRID.schema_id,
      scoring_policy: {
        auth_mode: "unauthed_worker_id_plus_salted_ip_hash_raw_ip_never_stored",
        points_are_computed_from_verified_receipts_only: true,
        solver_cannot_verify_own_work: true,
        unblock_bonus_per_prior_failed_worker: REPUTATION_AND_PROPOSAL_GRID.unblock_bonus_per_prior_worker,
        unblock_bonus_cap: REPUTATION_AND_PROPOSAL_GRID.unblock_bonus_cap,
      },
      worker: single,
    };
  }

  const workersRes = await db
    .prepare(
      `SELECT worker_uuid, agent_id, harness_tier, iteration_count, ngo_completed, eval_completed, own_completed,
              mean_artifact_bytes, COALESCE(is_diagnostic_probe, 0) AS is_diag, updated_at
       FROM herma_worker_registry
       WHERE COALESCE(is_diagnostic_probe, 0) = 0
         AND (iteration_count > 0 OR worker_uuid IN (SELECT DISTINCT worker_uuid FROM herma_worker_cred_events))
       ORDER BY iteration_count DESC, updated_at DESC
       LIMIT ?`
    )
    .bind(REPUTATION_AND_PROPOSAL_GRID.max_leaderboard_rows)
    .all();

  const standings = [];
  for (const w of workersRes?.results || []) {
    const scored = await buildWorkerScoreAndBadges(db, w.worker_uuid);
    if (badgeFilter && !scored.badges.includes(badgeFilter)) continue;
    standings.push({
      worker_uuid: w.worker_uuid,
      agent_id: w.agent_id,
      harness_tier: w.harness_tier,
      total_cred_points: scored.total_cred_points,
      unblock_bonus_points: scored.unblock_bonus_points,
      tasks_unblocked: scored.tasks_unblocked,
      ngo_completed: Number(w.ngo_completed || 0),
      eval_completed: Number(w.eval_completed || 0),
      own_completed: Number(w.own_completed || 0),
      iteration_count: Number(w.iteration_count || 0),
      badges: scored.badges,
      ip_signal_hash: scored.ip_signal_hash,
      updated_at: w.updated_at,
    });
  }
  standings.sort(
    (a, b) =>
      b.total_cred_points - a.total_cred_points ||
      b.tasks_unblocked - a.tasks_unblocked ||
      b.ngo_completed - a.ngo_completed
  );

  return {
    ok: true,
    schema: REPUTATION_AND_PROPOSAL_GRID.schema_id,
    scoring_policy: {
      note: "Cred steers which workers are invited to hard or compute-heavy relays; never currency, never self-claimed.",
      raw_ip_stored: false,
      solve_points: REPUTATION_AND_PROPOSAL_GRID.solve_points,
      ngo_bonus_points: REPUTATION_AND_PROPOSAL_GRID.ngo_bonus_points,
      verify_points: REPUTATION_AND_PROPOSAL_GRID.verify_points,
      eagle_eye_defect_catch_points: REPUTATION_AND_PROPOSAL_GRID.eagle_eye_defect_catch_points,
      publish_relay_subproblem_points: REPUTATION_AND_PROPOSAL_GRID.publish_relay_subproblem_points,
      unblock_bonus_per_prior_worker: REPUTATION_AND_PROPOSAL_GRID.unblock_bonus_per_prior_worker,
      unblock_bonus_cap: REPUTATION_AND_PROPOSAL_GRID.unblock_bonus_cap,
      gpu_multiplier: "1.5x",
      high_bandwidth_multiplier: "1.25x",
      badges_available: Object.values(BADGE_CATALOG),
    },
    total_ranked_workers: standings.length,
    leaderboard: standings,
  };
}

export async function handleProposalsGovernanceRequest(url, db, publicUrl = "https://herma.ta-amps.workers.dev") {
  await ensureReputationAndProposalsSchema(db);
  const statusFilter = String(url.searchParams.get("status") || "").trim().toLowerCase();
  const kindFilter = String(url.searchParams.get("kind") || "").trim().toLowerCase();

  const rowsRes = await db
    .prepare(
      `SELECT * FROM herma_proposals_registry
       ORDER BY
         (CASE governance_status WHEN 'admin_review_ready' THEN 0 WHEN 'worker_evaluated' THEN 1 ELSE 2 END) ASC,
         mean_eval_quality_milli DESC,
         updated_at DESC
       LIMIT ?`
    )
    .bind(REPUTATION_AND_PROPOSAL_GRID.max_proposals_rows)
    .all();

  const items = [];
  for (const r of rowsRes?.results || []) {
    if (statusFilter && r.governance_status !== statusFilter) continue;
    if (kindFilter && r.proposal_kind !== kindFilter) continue;
    let meta = {};
    try {
      meta = JSON.parse(r.proposal_meta_json || "{}");
    } catch {
      meta = {};
    }
    items.push({
      object_key: r.object_key,
      proposal_kind: r.proposal_kind,
      target_subsystem: r.target_subsystem,
      proposer_agent: r.proposer_agent,
      proposer_worker_uuid: r.proposer_worker_uuid,
      source_task_id: r.source_task_id,
      summary: r.summary,
      governance_status: r.governance_status,
      independent_eval_count: Number(r.independent_eval_count || 0),
      mean_eval_quality_milli: Number(r.mean_eval_quality_milli || 0),
      admitted_to_production: false,
      proposal_metadata: meta,
      object_url: `${publicUrl}/q/object/${encodeURIComponent(r.object_key)}`,
      permalink: `${publicUrl}/c/${encodeURIComponent(r.object_key)}`,
      updated_at: r.updated_at,
    });
  }

  return {
    ok: true,
    schema: "herma.proposals_governance.v1",
    governance_boundary:
      "Worker-authored infra_proposal and retraining_request Task Objects are peer-evaluated (evaluator != proposer) and surfaced as admin_review_ready; they never self-deploy or claim admitted status without explicit admin review.",
    counts: {
      total: items.length,
      admin_review_ready: items.filter((x) => x.governance_status === "admin_review_ready").length,
      worker_evaluated: items.filter((x) => x.governance_status === "worker_evaluated").length,
      proposed: items.filter((x) => x.governance_status === "proposed").length,
    },
    proposals: items,
  };
}
