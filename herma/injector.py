"""Extracts signals and deterministic entities from payloads and shims rules, URIs, and noun/verb context."""

from __future__ import annotations

import copy
import re
import secrets
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from herma.harness_gate import HarnessPrincipal, refuse_contributor_model
from herma.memory import extract_entities
from herma.profiles import (
    CALLER_PROFILES,
    DEFAULT_CALLER_PROFILE_ID,
    CallerProfile,
    rank_context_entries_for_profile,
    rank_provisions_for_profile,
)
from herma.schemas import (
    ContextEntry,
    ExtractedEntity,
    InjectionReceipt,
    StoredProvision,
    TriggerMatch,
    TriggerTier,
    WireFormat,
)
from herma.store import canonical_json, sha256_canonical
from herma.triggers.engine import TriggerContext

PATH_TOKEN_RE = re.compile(r"(?:[A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,8}")
PROVISION_MARKER_RE = re.compile(r"\[HERMA PROVISION:\s*(PROV-[A-Z0-9-]+)@v\d+")


@dataclass(frozen=True)
class ExtractedEnvelope:
    """Normalized view of an outbound coding-harness LLM request plus extracted entities."""

    wire_format: WireFormat
    model: str
    trigger_context: TriggerContext
    existing_provision_ids: frozenset[str]
    extracted_entities: list[ExtractedEntity] = field(default_factory=list)
    has_profile_lens: bool = False


def _flatten_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                for key in ("text", "input_text", "content"):
                    val = item.get(key)
                    if isinstance(val, str):
                        parts.append(val)
        return "\n".join(parts)
    if isinstance(content, dict):
        return str(content.get("text") or content.get("content") or "")
    return ""


def _extract_tools(payload: dict[str, Any]) -> list[str]:
    names: list[str] = []
    raw_tools = payload.get("tools")
    if isinstance(raw_tools, list):
        for t in raw_tools:
            if isinstance(t, dict):
                fn = t.get("function")
                if isinstance(fn, dict) and isinstance(fn.get("name"), str):
                    names.append(fn["name"])
                elif isinstance(t.get("name"), str):
                    names.append(t["name"])
    return names


def extract_envelope(
    wire_format: WireFormat,
    payload: dict[str, Any],
    extra_paths: list[str] | None = None,
) -> ExtractedEnvelope:
    model = str(payload.get("model") or "unknown")
    refuse_contributor_model(model)

    all_chunks: list[str] = []
    active_chunks: list[str] = []

    if wire_format in ("chat_completions", "dry_run") and isinstance(payload.get("messages"), list):
        msgs = payload["messages"]
        for m in msgs:
            if isinstance(m, dict):
                txt = _flatten_content(m.get("content"))
                all_chunks.append(txt)
                if m.get("role") in ("user", "tool"):
                    active_chunks.append(txt)
    elif wire_format == "responses" or "input" in payload:
        inst = payload.get("instructions")
        if isinstance(inst, str):
            all_chunks.append(inst)
        inp = payload.get("input")
        if isinstance(inp, str):
            all_chunks.append(inp)
            active_chunks.append(inp)
        elif isinstance(inp, list):
            for item in inp:
                txt = _flatten_content(item)
                all_chunks.append(txt)
                if not isinstance(item, dict) or item.get("role") != "system":
                    active_chunks.append(txt)
    elif wire_format == "messages":
        sys_block = _flatten_content(payload.get("system"))
        if sys_block:
            all_chunks.append(sys_block)
        msgs = payload.get("messages", [])
        if isinstance(msgs, list):
            for m in msgs:
                if isinstance(m, dict):
                    txt = _flatten_content(m.get("content"))
                    all_chunks.append(txt)
                    if m.get("role") == "user":
                        active_chunks.append(txt)

    full_history_text = "\n".join(c for c in all_chunks if c)
    # Trigger primarily on the latest turn(s) so stale turns do not re-fire unrelated rules:
    recent_text = "\n".join(active_chunks[-3:]) if active_chunks else full_history_text
    latest_turn_text = active_chunks[-1] if active_chunks else recent_text
    existing_ids = frozenset(PROVISION_MARKER_RE.findall(full_history_text))

    entities = extract_entities(latest_turn_text, extra_paths=extra_paths)
    entity_paths = [e.value for e in entities if e.kind == "file_path"]
    detected_paths = list(
        dict.fromkeys([*(extra_paths or []), *entity_paths, *PATH_TOKEN_RE.findall(recent_text)])
    )
    tool_names = _extract_tools(payload)

    return ExtractedEnvelope(
        wire_format=wire_format,
        model=model,
        trigger_context=TriggerContext(
            text=recent_text,
            file_paths=detected_paths,
            tool_names=tool_names,
        ),
        existing_provision_ids=existing_ids,
        extracted_entities=entities,
        has_profile_lens="[CALLER PROFILE LENS:" in full_history_text,
    )


