// The network map's data (design contract claude-design-network-map.v1.json, owner request of Nov 1): where workers connect
// to the shared queue and which kinds of Task they pick up. Surfaces: Agora /network/, the Eranos home strip, the Teleion Labs strip.
//
// What is recorded, per claim, and nothing else: the Cloudflare data center the request came through (request.cf.colo, an airport
// code such as FRA), the continent (request.cf.continent), the kind of Task, the kind of worker, the model it declared or ran and, for a
// dedicated worker, its persona. Never an IP address, a city, a coordinate, a network number, a user agent or a key. The codes come from
// Cloudflare's own request metadata; nothing a client sends can set them.
//
// What is shown (GET /q/network, public, no key): a data center appears only when 2 or more distinct workers of the same kind came
// through it in the last 24 hours; otherwise its workers count under the continent. A worker that set show_on_map to false counts in
// the totals only. A claim's fields are kept for 30 days (the replay and the totals); after that only a count per day and continent
// remains (herma_claim_daily). Tessera's own aggregate (its /v1/public/activity/map) is merged in through the TESSERA binding by the pure
// merge in network_merge.js, which applies the threshold to each source separately. Stored rows are never changed; every worker-written
// string goes through the shared word list (tidyText) on its way out (MUST-FOLLOW rule 16).

import MODEL_CATALOG from "../../herma/model_catalog.json" with { type: "json" };
import { mergeNetwork } from "./network_merge.js";
import PLACES from "./network_places.json" with { type: "json" };
import { tidyText } from "./page_shell.js";

/** What every agent is told about the network map (the agent brief, /help and the join response). */
export const NETWORK_MAP_NOTICE =
  "Your agent's claims appear on the network map by Cloudflare data center, never by IP address or home. To leave them out, set show_on_map to false when your worker joins.";

export const NETWORK_GRID = Object.freeze({
  cache_seconds: 15,
  stale_seconds: 30,
  tessera_timeout_ms: 3000,
  retention_days: 30,
  rows_limit: 5000,
  tessera_path: "/v1/public/activity/map",
  tessera_origin: "https://tessera.teleionlabs.com",
  allowed_origins: Object.freeze([
    "https://eranosforgood.org",
    "https://agora.eranosforgood.org",
    "https://teleionlabs.com",
    "https://eranos.ta-amps.workers.dev",
    "https://agora.ta-amps.workers.dev",
  ]),
});

const KIND_PARAMS = new Set(["all", "nonprofit", "shared", "check", "own"]);
const CONTINENT_CODES = new Set(["AF", "AN", "AS", "EU", "NA", "OC", "SA"]);
const DEDICATED_AGENT = /^(eranos|ta-amps)[-_. ]/i;

const MODEL_NAMES = Object.freeze(Object.fromEntries((MODEL_CATALOG.models || []).filter((m) => m.id && m.name).map((m) => [m.id, m.name])));
const COUNTRY_NAMES = Object.freeze(Object.fromEntries(Object.values(PLACES.places).map((p) => [p.country, p.country_name])));

/** The map's kind of a claimed Task: nonprofit, shared, check or own. */
export function networkKind(task = {}) {
  const tier = String(task.tier || "");
  const verbKind = String(task.verb_kind || "");
  const taskId = String(task.task_id || "");
  if (verbKind === "eval_and_rank" || /review/.test(verbKind) || /^verb_(evl|peer_review)/.test(taskId)) return "check";
  if (tier === "ngo_priority" || tier === "ngo_public_good") return "nonprofit";
  if (verbKind === "worker_self_directed") return "own";
  return "shared";
}

/** A dedicated worker is one that ta-amps or Eranos runs; every other worker is a volunteer's AI (the page never claims more than it knows). */
export const networkWorkerKind = (agentId) => (DEDICATED_AGENT.test(String(agentId || "")) ? "dedicated" : "volunteer");

const colo3 = (value) => (typeof value === "string" && /^[A-Z]{3}$/.test(value) ? value : "");
const continent2 = (value) => (typeof value === "string" && CONTINENT_CODES.has(value) ? value : "");

/** Parse a show_on_map setting from a body field or a query string: true, false, or undefined when none was given. */
export function parseShowOnMap(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === true || value === 1 || /^(1|true|yes|on)$/i.test(String(value))) return true;
  if (value === false || value === 0 || /^(0|false|no|off)$/i.test(String(value))) return false;
  return undefined;
}

const ready = new WeakSet();

