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
            """)

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
                return {"version": 0, "history": []}
            return {
                "version": row["version"],
                "history": json.loads(row["history"]),
                "active": row["active"],
            }

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
        token_limit: int = 200000,
        turn_limit: int = 60,
        provider: str = "ollama",
        reserve_microusd: int = 0,
        budget_microusd: int = 0,
    ) -> tuple[int, dict[str, Any] | None]:
        if tokens < 1 or token_limit < 1 or turn_limit < 1 or reserve_microusd < 0:
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
                budget["turns"] >= turn_limit or budget["reserved_tokens"] + tokens > token_limit
            ):
                raise HermaError(
                    429,
                    "conversation_budget_exhausted",
                    "Conversation budget exhausted",
                    "Wait for the caller's next hourly budget.",
                )
            if tokens > token_limit:
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
                "INSERT INTO work_turns VALUES (?,?,?,?,NULL,?)",
                (scope, conversation, request, fingerprint, expected + 1),
            )
        return expected + 1, None

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
