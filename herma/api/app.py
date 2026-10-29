"""FastAPI application for Herma middleware (:7730). Locked to edge when HERMA_EDGE_SECRET is set."""

from __future__ import annotations

import hmac
import json
import os
from collections.abc import AsyncIterator, Mapping
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, Query, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.middleware.base import RequestResponseEndpoint

from herma import __version__
from herma.agent_access import ACCESS_INFO, AgentAccessMiddleware
from herma.api.pages import (
    FAVICON_SVG,
    MCP_TOOLS_SPEC,
    PREVIEW_JS,
    ROBOTS_TXT,
    build_agent_card,
    render_connect_page,
    render_overview_page,
)
from herma.conversation import ConversationEngine
from herma.conversation_contracts import ConversationTurn
from herma.errors import AdminRequiredError, HermaError
from herma.harness_gate import (
    HarnessPrincipal,
    enforce_not_consumer_assistant,
    parse_cohort_header,
    parse_project_tag,
    require_scope,
    verify_token_constant_time,
)
from herma.memory import extract_entities
from herma.proxy import HermaMiddleware
from herma.schemas import (
    SYSTEM_BUILTIN_SCOPE,
    ContextEntry,
    ContextEntryKind,
    DryRunRequest,
    DryRunResponse,
    EntityKind,
    HandshakeRequest,
    HarnessKind,
    HarnessScope,
    OutcomeReportRequest,
    Provision,
)
from herma.store import ProvisionStore

EDGE_SECRET_ENV = "HERMA_EDGE_SECRET"  # noqa: S105 - env variable name, not a secret
EDGE_EXEMPT = frozenset(
    {
        ("GET", "/api/health"),
        ("GET", "/v1/health"),
        ("GET", "/healthz"),
        ("HEAD", "/healthz"),
    }
)
REPO_ROOT = Path(__file__).resolve().parents[2]
PREVIEW_PRINCIPAL = HarnessPrincipal(
    key_id="public_preview",
    label="readonly-preview",
    harness_kind="custom-harness",
    scopes=frozenset({"route"}),
    is_admin=False,
)


class TesseraSyncRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base_url: str = Field(min_length=8, max_length=256)
    bearer_token: str = Field(min_length=4, max_length=512)
    namespace: str = "herma.provisions"


class RemoteSyncRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base_url: str = Field(min_length=8, max_length=256)
    token: str = ""
    surface_header: str = "X-Surface-Id"
    surface_id: str = "herma"
    handshake_path: str = "/v1/handshake"
    provisions_path: str = "/v1/provisions"


