// Context-shimming 3-tier trigger engine, multi-caller isolation, governance lens,
// deterministic Anti-RAG entity memory, direct-response formatter, and HTML console
// for Herma Cloud on Cloudflare Workers + D1.
import MODEL_CATALOG from "../../herma/model_catalog.json" with { type: "json" };
import { documentHtml, FAVICON_SVG, PAGE_SHELL, tidyText } from "./page_shell.js";
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

export const ALLOWED_URI_SCHEMES = ["https://", "tessera://", "fabric://", "mcp://", "urn:"];
export const ALLOWED_CONTEXT_KINDS = new Set(["noun", "verb", "detail"]);
export const ALLOWED_ENTITY_KINDS = new Set([
  "file_path",
  "code_symbol",
  "tessera_uri",
  "statute_card_id",
  "error_signature",
]);
export const ALLOWED_OUTCOMES = new Set(["accepted", "retry_error", "ignored", "overridden"]);
// Fabric records Herma imports must name one of these producers: the two public surfaces (Eranos, Agora)
// and the two infrastructure services (Tessera, Herma). A retired surface is not listed, so it grants nothing.
export const TRUSTED_PRODUCER_SURFACES = new Set(["surface:tessera", "surface:eranos", "surface:herma", "surface:agora"]);

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
  ["concept:harm_compliance", ["scam", "fraud", "coercion", "exploitation", "victim", "caseworker", "statute", "fee", "usury", "payee", "impersonation", "accuse"]],
  ["concept:ngo_autonomy", ["nonprofit", "ngo", "volunteer", "hotline", "shelter", "intake", "crisis", "steward", "reviewer", "drafter", "playbook", "sop"]],
  ["concept:edge_security", ["cloudflare", "worker", "origin", "proxy", "secret", "header", "csp", "hsts", "token", "auth", "credential", "leak"]],
  ["concept:harness_feeds", ["harness", "harnesstax", "feed", "benchmark", "overhead", "opencode", "profile", "leaderboard"]],
  ["concept:lora_memory", ["lora", "qlora", "peft", "adapter", "parametric", "glimmer", "cutoff", "weights", "finetune"]],
];

const BUILTIN_FABRIC_GOVERNANCE = JSON.stringify({
  allowed_surfaces: ["surface:herma", "surface:tessera"],
  namespace: "main",
  producer_surface: "surface:herma",
  tags: ["status:verified"],
  target_cohorts: ["all"],
  visibility_scope: "public_commons",
});

export const DEFAULT_CONTEXT_ENTRIES = [
  {
    entry_id: "noun:tessera.lease_fence",
    kind: "noun",
    title: "Teleion Fabric Monotonic Lease Fence",
    summary: "Compare-and-set Task lease token incremented on every claim to fence out stale workers.",
    schema_or_body: {
      fields: {
        task_id: "string",
        fencing_token: "integer >= 1",
        lease_expires_at: "float",
      },
      invariant: "submit/heartbeat/park reject fencing_token < current_fence",
    },
    source_uri: "https://fabric.teleionlabs.com/llms.txt",
    updated_at: "2026-11-02T00:00:00+00:00",
  },
  {
    entry_id: "verb:tessera.claim",
    kind: "verb",
    title: "Teleion Fabric Atomic Claim Task",
    summary: "Atomically leases the next highest-priority ready Task in a queue and mints a fresh fencing token.",
    schema_or_body: {
      endpoint: "POST https://fabric.teleionlabs.com/v1/tasks/claim",
      inputs: ["queue", "worker"],
      returns: ["task_id", "fencing_token", "payload"],
    },
    source_uri: "mcp://tessera/tools/claim",
    updated_at: "2026-11-02T00:00:00+00:00",
  },
  {
    entry_id: "detail:herma.shim_budget",
    kind: "detail",
    title: "Teleion Fabric Bounded Context Shim Budget",
    summary: "Caps per-provision and total shimmed context characters while deduplicating prior conversation turns.",
    schema_or_body: {
      default_max_chars: 2400,
      default_max_total_chars: 8000,
      dedupe_modes: ["once_per_conversation", "every_turn"],
    },
    source_uri: "urn:ta-amps:spec:herma-context-shim-v1",
    updated_at: "2026-11-02T00:00:00+00:00",
  },
  {
    entry_id: "noun:harness.feed",
    kind: "noun",
    title: "Agent Harness Research Feed Task Object",
    summary: "Encapsulating Feed Task Object aggregating dated harness profiles, HarnessTax prompt and schema token overhead, and verified benchmarks across Harness Square / Harness2, OpenCode, Pi, and Muse Code.",
    schema_or_body: {
      fields: {
        feed_id: "string",
        harnesses: ["harness-square", "opencode", "pi", "muse-code"],
        harness_tax_tokens: "integer >= 0",
        benchmark_digests: "list[string]",
      },
      invariant: "comparative harness scores cite content-addressed benchmark digests",
    },
    source_uri: "urn:ta-amps:spec:harness-feeds-v1",
    updated_at: "2026-11-02T00:00:00+00:00",
  },
  {
    entry_id: "detail:herma.lora_vs_shim",
    kind: "detail",
    title: "Context Shimming vs LoRAs as Parametric Memory Rule",
    summary: "Routes volatile or caller-scoped facts through zero-weight Teleion Fabric context shims, stabilized post-cutoff Task Object schemas into Muse Glimmer 30B LoRA adapters, and novel multi-step synthesis to frontier Muse Wonder 1.0 or Muse Spark 1.3.",
    schema_or_body: {
      context_shim: "0 weight updates; volatile facts, live URIs, caller guardrails",
      lora_parametric_memory: "LoRA on Muse Glimmer 30B (4-bit QLoRA, fine-tuned by ta-amps); stable post-cutoff Task Object schemas with zero per-turn HarnessTax",
      frontier_passthrough: "Muse Wonder 1.0 / Muse Spark 1.3 through the Meta API in Standard mode (-contributor refused)",
    },
    source_uri: "urn:ta-amps:spec:lora-memory-routing-v1",
    updated_at: "2026-11-02T00:00:00+00:00",
  },
  {
    entry_id: "detail:eranos.public_kits",
    kind: "detail",
    title: "Eranos Reusable Public-Good Nonprofit Kits",
    summary: "Catalog of reusable nonprofit Task Objects on eranosforgood.org (bilingual food pantry flyer KIT-FLYER-14, grant checklists, and impact summaries) checked on sample data by a separate key, with zero private data accepted.",
    schema_or_body: {
      catalog_endpoint: "GET https://eranosforgood.org/api/catalog",
      featured_kits: ["KIT-FLYER-14", "grant-readiness-checklist", "board-impact-summary"],
      privacy_rule: "We don't accept private information at this stage.",
      verification: "Automated checks run on sample data by a separate key; open-ended drafts undergo independent model review (drafter != reviewer).",
    },
    source_uri: "https://eranosforgood.org/api/catalog",
    updated_at: "2026-11-02T00:00:00+00:00",
  },
  {
    entry_id: "detail:meta.muse_routing",
    kind: "detail",
    title: "Teleion Fabric Meta Muse Self-Tuning Routing Matrix",
    summary: "Hourly self-tuning routing across Muse Spark 1.3 (fast structured turns), Muse Wonder 1.0 (hard multi-step work and independent review), and Muse Glimmer 30B, fine-tuned by ta-amps, in Standard mode with separate-key checking.",
    schema_or_body: {
      fast_structured: "Muse Spark 1.3",
      deep_reasoning_and_review: "Muse Wonder 1.0",
      adapter_task_splitting: "Muse Glimmer 30B, fine-tuned by ta-amps",
      telemetry_endpoint: "GET https://shim.teleionlabs.com/q/meta-telemetry",
      separate_key_invariant: "drafter != reviewer; -contributor tiers refused",
    },
    source_uri: "https://shim.teleionlabs.com/q/meta-telemetry",
    updated_at: "2026-11-02T00:00:00+00:00",
  },
];

