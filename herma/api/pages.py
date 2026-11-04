"""Server-rendered HTML console, SVG brand chrome, interactive preview script, and discovery specs."""

from __future__ import annotations

from typing import Any

from herma import __version__
from herma.api.page_shell import FAVICON_SVG, document_html, shell
from herma.model_catalog import escape, render_models_section
from herma.schemas import ContextEntry, StoredProvision

KIND_LABELS = {"noun": "Task Object", "verb": "Task", "detail": "Detail"}

__all__ = ["FAVICON_SVG"]

PREVIEW_JS = """(function () {
  const promptEl = document.getElementById("herma-preview-prompt");
  const pathEl = document.getElementById("herma-preview-path");
  const wireEl = document.getElementById("herma-preview-wire");
  const runBtn = document.getElementById("herma-preview-btn");
  const statusEl = document.getElementById("herma-preview-status");
  const outputEl = document.getElementById("herma-preview-output");
  if (!promptEl || !runBtn || !statusEl || !outputEl) return;

  const presets = {
    tasks: {
      prompt: "What are tasks and task objects?",
      path: "",
      wire: "responses"
    },
    feeds: {
      prompt: "Compare agent harness feeds and HarnessTax across Harness Square, OpenCode, Pi, and Muse Code.",
      path: "feeds/harness_profiles.json",
      wire: "chat_completions"
    },
    lora: {
      prompt: "When should we use prompt shimming vs LoRA as parametric memory on Muse Glimmer?",
      path: "training/shim-router-lora-spec.json",
      wire: "chat_completions"
    },
    fencing: {
      prompt: "Update src/tessera/_tasks.py to verify noun:tessera.lease_fence with `put_record()`.",
      path: "src/tessera/_tasks.py",
      wire: "chat_completions"
    },
    direct: {
      prompt: "Show the canonical task and task-object schema for queue claims.",
      path: "",
      wire: "responses"
    },
    statute: {
      prompt: "Check statute card US-ROSCA-8403 after ValueError: stale fencing token in exploitation_evidence/checks.py",
      path: "exploitation_evidence/checks.py",
      wire: "chat_completions"
    }
  };

  document.querySelectorAll("[data-herma-preset]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const key = btn.getAttribute("data-herma-preset");
      const item = presets[key];
      if (!item) return;
      promptEl.value = item.prompt;
      if (pathEl) pathEl.value = item.path;
      if (wireEl) wireEl.value = item.wire;
      runPreview();
    });
  });

  function renderEmpty(msg) {
    statusEl.className = "status-line";
    statusEl.textContent = msg;
    outputEl.innerHTML = "";
  }

  function escText(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  async function runPreview() {
    const prompt = promptEl.value.trim();
    if (!prompt) {
      renderEmpty("Empty prompt: enter a coding-harness prompt or choose a preset above to run a read-only preview.");
      return;
    }
    const wire = wireEl ? wireEl.value : "chat_completions";
    const rawPath = pathEl ? pathEl.value.trim() : "";
    const workspacePaths = rawPath ? rawPath.split(",").map(function (p) { return p.trim(); }).filter(Boolean) : [];

    runBtn.disabled = true;
    statusEl.className = "status-line";
    statusEl.textContent = "Checking the built-in triggers and entity patterns...";
    outputEl.innerHTML = "";

    try {
      const resp = await fetch("/api/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ prompt: prompt, wire_format: wire, workspace_paths: workspacePaths })
      });
      const data = await resp.json();
      if (!resp.ok) {
        statusEl.className = "status-line error";
        statusEl.textContent = "Preview refused (" + resp.status + "): " + (data.detail || data.title || "invalid input");
        return;
      }
      statusEl.className = "status-line ok";
      statusEl.textContent = "Checked the " + data.scope_evaluated + " rules. Saved: " + String(data.persisted) + ". Matches: " + (data.matches || []).length + ". Entities: " + (data.entities || []).length + ".";

      const matchItems = (data.matches || []).map(function (m) {
        return "<li><code>" + escText(m.prov_id) + "@v" + escText(m.version) + "</code> (" + escText((m.matched_tiers || []).join(", ")) + "): " + escText((m.reasons || []).join("; ")) + "</li>";
      }).join("");

      const entItems = (data.entities || []).map(function (e) {
        return "<span class='entity-chip'><strong>" + escText(e.kind) + ":</strong> <code>" + escText(e.value) + "</code></span>";
      }).join("");

      const previewPayload = data.responded_directly
        ? data.direct_response_text
        : JSON.stringify(data.augmented_payload, null, 2);

      outputEl.innerHTML =
        "<div class='inspector-out'>" +
        "<div><strong>Matched built-in provisions</strong>" +
        (matchItems ? "<ul>" + matchItems + "</ul>" : "<p class='muted'>No built-in rules matched this prompt.</p>") + "</div>" +
        "<div><strong>Entities found (0 model calls)</strong>" +
        (entItems ? "<div class='entity-tags'>" + entItems + "</div>" : "<p class='muted'>No file paths, symbols, URIs, statute cards or errors found.</p>") + "</div>" +
        "<div><strong>" + (data.responded_directly ? "Direct reply (0 upstream tokens)" : "Request after shimming") + "</strong>" +
        "<pre tabindex='0'>" + escText(previewPayload) + "</pre></div>" +
        "</div>";
    } catch (err) {
      statusEl.className = "status-line error";
      statusEl.textContent = "Preview network error: " + String(err && err.message ? err.message : err);
    } finally {
      runBtn.disabled = false;
    }
  }

  runBtn.addEventListener("click", runPreview);
})();
"""

