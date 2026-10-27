// Cloudflare Cloud Worker for Herma: 24/7 programmable AI request middleware backed by Cloudflare D1
// (`ta-amps-herma`) + direct Service Binding to `tessera` Cloud (`env.TESSERA`), with optional
// `STORAGE_MODE = "origin"` reverse-proxy fallback.

import {
  ALLOWED_HARNESS_KINDS,
  DEFAULT_PROVISIONS,
  HERMA_VERSION,
  HermaErr,
  assembleAugmentedRequest,
  authenticateHarness,
  canonicalJson,
  constantTimeEqual,
  enforceNotConsumerAssistant,
  evaluateProvisions,
  extractEnvelope,
  renderConnectHtml,
  renderOverviewHtml,
  requireScope,
  sha256Hex,
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

function problem(status, code, title, detail) {
  return withSecurity(
    new Response(JSON.stringify({ type: "about:blank", title, status, detail, code }), {
      status,
      headers: { "content-type": "application/problem+json" },
    })
  );
}

function jsonResp(data, status = 200, extraHeaders = {}) {
  return withSecurity(
    new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json", ...extraHeaders },
    })
  );
}

async function ensureSeeded(db) {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM provisions").first();
  if (Number(row?.n || 0) > 0) return;
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

async function putProvision(db, prov, { expectedVersion = null, sourceStore = "harness", checkCas = false } = {}) {
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
        return JSON.parse(r.body_json);
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

async function syncFromTesseraCloud(db, env, { base_url, bearer_token, namespace = "herma.provisions" }) {
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
      if ((path === "/api/health" || path === "/v1/health" || path === "/healthz") && (method === "GET" || method === "HEAD")) {
        const active = await listProvisions(db, true);
        return jsonResp({
          ok: true,
          surface: "herma",
          version: HERMA_VERSION,
          storage: "cloudflare-d1",
          active_provisions: active.length,
          standard_mode_only: true,
          configurable_harnesses_only: true,
        });
      }
      if ((path === "/" || path === "/console") && (method === "GET" || method === "HEAD")) {
        const [provs, rcpts] = await Promise.all([listProvisions(db, false), listReceipts(db, 10)]);
        return withSecurity(
          new Response(renderOverviewHtml(provs, rcpts, publicUrl), {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          })
        );
      }
      if (path === "/connect" && (method === "GET" || method === "HEAD")) {
        return withSecurity(
          new Response(renderConnectHtml(publicUrl), {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          })
        );
      }

      // 2. Harness key bootstrap & administration (`/v1/admin/keys`)
      if (path === "/v1/admin/keys") {
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
        if (method === "POST") {
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
      }

      // 3. Authenticated `route` endpoints (`/v1/dry-run`, `/v1/chat/completions`, `/v1/responses`, `/v1/messages`, `/v1/receipts`)
      if (path === "/v1/dry-run" && method === "POST") {
        enforceNotConsumerAssistant(request);
        const principal = await authenticateHarness(db, request);
        requireScope(principal, "route", request);
        const body = await request.json();
        const wireFormat = body.wire_format || "chat_completions";
        const payload = body.payload || {};
        const envelope = extractEnvelope(wireFormat, payload, body.workspace_paths || []);
        const storedList = await listProvisions(db, true);
        const matched = await evaluateProvisions(storedList, envelope.trigger_context, env);
        const { augmented_payload, receipt } = await assembleAugmentedRequest(principal, envelope, payload, matched);
        await recordReceipt(db, receipt);
        return jsonResp({
          augmented_payload,
          matches: matched.map((m) => m.match),
          receipt,
        });
      }

      const wireMap = {
        "/v1/chat/completions": "chat_completions",
        "/v1/responses": "responses",
        "/v1/messages": "messages",
      };
      if (path in wireMap && method === "POST") {
        enforceNotConsumerAssistant(request);
        const principal = await authenticateHarness(db, request);
        requireScope(principal, "route", request);
        const payload = await request.json();
        const wireFormat = wireMap[path];
        const envelope = extractEnvelope(wireFormat, payload, []);
        const storedList = await listProvisions(db, true);
        const matched = await evaluateProvisions(storedList, envelope.trigger_context, env);
        const { augmented_payload, receipt } = await assembleAugmentedRequest(principal, envelope, payload, matched);
        await recordReceipt(db, receipt);

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
        outHeaders.set("x-herma-receipt-sha256", receipt.receipt_sha256);
        outHeaders.set("x-herma-provisions-fired", (receipt.provisions_fired || []).join(","));
        return withSecurity(new Response(upResp.body, { status: upResp.status, headers: outHeaders }));
      }

      if (path === "/v1/receipts" && method === "GET") {
        enforceNotConsumerAssistant(request);
        const principal = await authenticateHarness(db, request);
        requireScope(principal, "route", request);
        const limit = Number(url.searchParams.get("limit") || "25");
        return jsonResp({ receipts: await listReceipts(db, limit) });
      }

      // 4. Authenticated `configure` endpoints (`/v1/provisions*`, `/v1/sync/tessera`, `/v1/sync/remote`)
      if (path === "/v1/provisions" && method === "GET") {
        const principal = await authenticateHarness(db, request);
        requireScope(principal, "configure", request);
        return jsonResp({ provisions: await listProvisions(db, false) });
      }

      const provMatch = /^\/v1\/provisions\/([^/]+)$/.exec(path);
      if (provMatch) {
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
        if (method === "DELETE") {
          await db.prepare("DELETE FROM provisions WHERE prov_id = ?").bind(provId).run();
          return jsonResp({ deleted: provId });
        }
      }

      if (path === "/v1/sync/tessera" && method === "POST") {
        const principal = await authenticateHarness(db, request);
        requireScope(principal, "configure", request);
        const body = await request.json();
        const synced = await syncFromTesseraCloud(db, env, body);
        return jsonResp({ synced: synced.map((s) => s.provision.prov_id), count: synced.length });
      }

      if (path === "/v1/sync/remote" && method === "POST") {
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
        const list = Array.isArray(pd) ? pd : pd.provisions || [];
        const synced = [];
        for (const item of list) {
          if (item.max_chars > clampedMax) item.max_chars = clampedMax;
          synced.push(await putProvision(db, item, { sourceStore: "remote_handshake", checkCas: false }));
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
