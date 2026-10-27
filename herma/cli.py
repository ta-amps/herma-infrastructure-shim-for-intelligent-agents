"""Command-line interface for Herma: seed, keys, dry-run, 3-tier demo, and serve."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any, cast

import httpx
import uvicorn
from tessera.store import Store as TesseraStore

from herma import __version__
from herma.api.app import seed_examples_if_present
from herma.errors import ContributorTierRefusedError, HarnessRequiredError
from herma.harness_gate import enforce_not_consumer_assistant
from herma.proxy import HermaMiddleware
from herma.schemas import HarnessKind, HarnessScope, Provision, ProvisionURI
from herma.store import ProvisionStore


def _default_db() -> Path:
    raw = os.environ.get("HERMA_DB", "").strip()
    if raw:
        return Path(raw)
    return Path.cwd() / ".herma" / "herma.db"


async def _run_demo(*, live_ollama: bool = False, ollama_key_file: str = "") -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        tessera_db = tmp_dir / "tessera.db"
        herma_db = Path(os.environ.get("HERMA_DB") or (tmp_dir / "herma.db"))

        t_store = TesseraStore(tessera_db)
        h_store = ProvisionStore(herma_db)
        seed_examples_if_present(h_store)

        # Store a content-addressed reference excerpt blob in Tessera and attach tessera://blobs/<sha256>
        blob_bytes = (
            b"Every task lease carries a monotonic fencing token; submit refuses stale fences "
            b"and emits a canonical SHA-256 receipt."
        )
        blob_sha = t_store.put_blob(blob_bytes)
        first = h_store.get_provision("PROV-TESSERA-FENCING").provision
        enriched = first.model_copy(
            update={
                "uris": [
                    *first.uris,
                    ProvisionURI(
                        uri=f"tessera://blobs/{blob_sha}",
                        label="Tessera Fencing Excerpt Blob",
                        kind="store_record",
                    ),
                ]
            }
        )
        h_store.put_provision(enriched, check_cas=False)
        published_ids = h_store.publish_to_tessera_store(t_store)

        # Sync into a clean Herma runtime store from Tessera, resolving blob excerpts automatically:
        runtime_store = ProvisionStore(tmp_dir / "runtime.db")
        synced = runtime_store.sync_from_tessera_store(t_store)

        raw_key, key_info = runtime_store.issue_key(
            label="demo-opencode",
            harness_kind="opencode",
            scopes=["route", "configure"],
        )
        principal = runtime_store.authenticate_headers({"X-Herma-Key": raw_key})

        # 1. Prove generic consumer assistant (Muse Personal Assistant) is deterministically refused:
        consumer_refused = False
        try:
            enforce_not_consumer_assistant({"User-Agent": "Muse-Personal-Assistant/1.0"})
        except HarnessRequiredError:
            consumer_refused = True

        # 2. Prove '-contributor' model tier is refused:
        mw = HermaMiddleware(runtime_store)
        contributor_refused = False
        try:
            await mw.intercept(
                principal=principal,
                wire_format="chat_completions",
                payload={
                    "model": "muse-spark-1.3-contributor",
                    "messages": [{"role": "user", "content": "hello"}],
                },
            )
        except ContributorTierRefusedError:
            contributor_refused = True

        # 3. Fire Tier 1 (keyword/path), Tier 2 (semantic paraphrase), and Tier 3 (micromodel):
        if live_ollama and ollama_key_file:
            key_txt = Path(ollama_key_file).read_text(encoding="utf-8").strip()
            os.environ["HERMA_MICROMODEL_URL"] = "https://ollama.com/v1/chat/completions"
            os.environ["HERMA_MICROMODEL_MODEL"] = "muse-spark-open"
            os.environ["HERMA_MICROMODEL_API_KEY"] = key_txt

        # Tier-1 keyword + path match:
        out_kw = await mw.intercept(
            principal=principal,
            wire_format="chat_completions",
            payload={
                "model": "muse-spark-open",
                "messages": [
                    {
                        "role": "user",
                        "content": "Update src/tessera/_tasks.py to verify lease fencing tokens.",
                    }
                ],
            },
        )
        # Tier-2 semantic match (paraphrased concurrent swarm duplicate worker hazard, no exact ID):
        out_sem = await mw.intercept(
            principal=principal,
            wire_format="responses",
            payload={
                "model": "muse-spark-open",
                "input": "Prevent two concurrent background workers in a swarm from double-processing the same backlog item.",
            },
        )
        # Tier-3 micromodel match (subtle NGO hotline autonomy boundary):
        out_micro = await mw.intercept(
            principal=principal,
            wire_format="chat_completions",
            payload={
                "model": "muse-spark-open",
                "messages": [
                    {
                        "role": "user",
                        "content": "Design an automated shelter intake triage flow for a crisis helpline team.",
                    }
                ],
            },
        )

        # 4. Turn-2 deduplication check:
        turn2_messages = [
            *out_kw.augmented_payload["messages"],
            {"role": "assistant", "content": "Understood, checking fencing tokens."},
            {"role": "user", "content": "Now double-check lease fencing in src/tessera/_tasks.py."},
        ]
        out_dedupe = await mw.intercept(
            principal=principal,
            wire_format="chat_completions",
            payload={"model": "muse-spark-open", "messages": turn2_messages},
        )

        live_completion_excerpt = None
        if live_ollama and ollama_key_file:
            key_txt = Path(ollama_key_file).read_text(encoding="utf-8").strip()
            prompt_payload = {
                "model": "muse-spark-open",
                "messages": [
                    {
                        "role": "user",
                        "content": "In one short sentence, summarize the fencing rule and cite the exact https URI injected in your system prompt.",
                    }
                ],
                "temperature": 0.0,
                "max_tokens": 1024,
            }
            live_out = await mw.intercept(
                principal=principal,
                wire_format="chat_completions",
                payload={
                    **prompt_payload,
                    "messages": [
                        {
                            "role": "user",
                            "content": "Update src/tessera/_tasks.py lease fencing: in one short sentence, state the fencing rule and quote the exact https://tessera.ta-amps.workers.dev URI from your provision.",
                        }
                    ],
                },
            )
            async with httpx.AsyncClient(timeout=45.0) as client:
                r = await client.post(
                    "https://ollama.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {key_txt}"},
                    json=live_out.augmented_payload,
                )
                r.raise_for_status()
                live_completion_excerpt = r.json()["choices"][0]["message"]["content"][:280]

        assert consumer_refused
        assert contributor_refused
        assert "PROV-TESSERA-FENCING@v1" in out_kw.receipt.provisions_fired
        assert len(out_sem.receipt.provisions_fired) >= 1
        assert "PROV-NGO-HUMAN-BOUNDARY@v1" in out_micro.receipt.provisions_fired
        assert "PROV-TESSERA-FENCING" in out_dedupe.receipt.deduped_skipped

        return {
            "ok": True,
            "version": __version__,
            "tessera_published": published_ids,
            "tessera_blob_resolved_sha256": blob_sha,
            "synced_count": len(synced),
            "harness_key_id": key_info.key_id,
            "consumer_assistant_refused": consumer_refused,
            "contributor_tier_refused": contributor_refused,
            "tier1_keyword_receipt": out_kw.receipt.receipt_sha256,
            "tier2_semantic_receipt": out_sem.receipt.receipt_sha256,
            "tier3_micromodel_receipt": out_micro.receipt.receipt_sha256,
            "tier3_tiers_matched": out_micro.receipt.tiers_matched,
            "turn2_deduped_skipped": out_dedupe.receipt.deduped_skipped,
            "live_ollama_excerpt": live_completion_excerpt,
        }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="herma", description="Herma AI request middleware CLI.")
    parser.add_argument(
        "--db", default="", help="Path to SQLite DB (default: $HERMA_DB or .herma/herma.db)"
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("version", help="Print version")
    sub.add_parser("seed", help="Seed example provisions into the active SQLite store")
    sub.add_parser("provisions", help="List stored provisions")

    keys_p = sub.add_parser("keys", help="Manage scoped configurable-harness credentials")
    keys_sub = keys_p.add_subparsers(dest="keys_cmd", required=True)
    issue_p = keys_sub.add_parser("issue", help="Issue a new hmk_ key (printed once)")
    issue_p.add_argument("--label", required=True)
    issue_p.add_argument(
        "--harness",
        required=True,
        choices=["muse-code", "opencode", "claude-code", "codex", "swarm-worker", "custom-harness"],
    )
    issue_p.add_argument(
        "--scopes", default="route,configure", help="Comma-separated scopes: route,configure"
    )
    keys_sub.add_parser("list", help="List issued harness keys (without secrets)")
    rev_p = keys_sub.add_parser("revoke", help="Revoke a harness key by key_id")
    rev_p.add_argument("key_id")

    dry_p = sub.add_parser(
        "dry-run", help="Evaluate triggers and preview augmented request locally"
    )
    dry_p.add_argument("--prompt", required=True)
    dry_p.add_argument("--model", default="muse-spark-open")
    dry_p.add_argument("--path", action="append", default=[])

    demo_p = sub.add_parser(
        "demo", help="Run end-to-end 3-tier trigger + Tessera sync verification"
    )
    demo_p.add_argument("--live-ollama", action="store_true")
    demo_p.add_argument("--ollama-key-file", default="")

    serve_p = sub.add_parser("serve", help="Run the Herma HTTP middleware server")
    serve_p.add_argument("--host", default="127.0.0.1")
    serve_p.add_argument("--port", type=int, default=7730)

    args = parser.parse_args(argv)
    db_path = Path(args.db) if args.db else _default_db()

    if args.cmd == "version":
        print(__version__)
        return 0

    if args.cmd == "seed":
        store = ProvisionStore(db_path)
        added = seed_examples_if_present(store)
        print(
            json.dumps({"seeded": added, "total": len(store.list_provisions()), "db": str(db_path)})
        )
        return 0

    if args.cmd == "provisions":
        store = ProvisionStore(db_path)
        for sp in store.list_provisions():
            p = Provision.model_validate(sp.provision.model_dump())
            print(f"{p.prov_id}\tv{sp.version}\tprio={p.priority}\t{p.title}")
        return 0

    if args.cmd == "keys":
        store = ProvisionStore(db_path)
        if args.keys_cmd == "issue":
            raw_scopes = [s.strip() for s in str(args.scopes).split(",") if s.strip()]
            for sc in raw_scopes:
                if sc not in ("route", "configure"):
                    print(f"Invalid scope: {sc}", file=sys.stderr)
                    return 2
            token, info = store.issue_key(
                label=str(args.label),
                harness_kind=cast(HarnessKind, args.harness),
                scopes=cast(list[HarnessScope], raw_scopes),
            )
            print(json.dumps({"token": token, "info": info.model_dump(mode="json")}, indent=2))
            return 0
        if args.keys_cmd == "list":
            print(json.dumps([k.model_dump(mode="json") for k in store.list_keys()], indent=2))
            return 0
        if args.keys_cmd == "revoke":
            ok = store.revoke_key(str(args.key_id))
            print(json.dumps({"revoked": ok, "key_id": args.key_id}))
            return 0 if ok else 1

    if args.cmd == "dry-run":
        store = ProvisionStore(db_path)
        if not store.list_provisions():
            seed_examples_if_present(store)
        token, info = store.issue_key(
            label="cli-dry-run", harness_kind="custom-harness", scopes=["route"]
        )
        try:
            principal = store.authenticate_headers({"X-Herma-Key": token})
            mw = HermaMiddleware(store)
            outcome = asyncio.run(
                mw.intercept(
                    principal=principal,
                    wire_format="chat_completions",
                    payload={
                        "model": args.model,
                        "messages": [{"role": "user", "content": args.prompt}],
                    },
                    workspace_paths=list(args.path),
                )
            )
            print(
                json.dumps(
                    {
                        "matches": [m.model_dump(mode="json") for m in outcome.matches],
                        "receipt": outcome.receipt.model_dump(mode="json"),
                        "augmented_payload": outcome.augmented_payload,
                    },
                    indent=2,
                )
            )
        finally:
            store.revoke_key(info.key_id)
        return 0

    if args.cmd == "demo":
        res = asyncio.run(
            _run_demo(
                live_ollama=bool(args.live_ollama),
                ollama_key_file=str(args.ollama_key_file),
            )
        )
        print(json.dumps(res, indent=2))
        return 0

    if args.cmd == "serve":
        os.environ["HERMA_DB"] = str(db_path)
        store = ProvisionStore(db_path)
        if not store.list_provisions():
            seed_examples_if_present(store)
        uvicorn.run("herma.api.app:app", host=str(args.host), port=int(args.port))
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