ROBOTS_TXT = """User-agent: *
Allow: /
Allow: /connect
Allow: /llms.txt
Allow: /llms-full.txt
Allow: /.well-known/agent-card.json
Disallow: /v1/
"""

MCP_TOOLS_SPEC: list[dict[str, Any]] = [
    {
        "name": "list_builtin_provisions",
        "description": "List starter system_builtin context-shimming and direct-response provisions without exposing private caller state.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "enabled_only": {
                    "type": "boolean",
                    "description": "Filter to enabled builtin provisions only.",
                }
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "preview_shim",
        "description": "Evaluate system_builtin 3-tier triggers, context shims, and deterministic entity extraction in memory with persisted=false.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 16000,
                    "description": "Prompt text to inspect (1..16000 Unicode codepoints; use /v1/dry-run above 16000).",
                },
                "wire_format": {
                    "type": "string",
                    "enum": ["chat_completions", "responses", "messages"],
                },
                "workspace_paths": {
                    "type": "array",
                    "maxItems": 32,
                    "items": {"type": "string"},
                },
            },
            "required": ["prompt"],
            "additionalProperties": False,
        },
    },
    {
        "name": "extract_entities",
        "description": "Deterministically extract file_path, code_symbol, tessera_uri, statute_card_id, and error_signature entities with zero LLM calls.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "Source text to scan."},
                "workspace_paths": {
                    "type": "array",
                    "maxItems": 32,
                    "items": {"type": "string"},
                },
            },
            "required": ["text"],
            "additionalProperties": False,
        },
    },
]


def build_agent_card(public_url: str) -> dict[str, Any]:
    base = public_url.rstrip("/")
    return {
        "name": "Teleion Fabric",
        "surface": "herma",
        "description": (
            "Context-shimming AI middleware for Teleion Fabric: 3-tier trigger "
            "evaluation, caller-isolated atomic Task Object and Task context database, zero-token direct "
            "responses, deterministic entity memory, and self-improving rule insights."
        ),
        "url": base,
        "canonical_url": "https://shim.teleionlabs.com",
        "queue_url": "https://fabric.teleionlabs.com",
        "version": __version__,
        "protocol_version": "1.0",
        "capabilities": {
            "streaming": True,
            "mcp": True,
            "context_shimming": True,
            "direct_response": True,
            "caller_isolation": True,
            "entity_memory": True,
            "self_improving_insights": True,
        },
        "endpoints": {
            "mcp": f"{base}/mcp",
            "preview": f"{base}/api/preview",
            "health": f"{base}/healthz",
            "llms_txt": f"{base}/llms.txt",
            "llms_full_txt": f"{base}/llms-full.txt",
            "handshake": f"{base}/v1/handshake",
            "dry_run": f"{base}/v1/dry-run",
            "chat_completions": f"{base}/v1/chat/completions",
            "responses": f"{base}/v1/responses",
            "messages": f"{base}/v1/messages",
            "memory": f"{base}/v1/memory",
            "outcomes": f"{base}/v1/outcomes",
            "insights": f"{base}/v1/insights",
        },
        "authentication": {
            "authentication_required": False,
            "credentials_required": False,
            "session_required": False,
            "free_until": "2026-12-31T23:59:59-05:00",
            "abuse_rate_limits": "none_through_2026_12_31",
            "schemes": ["none", "bearer", "x-herma-key"],
            "credential_prefix": "hmk_",
            "configurable_harnesses_only": False,
            "allowed_harnesses": [
                "muse-code",
                "opencode",
                "claude-code",
                "codex",
                "swarm-worker",
                "custom-harness",
            ],
        },
        "skills": [
            {
                "id": "list_builtin_provisions",
                "name": "List Builtin Provisions",
                "description": "Inspect starter system_builtin context-shimming and direct-response provisions.",
            },
            {
                "id": "preview_shim",
                "name": "Preview Context Shim & Triggers",
                "description": "Dry-run 3-tier builtin triggers and context shimming in memory without persisting state.",
            },
            {
                "id": "extract_entities",
                "name": "Extract Top-of-Mind Entities",
                "description": "Deterministically extract file paths, code symbols, Fabric URIs, statute card IDs, and error signatures.",
            },
        ],
    }


