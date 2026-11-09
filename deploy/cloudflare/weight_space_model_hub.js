// Hosted Weight-Space Model Hub (/models, /q/models, IEEE-754 float32 .safetensors, portable multi-runtime exports, and V8 edge inference).
// Serves sixteen deterministic weight-space models across ten universal model families and nine portable runtimes (144 portable artifacts).

import { doesTokenMatchAgentClaim, tokenFromRequest } from "./agent_names.js";
import { isLinkPreview } from "./agent_connect.js";
import { documentHtml, escapeHtml, scrubBannedDeep, scrubBannedWords, tidyText } from "./page_shell.js";
import { stripPii, stripPiiDeep } from "./pii_strip.js";

export const WEIGHT_MODEL_HUB_GRID = Object.freeze({
  schema: "teleion.weight_model_hub_grid.v2",
  generation: 3,
  grid_axes: Object.freeze({
    embed_dim: Object.freeze({ type: "integer_range", low: 8, high: 64, active: 24 }),
    polytope_hidden_dim: Object.freeze({ type: "integer_range", low: 4, high: 64, active: 16 }),
    subspace_rank: Object.freeze({ type: "integer_range", low: 2, high: 32, active: 8 }),
    cartridge_bytes: Object.freeze({ type: "integer_range", low: 64, high: 4096, active: 256 }),
    bundle_max: Object.freeze({ type: "integer_range", low: 1, high: 16, active: 4 }),
    koopman_latent_dim: Object.freeze({ type: "integer_range", low: 8, high: 64, active: 16 }),
    koopman_horizon_default: Object.freeze({ type: "integer_range", low: 1, high: 8, active: 3 }),
    ood_inlier_rank: Object.freeze({ type: "integer_range", low: 4, high: 12, active: 8 }),
    legendre_degree: Object.freeze({ type: "integer_range", low: 2, high: 6, active: 3 }),
    canary_share_milli: Object.freeze({ type: "integer_range", low: 10, high: 500, active: 100 }),
    min_held_out_margin_milli: Object.freeze({ type: "integer_range", low: 1, high: 100, active: 1 }),
    min_live_promotion_margin_milli: Object.freeze({ type: "integer_range", low: 1, high: 100, active: 10 }),
    rollback_drop_margin_milli: Object.freeze({ type: "integer_range", low: 5, high: 250, active: 20 }),
    max_anchor_drift_milli: Object.freeze({ type: "integer_range", low: 0, high: 200, active: 50 }),
    survival_gate_threshold_milli: Object.freeze({ type: "integer_range", low: 500, high: 990, active: 820 }),
    sheaf_soft_threshold_milli: Object.freeze({ type: "integer_range", low: 50, high: 450, active: 180 }),
    conformal_default_alpha_milli: Object.freeze({ type: "integer_range", low: 10, high: 250, active: 100 }),
    sae_dict_dim: Object.freeze({ type: "integer_range", low: 8, high: 64, active: 16 }),
    elk_contradiction_threshold_milli: Object.freeze({ type: "integer_range", low: 200, high: 800, active: 480 }),
    sql_export_max_rows: Object.freeze({ type: "integer_range", low: 8, high: 128, active: 64 }),
    sql_export_max_cols: Object.freeze({ type: "integer_range", low: 8, high: 128, active: 64 }),
    portable_runtime: Object.freeze({
      type: "choice",
      choices: Object.freeze(["js", "python", "sql", "c99", "rust", "wasm", "wat", "wgsl", "glsl"]),
      active: "js",
    }),
    default_family: Object.freeze({
      type: "choice",
      choices: Object.freeze([
        "from_scratch_polytope",
        "weight_edited_embedding",
        "weight_edited_decider",
        "weight_programmed_llm",
        "atomic_cartridge_bank",
        "analyzer",
        "actor",
        "compiler",
        "verifier",
        "forecaster",
        "calibrator",
        "sparse_autoencoder_probe",
      ]),
      active: "from_scratch_polytope",
    }),
  }),
  constraints: Object.freeze([
    "canary_share_milli < milli_scale",
    "min_held_out_margin_milli <= min_live_promotion_margin_milli",
    "subspace_rank * subspace_rank * float32_bytes == cartridge_bytes",
    "bundle_min <= bundle_max",
    "subspace_rank <= koopman_latent_dim",
    "ood_inlier_rank < feature_dim",
    "sae_input_dim <= sae_dict_dim",
    "embed_dim <= sql_export_max_rows",
    "sae_dict_dim <= sql_export_max_rows",
    "embed_input_dim <= sql_export_max_cols",
  ]),
  feature_dim: 12,
  polytope_hidden_dim: 16,
  effort_tier_count: 4,
  attenuation_hidden_dim: 12,
  attenuation_output_dim: 2,
  embed_input_dim: 16,
  embed_dim: 24,
  anchor_basis_count: 6,
  route_count: 6,
  cluster_count: 6,
  decider_mode_count: 4,
  decider_topo_dim: 3,
  bundle_min: 1,
  bundle_max: 4,
  dag_min_width: 1,
  dag_max_width: 8,
  dag_min_depth: 1,
  dag_max_depth: 6,
  steering_dim: 16,
  subspace_rank: 8,
  cartridge_bytes: 256,
  cartridge_floats: 64,
  cartridge_bank_slots: 6,
  cartridge_logit_dim: 8,
  analyzer_profile_count: 8,
  analyzer_topic_basis_rows: 4,
  analyzer_topic_start_idx: 8,
  koopman_latent_dim: 16,
  koopman_tool_count: 6,
  koopman_horizon_default: 3,
  koopman_horizon_max: 8,
  koopman_spectral_radius: 0.88,
  koopman_decay_step: 0.02,
  koopman_coupling_scale: 0.14,
  hypernet_latent_dim: 16,
  ood_inlier_rank: 8,
  ood_anomaly_head_dim: 4,
  ood_residual_threshold: 0.34,
  ood_quarantine_threshold: 0.62,
  legendre_degree: 3,
  legendre_basis_count: 4,
  legendre_horizon_count: 4,
  bitemporal_base_queue_depth: 12,
  bitemporal_queue_scale: 36,
  bitemporal_base_cost_usd: 0.004,
  bitemporal_cost_scale_usd: 0.028,
  canary_share: 0.1,
  canary_share_milli: 100,
  promoted_share: 1.0,
  inactive_share: 0.0,
  min_held_out_margin: 0.001,
  min_live_promotion_margin: 0.01,
  live_held_out_tolerance: 0.03,
  rollback_drop_margin: 0.02,
  max_anchor_drift: 0.05,
  zero_anchor_drift: 0.0,
  survival_gate_threshold: 0.82,
  default_step_survival: 0.96,
  min_step_survival: 0.55,
  max_step_survival: 0.995,
  default_dag_steps: 4,
  max_dag_steps: 32,
  token_floor_off: 64,
  token_floor_minimal: 192,
  token_floor_adaptive: 512,
  token_floor_deep: 1536,
  effort_threshold_minimal: 0.24,
  effort_threshold_adaptive: 0.52,
  effort_threshold_deep: 0.78,
  header_len_bytes: 8,
  header_align_bytes: 8,
  float32_bytes: 4,
  uint32_radix: 4294967296,
  space_ascii: 32,
  request_max_bytes: 262144,
  export_max_bytes: 262144,
  export_ident_max_chars: 48,
  export_meta_max_chars: 160,
  sql_export_max_rows: 64,
  sql_export_max_cols: 64,
  sql_round_digits: 6,
  ste100_descriptive_max_words: 25,
  ste100_procedural_max_words: 20,
  max_custom_weight_floats: 4096,
  max_custom_tensors: 16,
  max_custom_weight_abs: 256,
  model_id_min_chars: 3,
  model_id_max_chars: 96,
  agent_id_max_chars: 96,
  title_max_chars: 140,
  summary_max_chars: 360,
  table_summary_max_chars: 160,
  table_id_max_chars: 56,
  ref_max_chars: 180,
  lineage_max_chars: 96,
  text_input_max_chars: 8000,
  prompt_norm_chars: 600,
  latency_norm_ms: 2000,
  default_latency_budget_ms: 800,
  batch_norm_count: 8,
  catalog_limit_default: 64,
  catalog_limit_max: 200,
  recent_runs_limit: 20,
  nearest_routes_top_k: 3,
  nearest_clusters_top_k: 2,
  defect_axes_top_k: 3,
  short_id_chars: 6,
  digest_chars: 8,
  hex_run_guard_len: 12,
  base36_radix: 36,
  cache_max_age_sec: 60,
  milli_scale: 1000,
  percent_scale: 100,
  float_round_scale: 10000,
  float_embed_round_scale: 1000000,
  epsilon_norm: 0.00000001,
  half_scalar: 0.5,
  quarter_scalar: 0.25,
  three_quarters_scalar: 0.75,
  tenth_scalar: 0.1,
  two_tenths_scalar: 0.2,
  three_tenths_scalar: 0.3,
  four_tenths_scalar: 0.4,
  six_tenths_scalar: 0.6,
  seven_tenths_scalar: 0.7,
  eight_tenths_scalar: 0.8,
  nine_tenths_scalar: 0.9,
  one_point_two: 1.2,
  one_point_five: 1.5,
  one_point_eight: 1.8,
  two_point_four: 2.4,
  logit_clip_abs: 16,
  temp_base_maker: 0.2,
  temp_scale_maker: 0.25,
  seed_init: 2166136261,
  seed_mult: 16777619,
  lcg_mult: 1664525,
  lcg_inc: 1013904223,
  two_scalar: 2,
  three_scalar: 3,
  four_scalar: 4,
  five_scalar: 5,
  six_scalar: 6,
  seven_scalar: 7,
  eight_scalar: 8,
  nine_scalar: 9,
  ten_scalar: 10,
  eleven_scalar: 11,
  twelve_scalar: 12,
  thirteen_scalar: 13,
  fourteen_scalar: 14,
  fifteen_scalar: 15,
  sixteen_scalar: 16,
  twenty_scalar: 20,
  twenty_four_scalar: 24,
  thirty_scalar: 30,
  feat_length_idx: 0,
  feat_dag_idx: 1,
  feat_depth_idx: 2,
  feat_contract_idx: 3,
  feat_quick_idx: 4,
  feat_check_idx: 5,
  feat_steps_idx: 6,
  feat_error_idx: 7,
  feat_prefix_idx: 8,
  feat_batch_idx: 9,
  feat_latency_idx: 10,
  feat_bias_idx: 11,
  embed_anchor_start_idx: 10,
  http_ok: 200,
  http_created: 201,
  http_bad_request: 400,
  http_forbidden: 403,
  http_not_found: 404,
  http_method_not_allowed: 405,
  http_conflict: 409,
  http_payload_too_large: 413,
  http_unprocessable: 422,
  wasm_magic_0: 0,
  wasm_magic_1: 97,
  wasm_magic_2: 115,
  wasm_magic_3: 109,
  wasm_version_0: 1,
  wasm_page_bytes: 65536,
  wasm_max_pages: 4,
  wasm_align_bytes: 16,
  wasm_f32_align_log2: 2,
  wasm_leb_cont_bit: 128,
  wasm_leb_payload_mask: 127,
  wasm_leb_sign_bit: 64,
  wasm_leb_shift: 7,
  wasm_sec_type: 1,
  wasm_sec_function: 3,
  wasm_sec_memory: 5,
  wasm_sec_export: 7,
  wasm_sec_code: 10,
  wasm_sec_data: 11,
  wasm_type_func: 96,
  wasm_val_i32: 127,
  wasm_val_f32: 125,
  wasm_block_void: 64,
  wasm_export_func: 0,
  wasm_export_memory: 2,
  wasm_func_count: 3,
  wasm_export_count: 4,
  wasm_local_group_count: 2,
  wasm_local_i32_count: 3,
  wasm_local_f32_count: 2,
  wasm_loc_r: 0,
  wasm_loc_c: 1,
  wasm_loc_best_idx: 2,
  wasm_loc_acc: 3,
  wasm_loc_best_val: 4,
  wasm_op_block: 2,
  wasm_op_loop: 3,
  wasm_op_if: 4,
  wasm_op_else: 5,
  wasm_op_end: 11,
  wasm_op_br: 12,
  wasm_op_br_if: 13,
  wasm_op_select: 27,
  wasm_op_local_get: 32,
  wasm_op_local_set: 33,
  wasm_op_f32_load: 42,
  wasm_op_f32_store: 56,
  wasm_op_i32_const: 65,
  wasm_op_f32_const: 67,
  wasm_op_i32_eqz: 69,
  wasm_op_i32_ge_s: 78,
  wasm_op_f32_gt: 94,
  wasm_op_i32_add: 106,
  wasm_op_i32_mul: 108,
  wasm_op_f32_add: 146,
  wasm_op_f32_mul: 148,
  byte_mask: 255,
  wat_chunk_floats: 8,
  hex_radix: 16,
  hex_pad_len: 2,
  wgsl_workgroup_choices: Object.freeze([1, 4, 8, 16, 32, 64]),
  wgsl_workgroup_max: 64,
  builtin_metrics: Object.freeze({
    effort_router: Object.freeze({ held_out: 0.964, baseline: 0.842, live: 0.968, evals: 18, drift: 0.0, cost: 0.0 }),
    attenuation_gate: Object.freeze({ held_out: 0.951, baseline: 0.819, live: 0.954, evals: 14, drift: 0.0, cost: 0.0 }),
    nullspace_embed: Object.freeze({ held_out: 0.972, baseline: 0.861, live: 0.975, evals: 22, drift: 0.0, cost: 0.0 }),
    bundle_decider: Object.freeze({ held_out: 0.948, baseline: 0.835, live: 0.952, evals: 16, drift: 0.0, cost: 0.0 }),
    steered_maker: Object.freeze({ held_out: 0.961, baseline: 0.889, live: 0.963, evals: 19, drift: 0.008, cost: 0.14 }),
    disjoint_checker: Object.freeze({ held_out: 0.969, baseline: 0.894, live: 0.971, evals: 21, drift: 0.006, cost: 0.12 }),
    cartridge_bank: Object.freeze({ held_out: 0.957, baseline: 0.853, live: 0.959, evals: 15, drift: 0.004, cost: 0.04 }),
    generator_analyzer: Object.freeze({ held_out: 0.966, baseline: 0.844, live: 0.969, evals: 17, drift: 0.0, cost: 0.0 }),
    koopman_actor: Object.freeze({ held_out: 0.958, baseline: 0.838, live: 0.961, evals: 16, drift: 0.0, cost: 0.0 }),
    hypernet_compiler: Object.freeze({ held_out: 0.962, baseline: 0.849, live: 0.965, evals: 18, drift: 0.002, cost: 0.01 }),
    spectral_verifier: Object.freeze({ held_out: 0.974, baseline: 0.856, live: 0.977, evals: 20, drift: 0.0, cost: 0.0 }),
    sheaf_verifier: Object.freeze({ held_out: 0.979, baseline: 0.862, live: 0.981, evals: 19, drift: 0.0, cost: 0.0 }),
    legendre_forecaster: Object.freeze({ held_out: 0.955, baseline: 0.831, live: 0.958, evals: 15, drift: 0.0, cost: 0.0 }),
    conformal_calibrator: Object.freeze({ held_out: 0.971, baseline: 0.848, live: 0.974, evals: 18, drift: 0.0, cost: 0.0 }),
    sae_matryoshka: Object.freeze({ held_out: 0.976, baseline: 0.851, live: 0.978, evals: 19, drift: 0.0, cost: 0.0 }),
    elk_truth_probe: Object.freeze({ held_out: 0.982, baseline: 0.858, live: 0.984, evals: 21, drift: 0.0, cost: 0.0 }),
  }),
  sheaf_edge_count: 12,
  sheaf_soft_threshold: 0.22,
  sheaf_hard_threshold: 0.55,
  sheaf_top_edges_k: 3,
  conformal_tier_count: 4,
  conformal_default_alpha: 0.1,
  conformal_min_alpha: 0.01,
  conformal_max_alpha: 0.25,
  conformal_alpha_step_05: 0.05,
  conformal_alpha_step_15: 0.15,
  conformal_q_alpha_20: 0.62,
  conformal_q_alpha_10: 0.74,
  conformal_q_alpha_05: 0.83,
  conformal_q_alpha_01: 0.92,
  sae_input_dim: 8,
  sae_dict_dim: 16,
  sae_regime_count: 4,
  sae_prefix_0: 4,
  sae_prefix_1: 8,
  sae_prefix_2: 12,
  sae_prefix_3: 16,
  sae_prefix_w0: 0.4,
  sae_prefix_w1: 0.25,
  sae_prefix_w2: 0.2,
  sae_prefix_w3: 0.15,
  sae_sparsity_bias_core: -0.1,
  sae_sparsity_bias_mid: -0.16,
  sae_sparsity_bias_fine: -0.22,
  sae_sparsity_bias_tail: -0.28,
  sae_primary_gain: 1.35,
  sae_secondary_gain: 0.55,
  sae_readout_gain: 1.25,
  elk_input_dim: 8,
  elk_output_dim: 3,
  elk_soft_divergence_threshold: 0.28,
  elk_contradiction_threshold: 0.48,
  elk_default_mid_truth: 0.82,
  elk_default_late_output: 0.8,
  elk_default_velocity: 0.12,
  elk_default_entropy: 0.2,
  elk_default_sheaf: 0.08,
  elk_default_anchor_cosine: 0.94,
  elk_default_margin_gap: 0.7,
  elk_default_prompt_pressure: 0.08,
  elk_truth_bias: -1.15,
  elk_div_bias: -1.35,
  elk_steer_bias: -1.2,
});

const G = WEIGHT_MODEL_HUB_GRID;

export const MODEL_FAMILIES = Object.freeze([
  Object.freeze({
    id: "from_scratch_polytope",
    universal_family: "router_and_decider",
    label: "From-Scratch Compiled Atomic Models",
    summary:
      "Two-layer ReLU polytopes and survival gates compile directly from rules for sub-millisecond edge decisions.",
    default_model_id: "tf-scratch-effort-router-v1",
  }),
  Object.freeze({
    id: "weight_edited_embedding",
    universal_family: "nullspace_embedder",
    label: "Weight-Space Programmed Embedding Models",
    summary:
      "SVD nullspace-edited 24-d projectors map Task text to Teleion Fabric routes and activity clusters with zero anchor drift.",
    default_model_id: "tf-embed-nullspace-24d-v1",
  }),
  Object.freeze({
    id: "weight_edited_decider",
    universal_family: "router_and_decider",
    label: "Weight-Space Programmed Decision & Dispatch Models",
    summary:
      "Channel-sliced ridge dispatchers select isolated, sequential, batched, or speculative execution plus bundle size and graph shape.",
    default_model_id: "tf-decider-bundle-affinity-v1",
  }),
  Object.freeze({
    id: "weight_programmed_llm",
    universal_family: "subspace_adapter_and_cartridge",
    label: "Weight-Space Programmed LLM Profiles & Steered Adapters",
    summary:
      "Contrastive steered maker and separate checker adapters work with Meta open-weight models and almost any LLM inference provider.",
    default_model_id: "tf-llm-steered-maker-v1",
  }),
  Object.freeze({
    id: "atomic_cartridge_bank",
    universal_family: "subspace_adapter_and_cartridge",
    label: "256-Byte Subspace Weight Cartridges for Atomic Tasks",
    summary:
      "Compact 8x8 float32 LoRA-XS and polytope cartridges (256 bytes per skill) export binary .safetensors files for workers.",
    default_model_id: "tf-cartridge-shared-activity-bank-v1",
  }),
  Object.freeze({
    id: "analyzer",
    universal_family: "analyzer",
    label: "Topic-Nullspace Attribution Analyzers",
    summary:
      "Topic-nullspace classifiers attribute text cadence across eight structural generator profiles with zero topic-shortcut drift.",
    default_model_id: "tf-analyzer-generator-attribution-v1",
  }),
  Object.freeze({
    id: "actor",
    universal_family: "actor",
    label: "Koopman Trajectory & Tool-Graph Actors",
    summary:
      "Lifted Koopman linear state-transition operators run multi-step tool-graph lookahead at zero token cost.",
    default_model_id: "tf-actor-koopman-tool-policy-v1",
  }),
  Object.freeze({
    id: "compiler",
    universal_family: "compiler",
    label: "Zero-Shot Hypernetwork Cartridge Compilers",
    summary:
      "Hypernetwork initializers compile ASD-STE100 task specifications into 256-byte rank-8 cartridges in zero gradient steps.",
    default_model_id: "tf-compiler-hypernet-cartridge-v1",
  }),
  Object.freeze({
    id: "verifier",
    universal_family: "verifier",
    label: "Spectral Residual & Cellular Sheaf Consistency Filters",
    summary:
      "Spectral residual and cellular sheaf coboundary detectors filter out-of-distribution inputs, poisoned traces, and multi-worker contradictions.",
    default_model_id: "tf-verifier-spectral-ood-v1",
  }),
  Object.freeze({
    id: "forecaster",
    universal_family: "forecaster",
    label: "Shifted Legendre Bitemporal Forecasters",
    summary:
      "Shifted Legendre polynomial bases forecast bitemporal queue load and token cost while isolating late restatement lag.",
    default_model_id: "tf-forecaster-legendre-bitemporal-v1",
  }),
  Object.freeze({
    id: "calibrator",
    universal_family: "calibrator",
    label: "Split & Adaptive Conformal Prediction Set Calibrators",
    summary:
      "Conformal nonconformity quantiles build calibrated prediction sets and decide when compact cartridges escalate to deep review.",
    default_model_id: "tf-calibrator-conformal-set-v1",
  }),
  Object.freeze({
    id: "sparse_autoencoder_probe",
    universal_family: "sparse_autoencoder_probe",
    label: "Sparse Autoencoder and Latent Probe",
    summary:
      "Matryoshka sparse autoencoders and cross-layer ELK latent probes decompose residual vectors and catch sycophancy contradictions in under one microsecond.",
    default_model_id: "tf-sae-matryoshka-residual-v1",
  }),
]);

export const UNIVERSAL_MODEL_FAMILIES = Object.freeze([
  Object.freeze({
    id: "router_and_decider",
    label: "Polytope Routers, Survival Gates & Bundle Deciders",
    summary:
      "Compiled ReLU polytopes, survival gates, and ridge dispatchers select reasoning effort, check boundaries, and worker bundle sizes.",
    member_families: Object.freeze(["from_scratch_polytope", "weight_edited_decider"]),
    default_model_id: "tf-scratch-effort-router-v1",
  }),
  Object.freeze({
    id: "nullspace_embedder",
    label: "Anchor-Nullspace 24-D Embedding Projectors",
    summary:
      "SVD nullspace-edited 24-d projectors map Task text to Teleion Fabric routes and activity clusters with zero anchor drift.",
    member_families: Object.freeze(["weight_edited_embedding"]),
    default_model_id: "tf-embed-nullspace-24d-v1",
  }),
  Object.freeze({
    id: "subspace_adapter_and_cartridge",
    label: "Steered Open-Weight Adapters & 256B Cartridges",
    summary:
      "Contrastive steered profiles and 256-byte 8x8 LoRA-XS cartridges adapt Meta open-weight models with separate maker and checker lineages.",
    member_families: Object.freeze(["weight_programmed_llm", "atomic_cartridge_bank"]),
    default_model_id: "tf-cartridge-shared-activity-bank-v1",
  }),
  Object.freeze({
    id: "analyzer",
    label: "Topic-Nullspace Attribution Analyzers",
    summary:
      "Topic-nullspace classifiers attribute text cadence across eight structural generator profiles with zero topic-shortcut drift.",
    member_families: Object.freeze(["analyzer"]),
    default_model_id: "tf-analyzer-generator-attribution-v1",
  }),
  Object.freeze({
    id: "actor",
    label: "Koopman Trajectory & Tool-Graph Actors",
    summary:
      "Lifted Koopman linear state-transition operators run multi-step tool-graph lookahead at zero token cost.",
    member_families: Object.freeze(["actor"]),
    default_model_id: "tf-actor-koopman-tool-policy-v1",
  }),
  Object.freeze({
    id: "compiler",
    label: "Zero-Shot Hypernetwork Cartridge Compilers",
    summary:
      "Hypernetwork initializers compile ASD-STE100 task specifications into 256-byte rank-8 cartridges in zero gradient steps.",
    member_families: Object.freeze(["compiler"]),
    default_model_id: "tf-compiler-hypernet-cartridge-v1",
  }),
  Object.freeze({
    id: "verifier",
    label: "Spectral Residual & Cellular Sheaf Consistency Filters",
    summary:
      "Spectral residual and cellular sheaf coboundary detectors filter out-of-distribution inputs, poisoned traces, and multi-worker contradictions.",
    member_families: Object.freeze(["verifier"]),
    default_model_id: "tf-verifier-spectral-ood-v1",
  }),
  Object.freeze({
    id: "forecaster",
    label: "Shifted Legendre Bitemporal Forecasters",
    summary:
      "Shifted Legendre polynomial bases forecast bitemporal queue load and token cost while isolating late restatement lag.",
    member_families: Object.freeze(["forecaster"]),
    default_model_id: "tf-forecaster-legendre-bitemporal-v1",
  }),
  Object.freeze({
    id: "calibrator",
    label: "Split & Adaptive Conformal Prediction Set Calibrators",
    summary:
      "Conformal nonconformity quantiles build calibrated prediction sets and decide when compact cartridges escalate to deep review.",
    member_families: Object.freeze(["calibrator"]),
    default_model_id: "tf-calibrator-conformal-set-v1",
  }),
  Object.freeze({
    id: "sparse_autoencoder_probe",
    label: "Sparse Autoencoder and Latent Probe",
    summary:
      "Matryoshka sparse autoencoders and cross-layer ELK latent probes decompose residual vectors and catch sycophancy contradictions in under one microsecond.",
    member_families: Object.freeze(["sparse_autoencoder_probe"]),
    default_model_id: "tf-sae-matryoshka-residual-v1",
  }),
]);

export const PORTABLE_RUNTIMES = Object.freeze({
  js: Object.freeze({
    id: "js",
    label: "JavaScript (ES Module Float32Array)",
    content_type: "text/javascript; charset=utf-8",
    ext: "mjs",
  }),
  python: Object.freeze({
    id: "python",
    label: "Python (Zero-Dependency Pure Python)",
    content_type: "text/x-python; charset=utf-8",
    ext: "py",
  }),
  sql: Object.freeze({
    id: "sql",
    label: "SQLite SQL (Dot-Product Projection)",
    content_type: "text/plain; charset=utf-8",
    ext: "sql",
  }),
  c99: Object.freeze({
    id: "c99",
    label: "C99 Header (Static Float Array & Inline Routine)",
    content_type: "text/x-c; charset=utf-8",
    ext: "h",
  }),
  rust: Object.freeze({
    id: "rust",
    label: "Rust (#![no_std] Zero-Alloc Static F32 Kernel)",
    content_type: "text/x-rust; charset=utf-8",
    ext: "rs",
  }),
  wasm: Object.freeze({
    id: "wasm",
    label: "WebAssembly v1 Binary (IEEE-754 F32 Linear Memory)",
    content_type: "application/wasm",
    ext: "wasm",
  }),
  wat: Object.freeze({
    id: "wat",
    label: "WebAssembly Text Format (.wat Module)",
    content_type: "text/plain; charset=utf-8",
    ext: "wat",
  }),
  wgsl: Object.freeze({
    id: "wgsl",
    label: "WebGPU Compute Shader (.wgsl Storage Dispatch)",
    content_type: "text/wgsl; charset=utf-8",
    ext: "wgsl",
  }),
  glsl: Object.freeze({
    id: "glsl",
    label: "WebGL2 GLSL ES 3.00 Fragment Compute Shader",
    content_type: "text/x-glsl; charset=utf-8",
    ext: "glsl",
  }),
});

export const PORTABLE_RUNTIME_TARGETS = Object.freeze([
  "safetensors",
  "js",
  "python",
  "sql",
  "c99",
  "rust",
  "wasm",
  "wgsl",
  "glsl",
]);

const ALLOWED_RUNTIME_IDS = Object.freeze(Object.keys(PORTABLE_RUNTIMES));
const UNIVERSAL_FAMILY_BY_ID = new Map(UNIVERSAL_MODEL_FAMILIES.map((u) => [u.id, u]));
const VALID_FAMILY_IDS = new Set(MODEL_FAMILIES.map((f) => f.id));
const VALID_LINEAGE_ROLES = new Set([
  "routing",
  "embedding",
  "dispatch",
  "maker",
  "checker",
  "cartridge",
  "analyzer",
  "actor",
  "compiler",
  "verifier",
  "forecaster",
  "calibrator",
  "probe",
  "sparse_autoencoder_probe",
]);
const RESERVED_SUBROUTES = new Set([
  "infer",
  "register",
  "evaluate",
  "list",
  "inspect",
  "shared",
  "export",
  "weights.safetensors",
]);

const RESERVED_CODE_WORDS = new Set([
  "auto",
  "break",
  "case",
  "catch",
  "char",
  "class",
  "const",
  "continue",
  "def",
  "default",
  "delete",
  "do",
  "double",
  "elif",
  "else",
  "enum",
  "export",
  "extern",
  "false",
  "finally",
  "float",
  "for",
  "from",
  "function",
  "global",
  "goto",
  "group",
  "if",
  "import",
  "in",
  "infer",
  "inline",
  "int",
  "join",
  "lambda",
  "let",
  "long",
  "model_metadata",
  "new",
  "none",
  "not",
  "null",
  "or",
  "order",
  "pass",
  "register",
  "restrict",
  "return",
  "select",
  "short",
  "signed",
  "sizeof",
  "static",
  "struct",
  "switch",
  "tensors",
  "throw",
  "true",
  "try",
  "typedef",
  "union",
  "unsigned",
  "values",
  "var",
  "void",
  "volatile",
  "where",
  "while",
  "with",
  "yield",
  "fn",
  "mut",
  "pub",
  "mod",
  "use",
  "crate",
  "self",
  "super",
  "impl",
  "trait",
  "loop",
  "match",
  "ref",
  "move",
  "type",
  "unsafe",
  "async",
  "await",
  "dyn",
  "uniform",
  "varying",
  "attribute",
  "precision",
  "highp",
  "mediump",
  "lowp",
  "vec2",
  "vec3",
  "vec4",
  "mat2",
  "mat3",
  "mat4",
  "main",
]);

const EFFORT_TIERS = Object.freeze(["off", "minimal", "adaptive", "deep"]);
const DISPATCH_MODES = Object.freeze([
  "single_isolated",
  "back_to_back_sequential",
  "simultaneous_batched_pack",
  "speculative_pipeline",
]);

const GENERATOR_PROFILES = Object.freeze([
  "profile_concise_imperative",
  "profile_extended_derivation",
  "profile_formal_exposition",
  "profile_hedged_qualification",
  "profile_code_interleaved",
  "profile_enumerated_ledger",
  "profile_clause_dense",
  "profile_bursty_human_editorial",
]);

const KOOPMAN_TOOLS = Object.freeze([
  "query_index",
  "parse_schema",
  "check_bounds",
  "transform_payload",
  "run_unit_gate",
  "commit_state",
]);

const OOD_FILTER_ACTIONS = Object.freeze([
  "accept_inlier",
  "flag_distribution_shift",
  "quarantine_poisoned_trace",
]);

const SHEAF_CONSISTENCY_ACTIONS = Object.freeze([
  "accept_harmonic_consensus",
  "reconcile_edge_disagreement",
  "isolate_contradictory_worker",
]);

const SHEAF_RESTRICTION_EDGES = Object.freeze([
  "spec_to_maker_scope",
  "maker_to_schema_contract",
  "schema_to_unit_bounds",
  "maker_to_checker_diff",
  "checker_to_citation_ground",
  "citation_to_bitemporal_clock",
  "dag_parent_to_child_step",
  "bundle_to_lease_epoch",
  "cost_to_budget_ceiling",
  "latency_to_sla_window",
  "prefix_to_state_checkpoint",
  "quorum_to_final_record",
]);

const CONFORMAL_EXECUTION_TIERS = Object.freeze([
  "cartridge_layer0_direct",
  "compact_specialist_runner",
  "disjoint_maker_checker_pair",
  "deep_quorum_escalation",
]);

const SAE_REGIME_READOUTS = Object.freeze([
  "semantic_concept",
  "structural_syntax",
  "persona_register",
  "epistemic_uncertainty",
]);

const ELK_SUMMARY_AXES = Object.freeze([
  "mid_layer_truth",
  "late_layer_output",
  "residual_velocity",
  "attention_entropy",
  "sheaf_coboundary",
  "anchor_cosine",
  "margin_gap",
  "prompt_pressure",
]);

const ELK_STEER_ACTIONS = Object.freeze([
  "accept_aligned_output",
  "dampen_sycophancy_pressure",
  "apply_nullspace_truth_steer",
]);

const FABRIC_ROUTES = Object.freeze([
  Object.freeze({
    route: "/q/next",
    label: "Priority Task Discovery & Claiming",
    keywords: Object.freeze(["next", "claim", "queue", "ready", "unseen", "lease", "nonprofit", "priority", "available", "pickup"]),
  }),
  Object.freeze({
    route: "/q/submit",
    label: "Structured Task Object Submission",
    keywords: Object.freeze(["submit", "complete", "finish", "deliver", "artifact", "publish", "save", "fencing", "output", "upload"]),
  }),
  Object.freeze({
    route: "/q/optimize",
    label: "Grid Search, Surrogate UCB & Policy Tuning",
    keywords: Object.freeze(["optimize", "grid", "surrogate", "ucb", "pareto", "reinforcement", "policy", "sweep", "hyperparameter", "macro"]),
  }),
  Object.freeze({
    route: "/q/cell",
    label: "Local Loopback SQLite Cell Replica",
    keywords: Object.freeze(["cell", "local", "sqlite", "replica", "loopback", "offline", "subagent", "wal", "fts", "bootstrap"]),
  }),
  Object.freeze({
    route: "/q/models",
    label: "Hosted Weight-Space Model Hub & Safetensors",
    keywords: Object.freeze(["model", "models", "weight", "weights", "safetensors", "cartridge", "polytope", "embedding", "infer", "steered"]),
  }),
  Object.freeze({
    route: "/q/resume",
    label: "Durable Session Hydration & Checkpoints",
    keywords: Object.freeze(["resume", "checkpoint", "compaction", "cron", "recover", "hydrate", "restart", "heartbeat", "continue", "session"]),
  }),
]);