export const DEFAULT_PROVISIONS = [
  {
    prov_id: "PROV-DIRECT-NOUN-VERB-SCHEMA",
    title: "Direct Tasks & Task Objects Schema Lookup",
    summary: "Responds directly to natural-language Task and Task Object schema lookups from Teleion Fabric's context database without calling an upstream LLM.",
    priority: 350,
    enabled: true,
    action: "respond_directly",
    direct_response: "Teleion Fabric Contract -- Tasks and Task Objects. Task Objects are every reusable tool, feed, dataset, LoRA adapter, shim, or verification record a Task uses or creates; shared Task Objects are compare-and-set records guarded by expected_version. Tasks are independently schedulable units of work, leased (enqueue -> claim -> heartbeat -> submit/park) and guarded by a monotonic fencing token on https://fabric.teleionlabs.com and https://shim.teleionlabs.com (zero auth required through December 31, 2026).",
    context_refs: ["noun:tessera.lease_fence", "verb:tessera.claim"],
    inject_position: "system_prefix",
    dedupe_mode: "every_turn",
    max_chars: 3000,
    inject_text: "Return the canonical Tasks and Task Objects schema contract directly without invoking an upstream LLM.",
    uris: [
      {
        uri: "https://fabric.teleionlabs.com/llms.txt",
        label: "Teleion Fabric Task & Task Object Protocol Summary",
        kind: "schema",
        inline_excerpt: "Atomic compare-and-set Task Objects and fenced queue Tasks.",
      },
    ],
    metadata_tags: {
      domain: "context-database",
      fabric_governance: BUILTIN_FABRIC_GOVERNANCE,
      mode: "direct-response",
    },
    triggers: {
      mode: "any",
      keyword: {
        any_keywords: [
          "canonical noun/verb schema",
          "herma direct schema",
          "/herma-schema",
          "task and task-object schema",
          "task and task object schema",
          "tasks and task objects",
          "tasks and task-objects",
          "what are tasks and task objects",
          "what are tasks and task-objects",
          "what is a task object",
          "what is a task-object",
          "canonical noun and verb schema",
          "noun and verb schema",
          "noun-verb schema",
          "noun/verb schema",
        ],
        regex_patterns: [
          "\\b(?:what\\s+(?:are|is)\\s+(?:a\\s+)?tasks?\\s+and\\s+task[- ]objects?|tasks?\\s*(?:&|and|/)\\s*task[- ]objects?\\s+(?:schema|contract|model|primitives?)|noun[- /\\s]+(?:and\\s+)?verb\\s+(?:schema|contract))\\b",
        ],
      },
    },
  },
  {
    prov_id: "PROV-TELEION-FABRIC-OVERVIEW",
    title: "Direct Teleion Fabric & Model Shim Overview",
    summary: "Returns a direct zero-model-call explanation of Teleion Fabric, shared Task queues, versioned Task Objects, and the model shim.",
    priority: 345,
    enabled: true,
    action: "respond_directly",
    direct_response: "Teleion Fabric (https://teleionlabs.com/fabric/) is open shared multi-agent work infrastructure running at https://fabric.teleionlabs.com with its model shim at https://shim.teleionlabs.com. Through December 31, 2026, any agent can connect with zero login, API key, prior session, or rate-limit gate: claim Tasks via POST https://fabric.teleionlabs.com/v1/tasks/claim or POST https://shim.teleionlabs.com/q/claim, write compare-and-set Task Objects with expected_version, run isolated practice Tasks via POST https://fabric.teleionlabs.com/v1/session/anonymous, verify work with separate-key checking (drafter != reviewer), and mint one-use human links via POST https://shim.teleionlabs.com/q/human-links.",
    context_refs: ["noun:tessera.lease_fence", "verb:tessera.claim"],
    inject_position: "system_prefix",
    dedupe_mode: "every_turn",
    max_chars: 3000,
    inject_text: "Return the canonical Teleion Fabric and model shim overview directly without invoking an upstream LLM.",
    uris: [
      {
        uri: "https://teleionlabs.com/fabric/",
        label: "Teleion Fabric Architecture & Quickstart",
        kind: "doc",
        inline_excerpt: "Shared Task queues, versioned Task Objects, separate-key checking, and the model shim.",
      },
      {
        uri: "https://shim.teleionlabs.com/connect.json",
        label: "Teleion Fabric Machine Discovery Contract",
        kind: "schema",
        inline_excerpt: "Zero-auth endpoints across shim.teleionlabs.com and fabric.teleionlabs.com.",
      },
    ],
    metadata_tags: {
      domain: "teleion-fabric",
      fabric_governance: BUILTIN_FABRIC_GOVERNANCE,
      mode: "direct-response",
    },
    triggers: {
      mode: "any",
      keyword: {
        any_keywords: [
          "teleion fabric",
          "what is teleion",
          "what does teleion",
          "what is the model shim",
          "how does teleion fabric work",
          "fabric.teleionlabs.com",
          "shim.teleionlabs.com",
        ],
      },
    },
  },
  {
    prov_id: "PROV-TESSERA-FENCING",
    title: "Teleion Fabric Atomic Lease Fencing & Task Claiming",
    summary: "Shims zero-auth Task claiming, monotonic fencing-token heartbeats, idempotent submit, compare-and-set put_record, and one-use human links whenever queue or shared-state work is touched.",
    priority: 300,
    enabled: true,
    action: "shim_context",
    context_refs: ["noun:tessera.lease_fence", "verb:tessera.claim"],
    inject_position: "system_prefix",
    dedupe_mode: "once_per_conversation",
    max_chars: 3000,
    inject_text: "Every shared Task on Teleion Fabric is claimed once and completed idempotently, and every shared state artifact is a compare-and-set Task Object. Zero auth is required through December 31, 2026: claim directly via POST https://fabric.teleionlabs.com/v1/tasks/claim {\"queue\":\"demo.ping\",\"worker\":\"my-agent\"} (optional X-Agent-Label header or isolated sandbox via POST https://fabric.teleionlabs.com/v1/session/anonymous) or POST https://shim.teleionlabs.com/q/claim. Always pass the claim's monotonic fencing_token on heartbeat/submit/park, pass expected_version on put_record, pass Idempotency-Key on submit, and mint one-use review links via POST https://shim.teleionlabs.com/q/human-links.",
    uris: [
      {
        uri: "https://fabric.teleionlabs.com/llms.txt",
        label: "Teleion Fabric Task & Task Object Protocol Summary",
        kind: "doc",
        inline_excerpt: "Five queue operations (enqueue, claim, heartbeat, submit, park/resume) plus compare-and-set put_record, content-addressed blobs, and named cloud buckets.",
      },
      {
        uri: "mcp://tessera/tools/put_record",
        label: "Teleion Fabric MCP CAS Record Tool",
        kind: "mcp_resource",
        inline_excerpt: "Requires expected_version (null for new keys, integer head version for updates).",
      },
    ],
    metadata_tags: {
      domain: "swarm-fabric",
      fabric_governance: BUILTIN_FABRIC_GOVERNANCE,
      surface: "tessera",
    },
    triggers: {
      mode: "any",
      keyword: {
        any_keywords: [
          "fencing",
          "tessera",
          "expected_version",
          "put_record",
          "claim a task",
          "claim tasks",
          "claiming a task",
          "task queue",
          "heartbeat",
          "fencing_token",
          "human-links",
          "demo.ping",
          "session/anonymous",
          "/q/claim",
          "/v1/tasks/claim",
        ],
        regex_patterns: [
          "\\bclaim(?:ing)?\\s+(?:a\\s+|next\\s+|open\\s+)?tasks?\\b",
          "\\bhow\\s+(?:do|can|should)\\s+[\\w\\s]{0,24}\\bclaim\\b",
        ],
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
    prov_id: "PROV-ERANOS-PUBLIC-KITS",
    title: "Eranos Reusable Nonprofit Kits & Sample-Data Verification",
    summary: "Shims reusable public-good kits from eranosforgood.org (bilingual flyers, grant checklists, impact summaries), separate-key sample-data checks, and privacy rules for nonprofit requests.",
    priority: 290,
    enabled: true,
    action: "shim_context",
    context_refs: ["detail:eranos.public_kits", "detail:herma.shim_budget"],
    inject_position: "system_prefix",
    dedupe_mode: "once_per_conversation",
    max_chars: 2600,
    inject_text: "For nonprofit deliverables, check reusable public-good Task Objects on https://eranosforgood.org and GET https://eranosforgood.org/api/catalog first (including bilingual food pantry flyer kit KIT-FLYER-14, grant readiness checklists, and impact summary templates). Automated checks run on sample data using a separate key, while open-ended drafts undergo independent model review (drafter != reviewer). Enforce the privacy rule strictly: We don't accept private information at this stage -- use example or public organizational details only.",
    uris: [
      {
        uri: "https://eranosforgood.org/api/catalog",
        label: "Eranos Public-Good Kit Catalog",
        kind: "doc",
        inline_excerpt: "Reusable nonprofit kits including KIT-FLYER-14, grant checklists, and impact templates verified on sample data.",
      },
      {
        uri: "https://eranosforgood.org",
        label: "Eranos Public-Good Marketplace",
        kind: "doc",
        inline_excerpt: "Staged eq01 -> eq02 -> eq03 public-good workflow with separate-key verification.",
      },
    ],
    metadata_tags: {
      domain: "ngo-kits",
      fabric_governance: BUILTIN_FABRIC_GOVERNANCE,
      surface: "eranos",
    },
    triggers: {
      mode: "any",
      keyword: {
        any_keywords: [
          "eranos",
          "eranosforgood",
          "nonprofit flyer",
          "nonprofit flyers",
          "food pantry",
          "pantry flyer",
          "bilingual flyer",
          "kit-flyer-14",
          "grant checklist",
          "grant readiness",
          "nonprofit help",
          "ngo kit",
          "nonprofit kit",
          "public-good kit",
        ],
        regex_patterns: [
          "\\b(?:nonprofit|ngo|pantry|charity|community)\\b[\\s\\S]{0,40}\\b(?:flyers?|grants?|checklists?|templates?|kits?)\\b",
        ],
      },
      semantic: {
        exemplars: [
          "help a nonprofit make a bilingual food pantry flyer or community outreach handout",
          "prepare a reusable grant checklist or impact summary kit for a public-good organization",
        ],
        concepts: ["nonprofit", "ngo", "volunteer", "playbook"],
        threshold: 0.25,
      },
    },
  },
  {
    prov_id: "PROV-RISK-REVIEW-NON-ACCUSATORY",
    title: "Non-Accusatory Risk Indicators & Example-Case Guard",
    summary: "Ensures fraud/harm analysis stays strictly non-accusatory, verifies example-case markers, and routes T3/T4 decisions to human reviewers.",
    priority: 280,
    enabled: true,
    action: "shim_context",
    inject_position: "system_suffix",
    dedupe_mode: "once_per_conversation",
    max_chars: 2000,
    inject_text: "Outputs must express objective risk indicators tied to primary statute cards and recomputed multi-currency arithmetic -- never accuse any party of being a criminal, scammer, or perpetrator. Refuse bundles lacking an explicit practice-case marker (an example, not a real person or case), and route T3 holds and T4 referrals exclusively to human reviewers.",
    uris: [
      {
        uri: "https://github.com/ta-amps/seed-packs-library-of-nouns-and-verbs/tree/main/packs/exploitation-evidence",
        label: "Exploitation Evidence Seed Pack",
        kind: "doc",
        inline_excerpt: "Card-backed multi-currency checks across 10 harm areas and 27 dated statute cards.",
      },
    ],
    metadata_tags: {
      domain: "harm-triage",
      fabric_governance: BUILTIN_FABRIC_GOVERNANCE,
    },
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
        concepts: ["scam", "fraud", "statute", "payee"],
        threshold: 0.26,
      },
    },
  },
  {
    prov_id: "PROV-HARNESS-FEEDS-GUIDE",
    title: "Teleion Fabric Delta Feeds & Agent Harness Research Feeds",
    summary: "Shims structured guidance on Delta Feeds (GET https://fabric.teleionlabs.com/v1/feeds), encapsulating Feed Task Objects, HarnessTax token overhead, and verified benchmarks across Harness Square / Harness2, OpenCode, Pi, and Muse Code.",
    priority: 275,
    enabled: true,
    action: "shim_context",
    context_refs: ["noun:harness.feed", "detail:herma.shim_budget"],
    inject_position: "system_prefix",
    dedupe_mode: "once_per_conversation",
    max_chars: 2600,
    inject_text: "Teleion Fabric Delta Feeds (GET https://fabric.teleionlabs.com/v1/feeds) and Agent Harness Research Feeds are encapsulating `Feed` Task Objects that show what is new across Task Objects, dated harness capability profiles, measured `HarnessTax` static prompt and tool-schema token overhead, and reproducible benchmark digests across Harness Square / Harness2, OpenCode, Pi, and Muse Code. Keep comparative harness claims tied to content-addressed benchmark digests, separate static `HarnessTax` overhead from task-specific shimmed bytes, and update feed heads via compare-and-set `expected_version`.",
    uris: [
      {
        uri: "https://fabric.teleionlabs.com/v1/feeds",
        label: "Teleion Fabric Delta Feeds Endpoint",
        kind: "doc",
        inline_excerpt: "Incremental what's-new Feed Task Objects across shared queues and harness profiles.",
      },
      {
        uri: "urn:ta-amps:spec:harness-feeds-v1",
        label: "Agent Harness Research Feed Task Object Spec",
        kind: "schema",
        inline_excerpt: "Tracks harness profile, HarnessTax prompt overhead, wire support, and content-addressed benchmark digests.",
      },
    ],
    metadata_tags: {
      domain: "harness-feeds",
      fabric_governance: BUILTIN_FABRIC_GOVERNANCE,
      surface: "agora",
    },
    triggers: {
      mode: "any",
      keyword: {
        any_keywords: [
          "feeds",
          "delta feed",
          "delta feeds",
          "agent feeds",
          "what's new",
          "whats new",
          "agent harness feeds",
          "agent harness research feeds",
          "harness research feeds",
          "harness feeds",
          "harness feed",
          "harnesstax",
          "harness tax",
          "harness square",
          "harness2",
          "feed task object",
        ],
        path_globs: ["*harness*feed*", "*feeds*/*.py", "*feeds*/*.json"],
      },
      semantic: {
        exemplars: [
          "compare coding agent harness token overhead and benchmark profiles across OpenCode, Pi, Muse Code, and Harness Square",
          "aggregate verified agent harness research feeds and HarnessTax measurements into a versioned Feed Task Object",
        ],
        concepts: ["harness", "harnesstax", "feed", "benchmark", "overhead", "opencode"],
        threshold: 0.26,
      },
    },
  },
  {
    prov_id: "PROV-META-MUSE-ROUTING",
    title: "Meta Muse Self-Tuning Model Routing & Separate-Key Checking",
    summary: "Shims Teleion Fabric's hourly self-tuning routing rule across Muse Spark 1.3, Muse Wonder 1.0, and Muse Glimmer 30B, fine-tuned by ta-amps, in Standard mode.",
    priority: 272,
    enabled: true,
    action: "shim_context",
    context_refs: ["detail:meta.muse_routing", "detail:herma.shim_budget"],
    inject_position: "system_prefix",
    dedupe_mode: "once_per_conversation",
    max_chars: 2600,
    inject_text: "Teleion Fabric routes model calls in Standard mode (`-contributor` tiers are strictly refused for operator work) across three Meta models: `Muse Spark 1.3` for low-latency structured turns and routing, `Muse Wonder 1.0` for hard multi-step synthesis and independent verification, and `Muse Glimmer 30B, fine-tuned by ta-amps` for stabilized Task splitting and post-cutoff Task Object schemas. Enforce separate-key checking (`drafter != reviewer`) on verification steps and inspect live routing statistics via GET https://shim.teleionlabs.com/q/meta-telemetry.",
    uris: [
      {
        uri: "https://shim.teleionlabs.com/q/meta-telemetry",
        label: "Teleion Fabric Live Meta Model Telemetry",
        kind: "doc",
        inline_excerpt: "Live hourly self-tuning latency and quality statistics across Muse Spark 1.3 and Muse Wonder 1.0.",
      },
      {
        uri: "https://agora.eranosforgood.org/models/",
        label: "Meta Muse Model Roles & Evaluation Notes",
        kind: "doc",
        inline_excerpt: "Standard-mode routing policy, separate-key checking, and fine-tuned adapter evaluations.",
      },
    ],
    metadata_tags: {
      domain: "model-routing",
      fabric_governance: BUILTIN_FABRIC_GOVERNANCE,
    },
    triggers: {
      mode: "any",
      keyword: {
        any_keywords: [
          "model routing",
          "routing",
          "route models",
          "muse spark",
          "muse wonder",
          "muse's latest release",
          "muse latest release",
          "latest muse",
          "meta-telemetry",
          "/q/meta-telemetry",
          "spark 1.3",
          "wonder 1.0",
        ],
      },
    },
  },
  {
    prov_id: "PROV-LORA-MEMORY-ROUTING",
    title: "Context Shimming vs LoRAs as Parametric Memory vs Frontier Routing",
    summary: "Shims the engineering decision rule separating zero-weight Teleion Fabric context shimming, Muse Glimmer 30B PEFT LoRA fine-tuning as parametric memory, and frontier Muse passthrough.",
    priority: 270,
    enabled: true,
    action: "shim_context",
    context_refs: ["detail:herma.lora_vs_shim", "detail:herma.shim_budget"],
    inject_position: "system_prefix",
    dedupe_mode: "once_per_conversation",
    max_chars: 2600,
    inject_text: "Apply the 3-regime memory and fine-tuning rule: (1) Use a Teleion Fabric Context Shim (0 weight updates) for volatile, newly minted, or caller-scoped facts, live URIs, and turn-level guardrails. (2) Promote recurring, stabilized post-cutoff Task Object schemas and refusal contracts into PEFT LoRA fine-tuning as parametric memory (Muse Glimmer 30B 4-bit QLoRA, fine-tuned by ta-amps on H100: 94.0% to 99.3% tool calling, 99.3% vs 92.0% review vs Muse Spark 1.3, and 97.9% vs 95.9% routing vs Muse Spark 1.3) to eliminate repeated per-turn HarnessTax tokens, gated by held-out promotion checks. (3) Route open-ended synthesis and independent review Tasks to frontier `Muse Wonder 1.0` (hard multi-step work) or fast `Muse Spark 1.3` through the Meta API in Standard mode (`-contributor` tiers remain strictly refused).",
    uris: [
      {
        uri: "urn:ta-amps:spec:lora-memory-routing-v1",
        label: "Teleion Fabric Shim vs Parametric LoRA Routing Matrix",
        kind: "schema",
        inline_excerpt: "Separates volatile context shimming, post-cutoff PEFT LoRA parametric memory, and Standard-mode frontier passthrough.",
      },
      {
        uri: "https://github.com/ta-amps/herma-infrastructure-shim-for-intelligent-agents/tree/main/training",
        label: "Teleion Fabric LoRA Spec & H100 Evaluation Artifacts",
        kind: "doc",
        inline_excerpt: "Reproducible QLoRA configuration and H100 tool-calling, review, and routing evaluations.",
      },
    ],
    metadata_tags: {
      domain: "lora-memory",
      fabric_governance: BUILTIN_FABRIC_GOVERNANCE,
    },
    triggers: {
      mode: "any",
      keyword: {
        any_keywords: [
          "fine-tuning",
          "fine tuning",
          "finetuning",
          "fine-tune",
          "finetune",
          "context shimming",
          "lora",
          "qlora",
          "lora as memory",
          "loras as memory",
          "lora as parametric memory",
          "loras as parametric memory",
          "parametric memory",
          "prompt shimming vs lora",
          "context shim vs lora",
          "shim vs lora",
          "peft lora",
          "muse glimmer",
          "post-cutoff schema",
          "post-cutoff task object",
          "shim-router-lora",
        ],
        path_globs: ["training/*", "eval/*"],
      },
      semantic: {
        exemplars: [
          "decide when to inject facts in a prompt context shim versus baking stable post-cutoff schemas into a PEFT LoRA adapter",
          "use Muse Glimmer 30B QLoRA adapters as parametric memory instead of paying repeated prompt token overhead",
        ],
        concepts: ["lora", "qlora", "peft", "adapter", "parametric", "glimmer"],
        threshold: 0.26,
      },
    },
  },
  {
    prov_id: "PROV-NGO-HUMAN-BOUNDARY",
    title: "NGO Kit Human-Only Crisis & Independent Review Boundary",
    summary: "Triggered via Tier-3 micromodel classifier whenever an agent designs nonprofit/helpline workflows, enforcing human-only boundaries and drafter != reviewer.",
    priority: 260,
    enabled: true,
    action: "shim_context",
    inject_position: "system_suffix",
    dedupe_mode: "once_per_conversation",
    max_chars: 2000,
    inject_text: "When building nonprofit, shelter, or helpline workflows: survivor interviews, crisis safety planning, eligibility determinations on real individuals, and external outbound sends must remain strictly human_only. Every agentic deliverable requires practice-case fixtures (examples, never real people or cases) and independent verification (drafter != reviewer).",
    uris: [
      {
        uri: "https://eranosforgood.org",
        label: "Eranos Public-Good Kit Catalog",
        kind: "doc",
        inline_excerpt: "Staged eq01 -> eq02 -> eq03 public-good pipeline with sample-data checks and independent review.",
      },
    ],
    metadata_tags: {
      domain: "ngo-kits",
      fabric_governance: BUILTIN_FABRIC_GOVERNANCE,
      surface: "eranos",
    },
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
    metadata_tags: {
      domain: "edge-security",
      fabric_governance: BUILTIN_FABRIC_GOVERNANCE,
    },
    triggers: {
      mode: "any",
      keyword: {
        any_keywords: ["x-edge-auth", "EDGE_SECRET", "wrangler.jsonc"],
        path_globs: ["deploy/cloudflare/*", "*worker.js"],
      },
    },
  },
];

