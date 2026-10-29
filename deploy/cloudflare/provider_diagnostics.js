// Fixed provider-reported categories only. No raw error fields enter receipts.
export const ERROR_BODY_BYTES = 16384;
const TYPES = new Set(["invalid_request_error", "authentication_error", "permission_error", "billing_error", "not_found_error", "conflict_error", "request_too_large", "rate_limit_error", "api_error", "timeout_error", "overloaded_error", "server_error", "insufficient_quota"]);
const CODES = new Set(["invalid_api_key", "insufficient_quota", "billing_hard_limit_reached", "credits_exhausted", "model_not_found", "invalid_model", "unsupported_parameter", "unsupported_value", "invalid_parameter", "context_length_exceeded", "rate_limit_exceeded", "invalid_request_error", "server_error", 400, 401, 402, 403, 404, 408, 409, 413, 422, 429, 500, 502, 503, 504, 529]);
const PARAMETERS = new Set(["model", "tools", "tool_choice", "parallel_tool_calls", "max_tokens", "max_completion_tokens", "max_output_tokens", "temperature", "top_p", "top_k", "reasoning", "reasoning_effort", "thinking", "output_config", "provider"]);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);

export function normalizeProviderError(raw, bodyState = null) {
  const result = { source: "provider_reported", body_state: "parsed", type: null, code: null, parameter: null, reason: "unknown" };
  if (bodyState !== null) return { ...result, body_state: ["oversized", "unavailable"].includes(bodyState) ? bodyState : "unavailable" };
  if (raw.byteLength > ERROR_BODY_BYTES) return { ...result, body_state: "oversized" };
  if (!raw.byteLength) return { ...result, body_state: "empty" };
  let parsed;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); } catch { return { ...result, body_state: "malformed" }; }
  if (!object(parsed)) return { ...result, body_state: "unrecognized" };
  let error = Object.hasOwn(parsed, "error") ? parsed.error : parsed, message;
  if (typeof error === "string") { message = error; error = {}; }
  else if (object(error)) message = error.message;
  else return { ...result, body_state: "unrecognized" };
  const kind = error.type, code = error.code, parameter = error.param;
  result.type = TYPES.has(kind) ? kind : null;
  result.code = CODES.has(code) ? code : null;
  result.parameter = PARAMETERS.has(parameter) ? parameter : null;
  message = typeof message === "string" ? message.toLowerCase() : "";
  if (["insufficient_quota", "billing_hard_limit_reached", "credits_exhausted"].includes(code) || ["billing_error", "insufficient_quota"].includes(kind) || ["credit balance", "insufficient credit", "insufficient quota", "current quota", "spend limit", "spend cap", "payment required"].some(text => message.includes(text))) result.reason = "credit_or_quota_exhausted";
  else if (kind === "authentication_error" || code === "invalid_api_key") result.reason = "authentication_failed";
  else if (kind === "permission_error") result.reason = "permission_denied";
  else if (code === "context_length_exceeded") result.reason = "context_too_large";
  else if (["no endpoints found", "no eligible provider", "no available provider"].some(text => message.includes(text))) result.reason = "no_eligible_provider_endpoint";
  else if (["model_not_found", "invalid_model"].includes(code) || (message.includes("model") && ["not found", "does not exist", "not available"].some(text => message.includes(text)))) result.reason = "model_unavailable";
  else if (code === "unsupported_parameter" || message.includes("unsupported parameter") || ([...PARAMETERS].some(name => message.includes(name)) && ["not supported", "does not support", "unsupported"].some(text => message.includes(text)))) result.reason = "unsupported_parameter";
  else if (["max_tokens", "max_output_tokens", "max_completion_tokens"].some(name => message.includes(name)) && ["maximum", "exceed", "at most", "must be", "too large", "too high"].some(text => message.includes(text))) result.reason = "output_allowance_not_supported";
  else if (kind === "rate_limit_error" || code === "rate_limit_exceeded") result.reason = "rate_limited";
  else if (["api_error", "server_error", "timeout_error", "overloaded_error"].includes(kind) || code === "server_error") result.reason = "provider_service_unavailable";
  return result;
}

export async function readProviderError(response) {
  if (!response.body) return normalizeProviderError(new Uint8Array());
  let reader;
  const chunks = []; let size = 0;
  try {
    reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      if (size + value.byteLength > ERROR_BODY_BYTES) { await reader.cancel(); return normalizeProviderError(new Uint8Array(), "oversized"); }
      chunks.push(value); size += value.byteLength;
    }
    const raw = new Uint8Array(size); let at = 0;
    for (const chunk of chunks) { raw.set(chunk, at); at += chunk.byteLength; }
    return normalizeProviderError(raw);
  } catch { return normalizeProviderError(new Uint8Array(), "unavailable"); }
  finally { reader?.releaseLock(); }
}