class ContextBatchUpsert(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entries: list[ContextEntry] = Field(min_length=1, max_length=200)


def _default_key_scopes() -> list[HarnessScope]:
    return ["route"]


class AdminKeyIssueRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str = Field(min_length=1, max_length=120)
    harness_kind: HarnessKind = "opencode"
    scopes: list[HarnessScope] = Field(default_factory=_default_key_scopes)


class PreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(default="", max_length=16_000)
    wire_format: Literal["chat_completions", "responses", "messages"] = "chat_completions"
    model: str = Field(default="muse-spark-open", max_length=120)
    workspace_paths: list[str] = Field(default_factory=list, max_length=32)
    payload: dict[str, Any] | None = None


def _db_path() -> Path:
    raw = os.environ.get("HERMA_DB", "").strip()
    return Path(raw) if raw else (REPO_ROOT / ".herma" / "herma.db")


def _public_url(req: Request) -> str:
    configured = os.environ.get("HERMA_PUBLIC_URL", "").strip()
    if configured:
        return configured
    proto = req.headers.get("x-forwarded-proto") or req.url.scheme
    host = req.headers.get("x-forwarded-host") or req.headers.get("host") or "127.0.0.1:7730"
    return f"{proto}://{host}"


def _is_admin_request(headers: Mapping[str, str]) -> bool:
    lower = {k.lower(): v for k, v in headers.items()}
    supplied = (
        lower.get("x-herma-admin-token", "").strip() or lower.get("x-bootstrap-secret", "").strip()
    )
    if not supplied:
        auth = lower.get("authorization", "").strip()
        if auth.lower().startswith("bearer "):
            cand = auth[7:].strip()
            if cand and not cand.startswith("hmk_"):
                supplied = cand
    if not supplied:
        return False
    for env_name in (
        "HERMA_ADMIN_TOKEN",
        "BOOTSTRAP_SECRET",
        "HERMA_BOOTSTRAP_SECRET",
        EDGE_SECRET_ENV,
    ):
        expected = os.environ.get(env_name, "").strip()
        if expected and verify_token_constant_time(expected, supplied):
            return True
    return False


def get_store() -> ProvisionStore:
    return ProvisionStore(_db_path())


def seed_examples_if_present(store: ProvisionStore) -> int:
    examples_dir = REPO_ROOT / "examples" / "provisions"
    if not examples_dir.is_dir():
        return 0
    existing = {
        s.provision.prov_id
        for s in store.list_provisions(caller_scope=SYSTEM_BUILTIN_SCOPE, include_builtin=True)
    }
    count = 0
    for path in sorted(examples_dir.glob("*.json")):
        prov = Provision.model_validate(json.loads(path.read_text(encoding="utf-8")))
        if prov.prov_id not in existing:
            store.put_provision(
                prov,
                caller_scope=SYSTEM_BUILTIN_SCOPE,
                source_store=SYSTEM_BUILTIN_SCOPE,
                check_cas=False,
                is_admin=True,
            )
            count += 1

    context_dir = examples_dir / "context"
    if context_dir.is_dir():
        existing_entries = {
            e.entry_id
            for e in store.list_context_entries(
                caller_scope=SYSTEM_BUILTIN_SCOPE,
                include_builtin=True,
            )
        }
        for ctx_path in sorted(context_dir.glob("*.json")):
            raw = json.loads(ctx_path.read_text(encoding="utf-8"))
            raw_items = raw["entries"] if isinstance(raw, dict) and "entries" in raw else raw
            if isinstance(raw_items, list):
                for item in raw_items:
                    entry = ContextEntry.model_validate(item)
                    if entry.entry_id not in existing_entries:
                        store.upsert_context_entry(
                            entry,
                            caller_scope=SYSTEM_BUILTIN_SCOPE,
                            is_admin=True,
                        )
                        existing_entries.add(entry.entry_id)
    return count


async def _run_readonly_preview(
    store: ProvisionStore,
    *,
    prompt: str,
    wire_format: Literal["chat_completions", "responses", "messages"] = "chat_completions",
    model: str = "muse-spark-open",
    workspace_paths: list[str] | None = None,
    raw_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not store.list_provisions(caller_scope=SYSTEM_BUILTIN_SCOPE, include_builtin=True):
        seed_examples_if_present(store)
    if raw_payload is not None:
        payload = dict(raw_payload)
    elif wire_format == "responses":
        payload = {"model": model, "input": prompt}
    elif wire_format == "messages":
        payload = {
            "model": model,
            "max_tokens": 256,
            "messages": [{"role": "user", "content": prompt}],
        }
    else:
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
        }

    mw = HermaMiddleware(store)
    outcome = await mw.intercept(
        principal=PREVIEW_PRINCIPAL,
        wire_format=wire_format,
        payload=payload,
        workspace_paths=workspace_paths,
        persist=False,
        offline_only=True,
        builtin_only=True,
    )
    return {
        "ok": True,
        "persisted": False,
        "scope_evaluated": SYSTEM_BUILTIN_SCOPE,
        "wire_format": wire_format,
        "matches": [m.model_dump(mode="json") for m in outcome.matches],
        "entities": [e.model_dump(mode="json") for e in outcome.entities],
        "responded_directly": outcome.receipt.responded_directly,
        "direct_response_text": outcome.receipt.direct_response_text,
        "shimmed_context_refs": outcome.receipt.shimmed_context_refs,
        "augmented_payload": outcome.augmented_payload,
    }


def _jsonrpc_error(req_id: Any, code: int, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=200,
        content={"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}},
    )


def create_app() -> FastAPI:
    application = FastAPI(title="Herma", version=__version__)

    @application.exception_handler(HermaError)
    async def _handle_herma_error(_req: Request, exc: HermaError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            media_type="application/problem+json",
            content=exc.to_problem(),
            headers={"Retry-After": "3600"} if exc.status_code == 429 else None,
        )

    @application.middleware("http")
    async def edge_lockdown(request: Request, call_next: RequestResponseEndpoint) -> Response:
        secret = os.environ.get(EDGE_SECRET_ENV, "")
        if secret and (request.method, request.url.path) not in EDGE_EXEMPT:
            supplied = request.headers.get("x-edge-auth", "")
            if not hmac.compare_digest(supplied.encode("utf-8"), secret.encode("utf-8")):
                return JSONResponse(
                    status_code=403,
                    media_type="application/problem+json",
                    content={
                        "type": "about:blank",
                        "title": "Forbidden",
                        "status": 403,
                        "detail": "Requests reach the Herma service only through its edge.",
                        "code": "forbidden",
                    },
                )
        return await call_next(request)

    @application.get("/api/health")
    @application.get("/v1/health")
    @application.get("/healthz")
    def health() -> dict[str, Any]:
        store = get_store()
        provisions = store.list_provisions(
            caller_scope=SYSTEM_BUILTIN_SCOPE,
            include_builtin=True,
            enabled_only=True,
        )
        context_entries = store.list_context_entries(
            caller_scope=SYSTEM_BUILTIN_SCOPE,
            include_builtin=True,
        )
        return {
            "ok": True,
            "surface": "herma",
            "version": __version__,
            "active_provisions": len(provisions),
            "context_entries": len(context_entries),
            "standard_mode_only": True,
            "configurable_harnesses_only": True,
        }

    @application.get("/favicon.svg")
    def favicon_svg() -> Response:
        return Response(content=FAVICON_SVG, media_type="image/svg+xml")

    @application.get("/preview.js")
    def preview_js() -> Response:
        return Response(content=PREVIEW_JS, media_type="application/javascript")

    @application.get("/robots.txt", response_class=PlainTextResponse)
    def robots_txt() -> PlainTextResponse:
        return PlainTextResponse(ROBOTS_TXT)

    @application.get("/llms.txt", response_class=PlainTextResponse)
    def llms_txt(req: Request) -> PlainTextResponse:
        llms_file = REPO_ROOT / "llms.txt"
        if llms_file.is_file():
            return PlainTextResponse(llms_file.read_text(encoding="utf-8"))
        return PlainTextResponse(
            f"# Herma\n\n> Context-shimming AI middleware for configurable coding harnesses.\n\n- Agent Card: {_public_url(req)}/.well-known/agent-card.json\n"
        )

    @application.get("/llms-full.txt", response_class=PlainTextResponse)
    def llms_full_txt(req: Request) -> PlainTextResponse:
        llms_full_file = REPO_ROOT / "llms-full.txt"
        if llms_full_file.is_file():
            return PlainTextResponse(llms_full_file.read_text(encoding="utf-8"))
        return PlainTextResponse(f"# Herma: full text\n\nEndpoint: {_public_url(req)}\n")

    @application.get("/.well-known/agent-card.json")
    def agent_card_json(req: Request) -> dict[str, Any]:
        return build_agent_card(_public_url(req))

    @application.get("/", response_class=HTMLResponse)
    @application.get("/console", response_class=HTMLResponse)
    def overview_page(req: Request) -> HTMLResponse:
        store = get_store()
        if not store.list_provisions(caller_scope=SYSTEM_BUILTIN_SCOPE, include_builtin=True):
            seed_examples_if_present(store)
        body = render_overview_page(
            store.list_provisions(caller_scope=SYSTEM_BUILTIN_SCOPE, include_builtin=True),
            None,
            _public_url(req),
            store.list_context_entries(caller_scope=SYSTEM_BUILTIN_SCOPE, include_builtin=True),
            aggregate_counts=store.public_aggregate_counts(),
        )
        return HTMLResponse(body)

    @application.get("/connect", response_class=HTMLResponse)
    def connect_page(req: Request) -> HTMLResponse:
        return HTMLResponse(render_connect_page(_public_url(req)))

    @application.post("/api/preview")
    async def preview_api(body: PreviewRequest) -> dict[str, Any]:
        if body.payload is None and not body.prompt.strip():
            raise HermaError(
                422,
                "empty_prompt",
                "Empty Preview Prompt",
                "Provide a non-empty prompt or wire payload to preview builtin triggers.",
            )
        store = get_store()
        return await _run_readonly_preview(
            store,
            prompt=body.prompt.strip(),
            wire_format=body.wire_format,
            model=body.model,
            workspace_paths=body.workspace_paths,
            raw_payload=body.payload,
        )

    @application.post("/mcp")
    async def mcp_endpoint(req: Request) -> Response:
        try:
            body = await req.json()
        except Exception:
            return _jsonrpc_error(None, -32700, "Parse error")
        if not isinstance(body, dict) or body.get("jsonrpc") != "2.0":
            req_id = body.get("id") if isinstance(body, dict) else None
            return _jsonrpc_error(req_id, -32600, "Invalid JSON-RPC 2.0 request")

        method = body.get("method")
        has_id = "id" in body and body.get("id") is not None
        req_id = body.get("id")
        raw_params = body.get("params")
        params: dict[str, Any] = raw_params if isinstance(raw_params, dict) else {}

        if method == "notifications/initialized":
            if not has_id:
                return Response(status_code=202)
            return JSONResponse(content={"jsonrpc": "2.0", "id": req_id, "result": {}})

        if method == "initialize":
            proto_ver = str(params.get("protocolVersion") or "2024-11-05")
            return JSONResponse(
                content={
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "protocolVersion": proto_ver,
                        "capabilities": {"tools": {"listChanged": False}},
                        "serverInfo": {"name": "herma", "version": __version__},
                    },
                }
            )

        if method == "ping":
            return JSONResponse(content={"jsonrpc": "2.0", "id": req_id, "result": {}})

        if method == "tools/list":
            return JSONResponse(
                content={
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {"tools": MCP_TOOLS_SPEC},
                }
            )

        if method == "tools/call":
            tool_name = str(params.get("name") or "")
            raw_args = params.get("arguments")
            args: dict[str, Any] = raw_args if isinstance(raw_args, dict) else {}
            store = get_store()
            if not store.list_provisions(caller_scope=SYSTEM_BUILTIN_SCOPE, include_builtin=True):
                seed_examples_if_present(store)

            if tool_name == "list_builtin_provisions":
                enabled_only = bool(args.get("enabled_only", False))
                items = [
                    sp.model_dump(mode="json")
                    for sp in store.list_provisions(
                        caller_scope=SYSTEM_BUILTIN_SCOPE,
                        include_builtin=True,
                        enabled_only=enabled_only,
                    )
                ]
                structured = {"provisions": items, "count": len(items)}
                return JSONResponse(
                    content={
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {
                            "content": [{"type": "text", "text": json.dumps(structured)}],
                            "structuredContent": structured,
                            "isError": False,
                        },
                    }
                )

            if tool_name == "preview_shim":
                prompt_val = str(args.get("prompt") or "").strip()
                if not prompt_val:
                    return _jsonrpc_error(
                        req_id, -32602, "preview_shim requires a non-empty prompt"
                    )
                wf_raw = str(args.get("wire_format") or "chat_completions")
                wf: Literal["chat_completions", "responses", "messages"] = (
                    wf_raw  # type: ignore[assignment]
                    if wf_raw in ("chat_completions", "responses", "messages")
                    else "chat_completions"
                )
                wpaths = [str(p) for p in (args.get("workspace_paths") or []) if str(p).strip()]
                preview = await _run_readonly_preview(
                    store,
                    prompt=prompt_val,
                    wire_format=wf,
                    workspace_paths=wpaths,
                )
                return JSONResponse(
                    content={
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {
                            "content": [{"type": "text", "text": json.dumps(preview)}],
                            "structuredContent": preview,
                            "isError": False,
                        },
                    }
                )

            if tool_name == "extract_entities":
                text_val = str(args.get("text") or "")
                wpaths = [str(p) for p in (args.get("workspace_paths") or []) if str(p).strip()]
                ents = [e.model_dump(mode="json") for e in extract_entities(text_val, wpaths)]
                structured = {"entities": ents, "count": len(ents)}
                return JSONResponse(
                    content={
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {
                            "content": [{"type": "text", "text": json.dumps(structured)}],
                            "structuredContent": structured,
                            "isError": False,
                        },
                    }
                )

            return _jsonrpc_error(req_id, -32602, f"Unknown MCP tool: {tool_name}")

        return _jsonrpc_error(req_id, -32601, f"Method not found: {method}")

    # --- Admin-Only Key Management (`/v1/admin/keys`) ---

    @application.get("/v1/admin/keys")
    def admin_list_keys(req: Request) -> dict[str, Any]:
        if not _is_admin_request(req.headers):
            raise AdminRequiredError(
                "Accessing /v1/admin/keys requires a valid HERMA_ADMIN_TOKEN or BOOTSTRAP_SECRET."
            )
        store = get_store()
        return {"keys": [k.model_dump(mode="json") for k in store.list_keys()]}

    @application.post("/v1/admin/keys", status_code=201)
    def admin_issue_key(body: AdminKeyIssueRequest, req: Request) -> dict[str, Any]:
        if not _is_admin_request(req.headers):
            raise AdminRequiredError(
                "Issuing harness keys via /v1/admin/keys requires a valid HERMA_ADMIN_TOKEN or BOOTSTRAP_SECRET."
            )
        store = get_store()
        full_key, info = store.issue_key(
            label=body.label,
            harness_kind=body.harness_kind,
            scopes=body.scopes,
        )
        return {
            "key": full_key,
            **info.model_dump(mode="json"),
        }

    # --- Authenticated 'route' endpoints for configurable harnesses ---

    @application.post("/v1/conversations/turn")
    async def conversation_turn(req: Request, body: ConversationTurn) -> JSONResponse:
        enforce_not_consumer_assistant(req.headers)
        store = get_store()
        principal = store.authenticate_headers(req.headers, is_admin=_is_admin_request(req.headers))
        require_scope(principal, "route", req.headers)
        if os.environ.get("HERMA_CONVERSATION_ENABLED", "").lower() != "true":
            raise HermaError(
                503,
                "conversation_disabled",
                "Conversation disabled",
                "The operator has not enabled model-assisted work conversations.",
            )
        result = await ConversationEngine(store).turn(principal.caller_scope, body)
        return JSONResponse(content=result, headers={"X-Request-Id": body.request_id})

    @application.get("/v1/conversations/{conversation_id}")
    def conversation_status(req: Request, conversation_id: str) -> dict[str, Any]:
        enforce_not_consumer_assistant(req.headers)
        store = get_store()
        principal = store.authenticate_headers(req.headers, is_admin=_is_admin_request(req.headers))
        require_scope(principal, "route", req.headers)
        return ConversationEngine(store).state.snapshot(principal.caller_scope, conversation_id)

    @application.post("/v1/handshake")
    def handshake_api(req: Request, body: HandshakeRequest) -> JSONResponse:
        enforce_not_consumer_assistant(req.headers)
        store = get_store()
        principal = store.authenticate_headers(req.headers, is_admin=_is_admin_request(req.headers))
        require_scope(principal, "route", req.headers)
        negotiated = store.negotiate_handshake(
            body,
            principal=principal,
            backend_version=__version__,
            header_surface_id=req.headers.get("x-surface-id", ""),
        )
        return JSONResponse(
            content=negotiated.model_dump(mode="json"),
            headers={
                "x-surface-id": negotiated.surface_id,
                "x-handshake-id": negotiated.handshake_id,
            },
        )

    @application.post("/v1/dry-run")
    async def dry_run(req: Request, body: DryRunRequest) -> JSONResponse:
        enforce_not_consumer_assistant(req.headers)
        store = get_store()
        principal = store.authenticate_headers(req.headers, is_admin=_is_admin_request(req.headers))
        require_scope(principal, "route", req.headers)
        project_tag = parse_project_tag(req.headers)
        cohort = parse_cohort_header(req.headers)
        mw = HermaMiddleware(store)
        outcome = await mw.intercept(
            principal=principal,
            wire_format=body.wire_format,
            payload=body.payload,
            offline_only=True,
            workspace_paths=body.workspace_paths,
            project_tag=project_tag,
            cohort=cohort,
        )
        resp = DryRunResponse(
            augmented_payload=outcome.augmented_payload,
            matches=outcome.matches,
            receipt=outcome.receipt,
            responded_directly=outcome.receipt.responded_directly,
            direct_response_text=outcome.receipt.direct_response_text,
            shimmed_context_refs=outcome.receipt.shimmed_context_refs,
        )
        out_hdrs: dict[str, str] = {
            "x-herma-entities-tracked": str(outcome.receipt.entities_tracked),
        }
        surf = req.headers.get("x-surface-id", "").strip()
        if surf:
            out_hdrs["x-surface-id"] = surf
        return JSONResponse(content=resp.model_dump(mode="json"), headers=out_hdrs)

    async def _proxy_wire(req: Request, wire_format: Any) -> Response:
        enforce_not_consumer_assistant(req.headers)
        store = get_store()
        principal = store.authenticate_headers(req.headers, is_admin=_is_admin_request(req.headers))
        require_scope(principal, "route", req.headers)
        project_tag = parse_project_tag(req.headers)
        cohort = parse_cohort_header(req.headers)
        payload = await req.json()
        if not isinstance(payload, dict):
            raise HermaError(400, "invalid_json", "Invalid Request Body", "Expected JSON object.")
        store.reserve_route_request(principal.caller_scope)
        mw = HermaMiddleware(store)
        outcome = await mw.intercept(
            principal=principal,
            wire_format=wire_format,
            payload=payload,
            project_tag=project_tag,
            cohort=cohort,
        )
        status, resp_headers, content = await mw.forward_upstream(
            wire_format=wire_format,
            outcome=outcome,
            incoming_headers=req.headers,
        )
        surf = req.headers.get("x-surface-id", "").strip()
        if surf:
            resp_headers = {**resp_headers, "x-surface-id": surf}
        if isinstance(content, bytes):
            return Response(content=content, status_code=status, headers=resp_headers)
        stream_iter: AsyncIterator[bytes] = content
        return StreamingResponse(stream_iter, status_code=status, headers=resp_headers)

    @application.post("/v1/chat/completions")
    async def proxy_chat_completions(req: Request) -> Response:
        return await _proxy_wire(req, "chat_completions")

    @application.post("/v1/responses")
    async def proxy_responses(req: Request) -> Response:
        return await _proxy_wire(req, "responses")

    @application.post("/v1/messages")
    async def proxy_messages(req: Request) -> Response:
        return await _proxy_wire(req, "messages")

    @application.get("/v1/receipts")
    def list_receipts(
        req: Request,
        limit: int = Query(default=25, ge=1, le=200),
        project_tag: str | None = Query(default=None),
    ) -> dict[str, Any]:
        enforce_not_consumer_assistant(req.headers)
        store = get_store()
        principal = store.authenticate_headers(req.headers, is_admin=_is_admin_request(req.headers))
        require_scope(principal, "route", req.headers)
        resolved_proj = (
            parse_project_tag(req.headers, project_tag) if project_tag is not None else None
        )
        items = store.list_receipts(
            limit=limit,
            caller_scope=principal.caller_scope,
            project_tag=resolved_proj,
        )
        return {"receipts": [r.model_dump(mode="json") for r in items]}

    @application.get("/v1/memory")
    def get_memory_api(
        req: Request,
        project_tag: str | None = None,
        kind: EntityKind | None = None,
        limit: int = Query(default=50, ge=1, le=200),
    ) -> JSONResponse:
        enforce_not_consumer_assistant(req.headers)
        store = get_store()
        principal = store.authenticate_headers(req.headers, is_admin=_is_admin_request(req.headers))
        require_scope(principal, "route", req.headers)
        hdr_proj = req.headers.get("x-herma-project", "").strip()
        resolved_proj = (
            parse_project_tag(req.headers, project_tag)
            if (project_tag is not None or hdr_proj)
            else None
        )
        entities = store.list_working_entities(
            caller_scope=principal.caller_scope,
            project_tag=resolved_proj,
            kind=kind,
            limit=limit,
        )
        return JSONResponse(
            content={
                "caller_scope": principal.caller_scope,
                "project_tag": resolved_proj or "all",
                "entities": [e.model_dump(mode="json") for e in entities],
                "count": len(entities),
            },
            headers={"x-herma-entities-tracked": str(len(entities))},
        )

    @application.post("/v1/outcomes")
    def post_outcomes_api(body: OutcomeReportRequest, req: Request) -> dict[str, Any]:
        enforce_not_consumer_assistant(req.headers)
        store = get_store()
        principal = store.authenticate_headers(req.headers, is_admin=_is_admin_request(req.headers))
        require_scope(principal, "route", req.headers)
        hdr_proj = parse_project_tag(req.headers)
        saved = store.record_explicit_outcome(
            caller_scope=principal.caller_scope,
            report=body,
            header_project_tag=hdr_proj,
        )
        return {
            "recorded": [r.model_dump(mode="json") for r in saved],
            "count": len(saved),
        }

    @application.get("/v1/insights")
    def get_insights_api(
        req: Request,
        project_tag: str | None = Query(default=None),
    ) -> dict[str, Any]:
        enforce_not_consumer_assistant(req.headers)
        store = get_store()
        principal = store.authenticate_headers(req.headers, is_admin=_is_admin_request(req.headers))
        require_scope(principal, "route", req.headers)
        resolved_proj = (
            parse_project_tag(req.headers, project_tag) if project_tag is not None else None
        )
        insights = store.build_insights(
            caller_scope=principal.caller_scope,
            project_tag=resolved_proj,
        )
        return insights.model_dump(mode="json")

    # --- Authenticated 'configure' endpoints (strictly configurable coding harnesses) ---

    @application.get("/v1/context")
    def list_context_api(
        req: Request,
        kind: ContextEntryKind | None = None,
        prefix: str = "",
        refs: str = "",
    ) -> dict[str, Any]:
        store = get_store()
        principal = store.authenticate_headers(req.headers, is_admin=_is_admin_request(req.headers))
        require_scope(principal, "configure", req.headers)
        if refs.strip():
            ref_list = [r.strip() for r in refs.split(",") if r.strip()]
            items = store.get_context_entries_for_caller(principal.caller_scope, ref_list)
            if kind is not None:
                items = [e for e in items if e.kind == kind]
            if prefix:
                items = [e for e in items if e.entry_id.startswith(prefix)]
        else:
            items = store.list_context_entries_for_caller(
                principal.caller_scope,
                kind=kind,
                prefix=prefix,
            )
        return {"entries": [e.model_dump(mode="json") for e in items], "count": len(items)}

    @application.post("/v1/context")
    def upsert_context_api(
        body: ContextEntry | ContextBatchUpsert,
        req: Request,
        expected_version: int | None = Query(default=None),
        check_cas: bool = Query(default=False),
    ) -> dict[str, Any]:
        store = get_store()
        principal = store.authenticate_headers(req.headers, is_admin=_is_admin_request(req.headers))
        require_scope(principal, "configure", req.headers)
        raw_entries = body.entries if isinstance(body, ContextBatchUpsert) else [body]
        saved = [
            store.upsert_context_entry(
                entry,
                caller_scope=principal.caller_scope,
                expected_version=expected_version,
                check_cas=check_cas,
                is_admin=principal.is_admin,
            ).model_dump(mode="json")
            for entry in raw_entries
        ]
        return {
            "entry": saved[0],
            "entries": saved,
            "count": len(saved),
        }

    @application.get("/v1/provisions")
    def list_provisions_api(
        req: Request,
        include_context: bool = Query(default=False),
    ) -> dict[str, Any]:
        store = get_store()
        principal = store.authenticate_headers(req.headers, is_admin=_is_admin_request(req.headers))
        require_scope(principal, "configure", req.headers)
        out: dict[str, Any] = {
            "provisions": [
                s.model_dump(mode="json")
                for s in store.list_provisions_for_caller(principal.caller_scope)
            ]
        }
        if include_context:
            out["context_entries"] = [
                e.model_dump(mode="json")
                for e in store.list_context_entries_for_caller(principal.caller_scope)
            ]
        return out

    @application.put("/v1/provisions/{prov_id}")
    def put_provision_api(
        prov_id: str,
        provision: Provision,
        req: Request,
        expected_version: int | None = Query(default=None),
        check_cas: bool = Query(default=False),
    ) -> dict[str, Any]:
        store = get_store()
        principal = store.authenticate_headers(req.headers, is_admin=_is_admin_request(req.headers))
        require_scope(principal, "configure", req.headers)
        if provision.prov_id != prov_id:
            raise HermaError(
                400,
                "id_mismatch",
                "Provision ID Mismatch",
                f"Path prov_id {prov_id!r} != body prov_id {provision.prov_id!r}.",
            )
        stored = store.put_provision(
            provision,
            caller_scope=principal.caller_scope,
            expected_version=expected_version,
            source_store=f"harness:{principal.harness_kind}",
            check_cas=check_cas,
            is_admin=principal.is_admin,
        )
        return stored.model_dump(mode="json")

    @application.delete("/v1/provisions/{prov_id}")
    def delete_provision_api(prov_id: str, req: Request) -> dict[str, Any]:
        store = get_store()
        principal = store.authenticate_headers(req.headers, is_admin=_is_admin_request(req.headers))
        require_scope(principal, "configure", req.headers)
        store.delete_provision(
            prov_id,
            caller_scope=principal.caller_scope,
            is_admin=principal.is_admin,
        )
        return {"deleted": prov_id}

    @application.post("/v1/sync/tessera")
    async def sync_tessera_api(body: TesseraSyncRequest, req: Request) -> dict[str, Any]:
        store = get_store()
        principal = store.authenticate_headers(req.headers, is_admin=_is_admin_request(req.headers))
        require_scope(principal, "configure", req.headers)
        synced = await store.sync_from_tessera_http(
            body.base_url,
            body.bearer_token,
            namespace=body.namespace,
            caller_scope=principal.caller_scope,
            harness_kind=principal.harness_kind,
            cohort=parse_cohort_header(req.headers),
            is_admin=principal.is_admin,
        )
        return {"synced": [s.provision.prov_id for s in synced], "count": len(synced)}

    @application.post("/v1/sync/remote")
    async def sync_remote_api(body: RemoteSyncRequest, req: Request) -> dict[str, Any]:
        store = get_store()
        principal = store.authenticate_headers(req.headers, is_admin=_is_admin_request(req.headers))
        require_scope(principal, "configure", req.headers)
        synced = await store.sync_from_remote_handshake(
            body.base_url,
            token=body.token,
            surface_header=body.surface_header,
            surface_id=body.surface_id,
            handshake_path=body.handshake_path,
            provisions_path=body.provisions_path,
            caller_scope=principal.caller_scope,
            is_admin=principal.is_admin,
        )
        return {"synced": [s.provision.prov_id for s in synced], "count": len(synced)}

    @application.get("/api/conversation-schema")
    async def conversation_schemas() -> dict[str, object]:
        from herma.conversation_contracts import ConversationTurn, Proposal, WorkContract
        from herma.provider_plan import ProviderPlan

        return {
            "conversation_turn": ConversationTurn.model_json_schema(),
            "provider_plan": ProviderPlan.model_json_schema(),
            "work_contract": WorkContract.model_json_schema(),
            "proposal": Proposal.model_json_schema(),
        }

    @application.get("/connect.json")
    async def access_modes() -> dict[str, object]:
        return {
            **ACCESS_INFO,
            "work_conversations": {
                "enabled": os.environ.get("HERMA_CONVERSATION_ENABLED") == "true",
                "turn_endpoint": "/v1/conversations/turn",
                "schema_endpoint": "/api/conversation-schema",
                "snapshot_endpoint": "/v1/conversations/{id}",
                "credential": "hmk_",
                "scope": "route",
                "providers": ["meta", "ollama", "openai", "anthropic", "openrouter"],
                "executed": False,
                "context": "Caller-visible context entries containing typed work_contract schemas.",
                "documentation": "https://github.com/ta-amps/herma/blob/t/H15-work-conversation/docs/conversations.md",
            },
        }

    application.add_middleware(AgentAccessMiddleware)
    return application


app = create_app()