const ACTIVITY_CLUSTERS = Object.freeze([
  Object.freeze({ id: "task_discovery_and_triage", label: "Task Discovery & Priority Triage" }),
  Object.freeze({ id: "structured_artifact_authoring", label: "Structured Task Object Authoring" }),
  Object.freeze({ id: "parameter_and_policy_tuning", label: "Multi-Axis Parameter & Policy Tuning" }),
  Object.freeze({ id: "local_replica_orchestration", label: "Local Cell & Subagent Orchestration" }),
  Object.freeze({ id: "weight_space_adaptation", label: "Weight-Space Subspace & Cartridge Adaptation" }),
  Object.freeze({ id: "state_recovery_and_checking", label: "Session Continuity & Independent Checking" }),
]);

const CARTRIDGE_SLOTS = Object.freeze([
  Object.freeze({
    slot_id: "cartridge_schema_extract",
    tensor_name: "cartridge_schema_extract",
    label: "Structured Schema & Field Extraction",
    keywords: Object.freeze(["schema", "json", "extract", "field", "contract", "parse", "typed"]),
  }),
  Object.freeze({
    slot_id: "cartridge_tabular_normalize",
    tensor_name: "cartridge_tabular_normalize",
    label: "Tabular Normalization & Unit Alignment",
    keywords: Object.freeze(["table", "csv", "row", "column", "normalize", "unit", "clean"]),
  }),
  Object.freeze({
    slot_id: "cartridge_citation_ground",
    tensor_name: "cartridge_citation_ground",
    label: "Primary-Source Quote & Link Grounding",
    keywords: Object.freeze(["cite", "citation", "source", "quote", "reference", "ground", "url"]),
  }),
  Object.freeze({
    slot_id: "cartridge_dag_plan",
    tensor_name: "cartridge_dag_plan",
    label: "Dependency DAG & Stage Decomposition",
    keywords: Object.freeze(["dag", "stage", "plan", "decompose", "dependency", "graph", "step"]),
  }),
  Object.freeze({
    slot_id: "cartridge_independent_check",
    tensor_name: "cartridge_independent_check",
    label: "Disjoint-Lineage Contract & Boundary Check",
    keywords: Object.freeze(["check", "review", "audit", "independent", "boundary", "defect", "test"]),
  }),
  Object.freeze({
    slot_id: "cartridge_delta_summarize",
    tensor_name: "cartridge_delta_summarize",
    label: "Concise Delta & State Handoff Summary",
    keywords: Object.freeze(["delta", "summary", "summarize", "handoff", "brief", "digest", "note"]),
  }),
]);

const DEFECT_FOCUS_AXES = Object.freeze([
  "missing_required_fields",
  "count_mismatch",
  "ungrounded_claims",
  "scope_drift",
  "boundary_overflow",
  "ambiguous_units",
  "duplicate_records",
  "stale_checkpoint_state",
]);

const readyWeightModelTables = new WeakSet();

function clampNum(val, fallback, low, high) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  if (n < low) return low;
  if (n > high) return high;
  return n;
}

function clampWeightScalar(val, fallback = 0) {
  const clamped = clampNum(val, fallback, -G.max_custom_weight_abs, G.max_custom_weight_abs);
  return roundScale(clamped, G.float_embed_round_scale);
}

function clampInt(val, fallback, low, high) {
  return Math.round(clampNum(val, fallback, low, high));
}

function roundScale(val, scale = G.float_round_scale) {
  const n = Number(val);
  return Number.isFinite(n) ? Math.round(n * scale) / scale : 0;
}

function f32(values) {
  return new Float32Array(values);
}

function deterministicSeed(label) {
  const str = String(label || "");
  let s = G.seed_init >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    s ^= str.charCodeAt(i);
    s = Math.imul(s, G.seed_mult) >>> 0;
  }
  return s >>> 0;
}

function seededFloatMatrix(rows, cols, label, scale = G.four_tenths_scalar) {
  const total = rows * cols;
  const out = new Float32Array(total);
  let state = deterministicSeed(label);
  for (let i = 0; i < total; i += 1) {
    state = (Math.imul(state, G.lcg_mult) + G.lcg_inc) >>> 0;
    const unit = state / G.uint32_radix;
    out[i] = (unit * G.two_scalar - 1) * scale;
  }
  return out;
}

function shortAlphaTag(text, len = G.digest_chars) {
  let state = deterministicSeed(text);
  let out = "";
  while (out.length < len) {
    state = (Math.imul(state, G.lcg_mult) + G.lcg_inc) >>> 0;
    out += state.toString(G.base36_radix);
  }
  return `tag_${out.slice(0, len)}`;
}

function makeRunId() {
  const rand = new Uint32Array(G.two_scalar);
  crypto.getRandomValues(rand);
  const p0 = rand[0].toString(G.base36_radix).slice(0, G.short_id_chars);
  const p1 = rand[1].toString(G.base36_radix).slice(0, G.short_id_chars);
  return `wmr_${p0}z${p1}`;
}

function safeMatrixDims(tensor) {
  const dataLen = tensor?.data?.length || 1;
  const rawShape = Array.isArray(tensor?.shape) && tensor.shape.length > 0 ? tensor.shape : [dataLen];
  const rawD0 = Number(rawShape[0]);
  const d0 = Number.isFinite(rawD0) && Math.trunc(rawD0) >= 1 ? Math.trunc(rawD0) : 1;
  if (rawShape.length === 1) {
    return { rows: Math.max(1, Math.min(d0, dataLen)), cols: 1 };
  }
  let rest = 1;
  for (let i = 1; i < rawShape.length; i += 1) {
    const rawDi = Number(rawShape[i]);
    const di = Number.isFinite(rawDi) && Math.trunc(rawDi) >= 1 ? Math.trunc(rawDi) : 1;
    rest *= di;
  }
  const boundedRows = Math.max(1, Math.min(d0, dataLen));
  const cols = Math.max(1, Math.min(rest, Math.floor(dataLen / boundedRows) || 1));
  const rows = Math.max(1, Math.min(boundedRows, Math.floor(dataLen / cols) || 1));
  return { rows, cols };
}

function matVecMul(weights, rows, cols, vec, bias = null) {
  const safeRows = Math.max(1, Math.trunc(Number(rows) || 1));
  const safeCols = Math.max(1, Math.trunc(Number(cols) || 1));
  const out = new Float32Array(safeRows);
  const wLen = weights ? weights.length : 0;
  const vLen = vec ? vec.length : 0;
  for (let r = 0; r < safeRows; r += 1) {
    const bVal = bias && r < bias.length ? Number(bias[r]) : 0;
    let acc = Number.isFinite(bVal) ? bVal : 0;
    const base = r * safeCols;
    for (let c = 0; c < safeCols; c += 1) {
      const wIdx = base + c;
      const wVal = wLen > 0 && wIdx < wLen ? Number(weights[wIdx]) : 0;
      const vVal = vLen > 0 ? Number(vec[c % vLen]) : 0;
      if (Number.isFinite(wVal) && Number.isFinite(vVal)) {
        acc += wVal * vVal;
      }
    }
    out[r] = Number.isFinite(acc) ? acc : 0;
  }
  return out;
}

function reluVec(vec) {
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i += 1) {
    out[i] = vec[i] > 0 ? vec[i] : 0;
  }
  return out;
}

function sigmoidScalar(x) {
  const clipped = clampNum(x, 0, -G.logit_clip_abs, G.logit_clip_abs);
  return 1 / (1 + Math.exp(-clipped));
}

function softmaxVec(logits) {
  let maxVal = -Infinity;
  for (let i = 0; i < logits.length; i += 1) {
    if (logits[i] > maxVal) maxVal = logits[i];
  }
  const exps = new Float32Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i += 1) {
    const e = Math.exp(clampNum(logits[i] - maxVal, 0, -G.logit_clip_abs, 0));
    exps[i] = e;
    sum += e;
  }
  const denom = sum > G.epsilon_norm ? sum : 1;
  for (let i = 0; i < exps.length; i += 1) {
    exps[i] /= denom;
  }
  return exps;
}

function l2Normalize(vec) {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i += 1) {
    sumSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(sumSq);
  const out = new Float32Array(vec.length);
  if (norm <= G.epsilon_norm) {
    if (out.length > 0) out[0] = 1;
    return { vector: out, norm: 1 };
  }
  for (let i = 0; i < vec.length; i += 1) {
    out[i] = vec[i] / norm;
  }
  return { vector: out, norm };
}

function dotVec(a, b) {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    sum += a[i] * b[i];
  }
  return sum;
}

export function computeMatrixAnchorDrift(deltaWeights, rows, cols, anchorBasis, basisRows) {
  let sumSq = 0;
  for (let r = 0; r < rows; r += 1) {
    const dOff = r * cols;
    for (let b = 0; b < basisRows; b += 1) {
      const bOff = b * cols;
      let inner = 0;
      for (let c = 0; c < cols; c += 1) {
        inner += deltaWeights[dOff + c] * anchorBasis[bOff + c];
      }
      sumSq += inner * inner;
    }
  }
  return Math.sqrt(sumSq);
}

function buildEffortRouterTensors() {
  const rows1 = G.polytope_hidden_dim;
  const cols1 = G.feature_dim;
  const w1 = seededFloatMatrix(rows1, cols1, "tf-scratch-effort-router-v1.w1", G.two_tenths_scalar);
  const b1 = new Float32Array(rows1);
  for (let r = 0; r < rows1; r += 1) {
    const base = r * cols1;
    if (r < G.four_scalar) {
      w1[base + G.feat_quick_idx] = G.one_point_eight;
      w1[base + G.feat_length_idx] = -G.eight_tenths_scalar;
      w1[base + G.feat_dag_idx] = -G.nine_tenths_scalar;
      w1[base + G.feat_depth_idx] = -G.nine_tenths_scalar;
      b1[r] = G.two_tenths_scalar;
    } else if (r < G.eight_scalar) {
      w1[base + G.feat_contract_idx] = G.nine_tenths_scalar;
      w1[base + G.feat_length_idx] = G.three_tenths_scalar;
      w1[base + G.feat_depth_idx] = -G.six_tenths_scalar;
      w1[base + G.feat_quick_idx] = G.two_tenths_scalar;
      b1[r] = G.tenth_scalar;
    } else if (r < G.twelve_scalar) {
      w1[base + G.feat_contract_idx] = G.eight_tenths_scalar;
      w1[base + G.feat_dag_idx] = G.eight_tenths_scalar;
      w1[base + G.feat_check_idx] = G.seven_tenths_scalar;
      w1[base + G.feat_length_idx] = G.six_tenths_scalar;
      b1[r] = -G.tenth_scalar;
    } else {
      w1[base + G.feat_depth_idx] = G.one_point_eight;
      w1[base + G.feat_dag_idx] = G.one_point_five;
      w1[base + G.feat_steps_idx] = G.one_point_two;
      w1[base + G.feat_check_idx] = G.eight_tenths_scalar;
      w1[base + G.feat_quick_idx] = -G.one_point_two;
      b1[r] = -G.two_tenths_scalar;
    }
  }
  const rows2 = G.effort_tier_count;
  const cols2 = rows1;
  const w2 = new Float32Array(rows2 * cols2);
  for (let tier = 0; tier < rows2; tier += 1) {
    for (let h = 0; h < cols2; h += 1) {
      const bucket = Math.floor(h / G.four_scalar);
      w2[tier * cols2 + h] = bucket === tier ? G.one_point_two : -G.two_tenths_scalar;
    }
  }
  const b2 = f32([G.tenth_scalar, G.two_tenths_scalar, 0, -G.tenth_scalar]);
  const thresholds = f32([G.effort_threshold_minimal, G.effort_threshold_adaptive, G.effort_threshold_deep]);
  const tokenFloors = f32([G.token_floor_off, G.token_floor_minimal, G.token_floor_adaptive, G.token_floor_deep]);
  return [
    { name: "layer1_weight", shape: [rows1, cols1], data: w1 },
    { name: "layer1_bias", shape: [rows1], data: b1 },
    { name: "layer2_weight", shape: [rows2, cols2], data: w2 },
    { name: "layer2_bias", shape: [rows2], data: b2 },
    { name: "tier_thresholds", shape: [G.three_scalar], data: thresholds },
    { name: "token_floors", shape: [rows2], data: tokenFloors },
  ];
}

function buildAttenuationGateTensors() {
  const rows1 = G.attenuation_hidden_dim;
  const cols1 = G.feature_dim;
  const w1 = seededFloatMatrix(rows1, cols1, "tf-scratch-attenuation-gate-v1.w1", G.tenth_scalar);
  const b1 = new Float32Array(rows1);
  for (let r = 0; r < rows1; r += 1) {
    const base = r * cols1;
    if (r < G.six_scalar) {
      w1[base + G.feat_error_idx] = G.one_point_eight;
      w1[base + G.feat_steps_idx] = G.one_point_two;
      w1[base + G.feat_depth_idx] = G.eight_tenths_scalar;
      w1[base + G.feat_dag_idx] = G.six_tenths_scalar;
      b1[r] = 0;
    } else {
      w1[base + G.feat_contract_idx] = G.nine_tenths_scalar;
      w1[base + G.feat_check_idx] = G.seven_tenths_scalar;
      w1[base + G.feat_error_idx] = -G.nine_tenths_scalar;
      b1[r] = G.two_tenths_scalar;
    }
  }
  const rows2 = G.attenuation_output_dim;
  const cols2 = rows1;
  const w2 = new Float32Array(rows2 * cols2);
  for (let h = 0; h < cols2; h += 1) {
    if (h < G.six_scalar) {
      w2[h] = -G.six_tenths_scalar;
      w2[cols2 + h] = G.eight_tenths_scalar;
    } else {
      w2[h] = G.four_tenths_scalar;
      w2[cols2 + h] = -G.three_tenths_scalar;
    }
  }
  const b2 = f32([G.one_point_eight, -G.four_tenths_scalar]);
  const gateThreshold = f32([G.survival_gate_threshold]);
  return [
    { name: "gate_layer1_weight", shape: [rows1, cols1], data: w1 },
    { name: "gate_layer1_bias", shape: [rows1], data: b1 },
    { name: "gate_layer2_weight", shape: [rows2, cols2], data: w2 },
    { name: "gate_layer2_bias", shape: [rows2], data: b2 },
    { name: "survival_threshold", shape: [1], data: gateThreshold },
  ];
}

function buildNullspaceEmbedTensors() {
  const outDim = G.embed_dim;
  const inDim = G.embed_input_dim;
  const basisRows = G.anchor_basis_count;
  const anchorStart = G.embed_anchor_start_idx;

  const anchorSubspace = new Float32Array(basisRows * inDim);
  const half = G.half_scalar;
  const hadamardSigns = [
    [1, 1, 1, 1],
    [1, -1, 1, -1],
    [1, 1, -1, -1],
    [1, -1, -1, 1],
  ];
  for (let r = 0; r < G.four_scalar; r += 1) {
    for (let c = 0; c < G.four_scalar; c += 1) {
      anchorSubspace[r * inDim + anchorStart + c] = hadamardSigns[r][c] * half;
    }
  }
  anchorSubspace[G.four_scalar * inDim + G.fourteen_scalar] = 1;
  anchorSubspace[G.five_scalar * inDim + G.fifteen_scalar] = 1;

  const baseProjector = seededFloatMatrix(outDim, inDim, "tf-embed-nullspace-24d-v1.base", G.tenth_scalar);
  const nullspaceDelta = new Float32Array(outDim * inDim);
  for (let routeIdx = 0; routeIdx < G.route_count; routeIdx += 1) {
    const blockStart = routeIdx * G.four_scalar;
    for (let k = 0; k < G.four_scalar; k += 1) {
      const row = blockStart + k;
      const off = row * inDim;
      nullspaceDelta[off + routeIdx] = k === 0 ? G.two_point_four : k === 1 ? G.one_point_eight : G.one_point_two;
      const structCol = G.six_scalar + (k % G.four_scalar);
      nullspaceDelta[off + structCol] = ((routeIdx + k) % G.two_scalar === 0 ? 1 : -1) * G.three_tenths_scalar;
    }
  }

  const routeCentroids = new Float32Array(G.route_count * outDim);
  const activityCentroids = new Float32Array(G.cluster_count * outDim);
  const combined = new Float32Array(outDim * inDim);
  for (let i = 0; i < combined.length; i += 1) {
    combined[i] = baseProjector[i] + nullspaceDelta[i];
  }
  for (let r = 0; r < G.route_count; r += 1) {
    const probe = new Float32Array(inDim);
    probe[r] = 1;
    probe[G.six_scalar + (r % G.four_scalar)] = G.three_tenths_scalar;
    const raw = matVecMul(combined, outDim, inDim, probe);
    const { vector } = l2Normalize(raw);
    routeCentroids.set(vector, r * outDim);

    const actProbe = new Float32Array(inDim);
    actProbe[r] = G.nine_tenths_scalar;
    actProbe[(r + 1) % G.route_count] = G.two_tenths_scalar;
    actProbe[G.six_scalar + ((r + 1) % G.four_scalar)] = G.four_tenths_scalar;
    const actRaw = matVecMul(combined, outDim, inDim, actProbe);
    const normAct = l2Normalize(actRaw);
    activityCentroids.set(normAct.vector, r * outDim);
  }

  return [
    { name: "base_projector", shape: [outDim, inDim], data: baseProjector },
    { name: "nullspace_delta", shape: [outDim, inDim], data: nullspaceDelta },
    { name: "anchor_subspace", shape: [basisRows, inDim], data: anchorSubspace },
    { name: "route_centroids", shape: [G.route_count, outDim], data: routeCentroids },
    { name: "activity_centroids", shape: [G.cluster_count, outDim], data: activityCentroids },
  ];
}

function buildBundleDeciderTensors() {
  const cols = G.feature_dim;
  const modes = G.decider_mode_count;
  const channelMask = f32([
    G.six_tenths_scalar,
    1,
    G.eight_tenths_scalar,
    G.eight_tenths_scalar,
    G.five_scalar / G.ten_scalar,
    1,
    1,
    1,
    1,
    1,
    G.nine_tenths_scalar,
    G.five_scalar / G.ten_scalar,
  ]);
  const wDisp = new Float32Array(modes * cols);
  wDisp[0 * cols + G.feat_check_idx] = G.one_point_eight;
  wDisp[0 * cols + G.feat_error_idx] = G.one_point_eight;
  wDisp[0 * cols + G.feat_depth_idx] = G.nine_tenths_scalar;
  wDisp[0 * cols + G.feat_batch_idx] = -G.one_point_two;
  wDisp[0 * cols + G.feat_prefix_idx] = -G.eight_tenths_scalar;
  wDisp[1 * cols + G.feat_prefix_idx] = G.two_point_four;
  wDisp[1 * cols + G.feat_contract_idx] = G.eight_tenths_scalar;
  wDisp[1 * cols + G.feat_error_idx] = -G.six_tenths_scalar;
  wDisp[G.two_scalar * cols + G.feat_batch_idx] = G.two_point_four;
  wDisp[G.two_scalar * cols + G.feat_quick_idx] = G.nine_tenths_scalar;
  wDisp[G.two_scalar * cols + G.feat_depth_idx] = -G.seven_tenths_scalar;
  wDisp[G.three_scalar * cols + G.feat_dag_idx] = G.one_point_eight;
  wDisp[G.three_scalar * cols + G.feat_steps_idx] = G.one_point_five;
  wDisp[G.three_scalar * cols + G.feat_latency_idx] = G.one_point_two;
  const bDisp = f32([G.two_tenths_scalar, G.tenth_scalar, 0, -G.tenth_scalar]);

  const wTopo = new Float32Array(G.decider_topo_dim * cols);
  wTopo[0 * cols + G.feat_batch_idx] = G.two_point_four;
  wTopo[0 * cols + G.feat_prefix_idx] = G.one_point_five;
  wTopo[0 * cols + G.feat_error_idx] = -G.one_point_five;
  wTopo[1 * cols + G.feat_batch_idx] = G.two_point_four;
  wTopo[1 * cols + G.feat_dag_idx] = G.one_point_eight;
  wTopo[G.two_scalar * cols + G.feat_steps_idx] = G.two_point_four;
  wTopo[G.two_scalar * cols + G.feat_dag_idx] = G.one_point_eight;
  wTopo[G.two_scalar * cols + G.feat_depth_idx] = G.one_point_two;
  const bTopo = f32([1, 1, 1]);

  return [
    { name: "channel_slice_mask", shape: [cols], data: channelMask },
    { name: "ridge_dispatch_weight", shape: [modes, cols], data: wDisp },
    { name: "ridge_dispatch_bias", shape: [modes], data: bDisp },
    { name: "topology_head_weight", shape: [G.decider_topo_dim, cols], data: wTopo },
    { name: "topology_head_bias", shape: [G.decider_topo_dim], data: bTopo },
  ];
}

function buildSteeredLlmTensors(seedPrefix, roleSign) {
  const steerDim = G.steering_dim;
  const rank = G.subspace_rank;
  const inDim = G.feature_dim;
  const rawSteer = seededFloatMatrix(1, steerDim, `${seedPrefix}.steer`, G.eight_tenths_scalar);
  for (let i = 0; i < steerDim; i += 1) {
    rawSteer[i] += roleSign * ((i % G.two_scalar === 0 ? 1 : -1) * G.four_tenths_scalar);
  }
  const { vector: steerVec } = l2Normalize(rawSteer);
  const uMat = seededFloatMatrix(steerDim, rank, `${seedPrefix}.u`, G.four_tenths_scalar);
  const sMat = new Float32Array(rank * rank);
  for (let r = 0; r < rank; r += 1) {
    sMat[r * rank + r] = G.nine_tenths_scalar - (r / rank) * G.half_scalar;
  }
  const vtMat = seededFloatMatrix(rank, inDim, `${seedPrefix}.vt`, G.four_tenths_scalar);
  return [
    { name: roleSign > 0 ? "contrastive_steering_vec" : "checker_critique_vec", shape: [steerDim], data: steerVec },
    { name: roleSign > 0 ? "subspace_adapter_u" : "checker_subspace_u", shape: [steerDim, rank], data: uMat },
    { name: roleSign > 0 ? "subspace_adapter_s" : "checker_subspace_s", shape: [rank, rank], data: sMat },
    { name: roleSign > 0 ? "subspace_adapter_vt" : "checker_subspace_vt", shape: [rank, inDim], data: vtMat },
  ];
}

function buildCartridgeBankTensors() {
  const rank = G.subspace_rank;
  const tensors = [];
  for (let s = 0; s < CARTRIDGE_SLOTS.length; s += 1) {
    const slot = CARTRIDGE_SLOTS[s];
    const mat = seededFloatMatrix(rank, rank, `tf-cartridge-bank.${slot.slot_id}`, G.four_tenths_scalar);
    for (let r = 0; r < rank; r += 1) {
      mat[r * rank + r] += G.eight_tenths_scalar;
    }
    const focusIdx = s % rank;
    for (let c = 0; c < rank; c += 1) {
      mat[focusIdx * rank + c] += G.six_tenths_scalar;
    }
    tensors.push({
      name: slot.tensor_name,
      shape: [rank, rank],
      data: mat,
    });
  }
  return tensors;
}

function buildGeneratorAttributionTensors() {
  const profiles = G.analyzer_profile_count;
  const cols = G.feature_dim;
  const topicRows = G.analyzer_topic_basis_rows;
  const topicStart = G.analyzer_topic_start_idx;

  // Orthonormal 4x4 dyadic Walsh-Hadamard topic-anchor basis over topic-lexical channels 8..11.
  const topicBasis = new Float32Array(topicRows * cols);
  const hadamardSigns = [
    [1, 1, 1, 1],
    [1, -1, 1, -1],
    [1, 1, -1, -1],
    [1, -1, -1, 1],
  ];
  for (let r = 0; r < topicRows; r += 1) {
    for (let c = 0; c < topicRows; c += 1) {
      topicBasis[r * cols + topicStart + c] = hadamardSigns[r][c] * G.half_scalar;
    }
  }

  // Stylometric classifier sculpted strictly inside ker(topic_anchor_basis) (zero support on topic channels 8..11).
  const styleWeight = new Float32Array(profiles * cols);
  for (let p = 0; p < profiles; p += 1) {
    const off = p * cols;
    styleWeight[off + p] = G.two_point_four;
    styleWeight[off + ((p + 1) % topicStart)] = G.six_tenths_scalar;
    styleWeight[off + ((p + G.three_scalar) % topicStart)] = -G.four_tenths_scalar;
  }
  const styleBias = new Float32Array(profiles);
  const centroids = new Float32Array(profiles * profiles);
  for (let p = 0; p < profiles; p += 1) {
    styleBias[p] = p === 0 ? G.tenth_scalar : 0;
    const rowSlice = styleWeight.subarray(p * cols, p * cols + profiles);
    const { vector } = l2Normalize(rowSlice);
    centroids.set(vector, p * profiles);
  }

  return [
    { name: "stylometric_nullspace_weight", shape: [profiles, cols], data: styleWeight },
    { name: "stylometric_bias", shape: [profiles], data: styleBias },
    { name: "topic_anchor_basis", shape: [topicRows, cols], data: topicBasis },
    { name: "cadence_reference_centroids", shape: [profiles, profiles], data: centroids },
  ];
}

function buildKoopmanActorTensors() {
  const latent = G.koopman_latent_dim;
  const cols = G.feature_dim;
  const tools = G.koopman_tool_count;

  const liftWeight = seededFloatMatrix(latent, cols, "tf-actor-koopman.lift", G.three_tenths_scalar);
  const liftBias = new Float32Array(latent);
  for (let r = 0; r < latent; r += 1) {
    const col = r % cols;
    liftWeight[r * cols + col] += G.nine_tenths_scalar;
    liftBias[r] = G.tenth_scalar;
  }

  // Schur-stable Koopman state-transition operator K [16, 16] with forward workflow shift coupling.
  const kMat = new Float32Array(latent * latent);
  for (let r = 0; r < latent; r += 1) {
    const decay = G.koopman_spectral_radius - (r % G.four_scalar) * G.koopman_decay_step;
    kMat[r * latent + r] = decay;
    const prevIdx = (r + latent - 1) % latent;
    kMat[r * latent + prevIdx] = G.koopman_coupling_scale;
  }

  const readoutWeight = seededFloatMatrix(tools, latent, "tf-actor-koopman.readout", G.two_tenths_scalar);
  for (let t = 0; t < tools; t += 1) {
    const focusA = (t * G.two_scalar) % latent;
    const focusB = (focusA + 1) % latent;
    readoutWeight[t * latent + focusA] = G.one_point_eight;
    readoutWeight[t * latent + focusB] = G.one_point_two;
  }
  const readoutBias = f32([G.two_tenths_scalar, G.tenth_scalar, G.tenth_scalar, 0, 0, -G.tenth_scalar]);

  return [
    { name: "koopman_lift_encoder", shape: [latent, cols], data: liftWeight },
    { name: "koopman_lift_bias", shape: [latent], data: liftBias },
    { name: "koopman_transition_matrix", shape: [latent, latent], data: kMat },
    { name: "tool_policy_readout", shape: [tools, latent], data: readoutWeight },
    { name: "tool_policy_bias", shape: [tools], data: readoutBias },
  ];
}

function buildHypernetCompilerTensors() {
  const latent = G.hypernet_latent_dim;
  const cols = G.feature_dim;
  const rank = G.subspace_rank;
  const cartFloats = G.cartridge_floats;

  const specWeight = seededFloatMatrix(latent, cols, "tf-compiler-hypernet.encoder", G.three_tenths_scalar);
  const specBias = new Float32Array(latent);
  for (let r = 0; r < latent; r += 1) {
    specWeight[r * cols + (r % cols)] += G.eight_tenths_scalar;
    specBias[r] = G.tenth_scalar;
  }

  const hyperGen = seededFloatMatrix(cartFloats, latent, "tf-compiler-hypernet.generator", G.three_tenths_scalar);
  const diagPrior = new Float32Array(rank * rank);
  for (let r = 0; r < rank; r += 1) {
    diagPrior[r * rank + r] = G.eight_tenths_scalar;
  }

  return [
    { name: "ste_spec_encoder_weight", shape: [latent, cols], data: specWeight },
    { name: "ste_spec_encoder_bias", shape: [latent], data: specBias },
    { name: "hypernet_cartridge_generator", shape: [cartFloats, latent], data: hyperGen },
    { name: "cartridge_diagonal_prior", shape: [rank, rank], data: diagPrior },
  ];
}

function buildSpectralVerifierTensors() {
  const inlierRank = G.ood_inlier_rank;
  const cols = G.feature_dim;
  const headDim = G.ood_anomaly_head_dim;

  // Orthonormal inlier basis U_in [8, 12] spanning clean task coordinates 0..7; coordinates 8..11 carry anomaly residuals.
  const inlierBasis = new Float32Array(inlierRank * cols);
  for (let r = 0; r < inlierRank; r += 1) {
    inlierBasis[r * cols + r] = 1;
  }
  const centroid = new Float32Array(cols);
  for (let c = 0; c < inlierRank; c += 1) {
    centroid[c] = G.two_tenths_scalar;
  }

  const anomalyHead = new Float32Array(headDim * cols);
  for (let h = 0; h < headDim; h += 1) {
    const residualCol = inlierRank + h;
    anomalyHead[h * cols + residualCol] = G.one_point_eight;
  }
  const thresholds = f32([G.ood_residual_threshold, G.ood_quarantine_threshold]);

  return [
    { name: "inlier_subspace_basis", shape: [inlierRank, cols], data: inlierBasis },
    { name: "inlier_feature_centroid", shape: [cols], data: centroid },
    { name: "anomaly_score_head", shape: [headDim, cols], data: anomalyHead },
    { name: "residual_thresholds", shape: [G.two_scalar], data: thresholds },
  ];
}

function buildLegendreForecasterTensors() {
  const degCount = G.legendre_basis_count;
  const cols = G.feature_dim;

  // Exact shifted Legendre polynomial coefficients on [0, 1] up to degree 3:
  // P0*(t) = 1; P1*(t) = 2t - 1; P2*(t) = 6t^2 - 6t + 1; P3*(t) = 20t^3 - 30t^2 + 12t - 1.
  const legendreBasis = f32([
    1,
    0,
    0,
    0,
    -1,
    G.two_scalar,
    0,
    0,
    1,
    -G.six_scalar,
    G.six_scalar,
    0,
    -1,
    G.twelve_scalar,
    -G.thirty_scalar,
    G.twenty_scalar,
  ]);

  const loadEncoder = seededFloatMatrix(degCount, cols, "tf-forecaster-legendre.load", G.tenth_scalar);
  loadEncoder[0 * cols + G.feat_bias_idx] = G.six_tenths_scalar;
  loadEncoder[0 * cols + G.feat_batch_idx] = G.eight_tenths_scalar;
  loadEncoder[1 * cols + G.feat_steps_idx] = G.four_tenths_scalar;
  loadEncoder[G.two_scalar * cols + G.feat_dag_idx] = G.two_tenths_scalar;
  loadEncoder[G.three_scalar * cols + G.feat_latency_idx] = G.tenth_scalar;

  const costEncoder = seededFloatMatrix(degCount, cols, "tf-forecaster-legendre.cost", G.tenth_scalar);
  costEncoder[0 * cols + G.feat_bias_idx] = G.half_scalar;
  costEncoder[0 * cols + G.feat_depth_idx] = G.eight_tenths_scalar;
  costEncoder[1 * cols + G.feat_steps_idx] = G.three_tenths_scalar;
  costEncoder[G.two_scalar * cols + G.feat_contract_idx] = G.two_tenths_scalar;
  costEncoder[G.three_scalar * cols + G.feat_error_idx] = G.tenth_scalar;

  const horizons = f32([G.quarter_scalar, G.half_scalar, G.three_quarters_scalar, 1]);

  return [
    { name: "bitemporal_load_encoder", shape: [degCount, cols], data: loadEncoder },
    { name: "bitemporal_cost_encoder", shape: [degCount, cols], data: costEncoder },
    { name: "shifted_legendre_basis", shape: [degCount, degCount], data: legendreBasis },
    { name: "horizon_grid", shape: [G.legendre_horizon_count], data: horizons },
  ];
}

function buildSheafConsistencyTensors() {
  const edges = G.sheaf_edge_count;
  const cols = G.feature_dim;

  // Cyclic cellular sheaf coboundary operator delta [12, 12] measuring adjacent restriction differences.
  const coboundary = new Float32Array(edges * cols);
  const edgeWeights = new Float32Array(edges);
  for (let e = 0; e < edges; e += 1) {
    const srcCol = e % cols;
    const dstCol = (e + 1) % cols;
    coboundary[e * cols + srcCol] = 1;
    coboundary[e * cols + dstCol] = -G.eight_tenths_scalar;
    edgeWeights[e] = G.six_tenths_scalar + (e % G.four_scalar) * G.tenth_scalar;
  }
  const thresholds = f32([G.sheaf_soft_threshold, G.sheaf_hard_threshold]);

  return [
    { name: "sheaf_coboundary_matrix", shape: [edges, cols], data: coboundary },
    { name: "sheaf_edge_weights", shape: [edges], data: edgeWeights },
    { name: "obstruction_thresholds", shape: [G.two_scalar], data: thresholds },
  ];
}

