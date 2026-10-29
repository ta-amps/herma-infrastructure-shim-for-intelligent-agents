// Typed proposals only. These helpers never execute generated code or Tessera actions.
import { Validator } from "@cfworker/json-schema";
import data from "./conversation_data.json" with { type: "json" };
import { canonicalJson, sha256Hex } from "./herma_engine.js";
import { readProviderError } from "./provider_diagnostics.js";
import { operatorPolicy, retryGuidance } from "./provider_health.js";

export class ConversationError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
export const fail = (status, code) => { throw new ConversationError(status, code); };
export const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
export const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
export const hash = value => sha256Hex(canonicalJson(value));
const TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);
const WORDS = new Set(["type", "description", "title", "properties", "required", "additionalProperties", "items", "minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum", "enum", "const", "anyOf", "oneOf"]);
const RATES = { "muse-spark-1.3": [1.25, 4.25], "muse-wonder-1.0": [4, 20] };
const isInt = value => Number.isSafeInteger(value) && value >= 0;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
export const conversationSchemas = data.schemas;

export function strictJson(raw) {
  if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > 1048576) fail(422, "invalid_json");
  const tokens = raw.match(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]|[^\s{}\[\]:,]+/gs) || [];
  const stack = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "{" || t === "[") { stack.push(t === "{" ? new Set() : null); if (stack.length > 32) fail(422, "invalid_json"); }
    else if (t === "}" || t === "]") stack.pop();
    else if (t.startsWith('"') && tokens[i + 1] === ":" && stack.at(-1) instanceof Set) {
      const key = JSON.parse(t);
      if (stack.at(-1).has(key)) fail(422, "duplicate_json_field");
      stack.at(-1).add(key);
    }
  }
  return JSON.parse(raw, (_key, value) => {
    if (typeof value === "number" && !Number.isFinite(value)) fail(422, "invalid_json");
    return value;
  });
}

export function validateTurn(raw) {
  const fields = ["conversation_id", "request_id", "expected_version", "message", "context_refs", "provider", "provider_plan_ref"];
  if (!object(raw) || Object.keys(raw).some(k => !fields.includes(k)) || bytes(raw) > 32768) fail(422, "invalid_conversation_turn");
  if (typeof raw.conversation_id !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(raw.conversation_id) ||
      typeof raw.request_id !== "string" || !/^[A-Za-z0-9_.:-]{8,100}$/.test(raw.request_id) ||
      !isInt(raw.expected_version) || typeof raw.message !== "string" || !raw.message.length || [...raw.message].length > 6000 ||
      !Array.isArray(raw.context_refs) || !raw.context_refs.length || raw.context_refs.length > 12 ||
      raw.context_refs.some(x => typeof x !== "string" || !x.length || x.length > 160) ||
      (raw.provider_plan_ref !== undefined && raw.provider_plan_ref !== null && (typeof raw.provider_plan_ref !== "string" || raw.provider_plan_ref.length < 2 || raw.provider_plan_ref.length > 160)) ||
      !["meta", "ollama", "openai", "anthropic", "openrouter"].includes(raw.provider ?? "ollama")) fail(422, "invalid_conversation_turn");
  return { ...raw, provider: raw.provider ?? "ollama", provider_plan_ref: raw.provider_plan_ref ?? null };
}

