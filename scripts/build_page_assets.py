"""Keep the shared page shell's asset versions equal to the files in herma/static/assets.

herma/page_shell.json names the stylesheet and the banner script with a content version (`?v=<sha256 prefix>`), so the
long-cached URL changes whenever the file does. Run this after editing either file; `--check` fails when they differ and
when a font or preload the stylesheet or the shell names is missing.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "herma/static/assets"
SHELL = ROOT / "herma/page_shell.json"
VERSION_LENGTH = 10


def version_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:VERSION_LENGTH]


def expected_urls() -> dict[str, str]:
    return {
        "css": f"/assets/herma-pages.css?v={version_of(ASSETS / 'herma-pages.css')}",
        "banner_js": f"/assets/agent-banner.js?v={version_of(ASSETS / 'agent-banner.js')}",
    }


def missing_files(shell: dict[str, object]) -> list[str]:
    """Fonts the stylesheet names and the paths the shell preloads must exist."""
    css = (ASSETS / "herma-pages.css").read_text(encoding="utf-8")
    wanted = {ASSETS / url for url in re.findall(r'url\("(fonts/[^"]+)"\)', css)}
    assets = shell.get("assets")
    preload = assets.get("preload", []) if isinstance(assets, dict) else []
    wanted |= {ROOT / "herma/static" / str(path).lstrip("/") for path in preload}
    return sorted(str(path.relative_to(ROOT)) for path in wanted if not path.is_file())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail instead of rewriting the shell")
    args = parser.parse_args()
    shell = json.loads(SHELL.read_text(encoding="utf-8"))
    problems = [f"missing file: {name}" for name in missing_files(shell)]
    current = {key: shell["assets"].get(key) for key in ("css", "banner_js")}
    wanted = expected_urls()
    if current != wanted:
        if args.check:
            problems.append(
                f"herma/page_shell.json asset versions are stale: {current} should be {wanted}"
            )
        else:
            shell["assets"].update(wanted)
            SHELL.write_text(
                json.dumps(shell, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
            )
            print(f"updated {SHELL.relative_to(ROOT)}: {wanted}")
    if problems:
        print("\n".join(problems), file=sys.stderr)
        return 1
    if args.check:
        print("page shell asset versions are current")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
