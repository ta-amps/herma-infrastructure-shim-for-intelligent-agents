"""Muse-first routing policy: Herma names Meta's latest Muse models and nothing from the retired family.

The owner's rule (2026-11-01) is to lead with Meta's latest Muse models through the Meta API at standard
tier and never to name the retired model family anywhere. These checks fail on that name in anything Herma
serves or ships as a default, keep the public model list honest against the routing code, and keep agent
programs (harnesses) out of the model table.
"""

from __future__ import annotations

import html
import json
import re
import subprocess
from pathlib import Path
from typing import Any

import pytest
from banned_support import shared_words, shared_words_or_none
from fastapi.testclient import TestClient
from test_herma import REPO_ROOT, _run_worker_node_script

from herma.api.app import create_app, seed_examples_if_present
from herma.conversation_contracts import plain_guidance
from herma.conversation_provider import META_RATES, ProviderConfig
from herma.errors import HermaError
from herma.model_catalog import (
    listed_model_ids,
    load_catalog,
    models_text,
    render_models_section,
    routed_model_ids,
)
from herma.proxy import DEFAULT_UPSTREAMS
from herma.store import ProvisionStore

# The banned words come from the ONE shared list, read from outside this repository (rule 16); none is spelled here.
PROSE_PRIMITIVES = re.compile(r"\b(?:noun|verb)s?\b", re.IGNORECASE)

# Ids that `GET https://api.meta.ai/v1/models` lists today. Only the tuned Glimmer is outside it.
META_API_IDS = frozenset(
    {
        "muse-wonder-1.0",
        "muse-spark-1.3",
        "muse-spark-1.2",
        "muse-image-1.0",
        "muse-voice-transcribe-1.0",
        "sam-3.1",
    }
)
TUNED_GLIMMER_ID = "muse-glimmer-30b"
# Agent apps (harnesses) are not models and are listed only on the shared Models used page. The third-party
# one is spelled in pieces so no Herma file, this one included, names it.
AGENT_APP_NAMES = ("Muse Code", "nano" + "Muse")
AGENT_APP_PATTERN = re.compile("nano" + "muse", re.IGNORECASE)
RECEIPT_WORDING = re.compile(r"receipt|sha-?256|\b[0-9a-f]{12,}\b", re.IGNORECASE)

SKIP_DIRS = {
    ".git",
    "node_modules",
    ".venv",
    "dist",
    "build",
    "__pycache__",
    ".mypy_cache",
    ".ruff_cache",
    ".pytest_cache",
    ".hypothesis",
    "test-results",
}
SKIP_SUFFIXES = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".pdf",
    ".woff",
    ".woff2",
    ".ttf",
}

GET_PATHS = [
    "/",
    "/shim",
    "/get-started",
    "/trust",
    "/connect",
    "/connect.json",
    "/healthz",
    "/llms.txt",
    "/llms-full.txt",
    "/.well-known/agent-card.json",
    "/api/conversation-schema",
    "/preview.js",
    "/robots.txt",
    "/favicon.svg",
]
BASE = "https://herma.teleionlabs.com"
# Routes only the Worker serves (the queue gateway, prompts hub, dashboard and permalinks). They are live, so
# they must keep answering and must be as clean as the rest.
GATEWAY_PATHS = [
    "/prompts",
    "/prompts.js",
    "/get-started",
    "/starter",
    "/dashboard",
    "/dashboard.js",
    "/q",
    "/q/pulse",
    "/q/trust",
    "/q/search?q=muse",
    "/prompts/raw/master_v3",
    "/prompts/raw/cli_swarm_100",
]


