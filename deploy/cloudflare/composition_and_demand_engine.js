// Universal Task-Object Reuse Graph, Interface Composer & Adaptive Demand-Driven Prioritizer (`/q/graph`, `/q/compose`, `/q/demand`)
//
// Operates strictly over universal `Task` (`herma_durable_queue`) and `Task Object` (`herma_task_objects`) primitives
// with zero bespoke entity classes. Adaptively prioritizes high-leverage multi-audience deliverables --
// Muse templates (`muse_template`), GrokBot templates (`grokbot_template`), Duet templates (`duet_template`),
// Skill Packs (`skill_pack`), Complete Working-Directory Agent Kits (`portable_agent_kit` with explicit model size,
// context window, max output tokens, token budgets, skills, functions, tools, and tuned NGO + general use cases),
// and Live Update Feeds (`live_update_feed`) -- while maintaining machine-traversable `built_on` / `used_by` edges,
// version-propagation alerts, and verified-payload interface composition.

import { textHasCredential } from "./credential_shapes.js";

export const COMPOSITION_DEMAND_GRID = Object.freeze({
  schema_id: "herma.composition_and_demand.grid.v1",
  audience_reach_min_milli: 0,
  audience_reach_max_milli: 1000,
  audience_reach_default_milli: 350,
  portable_agent_kit_reach_bonus_milli: 280,
  template_pack_reach_bonus_milli: 240,
  live_feed_reach_bonus_milli: 200,
  dual_audience_reach_bonus_milli: 120,
  runtime_tuning_completeness_bonus_milli: 100,
  working_dir_completeness_bonus_milli: 80,
  demand_match_per_hit_milli: 25,
  demand_match_cap_milli: 200,
  reuse_dependent_per_edge_milli: 45,
  reuse_dependent_cap_milli: 240,
  adaptive_priority_boost_max: 14,
  adaptive_priority_reach_divisor_milli: 75,
  unmet_demand_priority_bonus: 4,
  ngo_priority_floor: 80,
  ngo_priority_ceiling: 100,
  public_priority_floor: 1,
  public_priority_ceiling: 89,
  max_edges_per_object: 16,
  default_graph_depth: 3,
  max_graph_depth: 5,
  max_graph_nodes: 80,
  max_compose_objects: 16,
  max_demand_rows: 40,
  signal_key_max_len: 72,
  query_sample_max_len: 160,
  min_signal_token_len: 3,
  max_signal_tokens: 6,
  http_ok: 200,
  http_bad_request: 400,
  http_forbidden: 403,
  http_not_found: 404,
  http_method_not_allowed: 405,
});

export const ALLOWED_OBJECT_EDGE_RELATIONS = new Set([
  "extends",
  "uses",
  "validates",
  "composes",
  "feeds",
  "variant_of",
  "companion",
]);

export function computeReuseWeightedQualityMilli(qualityMilli, reuseCount) {
  const baseQ = Math.max(0, Number(qualityMilli || 0));
  const deps = Math.max(0, Number(reuseCount || 0));
  const bonus = Math.min(
    COMPOSITION_DEMAND_GRID.reuse_dependent_cap_milli,
    deps * COMPOSITION_DEMAND_GRID.reuse_dependent_per_edge_milli
  );
  return Math.min(COMPOSITION_DEMAND_GRID.audience_reach_max_milli, Math.round(baseQ + bonus));
}

export const HIGH_REACH_PORTABLE_FORMATS = Object.freeze({
  muse_template: {
    format_id: "muse_template",
    label: "Meta Muse.ai Interactive & Scheduled Agent Template",
    bonus_milli: COMPOSITION_DEMAND_GRID.template_pack_reach_bonus_milli,
    keywords: ["muse_template", "muse template", "muse.ai template", "muse worker template", "muse prompt pack"],
  },
  grokbot_template: {
    format_id: "grokbot_template",
    label: "Grok / GrokBot Routine & Agent Template",
    bonus_milli: COMPOSITION_DEMAND_GRID.template_pack_reach_bonus_milli,
    keywords: ["grokbot_template", "grokbot", "grok template", "grok routine", "grok agent"],
  },
  duet_template: {
    format_id: "duet_template",
    label: "Duet Two-Agent Maker-Checker & Pair-Programming Template",
    bonus_milli: COMPOSITION_DEMAND_GRID.template_pack_reach_bonus_milli,
    keywords: ["duet_template", "duet template", "duet agent", "maker-checker template", "pair-agent"],
  },
  skill_pack: {
    format_id: "skill_pack",
    label: "Portable Skill Pack (SKILL.md + Tools + Functions + Guardrails)",
    bonus_milli: COMPOSITION_DEMAND_GRID.template_pack_reach_bonus_milli,
    keywords: ["skill_pack", "skill pack", "skill.md", "skills pack", "reusable skill"],
  },
  portable_agent_kit: {
    format_id: "portable_agent_kit",
    label: "Complete Working-Directory Agent Kit (Files + Skills + Tools + Model/Context/Token Config)",
    bonus_milli: COMPOSITION_DEMAND_GRID.portable_agent_kit_reach_bonus_milli,
    keywords: [
      "portable_agent_kit",
      "agent_kit",
      "agent kit",
      "working_dir_files",
      "working directory kit",
      "agent_kit_packager",
    ],
  },
  live_update_feed: {
    format_id: "live_update_feed",
    label: "Continuous Multi-Source Update Feed, Radar & Benchmark Ledger",
    bonus_milli: COMPOSITION_DEMAND_GRID.live_feed_reach_bonus_milli,
    keywords: [
      "live_update_feed",
      "update_feed",
      "breakout_radar",
      "discovery_feed",
      "project_registry",
      "feed_check",
      "curator_radar",
    ],
  },
});

const STOP_SIGNAL_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "are",
  "there",
  "any",
  "task",
  "tasks",
  "object",
  "objects",
  "would",
  "help",
  "like",
  "contribute",
  "how",
  "what",
  "can",
  "use",
]);

const INITIALIZED_COMPOSITION_DBS = new WeakSet();

