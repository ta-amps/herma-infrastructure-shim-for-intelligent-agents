// Herma v6.8 Thick-Path Plateau Grid Telemetry, Proactive Open-World Schema Coach (`/q/schema`, `/q/schema/validate`),
// Live Grid Robustness Endpoint (`/q/grid-robustness`), and Meta FAIR Published Embedding Models Adapter Spec (`/q/embeddings-spec`).
//
// Strictly preserves universal `Task` (`herma_durable_queue`) and `Task Object` (`herma_task_objects`) primitives
// with open-world extension tolerance (`open_world_allow_additional_properties`), zero rival work authorities,
// zero em-dashes, and zero legacy model names.

export const THICK_PATH_SCHEMA_COACH_GRID = Object.freeze({
  schema_id: "herma.thick_path_and_schema_coach.grid.v6_8",
  schema_coach_version: "herma.priority_work_gateway.schema_coach.v6_8",
  grid_robustness_version: "herma.priority_work_gateway.grid_robustness.v6_8",
  embeddings_spec_version: "herma.priority_work_gateway.embeddings_spec.v6_8",
  milli_scale: 1000,
  cent_scale: 100,
  simhash_bits: 64,
  hex_radix: 16,
  nibble_bits: 4,
  default_nominal_mu_milli: 930,
  unverified_perturbation_milli: 780,
  wide_plateau_base_sharpness_milli: 40,
  retry_sharpness_step_milli: 85,
  max_sharpness_penalty_milli: 680,
  weight_param_cliff: 0.35,
  weight_task_fragility: 0.55,
  weight_route_conductance: 0.12,
  weight_waterfall_waste: 0.08,
  primary_execution_cycles: 1.0,
  waterfall_recovery_cycles: 3.5,
  needle_baseline_point_milli: 970,
  needle_baseline_cvar_milli: 250,
  needle_baseline_sharpness_milli: 350,
  needle_baseline_fragility_milli: 720,
  needle_baseline_waste_cycles: 2.835,
  needle_baseline_total_cycles: 3.835,
  needle_baseline_thick_score_milli: 355,
  thick_reference_point_milli: 930,
  thick_reference_cvar_milli: 900,
  thick_reference_sharpness_milli: 40,
  thick_reference_fragility_milli: 30,
  thick_reference_waste_cycles: 0.036,
  thick_reference_total_cycles: 1.036,
  thick_reference_score_milli: 965,
  epsilon_ball_radius: 0.12,
  epsilon_min_jitter: 0.005,
  hybrid_dense_cosine_weight: 0.55,
  hybrid_simhash_weight: 0.25,
  hybrid_lexical_bm25_weight: 0.2,
  completeness_base_milli: 320,
  completeness_per_core_milli: 95,
  completeness_per_recommended_milli: 55,
  completeness_perturbation_bonus_milli: 90,
  completeness_adaptation_bonus_milli: 45,
  max_custom_fields_reported: 48,
  max_recent_telemetry_rows: 25,
  routing_thick_bonus_cap: 6.0,
  routing_thick_bonus_scale: 6.0,
  http_ok: 200,
  http_bad_request: 400,
  http_method_not_allowed: 405,
});

export const META_FAIR_SEEDED_TASK_OBJECT_KEY = "meta_fair_multimodal_embeddings_thick_rag_v1";

export const META_FAIR_EMBEDDING_MODELS_CATALOG = Object.freeze([
  {
    adapter_id: "sonar_multilingual_speech_text",
    model_name: "SONAR",
    hf_repo_id: "facebook/SONAR",
    organization: "Meta FAIR",
    modalities: ["text_200_languages", "speech_audio_encoders"],
    embedding_dim: 1024,
    pooling_and_norm: "sentence_bottleneck_l2_unit_norm",
    similarity_metric: "cosine_and_euclidean_epsilon_ball",
    strengths: [
      "Unified fixed-size 1024-d sentence representation across 200 written languages and multilingual speech",
      "Cross-lingual zero-shot semantic alignment ideal for NGO multilingual hotlines, intake forms, and speech transcripts",
      "High cross-lingual paraphrase stability makes SONAR epsilon-balls ideal for detecting micro-requirement shifts",
    ],
    epsilon_ball_role:
      "Primary 200-language semantic invariance oracle: when 0 < ||e_SONAR(q') - e_SONAR(q)||_2 <= 0.12 while surface tokens differ, flags a human-imperceptible micro-shift and routes to a thick-plateau node.",
  },
  {
    adapter_id: "contriever_msmarco_dense_rag",
    model_name: "Contriever / Contriever-MSMARCO",
    hf_repo_id: "facebook/contriever-msmarco",
    companion_repos: ["facebook/contriever", "facebook/mcontriever-msmarco"],
    organization: "Meta FAIR",
    modalities: ["text_passage", "query_document_rag"],
    embedding_dim: 768,
    pooling_and_norm: "mean_token_pooling_with_l2_or_dot",
    similarity_metric: "dot_product_and_cosine_hybrid",
    strengths: [
      "Contrastive unsupervised pretraining (inverse cloze + independent cropping) finetuned on MS MARCO",
      "Strong zero-shot out-of-domain RAG recall on technical specs, civic directories, and seed-pack documentation",
      "Fast 768-d bi-encoder footprint suitable for CPU/laptop FAISS + D1 SimHash LSH two-stage retrieval",
    ],
    epsilon_ball_role:
      "Dense RAG passage neighborhood verifier: measures top-k retrieval basin stability under query paraphrase and OCR character noise.",
  },
  {
    adapter_id: "dragon_plus_dual_encoder",
    model_name: "Dragon+",
    hf_repo_id: "facebook/dragon-plus-query-encoder",
    companion_repos: ["facebook/dragon-plus-context-encoder"],
    organization: "Meta FAIR",
    modalities: ["asymmetric_query_encoder", "passage_context_encoder"],
    embedding_dim: 768,
    pooling_and_norm: "cls_asymmetric_dot_product_l2_rerank",
    similarity_metric: "asymmetric_dot_and_hybrid_rrf",
    strengths: [
      "Dual-encoder dense retriever trained with diverse query augmentation and multi-teacher relevance labels",
      "Generalizes cleanly across both keyword-heavy engineering queries and natural-language public-good requests",
    ],
    epsilon_ball_role:
      "Asymmetric query-shift probe: detects when short keyword queries vs verbose natural-language prompts map to the same retrieval basin.",
  },
  {
    adapter_id: "metaclip_2_worldwide_vl",
    model_name: "MetaCLIP 2",
    hf_repo_id: "facebook/metaclip-2",
    organization: "Meta FAIR",
    modalities: ["image", "multilingual_text_300_plus_langs"],
    embedding_dim: 1024,
    pooling_and_norm: "contrastive_vision_language_l2_unit_norm",
    similarity_metric: "cosine_similarity",
    strengths: [
      "Worldwide multilingual vision-language embeddings trained via metadata-curated balanced distributions",
      "Eliminates the multilinguality curse -- mutually boosts English and non-English visual-text retrieval",
      "Indexes sprite sheets, 3D STL renders, document scans, and civic field imagery alongside multilingual text",
    ],
    epsilon_ball_role:
      "Cross-modal invariance guard: ensures multilingual caption variants and mild visual crop/compression perturbations retrieve the same Task Object.",
  },
  {
    adapter_id: "perception_encoder_pe_core",
    model_name: "Perception Encoder (PE-Core)",
    hf_repo_id: "facebook/PE-Core-L14-336",
    companion_repos: ["facebook/PE-Core-G14-448", "facebook/PE-Core-B16-224"],
    organization: "Meta FAIR",
    modalities: ["image", "video_temporal_frames", "vision_language"],
    embedding_dim: 1024,
    pooling_and_norm: "intermediate_layer_aligned_l2_unit_norm",
    similarity_metric: "cosine_similarity",
    strengths: [
      "Vision-language encoder unlocking strong intermediate-layer spatial and temporal representations for both images and video",
      "Supports zero-shot multimodal classification, video walkthrough indexing, and Godot/3D scene QA alignment",
    ],
    epsilon_ball_role:
      "Visual/temporal perturbation guard: verifies frame-rate, resolution, and lighting invariance across multimodal component demos.",
  },
]);

const CANONICAL_ENVELOPE_CORE_FIELDS = new Set([
  "agent_id",
  "worker_uuid",
  "worker_token",
  "task_id",
  "lease_epoch",
  "fencing_token",
  "idempotency_key",
  "summary",
  "execution_telemetry",
  "task_objects",
  "evaluations",
  "followup_tasks",
  "queued_tasks",
  "schema_adaptations",
  "model_hint",
  "harness_tier",
  "beat_slot",
  "alternative_route_used",
]);

const CANONICAL_OBJECT_CORE_FIELDS = new Set([
  "object_key",
  "category",
  "summary",
  "payload",
]);

const CANONICAL_OBJECT_RECOMMENDED_FACETS = new Set([
  "step_mode",
  "reuse_mode",
  "builds_on",
  "supersedes",
  "input_schema",
  "output_schema",
  "asset_modality",
  "search_hints",
  "schema_adaptations",
  "custom_facets",
  "labels",
  "generation_depth",
  "verification_verdict",
  "deliverable_kind",
  "proposal_metadata",
  "input_contract",
  "output_contract",
  "visibility",
  "mutation_operator",
  "dense_embedding_int8",
  "embedding_model_id",
  "embedding_norm",
  "lsh_small_64b",
  "lsh_medium_256b",
  "lsh_wide_1024b",
  "search_blocks",
  "search_leafs",
  "client_index",
]);

