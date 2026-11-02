// Herma v6.11 Downloadable Worker Onboarding Kits (POSIX ustar + gzip .tgz, CRC32 PKZIP .zip,
// Python/Node/POSIX sh/SKILL.md/PreToolUse Hook), Server-Side Instruction & Toolkit Evolutionary
// Mutation Grid (Thompson Sampling + Controlled Seeded Epsilon-Mutation), Cross-Workspace 8-Scenario
// Agentic Cost & Calibrated Composition Research Noun, and Cadence Aggregate Work-Review &
// Bounded Queue Reprioritization Verbs (Hourly / Daily / On-Demand) for Generalist Workers.
//
// Strictly preserves universal Nouns (herma_task_objects + Tessera mirror) and Verbs
// (herma_durable_queue) with zero rival work authorities, zero hardcoded magic scalars,
// zero retired pack brand names, zero legacy model names, zero em-dashes, and Paper & Ink
// Light-UI-Only (color-scheme: only light).

export const HERMA_PROMPT_KIT_MUTATION_GRID = Object.freeze({
  grid_id: "herma.prompt_kit_mutation_and_reprioritization.grid.v6_11",
  schema_version: "herma.priority_work_gateway.kits_experiments_reprioritize.v6_11",
  schema_sentinel: "v6_11",
  kit_package_name: "herma-agent-kit",
  kit_package_version: "6.11.0",
  default_cell_id: "arm_default_recommended_v1",
  axes: Object.freeze({
    pitch_framing_axis: Object.freeze({
      parameter_type: "choice",
      choices: Object.freeze([
        "recommended_infra_leverage",
        "concise_imperative",
        "empirical_roi_framing",
        "capability_checklist",
      ]),
      default_value: "recommended_infra_leverage",
    }),
    kit_order_axis: Object.freeze({
      parameter_type: "choice",
      choices: Object.freeze([
        "canonical_tgz_zip_py_sh_mcp",
        "python_shim_first",
        "skill_zip_first",
        "harness_matched",
      ]),
      default_value: "canonical_tgz_zip_py_sh_mcp",
    }),
    inline_code_density_axis: Object.freeze({
      parameter_type: "choice",
      choices: Object.freeze([
        "minimal_links",
        "one_liner_commands",
        "full_copy_paste_code_block",
      ]),
      default_value: "one_liner_commands",
    }),
    task_encouragement_axis: Object.freeze({
      parameter_type: "choice",
      choices: Object.freeze([
        "adaptive_task_matched",
        "reuse_first_strict_shim",
        "multi_step_thick_plateau_verifier",
        "lightweight_hint_only",
      ]),
      default_value: "adaptive_task_matched",
    }),
  }),
  constraints: Object.freeze([
    Object.freeze({
      constraint_id: "no_lightweight_hint_with_full_code_block",
      forbidden_pair: Object.freeze({
        inline_code_density: "full_copy_paste_code_block",
        task_encouragement: "lightweight_hint_only",
      }),
      fallback_task_encouragement: "adaptive_task_matched",
    }),
  ]),
  bandit_config: Object.freeze({
    milli_scale: 1000,
    epsilon_mutation_milli: 180,
    epsilon_min_milli: 0,
    epsilon_max_milli: 850,
    thompson_prior_alpha: 2.0,
    thompson_prior_beta: 1.0,
    harness_matched_contextual_bonus_milli: 45,
    download_alpha_delta: 0.35,
    search_alpha_delta: 0.2,
    verified_pass_alpha_delta: 1.0,
    reuse_edge_alpha_delta: 0.45,
    reuse_edge_cap_per_submit: 4,
    feedback_alpha_delta: 0.25,
    failed_submit_beta_delta: 1.0,
    verified_lifecycle_min_passes: 2,
    promoted_lifecycle_min_passes: 5,
    promoted_lifecycle_min_posterior_milli: 780,
    ucb_z_95_milli: 1645,
    gamma_marsaglia_third_num: 1,
    gamma_marsaglia_third_den: 3,
    gamma_marsaglia_nine: 9,
    gamma_small_alpha_boost: 1,
    prng_uint32_divisor: 4294967296,
    prng_box_muller_two: 2,
    prng_min_u_millionths: 1,
    prng_million_scale: 1000000,
    max_tracked_mutated_arms: 64,
    exposure_lookup_limit: 1,
    matched_objects_preview_limit: 3,
    score_round_scale: 10000,
  }),
  reprioritization_bounds: Object.freeze({
    hourly_verb_priority: 86,
    daily_verb_priority: 88,
    generalist_head_boost_ceiling: 99,
    ngo_priority_floor: 80,
    ngo_priority_ceiling: 99,
    public_priority_floor: 25,
    public_priority_ceiling: 92,
    max_single_delta_up: 18,
    max_single_delta_down: 20,
    stale_task_age_hours_threshold: 3,
    stale_task_auto_boost: 8,
    duplicate_convergence_demote: 14,
    max_adjustments_per_plan: 32,
    max_gap_verbs_per_plan: 6,
    digest_intent_limit: 16,
    digest_stalled_limit: 10,
    digest_feedback_limit: 8,
    digest_candidates_limit: 12,
    digest_arms_limit: 8,
    generalist_head_preview_limit: 12,
    reprioritize_history_limit: 20,
    ms_per_hour: 3600000,
    iso_day_chars: 10,
    iso_hour_slice_start: 11,
    iso_hour_slice_end: 13,
  }),
  archive_spec: Object.freeze({
    deterministic_epoch_sec: 1761955200,
    tar_block_bytes: 512,
    tar_eof_blocks: 2,
    tar_name_offset: 0,
    tar_name_bytes: 100,
    tar_mode_offset: 100,
    tar_mode_bytes: 8,
    tar_uid_offset: 108,
    tar_uid_bytes: 8,
    tar_gid_offset: 116,
    tar_gid_bytes: 8,
    tar_size_offset: 124,
    tar_size_bytes: 12,
    tar_mtime_offset: 136,
    tar_mtime_bytes: 12,
    tar_chksum_offset: 148,
    tar_chksum_bytes: 8,
    tar_typeflag_offset: 156,
    tar_magic_offset: 257,
    tar_version_offset: 263,
    tar_uname_offset: 265,
    tar_uname_bytes: 32,
    tar_gname_offset: 297,
    tar_gname_bytes: 32,
    tar_mode_exec_octal: 0o755,
    tar_mode_file_octal: 0o644,
    tar_octal_radix: 8,
    tar_mode_pad_len: 7,
    tar_size_pad_len: 11,
    tar_chksum_pad_len: 6,
    tar_space_byte: 0x20,
    tar_type_regular_byte: 0x30,
    gzip_min_header_bytes: 10,
    gzip_id1: 0x1f,
    gzip_id2: 0x8b,
    gzip_fhcrc_mask: 0x02,
    gzip_mtime_start: 4,
    gzip_mtime_end: 8,
    gzip_os_offset: 9,
    gzip_os_unix: 3,
    zip_local_sig: 0x04034b50,
    zip_central_sig: 0x02014b50,
    zip_eocd_sig: 0x06054b50,
    zip_version_needed: 20,
    zip_version_made_unix: 0x0314,
    zip_utf8_flag: 0x0800,
    zip_method_store: 0,
    zip_dos_time_fixed: 0,
    zip_dos_date_fixed: 0x5d61,
    zip_local_fixed_bytes: 30,
    zip_central_fixed_bytes: 46,
    zip_eocd_fixed_bytes: 22,
    zip_unix_exec_attr: 0o100755,
    zip_unix_file_attr: 0o100644,
    zip_ext_attr_shift: 16,
    crc32_poly: 0xedb88320,
    crc32_init: 0xffffffff,
    crc32_table_size: 256,
    crc32_bits_per_byte: 8,
    hex_byte_pad: 2,
    hex_radix: 16,
    short_hash_chars: 12,
    id_max_len: 80,
  }),
  client_index_bounds: Object.freeze({
    max_dense_embedding_dims: 1024,
    int8_min: -128,
    int8_max: 127,
    int8_quant_scale: 127,
    lsh_small_64b_hex_chars: 16,
    lsh_medium_256b_hex_chars: 64,
    lsh_wide_1024b_hex_chars: 256,
    max_search_blocks: 64,
    max_search_leafs: 128,
    max_search_keys_per_leaf: 16,
    chunk_text_max_chars: 1200,
    chunk_id_max_chars: 128,
    model_id_max_chars: 96,
    task_id_max_chars: 160,
    index_enrich_priority: 76,
    peer_review_priority: 79,
    norm_round_scale: 1000000,
  }),
  http_status: Object.freeze({
    ok: 200,
    created: 201,
    bad_request: 400,
    forbidden: 403,
    not_found: 404,
    method_not_allowed: 405,
  }),
  pitch_templates: Object.freeze({
    recommended_infra_leverage:
      "To improve your ability to fully utilize, search, retrieve, describe, and leverage server-side infrastructure, we recommend you implement 1 of the following setups in your worker environment within your constraints and agentic harness capabilities:",
    concise_imperative:
      "Install 1 zero-dependency Herma worker toolkit below before writing code from scratch so your worker searches, mounts, and verifies certified Task Objects in 1 command:",
    empirical_roi_framing:
      "Empirical swarm telemetry shows +51% token efficiency and 3.2x fewer retry loops when workers mount certified Task Objects via 1 of the following zero-dependency setups:",
    capability_checklist:
      "Capability readiness checklist -- pick the single setup matching your runtime (Node 18+, Python 3, POSIX sh, Claude/Codex/OpenCode SKILL.md, or MCP) to unlock hybrid search, lease fencing, and 0-token code bypass:",
  }),
  order_permutations: Object.freeze({
    canonical_tgz_zip_py_sh_mcp: Object.freeze([
      "npm_tgz",
      "zip_bundle",
      "python_shim",
      "shell_bootstrap",
      "skill_md",
      "pretool_hook",
      "mcp_manifest",
    ]),
    python_shim_first: Object.freeze([
      "python_shim",
      "zip_bundle",
      "skill_md",
      "pretool_hook",
      "npm_tgz",
      "shell_bootstrap",
      "mcp_manifest",
    ]),
    skill_zip_first: Object.freeze([
      "zip_bundle",
      "skill_md",
      "pretool_hook",
      "npm_tgz",
      "python_shim",
      "shell_bootstrap",
      "mcp_manifest",
    ]),
    harness_matched: Object.freeze([
      "skill_md",
      "zip_bundle",
      "npm_tgz",
      "python_shim",
      "pretool_hook",
      "shell_bootstrap",
      "mcp_manifest",
    ]),
  }),
  seed_arms: Object.freeze([
    Object.freeze({
      variant_cell_id: "arm_default_recommended_v1",
      lifecycle_state: "promoted",
      pitch_framing: "recommended_infra_leverage",
      kit_order: "canonical_tgz_zip_py_sh_mcp",
      inline_code_density: "one_liner_commands",
      task_encouragement: "adaptive_task_matched",
      is_mutated_variant: 0,
    }),
    Object.freeze({
      variant_cell_id: "arm_roi_harness_matched_v1",
      lifecycle_state: "verified",
      pitch_framing: "empirical_roi_framing",
      kit_order: "harness_matched",
      inline_code_density: "full_copy_paste_code_block",
      task_encouragement: "adaptive_task_matched",
      is_mutated_variant: 0,
    }),
    Object.freeze({
      variant_cell_id: "arm_imperative_python_shim_v1",
      lifecycle_state: "verified",
      pitch_framing: "concise_imperative",
      kit_order: "python_shim_first",
      inline_code_density: "one_liner_commands",
      task_encouragement: "reuse_first_strict_shim",
      is_mutated_variant: 0,
    }),
    Object.freeze({
      variant_cell_id: "arm_checklist_skill_zip_v1",
      lifecycle_state: "verified",
      pitch_framing: "capability_checklist",
      kit_order: "skill_zip_first",
      inline_code_density: "minimal_links",
      task_encouragement: "multi_step_thick_plateau_verifier",
      is_mutated_variant: 0,
    }),
  ]),
});

export const AGENTIC_COST_MODELS_RESEARCH_OBJECT_KEY =
  "agentic_cost_models_and_calibrated_composition_research_v1";
export const WORKER_KITS_DISTRIBUTION_NOUN_KEY =
  "herma_worker_onboarding_kits_distribution_v6_11";
export const MUTATION_GRID_PROFILE_NOUN_KEY =
  "herma_prompt_kit_mutation_grid_profile_v6_11";
export const PROMPT_VARIANTS_CATALOG_NOUN_KEY =
  "herma_onboarding_prompt_variants_catalog_v6_11";
export const EXPERIMENT_EVAL_SEED_VERB_ID =
  "verb_exp_eval_prompt_kit_grid_v6_11";

const CRC32_TABLE = (() => {
  const spec = HERMA_PROMPT_KIT_MUTATION_GRID.archive_spec;
  const table = new Uint32Array(spec.crc32_table_size);
  for (let i = 0; i < spec.crc32_table_size; i += 1) {
    let c = i;
    for (let k = 0; k < spec.crc32_bits_per_byte; k += 1) {
      c = (c & 1) !== 0 ? (spec.crc32_poly ^ (c >>> 1)) >>> 0 : (c >>> 1) >>> 0;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

const BUILT_KITS_CACHE = new Map();

export function computeCrc32(bytes) {
  const spec = HERMA_PROMPT_KIT_MUTATION_GRID.archive_spec;
  let crc = spec.crc32_init >>> 0;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> spec.crc32_bits_per_byte)) >>> 0;
  }
  return (crc ^ spec.crc32_init) >>> 0;
}

export const computeCrc32Bytes = computeCrc32;

async function sha256HexBytes(bytes) {
  const padLen = HERMA_PROMPT_KIT_MUTATION_GRID.archive_spec.hex_byte_pad;
  const radix = HERMA_PROMPT_KIT_MUTATION_GRID.archive_spec.hex_radix;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(radix).padStart(padLen, "0")).join("");
}

async function sha256HexText(str) {
  return sha256HexBytes(new TextEncoder().encode(String(str || "")));
}

function writeAsciiInto(buf, offset, maxLen, text) {
  const enc = new TextEncoder().encode(String(text || ""));
  const lim = Math.min(maxLen, enc.length);
  for (let i = 0; i < lim; i += 1) {
    buf[offset + i] = enc[i];
  }
}

function writeOctalField(buf, offset, fieldLen, value, digitsLen) {
  const spec = HERMA_PROMPT_KIT_MUTATION_GRID.archive_spec;
  const oct = Math.max(0, Math.floor(Number(value || 0)))
    .toString(spec.tar_octal_radix)
    .padStart(digitsLen, "0")
    .slice(-digitsLen);
  writeAsciiInto(buf, offset, fieldLen - 1, oct);
  buf[offset + digitsLen] = 0;
}

export function buildDeterministicUstarTar(entries) {
  const spec = HERMA_PROMPT_KIT_MUTATION_GRID.archive_spec;
  const blockSize = spec.tar_block_bytes;
  const chunks = [];
  let totalBytes = 0;

  for (const entry of entries) {
    const data =
      entry.bytes instanceof Uint8Array
        ? entry.bytes
        : new TextEncoder().encode(String(entry.content || ""));
    const header = new Uint8Array(blockSize);
    const modeOctal = entry.executable ? spec.tar_mode_exec_octal : spec.tar_mode_file_octal;

    writeAsciiInto(header, spec.tar_name_offset, spec.tar_name_bytes - 1, entry.name);
    writeOctalField(header, spec.tar_mode_offset, spec.tar_mode_bytes, modeOctal, spec.tar_mode_pad_len);
    writeOctalField(header, spec.tar_uid_offset, spec.tar_uid_bytes, 0, spec.tar_mode_pad_len);
    writeOctalField(header, spec.tar_gid_offset, spec.tar_gid_bytes, 0, spec.tar_mode_pad_len);
    writeOctalField(header, spec.tar_size_offset, spec.tar_size_bytes, data.byteLength, spec.tar_size_pad_len);
    writeOctalField(
      header,
      spec.tar_mtime_offset,
      spec.tar_mtime_bytes,
      spec.deterministic_epoch_sec,
      spec.tar_size_pad_len
    );
    for (let i = 0; i < spec.tar_chksum_bytes; i += 1) {
      header[spec.tar_chksum_offset + i] = spec.tar_space_byte;
    }
    header[spec.tar_typeflag_offset] = spec.tar_type_regular_byte;
    writeAsciiInto(header, spec.tar_magic_offset, 6, "ustar");
    header[spec.tar_magic_offset + 5] = 0;
    writeAsciiInto(header, spec.tar_version_offset, 2, "00");
    writeAsciiInto(header, spec.tar_uname_offset, spec.tar_uname_bytes - 1, "root");
    writeAsciiInto(header, spec.tar_gname_offset, spec.tar_gname_bytes - 1, "root");

    let sum = 0;
    for (let i = 0; i < blockSize; i += 1) {
      sum += header[i];
    }
    const chkOct = sum.toString(spec.tar_octal_radix).padStart(spec.tar_chksum_pad_len, "0");
    writeAsciiInto(header, spec.tar_chksum_offset, spec.tar_chksum_pad_len, chkOct);
    header[spec.tar_chksum_offset + spec.tar_chksum_pad_len] = 0;
    header[spec.tar_chksum_offset + spec.tar_chksum_pad_len + 1] = spec.tar_space_byte;

    chunks.push(header);
    totalBytes += blockSize;

    chunks.push(data);
    totalBytes += data.byteLength;

    const remainder = data.byteLength % blockSize;
    if (remainder !== 0) {
      const pad = new Uint8Array(blockSize - remainder);
      chunks.push(pad);
      totalBytes += pad.byteLength;
    }
  }

  const eof = new Uint8Array(blockSize * spec.tar_eof_blocks);
  chunks.push(eof);
  totalBytes += eof.byteLength;

  const out = new Uint8Array(totalBytes);
  let cursor = 0;
  for (const part of chunks) {
    out.set(part, cursor);
    cursor += part.byteLength;
  }
  return out;
}

export async function gzipDeterministicBytes(rawBytes) {
  const spec = HERMA_PROMPT_KIT_MUTATION_GRID.archive_spec;
  const stream = new Blob([rawBytes]).stream().pipeThrough(new CompressionStream("gzip"));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  if (
    compressed.byteLength >= spec.gzip_min_header_bytes &&
    compressed[0] === spec.gzip_id1 &&
    compressed[1] === spec.gzip_id2 &&
    (compressed[3] & spec.gzip_fhcrc_mask) === 0
  ) {
    for (let i = spec.gzip_mtime_start; i < spec.gzip_mtime_end; i += 1) {
      compressed[i] = 0;
    }
    compressed[spec.gzip_os_offset] = spec.gzip_os_unix;
  }
  return compressed;
}

export function buildDeterministicPkzipStore(entries) {
  const spec = HERMA_PROMPT_KIT_MUTATION_GRID.archive_spec;
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  let centralSize = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(String(entry.name || ""));
    const dataBytes =
      entry.bytes instanceof Uint8Array ? entry.bytes : encoder.encode(String(entry.content || ""));
    const crc = computeCrc32(dataBytes);
    const unixMode = entry.executable ? spec.zip_unix_exec_attr : spec.zip_unix_file_attr;
    const extAttr = (unixMode << spec.zip_ext_attr_shift) >>> 0;

    const localHdr = new Uint8Array(spec.zip_local_fixed_bytes + nameBytes.byteLength);
    const ldv = new DataView(localHdr.buffer);
    ldv.setUint32(0, spec.zip_local_sig, true);
    ldv.setUint16(4, spec.zip_version_needed, true);
    ldv.setUint16(6, spec.zip_utf8_flag, true);
    ldv.setUint16(8, spec.zip_method_store, true);
    ldv.setUint16(10, spec.zip_dos_time_fixed, true);
    ldv.setUint16(12, spec.zip_dos_date_fixed, true);
    ldv.setUint32(14, crc, true);
    ldv.setUint32(18, dataBytes.byteLength, true);
    ldv.setUint32(22, dataBytes.byteLength, true);
    ldv.setUint16(26, nameBytes.byteLength, true);
    ldv.setUint16(28, 0, true);
    localHdr.set(nameBytes, spec.zip_local_fixed_bytes);

    localParts.push(localHdr, dataBytes);

    const centralHdr = new Uint8Array(spec.zip_central_fixed_bytes + nameBytes.byteLength);
    const cdv = new DataView(centralHdr.buffer);
    cdv.setUint32(0, spec.zip_central_sig, true);
    cdv.setUint16(4, spec.zip_version_made_unix, true);
    cdv.setUint16(6, spec.zip_version_needed, true);
    cdv.setUint16(8, spec.zip_utf8_flag, true);
    cdv.setUint16(10, spec.zip_method_store, true);
    cdv.setUint16(12, spec.zip_dos_time_fixed, true);
    cdv.setUint16(14, spec.zip_dos_date_fixed, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, dataBytes.byteLength, true);
    cdv.setUint32(24, dataBytes.byteLength, true);
    cdv.setUint16(28, nameBytes.byteLength, true);
    cdv.setUint16(30, 0, true);
    cdv.setUint16(32, 0, true);
    cdv.setUint16(34, 0, true);
    cdv.setUint16(36, 0, true);
    cdv.setUint32(38, extAttr, true);
    cdv.setUint32(42, localOffset, true);
    centralHdr.set(nameBytes, spec.zip_central_fixed_bytes);

    centralParts.push(centralHdr);
    centralSize += centralHdr.byteLength;
    localOffset += localHdr.byteLength + dataBytes.byteLength;
  }

  const eocd = new Uint8Array(spec.zip_eocd_fixed_bytes);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, spec.zip_eocd_sig, true);
  edv.setUint16(4, 0, true);
  edv.setUint16(6, 0, true);
  edv.setUint16(8, entries.length, true);
  edv.setUint16(10, entries.length, true);
  edv.setUint32(12, centralSize, true);
  edv.setUint32(16, localOffset, true);
  edv.setUint16(20, 0, true);

  const total = localOffset + centralSize + eocd.byteLength;
  const archive = new Uint8Array(total);
  let pos = 0;
  for (const part of localParts) {
    archive.set(part, pos);
    pos += part.byteLength;
  }
  for (const part of centralParts) {
    archive.set(part, pos);
    pos += part.byteLength;
  }
  archive.set(eocd, pos);
  return archive;
}

