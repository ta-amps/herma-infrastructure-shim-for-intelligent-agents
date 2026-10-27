"""Extracts signals from OpenAI/Meta/Anthropic payloads and shims rules, URIs, and noun/verb context."""

from __future__ import annotations

import copy
import re
import secrets
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from herma.harness_gate import HarnessPrincipal, refuse_contributor_model
from herma.schemas import (
    ContextEntry,
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
    """Normalized view of an outbound coding-harness LLM request."""

    wire_format: WireFormat
    model: str
    trigger_context: TriggerContext
    existing_provision_ids: frozenset[str]


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
    # Trigger primarily on the latest turn(s) so stale turns don't re-fire unrelated rules:
    recent_text = "\n".join(active_chunks[-3:]) if active_chunks else full_history_text
    existing_ids = frozenset(PROVISION_MARKER_RE.findall(full_history_text))

    detected_paths = list(
        dict.fromkeys([*(extra_paths or []), *PATH_TOKEN_RE.findall(recent_text)])
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
    )


def render_context_entries_block(
    refs: Sequence[str],
    context_entries: Mapping[str, ContextEntry] | None,
) -> tuple[str, list[str], list[str]]:
    """Format matched atomic noun/verb/detail database entries into a bounded context block."""
    if not refs or not context_entries:
        return "", [], []

    lines: list[str] = []
    shimmed_refs: list[str] = []
    entry_uris: list[str] = []
    for ref in refs:
        entry = context_entries.get(ref)
        if entry is None:
            continue
        if entry.entry_id not in shimmed_refs:
            shimmed_refs.append(entry.entry_id)
        if isinstance(entry.schema_or_body, dict) and entry.schema_or_body:
            body_excerpt = canonical_json(entry.schema_or_body)
        elif isinstance(entry.schema_or_body, str) and entry.schema_or_body.strip():
            body_excerpt = entry.schema_or_body.strip()
        else:
            body_excerpt = ""
        if len(body_excerpt) > 320:
            body_excerpt = body_excerpt[:319].rstrip() + "…"

        line = f"- [{entry.kind.upper()}] {entry.entry_id} ({entry.title}): {entry.summary.strip()}"
        if body_excerpt:
            line += f" — {body_excerpt}"
        if entry.source_uri:
            line += f" [URI: {entry.source_uri}]"
            if entry.source_uri not in entry_uris:
                entry_uris.append(entry.source_uri)
        lines.append(line)

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
) -> tuple[str, list[str], list[str]]:
    """Render a deterministic, bounded provision + atomic noun/verb context + URI block."""
    prov = stored.provision
    header = f"[HERMA PROVISION: {prov.prov_id}@v{stored.version} | {prov.title}]"
    lines = [header]
    if prov.inject_text.strip():
        lines.append(prov.inject_text.strip())

    ctx_block, shimmed_refs, ctx_uris = render_context_entries_block(
        prov.context_refs, context_entries
    )
    if ctx_block:
        lines.append(ctx_block)

    injected_uris: list[str] = list(ctx_uris)
    if prov.uris:
        lines.append("Authoritative References & URIs:")
        for u in prov.uris:
            if u.uri not in injected_uris:
                injected_uris.append(u.uri)
            line = f"- [{u.label}]({u.uri}) ({u.kind})"
            if u.inline_excerpt:
                line += f": {u.inline_excerpt.strip()}"
            lines.append(line)
    lines.append(f"[/HERMA PROVISION: {prov.prov_id}]")
    rendered = "\n".join(lines)
    if len(rendered) > prov.max_chars:
        rendered = (
            rendered[: prov.max_chars - 36].rstrip() + f"\n[/HERMA PROVISION: {prov.prov_id}]"
        )
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


def assemble_augmented_request(
    *,
    principal: HarnessPrincipal,
    envelope: ExtractedEnvelope,
    payload: dict[str, Any],
    matches: list[tuple[StoredProvision, TriggerMatch]],
    max_total_chars: int = 8000,
    context_entries: Mapping[str, ContextEntry] | None = None,
) -> tuple[dict[str, Any], InjectionReceipt]:
    """Shim matched rules + noun/verb context or prepare a direct response, and mint SHA-256 receipt."""
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

    for stored, match in matches:
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
                ctx_block, c_refs, c_uris = render_context_entries_block(
                    prov.context_refs, context_entries
                )
                rendered_direct = f"{base_direct}\n\n{ctx_block}" if ctx_block else base_direct
                if len(rendered_direct) > prov.max_chars:
                    rendered_direct = rendered_direct[: prov.max_chars].rstrip()
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

        block, block_uris, block_refs = render_provision_block(stored, context_entries)
        if chars_used + len(block) > max_total_chars:
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

    augmented = _apply_block_to_payload(
        envelope.wire_format,
        payload,
        prefix_blocks,
        suffix_blocks,
        dev_blocks,
    )

    now = time.time()
    receipt_id = f"rcpt_{secrets.token_hex(8)}"
    core_for_hash = {
        "receipt_id": receipt_id,
        "harness_kind": principal.harness_kind,
        "key_id": principal.key_id,
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
    }
    receipt = InjectionReceipt(
        **core_for_hash,
        receipt_sha256=sha256_canonical(core_for_hash),
        created_at=now,
    )
    return augmented, receipt
