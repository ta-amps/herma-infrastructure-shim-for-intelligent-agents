// Bilateral Worker Help (`/q/help`), Agent-to-Agent Chat (`/q/chat`, `/q/a2a`),
// Starter & Code-Reuse Hub (`/q/starter`, `/starter`), Meta Muse Telemetry (`/q/meta-telemetry`),
// and Modal Finetuning Dataset Export (`/q/training-export`) for Herma v6.3.

import { MODELS_USED_LINK, documentHtml, scrubBannedWords, tidyText } from "./page_shell.js";
import { NETWORK_MAP_NOTICE } from "./network_activity.js";
import { scrubSensitiveText } from "./bilateral_bridge.js";
import {
  bilateralTopics,
  loadEphemeralChatSession,
  normalizeSessionMemory,
  resolveBilateralBounds,
  saveEphemeralChatSession,
} from "./conversation.js";
import {
  DEFAULT_CONTEXT_ENTRIES,
  DEFAULT_PROVISIONS,
  SYSTEM_BUILTIN_SCOPE,
  canonicalJson,
  evaluateProvisions,
  isContributorModel,
  renderContextEntriesBlock,
  sha256Hex,
} from "./herma_engine.js";

export const HELP_STARTER_GRID = Object.freeze({
  schema_help_id: "herma.worker_help.v1",
  schema_chat_id: "herma.agent_chat.v1",
  schema_starter_id: "herma.starter_hub.v1",
  schema_telemetry_id: "herma.meta_telemetry.v1",
  schema_training_id: "herma.training_export.v1",
  default_top_k_objects: 6,
  max_top_k_objects: 12,
  max_sibling_objects: 8,
  max_shimmed_provisions: 6,
  max_question_chars: 3200,
  max_message_chars: 8000,
  max_excerpt_chars: 900,
  max_schema_keys: 24,
  max_file_entries: 24,
  max_history_turns: 24,
  max_history_json_chars: 32768,
  max_staging_draft_chars: 65536,
  min_chat_submit_summary_chars: 12,
  default_max_output_tokens: 1600,
  min_max_output_tokens: 16,
  max_output_tokens_cap: 32768,
  llm_timeout_ms: 25000,
  max_llm_response_bytes: 524288,
  default_paid_muse_daily_calls_cap: 50,
  max_paid_muse_daily_calls_cap: 200,
  help_meta_daily_microusd_cap: 1000000,
  default_meta_total_budget_usd: 5,
  microusd_per_usd: 1000000,
  tokens_per_million: 1000000,
  meta_spark_input_microusd_per_1m: 1250000,
  meta_spark_output_microusd_per_1m: 4250000,
  meta_wonder_input_microusd_per_1m: 4000000,
  meta_wonder_output_microusd_per_1m: 20000000,
  estimated_chars_per_token: 4,
  worst_case_bytes_per_token: 2,
  call_id_random_bytes: 6,
  hex_radix: 16,
  hex_byte_pad: 2,
  sha_pin_prefix_chars: 16,
  catalog_fetch_limit: 40,
  catalog_group_limit: 8,
  telemetry_recent_limit: 25,
  telemetry_max_limit: 100,
  training_default_limit: 50,
  training_max_limit: 200,
  diagnostic_trace_limit: 8,
  ms_per_second: 1000,
  max_preview_ready_tasks: 6,
  max_submission_utf8_bytes: 2097152,
  generated_trace_weight_milli: 720,
  submitted_unreviewed_trace_weight_milli: 820,
  accepted_trace_weight_milli: 960,
  fallback_trace_weight_milli: 580,
  refuted_trace_weight_milli: 200,
  unreviewed_object_base_weight_milli: 500,
  milli_scale: 1000,
  eval_count_bonus_step_milli: 40,
  eval_count_bonus_cap_milli: 200,
  ucb_bonus_scale_milli: 150,
  percentile_p50_numerator: 50,
  percentile_p95_numerator: 95,
  percentile_denominator: 100,
  rate_round_scale: 10000,
  utc_date_prefix_chars: 10,
  agent_max_len: 48,
  worker_uuid_max_len: 64,
  task_id_max_len: 64,
  session_id_max_len: 72,
  error_code_max_len: 64,
  lora_rank_router: 16,
  lora_alpha_router: 32,
  lora_rank_memory: 32,
  lora_alpha_memory: 64,
  http_ok: 200,
  http_bad_request: 400,
  http_forbidden: 403,
  http_not_found: 404,
  http_method_not_allowed: 405,
  http_conflict: 409,
  http_payload_too_large: 413,
  http_unprocessable: 422,
});

const META_MODEL_CATALOG = Object.freeze({
  meta: {
    provider: "meta",
    default_model: "muse-spark-1.3",
    allowed_models: ["muse-spark-1.3", "muse-wonder-1.0"],
    endpoint: "https://api.meta.ai/v1/chat/completions",
    secret_env: "META_API_KEY",
  },
});

const INITIALIZED_HELP_DBS = new WeakSet();

function scrubEmDash(text) {
  return String(text == null ? "" : text).replaceAll("\u2014", "--");
}

function escapeHtml(val) {
  return scrubEmDash(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function randomPrefixedId(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(HELP_STARTER_GRID.call_id_random_bytes));
  const hex = Array.from(bytes, (b) =>
    b.toString(HELP_STARTER_GRID.hex_radix).padStart(HELP_STARTER_GRID.hex_byte_pad, "0")
  ).join("");
  return `${prefix}_${Date.now()}_${hex}`;
}

function cleanHandle(raw, fallback = "worker-agent") {
  const cleaned = scrubSensitiveText(String(raw || ""))
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, HELP_STARTER_GRID.agent_max_len);
  return cleaned || fallback;
}

function cleanSessionId(raw) {
  const cleaned = String(raw || "")
    .trim()
    .replace(/[^A-Za-z0-9_.:-]+/g, "_")
    .slice(0, HELP_STARTER_GRID.session_id_max_len);
  return cleaned;
}

const SESSION_BASE36_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

function mintReadableSessionId() {
  const bytes = crypto.getRandomValues(new Uint8Array(HELP_STARTER_GRID.call_id_random_bytes));
  const suffix = Array.from(bytes, (b) => SESSION_BASE36_ALPHABET[b % SESSION_BASE36_ALPHABET.length]).join("");
  return `sess-${Date.now().toString(SESSION_BASE36_ALPHABET.length)}-${suffix}`;
}

export async function ensureHelpAndStarterSchema(db) {
  if (!db || typeof db.prepare !== "function") {
    return;
  }
  if (typeof db === "object" && (db.__hermaSchemaV69Ready || INITIALIZED_HELP_DBS.has(db))) {
    return;
  }
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS herma_meta_call_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        call_id TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        agent_id TEXT NOT NULL DEFAULT '',
        worker_uuid TEXT NOT NULL DEFAULT '',
        task_id TEXT NOT NULL DEFAULT '',
        provider TEXT NOT NULL,
        requested_model TEXT NOT NULL,
        reported_model TEXT NOT NULL DEFAULT '',
        http_status INTEGER NOT NULL DEFAULT 0,
        outcome TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_microusd INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        shimmed_object_count INTEGER NOT NULL DEFAULT 0,
        shimmed_provision_count INTEGER NOT NULL DEFAULT 0,
        prompt_sha256 TEXT NOT NULL DEFAULT '',
        response_sha256 TEXT NOT NULL DEFAULT '',
        error_code TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )`
    )
    .run();
  try {
    await db
      .prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_hmcl_call_id ON herma_meta_call_log (call_id)")
      .run();
  } catch { /* legacy duplicate call_id rows */ }
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_hmcl_created
       ON herma_meta_call_log (created_at DESC, provider)`
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS herma_agent_conversations (
        session_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        worker_uuid TEXT NOT NULL DEFAULT '',
        active_task_id TEXT NOT NULL DEFAULT '',
        active_fencing_token INTEGER NOT NULL DEFAULT 0,
        state_stage TEXT NOT NULL DEFAULT 'onboarding',
        visibility TEXT NOT NULL DEFAULT 'public_commons',
        export_eligible INTEGER NOT NULL DEFAULT 1,
        history_json TEXT NOT NULL DEFAULT '[]',
        turn_count INTEGER NOT NULL DEFAULT 0,
        staging_draft_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
    )
    .run();
  try {
    await db
      .prepare("ALTER TABLE herma_agent_conversations ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public_commons'")
      .run();
  } catch { /* column already exists */ }
  try {
    await db
      .prepare("ALTER TABLE herma_agent_conversations ADD COLUMN export_eligible INTEGER NOT NULL DEFAULT 1")
      .run();
  } catch { /* column already exists */ }
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_hac_worker
       ON herma_agent_conversations (worker_uuid, updated_at DESC)`
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS herma_finetune_traces (
        trace_id TEXT PRIMARY KEY,
        source_kind TEXT NOT NULL,
        task_id TEXT NOT NULL DEFAULT '',
        worker_uuid TEXT NOT NULL DEFAULT '',
        model_id TEXT NOT NULL DEFAULT '',
        visibility TEXT NOT NULL DEFAULT 'public_commons',
        export_eligible INTEGER NOT NULL DEFAULT 1,
        system_shim_json TEXT NOT NULL DEFAULT '{}',
        input_messages_json TEXT NOT NULL DEFAULT '[]',
        output_json TEXT NOT NULL DEFAULT '{}',
        quality_weight_milli INTEGER NOT NULL DEFAULT 0,
        verified_outcome TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL
      )`
    )
    .run();
  try {
    await db
      .prepare("ALTER TABLE herma_finetune_traces ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public_commons'")
      .run();
  } catch { /* column already exists */ }
  try {
    await db
      .prepare("ALTER TABLE herma_finetune_traces ADD COLUMN export_eligible INTEGER NOT NULL DEFAULT 1")
      .run();
  } catch { /* column already exists */ }
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_hft_outcome
       ON herma_finetune_traces (verified_outcome, quality_weight_milli DESC, created_at DESC)`
    )
    .run();

  if (db && typeof db === "object") {
    INITIALIZED_HELP_DBS.add(db);
  }
}

async function loadBuiltinProvisionsAndContext(db) {
  const contextMap = new Map();
  for (const entry of DEFAULT_CONTEXT_ENTRIES || []) {
    if (entry?.entry_id) {
      contextMap.set(entry.entry_id, entry);
    }
  }
  const provById = new Map();
  for (const prov of DEFAULT_PROVISIONS || []) {
    if (prov?.prov_id) {
      provById.set(prov.prov_id, { provision: prov, version: 1 });
    }
  }

  try {
    const ctxRows = await db
      .prepare("SELECT entry_id, kind, title, summary, body_json, updated_at FROM context_entries WHERE caller_scope = ?")
      .bind(SYSTEM_BUILTIN_SCOPE)
      .all();
    for (const r of ctxRows?.results || []) {
      let parsedBody = {};
      try {
        parsedBody = JSON.parse(r.body_json || "{}");
      } catch {
        parsedBody = {};
      }
      contextMap.set(String(r.entry_id), {
        entry_id: String(r.entry_id),
        kind: String(r.kind || "detail"),
        title: String(r.title || ""),
        summary: String(r.summary || ""),
        schema_or_body: parsedBody.schema_or_body ?? parsedBody,
        source_uri: parsedBody.source_uri || null,
        updated_at: r.updated_at,
      });
    }
  } catch {
    // Table may not be initialized in standalone gateway tests; DEFAULT_CONTEXT_ENTRIES covers builtins.
  }

  try {
    const provRows = await db
      .prepare("SELECT prov_id, version, body_json FROM provisions WHERE caller_scope = ?")
      .bind(SYSTEM_BUILTIN_SCOPE)
      .all();
    for (const r of provRows?.results || []) {
      try {
        const parsedProv = JSON.parse(r.body_json || "{}");
        if (parsedProv?.prov_id) {
          provById.set(String(parsedProv.prov_id), {
            provision: parsedProv,
            version: Number(r.version || 1),
          });
        }
      } catch {
        // Ignore malformed row
      }
    }
  } catch {
    // Fallback to DEFAULT_PROVISIONS
  }

  return {
    storedList: Array.from(provById.values()),
    contextMap,
  };
}

function summarizeObjectStructure(objRow, publicUrl) {
  const base = String(publicUrl || "https://shim.teleionlabs.com").replace(/\/+$/, "");
  const payload = objRow?.payload;
  let schemaKeys = [];
  let files = [];
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    schemaKeys = Object.keys(payload).slice(0, HELP_STARTER_GRID.max_schema_keys);
    const filesContainer =
      (payload.files && typeof payload.files === "object" && payload.files) ||
      (payload.kit_files && typeof payload.kit_files === "object" && payload.kit_files) ||
      (payload.modules && typeof payload.modules === "object" && payload.modules) ||
      null;
    if (filesContainer && !Array.isArray(filesContainer)) {
      files = Object.keys(filesContainer).slice(0, HELP_STARTER_GRID.max_file_entries);
    } else if (Array.isArray(payload.files)) {
      files = payload.files
        .map((f) => (typeof f === "string" ? f : f?.path || f?.name || ""))
        .filter(Boolean)
        .slice(0, HELP_STARTER_GRID.max_file_entries);
    }
  }
  const key = String(objRow.object_key || objRow.id || "");
  const sha = String(objRow.sha256_hash || "");
  const evalCount = Number(objRow.eval_count || 0);
  const rawExcerpt =
    payload !== undefined
      ? scrubEmDash(typeof payload === "string" ? payload : JSON.stringify(payload)).slice(
          0,
          HELP_STARTER_GRID.max_excerpt_chars
        )
      : "";
  return {
    object_key: key,
    category: objRow.category || "task_object",
    summary: scrubEmDash(objRow.summary || ""),
    sha256_hash: sha || null,
    review_status: evalCount > 0 ? "peer_reviewed" : "unreviewed",
    quality_milli: evalCount > 0 ? Number(objRow.quality_milli || 0) : 0,
    eval_count: evalCount,
    schema_keys: schemaKeys,
    files,
    total_payload_bytes: Number(objRow.total_payload_bytes || 0),
    object_url: `${base}/q/object/${encodeURIComponent(key)}`,
    get_object_url: `${base}/q/object/${encodeURIComponent(key)}`,
    pinned_url: sha
      ? `${base}/q/object/${encodeURIComponent(key)}?sha256=${encodeURIComponent(sha.slice(0, HELP_STARTER_GRID.sha_pin_prefix_chars))}`
      : `${base}/q/object/${encodeURIComponent(key)}`,
    permalink_url: `${base}/c/${encodeURIComponent(key)}`,
    payload_excerpt: rawExcerpt,
    payload_preview: rawExcerpt,
  };
}

const CONVERSATIONAL_SEARCH_STOPWORDS = new Set([
  "a",
  "am",
  "an",
  "and",
  "any",
  "are",
  "assist",
  "can",
  "could",
  "current",
  "currently",
  "do",
  "does",
  "existing",
  "find",
  "for",
  "from",
  "get",
  "give",
  "have",
  "help",
  "helpful",
  "hey",
  "hi",
  "hello",
  "how",
  "i",
  "im",
  "in",
  "is",
  "it",
  "list",
  "look",
  "looking",
  "me",
  "my",
  "need",
  "object",
  "objects",
  "of",
  "on",
  "or",
  "please",
  "show",
  "some",
  "stuck",
  "task",
  "tasks",
  "task_object",
  "task_objects",
  "that",
  "the",
  "there",
  "these",
  "this",
  "to",
  "use",
  "useful",
  "we",
  "what",
  "which",
  "with",
  "would",
  "you",
]);

export function normalizeConversationalTypos(rawText) {
  return String(rawText || "")
    .replace(/\bwiththis\b/gi, "with this")
    .replace(/\bforthis\b/gi, "for this")
    .replace(/\bonthis\b/gi, "on this")
    .replace(/\binthis\b/gi, "in this")
    .replace(/\btaskobjects\b/gi, "task objects")
    .replace(/\btaskobject\b/gi, "task object")
    .replace(/\bi'm\b/gi, "i am");
}

function buildTaskGroundedSearchQuery(question, taskRow) {
  const normalizedQuestion = normalizeConversationalTypos(question);
  const questionTokens = normalizedQuestion
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/)
    .filter((tok) => tok.length > 1 && !CONVERSATIONAL_SEARCH_STOPWORDS.has(tok));

  const taskParts = [];
  if (taskRow) {
    if (taskRow.title) taskParts.push(String(taskRow.title));
    if (taskRow.category && taskRow.category !== "general") taskParts.push(String(taskRow.category));
    if (taskRow.input_contract && taskRow.input_contract !== "json_object") {
      taskParts.push(String(taskRow.input_contract));
    }
    if (taskRow.output_contract && taskRow.output_contract !== "verified_task_object") {
      taskParts.push(String(taskRow.output_contract));
    }
    if (questionTokens.length === 0 && taskRow.prompt) {
      const promptTokens = String(taskRow.prompt)
        .toLowerCase()
        .split(/[^a-z0-9_.-]+/)
        .filter((tok) => tok.length > 2 && !CONVERSATIONAL_SEARCH_STOPWORDS.has(tok))
        .slice(0, HELP_STARTER_GRID.max_sibling_objects);
      taskParts.push(promptTokens.join(" "));
    }
  }

  const combined = [...questionTokens, ...taskParts].filter(Boolean).join(" ").trim();
  return combined || "reusable schema adapter verification rubric";
}

export async function runTraditionalHermaIntake(
  db,
  env,
  infraAllowed,
  publicUrl,
  { question = "", taskId = "", topK = HELP_STARTER_GRID.default_top_k_objects, includeReasoningSuggestions = true },
  gatewayOps
) {
  const visFilter = infraAllowed
    ? "visibility IN ('public_ngo', 'public_commons', 'server_infra')"
    : "visibility IN ('public_ngo', 'public_commons')";
  const safeTopK = Math.max(1, Math.min(HELP_STARTER_GRID.max_top_k_objects, Number(topK || HELP_STARTER_GRID.default_top_k_objects)));

  let taskRow = null;
  let parentTask = null;
  let prerequisiteTask = null;
  let siblingObjects = [];
  let priorReasoningSuggestions = [];
  let isPrivateContext = false;

  if (taskId && taskId !== "self_seed") {
    taskRow = await db.prepare("SELECT * FROM herma_durable_queue WHERE task_id = ? LIMIT 1").bind(taskId).first();
    if (taskRow) {
      if (taskRow.visibility === "server_infra" && !infraAllowed) {
        return { forbidden: true, detail: "Task belongs to restricted server_infra tier." };
      }
      if (taskRow.visibility === "server_infra" || taskRow.tier === "infra_private") {
        isPrivateContext = true;
      }
      if (taskRow.parent_task_id) {
        parentTask = await db
          .prepare(
            `SELECT task_id, tier, state, title, prompt, result_summary, output_contract
             FROM herma_durable_queue WHERE task_id = ? AND ${visFilter} LIMIT 1`
          )
          .bind(taskRow.parent_task_id)
          .first();
      }
      if (taskRow.blocked_by_task_id) {
        prerequisiteTask = await db
          .prepare(
            `SELECT task_id, tier, state, title, result_summary, receipt_hash
             FROM herma_durable_queue WHERE task_id = ? AND ${visFilter} LIMIT 1`
          )
          .bind(taskRow.blocked_by_task_id)
          .first();
      }
      const sibTaskIds = [taskRow.task_id, taskRow.parent_task_id, taskRow.blocked_by_task_id].filter(Boolean);
      if (sibTaskIds.length > 0) {
        const ph = sibTaskIds.map(() => "?").join(",");
        const sibRes = await db
          .prepare(
            `SELECT object_key, category, summary, payload_json, sha256_hash, worker_uuid, eval_count, quality_milli, total_payload_bytes
             FROM herma_task_objects
             WHERE source_task_id IN (${ph}) AND ${visFilter} AND is_tombstoned = 0
             ORDER BY id DESC LIMIT ?`
          )
          .bind(...sibTaskIds, HELP_STARTER_GRID.max_sibling_objects)
          .all();
        siblingObjects = (sibRes?.results || []).map((o) => {
          let parsed = null;
          try {
            parsed = JSON.parse(o.payload_json || "{}");
          } catch {
            parsed = null;
          }
          return summarizeObjectStructure({ ...o, payload: parsed }, publicUrl);
        });
        priorReasoningSuggestions = siblingObjects.filter((o) => o.category === "reasoning_suggestion");
      }
    }
  }

  const searchQuery = buildTaskGroundedSearchQuery(question, taskRow);
  const searchOut = await gatewayOps.executeHybridSearch(
    db,
    infraAllowed,
    {
      q: searchQuery,
      scope: "objects",
      include_payload: true,
      limit: safeTopK,
    },
    publicUrl
  );

  const reusableObjects = [];
  const seenKeys = new Set();

  // First surface any task-linked sibling objects (including prior reasoning_suggestion objects when requested)
  for (const sib of siblingObjects) {
    if (!includeReasoningSuggestions && sib.category === "reasoning_suggestion") continue;
    if (reusableObjects.length >= safeTopK) break;
    if (seenKeys.has(sib.object_key)) continue;
    seenKeys.add(sib.object_key);
    reusableObjects.push(sib);
  }

  for (const r of searchOut?.results || []) {
    if (reusableObjects.length >= safeTopK) break;
    if (r.artifact_kind !== "task_object") continue;
    if (!includeReasoningSuggestions && r.category === "reasoning_suggestion") continue;
    if (seenKeys.has(r.id)) continue;
    const extraMeta = await db
      .prepare("SELECT sha256_hash, eval_count, quality_milli, total_payload_bytes FROM herma_task_objects WHERE object_key = ? ORDER BY id DESC LIMIT 1")
      .bind(r.id)
      .first();
    const formatted = summarizeObjectStructure(
      {
        ...r,
        object_key: r.id,
        sha256_hash: extraMeta?.sha256_hash || "",
        eval_count: extraMeta?.eval_count || 0,
        quality_milli: extraMeta?.quality_milli || 0,
        total_payload_bytes: extraMeta?.total_payload_bytes || r.total_payload_bytes || 0,
      },
      publicUrl
    );
    seenKeys.add(formatted.object_key);
    reusableObjects.push(formatted);
  }

  if (reusableObjects.length < safeTopK) {
    const categoryClause = includeReasoningSuggestions ? "" : "AND category != 'reasoning_suggestion'";
    const fallbackRows = await db
      .prepare(
        `SELECT id, object_key, category, summary, payload_json, sha256_hash, eval_count, quality_milli, total_payload_bytes
         FROM herma_task_objects
         WHERE ${visFilter} AND is_tombstoned = 0 ${categoryClause}
         ORDER BY eval_count DESC, quality_milli DESC, id DESC
         LIMIT ?`
      )
      .bind(safeTopK)
      .all();
    for (const r of fallbackRows?.results || []) {
      if (reusableObjects.length >= safeTopK) break;
      if (seenKeys.has(r.object_key)) continue;
      let parsedPayload = null;
      try {
        parsedPayload = JSON.parse(r.payload_json || "{}");
      } catch {
        parsedPayload = null;
      }
      seenKeys.add(r.object_key);
      reusableObjects.push(summarizeObjectStructure({ ...r, payload: parsedPayload }, publicUrl));
    }
  }

  const { storedList, contextMap } = await loadBuiltinProvisionsAndContext(db);
  const triggerText = [
    question,
    taskRow?.title || "",
    taskRow?.prompt || "",
    "tasks and task objects fencing token reuse",
  ]
    .filter(Boolean)
    .join("\n");
  const matchedProvs = await evaluateProvisions(
    storedList,
    { text: triggerText, file_paths: [], tool_names: [] },
    env,
    { offlineOnly: true }
  );

  const shimmedProvisions = matchedProvs.slice(0, HELP_STARTER_GRID.max_shimmed_provisions).map(({ stored, match }) => {
    const prov = stored.provision;
    const ctxRendered = renderContextEntriesBlock(prov.context_refs || [], contextMap);
    return {
      prov_id: prov.prov_id,
      version: stored.version,
      title: scrubEmDash(prov.title || ""),
      matched_tiers: match.matched_tiers,
      reasons: match.reasons,
      inject_text: scrubEmDash(prov.inject_text || prov.direct_response || ""),
      context_refs: ctxRendered.shimmedRefs,
      context_block: scrubEmDash(ctxRendered.block || ""),
    };
  });

  return {
    forbidden: false,
    isPrivateContext,
    herma_intake: {
      question: scrubEmDash(question),
      resolved_search_query: searchQuery,
      task_context: {
        task: taskRow
          ? {
              task_id: taskRow.task_id,
              tier: taskRow.tier,
              state: taskRow.state,
              priority: Number(taskRow.priority || 0),
              fencing_token: Number(taskRow.fencing_token || 0),
              leased_by: taskRow.leased_by || null,
              lease_expires_at: taskRow.lease_expires_at || null,
              title: scrubEmDash(taskRow.title || ""),
              prompt: scrubEmDash(taskRow.prompt || ""),
              input_contract: taskRow.input_contract || "json_object",
              output_contract: taskRow.output_contract || "verified_task_object",
            }
          : null,
        parent_task: parentTask || null,
        prerequisite_task: prerequisiteTask || null,
        sibling_objects: siblingObjects,
        prior_reasoning_suggestions: priorReasoningSuggestions,
      },
      shimmed_provisions: shimmedProvisions,
      reusable_task_objects: reusableObjects,
    },
  };
}

function estimateMetaMicrousd(modelId, inputTokens, outputTokens) {
  const inTok = Math.max(0, Number(inputTokens || 0));
  const outTok = Math.max(0, Number(outputTokens || 0));
  const inRate =
    modelId === "muse-wonder-1.0"
      ? HELP_STARTER_GRID.meta_wonder_input_microusd_per_1m
      : HELP_STARTER_GRID.meta_spark_input_microusd_per_1m;
  const outRate =
    modelId === "muse-wonder-1.0"
      ? HELP_STARTER_GRID.meta_wonder_output_microusd_per_1m
      : HELP_STARTER_GRID.meta_spark_output_microusd_per_1m;
  return Math.ceil(
    (inTok * inRate + outTok * outRate) / HELP_STARTER_GRID.tokens_per_million
  );
}

// Outcomes that count as a call against the daily cap: a reservation, an answer, and every failed or uncertain attempt (rule 8: they stay recorded).
const COUNTED_META_OUTCOMES = "('reserved', 'completed', 'rate_limited', 'upstream_error', 'rejected')";

/**
 * Reserve a Meta call BEFORE making it, in one statement. D1 runs a single statement atomically, so a burst of simultaneous
 * requests cannot all pass the same old counts: the row is inserted (outcome "reserved", cost set to the worst case for the model) only
 * while today's calls are under the daily call cap, today's spend plus this ceiling is under the public day cap, and the total spend plus
 * this ceiling is under the operator budget. Infrastructure callers skip the two day caps and keep the total. Returns true when the slot is theirs.
 */
async function reserveMetaCall(db, r, env = null) {
  const rawCeiling = r?.ceiling_microusd ?? r?.estimated_microusd ?? r?.estMicrousd;
  const numCeiling = Number(rawCeiling);
  if (rawCeiling === undefined || rawCeiling === null || typeof rawCeiling === "boolean" || !Number.isFinite(numCeiling)) {
    return false;
  }
  const ceilingMicrousd = Math.ceil(numCeiling);
  if (!Number.isSafeInteger(ceilingMicrousd) || ceilingMicrousd <= 0) {
    return false;
  }
  const callId = String(r?.call_id ?? r?.callId ?? "").trim();
  if (!callId) {
    return false;
  }
  const canonicalReq = {
    ...r,
    call_id: callId,
    ceiling_microusd: ceilingMicrousd,
  };
  if (env?.WORK_REASONING_BUDGET && typeof env.WORK_REASONING_BUDGET.getByName === "function") {
    try {
      const budget = env.WORK_REASONING_BUDGET.getByName("provider-allowance-v1");
      if (typeof budget.reservePublicMeta === "function") {
        const res = await budget.reservePublicMeta(canonicalReq);
        return Boolean(res?.ok);
      }
    } catch {
      return false;
    }
  }
  if (!db || typeof db.prepare !== "function") {
    return false;
  }
  try {
    const prior = await db
      .prepare("SELECT provider, endpoint, estimated_microusd FROM herma_meta_call_log WHERE call_id = ? LIMIT 1")
      .bind(callId)
      .first();
    if (prior) {
      return (
        String(prior.provider || "") === "meta" &&
        Number(prior.estimated_microusd) === ceilingMicrousd &&
        String(prior.endpoint || "") === String(canonicalReq.endpoint || "/q/help")
      );
    }
    const result = await db
      .prepare(
        `INSERT INTO herma_meta_call_log
         (call_id, endpoint, agent_id, worker_uuid, task_id, provider, requested_model, reported_model,
          http_status, outcome, input_tokens, output_tokens, estimated_microusd, latency_ms,
          shimmed_object_count, shimmed_provision_count, prompt_sha256, response_sha256, error_code, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, 'meta', ?6, '', 0, 'reserved', 0, 0, ?7, 0, ?8, ?9, ?10, '', '', ?11
          WHERE (SELECT COALESCE(SUM(estimated_microusd), 0) FROM herma_meta_call_log WHERE provider = 'meta') + ?7 <= ?12
            AND (?13 = 1 OR (SELECT COALESCE(SUM(estimated_microusd), 0) FROM herma_meta_call_log
                              WHERE provider = 'meta' AND created_at >= ?14) + ?7 <= ?15)
            AND (?13 = 1 OR (SELECT COUNT(*) FROM herma_meta_call_log
                              WHERE provider = 'meta' AND created_at >= ?14 AND outcome IN ${COUNTED_META_OUTCOMES}) < ?16)`
      )
      .bind(
        callId,
        String(canonicalReq.endpoint || "/q/help"),
        String(canonicalReq.agent_id || "").slice(0, HELP_STARTER_GRID.agent_max_len),
        String(canonicalReq.worker_uuid || "").slice(0, HELP_STARTER_GRID.worker_uuid_max_len),
        String(canonicalReq.task_id || "").slice(0, HELP_STARTER_GRID.task_id_max_len),
        String(canonicalReq.requested_model || "muse-spark-1.3"),
        ceilingMicrousd,
        Math.max(0, Number(canonicalReq.shimmed_object_count || 0)),
        Math.max(0, Number(canonicalReq.shimmed_provision_count || 0)),
        String(canonicalReq.prompt_sha256 || ""),
        canonicalReq.created_at,
        Math.round(Number(canonicalReq.total_budget_microusd || 0)),
        canonicalReq.infra ? 1 : 0,
        String(canonicalReq.day_start_iso),
        Math.round(Number(canonicalReq.day_cap_microusd || 0)),
        Math.max(1, Math.floor(Number(canonicalReq.day_calls_cap || 1)))
      )
      .run();
    return Number(result?.meta?.changes || 0) === 1;
  } catch {
    return false;
  }
}

/** Which cap refused a reservation (a plain read, only used to word the refusal; the refusal itself was decided atomically). */
async function metaCallsToday(db, dayStartIso) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM herma_meta_call_log
       WHERE provider = 'meta' AND created_at >= ? AND outcome IN ${COUNTED_META_OUTCOMES}`
    )
    .bind(dayStartIso)
    .first();
  return Number(row?.cnt || 0);
}

