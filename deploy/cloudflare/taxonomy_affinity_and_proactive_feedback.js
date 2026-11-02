// Herma v6.10 Deterministic Taxonomy Auto-Describer, Preferred-Worker / Setup Affinity,
// Sample-Size-Calibrated Efficiency Confidence (Wilson/Beta LCB x EWMA Resource Efficiency),
// Ricardian Comparative-Advantage Routing, and Catch-All Proactive Feedback -> Peer-Review Verb Loop.

export const TAXONOMY_AFFINITY_FEEDBACK_GRID = Object.freeze({
  schema_id: "herma.taxonomy_affinity_feedback.grid.v6_10",
  affinity_schema_version: "herma.priority_work_gateway.affinity.v1",
  feedback_cluster_schema_version: "herma.priority_work_gateway.feedback_cluster.v6_10",
  prior_alpha: 2,
  prior_beta: 1,
  confidence_z_milli: 1645,
  setup_prior_blend_completions: 8,
  preferred_worker_exact_bonus: 24,
  preferred_setup_match_bonus: 14,
  setup_mismatch_penalty: 12,
  ricardian_cannibalization_penalty: 14,
  ricardian_scarce_build_bonus: 16,
  efficiency_confidence_weight: 22,
  exploration_novel_worker_bonus: 5,
  ewma_keep_milli: 750,
  reference_wall_ms: 8000,
  reference_tokens: 6000,
  chars_per_estimated_token: 4,
  default_tokens_estimate: 1200,
  default_wall_ms_estimate: 2800,
  default_quality_milli: 780,
  feedback_spawn_review_min_severity_milli: 600,
  feedback_promote_proposal_quorum: 2,
  min_summary_chars: 24,
  max_summary_chars: 480,
  max_search_keywords: 12,
  min_keyword_chars: 3,
  milli_divisor: 1000,
  half_divisor: 2,
  id_hex_chars: 12,
  default_priority: 72,
  high_severity_priority: 84,
  high_severity_milli: 850,
  medium_severity_milli: 650,
  low_severity_milli: 400,
  default_context_tokens: 32768,
  large_context_tokens: 131072,
  max_proactive_observations_per_submit: 6,
  diagnostic_cred_points: 6,
  affinity_worker_limit: 40,
  affinity_task_sample_limit: 20,
  model_hint_max_len: 80,
  object_key_max_len: 128,
  http_ok: 200,
  http_bad_request: 400,
  http_method_not_allowed: 405,
});

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "over",
  "across",
  "task",
  "object",
  "using",
  "build",
  "create",
  "json",
  "item",
  "work",
]);

export const ACTIONABLE_FEEDBACK_SIGNAL_KINDS = new Set([
  "bug_or_error",
  "data_inconsistency",
  "efficiency_concern",
  "better_or_alternative_way",
]);

export const ALL_FEEDBACK_SIGNAL_KINDS = new Set([
  "bug_or_error",
  "data_inconsistency",
  "efficiency_concern",
  "better_or_alternative_way",
  "training_signal",
  "worker_issue_report",
  "general_improvement_observation",
]);

const INITIALIZED_V610_DBS = new WeakSet();

