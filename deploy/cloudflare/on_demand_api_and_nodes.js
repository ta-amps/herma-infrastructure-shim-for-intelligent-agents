// Universal On-Demand TaskObject API Runtime, Scoped Key Vault & Swappable Backend Engine Slots
// for Herma Cloud Worker (`deploy/cloudflare/on_demand_api_and_nodes.js`).
//
// Architectural invariants (`AGENTS.md` + Rules 01 & 02):
// 1. Zero new task or policy authorities: On-demand API endpoints and swappable engine profiles
//    are standard content-addressed `Task Objects` (`herma_task_objects`), and async bulkhead
//    escalations enqueue standard fenced `Tasks` (`herma_durable_queue`).
// 2. Zero hardcoded operational magic numbers: All thresholds, crossover ratios, capacities,
//    rate limits, margins, and UCB/Wilson parameters live in `ON_DEMAND_API_GRID` and
//    `SWAPPABLE_SLOT_SEEDS` (`NodeGrid` + `GridLedger` + `ParameterBounds`).
// 3. Domain-agnostic universal primitives only (`entity`, `record`, `snapshot`, `delta`,
//    `endpoint`, `scoped_key`, `swappable_node`, `slot`, `gate`, `short_circuit`).
// 4. Zero arbitrary code execution (`eval` / `new Function` forbidden) and zero plaintext secret
//    storage (only SHA-256 digests + prefixes + scoped ACLs stored in `herma_scoped_keys`).

import { scrubSensitiveText } from "./bilateral_bridge.js";

export const ON_DEMAND_API_GRID = Object.freeze({
  schema_id: "herma.on_demand_api_and_swappable_nodes.grid.v1",
  http_ok: 200,
  http_created: 201,
  http_accepted: 202,
  http_bad_request: 400,
  http_unauthorized: 401,
  http_forbidden: 403,
  http_not_found: 404,
  http_method_not_allowed: 405,
  http_conflict: 409,
  http_rate_limited: 429,
  key_random_bytes: 24,
  key_id_random_bytes: 8,
  key_prefix_visible_len: 14,
  max_label_len: 120,
  max_scopes_count: 24,
  max_allowed_endpoints: 64,
  default_worker_rpm: 240,
  default_endpoint_rpm: 600,
  default_infra_rpm: 2400,
  min_rpm_bound: 1,
  max_rpm_bound: 100000,
  rpm_window_ms: 60000,
  singleflight_memo_max_entries: 256,
  singleflight_memo_ttl_ms: 15000,
  dirty_crossover_threshold: 0.62,
  default_fuzzy_top2_margin: 0.14,
  default_fuzzy_min_top1: 0.32,
  default_async_complexity_threshold: 0.78,
  max_records_per_endpoint: 5000,
  max_result_limit: 250,
  default_result_limit: 25,
  max_delta_batch_read: 2000,
  max_delta_json_bytes: 65536,
  max_expr_len: 256,
  max_expr_tokens: 64,
  trigram_width: 3,
  edit_distance_cap: 2,
  edit_word_min_len: 4,
  wilson_z: 1.96,
  wilson_prior_milli: 750,
  milli_scale: 1000,
  ewma_alpha: 0.25,
  ucb_exploration_alpha: 0.08,
  min_verified_calls_for_autotune: 3,
  invocation_log_limit: 100,
  async_task_priority_base: 82,
});

const INITIALIZED_ON_DEMAND_DBS = new WeakSet();
const IN_FLIGHT_SINGLEFLIGHT = new Map();
const WATERMARK_MEMO_CACHE = new Map();
const EPHEMERAL_RATE_BUCKETS = new Map();

const VALID_KEY_CLASSES = new Set(["worker", "endpoint", "infra"]);
const VALID_AUTH_MODES = new Set(["public", "worker_key", "endpoint_key", "infra_key"]);
const VALID_DELTA_OPS = new Set(["patch", "upsert", "increment", "delete"]);
const VALID_LEDGER_STAGES = new Set([
  "represented",
  "applicable",
  "proposed",
  "dispatched",
  "evaluated",
  "verified",
  "promoted",
]);

const DEFAULT_SCOPES_BY_CLASS = Object.freeze({
  worker: Object.freeze([
    "queue:claim",
    "queue:submit",
    "objects:write",
    "api:publish",
    "api:invoke",
    "api:write_delta",
    "nodes:propose",
  ]),
  endpoint: Object.freeze(["api:invoke"]),
  infra: Object.freeze([
    "infra:private_queue",
    "infra:read_telemetry",
    "infra:manage_nodes",
    "infra:rotate_keys",
    "api:publish",
    "api:invoke",
    "api:write_delta",
    "api:compact",
  ]),
});

export const SWAPPABLE_SLOT_SEEDS = Object.freeze([
  {
    slot_id: "ranking",
    parameter_bounds: {
      lexical_weight: { min: 0.0, max: 1.0 },
      fuzzy_weight: { min: 0.0, max: 1.0 },
      quality_weight: { min: 0.0, max: 1.0 },
      freshness_weight: { min: 0.0, max: 1.0 },
    },
    candidates: [
      {
        node_id: "rank_hybrid_bm25_lsh_wilson_v1",
        display_name: "Hybrid BM25 + LSH + Wilson-LCB Quality Ranker",
        algorithm_family: "hybrid_lexical_lsh_wilson",
        is_active: 1,
        ledger_stage: "promoted",
        grid_params: {
          lexical_weight: 0.46,
          fuzzy_weight: 0.24,
          quality_weight: 0.2,
          freshness_weight: 0.1,
        },
      },
      {
        node_id: "rank_rrf_reciprocal_fusion_v1",
        display_name: "Reciprocal Rank Fusion (Lexical + Trigram + Reuse)",
        algorithm_family: "reciprocal_rank_fusion",
        is_active: 0,
        ledger_stage: "verified",
        grid_params: {
          lexical_weight: 0.38,
          fuzzy_weight: 0.32,
          quality_weight: 0.22,
          freshness_weight: 0.08,
        },
      },
      {
        node_id: "rank_freshness_velocity_boost_v1",
        display_name: "Velocity & Recency Boosted Discovery Ranker",
        algorithm_family: "velocity_recency_weighted",
        is_active: 0,
        ledger_stage: "verified",
        grid_params: {
          lexical_weight: 0.4,
          fuzzy_weight: 0.18,
          quality_weight: 0.14,
          freshness_weight: 0.28,
        },
      },
    ],
  },
  {
    slot_id: "evaluation",
    parameter_bounds: {
      min_quorum_reviews: { min: 1, max: 16 },
      wilson_z: { min: 1.0, max: 3.0 },
      novelty_blend: { min: 0.0, max: 1.0 },
    },
    candidates: [
      {
        node_id: "eval_wilson_lcb_blind_quorum_v1",
        display_name: "Wilson Lower-Confidence-Bound Multi-Reviewer Aggregator",
        algorithm_family: "wilson_lcb_quorum",
        is_active: 1,
        ledger_stage: "promoted",
        grid_params: { min_quorum_reviews: 2, wilson_z: 1.96, novelty_blend: 0.25 },
      },
      {
        node_id: "eval_persona_pareto_veto_v1",
        display_name: "Multi-Persona Pareto Utility + Hard-Safety Veto Judge",
        algorithm_family: "persona_pareto_veto",
        is_active: 0,
        ledger_stage: "verified",
        grid_params: { min_quorum_reviews: 3, wilson_z: 2.24, novelty_blend: 0.3 },
      },
    ],
  },
  {
    slot_id: "prioritization",
    parameter_bounds: {
      ngo_boost: { min: 0.0, max: 100.0 },
      aging_per_hour: { min: 0.0, max: 25.0 },
      capability_match_weight: { min: 0.0, max: 1.0 },
    },
    candidates: [
      {
        node_id: "prio_public_good_aging_capability_v1",
        display_name: "NGO-First Priority + Starvation Aging + Capability Fit",
        algorithm_family: "tiered_aging_capability",
        is_active: 1,
        ledger_stage: "promoted",
        grid_params: { ngo_boost: 35.0, aging_per_hour: 2.5, capability_match_weight: 0.35 },
      },
      {
        node_id: "prio_voi_blocker_unblock_v1",
        display_name: "Value-of-Information DAG Unblocker Priority Engine",
        algorithm_family: "voi_dag_unblocker",
        is_active: 0,
        ledger_stage: "verified",
        grid_params: { ngo_boost: 30.0, aging_per_hour: 4.0, capability_match_weight: 0.45 },
      },
    ],
  },
  {
    slot_id: "search_retrieval",
    parameter_bounds: {
      symspell_max_edits: { min: 0, max: 2 },
      lsh_band_candidates: { min: 8, max: 256 },
      trigram_floor: { min: 0.05, max: 0.8 },
    },
    candidates: [
      {
        node_id: "retr_dual_symspell_simhash_trigram_v1",
        display_name: "Dual-Side SymSpell + SimHash LSH + Trigram Retriever",
        algorithm_family: "symspell_lsh_trigram",
        is_active: 1,
        ledger_stage: "promoted",
        grid_params: { symspell_max_edits: 2, lsh_band_candidates: 64, trigram_floor: 0.15 },
      },
      {
        node_id: "retr_strict_facet_prefix_pushdown_v1",
        display_name: "Strict Facet + Prefix SQL Pushdown Retriever",
        algorithm_family: "sql_facet_pushdown",
        is_active: 0,
        ledger_stage: "verified",
        grid_params: { symspell_max_edits: 1, lsh_band_candidates: 32, trigram_floor: 0.28 },
      },
    ],
  },
  {
    slot_id: "keyword_intent",
    parameter_bounds: {
      max_phrases: { min: 4, max: 64 },
      identifier_boost: { min: 1.0, max: 4.0 },
    },
    candidates: [
      {
        node_id: "kw_snake_camel_phrase_shingler_v1",
        display_name: "Identifier-Aware Snake/Camel + Bigram Phrase Extractor",
        algorithm_family: "identifier_phrase_shingler",
        is_active: 1,
        ledger_stage: "promoted",
        grid_params: { max_phrases: 24, identifier_boost: 1.8 },
      },
    ],
  },
  {
    slot_id: "threshold_calibrator",
    parameter_bounds: {
      dirty_crossover_threshold: { min: 0.1, max: 0.95 },
      fuzzy_top2_margin: { min: 0.02, max: 0.6 },
      async_complexity_threshold: { min: 0.3, max: 0.99 },
    },
    candidates: [
      {
        node_id: "thresh_calibrated_7gate_margins_v1",
        display_name: "Calibrated 7-Gate Crossover (0.62 Dirty / 0.14 Top-2 Margin)",
        algorithm_family: "platt_margin_crossover",
        is_active: 1,
        ledger_stage: "promoted",
        grid_params: {
          dirty_crossover_threshold: 0.62,
          fuzzy_top2_margin: 0.14,
          async_complexity_threshold: 0.78,
        },
      },
      {
        node_id: "thresh_conservative_high_precision_v1",
        display_name: "High-Precision Conservative Short-Circuit Thresholds",
        algorithm_family: "high_precision_margin",
        is_active: 0,
        ledger_stage: "verified",
        grid_params: {
          dirty_crossover_threshold: 0.5,
          fuzzy_top2_margin: 0.24,
          async_complexity_threshold: 0.68,
        },
      },
    ],
  },
  {
    slot_id: "short_circuit_router",
    parameter_bounds: {
      enable_sc0_negative: { min: 0, max: 1 },
      enable_sc1_singleflight: { min: 0, max: 1 },
      enable_sc2_lambda_delta: { min: 0, max: 1 },
      enable_sc4_fuzzy_margin: { min: 0, max: 1 },
      enable_sc6_async_bulkhead: { min: 0, max: 1 },
    },
    candidates: [
      {
        node_id: "router_onion_7gate_lambda_delta_bulkhead_v1",
        display_name: "5-Ring Onion + 7-Gate Progressive Short-Circuit & 202 Bulkhead",
        algorithm_family: "onion_7gate_progressive",
        is_active: 1,
        ledger_stage: "promoted",
        grid_params: {
          enable_sc0_negative: 1,
          enable_sc1_singleflight: 1,
          enable_sc2_lambda_delta: 1,
          enable_sc4_fuzzy_margin: 1,
          enable_sc6_async_bulkhead: 1,
        },
      },
    ],
  },
]);

