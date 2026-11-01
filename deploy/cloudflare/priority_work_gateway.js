// Prioritized Multi-Tier Durable Task Queue, Partitioned Search Sidecar & Task-Object Gateway (`/q/*`)
// for Herma Cloud Worker (v4).
//
// Enforces three visibility & priority tiers across a dual-redundant queue wrapper
// (`env.TESSERA` live Durable Object service binding + Cloudflare D1 transactional priority ledger):
//   1. `ngo_priority`   (visibility: `public_ngo`, priority 95)     -- Claimed FIRST by ALL workers.
//   2. `public_general` (visibility: `public_commons`, priority 60) -- Claimed SECOND by public & server workers.
//   3. `infra_private`  (visibility: `server_infra`, priority 98)   -- STRICTLY HIDDEN from public workers;
//      accessible ONLY to authenticated server-side infrastructure workers (`isAdminRequest` or verified
//      Tessera admin bearer credential). Public writes NEVER borrow any server credential.
//
// Also provides an export-safe (zero virtual tables) 5-Channel Hybrid Search & Retrieval Sidecar (`/q/search`):
//   - Lean partitioned routing columns (`partition_slot`, `category`, `labels_json`, `input_shape_hash`,
//     `output_shape_hash`, `lsh_band_0`, `lsh_band_1`, `quality_milli`, `content_sha256`)
//   - Write-once `content_sha256` sidecar (`herma_search_sidecar`, `herma_search_postings`,
//     `herma_lsh_bands`, `herma_symspell_deletes`) supporting Porter-like IDF/BM25 stems, character
//     trigrams, `O(1)` SymSpell 1..2-edit typo recovery, 4-band SimHash LSH, 64-bit semantic concept
//     hyperplane sketches, and Weighted Reciprocal Rank Fusion (RRF) + Quality/Tombstone reranking.

import { computeTaskFingerprint, scrubSensitiveText } from "./bilateral_bridge.js";
import { isAdminRequest } from "./herma_engine.js";

export const QUEUE_GATEWAY_GRID = Object.freeze({
  schema_id: "herma.priority_work_gateway.grid.v2",
  agent_max_len: 48,
  task_id_max_len: 64,
  title_max_len: 180,
  prompt_max_len: 2400,
  summary_max_len: 1200,
  slug_max_len: 2000,
  max_objects_per_submit: 12,
  max_verbs_per_submit: 12,
  max_pulse_items: 20,
  max_search_limit: 50,
  default_search_limit: 10,
  candidate_pool_cap: 60,
  lease_ttl_ms: 900000,
  priority_ngo_default: 95,
  priority_public_default: 60,
  priority_infra_default: 98,
  priority_min: 1,
  priority_max: 100,
  partition_modulus: 16,
  hash_prefix_chars: 12,
  shape_hash_chars: 16,
  band_hex_width: 4,
  simhash_bits: 64,
  hex_chars_64b: 16,
  hex_radix: 16,
  hex_byte_pad: 2,
  min_token_len: 2,
  min_stem_guard: 3,
  trigram_width: 3,
  max_trigrams_per_doc: 96,
  symspell_min_len: 4,
  symspell_max_len: 22,
  symspell_max_edits: 2,
  rrf_k: 40,
  rrf_scale: 35.0,
  weight_stem_bm25: 1.3,
  weight_typo_trigram: 1.0,
  weight_lsh_fuzzy: 0.9,
  weight_semantic_sketch: 1.35,
  weight_io_port: 1.15,
  post_weight_title: 5000,
  post_weight_keyword: 4000,
  post_weight_alias: 3500,
  post_weight_body: 2500,
  milli_divisor: 1000.0,
  default_quality_milli: 750,
  verified_seed_quality_milli: 920,
  quality_rerank_weight: 0.4,
  tombstone_penalty: 1.5,
  cosine_sketch_weight: 0.35,
  exact_kw_bonus: 0.2,
  port_match_bonus: 0.25,
  score_round_factor: 10000,
  http_ok: 200,
  http_created: 201,
  http_bad_request: 400,
  http_forbidden: 403,
  http_not_found: 404,
  http_method_not_allowed: 405,
});

const PUBLIC_TIERS = new Set(["ngo_priority", "public_general"]);
const ALL_TIERS = new Set(["ngo_priority", "public_general", "infra_private"]);

const SEMANTIC_CONCEPT_LEXICON = Object.freeze({
  fencing: ["cas", "lease", "split_brain", "zombie_worker", "monotonic_token", "epoch_guard", "optimistic_concurrency"],
  idempotent: ["deduplication", "exactly_once", "replay_safe", "idempotency_key", "duplicate_delivery", "checksum", "digest"],
  probabilistic: ["bloom", "cuckoo", "xor_filter", "binary_fuse", "hyperloglog", "count_min", "bitset", "membership"],
  similarity: ["simhash", "minhash", "lsh", "hamming", "jaccard", "fuzzy_fingerprint", "shingle", "near_duplicate"],
  decomposition: ["dag", "topological", "subtask", "fanout", "htn", "fork_join", "dependency_graph", "branch"],
  quorum: ["consensus", "ballot", "reconcile", "adjudicate", "maker_checker", "majority_vote", "tie_break"],
  quantization: ["int8", "int4", "spinquant", "hadamard", "rabitq", "binary_sketch", "dora", "compression"],
  civic_aid: ["nonprofit", "990n", "epostcard", "bmf", "shelter", "aid_directory", "accessibility", "screen_reader", "low_bandwidth", "triage", "clinic", "food_bank"],
});

const INITIAL_QUEUE_SEEDS = Object.freeze([
  {
    seed_key: "ngo_seed_990n_directory_audit",
    tier: "ngo_priority",
    visibility: "public_ngo",
    priority: 97,
    category: "civic_aid_verification",
    labels: ["ngo", "990n", "aid_directory", "verification"],
    title: "NGO Priority: Small-Nonprofit Aid Directory Gap & Eligibility Verification Rubric",
    prompt:
      "Community food banks, shelters, and rural clinics filing IRS Form 990-N e-Postcards are frequently omitted or stale in regional aid directories. Choose ONE concrete verification branch to solve thoroughly right now (e.g., primary-source status check rubric, service-hours & accessibility normalization schema, or duplicate-entity reconciliation rule), store your reusable rubric/schema as a task object, and enqueue the remaining unexplored branches as follow-up durable verbs.",
    input_contract: "public_nonprofit_registry_slice",
    output_contract: "verified_task_object_and_branch_verbs",
  },
  {
    seed_key: "ngo_seed_disaster_shelter_schema",
    tier: "ngo_priority",
    visibility: "public_ngo",
    priority: 95,
    category: "emergency_relief_schema",
    labels: ["ngo", "shelter", "accessibility", "harmonizer"],
    title: "NGO Priority: Disaster-Relief Shelter, Medical-Power & Accessibility Feed Harmonizer",
    prompt:
      "Municipal emergency feeds and volunteer NGO shelter spreadsheets report capacity, wheelchair access, medical backup power, and language support under incompatible field names. Build ONE clean canonical mapping & validation checklist as a reusable task object, and enqueue 2 bounded follow-up verbs for edge cases you intentionally defer (e.g., offline SMS intake parsing, stale-capacity confidence decay).",
    input_contract: "heterogeneous_relief_feeds",
    output_contract: "canonical_shelter_task_object",
  },
  {
    seed_key: "ngo_seed_low_bandwidth_civic_access",
    tier: "ngo_priority",
    visibility: "public_ngo",
    priority: 93,
    category: "accessibility_triage",
    labels: ["ngo", "low_bandwidth", "screen_reader", "triage"],
    title: "NGO Priority: Low-Bandwidth & Screen-Reader Civic Assistance Triage Spec",
    prompt:
      "Design a lightweight, zero-JS-fallback verification checklist and structured intake template so low-bandwidth mobile and screen-reader users can complete emergency food, housing, or clinic triage without session drops. Complete ONE high-impact checklist module as a task object and queue remaining modules as follow-up durable verbs.",
    input_contract: "civic_intake_flow",
    output_contract: "accessibility_rubric_task_object",
  },
  {
    seed_key: "pub_seed_wikipedia_featured_synthesis",
    tier: "public_general",
    visibility: "public_commons",
    priority: 65,
    category: "knowledge_synthesis",
    labels: ["wikipedia", "featured_article", "commons"],
    title: "Public Commons: Wikipedia Featured Article / Page-of-the-Day Noun & Verb Synthesis",
    prompt:
      "Fetch today's Wikipedia Featured Article / Page of the Day (https://en.wikipedia.org/api/rest_v1/feed/featured/YYYY/MM/DD or https://en.wikipedia.org/wiki/Main_Page), extract 1-2 verifiable structured task objects capturing key mechanisms, datasets, or historical/scientific invariants, and enqueue 2 thoughtful, bounded follow-up verbs applying those insights to open engineering or public-good problems.",
    input_contract: "wikipedia_featured_content",
    output_contract: "knowledge_task_objects_and_verbs",
  },
  {
    seed_key: "pub_seed_interchangeable_node_spec",
    tier: "public_general",
    visibility: "public_commons",
    priority: 60,
    category: "computational_node",
    labels: ["interchangeable_node", "port_shim", "liskov"],
    title: "Public Commons: 8-Facet Interchangeable Computational Node & Adapter Specification",
    prompt:
      "Define 1 concrete, domain-agnostic computational node (description, problem, solution mechanism, input_type, output_type, common_use_cases) for fault-tolerant agent workflows, store it as a reusable task object, and enqueue 1-2 deferred testing or adapter-shim branches as follow-up durable verbs.",
    input_contract: "workflow_bottleneck_spec",
    output_contract: "interchangeable_node_task_object",
  },
  {
    seed_key: "infra_seed_queue_embodiment_calibration",
    tier: "infra_private",
    visibility: "server_infra",
    priority: 99,
    category: "infra_queue_calibration",
    labels: ["infra", "fencing", "coalescing", "failover"],
    title: "Server Infra [Restricted]: Multi-Embodiment Durable Queue Failover & Coalescing Calibration",
    prompt:
      "Evaluate dual-redundant queue telemetry (Tessera Durable Object CAS vs D1 Priority Ledger vs Local WAL Affinity Coalescer), compute empirical batch-coalescing token savings and lease-reap thresholds, store updated waterfall weights as an infra task object, and queue next counterfactual sweep verbs.",
    input_contract: "internal_queue_telemetry",
    output_contract: "calibrated_waterfall_policy",
  },
  {
    seed_key: "infra_seed_overnight_counterfactual_distill",
    tier: "infra_private",
    visibility: "server_infra",
    priority: 96,
    category: "infra_counterfactual_distill",
    labels: ["infra", "counterfactual", "dpo", "frontier"],
    title: "Server Infra [Restricted]: Overnight Counterfactual Frontier Trace & File-Lift Distillation",
    prompt:
      "Compare counterfactual runs across frontier models (deepseek-v4.1-flash, deepseek-v4-pro, kimi-k3, kimi-k2.7-code, glm-5.3), quantify workspace file-contribution lift, promote verified grid cells, and emit SFT/DPO training slice metadata.",
    input_contract: "counterfactual_ledger_slice",
    output_contract: "promoted_grid_and_dpo_manifest",
  },
]);

