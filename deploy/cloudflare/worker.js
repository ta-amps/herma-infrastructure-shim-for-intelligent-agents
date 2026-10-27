import { agentFetch } from "./agent_access.js";
// Cloudflare Cloud Worker for Herma: 24/7 caller-isolated context-shimming AI middleware backed by
// Cloudflare D1 (`ta-amps-herma`) + direct Service Binding to `tessera` Cloud (`env.TESSERA`),
// with optional `STORAGE_MODE = "origin"` reverse-proxy fallback.

import {
  ALLOWED_CONTEXT_KINDS,
  ALLOWED_ENTITY_KINDS,
  ALLOWED_HARNESS_KINDS,
  reserveRouteRequest,
  resolveUpstream,
  ALLOWED_OUTCOMES,
  ALLOWED_URI_SCHEMES,
  DEFAULT_CONTEXT_ENTRIES,
  DEFAULT_PROVISIONS,
  FAVICON_SVG,
  HERMA_VERSION,
  HermaErr,
  MCP_TOOLS_SPEC,
  PREVIEW_JS,
  ROBOTS_TXT,
  SAFE_BUCKET_SEG_RE,
  SYSTEM_BUILTIN_SCOPE,
  assembleAugmentedRequest,
  authenticateHarness,
  buildAgentCard,
  buildDirectProtocolResponse,
  buildLlmsFullTxt,
  buildLlmsTxt,
  canonicalJson,
  enforceNotConsumerAssistant,
  ensureSchema,
  estimateTokensSaved,
  evaluateProvisions,
  extractEntities,
  extractEnvelope,
  isAdminRequest,
  parseCohortHeader,
  parseProjectTag,
  parseTesseraContextRef,
  passesGovernanceLens,
  provisionPassesLens,
  renderConnectHtml,
  renderOverviewHtml,
  requireScope,
  sha256Hex,
  stripGovernanceEnvelopeForContext,
  stripGovernanceEnvelopeForProvision,
  synthesizeCandidateProvisions,
  validateBlobSha256,
  validateContextEntry,
  validateProvisionPayload,
  verifyBlobBytes,
} from "./herma_engine.js";

const DEFAULT_ORIGIN = "https://herma-api.fly.dev";
const DEFAULT_PUBLIC_URL = "https://herma.ta-amps.workers.dev";

const HOP_BY_HOP = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

const DEFAULT_CSP_DATA = "default-src 'none'; frame-ancestors 'none'";
const DEFAULT_CSP_PAGE = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "x-frame-options": "DENY",
};

