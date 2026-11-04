"""The index CLI produces the same bytes in differently named checkouts."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path


def test_generated_indexes_use_repository_metadata_not_checkout_name(tmp_path: Path) -> None:
    source = Path(__file__).resolve().parents[1] / "scripts" / "build_index.py"
    roots = [tmp_path / "herma", tmp_path / "unrelated-worktree-label"]
    for root in roots:
        script = root / "scripts" / "build_index.py"
        script.parent.mkdir(parents=True)
        shutil.copyfile(source, script)
        (root / "architecture.json").write_text(json.dumps({"name": "herma"}))
        (root / "README.md").write_text("# Herma\n\nEXAMPLE portable documentation.\n")
        (root / "keywords.txt").write_text("portable\n")
        subprocess.run([sys.executable, str(script)], cwd=root, check=True, capture_output=True)
        subprocess.run(
            [sys.executable, str(script), "--check"], cwd=root, check=True, capture_output=True
        )
    for name in ("INDEX.md", "KEYWORDS.md", "llms.txt", "llms-full.txt"):
        assert (roots[0] / name).read_bytes() == (roots[1] / name).read_bytes()
    assert (roots[1] / "INDEX.md").read_text().startswith("# Index of herma\n")
    assert (roots[1] / "KEYWORDS.md").read_text().startswith("# Keyword index of herma\n")