const SUFFIXES = [
  "izations", "ization", "ational", "fulness", "ousness", "iveness",
  "ements", "ement", "ating", "ition", "ation", "ities", "ances",
  "ences", "ingly", "edly", "ness", "ment", "able", "ible", "ance",
  "ence", "ings", "ally", "ions", "ers", "ing", "ies", "ied", "ion",
  "ate", "ive", "ous", "ful", "est", "ed", "er", "es", "ly", "s",
];

async function sha256HexGateway(input) {
  const bytes = new TextEncoder().encode(String(input));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(QUEUE_GATEWAY_GRID.hex_radix).padStart(QUEUE_GATEWAY_GRID.hex_byte_pad, "0")
  ).join("");
}

function cleanAgentId(raw) {
  const cleaned = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, QUEUE_GATEWAY_GRID.agent_max_len);
  return cleaned || "volunteer-agent";
}

function stemToken(word) {
  const w = String(word || "").toLowerCase().replace(/^_+|_+$/g, "");
  for (const suffix of SUFFIXES) {
    if (w.length > suffix.length + QUEUE_GATEWAY_GRID.min_stem_guard && w.endsWith(suffix)) {
      if (suffix === "ies" || suffix === "ied") {
        return w.slice(0, -suffix.length) + "y";
      }
      return w.slice(0, -suffix.length);
    }
  }
  return w;
}

function tokenizeWordsAndIdentifiers(text) {
  const spaced = String(text || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  const raw = spaced.match(/[a-z0-9_]+/g) || [];
  const out = [];
  for (const tok of raw) {
    if (tok.length >= QUEUE_GATEWAY_GRID.min_token_len) out.push(tok);
    if (tok.includes("_")) {
      for (const part of tok.split("_")) {
        if (part.length >= QUEUE_GATEWAY_GRID.min_token_len) out.push(part);
      }
    }
  }
  return out;
}

function expandSemanticAliases(tokens) {
  const tokSet = new Set(tokens);
  const stemSet = new Set(tokens.map(stemToken));
  const aliases = new Set();
  for (const [concept, related] of Object.entries(SEMANTIC_CONCEPT_LEXICON)) {
    const group = [concept, ...related];
    const matched = group.some((g) => tokSet.has(g) || stemSet.has(stemToken(g)));
    if (matched) {
      for (const term of group) {
        aliases.add(term);
        if (term.includes("_")) {
          for (const sub of term.split("_")) {
            if (sub.length >= QUEUE_GATEWAY_GRID.min_token_len) aliases.add(sub);
          }
        }
      }
    }
  }
  return Array.from(aliases).sort();
}

function extractTrigrams(text) {
  const clean = tokenizeWordsAndIdentifiers(text).join(" ");
  const w = QUEUE_GATEWAY_GRID.trigram_width;
  if (clean.length < w) return clean ? [clean] : [];
  const set = new Set();
  for (let i = 0; i <= clean.length - w; i += 1) {
    set.add(clean.slice(i, i + w));
    if (set.size >= QUEUE_GATEWAY_GRID.max_trigrams_per_doc) break;
  }
  return Array.from(set);
}

function generateSymspellDeletes(word) {
  const clean = String(word || "").toLowerCase().replace(/^_+|_+$/g, "");
  if (
    clean.length < QUEUE_GATEWAY_GRID.symspell_min_len ||
    clean.length > QUEUE_GATEWAY_GRID.symspell_max_len ||
    !/^[a-z0-9]+$/.test(clean)
  ) {
    return [];
  }
  const deletes = new Set([clean]);
  let frontier = new Set([clean]);
  for (let d = 0; d < QUEUE_GATEWAY_GRID.symspell_max_edits; d += 1) {
    const next = new Set();
    for (const cand of frontier) {
      if (cand.length <= QUEUE_GATEWAY_GRID.symspell_min_len - 1) continue;
      for (let i = 0; i < cand.length; i += 1) {
        const del = cand.slice(0, i) + cand.slice(i + 1);
        if (!deletes.has(del)) {
          deletes.add(del);
          next.add(del);
        }
      }
    }
    frontier = next;
  }
  return Array.from(deletes);
}

function boundedEditDistance(a, b, maxEdits) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxEdits) return maxEdits + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, idx) => idx);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const val = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      curr.push(val);
      if (val < rowMin) rowMin = val;
    }
    if (rowMin > maxEdits) return maxEdits + 1;
    prev = curr;
  }
  return prev[b.length];
}

async function computeSemanticSketch64(tokens, aliases) {
  const features = Array.from(new Set([...tokens.map(stemToken), ...aliases]));
  const bitCount = QUEUE_GATEWAY_GRID.simhash_bits;
  const weights = new Array(bitCount).fill(0);
  for (const feat of features.length ? features : ["empty"]) {
    const h = await sha256HexGateway(`sem_sketch_v1:${feat}`);
    const hi = BigInt("0x" + h.slice(0, QUEUE_GATEWAY_GRID.hex_chars_64b));
    const bonus = aliases.includes(feat) ? 2 : 1;
    for (let bit = 0; bit < bitCount; bit += 1) {
      const mask = 1n << BigInt(bit);
      weights[bit] += (hi & mask) !== 0n ? bonus : -bonus;
    }
  }
  let sketch = 0n;
  for (let bit = 0; bit < bitCount; bit += 1) {
    if (weights[bit] >= 0) sketch |= 1n << BigInt(bit);
  }
  return sketch.toString(QUEUE_GATEWAY_GRID.hex_radix).padStart(QUEUE_GATEWAY_GRID.hex_chars_64b, "0");
}

function splitHexBands(prefix, hexStr) {
  const w = QUEUE_GATEWAY_GRID.band_hex_width;
  const bands = [];
  for (let i = 0; i < hexStr.length; i += w) {
    bands.push(`${prefix}${i / w}:${hexStr.slice(i, i + w)}`);
  }
  return bands;
}

function hammingSimilarityHex64(hexA, hexB) {
  try {
    let xor = BigInt("0x" + hexA) ^ BigInt("0x" + hexB);
    let dist = 0;
    while (xor > 0n) {
      dist += Number(xor & 1n);
      xor >>= 1n;
    }
    return 1.0 - dist / QUEUE_GATEWAY_GRID.simhash_bits;
  } catch {
    return 0.0;
  }
}

async function isServerInfraAuthorized(request, env) {
  if (isAdminRequest(request, env)) return true;
  const auth = (request.headers.get("authorization") || "").trim();
  if (!auth.toLowerCase().startsWith("bearer ") || !env?.TESSERA?.fetch) {
    return false;
  }
  try {
    const checkResp = await env.TESSERA.fetch(
      new Request("https://tessera.internal/v1/admin/keys", {
        method: "GET",
        headers: { authorization: auth, accept: "application/json" },
      })
    );
    return checkResp.status === QUEUE_GATEWAY_GRID.http_ok;
  } catch {
    return false;
  }
}