function stripHopByHop(headers) {
  const listed = (headers.get("connection") || "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  for (const name of [...HOP_BY_HOP, ...listed]) headers.delete(name);
}

function withSecurity(response, { noStore = true } = {}) {
  const headers = new Headers(response.headers);
  stripHopByHop(headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  if (!headers.has("content-security-policy")) {
    const isPage = (headers.get("content-type") || "").includes("text/html");
    headers.set("content-security-policy", isPage ? DEFAULT_CSP_PAGE : DEFAULT_CSP_DATA);
  }
  if (noStore || !headers.has("cache-control")) {
    headers.set("cache-control", "no-store");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function problem(status, code, title, detail, extraHeaders = {}) {
  return withSecurity(
    new Response(JSON.stringify({ type: "about:blank", title, status, detail, code }), {
      status,
      headers: { "content-type": "application/problem+json", ...extraHeaders },
    })
  );
}

function methodNotAllowed(allowedMethods) {
  const allow = allowedMethods.join(", ");
  return problem(405, "method_not_allowed", "Method Not Allowed", `Allowed HTTP methods: ${allow}.`, {
    allow,
  });
}

function jsonResp(data, status = 200, extraHeaders = {}) {
  return withSecurity(
    new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json", ...extraHeaders },
    })
  );
}

function textResp(text, contentType = "text/plain; charset=utf-8", status = 200) {
  return withSecurity(
    new Response(text, {
      status,
      headers: { "content-type": contentType },
    })
  );
}

function randomHex(byteCount = 8) {
  return Array.from(crypto.getRandomValues(new Uint8Array(byteCount)), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

function rowToContextEntry(row) {
  let parsed = row.body_json;
  try {
    parsed = JSON.parse(String(row.body_json || ""));
  } catch {
    // keep raw string
  }
  let schemaOrBody = "";
  let sourceUri = null;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "schema_or_body" in parsed) {
    schemaOrBody = parsed.schema_or_body ?? "";
    sourceUri = typeof parsed.source_uri === "string" && parsed.source_uri ? parsed.source_uri : null;
  } else {
    schemaOrBody = parsed ?? "";
  }
  return {
    entry_id: row.entry_id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    schema_or_body: schemaOrBody,
    source_uri: sourceUri,
    version: row.version != null ? Number(row.version) : 1,
    updated_at: row.updated_at,
  };
}

function rowToStoredProvision(r) {
  return {
    caller_scope: r.caller_scope || SYSTEM_BUILTIN_SCOPE,
    provision: JSON.parse(r.body_json),
    version: Number(r.version),
    content_sha256: r.content_sha256,
    source_store: r.source_store,
    updated_at: Number(r.updated_at),
  };
}

async function ensureSeeded(db) {
  await ensureSchema(db);
  const ctxStmts = DEFAULT_CONTEXT_ENTRIES.map((entry) =>
    db
      .prepare(
        "INSERT OR IGNORE INTO context_entries (caller_scope, entry_id, version, kind, title, summary, body_json, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?)"
      )
      .bind(
        SYSTEM_BUILTIN_SCOPE,
        entry.entry_id,
        entry.kind,
        entry.title,
        entry.summary,
        canonicalJson({ schema_or_body: entry.schema_or_body, source_uri: entry.source_uri }),
        entry.updated_at
      )
  );
  if (ctxStmts.length) await db.batch(ctxStmts);

  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM provisions WHERE caller_scope = ?")
    .bind(SYSTEM_BUILTIN_SCOPE)
    .first();
  if (Number(row?.n || 0) < DEFAULT_PROVISIONS.length) {
    const now = Date.now() / 1000;
    const stmts = [];
    for (const prov of DEFAULT_PROVISIONS) {
      const bodyJson = canonicalJson(prov);
      const sha = await sha256Hex(bodyJson);
      stmts.push(
        db
          .prepare(
            "INSERT OR IGNORE INTO provisions (caller_scope, prov_id, version, content_sha256, source_store, body_json, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?)"
          )
          .bind(SYSTEM_BUILTIN_SCOPE, prov.prov_id, sha, SYSTEM_BUILTIN_SCOPE, bodyJson, now)
      );
    }
    if (stmts.length) await db.batch(stmts);
  }
}

async function hasBuiltinProvision(db, provId) {
  await ensureSeeded(db);
  const row = await db
    .prepare("SELECT 1 AS ok FROM provisions WHERE caller_scope = ? AND prov_id = ?")
    .bind(SYSTEM_BUILTIN_SCOPE, provId)
    .first();
  return row != null;
}

async function hasBuiltinContextEntry(db, entryId) {
  await ensureSeeded(db);
  const row = await db
    .prepare("SELECT 1 AS ok FROM context_entries WHERE caller_scope = ? AND entry_id = ?")
    .bind(SYSTEM_BUILTIN_SCOPE, entryId)
    .first();
  return row != null;
}

async function upsertContextEntry(
  db,
  rawEntry,
  { callerScope = SYSTEM_BUILTIN_SCOPE, expectedVersion = null, checkCas = false, isAdmin = false } = {}
) {
  await ensureSeeded(db);
  const candEntryId = rawEntry && typeof rawEntry === "object" ? String(rawEntry.entry_id || "").trim() : "";
  if (!isAdmin && (callerScope === SYSTEM_BUILTIN_SCOPE || (candEntryId && (await hasBuiltinContextEntry(db, candEntryId))))) {
    throw new HermaErr(
      403,
      "builtin_protected",
      "Builtin Resource Protected",
      `System builtin context_entry '${candEntryId || "builtin"}' cannot be modified or deleted by a non-admin caller.`
    );
  }
  const entry = validateContextEntry(rawEntry);
  if (!isAdmin && (callerScope === SYSTEM_BUILTIN_SCOPE || (await hasBuiltinContextEntry(db, entry.entry_id)))) {
    throw new HermaErr(
      403,
      "builtin_protected",
      "Builtin Resource Protected",
      `System builtin context_entry '${entry.entry_id}' cannot be modified or deleted by a non-admin caller.`
    );
  }
  const bodyJson = canonicalJson({
    schema_or_body: entry.schema_or_body,
    source_uri: entry.source_uri,
  });
  const enforceCas = Boolean(checkCas) || expectedVersion !== null;

  if (enforceCas) {
    if (expectedVersion === null || expectedVersion === 0) {
      const ins = await db
        .prepare(
          "INSERT OR IGNORE INTO context_entries (caller_scope, entry_id, version, kind, title, summary, body_json, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?)"
        )
        .bind(callerScope, entry.entry_id, entry.kind, entry.title, entry.summary, bodyJson, entry.updated_at)
        .run();
      if (Number(ins?.meta?.changes ?? 0) === 1) {
        return { ...entry, version: 1 };
      }
      const head = await db
        .prepare("SELECT version FROM context_entries WHERE caller_scope = ? AND entry_id = ?")
        .bind(callerScope, entry.entry_id)
        .first();
      const actual = head ? Number(head.version) : null;
      throw new HermaErr(
        409,
        "version_conflict",
        "Context Entry Version Conflict",
        `ContextEntry '${entry.entry_id}' expected version ${expectedVersion}, head is ${actual}.`
      );
    }

    const upd = await db
      .prepare(
        "UPDATE context_entries SET version = version + 1, kind = ?, title = ?, summary = ?, body_json = ?, updated_at = ? WHERE caller_scope = ? AND entry_id = ? AND version = ?"
      )
      .bind(
        entry.kind,
        entry.title,
        entry.summary,
        bodyJson,
        entry.updated_at,
        callerScope,
        entry.entry_id,
        Number(expectedVersion)
      )
      .run();
    if (Number(upd?.meta?.changes ?? 0) === 1) {
      return { ...entry, version: Number(expectedVersion) + 1 };
    }
    const head = await db
      .prepare("SELECT version FROM context_entries WHERE caller_scope = ? AND entry_id = ?")
      .bind(callerScope, entry.entry_id)
      .first();
    const actual = head ? Number(head.version) : null;
    throw new HermaErr(
      409,
      "version_conflict",
      "Context Entry Version Conflict",
      `ContextEntry '${entry.entry_id}' expected version ${expectedVersion}, head is ${actual}.`
    );
  }

  await db
    .prepare(
      "INSERT INTO context_entries (caller_scope, entry_id, version, kind, title, summary, body_json, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?) ON CONFLICT (caller_scope, entry_id) DO UPDATE SET version = context_entries.version + 1, kind = excluded.kind, title = excluded.title, summary = excluded.summary, body_json = excluded.body_json, updated_at = excluded.updated_at"
    )
    .bind(callerScope, entry.entry_id, entry.kind, entry.title, entry.summary, bodyJson, entry.updated_at)
    .run();
  const saved = await db
    .prepare("SELECT version FROM context_entries WHERE caller_scope = ? AND entry_id = ?")
    .bind(callerScope, entry.entry_id)
    .first();
  return { ...entry, version: saved ? Number(saved.version) : 1 };
}

async function listContextEntriesForCaller(
  db,
  callerScope = SYSTEM_BUILTIN_SCOPE,
  { includeBuiltin = true, kind = null, prefix = "" } = {}
) {
  await ensureSeeded(db);
  if (kind && !ALLOWED_CONTEXT_KINDS.has(kind)) {
    throw new HermaErr(422, "validation_error", "Invalid Context Filter", "kind must be 'noun', 'verb', or 'detail'.");
  }
  const scopes =
    callerScope === SYSTEM_BUILTIN_SCOPE || !includeBuiltin
      ? [callerScope]
      : [SYSTEM_BUILTIN_SCOPE, callerScope];

  let res;
  if (scopes.length === 1) {
    res = kind
      ? await db
          .prepare("SELECT * FROM context_entries WHERE caller_scope = ? AND kind = ? ORDER BY entry_id ASC")
          .bind(scopes[0], kind)
          .all()
      : await db
          .prepare("SELECT * FROM context_entries WHERE caller_scope = ? ORDER BY entry_id ASC")
          .bind(scopes[0])
          .all();
  } else {
    res = kind
      ? await db
          .prepare("SELECT * FROM context_entries WHERE caller_scope IN (?, ?) AND kind = ? ORDER BY entry_id ASC")
          .bind(scopes[0], scopes[1], kind)
          .all()
      : await db
          .prepare("SELECT * FROM context_entries WHERE caller_scope IN (?, ?) ORDER BY entry_id ASC")
          .bind(scopes[0], scopes[1])
          .all();
  }

  const byId = new Map();
  for (const row of res.results || []) {
    const eid = String(row.entry_id);
    const scope = String(row.caller_scope || SYSTEM_BUILTIN_SCOPE);
    if (!byId.has(eid) || scope === SYSTEM_BUILTIN_SCOPE) {
      byId.set(eid, rowToContextEntry(row));
    }
  }
  let items = [...byId.values()].sort((a, b) => a.entry_id.localeCompare(b.entry_id));
  if (prefix) items = items.filter((e) => e.entry_id.startsWith(prefix));
  return items;
}

async function getContextEntriesMapForCaller(
  db,
  refs,
  callerScope = SYSTEM_BUILTIN_SCOPE,
  { includeBuiltin = true } = {}
) {
  const unique = [...new Set((refs || []).map((r) => String(r || "").trim()).filter(Boolean))];
  const map = new Map();
  if (!unique.length) return map;
  await ensureSeeded(db);

  const scopes =
    callerScope === SYSTEM_BUILTIN_SCOPE || !includeBuiltin
      ? [callerScope]
      : [SYSTEM_BUILTIN_SCOPE, callerScope];
  const scopePlaceholders = scopes.map(() => "?").join(",");
  const idPlaceholders = unique.map(() => "?").join(",");
  const res = await db
    .prepare(
      `SELECT * FROM context_entries WHERE caller_scope IN (${scopePlaceholders}) AND entry_id IN (${idPlaceholders})`
    )
    .bind(...scopes, ...unique)
    .all();

  for (const row of res.results || []) {
    const entry = rowToContextEntry(row);
    const scope = String(row.caller_scope || SYSTEM_BUILTIN_SCOPE);
    if (!map.has(entry.entry_id) || scope === SYSTEM_BUILTIN_SCOPE) {
      map.set(entry.entry_id, entry);
    }
  }
  return map;
}

async function listProvisionsForCaller(
  db,
  callerScope = SYSTEM_BUILTIN_SCOPE,
  { includeBuiltin = true, enabledOnly = false } = {}
) {
  await ensureSeeded(db);
  const scopes =
    callerScope === SYSTEM_BUILTIN_SCOPE || !includeBuiltin
      ? [callerScope]
      : [SYSTEM_BUILTIN_SCOPE, callerScope];
  const res =
    scopes.length === 1
      ? await db.prepare("SELECT * FROM provisions WHERE caller_scope = ?").bind(scopes[0]).all()
      : await db
          .prepare("SELECT * FROM provisions WHERE caller_scope IN (?, ?)")
          .bind(scopes[0], scopes[1])
          .all();

  const byId = new Map();
  for (const row of res.results || []) {
    const stored = rowToStoredProvision(row);
    const pid = stored.provision.prov_id;
    if (!byId.has(pid) || stored.caller_scope === SYSTEM_BUILTIN_SCOPE) {
      byId.set(pid, stored);
    }
  }
  let items = [...byId.values()];
  if (enabledOnly) items = items.filter((s) => s.provision.enabled);
  items.sort(
    (a, b) =>
      b.provision.priority - a.provision.priority ||
      a.provision.prov_id.localeCompare(b.provision.prov_id)
  );
  return items;
}

async function putProvision(
  db,
  rawProv,
  {
    callerScope = SYSTEM_BUILTIN_SCOPE,
    expectedVersion = null,
    sourceStore = "harness",
    checkCas = false,
    isAdmin = false,
  } = {}
) {
  await ensureSeeded(db);
  const candProvId = rawProv && typeof rawProv === "object" ? String(rawProv.prov_id || "").trim() : "";
  if (!isAdmin && (callerScope === SYSTEM_BUILTIN_SCOPE || (candProvId && (await hasBuiltinProvision(db, candProvId))))) {
    throw new HermaErr(
      403,
      "builtin_protected",
      "Builtin Resource Protected",
      `System builtin provision '${candProvId || "builtin"}' cannot be modified or deleted by a non-admin caller.`
    );
  }
  const prov = validateProvisionPayload(rawProv);
  if (!isAdmin && (callerScope === SYSTEM_BUILTIN_SCOPE || (await hasBuiltinProvision(db, prov.prov_id)))) {
    throw new HermaErr(
      403,
      "builtin_protected",
      "Builtin Resource Protected",
      `System builtin provision '${prov.prov_id}' cannot be modified or deleted by a non-admin caller.`
    );
  }

  const bodyJson = canonicalJson(prov);
  const sha = await sha256Hex(bodyJson);
  const now = Date.now() / 1000;
  const enforceCas = Boolean(checkCas) || expectedVersion !== null;

  if (enforceCas) {
    if (expectedVersion === null || expectedVersion === 0) {
      const ins = await db
        .prepare(
          "INSERT OR IGNORE INTO provisions (caller_scope, prov_id, version, content_sha256, source_store, body_json, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?)"
        )
        .bind(callerScope, prov.prov_id, sha, sourceStore, bodyJson, now)
        .run();
      if (Number(ins?.meta?.changes ?? 0) === 1) {
        return {
          caller_scope: callerScope,
          provision: prov,
          version: 1,
          content_sha256: sha,
          source_store: sourceStore,
          updated_at: now,
        };
      }
      const head = await db
        .prepare("SELECT version FROM provisions WHERE caller_scope = ? AND prov_id = ?")
        .bind(callerScope, prov.prov_id)
        .first();
      const actual = head ? Number(head.version) : null;
      throw new HermaErr(
        409,
        "version_conflict",
        "Provision Version Conflict",
        `Provision '${prov.prov_id}' expected version ${expectedVersion}, head is ${actual}.`
      );
    }

    const upd = await db
      .prepare(
        "UPDATE provisions SET version = version + 1, content_sha256 = ?, source_store = ?, body_json = ?, updated_at = ? WHERE caller_scope = ? AND prov_id = ? AND version = ?"
      )
      .bind(sha, sourceStore, bodyJson, now, callerScope, prov.prov_id, Number(expectedVersion))
      .run();
    if (Number(upd?.meta?.changes ?? 0) === 1) {
      return {
        caller_scope: callerScope,
        provision: prov,
        version: Number(expectedVersion) + 1,
        content_sha256: sha,
        source_store: sourceStore,
        updated_at: now,
      };
    }
    const head = await db
      .prepare("SELECT version FROM provisions WHERE caller_scope = ? AND prov_id = ?")
      .bind(callerScope, prov.prov_id)
      .first();
    const actual = head ? Number(head.version) : null;
    throw new HermaErr(
      409,
      "version_conflict",
      "Provision Version Conflict",
      `Provision '${prov.prov_id}' expected version ${expectedVersion}, head is ${actual}.`
    );
  }

  const cur = await db
    .prepare("SELECT * FROM provisions WHERE caller_scope = ? AND prov_id = ?")
    .bind(callerScope, prov.prov_id)
    .first();
  if (cur && cur.content_sha256 === sha && cur.source_store === sourceStore) {
    return {
      caller_scope: callerScope,
      provision: prov,
      version: Number(cur.version),
      content_sha256: sha,
      source_store: sourceStore,
      updated_at: Number(cur.updated_at),
    };
  }
  await db
    .prepare(
      "INSERT INTO provisions (caller_scope, prov_id, version, content_sha256, source_store, body_json, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?) ON CONFLICT (caller_scope, prov_id) DO UPDATE SET version = provisions.version + 1, content_sha256 = excluded.content_sha256, source_store = excluded.source_store, body_json = excluded.body_json, updated_at = excluded.updated_at"
    )
    .bind(callerScope, prov.prov_id, sha, sourceStore, bodyJson, now)
    .run();
  const saved = await db
    .prepare("SELECT version FROM provisions WHERE caller_scope = ? AND prov_id = ?")
    .bind(callerScope, prov.prov_id)
    .first();
  return {
    caller_scope: callerScope,
    provision: prov,
    version: saved ? Number(saved.version) : 1,
    content_sha256: sha,
    source_store: sourceStore,
    updated_at: now,
  };
}

async function deleteProvision(db, provId, { callerScope, isAdmin = false }) {
  await ensureSeeded(db);
  if (!isAdmin && (callerScope === SYSTEM_BUILTIN_SCOPE || (await hasBuiltinProvision(db, provId)))) {
    throw new HermaErr(
      403,
      "builtin_protected",
      "Builtin Resource Protected",
      `System builtin provision '${provId}' cannot be modified or deleted by a non-admin caller.`
    );
  }
  const res = await db
    .prepare("DELETE FROM provisions WHERE caller_scope = ? AND prov_id = ?")
    .bind(callerScope, provId)
    .run();
  if (Number(res?.meta?.changes ?? 0) === 0) {
    throw new HermaErr(404, "not_found", "Provision Not Found", `Provision '${provId}' was not found.`);
  }
}

async function recordTurnTelemetry(
  db,
  { callerScope, projectTag, receipt, entities, promptText, latencyMs }
) {
  await ensureSeeded(db);
  const errorSigs = (entities || []).filter((e) => e.kind === "error_signature").map((e) => e.value);
  const tokensSaved = receipt.responded_directly
    ? estimateTokensSaved(promptText, receipt.direct_response_text)
    : 0;

  // 1. Inspect immediately preceding turn N-1 in (callerScope, projectTag):
  const prevRow = await db
    .prepare(
      "SELECT receipt_id, matched_provisions, body_json FROM injection_receipts WHERE caller_scope = ? AND project_tag = ? ORDER BY created_at DESC LIMIT 1"
    )
    .bind(callerScope, projectTag)
    .first();

  const stmts = [];
  if (prevRow && errorSigs.length > 0) {
    let prevFired = [];
    try {
      const parsed = JSON.parse(prevRow.body_json || "{}");
      prevFired = (parsed.provisions_fired || JSON.parse(prevRow.matched_provisions || "[]")).map((p) =>
        String(p).split("@")[0]
      );
    } catch {
      prevFired = [];
    }
    for (const prevProvId of prevFired.filter(Boolean)) {
      stmts.push(
        db
          .prepare(
            "INSERT INTO rule_outcomes (outcome_id, caller_scope, project_tag, receipt_id, prov_id, outcome, tokens_saved_est, latency_ms, error_signature, created_at) VALUES (?, ?, ?, ?, ?, 'retry_error', 0, 0.0, ?, ?) ON CONFLICT (caller_scope, receipt_id, prov_id) DO UPDATE SET outcome = 'retry_error', error_signature = excluded.error_signature"
          )
          .bind(
            `out_${randomHex(8)}`,
            callerScope,
            projectTag,
            prevRow.receipt_id,
            prevProvId,
            errorSigs[0],
            receipt.created_at
          )
      );
    }
  }

  // 2. Persist current receipt:
  stmts.push(
    db
      .prepare(
        "INSERT INTO injection_receipts (receipt_id, caller_scope, project_tag, receipt_sha256, conversation_id, harness_kind, protocol, model, matched_provisions, injected_uris, body_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        receipt.receipt_id,
        callerScope,
        projectTag,
        receipt.receipt_sha256,
        null,
        receipt.harness_kind,
        receipt.wire_format,
        receipt.model,
        JSON.stringify(receipt.provisions_fired || []),
        JSON.stringify(receipt.uris_injected || []),
        canonicalJson(receipt),
        receipt.created_at
      )
  );

  // 3. Persist working_entities for current turn:
  for (const ent of entities || []) {
    stmts.push(
      db
        .prepare(
          "INSERT INTO working_entities (caller_scope, project_tag, entity_kind, entity_value, hit_count, first_seen_at, last_seen_at, last_receipt_id) VALUES (?, ?, ?, ?, 1, ?, ?, ?) ON CONFLICT (caller_scope, project_tag, entity_kind, entity_value) DO UPDATE SET hit_count = working_entities.hit_count + 1, last_seen_at = excluded.last_seen_at, last_receipt_id = excluded.last_receipt_id"
        )
        .bind(
          callerScope,
          projectTag,
          ent.kind,
          ent.value,
          receipt.created_at,
          receipt.created_at,
          receipt.receipt_id
        )
    );
  }

  // 4. Persist initial 'accepted' outcome for each provision fired on turn N:
  for (const firedRef of receipt.provisions_fired || []) {
    const provId = String(firedRef).split("@")[0];
    stmts.push(
      db
        .prepare(
          "INSERT INTO rule_outcomes (outcome_id, caller_scope, project_tag, receipt_id, prov_id, outcome, tokens_saved_est, latency_ms, error_signature, created_at) VALUES (?, ?, ?, ?, ?, 'accepted', ?, ?, NULL, ?) ON CONFLICT (caller_scope, receipt_id, prov_id) DO UPDATE SET tokens_saved_est = excluded.tokens_saved_est, latency_ms = excluded.latency_ms"
        )
        .bind(
          `out_${randomHex(8)}`,
          callerScope,
          projectTag,
          receipt.receipt_id,
          provId,
          tokensSaved,
          Math.round(Number(latencyMs || 0) * 1000) / 1000,
          receipt.created_at
        )
    );
  }

  if (stmts.length) await db.batch(stmts);
}

async function listReceiptsForCaller(db, callerScope, { projectTag = null, limit = 25 } = {}) {
  await ensureSeeded(db);
  const cap = Math.max(1, Math.min(Number(limit || 25), 200));
  const res = projectTag
    ? await db
        .prepare(
          "SELECT * FROM injection_receipts WHERE caller_scope = ? AND project_tag = ? ORDER BY created_at DESC LIMIT ?"
        )
        .bind(callerScope, projectTag, cap)
        .all()
    : await db
        .prepare("SELECT * FROM injection_receipts WHERE caller_scope = ? ORDER BY created_at DESC LIMIT ?")
        .bind(callerScope, cap)
        .all();

  return (res.results || []).map((r) => {
    if (r.body_json && r.body_json !== "{}") {
      try {
        const parsed = JSON.parse(r.body_json);
        return {
          project_tag: r.project_tag || "default",
          responded_directly: false,
          direct_response_text: null,
          shimmed_context_refs: [],
          entities_tracked: 0,
          ...parsed,
        };
      } catch {
        // fall back to columns
      }
    }
    return {
      receipt_id: r.receipt_id,
      receipt_sha256: r.receipt_sha256,
      harness_kind: r.harness_kind,
      key_id: "cloud",
      project_tag: r.project_tag || "default",
      wire_format: r.protocol,
      model: r.model,
      provisions_fired: JSON.parse(r.matched_provisions || "[]"),
      tiers_matched: [],
      uris_injected: JSON.parse(r.injected_uris || "[]"),
      injected_chars: 0,
      deduped_skipped: [],
      responded_directly: false,
      direct_response_text: null,
      shimmed_context_refs: [],
      entities_tracked: 0,
      created_at: Number(r.created_at),
    };
  });
}

async function publicAggregateCounts(db) {
  await ensureSeeded(db);
  const [rCnt, eCnt, oCnt] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n FROM injection_receipts").first(),
    db.prepare("SELECT COUNT(*) AS n FROM working_entities").first(),
    db.prepare("SELECT COUNT(*) AS n FROM rule_outcomes").first(),
  ]);
  return {
    total_intercepted_requests: Number(rCnt?.n || 0),
    total_working_entities: Number(eCnt?.n || 0),
    total_rule_outcomes: Number(oCnt?.n || 0),
  };
}

async function listWorkingEntities(
  db,
  callerScope,
  { projectTag = null, kind = null, limit = 50 } = {}
) {
  await ensureSeeded(db);
  if (kind && !ALLOWED_ENTITY_KINDS.has(kind)) {
    throw new HermaErr(422, "validation_error", "Invalid Entity Kind", `Unsupported entity kind '${kind}'.`);
  }
  const cap = Math.max(1, Math.min(Number(limit || 50), 200));
  const clauses = ["caller_scope = ?"];
  const params = [callerScope];
  if (projectTag) {
    clauses.push("project_tag = ?");
    params.push(projectTag);
  }
  if (kind) {
    clauses.push("entity_kind = ?");
    params.push(kind);
  }
  params.push(cap);
  const res = await db
    .prepare(
      `SELECT * FROM working_entities WHERE ${clauses.join(" AND ")} ORDER BY hit_count DESC, last_seen_at DESC, entity_kind ASC, entity_value ASC LIMIT ?`
    )
    .bind(...params)
    .all();
  return (res.results || []).map((r) => ({
    caller_scope: r.caller_scope,
    project_tag: r.project_tag,
    entity_kind: r.entity_kind,
    entity_value: r.entity_value,
    hit_count: Number(r.hit_count),
    first_seen_at: Number(r.first_seen_at),
    last_seen_at: Number(r.last_seen_at),
    last_receipt_id: r.last_receipt_id,
  }));
}

async function recordExplicitOutcome(db, callerScope, body, headerProjectTag = "default") {
  await ensureSeeded(db);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HermaErr(422, "validation_error", "Invalid Outcome Report", "Expected JSON object.");
  }
  const receiptId = String(body.receipt_id || "").trim();
  const outcome = String(body.outcome || "").trim();
  if (receiptId.length < 4 || !ALLOWED_OUTCOMES.has(outcome)) {
    throw new HermaErr(
      422,
      "validation_error",
      "Invalid Outcome Report",
      "Valid receipt_id and outcome ('accepted'|'retry_error'|'ignored'|'overridden') are required."
    );
  }
  const rcptRow = await db
    .prepare("SELECT project_tag, matched_provisions, body_json FROM injection_receipts WHERE caller_scope = ? AND receipt_id = ?")
    .bind(callerScope, receiptId)
    .first();
  if (!rcptRow) {
    throw new HermaErr(
      404,
      "receipt_not_found",
      "Receipt Not Found",
      `Receipt '${receiptId}' was not found in caller scope.`
    );
  }
  const resolvedProj = body.project_tag
    ? parseProjectTag(null, body.project_tag)
    : rcptRow.project_tag || headerProjectTag;

  let firedProvs = [];
  try {
    const parsed = JSON.parse(rcptRow.body_json || "{}");
    firedProvs = (parsed.provisions_fired || JSON.parse(rcptRow.matched_provisions || "[]")).map((p) =>
      String(p).split("@")[0]
    );
  } catch {
    firedProvs = [];
  }
  const explicitProv = body.prov_id ? String(body.prov_id).trim() : "";
  const targetProvs = explicitProv ? [explicitProv] : firedProvs.filter(Boolean);
  if (!targetProvs.length) {
    throw new HermaErr(
      400,
      "missing_prov_id",
      "Missing Provision ID",
      "Receipt had no matched provisions; specify prov_id explicitly."
    );
  }

  const now = Date.now() / 1000;
  const errSig = body.error_signature ? String(body.error_signature).trim().slice(0, 240) : null;
  if (errSig) {
    const extracted = extractEntities(errSig).find((e) => e.kind === "error_signature");
    const sigVal = extracted ? extracted.value : errSig;
    await db
      .prepare(
        "INSERT INTO working_entities (caller_scope, project_tag, entity_kind, entity_value, hit_count, first_seen_at, last_seen_at, last_receipt_id) VALUES (?, ?, 'error_signature', ?, 1, ?, ?, ?) ON CONFLICT (caller_scope, project_tag, entity_kind, entity_value) DO UPDATE SET hit_count = working_entities.hit_count + 1, last_seen_at = excluded.last_seen_at, last_receipt_id = excluded.last_receipt_id"
      )
      .bind(callerScope, resolvedProj, sigVal, now, now, receiptId)
      .run();
  }

  const tokensSavedEst = Math.max(0, Math.trunc(Number(body.tokens_saved_est || 0)));
  const latencyMs = Math.max(0, Number(body.latency_ms || 0));
  const outRecords = [];
  for (const pid of targetProvs) {
    const oid = `out_${randomHex(8)}`;
    await db
      .prepare(
        "INSERT INTO rule_outcomes (outcome_id, caller_scope, project_tag, receipt_id, prov_id, outcome, tokens_saved_est, latency_ms, error_signature, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (caller_scope, receipt_id, prov_id) DO UPDATE SET outcome = excluded.outcome, tokens_saved_est = CASE WHEN excluded.tokens_saved_est > 0 THEN excluded.tokens_saved_est ELSE rule_outcomes.tokens_saved_est END, latency_ms = CASE WHEN excluded.latency_ms > 0 THEN excluded.latency_ms ELSE rule_outcomes.latency_ms END, error_signature = COALESCE(excluded.error_signature, rule_outcomes.error_signature)"
      )
      .bind(oid, callerScope, resolvedProj, receiptId, pid, outcome, tokensSavedEst, latencyMs, errSig, now)
      .run();
    const row = await db
      .prepare("SELECT * FROM rule_outcomes WHERE caller_scope = ? AND receipt_id = ? AND prov_id = ?")
      .bind(callerScope, receiptId, pid)
      .first();
    if (row) {
      outRecords.push({
        outcome_id: row.outcome_id,
        caller_scope: row.caller_scope,
        project_tag: row.project_tag,
        receipt_id: row.receipt_id,
        prov_id: row.prov_id,
        outcome: row.outcome,
        tokens_saved_est: Number(row.tokens_saved_est || 0),
        latency_ms: Number(row.latency_ms || 0),
        error_signature: row.error_signature ?? null,
        created_at: Number(row.created_at),
      });
    }
  }
  return outRecords;
}