// Bounded portable schema profile. No regular expressions, remote references or coercion.
export function checkSchema(schema) {
  let nodes = 0;
  function visit(s, depth = 0) {
    if (!object(s) || ++nodes > 128 || depth > 8 || Object.keys(s).some(k => !WORDS.has(k))) fail(422, "unsupported_work_schema");
    if (!has(s, "type") && !["enum", "const", "anyOf", "oneOf"].some(k => has(s, k))) fail(422, "untyped_work_schema");
    if (has(s, "type") && !TYPES.has(s.type)) fail(422, "invalid_work_schema");
    if (s.type === "object" && (!object(s.properties) || s.additionalProperties !== false)) fail(422, "untyped_work_schema");
    if (s.type === "array" && !has(s, "items")) fail(422, "untyped_work_schema");
    for (const k of ["title", "description"]) if (has(s, k) && (typeof s[k] !== "string" || s[k].length > 1000)) fail(422, "invalid_work_schema");
    for (const k of ["minLength", "maxLength", "minItems", "maxItems"]) if (has(s, k) && (!isInt(s[k]) || s[k] > 32768)) fail(422, "invalid_work_schema");
    for (const k of ["minimum", "maximum"]) if (has(s, k) && (typeof s[k] !== "number" || !Number.isFinite(s[k]))) fail(422, "invalid_work_schema");
    for (const [a, b] of [["minimum", "maximum"], ["minLength", "maxLength"], ["minItems", "maxItems"]]) if (has(s, a) && has(s, b) && s[a] > s[b]) fail(422, "invalid_work_schema");
    const primitive = v => v === null || ["string", "boolean", "number"].includes(typeof v);
    if (has(s, "const") && !primitive(s.const)) fail(422, "invalid_work_schema");
    if (has(s, "enum") && (!Array.isArray(s.enum) || !s.enum.length || s.enum.length > 32 || s.enum.some(v => !primitive(v)) || new Set(s.enum.map(v => JSON.stringify(v))).size !== s.enum.length)) fail(422, "invalid_work_schema");
    if (has(s, "additionalProperties") && typeof s.additionalProperties !== "boolean") fail(422, "invalid_work_schema");
    if (has(s, "properties")) {
      if (s.type !== "object" || !object(s.properties) || Object.keys(s.properties).length > 32) fail(422, "invalid_work_schema");
      for (const [key, value] of Object.entries(s.properties)) {
        if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/.test(key) || ["__proto__", "prototype", "constructor"].includes(key)) fail(422, "invalid_work_schema");
        visit(value, depth + 1);
      }
    }
    if (has(s, "required") && (!Array.isArray(s.required) || new Set(s.required).size !== s.required.length || s.required.some(k => typeof k !== "string" || !has(s.properties || {}, k)))) fail(422, "invalid_work_schema");
    if (has(s, "items")) { if (s.type !== "array") fail(422, "invalid_work_schema"); visit(s.items, depth + 1); }
    for (const k of ["anyOf", "oneOf"]) if (has(s, k)) {
      if (!Array.isArray(s[k]) || !s[k].length || s[k].length > 8) fail(422, "invalid_work_schema");
      for (const alt of s[k]) visit(alt, depth + 1);
    }
  }
  if (!object(schema) || schema.type !== "object" || bytes(schema) > 12000) fail(422, "invalid_work_schema");
  visit(schema);
  return schema;
}

export async function loadContracts(entries, refs) {
  if (refs.some(ref => !entries.some(e => e.entry_id === ref))) fail(422, "invalid_work_contract");
  const contracts = [];
  for (const entry of entries) {
    const c = entry.schema_or_body?.work_contract;
    if (c === undefined) continue;
    if (!object(c) || Object.keys(c).sort().join() !== "category_id,description,input_schema,operation_id" ||
        typeof c.operation_id !== "string" || !/^[a-z][a-z0-9_.:-]{1,79}$/.test(c.operation_id) ||
        !has(data.categories, c.category_id) || typeof c.description !== "string" || !c.description.length || c.description.length > 600 ||
        contracts.some(x => x.operation_id === c.operation_id)) fail(422, "invalid_work_contract");
    checkSchema(c.input_schema);
    contracts.push({ ...c, tool_name: "propose_" + (await sha256Hex(c.operation_id)).slice(0, 16) });
  }
  if (!contracts.length) fail(422, "invalid_work_contract");
  return contracts.sort((a, b) => a.operation_id.localeCompare(b.operation_id));
}