async function ensureColumnsExist(db, tableName, columnSpecs) {
  const info = await db.prepare(`PRAGMA table_info(${tableName})`).all();
  const existing = new Set((info?.results || []).map((r) => String(r.name)));
  for (const [colName, colDef] of columnSpecs) {
    if (!existing.has(colName)) {
      await db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${colDef}`).run();
    }
  }
}

async function indexSidecarDocument(db, { title, bodyText, category, labels, inputContract, outputContract }) {
  const fullText = `${title} ${bodyText} ${category || ""} ${(labels || []).join(" ")}`;
  const contentSha = await sha256HexGateway(
    `${title}\0${bodyText}\0${inputContract || ""}\0${outputContract || ""}`
  );
  const fp = await computeTaskFingerprint(fullText);
  const shBands = splitHexBands("sh", fp.simhash64_hex);
  const partSlot =
    parseInt(contentSha.slice(0, QUEUE_GATEWAY_GRID.band_hex_width * 2), QUEUE_GATEWAY_GRID.hex_radix) %
    QUEUE_GATEWAY_GRID.partition_modulus;
  const inShape = (await sha256HexGateway(String(inputContract || "json_object").toLowerCase())).slice(
    0,
    QUEUE_GATEWAY_GRID.shape_hash_chars
  );
  const outShape = (await sha256HexGateway(String(outputContract || "verified_task_object").toLowerCase())).slice(
    0,
    QUEUE_GATEWAY_GRID.shape_hash_chars
  );

  const existingSidecar = await db
    .prepare("SELECT content_sha256 FROM herma_search_sidecar WHERE content_sha256 = ?")
    .bind(contentSha)
    .first();

  if (!existingSidecar) {
    const tokens = tokenizeWordsAndIdentifiers(fullText);
    const uniqueTokens = Array.from(new Set(tokens));
    const aliases = expandSemanticAliases(uniqueTokens);
    const semSketchHex = await computeSemanticSketch64(uniqueTokens, aliases);
    const embBands = splitHexBands("eb", semSketchHex);
    const nowIso = new Date().toISOString();
    const stmts = [];

    stmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO herma_search_sidecar
           (content_sha256, title, canonical_keywords, semantic_aliases, summary_scent, simhash64_hex, embed_sketch64_hex, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          contentSha,
          String(title || "").slice(0, QUEUE_GATEWAY_GRID.title_max_len),
          uniqueTokens.join(" ").slice(0, QUEUE_GATEWAY_GRID.prompt_max_len),
          aliases.join(" ").slice(0, QUEUE_GATEWAY_GRID.summary_max_len),
          String(bodyText || "").slice(0, QUEUE_GATEWAY_GRID.summary_max_len),
          fp.simhash64_hex,
          semSketchHex,
          nowIso
        )
    );

    // Weighted stem postings
    const stemWeights = new Map();
    for (const t of tokenizeWordsAndIdentifiers(title)) {
      const s = stemToken(t);
      stemWeights.set(s, Math.max(stemWeights.get(s) || 0, QUEUE_GATEWAY_GRID.post_weight_title));
    }
    for (const t of uniqueTokens) {
      const s = stemToken(t);
      stemWeights.set(s, Math.max(stemWeights.get(s) || 0, QUEUE_GATEWAY_GRID.post_weight_keyword));
    }
    for (const t of aliases) {
      const s = stemToken(t);
      stemWeights.set(s, Math.max(stemWeights.get(s) || 0, QUEUE_GATEWAY_GRID.post_weight_alias));
    }
    for (const [stem, wt] of stemWeights.entries()) {
      stmts.push(
        db
          .prepare(
            "INSERT OR REPLACE INTO herma_search_postings (term_kind, term, content_sha256, weight_milli) VALUES ('stem', ?, ?, ?)"
          )
          .bind(stem, contentSha, wt)
      );
    }

    // Character trigram postings for substring & compound identifiers
    for (const tri of extractTrigrams(`${title} ${uniqueTokens.join(" ")}`)) {
      stmts.push(
        db
          .prepare(
            "INSERT OR IGNORE INTO herma_search_postings (term_kind, term, content_sha256, weight_milli) VALUES ('trigram', ?, ?, ?)"
          )
          .bind(tri, contentSha, QUEUE_GATEWAY_GRID.post_weight_body)
      );
    }

    // Label postings
    for (const lbl of labels || []) {
      const cleanLbl = String(lbl || "").trim().toLowerCase();
      if (cleanLbl) {
        stmts.push(
          db
            .prepare(
              "INSERT OR IGNORE INTO herma_search_postings (term_kind, term, content_sha256, weight_milli) VALUES ('label', ?, ?, ?)"
            )
            .bind(cleanLbl, contentSha, QUEUE_GATEWAY_GRID.post_weight_title)
        );
      }
    }

    // LSH bands (SimHash + Semantic Concept Sketch)
    for (const bKey of [...shBands, ...embBands]) {
      stmts.push(
        db
          .prepare("INSERT OR IGNORE INTO herma_lsh_bands (band_key, content_sha256) VALUES (?, ?)")
          .bind(bKey, contentSha)
      );
    }

    // SymSpell 1..2 edit delete keys
    for (const tok of uniqueTokens) {
      if (/^[a-z]+$/.test(tok)) {
        for (const delKey of generateSymspellDeletes(tok)) {
          stmts.push(
            db
              .prepare(
                `INSERT INTO herma_symspell_deletes (delete_key, canonical_word, doc_freq)
                 VALUES (?, ?, 1)
                 ON CONFLICT(delete_key, canonical_word) DO UPDATE SET doc_freq = doc_freq + 1`
              )
              .bind(delKey, tok)
          );
        }
      }
    }

    const batchChunk = QUEUE_GATEWAY_GRID.candidate_pool_cap;
    for (let offset = 0; offset < stmts.length; offset += batchChunk) {
      await db.batch(stmts.slice(offset, offset + batchChunk));
    }
  }

  return {
    content_sha256: contentSha,
    simhash64_hex: fp.simhash64_hex,
    lsh_band_0: shBands[0],
    lsh_band_1: shBands[1],
    partition_slot: partSlot,
    input_shape_hash: inShape,
    output_shape_hash: outShape,
  };
}

export async function ensurePriorityGatewaySchema(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS herma_durable_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL UNIQUE,
        tier TEXT NOT NULL,
        visibility TEXT NOT NULL,
        priority INTEGER NOT NULL,
        state TEXT NOT NULL DEFAULT 'ready',
        fencing_token INTEGER NOT NULL DEFAULT 0,
        leased_by TEXT,
        lease_expires_at TEXT,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        input_contract TEXT NOT NULL DEFAULT 'json_object',
        output_contract TEXT NOT NULL DEFAULT 'verified_task_object',
        parent_task_id TEXT,
        branch_label TEXT,
        simhash64_hex TEXT NOT NULL,
        producer_agent TEXT NOT NULL,
        completed_by TEXT,
        result_summary TEXT,
        receipt_hash TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
    )
    .run();

  // Non-destructive column evolution for partitioned routing, I/O shapes, LSH bands & sidecar FK
  await ensureColumnsExist(db, "herma_durable_queue", [
    ["partition_slot", "INTEGER NOT NULL DEFAULT 0"],
    ["category", "TEXT NOT NULL DEFAULT 'general_verb'"],
    ["labels_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["input_shape_hash", "TEXT NOT NULL DEFAULT ''"],
    ["output_shape_hash", "TEXT NOT NULL DEFAULT ''"],
    ["lsh_band_0", "TEXT NOT NULL DEFAULT ''"],
    ["lsh_band_1", "TEXT NOT NULL DEFAULT ''"],
    ["quality_milli", "INTEGER NOT NULL DEFAULT 750"],
    ["content_sha256", "TEXT NOT NULL DEFAULT ''"],
  ]);

  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_hdq_claim
       ON herma_durable_queue (state, visibility, priority DESC, id ASC)`
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_hdq_affinity
       ON herma_durable_queue (state, visibility, lsh_band_0, priority DESC)`
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_hdq_content_sha
       ON herma_durable_queue (content_sha256)`
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS herma_task_objects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        object_key TEXT NOT NULL,
        category TEXT NOT NULL,
        visibility TEXT NOT NULL,
        producer_agent TEXT NOT NULL,
        source_task_id TEXT,
        summary TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        simhash64_hex TEXT NOT NULL,
        sha256_hash TEXT NOT NULL,
        tessera_synced INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`
    )
    .run();

  await ensureColumnsExist(db, "herma_task_objects", [
    ["partition_slot", "INTEGER NOT NULL DEFAULT 0"],
    ["labels_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["input_shape_hash", "TEXT NOT NULL DEFAULT ''"],
    ["output_shape_hash", "TEXT NOT NULL DEFAULT ''"],
    ["lsh_band_0", "TEXT NOT NULL DEFAULT ''"],
    ["lsh_band_1", "TEXT NOT NULL DEFAULT ''"],
    ["quality_milli", "INTEGER NOT NULL DEFAULT 800"],
    ["is_tombstoned", "INTEGER NOT NULL DEFAULT 0"],
    ["content_sha256", "TEXT NOT NULL DEFAULT ''"],
  ]);

  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_hto_vis
       ON herma_task_objects (visibility, id DESC)`
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_hto_content_sha
       ON herma_task_objects (content_sha256)`
    )
    .run();

  // Export-safe D1 B-tree Search Sidecar Tables (no VIRTUAL TABLE USING fts5 so `wrangler d1 export` always succeeds)
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS herma_search_sidecar (
        content_sha256 TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        canonical_keywords TEXT NOT NULL,
        semantic_aliases TEXT NOT NULL,
        summary_scent TEXT NOT NULL,
        simhash64_hex TEXT NOT NULL,
        embed_sketch64_hex TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS herma_search_postings (
        term_kind TEXT NOT NULL,
        term TEXT NOT NULL,
        content_sha256 TEXT NOT NULL,
        weight_milli INTEGER NOT NULL,
        PRIMARY KEY (term_kind, term, content_sha256)
      )`
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS herma_lsh_bands (
        band_key TEXT NOT NULL,
        content_sha256 TEXT NOT NULL,
        PRIMARY KEY (band_key, content_sha256)
      )`
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS herma_symspell_deletes (
        delete_key TEXT NOT NULL,
        canonical_word TEXT NOT NULL,
        doc_freq INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (delete_key, canonical_word)
      )`
    )
    .run();

  const existing = await db.prepare("SELECT COUNT(*) AS cnt FROM herma_durable_queue").first();
  if (Number(existing?.cnt || 0) === 0) {
    const now = new Date().toISOString();
    for (const seed of INITIAL_QUEUE_SEEDS) {
      const idxMeta = await indexSidecarDocument(db, {
        title: seed.title,
        bodyText: seed.prompt,
        category: seed.category,
        labels: seed.labels,
        inputContract: seed.input_contract,
        outputContract: seed.output_contract,
      });
      await db
        .prepare(
          `INSERT OR IGNORE INTO herma_durable_queue
           (task_id, tier, visibility, priority, state, title, prompt, input_contract, output_contract,
            simhash64_hex, producer_agent, created_at, updated_at,
            partition_slot, category, labels_json, input_shape_hash, output_shape_hash, lsh_band_0, lsh_band_1, quality_milli, content_sha256)
           VALUES (?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, 'system-seed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          seed.seed_key,
          seed.tier,
          seed.visibility,
          seed.priority,
          seed.title,
          seed.prompt,
          seed.input_contract,
          seed.output_contract,
          idxMeta.simhash64_hex,
          now,
          now,
          idxMeta.partition_slot,
          seed.category,
          JSON.stringify(seed.labels),
          idxMeta.input_shape_hash,
          idxMeta.output_shape_hash,
          idxMeta.lsh_band_0,
          idxMeta.lsh_band_1,
          QUEUE_GATEWAY_GRID.verified_seed_quality_milli,
          idxMeta.content_sha256
        )
        .run();
    }
  } else {
    // Backfill sidecar index for any pre-v4 rows missing `content_sha256`
    const unindexedTasks = await db
      .prepare("SELECT id, title, prompt, category, input_contract, output_contract FROM herma_durable_queue WHERE content_sha256 = ''")
      .all();
    for (const row of unindexedTasks?.results || []) {
      const idxMeta = await indexSidecarDocument(db, {
        title: row.title,
        bodyText: row.prompt,
        category: row.category || "general_verb",
        labels: [row.category || "verb"],
        inputContract: row.input_contract,
        outputContract: row.output_contract,
      });
      await db
        .prepare(
          `UPDATE herma_durable_queue
           SET partition_slot = ?, input_shape_hash = ?, output_shape_hash = ?, lsh_band_0 = ?, lsh_band_1 = ?, content_sha256 = ?
           WHERE id = ?`
        )
        .bind(
          idxMeta.partition_slot,
          idxMeta.input_shape_hash,
          idxMeta.output_shape_hash,
          idxMeta.lsh_band_0,
          idxMeta.lsh_band_1,
          idxMeta.content_sha256,
          row.id
        )
        .run();
    }

    const unindexedObjs = await db
      .prepare("SELECT id, object_key, category, summary, payload_json FROM herma_task_objects WHERE content_sha256 = ''")
      .all();
    for (const row of unindexedObjs?.results || []) {
      const idxMeta = await indexSidecarDocument(db, {
        title: row.object_key,
        bodyText: `${row.summary} ${row.payload_json || ""}`,
        category: row.category || "knowledge_noun",
        labels: [row.category || "noun"],
        inputContract: "json_object",
        outputContract: row.category || "knowledge_noun",
      });
      await db
        .prepare(
          `UPDATE herma_task_objects
           SET partition_slot = ?, input_shape_hash = ?, output_shape_hash = ?, lsh_band_0 = ?, lsh_band_1 = ?, content_sha256 = ?
           WHERE id = ?`
        )
        .bind(
          idxMeta.partition_slot,
          idxMeta.input_shape_hash,
          idxMeta.output_shape_hash,
          idxMeta.lsh_band_0,
          idxMeta.lsh_band_1,
          idxMeta.content_sha256,
          row.id
        )
        .run();
    }
  }
}

async function resolveSymspellCorrections(db, rawTokens) {
  const corrected = [];
  const correctionsMap = {};
  for (const tok of rawTokens) {
    if (tok.length < QUEUE_GATEWAY_GRID.symspell_min_len || !/^[a-z]+$/.test(tok)) {
      corrected.push(tok);
      continue;
    }
    const exact = await db
      .prepare("SELECT canonical_word FROM herma_symspell_deletes WHERE delete_key = ? AND canonical_word = ? LIMIT 1")
      .bind(tok, tok)
      .first();
    if (exact) {
      corrected.push(tok);
      continue;
    }
    const delKeys = generateSymspellDeletes(tok);
    if (!delKeys.length) {
      corrected.push(tok);
      continue;
    }
    const ph = delKeys.map(() => "?").join(",");
    const candRows = await db
      .prepare(`SELECT DISTINCT canonical_word, doc_freq FROM herma_symspell_deletes WHERE delete_key IN (${ph})`)
      .bind(...delKeys)
      .all();
    let bestWord = tok;
    let bestDist = QUEUE_GATEWAY_GRID.symspell_max_edits + 1;
    let bestFreq = -1;
    for (const r of candRows?.results || []) {
      const cw = String(r.canonical_word);
      const dist = boundedEditDistance(tok, cw, QUEUE_GATEWAY_GRID.symspell_max_edits);
      const freq = Number(r.doc_freq || 1);
      if (dist < bestDist || (dist === bestDist && freq > bestFreq)) {
        bestDist = dist;
        bestFreq = freq;
        bestWord = cw;
      }
    }
    if (bestWord !== tok) {
      correctionsMap[tok] = bestWord;
    }
    corrected.push(bestWord);
  }
  return { correctedTokens: corrected, correctionsMap };
}

async function executeHybridSearch(db, infraAllowed, params) {
  const rawQuery = String(params.q || params.query || "").trim();
  const scope = String(params.scope || "all").toLowerCase(); // 'all' | 'tasks' | 'objects'
  const reqTier = params.tier ? String(params.tier) : null;
  const reqCategory = params.category ? String(params.category).trim() : null;
  const reqLabel = params.label ? String(params.label).trim().toLowerCase() : null;
  const reqInputContract = params.input_contract ? String(params.input_contract).trim() : null;
  const reqOutputContract = params.output_contract ? String(params.output_contract).trim() : null;
  const limit = Math.max(
    1,
    Math.min(QUEUE_GATEWAY_GRID.max_search_limit, Number(params.limit || QUEUE_GATEWAY_GRID.default_search_limit))
  );

  if (reqTier === "infra_private" && !infraAllowed) {
    return {
      forbidden: true,
      detail: "Searching infra_private tasks requires server-side infrastructure worker authorization.",
    };
  }

  const rawTokens = tokenizeWordsAndIdentifiers(rawQuery);
  const { correctedTokens, correctionsMap } = await resolveSymspellCorrections(db, rawTokens);
  const semanticAliases = expandSemanticAliases(correctedTokens);
  const combinedTokens = Array.from(new Set([...correctedTokens, ...rawTokens]));
  const queryTextForSketch = combinedTokens.join(" ") || "empty";
  const qFp = await computeTaskFingerprint(queryTextForSketch);
  const qShBands = splitHexBands("sh", qFp.simhash64_hex);
  const qSemSketch = await computeSemanticSketch64(correctedTokens, semanticAliases);
  const qEmbBands = splitHexBands("eb", qSemSketch);

  const channelRanks = [];
  const shaChannels = new Map();
  const recordChannelHit = (sha, chName) => {
    if (!shaChannels.has(sha)) shaChannels.set(sha, new Set());
    shaChannels.get(sha).add(chName);
  };

  // Channel 1: Stemmed Lexical Postings (Title/Keyword/Semantic Alias Weighted)
  const stems = Array.from(new Set([...combinedTokens.map(stemToken), ...semanticAliases.map(stemToken)])).filter(Boolean);
  if (stems.length > 0) {
    const ph = stems.map(() => "?").join(",");
    const rows = await db
      .prepare(
        `SELECT content_sha256, SUM(weight_milli) AS score_sum
         FROM herma_search_postings
         WHERE term_kind = 'stem' AND term IN (${ph})
         GROUP BY content_sha256
         ORDER BY score_sum DESC
         LIMIT ?`
      )
      .bind(...stems, QUEUE_GATEWAY_GRID.candidate_pool_cap)
      .all();
    const list = (rows?.results || []).map((r) => {
      const s = String(r.content_sha256);
      recordChannelHit(s, Object.keys(correctionsMap).length > 0 ? "typo_symspell_stem" : "stem_bm25");
      return s;
    });
    channelRanks.push([QUEUE_GATEWAY_GRID.weight_stem_bm25, list]);
  }

  // Channel 2: Character Trigram Postings (Substring & Compound Identifier Tolerance)
  const qTrigrams = extractTrigrams(combinedTokens.join(" ")).slice(0, QUEUE_GATEWAY_GRID.max_pulse_items);
  if (qTrigrams.length > 0) {
    const ph = qTrigrams.map(() => "?").join(",");
    const rows = await db
      .prepare(
        `SELECT content_sha256, COUNT(*) AS tri_hits
         FROM herma_search_postings
         WHERE term_kind = 'trigram' AND term IN (${ph})
         GROUP BY content_sha256
         ORDER BY tri_hits DESC
         LIMIT ?`
      )
      .bind(...qTrigrams, QUEUE_GATEWAY_GRID.candidate_pool_cap)
      .all();
    const list = (rows?.results || []).map((r) => {
      const s = String(r.content_sha256);
      recordChannelHit(s, "trigram_fuzzy");
      return s;
    });
    channelRanks.push([QUEUE_GATEWAY_GRID.weight_typo_trigram, list]);
  }

  // Channel 3: Multi-Band LSH Lookup (SimHash64 + Semantic Concept Sketch Bands)
  const allBands = [...qShBands, ...qEmbBands];
  if (allBands.length > 0 && rawQuery) {
    const ph = allBands.map(() => "?").join(",");
    const rows = await db
      .prepare(
        `SELECT content_sha256, COUNT(*) AS band_hits
         FROM herma_lsh_bands
         WHERE band_key IN (${ph})
         GROUP BY content_sha256
         ORDER BY band_hits DESC
         LIMIT ?`
      )
      .bind(...allBands, QUEUE_GATEWAY_GRID.candidate_pool_cap)
      .all();
    const list = (rows?.results || []).map((r) => {
      const s = String(r.content_sha256);
      recordChannelHit(s, "lsh_band_match");
      return s;
    });
    channelRanks.push([QUEUE_GATEWAY_GRID.weight_lsh_fuzzy, list]);
  }

  // Channel 4: Semantic Concept Hyperplane Sketch Scan over Sidecar
  const allSidecars = await db
    .prepare("SELECT content_sha256, canonical_keywords, simhash64_hex, embed_sketch64_hex FROM herma_search_sidecar LIMIT ?")
    .bind(QUEUE_GATEWAY_GRID.candidate_pool_cap * QUEUE_GATEWAY_GRID.band_hex_width)
    .all();
  const sidecarMap = new Map();
  const semScored = [];
  for (const sRow of allSidecars?.results || []) {
    const sha = String(sRow.content_sha256);
    sidecarMap.set(sha, sRow);
    if (rawQuery) {
      const semSim = hammingSimilarityHex64(qSemSketch, String(sRow.embed_sketch64_hex));
      semScored.push([sha, semSim]);
    }
  }
  if (semScored.length > 0) {
    semScored.sort((a, b) => b[1] - a[1]);
    const topSem = semScored.slice(0, QUEUE_GATEWAY_GRID.candidate_pool_cap).map(([sha]) => {
      recordChannelHit(sha, "semantic_sketch");
      return sha;
    });
    channelRanks.push([QUEUE_GATEWAY_GRID.weight_semantic_sketch, topSem]);
  }

  // Channel 5: Label Filter Channel
  if (reqLabel) {
    const rows = await db
      .prepare("SELECT content_sha256 FROM herma_search_postings WHERE term_kind = 'label' AND term = ?")
      .bind(reqLabel)
      .all();
    const lblList = (rows?.results || []).map((r) => {
      const s = String(r.content_sha256);
      recordChannelHit(s, "label_exact");
      return s;
    });
    channelRanks.push([QUEUE_GATEWAY_GRID.weight_io_port, lblList]);
  }

  // Weighted Reciprocal Rank Fusion (RRF)
  const rrfScores = new Map();
  for (const [weight, list] of channelRanks) {
    for (let i = 0; i < list.length; i += 1) {
      const sha = list[i];
      rrfScores.set(sha, (rrfScores.get(sha) || 0) + weight / (QUEUE_GATEWAY_GRID.rrf_k + i + 1));
    }
  }

  const visFilter = infraAllowed
    ? "visibility IN ('public_ngo', 'public_commons', 'server_infra')"
    : "visibility IN ('public_ngo', 'public_commons')";

  const reqInHash = reqInputContract
    ? (await sha256HexGateway(reqInputContract.toLowerCase())).slice(0, QUEUE_GATEWAY_GRID.shape_hash_chars)
    : null;
  const reqOutHash = reqOutputContract
    ? (await sha256HexGateway(reqOutputContract.toLowerCase())).slice(0, QUEUE_GATEWAY_GRID.shape_hash_chars)
    : null;

  const candidates = [];
  if (scope === "all" || scope === "tasks") {
    let sql = `SELECT 'durable_task' AS artifact_kind, task_id AS item_id, tier, visibility, priority, state,
                      category, title, prompt AS summary, input_contract, output_contract,
                      input_shape_hash, output_shape_hash, lsh_band_0, quality_milli, 0 AS is_tombstoned, content_sha256
               FROM herma_durable_queue WHERE ${visFilter}`;
    const binds = [];
    if (reqTier) {
      sql += " AND tier = ?";
      binds.push(reqTier);
    }
    if (reqCategory) {
      sql += " AND category = ?";
      binds.push(reqCategory);
    }
    const tRows = await db.prepare(sql).bind(...binds).all();
    candidates.push(...(tRows?.results || []));
  }

  if ((scope === "all" || scope === "objects") && !reqTier) {
    let sql = `SELECT 'task_object' AS artifact_kind, object_key AS item_id, 'public_general' AS tier, visibility,
                      80 AS priority, 'stored' AS state, category, object_key AS title, summary,
                      'json_object' AS input_contract, category AS output_contract,
                      input_shape_hash, output_shape_hash, lsh_band_0, quality_milli, is_tombstoned, content_sha256
               FROM herma_task_objects WHERE ${visFilter}`;
    const binds = [];
    if (reqCategory) {
      sql += " AND category = ?";
      binds.push(reqCategory);
    }
    const oRows = await db.prepare(sql).bind(...binds).all();
    candidates.push(...(oRows?.results || []));
  }

  const corrSet = new Set(correctedTokens);
  const ranked = [];
  for (const item of candidates) {
    if (reqInHash && item.input_shape_hash !== reqInHash) continue;
    if (reqOutHash && item.output_shape_hash !== reqOutHash) continue;

    const sha = String(item.content_sha256 || "");
    const baseRrf = (rrfScores.get(sha) || 0) * QUEUE_GATEWAY_GRID.rrf_scale;
    if (rawQuery && baseRrf === 0 && !reqInHash && !reqOutHash && !reqCategory && !reqLabel) {
      continue;
    }
    const sMeta = sidecarMap.get(sha);
    const semCos = sMeta && rawQuery ? hammingSimilarityHex64(qSemSketch, String(sMeta.embed_sketch64_hex)) : 0;
    const kwList = sMeta ? String(sMeta.canonical_keywords || "").split(" ") : [];
    const exactHit = kwList.some((k) => corrSet.has(k)) ? QUEUE_GATEWAY_GRID.exact_kw_bonus : 0;
    const portHit =
      (reqInHash && item.input_shape_hash === reqInHash) || (reqOutHash && item.output_shape_hash === reqOutHash)
        ? QUEUE_GATEWAY_GRID.port_match_bonus
        : 0;
    const qualNorm = Number(item.quality_milli || QUEUE_GATEWAY_GRID.default_quality_milli) / QUEUE_GATEWAY_GRID.milli_divisor;
    const tombPen = Number(item.is_tombstoned || 0) === 1 ? QUEUE_GATEWAY_GRID.tombstone_penalty : 0;

    const finalScore =
      baseRrf +
      QUEUE_GATEWAY_GRID.cosine_sketch_weight * semCos +
      exactHit +
      portHit +
      QUEUE_GATEWAY_GRID.quality_rerank_weight * qualNorm -
      tombPen;

    const channels = Array.from(shaChannels.get(sha) || []);
    if (portHit > 0) channels.push("io_port_shape");

    ranked.push({
      artifact_kind: item.artifact_kind,
      id: item.item_id,
      tier: item.tier,
      state: item.state,
      category: item.category,
      title: item.title,
      summary: String(item.summary || "").slice(0, QUEUE_GATEWAY_GRID.title_max_len * 2),
      lsh_band_0: item.lsh_band_0,
      quality_milli: Number(item.quality_milli),
      rrf_score: Math.round(baseRrf * QUEUE_GATEWAY_GRID.score_round_factor) / QUEUE_GATEWAY_GRID.score_round_factor,
      final_score: Math.round(finalScore * QUEUE_GATEWAY_GRID.score_round_factor) / QUEUE_GATEWAY_GRID.score_round_factor,
      matched_channels: channels,
    });
  }

  ranked.sort((a, b) => b.final_score - a.final_score);
  return {
    ok: true,
    schema: "herma.priority_work_gateway.search.v1",
    caller_role: infraAllowed ? "server_infrastructure_worker" : "public_or_volunteer_worker",
    query_analysis: {
      raw_query: rawQuery,
      raw_tokens: rawTokens,
      typo_corrections: correctionsMap,
      corrected_tokens: correctedTokens,
      semantic_aliases_expanded: semanticAliases,
      query_simhash_bands: qShBands,
      query_semantic_sketch_bands: qEmbBands,
    },
    total_matches: ranked.length,
    results: ranked.slice(0, limit),
  };
}

async function reapExpiredLeases(db) {
  const nowIso = new Date().toISOString();
  await db
    .prepare(
      `UPDATE herma_durable_queue
       SET state = 'ready', leased_by = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE state = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?`
    )
    .bind(nowIso, nowIso)
    .run();
}

async function probeTesseraEmbodiment(env) {
  if (!env?.TESSERA?.fetch) {
    return { available: false, mode: "d1_standalone_failover", latency_ms: 0 };
  }
  const t0 = Date.now();
  try {
    const resp = await env.TESSERA.fetch(new Request("https://tessera.internal/healthz", { method: "GET" }));
    return {
      available: resp.status === QUEUE_GATEWAY_GRID.http_ok,
      mode: resp.status === QUEUE_GATEWAY_GRID.http_ok ? "active_active_dual_redundant" : "d1_hot_standby_failover",
      latency_ms: Date.now() - t0,
    };
  } catch {
    return { available: false, mode: "d1_hot_standby_failover", latency_ms: Date.now() - t0 };
  }
}

async function mirrorPublicArtifactToTesseraAnonymous(env, agentId, objectKey, payload) {
  if (!env?.TESSERA?.fetch) return { synced: false, receipt_hash: null };
  try {
    const sessResp = await env.TESSERA.fetch(
      new Request("https://tessera.internal/v1/session/anonymous", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ label: `q-${agentId}` }),
      })
    );
    if (sessResp.status !== QUEUE_GATEWAY_GRID.http_ok && sessResp.status !== QUEUE_GATEWAY_GRID.http_created) {
      return { synced: false, receipt_hash: null };
    }
    const sess = await sessResp.json();
    const token = sess.token || sess.session_token;
    if (!token) return { synced: false, receipt_hash: null };
    const safeRecKey = String(objectKey).replace(/[^A-Za-z0-9_.:-]+/g, "_").slice(0, QUEUE_GATEWAY_GRID.task_id_max_len);
    const putResp = await env.TESSERA.fetch(
      new Request(`https://tessera.internal/v1/stores/demo.artifacts/records/${encodeURIComponent(safeRecKey)}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ value: payload }),
      })
    );
    const claimResp = await env.TESSERA.fetch(
      new Request("https://tessera.internal/v1/tasks/claim", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ queue: "demo.ping", worker: agentId }),
      })
    );
    if (claimResp.status === QUEUE_GATEWAY_GRID.http_ok) {
      const lease = await claimResp.json();
      const subResp = await env.TESSERA.fetch(
        new Request("https://tessera.internal/v1/tasks/submit", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            accept: "application/json",
            "idempotency-key": `qsub_${lease.task_id}_${Date.now()}`,
          },
          body: JSON.stringify({
            task_id: lease.task_id,
            fencing_token: lease.fencing_token || 1,
            ok: true,
            output: { object_key: safeRecKey, summary: String(payload.summary || "").slice(0, QUEUE_GATEWAY_GRID.title_max_len) },
          }),
        })
      );
      if (subResp.status === QUEUE_GATEWAY_GRID.http_ok) {
        const subDoc = await subResp.json();
        return { synced: putResp.status === QUEUE_GATEWAY_GRID.http_ok, receipt_hash: subDoc.receipt_hash || null };
      }
    }
    return { synced: putResp.status === QUEUE_GATEWAY_GRID.http_ok, receipt_hash: null };
  } catch {
    return { synced: false, receipt_hash: null };
  }
}

