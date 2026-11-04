"""The deploy-time guard: wrangler refuses a deploy that breaks a release rule, from any checkout of this repo.

`scripts/check_release.py` runs as `build.command` (deploy/cloudflare/wrangler.jsonc). These tests drive its rules in
temporary git repositories, check that the policy names the live commit and that it is contained in this history, and
prove that the banned-word gate (`scripts/release_gate.mjs`) fails on dirty pages and passes on clean ones. The gate reads
the ONE shared banned-word list from outside this repository (MUST-FOLLOW rule 16); these tests drive it with the made-up list
in tests/fixtures, so this file spells no banned word.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest
from banned_support import shared_words_or_none

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import check_release  # noqa: E402  (scripts/ is not a package)

POLICY = json.loads(
    (REPO_ROOT / "deploy/cloudflare/release-policy.json").read_text(encoding="utf-8")
)


def git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-c", "user.name=test", "-c", "user.email=test@example.invalid", *args],
        cwd=root,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


@pytest.fixture
def repo(tmp_path: Path) -> dict[str, Any]:
    git(tmp_path, "init", "-q", "-b", "main")
    (tmp_path / "a.txt").write_text("a\n")
    git(tmp_path, "add", "-A")
    git(tmp_path, "commit", "-q", "-m", "live commit")
    live = git(tmp_path, "rev-parse", "HEAD")
    (tmp_path / "b.txt").write_text("b\n")
    git(tmp_path, "add", "-A")
    git(tmp_path, "commit", "-q", "-m", "next")
    git(tmp_path, "checkout", "-q", "-b", "stale", live)
    (tmp_path / "c.txt").write_text("c\n")
    git(tmp_path, "add", "-A")
    git(tmp_path, "commit", "-q", "-m", "a branch that does not hold the next commit")
    other = git(tmp_path, "rev-parse", "HEAD")
    git(tmp_path, "checkout", "-q", "main")
    return {
        "root": tmp_path,
        "live": live,
        "head": git(tmp_path, "rev-parse", "HEAD"),
        "other": other,
    }


def test_a_dirty_or_untracked_tree_is_refused(repo: dict[str, Any]) -> None:
    root: Path = repo["root"]
    assert check_release.check_clean(root) == []
    (root / "a.txt").write_text("edited\n")
    assert "not clean" in check_release.check_clean(root)[0]
    git(root, "checkout", "--", "a.txt")
    (root / "new.txt").write_text("x\n")
    problems = check_release.check_clean(root)
    assert problems and "new.txt" in problems[0], (
        "an untracked file is a deploy of uncommitted work too"
    )


def test_the_commit_that_is_live_must_be_contained(repo: dict[str, Any]) -> None:
    root: Path = repo["root"]
    assert check_release.check_ancestors(root, {"required_ancestors": [repo["live"]]}) == []
    assert (
        check_release.check_ancestors(root, {"required_ancestors": [repo["live"], repo["head"]]})
        == []
    )
    # A branch that grew from an older base lacks the next commit: exactly what a stale deploy looks like.
    git(root, "checkout", "-q", "stale")
    stale = check_release.check_ancestors(
        root, {"required_ancestors": [repo["live"], repo["head"]]}
    )
    assert stale and "does not contain" in stale[0] and repo["head"][:12] in stale[0]
    git(root, "checkout", "-q", "main")
    assert (
        "does not contain"
        in check_release.check_ancestors(root, {"required_ancestors": [repo["other"]]})[0]
    )
    assert (
        "not in this checkout"
        in check_release.check_ancestors(root, {"required_ancestors": ["0" * 40]})[0]
    )
    assert (
        "full commit id"
        in check_release.check_ancestors(root, {"required_ancestors": ["abc1234"]})[0]
    )
    assert "must list" in check_release.check_ancestors(root, {"required_ancestors": []})[0]


def test_the_policy_names_the_live_commit_and_this_history_contains_it() -> None:
    required = POLICY["required_ancestors"]
    assert required and all(re.fullmatch(r"[0-9a-f]{40}", c) for c in required)
    # Gemini's v6.10 (live from 22:43Z on Nov 1), the Muse-first release and the pages release that went live at 10:36Z on Nov 2
    # (c643787) must all be in this history.
    assert "76a428f2c6c3182c6dabc5019e6aa4cb3e1f3cbe" in required
    assert "295bdbd50a133128566346740e232351e7640ad8" in required
    assert "c64378737bae59825304404fb2adf77b7a6477d9" in required
    assert (
        "4c919d1dbba2da591eeca360cb6e73db80740b44" in required
    )  # the network map release, live from 12:35Z on Nov 2
    assert check_release.check_ancestors(REPO_ROOT, POLICY) == []
    assert POLICY["live_when_recorded"]["version"] == "3bcc48d8-f217-440b-90a1-bbf7cb886dc8"


def test_wrangler_runs_the_guard_and_the_light_check_before_every_deploy() -> None:
    config = (REPO_ROOT / "deploy/cloudflare/wrangler.jsonc").read_text(encoding="utf-8")
    build = re.search(r'"build"\s*:\s*\{(.*?)\}', config, re.S)
    assert build, "wrangler.jsonc needs a build.command, the deploy-time guard"
    command = build.group(1)
    assert "scripts/check_release.py --check" in command and "make light-check" in command
    assert command.index("banned_list.mjs") < command.index("check_release.py")
    assert command.index("check_release.py") < command.index("light-check"), "the guard runs first"
    assert command.rindex("banned_list.mjs --check") > command.index("light-check"), (
        "the module the bundle will contain is checked again after everything else ran"
    )
    assert re.search(r"unset BANNED_WORDS_LIST BANNED_NEUTRAL_NAMES", command), (
        "a release never takes the word list from an override"
    )
    assert "git rev-parse --show-toplevel" in command, "it works from any directory of any checkout"
    makefile = (REPO_ROOT / "Makefile").read_text(encoding="utf-8")
    assert re.search(r"^check:.*\bgate\b.*\blight-check\b.*\bpage-check\b", makefile, re.M), (
        "make check runs all three"
    )


def test_the_asset_versions_and_the_gate_pass_on_this_tree(monkeypatch: pytest.MonkeyPatch) -> None:
    assert check_release.check_assets(REPO_ROOT) == []
    if shared_words_or_none() is None:
        pytest.skip("the real gate needs the private word list; the next test covers its absence")
    assert check_release.check_gate(REPO_ROOT) == []


def test_a_release_never_runs_on_the_sample_list(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """With no real list, the deploy path fails closed even if someone asks for the sample list."""
    generated = REPO_ROOT / "deploy/cloudflare/banned_words.generated.js"
    before = generated.read_bytes() if generated.exists() else None
    monkeypatch.setenv("HERMA_SAMPLE_WORD_LIST", "1")
    monkeypatch.setenv("TELEION_NOTES", str(tmp_path))
    monkeypatch.setenv("HOME", str(tmp_path))
    try:
        problems = check_release.check_gate(REPO_ROOT)
    finally:
        if before is not None:
            generated.write_bytes(before)
    assert problems, "the release gate passed with no real word list"
    assert "missing" in " ".join(problems)


def made_up_environment(**extra: str) -> dict[str, str]:
    return {
        **os.environ,
        "BANNED_WORDS_LIST": str(REPO_ROOT / "tests/fixtures/made-up-banned-words.json"),
        "BANNED_NEUTRAL_NAMES": str(REPO_ROOT / "tests/fixtures/made-up-neutral-names.json"),
        **extra,
    }


def gate_problems(pages: dict[str, str]) -> dict[str, list[str]]:
    result = subprocess.run(
        ["node", "--no-warnings", "scripts/release_gate.mjs", "--pages"],
        cwd=REPO_ROOT,
        input=json.dumps(pages),
        capture_output=True,
        text=True,
        check=True,
        env=made_up_environment(),
    )
    return dict(json.loads(result.stdout))


def test_the_gate_fails_on_every_kind_of_dirty_page_and_passes_a_clean_one() -> None:
    private_name = "Fnorbleton"  # a made-up name; the list holds only its sha256
    dirty = {
        "always": "<main><h1>x</h1><p>Tuned from a zorptest run.</p></main>",
        "always inside a longer word": "<main><h1>x</h1><p>Seen in superglimbo mode.</p></main>",
        "app": "<main><h1>x</h1><p>Checked in wumpusapp.</p></main>",
        "prose": "<main><h1>x</h1><p>Reusable plorps for everyone.</p></main>",
        "hash wording": "<main><h1>x</h1><p>A quux-256 sum.</p></main>",
        "long id": "<main><h1>x</h1><p>Seen as 9699abcdef0123456789.</p></main>",
        "long id in code": "<main><h1>x</h1><pre>9699abcdef0123456789</pre></main>",
        "label": "<main><h1>x</h1><p>Whim</p></main>",
        "suffix": "<main><h1>x</h1><p>A snarfling pass.</p></main>",
        "private name": f"<main><h1>x</h1><p>Written by {private_name}.</p></main>",
        "private name in an attribute": f'<main><h1>x</h1><img alt="{private_name.lower()}" src="/a.png"></main>',
        "dash": f"<main><h1>x</h1><p>one {chr(0x2014)} two</p></main>",
    }
    clean = {
        "clean": "<main><h1>Tasks and Task Objects</h1><p>Muse Spark 1.3 through the Meta API.</p>"
        '<code>plorp_kind</code> <a href="/c/ab_9f3a2b1c4d5e6f7a">a record</a>'
        "<pre>plorps, quux256_verified, a1b2c3d4e5f</pre>"
        "<p>A whim, not a label. Fnorbletons are not the name.</p></main>",
    }
    found = gate_problems({**dirty, **clean})
    for name in dirty:
        assert found[name], f"the gate missed the {name} case"
    assert found["clean"] == [], found["clean"]
    # A reader never gets a banned word echoed back in a problem report.
    reported = [line for lines in found.values() for line in lines]
    assert not any("zorptest" in line or "wumpusapp" in line for line in reported)
    # An id inside a link's address is the record's name; the same id in the words people read is not.
    assert gate_problems({"visible": "<main><h1>x</h1><p>See 9f3a2b1c4d5e6f7a</p></main>"})[
        "visible"
    ]


def gate_problems_with_list(pages: dict[str, str], list_file: Path) -> dict[str, list[str]]:
    result = subprocess.run(
        ["node", "--no-warnings", "scripts/release_gate.mjs", "--pages"],
        cwd=REPO_ROOT,
        input=json.dumps(pages),
        capture_output=True,
        text=True,
        check=True,
        env=made_up_environment(BANNED_WORDS_LIST=str(list_file)),
    )
    return dict(json.loads(result.stdout))


def test_the_gate_reads_the_lists_fingerprints_group_and_keeps_its_own_floor(
    tmp_path: Path,
) -> None:
    base = json.loads(
        (REPO_ROOT / "tests/fixtures/made-up-banned-words.json").read_text(encoding="utf-8")
    )
    without = {key: value for key, value in base.items() if key != "fingerprints"}
    stricter = {
        **base,
        "fingerprints": {"why": "made up", "patterns": ["(?<![0-9a-f])[0-9a-f]{8,}(?![0-9a-f])"]},
    }
    pages = {
        "14 hex digits in code": "<main><h1>x</h1><pre>0a1b2c3d4e5f6a</pre></main>",
        "10 hex digits in code": "<main><h1>x</h1><pre>0a1b2c3d4e</pre></main>",
        "short id in code": "<main><h1>x</h1><pre>0a1b2c</pre></main>",
    }
    for name, document in (
        ("no group", without),
        ("the made-up group", base),
        ("a stricter group", stricter),
    ):
        path = tmp_path / f"{name.replace(' ', '-')}.json"
        path.write_text(json.dumps(document), encoding="utf-8")
        found = gate_problems_with_list(pages, path)
        assert found["14 hex digits in code"], (
            f"{name}: 14 hex digits in code must fail (the list or the built-in floor)"
        )
        assert found["short id in code"] == [], f"{name}: a short id is fine"
        if name == "a stricter group":
            assert found["10 hex digits in code"], (
                "the list's own group decides when it is stricter than the floor"
            )
        else:
            assert found["10 hex digits in code"] == [], (
                f"{name}: 10 hex digits are not a fingerprint"
            )


def run_gate(**env: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["node", "--no-warnings", "scripts/release_gate.mjs"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
        env=made_up_environment(**env),
    )


def test_the_gate_fails_closed_without_the_list_and_with_samples_that_catch_nothing(
    tmp_path: Path,
) -> None:
    missing = run_gate(BANNED_WORDS_LIST=str(tmp_path / "nowhere.json"))
    assert missing.returncode == 1 and "missing" in missing.stderr
    # Samples that the list would not catch make the dirty-page check vacuous, so the gate refuses them.
    neutral = json.loads(
        (REPO_ROOT / "tests/fixtures/made-up-neutral-names.json").read_text(encoding="utf-8")
    )
    neutral["samples"] = ["Nothing to catch here"]
    toothless = tmp_path / "toothless.json"
    toothless.write_text(json.dumps(neutral), encoding="utf-8")
    vacuous = run_gate(BANNED_NEUTRAL_NAMES=str(toothless))
    assert vacuous.returncode == 1 and "vacuous" in vacuous.stderr
    neutral["samples"] = []
    toothless.write_text(json.dumps(neutral), encoding="utf-8")
    empty = run_gate(BANNED_NEUTRAL_NAMES=str(toothless))
    assert empty.returncode == 1 and "no samples" in empty.stderr


def test_a_release_ignores_overrides_of_the_word_list(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("BANNED_WORDS_LIST", "/somewhere/weaker.json")
    monkeypatch.setenv("BANNED_NEUTRAL_NAMES", "/somewhere/weaker-names.json")
    environment = check_release.release_environment()
    assert "BANNED_WORDS_LIST" not in environment and "BANNED_NEUTRAL_NAMES" not in environment
    assert "PATH" in environment


def test_the_worker_keeps_no_persisted_traces_and_no_invocation_logs() -> None:
    """Finding F-PRIV-LOGS-001: Cloudflare's persisted traces and automatic request logs keep a visitor's address and browser for days."""
    config = (REPO_ROOT / "deploy/cloudflare/wrangler.jsonc").read_text(encoding="utf-8")
    block = re.search(r'"observability"\s*:\s*\{(.*)\}\s*\}\s*$', config, re.S)
    assert block, "wrangler.jsonc needs an observability block"
    observability = block.group(1)
    assert re.search(r'"invocation_logs"\s*:\s*false', observability)
    assert re.search(
        r'"traces"\s*:\s*\{[^}]*"enabled"\s*:\s*false[^}]*"persist"\s*:\s*false',
        observability,
        re.S,
    )
    assert re.search(r'"redact_query_string"\s*:\s*true', observability)


def test_a_footer_link_to_a_page_that_is_not_there_stops_the_release() -> None:
    """Herma never goes live pointing at a page that answers 404; a link that cannot be reached cannot be verified either."""
    targets = check_release.footer_link_targets(REPO_ROOT)
    assert len(targets) >= 6 and all(href.startswith("https://") for _label, href in targets)
    assert ("Models used \u2197", "https://agora.eranosforgood.org/models/") in targets
    assert ("Privacy \u2197", "https://teleionlabs.com/privacy") in targets
    assert check_release.check_footer_links(REPO_ROOT, fetch=lambda url: 200) == []
    broken = check_release.check_footer_links(
        REPO_ROOT, fetch=lambda url: 404 if url.endswith("/privacy") else 200
    )
    assert len(broken) == 1 and "/privacy" in broken[0] and "404" in broken[0]

    def unreachable(url: str) -> int:
        raise OSError("no route to host")

    assert len(check_release.check_footer_links(REPO_ROOT, fetch=unreachable)) == len(targets)