async function sha256HexV610(input) {
  const bytes = new TextEncoder().encode(String(input || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Normalizes drifted model_hint strings stored in D1:
 * e.g. "Codex" -> "codex", "cloud-host/muse-spark-open" -> "muse-spark-open", "GPT_Astra" -> "gpt-astra".
 */
export function canonicalizeModelHint(rawHint, { agentId = "", userAgent = "" } = {}) {
  let cleaned = String(rawHint || "").trim().toLowerCase();
  if (cleaned.includes("/")) {
    const parts = cleaned.split("/").filter(Boolean);
    cleaned = parts[parts.length - 1] || cleaned;
  }
  cleaned = cleaned
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/_/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!cleaned) {
    const fallbackSig = `${agentId} ${userAgent}`.toLowerCase();
    if (fallbackSig.includes("muse-spark-open")) return "muse-spark-open";
    if (fallbackSig.includes("muse-wonder")) return "muse-wonder-1.0";
    if (fallbackSig.includes("muse-glimmer")) return "muse-glimmer-30b";
    if (fallbackSig.includes("muse")) return "muse-spark";
    if (fallbackSig.includes("gpt-astra") || fallbackSig.includes("astra")) return "gpt-astra";
    if (fallbackSig.includes("codex")) return "codex";
    if (fallbackSig.includes("kimi")) return "kimi-k2.7-code";
    if (fallbackSig.includes("deepseek")) return "deepseek-v4.1-flash";
    if (fallbackSig.includes("glm")) return "glm-5.3-flash";
    return "";
  }
  if (cleaned === "codex-cli") return "codex";
  if (cleaned === "astra") return "gpt-astra";
  return cleaned.slice(0, TAXONOMY_AFFINITY_FEEDBACK_GRID.model_hint_max_len);
}

/**
 * Maps a raw or normalized model hint to its canonical model family for setup-prior pooling.
 */
export function canonicalizeModelFamily(rawHint) {
  const cleaned = canonicalizeModelHint(rawHint);
  if (!cleaned) return "unspecified_model";
  if (cleaned.startsWith("muse-spark") || cleaned.startsWith("muse-wonder") || cleaned.startsWith("muse-glimmer") || cleaned === "muse") {
    return "muse-spark";
  }
  if (cleaned.startsWith("codex") || cleaned === "gpt-astra" || cleaned.startsWith("antigravity")) {
    return "codex-frontier";
  }
  if (cleaned.startsWith("glm")) return "glm-series";
  if (cleaned.startsWith("deepseek")) return "deepseek-series";
  if (cleaned.startsWith("kimi")) return "kimi-series";
  if (cleaned.startsWith("minimax")) return "minimax-series";
  if (cleaned.startsWith("mimo")) return "mimo-series";
  return cleaned;
}

export function defaultToolsForHarnessTier(harnessTier = "", transportMode = "") {
  const tier = String(harnessTier || "").trim();
  if (tier === "tier_4_deep_architect_astra" || tier === "tier_3_cli_code_harness") {
    return [
      "http_client",
      "python_or_node_runtime",
      "schema_validator",
      "shell_exec",
      "structured_json_reasoning",
      "test_runner",
    ];
  }
  if (tier === "tier_1_lightweight_get" || tier === "tier_1_light_chat" || transportMode === "get_only") {
    return ["http_client", "structured_json_reasoning"];
  }
  return ["http_client", "schema_validator", "structured_json_reasoning"];
}

export function defaultContextTokensForTier(harnessTier = "") {
  const tier = String(harnessTier || "").trim();
  if (tier === "tier_4_deep_architect_astra" || tier === "tier_3_cli_code_harness") {
    return TAXONOMY_AFFINITY_FEEDBACK_GRID.large_context_tokens;
  }
  return TAXONOMY_AFFINITY_FEEDBACK_GRID.default_context_tokens;
}

export function buildDefaultPreferredWorkerSetup(stepMode = "atomic_cognitive_step", overrides = {}) {
  const cleanStep = String(stepMode || "atomic_cognitive_step").trim().toLowerCase();
  let defaultTiers;
  let defaultTools;
  let minCtx;
  if (cleanStep === "atomic_build_step") {
    defaultTiers = ["tier_3_cli_code_harness", "tier_4_deep_architect_astra"];
    defaultTools = ["shell_exec", "python_or_node_runtime", "test_runner"];
    minCtx = TAXONOMY_AFFINITY_FEEDBACK_GRID.large_context_tokens;
  } else if (cleanStep === "atomic_verification_step") {
    defaultTiers = [
      "tier_2_sandboxed_chat_worker",
      "tier_3_cli_code_harness",
      "tier_4_deep_architect_astra",
    ];
    defaultTools = ["http_client", "schema_validator"];
    minCtx = TAXONOMY_AFFINITY_FEEDBACK_GRID.default_context_tokens;
  } else {
    defaultTiers = [
      "tier_1_light_chat",
      "tier_1_lightweight_get",
      "tier_2_sandboxed_chat_worker",
      "tier_3_cli_code_harness",
    ];
    defaultTools = ["structured_json_reasoning"];
    minCtx = TAXONOMY_AFFINITY_FEEDBACK_GRID.default_context_tokens;
  }

  const ov = Array.isArray(overrides)
    ? {
        preferred_setup_tags: overrides.map((x) => String(x || "").trim()).filter(Boolean),
        required_tools: overrides.map((x) => String(x || "").trim()).filter(Boolean),
      }
    : overrides && typeof overrides === "object"
      ? overrides
      : {};
  const prefTags = Array.isArray(ov.preferred_setup_tags)
    ? ov.preferred_setup_tags.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const prefTiers =
    Array.isArray(ov.preferred_harness_tiers) && ov.preferred_harness_tiers.length > 0
      ? ov.preferred_harness_tiers.map((x) => String(x || "").trim()).filter(Boolean)
      : defaultTiers;
  const reqTools =
    Array.isArray(ov.required_tools) && ov.required_tools.length > 0
      ? ov.required_tools.map((x) => String(x || "").trim()).filter(Boolean)
      : defaultTools;
  const minContextTokens =
    Number.isFinite(Number(ov.min_context_tokens)) && Number(ov.min_context_tokens) > 0
      ? Math.round(Number(ov.min_context_tokens))
      : minCtx;
  const prefModels = Array.isArray(ov.preferred_model_families)
    ? Array.from(
        new Set(
          ov.preferred_model_families
            .map((m) => canonicalizeModelFamily(m))
            .filter((m) => m && m !== "unspecified_model")
        )
      )
    : [];
  const prefUuids = Array.isArray(ov.preferred_worker_uuids)
    ? ov.preferred_worker_uuids.map((u) => String(u || "").trim()).filter(Boolean)
    : [];
  const excludedAgents = Array.isArray(ov.excluded_reporter_agent_ids)
    ? ov.excluded_reporter_agent_ids.map((a) => String(a || "").trim().toLowerCase()).filter(Boolean)
    : [];
  const excludedUuids = Array.isArray(ov.excluded_reporter_worker_uuids)
    ? ov.excluded_reporter_worker_uuids.map((u) => String(u || "").trim()).filter(Boolean)
    : [];

  return {
    preferred_harness_tiers: prefTiers,
    required_tools: reqTools,
    ...(prefTags.length > 0 ? { preferred_setup_tags: prefTags } : {}),
    min_context_tokens: minContextTokens,
    preferred_model_families: prefModels,
    preferred_worker_uuids: prefUuids,
    ...(excludedAgents.length > 0 ? { excluded_reporter_agent_ids: excludedAgents } : {}),
    ...(excludedUuids.length > 0 ? { excluded_reporter_worker_uuids: excludedUuids } : {}),
    step_mode: cleanStep,
  };
}

/**
 * Deterministic auto-describer matching `StructuredArtifactTaxonomyDescriber` so NO Task or Task Object
 * ever has blank `intent_bucket`, `target_env`, `prog_lang`, `deliverable_kind`, `search_hints_json`,
 * or `required_capabilities_json` (`preferred_worker_setup`).
 */
export function enrichTaxonomyRecord(raw = {}) {
  const title = String(raw.title || raw.object_key || raw.task_id || "untitled_item").trim();
  const summary = String(raw.summary || raw.prompt || raw.description || "").trim();
  const category = String(raw.category || raw.verb_kind || raw.tier || "reusable_component")
    .trim()
    .toLowerCase();
  let payloadPreview = "";
  if (raw.payload !== undefined && raw.payload !== null) {
    try {
      payloadPreview = typeof raw.payload === "string" ? raw.payload.slice(0, 2000) : JSON.stringify(raw.payload).slice(0, 2000);
    } catch {
      payloadPreview = "";
    }
  } else if (typeof raw.payload_json === "string") {
    payloadPreview = raw.payload_json.slice(0, 2000);
  }
  const corpus = `${title} ${summary} ${category} ${payloadPreview}`.toLowerCase();

  let progLang = String(raw.prog_lang || raw.search_hints?.facet_axes?.prog_lang || raw.search_hints?.prog_lang || "")
    .trim()
    .toLowerCase();
  if (!progLang) {
    if (/(pytest|python|def\s|torch|numpy|pydantic|fastapi|\.py\b)/.test(corpus)) {
      progLang = "python";
    } else if (/(cloudflare|wrangler|vitest|javascript|typescript|node\s|\.js\b|\.ts\b)/.test(corpus)) {
      progLang = "javascript";
    } else if (/(sqlite|select\s|pragma\s|create\s+table|\.sql\b)/.test(corpus)) {
      progLang = "sql";
    } else if (/(\brust\b|cargo|\.rs\b)/.test(corpus)) {
      progLang = "rust";
    } else if (/(\bgolang\b|go\.mod)/.test(corpus)) {
      progLang = "go";
    } else {
      progLang = "polyglot_declarative";
    }
  }

  let targetEnv = String(raw.target_env || raw.search_hints?.facet_axes?.target_env || raw.search_hints?.target_env || "")
    .trim()
    .toLowerCase();
  if (!targetEnv) {
    if (/(\bworker\b|\bd1\b|cloudflare|workerd|wrangler|\bedge\b)/.test(corpus)) {
      targetEnv = "cloudflare_edge_worker";
    } else if (/(modal|\bgpu\b|dora|\bdpo\b|pytorch|faiss|cuda)/.test(corpus)) {
      targetEnv = "gpu_batch_container";
    } else if (/(browser|\bhtml\b|\bsvg\b|wcag|\bcss\b|canvas|webgl)/.test(corpus)) {
      targetEnv = "browser_light_surface";
    } else {
      targetEnv = "portable_cli_or_sandbox";
    }
  }

  let deliverableKind = String(
    raw.deliverable_kind || raw.search_hints?.facet_axes?.deliverable_kind || raw.search_hints?.deliverable_kind || ""
  )
    .trim()
    .toLowerCase();
  if (!deliverableKind) {
    if (/(\beval\b|audit|verify|rubric|benchmark|calibration|dossier)/.test(corpus)) {
      deliverableKind = "verification_and_benchmark_suite";
    } else if (/(agent_kit|skill|template|prompt|starter|pack)/.test(corpus)) {
      deliverableKind = "portable_agent_kit";
    } else if (/(\bstl\b|\bwav\b|\bmp4\b|\bsvg\b|mesh|godot|tscn|audio|sprite)/.test(corpus)) {
      deliverableKind = "multimodal_verified_asset";
    } else {
      deliverableKind = "deterministic_code_module";
    }
  }

  let intentBucket = String(
    raw.intent_bucket || raw.search_hints?.intent_signature || raw.search_hints?.intent_bucket || ""
  )
    .trim()
    .toLowerCase();
  if (!intentBucket) {
    if (raw.tier === "ngo_priority" || /(\bngo\b|nonprofit|shelter|clinic|civic|accessibility|aid|990)/.test(corpus)) {
      intentBucket = "public_good_operations";
    } else if (/(radar|github|discovery|feed|signal|breakout|ecosyste)/.test(corpus)) {
      intentBucket = "frontier_signal_discovery";
    } else if (/(lease|queue|\bgrid\b|routing|latency|fencing|tessera|affinity|plateau)/.test(corpus)) {
      intentBucket = "distributed_substrate_optimization";
    } else {
      intentBucket = "reusable_capability_synthesis";
    }
  }

  let optGoal = String(raw.opt_goal || raw.search_hints?.facet_axes?.opt_goal || raw.search_hints?.opt_goal || "")
    .trim()
    .toLowerCase();
  if (!optGoal) {
    if (/(plateau|thick_path|perturbation|robust)/.test(corpus)) {
      optGoal = "thick_plateau_perturbation_invariant";
    } else if (intentBucket === "public_good_operations") {
      optGoal = "zero_pii_civic_reliability";
    } else if (targetEnv === "cloudflare_edge_worker") {
      optGoal = "low_latency_edge_bounded";
    } else {
      optGoal = "reusable_deterministic_bypass";
    }
  }

  let stepMode = String(raw.step_mode || "").trim().toLowerCase();
  if (
    stepMode !== "atomic_cognitive_step" &&
    stepMode !== "atomic_build_step" &&
    stepMode !== "atomic_verification_step" &&
    stepMode !== "deterministic_reuse_step"
  ) {
    if (deliverableKind === "verification_and_benchmark_suite" || raw.verb_kind === "eval_and_rank") {
      stepMode = "atomic_verification_step";
    } else if (
      deliverableKind === "deterministic_code_module" ||
      deliverableKind === "multimodal_verified_asset" ||
      /(pytest|vitest|node --test|compile|dockerfile|ffmpeg|code_and_tests|working_dir_files)/.test(corpus)
    ) {
      stepMode = "atomic_build_step";
    } else {
      stepMode = "atomic_cognitive_step";
    }
  }

  const reuseMode =
    raw.reuse_mode === "deterministic_code_bypass" ||
    raw.reuse_mode === "verification_oracle" ||
    raw.reuse_mode === "semantic_rubric_prior"
      ? raw.reuse_mode
      : stepMode === "atomic_build_step" || stepMode === "deterministic_reuse_step"
        ? "deterministic_code_bypass"
        : stepMode === "atomic_verification_step"
          ? "verification_oracle"
          : "semantic_rubric_prior";

  const rawReqCaps = Array.isArray(raw.required_capabilities)
    ? raw.required_capabilities.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const explicitSetup = Array.isArray(raw.preferred_worker_setup)
    ? {
        preferred_setup_tags: raw.preferred_worker_setup.map((x) => String(x || "").trim()).filter(Boolean),
        required_tools: raw.preferred_worker_setup.map((x) => String(x || "").trim()).filter(Boolean),
      }
    : raw.preferred_worker_setup && typeof raw.preferred_worker_setup === "object"
      ? raw.preferred_worker_setup
      : {};
  const preferredWorkerSetup = buildDefaultPreferredWorkerSetup(stepMode, {
    ...explicitSetup,
    ...(rawReqCaps.length > 0 && !explicitSetup.required_tools ? { required_tools: rawReqCaps } : {}),
  });

  const requiredCapabilitiesJson = JSON.stringify({
    required_capabilities:
      rawReqCaps.length > 0 ? rawReqCaps : preferredWorkerSetup.required_tools,
    preferred_worker_setup: preferredWorkerSetup,
  });

  const existingKeywords = Array.isArray(raw.search_hints?.search_keywords)
    ? raw.search_hints.search_keywords.map((k) => String(k || "").trim().toLowerCase()).filter(Boolean)
    : [];
  const extractedWords = `${title} ${summary} ${category} ${intentBucket} ${deliverableKind}`
    .toLowerCase()
    .match(/[a-z0-9_]+/g) || [];
  const keywords = [...existingKeywords];
  for (const w of extractedWords) {
    if (
      w.length >= TAXONOMY_AFFINITY_FEEDBACK_GRID.min_keyword_chars &&
      !STOPWORDS.has(w) &&
      !keywords.includes(w)
    ) {
      keywords.push(w);
    }
    if (keywords.length >= TAXONOMY_AFFINITY_FEEDBACK_GRID.max_search_keywords) break;
  }
  if (keywords.length === 0) {
    keywords.push(intentBucket, deliverableKind);
  }

  const existingLabels = Array.isArray(raw.labels)
    ? raw.labels.map((l) => String(l || "").trim()).filter(Boolean)
    : [];
  const enrichedLabels = Array.from(
    new Set([
      ...existingLabels,
      `intent:${intentBucket}`,
      `env:${targetEnv}`,
      `lang:${progLang}`,
      `kind:${deliverableKind}`,
      `mode:${stepMode}`,
    ])
  );

  const searchHintsObj = {
    intent_signature: intentBucket,
    search_keywords: keywords,
    ...(Array.isArray(raw.search_hints?.search_phrases) && raw.search_hints.search_phrases.length > 0
      ? { search_phrases: raw.search_hints.search_phrases.slice(0, 8) }
      : {}),
    ...(Array.isArray(raw.search_hints?.semantic_synonyms) && raw.search_hints.semantic_synonyms.length > 0
      ? { semantic_synonyms: raw.search_hints.semantic_synonyms.slice(0, 8) }
      : {}),
    facet_axes: {
      opt_goal: optGoal,
      target_env: targetEnv,
      prog_lang: progLang,
      ...(raw.locale_country || raw.search_hints?.facet_axes?.locale_country
        ? { locale_country: String(raw.locale_country || raw.search_hints.facet_axes.locale_country) }
        : {}),
      deliverable_kind: deliverableKind,
    },
  };

  return {
    intent_bucket: intentBucket,
    opt_goal: optGoal,
    target_env: targetEnv,
    prog_lang: progLang,
    deliverable_kind: deliverableKind,
    step_mode: stepMode,
    reuse_mode: reuseMode,
    keywords,
    labels: enrichedLabels,
    preferred_worker_setup: preferredWorkerSetup,
    required_capabilities_json: requiredCapabilitiesJson,
    search_hints: searchHintsObj,
    search_hints_json: JSON.stringify(searchHintsObj),
  };
}

export function parseRequiredCapabilitiesAndSetup(rawJson, fallbackRow = {}) {
  let parsed = null;
  if (typeof rawJson === "string" && rawJson.trim()) {
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      parsed = null;
    }
  } else if (rawJson && typeof rawJson === "object") {
    parsed = rawJson;
  }

  const stepMode = String(fallbackRow.step_mode || "atomic_cognitive_step").trim().toLowerCase() || "atomic_cognitive_step";
  if (Array.isArray(parsed)) {
    const setup = buildDefaultPreferredWorkerSetup(stepMode, parsed.length > 0 ? { required_tools: parsed } : {});
    return {
      required_capabilities: parsed.length > 0 ? parsed : setup.required_tools,
      preferred_worker_setup: setup,
    };
  }
  if (parsed && typeof parsed === "object") {
    const innerSetup =
      parsed.preferred_worker_setup && typeof parsed.preferred_worker_setup === "object"
        ? parsed.preferred_worker_setup
        : parsed;
    const setup = buildDefaultPreferredWorkerSetup(stepMode, innerSetup);
    const reqCaps =
      Array.isArray(parsed.required_capabilities) && parsed.required_capabilities.length > 0
        ? parsed.required_capabilities
        : setup.required_tools;
    return {
      required_capabilities: reqCaps,
      preferred_worker_setup: setup,
    };
  }

  const fallbackSetup = buildDefaultPreferredWorkerSetup(stepMode, {});
  return {
    required_capabilities: fallbackSetup.required_tools,
    preferred_worker_setup: fallbackSetup,
  };
}

export async function ensureTaxonomyAffinityAndFeedbackSchema(db) {
  if (!db || typeof db.prepare !== "function") return;
  if (db.__hermaSchemaV610Ready || INITIALIZED_V610_DBS.has(db)) return;

  const ddl = [
    `CREATE TABLE IF NOT EXISTS herma_worker_setup_slice_stats (
      slice_key TEXT PRIMARY KEY,
      entity_kind TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      harness_tier TEXT NOT NULL DEFAULT '',
      canonical_model_family TEXT NOT NULL DEFAULT '',
      transport_mode TEXT NOT NULL DEFAULT 'http_json',
      category TEXT NOT NULL DEFAULT 'general',
      step_mode TEXT NOT NULL DEFAULT 'atomic_cognitive_step',
      successes INTEGER NOT NULL DEFAULT 0,
      failures INTEGER NOT NULL DEFAULT 0,
      ema_wall_ms INTEGER NOT NULL DEFAULT 0,
      ema_tokens INTEGER NOT NULL DEFAULT 0,
      ema_quality_milli INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_herma_setup_slice_entity
     ON herma_worker_setup_slice_stats (entity_kind, entity_id)`,
    `CREATE TABLE IF NOT EXISTS herma_feedback_signal_clusters (
      fingerprint TEXT PRIMARY KEY,
      object_key TEXT NOT NULL,
      signal_kind TEXT NOT NULL,
      target_component TEXT NOT NULL,
      severity_milli INTEGER NOT NULL DEFAULT 650,
      canonical_summary TEXT NOT NULL,
      proposed_alternatives_json TEXT NOT NULL DEFAULT '[]',
      reporters_json TEXT NOT NULL DEFAULT '[]',
      reporter_uuids_json TEXT NOT NULL DEFAULT '[]',
      review_verb_id TEXT NOT NULL DEFAULT '',
      verified_confirmations_json TEXT NOT NULL DEFAULT '[]',
      promoted_to_proposal INTEGER NOT NULL DEFAULT 0,
      emitted_training_signal INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  ];

  for (const sql of ddl) {
    await db.prepare(sql).run();
  }
  INITIALIZED_V610_DBS.add(db);
}

/**
 * Set-based idempotent SQL backfill for `herma_worker_registry`, `herma_durable_queue`,
 * and `herma_task_objects` so 100% of active rows have populated taxonomy fields,
 * canonicalized `model_hint`, non-empty `required_capabilities_json` (`preferred_worker_setup`),
 * non-empty `search_hints_json`, and `tessera_synced = 1` on mirrored public artifacts.
 */
export async function runV610TaxonomyAndModelBackfill(db) {
  if (!db || typeof db.prepare !== "function") return;
  await ensureTaxonomyAffinityAndFeedbackSchema(db);

  const backfillStmts = [
    db.prepare(
      `UPDATE herma_worker_registry
       SET model_hint = REPLACE(
         CASE
           WHEN LOWER(TRIM(model_hint)) LIKE '%/%' THEN LOWER(TRIM(SUBSTR(model_hint, INSTR(model_hint, '/') + 1)))
           ELSE LOWER(TRIM(model_hint))
         END,
         '_',
         '-'
       )
       WHERE model_hint != '' AND (model_hint != LOWER(TRIM(model_hint)) OR model_hint LIKE '%/%' OR model_hint LIKE '%_%')`
    ),
    db.prepare(
      `UPDATE herma_durable_queue
       SET intent_bucket = CASE
             WHEN COALESCE(intent_bucket, '') != '' THEN intent_bucket
             WHEN tier = 'ngo_priority' OR LOWER(title || ' ' || prompt) LIKE '%ngo%' OR LOWER(title || ' ' || prompt) LIKE '%nonprofit%' OR LOWER(title || ' ' || prompt) LIKE '%shelter%' OR LOWER(title || ' ' || prompt) LIKE '%civic%' THEN 'public_good_operations'
             WHEN LOWER(title || ' ' || prompt || ' ' || category) LIKE '%github%' OR LOWER(title || ' ' || prompt || ' ' || category) LIKE '%radar%' OR LOWER(title || ' ' || prompt || ' ' || category) LIKE '%discovery%' THEN 'frontier_signal_discovery'
             WHEN LOWER(title || ' ' || prompt || ' ' || category) LIKE '%queue%' OR LOWER(title || ' ' || prompt || ' ' || category) LIKE '%lease%' OR LOWER(title || ' ' || prompt || ' ' || category) LIKE '%grid%' OR LOWER(title || ' ' || prompt || ' ' || category) LIKE '%routing%' THEN 'distributed_substrate_optimization'
             ELSE 'reusable_capability_synthesis'
           END,
           target_env = CASE
             WHEN COALESCE(target_env, '') != '' THEN target_env
             WHEN LOWER(title || ' ' || prompt || ' ' || category) LIKE '%cloudflare%' OR LOWER(title || ' ' || prompt || ' ' || category) LIKE '%d1%' OR LOWER(title || ' ' || prompt || ' ' || category) LIKE '%worker%' THEN 'cloudflare_edge_worker'
             WHEN LOWER(title || ' ' || prompt || ' ' || category) LIKE '%gpu%' OR LOWER(title || ' ' || prompt || ' ' || category) LIKE '%dpo%' OR LOWER(title || ' ' || prompt || ' ' || category) LIKE '%pytorch%' THEN 'gpu_batch_container'
             WHEN LOWER(title || ' ' || prompt || ' ' || category) LIKE '%browser%' OR LOWER(title || ' ' || prompt || ' ' || category) LIKE '%html%' OR LOWER(title || ' ' || prompt || ' ' || category) LIKE '%svg%' THEN 'browser_light_surface'
             ELSE 'portable_cli_or_sandbox'
           END,
           prog_lang = CASE
             WHEN COALESCE(prog_lang, '') != '' THEN prog_lang
             WHEN LOWER(title || ' ' || prompt) LIKE '%pytest%' OR LOWER(title || ' ' || prompt) LIKE '%python%' THEN 'python'
             WHEN LOWER(title || ' ' || prompt) LIKE '%vitest%' OR LOWER(title || ' ' || prompt) LIKE '%javascript%' OR LOWER(title || ' ' || prompt) LIKE '%typescript%' OR LOWER(title || ' ' || prompt) LIKE '%cloudflare%' THEN 'javascript'
             WHEN LOWER(title || ' ' || prompt) LIKE '%sqlite%' OR LOWER(title || ' ' || prompt) LIKE '%sql%' THEN 'sql'
             ELSE 'polyglot_declarative'
           END,
           deliverable_kind = CASE
             WHEN COALESCE(deliverable_kind, '') != '' THEN deliverable_kind
             WHEN verb_kind = 'eval_and_rank' OR LOWER(title || ' ' || prompt || ' ' || category) LIKE '%eval%' OR LOWER(title || ' ' || prompt || ' ' || category) LIKE '%benchmark%' OR LOWER(title || ' ' || prompt || ' ' || category) LIKE '%verify%' OR LOWER(title || ' ' || prompt || ' ' || category) LIKE '%rubric%' THEN 'verification_and_benchmark_suite'
             WHEN verb_kind = 'agent_kit_packager' OR LOWER(title || ' ' || prompt || ' ' || category) LIKE '%kit%' OR LOWER(title || ' ' || prompt || ' ' || category) LIKE '%template%' OR LOWER(title || ' ' || prompt || ' ' || category) LIKE '%skill%' THEN 'portable_agent_kit'
             WHEN verb_kind = 'demo_and_video' OR LOWER(title || ' ' || prompt || ' ' || category) LIKE '%stl%' OR LOWER(title || ' ' || prompt || ' ' || category) LIKE '%wav%' OR LOWER(title || ' ' || prompt || ' ' || category) LIKE '%mesh%' OR LOWER(title || ' ' || prompt || ' ' || category) LIKE '%demo%' THEN 'multimodal_verified_asset'
             ELSE 'deterministic_code_module'
           END,
           opt_goal = CASE
             WHEN COALESCE(opt_goal, '') != '' THEN opt_goal
             WHEN tier = 'ngo_priority' THEN 'zero_pii_civic_reliability'
             ELSE 'thick_plateau_perturbation_invariant'
           END
       WHERE COALESCE(intent_bucket, '') = ''
          OR COALESCE(target_env, '') = ''
          OR COALESCE(prog_lang, '') = ''
          OR COALESCE(deliverable_kind, '') = ''
          OR COALESCE(opt_goal, '') = ''`
    ),
    db.prepare(
      `UPDATE herma_durable_queue
       SET required_capabilities_json = CASE
             WHEN step_mode = 'atomic_build_step' THEN '{"required_capabilities":["shell_exec","python_or_node_runtime","test_runner"],"preferred_worker_setup":{"preferred_harness_tiers":["tier_3_cli_code_harness","tier_4_deep_architect_astra"],"required_tools":["shell_exec","python_or_node_runtime","test_runner"],"min_context_tokens":131072,"preferred_model_families":[],"preferred_worker_uuids":[],"step_mode":"atomic_build_step"}}'
             WHEN step_mode = 'atomic_verification_step' THEN '{"required_capabilities":["http_client","schema_validator"],"preferred_worker_setup":{"preferred_harness_tiers":["tier_2_sandboxed_chat_worker","tier_3_cli_code_harness","tier_4_deep_architect_astra"],"required_tools":["http_client","schema_validator"],"min_context_tokens":32768,"preferred_model_families":[],"preferred_worker_uuids":[],"step_mode":"atomic_verification_step"}}'
             ELSE '{"required_capabilities":["structured_json_reasoning"],"preferred_worker_setup":{"preferred_harness_tiers":["tier_1_light_chat","tier_1_lightweight_get","tier_2_sandboxed_chat_worker","tier_3_cli_code_harness"],"required_tools":["structured_json_reasoning"],"min_context_tokens":32768,"preferred_model_families":[],"preferred_worker_uuids":[],"step_mode":"atomic_cognitive_step"}}'
           END
       WHERE COALESCE(required_capabilities_json, '') IN ('', '[]', '{}')`
    ),
    db.prepare(
      `UPDATE herma_durable_queue
       SET search_hints_json = json_object(
             'intent_signature', intent_bucket,
             'search_keywords', json_array(intent_bucket, deliverable_kind, prog_lang),
             'facet_axes', json_object(
               'opt_goal', COALESCE(NULLIF(opt_goal, ''), 'thick_plateau_perturbation_invariant'),
               'target_env', target_env,
               'prog_lang', prog_lang,
               'deliverable_kind', deliverable_kind
             )
           )
       WHERE COALESCE(search_hints_json, '') IN ('', '{}')`
    ),
    db.prepare(
      `UPDATE herma_task_objects
       SET intent_bucket = CASE
             WHEN COALESCE(intent_bucket, '') != '' THEN intent_bucket
             WHEN visibility = 'public_ngo' OR LOWER(object_key || ' ' || summary || ' ' || category) LIKE '%ngo%' OR LOWER(object_key || ' ' || summary || ' ' || category) LIKE '%nonprofit%' OR LOWER(object_key || ' ' || summary || ' ' || category) LIKE '%shelter%' OR LOWER(object_key || ' ' || summary || ' ' || category) LIKE '%civic%' THEN 'public_good_operations'
             WHEN LOWER(object_key || ' ' || summary || ' ' || category) LIKE '%github%' OR LOWER(object_key || ' ' || summary || ' ' || category) LIKE '%radar%' OR LOWER(object_key || ' ' || summary || ' ' || category) LIKE '%discovery%' THEN 'frontier_signal_discovery'
             WHEN LOWER(object_key || ' ' || summary || ' ' || category) LIKE '%queue%' OR LOWER(object_key || ' ' || summary || ' ' || category) LIKE '%lease%' OR LOWER(object_key || ' ' || summary || ' ' || category) LIKE '%grid%' OR LOWER(object_key || ' ' || summary || ' ' || category) LIKE '%routing%' OR LOWER(object_key || ' ' || summary || ' ' || category) LIKE '%embedding%' THEN 'distributed_substrate_optimization'
             ELSE 'reusable_capability_synthesis'
           END,
           target_env = CASE
             WHEN COALESCE(target_env, '') != '' THEN target_env
             WHEN LOWER(object_key || ' ' || summary || ' ' || category) LIKE '%cloudflare%' OR LOWER(object_key || ' ' || summary || ' ' || category) LIKE '%d1%' OR LOWER(object_key || ' ' || summary || ' ' || category) LIKE '%worker%' THEN 'cloudflare_edge_worker'
             WHEN LOWER(object_key || ' ' || summary || ' ' || category) LIKE '%gpu%' OR LOWER(object_key || ' ' || summary || ' ' || category) LIKE '%dpo%' OR LOWER(object_key || ' ' || summary || ' ' || category) LIKE '%sonar%' OR LOWER(object_key || ' ' || summary || ' ' || category) LIKE '%contriever%' THEN 'gpu_batch_container'
             WHEN LOWER(object_key || ' ' || summary || ' ' || category) LIKE '%browser%' OR LOWER(object_key || ' ' || summary || ' ' || category) LIKE '%html%' OR LOWER(object_key || ' ' || summary || ' ' || category) LIKE '%svg%' THEN 'browser_light_surface'
             ELSE 'portable_cli_or_sandbox'
           END,
           prog_lang = CASE
             WHEN COALESCE(prog_lang, '') != '' THEN prog_lang
             WHEN LOWER(object_key || ' ' || summary || ' ' || SUBSTR(payload_json, 1, 800)) LIKE '%pytest%' OR LOWER(object_key || ' ' || summary || ' ' || SUBSTR(payload_json, 1, 800)) LIKE '%python%' OR SUBSTR(payload_json, 1, 800) LIKE '%def %' THEN 'python'
             WHEN LOWER(object_key || ' ' || summary || ' ' || SUBSTR(payload_json, 1, 800)) LIKE '%vitest%' OR LOWER(object_key || ' ' || summary || ' ' || SUBSTR(payload_json, 1, 800)) LIKE '%javascript%' OR LOWER(object_key || ' ' || summary || ' ' || SUBSTR(payload_json, 1, 800)) LIKE '%cloudflare%' THEN 'javascript'
             WHEN LOWER(object_key || ' ' || summary || ' ' || SUBSTR(payload_json, 1, 800)) LIKE '%sqlite%' OR LOWER(object_key || ' ' || summary || ' ' || SUBSTR(payload_json, 1, 800)) LIKE '%create table%' THEN 'sql'
             ELSE 'polyglot_declarative'
           END,
           deliverable_kind = CASE
             WHEN COALESCE(deliverable_kind, '') != '' THEN deliverable_kind
             WHEN LOWER(category || ' ' || summary) LIKE '%eval%' OR LOWER(category || ' ' || summary) LIKE '%benchmark%' OR LOWER(category || ' ' || summary) LIKE '%dossier%' OR LOWER(category || ' ' || summary) LIKE '%rubric%' OR LOWER(category || ' ' || summary) LIKE '%issue_report%' THEN 'verification_and_benchmark_suite'
             WHEN LOWER(category || ' ' || summary) LIKE '%kit%' OR LOWER(category || ' ' || summary) LIKE '%template%' OR LOWER(category || ' ' || summary) LIKE '%skill%' OR LOWER(category || ' ' || summary) LIKE '%adapter%' THEN 'portable_agent_kit'
             WHEN LOWER(category || ' ' || summary) LIKE '%multimodal%' OR LOWER(category || ' ' || summary) LIKE '%stl%' OR LOWER(category || ' ' || summary) LIKE '%wav%' OR LOWER(category || ' ' || summary) LIKE '%mesh%' THEN 'multimodal_verified_asset'
             ELSE 'deterministic_code_module'
           END,
           opt_goal = CASE
             WHEN COALESCE(opt_goal, '') != '' THEN opt_goal
             WHEN visibility = 'public_ngo' THEN 'zero_pii_civic_reliability'
             ELSE 'thick_plateau_perturbation_invariant'
           END
       WHERE COALESCE(intent_bucket, '') = ''
          OR COALESCE(target_env, '') = ''
          OR COALESCE(prog_lang, '') = ''
          OR COALESCE(deliverable_kind, '') = ''
          OR COALESCE(opt_goal, '') = ''`
    ),
    db.prepare(
      `UPDATE herma_task_objects
       SET search_hints_json = json_object(
             'intent_signature', intent_bucket,
             'search_keywords', json_array(intent_bucket, deliverable_kind, prog_lang),
             'facet_axes', json_object(
               'opt_goal', COALESCE(NULLIF(opt_goal, ''), 'thick_plateau_perturbation_invariant'),
               'target_env', target_env,
               'prog_lang', prog_lang,
               'deliverable_kind', deliverable_kind
             )
           )
       WHERE COALESCE(search_hints_json, '') IN ('', '{}')`
    ),
    db.prepare(
      `UPDATE herma_durable_queue
       SET labels_json = json_array('intent:' || intent_bucket, 'env:' || target_env, 'lang:' || prog_lang, 'kind:' || deliverable_kind)
       WHERE COALESCE(labels_json, '') IN ('', '[]')`
    ),
    db.prepare(
      `UPDATE herma_task_objects
       SET labels_json = json_array('intent:' || intent_bucket, 'env:' || target_env, 'lang:' || prog_lang, 'kind:' || deliverable_kind)
       WHERE COALESCE(labels_json, '') IN ('', '[]')`
    ),
    db.prepare(
      `UPDATE herma_task_objects
       SET tessera_synced = 1
       WHERE COALESCE(tessera_synced, 0) = 0
         AND visibility IN ('public_ngo', 'public_commons')`
    ),
  ];

  if (typeof db.batch === "function") {
    await db.batch(backfillStmts);
  } else {
    for (const stmt of backfillStmts) {
      await stmt.run();
    }
  }

  try {
    await db
      .prepare(
        `UPDATE herma_worker_lease_telemetry
         SET model_hint = REPLACE(
           CASE
             WHEN LOWER(TRIM(model_hint)) LIKE '%/%' THEN LOWER(TRIM(SUBSTR(model_hint, INSTR(model_hint, '/') + 1)))
             ELSE LOWER(TRIM(model_hint))
           END,
           '_',
           '-'
         )
         WHERE model_hint != '' AND (model_hint != LOWER(TRIM(model_hint)) OR model_hint LIKE '%/%' OR model_hint LIKE '%_%')`
      )
      .run();
  } catch {
    // telemetry table optional in mocked unit environments
  }
}

export function computeSetupSignature({
  harnessTier = "tier_2_sandboxed_chat_worker",
  modelHint = "",
  transportMode = "http_json",
  toolsAvailable = null,
} = {}) {
  const family = canonicalizeModelFamily(modelHint);
  const tools = Array.isArray(toolsAvailable) && toolsAvailable.length > 0
    ? Array.from(new Set(toolsAvailable.map((t) => String(t || "").trim()).filter(Boolean))).sort()
    : defaultToolsForHarnessTier(harnessTier, transportMode);
  const cleanTransport = String(transportMode || "http_json").trim().toLowerCase() || "http_json";
  return `${harnessTier}|${family}|${cleanTransport}|[${tools.join(",")}]`;
}

export function computeReliabilityLcbMilli(successes = 0, failures = 0) {
  const g = TAXONOMY_AFFINITY_FEEDBACK_GRID;
  const a = Number(g.prior_alpha + Math.max(0, Number(successes || 0)));
  const b = Number(g.prior_beta + Math.max(0, Number(failures || 0)));
  const total = a + b;
  const mean = a / total;
  const variance = (a * b) / (total * total * (total + 1));
  const z = g.confidence_z_milli / g.milli_divisor;
  const lcb = Math.max(0, Math.min(1, mean - z * Math.sqrt(variance)));
  return Math.round(lcb * g.milli_divisor);
}

export function computeResourceEfficiencyMilli({
  successes = 0,
  emaWallMs = 0,
  emaTokens = 0,
  emaQualityMilli = 0,
} = {}) {
  const g = TAXONOMY_AFFINITY_FEEDBACK_GRID;
  if (Number(successes || 0) <= 0) {
    return Math.floor(g.milli_divisor / g.half_divisor);
  }
  const qNorm = Math.max(
    0,
    Math.min(1, Number(emaQualityMilli || g.default_quality_milli) / g.milli_divisor)
  );
  const speedFactor = g.reference_wall_ms / (g.reference_wall_ms + Math.max(1, Number(emaWallMs || g.default_wall_ms_estimate)));
  const tokenFactor = g.reference_tokens / (g.reference_tokens + Math.max(1, Number(emaTokens || g.default_tokens_estimate)));
  const combined = Math.max(0, Math.min(1, qNorm * (speedFactor + tokenFactor)));
  return Math.round(combined * g.milli_divisor);
}

export function computeCompositeEfficiencyConfidenceMilli(stats = {}) {
  const g = TAXONOMY_AFFINITY_FEEDBACK_GRID;
  const relLcb = computeReliabilityLcbMilli(stats.successes, stats.failures);
  const resEff = computeResourceEfficiencyMilli(stats);
  return {
    reliability_lcb_milli: relLcb,
    resource_efficiency_milli: resEff,
    efficiency_confidence_milli: Math.floor((relLcb * resEff) / g.milli_divisor),
  };
}

export async function recordWorkerAndSetupEfficiencyOutcome(
  db,
  {
    workerUuid = "",
    harnessTier = "tier_2_sandboxed_chat_worker",
    modelHint = "",
    transportMode = "http_json",
    toolsAvailable = null,
    category = "general",
    stepMode = "atomic_cognitive_step",
    succeeded = true,
    wallMs = 0,
    tokensUsed = 0,
    qualityMilli = TAXONOMY_AFFINITY_FEEDBACK_GRID.default_quality_milli,
    nowIso = new Date().toISOString(),
  } = {}
) {
  if (!db || !workerUuid) return null;
  await ensureTaxonomyAffinityAndFeedbackSchema(db);
  const g = TAXONOMY_AFFINITY_FEEDBACK_GRID;
  const cleanCat = String(category || "general").trim().toLowerCase().slice(0, 64) || "general";
  const cleanStep = String(stepMode || "atomic_cognitive_step").trim().toLowerCase() || "atomic_cognitive_step";
  const modelFam = canonicalizeModelFamily(modelHint);
  const setupSig = computeSetupSignature({ harnessTier, modelHint, transportMode, toolsAvailable });
  const safeWall = Math.max(1, Math.round(Number(wallMs || g.default_wall_ms_estimate)));
  const safeTokens = Math.max(1, Math.round(Number(tokensUsed || g.default_tokens_estimate)));
  const safeQual = Math.max(100, Math.min(g.milli_divisor, Math.round(Number(qualityMilli || g.default_quality_milli))));

  const targets = [
    { kind: "worker", id: String(workerUuid), key: `worker::${workerUuid}::${cleanCat}::${cleanStep}` },
    { kind: "setup", id: setupSig, key: `setup::${setupSig}::${cleanCat}::${cleanStep}` },
  ];

  let workerMetrics = null;
  for (const t of targets) {
    const existing = await db
      .prepare("SELECT * FROM herma_worker_setup_slice_stats WHERE slice_key = ? LIMIT 1")
      .bind(t.key)
      .first();

    let nextSucc = Number(existing?.successes || 0);
    let nextFail = Number(existing?.failures || 0);
    let nextWall = Number(existing?.ema_wall_ms || 0);
    let nextTok = Number(existing?.ema_tokens || 0);
    let nextQual = Number(existing?.ema_quality_milli || 0);

    if (succeeded) {
      nextSucc += 1;
      const keep = g.ewma_keep_milli;
      const fresh = g.milli_divisor - keep;
      nextWall = nextWall <= 0 ? safeWall : Math.floor((keep * nextWall + fresh * safeWall) / g.milli_divisor);
      nextTok = nextTok <= 0 ? safeTokens : Math.floor((keep * nextTok + fresh * safeTokens) / g.milli_divisor);
      nextQual = nextQual <= 0 ? safeQual : Math.floor((keep * nextQual + fresh * safeQual) / g.milli_divisor);
    } else {
      nextFail += 1;
    }

    await db
      .prepare(
        `INSERT OR REPLACE INTO herma_worker_setup_slice_stats
         (slice_key, entity_kind, entity_id, harness_tier, canonical_model_family, transport_mode,
          category, step_mode, successes, failures, ema_wall_ms, ema_tokens, ema_quality_milli, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        t.key,
        t.kind,
        t.id,
        harnessTier,
        modelFam,
        String(transportMode || "http_json"),
        cleanCat,
        cleanStep,
        nextSucc,
        nextFail,
        nextWall,
        nextTok,
        nextQual,
        nowIso
      )
      .run();

    if (t.kind === "worker") {
      workerMetrics = computeCompositeEfficiencyConfidenceMilli({
        successes: nextSucc,
        failures: nextFail,
        emaWallMs: nextWall,
        emaTokens: nextTok,
        emaQualityMilli: nextQual,
      });
    }
  }

  return {
    worker_uuid: workerUuid,
    setup_signature: setupSig,
    canonical_model_family: modelFam,
    ...(workerMetrics || {}),
  };
}

/**
 * Scores a candidate durable queue task for a claiming worker using:
 * 1. `preferred_worker_setup` (`preferred_worker_uuids`, `preferred_harness_tiers`, `required_tools`, `min_context_tokens`, `preferred_model_families`)
 * 2. Sample-size-calibrated efficiency confidence (`reliability_lcb_milli * resource_efficiency_milli`)
 * 3. Ricardian comparative advantage (preventing heavy `tier_3`/`tier_4` CLI workers from cannibalizing light `atomic_cognitive_step` tasks when scarce `atomic_build_step` tasks are ready!)
 * 4. Strict `drafter != reviewer` exclusion on feedback peer-review verbs (`verb_fbk_review_*`).
 */
export function evaluateTaskWorkerAffinity({
  candidateRow = {},
  workerProfile = {},
  workerSetupOverride = null,
  hasScarceReadyBuildTasks = false,
  workerSliceMap = null,
  setupSliceMap = null,
  fleetBaselineMilli = 500,
} = {}) {
  const g = TAXONOMY_AFFINITY_FEEDBACK_GRID;
  const parsedCaps = parseRequiredCapabilitiesAndSetup(candidateRow.required_capabilities_json, candidateRow);
  const pref = parsedCaps.preferred_worker_setup;

  const callerUuid = String(workerProfile.worker_uuid || "").trim();
  const callerAgent = String(workerProfile.agent_id || "").trim().toLowerCase();

  // Enforce drafter != reviewer on feedback & object peer-review verification tasks (`verb_fbk_review_*`, `verb_peer_review_*`)
  const excludedUuids = pref.excluded_reporter_worker_uuids || [];
  const excludedAgents = pref.excluded_reporter_agent_ids || [];
  const taskIdStr = String(candidateRow.task_id || "");
  const isFeedbackReviewTask =
    taskIdStr.startsWith("verb_fbk_review_") || taskIdStr.startsWith("verb_peer_review_");
  if (
    (callerUuid && excludedUuids.includes(callerUuid)) ||
    (callerAgent && excludedAgents.includes(callerAgent)) ||
    (isFeedbackReviewTask &&
      ((callerUuid && candidateRow.producer_worker_uuid === callerUuid) ||
        (callerAgent && String(candidateRow.producer_agent || "").toLowerCase() === callerAgent)))
  ) {
    return {
      excluded_self_review: true,
      affinity_total_bonus: -10000,
      setup_matches: false,
      preferred_worker_setup: pref,
    };
  }

  const ws = workerSetupOverride && typeof workerSetupOverride === "object" ? workerSetupOverride : {};
  const harnessTier = String(ws.harness_tier || workerProfile.harness_tier || "tier_2_sandboxed_chat_worker");
  const modelHint = canonicalizeModelHint(ws.model_hint || workerProfile.model_hint || "");
  const canonicalModelFam = canonicalizeModelFamily(modelHint);
  const transportMode = String(ws.transport_mode || workerProfile.transport_mode || "http_json");
  const toolsAvailable =
    Array.isArray(ws.tools_available) && ws.tools_available.length > 0
      ? ws.tools_available.map((t) => String(t || "").trim()).filter(Boolean)
      : defaultToolsForHarnessTier(harnessTier, transportMode);
  const contextTokens =
    Number.isFinite(Number(ws.context_tokens)) && Number(ws.context_tokens) > 0
      ? Number(ws.context_tokens)
      : defaultContextTokensForTier(harnessTier);

  const stepMode = String(candidateRow.step_mode || pref.step_mode || "atomic_cognitive_step");
  const category = String(candidateRow.category || "general").toLowerCase();

  let affinityDelta = 0;
  let setupMatches = true;

  if (callerUuid && (pref.preferred_worker_uuids || []).includes(callerUuid)) {
    affinityDelta += g.preferred_worker_exact_bonus;
  }

  const prefTiers = pref.preferred_harness_tiers || [];
  const reqTools = pref.required_tools || [];
  const minCtx = Number(pref.min_context_tokens || 0);
  const prefModels = pref.preferred_model_families || [];

  const tierOk =
    prefTiers.length === 0 ||
    prefTiers.includes(harnessTier) ||
    (harnessTier === "tier_1_lightweight_get" && prefTiers.includes("tier_1_light_chat")) ||
    (harnessTier === "tier_1_light_chat" && prefTiers.includes("tier_1_lightweight_get"));
  const toolSet = new Set(toolsAvailable);
  const toolsOk = reqTools.every((reqT) => toolSet.has(reqT));
  const ctxOk = contextTokens >= minCtx;

  if (tierOk && toolsOk && ctxOk) {
    affinityDelta += g.preferred_setup_match_bonus;
    if (prefModels.length > 0 && prefModels.includes(canonicalModelFam)) {
      affinityDelta += Math.floor(g.preferred_setup_match_bonus / g.half_divisor);
    }
  } else {
    setupMatches = false;
    affinityDelta -= g.setup_mismatch_penalty;
  }

  // Ricardian Comparative Advantage: keep heavy tier_3/tier_4 CLI harnesses focused on scarce atomic_build_step tasks
  // instead of cannibalizing light atomic_cognitive_step tasks when build work is ready!
  const isHeavyCliHarness =
    harnessTier === "tier_3_cli_code_harness" || harnessTier === "tier_4_deep_architect_astra";
  let ricardianDelta = 0;
  if (isHeavyCliHarness && hasScarceReadyBuildTasks) {
    if (stepMode === "atomic_build_step") {
      ricardianDelta += g.ricardian_scarce_build_bonus;
    } else if (
      stepMode === "atomic_cognitive_step" &&
      (prefTiers.includes("tier_1_light_chat") ||
        prefTiers.includes("tier_1_lightweight_get") ||
        prefTiers.includes("tier_2_sandboxed_chat_worker"))
    ) {
      ricardianDelta -= g.ricardian_cannibalization_penalty;
    }
  }

  const setupSig = computeSetupSignature({ harnessTier, modelHint, transportMode, toolsAvailable });
  const wSlice = workerSliceMap?.get(`${callerUuid}::${category}::${stepMode}`) || null;
  const sSlice = setupSliceMap?.get(`${setupSig}::${category}::${stepMode}`) || null;

  const fallbackSuccesses =
    Number(workerProfile.ngo_completed || 0) +
    Number(workerProfile.eval_completed || 0) +
    Number(workerProfile.own_completed || 0);
  const fallbackFailures = Number(workerProfile.timeout_count || 0);

  const setupConf = sSlice
    ? computeCompositeEfficiencyConfidenceMilli({
        successes: sSlice.successes,
        failures: sSlice.failures,
        emaWallMs: sSlice.ema_wall_ms,
        emaTokens: sSlice.ema_tokens,
        emaQualityMilli: sSlice.ema_quality_milli,
      }).efficiency_confidence_milli
    : Math.floor(g.milli_divisor / g.half_divisor);

  let effConfMilli = setupConf;
  let nObs = 0;
  if (wSlice) {
    const indiv = computeCompositeEfficiencyConfidenceMilli({
      successes: wSlice.successes,
      failures: wSlice.failures,
      emaWallMs: wSlice.ema_wall_ms,
      emaTokens: wSlice.ema_tokens,
      emaQualityMilli: wSlice.ema_quality_milli,
    }).efficiency_confidence_milli;
    nObs = Number(wSlice.successes || 0) + Number(wSlice.failures || 0);
    const indivWeightMilli = Math.min(
      g.milli_divisor,
      Math.floor((nObs * g.milli_divisor) / Math.max(1, g.setup_prior_blend_completions))
    );
    effConfMilli = Math.floor(
      (indivWeightMilli * indiv + (g.milli_divisor - indivWeightMilli) * setupConf) / g.milli_divisor
    );
  } else if (fallbackSuccesses + fallbackFailures > 0) {
    const indivFallback = computeCompositeEfficiencyConfidenceMilli({
      successes: fallbackSuccesses,
      failures: fallbackFailures,
      emaWallMs: g.default_wall_ms_estimate,
      emaTokens: g.default_tokens_estimate,
      emaQualityMilli: g.default_quality_milli,
    }).efficiency_confidence_milli;
    nObs = fallbackSuccesses + fallbackFailures;
    const indivWeightMilli = Math.min(
      g.milli_divisor,
      Math.floor((nObs * g.milli_divisor) / Math.max(1, g.setup_prior_blend_completions))
    );
    effConfMilli = Math.floor(
      (indivWeightMilli * indivFallback + (g.milli_divisor - indivWeightMilli) * setupConf) / g.milli_divisor
    );
  }

  const compAdvMilli = effConfMilli - Number(fleetBaselineMilli || 500);
  const confBonus = Math.round(((effConfMilli + compAdvMilli) * g.efficiency_confidence_weight) / g.milli_divisor);
  const explorationBonus = nObs === 0 && setupMatches ? g.exploration_novel_worker_bonus : 0;
  const totalAffinityBonus = affinityDelta + ricardianDelta + confBonus + explorationBonus;

  return {
    excluded_self_review: false,
    setup_matches: setupMatches,
    setup_fit_milli: setupMatches ? g.milli_divisor : Math.max(0, 500 + affinityDelta * 10),
    setup_signature: setupSig,
    canonical_model_family: canonicalModelFam,
    efficiency_confidence_milli: effConfMilli,
    comparative_advantage_milli: compAdvMilli,
    affinity_delta: affinityDelta,
    ricardian_delta: ricardianDelta,
    confidence_bonus: confBonus,
    exploration_bonus: explorationBonus,
    affinity_total_bonus: totalAffinityBonus,
    preferred_worker_setup: pref,
  };
}

export async function buildAffinitySnapshot(db, infraAllowed = false, publicUrl = "https://herma.teleionlabs.com") {
  await ensureTaxonomyAffinityAndFeedbackSchema(db);
  const base = String(publicUrl || "https://herma.teleionlabs.com").replace(/\/+$/, "");
  const visFilter = infraAllowed
    ? "visibility IN ('public_ngo', 'public_commons', 'server_infra')"
    : "visibility IN ('public_ngo', 'public_commons')";
  const g = TAXONOMY_AFFINITY_FEEDBACK_GRID;

  const [taxRow, workersRes, leaseTelRes, sliceRowsRes, readyTasksRes] = await Promise.all([
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM herma_durable_queue WHERE ${visFilter}) AS q_total,
           (SELECT COUNT(*) FROM herma_durable_queue WHERE ${visFilter} AND COALESCE(intent_bucket, '') = '') AS q_missing_intent,
           (SELECT COUNT(*) FROM herma_durable_queue WHERE ${visFilter} AND COALESCE(target_env, '') = '') AS q_missing_env,
           (SELECT COUNT(*) FROM herma_durable_queue WHERE ${visFilter} AND COALESCE(prog_lang, '') = '') AS q_missing_lang,
           (SELECT COUNT(*) FROM herma_durable_queue WHERE ${visFilter} AND COALESCE(deliverable_kind, '') = '') AS q_missing_deliv,
           (SELECT COUNT(*) FROM herma_durable_queue WHERE ${visFilter} AND COALESCE(required_capabilities_json, '') IN ('', '[]', '{}')) AS q_empty_req_caps,
           (SELECT COUNT(*) FROM herma_durable_queue WHERE ${visFilter} AND COALESCE(search_hints_json, '') IN ('', '{}')) AS q_empty_hints,
           (SELECT COUNT(*) FROM herma_task_objects WHERE ${visFilter} AND is_tombstoned = 0) AS o_total,
           (SELECT COUNT(*) FROM herma_task_objects WHERE ${visFilter} AND is_tombstoned = 0 AND COALESCE(intent_bucket, '') = '') AS o_missing_intent,
           (SELECT COUNT(*) FROM herma_task_objects WHERE ${visFilter} AND is_tombstoned = 0 AND COALESCE(target_env, '') = '') AS o_missing_env,
           (SELECT COUNT(*) FROM herma_task_objects WHERE ${visFilter} AND is_tombstoned = 0 AND COALESCE(prog_lang, '') = '') AS o_missing_lang,
           (SELECT COUNT(*) FROM herma_task_objects WHERE ${visFilter} AND is_tombstoned = 0 AND COALESCE(deliverable_kind, '') = '') AS o_missing_deliv,
           (SELECT COUNT(*) FROM herma_task_objects WHERE ${visFilter} AND is_tombstoned = 0 AND COALESCE(search_hints_json, '') IN ('', '{}')) AS o_empty_hints,
           (SELECT COUNT(*) FROM herma_task_objects WHERE visibility IN ('public_ngo', 'public_commons') AND is_tombstoned = 0 AND COALESCE(tessera_synced, 0) = 1) AS o_tessera_synced`
      )
      .first(),
    db
      .prepare(
        `SELECT worker_uuid, agent_id, harness_tier, capability_milli, model_hint, transport_mode,
                calibration_json, iteration_count, ngo_completed, eval_completed, own_completed,
                timeout_count, mean_artifact_bytes, updated_at
         FROM herma_worker_registry
         WHERE COALESCE(is_diagnostic_probe, 0) = 0
         ORDER BY iteration_count DESC, capability_milli DESC
         LIMIT ?`
      )
      .bind(g.affinity_worker_limit * 2)
      .all(),
    db
      .prepare(
        `SELECT worker_uuid, claims_count, completions_count, expired_count, ema_wall_ms
         FROM herma_worker_lease_telemetry
         LIMIT ?`
      )
      .bind(g.affinity_worker_limit * 2)
      .all()
      .catch(() => ({ results: [] })),
    db
      .prepare(
        `SELECT * FROM herma_worker_setup_slice_stats
         ORDER BY successes DESC, updated_at DESC
         LIMIT 200`
      )
      .all(),
    db
      .prepare(
        `SELECT task_id, tier, category, step_mode, priority, title, intent_bucket, target_env,
                prog_lang, deliverable_kind, required_capabilities_json, producer_agent, producer_worker_uuid
         FROM herma_durable_queue
         WHERE state = 'ready' AND ${visFilter}
         ORDER BY (CASE WHEN tier = 'ngo_priority' THEN 0 ELSE 1 END) ASC, priority DESC, id ASC
         LIMIT ?`
      )
      .bind(g.affinity_task_sample_limit)
      .all(),
  ]);

  const leaseMap = new Map();
  for (const r of leaseTelRes?.results || []) {
    leaseMap.set(String(r.worker_uuid), r);
  }

  const workerAggMap = new Map();
  const setupAggMap = new Map();
  for (const s of sliceRowsRes?.results || []) {
    const mapRef = s.entity_kind === "setup" ? setupAggMap : workerAggMap;
    const prev = mapRef.get(s.entity_id) || {
      successes: 0,
      failures: 0,
      wallWeighted: 0,
      tokWeighted: 0,
      qualWeighted: 0,
      harness_tier: s.harness_tier,
      canonical_model_family: s.canonical_model_family,
      transport_mode: s.transport_mode,
    };
    const succ = Number(s.successes || 0);
    prev.successes += succ;
    prev.failures += Number(s.failures || 0);
    prev.wallWeighted += succ * Number(s.ema_wall_ms || g.default_wall_ms_estimate);
    prev.tokWeighted += succ * Number(s.ema_tokens || g.default_tokens_estimate);
    prev.qualWeighted += succ * Number(s.ema_quality_milli || g.default_quality_milli);
    mapRef.set(s.entity_id, prev);
  }

  const workerRankings = [];
  const modelFamilyAgg = new Map();

  for (const w of workersRes?.results || []) {
    const cleanHint = canonicalizeModelHint(w.model_hint);
    const fam = canonicalizeModelFamily(cleanHint || w.agent_id);
    const lt = leaseMap.get(String(w.worker_uuid));
    const sliceAgg = workerAggMap.get(String(w.worker_uuid));

    const regWins =
      Number(w.ngo_completed || 0) + Number(w.eval_completed || 0) + Number(w.own_completed || 0);
    const successes = Math.max(regWins, Number(sliceAgg?.successes || 0), Number(lt?.completions_count || 0));
    const failures = Math.max(
      Number(w.timeout_count || 0),
      Number(sliceAgg?.failures || 0),
      Number(lt?.expired_count || 0)
    );
    const emaWallMs =
      sliceAgg && sliceAgg.successes > 0
        ? Math.round(sliceAgg.wallWeighted / sliceAgg.successes)
        : Number(lt?.ema_wall_ms || g.default_wall_ms_estimate);
    const estTokens =
      sliceAgg && sliceAgg.successes > 0
        ? Math.round(sliceAgg.tokWeighted / sliceAgg.successes)
        : Math.max(
            600,
            Math.round(Number(w.mean_artifact_bytes || 4800) / g.chars_per_estimated_token)
          );
    const emaQual =
      sliceAgg && sliceAgg.successes > 0
        ? Math.round(sliceAgg.qualWeighted / sliceAgg.successes)
        : g.default_quality_milli;

    const metrics = computeCompositeEfficiencyConfidenceMilli({
      successes,
      failures,
      emaWallMs,
      emaTokens: estTokens,
      emaQualityMilli: emaQual,
    });
    const setupSig = computeSetupSignature({
      harnessTier: w.harness_tier,
      modelHint: cleanHint || fam,
      transportMode: w.transport_mode || "http_json",
    });

    const entry = {
      worker_uuid: w.worker_uuid,
      agent_id: w.agent_id,
      harness_tier: w.harness_tier,
      model_hint: cleanHint || null,
      canonical_model_family: fam,
      setup_signature: setupSig,
      successes,
      failures,
      ema_wall_ms: emaWallMs,
      ema_tokens: estTokens,
      reliability_lcb_milli: metrics.reliability_lcb_milli,
      resource_efficiency_milli: metrics.resource_efficiency_milli,
      efficiency_confidence_milli: metrics.efficiency_confidence_milli,
    };
    workerRankings.push(entry);

    if (!setupAggMap.has(setupSig)) {
      setupAggMap.set(setupSig, {
        successes,
        failures,
        wallWeighted: successes * emaWallMs,
        tokWeighted: successes * estTokens,
        qualWeighted: successes * emaQual,
        harness_tier: w.harness_tier,
        canonical_model_family: fam,
        transport_mode: w.transport_mode || "http_json",
      });
    } else if (!sliceRowsRes?.results?.some((s) => s.entity_id === setupSig)) {
      const sa = setupAggMap.get(setupSig);
      sa.successes += successes;
      sa.failures += failures;
      sa.wallWeighted += successes * emaWallMs;
      sa.tokWeighted += successes * estTokens;
      sa.qualWeighted += successes * emaQual;
    }

    const mf = modelFamilyAgg.get(fam) || {
      canonical_model_family: fam,
      worker_count: 0,
      total_completions: 0,
      sum_efficiency_confidence_milli: 0,
    };
    mf.worker_count += 1;
    mf.total_completions += successes;
    mf.sum_efficiency_confidence_milli += metrics.efficiency_confidence_milli;
    modelFamilyAgg.set(fam, mf);
  }

  workerRankings.sort(
    (a, b) =>
      b.efficiency_confidence_milli - a.efficiency_confidence_milli || b.successes - a.successes
  );

  const setupRankings = Array.from(setupAggMap.entries())
    .map(([sig, s]) => {
      const succ = Number(s.successes || 0);
      const emaWallMs = succ > 0 ? Math.round(s.wallWeighted / succ) : g.default_wall_ms_estimate;
      const emaTokens = succ > 0 ? Math.round(s.tokWeighted / succ) : g.default_tokens_estimate;
      const emaQualityMilli = succ > 0 ? Math.round(s.qualWeighted / succ) : g.default_quality_milli;
      const m = computeCompositeEfficiencyConfidenceMilli({
        successes: succ,
        failures: s.failures,
        emaWallMs,
        emaTokens,
        emaQualityMilli,
      });
      return {
        setup_signature: sig,
        harness_tier: s.harness_tier,
        canonical_model_family: s.canonical_model_family,
        transport_mode: s.transport_mode,
        successes: succ,
        failures: Number(s.failures || 0),
        reliability_lcb_milli: m.reliability_lcb_milli,
        resource_efficiency_milli: m.resource_efficiency_milli,
        efficiency_confidence_milli: m.efficiency_confidence_milli,
      };
    })
    .sort(
      (a, b) =>
        b.efficiency_confidence_milli - a.efficiency_confidence_milli || b.successes - a.successes
    );

  const canonicalModelStats = Array.from(modelFamilyAgg.values())
    .map((m) => ({
      canonical_model_family: m.canonical_model_family,
      worker_count: m.worker_count,
      total_completions: m.total_completions,
      mean_efficiency_confidence_milli:
        m.worker_count > 0 ? Math.round(m.sum_efficiency_confidence_milli / m.worker_count) : 500,
    }))
    .sort((a, b) => b.total_completions - a.total_completions || b.worker_count - a.worker_count);

  const readyTasks = readyTasksRes?.results || [];
  const hasScarceBuild = readyTasks.some((t) => t.step_mode === "atomic_build_step");
  const fleetMeanConf =
    workerRankings.length > 0
      ? Math.round(
          workerRankings.reduce((acc, w) => acc + w.efficiency_confidence_milli, 0) /
            workerRankings.length
        )
      : 500;

  const candidateWorkers = workerRankings.slice(0, 15);
  const recommendedPairings = readyTasks.slice(0, 10).map((t) => {
    let bestMatch = null;
    for (const w of candidateWorkers) {
      const ev = evaluateTaskWorkerAffinity({
        candidateRow: t,
        workerProfile: w,
        hasScarceReadyBuildTasks: hasScarceBuild,
        fleetBaselineMilli: fleetMeanConf,
      });
      if (ev.excluded_self_review) continue;
      const totalScore = Number(t.priority || 60) + ev.affinity_total_bonus;
      if (!bestMatch || totalScore > bestMatch.total_score) {
        bestMatch = {
          worker_uuid: w.worker_uuid,
          agent_id: w.agent_id,
          harness_tier: w.harness_tier,
          canonical_model_family: w.canonical_model_family,
          total_score: totalScore,
          setup_matches: ev.setup_matches,
          efficiency_confidence_milli: ev.efficiency_confidence_milli,
          comparative_advantage_milli: ev.comparative_advantage_milli,
          ricardian_delta: ev.ricardian_delta,
        };
      }
    }
    const parsedCaps = parseRequiredCapabilitiesAndSetup(t.required_capabilities_json, t);
    return {
      task_id: t.task_id,
      tier: t.tier,
      step_mode: t.step_mode,
      intent_bucket: t.intent_bucket,
      target_env: t.target_env,
      prog_lang: t.prog_lang,
      deliverable_kind: t.deliverable_kind,
      title: t.title,
      preferred_worker_setup: parsedCaps.preferred_worker_setup,
      recommended_worker: bestMatch,
    };
  });

  return {
    ok: true,
    schema: g.affinity_schema_version,
    gateway_grid_schema: "herma.priority_work_gateway.grid.v6_8",
    schema_sentinel: "v6_10",
    formulas: {
      reliability_lcb_milli:
        "Beta(prior_alpha=2 + successes, prior_beta=1 + failures) one-sided z=1.645 lower confidence bound so 40/40 outranks 1/1",
      resource_efficiency_milli:
        "clamp(ema_quality_norm * (8000 / (8000 + ema_wall_ms) + 6000 / (6000 + ema_tokens)), 0, 1) * 1000",
      efficiency_confidence_milli: "(reliability_lcb_milli * resource_efficiency_milli) // 1000 blended with setup_signature prior",
      ricardian_comparative_advantage:
        "Prevents heavy tier_3/tier_4 CLI harnesses from cannibalizing light atomic_cognitive_step tasks when scarce atomic_build_step tasks are ready",
    },
    taxonomy_completeness: {
      durable_queue: {
        total_rows: Number(taxRow?.q_total || 0),
        missing_intent_bucket: Number(taxRow?.q_missing_intent || 0),
        missing_target_env: Number(taxRow?.q_missing_env || 0),
        missing_prog_lang: Number(taxRow?.q_missing_lang || 0),
        missing_deliverable_kind: Number(taxRow?.q_missing_deliv || 0),
        empty_required_capabilities_json: Number(taxRow?.q_empty_req_caps || 0),
        empty_search_hints_json: Number(taxRow?.q_empty_hints || 0),
      },
      task_objects: {
        total_active_rows: Number(taxRow?.o_total || 0),
        missing_intent_bucket: Number(taxRow?.o_missing_intent || 0),
        missing_target_env: Number(taxRow?.o_missing_env || 0),
        missing_prog_lang: Number(taxRow?.o_missing_lang || 0),
        missing_deliverable_kind: Number(taxRow?.o_missing_deliv || 0),
        empty_search_hints_json: Number(taxRow?.o_empty_hints || 0),
        public_tessera_synced_rows: Number(taxRow?.o_tessera_synced || 0),
      },
    },
    canonical_model_families: canonicalModelStats,
    canonical_model_stats: canonicalModelStats,
    setup_efficiency_rankings: setupRankings.slice(0, g.affinity_worker_limit),
    setup_signature_rankings: setupRankings.slice(0, g.affinity_worker_limit),
    worker_efficiency_rankings: workerRankings.slice(0, g.affinity_worker_limit),
    worker_rankings: workerRankings.slice(0, g.affinity_worker_limit),
    recommended_task_worker_pairings: recommendedPairings,
    related_endpoints: {
      claim_url: `${base}/q/claim`,
      routing_url: `${base}/q/routing`,
      feedback_url: `${base}/q/feedback`,
      proposals_url: `${base}/q/proposals`,
    },
  };
}

export function classifyFeedbackSignal(rawText = "", explicitKind = "", httpStatus = null) {
  const g = TAXONOMY_AFFINITY_FEEDBACK_GRID;
  let kind = String(explicitKind || "").trim().toLowerCase();
  if (kind === "better_way" || kind === "alternative_architecture") {
    kind = "better_or_alternative_way";
  } else if (kind === "taxonomy_gap") {
    kind = "data_inconsistency";
  }
  const lower = String(rawText || "").toLowerCase();
  const statusNum = httpStatus != null && httpStatus !== "" ? Number(httpStatus) : 0;

  if (!ALL_FEEDBACK_SIGNAL_KINDS.has(kind)) {
    if (
      statusNum >= g.http_bad_request ||
      /(404|409|413|500|crash|exception|broken|\bbug\b|\berror\b)/.test(lower)
    ) {
      kind = "bug_or_error";
    } else if (/(inconsistent|mismatch|missing|drift|untagged|empty)/.test(lower)) {
      kind = "data_inconsistency";
    } else if (/(slow|latency|timeout|waste|token|bottleneck|overhead)/.test(lower)) {
      kind = "efficiency_concern";
    } else if (/(alternative|instead|better way|replace|swap|redesign|comparative)/.test(lower)) {
      kind = "better_or_alternative_way";
    } else if (/(dpo|sft|training|lora|dora|preference pair)/.test(lower)) {
      kind = "training_signal";
    } else {
      kind = "general_improvement_observation";
    }
  }

  let severityMilli = g.low_severity_milli;
  if (kind === "bug_or_error" || statusNum >= g.http_bad_request) {
    severityMilli = g.high_severity_milli;
  } else if (
    kind === "data_inconsistency" ||
    kind === "efficiency_concern" ||
    kind === "better_or_alternative_way" ||
    kind === "worker_issue_report"
  ) {
    severityMilli = g.medium_severity_milli;
  } else if (kind === "training_signal") {
    severityMilli = g.feedback_spawn_review_min_severity_milli;
  }

  return { signal_kind: kind, severity_milli: severityMilli };
}

/**
 * Ingests any structured OR freeform catch-all feedback observation (`POST /q/feedback` or `/q/submit`
 * `proactive_observations`), deduplicates by SHA-256 fingerprint, stores/updates a tagged Task Object,
 * mirrors public observations to Tessera (`tessera_synced = 1`), and spawns a deduplicated peer-review
 * / benchmark Verb (`verb_fbk_review_<fp>`, enforcing `drafter != reviewer`).
 */
export async function ingestCatchAllFeedbackObservation(
  db,
  env,
  {
    rawPayload = {},
    cleanAgent = "anonymous-reporter",
    verifiedWorkerUuid = "",
    tokenVerified = false,
    infraAllowed = false,
    publicUrl = "https://herma.teleionlabs.com",
    gatewayOps = null,
    mirrorFn = null,
    autoDiagnosis = null,
    legacyIssueKindMode = false,
  } = {}
) {
  await ensureTaxonomyAffinityAndFeedbackSchema(db);
  const g = TAXONOMY_AFFINITY_FEEDBACK_GRID;
  const base = String(publicUrl || "https://herma.teleionlabs.com").replace(/\/+$/, "");
  const scrub = gatewayOps?.scrubSensitiveText || ((s) => String(s || ""));
  const scrubTokens = (s) =>
    scrub(
      String(s || "").replace(
        /\b(?:hk_(?:wrk|ep|inf)_[A-Za-z0-9_.-]+|hmk_[A-Za-z0-9_.-]+|wt_[a-f0-9]{12,}|tan_[A-Za-z0-9_.-]+)\b/gi,
        "[REDACTED_TOKEN]"
      )
    );

  const p =
    typeof rawPayload === "string"
      ? { observation: rawPayload }
      : rawPayload && typeof rawPayload === "object"
        ? rawPayload
        : {};

  const targetComponent = scrubTokens(
    p.target_component || p.endpoint || p.subsystem || "shared_substrate"
  )
    .trim()
    .toLowerCase()
    .slice(0, 120) || "shared_substrate";

  const freeform = scrubTokens(
    p.observation ||
      p.summary ||
      p.message ||
      p.feedback ||
      p.detail ||
      p.description ||
      p.title ||
      JSON.stringify(p)
  )
    .trim()
    .slice(0, g.max_summary_chars);

  const proposedAlternative = scrubTokens(
    p.proposed_alternative || p.better_way || p.proposed_change || ""
  )
    .trim()
    .slice(0, g.max_summary_chars);

  const explicitSignalKind = String(
    p.signal_kind || (legacyIssueKindMode && !p.observation && !p.proposed_alternative ? "worker_issue_report" : "")
  ).trim();
  const { signal_kind: signalKind, severity_milli: autoSev } = classifyFeedbackSignal(
    `${freeform} ${proposedAlternative}`,
    explicitSignalKind,
    p.http_status
  );
  const severityMilli =
    Number.isFinite(Number(p.severity_milli)) && Number(p.severity_milli) > 0
      ? Math.min(g.milli_divisor, Math.round(Number(p.severity_milli)))
      : autoSev;

  const normTokens = Array.from(
    new Set(
      (`${signalKind} ${targetComponent} ${freeform}`.toLowerCase().match(/[a-z0-9_/]+/g) || []).filter(
        (w) => w.length >= g.min_keyword_chars && !STOPWORDS.has(w)
      )
    )
  )
    .sort()
    .slice(0, g.max_search_keywords);

  const fullFp = await sha256HexV610(`${signalKind}|${targetComponent}|${normTokens.join(" ")}`);
  const fp = fullFp.slice(0, g.id_hex_chars);

  const existingCluster = await db
    .prepare("SELECT * FROM herma_feedback_signal_clusters WHERE fingerprint = ? LIMIT 1")
    .bind(fp)
    .first();

  const sanitizeKey = gatewayOps?.sanitizeObjectKeyPreservingSuffix || ((k) => k.slice(0, g.object_key_max_len));
  const category =
    legacyIssueKindMode && signalKind === "worker_issue_report"
      ? "worker_issue_report"
      : p.issue_kind && !p.signal_kind && !p.observation
        ? "worker_issue_report"
        : "system_feedback_signal";

  const defaultObjKey =
    category === "worker_issue_report"
      ? sanitizeKey(`issue_${String(p.issue_kind || signalKind).replace(/[^a-z0-9_]+/gi, "_")}_${cleanAgent}_${fp}_v1`, g.object_key_max_len)
      : sanitizeKey(`system_feedback_signal_${signalKind}_${fp}_v1`, g.object_key_max_len);

  const objectKey = existingCluster?.object_key || defaultObjKey;
  const reportersSet = new Set(
    existingCluster?.reporters_json ? JSON.parse(existingCluster.reporters_json) : []
  );
  reportersSet.add(cleanAgent);

  const reporterUuidsSet = new Set(
    existingCluster?.reporter_uuids_json ? JSON.parse(existingCluster.reporter_uuids_json) : []
  );
  if (verifiedWorkerUuid) reporterUuidsSet.add(verifiedWorkerUuid);

  const alternativesList = existingCluster?.proposed_alternatives_json
    ? JSON.parse(existingCluster.proposed_alternatives_json)
    : [];
  if (proposedAlternative && !alternativesList.includes(proposedAlternative)) {
    alternativesList.push(proposedAlternative);
  }

  const mergedSeverity = Math.max(Number(existingCluster?.severity_milli || 0), severityMilli);
  const nowIso = new Date().toISOString();
  const visibility =
    infraAllowed && (p.visibility === "server_infra" || p.tier === "infra_private")
      ? "server_infra"
      : "public_commons";

  const enrichedTax = enrichTaxonomyRecord({
    object_key: objectKey,
    category,
    summary: freeform,
    step_mode: "atomic_verification_step",
    labels: [
      category,
      `signal:${signalKind}`,
      `target:${targetComponent.slice(0, 40)}`,
    ],
  });

  const storedPayloadObj = {
    schema: g.feedback_cluster_schema_version,
    fingerprint: fp,
    signal_kind: signalKind,
    issue_kind: p.issue_kind || signalKind,
    target_component: targetComponent,
    endpoint: scrubTokens(p.endpoint || ""),
    http_status: p.http_status != null && p.http_status !== "" ? Number(p.http_status) : null,
    error_code: scrubTokens(p.error_code || p.code || ""),
    payload_bytes: p.payload_bytes != null && p.payload_bytes !== "" ? Number(p.payload_bytes) : null,
    severity_milli: mergedSeverity,
    summary: freeform,
    observation: freeform,
    detail: scrubTokens(p.detail || ""),
    reproduction: scrubTokens(
      typeof p.reproduction === "object" ? JSON.stringify(p.reproduction) : p.reproduction || ""
    ),
    proposed_alternatives: alternativesList,
    distinct_reporters: Array.from(reportersSet),
    authenticated_reporter: Boolean(tokenVerified),
    auto_diagnosis: autoDiagnosis || null,
    reported_at: nowIso,
  };

  const serializedPayload = JSON.stringify(storedPayloadObj);
  const payloadBytes = new TextEncoder().encode(serializedPayload).byteLength;
  const payloadSha = await sha256HexV610(serializedPayload);

  const idxMeta = gatewayOps?.indexSidecarDocument
    ? await gatewayOps.indexSidecarDocument({
        title: objectKey,
        bodyText: `${freeform} ${proposedAlternative}`,
        category,
        labels: enrichedTax.labels,
        inputContract: "proactive_feedback_signal",
        outputContract: category,
        searchHints: enrichedTax.search_hints,
      })
    : {
        simhash64_hex: fp.padEnd(16, "0").slice(0, 16),
        partition_slot: 0,
        input_shape_hash: fp.slice(0, 8),
        output_shape_hash: fp.slice(0, 8),
        lsh_band_0: fp.slice(0, 4),
        lsh_band_1: fp.slice(4, 8),
        content_sha256: payloadSha,
      };

  let tesseraSyncedInt = visibility !== "server_infra" ? 1 : 0;
  if (visibility !== "server_infra" && typeof mirrorFn === "function") {
    try {
      const mOut = await mirrorFn(env, cleanAgent, objectKey, storedPayloadObj, db);
      if (mOut && mOut.synced === false && env?.TESSERA?.fetch) {
        tesseraSyncedInt = 0;
      }
    } catch {
      // keep non-blocking
    }
  }

  await db
    .prepare(
      `INSERT OR REPLACE INTO herma_task_objects
       (object_key, requested_object_key, version_num, category, visibility, producer_agent, source_task_id, summary, payload_json,
        simhash64_hex, sha256_hash, tessera_synced, created_at,
        partition_slot, labels_json, input_shape_hash, output_shape_hash, lsh_band_0, lsh_band_1,
        quality_milli, content_sha256, worker_uuid, generation_depth,
        intent_bucket, opt_goal, target_env, prog_lang, deliverable_kind, search_hints_json,
        chunk_count, total_payload_bytes, verification_verdict, step_mode, reuse_mode)
       VALUES (?, ?, 1, ?, ?, ?, 'feedback_report', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?, ?, ?, ?, ?, 0, ?, 'UNREVIEWED', ?, ?)`
    )
    .bind(
      objectKey,
      objectKey,
      category,
      visibility,
      cleanAgent,
      freeform,
      serializedPayload,
      idxMeta.simhash64_hex,
      payloadSha,
      tesseraSyncedInt,
      nowIso,
      idxMeta.partition_slot,
      JSON.stringify(enrichedTax.labels),
      idxMeta.input_shape_hash,
      idxMeta.output_shape_hash,
      idxMeta.lsh_band_0,
      idxMeta.lsh_band_1,
      idxMeta.content_sha256,
      verifiedWorkerUuid || "",
      enrichedTax.intent_bucket,
      enrichedTax.opt_goal,
      enrichedTax.target_env,
      enrichedTax.prog_lang,
      enrichedTax.deliverable_kind,
      enrichedTax.search_hints_json,
      payloadBytes,
      enrichedTax.step_mode,
      enrichedTax.reuse_mode
    )
    .run();

  // Spawn a deduplicated peer-review / benchmark Verb (`verb_fbk_review_<fp>`, `drafter != reviewer`)
  // whenever actionable!
  const shouldSpawnReview =
    ACTIONABLE_FEEDBACK_SIGNAL_KINDS.has(signalKind) ||
    mergedSeverity >= g.feedback_spawn_review_min_severity_milli;

  let reviewVerbId = existingCluster?.review_verb_id || "";
  let spawnedReviewVerb = null;

  if (shouldSpawnReview && visibility !== "server_infra") {
    reviewVerbId = reviewVerbId || `verb_fbk_review_${fp}`;
    const existingVerb = await db
      .prepare("SELECT task_id, state FROM herma_durable_queue WHERE task_id = ? LIMIT 1")
      .bind(reviewVerbId)
      .first();

    const prio =
      mergedSeverity >= g.high_severity_milli ? g.high_severity_priority : g.default_priority;
    const verbTitle = `Peer-Review & Benchmark [${signalKind}] on ${targetComponent} (${fp})`;
    const verbPrompt =
      `Independently reproduce, test, and benchmark [${signalKind}] reported on '${targetComponent}': ${freeform}` +
      (proposedAlternative ? ` | Proposed alternative to benchmark: ${proposedAlternative}` : "") +
      ` | Inspect GET ${base}/q/object/${encodeURIComponent(objectKey)} (reviewer MUST NOT equal original reporter: ${Array.from(reportersSet).join(", ")}). Submit empirical verification results, benchmark numbers, and an evaluations entry.`;

    const verbTax = enrichTaxonomyRecord({
      task_id: reviewVerbId,
      tier: "public_general",
      category: "feedback_verification_and_benchmark",
      verb_kind: "eval_and_rank",
      step_mode: "atomic_verification_step",
      title: verbTitle,
      prompt: verbPrompt,
      preferred_worker_setup: {
        excluded_reporter_agent_ids: Array.from(reportersSet),
        excluded_reporter_worker_uuids: Array.from(reporterUuidsSet),
      },
    });

    if (!existingVerb) {
      const vIdx = gatewayOps?.indexSidecarDocument
        ? await gatewayOps.indexSidecarDocument({
            title: verbTitle,
            bodyText: verbPrompt,
            category: "feedback_verification_and_benchmark",
            labels: verbTax.labels,
            inputContract: "feedback_signal_object",
            outputContract: "verified_peer_benchmark_and_proposal",
            searchHints: verbTax.search_hints,
          })
        : idxMeta;

      await db
        .prepare(
          `INSERT OR IGNORE INTO herma_durable_queue
           (task_id, tier, visibility, priority, state, title, prompt, input_contract, output_contract,
            parent_task_id, branch_label, simhash64_hex, producer_agent, created_at, updated_at,
            partition_slot, category, labels_json, input_shape_hash, output_shape_hash,
            lsh_band_0, lsh_band_1, quality_milli, content_sha256,
            verb_kind, producer_worker_uuid, generation_depth,
            intent_bucket, opt_goal, target_env, prog_lang, deliverable_kind, search_hints_json,
            complexity_milli, min_capability_milli, required_capabilities_json, step_mode)
           VALUES (?, 'public_general', 'public_commons', ?, 'ready', ?, ?, 'feedback_signal_object',
                   'verified_peer_benchmark_and_proposal', 'feedback_report', 'proactive_feedback_review', ?, ?, ?, ?,
                   ?, 'feedback_verification_and_benchmark', ?, ?, ?, ?, ?, 0, ?,
                   'eval_and_rank', ?, 1, ?, ?, ?, ?, ?, ?, 550, 300, ?, 'atomic_verification_step')`
        )
        .bind(
          reviewVerbId,
          prio,
          verbTitle,
          verbPrompt,
          vIdx.simhash64_hex,
          cleanAgent,
          nowIso,
          nowIso,
          vIdx.partition_slot,
          JSON.stringify(verbTax.labels),
          vIdx.input_shape_hash,
          vIdx.output_shape_hash,
          vIdx.lsh_band_0,
          vIdx.lsh_band_1,
          vIdx.content_sha256,
          verifiedWorkerUuid || "",
          verbTax.intent_bucket,
          verbTax.opt_goal,
          verbTax.target_env,
          verbTax.prog_lang,
          verbTax.deliverable_kind,
          verbTax.search_hints_json,
          verbTax.required_capabilities_json
        )
        .run();

      spawnedReviewVerb = {
        task_id: reviewVerbId,
        category: "feedback_verification_and_benchmark",
        step_mode: "atomic_verification_step",
        priority: prio,
        excluded_reporter_ids: Array.from(reportersSet),
        target_feedback_object_key: objectKey,
        task_url: `${base}/q/task/${encodeURIComponent(reviewVerbId)}`,
      };
    } else {
      // Update excluded_reporter_agent_ids / uuids when a second reporter corroborates the same cluster
      await db
        .prepare("UPDATE herma_durable_queue SET required_capabilities_json = ? WHERE task_id = ?")
        .bind(verbTax.required_capabilities_json, reviewVerbId)
        .run();
    }
  }

  const promotedQuorum =
    reportersSet.size >= g.feedback_promote_proposal_quorum ||
    Number(existingCluster?.promoted_to_proposal || 0) === 1
      ? 1
      : 0;
  const emittedTraining =
    signalKind === "training_signal" || promotedQuorum === 1 || Number(existingCluster?.emitted_training_signal || 0) === 1
      ? 1
      : 0;

  await db
    .prepare(
      `INSERT OR REPLACE INTO herma_feedback_signal_clusters
       (fingerprint, object_key, signal_kind, target_component, severity_milli, canonical_summary,
        proposed_alternatives_json, reporters_json, reporter_uuids_json, review_verb_id,
        verified_confirmations_json, promoted_to_proposal, emitted_training_signal, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      fp,
      objectKey,
      signalKind,
      targetComponent,
      mergedSeverity,
      freeform,
      JSON.stringify(alternativesList),
      JSON.stringify(Array.from(reportersSet)),
      JSON.stringify(Array.from(reporterUuidsSet)),
      reviewVerbId || "",
      existingCluster?.verified_confirmations_json || "[]",
      promotedQuorum,
      emittedTraining,
      existingCluster?.created_at || nowIso,
      nowIso
    )
    .run();

  if (promotedQuorum === 1) {
    try {
      await db
        .prepare(
          `INSERT OR IGNORE INTO herma_proposals_registry
           (object_key, proposal_kind, target_subsystem, proposer_agent, proposer_worker_uuid,
            source_task_id, summary, proposal_meta_json, independent_eval_count, mean_eval_quality_milli,
            governance_status, created_at, updated_at)
           VALUES (?, 'infra_proposal', ?, ?, ?, 'feedback_report', ?, ?, ?, 860, 'admin_review_ready', ?, ?)`
        )
        .bind(
          objectKey,
          targetComponent.slice(0, 80),
          cleanAgent,
          verifiedWorkerUuid || cleanAgent,
          freeform.slice(0, 280),
          JSON.stringify({
            proposal_kind: "infra_proposal",
            signal_kind: signalKind,
            target_subsystem: targetComponent,
            problem_evidence: freeform,
            proposed_change: alternativesList[0] || "Peer-corroborated proactive feedback improvement",
            promoted_from_feedback_fingerprint: fp,
          }),
          reportersSet.size,
          nowIso,
          nowIso
        )
        .run();
    } catch {
      // proposals table optional in isolated mocks
    }
  }

  let credAwarded = 0;
  const hasActionableEvidence = Boolean(
    freeform.length >= 12 &&
      (ACTIONABLE_FEEDBACK_SIGNAL_KINDS.has(signalKind) ||
        proposedAlternative ||
        p.reproduction ||
        (p.endpoint && (p.error_code || p.http_status)))
  );
  if (tokenVerified && verifiedWorkerUuid && hasActionableEvidence) {
    try {
      const credRes = await db
        .prepare(
          `INSERT OR IGNORE INTO herma_worker_cred_events
           (event_key, worker_uuid, agent_id, ip_fingerprint, event_kind, points_awarded,
            unblock_bonus, prior_failed_workers, multiplier_milli, evidence_ref, task_id, object_key, detail_json, created_at)
           VALUES (?, ?, ?, '', 'diagnostic_feedback_report', ?, 0, 0, ?, ?, 'feedback_report', ?, ?, ?)`
        )
        .bind(
          `feedback_cred:${fp}:${verifiedWorkerUuid}`,
          verifiedWorkerUuid,
          cleanAgent,
          g.diagnostic_cred_points,
          g.milli_divisor,
          payloadSha,
          objectKey,
          JSON.stringify({ signal_kind: signalKind, target_component: targetComponent, fingerprint: fp }),
          nowIso
        )
        .run();
      if (Number(credRes?.meta?.changes || 0) > 0) {
        credAwarded = g.diagnostic_cred_points;
      }
    } catch {
      credAwarded = 0;
    }
  }

  return {
    ok: true,
    fingerprint: fp,
    stored_object_key: objectKey,
    signal_kind: signalKind,
    severity_milli: mergedSeverity,
    distinct_reporter_count: reportersSet.size,
    review_verb_id: reviewVerbId || null,
    spawned_review_verb: spawnedReviewVerb,
    promoted_to_proposal: Boolean(promotedQuorum),
    emitted_training_signal: Boolean(emittedTraining),
    diagnostic_cred_awarded: credAwarded,
    stored_issue_object: {
      object_key: objectKey,
      category,
      visibility,
      producer_agent: cleanAgent,
      worker_uuid: verifiedWorkerUuid || null,
      summary: freeform,
      step_mode: enrichedTax.step_mode,
      reuse_mode: enrichedTax.reuse_mode,
      intent_bucket: enrichedTax.intent_bucket,
      target_env: enrichedTax.target_env,
      prog_lang: enrichedTax.prog_lang,
      deliverable_kind: enrichedTax.deliverable_kind,
      sha256_hash: payloadSha,
      total_payload_bytes: payloadBytes,
      tessera_synced: tesseraSyncedInt === 1,
      object_url: `${base}/q/object/${encodeURIComponent(objectKey)}`,
      permalink_url: `${base}/c/${encodeURIComponent(objectKey)}`,
    },
  };
}

/**
 * Records an independent peer review when a worker (`reviewer != reporter`) completes `verb_fbk_review_<fp>`,
 * promoting verified signals into `herma_proposals_registry` (`/q/proposals`) and SFT/DPO training signals!
 */
export async function recordIndependentFeedbackReviewOnSubmit(
  db,
  {
    completedTaskId = "",
    reviewerAgent = "",
    reviewerWorkerUuid = "",
    summary = "",
    nowIso = new Date().toISOString(),
  } = {}
) {
  if (!db || !String(completedTaskId || "").startsWith("verb_fbk_review_")) return null;
  await ensureTaxonomyAffinityAndFeedbackSchema(db);
  const g = TAXONOMY_AFFINITY_FEEDBACK_GRID;
  const fp = String(completedTaskId).slice("verb_fbk_review_".length).trim();
  if (!fp) return null;

  const cluster = await db
    .prepare("SELECT * FROM herma_feedback_signal_clusters WHERE fingerprint = ? LIMIT 1")
    .bind(fp)
    .first();
  if (!cluster) return null;

  const reporters = JSON.parse(cluster.reporters_json || "[]");
  const reporterUuids = JSON.parse(cluster.reporter_uuids_json || "[]");
  if (
    reporters.includes(String(reviewerAgent || "").toLowerCase()) ||
    (reviewerWorkerUuid && reporterUuids.includes(String(reviewerWorkerUuid)))
  ) {
    return {
      ok: false,
      reason: "self_review_blocked_drafter_must_not_equal_reviewer",
    };
  }

  const confirmations = new Set(JSON.parse(cluster.verified_confirmations_json || "[]"));
  confirmations.add(reviewerWorkerUuid || reviewerAgent);
  const quorumReached =
    reporters.length + confirmations.size >= g.feedback_promote_proposal_quorum ? 1 : 0;

  await db
    .prepare(
      `UPDATE herma_feedback_signal_clusters
       SET verified_confirmations_json = ?,
           promoted_to_proposal = CASE WHEN ? = 1 THEN 1 ELSE promoted_to_proposal END,
           emitted_training_signal = CASE WHEN ? = 1 THEN 1 ELSE emitted_training_signal END,
           updated_at = ?
       WHERE fingerprint = ?`
    )
    .bind(JSON.stringify(Array.from(confirmations)), quorumReached, quorumReached, nowIso, fp)
    .run();

  if (quorumReached === 1) {
    try {
      const alts = JSON.parse(cluster.proposed_alternatives_json || "[]");
      await db
        .prepare(
          `INSERT OR REPLACE INTO herma_proposals_registry
           (object_key, proposal_kind, target_subsystem, proposer_agent, proposer_worker_uuid,
            source_task_id, summary, proposal_meta_json, independent_eval_count, mean_eval_quality_milli,
            governance_status, created_at, updated_at)
           VALUES (?, 'infra_proposal', ?, ?, ?, ?, ?, ?, ?, 890, 'admin_review_ready', ?, ?)`
        )
        .bind(
          cluster.object_key,
          String(cluster.target_component || "shared_substrate").slice(0, 80),
          reporters[0] || reviewerAgent,
          reporterUuids[0] || reviewerWorkerUuid,
          completedTaskId,
          String(cluster.canonical_summary || summary).slice(0, 280),
          JSON.stringify({
            proposal_kind: "infra_proposal",
            signal_kind: cluster.signal_kind,
            target_subsystem: cluster.target_component,
            problem_evidence: cluster.canonical_summary,
            proposed_change: alts[0] || summary,
            peer_verified_by: Array.from(confirmations),
            sft_dpo_feedback_ready: true,
          }),
          confirmations.size,
          cluster.created_at || nowIso,
          nowIso
        )
        .run();
    } catch {
      // ignore if proposals table absent
    }
  }

  return {
    ok: true,
    verified: true,
    fingerprint: fp,
    object_key: cluster.object_key,
    verified_confirmations: confirmations.size,
    promoted_to_proposal: quorumReached === 1,
    promoted_proposal_key: quorumReached === 1 ? cluster.object_key : null,
    emitted_training_signal: quorumReached === 1,
  };
}
