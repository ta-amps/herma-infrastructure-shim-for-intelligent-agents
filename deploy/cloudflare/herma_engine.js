// Context-shimming 3-tier trigger engine, multi-caller isolation, governance lens,
// deterministic Anti-RAG entity memory, direct-response formatter, and HTML console
// for Herma Cloud on Cloudflare Workers + D1.
import { operatorPolicy, providerForHost } from "./provider_health.js";

export const HERMA_VERSION = "0.1.0";
export const SYSTEM_BUILTIN_SCOPE = "system_builtin";

export const ALLOWED_HARNESS_KINDS = new Set([
  "muse-code",
  "opencode",
  "claude-code",
  "codex",
  "swarm-worker",
  "custom-harness",
  "personal-assistant",
]);

export const ALLOWED_URI_SCHEMES = ["https://", "tessera://", "mcp://", "urn:"];
export const ALLOWED_CONTEXT_KINDS = new Set(["noun", "verb", "detail"]);
export const ALLOWED_ENTITY_KINDS = new Set([
  "file_path",
  "code_symbol",
  "tessera_uri",
  "statute_card_id",
  "error_signature",
]);
export const ALLOWED_OUTCOMES = new Set(["accepted", "retry_error", "ignored", "overridden"]);

const PROJECT_TAG_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$/;
const BLOB_SHA256_RE = /^[0-9a-f]{64}$/;
export const SAFE_BUCKET_SEG_RE = /^[A-Za-z0-9][A-Za-z0-9_./:-]{0,511}$/;

const GOV_ENVELOPE_KEYS = new Set([
  "governance",
  "tags",
  "status",
  "quarantined",
  "visibility_scope",
  "allowed_surfaces",
  "producer_surface",
  "cohort",
  "cohorts",
  "target_cohort",
  "target_cohorts",
  "allowed_cohorts",
  "allowed_harnesses",
  "owner_key_id",
  "namespace",
]);
const KNOWN_STATUS_VALUES = new Set([
  "quarantined",
  "verified",
  "unverified",
  "pending",
  "rejected",
  "draft",
]);



const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "when", "what", "how",
  "can", "you", "our", "are", "was", "were", "have", "has", "had", "will", "would",
  "should", "could", "please", "make", "use", "using", "need", "want", "help", "write",
  "build", "add", "code",
]);

const CONCEPT_GROUPS = [
  ["concept:atomic_queue", ["queue", "backlog", "worker", "swarm", "lease", "fencing", "duplicate", "concurrent", "race", "claim", "idempotent", "receipt", "retry", "deadletter"]],
  ["concept:cas_storage", ["cas", "optimistic", "version", "overwrite", "conflict", "blob", "sha256", "record", "state", "atomic", "bucket"]],
  ["concept:harm_compliance", ["scam", "fraud", "coercion", "exploitation", "victim", "caseworker", "statute", "fee", "usury", "payee", "impersonation", "accuse", "synthetic"]],
  ["concept:ngo_autonomy", ["nonprofit", "ngo", "volunteer", "hotline", "shelter", "intake", "crisis", "steward", "reviewer", "drafter", "playbook", "sop"]],
  ["concept:edge_security", ["cloudflare", "worker", "origin", "proxy", "secret", "header", "csp", "hsts", "token", "auth", "credential", "leak"]],
];

export const DEFAULT_CONTEXT_ENTRIES = [
  {
    entry_id: "noun:tessera.lease_fence",
    kind: "noun",
    title: "Tessera Monotonic Lease Fence",
    summary: "Compare-and-set task lease token incremented on every claim to fence out stale workers.",
    schema_or_body: {
      fields: {
        task_id: "string",
        fence: "integer >= 1",
        lease_expires_at: "float",
      },
      invariant: "submit/heartbeat/park reject fence < current_fence",
    },
    source_uri: "https://tessera.ta-amps.workers.dev/llms.txt",
    updated_at: "2026-10-27T00:00:00+00:00",
  },
  {
    entry_id: "verb:tessera.claim",
    kind: "verb",
    title: "Tessera Atomic Claim Verb",
    summary: "Atomically leases the next highest-priority ready task in a queue and mints a fresh fence token.",
    schema_or_body: {
      endpoint: "POST /v1/queues/{queue}/claim",
      inputs: ["worker_id", "lease_seconds"],
      returns: ["task_id", "fence", "payload"],
    },
    source_uri: "mcp://tessera/tools/claim",
    updated_at: "2026-10-27T00:00:00+00:00",
  },
  {
    entry_id: "detail:herma.shim_budget",
    kind: "detail",
    title: "Herma Bounded Context Shim Budget",
    summary: "Caps per-provision and total shimmed context characters while deduplicating prior conversation turns.",
    schema_or_body: {
      default_max_chars: 2400,
      default_max_total_chars: 8000,
      dedupe_modes: ["once_per_conversation", "every_turn"],
    },
    source_uri: "urn:ta-amps:spec:herma-context-shim-v1",
    updated_at: "2026-10-27T00:00:00+00:00",
  },
];

export const DEFAULT_PROVISIONS = [
  {
    prov_id: "PROV-DIRECT-NOUN-VERB-SCHEMA",
    title: "Direct Canonical Noun & Verb Schema Lookup",
    summary: "Responds directly with canonical atomic noun/verb schema definitions from Herma's context database without calling an upstream LLM.",
    priority: 350,
    enabled: true,
    action: "respond_directly",
    direct_response: "Canonical Herma + Tessera Noun/Verb Contract: shared state artifacts are compare-and-set NOUNs guarded by expected_version, and work items are leased VERB tiles (enqueue -> claim -> heartbeat -> submit/park) guarded by a monotonic fence token.",
    context_refs: ["noun:tessera.lease_fence", "verb:tessera.claim"],
    inject_position: "system_prefix",
    dedupe_mode: "every_turn",
    max_chars: 3000,
    inject_text: "Return the canonical noun/verb schema contract directly without invoking an upstream LLM.",
    uris: [
      {
        uri: "https://tessera.ta-amps.workers.dev/llms.txt",
        label: "Tessera Noun & Verb Protocol Summary",
        kind: "schema",
        inline_excerpt: "Atomic compare-and-set nouns and fenced queue verbs.",
      },
    ],
    metadata_tags: { domain: "context-database", mode: "direct-response" },
    triggers: {
      mode: "any",
      keyword: {
        any_keywords: ["canonical noun/verb schema", "herma direct schema", "/herma-schema"],
      },
    },
  },
  {
    prov_id: "PROV-TESSERA-FENCING",
    title: "Tessera Atomic Lease Fencing & Compare-and-Set Storage",
    summary: "Shims monotonic fencing-token, idempotent receipt, CAS version rules, and atomic noun/verb definitions whenever swarm queue or shared-state code is touched.",
    priority: 300,
    enabled: true,
    action: "shim_context",
    context_refs: ["noun:tessera.lease_fence", "verb:tessera.claim"],
    inject_position: "system_prefix",
    dedupe_mode: "once_per_conversation",
    max_chars: 3000,
    inject_text: "Every shared task is an atomic verb tile (claimed once, finished once, receipted) and every shared state artifact is a compare-and-set noun. Always pass the claim's monotonic fence token on heartbeat/submit/park, pass expected_version on put_record, and never bypass scope grants.",
    uris: [
      {
        uri: "https://tessera.ta-amps.workers.dev/llms.txt",
        label: "Tessera Noun & Verb Protocol Summary",
        kind: "doc",
        inline_excerpt: "Five queue verbs (enqueue, claim, heartbeat, submit, park/resume) plus CAS put_record, SHA-256 blobs, and named cloud buckets.",
      },
      {
        uri: "mcp://tessera/tools/put_record",
        label: "Tessera MCP CAS Record Tool",
        kind: "mcp_resource",
        inline_excerpt: "Requires expected_version (null for new keys, integer head version for updates).",
      },
    ],
    metadata_tags: { domain: "swarm-fabric", surface: "tessera" },
    triggers: {
      mode: "any",
      keyword: {
        any_keywords: ["fencing", "tessera", "expected_version", "put_record"],
        path_globs: ["*tessera/*.py", "src/tessera/*"],
        tool_names: ["claim", "submit", "put_record", "put_records"],
      },
      semantic: {
        exemplars: [
          "prevent two concurrent background workers in a swarm from double-processing the same backlog item",
          "optimistic concurrency version check when writing shared agent state records",
        ],
        concepts: ["queue", "lease", "fencing", "duplicate", "cas"],
        threshold: 0.25,
      },
    },
  },
  {
    prov_id: "PROV-RISK-REVIEW-NON-ACCUSATORY",
    title: "Non-Accusatory Risk Indicators & Synthetic Bundle Guard",
    summary: "Ensures fraud/harm analysis stays strictly non-accusatory, verifies SYNTHETIC markers, and routes T3/T4 decisions to human reviewers.",
    priority: 280,
    enabled: true,
    action: "shim_context",
    inject_position: "system_suffix",
    dedupe_mode: "once_per_conversation",
    max_chars: 2000,
    inject_text: "Outputs must express objective risk indicators tied to primary statute cards and recomputed multi-currency arithmetic -- never accuse any party of being a criminal, scammer, or perpetrator. Refuse bundles lacking an explicit SYNTHETIC marker, and route T3 holds and T4 referrals exclusively to human reviewers.",
    uris: [
      {
        uri: "https://github.com/ta-amps/seed-packs/tree/main/packs/exploitation-evidence",
        label: "Exploitation Evidence Seed Pack",
        kind: "doc",
        inline_excerpt: "Card-backed multi-currency checks across 10 harm areas and 27 dated statute cards.",
      },
    ],
    metadata_tags: { domain: "harm-triage" },
    triggers: {
      mode: "any",
      keyword: {
        any_keywords: ["statute card", "exploitation evidence", "t4 referral", "advance_to_payout", "payee_mismatch"],
        path_globs: ["*exploitation_evidence/*.py", "areas/*", "cards/*.json"],
      },
      semantic: {
        exemplars: [
          "evaluate suspicious payment fee extraction and coercive messages against regulatory caps",
          "clear legitimate look-alike invoice twin while holding mismatched beneficiary account",
        ],
        concepts: ["scam", "fraud", "statute", "payee", "synthetic"],
        threshold: 0.26,
      },
    },
  },
  {
    prov_id: "PROV-NGO-HUMAN-BOUNDARY",
    title: "NGO Kit Human-Only Crisis & Two-Donor Review Boundary",
    summary: "Triggered via Tier-3 micromodel classifier whenever an agent designs nonprofit/helpline workflows, enforcing human-only boundaries and drafter != reviewer.",
    priority: 260,
    enabled: true,
    action: "shim_context",
    inject_position: "system_suffix",
    dedupe_mode: "once_per_conversation",
    max_chars: 2000,
    inject_text: "When building nonprofit, shelter, or helpline workflows: survivor interviews, crisis safety planning, eligibility determinations on real individuals, and external outbound sends must remain strictly human_only. Every agentic deliverable requires SYNTHETIC fixtures and independent verification (drafter != reviewer).",
    uris: [
      {
        uri: "https://eranos.ta-amps.workers.dev",
        label: "Eranos Verified NGO Kit Catalog",
        kind: "doc",
        inline_excerpt: "Two-step eq01 -> eq02 -> eq03 volunteer pipeline with deterministic autonomy checks.",
      },
    ],
    metadata_tags: { domain: "ngo-kits", surface: "eranos" },
    triggers: {
      mode: "any",
      micromodel: {
        intent_question: "Is the user asking to design, automate, or modify a nonprofit, NGO, shelter, crisis helpline, or humanitarian intake workflow?",
        positive_labels: ["apply", "yes", "true"],
        min_confidence: 0.6,
        fallback_keywords: ["shelter", "helpline", "hotline", "crisis", "nonprofit", "ngo", "intake"],
      },
    },
  },
  {
    prov_id: "PROV-EDGE-ORIGIN-LOCKDOWN",
    title: "Cloudflare Worker x-edge-auth & Security Header Contract",
    summary: "Injects constant-time x-edge-auth origin verification, cookie stripping, and strict HSTS/CSP rules when editing deployment or Worker edge code.",
    priority: 240,
    enabled: true,
    action: "shim_context",
    inject_position: "developer_context",
    dedupe_mode: "once_per_conversation",
    max_chars: 1800,
    inject_text: "Every public Worker edge must strip incoming cookies and hop-by-hop headers, attach x-edge-auth from EDGE_SECRET, set strict-transport-security and content-security-policy, never cache non-GET writes, and verify x-edge-auth at the origin with hmac.compare_digest.",
    uris: [
      {
        uri: "urn:ta-amps:spec:edge-origin-lockdown-v1",
        label: "Edge-to-Origin Shared Secret Specification",
        kind: "schema",
        inline_excerpt: "Origin returns RFC 9457 403 problem+json whenever x-edge-auth is absent or mismatched.",
      },
    ],
    metadata_tags: { domain: "edge-security" },
    triggers: {
      mode: "any",
      keyword: {
        any_keywords: ["x-edge-auth", "EDGE_SECRET", "wrangler.jsonc"],
        path_globs: ["deploy/cloudflare/*", "*worker.js"],
      },
    },
  },
];

