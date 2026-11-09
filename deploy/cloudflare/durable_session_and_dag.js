// Durable session state hydrator (/q/resume), step progress checkpoints (/q/checkpoint),
// frontier sweep deduplication (/q/frontier), and flexible contract/count checks.
// All numeric thresholds, bounds, and byte caps resolve from DURABLE_SESSION_GRID.

import { stripPii, stripPiiDeep } from "./pii_strip.js";

export const DURABLE_SESSION_GRID = Object.freeze({
  schema: "shim.durable_session_grid.v1",
  generation: 1,
  grid_axes: Object.freeze({
    checkpoint_max_steps: Object.freeze({ type: "integer_range", low: 8, high: 256, active: 64 }),
    checkpoint_step_max_chars: Object.freeze({ type: "integer_range", low: 64, high: 1024, active: 280 }),
    checkpoint_notes_max_chars: Object.freeze({ type: "integer_range", low: 128, high: 4096, active: 1200 }),
    checkpoint_lease_extend_seconds: Object.freeze({ type: "integer_range", low: 120, high: 3600, active: 900 }),
    resume_compact_target_bytes: Object.freeze({ type: "integer_range", low: 512, high: 4096, active: 1450 }),
    resume_default_max_bytes: Object.freeze({ type: "integer_range", low: 1024, high: 32768, active: 8192 }),
    resume_max_leases: Object.freeze({ type: "integer_range", low: 1, high: 20, active: 5 }),
    resume_max_checkpoints: Object.freeze({ type: "integer_range", low: 1, high: 20, active: 5 }),
    resume_recent_attempts_limit: Object.freeze({ type: "integer_range", low: 1, high: 30, active: 8 }),
    resume_suggested_tasks: Object.freeze({ type: "integer_range", low: 1, high: 10, active: 3 }),
    resume_prompt_excerpt_chars: Object.freeze({ type: "integer_range", low: 80, high: 800, active: 220 }),
    frontier_max_items_per_call: Object.freeze({ type: "integer_range", low: 10, high: 1000, active: 200 }),
    frontier_lookup_max_candidates: Object.freeze({ type: "integer_range", low: 100, high: 16384, active: 4096 }),
    frontier_item_max_chars: Object.freeze({ type: "integer_range", low: 32, high: 512, active: 200 }),
    frontier_campaign_max_chars: Object.freeze({ type: "integer_range", low: 16, high: 160, active: 80 }),
    frontier_query_chunk_size: Object.freeze({ type: "integer_range", low: 10, high: 90, active: 80 }),
    frontier_recent_sample_limit: Object.freeze({ type: "integer_range", low: 1, high: 50, active: 10 }),
    contract_max_issues: Object.freeze({ type: "integer_range", low: 1, high: 50, active: 20 }),
    contract_max_required_fields: Object.freeze({ type: "integer_range", low: 1, high: 64, active: 32 }),
  }),
  constraints: Object.freeze([
    "resume_compact_target_bytes <= resume_default_max_bytes",
    "frontier_query_chunk_size <= frontier_max_items_per_call",
    "frontier_max_items_per_call <= frontier_lookup_max_candidates",
  ]),
  agent_id_max_chars: 96,
  task_id_max_chars: 128,
  artifact_key_max_chars: 128,
  checkpoint_max_steps: 64,
  checkpoint_max_artifacts: 32,
  checkpoint_step_max_chars: 280,
  checkpoint_notes_max_chars: 1200,
  checkpoint_lease_extend_seconds: 900,
  checkpoint_request_max_bytes: 65536,
  resume_compact_target_bytes: 1450,
  resume_default_max_bytes: 8192,
  resume_min_max_bytes: 512,
  resume_ceiling_max_bytes: 65536,
  resume_max_leases: 5,
  resume_max_checkpoints: 5,
  resume_recent_attempts_limit: 8,
  resume_suggested_tasks: 3,
  resume_trimmed_preview_items: 2,
  resume_prompt_excerpt_chars: 220,
  resume_title_max_chars: 140,
  frontier_max_items_per_call: 200,
  frontier_lookup_max_candidates: 4096,
  frontier_item_max_chars: 200,
  frontier_campaign_max_chars: 80,
  frontier_query_chunk_size: 80,
  frontier_recent_sample_limit: 10,
  frontier_request_max_bytes: 131072,
  contract_max_issues: 20,
  contract_max_required_fields: 32,
  ms_per_second: 1000,
  http_ok: 200,
  http_bad_request: 400,
  http_method_not_allowed: 405,
  http_payload_too_large: 413,
  http_unprocessable: 422,
});

const readyDurableTables = new WeakSet();

