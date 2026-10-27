"""Server-rendered HTML console, SVG brand chrome, interactive preview script, and discovery specs."""

from __future__ import annotations

import html
from typing import Any

from herma import __version__
from herma.schemas import ContextEntry, StoredProvision

FAVICON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" role="img" aria-label="Herma boundary pillar">
  <rect width="32" height="32" rx="7" fill="#0c1017"/>
  <path d="M9 27h14v2H9zm2-3h10l1 3H10zm1-14h8v14h-8z" fill="#67b7ff"/>
  <rect x="9" y="6" width="14" height="4" rx="1.5" fill="#eef2f7"/>
  <path d="M14 13h4v1.5h-4zm0 3.2h4v1.5h-4zm0 3.2h4v1.5h-4z" fill="#0c1017"/>
</svg>
"""

BRAND_SVG = (
    '<svg class="brand-mark" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">'
    '<rect width="32" height="32" rx="7" fill="currentColor" opacity="0.14"/>'
    '<path d="M9 26.5h14v2H9zm2-2.8h10l1 2.8H10zm1-13.7h8v13.7h-8z" fill="currentColor"/>'
    '<rect x="9" y="6" width="14" height="3.8" rx="1.4" fill="currentColor"/>'
    '<path d="M14 13h4v1.4h-4zm0 3h4v1.4h-4zm0 3h4v1.4h-4z" fill="var(--bg)"/>'
    "</svg>"
)

STYLE = """
:root { color-scheme: light dark; --bg:#0c1017; --card:#131a24; --border:#253244; --fg:#eef2f7; --muted:#9fb0c5; --accent:#67b7ff; --pill:#1b2738; --danger:#ff7b7b; --ok:#53d69a; }
@media (prefers-color-scheme: light) {
  :root { --bg:#f6f7f9; --card:#ffffff; --border:#d8e0ea; --fg:#101824; --muted:#4b5b70; --accent:#0b5fff; --pill:#eaf1fb; --danger:#b42318; --ok:#067647; }
}
* { box-sizing:border-box; }
html, body { max-width:100%; overflow-x:hidden; margin:0; font-family:ui-sans-serif,system-ui,-apple-system,sans-serif; background:var(--bg); color:var(--fg); line-height:1.55; }
.site-header { border-bottom:1px solid var(--border); background:var(--card); }
.header-inner { max-width:1040px; margin:0 auto; padding:0.9rem 1.2rem; display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:0.8rem 1.2rem; }
.brand { display:inline-flex; align-items:center; gap:0.55rem; color:var(--fg); text-decoration:none; font-weight:700; font-size:1.05rem; }
.brand-mark { color:var(--accent); flex-shrink:0; }
nav { display:flex; flex-wrap:wrap; gap:0.55rem 1rem; font-size:0.9rem; align-items:center; }
nav a { color:var(--accent); text-decoration:none; font-weight:600; }
nav a:hover { text-decoration:underline; }
main { max-width:1040px; margin:0 auto; padding:2rem 1.2rem 3rem; }
.site-footer { max-width:1040px; margin:0 auto; padding:1.4rem 1.2rem 2.4rem; border-top:1px solid var(--border); color:var(--muted); font-size:0.86rem; display:flex; flex-wrap:wrap; gap:0.6rem 1.4rem; justify-content:space-between; }
.site-footer a { color:var(--accent); text-decoration:none; }
.pill { display:inline-block; padding:0.2rem 0.6rem; border-radius:999px; background:var(--pill); color:var(--accent); font-size:0.76rem; font-weight:600; text-transform:uppercase; letter-spacing:0.06em; }
h1 { margin:0.6rem 0 0.5rem; font-size:clamp(1.55rem,3vw,2.3rem); overflow-wrap:anywhere; }
.lead { color:var(--muted); max-width:820px; margin:0 0 1.8rem; }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,270px),1fr)); gap:1rem; margin-bottom:1.8rem; }
.card { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:1.15rem; min-width:0; }
.card h2, .card h3 { margin:0.2rem 0 0.5rem; font-size:1.06rem; }
pre, code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:0.85rem; }
pre { background:var(--pill); border:1px solid var(--border); border-radius:8px; padding:0.85rem; overflow-x:auto; max-width:100%; margin:0.5rem 0 0; }
.table-wrap { width:100%; overflow-x:auto; -webkit-overflow-scrolling:touch; border:1px solid var(--border); border-radius:10px; background:var(--card); margin-bottom:1.4rem; }
table { width:100%; border-collapse:collapse; font-size:0.89rem; min-width:540px; }
th, td { text-align:left; padding:0.65rem 0.85rem; border-bottom:1px solid var(--border); vertical-align:top; }
tbody tr:last-child td { border-bottom:none; }
th { color:var(--muted); font-weight:600; white-space:nowrap; }
.inspector { margin:1.8rem 0 2.2rem; }
.preset-row { display:flex; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.8rem; }
.btn { appearance:none; border:1px solid var(--border); background:var(--pill); color:var(--fg); border-radius:8px; padding:0.45rem 0.8rem; font-size:0.85rem; font-weight:600; cursor:pointer; }
.btn-primary { background:var(--accent); color:#ffffff; border-color:var(--accent); }
.btn:disabled { opacity:0.6; cursor:wait; }
.form-row { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr)); gap:0.75rem; margin:0.75rem 0; }
label { display:block; font-size:0.82rem; font-weight:600; color:var(--muted); margin-bottom:0.25rem; }
textarea, input[type="text"], select { width:100%; background:var(--bg); color:var(--fg); border:1px solid var(--border); border-radius:8px; padding:0.55rem 0.7rem; font:inherit; font-size:0.88rem; }
textarea { min-height:84px; resize:vertical; }
.preview-status { margin-top:0.75rem; font-size:0.86rem; color:var(--muted); }
.preview-status.error { color:var(--danger); font-weight:600; }
.preview-status.ok { color:var(--ok); }
.entity-tags { display:flex; flex-wrap:wrap; gap:0.4rem; margin:0.5rem 0; }
.entity-chip { display:inline-block; padding:0.18rem 0.55rem; border-radius:6px; background:var(--pill); border:1px solid var(--border); font-size:0.8rem; }
"""

PREVIEW_JS = """(function () {
  const promptEl = document.getElementById("herma-preview-prompt");
  const pathEl = document.getElementById("herma-preview-path");
  const wireEl = document.getElementById("herma-preview-wire");
  const runBtn = document.getElementById("herma-preview-btn");
  const statusEl = document.getElementById("herma-preview-status");
  const outputEl = document.getElementById("herma-preview-output");
  if (!promptEl || !runBtn || !statusEl || !outputEl) return;

  const presets = {
    fencing: {
      prompt: "Update src/tessera/_tasks.py to verify noun:tessera.lease_fence with `put_record()`.",
      path: "src/tessera/_tasks.py",
      wire: "chat_completions"
    },
    direct: {
      prompt: "Show the canonical noun/verb schema for queue claims.",
      path: "",
      wire: "responses"
    },
    statute: {
      prompt: "Check statute card US-ROSCA-8403 after ValueError: stale fencing token in shamash/checks.py",
      path: "shamash/checks.py",
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
    statusEl.className = "preview-status";
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
    statusEl.className = "preview-status";
    statusEl.textContent = "Evaluating system_builtin 3-tier triggers and deterministic entity patterns...";
    outputEl.innerHTML = "";

    try {
      const resp = await fetch("/api/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ prompt: prompt, wire_format: wire, workspace_paths: workspacePaths })
      });
      const data = await resp.json();
      if (!resp.ok) {
        statusEl.className = "preview-status error";
        statusEl.textContent = "Preview refused (" + resp.status + "): " + (data.detail || data.title || "invalid input");
        return;
      }
      statusEl.className = "preview-status ok";
      statusEl.textContent = "Evaluated scope: " + data.scope_evaluated + " | persisted: " + String(data.persisted) + " | matches: " + (data.matches || []).length + " | entities: " + (data.entities || []).length;

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
        "<div style='margin-top:0.8rem;'>" +
        "<strong>Matched Builtin Provisions:</strong>" +
        (matchItems ? "<ul>" + matchItems + "</ul>" : "<p style='color:var(--muted);margin:0.3rem 0;'>No system_builtin rules matched this prompt.</p>") +
        "<strong>Extracted Top-of-Mind Entities (0 LLM calls):</strong>" +
        (entItems ? "<div class='entity-tags'>" + entItems + "</div>" : "<p style='color:var(--muted);margin:0.3rem 0;'>No file paths, symbols, URIs, statute cards, or errors detected.</p>") +
        "<strong>" + (data.responded_directly ? "Direct Protocol Reply (0 upstream tokens):" : "Augmented Wire Payload:") + "</strong>" +
        "<pre>" + escText(previewPayload) + "</pre>" +
        "</div>";
    } catch (err) {
      statusEl.className = "preview-status error";
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
                "prompt": {"type": "string", "description": "Prompt text to inspect."},
                "wire_format": {
                    "type": "string",
                    "enum": ["chat_completions", "responses", "messages"],
                },
                "workspace_paths": {
                    "type": "array",
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
        "name": "Herma",
        "description": (
            "Context-shimming AI middleware for configurable coding harnesses: 3-tier trigger "
            "evaluation, caller-isolated atomic noun/verb context database, zero-token direct "
            "responses, deterministic entity memory, and self-improving rule insights."
        ),
        "url": base,
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
            "schemes": ["bearer", "x-herma-key"],
            "credential_prefix": "hmk_",
            "configurable_harnesses_only": True,
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
                "description": "Deterministically extract file paths, code symbols, Tessera URIs, statute card IDs, and error signatures.",
            },
        ],
    }


def _render_header() -> str:
    return f"""  <header class="site-header">
    <div class="header-inner">
      <a class="brand" href="/">{BRAND_SVG}<span>Herma</span></a>
      <nav aria-label="Primary">
        <a href="/">Overview</a>
        <a href="/connect">Connect Harness</a>
        <a href="/healthz">Health JSON</a>
        <a href="/llms.txt">llms.txt</a>
        <a href="/.well-known/agent-card.json">Agent Card</a>
        <a href="https://github.com/ta-amps/herma">GitHub</a>
      </nav>
    </div>
  </header>"""


def _render_footer(public_url: str) -> str:
    return f"""  <footer class="site-footer">
    <span>Endpoint: <code>{html.escape(public_url)}</code> · Standard mode only (<code>-contributor</code> refused).</span>
    <span><a href="/llms.txt">llms.txt</a> · <a href="/llms-full.txt">llms-full.txt</a> · <a href="/.well-known/agent-card.json">agent-card.json</a></span>
  </footer>"""


def render_overview_page(
    provisions: list[StoredProvision],
    receipts_or_unused: list[Any] | None = None,
    public_url: str = "http://127.0.0.1:7730",
    context_entries: list[ContextEntry] | None = None,
    *,
    aggregate_counts: dict[str, int] | None = None,
) -> str:
    """Render public read-only HTML status board using ONLY system_builtin items and aggregate counts."""
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
            f"<tr><td><code>{html.escape(p.prov_id)}</code> (v{sp.version})</td>"
            f"<td>{html.escape(p.title)}<br/><small><code>{html.escape(p.action)}</code>{html.escape(refs_note)}</small></td>"
            f"<td><code>{html.escape(', '.join(tiers))}</code> ({html.escape(p.triggers.mode)})</td>"
            f"<td>{len(p.uris)} URI(s) · prio {p.priority}</td>"
            f"<td><code>{html.escape(sp.source_store)}</code></td></tr>"
        )
    prov_table = (
        "\n".join(rows)
        if rows
        else "<tr><td colspan='5'>No builtin provisions seeded yet. Run <code>uv run herma seed</code>.</td></tr>"
    )

    ctx_rows = []
    for entry in entries[:25]:
        uri_cell = f"<code>{html.escape(entry.source_uri)}</code>" if entry.source_uri else "--"
        ctx_rows.append(
            f"<tr><td><code>{html.escape(entry.entry_id)}</code></td>"
            f"<td><code>{html.escape(entry.kind)}</code></td>"
            f"<td>{html.escape(entry.title)}</td>"
            f"<td>{html.escape(entry.summary)}</td>"
            f"<td>{uri_cell}</td></tr>"
        )
    ctx_table = (
        "\n".join(ctx_rows)
        if ctx_rows
        else "<tr><td colspan='5'>No builtin noun/verb/detail entries configured yet.</td></tr>"
    )

    total_reqs = int(counts.get("total_intercepted_requests", 0))
    total_ents = int(counts.get("total_working_entities", 0))
    total_outs = int(counts.get("total_rule_outcomes", 0))

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <title>Herma v{html.escape(__version__)} -- Context-Shimming AI Middleware</title>
  <style>{STYLE}</style>
</head>
<body>
{_render_header()}
  <main>
    <span class="pill">Herma v{html.escape(__version__)} · Programmable AI Request Middleware</span>
    <h1>Context-Shimming AI Middleware for Configurable Coding Harnesses</h1>
    <p class="lead">
      <strong>Herma:</strong> context-shimming AI middleware for configurable coding harnesses --
      intercepts requests via <strong>keyword</strong>, <strong>semantic</strong>, or
      <strong>micromodel</strong> rules to <strong>respond directly</strong> or shim atomic
      <strong>noun, verb, and URI context</strong> from a user-configured database before LLM execution.
      Generic consumer assistants and contributor-tier models remain deterministically refused.
    </p>
    <section class="grid">
      <div class="card">
        <span class="pill">Tier 1-3 Rules</span>
        <h3>Keyword, Semantic &amp; Micromodel</h3>
        <p>Inspects prompt text, file path globs, and declared tools across 3 trigger tiers with short-circuiting so static system prompts never bloat.</p>
      </div>
      <div class="card">
        <span class="pill">Caller-Isolated Shims</span>
        <h3>Atomic Noun, Verb &amp; Entity Memory</h3>
        <p>Isolates custom rules, context entries, receipts, and top-of-mind working entities per <code>caller_scope</code> while protecting <code>system_builtin</code> guardrails.</p>
      </div>
      <div class="card">
        <span class="pill">respond_directly</span>
        <h3>Zero-Token Direct Responses</h3>
        <p>Answers deterministic lookups and guardrails directly in OpenAI, Responses, or Anthropic wire format while minting a SHA-256 <code>InjectionReceipt</code>.</p>
      </div>
    </section>

    <section class="card inspector" aria-labelledby="inspector-heading">
      <span class="pill">Read-Only Inspector · persisted: false</span>
      <h2 id="inspector-heading">Shim Trigger &amp; Entity Extractor Preview</h2>
      <p style="color:var(--muted);margin:0.2rem 0 0.8rem;font-size:0.9rem;">
        Test starter <code>system_builtin</code> provisions and deterministic regex entity extraction in memory without writing receipts or reading caller state.
      </p>
      <div class="preset-row">
        <button class="btn" type="button" data-herma-preset="fencing">Preset: Tessera Lease Fencing</button>
        <button class="btn" type="button" data-herma-preset="direct">Preset: Direct Noun/Verb Schema</button>
        <button class="btn" type="button" data-herma-preset="statute">Preset: Statute Card &amp; Error Retry</button>
      </div>
      <div>
        <label for="herma-preview-prompt">Outbound Harness Prompt</label>
        <textarea id="herma-preview-prompt" placeholder="e.g. Update src/tessera/_tasks.py to verify noun:tessera.lease_fence and US-ROSCA-8403"></textarea>
      </div>
      <div class="form-row">
        <div>
          <label for="herma-preview-path">Workspace Paths (comma-separated)</label>
          <input id="herma-preview-path" type="text" placeholder="src/tessera/_tasks.py" />
        </div>
        <div>
          <label for="herma-preview-wire">Wire Protocol</label>
          <select id="herma-preview-wire">
            <option value="chat_completions">OpenAI /v1/chat/completions</option>
            <option value="responses">Responses /v1/responses</option>
            <option value="messages">Anthropic /v1/messages</option>
          </select>
        </div>
      </div>
      <button id="herma-preview-btn" class="btn btn-primary" type="button">Run Read-Only Preview</button>
      <div id="herma-preview-status" class="preview-status" role="status" aria-live="polite">
        Enter a coding-harness prompt or choose a preset above to preview builtin triggers and entity extraction (persisted: false).
      </div>
      <div id="herma-preview-output"></div>
    </section>

    <h2>Starter Builtin Provisions ({len(builtin_provisions)})</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>ID</th><th>Title &amp; Action</th><th>Triggers</th><th>URIs &amp; Priority</th><th>Store</th></tr></thead>
        <tbody>{prov_table}</tbody>
      </table>
    </div>

    <h2>Starter Builtin Noun, Verb &amp; Detail Context ({len(entries)})</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Entry ID</th><th>Kind</th><th>Title</th><th>Summary</th><th>Source URI</th></tr></thead>
        <tbody>{ctx_table}</tbody>
      </table>
    </div>

    <h2>Aggregate Middleware Telemetry (Caller Receipts Isolated)</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Builtin Provisions</th><th>Builtin Context Entries</th><th>Intercepted Turns</th><th>Tracked Entities</th><th>Outcome Signals</th></tr></thead>
        <tbody>
          <tr>
            <td><code>{len(builtin_provisions)}</code></td>
            <td><code>{len(entries)}</code></td>
            <td><code>{total_reqs}</code></td>
            <td><code>{total_ents}</code></td>
            <td><code>{total_outs}</code></td>
          </tr>
        </tbody>
      </table>
    </div>
  </main>
{_render_footer(public_url)}
  <script src="/preview.js" defer></script>
</body>
</html>"""


def render_connect_page(public_url: str) -> str:
    base = html.escape(public_url.rstrip("/"))
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <title>Connect a Configurable Coding Harness -- Herma</title>
  <style>{STYLE}</style>
</head>
<body>
{_render_header()}
  <main>
    <span class="pill">Configurable Harnesses Only</span>
    <h1>Connect Muse Code, OpenCode, Claude Code, or Codex</h1>
    <p class="lead">
      Only fully configurable agentic coding harnesses that control custom base URLs, headers, and scoped
      <code>hmk_</code> credentials can route through or configure Herma. Generic consumer chat clients
      (such as Muse Personal Assistant) are deterministically refused with <code>HTTP 403 harness_required</code>.
    </p>
    <div class="card" style="margin-bottom:1.2rem;">
      <h3>1. Issue a Scoped Harness Key</h3>
      <pre>uv run herma keys issue --label dev-laptop --harness opencode --scopes route,configure</pre>
    </div>
    <div class="card" style="margin-bottom:1.2rem;">
      <h3>2. Register Caller-Scoped Noun / Verb Context Entries</h3>
      <pre>curl -fsS -X POST {base}/v1/context \\
  -H "Content-Type: application/json" \\
  -H "X-Herma-Key: hmk_&lt;id&gt;.&lt;secret&gt;" \\
  -H "X-Herma-Harness: opencode" \\
  -d '{{"entry_id":"noun:custom.lease_contract","kind":"noun","title":"Custom Lease Contract","summary":"Caller-scoped atomic noun definition."}}'</pre>
    </div>
    <div class="card" style="margin-bottom:1.2rem;">
      <h3>3. Route Turns &amp; Track Top-of-Mind Entity Memory</h3>
      <pre>curl -fsS -X POST {base}/v1/dry-run \\
  -H "Content-Type: application/json" \\
  -H "X-Herma-Key: hmk_&lt;id&gt;.&lt;secret&gt;" \\
  -H "X-Herma-Harness: opencode" \\
  -H "X-Herma-Project: my-repo" \\
  -d '{{"wire_format":"chat_completions","payload":{{"model":"muse-spark-open","messages":[{{"role":"user","content":"Claim a task from the Tessera queue with fencing"}}]}}'</pre>
    </div>
    <div class="card">
      <h3>4. Inspect Self-Improving Rule Insights &amp; MCP Discovery</h3>
      <pre>curl -fsS {base}/v1/insights?project_tag=my-repo \\
  -H "X-Herma-Key: hmk_&lt;id&gt;.&lt;secret&gt;" \\
  -H "X-Herma-Harness: opencode"</pre>
    </div>
  </main>
{_render_footer(public_url)}
</body>
</html>"""
