// Conversation coordination, not a work queue. Tessera owns executable tasks.
import { DurableObject } from "cloudflare:workers";
import { ConversationError, fail, hash, validateTurn, loadContracts, loadProviderPlan, providerConfig, buildRequest, requestModel, parseProposal, blocked, usageFor } from "./conversation.js";

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
    if (!/^[a-f0-9]{64}$/.test(id) || !/^[a-f0-9]{64}$/.test(fingerprint) || !Number.isSafeInteger(microusd) || microusd < 0) return { ok: false, code: "invalid_budget_reservation" };
    return this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      const prior = first(sql, "SELECT * FROM reservations WHERE id=?", id);
      if (prior) return { ok: prior.provider === provider && prior.fingerprint === fingerprint && prior.microusd === microusd, code: "reservation_replay" };
      const day = Math.floor(Date.now() / DAY);
      const total = first(sql, "SELECT microusd FROM totals WHERE provider=?", provider)?.microusd || 0;
      if (provider !== "ollama" && total + microusd > Math.floor(config.budget_usd * 1000000)) return { ok: false, code: "provider_budget_exhausted" };
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
        CREATE TABLE IF NOT EXISTS provider_health (provider TEXT NOT NULL, model TEXT NOT NULL, available_after REAL NOT NULL, PRIMARY KEY(provider,model));
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

  #reserve(turn, fingerprint, contractHash, tokens, base, config) {
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
      if ((budget?.turns || 0) >= 60 || (config.caller_token_limit !== null && (budget?.tokens || 0) + tokens > config.caller_token_limit)) fail(429, "conversation_budget_exhausted");
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
      const turn = validateTurn(raw), plan = loadProviderPlan(this.env, scope, turn, entries);
      const initial = plan ? null : providerConfig(this.env, turn.provider);
      const candidates = plan?.providers || [{ provider: turn.provider, model: initial.model }];
      const contracts = await loadContracts(entries.filter(item => item.entry_id !== turn.provider_plan_ref), turn.context_refs.filter(ref => ref !== turn.provider_plan_ref));
      const planNoun = plan ? entries.find(item => item.entry_id === turn.provider_plan_ref) : null;
      const contractHash = await hash({ contracts: contracts.map(({ tool_name, ...c }) => c), provider_plan: planNoun });
      const fingerprint = await hash({ turn, contract_hash: contractHash });
      const replay = this.#replay(turn, fingerprint);
      if (replay) return { status: responseStatus(replay), body: replay };
      const current = first(this.ctx.storage.sql, "SELECT history FROM conversations WHERE id=?", turn.conversation_id);
      const attempts = [], actions = [{ action: "resolve_contracts_and_provider_plan", model: null, provider: null, model_reason: "deterministic_authorization_and_schema_checks", parent_attempt_id: null }];
      const base = { conversation_id: turn.conversation_id, request_id: turn.request_id, version: turn.expected_version + 1,
        caller_scope: scope, contract_hash: contractHash, context_refs: turn.context_refs, provider: candidates[0].provider, model: candidates[0].model,
        reasoning_effort: initial?.reasoning_effort ?? null, max_output_tokens: initial?.max_output ?? null,
        usage: { input_tokens: null, output_tokens: null }, cost_usd: null,
        cost_reason: "Provider invoice unavailable; reservations are conservative ceilings, not charges.",
        reserved_tokens: 0, reserved_usd: null, reservation_status: "pending", reservation_ceiling_usd: null,
        server_exception: { purpose: "caller_requested_typed_proposal", worker_path_reason: "Caller explicitly selected the interactive server capability.", principal: scope,
          data_scope: { caller_scope: scope, context_refs: turn.context_refs, conversation_id: turn.conversation_id }, effects: "proposal_only", payer: "operator",
          work_kind: "verb", operation_id: "propose_typed_action", lifecycle_owner: "herma_conversation_turn", result_kind: "noun",
          provider_plan_ref: turn.provider_plan_ref, retry_policy: plan ? "explicit_scoped_provider_plan" : "no_automatic_retry_or_provider_fallback", actions },
        attempts, latency_ms: null, error_code: null, executed: false, persisted: true };
      const concurrentReplay = this.#reserve(turn, fingerprint, contractHash, 0, base, { caller_token_limit: null });
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
          reported_model: null, status: "selected", outcome: "not_sent", usage: { input_tokens: null, output_tokens: null }, usage_reason: "provider_usage_not_reported", reservation_status: "not_reserved", reserved_tokens: 0, reserved_usd: null, payer: "operator", error_code: null, upstream_http_status: null, provider_diagnostics: null, available_after: null };
        attempts.push(attempt); persist();
        try {
          const config = initial || providerConfig(this.env, candidate.provider);
          if (Date.now() >= turnDeadline) fail(503, "turn_deadline_exhausted");
          if (plan && candidate.provider === "openrouter" && candidate.routing_provider !== config.openrouter_provider) fail(503, "provider_model_not_configured");
          if (config.model !== candidate.model) fail(503, "provider_model_not_configured");
          const available = first(this.ctx.storage.sql, "SELECT available_after FROM provider_health WHERE provider=? AND model=?", candidate.provider, candidate.model)?.available_after || 0;
          if (available > Date.now() / 1000) { attempt.available_after = available; fail(503, "provider_cooldown"); }
          const { body, tokens, microusd } = buildRequest(config, turn, contracts, current ? JSON.parse(current.history) : []);
          Object.assign(attempt, { destination: config.url, routing_provider: config.provider === "openrouter" ? config.openrouter_provider : null, max_output_tokens: config.max_output, timeout_seconds: 25, deadline_policy: "timeout_from_provider_dispatch", reserved_tokens: tokens, reservation_ceiling_usd: config.provider === "ollama" ? null : microusd / 1000000 });
          const tokenHour = Math.floor(Date.now() / 3600000);
          this.ctx.storage.transactionSync(() => {
            const hour = tokenHour, budget = first(this.ctx.storage.sql, "SELECT tokens FROM budgets WHERE hour=?", hour);
            if (config.caller_token_limit !== null && tokens + (budget?.tokens || 0) > config.caller_token_limit) fail(429, "conversation_budget_exhausted");
            this.ctx.storage.sql.exec("INSERT INTO budgets VALUES (?,0,?) ON CONFLICT(hour) DO UPDATE SET tokens=tokens+excluded.tokens", hour, tokens);
          });
          base.reserved_tokens += tokens;
          persist();
          const reservation = await this.env.WORK_REASONING_BUDGET.getByName("provider-allowance-v1").reserve(attempt.attempt_id, config.provider, fingerprint, microusd);
          attempt.reservation_status = reservation.ok ? "reserved" : "denied";
          attempt.reserved_usd = config.provider === "ollama" ? null : reservation.ok ? microusd / 1000000 : 0;
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
          if (config.provider !== "ollama") base.reserved_usd = (base.reserved_usd || 0) + microusd / 1000000;
          Object.assign(base, { provider: config.provider, model: config.model, reasoning_effort: config.provider === "ollama" ? null : config.reasoning_effort, max_output_tokens: config.max_output, reservation_ceiling_usd: attempt.reservation_ceiling_usd });
          Object.assign(attempt, { status: "in_flight", outcome: "unknown" });
          Object.assign(base.server_exception, { provider: config.provider, model: config.model, destination: config.url, max_output_tokens: config.max_output, reserved_tokens: base.reserved_tokens, reservation_ceiling_usd: base.reserved_usd, timeout_seconds: 25, deadline_policy: "timeout_from_provider_dispatch" });
          actions.push({ action: "provider_request", provider: config.provider, model: config.model, parent_attempt_id: attempt.attempt_id });
          persist();
          const remainingMs = Math.min(25000, turnDeadline - Date.now());
          if (remainingMs <= 0) fail(503, "turn_deadline_exhausted");
          attempt.timeout_seconds = remainingMs / 1000;
          persist();
          const reply = await requestModel(this.env, config, body, remainingMs);
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
          if (error instanceof ConversationError) Object.assign(attempt, { upstream_http_status: error.http_status ?? null, provider_diagnostics: error.diagnostics ?? null });
          if (["provider_rate_limited", "provider_unavailable"].includes(errorCode)) attempt.available_after = Date.now() / 1000 + (error.retry_after_seconds ?? 30);
          proposal = blocked(errorCode);
        }
        if (attempt.available_after !== null) this.ctx.storage.sql.exec("INSERT INTO provider_health VALUES (?,?,?) ON CONFLICT(provider,model) DO UPDATE SET available_after=excluded.available_after", attempt.provider, attempt.model, attempt.available_after);
        persist();
        if (errorCode === null || !plan || !["provider_not_configured", "provider_model_not_configured", "output_allowance_required", "invalid_provider_configuration", "provider_unauthorized", "provider_rate_limited", "provider_rejected", "provider_unavailable", "provider_budget_exhausted", "provider_call_budget_exhausted", "provider_cooldown"].includes(errorCode) || (attempt.outcome === "unknown" && !plan.allow_uncertain_outcome)) break;
      }
      const last = attempts.at(-1);
      const response = await this.#finish(turn, { ...base, ...proposal, provider: last.provider, model: last.model, usage: last.usage, latency_ms: Date.now() - started, error_code: errorCode }, turn.message);
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
