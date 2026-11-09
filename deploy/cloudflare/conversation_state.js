// Conversation coordination, not a work queue. Tessera owns executable tasks.
import { DurableObject } from "cloudflare:workers";
import { ConversationError, fail, hash, scaledInteger, validateTurn, loadContracts, loadProviderPlan, operatorGrant, requireDirectGrant, upstreamIdentity, providerConfig, providerCredential, buildRequest, requestModel, parseProposal, blocked, usageFor } from "./conversation.js";
export { bilateralChatGrid, bilateralTopics, resolveBilateralBounds, normalizeSessionMemory, loadEphemeralChatSession, saveEphemeralChatSession } from "./conversation.js";
import { isOpenFreeWindow } from "./herma_engine.js";
import { operatorPolicy, freshHealth, admitHealth, settleHealth, healthView, limitReason, ACCOUNT_LIMITS, IDENTITY_LIMITS } from "./provider_health.js";

const DAY = 86400000;
const rows = (sql, query, ...args) => sql.exec(query, ...args).toArray();
const first = (sql, query, ...args) => rows(sql, query, ...args)[0];
const failure = error => ({ status: error instanceof ConversationError ? error.status : 500, body: { code: error instanceof ConversationError ? error.code : "conversation_internal_error" } });
const responseStatus = response => response.error_code === "provider_budget_exhausted" ? 429 : 200;
const reservationDenials = new Set(["invalid_budget_reservation", "invalid_provider_configuration", "reservation_replay", "provider_budget_exhausted", "provider_ledger_unavailable", "provider_operator_disabled", "provider_backpressure", "provider_recovery_probe_required", "provider_recovery_probe_inflight", "provider_outcome_reconciliation_required", "provider_identity_cooldown"]);
const COUNTED_PUBLIC_META_OUTCOMES = "('reserved', 'completed', 'rate_limited', 'upstream_error', 'rejected')";
const INITIALIZED_META_LOG_DBS = new WeakSet();
const META_LOG_COL_CACHE = new WeakMap();

async function ensureMetaCallLogSchema(db) {
  if (!db || typeof db.prepare !== "function") throw new Error("meta_ledger_db_missing");
  if (INITIALIZED_META_LOG_DBS.has(db) && META_LOG_COL_CACHE.has(db)) {
    return META_LOG_COL_CACHE.get(db);
  }
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS herma_meta_call_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      agent_id TEXT NOT NULL DEFAULT '',
      worker_uuid TEXT NOT NULL DEFAULT '',
      task_id TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL,
      requested_model TEXT NOT NULL,
      reported_model TEXT NOT NULL DEFAULT '',
      http_status INTEGER NOT NULL DEFAULT 0,
      outcome TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_effort TEXT NOT NULL DEFAULT '',
      estimated_microusd INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      shimmed_object_count INTEGER NOT NULL DEFAULT 0,
      shimmed_provision_count INTEGER NOT NULL DEFAULT 0,
      prompt_sha256 TEXT NOT NULL DEFAULT '',
      response_sha256 TEXT NOT NULL DEFAULT '',
      error_code TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )`
  ).run();
  const colSet = new Set();
  const pragmaRes = await db.prepare("PRAGMA table_info(herma_meta_call_log)").all();
  for (const col of pragmaRes?.results || []) {
    if (col?.name) colSet.add(String(col.name));
  }
  const requiredAdditions = [
    ["agent_id", "TEXT NOT NULL DEFAULT ''"],
    ["worker_uuid", "TEXT NOT NULL DEFAULT ''"],
    ["task_id", "TEXT NOT NULL DEFAULT ''"],
    ["requested_model", "TEXT NOT NULL DEFAULT 'muse-spark-1.3'"],
    ["reported_model", "TEXT NOT NULL DEFAULT ''"],
    ["http_status", "INTEGER NOT NULL DEFAULT 0"],
    ["outcome", "TEXT NOT NULL DEFAULT 'reserved'"],
    ["input_tokens", "INTEGER NOT NULL DEFAULT 0"],
    ["output_tokens", "INTEGER NOT NULL DEFAULT 0"],
    ["reasoning_tokens", "INTEGER NOT NULL DEFAULT 0"],
    ["reasoning_effort", "TEXT NOT NULL DEFAULT ''"],
    ["estimated_microusd", "INTEGER NOT NULL DEFAULT 0"],
    ["latency_ms", "INTEGER NOT NULL DEFAULT 0"],
    ["shimmed_object_count", "INTEGER NOT NULL DEFAULT 0"],
    ["shimmed_provision_count", "INTEGER NOT NULL DEFAULT 0"],
    ["prompt_sha256", "TEXT NOT NULL DEFAULT ''"],
    ["response_sha256", "TEXT NOT NULL DEFAULT ''"],
    ["error_code", "TEXT NOT NULL DEFAULT ''"],
    ["created_at", "TEXT NOT NULL DEFAULT ''"],
  ];
  if (colSet.size > 0) {
    for (const [colName, colDef] of requiredAdditions) {
      if (!colSet.has(colName)) {
        try {
          await db.prepare(`ALTER TABLE herma_meta_call_log ADD COLUMN ${colName} ${colDef}`).run();
          colSet.add(colName);
        } catch (err) {
          if (!String(err?.message || "").toLowerCase().includes("duplicate column")) throw err;
          colSet.add(colName);
        }
      }
    }
  }
  try {
    await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_hmcl_call_id ON herma_meta_call_log (call_id)").run();
  } catch { /* existing duplicate call_id rows in legacy fixture */ }
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_hmcl_created ON herma_meta_call_log (created_at DESC, provider)").run();
  INITIALIZED_META_LOG_DBS.add(db);
  META_LOG_COL_CACHE.set(db, colSet);
  return colSet;
}

function normalizePublicMetaReservation(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "INVALID_META_RESERVATION" };
  }
  const rawAmount = raw.ceiling_microusd ?? raw.estimated_microusd ?? raw.estMicrousd;
  if (rawAmount === undefined || rawAmount === null || typeof rawAmount === "boolean" || String(rawAmount).trim() === "") {
    return { ok: false, error: "INVALID_META_RESERVATION" };
  }
  const numAmount = Number(rawAmount);
  if (!Number.isFinite(numAmount)) {
    return { ok: false, error: "INVALID_META_RESERVATION" };
  }
  const ceilingMicrousd = Math.ceil(numAmount);
  if (!Number.isSafeInteger(ceilingMicrousd) || ceilingMicrousd <= 0) {
    return { ok: false, error: "INVALID_META_RESERVATION" };
  }
  const rawCallId = raw.call_id ?? raw.callId;
  let callId = "";
  if (rawCallId !== undefined && rawCallId !== null) {
    callId = String(rawCallId).trim();
    if (!callId || callId.length > 128 || !/^[A-Za-z0-9_.:-]+$/.test(callId)) {
      return { ok: false, error: "INVALID_META_CALL_ID" };
    }
  } else {
    callId = `mcall_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  }
  const createdIso = typeof raw.created_at === "string" && raw.created_at.trim() ? raw.created_at.trim() : new Date().toISOString();
  const dayUtc = createdIso.slice(0, 10);
  const dayStartIso = typeof raw.day_start_iso === "string" && raw.day_start_iso.trim() ? raw.day_start_iso.trim() : `${dayUtc}T00:00:00.000Z`;
  return {
    ok: true,
    call_id: callId,
    endpoint: String(raw.endpoint || "/q/help").slice(0, 120),
    agent_id: String(raw.agent_id ?? raw.agentId ?? "").slice(0, 80),
    worker_uuid: String(raw.worker_uuid ?? raw.workerUuid ?? "").slice(0, 80),
    task_id: String(raw.task_id ?? raw.taskId ?? "").slice(0, 120),
    requested_model: String(raw.requested_model ?? raw.model ?? "muse-spark-1.3").slice(0, 80),
    ceiling_microusd: ceilingMicrousd,
    shimmed_object_count: Math.max(0, Math.trunc(Number(raw.shimmed_object_count || 0))),
    shimmed_provision_count: Math.max(0, Math.trunc(Number(raw.shimmed_provision_count || 0))),
    prompt_sha256: String(raw.prompt_sha256 || "").slice(0, 128),
    created_at: createdIso,
    day_utc: dayUtc,
    day_start_iso: dayStartIso,
    infra: Boolean(raw.infra),
    total_budget_microusd: Number.isFinite(Number(raw.total_budget_microusd)) && Number(raw.total_budget_microusd) > 0
      ? Math.round(Number(raw.total_budget_microusd))
      : null,
    day_cap_microusd: Number.isFinite(Number(raw.day_cap_microusd)) && Number(raw.day_cap_microusd) > 0
      ? Math.round(Number(raw.day_cap_microusd))
      : 0,
    day_calls_cap: Number.isFinite(Number(raw.day_calls_cap)) && Number(raw.day_calls_cap) > 0
      ? Math.floor(Number(raw.day_calls_cap))
      : 0,
    worker_daily_cap: Number.isFinite(Number(raw.dailyCap ?? raw.worker_daily_cap)) && Number(raw.dailyCap ?? raw.worker_daily_cap) > 0
      ? Math.floor(Number(raw.dailyCap ?? raw.worker_daily_cap))
      : 0,
  };
}
const healthStates = (sql, account, provider, model) => Object.fromEntries(["*", model].map(key => [key, { ...freshHealth(), ...JSON.parse(first(sql, "SELECT state FROM provider_health WHERE account=? AND provider=? AND model=?", account, provider, key)?.state || "{}") }]));
const writeHealth = (sql, account, provider, states) => { for (const [model, state] of Object.entries(states)) if (state.generation || state.probe_id) sql.exec("INSERT INTO provider_health VALUES (?,?,?,?) ON CONFLICT(account,provider,model) DO UPDATE SET state=excluded.state", account, provider, model, JSON.stringify(state)); };
const sliceCodepoints = (str, maxPoints) => Array.from(String(str ?? "")).slice(0, maxPoints).join("");

