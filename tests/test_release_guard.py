"""The deploy-time guard: wrangler refuses a deploy that breaks a release rule, from any checkout of this repo.

`scripts/check_release.py` runs as `build.command` (deploy/cloudflare/wrangler.jsonc). These tests drive its rules in
temporary git repositories, check that the policy names the live commit and that it is contained in this history, and
prove that the banned-word gate (`scripts/release_gate.mjs`) fails on dirty pages and passes on clean ones. Banned words
are written in pieces, so this file never contains them itself.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

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
    # Gemini's v6.10, which was live at 22:43Z on Nov 1, and the Muse-first release must both be in this history.
    assert "76a428f2c6c3182c6dabc5019e6aa4cb3e1f3cbe" in required
    assert "295bdbd50a133128566346740e232351e7640ad8" in required
    assert check_release.check_ancestors(REPO_ROOT, POLICY) == []
    assert POLICY["live_when_recorded"]["version"] == "daaff3ec-e276-4841-8282-ca4d9315a82b"


def test_wrangler_runs_the_guard_and_the_light_check_before_every_deploy() -> None:
    config = (REPO_ROOT / "deploy/cloudflare/wrangler.jsonc").read_text(encoding="utf-8")
    build = re.search(r'"build"\s*:\s*\{(.*?)\}', config, re.S)
    assert build, "wrangler.jsonc needs a build.command, the deploy-time guard"
    command = build.group(1)
    assert "scripts/check_release.py --check" in command and "make light-check" in command
    assert command.index("check_release.py") < command.index("light-check"), "the guard runs first"
    assert "git rev-parse --show-toplevel" in command, "it works from any directory of any checkout"
    makefile = (REPO_ROOT / "Makefile").read_text(encoding="utf-8")
    assert re.search(r"^check:.*\bgate\b.*\blight-check\b.*\bpage-check\b", makefile, re.M), (
        "make check runs all three"
    )


def test_the_asset_versions_and_the_gate_pass_on_this_tree() -> None:
    assert check_release.check_assets(REPO_ROOT) == []
    assert check_release.check_gate(REPO_ROOT) == []


def gate_problems(pages: dict[str, str]) -> dict[str, list[str]]:
    result = subprocess.run(
        ["node", "--no-warnings", "scripts/release_gate.mjs", "--pages"],
        cwd=REPO_ROOT,
        input=json.dumps(pages),
        capture_output=True,
        text=True,
        check=True,
    )
    return dict(json.loads(result.stdout))


def test_the_gate_fails_on_every_kind_of_dirty_page_and_passes_a_clean_one() -> None:
    family = "L" + "lama"
    banned = "syn" + "thetic"
    third_party = "nano" + "Muse"
    dirty = {
        "family": f"<main><h1>x</h1><p>Tuned from {family} 3.2.</p></main>",
        "word": f"<main><h1>x</h1><p>A {banned} run.</p></main>",
        "app": f"<main><h1>x</h1><p>Checked in {third_party}.</p></main>",
        "prose": "<main><h1>x</h1><p>Reusable nouns and verbs.</p></main>",
        "receipt": "<main><h1>x</h1><p>The receipt and the SHA-256.</p></main>",
        "hash": "<main><h1>x</h1><p>Seen as 9699abcdef0123456789.</p></main>",
        "stamp": "<main><h1>x</h1><p>COMING SOON</p></main>",
        "dash": f"<main><h1>x</h1><p>one {chr(0x2014)} two</p></main>",
        "cloud": "<main><h1>x</h1><p>A dedicated cloud worker.</p></main>",
    }
    clean = {
        "clean": "<main><h1>Tasks and Task Objects</h1><p>Muse Spark 1.3 through the Meta API.</p>"
        '<code>verb_kind</code> <a href="/c/ab_9f3a2b1c4d5e6f7a">a record</a><pre>queued_tasks, payload_sha256_verified, noun.*</pre></main>',
    }
    found = gate_problems({**dirty, **clean})
    for name in dirty:
        assert found[name], f"the gate missed the {name} case"
    assert found["clean"] == [], found["clean"]
    # An id inside a link's address is the record's name; the same id in the words people read is not.
    assert gate_problems({"visible": "<main><h1>x</h1><p>See 9f3a2b1c4d5e6f7a</p></main>"})[
        "visible"
    ]
