import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: "./deploy/cloudflare/wrangler.jsonc" },
    miniflare: {
      bindings: {
        HERMA_CONVERSATION_ENABLED: "true",
        HERMA_CONVERSATION_MAX_OUTPUT: "16384",
        HERMA_CONVERSATION_OPENAI_MODEL: "synthetic-responses-model",
        HERMA_CONVERSATION_OPENAI_INPUT_USD_PER_MILLION: "1",
        HERMA_CONVERSATION_OPENAI_OUTPUT_USD_PER_MILLION: "3",
        HERMA_OPENAI_BUDGET_USD: "1",
        HERMA_CONVERSATION_ANTHROPIC_MODEL: "synthetic-claude-model",
        HERMA_CONVERSATION_ANTHROPIC_INPUT_USD_PER_MILLION: "1",
        HERMA_CONVERSATION_ANTHROPIC_OUTPUT_USD_PER_MILLION: "3",
        HERMA_ANTHROPIC_BUDGET_USD: "1",
        HERMA_CONVERSATION_OPENROUTER_MODEL: "synthetic/openrouter-model",
        HERMA_CONVERSATION_OPENROUTER_PROVIDER: "synthetic-host",
        HERMA_CONVERSATION_OPENROUTER_INPUT_USD_PER_MILLION: "1",
        HERMA_CONVERSATION_OPENROUTER_OUTPUT_USD_PER_MILLION: "3",
        HERMA_OPENROUTER_BUDGET_USD: "1",
        HERMA_CONVERSATION_PROVIDER_PLAN_ALLOWLIST: '[{"provider":"meta","model":"muse-spark-1.3"},{"provider":"ollama","model":"muse-spark-open"}]',
        HERMA_CONVERSATION_ALLOW_UNCERTAIN_FAILOVER: "true",
        HERMA_META_BUDGET_USD: "1",
        HERMA_OLLAMA_CALLS_PER_DAY: "30",
        META_API_KEY: "synthetic-provider-key",
        OLLAMA_API_KEY: "synthetic-provider-key",
        OPENAI_API_KEY: "synthetic-openai-key",
        ANTHROPIC_API_KEY: "synthetic-anthropic-key",
        OPENROUTER_API_KEY: "synthetic-openrouter-key",
        BOOTSTRAP_SECRET: "synthetic-bootstrap-value"
      },
      serviceBindings: { TESSERA: async () => Response.json({ code: "offline_fixture" }, { status: 503 }) },
      outboundService: async request => {
        const url = new URL(request.url);
        if (!["https://api.meta.ai/v1/chat/completions", "https://ollama.com/api/chat", "https://api.openai.com/v1/responses", "https://api.anthropic.com/v1/messages", "https://openrouter.ai/api/v1/chat/completions"].includes(url.href)) return new Response("Blocked fixture destination", { status: 599 });
        const openai = url.hostname === "api.openai.com";
        const anthropic = url.hostname === "api.anthropic.com";
        const openrouter = url.hostname === "openrouter.ai";
        if (anthropic ? request.headers.get("x-api-key") !== "synthetic-anthropic-key" || request.headers.has("authorization") || request.headers.get("anthropic-version") !== "2026-10-21" : request.headers.get("authorization") !== (openrouter ? "Bearer synthetic-openrouter-key" : openai ? "Bearer synthetic-openai-key" : "Bearer synthetic-provider-key")) return new Response("Invalid fixture credential", { status: 403 });
        const body = await request.json(), text = (openai ? body.input : body.messages).at(-1).content;
        if (openai && (body.messages !== undefined || body.tools[0].function !== undefined || body.store !== false || body.max_output_tokens !== 16384)) return new Response("Invalid Responses protocol", { status: 422 });
        if (anthropic && (typeof body.system !== "string" || !body.tools[0].input_schema || body.messages.some(m => m.role === "system"))) return new Response("Invalid Messages protocol", { status: 422 });
        if (openrouter && (body.provider?.only?.join() !== "synthetic-host" || body.provider?.order?.join() !== "synthetic-host" || body.provider?.allow_fallbacks !== false || body.provider?.require_parameters !== true || body.models !== undefined)) return new Response("Unpinned gateway route", { status: 422 });
        if (url.hostname === "api.meta.ai" && text === "rotate-test") return new Response("SYNTHETIC rejection", { status: 429, headers: { "Retry-After": "60" } });
        if (url.hostname === "api.meta.ai" && text === "unknown-rotate-test") return new Response("SYNTHETIC uncertain", { status: 503 });
        if (text === "redirect-test") return new Response(null, { status: 302, headers: { Location: "https://example.com/forbidden" } });
        if (text === "too-large-test") return new Response("x".repeat(1048577));
        if (text === "failure-test") return new Response("private upstream body", { status: 429 });
        if (text === "malformed-test") return Response.json({ choices: [null], message: [] });
        const fn = text === "hi" ? { name: "ask_clarification", arguments: { question: "What SYNTHETIC observation should be recorded?" } } : {
          name: openai || anthropic ? body.tools[0].name : body.tools[0].function.name,
          arguments: { value: text === "wrong-type-test" ? "{\"synthetic\":true}" : { message: "SYNTHETIC hello", synthetic: true } }
        };
        await new Promise(resolve => setTimeout(resolve, 20));
        if (openai) return Response.json({ status: "completed", output: [{ type: "reasoning", summary: [] }, { type: "function_call", ...fn, arguments: JSON.stringify(fn.arguments) }], usage: { input_tokens: 100, output_tokens: 50 } });
        if (anthropic) return Response.json({ type: "message", stop_reason: "tool_use", content: [{ type: "tool_use", name: fn.name, input: fn.arguments }], usage: { input_tokens: 100, output_tokens: 50 } });
        return Response.json(url.hostname === "api.meta.ai" || openrouter ? { model: body.model, provider: openrouter ? "synthetic-host" : "meta", choices: [{ message: { tool_calls: [{ function: { ...fn, arguments: JSON.stringify(fn.arguments) } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 100, completion_tokens: 50 } } : { message: { tool_calls: [{ function: fn }] }, prompt_eval_count: 100, eval_count: 50 });
      }
    }
  })],
  test: { include: ["test/*.test.js"], testTimeout: 20000 }
});