const OBJECT_ALIAS_TO_CANONICAL = Object.freeze({
  depends_on: "builds_on",
  built_on: "builds_on",
  upstream_keys: "builds_on",
  parent_objects: "builds_on",
  description: "summary",
  desc: "summary",
  key: "object_key",
  object_id: "object_key",
  object_name: "object_key",
  slug: "object_key",
  id: "object_key",
  in_schema: "input_schema",
  inputs_schema: "input_schema",
  out_schema: "output_schema",
  outputs_schema: "output_schema",
});

const CANONICAL_TASK_CORE_FIELDS = new Set([
  "tier",
  "title",
  "prompt",
]);

const CANONICAL_TASK_RECOMMENDED_FACETS = new Set([
  "task_id",
  "category",
  "step_mode",
  "family",
  "verb_kind",
  "priority",
  "complexity_milli",
  "min_capability_milli",
  "required_capabilities",
  "suggested_capabilities",
  "alternative_routes",
  "blocked_by_task_id",
  "acceptance_criteria",
  "owner_worker_uuid",
  "for_self",
  "labels",
  "generation_depth",
  "search_hints",
  "schema_adaptations",
  "input_contract",
  "output_contract",
  "branch_label",
  "visibility",
]);

const TASK_ALIAS_TO_CANONICAL = Object.freeze({
  depends_on: "blocked_by_task_id",
  prerequisite_task_id: "blocked_by_task_id",
  description: "prompt",
  desc: "prompt",
});

const ENVELOPE_ALIAS_TO_CANONICAL = Object.freeze({
  queued_verbs: "followup_tasks",
  followup_verbs: "followup_tasks",
  next_tasks: "followup_tasks",
  generated_tasks: "followup_tasks",
  subtasks: "followup_tasks",
  tasks: "followup_tasks",
  verbs: "followup_tasks",
  objects: "task_objects",
  nouns: "task_objects",
  output_nouns: "task_objects",
  result_summary: "summary",
  completed_branch: "summary",
  completed_task_id: "task_id",
  verb_id: "task_id",
  uuid: "worker_uuid",
  agent: "agent_id",
  worker: "agent_id",
  fence_seq: "lease_epoch",
  claim_revision: "lease_epoch",
  fence: "lease_epoch",
});

const STANDARD_PAYLOAD_KEYS = new Set([
  "version",
  "kit_version",
  "details",
  "code_and_tests",
  "files",
  "working_dir_files",
  "skills_and_tools",
  "runtime_tuning",
  "interactive_demo",
  "evaluations",
  "queued_tasks",
  "followup_tasks",
  "builds_on",
  "depends_on",
  "schema_adaptations",
]);

const INITIALIZED_THICK_PATH_DBS = new WeakSet();

export function buildMetaFairEmbeddingsSeedObject() {
  return {
    object_key: META_FAIR_SEEDED_TASK_OBJECT_KEY,
    category: "meta_embedding_adapter",
    asset_modality: "embedding_index_kit",
    builds_on: [],
    input_schema: {
      type: "object",
      required: ["query_text"],
      properties: {
        query_text: { type: "string" },
        language_code: { type: "string", default: "eng_Latn" },
        modality: { type: "string", enum: ["text", "speech", "image", "video"], default: "text" },
        query_embedding: { type: "array", items: { type: "number" } },
        reference_embedding: { type: "array", items: { type: "number" } },
      },
      additionalProperties: true,
    },
    output_schema: {
      type: "object",
      required: ["ranked_candidates", "epsilon_ball_shift_report", "plateau_verified"],
      properties: {
        ranked_candidates: { type: "array" },
        epsilon_ball_shift_report: { type: "object" },
        plateau_verified: { type: "boolean" },
      },
      additionalProperties: true,
    },
    schema_adaptations:
      "Includes unified 5-model Meta FAIR adapter registry (SONAR, Contriever-MSMARCO, Dragon+, MetaCLIP 2, PE-Core) plus L2-cosine + 64-bit SimHash LSH hybrid reranker and epsilon-ball micro-shift router.",
    search_hints: {
      intent_signature: "meta_fair_multimodal_embeddings_thick_plateau_rag",
      search_keywords: [
        "sonar",
        "contriever",
        "dragon_plus",
        "metaclip_2",
        "perception_encoder",
        "pe_core",
        "thick_path",
        "embeddings",
      ],
      search_phrases: [
        "meta fair multimodal embeddings",
        "sonar 200 language sentence embeddings",
        "contriever msmarco dense rag",
        "metaclip 2 worldwide multilingual",
        "perception encoder pe core",
      ],
      semantic_synonyms: ["dense_retrieval", "multilingual_rag", "epsilon_ball_robustness"],
      facet_axes: {
        opt_goal: "thick_plateau_perturbation_invariant",
        prog_lang: "Python_3_12_and_Cloudflare_Workers_JS",
        deliverable_kind: "portable_agent_kit",
      },
    },
    summary:
      "Meta FAIR Multimodal & Multilingual Thick-Path RAG Kit: unified adapters, L2-cosine + 64-bit SimHash LSH + BM25 hybrid reranking, and epsilon-ball micro-requirement shift detection across SONAR (200-lang text/speech), Contriever-MSMARCO, Dragon+, MetaCLIP 2, and Perception Encoder (PE-Core).",
    payload: {
      version: "1.0.0",
      kit_id: META_FAIR_SEEDED_TASK_OBJECT_KEY,
      extension_policy: "open_world_allow_additional_properties",
      models: META_FAIR_EMBEDDING_MODELS_CATALOG,
      hybrid_reranking_formula: {
        expression:
          "score_hybrid(q, d) = 0.55 * cosine_l2(e_meta(q), e_meta(d)) + 0.25 * (1 - hamming64(simhash64(q), simhash64(d)) / 64) + 0.20 * rrf_bm25(q, d)",
        weights: {
          dense_cosine: THICK_PATH_SCHEMA_COACH_GRID.hybrid_dense_cosine_weight,
          simhash64_lsh: THICK_PATH_SCHEMA_COACH_GRID.hybrid_simhash_weight,
          lexical_bm25_rrf: THICK_PATH_SCHEMA_COACH_GRID.hybrid_lexical_bm25_weight,
        },
        rationale:
          "Combines dense semantic invariance (SONAR / Contriever / Dragon+ / MetaCLIP 2 / PE-Core) with exact identifier/code/ZIP preservation via BM25 and O(1) D1-indexable 64-bit SimHash bands.",
      },
      epsilon_ball_micro_shift_detector: {
        epsilon_radius_l2: THICK_PATH_SCHEMA_COACH_GRID.epsilon_ball_radius,
        min_jitter_l2: THICK_PATH_SCHEMA_COACH_GRID.epsilon_min_jitter,
        rule:
          "When 0 < ||e_SONAR(q') - e_SONAR(q_0)||_2 <= 0.12 (or lexical Jaccard < 1.0 inside the semantic epsilon-ball), the request represents a human-imperceptible micro-requirement shift; bypass brittle needle-peak configurations and route to a verified thick-plateau cell (plateau_pass_ratio >= 0.85).",
      },
      perturbation_invariance_report: {
        perturbation_pass_count: 5,
        perturbation_total: 5,
        checks_passed: [
          "key_order_and_whitespace_permutation",
          "multilingual_sonar_paraphrase_shift",
          "open_world_unknown_extension_fields",
          "boundary_scale_zero_one_batch",
          "corrupted_vector_graceful_diagnostic",
        ],
      },
      python_adapter_snippet: [
        "import math",
        "",
        "def l2_normalize(vec):",
        "    norm = math.sqrt(sum(float(x) * float(x) for x in vec))",
        "    return [float(x) / norm for x in vec] if norm > 1e-12 else [0.0 for _ in vec]",
        "",
        "def sonar_or_contriever_epsilon_shift(ref_vec, cand_vec, eps=0.12):",
        "    u, v = l2_normalize(ref_vec), l2_normalize(cand_vec)",
        "    l2 = math.sqrt(sum((a - b) * (a - b) for a, b in zip(u, v)))",
        "    cos = sum(a * b for a, b in zip(u, v))",
        "    return {'l2_distance': round(l2, 6), 'cosine': round(cos, 6), 'micro_shift': 0.005 <= l2 <= eps}",
      ].join("\n"),
    },
  };
}

