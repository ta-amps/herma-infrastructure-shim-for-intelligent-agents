// Conversation coordination, not a work queue. Tessera owns executable tasks.
import { DurableObject } from "cloudflare:workers";
import { ConversationError, fail, hash, validateTurn, loadContracts, providerConfig, buildRequest, requestModel, parseProposal, blocked, usageFor } from "./conversation.js";

const DAY = 86400000;
const rows = (sql, query, ...args) => sql.exec(query, ...args).toArray();
const first = (sql, query, ...args) => rows(sql, query, ...args)[0];
const failure = error => ({ status: error instanceof ConversationError ? error.status : 500, body: { code: error instanceof ConversationError ? error.code : "conversation_internal_error" } });
const responseStatus = response => ["provider_budget_exhausted", "provider_call_budget_exhausted"].includes(response.error_code) ? 429 : 200;

// This object coordinates only the shared provider allowance, never transcripts or model I/O.
export class WorkReasoningBudget extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, provider TEXT NOT NULL, fingerprint TEXT NOT NULL, microusd INTEGER NOT NULL, day INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS totals (provider TEXT PRIMARY KEY, microusd INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS reservation_day ON reservations(provider, day);
      `);
    });
  }

  reserve(id, provider, fingerprint, microusd) {
    const config = providerConfig(this.env, provider);
    if (!/^[a-f0-9]{64}$/.test(id) || !/^[a-f0-9]{64}$/.test(fingerprint) || !Number.isSafeInteger(microusd) || microusd < 0 || microusd > 1000000) return { ok: false, code: "invalid_budget_reservation" };
    return this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      const prior = first(sql, "SELECT * FROM reservations WHERE id=?", id);
      if (prior) return { ok: prior.provider === provider && prior.fingerprint === fingerprint && prior.microusd === microusd, code: "reservation_replay" };
      const day = Math.floor(Date.now() / DAY);
      const total = first(sql, "SELECT microusd FROM totals WHERE provider=?", provider)?.microusd || 0;
      if (provider === "meta" && total + microusd > Math.floor(config.meta_budget_usd * 1000000)) return { ok: false, code: "provider_budget_exhausted" };
      if (provider === "ollama" && first(sql, "SELECT COUNT(*) AS n FROM reservations WHERE provider=? AND day=?", provider, day).n >= config.ollama_calls_per_day) return { ok: false, code: "provider_call_budget_exhausted" };
      sql.exec("INSERT INTO reservations VALUES (?,?,?,?,?)", id, provider, fingerprint, microusd, day);
      sql.exec("INSERT INTO totals VALUES (?,?) ON CONFLICT(provider) DO UPDATE SET microusd=microusd+excluded.microusd", provider, microusd);
      return { ok: true, reserved_microusd: microusd };
    });
  }

  summary() {
    const day = Math.floor(Date.now() / DAY), sql = this.ctx.storage.sql;
    return { reservations: rows(sql, "SELECT provider,microusd AS reserved_microusd FROM totals ORDER BY provider"),
      today: rows(sql, "SELECT provider,COUNT(*) AS reserved_calls FROM reservations WHERE day=? GROUP BY provider", day),
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
      `);
    });
  }

  #identity(scope) {
    if (typeof scope !== "string" || !/^key:[A-Za-z0-9_.:-]{1,120}$/.test(scope)) fail(403, "caller_scope_required");
    const sql = this.ctx.storage.sql;
    sql.exec("INSERT OR IGNORE INTO identity VALUES (1,?)", scope);
    if (first(sql, "SELECT scope FROM identity WHERE id=1").scope !== scope) fail(403, "caller_scope_mismatch");
  }

  snapshot(scope, id) {
    try {
      this.#identity(scope);
      if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) fail(422, "invalid_conversation_id");
      const row = first(this.ctx.storage.sql, "SELECT * FROM conversations WHERE id=?", id);
      if (!row) return { status: 200, body: { version: 0, history: [] } };
      return { status: 200, body: { version: row.version, history: Date.now() - row.created < DAY ? JSON.parse(row.history) : [], active: row.active, expired: Date.now() - row.created >= DAY } };
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

  #reserve(turn, fingerprint, contractHash, tokens, base) {
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
      if ((budget?.turns || 0) >= 60 || (budget?.tokens || 0) + tokens > 200000) fail(429, "conversation_budget_exhausted");
      if (!row && first(sql, "SELECT COUNT(*) AS n FROM conversations").n >= 10000) fail(429, "conversation_storage_limit");
      if (!row) sql.exec("INSERT INTO conversations VALUES (?,0,NULL,'[]',?,?)", turn.conversation_id, contractHash, now);
      const updated = rows(sql, "UPDATE conversations SET version=version+1,active=? WHERE id=? AND version=? AND active IS NULL RETURNING version", turn.request_id, turn.conversation_id, turn.expected_version);
      if (updated.length !== 1) fail(409, "version_conflict");
      sql.exec("INSERT INTO turns VALUES (?,?,?,NULL,?,?,?)", turn.conversation_id, turn.request_id, fingerprint, updated[0].version, now, JSON.stringify(base));
      sql.exec("INSERT INTO budgets VALUES (?,1,?) ON CONFLICT(hour) DO UPDATE SET turns=turns+1,tokens=tokens+excluded.tokens", hour, tokens);
      return null;
    });
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
      history.push({ role: "user", content: message.slice(0, 2000) }, { role: "assistant", content: JSON.stringify(response.proposal).slice(0, 6000) });
      sql.exec("UPDATE turns SET response=?,base='{}' WHERE conversation=? AND request=? AND version=? AND response IS NULL", JSON.stringify(response), turn.conversation_id, turn.request_id, response.version);
      sql.exec("UPDATE conversations SET history=?,active=NULL WHERE id=? AND active=? AND version=?", JSON.stringify(history.slice(-12)), turn.conversation_id, turn.request_id, response.version);
      return response;
    });
  }

  async #schedule() {
    const sql = this.ctx.storage.sql, now = Date.now();
    const pending = first(sql, "SELECT MIN(created+120000) AS at FROM turns WHERE response IS NULL")?.at;
    const expiry = first(sql, "SELECT MIN(created+86400000) AS at FROM conversations WHERE history != '[]' OR active IS NOT NULL")?.at;
    const upcoming = [pending, expiry].filter(x => x !== null && x !== undefined);
    if (upcoming.length) await this.ctx.storage.setAlarm(Math.max(now + 1000, Math.min(...upcoming)));
    else await this.ctx.storage.deleteAlarm();
  }

  async turn(scope, raw, entries) {
    try {
      this.#identity(scope);
      const turn = validateTurn(raw), config = providerConfig(this.env, turn.provider);
      const contracts = await loadContracts(entries, turn.context_refs);
      const contractHash = await hash(contracts.map(({ tool_name, ...c }) => c));
      const fingerprint = await hash({ turn, contract_hash: contractHash });
      const replay = this.#replay(turn, fingerprint);
      if (replay) return { status: responseStatus(replay), body: replay };
      const current = first(this.ctx.storage.sql, "SELECT history FROM conversations WHERE id=?", turn.conversation_id);
      const { body, tokens, microusd } = buildRequest(config, turn, contracts, current ? JSON.parse(current.history) : []);
      const base = { conversation_id: turn.conversation_id, request_id: turn.request_id, version: turn.expected_version + 1,
        caller_scope: scope, contract_hash: contractHash, context_refs: turn.context_refs, provider: turn.provider, model: config.model,
        reasoning_effort: turn.provider === "meta" ? config.reasoning_effort : null, max_output_tokens: config.max_output,
        usage: { input_tokens: null, output_tokens: null }, cost_usd: null,
        cost_reason: "Provider invoice unavailable; reservations are conservative ceilings, not charges.",
        reserved_tokens: tokens, reserved_usd: null, reservation_status: "pending",
        reservation_ceiling_usd: turn.provider === "meta" ? microusd / 1000000 : null,
        latency_ms: null, error_code: null, executed: false, persisted: true };
      const concurrentReplay = this.#reserve(turn, fingerprint, contractHash, tokens, base);
      if (concurrentReplay) return { status: responseStatus(concurrentReplay), body: concurrentReplay };
      await this.#schedule();
      const started = Date.now(); let reply = {}, proposal, errorCode = null;
      try {
        const reservationId = await hash({ scope, conversation: turn.conversation_id, request: turn.request_id });
        const reservation = await this.env.WORK_REASONING_BUDGET.getByName("provider-allowance-v1").reserve(reservationId, turn.provider, fingerprint, microusd);
        base.reservation_status = reservation.ok ? "reserved" : "denied";
        base.reserved_usd = turn.provider === "meta" ? (reservation.ok ? microusd / 1000000 : 0) : null;
        this.ctx.storage.sql.exec("UPDATE turns SET base=? WHERE conversation=? AND request=? AND response IS NULL", JSON.stringify(base), turn.conversation_id, turn.request_id);
        if (!reservation.ok) fail(429, reservation.code);
        reply = await requestModel(this.env, config, body);
        proposal = parseProposal(reply, turn.provider, contracts);
      } catch (error) {
        errorCode = error instanceof ConversationError ? error.code : "provider_outcome_uncertain";
        proposal = blocked(errorCode);
      }
      const response = await this.#finish(turn, { ...base, ...proposal, usage: usageFor(turn.provider, reply), latency_ms: Date.now() - started, error_code: errorCode }, turn.message);
      await this.#schedule();
      return { status: responseStatus(response), body: response };
    } catch (error) { return failure(error); }
  }

  async alarm() {
    const sql = this.ctx.storage.sql, now = Date.now();
    // A crashed request is sealed as uncertain, never automatically sent to a model again.
    for (const row of rows(sql, "SELECT * FROM turns WHERE response IS NULL AND created<=?", now - 120000)) {
      const base = JSON.parse(row.base);
      await this.#finish({ conversation_id: row.conversation, request_id: row.request }, { ...base, ...blocked("provider_outcome_uncertain"), error_code: "provider_outcome_uncertain" }, "A pending model turn ended without a confirmed outcome.");
    }
    this.ctx.storage.transactionSync(() => {
      sql.exec("UPDATE conversations SET history='[]',active=NULL WHERE created<=?", now - DAY);
      sql.exec("DELETE FROM turns WHERE conversation IN (SELECT id FROM conversations WHERE created<=?)", now - DAY);
      sql.exec("DELETE FROM budgets WHERE hour<?", Math.floor(now / 3600000) - 48);
    });
    await this.#schedule();
  }
}