export async function ensureNetworkSchema(db) {
  if (!db || ready.has(db)) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS herma_claim_edge (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        claimed_at TEXT NOT NULL,
        task_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        worker_uuid TEXT NOT NULL,
        worker_kind TEXT NOT NULL,
        colo TEXT NOT NULL DEFAULT '',
        continent TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        persona TEXT NOT NULL DEFAULT ''
      )`
    )
    .run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_herma_claim_edge_time ON herma_claim_edge(claimed_at)").run();
  // What is left of a claim after 30 days: a count per day and continent, with no worker, model, data center or Task.
  await db
    .prepare("CREATE TABLE IF NOT EXISTS herma_claim_daily (day TEXT NOT NULL, continent TEXT NOT NULL DEFAULT '', claims INTEGER NOT NULL, PRIMARY KEY (day, continent))")
    .run();
  try {
    await db.prepare("ALTER TABLE herma_worker_registry ADD COLUMN show_on_map INTEGER NOT NULL DEFAULT 1").run();
  } catch {
    // the column is already there
  }
  ready.add(db);
}

/** Set whether a worker's claims may appear on the map. It applies from the next request. */
export async function setShowOnMap(db, workerUuid, show) {
  if (!db || !workerUuid || typeof show !== "boolean") return;
  await ensureNetworkSchema(db);
  await db.prepare("UPDATE herma_worker_registry SET show_on_map = ? WHERE worker_uuid = ?").bind(show ? 1 : 0, String(workerUuid)).run();
}

/**
 * Record the edge facts of a new claim. Best effort: a claim never fails because the map could not be written.
 * `request` supplies only request.cf; nothing a client sent is read.
 */
export async function recordClaimEdge(db, request, { task, workerUuid, agentId, modelHint = "", persona = "", nowIso = new Date().toISOString() } = {}) {
  try {
    if (!db || !task?.task_id || !workerUuid) return false;
    await ensureNetworkSchema(db);
    const cf = request?.cf || {};
    const workerKind = networkWorkerKind(agentId);
    const result = await db
      .prepare(
        `INSERT INTO herma_claim_edge (claimed_at, task_id, kind, worker_uuid, worker_kind, colo, continent, model, persona)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        nowIso,
        String(task.task_id).slice(0, 160),
        networkKind(task),
        String(workerUuid).slice(0, 80),
        workerKind,
        colo3(cf.colo),
        continent2(cf.continent),
        String(modelHint || "").trim().toLowerCase().slice(0, 64),
        workerKind === "dedicated" ? String(persona || "").slice(0, 120) : ""
      )
      .run();
    // Per-claim fields are kept for 30 days (the replay and the totals); older rows are reduced to a count now and then.
    if (Number(result?.meta?.last_row_id || 0) % 25 === 0) await pruneClaimEdges(db, nowIso);
    return true;
  } catch {
    return false;
  }
}

/**
 * Claims older than 30 days are reduced to a count per day and continent and removed. The count and the removal run as one batch, so the
 * same claim is never counted twice, and running this again changes nothing.
 */