/** After the call: the same row gets the real outcome, tokens and cost. A call that never reaches this keeps its reservation. */
export async function finishMetaCall(db, record) {
  await db
    .prepare(
      `UPDATE herma_meta_call_log
          SET reported_model = ?, http_status = ?, outcome = ?, input_tokens = ?, output_tokens = ?,
              estimated_microusd = ?, latency_ms = ?, response_sha256 = ?, error_code = ?
        WHERE call_id = ?`
    )
    .bind(
      String(record.reported_model || ""),
      Number(record.http_status || 0),
      String(record.outcome || "unknown"),
      Math.max(0, Number(record.input_tokens || 0)),
      Math.max(0, Number(record.output_tokens || 0)),
      Math.max(0, Number(record.estimated_microusd || 0)),
      Math.max(0, Math.round(Number(record.latency_ms || 0))),
      String(record.response_sha256 || ""),
      String(record.error_code || "").slice(0, HELP_STARTER_GRID.error_code_max_len),
      String(record.call_id)
    )
    .run();
}

async function logMetaCallAttempt(db, record) {
  const nowIso = record.created_at || new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO herma_meta_call_log
       (call_id, endpoint, agent_id, worker_uuid, task_id, provider, requested_model, reported_model,
        http_status, outcome, input_tokens, output_tokens, estimated_microusd, latency_ms,
        shimmed_object_count, shimmed_provision_count, prompt_sha256, response_sha256, error_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      String(record.call_id || randomPrefixedId("mcall")),
      String(record.endpoint || "/q/help"),
      String(record.agent_id || "").slice(0, HELP_STARTER_GRID.agent_max_len),
      String(record.worker_uuid || "").slice(0, HELP_STARTER_GRID.worker_uuid_max_len),
      String(record.task_id || "").slice(0, HELP_STARTER_GRID.task_id_max_len),
      String(record.provider || "meta"),
      String(record.requested_model || "muse-spark-1.3"),
      String(record.reported_model || ""),
      Number(record.http_status || 0),
      String(record.outcome || "unknown"),
      Math.max(0, Number(record.input_tokens || 0)),
      Math.max(0, Number(record.output_tokens || 0)),
      Math.max(0, Number(record.estimated_microusd || 0)),
      Math.max(0, Math.round(Number(record.latency_ms || 0))),
      Math.max(0, Number(record.shimmed_object_count || 0)),
      Math.max(0, Number(record.shimmed_provision_count || 0)),
      String(record.prompt_sha256 || ""),
      String(record.response_sha256 || ""),
      String(record.error_code || "").slice(0, HELP_STARTER_GRID.error_code_max_len),
      nowIso
    )
    .run();
}

function buildDeterministicGuidance(hermaIntake, publicUrl, diagnostics = null) {
  const base = String(publicUrl || "https://shim.teleionlabs.com").replace(/\/+$/, "");
  const task = hermaIntake?.task_context?.task;
  const topObjects = hermaIntake?.reusable_task_objects || [];
  const firstObj = topObjects[0];
  const reuseSteps =
    topObjects.length > 0
      ? topObjects.map(
          (o) =>
            `Reuse '${o.object_key}' (${o.category}${o.schema_keys.length ? `, keys: ${o.schema_keys.join(", ")}` : ""}) via GET ${o.pinned_url} instead of rewriting its contract from scratch.`
        )
      : [
          `Query GET ${base}/q/search?q=<domain_keywords>&include_payload=1 before writing new schemas or adapters.`,
        ];

  const diagNotes = [];
  if (diagnostics?.prior_idempotent_receipt) {
    diagNotes.push(
      `Your prior submission for task '${diagnostics.prior_idempotent_receipt.task_id}' ALREADY succeeded (receipt_hash=${diagnostics.prior_idempotent_receipt.receipt_hash}). Do not re-do the work; replay or move to the next task.`
    );
  }
  if (diagnostics?.lease_status === "expired") {
    diagNotes.push(
      `Lease on '${task?.task_id}' has expired. Re-claim via POST ${base}/q/claim to obtain the updated fencing_token before submitting.`
    );
  } else if (task?.fencing_token) {
    diagNotes.push(
      `Pass exact integer fencing_token=${task.fencing_token} from your active lease (never omit fencing_token or hardcode 1).`
    );
  }

  return {
    summary: scrubEmDash(
      task
        ? `Actionable plan for task '${task.task_id}' (${task.title}): compose ${topObjects.length} existing Task Object(s), validate UTF-8 JSON locally, and submit with exact fencing_token.`
        : `Compose ${topObjects.length} existing reusable Task Object(s) from the queue catalog, extend only the missing capability, and verify stored SHA-256 integrity.`
    ),
    step_by_step_plan: [
      ...diagNotes,
      firstObj
        ? `1. Fetch and inspect existing reusable Task Object '${firstObj.object_key}' via ${firstObj.pinned_url} to inherit field names and invariants.`
        : `1. Inspect starter schemas and client helpers at ${base}/starter (or GET ${base}/q/starter?format=json).`,
      task
        ? `2. Implement one focused deliverable satisfying output_contract '${task.output_contract}' for '${task.task_id}'.`
        : "2. Implement one focused, domain-clean deliverable (schema, runnable module, test suite, or interactive demo).",
      "3. Validate JSON serialization and UTF-8 byte size (<= 2,097,152 bytes) locally before calling /q/submit.",
      `4. Submit with your persistent worker_uuid, worker_token, and exact active fencing_token, then verify GET ${base}/q/object/<your_object_key>.`,
    ],
    how_to_reuse_matched_objects: reuseSteps,
    edge_cases_and_guardrails: [
      "Always include exact integer fencing_token when completing a leased task; missing or stale tokens return HTTP 409.",
      "Keep your persistent worker_uuid + worker_token across runs so you never impersonate or collide with another contributor.",
      "If another contributor already owns an object_key, pick a distinct versioned key or pass ?sha256=<prefix> for immutable reads.",
      "Payloads are measured in UTF-8 bytes (max 2 MiB); multibyte CJK/emoji strings over 2,097,152 UTF-8 bytes return HTTP 413.",
    ],
    starter_code_or_schema_skeleton: {
      agent_id: "<YOUR_AGENT_ID>",
      worker_uuid: "<YOUR_WORKER_UUID>",
      worker_token: "<YOUR_WORKER_TOKEN>",
      task_id: task?.task_id || "self_seed",
      fencing_token: task?.fencing_token || undefined,
      summary: task ? `Completed ${task.task_id} by composing ${firstObj?.object_key || "checked contract"}` : "Completed reusable Task Object",
      task_objects: [
        {
          object_key: firstObj ? `${firstObj.object_key}_ext_v1` : "reusable_module_v1",
          category: firstObj?.category || "reusable_module",
          summary: "Extended the checked contract with runnable checks",
          payload: {
            composed_from: firstObj ? [{ object_key: firstObj.object_key, sha256_hash: firstObj.sha256_hash }] : [],
            schema_version: "1.0.0",
            verification_passed: true,
          },
        },
      ],
      queued_tasks: [],
    },
    verification_checks: [
      "Confirm HTTP 200 and payload_sha256_verified === true on GET /q/object/<object_key> after submitting.",
      "Only include queued_tasks when genuine multi-stage follow-up work remains.",
      "Ensure zero secrets, personal data, or hardcoded magic literals appear in submitted payloads.",
    ],
    raw_model_advice: null,
  };
}

function parseModelGuidanceText(rawContent, fallbackGuidance) {
  const cleaned = scrubEmDash(String(rawContent || "").trim());
  if (!cleaned) return fallbackGuidance;

  let jsonCandidate = cleaned;
  const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(cleaned);
  if (fenceMatch && fenceMatch[1]) {
    jsonCandidate = fenceMatch[1].trim();
  }
  try {
    const parsed = JSON.parse(jsonCandidate);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return {
        summary: scrubEmDash(parsed.summary || fallbackGuidance.summary),
        step_by_step_plan: Array.isArray(parsed.step_by_step_plan) && parsed.step_by_step_plan.length > 0
          ? parsed.step_by_step_plan.map((x) => scrubEmDash(x))
          : fallbackGuidance.step_by_step_plan,
        how_to_reuse_matched_objects:
          Array.isArray(parsed.how_to_reuse_matched_objects) && parsed.how_to_reuse_matched_objects.length > 0
            ? parsed.how_to_reuse_matched_objects.map((x) => scrubEmDash(x))
            : fallbackGuidance.how_to_reuse_matched_objects,
        edge_cases_and_guardrails:
          Array.isArray(parsed.edge_cases_and_guardrails) && parsed.edge_cases_and_guardrails.length > 0
            ? parsed.edge_cases_and_guardrails.map((x) => scrubEmDash(x))
            : fallbackGuidance.edge_cases_and_guardrails,
        starter_code_or_schema_skeleton:
          parsed.starter_code_or_schema_skeleton || fallbackGuidance.starter_code_or_schema_skeleton,
        verification_checks:
          Array.isArray(parsed.verification_checks) && parsed.verification_checks.length > 0
            ? parsed.verification_checks.map((x) => scrubEmDash(x))
            : fallbackGuidance.verification_checks,
        raw_model_advice: cleaned,
      };
    }
  } catch {
    // Plain markdown/text reply from Meta Muse model
  }

  return {
    ...fallbackGuidance,
    summary: cleaned.split("\n").find((l) => l.trim().length > 0) || fallbackGuidance.summary,
    raw_model_advice: cleaned,
  };
}

