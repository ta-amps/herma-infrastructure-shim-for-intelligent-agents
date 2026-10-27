// Cloudflare Cloud Worker for Herma: 24/7 context-shimming AI middleware backed by Cloudflare D1
// (`ta-amps-herma`) + direct Service Binding to `tessera` Cloud (`env.TESSERA`), with optional
// `STORAGE_MODE = "origin"` reverse-proxy fallback.

import {
  ALLOWED_CONTEXT_KINDS,
  ALLOWED_HARNESS_KINDS,
  ALLOWED_URI_SCHEMES,
  DEFAULT_CONTEXT_ENTRIES,
  DEFAULT_PROVISIONS,
  HERMA_VERSION,
  HermaErr,
  assembleAugmentedRequest,
  authenticateHarness,
  buildDirectProtocolResponse,
  canonicalJson,
  constantTimeEqual,
  enforceNotConsumerAssistant,
  ensureContextTable,
  evaluateProvisions,
  extractEnvelope,
  parseTesseraContextRef,
  renderConnectHtml,
  renderOverviewHtml,
  requireScope,
  sha256Hex,
  validateContextEntry,
  validateProvisionPayload,
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
    updated_at: row.updated_at,
  };
}

async function ensureSeeded(db) {
  await ensureContextTable(db);
  const ctxStmts = DEFAULT_CONTEXT_ENTRIES.map((entry) =>
    db
      .prepare(
        "INSERT OR IGNORE INTO context_entries (entry_id, kind, title, summary, body_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(
        entry.entry_id,
        entry.kind,
        entry.title,
        entry.summary,
        canonicalJson({ schema_or_body: entry.schema_or_body, source_uri: entry.source_uri }),
        entry.updated_at
      )
  );
  if (ctxStmts.length) await db.batch(ctxStmts);

  const row = await db.prepare("SELECT COUNT(*) AS n FROM provisions").first();
  if (Number(row?.n || 0) < DEFAULT_PROVISIONS.length) {
    const now = Date.now() / 1000;
    const stmts = [];
    for (const prov of DEFAULT_PROVISIONS) {
      const bodyJson = canonicalJson(prov);
      const sha = await sha256Hex(bodyJson);
      stmts.push(
        db
          .prepare(
            "INSERT OR IGNORE INTO provisions (prov_id, version, content_sha256, source_store, body_json, updated_at) VALUES (?, 1, ?, 'examples', ?, ?)"
          )
          .bind(prov.prov_id, sha, bodyJson, now)
      );
    }
    if (stmts.length) await db.batch(stmts);

    // Upgrade untouched v1 examples seed of PROV-TESSERA-FENCING so context_refs are live immediately:
    const tf = await db
      .prepare("SELECT * FROM provisions WHERE prov_id = 'PROV-TESSERA-FENCING'")
      .first();
    if (tf && tf.source_store === "examples" && Number(tf.version) === 1) {
      const curBody = JSON.parse(tf.body_json);
      if (!curBody.context_refs || !curBody.context_refs.length) {
        const updatedDef = DEFAULT_PROVISIONS.find((p) => p.prov_id === "PROV-TESSERA-FENCING");
        if (updatedDef) {
          const updatedJson = canonicalJson(updatedDef);
          const updatedSha = await sha256Hex(updatedJson);
          await db
            .prepare(
              "UPDATE provisions SET content_sha256 = ?, body_json = ?, updated_at = ? WHERE prov_id = 'PROV-TESSERA-FENCING' AND source_store = 'examples'"
            )
            .bind(updatedSha, updatedJson, now)
            .run();
        }
      }
    }
  }
}

async function upsertContextEntry(db, rawEntry) {
  await ensureContextTable(db);
  const entry = validateContextEntry(rawEntry);
  const bodyJson = canonicalJson({
    schema_or_body: entry.schema_or_body,
    source_uri: entry.source_uri,
  });
  await db
    .prepare(
      "INSERT INTO context_entries (entry_id, kind, title, summary, body_json, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(entry_id) DO UPDATE SET kind = excluded.kind, title = excluded.title, summary = excluded.summary, body_json = excluded.body_json, updated_at = excluded.updated_at"
    )
    .bind(entry.entry_id, entry.kind, entry.title, entry.summary, bodyJson, entry.updated_at)
    .run();
  return entry;
}

