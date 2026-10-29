"""Orchestrates Tier-1 (keyword), Tier-2 (semantic), and Tier-3 (micromodel) triggers."""

from __future__ import annotations

from dataclasses import dataclass, field

from herma.schemas import StoredProvision, TriggerMatch, TriggerTier
from herma.triggers.keyword import evaluate_keyword_trigger
from herma.triggers.micromodel import evaluate_micromodel_trigger
from herma.triggers.semantic import evaluate_semantic_trigger


@dataclass(frozen=True)
class TriggerContext:
    """Normalized signals extracted from an outbound coding-harness request."""

    text: str
    file_paths: list[str] = field(default_factory=list)
    tool_names: list[str] = field(default_factory=list)


async def evaluate_single_provision(
    stored: StoredProvision,
    ctx: TriggerContext,
    *,
    offline_only: bool = False,
) -> TriggerMatch | None:
    prov = stored.provision
    if not prov.enabled:
        return None
    spec = prov.triggers
    matched_tiers: list[TriggerTier] = []
    reasons: list[str] = []
    scores: list[float] = []
    configured_count = 0

    if spec.keyword is not None:
        configured_count += 1
        ok, why, sc = evaluate_keyword_trigger(
            spec.keyword, ctx.text, ctx.file_paths, ctx.tool_names
        )
        if ok:
            matched_tiers.append("keyword")
            reasons.extend(why)
            scores.append(sc)
        elif spec.mode == "all":
            return None

    if spec.semantic is not None:
        configured_count += 1
        ok, why, sc = await evaluate_semantic_trigger(
            spec.semantic, ctx.text, offline_only=offline_only
        )
        if ok:
            matched_tiers.append("semantic")
            reasons.extend(why)
            scores.append(sc)
        elif spec.mode == "all":
            return None

    # Short-circuit Tier-3 micromodel in 'any' mode when Tier-1 or Tier-2 already matched:
    if spec.micromodel is not None:
        configured_count += 1
        should_run_micro = spec.mode == "all" or not matched_tiers
        if should_run_micro:
            ok, why, sc = await evaluate_micromodel_trigger(
                spec.micromodel, ctx.text, offline_only=offline_only
            )
            if ok:
                matched_tiers.append("micromodel")
                reasons.extend(why)
                scores.append(sc)
            elif spec.mode == "all":
                return None

    if spec.mode == "all" and len(matched_tiers) < configured_count:
        return None
    if not matched_tiers:
        return None

    best_score = max(scores) if scores else 0.0
    return TriggerMatch(
        prov_id=prov.prov_id,
        version=stored.version,
        priority=prov.priority,
        matched_tiers=matched_tiers,
        reasons=reasons,
        score=best_score,
    )


async def evaluate_provisions(
    provisions: list[StoredProvision],
    ctx: TriggerContext,
    *,
    offline_only: bool = False,
) -> list[tuple[StoredProvision, TriggerMatch]]:
    """Evaluate active provisions and return matches ordered by (priority DESC, prov_id ASC)."""
    ordered = sorted(provisions, key=lambda s: (-s.provision.priority, s.provision.prov_id))
    hits: list[tuple[StoredProvision, TriggerMatch]] = []
    for stored in ordered:
        match = await evaluate_single_provision(stored, ctx, offline_only=offline_only)
        if match is not None:
            hits.append((stored, match))
    return hits
