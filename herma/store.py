"""SQLite WAL provision/context/key/receipt store plus Tessera CAS and remote-handshake sync."""

from __future__ import annotations

import hashlib
import json
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
from herma.schemas import (
    ALLOWED_URI_SCHEMES,
    SURFACE_ID_PATTERN,
    ContextEntry,
    ContextEntryKind,
    HandshakeRequest,
    HandshakeResponse,
    HarnessKeyInfo,
    HarnessKind,
    HarnessScope,
    InjectionReceipt,
    Provision,
    ProvisionURI,
    StoredProvision,
)

SCHEMA_SQL = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS provisions (
    prov_id TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    content_sha256 TEXT NOT NULL,
    source_store TEXT NOT NULL,
    body_json TEXT NOT NULL,
    updated_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS context_entries (
    entry_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    body_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

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
    receipt_sha256 TEXT NOT NULL,
    body_json TEXT NOT NULL,
    created_at REAL NOT NULL
);
"""


def canonical_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_canonical(obj: Any) -> str:
    return hashlib.sha256(canonical_json(obj).encode("utf-8")).hexdigest()


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
        raw_body = raw_val.get("schema_or_body", raw_val)
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
    """Thread/process-safe SQLite WAL store for provisions, context entries, keys, and receipts."""

    def __init__(self, db_path: str | Path) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.executescript(SCHEMA_SQL)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=15.0)
        conn.row_factory = sqlite3.Row
        return conn

    # --- Provision CRUD with Compare-And-Set ---

    def put_provision(
        self,
        provision: Provision,
        *,
        expected_version: int | None = None,
        source_store: str = "local",
        check_cas: bool = True,
    ) -> StoredProvision:
        now = time.time()
        payload = provision.model_dump(mode="json")
        digest = sha256_canonical(payload)
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT version FROM provisions WHERE prov_id = ?",
                (provision.prov_id,),
            ).fetchone()
            current_ver = None if row is None else int(row["version"])
            if check_cas and current_ver != expected_version:
                conn.rollback()
                raise ProvisionConflictError(provision.prov_id, expected_version, current_ver)
            next_ver = (current_ver or 0) + 1
            conn.execute(
                """
                INSERT INTO provisions (prov_id, version, content_sha256, source_store, body_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(prov_id) DO UPDATE SET
                    version = excluded.version,
                    content_sha256 = excluded.content_sha256,
                    source_store = excluded.source_store,
                    body_json = excluded.body_json,
                    updated_at = excluded.updated_at
                """,
                (
                    provision.prov_id,
                    next_ver,
                    digest,
                    source_store,
                    canonical_json(payload),
                    now,
                ),
            )
            conn.commit()
        return StoredProvision(
            provision=provision,
            version=next_ver,
            content_sha256=digest,
            source_store=source_store,
            updated_at=now,
        )

    def get_provision(self, prov_id: str) -> StoredProvision:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM provisions WHERE prov_id = ?",
                (prov_id,),
            ).fetchone()
        if row is None:
            raise ProvisionNotFoundError(prov_id)
        return self._row_to_stored(row)

    def list_provisions(self, *, enabled_only: bool = False) -> list[StoredProvision]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM provisions ORDER BY prov_id ASC").fetchall()
        items = [self._row_to_stored(r) for r in rows]
        if enabled_only:
            items = [item for item in items if item.provision.enabled]
        return sorted(items, key=lambda s: (-s.provision.priority, s.provision.prov_id))

    def delete_provision(self, prov_id: str) -> None:
        with self._connect() as conn:
            cur = conn.execute("DELETE FROM provisions WHERE prov_id = ?", (prov_id,))
            conn.commit()
        if cur.rowcount == 0:
            raise ProvisionNotFoundError(prov_id)

    @staticmethod
    def _row_to_stored(row: sqlite3.Row) -> StoredProvision:
        prov = Provision.model_validate(json.loads(str(row["body_json"])))
        return StoredProvision(
            provision=prov,
            version=int(row["version"]),
            content_sha256=str(row["content_sha256"]),
            source_store=str(row["source_store"]),
            updated_at=float(row["updated_at"]),
        )

    # --- Atomic Noun, Verb & Detail Context Database ---

    def upsert_context_entry(self, entry: ContextEntry) -> ContextEntry:
        envelope = {
            "schema_or_body": entry.schema_or_body,
            "source_uri": entry.source_uri,
        }
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO context_entries (entry_id, kind, title, summary, body_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(entry_id) DO UPDATE SET
                    kind = excluded.kind,
                    title = excluded.title,
                    summary = excluded.summary,
                    body_json = excluded.body_json,
                    updated_at = excluded.updated_at
                """,
                (
                    entry.entry_id,
                    entry.kind,
                    entry.title,
                    entry.summary,
                    canonical_json(envelope),
                    entry.updated_at,
                ),
            )
            conn.commit()
        return entry

    def list_context_entries(
        self,
        kind: ContextEntryKind | None = None,
        prefix: str = "",
    ) -> list[ContextEntry]:
        with self._connect() as conn:
            if kind is not None:
                rows = conn.execute(
                    "SELECT * FROM context_entries WHERE kind = ? ORDER BY entry_id ASC",
                    (kind,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM context_entries ORDER BY entry_id ASC"
                ).fetchall()
        items = [self._row_to_context_entry(r) for r in rows]
        if prefix:
            items = [item for item in items if item.entry_id.startswith(prefix)]
        return items

    def get_context_entries(self, refs: Sequence[str]) -> list[ContextEntry]:
        unique_refs: list[str] = []
        for raw in refs:
            cleaned = raw.strip()
            if cleaned and cleaned not in unique_refs:
                unique_refs.append(cleaned)
        if not unique_refs:
            return []
        placeholders = ",".join("?" for _ in unique_refs)
        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT * FROM context_entries WHERE entry_id IN ({placeholders})",  # noqa: S608
                tuple(unique_refs),
            ).fetchall()
        by_id = {str(r["entry_id"]): self._row_to_context_entry(r) for r in rows}
        return [by_id[ref] for ref in unique_refs if ref in by_id]

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

        return ContextEntry(
            entry_id=str(row["entry_id"]),
            kind=cast(ContextEntryKind, str(row["kind"])),
            title=str(row["title"]),
            summary=str(row["summary"]),
            schema_or_body=schema_or_body,
            source_uri=source_uri,
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

    def authenticate_headers(self, headers: Mapping[str, str]) -> HarnessPrincipal:
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

    # --- Cryptographic Injection Receipts ---

    def record_receipt(self, receipt: InjectionReceipt) -> None:
        payload = receipt.model_dump(mode="json")
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO injection_receipts (receipt_id, receipt_sha256, body_json, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (
                    receipt.receipt_id,
                    receipt.receipt_sha256,
                    canonical_json(payload),
                    receipt.created_at,
                ),
            )
            conn.commit()

    def list_receipts(self, limit: int = 50) -> list[InjectionReceipt]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT body_json FROM injection_receipts ORDER BY created_at DESC LIMIT ?",
                (max(1, min(limit, 500)),),
            ).fetchall()
        return [InjectionReceipt.model_validate(json.loads(str(r["body_json"]))) for r in rows]

    # --- Tessera Atomic Noun, Verb & Blob Store Sync ---

    def publish_to_tessera_store(
        self,
        tessera_store: TesseraStore,
        *,
        namespace: str = "herma.provisions",
    ) -> list[str]:
        """Publish all local provisions + context entries + index nouns into a Tessera store."""
        published_ids: list[str] = []
        for stored in self.list_provisions():
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

        context_items = self.list_context_entries()
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
    ) -> list[StoredProvision]:
        """Load versioned provisions, blob excerpts, and noun/verb context_refs from Tessera."""
        ctx_ns = f"{namespace}.context"
        try:
            ctx_idx = tessera_store.get_record(ctx_ns, "index")
            for entry_id in list(ctx_idx.value.get("entry_ids", [])):
                try:
                    c_rec = tessera_store.get_record(ctx_ns, str(entry_id))
                    self.upsert_context_entry(ContextEntry.model_validate(c_rec.value))
                except TesseraNotFound:
                    continue
        except TesseraNotFound:
            pass

        idx = tessera_store.get_record(namespace, "index")
        prov_ids: list[str] = list(idx.value.get("prov_ids", []))
        synced: list[StoredProvision] = []
        for prov_id in prov_ids:
            rec = tessera_store.get_record(namespace, prov_id)
            prov = Provision.model_validate(rec.value)
            resolved_uris: list[ProvisionURI] = []
            for u in prov.uris:
                if u.uri.startswith("tessera://blobs/") and not u.inline_excerpt:
                    blob_sha = u.uri.removeprefix("tessera://blobs/").strip()
                    raw_bytes = tessera_store.get_blob(blob_sha)
                    excerpt = raw_bytes.decode("utf-8", errors="replace")[:780]
                    resolved_uris.append(u.model_copy(update={"inline_excerpt": excerpt}))
                elif u.uri.startswith("tessera://buckets/") and not u.inline_excerpt:
                    rest = u.uri.removeprefix("tessera://buckets/").strip()
                    bucket_name, sep, obj_key = rest.partition("/")
                    if sep and bucket_name and obj_key and hasattr(tessera_store, "get_object"):
                        _, raw_bytes = tessera_store.get_object(bucket_name, obj_key)
                        excerpt = raw_bytes.decode("utf-8", errors="replace")[:780]
                        resolved_uris.append(u.model_copy(update={"inline_excerpt": excerpt}))
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
                        self.upsert_context_entry(
                            _value_to_context_entry(ref, kind, store_ns, rec_key, noun_rec.value)
                        )
                    except TesseraNotFound:
                        pass

            synced.append(
                self.put_provision(prov, source_store=f"tessera:{namespace}", check_cas=False)
            )
        return synced

    async def sync_from_tessera_http(
        self,
        base_url: str,
        bearer_token: str,
        *,
        namespace: str = "herma.provisions",
    ) -> list[StoredProvision]:
        """Pull provisions, blobs, and noun/verb context_refs over HTTP from a Tessera service."""
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
                        self.upsert_context_entry(
                            ContextEntry.model_validate(c_resp.json()["value"])
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
                prov = Provision.model_validate(rec_resp.json()["value"])
                resolved_uris: list[ProvisionURI] = []
                for u in prov.uris:
                    if u.uri.startswith("tessera://blobs/") and not u.inline_excerpt:
                        blob_sha = u.uri.removeprefix("tessera://blobs/").strip()
                        b_resp = await client.get(f"{root}/v1/blobs/{blob_sha}")
                        b_resp.raise_for_status()
                        excerpt = b_resp.text[:780]
                        resolved_uris.append(u.model_copy(update={"inline_excerpt": excerpt}))
                    elif u.uri.startswith("tessera://buckets/") and not u.inline_excerpt:
                        rest = u.uri.removeprefix("tessera://buckets/").strip()
                        bucket_name, sep, obj_key = rest.partition("/")
                        if sep and bucket_name and obj_key:
                            o_resp = await client.get(
                                f"{root}/v1/buckets/{bucket_name}/objects/{obj_key}"
                            )
                            o_resp.raise_for_status()
                            excerpt = o_resp.text[:780]
                            resolved_uris.append(u.model_copy(update={"inline_excerpt": excerpt}))
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
                            self.upsert_context_entry(
                                _value_to_context_entry(
                                    ref, kind, store_ns, rec_key, n_resp.json().get("value")
                                )
                            )

                synced.append(
                    self.put_provision(
                        prov, source_store=f"tessera_http:{namespace}", check_cas=False
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
                    self.upsert_context_entry(ContextEntry.model_validate(raw_entry))
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
                prov = Provision.model_validate(raw_prov)
                if prov.max_chars > clamped_max_chars:
                    prov = prov.model_copy(update={"max_chars": clamped_max_chars})
                synced.append(
                    self.put_provision(prov, source_store="remote_handshake", check_cas=False)
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
        import re

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
        active_count = len(self.list_provisions(enabled_only=True))
        ctx_count = len(self.list_context_entries())
        capabilities = [
            "keyword_triggers",
            "semantic_triggers",
            "micromodel_triggers",
            "context_shimming",
            "respond_directly",
            "multi_wire_proxy",
            "tessera_sync",
            "remote_handshake_sync",
            "surface_handshake_v1",
        ]
        handshake_id = sha256_canonical(
            {
                "backend": "herma",
                "backend_version": backend_version,
                "protocol_version": "1.0",
                "surface_id": surface_id,
                "harness_kind": principal.harness_kind,
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