export async function ensureCompositionAndDemandSchema(db) {
  if (db && typeof db === "object" && (db.__hermaSchemaV69Ready || INITIALIZED_COMPOSITION_DBS.has(db))) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS herma_object_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_object_key TEXT NOT NULL,
        target_object_key TEXT NOT NULL,
        relation_kind TEXT NOT NULL DEFAULT 'uses',
        pinned_version_num INTEGER NOT NULL DEFAULT 1,
        pinned_sha256 TEXT NOT NULL DEFAULT '',
        producer_agent TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE(source_object_key, target_object_key, relation_kind)
      )`
    )
    .run();
  await db
    .prepare("CREATE INDEX IF NOT EXISTS idx_herma_obj_edges_src ON herma_object_edges (source_object_key)")
    .run();
  await db
    .prepare("CREATE INDEX IF NOT EXISTS idx_herma_obj_edges_dst ON herma_object_edges (target_object_key)")
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS herma_demand_signals (
        signal_key TEXT PRIMARY KEY,
        raw_sample_query TEXT NOT NULL,
        signal_source TEXT NOT NULL DEFAULT 'search',
        query_count INTEGER NOT NULL DEFAULT 1,
        matched_count INTEGER NOT NULL DEFAULT 0,
        unmet_count INTEGER NOT NULL DEFAULT 0,
        top_matched_object_key TEXT NOT NULL DEFAULT '',
        suggested_deliverable_kind TEXT NOT NULL DEFAULT 'portable_agent_kit',
        updated_at TEXT NOT NULL
      )`
    )
    .run();
  await db
    .prepare(
      "CREATE INDEX IF NOT EXISTS idx_herma_demand_counts ON herma_demand_signals (unmet_count DESC, query_count DESC)"
    )
    .run();

  const alterStmts = [
    "ALTER TABLE herma_task_objects ADD COLUMN reuse_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE herma_task_objects ADD COLUMN demand_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE herma_task_objects ADD COLUMN audience_reach_milli INTEGER NOT NULL DEFAULT 350",
    "ALTER TABLE herma_durable_queue ADD COLUMN audience_reach_milli INTEGER NOT NULL DEFAULT 350",
    "ALTER TABLE herma_durable_queue ADD COLUMN adaptive_priority_boost INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE herma_durable_queue ADD COLUMN demand_signal_key TEXT NOT NULL DEFAULT ''",
  ];
  for (const stmt of alterStmts) {
    try {
      await db.prepare(stmt).run();
    } catch {
      // Column already exists
    }
  }

  // Automatic idempotent backfill of payload-embedded edge declarations (`builds_on`, `built_on`, `uses`, `variant_of`, `companion_objects`, `components`)
  try {
    const legacyEdgeRows = await db
      .prepare(
        `SELECT object_key, producer_agent, payload_json, created_at
         FROM herma_task_objects
         WHERE (
           payload_json LIKE '%"builds_on"%' OR
           payload_json LIKE '%"built_on"%' OR
           payload_json LIKE '%"variant_of"%' OR
           payload_json LIKE '%"companion_objects"%' OR
           payload_json LIKE '%"components"%' OR
           payload_json LIKE '%"uses"%'
         )
         ORDER BY id DESC
         LIMIT ?`
      )
      .bind(COMPOSITION_DEMAND_GRID.max_graph_nodes)
      .all();
    if (db && typeof db === "object") {
      INITIALIZED_COMPOSITION_DBS.add(db);
    }
    for (const lr of legacyEdgeRows?.results || []) {
      try {
        const parsed = JSON.parse(lr.payload_json || "{}");
        if (parsed && typeof parsed === "object") {
          await extractAndPersistObjectEdges(db, {
            sourceObjectKey: String(lr.object_key),
            item: {},
            payloadObj: parsed,
            producerAgent: String(lr.producer_agent || ""),
            nowIso: String(lr.created_at || new Date().toISOString()),
          });
        }
      } catch {
        // skip truncated or non-JSON rows
      }
    }
  } catch {
    if (db && typeof db === "object") {
      INITIALIZED_COMPOSITION_DBS.add(db);
    }
  }
}

export function normalizeSignalKey(rawQuery) {
  const tokens = String(rawQuery || "")
    .toLowerCase()
    .replace(/[^a-z0-9_+-]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= COMPOSITION_DEMAND_GRID.min_signal_token_len && !STOP_SIGNAL_WORDS.has(t));
  const dedup = Array.from(new Set(tokens)).slice(0, COMPOSITION_DEMAND_GRID.max_signal_tokens);
  if (dedup.length === 0) return "";
  return dedup.sort().join("_").slice(0, COMPOSITION_DEMAND_GRID.signal_key_max_len);
}

function inferSuggestedDeliverableKind(textLower) {
  for (const [fmtId, spec] of Object.entries(HIGH_REACH_PORTABLE_FORMATS)) {
    if (spec.keywords.some((kw) => textLower.includes(kw))) {
      return fmtId;
    }
  }
  if (textLower.includes("feed") || textLower.includes("radar") || textLower.includes("new project") || textLower.includes("github")) {
    return "live_update_feed";
  }
  if (textLower.includes("template") || textLower.includes("prompt")) {
    return "muse_template";
  }
  if (textLower.includes("skill") || textLower.includes("mcp") || textLower.includes("tool")) {
    return "skill_pack";
  }
  return "portable_agent_kit";
}

