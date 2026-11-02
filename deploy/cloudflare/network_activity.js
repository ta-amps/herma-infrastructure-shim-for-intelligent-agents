// The network map's data (design contract claude-design-network-map.v1.json, owner request of Nov 1): where workers connect
// to the shared queue and which kinds of Task they pick up. Surfaces: Agora /network/, the Eranos home strip, the Teleion Labs strip.
//
// What is recorded, per claim, and nothing else: the Cloudflare data center the request came through (request.cf.colo, an airport
// code such as FRA), the continent (request.cf.continent), the kind of Task, the kind of worker, the model it declared or ran and, for a
// dedicated worker, its persona. Never an IP address, a city, a coordinate, a network number, a user agent or a key. The codes come from
// Cloudflare's own request metadata; nothing a client sends can set them.
//
// What is shown (GET /q/network, public, no key): a claim names its data center only when 2 or more workers of its kind made claims there
// in the 15 minutes up to it; every other claim counts under its continent. The feed, the replay and the place list all follow that one
// decision per claim, so no view can name the data center of a worker that was alone. A worker that set show_on_map to false counts in
// the totals only and, from then on, keeps no data center or continent in its rows; so does a claim of work that is not public, which also
// lends the map no title or link. The choice belongs to the worker: it is applied only with that worker's own token (or when the worker is
// created in the same call). A claim's fields are kept for 30 days (the replay and the totals); after that only a count per day and
// continent remains (herma_claim_daily). Tessera's own aggregate (its /v1/public/activity/map) is merged in through the TESSERA binding by
// the pure merge in network_merge.js, which accepts a Tessera data center only as far as Tessera's own counts show it. Stored rows are never
// changed; every worker-written string goes through the shared word list (tidyText) on its way out (MUST-FOLLOW rule 16).

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
  tessera_missing_seconds: 300, // a 404 from Tessera (no such endpoint yet) is remembered this long
  retention_days: 30,
  prune_every_seconds: 3600, // old claims are looked for on a read or a claim at most this often in an isolate
  reads_per_minute_per_address: 120, // a generous cap per address in an isolate; a service-binding caller has no address and is not limited
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

const SHOW_WORDS = new Set(["true", "1", "yes", "y", "on", "t", "show", "shown", "visible", "enable", "enabled"]);

/**
 * Parse a show_on_map setting from a body field or a query string: true, false, or undefined when none was given.
 * Only a clear yes shows a worker. Any other value that is given ("off", "disabled", "hide", "n", " False ", a typo, 2) means off: the side
 * that keeps a worker off the map.
 */
export function parseShowOnMap(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const text = String(value).trim().toLowerCase();
  if (!text) return undefined;
  return SHOW_WORDS.has(text);
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
    // A worker that left the map keeps no data center and no continent from then on, as Tessera does: its row says only that a claim happened.
    const hidden = "COALESCE((SELECT show_on_map FROM herma_worker_registry WHERE worker_uuid = ?4), 1) = 0";
    await db
      .prepare(
        `INSERT INTO herma_claim_edge (claimed_at, task_id, kind, worker_uuid, worker_kind, colo, continent, model, persona)
         SELECT ?1, ?2, ?3, ?4, ?5, CASE WHEN ${hidden} THEN '' ELSE ?6 END, CASE WHEN ${hidden} THEN '' ELSE ?7 END, ?8, ?9`
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
    await maybePruneClaimEdges(db); // per-claim fields are kept for 30 days (the replay and the totals); older rows are reduced to a count
    return true;
  } catch {
    return false;
  }
}

let lastPruneMs = 0;

/**
 * Looks for claims older than 30 days on a claim or a read, at most once an hour in an isolate, and rolls them up when there are any.
 * It does not wait for a certain row id, so a quiet week still gets cleaned by the next read or claim. Best effort: it never fails what it rides on.
 */
