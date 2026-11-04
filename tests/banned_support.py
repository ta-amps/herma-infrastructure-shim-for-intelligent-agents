"""The ONE shared banned-word list, read from outside this repository for tests (MUST-FOLLOW rule 16).

Nothing in this repository spells a banned word. A test that needs the real list reads it from the shared file, and skips
when this machine does not have it; the release gate (`scripts/release_gate.mjs`) and the deploy hook never skip. Tests of
the mechanism use the made-up list in `tests/fixtures/made-up-banned-words.json` instead.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
FIXTURES = REPO_ROOT / "tests/fixtures"
MADE_UP_LIST = FIXTURES / "made-up-banned-words.json"
MADE_UP_NEUTRAL = FIXTURES / "made-up-neutral-names.json"
SHARED_LIST = Path(os.environ.get("TELEION_NOTES", "/nonexistent")) / "coordination-2026-10-31/rules/banned-words.json"


@dataclass(frozen=True)
class Words:
    always: tuple[re.Pattern[str], ...]
    visible: tuple[re.Pattern[str], ...]
    apps: tuple[re.Pattern[str], ...]
    private_sha256: frozenset[str]

    def always_hits(self, text: str) -> list[str]:
        """The groups that match, never the words themselves."""
        hits = [f"always #{i}" for i, p in enumerate(self.always) if p.search(text)]
        hits += [f"apps #{i}" for i, p in enumerate(self.apps) if p.search(text)]
        if self.private_names(text):
            hits.append("private name")
        return hits

    def private_names(self, text: str) -> list[str]:
        tokens = set(re.findall(r"[a-z0-9]+", text.lower()))
        return [t for t in tokens if hashlib.sha256(t.encode()).hexdigest() in self.private_sha256]


def load(path: Path) -> Words:
    data = json.loads(path.read_text(encoding="utf-8"))
    flags = re.IGNORECASE if data.get("case_insensitive", True) else 0

    def compile_group(name: str) -> tuple[re.Pattern[str], ...]:
        group = data.get(name) or {}
        return tuple(re.compile(pattern, flags) for pattern in group.get("patterns", []))

    hashes = (data.get("private_names") or {}).get("sha256", [])
    return Words(
        always=compile_group("always"),
        visible=compile_group("visible_text"),
        apps=compile_group("agent_apps_outside_models_page"),
        private_sha256=frozenset(str(h).lower() for h in hashes),
    )


def shared_words_or_none() -> Words | None:
    path = Path(os.environ.get("BANNED_WORDS_LIST") or SHARED_LIST)
    return load(path) if path.is_file() else None


def shared_words() -> Words:
    """The real list, or a skip when this machine does not have it."""
    words = shared_words_or_none()
    if words is None:
        pytest.skip("the shared banned-word list is not on this machine")
    return words


def made_up_words() -> Words:
    return load(MADE_UP_LIST)
