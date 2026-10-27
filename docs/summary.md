# Summary

**Herma:** context-shimming AI middleware for configurable coding harnesses — intercepts requests via keyword, semantic, or micromodel rules to respond directly or shim atomic noun, verb, and URI context from a user-configured database before LLM execution.

Before an outbound coding-harness request reaches `/v1/chat/completions`, `/v1/responses`, or `/v1/messages`, Herma:

1. Verifies the caller holds a scoped `hmk_` credential bound to a configurable coding harness (`muse-code`, `opencode`, `claude-code`, `codex`, `swarm-worker`, or `custom-harness`) and refuses closed consumer assistants (`Muse-Personal-Assistant`) and `-contributor` models (`HTTP 403`).
2. Evaluates active versioned **provisions** across **keyword/regex/path/tool** (`~0 ms`), **semantic** (`~1–5 ms`), and **micromodel** triggers, short-circuiting Tier 3 whenever an earlier tier already matched in `any` mode.
3. **Shims context (`action: "shim_context"`)**: Injects matched rule details, authoritative URIs, and bounded `[NOUN/VERB CONTEXT]` entries resolved from Herma's user-configured context database (`context_entries` via `POST /v1/context`, Tessera noun/verb stores, or remote handshake servers), deduplicating prior turns (`once_per_conversation`).
4. **Responds directly (`action: "respond_directly"`)**: Short-circuits upstream LLM execution when a rule can answer deterministically in the caller's native wire protocol with zero upstream token spend, while recording a canonical SHA-256 `InjectionReceipt`.