// This object coordinates only the shared provider allowance, never transcripts or model I/O.
export class WorkReasoningBudget extends DurableObject {
  #metaGate = Promise.resolve();

  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, provider TEXT NOT NULL, fingerprint TEXT NOT NULL, microusd INTEGER NOT NULL, day INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS totals (provider TEXT PRIMARY KEY, microusd INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS reservation_day ON reservations(provider, day);
        CREATE TABLE IF NOT EXISTS provider_health (account TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY(account,provider,model));
        CREATE TABLE IF NOT EXISTS identity_cooldown (identity TEXT PRIMARY KEY, available_after REAL NOT NULL, reason TEXT NOT NULL, route TEXT NOT NULL);
      `);
      if (!rows(ctx.storage.sql, "PRAGMA table_info(reservations)").some(row => row.name === "health")) ctx.storage.sql.exec("ALTER TABLE reservations ADD COLUMN health TEXT NOT NULL DEFAULT '{}'");
    });
  }

  #withMetaGate(fn) {
    const run = this.#metaGate.then(fn, fn);
    this.#metaGate = run.then(() => undefined, () => undefined);
    return run;
  }

  #commitReservation(id, provider, fingerprint, microusd, recovery, policy, config, publicMetaUsed = 0) {
    return this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      const prior = first(sql, "SELECT * FROM reservations WHERE id=?", id);
      if (prior) { const health = JSON.parse(prior.health); return { ok: prior.provider === provider && prior.fingerprint === fingerprint && prior.microusd === microusd, code: "reservation_replay", health: health.admission?.health, ticket: health.admission?.ticket }; }
      const held = first(sql, "SELECT available_after,reason,route FROM identity_cooldown WHERE identity=? AND available_after>?", upstreamIdentity(provider, config.model), Date.now() / 1000);
      if (held && held.route !== provider) return { ok: false, code: "provider_identity_cooldown", health: { state: "limited", reason: held.reason, available_after: held.available_after, requires_uncertain_authorization: false, scope: "upstream_model_identity" } };
      const states = healthStates(sql, policy.account, provider, config.model);
      const admission = admitHealth(states, id, Date.now() / 1000, recovery.allow_probe === true, recovery.allow_uncertain === true);
      if (!admission.ok) { writeHealth(sql, policy.account, provider, states); return admission; }
      const day = Math.floor(Date.now() / DAY);
      const total = first(sql, "SELECT microusd FROM totals WHERE provider=?", provider)?.microusd || 0;
      const externalUsed = provider === "meta" ? Math.max(0, Math.trunc(Number(publicMetaUsed || 0))) : 0;
      if (total + externalUsed + microusd > config.budget_microusd) return { ok: false, code: "provider_budget_exhausted" };
      writeHealth(sql, policy.account, provider, states);
      sql.exec("INSERT INTO reservations (id,provider,fingerprint,microusd,day,health) VALUES (?,?,?,?,?,?)", id, provider, fingerprint, microusd, day, JSON.stringify({ account: policy.account, model: config.model, admission, settled: false }));
      sql.exec("INSERT INTO totals VALUES (?,?) ON CONFLICT(provider) DO UPDATE SET microusd=microusd+excluded.microusd", provider, microusd);
      return { ...admission, reserved_microusd: microusd };
    });
  }

  reserve(id, provider, fingerprint, microusd, recovery = {}) {
    let policy;
    try { policy = operatorPolicy(this.env, provider); } catch { return { ok: false, code: "invalid_provider_configuration" }; }
    if (policy.disabled) return { ok: false, code: "provider_operator_disabled", health: { state: "operator_disabled", reason: "provider_operator_disabled", available_after: null, requires_operator_enable: true } };
    const config = providerConfig(this.env, provider);
    if (!/^[a-f0-9]{64}$/.test(id) || !/^[a-f0-9]{64}$/.test(fingerprint) || !Number.isSafeInteger(microusd) || microusd <= 0) return { ok: false, code: "invalid_budget_reservation" };
    if (provider === "meta" && this.env?.HERMA_DB && typeof this.env.HERMA_DB.prepare === "function") {
      try {
        this.env.HERMA_DB.prepare("SELECT 1");
      } catch {
        return { ok: false, code: "provider_ledger_unavailable" };
      }
    }
    return this.#commitReservation(id, provider, fingerprint, microusd, recovery, policy, config, 0);
  }

  reserveChecked(id, provider, fingerprint, microusd, recovery = {}) {
    let policy;
    try { policy = operatorPolicy(this.env, provider); } catch { return { ok: false, code: "invalid_provider_configuration" }; }
    if (policy.disabled) return { ok: false, code: "provider_operator_disabled", health: { state: "operator_disabled", reason: "provider_operator_disabled", available_after: null, requires_operator_enable: true } };
    const config = providerConfig(this.env, provider);
    if (!/^[a-f0-9]{64}$/.test(id) || !/^[a-f0-9]{64}$/.test(fingerprint) || !Number.isSafeInteger(microusd) || microusd <= 0) return { ok: false, code: "invalid_budget_reservation" };
    if (provider === "meta" && this.env?.HERMA_DB && typeof this.env.HERMA_DB.prepare === "function") {
      return this.#withMetaGate(async () => {
        let publicUsed = 0;
        try {
          await ensureMetaCallLogSchema(this.env.HERMA_DB);
          const row = await this.env.HERMA_DB.prepare("SELECT COALESCE(SUM(estimated_microusd), 0) AS spent FROM herma_meta_call_log WHERE provider = 'meta'").first();
          const parsedSpent = Number(row?.spent);
          if (!row || !Number.isFinite(parsedSpent) || parsedSpent < 0) {
            return { ok: false, code: "provider_ledger_unavailable" };
          }
          publicUsed = Math.trunc(parsedSpent);
        } catch {
          return { ok: false, code: "provider_ledger_unavailable" };
        }
        return this.#commitReservation(id, provider, fingerprint, microusd, recovery, policy, config, publicUsed);
      });
    }
    return this.#commitReservation(id, provider, fingerprint, microusd, recovery, policy, config, 0);
  }

  reservePublicMeta(r = {}) {
    const parsed = normalizePublicMetaReservation(r);
    if (!parsed.ok) {
      return { ok: false, code: "invalid_budget_reservation", error: parsed.error };
    }
    let policy;
    try { policy = operatorPolicy(this.env, "meta"); } catch { return { ok: false, code: "invalid_provider_configuration", error: "INVALID_PROVIDER_CONFIGURATION" }; }
    const rawBudgetUsd = Number(this.env?.HERMA_META_BUDGET_USD);
    const envBudgetMicrousd = Number.isFinite(rawBudgetUsd) && rawBudgetUsd > 0 ? scaledInteger(rawBudgetUsd, 6) : 5000000;
    const effectiveCapMicrousd = parsed.total_budget_microusd !== null
      ? Math.min(envBudgetMicrousd, parsed.total_budget_microusd)
      : envBudgetMicrousd;
    if (policy.disabled) {
      return { ok: false, code: "provider_operator_disabled", error: "META_PROVIDER_OPERATOR_DISABLED", spent_microusd: 0, cap_microusd: effectiveCapMicrousd };
    }
    return this.#withMetaGate(async () => {
      const sql = this.ctx.storage.sql;
      const privateUsed = first(sql, "SELECT microusd FROM totals WHERE provider='meta'")?.microusd || 0;
      const db = this.env?.HERMA_DB;
      if (!db || typeof db.prepare !== "function") {
        const priorLocal = first(sql, "SELECT * FROM reservations WHERE id=?", parsed.call_id);
        if (priorLocal) {
          const same = priorLocal.provider === "meta" && priorLocal.fingerprint === parsed.endpoint && priorLocal.microusd === parsed.ceiling_microusd;
          return same
            ? { ok: true, replayed: true, call_id: parsed.call_id, reserved_microusd: parsed.ceiling_microusd, spent_microusd: privateUsed, cap_microusd: effectiveCapMicrousd }
            : { ok: false, code: "reservation_replay", error: "META_CALL_ID_CONFLICT", call_id: parsed.call_id };
        }
        if (privateUsed + parsed.ceiling_microusd > effectiveCapMicrousd) {
          return { ok: false, code: "provider_budget_exhausted", error: "META_BUDGET_EXCEEDED_5USD_CAP", spent_microusd: privateUsed, cap_microusd: effectiveCapMicrousd };
        }
        const day = Math.floor(Date.now() / DAY);
        sql.exec("INSERT INTO reservations (id,provider,fingerprint,microusd,day,health) VALUES (?,?,?,?,?,?)", parsed.call_id, "meta", parsed.endpoint, parsed.ceiling_microusd, day, JSON.stringify({ public_meta: true, settled: true }));
        sql.exec("INSERT INTO totals VALUES ('meta',?) ON CONFLICT(provider) DO UPDATE SET microusd=microusd+excluded.microusd", parsed.ceiling_microusd);
        return { ok: true, call_id: parsed.call_id, reserved_microusd: parsed.ceiling_microusd, spent_microusd: privateUsed + parsed.ceiling_microusd, cap_microusd: effectiveCapMicrousd };
      }

      try {
        const schemaCols = await ensureMetaCallLogSchema(db);
        const priorRow = await db.prepare(
          "SELECT call_id, provider, endpoint, requested_model, estimated_microusd FROM herma_meta_call_log WHERE call_id = ? LIMIT 1"
        ).bind(parsed.call_id).first();
        const spentRow = await db.prepare(
          "SELECT COALESCE(SUM(estimated_microusd), 0) AS spent FROM herma_meta_call_log WHERE provider = 'meta'"
        ).first();
        const parsedSpent = Number(spentRow?.spent);
        if (!spentRow || !Number.isFinite(parsedSpent) || parsedSpent < 0) {
          return { ok: false, code: "provider_ledger_unavailable", error: "META_BUDGET_LEDGER_UNAVAILABLE" };
        }
        const publicUsed = Math.trunc(parsedSpent);
        const combinedUsed = privateUsed + publicUsed;
        if (priorRow) {
          const same = String(priorRow.provider || "") === "meta" &&
            Number(priorRow.estimated_microusd) === parsed.ceiling_microusd &&
            String(priorRow.endpoint || "") === parsed.endpoint;
          return same
            ? { ok: true, replayed: true, call_id: parsed.call_id, reserved_microusd: parsed.ceiling_microusd, spent_microusd: combinedUsed, cap_microusd: effectiveCapMicrousd }
            : { ok: false, code: "reservation_replay", error: "META_CALL_ID_CONFLICT", call_id: parsed.call_id };
        }
        if (combinedUsed + parsed.ceiling_microusd > effectiveCapMicrousd) {
          return {
            ok: false,
            code: "provider_budget_exhausted",
            error: "META_BUDGET_EXCEEDED_5USD_CAP",
            spent_microusd: combinedUsed,
            cap_microusd: effectiveCapMicrousd,
          };
        }
        if (!parsed.infra) {
          if (parsed.day_cap_microusd > 0) {
            const daySpentRow = await db.prepare(
              "SELECT COALESCE(SUM(estimated_microusd), 0) AS spent FROM herma_meta_call_log WHERE provider = 'meta' AND created_at >= ?"
            ).bind(parsed.day_start_iso).first();
            const daySpent = Number(daySpentRow?.spent);
            if (!daySpentRow || !Number.isFinite(daySpent) || daySpent < 0) {
              return { ok: false, code: "provider_ledger_unavailable", error: "META_BUDGET_LEDGER_UNAVAILABLE" };
            }
            if (Math.trunc(daySpent) + parsed.ceiling_microusd > parsed.day_cap_microusd) {
              return {
                ok: false,
                code: "provider_budget_exhausted",
                error: "META_DAILY_SPEND_CAP_REACHED",
                spent_today_microusd: Math.trunc(daySpent),
                day_cap_microusd: parsed.day_cap_microusd,
              };
            }
          }
          if (parsed.day_calls_cap > 0) {
            const dayCallsRow = await db.prepare(
              `SELECT COUNT(*) AS calls FROM herma_meta_call_log WHERE provider = 'meta' AND created_at >= ? AND outcome IN ${COUNTED_PUBLIC_META_OUTCOMES}`
            ).bind(parsed.day_start_iso).first();
            const dayCalls = Number(dayCallsRow?.calls || 0);
            if (dayCalls >= parsed.day_calls_cap) {
              return {
                ok: false,
                code: "provider_budget_exhausted",
                error: "DAILY_PAID_CALL_CAP_REACHED",
                calls_today: dayCalls,
                daily_cap: parsed.day_calls_cap,
              };
            }
          }
          if (parsed.worker_daily_cap > 0) {
            const workerCallsRow = await db.prepare(
              `SELECT COUNT(*) AS calls FROM herma_meta_call_log WHERE worker_uuid = ? AND created_at >= ? AND outcome IN ${COUNTED_PUBLIC_META_OUTCOMES}`
            ).bind(parsed.worker_uuid || "anonymous", parsed.day_start_iso).first();
            const workerCalls = Number(workerCallsRow?.calls || 0);
            if (workerCalls >= parsed.worker_daily_cap) {
              return {
                ok: false,
                code: "provider_budget_exhausted",
                error: "WORKER_DAILY_PAID_CALL_CAP_REACHED",
                calls_today: workerCalls,
                daily_cap: parsed.worker_daily_cap,
              };
            }
          }
        }
        const cols = [
          "call_id", "endpoint", "agent_id", "worker_uuid", "task_id", "provider",
          "requested_model", "reported_model", "http_status", "outcome",
          "input_tokens", "output_tokens", "estimated_microusd", "latency_ms",
          "shimmed_object_count", "shimmed_provision_count", "prompt_sha256",
          "response_sha256", "error_code", "created_at",
        ];
        const vals = [
          parsed.call_id, parsed.endpoint, parsed.agent_id, parsed.worker_uuid, parsed.task_id, "meta",
          parsed.requested_model, "", 0, "reserved",
          0, 0, parsed.ceiling_microusd, 0,
          parsed.shimmed_object_count, parsed.shimmed_provision_count, parsed.prompt_sha256,
          "", "", parsed.created_at,
        ];
        if (schemaCols.has("model")) {
          cols.push("model");
          vals.push(parsed.requested_model);
        }
        if (schemaCols.has("day_utc")) {
          cols.push("day_utc");
          vals.push(parsed.day_utc);
        }
        const placeholders = cols.map(() => "?").join(", ");
        await db.prepare(
          `INSERT INTO herma_meta_call_log (${cols.join(", ")}) VALUES (${placeholders})`
        ).bind(...vals).run();
        return {
          ok: true,
          call_id: parsed.call_id,
          reserved_microusd: parsed.ceiling_microusd,
          spent_microusd: combinedUsed + parsed.ceiling_microusd,
          cap_microusd: effectiveCapMicrousd,
        };
      } catch {
        return {
          ok: false,
          code: "provider_ledger_unavailable",
          error: "META_BUDGET_LEDGER_UNAVAILABLE",
        };
      }
    });
  }

  recordOutcome(id, provider, fingerprint, evidence) {
    return this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql, prior = first(sql, "SELECT * FROM reservations WHERE id=?", id);
      if (!prior || prior.provider !== provider || prior.fingerprint !== fingerprint) fail(409, "provider_reservation_conflict");
      const saved = JSON.parse(prior.health);
      if (saved.settled) return saved.result;
      if (!saved.admission?.ticket || !["not_sent", "unknown", "rejected", "completed"].includes(evidence.outcome) || (evidence.retry_after_seconds !== null && (!Number.isFinite(evidence.retry_after_seconds) || evidence.retry_after_seconds < 0))) fail(409, "invalid_provider_outcome");
      const states = healthStates(sql, saved.account, provider, saved.model);
      const result = settleHealth(states, saved.admission.ticket, id, saved.model, Date.now() / 1000, evidence.outcome, evidence.error_code, evidence.reason, evidence.retry_after_seconds, evidence.http_status);
      writeHealth(sql, saved.account, provider, states);
      const limited = limitReason(evidence.outcome, evidence.error_code, evidence.reason, evidence.http_status);
      if (IDENTITY_LIMITS.has(limited)) sql.exec("INSERT INTO identity_cooldown VALUES (?,?,?,?) ON CONFLICT(identity) DO UPDATE SET available_after=MAX(available_after,excluded.available_after),reason=excluded.reason,route=excluded.route", upstreamIdentity(provider, saved.model), states[ACCOUNT_LIMITS.has(limited) ? "*" : saved.model].available_after, limited, provider);
      sql.exec("UPDATE reservations SET health=? WHERE id=?", JSON.stringify({ ...saved, settled: true, result }), id);
      return result;
    });
  }

  summary() {
    const day = Math.floor(Date.now() / DAY), sql = this.ctx.storage.sql;
    return { reservations: rows(sql, "SELECT provider,microusd AS reserved_microusd FROM totals ORDER BY provider"),
      today: rows(sql, "SELECT provider,COUNT(*) AS reserved_calls FROM reservations WHERE day=? GROUP BY provider", day),
      availability: rows(sql, "SELECT account,provider,model,state FROM provider_health").map(row => ({ account_scope: row.account, provider: row.provider, model: row.model, ...healthView(JSON.parse(row.state)) })),
      identity_cooldowns: rows(sql, "SELECT identity,available_after,reason,route FROM identity_cooldown WHERE available_after>? ORDER BY identity", Date.now() / 1000),
      operator_disabled: ["meta", "openai", "anthropic", "openrouter"].filter(provider => operatorPolicy(this.env, provider).disabled),
      invoice_cost_usd: null, reason: "Conservative reservations; no automatic refunds after uncertain model calls." };
  }
}

// One object per authenticated caller. Concurrent callers never share transcripts.
export class WorkConversation extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS identity (id INTEGER PRIMARY KEY CHECK(id=1), scope TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, version INTEGER NOT NULL, active TEXT, history TEXT NOT NULL, contract_hash TEXT NOT NULL, created INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS turns (conversation TEXT NOT NULL, request TEXT NOT NULL, fingerprint TEXT NOT NULL, response TEXT, version INTEGER NOT NULL, created INTEGER NOT NULL, base TEXT NOT NULL, PRIMARY KEY(conversation,request));
        CREATE TABLE IF NOT EXISTS budgets (hour INTEGER PRIMARY KEY, turns INTEGER NOT NULL, tokens INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS provider_health (provider TEXT NOT NULL, model TEXT NOT NULL, available_after REAL NOT NULL, PRIMARY KEY(provider,model));
        CREATE TABLE IF NOT EXISTS pending_settlements (attempt_id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL, fingerprint TEXT NOT NULL, evidence TEXT NOT NULL, created INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS settled_attempts (attempt_id TEXT PRIMARY KEY, provider_health TEXT NOT NULL, settled_at INTEGER NOT NULL);
      `);
    });
  }

  #identity(scope) {
    if (typeof scope !== "string" || !/^(?:key|open):[A-Za-z0-9_.:-]{1,120}$/.test(scope)) fail(403, "caller_scope_required");
    const sql = this.ctx.storage.sql;
    sql.exec("INSERT OR IGNORE INTO identity VALUES (1,?)", scope);
    if (first(sql, "SELECT scope FROM identity WHERE id=1").scope !== scope) fail(403, "caller_scope_mismatch");
  }

  snapshot(scope, id) {
    try {
      this.#identity(scope);
      if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) fail(422, "invalid_conversation_id");
      const row = first(this.ctx.storage.sql, "SELECT * FROM conversations WHERE id=?", id);
      if (!row) return { status: 200, body: { version: 0, history: [], attempts: [] } };
      const latest = first(this.ctx.storage.sql, "SELECT response,base FROM turns WHERE conversation=? ORDER BY version DESC LIMIT 1", id);
      const attempts = latest ? JSON.parse(latest.response || latest.base).attempts || [] : [];
      return { status: 200, body: { version: row.version, history: Date.now() - row.created < DAY ? JSON.parse(row.history) : [], attempts: Date.now() - row.created < DAY ? attempts : [], active: row.active, expired: Date.now() - row.created >= DAY } };
    } catch (error) { return failure(error); }
  }

  #replay(turn, fingerprint) {
    const previous = first(this.ctx.storage.sql, "SELECT t.*,c.created AS conversation_created FROM turns t JOIN conversations c ON c.id=t.conversation WHERE conversation=? AND request=?", turn.conversation_id, turn.request_id);
    if (!previous) return null;
    if (previous.fingerprint !== fingerprint) fail(409, "request_id_conflict");
    if (Date.now() - previous.conversation_created >= DAY) fail(409, "conversation_expired");
    if (!previous.response) fail(409, "request_in_progress");
    return JSON.parse(previous.response);
  }

  #reserve(turn, fingerprint, contractHash, tokens, base, config, { liftHourlyTurnCap = false } = {}) {
    return this.ctx.storage.transactionSync(() => {
      const replay = this.#replay(turn, fingerprint);
      if (replay) return replay;
      const sql = this.ctx.storage.sql, now = Date.now(), hour = Math.floor(now / 3600000);
      const row = first(sql, "SELECT * FROM conversations WHERE id=?", turn.conversation_id);
      if (row && now - row.created >= DAY) fail(409, "conversation_expired");
      if ((row && (row.active || row.version !== turn.expected_version)) || (!row && turn.expected_version !== 0)) fail(409, "version_conflict");
      if (row && row.contract_hash !== contractHash) fail(409, "contract_changed");
      if (first(sql, "SELECT COUNT(*) AS n FROM conversations WHERE active IS NOT NULL").n >= 2) fail(429, "active_turn_limit");
      const budget = first(sql, "SELECT * FROM budgets WHERE hour=?", hour);
      if ((!liftHourlyTurnCap && (budget?.turns || 0) >= 60) || (config.caller_token_limit !== null && (budget?.tokens || 0) + tokens > config.caller_token_limit)) fail(429, "conversation_budget_exhausted");
      if (!row && first(sql, "SELECT COUNT(*) AS n FROM conversations").n >= 10000) fail(429, "conversation_storage_limit");
      if (!row) sql.exec("INSERT INTO conversations VALUES (?,0,NULL,'[]',?,?)", turn.conversation_id, contractHash, now);
      const updated = rows(sql, "UPDATE conversations SET version=version+1,active=? WHERE id=? AND version=? AND active IS NULL RETURNING version", turn.request_id, turn.conversation_id, turn.expected_version);
      if (updated.length !== 1) fail(409, "version_conflict");
      sql.exec("INSERT INTO turns VALUES (?,?,?,NULL,?,?,?)", turn.conversation_id, turn.request_id, fingerprint, updated[0].version, now, JSON.stringify(base));
      sql.exec("INSERT INTO budgets VALUES (?,1,?) ON CONFLICT(hour) DO UPDATE SET turns=turns+1,tokens=tokens+excluded.tokens", hour, tokens);
      return null;
    });
  }

  async #reconcileSettlements() {
    if (!this.env?.WORK_REASONING_BUDGET) return;
    const sql = this.ctx.storage.sql;
    const pendingRows = rows(sql, "SELECT * FROM pending_settlements ORDER BY created ASC LIMIT 16");
    if (!pendingRows.length) return;
    const budgetStub = this.env.WORK_REASONING_BUDGET.getByName("provider-allowance-v1");
    for (const item of pendingRows) {
      try {
        const evidence = JSON.parse(item.evidence);
        const health = await budgetStub.recordOutcome(item.attempt_id, item.provider, item.fingerprint, evidence);
        this.ctx.storage.transactionSync(() => {
          sql.exec("DELETE FROM pending_settlements WHERE attempt_id=?", item.attempt_id);
          sql.exec("INSERT OR REPLACE INTO settled_attempts (attempt_id,provider_health,settled_at) VALUES (?,?,?)", item.attempt_id, JSON.stringify(health || {}), Date.now());
          if (health?.available_after !== null && health?.available_after !== undefined) {
            sql.exec("INSERT INTO provider_health VALUES (?,?,?) ON CONFLICT(provider,model) DO UPDATE SET available_after=excluded.available_after", item.provider, item.model, health.available_after);
          }
          // Update ONLY unsealed turns (response IS NULL); sealed turns (response IS NOT NULL)
          // carry an immutable receipt_hash and must never be mutated after #finish.
          for (const turnRow of rows(sql, "SELECT conversation,request,base FROM turns WHERE response IS NULL")) {
            let parsedBase;
            try { parsedBase = JSON.parse(turnRow.base); } catch { continue; }
            const matchedAttempt = Array.isArray(parsedBase?.attempts) ? parsedBase.attempts.find(a => a?.attempt_id === item.attempt_id) : null;
            if (!matchedAttempt || matchedAttempt.health_settled === true) continue;
            matchedAttempt.provider_health = health;
            matchedAttempt.available_after = health?.available_after ?? matchedAttempt.available_after;
            matchedAttempt.health_settled = true;
            matchedAttempt.settlement_status = "settled";
            sql.exec("UPDATE turns SET base=? WHERE conversation=? AND request=? AND response IS NULL", JSON.stringify(parsedBase), turnRow.conversation, turnRow.request);
          }
        });
      } catch {
        // Leave in pending_settlements for future alarm or turn reconciliation.
      }
    }
  }

  async #finish(turn, response, message) {
    response.receipt_hash = await hash(response);
    return this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      const prior = first(sql, "SELECT response FROM turns WHERE conversation=? AND request=?", turn.conversation_id, turn.request_id);
      if (prior?.response) return JSON.parse(prior.response);
      const row = first(sql, "SELECT history FROM conversations WHERE id=? AND active=? AND version=?", turn.conversation_id, turn.request_id, response.version);
      if (!row) fail(409, "turn_fence_conflict");
      const history = JSON.parse(row.history);
      history.push({ role: "user", content: message }, { role: "assistant", content: sliceCodepoints(JSON.stringify(response.proposal), 6000) });
      sql.exec("UPDATE turns SET response=?,base='{}' WHERE conversation=? AND request=? AND version=? AND response IS NULL", JSON.stringify(response), turn.conversation_id, turn.request_id, response.version);
      sql.exec("UPDATE conversations SET history=?,active=NULL WHERE id=? AND active=? AND version=?", JSON.stringify(history.slice(-12)), turn.conversation_id, turn.request_id, response.version);
      return response;
    });
  }

  async #schedule() {
    const sql = this.ctx.storage.sql, now = Date.now();
    const pending = first(sql, "SELECT MIN(created+120000) AS at FROM turns WHERE response IS NULL")?.at;
    const expiry = first(sql, "SELECT MIN(created+86400000) AS at FROM conversations WHERE history != '[]' OR active IS NOT NULL")?.at;
    const settlement = first(sql, "SELECT COUNT(*) AS n FROM pending_settlements")?.n > 0 ? now + 5000 : null;
    const upcoming = [pending, expiry, settlement].filter(x => x !== null && x !== undefined);
    if (upcoming.length) await this.ctx.storage.setAlarm(Math.max(now + 1000, Math.min(...upcoming)));
    else await this.ctx.storage.deleteAlarm();
  }

  async turn(scope, raw, entries, options = {}) {
    try {
      this.#identity(scope);
      await this.#reconcileSettlements();
      const callerApiKey = typeof options?.caller_api_key === "string" && options.caller_api_key.trim() ? options.caller_api_key.trim() : null;
      const turn = validateTurn(raw);
      const callerFunded = callerApiKey !== null && !turn.provider_plan_ref;
      // Every operator-funded turn needs this caller's own explicit grant, with or without a
      // plan. Caller-funded BYOK turns pay upstream directly and never touch operator funds.
      const grant = callerFunded ? null : operatorGrant(this.env, scope);
      const plan = callerFunded ? null : loadProviderPlan(this.env, scope, turn, entries, grant);
      if (!callerFunded && !plan && grant === null) fail(403, "provider_grant_required");
      const initial = plan ? null : providerConfig(this.env, turn.provider, { callerFunded });
      if (!callerFunded && !plan) requireDirectGrant(grant, initial);
      // Failover after a possibly charged, ambiguous outcome needs the plan's opt-in and this
      // caller's operator grant; loadProviderPlan refuses a plan lacking the grant.
      const uncertainAllowed = plan?.allow_uncertain_outcome === true && grant?.allow_uncertain_failover === true;
      const candidates = plan?.providers || [{ provider: turn.provider, model: initial.model, routing_provider: turn.provider === "openrouter" ? initial.openrouter_provider : null }];
      const contracts = await loadContracts(entries.filter(item => item.entry_id !== turn.provider_plan_ref), turn.context_refs.filter(ref => ref !== turn.provider_plan_ref));
      const planNoun = plan ? entries.find(item => item.entry_id === turn.provider_plan_ref) : null;
      const contractHash = await hash({ contracts: contracts.map(({ tool_name, ...c }) => c), provider_plan: planNoun });
      const fingerprint = await hash({ turn, contract_hash: contractHash });
      const replay = this.#replay(turn, fingerprint);
      if (replay) return { status: responseStatus(replay), body: replay };
      const current = first(this.ctx.storage.sql, "SELECT history FROM conversations WHERE id=?", turn.conversation_id);
      const payerLabel = callerFunded ? "caller" : "operator";
      const attempts = [], actions = [{ action: "resolve_contracts_and_provider_plan", model: null, provider: null, model_reason: "deterministic_authorization_and_schema_checks", parent_attempt_id: null }];
      const base = { conversation_id: turn.conversation_id, request_id: turn.request_id, version: turn.expected_version + 1,
        caller_scope: scope, contract_hash: contractHash, context_refs: turn.context_refs, provider: candidates[0].provider, model: candidates[0].model,
        reasoning_effort: initial?.reasoning_effort ?? null, max_output_tokens: initial?.max_output ?? null,
        usage: { input_tokens: null, output_tokens: null }, cost_usd: null,
        cost_reason: "Provider invoice unavailable; reservations are conservative ceilings, not charges.",
        reserved_tokens: 0, reserved_usd: null, reservation_status: callerFunded ? "caller_funded" : "pending", reservation_ceiling_usd: null,
        server_exception: { purpose: "caller_requested_typed_proposal", worker_path_reason: "Caller explicitly selected the interactive server capability.", principal: scope,
          data_scope: { caller_scope: scope, context_refs: turn.context_refs, conversation_id: turn.conversation_id }, effects: "proposal_only", payer: payerLabel,
          work_kind: "verb", operation_id: "propose_typed_action", lifecycle_owner: "herma_conversation_turn", result_kind: "noun",
          provider_plan_ref: turn.provider_plan_ref, retry_policy: plan ? "explicit_scoped_provider_plan" : "no_automatic_retry_or_provider_fallback",
          operator_grant: callerFunded ? null : { caller_scope: scope, source: "caller_scoped_operator_grant" },
          uncertain_failover: { plan_opt_in: plan?.allow_uncertain_outcome === true, operator_grant: grant?.allow_uncertain_failover === true, allowed: uncertainAllowed }, actions },
        attempts, latency_ms: null, error_code: null, executed: false, persisted: true };
      const concurrentReplay = this.#reserve(turn, fingerprint, contractHash, 0, base, { caller_token_limit: null }, { liftHourlyTurnCap: callerFunded && isOpenFreeWindow(this.env) });
      if (concurrentReplay) return { status: responseStatus(concurrentReplay), body: concurrentReplay };
      await this.#schedule();
      const started = Date.now(), turnDeadline = first(this.ctx.storage.sql, "SELECT created FROM turns WHERE conversation=? AND request=?", turn.conversation_id, turn.request_id).created + 120000; let proposal = blocked("provider_plan_unavailable"), errorCode = null;
      base.server_exception.deadline_unix_ms = turnDeadline;
      const persist = () => {
        const changed = rows(this.ctx.storage.sql, "UPDATE turns SET base=? WHERE conversation=? AND request=? AND version=? AND response IS NULL RETURNING version", JSON.stringify(base), turn.conversation_id, turn.request_id, base.version);
        if (changed.length !== 1) fail(409, "turn_fence_conflict");
      };
      for (let index = 0; index < candidates.length; index++) {
        const candidate = candidates[index];
        const attempt = { attempt_id: await hash({ scope, conversation: turn.conversation_id, request: turn.request_id, index }), provider: candidate.provider, model: candidate.model,
          upstream_identity: upstreamIdentity(candidate.provider, candidate.model),
          // A possibly charged earlier attempt this one follows under the scoped grant.
          follows_uncertain_attempt_id: attempts.at(-1)?.outcome === "unknown" ? attempts.at(-1).attempt_id : null,
          reported_model: null, status: "selected", outcome: "not_sent", usage: { input_tokens: null, output_tokens: null }, usage_reason: "provider_usage_not_reported", reservation_status: callerFunded ? "caller_funded" : "not_reserved", reserved_tokens: 0, reserved_usd: callerFunded ? 0 : null, payer: payerLabel, error_code: null, upstream_http_status: null, provider_diagnostics: null, provider_health: null, available_after: null };
        attempts.push(attempt); persist();
        try {
          if (!callerFunded) {
            let policy;
            try { policy = operatorPolicy(this.env, candidate.provider); } catch { fail(503, "invalid_provider_configuration"); }
            if (policy.disabled) { attempt.provider_health = { state: "operator_disabled", reason: "provider_operator_disabled", available_after: null, requires_operator_enable: true }; fail(503, "provider_operator_disabled"); }
          }
          const config = initial || providerConfig(this.env, candidate.provider, { callerFunded });
          if (Date.now() >= turnDeadline) fail(503, "turn_deadline_exhausted");
          if (plan && candidate.provider === "openrouter" && candidate.routing_provider !== config.openrouter_provider) fail(503, "provider_model_not_configured");
          if (config.model !== candidate.model) fail(503, "provider_model_not_configured");
          const { body, tokens, microusd } = buildRequest(config, turn, contracts, current ? JSON.parse(current.history) : []);
          if (!callerFunded) providerCredential(this.env, config.provider);
          Object.assign(attempt, { destination: config.url, routing_provider: config.provider === "openrouter" ? config.openrouter_provider : null, max_output_tokens: config.max_output, timeout_seconds: 25, deadline_policy: "timeout_from_provider_dispatch", reservation_ceiling_tokens: tokens, reservation_ceiling_usd: callerFunded ? 0 : microusd / 1000000 });
          const tokenHour = Math.floor(Date.now() / 3600000);
          this.ctx.storage.transactionSync(() => {
            const hour = tokenHour, budget = first(this.ctx.storage.sql, "SELECT tokens FROM budgets WHERE hour=?", hour);
            if (config.caller_token_limit !== null && tokens + (budget?.tokens || 0) > config.caller_token_limit) fail(429, "conversation_budget_exhausted");
            this.ctx.storage.sql.exec("INSERT INTO budgets VALUES (?,0,?) ON CONFLICT(hour) DO UPDATE SET tokens=tokens+excluded.tokens", hour, tokens);
          });
          base.reserved_tokens += tokens;
          attempt.reserved_tokens = tokens;
          if (!callerFunded) {
            attempt.reservation_status = "pending";
            base.reservation_status = "pending";
            persist();
            const budgetStub = this.env.WORK_REASONING_BUDGET.getByName("provider-allowance-v1");
            const reservationOpts = { allow_probe: plan?.allow_recovery_probe !== false, allow_uncertain: uncertainAllowed };
            const reservation = await (typeof budgetStub.reserveChecked === "function"
              ? budgetStub.reserveChecked(attempt.attempt_id, config.provider, fingerprint, microusd, reservationOpts)
              : budgetStub.reserve(attempt.attempt_id, config.provider, fingerprint, microusd, reservationOpts));
            if (typeof reservation?.ok !== "boolean" || (!reservation.ok && !reservationDenials.has(reservation.code)) || (reservation.ok && (!reservation.ticket || Object.keys(reservation.ticket).length !== 2 || !["*", config.model].every(key => Object.hasOwn(reservation.ticket, key) && Number.isSafeInteger(reservation.ticket[key]) && reservation.ticket[key] >= 0) || !["healthy", "recovery_probe"].includes(reservation.health?.state)))) throw new Error("invalid_reservation_response");
            attempt.provider_health = reservation.health || null;
            if (reservation.health?.state === "limited") attempt.available_after = reservation.health.available_after;
            attempt.reservation_status = reservation.ok ? "reserved" : "denied";
            attempt.reserved_usd = reservation.ok ? microusd / 1000000 : 0;
            base.reservation_status = attempt.reservation_status;
            if (!reservation.ok) {
              // A confirmed denial made no provider reservation or model call. Unknown RPC
              // outcomes keep their caller allowance; only this definite denial releases it.
              this.ctx.storage.sql.exec("UPDATE budgets SET tokens=tokens-? WHERE hour=?", tokens, tokenHour);
              base.reserved_tokens -= tokens;
              attempt.reservation_ceiling_tokens = tokens;
              attempt.reserved_tokens = 0;
              persist(); fail(429, reservation.code);
            }
            base.reserved_usd = (base.reserved_usd || 0) + microusd / 1000000;
            attempt.health_ticket = reservation.ticket;
          } else {
            base.reserved_usd = 0;
          }
          Object.assign(base, { provider: config.provider, model: config.model, reasoning_effort: config.reasoning_effort, max_output_tokens: config.max_output, reservation_ceiling_usd: attempt.reservation_ceiling_usd });
          Object.assign(attempt, { status: "in_flight", outcome: "unknown" });
          Object.assign(base.server_exception, { provider: config.provider, model: config.model, destination: config.url, max_output_tokens: config.max_output, reserved_tokens: base.reserved_tokens, reservation_ceiling_usd: base.reserved_usd, timeout_seconds: 25, deadline_policy: "timeout_from_provider_dispatch" });
          actions.push({ action: "provider_request", provider: config.provider, model: config.model, parent_attempt_id: attempt.attempt_id });
          persist();
          const remainingMs = Math.min(25000, turnDeadline - Date.now());
          if (remainingMs <= 0) fail(503, "turn_deadline_exhausted");
          attempt.timeout_seconds = remainingMs / 1000;
          persist();
          const reply = await requestModel(this.env, config, body, remainingMs, { callerApiKey });
          Object.assign(attempt, { status: "completed", outcome: "completed", upstream_http_status: 200, usage: usageFor(config.provider, reply), reported_model: typeof reply.model === "string" ? reply.model : null, reported_provider: typeof reply.provider === "string" ? reply.provider : null, available_after: 0 });
          attempt.usage_reason = Object.values(attempt.usage).every(value => value !== null) ? null : "provider_usage_not_reported";
          proposal = parseProposal(reply, config.provider, contracts);
          actions.push({ action: "validate_proposal", model: null, provider: null, model_reason: "deterministic_contract_validation", parent_attempt_id: attempt.attempt_id });
          base.usage = attempt.usage;
          errorCode = null;
        } catch (error) {
          errorCode = error instanceof ConversationError ? error.code : "storage_or_coordination_unavailable";
          const outcome = errorCode === "provider_not_configured" ? "not_sent" : error.outcome || attempt.outcome;
          Object.assign(attempt, { status: outcome === "not_sent" ? "skipped" : "failed", outcome, error_code: errorCode });
          if (error instanceof ConversationError) Object.assign(attempt, { upstream_http_status: error.http_status ?? null, provider_diagnostics: error.diagnostics ?? null, retry_after_seconds: error.retry_after_seconds ?? null, retry_guidance_source: error.retry_guidance_source ?? null });
          if (["provider_rate_limited", "provider_unavailable"].includes(errorCode)) attempt.available_after = Date.now() / 1000 + (error.retry_after_seconds ?? 30);
          proposal = blocked(errorCode);
        }
        // Durably persist observed model outcome, proposal, usage AND settlement retry intent BEFORE remote allowance settlement.
        base._observed = { proposal, provider: attempt.provider, model: attempt.model, usage: attempt.usage, error_code: errorCode, message: turn.message };
        if (attempt.health_ticket) {
          const evidence = { outcome: attempt.outcome, error_code: attempt.error_code, reason: attempt.provider_diagnostics?.reason ?? null, retry_after_seconds: attempt.retry_after_seconds ?? null, http_status: attempt.upstream_http_status };
          attempt.health_settled = false;
          attempt.settlement_status = "pending";
          this.ctx.storage.transactionSync(() => {
            persist();
            this.ctx.storage.sql.exec(
              "INSERT OR REPLACE INTO pending_settlements (attempt_id,provider,model,fingerprint,evidence,created) VALUES (?,?,?,?,?,?)",
              attempt.attempt_id, candidate.provider, attempt.model, fingerprint, JSON.stringify(evidence), Date.now()
            );
          });
          try {
            attempt.provider_health = await this.env.WORK_REASONING_BUDGET.getByName("provider-allowance-v1").recordOutcome(attempt.attempt_id, candidate.provider, fingerprint, evidence);
            attempt.available_after = attempt.provider_health.available_after;
            attempt.health_settled = true;
            attempt.settlement_status = "settled";
            this.ctx.storage.transactionSync(() => {
              this.ctx.storage.sql.exec("DELETE FROM pending_settlements WHERE attempt_id=?", attempt.attempt_id);
              this.ctx.storage.sql.exec("INSERT OR REPLACE INTO settled_attempts (attempt_id,provider_health,settled_at) VALUES (?,?,?)", attempt.attempt_id, JSON.stringify(attempt.provider_health || {}), Date.now());
              if (attempt.available_after !== null) {
                this.ctx.storage.sql.exec("INSERT INTO provider_health VALUES (?,?,?) ON CONFLICT(provider,model) DO UPDATE SET available_after=excluded.available_after", attempt.provider, attempt.model, attempt.available_after);
              }
              persist();
            });
          } catch {
            attempt.health_settled = false;
            attempt.settlement_status = "pending_reconciliation";
            this.ctx.storage.transactionSync(() => {
              if (attempt.available_after !== null) {
                this.ctx.storage.sql.exec("INSERT INTO provider_health VALUES (?,?,?) ON CONFLICT(provider,model) DO UPDATE SET available_after=excluded.available_after", attempt.provider, attempt.model, attempt.available_after);
              }
              persist();
            });
          }
        } else {
          if (attempt.available_after !== null) this.ctx.storage.sql.exec("INSERT INTO provider_health VALUES (?,?,?) ON CONFLICT(provider,model) DO UPDATE SET available_after=excluded.available_after", attempt.provider, attempt.model, attempt.available_after);
          persist();
        }
        if (errorCode === null || !plan || !["provider_not_configured", "provider_model_not_configured", "output_allowance_required", "invalid_provider_configuration", "unsupported_generation_configuration", "provider_unauthorized", "provider_rate_limited", "provider_rejected", "provider_outcome_uncertain", "provider_unavailable", "provider_budget_exhausted", "provider_ledger_unavailable", "provider_cooldown", "provider_operator_disabled", "provider_backpressure", "provider_recovery_probe_required", "provider_recovery_probe_inflight", "provider_outcome_reconciliation_required", "provider_identity_cooldown"].includes(errorCode) || (attempt.outcome === "unknown" && !uncertainAllowed)) break;
      }
      const last = attempts.at(-1);
      const { _observed, ...cleanBase } = base;
      const response = await this.#finish(turn, { ...cleanBase, ...proposal, provider: last.provider, model: last.model, usage: last.usage, latency_ms: Date.now() - started, error_code: errorCode }, turn.message);
      await this.#schedule();
      return { status: responseStatus(response), body: response };
    } catch (error) { return failure(error); }
  }

  async alarm() {
    await this.#reconcileSettlements();
    const sql = this.ctx.storage.sql, now = Date.now();
    // A crashed request with no observed provider response is sealed as uncertain; if a response
    // was already observed and durably recorded before settlement, preserve that exact outcome.
    for (const row of rows(sql, "SELECT * FROM turns WHERE response IS NULL AND created<=?", now - 120000)) {
      const parsedBase = JSON.parse(row.base);
      const { _observed, ...cleanBase } = parsedBase;
      if (_observed && _observed.proposal) {
        await this.#finish(
          { conversation_id: row.conversation, request_id: row.request },
          { ...cleanBase, ..._observed.proposal, provider: _observed.provider, model: _observed.model, usage: _observed.usage, latency_ms: Math.max(0, now - row.created), error_code: _observed.error_code ?? null },
          typeof _observed.message === "string" && _observed.message ? _observed.message : "Recovered observed model turn."
        );
      } else {
        await this.#finish({ conversation_id: row.conversation, request_id: row.request }, { ...cleanBase, ...blocked("provider_outcome_uncertain"), error_code: "provider_outcome_uncertain" }, "A pending model turn ended without a confirmed outcome.");
      }
    }
    this.ctx.storage.transactionSync(() => {
      sql.exec("UPDATE conversations SET history='[]',active=NULL WHERE created<=?", now - DAY);
      sql.exec("DELETE FROM turns WHERE conversation IN (SELECT id FROM conversations WHERE created<=?)", now - DAY);
      sql.exec("DELETE FROM budgets WHERE hour<?", Math.floor(now / 3600000) - 48);
      sql.exec("DELETE FROM settled_attempts WHERE settled_at<=?", now - DAY);
    });
    await this.#schedule();
  }
}
