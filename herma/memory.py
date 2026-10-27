"""Deterministic Anti-RAG top-of-mind entity extraction and candidate rule synthesis (0 LLM calls)."""

from __future__ import annotations

import hashlib
import re
from collections.abc import Sequence

from herma.schemas import (
    EntityKind,
    ExtractedEntity,
    KeywordTrigger,
    Provision,
    ProvisionURI,
    StoredProvision,
    TriggerSpec,
    WorkingEntity,
)

MAX_SCAN_CHARS = 65_536
MAX_ENTITIES_PER_TURN = 64

URL_SPAN_RE = re.compile(r"(?:https?|tessera|mcp)://\S+|urn:[A-Za-z0-9_.:/-]+")
TESSERA_URI_RE = re.compile(r"tessera://(?:blobs|buckets|stores)/[A-Za-z0-9_./:-]+")
NOUN_VERB_URI_RE = re.compile(r"\b(?:noun|verb|detail):[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_./:-]+)?")

FILE_PATH_RE = re.compile(
    r"(?<![A-Za-z0-9_.:/-])(?:\./|\.\./|/)?(?:[A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,10}\b"
)
BACKTICK_FILE_RE = re.compile(
    r"`([A-Za-z0-9_.-]+\.(?:py|js|mjs|ts|tsx|sql|json|jsonc|toml|yaml|yml|md|sh|rs|go))`"
)

DECL_SYMBOL_RE = re.compile(
    r"\b(?:def|class|function|interface|type)\s+([A-Za-z_][A-Za-z0-9_]{1,80})\b"
)
BACKTICK_SYMBOL_RE = re.compile(
    r"`([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+(?:\(\))?|[A-Za-z_][A-Za-z0-9_]{1,80}\(\))`"
)
CALL_SYMBOL_RE = re.compile(r"\b([A-Za-z_][A-Za-z0-9_]{2,64}\(\))")

STATUTE_CARD_RE = re.compile(
    r"\b(?:CARD-[A-Z0-9][A-Z0-9_-]{1,48}|(?:US|UK|EU|AU|CA|SG|IN|GLOBAL|UN|INTL)-[A-Z0-9]{2,16}-[A-Z0-9-]{1,32})\b"
)

EXCEPTION_SIG_RE = re.compile(
    r"\b(?:[A-Za-z_][A-Za-z0-9_.]*\.)?[A-Z][A-Za-z0-9_]*(?:Error|Exception|Conflict|Fault):\s*[^\r\n]{1,140}"
)
HTTP_ERR_SIG_RE = re.compile(
    r"\bHTTP\s+[45]\d{2}(?:\s+[A-Za-z0-9_/-]{2,64}(?:\s+[A-Za-z0-9_/-]{1,32}){0,3})?"
)

FILE_EXTENSIONS = frozenset(
    {
        "py",
        "js",
        "mjs",
        "ts",
        "tsx",
        "sql",
        "json",
        "jsonc",
        "toml",
        "yaml",
        "yml",
        "md",
        "sh",
        "rs",
        "go",
        "css",
        "html",
        "txt",
    }
)
DOMAIN_TLDS = frozenset({"com", "dev", "org", "io", "net", "ai", "gov", "edu", "test", "local"})
IGNORED_CALLS = frozenset({"if()", "for()", "while()", "switch()", "catch()", "return()"})
SLUG_CLEAN_RE = re.compile(r"[^A-Z0-9]+")


def _clean_token(raw: str) -> str:
    return raw.strip().rstrip(".,;:)]}'\"`")


def _looks_like_domain_segment(seg: str) -> bool:
    if "." not in seg or seg.startswith("."):
        return False
    tld = seg.rsplit(".", 1)[-1].lower()
    return tld in DOMAIN_TLDS


