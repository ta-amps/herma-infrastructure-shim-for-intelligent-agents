# Handoff & Status

> Herma: context-shimming AI middleware for configurable coding harnesses — intercepts requests via keyword, semantic, or micromodel rules to respond directly or shim atomic noun, verb, and URI context from a user-configured database before LLM execution.

- **Built & Verified (`v0.1.0`)**:
  - Strict Pydantic v2 schemas (`Provision` with `action: "shim_context" | "respond_directly"` and `context_refs`, `ContextEntry` for `noun`/`verb`/`detail` records, `ProvisionURI`, `KeywordTrigger`, `SemanticTrigger`, `MicromodelTrigger`, `DryRunResponse`, `InjectionReceipt`).
  - Configurable-harness gate (`hmk_` SHA-256 hashed credentials, `route` vs. `configure` scopes, consumer-assistant refusal, `-contributor` model refusal).
  - 3-tier trigger engine with `any`/`all` composition and Tier-3 short-circuiting.
  - Specialized atomic noun/verb/detail context database (`context_entries` via `GET/POST /v1/context` + automatic `noun:<store>/<key>` and `verb:<store>/<key>` resolution from Tessera stores) shimmed into bounded `[NOUN/VERB CONTEXT]` blocks.
  - Deterministic zero-token direct responses (`action: "respond_directly"`) across `/v1/chat/completions`, `/v1/responses`, `/v1/messages`, and `/v1/dry-run` with `x-herma-direct-response: true` and `x-herma-receipt-sha256`.
  - Full Python FastAPI (`herma/`) + 24/7 Cloudflare Worker + D1 (`deploy/cloudflare/`) parity.
- **Next Extensions**:
  - Per-repository rule-pack signature verification (Ed25519) on remote handshake bundles.
  - Streaming token-usage accounting attached to `InjectionReceipt`.
