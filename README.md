# Herma – the shim for any agent

Herma is infrastructure: it connects agents to context and models. Versioned nouns
carry data and evidence; claimable verbs carry work. Tessera's storage and task
contracts remain the shared authority, and Herma adds no separate domain reasoning
runtime.

There are exactly two public surfaces: Eranos, the two-sided marketplace, and
Agora, the single overview of architecture and setup, use cases, connecting any
agent and contributing. Tessera and Herma are infrastructure. Home is not a
surface; its address sends people to Agora. Everything else is nouns and
verbs in seed packs, and an agent kit is a seed pack generated for an NGO's agent.

The default agentic executor is the worker's own harness holding a Tessera verb.
Inputs, contracts, artifacts and evidence remain scoped nouns. Herma supplies
configured context when useful; server model turns are explicit bounded exceptions.

Operator-funded conversation providers can be paused independently of worker-owned
providers. Shared cooldowns follow provider retry guidance and admit one funded
recovery request after a limit; see [provider availability](docs/conversations.md#operator-availability-and-automatic-backpressure).

Optional [typed work conversations](docs/conversations.md) let authenticated harnesses ask for clarification and receive one schema-checked noun/verb proposal at a time. Muse, Ollama Cloud, OpenAI, Anthropic and OpenRouter use explicit provider protocols, server credentials, output allowances, durable budget reservations and caller-scoped state. Each operator-funded turn needs the caller's own [operator grant](docs/conversations.md#operator-grants-per-caller). An optional private provider-plan noun permits controlled failover; it can't reach one upstream model through two credentials. The existing turn receipt records every attempt and its server exception. A proposed domain action is never executed by the conversation endpoint.

Workers may use their own local or cloud providers through the ordinary shim.
Herma preserves native generation settings without imposing a response-token
default. See [provider selection and local resources](docs/conversations.md#worker-owned-providers).
The [Jev worker adapter](docs/conversations.md#jev-typed-decisions) prepares and
validates TypeSafe decision messages without network calls or activation.

Read the [design decisions and experiment results](docs/design-and-evidence.md)
and [agent troubleshooting guide](docs/agent-troubleshooting.md). Workers self-check;
additional review is assigned as a verb when needed. Server-funded LLM review is
an exceptional fallback, not a default step for every task.

**Herma:** context-shimming AI middleware for configurable coding harnesses -- intercepts requests via keyword, semantic, or micromodel rules to respond directly or shim atomic noun, verb, and URI context from a user-configured database before LLM execution.

In Classical Greece, a *herma* was an inscribed roadside stone waymarker placed along the road, carved with civic precepts and directional pointers that travellers read *en route* to their destination. **Herma** sits inline between configurable agentic coding harnesses (`muse-code`, `opencode`, `claude-code`, `codex`, `swarm-worker`) and upstream LLM endpoints (`/v1/chat/completions`, `/v1/responses`, `/v1/messages`).

## Worker execution policy

The [worker-first execution policy](docs/WORKER-FIRST-EXECUTION.md) defines claimed verbs, required and optional guidance, tool setup in the task workspace, worker self-checks, private worker access, proportionate review and exceptional server inference. It is engineering direction, with behavioral qualification required before claiming implementation.

## Why Herma Exists

Static system prompts bloat every turn when stuffed with every rule, schema, and command recipe in an organization, yet omitting a rule causes coding agents to violate subtle invariants. Herma inspects outbound coding-harness requests across **three trigger tiers** with strict **`caller_scope` isolation** and either **shims bounded context** or **responds directly**:

1. **Shimming Context Based on Rules & Details (`action: "shim_context"`)**:
   - **Tier 1 -- Keyword, Regex, File-Path & Tool Triggers**: Exact terms, bounded regexes, workspace file globs (`src/tessera/*.py`), and declared tool names. No general latency benchmark is claimed.
   - **Tier 2 -- Semantic Similarity Triggers**: Hybrid concept-cluster + subword cosine matching (plus optional `/v1/embeddings`) can match paraphrased intent without shared literal keywords. Match quality depends on the configured rules and examples.
   - **Tier 3 -- Micromodel Router Triggers**: Lightweight fast classifier prompt (`HERMA_MICROMODEL_URL`, with deterministic offline fallback) invoked only when Tier 1 and Tier 2 did not already match in `any` mode.
   - **Typed and Offline Boundaries**: Model decisions require a JSON boolean `apply` and finite numeric confidence; malformed replies never activate a provision. Offline previews and dry-runs skip model and embedding providers. See [routing boundaries and evidence](docs/design-and-evidence.md#configured-shim-reasoning-and-offline-boundaries).
   - Matched rules shim bounded rule prose, authoritative URIs (`https://`, SHA-256 verified `tessera://blobs/<sha256>`, `tessera://buckets/<bucket>/<key>`, `mcp://`, `urn:`), and **atomic noun, verb, and detail definitions** (`[NOUN/VERB CONTEXT]`) pulled from a caller-isolated database (`POST /v1/context` / `GET /v1/context`, SQLite/D1 `context_entries`, Layer-1 governed [Tessera](https://github.com/ta-amps/tessera-infrastructure-work-and-storage-engine) noun stores & buckets, or a remote handshake database) -- deduplicated across turns (`once_per_conversation`) with a canonical SHA-256 `InjectionReceipt`.

2. **Responding Directly (`action: "respond_directly"`)**:
   - When a matched rule can answer or enforce a deterministic response directly (workspace command recipes, canonical noun/verb schema lookups, or blocked-action guidance), Herma short-circuits upstream forwarding and responds directly in the caller's native protocol (`/v1/chat/completions`, `/v1/responses`, `/v1/messages`, `/v1/dry-run`) with zero upstream LLM token spend, attaching `x-herma-direct-response: true` and `x-herma-receipt-sha256`.

3. **Deterministic Anti-RAG Entity Memory & Self-Improving Shim Loop**:
   - Extracts `file_path`, `code_symbol`, `tessera_uri`, `statute_card_id`, and `error_signature` entities on every turn with **zero LLM calls and zero embeddings**, tracks working-entity frequency per `(caller_scope, project_tag)` (`GET /v1/memory`), attributes follow-up retry errors (`POST /v1/outcomes`), and synthesizes reviewable draft `candidate_provisions` (`GET /v1/insights`) without auto-mutating active rules.

## Configurable Coding Harnesses & Caller Isolation

Herma accepts coding harnesses and personal assistants that can send explicit scoped credentials to configurable endpoints:
- Recognized harness identifiers: `muse-code`, `opencode`, `claude-code`, `codex`, `swarm-worker`, `custom-harness`. An identifier is not a certification of every client; see the [measured attempt matrix](docs/design-and-evidence.md).
- Multi-caller non-poisoning: starter guardrails live in protected `system_builtin` (`403 builtin_protected` for non-admins), while custom rules, context entries, receipts, entity memory, and outcomes are strictly partitioned by `caller_scope = key:<key_id>`.
- Personal assistants may use the same scoped `hmk_` keys. Browser navigation and cookie authentication remain refused; model routing and configuration require explicit credentials.
- Contributor-tier models (any model ID containing `contributor`, such as `*-contributor`) are deterministically refused (`HTTP 403 contributor_tier_refused`).
- AI-agent discovery & preview: serves `POST /api/preview` (`persisted: false`), `POST /mcp` (stateless JSON-RPC 2.0), `/.well-known/agent-card.json`, `/llms.txt`, `/llms-full.txt`, `/robots.txt`, and `/healthz`.

## Quick Start

```bash
git clone https://github.com/ta-amps/herma-infrastructure-shim-for-intelligent-agents.git
cd herma-infrastructure-shim-for-intelligent-agents
make setup
make check
make demo
```

Herma installs independently. `pyproject.toml` pins Tessera to an immutable public
Git commit, and `uv.lock` records the resolved dependency. Python 3.12+, Git and
uv are required; no sibling checkout is needed.

## The ta-amps ecosystem

- **Eranos** (`https://eranos.ta-amps.workers.dev`), public surface: the two-sided marketplace where people donate spare AI capacity and their agents build and review agent kits for nonprofits (`github.com/ta-amps/eranos-public-marketplace-for-public-good-token-burn`)
- **Agora** (`https://ta-amps.github.io/agora-public-overview-architecture-setup-and-contribution/`), public surface: the single overview of architecture and setup, use cases, connecting any agent and contributing (`github.com/ta-amps/agora-public-overview-architecture-setup-and-contribution`)
- **Tessera** (`https://tessera.ta-amps.workers.dev`), infrastructure: atomic noun/verb work queue and compare-and-set storage (`github.com/ta-amps/tessera-infrastructure-work-and-storage-engine`)
- **Herma** (`https://herma.ta-amps.workers.dev`), infrastructure: context-shimming AI middleware for configurable coding harnesses -- 3-tier rules, caller-isolated noun/verb context database, deterministic entity memory, and zero-token direct responses (`github.com/ta-amps/herma-infrastructure-shim-for-intelligent-agents`)
- **Pack library** (`github.com/ta-amps/seed-packs-library-of-nouns-and-verbs`): seed packs of nouns and verbs, such as the collection for spotting exploitation and scams in synthetic cases, never accusing anyone
- `https://home.ta-amps.workers.dev` is not a surface; that address sends people to Agora and still serves the agent brief as text at `/connect`.

## Documentation

- [docs/summary.md](docs/summary.md) -- one-page overview
- [docs/architecture.md](docs/architecture.md) -- components, trust boundaries, and invariants
- [docs/harnesses.md](docs/harnesses.md) -- connecting `muse-code`, `opencode`, `claude-code`, and `codex`
- [docs/setup.md](docs/setup.md) -- local setup, context database (`GET/POST /v1/context`), Tessera & handshake sync, and Cloudflare deploy
- [docs/handoff.md](docs/handoff.md) -- current status and roadmap
- [examples/provisions/README.md](examples/provisions/README.md) -- authored example provisions & atomic noun/verb context entries

External coding harnesses and personal assistants: [anonymous previews and tracked Tessera access](docs/access-modes.md), or `GET /connect.json`.
