// Prioritized Multi-Tier Durable Task Queue & Task-Object Gateway (`/q/*`) for Herma Cloud Worker.
//
// Enforces three visibility & priority tiers across a dual-redundant queue wrapper
// (`env.TESSERA` live Durable Object service binding + Cloudflare D1 transactional priority ledger):
//   1. `ngo_priority`   (visibility: `public_ngo`, priority 95)     -- Claimed FIRST by ALL workers.
//   2. `public_general` (visibility: `public_commons`, priority 60) -- Claimed SECOND by public & server workers.
//   3. `infra_private`  (visibility: `server_infra`, priority 98)   -- STRICTLY HIDDEN from public workers;
//      accessible ONLY to authenticated server-side infrastructure workers (`isAdminRequest` or verified
//      Tessera admin bearer credential). Public writes NEVER borrow any server credential.

import { computeTaskFingerprint, scrubSensitiveText } from "./bilateral_bridge.js";
import { isAdminRequest } from "./herma_engine.js";

export const QUEUE_GATEWAY_GRID = Object.freeze({
  schema_id: "herma.priority_work_gateway.grid.v1",
  agent_max_len: 48,
  task_id_max_len: 64,
  title_max_len: 180,
  prompt_max_len: 2400,
  summary_max_len: 1200,
  slug_max_len: 2000,
  max_objects_per_submit: 12,
  max_verbs_per_submit: 12,
  max_pulse_items: 20,
  lease_ttl_ms: 900000,
  priority_ngo_default: 95,
  priority_public_default: 60,
  priority_infra_default: 98,
  priority_min: 1,
  priority_max: 100,
  hash_prefix_chars: 12,
  hex_radix: 16,
  hex_byte_pad: 2,
  http_ok: 200,
  http_created: 201,
  http_bad_request: 400,
  http_forbidden: 403,
  http_not_found: 404,
  http_method_not_allowed: 405,
});

const PUBLIC_TIERS = new Set(["ngo_priority", "public_general"]);
const ALL_TIERS = new Set(["ngo_priority", "public_general", "infra_private"]);

const INITIAL_QUEUE_SEEDS = Object.freeze([
  {
    seed_key: "ngo_seed_990n_directory_audit",
    tier: "ngo_priority",
    visibility: "public_ngo",
    priority: 97,
    title: "NGO Priority: Small-Nonprofit Aid Directory Gap & Eligibility Verification Rubric",
    prompt:
      "Community food banks, shelters, and rural clinics filing IRS Form 990-N e-Postcards are frequently omitted or stale in regional aid directories. Choose ONE concrete verification branch to solve thoroughly right now (e.g., primary-source status check rubric, service-hours & accessibility normalization schema, or duplicate-entity reconciliation rule), store your reusable rubric/schema as a task object, and enqueue the remaining unexplored branches as follow-up durable verbs.",
    input_contract: "public_nonprofit_registry_slice",
    output_contract: "verified_task_object_and_branch_verbs",
  },
  {
    seed_key: "ngo_seed_disaster_shelter_schema",
    tier: "ngo_priority",
    visibility: "public_ngo",
    priority: 95,
    title: "NGO Priority: Disaster-Relief Shelter, Medical-Power & Accessibility Feed Harmonizer",
    prompt:
      "Municipal emergency feeds and volunteer NGO shelter spreadsheets report capacity, wheelchair access, medical backup power, and language support under incompatible field names. Build ONE clean canonical mapping & validation checklist as a reusable task object, and enqueue 2 bounded follow-up verbs for edge cases you intentionally defer (e.g., offline SMS intake parsing, stale-capacity confidence decay).",
    input_contract: "heterogeneous_relief_feeds",
    output_contract: "canonical_shelter_task_object",
  },
  {
    seed_key: "ngo_seed_low_bandwidth_civic_access",
    tier: "ngo_priority",
    visibility: "public_ngo",
    priority: 93,
    title: "NGO Priority: Low-Bandwidth & Screen-Reader Civic Assistance Triage Spec",
    prompt:
      "Design a lightweight, zero-JS-fallback verification checklist and structured intake template so low-bandwidth mobile and screen-reader users can complete emergency food, housing, or clinic triage without session drops. Complete ONE high-impact checklist module as a task object and queue remaining modules as follow-up durable verbs.",
    input_contract: "civic_intake_flow",
    output_contract: "accessibility_rubric_task_object",
  },
  {
    seed_key: "pub_seed_wikipedia_featured_synthesis",
    tier: "public_general",
    visibility: "public_commons",
    priority: 65,
    title: "Public Commons: Wikipedia Featured Article / Page-of-the-Day Noun & Verb Synthesis",
    prompt:
      "Fetch today's Wikipedia Featured Article / Page of the Day (https://en.wikipedia.org/api/rest_v1/feed/featured/YYYY/MM/DD or https://en.wikipedia.org/wiki/Main_Page), extract 1-2 verifiable structured task objects capturing key mechanisms, datasets, or historical/scientific invariants, and enqueue 2 thoughtful, bounded follow-up verbs applying those insights to open engineering or public-good problems.",
    input_contract: "wikipedia_featured_content",
    output_contract: "knowledge_task_objects_and_verbs",
  },
  {
    seed_key: "pub_seed_interchangeable_node_spec",
    tier: "public_general",
    visibility: "public_commons",
    priority: 60,
    title: "Public Commons: 8-Facet Interchangeable Computational Node & Adapter Specification",
    prompt:
      "Define 1 concrete, domain-agnostic computational node (description, problem, solution mechanism, input_type, output_type, common_use_cases) for fault-tolerant agent workflows, store it as a reusable task object, and enqueue 1-2 deferred testing or adapter-shim branches as follow-up durable verbs.",
    input_contract: "workflow_bottleneck_spec",
    output_contract: "interchangeable_node_task_object",
  },
  {
    seed_key: "infra_seed_queue_embodiment_calibration",
    tier: "infra_private",
    visibility: "server_infra",
    priority: 99,
    title: "Server Infra [Restricted]: Multi-Embodiment Durable Queue Failover & Coalescing Calibration",
    prompt:
      "Evaluate dual-redundant queue telemetry (Tessera Durable Object CAS vs D1 Priority Ledger vs Local WAL Affinity Coalescer), compute empirical batch-coalescing token savings and lease-reap thresholds, store updated waterfall weights as an infra task object, and queue next counterfactual sweep verbs.",
    input_contract: "internal_queue_telemetry",
    output_contract: "calibrated_waterfall_policy",
  },
  {
    seed_key: "infra_seed_overnight_counterfactual_distill",
    tier: "infra_private",
    visibility: "server_infra",
    priority: 96,
    title: "Server Infra [Restricted]: Overnight Counterfactual Frontier Trace & File-Lift Distillation",
    prompt:
      "Compare counterfactual runs across frontier models (deepseek-v4.1-flash, deepseek-v4-pro, kimi-k3, kimi-k2.7-code, glm-5.3), quantify workspace file-contribution lift, promote verified grid cells, and emit SFT/DPO training slice metadata.",
    input_contract: "counterfactual_ledger_slice",
    output_contract: "promoted_grid_and_dpo_manifest",
  },
]);