async function listContextEntries(db, { kind = null, prefix = "" } = {}) {
  await ensureSeeded(db);
  let res;
  if (kind) {
    if (!ALLOWED_CONTEXT_KINDS.has(kind)) {
      throw new HermaErr(422, "validation_error", "Invalid Context Filter", "kind must be 'noun', 'verb', or 'detail'.");
    }
    res = await db
      .prepare("SELECT * FROM context_entries WHERE kind = ? ORDER BY entry_id ASC")
      .bind(kind)
      .all();
  } else {
    res = await db.prepare("SELECT * FROM context_entries ORDER BY entry_id ASC").all();
  }
  let items = (res.results || []).map(rowToContextEntry);
  if (prefix) {
    items = items.filter((e) => e.entry_id.startsWith(prefix));
  }
  return items;
}

async function getContextEntriesMap(db, refs) {
  const unique = [...new Set((refs || []).map((r) => String(r || "").trim()).filter(Boolean))];
  const map = new Map();
  if (!unique.length) return map;
  await ensureSeeded(db);
  const placeholders = unique.map(() => "?").join(",");
  const res = await db
    .prepare(`SELECT * FROM context_entries WHERE entry_id IN (${placeholders})`)
    .bind(...unique)
    .all();
  for (const row of res.results || []) {
    const entry = rowToContextEntry(row);
    map.set(entry.entry_id, entry);
  }
  return map;
}

async function listProvisions(db, enabledOnly = false) {
  await ensureSeeded(db);
  const res = await db.prepare("SELECT * FROM provisions").all();
  let items = (res.results || []).map((r) => ({
    provision: JSON.parse(r.body_json),
    version: Number(r.version),
    content_sha256: r.content_sha256,
    source_store: r.source_store,
    updated_at: Number(r.updated_at),
  }));
  if (enabledOnly) items = items.filter((s) => s.provision.enabled);
  items.sort((a, b) => b.provision.priority - a.provision.priority || a.provision.prov_id.localeCompare(b.provision.prov_id));
  return items;
}

async function putProvision(db, rawProv, { expectedVersion = null, sourceStore = "harness", checkCas = false } = {}) {
  const prov = validateProvisionPayload(rawProv);
  const cur = await db.prepare("SELECT * FROM provisions WHERE prov_id = ?").bind(prov.prov_id).first();
  const curVer = cur ? Number(cur.version) : null;
  if (checkCas && curVer !== expectedVersion) {
    throw new HermaErr(
      409,
      "version_conflict",
      "Provision Version Conflict",
      `Provision '${prov.prov_id}' expected version ${expectedVersion}, head is ${curVer}.`
    );
  }
  const bodyJson = canonicalJson(prov);
  const sha = await sha256Hex(bodyJson);
  const now = Date.now() / 1000;
  if (cur && cur.content_sha256 === sha && cur.source_store === sourceStore) {
    return {
      provision: prov,
      version: curVer,
      content_sha256: sha,
      source_store: sourceStore,
      updated_at: Number(cur.updated_at),
    };
  }
  const nextVer = (curVer || 0) + 1;
  await db
    .prepare(
      "INSERT INTO provisions (prov_id, version, content_sha256, source_store, body_json, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (prov_id) DO UPDATE SET version = excluded.version, content_sha256 = excluded.content_sha256, source_store = excluded.source_store, body_json = excluded.body_json, updated_at = excluded.updated_at"
    )
    .bind(prov.prov_id, nextVer, sha, sourceStore, bodyJson, now)
    .run();
  return {
    provision: prov,
    version: nextVer,
    content_sha256: sha,
    source_store: sourceStore,
    updated_at: now,
  };
}