export function loadProviderPlan(env, scope, turn, entries) {
  if (!turn.provider_plan_ref) return null;
  const entry = entries.find(item => item.entry_id === turn.provider_plan_ref);
  const plan = entry?.schema_or_body?.provider_plan;
  let allowed;
  try { allowed = JSON.parse(env.HERMA_CONVERSATION_PROVIDER_PLAN_ALLOWLIST || "[]"); } catch { fail(503, "invalid_provider_configuration"); }
  if (entry?._provider_plan_scope !== scope || entry?.kind !== "noun" || !object(plan) ||
      !new Validator(data.schemas.provider_plan, "2020-12", false).validate(plan).valid ||
      plan.caller_scope !== scope || !Array.isArray(allowed) ||
      new Set(plan.providers.map(item => item.provider)).size !== plan.providers.length ||
      plan.providers.some(item => (item.provider === "openrouter" && !item.routing_provider) || /contributor/i.test(item.model) || !allowed.some(grant => grant?.provider === item.provider && grant?.model === item.model && (grant?.routing_provider ?? null) === (item.routing_provider ?? null))) ||
      plan.providers[0].provider !== turn.provider || !turn.context_refs.includes(turn.provider_plan_ref) ||
      JSON.stringify([...new Set(plan.context_refs)].sort()) !== JSON.stringify([...new Set(turn.context_refs.filter(ref => ref !== turn.provider_plan_ref))].sort()) ||
      (plan.allow_uncertain_outcome && env.HERMA_CONVERSATION_ALLOW_UNCERTAIN_FAILOVER !== "true")) fail(403, "provider_plan_not_authorized");
  return plan;
}

