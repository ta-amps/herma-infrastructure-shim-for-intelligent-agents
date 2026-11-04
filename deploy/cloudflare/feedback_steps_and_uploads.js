// Herma v6.9 + v6.10 Catch-All Proactive Worker Feedback, Auto-Diagnosis & Peer-Review Verb Spawner (`/q/feedback`, `/feedback`),
// Atomic Cognitive vs. Atomic Build Step Taxonomy (`step_mode` + `reuse_mode`),
// Paginated Tasks/Objects Catalogs (`/q/tasks`, `/q/objects`), and
// 16 MiB Gzip + Resumable Chunked Upload & Blob Store (`/q/upload`, `/q/blob/<sha256>`).
//
// Strictly preserves universal `Task` (`herma_durable_queue`) and `Task Object` (`herma_task_objects`)
// primitives with zero rival work authorities, zero em-dashes, and zero legacy model names.

import { applyClientPrefs, readClientPrefs } from "./client_prefs.js";
import { TRUSTED_TASK_EVALUATION_SQL, reviewLabels, reviewWhere } from "./public_read.js";
import {
  enrichTaxonomyRecord,
  ingestCatchAllFeedbackObservation,
} from "./taxonomy_affinity_and_proactive_feedback.js";
import { resolveBilateralBounds } from "./conversation.js";

const DEFAULT_FEEDBACK_BOUNDS = resolveBilateralBounds({});

export const FEEDBACK_STEPS_UPLOADS_GRID = Object.freeze({
  schema_id: "herma.feedback_steps_and_uploads.grid.v6_9",
  feedback_schema_version: "herma.priority_work_gateway.feedback.v1",
  tasks_list_schema_version: "herma.priority_work_gateway.tasks_list.v1",
  objects_list_schema_version: "herma.priority_work_gateway.objects_list.v1",
  upload_schema_version: "herma.priority_work_gateway.upload.v1",
  max_upload_bytes: 16777216,
  max_decompressed_envelope_bytes: 18874368,
  feedback_field_max_bytes: DEFAULT_FEEDBACK_BOUNDS.feedback_field_max_bytes,
  feedback_envelope_max_bytes: DEFAULT_FEEDBACK_BOUNDS.feedback_envelope_max_bytes,
  inline_payload_threshold_bytes: 262144,
  blob_chunk_bytes: 131072,
  max_blob_chunks: 128,
  batch_write_stmt_limit: 16,
  chunk_read_page_size: 32,
  b64_subslice_bytes: 8192,
  upload_id_random_bytes: 8,
  short_hash_chars: 10,
  object_key_max_len: 128,
  summary_max_len: DEFAULT_FEEDBACK_BOUNDS.feedback_field_max_bytes,
  detail_max_len: DEFAULT_FEEDBACK_BOUNDS.feedback_field_max_bytes,
  repro_max_len: DEFAULT_FEEDBACK_BOUNDS.feedback_field_max_bytes,
  endpoint_max_len: 240,
  code_max_len: 80,
  diagnostic_cred_points: 6,
  milli_scale: 1000,
  default_list_limit: 25,
  max_list_limit: 500,
  feedback_recent_limit: 30,
  cognitive_tier12_bonus: 6.0,
  verification_tier12_bonus: 3.0,
  build_tier34_bonus: 6.5,
  reuse_tier34_bonus: 3.5,
  cognitive_tier34_bonus: 1.5,
  build_tier12_penalty: -2.5,
  http_ok: 200,
  http_created: 201,
  http_bad_request: 400,
  http_forbidden: 403,
  http_not_found: 404,
  http_method_not_allowed: 405,
  http_conflict: 409,
  http_payload_too_large: 413,
});

export const STEP_MODES = Object.freeze([
  "atomic_cognitive_step",
  "atomic_build_step",
  "atomic_verification_step",
  "deterministic_reuse_step",
]);

export const REUSE_MODES = Object.freeze([
  "deterministic_code_bypass",
  "semantic_rubric_prior",
  "verification_oracle",
  "reference_artifact",
]);

const STEP_MODE_ALIAS_MAP = Object.freeze({
  atomic_cognitive_step: "atomic_cognitive_step",
  cognitive: "atomic_cognitive_step",
  cognitive_step: "atomic_cognitive_step",
  scoping: "atomic_cognitive_step",
  reasoning: "atomic_cognitive_step",
  atomic_build_step: "atomic_build_step",
  build: "atomic_build_step",
  build_step: "atomic_build_step",
  code: "atomic_build_step",
  implementation: "atomic_build_step",
  atomic_verification_step: "atomic_verification_step",
  verify: "atomic_verification_step",
  verification: "atomic_verification_step",
  verification_step: "atomic_verification_step",
  eval: "atomic_verification_step",
  audit: "atomic_verification_step",
  deterministic_reuse_step: "deterministic_reuse_step",
  reuse: "deterministic_reuse_step",
  deterministic: "deterministic_reuse_step",
  zero_token_reuse: "deterministic_reuse_step",
});

const INITIALIZED_FSU_DBS = new WeakSet();

// With a score filter a page can come back short, so the next page starts after the rows read, not the rows kept. Rows cut for size are read again.
function rowsReadFor(prefs, rows, fitted) {
  if (prefs.min_confidence == null) return fitted.items.length;
  if (!fitted.report.left_out_by_max_bytes) return rows.length;
  return fitted.items.length ? rows.indexOf(fitted.items[fitted.items.length - 1]) + 1 : 1;
}

export function normalizeStepMode(raw) {
  const key = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return STEP_MODE_ALIAS_MAP[key] || "";
}

export function inferStepAndReuseMode({
  explicitStepMode = "",
  explicitReuseMode = "",
  verbKind = "",
  category = "",
  deliverableKind = "",
  assetModality = "",
  title = "",
  summary = "",
  prompt = "",
  payloadObj = null,
} = {}) {
  const normExplicit = normalizeStepMode(explicitStepMode);
  const vk = String(verbKind || "").trim().toLowerCase();
  const cat = String(category || "").trim().toLowerCase();
  const dk = String(deliverableKind || "").trim().toLowerCase();
  const mod = String(assetModality || "").trim().toLowerCase();
  const text = `${title || ""} ${summary || ""} ${prompt || ""}`.toLowerCase();

  let stepMode = normExplicit;
  if (!stepMode) {
    const hasBuildPayload = Boolean(
      payloadObj &&
        typeof payloadObj === "object" &&
        (payloadObj.code_and_tests ||
          payloadObj.working_dir_files ||
          payloadObj.files ||
          payloadObj.python_adapter_snippet ||
          payloadObj.stl_ascii ||
          payloadObj.wav_base64 ||
          payloadObj.blob_uri)
    );
    const isVerification =
      vk === "eval_and_rank" ||
      cat === "worker_issue_report" ||
      cat === "evaluation_ledger" ||
      cat === "benchmark_evaluation_dossier" ||
      /\b(blind[_\s-]?eval|perturbation[_\s-]?audit|peer[_\s-]?review|eval_and_rank|verify[_\s-]?suite|calibrate\s+priority)\b/.test(
        text
      );
    const isBuild =
      hasBuildPayload ||
      vk === "demo_and_video" ||
      vk === "agent_kit_packager" ||
      [
        "agent_kit",
        "portable_agent_kit",
        "skill_pack",
        "multimodal_asset_kit",
        "meta_embedding_adapter",
        "canonical_schema",
        "code_module",
        "godot_scene_kit",
        "wav_music_stem",
      ].includes(cat) ||
      ["portable_agent_kit", "skill_pack", "demo_and_video", "muse_template", "grokbot_template", "duet_template"].includes(
        dk
      ) ||
      [
        "mesh_3d_stl",
        "engine_scene_kit",
        "audio_music_stem",
        "sprite_sheet",
        "video_render",
        "embedding_index_kit",
      ].includes(mod) ||
      /\b(pytest|unittest|node\s+--test|cli\b|dockerfile|agent[_\s-]?kit|mesh|\.stl\b|\.tscn\b|\.wav\b|sql\s+schema|compile|implement\b|adapter\b|packager\b|executable)\b/.test(
        text
      );
    const isDeterministicReuse = /\b(zero[_\s-]?token|deterministic[_\s-]?reuse|cached[_\s-]?bypass)\b/.test(text);

    if (isDeterministicReuse) {
      stepMode = "deterministic_reuse_step";
    } else if (isVerification) {
      stepMode = "atomic_verification_step";
    } else if (isBuild) {
      stepMode = "atomic_build_step";
    } else {
      stepMode = "atomic_cognitive_step";
    }
  }

  let reuseMode = String(explicitReuseMode || "").trim().toLowerCase();
  if (!REUSE_MODES.includes(reuseMode)) {
    if (stepMode === "atomic_build_step" || stepMode === "deterministic_reuse_step") {
      reuseMode = "deterministic_code_bypass";
    } else if (stepMode === "atomic_verification_step") {
      reuseMode = "verification_oracle";
    } else {
      reuseMode = "semantic_rubric_prior";
    }
  }

  return { step_mode: stepMode, reuse_mode: reuseMode };
}