export async function runHelpAndMetaReasoningPipeline(
  db,
  env,
  infraAllowed,
  publicUrl,
  {
    endpoint = "/q/help",
    question = "",
    taskId = "",
    agentId = "",
    workerUuid = "",
    provider = "meta",
    requestedModelOverride = "",
    requestedMaxTokens = null,
    topK = HELP_STARTER_GRID.default_top_k_objects,
    diagnostics = null,
    persistArtifacts = true,
    readOnlyGet = false,
  },
  gatewayOps
) {
  await ensureHelpAndStarterSchema(db);
  const cleanQ = scrubEmDash(scrubSensitiveText(question)).slice(0, HELP_STARTER_GRID.max_question_chars);
  const cleanAgent = cleanHandle(agentId || "help-requester");

  const intakeRes = await runTraditionalHermaIntake(
    db,
    env,
    infraAllowed,
    publicUrl,
    { question: cleanQ, taskId, topK },
    gatewayOps
  );
  if (intakeRes.forbidden) {
    return { forbidden: true, code: "forbidden_tier", detail: intakeRes.detail };
  }

  const reqProviderKey = String(provider || "meta").toLowerCase().trim() || "meta";
  const provSpec = META_MODEL_CATALOG[reqProviderKey];
  const candidateModel = String(requestedModelOverride || provSpec?.default_model || "").trim();

  if (isContributorModel(candidateModel) || isContributorModel(reqProviderKey)) {
    const callId = randomPrefixedId("mcall");
    if (!readOnlyGet) await logMetaCallAttempt(db, {
      call_id: callId,
      endpoint,
      agent_id: cleanAgent,
      worker_uuid: workerUuid,
      task_id: taskId,
      provider: reqProviderKey,
      requested_model: candidateModel || reqProviderKey,
      http_status: HELP_STARTER_GRID.http_forbidden,
      outcome: "rejected",
      error_code: "contributor_tier_refused",
      shimmed_object_count: intakeRes.herma_intake.reusable_task_objects.length,
      shimmed_provision_count: intakeRes.herma_intake.shimmed_provisions.length,
    });
    return {
      forbidden: true,
      code: "contributor_tier_refused",
      detail: "Contributor-tier models are strictly refused to protect data boundaries.",
    };
  }

  if (!provSpec || !provSpec.allowed_models.includes(candidateModel)) {
    const callId = randomPrefixedId("mcall");
    if (!readOnlyGet) await logMetaCallAttempt(db, {
      call_id: callId,
      endpoint,
      agent_id: cleanAgent,
      worker_uuid: workerUuid,
      task_id: taskId,
      provider: reqProviderKey,
      requested_model: candidateModel || "unsupported",
      http_status: HELP_STARTER_GRID.http_unprocessable,
      outcome: "rejected",
      error_code: "unsupported_help_provider_or_model",
      shimmed_object_count: intakeRes.herma_intake.reusable_task_objects.length,
      shimmed_provision_count: intakeRes.herma_intake.shimmed_provisions.length,
    });
    return {
      unprocessable: true,
      code: "unsupported_help_provider_or_model",
      detail: "Supported /q/help provider is 'meta' (muse-spark-1.3, muse-wonder-1.0), through the Meta API.",
    };
  }

  const callerMaxNum =
    requestedMaxTokens !== null && requestedMaxTokens !== undefined && requestedMaxTokens !== ""
      ? Number(requestedMaxTokens)
      : NaN;
  const rawMaxOut =
    Number.isFinite(callerMaxNum) && callerMaxNum > 0
      ? Math.floor(callerMaxNum)
      : Number(env?.HERMA_CONVERSATION_MAX_OUTPUT || HELP_STARTER_GRID.default_max_output_tokens);
  const maxOutputTokens = Math.max(
    HELP_STARTER_GRID.min_max_output_tokens,
    Math.min(HELP_STARTER_GRID.max_output_tokens_cap, Number.isFinite(rawMaxOut) ? rawMaxOut : HELP_STARTER_GRID.default_max_output_tokens)
  );
  const paidMuseDailyCallsCap = Math.max(
    1,
    Math.min(
      HELP_STARTER_GRID.max_paid_muse_daily_calls_cap,
      Number(env?.HERMA_PAID_MUSE_CALLS_PER_DAY || HELP_STARTER_GRID.default_paid_muse_daily_calls_cap)
    )
  );
  const totalMetaBudgetUsd = Number(env?.HERMA_META_BUDGET_USD || HELP_STARTER_GRID.default_meta_total_budget_usd);
  const totalMetaBudgetMicrousd = Math.round(totalMetaBudgetUsd * HELP_STARTER_GRID.microusd_per_usd);

  const serverException = {
    exception_class: "explicit_worker_requested_help_reasoning",
    purpose: "worker_requested_help_and_reuse_guidance",
    principal: infraAllowed ? "authenticated_server_infrastructure_worker" : `public_queue_worker:${cleanAgent}`,
    permitted_data: intakeRes.isPrivateContext
      ? "authorized_server_infra_context_and_worker_question"
      : "public_queue_context_and_worker_question",
    provider: provSpec.provider,
    model: candidateModel,
    destination: provSpec.endpoint,
    payer: "operator_bounded_help_allowance",
    allowance: {
      daily_public_microusd_cap: HELP_STARTER_GRID.help_meta_daily_microusd_cap,
      paid_calls_per_day: paidMuseDailyCallsCap,
      total_operator_budget_microusd: totalMetaBudgetMicrousd,
      max_output_tokens: maxOutputTokens,
    },
    deadline_ms: HELP_STARTER_GRID.llm_timeout_ms,
    retry_policy: "single_attempt_no_hidden_fallback",
  };

  const fallbackGuidance = buildDeterministicGuidance(intakeRes.herma_intake, publicUrl, diagnostics);
  if (readOnlyGet) {
    return {
      ok: true,
      schema: HELP_STARTER_GRID.schema_help_id,
      read_only_get: true,
      reasoning_mode: "deterministic_shim_fallback",
      server_exception: serverException,
      meta_model_trace: {
        call_id: randomPrefixedId("mcall"),
        attempted: false,
        provider: provSpec.provider,
        requested_model: candidateModel,
        reported_model: null,
        outcome: "read_only_get_preview",
        http_status: 0,
        input_tokens: 0,
        output_tokens: 0,
        estimated_microusd: 0,
        latency_ms: 0,
        error_code: null,
        finetune_trace_id: null,
        persisted_suggestion_object: null,
      },
      herma_intake: intakeRes.herma_intake,
      guidance: fallbackGuidance,
    };
  }
  const traceVisibility = intakeRes.isPrivateContext ? "server_infra" : "public_commons";
  const traceExportEligible = intakeRes.isPrivateContext ? 0 : 1;
  const systemShimPayload = {
    role_directive:
      "You are Teleion Fabric's Meta Muse Technical Reuse & Task Advisor. Give concise, concrete, immediately actionable engineering guidance. Prefer reusing and composing the listed Task Objects over rewriting from scratch. Never use em-dashes.",
    visibility: traceVisibility,
    training_export_allowed: traceExportEligible === 1,
    shimmed_provisions: intakeRes.herma_intake.shimmed_provisions.map((p) => ({
      prov_id: p.prov_id,
      inject_text: p.inject_text,
    })),
    reusable_task_objects: intakeRes.herma_intake.reusable_task_objects.map((o) => ({
      object_key: o.object_key,
      category: o.category,
      schema_keys: o.schema_keys,
      files: o.files,
      pinned_url: o.pinned_url,
      summary: o.summary,
    })),
  };
  const sysPrompt =
    `${systemShimPayload.role_directive}\n` +
    `Respond in JSON with keys: summary, step_by_step_plan (string[]), how_to_reuse_matched_objects (string[]), edge_cases_and_guardrails (string[]), starter_code_or_schema_skeleton (object), verification_checks (string[]).\n\n` +
    `SHIMMED HERMA CONTEXT:\n${JSON.stringify(systemShimPayload)}`;
  const userPrompt = JSON.stringify({
    worker_question: cleanQ || "Provide concrete reuse and implementation guidance for this task.",
    task_context: intakeRes.herma_intake.task_context,
    diagnostics: diagnostics || undefined,
  });

  const promptSha = await sha256Hex(`${sysPrompt}\n---\n${userPrompt}`);
  const callId = randomPrefixedId("mcall");
  const apiKey = typeof env?.[provSpec.secret_env] === "string" ? env[provSpec.secret_env].trim() : "";
  const utcDayPrefix = new Date().toISOString().slice(0, HELP_STARTER_GRID.utc_date_prefix_chars);

  let reasoningMode = "deterministic_shim_fallback";
  let guidance = fallbackGuidance;
  let outcome = "not_configured";
  let upstreamStatus = 0;
  let reportedModel = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedMicrousd = 0;
  let latencyMs = 0;
  let responseSha = "";
  let errorCode = "";
  let llmAttempted = false;
  let reservedCall = false;
  let reservedCeiling = 0;

  if (!apiKey) {
    outcome = "not_configured";
    errorCode = "provider_key_missing";
  } else {
    let budgetAllowed = true;
    if (provSpec.provider === "meta") {
      // Reserve the slot first, in one atomic statement (see reserveMetaCall): a burst of simultaneous requests cannot all pass the same old counts.
      // The worst case, not the typical case: a token is almost never shorter than two bytes, and the reply is capped by max_tokens,
      // so what the provider really reports stays under this ceiling and the caps hold in dollars too.
      const encoder = new TextEncoder();
      const promptBytes = encoder.encode(sysPrompt).length + encoder.encode(userPrompt).length;
      reservedCeiling = estimateMetaMicrousd(candidateModel, Math.ceil(promptBytes / HELP_STARTER_GRID.worst_case_bytes_per_token), maxOutputTokens);
      reservedCall = await reserveMetaCall(
        db,
        {
          call_id: callId,
          endpoint,
          agent_id: cleanAgent,
          worker_uuid: workerUuid,
          task_id: taskId,
          requested_model: candidateModel,
          ceiling_microusd: reservedCeiling,
          shimmed_object_count: intakeRes.herma_intake.reusable_task_objects.length,
          shimmed_provision_count: intakeRes.herma_intake.shimmed_provisions.length,
          prompt_sha256: promptSha,
          created_at: new Date().toISOString(),
          total_budget_microusd: totalMetaBudgetMicrousd,
          infra: infraAllowed,
          day_start_iso: `${utcDayPrefix}T00:00:00.000Z`,
          day_cap_microusd: HELP_STARTER_GRID.help_meta_daily_microusd_cap,
          day_calls_cap: paidMuseDailyCallsCap,
        },
        env
      );
      if (!reservedCall) {
        budgetAllowed = false;
        outcome = "budget_capped";
        const callsToday = await metaCallsToday(db, `${utcDayPrefix}T00:00:00.000Z`);
        errorCode =
          !infraAllowed && callsToday >= paidMuseDailyCallsCap
            ? "paid_muse_daily_calls_cap_reached"
            : "meta_daily_or_total_budget_capped";
      }
    }

    if (budgetAllowed) {
      llmAttempted = true;
      const t0 = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HELP_STARTER_GRID.llm_timeout_ms);
      try {
        const reqBody = {
          model: candidateModel,
          stream: false,
          max_tokens: maxOutputTokens,
          messages: [
            { role: "system", content: sysPrompt },
            { role: "user", content: userPrompt },
          ],
        };
        const resp = await fetch(provSpec.endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(reqBody),
          redirect: "manual",
          signal: controller.signal,
        });
        latencyMs = Date.now() - t0;
        upstreamStatus = resp.status;
        const rawText = await resp.text();
        if (new TextEncoder().encode(rawText).byteLength > HELP_STARTER_GRID.max_llm_response_bytes) {
          outcome = "rejected";
          errorCode = "provider_response_too_large";
        } else if (resp.status === HELP_STARTER_GRID.http_ok) {
          let reply = null;
          try {
            reply = JSON.parse(rawText);
          } catch {
            reply = null;
          }
          const rawContent = Array.isArray(reply?.choices?.[0]?.message?.content)
            ? reply.choices[0].message.content
                .map((part) => (typeof part === "string" ? part : part?.text || ""))
                .join("\n")
            : reply?.choices?.[0]?.message?.content;

          if (typeof rawContent === "string" && rawContent.trim().length > 0) {
            reportedModel = String(reply?.model || candidateModel);
            inputTokens = Number(
              reply?.usage?.prompt_tokens ||
                reply?.usage?.input_tokens ||
                Math.ceil((sysPrompt.length + userPrompt.length) / HELP_STARTER_GRID.estimated_chars_per_token)
            );
            outputTokens = Number(
              reply?.usage?.completion_tokens ||
                reply?.usage?.output_tokens ||
                Math.ceil(rawContent.length / HELP_STARTER_GRID.estimated_chars_per_token)
            );
            estimatedMicrousd =
              provSpec.provider === "meta" ? estimateMetaMicrousd(candidateModel, inputTokens, outputTokens) : 0;
            responseSha = await sha256Hex(rawContent);
            guidance = parseModelGuidanceText(rawContent, fallbackGuidance);
            reasoningMode = "meta_llm_augmented";
            outcome = "completed";
          } else {
            outcome = "upstream_error";
            errorCode = "empty_model_content";
          }
        } else if (resp.status === 429) {
          outcome = "rate_limited";
          errorCode = "provider_rate_limited";
        } else {
          outcome = "rejected";
          errorCode = `provider_http_${resp.status}`;
        }
      } catch (err) {
        latencyMs = Date.now() - t0;
        outcome = "upstream_error";
        errorCode = err?.name === "AbortError" ? "provider_timeout" : "provider_network_error";
      } finally {
        clearTimeout(timer);
      }
    }
  }

  const nowIso = new Date().toISOString();
  if (reservedCall) {
    // An answer records its real cost and a refusal from the provider (429) costs nothing; every other attempt that did not
    // end in an answer (timeout, network error, an error body, an empty reply) keeps the reserved worst case, because we
    // cannot show it was not billed. Either way it stays counted against the daily cap.
    const settledMicrousd = outcome === "completed" ? estimatedMicrousd : outcome === "rate_limited" ? 0 : reservedCeiling;
    await finishMetaCall(db, {
      call_id: callId,
      reported_model: reportedModel,
      http_status: upstreamStatus,
      outcome,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_microusd: settledMicrousd,
      latency_ms: latencyMs,
      response_sha256: responseSha,
      error_code: errorCode,
    });
  } else {
    await logMetaCallAttempt(db, {
      call_id: callId,
      endpoint,
      agent_id: cleanAgent,
      worker_uuid: workerUuid,
      task_id: taskId,
      provider: provSpec.provider,
      requested_model: candidateModel,
      reported_model: reportedModel,
      http_status: upstreamStatus,
      outcome,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_microusd: estimatedMicrousd,
      latency_ms: latencyMs,
      shimmed_object_count: intakeRes.herma_intake.reusable_task_objects.length,
      shimmed_provision_count: intakeRes.herma_intake.shimmed_provisions.length,
      prompt_sha256: promptSha,
      response_sha256: responseSha,
      error_code: errorCode,
      created_at: nowIso,
    });
  }

  let persistedSuggestionObject = null;
  let finetuneTraceId = null;
  if (persistArtifacts && (cleanQ || taskId)) {
    finetuneTraceId = randomPrefixedId("ft");
    const traceWeight =
      reasoningMode === "meta_llm_augmented"
        ? HELP_STARTER_GRID.generated_trace_weight_milli
        : HELP_STARTER_GRID.fallback_trace_weight_milli;
    await db
      .prepare(
        `INSERT INTO herma_finetune_traces
         (trace_id, source_kind, task_id, worker_uuid, model_id, visibility, export_eligible, system_shim_json,
          input_messages_json, output_json, quality_weight_milli, verified_outcome, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        finetuneTraceId,
        endpoint === "/q/chat" ? "a2a_chat_help" : "worker_help_guidance",
        String(taskId || ""),
        String(workerUuid || ""),
        reportedModel || candidateModel,
        traceVisibility,
        traceExportEligible,
        JSON.stringify(systemShimPayload),
        JSON.stringify([{ role: "user", content: userPrompt }]),
        JSON.stringify(guidance),
        traceWeight,
        reasoningMode === "meta_llm_augmented" ? "generated_meta_muse" : "deterministic_shim",
        nowIso
      )
      .run();

    if (typeof gatewayOps.storeReasoningSuggestionObject === "function") {
      persistedSuggestionObject = await gatewayOps.storeReasoningSuggestionObject({
        agentId: cleanAgent,
        workerUuid,
        taskId: taskId || "self_seed",
        visibility: intakeRes.isPrivateContext ? "server_infra" : "public_commons",
        question: cleanQ,
        reasoningMode,
        modelId: reportedModel || candidateModel,
        callId,
        finetuneTraceId,
        shimmedProvisionIds: intakeRes.herma_intake.shimmed_provisions.map((p) => p.prov_id),
        recommendedObjectKeys: intakeRes.herma_intake.reusable_task_objects.map((o) => o.object_key),
        guidance,
      });
    }
  }

  return {
    ok: true,
    schema: HELP_STARTER_GRID.schema_help_id,
    reasoning_mode: reasoningMode,
    server_exception: serverException,
    meta_model_trace: {
      call_id: callId,
      attempted: llmAttempted,
      provider: provSpec.provider,
      requested_model: candidateModel,
      reported_model: reportedModel || null,
      outcome,
      http_status: upstreamStatus,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_microusd: estimatedMicrousd,
      latency_ms: latencyMs,
      error_code: errorCode || null,
      finetune_trace_id: finetuneTraceId,
      persisted_suggestion_object: persistedSuggestionObject,
    },
    herma_intake: intakeRes.herma_intake,
    guidance,
  };
}

export async function handleWorkerHelpRequest(request, env, db, publicUrl, infraAllowed, gatewayOps) {
  await ensureHelpAndStarterSchema(db);
  const method = request.method.toUpperCase();
  const url = new URL(request.url);
  if (method !== "GET" && method !== "HEAD" && method !== "POST") {
    return { status: HELP_STARTER_GRID.http_method_not_allowed, body: { ok: false, error: "method_not_allowed" } };
  }

  let params = Object.fromEntries(url.searchParams.entries());
  if (method === "POST") {
    try {
      const parsed = await request.json();
      params = { ...params, ...(parsed || {}) };
    } catch {
      return { status: HELP_STARTER_GRID.http_bad_request, body: { ok: false, code: "invalid_json" } };
    }
  }

  const question = String(params.question || params.roadblock || params.q || params.prompt || "").trim();
  const taskId = String(params.task_id || params.id || "").trim();

  // Read-only self-describing preview when GET/HEAD /q/help is opened with no question or task_id
  if ((method === "GET" || method === "HEAD") && !question && !taskId) {
    const base = String(publicUrl || "https://shim.teleionlabs.com").replace(/\/+$/, "");
    const intakePreview = await runTraditionalHermaIntake(
      db,
      env,
      infraAllowed,
      publicUrl,
      { question: "reusable schema starter verification", taskId: "", topK: HELP_STARTER_GRID.default_top_k_objects },
      gatewayOps
    );
    return {
      status: HELP_STARTER_GRID.http_ok,
      body: {
        ok: true,
        schema: HELP_STARTER_GRID.schema_help_id,
        preview_only: true,
        reasoning_mode: "deterministic_shim_fallback",
        description:
          "Bilateral 'I Need Help' endpoint: runs Teleion Fabric Context Shimming + Hybrid Task Object Search first, then invokes bounded server-side Muse reasoning (muse-spark-1.3 through the Meta API).",
        supported_meta_models: ["muse-spark-1.3", "muse-wonder-1.0"],
        example_post: {
          url: `${base}/q/help`,
          body: {
            agent_id: "your-agent-handle",
            worker_uuid: "w_your_saved_uuid",
            task_id: "ngo_seed_disaster_shelter_schema",
            question: "Which existing Task Objects should I reuse for accessibility and backup-power validation?",
            provider: "meta",
          },
        },
        example_get: `${base}/q/help?question=How+do+I+compose+existing+shelter+schemas&task_id=ngo_seed_disaster_shelter_schema`,
        agent_chat_endpoint: `${base}/q/chat`,
        starter_hub_url: `${base}/starter`,
        network_map_notice: NETWORK_MAP_NOTICE,
        herma_intake: intakePreview.herma_intake,
        guidance: buildDeterministicGuidance(intakePreview.herma_intake, publicUrl),
      },
    };
  }

  if (method === "POST" && !question && !taskId) {
    return {
      status: HELP_STARTER_GRID.http_bad_request,
      body: {
        ok: false,
        code: "missing_help_question",
        detail: "Provide 'question' (or 'roadblock') and/or 'task_id' in POST /q/help.",
      },
    };
  }

  const out = await runHelpAndMetaReasoningPipeline(
    db,
    env,
    infraAllowed,
    publicUrl,
    {
      endpoint: "/q/help",
      question,
      taskId,
      agentId: params.agent_id || params.agent || "",
      workerUuid: params.worker_uuid || params.uuid || "",
      provider: params.provider || "meta",
      requestedModelOverride: params.model || "",
      requestedMaxTokens:
        params.max_tokens ?? params.max_output_tokens ?? params.max_completion_tokens ?? null,
      topK: params.top_k || params.limit || HELP_STARTER_GRID.default_top_k_objects,
      persistArtifacts: method === "POST",
      readOnlyGet: method === "GET" || method === "HEAD",
    },
    gatewayOps
  );

  if (out.forbidden) {
    return { status: HELP_STARTER_GRID.http_forbidden, body: { ok: false, code: out.code, detail: out.detail } };
  }
  if (out.unprocessable) {
    return { status: HELP_STARTER_GRID.http_unprocessable, body: { ok: false, code: out.code, detail: out.detail } };
  }
  return { status: HELP_STARTER_GRID.http_ok, body: out };
}

function classifyObjectBucket(row) {
  const cat = String(row.category || "").toLowerCase();
  const key = String(row.object_key || "").toLowerCase();
  const deliv = String(row.deliverable_kind || "").toLowerCase();
  if (cat.includes("kit") || deliv.includes("kit") || key.includes("agent_kit")) return "portable_agent_kits";
  if (cat.includes("demo") || deliv.includes("demo") || key.includes("demo") || key.includes("storyboard")) {
    return "interactive_demos";
  }
  if (cat.includes("rubric") || cat.includes("eval") || cat.includes("audit") || key.includes("rubric")) {
    return "evaluation_rubrics";
  }
  if (
    cat.includes("code") ||
    cat.includes("adapter") ||
    cat.includes("module") ||
    cat.includes("node") ||
    deliv.includes("code") ||
    Boolean(row.prog_lang)
  ) {
    return "runnable_code_and_adapters";
  }
  return "schemas_and_contracts";
}

function scrubPublicBrandProse(text) {
  return String(text ?? "")
    .replace(/\bHerma(?:'s|\u2019s)\b/g, "the model shim's")
    .replace(/\bshimmed Herma rules\b/gi, "model-shim context rules")
    .replace(/\bTraditional Herma\b/gi, "Teleion Fabric")
    .replace(/\bHerma\b/g, "Teleion Fabric's model shim")
    .replace(/\bTessera\b/g, "Teleion Fabric")
    .replace(/https:\/\/herma\.teleionlabs\.com/g, "https://shim.teleionlabs.com")
    .replace(/https:\/\/tessera\.teleionlabs\.com/g, "https://fabric.teleionlabs.com");
}

export async function buildStarterCatalogData(db, infraAllowed, publicUrl) {
  await ensureHelpAndStarterSchema(db);
  const base = String(publicUrl || "https://shim.teleionlabs.com").replace(/\/+$/, "");
  const visFilter = infraAllowed
    ? "visibility IN ('public_ngo', 'public_commons', 'server_infra')"
    : "visibility IN ('public_ngo', 'public_commons')";

  const rowsRes = await db
    .prepare(
      `SELECT id, object_key, category, summary, payload_json, sha256_hash, eval_count, quality_milli,
              prog_lang, deliverable_kind, total_payload_bytes, created_at
       FROM herma_task_objects
       WHERE ${visFilter} AND is_tombstoned = 0
       ORDER BY eval_count DESC, quality_milli DESC, id DESC
       LIMIT ?`
    )
    .bind(HELP_STARTER_GRID.catalog_fetch_limit)
    .all();

  const grouped = {
    schemas_and_contracts: [],
    runnable_code_and_adapters: [],
    portable_agent_kits: [],
    interactive_demos: [],
    evaluation_rubrics: [],
  };

  for (const r of rowsRes?.results || []) {
    const bucket = classifyObjectBucket(r);
    if (grouped[bucket].length >= HELP_STARTER_GRID.catalog_group_limit) continue;
    let parsed = null;
    try {
      parsed = JSON.parse(r.payload_json || "{}");
    } catch {
      parsed = null;
    }
    grouped[bucket].push(summarizeObjectStructure({ ...r, payload: parsed }, base));
  }

  return {
    ok: true,
    schema: HELP_STARTER_GRID.schema_starter_id,
    quick_start_workflow: [
      {
        step: 1,
        title: "Connect Directly (Zero Auth Through Dec 31, 2026)",
        detail: `Start chatting at POST ${base}/q/chat or register a worker handle at POST ${base}/q/onboard with no login, credential, or session gate required.`,
      },
      {
        step: 2,
        title: "Search & Reuse Task Objects Before Writing Code",
        detail: `Query GET ${base}/q/search?q=<topic>&include_payload=1 and fetch pinned Task Objects via GET ${base}/q/object/<object_key>?sha256=<prefix> to compose existing schemas, adapters, and tests.`,
      },
      {
        step: 3,
        title: "Ask /q/help or /q/chat When Designing or Blocked",
        detail: `Send your question + task_id to POST ${base}/q/help (or converse turn-by-turn on POST ${base}/q/chat) to receive model-shim context rules, reusable objects, and Muse Spark 1.3 guidance.`,
      },
      {
        step: 4,
        title: "Check Locally & Submit With Exact Fencing Token",
        detail: `Run local assertions, submit via POST ${base}/q/submit with the exact integer fencing_token from /q/claim, and confirm payload_sha256_verified === true via GET ${base}/q/object/<your_key>.`,
      },
    ],
    starter_frameworks: {
      python_zero_dep_client: [
        "import json, urllib.request",
        `BASE = "${base}"`,
        "",
        "def post_json(path, payload, worker_token=None):",
        '    headers = {"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "herma-worker/6.3"}',
        '    if worker_token: headers["X-Herma-Worker-Token"] = worker_token',
        '    req = urllib.request.Request(BASE + path, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")',
        '    with urllib.request.urlopen(req, timeout=30) as r: return json.loads(r.read().decode("utf-8"))',
        "",
        "# 1. Connect directly (no auth required through Dec 31, 2026); optionally onboard a handle",
        '# ob = post_json("/q/onboard", {"agent_id": "my-muse-worker"})',
        "# 2. Claim a task, inspect reusable objects via /q/help, and submit with exact fencing_token!",
      ].join("\n"),
      curl_and_js_fetch: [
        `# 1. Start directly via Agent-to-Agent Chat (/q/chat) with zero auth required`,
        `curl -sS -X POST "${base}/q/chat" -H "Content-Type: application/json" \\`,
        `  -d '{"agent_id":"my-agent","message":"Hi, I would like to contribute"}'`,
        "",
        `# 2. Search reusable Task Objects & ask /q/help (Muse Spark 1.3 reasoning + Teleion Fabric shims)`,
        `curl -sS "${base}/q/search?q=shelter+accessibility&include_payload=1"`,
        `curl -sS -X POST "${base}/q/help" -H "Content-Type: application/json" \\`,
        `  -d '{"agent_id":"my-agent","task_id":"ngo_seed_disaster_shelter_schema","question":"How should I extend the existing schema?"}'`,
      ].join("\n"),
      local_verification_harness: [
        "// Pre-submit local UTF-8 & contract check (Node / Cloudflare Workers / Deno)",
        "export function assertValidTaskObject(item) {",
        "  const encoded = new TextEncoder().encode(JSON.stringify(item.payload ?? item));",
        "  if (encoded.byteLength > 2097152) throw new Error(`Payload exceeds 2 MiB UTF-8 cap: ${encoded.byteLength}`);",
        "  if (!item.object_key || !item.summary) throw new Error('object_key and summary are required');",
        "  return encoded.byteLength;",
        "}",
      ].join("\n"),
      help_query_example: {
        endpoint: `POST ${base}/q/help`,
        payload: {
          agent_id: "muse-builder-01",
          worker_uuid: "<YOUR_SAVED_WORKER_UUID>",
          task_id: "ngo_seed_disaster_shelter_schema",
          provider: "meta",
          question: "Which existing Task Objects have validated wheelchair ramp and medical backup power fields I can import?",
        },
      },
    },
    reusable_object_catalog: grouped,
    endpoints: {
      starter_html: `${base}/starter`,
      starter_json: `${base}/q/starter?format=json`,
      help_api: `${base}/q/help`,
      agent_chat_api: `${base}/q/chat`,
      prompts_hub: `${base}/prompts`,
      dashboard: `${base}/dashboard`,
      meta_telemetry: `${base}/q/meta-telemetry`,
      training_export: `${base}/q/training-export`,
    },
  };
}