def repo_text_files() -> list[Path]:
    """Every file git would track or add, so a new file is checked before its first commit."""
    try:
        out = subprocess.run(
            ["git", "ls-files", "-co", "--exclude-standard"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.splitlines()
        files = [REPO_ROOT / line for line in out if line]
    except (OSError, subprocess.CalledProcessError):
        files = [p for p in REPO_ROOT.rglob("*") if p.is_file()]
    return [
        p
        for p in files
        if p.is_file()
        and not (set(p.relative_to(REPO_ROOT).parts) & SKIP_DIRS)
        and p.suffix.lower() not in SKIP_SUFFIXES
    ]


def visible_prose(page: str) -> str:
    """Text a reader sees, without scripts, styles, code samples or identifiers in code tags."""
    page = re.sub(r"(?is)<(script|style|pre|code)\b.*?</\1>", " ", page)
    return html.unescape(re.sub(r"(?s)<[^>]+>", " ", page))


def preset_prompts(preview_js: str) -> dict[str, str]:
    """The one-click prompts the home page offers, read from the script it serves."""
    found = re.findall(r'(\w+): \{\s*prompt: "((?:[^"\\]|\\.)*)"', preview_js)
    return {name: json.loads('"' + text.replace("\\`", "`") + '"') for name, text in found}


def python_surface(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    db_file = tmp_path / "policy.db"
    monkeypatch.setenv("HERMA_DB", str(db_file))
    monkeypatch.delenv("HERMA_EDGE_SECRET", raising=False)
    seed_examples_if_present(ProvisionStore(db_file))
    client = TestClient(create_app())
    served = {path: client.get(path).text for path in GET_PATHS}
    for name, prompt in preset_prompts(served["/preview.js"]).items():
        served[f"POST /api/preview {name}"] = client.post(
            "/api/preview", json={"prompt": prompt, "wire_format": "chat_completions"}
        ).text
    for call_id, method, params in (
        (1, "initialize", {}),
        (2, "tools/list", {}),
        (3, "tools/call", {"name": "list_builtin_provisions", "arguments": {}}),
    ):
        served[f"POST /mcp {method}"] = client.post(
            "/mcp", json={"jsonrpc": "2.0", "id": call_id, "method": method, "params": params}
        ).text
    return served


WORKER_SURFACE = r"""
const db = new SqliteD1();
const env = { STORAGE_MODE: "cloud", HERMA_DB: db };
const base = "https://herma.teleionlabs.com";
const get = async (path) => (await worker.fetch(new Request(base + path), env)).text();
const post = async (path, body) => (await worker.fetch(new Request(base + path, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), env)).text();
const served = {};
for (const path of __PATHS__) served[path] = await get(path);
for (const path of __GATEWAY__) {
  const r = await worker.fetch(new Request(base + path), env);
  served["GATEWAY STATUS " + path] = String(r.status);
  served["GATEWAY " + path] = await r.text();
}
const presets = {};
for (const m of served["/preview.js"].matchAll(/(\w+): \{\s*prompt: "((?:[^"\\]|\\.)*)"/g)) {
  presets[m[1]] = JSON.parse('"' + m[2].replaceAll("\\`", "`") + '"');
}
for (const [name, prompt] of Object.entries(presets)) {
  served["POST /api/preview " + name] = await post("/api/preview", { prompt, wire_format: "chat_completions" });
}
const calls = [[1, "initialize", {}], [2, "tools/list", {}], [3, "tools/call", { name: "list_builtin_provisions", arguments: {} }]];
for (const [id, method, params] of calls) {
  served["POST /mcp " + method] = await post("/mcp", { jsonrpc: "2.0", id, method, params });
}
console.log(JSON.stringify(served));
""".replace("__PATHS__", json.dumps(GET_PATHS)).replace("__GATEWAY__", json.dumps(GATEWAY_PATHS))


CONVERSATION_MODULE = (REPO_ROOT / "deploy/cloudflare/conversation.js").as_uri()
PROVIDER_PROBE = """
const { providerConfig } = await import(__MODULE__);
const ok = [];
for (const id of __IDS__) {
  try { providerConfig({ HERMA_CONVERSATION_META_MODEL: id, HERMA_CONVERSATION_MAX_OUTPUT: "1000", HERMA_META_BUDGET_USD: "5" }, "meta"); ok.push(id); } catch { /* unpriced */ }
}
console.log(JSON.stringify(ok));
"""


def worker_surface() -> dict[str, str]:
    return {key: str(value) for key, value in _run_worker_node_script(WORKER_SURFACE).items()}


def test_catalog_lists_meta_models_first_and_keeps_agent_programs_out(tmp_path: Path) -> None:
    catalog = load_catalog()
    models = catalog["models"]
    ids = [m["id"] for m in models]
    assert ids[:2] == ["muse-wonder-1.0", "muse-spark-1.3"], "Meta's frontier and fast models lead"
    assert set(ids) == {*META_API_IDS - {"muse-spark-1.2"}, TUNED_GLIMMER_ID}
    for model in models:
        assert "contributor" not in str(model["id"]).lower()
        assert model["api_listed"] is (model["id"] in META_API_IDS)
        assert model["use"] and model["route"]
        assert model["route"].startswith("Yes." if model["routed"] else "No.")
    assert [m["name"] for m in models if m["id"] == TUNED_GLIMMER_ID] == [
        "Muse Glimmer 30B, fine-tuned by ta-amps"
    ]
    for app in AGENT_APP_NAMES:
        assert all(app.lower() not in m["name"].lower() for m in models)
    assert "harness_note" not in catalog, (
        "agent apps are listed only on the shared Models used page"
    )
    assert catalog["models_used_url"] == "https://agora.eranosforgood.org/models/"
    assert catalog["tier"] == "standard"
    assert routed_model_ids() == {"muse-wonder-1.0", "muse-spark-1.3"}
    assert listed_model_ids() >= routed_model_ids()


def test_routed_models_are_exactly_the_priced_models_in_both_runtimes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert set(META_RATES) == routed_model_ids()
    monkeypatch.setenv("HERMA_CONVERSATION_MAX_OUTPUT", "1000")
    monkeypatch.setenv("HERMA_META_BUDGET_USD", "5")
    accepted_python = set()
    for ident in sorted(listed_model_ids()):
        monkeypatch.setenv("HERMA_CONVERSATION_META_MODEL", ident)
        try:
            ProviderConfig.from_env("meta")
            accepted_python.add(ident)
        except HermaError:
            continue
    assert accepted_python == routed_model_ids()

    ids = sorted(listed_model_ids())
    out = subprocess.run(
        [
            "node",
            "--no-warnings",
            "--input-type=module",
            "-e",
            PROVIDER_PROBE.replace("__MODULE__", json.dumps(CONVERSATION_MODULE)).replace(
                "__IDS__", json.dumps(ids)
            ),
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    assert set(json.loads(out.stdout)) == routed_model_ids()


def test_routing_defaults_point_at_the_meta_api_and_agree_across_runtimes() -> None:
    assert DEFAULT_UPSTREAMS["chat_completions"] == "https://api.meta.ai/v1/chat/completions"
    assert DEFAULT_UPSTREAMS["responses"] == "https://api.meta.ai/v1/responses"
    default = load_catalog()["default_model"]
    assert default in routed_model_ids()

    python_hosts = re.search(
        r'"HERMA_ALLOWED_UPSTREAM_HOSTS",\s*"([^"]+)"',
        (REPO_ROOT / "herma/proxy.py").read_text(encoding="utf-8"),
    )
    worker_hosts = re.search(
        r'env\.HERMA_ALLOWED_UPSTREAM_HOSTS \|\| "([^"]+)"',
        (REPO_ROOT / "deploy/cloudflare/herma_engine.js").read_text(encoding="utf-8"),
    )
    assert python_hosts and worker_hosts
    assert python_hosts.group(1) == worker_hosts.group(1)
    assert python_hosts.group(1).split(",")[0] == "api.meta.ai"

    micromodel_python = re.search(
        r'"HERMA_MICROMODEL_MODEL",\s*"([^"]+)"',
        (REPO_ROOT / "herma/triggers/micromodel.py").read_text(encoding="utf-8"),
    )
    micromodel_worker = re.search(
        r'HERMA_MICROMODEL_MODEL \|\| "([^"]+)"',
        (REPO_ROOT / "deploy/cloudflare/herma_engine.js").read_text(encoding="utf-8"),
    )
    assert micromodel_python and micromodel_worker
    assert micromodel_python.group(1) == micromodel_worker.group(1) == default


def test_models_section_and_text_are_identical_in_both_runtimes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    python_pages = python_surface(tmp_path, monkeypatch)
    worker_pages = worker_surface()
    section = render_models_section()
    assert section in python_pages["/shim"]
    assert section in worker_pages["/shim"]
    assert models_text() in worker_pages["/llms-full.txt"]
    for page in (python_pages["/shim"], worker_pages["/shim"]):
        assert '<h2 id="models-h">Which Meta Models Do What</h2>' in page
        assert 'href="https://agora.eranosforgood.org/models/">Models used ↗</a>' in page
    for app in AGENT_APP_NAMES:
        assert app not in section, "the models section names models only"
        assert app not in models_text()
    for model in load_catalog()["models"]:
        assert model["name"] in python_pages["/llms-full.txt"], (
            "the README table feeds llms-full.txt"
        )
    assert (
        (REPO_ROOT / "README.md")
        .read_text(encoding="utf-8")
        .count("https://agora.eranosforgood.org/models/")
    )


def test_served_pages_and_public_json_pass_the_shared_banned_word_list(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    words = shared_words()
    surfaces = {"python": python_surface(tmp_path, monkeypatch), "worker": worker_surface()}
    offenders = [
        f"{runtime} {route}: {hit}"
        for runtime, served in surfaces.items()
        for route, body in served.items()
        for hit in words.always_hits(body)
    ]
    assert offenders == []
    for runtime, served in surfaces.items():
        assert len(served) >= len(GET_PATHS) + 3, runtime


def test_preset_prompts_still_reach_their_starters_in_both_runtimes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    expected = {
        "tasks": "PROV-DIRECT-NOUN-VERB-SCHEMA",
        "direct": "PROV-DIRECT-NOUN-VERB-SCHEMA",
        "lora": "PROV-LORA-MEMORY-ROUTING",
        "feeds": "PROV-HARNESS-FEEDS-GUIDE",
        "fencing": "PROV-TESSERA-FENCING",
        "statute": "PROV-RISK-REVIEW-NON-ACCUSATORY",
    }
    for served in (python_surface(tmp_path, monkeypatch), worker_surface()):
        assert set(preset_prompts(served["/preview.js"])) == set(expected)
        for name, prov_id in expected.items():
            preview = json.loads(served[f"POST /api/preview {name}"])
            assert prov_id in [m["prov_id"] for m in preview["matches"]], name


def test_visible_text_says_tasks_and_task_objects(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    for runtime, served in (
        ("python", python_surface(tmp_path, monkeypatch)),
        ("worker", worker_surface()),
    ):
        for route in ("/", "/connect"):
            prose = visible_prose(served[route])
            assert PROSE_PRIMITIVES.findall(prose) == [], (runtime, route)
        assert "Task Objects" in visible_prose(served["/"])


def test_repository_holds_no_word_that_is_banned_everywhere() -> None:
    words = shared_words()
    offenders: list[str] = []
    scanned = 0
    for path in repo_text_files():
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        scanned += 1
        if words.always_hits(text):
            offenders.append(path.relative_to(REPO_ROOT).as_posix())
    assert scanned > 100
    assert offenders == []
    wrangler = (REPO_ROOT / "deploy/cloudflare/wrangler.jsonc").read_text(encoding="utf-8")
    assert "HERMA_CONVERSATION_DISABLED_PROVIDERS" in wrangler
    schema: Any = json.loads(
        (REPO_ROOT / "deploy/cloudflare/conversation_data.json").read_text(encoding="utf-8")
    )
    providers = schema["schemas"]["conversation_turn"]["properties"]["provider"]
    assert providers["default"] == "meta"
    assert providers["enum"][0] == "meta"


def test_category_guidance_respells_the_banned_word_for_both_runtimes() -> None:
    banned = "syn" + "thetic"
    assert plain_guidance(f"Check {banned.upper()} disclosure and {banned} marks.") == (
        "Check EXAMPLE-CASE disclosure and example-case marks."
    )
    nested = {"rules": [f"a {banned} b", {"deep": f"{banned.title()}"}], "n": 3}
    assert plain_guidance(nested) == {
        "rules": ["a example-case b", {"deep": "example-case"}],
        "n": 3,
    }
    data = json.loads(
        (REPO_ROOT / "deploy/cloudflare/conversation_data.json").read_text(encoding="utf-8")
    )
    words = shared_words_or_none()
    if words is not None:
        assert words.always_hits(json.dumps(data["categories"])) == []


def test_agent_apps_are_named_nowhere_in_the_repository() -> None:
    offenders = []
    for path in repo_text_files():
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        offenders += [
            f"{path.relative_to(REPO_ROOT).as_posix()}:{number}"
            for number, line in enumerate(text.splitlines(), start=1)
            if AGENT_APP_PATTERN.search(line)
        ]
    assert offenders == []


def test_home_page_has_no_receipt_or_hash_wording(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    for runtime, served in (
        ("python", python_surface(tmp_path, monkeypatch)),
        ("worker", worker_surface()),
    ):
        assert RECEIPT_WORDING.findall(visible_prose(served["/"])) == [], runtime


def test_live_gateway_routes_keep_working_and_name_the_muse_default() -> None:
    served = worker_surface()
    for path in GATEWAY_PATHS:
        assert served[f"GATEWAY STATUS {path}"] == "200", path
        assert served[f"GATEWAY {path}"], path
    assert "Muse Spark 1.3 through the Meta API" in served["GATEWAY /prompts"]
    assert "Muse Spark 1.3 through the Meta API" in served["GATEWAY /prompts/raw/cli_swarm_100"]
    assert "your-agent-command" in served["GATEWAY /prompts/raw/cli_swarm_100"]
    for path in ("/q/pulse", "/q/trust", "/q/search?q=muse"):
        json.loads(served[f"GATEWAY {path}"])
