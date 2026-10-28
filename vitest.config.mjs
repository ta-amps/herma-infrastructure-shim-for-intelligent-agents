import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: "./deploy/cloudflare/wrangler.jsonc" },
    miniflare: {
      bindings: {
        HERMA_CONVERSATION_ENABLED: "true",
        HERMA_META_BUDGET_USD: "1",
        HERMA_OLLAMA_CALLS_PER_DAY: "30",
        META_API_KEY: "synthetic-provider-key",
        OLLAMA_API_KEY: "synthetic-provider-key",
        BOOTSTRAP_SECRET: "synthetic-bootstrap-value"
      },
      serviceBindings: { TESSERA: async () => Response.json({ code: "offline_fixture" }, { status: 503 }) },
      outboundService: async request => {
        const url = new URL(request.url);
        if (!["https://api.meta.ai/v1/chat/completions", "https://ollama.com/api/chat"].includes(url.href)) return new Response("Blocked fixture destination", { status: 599 });
        if (request.headers.get("authorization") !== "Bearer synthetic-provider-key") return new Response("Invalid fixture credential", { status: 403 });
        const body = await request.json(), text = body.messages.at(-1).content;
        if (text === "redirect-test") return new Response(null, { status: 302, headers: { Location: "https://example.com/forbidden" } });
        if (text === "too-large-test") return new Response("x".repeat(1048577));
        if (text === "failure-test") return new Response("private upstream body", { status: 429 });
        if (text === "malformed-test") return Response.json({ choices: [null], message: [] });
        const fn = text === "hi" ? { name: "ask_clarification", arguments: { question: "What SYNTHETIC observation should be recorded?" } } : {
          name: body.tools[0].function.name,
          arguments: { value: text === "wrong-type-test" ? "{\"synthetic\":true}" : { message: "SYNTHETIC hello", synthetic: true } }
        };
        await new Promise(resolve => setTimeout(resolve, 20));
        return Response.json(url.hostname === "api.meta.ai" ? { choices: [{ message: { tool_calls: [{ function: { ...fn, arguments: JSON.stringify(fn.arguments) } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 100, completion_tokens: 50 } } : { message: { tool_calls: [{ function: fn }] }, prompt_eval_count: 100, eval_count: 50 });
      }
    }
  })],
  test: { include: ["test/*.test.js"], testTimeout: 20000 }
});
