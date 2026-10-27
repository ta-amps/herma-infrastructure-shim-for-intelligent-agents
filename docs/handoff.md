# Handoff & Status

> Herma: context-shimming AI middleware for configurable coding harnesses -- intercepts requests via keyword, semantic, or micromodel rules to respond directly or shim atomic noun, verb, and URI context from a user-configured database before LLM execution.

- **Built & Verified (`v0.1.0`)**:
  - Strict Pydantic v2 schemas (`Provision` with `action: "shim_context" | "respond_directly"` and `context_refs`, versioned `ContextEntry` for `noun`/`verb`/`detail` records, `WorkingEntity`, `RuleOutcomeRecord`, `InsightsResponse`, `DryRunResponse`, `InjectionReceipt`).
  - Multi-caller isolation & privilege lockdown: `caller_scope = key:<key_id>` composite primary keys across `provisions`, `context_entries`, `injection_receipts`, `working_entities`, and `rule_outcomes`; `403 builtin_protected` on `system_builtin` IDs; `403 admin_required` on `/v1/admin/keys`; single-statement atomic SQL CAS (`409 version_conflict`); `contributor` and `*-contributor` refusal.
  - Layer-1 Governance Lens & SHA-256 blob verification on Tessera and remote sync (`status:quarantined` blocked, cross-surface `status:verified` required, `visibility_scope` / `allowed_surfaces` / `X-Herma-Cohort` enforced).
  - Deterministic Anti-RAG entity memory (`GET /v1/memory`), automatic Turn `N` `error_signature` -> Turn `N-1` `retry_error` outcome telemetry (`POST /v1/outcomes`), and reviewable draft `candidate_provisions` synthesis (`GET /v1/insights`).
  - Responsive SVG-branded `/` and `/connect` pages with read-only interactive `POST /api/preview` (`persisted: false`), stateless JSON-RPC 2.0 `POST /mcp`, `/.well-known/agent-card.json`, `/llms.txt`, `/llms-full.txt`, `/robots.txt`, `/favicon.svg`, and `/healthz` across both Python FastAPI and Cloudflare Worker + D1.
- **Next Extensions**:
  - Per-repository rule-pack signature verification (Ed25519) on remote handshake bundles.
  - Streaming token-usage accounting attached to `InjectionReceipt`.