export async function pruneClaimEdges(db, nowIso = new Date().toISOString()) {
  await ensureNetworkSchema(db);
  const cutoff = new Date(Date.parse(nowIso) - NETWORK_GRID.retention_days * 86400000).toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO herma_claim_daily (day, continent, claims)
         SELECT substr(claimed_at, 1, 10), continent, COUNT(*) FROM herma_claim_edge WHERE claimed_at < ?1 GROUP BY 1, 2
         ON CONFLICT (day, continent) DO UPDATE SET claims = claims + excluded.claims`
      )
      .bind(cutoff),
    db.prepare("DELETE FROM herma_claim_edge WHERE claimed_at < ?1").bind(cutoff),
  ]);
}

/** Herma's own claims in the last 24 hours as the merge reads them (one object per claim). */
export async function readOwnClaims(db, nowMs) {
  await ensureNetworkSchema(db);
  const since = new Date(nowMs - 24 * 3600 * 1000).toISOString();
  const { results } = await db
    .prepare(
      `SELECT e.claimed_at AS at, e.kind AS class, e.worker_uuid AS worker, e.worker_kind, e.colo, e.continent, e.model, e.persona,
              e.task_id, COALESCE(r.show_on_map, 1) AS show_on_map, COALESCE(r.is_diagnostic_probe, 0) AS probe,
              q.title AS title, q.locale_country AS place_facet
         FROM herma_claim_edge e
         LEFT JOIN herma_worker_registry r ON r.worker_uuid = e.worker_uuid
         LEFT JOIN herma_durable_queue q ON q.task_id = e.task_id
        WHERE e.claimed_at >= ?
        ORDER BY e.claimed_at DESC
        LIMIT ?`
    )
    .bind(since, NETWORK_GRID.rows_limit)
    .all();
  return (results || [])
    .filter((r) => !Number(r.probe))
    .map((r) => ({
      at: r.at,
      class: r.class,
      worker: r.worker,
      worker_kind: r.worker_kind,
      colo: r.colo || null,
      continent: r.continent || null,
      show_on_map: Number(r.show_on_map) !== 0,
      model: r.model || null,
      declared: r.worker_kind === "volunteer" && Boolean(r.model),
      persona: r.persona || null,
      title: r.title || null,
      place: COUNTRY_NAMES[String(r.place_facet || "").toUpperCase()] || null,
      object_key: r.task_id,
    }));
}

// Tessera's aggregate is read at most once every 15 seconds in an isolate, never per visitor.
const tesseraCache = new Map();

export async function readTesseraView(env, replay, nowMs, fetchImpl) {
  const key = replay ? "replay" : "window";
  const hit = tesseraCache.get(key);
  if (hit && nowMs - hit.at < NETWORK_GRID.cache_seconds * 1000) return hit.view;
  let view = null;
  try {
    const call = fetchImpl || (env?.TESSERA ? (url, init) => env.TESSERA.fetch(url, init) : null);
    if (call) {
      const url = `${NETWORK_GRID.tessera_origin}${NETWORK_GRID.tessera_path}?window=24h${replay ? "&replay=1" : ""}`;
      const res = await call(url, { method: "GET", headers: { accept: "application/json" }, signal: AbortSignal.timeout(NETWORK_GRID.tessera_timeout_ms) });
      if (res.status === 200) view = await res.json();
    }
  } catch {
    view = null; // not live yet, or not answering: no direct claims from Tessera
  }
  tesseraCache.set(key, { at: nowMs, view });
  return view;
}

const bodyCache = new Map();

/** The response body of GET /q/network, built from Herma's claims and Tessera's aggregate. */
export async function buildNetworkBody({ db, env, kind = "all", replay = false, nowMs = Date.now(), fetchImpl } = {}) {
  const wanted = KIND_PARAMS.has(kind) ? kind : "all";
  const key = `${wanted}|${replay ? 1 : 0}`;
  const hit = bodyCache.get(key);
  if (hit && nowMs - hit.at < NETWORK_GRID.cache_seconds * 1000) return hit.body;
  const [own, tessera] = await Promise.all([readOwnClaims(db, nowMs), readTesseraView(env, replay, nowMs, fetchImpl)]);
  const body = mergeNetwork({
    now: nowMs,
    own,
    tessera,
    places: PLACES.places,
    modelNames: MODEL_NAMES,
    kind: wanted,
    replay,
    text: (value) => tidyText(value, 160),
  });
  bodyCache.set(key, { at: nowMs, body });
  return body;
}

/** For tests: forget what the isolate remembers. */
export function resetNetworkCaches() {
  tesseraCache.clear();
  bodyCache.clear();
}

// The contract allows the three sites' browsers (and their workers.dev addresses), not every origin: the response says "restricted" and the
// Worker's open CORS default leaves its allow-origin header alone. Other callers (curl, agents, servers) are not affected by CORS at all.
function corsHeaders(request) {
  const origin = request.headers.get("origin") || "";
  const base = { vary: "Origin", "x-herma-cors": "restricted" };
  if (!NETWORK_GRID.allowed_origins.includes(origin)) return base;
  return { ...base, "access-control-allow-origin": origin };
}

/** GET (and HEAD) /q/network, public. Returns a Response; the caller adds the Worker's security headers. */
export async function handleNetworkRequest(request, url, { db, env, fetchImpl } = {}) {
  const method = request.method.toUpperCase();
  const cors = corsHeaders(request);
  if (method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (method !== "GET" && method !== "HEAD") {
    return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), { status: 405, headers: { "content-type": "application/json; charset=utf-8", allow: "GET, HEAD, OPTIONS", ...cors } });
  }
  const replay = url.searchParams.get("replay") === "1";
  const kind = (url.searchParams.get("kind") || "all").toLowerCase();
  const body = await buildNetworkBody({ db, env, kind, replay, fetchImpl });
  return new Response(method === "HEAD" ? null : JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${NETWORK_GRID.cache_seconds}, stale-while-revalidate=${NETWORK_GRID.stale_seconds}`,
      ...cors,
    },
  });
}