function randomHexBytes(byteCount) {
  return Array.from(crypto.getRandomValues(new Uint8Array(byteCount)), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

async function sha256HexLocal(input) {
  const bytes = new TextEncoder().encode(String(input || ""));
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function clampNumeric(value, minVal, maxVal) {
  const num = Number(value);
  if (!Number.isFinite(num)) return minVal;
  if (num < minVal) return minVal;
  if (num > maxVal) return maxVal;
  return num;
}

function computeWilsonLcbMilli(successes, total, z = ON_DEMAND_API_GRID.wilson_z) {
  const n = Number(total || 0);
  if (n <= 0) return ON_DEMAND_API_GRID.wilson_prior_milli;
  const s = clampNumeric(Number(successes || 0), 0, n);
  const p = s / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  const lcb = clampNumeric((center - spread) / denom, 0.0, 1.0);
  return Math.round(lcb * ON_DEMAND_API_GRID.milli_scale);
}

export function containsRawCapabilitySecret(rawText) {
  const s = String(rawText || "");
  return /\b(?:hk_(?:wrk|ep|inf)_[a-f0-9]{24,}|wt_[a-f0-9]{24,})\b/i.test(s);
}

export async function ensureOnDemandApiSchema(db) {
  if (!db || INITIALIZED_ON_DEMAND_DBS.has(db)) return;

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS herma_scoped_keys (
         key_id TEXT PRIMARY KEY,
         key_sha256 TEXT NOT NULL UNIQUE,
         key_prefix TEXT NOT NULL,
         key_class TEXT NOT NULL,
         owner_worker_uuid TEXT NOT NULL DEFAULT '',
         owner_agent_id TEXT NOT NULL DEFAULT '',
         label TEXT NOT NULL DEFAULT '',
         scopes_json TEXT NOT NULL DEFAULT '[]',
         allowed_endpoints_json TEXT NOT NULL DEFAULT '[]',
         rate_limit_rpm INTEGER NOT NULL DEFAULT 600,
         status TEXT NOT NULL DEFAULT 'active',
         rotated_from_key_id TEXT NOT NULL DEFAULT '',
         usage_count INTEGER NOT NULL DEFAULT 0,
         last_used_at TEXT NOT NULL DEFAULT '',
         expires_at TEXT NOT NULL DEFAULT '',
         created_at TEXT NOT NULL,
         revoked_at TEXT NOT NULL DEFAULT ''
       )`
    )
    .run();

  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_herma_scoped_keys_owner
       ON herma_scoped_keys(owner_worker_uuid, status)`
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS herma_api_intraday_deltas (
         delta_seq INTEGER PRIMARY KEY AUTOINCREMENT,
         endpoint_key TEXT NOT NULL,
         entity_id TEXT NOT NULL,
         op_kind TEXT NOT NULL DEFAULT 'patch',
         delta_json TEXT NOT NULL,
         author_agent_id TEXT NOT NULL DEFAULT '',
         created_at TEXT NOT NULL
       )`
    )
    .run();

  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_herma_api_deltas_ep_seq
       ON herma_api_intraday_deltas(endpoint_key, delta_seq)`
    )
    .run();

  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_herma_api_deltas_ep_entity
       ON herma_api_intraday_deltas(endpoint_key, entity_id, delta_seq)`
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS herma_swappable_nodes (
         slot_id TEXT NOT NULL,
         node_id TEXT NOT NULL,
         display_name TEXT NOT NULL,
         source_object_key TEXT NOT NULL DEFAULT '',
         algorithm_family TEXT NOT NULL,
         grid_params_json TEXT NOT NULL,
         parameter_bounds_json TEXT NOT NULL,
         ledger_stage TEXT NOT NULL DEFAULT 'verified',
         is_active INTEGER NOT NULL DEFAULT 0,
         calls_count INTEGER NOT NULL DEFAULT 0,
         success_count INTEGER NOT NULL DEFAULT 0,
         short_circuit_hits INTEGER NOT NULL DEFAULT 0,
         ewma_latency_ms REAL NOT NULL DEFAULT 0,
         wilson_lcb_milli INTEGER NOT NULL DEFAULT 750,
         updated_at TEXT NOT NULL,
         PRIMARY KEY (slot_id, node_id)
       )`
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS herma_api_invocation_log (
         invocation_id INTEGER PRIMARY KEY AUTOINCREMENT,
         endpoint_key TEXT NOT NULL,
         gate_resolved TEXT NOT NULL,
         short_circuited INTEGER NOT NULL DEFAULT 0,
         observe_mode TEXT NOT NULL DEFAULT 'calibrated_auto',
         status_code INTEGER NOT NULL,
         latency_ms REAL NOT NULL,
         caller_key_id TEXT NOT NULL DEFAULT '',
         created_at TEXT NOT NULL
       )`
    )
    .run();

  // Seed default swappable backend nodes idempotently
  const nowIso = new Date().toISOString();
  const seedStmts = [];
  for (const slotSpec of SWAPPABLE_SLOT_SEEDS) {
    const boundsJson = JSON.stringify(slotSpec.parameter_bounds);
    for (const cand of slotSpec.candidates) {
      seedStmts.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO herma_swappable_nodes
             (slot_id, node_id, display_name, source_object_key, algorithm_family,
              grid_params_json, parameter_bounds_json, ledger_stage, is_active,
              calls_count, success_count, short_circuit_hits, ewma_latency_ms, wilson_lcb_milli, updated_at)
             VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)`
          )
          .bind(
            slotSpec.slot_id,
            cand.node_id,
            cand.display_name,
            cand.algorithm_family,
            JSON.stringify(cand.grid_params),
            boundsJson,
            cand.ledger_stage,
            cand.is_active ? 1 : 0,
            ON_DEMAND_API_GRID.wilson_prior_milli,
            nowIso
          )
      );
    }
  }
  if (seedStmts.length) {
    await db.batch(seedStmts);
  }

  INITIALIZED_ON_DEMAND_DBS.add(db);
}

export function extractPresentedScopedKey(request, url = null, body = null) {
  const hdrKey =
    (request?.headers?.get("x-herma-api-key") || "").trim() ||
    (request?.headers?.get("x-herma-infra-key") || "").trim() ||
    (request?.headers?.get("x-herma-worker-token") || "").trim();
  if (hdrKey && hdrKey.startsWith("hk_")) return hdrKey;

  const auth = (request?.headers?.get("authorization") || "").trim();
  if (auth.toLowerCase().startsWith("bearer ")) {
    const tok = auth.slice("bearer ".length).trim();
    if (tok.startsWith("hk_")) return tok;
  }
  if (body && typeof body === "object") {
    const bodyKey = String(body.api_key || body.scoped_key || body.worker_token || "").trim();
    if (bodyKey.startsWith("hk_")) return bodyKey;
  }
  if (url?.searchParams) {
    const qKey = String(url.searchParams.get("api_key") || "").trim();
    if (qKey.startsWith("hk_")) return qKey;
  }
  return "";
}

function checkRateLimitBucket(keyId, rpmLimit) {
  const nowBucket = Math.floor(Date.now() / ON_DEMAND_API_GRID.rpm_window_ms);
  const bucketKey = `${keyId}:${nowBucket}`;
  const current = (EPHEMERAL_RATE_BUCKETS.get(bucketKey) || 0) + 1;
  if (EPHEMERAL_RATE_BUCKETS.size > ON_DEMAND_API_GRID.singleflight_memo_max_entries) {
    const firstKey = EPHEMERAL_RATE_BUCKETS.keys().next().value;
    if (firstKey) EPHEMERAL_RATE_BUCKETS.delete(firstKey);
  }
  EPHEMERAL_RATE_BUCKETS.set(bucketKey, current);
  return {
    allowed: current <= rpmLimit,
    used_in_window: current,
    rate_limit_rpm: rpmLimit,
  };
}

export async function authenticateScopedKey(db, rawKey, { touchUsage = true } = {}) {
  const cleanKey = String(rawKey || "").trim();
  if (!cleanKey || !cleanKey.startsWith("hk_")) {
    return { ok: false, present: false };
  }
  await ensureOnDemandApiSchema(db);
  const digest = await sha256HexLocal(cleanKey);
  const row = await db
    .prepare("SELECT * FROM herma_scoped_keys WHERE key_sha256 = ? LIMIT 1")
    .bind(digest)
    .first();
  if (!row) {
    return { ok: false, present: true, code: "invalid_api_key", detail: "Unrecognized scoped API key." };
  }
  if (row.status !== "active" || row.revoked_at) {
    return {
      ok: false,
      present: true,
      code: "revoked_or_rotated_key",
      detail: `Key ${row.key_id} is ${row.status}.`,
    };
  }
  if (row.expires_at) {
    const expMs = Date.parse(row.expires_at);
    if (Number.isFinite(expMs) && Date.now() > expMs) {
      return { ok: false, present: true, code: "expired_api_key", detail: `Key ${row.key_id} has expired.` };
    }
  }
  const rpm = clampNumeric(
    row.rate_limit_rpm,
    ON_DEMAND_API_GRID.min_rpm_bound,
    ON_DEMAND_API_GRID.max_rpm_bound
  );
  const rateCheck = checkRateLimitBucket(row.key_id, rpm);
  if (!rateCheck.allowed) {
    return {
      ok: false,
      present: true,
      rateLimited: true,
      code: "rate_limit_exceeded",
      detail: `Key ${row.key_id} exceeded ${rpm} requests/min.`,
    };
  }

  let scopes = [];
  let allowedEndpoints = [];
  try {
    scopes = JSON.parse(row.scopes_json || "[]");
  } catch {
    scopes = [];
  }
  try {
    allowedEndpoints = JSON.parse(row.allowed_endpoints_json || "[]");
  } catch {
    allowedEndpoints = [];
  }

  if (touchUsage) {
    const nowIso = new Date().toISOString();
    await db
      .prepare("UPDATE herma_scoped_keys SET usage_count = usage_count + 1, last_used_at = ? WHERE key_id = ?")
      .bind(nowIso, row.key_id)
      .run();
  }

  return {
    ok: true,
    present: true,
    key_id: row.key_id,
    key_prefix: row.key_prefix,
    key_class: row.key_class,
    owner_worker_uuid: row.owner_worker_uuid,
    owner_agent_id: row.owner_agent_id,
    scopes: Array.isArray(scopes) ? scopes : [],
    allowed_endpoints: Array.isArray(allowedEndpoints) ? allowedEndpoints : [],
    rate_limit_rpm: rpm,
    usage_count: Number(row.usage_count || 0) + (touchUsage ? 1 : 0),
  };
}

function redactKeyRow(row) {
  let scopes = [];
  let allowedEndpoints = [];
  try {
    scopes = JSON.parse(row.scopes_json || "[]");
  } catch {
    scopes = [];
  }
  try {
    allowedEndpoints = JSON.parse(row.allowed_endpoints_json || "[]");
  } catch {
    allowedEndpoints = [];
  }
  return {
    key_id: row.key_id,
    key_prefix: row.key_prefix,
    key_class: row.key_class,
    owner_worker_uuid: row.owner_worker_uuid,
    owner_agent_id: row.owner_agent_id,
    label: row.label,
    scopes,
    allowed_endpoints: allowedEndpoints,
    rate_limit_rpm: Number(row.rate_limit_rpm || 0),
    status: row.status,
    rotated_from_key_id: row.rotated_from_key_id || null,
    usage_count: Number(row.usage_count || 0),
    last_used_at: row.last_used_at || null,
    expires_at: row.expires_at || null,
    created_at: row.created_at,
    revoked_at: row.revoked_at || null,
  };
}

async function mintScopedKeyRecord(db, spec) {
  const keyClass = VALID_KEY_CLASSES.has(spec.keyClass) ? spec.keyClass : "endpoint";
  const prefixTag = keyClass === "worker" ? "hk_wrk_" : keyClass === "infra" ? "hk_inf_" : "hk_ep_";
  const rawSecret = `${prefixTag}${randomHexBytes(ON_DEMAND_API_GRID.key_random_bytes)}`;
  const keySha256 = await sha256HexLocal(rawSecret);
  const keyId = `kid_${keyClass}_${randomHexBytes(ON_DEMAND_API_GRID.key_id_random_bytes)}`;
  const keyPrefix = rawSecret.slice(0, ON_DEMAND_API_GRID.key_prefix_visible_len);
  const defaultRpm =
    keyClass === "infra"
      ? ON_DEMAND_API_GRID.default_infra_rpm
      : keyClass === "worker"
        ? ON_DEMAND_API_GRID.default_worker_rpm
        : ON_DEMAND_API_GRID.default_endpoint_rpm;
  const rpm = Math.floor(
    clampNumeric(
      spec.rateLimitRpm ?? defaultRpm,
      ON_DEMAND_API_GRID.min_rpm_bound,
      ON_DEMAND_API_GRID.max_rpm_bound
    )
  );
  const scopes = (Array.isArray(spec.scopes) && spec.scopes.length
    ? spec.scopes
    : DEFAULT_SCOPES_BY_CLASS[keyClass]
  )
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .slice(0, ON_DEMAND_API_GRID.max_scopes_count);

  const allowedEndpoints = (Array.isArray(spec.allowedEndpoints) ? spec.allowedEndpoints : [])
    .map((e) => String(e || "").trim())
    .filter(Boolean)
    .slice(0, ON_DEMAND_API_GRID.max_allowed_endpoints);

  const nowIso = new Date().toISOString();
  const label = scrubSensitiveText(spec.label || `${keyClass}-capability-key`).slice(
    0,
    ON_DEMAND_API_GRID.max_label_len
  );
  const expiresAt = spec.expiresAt ? String(spec.expiresAt).trim() : "";

  await db
    .prepare(
      `INSERT INTO herma_scoped_keys
       (key_id, key_sha256, key_prefix, key_class, owner_worker_uuid, owner_agent_id,
        label, scopes_json, allowed_endpoints_json, rate_limit_rpm, status,
        rotated_from_key_id, usage_count, last_used_at, expires_at, created_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 0, '', ?, ?, '')`
    )
    .bind(
      keyId,
      keySha256,
      keyPrefix,
      keyClass,
      String(spec.ownerWorkerUuid || ""),
      String(spec.ownerAgentId || ""),
      label,
      JSON.stringify(scopes),
      JSON.stringify(allowedEndpoints),
      rpm,
      String(spec.rotatedFromKeyId || ""),
      expiresAt,
      nowIso
    )
    .run();

  return {
    api_key: rawSecret,
    key_record: {
      key_id: keyId,
      key_prefix: keyPrefix,
      key_class: keyClass,
      owner_worker_uuid: String(spec.ownerWorkerUuid || ""),
      owner_agent_id: String(spec.ownerAgentId || ""),
      label,
      scopes,
      allowed_endpoints: allowedEndpoints,
      rate_limit_rpm: rpm,
      status: "active",
      rotated_from_key_id: spec.rotatedFromKeyId || null,
      expires_at: expiresAt || null,
      created_at: nowIso,
    },
  };
}