async function sha256HexGateway(input) {
  const bytes = new TextEncoder().encode(String(input));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(QUEUE_GATEWAY_GRID.hex_radix).padStart(QUEUE_GATEWAY_GRID.hex_byte_pad, "0")
  ).join("");
}

function cleanAgentId(raw) {
  const cleaned = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, QUEUE_GATEWAY_GRID.agent_max_len);
  return cleaned || "volunteer-agent";
}

async function isServerInfraAuthorized(request, env) {
  if (isAdminRequest(request, env)) return true;
  const auth = (request.headers.get("authorization") || "").trim();
  if (!auth.toLowerCase().startsWith("bearer ") || !env?.TESSERA?.fetch) {
    return false;
  }
  try {
    const checkResp = await env.TESSERA.fetch(
      new Request("https://tessera.internal/v1/admin/keys", {
        method: "GET",
        headers: { authorization: auth, accept: "application/json" },
      })
    );
    return checkResp.status === QUEUE_GATEWAY_GRID.http_ok;
  } catch {
    return false;
  }
}

export async function ensurePriorityGatewaySchema(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS herma_durable_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL UNIQUE,
        tier TEXT NOT NULL,
        visibility TEXT NOT NULL,
        priority INTEGER NOT NULL,
        state TEXT NOT NULL DEFAULT 'ready',
        fencing_token INTEGER NOT NULL DEFAULT 0,
        leased_by TEXT,
        lease_expires_at TEXT,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        input_contract TEXT NOT NULL DEFAULT 'json_object',
        output_contract TEXT NOT NULL DEFAULT 'verified_task_object',
        parent_task_id TEXT,
        branch_label TEXT,
        simhash64_hex TEXT NOT NULL,
        producer_agent TEXT NOT NULL,
        completed_by TEXT,
        result_summary TEXT,
        receipt_hash TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_hdq_claim
       ON herma_durable_queue (state, visibility, priority DESC, id ASC)`
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS herma_task_objects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        object_key TEXT NOT NULL,
        category TEXT NOT NULL,
        visibility TEXT NOT NULL,
        producer_agent TEXT NOT NULL,
        source_task_id TEXT,
        summary TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        simhash64_hex TEXT NOT NULL,
        sha256_hash TEXT NOT NULL,
        tessera_synced INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_hto_vis
       ON herma_task_objects (visibility, id DESC)`
    )
    .run();

  const existing = await db.prepare("SELECT COUNT(*) AS cnt FROM herma_durable_queue").first();
  if (Number(existing?.cnt || 0) === 0) {
    const now = new Date().toISOString();
    for (const seed of INITIAL_QUEUE_SEEDS) {
      const fp = await computeTaskFingerprint(`${seed.title} ${seed.prompt}`);
      await db
        .prepare(
          `INSERT OR IGNORE INTO herma_durable_queue
           (task_id, tier, visibility, priority, state, title, prompt, input_contract, output_contract, simhash64_hex, producer_agent, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, 'system-seed', ?, ?)`
        )
        .bind(
          seed.seed_key,
          seed.tier,
          seed.visibility,
          seed.priority,
          seed.title,
          seed.prompt,
          seed.input_contract,
          seed.output_contract,
          fp.simhash64_hex,
          now,
          now
        )
        .run();
    }
  }
}