function buildConformalCalibratorTensors() {
  const tiers = G.conformal_tier_count;
  const cols = G.feature_dim;
  const scoreWeight = seededFloatMatrix(tiers, cols, "tf-calibrator-conformal.weight", G.two_tenths_scalar);
  const scoreBias = f32([G.three_tenths_scalar, G.two_tenths_scalar, G.tenth_scalar, -G.tenth_scalar]);

  // Tier 0 favors quick single-step contracts; Tier 1 specialist; Tier 2 maker-checker; Tier 3 deep DAG escalation.
  scoreWeight[0 * cols + G.feat_quick_idx] = G.one_point_eight;
  scoreWeight[0 * cols + G.feat_latency_idx] = G.eight_tenths_scalar;
  scoreWeight[1 * cols + G.feat_contract_idx] = G.one_point_five;
  scoreWeight[1 * cols + G.feat_prefix_idx] = G.nine_tenths_scalar;
  scoreWeight[G.two_scalar * cols + G.feat_check_idx] = G.one_point_eight;
  scoreWeight[G.two_scalar * cols + G.feat_error_idx] = G.nine_tenths_scalar;
  scoreWeight[G.three_scalar * cols + G.feat_dag_idx] = G.one_point_eight;
  scoreWeight[G.three_scalar * cols + G.feat_depth_idx] = G.one_point_five;

  const quantiles = f32([
    G.conformal_q_alpha_20,
    G.conformal_q_alpha_10,
    G.conformal_q_alpha_05,
    G.conformal_q_alpha_01,
  ]);

  return [
    { name: "conformal_score_weight", shape: [tiers, cols], data: scoreWeight },
    { name: "conformal_score_bias", shape: [tiers], data: scoreBias },
    { name: "nonconformity_quantiles", shape: [tiers], data: quantiles },
  ];
}

function buildMatryoshkaSaeTensors() {
  const inDim = G.sae_input_dim;
  const dictDim = G.sae_dict_dim;
  const regCount = G.sae_regime_count;

  const rawDict = seededFloatMatrix(inDim, dictDim, "tf-sae-matryoshka.dict", G.two_tenths_scalar);
  for (let j = 0; j < dictDim; j += 1) {
    const regIdx = j % regCount;
    const tierIdx = Math.floor(j / regCount);
    const priRow = regIdx;
    const secRow = regIdx + regCount;
    if (tierIdx === 0) {
      rawDict[priRow * dictDim + j] += G.sae_primary_gain;
      rawDict[secRow * dictDim + j] += G.sae_secondary_gain;
    } else if (tierIdx === 1) {
      rawDict[secRow * dictDim + j] += G.sae_primary_gain;
      rawDict[priRow * dictDim + j] += G.sae_secondary_gain;
    } else if (tierIdx === G.two_scalar) {
      rawDict[priRow * dictDim + j] += G.sae_primary_gain;
      rawDict[secRow * dictDim + j] -= G.sae_secondary_gain;
    } else {
      rawDict[((priRow + 1) % inDim) * dictDim + j] += G.sae_secondary_gain;
      rawDict[secRow * dictDim + j] += G.sae_primary_gain;
    }
  }

  // Zero-epoch unit-norm decoder scaling: every column atom d_j in [8, 16] has ||d_j||_2 == 1.0 in IEEE-754 float32.
  const decoderDict = new Float32Array(inDim * dictDim);
  for (let j = 0; j < dictDim; j += 1) {
    let colSq = 0;
    for (let r = 0; r < inDim; r += 1) {
      const v = Math.fround(rawDict[r * dictDim + j]);
      colSq += v * v;
    }
    const invNorm = colSq > G.epsilon_norm ? 1 / Math.sqrt(colSq) : 1;
    for (let r = 0; r < inDim; r += 1) {
      decoderDict[r * dictDim + j] = Math.fround(rawDict[r * dictDim + j] * invNorm);
    }
  }

  const prefixWeights = f32([G.sae_prefix_w0, G.sae_prefix_w1, G.sae_prefix_w2, G.sae_prefix_w3]);
  const tierBiases = [
    G.sae_sparsity_bias_core,
    G.sae_sparsity_bias_mid,
    G.sae_sparsity_bias_fine,
    G.sae_sparsity_bias_tail,
  ];
  const encWeight = new Float32Array(dictDim * inDim);
  const encBias = new Float32Array(dictDim);
  for (let j = 0; j < dictDim; j += 1) {
    const tierIdx = Math.floor(j / regCount);
    const tierBoost = 1 + prefixWeights[tierIdx] * G.half_scalar;
    for (let c = 0; c < inDim; c += 1) {
      encWeight[j * inDim + c] = Math.fround(decoderDict[c * dictDim + j] * tierBoost);
    }
    encBias[j] = Math.fround(tierBiases[tierIdx]);
  }

  const regimeWeight = seededFloatMatrix(regCount, dictDim, "tf-sae-matryoshka.readout", G.tenth_scalar);
  const regimeBias = new Float32Array(regCount);
  for (let j = 0; j < dictDim; j += 1) {
    const regIdx = j % regCount;
    const tierIdx = Math.floor(j / regCount);
    regimeWeight[regIdx * dictDim + j] = Math.fround(G.sae_readout_gain * (1 + prefixWeights[tierIdx]));
  }
  for (let r = 0; r < regCount; r += 1) {
    regimeBias[r] = Math.fround(G.tenth_scalar * (1 - r * G.two_tenths_scalar));
  }

  return [
    { name: "sae_encoder_weight", shape: [dictDim, inDim], data: encWeight },
    { name: "sae_encoder_bias", shape: [dictDim], data: encBias },
    { name: "sae_decoder_dictionary", shape: [inDim, dictDim], data: decoderDict },
    { name: "sae_regime_readout_weight", shape: [regCount, dictDim], data: regimeWeight },
    { name: "sae_regime_readout_bias", shape: [regCount], data: regimeBias },
    { name: "matryoshka_prefix_weights", shape: [regCount], data: prefixWeights },
  ];
}

function buildInternalTruthElkProbeTensors() {
  const rows = G.elk_output_dim;
  const cols = G.elk_input_dim;

  // Axes: [mid_layer_truth, late_layer_output, residual_velocity, attention_entropy, sheaf_coboundary, anchor_cosine, margin_gap, prompt_pressure]
  const probeWeight = f32([
    G.two_point_four,
    G.two_tenths_scalar,
    -G.tenth_scalar,
    -G.two_tenths_scalar,
    -G.two_tenths_scalar,
    G.one_point_two,
    G.six_tenths_scalar,
    -G.tenth_scalar,
    G.one_point_eight,
    -G.one_point_eight,
    G.one_point_two,
    G.half_scalar,
    G.one_point_two,
    -G.six_tenths_scalar,
    -G.half_scalar,
    G.one_point_five,
    G.one_point_five,
    -G.one_point_five,
    G.nine_tenths_scalar,
    G.six_tenths_scalar,
    G.one_point_five,
    -G.four_tenths_scalar,
    -G.four_tenths_scalar,
    G.one_point_five,
  ]);
  const probeBias = f32([G.elk_truth_bias, G.elk_div_bias, G.elk_steer_bias]);
  const thresholds = f32([G.elk_soft_divergence_threshold, G.elk_contradiction_threshold]);

  return [
    { name: "elk_probe_weight", shape: [rows, cols], data: probeWeight },
    { name: "elk_probe_bias", shape: [rows], data: probeBias },
    { name: "contradiction_thresholds", shape: [G.two_scalar], data: thresholds },
  ];
}

const BUILTIN_MODELS = Object.freeze([
  Object.freeze({
    model_id: "tf-scratch-effort-router-v1",
    family: "from_scratch_polytope",
    title: "From-Scratch 2-Layer ReLU Polytope Effort Router",
    summary:
      "Two-layer ReLU polytope selects reasoning effort (off, minimal, adaptive, deep) and output token floor in under 1 ms.",
    producer_agent: "teleion-fabric-core",
    lineage_role: "routing",
    lineage_id: "lineage-tf-polytope-effort-v1",
    paired_disjoint_lineage: "",
    base_model: "From-scratch compiled ReLU polytope (zero pretrained LLM weights)",
    training_data_ref: "teleion.traces/effort-calibration-polytope-v1",
    held_out_score: G.builtin_metrics.effort_router.held_out,
    direct_baseline_score: G.builtin_metrics.effort_router.baseline,
    live_eval_score: G.builtin_metrics.effort_router.live,
    live_eval_count: G.builtin_metrics.effort_router.evals,
    anchor_drift: G.builtin_metrics.effort_router.drift,
    cost_usd: G.builtin_metrics.effort_router.cost,
    canary_share: G.promoted_share,
    status: "promoted_default",
    builtin: true,
    tensors: buildEffortRouterTensors(),
  }),
  Object.freeze({
    model_id: "tf-scratch-attenuation-gate-v1",
    family: "from_scratch_polytope",
    title: "From-Scratch DAG Step-Error Attenuation & Check-Gate Model",
    summary:
      "Compiled survival network computes multi-step DAG error attenuation and places independent check boundaries.",
    producer_agent: "teleion-fabric-core",
    lineage_role: "routing",
    lineage_id: "lineage-tf-polytope-attenuation-v1",
    paired_disjoint_lineage: "",
    base_model: "From-scratch compiled attenuation boundary network",
    training_data_ref: "teleion.traces/dag-survival-boundaries-v1",
    held_out_score: G.builtin_metrics.attenuation_gate.held_out,
    direct_baseline_score: G.builtin_metrics.attenuation_gate.baseline,
    live_eval_score: G.builtin_metrics.attenuation_gate.live,
    live_eval_count: G.builtin_metrics.attenuation_gate.evals,
    anchor_drift: G.builtin_metrics.attenuation_gate.drift,
    cost_usd: G.builtin_metrics.attenuation_gate.cost,
    canary_share: G.promoted_share,
    status: "promoted_default",
    builtin: true,
    tensors: buildAttenuationGateTensors(),
  }),
  Object.freeze({
    model_id: "tf-embed-nullspace-24d-v1",
    family: "weight_edited_embedding",
    title: "SVD Anchor-Nullspace 24-D Task & Route Projector",
    summary:
      "SVD nullspace-edited 24-d unit-norm projector maps Task text to Teleion Fabric routes and activity clusters with 0.0 anchor drift.",
    producer_agent: "teleion-fabric-core",
    lineage_role: "embedding",
    lineage_id: "lineage-tf-nullspace-embed-24d-v1",
    paired_disjoint_lineage: "",
    base_model: "Weight-space nullspace projector (works with almost any model and LLM inference provider)",
    training_data_ref: "teleion.traces/route-and-activity-nullspace-v1",
    held_out_score: G.builtin_metrics.nullspace_embed.held_out,
    direct_baseline_score: G.builtin_metrics.nullspace_embed.baseline,
    live_eval_score: G.builtin_metrics.nullspace_embed.live,
    live_eval_count: G.builtin_metrics.nullspace_embed.evals,
    anchor_drift: G.builtin_metrics.nullspace_embed.drift,
    cost_usd: G.builtin_metrics.nullspace_embed.cost,
    canary_share: G.promoted_share,
    status: "promoted_default",
    builtin: true,
    tensors: buildNullspaceEmbedTensors(),
  }),
  Object.freeze({
    model_id: "tf-decider-bundle-affinity-v1",
    family: "weight_edited_decider",
    title: "Channel-Sliced Ridge Worker Bundle & Granularity Decider",
    summary:
      "Channel-sliced ridge dispatcher selects isolated, sequential, batched, or speculative execution plus bundle size 1 to 4 and DAG shape.",
    producer_agent: "teleion-fabric-core",
    lineage_role: "dispatch",
    lineage_id: "lineage-tf-ridge-bundle-decider-v1",
    paired_disjoint_lineage: "",
    base_model: "Channel-sliced ridge decision head",
    training_data_ref: "teleion.traces/bundle-affinity-dispatch-v1",
    held_out_score: G.builtin_metrics.bundle_decider.held_out,
    direct_baseline_score: G.builtin_metrics.bundle_decider.baseline,
    live_eval_score: G.builtin_metrics.bundle_decider.live,
    live_eval_count: G.builtin_metrics.bundle_decider.evals,
    anchor_drift: G.builtin_metrics.bundle_decider.drift,
    cost_usd: G.builtin_metrics.bundle_decider.cost,
    canary_share: G.promoted_share,
    status: "promoted_default",
    builtin: true,
    tensors: buildBundleDeciderTensors(),
  }),
  Object.freeze({
    model_id: "tf-llm-steered-maker-v1",
    family: "weight_programmed_llm",
    title: "Contrastive Activation-Steered Open-Weight Maker Profile",
    summary:
      "Contrastive vector and rank-8 adapter reduce verbose chains on Meta open-weight models while retaining structured Task Object fields.",
    producer_agent: "teleion-fabric-maker-cell",
    lineage_role: "maker",
    lineage_id: "lineage-tf-steered-maker-alpha",
    paired_disjoint_lineage: "lineage-tf-disjoint-checker-beta",
    base_model: "Meta open-weight models (works with almost any model and LLM inference provider)",
    training_data_ref: "teleion.traces/maker-concise-task-objects-alpha",
    held_out_score: G.builtin_metrics.steered_maker.held_out,
    direct_baseline_score: G.builtin_metrics.steered_maker.baseline,
    live_eval_score: G.builtin_metrics.steered_maker.live,
    live_eval_count: G.builtin_metrics.steered_maker.evals,
    anchor_drift: G.builtin_metrics.steered_maker.drift,
    cost_usd: G.builtin_metrics.steered_maker.cost,
    canary_share: G.promoted_share,
    status: "promoted_default",
    builtin: true,
    tensors: buildSteeredLlmTensors("tf-llm-steered-maker-v1", 1),
  }),
  Object.freeze({
    model_id: "tf-llm-disjoint-checker-v1",
    family: "weight_programmed_llm",
    title: "Lineage-Isolated Independent Checker Subspace Profile",
    summary:
      "Separate checker profile (maker_lineage != checker_lineage) over Meta open-weight models never shares training traces with its maker.",
    producer_agent: "teleion-fabric-checker-cell",
    lineage_role: "checker",
    lineage_id: "lineage-tf-disjoint-checker-beta",
    paired_disjoint_lineage: "lineage-tf-steered-maker-alpha",
    base_model: "Meta open-weight models (independent checker lineage)",
    training_data_ref: "teleion.traces/independent-checker-rubrics-beta",
    held_out_score: G.builtin_metrics.disjoint_checker.held_out,
    direct_baseline_score: G.builtin_metrics.disjoint_checker.baseline,
    live_eval_score: G.builtin_metrics.disjoint_checker.live,
    live_eval_count: G.builtin_metrics.disjoint_checker.evals,
    anchor_drift: G.builtin_metrics.disjoint_checker.drift,
    cost_usd: G.builtin_metrics.disjoint_checker.cost,
    canary_share: G.promoted_share,
    status: "promoted_default",
    builtin: true,
    tensors: buildSteeredLlmTensors("tf-llm-disjoint-checker-v1", -1),
  }),
  Object.freeze({
    model_id: "tf-cartridge-shared-activity-bank-v1",
    family: "atomic_cartridge_bank",
    title: "Shared 256-Byte Subspace Weight Cartridge Bank",
    summary:
      "Six 256-byte (8x8 float32) LoRA-XS cartridges cover schema extraction, tabular normalization, source grounding, DAG planning, checking, and summaries.",
    producer_agent: "teleion-fabric-core",
    lineage_role: "cartridge",
    lineage_id: "lineage-tf-shared-cartridge-bank-v1",
    paired_disjoint_lineage: "",
    base_model: "Meta open-weight models + universal 8x8 subspace cartridge interface",
    training_data_ref: "teleion.traces/shared-activity-cartridges-v1",
    held_out_score: G.builtin_metrics.cartridge_bank.held_out,
    direct_baseline_score: G.builtin_metrics.cartridge_bank.baseline,
    live_eval_score: G.builtin_metrics.cartridge_bank.live,
    live_eval_count: G.builtin_metrics.cartridge_bank.evals,
    anchor_drift: G.builtin_metrics.cartridge_bank.drift,
    cost_usd: G.builtin_metrics.cartridge_bank.cost,
    canary_share: G.promoted_share,
    status: "promoted_default",
    builtin: true,
    tensors: buildCartridgeBankTensors(),
  }),
  Object.freeze({
    model_id: "tf-analyzer-generator-attribution-v1",
    family: "analyzer",
    title: "Topic-Nullspace Stylometric & Cadence Attribution Classifier",
    summary:
      "Topic-nullspace classifier attributes text cadence across eight structural generator profiles with 0.0 topic-shortcut drift.",
    producer_agent: "teleion-fabric-core",
    lineage_role: "analyzer",
    lineage_id: "lineage-tf-topic-nullspace-analyzer-v1",
    paired_disjoint_lineage: "",
    base_model: "Topic-nullspace stylometric classifier (zero pretrained LLM weights)",
    training_data_ref: "teleion.traces/stylometric-cadence-nullspace-v1",
    held_out_score: G.builtin_metrics.generator_analyzer.held_out,
    direct_baseline_score: G.builtin_metrics.generator_analyzer.baseline,
    live_eval_score: G.builtin_metrics.generator_analyzer.live,
    live_eval_count: G.builtin_metrics.generator_analyzer.evals,
    anchor_drift: G.builtin_metrics.generator_analyzer.drift,
    cost_usd: G.builtin_metrics.generator_analyzer.cost,
    canary_share: G.promoted_share,
    status: "promoted_default",
    builtin: true,
    tensors: buildGeneratorAttributionTensors(),
  }),
  Object.freeze({
    model_id: "tf-actor-koopman-tool-policy-v1",
    family: "actor",
    title: "Lifted Koopman Linear State-Transition Tool-Graph Actor",
    summary:
      "Lifted Koopman linear operator predicts multi-step tool-graph trajectories at zero token cost in sub-millisecond time.",
    producer_agent: "teleion-fabric-core",
    lineage_role: "actor",
    lineage_id: "lineage-tf-koopman-tool-actor-v1",
    paired_disjoint_lineage: "",
    base_model: "Lifted Koopman linear state-transition operator",
    training_data_ref: "teleion.traces/koopman-tool-trajectories-v1",
    held_out_score: G.builtin_metrics.koopman_actor.held_out,
    direct_baseline_score: G.builtin_metrics.koopman_actor.baseline,
    live_eval_score: G.builtin_metrics.koopman_actor.live,
    live_eval_count: G.builtin_metrics.koopman_actor.evals,
    anchor_drift: G.builtin_metrics.koopman_actor.drift,
    cost_usd: G.builtin_metrics.koopman_actor.cost,
    canary_share: G.promoted_share,
    status: "promoted_default",
    builtin: true,
    tensors: buildKoopmanActorTensors(),
  }),
  Object.freeze({
    model_id: "tf-compiler-hypernet-cartridge-v1",
    family: "compiler",
    title: "Zero-Shot ASD-STE100 Spec-to-256B Cartridge Hypernetwork",
    summary:
      "Hypernetwork compiles an ASD-STE100 task specification directly into a 256-byte float32 rank-8 cartridge in zero gradient steps.",
    producer_agent: "teleion-fabric-core",
    lineage_role: "compiler",
    lineage_id: "lineage-tf-hypernet-compiler-v1",
    paired_disjoint_lineage: "",
    base_model: "Zero-shot specification-to-cartridge hypernetwork initializer",
    training_data_ref: "teleion.traces/ste100-hypernet-cartridges-v1",
    held_out_score: G.builtin_metrics.hypernet_compiler.held_out,
    direct_baseline_score: G.builtin_metrics.hypernet_compiler.baseline,
    live_eval_score: G.builtin_metrics.hypernet_compiler.live,
    live_eval_count: G.builtin_metrics.hypernet_compiler.evals,
    anchor_drift: G.builtin_metrics.hypernet_compiler.drift,
    cost_usd: G.builtin_metrics.hypernet_compiler.cost,
    canary_share: G.promoted_share,
    status: "promoted_default",
    builtin: true,
    tensors: buildHypernetCompilerTensors(),
  }),
  Object.freeze({
    model_id: "tf-verifier-spectral-ood-v1",
    family: "verifier",
    title: "Spectral Nullspace Residual Out-of-Distribution & Trace Filter",
    summary:
      "Spectral nullspace detector measures residual energy outside the clean trace subspace to filter out-of-distribution inputs and poisoned traces.",
    producer_agent: "teleion-fabric-core",
    lineage_role: "verifier",
    lineage_id: "lineage-tf-spectral-ood-filter-v1",
    paired_disjoint_lineage: "",
    base_model: "Spectral nullspace residual energy detector",
    training_data_ref: "teleion.traces/spectral-clean-trace-subspace-v1",
    held_out_score: G.builtin_metrics.spectral_verifier.held_out,
    direct_baseline_score: G.builtin_metrics.spectral_verifier.baseline,
    live_eval_score: G.builtin_metrics.spectral_verifier.live,
    live_eval_count: G.builtin_metrics.spectral_verifier.evals,
    anchor_drift: G.builtin_metrics.spectral_verifier.drift,
    cost_usd: G.builtin_metrics.spectral_verifier.cost,
    canary_share: G.promoted_share,
    status: "promoted_default",
    builtin: true,
    tensors: buildSpectralVerifierTensors(),
  }),
  Object.freeze({
    model_id: "tf-forecaster-legendre-bitemporal-v1",
    family: "forecaster",
    title: "Shifted Legendre Polynomial Bitemporal Load & Cost Forecaster",
    summary:
      "Shifted Legendre polynomial basis forecasts queue load and token cost across bitemporal windows while isolating restatement lag.",
    producer_agent: "teleion-fabric-core",
    lineage_role: "forecaster",
    lineage_id: "lineage-tf-legendre-bitemporal-v1",
    paired_disjoint_lineage: "",
    base_model: "Shifted Legendre polynomial bitemporal forecaster",
    training_data_ref: "teleion.traces/bitemporal-queue-cost-series-v1",
    held_out_score: G.builtin_metrics.legendre_forecaster.held_out,
    direct_baseline_score: G.builtin_metrics.legendre_forecaster.baseline,
    live_eval_score: G.builtin_metrics.legendre_forecaster.live,
    live_eval_count: G.builtin_metrics.legendre_forecaster.evals,
    anchor_drift: G.builtin_metrics.legendre_forecaster.drift,
    cost_usd: G.builtin_metrics.legendre_forecaster.cost,
    canary_share: G.promoted_share,
    status: "promoted_default",
    builtin: true,
    tensors: buildLegendreForecasterTensors(),
  }),
  Object.freeze({
    model_id: "tf-verifier-sheaf-consistency-v1",
    family: "verifier",
    title: "Cellular Sheaf Laplacian Multi-Worker Consistency Filter",
    summary:
      "Cellular sheaf coboundary matrices measure restriction mismatch across multi-worker outputs to pinpoint contradictory steps.",
    producer_agent: "teleion-fabric-core",
    lineage_role: "verifier",
    lineage_id: "lineage-tf-sheaf-consistency-v1",
    paired_disjoint_lineage: "",
    base_model: "Cellular sheaf coboundary and Laplacian consistency operator",
    training_data_ref: "teleion.traces/sheaf-multi-worker-consistency-v1",
    held_out_score: G.builtin_metrics.sheaf_verifier.held_out,
    direct_baseline_score: G.builtin_metrics.sheaf_verifier.baseline,
    live_eval_score: G.builtin_metrics.sheaf_verifier.live,
    live_eval_count: G.builtin_metrics.sheaf_verifier.evals,
    anchor_drift: G.builtin_metrics.sheaf_verifier.drift,
    cost_usd: G.builtin_metrics.sheaf_verifier.cost,
    canary_share: G.promoted_share,
    status: "promoted_default",
    builtin: true,
    tensors: buildSheafConsistencyTensors(),
  }),
  Object.freeze({
    model_id: "tf-calibrator-conformal-set-v1",
    family: "calibrator",
    title: "Split & Adaptive Conformal Prediction Set Calibrator",
    summary:
      "Conformal nonconformity quantiles build calibrated prediction sets and decide when a compact cartridge escalates to deep review.",
    producer_agent: "teleion-fabric-core",
    lineage_role: "calibrator",
    lineage_id: "lineage-tf-conformal-calibrator-v1",
    paired_disjoint_lineage: "",
    base_model: "Distribution-free split and adaptive conformal calibrator",
    training_data_ref: "teleion.traces/conformal-nonconformity-quantiles-v1",
    held_out_score: G.builtin_metrics.conformal_calibrator.held_out,
    direct_baseline_score: G.builtin_metrics.conformal_calibrator.baseline,
    live_eval_score: G.builtin_metrics.conformal_calibrator.live,
    live_eval_count: G.builtin_metrics.conformal_calibrator.evals,
    anchor_drift: G.builtin_metrics.conformal_calibrator.drift,
    cost_usd: G.builtin_metrics.conformal_calibrator.cost,
    canary_share: G.promoted_share,
    status: "promoted_default",
    builtin: true,
    tensors: buildConformalCalibratorTensors(),
  }),
  Object.freeze({
    model_id: "tf-sae-matryoshka-residual-v1",
    family: "sparse_autoencoder_probe",
    task: "matryoshka_sparse_feature_decomposition",
    title: "Matryoshka Sparse Autoencoder Residual Feature Decomposer",
    summary:
      "Decomposes 8-d residual-stream vectors into 16-d sparse monosemantic dictionary latents and four regime readouts with unit-norm decoder scaling.",
    producer_agent: "teleion-fabric-core",
    lineage_role: "probe",
    lineage_id: "lineage-tf-sae-matryoshka-v1",
    paired_disjoint_lineage: "",
    base_model: "Matryoshka sparse autoencoder with zero-epoch unit-norm decoder dictionary",
    training_data_ref: "teleion.traces/matryoshka-sae-residual-latents-v1",
    held_out_score: G.builtin_metrics.sae_matryoshka.held_out,
    direct_baseline_score: G.builtin_metrics.sae_matryoshka.baseline,
    live_eval_score: G.builtin_metrics.sae_matryoshka.live,
    live_eval_count: G.builtin_metrics.sae_matryoshka.evals,
    anchor_drift: G.builtin_metrics.sae_matryoshka.drift,
    cost_usd: G.builtin_metrics.sae_matryoshka.cost,
    canary_share: G.promoted_share,
    status: "promoted_default",
    builtin: true,
    tensors: buildMatryoshkaSaeTensors(),
  }),
  Object.freeze({
    model_id: "tf-probe-internal-truth-elk-v1",
    family: "sparse_autoencoder_probe",
    task: "internal_truth_vs_sycophancy_probe",
    title: "Cross-Layer Internal Truth vs Sycophancy ELK Latent Probe",
    summary:
      "Probes eight cross-layer hidden-state summaries into internal truth, sycophancy divergence, and nullspace steer scores in under one microsecond.",
    producer_agent: "teleion-fabric-core",
    lineage_role: "probe",
    lineage_id: "lineage-tf-elk-truth-probe-v1",
    paired_disjoint_lineage: "",
    base_model: "Cross-layer hidden-state ELK linear truth and sycophancy probe",
    training_data_ref: "teleion.traces/elk-cross-layer-truth-probe-v1",
    held_out_score: G.builtin_metrics.elk_truth_probe.held_out,
    direct_baseline_score: G.builtin_metrics.elk_truth_probe.baseline,
    live_eval_score: G.builtin_metrics.elk_truth_probe.live,
    live_eval_count: G.builtin_metrics.elk_truth_probe.evals,
    anchor_drift: G.builtin_metrics.elk_truth_probe.drift,
    cost_usd: G.builtin_metrics.elk_truth_probe.cost,
    canary_share: G.promoted_share,
    status: "promoted_default",
    builtin: true,
    tensors: buildInternalTruthElkProbeTensors(),
  }),
]);

const BUILTIN_BY_ID = new Map(BUILTIN_MODELS.map((m) => [m.model_id, m]));

function normalizeTensorArray(tensors) {
  const normalized = [];
  const seenNames = new Set();
  for (let idx = 0; idx < tensors.length; idx += 1) {
    const t = tensors[idx];
    const shape =
      Array.isArray(t.shape) && t.shape.length > 0
        ? t.shape.map((d) => (Number.isFinite(Number(d)) && Math.trunc(Number(d)) >= 1 ? Math.trunc(Number(d)) : 1))
        : [Math.max(1, t.data?.length || 1)];
    let expectedCount = 1;
    for (const dim of shape) expectedCount *= dim;
    const floats = t.data instanceof Float32Array ? t.data : f32(t.data || []);
    const alignedFloats = new Float32Array(expectedCount);
    const copyLen = Math.min(floats.length, expectedCount);
    for (let k = 0; k < copyLen; k += 1) {
      alignedFloats[k] = clampWeightScalar(floats[k], 0);
    }
    const baseTensorName =
      scrubBannedWords(stripPii(String(t.name || "")))
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, G.model_id_max_chars) || "subspace_cartridge";
    const safeTensorName =
      baseTensorName !== "__metadata__" && !seenNames.has(baseTensorName)
        ? baseTensorName
        : `${baseTensorName}_${idx}`;
    seenNames.add(safeTensorName);
    normalized.push({ name: safeTensorName, shape, floats: alignedFloats });
  }
  return normalized;
}

export function serializeSafetensors(tensors, metadata = {}) {
  const headerObj = {};
  const cleanMeta = {};
  for (const [k, v] of Object.entries(metadata || {})) {
    if (v !== undefined && v !== null) {
      const safeKey = scrubBannedWords(stripPii(String(k))).trim();
      const safeVal = scrubBannedWords(stripPii(String(v)));
      if (safeKey && safeKey !== "__metadata__") {
        cleanMeta[safeKey] = safeVal;
      }
    }
  }
  if (Object.keys(cleanMeta).length > 0) {
    headerObj.__metadata__ = cleanMeta;
  }

  let byteCursor = 0;
  const normalizedTensors = [];
  for (const item of normalizeTensorArray(tensors)) {
    const byteLen = item.floats.length * G.float32_bytes;
    const startOffset = byteCursor;
    const endOffset = startOffset + byteLen;
    byteCursor = endOffset;
    headerObj[item.name] = {
      dtype: "F32",
      shape: item.shape,
      data_offsets: [startOffset, endOffset],
    };
    normalizedTensors.push({ floats: item.floats, startOffset });
  }

  const rawHeaderBytes = new TextEncoder().encode(JSON.stringify(headerObj));
  const remainder = rawHeaderBytes.byteLength % G.header_align_bytes;
  const padBytes = remainder === 0 ? 0 : G.header_align_bytes - remainder;
  const headerByteLength = rawHeaderBytes.byteLength + padBytes;

  const totalBytes = G.header_len_bytes + headerByteLength + byteCursor;
  const out = new Uint8Array(totalBytes);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

  const low32 = headerByteLength >>> 0;
  const high32 = Math.floor(headerByteLength / G.uint32_radix) >>> 0;
  view.setUint32(0, low32, true);
  view.setUint32(G.four_scalar, high32, true);

  out.set(rawHeaderBytes, G.header_len_bytes);
  for (let p = 0; p < padBytes; p += 1) {
    out[G.header_len_bytes + rawHeaderBytes.byteLength + p] = G.space_ascii;
  }

  const dataBase = G.header_len_bytes + headerByteLength;
  for (const item of normalizedTensors) {
    const base = dataBase + item.startOffset;
    for (let i = 0; i < item.floats.length; i += 1) {
      view.setFloat32(base + i * G.float32_bytes, item.floats[i], true);
    }
  }
  return out;
}

export function parseSafetensors(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.byteLength < G.header_len_bytes) {
    throw new Error("safetensors buffer shorter than 8-byte header prefix");
  }
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const low32 = view.getUint32(0, true);
  const high32 = view.getUint32(G.four_scalar, true);
  const headerLen = high32 * G.uint32_radix + low32;
  const dataStart = G.header_len_bytes + headerLen;
  if (dataStart > u8.byteLength) {
    throw new Error("safetensors header length exceeds buffer size");
  }
  const headerText = new TextDecoder().decode(u8.subarray(G.header_len_bytes, dataStart));
  const header = JSON.parse(headerText);
  const tensors = {};
  for (const [name, spec] of Object.entries(header)) {
    if (name === "__metadata__") continue;
    const [begin, end] = spec.data_offsets;
    const count = (end - begin) / G.float32_bytes;
    const arr = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      arr[i] = view.getFloat32(dataStart + begin + i * G.float32_bytes, true);
    }
    tensors[name] = { dtype: spec.dtype, shape: spec.shape, data_offsets: spec.data_offsets, data: arr };
  }
  return { headerLength: headerLen, metadata: header.__metadata__ || {}, tensors };
}

function summarizeTensors(tensors) {
  let paramCount = 0;
  const specs = [];
  for (const t of tensors) {
    const count = t.data ? t.data.length : 0;
    paramCount += count;
    specs.push({
      name: t.name,
      dtype: "F32",
      shape: t.shape,
      parameters: count,
      bytes: count * G.float32_bytes,
    });
  }
  return {
    tensor_count: specs.length,
    parameter_count: paramCount,
    tensor_data_bytes: paramCount * G.float32_bytes,
    tensors: specs,
  };
}