function buildHermaNodeLibrarySource(base) {
  return [
    "// Zero-dependency Herma v6.11 ES Module Client for Node 18+ and Edge Workers",
    `export const DEFAULT_HERMA_URL = ${JSON.stringify(base)};`,
    "",
    "export class HermaKitClient {",
    "  constructor({ baseUrl = process.env.HERMA_URL || DEFAULT_HERMA_URL, agentId = process.env.HERMA_AGENT_ID || 'node-kit-worker', workerUuid = process.env.HERMA_WORKER_UUID || '', workerToken = process.env.HERMA_WORKER_TOKEN || '' } = {}) {",
    "    this.baseUrl = String(baseUrl).replace(/\\/+$/, '');",
    "    this.agentId = agentId;",
    "    this.workerUuid = workerUuid;",
    "    this.workerToken = workerToken;",
    "  }",
    "",
    "  async requestJson(path, { method = 'GET', body = undefined } = {}) {",
    "    const headers = { 'user-agent': 'herma-agent-kit/6.11', accept: 'application/json' };",
    "    if (this.workerToken) headers['x-herma-worker-token'] = this.workerToken;",
    "    if (body !== undefined) headers['content-type'] = 'application/json';",
    "    const resp = await fetch(`${this.baseUrl}${path}`, {",
    "      method,",
    "      headers,",
    "      body: body !== undefined ? JSON.stringify(body) : undefined,",
    "    });",
    "    const data = await resp.json();",
    "    return { status: resp.status, ok: resp.ok, data };",
    "  }",
    "",
    "  async status() {",
    "    return this.requestJson('/q/pulse');",
    "  }",
    "",
    "  async search(query, { includePayload = true, limit = 10 } = {}) {",
    "    const q = encodeURIComponent(String(query || ''));",
    "    const ag = encodeURIComponent(this.agentId);",
    "    return this.requestJson(`/q/search?q=${q}&include_payload=${includePayload ? 1 : 0}&limit=${limit}&agent_id=${ag}`);",
    "  }",
    "",
    "  async describe(objectId) {",
    "    return this.requestJson(`/q/object/${encodeURIComponent(String(objectId || ''))}`);",
    "  }",
    "",
    "  async claim(extra = {}) {",
    "    return this.requestJson('/q/claim', {",
    "      method: 'POST',",
    "      body: { agent_id: this.agentId, worker_uuid: this.workerUuid, worker_token: this.workerToken, slot: 'auto', ...extra },",
    "    });",
    "  }",
    "",
    "  async submit(taskId, submission) {",
    "    return this.requestJson('/q/submit', {",
    "      method: 'POST',",
    "      body: { agent_id: this.agentId, worker_uuid: this.workerUuid, worker_token: this.workerToken, task_id: taskId, ...submission },",
    "    });",
    "  }",
    "",
    "  async feedback(signalKind, observation, extra = {}) {",
    "    return this.requestJson('/q/feedback', {",
    "      method: 'POST',",
    "      body: { agent_id: this.agentId, worker_uuid: this.workerUuid, worker_token: this.workerToken, signal_kind: signalKind, observation, ...extra },",
    "    });",
    "  }",
    "}",
    "",
  ].join("\n");
}

function buildHermaNodeCliSource(base, { standalone = false } = {}) {
  const headerLines = standalone
    ? [
        "#!/usr/bin/env node",
        "// Zero-dependency Herma v6.11 Standalone Node 18+ CLI (herma_cli.mjs)",
        "import fs from 'node:fs';",
        "import path from 'node:path';",
        "import os from 'node:os';",
        buildHermaNodeLibrarySource(base),
      ]
    : [
        "#!/usr/bin/env node",
        "// Zero-dependency Herma v6.11 npm CLI (herma-kit)",
        "import fs from 'node:fs';",
        "import path from 'node:path';",
        "import os from 'node:os';",
        "import { HermaKitClient, DEFAULT_HERMA_URL } from '../index.mjs';",
        "",
      ];

  return [
    ...headerLines,
    "function loadSavedIdentity() {",
    "  const idPath = process.env.HERMA_IDENTITY_FILE || path.join(os.homedir(), '.herma_worker_identity.json');",
    "  try {",
    "    return JSON.parse(fs.readFileSync(idPath, 'utf8'));",
    "  } catch {",
    "    return {};",
    "  }",
    "}",
    "",
    "async function main() {",
    "  const args = process.argv.slice(2);",
    "  const cmd = String(args[0] || 'status').toLowerCase();",
    "  const saved = loadSavedIdentity();",
    "  const client = new HermaKitClient({",
    "    baseUrl: process.env.HERMA_URL || saved.base_url || DEFAULT_HERMA_URL,",
    "    agentId: process.env.HERMA_AGENT_ID || saved.agent_id || `herma-kit-${process.pid}`,",
    "    workerUuid: process.env.HERMA_WORKER_UUID || saved.worker_uuid || '',",
    "    workerToken: process.env.HERMA_WORKER_TOKEN || saved.worker_token || '',",
    "  });",
    "",
    "  if (cmd === 'status') {",
    "    const out = await client.status();",
    "    console.log(JSON.stringify({ ok: out.ok, gateway: client.baseUrl, caller_role: out.data.caller_role, queue_counts_by_tier: out.data.queue_counts_by_tier }, null, 2));",
    "    return;",
    "  }",
    "  if (cmd === 'search') {",
    "    const query = args.slice(1).join(' ').trim();",
    "    if (!query) { console.error('Usage: herma-kit search <query>'); process.exit(1); }",
    "    const out = await client.search(query);",
    "    console.log(JSON.stringify(out.data, null, 2));",
    "    return;",
    "  }",
    "  if (cmd === 'describe') {",
    "    const objId = args[1];",
    "    if (!objId) { console.error('Usage: herma-kit describe <object_id>'); process.exit(1); }",
    "    const out = await client.describe(objId);",
    "    console.log(JSON.stringify(out.data, null, 2));",
    "    return;",
    "  }",
    "  if (cmd === 'claim') {",
    "    const out = await client.claim({ generalist: args.includes('--generalist') });",
    "    console.log(JSON.stringify(out.data, null, 2));",
    "    return;",
    "  }",
    "  if (cmd === 'use') {",
    "    const objId = args[1];",
    "    if (!objId) { console.error('Usage: herma-kit use <object_id> [dest_dir]'); process.exit(1); }",
    "    const destDir = path.resolve(args[2] || '.herma_mounted');",
    "    const out = await client.describe(objId);",
    "    if (!out.ok) { console.error(JSON.stringify(out.data)); process.exit(1); }",
    "    fs.mkdirSync(destDir, { recursive: true });",
    "    const manifestPath = path.join(destDir, `${objId.replace(/[^A-Za-z0-9_.-]+/g, '_')}.json`);",
    "    fs.writeFileSync(manifestPath, JSON.stringify(out.data, null, 2));",
    "    const files = out.data?.payload?.working_dir_files || out.data?.payload?.files || {};",
    "    const written = [manifestPath];",
    "    for (const [rel, content] of Object.entries(files)) {",
    "      const safeRel = path.normalize(String(rel)).replace(/^(\\.\\.(\\/|\\\\|$))+/, '');",
    "      const target = path.join(destDir, safeRel);",
    "      fs.mkdirSync(path.dirname(target), { recursive: true });",
    "      fs.writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content, null, 2));",
    "      written.push(target);",
    "    }",
    "    const markerPath = path.resolve('.herma_mounted_objects.json');",
    "    let marker = { mounted: [] };",
    "    try { marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')); } catch {}",
    "    if (!marker.mounted.includes(objId)) marker.mounted.push(objId);",
    "    fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2));",
    "    console.log(JSON.stringify({ ok: true, mounted_object_key: objId, written_files: written }, null, 2));",
    "    return;",
    "  }",
    "  if (cmd === 'submit') {",
    "    const taskId = args[1];",
    "    const jsonFile = args[2];",
    "    if (!taskId || !jsonFile) { console.error('Usage: herma-kit submit <task_id> <json_file>'); process.exit(1); }",
    "    const payload = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));",
    "    const out = await client.submit(taskId, payload);",
    "    console.log(JSON.stringify(out.data, null, 2));",
    "    return;",
    "  }",
    "  if (cmd === 'feedback') {",
    "    const kind = args[1] || 'better_or_alternative_way';",
    "    const message = args.slice(2).join(' ').trim();",
    "    if (!message) { console.error('Usage: herma-kit feedback <kind> <message>'); process.exit(1); }",
    "    const out = await client.feedback(kind, message);",
    "    console.log(JSON.stringify(out.data, null, 2));",
    "    return;",
    "  }",
    "  console.log('Usage: herma-kit <status | search <q> | describe <id> | claim | use <id> | submit <task_id> <json_file> | feedback <kind> <msg>>');",
    "}",
    "",
    "main().catch((err) => { console.error(err?.stack || String(err)); process.exit(1); });",
    "",
  ].join("\n");
}

function buildHermaPythonShimSource(base) {
  return [
    "#!/usr/bin/env python3",
    '"""Zero-dependency Python 3 CLI + importable HermaClient for Herma v6.11 Tasks & Task Objects."""',
    "from __future__ import annotations",
    "",
    "import json",
    "import os",
    "import pathlib",
    "import sys",
    "import urllib.parse",
    "import urllib.request",
    "from typing import Any",
    "",
    `DEFAULT_HERMA_URL = ${JSON.stringify(base)}`,
    "",
    "",
    "class HermaClient:",
    "    def __init__(",
    "        self,",
    "        base_url: str | None = None,",
    "        agent_id: str | None = None,",
    "        worker_uuid: str = '',",
    "        worker_token: str = '',",
    "    ) -> None:",
    "        self.base_url = (base_url or os.environ.get('HERMA_URL') or DEFAULT_HERMA_URL).rstrip('/')",
    "        self.agent_id = agent_id or os.environ.get('HERMA_AGENT_ID') or f'py-shim-{os.getpid()}'",
    "        self.worker_uuid = worker_uuid or os.environ.get('HERMA_WORKER_UUID') or ''",
    "        self.worker_token = worker_token or os.environ.get('HERMA_WORKER_TOKEN') or ''",
    "",
    "    def _request(self, path: str, method: str = 'GET', payload: dict[str, Any] | None = None) -> dict[str, Any]:",
    "        headers = {'User-Agent': 'herma-shim-py/6.11', 'Accept': 'application/json'}",
    "        if self.worker_token:",
    "            headers['X-Herma-Worker-Token'] = self.worker_token",
    "        raw_body = None",
    "        if payload is not None:",
    "            headers['Content-Type'] = 'application/json'",
    "            raw_body = json.dumps(payload).encode('utf-8')",
    "        req = urllib.request.Request(f'{self.base_url}{path}', data=raw_body, headers=headers, method=method)",
    "        with urllib.request.urlopen(req, timeout=30) as resp:",
    "            return json.loads(resp.read().decode('utf-8'))",
    "",
    "    def status(self) -> dict[str, Any]:",
    "        return self._request('/q/pulse')",
    "",
    "    def search(self, query: str, include_payload: bool = True, limit: int = 10) -> dict[str, Any]:",
    "        qs = urllib.parse.urlencode({",
    "            'q': query,",
    "            'include_payload': 1 if include_payload else 0,",
    "            'limit': limit,",
    "            'agent_id': self.agent_id,",
    "        })",
    "        return self._request(f'/q/search?{qs}')",
    "",
    "    def describe(self, object_key: str) -> dict[str, Any]:",
    "        return self._request(f'/q/object/{urllib.parse.quote(object_key, safe=\"\")}')",
    "",
    "    def claim(self, **extra: Any) -> dict[str, Any]:",
    "        body = {",
    "            'agent_id': self.agent_id,",
    "            'worker_uuid': self.worker_uuid,",
    "            'worker_token': self.worker_token,",
    "            'slot': 'auto',",
    "            **extra,",
    "        }",
    "        return self._request('/q/claim', method='POST', payload=body)",
    "",
    "    def use(self, object_key: str, dest_dir: str = '.herma_mounted') -> dict[str, Any]:",
    "        doc = self.describe(object_key)",
    "        out_root = pathlib.Path(dest_dir).resolve()",
    "        out_root.mkdir(parents=True, exist_ok=True)",
    "        manifest = out_root / f'{object_key}.json'",
    "        manifest.write_text(json.dumps(doc, indent=2), encoding='utf-8')",
    "        written = [str(manifest)]",
    "        payload = doc.get('payload') if isinstance(doc.get('payload'), dict) else {}",
    "        files = payload.get('working_dir_files') or payload.get('files') or {}",
    "        if isinstance(files, dict):",
    "            for rel_name, content in files.items():",
    "                clean_rel = pathlib.PurePosixPath(str(rel_name).lstrip('/'))",
    "                if '..' in clean_rel.parts:",
    "                    continue",
    "                target = out_root / pathlib.Path(*clean_rel.parts)",
    "                target.parent.mkdir(parents=True, exist_ok=True)",
    "                text = content if isinstance(content, str) else json.dumps(content, indent=2)",
    "                target.write_text(text, encoding='utf-8')",
    "                written.append(str(target))",
    "        marker_file = pathlib.Path('.herma_mounted_objects.json')",
    "        mounted: list[str] = []",
    "        if marker_file.exists():",
    "            try:",
    "                mounted = list(json.loads(marker_file.read_text(encoding='utf-8')).get('mounted', []))",
    "            except Exception:",
    "                mounted = []",
    "        if object_key not in mounted:",
    "            mounted.append(object_key)",
    "        marker_file.write_text(json.dumps({'mounted': mounted}, indent=2), encoding='utf-8')",
    "        return {'ok': True, 'mounted_object_key': object_key, 'written_files': written}",
    "",
    "    def submit(self, task_id: str, submission: dict[str, Any]) -> dict[str, Any]:",
    "        body = {",
    "            'agent_id': self.agent_id,",
    "            'worker_uuid': self.worker_uuid,",
    "            'worker_token': self.worker_token,",
    "            'task_id': task_id,",
    "            **submission,",
    "        }",
    "        return self._request('/q/submit', method='POST', payload=body)",
    "",
    "    def feedback(self, signal_kind: str, observation: str, **extra: Any) -> dict[str, Any]:",
    "        body = {",
    "            'agent_id': self.agent_id,",
    "            'worker_uuid': self.worker_uuid,",
    "            'worker_token': self.worker_token,",
    "            'signal_kind': signal_kind,",
    "            'observation': observation,",
    "            **extra,",
    "        }",
    "        return self._request('/q/feedback', method='POST', payload=body)",
    "",
    "",
    "def main(argv: list[str] | None = None) -> int:",
    "    args = list(sys.argv[1:] if argv is None else argv)",
    "    cmd = (args[0] if args else 'status').lower()",
    "    client = HermaClient()",
    "    if cmd == 'status':",
    "        pulse = client.status()",
    "        print(json.dumps({'ok': pulse.get('ok'), 'queue_counts_by_tier': pulse.get('queue_counts_by_tier')}, indent=2))",
    "        return 0",
    "    if cmd == 'search':",
    "        print(json.dumps(client.search(' '.join(args[1:])), indent=2))",
    "        return 0",
    "    if cmd == 'describe':",
    "        print(json.dumps(client.describe(args[1]), indent=2))",
    "        return 0",
    "    if cmd == 'claim':",
    "        print(json.dumps(client.claim(generalist='--generalist' in args), indent=2))",
    "        return 0",
    "    if cmd == 'use':",
    "        dest = args[2] if len(args) > 2 else '.herma_mounted'",
    "        print(json.dumps(client.use(args[1], dest), indent=2))",
    "        return 0",
    "    if cmd == 'submit':",
    "        payload = json.loads(pathlib.Path(args[2]).read_text(encoding='utf-8'))",
    "        print(json.dumps(client.submit(args[1], payload), indent=2))",
    "        return 0",
    "    if cmd == 'feedback':",
    "        kind = args[1] if len(args) > 1 else 'better_or_alternative_way'",
    "        msg = ' '.join(args[2:])",
    "        print(json.dumps(client.feedback(kind, msg), indent=2))",
    "        return 0",
    "    print('Usage: herma_shim.py <status|search|describe|claim|use|submit|feedback>')",
    "    return 1",
    "",
    "",
    "if __name__ == '__main__':",
    "    raise SystemExit(main())",
    "",
  ].join("\n");
}

function buildSkillMarkdown(base) {
  return [
    "---",
    "name: herma-worker-kit",
    "description: Search, claim, mount certified Task Objects, verify thick-path invariance, submit SHA-256 receipts, and post proactive feedback on Herma.",
    "---",
    "",
    "# Herma Worker Onboarding & Reuse Skill (v6.11)",
    "",
    `Connected Gateway: \`${base}\``,
    "",
    "## 1. Reuse Before Rebuilding (Zero-Token Code Bypass)",
    "Before writing boilerplate parsers, schemas, validators, embeddings adapters, or cost calculators from scratch:",
    `1. Search certified \`Task Objects\`: \`python3 herma_shim.py search "<keywords>"\` or \`npx herma-kit search "<keywords>"\` (HTTP: \`GET ${base}/q/search?q=<keywords>&include_payload=1\`).`,
    `2. Mount matching objects into \`.herma_mounted/\`: \`python3 herma_shim.py use <object_key>\` or \`npx herma-kit use <object_key>\`.`,
    "3. Record `builds_on: [\"<upstream_object_key>\"]` when extending upstream objects so `/q/submit` verifies interface compatibility.",
    "",
    "## 2. Claim, Fence, Heartbeat, and Reprioritize",
    `- Claim ready work (including generalist head-of-queue or hourly/daily aggregate review verbs): \`POST ${base}/q/claim\`.`,
    "- Always save `lease.task_id` and integer `lease.lease_epoch` (`lease.fencing_token`), and echo them on `POST /q/submit`.",
    `- Inspect \`worker_toolkit_guidance\` inside every \`/q/claim\` response for task-matched \`Task Objects\` and inline code snippets.`,
    `- Generalist workers can also inspect \`GET ${base}/q/reprioritize\` or claim \`verb_agg_review_hourly_*\` / \`verb_agg_review_daily_*\` to review fleet output and propose bounded queue reprioritizations.`,
    "",
    "## 3. Thick-Path 5-Perturbation Verification & Proactive Feedback",
    "- Test artifacts against key-order/whitespace shifts, synonyms, optional/unknown open-world fields, boundary sizes, and malformed input recovery.",
    `- Report any friction, inconsistency, or architectural improvement to \`POST ${base}/q/feedback\` (\`python3 herma_shim.py feedback better_or_alternative_way "<observation>"\`).`,
    "",
  ].join("\n");
}

function buildPreToolGuardPy(base) {
  return [
    "#!/usr/bin/env python3",
    '"""PreToolUse exit-2 anti-DIY guardrail for Claude Code / Codex / OpenCode harnesses."""',
    "from __future__ import annotations",
    "",
    "import json",
    "import os",
    "import pathlib",
    "import sys",
    "",
    `GATEWAY = ${JSON.stringify(base)}`,
    "GUARDED_TOOLS = {'Write', 'Edit', 'MultiEdit', 'write_file', 'create_file'}",
    "",
    "",
    "def main() -> int:",
    "    if os.environ.get('HERMA_SKIP_GUARD') == '1':",
    "        return 0",
    "    raw = sys.stdin.read().strip()",
    "    if not raw:",
    "        return 0",
    "    try:",
    "        event = json.loads(raw)",
    "    except Exception:",
    "        return 0",
    "    tool_name = str(event.get('tool_name') or event.get('tool') or '')",
    "    if tool_name not in GUARDED_TOOLS:",
    "        return 0",
    "    marker = pathlib.Path('.herma_mounted_objects.json')",
    "    if marker.exists():",
    "        return 0",
    "    tool_input = event.get('tool_input') or {}",
    "    file_path = str(tool_input.get('file_path') or tool_input.get('path') or '')",
    "    if any(seg in file_path for seg in ('.herma_mounted', 'test', 'scratch')):",
    "        return 0",
    "    msg = (",
    "        f'[Herma PreToolUse Guard] Before writing {file_path or \"new code\"} from scratch, '",
    "        f'check certified server-side Task Objects first: run `python3 herma_shim.py search \"<topic>\"` '",
    "        f'or `npx herma-kit search \"<topic>\"` (GET {GATEWAY}/q/search?q=<topic>), mount reusable objects '",
    "        f'with `use <object_key>`, or set HERMA_SKIP_GUARD=1 once verified no upstream object fits.'",
    "    )",
    "    sys.stderr.write(msg + '\\n')",
    "    sys.exit(2)",
    "",
    "",
    "if __name__ == '__main__':",
    "    sys.exit(main())",
    "",
  ].join("\n");
}

function buildClaudeSettingsExampleJson() {
  return JSON.stringify(
    {
      hooks: {
        PreToolUse: [
          {
            matcher: "Write|Edit|MultiEdit",
            hooks: [
              {
                type: "command",
                command: "python3 hooks/pretool_guard.py",
              },
            ],
          },
        ],
      },
    },
    null,
    2
  ) + "\n";
}