export async function handleScopedKeysRequest(request, db, publicUrl, infraAllowed, gatewayOps, subAction = "") {
  await ensureOnDemandApiSchema(db);
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  let body = {};
  if (method === "POST") {
    try {
      const rawTxt = await request.text();
      body = rawTxt.trim() ? JSON.parse(rawTxt) : {};
    } catch {
      return {
        status: ON_DEMAND_API_GRID.http_bad_request,
        body: { ok: false, code: "invalid_json", detail: "Request body must be valid JSON." },
      };
    }
  } else if (method !== "GET" && method !== "HEAD") {
    return {
      status: ON_DEMAND_API_GRID.http_method_not_allowed,
      body: { ok: false, code: "method_not_allowed" },
    };
  }

  const presentedScoped = extractPresentedScopedKey(request, url, body);
  const scopedAuth = presentedScoped
    ? await authenticateScopedKey(db, presentedScoped, { touchUsage: false })
    : { ok: false, present: false };

  const workerToken = String(
    body.worker_token || request.headers.get("x-herma-worker-token") || url.searchParams.get("worker_token") || ""
  ).trim();
  const agentId = String(body.agent_id || url.searchParams.get("agent_id") || scopedAuth.owner_agent_id || "").trim();
  const workerUuid = String(
    body.worker_uuid || url.searchParams.get("worker_uuid") || scopedAuth.owner_worker_uuid || ""
  ).trim();

  let verifiedWorker = null;
  if (workerUuid && workerToken && !workerToken.startsWith("hk_")) {
    const wCheck = await gatewayOps.verifyWorkerUuidAccess({
      agentId: agentId || "worker",
      workerUuid,
      workerToken,
      infraAllowed,
    });
    if (wCheck.ok && wCheck.tokenVerified && wCheck.existing) {
      verifiedWorker = wCheck.existing;
    }
  } else if (scopedAuth.ok && scopedAuth.key_class === "worker" && scopedAuth.owner_worker_uuid) {
    verifiedWorker = {
      worker_uuid: scopedAuth.owner_worker_uuid,
      agent_id: scopedAuth.owner_agent_id || agentId || "worker",
    };
  }

  const hasInfraKeyRotate =
    infraAllowed ||
    (scopedAuth.ok && scopedAuth.key_class === "infra" && scopedAuth.scopes.includes("infra:rotate_keys"));

  const op = String(subAction || body.op || body.action || (method === "GET" ? "list" : "mint")).toLowerCase();

  if (op === "verify") {
    if (!presentedScoped) {
      return {
        status: ON_DEMAND_API_GRID.http_bad_request,
        body: { ok: false, code: "missing_api_key", detail: "Provide api_key or X-Herma-Api-Key to verify." },
      };
    }
    if (!scopedAuth.ok) {
      return {
        status: scopedAuth.rateLimited ? ON_DEMAND_API_GRID.http_rate_limited : ON_DEMAND_API_GRID.http_unauthorized,
        body: { ok: false, code: scopedAuth.code || "invalid_api_key", detail: scopedAuth.detail },
      };
    }
    return {
      status: ON_DEMAND_API_GRID.http_ok,
      body: {
        ok: true,
        schema: "herma.scoped_keys.verify.v1",
        verified: true,
        key: {
          key_id: scopedAuth.key_id,
          key_prefix: scopedAuth.key_prefix,
          key_class: scopedAuth.key_class,
          owner_worker_uuid: scopedAuth.owner_worker_uuid,
          owner_agent_id: scopedAuth.owner_agent_id,
          scopes: scopedAuth.scopes,
          allowed_endpoints: scopedAuth.allowed_endpoints,
          rate_limit_rpm: scopedAuth.rate_limit_rpm,
        },
      },
    };
  }

  if (op === "list" || method === "GET" || method === "HEAD") {
    if (!hasInfraKeyRotate && !verifiedWorker && !(scopedAuth.ok && scopedAuth.key_id)) {
      return {
        status: ON_DEMAND_API_GRID.http_unauthorized,
        body: {
          ok: false,
          code: "auth_required",
          detail: "Listing key metadata requires a verified worker_token, scoped key, or server_infra token.",
        },
      };
    }
    let rows = [];
    if (hasInfraKeyRotate) {
      const q = await db
        .prepare("SELECT * FROM herma_scoped_keys ORDER BY created_at DESC LIMIT ?")
        .bind(ON_DEMAND_API_GRID.invocation_log_limit)
        .all();
      rows = q?.results || [];
    } else if (verifiedWorker?.worker_uuid) {
      const q = await db
        .prepare("SELECT * FROM herma_scoped_keys WHERE owner_worker_uuid = ? ORDER BY created_at DESC LIMIT ?")
        .bind(verifiedWorker.worker_uuid, ON_DEMAND_API_GRID.invocation_log_limit)
        .all();
      rows = q?.results || [];
    } else if (scopedAuth.ok) {
      const q = await db
        .prepare("SELECT * FROM herma_scoped_keys WHERE key_id = ? LIMIT 1")
        .bind(scopedAuth.key_id)
        .all();
      rows = q?.results || [];
    }
    return {
      status: ON_DEMAND_API_GRID.http_ok,
      body: {
        ok: true,
        schema: "herma.scoped_keys.list.v1",
        storage_guarantee: "sha256_digest_only_zero_plaintext",
        keys: rows.map(redactKeyRow),
      },
    };
  }

  if (op === "mint") {
    const requestedClass = String(body.key_class || "endpoint").toLowerCase();
    if (!VALID_KEY_CLASSES.has(requestedClass)) {
      return {
        status: ON_DEMAND_API_GRID.http_bad_request,
        body: { ok: false, code: "invalid_key_class", detail: "key_class must be worker, endpoint, or infra." },
      };
    }
    if (requestedClass === "infra" && !hasInfraKeyRotate) {
      return {
        status: ON_DEMAND_API_GRID.http_forbidden,
        body: {
          ok: false,
          code: "forbidden_key_class",
          detail: "Minting infra keys requires server_infra authorization.",
        },
      };
    }
    if (!hasInfraKeyRotate && !verifiedWorker) {
      return {
        status: ON_DEMAND_API_GRID.http_forbidden,
        body: {
          ok: false,
          code: "worker_verification_required",
          detail:
            "Present your worker_uuid + worker_token (from POST /q/onboard) or server_infra credentials to mint scoped worker/endpoint keys.",
        },
      };
    }
    const ownerUuid = verifiedWorker?.worker_uuid || workerUuid || "";
    const ownerAgent = verifiedWorker?.agent_id || agentId || (hasInfraKeyRotate ? "server-infra" : "worker");
    const allowedEndpoints = Array.isArray(body.allowed_endpoints)
      ? body.allowed_endpoints
      : body.endpoint_key
        ? [body.endpoint_key]
        : [];

    // Non-infra callers minting endpoint keys must bind to owned endpoints (not wildcard '*')
    if (!hasInfraKeyRotate && requestedClass === "endpoint") {
      if (!allowedEndpoints.length || allowedEndpoints.includes("*")) {
        return {
          status: ON_DEMAND_API_GRID.http_forbidden,
          body: {
            ok: false,
            code: "endpoint_scope_required",
            detail: "Worker-minted endpoint keys must specify allowed_endpoints (wildcard '*' requires server_infra).",
          },
        };
      }
      for (const epKey of allowedEndpoints) {
        const objRow = await db
          .prepare("SELECT producer_agent, worker_uuid FROM herma_task_objects WHERE object_key = ? ORDER BY id DESC LIMIT 1")
          .bind(String(epKey).trim())
          .first();
        if (
          objRow &&
          objRow.worker_uuid &&
          objRow.worker_uuid !== ownerUuid &&
          objRow.producer_agent !== ownerAgent
        ) {
          return {
            status: ON_DEMAND_API_GRID.http_forbidden,
            body: {
              ok: false,
              code: "endpoint_ownership_mismatch",
              detail: `Endpoint '${epKey}' is owned by another worker.`,
            },
          };
        }
      }
    }

    const minted = await mintScopedKeyRecord(db, {
      keyClass: requestedClass,
      ownerWorkerUuid: ownerUuid,
      ownerAgentId: ownerAgent,
      label: body.label || "",
      scopes: body.scopes,
      allowedEndpoints,
      rateLimitRpm: body.rate_limit_rpm,
      expiresAt: body.expires_at,
    });
    return {
      status: ON_DEMAND_API_GRID.http_created,
      body: {
        ok: true,
        schema: "herma.scoped_keys.mint.v1",
        notice: "Store api_key securely now; Herma persists only its non-reversible SHA-256 digest.",
        api_key: minted.api_key,
        key: minted.key_record,
        keys_url: `${publicUrl}/q/keys`,
      },
    };
  }

  if (op === "rotate" || op === "revoke") {
    const targetKeyId = String(body.key_id || "").trim();
    if (!targetKeyId) {
      return {
        status: ON_DEMAND_API_GRID.http_bad_request,
        body: { ok: false, code: "missing_key_id", detail: "Specify key_id to rotate or revoke." },
      };
    }
    const existing = await db.prepare("SELECT * FROM herma_scoped_keys WHERE key_id = ? LIMIT 1").bind(targetKeyId).first();
    if (!existing) {
      return {
        status: ON_DEMAND_API_GRID.http_not_found,
        body: { ok: false, code: "key_not_found", detail: `Key '${targetKeyId}' does not exist.` },
      };
    }
    const ownsKey =
      hasInfraKeyRotate ||
      (verifiedWorker && existing.owner_worker_uuid && existing.owner_worker_uuid === verifiedWorker.worker_uuid) ||
      (scopedAuth.ok && scopedAuth.key_id === existing.key_id);
    if (!ownsKey || (existing.key_class === "infra" && !hasInfraKeyRotate)) {
      return {
        status: ON_DEMAND_API_GRID.http_forbidden,
        body: { ok: false, code: "forbidden_key_mutation", detail: "Not authorized to mutate this key." },
      };
    }
    const nowIso = new Date().toISOString();
    const newStatus = op === "rotate" ? "rotated" : "revoked";
    await db
      .prepare("UPDATE herma_scoped_keys SET status = ?, revoked_at = ? WHERE key_id = ?")
      .bind(newStatus, nowIso, existing.key_id)
      .run();

    if (op === "revoke") {
      return {
        status: ON_DEMAND_API_GRID.http_ok,
        body: {
          ok: true,
          schema: "herma.scoped_keys.revoke.v1",
          revoked_key_id: existing.key_id,
          revoked_at: nowIso,
        },
      };
    }

    let prevScopes = [];
    let prevEndpoints = [];
    try {
      prevScopes = JSON.parse(existing.scopes_json || "[]");
    } catch {
      prevScopes = [];
    }
    try {
      prevEndpoints = JSON.parse(existing.allowed_endpoints_json || "[]");
    } catch {
      prevEndpoints = [];
    }
    const replacement = await mintScopedKeyRecord(db, {
      keyClass: existing.key_class,
      ownerWorkerUuid: existing.owner_worker_uuid,
      ownerAgentId: existing.owner_agent_id,
      label: body.label || existing.label,
      scopes: Array.isArray(body.scopes) ? body.scopes : prevScopes,
      allowedEndpoints: Array.isArray(body.allowed_endpoints) ? body.allowed_endpoints : prevEndpoints,
      rateLimitRpm: body.rate_limit_rpm ?? existing.rate_limit_rpm,
      expiresAt: body.expires_at ?? existing.expires_at,
      rotatedFromKeyId: existing.key_id,
    });
    return {
      status: ON_DEMAND_API_GRID.http_ok,
      body: {
        ok: true,
        schema: "herma.scoped_keys.rotate.v1",
        rotated_from_key_id: existing.key_id,
        api_key: replacement.api_key,
        key: replacement.key_record,
      },
    };
  }

  return {
    status: ON_DEMAND_API_GRID.http_bad_request,
    body: { ok: false, code: "unsupported_key_op", detail: `Unsupported key operation '${op}'.` },
  };
}

// ---------------------------------------------------------------------------
// Safe Declarative Arithmetic Expression Evaluator (ZERO eval / new Function)
// ---------------------------------------------------------------------------

function tokenizeSafeExpr(exprStr) {
  const s = String(exprStr || "").trim();
  if (!s || s.length > ON_DEMAND_API_GRID.max_expr_len) return null;
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if ("+-*/%(),".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let numStr = "";
      while (i < s.length && /[0-9.]/.test(s[i])) {
        numStr += s[i];
        i += 1;
      }
      const numVal = Number(numStr);
      if (!Number.isFinite(numVal)) return null;
      tokens.push({ type: "num", value: numVal });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let ident = "";
      while (i < s.length && /[A-Za-z0-9_.]/.test(s[i])) {
        ident += s[i];
        i += 1;
      }
      tokens.push({ type: "id", value: ident });
      continue;
    }
    return null;
  }
  if (tokens.length > ON_DEMAND_API_GRID.max_expr_tokens) return null;
  return tokens;
}

function resolveFieldPath(record, pathStr) {
  if (!record || typeof record !== "object") return 0;
  const parts = String(pathStr || "").split(".");
  let cur = record;
  for (const p of parts) {
    if (p === "__proto__" || p === "constructor" || p === "prototype") return 0;
    if (cur == null || typeof cur !== "object") return 0;
    cur = cur[p];
  }
  const num = Number(cur);
  return Number.isFinite(num) ? num : 0;
}

