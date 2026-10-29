"""Adaptive CallerProfile shimming lenses, deterministic strategy ranking, and budget enforcement."""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, cast

from herma.errors import HermaError
from herma.schemas import (
    CallerProfileId,
    ContextEntry,
    ContextEntryKind,
    RankingStrategy,
    StoredProvision,
    TriggerMatch,
)

DEFAULT_CALLER_PROFILE_ID: CallerProfileId = "coding_harness"


@dataclass(frozen=True)
class CallerProfile:
    """Deterministic adaptive shimming lens tailored to a specific caller role and char budget."""

    profile_id: CallerProfileId
    title: str
    max_chars: int
    strategy: RankingStrategy
    format_style: str
    suppress_code_dumps: bool
    prioritizes: tuple[str, ...]
    preferred_entry_kinds: tuple[ContextEntryKind, ...]
    cue_keywords: tuple[str, ...]
    guidance_summary: str
    description: str

    @property
    def ranking_strategy(self) -> RankingStrategy:
        return self.strategy

    @property
    def profile_guidance_header(self) -> str:
        return (
            f"[CALLER PROFILE LENS: {self.profile_id} | strategy={self.strategy}] "
            f"{self.guidance_summary}"
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "profile_id": self.profile_id,
            "title": self.title,
            "max_chars": self.max_chars,
            "strategy": self.strategy,
            "ranking_strategy": self.strategy,
            "format_style": self.format_style,
            "suppress_code_dumps": self.suppress_code_dumps,
            "prioritizes": list(self.prioritizes),
            "preferred_entry_kinds": list(self.preferred_entry_kinds),
            "profile_guidance_header": self.profile_guidance_header,
            "description": self.description,
        }


CallerProfileSpec = CallerProfile