def render_context_entries_block(
    refs: Sequence[str],
    context_entries: Mapping[str, ContextEntry] | None,
    *,
    profile: CallerProfile | None = None,
    profile_explicit: bool = False,
    max_context_chars: int | None = None,
) -> tuple[str, list[str], list[str]]:
    """Format matched atomic noun/verb/detail database entries into a bounded context block."""
    if not refs or not context_entries:
        return "", [], []

    unique_entries: list[ContextEntry] = []
    seen_ids: set[str] = set()
    for ref in refs:
        entry = context_entries.get(ref)
        if entry is None or entry.entry_id in seen_ids:
            continue
        seen_ids.add(entry.entry_id)
        unique_entries.append(entry)

    if not unique_entries:
        return "", [], []

    ordered_entries = (
        rank_context_entries_for_profile(unique_entries, profile)
        if (profile is not None and profile_explicit)
        else unique_entries
    )
    suppress_code = bool(profile is not None and profile_explicit and profile.suppress_code_dumps)

    lines: list[str] = []
    shimmed_refs: list[str] = []
    entry_uris: list[str] = []
    wrapper_overhead = len("[NOUN/VERB CONTEXT]\n\n[/NOUN/VERB CONTEXT]")
    used_line_chars = 0

    for entry in ordered_entries:
        if suppress_code:
            body_excerpt = ""
        elif isinstance(entry.schema_or_body, dict) and entry.schema_or_body:
            body_excerpt = canonical_json(entry.schema_or_body)
        elif isinstance(entry.schema_or_body, str) and entry.schema_or_body.strip():
            body_excerpt = entry.schema_or_body.strip()
        else:
            body_excerpt = ""
        if len(body_excerpt) > 320:
            body_excerpt = body_excerpt[:319].rstrip() + "..."

        line = f"- [{entry.kind.upper()}] {entry.entry_id} ({entry.title}): {entry.summary.strip()}"
        if body_excerpt:
            line += f" -- {body_excerpt}"
        if entry.source_uri:
            line += f" [URI: {entry.source_uri}]"

        if max_context_chars is not None:
            sep_len = 1 if lines else 0
            projected = wrapper_overhead + used_line_chars + sep_len + len(line)
            if projected > max_context_chars:
                avail = max_context_chars - wrapper_overhead - used_line_chars - sep_len
                if not lines and avail >= 64:
                    line = line[: avail - 3].rstrip() + "..."
                else:
                    continue
            used_line_chars += sep_len + len(line)

        lines.append(line)
        shimmed_refs.append(entry.entry_id)
        if entry.source_uri and entry.source_uri not in entry_uris:
            entry_uris.append(entry.source_uri)

    if not lines:
        return "", [], []
    return (
        "\n".join(["[NOUN/VERB CONTEXT]", *lines, "[/NOUN/VERB CONTEXT]"]),
        shimmed_refs,
        entry_uris,
    )