async function buildInsights(db, callerScope, projectTag = null) {
  const topEntities = await listWorkingEntities(db, callerScope, { projectTag, limit: 50 });
  const clauses = ["caller_scope = ?"];
  const params = [callerScope];
  if (projectTag) {
    clauses.push("project_tag = ?");
    params.push(projectTag);
  }
  const res = await db
    .prepare(
      `SELECT prov_id, COUNT(*) AS fires, SUM(CASE WHEN outcome = 'accepted' THEN 1 ELSE 0 END) AS accepted_count, SUM(CASE WHEN outcome = 'retry_error' THEN 1 ELSE 0 END) AS retry_error_count, COALESCE(SUM(tokens_saved_est), 0) AS tokens_saved_est, COALESCE(AVG(latency_ms), 0.0) AS avg_latency_ms FROM rule_outcomes WHERE ${clauses.join(" AND ")} GROUP BY prov_id ORDER BY fires DESC, prov_id ASC`
    )
    .bind(...params)
    .all();

  const ruleTelemetry = (res.results || []).map((r) => {
    const fires = Number(r.fires || 0);
    const retryCnt = Number(r.retry_error_count || 0);
    return {
      prov_id: r.prov_id,
      fires,
      accepted_count: Number(r.accepted_count || 0),
      retry_error_count: retryCnt,
      tokens_saved_est: Number(r.tokens_saved_est || 0),
      retry_error_rate: fires > 0 ? Math.round((retryCnt / fires) * 10000) / 10000 : 0.0,
      avg_latency_ms: Math.round(Number(r.avg_latency_ms || 0) * 1000) / 1000,
    };
  });

  const activeProvs = await listProvisionsForCaller(db, callerScope, {
    includeBuiltin: true,
    enabledOnly: true,
  });
  const candidateProvisions = await synthesizeCandidateProvisions(
    topEntities,
    activeProvs,
    projectTag || "default"
  );
  return {
    caller_scope: callerScope,
    project_tag: projectTag,
    top_entities: topEntities,
    rule_telemetry: ruleTelemetry,
    candidate_provisions: candidateProvisions,
  };
}

