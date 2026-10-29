"""Export canonical category guidance and the prompt for the Worker, without model calls."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from tessera.ontology.categories import CATEGORY_REGISTRY

from herma.conversation import SYSTEM
from herma.conversation_contracts import ConversationTurn, Proposal, WorkContract
from herma.provider_plan import ProviderPlan


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    path = Path(__file__).resolve().parents[1] / "deploy/cloudflare/conversation_data.json"
    payload = {
        "system_prompt": SYSTEM,
        "schemas": {
            "conversation_turn": ConversationTurn.model_json_schema(),
            "provider_plan": ProviderPlan.model_json_schema(),
            "work_contract": WorkContract.model_json_schema(),
            "proposal": Proposal.model_json_schema(),
        },
        "categories": {
            key: value.model_dump(mode="json").get("worker_guidance")
            for key, value in sorted(CATEGORY_REGISTRY.items())
        },
    }
    raw = json.dumps(payload, indent=2, ensure_ascii=True, sort_keys=True) + "\n"
    if args.check:
        if not path.exists() or path.read_text() != raw:
            raise SystemExit(
                "Stale conversation_data.json; run uv run python scripts/build_conversation_data.py"
            )
    else:
        path.write_text(raw)


if __name__ == "__main__":
    main()
