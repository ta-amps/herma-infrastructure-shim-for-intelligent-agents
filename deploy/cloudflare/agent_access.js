const ACCESS_INFO = {"authenticated_access": {"clients": ["coding_harness", "personal-assistant", "custom-harness"], "credential": "hmk_", "provider_credentials": "Server keys are bound to the configured provider origin; alternate providers require an allowlisted host and a caller-owned key.", "route_requests_per_key_hour": 60, "scopes": ["route", "configure"]}, "http_limits": {"cors": "bearer-only; wildcard origin; no cookies", "request_bytes": 262144}, "public_access": {"authentication_required": false, "mcp": "/mcp", "mode": "deterministic_preview", "persistence": false}, "surface": "herma", "tessera_access": {"anonymous_namespace": "demo.<principal>", "anonymous_session_endpoint": "https://tessera.ta-amps.workers.dev/v1/session/anonymous", "connect_url": "https://tessera.ta-amps.workers.dev/connect", "discovery_url": "https://tessera.ta-amps.workers.dev/connect.json", "key_prefix": "tsk_", "persistence": "Use your own Tessera principal to save returned artifacts; this surface never borrows a server credential for public writes.", "session_prefix": "tan_"}};
// Bounded stateless CORS transport. Authorization is evaluated by the application routes.
export const MAX_REQUEST_BYTES = 262144;
export const MAX_QUEUE_CHUNKED_REQUEST_BYTES = 2359296;
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type, If-Match, X-Request-Id, X-Agent-Label, X-Herma-Key, X-Herma-Harness, X-Herma-Project, X-Herma-Cohort, X-Upstream-Api-Key, X-Upstream-Base-Url, X-Herma-Upstream-Url, X-Surface-Id",
  "access-control-expose-headers": "ETag, Retry-After, X-Request-Id",
  "access-control-max-age": "600",
};

export async function agentFetch(request, env, handler) {
  const rawId = request.headers.get("x-request-id") || "";
  const requestId = /^[A-Za-z0-9_.:-]{1,100}$/.test(rawId) ? rawId : crypto.randomUUID();
  let response;
  const path = new URL(request.url).pathname;
  if (
    request.method === "OPTIONS" &&
    (path === "/mcp" || path === "/bridge" || path.startsWith("/bridge/") || path === "/q" || path.startsWith("/q/") || path.startsWith("/api/") || path.startsWith("/v1/"))
  ) {
    response = new Response(null, {status:204});
  } else {
    if (request.body && ["POST", "PUT", "PATCH"].includes(request.method)) {
      const routeMaxBytes =
        path === "/q/submit" || path === "/q/enqueue" ? MAX_QUEUE_CHUNKED_REQUEST_BYTES : MAX_REQUEST_BYTES;
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
        request = new Request(request.url, {method:request.method, headers:request.headers, body});
      }
    }
    if (!response && new URL(request.url).pathname === "/connect.json" && request.method === "GET") response = Response.json({ ...ACCESS_INFO, work_conversations: {
      enabled: env.HERMA_CONVERSATION_ENABLED === "true", turn_endpoint: "/v1/conversations/turn", schema_endpoint: "/api/conversation-schema", snapshot_endpoint: "/v1/conversations/{id}", credential: "hmk_", scope: "route", providers: ["meta", "openai", "anthropic", "openrouter"], executed: false,
      context: "Caller-visible context entries containing typed work_contract schemas.", documentation: "https://github.com/ta-amps/herma-infrastructure-shim-for-intelligent-agents/blob/t/H15-work-conversation/docs/conversations.md"
    } });
    if (!response) response = await handler(request, env || {});
  }
  const headers = new Headers(response.headers);
  for (const [key,value] of Object.entries(CORS_HEADERS)) headers.set(key,value);
  headers.set("x-request-id",requestId);
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