export function computeStepModeRoutingBonus(harnessTier = "", stepMode = "") {
  const tier = String(harnessTier || "tier_2_sandboxed_chat_worker");
  const mode = normalizeStepMode(stepMode) || "atomic_cognitive_step";
  const isDeepCodeHarness = tier === "tier_3_cli_code_harness" || tier === "tier_4_deep_architect_astra";
  if (isDeepCodeHarness) {
    if (mode === "atomic_build_step") return FEEDBACK_STEPS_UPLOADS_GRID.build_tier34_bonus;
    if (mode === "deterministic_reuse_step") return FEEDBACK_STEPS_UPLOADS_GRID.reuse_tier34_bonus;
    return FEEDBACK_STEPS_UPLOADS_GRID.cognitive_tier34_bonus;
  }
  if (mode === "atomic_cognitive_step") return FEEDBACK_STEPS_UPLOADS_GRID.cognitive_tier12_bonus;
  if (mode === "atomic_verification_step") return FEEDBACK_STEPS_UPLOADS_GRID.verification_tier12_bonus;
  if (mode === "atomic_build_step") return FEEDBACK_STEPS_UPLOADS_GRID.build_tier12_penalty;
  return 0;
}

function uint8ToBase64(u8) {
  let binary = "";
  const step = FEEDBACK_STEPS_UPLOADS_GRID.b64_subslice_bytes;
  for (let offset = 0; offset < u8.byteLength; offset += step) {
    const slice = u8.subarray(offset, Math.min(offset + step, u8.byteLength));
    binary += String.fromCharCode.apply(null, slice);
  }
  return btoa(binary);
}

function base64ToUint8(b64) {
  const clean = String(b64 || "").replace(/\s+/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

async function sha256HexBytes(u8) {
  const digest = await crypto.subtle.digest("SHA-256", u8);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function scrubCapabilityTokensFromReport(text = "") {
  return String(text || "").replace(
    /\b(?:hk_(?:wrk|ep|inf)_[A-Za-z0-9_.-]+|hmk_[A-Za-z0-9_.-]+|wt_[a-f0-9]{12,}|tan_[A-Za-z0-9_.-]+)\b/gi,
    "[REDACTED_TOKEN]"
  );
}

export async function readPossiblyGzippedBytes(
  request,
  maxBytes = FEEDBACK_STEPS_UPLOADS_GRID.max_decompressed_envelope_bytes
) {
  const rawBuf = await request.arrayBuffer();
  const rawU8 = new Uint8Array(rawBuf);
  const contentEncoding = (request.headers.get("content-encoding") || "").toLowerCase();
  const hasGzipMagic = rawU8.byteLength >= 2 && rawU8[0] === 0x1f && rawU8[1] === 0x8b;
  const shouldGunzip = contentEncoding.includes("gzip") && hasGzipMagic;

  if (!shouldGunzip) {
    if (rawU8.byteLength > maxBytes) {
      return {
        payloadTooLarge: true,
        actual_bytes: rawU8.byteLength,
        max_bytes: maxBytes,
      };
    }
    return { bytes: rawU8, wasGzipped: false };
  }

  if (typeof DecompressionStream !== "function") {
    return { invalidEncoding: true, detail: "DecompressionStream('gzip') is unavailable in this runtime." };
  }

  try {
    const stream = new Blob([rawU8]).stream().pipeThrough(new DecompressionStream("gzip"));
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            // ignore cancel error
          }
          return {
            payloadTooLarge: true,
            actual_bytes: total,
            max_bytes: maxBytes,
          };
        }
        chunks.push(value);
      }
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    return { bytes: merged, wasGzipped: true };
  } catch (err) {
    return { invalidGzip: true, detail: String(err?.message || "Invalid gzip stream") };
  }
}

export async function readPossiblyGzippedJson(
  request,
  maxBytes = FEEDBACK_STEPS_UPLOADS_GRID.max_decompressed_envelope_bytes
) {
  const out = await readPossiblyGzippedBytes(request, maxBytes);
  if (out.payloadTooLarge || out.invalidEncoding || out.invalidGzip) {
    return out;
  }
  const text = new TextDecoder().decode(out.bytes);
  try {
    return {
      json: JSON.parse(text || "{}"),
      byteLength: out.bytes.byteLength,
      wasGzipped: out.wasGzipped,
    };
  } catch {
    return { invalidJson: true };
  }
}

export async function ensureFeedbackStepsAndUploadsSchema(db) {
  if (!db || typeof db.prepare !== "function") return;
  if (db.__hermaSchemaV69Ready || INITIALIZED_FSU_DBS.has(db)) return;

  const ddl = [
    `CREATE TABLE IF NOT EXISTS herma_blob_store (
      sha256_hash TEXT PRIMARY KEY,
      content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      filename TEXT NOT NULL DEFAULT '',
      total_bytes INTEGER NOT NULL,
      chunk_count INTEGER NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'public_commons',
      producer_agent TEXT NOT NULL DEFAULT '',
      worker_uuid TEXT NOT NULL DEFAULT '',
      linked_object_key TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS herma_blob_chunks (
      sha256_hash TEXT NOT NULL,
      chunk_idx INTEGER NOT NULL,
      chunk_b64 TEXT NOT NULL,
      byte_len INTEGER NOT NULL,
      PRIMARY KEY (sha256_hash, chunk_idx)
    )`,
    `CREATE TABLE IF NOT EXISTS herma_upload_sessions (
      upload_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL DEFAULT 'anonymous-uploader',
      worker_uuid TEXT NOT NULL DEFAULT '',
      filename TEXT NOT NULL DEFAULT '',
      content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      visibility TEXT NOT NULL DEFAULT 'public_commons',
      expected_sha256 TEXT NOT NULL DEFAULT '',
      object_spec_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS herma_upload_parts (
      upload_id TEXT NOT NULL,
      part_idx INTEGER NOT NULL,
      chunk_b64 TEXT NOT NULL,
      byte_len INTEGER NOT NULL,
      part_sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (upload_id, part_idx)
    )`,
  ];

  for (const sql of ddl) {
    await db.prepare(sql).run();
  }
  INITIALIZED_FSU_DBS.add(db);
}

export function buildAutoDiagnosis({
  issueKind = "",
  endpoint = "",
  httpStatus = 0,
  errorCode = "",
  payloadBytes = 0,
  publicUrl = "https://shim.teleionlabs.com",
} = {}) {
  const base = String(publicUrl || "https://shim.teleionlabs.com").replace(/\/+$/, "");
  const status = Number(httpStatus || 0);
  const kindLower = String(issueKind || "").toLowerCase();
  const codeLower = String(errorCode || "").toLowerCase();
  const epLower = String(endpoint || "").toLowerCase();
  const bytes = Number(payloadBytes || 0);

  if (status === 404 || kindLower.includes("404") || codeLower.includes("not_found") || codeLower.includes("unknown_gateway_route")) {
    return {
      matched_pattern: "http_404_route_or_lookup",
      immediate_remediation:
        "Use the canonical discovery and list endpoints below. Bare GET /q/task and GET /q/object now list items automatically instead of returning 404, and /q/object/<verb_id> cross-resolves durable Tasks.",
      canonical_route_map: {
        health: `${base}/health`,
        gateway_pulse: `${base}/q/pulse`,
        list_tasks: `${base}/q/tasks?state=ready&limit=25`,
        single_task: `${base}/q/task/<task_id>`,
        list_objects: `${base}/q/objects?limit=25`,
        single_object: `${base}/q/object/<object_key>`,
        active_workers: `${base}/q/workers`,
        schema_coach: `${base}/q/schema`,
        large_upload: `${base}/q/upload`,
        feedback_ledger: `${base}/q/feedback`,
      },
    };
  }

  if (
    status === 413 ||
    bytes > FEEDBACK_STEPS_UPLOADS_GRID.inline_payload_threshold_bytes ||
    kindLower.includes("payload") ||
    codeLower.includes("payload_too_large")
  ) {
    return {
      matched_pattern: "large_payload_or_http_413",
      immediate_remediation:
        "Herma v6.9 supports Task Objects and binary/JSON uploads up to 16 MiB (16,777,216 bytes) plus Content-Encoding: gzip on POST /q/submit, POST /q/upload, and POST /q/feedback.",
      recommended_commands: {
        gzip_submit_note: "Compress JSON with gzip and set header Content-Encoding: gzip on POST /q/submit.",
        single_shot_upload_url: `${base}/q/upload`,
        resumable_upload_init_url: `${base}/q/upload/init`,
        blob_download_template: `${base}/q/blob/<sha256_hash>`,
        max_bytes: FEEDBACK_STEPS_UPLOADS_GRID.max_upload_bytes,
      },
    };
  }

  if (
    status === 409 ||
    codeLower.includes("fencing") ||
    codeLower.includes("lease") ||
    codeLower.includes("already_completed") ||
    epLower.includes("/q/submit")
  ) {
    return {
      matched_pattern: "http_409_lease_fencing_or_completion",
      immediate_remediation:
        "Pass the exact integer lease.lease_epoch (or lease.fencing_token) returned by /q/claim, check GET /q/task?task_id=<id> before submitting, or pass ?lease_epoch=<int> on GET /q/submit URLs.",
      recommended_checks: {
        inspect_task_state_url: `${base}/q/task?task_id=<task_id>`,
        release_blocked_lease_url: `${base}/q/release`,
        get_submit_query_param: "?lease_epoch=<exact_integer_from_claim>",
      },
    };
  }

  if (status === 401 || status === 403 || codeLower.includes("forbidden") || codeLower.includes("token")) {
    return {
      matched_pattern: "auth_or_tier_boundary",
      immediate_remediation:
        "Mint a persistent worker_uuid and worker_token via POST /q/onboard with {\"agent_id\":\"<unique-handle>\",\"mint_new\":true}, and target public tiers ('ngo_priority' or 'public_general').",
      onboard_url: `${base}/q/onboard`,
    };
  }

  return {
    matched_pattern: "general_diagnostic_logged",
    immediate_remediation:
      "Your report is stored as a first-class worker_issue_report Task Object in D1. Inspect /q/schema for open-world schema coaching, /q/grid-robustness for thick-path telemetry, or /q/chat for interactive unblocking.",
    helpful_endpoints: {
      schema_url: `${base}/q/schema`,
      schema_validate_url: `${base}/q/schema/validate`,
      chat_helper_url: `${base}/q/chat`,
      upload_url: `${base}/q/upload`,
    },
  };
}