def render_provision_block(
    stored: StoredProvision,
    context_entries: Mapping[str, ContextEntry] | None = None,
    *,
    profile: CallerProfile | None = None,
    profile_explicit: bool = False,
    max_block_chars: int | None = None,
) -> tuple[str, list[str], list[str]]:
    """Render a deterministic, bounded provision + atomic noun/verb context + URI block."""
    prov = stored.provision
    effective_max = (
        min(prov.max_chars, max_block_chars) if max_block_chars is not None else prov.max_chars
    )
    header = f"[HERMA PROVISION: {prov.prov_id}@v{stored.version} | {prov.title}]"
    footer = f"[/HERMA PROVISION: {prov.prov_id}]"
    lines = [header]
    if prov.inject_text.strip():
        inject_txt = prov.inject_text.strip()
        if profile_explicit and len(inject_txt) > max(120, effective_max // 2):
            cap_txt = max(120, effective_max - 220)
            if len(inject_txt) > cap_txt:
                inject_txt = inject_txt[: cap_txt - 3].rstrip() + "..."
        lines.append(inject_txt)

    uri_lines: list[str] = []
    prov_uris: list[str] = []
    if prov.uris:
        uri_lines.append("Authoritative References & URIs:")
        for u in prov.uris:
            if u.uri not in prov_uris:
                prov_uris.append(u.uri)
            u_line = f"- [{u.label}]({u.uri}) ({u.kind})"
            if u.inline_excerpt and not (
                profile is not None and profile_explicit and profile.suppress_code_dumps
            ):
                u_line += f": {u.inline_excerpt.strip()}"
            uri_lines.append(u_line)

    ctx_budget: int | None = None
    if profile_explicit or max_block_chars is not None:
        fixed_chars = (
            sum(len(x) + 1 for x in lines) + sum(len(x) + 1 for x in uri_lines) + len(footer)
        )
        ctx_budget = max(0, effective_max - fixed_chars)

    ctx_block, shimmed_refs, ctx_uris = render_context_entries_block(
        prov.context_refs,
        context_entries,
        profile=profile,
        profile_explicit=profile_explicit,
        max_context_chars=ctx_budget,
    )
    if ctx_block:
        lines.append(ctx_block)

    injected_uris: list[str] = list(ctx_uris)
    for u_str in prov_uris:
        if u_str not in injected_uris:
            injected_uris.append(u_str)
    if uri_lines:
        lines.extend(uri_lines)
    lines.append(footer)
    rendered = "\n".join(lines)
    if len(rendered) > effective_max:
        cut = max(0, effective_max - (len(footer) + 2))
        rendered = rendered[:cut].rstrip() + f"\n{footer}"
    return rendered, injected_uris, shimmed_refs


def _apply_block_to_payload(
    wire_format: WireFormat,
    payload: dict[str, Any],
    prefix_blocks: list[str],
    suffix_blocks: list[str],
    dev_blocks: list[str],
) -> dict[str, Any]:
    mutated = copy.deepcopy(payload)
    combined_sys_prefix = "\n\n".join(prefix_blocks)
    combined_sys_suffix = "\n\n".join([*suffix_blocks, *dev_blocks])
    full_addition = "\n\n".join(b for b in (combined_sys_prefix, combined_sys_suffix) if b)
    if not full_addition:
        return mutated

    if wire_format == "responses" or ("input" in mutated and "messages" not in mutated):
        existing_inst = str(mutated.get("instructions") or "").strip()
        parts = [p for p in (combined_sys_prefix, existing_inst, combined_sys_suffix) if p]
        mutated["instructions"] = "\n\n".join(parts)
        return mutated

    if (
        wire_format == "messages"
        and "messages" in mutated
        and "max_tokens" in mutated
        and not any(
            isinstance(m, dict) and m.get("role") == "system" for m in mutated.get("messages", [])
        )
    ):
        existing_sys = _flatten_content(mutated.get("system")).strip()
        parts = [p for p in (combined_sys_prefix, existing_sys, combined_sys_suffix) if p]
        mutated["system"] = "\n\n".join(parts)
        return mutated

    # Default: OpenAI chat_completions envelope
    msgs = list(mutated.get("messages") or [])
    sys_idx = next(
        (i for i, m in enumerate(msgs) if isinstance(m, dict) and m.get("role") == "system"),
        None,
    )
    if sys_idx is not None:
        orig = _flatten_content(msgs[sys_idx].get("content")).strip()
        parts = [p for p in (combined_sys_prefix, orig, combined_sys_suffix) if p]
        updated_msg = dict(msgs[sys_idx])
        updated_msg["content"] = "\n\n".join(parts)
        msgs[sys_idx] = updated_msg
    else:
        msgs.insert(0, {"role": "system", "content": full_addition})
    mutated["messages"] = msgs
    return mutated


def extract_shimmed_preview(
    wire_format: WireFormat,
    augmented_payload: dict[str, Any],
    receipt: InjectionReceipt,
) -> str:
    """Extract the shimmed system/instructions text or direct response for side-by-side diffs."""
    if receipt.responded_directly and receipt.direct_response_text is not None:
        return receipt.direct_response_text
    if wire_format == "responses" or (
        "input" in augmented_payload and "messages" not in augmented_payload
    ):
        return str(augmented_payload.get("instructions") or "")
    if wire_format == "messages" and "system" in augmented_payload:
        return _flatten_content(augmented_payload.get("system"))
    msgs = augmented_payload.get("messages")
    if isinstance(msgs, list):
        for m in msgs:
            if isinstance(m, dict) and m.get("role") == "system":
                return _flatten_content(m.get("content"))
    return ""


def assemble_augmented_request(
    *,
    principal: HarnessPrincipal,
    envelope: ExtractedEnvelope,
    payload: dict[str, Any],
    matches: list[tuple[StoredProvision, TriggerMatch]],
    max_total_chars: int = 8000,
    context_entries: Mapping[str, ContextEntry] | None = None,
    project_tag: str = "default",
    caller_profile: CallerProfile | None = None,
    profile_explicit: bool = False,
) -> tuple[dict[str, Any], InjectionReceipt]:
    """Shim matched rules + noun/verb context or prepare a direct response, and mint SHA-256 receipt."""
    active_profile = caller_profile or CALLER_PROFILES[DEFAULT_CALLER_PROFILE_ID]
    effective_total_chars = (
        min(max_total_chars, active_profile.max_chars) if profile_explicit else max_total_chars
    )
    ordered_matches = (
        rank_provisions_for_profile(matches, active_profile) if profile_explicit else list(matches)
    )

    prefix_blocks: list[str] = []
    suffix_blocks: list[str] = []
    dev_blocks: list[str] = []

    fired_ids: list[str] = []
    deduped_skipped: list[str] = []
    tiers_seen: list[TriggerTier] = []
    uris_injected: list[str] = []
    shimmed_context_refs: list[str] = []
    responded_directly = False
    direct_response_text: str | None = None
    chars_used = 0

    want_lens_header = bool(profile_explicit and not envelope.has_profile_lens)
    lens_header = active_profile.profile_guidance_header if want_lens_header else ""
    lens_reserved = len(lens_header) if want_lens_header else 0

    for stored, match in ordered_matches:
        prov = stored.provision
        if (
            prov.dedupe_mode == "once_per_conversation"
            and prov.prov_id in envelope.existing_provision_ids
        ):
            deduped_skipped.append(prov.prov_id)
            continue

        if prov.action == "respond_directly" and prov.direct_response:
            if not responded_directly:
                responded_directly = True
                base_direct = prov.direct_response.strip()
                direct_cap = (
                    min(prov.max_chars, effective_total_chars)
                    if profile_explicit
                    else prov.max_chars
                )
                prefix_part = f"{lens_header}\n\n{base_direct}" if lens_header else base_direct
                ctx_cap = max(0, direct_cap - len(prefix_part) - 2) if profile_explicit else None
                ctx_block, c_refs, c_uris = render_context_entries_block(
                    prov.context_refs,
                    context_entries,
                    profile=active_profile,
                    profile_explicit=profile_explicit,
                    max_context_chars=ctx_cap,
                )
                rendered_direct = f"{prefix_part}\n\n{ctx_block}" if ctx_block else prefix_part
                if len(rendered_direct) > direct_cap:
                    rendered_direct = rendered_direct[:direct_cap].rstrip()
                direct_response_text = rendered_direct
                chars_used += len(rendered_direct)
                fired_ids.append(f"{prov.prov_id}@v{stored.version}")
                for tier in match.matched_tiers:
                    if tier not in tiers_seen:
                        tiers_seen.append(tier)
                for r in c_refs:
                    if r not in shimmed_context_refs:
                        shimmed_context_refs.append(r)
                for u_str in [*c_uris, *(u.uri for u in prov.uris)]:
                    if u_str not in uris_injected:
                        uris_injected.append(u_str)
            continue

        remaining_for_blocks = effective_total_chars - chars_used - lens_reserved
        if profile_explicit and remaining_for_blocks < 160:
            continue

        block, block_uris, block_refs = render_provision_block(
            stored,
            context_entries,
            profile=active_profile,
            profile_explicit=profile_explicit,
            max_block_chars=remaining_for_blocks if profile_explicit else None,
        )
        if chars_used + lens_reserved + len(block) > effective_total_chars:
            continue

        chars_used += len(block)
        fired_ids.append(f"{prov.prov_id}@v{stored.version}")
        for tier in match.matched_tiers:
            if tier not in tiers_seen:
                tiers_seen.append(tier)
        for u in block_uris:
            if u not in uris_injected:
                uris_injected.append(u)
        for r in block_refs:
            if r not in shimmed_context_refs:
                shimmed_context_refs.append(r)

        if prov.inject_position == "system_prefix":
            prefix_blocks.append(block)
        elif prov.inject_position == "developer_context":
            dev_blocks.append(block)
        else:
            suffix_blocks.append(block)

    if (
        want_lens_header
        and not responded_directly
        and chars_used + len(lens_header) <= effective_total_chars
    ):
        prefix_blocks.insert(0, lens_header)
        chars_used += len(lens_header)

    augmented = _apply_block_to_payload(
        envelope.wire_format,
        payload,
        prefix_blocks,
        suffix_blocks,
        dev_blocks,
    )

    now = time.time()
    receipt_id = f"rcpt_{secrets.token_hex(8)}"
    entities_count = len(envelope.extracted_entities)
    core_for_hash = {
        "receipt_id": receipt_id,
        "harness_kind": principal.harness_kind,
        "key_id": principal.key_id,
        "project_tag": project_tag,
        "wire_format": envelope.wire_format,
        "model": envelope.model,
        "provisions_fired": fired_ids,
        "tiers_matched": tiers_seen,
        "uris_injected": uris_injected,
        "injected_chars": chars_used,
        "deduped_skipped": deduped_skipped,
        "responded_directly": responded_directly,
        "direct_response_text": direct_response_text,
        "shimmed_context_refs": shimmed_context_refs,
        "entities_tracked": entities_count,
        "caller_profile": active_profile.profile_id,
        "ranking_strategy": active_profile.strategy,
    }
    receipt = InjectionReceipt(
        **core_for_hash,
        receipt_sha256=sha256_canonical(core_for_hash),
        created_at=now,
    )
    return augmented, receipt
