#!/usr/bin/env python3
"""Build deploy/cloudflare/find_catalog.generated.json for GET /q/find.

Seed packs from a library checkout, a kit snapshot for when the live catalog can't be reached, words made ahead of
time, and feed words. Text passes through unchanged; the route filters it at display.

Usage: find_catalog.py <packs dir> <catalog json> <terms json> [shared word list]
A list word never enters this file: such a search word is dropped, and such a word in a title or summary is cut.
"""

import hashlib
import json
import re
import sys
from pathlib import Path

FEEDS = {
    "memory-systems": "memory remember recall context long term persistent knowledge agent retrieval rag",
    "pii-redaction": "pii redaction redact anonymize personal private names phone numbers privacy mask remove sensitive",
    "ocr-llm": "ocr scan scanned read document form pdf image text extraction handwriting receipt invoice",
    "agent-harnesses": "agent harness coding loop orchestrate autonomous cli run server framework",
    "eval-frameworks": "evaluation eval benchmark compare test score model quality framework",
}


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def bad_free(text: str, bad: list[re.Pattern[str]]) -> str:
    for pattern in bad:
        text = pattern.sub(" ", text)
    return text


def main() -> None:
    packs_dir, catalog_path, terms_path = (Path(a) for a in sys.argv[1:4])
    catalog, terms = read_json(catalog_path), read_json(terms_path)
    listed = (
        Path(sys.argv[4])
        if len(sys.argv) > 4
        else Path.home() / "meta_hacakthon/notes/coordination-2026-10-31/rules/banned-words.json"
    )
    words = read_json(listed)
    bad = [
        re.compile(p, re.I)
        for section in ("always", "agent_apps_outside_models_page")
        for p in words.get(section, {}).get("patterns", [])
    ]
    private = set(words.get("private_names", {}).get("sha256", []))
    bad.append(
        re.compile(
            "|".join(
                rf"\b{re.escape(t)}\b"
                for t in {
                    w
                    for got in terms.values()
                    for w in re.findall(r"[a-z0-9]+", " ".join(got).lower())
                }
                if hashlib.sha256(t.encode()).hexdigest() in private
            )
            or r"(?!)",
            re.I,
        )
    )
    cut = lambda text: " ".join(bad_free(text, bad).split())  # noqa: E731
    packs = []
    for d in sorted(packs_dir.iterdir()):
        if (d / "manifest.json").exists():
            m = read_json(d / "manifest.json")
            packs.append(
                {
                    "id": d.name,
                    "title": cut(m.get("title") or d.name),
                    "about": cut(m.get("summary") or "")[:500],
                }
            )
    kits = [
        {
            "id": k["kit"]["kit_id"],
            "title": cut(k["kit"]["title"]),
            "about": cut(k["kit"].get("summary") or "")[:500],
            "tags": " ".join(t for t in k.get("tags", []) if t.startswith(("domain:", "track:"))),
        }
        for k in catalog["kits"]
    ]
    terms = {
        ref: [w for w in got if bad_free(w, bad) == w]
        for ref, got in terms.items()
        if bad_free(ref, bad) == ref
    }
    out = Path(__file__).resolve().parent.parent / "deploy/cloudflare/find_catalog.generated.json"
    # License condition (Meta terms s.10.1(ix)): the words came from a Meta model, so they never feed a training set or a fine-tune.
    body = {
        "_record": "terms were written by Muse Spark from public library text. Search index only; never training data.",
        "packs": packs,
        "kits": kits,
        "feedWords": FEEDS,
        "terms": terms,
    }
    out.write_text(
        json.dumps(body, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    print(len(packs), len(kits), len(terms))


if __name__ == "__main__":
    main()