CALLER_PROFILES_LIST: tuple[CallerProfile, ...] = (
    CallerProfile(
        profile_id="coding_harness",
        title="Coding Harness Lens",
        max_chars=6000,
        strategy="empirical_bayes",
        format_style="terse_technical",
        suppress_code_dumps=False,
        prioritizes=(
            "code_signatures",
            "ast_invariants",
            "lease_cas_fencing",
        ),
        preferred_entry_kinds=("verb", "noun", "detail"),
        cue_keywords=(
            "signature",
            "ast",
            "invariant",
            "lease",
            "fence",
            "fencing",
            "cas",
            "expected_version",
            "put_record",
            "schema",
            "endpoint",
        ),
        guidance_summary=(
            "Prioritize exact code signatures, AST invariants, and atomic lease/CAS fencing "
            "in terse technical format."
        ),
        description=(
            "Default lens for configurable agentic coding harnesses: preserves structured "
            "JSON/type schemas, AST invariants, and lease/CAS fencing rules up to 6000 chars."
        ),
    ),
    CallerProfile(
        profile_id="chat_assistant",
        title="Concise Assistant Lens",
        max_chars=2400,
        strategy="borda_consensus",
        format_style="concise_summary",
        suppress_code_dumps=True,
        prioritizes=(
            "concise_high_signal_summaries",
            "key_takeaways",
            "suppress_verbose_code_dumps",
        ),
        preferred_entry_kinds=("detail", "noun", "verb"),
        cue_keywords=(
            "summary",
            "canonical",
            "overview",
            "concise",
            "budget",
            "contract",
            "direct",
        ),
        guidance_summary=(
            "Deliver concise high-signal summaries within a compact budget and suppress "
            "verbose raw code or schema dumps."
        ),
        description=(
            "Compact 2400-char Borda-consensus lens for brief operator summaries; omits "
            "raw JSON/code bodies from shimmed noun/verb context."
        ),
    ),
    CallerProfile(
        profile_id="swarm_worker",
        title="Autonomous Swarm Worker Lens",
        max_chars=4800,
        strategy="ucb1_explore",
        format_style="atomic_worker_reflex",
        suppress_code_dumps=False,
        prioritizes=(
            "zero_call_reflexes",
            "negative_knowledge_tombstones",
            "expected_version_cas_and_fencing",
        ),
        preferred_entry_kinds=("verb", "noun", "detail"),
        cue_keywords=(
            "negative.knowledge",
            "tombstone",
            "dead-end",
            "dead_end",
            "expected_version",
            "fence",
            "fencing",
            "claim",
            "heartbeat",
            "submit",
            "idempotent",
            "atomic",
        ),
        guidance_summary=(
            "Prioritize 0-call reflexes, negative.knowledge dead-end tombstones, and "
            "expected_version CAS plus monotonic lease fencing."
        ),
        description=(
            "UCB1-ranked 4800-char lens for background swarm workers claiming leased queue "
            "tiles and avoiding previously tombstoned dead ends."
        ),
    ),
    CallerProfile(
        profile_id="ngo_caseworker",
        title="NGO Caseworker Safety Lens",
        max_chars=3200,
        strategy="wilson_lower_bound",
        format_style="plain_non_accusatory",
        suppress_code_dumps=True,
        prioritizes=(
            "safety_caveats",
            "human_only_escalation_boundaries",
            "plain_non_accusatory_language",
            "suppress_raw_code_ast",
        ),
        preferred_entry_kinds=("detail", "noun", "verb"),
        cue_keywords=(
            "human_only",
            "human-only",
            "human reviewer",
            "non-accusatory",
            "safety",
            "crisis",
            "shelter",
            "helpline",
            "intake",
            "synthetic",
            "escalat",
            "survivor",
        ),
        guidance_summary=(
            "Enforce safety caveats, strict human-only escalation boundaries, and plain "
            "non-accusatory language; suppress raw code and AST dumps."
        ),
        description=(
            "Conservative Wilson-lower-bound 3200-char lens for humanitarian and helpline "
            "workflows; strips raw code/schema dumps and elevates human-only boundaries."
        ),
    ),
    CallerProfile(
        profile_id="steward_reviewer",
        title="Governance Steward Reviewer Lens",
        max_chars=5200,
        strategy="wilson_lower_bound",
        format_style="governance_checklist",
        suppress_code_dumps=False,
        prioritizes=(
            "provenance_receipts",
            "quarantine_boundaries",
            "drafter_not_equal_reviewer_checklists",
            "license_checks",
        ),
        preferred_entry_kinds=("detail", "noun", "verb"),
        cue_keywords=(
            "provenance",
            "receipt",
            "quarantine",
            "verified",
            "drafter != reviewer",
            "reviewer",
            "license",
            "spdx",
            "governance",
            "audit",
            "visibility_scope",
        ),
        guidance_summary=(
            "Verify provenance receipts, quarantine boundaries, drafter != reviewer "
            "separation checklists, and SPDX/source license compliance."
        ),
        description=(
            "5200-char Wilson-lower-bound lens for stewards auditing cross-surface artifacts, "
            "quarantine tags, dual-party review gates, and license provenance."
        ),
    ),
    CallerProfile(
        profile_id="benchmark_auditor",
        title="Benchmark & Reproducibility Auditor Lens",
        max_chars=5600,
        strategy="pareto_efficiency",
        format_style="reproducible_metrics",
        suppress_code_dumps=False,
        prioritizes=(
            "sha256_run_fingerprints",
            "null_honest_unmeasured_metrics",
            "ablation_tables",
        ),
        preferred_entry_kinds=("detail", "noun", "verb"),
        cue_keywords=(
            "sha256",
            "sha-256",
            "fingerprint",
            "digest",
            "null",
            "unmeasured",
            "ablation",
            "benchmark",
            "deterministic",
            "parity",
            "latency",
        ),
        guidance_summary=(
            "Require SHA-256 run fingerprints, null-honest reporting for unmeasured metrics, "
            "and reproducible ablation comparisons."
        ),
        description=(
            "5600-char Pareto-efficiency lens for benchmark verification, cryptographic "
            "digest checks, ablation tables, and zero-fabricated telemetry."
        ),
    ),
    CallerProfile(
        profile_id="incident_responder",
        title="Incident Containment & Recovery Lens",
        max_chars=3600,
        strategy="urgency_priority",
        format_style="runbook_steps",
        suppress_code_dumps=False,
        prioritizes=(
            "recovery_playbook_entries",
            "fault_containment",
            "queue_pause_drain_replay_steps",
        ),
        preferred_entry_kinds=("verb", "detail", "noun"),
        cue_keywords=(
            "recovery_playbook",
            "playbook",
            "contain",
            "containment",
            "fault",
            "pause",
            "drain",
            "replay",
            "park",
            "lockdown",
            "revoke",
            "error",
        ),
        guidance_summary=(
            "Prioritize recovery_playbook entries, immediate fault containment, and ordered "
            "queue pause/drain/replay runbook steps."
        ),
        description=(
            "Urgency-ranked 3600-char operational lens surfacing containment guardrails, "
            "recovery playbooks, and safe queue drain/replay verbs first."
        ),
    ),
    CallerProfile(
        profile_id="public_researcher",
        title="Public Researcher & Citation Lens",
        max_chars=5000,
        strategy="pareto_efficiency",
        format_style="cited_evidence",
        suppress_code_dumps=False,
        prioritizes=(
            "primary_citations",
            "dated_sources",
            "benchmark_comparisons",
            "fragility_half_lives",
        ),
        preferred_entry_kinds=("noun", "detail", "verb"),
        cue_keywords=(
            "citation",
            "primary",
            "statute",
            "dated",
            "source",
            "benchmark",
            "comparison",
            "fragility",
            "half-life",
            "half_life",
            "reference",
            "uri",
        ),
        guidance_summary=(
            "Ground claims in primary citations, dated sources, reproducible benchmark "
            "comparisons, and explicit evidence fragility half-lives."
        ),
        description=(
            "5000-char Pareto-efficiency research lens emphasizing primary source URIs, "
            "dated statutory/technical references, and evidence half-life caveats."
        ),
    ),
)

