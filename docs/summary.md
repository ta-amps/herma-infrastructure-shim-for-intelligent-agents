# Summary

**The Teleion Fabric shim:** context-shimming AI middleware for configurable coding harnesses -- intercepts requests via keyword, semantic, or micromodel rules to respond directly or shim atomic Task Object, Task, and URI context from a user-configured database before LLM execution.

Before an outbound coding-harness request reaches `/v1/chat/completions`, `/v1/responses`, or `/v1/messages`, the Teleion Fabric shim:

1. Verifies the caller holds a scoped `hmk_` credential bound to a configurable coding harness (`muse-code`, `opencode`, `claude-code`, `codex`, `swarm-worker`, or `custom-harness`), isolates custom state under `caller_scope = key:<key_id>` while protecting `system_builtin` rules, and accepts personal assistants with the same scoped credentials. It refuses any model ID containing `contributor`, such as `*-contributor` (`HTTP 403`).
2. Evaluates `system_builtin` + caller-scoped **provisions** filtered by the Layer-1 Governance Lens across **keyword/regex/path/tool** (`~0 ms`), **semantic** (`~1-5 ms`), and **micromodel** triggers, short-circuiting Tier 3 whenever an earlier tier already matched in `any` mode.
3. **Shims context (`action: "shim_context"`)**: Injects matched rule details, SHA-256 checked URIs, and bounded `[NOUN/VERB CONTEXT]` entries resolved from the Teleion Fabric shim's caller-isolated context database (`context_entries` via `POST /v1/context`, governed Teleion Fabric noun/verb stores, or remote handshake servers), deduplicating prior turns (`once_per_conversation`).
4. **Responds directly (`action: "respond_directly"`) & learns deterministically**: Short-circuits upstream LLM execution with zero upstream token spend when a rule answers deterministically, tracks top-of-mind entities (`GET /v1/memory`) and retry-error outcomes (`POST /v1/outcomes`), and synthesizes reviewable `candidate_provisions` (`GET /v1/insights`) without mutating active rules.
