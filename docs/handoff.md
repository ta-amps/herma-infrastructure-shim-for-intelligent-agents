# Handoff & Status

## Integration checkpoint, October 29, 2026

The reviewed release is merged into `main`. The tested implementation revision is
`e1b87f881a1e1a2427f06a5afb229603e7dee6eb`; [its GitHub checks](https://github.com/ta-amps/herma/actions/runs/40873481450) passed.
Fresh builds matched the deployed Worker executable exactly.

85 Python tests and 49 actual Worker checks passed, including strict decision types and offline no-egress controls.

The installed dependency now pins merged Tessera. Context injection is optional and does not grant authority. Explicit typed conversations and configured model-assisted routing retain caller scope, provider policy and budget controls; they do not become a mandatory model review stage.

Follow the [worker-first policy](WORKER-FIRST-EXECUTION.md): independently
schedulable reasoning is a claimed verb; inputs, contracts, artifacts and evidence
are scoped nouns. Workers reason and self-check. Authentication, leases, CAS,
types and receipts stay deterministic. Server inference is an explicitly
configured, scoped and bounded exception. Missing capacity or invalid input does
not enable it automatically.

The earlier inventory below is dated history. These checks cover the recorded
implementations and fixtures; they are not universal harness, load or rendered-UI
certification.

## Earlier handoff

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
