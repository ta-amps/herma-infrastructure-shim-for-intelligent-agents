"""Herma's public pages: light only, one shell, plain words (owner rules of Nov 1, 2026, including rule 13).

Everything the pages share lives in `herma/page_shell.json`, `herma/static/assets` and the two shell renderers
(`herma/api/page_shell.py` and `deploy/cloudflare/page_shell.js`). These tests keep the two runtimes byte for byte
equal and check every page, rendered from small fixtures, against the rules. The browser half of the light rule is
`scripts/light_check.mjs` (`make light-check`); one test here proves that script really fails on dark pages.

The banned words come from the ONE shared list, read from outside this repository (rule 16); this file spells none. The
mechanics are tested on the made-up list in tests/fixtures; the real list is exercised by the release gate (`make gate`).
"""

from __future__ import annotations

import html
import json
import re
import shutil
import subprocess
import sys
import textwrap
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from typing import Any

import pytest

from herma.api import page_shell
from herma.api.pages import render_connect_page, render_overview_page
from herma.api.site_pages import render_get_started_page, render_home_page, render_trust_page

REPO_ROOT = Path(__file__).resolve().parents[1]
CSS_PATH = REPO_ROOT / "herma/static/assets/herma-pages.css"
MADE_UP_LIST = REPO_ROOT / "tests/fixtures/made-up-banned-words.json"
MADE_UP_NEUTRAL = REPO_ROOT / "tests/fixtures/made-up-neutral-names.json"
AGENT_APPS = ("nano" + "muse", "muse" + " code")
STAMPS = ("PLANNED", "Not yet", "Layout preview", "COMING SOON", "Not ready yet")
NAV_LABELS = ["Dashboard", "Get started", "Search", "Trust & safety"]
FOOTER_SPEC = json.loads((REPO_ROOT / "tests/fixtures/footer.v2.json").read_text(encoding="utf-8"))


def run_node(script: str, timeout: int = 120) -> str:
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    assert result.returncode == 0, result.stderr[-2000:]
    return result.stdout


@pytest.fixture(scope="module")
def worker_site() -> dict[str, Any]:
    """Every redesigned page and script, rendered by the Worker's own modules from the fixtures."""
    out = run_node(
        """
        import { renderSite } from "./scripts/page_fixtures_server.mjs";
        const site = await renderSite();
        console.log(JSON.stringify({ pages: site.pages, scripts: site.scripts }));
        """
    )
    return json.loads(out)


@pytest.fixture(scope="module")
def python_pages() -> dict[str, str]:
    return {
        "/": render_home_page(),
        "/shim": render_overview_page(
            [], [], "https://shim.teleionlabs.com", [], aggregate_counts=None
        ),
        "/connect": render_connect_page("https://shim.teleionlabs.com"),
        "/get-started": render_get_started_page(),
        "/trust": render_trust_page(),
    }


def all_pages(worker_site: dict[str, Any], python_pages: dict[str, str]) -> dict[str, str]:
    pages = {f"worker {route}": html for route, html in worker_site["pages"].items()}
    pages.update({f"python {route}": html for route, html in python_pages.items()})
    return pages


def visible_text(html: str) -> str:
    """What a reader sees and a grep over the page would find: no scripts, styles or the banner's data."""
    html = re.sub(r"<(script|style)\b.*?</\1>", " ", html, flags=re.S)
    html = re.sub(r"<ta-agent-banner.*?</ta-agent-banner>", " ", html, flags=re.S)
    html = re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"\s+", " ", html.replace("&amp;", "&").replace("&#39;", "'"))


# ---------------------------------------------------------------------------------------------------------------
# The stylesheet and the shared files
# ---------------------------------------------------------------------------------------------------------------