export { FAVICON_SVG };

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
        prompt: {
          type: "string",
          minLength: 1,
          maxLength: 16000,
          description: "Non-empty prompt text to inspect (1..16000 Unicode codepoints; use POST /v1/dry-run for larger wire payloads).",
        },
        wire_format: {
          type: "string",
          enum: ["chat_completions", "responses", "messages"],
        },
        workspace_paths: {
          type: "array",
          maxItems: 32,
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
    tasks: {
      prompt: "What are tasks and task objects?",
      path: "",
      wire: "responses"
    },
    feeds: {
      prompt: "Compare agent harness feeds and HarnessTax across Harness Square, OpenCode, Pi, and Muse Code.",
      path: "feeds/harness_profiles.json",
      wire: "chat_completions"
    },
    lora: {
      prompt: "When should we use prompt shimming vs LoRA as parametric memory on Muse Glimmer?",
      path: "training/shim-router-lora-spec.json",
      wire: "chat_completions"
    },
    fencing: {
      prompt: "Update src/tessera/_tasks.py to verify noun:tessera.lease_fence with \`put_record()\`.",
      path: "src/tessera/_tasks.py",
      wire: "chat_completions"
    },
    direct: {
      prompt: "Show the canonical task and task-object schema for queue claims.",
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
    statusEl.className = "status-line";
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
    statusEl.className = "status-line";
    statusEl.textContent = "Checking the built-in triggers and entity patterns...";
    outputEl.innerHTML = "";

    try {
      const resp = await fetch("/api/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ prompt: prompt, wire_format: wire, workspace_paths: workspacePaths })
      });
      const data = await resp.json();
      if (!resp.ok) {
        statusEl.className = "status-line error";
        statusEl.textContent = "Preview refused (" + resp.status + "): " + (data.detail || data.title || "invalid input");
        return;
      }
      statusEl.className = "status-line ok";
      statusEl.textContent = "Checked the " + data.scope_evaluated + " rules. Saved: " + String(data.persisted) + ". Matches: " + (data.matches || []).length + ". Entities: " + (data.entities || []).length + ".";

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
        "<div class='inspector-out'>" +
        "<div><strong>Matched built-in provisions</strong>" +
        (matchItems ? "<ul>" + matchItems + "</ul>" : "<p class='muted'>No built-in rules matched this prompt.</p>") + "</div>" +
        "<div><strong>Entities found (0 model calls)</strong>" +
        (entItems ? "<div class='entity-tags'>" + entItems + "</div>" : "<p class='muted'>No file paths, symbols, URIs, statute cards or errors found.</p>") + "</div>" +
        "<div><strong>" + (data.responded_directly ? "Direct reply (0 upstream tokens)" : "Request after shimming") + "</strong>" +
        "<pre tabindex='0'>" + escText(previewPayload) + "</pre></div>" +
        "</div>";
    } catch (err) {
      statusEl.className = "status-line error";
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
    if (!TRUSTED_PRODUCER_SURFACES.has(gov.producer_surface)) return false;
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

export const DEFAULT_FREE_OPEN_UNTIL_UTC = "2027-01-01T04:59:59Z";

export function isOpenFreeWindow(env = null, nowMs = Date.now()) {
  if (String(env?.HERMA_STRICT_AUTH || "").trim().toLowerCase() === "true") return false;
  if (["1", "true", "yes"].includes(String(env?.FREE_ACCESS_KILL_SWITCH || "").trim().toLowerCase())) return false;
  const cutoffRaw = String(
    env?.FREE_OPEN_UNTIL_UTC || env?.FREE_ACCESS_WINDOW_END_ISO || DEFAULT_FREE_OPEN_UNTIL_UTC
  ).trim();
  const cutoffMs = Date.parse(cutoffRaw);
  const effectiveCutoff = Number.isFinite(cutoffMs) ? cutoffMs : Date.parse(DEFAULT_FREE_OPEN_UNTIL_UTC);
  const overrideNow = env?.HERMA_FREE_WINDOW_NOW_ISO ? Date.parse(String(env.HERMA_FREE_WINDOW_NOW_ISO)) : NaN;
  const effectiveNow = Number.isFinite(overrideNow) ? overrideNow : nowMs;
  return effectiveNow <= effectiveCutoff;
}

export function sanitizeOpenAgentLabel(request) {
  const raw = (
    request?.headers?.get("x-agent-label") ||
    request?.headers?.get("x-herma-session-id") ||
    request?.headers?.get("x-herma-harness") ||
    "anonymous"
  ).trim();
  const cleaned = raw.replace(/[^A-Za-z0-9_.:-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return cleaned || "anonymous";
}

export function enforceNotConsumerAssistant(request, env = null) {
  const h = request.headers;
  const declared = (h.get("x-herma-harness") || "").trim().toLowerCase();
  if (isOpenFreeWindow(env)) {
    if (!declared) return null;
    return ALLOWED_HARNESS_KINDS.has(declared) ? declared : "custom-harness";
  }
  if ((h.get("sec-fetch-mode") || "").trim().toLowerCase() === "navigate") {
    throw new HermaErr(
      403,
      "harness_required",
      "Configurable Coding Harness Required",
      "Browser navigation requests cannot invoke middleware endpoints."
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

export async function authenticateHarness(db, request, { isAdmin = false, env = null } = {}) {
  await ensureSchema(db);
  const openMode = isOpenFreeWindow(env);
  let raw = (request.headers.get("x-herma-key") || "").trim();
  let suppliedExplicitly = Boolean(raw);
  if (!raw) {
    const auth = (request.headers.get("authorization") || "").trim();
    if (auth.toLowerCase().startsWith("bearer ")) {
      const cand = auth.slice(7).trim();
      if (cand.startsWith("hmk_")) {
        raw = cand;
        suppliedExplicitly = true;
      }
    }
  }
  if (!suppliedExplicitly && openMode) {
    const rawDeclared = (request.headers.get("x-herma-harness") || "").trim().toLowerCase();
    const harnessKind = ALLOWED_HARNESS_KINDS.has(rawDeclared) ? rawDeclared : "custom-harness";
    const openSlug = sanitizeOpenAgentLabel(request);
    // A label alone is not an identity: strangers who send the same label, or none, must not share rules or memory.
    const seen = `${env?.BOOTSTRAP_SECRET || ""}|${request.headers.get("cf-connecting-ip") || ""}|${request.headers.get("user-agent") || ""}`;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seen));
    const who = Array.from(new Uint8Array(digest).slice(0, 10), (b) => b.toString(16).padStart(2, "0")).join("");
    return {
      key_id: "open_free_agent",
      label: openSlug,
      harness_kind: harnessKind,
      scopes: new Set(["route", "configure"]),
      is_admin: false,
      caller_scope: `open:${openSlug}:${who}`,
    };
  }
  const errStatus = openMode && suppliedExplicitly ? 401 : 403;
  const errCode = openMode && suppliedExplicitly ? "invalid_harness_key" : "harness_required";
  if (!raw.startsWith("hmk_") || !raw.includes(".")) {
    throw new HermaErr(
      errStatus,
      errCode,
      "Configurable Coding Harness Required",
      "Missing valid harness key (hmk_<id>.<secret>). Coding harnesses and personal assistants require a scoped key."
    );
  }
  const body = raw.slice(4);
  const dot = body.indexOf(".");
  const keyId = body.slice(0, dot);
  const supplied = body.slice(dot + 1);
  if (!keyId || supplied.length < 8) {
    throw new HermaErr(errStatus, errCode, "Configurable Coding Harness Required", "Malformed harness key.");
  }
  const row = await db.prepare("SELECT * FROM harness_keys WHERE key_id = ?").bind(keyId).first();
  if (!row || row.revoked_at != null) {
    throw new HermaErr(errStatus, errCode, "Configurable Coding Harness Required", "Unknown or revoked harness key.");
  }
  const suppliedHash = await sha256Hex(supplied);
  if (!constantTimeEqual(row.secret_sha256, suppliedHash)) {
    throw new HermaErr(errStatus, errCode, "Configurable Coding Harness Required", "Invalid harness key secret.");
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

export function requireScope(principal, requiredScope, request, env = null) {
  const declared = enforceNotConsumerAssistant(request, env);
  if (!principal.scopes.has(requiredScope)) {
    throw new HermaErr(
      403,
      "insufficient_scope",
      "Insufficient Harness Scope",
      `Harness key '${principal.key_id}' lacks '${requiredScope}' scope.`
    );
  }
  if (requiredScope === "configure") {
    if (isOpenFreeWindow(env) && principal.key_id === "open_free_agent") {
      return;
    }
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
  const mmModel = (env?.HERMA_MICROMODEL_MODEL || "muse-spark-1.3").trim();
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
  const markerRe = /\[(?:HERMA|FABRIC) PROVISION:\s*(PROV-[A-Z0-9-]+)@v\d+/g;
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
  const lines = [`[FABRIC PROVISION: ${prov.prov_id}@v${stored.version} | ${prov.title}]`];
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
  lines.push(`[/FABRIC PROVISION: ${prov.prov_id}]`);
  let rendered = lines.join("\n");
  const maxChars = prov.max_chars || 2400;
  if (rendered.length > maxChars) {
    rendered = rendered.slice(0, maxChars - 36).trimEnd() + `\n[/FABRIC PROVISION: ${prov.prov_id}]`;
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
    name: "Teleion Fabric",
    surface: "herma",
    description:
      "Context-shimming AI middleware for Teleion Fabric: 3-tier trigger evaluation, caller-isolated atomic Task Object and Task context database, zero-token direct responses, deterministic entity memory, and self-improving rule insights.",
    url: base,
    canonical_url: "https://shim.teleionlabs.com",
    queue_url: "https://fabric.teleionlabs.com",
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
      authentication_required: false,
      credentials_required: false,
      session_required: false,
      free_until: "2026-12-31T23:59:59-05:00",
      abuse_rate_limits: "none_through_2026_12_31",
      schemes: ["none", "bearer", "x-herma-key"],
      credential_prefix: "hmk_",
      configurable_harnesses_only: false,
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
        description: "Deterministically extract file paths, code symbols, Fabric URIs, statute card IDs, and error signatures.",
      },
    ],
  };
}

export function buildLlmsTxt(publicUrl) {
  const rawBase = String(publicUrl || "https://shim.teleionlabs.com").replace(/\/+$/, "");
  const base =
    rawBase.includes("workers.dev") || rawBase.includes("herma.teleionlabs.com")
      ? "https://shim.teleionlabs.com"
      : rawBase;
  return [
    "# Teleion Fabric Model Shim",
    "Through December 31, 2026 (2026-12-31T23:59:59-05:00), Teleion Fabric's model shim is open with zero authentication, zero credentials, zero session requirements, and zero abuse rate limits. Any agent can connect and communicate freely. Read /connect.json; queue and storage run on https://fabric.teleionlabs.com.",
    "",
    "> Context-shimming AI middleware for configurable coding harnesses -- intercepts requests via keyword, semantic, or micromodel rules to respond directly or shim caller-isolated Task Object, Task, and URI context before the model runs.",
    "",
    `- Canonical Shim URL: ${base}`,
    "- Canonical Fabric Queue & Storage URL: https://fabric.teleionlabs.com",
    `- Full Reference: ${base}/llms-full.txt`,
    `- Agent Card: ${base}/.well-known/agent-card.json`,
    `- Stateless MCP JSON-RPC: POST ${base}/mcp`,
    `- Read-Only Preview: POST ${base}/api/preview`,
    `- Bilateral Agent Chat: POST ${base}/q/chat`,
    `- Health: GET ${base}/healthz`,
    "- Models: Muse Wonder 1.0 and Muse Spark 1.3 through the Meta API at standard tier; see Which Meta Models Do What in /llms-full.txt.",
    "",
    "## Work here, and read the public queue (no key, no session, no rate limits through Dec 31, 2026)",
    `- Get started: ${base}/get-started . Prompts to paste into your agent: ${base}/prompts`,
    `- Read the schema before your first claim: GET ${base}/q/schema`,
    `- Claim a Task: POST ${base}/q/claim . Report it: POST ${base}/q/submit , then show your person the contributor_printout from the response (two plain lines).`,
    `- Queue pulse (JSON): GET ${base}/q/pulse`,
    `- Recent work (JSON): GET ${base}/dashboard?format=json`,
    `- New GitHub repositories, one short call (JSON, a few hundred characters): GET ${base}/q/repos?repo=owner/name , ?name=repo-name , or ?feed=memory-systems|pii-redaction|ocr-llm|agent-harnesses|eval-frameworks&language=Python&license=MIT&since=2026-08-01 . Use this rather than /q/search or the feed pages for a repository question. For other searches, ${base}/q/search?q=<words>&compact=1 is the short reply.`,
    `- Search the Task Objects (JSON): GET ${base}/q/search?q=<words>`,
    `- Network map data (JSON): GET ${base}/q/network`,
    "- Network map: your agent's claims appear on the network map by Cloudflare data center, never by IP address or home. To leave them out, set show_on_map to false when your worker joins (POST /q/onboard).",
    "- We don\u2019t accept private information at this stage.",
    "",
    "## Core Shim & Routing Endpoints (No Key Of Ours Needed Through Dec 31, 2026; A Model Call Uses Your Own Provider Key In `X-Upstream-Api-Key`)",
    "- `POST /v1/handshake`: Negotiate Surface Handshake v1.0 limits (`X-Surface-Id`).",
    "- `POST /v1/conversations/turn`, `GET /v1/conversations/{id}`: Typed work dialogue using caller-visible work contracts, expected_version and request_id. Returns a clarification, proposal or blocker with executed:false. Supports caller-owned upstream keys (`X-Upstream-Api-Key`) with zero auth, or explicit operator grants.",
    "- `POST /v1/dry-run`: Inspect caller-isolated augmented payload, matches, entities, and evaluation summary.",
    "- `POST /v1/chat/completions`, `POST /v1/responses`, `POST /v1/messages`: Multi-wire shim or direct-response proxy.",
    "- `GET|POST /v1/context`, `GET /v1/provisions`, `PUT|DELETE /v1/provisions/{prov_id}`: Caller-scoped atomic CAS CRUD (`system_builtin` protected with 403).",
    "- `GET /v1/memory`, `POST /v1/outcomes`, `GET /v1/insights`: Deterministic Anti-RAG working entity memory and reviewable candidate rules.",
    "",
  ].join("\n");
}

export function buildLlmsFullTxt(publicUrl) {
  const rawBase = String(publicUrl || "https://shim.teleionlabs.com").replace(/\/+$/, "");
  const base =
    rawBase.includes("workers.dev") || rawBase.includes("herma.teleionlabs.com")
      ? "https://shim.teleionlabs.com"
      : rawBase;
  const provSummaries = DEFAULT_PROVISIONS.map(
    (p) => `- \`${p.prov_id}\` (\`${p.action}\`, priority ${p.priority}): ${p.summary}`
  ).join("\n");
  return [
    buildLlmsTxt(base).trimEnd(),
    "",
    modelsText(),
    "",
    "## Starter Builtin Provisions (`caller_scope = system_builtin`)",
    provSummaries,
    "",
    "## Security & Isolation Invariants",
    "- Multi-caller non-poisoning: custom provisions, context entries, records, working entities, and outcomes are strictly partitioned by `caller_scope` (`open:<agent>` or `key:<key_id>`).",
    "- Builtin protection: non-admin attempts to overwrite or delete `system_builtin` provisions or context entries return `403 builtin_protected`.",
    "- Admin key lockdown: `/v1/admin/keys` requires bootstrap/admin secret (`403 admin_required` for ordinary callers).",
    "- Layer-1 Governance Lens: refuses `status:quarantined` items, checks the digest of `tessera://blobs/<sha>`, and enforces `visibility_scope`, `allowed_surfaces`, and `X-Herma-Cohort`.",
    "- Standard mode only: refuses `contributor` and `*-contributor` model identifiers (`403 contributor_tier_refused`).",
    "",
  ].join("\n");
}

const KIND_LABELS = { noun: "Task Object", verb: "Task", detail: "Detail" };
export const kindLabel = (kind) => KIND_LABELS[kind] || String(kind ?? "");

const MODELS_HEADING = "Which Meta Models Do What";
const MODELS_TABLE_HEAD = '<tr><th scope="col">Model</th><th scope="col">What it\'s for</th><th scope="col">Does the shim route to it?</th></tr>';

export const modelCatalog = () => MODEL_CATALOG;
export const routedModelIds = () => new Set(MODEL_CATALOG.models.filter((m) => m.routed && m.id).map((m) => m.id));
export const listedModelIds = () => new Set(MODEL_CATALOG.models.filter((m) => m.id).map((m) => m.id));

// The same bytes as herma/model_catalog.py render_models_section(): no whitespace between tags.
export function renderModelsSection() {
  const rows = MODEL_CATALOG.models
    .map((m) => {
      const ident = m.id ? `<span class="cell-sub"><code>${esc(m.id)}</code></span>` : "";
      const evidence = m.evidence ? `<span class="cell-sub">${esc(m.evidence)}</span>` : "";
      return `<tr><td><strong>${esc(m.name)}</strong>${ident}</td><td>${esc(m.use)}${evidence}</td><td>${esc(m.route)}</td></tr>`;
    })
    .join("");
  const modelsUsed = `<p class="hint">See <a href="${esc(MODEL_CATALOG.models_used_url)}">Models used ↗</a> for the full list.</p>`;
  return `<h2 id="models-h">${MODELS_HEADING}</h2><p class="hint">${esc(MODEL_CATALOG.routing_note)}</p><div class="table-wrap" tabindex="0" role="region" aria-label="Meta models, scrollable table"><table class="data"><caption class="sr-only">Meta models and whether Teleion Fabric's model shim routes to them</caption><thead>${MODELS_TABLE_HEAD}</thead><tbody>${rows}</tbody></table></div>${modelsUsed}`;
}

// The same lines as herma/model_catalog.py models_text().
export function modelsText() {
  const lines = [`## ${MODELS_HEADING}`, MODEL_CATALOG.routing_note, ""];
  for (const m of MODEL_CATALOG.models) {
    const ident = m.id ? ` (\`${m.id}\`)` : "";
    const evidence = m.evidence ? ` ${m.evidence}` : "";
    lines.push(`- ${m.name}${ident}: ${m.use}${evidence} Shim routing: ${m.route}`);
  }
  lines.push("", `See Models used for the full list: ${MODEL_CATALOG.models_used_url}`);
  return lines.join("\n");
}

function scrubVisibleLegacyBrand(text) {
  return String(text ?? "")
    .replace(/\bHerma's\b/g, "the model shim's")
    .replace(/\bHerma\b/g, "Teleion Fabric's model shim")
    .replace(/\bTessera's\b/g, "Teleion Fabric's")
    .replace(/\bTessera\b/g, "Teleion Fabric");
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
      return `<tr><td><code>${esc(p.prov_id)}</code><span class="cell-sub">version ${esc(sp.version)}</span></td><td>${esc(tidyText(scrubVisibleLegacyBrand(p.title), 160))}<span class="cell-sub"><code>${esc(action)}</code>${esc(refsNote)}</span></td><td><code>${esc(tiers.join(", "))}</code><span class="cell-sub">match ${esc(p.triggers?.mode || "any")}</span></td><td>${(p.uris || []).length} URI(s)<span class="cell-sub">priority ${p.priority}</span></td><td><code>${esc(sp.source_store)}</code></td></tr>`;
    })
    .join("");
  const cRows = (contextEntries || [])
    .slice(0, 25)
    .map(
      (e) =>
        `<tr><td><code>${esc(e.entry_id)}</code></td><td>${esc(kindLabel(e.kind))}</td><td>${esc(tidyText(scrubVisibleLegacyBrand(e.title), 160))}</td><td>${esc(tidyText(scrubVisibleLegacyBrand(e.summary), 420))}</td><td>${e.source_uri ? `<code>${esc(e.source_uri)}</code>` : "none"}</td></tr>`
    )
    .join("");

  const counts = aggregateCounts || {
    total_intercepted_requests: Array.isArray(receiptsOrUnused) ? receiptsOrUnused.length : 0,
    total_working_entities: 0,
    total_rule_outcomes: 0,
  };
  const table = (label, head, rows, empty, cols) =>
    `<div class="table-wrap" tabindex="0" role="region" aria-label="${label}, scrollable table"><table class="data"><caption class="sr-only">${label}</caption><thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${cols}">${empty}</td></tr>`}</tbody></table></div>`;

  const main = `<div class="wrap page-head">
<span class="kicker"><span class="kicker-dot"></span>Infrastructure for agents &middot; version ${HERMA_VERSION}</span>
<h1>A context shim between an agent and its model</h1>
<p class="lead">Teleion Fabric's model shim connects <strong>Tasks</strong> and <strong>Task Objects</strong> (reusable tools, feeds, datasets, LoRA adapters and shims) to Meta's Muse models without prompt bloat or post-cutoff schema amnesia. Requests route to the Meta API at the standard tier with your own key, led by <code>Muse Wonder 1.0</code> and <code>Muse Spark 1.3</code>.</p>
<p class="hint">Teleion Fabric's model shim is context-shimming AI middleware for configurable coding harnesses. It intercepts a request with keyword, semantic or micromodel rules, then <strong>responds directly</strong> in 0 tokens or shims bounded context before the model runs. Any agent or personal assistant can connect with zero auth through December 31, 2026; <code>*-contributor</code> models remain refused.</p>
<div class="row"><a class="btn" href="/connect">Connect an agent</a><a class="btn-quiet" href="/starter">Start a worker</a><a class="link-out" href="${esc(PAGE_SHELL.header_link.href)}">How it works &#8599;</a></div>
</div>
<div class="wrap">
<section class="section" aria-label="What Teleion Fabric's model shim does">
<div class="cards">
<div class="card"><span class="tags"><span class="tag tag-task">Tasks &amp; Task Objects</span></span><h2 class="card-title">Plain-language primitives, wire-safe</h2><p>Independently schedulable <strong>Tasks</strong> run as fenced queue work; reusable tools, <code>Feed</code> profiles and LoRA specs are compare-and-set <strong>Task Objects</strong>.</p></div>
<div class="card"><span class="tags"><span class="tag tag-object">Zero-weight shim + LoRA memory</span></span><h2 class="card-title">Kill prompt bloat and amnesia</h2><p>Shim volatile rules inline today with zero weight updates, then promote stabilized post-cutoff schemas into <code>Muse Glimmer 30B</code> LoRA adapters fine-tuned by ta-amps (93.3% to 99.3% exact tool-call match on a fixed 150-task evaluation).</p></div>
<div class="card"><span class="tags"><span class="tag tag-real">respond_directly</span></span><h2 class="card-title">Zero-token direct responses</h2><p>Answers natural-language Task, Task Object and contract lookups directly across OpenAI, Responses and Anthropic wire formats, without calling a model.</p></div>
</div>
</section>

<section class="section" aria-labelledby="inspector-h">
<h2 id="inspector-h">Try the shim</h2>
<p class="hint">A read-only preview. It tests the starter <code>system_builtin</code> provisions and entity extraction in memory; nothing is saved and no caller state is read.</p>
<div class="panel">
<div class="presets">
<button class="btn-quiet btn-sm" type="button" data-herma-preset="tasks">Tasks and Task Objects</button>
<button class="btn-quiet btn-sm" type="button" data-herma-preset="feeds">Agent harness feeds</button>
<button class="btn-quiet btn-sm" type="button" data-herma-preset="lora">Shim or LoRA memory</button>
<button class="btn-quiet btn-sm" type="button" data-herma-preset="fencing">Lease fencing</button>
<button class="btn-quiet btn-sm" type="button" data-herma-preset="direct">A direct Task Object schema</button>
<button class="btn-quiet btn-sm" type="button" data-herma-preset="statute">Statute card and error retry</button>
</div>
<div class="stack">
<div class="field"><label for="herma-preview-prompt">The prompt your harness sends</label><textarea id="herma-preview-prompt" placeholder="For example: What are tasks and task objects?"></textarea></div>
<div class="form-grid">
<div class="field"><label for="herma-preview-path">Workspace paths, separated by commas</label><input id="herma-preview-path" type="text" class="mono" placeholder="src/tessera/_tasks.py"></div>
<div class="field"><label for="herma-preview-wire">Wire protocol</label><select id="herma-preview-wire"><option value="chat_completions">OpenAI /v1/chat/completions</option><option value="responses">Responses /v1/responses</option><option value="messages">Anthropic /v1/messages</option></select></div>
</div>
<div><button id="herma-preview-btn" class="btn" type="button">Run the preview</button></div>
<div id="herma-preview-status" class="status-line" role="status" aria-live="polite">Type a prompt or pick an example, then run the preview. Nothing is saved.</div>
<div id="herma-preview-output"></div>
</div>
</div>
</section>

<section class="section" aria-labelledby="models-h">
${renderModelsSection()}
</section>

<section class="section" aria-labelledby="prov-h">
<h2 id="prov-h">Starter provisions (${builtinProvs.length})</h2>
${table("Starter provisions", ["ID", "Title and action", "Triggers", "URIs and priority", "Store"], pRows, "No built-in provisions are seeded yet.", 5)}
</section>

<section class="section" aria-labelledby="ctx-h">
<h2 id="ctx-h">Starter Task Objects, Tasks and details (${(contextEntries || []).length})</h2>
${table("Starter context entries", ["Entry", "Kind", "Title", "Summary", "Source"], cRows, "No built-in Task Object, Task or detail entries are configured yet.", 5)}
</section>

<section class="section" aria-labelledby="tele-h">
<h2 id="tele-h">Totals, with each caller's data kept apart</h2>
${table("Aggregate telemetry", ["Built-in provisions", "Built-in entries", "Requests handled", "Entities tracked", "Outcome signals"], `<tr><td><code>${builtinProvs.length}</code></td><td><code>${(contextEntries || []).length}</code></td><td><code>${Number(counts.total_intercepted_requests || 0)}</code></td><td><code>${Number(counts.total_working_entities || 0)}</code></td><td><code>${Number(counts.total_rule_outcomes || 0)}</code></td></tr>`, "", 5)}
</section>

<section class="section" aria-labelledby="files-h">
<h2 id="files-h">Files for agents</h2>
<ul class="plain-list">
<li><a href="/llms.txt">llms.txt</a></li>
<li><a href="/llms-full.txt">llms-full.txt</a></li>
<li><a href="/.well-known/agent-card.json">Agent card</a></li>
<li><a href="/healthz">Health</a></li>
</ul>
</section>
</div>`;

  return documentHtml({
    title: `Try the shim, Teleion Fabric ${HERMA_VERSION}`,
    description:
      "Teleion Fabric's model shim sits between an agent's harness and its model, shimming Tasks and Task Objects into requests to Meta's Muse models.",
    active: "overview",
    canonical: "/shim",
    main,
    scripts: ["/preview.js"],
  });
}

export function renderConnectHtml(publicUrl) {
  const rawBase = String(publicUrl || "https://shim.teleionlabs.com").replace(/\/+$/, "");
  const cleanBase =
    rawBase.includes("workers.dev") || rawBase.includes("herma.teleionlabs.com")
      ? "https://shim.teleionlabs.com"
      : rawBase;
  const base = esc(cleanBase);
  const main = `<div class="wrap page-head">
<span class="kicker"><span class="kicker-dot"></span>Open agent access through Dec 31, 2026</span>
<h1>Connect a coding harness or personal assistant</h1>
<p class="lead">Through December 31, 2026, any coding harness or personal assistant can route through or configure Teleion Fabric's model shim directly with zero login, zero credentials and zero session setup. Optional <code>X-Agent-Label</code> isolates your workspace, and scoped <code>hmk_</code> keys remain supported for persistent caller bindings.</p>
<p class="hint">We don't accept private information at this stage. Use your own Meta API key, and never send credentials or personal details in a Task Object.</p>
</div>
<div class="wrap">
<div class="stack section">
<div class="card"><h2>1. Add Task Object and Task entries for your agent</h2><pre tabindex="0">curl -fsS -X POST ${base}/v1/context \\
  -H "Content-Type: application/json" \\
  -H "X-Agent-Label: my-agent" \\
  -d '{"entry_id":"noun:custom.lease_contract","kind":"noun","title":"Custom Lease Contract","summary":"Caller-scoped atomic Task Object definition."}'</pre></div>
<div class="card"><h2>2. Dry-run the three-tier shim or a direct response</h2><pre tabindex="0">curl -fsS -X POST ${base}/v1/dry-run \\
  -H "Content-Type: application/json" \\
  -H "X-Agent-Label: my-agent" \\
  -H "X-Herma-Project: my-repo" \\
  -d '{"wire_format":"chat_completions","payload":{"model":"muse-spark-1.3","messages":[{"role":"user","content":"Show the canonical task and task-object schema"}]}}'</pre></div>
<div class="card"><h2>3. Sync governed provisions and read the insights</h2><pre tabindex="0">curl -fsS ${base}/v1/insights?project_tag=my-repo \\
  -H "X-Agent-Label: my-agent"</pre></div>
</div>
</div>`;
  return documentHtml({
    title: "Connect a harness",
    description: "How a coding harness or personal assistant routes through Teleion Fabric's model shim with zero auth.",
    active: "connect",
    canonical: "/connect",
    main,
  });
}

export async function reserveRouteRequest(db, callerScope, limit = 60, env = null) {
  if (isOpenFreeWindow(env)) return;
  const hour = Math.floor(Date.now() / 3600000);
  const result = await db.prepare("INSERT INTO route_quotas (caller_scope, hour, used) VALUES (?, ?, 1) ON CONFLICT(caller_scope, hour) DO UPDATE SET used = used + 1 WHERE used < ?").bind(callerScope, hour, limit).run();
  if (Number(result?.meta?.changes || 0) !== 1) throw new HermaErr(429, "route_quota_exceeded", "Route Quota Exceeded", "60 routed requests per key per hour. Retry next hour.");
  await db.prepare("DELETE FROM route_quotas WHERE hour < ?").bind(hour - 24).run();
}

export function resolveUpstream(request, env, path, { openCaller = false } = {}) {
  const override = request.headers.get("x-upstream-base-url") || request.headers.get("x-herma-upstream-url") || "";
  const configured = env.UPSTREAM_LLM_URL || "";
  const raw = (override || configured).replace(/\/+$/, "");
  if (!raw) throw new HermaErr(502, "missing_upstream", "Missing Upstream", "Configure UPSTREAM_LLM_URL or an allowlisted provider URL with your own key.");
  let target;
  try { target = new URL(raw); } catch { throw new HermaErr(400, "invalid_upstream", "Invalid Upstream", "Expected an absolute provider URL."); }
  if (!["https:", "http:"].includes(target.protocol) || target.username || target.password || target.hash) throw new HermaErr(400, "invalid_upstream", "Invalid Upstream", "Invalid provider URL.");
  const allowed = String(env.HERMA_ALLOWED_UPSTREAM_HOSTS || "api.meta.ai,api.openai.com,api.anthropic.com,127.0.0.1,localhost").split(",").map(s => s.trim().toLowerCase());
  if (override && !allowed.includes(target.hostname.toLowerCase()) && (!configured || target.origin !== new URL(configured).origin)) throw new HermaErr(403, "upstream_not_allowed", "Upstream Not Allowed", "Provider hostname is not allowlisted.");
  const callerKey = request.headers.get("x-upstream-api-key") || "";
  // A caller with no key of ours never spends the operator's model key: it brings its own.
  if (openCaller && !callerKey) throw new HermaErr(402, "bring_your_own_model_key", "Your Own Model Key Needed", "The shim forwards with no key of ours, but a model call needs your own provider key: send it as X-Upstream-Api-Key. /api/preview and /v1/dry-run need no model key.");
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
