# Herma

**Herma:** programmable AI request middleware for configurable coding harnesses — intercepts outbound LLM calls via keyword, semantic, and micromodel triggers to inject versioned rules, provisions, and URIs before model execution.

In Classical Greece, a *herma* was an inscribed roadside stone waymarker placed along the road, carved with civic precepts and directional pointers that travellers read *en route* to their destination. **Herma** sits inline between configurable agentic coding harnesses (`muse-code`, `opencode`, `claude-code`, `codex`, `swarm-worker`) and upstream LLM endpoints (`/v1/chat/completions`, `/v1/responses`, `/v1/messages`).

## Why Herma Exists

Static system prompts bloat every turn when stuffed with every rule in an organization, yet omitting a rule causes agents to violate subtle invariants. Herma loads versioned **provisions** and **URI pointers** from [Tessera](https://github.com/ta-amps/tessera) (or any remote handshake provision store) and evaluates a **three-tier trigger pipeline** on each outbound request:

1. **Tier 1 — Keyword, Regex, File-Path & Tool Triggers (`~0 ms`)**: Exact terms, bounded regexes, workspace file globs (`src/tessera/*.py`), and declared tool names.
2. **Tier 2 — Semantic Similarity Triggers (`~1–5 ms`)**: Hybrid concept-cluster + subword cosine matching (plus optional `/v1/embeddings`) so paraphrased intent fires the right provision even with zero shared literal keywords.
3. **Tier 3 — Micromodel Router Triggers**: Lightweight fast classifier prompt (`HERMA_MICROMODEL_URL`, with deterministic offline fallback) invoked only when Tier 1 and Tier 2 did not already match in `any` mode.

Matched provisions inject bounded rule prose and authoritative URIs (`https://`, `tessera://blobs/<sha256>`, `mcp://`, `urn:`) once per conversation (skipping duplicate re-injection on later turns) and record a canonical SHA-256 `InjectionReceipt`.

## Configurable Coding Harnesses Only

Herma is intentionally restricted to **fully configurable agentic coding harnesses** where the developer controls custom base URLs, headers, and scoped `hmk_<id>.<secret>` credentials:
- Supported harnesses: `muse-code`, `opencode`, `claude-code`, `codex`, `swarm-worker`, `custom-harness`.
- Closed consumer chat clients (such as a generic **Muse Personal Assistant** chat session, browser navigation requests, or cookie sessions) cannot configure provisions or route through Herma (`HTTP 403 harness_required`).
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
- **Herma** (`https://herma.ta-amps.workers.dev`): programmable AI request middleware & 3-tier provision injector (`github.com/ta-amps/herma`)
- **Tessera** (`https://tessera.ta-amps.workers.dev`): atomic noun/verb work queue and compare-and-set storage (`github.com/ta-amps/tessera`)
- **Shamash** (`https://shamash.ta-amps.workers.dev`): find, quantify, and combat online human harm, scams, and exploitation (`github.com/ta-amps/shamash`)
- **Eranos** (`https://eranos.ta-amps.workers.dev`): donate unused AI tokens to build and independently review NGO agent kits (`github.com/ta-amps/eranos`)

## Documentation

- [docs/summary.md](docs/summary.md) — one-page overview
- [docs/architecture.md](docs/architecture.md) — components, trust boundaries, and invariants
- [docs/harnesses.md](docs/harnesses.md) — connecting `muse-code`, `opencode`, `claude-code`, and `codex`
- [docs/setup.md](docs/setup.md) — local setup, Tessera & remote handshake store sync, and Cloudflare edge deploy
- [docs/handoff.md](docs/handoff.md) — current status and roadmap
- [examples/provisions/README.md](examples/provisions/README.md) — authored example provisions