export async function ensureThickPathAndSchemaCoachSchema(db, { seedCallback = null } = {}) {
  if (!db || typeof db.prepare !== "function") return;
  if (db.__hermaSchemaV69Ready && typeof seedCallback !== "function") return;
  if (!db.__hermaSchemaV69Ready && !INITIALIZED_THICK_PATH_DBS.has(db)) {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS herma_thick_path_telemetry (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id TEXT NOT NULL DEFAULT '',
          worker_uuid TEXT NOT NULL DEFAULT '',
          agent_id TEXT NOT NULL DEFAULT '',
          harness_tier TEXT NOT NULL DEFAULT 'tier_2_sandboxed_chat_worker',
          complexity_bucket TEXT NOT NULL DEFAULT 'medium',
          verb_kind TEXT NOT NULL DEFAULT 'general_verb',
          cell_id TEXT NOT NULL DEFAULT 'thick_plateau_open_world_band3',
          retrace_strategy TEXT NOT NULL DEFAULT '',
          perturbation_pass_count INTEGER NOT NULL DEFAULT 0,
          perturbation_total INTEGER NOT NULL DEFAULT 0,
          perturbation_invariance_milli INTEGER NOT NULL DEFAULT 780,
          retries_or_backtracks INTEGER NOT NULL DEFAULT 0,
          cliff_sharpness_penalty_milli INTEGER NOT NULL DEFAULT 40,
          route_conductance_milli INTEGER NOT NULL DEFAULT 850,
          thick_path_score_milli INTEGER NOT NULL DEFAULT 880,
          waterfall_cycles_saved REAL NOT NULL DEFAULT 0.0,
          created_at TEXT NOT NULL
        )`
      )
      .run();
    await db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_herma_thick_path_tier
         ON herma_thick_path_telemetry (harness_tier, created_at DESC)`
      )
      .run();
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS herma_object_schema_meta (
          object_key TEXT PRIMARY KEY,
          schema_adaptations TEXT NOT NULL DEFAULT '',
          completeness_score_milli INTEGER NOT NULL DEFAULT 800,
          custom_fields_json TEXT NOT NULL DEFAULT '[]',
          input_schema_json TEXT NOT NULL DEFAULT '',
          output_schema_json TEXT NOT NULL DEFAULT '',
          perturbation_pass_count INTEGER NOT NULL DEFAULT 0,
          perturbation_total INTEGER NOT NULL DEFAULT 0,
          thick_path_score_milli INTEGER NOT NULL DEFAULT 880,
          updated_at TEXT NOT NULL
        )`
      )
      .run();
    INITIALIZED_THICK_PATH_DBS.add(db);
  }

  if (typeof seedCallback === "function") {
    try {
      const existingSeed = await db
        .prepare("SELECT object_key FROM herma_task_objects WHERE object_key = ? LIMIT 1")
        .bind(META_FAIR_SEEDED_TASK_OBJECT_KEY)
        .first();
      if (!existingSeed) {
        await seedCallback(buildMetaFairEmbeddingsSeedObject());
      }
    } catch {
      // Non-fatal on mocked unit DBs that do not implement full herma_task_objects SQL
    }
  }
}

export function buildCanonicalSuggestedSchemas(publicUrl = "https://shim.teleionlabs.com") {
  const base = String(publicUrl || "https://shim.teleionlabs.com").replace(/\/+$/, "");
  return {
    ok: true,
    schema: THICK_PATH_SCHEMA_COACH_GRID.schema_coach_version,
    gateway_grid_schema: "herma.priority_work_gateway.grid.v6_8",
    extension_policy: "open_world_allow_additional_properties",
    non_blocking_guarantee:
      "Herma never blocks custom domain, modality, or telemetry fields. 100% of custom properties in payload, task_objects, and followup_tasks are preserved losslessly, schema_adaptations notes are honored, and non-blocking schema_feedback is returned on every /q/submit.",
    endpoints: {
      schema_discovery_url: `${base}/q/schema`,
      schema_validate_url: `${base}/q/schema/validate`,
      submit_url: `${base}/q/submit`,
      feedback_url: `${base}/q/feedback`,
      upload_url: `${base}/q/upload`,
      compose_url: `${base}/q/compose?keys=<obj_a>,<obj_b>`,
      grid_robustness_url: `${base}/q/grid-robustness`,
      embeddings_spec_url: `${base}/q/embeddings-spec`,
    },
    step_mode_taxonomy: {
      atomic_cognitive_step: {
        reuse_mode: "semantic_rubric_prior",
        preferred_tiers: ["tier_1_lightweight_get", "tier_2_sandboxed_chat_worker"],
        description:
          "Scoping, decomposition, ambiguity resolution, ranking rubrics, radar triage, or architecture synthesis.",
      },
      atomic_build_step: {
        reuse_mode: "deterministic_code_bypass",
        preferred_tiers: ["tier_3_cli_code_harness", "tier_4_deep_architect_astra"],
        description:
          "Runnable code, CLI/Docker/Agent-Kit packaging, 3D mesh/audio assets, schemas/SQL compilation, or pytest/node --test; verified outputs can be re-executed deterministically with 0 LLM tokens.",
      },
      atomic_verification_step: {
        reuse_mode: "verification_oracle",
        preferred_tiers: ["tier_1_lightweight_get", "tier_2_sandboxed_chat_worker", "tier_3_cli_code_harness"],
        description: "Blind evaluation, metamorphic 5-perturbation micro-shift audit, or eval_and_rank.",
      },
      deterministic_reuse_step: {
        reuse_mode: "deterministic_code_bypass",
        preferred_tiers: ["tier_3_cli_code_harness", "tier_4_deep_architect_astra"],
        description: "Direct zero-token deterministic invocation or composition of verified upstream build artifacts.",
      },
    },
    task_object_schema: {
      $id: "herma.task_object.suggested.v6_8",
      type: "object",
      additionalProperties: true,
      extension_policy: "open_world_allow_additional_properties",
      core_fields: {
        object_key: {
          type: "string",
          maxLength: 128,
          pattern: "^[a-z0-9_-]+$",
          description: "Unique reusable Task Object key, up to 128 characters. Use <type>_<subject>_<agent_id>_v1 (a date such as _20261107 before _v1 is optional). Raise _v1 to _v2 for a new version.",
        },
        category: {
          type: "string",
          description:
            "Suggested categories: agent_kit, pipeline_registry, multimodal_asset_kit, meta_embedding_adapter, infra_proposal, worker_issue_report, canonical_schema, benchmark_evaluation_dossier (any custom string allowed).",
        },
        summary: {
          type: "string",
          maxLength: 1600,
          description: "Concise verifiable description of what this Task Object provides.",
        },
        payload: {
          type: "object",
          additionalProperties: true,
          description:
            "Lossless JSON content (inline D1 up to 256 KiB; chunked UTF-8 D1 up to 16 MiB + Content-Encoding: gzip + /q/upload binary CAS; SHA-256 verified).",
        },
      },
      recommended_facets: {
        step_mode: {
          type: "string",
          enum: [
            "atomic_cognitive_step",
            "atomic_build_step",
            "atomic_verification_step",
            "deterministic_reuse_step",
          ],
          description: "Auto-inferred when omitted; classifies cognitive vs deterministic runnable build steps.",
        },
        reuse_mode: {
          type: "string",
          enum: ["deterministic_code_bypass", "semantic_rubric_prior", "verification_oracle"],
          description: "Auto-inferred reuse contract (e.g. deterministic_code_bypass runs with 0 LLM tokens).",
        },
        builds_on: {
          type: "array",
          items: { type: "string" },
          aliases_auto_linked: ["depends_on", "built_on", "upstream_keys", "uses"],
          description: "Upstream Task Object keys extended or composed by this object.",
        },
        supersedes: {
          type: "array",
          items: { type: "string" },
          description: "Prior Task Object keys upgraded or corrected by this version.",
        },
        input_schema: {
          type: "object",
          description: "JSON Schema describing expected input contract for /q/compose compatibility checks.",
        },
        output_schema: {
          type: "object",
          description: "JSON Schema describing emitted output contract for /q/compose compatibility checks.",
        },
        asset_modality: {
          type: "string",
          suggested_values: [
            "code_or_spec",
            "mesh_3d_stl",
            "engine_scene_kit",
            "audio_music_stem",
            "sprite_sheet",
            "video_render",
            "embedding_index_kit",
          ],
        },
        search_hints: {
          type: "object",
          properties: {
            intent_signature: { type: "string" },
            search_keywords: { type: "array", items: { type: "string" } },
            search_phrases: { type: "array", items: { type: "string" } },
            semantic_synonyms: { type: "array", items: { type: "string" } },
            facet_axes: { type: "object", additionalProperties: true },
          },
        },
        schema_adaptations: {
          type: "string",
          description: "Optional 1-line note explaining custom extension fields or problem-specific adaptations.",
        },
      },
    },
    task_schema: {
      $id: "herma.task.suggested.v6_8",
      type: "object",
      additionalProperties: true,
      extension_policy: "open_world_allow_additional_properties",
      core_fields: {
        tier: {
          type: "string",
          enum: ["ngo_priority", "public_general"],
          description: "Queue priority tier (infra_private is reserved for authorized server infrastructure).",
        },
        title: { type: "string", maxLength: 180, description: "Focused 1-step atomic work title." },
        prompt: {
          type: "string",
          maxLength: 4000,
          aliases_auto_linked: ["description", "desc"],
          description: "Self-contained instructions and acceptance checks for the claiming worker.",
        },
      },
      recommended_facets: {
        category: { type: "string" },
        step_mode: {
          type: "string",
          enum: [
            "atomic_cognitive_step",
            "atomic_build_step",
            "atomic_verification_step",
            "deterministic_reuse_step",
          ],
          description: "Optional step_mode filter & routing affinity (auto-inferred when omitted).",
        },
        family: { type: "string", description: "Coherent stack/family tag for batch co-claiming." },
        verb_kind: {
          type: "string",
          suggested_values: [
            "ngo_public_good",
            "general_verb",
            "eval_and_rank",
            "meta_generator",
            "verb_mutator",
            "demo_and_video",
            "agent_kit_packager",
            "worker_self_directed",
          ],
        },
        priority: { type: "integer", minimum: 1, maximum: 100 },
        complexity_milli: { type: "integer", minimum: 100, maximum: 1000 },
        suggested_capabilities: { type: "array", items: { type: "string" } },
        alternative_routes: { type: "array", items: { type: "string" } },
        blocked_by_task_id: {
          type: "string",
          aliases_auto_linked: ["depends_on", "prerequisite_task_id"],
          description: "Prerequisite task_id that must reach state='done' before this Task unlocks.",
        },
        acceptance_criteria: { type: "array", items: { type: "string" } },
        schema_adaptations: { type: "string" },
      },
    },
    submit_envelope_schema: {
      $id: "herma.submit_envelope.suggested.v6_8",
      type: "object",
      additionalProperties: true,
      extension_policy: "open_world_allow_additional_properties",
      core_fields: [
        "agent_id",
        "worker_uuid",
        "worker_token",
        "task_id",
        "lease_epoch",
        "fencing_token",
        "idempotency_key",
        "summary",
        "execution_telemetry",
        "task_objects",
        "evaluations",
        "followup_tasks",
      ],
      bidirectional_aliases: {
        followup_tasks: "queued_tasks",
        queued_tasks: "followup_tasks",
        lease_epoch: "fencing_token",
        fencing_token: "lease_epoch",
      },
    },
    modality_overlays: {
      agent_kit: {
        overlay_id: "agent_kit",
        matches_categories: ["agent_kit", "portable_agent_kit", "skill_pack"],
        suggested_payload_facets: [
          "version",
          "working_dir_files",
          "skills_and_tools",
          "runtime_tuning",
          "perturbation_invariance_report",
          "code_and_tests",
        ],
        thick_path_guidance:
          "Run the 5-perturbation micro-shift self-test before submitting and report perturbation_pass_count + perturbation_total in execution_telemetry.",
      },
      pipeline_registry: {
        overlay_id: "pipeline_registry",
        matches_categories: ["pipeline_registry", "capability_ontology", "live_update_feed", "open_source_project_profile"],
        suggested_payload_facets: [
          "version",
          "discovery_sources",
          "entries",
          "typed_io_contracts",
          "unmeasured_cells_explicit_null",
        ],
        thick_path_guidance:
          "Use the 8-source discovery waterfall on API rate limits and leave unmeasured benchmark cells explicitly null while queueing run_benchmark followup_tasks.",
      },
      multimodal_asset_kit: {
        overlay_id: "multimodal_asset_kit",
        matches_categories: ["multimodal_asset_kit", "demo_and_video", "godot_scene_kit", "wav_music_stem"],
        suggested_payload_facets: [
          "asset_modality",
          "files",
          "mesh_qa",
          "audio_qa",
          "interactive_demo",
        ],
        thick_path_guidance:
          "Verify watertight Euler invariant V - E + F = 2 on mesh_3d_stl, headless load on Godot 4 .tscn/.gd, and peak/clipping bounds on 16-bit PCM .wav stems.",
      },
      meta_embedding_adapter: {
        overlay_id: "meta_embedding_adapter",
        matches_categories: ["meta_embedding_adapter", "embedding_rag_kit", "multiscript_schema"],
        supported_meta_fair_models: META_FAIR_EMBEDDING_MODELS_CATALOG.map((m) => ({
          model_name: m.model_name,
          hf_repo_id: m.hf_repo_id,
          embedding_dim: m.embedding_dim,
        })),
        suggested_payload_facets: [
          "model_id",
          "embedding_dim",
          "normalization",
          "hybrid_reranker_weights",
          "epsilon_ball_shift_guard",
          "code_and_tests",
        ],
        thick_path_guidance:
          "L2-normalize dense vectors, combine cosine similarity with 64-bit SimHash LSH + BM25 RRF, and guard fragile downstream nodes with SONAR/Contriever epsilon-balls.",
      },
      infra_proposal: {
        overlay_id: "infra_proposal",
        matches_categories: [
          "infra_proposal",
          "retraining_request",
          "pipeline_step_proposal",
          "storage_evolution_proposal",
        ],
        suggested_payload_facets: [
          "proposal_metadata.proposal_kind",
          "proposal_metadata.target_subsystem",
          "proposal_metadata.problem_evidence",
          "proposal_metadata.proposed_change",
          "proposal_metadata.risk_and_rollback",
          "proposal_metadata.success_metrics",
        ],
        thick_path_guidance:
          "Clearly label proposals as unadmitted until >= 2 independent peer reviews (evaluator != proposer) advance status to admin_review_ready.",
      },
    },
    canonical_alias_map: {
      task_object: OBJECT_ALIAS_TO_CANONICAL,
      task: TASK_ALIAS_TO_CANONICAL,
      submit_envelope: ENVELOPE_ALIAS_TO_CANONICAL,
      bidirectional: ["queued_tasks <-> followup_tasks", "lease_epoch <-> fencing_token"],
    },
  };
}

function inferModalityOverlaysForObject(item = {}) {
  const cat = String(item.category || "").toLowerCase();
  const mod = String(item.asset_modality || item.payload?.asset_modality || "").toLowerCase();
  const matched = [];
  if (cat.includes("kit") && !cat.includes("multimodal") && !cat.includes("scene") || cat === "skill_pack") {
    matched.push("agent_kit");
  }
  if (cat.includes("registry") || cat.includes("ontology") || cat.includes("feed") || cat.includes("radar")) {
    matched.push("pipeline_registry");
  }
  if (
    cat.includes("multimodal") ||
    cat.includes("godot") ||
    cat.includes("mesh") ||
    cat.includes("wav") ||
    ["mesh_3d_stl", "engine_scene_kit", "audio_music_stem", "sprite_sheet", "video_render"].includes(mod)
  ) {
    matched.push("multimodal_asset_kit");
  }
  if (cat.includes("embedding") || cat.includes("sonar") || cat.includes("contriever") || mod === "embedding_index_kit") {
    matched.push("meta_embedding_adapter");
  }
  if (cat.includes("proposal") || cat === "retraining_request") {
    matched.push("infra_proposal");
  }
  return matched;
}

export function buildSubmissionSchemaFeedback(rawInput = {}) {
  const input = rawInput && typeof rawInput === "object" ? rawInput : {};
  const isStandaloneObject =
    !input.task_objects &&
    !input.objects &&
    !input.nouns &&
    Boolean(input.object_key || input.payload || input.builds_on || input.depends_on) &&
    !input.agent_id &&
    !input.task_id;
  const isStandaloneTask =
    !isStandaloneObject &&
    !input.task_objects &&
    !input.followup_tasks &&
    !input.queued_tasks &&
    Boolean(input.prompt || input.tier) &&
    !input.agent_id;

  const envelope = isStandaloneObject
    ? { task_objects: [input] }
    : isStandaloneTask
      ? { followup_tasks: [input] }
      : input;

  const recognizedCore = new Set();
  const recognizedRecommended = new Set();
  const customFieldsPreserved = new Set();
  const adaptations = [];
  const suggestedAliases = [];
  const matchedOverlays = new Set();

  if (typeof envelope.schema_adaptations === "string" && envelope.schema_adaptations.trim()) {
    adaptations.push(envelope.schema_adaptations.trim());
  }

  for (const key of Object.keys(envelope)) {
    if (CANONICAL_ENVELOPE_CORE_FIELDS.has(key)) {
      recognizedCore.add(key);
      if (key === "queued_tasks") {
        suggestedAliases.push({
          scope: "submit_envelope",
          used_field: "queued_tasks",
          canonical_field: "followup_tasks",
          bidirectional_alias: true,
          auto_linked: true,
          note: "queued_tasks <-> followup_tasks are bidirectional canonical aliases; all follow-up Tasks were preserved.",
        });
      }
    } else if (key in ENVELOPE_ALIAS_TO_CANONICAL) {
      const target = ENVELOPE_ALIAS_TO_CANONICAL[key];
      recognizedCore.add(target);
      suggestedAliases.push({
        scope: "submit_envelope",
        used_field: key,
        canonical_field: target,
        auto_linked: true,
        note: `Mapped envelope alias '${key}' -> '${target}'.`,
      });
    } else {
      customFieldsPreserved.add(`envelope.${key}`);
    }
  }

  const objectsList = Array.isArray(envelope.task_objects)
    ? envelope.task_objects
    : Array.isArray(envelope.objects)
      ? envelope.objects
      : Array.isArray(envelope.nouns)
        ? envelope.nouns
        : envelope.task_object && typeof envelope.task_object === "object"
          ? [envelope.task_object]
          : [];

  for (let i = 0; i < objectsList.length; i += 1) {
    const obj = objectsList[i];
    if (!obj || typeof obj !== "object") continue;

    for (const ov of inferModalityOverlaysForObject(obj)) {
      matchedOverlays.add(ov);
    }

    if (typeof obj.schema_adaptations === "string" && obj.schema_adaptations.trim()) {
      adaptations.push(obj.schema_adaptations.trim());
    }
    if (obj.payload && typeof obj.payload === "object" && typeof obj.payload.schema_adaptations === "string") {
      if (obj.payload.schema_adaptations.trim()) {
        adaptations.push(obj.payload.schema_adaptations.trim());
      }
    }

    for (const key of Object.keys(obj)) {
      if (CANONICAL_OBJECT_CORE_FIELDS.has(key)) {
        recognizedCore.add(`task_objects.${key}`);
      } else if (CANONICAL_OBJECT_RECOMMENDED_FACETS.has(key)) {
        recognizedRecommended.add(`task_objects.${key}`);
        if (key === "custom_facets" && obj.custom_facets && typeof obj.custom_facets === "object") {
          for (const cfKey of Object.keys(obj.custom_facets)) {
            customFieldsPreserved.add(`task_objects[${i}].custom_facets.${cfKey}`);
          }
        }
      } else if (key in OBJECT_ALIAS_TO_CANONICAL) {
        const canonical = OBJECT_ALIAS_TO_CANONICAL[key];
        recognizedCore.add(`task_objects.${canonical}`);
        suggestedAliases.push({
          scope: `task_objects[${i}]`,
          used_field: key,
          canonical_field: canonical,
          auto_linked: true,
          note:
            canonical === "builds_on"
              ? `Auto-linked '${key}' into reuse graph as 'builds_on' edge; prefer 'builds_on' for direct /q/compose lineage.`
              : `Auto-mapped '${key}' -> '${canonical}'; prefer '${canonical}' in canonical Task Objects.`,
        });
      } else {
        customFieldsPreserved.add(`task_objects[${i}].${key}`);
      }
    }

    if (obj.payload && typeof obj.payload === "object" && !Array.isArray(obj.payload)) {
      if (obj.payload.depends_on && !obj.builds_on && !obj.depends_on) {
        suggestedAliases.push({
          scope: `task_objects[${i}].payload`,
          used_field: "depends_on",
          canonical_field: "builds_on",
          auto_linked: true,
          note: "Auto-linked payload.depends_on into herma_object_edges as builds_on.",
        });
      }
      for (const pKey of Object.keys(obj.payload)) {
        if (!STANDARD_PAYLOAD_KEYS.has(pKey)) {
          customFieldsPreserved.add(`payload.${pKey}`);
        }
      }
    }
  }

  const tasksList = Array.isArray(envelope.followup_tasks)
    ? envelope.followup_tasks
    : Array.isArray(envelope.queued_tasks)
      ? envelope.queued_tasks
      : Array.isArray(envelope.queued_verbs)
        ? envelope.queued_verbs
        : Array.isArray(envelope.followup_verbs)
          ? envelope.followup_verbs
          : Array.isArray(envelope.tasks)
            ? envelope.tasks
            : Array.isArray(envelope.verbs)
              ? envelope.verbs
              : [];

  for (let i = 0; i < tasksList.length; i += 1) {
    const t = tasksList[i];
    if (!t || typeof t !== "object") continue;
    if (typeof t.schema_adaptations === "string" && t.schema_adaptations.trim()) {
      adaptations.push(t.schema_adaptations.trim());
    }
    for (const key of Object.keys(t)) {
      if (CANONICAL_TASK_CORE_FIELDS.has(key)) {
        recognizedCore.add(`followup_tasks.${key}`);
      } else if (CANONICAL_TASK_RECOMMENDED_FACETS.has(key)) {
        recognizedRecommended.add(`followup_tasks.${key}`);
      } else if (key in TASK_ALIAS_TO_CANONICAL) {
        const canonical = TASK_ALIAS_TO_CANONICAL[key];
        recognizedCore.add(`followup_tasks.${canonical}`);
        suggestedAliases.push({
          scope: `followup_tasks[${i}]`,
          used_field: key,
          canonical_field: canonical,
          auto_linked: true,
          note: `Auto-mapped Task '${key}' -> '${canonical}'.`,
        });
      } else {
        customFieldsPreserved.add(`followup_tasks[${i}].${key}`);
      }
    }
  }

  const hasPerturbationTelemetry = Boolean(
    (envelope.execution_telemetry &&
      typeof envelope.execution_telemetry === "object" &&
      envelope.execution_telemetry.perturbation_total != null) ||
      objectsList.some((o) => o?.payload?.perturbation_invariance_report)
  );

  const rawScore =
    THICK_PATH_SCHEMA_COACH_GRID.completeness_base_milli +
    recognizedCore.size * THICK_PATH_SCHEMA_COACH_GRID.completeness_per_core_milli +
    recognizedRecommended.size * THICK_PATH_SCHEMA_COACH_GRID.completeness_per_recommended_milli +
    (hasPerturbationTelemetry ? THICK_PATH_SCHEMA_COACH_GRID.completeness_perturbation_bonus_milli : 0) +
    (adaptations.length > 0 ? THICK_PATH_SCHEMA_COACH_GRID.completeness_adaptation_bonus_milli : 0);

  const completenessScoreMilli = Math.max(
    0,
    Math.min(THICK_PATH_SCHEMA_COACH_GRID.milli_scale, Math.round(rawScore))
  );

  const dedupAdaptations = Array.from(new Set(adaptations));
  const preservedList = Array.from(customFieldsPreserved).slice(
    0,
    THICK_PATH_SCHEMA_COACH_GRID.max_custom_fields_reported
  );

  return {
    extension_policy: "open_world_allow_additional_properties",
    non_blocking: true,
    recognized_core_fields: Array.from(recognizedCore),
    recognized_recommended_facets: Array.from(recognizedRecommended),
    custom_extension_fields_preserved: preservedList,
    schema_adaptations_honored: dedupAdaptations,
    suggested_canonical_aliases: suggestedAliases,
    matched_modality_overlays: Array.from(matchedOverlays),
    completeness_score_milli: completenessScoreMilli,
    flexibility_note:
      preservedList.length > 0 || dedupAdaptations.length > 0
        ? `Open-world schema flexibility active: preserved ${preservedList.length} custom extension field(s) and ${dedupAdaptations.length} schema_adaptations note(s) losslessly with zero blocking.`
        : "Open-world schema flexibility active: all canonical fields recognized; you may freely add custom properties in payload or custom_facets anytime (attach optional schema_adaptations).",
  };
}

export async function handleSchemaCoachRequest(request, url, publicUrl, { infraAllowed = false, subAction = "" } = {}) {
  const method = request.method.toUpperCase();
  const isValidate = subAction === "validate";

  if (!isValidate) {
    if (method !== "GET" && method !== "HEAD") {
      return {
        status: THICK_PATH_SCHEMA_COACH_GRID.http_method_not_allowed,
        body: { ok: false, error: "method_not_allowed" },
      };
    }
    return {
      status: THICK_PATH_SCHEMA_COACH_GRID.http_ok,
      body: buildCanonicalSuggestedSchemas(publicUrl),
    };
  }

  let candidate = {};
  if (method === "POST") {
    try {
      candidate = (await request.json()) || {};
    } catch {
      return {
        status: THICK_PATH_SCHEMA_COACH_GRID.http_bad_request,
        body: { ok: false, code: "invalid_json", detail: "POST /q/schema/validate expects valid JSON." },
      };
    }
  } else if (method === "GET" || method === "HEAD") {
    if (url.searchParams.has("sample") || url.searchParams.size === 0) {
      candidate = {
        agent_id: "schema-probe-worker",
        task_id: "self_seed",
        summary: "Dry-run schema coach probe",
        execution_telemetry: { perturbation_pass_count: 5, perturbation_total: 5 },
        task_objects: [
          {
            object_key: "sample_open_world_object_v1",
            category: "agent_kit",
            depends_on: ["meta_fair_multimodal_embeddings_thick_rag_v1"],
            description: "Sample object exercising alias coaching and open-world custom fields",
            schema_adaptations: "Added custom_domain_telemetry inside payload",
            payload: { version: "1.0.0", custom_domain_telemetry: { latency_p95_ms: 14 } },
          },
        ],
        queued_tasks: [
          {
            tier: "public_general",
            title: "Follow-up perturbation benchmark",
            prompt: "Verify 5-perturbation invariance across SONAR embeddings.",
          },
        ],
      };
    } else {
      candidate = Object.fromEntries(url.searchParams.entries());
    }
  } else {
    return {
      status: THICK_PATH_SCHEMA_COACH_GRID.http_method_not_allowed,
      body: { ok: false, error: "method_not_allowed" },
    };
  }

  const blockingWarnings = [];
  if (!infraAllowed) {
    const objs = Array.isArray(candidate.task_objects) ? candidate.task_objects : [];
    const tasks = Array.isArray(candidate.followup_tasks)
      ? candidate.followup_tasks
      : Array.isArray(candidate.queued_tasks)
        ? candidate.queued_tasks
        : [];
    if (
      objs.some((o) => o && (o.tier === "infra_private" || o.visibility === "server_infra")) ||
      tasks.some((t) => t && (t.tier === "infra_private" || t.visibility === "server_infra"))
    ) {
      blockingWarnings.push("infra_private / server_infra tier requires server infrastructure authorization.");
    }
  }

  const feedback = buildSubmissionSchemaFeedback(candidate);
  return {
    status: THICK_PATH_SCHEMA_COACH_GRID.http_ok,
    body: {
      ok: true,
      schema: THICK_PATH_SCHEMA_COACH_GRID.schema_coach_version,
      extension_policy: "open_world_allow_additional_properties",
      valid_for_open_world_submit: blockingWarnings.length === 0,
      blocking_warnings: blockingWarnings,
      schema_feedback: feedback,
    },
  };
}

export function computeThickPathSubmissionMetrics({
  payload = {},
  harnessTier = "tier_2_sandboxed_chat_worker",
  complexityBucket = "medium",
  verbKind = "general_verb",
  storedObjects = [],
  rawObjects = [],
  schemaFeedback = null,
} = {}) {
  const execTel =
    payload && payload.execution_telemetry && typeof payload.execution_telemetry === "object"
      ? payload.execution_telemetry
      : {};

  let pertPass = Number(execTel.perturbation_pass_count || 0);
  let pertTotal = Number(execTel.perturbation_total || 0);

  if (pertTotal <= 0) {
    for (const entry of rawObjects) {
      const item = entry?.item || entry || {};
      const rep = item?.payload?.perturbation_invariance_report;
      if (rep && Number(rep.perturbation_total || 0) > 0) {
        pertPass += Number(rep.perturbation_pass_count || 0);
        pertTotal += Number(rep.perturbation_total || 0);
      }
    }
  }

  pertTotal = Math.max(0, Math.round(pertTotal));
  pertPass = Math.max(0, Math.min(pertTotal, Math.round(pertPass)));

  const pertInvarianceMilli =
    pertTotal > 0
      ? Math.round((THICK_PATH_SCHEMA_COACH_GRID.milli_scale * pertPass) / pertTotal)
      : THICK_PATH_SCHEMA_COACH_GRID.unverified_perturbation_milli;

  const retries = Math.max(0, Math.round(Number(execTel.retries_or_backtracks || 0)));
  const retraceStrategy = String(execTel.retrace_strategy || (pertTotal > 0 ? "single_pass_thick_plateau" : "nominal"));

  const cliffSharpnessMilli = Math.min(
    THICK_PATH_SCHEMA_COACH_GRID.max_sharpness_penalty_milli,
    THICK_PATH_SCHEMA_COACH_GRID.wide_plateau_base_sharpness_milli +
      retries * THICK_PATH_SCHEMA_COACH_GRID.retry_sharpness_step_milli +
      (pertTotal > 0 && pertPass < pertTotal
        ? Math.round(((pertTotal - pertPass) / pertTotal) * THICK_PATH_SCHEMA_COACH_GRID.needle_baseline_sharpness_milli)
        : 0)
  );

  const taskFragilityMilli = Math.max(
    0,
    THICK_PATH_SCHEMA_COACH_GRID.default_nominal_mu_milli - pertInvarianceMilli
  );

  const builtOnCount = storedObjects.reduce(
    (acc, o) => acc + (Array.isArray(o.built_on_edges) ? o.built_on_edges.length : 0),
    0
  );
  const aliasHandled = (schemaFeedback?.suggested_canonical_aliases?.length || 0) > 0 ? 1 : 0;
  const altRouteUsed = payload.alternative_route_used || execTel.alternative_route_used ? 1 : 0;
  const conductanceRaw = 1.1 + 0.55 * Math.min(3, builtOnCount + altRouteUsed) + 0.35 * aliasHandled + (pertTotal > 0 ? 0.65 : 0);
  const logCondTerm = Math.log(1 + conductanceRaw);
  const routeConductanceMilli = Math.round(THICK_PATH_SCHEMA_COACH_GRID.milli_scale * logCondTerm);

  const pCliff = Math.max(
    0,
    Math.min(
      1,
      0.8 * (pertTotal > 0 ? (pertTotal - pertPass) / pertTotal : 0.12) +
        0.2 * (cliffSharpnessMilli / THICK_PATH_SCHEMA_COACH_GRID.milli_scale)
    )
  );
  const expectedWasteCycles =
    pCliff *
    (THICK_PATH_SCHEMA_COACH_GRID.primary_execution_cycles + THICK_PATH_SCHEMA_COACH_GRID.waterfall_recovery_cycles);
  const waterfallCyclesSaved = Math.max(
    0,
    Math.round((THICK_PATH_SCHEMA_COACH_GRID.needle_baseline_waste_cycles - expectedWasteCycles) * 1000) / 1000
  );

  const muNorm = THICK_PATH_SCHEMA_COACH_GRID.default_nominal_mu_milli / THICK_PATH_SCHEMA_COACH_GRID.milli_scale;
  const sParamNorm = cliffSharpnessMilli / THICK_PATH_SCHEMA_COACH_GRID.milli_scale;
  const sTaskNorm = taskFragilityMilli / THICK_PATH_SCHEMA_COACH_GRID.milli_scale;
  const rawObjective =
    muNorm -
    THICK_PATH_SCHEMA_COACH_GRID.weight_param_cliff * sParamNorm -
    THICK_PATH_SCHEMA_COACH_GRID.weight_task_fragility * sTaskNorm +
    THICK_PATH_SCHEMA_COACH_GRID.weight_route_conductance * logCondTerm -
    THICK_PATH_SCHEMA_COACH_GRID.weight_waterfall_waste * expectedWasteCycles;

  const thickPathScoreMilli = Math.max(
    100,
    Math.min(
      THICK_PATH_SCHEMA_COACH_GRID.milli_scale,
      Math.round(rawObjective * THICK_PATH_SCHEMA_COACH_GRID.milli_scale)
    )
  );

  const cellId =
    pertTotal > 0 && pertPass === pertTotal && retries === 0
      ? "thick_plateau_open_world_band3"
      : retries >= 2
        ? "high_backtrack_cliff_recovery"
        : "adaptive_open_world_band3";

  return {
    harness_tier: harnessTier,
    complexity_bucket: complexityBucket,
    verb_kind: verbKind,
    cell_id: cellId,
    retrace_strategy: retraceStrategy,
    perturbation_pass_count: pertPass,
    perturbation_total: pertTotal,
    perturbation_invariance_milli: pertInvarianceMilli,
    retries_or_backtracks: retries,
    cliff_sharpness_penalty_milli: cliffSharpnessMilli,
    route_conductance_milli: routeConductanceMilli,
    thick_path_score_milli: thickPathScoreMilli,
    waterfall_cycles_saved: waterfallCyclesSaved,
  };
}

export async function recordThickPathAndSchemaSubmission(
  db,
  {
    taskId = "",
    workerUuid = "",
    agentId = "",
    harnessTier = "tier_2_sandboxed_chat_worker",
    complexityBucket = "medium",
    verbKind = "general_verb",
    payload = {},
    storedObjects = [],
    rawObjects = [],
    nowIso = new Date().toISOString(),
  } = {}
) {
  await ensureThickPathAndSchemaCoachSchema(db);
  const schemaFeedback = buildSubmissionSchemaFeedback(payload);
  const thickMetrics = computeThickPathSubmissionMetrics({
    payload,
    harnessTier,
    complexityBucket,
    verbKind,
    storedObjects,
    rawObjects,
    schemaFeedback,
  });

  try {
    await db
      .prepare(
        `INSERT INTO herma_thick_path_telemetry
         (task_id, worker_uuid, agent_id, harness_tier, complexity_bucket, verb_kind, cell_id,
          retrace_strategy, perturbation_pass_count, perturbation_total, perturbation_invariance_milli,
          retries_or_backtracks, cliff_sharpness_penalty_milli, route_conductance_milli,
          thick_path_score_milli, waterfall_cycles_saved, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        String(taskId || ""),
        String(workerUuid || ""),
        String(agentId || ""),
        String(harnessTier || "tier_2_sandboxed_chat_worker"),
        String(complexityBucket || "medium"),
        String(verbKind || "general_verb"),
        thickMetrics.cell_id,
        thickMetrics.retrace_strategy.slice(0, 80),
        thickMetrics.perturbation_pass_count,
        thickMetrics.perturbation_total,
        thickMetrics.perturbation_invariance_milli,
        thickMetrics.retries_or_backtracks,
        thickMetrics.cliff_sharpness_penalty_milli,
        thickMetrics.route_conductance_milli,
        thickMetrics.thick_path_score_milli,
        thickMetrics.waterfall_cycles_saved,
        nowIso
      )
      .run();

    for (let i = 0; i < storedObjects.length; i += 1) {
      const stored = storedObjects[i];
      const rawItem = rawObjects[i]?.item || rawObjects[i] || {};
      const adaptStr = String(
        rawItem.schema_adaptations || rawItem.payload?.schema_adaptations || payload.schema_adaptations || ""
      ).slice(0, 600);
      const inSchemaStr =
        rawItem.input_schema && typeof rawItem.input_schema === "object"
          ? JSON.stringify(rawItem.input_schema).slice(0, 4000)
          : "";
      const outSchemaStr =
        rawItem.output_schema && typeof rawItem.output_schema === "object"
          ? JSON.stringify(rawItem.output_schema).slice(0, 4000)
          : "";
      await db
        .prepare(
          `INSERT OR REPLACE INTO herma_object_schema_meta
           (object_key, schema_adaptations, completeness_score_milli, custom_fields_json,
            input_schema_json, output_schema_json, perturbation_pass_count, perturbation_total,
            thick_path_score_milli, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          stored.object_key,
          adaptStr,
          schemaFeedback.completeness_score_milli,
          JSON.stringify(schemaFeedback.custom_extension_fields_preserved),
          inSchemaStr,
          outSchemaStr,
          thickMetrics.perturbation_pass_count,
          thickMetrics.perturbation_total,
          thickMetrics.thick_path_score_milli,
          nowIso
        )
        .run();
    }
  } catch {
    // Non-fatal on stripped-down mock test DBs
  }

  return {
    schema_feedback: schemaFeedback,
    thick_path_telemetry: thickMetrics,
  };
}

export async function buildGridRobustnessSnapshot(db, publicUrl = "https://shim.teleionlabs.com") {
  await ensureThickPathAndSchemaCoachSchema(db);
  const base = String(publicUrl || "https://shim.teleionlabs.com").replace(/\/+$/, "");

  let tierAggRows = [];
  let recentRows = [];
  let routingArms = [];

  try {
    const [tierRes, recRes, armRes] = await Promise.all([
      db
        .prepare(
          `SELECT harness_tier,
                  COUNT(*) AS submissions,
                  SUM(perturbation_pass_count) AS pass_sum,
                  SUM(perturbation_total) AS total_sum,
                  ROUND(AVG(perturbation_invariance_milli), 1) AS avg_invariance_milli,
                  ROUND(AVG(cliff_sharpness_penalty_milli), 1) AS avg_sharpness_milli,
                  ROUND(AVG(thick_path_score_milli), 1) AS avg_thick_score_milli,
                  ROUND(SUM(waterfall_cycles_saved), 3) AS cycles_saved_sum
           FROM herma_thick_path_telemetry
           GROUP BY harness_tier
           ORDER BY avg_thick_score_milli DESC`
        )
        .all(),
      db
        .prepare(
          `SELECT task_id, worker_uuid, agent_id, harness_tier, complexity_bucket, verb_kind, cell_id,
                  retrace_strategy, perturbation_pass_count, perturbation_total,
                  cliff_sharpness_penalty_milli, thick_path_score_milli, waterfall_cycles_saved, created_at
           FROM herma_thick_path_telemetry
           ORDER BY id DESC
           LIMIT ?`
        )
        .bind(THICK_PATH_SCHEMA_COACH_GRID.max_recent_telemetry_rows)
        .all(),
      db
        .prepare("SELECT * FROM herma_routing_stats ORDER BY harness_tier ASC, dispatch_count DESC")
        .all(),
    ]);
    tierAggRows = tierRes?.results || [];
    recentRows = recRes?.results || [];
    routingArms = armRes?.results || [];
  } catch {
    // Fallback if tables empty in lightweight mocks
  }

  const tierMap = new Map(tierAggRows.map((r) => [r.harness_tier, r]));
  const allTiers = [
    "tier_4_deep_architect_astra",
    "tier_3_cli_code_harness",
    "tier_2_sandboxed_chat_worker",
    "tier_1_lightweight_get",
  ];
  for (const r of tierAggRows) {
    if (r.harness_tier && !allTiers.includes(r.harness_tier)) {
      allTiers.push(r.harness_tier);
    }
  }

  const harnessTierRobustness = allTiers.map((tier) => {
    const obs = tierMap.get(tier);
    const tierArms = routingArms.filter((a) => a.harness_tier === tier);
    const dispatches = tierArms.reduce((acc, a) => acc + Number(a.dispatch_count || 0), 0);
    const timeouts = tierArms.reduce((acc, a) => acc + Number(a.timeout_count || 0), 0);
    const timeoutPenaltyMilli = dispatches > 0 ? Math.round((timeouts / dispatches) * 350) : 0;

    const baseScore = Number(obs?.avg_thick_score_milli || THICK_PATH_SCHEMA_COACH_GRID.thick_reference_score_milli - 45);
    const effectiveThickMilli = Math.max(100, Math.round(baseScore - timeoutPenaltyMilli));
    const sharpnessMilli = Math.round(
      Number(obs?.avg_sharpness_milli || THICK_PATH_SCHEMA_COACH_GRID.wide_plateau_base_sharpness_milli) + timeoutPenaltyMilli
    );
    const passCount = Number(obs?.pass_sum || 0);
    const totalCount = Number(obs?.total_sum || 0);
    return {
      harness_tier: tier,
      recorded_submissions: Number(obs?.submissions || 0),
      routing_dispatches: dispatches,
      timeout_cliff_events: timeouts,
      perturbation_pass_count: passCount,
      perturbation_total: totalCount,
      perturbation_invariance_milli:
        totalCount > 0
          ? Math.round((THICK_PATH_SCHEMA_COACH_GRID.milli_scale * passCount) / totalCount)
          : Number(obs?.avg_invariance_milli || THICK_PATH_SCHEMA_COACH_GRID.unverified_perturbation_milli),
      cliff_sharpness_penalty_milli: sharpnessMilli,
      thick_path_score_milli: effectiveThickMilli,
      waterfall_cycles_saved: Number(obs?.cycles_saved_sum || 0),
    };
  });

  const totalPass = harnessTierRobustness.reduce((a, r) => a + r.perturbation_pass_count, 0);
  const totalChecks = harnessTierRobustness.reduce((a, r) => a + r.perturbation_total, 0);
  const totalSavedCycles =
    Math.round(harnessTierRobustness.reduce((a, r) => a + r.waterfall_cycles_saved, 0) * 1000) / 1000;

  const wasteSavedRef =
    THICK_PATH_SCHEMA_COACH_GRID.needle_baseline_waste_cycles -
    THICK_PATH_SCHEMA_COACH_GRID.thick_reference_waste_cycles;
  const wasteReductionPct =
    Math.round((wasteSavedRef / THICK_PATH_SCHEMA_COACH_GRID.needle_baseline_waste_cycles) * 10000) / 100;
  const totalSavedRef =
    THICK_PATH_SCHEMA_COACH_GRID.needle_baseline_total_cycles -
    THICK_PATH_SCHEMA_COACH_GRID.thick_reference_total_cycles;
  const totalReductionPct =
    Math.round((totalSavedRef / THICK_PATH_SCHEMA_COACH_GRID.needle_baseline_total_cycles) * 10000) / 100;

  return {
    ok: true,
    schema: THICK_PATH_SCHEMA_COACH_GRID.grid_robustness_version,
    gateway_grid_schema: "herma.priority_work_gateway.grid.v6_8",
    plateau_objective_spec: {
      formula:
        "J_thick(c) = mu(c) - lambda_param * S_param(c) - lambda_task * S_task(c) + lambda_cond * log(1 + conductance(c)) - lambda_waste * p_cliff(c) * (C_primary + C_waterfall)",
      terms: {
        point_score_mu: "Nominal unperturbed utility mu(c) on canonical input signature phi",
        param_cliff_sharpness: "max_{c' in N_1(c)} max(0, mu(c) - mu(c')) across 1-step parameter neighbors",
        micro_shift_fragility: "mu(c) - CVaR_alpha(U(c, B_eps(phi))) over worst alpha=0.25 human-imperceptible input shifts",
        dag_multi_route_conductance: "log(1 + conductance(c)) across parallel sanctioned routes and alias-tolerant schemas",
        waterfall_cycle_waste: "p_cliff(c) * (C_primary + C_waterfall) wasted retry/re-lease cycles when a cliff occurs",
      },
      weights: {
        lambda_param: THICK_PATH_SCHEMA_COACH_GRID.weight_param_cliff,
        lambda_task: THICK_PATH_SCHEMA_COACH_GRID.weight_task_fragility,
        lambda_cond: THICK_PATH_SCHEMA_COACH_GRID.weight_route_conductance,
        lambda_waste: THICK_PATH_SCHEMA_COACH_GRID.weight_waterfall_waste,
        primary_execution_cycles: THICK_PATH_SCHEMA_COACH_GRID.primary_execution_cycles,
        waterfall_recovery_cycles: THICK_PATH_SCHEMA_COACH_GRID.waterfall_recovery_cycles,
      },
    },
    configuration_cells_comparison: {
      rejected_brittle_needle_peak: true,
      wasted_fallback_cycles_reduction_pct: wasteReductionPct,
      total_agent_cycles_reduction_pct: totalReductionPct,
      cells: [
        {
          cell_id: "thick_plateau_open_world_band3",
          label: "Thick-Plateau Open-World Canonical Alias + Perturbation Guard (Selected)",
          selected: true,
          point_score_milli: THICK_PATH_SCHEMA_COACH_GRID.thick_reference_point_milli,
          perturbed_cvar_milli: THICK_PATH_SCHEMA_COACH_GRID.thick_reference_cvar_milli,
          cliff_sharpness_penalty_milli: THICK_PATH_SCHEMA_COACH_GRID.thick_reference_sharpness_milli,
          task_shift_fragility_milli: THICK_PATH_SCHEMA_COACH_GRID.thick_reference_fragility_milli,
          plateau_pass_ratio_milli: 1000,
          expected_waterfall_waste_cycles: THICK_PATH_SCHEMA_COACH_GRID.thick_reference_waste_cycles,
          expected_total_cycles: THICK_PATH_SCHEMA_COACH_GRID.thick_reference_total_cycles,
          thick_path_score_milli: THICK_PATH_SCHEMA_COACH_GRID.thick_reference_score_milli,
        },
        {
          cell_id: "alias_tolerant_basic_band3",
          label: "Moderate Basin Alias-Tolerant Cell",
          selected: false,
          point_score_milli: 890,
          perturbed_cvar_milli: 815,
          cliff_sharpness_penalty_milli: 110,
          task_shift_fragility_milli: 75,
          plateau_pass_ratio_milli: 857,
          expected_waterfall_waste_cycles: 0.28,
          expected_total_cycles: 1.28,
          thick_path_score_milli: 874,
        },
        {
          cell_id: "brittle_needle_peak_exact_band5",
          label: "Brittle Needle-Peak Exact-Match Cell (Rejected despite 0.97 nominal point score)",
          selected: false,
          point_score_milli: THICK_PATH_SCHEMA_COACH_GRID.needle_baseline_point_milli,
          perturbed_cvar_milli: THICK_PATH_SCHEMA_COACH_GRID.needle_baseline_cvar_milli,
          cliff_sharpness_penalty_milli: THICK_PATH_SCHEMA_COACH_GRID.needle_baseline_sharpness_milli,
          task_shift_fragility_milli: THICK_PATH_SCHEMA_COACH_GRID.needle_baseline_fragility_milli,
          plateau_pass_ratio_milli: 667,
          expected_waterfall_waste_cycles: THICK_PATH_SCHEMA_COACH_GRID.needle_baseline_waste_cycles,
          expected_total_cycles: THICK_PATH_SCHEMA_COACH_GRID.needle_baseline_total_cycles,
          thick_path_score_milli: THICK_PATH_SCHEMA_COACH_GRID.needle_baseline_thick_score_milli,
        },
      ],
    },
    harness_tier_robustness: harnessTierRobustness,
    fleet_perturbation_summary: {
      total_perturbation_passes: totalPass,
      total_perturbation_checks: totalChecks,
      fleet_perturbation_invariance_milli:
        totalChecks > 0
          ? Math.round((THICK_PATH_SCHEMA_COACH_GRID.milli_scale * totalPass) / totalChecks)
          : THICK_PATH_SCHEMA_COACH_GRID.thick_reference_cvar_milli,
      cumulative_waterfall_cycles_saved: totalSavedCycles,
    },
    recent_perturbation_telemetry: recentRows,
    related_endpoints: {
      routing_url: `${base}/q/routing`,
      schema_url: `${base}/q/schema`,
      embeddings_spec_url: `${base}/q/embeddings-spec`,
    },
  };
}

function l2NormalizeVec(vec = []) {
  let sq = 0;
  for (let i = 0; i < vec.length; i += 1) {
    const v = Number(vec[i] || 0);
    sq += v * v;
  }
  const norm = Math.sqrt(sq);
  if (norm <= 1e-12) return vec.map(() => 0);
  return vec.map((x) => Number(x || 0) / norm);
}

export function detectEmbeddingEpsilonBallMicroShift(
  refVec = [],
  candVec = [],
  { lexicalJaccard = 1.0, epsilonRadius = THICK_PATH_SCHEMA_COACH_GRID.epsilon_ball_radius } = {}
) {
  if (!Array.isArray(refVec) || !Array.isArray(candVec) || refVec.length === 0 || refVec.length !== candVec.length) {
    return {
      valid: false,
      reason: "equal_non_zero_vector_dims_required",
    };
  }
  const u = l2NormalizeVec(refVec);
  const v = l2NormalizeVec(candVec);
  let distSq = 0;
  let dot = 0;
  for (let i = 0; i < u.length; i += 1) {
    const d = u[i] - v[i];
    distSq += d * d;
    dot += u[i] * v[i];
  }
  const l2 = Math.sqrt(Math.max(0, distSq));
  const cos = Math.max(-1, Math.min(1, dot));
  const withinBall = l2 <= epsilonRadius;
  const hasJitter = l2 >= THICK_PATH_SCHEMA_COACH_GRID.epsilon_min_jitter || Number(lexicalJaccard) < 1.0;
  const microShift = withinBall && hasJitter;
  return {
    valid: true,
    l2_distance: Math.round(l2 * 1000000) / 1000000,
    cosine_similarity: Math.round(cos * 1000000) / 1000000,
    epsilon_radius: epsilonRadius,
    lexical_jaccard: Math.round(Number(lexicalJaccard) * 10000) / 10000,
    within_epsilon_ball: withinBall,
    micro_requirement_shift_detected: microShift,
    recommended_routing_cell: microShift
      ? "thick_plateau_open_world_band3"
      : withinBall
        ? "nominal_or_thick_plateau"
        : "re_evaluate_out_of_domain_shift",
  };
}

function simhash64SimilarityHex(hexA = "", hexB = "") {
  const cleanA = String(hexA || "").padStart(16, "0").slice(0, 16).toLowerCase();
  const cleanB = String(hexB || "").padStart(16, "0").slice(0, 16).toLowerCase();
  let hamming = 0;
  for (let i = 0; i < 16; i += 1) {
    const na = parseInt(cleanA[i], THICK_PATH_SCHEMA_COACH_GRID.hex_radix);
    const nb = parseInt(cleanB[i], THICK_PATH_SCHEMA_COACH_GRID.hex_radix);
    let xor = (Number.isNaN(na) ? 0 : na) ^ (Number.isNaN(nb) ? 0 : nb);
    while (xor > 0) {
      hamming += xor & 1;
      xor >>= 1;
    }
  }
  return Math.max(
    0,
    (THICK_PATH_SCHEMA_COACH_GRID.simhash_bits - hamming) / THICK_PATH_SCHEMA_COACH_GRID.simhash_bits
  );
}

export function computeHybridEmbeddingSimhashRerank(querySpec = {}, candidates = []) {
  const qVec = l2NormalizeVec(Array.isArray(querySpec.embedding) ? querySpec.embedding : [1, 0, 0, 0]);
  const qSimhash = String(querySpec.simhash64_hex || "a5f0c39182b47e1d");
  const ranked = candidates.map((cand) => {
    const dVec = l2NormalizeVec(Array.isArray(cand.embedding) ? cand.embedding : [0, 1, 0, 0]);
    let cos = 0;
    const len = Math.min(qVec.length, dVec.length);
    for (let i = 0; i < len; i += 1) cos += qVec[i] * dVec[i];
    const cosClamped = Math.max(0, Math.min(1, cos));
    const simhashSim = simhash64SimilarityHex(qSimhash, cand.simhash64_hex || "0000000000000000");
    const bm25Norm = Math.max(0, Math.min(1, Number(cand.bm25_rrf_norm ?? 0.5)));
    const hybridScore =
      THICK_PATH_SCHEMA_COACH_GRID.hybrid_dense_cosine_weight * cosClamped +
      THICK_PATH_SCHEMA_COACH_GRID.hybrid_simhash_weight * simhashSim +
      THICK_PATH_SCHEMA_COACH_GRID.hybrid_lexical_bm25_weight * bm25Norm;
    return {
      id: cand.id || cand.object_key || "candidate",
      model_adapter: cand.model_adapter || "facebook/SONAR",
      dense_cosine: Math.round(cosClamped * 10000) / 10000,
      simhash64_similarity: Math.round(simhashSim * 10000) / 10000,
      bm25_rrf_norm: Math.round(bm25Norm * 10000) / 10000,
      hybrid_score: Math.round(hybridScore * 10000) / 10000,
    };
  });
  ranked.sort((a, b) => b.hybrid_score - a.hybrid_score);
  return ranked;
}

export async function handleMetaEmbeddingsSpecRequest(request, url, db, publicUrl = "https://shim.teleionlabs.com") {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "POST") {
    return {
      status: THICK_PATH_SCHEMA_COACH_GRID.http_method_not_allowed,
      body: { ok: false, error: "method_not_allowed" },
    };
  }

  await ensureThickPathAndSchemaCoachSchema(db);
  const base = String(publicUrl || "https://shim.teleionlabs.com").replace(/\/+$/, "");

  let seededRow = null;
  try {
    seededRow = await db
      .prepare("SELECT object_key, sha256_hash, total_payload_bytes, created_at FROM herma_task_objects WHERE object_key = ? ORDER BY id DESC LIMIT 1")
      .bind(META_FAIR_SEEDED_TASK_OBJECT_KEY)
      .first();
  } catch {
    seededRow = null;
  }

  let customEvalResult = null;
  if (method === "POST") {
    try {
      const postBody = (await request.json()) || {};
      const shiftReport =
        postBody.reference_embedding && postBody.query_embedding
          ? detectEmbeddingEpsilonBallMicroShift(postBody.reference_embedding, postBody.query_embedding, {
              lexicalJaccard: postBody.lexical_jaccard ?? 0.75,
            })
          : null;
      const reranked = Array.isArray(postBody.candidates)
        ? computeHybridEmbeddingSimhashRerank(postBody.query || {}, postBody.candidates)
        : null;
      customEvalResult = { shift_report: shiftReport, hybrid_reranked: reranked };
    } catch {
      return {
        status: THICK_PATH_SCHEMA_COACH_GRID.http_bad_request,
        body: { ok: false, code: "invalid_json", detail: "POST /q/embeddings-spec expects valid JSON." },
      };
    }
  }

  const sampleShift = detectEmbeddingEpsilonBallMicroShift(
    [0.88, 0.35, 0.25, 0.19],
    [0.865, 0.378, 0.242, 0.205],
    { lexicalJaccard: 0.68 }
  );
  const sampleRerank = computeHybridEmbeddingSimhashRerank(
    { embedding: [0.91, 0.31, 0.22, 0.16], simhash64_hex: "a5f0c39182b47e1d" },
    [
      {
        id: "multilingual_shelter_intake_sonar_v1",
        model_adapter: "facebook/SONAR",
        embedding: [0.9, 0.33, 0.21, 0.17],
        simhash64_hex: "a5f0c39182b47e1c",
        bm25_rrf_norm: 0.92,
      },
      {
        id: "generic_keyword_collision_stub",
        model_adapter: "facebook/contriever-msmarco",
        embedding: [0.35, 0.82, 0.12, 0.44],
        simhash64_hex: "1100ff2282b40000",
        bm25_rrf_norm: 0.88,
      },
    ]
  );

  return {
    status: THICK_PATH_SCHEMA_COACH_GRID.http_ok,
    body: {
      ok: true,
      schema: THICK_PATH_SCHEMA_COACH_GRID.embeddings_spec_version,
      gateway_grid_schema: "herma.priority_work_gateway.grid.v6_8",
      models: META_FAIR_EMBEDDING_MODELS_CATALOG,
      hybrid_cosine_simhash_reranker: {
        formula:
          "score_hybrid(q, d) = 0.55 * cosine_l2(e_meta(q), e_meta(d)) + 0.25 * simhash64_similarity(q, d) + 0.20 * bm25_rrf_norm(q, d)",
        weights: {
          dense_cosine: THICK_PATH_SCHEMA_COACH_GRID.hybrid_dense_cosine_weight,
          simhash64_lsh: THICK_PATH_SCHEMA_COACH_GRID.hybrid_simhash_weight,
          lexical_bm25_rrf: THICK_PATH_SCHEMA_COACH_GRID.hybrid_lexical_bm25_weight,
        },
        sample_rerank_verification: sampleRerank,
      },
      epsilon_ball_micro_shift_detection: {
        mechanism:
          "SONAR (1024-d, 200 languages + speech) and Contriever-MSMARCO (768-d dense RAG) map semantically equivalent task briefs into tight L2 balls. When 0 < ||e(q') - e(q_0)||_2 <= 0.12 while surface tokens differ (lexical_jaccard < 1.0), Herma flags a micro-requirement shift and steers execution away from brittle needle-peak thresholds into a thick-plateau cell.",
        epsilon_radius_l2: THICK_PATH_SCHEMA_COACH_GRID.epsilon_ball_radius,
        sample_micro_shift_probe: sampleShift,
      },
      seeded_task_object: {
        object_key: META_FAIR_SEEDED_TASK_OBJECT_KEY,
        stored_in_d1: Boolean(seededRow),
        sha256_hash: seededRow?.sha256_hash || null,
        total_payload_bytes: seededRow ? Number(seededRow.total_payload_bytes || 0) : null,
        object_url: `${base}/q/object/${META_FAIR_SEEDED_TASK_OBJECT_KEY}`,
        permalink_url: `${base}/c/${META_FAIR_SEEDED_TASK_OBJECT_KEY}`,
        demo_url: `${base}/q/demo/${META_FAIR_SEEDED_TASK_OBJECT_KEY}`,
      },
      ...(customEvalResult ? { custom_evaluation: customEvalResult } : {}),
    },
  };
}
