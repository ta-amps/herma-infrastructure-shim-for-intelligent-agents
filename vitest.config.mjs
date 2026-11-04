import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { ensureGenerated } from "./scripts/banned_list.mjs";

// The page modules import a git-ignored module built from the shared banned-word list (rule 16). Make sure it exists; with no list on
// this machine the made-up one stands in, which is fine for unit tests (the release gate and the deploy hook refuse it).
ensureGenerated({ fixtureOk: true });

// Exact operator grants for example callers drawn from a fixed pool by each test file.
const choices = [
  { provider: "meta", model: "muse-spark-1.3" }, { provider: "meta", model: "muse-wonder-1.0" },
  { provider: "openai", model: "example-responses-model" },
  { provider: "anthropic", model: "example-claude-model" },
  { provider: "openrouter", model: "example/openrouter-model", routing_provider: "example-host" }
];
const pool = (lane, size, uncertain = false) => Array.from({ length: size }, (_, i) => ({ caller_scope: `key:example-${lane}-${i}`, providers: choices, ...(uncertain ? { allow_uncertain_failover: true } : {}) }));
const grants = [...pool("conversation", 96), ...pool("conversation-uncertain", 16, true), ...pool("health", 64), ...pool("http", 8), ...pool("grants", 32), ...pool("grants-uncertain", 8, true)];

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: "./deploy/cloudflare/wrangler.jsonc" },
    miniflare: {
      bindings: {
        // The tests call the Worker on the workers.dev address; the redirect to the canonical host has its own test.
        CANONICAL_REDIRECT: "off",
        PUBLIC_NAMES_FILTER: "off",
        HERMA_CONVERSATION_ENABLED: "true",
        HERMA_CONVERSATION_DISABLED_PROVIDERS: "[]",
        HERMA_CONVERSATION_MAX_OUTPUT: "16384",
        HERMA_CONVERSATION_OPENAI_MODEL: "example-responses-model",
        HERMA_CONVERSATION_OPENAI_INPUT_USD_PER_MILLION: "1",
        HERMA_CONVERSATION_OPENAI_OUTPUT_USD_PER_MILLION: "3",
        HERMA_OPENAI_BUDGET_USD: "1",
        HERMA_CONVERSATION_ANTHROPIC_MODEL: "example-claude-model",
        HERMA_CONVERSATION_ANTHROPIC_INPUT_USD_PER_MILLION: "1",
        HERMA_CONVERSATION_ANTHROPIC_OUTPUT_USD_PER_MILLION: "3",
        HERMA_ANTHROPIC_BUDGET_USD: "1",
        HERMA_CONVERSATION_OPENROUTER_MODEL: "example/openrouter-model",
        HERMA_CONVERSATION_OPENROUTER_PROVIDER: "example-host",
        HERMA_CONVERSATION_OPENROUTER_INPUT_USD_PER_MILLION: "1",
        HERMA_CONVERSATION_OPENROUTER_OUTPUT_USD_PER_MILLION: "3",
        HERMA_OPENROUTER_BUDGET_USD: "1",
        HERMA_CONVERSATION_PROVIDER_GRANTS: JSON.stringify(grants),
        HERMA_META_BUDGET_USD: "1000",
        META_API_KEY: "example-provider-key",
        OPENAI_API_KEY: "example-openai-key",
        ANTHROPIC_API_KEY: "example-anthropic-key",
        OPENROUTER_API_KEY: "example-openrouter-key",
        BOOTSTRAP_SECRET: "example-bootstrap-value"
      },
      serviceBindings: { TESSERA: async () => Response.json({ code: "offline_fixture" }, { status: 503 }) },
      outboundService: async request => {
        const url = new URL(request.url);
        if (!["https://api.meta.ai/v1/chat/completions", "https://api.openai.com/v1/responses", "https://api.anthropic.com/v1/messages", "https://openrouter.ai/api/v1/chat/completions"].includes(url.href)) return new Response("Blocked fixture destination", { status: 599 });
        const openai = url.hostname === "api.openai.com";
        const anthropic = url.hostname === "api.anthropic.com";
        const openrouter = url.hostname === "openrouter.ai";
        if ((anthropic && request.headers.get("x-api-key") === "example-byo-anthropic-key") || (openrouter && request.headers.get("authorization") === "Bearer example-byo-openrouter-key")) {
          const body = await request.json();
          if (body.messages?.at(-1)?.content !== "byo-paused-provider") return new Response("Unexpected BYO fixture", { status: 422 });
          return Response.json({ model: body.model, observed_max_tokens: body.max_tokens, example_byo: true, content: [{ type: "text", text: "EXAMPLE worker result" }] });
        }
        if (anthropic ? request.headers.get("x-api-key") !== "example-anthropic-key" || request.headers.has("authorization") || request.headers.get("anthropic-version") !== "2026-10-21" : request.headers.get("authorization") !== (openrouter ? "Bearer example-openrouter-key" : openai ? "Bearer example-openai-key" : "Bearer example-provider-key")) return new Response("Invalid fixture credential", { status: 403 });
        const body = await request.json(), text = (openai ? body.input : body.messages).at(-1).content;
        if (openai && (body.messages !== undefined || body.tools[0].function !== undefined || body.store !== false || body.max_output_tokens !== 16384)) return new Response("Invalid Responses protocol", { status: 422 });
        if (anthropic && (typeof body.system !== "string" || !body.tools[0].input_schema || body.messages.some(m => m.role === "system"))) return new Response("Invalid Messages protocol", { status: 422 });
        if (openrouter && (body.provider?.only?.join() !== "example-host" || body.provider?.order?.join() !== "example-host" || body.provider?.allow_fallbacks !== false || body.provider?.require_parameters !== true || body.models !== undefined)) return new Response("Unpinned gateway route", { status: 422 });
        if (url.hostname === "api.meta.ai" && text === "rotate-test") return new Response("EXAMPLE rejection", { status: 429, headers: { "Retry-After": "60" } });
        if (url.hostname === "api.meta.ai" && text === "unknown-rotate-test") return new Response("EXAMPLE uncertain", { status: 503 });
        if (url.hostname === "api.meta.ai" && text.startsWith("accepted-status-")) {
          const status = Number(text.slice("accepted-status-".length));
          return new Response(status === 204 ? null : '{"status":"queued","id":"private-job"}', { status, headers: { Location: "https://example.com/private-job", "Retry-After": "60" } });
        }
        if (openai && ["openai-queued", "openai-in_progress"].includes(text)) return Response.json({ status: text.slice("openai-".length), output: [], id: "private-job" });
        if (text === "duplicate-reply-test") return new Response('{"choices":[{"message":{}}],"choices":[{"message":{}}]}', { headers: { "Content-Type": "application/json" } });
        if (text === "redirect-test") return new Response(null, { status: 302, headers: { Location: "https://example.com/forbidden" } });
        if (text === "too-large-test") return new Response("x".repeat(1048577));
        if (text === "failure-test") return new Response("private upstream body", { status: 429 });
        if (text === "diagnostic-payment") return new Response("EXAMPLE unrecognized payment response", { status: 402 });
        if (text === "diagnostic-timeout") return new Response("EXAMPLE unrecognized timeout response", { status: 408 });
        if (text.startsWith("diagnostic-")) {
          const secretEcho = "sk-" + "example".repeat(8);
          const errors = {
            "diagnostic-parameter": { type: "invalid_request_error", code: "unsupported_parameter", param: "parallel_tool_calls", message: "Unsupported parameter parallel_tool_calls" },
            "diagnostic-credit": { type: "invalid_request_error", message: "Your credit balance is too low" },
            "diagnostic-model": { code: "model_not_found", message: "Model requested does not exist" },
            "diagnostic-unknown": { type: secretEcho, code: secretEcho, param: secretEcho, message: "Unrecognized upstream explanation" }
          };
          const error = errors[text];
          if (error) return Response.json({ error: { ...error, message: `${error.message} ${secretEcho} acct_example_private req_example_private`, metadata: { raw: secretEcho } }, request_id: "req_example_private" }, { status: text === "diagnostic-unknown" ? 503 : text === "diagnostic-model" ? 404 : 400, headers: { "X-Request-ID": "req_example_private" } });
        }
        if (text === "malformed-test") return Response.json({ choices: [null], message: [] });
        const fn = text === "hi" ? { name: "ask_clarification", arguments: { question: "What EXAMPLE observation should be recorded?" } } : {
          name: openai || anthropic ? body.tools[0].name : body.tools[0].function.name,
          arguments: { value: text === "wrong-type-test" ? "{\"example\":true}" : { message: "EXAMPLE hello", example: true } }
        };
        await new Promise(resolve => setTimeout(resolve, text === "health-probe-race" ? 250 : 20));
        if (openai) return Response.json({ status: "completed", output: [{ type: "reasoning", summary: [] }, { type: "function_call", ...fn, arguments: JSON.stringify(fn.arguments) }], usage: { input_tokens: 100, output_tokens: 50 } });
        if (anthropic) return Response.json({ type: "message", stop_reason: "tool_use", content: [{ type: "tool_use", name: fn.name, input: fn.arguments }], usage: { input_tokens: 100, output_tokens: 50 } });
        return Response.json({ model: body.model, provider: openrouter ? "example-host" : "meta", choices: [{ message: { tool_calls: [{ function: { ...fn, arguments: JSON.stringify(fn.arguments) } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
      }
    }
  })],
  test: { include: ["test/*.test.js", "test/*.test.mjs"], testTimeout: 20000 }
});
