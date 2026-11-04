"""Herma points people and agents at the canonical Eranos address, https://eranosforgood.org (owner, Nov 2).

The old workers.dev address still answers machine paths, but it is not the address to give out. The one place it may stay is the list of
origins a browser may read GET /q/network from: the design contract names the alias there, and an origin is not a pointer.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OLD_ADDRESSES = ("eranos.ta-amps.workers.dev", "eranos.teleionlabs.com")
MAY_NAME_THEM = {"deploy/cloudflare/network_activity.js", "tests/test_canonical_addresses.py"}


def test_no_tracked_file_points_at_an_old_eranos_address_except_the_origin_list() -> None:
    names = subprocess.run(
        ["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout.splitlines()
    found: dict[str, list[str]] = {}
    for name in names:
        try:
            text = (ROOT / name).read_text(encoding="utf-8")
        except (UnicodeDecodeError, FileNotFoundError):
            continue  # a font, an image or a file that is gone
        hits = [address for address in OLD_ADDRESSES if address in text]
        if hits:
            found[name] = hits
    assert set(found) <= MAY_NAME_THEM, (
        f"these files point at an old Eranos address: {sorted(set(found) - MAY_NAME_THEM)}"
    )
    assert "eranos.ta-amps.workers.dev" in (
        ROOT / "deploy/cloudflare/network_activity.js"
    ).read_text(encoding="utf-8")  # the contract's origin alias stays