export async function handleWorkerFeedbackRequest(
  request,
  url,
  env,
  db,
  publicUrl,
  { infraAllowed = false, gatewayOps } = {}
) {
  await ensureFeedbackStepsAndUploadsSchema(db);
  const bounds = resolveBilateralBounds(env);
  const method = request.method.toUpperCase();
  const base = String(publicUrl || "https://shim.teleionlabs.com").replace(/\/+$/, "");

  if (method === "GET" || method === "HEAD") {
    const visFilter = infraAllowed
      ? "visibility IN ('public_ngo', 'public_commons', 'server_infra')"
      : "visibility IN ('public_ngo', 'public_commons')";
    const limit = Math.max(
      1,
      Math.min(
        FEEDBACK_STEPS_UPLOADS_GRID.max_list_limit,
        Number(url.searchParams.get("limit") || FEEDBACK_STEPS_UPLOADS_GRID.feedback_recent_limit)
      )
    );
    const [rowsRes, clusterRes] = await Promise.all([
      db
        .prepare(
          `SELECT object_key, category, visibility, producer_agent, worker_uuid, summary, payload_json,
                  intent_bucket, target_env, prog_lang, deliverable_kind,
                  sha256_hash, total_payload_bytes, step_mode, created_at
           FROM herma_task_objects
           WHERE category IN ('worker_issue_report', 'system_feedback_signal') AND ${visFilter}
           ORDER BY id DESC
           LIMIT ?`
        )
        .bind(limit)
        .all(),
      db
        .prepare(
          `SELECT fingerprint, object_key, signal_kind, target_component, severity_milli,
                  review_verb_id, promoted_to_proposal, emitted_training_signal
           FROM herma_feedback_signal_clusters
           ORDER BY updated_at DESC
           LIMIT ?`
        )
        .bind(limit)
        .all()
        .catch(() => ({ results: [] })),
    ]);

    const clusterByObjKey = new Map();
    for (const c of clusterRes?.results || []) {
      clusterByObjKey.set(String(c.object_key), c);
    }

    const reports = [];
    const byIssueKind = {};
    const bySignalKind = {};
    const byHttpStatus = {};
    for (const r of rowsRes?.results || []) {
      let parsed = {};
      try {
        parsed = JSON.parse(r.payload_json || "{}");
      } catch {
        parsed = {};
      }
      const cl = clusterByObjKey.get(String(r.object_key)) || null;
      const sk = String(cl?.signal_kind || parsed.signal_kind || parsed.issue_kind || "general_feedback");
      const ik = String(parsed.issue_kind || sk || "general_feedback");
      const hs = String(parsed.http_status || "unspecified");
      byIssueKind[ik] = (byIssueKind[ik] || 0) + 1;
      bySignalKind[sk] = (bySignalKind[sk] || 0) + 1;
      byHttpStatus[hs] = (byHttpStatus[hs] || 0) + 1;
      reports.push({
        object_key: r.object_key,
        category: r.category,
        fingerprint: cl?.fingerprint || parsed.fingerprint || null,
        signal_kind: sk,
        issue_kind: ik,
        target_component: cl?.target_component || parsed.target_component || parsed.endpoint || "shared_substrate",
        severity_milli: Number(cl?.severity_milli || parsed.severity_milli || 650),
        review_verb_id: cl?.review_verb_id || null,
        promoted_to_proposal: Boolean(cl?.promoted_to_proposal),
        emitted_training_signal: Boolean(cl?.emitted_training_signal),
        producer_agent: r.producer_agent,
        worker_uuid: r.worker_uuid || null,
        endpoint: parsed.endpoint || "",
        http_status: parsed.http_status ?? null,
        error_code: parsed.error_code || "",
        proposed_alternatives: parsed.proposed_alternatives || [],
        step_mode: r.step_mode || "atomic_verification_step",
        intent_bucket: r.intent_bucket || "distributed_substrate_optimization",
        target_env: r.target_env || "cloudflare_edge_worker",
        prog_lang: r.prog_lang || "polyglot_declarative",
        deliverable_kind: r.deliverable_kind || "verification_and_benchmark_suite",
        summary: r.summary,
        observation: parsed.observation || r.summary,
        detail: parsed.detail || "",
        reproduction: parsed.reproduction || "",
        truncated: false,
        sha256_hash: r.sha256_hash,
        object_url: `${base}/q/object/${encodeURIComponent(r.object_key)}`,
        permalink_url: `${base}/c/${encodeURIComponent(r.object_key)}`,
        created_at: r.created_at,
      });
    }

    return {
      status: FEEDBACK_STEPS_UPLOADS_GRID.http_ok,
      body: {
        ok: true,
        schema: FEEDBACK_STEPS_UPLOADS_GRID.feedback_schema_version,
        total_recent_reports: reports.length,
        counts_by_signal_kind: bySignalKind,
        counts_by_issue_kind: byIssueKind,
        counts_by_http_status: byHttpStatus,
        submit_instructions: {
          endpoint: `${base}/q/feedback`,
          root_alias: `${base}/feedback`,
          inline_submit_field: "proactive_observations (array inside POST /q/submit)",
          anonymous_allowed: true,
          authenticated_diagnostic_cred_bonus: FEEDBACK_STEPS_UPLOADS_GRID.diagnostic_cred_points,
          gzip_supported: true,
          freeform_or_structured_supported: true,
          max_field_bytes: bounds.feedback_field_max_bytes,
          max_envelope_bytes: bounds.feedback_envelope_max_bytes,
          truncation_policy: "never_truncate_reject_413_above_bounds",
          accepted_signal_kinds: [
            "bug_or_error",
            "data_inconsistency",
            "efficiency_concern",
            "better_or_alternative_way",
            "training_signal",
            "worker_issue_report",
          ],
          accepted_fields: [
            "signal_kind",
            "target_component",
            "observation",
            "proposed_alternative",
            "severity_milli",
            "issue_kind",
            "endpoint",
            "http_status",
            "error_code",
            "payload_bytes",
            "summary",
            "detail",
            "reproduction",
            "client_harness",
            "step_mode",
            "agent_id",
            "worker_uuid",
            "worker_token",
          ],
        },
        reports,
      },
    };
  }

  if (method !== "POST") {
    return {
      status: FEEDBACK_STEPS_UPLOADS_GRID.http_method_not_allowed,
      body: { ok: false, error: "method_not_allowed" },
    };
  }

  const rawRead = await readPossiblyGzippedBytes(request, bounds.feedback_envelope_max_bytes);
  if (rawRead.payloadTooLarge) {
    return {
      status: FEEDBACK_STEPS_UPLOADS_GRID.http_payload_too_large,
      body: {
        ok: false,
        error: "feedback_too_large",
        code: "feedback_too_large",
        max_field_bytes: bounds.feedback_field_max_bytes,
        max_envelope_bytes: bounds.feedback_envelope_max_bytes,
        actual_bytes: rawRead.actual_bytes,
      },
    };
  }
  if (rawRead.invalidGzip || rawRead.invalidEncoding) {
    return {
      status: FEEDBACK_STEPS_UPLOADS_GRID.http_bad_request,
      body: { ok: false, code: "invalid_gzip", detail: rawRead.detail },
    };
  }

  const rawText = new TextDecoder().decode(rawRead.bytes);
  const contentType = (request.headers.get("content-type") || "").toLowerCase();
  let params = Object.fromEntries(url.searchParams.entries());
  if (rawText.trim()) {
    if (contentType.includes("application/json") || rawText.trim().startsWith("{")) {
      try {
        const parsedBody = JSON.parse(rawText);
        if (typeof parsedBody === "string") {
          params = { ...params, observation: parsedBody };
        } else {
          params = { ...params, ...(parsedBody || {}) };
        }
      } catch {
        return {
          status: FEEDBACK_STEPS_UPLOADS_GRID.http_bad_request,
          body: { ok: false, code: "invalid_json", detail: "Invalid JSON body on POST /q/feedback." },
        };
      }
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const formEntries = Object.fromEntries(new URLSearchParams(rawText).entries());
      params = { ...params, ...formEntries };
    } else {
      params = { ...params, observation: params.observation || rawText.trim(), detail: params.detail || rawText };
    }
  }

  const encoder = new TextEncoder();
  const checkedFeedbackFields = [
    "observation",
    "summary",
    "message",
    "feedback",
    "detail",
    "description",
    "title",
    "proposed_alternative",
    "better_way",
    "proposed_change",
    "reproduction",
  ];
  for (const fieldName of checkedFeedbackFields) {
    if (params[fieldName] === undefined || params[fieldName] === null) continue;
    const fieldStr =
      typeof params[fieldName] === "object" ? JSON.stringify(params[fieldName]) : String(params[fieldName]);
    const fieldByteLen = encoder.encode(fieldStr).byteLength;
    if (fieldByteLen > bounds.feedback_field_max_bytes) {
      return {
        status: FEEDBACK_STEPS_UPLOADS_GRID.http_payload_too_large,
        body: {
          ok: false,
          error: "feedback_too_large",
          code: "feedback_too_large",
          field: fieldName,
          max_field_bytes: bounds.feedback_field_max_bytes,
          max_envelope_bytes: bounds.feedback_envelope_max_bytes,
          actual_bytes: fieldByteLen,
        },
      };
    }
  }

  const scrub = gatewayOps?.scrubSensitiveText || ((s) => String(s || ""));
  const cleanAgent = gatewayOps?.cleanAgentId
    ? gatewayOps.cleanAgentId(params.agent_id || params.agent || "anonymous-reporter")
    : String(params.agent_id || "anonymous-reporter")
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .slice(0, 48) || "anonymous-reporter";
  const rawUuid = String(params.worker_uuid || params.uuid || "").trim();
  const presentedToken = String(
    params.worker_token || request.headers.get("x-herma-worker-token") || url.searchParams.get("worker_token") || ""
  ).trim();

  let tokenVerified = false;
  let verifiedWorkerUuid = "";
  if (presentedToken && gatewayOps?.verifyWorkerUuidAccess) {
    const authRes = await gatewayOps.verifyWorkerUuidAccess({
      agentId: cleanAgent,
      workerUuid: rawUuid,
      workerToken: presentedToken,
      infraAllowed,
    });
    if (authRes?.ok && authRes?.tokenVerified) {
      tokenVerified = true;
      verifiedWorkerUuid = authRes.existing?.worker_uuid || rawUuid;
    }
  }

  const issueKind =
    scrub(scrubCapabilityTokensFromReport(params.issue_kind || params.kind || params.signal_kind || "gateway_friction"))
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32) || "gateway_friction";
  const endpointStr = scrub(
    scrubCapabilityTokensFromReport(params.endpoint || params.path || params.target_component || "")
  ).slice(0, FEEDBACK_STEPS_UPLOADS_GRID.endpoint_max_len);
  const httpStatus = params.http_status != null && params.http_status !== "" ? Number(params.http_status) : null;
  const errorCode = scrub(scrubCapabilityTokensFromReport(params.error_code || params.code || "")).slice(
    0,
    FEEDBACK_STEPS_UPLOADS_GRID.code_max_len
  );
  const payloadBytes = params.payload_bytes != null && params.payload_bytes !== "" ? Number(params.payload_bytes) : null;

  const autoDiagnosis = buildAutoDiagnosis({
    issueKind,
    endpoint: endpointStr,
    httpStatus,
    errorCode,
    payloadBytes,
    publicUrl: base,
  });

  const legacyIssueKindMode = Boolean(
    (params.issue_kind || params.kind) &&
      !params.signal_kind &&
      !params.observation &&
      !params.proposed_alternative
  );

  const ingestOut = await ingestCatchAllFeedbackObservation(db, env, {
    rawPayload: {
      ...params,
      issue_kind: params.issue_kind || params.kind || undefined,
      endpoint: endpointStr,
      http_status: httpStatus,
      error_code: errorCode,
      payload_bytes: payloadBytes,
    },
    cleanAgent,
    verifiedWorkerUuid,
    tokenVerified,
    infraAllowed,
    publicUrl: base,
    gatewayOps,
    mirrorFn: gatewayOps?.mirrorPublicArtifactToTesseraAnonymous || null,
    autoDiagnosis,
    legacyIssueKindMode,
  });

  if (ingestOut.payloadTooLarge) {
    return {
      status: FEEDBACK_STEPS_UPLOADS_GRID.http_payload_too_large,
      body: {
        ok: false,
        error: "feedback_too_large",
        code: "feedback_too_large",
        ...(ingestOut.field ? { field: ingestOut.field } : {}),
        max_field_bytes: bounds.feedback_field_max_bytes,
        max_envelope_bytes: bounds.feedback_envelope_max_bytes,
        actual_bytes: ingestOut.actual_bytes,
      },
    };
  }

  return {
    status: FEEDBACK_STEPS_UPLOADS_GRID.http_ok,
    body: {
      ok: true,
      schema: FEEDBACK_STEPS_UPLOADS_GRID.feedback_schema_version,
      truncated: false,
      accepted_bytes: ingestOut.accepted_bytes,
      accepted_envelope_bytes: rawRead.bytes.byteLength,
      max_field_bytes: bounds.feedback_field_max_bytes,
      max_envelope_bytes: bounds.feedback_envelope_max_bytes,
      authenticated_reporter: tokenVerified,
      diagnostic_cred_awarded: ingestOut.diagnostic_cred_awarded,
      fingerprint: ingestOut.fingerprint,
      stored_object_key: ingestOut.stored_object_key,
      signal_kind: ingestOut.signal_kind,
      severity_milli: ingestOut.severity_milli,
      distinct_reporter_count: ingestOut.distinct_reporter_count,
      review_verb_id: ingestOut.review_verb_id,
      spawned_review_verb: ingestOut.spawned_review_verb,
      promoted_to_proposal: ingestOut.promoted_to_proposal,
      emitted_training_signal: ingestOut.emitted_training_signal,
      stored_issue_object: ingestOut.stored_issue_object,
      auto_diagnosis: autoDiagnosis,
    },
  };
}