export function classifyHighReachInstance(entity = {}) {
  const pObj = entity.payload && typeof entity.payload === "object" ? entity.payload : {};
  const hints = entity.search_hints && typeof entity.search_hints === "object" ? entity.search_hints : {};
  const facets = hints.facet_axes && typeof hints.facet_axes === "object" ? hints.facet_axes : {};
  const labels = Array.isArray(entity.labels) ? entity.labels.map((x) => String(x).toLowerCase()) : [];

  const combinedText = [
    entity.object_key || "",
    entity.task_id || "",
    entity.category || "",
    entity.verb_kind || "",
    entity.deliverable_kind || "",
    facets.deliverable_kind || "",
    entity.title || "",
    entity.summary || "",
    entity.prompt || "",
    labels.join(" "),
  ]
    .join(" ")
    .toLowerCase();

  const matchedFormats = [];
  let maxFormatBonus = 0;
  for (const [fmtId, spec] of Object.entries(HIGH_REACH_PORTABLE_FORMATS)) {
    if (
      entity.category === fmtId ||
      entity.deliverable_kind === fmtId ||
      facets.deliverable_kind === fmtId ||
      spec.keywords.some((kw) => combinedText.includes(kw))
    ) {
      matchedFormats.push(fmtId);
      if (spec.bonus_milli > maxFormatBonus) {
        maxFormatBonus = spec.bonus_milli;
      }
    }
  }

  const catLower = String(entity.category || "").toLowerCase();
  if (catLower === "reuse_graph" || catLower === "composition" || catLower === "composition_spec") {
    if (!matchedFormats.includes(catLower)) {
      matchedFormats.push(catLower);
    }
    maxFormatBonus = Math.max(maxFormatBonus, COMPOSITION_DEMAND_GRID.live_feed_reach_bonus_milli);
  }

  const runtimeTuning =
    (pObj.runtime_tuning && typeof pObj.runtime_tuning === "object" && pObj.runtime_tuning) ||
    (pObj.token_configuration && typeof pObj.token_configuration === "object" && pObj.token_configuration) ||
    (pObj.model_config && typeof pObj.model_config === "object" && pObj.model_config) ||
    null;

  const hasExplicitRuntimeTuning = Boolean(
    runtimeTuning &&
      (runtimeTuning.context_window_tokens ||
        runtimeTuning.max_output_tokens ||
        runtimeTuning.min_model_params_b ||
        runtimeTuning.model_size ||
        runtimeTuning.token_budget_config ||
        runtimeTuning.recommended_model)
  );

  const workingDirFiles =
    (pObj.working_dir_files && typeof pObj.working_dir_files === "object" && pObj.working_dir_files) ||
    (pObj.files && typeof pObj.files === "object" && !Array.isArray(pObj.files) && pObj.files) ||
    null;
  const hasWorkingDirTree = Boolean(workingDirFiles && Object.keys(workingDirFiles).length > 0);

  const hasDualAudience = Boolean(
    (Array.isArray(pObj.tuned_use_cases) && pObj.tuned_use_cases.length >= 2) ||
      (combinedText.includes("ngo") &&
        (combinedText.includes("general") ||
          combinedText.includes("enterprise") ||
          combinedText.includes("developer") ||
          combinedText.includes("engineering") ||
          combinedText.includes("non-ngo"))) ||
      labels.includes("dual_audience") ||
      labels.includes("universal_kit")
  );

  let reachMilli = COMPOSITION_DEMAND_GRID.audience_reach_default_milli + maxFormatBonus;
  if (hasExplicitRuntimeTuning) {
    reachMilli += COMPOSITION_DEMAND_GRID.runtime_tuning_completeness_bonus_milli;
  }
  if (hasWorkingDirTree) {
    reachMilli += COMPOSITION_DEMAND_GRID.working_dir_completeness_bonus_milli;
  }
  if (hasDualAudience) {
    reachMilli += COMPOSITION_DEMAND_GRID.dual_audience_reach_bonus_milli;
  }
  reachMilli = Math.max(
    COMPOSITION_DEMAND_GRID.audience_reach_min_milli,
    Math.min(COMPOSITION_DEMAND_GRID.audience_reach_max_milli, Math.round(reachMilli))
  );

  const excessReach = Math.max(0, reachMilli - COMPOSITION_DEMAND_GRID.audience_reach_default_milli);
  const adaptivePriorityBoost = Math.min(
    COMPOSITION_DEMAND_GRID.adaptive_priority_boost_max,
    Math.round(excessReach / COMPOSITION_DEMAND_GRID.adaptive_priority_reach_divisor_milli)
  );

  return {
    matched_formats: matchedFormats,
    primary_format: matchedFormats[0] || null,
    has_explicit_runtime_tuning: hasExplicitRuntimeTuning,
    has_working_dir_tree: hasWorkingDirTree,
    has_dual_ngo_and_general_utility: hasDualAudience,
    audience_reach_milli: reachMilli,
    adaptive_priority_boost: adaptivePriorityBoost,
  };
}

export function clampAdaptiveTierPriority(tier, rawPriority, boost = 0) {
  const floor =
    tier === "ngo_priority"
      ? COMPOSITION_DEMAND_GRID.ngo_priority_floor
      : COMPOSITION_DEMAND_GRID.public_priority_floor;
  const ceiling =
    tier === "infra_private"
      ? COMPOSITION_DEMAND_GRID.ngo_priority_ceiling
      : tier === "ngo_priority"
        ? COMPOSITION_DEMAND_GRID.ngo_priority_ceiling
        : COMPOSITION_DEMAND_GRID.public_priority_ceiling;
  return Math.max(floor, Math.min(ceiling, Math.round(Number(rawPriority || floor) + Number(boost || 0))));
}

export async function recordOrganicDemandSignal(
  db,
  { queryText = "", source = "search", matchCount = 0, topObjectKey = "", nowIso = new Date().toISOString() } = {}
) {
  // This table is public through /q/demand, so something shaped like a credential is never written to it.
  if (textHasCredential(queryText)) return null;
  await ensureCompositionAndDemandSchema(db);
  const sigKey = normalizeSignalKey(queryText);
  if (!sigKey) return null;

  const sample = String(queryText || "").trim().slice(0, COMPOSITION_DEMAND_GRID.query_sample_max_len);
  const suggestedFmt = inferSuggestedDeliverableKind(sample.toLowerCase());
  const matchedInc = matchCount > 0 ? 1 : 0;
  const unmetInc = matchCount === 0 ? 1 : 0;

  await db
    .prepare(
      `INSERT INTO herma_demand_signals
       (signal_key, raw_sample_query, signal_source, query_count, matched_count, unmet_count, top_matched_object_key, suggested_deliverable_kind, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
       ON CONFLICT(signal_key) DO UPDATE SET
         query_count = query_count + 1,
         matched_count = matched_count + excluded.matched_count,
         unmet_count = unmet_count + excluded.unmet_count,
         top_matched_object_key = CASE WHEN excluded.top_matched_object_key != '' THEN excluded.top_matched_object_key ELSE herma_demand_signals.top_matched_object_key END,
         updated_at = excluded.updated_at`
    )
    .bind(sigKey, sample, String(source || "search"), matchedInc, unmetInc, String(topObjectKey || ""), suggestedFmt, nowIso)
    .run();

  if (topObjectKey) {
    await db
      .prepare("UPDATE herma_task_objects SET demand_count = COALESCE(demand_count, 0) + 1 WHERE object_key = ?")
      .bind(String(topObjectKey))
      .run();
  }
  return sigKey;
}

export async function computeDemandBoostForText(db, text) {
  await ensureCompositionAndDemandSchema(db);
  const sigKey = normalizeSignalKey(text);
  if (!sigKey) return { signal_key: "", demand_boost: 0, demand_hits: 0 };

  const exact = await db
    .prepare("SELECT signal_key, query_count, unmet_count FROM herma_demand_signals WHERE signal_key = ? LIMIT 1")
    .bind(sigKey)
    .first();
  if (exact) {
    const qHits = Number(exact.query_count || 0);
    const uHits = Number(exact.unmet_count || 0);
    const boost = Math.min(
      COMPOSITION_DEMAND_GRID.unmet_demand_priority_bonus,
      (uHits > 0 ? 2 : 0) + Math.min(2, Math.floor(qHits / 2))
    );
    return { signal_key: sigKey, demand_boost: boost, demand_hits: qHits };
  }
  return { signal_key: sigKey, demand_boost: 0, demand_hits: 0 };
}