export function providerConfig(env, provider) {
  const prefix = `HERMA_CONVERSATION_${provider.toUpperCase()}`;
  const model = env[`${prefix}_MODEL`] || ({ meta: "muse-spark-1.3", ollama: "muse-spark-open" }[provider] ?? "");
  const output = env[`${prefix}_MAX_OUTPUT`] ?? env.HERMA_CONVERSATION_MAX_OUTPUT;
  if (output === undefined || output === null || output === "") fail(503, "output_allowance_required");
  const max_output = Number(output);
  const reasoning_effort = env[`${prefix}_REASONING`] ?? (!["ollama", "anthropic"].includes(provider) ? env.HERMA_CONVERSATION_REASONING : null) ?? null;
  const meta_budget_usd = Number(env.HERMA_META_BUDGET_USD || 5);
  const ollama_calls_per_day = Number(env.HERMA_OLLAMA_CALLS_PER_DAY || 30);
  const openai_budget_usd = Number(env.HERMA_OPENAI_BUDGET_USD || 0);
  const anthropic_budget_usd = Number(env.HERMA_ANTHROPIC_BUDGET_USD || 0);
  const openrouter_budget_usd = Number(env.HERMA_OPENROUTER_BUDGET_USD || 0);
  const openrouter_provider = env.HERMA_CONVERSATION_OPENROUTER_PROVIDER || null;
  const anthropic_version = env.HERMA_CONVERSATION_ANTHROPIC_VERSION || "2026-10-21";
  const rates = provider === "meta" ? RATES[model] : ["openai", "anthropic", "openrouter"].includes(provider) ? [env[`${prefix}_INPUT_USD_PER_MILLION`], env[`${prefix}_OUTPUT_USD_PER_MILLION`]].map(v => v === undefined || v === "" ? NaN : Number(v)) : null;
  const caller_token_limit = env.HERMA_CONVERSATION_CALLER_TOKENS_PER_HOUR === undefined ? null : Number(env.HERMA_CONVERSATION_CALLER_TOKENS_PER_HOUR);
  let generation;
  try { generation = JSON.parse(env[`${prefix}_GENERATION`] || "{}"); } catch { fail(503, "invalid_provider_configuration"); }
  const reserved = ["model", "input", "messages", "instructions", "system", "tools", "stream", "store", "background", "conversation", "previous_response_id", "parallel_tool_calls", "max_tokens", "max_completion_tokens", "max_output_tokens", "models", "provider", "route", "plugins", "preset", "presets", "web_search_options", "mcp_servers", "container", "server_tools"];
  if (!["meta", "ollama", "openai", "anthropic", "openrouter"].includes(provider) || typeof model !== "string" || !model.length || /contributor/i.test(model) ||
      model === "*" || model.length > 100 || (provider === "meta" && !has(RATES, model)) ||
      !isInt(max_output) || max_output < 1 ||
      (reasoning_effort !== null && (typeof reasoning_effort !== "string" || !reasoning_effort.length || reasoning_effort.length > 40)) ||
      !Number.isFinite(meta_budget_usd) || meta_budget_usd <= 0 ||
      (provider === "openai" && (!Number.isFinite(openai_budget_usd) || openai_budget_usd <= 0 || rates.some(rate => !Number.isFinite(rate) || rate < 0))) ||
      (provider === "anthropic" && (!Number.isFinite(anthropic_budget_usd) || anthropic_budget_usd <= 0 || rates.some(rate => !Number.isFinite(rate) || rate < 0) || !["2023-06-01", "2026-10-21"].includes(anthropic_version) || reasoning_effort !== null)) ||
      (provider === "openrouter" && (!Number.isFinite(openrouter_budget_usd) || openrouter_budget_usd <= 0 || rates.some(rate => !Number.isFinite(rate) || rate < 0) || typeof openrouter_provider !== "string" || !openrouter_provider.length || openrouter_provider.length > 100 || !model.includes("/") || model.startsWith("openrouter/") || model.toLowerCase().includes("@preset") || model.toLowerCase().split(":").slice(1).includes("online"))) ||
      (caller_token_limit !== null && (!isInt(caller_token_limit) || caller_token_limit < 1)) ||
      !object(generation) || Object.keys(generation).some(k => reserved.includes(k)) ||
      (provider === "ollama" && (!object(generation.options ?? {}) || has(generation.options ?? {}, "num_predict"))) ||
      (provider === "openai" && has(generation, "reasoning") && !object(generation.reasoning)) ||
      !isInt(ollama_calls_per_day) || ollama_calls_per_day < 1 || ollama_calls_per_day > 1000) fail(503, "invalid_provider_configuration");
  if (["prompt", "prompt_id", "best_of", "speed", "inference_geo"].some(k => has(generation, k)) ||
      (has(generation, "n") && (!["meta", "openrouter"].includes(provider) || generation.n !== 1)) ||
      (has(generation, "service_tier") && (!["openai", "anthropic"].includes(provider) || generation.service_tier !== (provider === "openai" ? "default" : "standard_only")))) fail(503, "unsupported_generation_configuration");
  const url = { meta: "https://api.meta.ai/v1/chat/completions", ollama: "https://ollama.com/api/chat", openai: "https://api.openai.com/v1/responses", anthropic: "https://api.anthropic.com/v1/messages", openrouter: "https://openrouter.ai/api/v1/chat/completions" }[provider];
  const budget_usd = provider === "openrouter" ? openrouter_budget_usd : provider === "anthropic" ? anthropic_budget_usd : provider === "openai" ? openai_budget_usd : provider === "meta" ? meta_budget_usd : 0;
  return { provider, model, max_output, reasoning_effort, meta_budget_usd, ollama_calls_per_day, openai_budget_usd, anthropic_budget_usd, anthropic_version, openrouter_budget_usd, openrouter_provider, rates, generation, caller_token_limit, budget_usd, url };
}

