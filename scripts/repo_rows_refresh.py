#!/usr/bin/env python3
# ruff: noqa: S608  (writes a SQL file; lit() quotes every value)
"""Build the rows behind GET /q/repos: feed exports plus a fresh scan of GitHub's public search, as SQL for D1.

  repo_rows_refresh.py --feeds DIR --out rows.json --sql rows.sql [--days 4]
Then: wrangler d1 execute ta-amps-herma --remote --file rows.sql. Public metadata only. No model call.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import time
import urllib.parse
from datetime import UTC, datetime, timedelta
from pathlib import Path

FEEDS = {
    "memory-systems": ["agent memory", "llm memory in:name,description", "topic:agent-memory"],
    "pii-redaction": ["pii", "pii redaction", "pii detection", "topic:pii"],
    "ocr-llm": ["ocr llm", "document parsing llm", "pdf markdown ocr"],
    "agent-harnesses": ["coding agent", "coding agent cli", "agent harness", "topic:coding-agent"],
    "eval-frameworks": [
        "llm evaluation",
        "llm evaluation framework",
        "topic:llm-evaluation",
        "eval harness llm",
    ],
}
TOPIC = {
    "memory-systems": r"\bmemor|\bremember|\brecall",
    "pii-redaction": r"\bpii\b|redact|anonymi|personal data|privacy|sensitive|de-?identif",
    "ocr-llm": r"\bocr\b|document|\bpdf\b|handwrit|text recognition|\bpars(e|er|ing)\b",
    "agent-harnesses": r"\bharness|\bcoding agent|\bagents?\b|\bcli\b",
    "eval-frameworks": r"\bevals?\b|\bevaluat|\bbenchmark|\btesting\b|red.team",
}


def from_exports(folder: Path) -> dict[tuple[str, str], dict]:
    rows: dict[tuple[str, str], dict] = {}
    for feed in FEEDS:
        doc = json.loads((folder / f"{feed}.json").read_text())
        for item in doc.get("items", []):
            rows[(item["repo"].lower(), feed)] = {
                "repo": item["repo"],
                "feed": feed,
                "license": item.get("licence"),
                "language": item.get("language"),
                "created": (item.get("created_at") or "")[:10],
                "stars": item.get("stars"),
                "relevant": 1 if item.get("relevant") else 0,
                "seen_at": (item.get("first_seen_at") or "")[:10],
            }
    return rows


def scan(days: int, now: datetime) -> dict[tuple[str, str], dict]:
    rows: dict[tuple[str, str], dict] = {}
    since = (now - timedelta(days=days)).strftime("%Y-%m-%d")
    for feed, queries in FEEDS.items():
        for query in queries:
            for page in (1, 2):
                q = urllib.parse.quote(f"{query} created:>={since}")
                time.sleep(2.2)
                res = subprocess.run(
                    ["gh", "api", f"search/repositories?per_page=100&page={page}&q={q}"],
                    capture_output=True,
                    text=True,
                    timeout=60,
                )
                if res.returncode:
                    print("scan failure", feed, query, page, res.stderr[:120], flush=True)
                    break
                items = json.loads(res.stdout)["items"]
                for r in items:
                    if r.get("fork") or r.get("archived"):
                        continue
                    blob = " ".join(
                        [
                            r["full_name"],
                            r.get("description") or "",
                            " ".join(r.get("topics") or []),
                        ]
                    ).lower()
                    lic = (r.get("license") or {}).get("spdx_id")
                    rows[(r["full_name"].lower(), feed)] = {
                        "repo": r["full_name"],
                        "feed": feed,
                        "license": lic if lic and lic != "NOASSERTION" else "unknown",
                        "language": r.get("language"),
                        "created": r["created_at"][:10],
                        "stars": r.get("stargazers_count"),
                        "relevant": 1 if re.search(TOPIC[feed], blob) else 0,
                        "seen_at": now.strftime("%Y-%m-%d"),
                    }
                if len(items) < 100:
                    break
    return rows


def lit(value: object) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def write_sql(rows: list[dict], as_of: str, path: Path) -> None:
    schema = re.search(
        r"CREATE TABLE IF NOT EXISTS feed_repo_rows.*",
        (Path(__file__).parent.parent / "deploy/cloudflare/d1-herma.sql").read_text(),
        re.S,
    )
    assert schema
    lines = [schema.group(0).strip()]
    for r in rows:
        values = [
            r["repo"],
            r["repo"].split("/")[1],
            r["feed"],
            r["license"],
            r["language"],
            r["created"],
            r["stars"],
            r["relevant"],
            r["seen_at"],
        ]
        lines.append(
            "INSERT OR REPLACE INTO feed_repo_rows (repo,name,feed,license,language,created,stars,relevant,seen_at) VALUES ("
            + ",".join(lit(v) for v in values)
            + ");"
        )
    lines.append(
        f"INSERT OR REPLACE INTO feed_repo_meta (key,value) VALUES ('as_of',{lit(as_of)});"
    )
    path.write_text("\n".join(lines) + "\n")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--feeds", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--sql", type=Path, required=True)
    ap.add_argument("--days", type=int, default=4)
    a = ap.parse_args()
    now = datetime.now(UTC)
    rows = from_exports(a.feeds) if a.feeds else {}
    fresh = scan(a.days, now)
    rows.update(fresh)
    out = sorted(rows.values(), key=lambda r: (r["repo"].lower(), r["feed"]))
    a.out.write_text(
        json.dumps(
            {"as_of": now.strftime("%Y-%m-%dT%H:%MZ"), "fresh_rows": len(fresh), "rows": out}
        )
    )
    write_sql(out, now.strftime("%Y-%m-%dT%H:%MZ"), a.sql)
    print("rows", len(out), "fresh", len(fresh))


if __name__ == "__main__":
    main()