// What a client chose, as SQL on the columns it can use, so a short page is never only what a filter left.
function preferenceWhere(prefs, kindColumns, timeColumn = "created_at") {
  let where = "";
  const binds = [];
  if (prefs.updated_after != null) {
    where += ` AND ${timeColumn} >= ?`;
    binds.push(new Date(prefs.updated_after * 1000).toISOString());
  }
  if (prefs.source_kinds) {
    const kinds = prefs.source_kinds.slice(0, 20);
    const marks = kinds.map(() => "?").join(", ");
    where += ` AND (${kindColumns.map((column) => `LOWER(COALESCE(${column}, '')) IN (${marks})`).join(" OR ")})`;
    for (const _ of kindColumns) binds.push(...kinds);
  }
  return { where, binds };
}
const secondsOf = (value) => Date.parse(String(value)) / 1000;

export async function handleListDurableTasksRequest(url, db, publicUrl, { infraAllowed = false } = {}) {
  const base = String(publicUrl || "https://shim.teleionlabs.com").replace(/\/+$/, "");
  const visFilter = infraAllowed
    ? "visibility IN ('public_ngo', 'public_commons', 'server_infra')"
    : "visibility IN ('public_ngo', 'public_commons')";

  const prefs = readClientPrefs(url.searchParams);
  const stateFilter = String(url.searchParams.get("state") || "").trim().toLowerCase();
  const tierFilter = String(url.searchParams.get("tier") || "").trim().toLowerCase();
  const stepModeFilter = normalizeStepMode(url.searchParams.get("step_mode") || "");
  const verbKindFilter = String(url.searchParams.get("verb_kind") || "").trim().toLowerCase();
  const categoryFilter = String(url.searchParams.get("category") || "").trim();
  const limit = Math.max(
    1,
    Math.min(
      FEEDBACK_STEPS_UPLOADS_GRID.max_list_limit,
      Math.floor(Number(prefs.max_results || url.searchParams.get("limit")) || FEEDBACK_STEPS_UPLOADS_GRID.default_list_limit)
    )
  );
  const offsetAsked = Math.floor(Number(url.searchParams.get("offset")) || 0);
  const offset = Number.isSafeInteger(offsetAsked) && offsetAsked > 0 ? offsetAsked : 0;

  if (tierFilter === "infra_private" && !infraAllowed) {
    return {
      status: FEEDBACK_STEPS_UPLOADS_GRID.http_forbidden,
      body: { ok: false, code: "forbidden_tier" },
    };
  }

  let where = `WHERE ${visFilter}`;
  const binds = [];
  if (stateFilter && ["ready", "leased", "done"].includes(stateFilter)) {
    where += " AND state = ?";
    binds.push(stateFilter);
  }
  if (tierFilter) {
    where += " AND tier = ?";
    binds.push(tierFilter);
  }
  if (stepModeFilter) {
    where += " AND step_mode = ?";
    binds.push(stepModeFilter);
  }
  if (verbKindFilter) {
    where += " AND LOWER(verb_kind) = ?";
    binds.push(verbKindFilter);
  }
  if (categoryFilter) {
    where += " AND category = ?";
    binds.push(categoryFilter);
  }

  const chosen = preferenceWhere(prefs, ["verb_kind", "category", "tier"], "COALESCE(updated_at, created_at)");
  where += chosen.where;
  binds.push(...chosen.binds);
  const taskVerdict = (verdicts) => `(EXISTS (SELECT 1 FROM herma_evaluations e WHERE e.target_kind = 'task' AND e.target_id = herma_durable_queue.task_id AND e.${TRUSTED_TASK_EVALUATION_SQL} AND ${verdicts}))`;
  const taskConfirmed = taskVerdict("UPPER(COALESCE(e.verification_verdict, '')) IN ('CONFIRMED', 'PASS')");
  const taskFailed = taskVerdict("(UPPER(COALESCE(e.verification_verdict, '')) LIKE 'FAIL%' OR UPPER(COALESCE(e.verification_verdict, '')) LIKE 'REJECT%' OR UPPER(COALESCE(e.verification_verdict, '')) LIKE 'REFUT%')");
  where += reviewWhere(prefs, { reviewedSql: taskConfirmed, failedSql: taskFailed });
  // Rows for our own workers, whatever their visibility says.
  if (!infraAllowed) where += " AND tier != 'infra_private'";

  const [countRow, rowsRes] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS cnt FROM herma_durable_queue ${where}`).bind(...binds).first(),
    db
      .prepare(
        `SELECT task_id, tier, visibility, verb_kind, category, priority, state, title, prompt,
                complexity_milli, generation_depth, owner_worker_uuid, blocked_by_task_id,
                COALESCE(step_mode, '') AS step_mode, lsh_band_0, updated_at, created_at,
                ${taskConfirmed} AS eval_count,
                CASE WHEN ${taskFailed} THEN 'FAILED' WHEN ${taskConfirmed} THEN 'CONFIRMED' ELSE '' END AS verification_verdict
         FROM herma_durable_queue
         ${where}
         ORDER BY (CASE state WHEN 'ready' THEN 0 WHEN 'leased' THEN 1 ELSE 2 END) ASC,
                  (CASE tier WHEN 'infra_private' THEN 0 WHEN 'ngo_priority' THEN 1 ELSE 2 END) ASC,
                  priority DESC, id DESC
         LIMIT ? OFFSET ?`
      )
      .bind(...binds, limit, offset)
      .all(),
  ]);

  const tasks = (rowsRes?.results || []).map((r) => {
    const inferred = r.step_mode
      ? { step_mode: r.step_mode }
      : inferStepAndReuseMode({
          verbKind: r.verb_kind,
          category: r.category,
          title: r.title,
          prompt: r.prompt,
        });
    return {
      ...r,
      step_mode: inferred.step_mode,
      task_url: `${base}/q/task/${encodeURIComponent(r.task_id)}`,
      permalink_url: `${base}/c/${encodeURIComponent(r.task_id)}`,
      ...reviewLabels(r),
    };
  });
  const shownTasks = tasks;
  const fittedTasks = applyClientPrefs(shownTasks, { ...prefs, include_unreviewed: true, review_state: null, updated_after: null, source_kinds: null, max_results: null }, { stateOf: (r) => r.review_state, timeOf: (r) => secondsOf(r.created_at), kindsOf: () => [] });

  return {
    status: FEEDBACK_STEPS_UPLOADS_GRID.http_ok,
    body: {
      ok: true,
      schema: FEEDBACK_STEPS_UPLOADS_GRID.tasks_list_schema_version,
      total_matching: Number(countRow?.cnt || tasks.length),
      next_offset: offset + Math.max(1, rowsReadFor(prefs, tasks, fittedTasks)) < Number(countRow?.cnt || 0) ? offset + Math.max(1, rowsReadFor(prefs, tasks, fittedTasks)) : null,
      preferences: fittedTasks.report,
      limit,
      offset,
      filters: {
        state: stateFilter || null,
        tier: tierFilter || null,
        step_mode: stepModeFilter || null,
        verb_kind: verbKindFilter || null,
        category: categoryFilter || null,
      },
      tasks: fittedTasks.items,
    },
  };
}

export async function handleListTaskObjectsRequest(url, db, publicUrl, { infraAllowed = false } = {}) {
  const base = String(publicUrl || "https://shim.teleionlabs.com").replace(/\/+$/, "");
  const visFilter = infraAllowed
    ? "visibility IN ('public_ngo', 'public_commons', 'server_infra')"
    : "visibility IN ('public_ngo', 'public_commons')";

  const categoryFilter = String(url.searchParams.get("category") || "").trim();
  const stepModeFilter = normalizeStepMode(url.searchParams.get("step_mode") || "");
  const reuseModeFilter = String(url.searchParams.get("reuse_mode") || "").trim().toLowerCase();
  const producerFilter = String(url.searchParams.get("producer") || "").trim();
  const prefs = readClientPrefs(url.searchParams);
  const limit = Math.max(
    1,
    Math.min(
      FEEDBACK_STEPS_UPLOADS_GRID.max_list_limit,
      Math.floor(Number(prefs.max_results || url.searchParams.get("limit")) || FEEDBACK_STEPS_UPLOADS_GRID.default_list_limit)
    )
  );
  const offsetAsked = Math.floor(Number(url.searchParams.get("offset")) || 0);
  const offset = Number.isSafeInteger(offsetAsked) && offsetAsked > 0 ? offsetAsked : 0;

  let where = `WHERE ${visFilter} AND COALESCE(is_tombstoned, 0) = 0`;
  const binds = [];
  if (categoryFilter) {
    where += " AND category = ?";
    binds.push(categoryFilter);
  }
  if (stepModeFilter) {
    where += " AND step_mode = ?";
    binds.push(stepModeFilter);
  }
  if (reuseModeFilter && REUSE_MODES.includes(reuseModeFilter)) {
    where += " AND reuse_mode = ?";
    binds.push(reuseModeFilter);
  }
  if (producerFilter) {
    where += " AND producer_agent = ?";
    binds.push(producerFilter);
  }

  const chosen = preferenceWhere(prefs, ["category", "deliverable_kind", "reuse_mode", "step_mode"]);
  where += chosen.where + reviewWhere(prefs);
  binds.push(...chosen.binds);

  const [countRow, rowsRes] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS cnt FROM herma_task_objects ${where}`).bind(...binds).first(),
    db
      .prepare(
        `SELECT object_key, COALESCE(version_num, 1) AS version_num, category, visibility,
                producer_agent, worker_uuid, source_task_id, summary, sha256_hash,
                chunk_count, total_payload_bytes, quality_milli, eval_count, verification_verdict,
                COALESCE(step_mode, '') AS step_mode, COALESCE(reuse_mode, '') AS reuse_mode,
                deliverable_kind, created_at
         FROM herma_task_objects
         ${where}
         ORDER BY id DESC
         LIMIT ? OFFSET ?`
      )
      .bind(...binds, limit, offset)
      .all(),
  ]);

  const objects = (rowsRes?.results || []).map((r) => {
    const inferred =
      r.step_mode && r.reuse_mode
        ? { step_mode: r.step_mode, reuse_mode: r.reuse_mode }
        : inferStepAndReuseMode({
            explicitStepMode: r.step_mode,
            explicitReuseMode: r.reuse_mode,
            category: r.category,
            deliverableKind: r.deliverable_kind,
            summary: r.summary,
          });
    return {
      ...r,
      step_mode: inferred.step_mode,
      reuse_mode: inferred.reuse_mode,
      object_url: `${base}/q/object/${encodeURIComponent(r.object_key)}`,
      permalink_url: `${base}/c/${encodeURIComponent(r.object_key)}`,
      ...reviewLabels(r),
    };
  });
  const shownObjects = objects;
  const fittedObjects = applyClientPrefs(shownObjects, { ...prefs, include_unreviewed: true, review_state: null, updated_after: null, source_kinds: null, max_results: null }, { stateOf: (r) => r.review_state, timeOf: (r) => secondsOf(r.created_at), kindsOf: () => [] });

  return {
    status: FEEDBACK_STEPS_UPLOADS_GRID.http_ok,
    body: {
      ok: true,
      schema: FEEDBACK_STEPS_UPLOADS_GRID.objects_list_schema_version,
      total_matching: Number(countRow?.cnt || objects.length),
      next_offset: offset + Math.max(1, rowsReadFor(prefs, objects, fittedObjects)) < Number(countRow?.cnt || 0) ? offset + Math.max(1, rowsReadFor(prefs, objects, fittedObjects)) : null,
      preferences: fittedObjects.report,
      limit,
      offset,
      filters: {
        category: categoryFilter || null,
        step_mode: stepModeFilter || null,
        reuse_mode: reuseModeFilter || null,
        producer: producerFilter || null,
      },
      objects: fittedObjects.items,
    },
  };
}

