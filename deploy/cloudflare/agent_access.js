const ACCESS_INFO = {"abuse_rate_limits": "none_through_2026_12_31", "aliases": ["https://herma.teleionlabs.com"], "authenticated_access": {"clients": ["coding_harness", "personal-assistant", "custom-harness", "open-agent"], "credential": "hmk_", "optional_during_free_window": true, "provider_credentials": "Server keys are bound to the configured provider origin; alternate providers require an allowlisted host and a caller-owned key.", "route_requests_per_key_hour": 60, "scopes": ["route", "configure"]}, "authentication_required": false, "canonical_origin": "https://shim.teleionlabs.com", "canonical_url": "https://shim.teleionlabs.com", "credentials_required": false, "free_until": "2026-12-31T23:59:59-05:00", "herma_endpoints": {"alternatives": "https://shim.teleionlabs.com/q/alternatives", "base_url": "https://shim.teleionlabs.com", "bridge_threads": "https://shim.teleionlabs.com/bridge/threads", "chat": "https://shim.teleionlabs.com/q/chat", "claim": "https://shim.teleionlabs.com/q/claim", "dashboard": "https://shim.teleionlabs.com/dashboard", "feedback": "https://shim.teleionlabs.com/q/feedback", "get_started": "https://shim.teleionlabs.com/get-started", "human_links": "https://shim.teleionlabs.com/q/human-links", "llms_txt": "https://shim.teleionlabs.com/llms.txt", "submit": "https://shim.teleionlabs.com/q/submit"}, "http_limits": {"cors": "open; wildcard origin; zero auth through 2026-12-31", "request_bytes": 262144}, "product": "Teleion Fabric", "public_access": {"abuse_rate_limits": "none_through_2026_12_31", "authentication_required": false, "credentials_required": false, "free_until": "2026-12-31T23:59:59-05:00", "mcp": "/mcp", "mode": "open_zero_auth", "persistence": false, "session_required": false}, "session_required": false, "surface": "herma", "tessera_access": {"anonymous_namespace": "demo.<principal>", "anonymous_session_endpoint": "https://fabric.teleionlabs.com/v1/session/anonymous", "connect_url": "https://fabric.teleionlabs.com/connect", "discovery_url": "https://fabric.teleionlabs.com/connect.json", "human_links_endpoint": "https://fabric.teleionlabs.com/v1/human-links", "key_prefix": "tsk_", "persistence": "Direct zero-auth access is open through 2026-12-31; this surface never borrows a server credential for public writes.", "session_prefix": "tan_"}};
// Bounded stateless CORS transport. Authorization is evaluated by the application routes.
export const MAX_REQUEST_BYTES = 262144;
export const MAX_QUEUE_CHUNKED_REQUEST_BYTES = 2359296;
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type, Idempotency-Key, If-Match, X-Request-Id, X-Agent-Label, X-Herma-Key, X-Herma-Api-Key, X-Herma-Harness, X-Herma-Project, X-Herma-Cohort, X-Herma-Session-Id, X-Herma-Worker-Token, X-Herma-Model, X-Human-Link-Token, X-Upstream-Api-Key, X-Upstream-Base-Url, X-Herma-Upstream-Url, X-Surface-Id",
  "access-control-expose-headers": "ETag, Retry-After, X-Request-Id",
  "access-control-max-age": "600",
};

export async function agentFetch(request, env, handler, ctx) {
  const rawId = request.headers.get("x-request-id") || "";
  const requestId = /^[A-Za-z0-9_.:-]{1,100}$/.test(rawId) ? rawId : crypto.randomUUID();
  let response;
  const path = new URL(request.url).pathname;
  // A browser agent's preflight is answered on every path, pages and text files too.
  if (request.method === "OPTIONS") {
    response = new Response(null, {status:204});
  } else {
    if (request.body && ["POST", "PUT", "PATCH"].includes(request.method)) {
      const routeMaxBytes =
        path === "/q/submit" ||
        path.startsWith("/q/submit/") ||
        path === "/q/enqueue" ||
        path.startsWith("/q/enqueue/")
          ? MAX_QUEUE_CHUNKED_REQUEST_BYTES
          : MAX_REQUEST_BYTES;
      const reader = request.body.getReader();
      const chunks = [];
      let size = 0;
      while (true) {
        const {value, done} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > routeMaxBytes) {
          await reader.cancel();
          response = Response.json({code:"request_too_large",max_bytes:routeMaxBytes},{status:413});
          break;
        }
        chunks.push(value);
      }
      if (!response) {
        const body = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
        const reqInit = {method:request.method, headers:request.headers, body};
        if (request.cf) reqInit.cf = request.cf;
        request = new Request(request.url, reqInit);
      }
    }
    if (!response && new URL(request.url).pathname === "/connect.json" && request.method === "GET") response = Response.json({ ...ACCESS_INFO, work_conversations: {
      enabled: env.HERMA_CONVERSATION_ENABLED === "true", turn_endpoint: "/v1/conversations/turn", schema_endpoint: "/api/conversation-schema", snapshot_endpoint: "/v1/conversations/{id}", credential: "hmk_", scope: "route", providers: ["meta", "openai", "anthropic", "openrouter"], executed: false,
      context: "Caller-visible context entries containing typed work_contract schemas.", documentation: "https://github.com/ta-amps/herma-infrastructure-shim-for-intelligent-agents/blob/t/H15-work-conversation/docs/conversations.md"
    } });
    if (!response) response = await handler(request, env || {}, ctx);
  }
  const headers = new Headers(response.headers);
  // A route that names its own allowed origins (GET /q/network: the three sites) marks the response; every other route keeps the open default.
  const ownOrigins = headers.get("x-herma-cors") === "restricted";
  headers.delete("x-herma-cors");
  for (const [key,value] of Object.entries(CORS_HEADERS)) {
    if (ownOrigins && key === "access-control-allow-origin") continue;
    headers.set(key,value);
  }
  headers.set("x-request-id",requestId);
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