export async function maybePruneClaimEdges(db, nowMs = Date.now()) {
  if (nowMs - lastPruneMs < NETWORK_GRID.prune_every_seconds * 1000) return false;
  lastPruneMs = nowMs; // set first, so reads that arrive together in an isolate do not all look
  try {
    const cutoff = new Date(nowMs - NETWORK_GRID.retention_days * 86400000).toISOString();
    const stale = await db.prepare("SELECT 1 AS stale FROM herma_claim_edge WHERE claimed_at < ? LIMIT 1").bind(cutoff).first();
    if (!stale) return false;
    await pruneClaimEdges(db, new Date(nowMs).toISOString());
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

// Work a public page may name: the same visibilities the public queue and the dashboard show. Anything else (server_infra, a Task that is
// gone, a value nobody knows) counts in the totals only and lends the map no title, place or link.
const PUBLIC_VISIBILITY = new Set(["public_ngo", "public_commons"]);

/** Herma's own claims in the last 24 hours as the merge reads them (one object per claim). */
export async function readOwnClaims(db, nowMs) {
  await ensureNetworkSchema(db);
  const since = new Date(nowMs - 24 * 3600 * 1000).toISOString();
  const { results } = await db
    .prepare(
      `SELECT e.claimed_at AS at, e.kind AS class, e.worker_uuid AS worker, e.worker_kind, e.colo, e.continent, e.model, e.persona,
              e.task_id, COALESCE(r.show_on_map, 1) AS show_on_map, COALESCE(r.is_diagnostic_probe, 0) AS probe,
              q.title AS title, q.locale_country AS place_facet, q.visibility AS visibility
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
    .map((r) => {
      const open = PUBLIC_VISIBILITY.has(String(r.visibility || ""));
      return {
        at: r.at,
        class: r.class,
        worker: r.worker,
        worker_kind: r.worker_kind,
        colo: r.colo || null,
        continent: r.continent || null,
        show_on_map: Number(r.show_on_map) !== 0 && open, // not public work: the totals only
        model: r.model || null,
        declared: r.worker_kind === "volunteer" && Boolean(r.model),
        persona: r.persona || null,
        title: open ? r.title || null : null,
        place: open ? COUNTRY_NAMES[String(r.place_facet || "").toUpperCase()] || null : null,
        object_key: open ? r.task_id : null,
      };
    });
}

// Tessera's aggregate is read at most once every 15 seconds in an isolate, never per visitor. A 404 (the endpoint is not there yet) is
// remembered for 5 minutes, so a map without Tessera does not spend a Worker request on it with every cold read.
const tesseraCache = new Map();
let tesseraMissingUntil = 0;

export async function readTesseraView(env, replay, nowMs, fetchImpl) {
  if (nowMs < tesseraMissingUntil) return null;
  const key = replay ? "replay" : "window";
  const hit = tesseraCache.get(key);
  if (hit && nowMs - hit.at < NETWORK_GRID.cache_seconds * 1000) return hit.view;
  let view = null;
  try {
    const call = fetchImpl || (env?.TESSERA ? (url, init) => env.TESSERA.fetch(url, init) : null);
    if (call) {
      const url = `${NETWORK_GRID.tessera_origin}${NETWORK_GRID.tessera_path}?window=24h${replay ? "&replay=1" : ""}`;
      const res = await call(url, { method: "GET", headers: { accept: "application/json" }, signal: AbortSignal.timeout(NETWORK_GRID.tessera_timeout_ms) });
      if (res.status === 200) {
        view = await res.json();
      } else {
        if (res.status === 404) tesseraMissingUntil = nowMs + NETWORK_GRID.tessera_missing_seconds * 1000;
        await res.body?.cancel();
      }
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
  await maybePruneClaimEdges(db, nowMs); // old claims are rolled up by age on a read, not only when a claim arrives
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
  tesseraMissingUntil = 0;
  lastPruneMs = 0;
  addressHits.clear();
}

// A generous cap per address, so one script cannot spend the account's daily Worker requests on this public route. It counts in an isolate's
// memory for the minute, as a salted number: the address itself is held nowhere and written nowhere. A caller through a service binding (the
// Eranos strip) has no address and is not limited.
const addressHits = new Map();
let addressMinute = 0;
let addressSalt = 0;

function secondsToWait(request, env, nowMs) {
  const address = String(request.headers.get("cf-connecting-ip") || "").trim();
  if (!address) return 0;
  const limit = Math.max(1, Number(env?.NETWORK_READS_PER_MINUTE) || NETWORK_GRID.reads_per_minute_per_address);
  const minute = Math.floor(nowMs / 60000);
  if (minute !== addressMinute || addressHits.size > 20000) {
    addressHits.clear();
    addressMinute = minute;
  }
  if (!addressSalt) addressSalt = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  let key = addressSalt;
  for (let i = 0; i < address.length; i += 1) key = Math.imul(key ^ address.charCodeAt(i), 16777619) >>> 0;
  const used = (addressHits.get(key) || 0) + 1;
  addressHits.set(key, used);
  return used > limit ? Math.max(1, Math.ceil(60 - ((nowMs / 1000) % 60))) : 0;
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
  const wait = secondsToWait(request, env, Date.now());
  if (wait) {
    return new Response(JSON.stringify({ ok: false, code: "rate_limited", detail: "too many reads of the network map from this address; try again shortly", retry_after: wait }), {
      status: 429,
      headers: { "content-type": "application/json; charset=utf-8", "retry-after": String(wait), "cache-control": "no-store", ...cors },
    });
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
