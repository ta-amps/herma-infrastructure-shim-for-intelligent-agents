# Summary

**Herma** is a programmable middle-layer proxy for configurable AI coding harnesses. Before an outbound LLM request reaches `/v1/chat/completions`, `/v1/responses`, or `/v1/messages`, Herma:

1. Verifies the caller holds a scoped `hmk_` credential bound to a configurable coding harness (`muse-code`, `opencode`, `claude-code`, `codex`, `swarm-worker`, or `custom-harness`) and is not a closed consumer assistant.
2. Refuses `-contributor` model tiers so code and synthetic case fixtures stay in Standard mode.
3. Evaluates active versioned **provisions** loaded from SQLite, **Tessera** (`herma.provisions` CAS records + `tessera://blobs/<sha256>` excerpts), or a **remote handshake provision server** (`/v1/handshake` + `/v1/provisions`).
4. Runs **keyword/regex/path/tool** (`~0 ms`), **semantic** (`~1–5 ms`), and **micromodel** triggers, short-circuiting the micromodel whenever an earlier tier already matched in `any` mode.
5. Injects matched provision text and authoritative URIs within a bounded character budget, skips provisions already injected earlier in the same conversation (`once_per_conversation`), and records a SHA-256 `InjectionReceipt`.