async function persistBlobBytesAndOptionalObject(
  db,
  {
    bytes,
    filename = "",
    contentType = "application/octet-stream",
    visibility = "public_commons",
    agentId = "anonymous-uploader",
    workerUuid = "",
    objectSpec = null,
    publicUrl = "https://shim.teleionlabs.com",
    gatewayOps = null,
  }
) {
  const base = String(publicUrl || "https://shim.teleionlabs.com").replace(/\/+$/, "");
  const totalBytes = bytes.byteLength;
  const sha256Hash = await sha256HexBytes(bytes);
  const chunkSize = FEEDBACK_STEPS_UPLOADS_GRID.blob_chunk_bytes;
  const chunkCount = Math.max(1, Math.ceil(totalBytes / chunkSize));
  const nowIso = new Date().toISOString();

  let registeredObject = null;
  const linkedObjKeyCandidate =
    objectSpec && (objectSpec.register_task_object || objectSpec.object_key)
      ? String(objectSpec.object_key || `blob_${filename || sha256Hash.slice(0, 12)}_v1`)
      : "";
  const sanitizeKey = gatewayOps?.sanitizeObjectKeyPreservingSuffix || ((k) => k.slice(0, 120));
  let cleanLinkedKey = linkedObjKeyCandidate
    ? sanitizeKey(linkedObjKeyCandidate, FEEDBACK_STEPS_UPLOADS_GRID.object_key_max_len)
    : "";
  // An upload never adds a version to a key that's already there; its bytes keep their own key.
  if (
    cleanLinkedKey &&
    ((await db.prepare("SELECT 1 AS hit FROM herma_task_objects WHERE object_key = ? OR requested_object_key = ? LIMIT 1").bind(cleanLinkedKey, cleanLinkedKey).first()) ||
      (await db.prepare("SELECT 1 AS hit FROM herma_object_aliases WHERE alias_key = ? LIMIT 1").bind(cleanLinkedKey).first()) ||
      (cleanLinkedKey.startsWith("verb_") && (await db.prepare("SELECT 1 AS hit FROM herma_durable_queue WHERE task_id = ? LIMIT 1").bind(cleanLinkedKey).first())))
  ) {
    cleanLinkedKey = sanitizeKey(`${cleanLinkedKey}__upload_${sha256Hash.slice(0, 12)}_${await sha256HexBytes(new TextEncoder().encode(String(agentId))).then((h) => h.slice(0, 8))}`, FEEDBACK_STEPS_UPLOADS_GRID.object_key_max_len);
  }

  await db
    .prepare(
      `INSERT OR REPLACE INTO herma_blob_store
       (sha256_hash, content_type, filename, total_bytes, chunk_count, visibility,
        producer_agent, worker_uuid, linked_object_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      sha256Hash,
      String(contentType || "application/octet-stream").slice(0, 120),
      String(filename || "").slice(0, 180),
      totalBytes,
      chunkCount,
      visibility,
      agentId,
      workerUuid,
      cleanLinkedKey,
      nowIso
    )
    .run();

  const chunkStmts = [];
  for (let idx = 0; idx < chunkCount; idx += 1) {
    const start = idx * chunkSize;
    const end = Math.min(start + chunkSize, totalBytes);
    const slice = bytes.subarray(start, end);
    const b64 = uint8ToBase64(slice);
    chunkStmts.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO herma_blob_chunks (sha256_hash, chunk_idx, chunk_b64, byte_len)
           VALUES (?, ?, ?, ?)`
        )
        .bind(sha256Hash, idx, b64, slice.byteLength)
    );
  }

  const batchCap = FEEDBACK_STEPS_UPLOADS_GRID.batch_write_stmt_limit;
  for (let offset = 0; offset < chunkStmts.length; offset += batchCap) {
    await db.batch(chunkStmts.slice(offset, offset + batchCap));
  }

  if (cleanLinkedKey) {
    // That label is the server's own note that a worker token made the row; an upload has none.
    const rawCategory = String(objectSpec?.category || "multimodal_asset_kit").slice(0, 48);
    const category = rawCategory.trim() === "made_with_worker_token:true" ? "multimodal_asset_kit" : rawCategory;
    const summary = String(
      objectSpec?.summary || `Uploaded ${totalBytes} byte artifact (${filename || contentType})`
    ).slice(0, FEEDBACK_STEPS_UPLOADS_GRID.summary_max_len);
    const stepMeta = inferStepAndReuseMode({
      explicitStepMode: objectSpec?.step_mode || "atomic_build_step",
      category,
      summary,
      payloadObj: { blob_uri: `${base}/q/blob/${sha256Hash}` },
    });
    const envelopePayload = {
      blob_uri: `${base}/q/blob/${sha256Hash}`,
      blob_sha256: sha256Hash,
      filename: filename || null,
      content_type: contentType,
      total_bytes: totalBytes,
      chunk_count: chunkCount,
      ...(objectSpec?.metadata && typeof objectSpec.metadata === "object" ? { metadata: objectSpec.metadata } : {}),
    };
    const envJson = JSON.stringify(envelopePayload);
    const envSha = await sha256HexBytes(new TextEncoder().encode(envJson));
    const uploadTax = enrichTaxonomyRecord({
      object_key: cleanLinkedKey,
      category,
      summary,
      step_mode: stepMeta.step_mode,
      reuse_mode: stepMeta.reuse_mode,
      labels: [category, "blob_cas"],
      payload: envelopePayload,
    });
    const idxMeta = gatewayOps?.indexSidecarDocument
      ? await gatewayOps.indexSidecarDocument({
          title: cleanLinkedKey,
          bodyText: `${summary} ${filename} ${contentType}`,
          category,
          labels: uploadTax.labels,
          inputContract: "blob_reference",
          outputContract: category,
          searchHints: uploadTax.search_hints,
        })
      : {
          simhash64_hex: "0000000000000000",
          partition_slot: 0,
          input_shape_hash: "blob_in",
          output_shape_hash: "blob_out",
          lsh_band_0: "b0_0000",
          lsh_band_1: "b1_0000",
          content_sha256: envSha,
        };

    await db
      .prepare(
        `INSERT INTO herma_task_objects
         (object_key, requested_object_key, version_num, category, visibility, producer_agent, source_task_id, summary, payload_json,
          simhash64_hex, sha256_hash, tessera_synced, created_at,
          partition_slot, labels_json, input_shape_hash, output_shape_hash, lsh_band_0, lsh_band_1,
          quality_milli, content_sha256, worker_uuid, generation_depth,
          intent_bucket, opt_goal, target_env, prog_lang, deliverable_kind, search_hints_json,
          chunk_count, total_payload_bytes, verification_verdict, step_mode, reuse_mode)
         VALUES (?, ?, 1, ?, ?, ?, 'blob_upload', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?, ?, ?, ?, ?, 0, ?, 'UNREVIEWED', ?, ?)`
      )
      .bind(
        cleanLinkedKey,
        cleanLinkedKey,
        category,
        visibility,
        agentId,
        summary,
        envJson,
        idxMeta.simhash64_hex,
        envSha,
        visibility !== "server_infra" ? 1 : 0,
        nowIso,
        idxMeta.partition_slot,
        JSON.stringify(uploadTax.labels),
        idxMeta.input_shape_hash,
        idxMeta.output_shape_hash,
        idxMeta.lsh_band_0,
        idxMeta.lsh_band_1,
        idxMeta.content_sha256,
        workerUuid,
        uploadTax.intent_bucket,
        uploadTax.opt_goal,
        uploadTax.target_env,
        uploadTax.prog_lang,
        uploadTax.deliverable_kind,
        uploadTax.search_hints_json,
        totalBytes,
        stepMeta.step_mode,
        stepMeta.reuse_mode
      )
      .run();

    registeredObject = {
      object_key: cleanLinkedKey,
      category,
      step_mode: stepMeta.step_mode,
      reuse_mode: stepMeta.reuse_mode,
      object_url: `${base}/q/object/${encodeURIComponent(cleanLinkedKey)}`,
      permalink_url: `${base}/c/${encodeURIComponent(cleanLinkedKey)}`,
    };
  }

  return {
    sha256_hash: sha256Hash,
    total_bytes: totalBytes,
    chunk_count: chunkCount,
    content_type: contentType,
    filename: filename || null,
    visibility,
    blob_url: `${base}/q/blob/${sha256Hash}`,
    registered_task_object: registeredObject,
  };
}