export function evaluateSafeNumericExpression(exprStr, record) {
  const tokens = tokenizeSafeExpr(exprStr);
  if (!tokens || !tokens.length) return null;
  let pos = 0;

  function peek() {
    return tokens[pos] || null;
  }
  function consume() {
    const t = tokens[pos] || null;
    pos += 1;
    return t;
  }

  function parseExpr() {
    let left = parseTerm();
    while (peek()?.type === "op" && (peek().value === "+" || peek().value === "-")) {
      const op = consume().value;
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  function parseTerm() {
    let left = parseFactor();
    while (peek()?.type === "op" && (peek().value === "*" || peek().value === "/" || peek().value === "%")) {
      const op = consume().value;
      const right = parseFactor();
      if (op === "*") left *= right;
      else if (op === "/") left = right === 0 ? 0 : left / right;
      else left = right === 0 ? 0 : left % right;
    }
    return left;
  }

  function parseFactor() {
    const t = peek();
    if (!t) return 0;
    if (t.type === "op" && t.value === "-") {
      consume();
      return -parseFactor();
    }
    if (t.type === "op" && t.value === "+") {
      consume();
      return parseFactor();
    }
    if (t.type === "num") {
      consume();
      return t.value;
    }
    if (t.type === "op" && t.value === "(") {
      consume();
      const val = parseExpr();
      if (peek()?.type === "op" && peek().value === ")") consume();
      return val;
    }
    if (t.type === "id") {
      consume();
      if (peek()?.type === "op" && peek().value === "(") {
        consume();
        const args = [];
        if (!(peek()?.type === "op" && peek().value === ")")) {
          args.push(parseExpr());
          while (peek()?.type === "op" && peek().value === ",") {
            consume();
            args.push(parseExpr());
          }
        }
        if (peek()?.type === "op" && peek().value === ")") consume();
        const fn = t.value.toLowerCase();
        if (fn === "min") return args.length ? Math.min(...args) : 0;
        if (fn === "max") return args.length ? Math.max(...args) : 0;
        if (fn === "abs") return Math.abs(args[0] || 0);
        if (fn === "round") {
          const factor = Math.pow(10, clampNumeric(args[1] ?? 2, 0, 6));
          return Math.round((args[0] || 0) * factor) / factor;
        }
        if (fn === "clamp") {
          return clampNumeric(args[0] || 0, args[1] ?? 0, args[2] ?? 1);
        }
        return 0;
      }
      return resolveFieldPath(record, t.value);
    }
    consume();
    return 0;
  }

  const out = parseExpr();
  return Number.isFinite(out) ? out : null;
}

// ---------------------------------------------------------------------------
// Swappable Self-Tuning Backend Engine Slots (`/q/nodes`)
// ---------------------------------------------------------------------------

export async function getActiveSwappableNodesMap(db) {
  await ensureOnDemandApiSchema(db);
  const rows = await db
    .prepare("SELECT * FROM herma_swappable_nodes WHERE is_active = 1")
    .all();
  const map = {};
  for (const r of rows?.results || []) {
    let params = {};
    try {
      params = JSON.parse(r.grid_params_json || "{}");
    } catch {
      params = {};
    }
    map[r.slot_id] = {
      slot_id: r.slot_id,
      node_id: r.node_id,
      display_name: r.display_name,
      algorithm_family: r.algorithm_family,
      source_object_key: r.source_object_key || null,
      ledger_stage: r.ledger_stage,
      grid_params: params,
      wilson_lcb_milli: Number(r.wilson_lcb_milli || ON_DEMAND_API_GRID.wilson_prior_milli),
    };
  }
  return map;
}

async function recordSwappableNodeOutcome(db, slotId, nodeId, { success = true, latencyMs = 1, shortCircuited = false } = {}) {
  const row = await db
    .prepare("SELECT * FROM herma_swappable_nodes WHERE slot_id = ? AND node_id = ? LIMIT 1")
    .bind(slotId, nodeId)
    .first();
  if (!row) return null;
  const nextCalls = Number(row.calls_count || 0) + 1;
  const nextSucc = Number(row.success_count || 0) + (success ? 1 : 0);
  const nextSc = Number(row.short_circuit_hits || 0) + (shortCircuited ? 1 : 0);
  const prevLat = Number(row.ewma_latency_ms || 0);
  const nextLat =
    prevLat <= 0
      ? Number(latencyMs || 0)
      : (1 - ON_DEMAND_API_GRID.ewma_alpha) * prevLat + ON_DEMAND_API_GRID.ewma_alpha * Number(latencyMs || 0);
  const nextLcb = computeWilsonLcbMilli(nextSucc, nextCalls);
  const nowIso = new Date().toISOString();

  await db
    .prepare(
      `UPDATE herma_swappable_nodes
       SET calls_count = ?, success_count = ?, short_circuit_hits = ?,
           ewma_latency_ms = ?, wilson_lcb_milli = ?, updated_at = ?
       WHERE slot_id = ? AND node_id = ?`
    )
    .bind(nextCalls, nextSucc, nextSc, nextLat, nextLcb, nowIso, slotId, nodeId)
    .run();

  return { calls_count: nextCalls, success_count: nextSucc, wilson_lcb_milli: nextLcb, ewma_latency_ms: nextLat };
}

export async function handleSwappableNodesRequest(request, db, publicUrl, infraAllowed) {
  await ensureOnDemandApiSchema(db);
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (method === "GET" || method === "HEAD") {
    const slotFilter = String(url.searchParams.get("slot") || "").trim();
    const sql = slotFilter
      ? "SELECT * FROM herma_swappable_nodes WHERE slot_id = ? ORDER BY is_active DESC, wilson_lcb_milli DESC"
      : "SELECT * FROM herma_swappable_nodes ORDER BY slot_id ASC, is_active DESC, wilson_lcb_milli DESC";
    const q = slotFilter ? await db.prepare(sql).bind(slotFilter).all() : await db.prepare(sql).all();
    const bySlot = {};
    for (const r of q?.results || []) {
      if (!bySlot[r.slot_id]) {
        bySlot[r.slot_id] = { active_node_id: null, candidates: [] };
      }
      let gridParams = {};
      let bounds = {};
      try {
        gridParams = JSON.parse(r.grid_params_json || "{}");
      } catch {
        gridParams = {};
      }
      try {
        bounds = JSON.parse(r.parameter_bounds_json || "{}");
      } catch {
        bounds = {};
      }
      const totalSlotCalls = Math.max(1, Number(r.calls_count || 0));
      const ucbScore =
        Number(r.wilson_lcb_milli || ON_DEMAND_API_GRID.wilson_prior_milli) / ON_DEMAND_API_GRID.milli_scale +
        ON_DEMAND_API_GRID.ucb_exploration_alpha * Math.sqrt(Math.log(totalSlotCalls + 2) / totalSlotCalls);
      const formatted = {
        node_id: r.node_id,
        display_name: r.display_name,
        algorithm_family: r.algorithm_family,
        source_object_key: r.source_object_key || null,
        ledger_stage: r.ledger_stage,
        is_active: Boolean(r.is_active),
        grid_params: gridParams,
        parameter_bounds: bounds,
        telemetry: {
          calls_count: Number(r.calls_count || 0),
          success_count: Number(r.success_count || 0),
          short_circuit_hits: Number(r.short_circuit_hits || 0),
          ewma_latency_ms: Number(Number(r.ewma_latency_ms || 0).toFixed(3)),
          wilson_lcb_milli: Number(r.wilson_lcb_milli || 0),
          ucb_bandit_score: Number(ucbScore.toFixed(4)),
        },
        updated_at: r.updated_at,
      };
      if (r.is_active) bySlot[r.slot_id].active_node_id = r.node_id;
      bySlot[r.slot_id].candidates.push(formatted);
    }
    return {
      status: ON_DEMAND_API_GRID.http_ok,
      body: {
        ok: true,
        schema: "herma.swappable_nodes.catalog.v1",
        architecture: "5_ring_onion_parameterized_slots_over_task_objects",
        slots_count: Object.keys(bySlot).length,
        slots: bySlot,
      },
    };
  }

  if (method !== "POST") {
    return {
      status: ON_DEMAND_API_GRID.http_method_not_allowed,
      body: { ok: false, code: "method_not_allowed" },
    };
  }

  let body = {};
  try {
    const rawTxt = await request.text();
    body = rawTxt.trim() ? JSON.parse(rawTxt) : {};
  } catch {
    return {
      status: ON_DEMAND_API_GRID.http_bad_request,
      body: { ok: false, code: "invalid_json" },
    };
  }

  const presentedScoped = extractPresentedScopedKey(request, url, body);
  const scopedAuth = presentedScoped
    ? await authenticateScopedKey(db, presentedScoped, { touchUsage: true })
    : { ok: false };
  const canManageNodes =
    infraAllowed ||
    (scopedAuth.ok && scopedAuth.key_class === "infra" && scopedAuth.scopes.includes("infra:manage_nodes"));

  const op = String(body.op || body.action || "register").toLowerCase();

  if (op === "register") {
    const slotId = String(body.slot_id || "").trim();
    const slotSeed = SWAPPABLE_SLOT_SEEDS.find((s) => s.slot_id === slotId);
    if (!slotSeed) {
      return {
        status: ON_DEMAND_API_GRID.http_bad_request,
        body: {
          ok: false,
          code: "invalid_slot_id",
          detail: `slot_id must be one of: ${SWAPPABLE_SLOT_SEEDS.map((s) => s.slot_id).join(", ")}`,
        },
      };
    }
    const nodeId = String(body.node_id || "").trim().replace(/[^A-Za-z0-9._-]+/g, "_");
    if (!nodeId) {
      return {
        status: ON_DEMAND_API_GRID.http_bad_request,
        body: { ok: false, code: "missing_node_id" },
      };
    }
    const sourceObjectKey = String(body.source_object_key || "").trim();
    if (sourceObjectKey) {
      const objExists = await db
        .prepare("SELECT object_key FROM herma_task_objects WHERE object_key = ? LIMIT 1")
        .bind(sourceObjectKey)
        .first();
      if (!objExists) {
        return {
          status: ON_DEMAND_API_GRID.http_not_found,
          body: {
            ok: false,
            code: "source_object_not_found",
            detail: `Referenced TaskObject '${sourceObjectKey}' was not found in herma_task_objects.`,
          },
        };
      }
    }

    // Clamp grid_params against slot ParameterBounds
    const rawParams = body.grid_params && typeof body.grid_params === "object" ? body.grid_params : {};
    const clampedParams = {};
    for (const [pName, pBound] of Object.entries(slotSeed.parameter_bounds)) {
      const fallback = slotSeed.candidates[0]?.grid_params?.[pName] ?? pBound.min;
      clampedParams[pName] = clampNumeric(rawParams[pName] ?? fallback, pBound.min, pBound.max);
    }

    const stage = canManageNodes && VALID_LEDGER_STAGES.has(body.ledger_stage) ? body.ledger_stage : canManageNodes ? "verified" : "proposed";
    const nowIso = new Date().toISOString();
    await db
      .prepare(
        `INSERT OR REPLACE INTO herma_swappable_nodes
         (slot_id, node_id, display_name, source_object_key, algorithm_family,
          grid_params_json, parameter_bounds_json, ledger_stage, is_active,
          calls_count, success_count, short_circuit_hits, ewma_latency_ms, wilson_lcb_milli, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?, ?)`
      )
      .bind(
        slotId,
        nodeId,
        scrubSensitiveText(body.display_name || nodeId).slice(0, ON_DEMAND_API_GRID.max_label_len),
        sourceObjectKey,
        scrubSensitiveText(body.algorithm_family || "custom_declarative_profile").slice(0, ON_DEMAND_API_GRID.max_label_len),
        JSON.stringify(clampedParams),
        JSON.stringify(slotSeed.parameter_bounds),
        stage,
        ON_DEMAND_API_GRID.wilson_prior_milli,
        nowIso
      )
      .run();

    return {
      status: ON_DEMAND_API_GRID.http_created,
      body: {
        ok: true,
        schema: "herma.swappable_nodes.register.v1",
        slot_id: slotId,
        node_id: nodeId,
        ledger_stage: stage,
        clamped_grid_params: clampedParams,
        source_object_key: sourceObjectKey || null,
      },
    };
  }

  if (op === "feedback") {
    const slotId = String(body.slot_id || "").trim();
    const nodeId = String(body.node_id || "").trim();
    const reward = clampNumeric(body.reward ?? (body.success === false ? 0 : 1), 0, 1);
    const updated = await recordSwappableNodeOutcome(db, slotId, nodeId, {
      success: reward >= 0.5,
      latencyMs: Number(body.latency_ms || 1),
      shortCircuited: Boolean(body.short_circuited),
    });
    if (!updated) {
      return {
        status: ON_DEMAND_API_GRID.http_not_found,
        body: { ok: false, code: "node_not_found" },
      };
    }

    let autoPromotedNodeId = null;
    if (body.auto_tune && canManageNodes) {
      const verifiedRows = await db
        .prepare(
          "SELECT * FROM herma_swappable_nodes WHERE slot_id = ? AND ledger_stage IN ('verified', 'promoted')"
        )
        .bind(slotId)
        .all();
      const eligible = (verifiedRows?.results || []).filter(
        (r) => Number(r.calls_count || 0) >= ON_DEMAND_API_GRID.min_verified_calls_for_autotune
      );
      if (eligible.length >= 2) {
        eligible.sort((a, b) => Number(b.wilson_lcb_milli || 0) - Number(a.wilson_lcb_milli || 0));
        const winner = eligible[0];
        if (!winner.is_active) {
          const nowIso = new Date().toISOString();
          await db.batch([
            db
              .prepare("UPDATE herma_swappable_nodes SET is_active = 0 WHERE slot_id = ?")
              .bind(slotId),
            db
              .prepare(
                "UPDATE herma_swappable_nodes SET is_active = 1, ledger_stage = 'promoted', updated_at = ? WHERE slot_id = ? AND node_id = ?"
              )
              .bind(nowIso, slotId, winner.node_id),
          ]);
          autoPromotedNodeId = winner.node_id;
        }
      }
    }

    return {
      status: ON_DEMAND_API_GRID.http_ok,
      body: {
        ok: true,
        schema: "herma.swappable_nodes.feedback.v1",
        slot_id: slotId,
        node_id: nodeId,
        telemetry: updated,
        auto_promoted_node_id: autoPromotedNodeId,
      },
    };
  }

  if (op === "promote") {
    if (!canManageNodes) {
      return {
        status: ON_DEMAND_API_GRID.http_forbidden,
        body: {
          ok: false,
          code: "infra_auth_required",
          detail: "Global promotion of swappable backend nodes requires server_infra or infra:manage_nodes key.",
        },
      };
    }
    const slotId = String(body.slot_id || "").trim();
    const nodeId = String(body.node_id || "").trim();
    const target = await db
      .prepare("SELECT * FROM herma_swappable_nodes WHERE slot_id = ? AND node_id = ? LIMIT 1")
      .bind(slotId, nodeId)
      .first();
    if (!target) {
      return {
        status: ON_DEMAND_API_GRID.http_not_found,
        body: { ok: false, code: "node_not_found" },
      };
    }
    if (target.ledger_stage !== "verified" && target.ledger_stage !== "promoted") {
      return {
        status: ON_DEMAND_API_GRID.http_conflict,
        body: {
          ok: false,
          code: "unverified_node_cannot_promote",
          detail: `GridLedger invariant: node '${nodeId}' is in stage '${target.ledger_stage}' and must be 'verified' before promotion.`,
        },
      };
    }
    const nowIso = new Date().toISOString();
    await db.batch([
      db.prepare("UPDATE herma_swappable_nodes SET is_active = 0 WHERE slot_id = ?").bind(slotId),
      db
        .prepare(
          "UPDATE herma_swappable_nodes SET is_active = 1, ledger_stage = 'promoted', updated_at = ? WHERE slot_id = ? AND node_id = ?"
        )
        .bind(nowIso, slotId, nodeId),
    ]);
    return {
      status: ON_DEMAND_API_GRID.http_ok,
      body: {
        ok: true,
        schema: "herma.swappable_nodes.promote.v1",
        slot_id: slotId,
        promoted_node_id: nodeId,
        updated_at: nowIso,
      },
    };
  }

  return {
    status: ON_DEMAND_API_GRID.http_bad_request,
    body: { ok: false, code: "unsupported_node_op" },
  };
}

// ---------------------------------------------------------------------------
// Universal On-Demand TaskObject API Runtime (`/q/endpoints` & `/q/api/<key>`)
// ---------------------------------------------------------------------------

function extractEndpointSpecFromPayload(payload, objMeta) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    if (Array.isArray(payload)) {
      return {
        auth_mode: "public",
        primary_key: "id",
        records: payload.slice(0, ON_DEMAND_API_GRID.max_records_per_endpoint),
        snapshot_watermark_seq: 0,
      };
    }
    return null;
  }
  const rawSpec =
    (payload.api_endpoint && typeof payload.api_endpoint === "object" && payload.api_endpoint) ||
    (payload.endpoint_spec && typeof payload.endpoint_spec === "object" && payload.endpoint_spec) ||
    payload;

  const recordsArr = Array.isArray(rawSpec.records)
    ? rawSpec.records
    : Array.isArray(rawSpec.snapshot)
      ? rawSpec.snapshot
      : Array.isArray(rawSpec.items)
        ? rawSpec.items
        : Array.isArray(payload.records)
          ? payload.records
          : Array.isArray(payload.items)
            ? payload.items
            : rawSpec.snapshot_map && typeof rawSpec.snapshot_map === "object"
              ? Object.entries(rawSpec.snapshot_map).map(([k, v]) =>
                  v && typeof v === "object" ? { id: k, ...v } : { id: k, value: v }
                )
              : [];

  const authMode =
    objMeta?.visibility === "server_infra"
      ? "infra_key"
      : VALID_AUTH_MODES.has(rawSpec.auth_mode)
        ? rawSpec.auth_mode
        : "public";

  return {
    title: rawSpec.title || objMeta?.summary || objMeta?.object_key || "TaskObject On-Demand API",
    description: rawSpec.description || objMeta?.summary || "",
    auth_mode: authMode,
    primary_key: String(rawSpec.primary_key || "id"),
    id_prefix: rawSpec.id_prefix ? String(rawSpec.id_prefix) : "",
    valid_id_set: Array.isArray(rawSpec.valid_ids) ? new Set(rawSpec.valid_ids.map(String)) : null,
    numeric_id_bounds:
      rawSpec.numeric_id_bounds && typeof rawSpec.numeric_id_bounds === "object"
        ? rawSpec.numeric_id_bounds
        : null,
    snapshot_watermark_seq: Math.max(0, Math.floor(Number(rawSpec.snapshot_watermark_seq || 0))),
    dirty_crossover_threshold: clampNumeric(
      rawSpec.dirty_crossover_threshold ?? ON_DEMAND_API_GRID.dirty_crossover_threshold,
      0.05,
      0.99
    ),
    fuzzy_fields: Array.isArray(rawSpec.fuzzy_fields) ? rawSpec.fuzzy_fields.map(String) : ["title", "name", "summary", "description", "tags"],
    tau_margin: clampNumeric(
      rawSpec.tau_margin ?? ON_DEMAND_API_GRID.default_fuzzy_top2_margin,
      0.01,
      0.9
    ),
    computed_fields:
      rawSpec.computed_fields && typeof rawSpec.computed_fields === "object" ? rawSpec.computed_fields : {},
    join_object_key: rawSpec.join_object_key ? String(rawSpec.join_object_key) : "",
    join_local_field: rawSpec.join_local_field ? String(rawSpec.join_local_field) : "",
    join_foreign_field: rawSpec.join_foreign_field ? String(rawSpec.join_foreign_field) : "id",
    escalate_to_queue: Boolean(rawSpec.escalate_to_queue ?? true),
    async_complexity_threshold: clampNumeric(
      rawSpec.async_complexity_threshold ?? ON_DEMAND_API_GRID.default_async_complexity_threshold,
      0.2,
      1.0
    ),
    routes: rawSpec.routes && typeof rawSpec.routes === "object" ? rawSpec.routes : {},
    records: recordsArr.slice(0, ON_DEMAND_API_GRID.max_records_per_endpoint),
  };
}

