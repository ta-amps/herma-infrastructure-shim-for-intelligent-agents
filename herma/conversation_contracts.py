"""Typed, caller-configured work contracts and validated conversational proposals."""

from __future__ import annotations

import hashlib
import json
from typing import Any, Literal

from jsonschema import Draft202012Validator, SchemaError
from pydantic import BaseModel, ConfigDict, Field, model_validator
from tessera.ontology.categories import get_category_spec

from herma.schemas import ContextEntry


class WorkContract(BaseModel):
    """An operation schema tied to a canonical Tessera noun or verb category."""

    model_config = ConfigDict(extra="forbid", strict=True)
    operation_id: str = Field(pattern=r"^[a-z][a-z0-9_.:-]{1,79}$")
    category_id: str = Field(pattern=r"^(noun|verb)\.[a-z0-9_]+$")
    description: str = Field(min_length=1, max_length=600)
    input_schema: dict[str, Any]

    @model_validator(mode="after")
    def check_contract(self) -> WorkContract:
        try:
            get_category_spec(self.category_id)
        except (KeyError, ValueError) as exc:
            raise ValueError("unknown canonical category") from exc
        raw = json.dumps(self.input_schema, allow_nan=False)
        if len(raw.encode()) > 12000 or self.input_schema.get("type") != "object":
            raise ValueError("work contracts require a bounded object schema")

        try:
            Draft202012Validator.check_schema(self.input_schema)
        except SchemaError as exc:
            raise ValueError("invalid JSON schema") from exc

        def check(node: Any, depth: int = 0) -> None:
            if depth > 16:
                raise ValueError("schema nesting limit exceeded")
            if isinstance(node, dict):
                if any(key in node for key in ("$ref", "$dynamicRef", "$recursiveRef")):
                    raise ValueError("schema references are not allowed")
                for field in node.get("properties", {}).values():
                    if not isinstance(field, dict) or not any(
                        key in field for key in ("type", "enum", "const", "anyOf", "oneOf")
                    ):
                        raise ValueError("every property needs an explicit type or alternatives")
                for value in node.values():
                    check(value, depth + 1)
            elif isinstance(node, list):
                for value in node:
                    check(value, depth + 1)

        check(self.input_schema)
        return self

    @property
    def tool_name(self) -> str:
        return "propose_" + hashlib.sha256(self.operation_id.encode()).hexdigest()[:16]


class ConversationTurn(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    conversation_id: str = Field(pattern=r"^[A-Za-z0-9_-]{8,80}$")
    request_id: str = Field(pattern=r"^[A-Za-z0-9_.:-]{8,100}$")
    expected_version: int = Field(ge=0)
    message: str = Field(min_length=1, max_length=6000)
    context_refs: list[str] = Field(min_length=1, max_length=12)
    provider: Literal["ollama", "meta"] = "ollama"


class Proposal(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    status: Literal["clarify", "ready", "blocked"]
    reply: str = Field(min_length=1, max_length=2000)
    operation_id: str | None = None
    category_id: str | None = None
    arguments: dict[str, Any] | None = None
    question: str | None = None
    executed: Literal[False] = False


def load_contracts(entries: list[ContextEntry]) -> list[WorkContract]:
    result = []
    seen = set()
    for entry in entries:
        body = entry.schema_or_body
        if isinstance(body, dict) and "work_contract" in body:
            contract = WorkContract.model_validate(body["work_contract"])
            if contract.operation_id in seen:
                raise ValueError("duplicate operation identifier")
            seen.add(contract.operation_id)
            result.append(contract)
    if not result:
        raise ValueError("no work contracts in the caller-visible context entries")
    return result


def schema_issues(contract: WorkContract, value: Any) -> list[dict[str, str]]:
    """Return actionable field paths without reflecting sensitive field values."""
    return [
        {"path": "/" + "/".join(map(str, error.absolute_path)), "rule": str(error.validator)}
        for error in list(Draft202012Validator(contract.input_schema).iter_errors(value))[:8]
    ]


def tools_for(contracts: list[WorkContract]) -> list[dict[str, Any]]:
    tools = [
        {
            "type": "function",
            "function": {
                "name": contract.tool_name,
                "description": contract.description,
                "parameters": contract.input_schema,
            },
        }
        for contract in contracts
    ]
    for name, field in (("ask_clarification", "question"), ("report_blocker", "reason")):
        tools.append(
            {
                "type": "function",
                "function": {
                    "name": name,
                    "description": "Ask a specific question."
                    if field == "question"
                    else "Report why work cannot continue.",
                    "parameters": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            field: {"type": "string", "minLength": 1, "maxLength": 1000}
                        },
                        "required": [field],
                    },
                },
            }
        )
    return tools