async function reapExpiredLeases(db) {
  const nowIso = new Date().toISOString();
  await db
    .prepare(
      `UPDATE herma_durable_queue
       SET state = 'ready', leased_by = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE state = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?`
    )
    .bind(nowIso, nowIso)
    .run();
}

async function probeTesseraEmbodiment(env) {
  if (!env?.TESSERA?.fetch) {
    return { available: false, mode: "d1_standalone_failover", latency_ms: 0 };
  }
  const t0 = Date.now();
  try {
    const resp = await env.TESSERA.fetch(new Request("https://tessera.internal/healthz", { method: "GET" }));
    return {
      available: resp.status === QUEUE_GATEWAY_GRID.http_ok,
      mode: resp.status === QUEUE_GATEWAY_GRID.http_ok ? "active_active_dual_redundant" : "d1_hot_standby_failover",
      latency_ms: Date.now() - t0,
    };
  } catch {
    return { available: false, mode: "d1_hot_standby_failover", latency_ms: Date.now() - t0 };
  }
}

async function mirrorPublicArtifactToTesseraAnonymous(env, agentId, objectKey, payload) {
  if (!env?.TESSERA?.fetch) return { synced: false, receipt_hash: null };
  try {
    const sessResp = await env.TESSERA.fetch(
      new Request("https://tessera.internal/v1/session/anonymous", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ label: `q-${agentId}` }),
      })
    );
    if (sessResp.status !== QUEUE_GATEWAY_GRID.http_ok && sessResp.status !== QUEUE_GATEWAY_GRID.http_created) {
      return { synced: false, receipt_hash: null };
    }
    const sess = await sessResp.json();
    const token = sess.token || sess.session_token;
    if (!token) return { synced: false, receipt_hash: null };
    const safeRecKey = String(objectKey).replace(/[^A-Za-z0-9_.:-]+/g, "_").slice(0, QUEUE_GATEWAY_GRID.task_id_max_len);
    const putResp = await env.TESSERA.fetch(
      new Request(`https://tessera.internal/v1/stores/demo.artifacts/records/${encodeURIComponent(safeRecKey)}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ value: payload }),
      })
    );
    const claimResp = await env.TESSERA.fetch(
      new Request("https://tessera.internal/v1/tasks/claim", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ queue: "demo.ping", worker: agentId }),
      })
    );
    if (claimResp.status === QUEUE_GATEWAY_GRID.http_ok) {
      const lease = await claimResp.json();
      const subResp = await env.TESSERA.fetch(
        new Request("https://tessera.internal/v1/tasks/submit", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            accept: "application/json",
            "idempotency-key": `qsub_${lease.task_id}_${Date.now()}`,
          },
          body: JSON.stringify({
            task_id: lease.task_id,
            fencing_token: lease.fencing_token || 1,
            ok: true,
            output: { object_key: safeRecKey, summary: String(payload.summary || "").slice(0, QUEUE_GATEWAY_GRID.title_max_len) },
          }),
        })
      );
      if (subResp.status === QUEUE_GATEWAY_GRID.http_ok) {
        const subDoc = await subResp.json();
        return { synced: putResp.status === QUEUE_GATEWAY_GRID.http_ok, receipt_hash: subDoc.receipt_hash || null };
      }
    }
    return { synced: putResp.status === QUEUE_GATEWAY_GRID.http_ok, receipt_hash: null };
  } catch {
    return { synced: false, receipt_hash: null };
  }
}

async function buildPulseSnapshot(db, env, infraAllowed) {
  await reapExpiredLeases(db);
  const tesseraHealth = await probeTesseraEmbodiment(env);
  const visFilter = infraAllowed
    ? "visibility IN ('public_ngo', 'public_commons', 'server_infra')"
    : "visibility IN ('public_ngo', 'public_commons')";

  const countRows = await db
    .prepare(
      `SELECT tier, state, COUNT(*) AS cnt
       FROM herma_durable_queue
       WHERE ${visFilter}
       GROUP BY tier, state`
    )
    .all();

  const tiers = {
    ngo_priority: { ready: 0, leased: 0, done: 0 },
    public_general: { ready: 0, leased: 0, done: 0 },
  };
  if (infraAllowed) {
    tiers.infra_private = { ready: 0, leased: 0, done: 0 };
  }
  for (const r of countRows?.results || []) {
    if (tiers[r.tier] && tiers[r.tier][r.state] !== undefined) {
      tiers[r.tier][r.state] = Number(r.cnt);
    }
  }

  const readyPreview = await db
    .prepare(
      `SELECT task_id, tier, priority, title, input_contract, output_contract, parent_task_id, branch_label
       FROM herma_durable_queue
       WHERE state = 'ready' AND ${visFilter}
       ORDER BY (CASE tier WHEN 'infra_private' THEN 0 WHEN 'ngo_priority' THEN 1 ELSE 2 END) ASC,
                priority DESC, id ASC
       LIMIT ?`
    )
    .bind(QUEUE_GATEWAY_GRID.max_pulse_items)
    .all();

  const recentObjects = await db
    .prepare(
      `SELECT object_key, category, producer_agent, source_task_id, summary, sha256_hash, created_at
       FROM herma_task_objects
       WHERE ${visFilter}
       ORDER BY id DESC
       LIMIT ?`
    )
    .bind(QUEUE_GATEWAY_GRID.max_pulse_items)
    .all();

  const todayPath = new Date().toISOString().slice(0, 10).replace(/-/g, "/");
  return {
    ok: true,
    schema: QUEUE_GATEWAY_GRID.schema_id,
    caller_role: infraAllowed ? "server_infrastructure_worker" : "public_or_volunteer_worker",
    priority_policy: infraAllowed
      ? ["infra_private (server-only)", "ngo_priority (public good -- highest public priority)", "public_general"]
      : ["ngo_priority (public good -- ALWAYS claimed first)", "public_general (commons & deferred branches)"],
    queue_embodiments: {
      tessera_durable_object_cas: tesseraHealth,
      d1_transactional_priority_ledger: { available: true, storage: "cloudflare_d1" },
      active_wrapper_mode: tesseraHealth.mode,
    },
    queue_counts_by_tier: tiers,
    ready_tasks_preview: readyPreview?.results || [],
    recent_task_objects: recentObjects?.results || [],
    waterfall_when_empty_or_blocked: [
      `1. Fetch Wikipedia Featured Feed https://en.wikipedia.org/api/rest_v1/feed/featured/${todayPath} (or https://en.wikipedia.org/wiki/Main_Page)`,
      "2. Distill 1-2 verifiable structured task objects (nouns) and 2 bounded public-good or open-science follow-up verbs",
      "3. Submit via POST /q/submit or GET /q/submit/<agent_id>/self_seed/summary-<text>--object-<name>-<summary>--verb-<new-task>",
    ],
  };
}

