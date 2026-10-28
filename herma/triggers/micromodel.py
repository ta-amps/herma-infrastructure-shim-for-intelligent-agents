"""Tier-3 micromodel router trigger: fast tiny/cloud classifier with deterministic offline fallback."""

from __future__ import annotations

import json
import math
import os

import httpx

from herma.harness_gate import refuse_contributor_model
from herma.schemas import MicromodelTrigger


def _offline_fallback(spec: MicromodelTrigger, text: str) -> tuple[bool, list[str], float]:
    """Deterministic calibrated fallback when HERMA_MICROMODEL_URL is unset or unreachable."""
    lower = text.lower()
    hits = [kw for kw in spec.fallback_keywords if kw.lower() in lower]
    if not hits:
        return False, [], 0.0
    # Confidence scales cleanly with matched distinct cue tokens:
    confidence = min(0.95, 0.50 + 0.18 * len(hits))
    if confidence >= spec.min_confidence:
        return (
            True,
            [f"micromodel:fallback(conf={confidence:.2f},cues={','.join(hits[:3])})"],
            round(confidence, 4),
        )
    return False, [], round(confidence, 4)


def _parse_classifier_json(raw_content: str) -> dict[str, object] | None:
    try:
        parsed = json.loads(raw_content)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _classifier_decision(parsed: dict[str, object]) -> tuple[bool, float] | None:
    """The decision is a JSON boolean, never Python truthiness or a label alias."""
    apply_flag = parsed.get("apply")
    raw_conf = parsed.get("confidence")
    if type(apply_flag) is not bool or type(raw_conf) not in (int, float):
        return None
    if not isinstance(raw_conf, int | float) or not 0 <= raw_conf <= 1:
        return None
    conf = float(raw_conf)
    if not math.isfinite(conf):
        return None
    if any(field in parsed and not isinstance(parsed[field], str) for field in ("label", "reason")):
        return None
    return apply_flag, conf


async def evaluate_micromodel_trigger(
    spec: MicromodelTrigger,
    text: str,
    *,
    offline_only: bool = False,
) -> tuple[bool, list[str], float]:
    """Query a fast OpenAI-compatible micromodel classifier or run deterministic fallback."""
    url = os.environ.get("HERMA_MICROMODEL_URL", "").strip()
    model = os.environ.get("HERMA_MICROMODEL_MODEL", "muse-spark-open").strip()
    api_key = os.environ.get("HERMA_MICROMODEL_API_KEY", "").strip()
    timeout_s = float(os.environ.get("HERMA_MICROMODEL_TIMEOUT_S", "8.0"))

    refuse_contributor_model(model)
    if offline_only or not url:
        return _offline_fallback(spec, text)

    system_prompt = (
        "You are a fast middleware trigger classifier. Answer ONLY with a single JSON object "
        'of the exact shape {"apply": true|false, "confidence": 0.0..1.0, "label": "apply|skip", '
        '"reason": "short phrase"}. Do not include markdown.'
    )
    user_prompt = (
        f"Classifier question: {spec.intent_question}\n"
        f"Positive labels: {', '.join(spec.positive_labels)}\n"
        f"Outbound agent request excerpt:\n{text[:3000]}"
    )
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.post(
                url,
                headers=headers,
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": 0.0,
                    "max_tokens": 1024,
                },
            )
            resp.raise_for_status()
    except Exception:
        return _offline_fallback(spec, text)

    try:
        data = resp.json()
        msg = data["choices"][0]["message"]
        content = msg.get("content")
        parsed = _parse_classifier_json(content) if isinstance(content, str) else None
        decision = _classifier_decision(parsed) if parsed is not None else None
        if decision is None or parsed is None:
            return False, [], 0.0
        apply_flag, conf = decision
        matched = apply_flag and conf >= spec.min_confidence
        reasons = (
            [f"micromodel:{model}(conf={conf:.2f},reason={str(parsed.get('reason', ''))[:48]!r})"]
            if matched
            else []
        )
        return matched, reasons, round(conf, 4)
    except (KeyError, IndexError, TypeError, AttributeError, ValueError):
        # A malformed response is not permission to activate a provision or its fallback.
        return False, [], 0.0