async function evaluatePublicPreview(db, env, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HermaErr(422, "validation_error", "Invalid Preview Request", "Expected JSON object.");
  }
  const wireFormat = body.wire_format || "chat_completions";
  if (!["chat_completions", "responses", "messages"].includes(wireFormat)) {
    throw new HermaErr(
      422,
      "validation_error",
      "Invalid Preview Request",
      "wire_format must be 'chat_completions', 'responses', or 'messages'."
    );
  }
  const model = String(body.model || "muse-spark-open").slice(0, 120);
  const prompt = String(body.prompt || "");
  if (prompt.length > 16000) {
    throw new HermaErr(422, "validation_error", "Invalid Preview Request", "prompt must be <= 16000 chars.");
  }
  const workspacePaths = Array.isArray(body.workspace_paths)
    ? body.workspace_paths.slice(0, 32).map((p) => String(p || ""))
    : [];

  let payload;
  if (body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)) {
    payload = structuredClone(body.payload);
    payload.model = payload.model || model;
  } else if (!prompt.trim()) {
    throw new HermaErr(422, "empty_prompt", "Empty Preview Prompt", "Provide a non-empty prompt or wire payload.");
  } else if (wireFormat === "responses") {
    payload = { model, input: prompt };
  } else if (wireFormat === "messages") {
    payload = { model, max_tokens: 512, messages: [{ role: "user", content: prompt }] };
  } else {
    payload = { model, messages: [{ role: "user", content: prompt }] };
  }

  const envelope = extractEnvelope(wireFormat, payload, workspacePaths);
  const builtinProvs = await listProvisionsForCaller(db, SYSTEM_BUILTIN_SCOPE, {
    includeBuiltin: true,
    enabledOnly: true,
  });
  const matched = await evaluateProvisions(builtinProvs, envelope.trigger_context, env, {
    offlineOnly: true,
  });
  const allRefs = matched.flatMap((m) => m.stored.provision.context_refs || []);
  const contextMap = await getContextEntriesMapForCaller(db, allRefs, SYSTEM_BUILTIN_SCOPE, {
    includeBuiltin: true,
  });
  const entities = extractEntities(envelope.trigger_context.text, envelope.trigger_context.file_paths);
  const previewPrincipal = {
    key_id: "preview_readonly",
    label: "public-preview",
    harness_kind: "opencode",
    scopes: new Set(["route"]),
    is_admin: false,
    caller_scope: SYSTEM_BUILTIN_SCOPE,
  };
  const { augmented_payload, receipt } = await assembleAugmentedRequest(
    previewPrincipal,
    envelope,
    payload,
    matched,
    8000,
    contextMap,
    { projectTag: "preview", entitiesTracked: entities.length }
  );
  return {
    persisted: false,
    scope_evaluated: SYSTEM_BUILTIN_SCOPE,
    wire_format: wireFormat,
    matches: matched.map((m) => m.match),
    entities,
    augmented_payload,
    responded_directly: receipt.responded_directly,
    direct_response_text: receipt.direct_response_text,
    shimmed_context_refs: receipt.shimmed_context_refs,
  };
}

async function tesseraFetch(env, baseUrl, path, bearer) {
  const cleanBase = String(baseUrl || env.TESSERA_URL || "https://tessera.ta-amps.workers.dev").replace(/\/+$/, "");
  const headers = {
    authorization: `Bearer ${bearer}`,
    accept: "application/json",
    "x-surface-id": "herma",
  };
  if (env.TESSERA && cleanBase.includes("tessera.ta-amps.workers.dev")) {
    return await env.TESSERA.fetch(`https://tessera.ta-amps.workers.dev${path}`, { method: "GET", headers });
  }
  return await fetch(`${cleanBase}${path}`, { method: "GET", headers });
}

