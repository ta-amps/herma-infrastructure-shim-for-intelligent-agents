"""Durable caller isolation, per-turn CAS and pre-call conversation budgets."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from herma.errors import HermaError


def conflict(code: str, detail: str) -> HermaError:
    return HermaError(409, code, "Conversation conflict", detail)


class ConversationState:
    def __init__(self, path: Path) -> None:
        self.path = path
        with self.connect() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS work_conversations (
                    scope TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL,
                    active TEXT, history TEXT NOT NULL, contract_hash TEXT NOT NULL,
                    created REAL NOT NULL, PRIMARY KEY(scope,id));
                CREATE TABLE IF NOT EXISTS work_turns (
                    scope TEXT NOT NULL, conversation TEXT NOT NULL, request TEXT NOT NULL,
                    fingerprint TEXT NOT NULL, response TEXT, version INTEGER NOT NULL,
                    PRIMARY KEY(scope,conversation,request));
                CREATE TABLE IF NOT EXISTS work_budgets (
                    scope TEXT NOT NULL, hour INTEGER NOT NULL, turns INTEGER NOT NULL,
                    reserved_tokens INTEGER NOT NULL, PRIMARY KEY(scope,hour));
                CREATE TABLE IF NOT EXISTS work_provider_budget (
                    provider TEXT PRIMARY KEY, reserved_microusd INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS work_provider_health (
                    scope TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
                    available_after REAL NOT NULL, PRIMARY KEY(scope,provider,model));
            """)
            conn.execute("BEGIN IMMEDIATE")
            columns = {row[1] for row in conn.execute("PRAGMA table_info(work_turns)")}
            if "exception_record" not in columns:
                conn.execute(
                    "ALTER TABLE work_turns ADD COLUMN exception_record TEXT NOT NULL DEFAULT '{}'"
                )

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def snapshot(self, scope: str, conversation: str) -> dict[str, Any]:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM work_conversations WHERE scope=? AND id=?", (scope, conversation)
            ).fetchone()
            if not row:
                return {"version": 0, "history": [], "attempts": []}
            latest = conn.execute(
                "SELECT exception_record FROM work_turns WHERE scope=? AND conversation=? ORDER BY version DESC LIMIT 1",
                (scope, conversation),
            ).fetchone()
            return {
                "version": row["version"],
                "history": json.loads(row["history"]),
                "active": row["active"],
                "attempts": json.loads(latest[0]).get("attempts", []) if latest else [],
            }

    def replay(
        self, scope: str, conversation: str, request: str, fingerprint: str
    ) -> dict[str, Any] | None:
        """Resolve retries before rebuilding a potentially larger model context."""
        with self.connect() as conn:
            previous = conn.execute(
                "SELECT * FROM work_turns WHERE scope=? AND conversation=? AND request=?",
                (scope, conversation, request),
            ).fetchone()
            if not previous:
                return None
            if previous["fingerprint"] != fingerprint:
                raise conflict("request_id_conflict", "The request ID belongs to different input.")
            if previous["response"] is None:
                raise conflict(
                    "request_in_progress",
                    "This turn is running or needs operator reconciliation; do not replay model calls.",
                )
            return dict(json.loads(previous["response"]))

    def reserve(
        self,
        *,
        scope: str,
        conversation: str,
        request: str,
        expected: int,
        fingerprint: str,
        contract_hash: str,
        tokens: int,
        token_limit: int | None = None,
        turn_limit: int = 60,
        provider: str = "ollama",
        reserve_microusd: int = 0,
        budget_microusd: int = 0,
        exception_record: dict[str, Any] | None = None,
    ) -> tuple[int, dict[str, Any] | None]:
        if (
            tokens < 0
            or (token_limit is not None and token_limit < 1)
            or turn_limit < 1
            or reserve_microusd < 0
        ):
            raise ValueError("invalid budget reservation")
        now = time.time()
        hour = int(now // 3600)
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            previous = conn.execute(
                "SELECT * FROM work_turns WHERE scope=? AND conversation=? AND request=?",
                (scope, conversation, request),
            ).fetchone()
            if previous:
                if previous["fingerprint"] != fingerprint:
                    raise conflict(
                        "request_id_conflict", "The request ID belongs to different input."
                    )
                if previous["response"] is None:
                    raise conflict(
                        "request_in_progress",
                        "This turn is running or needs operator reconciliation; do not replay model calls.",
                    )
                return previous["version"], json.loads(previous["response"])
            row = conn.execute(
                "SELECT * FROM work_conversations WHERE scope=? AND id=?", (scope, conversation)
            ).fetchone()
            if row and (row["active"] or row["version"] != expected):
                raise conflict(
                    "version_conflict",
                    "Refresh this conversation's version before sending another turn.",
                )
            if row and row["contract_hash"] != contract_hash:
                raise conflict(
                    "contract_changed",
                    "The configured work contract changed; start a new conversation.",
                )
            if row and now - row["created"] > 86400:
                raise conflict(
                    "conversation_expired",
                    "Start a new conversation; hourly caller budgets still apply.",
                )
            if not row and expected != 0:
                raise conflict("version_conflict", "Create a conversation with expected_version=0.")
            budget = conn.execute(
                "SELECT * FROM work_budgets WHERE scope=? AND hour=?", (scope, hour)
            ).fetchone()
            if budget and (
                budget["turns"] >= turn_limit
                or (token_limit is not None and budget["reserved_tokens"] + tokens > token_limit)
            ):
                raise HermaError(
                    429,
                    "conversation_budget_exhausted",
                    "Conversation budget exhausted",
                    "Wait for the caller's next hourly budget.",
                )
            if token_limit is not None and tokens > token_limit:
                raise HermaError(
                    413,
                    "context_too_large",
                    "Context too large",
                    "Reduce context before calling the model.",
                )
            spend = conn.execute(
                "SELECT reserved_microusd FROM work_provider_budget WHERE provider=?", (provider,)
            ).fetchone()
            if reserve_microusd + (spend[0] if spend else 0) > budget_microusd:
                raise HermaError(
                    429,
                    "provider_budget_exhausted",
                    "Provider budget exhausted",
                    "The operator's cumulative model budget is reserved; operator reconciliation is required.",
                )
            conn.execute(
                "INSERT INTO work_provider_budget VALUES (?,?) ON CONFLICT(provider) DO UPDATE SET reserved_microusd=reserved_microusd+excluded.reserved_microusd",
                (provider, reserve_microusd),
            )
            conn.execute(
                "INSERT INTO work_budgets VALUES (?,?,1,?) ON CONFLICT(scope,hour) DO UPDATE SET turns=turns+1,reserved_tokens=reserved_tokens+excluded.reserved_tokens",
                (scope, hour, tokens),
            )
            if not row:
                conn.execute(
                    "INSERT INTO work_conversations VALUES (?,?,0,NULL,'[]',?,?)",
                    (scope, conversation, contract_hash, now),
                )
            updated = conn.execute(
                "UPDATE work_conversations SET version=version+1,active=? WHERE scope=? AND id=? AND version=? AND active IS NULL",
                (request, scope, conversation, expected),
            )
            if updated.rowcount != 1:
                raise conflict("version_conflict", "Another turn won the version update.")
            conn.execute(
                "INSERT INTO work_turns (scope,conversation,request,fingerprint,response,version,exception_record) VALUES (?,?,?,?,NULL,?,?)",
                (
                    scope,
                    conversation,
                    request,
                    fingerprint,
                    expected + 1,
                    json.dumps(exception_record or {}, allow_nan=False),
                ),
            )
        return expected + 1, None

    def cooldown(self, scope: str, provider: str, model: str) -> float:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT available_after FROM work_provider_health WHERE scope=? AND provider=? AND model=?",
                (scope, provider, model),
            ).fetchone()
            return float(row[0]) if row else 0

    def update_attempts(
        self, scope: str, conversation: str, request: str, version: int, record: dict[str, Any]
    ) -> None:
        with self.connect() as conn:
            changed = conn.execute(
                "UPDATE work_turns SET exception_record=? WHERE scope=? AND conversation=? AND request=? AND version=? AND response IS NULL",
                (json.dumps(record, allow_nan=False), scope, conversation, request, version),
            )
            if changed.rowcount != 1:
                raise conflict("turn_fence_conflict", "The turn is no longer active.")
            if record.get("attempts"):
                attempt = record["attempts"][-1]
                if attempt.get("available_after") is not None:
                    conn.execute(
                        "INSERT INTO work_provider_health VALUES (?,?,?,?) ON CONFLICT(scope,provider,model) DO UPDATE SET available_after=excluded.available_after",
                        (scope, attempt["provider"], attempt["model"], attempt["available_after"]),
                    )

    def reserve_attempt(
        self,
        *,
        scope: str,
        conversation: str,
        request: str,
        version: int,
        record: dict[str, Any],
        tokens: int,
        provider: str,
        cost: int,
        budget: int,
        token_limit: int | None,
    ) -> None:
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT exception_record FROM work_turns WHERE scope=? AND conversation=? AND request=? AND version=? AND response IS NULL",
                (scope, conversation, request, version),
            ).fetchone()
            if not row:
                raise conflict("turn_fence_conflict", "The turn is no longer active.")
            prior = json.loads(row[0]).get("attempts", [])
            attempt = record["attempts"][-1]
            if any(
                item["attempt_id"] == attempt["attempt_id"]
                and item.get("reservation_status") == "reserved"
                for item in prior
            ):
                raise conflict(
                    "attempt_already_reserved",
                    "Reconcile this attempt without calling the model again.",
                )
            spent = conn.execute(
                "SELECT reserved_microusd FROM work_provider_budget WHERE provider=?", (provider,)
            ).fetchone()
            if cost + (spent[0] if spent else 0) > budget:
                raise HermaError(
                    429,
                    "provider_budget_exhausted",
                    "Provider budget exhausted",
                    "The selected provider allowance is reserved.",
                )
            hour = int(time.time() // 3600)
            caller = conn.execute(
                "SELECT reserved_tokens FROM work_budgets WHERE scope=? AND hour=?", (scope, hour)
            ).fetchone()
            if token_limit is not None and tokens + (caller[0] if caller else 0) > token_limit:
                raise HermaError(
                    429,
                    "conversation_budget_exhausted",
                    "Caller budget exhausted",
                    "The caller token allowance is reserved.",
                )
            conn.execute(
                "INSERT INTO work_provider_budget VALUES (?,?) ON CONFLICT(provider) DO UPDATE SET reserved_microusd=reserved_microusd+excluded.reserved_microusd",
                (provider, cost),
            )
            conn.execute(
                "INSERT INTO work_budgets VALUES (?,?,0,?) ON CONFLICT(scope,hour) DO UPDATE SET reserved_tokens=reserved_tokens+excluded.reserved_tokens",
                (scope, hour, tokens),
            )
            attempt["reservation_status"] = "reserved"
            conn.execute(
                "UPDATE work_turns SET exception_record=? WHERE scope=? AND conversation=? AND request=? AND version=?",
                (json.dumps(record, allow_nan=False), scope, conversation, request, version),
            )

    def finish(
        self,
        *,
        scope: str,
        conversation: str,
        request: str,
        version: int,
        message: str,
        response: dict[str, Any],
    ) -> dict[str, Any]:
        # Reservations are conservative and never silently refunded after uncertain calls.
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT history FROM work_conversations WHERE scope=? AND id=? AND active=? AND version=?",
                (scope, conversation, request, version),
            ).fetchone()
            if not row:
                raise conflict(
                    "turn_fence_conflict", "The active turn changed; no result was committed."
                )
            history = json.loads(row["history"])
            history.extend(
                [
                    {"role": "user", "content": message[:2000]},
                    {
                        "role": "assistant",
                        "content": json.dumps(response["proposal"], ensure_ascii=True)[:6000],
                    },
                ]
            )
            response["receipt_hash"] = hashlib.sha256(
                json.dumps(response, sort_keys=True, allow_nan=False).encode()
            ).hexdigest()
            raw = json.dumps(response, allow_nan=False)
            conn.execute(
                "UPDATE work_turns SET response=? WHERE scope=? AND conversation=? AND request=? AND version=?",
                (raw, scope, conversation, request, version),
            )
            conn.execute(
                "UPDATE work_conversations SET history=?,active=NULL WHERE scope=? AND id=? AND active=? AND version=?",
                (json.dumps(history[-12:]), scope, conversation, request, version),
            )
        return response