export async function ensureDurableSessionSchema(db) {
  if (!db || typeof db.prepare !== "function") return;
  if (typeof db === "object" && readyDurableTables.has(db)) return;
  const statements = [
    db.prepare(
      `CREATE TABLE IF NOT EXISTS herma_agent_checkpoints (
        agent_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        step_index INTEGER NOT NULL DEFAULT 0,
        total_steps INTEGER NOT NULL DEFAULT 0,
        completed_json TEXT NOT NULL DEFAULT '[]',
        pending_json TEXT NOT NULL DEFAULT '[]',
        notes TEXT NOT NULL DEFAULT '',
        artifact_keys_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (agent_id, task_id)
      )`
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_herma_agent_checkpoints_agent
       ON herma_agent_checkpoints(agent_id, updated_at DESC)`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS herma_frontier_seen (
        scope_key TEXT NOT NULL,
        item_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        campaign TEXT NOT NULL DEFAULT 'default',
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        PRIMARY KEY (scope_key, item_id)
      )`
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_herma_frontier_seen_scope
       ON herma_frontier_seen(scope_key, last_seen_at DESC)`
    ),
  ];
  if (typeof db.batch === "function") {
    await db.batch(statements);
  } else {
    for (const stmt of statements) await stmt.run();
  }
  if (typeof db === "object") readyDurableTables.add(db);
}

function cleanIdentifier(raw, maxLen) {
  return String(raw ?? "")
    .trim()
    .replace(/[\u0000-\u001f]/g, "")
    .slice(0, maxLen);
}

function cleanAgentKey(raw) {
  return cleanIdentifier(raw, DURABLE_SESSION_GRID.agent_id_max_chars).toLowerCase();
}

function cleanCampaign(raw) {
  const cleaned = cleanIdentifier(raw || "default", DURABLE_SESSION_GRID.frontier_campaign_max_chars)
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "default";
}

export function buildFrontierScopeKey(agentId, campaign = "default") {
  return `${cleanAgentKey(agentId)}::${cleanCampaign(campaign)}`;
}

function cleanStepList(raw, maxItems, maxChars) {
  const source = Array.isArray(raw)
    ? raw
    : typeof raw === "string" && raw.trim()
      ? raw.split(/[;\n]+/)
      : [];
  const out = [];
  for (const entry of source) {
    if (out.length >= maxItems) break;
    const text = stripPii(String(entry ?? "").replace(/[\u0000-\u001f]+/g, " ").trim()).slice(0, maxChars);
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

function cleanItemList(raw) {
  const source = Array.isArray(raw)
    ? raw
    : typeof raw === "string" && raw.trim()
      ? raw.split(/[,\n]+/)
      : [];
  const out = [];
  const seen = new Set();
  for (const item of source) {
    if (out.length >= DURABLE_SESSION_GRID.frontier_max_items_per_call) break;
    const rawTrimmed = String(item ?? "").replace(/[\u0000-\u001f]+/g, "").trim();
    const text = stripPii(rawTrimmed).slice(0, DURABLE_SESSION_GRID.frontier_item_max_chars);
    const key = stripPii(text.toLowerCase());
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(text);
    }
  }
  return out;
}

function safeJsonArray(raw) {
  try {
    const parsed = JSON.parse(String(raw || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function clampBoundedInt(raw, fallback, low, high) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.trunc(n);
  if (rounded < low) return low;
  if (rounded > high) return high;
  return rounded;
}

/** Parse URL-mode slug on /q/checkpoint/<agent_id>/<task_id>/step-2-of-5--done-a--pending-b--note-c */
export function parseCheckpointUrlSlug(rawSlug) {
  const out = {
    step_index: undefined,
    total_steps: undefined,
    completed_steps: [],
    pending_steps: [],
    notes: "",
    fencing_token: undefined,
  };
  const decoded = String(rawSlug || "")
    .split("/")
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    })
    .join("/");
  if (!decoded.trim()) return out;
  for (const token of decoded.split("--")) {
    const part = token.trim();
    if (!part) continue;
    const stepMatch = part.match(/^step-(\d+)(?:-of-(\d+))?$/i);
    if (stepMatch) {
      const [, rawStep, rawTotal] = stepMatch;
      out.step_index = Number(rawStep);
      if (rawTotal !== undefined) out.total_steps = Number(rawTotal);
      continue;
    }
    if (/^fence-/i.test(part)) {
      out.fencing_token = part.slice("fence-".length).trim();
      continue;
    }
    if (/^done-/i.test(part)) {
      const val = part.slice("done-".length).trim();
      if (val) out.completed_steps.push(val);
      continue;
    }
    if (/^pending-/i.test(part)) {
      const val = part.slice("pending-".length).trim();
      if (val) out.pending_steps.push(val);
      continue;
    }
    if (/^note-/i.test(part)) {
      out.notes = part.slice("note-".length).trim();
    }
  }
  return out;
}

/** Read which candidate item IDs are already recorded in herma_frontier_seen for (agentId, campaign). */
export async function readSeenItemSet(db, agentId, campaign = "default", candidateIds = []) {
  const seen = new Set();
  const cleanAgent = cleanAgentKey(agentId);
  if (!db || !cleanAgent || !Array.isArray(candidateIds) || candidateIds.length === 0) return seen;
  await ensureDurableSessionSchema(db);
  const scopeKey = buildFrontierScopeKey(cleanAgent, campaign);
  const normalized = [
    ...new Set(
      candidateIds
        .map((id) => String(id ?? "").trim().toLowerCase())
        .filter(Boolean)
    ),
  ].slice(0, DURABLE_SESSION_GRID.frontier_lookup_max_candidates);
  const chunkSize = DURABLE_SESSION_GRID.frontier_query_chunk_size;
  for (let offset = 0; offset < normalized.length; offset += chunkSize) {
    const chunk = normalized.slice(offset, offset + chunkSize);
    const placeholders = chunk.map(() => "?").join(",");
    try {
      const rows =
        (
          await db
            .prepare(`SELECT item_id FROM herma_frontier_seen WHERE scope_key = ? AND item_id IN (${placeholders})`)
            .bind(scopeKey, ...chunk)
            .all()
        )?.results || [];
      for (const row of rows) {
        if (row?.item_id) seen.add(String(row.item_id).toLowerCase());
      }
    } catch {
      return seen;
    }
  }
  return seen;
}

/** Evaluate and optionally record frontier items for sweep deduplication. */
export async function evaluateFrontierScope(
  db,
  { agentId, campaign = "default", items = [], recordNew = false, now = new Date() } = {}
) {
  await ensureDurableSessionSchema(db);
  const cleanAgent = cleanAgentKey(agentId);
  const cleanCamp = cleanCampaign(campaign);
  const scopeKey = buildFrontierScopeKey(cleanAgent, cleanCamp);
  const cleanItems = cleanItemList(items);
  const seenLower = cleanItems.length > 0 ? await readSeenItemSet(db, cleanAgent, cleanCamp, cleanItems) : new Set();

  const unseen = [];
  const alreadySeen = [];
  for (const item of cleanItems) {
    if (seenLower.has(item.toLowerCase())) alreadySeen.push(item);
    else unseen.push(item);
  }

  let newlyRecorded = 0;
  const stamp = now.toISOString();
  if (recordNew && cleanAgent && cleanItems.length > 0) {
    const stmts = cleanItems.map((item) =>
      db
        .prepare(
          `INSERT INTO herma_frontier_seen (scope_key, item_id, agent_id, campaign, first_seen_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(scope_key, item_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`
        )
        .bind(scopeKey, stripPii(item.toLowerCase()), cleanAgent, cleanCamp, stamp, stamp)
    );
    if (typeof db.batch === "function") {
      await db.batch(stmts);
    } else {
      for (const stmt of stmts) await stmt.run();
    }
    newlyRecorded = unseen.length;
  }

  let totalSeenInScope = 0;
  let recentSample = [];
  if (cleanAgent) {
    try {
      const countRow = await db
        .prepare("SELECT COUNT(*) AS n FROM herma_frontier_seen WHERE scope_key = ?")
        .bind(scopeKey)
        .first();
      totalSeenInScope = Number(countRow?.n || 0);
      if (cleanItems.length === 0) {
        const recentRows =
          (
            await db
              .prepare("SELECT item_id, last_seen_at FROM herma_frontier_seen WHERE scope_key = ? ORDER BY last_seen_at DESC LIMIT ?")
              .bind(scopeKey, DURABLE_SESSION_GRID.frontier_recent_sample_limit)
              .all()
          )?.results || [];
        recentSample = recentRows.map((r) => ({ item_id: stripPii(String(r.item_id || "")), last_seen_at: r.last_seen_at }));
      }
    } catch {
      totalSeenInScope = 0;
    }
  }

  return {
    ok: true,
    schema: "shim.frontier_dedup.v1",
    agent_id: cleanAgent,
    campaign: cleanCamp,
    scope_key: scopeKey,
    checked_count: cleanItems.length,
    unseen,
    already_seen: alreadySeen,
    newly_recorded: newlyRecorded,
    total_seen_in_scope: totalSeenInScope,
    ...(recentSample.length > 0 ? { recent_items: recentSample } : {}),
  };
}

/** Save or update a step checkpoint for (agentId, taskId), optionally extending an active lease when fencing_token matches. */
export async function recordSessionCheckpoint(
  db,
  publicUrl,
  {
    agentId,
    taskId,
    stepIndex = 0,
    totalSteps = 0,
    completedSteps = [],
    pendingSteps = [],
    notes = "",
    artifactKeys = [],
    seenItems = [],
    campaign = "default",
    fencingToken = undefined,
    now = new Date(),
  } = {}
) {
  await ensureDurableSessionSchema(db);
  const cleanAgent = cleanAgentKey(agentId);
  const cleanTask = cleanIdentifier(taskId || "self_seed", DURABLE_SESSION_GRID.task_id_max_chars);
  const completed = cleanStepList(
    completedSteps,
    DURABLE_SESSION_GRID.checkpoint_max_steps,
    DURABLE_SESSION_GRID.checkpoint_step_max_chars
  );
  const pending = cleanStepList(
    pendingSteps,
    DURABLE_SESSION_GRID.checkpoint_max_steps,
    DURABLE_SESSION_GRID.checkpoint_step_max_chars
  );
  const artifacts = cleanStepList(
    artifactKeys,
    DURABLE_SESSION_GRID.checkpoint_max_artifacts,
    DURABLE_SESSION_GRID.artifact_key_max_chars
  );
  const inferredStep = completed.length;
  const clampedStep = clampBoundedInt(
    stepIndex || inferredStep,
    inferredStep,
    0,
    DURABLE_SESSION_GRID.checkpoint_max_steps
  );
  const inferredTotal = completed.length + pending.length;
  const clampedTotal = clampBoundedInt(
    totalSteps || inferredTotal,
    Math.max(clampedStep, inferredTotal),
    0,
    DURABLE_SESSION_GRID.checkpoint_max_steps
  );
  const cleanNotes = stripPii(String(notes ?? "").replace(/[\u0000-\u001f]+/g, " ").trim()).slice(
    0,
    DURABLE_SESSION_GRID.checkpoint_notes_max_chars
  );
  const stamp = now.toISOString();

  await db
    .prepare(
      `INSERT INTO herma_agent_checkpoints
         (agent_id, task_id, step_index, total_steps, completed_json, pending_json, notes, artifact_keys_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(agent_id, task_id) DO UPDATE SET
         step_index = excluded.step_index,
         total_steps = excluded.total_steps,
         completed_json = excluded.completed_json,
         pending_json = excluded.pending_json,
         notes = excluded.notes,
         artifact_keys_json = excluded.artifact_keys_json,
         updated_at = excluded.updated_at`
    )
    .bind(
      cleanAgent,
      cleanTask,
      clampedStep,
      clampedTotal,
      JSON.stringify(completed),
      JSON.stringify(pending),
      cleanNotes,
      JSON.stringify(artifacts),
      stamp
    )
    .run();

  let leaseExtended = false;
  let leaseExpiresAt = null;
  const fenceText = fencingToken === undefined || fencingToken === null ? "" : String(fencingToken).trim();
  if (fenceText && cleanTask !== "self_seed") {
    try {
      const nextExpiry = new Date(
        now.getTime() + DURABLE_SESSION_GRID.checkpoint_lease_extend_seconds * DURABLE_SESSION_GRID.ms_per_second
      ).toISOString();
      const res = await db
        .prepare(
          `UPDATE herma_durable_queue
           SET lease_expires_at = CASE WHEN COALESCE(lease_expires_at, '') > ? THEN lease_expires_at ELSE ? END, updated_at = ?
           WHERE task_id = ? AND state = 'leased' AND LOWER(COALESCE(leased_by, '')) = ? AND CAST(fencing_token AS TEXT) = ?`
        )
        .bind(nextExpiry, nextExpiry, stamp, cleanTask, cleanAgent, fenceText)
        .run();
      if (Number(res?.meta?.changes ?? res?.changes ?? 0) > 0) {
        leaseExtended = true;
        const row = await db
          .prepare("SELECT lease_expires_at FROM herma_durable_queue WHERE task_id = ?")
          .bind(cleanTask)
          .first();
        leaseExpiresAt = row?.lease_expires_at || nextExpiry;
      }
    } catch {
      leaseExtended = false;
    }
  }

  let frontierSummary = null;
  const cleanSeen = cleanItemList(seenItems);
  if (cleanSeen.length > 0) {
    const fOut = await evaluateFrontierScope(db, {
      agentId: cleanAgent,
      campaign,
      items: cleanSeen,
      recordNew: true,
      now,
    });
    frontierSummary = {
      campaign: fOut.campaign,
      newly_recorded: fOut.newly_recorded,
      total_seen_in_scope: fOut.total_seen_in_scope,
    };
  }

  const base = String(publicUrl || "https://shim.teleionlabs.com").replace(/\/+$/, "");
  return {
    ok: true,
    schema: "shim.session_checkpoint.v1",
    checkpoint: {
      agent_id: cleanAgent,
      task_id: cleanTask,
      step_index: clampedStep,
      total_steps: clampedTotal,
      completed_steps: completed,
      pending_steps: pending,
      notes: cleanNotes,
      artifact_keys: artifacts,
      updated_at: stamp,
    },
    lease_extended: leaseExtended,
    ...(leaseExpiresAt ? { lease_expires_at: leaseExpiresAt } : {}),
    ...(frontierSummary ? { frontier: frontierSummary } : {}),
    resume_url: `${base}/q/resume/${encodeURIComponent(cleanAgent)}`,
    next: {
      action: pending.length > 0 ? "continue_checkpointed_task" : "submit_completed_work",
      advisory: true,
      url: pending.length > 0 ? `${base}/q/resume/${encodeURIComponent(cleanAgent)}` : `${base}/q/submit`,
      why:
        pending.length > 0
          ? `Saved step ${clampedStep} of ${clampedTotal}. Continue with: ${pending[0]}`
          : "All listed steps are recorded. Submit the finished work to /q/submit.",
      retry_same_call: false,
    },
  };
}

/** Hydrate compact session state for cron sweeps and compacted harnesses (/q/resume/<agent_id>). */
export async function hydrateSessionResume(
  db,
  publicUrl,
  {
    agentId,
    tokenMatched = false,
    infraAllowed = false,
    campaign = "default",
    compact = false,
    maxBytes = DURABLE_SESSION_GRID.resume_default_max_bytes,
    suggestNextTasks = null,
    now = new Date(),
  } = {}
) {
  await ensureDurableSessionSchema(db);
  const cleanAgent = cleanAgentKey(agentId);
  const base = String(publicUrl || "https://shim.teleionlabs.com").replace(/\/+$/, "");
  const stamp = now.toISOString();
  const visClause = infraAllowed
    ? "COALESCE(visibility, 'public_commons') IN ('server_infra', 'public_ngo', 'public_commons')"
    : "COALESCE(visibility, 'public_commons') IN ('public_ngo', 'public_commons')";

  let activeLeases = [];
  try {
    const rows =
      (
        await db
          .prepare(
            `SELECT task_id, tier, priority, title, prompt, state, leased_by, fencing_token, lease_expires_at, updated_at
             FROM herma_durable_queue
             WHERE state = 'leased' AND LOWER(COALESCE(leased_by, '')) = ? AND ${visClause}
             ORDER BY priority DESC, id DESC
             LIMIT ?`
          )
          .bind(cleanAgent, DURABLE_SESSION_GRID.resume_max_leases)
          .all()
      )?.results || [];
    activeLeases = rows
      .filter((r) => !r.lease_expires_at || Date.parse(String(r.lease_expires_at)) > now.getTime())
      .map((r) => {
        const encTask = encodeURIComponent(String(r.task_id || ""));
        const encAgent = encodeURIComponent(cleanAgent);
        const entry = {
          task_id: r.task_id,
          tier: r.tier,
          priority: r.priority,
          title: stripPii(String(r.title || "")).slice(0, DURABLE_SESSION_GRID.resume_title_max_chars),
          prompt_head: stripPii(String(r.prompt || "")).slice(0, DURABLE_SESSION_GRID.resume_prompt_excerpt_chars),
          lease_expires_at: r.lease_expires_at || null,
          task_url: `${base}/q/task/${encTask}`,
          submit_url: `${base}/q/submit`,
          checkpoint_url: `${base}/q/checkpoint`,
        };
        if (tokenMatched) {
          entry.fencing_token = r.fencing_token;
          entry.heartbeat_url = `${base}/q/heartbeat?agent_id=${encAgent}&task_id=${encTask}&lease_epoch=${encodeURIComponent(String(r.fencing_token ?? ""))}`;
          entry.give_back_url = `${base}/q/release/${encAgent}/${encTask}/${encodeURIComponent(String(r.fencing_token ?? ""))}?reason=cannot-finish-in-window`;
        }
        return entry;
      });
  } catch {
    activeLeases = [];
  }

  let checkpoints = [];
  try {
    const cpRows =
      (
        await db
          .prepare(
            `SELECT task_id, step_index, total_steps, completed_json, pending_json, notes, artifact_keys_json, updated_at
             FROM herma_agent_checkpoints
             WHERE agent_id = ?
             ORDER BY updated_at DESC
             LIMIT ?`
          )
          .bind(cleanAgent, DURABLE_SESSION_GRID.resume_max_checkpoints)
          .all()
      )?.results || [];
    checkpoints = cpRows.map((row) => ({
      task_id: row.task_id,
      step_index: Number(row.step_index || 0),
      total_steps: Number(row.total_steps || 0),
      completed_steps: safeJsonArray(row.completed_json).map((s) => stripPii(String(s))),
      pending_steps: safeJsonArray(row.pending_json).map((s) => stripPii(String(s))),
      notes: stripPii(String(row.notes || "")),
      artifact_keys: safeJsonArray(row.artifact_keys_json).map((s) => stripPii(String(s))),
      updated_at: row.updated_at,
    }));
  } catch {
    checkpoints = [];
  }

  let recentOutcomes = [];
  try {
    const attRows =
      (
        await db
          .prepare(
            `SELECT task_id, outcome, created_at
             FROM herma_task_attempt_ledger
             WHERE LOWER(COALESCE(agent_id, '')) = ?
             ORDER BY id DESC
             LIMIT ?`
          )
          .bind(cleanAgent, DURABLE_SESSION_GRID.resume_recent_attempts_limit)
          .all()
      )?.results || [];
    recentOutcomes = attRows.map((r) => ({
      task_id: r.task_id,
      outcome: r.outcome,
      at: r.created_at,
    }));
  } catch {
    recentOutcomes = [];
  }

  let frontierCount = 0;
  const cleanCamp = cleanCampaign(campaign);
  const scopeKey = buildFrontierScopeKey(cleanAgent, cleanCamp);
  try {
    const fRow = await db
      .prepare("SELECT COUNT(*) AS n FROM herma_frontier_seen WHERE scope_key = ?")
      .bind(scopeKey)
      .first();
    frontierCount = Number(fRow?.n || 0);
  } catch {
    frontierCount = 0;
  }

  let candidateTasks = [];
  if (activeLeases.length === 0 && typeof suggestNextTasks === "function") {
    try {
      const nextOut = await suggestNextTasks();
      if (Array.isArray(nextOut?.tasks)) {
        candidateTasks = nextOut.tasks.slice(0, DURABLE_SESSION_GRID.resume_suggested_tasks).map((t) => ({
          task_id: t.task_id,
          tier: t.tier,
          priority: t.priority,
          title: stripPii(String(t.title || "")).slice(0, DURABLE_SESSION_GRID.resume_title_max_chars),
          claim_url: t.claim_url,
          task_url: t.task_url,
        }));
      }
    } catch {
      candidateTasks = [];
    }
  }

  const primaryLease = activeLeases[0] || null;
  const matchingCheckpoint = primaryLease
    ? checkpoints.find((c) => c.task_id === primaryLease.task_id) || null
    : checkpoints[0] || null;

  const nextBlock = primaryLease
    ? {
        action: tokenMatched ? "finish_active_lease" : "send_worker_token_to_resume_lease",
        advisory: false,
        task_id: primaryLease.task_id,
        url: tokenMatched ? `${base}/q/submit` : `${base}/q/resume/${encodeURIComponent(cleanAgent)}`,
        why: tokenMatched
          ? matchingCheckpoint?.pending_steps?.length
            ? `Active lease on ${primaryLease.task_id} (step ${matchingCheckpoint.step_index}/${matchingCheckpoint.total_steps}). Next step: ${matchingCheckpoint.pending_steps[0]}`
            : `You already hold an active lease on ${primaryLease.task_id}. Finish and submit it, or give it back via /q/release before claiming another.`
          : `An active lease exists under ${cleanAgent}. Resend GET /q/resume/${cleanAgent} with header X-Worker-Token (or ?wt=) to read its fencing_token.`,
        retry_same_call: false,
      }
    : candidateTasks.length > 0
      ? {
          action: "claim_ready_task",
          advisory: true,
          url: candidateTasks[0].claim_url,
          why: "No active lease is open under this ID. Pick one ready Task from ready_tasks and read its task_url before claiming.",
          retry_same_call: false,
        }
      : {
          action: "idle_no_open_work",
          advisory: true,
          url: `${base}/q/next?agent_id=${encodeURIComponent(cleanAgent)}&unseen_only=1`,
          why: "No active lease and no matching ready Task right now.",
          retry_same_call: false,
        };

  const full = {
    ok: true,
    schema: "shim.session_resume.v1",
    agent_id: cleanAgent,
    token_matched: Boolean(tokenMatched),
    ...(!tokenMatched && activeLeases.length > 0
      ? { token_hint: "Send header X-Worker-Token (or ?wt=<token>) to include your active fencing_token." }
      : {}),
    generated_at: stamp,
    active_leases: activeLeases,
    checkpoints: compact ? (matchingCheckpoint ? [matchingCheckpoint] : []) : checkpoints,
    ...(compact ? {} : { recent_attempts: recentOutcomes }),
    frontier: {
      campaign: cleanCamp,
      scope_key: scopeKey,
      seen_count: frontierCount,
      dedup_url: `${base}/q/frontier`,
    },
    ready_tasks: candidateTasks,
    next: nextBlock,
  };

  const targetCap = clampBoundedInt(
    compact ? Math.min(maxBytes, DURABLE_SESSION_GRID.resume_compact_target_bytes) : maxBytes,
    DURABLE_SESSION_GRID.resume_default_max_bytes,
    DURABLE_SESSION_GRID.resume_min_max_bytes,
    DURABLE_SESSION_GRID.resume_ceiling_max_bytes
  );
  const enc = new TextEncoder();
  if (enc.encode(JSON.stringify(full)).byteLength <= targetCap) return full;

  const trimmed = {
    ok: true,
    schema: "shim.session_resume.v1",
    agent_id: cleanAgent,
    token_matched: Boolean(tokenMatched),
    active_leases: activeLeases.map((l) => ({
      task_id: l.task_id,
      title: l.title,
      lease_expires_at: l.lease_expires_at,
      ...(tokenMatched ? { fencing_token: l.fencing_token } : {}),
      submit_url: l.submit_url,
    })),
    checkpoints: matchingCheckpoint
      ? [
          {
            task_id: matchingCheckpoint.task_id,
            step_index: matchingCheckpoint.step_index,
            total_steps: matchingCheckpoint.total_steps,
            pending_steps: matchingCheckpoint.pending_steps.slice(0, DURABLE_SESSION_GRID.resume_trimmed_preview_items),
          },
        ]
      : [],
    frontier_seen_count: frontierCount,
    ready_tasks: candidateTasks
      .slice(0, DURABLE_SESSION_GRID.resume_trimmed_preview_items)
      .map((t) => ({ task_id: t.task_id, title: t.title, claim_url: t.claim_url })),
    next: nextBlock,
    truncated_to_max_bytes: targetCap,
  };
  return trimmed;
}

/** Render a compact plain-text session hydrator (< 1.5 KB) for paste/cron/compacted workers. */
export function renderSessionResumeText(resume) {
  const lines = [
    `SESSION RESUME: ${resume.agent_id}`,
    `TOKEN_MATCHED: ${resume.token_matched ? "yes" : "no"}`,
  ];
  const leases = Array.isArray(resume.active_leases) ? resume.active_leases : [];
  if (leases.length > 0) {
    for (const lease of leases) {
      lines.push(`ACTIVE_LEASE: ${lease.task_id} | ${lease.title || ""}`);
      if (resume.token_matched && lease.fencing_token !== undefined) {
        lines.push(`FENCING_TOKEN: ${lease.fencing_token}`);
      } else {
        lines.push("FENCING_TOKEN: (send header X-Worker-Token or ?wt= to show)");
      }
      if (lease.lease_expires_at) lines.push(`LEASE_EXPIRES_AT: ${lease.lease_expires_at}`);
    }
  } else {
    lines.push("ACTIVE_LEASE: none");
  }
  const cps = Array.isArray(resume.checkpoints) ? resume.checkpoints : [];
  if (cps.length > 0) {
    const cp = cps[0];
    lines.push(`CHECKPOINT: ${cp.task_id} step ${cp.step_index}/${cp.total_steps}`);
    if (Array.isArray(cp.completed_steps) && cp.completed_steps.length > 0) {
      lines.push(`DONE_STEPS: ${cp.completed_steps.join(" | ")}`);
    }
    if (Array.isArray(cp.pending_steps) && cp.pending_steps.length > 0) {
      lines.push(`NEXT_STEPS: ${cp.pending_steps.join(" | ")}`);
    }
    if (cp.notes) lines.push(`NOTES: ${cp.notes}`);
  }
  const seenCount = resume.frontier?.seen_count ?? resume.frontier_seen_count ?? 0;
  lines.push(`FRONTIER_SEEN: ${seenCount}`);
  const ready = Array.isArray(resume.ready_tasks) ? resume.ready_tasks : [];
  if (ready.length > 0) {
    for (const item of ready) {
      lines.push(`READY_TASK: ${item.task_id} | ${item.title || ""} | ${item.claim_url || ""}`);
    }
  }
  if (resume.next?.why) {
    lines.push(`NEXT_ACTION: ${resume.next.action} -- ${resume.next.why}`);
  }
  return `${lines.join("\n")}\n`;
}

const PAGINATION_MARKERS = new Set([
  "limit",
  "offset",
  "page",
  "per_page",
  "page_size",
  "next_cursor",
  "cursor",
  "has_more",
  "truncated",
  "sample_only",
  "is_sample",
]);

const GENERIC_COUNT_KEYS = ["declared_count", "expected_count", "reported_count", "listed_count"];
const GENERIC_ARRAY_KEYS = ["items", "results", "entries", "records", "qualifying", "qualifying_items", "rows"];

function hasPaginationMarker(obj) {
  return Object.keys(obj).some((k) => PAGINATION_MARKERS.has(k.toLowerCase()));
}

function findStemArrayKey(obj, stem) {
  const cleanStem = stem.toLowerCase();
  const candidates = [
    cleanStem,
    `${cleanStem}s`,
    `${cleanStem}es`,
    cleanStem.endsWith("y") ? `${cleanStem.slice(0, -1)}ies` : "",
    `${cleanStem}_items`,
    `${cleanStem}_list`,
    `${cleanStem}_entries`,
    `${cleanStem}_records`,
    `${cleanStem}_results`,
  ].filter(Boolean);
  for (const key of Object.keys(obj)) {
    if (candidates.includes(key.toLowerCase()) && Array.isArray(obj[key])) {
      return key;
    }
  }
  return "";
}

/**
 * Inspect declared counts vs actual list lengths, required contract fields, and run_record structure.
 * Never throws; returns structured issues for advisory warnings (default) or 422 strict refusals (opt-in).
 */
export function evaluateSubmissionContract(candidate, objects = [], summaryText = "") {
  const c = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate : {};
  const issues = [];
  const pushIssue = (code, location, detail, repair) => {
    if (issues.length < DURABLE_SESSION_GRID.contract_max_issues) {
      issues.push({ code, location, detail, repair });
    }
  };

  // 1. Top-level expected_object_count vs objects.length
  if (Number.isInteger(c.expected_object_count) && c.expected_object_count >= 0 && c.expected_object_count !== objects.length) {
    pushIssue(
      "cardinality_mismatch",
      "expected_object_count",
      `Declared expected_object_count=${c.expected_object_count}, but task_objects has ${objects.length} item(s).`,
      `Include all ${c.expected_object_count} task_objects or update expected_object_count to ${objects.length}.`
    );
  }

  // 2. Per-object payload declared count vs array length (unless paginated)
  objects.forEach((rawObj, idx) => {
    if (!rawObj || typeof rawObj !== "object" || Array.isArray(rawObj)) return;
    const payload =
      rawObj.payload && typeof rawObj.payload === "object" && !Array.isArray(rawObj.payload) ? rawObj.payload : rawObj;
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || hasPaginationMarker(payload)) return;

    const checkedPairs = new Set();
    for (const [key, val] of Object.entries(payload)) {
      if (!Number.isInteger(val) || val < 0) continue;
      const lower = key.toLowerCase();
      let stem = "";
      if (lower.endsWith("_count") && lower.length > "_count".length) {
        stem = lower.slice(0, -"_count".length);
      } else if (lower.startsWith("num_") && lower.length > "num_".length) {
        stem = lower.slice("num_".length);
      }
      if (stem && stem !== "total" && stem !== "raw" && stem !== "search" && stem !== "rediscovery") {
        const arrKey = findStemArrayKey(payload, stem);
        if (arrKey && payload[arrKey].length !== val) {
          const pairId = `${key}:${arrKey}`;
          if (!checkedPairs.has(pairId)) {
            checkedPairs.add(pairId);
            pushIssue(
              "cardinality_mismatch",
              `task_objects[${idx}].payload.${key}`,
              `${key} states ${val}, while ${arrKey} holds ${payload[arrKey].length} item(s).`,
              `Make ${key} match ${arrKey}.length (${payload[arrKey].length}) or include the missing item(s) in ${arrKey}.`
            );
          }
        }
      }
    }

    for (const countKey of GENERIC_COUNT_KEYS) {
      if (!Number.isInteger(payload[countKey]) || payload[countKey] < 0) continue;
      const arrKey = GENERIC_ARRAY_KEYS.find((k) => Array.isArray(payload[k]));
      if (arrKey && payload[arrKey].length !== payload[countKey]) {
        pushIssue(
          "cardinality_mismatch",
          `task_objects[${idx}].payload.${countKey}`,
          `${countKey} states ${payload[countKey]}, while ${arrKey} holds ${payload[arrKey].length} item(s).`,
          `Align ${countKey} and ${arrKey}.length before submitting.`
        );
      }
    }
  });

  // 3. Unambiguous prose self-contradiction in summary ("header says 24 qualifying ... lists 23")
  const proseDrift = String(summaryText || "").match(
    /\b(\d{1,4})\s+qualifying\b[^.\n]{0,80}?\blists?\s+(\d{1,4})\b/i
  );
  if (proseDrift) {
    const [, rawDeclared, rawListed] = proseDrift;
    if (Number(rawDeclared) !== Number(rawListed)) {
      pushIssue(
        "cardinality_mismatch",
        "summary",
        `Summary states ${rawDeclared} qualifying items while listing ${rawListed}.`,
        "Reconcile the header count with the listed items so both numbers match."
      );
    }
  }

  // 4. Required contract fields check (output_contract.required_fields)
  const contract =
    c.output_contract && typeof c.output_contract === "object" && !Array.isArray(c.output_contract)
      ? c.output_contract
      : null;
  const requiredFields = Array.isArray(contract?.required_fields)
    ? contract.required_fields
        .filter((f) => typeof f === "string" && f.trim())
        .map((f) => f.trim())
        .slice(0, DURABLE_SESSION_GRID.contract_max_required_fields)
    : [];
  if (requiredFields.length > 0) {
    const candidateBags = [
      ...(c.result && typeof c.result === "object" && !Array.isArray(c.result) ? [c.result] : []),
      ...objects
        .filter((o) => o && typeof o === "object" && !Array.isArray(o))
        .map((o) => (o.payload && typeof o.payload === "object" && !Array.isArray(o.payload) ? o.payload : o)),
    ];
    const missing = requiredFields.filter(
      (field) => !candidateBags.some((bag) => Object.hasOwn(bag, field) && bag[field] !== undefined && bag[field] !== null && bag[field] !== "")
    );
    if (missing.length > 0) {
      pushIssue(
        "missing_contract_fields",
        "output_contract.required_fields",
        `Missing required contract field(s): ${missing.join(", ")}.`,
        `Add ${missing.join(", ")} to task_objects[0].payload (or result).`
      );
    }
  }

  // 5. Run-record structure check (run_record)
  const runRecord =
    (c.run_record && typeof c.run_record === "object" && !Array.isArray(c.run_record) ? c.run_record : null) ||
    objects
      .map((o) => (o && typeof o === "object" && o.payload && typeof o.payload === "object" ? o.payload.run_record : null))
      .find((r) => r && typeof r === "object" && !Array.isArray(r)) ||
    null;
  const requireRunRecord = Boolean(contract?.require_run_record || c.require_run_record === true);
  if (requireRunRecord && !runRecord) {
    pushIssue(
      "missing_run_record",
      "run_record",
      "A structured run_record was requested, and none was supplied.",
      "Attach run_record with exit_code (0), tests_passed, tests_total, and output_digest."
    );
  } else if (runRecord) {
    if (runRecord.exit_code !== undefined && (!Number.isInteger(runRecord.exit_code) || runRecord.exit_code !== 0)) {
      pushIssue(
        "nonzero_run_record_exit",
        "run_record.exit_code",
        `run_record.exit_code is ${String(runRecord.exit_code)} instead of 0.`,
        "Fix the failing command so run_record.exit_code is 0, or give the Task back if blocked."
      );
    }
    if (
      Number.isFinite(runRecord.tests_passed) &&
      Number.isFinite(runRecord.tests_total) &&
      (runRecord.tests_total < 0 || runRecord.tests_passed < 0 || runRecord.tests_passed > runRecord.tests_total)
    ) {
      pushIssue(
        "inconsistent_test_counts",
        "run_record",
        `run_record reports tests_passed=${runRecord.tests_passed} and tests_total=${runRecord.tests_total}.`,
        "Ensure 0 <= tests_passed <= tests_total."
      );
    }
  }

  const strictRequested = Boolean(
    c.strict_contract === true ||
      c.strict_contract === "1" ||
      c.strict_contract === 1 ||
      contract?.strict === true
  );

  return {
    contract_clean: issues.length === 0,
    strict_enforced: strictRequested,
    issues: stripPiiDeep(issues),
  };
}
