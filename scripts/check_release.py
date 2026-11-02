"""Fail closed before a deploy of the Herma Worker, from any checkout of this repository.

Wrangler runs this as `build.command` (see deploy/cloudflare/wrangler.jsonc) before it uploads anything, so a deploy
that breaks a rule stops here instead of going live. The rules, in order:

1. The working tree is clean: a deploy is a commit that was reviewed, never uncommitted edits.
2. Every commit in deploy/cloudflare/release-policy.json `required_ancestors` (the commit that is live now, and the
   Muse-first release) is contained in HEAD, so a deploy can never build from a branch that lacks it.
3. The page assets' versions in herma/page_shell.json match the files in herma/static/assets.
4. The git-ignored module the display filter imports was built from the ONE shared banned-word list (outside this repository,
   MUST-FOLLOW rule 16), not from the made-up test list, and is current.
5. The banned-word gate (scripts/release_gate.mjs) passes that list on every served page, public JSON and text file, and on pages
   rendered from worker-written text that breaks every rule on purpose.

`make light-check` (rule 13, both colour schemes, no dark panel) runs right after this script in the build command.
This gate cannot stop another checkout or a credential holder from skipping the release process; the operator still
re-reads Cloudflare and requires the live version unchanged immediately before deploying.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POLICY = ROOT / "deploy/cloudflare/release-policy.json"
FULL_SHA = re.compile(r"^[0-9a-f]{40}$")


# A release always uses the real shared list: the paths that the tests override are dropped for every step.
OVERRIDES = ("BANNED_WORDS_LIST", "BANNED_NEUTRAL_NAMES")


def release_environment() -> dict[str, str]:
    return {key: value for key, value in os.environ.items() if key not in OVERRIDES}


def run(root: Path, *command: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command, cwd=root, capture_output=True, text=True, check=False, env=release_environment()
    )


def check_clean(root: Path) -> list[str]:
    status = run(root, "git", "status", "--porcelain", "--untracked-files=all")
    if status.returncode != 0:
        return [f"git could not read the working tree: {status.stderr.strip()}"]
    if status.stdout.strip():
        files = ", ".join(line[3:] for line in status.stdout.splitlines()[:6])
        return [f"the working tree is not clean (commit reviewed changes first): {files}"]
    return []


def check_ancestors(root: Path, policy: dict[str, object]) -> list[str]:
    problems: list[str] = []
    head = run(root, "git", "rev-parse", "HEAD")
    if head.returncode != 0:
        return [f"git could not read HEAD: {head.stderr.strip()}"]
    required = policy.get("required_ancestors")
    if not isinstance(required, list) or not required:
        return ["release-policy.json must list required_ancestors"]
    for commit in required:
        if not isinstance(commit, str) or not FULL_SHA.match(commit):
            problems.append(f"required ancestor {commit!r} is not a full commit id")
            continue
        if run(root, "git", "cat-file", "-e", f"{commit}^{{commit}}").returncode != 0:
            problems.append(f"required ancestor {commit[:12]} is not in this checkout's history")
        elif run(root, "git", "merge-base", "--is-ancestor", commit, "HEAD").returncode != 0:
            problems.append(f"HEAD does not contain the required commit {commit[:12]}")
    return problems


def check_assets(root: Path) -> list[str]:
    result = run(root, sys.executable, "scripts/build_page_assets.py", "--check")
    return (
        [] if result.returncode == 0 else [result.stderr.strip() or "page asset versions are stale"]
    )


def check_word_list(root: Path) -> list[str]:
    result = run(root, "node", "scripts/banned_list.mjs", "--check")
    if result.returncode == 0:
        return []
    return [
        line.strip()
        for line in (result.stderr or result.stdout).strip().splitlines()
        if line.strip()
    ] or ["the word-list module does not match the shared banned-word list"]


def check_gate(root: Path) -> list[str]:
    result = run(root, "node", "--no-warnings", "scripts/release_gate.mjs")
    if result.returncode == 0:
        return []
    return [
        line.strip()
        for line in (result.stderr or result.stdout).strip().splitlines()
        if line.strip()
    ] or ["the banned-word gate failed"]


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--check",
        action="store_true",
        required=True,
        help="run every rule and fail on the first broken one",
    )
    parser.parse_args()
    policy = json.loads(POLICY.read_text(encoding="utf-8"))
    for name, check in (
        ("clean working tree", lambda: check_clean(ROOT)),
        ("required ancestors", lambda: check_ancestors(ROOT, policy)),
        ("page asset versions", lambda: check_assets(ROOT)),
        ("shared banned-word list", lambda: check_word_list(ROOT)),
        ("banned-word gate", lambda: check_gate(ROOT)),
    ):
        problems = check()
        if problems:
            print(f"release guard FAILED at {name}:\n  " + "\n  ".join(problems), file=sys.stderr)
            return 1
        print(f"release guard: {name} ok")
    head = run(ROOT, "git", "rev-parse", "HEAD").stdout.strip()
    print(f"release guard passed for {head}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