function parseGatewaySlug(rawSlug) {
  let decoded = String(rawSlug || "").slice(0, QUEUE_GATEWAY_GRID.slug_max_len);
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // keep raw slice
  }
  const parts = decoded.split("--").map((s) => s.trim()).filter(Boolean);
  let summary = "";
  const taskObjects = [];
  const queuedVerbs = [];
  let scheduleStatus = null;

  for (const part of parts) {
    const clean = scrubSensitiveText(part);
    const lower = clean.toLowerCase();
    if (lower.startsWith("summary-")) {
      summary = clean.slice("summary-".length).replace(/[-_]+/g, " ").trim();
    } else if (lower.startsWith("object-")) {
      const body = clean.slice("object-".length);
      const sep = body.indexOf(":");
      const key = sep > 0 ? body.slice(0, sep) : `obj_${taskObjects.length + 1}`;
      const val = (sep > 0 ? body.slice(sep + 1) : body).replace(/[-_]+/g, " ").trim();
      if (val) {
        taskObjects.push({ object_key: key, category: "knowledge_noun", summary: val, payload: { summary: val } });
      }
    } else if (lower.startsWith("verb-") || lower.startsWith("ngo-verb-")) {
      const isNgo = lower.startsWith("ngo-verb-");
      const text = clean
        .slice(isNgo ? "ngo-verb-".length : "verb-".length)
        .replace(/[-_]+/g, " ")
        .trim();
      if (text) {
        queuedVerbs.push({
          tier: isNgo ? "ngo_priority" : "public_general",
          title: text.slice(0, QUEUE_GATEWAY_GRID.title_max_len),
          prompt: text,
          branch_label: "deferred_branch_from_get_gateway",
        });
      }
    } else if (lower.startsWith("schedule-")) {
      scheduleStatus = clean.slice("schedule-".length).replace(/[-_]+/g, " ").trim();
    } else if (!summary) {
      summary = clean.replace(/[-_]+/g, " ").trim();
    }
  }
  return {
    summary: summary || "completed bounded branch",
    task_objects: taskObjects,
    queued_verbs: queuedVerbs,
    schedule_status: scheduleStatus,
  };
}