def extract_entities(
    text: str,
    extra_paths: Sequence[str] | None = None,
) -> list[ExtractedEntity]:
    """Deterministically extract top-of-mind entities with 0 LLM calls and 0 embeddings."""
    bounded = text[:MAX_SCAN_CHARS]
    seen: set[tuple[EntityKind, str]] = set()
    results: list[ExtractedEntity] = []

    def _add(kind: EntityKind, raw_val: str) -> None:
        if len(results) >= MAX_ENTITIES_PER_TURN:
            return
        val = " ".join(raw_val.split()).strip()[:240]
        if len(val) < 2:
            return
        key = (kind, val)
        if key not in seen:
            seen.add(key)
            results.append(ExtractedEntity(kind=kind, value=val))

    # 1. tessera_uri: tessera://blobs|buckets|stores/... and noun:*/verb:*/detail:*
    for m in TESSERA_URI_RE.finditer(bounded):
        _add("tessera_uri", _clean_token(m.group(0)))
    for m in NOUN_VERB_URI_RE.finditer(bounded):
        _add("tessera_uri", _clean_token(m.group(0)))

    # 2. file_path: workspace_paths + repo paths outside URLs
    for raw_path in extra_paths or ():
        cleaned_extra = _clean_token(raw_path).lstrip("./")
        if cleaned_extra and not cleaned_extra.startswith(("http://", "https://", "tessera://")):
            _add("file_path", cleaned_extra)

    scrubbed_for_paths = URL_SPAN_RE.sub(" ", bounded)
    for m in FILE_PATH_RE.finditer(scrubbed_for_paths):
        cand = _clean_token(m.group(0))
        norm = cand.lstrip("./")
        first_seg = norm.split("/", 1)[0]
        if _looks_like_domain_segment(first_seg):
            continue
        if norm:
            _add("file_path", norm)
    for m in BACKTICK_FILE_RE.finditer(scrubbed_for_paths):
        _add("file_path", _clean_token(m.group(1)))

    # 3. code_symbol: def/class/function/interface/type + backticked pkg.mod.Symbol / fn()
    for m in DECL_SYMBOL_RE.finditer(bounded):
        _add("code_symbol", m.group(1))
    for m in BACKTICK_SYMBOL_RE.finditer(bounded):
        sym = _clean_token(m.group(1))
        if not sym.endswith("()") and "." in sym:
            tail_ext = sym.rsplit(".", 1)[-1].lower()
            if tail_ext in FILE_EXTENSIONS or _looks_like_domain_segment(sym):
                continue
        _add("code_symbol", sym)
    for m in CALL_SYMBOL_RE.finditer(scrubbed_for_paths):
        call_sym = m.group(1)
        if call_sym.lower() not in IGNORED_CALLS:
            _add("code_symbol", call_sym)

    # 4. statute_card_id: US-ROSCA-8403, UK-OSA2023-S181, CARD-..., etc.
    for m in STATUTE_CARD_RE.finditer(bounded):
        _add("statute_card_id", m.group(0))

    # 5. error_signature: *Error: ..., *Exception: ..., HTTP 4xx/5xx ...
    for m in EXCEPTION_SIG_RE.finditer(bounded):
        _add("error_signature", m.group(0).rstrip(".,;)"))
    for m in HTTP_ERR_SIG_RE.finditer(bounded):
        _add("error_signature", m.group(0).rstrip(".,;)"))

    return results


