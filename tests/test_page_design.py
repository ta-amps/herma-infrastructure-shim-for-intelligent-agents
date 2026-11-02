"""Herma's public pages: light only, one shell, plain words (owner rules of Nov 1, 2026, including rule 13).

Everything the pages share lives in `herma/page_shell.json`, `herma/static/assets` and the two shell renderers
(`herma/api/page_shell.py` and `deploy/cloudflare/page_shell.js`). These tests keep the two runtimes byte for byte
equal and check every page, rendered from small fixtures, against the rules. The browser half of the light rule is
`scripts/light_check.mjs` (`make light-check`); one test here proves that script really fails on dark pages.

Banned words are written in pieces, so this file never contains them itself.
"""

from __future__ import annotations

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

REPO_ROOT = Path(__file__).resolve().parents[1]
CSS_PATH = REPO_ROOT / "herma/static/assets/herma-pages.css"
RETIRED = "l" + "lama"
BANNED_WORD = "syn" + "thetic"
AGENT_APPS = ("nano" + "muse", "muse" + " code")
STAMPS = ("PLANNED", "Not yet", "Layout preview", "COMING SOON", "Not ready yet")
NAV_LABELS = ["Overview", "Connect", "Starter kit", "Prompts", "Dashboard"]
FOOTER_LABELS = ["Models used ↗", "Agora ↗", "Eranos ↗", "Status", "Source ↗"]


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
        "/": render_overview_page(
            [], [], "https://herma.ta-amps.workers.dev", [], aggregate_counts=None
        ),
        "/connect": render_connect_page("https://herma.ta-amps.workers.dev"),
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


def test_footer_is_one_row_of_links_and_one_short_line() -> None:
    footer = page_shell.footer_html()
    assert footer.count("<ul>") == 1 and footer.count("<nav") == 1, "never two rows of links"
    labels = re.findall(r"<li><a [^>]*>([^<]+)</a></li>", footer)
    assert labels == FOOTER_LABELS
    lines = re.findall(r'<p class="footer-line">([^<]+)</p>', footer)
    assert len(lines) == 1 and len(lines[0]) < 100, "one short line"
    assert 'href="https://agora.ta-amps.workers.dev/models/"' in footer
    assert "ta-amps.workers.dev" in footer and "github.com" not in footer


def test_header_has_the_banner_above_the_nav_and_marks_the_page() -> None:
    document = page_shell.document_html(title="T", main="<h1>T</h1>", active="dashboard")
    assert document.index("<ta-agent-banner") < document.index('<header class="site-header">')
    nav_labels = re.findall(
        r'<li><a href="[^"]+"(?: aria-current="page")?>([^<]+)</a></li>',
        page_shell.header_html("dashboard"),
    )
    assert nav_labels == NAV_LABELS
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
    for name, html in pages.items():
        assert '<meta name="color-scheme" content="only light">' in html, name
        assert "<ta-agent-banner" in html and '<header class="site-header">' in html, name
        assert '<footer class="site-footer">' in html and "Models used ↗" in html, name
        assert '<main id="main">' in html and 'href="#main"' in html, name
        assert html.count("<h1") == 1, name
        assert "prefers-color-scheme" not in html, name
        assert not re.search(r"\sstyle=", html), (
            f"{name}: no inline styles (the stylesheet carries them)"
        )
        assert "<style" not in html, name
        inline_scripts = re.findall(r"<script(?![^>]*\bsrc=)(?![^>]*application/json)[^>]*>", html)
        assert not inline_scripts, f"{name}: no inline scripts"
        for link in re.findall(r'(?:src|href)="(https?://[^"]+)"', html):
            assert re.match(r"https://(agora|eranos|herma)\.ta-amps\.workers\.dev/", link), (
                name,
                link,
            )


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
    for name, html in pages.items():
        text = visible_text(html)
        assert "\u2014" not in html, f"{name}: no em dashes"
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
    assert "Record &#8599;" in dashboard and "?format=json" in dashboard
    assert "A volunteer's AI" in visible_text(dashboard)
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
    assert "Links: your contribution" in prompts and "never print hashes" in prompts


def test_worker_written_text_is_tidied_but_the_original_stays_in_the_record() -> None:
    corpus = [
        "Audit (verb_evl_f550d8794064, verb_own_b4e012efd371, verb_own_564830af3d51",
        "See w_musehermawor_8ffbf268 and 969951471abf3c now",
        "Receipt SHA-256 of the nouns and verbs of a "
        + BANNED_WORD
        + " run with "
        + RETIRED.title()
        + " 3.2",
        "muse-herma-worker_obj_1793540120302_0 built in "
        + AGENT_APPS[0].title()
        + " and "
        + AGENT_APPS[1].title(),
        "x" * 400,
    ]
    out = json.loads(
        run_node(
            f"""
            import {{ tidyText, TIDY_RULES }} from "./deploy/cloudflare/page_shell.js";
            import {{ renderDashboardJs }} from "./deploy/cloudflare/dashboard_and_permalinks.js";
            const corpus = {json.dumps(corpus)};
            const script = renderDashboardJs();
            const start = script.indexOf("function tidy(value, max) {{");
            const end = script.indexOf("function humanize", start);
            const RULES = TIDY_RULES;
            const client = new Function("RULES", script.slice(start, end) + "; return tidy;")(RULES);
            console.log(JSON.stringify({{
              server: corpus.map((c) => tidyText(c, 120)),
              client: corpus.map((c) => client(c, 120)),
              embedded: script.includes(JSON.stringify(TIDY_RULES)),
            }}));
            """
        )
    )
    assert out["embedded"], "the browser script embeds the very same rules the server uses"
    assert out["server"] == out["client"], "the browser and the server tidy text the same way"
    first, second, third, fourth, fifth = out["server"]
    assert first == "Audit"
    assert second == "See … and … now"
    for banned in (RETIRED, BANNED_WORD, "receipt", "sha", "nouns", "verbs"):
        assert banned not in third.lower()
    assert "Task Objects and Tasks" in third and "an older model" in third and "example" in third
    assert "_…_" in fourth and "an agent app" in fourth and AGENT_APPS[0] not in fourth.lower()
    assert len(fifth) <= 121


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
            timeout=180,
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
            "/dark-media.html,/dark-panel.html,/dark-canvas.html,/plain-light-meta.html",
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=240,
        check=False,
    )
    assert result.returncode == 1
    for message in (
        "dark-scheme media query",
        "opaque dark panel",
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
        timeout=420,
        check=False,
    )
    assert result.returncode == 0, textwrap.shorten(result.stdout + result.stderr, 1500)
    assert "light check passed" in result.stdout