CALLER_PROFILES: dict[CallerProfileId, CallerProfile] = {
    spec.profile_id: spec for spec in CALLER_PROFILES_LIST
}


def list_caller_profiles() -> list[dict[str, Any]]:
    """Return deterministic JSON-serializable descriptors for all 8 CallerProfile lenses."""
    return [spec.to_dict() for spec in CALLER_PROFILES_LIST]


def get_caller_profile(profile_id: str) -> CallerProfile:
    """Validate and return a CallerProfile by ID or raise 400 invalid_caller_profile."""
    cleaned = profile_id.strip().lower()
    spec = CALLER_PROFILES.get(cast(CallerProfileId, cleaned))
    if spec is None:
        valid = ", ".join(CALLER_PROFILES.keys())
        raise HermaError(
            400,
            "invalid_caller_profile",
            "Invalid Caller Profile",
            f"Unknown caller profile {profile_id!r}; expected one of: {valid}.",
        )
    return spec


def resolve_caller_profile(
    headers: Mapping[str, str] | None = None,
    *,
    query_profile: str | None = None,
    body_profile: str | None = None,
) -> tuple[CallerProfile, bool]:
    """Resolve CallerProfile from X-Caller-Profile header, ?profile= query, or body field.

    Returns (profile_spec, explicit_flag). Defaults to ('coding_harness', False) when omitted.
    """
    hdr_val = ""
    if headers is not None:
        for k, v in headers.items():
            if k.lower() == "x-caller-profile" and v and v.strip():
                hdr_val = v.strip()
                break

    q_val = (query_profile or "").strip()
    b_val = (body_profile or "").strip()

    supplied: list[tuple[str, str]] = []
    if hdr_val:
        supplied.append(("X-Caller-Profile", hdr_val))
    if q_val:
        supplied.append(("query ?profile=", q_val))
    if b_val:
        supplied.append(("body caller_profile", b_val))

    if not supplied:
        return CALLER_PROFILES[DEFAULT_CALLER_PROFILE_ID], False

    resolved_specs = [(src, get_caller_profile(val)) for src, val in supplied]
    first_src, first_spec = resolved_specs[0]
    for other_src, other_spec in resolved_specs[1:]:
        if other_spec.profile_id != first_spec.profile_id:
            raise HermaError(
                400,
                "profile_mismatch",
                "Caller Profile Mismatch",
                (
                    f"{first_src} ({first_spec.profile_id!r}) conflicts with "
                    f"{other_src} ({other_spec.profile_id!r})."
                ),
            )
    return first_spec, True


