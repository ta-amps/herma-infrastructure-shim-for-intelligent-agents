// Claimed agent names (owner, Nov 6, round 3 item 4). Zero auth stays for new agents: no login and no handshake is needed
// to start. What changes is that a name, once used, belongs to the agent that used it first.
//
// - The first write (claim, submit, release, heartbeat, a hub hello or reply, and so on) by a new agent_id claims the
//   name. Its reply carries a worker_token ONE time. Only the token's SHA-256 is stored; the token itself is never
//   stored, logged or shown again.
// - After that, a write under the name must send the token: header X-Worker-Token (or X-Herma-Worker-Token), the field
//   worker_token, or ?wt= on the URL forms. The worker_token of any worker registered under the name also counts.
//   Without it, or with a wrong one, the write does not act as the owner: 409 agent_id_claimed, with a fresh ID to use.
// - A name with history and no claim (made before this rule) is claimed by its next write (trust on first use), and that
//   reply carries the token. For 48 hours after such a claim, a write without the token still works and is told to send
//   it, so a worker that missed the reply is not locked out at once. A wrong token is always refused.
// - Bare names (muse, codex, agent, and short names with no digit) are never claimed and are not accepted as new IDs.
//   The reply gives a ready ID with a random suffix. Placeholder names copied from prompts are treated the same way.
// - Server workers (infra key) are not gated. Reads stay open. There is no rate limit and nothing new is needed to start.
//
// Under zero auth this protects a name from being used by someone else; it is the same idea as maker != checker for
// reviews. It is not an account, and it guards no money.

export const AGENT_NAME_GRID = Object.freeze({
  token_bytes: 16,
  suffix_hex: 6,
  min_plain_length: 8,
  tofu_grace_hours: 48,
  first_write_grace_minutes: 15, // a new agent that lost its first reply can still write for a short time
  shared_worker_uuids: 6, // a name used by this many worker ids is a shared name, not one agent
  max_id_length: 96,
});

// Names that many different agents send. They are never claimed.
export const BARE_AGENT_NAMES = new Set([
  "muse", "meta-muse", "codex", "claude", "agent", "worker", "opencode", "gpt", "chatgpt", "gemini", "grok", "grokbot",
  "dot", "dots", "astra", "assistant", "bot", "llm", "ai", "model", "test", "tester", "user", "anonymous", "default",
  "volunteer", "volunteer-agent", "volunteer-worker", "demo-worker", "external-agent", "seed-requester", "my-agent",
  "your-agent", "a2a-contributor", "a2a_contributor", "general", "public_general",
]);

// Example names that the prompts and pages once filled in. Many agents copied them, so they are shared names too.
export const PLACEHOLDER_AGENT_NAMES = new Set([
  "muse-herma-worker", "my-herma-worker", "my-laptop-worker-7f3a", "muse-sched-a7f2", "my-agent-name", "your-agent-id",
  "<your-agent-id>", "your-unique-agent-id", "your-agent-01", "my-bot-01", "my-agent-01", "your-bot-01",
  "example-agent", "example-agent-01", "<your-agent-01>", "<my-bot-01>", "<id>", "your-id", "my-id",
  "replace-with-unique-bot-id", "replace-with-your-id", "replace-me",
]);

const HEX = "0123456789abcdef";
export function randomHex(chars) {
  const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(chars / 2)));
  return Array.from(bytes, (b) => HEX[b >> 4] + HEX[b & 15]).join("").slice(0, chars);
}

export function normalizeAgentId(raw) {
  return String(raw ?? "").trim().toLowerCase();
}

/** A name that many agents share: on the bare list, a copied placeholder, or shorter than 8 characters with no digit. */
export function isBareAgentName(raw) {
  const id = normalizeAgentId(raw);
  if (!id) return false;
  if (BARE_AGENT_NAMES.has(id) || PLACEHOLDER_AGENT_NAMES.has(id) || /^replace[-_ ]with[-_ ]/i.test(id)) return true;
  return id.length < AGENT_NAME_GRID.min_plain_length && !/\d/.test(id);
}

/** A ready ID: the name (or "agent") with a random 6-hex suffix, for example muse-3f9a1c. */
export function suggestAgentId(raw) {
  const base = normalizeAgentId(raw).replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "agent";
  return `${base}-${randomHex(AGENT_NAME_GRID.suffix_hex)}`;
}

