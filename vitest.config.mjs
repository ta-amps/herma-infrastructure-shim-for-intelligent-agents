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
        HERMA_META_BUDGET_USD: "1",
        HERMA_OLLAMA_CALLS_PER_DAY: "30",
        META_API_KEY: "synthetic-provider-key",
        OLLAMA_API_KEY: "synthetic-provider-key",
        OPENAI_API_KEY: "synthetic-openai-key",
        BOOTSTRAP_SECRET: "synthetic-bootstrap-value"
      },
      serviceBindings: { TESSERA: async () => Response.json({ code: "offline_fixture" }, { status: 503 }) },
      outboundService: async request => {
        const url = new URL(request.url);
        if (!["https://api.meta.ai/v1/chat/completions", "https://ollama.com/api/chat", "https://api.openai.com/v1/responses"].includes(url.href)) return new Response("Blocked fixture destination", { status: 599 });
        const openai = url.hostname === "api.openai.com";
        if (request.headers.get("authorization") !== (openai ? "Bearer synthetic-openai-key" : "Bearer synthetic-provider-key")) return new Response("Invalid fixture credential", { status: 403 });
        const body = await request.json(), text = (openai ? body.input : body.messages).at(-1).content;
        if (openai && (body.messages !== undefined || body.tools[0].function !== undefined || body.store !== false || body.max_output_tokens !== 16384)) return new Response("Invalid Responses protocol", { status: 422 });
        if (text === "redirect-test") return new Response(null, { status: 302, headers: { Location: "https://example.com/forbidden" } });
        if (text === "too-large-test") return new Response("x".repeat(1048577));
        if (text === "failure-test") return new Response("private upstream body", { status: 429 });
        if (text === "malformed-test") return Response.json({ choices: [null], message: [] });
        const fn = text === "hi" ? { name: "ask_clarification", arguments: { question: "What SYNTHETIC observation should be recorded?" } } : {
          name: openai ? body.tools[0].name : body.tools[0].function.name,
          arguments: { value: text === "wrong-type-test" ? "{\"synthetic\":true}" : { message: "SYNTHETIC hello", synthetic: true } }
        };
        await new Promise(resolve => setTimeout(resolve, 20));
        if (openai) return Response.json({ status: "completed", output: [{ type: "reasoning", summary: [] }, { type: "function_call", ...fn, arguments: JSON.stringify(fn.arguments) }], usage: { input_tokens: 100, output_tokens: 50 } });
        return Response.json(url.hostname === "api.meta.ai" ? { choices: [{ message: { tool_calls: [{ function: { ...fn, arguments: JSON.stringify(fn.arguments) } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 100, completion_tokens: 50 } } : { message: { tool_calls: [{ function: fn }] }, prompt_eval_count: 100, eval_count: 50 });
      }
    }
  })],
  test: { include: ["test/*.test.js"], testTimeout: 20000 }
});
