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
from herma.provider_health import (
    ACCOUNT_LIMITS,
    IDENTITY_LIMITS,
    admit_health,
    fresh_health,
    limit_reason,
    settle_health,
)


def conflict(code: str, detail: str) -> HermaError:
    return HermaError(409, code, "Conversation conflict", detail)


class ConversationState:
    # Seconds to wait for a competing SQLite writer before reporting a storage failure.
    busy_timeout: float = 10

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
                CREATE TABLE IF NOT EXISTS work_provider_identity (
                    identity TEXT PRIMARY KEY, available_after REAL NOT NULL,
                    reason TEXT NOT NULL, route TEXT NOT NULL);
            """)
            conn.execute("BEGIN IMMEDIATE")
            columns = {row[1] for row in conn.execute("PRAGMA table_info(work_turns)")}
            if "exception_record" not in columns:
                conn.execute(
                    "ALTER TABLE work_turns ADD COLUMN exception_record TEXT NOT NULL DEFAULT '{}'"
                )
            health_columns = {
                row[1] for row in conn.execute("PRAGMA table_info(work_provider_health)")
            }
            if "state" not in health_columns:
                conn.execute(
                    "ALTER TABLE work_provider_health ADD COLUMN state TEXT NOT NULL DEFAULT '{}'"
                )

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=self.busy_timeout)
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
        provider: str = "meta",
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
                        "INSERT INTO work_provider_health (scope,provider,model,available_after) VALUES (?,?,?,?) ON CONFLICT(scope,provider,model) DO UPDATE SET available_after=excluded.available_after",
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
        account: str = "operator",
        allow_probe: bool = False,
        allow_uncertain: bool = False,
    ) -> dict[str, Any]:
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
            now = time.time()
            held = conn.execute(
                "SELECT available_after,reason,route FROM work_provider_identity WHERE identity=? AND available_after>?",
                (attempt["upstream_identity"], now),
            ).fetchone()
            if held and held["route"] != provider:
                # Another provider route (a direct API or a gateway) holds a different
                # credential, so it cannot reach the same upstream model during that limit.
                # One provider's operator accounts keep their own isolated health instead;
                # changing an account alias is an explicit operator configuration change.
                # Checked before health admission, so the skip never holds a probe lease.
                attempt.update(
                    provider_health={
                        "state": "limited",
                        "reason": held["reason"],
                        "available_after": held["available_after"],
                        "requires_uncertain_authorization": False,
                        "scope": "upstream_model_identity",
                    },
                    reservation_status="denied",
                    reservation_ceiling_tokens=tokens,
                    reserved_tokens=0,
                )
                return {
                    "ok": False,
                    "code": "provider_identity_cooldown",
                    "health": attempt["provider_health"],
                }
            states = self._health_states(conn, account, provider, attempt["model"])
            admission = admit_health(
                states,
                attempt["attempt_id"],
                now,
                allow_probe=allow_probe,
                allow_uncertain=allow_uncertain,
            )
            self._write_health(conn, account, provider, states)
            attempt["provider_health"] = admission["health"]
            if not admission["ok"]:
                attempt.update(
                    reservation_status="denied",
                    reservation_ceiling_tokens=tokens,
                    reserved_tokens=0,
                )
                return admission
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
            attempt.update(reservation_status="reserved", reserved_tokens=tokens)
            attempt["health_ticket"] = admission["ticket"]
            conn.execute(
                "UPDATE work_turns SET exception_record=? WHERE scope=? AND conversation=? AND request=? AND version=?",
                (json.dumps(record, allow_nan=False), scope, conversation, request, version),
            )
            return admission

    @staticmethod
    def _health_states(
        conn: sqlite3.Connection, account: str, provider: str, model: str
    ) -> dict[str, dict[str, Any]]:
        states = {}
        for key in ("*", model):
            row = conn.execute(
                "SELECT state FROM work_provider_health WHERE scope=? AND provider=? AND model=?",
                ("operator:" + account, provider, key),
            ).fetchone()
            states[key] = {**fresh_health(), **json.loads(row[0])} if row else fresh_health()
        return states

    @staticmethod
    def _write_health(
        conn: sqlite3.Connection, account: str, provider: str, states: dict[str, dict[str, Any]]
    ) -> None:
        for model, state in states.items():
            if state["generation"] or state["probe_id"]:
                conn.execute(
                    "INSERT INTO work_provider_health (scope,provider,model,available_after,state) VALUES (?,?,?,?,?) ON CONFLICT(scope,provider,model) DO UPDATE SET available_after=excluded.available_after,state=excluded.state",
                    (
                        "operator:" + account,
                        provider,
                        model,
                        state["available_after"],
                        json.dumps(state, allow_nan=False),
                    ),
                )

    def settle_provider_health(
        self,
        scope: str,
        conversation: str,
        request: str,
        version: int,
        record: dict[str, Any],
        account: str,
    ) -> None:
        attempt = record["attempts"][-1]
        if "health_ticket" not in attempt:
            return
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT exception_record FROM work_turns WHERE scope=? AND conversation=? AND request=? AND version=? AND response IS NULL",
                (scope, conversation, request, version),
            ).fetchone()
            if not row:
                raise conflict("turn_fence_conflict", "The turn is no longer active.")
            previous = next(
                (
                    a
                    for a in json.loads(row[0]).get("attempts", [])
                    if a["attempt_id"] == attempt["attempt_id"]
                ),
                None,
            )
            if previous and previous.get("health_settled"):
                attempt["provider_health"] = previous["provider_health"]
                attempt["health_settled"] = True
                return
            states = self._health_states(conn, account, attempt["provider"], attempt["model"])
            evidence = {
                "outcome": attempt["outcome"],
                "error_code": attempt["error_code"],
                "reason": (attempt.get("provider_diagnostics") or {}).get("reason"),
                "http_status": attempt.get("upstream_http_status"),
            }
            attempt["provider_health"] = settle_health(
                states,
                attempt["health_ticket"],
                attempt["attempt_id"],
                attempt["model"],
                time.time(),
                retry_seconds=attempt.get("retry_after_seconds"),
                **evidence,
            )
            self._write_health(conn, account, attempt["provider"], states)
            limited = limit_reason(**evidence)
            if limited in IDENTITY_LIMITS:
                held = states["*" if limited in ACCOUNT_LIMITS else attempt["model"]]
                conn.execute(
                    "INSERT INTO work_provider_identity VALUES (?,?,?,?) ON CONFLICT(identity) DO UPDATE SET available_after=MAX(available_after,excluded.available_after),reason=excluded.reason,route=excluded.route",
                    (
                        attempt["upstream_identity"],
                        held["available_after"],
                        limited,
                        attempt["provider"],
                    ),
                )
            attempt["health_settled"] = True
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