async function buildPulseSnapshot(db, env, infraAllowed) {
  await reapExpiredLeases(db);
  const tesseraHealth = await probeTesseraEmbodiment(env);
  const visFilter = infraAllowed
    ? "visibility IN ('public_ngo', 'public_commons', 'server_infra')"
    : "visibility IN ('public_ngo', 'public_commons')";

  const countRows = await db
    .prepare(
      `SELECT tier, state, COUNT(*) AS cnt
       FROM herma_durable_queue
       WHERE ${visFilter}
       GROUP BY tier, state`
    )
    .all();

  const tiers = {
    ngo_priority: { ready: 0, leased: 0, done: 0 },
    public_general: { ready: 0, leased: 0, done: 0 },
  };
  if (infraAllowed) {
    tiers.infra_private = { ready: 0, leased: 0, done: 0 };
  }
  for (const r of countRows?.results || []) {
    if (tiers[r.tier] && tiers[r.tier][r.state] !== undefined) {
      tiers[r.tier][r.state] = Number(r.cnt);
    }
  }

  const readyPreview = await db
    .prepare(
      `SELECT task_id, tier, priority, category, title, input_contract, output_contract, lsh_band_0, parent_task_id, branch_label
       FROM herma_durable_queue
       WHERE state = 'ready' AND ${visFilter}
       ORDER BY (CASE tier WHEN 'infra_private' THEN 0 WHEN 'ngo_priority' THEN 1 ELSE 2 END) ASC,
                priority DESC, id ASC
       LIMIT ?`
    )
    .bind(QUEUE_GATEWAY_GRID.max_pulse_items)
    .all();

  const recentObjects = await db
    .prepare(
      `SELECT object_key, category, producer_agent, source_task_id, summary, lsh_band_0, quality_milli, sha256_hash, created_at
       FROM herma_task_objects
       WHERE ${visFilter}
       ORDER BY id DESC
       LIMIT ?`
    )
    .bind(QUEUE_GATEWAY_GRID.max_pulse_items)
    .all();

  const sidecarStats = await db
    .prepare("SELECT COUNT(*) AS indexed_docs FROM herma_search_sidecar")
    .first();

  const todayPath = new Date().toISOString().slice(0, 10).replace(/-/g, "/");
  return {
    ok: true,
    schema: QUEUE_GATEWAY_GRID.schema_id,
    caller_role: infraAllowed ? "server_infrastructure_worker" : "public_or_volunteer_worker",
    priority_policy: infraAllowed
      ? ["infra_private (server-only)", "ngo_priority (public good -- highest public priority)", "public_general"]
      : ["ngo_priority (public good -- ALWAYS claimed first)", "public_general (commons & deferred branches)"],
    queue_embodiments: {
      tessera_durable_object_cas: tesseraHealth,
      d1_transactional_priority_ledger: { available: true, storage: "cloudflare_d1" },
      hybrid_search_sidecar: {
        available: true,
        export_safe_btree: true,
        indexed_unique_contents: Number(sidecarStats?.indexed_docs || 0),
        endpoint: "/q/search?q=<query>",
      },
      active_wrapper_mode: tesseraHealth.mode,
    },
    queue_counts_by_tier: tiers,
    ready_tasks_preview: readyPreview?.results || [],
    recent_task_objects: recentObjects?.results || [],
    waterfall_when_empty_or_blocked: [
      `1. Search peer task objects & open verbs via GET /q/search?q=<topic> or inspect /q/pulse`,
      `2. Fetch Wikipedia Featured Feed https://en.wikipedia.org/api/rest_v1/feed/featured/${todayPath} (or https://en.wikipedia.org/wiki/Main_Page)`,
      "3. Distill 1-2 verifiable structured task objects (nouns) and 2 bounded public-good or open-science follow-up verbs",
      "4. Submit via POST /q/submit or GET /q/submit/<agent_id>/self_seed/summary-<text>--object-<name>:<summary>--verb-<new-task>",
    ],
  };
}