export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" role="img" aria-label="Herma boundary pillar">
  <rect width="32" height="32" rx="7" fill="#0c1017"/>
  <path d="M9 27h14v2H9zm2-3h10l1 3H10zm1-14h8v14h-8z" fill="#67b7ff"/>
  <rect x="9" y="6" width="14" height="4" rx="1.5" fill="#eef2f7"/>
  <path d="M14 13h4v1.5h-4zm0 3.2h4v1.5h-4zm0 3.2h4v1.5h-4z" fill="#0c1017"/>
</svg>
`;

const BRAND_SVG =
  '<svg class="brand-mark" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">' +
  '<rect width="32" height="32" rx="7" fill="currentColor" opacity="0.14"/>' +
  '<path d="M9 26.5h14v2H9zm2-2.8h10l1 2.8H10zm1-13.7h8v13.7h-8z" fill="currentColor"/>' +
  '<rect x="9" y="6" width="14" height="3.8" rx="1.4" fill="currentColor"/>' +
  '<path d="M14 13h4v1.4h-4zm0 3h4v1.4h-4zm0 3h4v1.4h-4z" fill="var(--bg)"/>' +
  "</svg>";

export const ROBOTS_TXT = `User-agent: *
Allow: /
Allow: /connect
Allow: /llms.txt
Allow: /llms-full.txt
Allow: /.well-known/agent-card.json
Disallow: /v1/
`;

export const MCP_TOOLS_SPEC = [
  {
    name: "list_builtin_provisions",
    description: "List starter system_builtin context-shimming and direct-response provisions without exposing private caller state.",
    inputSchema: {
      type: "object",
      properties: {
        enabled_only: {
          type: "boolean",
          description: "Filter to enabled builtin provisions only.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "preview_shim",
    description: "Evaluate system_builtin 3-tier triggers, context shims, and deterministic entity extraction in memory with persisted=false.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Prompt text to inspect." },
        wire_format: {
          type: "string",
          enum: ["chat_completions", "responses", "messages"],
        },
        workspace_paths: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  },
  {
    name: "extract_entities",
    description: "Deterministically extract file_path, code_symbol, tessera_uri, statute_card_id, and error_signature entities with zero LLM calls.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Source text to scan." },
        workspace_paths: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
];

export const PREVIEW_JS = `(function () {
  const promptEl = document.getElementById("herma-preview-prompt");
  const pathEl = document.getElementById("herma-preview-path");
  const wireEl = document.getElementById("herma-preview-wire");
  const runBtn = document.getElementById("herma-preview-btn");
  const statusEl = document.getElementById("herma-preview-status");
  const outputEl = document.getElementById("herma-preview-output");
  if (!promptEl || !runBtn || !statusEl || !outputEl) return;

  const presets = {
    fencing: {
      prompt: "Update src/tessera/_tasks.py to verify noun:tessera.lease_fence with \`put_record()\`.",
      path: "src/tessera/_tasks.py",
      wire: "chat_completions"
    },
    direct: {
      prompt: "Show the canonical noun/verb schema for queue claims.",
      path: "",
      wire: "responses"
    },
    statute: {
      prompt: "Check statute card US-ROSCA-8403 after ValueError: stale fencing token in exploitation_evidence/checks.py",
      path: "exploitation_evidence/checks.py",
      wire: "chat_completions"
    }
  };

  document.querySelectorAll("[data-herma-preset]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const key = btn.getAttribute("data-herma-preset");
      const item = presets[key];
      if (!item) return;
      promptEl.value = item.prompt;
      if (pathEl) pathEl.value = item.path;
      if (wireEl) wireEl.value = item.wire;
      runPreview();
    });
  });

  function renderEmpty(msg) {
    statusEl.className = "preview-status";
    statusEl.textContent = msg;
    outputEl.innerHTML = "";
  }

  function escText(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  async function runPreview() {
    const prompt = promptEl.value.trim();
    if (!prompt) {
      renderEmpty("Empty prompt: enter a coding-harness prompt or choose a preset above to run a read-only preview.");
      return;
    }
    const wire = wireEl ? wireEl.value : "chat_completions";
    const rawPath = pathEl ? pathEl.value.trim() : "";
    const workspacePaths = rawPath ? rawPath.split(",").map(function (p) { return p.trim(); }).filter(Boolean) : [];

    runBtn.disabled = true;
    statusEl.className = "preview-status";
    statusEl.textContent = "Evaluating system_builtin 3-tier triggers and deterministic entity patterns...";
    outputEl.innerHTML = "";

    try {
      const resp = await fetch("/api/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ prompt: prompt, wire_format: wire, workspace_paths: workspacePaths })
      });
      const data = await resp.json();
      if (!resp.ok) {
        statusEl.className = "preview-status error";
        statusEl.textContent = "Preview refused (" + resp.status + "): " + (data.detail || data.title || "invalid input");
        return;
      }
      statusEl.className = "preview-status ok";
      statusEl.textContent = "Evaluated scope: " + data.scope_evaluated + " | persisted: " + String(data.persisted) + " | matches: " + (data.matches || []).length + " | entities: " + (data.entities || []).length;

      const matchItems = (data.matches || []).map(function (m) {
        return "<li><code>" + escText(m.prov_id) + "@v" + escText(m.version) + "</code> (" + escText((m.matched_tiers || []).join(", ")) + "): " + escText((m.reasons || []).join("; ")) + "</li>";
      }).join("");

      const entItems = (data.entities || []).map(function (e) {
        return "<span class='entity-chip'><strong>" + escText(e.kind) + ":</strong> <code>" + escText(e.value) + "</code></span>";
      }).join("");

      const previewPayload = data.responded_directly
        ? data.direct_response_text
        : JSON.stringify(data.augmented_payload, null, 2);

      outputEl.innerHTML =
        "<div style='margin-top:0.8rem;'>" +
        "<strong>Matched Builtin Provisions:</strong>" +
        (matchItems ? "<ul>" + matchItems + "</ul>" : "<p style='color:var(--muted);margin:0.3rem 0;'>No system_builtin rules matched this prompt.</p>") +
        "<strong>Extracted Top-of-Mind Entities (0 LLM calls):</strong>" +
        (entItems ? "<div class='entity-tags'>" + entItems + "</div>" : "<p style='color:var(--muted);margin:0.3rem 0;'>No file paths, symbols, URIs, statute cards, or errors detected.</p>") +
        "<strong>" + (data.responded_directly ? "Direct Protocol Reply (0 upstream tokens):" : "Augmented Wire Payload:") + "</strong>" +
        "<pre>" + escText(previewPayload) + "</pre>" +
        "</div>";
    } catch (err) {
      statusEl.className = "preview-status error";
      statusEl.textContent = "Preview network error: " + String(err && err.message ? err.message : err);
    } finally {
      runBtn.disabled = false;
    }
  }

  runBtn.addEventListener("click", runPreview);
})();
`;

export class HermaErr extends Error {
  constructor(status, code, title, detail) {
    super(detail);
    this.status = status;
    this.code = code;
    this.title = title;
    this.detail = detail;
  }
}

export function esc(val) {
  return String(val ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sha256Hex(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function canonicalJson(val) {
  if (val === null || typeof val === "boolean" || typeof val === "string") return JSON.stringify(val);
  if (typeof val === "number") return Object.is(val, -0) ? "0" : JSON.stringify(val);
  if (Array.isArray(val)) return "[" + val.map((v) => canonicalJson(v)).join(",") + "]";
  if (typeof val === "object") {
    const keys = Object.keys(val).sort();
    return (
      "{" +
      keys
        .filter((k) => val[k] !== undefined)
        .map((k) => `${JSON.stringify(k)}:${canonicalJson(val[k])}`)
        .join(",") +
      "}"
    );
  }
  return "null";
}

export function constantTimeEqual(a, b) {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const ba = enc.encode(String(a));
  const bb = enc.encode(String(b));
  if (ba.byteLength !== bb.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < ba.byteLength; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

export function parseProjectTag(request, explicitTag = null) {
  const raw = (explicitTag != null ? String(explicitTag) : request?.headers?.get("x-herma-project") || "").trim();
  if (!raw) return "default";
  if (!PROJECT_TAG_RE.test(raw)) {
    throw new HermaErr(
      400,
      "invalid_project_tag",
      "Invalid Project Tag",
      `Project tag '${raw}' must match ^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$.`
    );
  }
  return raw;
}

export function parseCohortHeader(request, explicitCohort = null) {
  const raw = (explicitCohort != null ? String(explicitCohort) : request?.headers?.get("x-herma-cohort") || "").trim();
  if (!raw) return "";
  if (raw.length > 128) {
    throw new HermaErr(400, "invalid_cohort", "Invalid Cohort Header", "X-Herma-Cohort must be <= 128 chars.");
  }
  return raw;
}

const MIGRATED_DBS = new WeakSet();

export async function ensureSchema(db) {
  if (!db || MIGRATED_DBS.has(db)) return;
  try {
    const provInfo = await db.prepare("PRAGMA table_info(provisions)").all();
    const provCols = new Map((provInfo?.results || []).map((r) => [String(r.name), Number(r.pk || 0)]));
    if (provCols.size > 0 && (provCols.get("caller_scope") || 0) === 0) {
      const scopeExpr = provCols.has("caller_scope") ? "COALESCE(caller_scope, 'system_builtin')" : "'system_builtin'";
      await db.batch([
        db.prepare(
          "CREATE TABLE IF NOT EXISTS provisions_v2 (caller_scope TEXT NOT NULL DEFAULT 'system_builtin', prov_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, content_sha256 TEXT NOT NULL, source_store TEXT NOT NULL, body_json TEXT NOT NULL, updated_at REAL NOT NULL, PRIMARY KEY (caller_scope, prov_id))"
        ),
        db.prepare(
          `INSERT OR REPLACE INTO provisions_v2 (caller_scope, prov_id, version, content_sha256, source_store, body_json, updated_at) SELECT ${scopeExpr}, prov_id, version, content_sha256, CASE WHEN source_store = 'examples' THEN 'system_builtin' ELSE source_store END, body_json, updated_at FROM provisions`
        ),
        db.prepare("DROP TABLE provisions"),
        db.prepare("ALTER TABLE provisions_v2 RENAME TO provisions"),
      ]);
    }

    const ctxInfo = await db.prepare("PRAGMA table_info(context_entries)").all();
    const ctxCols = new Map((ctxInfo?.results || []).map((r) => [String(r.name), Number(r.pk || 0)]));
    if (ctxCols.size > 0 && ((ctxCols.get("caller_scope") || 0) === 0 || !ctxCols.has("version"))) {
      const scopeExpr = ctxCols.has("caller_scope") ? "COALESCE(caller_scope, 'system_builtin')" : "'system_builtin'";
      const verExpr = ctxCols.has("version") ? "COALESCE(version, 1)" : "1";
      await db.batch([
        db.prepare(
          "CREATE TABLE IF NOT EXISTS context_entries_v2 (caller_scope TEXT NOT NULL DEFAULT 'system_builtin', entry_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, kind TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, body_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (caller_scope, entry_id))"
        ),
        db.prepare(
          `INSERT OR REPLACE INTO context_entries_v2 (caller_scope, entry_id, version, kind, title, summary, body_json, updated_at) SELECT ${scopeExpr}, entry_id, ${verExpr}, kind, title, summary, body_json, updated_at FROM context_entries`
        ),
        db.prepare("DROP TABLE context_entries"),
        db.prepare("ALTER TABLE context_entries_v2 RENAME TO context_entries"),
      ]);
    }

    const rcptInfo = await db.prepare("PRAGMA table_info(injection_receipts)").all();
    const rcptCols = new Set((rcptInfo?.results || []).map((r) => String(r.name)));
    if (rcptCols.size > 0) {
      if (!rcptCols.has("caller_scope")) {
        await db
          .prepare("ALTER TABLE injection_receipts ADD COLUMN caller_scope TEXT NOT NULL DEFAULT 'system_builtin'")
          .run();
      }
      if (!rcptCols.has("project_tag")) {
        await db
          .prepare("ALTER TABLE injection_receipts ADD COLUMN project_tag TEXT NOT NULL DEFAULT 'default'")
          .run();
      }
    }
  } catch {
    // Allow mock D1 harnesses that do not implement PRAGMA table_info to proceed with CREATE TABLE IF NOT EXISTS
  }

  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS route_quotas (caller_scope TEXT NOT NULL, hour INTEGER NOT NULL, used INTEGER NOT NULL, PRIMARY KEY (caller_scope, hour))"),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS provisions (caller_scope TEXT NOT NULL DEFAULT 'system_builtin', prov_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, content_sha256 TEXT NOT NULL, source_store TEXT NOT NULL, body_json TEXT NOT NULL, updated_at REAL NOT NULL, PRIMARY KEY (caller_scope, prov_id))"
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS context_entries (caller_scope TEXT NOT NULL DEFAULT 'system_builtin', entry_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, kind TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, body_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (caller_scope, entry_id))"
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS harness_keys (key_id TEXT PRIMARY KEY, label TEXT NOT NULL, harness_kind TEXT NOT NULL, scopes_json TEXT NOT NULL, secret_sha256 TEXT NOT NULL UNIQUE, created_at REAL NOT NULL, revoked_at REAL)"
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS injection_receipts (receipt_id TEXT PRIMARY KEY, caller_scope TEXT NOT NULL DEFAULT 'system_builtin', project_tag TEXT NOT NULL DEFAULT 'default', receipt_sha256 TEXT NOT NULL, conversation_id TEXT, harness_kind TEXT NOT NULL, protocol TEXT NOT NULL, model TEXT NOT NULL, matched_provisions TEXT NOT NULL, injected_uris TEXT NOT NULL, body_json TEXT NOT NULL DEFAULT '{}', created_at REAL NOT NULL)"
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS working_entities (caller_scope TEXT NOT NULL, project_tag TEXT NOT NULL DEFAULT 'default', entity_kind TEXT NOT NULL, entity_value TEXT NOT NULL, hit_count INTEGER NOT NULL DEFAULT 1, first_seen_at REAL NOT NULL, last_seen_at REAL NOT NULL, last_receipt_id TEXT NOT NULL, PRIMARY KEY (caller_scope, project_tag, entity_kind, entity_value))"
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS rule_outcomes (outcome_id TEXT PRIMARY KEY, caller_scope TEXT NOT NULL, project_tag TEXT NOT NULL DEFAULT 'default', receipt_id TEXT NOT NULL, prov_id TEXT NOT NULL, outcome TEXT NOT NULL, tokens_saved_est INTEGER NOT NULL DEFAULT 0, latency_ms REAL NOT NULL DEFAULT 0.0, error_signature TEXT, created_at REAL NOT NULL, UNIQUE (caller_scope, receipt_id, prov_id))"
    ),
  ]);
  MIGRATED_DBS.add(db);
}

export async function ensureContextTable(db) {
  await ensureSchema(db);
}

export function validateBlobSha256(blobSha) {
  const cleaned = String(blobSha || "").trim();
  if (!BLOB_SHA256_RE.test(cleaned)) {
    throw new HermaErr(
      400,
      "invalid_blob_sha",
      "Invalid Tessera Blob Digest",
      `Tessera blob digest '${blobSha}' must match ^[0-9a-f]{64}$.`
    );
  }
  return cleaned;
}

export async function verifyBlobBytes(blobSha, rawBytesOrBuffer) {
  const expected = validateBlobSha256(blobSha);
  const bytes =
    typeof rawBytesOrBuffer === "string"
      ? new TextEncoder().encode(rawBytesOrBuffer)
      : new Uint8Array(rawBytesOrBuffer);
  const actual = await sha256Hex(bytes);
  if (actual !== expected) {
    throw new HermaErr(
      422,
      "blob_integrity_mismatch",
      "Tessera Blob Integrity Mismatch",
      `Blob SHA-256 verification failed: expected ${expected}, got ${actual}.`
    );
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).slice(0, 780);
}

function splitCsvOrList(raw) {
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
  }
  if (Array.isArray(raw)) {
    return raw.map((p) => String(p ?? "").trim()).filter(Boolean);
  }
  return [];
}

function canonicalGovernance(raw, extraEnvelope = null) {
  const source = extraEnvelope ?? raw;
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  const gov = source.governance ?? source;
  if (!gov || typeof gov !== "object" || Array.isArray(gov)) return {};
  return Object.fromEntries(["namespace", "producer_surface", "visibility_scope", "allowed_surfaces", "target_cohorts", "tags", "owner_key_id"].filter(k => k in gov).map(k => [k, gov[k]]));
}

export function passesGovernanceLens(rawItem, {harnessKind = null, cohort = "", extraEnvelope = null, trustedLocal = false} = {}) {
  const raw = rawItem && typeof rawItem === "object" ? rawItem : {};
  const meta = raw.metadata_tags || {};
  const gov = canonicalGovernance(raw, extraEnvelope);
  const required = ["namespace", "producer_surface", "visibility_scope", "allowed_surfaces", "target_cohorts", "tags"];
  if (!trustedLocal) {
    if (required.some(k => !(k in gov))) return false;
    if (typeof gov.namespace !== "string" || !gov.namespace.trim()) return false;
    if (!["surface:tessera", "surface:shamash", "surface:eranos", "surface:herma", "surface:kothar", "surface:kinema"].includes(gov.producer_surface)) return false;
    if (["allowed_surfaces", "target_cohorts", "tags"].some(k => !Array.isArray(gov[k]) || gov[k].some(v => typeof v !== "string"))) return false;
    if (!gov.tags.includes("status:verified") || gov.tags.includes("status:quarantined")) return false;
    if (gov.visibility_scope === "allowlist_surfaces") {
      if (!gov.allowed_surfaces.includes("surface:herma")) return false;
    } else if (gov.visibility_scope !== "public_commons") return false;
    if (required.some(k => k in raw && JSON.stringify(raw[k]) !== JSON.stringify(gov[k]))) return false;
  }
  const tags = new Set([...splitCsvOrList(gov.tags), ...splitCsvOrList(meta.tags), ...splitCsvOrList(meta.status)]);
  if (raw.quarantined === true || [...tags].some(t => t.startsWith("status:") && t !== "status:verified")) return false;
  const targets = new Set(splitCsvOrList(gov.target_cohorts));
  for (const k of ["cohort", "cohorts", "target_cohort", "target_cohorts", "allowed_cohorts"]) for (const t of splitCsvOrList(meta[k])) targets.add(t);
  if (!trustedLocal && !targets.size) return false;
  if (targets.size && !targets.has("all")) {
    const caller = new Set(splitCsvOrList(cohort));
    for (const item of [...caller]) if (!item.includes(":")) caller.add(`cohort:${item}`);
    if (harnessKind) caller.add(`harness:${harnessKind}`);
    if (![...caller].some(t => targets.has(t))) return false;
  }
  return true;
}

export function stripGovernanceEnvelopeForProvision(rawVal, extraEnvelope = null) {
  const cleaned = Object.fromEntries(Object.entries(rawVal).filter(([k]) => !GOV_ENVELOPE_KEYS.has(k)));
  cleaned.metadata_tags = {...(cleaned.metadata_tags || {}), fabric_governance: JSON.stringify(canonicalGovernance(rawVal, extraEnvelope))};
  return cleaned;
}

export function stripGovernanceEnvelopeForContext(rawVal, extraEnvelope = null) {
  if (!rawVal || typeof rawVal !== "object" || Array.isArray(rawVal)) return rawVal;
  const cleaned = {};
  for (const [k, v] of Object.entries(rawVal)) {
    if (!GOV_ENVELOPE_KEYS.has(k)) cleaned[k] = v;
  }
  cleaned.governance = canonicalGovernance(rawVal, extraEnvelope);
  return cleaned;
}

export function provisionPassesLens(stored, {harnessKind, cohort = ""}) {
  const trustedLocal = ["local", "system_builtin", "examples", "harness"].includes(stored.source_store) || stored.source_store?.startsWith("harness:");
  let raw = {metadata_tags: stored?.provision?.metadata_tags || {}};
  if (!trustedLocal) {
    try { raw = {governance: JSON.parse(raw.metadata_tags.fabric_governance || "{}")}; }
    catch { return false; }
  }
  return passesGovernanceLens(raw, {harnessKind, cohort, trustedLocal});
}

export function validateContextEntry(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HermaErr(422, "validation_error", "Invalid ContextEntry", "Expected JSON object.");
  }
  const entryId = String(raw.entry_id || "").trim();
  const kind = String(raw.kind || "").trim();
  const title = String(raw.title || "").trim();
  const summary = String(raw.summary || "").trim();
  if (entryId.length < 2 || entryId.length > 160) {
    throw new HermaErr(422, "validation_error", "Invalid ContextEntry", "entry_id must be 2..160 chars.");
  }
  if (!ALLOWED_CONTEXT_KINDS.has(kind)) {
    throw new HermaErr(422, "validation_error", "Invalid ContextEntry", "kind must be 'noun', 'verb', or 'detail'.");
  }
  if (title.length < 2 || title.length > 160) {
    throw new HermaErr(422, "validation_error", "Invalid ContextEntry", "title must be 2..160 chars.");
  }
  if (summary.length < 4 || summary.length > 600) {
    throw new HermaErr(422, "validation_error", "Invalid ContextEntry", "summary must be 4..600 chars.");
  }
  let sourceUri = raw.source_uri == null ? null : String(raw.source_uri).trim() || null;
  if (sourceUri && !ALLOWED_URI_SCHEMES.some((s) => sourceUri.startsWith(s))) {
    throw new HermaErr(
      422,
      "validation_error",
      "Invalid ContextEntry",
      `source_uri '${sourceUri}' must start with one of: ${ALLOWED_URI_SCHEMES.join(", ")}`
    );
  }
  const schemaOrBody =
    raw.schema_or_body === undefined || raw.schema_or_body === null
      ? ""
      : typeof raw.schema_or_body === "object" || typeof raw.schema_or_body === "string"
        ? raw.schema_or_body
        : String(raw.schema_or_body);
  const updatedAt = String(raw.updated_at || "").trim() || new Date().toISOString();
  const version = raw.version != null && Number.isFinite(Number(raw.version)) ? Math.max(1, Math.trunc(Number(raw.version))) : 1;
  return {
    governance: raw.governance ?? null,
    entry_id: entryId,
    kind,
    title,
    summary,
    schema_or_body: schemaOrBody,
    source_uri: sourceUri,
    version,
    updated_at: updatedAt,
  };
}

export function validateProvisionPayload(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HermaErr(422, "validation_error", "Invalid Provision", "Expected JSON object.");
  }
  const provId = String(raw.prov_id || "").trim();
  if (!/^PROV-[A-Z0-9][A-Z0-9-]{2,62}$/.test(provId)) {
    throw new HermaErr(
      422,
      "validation_error",
      "Invalid Provision",
      "prov_id must match ^PROV-[A-Z0-9][A-Z0-9-]{2,62}$."
    );
  }
  const action = raw.action || "shim_context";
  if (action !== "shim_context" && action !== "respond_directly") {
    throw new HermaErr(422, "validation_error", "Invalid Provision", "action must be 'shim_context' or 'respond_directly'.");
  }
  if (action === "respond_directly") {
    if (!String(raw.direct_response || "").trim()) {
      throw new HermaErr(
        422,
        "validation_error",
        "Invalid Provision",
        "Provision with action='respond_directly' requires a non-empty direct_response."
      );
    }
  } else if (String(raw.inject_text || "").trim().length < 10) {
    throw new HermaErr(
      422,
      "validation_error",
      "Invalid Provision",
      "Provision with action='shim_context' requires inject_text of at least 10 characters."
    );
  }
  const refs = [];
  for (const r of raw.context_refs || []) {
    const cleaned = String(r || "").trim();
    if (cleaned.length < 2 || cleaned.length > 160) {
      throw new HermaErr(422, "validation_error", "Invalid Provision", "context_refs items must be 2..160 chars.");
    }
    if (!refs.includes(cleaned)) refs.push(cleaned);
  }
  for (const u of raw.uris || []) {
    const uriStr = String(u?.uri || "").trim();
    if (!ALLOWED_URI_SCHEMES.some((s) => uriStr.startsWith(s))) {
      throw new HermaErr(
        422,
        "validation_error",
        "Invalid Provision URI",
        `URI '${uriStr}' must start with one of: ${ALLOWED_URI_SCHEMES.join(", ")}`
      );
    }
  }
  return {
    ...raw,
    prov_id: provId,
    priority: raw.priority ?? 100,
    enabled: raw.enabled ?? true,
    action,
    direct_response: raw.direct_response ?? null,
    context_refs: refs,
    inject_position: raw.inject_position || "system_suffix",
    dedupe_mode: raw.dedupe_mode || "once_per_conversation",
    max_chars: raw.max_chars ?? 2400,
    inject_text: raw.inject_text ?? "",
    uris: Array.isArray(raw.uris) ? raw.uris : [],
    metadata_tags: raw.metadata_tags && typeof raw.metadata_tags === "object" ? raw.metadata_tags : {},
  };
}

export function parseTesseraContextRef(ref) {
  const trimmed = String(ref || "").trim();
  const colon = trimmed.indexOf(":");
  if (colon <= 0) return null;
  const kind = trimmed.slice(0, colon);
  if (!ALLOWED_CONTEXT_KINDS.has(kind)) return null;
  const remainder = trimmed.slice(colon + 1);
  const slash = remainder.indexOf("/");
  if (slash <= 0) return null;
  const storeNs = remainder.slice(0, slash).trim();
  const recKey = remainder.slice(slash + 1).trim();
  if (!storeNs || !recKey) return null;
  return { kind, storeNs, recKey };
}

export function enforceNotConsumerAssistant(request) {
  const h = request.headers;
  if ((h.get("sec-fetch-mode") || "").trim().toLowerCase() === "navigate") {
    throw new HermaErr(
      403,
      "harness_required",
      "Configurable Coding Harness Required",
      "Browser navigation requests cannot invoke Herma middleware endpoints."
    );
  }
  if (h.has("cookie")) {
    throw new HermaErr(
      403,
      "harness_required",
      "Configurable Coding Harness Required",
      "Cookie-bearing browser sessions are refused; use a stateless coding harness credential."
    );
  }
  const declared = (h.get("x-herma-harness") || "").trim().toLowerCase();
  if (declared && !ALLOWED_HARNESS_KINDS.has(declared)) {
    throw new HermaErr(
      403,
      "harness_required",
      "Configurable Coding Harness Required",
      `Unsupported X-Herma-Harness '${declared}'.`
    );
  }
  return declared || null;
}

// One classifier shared with Python: any case-insensitive "contributor" in the ID. Separators vary
// by protocol (-contributor, /contributor, :contributor), so this deliberately over-matches.
export const isContributorModel = model => String(model ?? "").toLowerCase().includes("contributor");

export function refuseContributorModel(model) {
  if (isContributorModel(model)) {
    throw new HermaErr(
      403,
      "contributor_tier_refused",
      "Contributor Tier Refused",
      `Model '${model}' uses a contributor training tier; Herma enforces Standard mode only.`
    );
  }
}

export function isAdminRequest(request, env) {
  const candidates = [
    (env?.HERMA_ADMIN_TOKEN || "").trim(),
    (env?.BOOTSTRAP_SECRET || "").trim(),
    (env?.EDGE_SECRET || "").trim(),
  ].filter(Boolean);
  if (!candidates.length) return false;

  const suppliedList = [];
  for (const hdr of ["x-herma-admin-token", "x-bootstrap-secret"]) {
    const val = (request.headers.get(hdr) || "").trim();
    if (val) suppliedList.push(val);
  }
  const auth = (request.headers.get("authorization") || "").trim();
  if (auth.toLowerCase().startsWith("bearer ")) {
    const bearer = auth.slice(7).trim();
    if (bearer && !bearer.startsWith("hmk_")) suppliedList.push(bearer);
  }
  for (const supplied of suppliedList) {
    for (const expected of candidates) {
      if (constantTimeEqual(supplied, expected)) return true;
    }
  }
  return false;
}

export async function authenticateHarness(db, request, { isAdmin = false } = {}) {
  await ensureSchema(db);
  let raw = (request.headers.get("x-herma-key") || "").trim();
  if (!raw) {
    const auth = (request.headers.get("authorization") || "").trim();
    if (auth.toLowerCase().startsWith("bearer ")) {
      const cand = auth.slice(7).trim();
      if (cand.startsWith("hmk_")) raw = cand;
    }
  }
  if (!raw.startsWith("hmk_") || !raw.includes(".")) {
    throw new HermaErr(
      403,
      "harness_required",
      "Configurable Coding Harness Required",
      "Missing valid Herma harness key (hmk_<id>.<secret>). Coding harnesses and personal assistants require a scoped Herma key."
    );
  }
  const body = raw.slice(4);
  const dot = body.indexOf(".");
  const keyId = body.slice(0, dot);
  const supplied = body.slice(dot + 1);
  if (!keyId || supplied.length < 8) {
    throw new HermaErr(403, "harness_required", "Configurable Coding Harness Required", "Malformed Herma harness key.");
  }
  const row = await db.prepare("SELECT * FROM harness_keys WHERE key_id = ?").bind(keyId).first();
  if (!row || row.revoked_at != null) {
    throw new HermaErr(403, "harness_required", "Configurable Coding Harness Required", "Unknown or revoked Herma harness key.");
  }
  const suppliedHash = await sha256Hex(supplied);
  if (!constantTimeEqual(row.secret_sha256, suppliedHash)) {
    throw new HermaErr(403, "harness_required", "Configurable Coding Harness Required", "Invalid Herma harness key secret.");
  }
  return {
    key_id: row.key_id,
    label: row.label,
    harness_kind: row.harness_kind,
    scopes: new Set(JSON.parse(row.scopes_json || "[]")),
    is_admin: Boolean(isAdmin),
    caller_scope: `key:${row.key_id}`,
  };
}

export function requireScope(principal, requiredScope, request) {
  const declared = enforceNotConsumerAssistant(request);
  if (!principal.scopes.has(requiredScope)) {
    throw new HermaErr(
      403,
      "insufficient_scope",
      "Insufficient Harness Scope",
      `Harness key '${principal.key_id}' lacks '${requiredScope}' scope.`
    );
  }
  if (requiredScope === "configure") {
    if (!declared) {
      throw new HermaErr(
        403,
        "harness_required",
        "Configurable Coding Harness Required",
        "Configuring provisions or context entries requires an explicit X-Herma-Harness header from a configurable coding harness."
      );
    }
    if (declared !== principal.harness_kind) {
      throw new HermaErr(
        403,
        "harness_required",
        "Configurable Coding Harness Required",
        `X-Herma-Harness '${declared}' does not match key harness binding '${principal.harness_kind}'.`
      );
    }
  }
}

// --- Deterministic Anti-RAG Entity Extraction & Candidate Provision Synthesis ---

const URL_SPAN_RE = /(?:https?|tessera|mcp):\/\/\S+|urn:[A-Za-z0-9_.:/-]+/g;
const TESSERA_URI_RE = /tessera:\/\/(?:blobs|buckets|stores)\/[A-Za-z0-9_./:-]+/g;
const NOUN_VERB_URI_RE = /\b(?:noun|verb|detail):[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./:-]+)?/g;
const FILE_PATH_RE = /(?<![A-Za-z0-9_.:/-])(?:\.\/|\.\.\/|\/)?(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,10}\b/g;
const BACKTICK_FILE_RE = /`([A-Za-z0-9_.-]+\.(?:py|js|mjs|ts|tsx|sql|json|jsonc|toml|yaml|yml|md|sh|rs|go))`/g;
const DECL_SYMBOL_RE = /\b(?:def|class|function|interface|type)\s+([A-Za-z_][A-Za-z0-9_]{1,80})\b/g;
const BACKTICK_SYMBOL_RE = /`([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+(?:\(\))?|[A-Za-z_][A-Za-z0-9_]{1,80}\(\))`/g;
const CALL_SYMBOL_RE = /\b([A-Za-z_][A-Za-z0-9_]{2,64}\(\))/g;
const STATUTE_CARD_RE = /\b(?:CARD-[A-Z0-9][A-Z0-9_-]{1,48}|(?:US|UK|EU|AU|CA|SG|IN|GLOBAL|UN|INTL)-[A-Z0-9]{2,16}-[A-Z0-9-]{1,32})\b/g;
const EXCEPTION_SIG_RE = /\b(?:[A-Za-z_][A-Za-z0-9_.]*\.)?[A-Z][A-Za-z0-9_]*(?:Error|Exception|Conflict|Fault):\s*[^\r\n]{1,140}/g;
const HTTP_ERR_SIG_RE = /\bHTTP\s+[45]\d{2}(?:\s+[A-Za-z0-9_/-]{2,64}(?:\s+[A-Za-z0-9_/-]{1,32}){0,3})?/g;

const FILE_EXTENSIONS = new Set([
  "py", "js", "mjs", "ts", "tsx", "sql", "json", "jsonc", "toml", "yaml", "yml", "md", "sh", "rs", "go", "css", "html", "txt",
]);
const DOMAIN_TLDS = new Set(["com", "dev", "org", "io", "net", "ai", "gov", "edu", "test", "local"]);
const IGNORED_CALLS = new Set(["if()", "for()", "while()", "switch()", "catch()", "return()"]);

function cleanEntityToken(raw) {
  return String(raw || "").trim().replace(/[.,;:)\]}'"`]+$/, "");
}

