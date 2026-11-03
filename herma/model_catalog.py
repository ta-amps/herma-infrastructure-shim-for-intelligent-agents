"""The Meta model catalog: one data file that pages, discovery text and routing checks all read.

`model_catalog.json` is the single list of Meta models Herma names in public, with a one-line use for
each and whether Herma routes to it. The Worker imports the same file, so what a page says matches
what the code does. Nothing here makes a network call, and a contributor-tier id can never be listed.
"""

from __future__ import annotations

import html
import json
from functools import cache
from pathlib import Path
from typing import Any

CATALOG_PATH = Path(__file__).with_name("model_catalog.json")
HEADING = "Which Meta Models Do What"
TABLE_HEAD = (
    '<tr><th scope="col">Model</th><th scope="col">What it\'s for</th>'
    '<th scope="col">Does the shim route to it?</th></tr>'
)


def escape(value: object) -> str:
    """Escape text exactly as the Worker's `esc` does, so both runtimes render the same bytes."""
    return html.escape(str(value), quote=True).replace("&#x27;", "&#39;")


@cache
def load_catalog() -> dict[str, Any]:
    """The validated catalog. Callers must treat the returned mapping as read-only."""
    raw = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    models = raw.get("models") if isinstance(raw, dict) else None
    if not isinstance(models, list) or not models:
        raise ValueError("the model catalog must hold a non-empty models list")
    for model in models:
        ident = model.get("id")
        if ident is not None and (not isinstance(ident, str) or "contributor" in ident.lower()):
            raise ValueError("the model catalog may not list a contributor-tier id")
        if not isinstance(model.get("name"), str) or not isinstance(model.get("routed"), bool):
            raise ValueError("every catalog model needs a name and a routed flag")
    if "harness_note" in raw:
        raise ValueError("agent apps are listed only on the shared Models used page")
    for key in ("routing_note", "models_used_url"):
        if not isinstance(raw.get(key), str) or not raw[key]:
            raise ValueError(f"the model catalog needs {key}")
    return dict(raw)


def routed_model_ids() -> frozenset[str]:
    """Meta API ids that Herma routes to."""
    return frozenset(
        str(model["id"]) for model in load_catalog()["models"] if model["routed"] and model["id"]
    )


def listed_model_ids() -> frozenset[str]:
    """Every Meta API id the catalog names, routed or not."""
    return frozenset(str(model["id"]) for model in load_catalog()["models"] if model["id"])


def render_models_section() -> str:
    """The home page section, with no whitespace between tags so both runtimes match byte for byte."""
    catalog = load_catalog()
    rows = []
    for model in catalog["models"]:
        ident = (
            f'<span class="cell-sub"><code>{escape(model["id"])}</code></span>'
            if model["id"]
            else ""
        )
        evidence = (
            f'<span class="cell-sub">{escape(model["evidence"])}</span>'
            if model.get("evidence")
            else ""
        )
        rows.append(
            f"<tr><td><strong>{escape(model['name'])}</strong>{ident}</td>"
            f"<td>{escape(model['use'])}{evidence}</td>"
            f"<td>{escape(model['route'])}</td></tr>"
        )
    models_used = (
        '<p class="hint">See '
        f'<a href="{escape(catalog["models_used_url"])}">Models used ↗</a> for the full list.</p>'
    )
    return (
        f'<h2 id="models-h">{HEADING}</h2>'
        f'<p class="hint">{escape(catalog["routing_note"])}</p>'
        '<div class="table-wrap" tabindex="0" role="region" aria-label="Meta models, scrollable table">'
        '<table class="data"><caption class="sr-only">Meta models and whether Teleion Fabric\'s model shim routes to them</caption>'
        f"<thead>{TABLE_HEAD}</thead><tbody>{''.join(rows)}</tbody></table></div>"
        f"{models_used}"
    )


def models_text() -> str:
    """The same catalog as Markdown lines for llms-full.txt."""
    catalog = load_catalog()
    lines = [f"## {HEADING}", catalog["routing_note"], ""]
    for model in catalog["models"]:
        ident = f" (`{model['id']}`)" if model["id"] else ""
        evidence = f" {model['evidence']}" if model.get("evidence") else ""
        lines.append(
            f"- {model['name']}{ident}: {model['use']}{evidence} Shim routing: {model['route']}"
        )
    lines += ["", f"See Models used for the full list: {catalog['models_used_url']}"]
    return "\n".join(lines)