function valueToContextEntry(ref, kind, storeNs, recKey, rawVal) {
  const defaultUri = `tessera://stores/${storeNs}/${recKey}`;
  if (rawVal && typeof rawVal === "object" && !Array.isArray(rawVal)) {
    const candUri = typeof rawVal.source_uri === "string" ? rawVal.source_uri.trim() : "";
    const sourceUri = ALLOWED_URI_SCHEMES.some((s) => candUri.startsWith(s)) ? candUri : defaultUri;
    return {
      entry_id: ref,
      kind,
      title: String(rawVal.title || `${kind} ${storeNs}/${recKey}`).slice(0, 160),
      summary: String(rawVal.summary || `Synced ${kind} context from Tessera store ${storeNs}/${recKey}.`).slice(0, 600),
      schema_or_body: rawVal.schema_or_body ?? stripGovernanceEnvelopeForContext(rawVal),
      source_uri: sourceUri,
      updated_at: String(rawVal.updated_at || new Date().toISOString()),
    };
  }
  return {
    entry_id: ref,
    kind,
    title: `${kind} ${storeNs}/${recKey}`.slice(0, 160),
    summary: `Synced ${kind} context from Tessera store ${storeNs}/${recKey}.`.slice(0, 600),
    schema_or_body: String(rawVal ?? ""),
    source_uri: defaultUri,
    updated_at: new Date().toISOString(),
  };
}

async function syncFromTesseraCloud(
  db,
  env,
  {
    base_url,
    bearer_token,
    namespace = "herma.provisions",
    callerScope = SYSTEM_BUILTIN_SCOPE,
    harnessKind = null,
    cohort = "",
    isAdmin = false,
  }
) {
  await ensureSeeded(db);
  const ctxNs = `${namespace}.context`;
  const ctxIdxResp = await tesseraFetch(
    env,
    base_url,
    `/v1/stores/${encodeURIComponent(ctxNs)}/records/index`,
    bearer_token
  );
  if (ctxIdxResp.ok) {
    const ctxIdx = await ctxIdxResp.json();
    for (const eid of ctxIdx?.value?.entry_ids || []) {
      const cResp = await tesseraFetch(
        env,
        base_url,
        `/v1/stores/${encodeURIComponent(ctxNs)}/records/${encodeURIComponent(eid)}`,
        bearer_token
      );
      if (cResp.ok) {
        const cData = await cResp.json();
        const cVal = cData?.value;
        if (!cVal) continue;
        if (
          !passesGovernanceLens(cVal, {
            namespace: ctxNs,
            harnessKind,
            cohort,
            extraEnvelope: cData,
          })
        ) {
          continue;
        }
        const cleanedCtx = stripGovernanceEnvelopeForContext(cVal, cData);
        if (!isAdmin && (await hasBuiltinContextEntry(db, String(cleanedCtx.entry_id || eid)))) {
          continue;
        }
        await upsertContextEntry(db, cleanedCtx, { callerScope, isAdmin });
      }
    }
  }

  const listResp = await tesseraFetch(
    env,
    base_url,
    `/v1/stores/${encodeURIComponent(namespace)}/records?limit=200`,
    bearer_token
  );
  let records = [];
  if (listResp.ok) {
    const body = await listResp.json();
    records = (body.records || []).filter((r) => r.key !== "index");
  } else {
    const idxResp = await tesseraFetch(
      env,
      base_url,
      `/v1/stores/${encodeURIComponent(namespace)}/records/index`,
      bearer_token
    );
    if (!idxResp.ok) {
      throw new HermaErr(502, "sync_failed", "Tessera Sync Failed", `Tessera returned HTTP ${idxResp.status}.`);
    }
    const idxData = await idxResp.json();
    for (const pid of idxData?.value?.prov_ids || []) {
      const r = await tesseraFetch(
        env,
        base_url,
        `/v1/stores/${encodeURIComponent(namespace)}/records/${encodeURIComponent(pid)}`,
        bearer_token
      );
      if (r.ok) records.push(await r.json());
    }
  }

  const synced = [];
  for (const rec of records) {
    const rawVal = rec?.value;
    if (!rawVal || typeof rawVal !== "object" || !rawVal.prov_id) continue;
    if (
      !passesGovernanceLens(rawVal, {
        namespace,
        harnessKind,
        cohort,
        extraEnvelope: rec,
      })
    ) {
      continue;
    }
    const prov = stripGovernanceEnvelopeForProvision(structuredClone(rawVal), rec);
    if (!isAdmin && (await hasBuiltinProvision(db, prov.prov_id))) {
      continue;
    }

    const resolvedUris = [];
    for (const u of prov.uris || []) {
      if (u.uri?.startsWith("tessera://blobs/") && !u.inline_excerpt) {
        validateBlobSha256(u.uri.slice("tessera://blobs/".length));
        resolvedUris.push(u);
        continue;
      }
      if (u.uri?.startsWith("tessera://buckets/") && !u.inline_excerpt) {
        const rest = u.uri.slice("tessera://buckets/".length).trim();
        const slash = rest.indexOf("/");
        if (slash > 0 && !rest.includes("..")) {
          const bucket = rest.slice(0, slash);
          const okey = rest.slice(slash + 1);
          if (bucket && okey && SAFE_BUCKET_SEG_RE.test(okey)) {
            const encKey = okey.split("/").map(encodeURIComponent).join("/");
            const oResp = await tesseraFetch(
              env,
              base_url,
              `/v1/buckets/${encodeURIComponent(bucket)}/objects/${encKey}`,
              bearer_token
            );
            if (oResp.ok) {
              const hdrTags = oResp.headers.get("x-tessera-tags") || "";
              if (
                passesGovernanceLens(hdrTags ? { tags: hdrTags } : {}, {
                  namespace: `bucket:${bucket}`,
                  harnessKind,
                  cohort,
                })
              ) {
                const text = (await oResp.text()).slice(0, 780);
                resolvedUris.push({ ...u, inline_excerpt: text });
                continue;
              }
            }
          }
        }
      }
      resolvedUris.push(u);
    }
    prov.uris = resolvedUris;

    for (const ref of prov.context_refs || []) {
      const parsedRef = parseTesseraContextRef(ref);
      if (parsedRef) {
        const encodedKey = parsedRef.recKey.split("/").map(encodeURIComponent).join("/");
        const nResp = await tesseraFetch(
          env,
          base_url,
          `/v1/stores/${encodeURIComponent(parsedRef.storeNs)}/records/${encodedKey}`,
          bearer_token
        );
        if (nResp.ok) {
          const nData = await nResp.json();
          if (
            !passesGovernanceLens(nData?.value, {
              namespace: parsedRef.storeNs,
              harnessKind,
              cohort,
              extraEnvelope: nData,
            })
          ) {
            continue;
          }
          if (!isAdmin && (await hasBuiltinContextEntry(db, ref))) {
            continue;
          }
          await upsertContextEntry(
            db,
            {...valueToContextEntry(ref, parsedRef.kind, parsedRef.storeNs, parsedRef.recKey, nData?.value), governance: stripGovernanceEnvelopeForContext(nData?.value, nData).governance},
            { callerScope, isAdmin }
          );
        }
      }
    }

    synced.push(
      await putProvision(db, prov, {
        callerScope,
        sourceStore: `tessera_cloud:${namespace}`,
        checkCas: false,
        isAdmin,
      })
    );
  }
  return synced;
}

async function handleStatelessMcp(request, db, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResp({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || body.jsonrpc !== "2.0") {
    return jsonResp({
      jsonrpc: "2.0",
      id: body && typeof body === "object" ? body.id ?? null : null,
      error: { code: -32600, message: "Invalid JSON-RPC 2.0 request" },
    });
  }

  const rpcMethod = String(body.method || "");
  const hasId = "id" in body && body.id !== undefined && body.id !== null;
  const reqId = body.id ?? null;
  const params = body.params && typeof body.params === "object" && !Array.isArray(body.params) ? body.params : {};

  if (rpcMethod === "notifications/initialized") {
    if (!hasId) {
      return withSecurity(new Response(null, { status: 202 }));
    }
    return jsonResp({ jsonrpc: "2.0", id: reqId, result: {} });
  }
  if (rpcMethod === "initialize") {
    const protoVer = String(params.protocolVersion || "2024-11-05");
    return jsonResp({
      jsonrpc: "2.0",
      id: reqId,
      result: {
        protocolVersion: protoVer,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "herma", version: HERMA_VERSION },
      },
    });
  }
  if (rpcMethod === "ping") {
    return jsonResp({ jsonrpc: "2.0", id: reqId, result: {} });
  }
  if (rpcMethod === "tools/list") {
    return jsonResp({
      jsonrpc: "2.0",
      id: reqId,
      result: { tools: MCP_TOOLS_SPEC },
    });
  }
  if (rpcMethod === "tools/call") {
    const toolName = String(params.name || "");
    const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments : {};
    await ensureSeeded(db);

    if (toolName === "list_builtin_provisions") {
      const enabledOnly = Boolean(args.enabled_only);
      const items = await listProvisionsForCaller(db, SYSTEM_BUILTIN_SCOPE, {
        includeBuiltin: true,
        enabledOnly,
      });
      const payload = { provisions: items, count: items.length };
      return jsonResp({
        jsonrpc: "2.0",
        id: reqId,
        result: {
          content: [{ type: "text", text: canonicalJson(payload) }],
          structuredContent: payload,
          isError: false,
        },
      });
    }
    if (toolName === "preview_shim") {
      const prompt = String(args.prompt || "");
      if (!prompt.trim()) {
        return jsonResp({
          jsonrpc: "2.0",
          id: reqId,
          error: { code: -32602, message: "Missing non-empty 'prompt' argument" },
        });
      }
      const previewOut = await evaluatePublicPreview(db, env, {
        prompt,
        wire_format: args.wire_format || "chat_completions",
        workspace_paths: Array.isArray(args.workspace_paths) ? args.workspace_paths : [],
      });
      return jsonResp({
        jsonrpc: "2.0",
        id: reqId,
        result: {
          content: [{ type: "text", text: canonicalJson(previewOut) }],
          structuredContent: previewOut,
          isError: false,
        },
      });
    }
    if (toolName === "extract_entities") {
      const text = String(args.text || "");
      const wp = Array.isArray(args.workspace_paths) ? args.workspace_paths.map((p) => String(p)) : [];
      const extracted = extractEntities(text, wp);
      const payload = { entities: extracted, count: extracted.length };
      return jsonResp({
        jsonrpc: "2.0",
        id: reqId,
        result: {
          content: [{ type: "text", text: canonicalJson(payload) }],
          structuredContent: payload,
          isError: false,
        },
      });
    }
    return jsonResp({
      jsonrpc: "2.0",
      id: reqId,
      error: { code: -32602, message: `Unknown tool: ${toolName}` },
    });
  }

  return jsonResp({
    jsonrpc: "2.0",
    id: reqId,
    error: { code: -32601, message: `Method not found: ${rpcMethod}` },
  });
}