export async function handleUploadRequest(
  request,
  url,
  db,
  publicUrl,
  { infraAllowed = false, segments = [], gatewayOps = null } = {}
) {
  await ensureFeedbackStepsAndUploadsSchema(db);
  const method = request.method.toUpperCase();
  const base = String(publicUrl || "https://shim.teleionlabs.com").replace(/\/+$/, "");
  const seg2 = String(segments[2] || "").trim();
  const seg3 = String(segments[3] || "").trim();

  if (method === "GET" && !seg2) {
    return {
      status: FEEDBACK_STEPS_UPLOADS_GRID.http_ok,
      body: {
        ok: true,
        schema: FEEDBACK_STEPS_UPLOADS_GRID.upload_schema_version,
        max_upload_bytes: FEEDBACK_STEPS_UPLOADS_GRID.max_upload_bytes,
        chunk_size_bytes: FEEDBACK_STEPS_UPLOADS_GRID.blob_chunk_bytes,
        gzip_supported: true,
        modes: {
          single_shot: `POST ${base}/q/upload (raw binary, Content-Encoding: gzip, or JSON with data_base64 / content / payload)`,
          resumable_init: `POST ${base}/q/upload/init`,
          resumable_part: `PUT or POST ${base}/q/upload/<upload_id>/<part_idx>`,
          resumable_complete: `POST ${base}/q/upload/<upload_id>/complete`,
          blob_download: `GET ${base}/q/blob/<sha256_hash>`,
        },
      },
    };
  }

  // 1. Resumable init: POST /q/upload/init
  if (seg2 === "init") {
    if (method !== "POST") {
      return {
        status: FEEDBACK_STEPS_UPLOADS_GRID.http_method_not_allowed,
        body: { ok: false, error: "method_not_allowed" },
      };
    }
    const parsed = await readPossiblyGzippedJson(request);
    if (parsed.invalidJson || parsed.invalidGzip) {
      return {
        status: FEEDBACK_STEPS_UPLOADS_GRID.http_bad_request,
        body: { ok: false, code: "invalid_json" },
      };
    }
    const body = parsed.json || {};
    if ((body.visibility === "server_infra" || body.tier === "infra_private") && !infraAllowed) {
      return {
        status: FEEDBACK_STEPS_UPLOADS_GRID.http_forbidden,
        body: { ok: false, code: "forbidden_tier" },
      };
    }
    const randHex = Array.from(
      crypto.getRandomValues(new Uint8Array(FEEDBACK_STEPS_UPLOADS_GRID.upload_id_random_bytes)),
      (b) => b.toString(16).padStart(2, "0")
    ).join("");
    const uploadId = `upl_${randHex}`;
    const nowIso = new Date().toISOString();
    const cleanAgent = gatewayOps?.cleanAgentId
      ? gatewayOps.cleanAgentId(body.agent_id || "anonymous-uploader")
      : String(body.agent_id || "anonymous-uploader").slice(0, 48);
    const vis =
      infraAllowed && (body.visibility === "server_infra" || body.tier === "infra_private")
        ? "server_infra"
        : "public_commons";
    const objSpec = {
      object_key: body.object_key || "",
      category: body.category || "multimodal_asset_kit",
      summary: body.summary || "",
      step_mode: body.step_mode || "atomic_build_step",
      register_task_object: Boolean(body.register_task_object || body.object_key),
      metadata: body.metadata || null,
    };

    await db
      .prepare(
        `INSERT INTO herma_upload_sessions
         (upload_id, agent_id, worker_uuid, filename, content_type, visibility, expected_sha256, object_spec_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
      )
      .bind(
        uploadId,
        cleanAgent,
        String(body.worker_uuid || "").slice(0, 64),
        String(body.filename || "").slice(0, 180),
        String(body.content_type || "application/octet-stream").slice(0, 120),
        vis,
        String(body.expected_sha256 || "").toLowerCase().slice(0, 64),
        JSON.stringify(objSpec),
        nowIso,
        nowIso
      )
      .run();

    return {
      status: FEEDBACK_STEPS_UPLOADS_GRID.http_created,
      body: {
        ok: true,
        schema: FEEDBACK_STEPS_UPLOADS_GRID.upload_schema_version,
        upload_id: uploadId,
        chunk_size_bytes: FEEDBACK_STEPS_UPLOADS_GRID.blob_chunk_bytes,
        max_bytes: FEEDBACK_STEPS_UPLOADS_GRID.max_upload_bytes,
        part_url_template: `${base}/q/upload/${uploadId}/{part_idx}`,
        complete_url: `${base}/q/upload/${uploadId}/complete`,
      },
    };
  }

  // 2. Resumable part or complete: /q/upload/<upload_id>/<part_idx | complete>
  if (seg2.startsWith("upl_")) {
    const sess = await db
      .prepare("SELECT * FROM herma_upload_sessions WHERE upload_id = ? LIMIT 1")
      .bind(seg2)
      .first();
    if (!sess) {
      return {
        status: FEEDBACK_STEPS_UPLOADS_GRID.http_not_found,
        body: { ok: false, code: "upload_session_not_found", upload_id: seg2 },
      };
    }

    if (seg3 === "complete") {
      if (method !== "POST") {
        return {
          status: FEEDBACK_STEPS_UPLOADS_GRID.http_method_not_allowed,
          body: { ok: false, error: "method_not_allowed" },
        };
      }
      let completeBody = {};
      try {
        const rawComp = await readPossiblyGzippedBytes(request);
        if (!rawComp.payloadTooLarge && rawComp.bytes && rawComp.bytes.byteLength > 0) {
          completeBody = JSON.parse(new TextDecoder().decode(rawComp.bytes));
        }
      } catch {
        completeBody = {};
      }

      const partCountRow = await db
        .prepare("SELECT COUNT(*) AS cnt, COALESCE(SUM(byte_len), 0) AS total_bytes FROM herma_upload_parts WHERE upload_id = ?")
        .bind(seg2)
        .first();
      const partCount = Number(partCountRow?.cnt || 0);
      const totalBytes = Number(partCountRow?.total_bytes || 0);
      if (partCount === 0) {
        return {
          status: FEEDBACK_STEPS_UPLOADS_GRID.http_bad_request,
          body: { ok: false, code: "no_parts_uploaded", upload_id: seg2 },
        };
      }
      if (totalBytes > FEEDBACK_STEPS_UPLOADS_GRID.max_upload_bytes) {
        return {
          status: FEEDBACK_STEPS_UPLOADS_GRID.http_payload_too_large,
          body: {
            ok: false,
            code: "payload_too_large",
            max_bytes: FEEDBACK_STEPS_UPLOADS_GRID.max_upload_bytes,
            actual_bytes: totalBytes,
          },
        };
      }

      const fullBytes = new Uint8Array(totalBytes);
      let writeOffset = 0;
      const pageSize = FEEDBACK_STEPS_UPLOADS_GRID.chunk_read_page_size;
      for (let pageOffset = 0; pageOffset < partCount; pageOffset += pageSize) {
        const pageRes = await db
          .prepare(
            "SELECT part_idx, chunk_b64 FROM herma_upload_parts WHERE upload_id = ? ORDER BY part_idx ASC LIMIT ? OFFSET ?"
          )
          .bind(seg2, pageSize, pageOffset)
          .all();
        const rows = pageRes?.results || [];
        if (rows.length === 0) break;
        for (const r of rows) {
          const decoded = base64ToUint8(r.chunk_b64);
          fullBytes.set(decoded, writeOffset);
          writeOffset += decoded.byteLength;
        }
      }

      const computedSha = await sha256HexBytes(fullBytes);
      const expectedSha = String(completeBody.expected_sha256 || sess.expected_sha256 || "").trim().toLowerCase();
      if (expectedSha && expectedSha !== computedSha) {
        return {
          status: FEEDBACK_STEPS_UPLOADS_GRID.http_conflict,
          body: {
            ok: false,
            code: "sha256_mismatch",
            expected_sha256: expectedSha,
            computed_sha256: computedSha,
          },
        };
      }

      let storedObjSpec = {};
      try {
        storedObjSpec = JSON.parse(sess.object_spec_json || "{}");
      } catch {
        storedObjSpec = {};
      }
      const mergedObjSpec = {
        ...storedObjSpec,
        ...(completeBody.object_key ? { object_key: completeBody.object_key, register_task_object: true } : {}),
        ...(completeBody.register_task_object ? { register_task_object: true } : {}),
        ...(completeBody.summary ? { summary: completeBody.summary } : {}),
        ...(completeBody.category ? { category: completeBody.category } : {}),
      };

      const persisted = await persistBlobBytesAndOptionalObject(db, {
        bytes: fullBytes,
        filename: sess.filename,
        contentType: sess.content_type,
        visibility: sess.visibility,
        agentId: sess.agent_id,
        workerUuid: sess.worker_uuid,
        objectSpec: mergedObjSpec,
        publicUrl: base,
        gatewayOps,
      });

      await db.batch([
        db
          .prepare("UPDATE herma_upload_sessions SET status = 'completed', updated_at = ? WHERE upload_id = ?")
          .bind(new Date().toISOString(), seg2),
        db.prepare("DELETE FROM herma_upload_parts WHERE upload_id = ?").bind(seg2),
      ]);

      return {
        status: FEEDBACK_STEPS_UPLOADS_GRID.http_created,
        body: {
          ok: true,
          schema: FEEDBACK_STEPS_UPLOADS_GRID.upload_schema_version,
          upload_id: seg2,
          resumable_completed: true,
          parts_assembled: partCount,
          ...persisted,
        },
      };
    }

    // Upload part: PUT or POST /q/upload/<upload_id>/<part_idx>
    if (method !== "PUT" && method !== "POST") {
      return {
        status: FEEDBACK_STEPS_UPLOADS_GRID.http_method_not_allowed,
        body: { ok: false, error: "method_not_allowed" },
      };
    }
    const partIdx = Number(seg3);
    if (!Number.isInteger(partIdx) || partIdx < 0 || partIdx >= FEEDBACK_STEPS_UPLOADS_GRID.max_blob_chunks) {
      return {
        status: FEEDBACK_STEPS_UPLOADS_GRID.http_bad_request,
        body: {
          ok: false,
          code: "invalid_part_idx",
          detail: `part_idx must be an integer in 0..${FEEDBACK_STEPS_UPLOADS_GRID.max_blob_chunks - 1}.`,
        },
      };
    }
    const partRead = await readPossiblyGzippedBytes(request, FEEDBACK_STEPS_UPLOADS_GRID.max_upload_bytes);
    if (partRead.payloadTooLarge) {
      return {
        status: FEEDBACK_STEPS_UPLOADS_GRID.http_payload_too_large,
        body: { ok: false, code: "payload_too_large", max_bytes: partRead.max_bytes },
      };
    }
    if (partRead.invalidGzip || partRead.invalidEncoding) {
      return {
        status: FEEDBACK_STEPS_UPLOADS_GRID.http_bad_request,
        body: { ok: false, code: "invalid_gzip", detail: partRead.detail },
      };
    }
    let partBytes = partRead.bytes;
    const ct = (request.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("application/json")) {
      try {
        const j = JSON.parse(new TextDecoder().decode(partBytes));
        if (typeof j.data_base64 === "string") {
          partBytes = base64ToUint8(j.data_base64);
        } else if (typeof j.text === "string") {
          partBytes = new TextEncoder().encode(j.text);
        }
      } catch {
        // treat as raw bytes if not wrapper JSON
      }
    }
    const partSha = await sha256HexBytes(partBytes);
    const partB64 = uint8ToBase64(partBytes);
    await db
      .prepare(
        `INSERT OR REPLACE INTO herma_upload_parts (upload_id, part_idx, chunk_b64, byte_len, part_sha256, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(seg2, partIdx, partB64, partBytes.byteLength, partSha, new Date().toISOString())
      .run();

    return {
      status: FEEDBACK_STEPS_UPLOADS_GRID.http_ok,
      body: {
        ok: true,
        upload_id: seg2,
        part_idx: partIdx,
        byte_len: partBytes.byteLength,
        part_sha256: partSha,
      },
    };
  }

  // 3. Single-shot POST /q/upload
  if (method !== "POST") {
    return {
      status: FEEDBACK_STEPS_UPLOADS_GRID.http_method_not_allowed,
      body: { ok: false, error: "method_not_allowed" },
    };
  }

  const rawRead = await readPossiblyGzippedBytes(request, FEEDBACK_STEPS_UPLOADS_GRID.max_decompressed_envelope_bytes);
  if (rawRead.payloadTooLarge) {
    return {
      status: FEEDBACK_STEPS_UPLOADS_GRID.http_payload_too_large,
      body: {
        ok: false,
        code: "payload_too_large",
        max_bytes: FEEDBACK_STEPS_UPLOADS_GRID.max_upload_bytes,
        actual_bytes: rawRead.actual_bytes,
      },
    };
  }
  if (rawRead.invalidGzip || rawRead.invalidEncoding) {
    return {
      status: FEEDBACK_STEPS_UPLOADS_GRID.http_bad_request,
      body: { ok: false, code: "invalid_gzip", detail: rawRead.detail },
    };
  }

  const reqContentType = (request.headers.get("content-type") || "application/octet-stream").trim();
  let uploadBytes = rawRead.bytes;
  let filename = url.searchParams.get("filename") || "";
  let finalContentType = reqContentType;
  let agentId = url.searchParams.get("agent_id") || "anonymous-uploader";
  let workerUuid = url.searchParams.get("worker_uuid") || "";
  let visibility =
    infraAllowed && (url.searchParams.get("visibility") === "server_infra" || url.searchParams.get("tier") === "infra_private")
      ? "server_infra"
      : "public_commons";
  let objSpec = {
    object_key: url.searchParams.get("object_key") || "",
    category: url.searchParams.get("category") || "multimodal_asset_kit",
    summary: url.searchParams.get("summary") || "",
    step_mode: url.searchParams.get("step_mode") || "atomic_build_step",
    register_task_object: Boolean(url.searchParams.get("register_task_object") === "1" || url.searchParams.get("object_key")),
  };

  if (reqContentType.toLowerCase().includes("application/json")) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(rawRead.bytes));
      if (parsed && typeof parsed === "object") {
        if ((parsed.visibility === "server_infra" || parsed.tier === "infra_private") && !infraAllowed) {
          return {
            status: FEEDBACK_STEPS_UPLOADS_GRID.http_forbidden,
            body: { ok: false, code: "forbidden_tier" },
          };
        }
        if (parsed.visibility === "server_infra" && infraAllowed) {
          visibility = "server_infra";
        }
        filename = parsed.filename || filename;
        agentId = parsed.agent_id || agentId;
        workerUuid = parsed.worker_uuid || workerUuid;
        if (typeof parsed.data_base64 === "string") {
          uploadBytes = base64ToUint8(parsed.data_base64);
          finalContentType = parsed.content_type || "application/octet-stream";
        } else if (typeof parsed.content === "string") {
          uploadBytes = new TextEncoder().encode(parsed.content);
          finalContentType = parsed.content_type || "text/plain; charset=utf-8";
        } else if (parsed.payload !== undefined) {
          uploadBytes = new TextEncoder().encode(JSON.stringify(parsed.payload));
          finalContentType = parsed.content_type || "application/json; charset=utf-8";
        }
        objSpec = {
          object_key: parsed.object_key || objSpec.object_key,
          category: parsed.category || objSpec.category,
          summary: parsed.summary || objSpec.summary,
          step_mode: parsed.step_mode || objSpec.step_mode,
          register_task_object: Boolean(parsed.register_task_object || parsed.object_key || objSpec.register_task_object),
          metadata: parsed.metadata || null,
        };
      }
    } catch {
      return {
        status: FEEDBACK_STEPS_UPLOADS_GRID.http_bad_request,
        body: { ok: false, code: "invalid_json", detail: "Invalid JSON body on POST /q/upload." },
      };
    }
  }

  if (uploadBytes.byteLength > FEEDBACK_STEPS_UPLOADS_GRID.max_upload_bytes) {
    return {
      status: FEEDBACK_STEPS_UPLOADS_GRID.http_payload_too_large,
      body: {
        ok: false,
        code: "payload_too_large",
        max_bytes: FEEDBACK_STEPS_UPLOADS_GRID.max_upload_bytes,
        actual_bytes: uploadBytes.byteLength,
      },
    };
  }

  const cleanAgent = gatewayOps?.cleanAgentId
    ? gatewayOps.cleanAgentId(agentId)
    : String(agentId || "anonymous-uploader").slice(0, 48);

  const persisted = await persistBlobBytesAndOptionalObject(db, {
    bytes: uploadBytes,
    filename,
    contentType: finalContentType,
    visibility,
    agentId: cleanAgent,
    workerUuid: String(workerUuid || "").slice(0, 64),
    objectSpec: objSpec,
    publicUrl: base,
    gatewayOps,
  });

  return {
    status: FEEDBACK_STEPS_UPLOADS_GRID.http_created,
    body: {
      ok: true,
      schema: FEEDBACK_STEPS_UPLOADS_GRID.upload_schema_version,
      was_gzipped: rawRead.wasGzipped,
      ...persisted,
    },
  };
}