function looksLikeDomainSegment(seg) {
  if (!seg || !seg.includes(".") || seg.startsWith(".")) return false;
  const tld = seg.split(".").pop().toLowerCase();
  return DOMAIN_TLDS.has(tld);
}

export function extractEntities(text, extraPaths = []) {
  const bounded = String(text || "").slice(0, 65536);
  const seen = new Set();
  const results = [];

  const add = (kind, rawVal) => {
    if (results.length >= 64) return;
    const val = String(rawVal || "").replace(/\s+/g, " ").trim().slice(0, 240);
    if (val.length < 2) return;
    const key = `${kind}\u0000${val}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ kind, value: val });
    }
  };

  for (const m of bounded.matchAll(TESSERA_URI_RE)) add("tessera_uri", cleanEntityToken(m[0]));
  for (const m of bounded.matchAll(NOUN_VERB_URI_RE)) add("tessera_uri", cleanEntityToken(m[0]));

  for (const rawPath of extraPaths || []) {
    const cleanedExtra = cleanEntityToken(rawPath).replace(/^(?:\.\/)+/, "");
    if (cleanedExtra && !cleanedExtra.startsWith("http://") && !cleanedExtra.startsWith("https://") && !cleanedExtra.startsWith("tessera://")) {
      add("file_path", cleanedExtra);
    }
  }

  const scrubbed = bounded.replace(URL_SPAN_RE, " ");
  for (const m of scrubbed.matchAll(FILE_PATH_RE)) {
    const norm = cleanEntityToken(m[0]).replace(/^(?:\.\/)+/, "");
    const firstSeg = norm.split("/")[0] || "";
    if (looksLikeDomainSegment(firstSeg)) continue;
    if (norm) add("file_path", norm);
  }
  for (const m of scrubbed.matchAll(BACKTICK_FILE_RE)) add("file_path", cleanEntityToken(m[1]));

  for (const m of bounded.matchAll(DECL_SYMBOL_RE)) add("code_symbol", m[1]);
  for (const m of bounded.matchAll(BACKTICK_SYMBOL_RE)) {
    const sym = cleanEntityToken(m[1]);
    if (!sym.endsWith("()") && sym.includes(".")) {
      const ext = sym.split(".").pop().toLowerCase();
      if (FILE_EXTENSIONS.has(ext) || looksLikeDomainSegment(sym)) continue;
    }
    add("code_symbol", sym);
  }
  for (const m of scrubbed.matchAll(CALL_SYMBOL_RE)) {
    if (!IGNORED_CALLS.has(m[1].toLowerCase())) add("code_symbol", m[1]);
  }

  for (const m of bounded.matchAll(STATUTE_CARD_RE)) add("statute_card_id", m[0]);

  for (const m of bounded.matchAll(EXCEPTION_SIG_RE)) add("error_signature", m[0].replace(/[.,;)]+$/, ""));
  for (const m of bounded.matchAll(HTTP_ERR_SIG_RE)) add("error_signature", m[0].replace(/[.,;)]+$/, ""));

  return results;
}

export function estimateTokensSaved(promptText, directResponseText) {
  if (!directResponseText) return 0;
  const rawChars = String(promptText || "").length + String(directResponseText || "").length;
  return Math.max(16, Math.floor(rawChars / 4) + 96);
}

function slugifyUpper(raw, maxLen = 18) {
  const cleaned = String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!cleaned) return "ITEM";
  return cleaned.slice(0, maxLen).replace(/-+$/, "") || "ITEM";
}

export async function synthesizeCandidateProvisions(entities, activeProvisions, projectTag = "default") {
  const existingIds = new Set((activeProvisions || []).map((sp) => sp.provision.prov_id));
  const shimmedUris = new Set(
    (activeProvisions || []).flatMap((sp) => (sp.provision.uris || []).map((u) => u.uri))
  );
  const shimmedRefs = new Set(
    (activeProvisions || []).flatMap((sp) => sp.provision.context_refs || [])
  );
  const existingKeywords = new Set(
    (activeProvisions || []).flatMap((sp) =>
      (sp.provision.triggers?.keyword?.any_keywords || []).map((kw) => String(kw).toLowerCase())
    )
  );

  const candidates = [];
  const seenProvIds = new Set();

  for (const ent of entities || []) {
    if (Number(ent.hit_count || 0) < 2) continue;
    const val = String(ent.entity_value || "").trim();
    const h6 = (await sha256Hex(`${ent.entity_kind}:${val}`)).slice(0, 6).toUpperCase();

    if (ent.entity_kind === "error_signature") {
      const head = val.split(":")[0].trim();
      const slug = slugifyUpper(head, 20);
      const provId = `PROV-CAND-ERR-${slug}-${h6}`.slice(0, 48).replace(/-+$/, "");
      if (existingIds.has(provId) || seenProvIds.has(provId)) continue;
      const kwList = [head.length >= 3 ? head : val.slice(0, 48)];
      if (!kwList.some((k) => k.toLowerCase() === val.slice(0, 64).toLowerCase())) {
        kwList.push(val.slice(0, 64));
      }
      candidates.push(
        validateProvisionPayload({
          prov_id: provId,
          title: `Guard Recurring ${head.slice(0, 80)}`,
          summary: `Reviewable candidate synthesized from ${ent.hit_count} recurring error_signature hits in project ${projectTag}.`.slice(0, 400),
          priority: 220,
          enabled: true,
          action: "shim_context",
          inject_position: "developer_context",
          dedupe_mode: "once_per_conversation",
          max_chars: 1800,
          inject_text: `Recurring error signature observed (${ent.hit_count}x): ${val}. Verify preconditions, schema contracts, and compare-and-set versions before retrying the failing call.`.slice(0, 12000),
          metadata_tags: {
            review_status: "draft_candidate",
            source_kind: "error_signature",
            project_tag: projectTag,
            hit_count: String(ent.hit_count),
          },
          triggers: { mode: "any", keyword: { any_keywords: kwList } },
        })
      );
      seenProvIds.add(provId);
    } else if (ent.entity_kind === "tessera_uri") {
      if (shimmedUris.has(val) || shimmedRefs.has(val) || existingKeywords.has(val.toLowerCase())) continue;
      const tail = val.split("/").pop().split(":").pop();
      const slug = slugifyUpper(tail, 18);
      const provId = `PROV-CAND-URI-${slug}-${h6}`.slice(0, 48).replace(/-+$/, "");
      if (existingIds.has(provId) || seenProvIds.has(provId)) continue;
      const isRef = val.startsWith("noun:") || val.startsWith("verb:") || val.startsWith("detail:");
      candidates.push(
        validateProvisionPayload({
          prov_id: provId,
          title: `Shim Hot Tessera Context ${val.slice(0, 80)}`,
          summary: `Reviewable candidate synthesized from ${ent.hit_count} un-shimmed tessera_uri hits in project ${projectTag}.`.slice(0, 400),
          priority: 210,
          enabled: true,
          action: "shim_context",
          context_refs: isRef ? [val] : [],
          inject_position: "system_suffix",
          dedupe_mode: "once_per_conversation",
          max_chars: 2200,
          inject_text: `Attach authoritative Tessera resource ${val} whenever this noun, verb, or artifact is referenced so turns remain grounded without re-querying.`,
          uris: isRef ? [] : [{ uri: val, label: `Hot Tessera Resource (${val.slice(0, 60)})`, kind: "store_record" }],
          metadata_tags: {
            review_status: "draft_candidate",
            source_kind: "tessera_uri",
            project_tag: projectTag,
            hit_count: String(ent.hit_count),
          },
          triggers: { mode: "any", keyword: { any_keywords: [val] } },
        })
      );
      seenProvIds.add(provId);
    } else if (ent.entity_kind === "statute_card_id") {
      if (existingKeywords.has(val.toLowerCase())) continue;
      const slug = slugifyUpper(val, 20);
      const provId = `PROV-CAND-CARD-${slug}-${h6}`.slice(0, 48).replace(/-+$/, "");
      if (existingIds.has(provId) || seenProvIds.has(provId)) continue;
      candidates.push(
        validateProvisionPayload({
          prov_id: provId,
          title: `Shim Statute Card ${val.slice(0, 80)} Guardrails`,
          summary: `Reviewable candidate synthesized from ${ent.hit_count} un-shimmed statute_card_id hits in project ${projectTag}.`.slice(0, 400),
          priority: 230,
          enabled: true,
          action: "shim_context",
          inject_position: "system_suffix",
          dedupe_mode: "once_per_conversation",
          max_chars: 2000,
          inject_text: `When evaluating statute card ${val}, tie risk indicators strictly to primary statutory elements and deterministic arithmetic without making accusatory claims.`,
          uris: [{ uri: `urn:herma:statute-card:${val}`, label: `Statute Card ${val}`, kind: "statute_card" }],
          metadata_tags: {
            review_status: "draft_candidate",
            source_kind: "statute_card_id",
            project_tag: projectTag,
            hit_count: String(ent.hit_count),
          },
          triggers: { mode: "any", keyword: { any_keywords: [val] } },
        })
      );
      seenProvIds.add(provId);
    }
  }
  return candidates;
}

// --- 3-Tier Trigger Engine ---

function globMatch(name, pattern) {
  let re = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") re += ".*";
    else if (ch === "?") re += ".";
    else if ("\\^$+?.()|{}[]".includes(ch)) re += "\\" + ch;
    else re += ch;
  }
  re += "$";
  return new RegExp(re, "i").test(name);
}

function evaluateKeyword(spec, ctx) {
  if (!spec) return { matched: false, reasons: [] };
  const lower = (ctx.text || "").toLowerCase();
  const reasons = [];

  for (const ex of spec.exclude_keywords || []) {
    if (lower.includes(String(ex).toLowerCase())) return { matched: false, reasons: [] };
  }
  if (spec.all_keywords?.length) {
    const allHit = spec.all_keywords.every((k) => lower.includes(String(k).toLowerCase()));
    if (!allHit) return { matched: false, reasons: [] };
    reasons.push(`keyword:all(${spec.all_keywords.join(",")})`);
  }
  for (const kw of spec.any_keywords || []) {
    if (lower.includes(String(kw).toLowerCase())) {
      reasons.push(`keyword:any('${kw}')`);
    }
  }
  for (const pat of spec.regex_patterns || []) {
    if (String(pat).length <= 240) {
      try {
        if (new RegExp(pat, "i").test(ctx.text.slice(0, 16384))) reasons.push(`keyword:regex('${pat}')`);
      } catch {
        // ignore invalid user pattern
      }
    }
  }
  for (const p of ctx.file_paths || []) {
    for (const g of spec.path_globs || []) {
      if (globMatch(p, g)) reasons.push(`keyword:path('${p}'~'${g}')`);
    }
  }
  for (const t of ctx.tool_names || []) {
    if ((spec.tool_names || []).includes(t)) reasons.push(`keyword:tool('${t}')`);
  }
  return { matched: reasons.length > 0, reasons };
}

function stemWord(word) {
  for (const suffix of ["ing", "tion", "ions", "ments", "ment", "ed", "es", "s"]) {
    if (word.length > suffix.length + 3 && word.endsWith(suffix)) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

function vectorizeText(text) {
  const lower = String(text || "").toLowerCase().slice(0, 16384);
  const rawTokens = (lower.match(/[a-z0-9]{2,}/g) || []).filter((t) => !STOPWORDS.has(t));
  const stems = rawTokens.map(stemWord);
  const counts = new Map();
  const add = (k, n) => counts.set(k, (counts.get(k) || 0) + n);

  for (const s of stems) {
    add(`w:${s}`, 2);
    if (s.length >= 5) {
      for (let i = 0; i <= s.length - 4; i++) add(`c4:${s.slice(i, i + 4)}`, 1);
    }
  }
  for (let i = 0; i < stems.length - 1; i++) {
    add(`bg:${stems[i]}_${stems[i + 1]}`, 2);
  }
  const tokenSet = new Set([...rawTokens, ...stems]);
  for (const [cid, members] of CONCEPT_GROUPS) {
    let overlap = 0;
    for (const m of members) {
      if (tokenSet.has(m) || tokenSet.has(stemWord(m))) overlap += 1;
    }
    if (overlap > 0) add(cid, overlap * 3);
  }
  let normSq = 0;
  const vec = new Map();
  for (const [feat, cnt] of counts.entries()) {
    const w = 1.0 + Math.log(cnt);
    vec.set(feat, w);
    normSq += w * w;
  }
  const norm = Math.sqrt(normSq);
  if (!norm) return vec;
  for (const [feat, w] of vec.entries()) vec.set(feat, w / norm);
  return vec;
}

function cosineSparse(a, b) {
  if (!a.size || !b.size) return 0.0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let sum = 0.0;
  for (const [k, v] of small.entries()) sum += v * (big.get(k) || 0.0);
  return sum;
}

function evaluateSemantic(spec, text) {
  if (!spec || !spec.exemplars?.length) return { matched: false, reasons: [], score: 0.0 };
  const qVec = vectorizeText(text);
  if (!qVec.size) return { matched: false, reasons: [], score: 0.0 };
  const conceptCtx = (spec.concepts || []).join(" ");
  let best = 0.0;
  let bestEx = "";
  for (const ex of spec.exemplars) {
    const exVec = vectorizeText(`${ex} ${conceptCtx}`);
    const s = cosineSparse(qVec, exVec);
    if (s > best) {
      best = s;
      bestEx = ex;
    }
  }
  const threshold = spec.threshold ?? 0.25;
  const matched = best >= threshold;
  const rounded = Math.round(best * 10000) / 10000;
  return {
    matched,
    score: rounded,
    reasons: matched ? [`semantic:cosine(${best.toFixed(3)}>=${threshold.toFixed(2)} ~ '${bestEx.slice(0, 48)}')`] : [],
  };
}

async function evaluateMicromodel(spec, text, env, { offlineOnly = false } = {}) {
  if (!spec) return { matched: false, reasons: [], confidence: null };
  const mmUrl = (env?.HERMA_MICROMODEL_URL || "").trim();
  const mmModel = (env?.HERMA_MICROMODEL_MODEL || "muse-spark-open").trim();
  refuseContributorModel(mmModel);
  if (!offlineOnly && mmUrl) {
    try {
      const headers = { "content-type": "application/json" };
      if (env.HERMA_MICROMODEL_API_KEY) headers["authorization"] = `Bearer ${env.HERMA_MICROMODEL_API_KEY}`;
      const resp = await fetch(mmUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: mmModel,
          temperature: 0,
          messages: [
            { role: "system", content: "Reply only with JSON: {\"apply\":true|false,\"label\":\"apply\"|\"skip\",\"confidence\":0.0..1.0,\"reason\":\"short phrase\"}" },
            { role: "user", content: `${spec.intent_question}\n\nRequest:\n${String(text).slice(0, 2000)}` },
          ],
        }),
      });
      if (resp.ok) {
        let data;
        try { data = await resp.json(); }
        catch { return { matched: false, reasons: [], confidence: 0.0 }; }
        const raw = data?.choices?.[0]?.message?.content;
        let parsed;
        try { parsed = typeof raw === "string" ? JSON.parse(raw) : null; }
        catch { parsed = null; }
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object" ||
            typeof parsed.apply !== "boolean" || typeof parsed.confidence !== "number" ||
            !Number.isFinite(parsed.confidence) || parsed.confidence < 0 || parsed.confidence > 1 ||
            ["label", "reason"].some(field => field in parsed && typeof parsed[field] !== "string")) {
          return { matched: false, reasons: [], confidence: 0.0 };
        }
        const label = parsed.label || "apply";
        const conf = parsed.confidence;
        const minConf = spec.min_confidence ?? 0.6;
        if (parsed.apply && conf >= minConf) {
          return { matched: true, reasons: [`micromodel:llm(${label}@${conf.toFixed(2)})`], confidence: conf };
        }
        return { matched: false, reasons: [], confidence: conf };
      }
    } catch {
      // fall through to deterministic offline fallback keywords
    }
  }
  const lower = String(text || "").toLowerCase();
  const hits = (spec.fallback_keywords || []).filter((kw) => lower.includes(String(kw).toLowerCase()));
  if (hits.length > 0) {
    const conf = Math.min(0.95, 0.65 + hits.length * 0.08);
    if (conf >= (spec.min_confidence ?? 0.6)) {
      return {
        matched: true,
        reasons: [`micromodel:fallback(${hits.join(",")})`],
        confidence: Math.round(conf * 1000) / 1000,
      };
    }
  }
  return { matched: false, reasons: [], confidence: 0.0 };
}

export async function evaluateProvisions(storedList, ctx, env, { offlineOnly = false } = {}) {
  const results = [];
  for (const stored of storedList) {
    const prov = stored.provision;
    if (!prov.enabled) continue;
    const t = prov.triggers || { mode: "any" };
    const mode = t.mode || "any";
    const configuredTiers = [];
    if (t.keyword) configuredTiers.push("keyword");
    if (t.semantic) configuredTiers.push("semantic");
    if (t.micromodel) configuredTiers.push("micromodel");
    if (!configuredTiers.length) continue;

    const matchedTiers = [];
    const reasons = [];
    let semanticScore = null;
    let mmConfidence = null;

    if (t.keyword) {
      const r1 = evaluateKeyword(t.keyword, ctx);
      if (r1.matched) {
        matchedTiers.push("keyword");
        reasons.push(...r1.reasons);
      } else if (mode === "all") continue;
    }
    if (t.semantic && !(mode === "any" && matchedTiers.length > 0)) {
      const r2 = evaluateSemantic(t.semantic, ctx.text);
      semanticScore = r2.score;
      if (r2.matched) {
        matchedTiers.push("semantic");
        reasons.push(...r2.reasons);
      } else if (mode === "all") continue;
    }
    if (t.micromodel && !(mode === "any" && matchedTiers.length > 0)) {
      const r3 = await evaluateMicromodel(t.micromodel, ctx.text, env, { offlineOnly });
      mmConfidence = r3.confidence;
      if (r3.matched) {
        matchedTiers.push("micromodel");
        reasons.push(...r3.reasons);
      } else if (mode === "all") continue;
    }

    const ok = mode === "all" ? matchedTiers.length === configuredTiers.length : matchedTiers.length > 0;
    if (ok) {
      results.push({
        stored,
        match: {
          prov_id: prov.prov_id,
          version: stored.version,
          priority: prov.priority ?? 100,
          matched_tiers: matchedTiers,
          reasons,
          score: semanticScore ?? mmConfidence ?? 1.0,
          semantic_score: semanticScore,
          micromodel_confidence: mmConfidence,
        },
      });
    }
  }
  return results;
}

function flattenContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const item of content) {
      if (typeof item === "string") parts.push(item);
      else if (item && typeof item === "object") {
        for (const k of ["text", "input_text", "content"]) {
          if (typeof item[k] === "string") parts.push(item[k]);
        }
      }
    }
    return parts.join("\n");
  }
  if (content && typeof content === "object") return String(content.text || content.content || "");
  return "";
}

export function extractEnvelope(wireFormat, payload, extraPaths = []) {
  const model = String(payload?.model || "unknown");
  refuseContributorModel(model);

  const allChunks = [];
  const activeChunks = [];
  if ((wireFormat === "chat_completions" || wireFormat === "dry_run") && Array.isArray(payload?.messages)) {
    for (const m of payload.messages) {
      if (m && typeof m === "object") {
        const txt = flattenContent(m.content);
        allChunks.push(txt);
        if (m.role === "user" || m.role === "tool") activeChunks.push(txt);
      }
    }
  } else if (wireFormat === "responses" || "input" in (payload || {})) {
    if (typeof payload.instructions === "string") allChunks.push(payload.instructions);
    if (typeof payload.input === "string") {
      allChunks.push(payload.input);
      activeChunks.push(payload.input);
    } else if (Array.isArray(payload.input)) {
      for (const item of payload.input) {
        const txt = flattenContent(item);
        allChunks.push(txt);
        if (!item || typeof item !== "object" || item.role !== "system") activeChunks.push(txt);
      }
    }
  } else if (wireFormat === "messages") {
    const sys = flattenContent(payload?.system);
    if (sys) allChunks.push(sys);
    if (Array.isArray(payload?.messages)) {
      for (const m of payload.messages) {
        if (m && typeof m === "object") {
          const txt = flattenContent(m.content);
          allChunks.push(txt);
          if (m.role === "user") activeChunks.push(txt);
        }
      }
    }
  }

  const fullHistory = allChunks.filter(Boolean).join("\n");
  const recentText = activeChunks.length ? activeChunks.slice(-3).join("\n") : fullHistory;
  const existingIds = new Set();
  const markerRe = /\[HERMA PROVISION:\s*(PROV-[A-Z0-9-]+)@v\d+/g;
  let m;
  while ((m = markerRe.exec(fullHistory)) !== null) existingIds.add(m[1]);

  const pathRe = /(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,8}/g;
  const detectedPaths = [...new Set([...(extraPaths || []), ...(recentText.match(pathRe) || [])])];
  const toolNames = [];
  if (Array.isArray(payload?.tools)) {
    for (const t of payload.tools) {
      if (typeof t?.function?.name === "string") toolNames.push(t.function.name);
      else if (typeof t?.name === "string") toolNames.push(t.name);
    }
  }

  return {
    wire_format: wireFormat,
    model,
    trigger_context: { text: recentText, file_paths: detectedPaths, tool_names: toolNames },
    existing_provision_ids: existingIds,
  };
}

export function renderContextEntriesBlock(refs, contextMap) {
  if (!Array.isArray(refs) || !refs.length || !contextMap) {
    return { block: "", shimmedRefs: [], uris: [] };
  }
  const lines = [];
  const shimmedRefs = [];
  const uris = [];
  for (const ref of refs) {
    const entry = contextMap instanceof Map ? contextMap.get(ref) : contextMap[ref];
    if (!entry) continue;
    if (!shimmedRefs.includes(entry.entry_id)) shimmedRefs.push(entry.entry_id);
    let bodyExcerpt = "";
    if (entry.schema_or_body && typeof entry.schema_or_body === "object" && Object.keys(entry.schema_or_body).length > 0) {
      bodyExcerpt = canonicalJson(entry.schema_or_body);
    } else if (typeof entry.schema_or_body === "string" && entry.schema_or_body.trim()) {
      bodyExcerpt = entry.schema_or_body.trim();
    }
    if (bodyExcerpt.length > 320) bodyExcerpt = bodyExcerpt.slice(0, 319).trimEnd() + "...";
    let line = `- [${String(entry.kind || "detail").toUpperCase()}] ${entry.entry_id} (${entry.title}): ${String(entry.summary || "").trim()}`;
    if (bodyExcerpt) line += ` -- ${bodyExcerpt}`;
    if (entry.source_uri) {
      line += ` [URI: ${entry.source_uri}]`;
      if (!uris.includes(entry.source_uri)) uris.push(entry.source_uri);
    }
    lines.push(line);
  }
  if (!lines.length) return { block: "", shimmedRefs: [], uris: [] };
  return {
    block: ["[NOUN/VERB CONTEXT]", ...lines, "[/NOUN/VERB CONTEXT]"].join("\n"),
    shimmedRefs,
    uris,
  };
}

function renderProvisionBlock(stored, contextMap = null) {
  const prov = stored.provision;
  const lines = [`[HERMA PROVISION: ${prov.prov_id}@v${stored.version} | ${prov.title}]`];
  if (String(prov.inject_text || "").trim()) {
    lines.push(String(prov.inject_text).trim());
  }
  const { block: ctxBlock, shimmedRefs, uris: ctxUris } = renderContextEntriesBlock(prov.context_refs || [], contextMap);
  if (ctxBlock) lines.push(ctxBlock);

  const uris = [...ctxUris];
  if (Array.isArray(prov.uris) && prov.uris.length) {
    lines.push("Authoritative References & URIs:");
    for (const u of prov.uris) {
      if (!uris.includes(u.uri)) uris.push(u.uri);
      let line = `- [${u.label}](${u.uri}) (${u.kind || "doc"})`;
      if (u.inline_excerpt) line += `: ${String(u.inline_excerpt).trim()}`;
      lines.push(line);
    }
  }
  lines.push(`[/HERMA PROVISION: ${prov.prov_id}]`);
  let rendered = lines.join("\n");
  const maxChars = prov.max_chars || 2400;
  if (rendered.length > maxChars) {
    rendered = rendered.slice(0, maxChars - 36).trimEnd() + `\n[/HERMA PROVISION: ${prov.prov_id}]`;
  }
  return { rendered, uris, shimmedRefs };
}

export function buildDirectProtocolResponse(wireFormat, receipt) {
  const rendered = receipt.direct_response_text || "";
  const createdTs = Math.floor(Number(receipt.created_at || Date.now() / 1000));
  if (wireFormat === "responses") {
    return {
      id: `resp_${receipt.receipt_id}`,
      object: "response",
      created_at: createdTs,
      status: "completed",
      model: receipt.model,
      output_text: rendered,
      output: [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: rendered }],
        },
      ],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    };
  }
  if (wireFormat === "messages") {
    return {
      id: `msg_${receipt.receipt_id}`,
      type: "message",
      role: "assistant",
      model: receipt.model,
      content: [{ type: "text", text: rendered }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }
  return {
    id: `chatcmpl-${receipt.receipt_id}`,
    object: "chat.completion",
    created: createdTs,
    model: receipt.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: rendered },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

export async function assembleAugmentedRequest(
  principal,
  envelope,
  payload,
  matches,
  maxTotalChars = 8000,
  contextMap = null,
  { projectTag = "default", entitiesTracked = 0 } = {}
) {
  const prefixBlocks = [];
  const suffixBlocks = [];
  const devBlocks = [];
  const firedIds = [];
  const dedupedSkipped = [];
  const tiersSeen = [];
  const urisInjected = [];
  const shimmedContextRefs = [];
  let respondedDirectly = false;
  let directResponseText = null;
  let charsUsed = 0;

  for (const { stored, match } of matches) {
    const prov = stored.provision;
    if ((prov.dedupe_mode || "once_per_conversation") === "once_per_conversation" && envelope.existing_provision_ids.has(prov.prov_id)) {
      dedupedSkipped.push(prov.prov_id);
      continue;
    }

    if (prov.action === "respond_directly" && String(prov.direct_response || "").trim()) {
      if (!respondedDirectly) {
        respondedDirectly = true;
        const baseDirect = String(prov.direct_response).trim();
        const { block: ctxBlock, shimmedRefs: cRefs, uris: cUris } = renderContextEntriesBlock(prov.context_refs || [], contextMap);
        let renderedDirect = ctxBlock ? `${baseDirect}\n\n${ctxBlock}` : baseDirect;
        const maxChars = prov.max_chars || 2400;
        if (renderedDirect.length > maxChars) renderedDirect = renderedDirect.slice(0, maxChars).trimEnd();
        directResponseText = renderedDirect;
        charsUsed += renderedDirect.length;
        firedIds.push(`${prov.prov_id}@v${stored.version}`);
        for (const t of match.matched_tiers) if (!tiersSeen.includes(t)) tiersSeen.push(t);
        for (const r of cRefs) if (!shimmedContextRefs.includes(r)) shimmedContextRefs.push(r);
        for (const u of [...cUris, ...((prov.uris || []).map((x) => x.uri))]) {
          if (u && !urisInjected.includes(u)) urisInjected.push(u);
        }
      }
      continue;
    }

    const { rendered, uris, shimmedRefs } = renderProvisionBlock(stored, contextMap);
    if (charsUsed + rendered.length > maxTotalChars) continue;
    charsUsed += rendered.length;
    firedIds.push(`${prov.prov_id}@v${stored.version}`);
    for (const t of match.matched_tiers) if (!tiersSeen.includes(t)) tiersSeen.push(t);
    for (const u of uris) if (!urisInjected.includes(u)) urisInjected.push(u);
    for (const r of shimmedRefs) if (!shimmedContextRefs.includes(r)) shimmedContextRefs.push(r);
    if (prov.inject_position === "system_prefix") prefixBlocks.push(rendered);
    else if (prov.inject_position === "developer_context") devBlocks.push(rendered);
    else suffixBlocks.push(rendered);
  }

  const mutated = structuredClone(payload);
  const sysPrefix = prefixBlocks.join("\n\n");
  const sysSuffix = [...suffixBlocks, ...devBlocks].join("\n\n");
  const fullAdd = [sysPrefix, sysSuffix].filter(Boolean).join("\n\n");

  if (fullAdd) {
    if (envelope.wire_format === "responses" || ("input" in mutated && !("messages" in mutated))) {
      const orig = String(mutated.instructions || "").trim();
      mutated.instructions = [sysPrefix, orig, sysSuffix].filter(Boolean).join("\n\n");
    } else if (
      envelope.wire_format === "messages" &&
      "messages" in mutated &&
      "max_tokens" in mutated &&
      !(mutated.messages || []).some((m) => m?.role === "system")
    ) {
      const orig = flattenContent(mutated.system).trim();
      mutated.system = [sysPrefix, orig, sysSuffix].filter(Boolean).join("\n\n");
    } else {
      const msgs = Array.isArray(mutated.messages) ? [...mutated.messages] : [];
      const sysIdx = msgs.findIndex((m) => m && m.role === "system");
      if (sysIdx >= 0) {
        const orig = flattenContent(msgs[sysIdx].content).trim();
        msgs[sysIdx] = { ...msgs[sysIdx], content: [sysPrefix, orig, sysSuffix].filter(Boolean).join("\n\n") };
      } else {
        msgs.unshift({ role: "system", content: fullAdd });
      }
      mutated.messages = msgs;
    }
  }

  const now = Date.now() / 1000;
  const randHex = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
  const receiptId = `rcpt_${randHex}`;
  const core = {
    receipt_id: receiptId,
    harness_kind: principal.harness_kind,
    key_id: principal.key_id,
    project_tag: projectTag,
    wire_format: envelope.wire_format,
    model: envelope.model,
    provisions_fired: firedIds,
    tiers_matched: tiersSeen,
    uris_injected: urisInjected,
    injected_chars: charsUsed,
    deduped_skipped: dedupedSkipped,
    responded_directly: respondedDirectly,
    direct_response_text: directResponseText,
    shimmed_context_refs: shimmedContextRefs,
    entities_tracked: Number(entitiesTracked || 0),
  };
  const receiptSha = await sha256Hex(canonicalJson(core));
  return {
    augmented_payload: mutated,
    receipt: { ...core, receipt_sha256: receiptSha, created_at: now },
  };
}

// --- Discovery & Server-Rendered HTML ---

export function buildAgentCard(publicUrl) {
  const base = String(publicUrl || "").replace(/\/+$/, "");
  return {
    name: "Herma",
    description:
      "Context-shimming AI middleware for configurable coding harnesses: 3-tier trigger evaluation, caller-isolated atomic noun/verb context database, zero-token direct responses, deterministic entity memory, and self-improving rule insights.",
    url: base,
    version: HERMA_VERSION,
    protocol_version: "1.0",
    capabilities: {
      streaming: true,
      mcp: true,
      context_shimming: true,
      direct_response: true,
      caller_isolation: true,
      entity_memory: true,
      self_improving_insights: true,
    },
    endpoints: {
      mcp: `${base}/mcp`,
      preview: `${base}/api/preview`,
      health: `${base}/healthz`,
      llms_txt: `${base}/llms.txt`,
      llms_full_txt: `${base}/llms-full.txt`,
      handshake: `${base}/v1/handshake`,
      dry_run: `${base}/v1/dry-run`,
      chat_completions: `${base}/v1/chat/completions`,
      responses: `${base}/v1/responses`,
      messages: `${base}/v1/messages`,
      memory: `${base}/v1/memory`,
      outcomes: `${base}/v1/outcomes`,
      insights: `${base}/v1/insights`,
    },
    authentication: {
      schemes: ["bearer", "x-herma-key"],
      credential_prefix: "hmk_",
      configurable_harnesses_only: true,
      allowed_harnesses: [...ALLOWED_HARNESS_KINDS],
    },
    skills: [
      {
        id: "list_builtin_provisions",
        name: "List Builtin Provisions",
        description: "Inspect starter system_builtin context-shimming and direct-response provisions.",
      },
      {
        id: "preview_shim",
        name: "Preview Context Shim & Triggers",
        description: "Dry-run 3-tier builtin triggers and context shimming in memory without persisting state.",
      },
      {
        id: "extract_entities",
        name: "Extract Top-of-Mind Entities",
        description: "Deterministically extract file paths, code symbols, Tessera URIs, statute card IDs, and error signatures.",
      },
    ],
  };
}

export function buildLlmsTxt(publicUrl) {
  const base = String(publicUrl || "").replace(/\/+$/, "");
  return [
    "# Herma",
    "Public MCP and /api/preview require no key. Private /v1 routing and management require scoped hmk_ credentials. Personal assistants are supported. Read /connect.json; tracked artifact persistence uses your own Tessera tan_ session or tsk_ key.",
    "",
    "> Context-shimming AI middleware for configurable coding harnesses -- intercepts requests via keyword, semantic, or micromodel rules to respond directly or shim caller-isolated noun, verb, and URI context before LLM execution.",
    "",
    `- Base URL: ${base}`,
    `- Full Reference: ${base}/llms-full.txt`,
    `- Agent Card: ${base}/.well-known/agent-card.json`,
    `- Stateless MCP JSON-RPC: POST ${base}/mcp`,
    `- Read-Only Preview: POST ${base}/api/preview`,
    `- Health: GET ${base}/healthz`,
    "",
    "## Core Authenticated Endpoints (`hmk_` Harness Key Required)",
    "- `POST /v1/handshake`: Negotiate Surface Handshake v1.0 limits (`X-Surface-Id`).",
    "- `POST /v1/conversations/turn`, `GET /v1/conversations/{id}`: Optional typed work dialogue using caller-visible work contracts, expected_version and request_id. Returns a clarification, proposal or blocker with executed:false. Check work_conversations.enabled in /connect.json; requires hmk_ route scope.",
    "- `POST /v1/dry-run`: Inspect caller-isolated augmented payload, matches, entities, and receipt.",
    "- `POST /v1/chat/completions`, `POST /v1/responses`, `POST /v1/messages`: Multi-wire shim or direct-response proxy.",
    "- `GET|POST /v1/context`, `GET /v1/provisions`, `PUT|DELETE /v1/provisions/{prov_id}`: Caller-scoped atomic CAS CRUD (`system_builtin` protected with 403).",
    "- `GET /v1/memory`, `POST /v1/outcomes`, `GET /v1/insights`: Deterministic Anti-RAG working entity memory and reviewable candidate rules.",
    "",
  ].join("\n");
}

export function buildLlmsFullTxt(publicUrl) {
  const base = String(publicUrl || "").replace(/\/+$/, "");
  const provSummaries = DEFAULT_PROVISIONS.map(
    (p) => `- \`${p.prov_id}\` (\`${p.action}\`, priority ${p.priority}): ${p.summary}`
  ).join("\n");
  return [
    buildLlmsTxt(base).trimEnd(),
    "",
    "## Starter Builtin Provisions (`caller_scope = system_builtin`)",
    provSummaries,
    "",
    "## Security & Isolation Invariants",
    "- Multi-caller non-poisoning: custom provisions, context entries, receipts, working entities, and outcomes are strictly partitioned by `caller_scope = key:<key_id>`.",
    "- Builtin protection: non-admin attempts to overwrite or delete `system_builtin` provisions or context entries return `403 builtin_protected`.",
    "- Admin key lockdown: `/v1/admin/keys` requires bootstrap/admin secret (`403 admin_required` for ordinary `configure` keys).",
    "- Layer-1 Governance Lens: refuses `status:quarantined` items, verifies SHA-256 on `tessera://blobs/<sha>`, and enforces `visibility_scope`, `allowed_surfaces`, and `X-Herma-Cohort`.",
    "- Standard mode only: refuses `contributor` and `*-contributor` model identifiers (`403 contributor_tier_refused`).",
    "",
  ].join("\n");
}