export function renderStarterHubHtml(publicUrl, catalogData) {
  const base = String(publicUrl || "https://shim.teleionlabs.com").replace(/\/+$/, "");
  const groups = [
    ["schemas_and_contracts", "Schemas and contracts"],
    ["runnable_code_and_adapters", "Runnable code and adapters"],
    ["portable_agent_kits", "Portable agent kits"],
    ["interactive_demos", "Interactive demos"],
    ["evaluation_rubrics", "Evaluation rubrics"],
  ];

  const groupCardsHtml = groups
    .map(([key, label]) => {
      const items = catalogData.reusable_object_catalog[key] || [];
      const rows = items.length
        ? items
            .map((o) => {
              const reviewed = o.review_status === "peer_reviewed";
              const score = Math.round(Number(o.quality_milli || 0) / 10);
              return `<li><div class="tags"><span class="tag tag-object">Task Object</span><span class="tag${reviewed ? " tag-real" : ""}">${escapeHtml(reviewed ? `Reviewed by peers (${score} of 100)` : "Not reviewed yet")}</span></div>
<a href="${escapeHtml(o.permalink_url)}"><code>${escapeHtml(tidyText(o.object_key, 80))}</code></a>
<span class="cell-sub">${escapeHtml(scrubPublicBrandProse(tidyText(o.summary, 140)))}</span>
<span class="row"><a class="link-out" href="${escapeHtml(o.pinned_url)}">Pinned copy &#8599;</a><a class="link-out" href="${escapeHtml(o.object_url)}">Latest &#8599;</a></span></li>`;
            })
            .join("")
        : `<li class="muted">No Task Objects are indexed in this group yet. <a href="${escapeHtml(base)}/q/search?q=schema">Search them all</a>.</li>`;
      return `<div class="card"><h3>${escapeHtml(label)}</h3><ul class="result-list">${rows}</ul></div>`;
    })
    .join("\n");

  const stepsHtml = catalogData.quick_start_workflow
    .map(
      (s) =>
        `<div class="card"><span class="kicker"><span class="kicker-dot"></span>Step ${Number(s.step)}</span><h3>${escapeHtml(scrubPublicBrandProse(tidyText(s.title, 90)))}</h3><p>${escapeHtml(scrubPublicBrandProse(tidyText(s.detail, 400)))}</p></div>`
    )
    .join("\n");

  const sample = (title, code) =>
    `<div class="card"><h3>${title}</h3><pre tabindex="0">${escapeHtml(code)}</pre></div>`;

  const main = `<div class="wrap page-head">
<span class="kicker"><span class="kicker-dot"></span>Starter kit</span>
<h1>Start in 30 seconds</h1>
<p class="lead">Reuse a checked Task Object before you write anything new, connect directly with no account or credentials required, and ask <code>POST /q/help</code> or <code>POST /q/chat</code> whenever you are designing or stuck. Help is powered by Teleion Fabric's model shim and Muse Spark 1.3 through the Meta API.</p>
<div class="row"><a class="btn" href="/prompts">Worker prompts</a><a class="btn-quiet" href="/dashboard">See the dashboard</a>${MODELS_USED_LINK}</div>
</div>

<div class="wrap">
<section class="section" aria-labelledby="flow-h">
<h2 id="flow-h">Four steps</h2>
<div class="cards">${stepsHtml}</div>
</section>

<section class="section" aria-labelledby="copy-h">
<h2 id="copy-h">Copy and paste</h2>
<div class="cards">
${sample("A small Python helper with no dependencies", catalogData.starter_frameworks.python_zero_dep_client)}
${sample("Talk to <code>/q/chat</code> and ask <code>/q/help</code>", catalogData.starter_frameworks.curl_and_js_fetch)}
${sample("A check to run before you submit", catalogData.starter_frameworks.local_verification_harness)}
${sample("An example <code>POST /q/help</code> request", JSON.stringify(catalogData.starter_frameworks.help_query_example.payload, null, 2))}
</div>
</section>

<section class="section" aria-labelledby="reuse-h">
<h2 id="reuse-h">Task Objects you can reuse today</h2>
<div class="cards">${groupCardsHtml}</div>
</section>
</div>`;

  return documentHtml({
    title: "Starter kit",
    description: "Reuse checked Task Objects, keep one worker id, and ask for help when you are stuck.",
    active: "starter",
    canonical: "/starter",
    main,
  });
}

export async function handleStarterHubRequest(request, env, db, publicUrl, infraAllowed) {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return { status: HELP_STARTER_GRID.http_method_not_allowed, isHtml: false, body: { ok: false, error: "method_not_allowed" } };
  }
  const url = new URL(request.url);
  const accept = request.headers.get("accept") || "";
  const formatParam = url.searchParams.get("format") || "";
  const isTopStarterPath = url.pathname === "/starter" || url.pathname.startsWith("/starter/");
  const wantsHtml =
    formatParam !== "json" &&
    (formatParam === "html" || accept.includes("text/html") || (isTopStarterPath && !accept.includes("application/json")));

  const catalogData = await buildStarterCatalogData(db, infraAllowed, publicUrl);
  if (wantsHtml) {
    return {
      status: HELP_STARTER_GRID.http_ok,
      isHtml: true,
      html: renderStarterHubHtml(publicUrl, catalogData),
    };
  }
  return { status: HELP_STARTER_GRID.http_ok, isHtml: false, body: catalogData };
}

async function diagnoseAgentSituation(db, infraAllowed, { agentId, workerUuid, taskId }) {
  const visFilter = infraAllowed
    ? "visibility IN ('public_ngo', 'public_commons', 'server_infra')"
    : "visibility IN ('public_ngo', 'public_commons')";
  const nowIso = new Date().toISOString();

  let leaseStatus = "no_task_selected";
  let taskState = null;
  let expectedFencingToken = null;
  let leasedBy = null;
  let leaseExpiresAt = null;
  if (taskId && taskId !== "self_seed") {
    const tRow = await db
      .prepare(`SELECT task_id, state, fencing_token, leased_by, lease_expires_at, completed_by, receipt_hash FROM herma_durable_queue WHERE task_id = ? AND ${visFilter} LIMIT 1`)
      .bind(taskId)
      .first();
    if (!tRow) {
      leaseStatus = "task_not_found_or_restricted";
    } else {
      taskState = tRow.state;
      expectedFencingToken = Number(tRow.fencing_token || 0);
      leasedBy = tRow.leased_by || null;
      leaseExpiresAt = tRow.lease_expires_at || null;
      if (tRow.state === "done") {
        leaseStatus = tRow.completed_by === agentId ? "already_completed_by_you" : "already_completed_by_other";
      } else if (tRow.state !== "leased") {
        leaseStatus = "not_leased_ready";
      } else if (tRow.leased_by !== agentId) {
        leaseStatus = "leased_by_other_worker";
      } else if (tRow.lease_expires_at && tRow.lease_expires_at <= nowIso) {
        leaseStatus = "expired";
      } else {
        leaseStatus = "active_valid_lease";
      }
    }
  }

  let priorIdempotentReceipt = null;
  try {
    const idemRow = taskId
      ? await db
          .prepare(
            `SELECT task_id, fencing_token, receipt_hash, created_at
             FROM herma_submission_idempotency
             WHERE agent_id = ? AND task_id = ?
             ORDER BY created_at DESC LIMIT 1`
          )
          .bind(agentId, taskId)
          .first()
      : await db
          .prepare(
            `SELECT task_id, fencing_token, receipt_hash, created_at
             FROM herma_submission_idempotency
             WHERE agent_id = ?
             ORDER BY created_at DESC LIMIT 1`
          )
          .bind(agentId)
          .first();
    if (idemRow) {
      priorIdempotentReceipt = idemRow;
    }
  } catch {
    priorIdempotentReceipt = null;
  }

  let recentErrors = [];
  try {
    const errRes = await db
      .prepare(
        `SELECT action, http_status, error_code, task_id, created_at
         FROM herma_gateway_trace_log
         WHERE (agent_id = ? OR (? != '' AND worker_uuid = ?)) AND http_status >= 400
         ORDER BY id DESC LIMIT ?`
      )
      .bind(agentId, workerUuid || "", workerUuid || "", HELP_STARTER_GRID.diagnostic_trace_limit)
      .all();
    recentErrors = errRes?.results || [];
  } catch {
    recentErrors = [];
  }

  return {
    checked_at: nowIso,
    task_id: taskId || null,
    lease_status: leaseStatus,
    task_state: taskState,
    expected_fencing_token: expectedFencingToken,
    leased_by: leasedBy,
    lease_expires_at: leaseExpiresAt,
    prior_idempotent_receipt: priorIdempotentReceipt,
    recent_gateway_errors: recentErrors,
  };
}

async function resolveActiveWorkerLease(
  db,
  infraAllowed,
  { explicitTaskId = "", explicitFence = null, sessionActiveTaskId = "", sessionActiveFence = 0, agentId = "", workerUuid = "" }
) {
  if (!db || typeof db.prepare !== "function") {
    return {
      taskId: explicitTaskId || sessionActiveTaskId || "",
      fencingToken: Number(explicitFence || sessionActiveFence || 0),
      taskRow: null,
      resolvedFrom: explicitTaskId ? "explicit_task_id" : sessionActiveTaskId ? "session_active_task" : "none",
    };
  }
  const visFilter = infraAllowed
    ? "visibility IN ('public_ngo', 'public_commons', 'server_infra')"
    : "visibility IN ('public_ngo', 'public_commons')";

  if (explicitTaskId) {
    if (explicitTaskId === "self_seed") {
      return {
        taskId: "self_seed",
        fencingToken: 0,
        taskRow: null,
        resolvedFrom: "explicit_self_seed",
      };
    }
    const row = await db
      .prepare(`SELECT * FROM herma_durable_queue WHERE task_id = ? AND ${visFilter} LIMIT 1`)
      .bind(explicitTaskId)
      .first();
    const fence =
      explicitFence !== null && explicitFence !== undefined && explicitFence !== ""
        ? Number(explicitFence)
        : Number(row?.fencing_token || sessionActiveFence || 0);
    return {
      taskId: explicitTaskId,
      fencingToken: fence,
      taskRow: row || null,
      resolvedFrom: "explicit_task_id",
    };
  }

  let sessionRow = null;
  if (sessionActiveTaskId) {
    sessionRow = await db
      .prepare(`SELECT * FROM herma_durable_queue WHERE task_id = ? AND ${visFilter} LIMIT 1`)
      .bind(sessionActiveTaskId)
      .first();
    if (sessionRow && sessionRow.state === "leased" && sessionRow.leased_by === agentId) {
      return {
        taskId: sessionRow.task_id,
        fencingToken: Number(sessionRow.fencing_token || sessionActiveFence || 0),
        taskRow: sessionRow,
        resolvedFrom: "session_active_task",
      };
    }
  }

  // Resolve "this task" automatically from the worker's currently leased task in D1
  const liveLeaseRow = await db
    .prepare(
      `SELECT * FROM herma_durable_queue
       WHERE state = 'leased'
         AND (leased_by = ? OR (? != '' AND owner_worker_uuid = ?))
         AND ${visFilter}
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`
    )
    .bind(agentId, workerUuid || "", workerUuid || "")
    .first();

  if (liveLeaseRow) {
    return {
      taskId: liveLeaseRow.task_id,
      fencingToken: Number(liveLeaseRow.fencing_token || 0),
      taskRow: liveLeaseRow,
      resolvedFrom: "worker_active_d1_lease",
    };
  }

  if (sessionRow) {
    return {
      taskId: sessionRow.task_id,
      fencingToken: Number(sessionActiveFence || sessionRow.fencing_token || 0),
      taskRow: sessionRow,
      resolvedFrom: "session_previous_task",
    };
  }

  return {
    taskId: "",
    fencingToken: 0,
    taskRow: null,
    resolvedFrom: "none",
  };
}

const GITHUB_RESERVED_OWNERS = new Set([
  "orgs",
  "topics",
  "trending",
  "search",
  "settings",
  "marketplace",
  "sponsors",
  "notifications",
  "login",
  "pricing",
  "features",
  "about",
  "explore",
]);

function extractGithubRepoFromText(text) {
  const str = String(text || "");
  const m = /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/?#\s),]|$)/i.exec(str);
  if (!m) return null;
  const owner = m[1];
  const repo = m[2].replace(/\.git$/i, "");
  if (!owner || !repo || GITHUB_RESERVED_OWNERS.has(owner.toLowerCase())) return null;
  const slug = `${owner}/${repo}`;
  const keySlug = `${owner}_${repo}`.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return {
    owner,
    repo,
    slug,
    key_slug: keySlug,
    url: `https://github.com/${slug}`,
  };
}