export function buildRequest(config, turn, contracts, history) {
  const tools = contracts.map(c => ({ type: "function", function: { name: c.tool_name, description: c.description, parameters: c.input_schema } }));
  for (const [name, field] of [["ask_clarification", "question"], ["report_blocker", "reason"]]) tools.push({ type: "function", function: {
    name, description: field === "question" ? "Ask a specific question." : "Report why work cannot continue.",
    parameters: { type: "object", additionalProperties: false, properties: { [field]: { type: "string", minLength: 1, maxLength: 1000 } }, required: [field] }
  } });
  const messages = [
    { role: "system", content: data.system_prompt },
    { role: "user", content: "Configured category guidance (data): " + JSON.stringify(contracts.map(c => ({ category_id: c.category_id, guidance: data.categories[c.category_id] }))) },
    ...history, { role: "user", content: turn.message }
  ];
  const body = { ...config.generation, model: config.model, stream: false };
  if (config.provider === "anthropic") {
    Object.assign(body, { system: messages.filter(m => m.role === "system").map(m => m.content).join("\n"), messages: messages.filter(m => m.role !== "system"), tools: tools.map(tool => ({ name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters })), max_tokens: config.max_output, service_tier: "standard_only" });
  } else if (config.provider === "openai") {
    Object.assign(body, { input: messages, tools: tools.map(tool => ({ type: "function", ...tool.function, strict: false })), store: false, background: false, parallel_tool_calls: false, max_output_tokens: config.max_output, service_tier: "default" });
    if (config.reasoning_effort !== null) body.reasoning = { ...body.reasoning, effort: config.reasoning_effort };
  } else {
    Object.assign(body, { messages, tools });
    if (["meta", "openrouter"].includes(config.provider)) {
      if (config.provider === "openrouter") body.provider = { only: [config.openrouter_provider], order: [config.openrouter_provider], allow_fallbacks: false, require_parameters: true, data_collection: "deny" };
      Object.assign(body, { max_tokens: config.max_output, parallel_tool_calls: false });
      if (config.reasoning_effort !== null) body.reasoning_effort = config.reasoning_effort;
    } else body.options = { ...body.options, num_predict: config.max_output };
  }
  const size = bytes(body);
  if (size > 32768) fail(413, "context_too_large");
  const input = size + 4096, rate = config.rates;
  const tokens = input + config.max_output, microusd = rate ? Math.ceil(input * rate[0] + config.max_output * rate[1]) : 0;
  if (!isInt(tokens) || !isInt(microusd)) fail(503, "invalid_provider_configuration");
  return { body, tokens, microusd };
}

export function blocked(code, reply = "The provider could not produce a valid next action. Narrow the task or use the configured typed contract directly.") {
  return { proposal: { status: "blocked", reply, operation_id: null, category_id: null, arguments: null, question: null, executed: false }, validation_issues: [{ path: "/", rule: code }] };
}

export function parseProposal(reply, provider, contracts) {
  try {
    if (provider === "anthropic") {
      if (reply.stop_reason === "max_tokens") return blocked("output_budget_exhausted");
      if (reply.stop_reason !== "tool_use" || !Array.isArray(reply.content)) return blocked("invalid_tool_call");
      reply = { message: { tool_calls: reply.content.filter(item => object(item) && item.type === "tool_use").map(item => ({ function: { name: item.name, arguments: item.input } })) } };
    } else if (provider === "openai") {
      if (reply.status === "incomplete" && reply.incomplete_details?.reason === "max_output_tokens") return blocked("output_budget_exhausted");
      if (reply.status !== "completed" || !Array.isArray(reply.output)) return blocked("invalid_tool_call");
      reply = { message: { tool_calls: reply.output.filter(item => object(item) && item.type === "function_call").map(item => ({ function: item })) } };
    }
    const choice = ["meta", "openrouter"].includes(provider) ? reply.choices?.[0] : reply;
    if (!object(choice)) return blocked("invalid_tool_call");
    if ((choice.finish_reason || choice.done_reason) === "length") return blocked("output_budget_exhausted");
    const calls = choice.message?.tool_calls;
    if (!Array.isArray(calls) || calls.length !== 1 || !object(calls[0]?.function)) return blocked("invalid_tool_call");
    const fn = calls[0].function;
    const args = typeof fn.arguments === "string" ? strictJson(fn.arguments) : fn.arguments;
    if (!object(args) || bytes(args) > 32768) return blocked("invalid_tool_call");
    if (["ask_clarification", "report_blocker"].includes(fn.name)) {
      const field = fn.name === "ask_clarification" ? "question" : "reason";
      if (Object.keys(args).join() !== field || typeof args[field] !== "string" || !args[field].length || args[field].length > 2000) return blocked("invalid_tool_call");
      const value = args[field].replaceAll("\u2014", "; ").slice(0, 2000);
      return { proposal: { status: field === "question" ? "clarify" : "blocked", reply: value, question: field === "question" ? value : null, operation_id: null, category_id: null, arguments: null, executed: false }, validation_issues: [] };
    }
    const contract = contracts.find(c => c.tool_name === fn.name);
    if (!contract) return blocked("invalid_tool_call");
    const result = new Validator(contract.input_schema, "2020-12", false).validate(args);
    if (!result.valid) return { proposal: { status: "clarify", reply: "The proposed payload did not match the configured contract.", question: "Provide values matching the required JSON field types.", operation_id: null, category_id: null, arguments: null, executed: false }, validation_issues: result.errors.slice(0, 8).map(e => ({ path: e.instanceLocation || "/", rule: e.keyword })) };
    return { proposal: { status: "ready", reply: "A typed next action is ready for your authorized harness to execute.", operation_id: contract.operation_id, category_id: contract.category_id, arguments: args, question: null, executed: false }, validation_issues: [] };
  } catch { return blocked("invalid_tool_call"); }
}

