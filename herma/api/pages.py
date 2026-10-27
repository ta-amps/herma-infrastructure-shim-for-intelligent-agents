"""Server-rendered read-only HTML status board and harness connection guide."""

from __future__ import annotations

import html

from herma import __version__
from herma.schemas import ContextEntry, InjectionReceipt, StoredProvision

STYLE = """
:root { color-scheme: light dark; --bg:#0c1017; --card:#131a24; --border:#253244; --fg:#eef2f7; --muted:#9fb0c5; --accent:#67b7ff; --pill:#1b2738; }
@media (prefers-color-scheme: light) {
  :root { --bg:#f6f7f9; --card:#ffffff; --border:#d8e0ea; --fg:#101824; --muted:#4b5b70; --accent:#0b5fff; --pill:#eaf1fb; }
}
* { box-sizing:border-box; }
body { margin:0; font-family:ui-sans-serif,system-ui,-apple-system,sans-serif; background:var(--bg); color:var(--fg); line-height:1.55; }
main { max-width:1040px; margin:0 auto; padding:2.8rem 1.4rem 3.5rem; }
nav { display:flex; gap:1rem; margin-bottom:1.6rem; font-size:0.92rem; }
nav a { color:var(--accent); text-decoration:none; font-weight:600; }
.pill { display:inline-block; padding:0.2rem 0.6rem; border-radius:999px; background:var(--pill); color:var(--accent); font-size:0.76rem; font-weight:600; text-transform:uppercase; letter-spacing:0.06em; }
h1 { margin:0.6rem 0 0.5rem; font-size:clamp(1.7rem,3vw,2.35rem); }
.lead { color:var(--muted); max-width:820px; margin:0 0 1.8rem; }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(290px,1fr)); gap:1rem; margin-bottom:1.8rem; }
.card { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:1.2rem; }
.card h2, .card h3 { margin:0.2rem 0 0.5rem; font-size:1.08rem; }
pre, code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:0.86rem; }
pre { background:var(--pill); border:1px solid var(--border); border-radius:8px; padding:0.9rem; overflow-x:auto; }
table { width:100%; border-collapse:collapse; font-size:0.9rem; background:var(--card); border:1px solid var(--border); border-radius:10px; overflow:hidden; }
th, td { text-align:left; padding:0.65rem 0.85rem; border-bottom:1px solid var(--border); vertical-align:top; }
th { color:var(--muted); font-weight:600; }
"""


def render_overview_page(
    provisions: list[StoredProvision],
    receipts: list[InjectionReceipt],
    public_url: str,
    context_entries: list[ContextEntry] | None = None,
) -> str:
    entries = context_entries or []
    rows = []
    for sp in provisions:
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
        else "<tr><td colspan='5'>No provisions seeded yet. Run <code>uv run herma seed</code>.</td></tr>"
    )

    ctx_rows = []
    for entry in entries[:25]:
        uri_cell = f"<code>{html.escape(entry.source_uri)}</code>" if entry.source_uri else "—"
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
        else "<tr><td colspan='5'>No noun/verb/detail entries configured yet (<code>POST /v1/context</code>).</td></tr>"
    )

    rcpt_rows = []
    for r in receipts[:10]:
        mode_tag = "direct" if r.responded_directly else "shim"
        rcpt_rows.append(
            f"<tr><td><code>{html.escape(r.receipt_sha256[:16])}…</code></td>"
            f"<td><code>{html.escape(r.harness_kind)}</code></td>"
            f"<td><code>{html.escape(r.wire_format)}</code> · <code>{html.escape(r.model)}</code></td>"
            f"<td><code>{html.escape(', '.join(r.provisions_fired) or 'none')}</code> ({mode_tag})</td>"
            f"<td>{r.injected_chars} chars</td></tr>"
        )
    rcpt_table = (
        "\n".join(rcpt_rows)
        if rcpt_rows
        else "<tr><td colspan='5'>No intercepted requests recorded yet.</td></tr>"
    )

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Herma v{html.escape(__version__)} — Context-Shimming AI Middleware</title>
  <style>{STYLE}</style>
