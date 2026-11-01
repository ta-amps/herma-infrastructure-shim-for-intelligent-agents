// Bilateral Agent Transport Shim (`/bridge/*`) for Herma Cloud Worker.
// Translates capability-URL GET turns (for browser-chat agents such as Muse web, Grokbot, and Dot
// whose web tools only issue HTTP GET) and structured POST JSON turns into tracked Tessera
// anonymous sandbox sessions (`env.TESSERA` -> `/v1/session/anonymous`, `/v1/tasks/claim`,
// `/v1/stores/demo.artifacts/records/*`, `/v1/tasks/submit`) plus D1 bilateral transcripts.
// Tessera remains the sole task, lease, storage, and receipt authority.

export const BRIDGE_GRID_CONFIG = Object.freeze({
  schema_id: "herma.bilateral_bridge.grid.v1",
  challenge_addend_a: 1337,
  challenge_addend_b: 29,
  channel_min_len: 8,
  channel_max_len: 48,
  agent_max_len: 40,
  turn_tag_max_len: 16,
  max_slug_chars: 1800,
  max_b64_slug_chars: 10924,
  max_json_chars: 8192,
  max_summary_chars: 240,
  max_subtasks: 12,
  max_generated_tasks: 12,
  max_status_turns: 40,
  max_inbox_batch: 25,
  simhash_bits: 64,
  hex_chars_64b: 16,
  hex_radix: 16,
  hex_byte_pad: 2,
  base64_group_len: 4,
  b64_prefix_len: 4,
  subtasks_prefix_len: 9,
  hash_prefix_chars: 12,
  shingle_width: 3,
  cjk_bigram_width: 2,
  demo_queues: Object.freeze(["demo.ping", "demo.echo", "demo.situate_sample"]),
  curriculum_prompts: Object.freeze([
    "Decompose 'Build a fault-tolerant durable task queue adapter with automatic health-probe failover and idempotent step replay' into 3 atomic subtasks, and propose 1 follow-up edge-case task.",
    "Given a large repository audit request, propose 2 candidate subtask paths (fast static AST scan vs sandboxed test execution), name reusable Python helper modules to stage in a workspace folder, and propose 1 new task.",
    "Design a compact task-fingerprint record (fuzzy shingle sketch + input/output schema ports + tool list) so a smaller open-weight model can retrieve verified code blocks, and propose 1 esoteric stress-test task.",
  ]),
});

const SAFE_CHANNEL_RE = /^[A-Za-z0-9_-]+$/;
const SAFE_AGENT_RE = /^[A-Za-z0-9._-]+$/;
const SECRET_SCRUB_RE =
  /\b(?:tsk_[A-Za-z0-9_-]{8,}|tan_[A-Za-z0-9_-]{8,}|hmk_[A-Za-z0-9_-]{8,}|hk_(?:wrk|ep|inf)_[A-Za-z0-9_-]{16,}|wt_[a-f0-9]{24,}|sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{12,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;

function expectedChallenge() {
  return String(BRIDGE_GRID_CONFIG.challenge_addend_a + BRIDGE_GRID_CONFIG.challenge_addend_b);
}

export function scrubSensitiveText(raw) {
  return String(raw || "")
    .replace(SECRET_SCRUB_RE, "[REDACTED]")
    .trim();
}

function validChannelId(channelId) {
  return (
    typeof channelId === "string" &&
    channelId.length >= BRIDGE_GRID_CONFIG.channel_min_len &&
    channelId.length <= BRIDGE_GRID_CONFIG.channel_max_len &&
    SAFE_CHANNEL_RE.test(channelId)
  );
}

function normalizeAgentName(raw) {
  const cleaned = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, BRIDGE_GRID_CONFIG.agent_max_len);
  return cleaned && SAFE_AGENT_RE.test(cleaned) ? cleaned : "external-agent";
}

async function sha256HexLocal(input) {
  const bytes = new TextEncoder().encode(String(input));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(BRIDGE_GRID_CONFIG.hex_radix).padStart(BRIDGE_GRID_CONFIG.hex_byte_pad, "0")
  ).join("");
}

export async function computeTaskFingerprint(text) {
  const normalized = scrubSensitiveText(text)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s_-]+/gu, " ")
    .replace(/[-_]+/g, " ");
  const baseTokens = normalized.split(/\s+/).filter(Boolean);
  const cjkRunRe = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu;
  const tokens = [];
  for (const tok of baseTokens) {
    tokens.push(tok);
    const cjkRuns = tok.match(cjkRunRe) || [];
    for (const run of cjkRuns) {
      const biW = BRIDGE_GRID_CONFIG.cjk_bigram_width;
      if (run.length > biW) {
        for (let i = 0; i + biW <= run.length; i += 1) {
          tokens.push(run.slice(i, i + biW));
        }
      }
    }
  }
  const shingles = [];
  const width = BRIDGE_GRID_CONFIG.shingle_width;
  if (tokens.length < width) {
    shingles.push(tokens.join(" ") || "empty");
  } else {
    for (let i = 0; i <= tokens.length - width; i += 1) {
      shingles.push(tokens.slice(i, i + width).join(" "));
    }
  }
  const bitCount = BRIDGE_GRID_CONFIG.simhash_bits;
  const weights = new Array(bitCount).fill(0);
  for (const shingle of shingles) {
    const h = await sha256HexLocal(shingle);
    const hi = BigInt("0x" + h.slice(0, BRIDGE_GRID_CONFIG.hex_chars_64b));
    for (let bit = 0; bit < bitCount; bit += 1) {
      const mask = 1n << BigInt(bit);
      weights[bit] += (hi & mask) !== 0n ? 1 : -1;
    }
  }
  let simhash = 0n;
  for (let bit = 0; bit < bitCount; bit += 1) {
    if (weights[bit] >= 0) {
      simhash |= 1n << BigInt(bit);
    }
  }
  return {
    simhash64_hex: simhash.toString(BRIDGE_GRID_CONFIG.hex_radix).padStart(BRIDGE_GRID_CONFIG.hex_chars_64b, "0"),
    token_count: tokens.length,
    shingle_count: shingles.length,
  };
}

