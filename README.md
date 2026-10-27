# Herma

**Herma:** context-shimming AI middleware for configurable coding harnesses — intercepts requests via keyword, semantic, or micromodel rules to respond directly or shim atomic noun, verb, and URI context from a user-configured database before LLM execution.

In Classical Greece, a *herma* was an inscribed roadside stone waymarker placed along the road, carved with civic precepts and directional pointers that travellers read *en route* to their destination. **Herma** sits inline between configurable agentic coding harnesses (`muse-code`, `opencode`, `claude-code`, `codex`, `swarm-worker`) and upstream LLM endpoints (`/v1/chat/completions`, `/v1/responses`, `/v1/messages`).

## Why Herma Exists

Static system prompts bloat every turn when stuffed with every rule, schema, and command recipe in an organization, yet omitting a rule causes coding agents to violate subtle invariants. Herma inspects outbound coding-harness requests across **three trigger tiers** and either **shims bounded context** or **responds directly**:

1. **Shimming Context Based on Rules & Details (`action: "shim_context"`)**:
   - **Tier 1 — Keyword, Regex, File-Path & Tool Triggers (`~0 ms`)**: Exact terms, bounded regexes, workspace file globs (`src/tessera/*.py`), and declared tool names.
   - **Tier 2 — Semantic Similarity Triggers (`~1–5 ms`)**: Hybrid concept-cluster + subword cosine matching (plus optional `/v1/embeddings`) so paraphrased intent fires the right rule with zero shared literal keywords.
   - **Tier 3 — Micromodel Router Triggers**: Lightweight fast classifier prompt (`HERMA_MICROMODEL_URL`, with deterministic offline fallback) invoked only when Tier 1 and Tier 2 did not already match in `any` mode.
   - Matched rules shim bounded rule prose, authoritative URIs (`https://`, `tessera://blobs/<sha256>`, `tessera://buckets/<bucket>/<key>`, `mcp://`, `urn:`), and **atomic noun, verb, and detail definitions** (`[NOUN/VERB CONTEXT]`) pulled from a specialized user-configured database (`POST /v1/context` / `GET /v1/context`, SQLite/D1 `context_entries`, [Tessera](https://github.com/ta-amps/tessera) noun stores & buckets, or a remote handshake database) — deduplicated across turns (`once_per_conversation`) with a canonical SHA-256 `InjectionReceipt`.

2. **Responding Directly (`action: "respond_directly"`)**:
   - When a matched rule can answer or enforce a deterministic response directly (workspace command recipes, canonical noun/verb schema lookups, or blocked-action guidance), Herma short-circuits upstream forwarding and responds directly in the caller's native protocol (`/v1/chat/completions`, `/v1/responses`, `/v1/messages`, `/v1/dry-run`) with zero upstream LLM token spend, attaching `x-herma-direct-response: true` and `x-herma-receipt-sha256`.

## Configurable Coding Harnesses Only

Herma is intentionally restricted to **fully configurable agentic coding harnesses** where the developer controls custom base URLs, headers, and scoped `hmk_<id>.<secret>` credentials:
- Supported harnesses: `muse-code`, `opencode`, `claude-code`, `codex`, `swarm-worker`, `custom-harness`.
- Closed consumer chat clients (such as a generic **Muse Personal Assistant** chat session, browser navigation requests, or cookie sessions) cannot configure rules/context or route through Herma (`HTTP 403 harness_required`).
- Contributor-tier models (`*-contributor`) are deterministically refused (`HTTP 403 contributor_tier_refused`).

## Quick Start

```bash
git clone https://github.com/ta-amps/tessera.git
git clone https://github.com/ta-amps/herma.git
cd herma
make setup
make check
make demo
```

## Sibling Ecosystem (`ta-amps`)

- **Hub**: `https://home.ta-amps.workers.dev`
- **Herma** (`https://herma.ta-amps.workers.dev`): context-shimming AI middleware for configurable coding harnesses — 3-tier rules, atomic noun/verb context database, and zero-token direct responses (`github.com/ta-amps/herma`)
- **Tessera** (`https://tessera.ta-amps.workers.dev`): atomic noun/verb work queue and compare-and-set storage (`github.com/ta-amps/tessera`)
- **Shamash** (`https://shamash.ta-amps.workers.dev`): find, quantify, and combat online human harm, scams, and exploitation (`github.com/ta-amps/shamash`)
- **Eranos** (`https://eranos.ta-amps.workers.dev`): donate unused AI tokens to build and independently review NGO agent kits (`github.com/ta-amps/eranos`)

## Documentation

- [docs/summary.md](docs/summary.md) — one-page overview
- [docs/architecture.md](docs/architecture.md) — components, trust boundaries, and invariants
- [docs/harnesses.md](docs/harnesses.md) — connecting `muse-code`, `opencode`, `claude-code`, and `codex`
- [docs/setup.md](docs/setup.md) — local setup, context database (`GET/POST /v1/context`), Tessera & handshake sync, and Cloudflare deploy
- [docs/handoff.md](docs/handoff.md) — current status and roadmap
- [examples/provisions/README.md](examples/provisions/README.md) — authored example provisions & atomic noun/verb context entries
