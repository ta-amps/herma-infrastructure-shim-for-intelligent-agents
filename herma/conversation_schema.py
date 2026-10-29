"""Bounded JSON Schema profile shared with the Worker conversation validator."""

from __future__ import annotations

import json
import re
from typing import Any

TYPES = {"object", "array", "string", "number", "integer", "boolean", "null"}
KEYWORDS = {
    "type",
    "description",
    "title",
    "properties",
    "required",
    "additionalProperties",
    "items",
    "minItems",
    "maxItems",
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "enum",
    "const",
    "anyOf",
    "oneOf",
}


def strict_json(raw: str) -> Any:
    """Parse JSON like the Worker's strictJson: duplicate fields and non-finite numbers fail."""

    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate JSON field")
            result[key] = value
        return result

    def invalid(_value: str) -> None:
        raise ValueError("non-finite number")

    return json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid)


def validate_portable_schema(schema: dict[str, Any]) -> None:
    """Exclude remote references, regular expressions and unbounded schema expansion."""
    nodes = 0

    def primitive(value: Any) -> bool:
        return value is None or type(value) in (str, bool, int, float)

    def visit(node: Any, depth: int = 0) -> None:
        nonlocal nodes
        nodes += 1
        if not isinstance(node, dict) or nodes > 128 or depth > 8 or set(node) - KEYWORDS:
            raise ValueError("unsupported work schema")
        if not any(key in node for key in ("type", "enum", "const", "anyOf", "oneOf")):
            raise ValueError("every schema needs an explicit type or alternatives")
        if "type" in node and (not isinstance(node["type"], str) or node["type"] not in TYPES):
            raise ValueError("invalid schema type")
        if node.get("type") == "object" and (
            not isinstance(node.get("properties"), dict)
            or node.get("additionalProperties") is not False
        ):
            raise ValueError("object schemas need typed properties and closed additional fields")
        if node.get("type") == "array" and "items" not in node:
            raise ValueError("array schemas need typed items")
        for key in ("title", "description"):
            if key in node and (not isinstance(node[key], str) or len(node[key]) > 1000):
                raise ValueError("invalid schema text")
        for key in ("minLength", "maxLength", "minItems", "maxItems"):
            if key in node and (type(node[key]) is not int or not 0 <= node[key] <= 32768):
                raise ValueError("invalid schema bound")
        for lower, upper in (
            ("minimum", "maximum"),
            ("minLength", "maxLength"),
            ("minItems", "maxItems"),
        ):
            if lower in node and upper in node and node[lower] > node[upper]:
                raise ValueError("contradictory schema bounds")
        if "const" in node and not primitive(node["const"]):
            raise ValueError("const must be primitive")
        if "enum" in node and (
            not isinstance(node["enum"], list)
            or not 1 <= len(node["enum"]) <= 32
            or not all(primitive(value) for value in node["enum"])
        ):
            raise ValueError("invalid enum")
        if "enum" in node:
            normalized = [
                json.dumps(int(value) if type(value) is float and value.is_integer() else value)
                for value in node["enum"]
            ]
            if len(set(normalized)) != len(normalized):
                raise ValueError("duplicate enum values")
        if "additionalProperties" in node and type(node["additionalProperties"]) is not bool:
            raise ValueError("additionalProperties must be boolean")
        if "properties" in node:
            props = node["properties"]
            if node.get("type") != "object" or not isinstance(props, dict) or len(props) > 32:
                raise ValueError("invalid properties")
            for key, value in props.items():
                if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.-]{0,79}", key) or key in {
                    "__proto__",
                    "prototype",
                    "constructor",
                }:
                    raise ValueError("invalid property name")
                visit(value, depth + 1)
        if "required" in node:
            required = node["required"]
            if (
                not isinstance(required, list)
                or any(
                    not isinstance(key, str) or key not in node.get("properties", {})
                    for key in required
                )
                or len(set(required)) != len(required)
            ):
                raise ValueError("invalid required properties")
        if "items" in node:
            if node.get("type") != "array":
                raise ValueError("items require array type")
            visit(node["items"], depth + 1)
        for key in ("anyOf", "oneOf"):
            if key in node:
                if not isinstance(node[key], list) or not 1 <= len(node[key]) <= 8:
                    raise ValueError("invalid alternatives")
                for alternative in node[key]:
                    visit(alternative, depth + 1)

    visit(schema)
