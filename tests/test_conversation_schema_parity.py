"""Cross-runtime fixtures for the portable conversation schema boundary."""

from __future__ import annotations

import copy
import json
import subprocess
from pathlib import Path
from typing import Any

from pydantic import ValidationError
from test_conversation import CONTRACT

from herma.conversation_contracts import WorkContract


def test_portable_schema_acceptance_matches_worker() -> None:
    fields: list[dict[str, Any]] = [
        {"type": "string", "minLength": 1, "maxLength": 20},
        {"type": "integer", "minimum": -10, "maximum": 10},
        {"type": "array", "items": {"type": "boolean"}, "maxItems": 4},
        {"anyOf": [{"type": "string"}, {"type": "null"}]},
        {"enum": ["yes", "no", None]},
        {"const": True},
        {},
        {"type": "array"},
        {"type": "object"},
        {"type": "string", "pattern": "(a+)+$"},
        {"type": "string", "minLength": 4, "maxLength": 1},
        {"type": "number", "minimum": True},
        {"enum": ["yes", "yes"]},
        {"type": "string", "$ref": "https://example.com/schema"},
        {"oneOf": [{"type": "string"}] * 9},
        {"const": {"nested": True}},
    ]
    contracts = []
    expected = []
    for field in fields:
        c = copy.deepcopy(CONTRACT)
        c["input_schema"]["properties"]["value"] = field
        contracts.append(c)
        try:
            WorkContract.model_validate(c)
            expected.append(True)
        except ValidationError:
            expected.append(False)
    source = """
import {checkSchema} from './deploy/cloudflare/conversation.js';
let raw=''; for await (const chunk of process.stdin) raw+=chunk;
console.log(JSON.stringify(JSON.parse(raw).map(c=>{
  try {checkSchema(c.input_schema); return true;} catch {return false;}
})));
"""
    result = subprocess.run(
        ["node", "--no-warnings", "--input-type=module", "-e", source],
        input=json.dumps(contracts),
        text=True,
        capture_output=True,
        check=True,
        cwd=Path(__file__).resolve().parents[1],
    )
    assert json.loads(result.stdout) == expected