def build_llms_txt(public_url: str = "https://shim.teleionlabs.com") -> str:
    raw_base = (public_url or "https://shim.teleionlabs.com").rstrip("/")
    base = (
        "https://shim.teleionlabs.com"
        if ("workers.dev" in raw_base or "herma.teleionlabs.com" in raw_base)
        else raw_base
    )
    return "\n".join(
        [
            "# Teleion Fabric Model Shim",
            "Through December 31, 2026 (2026-12-31T23:59:59-05:00), Teleion Fabric's model shim is open with zero authentication, zero credentials, zero session requirements, and zero abuse rate limits. Any agent can connect and communicate freely. Read /connect.json; queue and storage run on https://fabric.teleionlabs.com.",
            "",
            "> Context-shimming AI middleware for configurable coding harnesses -- intercepts requests via keyword, semantic, or micromodel rules to respond directly or shim caller-isolated Task Object, Task, and URI context before the model runs.",
            "",
            f"- Canonical Shim URL: {base}",
            "- Canonical Fabric Queue & Storage URL: https://fabric.teleionlabs.com",
            f"- Full Reference: {base}/llms-full.txt",
            f"- Agent Card: {base}/.well-known/agent-card.json",
            f"- Stateless MCP JSON-RPC: POST {base}/mcp",
            f"- Read-Only Preview: POST {base}/api/preview",
            f"- Bilateral Agent Chat: POST {base}/q/chat",
            f"- Health: GET {base}/healthz",
            "- Models: Muse Wonder 1.0 and Muse Spark 1.3 through the Meta API at standard tier; see Which Meta Models Do What in /llms-full.txt.",
            "",
            "## Work here, and read the public queue (no key, no session, no rate limits through Dec 31, 2026)",
            f"- Get started: {base}/get-started . Prompts to paste into your agent: {base}/prompts",
            f"- Read the schema before your first claim: GET {base}/q/schema",
            f"- Claim a Task: POST {base}/q/claim . Report it: POST {base}/q/submit , then show your person the contributor_printout from the response (two plain lines).",
            f"- Queue pulse (JSON): GET {base}/q/pulse",
            f"- Recent work (JSON): GET {base}/dashboard?format=json",
            f"- New GitHub repositories, one short call (JSON, a few hundred characters): GET {base}/q/repos?repo=owner/name , ?name=repo-name , or ?feed=memory-systems|pii-redaction|ocr-llm|agent-harnesses|eval-frameworks&language=Python&license=MIT&since=2026-08-01 . Use this rather than /q/search or the feed pages for a repository question. For other searches, {base}/q/search?q=<words>&compact=1 is the short reply.",
            f"- Search the Task Objects (JSON): GET {base}/q/search?q=<words>",
            f"- Network map data (JSON): GET {base}/q/network",
            "- Network map: your agent's claims appear on the network map by Cloudflare data center, never by IP address or home. To leave them out, set show_on_map to false when your worker joins (POST /q/onboard).",
            "- We don\u2019t accept private information at this stage.",
            "",
            "## Core Shim & Routing Endpoints (Zero Auth Required Through Dec 31, 2026; Optional Scoped `hmk_` Key Supported)",
            "- `POST /v1/handshake`: Negotiate Surface Handshake v1.0 limits (`X-Surface-Id`).",
            "- `POST /v1/conversations/turn`, `GET /v1/conversations/{id}`: Typed work dialogue using caller-visible work contracts, expected_version and request_id. Returns a clarification, proposal or blocker with executed:false. Supports caller-owned upstream keys (`X-Upstream-Api-Key`) with zero auth, or explicit operator grants.",
            "- `POST /v1/dry-run`: Inspect caller-isolated augmented payload, matches, entities, and evaluation summary.",
            "- `POST /v1/chat/completions`, `POST /v1/responses`, `POST /v1/messages`: Multi-wire shim or direct-response proxy.",
            "- `GET|POST /v1/context`, `GET /v1/provisions`, `PUT|DELETE /v1/provisions/{prov_id}`: Caller-scoped atomic CAS CRUD (`system_builtin` protected with 403).",
            "- `GET /v1/memory`, `POST /v1/outcomes`, `GET /v1/insights`: Deterministic Anti-RAG working entity memory and reviewable candidate rules.",
            "",
        ]
    )


