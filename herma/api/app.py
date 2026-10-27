"""FastAPI application for Herma middleware (:7730). Locked to edge when HERMA_EDGE_SECRET is set."""

from __future__ import annotations

import hmac
import json
import os
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Query, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.middleware.base import RequestResponseEndpoint

from herma import __version__
from herma.api.pages import render_connect_page, render_overview_page
from herma.errors import HermaError
from herma.harness_gate import enforce_not_consumer_assistant, require_scope
from herma.proxy import HermaMiddleware
from herma.schemas import DryRunRequest, Provision
from herma.store import ProvisionStore

EDGE_SECRET_ENV = "HERMA_EDGE_SECRET"  # noqa: S105 - env variable name, not a secret
EDGE_EXEMPT = frozenset({("GET", "/api/health"), ("GET", "/v1/health")})
REPO_ROOT = Path(__file__).resolve().parents[2]


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


def get_store() -> ProvisionStore:
    return ProvisionStore(_db_path())


def seed_examples_if_present(store: ProvisionStore) -> int:
    examples_dir = REPO_ROOT / "examples" / "provisions"
    if not examples_dir.is_dir():
        return 0
    existing = {s.provision.prov_id for s in store.list_provisions()}
    count = 0
    for path in sorted(examples_dir.glob("*.json")):
        prov = Provision.model_validate(json.loads(path.read_text(encoding="utf-8")))
        if prov.prov_id not in existing:
            store.put_provision(prov, source_store="examples", check_cas=False)
            count += 1
    return count


def create_app() -> FastAPI:
    application = FastAPI(title="Herma", version=__version__)

    @application.exception_handler(HermaError)
    async def _handle_herma_error(_req: Request, exc: HermaError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            media_type="application/problem+json",
            content=exc.to_problem(),
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
    def health() -> dict[str, Any]:
        store = get_store()
        provisions = store.list_provisions(enabled_only=True)
        return {
            "ok": True,
            "surface": "herma",
            "version": __version__,
            "active_provisions": len(provisions),
            "standard_mode_only": True,
            "configurable_harnesses_only": True,
        }

    @application.get("/", response_class=HTMLResponse)
    @application.get("/console", response_class=HTMLResponse)
    def overview_page(req: Request) -> HTMLResponse:
        store = get_store()
        if not store.list_provisions():
            seed_examples_if_present(store)
        body = render_overview_page(
            store.list_provisions(),
            store.list_receipts(limit=10),
            _public_url(req),
        )
        return HTMLResponse(body)

    @application.get("/connect", response_class=HTMLResponse)
    def connect_page(req: Request) -> HTMLResponse:
        return HTMLResponse(render_connect_page(_public_url(req)))

    # --- Authenticated 'route' endpoints for configurable harnesses ---

    @application.post("/v1/dry-run")
    async def dry_run(req: Request, body: DryRunRequest) -> dict[str, Any]:
        enforce_not_consumer_assistant(req.headers)
        store = get_store()
        principal = store.authenticate_headers(req.headers)
        require_scope(principal, "route", req.headers)
        mw = HermaMiddleware(store)
        outcome = await mw.intercept(
            principal=principal,
            wire_format=body.wire_format,
            payload=body.payload,
            workspace_paths=body.workspace_paths,
        )
        return {
            "augmented_payload": outcome.augmented_payload,
            "matches": [m.model_dump(mode="json") for m in outcome.matches],
            "receipt": outcome.receipt.model_dump(mode="json"),
        }

    async def _proxy_wire(req: Request, wire_format: Any) -> Response:
        enforce_not_consumer_assistant(req.headers)
        store = get_store()
        principal = store.authenticate_headers(req.headers)
        require_scope(principal, "route", req.headers)
        payload = await req.json()
        if not isinstance(payload, dict):
            raise HermaError(400, "invalid_json", "Invalid Request Body", "Expected JSON object.")
        mw = HermaMiddleware(store)
        outcome = await mw.intercept(principal=principal, wire_format=wire_format, payload=payload)
        status, resp_headers, content = await mw.forward_upstream(
            wire_format=wire_format,
            outcome=outcome,
            incoming_headers=req.headers,
        )
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
    def list_receipts(req: Request, limit: int = Query(default=25, ge=1, le=200)) -> dict[str, Any]:
        enforce_not_consumer_assistant(req.headers)
        store = get_store()
        principal = store.authenticate_headers(req.headers)
        require_scope(principal, "route", req.headers)
        return {"receipts": [r.model_dump(mode="json") for r in store.list_receipts(limit=limit)]}

    # --- Authenticated 'configure' endpoints (strictly configurable coding harnesses) ---

    @application.get("/v1/provisions")
    def list_provisions_api(req: Request) -> dict[str, Any]:
        store = get_store()
        principal = store.authenticate_headers(req.headers)
        require_scope(principal, "configure", req.headers)
        return {"provisions": [s.model_dump(mode="json") for s in store.list_provisions()]}

    @application.put("/v1/provisions/{prov_id}")
    def put_provision_api(
        prov_id: str,
        provision: Provision,
        req: Request,
        expected_version: int | None = Query(default=None),
        check_cas: bool = Query(default=False),
    ) -> dict[str, Any]:
        store = get_store()
        principal = store.authenticate_headers(req.headers)
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
            expected_version=expected_version,
            source_store=f"harness:{principal.harness_kind}",
            check_cas=check_cas,
        )
        return stored.model_dump(mode="json")

    @application.delete("/v1/provisions/{prov_id}")
    def delete_provision_api(prov_id: str, req: Request) -> dict[str, Any]:
        store = get_store()
        principal = store.authenticate_headers(req.headers)
        require_scope(principal, "configure", req.headers)
        store.delete_provision(prov_id)
        return {"deleted": prov_id}

    @application.post("/v1/sync/tessera")
    async def sync_tessera_api(body: TesseraSyncRequest, req: Request) -> dict[str, Any]:
        store = get_store()
        principal = store.authenticate_headers(req.headers)
        require_scope(principal, "configure", req.headers)
        synced = await store.sync_from_tessera_http(
            body.base_url,
            body.bearer_token,
            namespace=body.namespace,
        )
        return {"synced": [s.provision.prov_id for s in synced], "count": len(synced)}

    @application.post("/v1/sync/remote")
    async def sync_remote_api(body: RemoteSyncRequest, req: Request) -> dict[str, Any]:
        store = get_store()
        principal = store.authenticate_headers(req.headers)
        require_scope(principal, "configure", req.headers)
        synced = await store.sync_from_remote_handshake(
            body.base_url,
            token=body.token,
            surface_header=body.surface_header,
            surface_id=body.surface_id,
            handshake_path=body.handshake_path,
            provisions_path=body.provisions_path,
        )
        return {"synced": [s.provision.prov_id for s in synced], "count": len(synced)}

    return application


app = create_app()
