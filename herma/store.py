"""SQLite WAL caller-isolated store, atomic CAS, governance lens, entity memory, and outcome telemetry."""

from __future__ import annotations

import hashlib
import json
import re
import secrets
import sqlite3
import time
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast
from urllib.parse import quote

import httpx
from tessera.errors import NotFound as TesseraNotFound
from tessera.store import Store as TesseraStore

from herma.errors import (
    BuiltinProtectedError,
    ContextConflictError,
    HarnessRequiredError,
    HermaError,
    ProvisionConflictError,
    ProvisionNotFoundError,
)
from herma.harness_gate import (
    HarnessPrincipal,
    hash_secret,
    parse_bearer_or_header,
    verify_secret_constant_time,
)
from herma.memory import (
    estimate_tokens_saved,
    extract_entities,
    synthesize_candidate_provisions,
)
from herma.schemas import (
    ALLOWED_URI_SCHEMES,
    SURFACE_ID_PATTERN,
    SYSTEM_BUILTIN_SCOPE,
    ContextEntry,
    ContextEntryKind,
    EntityKind,
    ExtractedEntity,
    HandshakeRequest,
    HandshakeResponse,
    HarnessKeyInfo,
    HarnessKind,
    HarnessScope,
    InjectionReceipt,
    InsightsResponse,
    OutcomeKind,
    OutcomeReportRequest,
    Provision,
    ProvisionURI,
    RuleOutcomeRecord,
    RuleTelemetry,
    StoredProvision,
    WorkingEntity,
)

BLOB_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
SAFE_BUCKET_SEG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_./:-]{0,511}$")
GOV_ENVELOPE_KEYS = frozenset(
    {
        "governance",
        "tags",
        "status",
        "quarantined",
        "visibility_scope",
        "allowed_surfaces",
        "producer_surface",
        "cohort",
        "cohorts",
        "target_cohort",
        "target_cohorts",
        "allowed_cohorts",
        "allowed_harnesses",
        "owner_key_id",
        "namespace",
    }
)
KNOWN_STATUS_VALUES = frozenset(
    {"quarantined", "verified", "unverified", "pending", "rejected", "draft"}
)
# Fabric records Herma imports must name one of these producers: the two public surfaces (Eranos, Agora)
# and the two infrastructure services (Tessera, Herma). A retired surface is not listed, so it grants nothing.
TRUSTED_PRODUCER_SURFACES = frozenset(
    {"surface:tessera", "surface:eranos", "surface:herma", "surface:agora"}
)

SCHEMA_SQL = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS route_quotas (caller_scope TEXT NOT NULL, hour INTEGER NOT NULL, used INTEGER NOT NULL, PRIMARY KEY (caller_scope, hour));

CREATE TABLE IF NOT EXISTS provisions (
    caller_scope TEXT NOT NULL DEFAULT 'system_builtin',
    prov_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    content_sha256 TEXT NOT NULL,
    source_store TEXT NOT NULL,
    body_json TEXT NOT NULL,
    updated_at REAL NOT NULL,
    PRIMARY KEY (caller_scope, prov_id)
);

CREATE TABLE IF NOT EXISTS context_entries (
    caller_scope TEXT NOT NULL DEFAULT 'system_builtin',
    entry_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    body_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (caller_scope, entry_id)
);
CREATE INDEX IF NOT EXISTS idx_context_scope_kind ON context_entries (caller_scope, kind, entry_id);

CREATE TABLE IF NOT EXISTS harness_keys (
    key_id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    harness_kind TEXT NOT NULL,
    scopes_json TEXT NOT NULL,
    secret_sha256 TEXT NOT NULL,
    created_at REAL NOT NULL,
    revoked_at REAL
);