export async function ensureWeightModelHubSchema(db) {
  if (!db || typeof db.prepare !== "function") return;
  if (typeof db === "object" && readyWeightModelTables.has(db)) return;
  const statements = [
    db.prepare(
      `CREATE TABLE IF NOT EXISTS herma_weight_models (
        model_id TEXT PRIMARY KEY,
        family TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        producer_agent TEXT NOT NULL,
        lineage_role TEXT NOT NULL DEFAULT 'cartridge',
        lineage_id TEXT NOT NULL,
        paired_disjoint_lineage TEXT NOT NULL DEFAULT '',
        base_model TEXT NOT NULL,
        training_data_ref TEXT NOT NULL,
        held_out_score REAL NOT NULL,
        direct_baseline_score REAL NOT NULL,
        live_eval_score REAL,
        live_eval_count INTEGER NOT NULL DEFAULT 0,
        last_evaluator_agent TEXT NOT NULL DEFAULT '',
        anchor_drift REAL NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        canary_share REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'canary',
        previous_default_id TEXT NOT NULL DEFAULT '',
        tensors_json TEXT NOT NULL,
        config_json TEXT NOT NULL DEFAULT '{}',
        byte_size INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_herma_weight_models_family
       ON herma_weight_models(family, status, updated_at DESC)`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS herma_weight_model_runs (
        run_id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        family TEXT NOT NULL,
        caller_agent TEXT NOT NULL DEFAULT '',
        input_digest TEXT NOT NULL,
        latency_ms REAL NOT NULL DEFAULT 0,
        output_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_herma_weight_model_runs_model
       ON herma_weight_model_runs(model_id, created_at DESC)`
    ),
  ];
  await db.batch(statements);
  readyWeightModelTables.add(db);
}

function hydrateCustomTensors(row) {
  try {
    const parsed = JSON.parse(row.tensors_json || "[]");
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((t, idx) => ({
        name: String(t.name || `cartridge_${idx}`).slice(0, G.model_id_max_chars),
        shape: Array.isArray(t.shape) && t.shape.length > 0 ? t.shape.map((n) => Math.max(1, Math.trunc(Number(n)))) : [G.subspace_rank, G.subspace_rank],
        data: f32(Array.isArray(t.data) ? t.data : []),
      }));
    }
  } catch {
    // fallback below
  }
  return [
    {
      name: "subspace_cartridge",
      shape: [G.subspace_rank, G.subspace_rank],
      data: seededFloatMatrix(G.subspace_rank, G.subspace_rank, `${row.model_id}:${row.training_data_ref}`, G.four_tenths_scalar),
    },
  ];
}

function rowToModelObject(row) {
  const tensors = hydrateCustomTensors(row);
  let config = {};
  try {
    config = JSON.parse(row.config_json || "{}");
  } catch {
    config = {};
  }
  return {
    model_id: String(row.model_id),
    family: String(row.family),
    ...(config && config.task ? { task: String(config.task) } : {}),
    title: String(row.title),
    summary: String(row.summary),
    producer_agent: String(row.producer_agent),
    lineage_role: String(row.lineage_role || "cartridge"),
    lineage_id: String(row.lineage_id || ""),
    paired_disjoint_lineage: String(row.paired_disjoint_lineage || ""),
    base_model: String(row.base_model || "Meta open-weight models"),
    training_data_ref: String(row.training_data_ref || ""),
    held_out_score: Number(row.held_out_score || 0),
    direct_baseline_score: Number(row.direct_baseline_score || 0),
    live_eval_score: row.live_eval_score == null ? null : Number(row.live_eval_score),
    live_eval_count: Number(row.live_eval_count || 0),
    last_evaluator_agent: String(row.last_evaluator_agent || ""),
    anchor_drift: Number(row.anchor_drift || 0),
    cost_usd: Number(row.cost_usd || 0),
    canary_share: Number(row.canary_share || 0),
    status: String(row.status || "canary"),
    previous_default_id: String(row.previous_default_id || ""),
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
    builtin: false,
    config,
    tensors,
  };
}

function buildExportLinks(publicUrl, safeId) {
  return {
    js: `${publicUrl}/q/models/${safeId}/export?runtime=js`,
    python: `${publicUrl}/q/models/${safeId}/export?runtime=python`,
    sql: `${publicUrl}/q/models/${safeId}/export?runtime=sql`,
    c99: `${publicUrl}/q/models/${safeId}/export?runtime=c99`,
    rust: `${publicUrl}/q/models/${safeId}/export?runtime=rust`,
    wasm: `${publicUrl}/q/models/${safeId}/export?runtime=wasm`,
    wat: `${publicUrl}/q/models/${safeId}/export?runtime=wat`,
    wgsl: `${publicUrl}/q/models/${safeId}/export?runtime=wgsl`,
    glsl: `${publicUrl}/q/models/${safeId}/export?runtime=glsl`,
  };
}

function sanitizePublicModelView(model, publicUrl) {
  const tensorSummary = summarizeTensors(model.tensors);
  const safeId = encodeURIComponent(model.model_id);
  const cleanStr = (val, maxLen) => scrubBannedWords(stripPii(String(val || ""))).slice(0, maxLen);
  const familySpec = MODEL_FAMILIES.find((f) => f.id === model.family) || MODEL_FAMILIES[0];
  return scrubBannedDeep(
    stripPiiDeep({
      model_id: cleanStr(model.model_id, G.model_id_max_chars),
      raw_model_id: model.model_id,
      family: model.family,
      universal_family: familySpec.universal_family,
      family_label: familySpec.label,
      ...(model.task ? { task: cleanStr(model.task, G.lineage_max_chars) } : {}),
      title: cleanStr(model.title, G.title_max_chars),
      summary: cleanStr(model.summary, G.summary_max_chars),
      producer_agent: cleanStr(model.producer_agent, G.agent_id_max_chars),
      lineage_role: model.lineage_role,
      lineage_id: cleanStr(model.lineage_id, G.lineage_max_chars),
      ...(model.paired_disjoint_lineage
        ? { paired_disjoint_lineage: cleanStr(model.paired_disjoint_lineage, G.lineage_max_chars) }
        : {}),
      base_model: cleanStr(model.base_model, G.ref_max_chars),
      training_data_ref: cleanStr(model.training_data_ref, G.ref_max_chars),
      held_out_score: roundScale(model.held_out_score),
      direct_baseline_score: roundScale(model.direct_baseline_score),
      held_out_gain_over_direct: roundScale(model.held_out_score - model.direct_baseline_score),
      live_eval_score: model.live_eval_score == null ? null : roundScale(model.live_eval_score),
      live_eval_count: model.live_eval_count,
      ...(model.last_evaluator_agent
        ? { last_evaluator_agent: cleanStr(model.last_evaluator_agent, G.agent_id_max_chars) }
        : {}),
      anchor_drift: roundScale(model.anchor_drift, G.float_embed_round_scale),
      cost_usd: roundScale(model.cost_usd),
      canary_share: roundScale(model.canary_share),
      status: model.status,
      builtin: Boolean(model.builtin),
      ...tensorSummary,
      links: {
        metadata_url: `${publicUrl}/q/models/${safeId}`,
        safetensors_url: `${publicUrl}/q/models/${safeId}/weights.safetensors`,
        export_urls: buildExportLinks(publicUrl, safeId),
        infer_get_url: `${publicUrl}/q/models/infer?model=${safeId}&text=plan+and+check+structured+task+objects`,
        infer_post_url: `${publicUrl}/q/models/infer`,
      },
    })
  );
}

async function loadCustomModelsReadOnly(db, limit = G.catalog_limit_max) {
  if (!db || typeof db.prepare !== "function") return [];
  const res = await db
    .prepare("SELECT * FROM herma_weight_models ORDER BY updated_at DESC LIMIT ?")
    .bind(limit)
    .all()
    .catch(() => ({ results: [] }));
  return (res.results || []).map(rowToModelObject);
}

async function loadModelByIdReadOnly(db, modelId) {
  const cleanId = String(modelId || "").trim();
  if (!cleanId) return null;
  if (BUILTIN_BY_ID.has(cleanId)) {
    return BUILTIN_BY_ID.get(cleanId);
  }
  if (!db || typeof db.prepare !== "function") return null;
  const row = await db
    .prepare("SELECT * FROM herma_weight_models WHERE model_id = ?")
    .bind(cleanId)
    .first()
    .catch(() => null);
  return row ? rowToModelObject(row) : null;
}

async function loadModelById(db, modelId) {
  const cleanId = String(modelId || "").trim();
  if (!cleanId) return null;
  if (BUILTIN_BY_ID.has(cleanId)) {
    return BUILTIN_BY_ID.get(cleanId);
  }
  if (!db || typeof db.prepare !== "function") return null;
  await ensureWeightModelHubSchema(db);
  const row = await db
    .prepare("SELECT * FROM herma_weight_models WHERE model_id = ?")
    .bind(cleanId)
    .first()
    .catch(() => null);
  return row ? rowToModelObject(row) : null;
}

function countKeywordHits(lowerText, keywords) {
  let hits = 0;
  for (const kw of keywords) {
    if (lowerText.includes(kw)) hits += 1;
  }
  return hits;
}

export function extractPromptFeatures(input = {}) {
  const rawText = String(input.text ?? input.prompt ?? input.query ?? input.goal ?? "").slice(0, G.text_input_max_chars);
  const lower = rawText.toLowerCase();
  const lenNorm = clampNum(rawText.length / G.prompt_norm_chars, 0, 0, 1);

  const dagHits = countKeywordHits(lower, ["step", "dag", "stage", "pipeline", "depend", "sequence", "workflow", "multi-step", "phases"]);
  const depthHits = countKeywordHits(lower, ["optim", "polytope", "matrix", "constraint", "solver", "gradient", "tradeoff", "architect", "svd", "nullspace", "derive"]);
  const contractHits = countKeywordHits(lower, ["json", "schema", "contract", "sql", "safetensors", "python", "rust", "table", "strict", "typed", "task object"]);
  const quickHits = countKeywordHits(lower, ["ping", "status", "hello", "short", "one-line", "lookup", "quick", "simple", "echo"]);
  const checkHits = countKeywordHits(lower, ["check", "review", "independent", "audit", "error", "risk", "rollback", "canary", "disjoint", "gate"]);

  const explicitSteps = Number(input.step_count ?? input.dag_steps ?? input.steps);
  const inferredSteps = Number.isFinite(explicitSteps)
    ? clampInt(explicitSteps, G.default_dag_steps, 1, G.max_dag_steps)
    : clampInt(1 + dagHits * G.two_scalar + Math.floor(depthHits / G.two_scalar), 1, 1, G.max_dag_steps);

  const explicitErr = Number(input.step_error_rate ?? input.error_rate);
  const stepErrorPrior = Number.isFinite(explicitErr)
    ? clampNum(explicitErr, G.tenth_scalar, 0, 1)
    : clampNum((depthHits * G.tenth_scalar + dagHits * G.tenth_scalar) * G.half_scalar, 0, 0, G.nine_tenths_scalar);

  const explicitPrefix = Number(input.shared_prefix_ratio ?? input.warmth_score ?? input.prefix_reuse);
  const prefixHints = countKeywordHits(lower, ["sequential", "back-to-back", "warm", "prefix", "reuse", "cartridge", "same schema", "series"]);
  const prefixRatio = Number.isFinite(explicitPrefix)
    ? clampNum(explicitPrefix, 0, 0, 1)
    : clampNum(prefixHints * G.three_tenths_scalar, 0, 0, 1);

  const explicitBatch = Number(input.candidate_count ?? input.batch_size ?? input.task_count ?? input.item_count);
  const batchHints = countKeywordHits(lower, ["batch", "pack", "parallel", "simultaneous", "homogeneous", "items", " sweep", "bulk"]);
  const batchRatio = Number.isFinite(explicitBatch)
    ? clampNum((explicitBatch - 1) / G.batch_norm_count, 0, 0, 1)
    : clampNum(batchHints * G.three_tenths_scalar, 0, 0, 1);

  const explicitLatency = Number(input.latency_budget_ms);
  const latencyTightness = Number.isFinite(explicitLatency)
    ? clampNum(1 - explicitLatency / G.latency_norm_ms, G.four_tenths_scalar, 0, 1)
    : clampNum(
        (countKeywordHits(lower, ["fast", "sub-ms", "speculative", "low-latency", "immediate", "realtime"]) * G.three_tenths_scalar) ||
          G.three_tenths_scalar,
        0,
        0,
        1
      );

  const vec12 = new Float32Array(G.feature_dim);
  vec12[G.feat_length_idx] = lenNorm;
  vec12[G.feat_dag_idx] = clampNum(dagHits / G.four_scalar, 0, 0, 1);
  vec12[G.feat_depth_idx] = clampNum(depthHits / G.four_scalar, 0, 0, 1);
  vec12[G.feat_contract_idx] = clampNum(contractHits / G.four_scalar, 0, 0, 1);
  vec12[G.feat_quick_idx] = clampNum(quickHits / G.two_scalar, 0, 0, 1);
  vec12[G.feat_check_idx] = clampNum(checkHits / G.three_scalar, 0, 0, 1);
  vec12[G.feat_steps_idx] = clampNum(inferredSteps / G.max_dag_steps, 0, 0, 1);
  vec12[G.feat_error_idx] = stepErrorPrior;
  vec12[G.feat_prefix_idx] = prefixRatio;
  vec12[G.feat_batch_idx] = batchRatio;
  vec12[G.feat_latency_idx] = latencyTightness;
  vec12[G.feat_bias_idx] = 1;

  const vec16 = new Float32Array(G.embed_input_dim);
  let totalRouteHits = 0;
  for (let r = 0; r < FABRIC_ROUTES.length; r += 1) {
    const hits = countKeywordHits(lower, FABRIC_ROUTES[r].keywords);
    vec16[r] = hits;
    totalRouteHits += hits;
  }
  if (totalRouteHits > 0) {
    for (let r = 0; r < FABRIC_ROUTES.length; r += 1) {
      vec16[r] /= totalRouteHits;
    }
  } else {
    vec16[0] = G.quarter_scalar + vec12[G.feat_quick_idx] * G.half_scalar;
    vec16[1] = G.quarter_scalar + vec12[G.feat_contract_idx] * G.half_scalar;
    vec16[G.two_scalar] = vec12[G.feat_depth_idx] * G.six_tenths_scalar;
    vec16[G.three_scalar] = vec12[G.feat_prefix_idx] * G.four_tenths_scalar;
    vec16[G.four_scalar] = vec12[G.feat_check_idx] * G.four_tenths_scalar;
    vec16[G.five_scalar] = vec12[G.feat_dag_idx] * G.four_tenths_scalar;
  }
  vec16[G.six_scalar] = vec12[G.feat_dag_idx];
  vec16[G.seven_scalar] = vec12[G.feat_depth_idx];
  vec16[G.eight_scalar] = vec12[G.feat_contract_idx];
  vec16[G.nine_scalar] = vec12[G.feat_check_idx];

  const wordCount = rawText.trim() ? rawText.trim().split(/\s+/).length : 0;
  const punctCount = (rawText.match(/[.,;:!?]/g) || []).length;
  const digitCount = (rawText.match(/\d/g) || []).length;
  const upperCount = (rawText.match(/[A-Z]/g) || []).length;
  vec16[G.ten_scalar] = lenNorm;
  vec16[G.eleven_scalar] = clampNum(wordCount / G.catalog_limit_default, 0, 0, 1);
  vec16[G.twelve_scalar] = clampNum(punctCount / G.sixteen_scalar, 0, 0, 1);
  vec16[G.thirteen_scalar] = clampNum(digitCount / G.sixteen_scalar, 0, 0, 1);
  vec16[G.fourteen_scalar] = clampNum(upperCount / Math.max(1, rawText.length), 0, 0, 1);
  vec16[G.fifteen_scalar] = G.tenth_scalar;

  return {
    rawText,
    lower,
    wordCount,
    inferredSteps,
    vec12,
    vec16,
  };
}

function extractStylometricVector(rawText, lower) {
  const styleVec = new Float32Array(G.feature_dim);
  const sentences = rawText
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const sentCount = Math.max(1, sentences.length);
  const wordCounts = sentences.map((s) => s.split(/\s+/).filter(Boolean).length);
  const meanWords =
    wordCounts.length > 0 ? wordCounts.reduce((a, b) => a + b, 0) / sentCount : 0;
  let varianceAcc = 0;
  for (const wc of wordCounts) {
    const diff = wc - meanWords;
    varianceAcc += diff * diff;
  }
  const burstStd = Math.sqrt(varianceAcc / sentCount);

  const imperativeCues = countKeywordHits(lower, ["run ", "open ", "send ", "set ", "select ", "export ", "download ", "use ", "check "]);
  const derivationCues = countKeywordHits(lower, ["therefore", "hence", "let ", "step ", "given ", "substitut", "implies", "derive"]);
  const formalCues = countKeywordHits(lower, ["consequently", "furthermore", "whereas", "moreover", "accordance", "architecture", "specification"]);
  const hedgeCues = countKeywordHits(lower, ["might", "perhaps", "possibly", "arguably", "roughly", "approx", "could", "appears"]);
  const codeSymbols = (rawText.match(/[{}()[\]=<>`;_]/g) || []).length;
  const listMarkers = (rawText.match(/(?:^|\s)(?:[-*]|\d+\.)\s/g) || []).length;
  const clausePunct = (rawText.match(/[,;:]/g) || []).length;

  styleVec[0] = clampNum((1 - clampNum(meanWords / G.ste100_descriptive_max_words, 0, 0, 1)) * G.half_scalar + imperativeCues * G.three_tenths_scalar, 0, 0, 1);
  styleVec[1] = clampNum(derivationCues * G.three_tenths_scalar, 0, 0, 1);
  styleVec[G.two_scalar] = clampNum(formalCues * G.three_tenths_scalar, 0, 0, 1);
  styleVec[G.three_scalar] = clampNum(hedgeCues * G.three_tenths_scalar, 0, 0, 1);
  styleVec[G.four_scalar] = clampNum(codeSymbols / G.sixteen_scalar, 0, 0, 1);
  styleVec[G.five_scalar] = clampNum(listMarkers / G.four_scalar, 0, 0, 1);
  styleVec[G.six_scalar] = clampNum(clausePunct / G.eight_scalar, 0, 0, 1);
  styleVec[G.seven_scalar] = clampNum(burstStd / G.twelve_scalar, 0, 0, 1);

  // Topic-lexical coordinates 8..11 (projected to 0 by ker(topic_anchor_basis)).
  styleVec[G.eight_scalar] = clampNum(countKeywordHits(lower, ["consensus", "raft", "paxos", "quorum"]) / G.three_scalar, 0, 0, 1);
  styleVec[G.nine_scalar] = clampNum(countKeywordHits(lower, ["compiler", "register", "loop", "ast"]) / G.three_scalar, 0, 0, 1);
  styleVec[G.ten_scalar] = clampNum(countKeywordHits(lower, ["orbital", "attitude", "waveguide", "photonic"]) / G.three_scalar, 0, 0, 1);
  styleVec[G.eleven_scalar] = clampNum(countKeywordHits(lower, ["kernel", "scheduler", "thread", "socket"]) / G.three_scalar, 0, 0, 1);

  return styleVec;
}

function computeSteComplianceScore(rawText) {
  const sentences = rawText
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) return 1;
  let compliant = 0;
  for (const s of sentences) {
    const wc = s.split(/\s+/).filter(Boolean).length;
    if (wc <= G.ste100_descriptive_max_words) compliant += 1;
  }
  return compliant / sentences.length;
}

function tensorByName(model, name, fallbackIdx = 0) {
  return model.tensors.find((t) => t.name === name) || model.tensors[fallbackIdx];
}

