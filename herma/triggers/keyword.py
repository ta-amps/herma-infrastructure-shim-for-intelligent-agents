"""Tier-1 deterministic trigger (~0 ms): keywords, bounded regexes, path globs, and tool names."""

from __future__ import annotations

import fnmatch
import re
from collections.abc import Sequence

from herma.schemas import KeywordTrigger

MAX_TEXT_SCAN_CHARS = 65_536


def evaluate_keyword_trigger(
    spec: KeywordTrigger,
    text: str,
    file_paths: Sequence[str],
    tool_names: Sequence[str],
) -> tuple[bool, list[str], float]:
    """Return (matched, reasons, score) for a KeywordTrigger."""
    bounded = text[:MAX_TEXT_SCAN_CHARS]
    haystack = bounded if spec.case_sensitive else bounded.lower()
    reasons: list[str] = []

    if spec.any_keywords:
        hits = [
            kw
            for kw in spec.any_keywords
            if (kw if spec.case_sensitive else kw.lower()) in haystack
        ]
        if hits:
            reasons.append(f"keyword:any({hits[0]!r})")

    if spec.all_keywords:
        targets = [kw if spec.case_sensitive else kw.lower() for kw in spec.all_keywords]
        if all(t in haystack for t in targets):
            reasons.append(f"keyword:all({','.join(spec.all_keywords[:3])})")
        elif (
            not spec.any_keywords
            and not spec.regex_patterns
            and not spec.path_globs
            and not spec.tool_names
        ):
            return False, [], 0.0

    for pattern in spec.regex_patterns:
        flags = 0 if spec.case_sensitive else re.IGNORECASE
        if re.search(pattern, bounded, flags=flags):
            reasons.append(f"keyword:regex({pattern!r})")
            break

    if spec.path_globs and file_paths:
        for path in file_paths:
            norm_path = path.lstrip("./")
            for glob_pat in spec.path_globs:
                if fnmatch.fnmatch(norm_path, glob_pat) or fnmatch.fnmatch(path, glob_pat):
                    reasons.append(f"keyword:path({glob_pat!r}->{norm_path!r})")
                    break
            if any(r.startswith("keyword:path(") for r in reasons):
                break

    if spec.tool_names and tool_names:
        lower_tools = {t.lower() for t in tool_names}
        for wanted in spec.tool_names:
            if wanted.lower() in lower_tools:
                reasons.append(f"keyword:tool({wanted!r})")
                break

    # If all_keywords was specified alongside other conditions, ensure all_keywords actually matched
    if spec.all_keywords:
        targets = [kw if spec.case_sensitive else kw.lower() for kw in spec.all_keywords]
        if not all(t in haystack for t in targets):
            return False, [], 0.0

    matched = len(reasons) > 0
    return matched, reasons, (1.0 if matched else 0.0)