def _wilson_lower_bound(positives: float, total: float, z: float = 1.96) -> float:
    if total <= 0.0 or positives <= 0.0:
        return 0.0
    phat = min(1.0, positives / total)
    z2 = z * z
    denom = 1.0 + z2 / total
    centre = phat + z2 / (2.0 * total)
    radicand = max(0.0, (phat * (1.0 - phat) + z2 / (4.0 * total)) / total)
    return (centre - z * math.sqrt(radicand)) / denom


def _count_cue_hits(haystack_lower: str, cues: Sequence[str]) -> int:
    return sum(1 for cue in cues if cue in haystack_lower)


def score_provision_for_profile(
    stored: StoredProvision,
    match: TriggerMatch,
    profile: CallerProfile,
) -> float:
    """Compute a deterministic strategy-specific relevance score for a matched provision."""
    prov = stored.provision
    meta_flat = " ".join(f"{k}:{v}" for k, v in sorted(prov.metadata_tags.items()))
    uri_flat = " ".join(f"{u.label} {u.uri} {u.kind}" for u in prov.uris)
    refs_flat = " ".join(prov.context_refs)
    haystack = (
        f"{prov.prov_id} {prov.title} {prov.summary} {prov.inject_text} "
        f"{prov.direct_response or ''} {refs_flat} {meta_flat} {uri_flat}"
    ).lower()

    k = _count_cue_hits(haystack, profile.cue_keywords)
    n = max(1, len(profile.cue_keywords))
    p_norm = prov.priority / 1000.0
    char_len = max(
        40,
        len(prov.inject_text or "")
        + len(prov.direct_response or "")
        + 120 * len(prov.context_refs),
    )
    uri_count = len(prov.uris)
    strategy = profile.strategy

    if strategy == "empirical_bayes":
        score = (
            (k + 2.0 * p_norm) / (n + 2.0) + 0.45 * k + 0.35 * p_norm + 0.1 * len(prov.context_refs)
        )
    elif strategy == "borda_consensus":
        conciseness = 1.0 / (1.0 + char_len / 600.0)
        score = conciseness + 0.45 * k + 0.4 * p_norm
    elif strategy == "ucb1_explore":
        reflex_bonus = 1.35 if prov.action == "respond_directly" else 0.0
        tombstone_bonus = (
            0.75
            if (
                "negative.knowledge" in haystack
                or "expected_version" in haystack
                or "fence" in haystack
            )
            else 0.0
        )
        explore_term = math.sqrt(2.0 * math.log(n + 2.0) / (1.0 + max(0, n - k)))
        score = 0.55 * k + 0.4 * p_norm + reflex_bonus + tombstone_bonus + 0.25 * explore_term
    elif strategy == "wilson_lower_bound":
        positives = float(k + (1 if uri_count > 0 else 0))
        total = float(max(2, k + 2))
        score = _wilson_lower_bound(positives, total) + 0.55 * k + 0.35 * p_norm
    elif strategy == "pareto_efficiency":
        gain = 1.0 + 1.4 * k + 0.45 * uri_count + 0.25 * match.score
        cost = 1.0 + char_len / 900.0
        score = (gain / cost) + 0.4 * k + 0.3 * p_norm
    else:  # urgency_priority
        urgent_bonus = (
            1.1
            if any(
                tok in haystack
                for tok in (
                    "recovery_playbook",
                    "playbook",
                    "pause",
                    "drain",
                    "replay",
                    "contain",
                    "lockdown",
                )
            )
            else 0.0
        )
        score = 0.85 * k + 0.65 * p_norm + urgent_bonus

    return round(score, 6)


