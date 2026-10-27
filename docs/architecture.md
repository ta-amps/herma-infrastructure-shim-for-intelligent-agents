# Architecture

**Herma:** context-shimming AI middleware for configurable coding harnesses — intercepts requests via keyword, semantic, or micromodel rules to respond directly or shim atomic noun, verb, and URI context from a user-configured database before LLM execution.

```mermaid
flowchart LR
  H["Configurable Coding Harness<br/>muse-code / opencode / claude-code / codex"] --> E["Cloudflare Worker Edge<br/>D1 + HSTS/CSP + x-edge-auth"]
  E --> G["Harness Gate<br/>hmk_ scopes + consumer refusal"]
  G --> T["3-Tier Trigger Engine<br/>1. Keyword  2. Semantic  3. Micromodel"]
  S[("Provisions + Noun/Verb Context DB<br/>SQLite / D1 / Tessera / Handshake")] --> T
  T -->|"action: respond_directly"| D["Direct Protocol Response<br/>0 upstream tokens + SHA-256 Receipt"]
  T -->|"action: shim_context"| I["Context Shim + Dedupe + Budget<br/>[NOUN/VERB CONTEXT] + URIs + Receipt"]
  I --> U["Upstream LLM Endpoint<br/>/v1/chat/completions · /v1/responses · /v1/messages"]
```

## Components

- `herma/errors.py` — RFC 9457 `problem+json` error hierarchy.
- `herma/schemas.py` — strict Pydantic v2 models for `Provision` (`shim_context` / `respond_directly` + `context_refs`), `ContextEntry` (`noun` / `verb` / `detail`), URIs, triggers, harness keys, `DryRunResponse`, and `InjectionReceipt`.
- `herma/harness_gate.py` — constant-time `hmk_` verification, consumer-surface refusal, `configure` harness attestation, and `-contributor` refusal.
- `herma/triggers/` — `keyword.py`, `semantic.py`, `micromodel.py`, and `engine.py`.
- `herma/store.py` — SQLite WAL store (`provisions`, `context_entries`, `harness_keys`, `injection_receipts`), compare-and-set updates, Tessera CAS/blob/noun-verb store sync, and remote handshake sync.
- `herma/injector.py` — multi-protocol envelope extraction, `[NOUN/VERB CONTEXT]` rendering, direct-response assembly, turn deduplication, and SHA-256 receipts.
- `herma/proxy.py` — direct-response short-circuiting (`chat.completion`, `response`, `message`) and upstream forwarding (JSON and streaming SSE) with allowlisted upstream hosts.
- `herma/api/` — FastAPI app (`:7730`) serving `/v1/context`, `/v1/provisions`, `/v1/dry-run`, and proxy endpoints behind `HERMA_EDGE_SECRET` lockdown plus server-rendered status pages.
- `deploy/cloudflare/` — 24/7 native Cloudflare Worker + D1 (`ta-amps-herma`) + `TESSERA` Service Binding with full context-shimming and direct-response parity.

## Invariants

| Id | Always true | Checked by |
|---|---|---|
| H01 | Generic consumer chat assistants, browser navigation requests, and cookie-authenticated calls are deterministically refused | `test_consumer_assistant_and_browser_navigation_refused`, `test_http_edge_lockdown_and_dry_run_across_wire_formats` |
| H02 | Provision management and remote sync require both configure scope and explicit matching X-Herma-Harness attestation | `test_consumer_assistant_and_browser_navigation_refused`, `test_route_only_key_cannot_configure` |
| H03 | Contributor-tier models (-contributor) are refused across outbound LLM payloads and micromodel trigger classifiers | `test_tier3_micromodel_classifier_and_contributor_refusal`, `test_http_edge_lockdown_and_dry_run_across_wire_formats` |
| H04 | Tier-1 keyword, bounded regex, path-glob, and tool-name triggers match deterministically without network calls | `test_tier1_keyword_regex_path_and_tool_triggers` |
| H05 | Tier-2 semantic triggers match paraphrased intent without literal keyword overlap | `test_tier2_semantic_paraphrase_without_literal_id` |
| H06 | Tier-1 or Tier-2 hits short-circuit Tier-3 micromodel calls when trigger mode is any | `test_engine_short_circuits_micromodel_when_keyword_matches` |
| H07 | Compare-and-set versions prevent silent provision overwrites, Tessera blob URIs resolve deterministically, and remote handshakes clamp max_chars | `test_cas_conflict_and_tessera_blob_sync`, `test_remote_handshake_clamps_max_chars` |
| H08 | Multi-turn conversations deduplicate once_per_conversation provisions and HERMA_EDGE_SECRET blocks direct origin traffic lacking x-edge-auth | `test_http_edge_lockdown_and_dry_run_across_wire_formats` |
| H09 | Matched context_refs shim bounded atomic noun, verb, and detail entries from context_entries or Tessera stores and record shimmed_context_refs in the receipt | `test_store_context_entries_and_tessera_noun_verb_resolution`, `test_api_context_database_and_noun_verb_shimming` |
| H10 | Provisions with action=respond_directly return protocol-faithful completions across chat_completions, responses, and messages without invoking upstream LLM transport while recording a SHA-256 receipt | `test_direct_response_short_circuits_upstream_across_all_protocols`, `test_cloudflare_worker_context_shim_and_direct_response_parity` |