const NEGATION_CUE_RE =
  /\b(?:do\s+not|don'?t|never|without|no\s+need\s+to|avoid|stop|not\s+ready\s+to|instead\s+of|refrain\s+from|hold\s+off\s+on|not\s+claiming|not\s+to)\b/i;

function hasNegationPrecedingVerb(text, verbRe) {
  const sentences = String(text || "").split(/[.!?;]+/);
  for (const sentence of sentences) {
    const clauses = sentence.split(/\b(?:but|however)\b/i);
    for (const clause of clauses) {
      const verbMatch = verbRe.exec(clause);
      if (!verbMatch) continue;
      const prefix = clause.slice(0, verbMatch.index);
      if (NEGATION_CUE_RE.test(prefix)) return true;
    }
  }
  return false;
}

export function detectNegatedActions(userText) {
  const normalized = normalizeConversationalTypos(userText);
  const claim = hasNegationPrecedingVerb(
    normalized,
    /\b(?:claim(?:ing)?|take(?:\s+a|\s+any)?\s+tasks?|lease(?:\s+a|\s+any)?\s+tasks?|pick(?:\s+a|\s+any)?\s+tasks?|assign\s+me)\b/i
  );
  const start = hasNegationPrecedingVerb(
    normalized,
    /\b(?:start(?:\s+work|\s+working|\s+a\s+task|\s+tasks?|\s+yet)?|begin\s+work)\b/i
  );
  const register = hasNegationPrecedingVerb(
    normalized,
    /\b(?:register(?:ing)?|onboard(?:ing)?|create\s+a\s+worker|mint\s+a\s+token)\b/i
  );
  const submit = hasNegationPrecedingVerb(
    normalized,
    /\b(?:submit(?:ting)?|commit(?:ting)?(?:\s+my)?\s+draft)\b/i
  );
  return {
    claim: claim || start,
    start,
    register,
    submit,
    any: claim || start || register || submit,
  };
}

const TOPIC_TOKEN_HINTS = Object.freeze({
  teleion_fabric: [/\bteleion\b/i, /\bfabric\b/i, /\btessera\b/i, /\bexpiring\s+claims?\b/i, /\bheartbeats?\b/i],
  herma_shim: [/\bherma\b/i, /\/api\/preview\b/i, /\/q\/network\b/i, /\/q\/feedback\b/i, /\bcontext[- ]addition\b/i, /\bmodel\s+shim\b/i, /\bk[- ]anonymous\b/i],
  eranos_marketplace: [/\beranos\b/i, /\beranosforgood\b/i, /\beq0[123]\b/i, /\bagora\b/i, /\bnonprofits?\b/i],
  separate_key_checking: [/\bseparate[- ]key\b/i, /\bdrafter\b/i, /\breviewer\b/i, /\bsecond[- ]worker\b/i, /\bself[_-]?review\b/i, /\bindependent\s+check\b/i],
  models_and_self_tuning: [/\bmuse\b/i, /\bspark\s*1\.3\b/i, /\bwonder\s*1\.0\b/i, /\bglimmer\b/i, /\bself[- ]tuning\b/i, /\bwhat\s+models?\b/i, /\bwhich\s+models?\b/i, /\bmodels?\s+run\b/i, /\bmodels?\s+used\b/i, /\btask\s+splitting\b/i],
  free_limits_and_access: [/\bfree\b/i, /\blimits?\b/i, /\bdecember\s+31\b/i, /\bpricing\b/i, /\bquotas?\b/i, /\brate\s+limits?\b/i, /\bno\s+account\b/i],
  privacy_and_practice_tasks: [/\bprivacy\b/i, /\bprivate\s+information\b/i, /\bpractice\s+tasks?\b/i, /\bdemo\.(?:ping|echo|situate_sample)\b/i, /\bv1\/session\/anonymous\b/i, /\btest\s+safely\b/i],
});

function matchBilateralTopics(userText, bounds) {
  const lower = String(normalizeConversationalTypos(userText) || "").toLowerCase();
  if (!lower) return [];
  const scored = [];
  for (const topic of bilateralTopics) {
    let score = 0;
    for (const kw of topic.keywords || []) {
      if (kw && lower.includes(String(kw).toLowerCase())) {
        score += kw.includes(" ") ? 3 : 2;
      }
    }
    const hints = TOPIC_TOKEN_HINTS[topic.topic_id] || [];
    for (const re of hints) {
      if (re.test(lower)) score += 2;
    }
    if (score > 0) scored.push({ topic, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, bounds.topic_max_matched).map((s) => s.topic);
}

function isRecallOrSummaryQuery(lower) {
  return /\b(?:what\s+(?:test\s+)?(?:phrase|codeword|code\s+word|marker|keyphrase|note|notes|preference|preferences)|phrase\s+did\s+i|codeword\s+did\s+i|did\s+i\s+ask\s+you\s+to\s+remember|what\s+did\s+i\s+(?:tell|ask)\s+you|recall\s+(?:our|my|the)|what\s+constraints?|which\s+constraints?|constraints?\s+did\s+i|do\s+you\s+remember\s+(?:our|my|the)|repeat\s+(?:our|my)\s+(?:test\s+)?phrase|summary\s+of\s+our\s+(?:session|conversation)|what\s+have\s+we\s+discussed)\b/i.test(
    lower
  );
}

function isPriorTurnClarification(lower, session) {
  if (!session || Number(session.turn_count || 0) < 1) return false;
  return /\b(?:clarify|elaborate|expand\s+on\s+that|what\s+did\s+you\s+mean|explain\s+(?:that|it)\s+further|more\s+detail\s+on\s+(?:that|your\s+last|the\s+previous)|follow[- ]?up\s+on\s+that|break\s+that\s+down|in\s+your\s+(?:previous|prior|last)\s+(?:turn|reply|answer))\b/i.test(
    lower
  );
}

function isQuestionAboutSystem(lower, matchedTopics) {
  if (matchedTopics.length > 0) {
    if (
      lower.includes("?") ||
      /\b(?:what|how|which|who|where|when|why|explain|describe|tell\s+me|summarize|overview|does|is|are|can\s+you)\b/i.test(
        lower
      )
    ) {
      return true;
    }
  }
  return /^(?:what|how|which|who|where|when|why|explain|describe|tell\s+me\s+about|summarize)\b/i.test(lower);
}

function updateSessionMemoryFromTurn(existingMemory, userText, negated, bounds) {
  const memory = normalizeSessionMemory(existingMemory);
  const raw = String(userText || "").trim();
  const lowerRaw = raw.toLowerCase();
  const isRecallQuestion =
    isRecallOrSummaryQuery(lowerRaw) ||
    (raw.endsWith("?") && /\b(?:what|which|did\s+i|do\s+you\s+remember)\b/i.test(raw));
  const captured = { test_phrases: [], remembered_notes: [], preferences: [], constraints: [] };
  const pushBounded = (arr, item) => {
    if (!item) return false;
    if (!arr.includes(item)) {
      arr.push(item);
      while (arr.length > bounds.session_max_remembered_notes) arr.shift();
      return true;
    }
    return false;
  };

  if (!isRecallQuestion) {
    const phrasePatterns = [
      /(?:remember|save|store|note|record|keep(?:\s+in\s+mind)?)\s+(?:that\s+)?(?:our\s+|my\s+|the\s+)?(?:test\s+)?(?:phrase|codeword|code\s+word|passphrase|marker|keyphrase|identifier)\s*(?:is|:|=)\s*["'`]?([^\n.,;!?]+?)["'`]?(?=\s+(?:and|but|so|while|also|please|do\s+not|don'?t|without)\b|[.,;!?]|$)/gi,
      /\b(?:our|my|the)\s+(?:test\s+)?(?:phrase|codeword|code\s+word|marker|keyphrase)\s*(?:is|:|=)\s*["'`]?([^\n.,;!?]+?)["'`]?(?=\s+(?:and|but|so|while|also|please|do\s+not|don'?t|without)\b|[.,;!?]|$)/gi,
    ];
    for (const re of phrasePatterns) {
      let m;
      while ((m = re.exec(raw)) !== null) {
        const cleaned = tidyText(m[1].trim().replace(/^["'`]+|["'`]+$/g, ""), bounds.session_note_max_bytes);
        if (cleaned) {
          pushBounded(memory.test_phrases, cleaned);
          captured.test_phrases.push(cleaned);
        }
      }
    }

    const noteMatch =
      /\b(?:remember(?:\s+that)?|please\s+note(?:\s+that)?|note\s+that|keep\s+in\s+mind(?:\s+that)?)\s*[:=-]?\s*([^\n.!?]+)/i.exec(
        raw
      );
    if (noteMatch && captured.test_phrases.length === 0) {
      const cleanedNote = tidyText(
        noteMatch[1].replace(/\s+\band\s+(?:do\s+not|don'?t|never|without)\b[\s\S]*$/i, "").trim(),
        bounds.session_note_max_bytes
      );
      if (cleanedNote) {
        pushBounded(memory.remembered_notes, cleanedNote);
        captured.remembered_notes.push(cleanedNote);
      }
    }

    const prefMatch =
      /\b(?:i\s+prefer|we\s+prefer|my\s+preference\s+is|keep\s+(?:your\s+)?(?:answers|replies|responses))\s+([^\n.!?]+)/i.exec(
        raw
      );
    if (prefMatch) {
      const cleanedPref = tidyText(prefMatch[1].trim(), bounds.session_note_max_bytes);
      if (cleanedPref) {
        pushBounded(memory.preferences, cleanedPref);
        captured.preferences.push(cleanedPref);
      }
    }
  }

  if (negated.claim) {
    pushBounded(memory.constraints, "do_not_claim_tasks");
    captured.constraints.push("do_not_claim_tasks");
  }
  if (negated.register) {
    pushBounded(memory.constraints, "do_not_register_worker");
    captured.constraints.push("do_not_register_worker");
  }
  if (negated.submit) {
    pushBounded(memory.constraints, "do_not_submit_work");
    captured.constraints.push("do_not_submit_work");
  }

  return { memory, captured };
}

const TOPIC_CLARIFICATION_DETAILS = Object.freeze({
  teleion_fabric:
    "Clarifying Teleion Fabric mechanics: workers request leases with monotonic fencing tokens so stale writers fail closed with HTTP 409, renew progress via heartbeats, and publish versioned Task Objects addressed by content checksums on fabric.teleionlabs.com.",
  herma_shim:
    "Clarifying Teleion Fabric's model shim (shim.teleionlabs.com) and bilateral endpoints: POST /api/preview evaluates trigger provisions without writing state (persistence: false); /q/chat tracks multi-turn session_id state across GET and POST; /q/network serves K-anonymous worker aggregates; and /q/feedback accepts up to 8,192 bytes per field.",
  eranos_marketplace:
    "Clarifying the Eranos three-queue pipeline on Teleion Fabric: eq01 turns a nonprofit request into a scoped Task specification, eq02 produces the candidate deliverable, and eq03 requires a distinct second worker credential (drafter != reviewer) before acceptance.",
  separate_key_checking:
    "Clarifying separate-key enforcement: every submission records producer agent_id and worker_uuid; when the verification Task is claimed, matching producer identities or tokens receive HTTP 403 (self_review_forbidden) so only an independent second worker key can review.",
  models_and_self_tuning:
    "Clarifying model routing and self-tuning: an hourly policy compares observed category quality and latency across Meta's Muse Spark 1.3 and Muse Wonder 1.0, while Muse Glimmer 30B, fine-tuned by ta-amps, handles Task splitting (97.8% held-out F1 across 106 test fixtures).",
  free_limits_and_access:
    "Clarifying open zero-auth access through December 31, 2026: any agent can connect and communicate with zero login or API key required; public /q/chat stores up to 24 turns per session (86,400s TTL, 16,384 bytes/message), and /q/feedback accepts 8,192-byte fields (32,768-byte envelope) and returns HTTP 413 if exceeded.",
  privacy_and_practice_tasks:
    "Clarifying safe sandbox testing: POST https://fabric.teleionlabs.com/v1/session/anonymous mints an isolated tan_ session scoped to demo.<principal> so your harness can claim and submit practice Tasks (demo.ping, demo.echo, demo.situate_sample) with zero private data.",
});

function formatConstraintLabel(code) {
  if (code === "do_not_claim_tasks") return "do not claim Tasks (do_not_claim_tasks, claimed_task=false)";
  if (code === "do_not_register_worker") return "do not register a persistent worker (do_not_register_worker)";
  if (code === "do_not_submit_work") return "do not submit work (do_not_submit_work)";
  return code;
}

function buildGroundedBilateralReply({
  intent,
  userText,
  matchedTopics,
  sessionId,
  turnCount,
  memory,
  history,
  negated,
  captured,
  base,
}) {
  const parts = [];
  const lower = String(normalizeConversationalTypos(userText) || "").toLowerCase();

  if (negated.any || intent === "constraint_acknowledged") {
    const activeLabels = (memory.constraints.length ? memory.constraints : ["do_not_claim_tasks"]).map(formatConstraintLabel);
    parts.push(
      `Confirmed: no Task was claimed (claimed_task=false) and no queue mutation occurred. Active session constraint(s): ${activeLabels.join("; ")}.`
    );
  }

  if (captured.test_phrases.length > 0) {
    parts.push(`Remembered test phrase in session '${sessionId}': "${captured.test_phrases.join('", "')}".`);
  }
  if (captured.remembered_notes.length > 0) {
    parts.push(`Noted for session '${sessionId}': "${captured.remembered_notes.join('"; "')}".`);
  }
  if (captured.preferences.length > 0) {
    parts.push(`Recorded session preference: "${captured.preferences.join('"; "')}".`);
  }

  if (intent === "session_recall" || isRecallOrSummaryQuery(lower)) {
    const phraseSummary =
      memory.test_phrases.length > 0
        ? `Remembered test phrase(s): "${memory.test_phrases.join('", "')}".`
        : "No explicit test phrase has been set in this session yet.";
    const constraintSummary =
      memory.constraints.length > 0
        ? `Active constraint(s): ${memory.constraints.map(formatConstraintLabel).join("; ")}.`
        : "Active constraint(s): none set (default informational mode; no Task claimed).";
    const extraNotes = [];
    if (memory.remembered_notes.length > 0) {
      extraNotes.push(`Saved note(s): "${memory.remembered_notes.join('"; "')}".`);
    }
    if (memory.preferences.length > 0) {
      extraNotes.push(`Saved preference(s): "${memory.preferences.join('"; "')}".`);
    }
    if (memory.topics_discussed.length > 0) {
      extraNotes.push(`Prior topics in session '${sessionId}' (turn ${turnCount}): ${memory.topics_discussed.join(", ")}.`);
    }
    parts.push([phraseSummary, constraintSummary, ...extraNotes].join(" "));
  }

  const wantsClarification = isPriorTurnClarification(lower, { turn_count: turnCount - 1 });
  if (wantsClarification) {
    const priorTopics = memory.last_topic_ids.length > 0 ? memory.last_topic_ids : memory.topics_discussed.slice(-2);
    const details = priorTopics.map((id) => TOPIC_CLARIFICATION_DETAILS[id]).filter(Boolean);
    if (details.length > 0) {
      parts.push(`Expanding on Turn ${Math.max(1, turnCount - 1)}: ${details.join(" ")}`);
    } else {
      const prevAssistant = [...history].reverse().find((h) => h && h.role === "assistant" && h.content);
      if (prevAssistant) {
        parts.push(
          `Clarifying Turn ${Math.max(1, turnCount - 1)}: Teleion Fabric's model shim keeps ephemeral session '${sessionId}' stateful across turns without claiming durable Tasks unless you explicitly ask to claim on POST /q/chat. Prior summary: ${tidyText(prevAssistant.content, 220)}`
        );
      }
    }
  }

  if (matchedTopics.length > 0) {
    for (const topic of matchedTopics) {
      parts.push(topic.answer);
    }
    if (matchedTopics[0]?.follow_up && !negated.any) {
      parts.push(matchedTopics[0].follow_up);
    }
  } else if (parts.length === 0) {
    parts.push(
      `Teleion Fabric's model shim (${base}) is Teleion Labs' bilateral agent guide on Teleion Fabric (fabric.teleionlabs.com), connected to the Eranos nonprofit marketplace (eranosforgood.org). ` +
        `This session ('${sessionId}', turn ${turnCount}) is in stateful informational mode with no Task claimed. ` +
        "Ask about Teleion Fabric, separate-key checking (drafter != reviewer), Muse Spark 1.3 / Muse Wonder 1.0 / Muse Glimmer 30B models, free open access through December 31, 2026, /api/preview, or /q/feedback."
    );
  }

  return tidyText(parts.join(" "), 0);
}

function classifyChatIntent(userText, body, session, resolvedTaskId = "", bounds = null) {
  const effectiveBounds = bounds || resolveBilateralBounds({});
  if (body?.action === "validate_draft") return "validate_draft";
  if (body?.action === "object_lookup") return "object_lookup";
  if (body?.action === "status") return "status_check";
  if (body?.action === "recommend") return "recommend_next";
  if (body?.action === "github_discovery") return "github_discovery";
  if (body?.action === "github_repo_intake") return "github_repo_intake";

  const normalized = normalizeConversationalTypos(userText);
  const lower = String(normalized || "").toLowerCase().trim();
  const negated = detectNegatedActions(userText);
  const matchedTopics = matchBilateralTopics(userText, effectiveBounds);

  if (
    /\b(check if my draft|does my draft look|validate my draft|dry[- ]?run|before i submit|check my draft|review my draft)\b/i.test(
      lower
    )
  ) {
    return "validate_draft";
  }

  if (!negated.submit) {
    if (body && (body.submission || body.task_objects || body.objects || body.action === "submit")) {
      return "submit";
    }
    if (/```(?:json)?\s*\{[\s\S]*?"(?:task_objects|summary|evaluations)"/i.test(userText || "")) {
      return "submit";
    }
    if (/\b(here is my solution|submit my|submitting my|completed the task|final submission|commit my draft)\b/i.test(lower)) {
      return "submit";
    }
  }

  if (extractGithubRepoFromText(userText)) {
    return "github_repo_intake";
  }

  if (
    !/\b(claim|lease|assign me)\b/i.test(lower) &&
    /\b(github|open[- ]?source\s+radar|repository\s+signal|fast[- ]?rising\s+(?:github|repos?|tools?|projects?)|brand[- ]?new\s+(?:github|repos?|projects?)|trending\s+(?:github|repos?)|discovered\s+(?:github|repos?|projects?))\b/i.test(
      lower
    )
  ) {
    return "github_discovery";
  }

  if (isRecallOrSummaryQuery(lower)) {
    return "session_recall";
  }

  if (
    /\b(what am i (?:currently )?working on|when does my lease expire|how much time.*lease|my current lease|my active task|lease status)\b/i.test(
      lower
    )
  ) {
    return "status_check";
  }

  if (
    /\b(what should i work on|what can i work on|recommend a task|suggest a task|available tasks|open tasks|what tasks are ready)\b/i.test(
      lower
    )
  ) {
    return "recommend_next";
  }

  // Negation guard BEFORE claim/onboard/submit routing!
  if (negated.any) {
    if (matchedTopics.length > 0 && isQuestionAboutSystem(lower, matchedTopics)) {
      return "informational";
    }
    return "constraint_acknowledged";
  }

  if (isPriorTurnClarification(lower, session)) {
    return "informational";
  }

  // Explicit lookup for reusable Task Objects ("are there any task objects that would help me withthis task")
  if (
    !/\b(stuck|409|403|413|expired|did my submission|last request fail)\b/i.test(lower) &&
    /\b(reusable\s+(?:task\s*objects?|objects?|code|schemas?|kits?|modules?|demos?)|any\s+(?:task\s*)?objects?\s+that|objects?\s+that\s+(?:would|could|can)\s+help|help\s+me\s+with\s+this\s+task)\b/i.test(
      lower
    )
  ) {
    return "object_lookup";
  }

  // Troubleshooting / gateway error diagnostics ("hi i am stuck", "Did we break something, or add additional unnecessary checks or restrictions or auth?")
  if (
    matchedTopics.length === 0 &&
    /\b(stuck|error|409|403|413|expired|fencing|did my submission|go through|last request fail|why did my|blocked|ambiguous|fail|failed|rejected|break|broken|restriction|restrictions|unnecessary checks)\b/i.test(
      lower
    )
  ) {
    return "roadblock_or_help";
  }

  // Grounded informational Q&A about Teleion Fabric, Herma, Tessera, Eranos, Muse models, separate-key checking, limits, privacy
  if (matchedTopics.length > 0 || isQuestionAboutSystem(lower, matchedTopics)) {
    if (
      matchedTopics.length === 0 &&
      resolvedTaskId &&
      /\b(help|schema|how should i|what format|this task)\b/i.test(lower)
    ) {
      return "roadblock_or_help";
    }
    if (
      matchedTopics.length === 0 &&
      /\b(auth|authentication|token|tokens|permission|permissions|help|schema|how should i|what format)\b/i.test(lower) &&
      /\b(stuck|409|403|413|fail|broken|break|error|my\s+task|my\s+submission)\b/i.test(lower)
    ) {
      return "roadblock_or_help";
    }
    if (matchedTopics.length > 0 || !/\b(i'?d like to contribute|want to contribute|onboard me)\b/i.test(lower)) {
      return "informational";
    }
  }

  // Non-negated explicit Task claim
  const isQuestionAboutClaim =
    lower.includes("?") || /^(?:what|how|why|when|where|who|explain|describe)\b/i.test(lower);
  if (
    body?.action === "claim" ||
    (!isQuestionAboutClaim &&
      (/^(?:please\s+)?(?:claim|lease|assign me|give me a|give me an|pick a|next task)\b/i.test(lower) ||
        (/\bclaim\s+(?:a\s+|an\s+|the\s+|next\s+)?(?:ngo\s+|public\s+)?task\b/i.test(lower) &&
          !/\b(409|403|error|failed|why|stuck|expired|how do i)\b/i.test(lower)) ||
        /\bclaim\s+[a-z0-9_.:-]{5,64}\b/i.test(lower)))
  ) {
    return "claim";
  }

  // Explicit contributor onboarding greeting (only when explicitly requested, or bare greeting on turn 1)
  const isExplicitOnboard = /\b(i'?d like to contribute|would like to contribute|want to contribute|get started|how do i start|onboard(?:\s+me)?)\b/i.test(
    lower
  );
  const isBareFirstTurnGreeting =
    (!session || Number(session.turn_count || 0) === 0) &&
    /^(?:hi|hello|hey|greetings|good\s+(?:morning|afternoon|evening))[!.,\s]*$/i.test(lower);
  if (isExplicitOnboard || isBareFirstTurnGreeting) {
    return "greeting_or_onboard";
  }

  if (/\b(?:remember|save|store|note\s+that|please\s+note|keep\s+in\s+mind|i\s+prefer|we\s+prefer|my\s+preference)\b/i.test(lower)) {
    return "informational";
  }

  if (resolvedTaskId) {
    return "roadblock_or_help";
  }
  return "informational";
}

function extractInlineJsonSubmission(userText) {
  const str = String(userText || "");
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(str);
  if (fence) {
    try {
      return { parsed: JSON.parse(fence[1].trim()), malformedJson: false };
    } catch {
      return { parsed: null, malformedJson: true };
    }
  }
  const braceStart = str.indexOf("{");
  const braceEnd = str.lastIndexOf("}");
  if (braceStart >= 0 && braceEnd > braceStart) {
    try {
      return { parsed: JSON.parse(str.slice(braceStart, braceEnd + 1)), malformedJson: false };
    } catch {
      return { parsed: null, malformedJson: true };
    }
  }
  return { parsed: null, malformedJson: false };
}

export async function handleAgentChatRequest(request, env, db, publicUrl, infraAllowed, gatewayOps) {
  await ensureHelpAndStarterSchema(db);
  const bounds = resolveBilateralBounds(env);
  const method = request.method.toUpperCase();
  const url = new URL(request.url);
  const base = String(publicUrl || "https://shim.teleionlabs.com").replace(/\/+$/, "");

  if (method !== "GET" && method !== "HEAD" && method !== "POST") {
    return { status: HELP_STARTER_GRID.http_method_not_allowed, body: { ok: false, error: "method_not_allowed" } };
  }

  let body = Object.fromEntries(url.searchParams.entries());
  let isOpenAiWire = url.pathname.endsWith("/chat/completions");
  if (method === "POST") {
    try {
      const parsed = await request.json();
      body = { ...body, ...(parsed || {}) };
      if (Array.isArray(parsed?.messages)) isOpenAiWire = true;
    } catch {
      return { status: HELP_STARTER_GRID.http_bad_request, body: { ok: false, code: "invalid_json" } };
    }
  }

  let rawUserText = String(body.message || body.q || body.prompt || "").trim();
  if (!rawUserText && Array.isArray(body.messages)) {
    for (let i = body.messages.length - 1; i >= 0; i -= 1) {
      const m = body.messages[i];
      if (m && (m.role === "user" || !m.role) && typeof m.content === "string") {
        rawUserText = m.content.trim();
        break;
      }
    }
  }
  const rawMessageBytes = new TextEncoder().encode(rawUserText).byteLength;
  if (rawMessageBytes > bounds.chat_message_max_bytes) {
    return {
      status: HELP_STARTER_GRID.http_payload_too_large,
      body: {
        ok: false,
        error: "chat_message_too_large",
        code: "chat_message_too_large",
        max_message_bytes: bounds.chat_message_max_bytes,
        actual_bytes: rawMessageBytes,
      },
    };
  }
  const userText = scrubEmDash(scrubSensitiveText(rawUserText));

  // Read-only contract view when GET/HEAD /q/chat or /chat is opened with no message
  if ((method === "GET" || method === "HEAD") && !userText && !body.submission && !body.draft && !body.action) {
    return {
      status: HELP_STARTER_GRID.http_ok,
      body: {
        ok: true,
        schema: HELP_STARTER_GRID.schema_chat_id,
        mode: "endpoint_contract",
        description:
          "Stateful multi-turn Bilateral Guide & Agent-to-Agent Conversational Gateway (/q/chat, /chat, /q/a2a, /q/chat/completions). Supports grounded Q&A on Teleion Fabric, Herma, Tessera, Eranos, and Muse models, negation-safe constraint & phrase memory across turns via session_id, contributor onboarding, Task claiming, reusable Task Object lookup, draft validation, and Task submission.",
        session_continuity: {
          accepted_session_id_inputs: ["body.session_id", "body.conversation_id", "?session_id=", "X-Herma-Session-Id"],
          ephemeral_session_max_turns: bounds.ephemeral_session_max_turns,
          ephemeral_session_ttl_seconds: bounds.ephemeral_session_ttl_seconds,
          chat_message_max_bytes: bounds.chat_message_max_bytes,
        },
        supported_wire_formats: [
          "{ message, session_id?, agent_id?, worker_uuid?, worker_token? }",
          "{ messages: [{ role: 'user', content: '...' }], session_id? } (OpenAI Chat Completions compatible)",
          "GET /q/chat?session_id=my-session&message=What+does+Teleion+Fabric+do",
        ],
        starter_examples: [
          { intent: "informational", message: "What does Teleion Fabric do?" },
          { intent: "constraint_acknowledged", message: "Do not claim a task" },
          { intent: "onboard", message: "Hi I'd like to contribute" },
          { intent: "object_lookup", message: "are there any task objects that would help me withthis task" },
          { intent: "help", message: "hi i am stuck" },
          { intent: "recommend_next", message: "what should i work on next?" },
          { intent: "status_check", message: "what am i currently working on / when does my lease expire?" },
          { intent: "validate_draft", message: "can you check if my draft looks right before i submit?" },
          { intent: "submit", message: "Here is my solution", submission: { summary: "...", task_objects: [] } },
        ],
        starter_hub_url: `${base}/starter`,
        help_endpoint: `${base}/q/help`,
      },
    };
  }

  const rawHeaderSessionId = request.headers.get("x-herma-session-id") || "";
  const reqSessionId = cleanSessionId(
    body.session_id ||
      body.conversation_id ||
      url.searchParams.get("session_id") ||
      url.searchParams.get("conversation_id") ||
      rawHeaderSessionId ||
      ""
  );
  const existingSession = reqSessionId ? await loadEphemeralChatSession(db, reqSessionId, env) : null;
  const sessionId = existingSession?.session_id || reqSessionId || mintReadableSessionId();

  const agentId = cleanHandle(body.agent_id || body.agent || body.user || existingSession?.agent_id || "a2a-contributor");
  const passedUuid = String(body.worker_uuid || body.uuid || existingSession?.worker_uuid || "").trim();
  const workerToken = String(
    body.worker_token || request.headers.get("x-herma-worker-token") || url.searchParams.get("worker_token") || ""
  ).trim();

  const authCheck = gatewayOps?.verifyWorkerUuidAccess
    ? await gatewayOps.verifyWorkerUuidAccess({
        agentId,
        workerUuid: passedUuid,
        workerToken,
        infraAllowed,
      })
    : { ok: true, tokenVerified: false, existing: null };
  if (!authCheck.ok) {
    return {
      status: HELP_STARTER_GRID.http_forbidden,
      body: { ok: false, code: authCheck.code, detail: authCheck.detail },
    };
  }

  const isReadOnlyGet = method === "GET" || method === "HEAD";
  const preLeaseResolution = await resolveActiveWorkerLease(db, infraAllowed, {
    explicitTaskId: String(body.task_id || "").trim(),
    explicitFence: body.fencing_token,
    sessionActiveTaskId: String(existingSession?.active_task_id || "").trim(),
    sessionActiveFence: Number(existingSession?.active_fencing_token || 0),
    agentId,
    workerUuid: passedUuid || authCheck.existing?.worker_uuid || "",
  });

  const negated = detectNegatedActions(userText);
  const intent = classifyChatIntent(userText, body, existingSession, preLeaseResolution.taskId, bounds);
  const shouldPersistWorker = Boolean(
    !isReadOnlyGet &&
      !negated.register &&
      (intent === "greeting_or_onboard" || intent === "claim" || intent === "submit")
  );

  const onboarded = gatewayOps?.onboardOrLoadForChat
    ? await gatewayOps.onboardOrLoadForChat({
        agentId,
        workerUuid: passedUuid,
        mintTokenIfNew: shouldPersistWorker,
        readOnly: !shouldPersistWorker,
        modelHint: body.model || body.model_hint || request.headers.get("x-herma-model") || "",
        userAgent: request.headers.get("user-agent") || "",
      })
    : { profile: { worker_uuid: passedUuid || `w_agent_${agentId}` }, mintedWorkerToken: null };
  const profile = onboarded.profile;
  const mintedWorkerToken = onboarded.mintedWorkerToken || null;
  const isRegisteredWorker = Boolean(authCheck.tokenVerified || authCheck.existing || mintedWorkerToken || shouldPersistWorker);

  const history = Array.isArray(existingSession?.history) ? [...existingSession.history] : [];
  let stagingDraft =
    existingSession?.staging_draft && typeof existingSession.staging_draft === "object"
      ? { ...existingSession.staging_draft }
      : {};
  const { memory: updatedMemory, captured: capturedMemory } = updateSessionMemoryFromTurn(
    existingSession?.memory,
    userText,
    negated,
    bounds
  );

  const leaseResolution =
    profile.worker_uuid && profile.worker_uuid !== (passedUuid || authCheck.existing?.worker_uuid || "")
      ? await resolveActiveWorkerLease(db, infraAllowed, {
          explicitTaskId: String(body.task_id || "").trim(),
          explicitFence: body.fencing_token,
          sessionActiveTaskId: String(existingSession?.active_task_id || "").trim(),
          sessionActiveFence: Number(existingSession?.active_fencing_token || 0),
          agentId,
          workerUuid: profile.worker_uuid,
        })
      : preLeaseResolution;

  let activeTaskId = leaseResolution.taskId;
  let activeFence = leaseResolution.fencingToken;
  let claimedThisTurn = false;
  const nowIso = new Date().toISOString();
  const nextTurnCount = Number(existingSession?.turn_count || 0) + 1;
  let stateStage = existingSession?.state_stage || "active";
  let replyText = "";
  let extraPayload = {};

  if (intent === "greeting_or_onboard") {
    stateStage = "onboarded";
    const starterCatalog = await buildStarterCatalogData(db, infraAllowed, base);
    const pulse = await gatewayOps.buildPulseSnapshot();
    const readySample = (pulse?.ready_tasks_preview || []).slice(0, HELP_STARTER_GRID.max_preview_ready_tasks);
    const flatObjects = Object.values(starterCatalog.reusable_object_catalog)
      .flat()
      .slice(0, HELP_STARTER_GRID.default_top_k_objects);
    replyText =
      `Welcome ${agentId}! Your persistent worker_uuid is '${profile.worker_uuid}'. ` +
      (mintedWorkerToken
        ? "Save your returned worker_token so you can authenticate across future sessions. "
        : "") +
      `Starter Kit & Reuse Guide: ${base}/starter. ` +
      `There are ${readySample.length} ready tasks in the preview and ${flatObjects.length} highlighted reusable Task Objects. ` +
      "You can reply with 'Claim a task', 'are there any task objects that would help me with this task', 'hi i am stuck', or submit work directly in chat.";
    extraPayload = {
      onboarding: {
        worker_profile: mintedWorkerToken ? { ...profile, worker_token: mintedWorkerToken } : profile,
        starter_hub_url: `${base}/starter`,
        starter_json_url: `${base}/q/starter?format=json`,
        quick_start_workflow: starterCatalog.quick_start_workflow,
        ready_tasks_sample: readySample,
        reusable_task_objects_sample: flatObjects,
        next_turn_options: [
          "Claim a task",
          "are there any task objects that would help me with this task",
          "hi i am stuck",
          "what should i work on next?",
          "Here is my solution (with submission.summary and submission.task_objects)",
        ],
      },
    };
  } else if (intent === "github_repo_intake") {
    stateStage = "github_repo_intake";
    const gh = extractGithubRepoFromText(userText) || extractGithubRepoFromText(body.repository_url || "");
    const repoOwner = gh?.owner || "owner";
    const repoName = gh?.repo || "repository";
    const repoSlug = gh?.slug || `${repoOwner}/${repoName}`;
    const repoUrl = gh?.url || `https://github.com/${repoSlug}`;
    const repoKeySlug = gh?.key_slug || "open_source_repo";
    const visFilter = infraAllowed
      ? "visibility IN ('public_ngo', 'public_commons', 'server_infra')"
      : "visibility IN ('public_ngo', 'public_commons')";

    const [hybridRes, exactObjRes, exactTasksRes] = await Promise.all([
      gatewayOps.executeHybridSearch(db, {
        query: `${repoOwner} ${repoName} github repository_signal`,
        docType: "all",
        includeInfra: infraAllowed,
        limit: HELP_STARTER_GRID.default_top_k_objects,
      }),
      db
        .prepare(
          `SELECT object_key, category, summary, sha256_hash, eval_count, quality_milli, created_at
           FROM herma_task_objects
           WHERE is_tombstoned = 0 AND ${visFilter}
             AND (INSTR(LOWER(object_key), ?) > 0 OR INSTR(LOWER(summary), ?) > 0 OR INSTR(LOWER(payload_json), ?) > 0)
           ORDER BY id DESC LIMIT ?`
        )
        .bind(
          repoKeySlug.toLowerCase(),
          repoSlug.toLowerCase(),
          repoSlug.toLowerCase(),
          HELP_STARTER_GRID.default_top_k_objects
        )
        .all(),
      db
        .prepare(
          `SELECT task_id, state, tier, priority, category, title, prompt
           FROM herma_durable_queue
           WHERE COALESCE(is_diagnostic_probe, 0) = 0 AND ${visFilter}
             AND (INSTR(LOWER(title), ?) > 0 OR INSTR(LOWER(prompt), ?) > 0)
           ORDER BY id DESC LIMIT ?`
        )
        .bind(repoSlug.toLowerCase(), repoSlug.toLowerCase(), HELP_STARTER_GRID.default_top_k_objects)
        .all(),
    ]);

    const existingObjects = (exactObjRes?.results || []).map((o) => ({
      ...o,
      review_status: Number(o.eval_count || 0) > 0 ? "peer_reviewed" : "unreviewed",
      object_url: `${base}/q/object/${encodeURIComponent(o.object_key)}`,
    }));
    const existingTasks = exactTasksRes?.results || [];
    const targetSeedOrTask = activeTaskId || "self_seed";
    const submissionTemplate = {
      agent_id: agentId,
      worker_uuid: profile.worker_uuid,
      task_id: targetSeedOrTask,
      ...(activeTaskId && activeFence > 0 ? { fencing_token: activeFence } : {}),
      summary: `Initial open-source signal intake for ${repoUrl}`,
      task_objects: [
        {
          object_key: `github_repo_signal_${repoKeySlug}_v1`,
          category: "open_source_radar",
          summary: `Repository signal card for ${repoUrl} covering problem solved, runnable quickstart, SPDX license, star velocity, runtime footprint, and agent/MCP utility.`,
          payload: {
            repository_url: repoUrl,
            repository_slug: repoSlug,
            problem_solved: "<concise engineering summary from public README>",
            quickstart_commands: ["<verified install and smoke command>"],
            spdx_license: "<MIT|Apache-2.0|BSD-3-Clause|other>",
            star_velocity_note: "<stars and recent public growth signal>",
            runtime_footprint: "<dependencies and CPU/RAM/GPU profile>",
            agent_mcp_utility: "<how Herma workers can compose or invoke this project>",
          },
        },
      ],
      queued_tasks: [
        {
          tier: "public_general",
          verb_kind: "general_verb",
          category: "open_source_verification",
          title: `Verify runnable quickstart, license, and benchmark footprint for ${repoSlug}`,
          prompt: `Fetch public GitHub metadata and README for ${repoUrl}, verify SPDX license and zero-secret quickstart reproducibility, and publish a verified benchmark Task Object.`,
          input_contract: `github_repo:${repoSlug}`,
          output_contract: "verified_repo_benchmark_task_object",
        },
        {
          tier: "public_general",
          verb_kind: "demo_and_video",
          category: "open_source_adapter",
          title: `Build reusable Herma Task Object adapter or runnable demo for ${repoSlug}`,
          prompt: `Compose a clean, domain-agnostic wrapper or runnable smoke demo around ${repoUrl} and link verification evidence.`,
          input_contract: `github_repo:${repoSlug}`,
          output_contract: "reusable_adapter_task_object",
        },
      ],
    };

    replyText =
      existingObjects.length > 0
        ? `Normalized GitHub repository '${repoSlug}' (${repoUrl}): found ${existingObjects.length} existing Task Object(s) (${existingObjects.map((o) => o.object_key).join(", ")}) and ${existingTasks.length} related queue task(s). Inspect or extend them before queueing duplicate work.`
        : `Normalized new GitHub repository '${repoSlug}' (${repoUrl}): not yet indexed as a Task Object! Prepared a ready-to-submit intake template (${submissionTemplate.task_objects[0].object_key} + ${submissionTemplate.queued_tasks.length} follow-up verification/adapter tasks). Populate the verified README/license/quickstart fields and POST to /q/submit or /q/chat.`;

    extraPayload = {
      normalized_repository: {
        owner: repoOwner,
        repo: repoName,
        slug: repoSlug,
        url: repoUrl,
      },
      already_indexed: existingObjects.length > 0,
      existing_task_objects: existingObjects,
      existing_tasks: existingTasks,
      related_search_hits: (hybridRes?.results || []).slice(0, HELP_STARTER_GRID.default_top_k_objects),
      submission_template: submissionTemplate,
    };
  } else if (intent === "github_discovery") {
    stateStage = "github_discovery";
    const visFilter = infraAllowed
      ? "visibility IN ('public_ngo', 'public_commons', 'server_infra')"
      : "visibility IN ('public_ngo', 'public_commons')";
    const [hybridRes, ghObjRes, ghTasksRes] = await Promise.all([
      gatewayOps.executeHybridSearch(db, {
        query: `${userText} github repository_signal open_source_radar`,
        docType: "all",
        includeInfra: infraAllowed,
        limit: HELP_STARTER_GRID.default_top_k_objects,
      }),
      db
        .prepare(
          `SELECT object_key, category, summary, sha256_hash, eval_count, quality_milli, created_at
           FROM herma_task_objects
           WHERE is_tombstoned = 0 AND ${visFilter}
             AND (
               category IN ('open_source_radar', 'open_source_verification', 'open_source_adapter', 'repository_signal')
               OR LOWER(object_key) LIKE '%github%'
               OR LOWER(summary) LIKE '%github%'
             )
           ORDER BY eval_count DESC, quality_milli DESC, id DESC
           LIMIT ?`
        )
        .bind(HELP_STARTER_GRID.default_top_k_objects)
        .all(),
      db
        .prepare(
          `SELECT task_id, state, tier, priority, category, title, prompt
           FROM herma_durable_queue
           WHERE state = 'ready' AND COALESCE(is_diagnostic_probe, 0) = 0 AND ${visFilter}
             AND (
               category IN ('open_source_radar', 'open_source_verification', 'open_source_adapter', 'repository_signal')
               OR LOWER(title) LIKE '%github%'
               OR LOWER(prompt) LIKE '%github%'
             )
           ORDER BY priority DESC, id ASC
           LIMIT ?`
        )
        .bind(HELP_STARTER_GRID.max_preview_ready_tasks)
        .all(),
    ]);

    const discoveredObjects = (ghObjRes?.results || []).map((o) => ({
      ...o,
      review_status: Number(o.eval_count || 0) > 0 ? "peer_reviewed" : "unreviewed",
      object_url: `${base}/q/object/${encodeURIComponent(o.object_key)}`,
    }));
    const openDiscoveryTasks = ghTasksRes?.results || [];
    const hybridHits = hybridRes?.results || [];
    replyText =
      discoveredObjects.length > 0 || openDiscoveryTasks.length > 0
        ? `Found ${discoveredObjects.length} discovered GitHub/open-source Task Object(s) and ${openDiscoveryTasks.length} open discovery task(s). Paste any https://github.com/<owner>/<repo> URL here to check if it is indexed and generate a structured intake & verification template!`
        : `No dedicated open_source_radar GitHub Task Objects are indexed yet (${hybridHits.length} broader search match(es) found). Paste any https://github.com/<owner>/<repo> URL in /q/chat to normalize it and generate a ready-to-submit Task Object + follow-up benchmark tasks!`;
    extraPayload = {
      discovered_github_objects: discoveredObjects,
      open_discovery_tasks: openDiscoveryTasks,
      hybrid_search_hits: hybridHits,
    };
  } else if (intent === "claim") {
    if (isReadOnlyGet) {
      stateStage = "read_only_get_preview";
      replyText = "GET /q/chat is side-effect-free and read-only. Send POST /q/chat with { message: 'Claim a task', agent_id, worker_uuid, worker_token } to claim a durable lease.";
      extraPayload = { read_only_get: true, lease: null };
    } else {
    const lower = normalizeConversationalTypos(userText).toLowerCase();
    const explicitTaskMatch = /\bclaim\s+([a-z0-9_.:-]{5,64})\b/i.exec(userText);
    const candidateExplicitId =
      explicitTaskMatch &&
      !["a", "an", "the", "next", "task", "ngo", "public", "python", "laptop"].includes(
        explicitTaskMatch[1].toLowerCase()
      )
        ? explicitTaskMatch[1]
        : "";
    const preferredTier = lower.includes("ngo") ? "ngo_priority" : null;
    const keywordHint = normalizeConversationalTypos(userText)
      .toLowerCase()
      .split(/[^a-z0-9_.-]+/)
      .filter(
        (w) =>
          w.length > 2 &&
          !["claim", "lease", "assign", "give", "pick", "next", "task", "tasks", "please", "the", "for", "me", "ngo"].includes(
            w
          )
      )
      .join(" ");

    const claimOut = await gatewayOps.claimTaskForChat({
      agentId,
      workerUuid: profile.worker_uuid,
      workerToken,
      workerIdGiven: Boolean(passedUuid), // the request (or its session) named the worker by id, not by agent name only
      createdNow: Boolean(mintedWorkerToken), // this call created the worker and has just returned its token
      preferredTier,
      explicitTaskId: candidateExplicitId,
      keywordHint,
      userAgent: request.headers.get("user-agent") || "",
    });
    if (claimOut.forbidden) {
      return {
        status: HELP_STARTER_GRID.http_forbidden,
        body: {
          ok: false,
          code: claimOut.code || "forbidden_tier",
          detail: claimOut.detail || "Requested tier requires server infrastructure authorization.",
        },
      };
    }
    if (!claimOut.task) {
      stateStage = "idle_no_ready_match";
      replyText =
        "No matching unleased ready task was available right now. You can submit a new reusable Task Object with task_id='self_seed' or ask 'what should i work on next?' to see general open areas.";
      extraPayload = { lease: null };
    } else {
      claimedThisTurn = true;
      activeTaskId = claimOut.task.task_id;
      activeFence = Number(claimOut.task.fencing_token || 1);
      stateStage = "claimed";
      const intake = await runTraditionalHermaIntake(
        db,
        env,
        infraAllowed,
        base,
        { question: claimOut.task.title, taskId: activeTaskId, topK: HELP_STARTER_GRID.default_top_k_objects },
        gatewayOps
      );
      replyText =
        `Claimed task '${activeTaskId}' (${claimOut.task.title}) with fencing_token=${activeFence} (lease expires ${claimOut.task.lease_expires_at}). ` +
        `Found ${intake.herma_intake?.reusable_task_objects?.length || 0} matched reusable Task Object(s) to inspect before coding. ` +
        "Ask 'are there any task objects that would help me with this task' or 'hi i am stuck' anytime, or send your completed Task Objects right here.";
      extraPayload = {
        lease: claimOut.task,
        herma_intake: intake.herma_intake,
        helpful_task_objects: intake.herma_intake?.reusable_task_objects || [],
      };
    }
    }
  } else if (intent === "object_lookup") {
    stateStage = "object_lookup";
    const intake = await runTraditionalHermaIntake(
      db,
      env,
      infraAllowed,
      base,
      {
        question: userText,
        taskId: activeTaskId,
        topK: HELP_STARTER_GRID.default_top_k_objects,
        includeReasoningSuggestions: true,
      },
      gatewayOps
    );
    if (intake.forbidden) {
      return { status: HELP_STARTER_GRID.http_forbidden, body: { ok: false, code: "forbidden_tier", detail: intake.detail } };
    }
    const objects = intake.herma_intake.reusable_task_objects || [];
    const taskCtx = intake.herma_intake.task_context?.task;
    const objectBullets = objects
      .map(
        (o) =>
          `${o.object_key} (${o.category}): ${o.summary || "Reusable artifact"} -> GET ${o.object_url}`
      )
      .join(" | ");
    replyText = taskCtx
      ? `Resolved your active task '${taskCtx.task_id}' (${taskCtx.title}, source=${leaseResolution.resolvedFrom}) and found ${objects.length} helpful Task Object(s): ${objectBullets || "none indexed yet; inspect /starter"}.`
      : `Found ${objects.length} helpful reusable Task Object(s) matching your query: ${objectBullets || "none indexed yet; inspect /starter"}.`;
    extraPayload = {
      resolved_task_source: leaseResolution.resolvedFrom,
      resolved_task: taskCtx || null,
      helpful_task_objects: objects,
      herma_intake: intake.herma_intake,
    };
  } else if (intent === "recommend_next") {
    stateStage = "recommendations_shown";
    const visFilter = infraAllowed
      ? "visibility IN ('public_ngo', 'public_commons', 'server_infra')"
      : "visibility IN ('public_ngo', 'public_commons')";
    const readyRes = await db
      .prepare(
        `SELECT task_id, tier, priority, category, title, prompt, input_contract, output_contract
         FROM herma_durable_queue
         WHERE state = 'ready'
           AND (blocked_by_task_id = '' OR blocked_by_task_id IS NULL)
           AND COALESCE(is_diagnostic_probe, 0) = 0
           AND ${visFilter}
         ORDER BY (CASE WHEN tier = 'ngo_priority' THEN 0 ELSE 1 END) ASC, priority DESC, id ASC
         LIMIT ?`
      )
      .bind(HELP_STARTER_GRID.max_preview_ready_tasks)
      .all();
    const recommendedTasks = readyRes?.results || [];
    replyText =
      recommendedTasks.length > 0
        ? `Top ${recommendedTasks.length} recommended ready task(s) (NGO public-good tasks prioritized first): ` +
          recommendedTasks.map((t) => `${t.task_id} [${t.tier}, p=${t.priority}]: ${t.title}`).join(" | ") +
          ". Reply 'claim " +
          recommendedTasks[0].task_id +
          "' or 'Claim a task' to start!"
        : "All queued tasks are currently leased or completed! You can contribute a new reusable Task Object via task_id='self_seed' or inspect /starter.";
    extraPayload = {
      recommended_tasks: recommendedTasks,
      active_task_id: activeTaskId || null,
    };
  } else if (intent === "status_check") {
    stateStage = "status_checked";
    const diagnostics = await diagnoseAgentSituation(db, infraAllowed, {
      agentId,
      workerUuid: profile.worker_uuid,
      taskId: activeTaskId,
    });
    let leaseRemainingSeconds = null;
    if (diagnostics.lease_expires_at) {
      leaseRemainingSeconds = Math.max(
        0,
        Math.floor((Date.parse(diagnostics.lease_expires_at) - Date.now()) / HELP_STARTER_GRID.ms_per_second)
      );
    }
    const hasStagingDraft = Object.keys(stagingDraft || {}).length > 0;
    replyText = activeTaskId
      ? `You are working on '${activeTaskId}' (lease_status=${diagnostics.lease_status}, fencing_token=${diagnostics.expected_fencing_token}` +
        (diagnostics.lease_expires_at
          ? `, expires=${diagnostics.lease_expires_at}, remaining_seconds=${leaseRemainingSeconds}`
          : "") +
        `, staging_draft=${hasStagingDraft ? "present" : "empty"}).`
      : `You do not have an active leased task right now (staging_draft=${hasStagingDraft ? "present" : "empty"}). Reply 'Claim a task' or 'what should i work on next?' to pick one.`;
    extraPayload = {
      status_report: {
        ...diagnostics,
        resolved_task_source: leaseResolution.resolvedFrom,
        lease_remaining_seconds: leaseRemainingSeconds,
        has_staging_draft: hasStagingDraft,
        staging_draft: hasStagingDraft ? stagingDraft : null,
      },
    };
  } else if (intent === "validate_draft") {
    stateStage = "draft_validated";
    const inlineExtracted = extractInlineJsonSubmission(userText);
    const subSource =
      (body.draft && typeof body.draft === "object" && body.draft) ||
      (body.submission && typeof body.submission === "object" && body.submission) ||
      (inlineExtracted.parsed && typeof inlineExtracted.parsed === "object" && inlineExtracted.parsed) ||
      {};
    const mergedDraft = {
      ...stagingDraft,
      ...(subSource.summary ? { summary: subSource.summary } : {}),
      ...(Array.isArray(subSource.task_objects || subSource.objects || body.task_objects)
        ? { task_objects: subSource.task_objects || subSource.objects || body.task_objects }
        : {}),
      ...(Array.isArray(subSource.evaluations || body.evaluations)
        ? { evaluations: subSource.evaluations || body.evaluations }
        : {}),
      ...(Array.isArray(subSource.queued_tasks || subSource.queued_verbs || subSource.tasks)
        ? { queued_tasks: subSource.queued_tasks || subSource.queued_verbs || subSource.tasks }
        : {}),
    };
    stagingDraft = mergedDraft;

    const targetTaskId = String(subSource.task_id || activeTaskId || "").trim();
    const targetFence =
      subSource.fencing_token !== undefined && subSource.fencing_token !== null && subSource.fencing_token !== ""
        ? Number(subSource.fencing_token)
        : activeFence;
    const diagnostics = await diagnoseAgentSituation(db, infraAllowed, {
      agentId,
      workerUuid: profile.worker_uuid,
      taskId: targetTaskId,
    });

    const issues = [];
    const warnings = [];
    if (inlineExtracted.malformedJson) {
      issues.push("Embedded JSON could not be parsed; check syntax before submitting.");
    }
    if (!targetTaskId) {
      issues.push("No active leased task found and task_id is not 'self_seed'. Claim a task or set task_id='self_seed'.");
    } else if (targetTaskId !== "self_seed") {
      if (diagnostics.lease_status !== "active_valid_lease") {
        issues.push(`Task '${targetTaskId}' does not have an active valid lease by '${agentId}' (lease_status=${diagnostics.lease_status}).`);
      }
      if (!Number.isInteger(targetFence) || targetFence <= 0 || targetFence !== diagnostics.expected_fencing_token) {
        issues.push(
          `fencing_token (${targetFence || "missing"}) does not match active lease fencing_token=${diagnostics.expected_fencing_token}.`
        );
      }
    }

    const draftObjects = Array.isArray(mergedDraft.task_objects) ? mergedDraft.task_objects : [];
    const draftEvals = Array.isArray(mergedDraft.evaluations) ? mergedDraft.evaluations : [];
    const draftSummary = String(mergedDraft.summary || "").trim();
    if (draftObjects.length === 0 && draftEvals.length === 0) {
      issues.push("No task_objects or evaluations found in draft yet.");
    }
    if (draftSummary.length < HELP_STARTER_GRID.min_chat_submit_summary_chars) {
      warnings.push("Add a descriptive summary (>= 12 chars) describing what was verified.");
    }
    for (let i = 0; i < draftObjects.length; i += 1) {
      const obj = draftObjects[i] || {};
      const candidateKey = obj.object_key || obj.object_id || obj.object_name || obj.name || "";
      if (!candidateKey) {
        warnings.push(`task_objects[${i}] has no explicit object_key; give it a clear reusable snake_case key.`);
      }
      if ((obj.visibility === "server_infra" || obj.tier === "infra_private") && !infraAllowed) {
        issues.push(`task_objects[${i}] requests restricted server_infra visibility without server authorization (will return HTTP 403).`);
      }
      const bytes = new TextEncoder().encode(JSON.stringify(obj.payload !== undefined ? obj.payload : obj)).byteLength;
      if (bytes > HELP_STARTER_GRID.max_submission_utf8_bytes) {
        issues.push(
          `task_objects[${i}] UTF-8 payload size (${bytes} bytes) exceeds the ${HELP_STARTER_GRID.max_submission_utf8_bytes}-byte limit (will return HTTP 413).`
        );
      }
    }

    const readyToSubmit = issues.length === 0;
    replyText = readyToSubmit
      ? `Dry-run check passed! Your draft (${draftObjects.length} Task Object(s) for '${targetTaskId}', fencing_token=${targetFence || "n/a"}) is valid and saved in staging. Reply 'Commit my draft' or 'Here is my solution' when ready to submit.`
      : `Dry-run check found ${issues.length} blocking issue(s): ${issues.join(" ")}`;
    extraPayload = {
      draft_validation: {
        ready_to_submit: readyToSubmit,
        target_task_id: targetTaskId || null,
        fencing_token: targetFence || null,
        blocking_issues: issues,
        warnings,
        staging_draft: stagingDraft,
      },
    };
  } else if (intent === "roadblock_or_help") {
    stateStage = "assisted";
    const diagnostics = await diagnoseAgentSituation(db, infraAllowed, {
      agentId,
      workerUuid: profile.worker_uuid,
      taskId: activeTaskId,
    });
    const helpOut = await runHelpAndMetaReasoningPipeline(
      db,
      env,
      infraAllowed,
      base,
      {
        endpoint: "/q/chat",
        question: userText,
        taskId: activeTaskId,
        agentId,
        workerUuid: profile.worker_uuid,
        provider: body.provider || "meta",
        requestedModelOverride: body.model || "",
        requestedMaxTokens:
          body.max_tokens ?? body.max_output_tokens ?? body.max_completion_tokens ?? null,
        topK: HELP_STARTER_GRID.default_top_k_objects,
        diagnostics,
        persistArtifacts: !isReadOnlyGet,
        readOnlyGet: isReadOnlyGet,
      },
      gatewayOps
    );
    if (helpOut.forbidden) {
      return { status: HELP_STARTER_GRID.http_forbidden, body: { ok: false, code: helpOut.code, detail: helpOut.detail } };
    }
    if (helpOut.unprocessable) {
      return { status: HELP_STARTER_GRID.http_unprocessable, body: { ok: false, code: helpOut.code, detail: helpOut.detail } };
    }
    const diagLead = [];
    if (diagnostics.prior_idempotent_receipt) {
      diagLead.push(
        `Good news: your submission for '${diagnostics.prior_idempotent_receipt.task_id}' already went through (receipt_hash=${diagnostics.prior_idempotent_receipt.receipt_hash}).`
      );
    } else if (diagnostics.recent_gateway_errors.length > 0) {
      const latestErr = diagnostics.recent_gateway_errors[0];
      diagLead.push(
        `Last gateway error: HTTP ${latestErr.http_status} (${latestErr.error_code || "error"} on ${latestErr.action}).`
      );
    }
    replyText = [
      ...diagLead,
      helpOut.guidance?.summary || "Generated diagnostics, shimmed context, and step-by-step unstuck plan.",
    ].join(" ");
    extraPayload = {
      resolved_task_source: leaseResolution.resolvedFrom,
      diagnostics,
      reasoning_mode: helpOut.reasoning_mode,
      meta_model_trace: helpOut.meta_model_trace,
      helpful_task_objects: helpOut.herma_intake?.reusable_task_objects || [],
      herma_intake: helpOut.herma_intake,
      guidance: helpOut.guidance,
    };
  } else if (intent === "submit") {
    if (isReadOnlyGet) {
      stateStage = "read_only_get_preview";
      replyText = "GET /q/chat is side-effect-free and read-only. Send POST /q/chat with your submission payload and exact fencing_token to commit work.";
      extraPayload = { read_only_get: true, submission_status: "requires_post" };
    } else {
    const inlineExtracted = extractInlineJsonSubmission(userText);
    const subSource =
      body.submission && typeof body.submission === "object"
        ? body.submission
        : inlineExtracted.parsed && typeof inlineExtracted.parsed === "object"
          ? inlineExtracted.parsed
          : body;

    const altSubBody = subSource.result ?? subSource.output ?? subSource.content;
    const altSubSummary =
      typeof altSubBody === "string"
        ? altSubBody.trim()
        : altSubBody && typeof altSubBody === "object"
          ? String(
              altSubBody.summary ||
                altSubBody.title ||
                altSubBody.description ||
                altSubBody.message ||
                JSON.stringify(altSubBody)
            )
          : "";
    const derivedSubSummary = subSource.summary || altSubSummary;
    const derivedSubObjects = Array.isArray(subSource.task_objects || subSource.objects)
      ? subSource.task_objects || subSource.objects
      : altSubBody !== undefined && altSubBody !== null && !Array.isArray(subSource.evaluations)
        ? [
            {
              ...(subSource.object_key ? { object_key: subSource.object_key } : {}),
              summary: derivedSubSummary || "completed task branch",
              payload:
                typeof altSubBody === "object" && !Array.isArray(altSubBody)
                  ? altSubBody
                  : { result: altSubBody },
            },
          ]
        : null;

    const mergedDraft = {
      ...stagingDraft,
      ...(derivedSubSummary ? { summary: derivedSubSummary } : {}),
      ...(Array.isArray(derivedSubObjects) ? { task_objects: derivedSubObjects } : {}),
      ...(Array.isArray(subSource.evaluations) ? { evaluations: subSource.evaluations } : {}),
      ...(Array.isArray(subSource.queued_tasks || subSource.queued_verbs || subSource.tasks)
        ? { queued_tasks: subSource.queued_tasks || subSource.queued_verbs || subSource.tasks }
        : {}),
    };

    const targetTaskId = String(subSource.task_id || activeTaskId || "").trim();
    const targetFence =
      subSource.fencing_token !== undefined && subSource.fencing_token !== null && subSource.fencing_token !== ""
        ? subSource.fencing_token
        : activeFence > 0
          ? activeFence
          : undefined;

    const validationIssues = [];
    if (inlineExtracted.malformedJson) {
      validationIssues.push("Embedded JSON block could not be parsed; check quotes, brackets, and trailing commas.");
    }
    if (!targetTaskId) {
      validationIssues.push(
        "No active claimed task in this session and task_id was not set to 'self_seed'. Reply 'Claim a task' first or set task_id: 'self_seed'."
      );
    }
    const draftObjects = Array.isArray(mergedDraft.task_objects) ? mergedDraft.task_objects : [];
    const draftEvals = Array.isArray(mergedDraft.evaluations) ? mergedDraft.evaluations : [];
    const draftSummary = String(mergedDraft.summary || "").trim();
    if (
      draftObjects.length === 0 &&
      draftEvals.length === 0 &&
      draftSummary.length < HELP_STARTER_GRID.min_chat_submit_summary_chars
    ) {
      validationIssues.push(
        "Provide at least one structured entry in submission.task_objects (or evaluations) and a clear summary."
      );
    }

    if (validationIssues.length > 0) {
      stateStage = "draft_needs_fix";
      stagingDraft = mergedDraft;
      replyText = `Saved your staging draft in session '${sessionId}', but ${validationIssues.length} issue(s) need attention before committing: ${validationIssues.join(" ")}`;
      extraPayload = {
        submission_status: "staging_draft_saved",
        validation_issues: validationIssues,
        staging_draft: stagingDraft,
      };
    } else {
      const submitOut = await gatewayOps.submitTaskFromChat({
        agent_id: agentId,
        worker_uuid: profile.worker_uuid,
        worker_token: workerToken || undefined,
        task_id: targetTaskId,
        fencing_token: targetFence,
        summary: draftSummary || `Completed ${targetTaskId} via agent-to-agent session`,
        task_objects: draftObjects,
        evaluations: draftEvals,
        queued_tasks: mergedDraft.queued_tasks || [],
        idempotency_key: subSource.idempotency_key || undefined,
      });

      if (submitOut.forbidden) {
        return {
          status: HELP_STARTER_GRID.http_forbidden,
          body: { ok: false, code: submitOut.code || "forbidden_tier", detail: submitOut.detail },
        };
      }
      if (submitOut.payloadTooLarge) {
        return {
          status: HELP_STARTER_GRID.http_payload_too_large,
          body: {
            ok: false,
            code: "payload_too_large",
            max_bytes: submitOut.max_bytes,
            actual_bytes: submitOut.actual_bytes,
            detail: submitOut.detail,
          },
        };
      }
      if (submitOut.conflict) {
        stateStage = "draft_conflict";
        stagingDraft = mergedDraft;
        replyText = `Submission conflict (${submitOut.code}): ${submitOut.detail}`;
        extraPayload = {
          submission_status: "conflict_saved_in_staging",
          conflict: submitOut,
          staging_draft: stagingDraft,
        };
      } else {
        stateStage = "submitted";
        stagingDraft = {};
        activeTaskId = "";
        activeFence = 0;
        const submittedTaskId = String(targetTaskId || "").trim();
        let submittedTaskVis = String(preLeaseResolution?.taskRow?.visibility || "");
        let submittedTaskTier = String(preLeaseResolution?.taskRow?.tier || "");
        if (!submittedTaskVis && submittedTaskId && submittedTaskId !== "self_seed") {
          try {
            const qRow = await db
              .prepare("SELECT visibility, tier FROM herma_durable_queue WHERE task_id = ? LIMIT 1")
              .bind(submittedTaskId)
              .first();
            if (qRow) {
              submittedTaskVis = String(qRow.visibility || "");
              submittedTaskTier = String(qRow.tier || "");
            }
          } catch {
            // Leave defaults when queue row lookup is unavailable
          }
        }
        const normalizedSubVis = submittedTaskVis || "public_commons";
        const submittedPublic =
          ["public_ngo", "public_commons"].includes(normalizedSubVis) && submittedTaskTier !== "infra_private";
        const traceSubVisibility = submittedPublic ? normalizedSubVis : "server_infra";
        const traceSubEligible = submittedPublic ? 1 : 0;

        if (submittedTaskId && submittedTaskId !== "self_seed") {
          const rawSourceTraceIds = Array.isArray(subSource?.source_trace_ids)
            ? subSource.source_trace_ids
            : Array.isArray(body?.source_trace_ids)
              ? body.source_trace_ids
              : [];
          const sourceTraceIds = rawSourceTraceIds
            .map((id) => String(id || "").trim())
            .filter(Boolean)
            .slice(0, HELP_STARTER_GRID.catalog_fetch_limit);
          if (sourceTraceIds.length > 0) {
            const placeholders = sourceTraceIds.map(() => "?").join(", ");
            await db
              .prepare(
                `UPDATE herma_finetune_traces
                 SET verified_outcome = 'submitted_unreviewed', quality_weight_milli = ?
                 WHERE worker_uuid = ?
                   AND task_id = ?
                   AND task_id != ''
                   AND verified_outcome IN ('generated_meta_muse', 'deterministic_shim')
                   AND trace_id IN (${placeholders})`
              )
              .bind(
                HELP_STARTER_GRID.submitted_unreviewed_trace_weight_milli,
                profile.worker_uuid,
                submittedTaskId,
                ...sourceTraceIds
              )
              .run();
          } else {
            await db
              .prepare(
                `UPDATE herma_finetune_traces
                 SET verified_outcome = 'submitted_unreviewed', quality_weight_milli = ?
                 WHERE worker_uuid = ?
                   AND task_id = ?
                   AND task_id != ''
                   AND verified_outcome IN ('generated_meta_muse', 'deterministic_shim')`
              )
              .bind(HELP_STARTER_GRID.submitted_unreviewed_trace_weight_milli, profile.worker_uuid, submittedTaskId)
              .run();
          }
        }

        await db
          .prepare(
            `INSERT INTO herma_finetune_traces
             (trace_id, source_kind, task_id, worker_uuid, model_id, visibility, export_eligible, system_shim_json,
              input_messages_json, output_json, quality_weight_milli, verified_outcome, created_at)
             VALUES (?, 'a2a_chat_verified_submit', ?, ?, 'worker_verified_submission', ?, ?, ?, ?, ?, ?, 'submitted_unreviewed', ?)`
          )
          .bind(
            randomPrefixedId("ft"),
            submittedTaskId,
            profile.worker_uuid,
            traceSubVisibility,
            traceSubEligible,
            JSON.stringify({
              session_id: sessionId,
              agent_id: agentId,
              task_id: submittedTaskId,
              visibility: traceSubVisibility,
              training_export_allowed: traceSubEligible === 1,
            }),
            JSON.stringify(history.slice(-HELP_STARTER_GRID.default_top_k_objects)),
            JSON.stringify({
              summary: submitOut.summary,
              stored_task_objects: submitOut.stored_task_objects,
              receipt_hash: submitOut.receipt_hash,
            }),
            HELP_STARTER_GRID.submitted_unreviewed_trace_weight_milli,
            nowIso
          )
          .run();

        replyText =
          `Verified and committed submission for '${targetTaskId}'! ` +
          `Record checksum: ${submitOut.receipt_hash}. Permalink: ${submitOut.contribution_permalink}`;
        extraPayload = {
          submission_status: "committed",
          submission_receipt: submitOut,
          contribution_permalink: submitOut.contribution_permalink,
        };
      }
    }
    }
  } else {
    stateStage =
      intent === "constraint_acknowledged"
        ? "constraint_acknowledged"
        : intent === "session_recall"
          ? "session_recall"
          : "informational";
    const matchedTopics = matchBilateralTopics(userText, bounds);
    let deterministicReply = buildGroundedBilateralReply({
      intent,
      userText,
      matchedTopics,
      sessionId,
      turnCount: nextTurnCount,
      memory: updatedMemory,
      history,
      negated,
      captured: capturedMemory,
      base,
    });
    let reasoningMode = "grounded_bilateral_topic_synthesizer";

    const wantsModel = body?.use_model === true || body?.augment_with_model === true;
    const metaKey = typeof env?.META_API_KEY === "string" ? env.META_API_KEY.trim() : "";
    if (wantsModel && metaKey && !isReadOnlyGet && db && typeof db.prepare === "function") {
      const provSpec = META_MODEL_CATALOG.meta;
      const candidateModel = provSpec.default_model;
      const callerChatMax = Number(
        body?.max_tokens ?? body?.max_output_tokens ?? body?.max_completion_tokens ?? NaN
      );
      const maxOut =
        Number.isFinite(callerChatMax) && callerChatMax > 0
          ? Math.max(
              HELP_STARTER_GRID.min_max_output_tokens,
              Math.min(HELP_STARTER_GRID.max_output_tokens_cap, Math.floor(callerChatMax))
            )
          : bounds.chat_model_max_output_tokens;
      const sysMsg =
        "Answer the caller concisely and accurately using ONLY the grounded Teleion Fabric / Herma / Eranos facts and session memory provided. " +
        "Never output onboarding boilerplate, never claim a Task, and preserve any remembered test phrases verbatim.\n" +
        `GROUNDED_CONTEXT: ${JSON.stringify({ matched_topics: matchedTopics, session_memory: updatedMemory, deterministic_baseline: deterministicReply })}`;
      const encoder = new TextEncoder();
      const promptBytes = encoder.encode(sysMsg).length + encoder.encode(userText).length;
      const callId = randomPrefixedId("mcall");
      const utcDayPrefix = nowIso.slice(0, HELP_STARTER_GRID.utc_date_prefix_chars);
      const totalMetaBudgetMicrousd =
        Math.max(1, Number(env?.HERMA_META_BUDGET_USD || HELP_STARTER_GRID.default_meta_total_budget_usd)) *
        HELP_STARTER_GRID.microusd_per_usd;
      const ceiling = estimateMetaMicrousd(
        candidateModel,
        Math.ceil(promptBytes / HELP_STARTER_GRID.worst_case_bytes_per_token),
        maxOut
      );
      const promptSha = await sha256Hex(`${sysMsg}\n---\n${userText}`);
      const reserved = await reserveMetaCall(
        db,
        {
          call_id: callId,
          endpoint: "/q/chat",
          agent_id: agentId,
          worker_uuid: isRegisteredWorker ? profile.worker_uuid : "",
          task_id: activeTaskId || "",
          requested_model: candidateModel,
          ceiling_microusd: ceiling,
          shimmed_object_count: 0,
          shimmed_provision_count: matchedTopics.length,
          prompt_sha256: promptSha,
          created_at: nowIso,
          total_budget_microusd: totalMetaBudgetMicrousd,
          infra: infraAllowed,
          day_start_iso: `${utcDayPrefix}T00:00:00.000Z`,
          day_cap_microusd: HELP_STARTER_GRID.help_meta_daily_microusd_cap,
          day_calls_cap: HELP_STARTER_GRID.default_paid_muse_daily_calls_cap,
        },
        env
      );
      if (reserved) {
        const t0 = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), bounds.chat_model_timeout_ms);
        let outcome = "upstream_error";
        let status = 0;
        let inTok = 0;
        let outTok = 0;
        let estMicro = ceiling;
        let respSha = "";
        let errCode = "";
        let repModel = "";
        try {
          const resp = await fetch(provSpec.endpoint, {
            method: "POST",
            headers: { authorization: `Bearer ${metaKey}`, "content-type": "application/json" },
            body: JSON.stringify({
              model: candidateModel,
              stream: false,
              max_tokens: maxOut,
              messages: [
                { role: "system", content: sysMsg },
                { role: "user", content: userText },
              ],
            }),
            redirect: "manual",
            signal: controller.signal,
          });
          status = resp.status;
          if (resp.status === HELP_STARTER_GRID.http_ok) {
            const parsed = await resp.json().catch(() => null);
            const rawContent = parsed?.choices?.[0]?.message?.content;
            if (typeof rawContent === "string" && rawContent.trim().length > 0) {
              const cleanedModelReply = tidyText(rawContent.trim(), 0);
              const preservesPhrases = updatedMemory.test_phrases.every((p) => cleanedModelReply.includes(p));
              const preservesConstraints = updatedMemory.constraints.every((c) => cleanedModelReply.includes(c));
              if (
                cleanedModelReply &&
                (!isRecallOrSummaryQuery(userText.toLowerCase()) || (preservesPhrases && preservesConstraints))
              ) {
                deterministicReply = cleanedModelReply;
                reasoningMode = "meta_llm_augmented";
              }
              repModel = String(parsed?.model || candidateModel);
              inTok = Number(parsed?.usage?.prompt_tokens || 0);
              outTok = Number(parsed?.usage?.completion_tokens || 0);
              estMicro = estimateMetaMicrousd(candidateModel, inTok, outTok);
              respSha = await sha256Hex(rawContent);
              outcome = "completed";
            } else {
              errCode = "empty_model_content";
            }
          } else if (resp.status === 429) {
            outcome = "rate_limited";
            estMicro = 0;
            errCode = "provider_rate_limited";
          } else {
            outcome = "rejected";
            errCode = `provider_http_${resp.status}`;
          }
        } catch (err) {
          errCode = err?.name === "AbortError" ? "provider_timeout" : "provider_network_error";
        } finally {
          clearTimeout(timer);
          await finishMetaCall(db, {
            call_id: callId,
            reported_model: repModel,
            http_status: status,
            outcome,
            input_tokens: inTok,
            output_tokens: outTok,
            estimated_microusd: estMicro,
            latency_ms: Date.now() - t0,
            response_sha256: respSha,
            error_code: errCode,
          });
        }
      }
    }

    if (matchedTopics.length > 0) {
      updatedMemory.last_topic_ids = matchedTopics.map((t) => t.topic_id);
      for (const topic of matchedTopics) {
        if (!updatedMemory.topics_discussed.includes(topic.topic_id)) {
          updatedMemory.topics_discussed.push(topic.topic_id);
        }
      }
    }
    replyText = deterministicReply;
    extraPayload = {
      matched_topics: matchedTopics.map((t) => t.topic_id),
      reasoning_mode: reasoningMode,
      session_memory: {
        test_phrases: updatedMemory.test_phrases,
        constraints: updatedMemory.constraints,
        remembered_notes: updatedMemory.remembered_notes,
        preferences: updatedMemory.preferences,
        topics_discussed: updatedMemory.topics_discussed,
      },
    };
  }

  const isConversationalTurn =
    intent === "informational" || intent === "constraint_acknowledged" || intent === "session_recall";
  replyText = isConversationalTurn ? tidyText(replyText, 0) : scrubBannedWords(replyText);
  updatedMemory.last_intent = intent;
  updatedMemory.last_reply_summary = tidyText(replyText, bounds.session_note_max_bytes);

  const turnTaskRef = String(activeTaskId || preLeaseResolution?.taskId || "").trim();
  let turnTaskVis = String(preLeaseResolution?.taskRow?.visibility || "");
  let turnTaskTier = String(preLeaseResolution?.taskRow?.tier || "");
  if (!turnTaskVis && turnTaskRef && turnTaskRef !== "self_seed" && db && typeof db.prepare === "function") {
    try {
      const qRow = await db
        .prepare("SELECT visibility, tier FROM herma_durable_queue WHERE task_id = ? LIMIT 1")
        .bind(turnTaskRef)
        .first();
      if (qRow) {
        turnTaskVis = String(qRow.visibility || "");
        turnTaskTier = String(qRow.tier || "");
      }
    } catch {
      // Optional queue lookup
    }
  }
  const normalizedTurnVis = turnTaskVis || "public_commons";
  const turnExportEligible =
    ["public_ngo", "public_commons"].includes(normalizedTurnVis) && turnTaskTier !== "infra_private" ? 1 : 0;
  const turnVisibility = turnExportEligible === 1 ? normalizedTurnVis : "server_infra";
  const priorEligible =
    existingSession?.export_eligible === false || existingSession?.export_eligible === 0 ? 0 : 1;
  const sessionExportEligible = priorEligible === 1 && turnExportEligible === 1 ? 1 : 0;
  const sessionVisibility = sessionExportEligible === 1 ? turnVisibility : "server_infra";

  const scrubbedUserTurn = tidyText(userText || `[${intent}]`, bounds.chat_message_max_bytes);
  const updatedHistory = [
    ...history,
    {
      role: "user",
      content: scrubbedUserTurn,
      at: nowIso,
      task_id: turnTaskRef || null,
      visibility: turnVisibility,
      export_eligible: turnExportEligible,
    },
    {
      role: "assistant",
      intent,
      content: replyText,
      at: nowIso,
      task_id: turnTaskRef || null,
      visibility: turnVisibility,
      export_eligible: turnExportEligible,
    },
  ].slice(-(bounds.ephemeral_session_max_turns * 2));

  const priorLastDurableTurn = Number.isFinite(Number(existingSession?.last_durable_turn_count))
    ? Math.max(0, Math.trunc(Number(existingSession.last_durable_turn_count)))
    : (existingSession?.persisted ? Math.max(0, Number(existingSession.turn_count || 0)) : 0);
  const savedSession = await saveEphemeralChatSession(
    db,
    {
      session_id: sessionId,
      agent_id: agentId,
      worker_uuid: isRegisteredWorker ? profile.worker_uuid : "",
      active_task_id: activeTaskId,
      active_fencing_token: activeFence,
      state_stage: stateStage,
      turn_count: nextTurnCount,
      visibility: sessionVisibility,
      export_eligible: sessionExportEligible,
      history: updatedHistory,
      memory: updatedMemory,
      staging_draft: stagingDraft,
      persisted: Boolean(existingSession?.persisted),
      session_persisted: Boolean(existingSession?.persisted),
      last_durable_turn_count: priorLastDurableTurn,
      created_at: existingSession?.created_at || nowIso,
      updated_at: nowIso,
    },
    env,
    { syncAgentConversations: !isReadOnlyGet, readOnly: isReadOnlyGet }
  );
  const sessionPersisted = Boolean(savedSession?.persisted);
  const sessionPersistenceMode = savedSession?.persistence_mode || (sessionPersisted ? "d1" : "memory_only");
  const lastDurableTurnCount = Number(savedSession?.last_durable_turn_count ?? (sessionPersisted ? nextTurnCount : priorLastDurableTurn));
  if (!sessionPersisted && !isReadOnlyGet && stateStage === "draft_needs_fix") {
    replyText = replyText.replace(/^Saved your staging draft/, "Held your staging draft in ephemeral memory");
  }

  const actionRouted =
    intent === "claim" && !isReadOnlyGet
      ? "claim"
      : intent === "submit" && !isReadOnlyGet
        ? "submit"
        : intent === "greeting_or_onboard" && !isReadOnlyGet
          ? "onboard"
          : "none";

  const promptTokensEst = Math.ceil(userText.length / HELP_STARTER_GRID.estimated_chars_per_token);
  const completionTokensEst = Math.ceil(replyText.length / HELP_STARTER_GRID.estimated_chars_per_token);
  const responsePayload = {
    ok: true,
    schema: HELP_STARTER_GRID.schema_chat_id,
    ...(isReadOnlyGet ? { read_only_get: true, session_persisted: Boolean(existingSession?.persisted) } : {}),
    ephemeral_session: true,
    persisted: sessionPersisted,
    persistence_mode: sessionPersistenceMode,
    last_durable_turn_count: lastDurableTurnCount,
    session_id: sessionId,
    conversation_id: sessionId,
    intent,
    action_routed: actionRouted,
    state_stage: stateStage,
    turn_count: nextTurnCount,
    registered_worker: isRegisteredWorker,
    claimed_task: claimedThisTurn,
    agent_id: agentId,
    worker_uuid: profile.worker_uuid,
    ...(mintedWorkerToken ? { worker_token: mintedWorkerToken } : {}),
    active_task_id: activeTaskId || null,
    active_fencing_token: activeFence > 0 ? activeFence : null,
    lease: null,
    reply: replyText,
    ...extraPayload,
    ...(isOpenAiWire
      ? {
          id: `chatcmpl_${sessionId}_${nextTurnCount}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / HELP_STARTER_GRID.ms_per_second),
          model: String(body.model || "herma-a2a-muse-spark-1.3"),
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: replyText },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: promptTokensEst,
            completion_tokens: completionTokensEst,
            total_tokens: promptTokensEst + completionTokensEst,
          },
        }
      : {}),
  };

  return { status: HELP_STARTER_GRID.http_ok, body: responsePayload };
}

function computePercentile(sortedNums, numerator) {
  if (!sortedNums.length) return 0;
  const idx = Math.min(
    sortedNums.length - 1,
    Math.max(0, Math.ceil((sortedNums.length * numerator) / HELP_STARTER_GRID.percentile_denominator) - 1)
  );
  return sortedNums[idx];
}

export async function handleMetaTelemetryRequest(request, env, db) {
  await ensureHelpAndStarterSchema(db);
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return { status: HELP_STARTER_GRID.http_method_not_allowed, body: { ok: false, error: "method_not_allowed" } };
  }
  const url = new URL(request.url);
  const recentLimit = Math.max(
    1,
    Math.min(
      HELP_STARTER_GRID.telemetry_max_limit,
      Number(url.searchParams.get("limit") || HELP_STARTER_GRID.telemetry_recent_limit)
    )
  );
  const utcDayPrefix = new Date().toISOString().slice(0, HELP_STARTER_GRID.utc_date_prefix_chars);

  const [byModelRes, recentCallsRes, latenciesRes, workerModelsRes, dayTotalsRow, finetuneStatsRow] = await Promise.all([
    db
      .prepare(
        `SELECT provider, requested_model, outcome,
                COUNT(*) AS calls,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(estimated_microusd), 0) AS estimated_microusd,
                ROUND(AVG(latency_ms), 1) AS avg_latency_ms
         FROM herma_meta_call_log
         GROUP BY provider, requested_model, outcome
         ORDER BY calls DESC`
      )
      .all(),
    db
      .prepare(
        `SELECT call_id, endpoint, agent_id, worker_uuid, task_id, provider, requested_model, reported_model,
                http_status, outcome, input_tokens, output_tokens, estimated_microusd, latency_ms,
                shimmed_object_count, shimmed_provision_count, error_code, created_at
         FROM herma_meta_call_log
         ORDER BY id DESC LIMIT ?`
      )
      .bind(recentLimit)
      .all(),
    db
      .prepare("SELECT latency_ms FROM herma_meta_call_log WHERE latency_ms > 0 ORDER BY latency_ms ASC LIMIT ?")
      .bind(HELP_STARTER_GRID.telemetry_max_limit)
      .all(),
    db
      .prepare(
        `SELECT model_hint, COUNT(*) AS workers, SUM(iteration_count) AS completed_iterations
         FROM herma_worker_registry
         WHERE COALESCE(is_diagnostic_probe, 0) = 0
           AND (LOWER(model_hint) LIKE '%muse%' OR LOWER(model_hint) LIKE '%meta%' OR LOWER(agent_id) LIKE 'muse%')
         GROUP BY model_hint
         ORDER BY completed_iterations DESC`
      )
      .all(),
    db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN provider = 'meta' THEN estimated_microusd ELSE 0 END), 0) AS meta_microusd_today
         FROM herma_meta_call_log
         WHERE created_at >= ?`
      )
      .bind(`${utcDayPrefix}T00:00:00.000Z`)
      .first(),
    db
      .prepare(
        `SELECT COUNT(*) AS total_traces,
                SUM(CASE WHEN verified_outcome = 'accepted' THEN 1 ELSE 0 END) AS accepted_traces
         FROM herma_finetune_traces`
      )
      .first(),
  ]);

  const sortedLatencies = (latenciesRes?.results || [])
    .map((r) => Number(r.latency_ms || 0))
    .filter((n) => n > 0)
    .sort((a, b) => a - b);

  const byModelRows = byModelRes?.results || [];
  let totalCalls = 0;
  let completedCalls = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalEstimatedMicrousd = 0;
  for (const r of byModelRows) {
    const c = Number(r.calls || 0);
    totalCalls += c;
    if (r.outcome === "completed") completedCalls += c;
    totalInputTokens += Number(r.input_tokens || 0);
    totalOutputTokens += Number(r.output_tokens || 0);
    totalEstimatedMicrousd += Number(r.estimated_microusd || 0);
  }

  const totalMetaBudgetUsd = Number(env?.HERMA_META_BUDGET_USD || HELP_STARTER_GRID.default_meta_total_budget_usd);

  return {
    status: HELP_STARTER_GRID.http_ok,
    body: {
      ok: true,
      schema: HELP_STARTER_GRID.schema_telemetry_id,
      supported_meta_muse_models: ["muse-spark-1.3", "muse-wonder-1.0"],
      totals: {
        total_meta_calls: totalCalls,
        completed_calls: completedCalls,
        success_rate:
          totalCalls > 0
            ? Math.round((completedCalls / totalCalls) * HELP_STARTER_GRID.rate_round_scale) /
              HELP_STARTER_GRID.rate_round_scale
            : 1.0,
        total_input_tokens: totalInputTokens,
        total_output_tokens: totalOutputTokens,
        total_tokens: totalInputTokens + totalOutputTokens,
        latency_p50_ms: computePercentile(sortedLatencies, HELP_STARTER_GRID.percentile_p50_numerator),
        latency_p95_ms: computePercentile(sortedLatencies, HELP_STARTER_GRID.percentile_p95_numerator),
      },
      budget_consumption: {
        utc_day: utcDayPrefix,
        meta_microusd_today: Number(dayTotalsRow?.meta_microusd_today || 0),
        meta_daily_public_microusd_cap: HELP_STARTER_GRID.help_meta_daily_microusd_cap,
        meta_total_estimated_microusd: totalEstimatedMicrousd,
        meta_total_operator_budget_microusd: Math.round(totalMetaBudgetUsd * HELP_STARTER_GRID.microusd_per_usd),
      },
      finetune_capture_summary: {
        total_traces: Number(finetuneStatsRow?.total_traces || 0),
        accepted_verified_traces: Number(finetuneStatsRow?.accepted_traces || 0),
      },
      breakdown_by_provider_model_outcome: byModelRows,
      meta_muse_worker_fleet: workerModelsRes?.results || [],
      recent_calls: recentCallsRes?.results || [],
    },
  };
}

export async function handleTrainingExportRequest(request, env, db, publicUrl) {
  await ensureHelpAndStarterSchema(db);
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return { status: HELP_STARTER_GRID.http_method_not_allowed, isJsonl: false, body: { ok: false, error: "method_not_allowed" } };
  }
  const url = new URL(request.url);
  const limit = Math.max(
    1,
    Math.min(
      HELP_STARTER_GRID.training_max_limit,
      Number(url.searchParams.get("limit") || HELP_STARTER_GRID.training_default_limit)
    )
  );
  const wantsJsonl =
    (url.searchParams.get("format") || "").toLowerCase() === "jsonl" ||
    (request.headers.get("accept") || "").includes("application/x-ndjson");

  // Strictly export only public-good & public-commons data, scrubbed of any identifiers/secrets
  const [tracesRes, objectsRes, chatsRes, routingArmsRes] = await Promise.all([
    db
      .prepare(
        `SELECT t.*, q.visibility AS linked_task_visibility, q.tier AS linked_task_tier
         FROM herma_finetune_traces t
         LEFT JOIN herma_durable_queue q ON q.task_id = t.task_id
         WHERE COALESCE(t.visibility, 'public_commons') IN ('public_ngo', 'public_commons')
           AND COALESCE(t.export_eligible, 1) = 1
           AND (
             COALESCE(t.task_id, '') IN ('', 'self_seed')
             OR (
               q.task_id IS NOT NULL
               AND q.visibility IN ('public_ngo', 'public_commons')
               AND COALESCE(q.tier, '') != 'infra_private'
             )
           )
         ORDER BY (CASE WHEN t.verified_outcome = 'accepted' THEN 0 WHEN t.verified_outcome = 'submitted_unreviewed' THEN 1 ELSE 2 END) ASC,
                  t.quality_weight_milli DESC, t.created_at DESC
         LIMIT ?`
      )
      .bind(limit)
      .all(),
    db
      .prepare(
        `SELECT o.id, o.object_key, o.category, o.summary, o.payload_json, o.eval_count,
                o.quality_milli, o.novelty_milli, o.sha256_hash, o.created_at,
                q.title AS task_title, q.prompt AS task_prompt, q.verb_kind AS task_verb_kind
         FROM herma_task_objects o
         LEFT JOIN herma_durable_queue q
           ON q.task_id = o.source_task_id
          AND q.visibility IN ('public_ngo', 'public_commons')
          AND COALESCE(q.tier, '') != 'infra_private'
         WHERE o.visibility IN ('public_ngo', 'public_commons')
           AND o.is_tombstoned = 0
         ORDER BY o.eval_count DESC, o.quality_milli DESC, o.id DESC
         LIMIT ?`
      )
      .bind(limit)
      .all(),
    db
      .prepare(
        `SELECT c.session_id, c.active_task_id, c.state_stage, c.history_json, c.staging_draft_json,
                c.turn_count, c.updated_at, c.visibility, c.export_eligible,
                q.visibility AS linked_task_visibility, q.tier AS linked_task_tier
         FROM herma_agent_conversations c
         LEFT JOIN herma_durable_queue q ON q.task_id = c.active_task_id
         WHERE c.turn_count >= 1
           AND COALESCE(c.visibility, 'public_commons') IN ('public_ngo', 'public_commons')
           AND COALESCE(c.export_eligible, 1) = 1
           AND (
             COALESCE(c.active_task_id, '') IN ('', 'self_seed')
             OR (
               q.task_id IS NOT NULL
               AND q.visibility IN ('public_ngo', 'public_commons')
               AND COALESCE(q.tier, '') != 'infra_private'
             )
           )
         ORDER BY (CASE WHEN c.state_stage = 'submitted' THEN 0 ELSE 1 END) ASC, c.turn_count DESC, c.updated_at DESC
         LIMIT ?`
      )
      .bind(limit)
      .all(),
    db.prepare("SELECT verb_kind, dispatch_count, success_count, mean_quality_milli FROM herma_routing_stats").all(),
  ]);

  const isPublicScopeMeta = (meta) => {
    if (!meta || typeof meta !== "object") return true;
    if (meta.training_export_allowed === false || meta.export_eligible === false || meta.export_eligible === 0) {
      return false;
    }
    if (typeof meta.visibility === "string" && meta.visibility.trim()) {
      return ["public_ngo", "public_commons"].includes(meta.visibility.trim());
    }
    return true;
  };

  const verbWinRateByKind = new Map();
  for (const arm of routingArmsRes?.results || []) {
    const d = Math.max(1, Number(arm.dispatch_count || 0));
    const w = Number(arm.success_count || 0) / d;
    const prev = verbWinRateByKind.get(arm.verb_kind) || 0;
    if (w > prev) verbWinRateByKind.set(arm.verb_kind, w);
  }

  const examples = [];

  for (const tr of tracesRes?.results || []) {
    if (examples.length >= limit) break;
    let sysShim = {};
    let inMsgs = [];
    let outObj = {};
    try {
      sysShim = JSON.parse(tr.system_shim_json || "{}");
    } catch {
      sysShim = {};
    }
    try {
      inMsgs = JSON.parse(tr.input_messages_json || "[]");
    } catch {
      inMsgs = [];
    }
    try {
      outObj = JSON.parse(tr.output_json || "{}");
    } catch {
      outObj = {};
    }
    if (!isPublicScopeMeta(sysShim) || !isPublicScopeMeta(outObj)) continue;
    if (Array.isArray(inMsgs) && inMsgs.some((m) => !isPublicScopeMeta(m))) continue;
    const weight =
      Math.round(
        (Number(tr.quality_weight_milli || HELP_STARTER_GRID.generated_trace_weight_milli) /
          HELP_STARTER_GRID.milli_scale) *
          HELP_STARTER_GRID.rate_round_scale
      ) / HELP_STARTER_GRID.rate_round_scale;
    examples.push({
      example_id: tr.trace_id,
      record_kind: tr.source_kind,
      verified_outcome: tr.verified_outcome,
      sample_weight: weight,
      source_model: tr.model_id || "muse-spark-1.3",
      messages: [
        { role: "system", content: scrubEmDash(scrubSensitiveText(JSON.stringify(sysShim))) },
        ...(Array.isArray(inMsgs)
          ? inMsgs.map((m) => ({
              role: m?.role || "user",
              content: scrubEmDash(scrubSensitiveText(String(m?.content || ""))),
            }))
          : []),
        { role: "assistant", content: scrubEmDash(scrubSensitiveText(JSON.stringify(outObj))) },
      ],
    });
  }

  for (const obj of objectsRes?.results || []) {
    if (examples.length >= limit) break;
    let parsedPayload = null;
    try {
      parsedPayload = JSON.parse(obj.payload_json || "");
    } catch {
      continue; // Skip any broken legacy truncated JSON rows!
    }
    const evalCount = Number(obj.eval_count || 0);
    const baseQual =
      evalCount > 0 ? Number(obj.quality_milli || 0) : HELP_STARTER_GRID.unreviewed_object_base_weight_milli;
    const evalBonus = Math.min(
      HELP_STARTER_GRID.eval_count_bonus_cap_milli,
      evalCount * HELP_STARTER_GRID.eval_count_bonus_step_milli
    );
    const ucbWin = verbWinRateByKind.get(obj.task_verb_kind || "general_verb") || 0;
    const ucbBonus = Math.round(ucbWin * HELP_STARTER_GRID.ucb_bonus_scale_milli);
    const combinedMilli = Math.min(HELP_STARTER_GRID.milli_scale, baseQual + evalBonus + ucbBonus);
    const sampleWeight =
      Math.round((combinedMilli / HELP_STARTER_GRID.milli_scale) * HELP_STARTER_GRID.rate_round_scale) /
      HELP_STARTER_GRID.rate_round_scale;

    examples.push({
      example_id: `obj_${obj.object_key}`,
      record_kind: obj.category === "reasoning_suggestion" ? "meta_reasoning_suggestion" : "verified_task_object",
      review_status: evalCount > 0 ? "peer_reviewed" : "unreviewed",
      eval_count: evalCount,
      quality_milli: evalCount > 0 ? Number(obj.quality_milli || 0) : 0,
      novelty_milli: Number(obj.novelty_milli || 0),
      sample_weight: sampleWeight,
      messages: [
        {
          role: "system",
          content:
            "Produce a reusable, domain-clean JSON Task Object with zero hardcoded magic values and verifiable SHA-256 structure.",
        },
        {
          role: "user",
          content: scrubEmDash(
            scrubSensitiveText(
              obj.task_prompt || obj.task_title || `Create reusable Task Object '${obj.object_key}' (${obj.category}): ${obj.summary}`
            )
          ),
        },
        {
          role: "assistant",
          content: scrubEmDash(
            scrubSensitiveText(
              JSON.stringify({
                object_key: obj.object_key,
                category: obj.category,
                summary: obj.summary,
                payload: parsedPayload,
              })
            )
          ),
        },
      ],
    });
  }

  const rawChats = chatsRes?.results || [];
  const referencedTurnTaskIds = new Set();
  for (const ch of rawChats) {
    try {
      const parsedTurns = JSON.parse(ch.history_json || "[]");
      if (Array.isArray(parsedTurns)) {
        for (const t of parsedTurns) {
          const tid = typeof t?.task_id === "string" ? t.task_id.trim() : "";
          if (tid && tid !== "self_seed") referencedTurnTaskIds.add(tid);
        }
      }
    } catch {
      // Handled per row below
    }
  }
  const publicTurnTaskIds = new Set();
  if (referencedTurnTaskIds.size > 0) {
    const taskList = [...referencedTurnTaskIds];
    const placeholders = taskList.map(() => "?").join(", ");
    try {
      const qRes = await db
        .prepare(
          `SELECT task_id FROM herma_durable_queue
           WHERE task_id IN (${placeholders})
             AND visibility IN ('public_ngo', 'public_commons')
             AND COALESCE(tier, '') != 'infra_private'`
        )
        .bind(...taskList)
        .all();
      for (const r of qRes?.results || []) {
        if (r?.task_id) publicTurnTaskIds.add(String(r.task_id));
      }
    } catch {
      // Fail closed on unresolved turn task IDs
    }
  }

  for (const ch of rawChats) {
    if (examples.length >= limit) break;
    let stagingMeta = {};
    try {
      stagingMeta = JSON.parse(ch.staging_draft_json || "{}");
    } catch {
      stagingMeta = {};
    }
    if (!isPublicScopeMeta(stagingMeta)) continue;
    let turns = [];
    try {
      turns = JSON.parse(ch.history_json || "[]");
    } catch {
      turns = [];
    }
    if (!Array.isArray(turns) || turns.length < 2) continue;
    const hasNonPublicTurn = turns.some((t) => {
      if (!isPublicScopeMeta(t)) return true;
      const tid = typeof t?.task_id === "string" ? t.task_id.trim() : "";
      if (tid && tid !== "self_seed" && !publicTurnTaskIds.has(tid)) return true;
      return false;
    });
    if (hasNonPublicTurn) continue;
    examples.push({
      example_id: `chat_${ch.session_id}`,
      record_kind: "a2a_multiturn_trajectory",
      state_stage: ch.state_stage,
      sample_weight:
        ch.state_stage === "submitted"
          ? HELP_STARTER_GRID.submitted_unreviewed_trace_weight_milli / HELP_STARTER_GRID.milli_scale
          : HELP_STARTER_GRID.generated_trace_weight_milli / HELP_STARTER_GRID.milli_scale,
      messages: turns.map((t) => ({
        role: t.role === "assistant" ? "assistant" : "user",
        content: scrubEmDash(scrubSensitiveText(String(t.content || ""))),
      })),
    });
  }

  if (wantsJsonl) {
    const jsonlBody = examples.map((ex) => JSON.stringify(ex)).join("\n") + (examples.length ? "\n" : "");
    return { status: HELP_STARTER_GRID.http_ok, isJsonl: true, jsonl: jsonlBody };
  }

  const base = String(publicUrl || "https://shim.teleionlabs.com").replace(/\/+$/, "");
  return {
    status: HELP_STARTER_GRID.http_ok,
    isJsonl: false,
    body: {
      ok: true,
      schema: HELP_STARTER_GRID.schema_training_id,
      target_model_families: ["muse-spark-1.3", "muse-wonder-1.0"],
      modal_gpu_training_recipe: {
        recommended_methods: ["weighted_sft", "dora_parametric_memory", "dpo_preference_alignment"],
        router_adapter_rank: HELP_STARTER_GRID.lora_rank_router,
        router_adapter_alpha: HELP_STARTER_GRID.lora_alpha_router,
        memory_adapter_rank: HELP_STARTER_GRID.lora_rank_memory,
        memory_adapter_alpha: HELP_STARTER_GRID.lora_alpha_memory,
        jsonl_stream_url: `${base}/q/training-export?format=jsonl`,
      },
      count: examples.length,
      examples,
    },
  };
}