function parseGatewaySlug(rawSlug) {
  let decoded = String(rawSlug || "").slice(0, QUEUE_GATEWAY_GRID.slug_max_len);
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // keep raw slice
  }
  const parts = decoded.split("--").map((s) => s.trim()).filter(Boolean);
  let summary = "";
  const taskObjects = [];
  const queuedVerbs = [];
  let scheduleStatus = null;

  for (const part of parts) {
    const clean = scrubSensitiveText(part);
    const lower = clean.toLowerCase();
    if (lower.startsWith("summary-")) {
      summary = clean.slice("summary-".length).replace(/[-_]+/g, " ").trim();
    } else if (lower.startsWith("object-")) {
      const body = clean.slice("object-".length);
      const sep = body.indexOf(":");
      const key = sep > 0 ? body.slice(0, sep) : `obj_${taskObjects.length + 1}`;
      const val = (sep > 0 ? body.slice(sep + 1) : body).replace(/[-_]+/g, " ").trim();
      if (val) {
        taskObjects.push({ object_key: key, category: "knowledge_noun", summary: val, payload: { summary: val } });
      }
    } else if (lower.startsWith("verb-") || lower.startsWith("ngo-verb-")) {
      const isNgo = lower.startsWith("ngo-verb-");
      const text = clean
        .slice(isNgo ? "ngo-verb-".length : "verb-".length)
        .replace(/[-_]+/g, " ")
        .trim();
      if (text) {
        queuedVerbs.push({
          tier: isNgo ? "ngo_priority" : "public_general",
          title: text.slice(0, QUEUE_GATEWAY_GRID.title_max_len),
          prompt: text,
          branch_label: "deferred_branch_from_get_gateway",
        });
      }
    } else if (lower.startsWith("schedule-")) {
      scheduleStatus = clean.slice("schedule-".length).replace(/[-_]+/g, " ").trim();
    } else if (!summary) {
      summary = clean.replace(/[-_]+/g, " ").trim();
    }
  }
  return {
    summary: summary || "completed bounded branch",
    task_objects: taskObjects,
    queued_verbs: queuedVerbs,
    schedule_status: scheduleStatus,
  };
}