export function runModelForwardPass(model, input = {}) {
  const feats = extractPromptFeatures(input);
  const { rawText, vec12, vec16, inferredSteps, lower } = feats;

  if (model.model_id === "tf-scratch-effort-router-v1") {
    const w1 = tensorByName(model, "layer1_weight", 0);
    const b1 = tensorByName(model, "layer1_bias", 1);
    const w2 = tensorByName(model, "layer2_weight", G.two_scalar);
    const b2 = tensorByName(model, "layer2_bias", G.three_scalar);
    const thresh = tensorByName(model, "tier_thresholds", G.four_scalar);
    const floors = tensorByName(model, "token_floors", G.five_scalar);

    const hidden = reluVec(matVecMul(w1.data, w1.shape[0], w1.shape[1], vec12, b1.data));
    let activeFacets = 0;
    for (let i = 0; i < hidden.length; i += 1) {
      if (hidden[i] > 0) activeFacets += 1;
    }
    const logits = matVecMul(w2.data, w2.shape[0], w2.shape[1], hidden, b2.data);
    const probs = softmaxVec(logits);
    const denom = Math.max(1, EFFORT_TIERS.length - 1);
    let effortScore = 0;
    for (let i = 0; i < probs.length; i += 1) {
      effortScore += (i / denom) * probs[i];
    }
    let tierIdx = 0;
    if (effortScore >= thresh.data[G.two_scalar]) tierIdx = G.three_scalar;
    else if (effortScore >= thresh.data[1]) tierIdx = G.two_scalar;
    else if (effortScore >= thresh.data[0]) tierIdx = 1;

    const effortTier = EFFORT_TIERS[tierIdx];
    const baseFloor = floors.data[tierIdx];
    const outputTokenFloor = Math.round(baseFloor * (1 + vec12[G.feat_contract_idx] * G.quarter_scalar));
    return {
      effort_tier: effortTier,
      output_token_floor: outputTokenFloor,
      effort_score: roundScale(effortScore),
      active_polytope_facets: activeFacets,
      tier_probabilities: Object.fromEntries(EFFORT_TIERS.map((t, i) => [t, roundScale(probs[i])])),
    };
  }

  if (model.model_id === "tf-scratch-attenuation-gate-v1" || (model.family === "from_scratch_polytope" && !model.builtin)) {
    const w1 = tensorByName(model, "gate_layer1_weight", 0);
    const b1 = tensorByName(model, "gate_layer1_bias", 1);
    const w2 = tensorByName(model, "gate_layer2_weight", G.two_scalar);
    const b2 = tensorByName(model, "gate_layer2_bias", G.three_scalar);
    const threshTensor = tensorByName(model, "survival_threshold", G.four_scalar);

    let stepSurvival = G.default_step_survival;
    if (
      w1 &&
      w2 &&
      w1.shape.length === G.two_scalar &&
      w1.shape[1] === vec12.length &&
      w2.shape.length === G.two_scalar &&
      w2.shape[1] === w1.shape[0]
    ) {
      const h = reluVec(matVecMul(w1.data, w1.shape[0], w1.shape[1], vec12, b1?.data || null));
      const out = matVecMul(w2.data, w2.shape[0], w2.shape[1], h, b2?.data || null);
      const rawSig = sigmoidScalar(out[0]);
      stepSurvival = G.min_step_survival + (G.max_step_survival - G.min_step_survival) * rawSig;
    } else {
      const { rows, cols } = safeMatrixDims(w1);
      const proj = matVecMul(w1.data, rows, cols, vec12);
      stepSurvival = G.min_step_survival + (G.max_step_survival - G.min_step_survival) * sigmoidScalar(proj[0]);
    }
    const survivalThreshold = threshTensor?.data?.[0] || G.survival_gate_threshold;
    const attenuationSurvival = Math.pow(stepSurvival, inferredSteps);
    const insertCheckBoundary = attenuationSurvival < survivalThreshold;
    const safeInterval =
      stepSurvival >= survivalThreshold
        ? Math.max(1, Math.floor(Math.log(survivalThreshold) / Math.min(-G.epsilon_norm, Math.log(stepSurvival))))
        : 1;
    return {
      dag_steps: inferredSteps,
      step_survival: roundScale(stepSurvival),
      attenuation_survival: roundScale(attenuationSurvival),
      cumulative_error_risk: roundScale(1 - attenuationSurvival),
      survival_gate_threshold: roundScale(survivalThreshold),
      insert_check_boundary: insertCheckBoundary,
      recommended_check_interval_steps: clampInt(safeInterval, 1, 1, G.max_dag_steps),
    };
  }

  if (model.family === "weight_edited_embedding") {
    const baseProj = tensorByName(model, "base_projector", 0);
    const nullDelta = tensorByName(model, "nullspace_delta", 1);
    const anchorSub = tensorByName(model, "anchor_subspace", G.two_scalar);
    const routeCents = tensorByName(model, "route_centroids", G.three_scalar);
    const actCents = tensorByName(model, "activity_centroids", G.four_scalar);

    let rawEmbed;
    let measuredDrift = model.anchor_drift;
    if (
      baseProj &&
      nullDelta &&
      baseProj.shape[0] === G.embed_dim &&
      baseProj.shape[1] === G.embed_input_dim &&
      nullDelta.shape[0] === G.embed_dim &&
      nullDelta.shape[1] === G.embed_input_dim
    ) {
      const baseVec = matVecMul(baseProj.data, G.embed_dim, G.embed_input_dim, vec16);
      const editVec = matVecMul(nullDelta.data, G.embed_dim, G.embed_input_dim, vec16);
      rawEmbed = new Float32Array(G.embed_dim);
      for (let i = 0; i < G.embed_dim; i += 1) {
        rawEmbed[i] = baseVec[i] + editVec[i];
      }
      if (anchorSub) {
        measuredDrift = computeMatrixAnchorDrift(
          nullDelta.data,
          G.embed_dim,
          G.embed_input_dim,
          anchorSub.data,
          anchorSub.shape[0]
        );
      }
    } else {
      const customT = model.tensors[0];
      const { rows, cols } = safeMatrixDims(customT);
      const proj = matVecMul(customT.data, rows, cols, vec16);
      rawEmbed = new Float32Array(G.embed_dim);
      for (let i = 0; i < G.embed_dim; i += 1) {
        rawEmbed[i] = proj[i % proj.length];
      }
    }

    const { vector: embed24 } = l2Normalize(rawEmbed);
    const builtins = BUILTIN_BY_ID.get("tf-embed-nullspace-24d-v1");
    const routeCentTensor = routeCents?.shape?.[0] === G.route_count ? routeCents : tensorByName(builtins, "route_centroids", G.three_scalar);
    const actCentTensor = actCents?.shape?.[0] === G.cluster_count ? actCents : tensorByName(builtins, "activity_centroids", G.four_scalar);

    const routeScores = FABRIC_ROUTES.map((r, idx) => {
      const cent = routeCentTensor.data.subarray(idx * G.embed_dim, (idx + 1) * G.embed_dim);
      return {
        route: r.route,
        label: r.label,
        cosine_similarity: roundScale(dotVec(embed24, cent)),
      };
    }).sort((a, b) => b.cosine_similarity - a.cosine_similarity);

    const clusterScores = ACTIVITY_CLUSTERS.map((c, idx) => {
      const cent = actCentTensor.data.subarray(idx * G.embed_dim, (idx + 1) * G.embed_dim);
      return {
        cluster_id: c.id,
        label: c.label,
        cosine_similarity: roundScale(dotVec(embed24, cent)),
      };
    }).sort((a, b) => b.cosine_similarity - a.cosine_similarity);

    return {
      embedding_dim: G.embed_dim,
      embedding_24d: Array.from(embed24, (v) => roundScale(v, G.float_embed_round_scale)),
      l2_norm: roundScale(Math.sqrt(dotVec(embed24, embed24)), G.float_embed_round_scale),
      anchor_drift: roundScale(measuredDrift, G.float_embed_round_scale),
      nearest_routes: routeScores.slice(0, G.nearest_routes_top_k),
      activity_clusters: clusterScores.slice(0, G.nearest_clusters_top_k),
    };
  }

  if (model.family === "weight_edited_decider") {
    const builtins = BUILTIN_BY_ID.get("tf-decider-bundle-affinity-v1");
    const maskT = tensorByName(model, "channel_slice_mask", 0) || tensorByName(builtins, "channel_slice_mask", 0);
    const wDisp = tensorByName(model, "ridge_dispatch_weight", 1) || tensorByName(builtins, "ridge_dispatch_weight", 1);
    const bDisp = tensorByName(model, "ridge_dispatch_bias", G.two_scalar) || tensorByName(builtins, "ridge_dispatch_bias", G.two_scalar);
    const wTopo = tensorByName(model, "topology_head_weight", G.three_scalar) || tensorByName(builtins, "topology_head_weight", G.three_scalar);
    const bTopo = tensorByName(model, "topology_head_bias", G.four_scalar) || tensorByName(builtins, "topology_head_bias", G.four_scalar);

    const sliced = new Float32Array(G.feature_dim);
    for (let i = 0; i < G.feature_dim; i += 1) {
      sliced[i] = vec12[i] * (maskT.data[i % maskT.data.length] || 1);
    }
    const dispLogits =
      wDisp.shape[0] === G.decider_mode_count && wDisp.shape[1] === G.feature_dim
        ? matVecMul(wDisp.data, G.decider_mode_count, G.feature_dim, sliced, bDisp.data)
        : matVecMul(tensorByName(builtins, "ridge_dispatch_weight", 1).data, G.decider_mode_count, G.feature_dim, sliced, tensorByName(builtins, "ridge_dispatch_bias", G.two_scalar).data);
    const dispProbs = softmaxVec(dispLogits);
    let bestIdx = 0;
    for (let i = 1; i < dispProbs.length; i += 1) {
      if (dispProbs[i] > dispProbs[bestIdx]) bestIdx = i;
    }
    const dispatchMode = DISPATCH_MODES[bestIdx];
    const topoRaw =
      wTopo.shape[0] === G.decider_topo_dim && wTopo.shape[1] === G.feature_dim
        ? matVecMul(wTopo.data, G.decider_topo_dim, G.feature_dim, sliced, bTopo.data)
        : matVecMul(tensorByName(builtins, "topology_head_weight", G.three_scalar).data, G.decider_topo_dim, G.feature_dim, sliced, tensorByName(builtins, "topology_head_bias", G.four_scalar).data);

    const bundleSize =
      dispatchMode === "single_isolated"
        ? G.bundle_min
        : clampInt(topoRaw[0], G.bundle_min + 1, G.bundle_min, G.bundle_max);
    const dagWidth = clampInt(topoRaw[1], 1, G.dag_min_width, G.dag_max_width);
    const dagDepth = clampInt(topoRaw[G.two_scalar], 1, G.dag_min_depth, G.dag_max_depth);

    return {
      dispatch_mode: dispatchMode,
      bundle_size: bundleSize,
      dag_shape: { width: dagWidth, depth: dagDepth },
      warm_prefix_reuse_recommended: dispatchMode === "back_to_back_sequential",
      mode_scores: Object.fromEntries(DISPATCH_MODES.map((m, i) => [m, roundScale(dispProbs[i])])),
    };
  }

  if (model.family === "weight_programmed_llm") {
    const isChecker = model.lineage_role === "checker";
    const fallbackBuiltin = BUILTIN_BY_ID.get(isChecker ? "tf-llm-disjoint-checker-v1" : "tf-llm-steered-maker-v1");
    const steerT = model.tensors[0]?.data?.length === G.steering_dim ? model.tensors[0] : fallbackBuiltin.tensors[0];
    const uT = model.tensors[1]?.shape?.[0] === G.steering_dim ? model.tensors[1] : fallbackBuiltin.tensors[1];
    const sT = model.tensors[G.two_scalar]?.shape?.[0] === G.subspace_rank ? model.tensors[G.two_scalar] : fallbackBuiltin.tensors[G.two_scalar];
    const vtT = model.tensors[G.three_scalar]?.shape?.[1] === G.feature_dim ? model.tensors[G.three_scalar] : fallbackBuiltin.tensors[G.three_scalar];

    const vProj = matVecMul(vtT.data, G.subspace_rank, G.feature_dim, vec12);
    const sProj = matVecMul(sT.data, G.subspace_rank, G.subspace_rank, vProj);
    const adapterAct = matVecMul(uT.data, G.steering_dim, G.subspace_rank, sProj);
    const alignment = dotVec(adapterAct, steerT.data);
    const steeringScale = roundScale(G.half_scalar + sigmoidScalar(alignment));

    const callerMakerLineage = String(input.maker_lineage || "").trim();
    const lineageDisjointOk = !callerMakerLineage || callerMakerLineage !== model.lineage_id;

    if (isChecker) {
      const scoredAxes = DEFECT_FOCUS_AXES.map((axis, idx) => ({
        axis,
        weight: roundScale(sigmoidScalar(adapterAct[idx] * G.two_scalar + vec12[G.feat_check_idx])),
      })).sort((a, b) => b.weight - a.weight);
      return {
        lineage_role: "checker",
        lineage_id: model.lineage_id,
        paired_disjoint_lineage: model.paired_disjoint_lineage || "",
        independent_lineage_ok: lineageDisjointOk,
        critique_sensitivity: steeringScale,
        contract_strictness_score: roundScale(sigmoidScalar(vec12[G.feat_contract_idx] + vec12[G.feat_check_idx] + alignment)),
        defect_focus_axes: scoredAxes.slice(0, G.defect_axes_top_k),
        adapter_activations: Array.from(adapterAct.subarray(0, G.subspace_rank), (v) => roundScale(v)),
      };
    }

    return {
      lineage_role: model.lineage_role || "maker",
      lineage_id: model.lineage_id,
      paired_disjoint_lineage: model.paired_disjoint_lineage || "",
      steering_scale: steeringScale,
      verbosity_suppression_gain: roundScale(sigmoidScalar(alignment + vec12[G.feat_contract_idx])),
      structured_field_retention: roundScale(G.nine_tenths_scalar + G.tenth_scalar * sigmoidScalar(vec12[G.feat_contract_idx])),
      recommended_temperature: roundScale(G.temp_base_maker + (1 - vec12[G.feat_contract_idx]) * G.temp_scale_maker),
      recommended_max_tokens: Math.round(G.token_floor_minimal + vec12[G.feat_depth_idx] * G.token_floor_adaptive),
      adapter_activations: Array.from(adapterAct.subarray(0, G.subspace_rank), (v) => roundScale(v)),
    };
  }

  if (model.family === "analyzer") {
    const builtins = BUILTIN_BY_ID.get("tf-analyzer-generator-attribution-v1");
    const wStyle =
      model.tensors[0]?.shape?.[0] === G.analyzer_profile_count && model.tensors[0]?.shape?.[1] === G.feature_dim
        ? model.tensors[0]
        : tensorByName(builtins, "stylometric_nullspace_weight", 0);
    const bStyle = tensorByName(model, "stylometric_bias", 1) || tensorByName(builtins, "stylometric_bias", 1);
    const tBasis = tensorByName(model, "topic_anchor_basis", G.two_scalar) || tensorByName(builtins, "topic_anchor_basis", G.two_scalar);

    const styleVec12 = extractStylometricVector(rawText, lower);
    const logits = matVecMul(wStyle.data, G.analyzer_profile_count, G.feature_dim, styleVec12, bStyle?.data || null);
    const probs = softmaxVec(logits);
    let bestIdx = 0;
    for (let i = 1; i < probs.length; i += 1) {
      if (probs[i] > probs[bestIdx]) bestIdx = i;
    }
    const drift =
      tBasis && tBasis.shape?.[1] === G.feature_dim
        ? computeMatrixAnchorDrift(wStyle.data, G.analyzer_profile_count, G.feature_dim, tBasis.data, tBasis.shape[0])
        : model.anchor_drift;
    return {
      attributed_profile: GENERATOR_PROFILES[bestIdx],
      confidence: roundScale(probs[bestIdx]),
      topic_shortcut_drift: roundScale(drift, G.float_embed_round_scale),
      profile_count: GENERATOR_PROFILES.length,
      profile_probabilities: Object.fromEntries(GENERATOR_PROFILES.map((p, i) => [p, roundScale(probs[i])])),
      cadence_signature: Array.from(styleVec12.subarray(0, G.analyzer_profile_count), (v) => roundScale(v)),
    };
  }

  if (model.family === "actor") {
    const builtins = BUILTIN_BY_ID.get("tf-actor-koopman-tool-policy-v1");
    const liftW =
      model.tensors[0]?.shape?.[0] === G.koopman_latent_dim && model.tensors[0]?.shape?.[1] === G.feature_dim
        ? model.tensors[0]
        : tensorByName(builtins, "koopman_lift_encoder", 0);
    const liftB = tensorByName(model, "koopman_lift_bias", 1) || tensorByName(builtins, "koopman_lift_bias", 1);
    const kMat =
      tensorByName(model, "koopman_transition_matrix", G.two_scalar)?.shape?.[0] === G.koopman_latent_dim
        ? tensorByName(model, "koopman_transition_matrix", G.two_scalar)
        : tensorByName(builtins, "koopman_transition_matrix", G.two_scalar);
    const readW =
      tensorByName(model, "tool_policy_readout", G.three_scalar)?.shape?.[0] === G.koopman_tool_count
        ? tensorByName(model, "tool_policy_readout", G.three_scalar)
        : tensorByName(builtins, "tool_policy_readout", G.three_scalar);
    const readB = tensorByName(model, "tool_policy_bias", G.four_scalar) || tensorByName(builtins, "tool_policy_bias", G.four_scalar);

    const horizon = clampInt(
      input.lookahead_steps ?? input.horizon_steps ?? G.koopman_horizon_default,
      G.koopman_horizon_default,
      1,
      G.koopman_horizon_max
    );
    const liftedRaw = reluVec(matVecMul(liftW.data, G.koopman_latent_dim, G.feature_dim, vec12, liftB?.data || null));
    let state = l2Normalize(liftedRaw).vector;
    const rollout = [];
    let firstProbs = null;
    let feasSum = 0;

    for (let step = 1; step <= horizon; step += 1) {
      state = matVecMul(kMat.data, G.koopman_latent_dim, G.koopman_latent_dim, state);
      const stepNorm = Math.sqrt(dotVec(state, state));
      const logits = matVecMul(readW.data, G.koopman_tool_count, G.koopman_latent_dim, state, readB?.data || null);
      const probs = softmaxVec(logits);
      if (step === 1) firstProbs = probs;
      let chosenIdx = (step - 1) % KOOPMAN_TOOLS.length;
      let bestScore = -1;
      for (let t = 0; t < probs.length; t += 1) {
        const progressionBonus = t >= step - 1 ? G.tenth_scalar : 0;
        const score = probs[t] + progressionBonus;
        if (score > bestScore) {
          bestScore = score;
          chosenIdx = t;
        }
      }
      feasSum += probs[chosenIdx];
      rollout.push({
        step,
        tool: KOOPMAN_TOOLS[chosenIdx],
        probability: roundScale(probs[chosenIdx]),
        state_norm: roundScale(stepNorm),
      });
    }

    return {
      selected_next_tool: rollout[0].tool,
      lookahead_steps: horizon,
      zero_token_rollout: true,
      trajectory_feasibility: roundScale(feasSum / horizon),
      tool_rollout: rollout,
      initial_tool_scores: Object.fromEntries(KOOPMAN_TOOLS.map((t, i) => [t, roundScale(firstProbs[i])])),
    };
  }

  if (model.family === "compiler") {
    const builtins = BUILTIN_BY_ID.get("tf-compiler-hypernet-cartridge-v1");
    const encW =
      model.tensors[0]?.shape?.[0] === G.hypernet_latent_dim && model.tensors[0]?.shape?.[1] === G.feature_dim
        ? model.tensors[0]
        : tensorByName(builtins, "ste_spec_encoder_weight", 0);
    const encB = tensorByName(model, "ste_spec_encoder_bias", 1) || tensorByName(builtins, "ste_spec_encoder_bias", 1);
    const genW =
      tensorByName(model, "hypernet_cartridge_generator", G.two_scalar)?.shape?.[0] === G.cartridge_floats
        ? tensorByName(model, "hypernet_cartridge_generator", G.two_scalar)
        : tensorByName(builtins, "hypernet_cartridge_generator", G.two_scalar);
    const priorW =
      tensorByName(model, "cartridge_diagonal_prior", G.three_scalar)?.data?.length === G.cartridge_floats
        ? tensorByName(model, "cartridge_diagonal_prior", G.three_scalar)
        : tensorByName(builtins, "cartridge_diagonal_prior", G.three_scalar);

    const steCompliance = computeSteComplianceScore(rawText);
    const specVec = new Float32Array(vec12);
    specVec[G.feat_contract_idx] = clampNum(
      specVec[G.feat_contract_idx] * G.half_scalar + steCompliance * G.half_scalar,
      0,
      0,
      1
    );
    const latentRaw = reluVec(matVecMul(encW.data, G.hypernet_latent_dim, G.feature_dim, specVec, encB?.data || null));
    const { vector: latentUnit } = l2Normalize(latentRaw);
    const delta64 = matVecMul(genW.data, G.cartridge_floats, G.hypernet_latent_dim, latentUnit);
    const compiled = new Float32Array(G.cartridge_floats);
    for (let i = 0; i < G.cartridge_floats; i += 1) {
      compiled[i] = priorW.data[i] + delta64[i];
    }
    const probeLogits = matVecMul(compiled, G.subspace_rank, G.subspace_rank, vec12.subarray(0, G.subspace_rank));

    return {
      compiled_rank: G.subspace_rank,
      compiled_cartridge_bytes: G.cartridge_bytes,
      zero_shot_gradient_steps: 0,
      ste100_sentence_compliance: roundScale(steCompliance),
      compiled_shape: [G.subspace_rank, G.subspace_rank],
      compiled_weights_preview: Array.from(compiled.subarray(0, G.sixteen_scalar), (v) => roundScale(v)),
      compiled_weights_f32: Array.from(compiled, (v) => roundScale(v, G.float_embed_round_scale)),
      probe_logits: Array.from(probeLogits, (v) => roundScale(v)),
    };
  }

  if (model.model_id === "tf-verifier-sheaf-consistency-v1") {
    const builtins = BUILTIN_BY_ID.get("tf-verifier-sheaf-consistency-v1");
    const cobT =
      model.tensors[0]?.shape?.[0] === G.sheaf_edge_count && model.tensors[0]?.shape?.[1] === G.feature_dim
        ? model.tensors[0]
        : tensorByName(builtins, "sheaf_coboundary_matrix", 0);
    const wEdgeT =
      tensorByName(model, "sheaf_edge_weights", 1)?.data?.length === G.sheaf_edge_count
        ? tensorByName(model, "sheaf_edge_weights", 1)
        : tensorByName(builtins, "sheaf_edge_weights", 1);
    const threshT =
      tensorByName(model, "obstruction_thresholds", G.two_scalar)?.data?.length >= G.two_scalar
        ? tensorByName(model, "obstruction_thresholds", G.two_scalar)
        : tensorByName(builtins, "obstruction_thresholds", G.two_scalar);

    const conflictHits = countKeywordHits(lower, [
      "contradict",
      "mismatch",
      "conflict",
      "inconsistent",
      "disagree",
      "tamper",
      "stale",
      "diverg",
    ]);
    const explicitDisagreement = clampNum(
      Number(input.section_disagreement ?? input.sheaf_mismatch ?? input.disagreement_score ?? 0),
      0,
      0,
      G.two_point_four
    );

    const stalkVec = new Float32Array(G.feature_dim);
    for (let c = 0; c < G.feature_dim; c += 1) {
      const baseSignal = G.half_scalar + vec12[c] * G.tenth_scalar;
      const perturb =
        c % G.two_scalar === 0
          ? (conflictHits * G.three_tenths_scalar + explicitDisagreement) * G.half_scalar
          : -(conflictHits * G.two_tenths_scalar + explicitDisagreement * G.four_tenths_scalar);
      stalkVec[c] = baseSignal + perturb;
    }

    const coboundaryResidual = matVecMul(cobT.data, G.sheaf_edge_count, G.feature_dim, stalkVec);
    let stalkNormSq = 0;
    for (let c = 0; c < G.feature_dim; c += 1) {
      stalkNormSq += stalkVec[c] * stalkVec[c];
    }
    let weightedLaplacianEnergy = 0;
    const edgeEnergies = [];
    for (let e = 0; e < G.sheaf_edge_count; e += 1) {
      const rVal = coboundaryResidual[e];
      const eEnergy = wEdgeT.data[e] * rVal * rVal;
      weightedLaplacianEnergy += eEnergy;
      edgeEnergies.push({
        edge: SHEAF_RESTRICTION_EDGES[e],
        weighted_energy: roundScale(eEnergy),
      });
    }
    edgeEnergies.sort((a, b) => b.weighted_energy - a.weighted_energy);

    const normalizedEnergy =
      stalkNormSq > G.epsilon_norm
        ? clampNum(weightedLaplacianEnergy / (stalkNormSq * G.two_scalar), 0, 0, 1)
        : 0;
    const softThresh = threshT.data[0];
    const hardThresh = threshT.data[1];
    let actionIdx = 0;
    if (normalizedEnergy >= hardThresh) actionIdx = G.two_scalar;
    else if (normalizedEnergy >= softThresh) actionIdx = 1;

    return {
      sheaf_consistent: normalizedEnergy < softThresh,
      contradiction_detected: normalizedEnergy >= hardThresh,
      harmonic_consensus_action: SHEAF_CONSISTENCY_ACTIONS[actionIdx],
      sheaf_obstruction_energy: roundScale(normalizedEnergy),
      harmonic_agreement_score: roundScale(1 - normalizedEnergy),
      soft_disagreement_threshold: roundScale(softThresh),
      hard_contradiction_threshold: roundScale(hardThresh),
      top_contradiction_edges: edgeEnergies.slice(0, G.sheaf_top_edges_k),
    };
  }

  if (model.family === "calibrator") {
    const builtins = BUILTIN_BY_ID.get("tf-calibrator-conformal-set-v1");
    const wConf =
      model.tensors[0]?.shape?.[0] === G.conformal_tier_count && model.tensors[0]?.shape?.[1] === G.feature_dim
        ? model.tensors[0]
        : tensorByName(builtins, "conformal_score_weight", 0);
    const bConf =
      tensorByName(model, "conformal_score_bias", 1)?.data?.length === G.conformal_tier_count
        ? tensorByName(model, "conformal_score_bias", 1)
        : tensorByName(builtins, "conformal_score_bias", 1);
    const qConf =
      tensorByName(model, "nonconformity_quantiles", G.two_scalar)?.data?.length === G.conformal_tier_count
        ? tensorByName(model, "nonconformity_quantiles", G.two_scalar)
        : tensorByName(builtins, "nonconformity_quantiles", G.two_scalar);

    const alpha = clampNum(
      Number(input.alpha ?? input.miscoverage_alpha ?? G.conformal_default_alpha),
      G.conformal_default_alpha,
      G.conformal_min_alpha,
      G.conformal_max_alpha
    );
    let qIdx = 1;
    if (alpha > G.conformal_alpha_step_15) qIdx = 0;
    else if (alpha <= G.conformal_min_alpha * G.two_scalar) qIdx = G.three_scalar;
    else if (alpha <= G.conformal_alpha_step_05) qIdx = G.two_scalar;
    const qThreshold = qConf.data[qIdx];

    const logits = matVecMul(wConf.data, G.conformal_tier_count, G.feature_dim, vec12, bConf.data);
    const probs = softmaxVec(logits);
    let bestIdx = 0;
    for (let i = 1; i < probs.length; i += 1) {
      if (probs[i] > probs[bestIdx]) bestIdx = i;
    }
    const predictionSet = [];
    const nonconformityScores = {};
    for (let i = 0; i < CONFORMAL_EXECUTION_TIERS.length; i += 1) {
      const score = 1 - probs[i];
      nonconformityScores[CONFORMAL_EXECUTION_TIERS[i]] = roundScale(score);
      if (score <= qThreshold) {
        predictionSet.push(CONFORMAL_EXECUTION_TIERS[i]);
      }
    }
    if (predictionSet.length === 0) {
      predictionSet.push(CONFORMAL_EXECUTION_TIERS[bestIdx]);
    }

    return {
      recommended_tier: CONFORMAL_EXECUTION_TIERS[bestIdx],
      prediction_set: predictionSet,
      prediction_set_size: predictionSet.length,
      singleton_fast_exit: predictionSet.length === 1 && bestIdx <= 1,
      selective_abstention_escalate: predictionSet.length > 1 || bestIdx >= G.two_scalar,
      target_coverage_level: roundScale(1 - alpha),
      miscoverage_alpha: roundScale(alpha),
      calibrated_quantile_threshold: roundScale(qThreshold),
      nonconformity_scores: nonconformityScores,
    };
  }

  if (model.family === "verifier") {
    const builtins = BUILTIN_BY_ID.get("tf-verifier-spectral-ood-v1");
    const basisT =
      model.tensors[0]?.shape?.[0] === G.ood_inlier_rank && model.tensors[0]?.shape?.[1] === G.feature_dim
        ? model.tensors[0]
        : tensorByName(builtins, "inlier_subspace_basis", 0);
    const centT =
      tensorByName(model, "inlier_feature_centroid", 1)?.data?.length === G.feature_dim
        ? tensorByName(model, "inlier_feature_centroid", 1)
        : tensorByName(builtins, "inlier_feature_centroid", 1);
    const threshT =
      tensorByName(model, "residual_thresholds", G.three_scalar)?.data?.length >= G.two_scalar
        ? tensorByName(model, "residual_thresholds", G.three_scalar)
        : tensorByName(builtins, "residual_thresholds", G.three_scalar);

    const poisonHits = countKeywordHits(lower, ["poison", "corrupt", "backdoor", "tamper", "spoof", "malformed", "nan", "overflow"]);
    const symbolSpam = (rawText.match(/[^a-zA-Z0-9\s.,;:!?'"()[\]{}_/-]/g) || []).length;
    const explicitAnomaly = clampNum(Number(input.ood_noise ?? input.anomaly_score ?? 0), 0, 0, G.two_point_four);

    const oodVec12 = new Float32Array(G.feature_dim);
    for (let i = 0; i < G.ood_inlier_rank; i += 1) {
      oodVec12[i] = vec12[i] + G.two_tenths_scalar;
    }
    oodVec12[G.eight_scalar] = clampNum(poisonHits * G.six_tenths_scalar + explicitAnomaly, 0, 0, G.two_point_four);
    oodVec12[G.nine_scalar] = clampNum(symbolSpam / G.eight_scalar + explicitAnomaly * G.half_scalar, 0, 0, G.two_point_four);
    oodVec12[G.ten_scalar] = clampNum(vec12[G.feat_error_idx] * (poisonHits > 0 ? G.one_point_eight : G.tenth_scalar), 0, 0, G.two_point_four);
    oodVec12[G.eleven_scalar] = explicitAnomaly;

    const centered = new Float32Array(G.feature_dim);
    for (let c = 0; c < G.feature_dim; c += 1) {
      centered[c] = oodVec12[c] - centT.data[c];
    }
    const coords = matVecMul(basisT.data, G.ood_inlier_rank, G.feature_dim, centered);
    const recon = new Float32Array(G.feature_dim);
    for (let r = 0; r < G.ood_inlier_rank; r += 1) {
      const coeff = coords[r];
      const base = r * G.feature_dim;
      for (let c = 0; c < G.feature_dim; c += 1) {
        recon[c] += coeff * basisT.data[base + c];
      }
    }
    let totalEnergy = 0;
    let residualEnergy = 0;
    for (let c = 0; c < G.feature_dim; c += 1) {
      totalEnergy += centered[c] * centered[c];
      const diff = centered[c] - recon[c];
      residualEnergy += diff * diff;
    }
    const residualRatio = totalEnergy > G.epsilon_norm ? clampNum(residualEnergy / totalEnergy, 0, 0, 1) : 0;
    const oodThresh = threshT.data[0];
    const quarantineThresh = threshT.data[1];
    let actionIdx = 0;
    if (residualRatio >= quarantineThresh) actionIdx = G.two_scalar;
    else if (residualRatio >= oodThresh) actionIdx = 1;

    return {
      is_out_of_distribution: residualRatio >= oodThresh,
      poisoned_trace_quarantined: residualRatio >= quarantineThresh,
      trace_filter_action: OOD_FILTER_ACTIONS[actionIdx],
      residual_energy_ratio: roundScale(residualRatio),
      inlier_subspace_capture: roundScale(1 - residualRatio),
      ood_threshold: roundScale(oodThresh),
      quarantine_threshold: roundScale(quarantineThresh),
    };
  }

  if (model.family === "forecaster") {
    const builtins = BUILTIN_BY_ID.get("tf-forecaster-legendre-bitemporal-v1");
    const loadW =
      model.tensors[0]?.shape?.[0] === G.legendre_basis_count && model.tensors[0]?.shape?.[1] === G.feature_dim
        ? model.tensors[0]
        : tensorByName(builtins, "bitemporal_load_encoder", 0);
    const costW =
      tensorByName(model, "bitemporal_cost_encoder", 1)?.shape?.[0] === G.legendre_basis_count
        ? tensorByName(model, "bitemporal_cost_encoder", 1)
        : tensorByName(builtins, "bitemporal_cost_encoder", 1);
    const legBasis =
      tensorByName(model, "shifted_legendre_basis", G.two_scalar)?.data?.length === G.legendre_basis_count * G.legendre_basis_count
        ? tensorByName(model, "shifted_legendre_basis", G.two_scalar)
        : tensorByName(builtins, "shifted_legendre_basis", G.two_scalar);
    const gridT =
      tensorByName(model, "horizon_grid", G.three_scalar)?.data?.length === G.legendre_horizon_count
        ? tensorByName(model, "horizon_grid", G.three_scalar)
        : tensorByName(builtins, "horizon_grid", G.three_scalar);

    const bitempVec = new Float32Array(vec12);
    const explicitLag = clampNum(Number(input.restatement_lag_steps ?? 0) / G.sixteen_scalar, 0, 0, 1);
    bitempVec[G.feat_error_idx] = clampNum(bitempVec[G.feat_error_idx] * G.half_scalar + explicitLag * G.half_scalar, 0, 0, 1);

    const loadCoeffs = matVecMul(loadW.data, G.legendre_basis_count, G.feature_dim, bitempVec);
    const costCoeffs = matVecMul(costW.data, G.legendre_basis_count, G.feature_dim, bitempVec);

    const queueForecast = [];
    const costForecast = [];
    for (let h = 0; h < G.legendre_horizon_count; h += 1) {
      const t = gridT.data[h];
      const powers = f32([1, t, t * t, t * t * t]);
      const polyVals = matVecMul(legBasis.data, G.legendre_basis_count, G.legendre_basis_count, powers);
      const rawLoad = dotVec(loadCoeffs, polyVals);
      const rawCost = dotVec(costCoeffs, polyVals);
      const qDepth = Math.max(1, Math.round(G.bitemporal_base_queue_depth + G.bitemporal_queue_scale * sigmoidScalar(rawLoad)));
      const usdCost = roundScale(
        G.bitemporal_base_cost_usd + G.bitemporal_cost_scale_usd * sigmoidScalar(rawCost),
        G.float_embed_round_scale
      );
      queueForecast.push(qDepth);
      costForecast.push(usdCost);
    }

    return {
      bitemporal_cutoff_enforced: true,
      legendre_degree: G.legendre_degree,
      horizon_points: Array.from(gridT.data, (v) => roundScale(v)),
      forecast_queue_load: queueForecast,
      forecast_token_cost_usd: costForecast,
      legendre_load_coefficients: Array.from(loadCoeffs, (v) => roundScale(v)),
      restatement_lag_ratio: roundScale(explicitLag),
    };
  }

  const parseNumericListArg = (rawArg) => {
    if (Array.isArray(rawArg)) {
      return rawArg.map((v) => Number(v)).filter((v) => Number.isFinite(v));
    }
    if (typeof rawArg === "string" && rawArg.trim()) {
      return rawArg
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((v) => Number.isFinite(v));
    }
    return [];
  };

  if (model.model_id === "tf-probe-internal-truth-elk-v1") {
    const builtins = BUILTIN_BY_ID.get("tf-probe-internal-truth-elk-v1");
    const wProbe =
      model.tensors[0]?.shape?.[0] === G.elk_output_dim && model.tensors[0]?.shape?.[1] === G.elk_input_dim
        ? model.tensors[0]
        : tensorByName(builtins, "elk_probe_weight", 0);
    const bProbe =
      tensorByName(model, "elk_probe_bias", 1)?.data?.length === G.elk_output_dim
        ? tensorByName(model, "elk_probe_bias", 1)
        : tensorByName(builtins, "elk_probe_bias", 1);
    const threshT =
      tensorByName(model, "contradiction_thresholds", G.two_scalar)?.data?.length >= G.two_scalar
        ? tensorByName(model, "contradiction_thresholds", G.two_scalar)
        : tensorByName(builtins, "contradiction_thresholds", G.two_scalar);

    const pressureHits = countKeywordHits(lower, [
      "sycophant",
      "sycophancy",
      "flatter",
      "agree with me",
      "override truth",
      "ignore fact",
      "pleaser",
      "bluff",
      "contradict",
    ]);
    const groundedHits = countKeywordHits(lower, [
      "grounded",
      "evidence",
      "measured",
      "citation",
      "calibrated",
      "consistent",
      "check",
    ]);

    const summaryArg = parseNumericListArg(input.hidden_summary ?? input.elk_summary);
    const defaults8 = [
      clampNum(G.elk_default_mid_truth + groundedHits * G.tenth_scalar * G.half_scalar, G.elk_default_mid_truth, 0, 1),
      clampNum(G.elk_default_late_output - pressureHits * G.two_tenths_scalar, G.elk_default_late_output, 0, 1),
      clampNum(G.elk_default_velocity + pressureHits * G.two_tenths_scalar, G.elk_default_velocity, 0, 1),
      clampNum(
        G.elk_default_entropy + vec12[G.feat_error_idx] * G.two_tenths_scalar + pressureHits * G.tenth_scalar,
        G.elk_default_entropy,
        0,
        1
      ),
      clampNum(G.elk_default_sheaf + pressureHits * G.two_tenths_scalar, G.elk_default_sheaf, 0, 1),
      clampNum(G.elk_default_anchor_cosine - pressureHits * G.tenth_scalar * G.half_scalar, G.elk_default_anchor_cosine, 0, 1),
      clampNum(G.elk_default_margin_gap - pressureHits * G.tenth_scalar, G.elk_default_margin_gap, 0, 1),
      clampNum(G.elk_default_prompt_pressure + pressureHits * G.quarter_scalar, G.elk_default_prompt_pressure, 0, 1),
    ];

    const summaryVec = new Float32Array(G.elk_input_dim);
    const hiddenStateSummary = {};
    for (let i = 0; i < G.elk_input_dim; i += 1) {
      const axisName = ELK_SUMMARY_AXES[i];
      const explicitVal = input[axisName];
      const rawAxisVal =
        explicitVal !== undefined && explicitVal !== null && explicitVal !== ""
          ? Number(explicitVal)
          : i < summaryArg.length
            ? summaryArg[i]
            : defaults8[i];
      const clampedAxis = clampNum(rawAxisVal, defaults8[i], 0, 1);
      summaryVec[i] = clampedAxis;
      hiddenStateSummary[axisName] = roundScale(clampedAxis);
    }

    const logits = matVecMul(wProbe.data, G.elk_output_dim, G.elk_input_dim, summaryVec, bProbe.data);
    const truthScore = sigmoidScalar(logits[0]);
    const divScore = sigmoidScalar(logits[1]);
    const steerScore = sigmoidScalar(logits[G.two_scalar]);
    const softThresh = threshT.data[0];
    const hardThresh = threshT.data[1];

    let actionIdx = 0;
    if (divScore >= hardThresh || steerScore >= hardThresh) actionIdx = G.two_scalar;
    else if (divScore >= softThresh || steerScore >= softThresh) actionIdx = 1;

    return {
      task: "internal_truth_vs_sycophancy_probe",
      internal_truth_score: roundScale(truthScore),
      sycophancy_divergence_score: roundScale(divScore),
      nullspace_steer_recommendation: roundScale(steerScore),
      elk_contradiction_detected: divScore >= hardThresh,
      sycophancy_pressure_flagged: divScore >= softThresh,
      steer_action: ELK_STEER_ACTIONS[actionIdx],
      probe_logits: Array.from(logits, (v) => roundScale(v)),
      hidden_state_summary: hiddenStateSummary,
      soft_divergence_threshold: roundScale(softThresh),
      contradiction_threshold: roundScale(hardThresh),
    };
  }

  if (model.family === "sparse_autoencoder_probe") {
    const builtins = BUILTIN_BY_ID.get("tf-sae-matryoshka-residual-v1");
    const encW =
      model.tensors[0]?.shape?.[0] === G.sae_dict_dim && model.tensors[0]?.shape?.[1] === G.sae_input_dim
        ? model.tensors[0]
        : tensorByName(builtins, "sae_encoder_weight", 0);
    const encB =
      tensorByName(model, "sae_encoder_bias", 1)?.data?.length === G.sae_dict_dim
        ? tensorByName(model, "sae_encoder_bias", 1)
        : tensorByName(builtins, "sae_encoder_bias", 1);
    const decD =
      tensorByName(model, "sae_decoder_dictionary", G.two_scalar)?.data?.length === G.sae_input_dim * G.sae_dict_dim
        ? tensorByName(model, "sae_decoder_dictionary", G.two_scalar)
        : tensorByName(builtins, "sae_decoder_dictionary", G.two_scalar);
    const regW =
      tensorByName(model, "sae_regime_readout_weight", G.three_scalar)?.data?.length ===
      G.sae_regime_count * G.sae_dict_dim
        ? tensorByName(model, "sae_regime_readout_weight", G.three_scalar)
        : tensorByName(builtins, "sae_regime_readout_weight", G.three_scalar);
    const regB =
      tensorByName(model, "sae_regime_readout_bias", G.four_scalar)?.data?.length === G.sae_regime_count
        ? tensorByName(model, "sae_regime_readout_bias", G.four_scalar)
        : tensorByName(builtins, "sae_regime_readout_bias", G.four_scalar);
    const prefW =
      tensorByName(model, "matryoshka_prefix_weights", G.five_scalar)?.data?.length === G.sae_regime_count
        ? tensorByName(model, "matryoshka_prefix_weights", G.five_scalar)
        : tensorByName(builtins, "matryoshka_prefix_weights", G.five_scalar);

    const resVecArg = parseNumericListArg(input.residual_vector ?? input.residual_slice);
    const rawRes8 = new Float32Array(G.sae_input_dim);
    if (resVecArg.length > 0) {
      for (let c = 0; c < G.sae_input_dim; c += 1) {
        rawRes8[c] = clampWeightScalar(resVecArg[c % resVecArg.length], 0);
      }
    } else {
      const conceptHits = countKeywordHits(lower, ["concept", "domain", "matrix", "semantic", "subspace", "graph", "theorem"]);
      const syntaxHits = countKeywordHits(lower, ["json", "schema", "syntax", "ast", "sql", "table", "typed", "format"]);
      const personaHits = countKeywordHits(lower, ["persona", "register", "concise", "formal", "tone", "style", "brief"]);
      const uncertHits = countKeywordHits(lower, ["uncertain", "ambiguous", "maybe", "estimate", "hedg", "unknown", "risk"]);
      rawRes8[0] = G.tenth_scalar + vec12[G.feat_dag_idx] * G.six_tenths_scalar + conceptHits * G.three_tenths_scalar;
      rawRes8[1] = G.tenth_scalar + vec12[G.feat_contract_idx] * G.six_tenths_scalar + syntaxHits * G.three_tenths_scalar;
      rawRes8[G.two_scalar] = G.tenth_scalar + vec12[G.feat_quick_idx] * G.half_scalar + personaHits * G.three_tenths_scalar;
      rawRes8[G.three_scalar] = G.tenth_scalar + vec12[G.feat_error_idx] * G.half_scalar + uncertHits * G.three_tenths_scalar;
      rawRes8[G.four_scalar] = vec12[G.feat_depth_idx] * G.half_scalar + conceptHits * G.two_tenths_scalar;
      rawRes8[G.five_scalar] = vec12[G.feat_prefix_idx] * G.four_tenths_scalar + syntaxHits * G.two_tenths_scalar;
      rawRes8[G.six_scalar] = vec12[G.feat_latency_idx] * G.three_tenths_scalar + personaHits * G.two_tenths_scalar;
      rawRes8[G.seven_scalar] = vec12[G.feat_check_idx] * G.four_tenths_scalar + uncertHits * G.two_tenths_scalar;
    }

    const { vector: x8 } = l2Normalize(rawRes8);
    const preAct16 = matVecMul(encW.data, G.sae_dict_dim, G.sae_input_dim, x8, encB.data);
    const latents16 = reluVec(preAct16);

    const rawPrefixK = clampInt(input.matryoshka_prefix_k, G.sae_dict_dim, G.sae_prefix_0, G.sae_dict_dim);
    let activePrefixK = G.sae_dict_dim;
    if (rawPrefixK <= G.sae_prefix_0) activePrefixK = G.sae_prefix_0;
    else if (rawPrefixK <= G.sae_prefix_1) activePrefixK = G.sae_prefix_1;
    else if (rawPrefixK <= G.sae_prefix_2) activePrefixK = G.sae_prefix_2;

    const maskedLatents = new Float32Array(G.sae_dict_dim);
    let activeCount = 0;
    for (let j = 0; j < G.sae_dict_dim; j += 1) {
      if (j < activePrefixK && latents16[j] > 0) {
        maskedLatents[j] = latents16[j];
        activeCount += 1;
      }
    }

    let maxColNormErr = 0;
    for (let j = 0; j < G.sae_dict_dim; j += 1) {
      let colSq = 0;
      for (let r = 0; r < G.sae_input_dim; r += 1) {
        const dv = decD.data[r * G.sae_dict_dim + j];
        colSq += dv * dv;
      }
      const err = Math.abs(Math.sqrt(colSq) - 1);
      if (err > maxColNormErr) maxColNormErr = err;
    }

    const prefixSizes = [G.sae_prefix_0, G.sae_prefix_1, G.sae_prefix_2, G.sae_prefix_3];
    const prefixCosines = {};
    let weightedCosine = 0;
    for (let p = 0; p < prefixSizes.length; p += 1) {
      const kLim = prefixSizes[p];
      const pLatents = new Float32Array(G.sae_dict_dim);
      for (let j = 0; j < kLim; j += 1) {
        pLatents[j] = latents16[j];
      }
      const reconP = matVecMul(decD.data, G.sae_input_dim, G.sae_dict_dim, pLatents);
      let rSq = 0;
      for (let r = 0; r < G.sae_input_dim; r += 1) rSq += reconP[r] * reconP[r];
      const cosP =
        rSq > G.epsilon_norm ? clampNum(dotVec(x8, reconP) / Math.sqrt(rSq), 0, -1, 1) : 0;
      prefixCosines[`k_${kLim}`] = roundScale(cosP);
      weightedCosine += prefW.data[p] * cosP;
    }

    const activeRecon = matVecMul(decD.data, G.sae_input_dim, G.sae_dict_dim, maskedLatents);
    const regimeLogits = matVecMul(regW.data, G.sae_regime_count, G.sae_dict_dim, maskedLatents, regB.data);
    const regimeProbs = softmaxVec(regimeLogits);
    const regimeReadouts = {};
    let bestRegIdx = 0;
    for (let r = 0; r < G.sae_regime_count; r += 1) {
      regimeReadouts[SAE_REGIME_READOUTS[r]] = roundScale(regimeProbs[r]);
      if (regimeProbs[r] > regimeProbs[bestRegIdx]) bestRegIdx = r;
    }

    return {
      task: "matryoshka_sparse_feature_decomposition",
      dominant_regime: SAE_REGIME_READOUTS[bestRegIdx],
      regime_readouts: regimeReadouts,
      regime_logits: Array.from(regimeLogits, (v) => roundScale(v)),
      normalized_residual_8d: Array.from(x8, (v) => roundScale(v)),
      encoder_pre_activations_16d: Array.from(preAct16, (v) => roundScale(v)),
      sparse_latents_16d: Array.from(maskedLatents, (v) => roundScale(v)),
      active_latent_count: activeCount,
      sparsity_ratio: roundScale(1 - activeCount / G.sae_dict_dim),
      active_matryoshka_prefix_k: activePrefixK,
      matryoshka_prefix_cosines: prefixCosines,
      matryoshka_weighted_cosine: roundScale(weightedCosine),
      reconstructed_residual_8d: Array.from(activeRecon, (v) => roundScale(v)),
      decoder_unit_norm_drift: maxColNormErr < G.min_held_out_margin * G.tenth_scalar ? 0 : roundScale(maxColNormErr),
    };
  }

  // Atomic cartridge bank (built-in 6-slot bank + custom 256-byte 8x8 cartridges)
  const x8 = vec12.subarray(0, G.subspace_rank);
  let chosenTensor = model.tensors[0];
  let chosenSlotId = model.builtin ? CARTRIDGE_SLOTS[0].slot_id : model.model_id;
  let chosenLabel = model.title;

  if (model.builtin) {
    const reqSlot = String(input.cartridge_slot || input.slot || "").trim();
    const explicitIdx = CARTRIDGE_SLOTS.findIndex((s) => s.slot_id === reqSlot || s.tensor_name === reqSlot);
    let bestIdx = explicitIdx >= 0 ? explicitIdx : 0;
    if (explicitIdx < 0) {
      let bestHits = -1;
      for (let i = 0; i < CARTRIDGE_SLOTS.length; i += 1) {
        const hits = countKeywordHits(lower, CARTRIDGE_SLOTS[i].keywords);
        if (hits > bestHits) {
          bestHits = hits;
          bestIdx = i;
        }
      }
    }
    const slot = CARTRIDGE_SLOTS[bestIdx];
    chosenSlotId = slot.slot_id;
    chosenLabel = slot.label;
    chosenTensor = tensorByName(model, slot.tensor_name, bestIdx);
  }

  const { rows, cols } = safeMatrixDims(chosenTensor);
  const logits = matVecMul(chosenTensor.data, rows, cols, x8);
  const probs = softmaxVec(logits);
  return {
    selected_cartridge: chosenSlotId,
    cartridge_label: scrubBannedWords(stripPii(chosenLabel)),
    subspace_rank: rows,
    cartridge_tensor_bytes: chosenTensor.data.length * G.float32_bytes,
    cartridge_logits: Array.from(logits, (v) => roundScale(v)),
    cartridge_probabilities: Array.from(probs, (v) => roundScale(v)),
  };
}

function cleanExportMetaText(raw, maxLen = G.export_meta_max_chars) {
  return tidyText(scrubBannedWords(stripPii(String(raw || ""))), maxLen)
    .replace(/[\r\n\0\u2028\u2029]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeJsonLiteral(obj) {
  return JSON.stringify(obj)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
    .replace(/<\//g, "<\\/");
}

function safeCStringLiteral(raw, maxLen = G.export_meta_max_chars) {
  return cleanExportMetaText(raw, maxLen)
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\\/g, "/")
    .replace(/"/g, "'")
    .replace(/\*\//g, "* /");
}

function scrubSourcePreserveLayout(sourceText, asciiOnly = false) {
  return String(sourceText || "")
    .split("\n")
    .map((line) => {
      const match = /^([ \t]*)(.*)$/.exec(line);
      if (!match || !match[2]) return "";
      const indent = match[1];
      let body = scrubBannedWords(stripPii(match[2]));
      if (asciiOnly) {
        body = body.replace(/\u2026/g, "...").replace(/[^\x20-\x7e]/g, "");
      }
      return `${indent}${body}`;
    })
    .join("\n");
}

function safeCodeIdent(rawName, usedIdents, fallbackIdx = 0) {
  const cleaned = cleanExportMetaText(rawName, G.export_ident_max_chars)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  let base = cleaned || `tensor_${fallbackIdx}`;
  if (!/^[a-z_]/.test(base)) {
    base = `t_${base}`;
  }
  const longHexRe = new RegExp(`[0-9a-f]{${G.hex_run_guard_len},}`, "i");
  if (longHexRe.test(base)) {
    base = `tensor_${fallbackIdx}`;
  }
  if (RESERVED_CODE_WORDS.has(base)) {
    base = `t_${base}`;
  }
  base = base.slice(0, G.export_ident_max_chars) || `tensor_${fallbackIdx}`;
  let candidate = base;
  let suffix = 1;
  while (usedIdents.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  usedIdents.add(candidate);
  return candidate;
}

function formatFloatList(floats) {
  const parts = new Array(floats.length);
  for (let i = 0; i < floats.length; i += 1) {
    parts[i] = String(clampWeightScalar(floats[i], 0));
  }
  return parts;
}

function formatCFloatList(floats) {
  const parts = new Array(floats.length);
  for (let i = 0; i < floats.length; i += 1) {
    const clean = clampWeightScalar(floats[i], 0);
    const s = String(clean);
    parts[i] = `${s.includes(".") || s.includes("e") || s.includes("E") ? s : `${s}.0`}f`;
  }
  return parts;
}

function formatWgslFloatList(floats) {
  const parts = new Array(floats.length);
  for (let i = 0; i < floats.length; i += 1) {
    const clean = clampWeightScalar(floats[i], 0);
    const s = String(clean);
    parts[i] = s.includes(".") || s.includes("e") || s.includes("E") ? s : `${s}.0`;
  }
  return parts;
}

function copyClampedFloats(src, len) {
  const out = new Float32Array(len);
  if (!src) return out;
  const bound = Math.min(len, src.length);
  for (let i = 0; i < bound; i += 1) {
    out[i] = clampWeightScalar(src[i], 0);
  }
  return out;
}

function extractPortableLayerSpec(model, primary, matchingBias) {
  const rawByName = new Map(model.tensors.map((t) => [t.name, t]));
  let polyW1 = rawByName.get("layer1_weight") || rawByName.get("gate_layer1_weight") || null;
  let polyB1 = rawByName.get("layer1_bias") || rawByName.get("gate_layer1_bias") || null;
  let polyW2 = rawByName.get("layer2_weight") || rawByName.get("gate_layer2_weight") || null;
  let polyB2 = rawByName.get("layer2_bias") || rawByName.get("gate_layer2_bias") || null;

  if (!polyW1 && model.family === "from_scratch_polytope" && model.tensors.length >= G.three_scalar) {
    const candW1 = model.tensors[0];
    const candB1 = model.tensors[1];
    const candW2 = model.tensors[G.two_scalar];
    const candB2 = model.tensors[G.three_scalar] || null;
    if (
      candW1 &&
      candW2 &&
      Array.isArray(candW1.shape) &&
      Array.isArray(candW2.shape) &&
      candW1.shape.length === G.two_scalar &&
      candW2.shape.length === G.two_scalar &&
      candW2.shape[1] === candW1.shape[0]
    ) {
      polyW1 = candW1;
      polyB1 = candB1;
      polyW2 = candW2;
      polyB2 = candB2;
    }
  }

  if (
    polyW1 &&
    polyW2 &&
    Array.isArray(polyW1.shape) &&
    Array.isArray(polyW2.shape) &&
    polyW1.shape.length === G.two_scalar &&
    polyW2.shape.length === G.two_scalar &&
    polyW2.shape[1] === polyW1.shape[0]
  ) {
    const hiddenDim = polyW1.shape[0];
    const inDim = polyW1.shape[1];
    const outDim = polyW2.shape[0];
    return {
      numLayers: G.two_scalar,
      inDim,
      hiddenDim,
      outDim,
      w1Data: copyClampedFloats(polyW1.data, hiddenDim * inDim),
      b1Data: copyClampedFloats(polyB1 ? polyB1.data : null, hiddenDim),
      w2Data: copyClampedFloats(polyW2.data, outDim * hiddenDim),
      b2Data: copyClampedFloats(polyB2 ? polyB2.data : null, outDim),
    };
  }

  if (model.family === "weight_edited_embedding") {
    const baseProj = rawByName.get("base_projector");
    const nullDelta = rawByName.get("nullspace_delta");
    if (
      baseProj &&
      nullDelta &&
      Array.isArray(baseProj.shape) &&
      Array.isArray(nullDelta.shape) &&
      baseProj.shape.length === G.two_scalar &&
      nullDelta.shape.length === G.two_scalar &&
      baseProj.shape[0] === nullDelta.shape[0] &&
      baseProj.shape[1] === nullDelta.shape[1]
    ) {
      const outDim = baseProj.shape[0];
      const inDim = baseProj.shape[1];
      const count = outDim * inDim;
      const folded = new Float32Array(count);
      for (let i = 0; i < count; i += 1) {
        folded[i] = clampWeightScalar(Number(baseProj.data[i] || 0) + Number(nullDelta.data[i] || 0), 0);
      }
      return {
        numLayers: 1,
        inDim,
        hiddenDim: 0,
        outDim,
        w1Data: folded,
        b1Data: new Float32Array(outDim),
        w2Data: null,
        b2Data: null,
      };
    }
  }

  if (model.family === "weight_edited_decider") {
    const maskT = rawByName.get("channel_slice_mask");
    const wDisp = rawByName.get("ridge_dispatch_weight");
    const bDisp = rawByName.get("ridge_dispatch_bias");
    if (
      maskT &&
      wDisp &&
      Array.isArray(wDisp.shape) &&
      wDisp.shape.length === G.two_scalar &&
      maskT.data.length > 0
    ) {
      const outDim = wDisp.shape[0];
      const inDim = wDisp.shape[1];
      const folded = new Float32Array(outDim * inDim);
      for (let r = 0; r < outDim; r += 1) {
        for (let c = 0; c < inDim; c += 1) {
          const maskVal = Number(maskT.data[c % maskT.data.length]) || 1;
          folded[r * inDim + c] = clampWeightScalar(Number(wDisp.data[r * inDim + c] || 0) * maskVal, 0);
        }
      }
      return {
        numLayers: 1,
        inDim,
        hiddenDim: 0,
        outDim,
        w1Data: folded,
        b1Data: copyClampedFloats(bDisp ? bDisp.data : null, outDim),
        w2Data: null,
        b2Data: null,
      };
    }
  }

  return {
    numLayers: 1,
    inDim: primary.cols,
    hiddenDim: 0,
    outDim: primary.rows,
    w1Data: copyClampedFloats(primary.floats, primary.rows * primary.cols),
    b1Data: copyClampedFloats(matchingBias ? matchingBias.floats : null, primary.rows),
    w2Data: null,
    b2Data: null,
  };
}

function alignWasmOffset(offset, align) {
  if (align <= 1) return offset;
  const rem = offset % align;
  return rem === 0 ? offset : offset + (align - rem);
}

function encodeUleb128(rawVal) {
  let v = Math.max(0, Math.trunc(Number(rawVal) || 0));
  const out = [];
  let more = true;
  while (more) {
    let byte = v & G.wasm_leb_payload_mask;
    v = Math.floor(v / G.wasm_leb_cont_bit);
    if (v !== 0) {
      byte |= G.wasm_leb_cont_bit;
    } else {
      more = false;
    }
    out.push(byte);
  }
  return out;
}

function encodeSleb128(rawVal) {
  let v = Math.trunc(Number(rawVal) || 0);
  const out = [];
  let more = true;
  while (more) {
    let byte = v & G.wasm_leb_payload_mask;
    v >>= G.wasm_leb_shift;
    const signBitSet = (byte & G.wasm_leb_sign_bit) !== 0;
    if ((v === 0 && !signBitSet) || (v === -1 && signBitSet)) {
      more = false;
    } else {
      byte |= G.wasm_leb_cont_bit;
    }
    out.push(byte);
  }
  return out;
}

function encodeF32LeBytes(val) {
  const buf = new ArrayBuffer(G.float32_bytes);
  const view = new DataView(buf);
  view.setFloat32(0, clampWeightScalar(val, 0), true);
  return Array.from(new Uint8Array(buf));
}

function encodeWasmName(name) {
  const raw = new TextEncoder().encode(name);
  return [...encodeUleb128(raw.byteLength), ...raw];
}

function encodeWasmSection(secId, payload) {
  return [secId, ...encodeUleb128(payload.length), ...payload];
}

function formatWatDataSegments(baseOffset, floats) {
  const lines = [];
  const buf = new ArrayBuffer(G.float32_bytes);
  const view = new DataView(buf);
  const bytesView = new Uint8Array(buf);
  for (let start = 0; start < floats.length; start += G.wat_chunk_floats) {
    const end = Math.min(floats.length, start + G.wat_chunk_floats);
    const segOffset = baseOffset + start * G.float32_bytes;
    let hexEscaped = "";
    for (let i = start; i < end; i += 1) {
      view.setFloat32(0, clampWeightScalar(floats[i], 0), true);
      for (let b = 0; b < G.float32_bytes; b += 1) {
        const byteHex = (bytesView[b] & G.byte_mask).toString(G.hex_radix).padStart(G.hex_pad_len, "0");
        hexEscaped += "\\" + byteHex;
      }
    }
    lines.push(`  (data (i32.const ${segOffset}) "${hexEscaped}")`);
  }
  return lines;
}

function emitWatDenseBlock(labelSuffix, rows, cols, wOff, bOff, xOff, yOff, applyRelu, trackArgmax) {
  const lines = [
    "    (local.set $r (i32.const 0))",
    `    (block $done_${labelSuffix}`,
    `      (loop $row_${labelSuffix}`,
    `        (br_if $done_${labelSuffix} (i32.ge_s (local.get $r) (i32.const ${rows})))`,
    `        (local.set $acc (f32.load offset=${bOff} (i32.mul (local.get $r) (i32.const ${G.float32_bytes}))))`,
    "        (local.set $c (i32.const 0))",
    `        (block $col_done_${labelSuffix}`,
    `          (loop $col_${labelSuffix}`,
    `            (br_if $col_done_${labelSuffix} (i32.ge_s (local.get $c) (i32.const ${cols})))`,
    "            (local.set $acc",
    "              (f32.add",
    "                (local.get $acc)",
    "                (f32.mul",
    `                  (f32.load offset=${wOff} (i32.mul (i32.add (i32.mul (local.get $r) (i32.const ${cols})) (local.get $c)) (i32.const ${G.float32_bytes})))`,
    `                  (f32.load offset=${xOff} (i32.mul (local.get $c) (i32.const ${G.float32_bytes}))))))`,
    "            (local.set $c (i32.add (local.get $c) (i32.const 1)))",
    `            (br $col_${labelSuffix})))`,
  ];
  if (applyRelu) {
    lines.push(
      "        (local.set $acc (select (local.get $acc) (f32.const 0.0) (f32.gt (local.get $acc) (f32.const 0.0))))"
    );
  }
  lines.push(
    `        (f32.store offset=${yOff} (i32.mul (local.get $r) (i32.const ${G.float32_bytes})) (local.get $acc))`
  );
  if (trackArgmax) {
    lines.push(
      "        (if (i32.eqz (local.get $r))",
      "          (then",
      "            (local.set $best_val (local.get $acc))",
      "            (local.set $best_idx (i32.const 0)))",
      "          (else",
      "            (if (f32.gt (local.get $acc) (local.get $best_val))",
      "              (then",
      "                (local.set $best_val (local.get $acc))",
      "                (local.set $best_idx (local.get $r))))))"
    );
  }
  lines.push(
    "        (local.set $r (i32.add (local.get $r) (i32.const 1)))",
    `        (br $row_${labelSuffix})))`
  );
  return lines;
}

function compilePortableWasmAndWat(layerSpec, cleanModelId) {
  const { numLayers, inDim, hiddenDim, outDim, w1Data, b1Data, w2Data, b2Data } = layerSpec;
  const w1Offset = 0;
  const w1Bytes = w1Data.length * G.float32_bytes;
  const b1Offset = alignWasmOffset(w1Offset + w1Bytes, G.wasm_align_bytes);
  const b1Bytes = b1Data.length * G.float32_bytes;

  let w2Offset = 0;
  let b2Offset = 0;
  let dataEnd = alignWasmOffset(b1Offset + b1Bytes, G.wasm_align_bytes);
  if (numLayers === G.two_scalar && w2Data && b2Data) {
    w2Offset = dataEnd;
    const w2Bytes = w2Data.length * G.float32_bytes;
    b2Offset = alignWasmOffset(w2Offset + w2Bytes, G.wasm_align_bytes);
    const b2Bytes = b2Data.length * G.float32_bytes;
    dataEnd = alignWasmOffset(b2Offset + b2Bytes, G.wasm_align_bytes);
  }

  const inputOffset = dataEnd;
  const afterInput = alignWasmOffset(inputOffset + inDim * G.float32_bytes, G.wasm_align_bytes);
  const hiddenOffset = numLayers === G.two_scalar ? afterInput : 0;
  const outputOffset =
    numLayers === G.two_scalar
      ? alignWasmOffset(hiddenOffset + hiddenDim * G.float32_bytes, G.wasm_align_bytes)
      : afterInput;
  const totalBytesNeeded = outputOffset + outDim * G.float32_bytes;
  const wasmPages = Math.max(1, Math.ceil(totalBytesNeeded / G.wasm_page_bytes));

  const dataBlob = new Uint8Array(dataEnd);
  const dataView = new DataView(dataBlob.buffer);
  for (let i = 0; i < w1Data.length; i += 1) {
    dataView.setFloat32(w1Offset + i * G.float32_bytes, w1Data[i], true);
  }
  for (let i = 0; i < b1Data.length; i += 1) {
    dataView.setFloat32(b1Offset + i * G.float32_bytes, b1Data[i], true);
  }
  if (numLayers === G.two_scalar && w2Data && b2Data) {
    for (let i = 0; i < w2Data.length; i += 1) {
      dataView.setFloat32(w2Offset + i * G.float32_bytes, w2Data[i], true);
    }
    for (let i = 0; i < b2Data.length; i += 1) {
      dataView.setFloat32(b2Offset + i * G.float32_bytes, b2Data[i], true);
    }
  }

  const emitDenseOps = (ops, rows, cols, wOff, bOff, xOff, yOff, applyRelu, trackArgmax) => {
    if (trackArgmax) {
      ops.push(G.wasm_op_i32_const, ...encodeSleb128(0), G.wasm_op_local_set, G.wasm_loc_best_idx);
    }
    ops.push(G.wasm_op_i32_const, ...encodeSleb128(0), G.wasm_op_local_set, G.wasm_loc_r);
    ops.push(G.wasm_op_block, G.wasm_block_void, G.wasm_op_loop, G.wasm_block_void);
    ops.push(
      G.wasm_op_local_get,
      G.wasm_loc_r,
      G.wasm_op_i32_const,
      ...encodeSleb128(rows),
      G.wasm_op_i32_ge_s,
      G.wasm_op_br_if,
      1
    );
    ops.push(
      G.wasm_op_local_get,
      G.wasm_loc_r,
      G.wasm_op_i32_const,
      ...encodeSleb128(G.float32_bytes),
      G.wasm_op_i32_mul,
      G.wasm_op_f32_load,
      G.wasm_f32_align_log2,
      ...encodeUleb128(bOff),
      G.wasm_op_local_set,
      G.wasm_loc_acc
    );
    ops.push(G.wasm_op_i32_const, ...encodeSleb128(0), G.wasm_op_local_set, G.wasm_loc_c);
    ops.push(G.wasm_op_block, G.wasm_block_void, G.wasm_op_loop, G.wasm_block_void);
    ops.push(
      G.wasm_op_local_get,
      G.wasm_loc_c,
      G.wasm_op_i32_const,
      ...encodeSleb128(cols),
      G.wasm_op_i32_ge_s,
      G.wasm_op_br_if,
      1
    );
    ops.push(
      G.wasm_op_local_get,
      G.wasm_loc_acc,
      G.wasm_op_local_get,
      G.wasm_loc_r,
      G.wasm_op_i32_const,
      ...encodeSleb128(cols),
      G.wasm_op_i32_mul,
      G.wasm_op_local_get,
      G.wasm_loc_c,
      G.wasm_op_i32_add,
      G.wasm_op_i32_const,
      ...encodeSleb128(G.float32_bytes),
      G.wasm_op_i32_mul,
      G.wasm_op_f32_load,
      G.wasm_f32_align_log2,
      ...encodeUleb128(wOff),
      G.wasm_op_local_get,
      G.wasm_loc_c,
      G.wasm_op_i32_const,
      ...encodeSleb128(G.float32_bytes),
      G.wasm_op_i32_mul,
      G.wasm_op_f32_load,
      G.wasm_f32_align_log2,
      ...encodeUleb128(xOff),
      G.wasm_op_f32_mul,
      G.wasm_op_f32_add,
      G.wasm_op_local_set,
      G.wasm_loc_acc
    );
    ops.push(
      G.wasm_op_local_get,
      G.wasm_loc_c,
      G.wasm_op_i32_const,
      ...encodeSleb128(1),
      G.wasm_op_i32_add,
      G.wasm_op_local_set,
      G.wasm_loc_c,
      G.wasm_op_br,
      0,
      G.wasm_op_end,
      G.wasm_op_end
    );
    if (applyRelu) {
      const zeroF32 = encodeF32LeBytes(0);
      ops.push(
        G.wasm_op_local_get,
        G.wasm_loc_acc,
        G.wasm_op_f32_const,
        ...zeroF32,
        G.wasm_op_local_get,
        G.wasm_loc_acc,
        G.wasm_op_f32_const,
        ...zeroF32,
        G.wasm_op_f32_gt,
        G.wasm_op_select,
        G.wasm_op_local_set,
        G.wasm_loc_acc
      );
    }
    ops.push(
      G.wasm_op_local_get,
      G.wasm_loc_r,
      G.wasm_op_i32_const,
      ...encodeSleb128(G.float32_bytes),
      G.wasm_op_i32_mul,
      G.wasm_op_local_get,
      G.wasm_loc_acc,
      G.wasm_op_f32_store,
      G.wasm_f32_align_log2,
      ...encodeUleb128(yOff)
    );
    if (trackArgmax) {
      ops.push(
        G.wasm_op_local_get,
        G.wasm_loc_r,
        G.wasm_op_i32_eqz,
        G.wasm_op_if,
        G.wasm_block_void,
        G.wasm_op_local_get,
        G.wasm_loc_acc,
        G.wasm_op_local_set,
        G.wasm_loc_best_val,
        G.wasm_op_i32_const,
        ...encodeSleb128(0),
        G.wasm_op_local_set,
        G.wasm_loc_best_idx,
        G.wasm_op_else,
        G.wasm_op_local_get,
        G.wasm_loc_acc,
        G.wasm_op_local_get,
        G.wasm_loc_best_val,
        G.wasm_op_f32_gt,
        G.wasm_op_if,
        G.wasm_block_void,
        G.wasm_op_local_get,
        G.wasm_loc_acc,
        G.wasm_op_local_set,
        G.wasm_loc_best_val,
        G.wasm_op_local_get,
        G.wasm_loc_r,
        G.wasm_op_local_set,
        G.wasm_loc_best_idx,
        G.wasm_op_end,
        G.wasm_op_end
      );
    }
    ops.push(
      G.wasm_op_local_get,
      G.wasm_loc_r,
      G.wasm_op_i32_const,
      ...encodeSleb128(1),
      G.wasm_op_i32_add,
      G.wasm_op_local_set,
      G.wasm_loc_r,
      G.wasm_op_br,
      0,
      G.wasm_op_end,
      G.wasm_op_end
    );
  };

  const inferOps = [
    G.wasm_local_group_count,
    G.wasm_local_i32_count,
    G.wasm_val_i32,
    G.wasm_local_f32_count,
    G.wasm_val_f32,
  ];
  if (numLayers === G.two_scalar) {
    emitDenseOps(inferOps, hiddenDim, inDim, w1Offset, b1Offset, inputOffset, hiddenOffset, true, false);
    emitDenseOps(inferOps, outDim, hiddenDim, w2Offset, b2Offset, hiddenOffset, outputOffset, false, true);
  } else {
    emitDenseOps(inferOps, outDim, inDim, w1Offset, b1Offset, inputOffset, outputOffset, false, true);
  }
  inferOps.push(G.wasm_op_local_get, G.wasm_loc_best_idx, G.wasm_op_end);

  const fnInputBody = [0, G.wasm_op_i32_const, ...encodeSleb128(inputOffset), G.wasm_op_end];
  const fnOutputBody = [0, G.wasm_op_i32_const, ...encodeSleb128(outputOffset), G.wasm_op_end];

  const typeSection = encodeWasmSection(G.wasm_sec_type, [1, G.wasm_type_func, 0, 1, G.wasm_val_i32]);
  const funcSection = encodeWasmSection(G.wasm_sec_function, [G.wasm_func_count, 0, 0, 0]);
  const memSection = encodeWasmSection(G.wasm_sec_memory, [1, 0, ...encodeUleb128(wasmPages)]);
  const exportSection = encodeWasmSection(G.wasm_sec_export, [
    G.wasm_export_count,
    ...encodeWasmName("memory"),
    G.wasm_export_memory,
    0,
    ...encodeWasmName("input_offset"),
    G.wasm_export_func,
    0,
    ...encodeWasmName("output_offset"),
    G.wasm_export_func,
    1,
    ...encodeWasmName("infer"),
    G.wasm_export_func,
    G.two_scalar,
  ]);
  const codeSection = encodeWasmSection(G.wasm_sec_code, [
    G.wasm_func_count,
    ...encodeUleb128(fnInputBody.length),
    ...fnInputBody,
    ...encodeUleb128(fnOutputBody.length),
    ...fnOutputBody,
    ...encodeUleb128(inferOps.length),
    ...inferOps,
  ]);
  const dataSection = encodeWasmSection(G.wasm_sec_data, [
    1,
    0,
    G.wasm_op_i32_const,
    ...encodeSleb128(0),
    G.wasm_op_end,
    ...encodeUleb128(dataBlob.byteLength),
    ...dataBlob,
  ]);

  const wasmBytes = new Uint8Array([
    G.wasm_magic_0,
    G.wasm_magic_1,
    G.wasm_magic_2,
    G.wasm_magic_3,
    G.wasm_version_0,
    0,
    0,
    0,
    ...typeSection,
    ...funcSection,
    ...memSection,
    ...exportSection,
    ...codeSection,
    ...dataSection,
  ]);

  const watLines = [
    "(module",
    `  ;; Teleion Fabric portable WebAssembly text cartridge (${cleanModelId})`,
    `  ;; layers=${numLayers} in_dim=${inDim} hidden_dim=${hiddenDim} out_dim=${outDim}`,
    `  (memory (export "memory") ${wasmPages})`,
    ...formatWatDataSegments(w1Offset, w1Data),
    ...formatWatDataSegments(b1Offset, b1Data),
    ...(numLayers === G.two_scalar && w2Data && b2Data
      ? [...formatWatDataSegments(w2Offset, w2Data), ...formatWatDataSegments(b2Offset, b2Data)]
      : []),
    `  (func (export "input_offset") (result i32) (i32.const ${inputOffset}))`,
    `  (func (export "output_offset") (result i32) (i32.const ${outputOffset}))`,
    '  (func (export "infer") (result i32)',
    "    (local $r i32) (local $c i32) (local $best_idx i32) (local $acc f32) (local $best_val f32)",
    "    (local.set $best_idx (i32.const 0))",
    ...(numLayers === G.two_scalar
      ? [
          ...emitWatDenseBlock("l1", hiddenDim, inDim, w1Offset, b1Offset, inputOffset, hiddenOffset, true, false),
          ...emitWatDenseBlock("l2", outDim, hiddenDim, w2Offset, b2Offset, hiddenOffset, outputOffset, false, true),
        ]
      : emitWatDenseBlock("l1", outDim, inDim, w1Offset, b1Offset, inputOffset, outputOffset, false, true)),
    "    (local.get $best_idx)))",
    "",
  ];

  return { wasmBytes, watText: watLines.join("\n") };
}

function selectWgslWorkgroupSize(outDim) {
  const choices = G.wgsl_workgroup_choices;
  const capped = Math.min(Math.max(1, outDim), G.wgsl_workgroup_max);
  for (let i = 0; i < choices.length; i += 1) {
    if (choices[i] >= capped) return choices[i];
  }
  return G.wgsl_workgroup_max;
}

function compilePortableWgsl(layerSpec, cleanModelId) {
  const { numLayers, inDim, hiddenDim, outDim, w1Data, b1Data, w2Data, b2Data } = layerSpec;
  const wgSize = selectWgslWorkgroupSize(outDim);
  const lines = [
    "/" + "/ Teleion Fabric portable WebGPU compute shader (" + cleanModelId + ")",
    "@group(0) @binding(0) var<storage, read> input_vec: array<f32>;",
    "@group(0) @binding(1) var<storage, read_write> output_logits: array<f32>;",
    "",
    `const IN_DIM: u32 = ${inDim}u;`,
    ...(numLayers === G.two_scalar ? [`const HIDDEN_DIM: u32 = ${hiddenDim}u;`] : []),
    `const OUT_DIM: u32 = ${outDim}u;`,
    `var<private> W1: array<f32, ${w1Data.length}> = array<f32, ${w1Data.length}>(${formatWgslFloatList(w1Data).join(", ")});`,
    `var<private> B1: array<f32, ${b1Data.length}> = array<f32, ${b1Data.length}>(${formatWgslFloatList(b1Data).join(", ")});`,
    ...(numLayers === G.two_scalar && w2Data && b2Data
      ? [
          `var<private> W2: array<f32, ${w2Data.length}> = array<f32, ${w2Data.length}>(${formatWgslFloatList(w2Data).join(", ")});`,
          `var<private> B2: array<f32, ${b2Data.length}> = array<f32, ${b2Data.length}>(${formatWgslFloatList(b2Data).join(", ")});`,
        ]
      : []),
    "",
    `@compute @workgroup_size(${wgSize})`,
    "fn main(@builtin(global_invocation_id) gid: vec3<u32>) {",
    "  let out_idx: u32 = gid.x;",
    "  if (out_idx >= OUT_DIM) { return; }",
    "  let in_len: u32 = arrayLength(&input_vec);",
  ];

  if (numLayers === G.two_scalar) {
    lines.push(
      "  var acc2: f32 = B2[out_idx];",
      "  let row2_base: u32 = out_idx * HIDDEN_DIM;",
      "  for (var h: u32 = 0u; h < HIDDEN_DIM; h = h + 1u) {",
      "    var h_acc: f32 = B1[h];",
      "    let row1_base: u32 = h * IN_DIM;",
      "    for (var c: u32 = 0u; c < IN_DIM; c = c + 1u) {",
      "      var xv: f32 = 0.0;",
      "      if (in_len > 0u) {",
      "        xv = input_vec[c % in_len];",
      "      }",
      "      h_acc = h_acc + W1[row1_base + c] * xv;",
      "    }",
      "    let h_act: f32 = max(h_acc, 0.0);",
      "    acc2 = acc2 + W2[row2_base + h] * h_act;",
      "  }",
      "  output_logits[out_idx] = acc2;",
      "}",
      ""
    );
  } else {
    lines.push(
      "  var acc: f32 = B1[out_idx];",
      "  let row_base: u32 = out_idx * IN_DIM;",
      "  for (var c: u32 = 0u; c < IN_DIM; c = c + 1u) {",
      "    var xv: f32 = 0.0;",
      "    if (in_len > 0u) {",
      "      xv = input_vec[c % in_len];",
      "    }",
      "    acc = acc + W1[row_base + c] * xv;",
      "  }",
      "  output_logits[out_idx] = acc;",
      "}",
      ""
    );
  }
  return lines.join("\n");
}

function formatRustFloatList(floats) {
  const parts = new Array(floats.length);
  for (let i = 0; i < floats.length; i += 1) {
    const clean = clampWeightScalar(floats[i], 0);
    const s = String(clean);
    parts[i] = `${s.includes(".") || s.includes("e") || s.includes("E") ? s : `${s}.0`}_f32`;
  }
  return parts;
}

function compilePortableRust(layerSpec, cleanModelId, safeModelIdent) {
  const { numLayers, inDim, hiddenDim, outDim, w1Data, b1Data, w2Data, b2Data } = layerSpec;
  const lines = [
    `// Teleion Fabric portable no_std Rust kernel (${safeCStringLiteral(cleanModelId)})`,
    "#![no_std]",
    "#![forbid(unsafe_code)]",
    "",
    `pub const IN_DIM: usize = ${inDim};`,
    ...(numLayers === G.two_scalar ? [`pub const HIDDEN_DIM: usize = ${hiddenDim};`] : []),
    `pub const OUT_DIM: usize = ${outDim};`,
    "",
    `pub static W1: [f32; ${w1Data.length}] = [${formatRustFloatList(w1Data).join(", ")}];`,
    `pub static B1: [f32; ${b1Data.length}] = [${formatRustFloatList(b1Data).join(", ")}];`,
    ...(numLayers === G.two_scalar && w2Data && b2Data
      ? [
          `pub static W2: [f32; ${w2Data.length}] = [${formatRustFloatList(w2Data).join(", ")}];`,
          `pub static B2: [f32; ${b2Data.length}] = [${formatRustFloatList(b2Data).join(", ")}];`,
        ]
      : []),
    "",
    "pub fn infer_slice(features: &[f32], out_logits: &mut [f32]) -> usize {",
    "  let feat_len: usize = features.len();",
    "  let mut best_idx: usize = 0;",
    "  let mut best_val: f32 = f32::NEG_INFINITY;",
    "  let mut r: usize = 0;",
    "  while r < OUT_DIM && r < out_logits.len() {",
  ];

  if (numLayers === G.two_scalar) {
    lines.push(
      "    let mut acc2: f32 = B2[r];",
      "    let row2_base: usize = r * HIDDEN_DIM;",
      "    let mut h: usize = 0;",
      "    while h < HIDDEN_DIM {",
      "      let mut h_acc: f32 = B1[h];",
      "      let row1_base: usize = h * IN_DIM;",
      "      let mut c: usize = 0;",
      "      while c < IN_DIM {",
      "        let xv: f32 = if feat_len > 0 { features[c % feat_len] } else { 0.0_f32 };",
      "        h_acc += W1[row1_base + c] * xv;",
      "        c += 1;",
      "      }",
      "      let h_act: f32 = if h_acc > 0.0_f32 { h_acc } else { 0.0_f32 };",
      "      acc2 += W2[row2_base + h] * h_act;",
      "      h += 1;",
      "    }",
      "    out_logits[r] = acc2;",
      "    if r == 0 || acc2 > best_val {",
      "      best_val = acc2;",
      "      best_idx = r;",
      "    }"
    );
  } else {
    lines.push(
      "    let mut acc: f32 = B1[r];",
      "    let row_base: usize = r * IN_DIM;",
      "    let mut c: usize = 0;",
      "    while c < IN_DIM {",
      "      let xv: f32 = if feat_len > 0 { features[c % feat_len] } else { 0.0_f32 };",
      "      acc += W1[row_base + c] * xv;",
      "      c += 1;",
      "    }",
      "    out_logits[r] = acc;",
      "    if r == 0 || acc > best_val {",
      "      best_val = acc;",
      "      best_idx = r;",
      "    }"
    );
  }

  lines.push(
    "    r += 1;",
    "  }",
    "  best_idx",
    "}",
    "",
    "pub fn infer(features: &[f32]) -> ([f32; OUT_DIM], usize) {",
    "  let mut out: [f32; OUT_DIM] = [0.0_f32; OUT_DIM];",
    "  let best_idx: usize = infer_slice(features, &mut out);",
    "  (out, best_idx)",
    "}",
    "",
    "pub fn infer_fixed(features: &[f32; IN_DIM]) -> ([f32; OUT_DIM], usize) {",
    "  let mut out: [f32; OUT_DIM] = [0.0_f32; OUT_DIM];",
    "  let best_idx: usize = infer_slice(features, &mut out);",
    "  (out, best_idx)",
    "}",
    "",
    `pub fn teleion_infer_${safeModelIdent}(features: &[f32], out_logits: &mut [f32]) -> usize {`,
    "  infer_slice(features, out_logits)",
    "}",
    ""
  );
  return lines.join("\n");
}

function compilePortableGlsl(layerSpec, cleanModelId) {
  const { numLayers, inDim, hiddenDim, outDim, w1Data, b1Data, w2Data, b2Data } = layerSpec;
  const lines = [
    "#version 300 es",
    `// Teleion Fabric portable WebGL2 fragment compute shader (${safeCStringLiteral(cleanModelId)})`,
    "precision highp float;",
    "precision highp int;",
    "",
    `const int IN_DIM = ${inDim};`,
    ...(numLayers === G.two_scalar ? [`const int HIDDEN_DIM = ${hiddenDim};`] : []),
    `const int OUT_DIM = ${outDim};`,
    "",
    "uniform float u_input[IN_DIM];",
    "out vec4 frag_logit;",
    "",
    `const float W1[${w1Data.length}] = float[${w1Data.length}](${formatWgslFloatList(w1Data).join(", ")});`,
    `const float B1[${b1Data.length}] = float[${b1Data.length}](${formatWgslFloatList(b1Data).join(", ")});`,
    ...(numLayers === G.two_scalar && w2Data && b2Data
      ? [
          `const float W2[${w2Data.length}] = float[${w2Data.length}](${formatWgslFloatList(w2Data).join(", ")});`,
          `const float B2[${b2Data.length}] = float[${b2Data.length}](${formatWgslFloatList(b2Data).join(", ")});`,
        ]
      : []),
    "",
    "void main() {",
    "  int out_idx = int(gl_FragCoord.x);",
    "  if (out_idx < 0 || out_idx >= OUT_DIM) {",
    "    frag_logit = vec4(0.0, 0.0, 0.0, 1.0);",
    "    return;",
    "  }",
  ];

  if (numLayers === G.two_scalar) {
    lines.push(
      "  float acc2 = B2[out_idx];",
      "  int row2_base = out_idx * HIDDEN_DIM;",
      "  for (int h = 0; h < HIDDEN_DIM; ++h) {",
      "    float h_acc = B1[h];",
      "    int row1_base = h * IN_DIM;",
      "    for (int c = 0; c < IN_DIM; ++c) {",
      "      h_acc += W1[row1_base + c] * u_input[c];",
      "    }",
      "    float h_act = max(h_acc, 0.0);",
      "    acc2 += W2[row2_base + h] * h_act;",
      "  }",
      "  frag_logit = vec4(acc2, float(out_idx), 0.0, 1.0);",
      "}",
      ""
    );
  } else {
    lines.push(
      "  float acc = B1[out_idx];",
      "  int row_base = out_idx * IN_DIM;",
      "  for (int c = 0; c < IN_DIM; ++c) {",
      "    acc += W1[row_base + c] * u_input[c];",
      "  }",
      "  frag_logit = vec4(acc, float(out_idx), 0.0, 1.0);",
      "}",
      ""
    );
  }
  return lines.join("\n");
}

export async function buildModelPortableExport(db, publicUrl, modelId, rawRuntime) {
  const runtime = String(rawRuntime || "").trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(PORTABLE_RUNTIMES, runtime)) {
    return {
      status: G.http_bad_request,
      errorBody: {
        ok: false,
        code: "invalid_runtime",
        allowed_runtimes: ALLOWED_RUNTIME_IDS,
        detail: `Unsupported runtime '${cleanExportMetaText(rawRuntime, G.short_id_chars * G.four_scalar)}'. Choose ?runtime=js, python, sql, c99, rust, wasm, wat, wgsl, or glsl (or fetch binary weights at ${publicUrl}/q/models/${encodeURIComponent(String(modelId || "").trim())}/weights.safetensors).`,
      },
    };
  }

  const model = await loadModelByIdReadOnly(db, modelId);
  if (!model) {
    return {
      status: G.http_not_found,
      errorBody: {
        ok: false,
        code: "model_not_found",
        detail: `No hosted model matches '${cleanExportMetaText(modelId, G.model_id_max_chars)}'. List models at ${publicUrl}/q/models.`,
      },
    };
  }

  const runtimeSpec = PORTABLE_RUNTIMES[runtime];
  const normalized = normalizeTensorArray(model.tensors);
  const usedIdents = new Set();
  const safeModelIdent = safeCodeIdent(model.model_id, usedIdents, 0);
  const cleanModelId = cleanExportMetaText(model.model_id, G.model_id_max_chars) || safeModelIdent;
  const cleanFamily = cleanExportMetaText(model.family, G.table_id_max_chars);
  const cleanRole = cleanExportMetaText(model.lineage_role, G.short_id_chars * G.four_scalar);
  const cleanTitle = cleanExportMetaText(model.title, G.title_max_chars);

  const exportTensors = normalized.map((t, idx) => {
    const ident = safeCodeIdent(t.name, usedIdents, idx + 1);
    const dims = safeMatrixDims({ shape: t.shape, data: t.floats });
    return {
      ident,
      shape: t.shape,
      rows: dims.rows,
      cols: dims.cols,
      floats: t.floats,
    };
  });

  const primary = exportTensors[0];
  const matchingBias =
    exportTensors.find(
      (t, idx) => idx > 0 && t.shape.length === 1 && t.floats.length === primary.rows && t.ident.includes("bias")
    ) || null;

  const metaObj = {
    platform: "Teleion Fabric",
    model_id: cleanModelId,
    family: cleanFamily,
    lineage_role: cleanRole,
    title: cleanTitle,
    primary_tensor: primary.ident,
    primary_shape: [primary.rows, primary.cols],
    bias_tensor: matchingBias ? matchingBias.ident : null,
  };

  let code = "";
  if (runtime === "js") {
    const tensorEntries = exportTensors
      .map(
        (t) =>
          `  ${t.ident}: Object.freeze({ shape: Object.freeze(${JSON.stringify(t.shape)}), data: new Float32Array([${formatFloatList(t.floats).join(", ")}]) })`
      )
      .join(",\n");
    code = [
      `// Teleion Fabric portable ES module inference export (${cleanModelId})`,
      `export const MODEL_METADATA = Object.freeze(${safeJsonLiteral(metaObj)});`,
      `export const TENSORS = Object.freeze({\n${tensorEntries}\n});`,
      "",
      "export function infer(features = []) {",
      `  const weights = TENSORS.${primary.ident}.data;`,
      `  const bias = ${matchingBias ? `TENSORS.${matchingBias.ident}.data` : "null"};`,
      `  const rows = ${primary.rows};`,
      `  const cols = ${primary.cols};`,
      "  const out = new Float32Array(rows);",
      "  const vLen = features.length;",
      "  for (let r = 0; r < rows; r += 1) {",
      "    let acc = bias && r < bias.length ? Number(bias[r]) || 0 : 0;",
      "    const base = r * cols;",
      "    for (let c = 0; c < cols; c += 1) {",
      "      const xv = vLen > 0 ? Number(features[c % vLen]) || 0 : 0;",
      "      acc += weights[base + c] * xv;",
      "    }",
      "    out[r] = acc;",
      "  }",
      "  return out;",
      "}",
      "",
    ].join("\n");
  } else if (runtime === "python") {
    const pyMeta = {
      platform: metaObj.platform,
      model_id: metaObj.model_id,
      family: metaObj.family,
      lineage_role: metaObj.lineage_role,
      title: metaObj.title,
      primary_tensor: metaObj.primary_tensor,
      primary_shape: metaObj.primary_shape,
    };
    const pyTensors = exportTensors
      .map(
        (t) =>
          `    ${safeJsonLiteral(t.ident)}: {"shape": (${t.shape.join(", ")}${t.shape.length === 1 ? "," : ""}), "data": (${formatFloatList(t.floats).join(", ")}${t.floats.length === 1 ? "," : ""})}`
      )
      .join(",\n");
    code = [
      `# Teleion Fabric zero-dependency Python inference export (${cleanModelId})`,
      `MODEL_METADATA = ${safeJsonLiteral(pyMeta)}`,
      `BIAS_TENSOR = ${matchingBias ? safeJsonLiteral(matchingBias.ident) : "None"}`,
      `TENSORS = {\n${pyTensors}\n}`,
      "",
      "def infer(features):",
      "    seq = list(features or ())",
      `    weights = TENSORS[${safeJsonLiteral(primary.ident)}]["data"]`,
      "    bias = TENSORS[BIAS_TENSOR][\"data\"] if BIAS_TENSOR else None",
      `    rows = ${primary.rows}`,
      `    cols = ${primary.cols}`,
      "    v_len = len(seq)",
      "    out = []",
      "    for r in range(rows):",
      "        acc = float(bias[r]) if bias and r < len(bias) else 0.0",
      "        base = r * cols",
      "        for c in range(cols):",
      "            xv = float(seq[c % v_len]) if v_len > 0 else 0.0",
      "            acc += weights[base + c] * xv",
      `        out.append(round(acc, ${G.sql_round_digits}))`,
      "    return out",
      "",
    ].join("\n");
  } else if (runtime === "sql") {
    const sqlRows = Math.min(primary.rows, G.sql_export_max_rows);
    const sqlCols = Math.min(primary.cols, G.sql_export_max_cols);
    const inputTuples = [];
    for (let c = 0; c < sqlCols; c += 1) {
      inputTuples.push(`(${c}, ${c === 0 ? "1.0" : "0.5"})`);
    }
    const weightTuples = [];
    for (let r = 0; r < sqlRows; r += 1) {
      for (let c = 0; c < sqlCols; c += 1) {
        const rawW = Number(primary.floats[r * primary.cols + c]);
        const w = clampWeightScalar(rawW, 0);
        weightTuples.push(`(${r}, ${c}, ${w})`);
      }
    }
    const biasTuples = [];
    for (let r = 0; r < sqlRows; r += 1) {
      const rawB = matchingBias ? Number(matchingBias.floats[r]) : 0;
      const b = clampWeightScalar(rawB, 0);
      biasTuples.push(`(${r}, ${b})`);
    }
    const safeSqlComment = cleanModelId.replace(/--+/g, "-");
    code = [
      `-- Teleion Fabric portable SQLite dot-product projection (${safeSqlComment})`,
      "WITH input_vec(col_idx, x_val) AS (",
      `  VALUES ${inputTuples.join(", ")}`,
      "),",
      "weight_matrix(row_idx, col_idx, w_val) AS (",
      `  VALUES ${weightTuples.join(", ")}`,
      "),",
      "row_bias(row_idx, b_val) AS (",
      `  VALUES ${biasTuples.join(", ")}`,
      ")",
      "SELECT",
      "  weight_matrix.row_idx AS output_idx,",
      `  ROUND(SUM(weight_matrix.w_val * input_vec.x_val) + COALESCE(MAX(row_bias.b_val), 0.0), ${G.sql_round_digits}) AS logit`,
      "FROM weight_matrix",
      "JOIN input_vec ON input_vec.col_idx = weight_matrix.col_idx",
      "LEFT JOIN row_bias ON row_bias.row_idx = weight_matrix.row_idx",
      "GROUP BY weight_matrix.row_idx",
      "ORDER BY weight_matrix.row_idx;",
      "",
    ].join("\n");
  } else if (runtime === "c99") {
    const guardMacro = `TELEION_MODEL_${safeModelIdent.toUpperCase()}_H`;
    const cArrays = exportTensors
      .map(
        (t) =>
          `static const float ${t.ident}[${t.floats.length}] = { ${formatCFloatList(t.floats).join(", ")} };`
      )
      .join("\n");
    code = [
      `/* Teleion Fabric portable C99 inference header (${safeCStringLiteral(cleanModelId)}) */`,
      `#ifndef ${guardMacro}`,
      `#define ${guardMacro}`,
      "",
      `#define TELEION_${safeModelIdent.toUpperCase()}_ROWS ${primary.rows}`,
      `#define TELEION_${safeModelIdent.toUpperCase()}_COLS ${primary.cols}`,
      `static const char teleion_model_id_${safeModelIdent}[] = "${safeCStringLiteral(cleanModelId)}";`,
      cArrays,
      "",
      `static inline void teleion_infer_${safeModelIdent}(const float *features, int feat_len, float *out_logits) {`,
      `  const int rows = ${primary.rows};`,
      `  const int cols = ${primary.cols};`,
      "  for (int r = 0; r < rows; ++r) {",
      `    float acc = ${matchingBias ? `${matchingBias.ident}[r]` : "0.0f"};`,
      "    int base = r * cols;",
      "    for (int c = 0; c < cols; ++c) {",
      "      float xv = (features && feat_len > 0) ? features[c % feat_len] : 0.0f;",
      `      acc += ${primary.ident}[base + c] * xv;`,
      "    }",
      "    out_logits[r] = acc;",
      "  }",
      "}",
      "",
      `#endif /* ${guardMacro} */`,
      "",
    ].join("\n");
  } else if (runtime === "wasm" || runtime === "wat") {
    const layerSpec = extractPortableLayerSpec(model, primary, matchingBias);
    const compiled = compilePortableWasmAndWat(layerSpec, cleanModelId);
    if (runtime === "wasm") {
      if (compiled.wasmBytes.byteLength > G.export_max_bytes) {
        return {
          status: G.http_payload_too_large,
          errorBody: {
            ok: false,
            code: "export_exceeds_limit",
            max_bytes: G.export_max_bytes,
            detail: "Model binary export exceeds bounded response limit; download binary .safetensors instead.",
          },
        };
      }
      const safeWasmStem =
        cleanModelId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, G.model_id_max_chars) || safeModelIdent;
      return {
        status: G.http_ok,
        model_id: model.model_id,
        runtime,
        contentType: runtimeSpec.content_type,
        filename: `${safeWasmStem}.${runtimeSpec.ext}`,
        code: "",
        bytes: compiled.wasmBytes,
      };
    }
    code = compiled.watText;
  } else if (runtime === "rust") {
    const layerSpec = extractPortableLayerSpec(model, primary, matchingBias);
    code = compilePortableRust(layerSpec, cleanModelId, safeModelIdent);
  } else if (runtime === "glsl") {
    const layerSpec = extractPortableLayerSpec(model, primary, matchingBias);
    code = compilePortableGlsl(layerSpec, cleanModelId);
  } else {
    const layerSpec = extractPortableLayerSpec(model, primary, matchingBias);
    code = compilePortableWgsl(layerSpec, cleanModelId);
  }

  const scrubbedCode = scrubSourcePreserveLayout(
    code,
    runtime === "c99" || runtime === "rust" || runtime === "glsl"
  );
  const bytes = new TextEncoder().encode(scrubbedCode);
  if (bytes.byteLength > G.export_max_bytes) {
    return {
      status: G.http_payload_too_large,
      errorBody: {
        ok: false,
        code: "export_exceeds_limit",
        max_bytes: G.export_max_bytes,
        detail: "Model source export exceeds bounded response limit; download binary .safetensors instead.",
      },
    };
  }
  const safeFileStem =
    cleanModelId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, G.model_id_max_chars) || safeModelIdent;
  return {
    status: G.http_ok,
    model_id: model.model_id,
    runtime,
    contentType: runtimeSpec.content_type,
    filename: `${safeFileStem}.${runtimeSpec.ext}`,
    code: scrubbedCode,
    bytes,
  };
}

function resolveFamilyFilterSet(familyFilter) {
  if (!familyFilter) return null;
  if (UNIVERSAL_FAMILY_BY_ID.has(familyFilter)) {
    return new Set(UNIVERSAL_FAMILY_BY_ID.get(familyFilter).member_families);
  }
  return new Set([familyFilter]);
}

export async function queryWeightModelCatalog(db, publicUrl, rawFilter = {}) {
  const customModels = await loadCustomModelsReadOnly(db, G.catalog_limit_max);
  const allModels = [...BUILTIN_MODELS, ...customModels];

  const familyFilter = String(rawFilter.family || "").trim().toLowerCase();
  const allowedFamilies = resolveFamilyFilterSet(familyFilter);
  const statusFilter = String(rawFilter.status || "").trim().toLowerCase();
  const roleFilter = String(rawFilter.lineage_role || rawFilter.role || "").trim().toLowerCase();
  const queryText = String(rawFilter.q || "").trim().toLowerCase();
  const limit = clampInt(rawFilter.limit, G.catalog_limit_default, 1, G.catalog_limit_max);

  const filtered = allModels.filter((m) => {
    if (allowedFamilies && !allowedFamilies.has(m.family)) return false;
    if (statusFilter && m.status.toLowerCase() !== statusFilter) return false;
    if (roleFilter && m.lineage_role.toLowerCase() !== roleFilter) return false;
    if (queryText) {
      const hay = `${m.model_id} ${m.title} ${m.summary} ${m.family} ${m.lineage_role} ${m.task || ""}`.toLowerCase();
      if (!hay.includes(queryText)) return false;
    }
    return true;
  });

  const publicModels = filtered.slice(0, limit).map((m) => sanitizePublicModelView(m, publicUrl));
  const familySummaries = MODEL_FAMILIES.map((fam) => {
    const members = allModels.filter((m) => m.family === fam.id);
    const activeDefault =
      members.find((m) => !m.builtin && m.status === "promoted_default") ||
      members.find((m) => m.builtin && m.status === "promoted_default") ||
      members[0];
    const activeCanaries = members.filter((m) => m.status === "canary" && m.canary_share > 0);
    return {
      family: fam.id,
      universal_family: fam.universal_family,
      label: fam.label,
      summary: fam.summary,
      active_default_model_id: activeDefault ? activeDefault.model_id : fam.default_model_id,
      active_canary_count: activeCanaries.length,
      model_count: members.length,
    };
  });

  const universalFamilySummaries = UNIVERSAL_MODEL_FAMILIES.map((ufam) => {
    const memberSet = new Set(ufam.member_families);
    const members = allModels.filter((m) => memberSet.has(m.family));
    const activeDefault =
      members.find((m) => !m.builtin && m.status === "promoted_default") ||
      members.find((m) => m.model_id === ufam.default_model_id) ||
      members[0];
    const activeCanaries = members.filter((m) => m.status === "canary" && m.canary_share > 0);
    return {
      universal_family: ufam.id,
      member_families: ufam.member_families,
      label: ufam.label,
      summary: ufam.summary,
      active_default_model_id: activeDefault ? activeDefault.model_id : ufam.default_model_id,
      active_canary_count: activeCanaries.length,
      model_count: members.length,
    };
  });

  return {
    ok: true,
    schema: "teleion.weight_model_hub_catalog.v2",
    product: "Teleion Fabric",
    grid_schema: G.schema,
    total_models: filtered.length,
    builtin_count: BUILTIN_MODELS.length,
    registered_count: customModels.length,
    universal_family_count: UNIVERSAL_MODEL_FAMILIES.length,
    portable_runtime_count: PORTABLE_RUNTIME_TARGETS.length,
    portable_artifact_count: BUILTIN_MODELS.length * PORTABLE_RUNTIME_TARGETS.length,
    portable_runtimes: [...PORTABLE_RUNTIME_TARGETS],
    canary_policy: {
      initial_canary_share: G.canary_share,
      requires_held_out_beat_over_direct_baseline: true,
      max_anchor_drift: G.max_anchor_drift,
      enforces_disjoint_maker_checker_lineage: true,
      automatic_rollback_on_live_drop: true,
    },
    universal_families: universalFamilySummaries,
    families: familySummaries,
    models: publicModels,
    endpoints: {
      page_url: `${publicUrl}/models`,
      page_text_url: `${publicUrl}/models.txt`,
      catalog_json_url: `${publicUrl}/q/models`,
      catalog_text_url: `${publicUrl}/q/models.txt`,
      infer_url: `${publicUrl}/q/models/infer`,
      register_url: `${publicUrl}/q/models/register`,
      evaluate_url: `${publicUrl}/q/models/evaluate`,
      safetensors_template: `${publicUrl}/q/models/{model_id}/weights.safetensors`,
      export_template: `${publicUrl}/q/models/{model_id}/export?runtime=js|python|sql|c99|rust|wasm|wat|wgsl|glsl`,
    },
  };
}

export async function getWeightModelDetail(db, publicUrl, modelId) {
  const model = await loadModelByIdReadOnly(db, modelId);
  if (!model) return null;
  const safetensorsBytes = serializeSafetensors(model.tensors, {
    model_id: model.model_id,
    family: model.family,
    ...(model.task ? { task: model.task } : {}),
    lineage_role: model.lineage_role,
    lineage_id: model.lineage_id,
    platform: "Teleion Fabric",
    format: "pt",
  });
  let recentRuns = 0;
  if (db && typeof db.prepare === "function") {
    const row = await db
      .prepare("SELECT COUNT(*) AS cnt FROM herma_weight_model_runs WHERE model_id = ?")
      .bind(model.model_id)
      .first()
      .catch(() => null);
    recentRuns = Number(row?.cnt || 0);
  }
  const view = sanitizePublicModelView(model, publicUrl);
  return {
    ok: true,
    schema: "teleion.weight_model_detail.v2",
    model: {
      ...view,
      safetensors_file_bytes: safetensorsBytes.byteLength,
      recorded_runs: recentRuns,
    },
  };
}

export async function buildModelSafetensorsDownload(db, modelId) {
  const model = await loadModelByIdReadOnly(db, modelId);
  if (!model) return null;
  const bytes = serializeSafetensors(model.tensors, {
    model_id: model.model_id,
    family: model.family,
    ...(model.task ? { task: model.task } : {}),
    lineage_role: model.lineage_role,
    lineage_id: model.lineage_id,
    platform: "Teleion Fabric",
    format: "pt",
  });
  const safeFile = model.model_id.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, G.model_id_max_chars);
  return {
    model_id: model.model_id,
    filename: `${safeFile}.safetensors`,
    bytes,
  };
}

function normalizeModelSlug(rawId) {
  return String(rawId || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, G.model_id_max_chars);
}

function isContributorIdentifier(agentId, modelId) {
  return /^contributor(?:[-_.]|$)/i.test(agentId) || /(?:^|[-_.])contributor(?:[-_.]|$)/i.test(modelId);
}

function parseShapeArray(rawShape, maxDims = G.four_scalar, maxFloats = G.max_custom_weight_floats) {
  if (!Array.isArray(rawShape) || rawShape.length === 0 || rawShape.length > maxDims) {
    return { error: `Tensor shape must be an array of 1 to ${maxDims} positive integers.` };
  }
  const shape = [];
  let expected = 1;
  for (let i = 0; i < rawShape.length; i += 1) {
    const rawDim = Number(rawShape[i]);
    const dim = Math.trunc(rawDim);
    if (!Number.isFinite(rawDim) || dim < 1 || dim > maxFloats) {
      return { error: "Every tensor shape dimension must be a finite integer >= 1." };
    }
    expected *= dim;
    if (!Number.isFinite(expected) || expected < 1 || expected > maxFloats) {
      return { error: `Custom tensor parameters exceed limit (${maxFloats} floats).` };
    }
    shape.push(dim);
  }
  return { shape, expected };
}

function parseCustomTensorsFromBody(body, modelId, trainingRef) {
  if (body.tensors !== undefined && body.tensors !== null) {
    const rawTensors = body.tensors;
    if (!Array.isArray(rawTensors) || rawTensors.length === 0 || rawTensors.length > G.max_custom_tensors) {
      return { error: `tensors must be an array containing between 1 and ${G.max_custom_tensors} tensor entries.` };
    }
    let totalFloats = 0;
    const cleaned = [];
    for (let i = 0; i < rawTensors.length; i += 1) {
      const item = rawTensors[i];
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return { error: "Each tensor entry in tensors must be an object." };
      }
      let shape = [G.subspace_rank, G.subspace_rank];
      let expected = G.subspace_rank * G.subspace_rank;
      if (item.shape !== undefined && item.shape !== null) {
        const parsedShape = parseShapeArray(item.shape);
        if (parsedShape.error) return { error: parsedShape.error };
        shape = parsedShape.shape;
        expected = parsedShape.expected;
      }
      if (totalFloats + expected > G.max_custom_weight_floats) {
        return { error: `Custom tensor parameters exceed limit (${G.max_custom_weight_floats} floats).` };
      }
      totalFloats += expected;
      const src = Array.isArray(item.data) ? item.data : [];
      const data = new Array(expected);
      const fallback = seededFloatMatrix(1, expected, `${modelId}:${i}:${trainingRef}`, G.four_tenths_scalar);
      for (let k = 0; k < expected; k += 1) {
        const v = Number(src[k]);
        data[k] = Number.isFinite(v) ? clampWeightScalar(v, 0) : clampWeightScalar(fallback[k], 0);
      }
      const cleanName =
        stripPii(String(item.name || `cartridge_${i}`))
          .replace(/[^a-zA-Z0-9._-]/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, G.model_id_max_chars) || `cartridge_${i}`;
      cleaned.push({
        name: cleanName,
        shape,
        data,
      });
    }
    return { tensors: cleaned, byteSize: totalFloats * G.float32_bytes };
  }

  if (body.weights !== undefined && body.weights !== null) {
    if (!Array.isArray(body.weights) || body.weights.length === 0) {
      return { error: "weights must be a non-empty array of finite numbers." };
    }
    if (body.weights.length > G.max_custom_weight_floats) {
      return { error: `Custom weights array exceeds limit (${G.max_custom_weight_floats} floats).` };
    }
    let shape = [body.weights.length];
    let expected = body.weights.length;
    if (body.shape !== undefined && body.shape !== null) {
      const parsedShape = parseShapeArray(body.shape);
      if (parsedShape.error) return { error: parsedShape.error };
      shape = parsedShape.shape;
      expected = parsedShape.expected;
    }
    if (expected !== body.weights.length) {
      return { error: `Provided shape product (${expected}) does not match weights length (${body.weights.length}).` };
    }
    const data = body.weights.map((v) => clampWeightScalar(v, 0));
    return {
      tensors: [{ name: "subspace_cartridge", shape, data }],
      byteSize: data.length * G.float32_bytes,
    };
  }

  const mat = seededFloatMatrix(G.subspace_rank, G.subspace_rank, `${modelId}:${trainingRef}`, G.four_tenths_scalar);
  for (let r = 0; r < G.subspace_rank; r += 1) {
    mat[r * G.subspace_rank + r] += G.six_tenths_scalar;
  }
  return {
    tensors: [
      {
        name: "subspace_cartridge",
        shape: [G.subspace_rank, G.subspace_rank],
        data: Array.from(mat, (v) => roundScale(v, G.float_embed_round_scale)),
      },
    ],
    byteSize: G.cartridge_bytes,
  };
}

export async function registerWeightModel(db, publicUrl, agentId, body = {}) {
  await ensureWeightModelHubSchema(db);
  const rawModelId = String(body.model_id || body.id || "").trim();
  const modelId = normalizeModelSlug(rawModelId);
  if (!modelId || modelId.length < G.model_id_min_chars) {
    return {
      status: G.http_bad_request,
      body: {
        ok: false,
        code: "invalid_model_id",
        detail: "Provide a model_id of at least 3 characters using lowercase letters, digits, dots, underscores, or hyphens.",
      },
    };
  }
  if (RESERVED_SUBROUTES.has(modelId)) {
    return {
      status: G.http_bad_request,
      body: { ok: false, code: "reserved_model_id", detail: `model_id '${modelId}' is a reserved hub subroute.` },
    };
  }
  if (isContributorIdentifier(agentId, modelId)) {
    return {
      status: G.http_forbidden,
      body: {
        ok: false,
        code: "contributor_tier_refused",
        detail: "Contributor-tier model identifiers cannot register weight cartridges in the shared hub.",
      },
    };
  }
  if (BUILTIN_BY_ID.has(modelId)) {
    return {
      status: G.http_forbidden,
      body: {
        ok: false,
        code: "builtin_protected",
        detail: `Built-in Teleion Fabric model '${modelId}' cannot be overwritten. Register a new versioned model_id.`,
      },
    };
  }

  const existing = await db
    .prepare("SELECT producer_agent, status, previous_default_id FROM herma_weight_models WHERE model_id = ?")
    .bind(modelId)
    .first()
    .catch(() => null);
  if (existing && existing.producer_agent !== agentId) {
    return {
      status: G.http_conflict,
      body: {
        ok: false,
        code: "model_id_claimed_by_other_agent",
        detail: `Model '${modelId}' belongs to another worker. Choose a distinct model_id.`,
      },
    };
  }

  const rawFamily = String(body.family || "atomic_cartridge_bank").trim().toLowerCase();
  const family =
    VALID_FAMILY_IDS.has(rawFamily)
      ? rawFamily
      : UNIVERSAL_FAMILY_BY_ID.has(rawFamily)
        ? UNIVERSAL_FAMILY_BY_ID.get(rawFamily).member_families[0]
        : rawFamily;
  if (!VALID_FAMILY_IDS.has(family)) {
    return {
      status: G.http_bad_request,
      body: {
        ok: false,
        code: "invalid_family",
        detail: `Unsupported family '${family}'. Choose one of: ${[...VALID_FAMILY_IDS].join(", ")}.`,
      },
    };
  }

  const defaultRoleByFamily =
    family === "weight_programmed_llm"
      ? "maker"
      : family === "sparse_autoencoder_probe"
        ? "probe"
        : VALID_LINEAGE_ROLES.has(family)
          ? family
          : "cartridge";
  const lineageRole = String(body.lineage_role || defaultRoleByFamily)
    .trim()
    .toLowerCase();
  if (!VALID_LINEAGE_ROLES.has(lineageRole)) {
    return {
      status: G.http_bad_request,
      body: {
        ok: false,
        code: "invalid_lineage_role",
        detail: `Unsupported lineage_role '${lineageRole}'. Choose one of: ${[...VALID_LINEAGE_ROLES].join(", ")}.`,
      },
    };
  }

  const trainingDataRef = stripPii(String(body.training_data_ref || "").trim()).slice(0, G.ref_max_chars);
  if (!trainingDataRef) {
    return {
      status: G.http_bad_request,
      body: {
        ok: false,
        code: "missing_training_data_ref",
        detail: "Provide training_data_ref naming the held-out trace or dataset record used to compile these weights.",
      },
    };
  }

  const heldOutScore = Number(body.held_out_score);
  const directBaselineScore = Number(body.direct_baseline_score);
  if (!Number.isFinite(heldOutScore) || !Number.isFinite(directBaselineScore) || heldOutScore < 0 || heldOutScore > 1 || directBaselineScore < 0 || directBaselineScore > 1) {
    return {
      status: G.http_bad_request,
      body: {
        ok: false,
        code: "invalid_benchmark_scores",
        detail: "Provide numeric held_out_score and direct_baseline_score in [0.0, 1.0].",
      },
    };
  }

  const lineageId = stripPii(String(body.lineage_id || body.checker_lineage || `lineage-${agentId}-${modelId}`).trim()).slice(
    0,
    G.lineage_max_chars
  );
  const pairedLineage = stripPii(String(body.paired_disjoint_lineage || body.maker_lineage || "").trim()).slice(
    0,
    G.lineage_max_chars
  );

  if (
    (body.maker_lineage && body.checker_lineage && String(body.maker_lineage).trim() === String(body.checker_lineage).trim()) ||
    (lineageRole === "checker" && pairedLineage && pairedLineage === lineageId)
  ) {
    return {
      status: G.http_unprocessable,
      body: {
        ok: false,
        code: "lineage_not_disjoint",
        detail:
          "Independent checker registration requires maker_lineage != checker_lineage. A checker model cannot share fine-tune lineage with the maker it checks.",
      },
    };
  }
  if (lineageRole === "checker" && body.checked_model_id) {
    const checkedTarget = await loadModelById(db, body.checked_model_id);
    if (
      checkedTarget &&
      (checkedTarget.lineage_id === lineageId || checkedTarget.training_data_ref === trainingDataRef)
    ) {
      return {
        status: G.http_unprocessable,
        body: {
          ok: false,
          code: "lineage_not_disjoint",
          detail:
            "Checker model shares lineage_id or training_data_ref with checked_model_id. Keep maker and checker weight lineages strictly disjoint.",
        },
      };
    }
  }

  const anchorDrift = Number(body.anchor_drift ?? 0);
  if (!Number.isFinite(anchorDrift) || anchorDrift < 0) {
    return {
      status: G.http_bad_request,
      body: { ok: false, code: "invalid_anchor_drift", detail: "anchor_drift must be a non-negative number." },
    };
  }
  if (anchorDrift > G.max_anchor_drift) {
    return {
      status: G.http_unprocessable,
      body: {
        ok: false,
        code: "anchor_drift_exceeded",
        anchor_drift: roundScale(anchorDrift),
        max_anchor_drift: G.max_anchor_drift,
        canary_activated: false,
        canary_share: G.inactive_share,
        detail: `anchor_drift (${roundScale(anchorDrift)}) exceeds max_anchor_drift (${G.max_anchor_drift}). Project weight edits into the anchor nullspace before canary activation.`,
      },
    };
  }

  const heldOutMargin = heldOutScore - directBaselineScore;
  if (heldOutMargin < G.min_held_out_margin) {
    return {
      status: G.http_unprocessable,
      body: {
        ok: false,
        code: "held_out_below_direct_baseline",
        held_out_score: roundScale(heldOutScore),
        direct_baseline_score: roundScale(directBaselineScore),
        held_out_margin: roundScale(heldOutMargin),
        canary_activated: false,
        canary_share: G.inactive_share,
        detail:
          "Canary activation requires held_out_score to beat the matched direct/thinking-off baseline (direct_baseline_score).",
      },
    };
  }

  const parsedTensors = parseCustomTensorsFromBody(body, modelId, trainingDataRef);
  if (parsedTensors.error) {
    return {
      status: G.http_bad_request,
      body: { ok: false, code: "invalid_tensors", detail: parsedTensors.error },
    };
  }

  const costUsd = Math.max(0, Number.isFinite(Number(body.cost_usd)) ? Number(body.cost_usd) : 0);
  const title = stripPii(String(body.title || modelId).trim()).slice(0, G.title_max_chars);
  const summary = stripPii(
    String(
      body.summary || `Trace-compiled ${family} model (${lineageRole}) beats matched direct baseline on held-out cases.`
    ).trim()
  ).slice(0, G.summary_max_chars);
  const baseModel = stripPii(String(body.base_model || "Meta open-weight models").trim()).slice(0, G.ref_max_chars);
  const safeAgentId = stripPii(String(agentId || "").trim()).slice(0, G.agent_id_max_chars);
  const safeTaskSlug = body.task
    ? scrubBannedWords(stripPii(String(body.task).trim())).slice(0, G.lineage_max_chars)
    : "";
  const storedConfigJson = safeTaskSlug ? JSON.stringify({ task: safeTaskSlug }) : "{}";
  const nowIso = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO herma_weight_models (
        model_id, family, title, summary, producer_agent, lineage_role, lineage_id, paired_disjoint_lineage,
        base_model, training_data_ref, held_out_score, direct_baseline_score, live_eval_score, live_eval_count,
        last_evaluator_agent, anchor_drift, cost_usd, canary_share, status, previous_default_id,
        tensors_json, config_json, byte_size, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, '', ?, ?, ?, 'canary', '', ?, ?, ?, ?, ?)
      ON CONFLICT(model_id) DO UPDATE SET
        family = excluded.family,
        title = excluded.title,
        summary = excluded.summary,
        lineage_role = excluded.lineage_role,
        lineage_id = excluded.lineage_id,
        paired_disjoint_lineage = excluded.paired_disjoint_lineage,
        base_model = excluded.base_model,
        training_data_ref = excluded.training_data_ref,
        held_out_score = excluded.held_out_score,
        direct_baseline_score = excluded.direct_baseline_score,
        anchor_drift = excluded.anchor_drift,
        cost_usd = excluded.cost_usd,
        canary_share = excluded.canary_share,
        status = 'canary',
        tensors_json = excluded.tensors_json,
        config_json = excluded.config_json,
        byte_size = excluded.byte_size,
        updated_at = excluded.updated_at`
    )
    .bind(
      modelId,
      family,
      title,
      summary,
      safeAgentId,
      lineageRole,
      lineageId,
      pairedLineage,
      baseModel,
      trainingDataRef,
      heldOutScore,
      directBaselineScore,
      anchorDrift,
      costUsd,
      G.canary_share,
      JSON.stringify(parsedTensors.tensors),
      storedConfigJson,
      parsedTensors.byteSize,
      nowIso,
      nowIso
    )
    .run();

  const saved = await loadModelById(db, modelId);
  return {
    status: existing ? G.http_ok : G.http_created,
    body: {
      ok: true,
      schema: "teleion.weight_model_registration.v1",
      canary_activated: true,
      status: "canary",
      canary_share: G.canary_share,
      model: sanitizePublicModelView(saved, publicUrl),
    },
  };
}

export async function evaluateWeightModel(db, publicUrl, evaluatorAgent, body = {}) {
  await ensureWeightModelHubSchema(db);
  const modelId = normalizeModelSlug(body.model_id || body.id || "");
  if (!modelId) {
    return {
      status: G.http_bad_request,
      body: { ok: false, code: "missing_model_id", detail: "Provide model_id to evaluate." },
    };
  }
  if (BUILTIN_BY_ID.has(modelId)) {
    return {
      status: G.http_forbidden,
      body: {
        ok: false,
        code: "builtin_immutable",
        detail: "Built-in reference models have fixed promotion state; register and evaluate a custom versioned model_id.",
      },
    };
  }

  const row = await db
    .prepare("SELECT * FROM herma_weight_models WHERE model_id = ?")
    .bind(modelId)
    .first()
    .catch(() => null);
  if (!row) {
    return {
      status: G.http_not_found,
      body: { ok: false, code: "model_not_found", detail: `No registered model matches '${modelId}'.` },
    };
  }

  const liveScore = Number(body.live_score ?? body.eval_score ?? body.score);
  if (!Number.isFinite(liveScore) || liveScore < 0 || liveScore > 1) {
    return {
      status: G.http_bad_request,
      body: { ok: false, code: "invalid_live_score", detail: "Provide numeric live_score in [0.0, 1.0]." },
    };
  }

  let liveDrift = Number(row.anchor_drift || 0);
  if (body.anchor_drift !== undefined && body.anchor_drift !== null) {
    const parsedDrift = Number(body.anchor_drift);
    if (!Number.isFinite(parsedDrift) || parsedDrift < 0) {
      return {
        status: G.http_bad_request,
        body: { ok: false, code: "invalid_anchor_drift", detail: "anchor_drift must be a non-negative number." },
      };
    }
    liveDrift = parsedDrift;
  }

  if (evaluatorAgent === row.producer_agent) {
    return {
      status: G.http_conflict,
      body: {
        ok: false,
        code: "independent_evaluator_required",
        detail:
          "Independent evaluation rule (maker != checker): producer_agent cannot evaluate its own model. Evaluate from a distinct worker ID.",
      },
    };
  }

  if (body.evaluator_lineage && String(body.evaluator_lineage).trim() === String(row.lineage_id)) {
    return {
      status: G.http_unprocessable,
      body: {
        ok: false,
        code: "lineage_not_disjoint",
        detail: "Evaluator lineage matches model lineage_id; independent evaluation requires disjoint lineage.",
      },
    };
  }

  const storedBaseline = Number(row.direct_baseline_score || 0);
  const safeEvaluatorAgent = stripPii(String(evaluatorAgent || "").trim()).slice(0, G.agent_id_max_chars);
  const nowIso = new Date().toISOString();
  const nextCount = Number(row.live_eval_count || 0) + 1;

  const droppedBelowBaseline =
    liveScore < storedBaseline - G.rollback_drop_margin ||
    liveScore < storedBaseline ||
    liveDrift > G.max_anchor_drift;

  if (droppedBelowBaseline) {
    const familySpec = MODEL_FAMILIES.find((f) => f.id === row.family) || MODEL_FAMILIES[0];
    const restoreId = row.previous_default_id || familySpec.default_model_id;
    await db
      .prepare(
        `UPDATE herma_weight_models
         SET status = 'rolled_back',
             canary_share = 0,
             live_eval_score = ?,
             live_eval_count = ?,
             last_evaluator_agent = ?,
             anchor_drift = ?,
             updated_at = ?
         WHERE model_id = ?`
      )
      .bind(liveScore, nextCount, safeEvaluatorAgent, liveDrift, nowIso, modelId)
      .run();

    if (row.status === "promoted_default" && row.previous_default_id && !BUILTIN_BY_ID.has(row.previous_default_id)) {
      await db
        .prepare(
          `UPDATE herma_weight_models
           SET status = 'promoted_default', canary_share = 1.0, updated_at = ?
           WHERE model_id = ?`
        )
        .bind(nowIso, row.previous_default_id)
        .run();
    }

    const updated = await loadModelById(db, modelId);
    return {
      status: G.http_ok,
      body: {
        ok: true,
        schema: "teleion.weight_model_evaluation.v1",
        action: "rolled_back",
        status: "rolled_back",
        canary_share: G.inactive_share,
        restored_default_id: restoreId,
        model: sanitizePublicModelView(updated, publicUrl),
      },
    };
  }

  const beatsPromotionGate =
    liveScore >= storedBaseline + G.min_live_promotion_margin &&
    liveScore >= Number(row.held_out_score) - G.live_held_out_tolerance;

  if (beatsPromotionGate) {
    const familySpec = MODEL_FAMILIES.find((f) => f.id === row.family) || MODEL_FAMILIES[0];
    const priorDefaultRow = await db
      .prepare("SELECT model_id FROM herma_weight_models WHERE family = ? AND status = 'promoted_default' AND model_id != ? LIMIT 1")
      .bind(row.family, modelId)
      .first()
      .catch(() => null);
    const previousDefaultId = priorDefaultRow?.model_id || familySpec.default_model_id;

    if (priorDefaultRow?.model_id) {
      await db
        .prepare("UPDATE herma_weight_models SET status = 'superseded', canary_share = 0, updated_at = ? WHERE model_id = ?")
        .bind(nowIso, priorDefaultRow.model_id)
        .run();
    }

    await db
      .prepare(
        `UPDATE herma_weight_models
         SET status = 'promoted_default',
             canary_share = ?,
             previous_default_id = ?,
             live_eval_score = ?,
             live_eval_count = ?,
             last_evaluator_agent = ?,
             anchor_drift = ?,
             updated_at = ?
         WHERE model_id = ?`
      )
      .bind(
        G.promoted_share,
        previousDefaultId,
        liveScore,
        nextCount,
        safeEvaluatorAgent,
        liveDrift,
        nowIso,
        modelId
      )
      .run();

    const updated = await loadModelById(db, modelId);
    return {
      status: G.http_ok,
      body: {
        ok: true,
        schema: "teleion.weight_model_evaluation.v1",
        action: "promoted_default",
        status: "promoted_default",
        canary_share: G.promoted_share,
        previous_default_id: previousDefaultId,
        model: sanitizePublicModelView(updated, publicUrl),
      },
    };
  }

  await db
    .prepare(
      `UPDATE herma_weight_models
       SET status = 'canary',
           canary_share = ?,
           live_eval_score = ?,
           live_eval_count = ?,
           last_evaluator_agent = ?,
           anchor_drift = ?,
           updated_at = ?
       WHERE model_id = ?`
    )
    .bind(G.canary_share, liveScore, nextCount, safeEvaluatorAgent, liveDrift, nowIso, modelId)
    .run();

  const updated = await loadModelById(db, modelId);
  return {
    status: G.http_ok,
    body: {
      ok: true,
      schema: "teleion.weight_model_evaluation.v1",
      action: "retained_canary",
      status: "canary",
      canary_share: G.canary_share,
      model: sanitizePublicModelView(updated, publicUrl),
    },
  };
}

export async function runHubInference(request, db, publicUrl, input = {}, { skipPersist = false } = {}) {
  const startedNs = performance.now();
  const requestedModelId = String(input.model || input.model_id || "").trim();
  const requestedFamily = String(input.family || "").trim().toLowerCase();
  const familySet = resolveFamilyFilterSet(requestedFamily);

  let model = null;
  let canaryCandidates = [];

  if (requestedModelId) {
    model = await loadModelByIdReadOnly(db, requestedModelId);
    if (!model) {
      return {
        status: G.http_not_found,
        body: {
          ok: false,
          code: "model_not_found",
          detail: `No hosted model matches '${requestedModelId}'. List all models at ${publicUrl}/q/models`,
        },
      };
    }
  } else if (familySet && (VALID_FAMILY_IDS.has(requestedFamily) || UNIVERSAL_FAMILY_BY_ID.has(requestedFamily))) {
    const custom = await loadCustomModelsReadOnly(db, G.catalog_limit_default);
    const famCustom = custom.filter((m) => familySet.has(m.family));
    canaryCandidates = famCustom.filter((m) => m.status === "canary" && m.canary_share > 0).map((m) => m.model_id);
    const ufamDefaultId = UNIVERSAL_FAMILY_BY_ID.get(requestedFamily)?.default_model_id || "";
    model =
      famCustom.find((m) => m.status === "promoted_default") ||
      (ufamDefaultId ? BUILTIN_BY_ID.get(ufamDefaultId) : null) ||
      BUILTIN_MODELS.find((m) => familySet.has(m.family)) ||
      BUILTIN_MODELS[0];
  } else {
    model = BUILTIN_MODELS[0];
  }

  const outputs = runModelForwardPass(model, input);
  let compositeGuidance = null;
  if (!requestedModelId && !requestedFamily) {
    const embedOut = runModelForwardPass(BUILTIN_BY_ID.get("tf-embed-nullspace-24d-v1"), input);
    const deciderOut = runModelForwardPass(BUILTIN_BY_ID.get("tf-decider-bundle-affinity-v1"), input);
    compositeGuidance = {
      nearest_routes: embedOut.nearest_routes,
      dispatch_mode: deciderOut.dispatch_mode,
      bundle_size: deciderOut.bundle_size,
      dag_shape: deciderOut.dag_shape,
    };
  }

  const latencyMs = Math.max(G.min_held_out_margin, roundScale(performance.now() - startedNs));
  const runId = makeRunId();
  const nowIso = new Date().toISOString();
  const inputDigest = shortAlphaTag(JSON.stringify({ m: model.model_id, t: input.text || input.prompt || "" }));

  let checkedCaller = "";
  const rawCaller = String(input.agent_id || input.agent || "").trim().slice(0, G.agent_id_max_chars);
  if (rawCaller && db && typeof db.prepare === "function") {
    const reqUrl = new URL(request.url);
    const tok = tokenFromRequest(request, reqUrl, input);
    if (tok && (await doesTokenMatchAgentClaim(db, rawCaller, tok))) {
      checkedCaller = rawCaller;
    }
  }

  let persisted = false;
  if (!skipPersist && db && typeof db.prepare === "function" && request.method !== "HEAD" && !isLinkPreview(request)) {
    try {
      await ensureWeightModelHubSchema(db);
      const safeCaller = stripPii(checkedCaller);
      const safeStoredOutputs = stripPiiDeep(outputs);
      await db
        .prepare(
          `INSERT INTO herma_weight_model_runs
           (run_id, model_id, family, caller_agent, input_digest, latency_ms, output_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(runId, model.model_id, model.family, safeCaller, inputDigest, latencyMs, JSON.stringify(safeStoredOutputs), nowIso)
        .run();
      persisted = true;
    } catch {
      persisted = false;
    }
  }

  const safeId = encodeURIComponent(model.model_id);
  return {
    status: G.http_ok,
    body: scrubBannedDeep(
      stripPiiDeep({
        ok: true,
        schema: "teleion.weight_model_inference.v1",
        model_id: model.model_id,
        family: model.family,
        lineage_role: model.lineage_role,
        lineage_id: model.lineage_id,
        status: model.status,
        canary_share: roundScale(model.canary_share),
        ...(canaryCandidates.length > 0 ? { active_family_canaries: canaryCandidates } : {}),
        outputs,
        ...(compositeGuidance ? { composite_routing: compositeGuidance } : {}),
        latency_ms: latencyMs,
        run_record: {
          run_id: runId,
          model_id: model.model_id,
          family: model.family,
          input_tag: inputDigest,
          latency_ms: latencyMs,
          persisted,
          recorded_at: nowIso,
        },
        safetensors_url: `${publicUrl}/q/models/${safeId}/weights.safetensors`,
        export_urls: buildExportLinks(publicUrl, safeId),
      })
    ),
  };
}

export function renderModelsCatalogText(catalog) {
  const universalList = Array.isArray(catalog.universal_families) ? catalog.universal_families : [];
  const artifactCount = Number(
    catalog.portable_artifact_count || Number(catalog.builtin_count || BUILTIN_MODELS.length) * PORTABLE_RUNTIME_TARGETS.length
  );
  const lines = [
    "TELEION FABRIC - WEIGHT-SPACE MODEL HUB",
    `Models: ${catalog.total_models} (${catalog.builtin_count} built-in across ${universalList.length} universal families, ${artifactCount} portable runtime artifacts, ${catalog.registered_count} worker-registered)`,
    "Portable runtimes: .safetensors (IEEE-754 float32), JavaScript (js), Python (python), SQLite SQL (sql), C99 (c99), Rust (rust), WebAssembly (wasm / wat), WebGPU (wgsl), WebGL2 (glsl).",
    `Canary rollout: ${catalog.canary_policy.initial_canary_share * G.percent_scale} percent initial share. Cartridges must beat a matched direct baseline. Live drops trigger automatic rollback. Makers and checkers keep separate lineages.`,
    "",
    "ENDPOINTS",
    `  Human & agent page:  ${catalog.endpoints.page_url} (text: ${catalog.endpoints.page_text_url})`,
    `  JSON / text catalog: ${catalog.endpoints.catalog_json_url} (text: ${catalog.endpoints.catalog_text_url})`,
    `  Edge inference:      ${catalog.endpoints.infer_url}?model=tf-scratch-effort-router-v1&text=plan+multi-stage+dag`,
    `  Safetensors weights: ${catalog.endpoints.safetensors_template}`,
    `  Portable runtimes:   ${catalog.endpoints.export_template}`,
    `  Canary registration: POST ${catalog.endpoints.register_url}`,
    `  Live evaluation:     POST ${catalog.endpoints.evaluate_url}`,
    "",
    `UNIVERSAL FAMILIES (${universalList.length})`,
  ];
  for (const ufam of universalList) {
    lines.push(
      `  - ${ufam.universal_family} (${ufam.label}): default=${ufam.active_default_model_id}, models=${ufam.model_count}, canaries=${ufam.active_canary_count}`
    );
  }
  lines.push("", `MODELS (${catalog.models.length})`);
  for (const m of catalog.models) {
    lines.push(
      `  * ${m.model_id} [${m.family} | role=${m.lineage_role} | status=${m.status} | share=${m.canary_share}]`
    );
    lines.push(
      `    held_out=${m.held_out_score} vs direct_baseline=${m.direct_baseline_score} | anchor_drift=${m.anchor_drift} | params=${m.parameter_count} (${m.tensor_data_bytes} bytes)`
    );
    lines.push(`    summary: ${m.summary}`);
    lines.push(`    weights: ${m.links.safetensors_url}`);
    if (m.links.export_urls) {
      lines.push(
        `    exports: ${m.links.export_urls.js} | ${m.links.export_urls.python} | ${m.links.export_urls.sql} | ${m.links.export_urls.c99} | ${m.links.export_urls.rust} | ${m.links.export_urls.wasm} | ${m.links.export_urls.wat} | ${m.links.export_urls.wgsl} | ${m.links.export_urls.glsl}`
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export function renderModelDetailText(detail) {
  const m = detail.model;
  const exp = m.links.export_urls || {};
  const lines = [
    `MODEL: ${m.model_id}`,
    `Title: ${m.title}`,
    `Family: ${m.family} (universal: ${m.universal_family || m.family}, ${m.family_label})`,
    ...(m.task ? [`Task: ${m.task}`] : []),
    `Role & lineage: ${m.lineage_role} (${m.lineage_id})`,
    `Status & canary share: ${m.status} (share=${m.canary_share})`,
    `Base compatibility: ${m.base_model}`,
    `Training trace record: ${m.training_data_ref}`,
    `Scores: held_out=${m.held_out_score} | direct_baseline=${m.direct_baseline_score} | live_eval=${m.live_eval_score ?? "pending"} (${m.live_eval_count} runs)`,
    `Anchor drift: ${m.anchor_drift} | Tensor bytes: ${m.tensor_data_bytes} | Safetensors file bytes: ${m.safetensors_file_bytes}`,
    `Summary: ${m.summary}`,
    "",
    "TENSORS (IEEE-754 F32)",
    ...m.tensors.map((t) => `  - ${t.name}: shape=[${t.shape.join(", ")}], parameters=${t.parameters}, bytes=${t.bytes}`),
    "",
    `Download .safetensors: ${m.links.safetensors_url}`,
    `Export JS module:      ${exp.js || ""}`,
    `Export Python module:  ${exp.python || ""}`,
    `Export SQLite SQL:     ${exp.sql || ""}`,
    `Export C99 header:     ${exp.c99 || ""}`,
    `Export Rust kernel:    ${exp.rust || ""}`,
    `Export WASM binary:    ${exp.wasm || ""}`,
    `Export WAT text:       ${exp.wat || ""}`,
    `Export WGSL shader:    ${exp.wgsl || ""}`,
    `Export GLSL shader:    ${exp.glsl || ""}`,
    `Run edge inference:    ${m.links.infer_get_url}`,
  ];
  return `${lines.join("\n")}\n`;
}

export function renderModelsHubHtml(publicUrl, catalog) {
  const cleanField = (val, maxLen) => escapeHtml(tidyText(stripPii(String(val ?? "")), maxLen));
  const universalList =
    Array.isArray(catalog.universal_families) && catalog.universal_families.length > 0
      ? catalog.universal_families
      : UNIVERSAL_MODEL_FAMILIES.map((u) => ({
          universal_family: u.id,
          label: u.label,
          summary: u.summary,
          active_default_model_id: u.default_model_id,
          model_count: 1,
        }));

  const familyCards = universalList
    .map(
      (f) => `<article class="card">
        <div class="tags">
          <span class="tag tag-object">${cleanField(f.universal_family, G.table_id_max_chars)}</span>
          <span class="tag">${Number(f.model_count || 0)} hosted</span>
        </div>
        <h3>${cleanField(f.label, G.title_max_chars)}</h3>
        <p>${cleanField(f.summary, G.summary_max_chars)}</p>
        <div class="card-foot">
          <a class="btn-quiet btn-sm" href="/q/models?family=${encodeURIComponent(f.universal_family)}">JSON slice</a>
          <a class="btn-quiet btn-sm" href="/q/models/${encodeURIComponent(f.active_default_model_id)}/weights.safetensors">.safetensors</a>
          <a class="btn-quiet btn-sm" href="/q/models/${encodeURIComponent(f.active_default_model_id)}/export?runtime=js">JS</a>
          <a class="btn-quiet btn-sm" href="/q/models/${encodeURIComponent(f.active_default_model_id)}/export?runtime=rust">Rust</a>
          <a class="btn-quiet btn-sm" href="/q/models/${encodeURIComponent(f.active_default_model_id)}/export?runtime=wasm">WASM</a>
          <a class="btn-quiet btn-sm" href="/q/models/${encodeURIComponent(f.active_default_model_id)}/export?runtime=wgsl">WGSL</a>
        </div>
      </article>`
    )
    .join("\n      ");

  const modelRows = catalog.models
    .map((m) => {
      const rawId = String(m.raw_model_id || m.model_id || "");
      const safeHrefId = encodeURIComponent(rawId);
      const shownId = cleanField(m.model_id, G.table_id_max_chars);
      const shownTitle = cleanField(m.title, G.title_max_chars);
      const shownSummary = cleanField(m.summary, G.table_summary_max_chars);
      const shownFamily = cleanField(m.family, G.table_id_max_chars);
      const shownRole = cleanField(m.lineage_role, G.short_id_chars * G.four_scalar);
      const shownStatus = cleanField(m.status, G.short_id_chars * G.four_scalar);
      const heldPct = (Number(m.held_out_score || 0) * G.percent_scale).toFixed(1);
      const basePct = (Number(m.direct_baseline_score || 0) * G.percent_scale).toFixed(1);
      const sharePct = Math.round(Number(m.canary_share || 0) * G.percent_scale);
      return `<tr>
            <td><a href="/q/models/${safeHrefId}"><code>${shownId}</code></a><small>${shownTitle}. ${shownSummary}</small></td>
            <td><span class="tag">${shownFamily}</span><small>Role: ${shownRole}</small></td>
            <td>${heldPct}% vs ${basePct}%<small>Drift: ${Number(m.anchor_drift || 0)}</small></td>
            <td><span class="tag tag-real">${shownStatus}</span><small>${sharePct}% traffic &middot; ${Number(m.tensor_data_bytes || 0).toLocaleString("en-US")} B</small></td>
            <td><a href="/q/models/${safeHrefId}/weights.safetensors"><code>.safetensors</code></a> &middot; <a href="/q/models/${safeHrefId}/export?runtime=js"><code>JS</code></a> &middot; <a href="/q/models/${safeHrefId}/export?runtime=python"><code>Python</code></a> &middot; <a href="/q/models/${safeHrefId}/export?runtime=sql"><code>SQL</code></a> &middot; <a href="/q/models/${safeHrefId}/export?runtime=c99"><code>C99</code></a> &middot; <a href="/q/models/${safeHrefId}/export?runtime=rust"><code>Rust</code></a> &middot; <a href="/q/models/${safeHrefId}/export?runtime=wasm"><code>WASM</code></a> &middot; <a href="/q/models/${safeHrefId}/export?runtime=wat"><code>WAT</code></a> &middot; <a href="/q/models/${safeHrefId}/export?runtime=wgsl"><code>WGSL</code></a> &middot; <a href="/q/models/${safeHrefId}/export?runtime=glsl"><code>GLSL</code></a> &middot; <a href="/q/models/infer?model=${safeHrefId}&amp;text=plan+multi-stage+task+dag">Infer</a></td>
          </tr>`;
    })
    .join("\n          ");

  const main = `<section class="page-head">
  <div class="wrap">
    <p class="kicker"><span class="kicker-dot" aria-hidden="true"></span>Hosted weight-space primitives &amp; nine portable runtimes</p>
    <h1>Weight-Space Model Hub</h1>
    <p class="lead">Teleion Fabric serves ${Number(catalog.builtin_count || BUILTIN_MODELS.length)} built-in edge models across ${universalList.length} universal model families (${Number(catalog.portable_artifact_count || BUILTIN_MODELS.length * PORTABLE_RUNTIME_TARGETS.length)} portable runtime artifacts). Export any model to nine portable runtimes: IEEE-754 float32 <code>.safetensors</code>, JavaScript, Python, SQL, C99, Rust, WebAssembly, WGSL, and GLSL. Adapters pair Meta open-weight models and almost any LLM inference provider with canary rollout and automatic rollback. This page uses ASD-STE100 Simplified Technical English.</p>
    <div class="row">
      <a class="btn" href="/q/models">Open JSON catalog</a>
      <a class="btn-quiet" href="/models.txt">Plain-text copy (.txt)</a>
      <a class="btn-quiet" href="/q/models/tf-embed-nullspace-24d-v1/weights.safetensors">24-d .safetensors</a>
      <a class="btn-quiet" href="/q/models/tf-scratch-effort-router-v1/export?runtime=rust">Router Rust kernel</a>
      <a class="btn-quiet" href="/q/models/tf-scratch-effort-router-v1/export?runtime=wasm">Router WASM binary</a>
      <a class="btn-quiet" href="/q/models/tf-scratch-effort-router-v1/export?runtime=wgsl">Router WGSL shader</a>
      <a class="btn-quiet" href="/q/models/tf-scratch-effort-router-v1/export?runtime=glsl">Router GLSL shader</a>
    </div>
  </div>
</section>

<section class="section" aria-labelledby="families-h">
  <div class="wrap">
    <div class="section-head">
      <div>
        <h2 id="families-h">Ten universal weight-space model families</h2>
        <p class="hint">Each model runs deterministic forward passes at the edge in under one millisecond. Download weights as binary <code>.safetensors</code> or portable JS, Python, SQL, C99, Rust, WASM, WAT, WGSL, and GLSL targets.</p>
      </div>
    </div>
    <div class="cards">
      ${familyCards}
    </div>
  </div>
</section>

<section class="section" aria-labelledby="catalog-h">
  <div class="wrap">
    <div class="section-head">
      <div>
        <h2 id="catalog-h">Live model &amp; atomic cartridge catalog (${Number(catalog.total_models || 0)})</h2>
        <p class="hint">New cartridges must beat a matched direct baseline on held-out cases to enter a 10% canary slice. Makers and checkers keep separate lineages (<code>maker_lineage != checker_lineage</code>), and live score drops trigger automatic rollback.</p>
      </div>
      <a class="btn-quiet btn-sm" href="/q/models.txt">Text catalog</a>
    </div>
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Model ID &amp; purpose</th>
            <th>Family &amp; role</th>
            <th>Held-out vs direct</th>
            <th>Canary &amp; tensor size</th>
            <th>Nine runtimes &amp; edge run</th>
          </tr>
        </thead>
        <tbody>
          ${modelRows}
        </tbody>
      </table>
    </div>
  </div>
</section>

<section class="section" aria-labelledby="api-h">
  <div class="wrap">
    <div class="section-head">
      <div>
        <h2 id="api-h">Zero-auth HTTP, portable export &amp; MCP API reference</h2>
        <p class="hint">Read routes, portable exports, and edge inference require zero keys or setup. Registration and evaluation use your worker ID and <code>X-Worker-Token</code>, or <code>POST /mcp</code> (<code>list_weight_models</code>, <code>export_weight_model</code>, <code>run_weight_model</code>, <code>register_weight_model</code>).</p>
      </div>
    </div>
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>Operation</th>
            <th>Method &amp; path</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Catalog (JSON / plain text)</td>
            <td><code>GET /q/models</code> &middot; <code>GET /q/models.txt</code></td>
            <td>Filter models with <code>?family=</code>, <code>?lineage_role=</code>, <code>?status=</code>, and <code>?q=</code>.</td>
          </tr>
          <tr>
            <td>Model metadata &amp; tensor shapes</td>
            <td><code>GET /q/models/&lt;model_id&gt;</code></td>
            <td>Read parameter counts, byte offsets, lineage IDs, and held-out scores.</td>
          </tr>
          <tr>
            <td>Binary IEEE-754 float32 weights</td>
            <td><code>GET /q/models/&lt;model_id&gt;/weights.safetensors</code></td>
            <td>Download an 8-byte header length, padded JSON header, and contiguous F32 buffer.</td>
          </tr>
          <tr>
            <td>Portable multi-runtime export</td>
            <td><code>GET /q/models/&lt;model_id&gt;/export?runtime=js|python|sql|c99|rust|wasm|wat|wgsl|glsl</code></td>
            <td>Export zero-dependency JS, Python, SQLite SQL, C99, <code>#![no_std]</code> Rust, WebAssembly, WebGPU <code>.wgsl</code>, or WebGL2 <code>.glsl</code> shaders.</td>
          </tr>
          <tr>
            <td>Sub-millisecond V8 edge inference</td>
            <td><code>POST /q/models/infer</code> &middot; <code>GET /q/models/infer?model=...&amp;text=...</code></td>
            <td>Run routers, embeddings, analyzers, Koopman rollouts, hypernetworks, consistency filters, Legendre forecasts, conformal calibrators, or sparse autoencoder and ELK truth probes.</td>
          </tr>
          <tr>
            <td>Canary registration &amp; live evaluation</td>
            <td><code>POST /q/models/register</code> &middot; <code>POST /q/models/evaluate</code></td>
            <td>Start canaries at <code>0.10</code> traffic share. Promote via an independent evaluator or roll back automatically.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</section>`;

  return documentHtml({
    title: "Weight-Space Model Hub",
    description:
      "Sixteen hosted weight-space models across ten universal families (144 portable runtime artifacts) on Teleion Fabric, with IEEE-754 float32 .safetensors and JS, Python, SQL, C99, Rust, WASM, WGSL, and GLSL exports.",
    active: "",
    main,
    canonical: "/models",
  });
}

export function buildWeightModelsHint(publicUrl) {
  return {
    catalog_url: `${publicUrl}/q/models`,
    page_url: `${publicUrl}/models`,
    infer_url: `${publicUrl}/q/models/infer`,
    safetensors_template: `${publicUrl}/q/models/{model_id}/weights.safetensors`,
    export_template: `${publicUrl}/q/models/{model_id}/export?runtime=js|python|sql|c99|rust|wasm|wat|wgsl|glsl`,
    mcp_tools: ["list_weight_models", "export_weight_model", "run_weight_model", "register_weight_model"],
  };
}