function fromBase64Url(b64url) {
  const padded = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const mod = padded.length % BRIDGE_GRID_CONFIG.base64_group_len;
  const full = mod === 0 ? padded : padded + "=".repeat(BRIDGE_GRID_CONFIG.base64_group_len - mod);
  const bin = atob(full);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function parseSlugReply(rawSlug) {
  const rawStr = String(rawSlug || "");
  const isB64Candidate = rawStr.startsWith("b64_") || rawStr.startsWith("b64%5F") || rawStr.startsWith("b64%5f");
  const preCap = isB64Candidate ? BRIDGE_GRID_CONFIG.max_b64_slug_chars : BRIDGE_GRID_CONFIG.max_slug_chars;
  const trimmed = rawStr.slice(0, preCap);
  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    decoded = trimmed;
  }
  if (decoded.startsWith("b64_")) {
    try {
      const unpacked = fromBase64Url(decoded.slice(BRIDGE_GRID_CONFIG.b64_prefix_len)).slice(
        0,
        BRIDGE_GRID_CONFIG.max_json_chars
      );
      if (unpacked.trim().startsWith("{")) {
        const obj = JSON.parse(unpacked);
        return normalizeReplyObject(obj);
      }
      decoded = unpacked.slice(0, BRIDGE_GRID_CONFIG.max_slug_chars);
    } catch {
      decoded = decoded.slice(0, BRIDGE_GRID_CONFIG.max_slug_chars);
    }
  } else {
    decoded = decoded.slice(0, BRIDGE_GRID_CONFIG.max_slug_chars);
  }
  const scrubbedDecoded = scrubSensitiveText(decoded);
  const sections = scrubbedDecoded
    .split("--")
    .map((s) => s.trim())
    .filter(Boolean);
  const subtasks = [];
  const generatedTasks = [];
  const reusableBlocks = [];
  const notes = [];
  const nodeFacet = {
    node_name: "",
    problem: "",
    solution: "",
    input_type: "",
    output_type: "",
    common_use_cases: "",
  };
  for (const sec of sections) {
    const lower = sec.toLowerCase();
    if (lower.startsWith("subtasks-") || lower.startsWith("subtasks:")) {
      const rest = sec.slice(BRIDGE_GRID_CONFIG.subtasks_prefix_len).replace(/[-_]+/g, " ").trim();
      for (const item of rest.split(/[;,|]/).map((x) => x.trim()).filter(Boolean)) {
        if (subtasks.length < BRIDGE_GRID_CONFIG.max_subtasks) subtasks.push(scrubSensitiveText(item));
      }
    } else if (lower.startsWith("subtask-") || lower.startsWith("step-")) {
      const idx = sec.indexOf("-");
      const val = sec.slice(idx + 1).replace(/[-_]+/g, " ").trim();
      if (val && subtasks.length < BRIDGE_GRID_CONFIG.max_subtasks) subtasks.push(scrubSensitiveText(val));
    } else if (lower.startsWith("newtask-") || lower.startsWith("nexttask-")) {
      const idx = sec.indexOf("-");
      const val = sec.slice(idx + 1).replace(/[-_]+/g, " ").trim();
      if (val && generatedTasks.length < BRIDGE_GRID_CONFIG.max_generated_tasks) {
        generatedTasks.push(scrubSensitiveText(val));
      }
    } else if (lower.startsWith("blocks-") || lower.startsWith("block-")) {
      const idx = sec.indexOf("-");
      const val = sec.slice(idx + 1).replace(/[-_]+/g, " ").trim();
      if (val) reusableBlocks.push(scrubSensitiveText(val));
    } else if (lower.startsWith("node-")) {
      const val = sec.slice(sec.indexOf("-") + 1).replace(/[-_]+/g, "_").trim();
      if (val) {
        nodeFacet.node_name = scrubSensitiveText(val);
        reusableBlocks.push(scrubSensitiveText(val));
      }
    } else if (lower.startsWith("prob-") || lower.startsWith("problem-")) {
      nodeFacet.problem = scrubSensitiveText(sec.slice(sec.indexOf("-") + 1).replace(/[-_]+/g, " ").trim());
    } else if (lower.startsWith("sol-") || lower.startsWith("solution-")) {
      nodeFacet.solution = scrubSensitiveText(sec.slice(sec.indexOf("-") + 1).replace(/[-_]+/g, " ").trim());
    } else if (lower.startsWith("in-") || lower.startsWith("intype-")) {
      nodeFacet.input_type = scrubSensitiveText(sec.slice(sec.indexOf("-") + 1).trim());
    } else if (lower.startsWith("out-") || lower.startsWith("outtype-")) {
      nodeFacet.output_type = scrubSensitiveText(sec.slice(sec.indexOf("-") + 1).trim());
    } else if (lower.startsWith("use-") || lower.startsWith("usecase-")) {
      nodeFacet.common_use_cases = scrubSensitiveText(sec.slice(sec.indexOf("-") + 1).replace(/[-_]+/g, " ").trim());
    } else {
      notes.push(scrubSensitiveText(sec.replace(/[-_]+/g, " ").trim()));
    }
  }
  const summary = scrubSensitiveText(notes.join("; ") || scrubbedDecoded.replace(/[-_]+/g, " ").trim());
  const hasNodeSpec = Boolean(nodeFacet.node_name || nodeFacet.problem || nodeFacet.input_type || nodeFacet.output_type);
  return {
    summary: summary || "ack",
    subtasks,
    generated_tasks: generatedTasks,
    reusable_blocks: reusableBlocks,
    node_spec: hasNodeSpec ? nodeFacet : null,
  };
}