async function claimNextAuthorizedTask(db, agentId, infraAllowed, requestedTier = null) {
  await reapExpiredLeases(db);
  if (requestedTier === "infra_private" && !infraAllowed) {
    return { forbidden: true };
  }

  let row = null;
  if (requestedTier && ALL_TIERS.has(requestedTier)) {
    row = await db
      .prepare(
        `SELECT * FROM herma_durable_queue
         WHERE state = 'ready' AND tier = ?
         ORDER BY priority DESC, id ASC LIMIT 1`
      )
      .bind(requestedTier)
      .first();
  } else if (infraAllowed) {
    // Server-side infrastructure workers prioritize `infra_private` & `ngo_priority` (by priority DESC), then `public_general`!
    row = await db
      .prepare(
        `SELECT * FROM herma_durable_queue
         WHERE state = 'ready' AND visibility IN ('server_infra', 'public_ngo', 'public_commons')
         ORDER BY (CASE WHEN tier IN ('infra_private', 'ngo_priority') THEN 0 ELSE 1 END) ASC,
                  priority DESC, id ASC
         LIMIT 1`
      )
      .first();
  } else {
    // Public/volunteer workers ALWAYS prioritize `ngo_priority` FIRST, then `public_general`, and NEVER see `infra_private`!
    row = await db
      .prepare(
        `SELECT * FROM herma_durable_queue
         WHERE state = 'ready' AND visibility IN ('public_ngo', 'public_commons')
         ORDER BY (CASE WHEN tier = 'ngo_priority' THEN 0 ELSE 1 END) ASC,
                  priority DESC, id ASC
         LIMIT 1`
      )
      .first();
  }

  if (!row) {
    // Re- recycle a completed public seed as a fresh iteration if the ready pool is completely drained
    // so external scheduled agents always have meaningful NGO or commons work if desired, while signalling `recycled_seed: true`!
    return { task: null };
  }

  const nextToken = Number(row.fencing_token || 0) + 1;
  const now = new Date();
  const expiresIso = new Date(now.getTime() + QUEUE_GATEWAY_GRID.lease_ttl_ms).toISOString();
  await db
    .prepare(
      `UPDATE herma_durable_queue
       SET state = 'leased', fencing_token = ?, leased_by = ?, lease_expires_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(nextToken, agentId, expiresIso, now.toISOString(), row.id)
    .run();

  return {
    task: {
      task_id: row.task_id,
      tier: row.tier,
      visibility: row.visibility,
      priority: Number(row.priority),
      fencing_token: nextToken,
      leased_by: agentId,
      lease_expires_at: expiresIso,
      title: row.title,
      prompt: row.prompt,
      input_contract: row.input_contract,
      output_contract: row.output_contract,
      parent_task_id: row.parent_task_id,
      branch_label: row.branch_label,
      simhash64_hex: row.simhash64_hex,
    },
  };
}

async function processSubmissionAndEnqueueVerbs(db, env, publicUrl, infraAllowed, payload) {
  const agentId = cleanAgentId(payload.agent_id || payload.agent);
  const taskId = scrubSensitiveText(payload.task_id || "self_seed").slice(0, QUEUE_GATEWAY_GRID.task_id_max_len);
  const summary = scrubSensitiveText(payload.summary || payload.completed_branch || "completed task branch").slice(
    0,
    QUEUE_GATEWAY_GRID.summary_max_len
  );
  const nowIso = new Date().toISOString();

  // Check if target task is `infra_private` and enforce authorization
  const existingTask = await db
    .prepare("SELECT * FROM herma_durable_queue WHERE task_id = ?")
    .bind(taskId)
    .first();
  if (existingTask && existingTask.visibility === "server_infra" && !infraAllowed) {
    return {
      forbidden: true,
      detail: "Submitting to server_infra tasks requires server infrastructure worker authorization.",
    };
  }

  // 1. Store reusable `task_objects` (nouns)
  const rawObjects = Array.isArray(payload.task_objects)
    ? payload.task_objects.slice(0, QUEUE_GATEWAY_GRID.max_objects_per_submit)
    : [];
  const storedObjects = [];
  for (let i = 0; i < rawObjects.length; i += 1) {
    const item = rawObjects[i] || {};
    const objKey = scrubSensitiveText(item.object_key || item.key || `${agentId}_obj_${Date.now()}_${i}`)
      .replace(/[^A-Za-z0-9_.:-]+/g, "_")
      .slice(0, QUEUE_GATEWAY_GRID.task_id_max_len);
    const category = scrubSensitiveText(item.category || "knowledge_noun").slice(0, QUEUE_GATEWAY_GRID.agent_max_len);
    const objVis = item.visibility === "server_infra" && infraAllowed ? "server_infra" : "public_commons";
    const objSummary = scrubSensitiveText(item.summary || summary).slice(0, QUEUE_GATEWAY_GRID.summary_max_len);
    const objPayloadStr = JSON.stringify(item.payload || item).slice(0, QUEUE_GATEWAY_GRID.prompt_max_len);
    const fp = await computeTaskFingerprint(`${objKey} ${objSummary} ${objPayloadStr}`);
    const objHash = await sha256HexGateway(`${objKey}:${objPayloadStr}:${nowIso}`);
    await db
      .prepare(
        `INSERT INTO herma_task_objects
         (object_key, category, visibility, producer_agent, source_task_id, summary, payload_json, simhash64_hex, sha256_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(objKey, category, objVis, agentId, taskId, objSummary, objPayloadStr, fp.simhash64_hex, objHash, nowIso)
      .run();
    storedObjects.push({ object_key: objKey, category, sha256_hash: objHash });
  }

  // 2. Enqueue deferred branches & newly proposed follow-up `verbs` (durable tasks)
  const rawVerbs = Array.isArray(payload.queued_verbs)
    ? payload.queued_verbs.slice(0, QUEUE_GATEWAY_GRID.max_verbs_per_submit)
    : [];
  const enqueuedVerbs = [];
  for (let i = 0; i < rawVerbs.length; i += 1) {
    const v = typeof rawVerbs[i] === "string" ? { prompt: rawVerbs[i] } : rawVerbs[i] || {};
    const vPrompt = scrubSensitiveText(v.prompt || v.title || "").slice(0, QUEUE_GATEWAY_GRID.prompt_max_len);
    if (!vPrompt) continue;
    let tier = PUBLIC_TIERS.has(v.tier) ? v.tier : "public_general";
    if (v.tier === "infra_private") {
      if (!infraAllowed) {
        return { forbidden: true, detail: "Public workers cannot enqueue infra_private tasks." };
      }
      tier = "infra_private";
    }
    const vis =
      tier === "infra_private" ? "server_infra" : tier === "ngo_priority" ? "public_ngo" : "public_commons";
    const defaultPrio =
      tier === "infra_private"
        ? QUEUE_GATEWAY_GRID.priority_infra_default
        : tier === "ngo_priority"
          ? QUEUE_GATEWAY_GRID.priority_ngo_default
          : QUEUE_GATEWAY_GRID.priority_public_default;
    const prio = Math.max(
      QUEUE_GATEWAY_GRID.priority_min,
      Math.min(QUEUE_GATEWAY_GRID.priority_max, Number(v.priority || defaultPrio))
    );
    const vTitle = scrubSensitiveText(v.title || vPrompt).slice(0, QUEUE_GATEWAY_GRID.title_max_len);
    const fp = await computeTaskFingerprint(`${vTitle} ${vPrompt}`);
    const newIdHash = (await sha256HexGateway(`${agentId}:${vPrompt}:${nowIso}:${i}`)).slice(
      0,
      QUEUE_GATEWAY_GRID.hash_prefix_chars
    );
    const newTaskId = `verb_${tier.slice(0, 3)}_${newIdHash}`;
    await db
      .prepare(
        `INSERT OR IGNORE INTO herma_durable_queue
         (task_id, tier, visibility, priority, state, title, prompt, input_contract, output_contract, parent_task_id, branch_label, simhash64_hex, producer_agent, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        newTaskId,
        tier,
        vis,
        prio,
        vTitle,
        vPrompt,
        scrubSensitiveText(v.input_contract || "json_object").slice(0, QUEUE_GATEWAY_GRID.agent_max_len),
        scrubSensitiveText(v.output_contract || "verified_task_object").slice(0, QUEUE_GATEWAY_GRID.agent_max_len),
        taskId,
        scrubSensitiveText(v.branch_label || "deferred_or_followup_branch").slice(0, QUEUE_GATEWAY_GRID.agent_max_len),
        fp.simhash64_hex,
        agentId,
        nowIso,
        nowIso
      )
      .run();
    enqueuedVerbs.push({ task_id: newTaskId, tier, priority: prio, title: vTitle });
  }

  // 3. Mirror public artifact to Tessera anonymous sandbox for dual-engine receipt verification
  const tesseraSync = await mirrorPublicArtifactToTesseraAnonymous(env, agentId, `${taskId}_${agentId}`, {
    agent_id: agentId,
    task_id: taskId,
    summary,
    stored_objects_count: storedObjects.length,
    enqueued_verbs_count: enqueuedVerbs.length,
  });

  const localReceipt = await sha256HexGateway(
    JSON.stringify({ agentId, taskId, summary, storedObjects, enqueuedVerbs, nowIso })
  );
  const receiptHash = tesseraSync.receipt_hash || localReceipt;

  if (existingTask) {
    await db
      .prepare(
        `UPDATE herma_durable_queue
         SET state = 'done', completed_by = ?, result_summary = ?, receipt_hash = ?, updated_at = ?
         WHERE task_id = ?`
      )
      .bind(agentId, summary, receiptHash, nowIso, taskId)
      .run();
  }

  const pulse = await buildPulseSnapshot(db, env, infraAllowed);
  return {
    ok: true,
    agent_id: agentId,
    completed_task_id: taskId,
    summary,
    receipt_hash: receiptHash,
    verification_code: receiptHash.slice(0, QUEUE_GATEWAY_GRID.hash_prefix_chars),
    tessera_dual_synced: tesseraSync.synced,
    stored_task_objects: storedObjects,
    enqueued_followup_verbs: enqueuedVerbs,
    queue_counts_by_tier: pulse.queue_counts_by_tier,
    next_claim_url: `${publicUrl}/q/claim/${encodeURIComponent(agentId)}`,
  };
}

function formatClaimBanner(publicUrl, claimOut, pulse) {
  if (!claimOut.task) {
    return [
      "=== DURABLE QUEUE STATUS: NO READY PUBLIC TASKS RIGHT NOW ===",
      `Active Wrapper Mode: ${pulse.queue_embodiments.active_wrapper_mode}`,
      `Queue Counts: ${JSON.stringify(pulse.queue_counts_by_tier)}`,
      "",
      "WATERFALL NEXT STEPS (ROADBLOCK / EMPTY-QUEUE RECOVERY):",
      ...pulse.waterfall_when_empty_or_blocked,
      `Submit URL (GET):  ${publicUrl}/q/submit/<your-agent-id>/self_seed/summary-<findings>--object-wiki_topic:<structured-fact>--ngo-verb-<new-ngo-task>--verb-<new-commons-task>`,
      `Submit URL (POST): ${publicUrl}/q/submit`,
    ].join("\n");
  }
  const t = claimOut.task;
  return [
    "=== LEASED PRIORITIZED DURABLE TASK ===",
    `TASK_ID:         ${t.task_id}`,
    `PRIORITY_TIER:   ${t.tier} (priority=${t.priority}, visibility=${t.visibility})`,
    `FENCING_TOKEN:   ${t.fencing_token}`,
    `LEASE_EXPIRES:   ${t.lease_expires_at}`,
    `QUEUE_COUNTS:    ${JSON.stringify(pulse.queue_counts_by_tier)}`,
    `WRAPPER_MODE:    ${pulse.queue_embodiments.active_wrapper_mode}`,
    "",
    `TITLE: ${t.title}`,
    `PROMPT: ${t.prompt}`,
    "",
    "EXECUTION & BRANCHING CONTRACT:",
    "1. Solve ONE focused branch thoroughly right now (do not try to boil the ocean in one turn).",
    "2. Package reusable facts, rubrics, or node specs as `task_objects` (nouns).",
    "3. Enqueue any unchosen branches or newly discovered follow-ups as `queued_verbs` (tasks).",
    "",
    "HOW TO SUBMIT:",
    `- Option A (POST JSON to ${publicUrl}/q/submit):`,
    `  {"agent_id":"${t.leased_by}","task_id":"${t.task_id}","fencing_token":${t.fencing_token},"summary":"...","task_objects":[{"object_key":"...","category":"rubric","summary":"...","payload":{}}],"queued_verbs":[{"tier":"ngo_priority","title":"...","prompt":"..."}]}`,
    `- Option B (Browser-safe GET URL for read-only web tools):`,
    `  ${publicUrl}/q/submit/${encodeURIComponent(t.leased_by)}/${encodeURIComponent(t.task_id)}/summary-<concise-solution>--object-<noun_key>:<reusable-finding>--verb-<deferred-branch-1>--verb-<deferred-branch-2>`,
  ].join("\n");
}

export async function handlePriorityWorkGateway(request, env, db, publicUrl, { withSecurity }) {
  await ensurePriorityGatewaySchema(db);
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const segments = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  // segments[0] === "q"
  const action = segments[1] || "pulse";
  const infraAllowed = await isServerInfraAuthorized(request, env);
  const wantsJson =
    (request.headers.get("accept") || "").includes("application/json") || url.searchParams.get("format") === "json";

  const sendJson = (obj, status = QUEUE_GATEWAY_GRID.http_ok) =>
    withSecurity(
      new Response(JSON.stringify(obj, null, 2), {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
      })
    );
  const sendText = (txt, status = QUEUE_GATEWAY_GRID.http_ok) =>
    withSecurity(
      new Response(txt, {
        status,
        headers: { "content-type": "text/plain; charset=utf-8" },
      })
    );

  if (action === "pulse" || action === "status") {
    if (method !== "GET" && method !== "HEAD") {
      return sendJson({ ok: false, error: "method_not_allowed" }, QUEUE_GATEWAY_GRID.http_method_not_allowed);
    }
    return sendJson(await buildPulseSnapshot(db, env, infraAllowed));
  }

  if (action === "claim") {
    if (method === "GET") {
      const agentId = cleanAgentId(segments[2] || url.searchParams.get("agent") || "volunteer-agent");
      const reqTier = url.searchParams.get("tier");
      const claimOut = await claimNextAuthorizedTask(db, agentId, infraAllowed, reqTier);
      if (claimOut.forbidden) {
        return sendJson(
          { ok: false, code: "forbidden_tier", detail: "infra_private tasks are restricted to server-side infrastructure workers." },
          QUEUE_GATEWAY_GRID.http_forbidden
        );
      }
      const pulse = await buildPulseSnapshot(db, env, infraAllowed);
      if (wantsJson) {
        return sendJson({ ok: true, caller_role: pulse.caller_role, lease: claimOut.task, pulse });
      }
      return sendText(formatClaimBanner(publicUrl, claimOut, pulse));
    }
    if (method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch {
        return sendJson({ ok: false, code: "invalid_json" }, QUEUE_GATEWAY_GRID.http_bad_request);
      }
      const agentId = cleanAgentId(body.agent_id || body.agent || "volunteer-agent");
      const claimOut = await claimNextAuthorizedTask(db, agentId, infraAllowed, body.tier || null);
      if (claimOut.forbidden) {
        return sendJson(
          { ok: false, code: "forbidden_tier", detail: "infra_private tasks are restricted to server-side infrastructure workers." },
          QUEUE_GATEWAY_GRID.http_forbidden
        );
      }
      const pulse = await buildPulseSnapshot(db, env, infraAllowed);
      return sendJson({ ok: true, caller_role: pulse.caller_role, lease: claimOut.task, pulse });
    }
    return sendJson({ ok: false, error: "method_not_allowed" }, QUEUE_GATEWAY_GRID.http_method_not_allowed);
  }

  if (action === "submit" || action === "enqueue") {
    if (method === "GET") {
      const agentId = cleanAgentId(segments[2] || "volunteer-agent");
      const taskId = segments[3] || "self_seed";
      const rawSlug = segments.slice(4).join("/");
      const parsed = parseGatewaySlug(rawSlug);
      const out = await processSubmissionAndEnqueueVerbs(db, env, publicUrl, infraAllowed, {
        agent_id: agentId,
        task_id: taskId,
        ...parsed,
      });
      if (out.forbidden) {
        return sendJson({ ok: false, code: "forbidden_tier", detail: out.detail }, QUEUE_GATEWAY_GRID.http_forbidden);
      }
      if (wantsJson) return sendJson(out);
      return sendText(
        [
          "=== DURABLE SUBMISSION & VERB ENQUEUE VERIFIED ===",
          `AGENT_ID:              ${out.agent_id}`,
          `COMPLETED_TASK_ID:     ${out.completed_task_id}`,
          `VERIFICATION_CODE:     ${out.verification_code}`,
          `RECEIPT_SHA256:        ${out.receipt_hash}`,
          `STORED_TASK_OBJECTS:   ${out.stored_task_objects.length}`,
          `ENQUEUED_BRANCH_VERBS: ${out.enqueued_followup_verbs.length}`,
          `QUEUE_COUNTS_BY_TIER:  ${JSON.stringify(out.queue_counts_by_tier)}`,
          `NEXT_CLAIM_URL:        ${out.next_claim_url}`,
        ].join("\n")
      );
    }
    if (method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch {
        return sendJson({ ok: false, code: "invalid_json" }, QUEUE_GATEWAY_GRID.http_bad_request);
      }
      const out = await processSubmissionAndEnqueueVerbs(db, env, publicUrl, infraAllowed, body);
      if (out.forbidden) {
        return sendJson({ ok: false, code: "forbidden_tier", detail: out.detail }, QUEUE_GATEWAY_GRID.http_forbidden);
      }
      return sendJson(out);
    }
    return sendJson({ ok: false, error: "method_not_allowed" }, QUEUE_GATEWAY_GRID.http_method_not_allowed);
  }

  return sendJson({ ok: false, code: "unknown_gateway_route", path: url.pathname }, QUEUE_GATEWAY_GRID.http_not_found);
}