function applyDeltaMutation(currentRec, opKind, deltaObj, pkField, entityId) {
  if (opKind === "delete") return null;
  const base = currentRec && typeof currentRec === "object" ? { ...currentRec } : { [pkField]: entityId };
  if (opKind === "upsert" || opKind === "patch") {
    return { ...base, ...(deltaObj && typeof deltaObj === "object" ? deltaObj : {}), [pkField]: entityId };
  }
  if (opKind === "increment" && deltaObj && typeof deltaObj === "object") {
    const out = { ...base, [pkField]: entityId };
    for (const [k, v] of Object.entries(deltaObj)) {
      const inc = Number(v);
      if (Number.isFinite(inc)) {
        out[k] = Number(out[k] || 0) + inc;
      }
    }
    return out;
  }
  return base;
}

function buildTrigrams(text) {
  const clean = `  ${String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}  `;
  const set = new Set();
  const w = ON_DEMAND_API_GRID.trigram_width;
  for (let i = 0; i + w <= clean.length; i += 1) {
    set.add(clean.slice(i, i + w));
  }
  return set;
}

function boundedLevenshtein(a, b, cap = ON_DEMAND_API_GRID.edit_distance_cap) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const prev = Array.from({ length: b.length + 1 }, (_, idx) => idx);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const val = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur.push(val);
      if (val < rowMin) rowMin = val;
    }
    if (rowMin > cap) return cap + 1;
    for (let j = 0; j <= b.length; j += 1) prev[j] = cur[j];
  }
  return prev[b.length];
}

function scoreRecordFuzzySimilarity(queryText, rec, fuzzyFields, rankWeights) {
  const qTokens = String(queryText || "")
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(Boolean);
  if (!qTokens.length) return 0;

  const textParts = [];
  for (const f of fuzzyFields) {
    const val = rec?.[f];
    if (Array.isArray(val)) textParts.push(val.join(" "));
    else if (val != null) textParts.push(String(val));
  }
  if (!textParts.length) {
    textParts.push(JSON.stringify(rec || {}));
  }
  const docStr = textParts.join(" ").toLowerCase();
  const docTokens = docStr.split(/[^a-z0-9_]+/).filter(Boolean);
  if (!docTokens.length) return 0;

  let exactOrTypoHits = 0;
  for (const qt of qTokens) {
    if (docTokens.includes(qt)) {
      exactOrTypoHits += 1;
    } else if (qt.length >= ON_DEMAND_API_GRID.edit_word_min_len) {
      const near = docTokens.some(
        (dt) =>
          dt.length >= ON_DEMAND_API_GRID.edit_word_min_len &&
          boundedLevenshtein(qt, dt, ON_DEMAND_API_GRID.edit_distance_cap) <= 1
      );
      if (near) exactOrTypoHits += 0.82;
    }
  }
  const lexicalScore = exactOrTypoHits / qTokens.length;

  const qTri = buildTrigrams(queryText);
  const dTri = buildTrigrams(docStr);
  let inter = 0;
  for (const t of qTri) {
    if (dTri.has(t)) inter += 1;
  }
  const union = Math.max(1, qTri.size + dTri.size - inter);
  const trigramJaccard = inter / union;

  const lexW = Number(rankWeights?.lexical_weight ?? 0.55);
  const fuzW = Number(rankWeights?.fuzzy_weight ?? 0.35);
  const qualW = Number(rankWeights?.quality_weight ?? 0.1);
  const weightSum = Math.max(0.01, lexW + fuzW + qualW);
  const recQual = clampNumeric(Number(rec?.quality_score ?? rec?.confidence ?? 0.8), 0, 1);

  return (lexW * lexicalScore + fuzW * trigramJaccard + qualW * recQual) / weightSum;
}

function matchesWhereClause(rec, whereObj) {
  if (!whereObj || typeof whereObj !== "object") return true;
  for (const [field, cond] of Object.entries(whereObj)) {
    const val = rec?.[field];
    if (cond !== null && typeof cond === "object" && !Array.isArray(cond)) {
      if ("eq" in cond && val !== cond.eq) return false;
      if ("neq" in cond && val === cond.neq) return false;
      if ("in" in cond && Array.isArray(cond.in) && !cond.in.includes(val)) return false;
      if ("gte" in cond && !(Number(val) >= Number(cond.gte))) return false;
      if ("lte" in cond && !(Number(val) <= Number(cond.lte))) return false;
      if ("gt" in cond && !(Number(val) > Number(cond.gt))) return false;
      if ("lt" in cond && !(Number(val) < Number(cond.lt))) return false;
      if ("prefix" in cond && !String(val ?? "").startsWith(String(cond.prefix))) return false;
      if (
        "contains" in cond &&
        !String(Array.isArray(val) ? val.join(" ") : val ?? "")
          .toLowerCase()
          .includes(String(cond.contains).toLowerCase())
      ) {
        return false;
      }
    } else if (val !== cond) {
      return false;
    }
  }
  return true;
}

function applyComputedFieldsAndProjection(records, computedSpec, selectFields) {
  const compEntries = Object.entries(computedSpec || {});
  const projected = Array.isArray(selectFields) && selectFields.length ? selectFields.map(String) : null;
  return records.map((rec) => {
    const enriched = { ...rec };
    for (const [outField, expr] of compEntries) {
      const val = evaluateSafeNumericExpression(expr, enriched);
      if (val !== null) enriched[outField] = val;
    }
    if (!projected) return enriched;
    const slim = {};
    for (const f of projected) {
      if (f in enriched) slim[f] = enriched[f];
    }
    return slim;
  });
}

function applyGroupByAggregations(records, groupByField, aggsSpec) {
  const buckets = new Map();
  for (const rec of records) {
    const gKey = String(rec?.[groupByField] ?? "__null__");
    if (!buckets.has(gKey)) buckets.set(gKey, []);
    buckets.get(gKey).push(rec);
  }
  const out = [];
  for (const [gKey, items] of buckets.entries()) {
    const row = { [groupByField]: gKey, count: items.length };
    if (aggsSpec && typeof aggsSpec === "object") {
      for (const [alias, spec] of Object.entries(aggsSpec)) {
        const op = String(spec?.op || "count").toLowerCase();
        const field = String(spec?.field || "");
        const nums = items.map((x) => Number(x?.[field])).filter((n) => Number.isFinite(n));
        if (op === "count") row[alias] = items.length;
        else if (op === "sum") row[alias] = nums.reduce((a, b) => a + b, 0);
        else if (op === "avg") row[alias] = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
        else if (op === "min") row[alias] = nums.length ? Math.min(...nums) : null;
        else if (op === "max") row[alias] = nums.length ? Math.max(...nums) : null;
      }
    }
    out.push(row);
  }
  return out;
}

