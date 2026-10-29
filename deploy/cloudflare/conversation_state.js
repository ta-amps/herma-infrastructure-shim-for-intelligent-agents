// Conversation coordination, not a work queue. Tessera owns executable tasks.
import { DurableObject } from "cloudflare:workers";
import { ConversationError, fail, hash, validateTurn, loadContracts, loadProviderPlan, operatorGrant, requireDirectGrant, upstreamIdentity, providerConfig, providerCredential, buildRequest, requestModel, parseProposal, blocked, usageFor } from "./conversation.js";
import { operatorPolicy, freshHealth, admitHealth, settleHealth, healthView, limitReason, ACCOUNT_LIMITS, IDENTITY_LIMITS } from "./provider_health.js";

const DAY = 86400000;
const rows = (sql, query, ...args) => sql.exec(query, ...args).toArray();
const first = (sql, query, ...args) => rows(sql, query, ...args)[0];
const failure = error => ({ status: error instanceof ConversationError ? error.status : 500, body: { code: error instanceof ConversationError ? error.code : "conversation_internal_error" } });
const responseStatus = response => ["provider_budget_exhausted", "provider_call_budget_exhausted"].includes(response.error_code) ? 429 : 200;
const reservationDenials = new Set(["invalid_budget_reservation", "invalid_provider_configuration", "reservation_replay", "provider_budget_exhausted", "provider_call_budget_exhausted", "provider_operator_disabled", "provider_backpressure", "provider_recovery_probe_required", "provider_recovery_probe_inflight", "provider_outcome_reconciliation_required", "provider_identity_cooldown"]);
const healthStates = (sql, account, provider, model) => Object.fromEntries(["*", model].map(key => [key, { ...freshHealth(), ...JSON.parse(first(sql, "SELECT state FROM provider_health WHERE account=? AND provider=? AND model=?", account, provider, key)?.state || "{}") }]));
const writeHealth = (sql, account, provider, states) => { for (const [model, state] of Object.entries(states)) if (state.generation || state.probe_id) sql.exec("INSERT INTO provider_health VALUES (?,?,?,?) ON CONFLICT(account,provider,model) DO UPDATE SET state=excluded.state", account, provider, model, JSON.stringify(state)); };

// This object coordinates only the shared provider allowance, never transcripts or model I/O.
export class WorkReasoningBudget extends DurableObject {
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