const STYLE = `:root{color-scheme:light dark;--bg:#0c1017;--card:#131a24;--border:#253244;--fg:#eef2f7;--muted:#9fb0c5;--accent:#67b7ff;--pill:#1b2738;--danger:#ff7b7b;--ok:#53d69a}
@media (prefers-color-scheme:light){:root{--bg:#f6f7f9;--card:#fff;--border:#d8e0ea;--fg:#101824;--muted:#4b5b70;--accent:#0b5fff;--pill:#eaf1fb;--danger:#b42318;--ok:#067647}}
*{box-sizing:border-box}html,body{max-width:100%;overflow-x:hidden;margin:0;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--fg);line-height:1.55}
.site-header{border-bottom:1px solid var(--border);background:var(--card)}.header-inner{max-width:1040px;margin:0 auto;padding:.9rem 1.2rem;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.8rem 1.2rem}
.brand{display:inline-flex;align-items:center;gap:.55rem;color:var(--fg);text-decoration:none;font-weight:700;font-size:1.05rem}.brand-mark{color:var(--accent);flex-shrink:0}
nav{display:flex;flex-wrap:wrap;gap:.55rem 1rem;font-size:.9rem;align-items:center}nav a{color:var(--accent);text-decoration:none;font-weight:600}nav a:hover{text-decoration:underline}
main{max-width:1040px;margin:0 auto;padding:2rem 1.2rem 3rem}
.site-footer{max-width:1040px;margin:0 auto;padding:1.4rem 1.2rem 2.4rem;border-top:1px solid var(--border);color:var(--muted);font-size:.86rem;display:flex;flex-wrap:wrap;gap:.6rem 1.4rem;justify-content:space-between}.site-footer a{color:var(--accent);text-decoration:none}
.pill{display:inline-block;padding:.2rem .6rem;border-radius:999px;background:var(--pill);color:var(--accent);font-size:.76rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em}
h1{margin:.6rem 0 .5rem;font-size:clamp(1.55rem,3vw,2.3rem);overflow-wrap:anywhere}.lead{color:var(--muted);max-width:820px;margin:0 0 1.8rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,270px),1fr));gap:1rem;margin-bottom:1.8rem}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1.15rem;min-width:0}.card h2,.card h3{margin:.2rem 0 .5rem;font-size:1.06rem}
pre,code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.85rem}pre{background:var(--pill);border:1px solid var(--border);border-radius:8px;padding:.85rem;overflow-x:auto;max-width:100%;margin:.5rem 0 0}
.table-wrap{width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--border);border-radius:10px;background:var(--card);margin-bottom:1.4rem}
table{width:100%;border-collapse:collapse;font-size:.89rem;min-width:540px}th,td{text-align:left;padding:.65rem .85rem;border-bottom:1px solid var(--border);vertical-align:top}tbody tr:last-child td{border-bottom:none}th{color:var(--muted);font-weight:600;white-space:nowrap}
.inspector{margin:1.8rem 0 2.2rem}.preset-row{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:.8rem}
.btn{appearance:none;border:1px solid var(--border);background:var(--pill);color:var(--fg);border-radius:8px;padding:.45rem .8rem;font-size:.85rem;font-weight:600;cursor:pointer}.btn-primary{background:var(--accent);color:#fff;border-color:var(--accent)}.btn:disabled{opacity:.6;cursor:wait}
.form-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:.75rem;margin:.75rem 0}
label{display:block;font-size:.82rem;font-weight:600;color:var(--muted);margin-bottom:.25rem}textarea,input[type="text"],select{width:100%;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:.55rem .7rem;font:inherit;font-size:.88rem}textarea{min-height:84px;resize:vertical}
.preview-status{margin-top:.75rem;font-size:.86rem;color:var(--muted)}.preview-status.error{color:var(--danger);font-weight:600}.preview-status.ok{color:var(--ok)}
.entity-tags{display:flex;flex-wrap:wrap;gap:.4rem;margin:.5rem 0}.entity-chip{display:inline-block;padding:.18rem .55rem;border-radius:6px;background:var(--pill);border:1px solid var(--border);font-size:.8rem}`;