export async function handleEndpointsCatalogRequest(request, db, publicUrl, infraAllowed, gatewayOps) {
  await ensureOnDemandApiSchema(db);
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (method === "GET" || method === "HEAD") {
    const visClause = infraAllowed ? "" : "WHERE visibility != 'server_infra'";
    const rows = await db
      .prepare(
        `SELECT object_key, category, summary, sha256_hash, version_num, visibility, producer_agent, created_at
         FROM herma_task_objects
         ${visClause}
         ORDER BY id DESC
         LIMIT ?`
      )
      .bind(ON_DEMAND_API_GRID.invocation_log_limit)
      .all();

    const seen = new Set();
    const endpoints = [];
    for (const r of rows?.results || []) {
      if (seen.has(r.object_key)) continue;
      if (
        r.category === "on_demand_api_endpoint" ||
        r.category === "api_endpoint_spec" ||
        String(r.object_key).startsWith("api_")
      ) {
        seen.add(r.object_key);
        endpoints.push({
          object_key: r.object_key,
          category: r.category,
          summary: r.summary,
          version: Number(r.version_num || 1),
          sha256: r.sha256_hash,
          visibility: r.visibility,
          producer_agent: r.producer_agent,
          endpoint_url: `${publicUrl}/q/api/${encodeURIComponent(r.object_key)}`,
          spec_url: `${publicUrl}/q/api/${encodeURIComponent(r.object_key)}/_spec`,
          object_url: `${publicUrl}/q/objects/${encodeURIComponent(r.object_key)}`,
          created_at: r.created_at,
        });
      }
    }
    return {
      status: ON_DEMAND_API_GRID.http_ok,
      body: {
        ok: true,
        schema: "herma.on_demand_endpoints.catalog.v1",
        primitive_alignment: "standard_task_objects_zero_rival_authority",
        endpoints_count: endpoints.length,
        endpoints,
      },
    };
  }

  if (method !== "POST") {
    return {
      status: ON_DEMAND_API_GRID.http_method_not_allowed,
      body: { ok: false, code: "method_not_allowed" },
    };
  }

  let body = {};
  try {
    const rawTxt = await request.text();
    body = rawTxt.trim() ? JSON.parse(rawTxt) : {};
  } catch {
    return {
      status: ON_DEMAND_API_GRID.http_bad_request,
      body: { ok: false, code: "invalid_json" },
    };
  }

  const presentedScoped = extractPresentedScopedKey(request, url, body);
  const scopedAuth = presentedScoped
    ? await authenticateScopedKey(db, presentedScoped, { touchUsage: true })
    : { ok: false };

  const objectKey = String(body.object_key || body.endpoint_key || "").trim();
  if (!objectKey) {
    return {
      status: ON_DEMAND_API_GRID.http_bad_request,
      body: { ok: false, code: "missing_object_key", detail: "Provide object_key for the TaskObject API endpoint." },
    };
  }
  const rawEndpointSpec = body.api_endpoint || body.endpoint_spec || body.spec || {};
  if (containsRawCapabilitySecret(JSON.stringify(rawEndpointSpec))) {
    return {
      status: ON_DEMAND_API_GRID.http_bad_request,
      body: {
        ok: false,
        code: "plaintext_secret_rejected",
        detail: "Never embed plaintext capability keys inside TaskObject payloads; use /q/keys instead.",
      },
    };
  }

  const agentId = String(body.agent_id || scopedAuth.owner_agent_id || "api-publisher").trim();
  const workerUuid = String(body.worker_uuid || scopedAuth.owner_worker_uuid || "").trim();
  const workerToken = String(
    body.worker_token || request.headers.get("x-herma-worker-token") || ""
  ).trim();

  const submitOut = await gatewayOps.submitTaskFromChat({
    agent_id: agentId,
    worker_uuid: workerUuid,
    worker_token: workerToken,
    task_id: "self_seed",
    summary: body.summary || `Published on-demand TaskObject API endpoint ${objectKey}`,
    task_objects: [
      {
        object_key: objectKey,
        category: "on_demand_api_endpoint",
        visibility: body.visibility || "public_commons",
        summary: body.summary || rawEndpointSpec.title || `On-demand TaskObject API: ${objectKey}`,
        labels: Array.isArray(body.labels)
          ? [...new Set([...body.labels, "on_demand_api_endpoint"])]
          : ["on_demand_api_endpoint", "short_circuit_7gate"],
        payload: {
          schema: "herma.task_object.api_endpoint.v1",
          api_endpoint: rawEndpointSpec,
        },
      },
    ],
  });

  if (submitOut?.forbidden) {
    return {
      status: ON_DEMAND_API_GRID.http_forbidden,
      body: { ok: false, code: submitOut.code || "forbidden", detail: submitOut.detail },
    };
  }
  if (submitOut?.conflict) {
    return {
      status: ON_DEMAND_API_GRID.http_conflict,
      body: { ok: false, code: submitOut.code || "conflict", detail: submitOut.detail },
    };
  }
  const stored = submitOut?.stored_task_objects?.[0] || { object_key: objectKey };
  return {
    status: ON_DEMAND_API_GRID.http_created,
    body: {
      ok: true,
      schema: "herma.on_demand_endpoints.register.v1",
      object_key: stored.object_key,
      sha256: stored.sha256 || null,
      version: stored.version || 1,
      endpoint_url: `${publicUrl}/q/api/${encodeURIComponent(stored.object_key)}`,
      spec_url: `${publicUrl}/q/api/${encodeURIComponent(stored.object_key)}/_spec`,
      object_url: `${publicUrl}/q/objects/${encodeURIComponent(stored.object_key)}`,
    },
  };
}