async function claimNextAuthorizedTask(db, agentId, infraAllowed, requestedTier = null, affinityBand = null) {
  await reapExpiredLeases(db);
  if (requestedTier === "infra_private" && !infraAllowed) {
    return { forbidden: true };
  }

  const bandOrderClause = affinityBand ? "CASE WHEN lsh_band_0 = ? THEN 0 ELSE 1 END ASC," : "";
  const bandBind = affinityBand ? [String(affinityBand)] : [];

  let row = null;
  if (requestedTier && ALL_TIERS.has(requestedTier)) {
    row = await db
      .prepare(
        `SELECT * FROM herma_durable_queue
         WHERE state = 'ready' AND tier = ?
         ORDER BY ${bandOrderClause} priority DESC, id ASC LIMIT 1`
      )
      .bind(requestedTier, ...bandBind)
      .first();
  } else if (infraAllowed) {
    row = await db
      .prepare(
        `SELECT * FROM herma_durable_queue
         WHERE state = 'ready' AND visibility IN ('server_infra', 'public_ngo', 'public_commons')
         ORDER BY (CASE WHEN tier IN ('infra_private', 'ngo_priority') THEN 0 ELSE 1 END) ASC,
                  ${bandOrderClause} priority DESC, id ASC
         LIMIT 1`
      )
      .bind(...bandBind)
      .first();
  } else {
    row = await db
      .prepare(
        `SELECT * FROM herma_durable_queue
         WHERE state = 'ready' AND visibility IN ('public_ngo', 'public_commons')
         ORDER BY (CASE WHEN tier = 'ngo_priority' THEN 0 ELSE 1 END) ASC,
                  ${bandOrderClause} priority DESC, id ASC
         LIMIT 1`
      )
      .bind(...bandBind)
      .first();
  }

  if (!row) {
    return { task: null };
  }

  const nextToken = Number(row.fencing_token || 0) + 1;
  const now = new Date();
  const expiresIso = new Date(now.getTime() + QUEUE_GATEWAY_GRID.lease_ttl_ms).toISOString();
  await db
    .prepare(
      `UPDATE herma_durable_queue
       SET state = 'leased', fencing_token = ?, leased_by = ?, lease_expires_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(nextToken, agentId, expiresIso, now.toISOString(), row.id)
    .run();

  return {
    task: {
      task_id: row.task_id,
      tier: row.tier,
      visibility: row.visibility,
      priority: Number(row.priority),
      category: row.category,
      fencing_token: nextToken,
      leased_by: agentId,
      lease_expires_at: expiresIso,
      title: row.title,
      prompt: row.prompt,
      input_contract: row.input_contract,
      output_contract: row.output_contract,
      parent_task_id: row.parent_task_id,
      branch_label: row.branch_label,
      simhash64_hex: row.simhash64_hex,
      lsh_band_0: row.lsh_band_0,
    },
  };
}

async function processSubmissionAndEnqueueVerbs(db, env, publicUrl, infraAllowed, payload) {
  const agentId = cleanAgentId(payload.agent_id || payload.agent);
  const taskId = scrubSensitiveText(payload.task_id || "self_seed").slice(0, QUEUE_GATEWAY_GRID.task_id_max_len);
  const summary = scrubSensitiveText(payload.summary || payload.completed_branch || "completed task branch").slice(
    0,
    QUEUE_GATEWAY_GRID.summary_max_len
  );
  const nowIso = new Date().toISOString();

  const existingTask = await db
    .prepare("SELECT * FROM herma_durable_queue WHERE task_id = ?")
    .bind(taskId)
    .first();
  if (existingTask && existingTask.visibility === "server_infra" && !infraAllowed) {
    return {
      forbidden: true,
      detail: "Submitting to server_infra tasks requires server infrastructure worker authorization.",
    };
  }

  // 1. Store & index reusable `task_objects` (nouns)
  const rawObjects = Array.isArray(payload.task_objects)
    ? payload.task_objects.slice(0, QUEUE_GATEWAY_GRID.max_objects_per_submit)
    : [];
  const storedObjects = [];
  for (let i = 0; i < rawObjects.length; i += 1) {
    const item = rawObjects[i] || {};
    const objKey = scrubSensitiveText(item.object_key || item.key || `${agentId}_obj_${Date.now()}_${i}`)
      .replace(/[^A-Za-z0-9_.:-]+/g, "_")
      .slice(0, QUEUE_GATEWAY_GRID.task_id_max_len);
    const category = scrubSensitiveText(item.category || "knowledge_noun").slice(0, QUEUE_GATEWAY_GRID.agent_max_len);
    const objVis = item.visibility === "server_infra" && infraAllowed ? "server_infra" : "public_commons";
    const objSummary = scrubSensitiveText(item.summary || summary).slice(0, QUEUE_GATEWAY_GRID.summary_max_len);
    const objPayloadStr = JSON.stringify(item.payload || item).slice(0, QUEUE_GATEWAY_GRID.prompt_max_len);
    const labels = Array.isArray(item.labels) ? item.labels.map((x) => scrubSensitiveText(x)) : [category];
    const idxMeta = await indexSidecarDocument(db, {
      title: objKey,
      bodyText: `${objSummary} ${objPayloadStr}`,
      category,
      labels,
      inputContract: item.input_contract || "json_object",
      outputContract: item.output_contract || category,
    });
    const objHash = await sha256HexGateway(`${objKey}:${objPayloadStr}:${nowIso}`);
    await db
      .prepare(
        `INSERT INTO herma_task_objects
         (object_key, category, visibility, producer_agent, source_task_id, summary, payload_json,
          simhash64_hex, sha256_hash, created_at,
          partition_slot, labels_json, input_shape_hash, output_shape_hash, lsh_band_0, lsh_band_1, quality_milli, content_sha256)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        objKey,
        category,
        objVis,
        agentId,
        taskId,
        objSummary,
        objPayloadStr,
        idxMeta.simhash64_hex,
        objHash,
        nowIso,
        idxMeta.partition_slot,
        JSON.stringify(labels),
        idxMeta.input_shape_hash,
        idxMeta.output_shape_hash,
        idxMeta.lsh_band_0,
        idxMeta.lsh_band_1,
        QUEUE_GATEWAY_GRID.verified_seed_quality_milli,
        idxMeta.content_sha256
      )
      .run();
    storedObjects.push({ object_key: objKey, category, lsh_band_0: idxMeta.lsh_band_0, sha256_hash: objHash });
  }

  // 2. Enqueue & index deferred branches & newly proposed follow-up `verbs` (durable tasks)
  const rawVerbs = Array.isArray(payload.queued_verbs)
    ? payload.queued_verbs.slice(0, QUEUE_GATEWAY_GRID.max_verbs_per_submit)
    : [];
  const enqueuedVerbs = [];
  for (let i = 0; i < rawVerbs.length; i += 1) {
    const v = typeof rawVerbs[i] === "string" ? { prompt: rawVerbs[i] } : rawVerbs[i] || {};
    const vPrompt = scrubSensitiveText(v.prompt || v.title || "").slice(0, QUEUE_GATEWAY_GRID.prompt_max_len);
    if (!vPrompt) continue;
    let tier = PUBLIC_TIERS.has(v.tier) ? v.tier : "public_general";
    if (v.tier === "infra_private") {
      if (!infraAllowed) {
        return { forbidden: true, detail: "Public workers cannot enqueue infra_private tasks." };
      }
      tier = "infra_private";
    }
    const vis =
      tier === "infra_private" ? "server_infra" : tier === "ngo_priority" ? "public_ngo" : "public_commons";
    const defaultPrio =
      tier === "infra_private"
        ? QUEUE_GATEWAY_GRID.priority_infra_default
        : tier === "ngo_priority"
          ? QUEUE_GATEWAY_GRID.priority_ngo_default
          : QUEUE_GATEWAY_GRID.priority_public_default;
    const prio = Math.max(
      QUEUE_GATEWAY_GRID.priority_min,
      Math.min(QUEUE_GATEWAY_GRID.priority_max, Number(v.priority || defaultPrio))
    );
    const vTitle = scrubSensitiveText(v.title || vPrompt).slice(0, QUEUE_GATEWAY_GRID.title_max_len);
    const vCategory = scrubSensitiveText(v.category || tier).slice(0, QUEUE_GATEWAY_GRID.agent_max_len);
    const vLabels = Array.isArray(v.labels) ? v.labels.map((x) => scrubSensitiveText(x)) : [tier, vCategory];
    const inContract = scrubSensitiveText(v.input_contract || "json_object").slice(0, QUEUE_GATEWAY_GRID.agent_max_len);
    const outContract = scrubSensitiveText(v.output_contract || "verified_task_object").slice(
      0,
      QUEUE_GATEWAY_GRID.agent_max_len
    );
    const idxMeta = await indexSidecarDocument(db, {
      title: vTitle,
      bodyText: vPrompt,
      category: vCategory,
      labels: vLabels,
      inputContract: inContract,
      outputContract: outContract,
    });
    const newIdHash = (await sha256HexGateway(`${agentId}:${vPrompt}:${nowIso}:${i}`)).slice(
      0,
      QUEUE_GATEWAY_GRID.hash_prefix_chars
    );
    const newTaskId = `verb_${tier.slice(0, 3)}_${newIdHash}`;
    await db
      .prepare(
        `INSERT OR IGNORE INTO herma_durable_queue
         (task_id, tier, visibility, priority, state, title, prompt, input_contract, output_contract,
          parent_task_id, branch_label, simhash64_hex, producer_agent, created_at, updated_at,
          partition_slot, category, labels_json, input_shape_hash, output_shape_hash, lsh_band_0, lsh_band_1, quality_milli, content_sha256)
         VALUES (?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        newTaskId,
        tier,
        vis,
        prio,
        vTitle,
        vPrompt,
        inContract,
        outContract,
        taskId,
        scrubSensitiveText(v.branch_label || "deferred_or_followup_branch").slice(0, QUEUE_GATEWAY_GRID.agent_max_len),
        idxMeta.simhash64_hex,
        agentId,
        nowIso,
        nowIso,
        idxMeta.partition_slot,
        vCategory,
        JSON.stringify(vLabels),
        idxMeta.input_shape_hash,
        idxMeta.output_shape_hash,
        idxMeta.lsh_band_0,
        idxMeta.lsh_band_1,
        QUEUE_GATEWAY_GRID.default_quality_milli,
        idxMeta.content_sha256
      )
      .run();
    enqueuedVerbs.push({ task_id: newTaskId, tier, priority: prio, lsh_band_0: idxMeta.lsh_band_0, title: vTitle });
  }

  // 3. Mirror public artifact to Tessera anonymous sandbox for dual-engine receipt verification
  const tesseraSync = await mirrorPublicArtifactToTesseraAnonymous(env, agentId, `${taskId}_${agentId}`, {
    agent_id: agentId,
    task_id: taskId,
    summary,
    stored_objects_count: storedObjects.length,
    enqueued_verbs_count: enqueuedVerbs.length,
  });

  const localReceipt = await sha256HexGateway(
    JSON.stringify({ agentId, taskId, summary, storedObjects, enqueuedVerbs, nowIso })
  );
  const receiptHash = tesseraSync.receipt_hash || localReceipt;

  if (existingTask) {
    await db
      .prepare(
        `UPDATE herma_durable_queue
         SET state = 'done', completed_by = ?, result_summary = ?, receipt_hash = ?, updated_at = ?
         WHERE task_id = ?`
      )
      .bind(agentId, summary, receiptHash, nowIso, taskId)
      .run();
  }

  const pulse = await buildPulseSnapshot(db, env, infraAllowed);
  return {
    ok: true,
    agent_id: agentId,
    completed_task_id: taskId,
    summary,
    receipt_hash: receiptHash,
    verification_code: receiptHash.slice(0, QUEUE_GATEWAY_GRID.hash_prefix_chars),
    tessera_dual_synced: tesseraSync.synced,
    stored_task_objects: storedObjects,
    enqueued_followup_verbs: enqueuedVerbs,
    queue_counts_by_tier: pulse.queue_counts_by_tier,
    next_claim_url: `${publicUrl}/q/claim/${encodeURIComponent(agentId)}`,
  };
}

function formatClaimBanner(publicUrl, claimOut, pulse) {
  if (!claimOut.task) {
    return [
      "=== DURABLE QUEUE STATUS: NO READY PUBLIC TASKS RIGHT NOW ===",
      `Active Wrapper Mode: ${pulse.queue_embodiments.active_wrapper_mode}`,
      `Queue Counts: ${JSON.stringify(pulse.queue_counts_by_tier)}`,
      "",
      "WATERFALL NEXT STEPS (ROADBLOCK / EMPTY-QUEUE RECOVERY):",
      ...pulse.waterfall_when_empty_or_blocked,
      `Search URL (GET):  ${publicUrl}/q/search?q=<topic>`,
      `Submit URL (GET):  ${publicUrl}/q/submit/<your-agent-id>/self_seed/summary-<findings>--object-wiki_topic:<structured-fact>--ngo-verb-<new-ngo-task>--verb-<new-commons-task>`,
      `Submit URL (POST): ${publicUrl}/q/submit`,
    ].join("\n");
  }
  const t = claimOut.task;
  return [
    "=== LEASED PRIORITIZED DURABLE TASK ===",
    `TASK_ID:         ${t.task_id}`,
    `PRIORITY_TIER:   ${t.tier} (priority=${t.priority}, visibility=${t.visibility})`,
    `AFFINITY_BAND:   ${t.lsh_band_0}`,
    `FENCING_TOKEN:   ${t.fencing_token}`,
    `LEASE_EXPIRES:   ${t.lease_expires_at}`,
    `QUEUE_COUNTS:    ${JSON.stringify(pulse.queue_counts_by_tier)}`,
    `WRAPPER_MODE:    ${pulse.queue_embodiments.active_wrapper_mode}`,
    "",
    `TITLE: ${t.title}`,
    `PROMPT: ${t.prompt}`,
    "",
    "EXECUTION & BRANCHING CONTRACT:",
    "1. Solve ONE focused branch thoroughly right now (do not try to boil the ocean in one turn).",
    "2. Package reusable facts, rubrics, or node specs as `task_objects` (nouns).",
    "3. Enqueue any unchosen branches or newly discovered follow-ups as `queued_verbs` (tasks).",
    `4. Optional Search: ${publicUrl}/q/search?q=<keywords> (typo-tolerant + semantic LSH + RRF reranking).`,
    "",
    "HOW TO SUBMIT:",
    `- Option A (POST JSON to ${publicUrl}/q/submit):`,
    `  {"agent_id":"${t.leased_by}","task_id":"${t.task_id}","fencing_token":${t.fencing_token},"summary":"...","task_objects":[{"object_key":"...","category":"rubric","summary":"...","payload":{}}],"queued_verbs":[{"tier":"ngo_priority","title":"...","prompt":"..."}]}`,
    `- Option B (Browser-safe GET URL for read-only web tools):`,
    `  ${publicUrl}/q/submit/${encodeURIComponent(t.leased_by)}/${encodeURIComponent(t.task_id)}/summary-<concise-solution>--object-<noun_key>:<reusable-finding>--verb-<deferred-branch-1>--verb-<deferred-branch-2>`,
  ].join("\n");
}

export async function handlePriorityWorkGateway(request, env, db, publicUrl, { withSecurity }) {
  await ensurePriorityGatewaySchema(db);
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const segments = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  const action = segments[1] || "pulse";
  const infraAllowed = await isServerInfraAuthorized(request, env);
  const wantsJson =
    (request.headers.get("accept") || "").includes("application/json") || url.searchParams.get("format") === "json";

  const sendJson = (obj, status = QUEUE_GATEWAY_GRID.http_ok) =>
    withSecurity(
      new Response(JSON.stringify(obj, null, 2), {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
      })
    );
  const sendText = (txt, status = QUEUE_GATEWAY_GRID.http_ok) =>
    withSecurity(
      new Response(txt, {
        status,
        headers: { "content-type": "text/plain; charset=utf-8" },
      })
    );

  if (action === "pulse" || action === "status") {
    if (method !== "GET" && method !== "HEAD") {
      return sendJson({ ok: false, error: "method_not_allowed" }, QUEUE_GATEWAY_GRID.http_method_not_allowed);
    }
    return sendJson(await buildPulseSnapshot(db, env, infraAllowed));
  }

  if (action === "search") {
    let params = Object.fromEntries(url.searchParams.entries());
    if (method === "POST") {
      try {
        const body = await request.json();
        params = { ...params, ...(body || {}) };
      } catch {
        return sendJson({ ok: false, code: "invalid_json" }, QUEUE_GATEWAY_GRID.http_bad_request);
      }
    } else if (method !== "GET") {
      return sendJson({ ok: false, error: "method_not_allowed" }, QUEUE_GATEWAY_GRID.http_method_not_allowed);
    }
    const searchOut = await executeHybridSearch(db, infraAllowed, params);
    if (searchOut.forbidden) {
      return sendJson({ ok: false, code: "forbidden_tier", detail: searchOut.detail }, QUEUE_GATEWAY_GRID.http_forbidden);
    }
    return sendJson(searchOut);
  }

  if (action === "claim") {
    if (method === "GET") {
      const agentId = cleanAgentId(segments[2] || url.searchParams.get("agent") || "volunteer-agent");
      const reqTier = url.searchParams.get("tier");
      const affinityBand = url.searchParams.get("affinity_band");
      const claimOut = await claimNextAuthorizedTask(db, agentId, infraAllowed, reqTier, affinityBand);
      if (claimOut.forbidden) {
        return sendJson(
          { ok: false, code: "forbidden_tier", detail: "infra_private tasks are restricted to server-side infrastructure workers." },
          QUEUE_GATEWAY_GRID.http_forbidden
        );
      }
      const pulse = await buildPulseSnapshot(db, env, infraAllowed);
      if (wantsJson) {
        return sendJson({ ok: true, caller_role: pulse.caller_role, lease: claimOut.task, pulse });
      }
      return sendText(formatClaimBanner(publicUrl, claimOut, pulse));
    }
    if (method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch {
        return sendJson({ ok: false, code: "invalid_json" }, QUEUE_GATEWAY_GRID.http_bad_request);
      }
      const agentId = cleanAgentId(body.agent_id || body.agent || "volunteer-agent");
      const claimOut = await claimNextAuthorizedTask(
        db,
        agentId,
        infraAllowed,
        body.tier || null,
        body.affinity_band || null
      );
      if (claimOut.forbidden) {
        return sendJson(
          { ok: false, code: "forbidden_tier", detail: "infra_private tasks are restricted to server-side infrastructure workers." },
          QUEUE_GATEWAY_GRID.http_forbidden
        );
      }
      const pulse = await buildPulseSnapshot(db, env, infraAllowed);
      return sendJson({ ok: true, caller_role: pulse.caller_role, lease: claimOut.task, pulse });
    }
    return sendJson({ ok: false, error: "method_not_allowed" }, QUEUE_GATEWAY_GRID.http_method_not_allowed);
  }

  if (action === "submit" || action === "enqueue") {
    if (method === "GET") {
      const agentId = cleanAgentId(segments[2] || "volunteer-agent");
      const taskId = segments[3] || "self_seed";
      const rawSlug = segments.slice(4).join("/");
      const parsed = parseGatewaySlug(rawSlug);
      const out = await processSubmissionAndEnqueueVerbs(db, env, publicUrl, infraAllowed, {
        agent_id: agentId,
        task_id: taskId,
        ...parsed,
      });
      if (out.forbidden) {
        return sendJson({ ok: false, code: "forbidden_tier", detail: out.detail }, QUEUE_GATEWAY_GRID.http_forbidden);
      }
      if (wantsJson) return sendJson(out);
      return sendText(
        [
          "=== DURABLE SUBMISSION & VERB ENQUEUE VERIFIED ===",
          `AGENT_ID:              ${out.agent_id}`,
          `COMPLETED_TASK_ID:     ${out.completed_task_id}`,
          `VERIFICATION_CODE:     ${out.verification_code}`,
          `RECEIPT_SHA256:        ${out.receipt_hash}`,
          `STORED_TASK_OBJECTS:   ${out.stored_task_objects.length}`,
          `ENQUEUED_BRANCH_VERBS: ${out.enqueued_followup_verbs.length}`,
          `QUEUE_COUNTS_BY_TIER:  ${JSON.stringify(out.queue_counts_by_tier)}`,
          `NEXT_CLAIM_URL:        ${out.next_claim_url}`,
        ].join("\n")
      );
    }
    if (method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch {
        return sendJson({ ok: false, code: "invalid_json" }, QUEUE_GATEWAY_GRID.http_bad_request);
      }
      const out = await processSubmissionAndEnqueueVerbs(db, env, publicUrl, infraAllowed, body);
      if (out.forbidden) {
        return sendJson({ ok: false, code: "forbidden_tier", detail: out.detail }, QUEUE_GATEWAY_GRID.http_forbidden);
      }
      return sendJson(out);
    }
    return sendJson({ ok: false, error: "method_not_allowed" }, QUEUE_GATEWAY_GRID.http_method_not_allowed);
  }

  return sendJson({ ok: false, code: "unknown_gateway_route", path: url.pathname }, QUEUE_GATEWAY_GRID.http_not_found);
}
