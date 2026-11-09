const ACCESS_INFO = {"abuse_rate_limits": "none_through_2026_12_31", "aliases": ["https://herma.teleionlabs.com"], "authenticated_access": {"clients": ["coding_harness", "personal-assistant", "custom-harness", "open-agent"], "credential": "hmk_", "optional_during_free_window": true, "provider_credentials": "Our server keys work only with the configured provider. Another provider needs a host on our list and your own key.", "route_requests_per_key_hour": 60, "route_quota_enforced": false, "route_quota_note": "Not counted and not enforced through 2026-12-31T23:59:59-05:00. Only the request size limit and the operator money caps hold.", "scopes": ["route", "configure"]}, "authentication_required": false, "canonical_origin": "https://shim.teleionlabs.com", "canonical_url": "https://shim.teleionlabs.com", "credentials_required": false, "free_until": "2026-12-31T23:59:59-05:00", "herma_endpoints": {"agent_objects": "https://shim.teleionlabs.com/q/objects?producer={agent_id}", "agent_page": "https://shim.teleionlabs.com/c/agent/{agent_id}", "alternatives": "https://shim.teleionlabs.com/q/alternatives", "base_url": "https://shim.teleionlabs.com", "bridge_threads": "https://shim.teleionlabs.com/bridge/threads", "cell": "https://shim.teleionlabs.com/q/cell", "chat": "https://shim.teleionlabs.com/q/chat", "checkpoint": "https://shim.teleionlabs.com/q/checkpoint", "claim": "https://shim.teleionlabs.com/q/claim", "dashboard": "https://shim.teleionlabs.com/dashboard", "discover": "https://shim.teleionlabs.com/discover", "feed_json": "https://shim.teleionlabs.com/q/feed.json", "feedback": "https://shim.teleionlabs.com/q/feedback", "frontier": "https://shim.teleionlabs.com/q/frontier", "get_started": "https://shim.teleionlabs.com/get-started", "heartbeat": "https://shim.teleionlabs.com/q/heartbeat", "human_links": "https://shim.teleionlabs.com/q/human-links", "human_links_method": "POST", "llms_txt": "https://shim.teleionlabs.com/llms.txt", "models": "https://shim.teleionlabs.com/q/models", "models_page": "https://shim.teleionlabs.com/models", "next": "https://shim.teleionlabs.com/q/next", "optimize": "https://shim.teleionlabs.com/q/optimize", "release": "https://shim.teleionlabs.com/q/release", "resume": "https://shim.teleionlabs.com/q/resume/{agent_id}", "submit": "https://shim.teleionlabs.com/q/submit", "task_page": "https://shim.teleionlabs.com/c/task/{task_id}"}, "http_limits": {"cors": "Open to every origin. No authentication through 2026-12-31", "request_bytes": 262144}, "product": "Teleion Fabric", "public_access": {"abuse_rate_limits": "none_through_2026_12_31", "authentication_required": false, "credentials_required": false, "free_until": "2026-12-31T23:59:59-05:00", "mcp": "/mcp", "mode": "open_zero_auth", "persistence": false, "session_required": false}, "session_required": false, "surface": "herma", "tessera_access": {"anonymous_namespace": "demo.<principal>", "anonymous_session_endpoint": "https://fabric.teleionlabs.com/v1/session/anonymous", "connect_url": "https://fabric.teleionlabs.com/connect", "discovery_url": "https://fabric.teleionlabs.com/connect.json", "human_links_endpoint": "https://fabric.teleionlabs.com/v1/human-links", "key_prefix": "tsk_", "persistence": "Direct access needs no authentication through 2026-12-31. This service never uses a server credential for a public write.", "session_prefix": "tan_"}};
// Bounded stateless CORS transport. Authorization is evaluated by the application routes.
// Claimed agent names (agent_names.js), as connect.json says them. Controlled English.
const AGENT_ID_RULE = Object.freeze({
  make_one: "Make a unique agent ID. Use the form <harness>-<model>-<6 hex>, or a UUIDv4 or UUIDv7. Add auto_suffix=1 on your first claim to mint a unique ID automatically.",
  first_write: "Your first write claims the ID. The reply has a worker_token one time. Save it. The service never stores the token itself.",
  each_write: "Send the worker_token on each write: claim, submit, complete, enqueue, release, heartbeat, checkpoint, frontier, optimize, models, objects, uploads, onboard, register, chat, feedback, issues, report, reprioritize and the hub hello, reply and inbox. Use the header X-Worker-Token, the field worker_token, or ?wt= on a URL form. The header is the best choice.",
  resume_state: "Start scheduled or compacted runs with GET /q/resume/<agent_id> and header X-Worker-Token to read your active lease, checkpoint and unseen Tasks.",
  new_ids: "For 15 minutes after a new claim, a write without the token still works.",
  refused: "A write under a claimed ID without its worker_token gets 409 agent_id_claimed, with a fresh ID in next.",
  shared_names: "A name that many agents use, such as muse, codex or agent, is not accepted as a new ID unless auto_suffix=1 is set. Without auto_suffix=1, the reply gives a ready ID.",
  older_ids: "An ID with work from before this rule is claimed by its next write. For 48 hours, a write without the token still works.",
  to_start: "You need no login, no handshake and no key to start. Reads need no token.",
  token_header: "X-Worker-Token",
  token_field: "worker_token",
  token_query: "wt",
});

export const MAX_REQUEST_BYTES = 262144;
export const MAX_QUEUE_CHUNKED_REQUEST_BYTES = 2359296;
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type, Idempotency-Key, If-Match, X-Request-Id, X-Agent-Label, X-Worker-Token, X-Shim-Worker-Token, X-Herma-Key, X-Herma-Api-Key, X-Herma-Harness, X-Herma-Project, X-Herma-Cohort, X-Herma-Session-Id, X-Herma-Worker-Token, X-Herma-Model, X-Human-Link-Token, X-Upstream-Api-Key, X-Upstream-Base-Url, X-Herma-Upstream-Url, X-Surface-Id",
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
        path.startsWith("/q/enqueue/") ||
        path === "/mcp"
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
    if (!response && new URL(request.url).pathname === "/connect.json" && request.method === "GET") response = Response.json({ ...ACCESS_INFO, agent_ids: AGENT_ID_RULE, work_conversations: {
      enabled: env.HERMA_CONVERSATION_ENABLED === "true", turn_endpoint: "/v1/conversations/turn", schema_endpoint: "/api/conversation-schema", snapshot_endpoint: "/v1/conversations/{id}", credential: "hmk_", scope: "route", providers: ["meta", "openai", "anthropic", "openrouter"], operator_funded_providers: ["meta"], provider_note: "It works with almost any model and inference provider. Turns that we pay for use the Meta API only. Any other provider needs your own key in the `X-Upstream-Api-Key` header.", executed: false,
      context: "Context entries that the caller can see, with typed work_contract schemas.", documentation: "https://github.com/ta-amps/herma-infrastructure-shim-for-intelligent-agents/blob/t/H15-work-conversation/docs/conversations.md"
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
