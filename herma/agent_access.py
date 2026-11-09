"""Bounded, stateless browser-agent transport; bearer authorization stays in each route."""

from __future__ import annotations

import re
import uuid

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

MAX_REQUEST_BYTES = 262144
CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key, If-Match, X-Request-Id, X-Agent-Label, X-Herma-Key, X-Herma-Api-Key, X-Herma-Harness, X-Herma-Project, X-Herma-Cohort, X-Herma-Session-Id, X-Herma-Worker-Token, X-Herma-Model, X-Human-Link-Token, X-Upstream-Api-Key, X-Upstream-Base-Url, X-Herma-Upstream-Url, X-Surface-Id",
    "Access-Control-Expose-Headers": "ETag, Retry-After, X-Request-Id",
    "Access-Control-Max-Age": "600",
}


class AgentAccessMiddleware:
    """Apply a finite input budget and CORS without cookie authentication."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        raw_id = headers.get("x-request-id", "")
        request_id = (
            raw_id if re.fullmatch(r"[A-Za-z0-9_.:-]{1,100}", raw_id) else str(uuid.uuid4())
        )

        async def send_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                response_headers = MutableHeaders(scope=message)
                for key, value in CORS_HEADERS.items():
                    response_headers[key] = value
                response_headers["X-Request-Id"] = request_id
            await send(message)

        if scope["method"] == "OPTIONS" and scope["path"].startswith(("/mcp", "/api/", "/v1/")):
            await Response(status_code=204)(scope, receive, send_headers)
            return
        if scope["method"] in {"POST", "PUT", "PATCH"}:
            chunks: list[bytes] = []
            size = 0
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                chunk = message.get("body", b"")
                size += len(chunk)
                if size > MAX_REQUEST_BYTES:
                    await JSONResponse(
                        {"code": "request_too_large", "max_bytes": MAX_REQUEST_BYTES},
                        status_code=413,
                    )(scope, receive, send_headers)
                    return
                chunks.append(chunk)
                if not message.get("more_body", False):
                    break
            body = b"".join(chunks)
            consumed = False

            async def replay() -> Message:
                nonlocal consumed
                if consumed:
                    return await receive()
                consumed = True
                return {"type": "http.request", "body": body, "more_body": False}

            await self.app(scope, replay, send_headers)
            return
        await self.app(scope, receive, send_headers)


ACCESS_INFO: dict[str, object] = {
    "surface": "herma",
    "product": "Teleion Fabric",
    "canonical_url": "https://shim.teleionlabs.com",
    "aliases": ["https://herma.teleionlabs.com"],
    "authentication_required": False,
    "credentials_required": False,
    "session_required": False,
    "abuse_rate_limits": "none_through_2026_12_31",
    "free_until": "2026-12-31T23:59:59-05:00",
    "herma_endpoints": {
        "base_url": "https://shim.teleionlabs.com",
        "chat": "https://shim.teleionlabs.com/q/chat",
        "claim": "https://shim.teleionlabs.com/q/claim",
        "submit": "https://shim.teleionlabs.com/q/submit",
        "alternatives": "https://shim.teleionlabs.com/q/alternatives",
        "feedback": "https://shim.teleionlabs.com/q/feedback",
        "bridge_threads": "https://shim.teleionlabs.com/bridge/threads",
        "human_links": "https://shim.teleionlabs.com/q/human-links",
        "llms_txt": "https://shim.teleionlabs.com/llms.txt",
        "dashboard": "https://shim.teleionlabs.com/dashboard",
        "get_started": "https://shim.teleionlabs.com/get-started",
        "agent_page": "https://shim.teleionlabs.com/c/agent/{agent_id}",
        "task_page": "https://shim.teleionlabs.com/c/task/{task_id}",
        "agent_objects": "https://shim.teleionlabs.com/q/objects?producer={agent_id}",
    },
    "public_access": {
        "authentication_required": False,
        "credentials_required": False,
        "session_required": False,
        "abuse_rate_limits": "none_through_2026_12_31",
        "free_until": "2026-12-31T23:59:59-05:00",
        "mcp": "/mcp",
        "persistence": False,
        "mode": "open_zero_auth",
    },
    "tessera_access": {
        "connect_url": "https://fabric.teleionlabs.com/connect",
        "discovery_url": "https://fabric.teleionlabs.com/connect.json",
        "anonymous_session_endpoint": "https://fabric.teleionlabs.com/v1/session/anonymous",
        "human_links_endpoint": "https://fabric.teleionlabs.com/v1/human-links",
        "anonymous_namespace": "demo.<principal>",
        "key_prefix": "tsk_",
        "session_prefix": "tan_",
        "persistence": "Direct access needs no authentication through 2026-12-31. This service never uses a server credential for a public write.",
    },
    "http_limits": {
        "request_bytes": 262144,
        "cors": "Open to every origin. No authentication through 2026-12-31",
    },
    "authenticated_access": {
        "credential": "hmk_",
        "optional_during_free_window": True,
        "scopes": ["route", "configure"],
        "clients": ["coding_harness", "personal-assistant", "custom-harness", "open-agent"],
        "route_requests_per_key_hour": 60,
        "route_quota_enforced": False,
        "route_quota_note": "Not counted and not enforced through 2026-12-31T23:59:59-05:00. Only the request size limit and the operator money caps hold.",
        "provider_credentials": "Our server keys work only with the configured provider. Another provider needs a host on our list and your own key.",
    },
}