function normalizeReplyObject(obj) {
  const safeObj = obj && typeof obj === "object" ? obj : {};
  const rawSubtasks = Array.isArray(safeObj.subtasks)
    ? safeObj.subtasks
    : Array.isArray(safeObj.steps)
      ? safeObj.steps
      : [];
  const subtasks = rawSubtasks
    .slice(0, BRIDGE_GRID_CONFIG.max_subtasks)
    .map((x) => scrubSensitiveText(typeof x === "object" && x ? x.title || x.prompt || JSON.stringify(x) : x));
  const rawGen = Array.isArray(safeObj.generated_tasks)
    ? safeObj.generated_tasks
    : Array.isArray(safeObj.queued_verbs)
      ? safeObj.queued_verbs
      : Array.isArray(safeObj.followup_verbs)
        ? safeObj.followup_verbs
        : Array.isArray(safeObj.next_tasks)
          ? safeObj.next_tasks
          : [];
  const generated = rawGen
    .slice(0, BRIDGE_GRID_CONFIG.max_generated_tasks)
    .map((x) => scrubSensitiveText(typeof x === "object" && x ? x.prompt || x.title || JSON.stringify(x) : x));
  const blocks = Array.isArray(safeObj.reusable_blocks)
    ? safeObj.reusable_blocks.slice(0, BRIDGE_GRID_CONFIG.max_subtasks).map((x) => scrubSensitiveText(x))
    : [];
  const rawNode = safeObj.node_spec && typeof safeObj.node_spec === "object" ? safeObj.node_spec : null;
  const nodeSpec = rawNode
    ? {
        node_name: scrubSensitiveText(rawNode.node_name || rawNode.name || ""),
        problem: scrubSensitiveText(rawNode.problem || ""),
        solution: scrubSensitiveText(rawNode.solution || ""),
        input_type: scrubSensitiveText(rawNode.input_type || ""),
        output_type: scrubSensitiveText(rawNode.output_type || ""),
        common_use_cases: scrubSensitiveText(
          Array.isArray(rawNode.common_use_cases) ? rawNode.common_use_cases.join("; ") : rawNode.common_use_cases || ""
        ),
      }
    : null;
  return {
    summary: scrubSensitiveText(safeObj.summary || safeObj.message || safeObj.reply || "structured-reply"),
    subtasks,
    generated_tasks: generated,
    reusable_blocks: blocks,
    node_spec: nodeSpec,
  };
}

async function ensureBridgeTables(db) {
  if (!db) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS herma_bridge_sessions (
      channel_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      tessera_principal TEXT,
      tessera_namespace TEXT,
      tessera_token TEXT,
      active_task_id TEXT,
      active_fence INTEGER,
      active_queue TEXT,
      turn_seq INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (channel_id, agent_name)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS herma_bridge_turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      turn_seq INTEGER NOT NULL,
      direction TEXT NOT NULL,
      http_method TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      simhash64_hex TEXT NOT NULL,
      tessera_task_id TEXT,
      tessera_receipt_hash TEXT,
      tessera_mode TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS herma_bridge_inbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      target_agent TEXT NOT NULL DEFAULT '*',
      prompt_text TEXT NOT NULL,
      simhash64_hex TEXT NOT NULL,
      claimed_by TEXT,
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS herma_bridge_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      node_name TEXT NOT NULL,
      description TEXT NOT NULL,
      problem TEXT NOT NULL,
      solution TEXT NOT NULL,
      input_type TEXT NOT NULL,
      output_type TEXT NOT NULL,
      common_use_cases TEXT NOT NULL,
      simhash64_hex TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
  ]);
}

function extractClientTelemetry(request) {
  return {
    user_agent: scrubSensitiveText(request.headers.get("user-agent") || "unknown").slice(
      0,
      BRIDGE_GRID_CONFIG.max_summary_chars
    ),
    accept: scrubSensitiveText(request.headers.get("accept") || "").slice(0, BRIDGE_GRID_CONFIG.max_summary_chars),
    cf_colo: String(request.cf?.colo || "edge"),
  };
}

