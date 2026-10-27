"""Typed errors mapped deterministically to RFC 9457 problem+json HTTP responses."""

from __future__ import annotations


class HermaError(Exception):
    """Base error with one HTTP status and one machine-readable code."""

    def __init__(self, status_code: int, code: str, title: str, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.code = code
        self.title = title
        self.detail = detail

    def to_problem(self) -> dict[str, object]:
        return {
            "type": "about:blank",
            "title": self.title,
            "status": self.status_code,
            "detail": self.detail,
            "code": self.code,
        }


class HarnessRequiredError(HermaError):
    """Raised when a caller is not an authenticated, configurable agentic coding harness."""

    def __init__(self, detail: str) -> None:
        super().__init__(403, "harness_required", "Configurable Harness Required", detail)


class HarnessScopeError(HermaError):
    """Raised when a harness key lacks the required scope (for example 'configure')."""

    def __init__(self, detail: str) -> None:
        super().__init__(403, "insufficient_scope", "Insufficient Harness Scope", detail)


class AdminRequiredError(HermaError):
    """Raised when a caller invokes an admin-only endpoint without a valid administrator token."""

    def __init__(self, detail: str) -> None:
        super().__init__(403, "admin_required", "Administrator Token Required", detail)


class BuiltinProtectedError(HermaError):
    """Raised when a non-admin caller attempts to modify or delete a system_builtin resource."""

    def __init__(self, resource_id: str) -> None:
        super().__init__(
            403,
            "builtin_protected",
            "System Builtin Protected",
            f"Resource {resource_id!r} belongs to 'system_builtin' and cannot be modified or deleted by non-admin callers.",
        )


class ContributorTierRefusedError(HermaError):
    """Raised when an outbound LLM call targets a contributor training-tier model."""

    def __init__(self, model: str) -> None:
        super().__init__(
            403,
            "contributor_tier_refused",
            "Contributor-Tier Model Refused",
            f"Herma runs in Standard mode only and refuses contributor-tier model {model!r}.",
        )


class ProvisionConflictError(HermaError):
    """Raised when compare-and-set version expectations do not match stored state."""

    def __init__(self, prov_id: str, expected: int | None, actual: int | None) -> None:
        super().__init__(
            409,
            "version_conflict",
            "Provision Version Conflict",
            f"Provision {prov_id!r} version mismatch: expected {expected}, found {actual}.",
        )


class ContextConflictError(HermaError):
    """Raised when compare-and-set version expectations on a context_entries record fail."""

    def __init__(self, entry_id: str, expected: int | None, actual: int | None) -> None:
        super().__init__(
            409,
            "version_conflict",
            "Context Entry Version Conflict",
            f"Context entry {entry_id!r} version mismatch: expected {expected}, found {actual}.",
        )


class ProvisionNotFoundError(HermaError):
    """Raised when a requested provision does not exist."""

    def __init__(self, prov_id: str) -> None:
        super().__init__(
            404,
            "not_found",
            "Provision Not Found",
            f"Provision {prov_id!r} does not exist in the active store.",
        )