def rank_provisions_for_profile(
    matches: Sequence[tuple[StoredProvision, TriggerMatch]],
    profile: CallerProfile,
) -> list[tuple[StoredProvision, TriggerMatch]]:
    """Deterministically rank matched provisions under a CallerProfile lens."""
    return sorted(
        matches,
        key=lambda pair: (
            -score_provision_for_profile(pair[0], pair[1], profile),
            -pair[0].provision.priority,
            pair[0].provision.prov_id,
        ),
    )


def score_context_entry_for_profile(
    entry: ContextEntry,
    profile: CallerProfile,
) -> float:
    """Compute a deterministic strategy-specific relevance score for a ContextEntry."""
    body_str = str(entry.schema_or_body) if isinstance(entry.schema_or_body, (dict, str)) else ""
    haystack = (
        f"{entry.entry_id} {entry.kind} {entry.title} {entry.summary} "
        f"{entry.source_uri or ''} {body_str}"
    ).lower()

    k = _count_cue_hits(haystack, profile.cue_keywords)
    n = max(1, len(profile.cue_keywords))
    if entry.kind == profile.preferred_entry_kinds[0]:
        kind_prior = 1.0
    elif len(profile.preferred_entry_kinds) > 1 and entry.kind == profile.preferred_entry_kinds[1]:
        kind_prior = 0.7
    else:
        kind_prior = 0.4

    has_structured_body = bool(
        (isinstance(entry.schema_or_body, dict) and entry.schema_or_body)
        or (isinstance(entry.schema_or_body, str) and entry.schema_or_body.strip())
    )
    char_len = max(24, len(entry.summary) + (0 if profile.suppress_code_dumps else len(body_str)))
    has_uri = 1 if entry.source_uri else 0
    strategy = profile.strategy

    if strategy == "empirical_bayes":
        struct_bonus = 0.35 if has_structured_body else 0.0
        score = (k + 2.0 * kind_prior) / (n + 2.0) + 0.5 * k + 0.3 * kind_prior + struct_bonus
    elif strategy == "borda_consensus":
        conciseness = 1.0 / (1.0 + len(entry.summary) / 200.0)
        score = conciseness + 0.45 * k + 0.35 * kind_prior
    elif strategy == "ucb1_explore":
        tombstone_bonus = (
            1.1
            if (
                "negative.knowledge" in haystack
                or "tombstone" in haystack
                or "dead-end" in haystack
                or "expected_version" in haystack
                or "fence" in haystack
            )
            else 0.0
        )
        score = 0.55 * k + 0.4 * kind_prior + tombstone_bonus
    elif strategy == "wilson_lower_bound":
        score = (
            _wilson_lower_bound(float(k + has_uri), float(max(2, k + 2)))
            + 0.55 * k
            + 0.35 * kind_prior
        )
    elif strategy == "pareto_efficiency":
        gain = 1.0 + 1.3 * k + 0.5 * has_uri
        cost = 1.0 + char_len / 400.0
        score = (gain / cost) + 0.4 * k + 0.25 * kind_prior
    else:  # urgency_priority
        playbook_bonus = (
            1.2
            if any(
                tok in haystack
                for tok in ("recovery_playbook", "playbook", "pause", "drain", "replay", "contain")
            )
            else 0.0
        )
        score = 0.85 * k + 0.4 * kind_prior + playbook_bonus

    return round(score, 6)


def rank_context_entries_for_profile(
    entries: Sequence[ContextEntry],
    profile: CallerProfile,
) -> list[ContextEntry]:
    """Deterministically rank ContextEntry items under a CallerProfile lens."""
    indexed = list(enumerate(entries))
    indexed.sort(
        key=lambda item: (
            -score_context_entry_for_profile(item[1], profile),
            item[0],
        )
    )
    return [entry for _, entry in indexed]