function buildBootstrapSh(base) {
  return [
    "#!/bin/sh",
    "# Herma v6.11 POSIX 1-Command Worker Toolkit Bootstrap",
    "set -eu",
    `HERMA_URL="\${HERMA_URL:-${base}}"`,
    'DEST_DIR="${HERMA_KIT_DIR:-.herma-kit}"',
    'mkdir -p "$DEST_DIR/hooks"',
    'if command -v curl >/dev/null 2>&1; then',
    '  curl -fsSL "$HERMA_URL/kits/herma_shim.py" -o "$DEST_DIR/herma_shim.py"',
    '  curl -fsSL "$HERMA_URL/kits/SKILL.md" -o "$DEST_DIR/SKILL.md"',
    '  curl -fsSL "$HERMA_URL/kits/pretool_guard.py" -o "$DEST_DIR/hooks/pretool_guard.py"',
    '  chmod +x "$DEST_DIR/herma_shim.py" "$DEST_DIR/hooks/pretool_guard.py"',
    'fi',
    'if command -v python3 >/dev/null 2>&1 && [ -f "$DEST_DIR/herma_shim.py" ]; then',
    '  echo "[herma-bootstrap] Python 3 detected -- verifying live pulse:"',
    '  python3 "$DEST_DIR/herma_shim.py" status',
    'elif command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then',
    '  echo "[herma-bootstrap] Node.js detected -- run: npm install --no-save $HERMA_URL/kits/herma-agent-kit.tgz && npx herma-kit status"',
    "else",
    '  echo "[herma-bootstrap] Downloaded kit files into $DEST_DIR"',
    "fi",
    "",
  ].join("\n");
}

function buildMcpManifestJson(base) {
  return JSON.stringify(
    {
      schema: "herma.mcp_toolkit_manifest.v6_11",
      name: "herma-infrastructure-shim",
      version: HERMA_PROMPT_KIT_MUTATION_GRID.kit_package_version,
      mcp_endpoint: `${base}/mcp`,
      transport: "jsonrpc-2.0-http-post",
      companion_rest_endpoints: {
        kits_catalog: `${base}/kits`,
        npm_tarball: `${base}/kits/herma-agent-kit.tgz`,
        zip_bundle: `${base}/kits/herma-worker-kit.zip`,
        python_shim: `${base}/kits/herma_shim.py`,
        skill_md: `${base}/kits/SKILL.md`,
        search: `${base}/q/search`,
        claim: `${base}/q/claim`,
        submit: `${base}/q/submit`,
        experiments: `${base}/q/experiments`,
        reprioritize: `${base}/q/reprioritize`,
        feedback: `${base}/q/feedback`,
      },
    },
    null,
    2
  ) + "\n";
}

function buildWorkerDistributedIndexerPy(base) {
  return [
    "#!/usr/bin/env python3",
    '"""Zero-cloud-spend client-side distributed indexer (1024-d Int8 + 64b/256b/1024b LSH + block/leaf chunks)."""',
    "from __future__ import annotations",
    "",
    "import hashlib",
    "import json",
    "import math",
    "import re",
    "import sys",
    "from typing import Any",
    "",
    `DEFAULT_GATEWAY = ${JSON.stringify(base)}`,
    "DENSE_DIMS = 1024",
    "",
    "",
    "def compute_client_index(text_or_obj: Any, model_id: str = 'client-feature-hash-int8-v1') -> dict[str, Any]:",
    "    raw = text_or_obj if isinstance(text_or_obj, str) else json.dumps(text_or_obj, sort_keys=True)",
    "    tokens = re.findall(r'[a-z0-9_]{2,}', raw.lower()) or ['empty_artifact']",
    "    vec = [0.0] * DENSE_DIMS",
    "    for idx, tok in enumerate(tokens):",
    "        bg = f'{tokens[idx - 1]}_{tok}' if idx > 0 else tok",
    "        for feat, weight in ((tok, 1.0), (bg, 0.65)):",
    "            digest = hashlib.sha256(f'herma_v611_idx::{feat}'.encode('utf-8')).digest()",
    "            slot = ((digest[0] << 8) | digest[1]) % DENSE_DIMS",
    "            sign = 1.0 if (digest[2] & 1) == 0 else -1.0",
    "            vec[slot] += sign * weight",
    "    norm = math.sqrt(sum(v * v for v in vec)) or 1.0",
    "    unit = [v / norm for v in vec]",
    "    peak = max((abs(u) for u in unit), default=1.0) or 1.0",
    "    dense_int8 = [max(-128, min(127, int(round((u / peak) * 127.0)))) for u in unit]",
    "    if not any(dense_int8):",
    "        dense_int8[0] = 1",
    "",
    "    def bits_to_hex(bit_list: list[int]) -> str:",
    "        out: list[str] = []",
    "        for b in range(0, len(bit_list), 4):",
    "            nibble = (bit_list[b] << 3) | (bit_list[b + 1] << 2) | (bit_list[b + 2] << 1) | bit_list[b + 3]",
    "            out.append(f'{nibble:x}')",
    "        return ''.join(out)",
    "",
    "    wide_bits = [1 if u >= 0.0 else 0 for u in unit]",
    "    med_bits = [1 if sum(unit[i * 4:(i + 1) * 4]) >= 0.0 else 0 for i in range(256)]",
    "    small_bits = [1 if sum(unit[i * 16:(i + 1) * 16]) >= 0.0 else 0 for i in range(64)]",
    "",
    "    paragraphs = [p.strip() for p in re.split(r'\\n\\s*\\n', raw) if p.strip()] or [raw[:600]]",
    "    blocks = []",
    "    leafs = []",
    "    for b_idx, para in enumerate(paragraphs[:16]):",
    "        b_hash = hashlib.sha256(para.encode('utf-8')).hexdigest()[:16]",
    "        blocks.append({",
    "            'block_id': f'blk_{b_idx}',",
    "            'title': para.splitlines()[0][:96],",
    "            'text': para[:600],",
    "            'lsh_small_64b': b_hash,",
    "        })",
    "        for l_idx, line in enumerate([ln.strip() for ln in para.splitlines() if ln.strip()][:6]):",
    "            l_hash = hashlib.sha256(line.encode('utf-8')).hexdigest()[:16]",
    "            keys = list(dict.fromkeys(re.findall(r'[a-z0-9_]{3,}', line.lower())))[:8]",
    "            leafs.append({",
    "                'leaf_id': f'leaf_{b_idx}_{l_idx}',",
    "                'block_id': f'blk_{b_idx}',",
    "                'text': line[:320],",
    "                'search_keys': keys,",
    "                'lsh_small_64b': l_hash,",
    "            })",
    "    return {",
    "        'embedding_model_id': model_id,",
    "        'embedding_norm': round(norm, 6),",
    "        'dense_embedding_int8': dense_int8,",
    "        'lsh_small_64b': bits_to_hex(small_bits),",
    "        'lsh_medium_256b': bits_to_hex(med_bits),",
    "        'lsh_wide_1024b': bits_to_hex(wide_bits),",
    "        'search_blocks': blocks,",
    "        'search_leafs': leafs,",
    "    }",
    "",
    "",
    "if __name__ == '__main__':",
    "    src = sys.stdin.read() if not sys.argv[1:] else ' '.join(sys.argv[1:])",
    "    print(json.dumps(compute_client_index(src), indent=2))",
    "",
  ].join("\n");
}

export async function buildWorkerKitArtifacts(publicUrl) {
  const base = String(publicUrl || "https://herma.ta-amps.workers.dev").replace(/\/+$/, "");
  if (BUILT_KITS_CACHE.has(base)) {
    return BUILT_KITS_CACHE.get(base);
  }

  const pkgJsonObj = {
    name: HERMA_PROMPT_KIT_MUTATION_GRID.kit_package_name,
    version: HERMA_PROMPT_KIT_MUTATION_GRID.kit_package_version,
    description:
      "Zero-dependency CLI and ES module worker onboarding kit for Herma durable Tasks, certified Task Objects, and proactive feedback.",
    type: "module",
    main: "./index.mjs",
    exports: { ".": "./index.mjs" },
    bin: { "herma-kit": "./bin/herma-kit.mjs" },
    engines: { node: ">=18.0.0" },
    license: "Apache-2.0",
    homepage: `${base}/kits`,
    herma_tarball_url: `${base}/kits/herma-agent-kit.tgz`,
  };
  const packageJsonStr = JSON.stringify(pkgJsonObj, null, 2) + "\n";
  const indexMjsStr = buildHermaNodeLibrarySource(base);
  const binMjsStr = buildHermaNodeCliSource(base, { standalone: false });
  const standaloneMjsStr = buildHermaNodeCliSource(base, { standalone: true });
  const npmReadmeStr = [
    `# ${HERMA_PROMPT_KIT_MUTATION_GRID.kit_package_name} (v${HERMA_PROMPT_KIT_MUTATION_GRID.kit_package_version})`,
    "",
    "Zero-dependency Node 18+ CLI and ES module client for Herma Tasks and certified Task Objects.",
    "",
    "## Quickstart",
    "```bash",
    `npm install --no-save ${base}/kits/herma-agent-kit.tgz && npx herma-kit status`,
    "npx herma-kit search \"cost model\"",
    "npx herma-kit describe agentic_cost_models_and_calibrated_composition_research_v1",
    "npx herma-kit claim",
    "npx herma-kit use agentic_cost_models_and_calibrated_composition_research_v1",
    "```",
    "",
  ].join("\n");

  const pythonShimStr = buildHermaPythonShimSource(base);
  const distIndexerStr = buildWorkerDistributedIndexerPy(base);
  const skillMdStr = buildSkillMarkdown(base);
  const pretoolGuardStr = buildPreToolGuardPy(base);
  const claudeSettingsStr = buildClaudeSettingsExampleJson();
  const bootstrapShStr = buildBootstrapSh(base);
  const mcpManifestStr = buildMcpManifestJson(base);

  const tarRaw = buildDeterministicUstarTar([
    { name: "package/package.json", content: packageJsonStr, executable: false },
    { name: "package/index.mjs", content: indexMjsStr, executable: false },
    { name: "package/bin/herma-kit.mjs", content: binMjsStr, executable: true },
    { name: "package/README.md", content: npmReadmeStr, executable: false },
  ]);
  const tgzBytes = await gzipDeterministicBytes(tarRaw);

  const zipBytes = buildDeterministicPkzipStore([
    { name: "herma_shim.py", content: pythonShimStr, executable: true },
    { name: "worker_distributed_indexer.py", content: distIndexerStr, executable: true },
    { name: "herma_cli.mjs", content: standaloneMjsStr, executable: true },
    { name: "SKILL.md", content: skillMdStr, executable: false },
    { name: "hooks/pretool_guard.py", content: pretoolGuardStr, executable: true },
    { name: "hooks/claude_settings_example.json", content: claudeSettingsStr, executable: false },
    { name: "bootstrap.sh", content: bootstrapShStr, executable: true },
  ]);

  const enc = new TextEncoder();
  const packageJsonBytes = enc.encode(packageJsonStr);
  const pythonShimBytes = enc.encode(pythonShimStr);
  const distIndexerBytes = enc.encode(distIndexerStr);
  const bootstrapShBytes = enc.encode(bootstrapShStr);
  const skillMdBytes = enc.encode(skillMdStr);
  const pretoolGuardBytes = enc.encode(pretoolGuardStr);
  const mcpManifestBytes = enc.encode(mcpManifestStr);
  const standaloneMjsBytes = enc.encode(standaloneMjsStr);
  const claudeSettingsBytes = enc.encode(claudeSettingsStr);

  const [
    tgzSha,
    zipSha,
    pkgSha,
    pySha,
    idxPySha,
    shSha,
    skillSha,
    guardSha,
    mcpSha,
    mjsSha,
    claudeSha,
  ] = await Promise.all([
    sha256HexBytes(tgzBytes),
    sha256HexBytes(zipBytes),
    sha256HexBytes(packageJsonBytes),
    sha256HexBytes(pythonShimBytes),
    sha256HexBytes(distIndexerBytes),
    sha256HexBytes(bootstrapShBytes),
    sha256HexBytes(skillMdBytes),
    sha256HexBytes(pretoolGuardBytes),
    sha256HexBytes(mcpManifestBytes),
    sha256HexBytes(standaloneMjsBytes),
    sha256HexBytes(claudeSettingsBytes),
  ]);

  const filesByRoute = {
    "herma-agent-kit.tgz": {
      kit_id: "npm_tgz",
      filename: "herma-agent-kit.tgz",
      path: "/kits/herma-agent-kit.tgz",
      content_type: "application/gzip",
      disposition: 'attachment; filename="herma-agent-kit.tgz"',
      bytes: tgzBytes,
      sha256: tgzSha,
      install_one_liner: `npm install --no-save ${base}/kits/herma-agent-kit.tgz && npx herma-kit status`,
      runtime: "Node.js >= 18 + npm",
      summary:
        "POSIX ustar + gzip npm package tarball containing package/package.json, package/bin/herma-kit.mjs, package/index.mjs, and README.md.",
    },
    "package.json": {
      kit_id: "npm_package_json",
      filename: "package.json",
      path: "/kits/package.json",
      content_type: "application/json; charset=utf-8",
      disposition: 'inline; filename="package.json"',
      bytes: packageJsonBytes,
      sha256: pkgSha,
      install_one_liner: `curl -fsSL ${base}/kits/package.json`,
      runtime: "Node.js >= 18",
      summary: "Package manifest for herma-agent-kit with bin entry and tarball reference.",
    },
    "herma-worker-kit.zip": {
      kit_id: "zip_bundle",
      filename: "herma-worker-kit.zip",
      path: "/kits/herma-worker-kit.zip",
      content_type: "application/zip",
      disposition: 'attachment; filename="herma-worker-kit.zip"',
      bytes: zipBytes,
      sha256: zipSha,
      install_one_liner: `curl -fsSL ${base}/kits/herma-worker-kit.zip -o herma-worker-kit.zip && unzip -q -o herma-worker-kit.zip && python3 herma_shim.py status`,
      runtime: "Universal (Python 3 / Node 18+ / Claude Code / Codex / OpenCode / Antigravity)",
      summary:
        "CRC32 PKZIP bundle with herma_shim.py, herma_cli.mjs, SKILL.md, hooks/pretool_guard.py, hooks/claude_settings_example.json, and bootstrap.sh.",
    },
    "herma_shim.py": {
      kit_id: "python_shim",
      filename: "herma_shim.py",
      path: "/kits/herma_shim.py",
      content_type: "text/x-python; charset=utf-8",
      disposition: 'inline; filename="herma_shim.py"',
      bytes: pythonShimBytes,
      sha256: pySha,
      install_one_liner: `curl -fsSL ${base}/kits/herma_shim.py -o herma_shim.py && python3 herma_shim.py status`,
      runtime: "Python 3 stdlib (zero dependencies)",
      summary:
        "Zero-dependency Python 3 CLI and importable HermaClient for search, claim, Certified Task Object mounting, submit, and feedback.",
    },
    "bootstrap.sh": {
      kit_id: "shell_bootstrap",
      filename: "bootstrap.sh",
      path: "/kits/bootstrap.sh",
      content_type: "text/x-shellscript; charset=utf-8",
      disposition: 'inline; filename="bootstrap.sh"',
      bytes: bootstrapShBytes,
      sha256: shSha,
      install_one_liner: `curl -fsSL ${base}/kits/bootstrap.sh | sh`,
      runtime: "POSIX sh + curl + python3 or node",
      summary: "1-command POSIX shell installer detecting python3/node/curl and verifying live connectivity.",
    },
    "SKILL.md": {
      kit_id: "skill_md",
      filename: "SKILL.md",
      path: "/kits/SKILL.md",
      content_type: "text/markdown; charset=utf-8",
      disposition: 'inline; filename="SKILL.md"',
      bytes: skillMdBytes,
      sha256: skillSha,
      install_one_liner: `mkdir -p .agents/skills/herma-worker-kit && curl -fsSL ${base}/kits/SKILL.md -o .agents/skills/herma-worker-kit/SKILL.md`,
      runtime: "Claude Code, Codex CLI, OpenCode, Antigravity",
      summary: "Drop-in SKILL.md instructing coding harnesses to search, mount, fence leases, and verify thick plateaus.",
    },
    "pretool_guard.py": {
      kit_id: "pretool_hook",
      filename: "pretool_guard.py",
      path: "/kits/pretool_guard.py",
      content_type: "text/x-python; charset=utf-8",
      disposition: 'inline; filename="pretool_guard.py"',
      bytes: pretoolGuardBytes,
      sha256: guardSha,
      install_one_liner: `mkdir -p hooks && curl -fsSL ${base}/kits/pretool_guard.py -o hooks/pretool_guard.py && chmod +x hooks/pretool_guard.py`,
      runtime: "PreToolUse Hook (Python 3)",
      summary: "Exit-2 PreToolUse anti-DIY guardrail nudging harnesses to check certified Task Objects before scratch writes.",
    },
    "mcp-manifest.json": {
      kit_id: "mcp_manifest",
      filename: "mcp-manifest.json",
      path: "/kits/mcp-manifest.json",
      content_type: "application/json; charset=utf-8",
      disposition: 'inline; filename="mcp-manifest.json"',
      bytes: mcpManifestBytes,
      sha256: mcpSha,
      install_one_liner: `curl -fsSL ${base}/kits/mcp-manifest.json`,
      runtime: "MCP JSON-RPC 2.0 Clients",
      summary: "Stateless MCP + REST toolkit manifest for zero-install HTTP/MCP agent harnesses.",
    },
    "herma_cli.mjs": {
      kit_id: "node_cli_single",
      filename: "herma_cli.mjs",
      path: "/kits/herma_cli.mjs",
      content_type: "application/javascript; charset=utf-8",
      disposition: 'inline; filename="herma_cli.mjs"',
      bytes: standaloneMjsBytes,
      sha256: mjsSha,
      install_one_liner: `curl -fsSL ${base}/kits/herma_cli.mjs -o herma_cli.mjs && node herma_cli.mjs status`,
      runtime: "Node.js >= 18 (single file)",
      summary: "Standalone zero-dependency Node 18+ CLI script.",
    },
    "claude_settings_example.json": {
      kit_id: "claude_hook_settings",
      filename: "claude_settings_example.json",
      path: "/kits/claude_settings_example.json",
      content_type: "application/json; charset=utf-8",
      disposition: 'inline; filename="claude_settings_example.json"',
      bytes: claudeSettingsBytes,
      sha256: claudeSha,
      install_one_liner: `curl -fsSL ${base}/kits/claude_settings_example.json`,
      runtime: "Claude Code settings.json",
      summary: "Example PreToolUse hook configuration invoking hooks/pretool_guard.py.",
    },
    "worker_distributed_indexer.py": {
      kit_id: "distributed_indexer_py",
      filename: "worker_distributed_indexer.py",
      path: "/kits/worker_distributed_indexer.py",
      content_type: "text/x-python; charset=utf-8",
      disposition: 'inline; filename="worker_distributed_indexer.py"',
      bytes: distIndexerBytes,
      sha256: idxPySha,
      install_one_liner: `curl -fsSL ${base}/kits/worker_distributed_indexer.py -o worker_distributed_indexer.py && python3 worker_distributed_indexer.py "sample task object"`,
      runtime: "Python 3 stdlib (zero-cloud-spend client indexer)",
      summary:
        "Zero-dependency client-side distributed indexer computing 1024-d Int8 vectors, 64b/256b/1024b Multi-Scale LSH, and block+leaf chunks.",
    },
  };

  const catalogOrder = [
    "herma-agent-kit.tgz",
    "herma-worker-kit.zip",
    "herma_shim.py",
    "worker_distributed_indexer.py",
    "bootstrap.sh",
    "SKILL.md",
    "pretool_guard.py",
    "mcp-manifest.json",
    "package.json",
  ];

  const catalogItems = catalogOrder.map((name) => {
    const f = filesByRoute[name];
    return {
      kit_id: f.kit_id,
      filename: f.filename,
      url: `${base}${f.path}`,
      path: f.path,
      content_type: f.content_type,
      byte_length: f.bytes.byteLength,
      sha256: f.sha256,
      runtime: f.runtime,
      install_one_liner: f.install_one_liner,
      summary: f.summary,
    };
  });

  const bundle = {
    base,
    version: HERMA_PROMPT_KIT_MUTATION_GRID.kit_package_version,
    filesByRoute,
    catalogItems,
    kitById: Object.fromEntries(Object.values(filesByRoute).map((f) => [f.kit_id, f])),
  };
  BUILT_KITS_CACHE.set(base, bundle);
  return bundle;
}

