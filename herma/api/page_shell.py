"""The one shell every Herma page shares: the document head, the thin agent banner, the header and the footer.

The words and links come from `herma/page_shell.json`, which the Worker's `page_shell.js` renders from too, and a
test keeps the two byte for byte equal. Style: Paper & Ink, light only (owner, Nov 1, 2026). The stylesheet, the
fonts and the shared banner script are static files in `herma/static/assets`, which this app serves at `/assets`
and Cloudflare serves for the Worker.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import Any

from herma.model_catalog import escape

SHELL_PATH = Path(__file__).resolve().parents[1] / "page_shell.json"
STATIC_DIR = Path(__file__).resolve().parents[1] / "static"

WORDMARK_SVG = (
    '<svg width="26" height="26" viewBox="0 0 100 100" aria-hidden="true" focusable="false">'
    '<rect x="0" y="0" width="44" height="44" rx="10" fill="var(--mark-1)"/>'
    '<rect x="56" y="0" width="44" height="44" rx="10" fill="var(--mark-2)"/>'
    '<rect x="0" y="56" width="44" height="44" rx="10" fill="var(--mark-3)"/>'
    '<rect x="56" y="56" width="44" height="44" rx="10" fill="var(--mark-4)"/></svg>'
)

AGENT_ICON_SVG = (
    '<svg class="agent-fallback-icon" viewBox="0 0 40 40" width="18" height="18" aria-hidden="true" focusable="false">'
    '<circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" stroke-width="2.6"/>'
    '<path d="M20 12v-3h-3" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>'
    '<rect x="12" y="14" width="16" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="2.6"/>'
    '<path d="M17 19v2M23 19v2" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>'
)

# The four-tile mark, as a standalone image for the tab icon (a page's CSS variables do not reach a favicon).
FAVICON_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Teleion Fabric">'
    '<rect x="0" y="0" width="44" height="44" rx="10" fill="#2A5DB0"/>'
    '<rect x="56" y="0" width="44" height="44" rx="10" fill="#B8541F"/>'
    '<rect x="0" y="56" width="44" height="44" rx="10" fill="#11161F"/>'
    '<rect x="56" y="56" width="44" height="44" rx="10" fill="#2A5DB0"/></svg>\n'
)


@cache
def shell() -> dict[str, Any]:
    """The shared contract; callers treat it as read-only."""
    raw = json.loads(SHELL_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or raw.get("schema") != "herma.page_shell.v1":
        raise ValueError("herma/page_shell.json is not a herma.page_shell.v1 contract")
    return dict(raw)


def banner_html() -> str:
    noun = shell()["banner"]
    payload = json.dumps(noun, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    return (
        '<ta-agent-banner class="agent-banner" data-site="herma">\n'
        f'<script type="application/json">{payload}</script>\n'
        f'<p class="agent-fallback">{AGENT_ICON_SVG}<span class="agent-fallback-lead">'
        f"<b>{escape(noun['lead_strong'])}</b> {escape(noun['lead'])}</span> "
        f'<a href="/llms.txt">{escape(noun["chip"])}</a></p>\n'
        "</ta-agent-banner>\n"
        f'<script src="{escape(shell()["assets"]["banner_js"])}" defer></script>'
    )


def header_html(active: str = "") -> str:
    contract = shell()
    current = ' aria-current="page"'
    items = "".join(
        f'<li><a href="{escape(item["href"])}"{current if item["key"] == active else ""}>'
        f"{escape(item['label'])}</a></li>"
        for item in contract["nav"]
    )
    link = contract["header_link"]
    byline = (
        f'<span class="byline">{escape(contract["site"]["byline"])}</span>'
        if contract["site"].get("byline")
        else ""
    )
    return (
        '<header class="site-header">\n<div class="wrap">\n'
        f'<a class="wordmark" href="/">{WORDMARK_SVG}<span>{escape(contract["site"]["name"])}</span>'
        f"{byline}</a>\n"
        f'<nav class="site-nav" aria-label="Main">\n<ul>{items}</ul>\n</nav>\n'
        f'<a class="header-link" href="{escape(link["href"])}">{escape(link["label"])}</a>\n'
        "</div>\n</header>"
    )


def footer_html() -> str:
    contract = shell()
    footer = contract["footer"]
    links = "".join(
        f'<li><a href="{escape(link["href"])}">{escape(link["label"])}</a></li>'
        for link in footer["links"]
    )
    return (
        '<footer class="site-footer">\n<div class="wrap">\n'
        f'<div class="footer-row"><a class="footer-brand" href="/">{WORDMARK_SVG}'
        f"<span>{escape(contract['site']['name'])}</span></a>\n"
        f'<nav aria-label="Site information">\n<ul>{links}</ul>\n</nav></div>\n'
        f'<p class="footer-line">{escape(footer["line"])}</p>\n'
        "</div>\n</footer>"
    )


def canonical_url(path: str) -> str:
    """The canonical address of a path on this site, as the design contract sets it: always https://herma.teleionlabs.com."""
    clean = (path or "/").split("#")[0]
    return f"{shell()['site']['origin']}{clean if clean.startswith('/') else '/' + clean}"


def document_html(
    *,
    title: str,
    main: str,
    description: str = "",
    active: str = "",
    scripts: tuple[str, ...] = (),
    canonical: str = "",
) -> str:
    """A whole page: head, banner, header, the page's own main content, footer, then its scripts."""
    contract = shell()
    canonical_link = (
        f'<link rel="canonical" href="{escape(canonical_url(canonical))}">\n' if canonical else ""
    )
    preload = "\n".join(
        f'<link rel="preload" href="{escape(href)}" as="font" type="font/woff2" crossorigin>'
        for href in contract["assets"]["preload"]
    )
    page_scripts = "\n".join(f'<script src="{escape(src)}" defer></script>' for src in scripts)
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{escape(title)} | {escape(contract["site"]["name"])}</title>
<meta name="description" content="{escape(description)}">
<meta name="color-scheme" content="only light">
{canonical_link}<link rel="icon" href="/favicon.svg" type="image/svg+xml">
{preload}
<link rel="stylesheet" href="{escape(contract["assets"]["css"])}">
</head>
<body>
<div role="navigation" aria-label="Skip links"><a class="skip-link" href="#main">Skip to content</a></div>
{banner_html()}
{header_html(active)}
<main id="main">
{main}
</main>
{footer_html()}
{page_scripts}
</body>
</html>
"""