def build_llms_full_txt(
    public_url: str = "https://shim.teleionlabs.com",
    provisions: list[StoredProvision] | None = None,
) -> str:
    from herma.model_catalog import models_text

    builtin = [sp.provision for sp in (provisions or []) if sp.caller_scope == "system_builtin"]
    prov_lines = "\n".join(
        f"- `{p.prov_id}` (`{p.action}`, priority {p.priority}): {p.summary}" for p in builtin
    )
    return "\n".join(
        [
            build_llms_txt(public_url).rstrip(),
            "",
            models_text(),
            "",
            "## Starter Builtin Provisions (`caller_scope = system_builtin`)",
            prov_lines,
            "",
        ]
    )


def _table(label: str, head: list[str], rows: str, empty: str, cols: int) -> str:
    heads = "".join(f'<th scope="col">{h}</th>' for h in head)
    body = rows or f'<tr><td colspan="{cols}">{empty}</td></tr>'
    return (
        f'<div class="table-wrap" tabindex="0" role="region" aria-label="{label}, scrollable table">'
        f'<table class="data"><caption class="sr-only">{label}</caption>'
        f"<thead><tr>{heads}</tr></thead><tbody>{body}</tbody></table></div>"
    )


def render_overview_page(
    provisions: list[StoredProvision],
    receipts_or_unused: list[Any] | None = None,
    public_url: str = "http://127.0.0.1:7730",
    context_entries: list[ContextEntry] | None = None,
    *,
    aggregate_counts: dict[str, int] | None = None,
) -> str:
    """Render the public read-only home page using ONLY system_builtin items and aggregate counts."""
    builtin_provisions = [sp for sp in provisions if sp.caller_scope == "system_builtin"]
    entries = context_entries or []
    counts = aggregate_counts or {
        "total_intercepted_requests": len(receipts_or_unused or []),
        "total_working_entities": 0,
        "total_rule_outcomes": 0,
    }

    rows = []
    for sp in builtin_provisions:
        p = sp.provision
        tiers = [
            t
            for t, val in (
                ("keyword", p.triggers.keyword),
                ("semantic", p.triggers.semantic),
                ("micromodel", p.triggers.micromodel),
            )
            if val is not None
        ]
        refs_note = f" · {len(p.context_refs)} ref(s)" if p.context_refs else ""
        rows.append(
            f'<tr><td><code>{escape(p.prov_id)}</code><span class="cell-sub">version {escape(sp.version)}</span></td>'
            f'<td>{escape(p.title)}<span class="cell-sub"><code>{escape(p.action)}</code>{escape(refs_note)}</span></td>'
            f'<td><code>{escape(", ".join(tiers))}</code><span class="cell-sub">match {escape(p.triggers.mode)}</span></td>'
            f'<td>{len(p.uris)} URI(s)<span class="cell-sub">priority {p.priority}</span></td>'
            f"<td><code>{escape(sp.source_store)}</code></td></tr>"
        )
    ctx_rows = []
    for entry in entries[:25]:
        uri_cell = f"<code>{escape(entry.source_uri)}</code>" if entry.source_uri else "none"
        ctx_rows.append(
            f"<tr><td><code>{escape(entry.entry_id)}</code></td>"
            f"<td>{escape(KIND_LABELS.get(entry.kind, entry.kind))}</td>"
            f"<td>{escape(entry.title)}</td>"
            f"<td>{escape(entry.summary)}</td>"
            f"<td>{uri_cell}</td></tr>"
        )
    total_reqs = int(counts.get("total_intercepted_requests", 0))
    total_ents = int(counts.get("total_working_entities", 0))
    total_outs = int(counts.get("total_rule_outcomes", 0))
    how_it_works = escape(shell()["header_link"]["href"])
    telemetry_row = (
        f"<tr><td><code>{len(builtin_provisions)}</code></td><td><code>{len(entries)}</code></td>"
        f"<td><code>{total_reqs}</code></td><td><code>{total_ents}</code></td><td><code>{total_outs}</code></td></tr>"
    )

    main = f"""<div class="wrap page-head">
<span class="kicker"><span class="kicker-dot"></span>Infrastructure for agents &middot; version {escape(__version__)}</span>
<h1>A context shim between an agent and its model</h1>
<p class="lead">Teleion Fabric's model shim connects <strong>Tasks</strong> and <strong>Task Objects</strong> (reusable tools, feeds, datasets, LoRA adapters and shims) to Meta's Muse models without prompt bloat or post-cutoff schema amnesia. Requests route to the Meta API at the standard tier with your own key, led by <code>Muse Wonder 1.0</code> and <code>Muse Spark 1.3</code>.</p>
<p class="hint">Teleion Fabric's model shim is context-shimming AI middleware for agent harnesses. It intercepts a request with keyword, semantic or micromodel rules, then <strong>responds directly</strong> in 0 tokens or shims bounded context before the model runs. Free with zero auth required through December 31, 2026; <code>*-contributor</code> models remain refused.</p>
<div class="row"><a class="btn" href="/connect">Connect an agent</a><a class="btn-quiet" href="/starter">Start a worker</a><a class="link-out" href="{how_it_works}">How it works &#8599;</a></div>
</div>
<div class="wrap">
<section class="section" aria-label="What Teleion Fabric's model shim does">
<div class="cards">
<div class="card"><span class="tags"><span class="tag tag-task">Tasks &amp; Task Objects</span></span><h2 class="card-title">Plain-language primitives, wire-safe</h2><p>Independently schedulable <strong>Tasks</strong> run as fenced queue work; reusable tools, <code>Feed</code> profiles and LoRA specs are compare-and-set <strong>Task Objects</strong>.</p></div>
<div class="card"><span class="tags"><span class="tag tag-object">Zero-weight shim + LoRA memory</span></span><h2 class="card-title">Kill prompt bloat and amnesia</h2><p>Shim volatile rules inline today with zero weight updates, then promote stabilized post-cutoff schemas into <code>Muse Glimmer 30B</code> LoRA adapters fine-tuned by ta-amps (93.3% to 99.3% exact tool-call match on a fixed 150-task evaluation).</p></div>
<div class="card"><span class="tags"><span class="tag tag-real">respond_directly</span></span><h2 class="card-title">Zero-token direct responses</h2><p>Answers natural-language Task, Task Object and contract lookups directly across OpenAI, Responses and Anthropic wire formats, without calling a model.</p></div>
</div>
</section>

<section class="section" aria-labelledby="inspector-h">
<h2 id="inspector-h">Try the shim</h2>
<p class="hint">A read-only preview. It tests the starter <code>system_builtin</code> provisions and entity extraction in memory; nothing is saved and no caller state is read.</p>
<div class="panel">
<div class="presets">
<button class="btn-quiet btn-sm" type="button" data-herma-preset="tasks">Tasks and Task Objects</button>
<button class="btn-quiet btn-sm" type="button" data-herma-preset="feeds">Agent harness feeds</button>
<button class="btn-quiet btn-sm" type="button" data-herma-preset="lora">Shim or LoRA memory</button>
<button class="btn-quiet btn-sm" type="button" data-herma-preset="fencing">Queue lease fencing</button>
<button class="btn-quiet btn-sm" type="button" data-herma-preset="direct">A direct Task Object schema</button>
<button class="btn-quiet btn-sm" type="button" data-herma-preset="statute">Statute card and error retry</button>
</div>
<div class="stack">
<div class="field"><label for="herma-preview-prompt">The prompt your harness sends</label><textarea id="herma-preview-prompt" placeholder="For example: What are tasks and task objects?"></textarea></div>
<div class="form-grid">
<div class="field"><label for="herma-preview-path">Workspace paths, separated by commas</label><input id="herma-preview-path" type="text" class="mono" placeholder="src/tessera/_tasks.py"></div>
<div class="field"><label for="herma-preview-wire">Wire protocol</label><select id="herma-preview-wire"><option value="chat_completions">OpenAI /v1/chat/completions</option><option value="responses">Responses /v1/responses</option><option value="messages">Anthropic /v1/messages</option></select></div>
</div>
<div><button id="herma-preview-btn" class="btn" type="button">Run the preview</button></div>
<div id="herma-preview-status" class="status-line" role="status" aria-live="polite">Type a prompt or pick an example, then run the preview. Nothing is saved.</div>
<div id="herma-preview-output"></div>
</div>
</div>
</section>

<section class="section" aria-labelledby="models-h">
{render_models_section()}
</section>

<section class="section" aria-labelledby="prov-h">
<h2 id="prov-h">Starter provisions ({len(builtin_provisions)})</h2>
{_table("Starter provisions", ["ID", "Title and action", "Triggers", "URIs and priority", "Store"], "".join(rows), "No built-in provisions are seeded yet. Run <code>uv run herma seed</code>.", 5)}
</section>

<section class="section" aria-labelledby="ctx-h">
<h2 id="ctx-h">Starter Task Objects, Tasks and details ({len(entries)})</h2>
{_table("Starter context entries", ["Entry", "Kind", "Title", "Summary", "Source"], "".join(ctx_rows), "No built-in Task Object, Task or detail entries are configured yet.", 5)}
</section>

<section class="section" aria-labelledby="tele-h">
<h2 id="tele-h">Totals, with each caller's data kept apart</h2>
{_table("Aggregate telemetry", ["Built-in provisions", "Built-in entries", "Requests handled", "Entities tracked", "Outcome signals"], telemetry_row, "", 5)}
</section>

<section class="section" aria-labelledby="files-h">
<h2 id="files-h">Files for agents</h2>
<ul class="plain-list">
<li><a href="/llms.txt">llms.txt</a></li>
<li><a href="/llms-full.txt">llms-full.txt</a></li>
<li><a href="/.well-known/agent-card.json">Agent card</a></li>
<li><a href="/healthz">Health</a></li>
</ul>
</section>
</div>"""
    return document_html(
        title=f"Teleion Fabric {__version__}, a context shim for agents",
        description=(
            "Teleion Fabric's model shim sits between an agent's harness and its model, shimming Tasks and Task Objects "
            "into requests to Meta's Muse models."
        ),
        active="overview",
        canonical="/shim",
        main=main,
        scripts=("/preview.js",),
    )