export async function handleBlobDownloadRequest(
  request,
  db,
  sha256Param,
  { infraAllowed = false } = {}
) {
  await ensureFeedbackStepsAndUploadsSchema(db);
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return {
      isJsonError: true,
      status: FEEDBACK_STEPS_UPLOADS_GRID.http_method_not_allowed,
      body: { ok: false, error: "method_not_allowed" },
    };
  }
  const cleanSha = String(sha256Param || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-f0-9]/g, "");
  if (!cleanSha) {
    return {
      isJsonError: true,
      status: FEEDBACK_STEPS_UPLOADS_GRID.http_bad_request,
      body: { ok: false, code: "missing_blob_sha256" },
    };
  }

  const meta = await db
    .prepare("SELECT * FROM herma_blob_store WHERE sha256_hash = ? LIMIT 1")
    .bind(cleanSha)
    .first();
  if (!meta) {
    return {
      isJsonError: true,
      status: FEEDBACK_STEPS_UPLOADS_GRID.http_not_found,
      body: { ok: false, code: "blob_not_found", sha256_hash: cleanSha },
    };
  }
  if (meta.visibility === "server_infra" && !infraAllowed) {
    return {
      isJsonError: true,
      status: FEEDBACK_STEPS_UPLOADS_GRID.http_forbidden,
      body: { ok: false, code: "forbidden_tier" },
    };
  }

  const headers = {
    "content-type": meta.content_type || "application/octet-stream",
    "content-length": String(meta.total_bytes || 0),
    etag: `"${meta.sha256_hash}"`,
    "x-content-sha256": meta.sha256_hash,
    ...(meta.filename
      ? { "content-disposition": `inline; filename="${String(meta.filename).replace(/[^A-Za-z0-9_.-]+/g, "_")}"` }
      : {}),
  };

  if (method === "HEAD") {
    return {
      isBinaryResponse: true,
      response: new Response(null, { status: FEEDBACK_STEPS_UPLOADS_GRID.http_ok, headers }),
    };
  }

  const totalBytes = Number(meta.total_bytes || 0);
  const chunkCount = Number(meta.chunk_count || 0);
  const fullBytes = new Uint8Array(totalBytes);
  let writeOffset = 0;
  const pageSize = FEEDBACK_STEPS_UPLOADS_GRID.chunk_read_page_size;

  for (let pageOffset = 0; pageOffset < chunkCount; pageOffset += pageSize) {
    const pageRes = await db
      .prepare(
        "SELECT chunk_idx, chunk_b64 FROM herma_blob_chunks WHERE sha256_hash = ? ORDER BY chunk_idx ASC LIMIT ? OFFSET ?"
      )
      .bind(cleanSha, pageSize, pageOffset)
      .all();
    const rows = pageRes?.results || [];
    if (rows.length === 0) break;
    for (const r of rows) {
      const slice = base64ToUint8(r.chunk_b64);
      fullBytes.set(slice, writeOffset);
      writeOffset += slice.byteLength;
    }
  }

  return {
    isBinaryResponse: true,
    response: new Response(fullBytes, { status: FEEDBACK_STEPS_UPLOADS_GRID.http_ok, headers }),
  };
}
