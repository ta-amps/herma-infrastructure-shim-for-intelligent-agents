"""Regression proofs for scoped personal-assistant access and fail-closed fabric imports."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from test_herma import _run_worker_node_script

from herma.api.app import create_app
from herma.errors import HermaError
from herma.proxy import _resolve_upstream_headers, _resolve_upstream_url
from herma.store import ProvisionStore, passes_governance_lens


def test_operator_provider_credential_is_bound_to_origin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(
        "HERMA_UPSTREAM_CHAT_URL", "https://provider.example.com/v1/chat/completions"
    )
    monkeypatch.setenv("HERMA_UPSTREAM_API_KEY", "example-provider-key")
    monkeypatch.setenv("HERMA_ALLOWED_UPSTREAM_HOSTS", "provider.example.com,alternate.example.com")
    assert (
        _resolve_upstream_headers("chat_completions", {})["Authorization"]
        == "Bearer example-provider-key"
    )
    with pytest.raises(HermaError, match="bound"):
        _resolve_upstream_headers(
            "chat_completions", {"x-upstream-base-url": "https://alternate.example.com"}
        )
    assert (
        _resolve_upstream_headers(
            "chat_completions",
            {
                "x-upstream-base-url": "https://alternate.example.com",
                "x-upstream-api-key": "caller-owned",
            },
        )["Authorization"]
        == "Bearer caller-owned"
    )


def test_meta_override_uses_caller_key_without_borrowing_operator_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("HERMA_ALLOWED_UPSTREAM_HOSTS", raising=False)
    monkeypatch.setenv(
        "HERMA_UPSTREAM_CHAT_URL", "https://provider.example.com/v1/chat/completions"
    )
    monkeypatch.setenv("HERMA_UPSTREAM_API_KEY", "example-operator-key")
    headers = {"x-upstream-base-url": "https://api.meta.ai/v1"}
    assert (
        _resolve_upstream_url("chat_completions", headers)
        == "https://api.meta.ai/v1/chat/completions"
    )
    with pytest.raises(HermaError, match="bound"):
        _resolve_upstream_headers("chat_completions", headers)
    assert (
        _resolve_upstream_headers(
            "chat_completions", {**headers, "x-upstream-api-key": "example-caller-key"}
        )["Authorization"]
        == "Bearer example-caller-key"
    )

    result = _run_worker_node_script("""
const {resolveUpstream} = await import('./deploy/cloudflare/herma_engine.js');
const env={UPSTREAM_LLM_URL:'https://provider.example.com/v1',UPSTREAM_LLM_API_KEY:'example-operator-key'};
const headers={'x-upstream-base-url':'https://api.meta.ai/v1'};
let code=null;
try { resolveUpstream(new Request('https://herma.example',{headers}),env,'/v1/chat/completions'); } catch(error) {code=error.code;}
const owned=resolveUpstream(new Request('https://herma.example',{headers:{...headers,'x-upstream-api-key':'example-caller-key'}}),env,'/v1/chat/completions');
console.log(JSON.stringify({code,url:owned.url,callerKeyUsed:owned.key==='example-caller-key'}));
""")
    assert result == {
        "code": "upstream_credential_origin_mismatch",
        "url": "https://api.meta.ai/v1/chat/completions",
        "callerKeyUsed": True,
    }


def test_canonical_fabric_visibility_cohorts_and_payload_cannot_override() -> None:
    public = {
        "namespace": "main",
        "producer_surface": "surface:eranos",
        "visibility_scope": "public_commons",
        "allowed_surfaces": [],
        "target_cohorts": ["all"],
        "tags": ["status:verified"],
    }
    assert passes_governance_lens(public, harness_kind="personal-assistant")
    assert not passes_governance_lens({})
    assert not passes_governance_lens({"visibility": "private", "surface_owner": "eranos"})
    assert not passes_governance_lens(
        {**public, "visibility_scope": "private", "producer_surface": "surface:herma"}
    )
    assert not passes_governance_lens({**public, "tags": ["status:verified", "status:quarantined"]})
    restricted = {**public, "target_cohorts": ["cohort:ngo_legal_aid"]}
    assert not passes_governance_lens(restricted, harness_kind="codex")
    assert passes_governance_lens(restricted, cohort="cohort:ngo_legal_aid")
    assert not passes_governance_lens(
        public, extra_envelope={**public, "visibility_scope": "private"}
    )


def test_atomic_per_caller_route_quota_and_open_cors(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = ProvisionStore(tmp_path / "quota.db")

    def reserve(_: int) -> int:
        try:
            store.reserve_route_request("key:alpha", limit=5)
            return 200
        except HermaError as error:
            return error.status_code

    with ThreadPoolExecutor(max_workers=20) as pool:
        statuses = list(pool.map(reserve, range(20)))
    assert statuses.count(200) == 5
    assert statuses.count(429) == 15
    store.reserve_route_request("key:beta", limit=5)
    monkeypatch.setenv("HERMA_DB", str(tmp_path / "http.db"))
    monkeypatch.delenv("HERMA_EDGE_SECRET", raising=False)
    client = TestClient(create_app())
    response = client.options(
        "/mcp",
        headers={
            "Origin": "https://agent.example.com",
            "Access-Control-Request-Headers": "Authorization,Content-Type",
        },
    )
    assert response.status_code == 204
    assert response.headers["access-control-allow-origin"] == "*"
    assert "Authorization" in response.headers["access-control-allow-headers"]
    assert client.post("/api/preview", content=b"x" * 262145).status_code == 413


def test_worker_provider_binding_quota_and_personal_assistant() -> None:
    result = _run_worker_node_script("""