  reserve(id, provider, fingerprint, microusd, recovery = {}) {
    let policy;
    try { policy = operatorPolicy(this.env, provider); } catch { return { ok: false, code: "invalid_provider_configuration" }; }
    if (policy.disabled) return { ok: false, code: "provider_operator_disabled", health: { state: "operator_disabled", reason: "provider_operator_disabled", available_after: null, requires_operator_enable: true } };
    const config = providerConfig(this.env, provider);
    if (!/^[a-f0-9]{64}$/.test(id) || !/^[a-f0-9]{64}$/.test(fingerprint) || !Number.isSafeInteger(microusd) || microusd < 0) return { ok: false, code: "invalid_budget_reservation" };
    return this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      const prior = first(sql, "SELECT * FROM reservations WHERE id=?", id);
      if (prior) { const health = JSON.parse(prior.health); return { ok: prior.provider === provider && prior.fingerprint === fingerprint && prior.microusd === microusd, code: "reservation_replay", health: health.admission?.health, ticket: health.admission?.ticket }; }
      // Another provider route (a direct API or a gateway) holds a different credential, so it
      // cannot reach the same upstream model during that rate or quota limit. One provider's
      // operator accounts keep their own isolated health; changing an alias is explicit operator
      // configuration. Checked before health admission, so the skip never holds a probe lease.
      const held = first(sql, "SELECT available_after,reason,route FROM identity_cooldown WHERE identity=? AND available_after>?", upstreamIdentity(provider, config.model), Date.now() / 1000);
      if (held && held.route !== provider) return { ok: false, code: "provider_identity_cooldown", health: { state: "limited", reason: held.reason, available_after: held.available_after, requires_uncertain_authorization: false, scope: "upstream_model_identity" } };
      const states = healthStates(sql, policy.account, provider, config.model);
      const admission = admitHealth(states, id, Date.now() / 1000, recovery.allow_probe === true, recovery.allow_uncertain === true);
      if (!admission.ok) { writeHealth(sql, policy.account, provider, states); return admission; }
      const day = Math.floor(Date.now() / DAY);
      const total = first(sql, "SELECT microusd FROM totals WHERE provider=?", provider)?.microusd || 0;
      if (provider !== "ollama" && total + microusd > Math.floor(config.budget_usd * 1000000)) return { ok: false, code: "provider_budget_exhausted" };
      if (provider === "ollama" && first(sql, "SELECT COUNT(*) AS n FROM reservations WHERE provider=? AND day=?", provider, day).n >= config.ollama_calls_per_day) return { ok: false, code: "provider_call_budget_exhausted" };
      writeHealth(sql, policy.account, provider, states);
      sql.exec("INSERT INTO reservations (id,provider,fingerprint,microusd,day,health) VALUES (?,?,?,?,?,?)", id, provider, fingerprint, microusd, day, JSON.stringify({ account: policy.account, model: config.model, admission, settled: false }));
      sql.exec("INSERT INTO totals VALUES (?,?) ON CONFLICT(provider) DO UPDATE SET microusd=microusd+excluded.microusd", provider, microusd);
      return { ...admission, reserved_microusd: microusd };
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
      operator_disabled: ["meta", "ollama", "openai", "anthropic", "openrouter"].filter(provider => operatorPolicy(this.env, provider).disabled),
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
      // Every operator-funded turn needs this caller's own explicit grant, with or without a
      // plan. The grant is checked before any turn record, reservation or provider call.
      const turn = validateTurn(raw), grant = operatorGrant(this.env, scope), plan = loadProviderPlan(this.env, scope, turn, entries, grant);
      if (!plan && grant === null) fail(403, "provider_grant_required");
      const initial = plan ? null : providerConfig(this.env, turn.provider);
      if (!plan) requireDirectGrant(grant, initial);
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
          provider_plan_ref: turn.provider_plan_ref, retry_policy: plan ? "explicit_scoped_provider_plan" : "no_automatic_retry_or_provider_fallback",
          operator_grant: { caller_scope: scope, source: "caller_scoped_operator_grant" },
          uncertain_failover: { plan_opt_in: plan?.allow_uncertain_outcome === true, operator_grant: grant?.allow_uncertain_failover === true, allowed: uncertainAllowed }, actions },
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
          upstream_identity: upstreamIdentity(candidate.provider, candidate.model),
          // A possibly charged earlier attempt this one follows under the scoped grant.
          follows_uncertain_attempt_id: attempts.at(-1)?.outcome === "unknown" ? attempts.at(-1).attempt_id : null,
          reported_model: null, status: "selected", outcome: "not_sent", usage: { input_tokens: null, output_tokens: null }, usage_reason: "provider_usage_not_reported", reservation_status: "not_reserved", reserved_tokens: 0, reserved_usd: null, payer: "operator", error_code: null, upstream_http_status: null, provider_diagnostics: null, provider_health: null, available_after: null };
        attempts.push(attempt); persist();
        try {
          let policy;
          try { policy = operatorPolicy(this.env, candidate.provider); } catch { fail(503, "invalid_provider_configuration"); }
          if (policy.disabled) { attempt.provider_health = { state: "operator_disabled", reason: "provider_operator_disabled", available_after: null, requires_operator_enable: true }; fail(503, "provider_operator_disabled"); }
          const config = initial || providerConfig(this.env, candidate.provider);
          if (Date.now() >= turnDeadline) fail(503, "turn_deadline_exhausted");
          if (plan && candidate.provider === "openrouter" && candidate.routing_provider !== config.openrouter_provider) fail(503, "provider_model_not_configured");
          if (config.model !== candidate.model) fail(503, "provider_model_not_configured");
          const { body, tokens, microusd } = buildRequest(config, turn, contracts, current ? JSON.parse(current.history) : []);
          providerCredential(this.env, config.provider);
          Object.assign(attempt, { destination: config.url, routing_provider: config.provider === "openrouter" ? config.openrouter_provider : null, max_output_tokens: config.max_output, timeout_seconds: 25, deadline_policy: "timeout_from_provider_dispatch", reservation_ceiling_tokens: tokens, reservation_ceiling_usd: config.provider === "ollama" ? null : microusd / 1000000 });
          const tokenHour = Math.floor(Date.now() / 3600000);
          this.ctx.storage.transactionSync(() => {
            const hour = tokenHour, budget = first(this.ctx.storage.sql, "SELECT tokens FROM budgets WHERE hour=?", hour);
            if (config.caller_token_limit !== null && tokens + (budget?.tokens || 0) > config.caller_token_limit) fail(429, "conversation_budget_exhausted");
            this.ctx.storage.sql.exec("INSERT INTO budgets VALUES (?,0,?) ON CONFLICT(hour) DO UPDATE SET tokens=tokens+excluded.tokens", hour, tokens);
          });
          base.reserved_tokens += tokens;
          attempt.reserved_tokens = tokens;
          attempt.reservation_status = "pending";
          base.reservation_status = "pending";
          persist();
          const reservation = await this.env.WORK_REASONING_BUDGET.getByName("provider-allowance-v1").reserve(attempt.attempt_id, config.provider, fingerprint, microusd, { allow_probe: plan?.allow_recovery_probe !== false, allow_uncertain: uncertainAllowed });
          if (typeof reservation?.ok !== "boolean" || (!reservation.ok && !reservationDenials.has(reservation.code)) || (reservation.ok && (!reservation.ticket || Object.keys(reservation.ticket).length !== 2 || !["*", config.model].every(key => Object.hasOwn(reservation.ticket, key) && Number.isSafeInteger(reservation.ticket[key]) && reservation.ticket[key] >= 0) || !["healthy", "recovery_probe"].includes(reservation.health?.state)))) throw new Error("invalid_reservation_response");
          attempt.provider_health = reservation.health || null;
          if (reservation.health?.state === "limited") attempt.available_after = reservation.health.available_after;
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
          attempt.health_ticket = reservation.ticket;
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
          if (error instanceof ConversationError) Object.assign(attempt, { upstream_http_status: error.http_status ?? null, provider_diagnostics: error.diagnostics ?? null, retry_after_seconds: error.retry_after_seconds ?? null, retry_guidance_source: error.retry_guidance_source ?? null });
          if (["provider_rate_limited", "provider_unavailable"].includes(errorCode)) attempt.available_after = Date.now() / 1000 + (error.retry_after_seconds ?? 30);
          proposal = blocked(errorCode);
        }
        if (attempt.health_ticket) {
          attempt.provider_health = await this.env.WORK_REASONING_BUDGET.getByName("provider-allowance-v1").recordOutcome(attempt.attempt_id, candidate.provider, fingerprint, { outcome: attempt.outcome, error_code: attempt.error_code, reason: attempt.provider_diagnostics?.reason ?? null, retry_after_seconds: attempt.retry_after_seconds ?? null, http_status: attempt.upstream_http_status });
          attempt.available_after = attempt.provider_health.available_after;
          attempt.health_settled = true;
        }
        if (attempt.available_after !== null) this.ctx.storage.sql.exec("INSERT INTO provider_health VALUES (?,?,?) ON CONFLICT(provider,model) DO UPDATE SET available_after=excluded.available_after", attempt.provider, attempt.model, attempt.available_after);
        persist();
        if (errorCode === null || !plan || !["provider_not_configured", "provider_model_not_configured", "output_allowance_required", "invalid_provider_configuration", "unsupported_generation_configuration", "provider_unauthorized", "provider_rate_limited", "provider_rejected", "provider_outcome_uncertain", "provider_unavailable", "provider_budget_exhausted", "provider_call_budget_exhausted", "provider_cooldown", "provider_operator_disabled", "provider_backpressure", "provider_recovery_probe_required", "provider_recovery_probe_inflight", "provider_outcome_reconciliation_required", "provider_identity_cooldown"].includes(errorCode) || (attempt.outcome === "unknown" && !uncertainAllowed)) break;
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