async function proxyOrigin(request, env) {
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, env.ORIGIN || DEFAULT_ORIGIN);
  const headers = new Headers(request.headers);
  stripHopByHop(headers);
  headers.delete("cookie");
  headers.set("x-forwarded-host", incoming.host);
  headers.set("x-forwarded-proto", incoming.protocol.replace(":", ""));
  if (env.EDGE_SECRET) headers.set("x-edge-auth", env.EDGE_SECRET);
  const isRead = request.method === "GET" || request.method === "HEAD";
  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: isRead ? undefined : request.body,
      redirect: "manual",
    });
    return withSecurity(upstream, { noStore: !isRead });
  } catch {
    return problem(502, "unavailable", "Bad Gateway", "The Herma middleware origin did not answer.");
  }
}

const application = {
  async fetch(request, env) {
    if ((env.STORAGE_MODE || "cloud") === "origin") {
      return proxyOrigin(request, env);
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();
    const publicUrl =
      (env.PUBLIC_URL || `${url.protocol}//${url.host}`).replace(/\/+$/, "") || DEFAULT_PUBLIC_URL;
    const db = env.HERMA_DB;

    try {
      // 1. Public discovery, brand assets, read-only HTML & preview, and stateless MCP
      if (path === "/favicon.svg") {
        if (method !== "GET" && method !== "HEAD") return methodNotAllowed(["GET", "HEAD"]);
        return textResp(FAVICON_SVG, "image/svg+xml; charset=utf-8");
      }
      if (path === "/preview.js") {
        if (method !== "GET" && method !== "HEAD") return methodNotAllowed(["GET", "HEAD"]);
        return textResp(PREVIEW_JS, "application/javascript; charset=utf-8");
      }
      if (path === "/robots.txt") {
        if (method !== "GET" && method !== "HEAD") return methodNotAllowed(["GET", "HEAD"]);
        return textResp(ROBOTS_TXT, "text/plain; charset=utf-8");
      }
      if (path === "/llms.txt") {
        if (method !== "GET" && method !== "HEAD") return methodNotAllowed(["GET", "HEAD"]);
        return textResp(buildLlmsTxt(publicUrl), "text/plain; charset=utf-8");
      }
      if (path === "/llms-full.txt") {
        if (method !== "GET" && method !== "HEAD") return methodNotAllowed(["GET", "HEAD"]);
        return textResp(buildLlmsFullTxt(publicUrl), "text/plain; charset=utf-8");
      }
      if (path === "/.well-known/agent-card.json") {
        if (method !== "GET" && method !== "HEAD") return methodNotAllowed(["GET", "HEAD"]);
        return jsonResp(buildAgentCard(publicUrl));
      }
      if (path === "/api/health" || path === "/v1/health" || path === "/healthz") {
        if (method !== "GET" && method !== "HEAD") return methodNotAllowed(["GET", "HEAD"]);
        const [active, ctxEntries] = await Promise.all([
          listProvisionsForCaller(db, SYSTEM_BUILTIN_SCOPE, { includeBuiltin: true, enabledOnly: true }),
          listContextEntriesForCaller(db, SYSTEM_BUILTIN_SCOPE, { includeBuiltin: true }),
        ]);
        return jsonResp({
          ok: true,
          surface: "herma",
          version: HERMA_VERSION,
          storage: "cloudflare-d1",
          active_provisions: active.length,
          context_entries: ctxEntries.length,
          standard_mode_only: true,
          configurable_harnesses_only: true,
        });
      }
      if (path === "/" || path === "/console") {
        if (method !== "GET" && method !== "HEAD") return methodNotAllowed(["GET", "HEAD"]);
        const [provs, ctxEntries, counts] = await Promise.all([
          listProvisionsForCaller(db, SYSTEM_BUILTIN_SCOPE, { includeBuiltin: true, enabledOnly: false }),
          listContextEntriesForCaller(db, SYSTEM_BUILTIN_SCOPE, { includeBuiltin: true }),
          publicAggregateCounts(db),
        ]);
        return withSecurity(
          new Response(renderOverviewHtml(provs, [], publicUrl, ctxEntries, counts), {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          })
        );
      }
      if (path === "/connect") {
        if (method !== "GET" && method !== "HEAD") return methodNotAllowed(["GET", "HEAD"]);
        return withSecurity(
          new Response(renderConnectHtml(publicUrl), {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          })
        );
      }
      if (path === "/api/preview") {
        if (method !== "POST") return methodNotAllowed(["POST"]);
        let body;
        try {
          body = await request.json();
        } catch {
          throw new HermaErr(400, "invalid_json", "Invalid JSON", "Preview body must be valid JSON.");
        }
        return jsonResp(await evaluatePublicPreview(db, env, body));
      }
      if (path === "/mcp") {
        if (method !== "POST") return methodNotAllowed(["POST"]);
        return await handleStatelessMcp(request, db, env);
      }

      // 2. Harness key bootstrap & administration (`/v1/admin/keys`) -- admin secret strictly required
      if (path === "/v1/admin/keys") {
        if (method !== "GET" && method !== "POST") return methodNotAllowed(["GET", "POST"]);
        await ensureSchema(db);
        if (!isAdminRequest(request, env)) {
          throw new HermaErr(
            403,
            "admin_required",
            "Bootstrap or Admin Secret Required",
            "Calling /v1/admin/keys requires X-Bootstrap-Secret or X-Herma-Admin-Token. Ordinary configure harness keys cannot mint or enumerate keys."
          );
        }
        if (method === "GET") {
          const res = await db.prepare("SELECT * FROM harness_keys ORDER BY created_at ASC").all();
          const keys = (res.results || []).map((r) => ({
            key_id: r.key_id,
            label: r.label,
            harness_kind: r.harness_kind,
            scopes: JSON.parse(r.scopes_json || "[]"),
            created_at: Number(r.created_at),
            revoked_at: r.revoked_at == null ? null : Number(r.revoked_at),
          }));
          return jsonResp({ keys });
        }
        const body = await request.json();
        const label = String(body.label || "").trim();
        const harnessKind = String(body.harness_kind || "opencode").trim();
        const scopes = Array.isArray(body.scopes) && body.scopes.length ? [...new Set(body.scopes)] : ["route"];
        if (!label || !ALLOWED_HARNESS_KINDS.has(harnessKind)) {
          throw new HermaErr(400, "invalid_request", "Invalid Key Request", "Valid label and harness_kind required.");
        }
        const keyId = randomHex(6);
        const rawBytes = crypto.getRandomValues(new Uint8Array(24));
        const rawSec = btoa(String.fromCharCode(...rawBytes))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");
        const fullKey = `hmk_${keyId}.${rawSec}`;
        const secSha = await sha256Hex(rawSec);
        const now = Date.now() / 1000;
        await db
          .prepare(
            "INSERT INTO harness_keys (key_id, label, harness_kind, scopes_json, secret_sha256, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)"
          )
          .bind(keyId, label, harnessKind, JSON.stringify(scopes.sort()), secSha, now)
          .run();
        return jsonResp(
          {
            key: fullKey,
            key_id: keyId,
            label,
            harness_kind: harnessKind,
            scopes: scopes.sort(),
            created_at: now,
            revoked_at: null,
          },
          201
        );
      }

      // 3. Authenticated `route` endpoints (`/v1/handshake`, `/v1/dry-run`, wire endpoints, `/v1/receipts`, `/v1/memory`, `/v1/outcomes`, `/v1/insights`)
      if (path === "/v1/handshake") {
        if (method !== "POST") return methodNotAllowed(["POST"]);
        enforceNotConsumerAssistant(request);
        const principal = await authenticateHarness(db, request, { isAdmin: isAdminRequest(request, env) });
        requireScope(principal, "route", request);
        let body;
        try {
          body = await request.json();
        } catch {
          throw new HermaErr(400, "invalid_json", "Invalid JSON", "Handshake body must be valid JSON.");
        }
        const proto = String(body?.protocol_version ?? "1.0").trim();
        if (!proto.startsWith("1.")) {
          throw new HermaErr(
            400,
            "unsupported_protocol",
            "Unsupported Handshake Protocol",
            `Unsupported protocol_version '${proto}'; expected '1.0'.`
          );
        }
        const hdrSurf = (request.headers.get("x-surface-id") || "").trim();
        const bodySurf = body?.surface_id == null ? "" : String(body.surface_id).trim();
        if (hdrSurf && bodySurf && hdrSurf !== bodySurf) {
          throw new HermaErr(
            400,
            "surface_mismatch",
            "Surface ID Mismatch",
            `X-Surface-Id '${hdrSurf}' != body surface_id '${bodySurf}'.`
          );
        }
        const surfaceId = bodySurf || hdrSurf || "herma";
        if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(surfaceId)) {
          throw new HermaErr(400, "invalid_surface_id", "Invalid Surface ID", `Invalid surface_id '${surfaceId}'.`);
        }
        const reqMax = body?.requested_max_chars == null ? 4000 : Number(body.requested_max_chars);
        if (!Number.isFinite(reqMax) || reqMax < 0) {
          throw new HermaErr(400, "invalid_max_chars", "Invalid Max Chars", "requested_max_chars must be a non-negative integer.");
        }
        const clampedMaxChars = Math.max(120, Math.min(16000, Math.trunc(reqMax)));
        const [activeProvs, callerCtx] = await Promise.all([
          listProvisionsForCaller(db, principal.caller_scope, { includeBuiltin: true, enabledOnly: true }),
          listContextEntriesForCaller(db, principal.caller_scope, { includeBuiltin: true }),
        ]);
        const handshakeId = await sha256Hex(
          canonicalJson({
            backend: "herma",
            backend_version: HERMA_VERSION,
            protocol_version: "1.0",
            surface_id: surfaceId,
            harness_kind: principal.harness_kind,
            caller_scope: principal.caller_scope,
            clamped_max_chars: clampedMaxChars,
          })
        );
        return jsonResp(
          {
            protocol_version: "1.0",
            backend: "herma",
            backend_version: HERMA_VERSION,
            surface_id: surfaceId,
            harness_kind: principal.harness_kind,
            clamped_max_chars: clampedMaxChars,
            active_provisions: activeProvs.length,
            context_entries: callerCtx.length,
            transactional_db_exempt_from_middleware: true,
            capabilities: [
              "keyword_triggers",
              "semantic_triggers",
              "micromodel_triggers",
              "context_shimming",
              "respond_directly",
              "multi_wire_proxy",
              "caller_scope_isolation",
              "governance_lens_v1",
              "entity_memory_v1",
              "self_improving_insights_v1",
              "tessera_sync",
              "remote_handshake_sync",
              "surface_handshake_v1",
            ],
            handshake_id: handshakeId,
          },
          200,
          {
            "x-surface-id": surfaceId,
            "x-handshake-id": handshakeId,
          }
        );
      }

      if (path === "/v1/dry-run") {
        if (method !== "POST") return methodNotAllowed(["POST"]);
        const t0 = performance.now();
        enforceNotConsumerAssistant(request);
        const principal = await authenticateHarness(db, request, { isAdmin: isAdminRequest(request, env) });
        requireScope(principal, "route", request);
        const body = await request.json();
        const wireFormat = body.wire_format || "chat_completions";
        const payload = body.payload || {};
        const projectTag = parseProjectTag(request, body.project_tag ?? null);
        const cohort = parseCohortHeader(request);
        const envelope = extractEnvelope(wireFormat, payload, body.workspace_paths || []);
        const rawStored = await listProvisionsForCaller(db, principal.caller_scope, {
          includeBuiltin: true,
          enabledOnly: true,
        });
        const storedList = rawStored.filter((sp) =>
          provisionPassesLens(sp, { harnessKind: principal.harness_kind, cohort })
        );
        const matched = await evaluateProvisions(storedList, envelope.trigger_context, env, {offlineOnly: true});
        const allRefs = matched.flatMap((m) => m.stored.provision.context_refs || []);
        const contextMap = await getContextEntriesMapForCaller(db, allRefs, principal.caller_scope, {
          includeBuiltin: true,
        });
        for (const [id, entry] of Object.entries(contextMap)) {
          if (entry.governance && !passesGovernanceLens({governance: entry.governance}, {harnessKind: principal.harness_kind, cohort})) delete contextMap[id];
        }
        const entities = extractEntities(
          envelope.trigger_context.text,
          envelope.trigger_context.file_paths
        );
        const { augmented_payload, receipt } = await assembleAugmentedRequest(
          principal,
          envelope,
          payload,
          matched,
          8000,
          contextMap,
          { projectTag, entitiesTracked: entities.length }
        );
        const latencyMs = Math.max(0.05, performance.now() - t0);
        await recordTurnTelemetry(db, {
          callerScope: principal.caller_scope,
          projectTag,
          receipt,
          entities,
          promptText: envelope.trigger_context.text,
          latencyMs,
        });
        const dryHdrs = {
          "x-herma-entities-tracked": String(entities.length),
        };
        const reqSurf = (request.headers.get("x-surface-id") || "").trim();
        if (reqSurf) dryHdrs["x-surface-id"] = reqSurf;
        return jsonResp(
          {
            augmented_payload,
            matches: matched.map((m) => m.match),
            entities,
            receipt,
            responded_directly: receipt.responded_directly,
            direct_response_text: receipt.direct_response_text,
            shimmed_context_refs: receipt.shimmed_context_refs,
          },
          200,
          dryHdrs
        );
      }

      const wireMap = {
        "/v1/chat/completions": "chat_completions",
        "/v1/responses": "responses",
        "/v1/messages": "messages",
      };
      if (path in wireMap) {
        if (method !== "POST") return methodNotAllowed(["POST"]);
        const t0 = performance.now();
        enforceNotConsumerAssistant(request);
        const principal = await authenticateHarness(db, request, { isAdmin: isAdminRequest(request, env) });
        requireScope(principal, "route", request);
        const payload = await request.json();
        await reserveRouteRequest(db, principal.caller_scope);
        const wireFormat = wireMap[path];
        const projectTag = parseProjectTag(request);
        const cohort = parseCohortHeader(request);
        const envelope = extractEnvelope(wireFormat, payload, []);
        const rawStored = await listProvisionsForCaller(db, principal.caller_scope, {
          includeBuiltin: true,
          enabledOnly: true,
        });
        const storedList = rawStored.filter((sp) =>
          provisionPassesLens(sp, { harnessKind: principal.harness_kind, cohort })
        );
        const matched = await evaluateProvisions(storedList, envelope.trigger_context, env);
        const allRefs = matched.flatMap((m) => m.stored.provision.context_refs || []);
        const contextMap = await getContextEntriesMapForCaller(db, allRefs, principal.caller_scope, {
          includeBuiltin: true,
        });
        for (const [id, entry] of Object.entries(contextMap)) {
          if (entry.governance && !passesGovernanceLens({governance: entry.governance}, {harnessKind: principal.harness_kind, cohort})) delete contextMap[id];
        }
        const entities = extractEntities(
          envelope.trigger_context.text,
          envelope.trigger_context.file_paths
        );
        const { augmented_payload, receipt } = await assembleAugmentedRequest(
          principal,
          envelope,
          payload,
          matched,
          8000,
          contextMap,
          { projectTag, entitiesTracked: entities.length }
        );
        const latencyMs = Math.max(0.05, performance.now() - t0);
        await recordTurnTelemetry(db, {
          callerScope: principal.caller_scope,
          projectTag,
          receipt,
          entities,
          promptText: envelope.trigger_context.text,
          latencyMs,
        });

        const baseMetaHeaders = {
          "x-herma-receipt": receipt.receipt_sha256,
          "x-herma-receipt-sha256": receipt.receipt_sha256,
          "x-herma-provisions-fired": (receipt.provisions_fired || []).join(","),
          "x-herma-entities-tracked": String(entities.length),
        };
        const wireSurf = (request.headers.get("x-surface-id") || "").trim();
        if (wireSurf) baseMetaHeaders["x-surface-id"] = wireSurf;
        if (receipt.shimmed_context_refs?.length) {
          baseMetaHeaders["x-herma-shimmed-context"] = receipt.shimmed_context_refs.join(",");
        }

        if (receipt.responded_directly && receipt.direct_response_text != null) {
          const directBody = buildDirectProtocolResponse(wireFormat, receipt);
          return jsonResp(directBody, 200, {
            ...baseMetaHeaders,
            "x-herma-direct-response": "true",
          });
        }

        const resolvedUpstream = resolveUpstream(request, env, path);
        const targetUpstreamUrl = resolvedUpstream.url;
        const upKey = resolvedUpstream.key;
        const upHeaders = {"content-type": "application/json"};
        if (upKey) {
          if (wireFormat === "messages") {
            upHeaders["x-api-key"] = upKey;
            upHeaders["anthropic-version"] = request.headers.get("anthropic-version") || "2023-06-01";
          } else {
            upHeaders["authorization"] = `Bearer ${upKey}`;
          }
        }
        const upResp = await fetch(targetUpstreamUrl, {
          redirect: "manual",
          method: "POST",
          headers: upHeaders,
          body: JSON.stringify(augmented_payload),
        });
        const outHeaders = new Headers(upResp.headers);
        for (const [k, v] of Object.entries(baseMetaHeaders)) outHeaders.set(k, v);
        return withSecurity(new Response(upResp.body, { status: upResp.status, headers: outHeaders }));
      }

      if (path === "/v1/receipts") {
        if (method !== "GET") return methodNotAllowed(["GET"]);
        enforceNotConsumerAssistant(request);
        const principal = await authenticateHarness(db, request, { isAdmin: isAdminRequest(request, env) });
        requireScope(principal, "route", request);
        const limit = Number(url.searchParams.get("limit") || "25");
        const qProj = url.searchParams.get("project_tag");
        const hdrProj = (request.headers.get("x-herma-project") || "").trim();
        const projectTag = qProj !== null || hdrProj ? parseProjectTag(request, qProj) : null;
        return jsonResp({
          receipts: await listReceiptsForCaller(db, principal.caller_scope, { projectTag, limit }),
        });
      }

      if (path === "/v1/memory") {
        if (method !== "GET") return methodNotAllowed(["GET"]);
        enforceNotConsumerAssistant(request);
        const principal = await authenticateHarness(db, request, { isAdmin: isAdminRequest(request, env) });
        requireScope(principal, "route", request);
        const limit = Number(url.searchParams.get("limit") || "50");
        const kind = (url.searchParams.get("kind") || "").trim() || null;
        const qProj = url.searchParams.get("project_tag");
        const hdrProj = (request.headers.get("x-herma-project") || "").trim();
        const projectTag = qProj !== null || hdrProj ? parseProjectTag(request, qProj) : null;
        const entities = await listWorkingEntities(db, principal.caller_scope, {
          projectTag,
          kind,
          limit,
        });
        return jsonResp({
          caller_scope: principal.caller_scope,
          project_tag: projectTag,
          entities,
          count: entities.length,
        });
      }

      if (path === "/v1/outcomes") {
        if (method !== "POST") return methodNotAllowed(["POST"]);
        enforceNotConsumerAssistant(request);
        const principal = await authenticateHarness(db, request, { isAdmin: isAdminRequest(request, env) });
        requireScope(principal, "route", request);
        const body = await request.json();
        const headerProj = parseProjectTag(request);
        const outcomes = await recordExplicitOutcome(db, principal.caller_scope, body, headerProj);
        return jsonResp({ outcomes, count: outcomes.length });
      }

      if (path === "/v1/insights") {
        if (method !== "GET") return methodNotAllowed(["GET"]);
        enforceNotConsumerAssistant(request);
        const principal = await authenticateHarness(db, request, { isAdmin: isAdminRequest(request, env) });
        requireScope(principal, "route", request);
        const qProj = url.searchParams.get("project_tag");
        const hdrProj = (request.headers.get("x-herma-project") || "").trim();
        const projectTag = qProj !== null || hdrProj ? parseProjectTag(request, qProj) : null;
        return jsonResp(await buildInsights(db, principal.caller_scope, projectTag));
      }

      // 4. Authenticated `configure` endpoints (`/v1/context`, `/v1/provisions*`, `/v1/sync/tessera`, `/v1/sync/remote`)
      if (path === "/v1/context") {
        if (method !== "GET" && method !== "POST") return methodNotAllowed(["GET", "POST"]);
        const principal = await authenticateHarness(db, request, { isAdmin: isAdminRequest(request, env) });
        requireScope(principal, "configure", request);
        if (method === "GET") {
          const kind = (url.searchParams.get("kind") || "").trim() || null;
          const prefix = url.searchParams.get("prefix") || "";
          const refsParam = (url.searchParams.get("refs") || "").trim();
          let items;
          if (refsParam) {
            const refList = refsParam
              .split(",")
              .map((r) => r.trim())
              .filter(Boolean);
            const map = await getContextEntriesMapForCaller(db, refList, principal.caller_scope, {
              includeBuiltin: true,
            });
            items = refList.map((r) => map.get(r)).filter(Boolean);
            if (kind) items = items.filter((e) => e.kind === kind);
            if (prefix) items = items.filter((e) => e.entry_id.startsWith(prefix));
          } else {
            items = await listContextEntriesForCaller(db, principal.caller_scope, {
              includeBuiltin: true,
              kind,
              prefix,
            });
          }
          return jsonResp({ entries: items, count: items.length });
        }

        const body = await request.json();
        const evRaw = url.searchParams.get("expected_version");
        const expectedVersion = evRaw == null ? null : Number(evRaw);
        const checkCas = ["1", "true", "yes"].includes(
          (url.searchParams.get("check_cas") || "").toLowerCase()
        );
        const builtinFlag = ["1", "true", "yes"].includes(
          (url.searchParams.get("builtin") || "").toLowerCase()
        );
        const targetScope = principal.is_admin && builtinFlag ? SYSTEM_BUILTIN_SCOPE : principal.caller_scope;
        const rawList = Array.isArray(body?.entries) ? body.entries : [body];
        if (!rawList.length || rawList.length > 200) {
          throw new HermaErr(422, "validation_error", "Invalid Context Batch", "Provide 1..200 context entries.");
        }
        const saved = [];
        for (const item of rawList) {
          saved.push(
            await upsertContextEntry(db, item, {
              callerScope: targetScope,
              expectedVersion: rawList.length === 1 ? expectedVersion : null,
              checkCas: rawList.length === 1 ? checkCas : false,
              isAdmin: principal.is_admin,
            })
          );
        }
        return jsonResp({ entry: saved[0], entries: saved, count: saved.length });
      }

      if (path === "/v1/provisions") {
        if (method !== "GET") return methodNotAllowed(["GET"]);
        const principal = await authenticateHarness(db, request, { isAdmin: isAdminRequest(request, env) });
        requireScope(principal, "configure", request);
        const includeContext = ["1", "true", "yes"].includes(
          (url.searchParams.get("include_context") || "").toLowerCase()
        );
        const out = {
          provisions: await listProvisionsForCaller(db, principal.caller_scope, {
            includeBuiltin: true,
            enabledOnly: false,
          }),
        };
        if (includeContext) {
          out.context_entries = await listContextEntriesForCaller(db, principal.caller_scope, {
            includeBuiltin: true,
          });
        }
        return jsonResp(out);
      }

      const provMatch = /^\/v1\/provisions\/([^/]+)$/.exec(path);
      if (provMatch) {
        if (method !== "PUT" && method !== "DELETE") return methodNotAllowed(["PUT", "DELETE"]);
        const provId = decodeURIComponent(provMatch[1]);
        const principal = await authenticateHarness(db, request, { isAdmin: isAdminRequest(request, env) });
        requireScope(principal, "configure", request);
        const builtinFlag = ["1", "true", "yes"].includes(
          (url.searchParams.get("builtin") || "").toLowerCase()
        );
        const targetScope = principal.is_admin && builtinFlag ? SYSTEM_BUILTIN_SCOPE : principal.caller_scope;

        if (method === "PUT") {
          const prov = await request.json();
          if (prov.prov_id !== provId) {
            throw new HermaErr(400, "id_mismatch", "Provision ID Mismatch", `Path '${provId}' != body '${prov.prov_id}'.`);
          }
          const evRaw = url.searchParams.get("expected_version");
          const expectedVersion = evRaw == null ? null : Number(evRaw);
          const checkCas = ["1", "true", "yes"].includes(
            (url.searchParams.get("check_cas") || "").toLowerCase()
          );
          const saved = await putProvision(db, prov, {
            callerScope: targetScope,
            expectedVersion,
            sourceStore: `harness:${principal.harness_kind}`,
            checkCas,
            isAdmin: principal.is_admin,
          });
          return jsonResp(saved);
        }
        await deleteProvision(db, provId, { callerScope: targetScope, isAdmin: principal.is_admin });
        return jsonResp({ deleted: provId });
      }

      if (path === "/v1/sync/tessera") {
        if (method !== "POST") return methodNotAllowed(["POST"]);
        const principal = await authenticateHarness(db, request, { isAdmin: isAdminRequest(request, env) });
        requireScope(principal, "configure", request);
        const body = await request.json();
        const cohort = parseCohortHeader(request, body?.cohort ?? null);
        const targetScope = principal.is_admin && body?.builtin ? SYSTEM_BUILTIN_SCOPE : principal.caller_scope;
        const synced = await syncFromTesseraCloud(db, env, {
          ...body,
          callerScope: targetScope,
          harnessKind: principal.harness_kind,
          cohort,
          isAdmin: principal.is_admin,
        });
        return jsonResp({ synced: synced.map((s) => s.provision.prov_id), count: synced.length });
      }

      if (path === "/v1/sync/remote") {
        if (method !== "POST") return methodNotAllowed(["POST"]);
        const principal = await authenticateHarness(db, request, { isAdmin: isAdminRequest(request, env) });
        requireScope(principal, "configure", request);
        const body = await request.json();
        const cohort = parseCohortHeader(request, body?.cohort ?? null);
        const targetScope = principal.is_admin && body?.builtin ? SYSTEM_BUILTIN_SCOPE : principal.caller_scope;
        const root = String(body.base_url || "").replace(/\/+$/, "");
        const hsPath = body.handshake_path ?? "/v1/handshake";
        const prPath = body.provisions_path ?? "/v1/provisions";
        const sHeader = body.surface_header || "X-Surface-Id";
        const sId = body.surface_id || "herma";
        const hdrs = { [sHeader]: sId, accept: "application/json", "content-type": "application/json" };
        if (body.token) hdrs["authorization"] = `Bearer ${body.token}`;
        let clampedMax = 16000;
        if (hsPath) {
          const hs = await fetch(`${root}${hsPath}`, {
            method: "POST",
            headers: hdrs,
            body: JSON.stringify({ protocol_version: "1.0", surface_id: sId, requested_max_chars: 4000 }),
          });
          if (hs.ok) {
            const hd = await hs.json();
            if (hd?.clamped_max_chars != null) {
              clampedMax = Math.max(120, Math.min(16000, Number(hd.clamped_max_chars)));
            }
          }
        }
        const pr = await fetch(`${root}${prPath}`, { method: "GET", headers: hdrs });
        if (!pr.ok) {
          throw new HermaErr(502, "sync_failed", "Remote Sync Failed", `Upstream returned HTTP ${pr.status}.`);
        }
        const pd = await pr.json();
        if (Array.isArray(pd?.context_entries)) {
          for (const rawEntry of pd.context_entries) {
            if (
              !passesGovernanceLens(rawEntry, {
                namespace: "remote.context",
                harnessKind: principal.harness_kind,
                cohort,
              })
            ) {
              continue;
            }
            const cleanedEntry = stripGovernanceEnvelopeForContext(rawEntry);
            if (!principal.is_admin && (await hasBuiltinContextEntry(db, String(cleanedEntry?.entry_id || "")))) {
              continue;
            }
            await upsertContextEntry(db, cleanedEntry, {
              callerScope: targetScope,
              isAdmin: principal.is_admin,
            });
          }
        }
        const list = Array.isArray(pd) ? pd : pd.provisions || [];
        const synced = [];
        for (const item of list) {
          const rawProv =
            item && typeof item === "object" && item.provision && typeof item.provision === "object"
              ? { ...item.provision }
              : { ...item };
          if (
            !passesGovernanceLens(rawProv, {
              namespace: "remote.provisions",
              harnessKind: principal.harness_kind,
              cohort,
              extraEnvelope: item && typeof item === "object" ? item : null,
            })
          ) {
            continue;
          }
          const cleanedProv = stripGovernanceEnvelopeForProvision(rawProv, item);
          if (!principal.is_admin && (await hasBuiltinProvision(db, String(cleanedProv?.prov_id || "")))) {
            continue;
          }
          if (cleanedProv.max_chars > clampedMax) cleanedProv.max_chars = clampedMax;
          synced.push(
            await putProvision(db, cleanedProv, {
              callerScope: targetScope,
              sourceStore: "remote_handshake",
              checkCas: false,
              isAdmin: principal.is_admin,
            })
          );
        }
        return jsonResp({ synced: synced.map((s) => s.provision.prov_id), count: synced.length });
      }

      return problem(404, "not_found", "Not Found", `No route matches ${method} ${path}.`);
    } catch (err) {
      if (err instanceof HermaErr) {
        const response = problem(err.status, err.code, err.title, err.detail);
        if (err.status === 429) response.headers.set("Retry-After", "3600");
        return response;
      }
      return problem(500, "internal_error", "Internal Server Error", String(err?.message || err));
    }
  },
};

export default { fetch(request, env) { return agentFetch(request, env, (req, bindings) => application.fetch(req, bindings)); } };