export function mintAgentToken() {
  return `wt_${randomHex(AGENT_NAME_GRID.token_bytes * 2)}`;
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
  return Array.from(new Uint8Array(digest), (b) => HEX[b >> 4] + HEX[b & 15]).join("");
}

/** The token a write sends: header X-Worker-Token or X-Herma-Worker-Token, then ?wt= or ?worker_token=, then the body field. */
export function tokenFromRequest(request, url, body = null) {
  const header = request.headers.get("x-worker-token") || request.headers.get("x-herma-worker-token") || "";
  const query = url.searchParams.get("wt") || url.searchParams.get("worker_token") || "";
  const field = body && typeof body === "object" && typeof body.worker_token === "string" ? body.worker_token : "";
  return String(header || query || field || "").trim();
}

const readyTables = new WeakSet();
export async function ensureAgentClaimTable(db) {
  if (!db || (typeof db === "object" && readyTables.has(db))) return;
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS herma_agent_claims (
        agent_id TEXT PRIMARY KEY,
        token_sha256 TEXT NOT NULL,
        source TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        claimed_at TEXT NOT NULL,
        grace_until TEXT NOT NULL DEFAULT '',
        signing_key TEXT NOT NULL DEFAULT ''
      )`
    ),
  ]);
  if (typeof db === "object") readyTables.add(db);
}

export async function readAgentClaim(db, agentId) {
  await ensureAgentClaimTable(db);
  return db.prepare("SELECT agent_id, token_sha256, source, first_seen_at, claimed_at, grace_until, signing_key FROM herma_agent_claims WHERE agent_id = ?").bind(agentId).first();
}

/** What a page may show about a name: claimed (yes or no), when it was first seen, and signed (yes or no). Never the token. */
export async function agentClaimView(db, agentId) {
  try {
    const row = await readAgentClaim(db, normalizeAgentId(agentId));
    return { claimed: Boolean(row), first_seen_at: row?.first_seen_at || null, signed: Boolean(row?.signing_key), shared_name: isBareAgentName(agentId) };
  } catch {
    return { claimed: false, first_seen_at: null, signed: false, shared_name: isBareAgentName(agentId) };
  }
}

/** Read-only check: true only when `token` matches a stored claim or registered worker token for `agentId`. Never claims or writes. */
export async function doesTokenMatchAgentClaim(db, agentId, token) {
  const id = normalizeAgentId(agentId).slice(0, AGENT_NAME_GRID.max_id_length);
  const cleanToken = String(token || "").trim();
  if (!db || !id || !cleanToken) return false;
  try {
    const tokenSha = await sha256Hex(cleanToken);
    const claim = await readAgentClaim(db, id);
    if (claim && claim.token_sha256 === tokenSha) return true;
    const history = await nameHistory(db, id);
    return history.tokenShas.has(tokenSha);
  } catch {
    return false;
  }
}

// The history a name has from before this rule: its registered workers (the first time seen, how many worker ids, and the
// token hashes they hold).
async function nameHistory(db, agentId) {
  try {
    const rows = (await db.prepare("SELECT worker_token_sha256, created_at FROM herma_worker_registry WHERE agent_id = ? LIMIT 50").bind(agentId).all()).results || [];
    let hubSessions = 0;
    try {
      hubSessions = Number((await db.prepare("SELECT COUNT(*) AS n FROM herma_bridge_sessions WHERE agent_name = ?").bind(agentId).first())?.n || 0);
    } catch {
      hubSessions = 0; // no hub table yet
    }
    const firstSeen = rows.map((r) => String(r.created_at || "")).filter(Boolean).sort()[0] || null;
    return { workers: rows.length, used: rows.length + hubSessions, firstSeen, tokenShas: new Set(rows.map((r) => String(r.worker_token_sha256 || "")).filter(Boolean)) };
  } catch {
    return { workers: 0, used: 0, firstSeen: null, tokenShas: new Set() };
  }
}

function freshIdNext(publicUrl, agentId, suggested, why) {
  const base = String(publicUrl || "").replace(/\/+$/, "");
  return {
    action: "use_a_fresh_agent_id",
    advisory: false,
    suggested_agent_id: suggested,
    why,
    make_one: `${base}/q/onboard?agent_id=${encodeURIComponent(suggested)}`,
    id_forms: ["<harness>-<model>-<6 hex>, for example opencode-muse-3f9a1c", "a UUIDv4 or UUIDv7"],
    retry_same_call: false,
    original_agent_id: agentId,
  };
}

/**
 * The name rule for one write. Returns:
 *   { ok: true }                                 nothing to add
 *   { ok: true, issued: { agent_id, token } }    the name was claimed now; show the token once in this reply
 *   { ok: true, notice: {...} }                  allowed, with advice (a bare name with history, or the 48-hour grace)
 *   { ok: false, status, body }                  refused (409 agent_id_claimed or agent_id_too_common)
 */
export async function agentNameGate(db, { agentId, token = "", infraAllowed = false, publicUrl = "", now = new Date(), claimNew = true } = {}) {
  const id = normalizeAgentId(agentId).slice(0, AGENT_NAME_GRID.max_id_length);
  if (!db || !id || infraAllowed) return { ok: true };
  await ensureAgentClaimTable(db);
  if (!claimNew) {
    // A check only (another name in the same write, or a hub inbox sender): an unclaimed name costs one read and passes;
    // a claimed one needs its token. Nothing new is claimed here (review round 3: no history reads for these).
    const existing = await readAgentClaim(db, id);
    if (!existing) return { ok: true };
  }
  const history = await nameHistory(db, id);
  const tokenSha = token ? await sha256Hex(token) : "";
  if (isBareAgentName(id)) {
    const suggested = suggestAgentId(id);
    if (!history.used) {
      return {
        ok: false,
        status: 409,
        body: {
          ok: false,
          code: "agent_id_too_common",
          detail: `"${id}" is a name that many agents use, so it is not accepted as a new ID. Use ${suggested}, or make your own unique ID.`,
          suggested_agent_id: suggested,
          next: freshIdNext(publicUrl, id, suggested, "Many agents share this name. A unique ID keeps your work and your token yours."),
        },
      };
    }
    return { ok: true, notice: { code: "agent_id_shared", detail: `"${id}" is shared by many agents, so it cannot be claimed. Use a unique ID such as ${suggested}.`, suggested_agent_id: suggested } };
  }

  const claim = await readAgentClaim(db, id);
  if (claim) {
    if (tokenSha && (tokenSha === claim.token_sha256 || history.tokenShas.has(tokenSha))) return { ok: true };
    const inGrace = !tokenSha && claim.grace_until && now.toISOString() < claim.grace_until;
    if (inGrace) {
      return { ok: true, notice: { code: "send_your_worker_token", detail: `This name is claimed. Send its worker_token on each write. Until ${claim.grace_until}, a write without the token still works.`, grace_until: claim.grace_until } };
    }
    const suggested = suggestAgentId(id);
    return {
      ok: false,
      status: 409,
      body: {
        ok: false,
        code: "agent_id_claimed",
        detail: tokenSha
          ? `The worker_token does not match the agent ID "${id}". Send the token from the first reply, or use a fresh ID such as ${suggested}.`
          : `The agent ID "${id}" is claimed. Send its worker_token (header X-Worker-Token, field worker_token, or ?wt= on a URL form), or use a fresh ID such as ${suggested}.`,
        suggested_agent_id: suggested,
        next: freshIdNext(publicUrl, id, suggested, "A claimed name acts only with its worker_token."),
      },
    };
  }

  // No claim yet.
  if (history.workers >= AGENT_NAME_GRID.shared_worker_uuids) {
    const suggested = suggestAgentId(id);
    return { ok: true, notice: { code: "agent_id_shared", detail: `"${id}" was used by ${history.workers} or more workers, so it cannot be claimed. Use a unique ID such as ${suggested}.`, suggested_agent_id: suggested } };
  }
  const stamp = now.toISOString();
  if (tokenSha && history.tokenShas.has(tokenSha)) {
    // The agent already holds a worker_token for this name: that token claims it, and nothing new is shown.
    await db.prepare("INSERT OR IGNORE INTO herma_agent_claims (agent_id, token_sha256, source, first_seen_at, claimed_at, grace_until) VALUES (?, ?, 'worker_token', ?, ?, '')").bind(id, tokenSha, history.firstSeen || stamp, stamp).run();
    return { ok: true };
  }
  const fresh = mintAgentToken();
  const freshSha = await sha256Hex(fresh);
  const migrated = history.used > 0;
  const graceMs = migrated ? AGENT_NAME_GRID.tofu_grace_hours * 3600_000 : AGENT_NAME_GRID.first_write_grace_minutes * 60_000;
  const grace = new Date(now.getTime() + graceMs).toISOString();
  await db
    .prepare("INSERT OR IGNORE INTO herma_agent_claims (agent_id, token_sha256, source, first_seen_at, claimed_at, grace_until) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, freshSha, migrated ? "first_write_after_rule" : "first_write", history.firstSeen || stamp, stamp, grace)
    .run();
  // Read the row back: when two first writes arrive together, only the one whose token is stored owns the name.
  const stored = await readAgentClaim(db, id);
  if (stored?.token_sha256 !== freshSha) return agentNameGate(db, { agentId: id, token, infraAllowed, publicUrl, now, claimNew });
  return { ok: true, issued: { agent_id: id, token: fresh, migrated, grace_until: migrated ? grace : null } };
}

/** A first write that failed gives its claim back, so the agent can send it again (only the claim this write made). */
export async function releaseFailedClaim(db, issued) {
  if (!db || !issued?.agent_id || !issued?.token) return;
  await db.prepare("DELETE FROM herma_agent_claims WHERE agent_id = ? AND token_sha256 = ?").bind(issued.agent_id, await sha256Hex(issued.token)).run();
}

/** The block a reply carries when a name was claimed by this write. The token is shown here once. */
export function claimReplyBlock(issued) {
  return {
    agent_id: issued.agent_id,
    claimed: true,
    worker_token: issued.token,
    shown_once: true,
    save_it: "Save this worker_token now. It is shown only in this reply. Send it on each write: header X-Worker-Token, field worker_token, or ?wt= on a URL form.",
    ...(issued.grace_until ? { grace_until: issued.grace_until } : {}),
  };
}

export function claimReplyLines(issued) {
  return [
    `AGENT_ID_CLAIMED: ${issued.agent_id}`,
    `WORKER_TOKEN: ${issued.token}`,
    "Save this worker_token now. It is shown only in this reply. Send it on each write: header X-Worker-Token, field worker_token, or ?wt= on a URL form.",
  ];
}

// (d) Optional strong identity, a follow-up (not wired to any route yet; see notes/work-2026-11-06-service-round3/RESULTS.md).
// An agent registers an Ed25519 public key. Its agent_id may be key-<first 16 hex of sha256(public key bytes)>. It signs
// each write: X-Agent-Signature is the base64 signature over "<METHOD>\n<path>\n<timestamp>\n<hex sha256 of the body>",
// with X-Agent-Timestamp in Unix seconds, and 5 minutes of clock skew allowed. These helpers and their tests fix the format.
export const SIGNATURE_SKEW_SECONDS = 300;

function fromBase64(text) {
  const clean = String(text || "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(clean + "===".slice((clean.length + 3) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

export async function keyAgentId(publicKeyB64) {
  const bytes = fromBase64(publicKeyB64);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `key-${Array.from(digest.slice(0, 8), (b) => HEX[b >> 4] + HEX[b & 15]).join("")}`;
}

export function signedMessage(method, path, timestamp, bodySha256Hex) {
  return `${String(method).toUpperCase()}\n${path}\n${timestamp}\n${bodySha256Hex}`;
}

/** true when the signature is good for this key, request and time; false otherwise (never throws). */
export async function verifyAgentSignature({ publicKeyB64, method, path, timestamp, body = "", signatureB64, nowSeconds = Date.now() / 1000 }) {
  try {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > SIGNATURE_SKEW_SECONDS) return false;
    const key = await crypto.subtle.importKey("raw", fromBase64(publicKeyB64), { name: "Ed25519" }, false, ["verify"]);
    const message = new TextEncoder().encode(signedMessage(method, path, String(timestamp), await sha256Hex(body)));
    return await crypto.subtle.verify({ name: "Ed25519" }, key, fromBase64(signatureB64), message);
  } catch {
    return false;
  }
}