export async function handleOnDemandObjectApiInvocation(
  request,
  env,
  db,
  publicUrl,
  infraAllowed,
  gatewayOps,
  objectKey,
  subRoute = ""
) {
  const t0 = performance.now();
  await ensureOnDemandApiSchema(db);
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (!objectKey) {
    return {
      status: ON_DEMAND_API_GRID.http_bad_request,
      body: { ok: false, code: "missing_endpoint_object_key" },
    };
  }

  let reqBody = {};
  if (method === "POST") {
    try {
      const txt = await request.text();
      reqBody = txt ? JSON.parse(txt) : {};
    } catch {
      return {
        status: ON_DEMAND_API_GRID.http_bad_request,
        body: { ok: false, code: "invalid_json" },
      };
    }
  } else if (method !== "GET" && method !== "HEAD") {
    return {
      status: ON_DEMAND_API_GRID.http_method_not_allowed,
      body: { ok: false, code: "method_not_allowed" },
    };
  }

  // Resolve underlying TaskObject (honoring @sha256 pin or ?version=)
  const objRes = await gatewayOps.lookupTaskObjectByKey(objectKey, {
    sha256: url.searchParams.get("sha256") || "",
    version: url.searchParams.get("version") || "",
  });
  if (objRes.forbidden) {
    return {
      status: ON_DEMAND_API_GRID.http_forbidden,
      body: { ok: false, code: "forbidden_endpoint", detail: "Endpoint is restricted to server_infra." },
    };
  }
  if (objRes.notFound || !objRes.object) {
    return {
      status: ON_DEMAND_API_GRID.http_not_found,
      body: { ok: false, code: "endpoint_object_not_found", object_key: objectKey },
    };
  }

  const objDoc = objRes.object;
  const spec = extractEndpointSpecFromPayload(objDoc.payload, objDoc);
  if (!spec) {
    return {
      status: ON_DEMAND_API_GRID.http_bad_request,
      body: {
        ok: false,
        code: "object_not_structured_for_api",
        detail: `TaskObject '${objDoc.object_key}' does not contain a JSON object/array API payload.`,
      },
    };
  }

  // Ring 0 / Ring 1: Scoped Key & Auth Gate + Observe Counterfactual Gate
  const observeParam = String(
    url.searchParams.get("observe") ||
      request.headers.get("x-herma-observe-mode") ||
      reqBody.observe_mode ||
      "calibrated_auto"
  ).toLowerCase();
  const isObserveShadow = observeParam === "shadow" || observeParam === "observe_shadow" || observeParam === "1";

  const presentedScoped = extractPresentedScopedKey(request, url, reqBody);
  const scopedAuth = presentedScoped
    ? await authenticateScopedKey(db, presentedScoped, { touchUsage: !isObserveShadow })
    : { ok: false, present: false };

  if (scopedAuth.present && !scopedAuth.ok) {
    return {
      status: scopedAuth.rateLimited ? ON_DEMAND_API_GRID.http_rate_limited : ON_DEMAND_API_GRID.http_unauthorized,
      body: { ok: false, code: scopedAuth.code || "invalid_api_key", detail: scopedAuth.detail },
    };
  }

  const workerToken = String(
    reqBody.worker_token || request.headers.get("x-herma-worker-token") || url.searchParams.get("worker_token") || ""
  ).trim();
  const objWorkerUuid = objDoc.worker_uuid || objDoc.producer_worker_uuid || "";
  const objVersion = Number(objDoc.version_num ?? objDoc.version ?? 1);
  const objSha256 = String(objDoc.sha256_hash || objDoc.sha256 || "");

  let verifiedWorkerOwner = false;
  if (workerToken && !workerToken.startsWith("hk_") && objWorkerUuid) {
    const wCheck = await gatewayOps.verifyWorkerUuidAccess({
      agentId: objDoc.producer_agent || "worker",
      workerUuid: objWorkerUuid,
      workerToken,
      infraAllowed,
    });
    verifiedWorkerOwner = Boolean(wCheck.ok && wCheck.tokenVerified);
  }

  if (spec.auth_mode !== "public" && !infraAllowed) {
    if (spec.auth_mode === "infra_key") {
      if (!(scopedAuth.ok && scopedAuth.key_class === "infra")) {
        return {
          status: ON_DEMAND_API_GRID.http_forbidden,
          body: { ok: false, code: "infra_key_required", detail: "Endpoint requires an active infra key." },
        };
      }
    } else if (spec.auth_mode === "worker_key") {
      if (!(verifiedWorkerOwner || (scopedAuth.ok && (scopedAuth.key_class === "worker" || scopedAuth.key_class === "infra")))) {
        return {
          status: ON_DEMAND_API_GRID.http_unauthorized,
          body: { ok: false, code: "worker_key_required", detail: "Endpoint requires an active worker key." },
        };
      }
    } else if (spec.auth_mode === "endpoint_key") {
      const endpointAllowed =
        verifiedWorkerOwner ||
        (scopedAuth.ok &&
          (scopedAuth.key_class === "infra" ||
            scopedAuth.allowed_endpoints.includes("*") ||
            scopedAuth.allowed_endpoints.includes(objDoc.object_key)));
      if (!endpointAllowed) {
        return {
          status: ON_DEMAND_API_GRID.http_unauthorized,
          body: {
            ok: false,
            code: "endpoint_key_required",
            detail: `Endpoint '${objDoc.object_key}' requires a scoped hk_ep_* key authorized for this endpoint.`,
          },
        };
      }
    }
  }

  const logInvocation = async (gate, shortCircuited, statusCode) => {
    if (isObserveShadow || method === "HEAD") return;
    const lat = Math.max(0.05, performance.now() - t0);
    await db
      .prepare(
        `INSERT INTO herma_api_invocation_log
         (endpoint_key, gate_resolved, short_circuited, observe_mode, status_code, latency_ms, caller_key_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        objDoc.object_key,
        gate,
        shortCircuited ? 1 : 0,
        observeParam,
        statusCode,
        lat,
        scopedAuth.key_id || "",
        new Date().toISOString()
      )
      .run();
  };

  // Load intraday delta watermark stats
  const deltaStatRow = await db
    .prepare(
      `SELECT COALESCE(MAX(delta_seq), 0) AS max_seq,
              COUNT(*) AS pending_deltas,
              COUNT(DISTINCT entity_id) AS dirty_entities
       FROM herma_api_intraday_deltas
       WHERE endpoint_key = ? AND delta_seq > ?`
    )
    .bind(objDoc.object_key, spec.snapshot_watermark_seq)
    .first();

  const maxDeltaSeq = Math.max(spec.snapshot_watermark_seq, Number(deltaStatRow?.max_seq || 0));
  const pendingDeltas = Number(deltaStatRow?.pending_deltas || 0);
  const dirtyEntities = Number(deltaStatRow?.dirty_entities || 0);
  const baseCount = Math.max(1, spec.records.length);
  const dirtyRatio = dirtyEntities / baseCount;

  // Subroute 1: `/_spec`
  if (subRoute === "_spec") {
    return {
      status: ON_DEMAND_API_GRID.http_ok,
      body: {
        ok: true,
        schema: "herma.on_demand_endpoint.spec.v1",
        object_key: objDoc.object_key,
        version: objVersion,
        sha256: objSha256,
        title: spec.title,
        description: spec.description,
        auth_mode: spec.auth_mode,
        primary_key: spec.primary_key,
        snapshot_records_count: spec.records.length,
        lambda_delta_state: {
          snapshot_watermark_seq: spec.snapshot_watermark_seq,
          current_max_delta_seq: maxDeltaSeq,
          pending_intraday_deltas: pendingDeltas,
          dirty_entities: dirtyEntities,
          dirty_ratio: Number(dirtyRatio.toFixed(4)),
          dirty_crossover_threshold: spec.dirty_crossover_threshold,
        },
        computed_fields: spec.computed_fields,
        fuzzy_fields: spec.fuzzy_fields,
        tau_margin: spec.tau_margin,
        gates_pipeline: [
          "SC-0_negative_sieve",
          "SC-1_singleflight_memo",
          "SC-2_lambda_delta_rollup",
          "SC-3_structured_pipeline",
          "SC-4_fuzzy_top2_margin",
          "SC-6_async_bulkhead_task",
        ],
        named_routes: Object.keys(spec.routes),
      },
    };
  }

  // Subroute 2: `/_delta` (Append Intraday Delta Mutation)
  if (subRoute === "_delta") {
    if (method !== "POST") {
      return {
        status: ON_DEMAND_API_GRID.http_method_not_allowed,
        body: { ok: false, code: "method_not_allowed" },
      };
    }
    const canWriteDelta =
      infraAllowed ||
      verifiedWorkerOwner ||
      (scopedAuth.ok &&
        scopedAuth.scopes.includes("api:write_delta") &&
        (scopedAuth.key_class === "infra" ||
          (objWorkerUuid && scopedAuth.owner_worker_uuid === objWorkerUuid) ||
          scopedAuth.allowed_endpoints.includes(objDoc.object_key) ||
          scopedAuth.allowed_endpoints.includes("*")));
    if (!canWriteDelta) {
      return {
        status: ON_DEMAND_API_GRID.http_forbidden,
        body: {
          ok: false,
          code: "delta_write_forbidden",
          detail: "Writing intraday deltas requires owner worker credentials, api:write_delta scoped key, or server_infra.",
        },
      };
    }
    const entityId = String(reqBody.entity_id ?? reqBody.id ?? "").trim();
    if (!entityId) {
      return {
        status: ON_DEMAND_API_GRID.http_bad_request,
        body: { ok: false, code: "missing_entity_id" },
      };
    }
    const opKind = VALID_DELTA_OPS.has(reqBody.op_kind) ? reqBody.op_kind : "patch";
    const deltaPayload = reqBody.delta && typeof reqBody.delta === "object" ? reqBody.delta : {};
    const deltaJson = JSON.stringify(deltaPayload);
    if (new TextEncoder().encode(deltaJson).byteLength > ON_DEMAND_API_GRID.max_delta_json_bytes) {
      return {
        status: ON_DEMAND_API_GRID.http_bad_request,
        body: { ok: false, code: "delta_too_large" },
      };
    }
    if (containsRawCapabilitySecret(deltaJson)) {
      return {
        status: ON_DEMAND_API_GRID.http_bad_request,
        body: { ok: false, code: "plaintext_secret_rejected" },
      };
    }
    if (isObserveShadow) {
      return {
        status: ON_DEMAND_API_GRID.http_ok,
        body: {
          ok: true,
          observe_mode: "shadow",
          mutations_suppressed: true,
          preview_delta: { endpoint_key: objDoc.object_key, entity_id: entityId, op_kind: opKind, delta: deltaPayload },
        },
      };
    }
    const nowIso = new Date().toISOString();
    const ins = await db
      .prepare(
        `INSERT INTO herma_api_intraday_deltas (endpoint_key, entity_id, op_kind, delta_json, author_agent_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        objDoc.object_key,
        entityId,
        opKind,
        deltaJson,
        scopedAuth.owner_agent_id || objDoc.producer_agent || "delta-writer",
        nowIso
      )
      .run();

    return {
      status: ON_DEMAND_API_GRID.http_created,
      body: {
        ok: true,
        schema: "herma.on_demand_endpoint.delta.v1",
        endpoint_key: objDoc.object_key,
        entity_id: entityId,
        op_kind: opKind,
        delta_seq: Number(ins?.meta?.last_row_id || maxDeltaSeq + 1),
        created_at: nowIso,
      },
    };
  }

  // Subroute 3: `/_compact` (Fold Intraday Deltas into New Immutable TaskObject Snapshot Version)
  if (subRoute === "_compact") {
    if (method !== "POST") {
      return {
        status: ON_DEMAND_API_GRID.http_method_not_allowed,
        body: { ok: false, code: "method_not_allowed" },
      };
    }
    const canCompact =
      infraAllowed ||
      verifiedWorkerOwner ||
      (scopedAuth.ok &&
        (scopedAuth.key_class === "infra" ||
          (objWorkerUuid && scopedAuth.owner_worker_uuid === objWorkerUuid)));
    if (!canCompact) {
      return {
        status: ON_DEMAND_API_GRID.http_forbidden,
        body: {
          ok: false,
          code: "compact_forbidden",
          detail: "Compacting intraday deltas into a new snapshot version requires endpoint owner or server_infra.",
        },
      };
    }
    const pk = spec.primary_key;
    const mergedMap = new Map();
    for (const rec of spec.records) {
      if (rec && typeof rec === "object" && rec[pk] !== undefined) {
        mergedMap.set(String(rec[pk]), rec);
      }
    }
    const deltaRows = await db
      .prepare(
        `SELECT entity_id, op_kind, delta_json, delta_seq
         FROM herma_api_intraday_deltas
         WHERE endpoint_key = ? AND delta_seq > ?
         ORDER BY delta_seq ASC
         LIMIT ?`
      )
      .bind(objDoc.object_key, spec.snapshot_watermark_seq, ON_DEMAND_API_GRID.max_delta_batch_read)
      .all();
    let newWatermark = spec.snapshot_watermark_seq;
    for (const dr of deltaRows?.results || []) {
      let parsedDelta = {};
      try {
        parsedDelta = JSON.parse(dr.delta_json || "{}");
      } catch {
        parsedDelta = {};
      }
      const nextVal = applyDeltaMutation(mergedMap.get(String(dr.entity_id)), dr.op_kind, parsedDelta, pk, String(dr.entity_id));
      if (nextVal === null) mergedMap.delete(String(dr.entity_id));
      else mergedMap.set(String(dr.entity_id), nextVal);
      if (Number(dr.delta_seq || 0) > newWatermark) newWatermark = Number(dr.delta_seq);
    }
    const compactedRecords = Array.from(mergedMap.values());
    if (isObserveShadow) {
      return {
        status: ON_DEMAND_API_GRID.http_ok,
        body: {
          ok: true,
          observe_mode: "shadow",
          mutations_suppressed: true,
          compacted_records_count: compactedRecords.length,
          next_snapshot_watermark_seq: newWatermark,
        },
      };
    }
    const rawOrig = objDoc.payload && typeof objDoc.payload === "object" ? objDoc.payload : {};
    const origEndpoint = rawOrig.api_endpoint && typeof rawOrig.api_endpoint === "object" ? rawOrig.api_endpoint : rawOrig;
    const nextPayload = {
      ...rawOrig,
      api_endpoint: {
        ...origEndpoint,
        primary_key: pk,
        snapshot_watermark_seq: newWatermark,
        records: compactedRecords,
      },
    };
    const compactOut = await gatewayOps.submitTaskFromChat({
      agent_id: objDoc.producer_agent || scopedAuth.owner_agent_id || "snapshot-compactor",
      worker_uuid: objWorkerUuid,
      worker_token: workerToken,
      task_id: "self_seed",
      summary: `Compacted ${pendingDeltas} intraday deltas into snapshot watermark=${newWatermark} for ${objDoc.object_key}`,
      task_objects: [
        {
          object_key: objDoc.object_key,
          category: objDoc.category || "on_demand_api_endpoint",
          visibility: objDoc.visibility || "public_commons",
          summary: objDoc.summary,
          labels: objDoc.labels || ["on_demand_api_endpoint"],
          payload: nextPayload,
        },
      ],
    });
    const storedObj = compactOut?.stored_task_objects?.[0] || {};
    return {
      status: ON_DEMAND_API_GRID.http_ok,
      body: {
        ok: true,
        schema: "herma.on_demand_endpoint.compact.v1",
        object_key: objDoc.object_key,
        previous_watermark_seq: spec.snapshot_watermark_seq,
        new_watermark_seq: newWatermark,
        folded_deltas_count: pendingDeltas,
        compacted_records_count: compactedRecords.length,
        version: storedObj.version || objVersion + 1,
        sha256: storedObj.sha256 || null,
      },
    };
  }

  // Merge query parameters + POST JSON + named subRoute preset if defined
  const routePreset = subRoute && spec.routes[subRoute] && typeof spec.routes[subRoute] === "object" ? spec.routes[subRoute] : {};
  const queryParamsObj = Object.fromEntries(url.searchParams.entries());
  const params = { ...routePreset, ...queryParamsObj, ...reqBody };

  // Active swappable backend nodes (with optional per-request A/B override `?ranking_node=...`)
  const activeNodes = await getActiveSwappableNodesMap(db);
  let rankingNode = activeNodes.ranking;
  if (params.ranking_node) {
    const customRank = await db
      .prepare("SELECT * FROM herma_swappable_nodes WHERE slot_id = 'ranking' AND node_id = ? LIMIT 1")
      .bind(String(params.ranking_node))
      .first();
    if (customRank) {
      try {
        rankingNode = {
          node_id: customRank.node_id,
          grid_params: JSON.parse(customRank.grid_params_json || "{}"),
        };
      } catch {
        // keep active
      }
    }
  }
  const threshParams = activeNodes.threshold_calibrator?.grid_params || {};
  const effectiveCrossover = Number(
    params.dirty_crossover_threshold ?? spec.dirty_crossover_threshold ?? threshParams.dirty_crossover_threshold ?? ON_DEMAND_API_GRID.dirty_crossover_threshold
  );
  const effectiveTauMargin = Number(
    params.tau_margin ?? spec.tau_margin ?? threshParams.fuzzy_top2_margin ?? ON_DEMAND_API_GRID.default_fuzzy_top2_margin
  );

  const lookupId = params.entity_id !== undefined ? String(params.entity_id) : params.id !== undefined ? String(params.id) : "";
  const lookupBatchIds = Array.isArray(params.entity_ids) ? params.entity_ids.map(String) : null;
  const fuzzyQuery = String(params.q || params.query || "").trim();
  const forceAsync =
    params.mode === "async_task" ||
    params.async === true ||
    params.async === "1" ||
    Number(params.complexity || 0) >= spec.async_complexity_threshold;

  // Gate SC-6 (Explicit or Complexity-Triggered Async Bulkhead Durable Task Fanout)
  if (forceAsync) {
    if (isObserveShadow) {
      return {
        status: ON_DEMAND_API_GRID.http_ok,
        body: {
          ok: true,
          gate: "SC-6_async_bulkhead_task",
          short_circuited: false,
          observe_mode: "shadow",
          mutations_suppressed: true,
          would_enqueue_task: true,
        },
      };
    }
    const taskPrompt = scrubSensitiveText(
      params.task_prompt ||
        `Execute bulkhead async analysis on TaskObject endpoint '${objDoc.object_key}' for query='${fuzzyQuery || lookupId || "batch_synthesis"}'.`
    );
    const subTaskOut = await gatewayOps.submitTaskFromChat({
      agent_id: scopedAuth.owner_agent_id || "endpoint-bulkhead-router",
      worker_uuid: scopedAuth.owner_worker_uuid || "",
      task_id: "self_seed",
      summary: `Bulkhead async escalation from /q/api/${objDoc.object_key}`,
      queued_tasks: [
        {
          title: `[Endpoint Async] ${objDoc.object_key}: ${(fuzzyQuery || lookupId || "complex_synthesis").slice(0, 80)}`,
          prompt: taskPrompt,
          tier: objDoc.visibility === "server_infra" ? "infra_private" : "public_general",
          priority: ON_DEMAND_API_GRID.async_task_priority_base,
          labels: ["endpoint_async_escalation", objDoc.object_key],
        },
      ],
    });
    const enqTask = subTaskOut?.enqueued_followup_verbs?.[0] || null;
    await logInvocation("SC-6_async_bulkhead_task", false, ON_DEMAND_API_GRID.http_accepted);
    return {
      status: ON_DEMAND_API_GRID.http_accepted,
      body: {
        ok: true,
        schema: "herma.on_demand_endpoint.async_accepted.v1",
        gate: "SC-6_async_bulkhead_task",
        short_circuited: false,
        llm_tokens_used: 0,
        endpoint_key: objDoc.object_key,
        task_id: enqTask?.task_id || null,
        task_status_url: enqTask?.task_id ? `${publicUrl}/c/${encodeURIComponent(enqTask.task_id)}` : null,
        chat_url: `${publicUrl}/q/chat`,
      },
    };
  }

  // Gate SC-0: Partitioned Prefix / Domain / Numeric Zone Negative Sieve (0 DB delta reads, 0 tokens)
  if (lookupId) {
    let definiteMissReason = "";
    if (spec.id_prefix && !lookupId.startsWith(spec.id_prefix)) {
      definiteMissReason = `entity_id '${lookupId}' does not match required prefix '${spec.id_prefix}'`;
    } else if (spec.valid_id_set && pendingDeltas === 0 && !spec.valid_id_set.has(lookupId)) {
      definiteMissReason = `entity_id '${lookupId}' is outside static valid_ids set`;
    } else if (spec.numeric_id_bounds) {
      const nId = Number(lookupId);
      if (
        !Number.isFinite(nId) ||
        (spec.numeric_id_bounds.min !== undefined && nId < Number(spec.numeric_id_bounds.min)) ||
        (spec.numeric_id_bounds.max !== undefined && nId > Number(spec.numeric_id_bounds.max))
      ) {
        definiteMissReason = `entity_id '${lookupId}' outside numeric zone map`;
      }
    }
    if (definiteMissReason) {
      await logInvocation("SC-0_negative_sieve", true, ON_DEMAND_API_GRID.http_ok);
      if (activeNodes.short_circuit_router && !isObserveShadow) {
        await recordSwappableNodeOutcome(db, "short_circuit_router", activeNodes.short_circuit_router.node_id, {
          success: true,
          latencyMs: performance.now() - t0,
          shortCircuited: true,
        });
      }
      return {
        status: ON_DEMAND_API_GRID.http_ok,
        body: {
          ok: true,
          schema: "herma.on_demand_endpoint.response.v1",
          endpoint_key: objDoc.object_key,
          gate: "SC-0_negative_sieve",
          short_circuited: true,
          llm_tokens_used: 0,
          found: false,
          reason: definiteMissReason,
          result: null,
        },
      };
    }
  }

  // Gate SC-1: Singleflight Coalescer & Watermark-Pinned Memo Cache
  const memoKey = await sha256HexLocal(
    JSON.stringify({
      ep: objDoc.object_key,
      sha: objSha256,
      seq: maxDeltaSeq,
      subRoute,
      params,
      rankNode: rankingNode?.node_id || "",
    })
  );
  const nowMs = Date.now();
  const cachedMemo = WATERMARK_MEMO_CACHE.get(memoKey);
  if (cachedMemo && nowMs - cachedMemo.ts < ON_DEMAND_API_GRID.singleflight_memo_ttl_ms && !params.bypass_cache) {
    await logInvocation("SC-1_singleflight_memo", true, ON_DEMAND_API_GRID.http_ok);
    return {
      status: ON_DEMAND_API_GRID.http_ok,
      body: {
        ...cachedMemo.payload,
        gate: "SC-1_singleflight_memo",
        short_circuited: true,
        cache_watermark_seq: maxDeltaSeq,
      },
    };
  }

  if (IN_FLIGHT_SINGLEFLIGHT.has(memoKey)) {
    const sharedBody = await IN_FLIGHT_SINGLEFLIGHT.get(memoKey);
    return {
      status: ON_DEMAND_API_GRID.http_ok,
      body: {
        ...sharedBody,
        gate: "SC-1_singleflight_coalesced",
        short_circuited: true,
      },
    };
  }

  const computePromise = (async () => {
    const pk = spec.primary_key;

    // Gate SC-2: Overnight Batch Rollup + Partial-Index Intraday Delta-Patch (`Lambda-Delta`)
    if ((lookupId || lookupBatchIds) && dirtyRatio < effectiveCrossover) {
      const targetIds = lookupBatchIds || [lookupId];
      const baseMap = new Map();
      for (const rec of spec.records) {
        if (rec && typeof rec === "object" && rec[pk] !== undefined) {
          baseMap.set(String(rec[pk]), rec);
        }
      }
      if (pendingDeltas > 0 && targetIds.length > 0) {
        const ph = targetIds.map(() => "?").join(",");
        const dRows = await db
          .prepare(
            `SELECT entity_id, op_kind, delta_json, delta_seq
             FROM herma_api_intraday_deltas
             WHERE endpoint_key = ? AND delta_seq > ? AND entity_id IN (${ph})
             ORDER BY delta_seq ASC`
          )
          .bind(objDoc.object_key, spec.snapshot_watermark_seq, ...targetIds)
          .all();
        for (const dr of dRows?.results || []) {
          let parsedDelta = {};
          try {
            parsedDelta = JSON.parse(dr.delta_json || "{}");
          } catch {
            parsedDelta = {};
          }
          const nextVal = applyDeltaMutation(baseMap.get(String(dr.entity_id)), dr.op_kind, parsedDelta, pk, String(dr.entity_id));
          if (nextVal === null) baseMap.delete(String(dr.entity_id));
          else baseMap.set(String(dr.entity_id), nextVal);
        }
      }
      const matched = targetIds.map((tid) => baseMap.get(tid)).filter(Boolean);
      const enriched = applyComputedFieldsAndProjection(matched, spec.computed_fields, params.select);
      return {
        ok: true,
        schema: "herma.on_demand_endpoint.response.v1",
        endpoint_key: objDoc.object_key,
        gate: "SC-2_lambda_delta_rollup",
        short_circuited: true,
        llm_tokens_used: 0,
        dirty_ratio: Number(dirtyRatio.toFixed(4)),
        dirty_crossover_threshold: effectiveCrossover,
        watermark_seq: maxDeltaSeq,
        found: enriched.length > 0,
        result: lookupBatchIds ? enriched : enriched[0] || null,
      };
    }

    // Materialize full dataset ( Snapshot + all Intraday Deltas ) for SC-3 / SC-4 or high-dirty crossover
    const fullMap = new Map();
    for (let idx = 0; idx < spec.records.length; idx += 1) {
      const rec = spec.records[idx];
      if (rec && typeof rec === "object") {
        const keyVal = rec[pk] !== undefined ? String(rec[pk]) : `__idx_${idx}`;
        fullMap.set(keyVal, rec);
      }
    }
    if (pendingDeltas > 0) {
      const allDeltas = await db
        .prepare(
          `SELECT entity_id, op_kind, delta_json
           FROM herma_api_intraday_deltas
           WHERE endpoint_key = ? AND delta_seq > ?
           ORDER BY delta_seq ASC
           LIMIT ?`
        )
        .bind(objDoc.object_key, spec.snapshot_watermark_seq, ON_DEMAND_API_GRID.max_delta_batch_read)
        .all();
      for (const dr of allDeltas?.results || []) {
        let parsedDelta = {};
        try {
          parsedDelta = JSON.parse(dr.delta_json || "{}");
        } catch {
          parsedDelta = {};
        }
        const nextVal = applyDeltaMutation(fullMap.get(String(dr.entity_id)), dr.op_kind, parsedDelta, pk, String(dr.entity_id));
        if (nextVal === null) fullMap.delete(String(dr.entity_id));
        else fullMap.set(String(dr.entity_id), nextVal);
      }
    }

    let working = Array.from(fullMap.values());

    // Optional TaskObject-to-TaskObject lookup join
    const joinKey = String(params.join_object_key || spec.join_object_key || "").trim();
    if (joinKey && (params.join_local_field || spec.join_local_field)) {
      const foreignRes = await gatewayOps.lookupTaskObjectByKey(joinKey, {});
      if (foreignRes?.object?.payload) {
        const foreignSpec = extractEndpointSpecFromPayload(foreignRes.object.payload, foreignRes.object);
        if (foreignSpec?.records?.length) {
          const lField = String(params.join_local_field || spec.join_local_field);
          const fField = String(params.join_foreign_field || spec.join_foreign_field || "id");
          const fMap = new Map();
          for (const frec of foreignSpec.records) {
            if (frec && frec[fField] !== undefined) fMap.set(String(frec[fField]), frec);
          }
          working = working.map((rec) => ({
            ...rec,
            joined_record: fMap.get(String(rec?.[lField] ?? "")) || null,
          }));
        }
      }
    }

    if (lookupId || lookupBatchIds) {
      const idSet = new Set(lookupBatchIds || [lookupId]);
      working = working.filter((r) => idSet.has(String(r?.[pk] ?? "")));
      const enriched = applyComputedFieldsAndProjection(working, spec.computed_fields, params.select);
      return {
        ok: true,
        schema: "herma.on_demand_endpoint.response.v1",
        endpoint_key: objDoc.object_key,
        gate: "SC-3_covering_scan_crossover",
        short_circuited: true,
        llm_tokens_used: 0,
        dirty_ratio: Number(dirtyRatio.toFixed(4)),
        dirty_crossover_threshold: effectiveCrossover,
        watermark_seq: maxDeltaSeq,
        found: enriched.length > 0,
        result: lookupBatchIds ? enriched : enriched[0] || null,
      };
    }

    // Apply declarative `where` filter + `computed_fields`
    if (params.where && typeof params.where === "object") {
      working = working.filter((r) => matchesWhereClause(r, params.where));
    }
    working = applyComputedFieldsAndProjection(working, spec.computed_fields, null);

    // Gate SC-4: Fuzzy SymSpell/Edit-Distance + Trigram Top-2 Margin Gate
    if (fuzzyQuery) {
      const scored = working
        .map((rec) => ({
          rec,
          score: scoreRecordFuzzySimilarity(fuzzyQuery, rec, spec.fuzzy_fields, rankingNode?.grid_params),
        }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);

      const top1 = scored[0]?.score || 0;
      const top2 = scored[1]?.score || 0;
      const margin = top1 - top2;
      const decisiveHit =
        top1 >= ON_DEMAND_API_GRID.default_fuzzy_min_top1 &&
        (scored.length === 1 || margin >= effectiveTauMargin || !spec.escalate_to_queue);

      if (!decisiveHit && spec.escalate_to_queue && params.escalate_on_ambiguous) {
        return {
          __escalate_async: true,
          top1,
          top2,
          margin,
        };
      }

      const limit = Math.floor(
        clampNumeric(
          params.limit ?? ON_DEMAND_API_GRID.default_result_limit,
          1,
          ON_DEMAND_API_GRID.max_result_limit
        )
      );
      const topRecords = applyComputedFieldsAndProjection(
        scored.slice(0, limit).map((s) => ({ ...s.rec, _match_score: Number(s.score.toFixed(4)) })),
        {},
        params.select
      );
      return {
        ok: true,
        schema: "herma.on_demand_endpoint.response.v1",
        endpoint_key: objDoc.object_key,
        gate: "SC-4_fuzzy_top2_margin",
        short_circuited: true,
        llm_tokens_used: 0,
        ranking_node_id: rankingNode?.node_id || null,
        fuzzy_diagnostics: {
          query: fuzzyQuery,
          top1_score: Number(top1.toFixed(4)),
          top2_score: Number(top2.toFixed(4)),
          top2_margin: Number(margin.toFixed(4)),
          tau_margin: effectiveTauMargin,
          decisive_margin: margin >= effectiveTauMargin || scored.length === 1,
        },
        total_matches: scored.length,
        results: topRecords,
      };
    }

    // Gate SC-3: Structured Group-By / Sort / Limit Projection
    if (params.group_by) {
      const grouped = applyGroupByAggregations(working, String(params.group_by), params.aggregations);
      return {
        ok: true,
        schema: "herma.on_demand_endpoint.response.v1",
        endpoint_key: objDoc.object_key,
        gate: "SC-3_structured_pipeline",
        short_circuited: true,
        llm_tokens_used: 0,
        watermark_seq: maxDeltaSeq,
        groups_count: grouped.length,
        results: grouped,
      };
    }

    if (params.sort_by) {
      const sField = String(params.sort_by);
      const desc = String(params.sort_dir || "desc").toLowerCase() !== "asc";
      working.sort((a, b) => {
        const av = a?.[sField];
        const bv = b?.[sField];
        if (typeof av === "number" && typeof bv === "number") return desc ? bv - av : av - bv;
        return desc
          ? String(bv ?? "").localeCompare(String(av ?? ""))
          : String(av ?? "").localeCompare(String(bv ?? ""));
      });
    }

    const limit = Math.floor(
      clampNumeric(
        params.limit ?? ON_DEMAND_API_GRID.default_result_limit,
        1,
        ON_DEMAND_API_GRID.max_result_limit
      )
    );
    const sliced = applyComputedFieldsAndProjection(working.slice(0, limit), {}, params.select);
    return {
      ok: true,
      schema: "herma.on_demand_endpoint.response.v1",
      endpoint_key: objDoc.object_key,
      gate: "SC-3_structured_pipeline",
      short_circuited: true,
      llm_tokens_used: 0,
      watermark_seq: maxDeltaSeq,
      total_records: working.length,
      results: sliced,
    };
  })();

  IN_FLIGHT_SINGLEFLIGHT.set(memoKey, computePromise);
  let computed;
  try {
    computed = await computePromise;
  } finally {
    IN_FLIGHT_SINGLEFLIGHT.delete(memoKey);
  }

  if (computed?.__escalate_async) {
    const subTaskOut = isObserveShadow
      ? null
      : await gatewayOps.submitTaskFromChat({
          agent_id: scopedAuth.owner_agent_id || "endpoint-ambiguous-escalator",
          worker_uuid: scopedAuth.owner_worker_uuid || "",
          task_id: "self_seed",
          summary: `Ambiguous SC-4 margin (${computed.margin.toFixed(3)} < ${effectiveTauMargin}) escalated from ${objDoc.object_key}`,
          queued_tasks: [
            {
              title: `[Disambiguate API Query] ${objDoc.object_key}: ${fuzzyQuery.slice(0, 80)}`,
              prompt: `Resolve ambiguous query '${scrubSensitiveText(fuzzyQuery)}' on TaskObject API '${objDoc.object_key}' (Top-2 margin ${computed.margin.toFixed(4)} < ${effectiveTauMargin}).`,
              tier: objDoc.visibility === "server_infra" ? "infra_private" : "public_general",
              priority: ON_DEMAND_API_GRID.async_task_priority_base,
              labels: ["sc4_margin_escalation", objDoc.object_key],
            },
          ],
        });
    const enqTask = subTaskOut?.enqueued_followup_verbs?.[0] || null;
    await logInvocation("SC-6_async_bulkhead_task", false, ON_DEMAND_API_GRID.http_accepted);
    return {
      status: ON_DEMAND_API_GRID.http_accepted,
      body: {
        ok: true,
        schema: "herma.on_demand_endpoint.async_accepted.v1",
        gate: "SC-6_async_bulkhead_task",
        reason: "ambiguous_top2_margin",
        fuzzy_diagnostics: {
          top1_score: Number(computed.top1.toFixed(4)),
          top2_score: Number(computed.top2.toFixed(4)),
          top2_margin: Number(computed.margin.toFixed(4)),
          tau_margin: effectiveTauMargin,
        },
        observe_mode: isObserveShadow ? "shadow" : "calibrated_auto",
        task_id: enqTask?.task_id || null,
        task_status_url: enqTask?.task_id ? `${publicUrl}/c/${encodeURIComponent(enqTask.task_id)}` : null,
      },
    };
  }

  if (WATERMARK_MEMO_CACHE.size >= ON_DEMAND_API_GRID.singleflight_memo_max_entries) {
    const oldest = WATERMARK_MEMO_CACHE.keys().next().value;
    if (oldest) WATERMARK_MEMO_CACHE.delete(oldest);
  }
  WATERMARK_MEMO_CACHE.set(memoKey, { ts: Date.now(), payload: computed });

  await logInvocation(computed.gate, Boolean(computed.short_circuited), ON_DEMAND_API_GRID.http_ok);
  if (rankingNode && computed.gate === "SC-4_fuzzy_top2_margin" && !isObserveShadow) {
    await recordSwappableNodeOutcome(db, "ranking", rankingNode.node_id, {
      success: true,
      latencyMs: performance.now() - t0,
      shortCircuited: true,
    });
  }

  return {
    status: ON_DEMAND_API_GRID.http_ok,
    body: isObserveShadow ? { ...computed, observe_mode: "shadow", mutations_suppressed: true } : computed,
  };
}