CREATE TABLE IF NOT EXISTS injection_receipts (
    receipt_id TEXT PRIMARY KEY,
    caller_scope TEXT NOT NULL DEFAULT 'system_builtin',
    project_tag TEXT NOT NULL DEFAULT 'default',
    receipt_sha256 TEXT NOT NULL,
    body_json TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_receipts_scope_time
    ON injection_receipts (caller_scope, project_tag, created_at DESC);

CREATE TABLE IF NOT EXISTS working_entities (
    caller_scope TEXT NOT NULL,
    project_tag TEXT NOT NULL DEFAULT 'default',
    entity_kind TEXT NOT NULL,
    entity_value TEXT NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 1,
    first_seen_at REAL NOT NULL,
    last_seen_at REAL NOT NULL,
    last_receipt_id TEXT NOT NULL,
    PRIMARY KEY (caller_scope, project_tag, entity_kind, entity_value)
);
CREATE INDEX IF NOT EXISTS idx_working_entities_hot
    ON working_entities (caller_scope, project_tag, hit_count DESC, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS rule_outcomes (
    outcome_id TEXT PRIMARY KEY,
    caller_scope TEXT NOT NULL,
    project_tag TEXT NOT NULL DEFAULT 'default',
    receipt_id TEXT NOT NULL,
    prov_id TEXT NOT NULL,
    outcome TEXT NOT NULL,
    tokens_saved_est INTEGER NOT NULL DEFAULT 0,
    latency_ms REAL NOT NULL DEFAULT 0.0,
    error_signature TEXT,
    created_at REAL NOT NULL,
    UNIQUE (caller_scope, receipt_id, prov_id)
);
CREATE INDEX IF NOT EXISTS idx_rule_outcomes_scope
    ON rule_outcomes (caller_scope, project_tag, prov_id, created_at DESC);
"""


def canonical_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_canonical(obj: Any) -> str:
    return hashlib.sha256(canonical_json(obj).encode("utf-8")).hexdigest()


def validate_blob_sha256(blob_sha: str) -> str:
    cleaned = blob_sha.strip()
    if not BLOB_SHA256_RE.fullmatch(cleaned):
        raise HermaError(
            400,
            "invalid_blob_sha",
            "Invalid Tessera Blob Digest",
            f"Tessera blob digest {blob_sha!r} must match ^[0-9a-f]{{64}}$.",
        )
    return cleaned


def verify_blob_bytes(blob_sha: str, raw_bytes: bytes) -> str:
    expected = validate_blob_sha256(blob_sha)
    actual = hashlib.sha256(raw_bytes).hexdigest()
    if actual != expected:
        raise HermaError(
            422,
            "blob_integrity_mismatch",
            "Tessera Blob Integrity Mismatch",
            f"Blob SHA-256 verification failed: expected {expected}, got {actual}.",
        )
    return raw_bytes.decode("utf-8", errors="replace")[:780]


def _split_csv_or_list(raw: Any) -> list[str]:
    if isinstance(raw, str):
        return [p.strip() for p in raw.split(",") if p.strip()]
    if isinstance(raw, Sequence) and not isinstance(raw, (bytes, bytearray)):
        return [str(p).strip() for p in raw if str(p).strip()]
    return []


def _canonical_governance(
    raw_item: Any, extra_envelope: Mapping[str, Any] | None = None
) -> dict[str, Any]:
    """Read only transport governance when present; record payload cannot override its ACL."""
    source = extra_envelope if extra_envelope is not None else raw_item
    if not isinstance(source, Mapping):
        return {}
    gov = source.get("governance", source)
    if not isinstance(gov, Mapping):
        return {}
    fields = (
        "namespace",
        "producer_surface",
        "visibility_scope",
        "allowed_surfaces",
        "target_cohorts",
        "tags",
        "owner_key_id",
    )
    return {key: gov[key] for key in fields if key in gov}


def passes_governance_lens(
    raw_item: Any,
    *,
    namespace: str = "herma.provisions",
    harness_kind: str | None = None,
    cohort: str = "",
    extra_envelope: Mapping[str, Any] | None = None,
    trusted_local: bool = False,
) -> bool:
    """Fail closed for fabric imports; stored caller-owned rules are trusted separately."""
    _ = namespace
    raw = raw_item if isinstance(raw_item, Mapping) else {}
    meta = raw.get("metadata_tags", {})
    meta = meta if isinstance(meta, Mapping) else {}
    gov = _canonical_governance(raw, extra_envelope)
    if not trusted_local:
        required = (
            "namespace",
            "producer_surface",
            "visibility_scope",
            "allowed_surfaces",
            "target_cohorts",
            "tags",
        )
        if any(key not in gov for key in required):
            return False
        if not isinstance(gov["namespace"], str) or not gov["namespace"].strip():
            return False
        producer = gov["producer_surface"]
        if not isinstance(producer, str) or producer not in TRUSTED_PRODUCER_SURFACES:
            return False
        if any(
            not isinstance(gov[key], list) or any(not isinstance(x, str) for x in gov[key])
            for key in ("allowed_surfaces", "target_cohorts", "tags")
        ):
            return False
        if "status:verified" not in gov["tags"] or "status:quarantined" in gov["tags"]:
            return False
        if gov["visibility_scope"] == "allowlist_surfaces":
            if "surface:herma" not in gov["allowed_surfaces"]:
                return False
        elif gov["visibility_scope"] != "public_commons":
            return False
        # Never reinterpret private or malformed legacy fields as public authority.
        if any(key in raw and raw[key] != gov.get(key) for key in required):
            return False
    tags = set(_split_csv_or_list(gov.get("tags"))) | set(_split_csv_or_list(meta.get("tags")))
    tags.update(_split_csv_or_list(meta.get("status")))
    if "status:quarantined" in tags or raw.get("quarantined") is True:
        return False
    if any(t.startswith("status:") and t != "status:verified" for t in tags):
        return False
    targets = set(_split_csv_or_list(gov.get("target_cohorts")))
    for key in ("cohort", "cohorts", "target_cohort", "target_cohorts", "allowed_cohorts"):
        targets.update(_split_csv_or_list(meta.get(key)))
    if not trusted_local and not targets:
        return False
    if targets and "all" not in targets:
        caller = set(_split_csv_or_list(cohort))
        caller.update(f"cohort:{item}" for item in list(caller) if ":" not in item)
        if harness_kind:
            caller.add(f"harness:{harness_kind}")
        if not caller.intersection(targets):
            return False
    return True


def _strip_governance_envelope_for_provision(
    raw_val: dict[str, Any],
    extra_envelope: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Keep verified transport governance intact for every subsequent injection."""
    cleaned = {k: v for k, v in raw_val.items() if k not in GOV_ENVELOPE_KEYS}
    meta = dict(cleaned.get("metadata_tags") or {})
    meta["fabric_governance"] = json.dumps(
        _canonical_governance(raw_val, extra_envelope), sort_keys=True
    )
    cleaned["metadata_tags"] = meta
    return cleaned


def _strip_governance_envelope_for_context(
    raw_val: dict[str, Any], extra_envelope: Mapping[str, Any] | None = None
) -> dict[str, Any]:
    result = {k: v for k, v in raw_val.items() if k not in GOV_ENVELOPE_KEYS}
    result["governance"] = _canonical_governance(raw_val, extra_envelope)
    return result


def provision_passes_lens(
    stored: StoredProvision,
    *,
    harness_kind: str,
    cohort: str = "",
) -> bool:
    trusted = stored.source_store in {
        "local",
        "system_builtin",
        "examples",
    } or stored.source_store.startswith("harness:")
    if trusted:
        raw: dict[str, Any] = {"metadata_tags": stored.provision.metadata_tags}
    else:
        try:
            raw = {
                "governance": json.loads(
                    stored.provision.metadata_tags.get("fabric_governance", "{}")
                )
            }
        except (TypeError, ValueError):
            return False
    return passes_governance_lens(
        raw, harness_kind=harness_kind, cohort=cohort, trusted_local=trusted
    )


def _parse_tessera_context_ref(ref: str) -> tuple[ContextEntryKind, str, str] | None:
    """Parse refs like 'noun:<store>/<key>' or 'verb:<store>/<key>' into (kind, store, key)."""
    kind_raw, sep, remainder = ref.strip().partition(":")
    if not sep or kind_raw not in ("noun", "verb", "detail"):
        return None
    store_ns, slash, rec_key = remainder.partition("/")
    if not slash or not store_ns.strip() or not rec_key.strip():
        return None
    return cast(ContextEntryKind, kind_raw), store_ns.strip(), rec_key.strip()


def _value_to_context_entry(
    ref: str,
    kind: ContextEntryKind,
    store_ns: str,
    rec_key: str,
    raw_val: Any,
) -> ContextEntry:
    default_uri = f"tessera://stores/{store_ns}/{rec_key}"
    if isinstance(raw_val, dict):
        title = str(raw_val.get("title") or f"{kind.title()} {store_ns}/{rec_key}")[:160]
        summary = str(
            raw_val.get("summary")
            or f"Synced {kind} context from Tessera store {store_ns}/{rec_key}."
        )[:600]
        raw_body = raw_val.get("schema_or_body", _strip_governance_envelope_for_context(raw_val))
        schema_or_body: dict[str, Any] | str = (
            raw_body if isinstance(raw_body, (dict, str)) else canonical_json(raw_body)
        )
        cand_uri = raw_val.get("source_uri")
        source_uri = (
            cand_uri
            if isinstance(cand_uri, str) and cand_uri.strip().startswith(ALLOWED_URI_SCHEMES)
            else default_uri
        )
        updated_at = str(raw_val.get("updated_at") or datetime.now(UTC).isoformat())
    else:
        title = f"{kind.title()} {store_ns}/{rec_key}"[:160]
        summary = f"Synced {kind} context from Tessera store {store_ns}/{rec_key}."[:600]
        schema_or_body = str(raw_val)
        source_uri = default_uri
        updated_at = datetime.now(UTC).isoformat()

    return ContextEntry(
        entry_id=ref,
        kind=kind,
        title=title,
        summary=summary,
        schema_or_body=schema_or_body,
        source_uri=source_uri,
        updated_at=updated_at,
    )


class ProvisionStore:
    """Thread/process-safe SQLite WAL store with multi-caller isolation, CAS, memory, and telemetry."""

    def __init__(self, db_path: str | Path) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            self._migrate_if_needed(conn)
            conn.executescript(SCHEMA_SQL)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=15.0)
        conn.row_factory = sqlite3.Row
        return conn

    def reserve_route_request(self, caller_scope: str, limit: int = 60) -> None:
        """Atomic per-key request budget; no provider call can race past the cap."""
        hour = int(time.time()) // 3600
        with self._connect() as conn:
            row = conn.execute(
                "INSERT INTO route_quotas (caller_scope, hour, used) VALUES (?, ?, 1) "
                "ON CONFLICT(caller_scope, hour) DO UPDATE SET used = used + 1 WHERE used < ? RETURNING used",
                (caller_scope, hour, limit),
            ).fetchone()
            conn.execute("DELETE FROM route_quotas WHERE hour < ?", (hour - 24,))
        if row is None:
            raise HermaError(
                429,
                "route_quota_exceeded",
                "Route Quota Exceeded",
                "60 routed requests per key per hour. Retry next hour.",
            )

    @staticmethod
    def _migrate_if_needed(conn: sqlite3.Connection) -> None:
        """Safely upgrade legacy single-PK SQLite databases to caller_scope composite PKs."""
        prov_cols = {
            str(r["name"]): int(r["pk"])
            for r in conn.execute("PRAGMA table_info(provisions)").fetchall()
        }
        if prov_cols and prov_cols.get("caller_scope", 0) == 0:
            has_scope_col = "caller_scope" in prov_cols
            scope_expr = (
                "COALESCE(caller_scope, 'system_builtin')" if has_scope_col else "'system_builtin'"
            )
            conn.executescript(
                f"""
                CREATE TABLE IF NOT EXISTS provisions_v2 (
                    caller_scope TEXT NOT NULL DEFAULT 'system_builtin',
                    prov_id TEXT NOT NULL,
                    version INTEGER NOT NULL DEFAULT 1,
                    content_sha256 TEXT NOT NULL,
                    source_store TEXT NOT NULL,
                    body_json TEXT NOT NULL,
                    updated_at REAL NOT NULL,
                    PRIMARY KEY (caller_scope, prov_id)
                );
                INSERT OR REPLACE INTO provisions_v2
                    (caller_scope, prov_id, version, content_sha256, source_store, body_json, updated_at)
                SELECT
                    {scope_expr},
                    prov_id,
                    version,
                    content_sha256,
                    CASE WHEN source_store = 'examples' THEN 'system_builtin' ELSE source_store END,
                    body_json,
                    updated_at
                FROM provisions;
                DROP TABLE provisions;
                ALTER TABLE provisions_v2 RENAME TO provisions;
                """  # noqa: S608
            )

        ctx_cols = {
            str(r["name"]): int(r["pk"])
            for r in conn.execute("PRAGMA table_info(context_entries)").fetchall()
        }
        if ctx_cols and (ctx_cols.get("caller_scope", 0) == 0 or "version" not in ctx_cols):
            scope_expr = (
                "COALESCE(caller_scope, 'system_builtin')"
                if "caller_scope" in ctx_cols
                else "'system_builtin'"
            )
            ver_expr = "COALESCE(version, 1)" if "version" in ctx_cols else "1"
            conn.executescript(
                f"""
                CREATE TABLE IF NOT EXISTS context_entries_v2 (
                    caller_scope TEXT NOT NULL DEFAULT 'system_builtin',
                    entry_id TEXT NOT NULL,
                    version INTEGER NOT NULL DEFAULT 1,
                    kind TEXT NOT NULL,
                    title TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    body_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (caller_scope, entry_id)
                );
                INSERT OR REPLACE INTO context_entries_v2
                    (caller_scope, entry_id, version, kind, title, summary, body_json, updated_at)
                SELECT
                    {scope_expr},
                    entry_id,
                    {ver_expr},
                    kind,
                    title,
                    summary,
                    body_json,
                    updated_at
                FROM context_entries;
                DROP TABLE context_entries;
                ALTER TABLE context_entries_v2 RENAME TO context_entries;
                """  # noqa: S608
            )

        rcpt_cols = {
            str(r["name"]) for r in conn.execute("PRAGMA table_info(injection_receipts)").fetchall()
        }
        if rcpt_cols:
            if "caller_scope" not in rcpt_cols:
                conn.execute(
                    "ALTER TABLE injection_receipts ADD COLUMN caller_scope TEXT NOT NULL DEFAULT 'system_builtin'"
                )
            if "project_tag" not in rcpt_cols:
                conn.execute(
                    "ALTER TABLE injection_receipts ADD COLUMN project_tag TEXT NOT NULL DEFAULT 'default'"
                )
            conn.commit()

    # --- Builtin Ownership & Protection ---

    def has_builtin_provision(self, prov_id: str) -> bool:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT 1 FROM provisions WHERE caller_scope = ? AND prov_id = ?",
                (SYSTEM_BUILTIN_SCOPE, prov_id),
            ).fetchone()
        return row is not None

    def has_builtin_context_entry(self, entry_id: str) -> bool:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT 1 FROM context_entries WHERE caller_scope = ? AND entry_id = ?",
                (SYSTEM_BUILTIN_SCOPE, entry_id),
            ).fetchone()
        return row is not None

    # --- Provision CRUD with Single-Statement Atomic Compare-And-Set ---

    def put_provision(
        self,
        provision: Provision,
        *,
        caller_scope: str = SYSTEM_BUILTIN_SCOPE,
        expected_version: int | None = None,
        source_store: str = "local",
        check_cas: bool = True,
        is_admin: bool = True,
    ) -> StoredProvision:
        if not is_admin and self.has_builtin_provision(provision.prov_id):
            raise BuiltinProtectedError(provision.prov_id)

        target_scope = caller_scope
        if (
            is_admin
            and caller_scope != SYSTEM_BUILTIN_SCOPE
            and self.has_builtin_provision(provision.prov_id)
        ):
            target_scope = SYSTEM_BUILTIN_SCOPE

        now = time.time()
        payload = provision.model_dump(mode="json")
        body_str = canonical_json(payload)
        digest = sha256_canonical(payload)
        effective_cas = check_cas or (expected_version is not None)

        with self._connect() as conn:
            if effective_cas:
                if expected_version is not None and expected_version < 0:
                    cur_row = conn.execute(
                        "SELECT version FROM provisions WHERE caller_scope = ? AND prov_id = ?",
                        (target_scope, provision.prov_id),
                    ).fetchone()
                    actual_ver = None if cur_row is None else int(cur_row["version"])
                    raise ProvisionConflictError(provision.prov_id, expected_version, actual_ver)

                if expected_version in (None, 0):
                    cur = conn.execute(
                        """
                        INSERT OR IGNORE INTO provisions
                            (caller_scope, prov_id, version, content_sha256, source_store, body_json, updated_at)
                        VALUES (?, ?, 1, ?, ?, ?, ?)
                        """,
                        (target_scope, provision.prov_id, digest, source_store, body_str, now),
                    )
                    if cur.rowcount != 1:
                        cur_row = conn.execute(
                            "SELECT version FROM provisions WHERE caller_scope = ? AND prov_id = ?",
                            (target_scope, provision.prov_id),
                        ).fetchone()
                        actual_ver = None if cur_row is None else int(cur_row["version"])
                        conn.rollback()
                        raise ProvisionConflictError(
                            provision.prov_id, expected_version, actual_ver
                        )
                    conn.commit()
                    next_ver = 1
                else:
                    cur = conn.execute(
                        """
                        UPDATE provisions
                        SET version = version + 1,
                            content_sha256 = ?,
                            source_store = ?,
                            body_json = ?,
                            updated_at = ?
                        WHERE caller_scope = ? AND prov_id = ? AND version = ?
                        """,
                        (
                            digest,
                            source_store,
                            body_str,
                            now,
                            target_scope,
                            provision.prov_id,
                            expected_version,
                        ),
                    )
                    if cur.rowcount != 1:
                        cur_row = conn.execute(
                            "SELECT version FROM provisions WHERE caller_scope = ? AND prov_id = ?",
                            (target_scope, provision.prov_id),
                        ).fetchone()
                        actual_ver = None if cur_row is None else int(cur_row["version"])
                        conn.rollback()
                        raise ProvisionConflictError(
                            provision.prov_id, expected_version, actual_ver
                        )
                    conn.commit()
                    next_ver = expected_version + 1
            else:
                ver_row = conn.execute(
                    """
                    INSERT INTO provisions
                        (caller_scope, prov_id, version, content_sha256, source_store, body_json, updated_at)
                    VALUES (?, ?, 1, ?, ?, ?, ?)
                    ON CONFLICT (caller_scope, prov_id) DO UPDATE SET
                        version = provisions.version + 1,
                        content_sha256 = excluded.content_sha256,
                        source_store = excluded.source_store,
                        body_json = excluded.body_json,
                        updated_at = excluded.updated_at
                    RETURNING version
                    """,
                    (target_scope, provision.prov_id, digest, source_store, body_str, now),
                ).fetchone()
                conn.commit()
                next_ver = int(ver_row["version"]) if ver_row is not None else 1

        return StoredProvision(
            caller_scope=target_scope,
            provision=provision,
            version=next_ver,
            content_sha256=digest,
            source_store=source_store,
            updated_at=now,
        )

    def get_provision(
        self,
        prov_id: str,
        *,
        caller_scope: str = SYSTEM_BUILTIN_SCOPE,
    ) -> StoredProvision:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT * FROM provisions
                WHERE prov_id = ? AND caller_scope IN (?, ?)
                ORDER BY CASE WHEN caller_scope = ? THEN 0 ELSE 1 END ASC
                LIMIT 1
                """,
                (prov_id, SYSTEM_BUILTIN_SCOPE, caller_scope, SYSTEM_BUILTIN_SCOPE),
            ).fetchone()
        if row is None:
            raise ProvisionNotFoundError(prov_id)
        return self._row_to_stored(row)

    def list_provisions(
        self,
        *,
        caller_scope: str = SYSTEM_BUILTIN_SCOPE,
        include_builtin: bool = True,
        enabled_only: bool = False,
    ) -> list[StoredProvision]:
        scopes = (
            (SYSTEM_BUILTIN_SCOPE,)
            if caller_scope == SYSTEM_BUILTIN_SCOPE or not include_builtin
            else (SYSTEM_BUILTIN_SCOPE, caller_scope)
        )
        with self._connect() as conn:
            if len(scopes) == 1:
                only_scope = caller_scope if not include_builtin else SYSTEM_BUILTIN_SCOPE
                rows = conn.execute(
                    "SELECT * FROM provisions WHERE caller_scope = ? ORDER BY prov_id ASC",
                    (only_scope,),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT * FROM provisions
                    WHERE caller_scope IN (?, ?)
                    ORDER BY CASE WHEN caller_scope = ? THEN 0 ELSE 1 END ASC, prov_id ASC
                    """,
                    (SYSTEM_BUILTIN_SCOPE, caller_scope, SYSTEM_BUILTIN_SCOPE),
                ).fetchall()

        merged: dict[str, StoredProvision] = {}
        for r in rows:
            sp = self._row_to_stored(r)
            # Locked system_builtin IDs are authoritative and cannot be shadowed by custom IDs:
            if sp.provision.prov_id not in merged:
                merged[sp.provision.prov_id] = sp
        items = list(merged.values())
        if enabled_only:
            items = [item for item in items if item.provision.enabled]
        return sorted(items, key=lambda s: (-s.provision.priority, s.provision.prov_id))

    def list_provisions_for_caller(
        self,
        caller_scope: str,
        *,
        enabled_only: bool = False,
    ) -> list[StoredProvision]:
        return self.list_provisions(
            caller_scope=caller_scope,
            include_builtin=True,
            enabled_only=enabled_only,
        )

    def delete_provision(
        self,
        prov_id: str,
        *,
        caller_scope: str = SYSTEM_BUILTIN_SCOPE,
        is_admin: bool = True,
    ) -> None:
        if not is_admin and self.has_builtin_provision(prov_id):
            raise BuiltinProtectedError(prov_id)

        with self._connect() as conn:
            cur = conn.execute(
                "DELETE FROM provisions WHERE caller_scope = ? AND prov_id = ?",
                (caller_scope, prov_id),
            )
            if cur.rowcount == 0 and is_admin and caller_scope != SYSTEM_BUILTIN_SCOPE:
                cur = conn.execute(
                    "DELETE FROM provisions WHERE caller_scope = ? AND prov_id = ?",
                    (SYSTEM_BUILTIN_SCOPE, prov_id),
                )
            conn.commit()
        if cur.rowcount == 0:
            raise ProvisionNotFoundError(prov_id)

    @staticmethod
    def _row_to_stored(row: sqlite3.Row) -> StoredProvision:
        prov = Provision.model_validate(json.loads(str(row["body_json"])))
        scope = (
            str(row["caller_scope"])
            if "caller_scope" in row.keys()  # noqa: SIM118
            else SYSTEM_BUILTIN_SCOPE
        )
        return StoredProvision(
            caller_scope=scope,
            provision=prov,
            version=int(row["version"]),
            content_sha256=str(row["content_sha256"]),
            source_store=str(row["source_store"]),
            updated_at=float(row["updated_at"]),
        )

    # --- Atomic Noun, Verb & Detail Context Database (Caller-Scoped + Single-Statement CAS) ---

    def upsert_context_entry(
        self,
        entry: ContextEntry,
        *,
        caller_scope: str = SYSTEM_BUILTIN_SCOPE,
        expected_version: int | None = None,
        check_cas: bool = False,
        is_admin: bool = True,
    ) -> ContextEntry:
        if not is_admin and self.has_builtin_context_entry(entry.entry_id):
            raise BuiltinProtectedError(entry.entry_id)

        target_scope = caller_scope
        if (
            is_admin
            and caller_scope != SYSTEM_BUILTIN_SCOPE
            and self.has_builtin_context_entry(entry.entry_id)
        ):
            target_scope = SYSTEM_BUILTIN_SCOPE

        envelope = {
            "schema_or_body": entry.schema_or_body,
            "source_uri": entry.source_uri,
        }
        body_str = canonical_json(envelope)
        effective_cas = check_cas or (expected_version is not None)

        with self._connect() as conn:
            if effective_cas:
                if expected_version is not None and expected_version < 0:
                    cur_row = conn.execute(
                        "SELECT version FROM context_entries WHERE caller_scope = ? AND entry_id = ?",
                        (target_scope, entry.entry_id),
                    ).fetchone()
                    actual_ver = None if cur_row is None else int(cur_row["version"])
                    raise ContextConflictError(entry.entry_id, expected_version, actual_ver)

                if expected_version in (None, 0):
                    cur = conn.execute(
                        """
                        INSERT OR IGNORE INTO context_entries
                            (caller_scope, entry_id, version, kind, title, summary, body_json, updated_at)
                        VALUES (?, ?, 1, ?, ?, ?, ?, ?)
                        """,
                        (
                            target_scope,
                            entry.entry_id,
                            entry.kind,
                            entry.title,
                            entry.summary,
                            body_str,
                            entry.updated_at,
                        ),
                    )
                    if cur.rowcount != 1:
                        cur_row = conn.execute(
                            "SELECT version FROM context_entries WHERE caller_scope = ? AND entry_id = ?",
                            (target_scope, entry.entry_id),
                        ).fetchone()
                        actual_ver = None if cur_row is None else int(cur_row["version"])
                        conn.rollback()
                        raise ContextConflictError(entry.entry_id, expected_version, actual_ver)
                    conn.commit()
                    next_ver = 1
                else:
                    cur = conn.execute(
                        """
                        UPDATE context_entries
                        SET version = version + 1,
                            kind = ?,
                            title = ?,
                            summary = ?,
                            body_json = ?,
                            updated_at = ?
                        WHERE caller_scope = ? AND entry_id = ? AND version = ?
                        """,
                        (
                            entry.kind,
                            entry.title,
                            entry.summary,
                            body_str,
                            entry.updated_at,
                            target_scope,
                            entry.entry_id,
                            expected_version,
                        ),
                    )
                    if cur.rowcount != 1:
                        cur_row = conn.execute(
                            "SELECT version FROM context_entries WHERE caller_scope = ? AND entry_id = ?",
                            (target_scope, entry.entry_id),
                        ).fetchone()
                        actual_ver = None if cur_row is None else int(cur_row["version"])
                        conn.rollback()
                        raise ContextConflictError(entry.entry_id, expected_version, actual_ver)
                    conn.commit()
                    next_ver = expected_version + 1
            else:
                ver_row = conn.execute(
                    """
                    INSERT INTO context_entries
                        (caller_scope, entry_id, version, kind, title, summary, body_json, updated_at)
                    VALUES (?, ?, 1, ?, ?, ?, ?, ?)
                    ON CONFLICT (caller_scope, entry_id) DO UPDATE SET
                        version = context_entries.version + 1,
                        kind = excluded.kind,
                        title = excluded.title,
                        summary = excluded.summary,
                        body_json = excluded.body_json,
                        updated_at = excluded.updated_at
                    RETURNING version
                    """,
                    (
                        target_scope,
                        entry.entry_id,
                        entry.kind,
                        entry.title,
                        entry.summary,
                        body_str,
                        entry.updated_at,
                    ),
                ).fetchone()
                conn.commit()
                next_ver = int(ver_row["version"]) if ver_row is not None else 1

        return entry.model_copy(update={"version": next_ver})

    def list_context_entries(
        self,
        kind: ContextEntryKind | None = None,
        prefix: str = "",
        *,
        caller_scope: str = SYSTEM_BUILTIN_SCOPE,
        include_builtin: bool = True,
    ) -> list[ContextEntry]:
        with self._connect() as conn:
            if caller_scope == SYSTEM_BUILTIN_SCOPE or not include_builtin:
                only_scope = caller_scope if not include_builtin else SYSTEM_BUILTIN_SCOPE
                if kind is not None:
                    rows = conn.execute(
                        "SELECT * FROM context_entries WHERE caller_scope = ? AND kind = ? ORDER BY entry_id ASC",
                        (only_scope, kind),
                    ).fetchall()
                else:
                    rows = conn.execute(
                        "SELECT * FROM context_entries WHERE caller_scope = ? ORDER BY entry_id ASC",
                        (only_scope,),
                    ).fetchall()
            else:
                if kind is not None:
                    rows = conn.execute(
                        """
                        SELECT * FROM context_entries
                        WHERE caller_scope IN (?, ?) AND kind = ?
                        ORDER BY CASE WHEN caller_scope = ? THEN 0 ELSE 1 END ASC, entry_id ASC
                        """,
                        (SYSTEM_BUILTIN_SCOPE, caller_scope, kind, SYSTEM_BUILTIN_SCOPE),
                    ).fetchall()
                else:
                    rows = conn.execute(
                        """
                        SELECT * FROM context_entries
                        WHERE caller_scope IN (?, ?)
                        ORDER BY CASE WHEN caller_scope = ? THEN 0 ELSE 1 END ASC, entry_id ASC
                        """,
                        (SYSTEM_BUILTIN_SCOPE, caller_scope, SYSTEM_BUILTIN_SCOPE),
                    ).fetchall()

        merged: dict[str, ContextEntry] = {}
        for r in rows:
            item = self._row_to_context_entry(r)
            if item.entry_id not in merged:
                merged[item.entry_id] = item
        items = sorted(merged.values(), key=lambda e: e.entry_id)
        if prefix:
            items = [item for item in items if item.entry_id.startswith(prefix)]
        return items

    def list_context_entries_for_caller(
        self,
        caller_scope: str,
        *,
        kind: ContextEntryKind | None = None,
        prefix: str = "",
    ) -> list[ContextEntry]:
        return self.list_context_entries(
            kind=kind,
            prefix=prefix,
            caller_scope=caller_scope,
            include_builtin=True,
        )

    def get_context_entries(
        self,
        refs: Sequence[str],
        *,
        caller_scope: str = SYSTEM_BUILTIN_SCOPE,
        include_builtin: bool = True,
    ) -> list[ContextEntry]:
        unique_refs: list[str] = []
        for raw in refs:
            cleaned = raw.strip()
            if cleaned and cleaned not in unique_refs:
                unique_refs.append(cleaned)
        if not unique_refs:
            return []
        placeholders = ",".join("?" for _ in unique_refs)
        with self._connect() as conn:
            if caller_scope == SYSTEM_BUILTIN_SCOPE or not include_builtin:
                only_scope = caller_scope if not include_builtin else SYSTEM_BUILTIN_SCOPE
                rows = conn.execute(
                    f"SELECT * FROM context_entries WHERE caller_scope = ? AND entry_id IN ({placeholders})",  # noqa: S608
                    (only_scope, *unique_refs),
                ).fetchall()
            else:
                rows = conn.execute(
                    f"""
                    SELECT * FROM context_entries
                    WHERE caller_scope IN (?, ?) AND entry_id IN ({placeholders})
                    ORDER BY CASE WHEN caller_scope = ? THEN 0 ELSE 1 END ASC
                    """,  # noqa: S608
                    (SYSTEM_BUILTIN_SCOPE, caller_scope, *unique_refs, SYSTEM_BUILTIN_SCOPE),
                ).fetchall()
        by_id: dict[str, ContextEntry] = {}
        for r in rows:
            eid = str(r["entry_id"])
            if eid not in by_id:
                by_id[eid] = self._row_to_context_entry(r)
        return [by_id[ref] for ref in unique_refs if ref in by_id]

    def get_context_entries_for_caller(
        self,
        caller_scope: str,
        refs: Sequence[str],
    ) -> list[ContextEntry]:
        return self.get_context_entries(refs, caller_scope=caller_scope, include_builtin=True)

    @staticmethod
    def _row_to_context_entry(row: sqlite3.Row) -> ContextEntry:
        raw_body = str(row["body_json"])
        try:
            parsed: Any = json.loads(raw_body)
        except json.JSONDecodeError:
            parsed = raw_body
        source_uri: str | None = None
        if isinstance(parsed, dict) and "schema_or_body" in parsed:
            inner = parsed["schema_or_body"]
            schema_or_body: dict[str, Any] | str = (
                inner if isinstance(inner, (dict, str)) else canonical_json(inner)
            )
            raw_uri = parsed.get("source_uri")
            source_uri = str(raw_uri) if isinstance(raw_uri, str) and raw_uri else None
        elif isinstance(parsed, (dict, str)):
            schema_or_body = parsed
        else:
            schema_or_body = canonical_json(parsed)

        ver = int(row["version"]) if "version" in row.keys() else 1  # noqa: SIM118
        return ContextEntry(
            entry_id=str(row["entry_id"]),
            kind=cast(ContextEntryKind, str(row["kind"])),
            title=str(row["title"]),
            summary=str(row["summary"]),
            schema_or_body=schema_or_body,
            source_uri=source_uri,
            version=ver,
            updated_at=str(row["updated_at"]),
        )

    # --- Scoped Configurable-Harness Keys ---

    def issue_key(
        self,
        *,
        label: str,
        harness_kind: HarnessKind,
        scopes: Sequence[HarnessScope],
    ) -> tuple[str, HarnessKeyInfo]:
        key_id = secrets.token_hex(6)
        raw_secret = secrets.token_urlsafe(24)
        token = f"hmk_{key_id}.{raw_secret}"
        now = time.time()
        unique_scopes = sorted(set(scopes))
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO harness_keys (key_id, label, harness_kind, scopes_json, secret_sha256, created_at, revoked_at)
                VALUES (?, ?, ?, ?, ?, ?, NULL)
                """,
                (
                    key_id,
                    label,
                    harness_kind,
                    canonical_json(unique_scopes),
                    hash_secret(raw_secret),
                    now,
                ),
            )
            conn.commit()
        info = HarnessKeyInfo(
            key_id=key_id,
            label=label,
            harness_kind=harness_kind,
            scopes=list(unique_scopes),
            created_at=now,
            revoked_at=None,
        )
        return token, info

    def authenticate_headers(
        self,
        headers: Mapping[str, str],
        *,
        is_admin: bool = False,
    ) -> HarnessPrincipal:
        key_id, supplied_secret = parse_bearer_or_header(headers)
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM harness_keys WHERE key_id = ?",
                (key_id,),
            ).fetchone()
        if row is None or row["revoked_at"] is not None:
            raise HarnessRequiredError("Unknown or revoked Herma harness key.")
        expected_hash = str(row["secret_sha256"])
        if not verify_secret_constant_time(expected_hash, supplied_secret):
            raise HarnessRequiredError("Invalid Herma harness key secret.")
        scopes_raw: list[HarnessScope] = json.loads(str(row["scopes_json"]))
        harness_kind_val: HarnessKind = row["harness_kind"]
        return HarnessPrincipal(
            key_id=key_id,
            label=str(row["label"]),
            harness_kind=harness_kind_val,
            scopes=frozenset(scopes_raw),
            is_admin=is_admin,
        )

    def list_keys(self) -> list[HarnessKeyInfo]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM harness_keys ORDER BY created_at ASC").fetchall()
        out: list[HarnessKeyInfo] = []
        for r in rows:
            out.append(
                HarnessKeyInfo(
                    key_id=str(r["key_id"]),
                    label=str(r["label"]),
                    harness_kind=r["harness_kind"],
                    scopes=json.loads(str(r["scopes_json"])),
                    created_at=float(r["created_at"]),
                    revoked_at=None if r["revoked_at"] is None else float(r["revoked_at"]),
                )
            )
        return out

    def revoke_key(self, key_id: str) -> bool:
        now = time.time()
        with self._connect() as conn:
            cur = conn.execute(
                "UPDATE harness_keys SET revoked_at = ? WHERE key_id = ? AND revoked_at IS NULL",
                (now, key_id),
            )
            conn.commit()
        return cur.rowcount > 0

    # --- Caller-Scoped Cryptographic Injection Receipts ---

    def record_receipt(
        self,
        receipt: InjectionReceipt,
        *,
        caller_scope: str | None = None,
        project_tag: str | None = None,
    ) -> None:
        resolved_scope = caller_scope or (
            f"key:{receipt.key_id}" if receipt.key_id else SYSTEM_BUILTIN_SCOPE
        )
        resolved_proj = project_tag or receipt.project_tag or "default"
        payload = receipt.model_dump(mode="json")
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO injection_receipts
                    (receipt_id, caller_scope, project_tag, receipt_sha256, body_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    receipt.receipt_id,
                    resolved_scope,
                    resolved_proj,
                    receipt.receipt_sha256,
                    canonical_json(payload),
                    receipt.created_at,
                ),
            )
            conn.commit()

    def list_receipts(
        self,
        limit: int = 50,
        *,
        caller_scope: str | None = None,
        project_tag: str | None = None,
    ) -> list[InjectionReceipt]:
        cap = max(1, min(limit, 500))
        with self._connect() as conn:
            if caller_scope is not None and project_tag is not None:
                rows = conn.execute(
                    """
                    SELECT body_json FROM injection_receipts
                    WHERE caller_scope = ? AND project_tag = ?
                    ORDER BY created_at DESC LIMIT ?
                    """,
                    (caller_scope, project_tag, cap),
                ).fetchall()
            elif caller_scope is not None:
                rows = conn.execute(
                    """
                    SELECT body_json FROM injection_receipts
                    WHERE caller_scope = ?
                    ORDER BY created_at DESC LIMIT ?
                    """,
                    (caller_scope, cap),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT body_json FROM injection_receipts ORDER BY created_at DESC LIMIT ?",
                    (cap,),
                ).fetchall()
        return [InjectionReceipt.model_validate(json.loads(str(r["body_json"]))) for r in rows]

    def public_aggregate_counts(self) -> dict[str, int]:
        """Return strictly non-sensitive aggregate telemetry counts for public HTML pages."""
        with self._connect() as conn:
            total_rcpts = int(
                conn.execute("SELECT COUNT(*) AS n FROM injection_receipts").fetchone()["n"]
            )
            entities_cnt = int(
                conn.execute("SELECT COUNT(*) AS n FROM working_entities").fetchone()["n"]
            )
            outcomes_cnt = int(
                conn.execute("SELECT COUNT(*) AS n FROM rule_outcomes").fetchone()["n"]
            )
        return {
            "total_intercepted_requests": total_rcpts,
            "total_working_entities": entities_cnt,
            "total_rule_outcomes": outcomes_cnt,
        }

    # --- Anti-RAG Top-of-Mind Entity Memory & Self-Improving Outcomes ---

    def record_working_entities(
        self,
        *,
        caller_scope: str,
        project_tag: str,
        entities: Sequence[ExtractedEntity],
        receipt_id: str,
        seen_at: float | None = None,
    ) -> int:
        if not entities:
            return 0
        ts = seen_at if seen_at is not None else time.time()
        with self._connect() as conn:
            for ent in entities:
                conn.execute(
                    """
                    INSERT INTO working_entities
                        (caller_scope, project_tag, entity_kind, entity_value, hit_count, first_seen_at, last_seen_at, last_receipt_id)
                    VALUES (?, ?, ?, ?, 1, ?, ?, ?)
                    ON CONFLICT (caller_scope, project_tag, entity_kind, entity_value) DO UPDATE SET
                        hit_count = working_entities.hit_count + 1,
                        last_seen_at = excluded.last_seen_at,
                        last_receipt_id = excluded.last_receipt_id
                    """,
                    (caller_scope, project_tag, ent.kind, ent.value, ts, ts, receipt_id),
                )
            conn.commit()
        return len(entities)

    def list_working_entities(
        self,
        *,
        caller_scope: str,
        project_tag: str | None = None,
        kind: EntityKind | None = None,
        limit: int = 50,
    ) -> list[WorkingEntity]:
        cap = max(1, min(limit, 200))
        clauses = ["caller_scope = ?"]
        params: list[Any] = [caller_scope]
        if project_tag is not None:
            clauses.append("project_tag = ?")
            params.append(project_tag)
        if kind is not None:
            clauses.append("entity_kind = ?")
            params.append(kind)
        where_sql = " AND ".join(clauses)
        params.append(cap)
        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT * FROM working_entities
                WHERE {where_sql}
                ORDER BY hit_count DESC, last_seen_at DESC, entity_kind ASC, entity_value ASC
                LIMIT ?
                """,  # noqa: S608
                tuple(params),
            ).fetchall()
        return [
            WorkingEntity(
                caller_scope=str(r["caller_scope"]),
                project_tag=str(r["project_tag"]),
                entity_kind=cast(EntityKind, str(r["entity_kind"])),
                entity_value=str(r["entity_value"]),
                hit_count=int(r["hit_count"]),
                first_seen_at=float(r["first_seen_at"]),
                last_seen_at=float(r["last_seen_at"]),
                last_receipt_id=str(r["last_receipt_id"]),
            )
            for r in rows
        ]

    def record_turn_telemetry(
        self,
        *,
        caller_scope: str,
        project_tag: str,
        receipt: InjectionReceipt,
        entities: Sequence[ExtractedEntity],
        prompt_text: str,
        latency_ms: float,
    ) -> None:
        """Persist receipt, working_entities, and automatic turn N -> turn N-1 retry_error outcomes."""
        error_sigs = [e.value for e in entities if e.kind == "error_signature"]
        tokens_saved = (
            estimate_tokens_saved(prompt_text, receipt.direct_response_text)
            if receipt.responded_directly
            else 0
        )

        with self._connect() as conn:
            # 1. Inspect immediately preceding turn N-1 in (caller_scope, project_tag):
            prev_row = conn.execute(
                """
                SELECT receipt_id, body_json FROM injection_receipts
                WHERE caller_scope = ? AND project_tag = ?
                ORDER BY created_at DESC LIMIT 1
                """,
                (caller_scope, project_tag),
            ).fetchone()
            if prev_row is not None and error_sigs:
                prev_rcpt_id = str(prev_row["receipt_id"])
                try:
                    prev_body = json.loads(str(prev_row["body_json"]))
                    prev_fired = [
                        str(p).split("@", 1)[0] for p in prev_body.get("provisions_fired", []) if p
                    ]
                except json.JSONDecodeError:
                    prev_fired = []
                for prev_prov_id in prev_fired:
                    conn.execute(
                        """
                        INSERT INTO rule_outcomes
                            (outcome_id, caller_scope, project_tag, receipt_id, prov_id, outcome, tokens_saved_est, latency_ms, error_signature, created_at)
                        VALUES (?, ?, ?, ?, ?, 'retry_error', 0, 0.0, ?, ?)
                        ON CONFLICT (caller_scope, receipt_id, prov_id) DO UPDATE SET
                            outcome = 'retry_error',
                            error_signature = excluded.error_signature
                        """,
                        (
                            f"out_{secrets.token_hex(8)}",
                            caller_scope,
                            project_tag,
                            prev_rcpt_id,
                            prev_prov_id,
                            error_sigs[0],
                            receipt.created_at,
                        ),
                    )

            # 2. Persist current receipt:
            conn.execute(
                """
                INSERT INTO injection_receipts
                    (receipt_id, caller_scope, project_tag, receipt_sha256, body_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    receipt.receipt_id,
                    caller_scope,
                    project_tag,
                    receipt.receipt_sha256,
                    canonical_json(receipt.model_dump(mode="json")),
                    receipt.created_at,
                ),
            )

            # 3. Persist working_entities for current turn:
            for ent in entities:
                conn.execute(
                    """
                    INSERT INTO working_entities
                        (caller_scope, project_tag, entity_kind, entity_value, hit_count, first_seen_at, last_seen_at, last_receipt_id)
                    VALUES (?, ?, ?, ?, 1, ?, ?, ?)
                    ON CONFLICT (caller_scope, project_tag, entity_kind, entity_value) DO UPDATE SET
                        hit_count = working_entities.hit_count + 1,
                        last_seen_at = excluded.last_seen_at,
                        last_receipt_id = excluded.last_receipt_id
                    """,
                    (
                        caller_scope,
                        project_tag,
                        ent.kind,
                        ent.value,
                        receipt.created_at,
                        receipt.created_at,
                        receipt.receipt_id,
                    ),
                )

            # 4. Log initial 'accepted' outcome for each provision fired on turn N:
            for fired_ref in receipt.provisions_fired:
                prov_id = fired_ref.split("@", 1)[0]
                conn.execute(
                    """
                    INSERT INTO rule_outcomes
                        (outcome_id, caller_scope, project_tag, receipt_id, prov_id, outcome, tokens_saved_est, latency_ms, error_signature, created_at)
                    VALUES (?, ?, ?, ?, ?, 'accepted', ?, ?, NULL, ?)
                    ON CONFLICT (caller_scope, receipt_id, prov_id) DO UPDATE SET
                        tokens_saved_est = excluded.tokens_saved_est,
                        latency_ms = excluded.latency_ms
                    """,
                    (
                        f"out_{secrets.token_hex(8)}",
                        caller_scope,
                        project_tag,
                        receipt.receipt_id,
                        prov_id,
                        tokens_saved,
                        round(latency_ms, 3),
                        receipt.created_at,
                    ),
                )
            conn.commit()

    def record_explicit_outcome(
        self,
        *,
        caller_scope: str,
        report: OutcomeReportRequest,
        header_project_tag: str = "default",
    ) -> list[RuleOutcomeRecord]:
        now = time.time()
        with self._connect() as conn:
            rcpt_row = conn.execute(
                "SELECT project_tag, body_json FROM injection_receipts WHERE caller_scope = ? AND receipt_id = ?",
                (caller_scope, report.receipt_id),
            ).fetchone()
            if rcpt_row is None:
                raise HermaError(
                    404,
                    "receipt_not_found",
                    "Receipt Not Found",
                    f"Receipt {report.receipt_id!r} was not found in caller scope.",
                )
            resolved_proj = report.project_tag or str(rcpt_row["project_tag"]) or header_project_tag
            rcpt_body = json.loads(str(rcpt_row["body_json"]))
            fired_provs = [
                str(p).split("@", 1)[0] for p in rcpt_body.get("provisions_fired", []) if p
            ]
            target_provs = [report.prov_id] if report.prov_id else fired_provs
            if not target_provs:
                raise HermaError(
                    400,
                    "missing_prov_id",
                    "Missing Provision ID",
                    "Receipt had no matched provisions; specify prov_id explicitly.",
                )

            if report.error_signature:
                extracted_errs = extract_entities(report.error_signature)
                sig_val = (
                    extracted_errs[0].value
                    if any(e.kind == "error_signature" for e in extracted_errs)
                    else report.error_signature.strip()
                )
                conn.execute(
                    """
                    INSERT INTO working_entities
                        (caller_scope, project_tag, entity_kind, entity_value, hit_count, first_seen_at, last_seen_at, last_receipt_id)
                    VALUES (?, ?, 'error_signature', ?, 1, ?, ?, ?)
                    ON CONFLICT (caller_scope, project_tag, entity_kind, entity_value) DO UPDATE SET
                        hit_count = working_entities.hit_count + 1,
                        last_seen_at = excluded.last_seen_at,
                        last_receipt_id = excluded.last_receipt_id
                    """,
                    (caller_scope, resolved_proj, sig_val[:240], now, now, report.receipt_id),
                )

            records: list[RuleOutcomeRecord] = []
            for pid in target_provs:
                oid = f"out_{secrets.token_hex(8)}"
                row = conn.execute(
                    """
                    INSERT INTO rule_outcomes
                        (outcome_id, caller_scope, project_tag, receipt_id, prov_id, outcome, tokens_saved_est, latency_ms, error_signature, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (caller_scope, receipt_id, prov_id) DO UPDATE SET
                        outcome = excluded.outcome,
                        tokens_saved_est = CASE
                            WHEN excluded.tokens_saved_est > 0 THEN excluded.tokens_saved_est
                            ELSE rule_outcomes.tokens_saved_est
                        END,
                        latency_ms = CASE
                            WHEN excluded.latency_ms > 0 THEN excluded.latency_ms
                            ELSE rule_outcomes.latency_ms
                        END,
                        error_signature = COALESCE(excluded.error_signature, rule_outcomes.error_signature)
                    RETURNING *
                    """,
                    (
                        oid,
                        caller_scope,
                        resolved_proj,
                        report.receipt_id,
                        pid,
                        report.outcome,
                        report.tokens_saved_est,
                        report.latency_ms,
                        report.error_signature,
                        now,
                    ),
                ).fetchone()
                if row is not None:
                    records.append(
                        RuleOutcomeRecord(
                            outcome_id=str(row["outcome_id"]),
                            caller_scope=str(row["caller_scope"]),
                            project_tag=str(row["project_tag"]),
                            receipt_id=str(row["receipt_id"]),
                            prov_id=str(row["prov_id"]),
                            outcome=cast(OutcomeKind, str(row["outcome"])),
                            tokens_saved_est=int(row["tokens_saved_est"]),
                            latency_ms=float(row["latency_ms"]),
                            error_signature=(
                                None
                                if row["error_signature"] is None
                                else str(row["error_signature"])
                            ),
                            created_at=float(row["created_at"]),
                        )
                    )
            conn.commit()
        return records

    def build_insights(
        self,
        *,
        caller_scope: str,
        project_tag: str | None = None,
    ) -> InsightsResponse:
        top_entities = self.list_working_entities(
            caller_scope=caller_scope,
            project_tag=project_tag,
            limit=50,
        )
        clauses = ["caller_scope = ?"]
        params: list[Any] = [caller_scope]
        if project_tag is not None:
            clauses.append("project_tag = ?")
            params.append(project_tag)
        where_sql = " AND ".join(clauses)

        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT
                    prov_id,
                    COUNT(*) AS fires,
                    SUM(CASE WHEN outcome = 'accepted' THEN 1 ELSE 0 END) AS accepted_count,
                    SUM(CASE WHEN outcome = 'retry_error' THEN 1 ELSE 0 END) AS retry_error_count,
                    COALESCE(SUM(tokens_saved_est), 0) AS tokens_saved_est,
                    COALESCE(AVG(latency_ms), 0.0) AS avg_latency_ms
                FROM rule_outcomes
                WHERE {where_sql}
                GROUP BY prov_id
                ORDER BY fires DESC, prov_id ASC
                """,  # noqa: S608
                tuple(params),
            ).fetchall()

        telemetry: list[RuleTelemetry] = []
        for r in rows:
            fires = int(r["fires"])
            retry_cnt = int(r["retry_error_count"] or 0)
            telemetry.append(
                RuleTelemetry(
                    prov_id=str(r["prov_id"]),
                    fires=fires,
                    accepted_count=int(r["accepted_count"] or 0),
                    retry_error_count=retry_cnt,
                    tokens_saved_est=int(r["tokens_saved_est"] or 0),
                    retry_error_rate=round(retry_cnt / fires, 4) if fires > 0 else 0.0,
                    avg_latency_ms=round(float(r["avg_latency_ms"] or 0.0), 3),
                )
            )

        active_provs = self.list_provisions_for_caller(caller_scope, enabled_only=True)
        candidates = synthesize_candidate_provisions(
            top_entities,
            active_provs,
            project_tag=project_tag or "default",
        )
        return InsightsResponse(
            caller_scope=caller_scope,
            project_tag=project_tag,
            top_entities=top_entities,
            rule_telemetry=telemetry,
            candidate_provisions=candidates,
        )

    # --- Tessera Atomic Noun, Verb & Blob Store Sync (Enforcing Layer-1 Governance Lens) ---

    def publish_to_tessera_store(
        self,
        tessera_store: TesseraStore,
        *,
        namespace: str = "herma.provisions",
        caller_scope: str = SYSTEM_BUILTIN_SCOPE,
    ) -> list[str]:
        """Publish local provisions + context entries + index nouns into a Tessera store."""
        published_ids: list[str] = []
        for stored in self.list_provisions(caller_scope=caller_scope):
            prov_dict = stored.provision.model_dump(mode="json")
            try:
                cur = tessera_store.get_record(namespace, stored.provision.prov_id)
                exp_ver: int | None = cur.version
            except TesseraNotFound:
                exp_ver = None
            tessera_store.put_record(
                namespace,
                stored.provision.prov_id,
                prov_dict,
                expected_version=exp_ver,
            )
            published_ids.append(stored.provision.prov_id)

        try:
            idx_rec = tessera_store.get_record(namespace, "index")
            idx_exp: int | None = idx_rec.version
        except TesseraNotFound:
            idx_exp = None
        tessera_store.put_record(
            namespace,
            "index",
            {"prov_ids": sorted(published_ids)},
            expected_version=idx_exp,
        )

        context_items = self.list_context_entries(caller_scope=caller_scope)
        if context_items:
            ctx_ns = f"{namespace}.context"
            ctx_ids: list[str] = []
            for entry in context_items:
                entry_dict = entry.model_dump(mode="json")
                try:
                    c_cur = tessera_store.get_record(ctx_ns, entry.entry_id)
                    c_exp: int | None = c_cur.version
                except TesseraNotFound:
                    c_exp = None
                tessera_store.put_record(
                    ctx_ns,
                    entry.entry_id,
                    entry_dict,
                    expected_version=c_exp,
                )
                ctx_ids.append(entry.entry_id)
            try:
                c_idx = tessera_store.get_record(ctx_ns, "index")
                c_idx_exp: int | None = c_idx.version
            except TesseraNotFound:
                c_idx_exp = None
            tessera_store.put_record(
                ctx_ns,
                "index",
                {"entry_ids": sorted(ctx_ids)},
                expected_version=c_idx_exp,
            )

        return sorted(published_ids)

    def sync_from_tessera_store(
        self,
        tessera_store: TesseraStore,
        *,
        namespace: str = "herma.provisions",
        caller_scope: str = SYSTEM_BUILTIN_SCOPE,
        harness_kind: str | None = None,
        cohort: str = "",
        is_admin: bool = True,
    ) -> list[StoredProvision]:
        """Load versioned provisions, verified SHA-256 blobs, and governed noun/verb refs."""
        ctx_ns = f"{namespace}.context"
        try:
            ctx_idx = tessera_store.get_record(ctx_ns, "index")
            for entry_id in list(ctx_idx.value.get("entry_ids", [])):
                try:
                    c_rec = tessera_store.get_record(ctx_ns, str(entry_id))
                    c_env = (
                        c_rec.model_dump(mode="json", exclude={"value"})
                        if hasattr(c_rec, "model_dump")
                        else None
                    )
                    if not passes_governance_lens(
                        c_rec.value,
                        namespace=ctx_ns,
                        harness_kind=harness_kind,
                        cohort=cohort,
                        extra_envelope=c_env,
                    ):
                        continue
                    raw_c = (
                        _strip_governance_envelope_for_context(c_rec.value, c_env)
                        if isinstance(c_rec.value, dict)
                        else c_rec.value
                    )
                    entry = ContextEntry.model_validate(raw_c)
                    if not is_admin and self.has_builtin_context_entry(entry.entry_id):
                        continue
                    self.upsert_context_entry(
                        entry,
                        caller_scope=caller_scope,
                        is_admin=is_admin,
                    )
                except TesseraNotFound:
                    continue
        except TesseraNotFound:
            pass

        idx = tessera_store.get_record(namespace, "index")
        prov_ids: list[str] = list(idx.value.get("prov_ids", []))
        synced: list[StoredProvision] = []
        for prov_id in prov_ids:
            try:
                rec = tessera_store.get_record(namespace, prov_id)
            except TesseraNotFound:
                continue
            if not isinstance(rec.value, dict):
                continue
            rec_env = (
                rec.model_dump(mode="json", exclude={"value"})
                if hasattr(rec, "model_dump")
                else None
            )
            if not passes_governance_lens(
                rec.value,
                namespace=namespace,
                harness_kind=harness_kind,
                cohort=cohort,
                extra_envelope=rec_env,
            ):
                continue
            cleaned_prov = _strip_governance_envelope_for_provision(rec.value, rec_env)
            prov = Provision.model_validate(cleaned_prov)
            if not is_admin and self.has_builtin_provision(prov.prov_id):
                continue

            resolved_uris: list[ProvisionURI] = []
            for u in prov.uris:
                if u.uri.startswith("tessera://blobs/") and not u.inline_excerpt:
                    blob_sha = validate_blob_sha256(u.uri.removeprefix("tessera://blobs/"))
                    _ = blob_sha
                    resolved_uris.append(u)
                elif u.uri.startswith("tessera://buckets/") and not u.inline_excerpt:
                    rest = u.uri.removeprefix("tessera://buckets/").strip()
                    bucket_name, sep, obj_key = rest.partition("/")
                    if (
                        sep
                        and bucket_name
                        and obj_key
                        and ".." not in rest
                        and SAFE_BUCKET_SEG_RE.fullmatch(obj_key)
                        and hasattr(tessera_store, "get_object")
                    ):
                        meta_obj, raw_bytes = tessera_store.get_object(bucket_name, obj_key)
                        meta_dict = (
                            meta_obj.model_dump(mode="json")
                            if hasattr(meta_obj, "model_dump")
                            else (meta_obj if isinstance(meta_obj, Mapping) else {})
                        )
                        if passes_governance_lens(
                            meta_dict,
                            namespace=f"bucket:{bucket_name}",
                            harness_kind=harness_kind,
                            cohort=cohort,
                        ):
                            excerpt = raw_bytes.decode("utf-8", errors="replace")[:780]
                            resolved_uris.append(u.model_copy(update={"inline_excerpt": excerpt}))
                        else:
                            resolved_uris.append(u)
                    else:
                        resolved_uris.append(u)
                else:
                    resolved_uris.append(u)
            if resolved_uris != prov.uris:
                prov = prov.model_copy(update={"uris": resolved_uris})

            for ref in prov.context_refs:
                parsed_ref = _parse_tessera_context_ref(ref)
                if parsed_ref is not None:
                    kind, store_ns, rec_key = parsed_ref
                    try:
                        noun_rec = tessera_store.get_record(store_ns, rec_key)
                        n_env = (
                            noun_rec.model_dump(mode="json", exclude={"value"})
                            if hasattr(noun_rec, "model_dump")
                            else None
                        )
                        if not passes_governance_lens(
                            noun_rec.value,
                            namespace=store_ns,
                            harness_kind=harness_kind,
                            cohort=cohort,
                            extra_envelope=n_env,
                        ):
                            continue
                        if not is_admin and self.has_builtin_context_entry(ref):
                            continue
                        self.upsert_context_entry(
                            _value_to_context_entry(
                                ref, kind, store_ns, rec_key, noun_rec.value
                            ).model_copy(
                                update={"governance": _canonical_governance(noun_rec.value, n_env)}
                            ),
                            caller_scope=caller_scope,
                            is_admin=is_admin,
                        )
                    except TesseraNotFound:
                        pass

            synced.append(
                self.put_provision(
                    prov,
                    caller_scope=caller_scope,
                    source_store=f"tessera:{namespace}",
                    check_cas=False,
                    is_admin=is_admin,
                )
            )
        return synced

    async def sync_from_tessera_http(
        self,
        base_url: str,
        bearer_token: str,
        *,
        namespace: str = "herma.provisions",
        caller_scope: str = SYSTEM_BUILTIN_SCOPE,
        harness_kind: str | None = None,
        cohort: str = "",
        is_admin: bool = True,
    ) -> list[StoredProvision]:
        """Pull governed provisions, verified SHA-256 blobs, and noun/verb refs over HTTP."""
        root = base_url.rstrip("/")
        headers = {"Authorization": f"Bearer {bearer_token}"}
        synced: list[StoredProvision] = []
        async with httpx.AsyncClient(timeout=15.0, headers=headers) as client:
            ctx_ns = f"{namespace}.context"
            ctx_idx_resp = await client.get(
                f"{root}/v1/stores/{quote(ctx_ns, safe='')}/records/index"
            )
            if ctx_idx_resp.status_code == 200:
                ctx_ids: list[str] = list(ctx_idx_resp.json().get("value", {}).get("entry_ids", []))
                for entry_id in ctx_ids:
                    c_resp = await client.get(
                        f"{root}/v1/stores/{quote(ctx_ns, safe='')}/records/{quote(entry_id, safe='')}"
                    )
                    if c_resp.status_code == 200:
                        c_json = c_resp.json()
                        c_val = c_json.get("value")
                        if not passes_governance_lens(
                            c_val,
                            namespace=ctx_ns,
                            harness_kind=harness_kind,
                            cohort=cohort,
                            extra_envelope=c_json if isinstance(c_json, Mapping) else None,
                        ):
                            continue
                        raw_c = (
                            _strip_governance_envelope_for_context(c_val, c_json)
                            if isinstance(c_val, dict)
                            else c_val
                        )
                        entry = ContextEntry.model_validate(raw_c)
                        if not is_admin and self.has_builtin_context_entry(entry.entry_id):
                            continue
                        self.upsert_context_entry(
                            entry,
                            caller_scope=caller_scope,
                            is_admin=is_admin,
                        )

            idx_resp = await client.get(
                f"{root}/v1/stores/{quote(namespace, safe='')}/records/index"
            )
            idx_resp.raise_for_status()
            prov_ids: list[str] = list(idx_resp.json()["value"].get("prov_ids", []))
            for prov_id in prov_ids:
                rec_resp = await client.get(
                    f"{root}/v1/stores/{quote(namespace, safe='')}/records/{quote(prov_id, safe='')}"
                )
                rec_resp.raise_for_status()
                rec_json = rec_resp.json()
                raw_val = rec_json.get("value")
                if not isinstance(raw_val, dict):
                    continue
                if not passes_governance_lens(
                    raw_val,
                    namespace=namespace,
                    harness_kind=harness_kind,
                    cohort=cohort,
                    extra_envelope=rec_json if isinstance(rec_json, Mapping) else None,
                ):
                    continue
                prov = Provision.model_validate(
                    _strip_governance_envelope_for_provision(
                        raw_val,
                        rec_json if isinstance(rec_json, Mapping) else None,
                    )
                )
                if not is_admin and self.has_builtin_provision(prov.prov_id):
                    continue

                resolved_uris: list[ProvisionURI] = []
                for u in prov.uris:
                    if u.uri.startswith("tessera://blobs/") and not u.inline_excerpt:
                        blob_sha = validate_blob_sha256(u.uri.removeprefix("tessera://blobs/"))
                        _ = blob_sha
                        resolved_uris.append(u)
                    elif u.uri.startswith("tessera://buckets/") and not u.inline_excerpt:
                        rest = u.uri.removeprefix("tessera://buckets/").strip()
                        bucket_name, sep, obj_key = rest.partition("/")
                        if (
                            sep
                            and bucket_name
                            and obj_key
                            and ".." not in rest
                            and SAFE_BUCKET_SEG_RE.fullmatch(obj_key)
                        ):
                            o_resp = await client.get(
                                f"{root}/v1/buckets/{quote(bucket_name, safe='')}/objects/{quote(obj_key, safe='/')}"
                            )
                            o_resp.raise_for_status()
                            hdr_tags = o_resp.headers.get("x-tessera-tags", "")
                            if passes_governance_lens(
                                {"tags": hdr_tags} if hdr_tags else {},
                                namespace=f"bucket:{bucket_name}",
                                harness_kind=harness_kind,
                                cohort=cohort,
                            ):
                                excerpt = o_resp.text[:780]
                                resolved_uris.append(
                                    u.model_copy(update={"inline_excerpt": excerpt})
                                )
                            else:
                                resolved_uris.append(u)
                        else:
                            resolved_uris.append(u)
                    else:
                        resolved_uris.append(u)
                if resolved_uris != prov.uris:
                    prov = prov.model_copy(update={"uris": resolved_uris})

                for ref in prov.context_refs:
                    parsed_ref = _parse_tessera_context_ref(ref)
                    if parsed_ref is not None:
                        kind, store_ns, rec_key = parsed_ref
                        n_resp = await client.get(
                            f"{root}/v1/stores/{quote(store_ns, safe='')}/records/{quote(rec_key, safe='/')}"
                        )
                        if n_resp.status_code == 200:
                            n_json = n_resp.json()
                            n_val = n_json.get("value")
                            if not passes_governance_lens(
                                n_val,
                                namespace=store_ns,
                                harness_kind=harness_kind,
                                cohort=cohort,
                                extra_envelope=n_json if isinstance(n_json, Mapping) else None,
                            ):
                                continue
                            if not is_admin and self.has_builtin_context_entry(ref):
                                continue
                            self.upsert_context_entry(
                                _value_to_context_entry(
                                    ref, kind, store_ns, rec_key, n_val
                                ).model_copy(
                                    update={"governance": _canonical_governance(n_val, n_json)}
                                ),
                                caller_scope=caller_scope,
                                is_admin=is_admin,
                            )

                synced.append(
                    self.put_provision(
                        prov,
                        caller_scope=caller_scope,
                        source_store=f"tessera_http:{namespace}",
                        check_cas=False,
                        is_admin=is_admin,
                    )
                )
        return synced

    async def sync_from_remote_handshake(
        self,
        base_url: str,
        *,
        token: str = "",
        surface_header: str = "X-Surface-Id",
        surface_id: str = "herma",
        handshake_path: str = "/v1/handshake",
        provisions_path: str = "/v1/provisions",
        caller_scope: str = SYSTEM_BUILTIN_SCOPE,
        is_admin: bool = True,
    ) -> list[StoredProvision]:
        """Negotiate clamped parameters via remote handshake and load versioned provisions."""
        root = base_url.rstrip("/")
        headers: dict[str, str] = {surface_header: surface_id, "Accept": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        clamped_max_chars = 16000
        async with httpx.AsyncClient(timeout=15.0) as client:
            if handshake_path:
                hs_resp = await client.post(
                    f"{root}{handshake_path}",
                    headers=headers,
                    json={
                        "protocol_version": "1.0",
                        "surface_id": surface_id,
                        "requested_max_chars": 4000,
                    },
                )
                hs_resp.raise_for_status()
                hs_data = hs_resp.json()
                if isinstance(hs_data, dict) and "clamped_max_chars" in hs_data:
                    clamped_max_chars = max(120, min(16000, int(hs_data["clamped_max_chars"])))

            prov_resp = await client.get(f"{root}{provisions_path}", headers=headers)
            prov_resp.raise_for_status()
            body = prov_resp.json()
            if isinstance(body, dict) and isinstance(body.get("context_entries"), list):
                for raw_entry in body["context_entries"]:
                    if not passes_governance_lens(raw_entry):
                        continue
                    entry = ContextEntry.model_validate(
                        _strip_governance_envelope_for_context(raw_entry)
                    )
                    if not is_admin and self.has_builtin_context_entry(entry.entry_id):
                        continue
                    self.upsert_context_entry(
                        entry,
                        caller_scope=caller_scope,
                        is_admin=is_admin,
                    )
            raw_list = (
                body["provisions"] if isinstance(body, dict) and "provisions" in body else body
            )
            synced: list[StoredProvision] = []
            for item in raw_list:
                raw_prov = (
                    item["provision"]
                    if isinstance(item, dict) and isinstance(item.get("provision"), dict)
                    else item
                )
                if not passes_governance_lens(raw_prov, extra_envelope=item):
                    continue
                prov = Provision.model_validate(
                    _strip_governance_envelope_for_provision(raw_prov, item)
                )
                if not is_admin and self.has_builtin_provision(prov.prov_id):
                    continue
                if prov.max_chars > clamped_max_chars:
                    prov = prov.model_copy(update={"max_chars": clamped_max_chars})
                synced.append(
                    self.put_provision(
                        prov,
                        caller_scope=caller_scope,
                        source_store="remote_handshake",
                        check_cas=False,
                        is_admin=is_admin,
                    )
                )
            return synced

    def negotiate_handshake(
        self,
        request: HandshakeRequest,
        *,
        principal: HarnessPrincipal,
        backend_version: str,
        header_surface_id: str = "",
    ) -> HandshakeResponse:
        """Negotiate Surface Handshake v1.0 for an authenticated configurable harness or surface."""
        proto = request.protocol_version.strip()
        if not proto.startswith("1."):
            raise HermaError(
                400,
                "unsupported_protocol",
                "Unsupported Handshake Protocol",
                f"Unsupported protocol_version {proto!r}; expected '1.0'.",
            )
        hdr_clean = header_surface_id.strip()
        body_clean = (request.surface_id or "").strip()
        if hdr_clean and body_clean and hdr_clean != body_clean:
            raise HermaError(
                400,
                "surface_mismatch",
                "Surface ID Mismatch",
                f"X-Surface-Id header {hdr_clean!r} != body surface_id {body_clean!r}.",
            )
        surface_id = body_clean or hdr_clean or "herma"
        if not re.fullmatch(SURFACE_ID_PATTERN, surface_id):
            raise HermaError(
                400,
                "invalid_surface_id",
                "Invalid Surface ID",
                f"surface_id {surface_id!r} must match {SURFACE_ID_PATTERN}.",
            )
        clamped_max_chars = max(120, min(16_000, int(request.requested_max_chars)))
        active_count = len(
            self.list_provisions_for_caller(principal.caller_scope, enabled_only=True)
        )
        ctx_count = len(self.list_context_entries_for_caller(principal.caller_scope))
        capabilities = [
            "keyword_triggers",
            "semantic_triggers",
            "micromodel_triggers",
            "context_shimming",
            "respond_directly",
            "multi_wire_proxy",
            "caller_isolation",
            "governance_lens",
            "entity_memory",
            "self_improving_insights",
            "tessera_sync",
            "remote_handshake_sync",
            "surface_handshake_v1",
            "mcp_jsonrpc",
        ]
        handshake_id = sha256_canonical(
            {
                "backend": "herma",
                "backend_version": backend_version,
                "protocol_version": "1.0",
                "surface_id": surface_id,
                "harness_kind": principal.harness_kind,
                "caller_scope": principal.caller_scope,
                "clamped_max_chars": clamped_max_chars,
            }
        )
        return HandshakeResponse(
            protocol_version="1.0",
            backend="herma",
            backend_version=backend_version,
            surface_id=surface_id,
            harness_kind=principal.harness_kind,
            clamped_max_chars=clamped_max_chars,
            active_provisions=active_count,
            context_entries=ctx_count,
            transactional_db_exempt_from_middleware=True,
            capabilities=capabilities,
            handshake_id=handshake_id,
        )
