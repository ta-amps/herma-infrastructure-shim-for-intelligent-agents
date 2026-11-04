// Deterministic shared availability inside the existing operator allowance coordinator.
const PROVIDERS = ["meta", "openai", "anthropic", "openrouter"];
const HOST_PROVIDERS = new Map([["api.meta.ai", "meta"], ["api.openai.com", "openai"], ["api.anthropic.com", "anthropic"], ["openrouter.ai", "openrouter"]]);
export const providerForHost = host => HOST_PROVIDERS.get(String(host || "").toLowerCase()) || null;
// Limits that belong to the paying account rather than one model.
export const ACCOUNT_LIMITS = new Set(["credit_or_quota_exhausted", "payment_required"]);
// Rate and quota limits also hold the upstream model identity against every other route.
export const IDENTITY_LIMITS = new Set(["rate_limited", ...ACCOUNT_LIMITS]);
// Empty or whitespace-only settings are unset, as in Python.
const unset = value => typeof value !== "string" || !value.trim();
export function operatorPolicy(env, provider) {
  const disabledSetting = env.HERMA_CONVERSATION_DISABLED_PROVIDERS, accountSetting = env[`HERMA_CONVERSATION_${provider.toUpperCase()}_ACCOUNT_SCOPE`];
  const disabled = JSON.parse(unset(disabledSetting) ? "[]" : disabledSetting);
  const account = unset(accountSetting) ? "operator" : accountSetting.trim();
  if (!Array.isArray(disabled) || disabled.some(p => !PROVIDERS.includes(p)) || !/^[A-Za-z0-9_-]{1,64}$/.test(account)) throw new Error("invalid_provider_configuration");
  return { disabled: disabled.includes(provider), account };
}
export function retryGuidance(headers, now) {
  const valid = value => Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER - now;
  const raw = headers.get("retry-after");
  if (raw && raw.length <= 128) {
    const value = Number.isFinite(Number(raw)) ? Number(raw) : Math.max(0, (Date.parse(raw) / 1000) - now);
    if (valid(value)) return { seconds: value, source: "retry_after" };
  }
  const resets = [];
  for (const name of ["requests", "tokens", "project-tokens"]) {
    const value = headers.get(`x-ratelimit-reset-${name}`) || "";
    if (value.length <= 128 && /^(?:\d+(?:\.\d+)?(?:ms|s|m|h|d))+$/.test(value)) {
      const seconds = [...value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d)/g)].reduce((sum, match) => sum + Number(match[1]) * ({ ms: .001, s: 1, m: 60, h: 3600, d: 86400 }[match[2]]), 0);
      if (valid(seconds)) resets.push(seconds);
    }
  }
  for (const name of ["requests", "tokens", "input-tokens", "output-tokens"]) {
    const raw = headers.get(`anthropic-ratelimit-${name}-reset`) || "";
    if (raw.length <= 128 && /(?:Z|[+-]\d\d:\d\d)$/.test(raw)) {
      const seconds = Math.max(0, Date.parse(raw) / 1000 - now);
      if (valid(seconds)) resets.push(seconds);
    }
  }
  return resets.length ? { seconds: Math.max(...resets), source: "provider_reset" } : { seconds: null, source: null };
}
export const freshHealth = () => ({ generation: 0, failures: 0, available_after: 0, reason: null, uncertain: false, probe_id: null, probe_until: 0 });
const cooldown = (failures, reason) => Math.min(3600, (ACCOUNT_LIMITS.has(reason) ? 300 : 30) * 2 ** Math.min(Math.max(failures - 1, 0), 7));
// The shared limit an attempt's outcome demonstrates, if any (Python's limit_reason).
export const limitReason = (outcome, errorCode, reason, httpStatus) => reason === "credit_or_quota_exhausted" ? reason : httpStatus === 402 || reason === "payment_required" ? "payment_required" : errorCode === "provider_rate_limited" || reason === "rate_limited" ? "rate_limited" : errorCode === "provider_unavailable" || outcome === "unknown" ? "provider_unavailable" : null;
export const healthView = (state, probe = false) => ({ state: probe ? "recovery_probe" : state.failures ? "limited" : "healthy", reason: state.reason, available_after: Math.max(state.available_after, state.probe_until), requires_uncertain_authorization: state.uncertain, scope: "operator_provider_account" });
export function admitHealth(states, attempt, now, allowProbe, allowUncertain) {
  for (const state of Object.values(states)) {
    if (state.probe_id && state.probe_until <= now) {
      Object.assign(state, { generation: state.generation + 1, failures: state.failures + 1, uncertain: true, probe_id: null, probe_until: 0, reason: "provider_probe_outcome_uncertain" });
      state.available_after = now + cooldown(state.failures, state.reason);
    }
    const code = state.probe_id ? "provider_recovery_probe_inflight" : state.failures && state.available_after > now ? "provider_backpressure" : state.failures && !allowProbe ? "provider_recovery_probe_required" : state.failures && state.uncertain && !allowUncertain ? "provider_outcome_reconciliation_required" : null;
    if (code) return { ok: false, code, health: healthView(state) };
  }
  const ticket = Object.fromEntries(Object.entries(states).map(([key, state]) => [key, state.generation]));
  let probe = false;
  for (const state of Object.values(states)) if (state.failures) { state.probe_id = attempt; state.probe_until = now + 120; probe = true; }
  return { ok: true, ticket, health: healthView(Object.values(states).sort((a,b) => b.failures - a.failures)[0], probe) };
}
export function settleHealth(states, ticket, attempt, model, now, outcome, errorCode, reason, retrySeconds, httpStatus = null) {
  const limited = limitReason(outcome, errorCode, reason, httpStatus);
  const target = ACCOUNT_LIMITS.has(limited) ? "*" : model;
  for (const [key, state] of Object.entries(states)) {
    const same = state.generation === ticket[key], ownsProbe = state.probe_id === attempt;
    if (limited && key === target) {
      const failures = same || ownsProbe ? state.failures + 1 : Math.max(1, state.failures), delay = retrySeconds !== null && retrySeconds > 0 ? retrySeconds : cooldown(failures, limited);
      Object.assign(state, { generation: state.generation + 1, failures, available_after: Math.max(state.available_after, now + delay), reason: limited, uncertain: state.uncertain || outcome === "unknown", probe_id: ownsProbe ? null : state.probe_id, probe_until: ownsProbe ? 0 : state.probe_until });
    } else if (ownsProbe && outcome === "completed") {
      if (same) Object.assign(state, freshHealth(), { generation: state.generation + 1 });
      else Object.assign(state, { probe_id: null, probe_until: 0 });
    }
    else if (ownsProbe) {
      Object.assign(state, { generation: state.generation + 1, failures: state.failures + 1, probe_id: null, probe_until: 0, uncertain: state.uncertain || outcome === "unknown" });
      state.available_after = Math.max(state.available_after, now + cooldown(state.failures, state.reason));
    }
  }
  return healthView(Object.values(states).sort((a,b) => Number(b.failures > 0) - Number(a.failures > 0) || b.available_after - a.available_after)[0]);
}