function renderHeader() {
  return `<header class="site-header"><div class="header-inner"><a class="brand" href="/">${BRAND_SVG}<span>Herma</span></a><nav aria-label="Primary"><a href="/">Overview</a><a href="/connect">Connect Harness</a><a href="/healthz">Health JSON</a><a href="/llms.txt">llms.txt</a><a href="/.well-known/agent-card.json">Agent Card</a><a href="https://tessera.ta-amps.workers.dev/board">Tessera Cloud</a><a href="https://github.com/ta-amps/herma">GitHub</a></nav></div></header>`;
}

function renderFooter(publicUrl) {
  return `<footer class="site-footer"><span>Endpoint: <code>${esc(publicUrl)}</code> · Backed by Cloudflare D1 (<code>ta-amps-herma</code>) · Standard mode only (<code>-contributor</code> refused).</span><span><a href="/llms.txt">llms.txt</a> · <a href="/llms-full.txt">llms-full.txt</a> · <a href="/.well-known/agent-card.json">agent-card.json</a></span></footer>`;
}

export function renderOverviewHtml(
  provisions,
  receiptsOrUnused,
  publicUrl,
  contextEntries = [],
  aggregateCounts = null
) {
  const builtinProvs = (provisions || []).filter(
    (sp) => !sp.caller_scope || sp.caller_scope === SYSTEM_BUILTIN_SCOPE
  );
  const pRows = builtinProvs
    .map((sp) => {
      const p = sp.provision;
      const tiers = ["keyword", "semantic", "micromodel"].filter((k) => p.triggers?.[k]);
      const action = p.action || "shim_context";
      const refsNote = (p.context_refs || []).length ? ` · ${p.context_refs.length} ref(s)` : "";
      return `<tr><td><code>${esc(p.prov_id)}</code> (v${sp.version})</td><td>${esc(p.title)}<br/><small><code>${esc(action)}</code>${esc(refsNote)}</small></td><td><code>${esc(tiers.join(", "))}</code> (${esc(p.triggers?.mode || "any")})</td><td>${(p.uris || []).length} URI(s) · prio ${p.priority}</td><td><code>${esc(sp.source_store)}</code></td></tr>`;
    })
    .join("");
  const cRows = (contextEntries || [])
    .slice(0, 25)
    .map(
      (e) =>
        `<tr><td><code>${esc(e.entry_id)}</code></td><td><code>${esc(e.kind)}</code></td><td>${esc(e.title)}</td><td>${esc(e.summary)}</td><td>${e.source_uri ? `<code>${esc(e.source_uri)}</code>` : "--"}</td></tr>`
    )
    .join("");

  const counts = aggregateCounts || {
    total_intercepted_requests: Array.isArray(receiptsOrUnused) ? receiptsOrUnused.length : 0,
    total_working_entities: 0,
    total_rule_outcomes: 0,
  };

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><link rel="icon" href="/favicon.svg" type="image/svg+xml"/><title>Herma v${HERMA_VERSION} -- Context-Shimming AI Middleware</title><style>${STYLE}</style></head><body>
${renderHeader()}
<main>
<span class="pill">Herma v${HERMA_VERSION} · Programmable AI Request Middleware · 24/7 Cloudflare D1 + Tessera Cloud</span>
<h1>Context-Shimming AI Middleware for Configurable Coding Harnesses</h1>
<p class="lead"><strong>Herma:</strong> context-shimming AI middleware for configurable coding harnesses -- intercepts requests via <strong>keyword</strong>, <strong>semantic</strong>, or <strong>micromodel</strong> rules to <strong>respond directly</strong> or shim atomic <strong>noun, verb, and URI context</strong> from a user-configured database before LLM execution. Personal assistants with scoped credentials are supported. Contributor-tier models remain refused.</p>
<section class="grid">
<div class="card"><span class="pill">Tier 1-3 Rules</span><h3>Keyword, Semantic &amp; Micromodel</h3><p>Evaluates prompt terms, file path globs, tool names, semantic similarity, and micromodel intent routing without bloating static system prompts.</p></div>
<div class="card"><span class="pill">Caller-Isolated Shims</span><h3>Atomic Noun, Verb &amp; Entity Memory</h3><p>Isolates custom rules, context entries, receipts, and top-of-mind working entities per <code>caller_scope</code> while protecting <code>system_builtin</code> guardrails.</p></div>
<div class="card"><span class="pill">respond_directly</span><h3>Zero-Token Direct Responses</h3><p>Short-circuits upstream calls when a rule can answer directly across OpenAI, Responses, and Anthropic protocols while recording a SHA-256 <code>InjectionReceipt</code>.</p></div>
</section>
<section class="card inspector" aria-labelledby="inspector-heading">
<span class="pill">Read-Only Inspector · persisted: false</span>
<h2 id="inspector-heading">Shim Trigger &amp; Entity Extractor Preview</h2>
<p style="color:var(--muted);margin:0.2rem 0 0.8rem;font-size:0.9rem;">Test starter <code>system_builtin</code> provisions and deterministic regex entity extraction in memory without writing receipts or reading caller state.</p>
<div class="preset-row">
<button class="btn" type="button" data-herma-preset="fencing">Preset: Tessera Lease Fencing</button>
<button class="btn" type="button" data-herma-preset="direct">Preset: Direct Noun/Verb Schema</button>
<button class="btn" type="button" data-herma-preset="statute">Preset: Statute Card &amp; Error Retry</button>
</div>
<div><label for="herma-preview-prompt">Outbound Harness Prompt</label><textarea id="herma-preview-prompt" placeholder="e.g. Update src/tessera/_tasks.py to verify noun:tessera.lease_fence and US-ROSCA-8403"></textarea></div>
<div class="form-row">
<div><label for="herma-preview-path">Workspace Paths (comma-separated)</label><input id="herma-preview-path" type="text" placeholder="src/tessera/_tasks.py"/></div>
<div><label for="herma-preview-wire">Wire Protocol</label><select id="herma-preview-wire"><option value="chat_completions">OpenAI /v1/chat/completions</option><option value="responses">Responses /v1/responses</option><option value="messages">Anthropic /v1/messages</option></select></div>
</div>
<button id="herma-preview-btn" class="btn btn-primary" type="button">Run Read-Only Preview</button>
<div id="herma-preview-status" class="preview-status" role="status" aria-live="polite">Enter a coding-harness prompt or choose a preset above to preview builtin triggers and entity extraction (persisted: false).</div>
<div id="herma-preview-output"></div>
</section>
<h2>Starter Builtin Provisions (${builtinProvs.length})</h2>
<div class="table-wrap"><table><thead><tr><th>ID</th><th>Title &amp; Action</th><th>Triggers</th><th>URIs &amp; Priority</th><th>Store</th></tr></thead><tbody>${pRows || "<tr><td colspan='5'>No builtin provisions seeded yet.</td></tr>"}</tbody></table></div>
<h2>Starter Builtin Noun, Verb &amp; Detail Context (${(contextEntries || []).length})</h2>
<div class="table-wrap"><table><thead><tr><th>Entry ID</th><th>Kind</th><th>Title</th><th>Summary</th><th>Source URI</th></tr></thead><tbody>${cRows || "<tr><td colspan='5'>No builtin noun/verb/detail entries configured yet.</td></tr>"}</tbody></table></div>
<h2>Aggregate Middleware Telemetry (Caller Receipts Isolated)</h2>
<div class="table-wrap"><table><thead><tr><th>Builtin Provisions</th><th>Builtin Context Entries</th><th>Intercepted Turns</th><th>Tracked Entities</th><th>Outcome Signals</th></tr></thead><tbody><tr><td><code>${builtinProvs.length}</code></td><td><code>${(contextEntries || []).length}</code></td><td><code>${Number(counts.total_intercepted_requests || 0)}</code></td><td><code>${Number(counts.total_working_entities || 0)}</code></td><td><code>${Number(counts.total_rule_outcomes || 0)}</code></td></tr></tbody></table></div>
</main>
${renderFooter(publicUrl)}
<script src="/preview.js" defer></script>
</body></html>`;
}

export function renderConnectHtml(publicUrl) {
  const base = esc(String(publicUrl || "").replace(/\/+$/, ""));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><link rel="icon" href="/favicon.svg" type="image/svg+xml"/><title>Connect a Configurable Coding Harness -- Herma</title><style>${STYLE}</style></head><body>
${renderHeader()}
<main>
<span class="pill">Scoped Agent Access</span>
<h1>Connect a coding harness or personal assistant</h1>
<p class="lead">Coding harnesses and personal assistants that control custom base URLs, headers, and scoped <code>hmk_</code> credentials can route through or configure Herma. Personal assistants use the same scoped keys; missing credentials return <code>HTTP 403 harness_required</code>.</p>
<div class="card" style="margin-bottom:1.2rem;"><h3>1. Populate Caller-Scoped Noun / Verb Context Entries</h3><pre>curl -fsS -X POST ${base}/v1/context \\
  -H "Content-Type: application/json" \\
  -H "X-Herma-Key: hmk_&lt;id&gt;.&lt;secret&gt;" \\
  -H "X-Herma-Harness: opencode" \\
  -d '{"entry_id":"noun:custom.lease_contract","kind":"noun","title":"Custom Lease Contract","summary":"Caller-scoped atomic noun definition."}'</pre></div>
<div class="card" style="margin-bottom:1.2rem;"><h3>2. Dry-Run 3-Tier Context Shimming or Direct Response</h3><pre>curl -fsS -X POST ${base}/v1/dry-run \\
  -H "Content-Type: application/json" \\
  -H "X-Herma-Key: hmk_&lt;id&gt;.&lt;secret&gt;" \\
  -H "X-Herma-Harness: opencode" \\
  -H "X-Herma-Project: my-repo" \\
  -d '{"wire_format":"chat_completions","payload":{"model":"muse-spark-open","messages":[{"role":"user","content":"Show the canonical noun/verb schema"}]}}'</pre></div>
<div class="card"><h3>3. Sync Governed Provisions &amp; Inspect Self-Improving Insights</h3><pre>curl -fsS ${base}/v1/insights?project_tag=my-repo \\
  -H "X-Herma-Key: hmk_&lt;id&gt;.&lt;secret&gt;" \\
  -H "X-Herma-Harness: muse-code"</pre></div>
</main>
${renderFooter(publicUrl)}
</body></html>`;
}