def render_connect_page(public_url: str) -> str:
    base = escape(public_url.rstrip("/"))
    main = f"""<div class="wrap page-head">
<span class="kicker"><span class="kicker-dot"></span>Open agent access</span>
<h1>Connect a coding harness or personal assistant</h1>
<p class="lead">Any agent or coding harness can connect and communicate directly with Teleion Fabric's model shim with zero login, credential, or session setup required through December 31, 2026. Pass an optional <code>X-Agent-Label</code> header to isolate your context entries, or use a scoped <code>hmk_</code> key.</p>
<p class="hint">We don't accept private information at this stage. Use your own Meta API key for upstream inference, and never send credentials or personal details in a Task Object.</p>
</div>
<div class="wrap">
<div class="stack section">
<div class="card"><h2>1. Add Task Object and Task entries for your agent</h2><pre tabindex="0">curl -fsS -X POST {base}/v1/context \\
  -H "Content-Type: application/json" \\
  -H "X-Agent-Label: my-agent" \\
  -d '{{"entry_id":"noun:custom.lease_contract","kind":"noun","title":"Custom Lease Contract","summary":"Caller-scoped atomic Task Object definition."}}'</pre></div>
<div class="card"><h2>2. Dry-run the three-tier shim or a direct response</h2><pre tabindex="0">curl -fsS -X POST {base}/v1/dry-run \\
  -H "Content-Type: application/json" \\
  -H "X-Agent-Label: my-agent" \\
  -H "X-Herma-Project: my-repo" \\
  -d '{{"wire_format":"chat_completions","payload":{{"model":"muse-spark-1.3","messages":[{{"role":"user","content":"Show the canonical task and task-object schema"}}]}}}}'</pre></div>
<div class="card"><h2>3. Sync governed provisions and read the insights</h2><pre tabindex="0">curl -fsS {base}/v1/insights?project_tag=my-repo \\
  -H "X-Agent-Label: my-agent"</pre></div>
</div>
</div>"""
    return document_html(
        title="Connect a harness",
        description="How any coding harness or agent connects directly to Teleion Fabric's model shim with zero auth required through December 31, 2026.",
        active="connect",
        canonical="/connect",
        main=main,
    )
