// Pure 3-tier trigger engine, configurable-harness gate, multi-protocol payload injector,
// and HTML status console for Herma Cloud on Cloudflare Workers + D1 (`ta-amps-herma`).

export const HERMA_VERSION = "0.1.0";

export const ALLOWED_HARNESS_KINDS = new Set([
  "muse-code",
  "opencode",
  "claude-code",
  "codex",
  "swarm-worker",
  "custom-harness",
]);

const BLOCKED_CONSUMER_SURFACES = [
  "muse-personal-assistant",
  "muse personal assistant",
  "meta-ai-consumer",
  "meta.ai/",
  "messenger-assistant",
  "whatsapp-assistant",
  "instagram-assistant",
  "generic-chat-ui",
];

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

export const DEFAULT_PROVISIONS = [
  {
    prov_id: "PROV-TESSERA-FENCING",
    title: "Tessera Atomic Lease Fencing & Compare-and-Set Storage",
    summary: "Injects monotonic fencing-token, idempotent receipt, and CAS version rules whenever swarm queue or shared-state code is touched.",
    priority: 300,
    enabled: true,
    inject_position: "system_prefix",
    dedupe_mode: "once_per_conversation",
    max_chars: 2200,
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
    prov_id: "PROV-SHAMASH-NON-ACCUSATORY",
    title: "Non-Accusatory Risk Indicators & Synthetic Bundle Guard",
    summary: "Ensures fraud/harm analysis stays strictly non-accusatory, verifies SYNTHETIC markers, and routes T3/T4 decisions to human reviewers.",
    priority: 280,
    enabled: true,
    inject_position: "system_suffix",
    dedupe_mode: "once_per_conversation",
    max_chars: 2000,
    inject_text: "Outputs must express objective risk indicators tied to primary statute cards and recomputed multi-currency arithmetic — never accuse any party of being a criminal, scammer, or perpetrator. Refuse bundles lacking an explicit SYNTHETIC marker, and route T3 holds and T4 referrals exclusively to human reviewers.",
    uris: [
      {
        uri: "https://shamash.ta-amps.workers.dev",
        label: "Shamash Investigation & Triage Surface",
        kind: "doc",
        inline_excerpt: "Card-backed multi-currency checks across 10 harm areas and 27 dated statute cards.",
      },
    ],
    metadata_tags: { domain: "harm-triage", surface: "shamash" },
    triggers: {
      mode: "any",
      keyword: {
        any_keywords: ["statute card", "shamash", "t4 referral", "advance_to_payout", "payee_mismatch"],
        path_globs: ["*shamash/*.py", "areas/*", "cards/*.json"],
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
  const ua = (h.get("user-agent") || "").toLowerCase();
  const declared = (h.get("x-herma-harness") || "").trim().toLowerCase();
  const combined = `${ua} ${declared}`;
  for (const marker of BLOCKED_CONSUMER_SURFACES) {
    if (combined.includes(marker)) {
      throw new HermaErr(
        403,
        "harness_required",
        "Configurable Coding Harness Required",
        `Consumer assistant surface ('${marker}') cannot access or configure Herma; use a fully configurable agentic coding harness (muse-code, opencode, claude-code, or codex).`
      );
    }
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

export function refuseContributorModel(model) {
  if (String(model || "").trim().toLowerCase().includes("-contributor")) {
    throw new HermaErr(
      403,
      "contributor_tier_refused",
      "Contributor Tier Refused",
      `Model '${model}' uses a contributor training tier; Herma enforces Standard mode only.`
    );
  }
}

export async function authenticateHarness(db, request) {
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
      "Missing valid Herma harness key (hmk_<id>.<secret>). Only configurable agentic coding harnesses may route through or configure Herma."
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
        "Configuring provisions requires an explicit X-Herma-Harness header from a configurable coding harness."
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

async function evaluateMicromodel(spec, text, env) {
  if (!spec) return { matched: false, reasons: [], confidence: null };
  const mmUrl = (env.HERMA_MICROMODEL_URL || "").trim();
  const mmModel = (env.HERMA_MICROMODEL_MODEL || "muse-spark-open").trim();
  refuseContributorModel(mmModel);
  if (mmUrl) {
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
            { role: "system", content: "Reply only with JSON: {\"label\":\"apply\"|\"skip\",\"confidence\":0.0..1.0}" },
            { role: "user", content: `${spec.intent_question}\n\nRequest:\n${String(text).slice(0, 2000)}` },
          ],
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const raw = data?.choices?.[0]?.message?.content || "{}";
        const parsed = JSON.parse(raw);
        const label = String(parsed.label || "").toLowerCase();
        const conf = Number(parsed.confidence ?? 0);
        const pos = new Set((spec.positive_labels || ["apply", "yes", "true"]).map((s) => s.toLowerCase()));
        const minConf = spec.min_confidence ?? 0.6;
        if (pos.has(label) && conf >= minConf) {
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

export async function evaluateProvisions(storedList, ctx, env) {
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
      const r3 = await evaluateMicromodel(t.micromodel, ctx.text, env);
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
          matched_tiers: matchedTiers,
          reasons,
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

function renderProvisionBlock(stored) {
  const prov = stored.provision;
  const lines = [`[HERMA PROVISION: ${prov.prov_id}@v${stored.version} | ${prov.title}]`, String(prov.inject_text || "").trim()];
  const uris = [];
  if (Array.isArray(prov.uris) && prov.uris.length) {
    lines.push("Authoritative References & URIs:");
    for (const u of prov.uris) {
      uris.push(u.uri);
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
  return { rendered, uris };
}

export async function assembleAugmentedRequest(principal, envelope, payload, matches, maxTotalChars = 8000) {
  const prefixBlocks = [];
  const suffixBlocks = [];
  const devBlocks = [];
  const firedIds = [];
  const dedupedSkipped = [];
  const tiersSeen = [];
  const urisInjected = [];
  let charsUsed = 0;

  for (const { stored, match } of matches) {
    const prov = stored.provision;
    if ((prov.dedupe_mode || "once_per_conversation") === "once_per_conversation" && envelope.existing_provision_ids.has(prov.prov_id)) {
      dedupedSkipped.push(prov.prov_id);
      continue;
    }
    const { rendered, uris } = renderProvisionBlock(stored);
    if (charsUsed + rendered.length > maxTotalChars) continue;
    charsUsed += rendered.length;
    firedIds.push(`${prov.prov_id}@v${stored.version}`);
    for (const t of match.matched_tiers) if (!tiersSeen.includes(t)) tiersSeen.push(t);
    for (const u of uris) if (!urisInjected.includes(u)) urisInjected.push(u);
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
    wire_format: envelope.wire_format,
    model: envelope.model,
    provisions_fired: firedIds,
    tiers_matched: tiersSeen,
    uris_injected: urisInjected,
    injected_chars: charsUsed,
    deduped_skipped: dedupedSkipped,
  };
  const receiptSha = await sha256Hex(canonicalJson(core));
  return {
    augmented_payload: mutated,
    receipt: { ...core, receipt_sha256: receiptSha, created_at: now },
  };
}

const STYLE = `:root{color-scheme:light dark;--bg:#0c1017;--card:#131a24;--border:#253244;--fg:#eef2f7;--muted:#9fb0c5;--accent:#67b7ff;--pill:#1b2738}
@media (prefers-color-scheme:light){:root{--bg:#f6f7f9;--card:#fff;--border:#d8e0ea;--fg:#101824;--muted:#4b5b70;--accent:#0b5fff;--pill:#eaf1fb}}
*{box-sizing:border-box}body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--fg);line-height:1.55}
main{max-width:1040px;margin:0 auto;padding:2.8rem 1.4rem 3.5rem}nav{display:flex;gap:1rem;margin-bottom:1.6rem;font-size:.92rem}
nav a{color:var(--accent);text-decoration:none;font-weight:600}.pill{display:inline-block;padding:.2rem .6rem;border-radius:999px;background:var(--pill);color:var(--accent);font-size:.76rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em}
h1{margin:.6rem 0 .5rem;font-size:clamp(1.7rem,3vw,2.35rem)}.lead{color:var(--muted);max-width:780px;margin:0 0 1.8rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:1rem;margin-bottom:1.8rem}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1.2rem}.card h2,.card h3{margin:.2rem 0 .5rem;font-size:1.08rem}
pre,code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.86rem}pre{background:var(--pill);border:1px solid var(--border);border-radius:8px;padding:.9rem;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:.9rem;background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:.65rem .85rem;border-bottom:1px solid var(--border);vertical-align:top}th{color:var(--muted);font-weight:600}`;

export function renderOverviewHtml(provisions, receipts, publicUrl) {
  const pRows = provisions
    .map((sp) => {
      const p = sp.provision;
      const tiers = ["keyword", "semantic", "micromodel"].filter((k) => p.triggers?.[k]);
      return `<tr><td><code>${esc(p.prov_id)}</code> (v${sp.version})</td><td>${esc(p.title)}</td><td><code>${esc(tiers.join(", "))}</code> (${esc(p.triggers?.mode || "any")})</td><td>${(p.uris || []).length} URI(s) · prio ${p.priority}</td><td><code>${esc(sp.source_store)}</code></td></tr>`;
    })
    .join("");
  const rRows = receipts
    .slice(0, 10)
    .map(
      (r) =>
        `<tr><td><code>${esc(String(r.receipt_sha256 || "").slice(0, 16))}…</code></td><td><code>${esc(r.harness_kind)}</code></td><td><code>${esc(r.wire_format)}</code> · <code>${esc(r.model)}</code></td><td><code>${esc((r.provisions_fired || []).join(", ") || "none")}</code></td><td>${r.injected_chars ?? 0} chars</td></tr>`
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Herma v${HERMA_VERSION} — Cloud AI Request Middleware</title><style>${STYLE}</style></head><body><main>
<nav><a href="/">Overview</a><a href="/connect">Connect Harness</a><a href="/api/health">Health JSON</a><a href="https://tessera.ta-amps.workers.dev/board">Tessera Cloud</a><a href="https://github.com/ta-amps/herma">GitHub</a></nav>
<span class="pill">Herma v${HERMA_VERSION} · 24/7 Cloudflare D1 + Tessera Cloud</span>
<h1>Programmable AI Request Middleware for Agentic Harnesses</h1>
<p class="lead">Herma sits inline between configurable coding harnesses (<code>muse-code</code>, <code>opencode</code>, <code>claude-code</code>, <code>codex</code>, <code>swarm-worker</code>) and upstream LLM endpoints. It evaluates <strong>keyword</strong>, <strong>semantic</strong>, and <strong>micromodel</strong> triggers, injects versioned provisions and URIs synced from persistent <code>Tessera</code> Cloud stores and buckets, and refuses generic consumer chat assistants and contributor-tier models.</p>
<section class="grid">
<div class="card"><span class="pill">Tier 1 · ~0 ms</span><h3>Keyword, Regex, Path &amp; Tool</h3><p>Deterministic matching on prompt terms, bounded regexes, file path globs, and declared tool names.</p></div>
<div class="card"><span class="pill">Tier 2 · ~1-5 ms</span><h3>Semantic Similarity</h3><p>Concept-cluster + subword cosine matching catches paraphrased engineering intent.</p></div>
<div class="card"><span class="pill">Tier 3 · Router</span><h3>Micromodel Classifier</h3><p>Lightweight intent router disambiguates nuanced workflows with offline fallback.</p></div>
</section>
<h2>Active Cloud Provisions (${provisions.length})</h2>
<table><thead><tr><th>ID</th><th>Title</th><th>Triggers</th><th>URIs &amp; Priority</th><th>Store</th></tr></thead><tbody>${pRows || "<tr><td colspan='5'>No provisions seeded yet.</td></tr>"}</tbody></table>
<h2 style="margin-top:2rem;">Recent Persistent Injection Receipts (${receipts.length})</h2>
<table><thead><tr><th>SHA-256</th><th>Harness</th><th>Wire / Model</th><th>Provisions Fired</th><th>Injected</th></tr></thead><tbody>${rRows || "<tr><td colspan='5'>No intercepted requests recorded yet.</td></tr>"}</tbody></table>
<p style="margin-top:1.5rem;color:var(--muted);font-size:.88rem;">Endpoint: <code>${esc(publicUrl)}</code> · Backed by Cloudflare D1 (<code>ta-amps-herma</code>) · Standard mode only (<code>-contributor</code> refused).</p>
</main></body></html>`;
}

export function renderConnectHtml(publicUrl) {
  const base = esc(publicUrl.replace(/\/+$/, ""));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Connect a Configurable Coding Harness — Herma</title><style>${STYLE}</style></head><body><main>
<nav><a href="/">Overview</a><a href="/connect">Connect Harness</a><a href="/api/health">Health JSON</a><a href="https://github.com/ta-amps/herma">GitHub</a></nav>
<span class="pill">Configurable Harnesses Only</span>
<h1>Connect Muse Code, OpenCode, Claude Code, or Codex</h1>
<p class="lead">Only fully configurable agentic coding harnesses that control custom base URLs, headers, and scoped <code>hmk_</code> credentials can route through or configure Herma. Generic consumer chat clients (such as Muse Personal Assistant) are deterministically refused with <code>HTTP 403 harness_required</code>.</p>
<div class="card" style="margin-bottom:1.2rem;"><h3>1. Dry-Run 3-Tier Interception</h3><pre>curl -fsS -X POST ${base}/v1/dry-run \\
  -H "Content-Type: application/json" \\
  -H "X-Herma-Key: hmk_&lt;id&gt;.&lt;secret&gt;" \\
  -H "X-Herma-Harness: opencode" \\
  -d '{"wire_format":"chat_completions","payload":{"model":"muse-spark-open","messages":[{"role":"user","content":"Persist versioned files in a cloud bucket with put_object"}]}}'</pre></div>
<div class="card"><h3>2. Sync Provisions from Tessera Cloud</h3><pre>curl -fsS -X POST ${base}/v1/sync/tessera \\
  -H "Content-Type: application/json" \\
  -H "X-Herma-Key: hmk_&lt;id&gt;.&lt;secret&gt;" \\
  -H "X-Herma-Harness: muse-code" \\
  -d '{"base_url":"https://tessera.ta-amps.workers.dev","bearer_token":"tsk_...","namespace":"herma.provisions"}'</pre></div>
</main></body></html>`;
}