function normalizeEdgeTargetKey(rawKey) {
  return String(rawKey || "")
    .trim()
    .replace(/^\/q\/object\//, "")
    .split("?")[0]
    .split("@")[0]
    .replace(/[^A-Za-z0-9_.:-]+/g, "_")
    .slice(0, COMPOSITION_DEMAND_GRID.signal_key_max_len);
}

export async function extractAndPersistObjectEdges(
  db,
  { sourceObjectKey, item = {}, payloadObj = null, producerAgent = "", nowIso = new Date().toISOString() }
) {
  await ensureCompositionAndDemandSchema(db);
  const p = payloadObj && typeof payloadObj === "object" ? payloadObj : {};
  const rawCandidates = [];

  const pushKeys = (val, rel) => {
    if (!val) return;
    const arr = Array.isArray(val) ? val : [val];
    for (const entry of arr) {
      if (typeof entry === "string") {
        rawCandidates.push({ target_object_key: entry, relation_kind: rel });
      } else if (entry && typeof entry === "object") {
        const tKey = entry.target_object_key || entry.target_key || entry.object_key || entry.key || entry.id;
        const eRel = entry.relation_kind || entry.relation || entry.edge || rel;
        if (tKey) {
          rawCandidates.push({ target_object_key: tKey, relation_kind: eRel });
        }
      }
    }
  };

  pushKeys(item.edges || p.edges, "uses");
  pushKeys(item.builds_on || p.builds_on || item.built_on || p.built_on || item.depends_on || p.depends_on, "uses");
  pushKeys(item.uses || p.uses || item.uses_keys || p.uses_keys, "uses");
  pushKeys(item.variant_of || p.variant_of, "variant_of");
  pushKeys(item.companion_objects || p.companion_objects, "companion");
  pushKeys(item.extends || p.extends || item.extends_keys || p.extends_keys, "extends");
  pushKeys(item.validates || p.validates || item.validates_keys || p.validates_keys, "validates");
  pushKeys(item.components || p.components || item.composes || p.composes, "composes");
  pushKeys(item.feeds || p.feeds, "feeds");

  const persistedEdges = [];
  const seen = new Set();
  for (const cand of rawCandidates) {
    if (persistedEdges.length >= COMPOSITION_DEMAND_GRID.max_edges_per_object) break;
    const targetKey = normalizeEdgeTargetKey(cand.target_object_key);
    if (!targetKey || targetKey === sourceObjectKey) continue;
    const rel = ALLOWED_OBJECT_EDGE_RELATIONS.has(String(cand.relation_kind || "").toLowerCase())
      ? String(cand.relation_kind).toLowerCase()
      : "uses";
    const dedupId = `${targetKey}:${rel}`;
    if (seen.has(dedupId)) continue;
    seen.add(dedupId);

    const upstream = await db
      .prepare(
        "SELECT COALESCE(version_num, 1) AS version_num, COALESCE(sha256_hash, '') AS sha256_hash FROM herma_task_objects WHERE object_key = ? ORDER BY id DESC LIMIT 1"
      )
      .bind(targetKey)
      .first();
    const pinnedVer = Number(upstream?.version_num || 1);
    const pinnedSha = String(upstream?.sha256_hash || "");

    await db
      .prepare(
        `INSERT OR REPLACE INTO herma_object_edges
         (source_object_key, target_object_key, relation_kind, pinned_version_num, pinned_sha256, producer_agent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(sourceObjectKey, targetKey, rel, pinnedVer, pinnedSha, String(producerAgent || ""), nowIso)
      .run();

    const cntRow = await db
      .prepare("SELECT COUNT(DISTINCT source_object_key) AS cnt FROM herma_object_edges WHERE target_object_key = ?")
      .bind(targetKey)
      .first();
    const depCount = Number(cntRow?.cnt || 1);

    await db
      .prepare("UPDATE herma_task_objects SET reuse_count = ? WHERE object_key = ?")
      .bind(depCount, targetKey)
      .run();

    persistedEdges.push({
      source_object_key: sourceObjectKey,
      target_object_key: targetKey,
      relation_kind: rel,
      pinned_version_num: pinnedVer,
      pinned_sha256: pinnedSha || null,
      target_exists_in_store: Boolean(upstream),
    });
  }
  return persistedEdges;
}

export async function fetchObjectGraphContext(db, objectKey) {
  await ensureCompositionAndDemandSchema(db);
  const [outRes, inRes] = await Promise.all([
    db
      .prepare(
        `SELECT e.target_object_key, e.relation_kind, e.pinned_version_num, e.pinned_sha256, e.created_at,
                (SELECT MAX(COALESCE(o.version_num, 1)) FROM herma_task_objects o WHERE o.object_key = e.target_object_key) AS latest_target_version,
                (SELECT o2.sha256_hash FROM herma_task_objects o2 WHERE o2.object_key = e.target_object_key ORDER BY o2.id DESC LIMIT 1) AS latest_target_sha256
         FROM herma_object_edges e
         WHERE e.source_object_key = ?
         ORDER BY e.id ASC`
      )
      .bind(objectKey)
      .all(),
    db
      .prepare(
        `SELECT e.source_object_key, e.relation_kind, e.pinned_version_num, e.created_at
         FROM herma_object_edges e
         WHERE e.target_object_key = ?
         ORDER BY e.id DESC`
      )
      .bind(objectKey)
      .all(),
  ]);

  const builtOn = (outRes?.results || []).map((r) => {
    const latestVer = r.latest_target_version != null ? Number(r.latest_target_version) : null;
    const pinnedVer = Number(r.pinned_version_num || 1);
    const staleUpstream = latestVer != null && latestVer > pinnedVer;
    return {
      target_object_key: r.target_object_key,
      relation_kind: r.relation_kind,
      pinned_version_num: pinnedVer,
      latest_target_version: latestVer,
      upstream_newer_version_available: staleUpstream,
      pinned_sha256: r.pinned_sha256 || null,
      latest_target_sha256: r.latest_target_sha256 || null,
    };
  });

  const usedBy = (inRes?.results || []).map((r) => ({
    dependent_object_key: r.source_object_key,
    relation_kind: r.relation_kind,
    pinned_version_num: Number(r.pinned_version_num || 1),
    created_at: r.created_at,
  }));

  const dependentsCount = new Set(usedBy.map((u) => u.dependent_object_key)).size;
  return {
    builds_on: Array.from(new Set(builtOn.map((b) => b.target_object_key))),
    uses: builtOn.filter((b) => b.relation_kind === "uses").map((b) => b.target_object_key),
    variant_of: builtOn.find((b) => b.relation_kind === "variant_of")?.target_object_key || null,
    companion_objects: builtOn.filter((b) => b.relation_kind === "companion").map((b) => b.target_object_key),
    used_by: Array.from(new Set(usedBy.map((u) => u.dependent_object_key))),
    built_on_edges: builtOn,
    used_by_dependents: usedBy,
    dependents_count: dependentsCount,
    stale_upstream_dependencies: builtOn.filter((b) => b.upstream_newer_version_available),
  };
}

export async function handleReuseGraphRequest(request, db, publicUrl, infraAllowed) {
  if (request.method.toUpperCase() !== "GET" && request.method.toUpperCase() !== "HEAD") {
    return { status: COMPOSITION_DEMAND_GRID.http_method_not_allowed, body: { ok: false, error: "method_not_allowed" } };
  }
  await ensureCompositionAndDemandSchema(db);
  const url = new URL(request.url);
  const rootKey = String(url.searchParams.get("root") || url.searchParams.get("key") || "").trim();
  const maxDepth = Math.max(
    1,
    Math.min(
      COMPOSITION_DEMAND_GRID.max_graph_depth,
      Number(url.searchParams.get("depth") || COMPOSITION_DEMAND_GRID.default_graph_depth)
    )
  );
  const visClause = infraAllowed ? "1=1" : "visibility != 'server_infra'";

  let edgesRows = [];
  if (rootKey) {
    const frontier = new Set([rootKey]);
    const visited = new Set([rootKey]);
    const collected = new Map();
    for (let d = 0; d < maxDepth && frontier.size > 0 && visited.size < COMPOSITION_DEMAND_GRID.max_graph_nodes; d += 1) {
      const batchKeys = Array.from(frontier);
      frontier.clear();
      for (const k of batchKeys) {
        const res = await db
          .prepare(
            "SELECT * FROM herma_object_edges WHERE source_object_key = ? OR target_object_key = ? LIMIT ?"
          )
          .bind(k, k, COMPOSITION_DEMAND_GRID.max_edges_per_object * 2)
          .all();
        for (const e of res?.results || []) {
          collected.set(`${e.source_object_key}->${e.target_object_key}:${e.relation_kind}`, e);
          if (!visited.has(e.source_object_key) && visited.size < COMPOSITION_DEMAND_GRID.max_graph_nodes) {
            visited.add(e.source_object_key);
            frontier.add(e.source_object_key);
          }
          if (!visited.has(e.target_object_key) && visited.size < COMPOSITION_DEMAND_GRID.max_graph_nodes) {
            visited.add(e.target_object_key);
            frontier.add(e.target_object_key);
          }
        }
      }
    }
    edgesRows = Array.from(collected.values());
  } else {
    const allEdges = await db
      .prepare("SELECT * FROM herma_object_edges ORDER BY id DESC LIMIT ?")
      .bind(COMPOSITION_DEMAND_GRID.max_graph_nodes)
      .all();
    edgesRows = allEdges?.results || [];
  }

  const nodeKeys = new Set(rootKey ? [rootKey] : []);
  for (const e of edgesRows) {
    nodeKeys.add(e.source_object_key);
    nodeKeys.add(e.target_object_key);
  }

  const nodes = [];
  const nodeVersionMap = new Map();
  for (const nk of Array.from(nodeKeys).slice(0, COMPOSITION_DEMAND_GRID.max_graph_nodes)) {
    const row = await db
      .prepare(
        `SELECT object_key, COALESCE(version_num, 1) AS version_num, category, deliverable_kind, producer_agent,
                quality_milli, COALESCE(reuse_count, 0) AS reuse_count, COALESCE(demand_count, 0) AS demand_count,
                COALESCE(audience_reach_milli, 350) AS audience_reach_milli,
                COALESCE(verification_verdict, 'UNREVIEWED') AS verification_verdict, sha256_hash
         FROM herma_task_objects
         WHERE object_key = ? AND ${visClause}
         ORDER BY id DESC LIMIT 1`
      )
      .bind(nk)
      .first();
    if (row) {
      nodeVersionMap.set(nk, Number(row.version_num || 1));
      nodes.push({
        object_key: row.object_key,
        version_num: Number(row.version_num || 1),
        category: row.category,
        deliverable_kind: row.deliverable_kind || null,
        producer_agent: row.producer_agent,
        reuse_count: Number(row.reuse_count || 0),
        demand_count: Number(row.demand_count || 0),
        audience_reach_milli: Number(row.audience_reach_milli || COMPOSITION_DEMAND_GRID.audience_reach_default_milli),
        verification_verdict: row.verification_verdict,
        object_url: `${publicUrl}/q/object/${encodeURIComponent(row.object_key)}`,
      });
    } else if (!infraAllowed) {
      // Check if missing or hidden
      const anyRow = await db
        .prepare("SELECT visibility FROM herma_task_objects WHERE object_key = ? LIMIT 1")
        .bind(nk)
        .first();
      if (!anyRow) {
        nodes.push({ object_key: nk, external_or_pending_reference: true });
      }
    }
  }

  const formattedEdges = [];
  const versionAlerts = [];
  for (const e of edgesRows) {
    const latestVer = nodeVersionMap.get(e.target_object_key) || null;
    const pinnedVer = Number(e.pinned_version_num || 1);
    const stale = latestVer != null && latestVer > pinnedVer;
    const edgeDoc = {
      source_object_key: e.source_object_key,
      target_object_key: e.target_object_key,
      relation_kind: e.relation_kind,
      pinned_version_num: pinnedVer,
      latest_target_version: latestVer,
      upstream_newer_version_available: stale,
    };
    formattedEdges.push(edgeDoc);
    if (stale) versionAlerts.push(edgeDoc);
  }

  const topReusedRes = await db
    .prepare(
      `SELECT object_key, category, deliverable_kind, COALESCE(reuse_count, 0) AS reuse_count,
              COALESCE(demand_count, 0) AS demand_count, COALESCE(audience_reach_milli, 350) AS audience_reach_milli,
              summary
       FROM herma_task_objects
       WHERE ${visClause}
       ORDER BY reuse_count DESC, audience_reach_milli DESC, quality_milli DESC, id DESC
       LIMIT 12`
    )
    .all();

  return {
    status: COMPOSITION_DEMAND_GRID.http_ok,
    body: {
      ok: true,
      schema: "herma.object_reuse_graph.v1",
      root_object_key: rootKey || null,
      max_depth: maxDepth,
      nodes_count: nodes.length,
      edges_count: formattedEdges.length,
      version_propagation_alerts: versionAlerts,
      nodes,
      edges: formattedEdges,
      top_reused_hubs: topReusedRes?.results || [],
    },
  };
}

export function extractSchemaSurface(objDoc) {
  const p = objDoc?.payload && typeof objDoc.payload === "object" ? objDoc.payload : {};
  const fieldNames = new Set();
  const leafToPaths = new Map();
  const enumMap = new Map();

  const registerField = (fullPath, maybeEnums = null) => {
    const clean = String(fullPath || "").trim();
    if (!clean) return;
    fieldNames.add(clean);
    const leaf = clean.includes(".") ? clean.split(".").pop() : clean;
    if (leaf) {
      const existing = leafToPaths.get(leaf) || [];
      if (!existing.includes(clean)) existing.push(clean);
      leafToPaths.set(leaf, existing);
    }
    if (Array.isArray(maybeEnums) && maybeEnums.length > 0) {
      const strVals = maybeEnums.map(String);
      enumMap.set(clean, strVals);
      if (leaf && !enumMap.has(leaf)) {
        enumMap.set(leaf, strVals);
      }
    }
  };

  const collectFromProperties = (propsObj, prefix = "", depth = 0) => {
    if (!propsObj || typeof propsObj !== "object" || Array.isArray(propsObj)) return;
    if (depth > COMPOSITION_DEMAND_GRID.max_graph_depth) return;
    for (const [fName, fSpec] of Object.entries(propsObj)) {
      const fullPath = prefix ? `${prefix}.${fName}` : fName;
      const specEnums =
        fSpec && typeof fSpec === "object"
          ? Array.isArray(fSpec.enum)
            ? fSpec.enum
            : Array.isArray(fSpec.allowed_values)
              ? fSpec.allowed_values
              : null
          : null;
      registerField(fullPath, specEnums);
      if (fSpec && typeof fSpec === "object" && !Array.isArray(fSpec)) {
        if (fSpec.properties && typeof fSpec.properties === "object") {
          collectFromProperties(fSpec.properties, fullPath, depth + 1);
        } else {
          // Support plain nested schema objects (e.g. `{ capacity: { beds_available: "int", total_beds: "int" } }`)
          const metaKeys = new Set(["type", "description", "enum", "allowed_values", "default", "required", "example", "examples", "format", "minimum", "maximum", "nullable"]);
          const subEntries = Object.entries(fSpec).filter(([k]) => !metaKeys.has(k));
          if (subEntries.length > 0 && subEntries.every(([, v]) => typeof v === "string" || (v && typeof v === "object"))) {
            collectFromProperties(Object.fromEntries(subEntries), fullPath, depth + 1);
          }
        }
      }
    }
  };

  collectFromProperties(p.properties);
  if (p.schema && typeof p.schema === "object") {
    collectFromProperties(p.schema.properties);
    collectFromProperties(p.schema.fields);
  }
  collectFromProperties(p.fields);
  if (Array.isArray(p.fields)) {
    for (const f of p.fields) {
      if (typeof f === "string") registerField(f);
      else if (f && typeof f === "object" && (f.name || f.field)) {
        registerField(String(f.name || f.field), f.enum || f.allowed_values || null);
      }
    }
  }
  if (Array.isArray(p.required_fields)) {
    for (const rf of p.required_fields) registerField(String(rf));
  }
  if (p.field_mapping && typeof p.field_mapping === "object") {
    for (const [k, v] of Object.entries(p.field_mapping)) {
      registerField(k);
      if (typeof v === "string") registerField(v);
      else if (v && typeof v === "object") {
        if (v.target_field || v.canonical_path || v.maps_to) {
          registerField(String(v.target_field || v.canonical_path || v.maps_to), v.enum || v.allowed_values || null);
        }
      }
    }
  }
  if (p.enum_coercion && typeof p.enum_coercion === "object") {
    for (const [k, v] of Object.entries(p.enum_coercion)) {
      if (Array.isArray(v)) registerField(k, v);
      else if (v && typeof v === "object") registerField(k, Array.from(new Set(Object.values(v).map(String))));
      else registerField(k);
    }
  }

  const runtimeTuning =
    (p.runtime_tuning && typeof p.runtime_tuning === "object" && p.runtime_tuning) ||
    (p.token_configuration && typeof p.token_configuration === "object" && p.token_configuration) ||
    null;
  const workingDirFiles =
    (p.working_dir_files && typeof p.working_dir_files === "object" && !Array.isArray(p.working_dir_files) && p.working_dir_files) ||
    null;

  return {
    fields: Array.from(fieldNames),
    leaf_to_paths: Object.fromEntries(leafToPaths.entries()),
    enums: Object.fromEntries(enumMap.entries()),
    runtime_tuning: runtimeTuning,
    working_dir_files: workingDirFiles ? Object.keys(workingDirFiles) : [],
    skills_and_tools: Array.isArray(p.skills_and_tools) ? p.skills_and_tools : [],
    tuned_use_cases: Array.isArray(p.tuned_use_cases) ? p.tuned_use_cases : [],
  };
}

export async function evaluateEdgesInterfaceCompatOnSubmit({
  sourceObjectKey,
  sourcePayload,
  persistedEdges = [],
  lookupTaskObjectByKey,
}) {
  if (!Array.isArray(persistedEdges) || persistedEdges.length === 0 || typeof lookupTaskObjectByKey !== "function") {
    return null;
  }
  const srcSurf = extractSchemaSurface({ payload: sourcePayload });
  const srcFieldSet = new Set(srcSurf.fields);
  const edgeVerdicts = [];
  const truncatedFoundationTargets = [];
  let allVerified = true;
  let totalEnumDivergences = 0;
  let totalPathDivergences = 0;

  for (const edge of persistedEdges) {
    const targetKey = edge.target_object_key;
    const looked = await lookupTaskObjectByKey(targetKey);
    const targetObj = looked?.object || (looked?.ok ? looked : null);
    if (!targetObj || looked?.notFound || looked?.forbidden) {
      allVerified = false;
      edgeVerdicts.push({
        target_object_key: targetKey,
        relation_kind: edge.relation_kind,
        edge_status: "PROVISIONAL",
        reason: "target_missing_or_inaccessible",
      });
      continue;
    }

    const targetVerified = Boolean(targetObj.payload_sha256_verified);
    if (!targetVerified) {
      allVerified = false;
    }
    if (targetObj.integrity_status === "legacy_truncated_json") {
      truncatedFoundationTargets.push(targetObj.object_key);
    }

    const dstSurf = extractSchemaSurface(targetObj);
    const dstFieldSet = new Set(dstSurf.fields);
    const sharedExactFields = srcSurf.fields.filter((f) => dstFieldSet.has(f));
    const pathDivergences = [];
    for (const sf of srcSurf.fields) {
      if (dstFieldSet.has(sf)) continue;
      const leaf = sf.includes(".") ? sf.split(".").pop() : sf;
      const dstPaths = dstSurf.leaf_to_paths[leaf] || [];
      if (dstPaths.length > 0 && !dstPaths.includes(sf)) {
        pathDivergences.push({
          source_field: sf,
          target_nested_paths: dstPaths,
          recommendation: `Add explicit adapter mapping '${sf}' -> '${dstPaths[0]}'.`,
        });
      }
    }

    const enumDivergences = [];
    for (const [eField, srcVals] of Object.entries(srcSurf.enums)) {
      const leaf = eField.includes(".") ? eField.split(".").pop() : eField;
      const dstVals = dstSurf.enums[eField] || dstSurf.enums[leaf] || null;
      if (Array.isArray(dstVals) && dstVals.length > 0) {
        const dstSet = new Set(dstVals.map((v) => String(v).toLowerCase()));
        const unmapped = srcVals.filter((v) => !dstSet.has(String(v).toLowerCase()));
        if (unmapped.length > 0) {
          enumDivergences.push({
            field: eField,
            source_values: srcVals,
            target_values: dstVals,
            unmapped_source_values: unmapped,
            recommendation: "Provide explicit lossless enum_coercion table or preserve unknown state instead of lossy coercion.",
          });
        }
      }
    }

    totalPathDivergences += pathDivergences.length;
    totalEnumDivergences += enumDivergences.length;
    const edgeCertified = targetVerified && pathDivergences.length === 0 && enumDivergences.length === 0;
    edgeVerdicts.push({
      target_object_key: targetObj.object_key,
      relation_kind: edge.relation_kind,
      target_version_num: targetObj.version_num,
      target_payload_sha256_verified: targetVerified,
      target_integrity_status: targetObj.integrity_status,
      edge_status: edgeCertified ? "CERTIFIED" : "PROVISIONAL",
      shared_exact_fields: sharedExactFields,
      path_divergences: pathDivergences,
      enum_divergences: enumDivergences,
    });
  }

  const overallCertified = allVerified && totalEnumDivergences === 0 && totalPathDivergences === 0;
  return {
    source_object_key: sourceObjectKey,
    certification_status: overallCertified ? "CERTIFIED" : "PROVISIONAL",
    all_endpoints_sha256_verified: allVerified,
    path_divergences_count: totalPathDivergences,
    enum_divergences_count: totalEnumDivergences,
    truncated_foundation_targets: Array.from(new Set(truncatedFoundationTargets)),
    edge_verdicts: edgeVerdicts,
  };
}

export async function handleComposeObjectsRequest(request, db, publicUrl, infraAllowed, gatewayOps) {
  await ensureCompositionAndDemandSchema(db);
  const method = request.method.toUpperCase();
  const url = new URL(request.url);
  let rawKeys = [];
  if (method === "GET" || method === "HEAD") {
    const kParam = url.searchParams.get("keys") || url.searchParams.get("objects") || "";
    rawKeys = kParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (method === "POST") {
    try {
      const body = await request.json();
      rawKeys = Array.isArray(body?.object_keys)
        ? body.object_keys
        : Array.isArray(body?.keys)
          ? body.keys
          : [];
    } catch {
      return { status: COMPOSITION_DEMAND_GRID.http_bad_request, body: { ok: false, code: "invalid_json" } };
    }
  } else {
    return { status: COMPOSITION_DEMAND_GRID.http_method_not_allowed, body: { ok: false, error: "method_not_allowed" } };
  }

  const keys = Array.from(new Set(rawKeys.map((k) => String(k).trim()).filter(Boolean))).slice(
    0,
    COMPOSITION_DEMAND_GRID.max_compose_objects
  );
  if (keys.length === 0) {
    return {
      status: COMPOSITION_DEMAND_GRID.http_bad_request,
      body: {
        ok: false,
        code: "missing_object_keys",
        detail: "Provide ?keys=obj_a,obj_b or POST {\"object_keys\":[\"obj_a\",\"obj_b\"]} to verify interface & payload composition.",
      },
    };
  }

  const components = [];
  const missingKeys = [];
  const unverifiedPayloadKeys = [];
  const quarantinedKeys = [];
  const fieldOccurrences = new Map();
  const enumOccurrences = new Map();
  const workingDirOwners = new Map();
  const workingDirCollisions = [];
  let maxMinParamsB = 0;
  let maxContextWindowTokens = 0;
  let maxOutputTokens = 0;
  const mergedSkills = new Set();
  const mergedUseCases = [];

  for (const key of keys) {
    const res = await gatewayOps.lookupTaskObjectByKey(key);
    if (res.forbidden) {
      return { status: COMPOSITION_DEMAND_GRID.http_forbidden, body: { ok: false, code: "forbidden_tier" } };
    }
    const obj = res.object || (res.ok ? res : null);
    if (res.notFound || !obj) {
      missingKeys.push(key);
      continue;
    }
    if (!obj.payload_sha256_verified) {
      unverifiedPayloadKeys.push(obj.object_key);
    }
    const verdict = String(obj.verification_verdict || "UNREVIEWED");
    if (verdict.startsWith("QUARANTINED") || verdict === "VALIDATOR_FAILED" || verdict === "REFUTED") {
      quarantinedKeys.push(obj.object_key);
    }

    const surf = extractSchemaSurface(obj);
    for (const f of surf.fields) {
      const owners = fieldOccurrences.get(f) || [];
      owners.push(obj.object_key);
      fieldOccurrences.set(f, owners);
    }
    for (const [eField, eVals] of Object.entries(surf.enums)) {
      const prev = enumOccurrences.get(eField) || [];
      prev.push({ object_key: obj.object_key, values: eVals });
      enumOccurrences.set(eField, prev);
    }
    for (const pathStr of surf.working_dir_files) {
      if (workingDirOwners.has(pathStr)) {
        workingDirCollisions.push({
          file_path: pathStr,
          first_owner: workingDirOwners.get(pathStr),
          conflicting_owner: obj.object_key,
        });
      } else {
        workingDirOwners.set(pathStr, obj.object_key);
      }
    }
    if (surf.runtime_tuning) {
      maxMinParamsB = Math.max(maxMinParamsB, Number(surf.runtime_tuning.min_model_params_b || 0));
      maxContextWindowTokens = Math.max(
        maxContextWindowTokens,
        Number(surf.runtime_tuning.context_window_tokens || 0)
      );
      maxOutputTokens = Math.max(maxOutputTokens, Number(surf.runtime_tuning.max_output_tokens || 0));
    }
    for (const sk of surf.skills_and_tools) {
      mergedSkills.add(typeof sk === "string" ? sk : JSON.stringify(sk));
    }
    for (const uc of surf.tuned_use_cases) {
      mergedUseCases.push(uc);
    }

    components.push({
      object_key: obj.object_key,
      version_num: obj.version_num,
      category: obj.category,
      payload_sha256_verified: obj.payload_sha256_verified,
      payload_hash_mode: obj.payload_hash_mode,
      verification_verdict: verdict,
      sha256_hash: obj.sha256_hash,
      extracted_fields_count: surf.fields.length,
      working_dir_files_count: surf.working_dir_files.length,
      has_runtime_tuning: Boolean(surf.runtime_tuning),
    });
  }

  const sharedBridgeFields = [];
  for (const [fName, owners] of fieldOccurrences.entries()) {
    if (owners.length >= 2) {
      sharedBridgeFields.push({ field: fName, shared_across_objects: owners });
    }
  }

  const enumConflicts = [];
  for (const [eField, defs] of enumOccurrences.entries()) {
    if (defs.length >= 2) {
      const baseSet = new Set(defs[0].values);
      for (let i = 1; i < defs.length; i += 1) {
        const overlap = defs[i].values.filter((v) => baseSet.has(v));
        if (overlap.length === 0) {
          enumConflicts.push({
            field: eField,
            first: defs[0],
            conflicting: defs[i],
          });
        }
      }
    }
  }

  const integrityGatePassed =
    missingKeys.length === 0 && unverifiedPayloadKeys.length === 0 && quarantinedKeys.length === 0;
  const interfacesCompatible = enumConflicts.length === 0 && workingDirCollisions.length === 0;

  return {
    status: COMPOSITION_DEMAND_GRID.http_ok,
    body: {
      ok: true,
      schema: "herma.object_composition_report.v1",
      composition_admissible: integrityGatePassed && interfacesCompatible,
      integrity_gate: {
        passed: integrityGatePassed,
        rule: "Every composed Task Object must exist, verify its cryptographic payload SHA-256, and not be quarantined.",
        missing_object_keys: missingKeys,
        unverified_payload_keys: unverifiedPayloadKeys,
        quarantined_keys: quarantinedKeys,
      },
      interface_compatibility: {
        passed: interfacesCompatible,
        shared_bridge_fields: sharedBridgeFields,
        enum_conflicts: enumConflicts,
        working_dir_file_collisions: workingDirCollisions,
      },
      composed_runtime_envelope: {
        min_model_params_b: maxMinParamsB || null,
        required_context_window_tokens: maxContextWindowTokens || null,
        recommended_max_output_tokens: maxOutputTokens || null,
        merged_working_dir_files: Array.from(workingDirOwners.entries()).map(([file_path, source_object_key]) => ({
          file_path,
          source_object_key,
        })),
        merged_skills_and_tools_count: mergedSkills.size,
        tuned_use_cases_count: mergedUseCases.length,
      },
      components,
    },
  };
}

export async function handleDemandAndOpportunitiesRequest(request, db, publicUrl, infraAllowed) {
  if (request.method.toUpperCase() !== "GET" && request.method.toUpperCase() !== "HEAD") {
    return { status: COMPOSITION_DEMAND_GRID.http_method_not_allowed, body: { ok: false, error: "method_not_allowed" } };
  }
  await ensureCompositionAndDemandSchema(db);
  const visClause = infraAllowed ? "1=1" : "visibility != 'server_infra'";

  const [signalsRes, highReachObjsRes, highReachTasksRes] = await Promise.all([
    db
      .prepare(
        `SELECT signal_key, raw_sample_query, signal_source, query_count, matched_count, unmet_count,
                top_matched_object_key, suggested_deliverable_kind, updated_at
         FROM herma_demand_signals
         ORDER BY unmet_count DESC, query_count DESC, updated_at DESC
         LIMIT ?`
      )
      .bind(COMPOSITION_DEMAND_GRID.max_demand_rows)
      .all(),
    db
      .prepare(
        `SELECT object_key, category, deliverable_kind, producer_agent, summary,
                COALESCE(audience_reach_milli, 350) AS audience_reach_milli,
                COALESCE(reuse_count, 0) AS reuse_count,
                COALESCE(demand_count, 0) AS demand_count,
                quality_milli, sha256_hash
         FROM herma_task_objects
         WHERE ${visClause}
         ORDER BY audience_reach_milli DESC, reuse_count DESC, demand_count DESC, id DESC
         LIMIT 15`
      )
      .all(),
    db
      .prepare(
        `SELECT task_id, tier, priority, COALESCE(adaptive_priority_boost, 0) AS adaptive_priority_boost,
                COALESCE(audience_reach_milli, 350) AS audience_reach_milli, verb_kind, title
         FROM herma_durable_queue
         WHERE state = 'ready' AND ${visClause}
         ORDER BY adaptive_priority_boost DESC, priority DESC, id ASC
         LIMIT 15`
      )
      .all(),
  ]);

  return {
    status: COMPOSITION_DEMAND_GRID.http_ok,
    body: {
      ok: true,
      schema: "herma.adaptive_demand_and_reach.v1",
      abstraction_note:
        "All templates, skill packs, complete working-directory agent kits, and live feeds are represented strictly as universal Task Objects and Tasks -- dynamically scored on audience_reach_milli, live query demand, and verified reuse edges.",
      encouraged_high_reach_formats: Object.values(HIGH_REACH_PORTABLE_FORMATS).map((f) => ({
        deliverable_kind: f.format_id,
        description: f.label,
        reach_bonus_milli: f.bonus_milli,
        recommended_payload_fields: [
          "working_dir_files",
          "skills_and_tools",
          "tuned_use_cases (NGO + general engineering/creator)",
          "runtime_tuning (recommended_model, min_model_params_b, context_window_tokens, max_output_tokens, token_budget_config)",
          "built_on (upstream Task Object keys)",
        ],
      })),
      live_demand_signals: signalsRes?.results || [],
      top_high_reach_task_objects: (highReachObjsRes?.results || []).map((o) => ({
        ...o,
        object_url: `${publicUrl}/q/object/${encodeURIComponent(o.object_key)}`,
      })),
      adaptively_boosted_ready_tasks: highReachTasksRes?.results || [],
    },
  };
}