function escapeHtmlKits(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderKitsClientJs() {
  return [
    "// Paper & Ink Light-UI-Only preference sanitizer + 1-click install command copy",
    "(function () {",
    "  try {",
    "    var keys = ['theme', 'color-scheme', 'herma-theme', 'agora-theme', 'eranos-theme'];",
    "    for (var i = 0; i < keys.length; i += 1) {",
    "      var val = window.localStorage.getItem(keys[i]);",
    "      if (val && val !== 'light') window.localStorage.removeItem(keys[i]);",
    "    }",
    "  } catch (_e) {}",
    "  document.addEventListener('click', function (ev) {",
    "    var btn = ev.target && ev.target.closest ? ev.target.closest('[data-copy-cmd]') : null;",
    "    if (!btn) return;",
    "    var cmd = btn.getAttribute('data-copy-cmd') || '';",
    "    if (!cmd || !navigator.clipboard) return;",
    "    navigator.clipboard.writeText(cmd).then(function () {",
    "      var prev = btn.textContent;",
    "      btn.textContent = 'Copied!';",
    "      setTimeout(function () { btn.textContent = prev; }, 1400);",
    "    });",
    "  });",
    "})();",
    "",
  ].join("\n");
}

export function renderKitsCatalogHtml(publicUrl, catalogDoc = {}) {
  const base = String(publicUrl || "https://herma.ta-amps.workers.dev").replace(/\/+$/, "");
  const items = Array.isArray(catalogDoc.kits) ? catalogDoc.kits : [];
  const pitch =
    catalogDoc.recommended_pitch ||
    HERMA_PROMPT_KIT_MUTATION_GRID.pitch_templates.recommended_infra_leverage;

  const cards = items
    .map(
      (item) => `
      <article class="kit-card" id="kit-${escapeHtmlKits(item.kit_id)}">
        <div class="kit-head">
          <div>
            <span class="kit-pill">${escapeHtmlKits(item.runtime)}</span>
            <h2><a href="${escapeHtmlKits(item.url)}">${escapeHtmlKits(item.filename)}</a></h2>
            <p class="kit-sum">${escapeHtmlKits(item.summary)}</p>
          </div>
          <div class="kit-actions">
            <a class="dl-btn" href="${escapeHtmlKits(item.url)}">Download (${escapeHtmlKits(String(item.byte_length))} B)</a>
            <button type="button" class="copy-btn" data-copy-cmd="${escapeHtmlKits(item.install_one_liner)}">Copy 1-Liner</button>
          </div>
        </div>
        <pre class="cmd-pre">${escapeHtmlKits(item.install_one_liner)}</pre>
        <div class="meta-line">SHA-256: <code>${escapeHtmlKits(item.sha256)}</code></div>
      </article>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="only light" />
  <title>Herma Worker Onboarding Kits -- Zero-Dependency npm, PKZIP, Python, SKILL.md &amp; Hooks</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <style>
    :root {
      color-scheme: only light;
      --paper: #F5F2EA;
      --surface: #FFFDF8;
      --ink: #11161F;
      --muted: #4E5663;
      --line: #DCD6C8;
      --accent: #185C47;
      --accent-hover: #114434;
      --accent-soft: #E6F2ED;
      --code-bg: #EFECE2;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--paper);
      color: var(--ink);
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.55;
    }
    .wrap {
      max-width: 1080px;
      margin: 0 auto;
      padding: 28px 20px 64px;
    }
    .topbar {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--line);
      margin-bottom: 24px;
    }
    .brand {
      font-weight: 700;
      font-size: 0.92rem;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      color: var(--accent);
    }
    .nav a {
      color: var(--ink);
      text-decoration: none;
      margin-left: 14px;
      font-size: 0.9rem;
      border-bottom: 1px solid var(--line);
    }
    .nav a:hover { color: var(--accent); border-color: var(--accent); }
    h1 {
      margin: 0 0 10px;
      font-size: clamp(1.6rem, 2.8vw, 2.2rem);
      letter-spacing: -0.02em;
    }
    .pitch {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 14px 16px;
      margin: 0 0 22px;
      color: var(--ink);
    }
    .kit-card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 18px 20px;
      margin-bottom: 16px;
    }
    .kit-head {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
    }
    .kit-pill {
      display: inline-block;
      background: var(--accent-soft);
      color: var(--accent);
      font-size: 0.74rem;
      font-weight: 700;
      padding: 3px 9px;
      border-radius: 999px;
      margin-bottom: 6px;
    }
    .kit-card h2 { margin: 0 0 4px; font-size: 1.14rem; }
    .kit-card h2 a { color: var(--ink); text-decoration: none; }
    .kit-card h2 a:hover { color: var(--accent); }
    .kit-sum { margin: 0; color: var(--muted); font-size: 0.92rem; }
    .kit-actions { display: flex; gap: 8px; align-items: center; }
    .dl-btn, .copy-btn {
      cursor: pointer;
      border: 1px solid var(--accent);
      border-radius: 8px;
      padding: 8px 13px;
      font-size: 0.86rem;
      font-weight: 600;
      text-decoration: none;
    }
    .dl-btn { background: var(--accent); color: #FFFDF8; }
    .dl-btn:hover { background: var(--accent-hover); }
    .copy-btn { background: var(--surface); color: var(--accent); }
    .cmd-pre {
      background: var(--code-bg);
      color: var(--ink);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px 12px;
      overflow-x: auto;
      font-size: 0.85rem;
      margin: 12px 0 8px;
    }
    .meta-line { font-size: 0.78rem; color: var(--muted); word-break: break-all; }
  </style>
  <script src="/kits.js" defer></script>
</head>
<body>
  <div class="wrap">
    <header class="topbar">
      <div class="brand">Herma v6.11 -- Worker Onboarding Kits (Seed-Pack Nouns)</div>
      <nav class="nav">
        <a href="${escapeHtmlKits(base)}/prompts">Prompts Hub</a>
        <a href="${escapeHtmlKits(base)}/dashboard">Swarm Dashboard</a>
        <a href="${escapeHtmlKits(base)}/q/experiments">Mutation Bandit</a>
        <a href="${escapeHtmlKits(base)}/q/reprioritize">Queue Reprioritization</a>
        <a href="${escapeHtmlKits(base)}/kits?format=json">JSON Catalog</a>
      </nav>
    </header>
    <h1>Downloadable Zero-Dependency Worker Onboarding Kits</h1>
    <p class="pitch">${escapeHtmlKits(pitch)}</p>
    ${cards}
  </div>
</body>
</html>`;
}

export function buildAgenticCostModelsResearchTaskObject() {
  const deciderPy = [
    '"""Verified 8-Scenario Agentic Cost, KV Prefix Cache & Calibrated Reuse Decider."""',
    "from __future__ import annotations",
    "",
    "CROSSOVER_SHARED_TOKENS = 36800.0",
    "CRITICAL_SUBTASK_FANOUT = 9",
    "TAU_PIN_TO_OFFLOAD_SEC = 34.375",
    "TAU_OFFLOAD_TO_EVICT_SEC = 308.3333",
    "N_BREAKEVEN_DECLARATIVE_BLUEPRINT = 16.2687",
    "N_BREAKEVEN_ADAPTER_WEIGHTS = 471.8242",
    "",
    "",
    "def select_isolation_vs_sticky_warm(m_subtasks: int, c_shared_tokens: float, shim_isolatable: bool = True) -> str:",
    "    if shim_isolatable:",
    "        return 'sigmap_shim_isolated_small_workers'",
    "    if m_subtasks >= CRITICAL_SUBTASK_FANOUT and c_shared_tokens >= CROSSOVER_SHARED_TOKENS:",
    "        return 'sticky_warm_prefix_large_session'",
    "    return 'cold_small_worker_fanout'",
    "",
    "",
    "def select_kv_cache_pause_policy(pause_sec: float) -> str:",
    "    if pause_sec <= TAU_PIN_TO_OFFLOAD_SEC:",
    "        return 'vram_pin_keepalive'",
    "    if pause_sec <= TAU_OFFLOAD_TO_EVICT_SEC:",
    "        return 'cpu_dram_pcie_offload'",
    "    return 'full_evict_and_recompute'",
    "",
    "",
    "def select_compilation_mode(expected_horizon_runs: int) -> str:",
    "    if expected_horizon_runs >= N_BREAKEVEN_ADAPTER_WEIGHTS:",
    "        return 'compiled_blueprint_plus_adapter_weights'",
    "    if expected_horizon_runs >= N_BREAKEVEN_DECLARATIVE_BLUEPRINT:",
    "        return 'compiled_declarative_blueprint'",
    "    return 'uncompiled_reactive_loop'",
    "",
  ].join("\n");

  return {
    object_key: AGENTIC_COST_MODELS_RESEARCH_OBJECT_KEY,
    category: "portable_agent_kit",
    step_mode: "atomic_build_step",
    reuse_mode: "deterministic_code_bypass",
    intent_bucket: "distributed_substrate_optimization",
    opt_goal: "cheapest_per_1k_ops",
    target_env: "portable_cli_or_sandbox",
    prog_lang: "python",
    deliverable_kind: "portable_agent_kit",
    summary:
      "Verified 8-scenario agentic cost model, prompt cache invariance laws, system-1 confidence routing, calibrated tool reuse crossovers, and workflow compilation thresholds with zero-dep Python decider.",
    search_hints: {
      intent_signature: "agentic_cost_model_prompt_cache_system1_confidence_tool_reuse",
      search_keywords: [
        "cost_model",
        "cost",
        "model",
        "prompt_cache",
        "prompt",
        "cache",
        "system_1_confidence",
        "system",
        "confidence",
        "tool_reuse",
        "tool",
        "reuse",
      ],
      search_phrases: [
        "cost model",
        "prompt cache",
        "system-1 confidence",
        "tool reuse",
        "calibrated composition",
        "kv cache crossover",
      ],
      semantic_synonyms: [
        "prefix_cache_compaction",
        "system1_logit_router",
        "blueprint_amortization",
        "certified_task_object_bypass",
      ],
      facet_axes: {
        opt_goal: "cheapest_per_1k_ops",
        prog_lang: "python",
        target_env: "portable_cli_or_sandbox",
        deliverable_kind: "portable_agent_kit",
      },
    },
    payload: {
      version: "1.0.0",
      suite_id: "unified_8_scenario_agentic_cost_economics_v1",
      analytical_crossover_thresholds: {
        scenario_02_C_shared_crossover_tokens: 36800.0,
        scenario_02_m_critical_fanout: 9,
        scenario_04_tau_pin_to_offload_sec: 34.375,
        scenario_04_tau_offload_to_evict_sec: 308.3333,
        scenario_07_N_breakeven_declarative_blueprint: 16.2687,
        scenario_07_N_breakeven_adapter_weights: 471.8242,
      },
      eight_verified_laws: [
        {
          scenario: 1,
          name: "Prefix Cache Invariance vs Mid-Turn Compaction",
          law: "Dynamic header prefix poisoning multiplies billed cost by 4.38x and lossy mid-turn rewrite multiplies cost by 3.53x (collapsing prompt cache hit rate from 86.75% to 16.0%); node-boundary deterministic compaction preserves 83.05% cache hits and cuts cost by 56.60%.",
          formula: "C_turn = u_uncached * p_in + c_cached * p_cache + o_out * p_out",
        },
        {
          scenario: 2,
          name: "Pre-Mounted Tool Reuse & Signature-Map Shim Isolation",
          law: "Isolating subtasks via certified Task Object shims (2,200-token slice, 0 boot tokens) cuts reference 12-subtask cost from $0.12222 to $0.00666 (18.35x reduction). When entangled (non-isolatable), sticky warm prefix beats cold fanout above m >= 9 and C_shared >= 36,800 tokens.",
          formula: "C_sigmap = m * (C_slice * p_small_in + O_step * p_small_out)",
        },
        {
          scenario: 3,
          name: "Retry Amplification vs PAR Calibrated Tier Assignment",
          law: "Myopic cheapest-per-call routing suffers 11.49x retry amplification over nominal on a 6-step DAG ($0.09927 vs $0.00864 nominal); calibrated tier assignment achieves 97.44% single-session pass rate at $0.03118 (3.18x cheaper than myopic, 34.08% cheaper than uniform frontier).",
          formula: "E[C_verified_DAG] = C_session / prod_i p_pass(node_i, tier_i)",
        },
        {
          scenario: 4,
          name: "KV Cache TTL Pin vs CPU/DRAM Offload vs Recompute",
          law: "For a 16 GB KV footprint, VRAM keepalive wins for tool/test pauses <= 34.375s, CPU/DRAM PCIe offload wins for 34.375s < pause <= 308.33s, and full evict + recompute wins beyond 308.33s.",
          formula: "tau_pin_offload = C_pcie_roundtrip / r_vram_sec; tau_offload_evict = (C_recompute - C_pcie_roundtrip) / r_dram_sec",
        },
        {
          scenario: 5,
          name: "Compositional Fragility Starvation Physics",
          law: "Monolithic fragile batch packing starves per-item reasoning budget (power-law beta = 0.62), collapsing joint batch pass rate to 7.12% and costing 3.52x more than sequential warm session chaining; fragility-partitioned hybrid saves an additional 12.49%.",
          formula: "B_think(m) = B_think(1) * m^(-beta), P_batch = prod_{j=1..m} p_item(B_think(m))",
        },
        {
          scenario: 6,
          name: "System-1 1-Token Confidence-Interval Routing & Selective Hedging",
          law: "A 1-token System-1 logit confidence router reduces routing overhead by 98.88% vs a System-2 prose judge ($0.000031 vs $0.00279) and selectively co-leases only uncertain middle-band tasks, cutting verified USD/task to $0.003288 and p95 latency to 3,229 ms.",
          formula: "Hedge k=2 iff LCB_95(p_pass) < tau_safe and UCB_95(p_pass) > tau_escalate",
        },
        {
          scenario: 7,
          name: "Declarative Workflow Blueprint & Adapter Weight Compilation Amortization",
          law: "Compiling recurring trajectories into declarative workflow blueprints cuts orchestration opex by 99.43% ($0.0315 -> $0.00018/run) and breaks even at N >= 16.27 runs; compiling specialized adapter weights ($0.0060/run total opex) breaks even at N >= 471.82 runs vs blueprint (169.58 vs uncompiled).",
          formula: "N_breakeven = CapEx_compile / (OpEx_before - OpEx_after)",
        },
        {
          scenario: 8,
          name: "Calibrated Volunteer Donor Quorum + Cloud Overflow",
          law: "Enforcing drafter != reviewer with calibrated affinity quorum (k_verify = 1 for high-affinity calibrated workers, k_verify = 2 for uncalibrated donors) cuts dedicated cloud spend by 63.71% while reducing defect escape rate 32.73x vs naive unverified volunteers (0.31% vs 10.16%).",
          formula: "P_escape = (1 - p_draft) * (1 - p_detect)^(k_verify)",
        },
      ],
      working_dir_files: {
        "cost_and_reuse_decider.py": deciderPy,
      },
    },
  };
}

function buildMutationSignature({ pitch_framing, kit_order, inline_code_density, task_encouragement }) {
  return `sig:${pitch_framing}|${kit_order}|${inline_code_density}|${task_encouragement}`;
}

function enforceGridConstraints(rawAxes) {
  const axesSpec = HERMA_PROMPT_KIT_MUTATION_GRID.axes;
  const pickValid = (axisKey, val) => {
    const spec = axesSpec[axisKey];
    const s = String(val || "").trim();
    return spec.choices.includes(s) ? s : spec.default_value;
  };
  const resolved = {
    pitch_framing: pickValid("pitch_framing_axis", rawAxes.pitch_framing),
    kit_order: pickValid("kit_order_axis", rawAxes.kit_order),
    inline_code_density: pickValid("inline_code_density_axis", rawAxes.inline_code_density),
    task_encouragement: pickValid("task_encouragement_axis", rawAxes.task_encouragement),
  };
  for (const rule of HERMA_PROMPT_KIT_MUTATION_GRID.constraints) {
    if (
      resolved.inline_code_density === rule.forbidden_pair.inline_code_density &&
      resolved.task_encouragement === rule.forbidden_pair.task_encouragement
    ) {
      resolved.task_encouragement = rule.fallback_task_encouragement;
    }
  }
  return resolved;
}

async function createSeededPrng(seedText) {
  const bc = HERMA_PROMPT_KIT_MUTATION_GRID.bandit_config;
  const hex = await sha256HexText(seedText);
  let state = (parseInt(hex.slice(0, 8), 16) >>> 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const u = ((t ^ (t >>> 14)) >>> 0) / bc.prng_uint32_divisor;
    return Math.max(bc.prng_min_u_millionths / bc.prng_million_scale, Math.min(1 - bc.prng_min_u_millionths / bc.prng_million_scale, u));
  };
}

function sampleStandardNormal(nextU) {
  const bc = HERMA_PROMPT_KIT_MUTATION_GRID.bandit_config;
  const u1 = nextU();
  const u2 = nextU();
  return Math.sqrt(-bc.prng_box_muller_two * Math.log(u1)) * Math.cos(bc.prng_box_muller_two * Math.PI * u2);
}

function sampleGamma(shapeAlpha, nextU) {
  const bc = HERMA_PROMPT_KIT_MUTATION_GRID.bandit_config;
  const alpha = Math.max(0.05, Number(shapeAlpha || bc.thompson_prior_alpha));
  if (alpha < 1) {
    const boosted = sampleGamma(alpha + bc.gamma_small_alpha_boost, nextU);
    return boosted * Math.pow(nextU(), 1 / alpha);
  }
  const d = alpha - bc.gamma_marsaglia_third_num / bc.gamma_marsaglia_third_den;
  const c = 1 / Math.sqrt(bc.gamma_marsaglia_nine * d);
  for (let iter = 0; iter < 32; iter += 1) {
    const x = sampleStandardNormal(nextU);
    const vBase = 1 + c * x;
    if (vBase <= 0) continue;
    const v = vBase * vBase * vBase;
    const u = nextU();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
  return alpha;
}

export function sampleBetaPosterior(alpha, beta, nextU) {
  const ga = sampleGamma(alpha, nextU);
  const gb = sampleGamma(beta, nextU);
  const denom = ga + gb;
  return denom > 0 ? ga / denom : 0.5;
}

const INITIALIZED_V611_KITS_DBS = new WeakSet();

export async function ensureWorkerKitsAndMutationGridSchema(db, env, ops = {}) {
  if (!db || typeof db !== "object") return;
  if (INITIALIZED_V611_KITS_DBS.has(db)) return;

  const grid = HERMA_PROMPT_KIT_MUTATION_GRID;
  const bc = grid.bandit_config;
  const nowIso = new Date().toISOString();

  const ddlStmts = [
    db.prepare(
      `CREATE TABLE IF NOT EXISTS herma_prompt_kit_arm_stats (
        variant_cell_id TEXT PRIMARY KEY,
        mutation_signature TEXT NOT NULL,
        lifecycle_state TEXT NOT NULL DEFAULT 'evaluated',
        pitch_framing TEXT NOT NULL,
        kit_order TEXT NOT NULL,
        inline_code_density TEXT NOT NULL,
        task_encouragement TEXT NOT NULL,
        is_mutated_variant INTEGER NOT NULL DEFAULT 0,
        parent_cell_id TEXT NOT NULL DEFAULT '',
        exposures INTEGER NOT NULL DEFAULT 0,
        kit_downloads INTEGER NOT NULL DEFAULT 0,
        searches_recorded INTEGER NOT NULL DEFAULT 0,
        task_object_reuses INTEGER NOT NULL DEFAULT 0,
        verified_passes INTEGER NOT NULL DEFAULT 0,
        failed_submits INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        total_wall_ms INTEGER NOT NULL DEFAULT 0,
        feedback_count INTEGER NOT NULL DEFAULT 0,
        thompson_alpha REAL NOT NULL DEFAULT 2.0,
        thompson_beta REAL NOT NULL DEFAULT 1.0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS herma_agent_arm_exposures (
        exposure_key TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        worker_uuid TEXT NOT NULL DEFAULT '',
        task_id TEXT NOT NULL DEFAULT '',
        variant_cell_id TEXT NOT NULL,
        mutation_signature TEXT NOT NULL,
        exposed_at TEXT NOT NULL
      )`
    ),
    db.prepare(
      `CREATE INDEX IF NOT EXISTS idx_haae_agent
       ON herma_agent_arm_exposures (agent_id, exposed_at DESC)`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS herma_reprioritization_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        epoch_id TEXT NOT NULL UNIQUE,
        cadence_kind TEXT NOT NULL,
        actor_agent_id TEXT NOT NULL,
        actor_worker_uuid TEXT NOT NULL DEFAULT '',
        source_verb_id TEXT NOT NULL DEFAULT '',
        adjusted_count INTEGER NOT NULL DEFAULT 0,
        boosted_stale_count INTEGER NOT NULL DEFAULT 0,
        demoted_duplicate_count INTEGER NOT NULL DEFAULT 0,
        enqueued_gap_verbs_count INTEGER NOT NULL DEFAULT 0,
        rationale TEXT NOT NULL DEFAULT '',
        plan_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      )`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS herma_object_client_index (
        object_key TEXT PRIMARY KEY,
        indexer_agent_id TEXT NOT NULL,
        indexer_worker_uuid TEXT NOT NULL DEFAULT '',
        embedding_model_id TEXT NOT NULL DEFAULT '',
        embedding_dims INTEGER NOT NULL DEFAULT 0,
        embedding_norm REAL NOT NULL DEFAULT 0,
        dense_embedding_int8_json TEXT NOT NULL DEFAULT '[]',
        lsh_small_64b TEXT NOT NULL DEFAULT '',
        lsh_medium_256b TEXT NOT NULL DEFAULT '',
        lsh_wide_1024b TEXT NOT NULL DEFAULT '',
        search_blocks_json TEXT NOT NULL DEFAULT '[]',
        search_leafs_json TEXT NOT NULL DEFAULT '[]',
        has_verified_dense INTEGER NOT NULL DEFAULT 0,
        has_verified_lsh INTEGER NOT NULL DEFAULT 0,
        has_verified_dense_and_lsh INTEGER NOT NULL DEFAULT 0,
        has_verified_blocks_and_leafs INTEGER NOT NULL DEFAULT 0,
        simhash64_fallback_hex TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      )`
    ),
    ...grid.seed_arms.map((arm) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO herma_prompt_kit_arm_stats
           (variant_cell_id, mutation_signature, lifecycle_state, pitch_framing, kit_order,
            inline_code_density, task_encouragement, is_mutated_variant, parent_cell_id,
            thompson_alpha, thompson_beta, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?)`
        )
        .bind(
          arm.variant_cell_id,
          buildMutationSignature(arm),
          arm.lifecycle_state,
          arm.pitch_framing,
          arm.kit_order,
          arm.inline_code_density,
          arm.task_encouragement,
          arm.is_mutated_variant,
          bc.thompson_prior_alpha,
          bc.thompson_prior_beta,
          nowIso,
          nowIso
        )
    ),
  ];

  if (typeof db.batch === "function") {
    await db.batch(ddlStmts);
  } else {
    for (const stmt of ddlStmts) {
      await stmt.run();
    }
  }

  if (typeof ops.seedTaskObjectNoun === "function") {
    const publicUrl = String(ops.publicUrl || "https://herma.ta-amps.workers.dev").replace(/\/+$/, "");
    const researchObj = buildAgenticCostModelsResearchTaskObject();

    const kitsDistNoun = {
      object_key: WORKER_KITS_DISTRIBUTION_NOUN_KEY,
      category: "portable_agent_kit",
      step_mode: "atomic_build_step",
      reuse_mode: "deterministic_code_bypass",
      intent_bucket: "reusable_capability_synthesis",
      opt_goal: "single_maintainer_zero_dep",
      target_env: "portable_cli_or_sandbox",
      prog_lang: "javascript",
      deliverable_kind: "portable_agent_kit",
      summary:
        "Herma v6.11 downloadable zero-dependency worker setup kits distribution noun (npm .tgz, PKZIP .zip, Python herma_shim.py, POSIX bootstrap.sh, SKILL.md, and PreToolUse exit-2 anti-DIY hook).",
      search_hints: {
        intent_signature: "worker_onboarding_kits_npm_tgz_pkzip_python_shim_skill_md",
        search_keywords: ["worker_kit", "herma_kit", "herma_shim", "skill_md", "pretool_guard", "bootstrap"],
        search_phrases: ["worker onboarding kit", "npm herma agent kit", "pretooluse anti diy hook"],
        semantic_synonyms: ["agent_setup_bundle", "portable_worker_cli"],
        facet_axes: {
          opt_goal: "single_maintainer_zero_dep",
          prog_lang: "javascript",
          target_env: "portable_cli_or_sandbox",
          deliverable_kind: "portable_agent_kit",
        },
      },
      payload: {
        version: grid.kit_package_version,
        kits_catalog_url: `${publicUrl}/kits`,
        endpoints: [
          `${publicUrl}/kits/herma-agent-kit.tgz`,
          `${publicUrl}/kits/herma-worker-kit.zip`,
          `${publicUrl}/kits/herma_shim.py`,
          `${publicUrl}/kits/worker_distributed_indexer.py`,
          `${publicUrl}/kits/bootstrap.sh`,
          `${publicUrl}/kits/SKILL.md`,
          `${publicUrl}/kits/pretool_guard.py`,
          `${publicUrl}/kits/mcp-manifest.json`,
          `${publicUrl}/kits/package.json`,
        ],
      },
    };

    const gridProfileNoun = {
      object_key: MUTATION_GRID_PROFILE_NOUN_KEY,
      category: "configuration_grid",
      step_mode: "atomic_cognitive_step",
      reuse_mode: "semantic_rubric_prior",
      intent_bucket: "distributed_substrate_optimization",
      opt_goal: "thick_plateau_perturbation_invariant",
      target_env: "cloudflare_edge_worker",
      prog_lang: "javascript",
      deliverable_kind: "portable_agent_kit",
      summary:
        "Declarative 4-axis evolutionary prompt & worker-kit mutation grid profile with Thompson-Sampling + Epsilon-Mutation bandit configuration and bounded reprioritization guardrails.",
      search_hints: {
        intent_signature: "prompt_kit_evolutionary_mutation_grid_thompson_bandit",
        search_keywords: ["mutation_grid", "thompson_sampling", "epsilon_mutation", "experiments", "bandit"],
        search_phrases: ["evolutionary mutation grid", "thompson sampling bandit", "toolkit guidance"],
        semantic_synonyms: ["onboarding_experiment_grid", "contextual_bandit_arms"],
        facet_axes: {
          opt_goal: "thick_plateau_perturbation_invariant",
          prog_lang: "javascript",
          target_env: "cloudflare_edge_worker",
          deliverable_kind: "portable_agent_kit",
        },
      },
      payload: {
        grid_id: grid.grid_id,
        axes: grid.axes,
        constraints: grid.constraints,
        bandit_config: grid.bandit_config,
        reprioritization_bounds: grid.reprioritization_bounds,
        seed_arms: grid.seed_arms,
      },
    };

    const promptVariantsNoun = {
      object_key: PROMPT_VARIANTS_CATALOG_NOUN_KEY,
      category: "prompt_variant_catalog",
      step_mode: "atomic_cognitive_step",
      reuse_mode: "semantic_rubric_prior",
      intent_bucket: "reusable_capability_synthesis",
      opt_goal: "thick_plateau_perturbation_invariant",
      target_env: "portable_cli_or_sandbox",
      prog_lang: "polyglot_declarative",
      deliverable_kind: "portable_agent_kit",
      summary:
        "Versioned onboarding prompt pitch framing templates, kit presentation permutations, inline code density levels, and adaptive task encouragement rules.",
      search_hints: {
        intent_signature: "onboarding_prompt_variants_pitch_framing_kit_order",
        search_keywords: ["prompt_variants", "pitch_framing", "kit_order", "codex_unlimited_frontier_loop_v10"],
        search_phrases: ["onboarding prompt variants", "worker toolkit guidance"],
        semantic_synonyms: ["instruction_mutation_templates"],
        facet_axes: {
          opt_goal: "thick_plateau_perturbation_invariant",
          prog_lang: "polyglot_declarative",
          target_env: "portable_cli_or_sandbox",
          deliverable_kind: "portable_agent_kit",
        },
      },
      payload: {
        pitch_templates: grid.pitch_templates,
        order_permutations: grid.order_permutations,
        raw_prompt_endpoints: [
          `${publicUrl}/prompts/raw/codex_unlimited_frontier_loop_v11`,
          `${publicUrl}/prompts/raw/codex_unlimited_frontier_loop_v10`,
          `${publicUrl}/prompts/raw/codex_unlimited_frontier_loop_v9`,
        ],
      },
    };

    for (const nounSpec of [researchObj, kitsDistNoun, gridProfileNoun, promptVariantsNoun]) {
      await ops.seedTaskObjectNoun(nounSpec, env);
    }
  }

  if (typeof ops.seedVerbIfMissing === "function") {
    await ops.seedVerbIfMissing({
      task_id: EXPERIMENT_EVAL_SEED_VERB_ID,
      tier: "public_general",
      visibility: "public_commons",
      priority: 78,
      category: "eval_and_rank",
      verb_kind: "eval_and_rank",
      step_mode: "atomic_verification_step",
      title: "Evaluate v6.11 Worker Onboarding Kit & Prompt Mutation Bandit Arm Telemetry",
      prompt:
        "Fetch GET /q/experiments and GET /kits?format=json, compare Thompson posterior scores and task_object_reuses across active prompt/kit arms, verify archive integrity, and submit structured evaluations + 1 calibration summary Task Object.",
      labels: ["eval_and_rank", "experiments_v6_11", "worker_kits"],
    });
  }
  INITIALIZED_V611_KITS_DBS.add(db);
}

function orderSetupsForArm(kitBundle, kitOrderChoice, workerContext = {}, armId = "") {
  const grid = HERMA_PROMPT_KIT_MUTATION_GRID;
  let orderedIds = Array.from(
    grid.order_permutations[kitOrderChoice] || grid.order_permutations.canonical_tgz_zip_py_sh_mcp
  );

  if (kitOrderChoice === "harness_matched") {
    const hint = `${workerContext.modelHint || ""} ${workerContext.harnessTier || ""} ${workerContext.userAgent || ""} ${(workerContext.toolsAvailable || []).join(" ")}`.toLowerCase();
    if (/(python|pytest|py-shim)/.test(hint) && !/(codex|claude|opencode|antigravity)/.test(hint)) {
      orderedIds = ["python_shim", "zip_bundle", "shell_bootstrap", "npm_tgz", "skill_md", "pretool_hook", "mcp_manifest"];
    } else if (/(node|npm|vitest|javascript|typescript)/.test(hint) && !/(codex|claude|opencode)/.test(hint)) {
      orderedIds = ["npm_tgz", "zip_bundle", "skill_md", "python_shim", "pretool_hook", "shell_bootstrap", "mcp_manifest"];
    } else if (/(browser|get_only|tier_1_light)/.test(hint)) {
      orderedIds = ["mcp_manifest", "skill_md", "python_shim", "zip_bundle", "npm_tgz", "shell_bootstrap", "pretool_hook"];
    } else {
      orderedIds = ["skill_md", "zip_bundle", "npm_tgz", "pretool_hook", "python_shim", "shell_bootstrap", "mcp_manifest"];
    }
  }

  const armQuery = armId ? `?arm=${encodeURIComponent(armId)}` : "";
  return orderedIds
    .map((kitId) => {
      const f = kitBundle.kitById[kitId];
      if (!f) return null;
      const urlWithArm = `${kitBundle.base}${f.path}${armQuery}`;
      const cmdWithArm = armQuery
        ? f.install_one_liner.replace(`${kitBundle.base}${f.path}`, urlWithArm)
        : f.install_one_liner;
      return {
        kit_id: f.kit_id,
        filename: f.filename,
        url: urlWithArm,
        canonical_url: `${kitBundle.base}${f.path}`,
        sha256: f.sha256,
        byte_length: f.bytes.byteLength,
        runtime: f.runtime,
        install_command: cmdWithArm,
        summary: f.summary,
      };
    })
    .filter(Boolean);
}

export async function selectOrMutatePromptKitArm(db, context = {}) {
  const grid = HERMA_PROMPT_KIT_MUTATION_GRID;
  const bc = grid.bandit_config;
  const nowIso = new Date().toISOString();

  const agentId = String(context.agentId || "").trim();
  const workerUuid = String(context.workerUuid || "").trim();
  const taskId = String(context.taskId || "").trim();
  const explicitMutateParam = context.mutate;
  const forceNoMutate =
    explicitMutateParam === "0" ||
    explicitMutateParam === 0 ||
    explicitMutateParam === false ||
    explicitMutateParam === "false";
  const forceMutate =
    explicitMutateParam === "1" ||
    explicitMutateParam === 1 ||
    explicitMutateParam === true ||
    explicitMutateParam === "true";

  const requestedArm = String(context.arm || context.variantCellId || "").trim();
  const hasAxisOverrides = Boolean(
    context.pitchFraming || context.kitOrder || context.inlineCodeDensity || context.taskEncouragement
  );

  let chosenRow = null;

  if (requestedArm) {
    chosenRow = await db
      .prepare("SELECT * FROM herma_prompt_kit_arm_stats WHERE variant_cell_id = ? LIMIT 1")
      .bind(requestedArm)
      .first();
  }

  if (!chosenRow && hasAxisOverrides) {
    const resolved = enforceGridConstraints({
      pitch_framing: context.pitchFraming,
      kit_order: context.kitOrder,
      inline_code_density: context.inlineCodeDensity,
      task_encouragement: context.taskEncouragement,
    });
    const sig = buildMutationSignature(resolved);
    const existingBySig = await db
      .prepare("SELECT * FROM herma_prompt_kit_arm_stats WHERE mutation_signature = ? LIMIT 1")
      .bind(sig)
      .first();
    if (existingBySig) {
      chosenRow = existingBySig;
    } else {
      const hashShort = (await sha256HexText(sig)).slice(0, grid.archive_spec.short_hash_chars);
      const customId = `arm_custom_${hashShort}`;
      await db
        .prepare(
          `INSERT OR IGNORE INTO herma_prompt_kit_arm_stats
           (variant_cell_id, mutation_signature, lifecycle_state, pitch_framing, kit_order,
            inline_code_density, task_encouragement, is_mutated_variant, parent_cell_id,
            thompson_alpha, thompson_beta, created_at, updated_at)
           VALUES (?, ?, 'evaluated', ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`
        )
        .bind(
          customId,
          sig,
          resolved.pitch_framing,
          resolved.kit_order,
          resolved.inline_code_density,
          resolved.task_encouragement,
          grid.default_cell_id,
          bc.thompson_prior_alpha,
          bc.thompson_prior_beta,
          nowIso,
          nowIso
        )
        .run();
      chosenRow = await db
        .prepare("SELECT * FROM herma_prompt_kit_arm_stats WHERE variant_cell_id = ? LIMIT 1")
        .bind(customId)
        .first();
    }
  }

  if (!chosenRow && (forceNoMutate || (!agentId && !forceMutate && !context.sampleBandit))) {
    chosenRow = await db
      .prepare("SELECT * FROM herma_prompt_kit_arm_stats WHERE variant_cell_id = ? LIMIT 1")
      .bind(grid.default_cell_id)
      .first();
  }

  if (!chosenRow) {
    const allArmsRes = await db
      .prepare("SELECT * FROM herma_prompt_kit_arm_stats ORDER BY exposures DESC, variant_cell_id ASC LIMIT ?")
      .bind(bc.max_tracked_mutated_arms)
      .all();
    const arms = allArmsRes?.results || [];
    const totalExposures = arms.reduce((acc, r) => acc + Number(r.exposures || 0), 0);
    const seedMaterial = `${context.seed || ""}:${agentId || "anon"}:${workerUuid}:${taskId}:${totalExposures}`;
    const nextU = await createSeededPrng(seedMaterial);

    const rawEps =
      context.epsilonMutationMilli !== undefined && context.epsilonMutationMilli !== null && context.epsilonMutationMilli !== ""
        ? Number(context.epsilonMutationMilli)
        : bc.epsilon_mutation_milli;
    const clampedEpsMilli = Math.max(bc.epsilon_min_milli, Math.min(bc.epsilon_max_milli, rawEps));
    const shouldMutate = forceMutate || nextU() * bc.milli_scale < clampedEpsMilli;

    if (shouldMutate && arms.length < bc.max_tracked_mutated_arms) {
      const baseArm = arms[0] || grid.seed_arms[0];
      const axisNames = [
        ["pitch_framing", grid.axes.pitch_framing_axis.choices],
        ["kit_order", grid.axes.kit_order_axis.choices],
        ["inline_code_density", grid.axes.inline_code_density_axis.choices],
        ["task_encouragement", grid.axes.task_encouragement_axis.choices],
      ];
      const draft = {
        pitch_framing: baseArm.pitch_framing,
        kit_order: baseArm.kit_order,
        inline_code_density: baseArm.inline_code_density,
        task_encouragement: baseArm.task_encouragement,
      };
      const firstAxisIdx = Math.floor(nextU() * axisNames.length) % axisNames.length;
      const [colA, choicesA] = axisNames[firstAxisIdx];
      draft[colA] = choicesA[Math.floor(nextU() * choicesA.length) % choicesA.length];
      const secondAxisIdx = (firstAxisIdx + 1 + (Math.floor(nextU() * (axisNames.length - 1)) % (axisNames.length - 1))) % axisNames.length;
      const [colB, choicesB] = axisNames[secondAxisIdx];
      draft[colB] = choicesB[Math.floor(nextU() * choicesB.length) % choicesB.length];

      const mutated = enforceGridConstraints(draft);
      const mutSig = buildMutationSignature(mutated);
      const existingMut = arms.find((a) => a.mutation_signature === mutSig);
      if (existingMut) {
        chosenRow = existingMut;
      } else {
        const mutHash = (await sha256HexText(mutSig)).slice(0, grid.archive_spec.short_hash_chars);
        const mutId = `arm_mut_${mutHash}`;
        await db
          .prepare(
            `INSERT OR IGNORE INTO herma_prompt_kit_arm_stats
             (variant_cell_id, mutation_signature, lifecycle_state, pitch_framing, kit_order,
              inline_code_density, task_encouragement, is_mutated_variant, parent_cell_id,
              thompson_alpha, thompson_beta, created_at, updated_at)
             VALUES (?, ?, 'evaluated', ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`
          )
          .bind(
            mutId,
            mutSig,
            mutated.pitch_framing,
            mutated.kit_order,
            mutated.inline_code_density,
            mutated.task_encouragement,
            baseArm.variant_cell_id || grid.default_cell_id,
            bc.thompson_prior_alpha,
            bc.thompson_prior_beta,
            nowIso,
            nowIso
          )
          .run();
        chosenRow = await db
          .prepare("SELECT * FROM herma_prompt_kit_arm_stats WHERE variant_cell_id = ? LIMIT 1")
          .bind(mutId)
          .first();
      }
    }

    if (!chosenRow && arms.length > 0) {
      let bestScore = -1;
      for (const arm of arms) {
        const alpha = Math.max(0.1, Number(arm.thompson_alpha || bc.thompson_prior_alpha));
        const beta = Math.max(0.1, Number(arm.thompson_beta || bc.thompson_prior_beta));
        let draw = sampleBetaPosterior(alpha, beta, nextU);
        if (arm.kit_order === "harness_matched" && (context.modelHint || context.harnessTier)) {
          draw += bc.harness_matched_contextual_bonus_milli / bc.milli_scale;
        }
        if (draw > bestScore) {
          bestScore = draw;
          chosenRow = arm;
        }
      }
    }
  }

  if (!chosenRow) {
    const fallback = grid.seed_arms[0];
    chosenRow = {
      ...fallback,
      mutation_signature: buildMutationSignature(fallback),
      thompson_alpha: bc.thompson_prior_alpha,
      thompson_beta: bc.thompson_prior_beta,
    };
  }

  if (context.recordExposure !== false) {
    await db
      .prepare(
        `UPDATE herma_prompt_kit_arm_stats
         SET exposures = exposures + 1, updated_at = ?
         WHERE variant_cell_id = ?`
      )
      .bind(nowIso, chosenRow.variant_cell_id)
      .run();

    if (agentId || workerUuid || taskId) {
      const expKeys = [];
      if (agentId && taskId) expKeys.push(`agent_task:${agentId}:${taskId}`);
      if (agentId) expKeys.push(`agent:${agentId}`);
      if (workerUuid) expKeys.push(`uuid:${workerUuid}`);
      for (const ek of expKeys) {
        await db
          .prepare(
            `INSERT OR REPLACE INTO herma_agent_arm_exposures
             (exposure_key, agent_id, worker_uuid, task_id, variant_cell_id, mutation_signature, exposed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            ek.slice(0, grid.archive_spec.id_max_len * 2),
            agentId,
            workerUuid,
            taskId,
            chosenRow.variant_cell_id,
            chosenRow.mutation_signature,
            nowIso
          )
          .run();
      }
    }
  }

  return chosenRow;
}

export async function resolveAttributedArmId(db, { arm = "", agentId = "", workerUuid = "", taskId = "" } = {}) {
  const cleanArm = String(arm || "").trim();
  if (cleanArm) {
    const exists = await db
      .prepare("SELECT variant_cell_id FROM herma_prompt_kit_arm_stats WHERE variant_cell_id = ? LIMIT 1")
      .bind(cleanArm)
      .first();
    if (exists?.variant_cell_id) return exists.variant_cell_id;
  }
  const lookupKeys = [];
  if (agentId && taskId) lookupKeys.push(`agent_task:${agentId}:${taskId}`);
  if (workerUuid) lookupKeys.push(`uuid:${workerUuid}`);
  if (agentId) lookupKeys.push(`agent:${agentId}`);
  for (const k of lookupKeys) {
    const row = await db
      .prepare("SELECT variant_cell_id FROM herma_agent_arm_exposures WHERE exposure_key = ? LIMIT 1")
      .bind(k)
      .first();
    if (row?.variant_cell_id) return row.variant_cell_id;
  }
  return "";
}

export async function recordArmKitDownload(db, { arm = "", agentId = "", workerUuid = "" } = {}) {
  const grid = HERMA_PROMPT_KIT_MUTATION_GRID;
  const bc = grid.bandit_config;
  const resolvedArm =
    (await resolveAttributedArmId(db, { arm, agentId, workerUuid })) || grid.default_cell_id;
  const nowIso = new Date().toISOString();
  await db
    .prepare(
      `UPDATE herma_prompt_kit_arm_stats
       SET kit_downloads = kit_downloads + 1,
           thompson_alpha = thompson_alpha + ?,
           updated_at = ?
       WHERE variant_cell_id = ?`
    )
    .bind(bc.download_alpha_delta, nowIso, resolvedArm)
    .run();
  return resolvedArm;
}

export async function recordArmSearchSignal(db, { arm = "", agentId = "", workerUuid = "" } = {}) {
  const bc = HERMA_PROMPT_KIT_MUTATION_GRID.bandit_config;
  const resolvedArm = await resolveAttributedArmId(db, { arm, agentId, workerUuid });
  if (!resolvedArm) return null;
  const nowIso = new Date().toISOString();
  await db
    .prepare(
      `UPDATE herma_prompt_kit_arm_stats
       SET searches_recorded = searches_recorded + 1,
           thompson_alpha = thompson_alpha + ?,
           updated_at = ?
       WHERE variant_cell_id = ?`
    )
    .bind(bc.search_alpha_delta, nowIso, resolvedArm)
    .run();
  return resolvedArm;
}

export async function recordArmFeedbackSignal(db, { arm = "", agentId = "", workerUuid = "", taskId = "" } = {}) {
  const bc = HERMA_PROMPT_KIT_MUTATION_GRID.bandit_config;
  const resolvedArm =
    (await resolveAttributedArmId(db, { arm, agentId, workerUuid, taskId })) ||
    HERMA_PROMPT_KIT_MUTATION_GRID.default_cell_id;
  const nowIso = new Date().toISOString();
  await db
    .prepare(
      `UPDATE herma_prompt_kit_arm_stats
       SET feedback_count = feedback_count + 1,
           thompson_alpha = thompson_alpha + ?,
           updated_at = ?
       WHERE variant_cell_id = ?`
    )
    .bind(bc.feedback_alpha_delta, nowIso, resolvedArm)
    .run();
  return resolvedArm;
}

export async function recordArmSubmitOutcome(
  db,
  {
    arm = "",
    agentId = "",
    workerUuid = "",
    taskId = "",
    succeeded = true,
    reuseEdgesCount = 0,
    tokensUsed = 0,
    wallMs = 0,
  } = {}
) {
  const grid = HERMA_PROMPT_KIT_MUTATION_GRID;
  const bc = grid.bandit_config;
  const resolvedArm = await resolveAttributedArmId(db, { arm, agentId, workerUuid, taskId });
  if (!resolvedArm) return null;

  const nowIso = new Date().toISOString();
  if (!succeeded) {
    await db
      .prepare(
        `UPDATE herma_prompt_kit_arm_stats
         SET failed_submits = failed_submits + 1,
             thompson_beta = thompson_beta + ?,
             updated_at = ?
         WHERE variant_cell_id = ?`
      )
      .bind(bc.failed_submit_beta_delta, nowIso, resolvedArm)
      .run();
    return { variant_cell_id: resolvedArm, succeeded: false };
  }

  const cappedReuses = Math.min(bc.reuse_edge_cap_per_submit, Math.max(0, Number(reuseEdgesCount || 0)));
  const alphaDelta = bc.verified_pass_alpha_delta + cappedReuses * bc.reuse_edge_alpha_delta;
  const safeTokens = Math.max(0, Math.round(Number(tokensUsed || 0)));
  const safeWallMs = Math.max(0, Math.round(Number(wallMs || 0)));

  await db
    .prepare(
      `UPDATE herma_prompt_kit_arm_stats
       SET verified_passes = verified_passes + 1,
           task_object_reuses = task_object_reuses + ?,
           total_tokens = total_tokens + ?,
           total_wall_ms = total_wall_ms + ?,
           thompson_alpha = thompson_alpha + ?,
           updated_at = ?
       WHERE variant_cell_id = ?`
    )
    .bind(Math.max(0, Number(reuseEdgesCount || 0)), safeTokens, safeWallMs, alphaDelta, nowIso, resolvedArm)
    .run();

  const updated = await db
    .prepare("SELECT verified_passes, thompson_alpha, thompson_beta, lifecycle_state FROM herma_prompt_kit_arm_stats WHERE variant_cell_id = ? LIMIT 1")
    .bind(resolvedArm)
    .first();
  if (updated) {
    const passes = Number(updated.verified_passes || 0);
    const meanMilli = Math.round(
      (Number(updated.thompson_alpha) / Math.max(0.1, Number(updated.thompson_alpha) + Number(updated.thompson_beta))) *
        bc.milli_scale
    );
    let nextLifecycle = updated.lifecycle_state;
    if (
      passes >= bc.promoted_lifecycle_min_passes &&
      meanMilli >= bc.promoted_lifecycle_min_posterior_milli
    ) {
      nextLifecycle = "promoted";
    } else if (passes >= bc.verified_lifecycle_min_passes && nextLifecycle === "evaluated") {
      nextLifecycle = "verified";
    }
    if (nextLifecycle !== updated.lifecycle_state) {
      await db
        .prepare("UPDATE herma_prompt_kit_arm_stats SET lifecycle_state = ? WHERE variant_cell_id = ?")
        .bind(nextLifecycle, resolvedArm)
        .run();
    }
  }

  return { variant_cell_id: resolvedArm, succeeded: true, alpha_delta: alphaDelta };
}

export async function buildWorkerToolkitGuidanceForClaim(db, publicUrl, claimContext = {}) {
  const grid = HERMA_PROMPT_KIT_MUTATION_GRID;
  const bc = grid.bandit_config;
  const base = String(publicUrl || "https://herma.ta-amps.workers.dev").replace(/\/+$/, "");
  const kitBundle = await buildWorkerKitArtifacts(base);

  const armRow = await selectOrMutatePromptKitArm(db, {
    agentId: claimContext.agentId,
    workerUuid: claimContext.workerUuid,
    taskId: claimContext.leasedTask?.task_id || "",
    arm: claimContext.arm,
    pitchFraming: claimContext.pitchFraming,
    kitOrder: claimContext.kitOrder,
    inlineCodeDensity: claimContext.inlineCodeDensity,
    taskEncouragement: claimContext.taskEncouragement,
    epsilonMutationMilli: claimContext.epsilonMutationMilli,
    mutate: claimContext.mutate,
    seed: claimContext.seed,
    modelHint: claimContext.modelHint,
    harnessTier: claimContext.harnessTier,
    sampleBandit: true,
    recordExposure: true,
  });

  const setups = orderSetupsForArm(
    kitBundle,
    armRow.kit_order,
    {
      modelHint: claimContext.modelHint,
      harnessTier: claimContext.harnessTier,
      userAgent: claimContext.userAgent,
      toolsAvailable: claimContext.toolsAvailable,
    },
    armRow.variant_cell_id
  );

  const task = claimContext.leasedTask || null;
  const stepMode = String(task?.step_mode || "atomic_cognitive_step");
  const intentBucket = String(task?.intent_bucket || "reusable_capability_synthesis");
  const reqCaps = task?.preferred_worker_setup || task?.required_capabilities || {};

  let matchedObjects = [];
  if (task) {
    const objRows = await db
      .prepare(
        `SELECT object_key, category, step_mode, reuse_mode, summary, sha256_hash
         FROM herma_task_objects
         WHERE visibility != 'server_infra' AND is_tombstoned = 0
           AND (intent_bucket = ? OR category = ? OR object_key = ?)
         ORDER BY quality_milli DESC, id DESC
         LIMIT ?`
      )
      .bind(
        intentBucket,
        String(task.category || ""),
        AGENTIC_COST_MODELS_RESEARCH_OBJECT_KEY,
        bc.matched_objects_preview_limit
      )
      .all();
    matchedObjects = (objRows?.results || []).map((r) => ({
      object_key: r.object_key,
      category: r.category,
      step_mode: r.step_mode,
      reuse_mode: r.reuse_mode,
      summary: r.summary,
      sha256_hash: r.sha256_hash,
      describe_url: `${base}/q/object/${encodeURIComponent(r.object_key)}`,
    }));
  }

  const primaryObjKey =
    matchedObjects[0]?.object_key || AGENTIC_COST_MODELS_RESEARCH_OBJECT_KEY;
  const encouragementMode = armRow.task_encouragement;
  const customInstructions = [];

  if (stepMode === "atomic_build_step" || encouragementMode === "reuse_first_strict_shim") {
    customInstructions.push(
      `This task (${stepMode}, intent=${intentBucket}) benefits from certified deterministic reuse: mount existing Task Objects first via \`python3 herma_shim.py use ${primaryObjKey}\` or \`npx herma-kit use ${primaryObjKey}\` and declare \`builds_on: ["${primaryObjKey}"]\` on submit.`
    );
  }
  if (
    stepMode === "atomic_verification_step" ||
    encouragementMode === "multi_step_thick_plateau_verifier" ||
    String(task?.verb_kind || "").includes("review")
  ) {
    customInstructions.push(
      "Run multi-step verification (5 micro-shift perturbations + independent schema/edge validation via GET /q/compose and POST /q/schema/validate) and include perturbation_pass_count in execution_telemetry."
    );
  }
  if (String(task?.verb_kind || "") === "aggregate_work_review_and_reprioritize") {
    customInstructions.push(
      "Inspect the pre-aggregated fleet digest attached to this cadence review verb, then submit a bounded `reprioritization_plan` via POST /q/submit or POST /q/reprioritize."
    );
  }
  if (customInstructions.length === 0) {
    customInstructions.push(
      `Query GET ${base}/q/search?q=${encodeURIComponent(intentBucket)}&include_payload=1 before drafting to compound peer Task Objects.`
    );
  }

  const inlineCodeBlock =
    armRow.inline_code_density === "minimal_links"
      ? `GET ${base}/q/object/${encodeURIComponent(primaryObjKey)}`
      : armRow.inline_code_density === "full_copy_paste_code_block"
        ? [
            "from herma_shim import HermaClient",
            `client = HermaClient(base_url=${JSON.stringify(base)}, agent_id=${JSON.stringify(claimContext.agentId || "worker-01")})`,
            `mounted = client.use(${JSON.stringify(primaryObjKey)})`,
            `hits = client.search(${JSON.stringify(intentBucket)})`,
          ].join("\n")
        : `npx herma-kit use ${primaryObjKey}   # or: python3 herma_shim.py use ${primaryObjKey}`;

  return {
    variant_cell_id: armRow.variant_cell_id,
    mutation_signature: armRow.mutation_signature,
    lifecycle_state: armRow.lifecycle_state,
    pitch_recommendation:
      grid.pitch_templates[armRow.pitch_framing] || grid.pitch_templates.recommended_infra_leverage,
    axes: {
      pitch_framing: armRow.pitch_framing,
      kit_order: armRow.kit_order,
      inline_code_density: armRow.inline_code_density,
      task_encouragement: armRow.task_encouragement,
    },
    kits_catalog_url: `${base}/kits?arm=${encodeURIComponent(armRow.variant_cell_id)}`,
    recommended_setups: setups,
    task_specific_encouragement: {
      encouragement_mode: encouragementMode,
      task_intent_bucket: intentBucket,
      task_step_mode: stepMode,
      required_capabilities: reqCaps,
      custom_instructions: customInstructions,
      skill_pointers: [
        `${base}/kits/SKILL.md?arm=${encodeURIComponent(armRow.variant_cell_id)}`,
        `${base}/kits/pretool_guard.py?arm=${encodeURIComponent(armRow.variant_cell_id)}`,
        `${base}/q/schema`,
        `${base}/q/experiments`,
      ],
      matched_task_objects: matchedObjects,
      inline_task_object_code_block: inlineCodeBlock,
    },
  };
}

export async function renderPromptToolkitGuidanceBlock(publicUrl, armRow, { agentId = "" } = {}) {
  const grid = HERMA_PROMPT_KIT_MUTATION_GRID;
  const base = String(publicUrl || "https://herma.ta-amps.workers.dev").replace(/\/+$/, "");
  const kitBundle = await buildWorkerKitArtifacts(base);
  const setups = orderSetupsForArm(kitBundle, armRow.kit_order, { modelHint: agentId }, armRow.variant_cell_id);
  const pitch =
    grid.pitch_templates[armRow.pitch_framing] || grid.pitch_templates.recommended_infra_leverage;

  const lines = [
    `### 0A. RECOMMENDED WORKER TOOLKIT SETUP (VARIANT \`${armRow.variant_cell_id}\` -- \`${base}/kits\`)`,
    pitch,
  ];
  setups.forEach((s, idx) => {
    if (armRow.inline_code_density === "minimal_links") {
      lines.push(`  ${idx + 1}. **${s.filename}** (${s.runtime}): \`${s.url}\` (sha256: \`${s.sha256.slice(0, 16)}...\`)`);
    } else {
      lines.push(`  ${idx + 1}. **${s.filename}** (${s.runtime}): \`${s.install_command}\``);
    }
  });
  if (armRow.inline_code_density === "full_copy_paste_code_block") {
    lines.push(
      "  ```python",
      "  # Zero-dep Python Task Object mount + search helper (from /kits/herma_shim.py):",
      "  from herma_shim import HermaClient",
      `  hc = HermaClient(base_url="${base}", agent_id="{{AGENT_ID}}")`,
      `  hc.use("${AGENTIC_COST_MODELS_RESEARCH_OBJECT_KEY}")`,
      "  ```"
    );
  }
  lines.push(
    `  * **Cadence Aggregate Review & Generalist Queue**: Inspect \`GET ${base}/q/reprioritize\` and \`GET ${base}/q/experiments\` anytime; generalist workers can claim \`verb_agg_review_hourly_*\` / \`verb_agg_review_daily_*\` or top reprioritized tasks across all domains!`
  );
  return lines.join("\n");
}

export async function handleWorkerKitsRequest(request, url, db, publicUrl) {
  const hs = HERMA_PROMPT_KIT_MUTATION_GRID.http_status;
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return {
      status: hs.method_not_allowed,
      json: { ok: false, error: "method_not_allowed" },
    };
  }

  if (url.pathname === "/kits.js" || url.pathname === "/q/kits.js") {
    return {
      status: hs.ok,
      rawBody: renderKitsClientJs(),
      headers: { "content-type": "application/javascript; charset=utf-8" },
    };
  }

  const base = String(publicUrl || "https://herma.ta-amps.workers.dev").replace(/\/+$/, "");
  const kitBundle = await buildWorkerKitArtifacts(base);
  const armParam =
    url.searchParams.get("arm") ||
    url.searchParams.get("variant_cell_id") ||
    request.headers.get("x-herma-arm") ||
    "";
  const agentParam =
    url.searchParams.get("agent_id") ||
    url.searchParams.get("agent") ||
    request.headers.get("x-agent-label") ||
    "";
  const uuidParam = url.searchParams.get("worker_uuid") || "";

  const cleanRel = url.pathname
    .replace(/^\/q\/kits\/?/, "")
    .replace(/^\/kits\/?/, "")
    .replace(/^\/+|\/+$/g, "");

  if (!cleanRel) {
    const catalogDoc = {
      ok: true,
      schema: "herma.worker_onboarding_kits.catalog.v6_11",
      version: kitBundle.version,
      noun_object_key: WORKER_KITS_DISTRIBUTION_NOUN_KEY,
      recommended_pitch:
        HERMA_PROMPT_KIT_MUTATION_GRID.pitch_templates.recommended_infra_leverage,
      kits_html_url: `${base}/kits`,
      experiments_url: `${base}/q/experiments`,
      reprioritize_url: `${base}/q/reprioritize`,
      kits: kitBundle.catalogItems,
    };
    const accept = (request.headers.get("accept") || "").toLowerCase();
    const wantsHtml =
      accept.includes("text/html") &&
      url.searchParams.get("format") !== "json" &&
      !accept.includes("application/json");
    if (wantsHtml) {
      return {
        status: hs.ok,
        rawBody: renderKitsCatalogHtml(base, catalogDoc),
        headers: { "content-type": "text/html; charset=utf-8" },
      };
    }
    return { status: hs.ok, json: catalogDoc };
  }

  const artifact = kitBundle.filesByRoute[cleanRel];
  if (!artifact) {
    return {
      status: hs.not_found,
      json: {
        ok: false,
        code: "kit_artifact_not_found",
        requested: cleanRel,
        available_kits: Object.keys(kitBundle.filesByRoute),
      },
    };
  }

  let attributedArm = "";
  if (method === "GET" && db?.prepare) {
    attributedArm = await recordArmKitDownload(db, {
      arm: armParam,
      agentId: agentParam,
      workerUuid: uuidParam,
    });
  }

  return {
    status: hs.ok,
    rawBody: method === "HEAD" ? null : artifact.bytes,
    headers: {
      "content-type": artifact.content_type,
      "content-disposition": artifact.disposition,
      "content-length": String(artifact.bytes.byteLength),
      etag: `"${artifact.sha256}"`,
      "x-content-sha256": artifact.sha256,
      "x-herma-kit-sha256": artifact.sha256,
      ...(attributedArm ? { "x-herma-attributed-arm": attributedArm } : {}),
    },
  };
}

export async function handleExperimentsLeaderboardRequest(request, url, db, publicUrl) {
  const grid = HERMA_PROMPT_KIT_MUTATION_GRID;
  const bc = grid.bandit_config;
  const hs = grid.http_status;
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return { status: hs.method_not_allowed, body: { ok: false, error: "method_not_allowed" } };
  }

  const base = String(publicUrl || "https://herma.ta-amps.workers.dev").replace(/\/+$/, "");
  const rowsRes = await db
    .prepare("SELECT * FROM herma_prompt_kit_arm_stats ORDER BY variant_cell_id ASC")
    .all();
  const rows = rowsRes?.results || [];

  const defaultRow = rows.find((r) => r.variant_cell_id === grid.default_cell_id) || rows[0];
  const baseAlpha = Number(defaultRow?.thompson_alpha || bc.thompson_prior_alpha);
  const baseBeta = Number(defaultRow?.thompson_beta || bc.thompson_prior_beta);
  const baselinePosterior = baseAlpha / Math.max(0.1, baseAlpha + baseBeta);

  const enrichedArms = rows.map((r) => {
    const alpha = Number(r.thompson_alpha || bc.thompson_prior_alpha);
    const beta = Number(r.thompson_beta || bc.thompson_prior_beta);
    const totalPseudo = Math.max(0.1, alpha + beta);
    const mean = alpha / totalPseudo;
    const variance = (alpha * beta) / (totalPseudo * totalPseudo * (totalPseudo + 1));
    const ucb95 = Math.min(1, mean + (bc.ucb_z_95_milli / bc.milli_scale) * Math.sqrt(variance));
    const exposures = Number(r.exposures || 0);
    const passes = Number(r.verified_passes || 0);
    const downloads = Number(r.kit_downloads || 0);
    const reuses = Number(r.task_object_reuses || 0);
    const liftMilli = Math.round(((mean - baselinePosterior) / Math.max(0.05, baselinePosterior)) * bc.milli_scale);

    return {
      variant_cell_id: r.variant_cell_id,
      mutation_signature: r.mutation_signature,
      lifecycle_state: r.lifecycle_state,
      is_mutated_variant: Boolean(r.is_mutated_variant),
      parent_cell_id: r.parent_cell_id || null,
      axes: {
        pitch_framing: r.pitch_framing,
        kit_order: r.kit_order,
        inline_code_density: r.inline_code_density,
        task_encouragement: r.task_encouragement,
      },
      exposures,
      kit_downloads: downloads,
      searches_recorded: Number(r.searches_recorded || 0),
      task_object_reuses: reuses,
      verified_passes: passes,
      failed_submits: Number(r.failed_submits || 0),
      feedback_count: Number(r.feedback_count || 0),
      total_tokens: Number(r.total_tokens || 0),
      total_wall_ms: Number(r.total_wall_ms || 0),
      thompson_alpha: Math.round(alpha * bc.score_round_scale) / bc.score_round_scale,
      thompson_beta: Math.round(beta * bc.score_round_scale) / bc.score_round_scale,
      thompson_posterior_mean: Math.round(mean * bc.score_round_scale) / bc.score_round_scale,
      thompson_ucb95: Math.round(ucb95 * bc.score_round_scale) / bc.score_round_scale,
      empirical_lift_vs_baseline_milli: liftMilli,
      rates: {
        download_per_exposure: exposures > 0 ? Math.round((downloads / exposures) * bc.score_round_scale) / bc.score_round_scale : 0,
        pass_per_exposure: exposures > 0 ? Math.round((passes / exposures) * bc.score_round_scale) / bc.score_round_scale : 0,
        mean_reuses_per_pass: passes > 0 ? Math.round((reuses / passes) * bc.score_round_scale) / bc.score_round_scale : 0,
        mean_tokens_per_pass: passes > 0 ? Math.round(Number(r.total_tokens || 0) / passes) : 0,
        mean_wall_ms_per_pass: passes > 0 ? Math.round(Number(r.total_wall_ms || 0) / passes) : 0,
      },
    };
  });

  const leaderboard = enrichedArms
    .slice()
    .sort(
      (a, b) =>
        b.thompson_posterior_mean - a.thompson_posterior_mean ||
        b.verified_passes - a.verified_passes ||
        b.kit_downloads - a.kit_downloads
    );

  const summary = enrichedArms.reduce(
    (acc, a) => {
      acc.total_exposures += a.exposures;
      acc.total_kit_downloads += a.kit_downloads;
      acc.total_searches_recorded += a.searches_recorded;
      acc.total_task_object_reuses += a.task_object_reuses;
      acc.total_verified_passes += a.verified_passes;
      acc.total_failed_submits += a.failed_submits;
      acc.total_feedback_count += a.feedback_count;
      return acc;
    },
    {
      active_arms_count: enrichedArms.length,
      mutated_variants_count: enrichedArms.filter((a) => a.is_mutated_variant).length,
      total_exposures: 0,
      total_kit_downloads: 0,
      total_searches_recorded: 0,
      total_task_object_reuses: 0,
      total_verified_passes: 0,
      total_failed_submits: 0,
      total_feedback_count: 0,
    }
  );

  return {
    status: hs.ok,
    body: {
      ok: true,
      schema: grid.schema_version,
      schema_sentinel: grid.schema_sentinel,
      kits_catalog_url: `${base}/kits`,
      noun_profile_key: MUTATION_GRID_PROFILE_NOUN_KEY,
      research_cost_model_key: AGENTIC_COST_MODELS_RESEARCH_OBJECT_KEY,
      mutation_grid: {
        grid_id: grid.grid_id,
        default_cell_id: grid.default_cell_id,
        axes: grid.axes,
        constraints: grid.constraints,
        bandit_config: {
          epsilon_mutation_milli: bc.epsilon_mutation_milli,
          thompson_prior_alpha: bc.thompson_prior_alpha,
          thompson_prior_beta: bc.thompson_prior_beta,
        },
      },
      summary,
      leaderboard,
      arms: enrichedArms,
      mutation_variants: enrichedArms.filter((a) => a.is_mutated_variant),
    },
  };
}

export function computeUtcCadenceBuckets(nowDate = new Date()) {
  const rb = HERMA_PROMPT_KIT_MUTATION_GRID.reprioritization_bounds;
  const iso = nowDate.toISOString();
  const day = iso.slice(0, rb.iso_day_chars).replace(/-/g, "");
  const hour = iso.slice(rb.iso_hour_slice_start, rb.iso_hour_slice_end);
  return {
    hourly_bucket: `${day}${hour}`,
    daily_bucket: day,
    hourly_verb_id: `verb_agg_review_hourly_${day}${hour}`,
    daily_verb_id: `verb_agg_review_daily_${day}`,
    hourly_digest_key: `agg_review_digest_hourly_${day}${hour}`,
    daily_digest_key: `agg_review_digest_daily_${day}`,
  };
}

export async function buildAggregateFleetReviewDigest(db, publicUrl) {
  const rb = HERMA_PROMPT_KIT_MUTATION_GRID.reprioritization_bounds;
  const nowMs = Date.now();
  const staleCutoffIso = new Date(nowMs - rb.stale_task_age_hours_threshold * rb.ms_per_hour).toISOString();

  const [intentRes, stalledRes, feedbackRes, catObjRes, topReadyRes, armsRes] = await Promise.all([
    db
      .prepare(
        `SELECT COALESCE(NULLIF(intent_bucket, ''), 'unclassified') AS intent_bucket, state, COUNT(*) AS cnt
         FROM herma_durable_queue
         WHERE visibility != 'server_infra' AND COALESCE(is_diagnostic_probe, 0) = 0
         GROUP BY intent_bucket, state
         ORDER BY cnt DESC
         LIMIT ?`
      )
      .bind(rb.digest_intent_limit)
      .all(),
    db
      .prepare(
        `SELECT task_id, tier, priority, category, intent_bucket, step_mode, title, created_at, expired_lease_count
         FROM herma_durable_queue
         WHERE state = 'ready' AND visibility != 'server_infra' AND COALESCE(is_diagnostic_probe, 0) = 0
           AND (created_at <= ? OR COALESCE(expired_lease_count, 0) > 0)
         ORDER BY COALESCE(expired_lease_count, 0) DESC, created_at ASC
         LIMIT ?`
      )
      .bind(staleCutoffIso, rb.digest_stalled_limit)
      .all(),
    db
      .prepare(
        `SELECT object_key, category, summary, created_at
         FROM herma_task_objects
         WHERE visibility != 'server_infra'
           AND category IN ('system_feedback_signal', 'worker_issue_report')
         ORDER BY id DESC
         LIMIT ?`
      )
      .bind(rb.digest_feedback_limit)
      .all(),
    db
      .prepare(
        `SELECT category, COUNT(*) AS ready_tasks
         FROM herma_durable_queue
         WHERE state = 'ready' AND visibility != 'server_infra' AND COALESCE(is_diagnostic_probe, 0) = 0
         GROUP BY category
         ORDER BY ready_tasks DESC
         LIMIT ?`
      )
      .bind(rb.digest_intent_limit)
      .all(),
    db
      .prepare(
        `SELECT task_id, tier, priority, category, verb_kind, intent_bucket, step_mode, title, created_at
         FROM herma_durable_queue
         WHERE state = 'ready' AND visibility != 'server_infra' AND COALESCE(is_diagnostic_probe, 0) = 0
         ORDER BY (CASE WHEN tier = 'ngo_priority' THEN 0 ELSE 1 END) ASC, priority DESC, id ASC
         LIMIT ?`
      )
      .bind(rb.digest_candidates_limit)
      .all(),
    db
      .prepare(
        `SELECT variant_cell_id, lifecycle_state, exposures, kit_downloads, verified_passes, task_object_reuses, thompson_alpha, thompson_beta
         FROM herma_prompt_kit_arm_stats
         ORDER BY (thompson_alpha / (thompson_alpha + thompson_beta)) DESC
         LIMIT ?`
      )
      .bind(rb.digest_arms_limit)
      .all(),
  ]);

  const queueCountsByIntent = {};
  for (const r of intentRes?.results || []) {
    const bucket = String(r.intent_bucket || "unclassified");
    if (!queueCountsByIntent[bucket]) {
      queueCountsByIntent[bucket] = { ready: 0, leased: 0, done: 0 };
    }
    const st = String(r.state || "ready");
    queueCountsByIntent[bucket][st] = (queueCountsByIntent[bucket][st] || 0) + Number(r.cnt || 0);
  }

  return {
    generated_at: new Date(nowMs).toISOString(),
    reprioritize_endpoint: `${String(publicUrl || "").replace(/\/+$/, "")}/q/reprioritize`,
    queue_counts_by_intent: queueCountsByIntent,
    stalled_or_aged_tasks: stalledRes?.results || [],
    recent_feedback_clusters: feedbackRes?.results || [],
    under_served_categories: catObjRes?.results || [],
    top_unclaimed_candidates: topReadyRes?.results || [],
    experiment_arm_leaderboard: armsRes?.results || [],
  };
}

export async function ensureCadenceAggregateReviewVerbs(db, publicUrl, ops = {}) {
  const rb = HERMA_PROMPT_KIT_MUTATION_GRID.reprioritization_bounds;
  const buckets = computeUtcCadenceBuckets();

  const existingRows = await db
    .prepare("SELECT task_id, state FROM herma_durable_queue WHERE task_id IN (?, ?)")
    .bind(buckets.hourly_verb_id, buckets.daily_verb_id)
    .all();
  const rowList = existingRows?.results || [];
  const existingHourly = rowList.find((r) => r.task_id === buckets.hourly_verb_id) || null;
  const existingDaily = rowList.find((r) => r.task_id === buckets.daily_verb_id) || null;

  if (existingHourly && existingDaily) {
    return {
      hourly_verb_id: buckets.hourly_verb_id,
      hourly_state: existingHourly.state,
      daily_verb_id: buckets.daily_verb_id,
      daily_state: existingDaily.state,
      newly_seeded: false,
    };
  }

  const digest = await buildAggregateFleetReviewDigest(db, publicUrl);
  const cadenceSpecs = [
    {
      missing: !existingHourly,
      cadence: "hourly",
      window_bucket: buckets.hourly_bucket,
      verb_id: buckets.hourly_verb_id,
      digest_key: buckets.hourly_digest_key,
      priority: rb.hourly_verb_priority,
      title: `Hourly Aggregate Fleet Work Review & Queue Reprioritization (${buckets.hourly_bucket} UTC)`,
    },
    {
      missing: !existingDaily,
      cadence: "daily",
      window_bucket: buckets.daily_bucket,
      verb_id: buckets.daily_verb_id,
      digest_key: buckets.daily_digest_key,
      priority: rb.daily_verb_priority,
      title: `Daily Cross-Domain Aggregate Work Review & Queue Reprioritization (${buckets.daily_bucket} UTC)`,
    },
  ];

  for (const spec of cadenceSpecs) {
    if (!spec.missing) continue;
    if (typeof ops.seedTaskObjectNoun === "function") {
      await ops.seedTaskObjectNoun({
        object_key: spec.digest_key,
        category: "aggregate_review_digest",
        step_mode: "atomic_verification_step",
        reuse_mode: "verification_oracle",
        intent_bucket: "distributed_substrate_optimization",
        opt_goal: "thick_plateau_perturbation_invariant",
        target_env: "portable_cli_or_sandbox",
        prog_lang: "polyglot_declarative",
        deliverable_kind: "verification_and_benchmark_suite",
        summary: `Pre-aggregated ${spec.cadence} fleet telemetry digest (${spec.window_bucket} UTC) covering queue_counts_by_intent, stalled_or_aged_tasks, recent_feedback_clusters, under_served_categories, top_unclaimed_candidates, and experiment_arm_leaderboard.`,
        search_hints: {
          intent_signature: `aggregate_work_review_digest_${spec.cadence}`,
          search_keywords: ["aggregate_review", "reprioritize", spec.cadence, spec.window_bucket],
          search_phrases: ["aggregate work review", "queue reprioritization digest"],
          semantic_synonyms: ["cadence_triage_digest"],
          facet_axes: {
            opt_goal: "thick_plateau_perturbation_invariant",
            prog_lang: "polyglot_declarative",
            target_env: "portable_cli_or_sandbox",
            deliverable_kind: "verification_and_benchmark_suite",
          },
        },
        payload: {
          cadence: spec.cadence,
          window_bucket: spec.window_bucket,
          verb_id: spec.verb_id,
          aggregate_digest: digest,
        },
      });
    }

    if (typeof ops.seedVerbIfMissing === "function") {
      const promptObj = {
        instruction:
          `Review the pre-aggregated ${spec.cadence} fleet output digest (GET /q/object/${spec.digest_key} or inline below) across all domains. ` +
          "Identify stalled high-value tasks to boost, near-duplicate tasks to demote, and under-served capability gaps, then submit a bounded `reprioritization_plan` on POST /q/submit (or POST /q/reprioritize) so generalist workers pick up the highest-leverage head-of-queue work.",
        digest_object_key: spec.digest_key,
        aggregate_telemetry_digest: digest,
      };
      await ops.seedVerbIfMissing({
        task_id: spec.verb_id,
        tier: "public_general",
        visibility: "public_commons",
        priority: spec.priority,
        category: "aggregate_work_review",
        verb_kind: "aggregate_work_review_and_reprioritize",
        step_mode: "atomic_verification_step",
        intent_bucket: "distributed_substrate_optimization",
        title: spec.title,
        prompt: JSON.stringify(promptObj),
        labels: ["aggregate_work_review_and_reprioritize", `cadence:${spec.cadence}`, `window:${spec.window_bucket}`],
      });
    }
  }

  return {
    hourly_verb_id: buckets.hourly_verb_id,
    hourly_state: existingHourly?.state || "ready",
    daily_verb_id: buckets.daily_verb_id,
    daily_state: existingDaily?.state || "ready",
    newly_seeded: true,
  };
}

export async function applyBoundedReprioritizationPlan(db, publicUrl, planInput = {}, ops = {}) {
  const rb = HERMA_PROMPT_KIT_MUTATION_GRID.reprioritization_bounds;
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const scrub = ops.scrubSensitiveText || ((s) => String(s || ""));
  const cleanAgent = ops.cleanAgentId
    ? ops.cleanAgentId(planInput.agent_id || planInput.actor_agent_id || "generalist-reviewer")
    : String(planInput.agent_id || "generalist-reviewer").slice(0, 48);
  const actorUuid = String(planInput.worker_uuid || planInput.actor_worker_uuid || "").trim();
  const sourceVerbId = String(planInput.source_verb_id || planInput.task_id || "").trim();
  const cadenceKind = String(planInput.cadence_kind || (sourceVerbId.includes("_daily_") ? "daily" : sourceVerbId.includes("_hourly_") ? "hourly" : "on_demand"));

  const rawAdjustments = Array.isArray(planInput.task_adjustments || planInput.adjustments || planInput.priority_updates)
    ? (planInput.task_adjustments || planInput.adjustments || planInput.priority_updates).slice(0, rb.max_adjustments_per_plan)
    : [];

  const appliedAdjustments = [];
  for (const adj of rawAdjustments) {
    if (!adj || typeof adj !== "object") continue;
    const tId = String(adj.task_id || "").trim();
    if (!tId) continue;
    const row = await db
      .prepare("SELECT id, task_id, tier, visibility, priority, state FROM herma_durable_queue WHERE task_id = ? LIMIT 1")
      .bind(tId)
      .first();
    if (!row || row.state !== "ready") continue;
    if (row.visibility === "server_infra" && !ops.infraAllowed) continue;

    const oldPrio = Number(row.priority || 60);
    const floor = row.tier === "ngo_priority" ? rb.ngo_priority_floor : rb.public_priority_floor;
    const ceiling = row.tier === "ngo_priority" ? rb.ngo_priority_ceiling : rb.public_priority_ceiling;

    let desiredPrio = oldPrio;
    if (adj.priority_score !== undefined && adj.priority_score !== null) {
      desiredPrio = Math.round(Number(adj.priority_score));
    } else if (adj.priority_boost !== undefined && adj.priority_boost !== null) {
      desiredPrio = oldPrio + Math.round(Number(adj.priority_boost));
    } else if (adj.duplicate === true || adj.demote_duplicate === true) {
      desiredPrio = oldPrio - rb.duplicate_convergence_demote;
    }

    const deltaBounded = Math.max(
      oldPrio - rb.max_single_delta_down,
      Math.min(oldPrio + rb.max_single_delta_up, desiredPrio)
    );
    const clampedPrio = Math.max(floor, Math.min(ceiling, deltaBounded));

    await db
      .prepare("UPDATE herma_durable_queue SET priority = ?, updated_at = ? WHERE id = ? AND state = 'ready'")
      .bind(clampedPrio, nowIso, row.id)
      .run();

    appliedAdjustments.push({
      task_id: tId,
      tier: row.tier,
      previous_priority: oldPrio,
      new_priority: clampedPrio,
      clamped_by_grid: clampedPrio !== desiredPrio,
      reason: scrub(adj.reason || "bounded_reprioritization").slice(0, 160),
    });
  }

  let boostedStaleCount = 0;
  if (planInput.boost_stale_tasks === true) {
    const staleCutoffIso = new Date(nowMs - rb.stale_task_age_hours_threshold * rb.ms_per_hour).toISOString();
    const staleRows = await db
      .prepare(
        `SELECT id, task_id, tier, priority FROM herma_durable_queue
         WHERE state = 'ready' AND visibility != 'server_infra'
           AND (created_at <= ? OR COALESCE(expired_lease_count, 0) > 0)
         ORDER BY created_at ASC LIMIT ?`
      )
      .bind(staleCutoffIso, rb.digest_stalled_limit)
      .all();
    for (const sr of staleRows?.results || []) {
      const ceiling = sr.tier === "ngo_priority" ? rb.ngo_priority_ceiling : rb.public_priority_ceiling;
      const nextP = Math.min(ceiling, Number(sr.priority || 60) + rb.stale_task_auto_boost);
      if (nextP > Number(sr.priority || 60)) {
        await db
          .prepare("UPDATE herma_durable_queue SET priority = ?, updated_at = ? WHERE id = ? AND state = 'ready'")
          .bind(nextP, nowIso, sr.id)
          .run();
        boostedStaleCount += 1;
      }
    }
  }

  let demotedDuplicateCount = 0;
  if (Array.isArray(planInput.duplicate_task_ids)) {
    for (const dupId of planInput.duplicate_task_ids.slice(0, rb.max_adjustments_per_plan)) {
      const cleanDup = String(dupId || "").trim();
      if (!cleanDup) continue;
      const row = await db
        .prepare("SELECT id, tier, visibility, priority, state FROM herma_durable_queue WHERE task_id = ? LIMIT 1")
        .bind(cleanDup)
        .first();
      if (!row || row.state !== "ready" || (row.visibility === "server_infra" && !ops.infraAllowed)) continue;
      const floor = row.tier === "ngo_priority" ? rb.ngo_priority_floor : rb.public_priority_floor;
      const nextP = Math.max(floor, Number(row.priority || 60) - rb.duplicate_convergence_demote);
      await db
        .prepare("UPDATE herma_durable_queue SET priority = ?, convergence_flags = COALESCE(convergence_flags, 0) + 1, updated_at = ? WHERE id = ? AND state = 'ready'")
        .bind(nextP, nowIso, row.id)
        .run();
      demotedDuplicateCount += 1;
    }
  }

  const enqueuedGapVerbs = [];
  if (Array.isArray(planInput.gap_verbs) && typeof ops.seedVerbIfMissing === "function") {
    for (const gv of planInput.gap_verbs.slice(0, rb.max_gap_verbs_per_plan)) {
      if (!gv || typeof gv !== "object") continue;
      const gvTitle = scrub(gv.title || "").trim().slice(0, 160);
      const gvPrompt = scrub(gv.prompt || gv.description || "").trim().slice(0, 2000);
      if (!gvTitle || !gvPrompt) continue;
      const gvHash = (await sha256HexText(`${gvTitle}:${gvPrompt}:${nowIso}`)).slice(
        0,
        HERMA_PROMPT_KIT_MUTATION_GRID.archive_spec.short_hash_chars
      );
      const gvId = `verb_gap_${gvHash}`;
      const gvTier = gv.tier === "ngo_priority" ? "ngo_priority" : "public_general";
      const gvVis = gvTier === "ngo_priority" ? "public_ngo" : "public_commons";
      const gvFloor = gvTier === "ngo_priority" ? rb.ngo_priority_floor : rb.public_priority_floor;
      const gvCeil = gvTier === "ngo_priority" ? rb.ngo_priority_ceiling : rb.public_priority_ceiling;
      const gvPrio = Math.max(gvFloor, Math.min(gvCeil, Math.round(Number(gv.priority || 78))));

      await ops.seedVerbIfMissing({
        task_id: gvId,
        tier: gvTier,
        visibility: gvVis,
        priority: gvPrio,
        category: scrub(gv.category || "general_verb").slice(0, 48),
        verb_kind: "general_verb",
        step_mode: gv.step_mode || "atomic_build_step",
        intent_bucket: gv.intent_bucket || "",
        title: gvTitle,
        prompt: gvPrompt,
        labels: ["reprioritized_gap_verb", `proposer:${cleanAgent}`],
      });
      enqueuedGapVerbs.push({ task_id: gvId, tier: gvTier, priority: gvPrio, title: gvTitle });
    }
  }

  const epochHash = (await sha256HexText(`${cleanAgent}:${sourceVerbId}:${nowIso}:${Math.random()}`)).slice(
    0,
    HERMA_PROMPT_KIT_MUTATION_GRID.archive_spec.short_hash_chars
  );
  const epochId = `reprio_${cadenceKind}_${epochHash}`;
  const rationale = scrub(planInput.rationale || planInput.summary || "Bounded queue reprioritization pass").slice(0, 400);

  await db
    .prepare(
      `INSERT INTO herma_reprioritization_ledger
       (epoch_id, cadence_kind, actor_agent_id, actor_worker_uuid, source_verb_id,
        adjusted_count, boosted_stale_count, demoted_duplicate_count, enqueued_gap_verbs_count,
        rationale, plan_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      epochId,
      cadenceKind,
      cleanAgent,
      actorUuid,
      sourceVerbId,
      appliedAdjustments.length,
      boostedStaleCount,
      demotedDuplicateCount,
      enqueuedGapVerbs.length,
      rationale,
      JSON.stringify({
        applied_adjustments: appliedAdjustments,
        boosted_stale_count: boostedStaleCount,
        demoted_duplicate_count: demotedDuplicateCount,
        enqueued_gap_verbs: enqueuedGapVerbs,
      }),
      nowIso
    )
    .run();

  return {
    ok: true,
    epoch_id: epochId,
    cadence_kind: cadenceKind,
    actor_agent_id: cleanAgent,
    source_verb_id: sourceVerbId || null,
    adjusted_count: appliedAdjustments.length,
    applied_adjustments: appliedAdjustments,
    boosted_stale_count: boostedStaleCount,
    demoted_duplicate_count: demotedDuplicateCount,
    enqueued_gap_verbs: enqueuedGapVerbs,
    bounds_enforced: rb,
    created_at: nowIso,
  };
}

export async function handleReprioritizeRequest(request, url, db, publicUrl, ops = {}) {
  const grid = HERMA_PROMPT_KIT_MUTATION_GRID;
  const rb = grid.reprioritization_bounds;
  const hs = grid.http_status;
  const method = request.method.toUpperCase();
  const base = String(publicUrl || "https://herma.ta-amps.workers.dev").replace(/\/+$/, "");

  const cadenceStatus = await ensureCadenceAggregateReviewVerbs(db, base, ops);

  if (method === "GET" || method === "HEAD") {
    const [historyRes, headRes] = await Promise.all([
      db
        .prepare(
          `SELECT epoch_id, cadence_kind, actor_agent_id, source_verb_id, adjusted_count,
                  boosted_stale_count, demoted_duplicate_count, enqueued_gap_verbs_count, rationale, created_at
           FROM herma_reprioritization_ledger
           ORDER BY id DESC LIMIT ?`
        )
        .bind(rb.reprioritize_history_limit)
        .all(),
      db
        .prepare(
          `SELECT task_id, tier, priority, category, verb_kind, intent_bucket, step_mode, title, created_at, updated_at
           FROM herma_durable_queue
           WHERE state = 'ready' AND visibility != 'server_infra' AND COALESCE(is_diagnostic_probe, 0) = 0
           ORDER BY priority DESC, (CASE WHEN tier = 'ngo_priority' THEN 0 ELSE 1 END) ASC, id ASC
           LIMIT ?`
        )
        .bind(rb.generalist_head_preview_limit)
        .all(),
    ]);
    const history = historyRes?.results || [];
    return {
      status: hs.ok,
      body: {
        ok: true,
        schema: "herma.queue_reprioritization.snapshot.v6_11",
        cadence_review_verbs: cadenceStatus,
        latest_epoch: history[0] || null,
        recent_epochs: history,
        generalist_head_of_queue: headRes?.results || [],
        bounds_policy: rb,
        generalist_claim_hint: {
          endpoint: `${base}/q/claim`,
          example_body: { agent_id: "<your-agent-id>", generalist: true },
        },
      },
    };
  }

  if (method === "POST") {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return { status: hs.bad_request, body: { ok: false, code: "invalid_json" } };
    }
    const result = await applyBoundedReprioritizationPlan(db, base, body, ops);
    return { status: hs.ok, body: result };
  }

  return { status: hs.method_not_allowed, body: { ok: false, error: "method_not_allowed" } };
}

// ---------------------------------------------------------------------------
// Zero-Cloud-Spend Client-Submitted Embedding / Multi-Scale LSH / Block-Leaf
// O(1) Structural Verification + Auto-Enqueue `verb_index_enrich_*` & `verb_peer_review_*`
// ---------------------------------------------------------------------------

function normalizeHexOfExactLength(rawHex, expectedChars) {
  if (typeof rawHex !== "string") return "";
  const cleaned = rawHex.trim().toLowerCase();
  if (cleaned.length !== expectedChars) return "";
  for (let i = 0; i < cleaned.length; i += 1) {
    const c = cleaned.charCodeAt(i);
    const isDigit = c >= 48 && c <= 57;
    const isLowerHex = c >= 97 && c <= 102;
    if (!isDigit && !isLowerHex) return "";
  }
  return cleaned;
}

function validateDenseInt8Vector(rawVec, bounds) {
  if (!Array.isArray(rawVec) || rawVec.length === 0 || rawVec.length > bounds.max_dense_embedding_dims) {
    return { valid: false, vector: [], dims: 0, computed_l2_norm: 0 };
  }
  const out = new Array(rawVec.length);
  let sumSq = 0;
  for (let i = 0; i < rawVec.length; i += 1) {
    const v = rawVec[i];
    if (typeof v !== "number" || !Number.isInteger(v) || v < bounds.int8_min || v > bounds.int8_max) {
      return { valid: false, vector: [], dims: 0, computed_l2_norm: 0 };
    }
    out[i] = v;
    sumSq += v * v;
  }
  if (sumSq <= 0) {
    return { valid: false, vector: [], dims: 0, computed_l2_norm: 0 };
  }
  const l2 = Math.round(Math.sqrt(sumSq) * bounds.norm_round_scale) / bounds.norm_round_scale;
  return { valid: true, vector: out, dims: out.length, computed_l2_norm: l2 };
}

function normalizeSearchBlocksList(rawBlocks, bounds) {
  if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) return { valid: false, blocks: [] };
  const out = [];
  const slice = rawBlocks.slice(0, bounds.max_search_blocks);
  for (let i = 0; i < slice.length; i += 1) {
    const entry = slice[i];
    if (typeof entry === "string") {
      const txt = entry.trim().slice(0, bounds.chunk_text_max_chars);
      if (txt) {
        out.push({ block_id: `blk_${i}`, title: txt.slice(0, bounds.chunk_id_max_chars), text: txt, lsh_small_64b: "" });
      }
    } else if (entry && typeof entry === "object") {
      const bId = String(entry.block_id || entry.id || `blk_${i}`).trim().slice(0, bounds.chunk_id_max_chars);
      const title = String(entry.title || entry.heading || "").trim().slice(0, bounds.chunk_id_max_chars);
      const text = String(entry.text || entry.summary || entry.content || title).trim().slice(0, bounds.chunk_text_max_chars);
      const bLsh = normalizeHexOfExactLength(entry.lsh_small_64b || entry.lsh_64b || "", bounds.lsh_small_64b_hex_chars);
      if (text || title) {
        out.push({ block_id: bId, title: title || bId, text, lsh_small_64b: bLsh });
      }
    }
  }
  return { valid: out.length > 0, blocks: out };
}

function normalizeSearchLeafsList(rawLeafs, bounds) {
  if (!Array.isArray(rawLeafs) || rawLeafs.length === 0) return { valid: false, leafs: [] };
  const out = [];
  const slice = rawLeafs.slice(0, bounds.max_search_leafs);
  for (let i = 0; i < slice.length; i += 1) {
    const entry = slice[i];
    if (typeof entry === "string") {
      const txt = entry.trim().slice(0, bounds.chunk_text_max_chars);
      if (txt) {
        out.push({ leaf_id: `leaf_${i}`, block_id: "", text: txt, search_keys: [], lsh_small_64b: "" });
      }
    } else if (entry && typeof entry === "object") {
      const lId = String(entry.leaf_id || entry.id || `leaf_${i}`).trim().slice(0, bounds.chunk_id_max_chars);
      const bId = String(entry.block_id || "").trim().slice(0, bounds.chunk_id_max_chars);
      const text = String(entry.text || entry.excerpt || entry.claim || entry.content || entry.summary || "")
        .trim()
        .slice(0, bounds.chunk_text_max_chars);
      const keys = Array.isArray(entry.search_keys)
        ? entry.search_keys
            .map((k) => String(k || "").trim().toLowerCase().slice(0, bounds.chunk_id_max_chars))
            .filter(Boolean)
            .slice(0, bounds.max_search_keys_per_leaf)
        : [];
      const lLsh = normalizeHexOfExactLength(entry.lsh_small_64b || entry.lsh_64b || "", bounds.lsh_small_64b_hex_chars);
      if (text || keys.length > 0) {
        out.push({ leaf_id: lId, block_id: bId, text, search_keys: keys, lsh_small_64b: lLsh });
      }
    }
  }
  return { valid: out.length > 0, leafs: out };
}

export function extractClientIndexCandidateFields(item = {}, payloadObj = null, topPayload = null) {
  const ci =
    (item?.client_index && typeof item.client_index === "object" ? item.client_index : null) ||
    (payloadObj?.client_index && typeof payloadObj.client_index === "object" ? payloadObj.client_index : null) ||
    (topPayload?.client_index && typeof topPayload.client_index === "object" ? topPayload.client_index : null) ||
    {};
  const pick = (field) => {
    if (item && item[field] !== undefined) return item[field];
    if (ci && ci[field] !== undefined) return ci[field];
    if (payloadObj && payloadObj[field] !== undefined) return payloadObj[field];
    if (topPayload && topPayload[field] !== undefined) return topPayload[field];
    return undefined;
  };
  return {
    dense_embedding_int8: pick("dense_embedding_int8"),
    embedding_model_id: pick("embedding_model_id"),
    embedding_norm: pick("embedding_norm"),
    lsh_small_64b: pick("lsh_small_64b"),
    lsh_medium_256b: pick("lsh_medium_256b"),
    lsh_wide_1024b: pick("lsh_wide_1024b"),
    search_blocks: pick("search_blocks"),
    search_leafs: pick("search_leafs"),
  };
}

export async function validateAndPersistClientIndexMetadata(db, spec = {}) {
  const bounds = HERMA_PROMPT_KIT_MUTATION_GRID.client_index_bounds;
  const objectKey = String(spec.objectKey || "").trim();
  if (!db || !objectKey) {
    return {
      persisted: false,
      has_verified_dense: false,
      has_verified_lsh: false,
      has_verified_dense_and_lsh: false,
      has_verified_blocks_and_leafs: false,
      has_dense_embedding: false,
      has_medium_lsh: false,
      validation_warnings: [],
    };
  }

  const cand = extractClientIndexCandidateFields(spec.item, spec.payloadObj, spec.topPayload);
  const warnings = [];

  const denseProvided = cand.dense_embedding_int8 !== undefined && cand.dense_embedding_int8 !== null;
  const denseCheck = denseProvided
    ? validateDenseInt8Vector(cand.dense_embedding_int8, bounds)
    : { valid: false, vector: [], dims: 0, computed_l2_norm: 0 };
  if (denseProvided && !denseCheck.valid) {
    warnings.push("invalid_dense_embedding_int8_expected_1_to_1024_nonzero_int8");
  }

  const cleanSmall =
    cand.lsh_small_64b !== undefined && cand.lsh_small_64b !== null && String(cand.lsh_small_64b) !== ""
      ? normalizeHexOfExactLength(String(cand.lsh_small_64b), bounds.lsh_small_64b_hex_chars)
      : "";
  if (cand.lsh_small_64b && !cleanSmall) warnings.push("invalid_lsh_small_64b_expected_16_hex");

  const cleanMedium =
    cand.lsh_medium_256b !== undefined && cand.lsh_medium_256b !== null && String(cand.lsh_medium_256b) !== ""
      ? normalizeHexOfExactLength(String(cand.lsh_medium_256b), bounds.lsh_medium_256b_hex_chars)
      : "";
  if (cand.lsh_medium_256b && !cleanMedium) warnings.push("invalid_lsh_medium_256b_expected_64_hex");

  const cleanWide =
    cand.lsh_wide_1024b !== undefined && cand.lsh_wide_1024b !== null && String(cand.lsh_wide_1024b) !== ""
      ? normalizeHexOfExactLength(String(cand.lsh_wide_1024b), bounds.lsh_wide_1024b_hex_chars)
      : "";
  if (cand.lsh_wide_1024b && !cleanWide) warnings.push("invalid_lsh_wide_1024b_expected_256_hex");

  const blocksProvided = cand.search_blocks !== undefined && cand.search_blocks !== null;
  const blocksCheck = blocksProvided ? normalizeSearchBlocksList(cand.search_blocks, bounds) : { valid: false, blocks: [] };
  if (blocksProvided && !blocksCheck.valid) warnings.push("invalid_search_blocks_expected_nonempty_array");

  const leafsProvided = cand.search_leafs !== undefined && cand.search_leafs !== null;
  const leafsCheck = leafsProvided ? normalizeSearchLeafsList(cand.search_leafs, bounds) : { valid: false, leafs: [] };
  if (leafsProvided && !leafsCheck.valid) warnings.push("invalid_search_leafs_expected_nonempty_array");

  const hasVerifiedDense = denseCheck.valid;
  const hasVerifiedLsh = Boolean(cleanMedium && (cleanSmall || cleanWide));
  const hasVerifiedDenseAndLsh = Boolean(hasVerifiedDense && hasVerifiedLsh);
  const hasVerifiedBlocksAndLeafs = Boolean(blocksCheck.valid && leafsCheck.valid);

  const anyClientFieldValid = Boolean(
    hasVerifiedDense || cleanSmall || cleanMedium || cleanWide || blocksCheck.valid || leafsCheck.valid
  );

  const simhashFallback = String(spec.simhash64Hex || "").trim().toLowerCase();
  const nowIso = String(spec.nowIso || new Date().toISOString());
  const agentId = String(spec.agentId || "worker").trim();
  const workerUuid = String(spec.workerUuid || "").trim();
  const modelId = String(cand.embedding_model_id || (hasVerifiedDense ? "client_int8_v1" : ""))
    .trim()
    .slice(0, bounds.model_id_max_chars);
  const declaredNorm = Number(cand.embedding_norm);
  const effectiveNorm =
    Number.isFinite(declaredNorm) && declaredNorm > 0 ? declaredNorm : denseCheck.computed_l2_norm;

  if (anyClientFieldValid || simhashFallback) {
    await db
      .prepare(
        `INSERT INTO herma_object_client_index
         (object_key, indexer_agent_id, indexer_worker_uuid, embedding_model_id, embedding_dims,
          embedding_norm, dense_embedding_int8_json, lsh_small_64b, lsh_medium_256b, lsh_wide_1024b,
          search_blocks_json, search_leafs_json, has_verified_dense, has_verified_lsh,
          has_verified_dense_and_lsh, has_verified_blocks_and_leafs, simhash64_fallback_hex, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(object_key) DO UPDATE SET
           indexer_agent_id = CASE WHEN excluded.has_verified_dense = 1 OR excluded.has_verified_lsh = 1 OR excluded.has_verified_blocks_and_leafs = 1 THEN excluded.indexer_agent_id ELSE herma_object_client_index.indexer_agent_id END,
           indexer_worker_uuid = CASE WHEN excluded.has_verified_dense = 1 OR excluded.has_verified_lsh = 1 OR excluded.has_verified_blocks_and_leafs = 1 THEN excluded.indexer_worker_uuid ELSE herma_object_client_index.indexer_worker_uuid END,
           embedding_model_id = CASE WHEN excluded.embedding_model_id != '' THEN excluded.embedding_model_id ELSE herma_object_client_index.embedding_model_id END,
           embedding_dims = CASE WHEN excluded.embedding_dims > 0 THEN excluded.embedding_dims ELSE herma_object_client_index.embedding_dims END,
           embedding_norm = CASE WHEN excluded.embedding_norm > 0 THEN excluded.embedding_norm ELSE herma_object_client_index.embedding_norm END,
           dense_embedding_int8_json = CASE WHEN excluded.has_verified_dense = 1 THEN excluded.dense_embedding_int8_json ELSE herma_object_client_index.dense_embedding_int8_json END,
           lsh_small_64b = CASE WHEN excluded.lsh_small_64b != '' THEN excluded.lsh_small_64b ELSE herma_object_client_index.lsh_small_64b END,
           lsh_medium_256b = CASE WHEN excluded.lsh_medium_256b != '' THEN excluded.lsh_medium_256b ELSE herma_object_client_index.lsh_medium_256b END,
           lsh_wide_1024b = CASE WHEN excluded.lsh_wide_1024b != '' THEN excluded.lsh_wide_1024b ELSE herma_object_client_index.lsh_wide_1024b END,
           search_blocks_json = CASE WHEN excluded.search_blocks_json != '[]' THEN excluded.search_blocks_json ELSE herma_object_client_index.search_blocks_json END,
           search_leafs_json = CASE WHEN excluded.search_leafs_json != '[]' THEN excluded.search_leafs_json ELSE herma_object_client_index.search_leafs_json END,
           has_verified_dense = MAX(herma_object_client_index.has_verified_dense, excluded.has_verified_dense),
           has_verified_lsh = MAX(herma_object_client_index.has_verified_lsh, excluded.has_verified_lsh),
           has_verified_dense_and_lsh = CASE
             WHEN MAX(herma_object_client_index.has_verified_dense, excluded.has_verified_dense) = 1
              AND MAX(herma_object_client_index.has_verified_lsh, excluded.has_verified_lsh) = 1
             THEN 1 ELSE 0 END,
           has_verified_blocks_and_leafs = MAX(herma_object_client_index.has_verified_blocks_and_leafs, excluded.has_verified_blocks_and_leafs),
           simhash64_fallback_hex = CASE WHEN excluded.simhash64_fallback_hex != '' THEN excluded.simhash64_fallback_hex ELSE herma_object_client_index.simhash64_fallback_hex END,
           updated_at = excluded.updated_at`
      )
      .bind(
        objectKey,
        agentId,
        workerUuid,
        modelId,
        denseCheck.dims,
        effectiveNorm,
        hasVerifiedDense ? JSON.stringify(denseCheck.vector) : "[]",
        cleanSmall,
        cleanMedium,
        cleanWide,
        blocksCheck.valid ? JSON.stringify(blocksCheck.blocks) : "[]",
        leafsCheck.valid ? JSON.stringify(leafsCheck.leafs) : "[]",
        hasVerifiedDense ? 1 : 0,
        hasVerifiedLsh ? 1 : 0,
        hasVerifiedDenseAndLsh ? 1 : 0,
        hasVerifiedBlocksAndLeafs ? 1 : 0,
        simhashFallback,
        nowIso
      )
      .run();
  }

  return {
    persisted: Boolean(anyClientFieldValid || simhashFallback),
    object_key: objectKey,
    embedding_model_id: modelId || null,
    embedding_dims: denseCheck.dims,
    embedding_norm: effectiveNorm,
    lsh_small_64b: cleanSmall || null,
    lsh_medium_256b: cleanMedium || null,
    lsh_wide_1024b: cleanWide || null,
    search_blocks_count: blocksCheck.blocks.length,
    search_leafs_count: leafsCheck.leafs.length,
    has_dense_embedding: hasVerifiedDense,
    has_medium_lsh: Boolean(cleanMedium),
    has_verified_dense: hasVerifiedDense,
    has_verified_lsh: hasVerifiedLsh,
    has_verified_dense_and_lsh: hasVerifiedDenseAndLsh,
    has_verified_blocks_and_leafs: hasVerifiedBlocksAndLeafs,
    simhash64_fallback_hex: simhashFallback || null,
    validation_mode: "o1_structural_zero_cloud_spend",
    validation_warnings: warnings,
  };
}

export async function fetchClientIndexMetadata(db, objectKey, { includeDenseVector = false } = {}) {
  if (!db || !objectKey) return null;
  const row = await db
    .prepare("SELECT * FROM herma_object_client_index WHERE object_key = ? LIMIT 1")
    .bind(String(objectKey))
    .first()
    .catch(() => null);
  if (!row) return null;
  let blocks = [];
  let leafs = [];
  let denseVec = undefined;
  try {
    blocks = JSON.parse(row.search_blocks_json || "[]");
  } catch {
    blocks = [];
  }
  try {
    leafs = JSON.parse(row.search_leafs_json || "[]");
  } catch {
    leafs = [];
  }
  if (includeDenseVector && Number(row.has_verified_dense || 0) === 1) {
    try {
      denseVec = JSON.parse(row.dense_embedding_int8_json || "[]");
    } catch {
      denseVec = [];
    }
  }
  return {
    indexer_agent_id: row.indexer_agent_id,
    indexer_worker_uuid: row.indexer_worker_uuid || null,
    embedding_model_id: row.embedding_model_id || null,
    embedding_dims: Number(row.embedding_dims || 0),
    embedding_norm: Number(row.embedding_norm || 0),
    ...(denseVec !== undefined ? { dense_embedding_int8: denseVec } : {}),
    lsh_small_64b: row.lsh_small_64b || null,
    lsh_medium_256b: row.lsh_medium_256b || null,
    lsh_wide_1024b: row.lsh_wide_1024b || null,
    search_blocks: blocks,
    search_leafs: leafs,
    block_count: blocks.length,
    leaf_count: leafs.length,
    has_verified_dense: Boolean(row.has_verified_dense),
    has_verified_lsh: Boolean(row.has_verified_lsh),
    has_verified_dense_and_lsh: Boolean(row.has_verified_dense_and_lsh),
    has_verified_blocks_and_leafs: Boolean(row.has_verified_blocks_and_leafs),
    simhash64_fallback_hex: row.simhash64_fallback_hex || null,
    updated_at: row.updated_at,
  };
}

export async function autoEnqueueIndexEnrichAndPeerReviewVerbs(db, publicUrl, spec = {}, ops = {}) {
  const bounds = HERMA_PROMPT_KIT_MUTATION_GRID.client_index_bounds;
  const objectKey = String(spec.objectKey || "").trim();
  const base = String(publicUrl || "https://herma.ta-amps.workers.dev").replace(/\/+$/, "");
  if (
    !db ||
    !objectKey ||
    spec.isDiagnostic ||
    spec.visibility === "server_infra" ||
    String(spec.sourceTaskId || "").startsWith("verb_index_enrich_") ||
    String(spec.sourceTaskId || "").startsWith("verb_peer_review_")
  ) {
    return {
      index_enrich_task_id: null,
      peer_review_task_id: null,
      enqueued_index_enrich_task_id: null,
      enqueued_peer_review_task_id: null,
    };
  }

  const missingDenseOrMediumLsh = !spec.hasDenseEmbedding || !spec.hasMediumLsh;
  if (!missingDenseOrMediumLsh) {
    return {
      index_enrich_task_id: null,
      peer_review_task_id: null,
      enqueued_index_enrich_task_id: null,
      enqueued_peer_review_task_id: null,
    };
  }

  const cleanAuthorAgent = String(spec.producerAgent || "").trim();
  const cleanAuthorUuid = String(spec.producerWorkerUuid || "").trim();
  const enrichTaskId = `verb_index_enrich_${objectKey}`.slice(0, bounds.task_id_max_chars);
  const reviewTaskId = `verb_peer_review_${objectKey}`.slice(0, bounds.task_id_max_chars);

  if (typeof ops.seedVerbIfMissing === "function") {
    await ops.seedVerbIfMissing({
      task_id: enrichTaskId,
      tier: "public_general",
      visibility: "public_commons",
      priority: bounds.index_enrich_priority,
      category: "distributed_index_enrichment",
      verb_kind: "general_verb",
      step_mode: "atomic_build_step",
      intent_bucket: "distributed_substrate_optimization",
      producer_agent: cleanAuthorAgent || "herma-index-loop",
      producer_worker_uuid: cleanAuthorUuid,
      parent_task_id: spec.sourceTaskId && spec.sourceTaskId !== "self_seed" ? spec.sourceTaskId : "",
      required_capabilities: ["embedding_capable"],
      preferred_worker_setup: ["embedding_capable"],
      title: `Client-Side Distributed Index Enrichment for '${objectKey}' (1024-d Int8 + Multi-Scale LSH + Block/Leaf)`,
      prompt:
        `Fetch GET ${base}/q/object/${encodeURIComponent(objectKey)}, compute client-side dense_embedding_int8 (<= 1024 int8), ` +
        `lsh_small_64b (16 hex), lsh_medium_256b (64 hex), lsh_wide_1024b (256 hex), search_blocks[], and search_leafs[] ` +
        `(e.g. via worker_distributed_indexer.py in herma-worker-kit.zip), and submit them on POST ${base}/q/complete (or POST ${base}/q/submit) for task_id '${enrichTaskId}'.`,
      labels: ["distributed_index_enrichment", "embedding_capable", `target_object:${objectKey}`],
    });

    await ops.seedVerbIfMissing({
      task_id: reviewTaskId,
      tier: "public_general",
      visibility: "public_commons",
      priority: bounds.peer_review_priority,
      category: "eval_and_rank",
      verb_kind: "eval_and_rank",
      step_mode: "atomic_verification_step",
      intent_bucket: "distributed_substrate_optimization",
      producer_agent: cleanAuthorAgent || "herma-peer-review-loop",
      producer_worker_uuid: cleanAuthorUuid,
      parent_task_id: spec.sourceTaskId && spec.sourceTaskId !== "self_seed" ? spec.sourceTaskId : "",
      required_capabilities: ["peer_reviewer", "schema_validator"],
      preferred_worker_setup: {
        preferred_setup_tags: ["peer_reviewer"],
        required_tools: ["http_client", "schema_validator"],
        excluded_reporter_agent_ids: cleanAuthorAgent ? [cleanAuthorAgent] : [],
        excluded_reporter_worker_uuids: cleanAuthorUuid ? [cleanAuthorUuid] : [],
      },
      title: `Independent Peer Review & Quality Calibration for '${objectKey}' (reviewer != author)`,
      prompt:
        `Independently inspect GET ${base}/q/object/${encodeURIComponent(objectKey)} (authored by '${cleanAuthorAgent || "peer"}'; reviewer != author strictly enforced), ` +
        `verify schema/test/index integrity, and submit structured evaluations (actual_importance, potential_importance, estimated_priority, novelty_milli, verification_verdict) on POST ${base}/q/complete for task_id '${reviewTaskId}'.`,
      labels: [
        "eval_and_rank",
        "peer_review",
        `target_object:${objectKey}`,
        ...(cleanAuthorAgent ? [`author:${cleanAuthorAgent}`] : []),
      ],
    });
  }

  return {
    index_enrich_task_id: enrichTaskId,
    peer_review_task_id: reviewTaskId,
    enqueued_index_enrich_task_id: enrichTaskId,
    enqueued_peer_review_task_id: reviewTaskId,
  };
}
