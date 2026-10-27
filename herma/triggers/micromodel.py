"""Tier-3 micromodel router trigger: fast tiny/cloud classifier with deterministic offline fallback."""

from __future__ import annotations

import json
import os
import re

import httpx

from herma.harness_gate import refuse_contributor_model
from herma.schemas import MicromodelTrigger

JSON_OBJ_RE = re.compile(r"\{.*\}", re.DOTALL)


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
    cleaned = raw_content.strip()
    match = JSON_OBJ_RE.search(cleaned)
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


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
            data = resp.json()
            msg = data["choices"][0]["message"]
            content = str(msg.get("content") or "")
            parsed = _parse_classifier_json(content)
            if parsed is None:
                return _offline_fallback(spec, text)
            apply_flag = bool(parsed.get("apply", False))
            label = str(parsed.get("label", "")).strip().lower()
            raw_conf = parsed.get("confidence", 0.0)
            conf = float(raw_conf) if isinstance(raw_conf, int | float | str) else 0.0
            positive = apply_flag or label in {lbl.lower() for lbl in spec.positive_labels}
            matched = positive and conf >= spec.min_confidence
            reasons = (
                [
                    f"micromodel:{model}(conf={conf:.2f},reason={str(parsed.get('reason', ''))[:48]!r})"
                ]
                if matched
                else []
            )
            return matched, reasons, round(conf, 4)
    except Exception:
        return _offline_fallback(spec, text)
