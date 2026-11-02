"""The pages that are not the dashboard or a record: the home, Get started and Trust & safety.

Their words are a content Task Object (herma/page_content.json), shared with the Worker (deploy/cloudflare/site_pages.js), and a
test keeps the two renderers byte for byte equal. The Worker adds live numbers to the home; this app has no queue to read, so its
home has none.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import Any

from herma.api.page_shell import document_html, shell
from herma.model_catalog import escape

CONTENT_PATH = Path(__file__).resolve().parents[1] / "page_content.json"


@cache
def content() -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads(CONTENT_PATH.read_text(encoding="utf-8"))
    return loaded


def _anchor(label: str, href: str, external: bool = False) -> str:
    cls = ' class="link-out"' if external else ""
    mark = " &#8599;" if external else ""
    return f'<a{cls} href="{escape(href)}">{escape(label)}{mark}</a>'


def _models_used_link() -> str:
    href = escape(shell()["site"]["models_used"])
    return f'<a class="link-out" href="{href}">Models used &#8599;</a>'


def render_home_page() -> str:
    c = content()["home"]
    cards = []
    for ci, card in enumerate(c["cards"]):
        links = "".join(
            f'<a class="{"btn" if ci == 0 and i == 0 else "btn-quiet"}" href="{escape(href)}">{escape(label)}</a>'
            for i, (label, href) in enumerate(card["links"])
        )
        cards.append(
            f'<div class="card"><h2 class="card-title">{escape(card["title"])}</h2>'
            f'<p>{escape(card["text"])}</p><div class="row">{links}</div></div>'
        )
    cards_html = "\n".join(cards)
    main = f"""<div class="wrap page-head">
<h1>{escape(c["h1"])}</h1>
<p class="lead">{escape(c["line"])}</p>
</div>
<div class="wrap">
<section class="section" aria-label="Two ways in">
<div class="cards">
{cards_html}
</div>
</section>

</div>"""
    return document_html(
        title=c["title"], description=c["description"], active="", canonical="/", main=main
    )


def render_get_started_page() -> str:
    c = content()["get_started"]
    origin = shell()["site"]["origin"]
    steps = "\n".join(
        f'<div class="card"><span class="kicker"><span class="kicker-dot"></span>Step {i + 1}</span>'
        f'<h2 class="card-title">{escape(s["title"])}</h2>'
        f"<p>{escape(s['text'].replace('{origin}', origin))}</p></div>"
        for i, s in enumerate(c["steps"])
    )
    more = "".join(
        f"<li>{_anchor(label, href, bool(external))}</li>"
        for label, href, external in c["then_links"]
    )
    main = f"""<div class="wrap page-head">
<span class="kicker"><span class="kicker-dot"></span>{escape(c["kicker"])}</span>
<h1>{escape(c["h1"])}</h1>
<p class="lead">{escape(c["lead"])}</p>
<div class="row"><a class="btn" href="/prompts">{escape(c["then_links"][0][0])}</a>{_models_used_link()}</div>
</div>
<div class="wrap">
<section class="section" aria-label="The three steps">
<div class="cards">
{steps}
</div>
</section>
<section class="section" aria-labelledby="then-h">
<h2 id="then-h">{escape(c["then_title"])}</h2>
<ul class="plain-list">{more}</ul>
<p class="hint">{escape(c["privacy"])}</p>
</section>
</div>"""
    return document_html(
        title=c["title"],
        description=c["description"],
        active="getstarted",
        canonical="/get-started",
        main=main,
    )


def render_trust_page() -> str:
    c = content()["trust"]
    cards = "\n".join(
        f'<div class="card"><h2 class="card-title">{escape(card["title"])}</h2><p>{escape(card["text"])}</p></div>'
        for card in c["cards"]
    )
    main = f"""<div class="wrap page-head">
<span class="kicker"><span class="kicker-dot"></span>{escape(c["kicker"])}</span>
<h1>{escape(c["h1"])}</h1>
<p class="lead">{escape(c["lead"])}</p>
</div>
<div class="wrap">
<section class="section" aria-label="The rules">
<div class="cards">
{cards}
</div>
</section>
<section class="section" aria-labelledby="report-h">
<h2 id="report-h">{escape(c["report"][0])}</h2>
<p>{_anchor("Open the Eranos report form", c["report"][1], True)}</p>
</section>
</div>"""
    return document_html(
        title=c["title"],
        description=c["description"],
        active="trust",
        canonical="/trust",
        main=main,
    )