const db = new SqliteD1();
const env = {HERMA_DB:db,BOOTSTRAP_SECRET:"example-bootstrap",UPSTREAM_LLM_URL:"https://provider.example.com/v1/chat/completions",UPSTREAM_LLM_API_KEY:"example-operator",HERMA_ALLOWED_UPSTREAM_HOSTS:"provider.example.com,alternate.example.com"};
const mint = await worker.fetch(new Request("https://herma.example.com/v1/admin/keys",{method:"POST",headers:{"content-type":"application/json","x-bootstrap-secret":"example-bootstrap"},body:JSON.stringify({label:"personal",harness_kind:"personal-assistant",scopes:["route"]})}),env);
const key=(await mint.json()).key;
let outbound=[];
globalThis.fetch=async(url, init)=>{outbound.push({url:String(url),key:init.headers.authorization,redirect:init.redirect});return Response.json({ok:true});};
const call=async(overrides={})=>worker.fetch(new Request("https://herma.example.com/v1/chat/completions",{method:"POST",headers:{"content-type":"application/json","x-herma-key":key,"x-herma-harness":"personal-assistant","user-agent":"Muse-Personal-Assistant/1.0",...overrides},body:JSON.stringify({model:"muse-spark-1.3",messages:[{role:"user",content:"ordinary example request"}]})}),env);
const denied=await call({"x-upstream-base-url":"https://alternate.example.com"});
const allowed=await call();
const own=await call({"x-upstream-base-url":"https://alternate.example.com","x-upstream-api-key":"example-caller"});
db.sqlite.prepare("UPDATE route_quotas SET used=60").run();
const capped=await call();
const cors=await worker.fetch(new Request("https://herma.example.com/mcp",{method:"OPTIONS",headers:{origin:"https://agent.example.com"}}),env);
console.log(JSON.stringify({denied:denied.status,allowed:allowed.status,own:own.status,capped:capped.status,retry:capped.headers.get("retry-after"),outbound,cors:cors.status,origin:cors.headers.get("access-control-allow-origin")}));
""")
    assert result["denied"] == 403
    assert result["allowed"] == result["own"] == 200
    assert result["capped"] == 429 and result["retry"] == "3600"
    assert result["cors"] == 204 and result["origin"] == "*"
    assert len(result["outbound"]) == 2
    assert result["outbound"][0]["key"] == "Bearer example-operator"
    assert result["outbound"][1]["key"] == "Bearer example-caller"
    assert all(item["redirect"] == "manual" for item in result["outbound"])