</head>
<body>
  <main>
    <nav>
      <a href="/">Overview</a>
      <a href="/connect">Connect Harness</a>
      <a href="/api/health">Health JSON</a>
      <a href="https://github.com/ta-amps/herma">GitHub</a>
    </nav>
    <span class="pill">Herma v{html.escape(__version__)} · Programmable AI Request Middleware</span>
    <h1>Context-Shimming AI Middleware for Configurable Coding Harnesses</h1>
    <p class="lead">
      <strong>Herma:</strong> context-shimming AI middleware for configurable coding harnesses —
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
        <span class="pill">shim_context</span>
        <h3>Atomic Noun, Verb &amp; URI Shims</h3>
        <p>Pulls matched <code>noun:*</code>, <code>verb:*</code>, and <code>detail:*</code> entries from Herma's database or Tessera stores into a bounded <code>[NOUN/VERB CONTEXT]</code> block.</p>
      </div>
      <div class="card">
        <span class="pill">respond_directly</span>
        <h3>Zero-Token Direct Responses</h3>
        <p>Answers deterministic lookups and guardrails directly in OpenAI, Responses, or Anthropic wire format while minting a SHA-256 <code>InjectionReceipt</code>.</p>
      </div>
    </section>
    <h2>Active Provisions ({len(provisions)})</h2>
    <table>
      <thead><tr><th>ID</th><th>Title &amp; Action</th><th>Triggers</th><th>URIs &amp; Priority</th><th>Store</th></tr></thead>
      <tbody>{prov_table}</tbody>
    </table>
    <h2 style="margin-top:2rem;">Atomic Noun, Verb &amp; Detail Context Database ({len(entries)})</h2>
    <table>
      <thead><tr><th>Entry ID</th><th>Kind</th><th>Title</th><th>Summary</th><th>Source URI</th></tr></thead>
      <tbody>{ctx_table}</tbody>
    </table>
    <h2 style="margin-top:2rem;">Recent Injection Receipts ({len(receipts)})</h2>
    <table>
      <thead><tr><th>SHA-256</th><th>Harness</th><th>Wire / Model</th><th>Provisions Fired</th><th>Chars</th></tr></thead>
      <tbody>{rcpt_table}</tbody>
    </table>
    <p style="margin-top:1.5rem;color:var(--muted);font-size:0.88rem;">
      Endpoint: <code>{html.escape(public_url)}</code> · Standard mode only (<code>-contributor</code> refused).
    </p>
  </main>
</body>
</html>"""


def render_connect_page(public_url: str) -> str:
    base = html.escape(public_url.rstrip("/"))
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Connect a Configurable Coding Harness — Herma</title>
  <style>{STYLE}</style>
</head>
<body>
  <main>
    <nav>
      <a href="/">Overview</a>
      <a href="/connect">Connect Harness</a>
      <a href="/api/health">Health JSON</a>
      <a href="https://github.com/ta-amps/herma">GitHub</a>
    </nav>
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
      <h3>2. Register Atomic Noun / Verb Context Entries</h3>
      <pre>curl -fsS -X POST {base}/v1/context \\
  -H "Content-Type: application/json" \\
  -H "X-Herma-Key: hmk_&lt;id&gt;.&lt;secret&gt;" \\
  -H "X-Herma-Harness: opencode" \\
  -d '{{"entry_id":"noun:tessera.lease_fence","kind":"noun","title":"Monotonic Lease Fence","summary":"Fences out stale workers on submit/heartbeat."}}'</pre>
    </div>
    <div class="card" style="margin-bottom:1.2rem;">
      <h3>3. Route or Dry-Run Context Shimming &amp; Direct Responses</h3>
      <pre>curl -fsS -X POST {base}/v1/dry-run \\
  -H "Content-Type: application/json" \\
  -H "X-Herma-Key: hmk_&lt;id&gt;.&lt;secret&gt;" \\
  -H "X-Herma-Harness: opencode" \\
  -d '{{"wire_format":"chat_completions","payload":{{"model":"muse-spark-open","messages":[{{"role":"user","content":"Claim a task from the Tessera queue with fencing"}}]}}'</pre>
    </div>
    <div class="card">
      <h3>4. Sync Provisions &amp; Noun/Verb Context from Tessera or Handshake Store</h3>
      <pre>curl -fsS -X POST {base}/v1/sync/tessera \\
  -H "Content-Type: application/json" \\
  -H "X-Herma-Key: hmk_&lt;id&gt;.&lt;secret&gt;" \\
  -H "X-Herma-Harness: muse-code" \\
  -d '{{"base_url":"https://tessera.ta-amps.workers.dev","namespace":"herma.provisions"}}'</pre>
    </div>
  </main>
</body>
</html>"""