def test_asset_versions_in_the_shell_are_current() -> None:
    result = subprocess.run(
        [sys.executable, "scripts/build_page_assets.py", "--check"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr


def test_stylesheet_is_light_only_and_text_is_never_small() -> None:
    css = CSS_PATH.read_text(encoding="utf-8")
    assert "prefers-color-scheme" not in css, "a dark-scheme palette must never come back"
    assert re.search(r":root\s*\{\s*color-scheme:\s*only light;", css), "the root pins only light"
    assert {v.strip() for v in re.findall(r"color-scheme:\s*([^;}]+)", css)} == {"only light"}
    for dark in ("#0c1017", "#0f131a", "#0d1117", "#0b0f16", "#1b2230", "#131a24"):
        assert dark not in css.lower(), f"the old dark navy {dark} is gone for good"
    # Every literal font size is at least 14 px (0.875rem); mono text may be 13 px (0.8125rem).
    for size in re.findall(r"font-size:\s*([0-9.]+)(rem|px)", css):
        value = float(size[0]) * (16 if size[1] == "rem" else 1)
        assert value >= 13, f"font-size {size[0]}{size[1]} is below the 13 px floor"
    for font in re.findall(r'url\("(fonts/[^"]+)"\)', css):
        assert (CSS_PATH.parent / font).is_file(), font


def test_the_shared_banner_script_is_the_one_eranos_and_agora_ship() -> None:
    script = (REPO_ROOT / "herma/static/assets/agent-banner.js").read_bytes()
    assert b"ta-agent-banner" in script and len(script) > 10000
    licences = sorted(p.name for p in (CSS_PATH.parent / "fonts").glob("OFL-*.txt"))
    assert licences == ["OFL-IBMPlexSans.txt", "OFL-JetBrainsMono.txt", "OFL-SpaceGrotesk.txt"]


# ---------------------------------------------------------------------------------------------------------------
# The shell: the same bytes from both runtimes, one row of footer links, light only
# ---------------------------------------------------------------------------------------------------------------


def test_python_and_worker_shells_are_byte_identical() -> None:
    out = json.loads(
        run_node(
            """
            import { bannerHtml, headerHtml, footerHtml, documentHtml, FAVICON_SVG } from "./deploy/cloudflare/page_shell.js";
            const keys = ["overview", "connect", "starter", "prompts", "dashboard", ""];
            console.log(JSON.stringify({
              banner: bannerHtml(),
              headers: keys.map((k) => headerHtml(k)),
              footer: footerHtml(),
              favicon: FAVICON_SVG,
              document: documentHtml({ title: "T & U", description: "D \\"q\\"", active: "dashboard", main: "<p>x</p>", scripts: ["/a.js", "/b.js"] }),
            }));
            """
        )
    )
    assert out["banner"] == page_shell.banner_html()
    keys = ["overview", "connect", "starter", "prompts", "dashboard", ""]
    assert out["headers"] == [page_shell.header_html(k) for k in keys]
    assert out["footer"] == page_shell.footer_html()
    assert out["favicon"] == page_shell.FAVICON_SVG
    assert out["document"] == page_shell.document_html(
        title="T & U",
        description='D "q"',
        active="dashboard",
        main="<p>x</p>",
        scripts=("/a.js", "/b.js"),
    )


def test_footer_is_the_shared_standard_one_row_of_links_and_one_short_line() -> None:
    """MUST-FOLLOW rule 13 and footer v2 (claude-design-components.v2.json): the brand and one row of links, then one short line."""
    footer = page_shell.footer_html()
    assert footer.count("<ul>") == 1 and footer.count("<nav") == 1, "never two rows of links"
    assert footer.count('class="footer-brand"') == 1 and "<span>Teleion Fabric</span>" in footer
    assert FOOTER_SPEC["schema"] == "ta-amps.footer/2"
    found = re.findall(r'<li><a href="([^"]+)">([^<]+)</a></li>', footer)
    assert [(label, href) for href, label in found] == [
        (link["label"], link["href"]) for link in FOOTER_SPEC["links"]
    ]
    # A link to another host is absolute and carries the mark; a link on this host is a relative path with no mark.
    for link in FOOTER_SPEC["links"]:
        external = link["href"].startswith("https://")
        assert external == link["external"] == link["label"].endswith(" \u2197"), link
    assert [label for _href, label in found][-1] == "For agents" and found[-1][0] == "/llms.txt"
    lines = re.findall(r'<p class="footer-line">([^<]+)</p>', footer)
    assert lines == [FOOTER_SPEC["line"]] and len(lines[0]) < 100, "one short line"
    assert lines[0].endswith("We don\u2019t accept private information at this stage.")
    assert "github.com" not in footer


def test_header_has_the_banner_above_the_nav_and_marks_the_page() -> None:
    document = page_shell.document_html(title="T", main="<h1>T</h1>", active="dashboard")
    assert document.index("<ta-agent-banner") < document.index('<header class="site-header">')
    nav_labels = re.findall(
        r'<li><a href="[^"]+"(?: aria-current="page")?>([^<]+)</a></li>',
        page_shell.header_html("dashboard"),
    )
    assert [html.unescape(label) for label in nav_labels] == NAV_LABELS
    assert page_shell.header_html("dashboard").count('aria-current="page"') == 1
    assert '<meta name="color-scheme" content="only light">' in document


# ---------------------------------------------------------------------------------------------------------------
# Every page
# ---------------------------------------------------------------------------------------------------------------


def test_every_page_carries_the_shell_and_stays_light(
    worker_site: dict[str, Any], python_pages: dict[str, str]
) -> None:
    pages = all_pages(worker_site, python_pages)
    assert len(pages) >= 14
    for name, page in pages.items():
        assert '<meta name="color-scheme" content="only light">' in page, name
        assert "<ta-agent-banner" in page and '<header class="site-header">' in page, name
        assert '<footer class="site-footer">' in page and ">For agents</a>" in page, name
        assert '<main id="main">' in page and 'href="#main"' in page, name
        assert page.count("<h1") == 1, name
        assert "prefers-color-scheme" not in page, name
        assert not re.search(r"\sstyle=", page), (
            f"{name}: no inline styles (the stylesheet carries them)"
        )
        assert "<style" not in page, name
        inline_scripts = re.findall(r"<script(?![^>]*\bsrc=)(?![^>]*application/json)[^>]*>", page)
        assert not inline_scripts, f"{name}: no inline scripts"
        for link in re.findall(r'(?:src|href)="(https?://[^"]+)"', page):
            assert re.match(
                r"https://(agora\.eranosforgood\.org|eranosforgood\.org|teleionlabs\.com|shim\.teleionlabs\.com|fabric\.teleionlabs\.com|herma\.teleionlabs\.com)/",
                link,
            ), (
                name,
                link,
            )


def test_home_get_started_and_trust_are_the_same_in_both_runtimes() -> None:
    """The words are one content Task Object (herma/page_content.json); both renderers must produce the same page from it."""
    worker = json.loads(
        run_node(
            """
            import { renderGetStartedHtml, renderHomeHtml, renderTrustHtml } from "./deploy/cloudflare/site_pages.js";
            console.log(JSON.stringify({ home: renderHomeHtml(null), start: renderGetStartedHtml(), trust: renderTrustHtml() }));
            """
        )
    )
    assert worker["home"] == render_home_page()
    assert worker["start"] == render_get_started_page()
    assert worker["trust"] == render_trust_page()


def test_the_home_says_what_herma_is_and_shows_today_s_numbers(worker_site: dict[str, Any]) -> None:
    """Design contract: one line, two ways in, the five dashboard totals as plain numbers, no version in the heading."""
    home = worker_site["pages"]["/"]
    text = visible_text(home)
    assert home.count("<h1>Teleion Fabric</h1>") == 1
    assert (
        "The shim between any agent and its model. It brings the right Task Objects as context, or answers directly."
        in text
    )
    assert "For people" in text and "For agents" in text
    for label in ("Workers", "Nonprofit Tasks", "Shared Tasks", "Task Objects", "Checks"):
        assert label in text, label
    assert (
        "285" in text
        and "12 waiting" in text
        and "31 agent names" in text
        and "624 searchable entries" in text
    )
    assert not re.search(r"\bv?\d+\.\d+\.\d+\b", re.search(r"<h1>.*?</h1>", home, re.S).group(0))  # type: ignore[union-attr]
    assert "Try the shim" in text and 'href="/shim"' in home


def test_get_started_names_the_canonical_instructions_and_the_map_choice(
    worker_site: dict[str, Any],
) -> None:
    page = worker_site["pages"]["/get-started"]
    text = visible_text(page)
    assert page.count("Step ") == 3 and "https://shim.teleionlabs.com/llms.txt" in text
    assert "show_on_map" in text and "never by IP address or home" in text
    assert "We don\u2019t accept private information at this stage." in text
    assert 'href="https://eranosforgood.org/help"' in page and 'href="/prompts"' in page
    trust = visible_text(worker_site["pages"]["/trust"])
    assert (
        "The worker that makes something never checks it" in trust and "Report a problem" in trust
    )


def test_every_existing_page_names_the_canonical_host(
    worker_site: dict[str, Any], python_pages: dict[str, str]
) -> None:
    """Design contract of Nov 2: whichever host a page is reached on, rel=canonical names shim.teleionlabs.com."""
    pages = all_pages(worker_site, python_pages)
    for name, page in pages.items():
        route = name.split(" ", 1)[1]
        links = re.findall(r'<link rel="canonical" href="([^"]+)">', page)
        if route in ("/c/nothing_here", "/w/w_missing"):
            assert links == [], f"{name}: a page that was not found has no canonical address"
            continue
        assert len(links) == 1 and links[0].startswith("https://shim.teleionlabs.com/"), (
            name,
            links,
        )
    contribution = pages["worker /c/verb_evl_d900e706b470"]
    assert 'rel="canonical" href="https://shim.teleionlabs.com/c/' in contribution


def test_every_page_uses_plain_words(
    worker_site: dict[str, Any], python_pages: dict[str, str]
) -> None:
    """The rules live in scripts/release_gate.mjs (the deploy-time gate); every page here goes through them."""
    pages = all_pages(worker_site, python_pages)
    result = subprocess.run(
        ["node", "--no-warnings", "scripts/release_gate.mjs", "--pages"],
        cwd=REPO_ROOT,
        input=json.dumps(pages),
        capture_output=True,
        text=True,
        check=True,
    )
    found = json.loads(result.stdout)
    assert {name: problems for name, problems in found.items() if problems} == {}
    for name, page in pages.items():
        text = visible_text(page)
        assert "\u2014" not in page, f"{name}: no em dashes"
        for stamp in STAMPS:
            assert stamp not in text, name
        assert not re.search(r"\bIdea\b", text), name
        for app in AGENT_APPS[:1]:
            assert app not in text.lower(), f"{name}: agent apps appear only on Models used"


def test_pages_name_the_model_and_link_the_record_instead_of_hashes(
    worker_site: dict[str, Any],
) -> None:
    pages = worker_site["pages"]
    dashboard = pages["/dashboard"]
    assert "Muse Spark 1.3 through the Meta API" in dashboard
    for route in ("/dashboard", "/prompts", "/starter"):
        assert (
            'href="https://agora.eranosforgood.org/models/">Models used &#8599;</a>' in pages[route]
        ), route
    assert "Models used ↗" in pages["/shim"], "the shim page's models section links it too"
    assert "Record &#8599;" in dashboard and "?format=json" in dashboard
    assert (
        "A connected AI" in visible_text(dashboard)
    )  # an agent that is not on the operator's list may be anyone's, so it is not called a volunteer
    contribution = pages["/c/verb_evl_d900e706b470"]
    assert (
        "Record &#8599;" in contribution and "/c/verb_evl_d900e706b470?format=json" in contribution
    )
    worker = pages["/w/w_agent_muse-worker-01"]
    assert "Evidence cred" in worker and "Unblocker" in worker
    starter = visible_text(pages["/starter"])
    assert "Muse Spark 1.3 through the Meta API" in starter
    prompts = visible_text(pages["/prompts"])
    assert "We don't accept private information at this stage." in prompts
    assert "Links: your contribution" in prompts and "Next turn:" in prompts
    # The instruction, in the public words of the prompts page: show the links and nothing else from the record.
    assert "Show the links only, nothing else from the record" in prompts
    # Its intent, whatever the wording: no prompt asks an agent to print a hash, a receipt or a record's body to a person.
    asks_to_print = re.findall(
        r"\b(?:print|show|output|paste|display|include)\b[^.]{0,60}\b(?:hash(?:es)?|sha-?256|receipts?|record bod(?:y|ies)|payload_json)\b",
        prompts,
        flags=re.I,
    )
    assert asks_to_print == [], asks_to_print


def test_worker_written_text_is_filtered_by_the_list_and_the_original_stays_in_the_record() -> None:
    """The display filter's mechanics, on the made-up list: replacements, order, ellipsis fallback, private names by hash."""
    corpus = [
        "Audit (verb_evl_f550d8794064, verb_own_b4e012efd371, verb_own_564830af3d51",
        "See w_musehermawor_8ffbf268 and 969951471abf3c now",
        "A zorptest run of plorps and a Plorp with a quux-256 sum",
        "Served by glimbo cloud, then glimbo, with wumpusapp",
        "A snarfling pass by Fnorbleton, not Fnorbletons",
        "Whim",
        "A whim",
        "one" + chr(0x2014) + "two",
        "x" * 400,
    ]
    out = json.loads(
        run_node(
            f"""
            import {{ readList, displayRules, groups }} from "./scripts/banned_list.mjs";
            import {{ buildTidy }} from "./deploy/cloudflare/page_shell.js";
            process.env.BANNED_WORDS_LIST = {json.dumps(str(MADE_UP_LIST))};
            process.env.BANNED_NEUTRAL_NAMES = {json.dumps(str(MADE_UP_NEUTRAL))};
            const {{ list, neutral }} = readList();
            const tidy = buildTidy({{ displayRules: displayRules(list, neutral), privateSha256: groups(list).privateSha256 }});
            console.log(JSON.stringify({json.dumps(corpus)}.map((c) => tidy(c, 120))));
            """
        )
    )
    assert out[:8] == [
        "Audit",
        "See \u2026 and \u2026 now",
        "A example run of Widgets and a Widget with a checksum sum",
        "Served by a hosted thing, then a thing, with an agent app",
        "A \u2026 pass by \u2026, not Fnorbletons",
        "Note",
        "A whim",
        "one--two",
    ]
    assert len(out[8]) <= 121


def test_no_script_a_browser_receives_carries_the_word_rules() -> None:
    """The rules and the private-name hashes stay on the server: no script, page or static asset holds them."""
    offenders = json.loads(
        run_node(
            """
            import fs from "node:fs";
            import BANNED from "./deploy/cloudflare/banned_words.generated.js";
            import { renderSite } from "./scripts/page_fixtures_server.mjs";
            import { renderDashboardJs } from "./deploy/cloudflare/dashboard_and_permalinks.js";
            const site = await renderSite();
            const served = { ...site.scripts, ...site.pages, "dashboard.js": renderDashboardJs() };
            for (const f of fs.readdirSync("herma/static/assets")) {
              if (/\\.(js|css|html|json)$/.test(f)) served["assets/" + f] = fs.readFileSync("herma/static/assets/" + f, "utf8");
            }
            const needles = [...BANNED.displayRules.map((r) => r.re), ...BANNED.privateSha256, "displayRules", "privateSha256", "TIDY_RULES"];
            const offenders = [];
            for (const [name, text] of Object.entries(served)) {
              needles.forEach((needle, i) => { if (needle && String(text).includes(needle)) offenders.push(name + " holds rule " + i); });
            }
            console.log(JSON.stringify(offenders));
            """
        )
    )
    assert offenders == []


# ---------------------------------------------------------------------------------------------------------------
# The light check really fails on dark pages
# ---------------------------------------------------------------------------------------------------------------

GOOD = '<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="only light">{extra}<style>:root{{color-scheme:only light}}body{{background:#F5F2EA;margin:0}}{css}</style></head><body>{body}</body></html>'
BAD_PAGES = {
    "good.html": ("", "", '<p>fine</p><a style="display:inline-block">x</a>', True),
    "ink-button.html": (
        "",
        ".b{background:#11161F;color:#F5F2EA;display:inline-block;padding:10px 20px}",
        '<a class="b">A dark button is allowed</a>',
        True,
    ),
    "plain-light-meta.html": ("", "", "<p>x</p>", False),
    "dark-panel.html": ("", ".p{background:#11161F;height:300px}", '<div class="p"></div>', False),
    # A 36 px ink banner is only 4.5% of the screen, so the area rule alone misses it; the band rule (wider than half the screen,
    # taller than 8 px) is the one the live watchdog uses, and an ink link or button across the page stays allowed.
    "dark-band.html": ("", ".b{background:#11161F;height:36px}", '<div class="b"></div>', False),
    "ink-link-band.html": (
        "",
        ".b{display:block;background:#11161F;color:#F5F2EA;height:40px;padding:8px}",
        '<a class="b" href="#main">An ink link across the page is allowed</a>',
        True,
    ),
    "dark-media.html": (
        "",
        "@media (prefers-color-scheme: dark){body{background:#0c1017}}",
        "<p>x</p>",
        False,
    ),
    "dark-canvas.html": (
        "",
        "",
        '<canvas id="c" width="1000" height="400"></canvas><script>var c=document.getElementById("c").getContext("2d");c.fillStyle="#0b0e14";c.fillRect(0,0,1000,400)</script>',
        False,
    ),
}


@pytest.fixture(scope="module")
def bad_site(tmp_path_factory: pytest.TempPathFactory) -> Any:
    root = tmp_path_factory.mktemp("light_site")
    for name, (extra, css, body, _ok) in BAD_PAGES.items():
        page = GOOD.format(extra=extra, css=css, body=body)
        if name == "plain-light-meta.html":
            page = page.replace('content="only light"', 'content="light"')
        (root / name).write_text(page, encoding="utf-8")

    class Quiet(SimpleHTTPRequestHandler):
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            super().__init__(*args, directory=str(root), **kwargs)

        def log_message(self, *_args: Any) -> None:
            return None

    server = ThreadingHTTPServer(("127.0.0.1", 0), Quiet)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


@pytest.mark.skipif(shutil.which("node") is None, reason="node is needed for the light check")
def test_the_light_check_fails_on_every_kind_of_dark_page(bad_site: str) -> None:
    for name, (_extra, _css, _body, should_pass) in BAD_PAGES.items():
        result = subprocess.run(
            ["node", "scripts/light_check.mjs", "--base", bad_site, "--routes", f"/{name}"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=600,
            check=False,
        )
        assert (result.returncode == 0) is should_pass, f"{name}\n{result.stdout}{result.stderr}"
    result = subprocess.run(
        [
            "node",
            "scripts/light_check.mjs",
            "--base",
            bad_site,
            "--routes",
            "/dark-media.html,/dark-panel.html,/dark-band.html,/dark-canvas.html,/plain-light-meta.html",
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=900,
        check=False,
    )
    assert result.returncode == 1
    for message in (
        "dark-scheme media query",
        "opaque dark panel",
        "opaque dark band",
        "drawn dark",
        'must be "only light"',
    ):
        assert message in result.stdout, message


def test_the_light_check_passes_on_every_redesigned_page() -> None:
    result = subprocess.run(
        ["node", "scripts/light_check.mjs"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=1200,
        check=False,
    )
    assert result.returncode == 0, textwrap.shorten(result.stdout + result.stderr, 1500)
    assert "light check passed" in result.stdout


def test_the_fixture_pages_are_served_with_the_workers_real_page_policy() -> None:
    """A blocked script, style or font must show up in the browser checks, so they use the Worker's own policy."""
    worker = (REPO_ROOT / "deploy/cloudflare/worker.js").read_text(encoding="utf-8")
    block = re.search(r"const DEFAULT_CSP_PAGE = \[(.*?)\]\.join\(\"; \"\)", worker, re.S)
    assert block, "DEFAULT_CSP_PAGE moved"
    policy = "; ".join(re.findall(r'"([^"]+)"', block.group(1)))
    served = (REPO_ROOT / "scripts/page_fixtures_server.mjs").read_text(encoding="utf-8")
    fixtures = re.search(r'export const PAGE_CSP = "([^"]+)"', served)
    assert fixtures and fixtures.group(1) == policy
    # Fonts, the stylesheet and the banner script are same-origin, so the policy needs no loosening for them.
    assert "font-src" not in policy and "default-src 'self'" in policy