export async function reserveRouteRequest(db, callerScope, limit = 60) {
  const hour = Math.floor(Date.now() / 3600000);
  const result = await db.prepare("INSERT INTO route_quotas (caller_scope, hour, used) VALUES (?, ?, 1) ON CONFLICT(caller_scope, hour) DO UPDATE SET used = used + 1 WHERE used < ?").bind(callerScope, hour, limit).run();
  if (Number(result?.meta?.changes || 0) !== 1) throw new HermaErr(429, "route_quota_exceeded", "Route Quota Exceeded", "60 routed requests per key per hour. Retry next hour.");
  await db.prepare("DELETE FROM route_quotas WHERE hour < ?").bind(hour - 24).run();
}

export function resolveUpstream(request, env, path) {
  const override = request.headers.get("x-upstream-base-url") || request.headers.get("x-herma-upstream-url") || "";
  const configured = env.UPSTREAM_LLM_URL || "";
  const raw = (override || configured).replace(/\/+$/, "");
  if (!raw) throw new HermaErr(502, "missing_upstream", "Missing Upstream", "Configure UPSTREAM_LLM_URL or an allowlisted provider URL with your own key.");
  let target;
  try { target = new URL(raw); } catch { throw new HermaErr(400, "invalid_upstream", "Invalid Upstream", "Expected an absolute provider URL."); }
  if (!["https:", "http:"].includes(target.protocol) || target.username || target.password || target.hash) throw new HermaErr(400, "invalid_upstream", "Invalid Upstream", "Invalid provider URL.");
  const allowed = String(env.HERMA_ALLOWED_UPSTREAM_HOSTS || "ollama.com,api.meta.ai,api.llama.com,api.openai.com,api.anthropic.com,127.0.0.1,localhost").split(",").map(s => s.trim().toLowerCase());
  if (override && !allowed.includes(target.hostname.toLowerCase()) && (!configured || target.origin !== new URL(configured).origin)) throw new HermaErr(403, "upstream_not_allowed", "Upstream Not Allowed", "Provider hostname is not allowlisted.");
  const callerKey = request.headers.get("x-upstream-api-key") || "";
  const operatorKey = env.UPSTREAM_LLM_API_KEY || "";
  if (operatorKey && !callerKey && (!configured || target.origin !== new URL(configured).origin)) throw new HermaErr(403, "upstream_credential_origin_mismatch", "Credential Origin Mismatch", "Server credentials are bound to the configured provider origin. Supply your own key for an alternate provider.");
  if (operatorKey && !callerKey) {
    const provider = providerForHost(target.hostname);
    if (provider) {
      let policy;
      try { policy = operatorPolicy(env, provider); } catch { throw new HermaErr(503, "invalid_provider_configuration", "Invalid Provider Availability", "Configure the operator provider pause list."); }
      if (policy.disabled) throw new HermaErr(503, "provider_operator_disabled", "Operator Provider Paused", "The selected operator-funded provider is paused; caller-owned upstream credentials remain supported.");
    }
  }
  const base = target.pathname.replace(/\/+$/, "");
  if (base === "" || base === "/v1") target.pathname = path;
  return {url: target.toString(), key: callerKey || operatorKey};
}