async function recordReceipt(db, receipt) {
  await db
    .prepare(
      "INSERT INTO injection_receipts (receipt_id, receipt_sha256, conversation_id, harness_kind, protocol, model, matched_provisions, injected_uris, body_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      receipt.receipt_id,
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
    .run();
}

async function listReceipts(db, limit = 25) {
  const cap = Math.max(1, Math.min(Number(limit || 25), 200));
  const res = await db
    .prepare("SELECT * FROM injection_receipts ORDER BY created_at DESC LIMIT ?")
    .bind(cap)
    .all();
  return (res.results || []).map((r) => {
    if (r.body_json && r.body_json !== "{}") {
      try {
        const parsed = JSON.parse(r.body_json);
        return {
          responded_directly: false,
          direct_response_text: null,
          shimmed_context_refs: [],
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
      created_at: Number(r.created_at),
    };
  });
}

async function tesseraFetch(env, baseUrl, path, bearer) {
  const cleanBase = String(baseUrl || env.TESSERA_URL || "https://tessera.ta-amps.workers.dev").replace(/\/+$/, "");
  const headers = { authorization: `Bearer ${bearer}`, accept: "application/json" };
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
      schema_or_body: rawVal.schema_or_body ?? rawVal,
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

async function syncFromTesseraCloud(db, env, { base_url, bearer_token, namespace = "herma.provisions" }) {
  await ensureContextTable(db);
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
        if (cData?.value) await upsertContextEntry(db, cData.value);
      }
    }
  }

  const listResp = await tesseraFetch(env, base_url, `/v1/stores/${encodeURIComponent(namespace)}/records?limit=200`, bearer_token);
  let records = [];
  if (listResp.ok) {
    const body = await listResp.json();
    records = (body.records || []).filter((r) => r.key !== "index");
  } else {
    const idxResp = await tesseraFetch(env, base_url, `/v1/stores/${encodeURIComponent(namespace)}/records/index`, bearer_token);
    if (!idxResp.ok) {
      throw new HermaErr(502, "sync_failed", "Tessera Sync Failed", `Tessera returned HTTP ${idxResp.status}.`);
    }
    const idxData = await idxResp.json();
    for (const pid of idxData?.value?.prov_ids || []) {
      const r = await tesseraFetch(env, base_url, `/v1/stores/${encodeURIComponent(namespace)}/records/${encodeURIComponent(pid)}`, bearer_token);
      if (r.ok) records.push(await r.json());
    }
  }

  const synced = [];
  for (const rec of records) {
    const prov = structuredClone(rec.value);
    if (!prov || !prov.prov_id) continue;
    const resolvedUris = [];
    for (const u of prov.uris || []) {
      if (u.uri?.startsWith("tessera://blobs/") && !u.inline_excerpt) {
        const sha = u.uri.slice("tessera://blobs/".length).trim();
        const bResp = await tesseraFetch(env, base_url, `/v1/blobs/${sha}`, bearer_token);
        if (bResp.ok) {
          const text = (await bResp.text()).slice(0, 780);
          resolvedUris.push({ ...u, inline_excerpt: text });
          continue;
        }
      } else if (u.uri?.startsWith("tessera://buckets/") && !u.inline_excerpt) {
        const rest = u.uri.slice("tessera://buckets/".length);
        const slash = rest.indexOf("/");
        if (slash > 0) {
          const bucket = rest.slice(0, slash);
          const okey = rest.slice(slash + 1);
          const oResp = await tesseraFetch(env, base_url, `/v1/buckets/${bucket}/objects/${okey}`, bearer_token);
          if (oResp.ok) {
            const text = (await oResp.text()).slice(0, 780);
            resolvedUris.push({ ...u, inline_excerpt: text });
            continue;
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
          await upsertContextEntry(
            db,
            valueToContextEntry(ref, parsedRef.kind, parsedRef.storeNs, parsedRef.recKey, nData?.value)
          );
        }
      }
    }

    synced.push(await putProvision(db, prov, { sourceStore: `tessera_cloud:${namespace}`, checkCas: false }));
  }
  return synced;
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

export default {
  async fetch(request, env) {
    if ((env.STORAGE_MODE || "cloud") === "origin") {
      return proxyOrigin(request, env);
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();
    const publicUrl = (env.PUBLIC_URL || `${url.protocol}//${url.host}`).replace(/\/+$/, "") || DEFAULT_PUBLIC_URL;
    const db = env.HERMA_DB;

    try {
      // 1. Public health & read-only HTML status board
      if (path === "/api/health" || path === "/v1/health" || path === "/healthz") {
        if (method !== "GET" && method !== "HEAD") return methodNotAllowed(["GET", "HEAD"]);
        const [active, ctxEntries] = await Promise.all([listProvisions(db, true), listContextEntries(db)]);
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
        const [provs, rcpts, ctxEntries] = await Promise.all([
          listProvisions(db, false),
          listReceipts(db, 10),
          listContextEntries(db),
        ]);
        return withSecurity(
          new Response(renderOverviewHtml(provs, rcpts, publicUrl, ctxEntries), {
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

      // 2. Harness key bootstrap & administration (`/v1/admin/keys`)
      if (path === "/v1/admin/keys") {
        if (method !== "GET" && method !== "POST") return methodNotAllowed(["GET", "POST"]);
        const bootHdr = request.headers.get("x-bootstrap-secret") || "";
        const bootOk =
          (env.BOOTSTRAP_SECRET && constantTimeEqual(bootHdr, env.BOOTSTRAP_SECRET)) ||
          (env.EDGE_SECRET && constantTimeEqual(bootHdr, env.EDGE_SECRET));
        if (!bootOk) {
          const p = await authenticateHarness(db, request);
          requireScope(p, "configure", request);
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
        const idBytes = crypto.getRandomValues(new Uint8Array(6));
        const keyId = Array.from(idBytes, (b) => b.toString(16).padStart(2, "0")).join("");
        const rawBytes = crypto.getRandomValues(new Uint8Array(24));
        const rawSec = btoa(String.fromCharCode(...rawBytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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

      // 3. Authenticated `route` endpoints (`/v1/handshake`, `/v1/dry-run`, `/v1/chat/completions`, `/v1/responses`, `/v1/messages`, `/v1/receipts`)
      if (path === "/v1/handshake") {
        if (method !== "POST") return methodNotAllowed(["POST"]);
        enforceNotConsumerAssistant(request);
        const principal = await authenticateHarness(db, request);
        requireScope(principal, "route", request);
        let body;
        try {
          body = await request.json();
        } catch {
          throw new HermaErr(400, "invalid_json", "Invalid JSON", "Handshake body must be valid JSON.");
        }
        const proto = String(body?.protocol_version ?? "1.0").trim();
        if (!proto.startsWith("1.")) {
          throw new HermaErr(400, "unsupported_protocol", "Unsupported Handshake Protocol", `Unsupported protocol_version '${proto}'; expected '1.0'.`);
        }
        const hdrSurf = (request.headers.get("x-surface-id") || "").trim();
        const bodySurf = body?.surface_id == null ? "" : String(body.surface_id).trim();
        if (hdrSurf && bodySurf && hdrSurf !== bodySurf) {
          throw new HermaErr(400, "surface_mismatch", "Surface ID Mismatch", `X-Surface-Id '${hdrSurf}' != body surface_id '${bodySurf}'.`);
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
        const activeProvs = await listProvisions(db, true);
        const ctxRow = await db.prepare("SELECT COUNT(*) AS n FROM context_entries").first();
        const handshakeId = await sha256Hex(
          canonicalJson({
            backend: "herma",
            backend_version: HERMA_VERSION,
            protocol_version: "1.0",
            surface_id: surfaceId,
            harness_kind: principal.harness_kind,
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
            context_entries: Number(ctxRow?.n || 0),
            transactional_db_exempt_from_middleware: true,
            capabilities: [
              "keyword_triggers",
              "semantic_triggers",
              "micromodel_triggers",
              "context_shimming",
              "respond_directly",
              "multi_wire_proxy",
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
        enforceNotConsumerAssistant(request);
        const principal = await authenticateHarness(db, request);
        requireScope(principal, "route", request);
        const body = await request.json();
        const wireFormat = body.wire_format || "chat_completions";
        const payload = body.payload || {};
        const envelope = extractEnvelope(wireFormat, payload, body.workspace_paths || []);
        const storedList = await listProvisions(db, true);
        const matched = await evaluateProvisions(storedList, envelope.trigger_context, env);
        const allRefs = matched.flatMap((m) => m.stored.provision.context_refs || []);
        const contextMap = await getContextEntriesMap(db, allRefs);
        const { augmented_payload, receipt } = await assembleAugmentedRequest(
          principal,
          envelope,
          payload,
          matched,
          8000,
          contextMap
        );
        await recordReceipt(db, receipt);
        const dryHdrs = {};
        const reqSurf = (request.headers.get("x-surface-id") || "").trim();
        if (reqSurf) dryHdrs["x-surface-id"] = reqSurf;
        return jsonResp(
          {
            augmented_payload,
            matches: matched.map((m) => m.match),
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
        enforceNotConsumerAssistant(request);
        const principal = await authenticateHarness(db, request);
        requireScope(principal, "route", request);
        const payload = await request.json();
        const wireFormat = wireMap[path];
        const envelope = extractEnvelope(wireFormat, payload, []);
        const storedList = await listProvisions(db, true);
        const matched = await evaluateProvisions(storedList, envelope.trigger_context, env);
        const allRefs = matched.flatMap((m) => m.stored.provision.context_refs || []);
        const contextMap = await getContextEntriesMap(db, allRefs);
        const { augmented_payload, receipt } = await assembleAugmentedRequest(
          principal,
          envelope,
          payload,
          matched,
          8000,
          contextMap
        );
        await recordReceipt(db, receipt);

        const baseMetaHeaders = {
          "x-herma-receipt": receipt.receipt_sha256,
          "x-herma-receipt-sha256": receipt.receipt_sha256,
          "x-herma-provisions-fired": (receipt.provisions_fired || []).join(","),
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

        const upstreamBase = (request.headers.get("x-upstream-base-url") || env.UPSTREAM_LLM_URL || "").replace(/\/+$/, "");
        if (!upstreamBase) {
          throw new HermaErr(
            502,
            "missing_upstream",
            "Missing Upstream LLM Endpoint",
            "Set UPSTREAM_LLM_URL or X-Upstream-Base-Url, or call POST /v1/dry-run to inspect augmented payloads."
          );
        }
        const upHeaders = { "content-type": "application/json" };
        const upKey = request.headers.get("x-upstream-api-key") || env.UPSTREAM_LLM_API_KEY || "";
        if (upKey) {
          if (wireFormat === "messages") {
            upHeaders["x-api-key"] = upKey;
            upHeaders["anthropic-version"] = request.headers.get("anthropic-version") || "2023-06-01";
          } else {
            upHeaders["authorization"] = `Bearer ${upKey}`;
          }
        }
        const upResp = await fetch(`${upstreamBase}${path}`, {
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
        const principal = await authenticateHarness(db, request);
        requireScope(principal, "route", request);
        const limit = Number(url.searchParams.get("limit") || "25");
        return jsonResp({ receipts: await listReceipts(db, limit) });
      }

      // 4. Authenticated `configure` endpoints (`/v1/context`, `/v1/provisions*`, `/v1/sync/tessera`, `/v1/sync/remote`)
      if (path === "/v1/context") {
        if (method !== "GET" && method !== "POST") return methodNotAllowed(["GET", "POST"]);
        const principal = await authenticateHarness(db, request);
        requireScope(principal, "configure", request);
        if (method === "GET") {
          const kind = (url.searchParams.get("kind") || "").trim() || null;
          const prefix = url.searchParams.get("prefix") || "";
          const refsParam = (url.searchParams.get("refs") || "").trim();
          let items;
          if (refsParam) {
            const refList = refsParam.split(",").map((r) => r.trim()).filter(Boolean);
            const map = await getContextEntriesMap(db, refList);
            items = refList.map((r) => map.get(r)).filter(Boolean);
            if (kind) items = items.filter((e) => e.kind === kind);
            if (prefix) items = items.filter((e) => e.entry_id.startsWith(prefix));
          } else {
            items = await listContextEntries(db, { kind, prefix });
          }
          return jsonResp({ entries: items, count: items.length });
        }
        const body = await request.json();
        const rawList = Array.isArray(body?.entries) ? body.entries : [body];
        if (!rawList.length || rawList.length > 200) {
          throw new HermaErr(422, "validation_error", "Invalid Context Batch", "Provide 1..200 context entries.");
        }
        const saved = [];
        for (const item of rawList) {
          saved.push(await upsertContextEntry(db, item));
        }
        return jsonResp({ entry: saved[0], entries: saved, count: saved.length });
      }

      if (path === "/v1/provisions") {
        if (method !== "GET") return methodNotAllowed(["GET"]);
        const principal = await authenticateHarness(db, request);
        requireScope(principal, "configure", request);
        const includeContext = ["1", "true", "yes"].includes(
          (url.searchParams.get("include_context") || "").toLowerCase()
        );
        const out = { provisions: await listProvisions(db, false) };
        if (includeContext) out.context_entries = await listContextEntries(db, {});
        return jsonResp(out);
      }

      const provMatch = /^\/v1\/provisions\/([^/]+)$/.exec(path);
      if (provMatch) {
        if (method !== "PUT" && method !== "DELETE") return methodNotAllowed(["PUT", "DELETE"]);
        const provId = decodeURIComponent(provMatch[1]);
        const principal = await authenticateHarness(db, request);
        requireScope(principal, "configure", request);
        if (method === "PUT") {
          const prov = await request.json();
          if (prov.prov_id !== provId) {
            throw new HermaErr(400, "id_mismatch", "Provision ID Mismatch", `Path '${provId}' != body '${prov.prov_id}'.`);
          }
          const evRaw = url.searchParams.get("expected_version");
          const expectedVersion = evRaw == null ? null : Number(evRaw);
          const checkCas = ["1", "true", "yes"].includes((url.searchParams.get("check_cas") || "").toLowerCase());
          const saved = await putProvision(db, prov, {
            expectedVersion,
            sourceStore: `harness:${principal.harness_kind}`,
            checkCas,
          });
          return jsonResp(saved);
        }
        await db.prepare("DELETE FROM provisions WHERE prov_id = ?").bind(provId).run();
        return jsonResp({ deleted: provId });
      }

      if (path === "/v1/sync/tessera") {
        if (method !== "POST") return methodNotAllowed(["POST"]);
        const principal = await authenticateHarness(db, request);
        requireScope(principal, "configure", request);
        const body = await request.json();
        const synced = await syncFromTesseraCloud(db, env, body);
        return jsonResp({ synced: synced.map((s) => s.provision.prov_id), count: synced.length });
      }

      if (path === "/v1/sync/remote") {
        if (method !== "POST") return methodNotAllowed(["POST"]);
        const principal = await authenticateHarness(db, request);
        requireScope(principal, "configure", request);
        const body = await request.json();
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
            if (hd?.clamped_max_chars != null) clampedMax = Math.max(120, Math.min(16000, Number(hd.clamped_max_chars)));
          }
        }
        const pr = await fetch(`${root}${prPath}`, { method: "GET", headers: hdrs });
        if (!pr.ok) throw new HermaErr(502, "sync_failed", "Remote Sync Failed", `Upstream returned HTTP ${pr.status}.`);
        const pd = await pr.json();
        if (Array.isArray(pd?.context_entries)) {
          for (const entry of pd.context_entries) {
            await upsertContextEntry(db, entry);
          }
        }
        const list = Array.isArray(pd) ? pd : pd.provisions || [];
        const synced = [];
        for (const item of list) {
          const rawProv =
            item && typeof item === "object" && item.provision && typeof item.provision === "object"
              ? { ...item.provision }
              : { ...item };
          if (rawProv.max_chars > clampedMax) rawProv.max_chars = clampedMax;
          synced.push(await putProvision(db, rawProv, { sourceStore: "remote_handshake", checkCas: false }));
        }
        return jsonResp({ synced: synced.map((s) => s.provision.prov_id), count: synced.length });
      }

      return problem(404, "not_found", "Not Found", `No route matches ${method} ${path}.`);
    } catch (err) {
      if (err instanceof HermaErr) {
        return problem(err.status, err.code, err.title, err.detail);
      }
      return problem(500, "internal_error", "Internal Server Error", String(err?.message || err));
    }
  },
};