def estimate_tokens_saved(prompt_text: str, direct_response_text: str | None) -> int:
    """Deterministically estimate upstream tokens saved when respond_directly fires."""
    if not direct_response_text:
        return 0
    raw_chars = len(prompt_text) + len(direct_response_text)
    return max(16, (raw_chars // 4) + 96)


def _slugify_upper(raw: str, max_len: int = 18) -> str:
    cleaned = SLUG_CLEAN_RE.sub("-", raw.upper()).strip("-")
    if not cleaned:
        return "ITEM"
    return cleaned[:max_len].rstrip("-") or "ITEM"


def _short_hash(raw: str, chars: int = 6) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:chars].upper()


def synthesize_candidate_provisions(
    entities: Sequence[WorkingEntity],
    active_provisions: Sequence[StoredProvision],
    *,
    project_tag: str = "default",
) -> list[Provision]:
    """Deterministically synthesize reviewable draft Provision specs without mutating active state."""
    existing_ids = {sp.provision.prov_id for sp in active_provisions}
    shimmed_uris = {u.uri for sp in active_provisions for u in sp.provision.uris}
    shimmed_refs = {ref for sp in active_provisions for ref in sp.provision.context_refs}
    existing_keywords = {
        kw.lower()
        for sp in active_provisions
        if sp.provision.triggers.keyword is not None
        for kw in sp.provision.triggers.keyword.any_keywords
    }

    candidates: list[Provision] = []
    seen_prov_ids: set[str] = set()

    for ent in entities:
        if ent.hit_count < 2:
            continue

        val = ent.entity_value.strip()
        h6 = _short_hash(f"{ent.entity_kind}:{val}")

        if ent.entity_kind == "error_signature":
            head = val.split(":", 1)[0].strip()
            slug = _slugify_upper(head, max_len=20)
            prov_id = f"PROV-CAND-ERR-{slug}-{h6}"[:48].rstrip("-")
            if prov_id in existing_ids or prov_id in seen_prov_ids:
                continue
            kw_list = [head] if len(head) >= 3 else [val[:48]]
            if val[:64].lower() not in {k.lower() for k in kw_list}:
                kw_list.append(val[:64])
            candidates.append(
                Provision(
                    prov_id=prov_id,
                    title=f"Guard Recurring {head[:80]}",
                    summary=(
                        f"Reviewable candidate synthesized from {ent.hit_count} recurring "
                        f"error_signature hits in project {project_tag}."
                    )[:400],
                    priority=220,
                    enabled=True,
                    action="shim_context",
                    inject_position="developer_context",
                    dedupe_mode="once_per_conversation",
                    max_chars=1800,
                    inject_text=(
                        f"Recurring error signature observed ({ent.hit_count}x): {val}. "
                        "Verify preconditions, schema contracts, and compare-and-set versions "
                        "before retrying the failing call."
                    )[:12000],
                    metadata_tags={
                        "review_status": "draft_candidate",
                        "source_kind": "error_signature",
                        "project_tag": project_tag,
                        "hit_count": str(ent.hit_count),
                    },
                    triggers=TriggerSpec(
                        mode="any",
                        keyword=KeywordTrigger(any_keywords=kw_list),
                    ),
                )
            )
            seen_prov_ids.add(prov_id)

        elif ent.entity_kind == "tessera_uri":
            if val in shimmed_uris or val in shimmed_refs or val.lower() in existing_keywords:
                continue
            slug = _slugify_upper(val.split("/")[-1].split(":")[-1], max_len=18)
            prov_id = f"PROV-CAND-URI-{slug}-{h6}"[:48].rstrip("-")
            if prov_id in existing_ids or prov_id in seen_prov_ids:
                continue
            is_context_ref = val.startswith(("noun:", "verb:", "detail:"))
            uris = (
                []
                if is_context_ref
                else [
                    ProvisionURI(
                        uri=val,
                        label=f"Hot Tessera Resource ({val[:60]})",
                        kind="store_record",
                    )
                ]
            )
            refs = [val] if is_context_ref else []
            candidates.append(
                Provision(
                    prov_id=prov_id,
                    title=f"Shim Hot Tessera Context {val[:80]}",
                    summary=(
                        f"Reviewable candidate synthesized from {ent.hit_count} un-shimmed "
                        f"tessera_uri hits in project {project_tag}."
                    )[:400],
                    priority=210,
                    enabled=True,
                    action="shim_context",
                    context_refs=refs,
                    inject_position="system_suffix",
                    dedupe_mode="once_per_conversation",
                    max_chars=2200,
                    inject_text=(
                        f"Attach authoritative Tessera resource {val} whenever this noun, verb, "
                        "or artifact is referenced so turns remain grounded without re-querying."
                    ),
                    uris=uris,
                    metadata_tags={
                        "review_status": "draft_candidate",
                        "source_kind": "tessera_uri",
                        "project_tag": project_tag,
                        "hit_count": str(ent.hit_count),
                    },
                    triggers=TriggerSpec(
                        mode="any",
                        keyword=KeywordTrigger(any_keywords=[val]),
                    ),
                )
            )
            seen_prov_ids.add(prov_id)

        elif ent.entity_kind == "statute_card_id":
            if val.lower() in existing_keywords:
                continue
            slug = _slugify_upper(val, max_len=20)
            prov_id = f"PROV-CAND-CARD-{slug}-{h6}"[:48].rstrip("-")
            if prov_id in existing_ids or prov_id in seen_prov_ids:
                continue
            candidates.append(
                Provision(
                    prov_id=prov_id,
                    title=f"Shim Statute Card {val[:80]} Guardrails",
                    summary=(
                        f"Reviewable candidate synthesized from {ent.hit_count} un-shimmed "
                        f"statute_card_id hits in project {project_tag}."
                    )[:400],
                    priority=230,
                    enabled=True,
                    action="shim_context",
                    inject_position="system_suffix",
                    dedupe_mode="once_per_conversation",
                    max_chars=2000,
                    inject_text=(
                        f"When evaluating statute card {val}, tie risk indicators strictly to "
                        "primary statutory elements and deterministic arithmetic without "
                        "making accusatory claims."
                    ),
                    uris=[
                        ProvisionURI(
                            uri=f"urn:herma:statute-card:{val}",
                            label=f"Statute Card {val}",
                            kind="statute_card",
                        )
                    ],
                    metadata_tags={
                        "review_status": "draft_candidate",
                        "source_kind": "statute_card_id",
                        "project_tag": project_tag,
                        "hit_count": str(ent.hit_count),
                    },
                    triggers=TriggerSpec(
                        mode="any",
                        keyword=KeywordTrigger(any_keywords=[val]),
                    ),
                )
            )
            seen_prov_ids.add(prov_id)

    return candidates