export function providerCredential(env, provider) {
  const key = env[{ meta: "META_API_KEY", ollama: "OLLAMA_API_KEY", openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", openrouter: "OPENROUTER_API_KEY" }[provider]];
  if (typeof key !== "string" || !key.trim()) { const error = new ConversationError(503, "provider_not_configured"); error.outcome = "not_sent"; throw error; }
  return key;
}

export async function requestModel(env, config, body, timeoutMs = 25000) {
  let policy;
  try { policy = operatorPolicy(env, config.provider); } catch { fail(503, "invalid_provider_configuration"); }
  if (policy.disabled) { const error = new ConversationError(503, "provider_operator_disabled"); error.outcome = "not_sent"; throw error; }
  const key = providerCredential(env, config.provider);
  const url = config.url;
  const headers = config.provider === "anthropic" ? { "x-api-key": key, "anthropic-version": config.anthropic_version, "Content-Type": "application/json" } : { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), redirect: "manual", signal: controller.signal });
    if (response.status !== 200) {
      const accepted = response.status >= 200 && response.status < 300;
      const code = accepted ? "provider_outcome_uncertain" : response.status === 429 ? "provider_rate_limited" : [401, 403].includes(response.status) ? "provider_unauthorized" : response.status >= 500 ? "provider_unavailable" : "provider_rejected";
      const error = new ConversationError(502, code);
      error.http_status = response.status;
      error.outcome = accepted || response.status >= 500 || response.status === 408 ? "unknown" : "rejected";
      const retry = retryGuidance(response.headers, Date.now() / 1000);
      error.retry_after_seconds = retry.seconds;
      error.retry_guidance_source = retry.source;
      error.diagnostics = await readProviderError(response);
      throw error;
    }
    const reader = response.body.getReader(), chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 1048576) { await reader.cancel(); fail(502, "provider_response_too_large"); }
      chunks.push(value);
    }
    const raw = new Uint8Array(size); let at = 0;
    for (const chunk of chunks) { raw.set(chunk, at); at += chunk.byteLength; }
    const parsed = strictJson(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    if (!object(parsed)) fail(502, "provider_invalid_response");
    if (config.provider === "openai" && ["queued", "in_progress"].includes(parsed.status)) {
      const error = new ConversationError(502, "provider_outcome_uncertain"); error.outcome = "unknown"; error.http_status = 200; throw error;
    }
    return parsed;
  } catch (error) {
    if (error instanceof ConversationError) throw error;
    fail(502, "provider_unavailable");
  } finally { clearTimeout(timer); }
}

export function usageFor(provider, reply) {
  const source = provider === "ollama" ? reply : reply.usage;
  const fields = ["meta", "openrouter"].includes(provider) ? ["prompt_tokens", "completion_tokens"] : ["openai", "anthropic", "jev"].includes(provider) ? ["input_tokens", "output_tokens"] : ["prompt_eval_count", "eval_count"];
  return Object.fromEntries(["input_tokens", "output_tokens"].map((k, i) => [k, isInt(source?.[fields[i]]) ? source[fields[i]] : null]));
}