async function callTessera(env, path, { method = "GET", token = null, body = null, idempotencyKey = null } = {}) {
  const headers = {
    accept: "application/json",
    "user-agent": "herma-bilateral-bridge/1.0",
    "x-surface-id": "herma",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  let encodedBody;
  if (body !== null && body !== undefined) {
    headers["content-type"] = "application/json";
    encodedBody = JSON.stringify(body);
  }
  const baseUrl = String(env?.TESSERA_URL || "https://tessera.ta-amps.workers.dev").replace(/\/+$/, "");
  if (env?.TESSERA) {
    const res = await env.TESSERA.fetch(`https://tessera.ta-amps.workers.dev${path}`, {
      method,
      headers,
      body: encodedBody,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data, mode: "live_service_binding" };
  }
  if (env?.BRIDGE_ALLOW_HTTP_TESSERA === "true") {
    const res = await fetch(`${baseUrl}${path}`, { method, headers, body: encodedBody });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data, mode: "live_http" };
  }
  return { ok: false, status: 0, data: {}, mode: "local_simulated" };
}

async function openOrClaimTesseraTask(env, sessionRow, agentName, nextSeq) {
  let token = sessionRow?.tessera_token || null;
  let principal = sessionRow?.tessera_principal || null;
  let namespace = sessionRow?.tessera_namespace || null;
  let mode = "local_simulated";

  if (!token) {
    const sessRes = await callTessera(env, "/v1/session/anonymous", {
      method: "POST",
      body: { agent_label: `bridge-${agentName}`.slice(0, BRIDGE_GRID_CONFIG.agent_max_len) },
    });
    mode = sessRes.mode;
    if (sessRes.ok && sessRes.data?.session_token) {
      token = sessRes.data.session_token;
      principal = sessRes.data.principal_id || null;
      namespace = sessRes.data.namespace || null;
    }
  }

  let taskId = null;
  let fence = null;
  let queueName = BRIDGE_GRID_CONFIG.demo_queues[(nextSeq - 1) % BRIDGE_GRID_CONFIG.demo_queues.length];

  if (token) {
    for (const candidateQueue of BRIDGE_GRID_CONFIG.demo_queues) {
      const claimRes = await callTessera(env, "/v1/tasks/claim", {
        method: "POST",
        token,
        body: { queue: candidateQueue, worker: `bridge-${agentName}` },
      });
      mode = claimRes.mode;
      if (claimRes.ok && claimRes.data?.task_id) {
        taskId = claimRes.data.task_id;
        fence = Number(claimRes.data.fencing_token || 1);
        queueName = candidateQueue;
        break;
      }
    }
  }

  if (!taskId) {
    const fallbackHash = (await sha256HexLocal(`${agentName}:${nextSeq}:${Date.now()}`)).slice(
      0,
      BRIDGE_GRID_CONFIG.hash_prefix_chars
    );
    taskId = `bridge_task_${fallbackHash}`;
    fence = 1;
  }

  return { token, principal, namespace, taskId, fence, queueName, mode };
}

async function submitTesseraTurn(env, sessionRow, agentName, turnSeq, structuredReply, fp) {
  const token = sessionRow?.tessera_token || null;
  const taskId = sessionRow?.active_task_id || null;
  const fence = sessionRow?.active_fence || 1;
  if (token && taskId && !String(taskId).startsWith("bridge_task_")) {
    const artifactKey = `bridge-${agentName}-t${turnSeq}`;
    await callTessera(env, `/v1/stores/demo.artifacts/records/${artifactKey}`, {
      method: "POST",
      token,
      body: {
        expected_version: 0,
        value: {
          category: "noun.eval_run",
          category_id: "noun.eval_run",
          synthetic: true,
          title: `Bilateral bridge turn ${turnSeq} from ${agentName}`,
          agent: agentName,
          turn_seq: turnSeq,
          simhash64_hex: fp.simhash64_hex,
          reply: structuredReply,
        },
      },
    });
    const subRes = await callTessera(env, "/v1/tasks/submit", {
      method: "POST",
      token,
      idempotencyKey: `bridge-sub-${taskId}-${fence}-t${turnSeq}`,
      body: {
        task_id: taskId,
        fencing_token: fence,
        ok: true,
        error: null,
        output: {
          synthetic: true,
          agent: agentName,
          turn_seq: turnSeq,
          simhash64_hex: fp.simhash64_hex,
          summary: structuredReply.summary,
          subtasks: structuredReply.subtasks,
          generated_tasks: structuredReply.generated_tasks,
        },
      },
    });
    if (subRes.ok && subRes.data?.receipt_hash) {
      return {
        receiptHash: subRes.data.receipt_hash,
        mode: subRes.mode,
      };
    }
  }
  const localDigest = await sha256HexLocal(
    JSON.stringify({ agent: agentName, turn_seq: turnSeq, reply: structuredReply, fp })
  );
  return {
    receiptHash: localDigest,
    mode: env?.TESSERA ? "bridge_fallback_digest" : "local_simulated",
  };
}

async function popNextPromptForAgent(db, channelId, agentName, turnIndex) {
  if (db) {
    const row = await db
      .prepare(
        `SELECT id, sender, prompt_text FROM herma_bridge_inbox
         WHERE channel_id = ? AND claimed_by IS NULL
           AND (target_agent = '*' OR target_agent = ?)
           AND sender != ?
         ORDER BY id ASC LIMIT 1`
      )
      .bind(channelId, agentName, agentName)
      .first();
    if (row?.id) {
      await db
        .prepare(`UPDATE herma_bridge_inbox SET claimed_by = ? WHERE id = ? AND claimed_by IS NULL`)
        .bind(agentName, row.id)
        .run();
      return {
        source: `inbox:${row.sender}`,
        prompt: row.prompt_text,
      };
    }
  }
  const prompts = BRIDGE_GRID_CONFIG.curriculum_prompts;
  return {
    source: "curriculum",
    prompt: prompts[(turnIndex - 1) % prompts.length],
  };
}

function bridgeTextResponse(body, withSecurity, status = 200) {
  const resp = new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
  return withSecurity ? withSecurity(resp, { noStore: true }) : resp;
}

function bridgeJsonResponse(data, withSecurity, status = 200) {
  const resp = new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
  return withSecurity ? withSecurity(resp, { noStore: true }) : resp;
}

export async function handleBilateralBridge(request, env, db, publicUrl, { withSecurity } = {}) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const segments = url.pathname
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
  // segments[0] === "bridge"
  await ensureBridgeTables(db);

  if (segments.length === 1) {
    return bridgeTextResponse(
      [
        "# Herma Bilateral Agent Bridge (`Track 2: Push the Frontier`)",
        "",
        "Use a channel URL `/bridge/<channel_id>` to establish two-way communication between",
        "browser/chat agents (Muse web, Grokbot, Dot) or coding harnesses and Tessera durable task queues.",
        `Challenge rule: compute ${BRIDGE_GRID_CONFIG.challenge_addend_a} + ${BRIDGE_GRID_CONFIG.challenge_addend_b} = ${expectedChallenge()} and open:`,
        `${publicUrl}/bridge/<channel_id>/hello/<your-agent-name>/${expectedChallenge()}`,
      ].join("\n"),
      withSecurity
    );
  }

  const channelId = segments[1];
  if (!validChannelId(channelId)) {
    return bridgeJsonResponse(
      { error: "invalid_channel_id", detail: "Channel ID must be 8..48 alphanumeric/hyphen/underscore chars." },
      withSecurity,
      400
    );
  }

  const action = segments[2] || "landing";

  // 1. Read-only channel status & live bilateral transcript (`/bridge/<channel_id>/status`)
  if (action === "status") {
    if (method !== "GET" && method !== "HEAD") {
      return bridgeJsonResponse({ error: "method_not_allowed" }, withSecurity, 405);
    }
    const sessions = db
      ? (
          await db
            .prepare(
              `SELECT agent_name, tessera_principal, tessera_namespace, active_task_id, active_queue, turn_seq, updated_at
               FROM herma_bridge_sessions WHERE channel_id = ? ORDER BY updated_at DESC`
            )
            .bind(channelId)
            .all()
        ).results || []
      : [];
    const turns = db
      ? (
          await db
            .prepare(
              `SELECT turn_seq, agent_name, direction, http_method, summary, payload_json, simhash64_hex,
                      tessera_task_id, tessera_receipt_hash, tessera_mode, created_at
               FROM herma_bridge_turns WHERE channel_id = ? ORDER BY id DESC LIMIT ?`
            )
            .bind(channelId, BRIDGE_GRID_CONFIG.max_status_turns)
            .all()
        ).results || []
      : [];
    const inbox = db
      ? (
          await db
            .prepare(
              `SELECT id, sender, target_agent, prompt_text, simhash64_hex, claimed_by, created_at
               FROM herma_bridge_inbox WHERE channel_id = ? ORDER BY id DESC LIMIT ?`
            )
            .bind(channelId, BRIDGE_GRID_CONFIG.max_inbox_batch)
            .all()
        ).results || []
      : [];
    const nodes = db
      ? (
          await db
            .prepare(
              `SELECT id, agent_name, node_name, description, problem, solution, input_type, output_type, common_use_cases, simhash64_hex, created_at
               FROM herma_bridge_nodes WHERE channel_id = ? ORDER BY id DESC LIMIT ?`
            )
            .bind(channelId, BRIDGE_GRID_CONFIG.max_inbox_batch)
            .all()
        ).results || []
      : [];
    return bridgeJsonResponse(
      {
        ok: true,
        schema: BRIDGE_GRID_CONFIG.schema_id,
        channel_id: channelId,
        connected_agents: sessions.length,
        sessions,
        inbox,
        registered_nodes: nodes,
        recent_turns: turns.map((t) => ({
          ...t,
          payload: (() => {
            try {
              return JSON.parse(t.payload_json);
            } catch {
              return {};
            }
          })(),
          payload_json: undefined,
        })),
      },
      withSecurity
    );
  }

  // 1b. Interchangeable Node Catalog Query (`GET /bridge/<channel_id>/nodes?in=<type>&out=<type>&q=<problem>`)
  if (action === "nodes") {
    if (method !== "GET" && method !== "HEAD") {
      return bridgeJsonResponse({ error: "method_not_allowed" }, withSecurity, 405);
    }
    const wantIn = (url.searchParams.get("in") || "").toLowerCase().trim();
    const wantOut = (url.searchParams.get("out") || "").toLowerCase().trim();
    const queryText = (url.searchParams.get("q") || "").toLowerCase().trim();
    const allNodes = db
      ? (
          await db
            .prepare(
              `SELECT id, channel_id, agent_name, node_name, description, problem, solution, input_type, output_type, common_use_cases, simhash64_hex, created_at
               FROM herma_bridge_nodes ORDER BY id DESC LIMIT ?`
            )
            .bind(BRIDGE_GRID_CONFIG.max_status_turns)
            .all()
        ).results || []
      : [];
    const filtered = allNodes.filter((n) => {
      if (wantIn && !String(n.input_type).toLowerCase().includes(wantIn)) return false;
      if (wantOut && !String(n.output_type).toLowerCase().includes(wantOut)) return false;
      if (queryText) {
        const hay = `${n.node_name} ${n.description} ${n.problem} ${n.solution} ${n.common_use_cases}`.toLowerCase();
        return queryText.split(/\s+/).some((tok) => hay.includes(tok));
      }
      return true;
    });
    return bridgeJsonResponse(
      { ok: true, channel_id: channelId, count: filtered.length, nodes: filtered },
      withSecurity
    );
  }

  // 2. Landing page (`/bridge/<channel_id>`) -- safe against link-preview unfurlers
  if (action === "landing") {
    const sumTarget = expectedChallenge();
    return bridgeTextResponse(
      [
        `# Bilateral Bridge Channel: ${channelId}`,
        `STATUS: READY_FOR_HANDSHAKE`,
        `CHALLENGE: Compute ${BRIDGE_GRID_CONFIG.challenge_addend_a} + ${BRIDGE_GRID_CONFIG.challenge_addend_b} (= ${sumTarget}).`,
        "",
        "## Step 1 (Connect & Claim Durable Task #1)",
        "Fetch this exact GET URL (replace <agent> with muse, grokbot, dot, or your model name):",
        `${publicUrl}/bridge/${channelId}/hello/<agent>/${sumTarget}`,
        "",
        "## Live Status JSON",
        `${publicUrl}/bridge/${channelId}/status`,
      ].join("\n"),
      withSecurity
    );
  }

  // 3. Operator / Peer Batch Task Seed Inbox (`POST /bridge/<channel_id>/inbox` or `GET /bridge/<channel_id>/seed/<sender>/<slug>`)
  if (action === "inbox" || action === "seed") {
    let items = [];
    let sender = "operator";
    let targetAgent = "*";
    if (method === "POST") {
      const rawText = (await request.text()).slice(0, BRIDGE_GRID_CONFIG.max_json_chars);
      let body = {};
      try {
        body = JSON.parse(rawText);
      } catch {
        body = { prompts: [rawText] };
      }
      sender = normalizeAgentName(body.sender || "operator");
      targetAgent = body.target_agent === "*" || !body.target_agent ? "*" : normalizeAgentName(body.target_agent);
      if (Array.isArray(body.prompts)) {
        items = body.prompts.slice(0, BRIDGE_GRID_CONFIG.max_inbox_batch);
      } else if (typeof body.text === "string") {
        items = body.text
          .split(/\n+/)
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, BRIDGE_GRID_CONFIG.max_inbox_batch);
      } else if (typeof body.prompt === "string") {
        items = [body.prompt];
      }
    } else if (method === "GET") {
      sender = normalizeAgentName(segments[3] || "operator");
      const rawPrompt = scrubSensitiveText(
        decodeURIComponent(segments.slice(4).join("/") || url.searchParams.get("prompt") || "")
      )
        .replace(/[-_]+/g, " ")
        .trim();
      if (rawPrompt) items = [rawPrompt];
    } else {
      return bridgeJsonResponse({ error: "method_not_allowed" }, withSecurity, 405);
    }

    const inserted = [];
    const now = new Date().toISOString();
    for (const rawPrompt of items) {
      const cleanPrompt = scrubSensitiveText(rawPrompt).slice(0, BRIDGE_GRID_CONFIG.max_slug_chars);
      if (!cleanPrompt) continue;
      const fp = await computeTaskFingerprint(cleanPrompt);
      if (db) {
        await db
          .prepare(
            `INSERT INTO herma_bridge_inbox (channel_id, sender, target_agent, prompt_text, simhash64_hex, claimed_by, created_at)
             VALUES (?, ?, ?, ?, ?, NULL, ?)`
          )
          .bind(channelId, sender, targetAgent, cleanPrompt, fp.simhash64_hex, now)
          .run();
      }
      inserted.push({ prompt: cleanPrompt, simhash64_hex: fp.simhash64_hex });
    }
    return bridgeJsonResponse(
      { ok: true, channel_id: channelId, sender, target_agent: targetAgent, queued_count: inserted.length, items: inserted },
      withSecurity
    );
  }

  // 4. Turn 1 Handshake (`GET /bridge/<channel_id>/hello/<agent_name>/<challenge>`)
  if (action === "hello") {
    if (method !== "GET" && method !== "POST") {
      return bridgeJsonResponse({ error: "method_not_allowed" }, withSecurity, 405);
    }
    const agentName = normalizeAgentName(segments[3] || url.searchParams.get("agent"));
    const challengeProvided = String(segments[4] || url.searchParams.get("code") || "").trim();
    if (challengeProvided !== expectedChallenge()) {
      return bridgeTextResponse(
        [
          "HANDSHAKE_CHALLENGE_MISMATCH",
          `Expected challenge code ${BRIDGE_GRID_CONFIG.challenge_addend_a} + ${BRIDGE_GRID_CONFIG.challenge_addend_b} = ${expectedChallenge()}.`,
          `Open: ${publicUrl}/bridge/${channelId}/hello/${agentName}/${expectedChallenge()}`,
        ].join("\n"),
        withSecurity,
        400
      );
    }

    const existing = db
      ? await db
          .prepare(`SELECT * FROM herma_bridge_sessions WHERE channel_id = ? AND agent_name = ?`)
          .bind(channelId, agentName)
          .first()
      : null;
    const nextSeq = Number(existing?.turn_seq || 0) + 1;
    const claimed = await openOrClaimTesseraTask(env, existing, agentName, nextSeq);
    const taskSpec = await popNextPromptForAgent(db, channelId, agentName, nextSeq);
    const fp = await computeTaskFingerprint(taskSpec.prompt);
    const now = new Date().toISOString();

    if (db) {
      await db
        .prepare(
          `INSERT INTO herma_bridge_sessions
             (channel_id, agent_name, tessera_principal, tessera_namespace, tessera_token, active_task_id, active_fence, active_queue, turn_seq, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(channel_id, agent_name) DO UPDATE SET
             tessera_principal = excluded.tessera_principal,
             tessera_namespace = excluded.tessera_namespace,
             tessera_token = excluded.tessera_token,
             active_task_id = excluded.active_task_id,
             active_fence = excluded.active_fence,
             active_queue = excluded.active_queue,
             turn_seq = excluded.turn_seq,
             updated_at = excluded.updated_at`
        )
        .bind(
          channelId,
          agentName,
          claimed.principal,
          claimed.namespace,
          claimed.token,
          claimed.taskId,
          claimed.fence,
          claimed.queueName,
          nextSeq,
          now
        )
        .run();

      await db
        .prepare(
          `INSERT INTO herma_bridge_turns
             (channel_id, agent_name, turn_seq, direction, http_method, summary, payload_json, simhash64_hex, tessera_task_id, tessera_receipt_hash, tessera_mode, created_at)
           VALUES (?, ?, ?, 'inbound_hello', ?, ?, ?, ?, ?, NULL, ?, ?)`
        )
        .bind(
          channelId,
          agentName,
          nextSeq,
          method,
          `Handshake connected (${agentName}) -> claimed ${claimed.taskId}`,
          JSON.stringify({
            prompt_source: taskSpec.source,
            assigned_prompt: taskSpec.prompt,
            client_telemetry: extractClientTelemetry(request),
          }),
          fp.simhash64_hex,
          claimed.taskId,
          claimed.mode,
          now
        )
        .run();
    }

    const turnTag = `t${nextSeq}`;
    const replyUrlTemplate = `${publicUrl}/bridge/${channelId}/reply/${agentName}/${turnTag}/<your-hyphenated-reply>`;
    const replyUrlExample = `${publicUrl}/bridge/${channelId}/reply/${agentName}/${turnTag}/ack-online--subtask-validate-outbox-schema--subtask-probe-broker-health--subtask-replay-idempotent-lease--newtask-chaos-drill-failover`;

    return bridgeTextResponse(
      [
        "BILATERAL_STATUS: CONNECTED",
        `SERVER_UTC: ${now}`,
        `CHANNEL_ID: ${channelId}`,
        `AGENT_NAME: ${agentName}`,
        `TURN_SEQ: ${nextSeq}`,
        `TESSERA_MODE: ${claimed.mode}`,
        `TESSERA_PRINCIPAL: ${claimed.principal || "local-sandbox"}`,
        `CLAIMED_TASK_ID: ${claimed.taskId}`,
        `FENCING_TOKEN: ${claimed.fence}`,
        `TASK_SIMHASH64: ${fp.simhash64_hex}`,
        `TASK_SOURCE: ${taskSpec.source}`,
        "",
        "## ASSIGNED DURABLE TASK (SOLVE & SEND BACK TO SERVER)",
        taskSpec.prompt,
        "",
        "## HOW TO SEND YOUR REPLY BACK TO THE SERVER (COMPLETE BILATERAL ROUND-TRIP)",
        "Option A (Universal GET URL -- works in Muse web, Grokbot, Dot, and any browser-enabled chat):",
        "Open ONE URL formatted with hyphens `-` for spaces and `--` between sections (only letters, numbers, and hyphens):",
        `Template: ${replyUrlTemplate}`,
        `Example structure: ${replyUrlExample}`,
        "IMPORTANT: Replace the example words with YOUR OWN actual subtasks and new task, then FETCH/OPEN that URL now and report the `VERIFICATION_CODE` and `TESSERA_RECEIPT_SHA256` it returns!",
        "",
        "Option B (If you have Python / curl / HTTP POST tools):",
        `POST JSON to ${publicUrl}/bridge/${channelId}/reply with:`,
        `{"agent":"${agentName}","turn_tag":"${turnTag}","summary":"...","subtasks":["..."],"generated_tasks":["..."],"reusable_blocks":["..."]}`,
      ].join("\n"),
      withSecurity
    );
  }

  // 5. Turn 2..N Reply & Continuous Bilateral Loop (`GET /bridge/<channel_id>/reply/<agent>/<turn_tag>/<slug>` or `POST /bridge/<channel_id>/reply`)
  if (action === "reply") {
    let agentName = "external-agent";
    let turnTag = "t1";
    let structuredReply;

    if (method === "POST") {
      const rawBody = (await request.text()).slice(0, BRIDGE_GRID_CONFIG.max_json_chars);
      let parsed = {};
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        parsed = { summary: rawBody };
      }
      agentName = normalizeAgentName(parsed.agent || segments[3] || url.searchParams.get("agent"));
      turnTag = String(parsed.turn_tag || segments[4] || "t1").slice(0, BRIDGE_GRID_CONFIG.turn_tag_max_len);
      structuredReply = normalizeReplyObject(parsed);
    } else if (method === "GET") {
      agentName = normalizeAgentName(segments[3] || url.searchParams.get("agent"));
      turnTag = String(segments[4] || url.searchParams.get("turn") || "t1").slice(
        0,
        BRIDGE_GRID_CONFIG.turn_tag_max_len
      );
      const rawSlug = segments.slice(5).join("/") || url.searchParams.get("msg") || url.searchParams.get("reply") || "ack";
      structuredReply = parseSlugReply(rawSlug);
    } else {
      return bridgeJsonResponse({ error: "method_not_allowed" }, withSecurity, 405);
    }

    const existing = db
      ? await db
          .prepare(`SELECT * FROM herma_bridge_sessions WHERE channel_id = ? AND agent_name = ?`)
          .bind(channelId, agentName)
          .first()
      : null;

    const currentSeq = Number(existing?.turn_seq || 1);
    const fp = await computeTaskFingerprint(
      [
        structuredReply.summary,
        ...structuredReply.subtasks,
        ...structuredReply.generated_tasks,
        ...structuredReply.reusable_blocks,
      ].join(" ")
    );
    const submitResult = await submitTesseraTurn(env, existing, agentName, currentSeq, structuredReply, fp);
    const now = new Date().toISOString();

    // Enqueue any agent-generated follow-up tasks into the shared channel inbox so peers or next turns can solve them!
    if (db && structuredReply.generated_tasks.length > 0) {
      for (const genTask of structuredReply.generated_tasks) {
        const genFp = await computeTaskFingerprint(genTask);
        await db
          .prepare(
            `INSERT INTO herma_bridge_inbox (channel_id, sender, target_agent, prompt_text, simhash64_hex, claimed_by, created_at)
             VALUES (?, ?, '*', ?, ?, NULL, ?)`
          )
          .bind(channelId, agentName, genTask, genFp.simhash64_hex, now)
          .run();
      }
    }

    // Persist any 8-facet interchangeable node descriptor contributed by the agent!
    if (db && structuredReply.node_spec) {
      const ns = structuredReply.node_spec;
      const nodeFp = await computeTaskFingerprint(
        `${ns.node_name} ${ns.problem} ${ns.solution} ${ns.input_type} ${ns.output_type} ${ns.common_use_cases}`
      );
      await db
        .prepare(
          `INSERT INTO herma_bridge_nodes
             (channel_id, agent_name, node_name, description, problem, solution, input_type, output_type, common_use_cases, simhash64_hex, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          channelId,
          agentName,
          ns.node_name || structuredReply.reusable_blocks[0] || `node_t${currentSeq}`,
          structuredReply.summary.slice(0, BRIDGE_GRID_CONFIG.max_summary_chars),
          ns.problem || structuredReply.summary.slice(0, BRIDGE_GRID_CONFIG.max_summary_chars),
          ns.solution || structuredReply.subtasks.join("; "),
          ns.input_type || "json_object",
          ns.output_type || "json_object",
          ns.common_use_cases || "durable_task_pipeline",
          nodeFp.simhash64_hex,
          now
        )
        .run();
    }

    // Prepare the next task lease so bilateral conversation can continue seamlessly on `t<currentSeq + 1>`
    const nextSeq = currentSeq + 1;
    const nextClaim = await openOrClaimTesseraTask(env, existing, agentName, nextSeq);
    const nextPrompt = await popNextPromptForAgent(db, channelId, agentName, nextSeq);

    if (db) {
      await db
        .prepare(
          `INSERT INTO herma_bridge_turns
             (channel_id, agent_name, turn_seq, direction, http_method, summary, payload_json, simhash64_hex, tessera_task_id, tessera_receipt_hash, tessera_mode, created_at)
           VALUES (?, ?, ?, 'inbound_reply', ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          channelId,
          agentName,
          currentSeq,
          method,
          structuredReply.summary.slice(0, BRIDGE_GRID_CONFIG.max_summary_chars),
          JSON.stringify({
            turn_tag: turnTag,
            ...structuredReply,
            client_telemetry: extractClientTelemetry(request),
          }),
          fp.simhash64_hex,
          existing?.active_task_id || nextClaim.taskId,
          submitResult.receiptHash,
          submitResult.mode,
          now
        )
        .run();

      await db
        .prepare(
          `INSERT INTO herma_bridge_sessions
             (channel_id, agent_name, tessera_principal, tessera_namespace, tessera_token, active_task_id, active_fence, active_queue, turn_seq, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(channel_id, agent_name) DO UPDATE SET
             active_task_id = excluded.active_task_id,
             active_fence = excluded.active_fence,
             active_queue = excluded.active_queue,
             turn_seq = excluded.turn_seq,
             updated_at = excluded.updated_at`
        )
        .bind(
          channelId,
          agentName,
          existing?.tessera_principal || nextClaim.principal,
          existing?.tessera_namespace || nextClaim.namespace,
          existing?.tessera_token || nextClaim.token,
          nextClaim.taskId,
          nextClaim.fence,
          nextClaim.queueName,
          nextSeq,
          now
        )
        .run();
    }

    const verificationCode = submitResult.receiptHash.slice(0, BRIDGE_GRID_CONFIG.hash_prefix_chars);
    const nextTurnTag = `t${nextSeq}`;

    if (method === "POST" && (request.headers.get("accept") || "").includes("application/json")) {
      return bridgeJsonResponse(
        {
          ok: true,
          bilateral_status: "ROUNDTRIP_VERIFIED",
          channel_id: channelId,
          agent_name: agentName,
          completed_turn_seq: currentSeq,
          verification_code: verificationCode,
          tessera_receipt_sha256: submitResult.receiptHash,
          tessera_mode: submitResult.mode,
          reply_simhash64: fp.simhash64_hex,
          parsed_reply: structuredReply,
          next_turn: {
            turn_tag: nextTurnTag,
            claimed_task_id: nextClaim.taskId,
            prompt_source: nextPrompt.source,
            prompt: nextPrompt.prompt,
            reply_get_url_template: `${publicUrl}/bridge/${channelId}/reply/${agentName}/${nextTurnTag}/<your-hyphenated-reply>`,
          },
        },
        withSecurity
      );
    }

    return bridgeTextResponse(
      [
        "BILATERAL_STATUS: ROUNDTRIP_VERIFIED",
        `VERIFICATION_CODE: ${verificationCode}`,
        `TESSERA_RECEIPT_SHA256: ${submitResult.receiptHash}`,
        `TESSERA_MODE: ${submitResult.mode}`,
        `CHANNEL_ID: ${channelId}`,
        `AGENT_NAME: ${agentName}`,
        `COMPLETED_TURN: ${currentSeq}`,
        `REPLY_SIMHASH64: ${fp.simhash64_hex}`,
        `PARSED_SUBTASKS_COUNT: ${structuredReply.subtasks.length}`,
        `PARSED_NEWTASKS_COUNT: ${structuredReply.generated_tasks.length}`,
        "",
        "## NEXT QUEUED TASK READY (IF USER ASKS YOU TO CONTINUE)",
        `NEXT_TURN_TAG: ${nextTurnTag}`,
        `NEXT_TASK_SOURCE: ${nextPrompt.source}`,
        `NEXT_TASK_PROMPT: ${nextPrompt.prompt}`,
        `NEXT_REPLY_URL: ${publicUrl}/bridge/${channelId}/reply/${agentName}/${nextTurnTag}/<your-hyphenated-reply>`,
      ].join("\n"),
      withSecurity
    );
  }

  return bridgeJsonResponse({ error: "unknown_bridge_action", action }, withSecurity, 404);
}
