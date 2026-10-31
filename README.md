# Herma -- the context & capability shim for any agent

**Herma:** context-shimming AI middleware for configurable coding harnesses -- intercepts requests via keyword, semantic, or micromodel rules to respond directly or shim atomic noun, verb, and URI context from a user-configured database before LLM execution.

## Tasks (`verbs`) & Task Objects (`nouns`) in Plain Language

Everything in the `ta-amps` ecosystem reduces to two plain-language primitives plus two public surfaces:

- **Tasks (`verbs` on the wire)**: independently schedulable units of work (`enqueue -> claim -> heartbeat -> submit/park`) leased by an authorized worker and guarded by a monotonic `fence` token so two workers never double-execute the same job.
- **Task Objects (`nouns` on the wire)**: every reusable tool, `Feed`, dataset, statute card, LoRA adapter spec, provision shim, or SHA-256 receipt a task uses or creates, stored as compare-and-set records guarded by `expected_version`.
- **Two public surfaces + two infrastructure layers**: **Eranos** (the two-sided public-good token marketplace) and **Agora** (the single public overview of architecture, setup, harness feeds, and contribution) are the two public surfaces; **Tessera** (atomic work & CAS storage engine) and **Herma** (inline context & capability shim) are supporting infrastructure. Seed packs bundle reusable Task Objects and Tasks.

## Why Everyday AI Use Feels Frustratingly Dumb Without a Shim

Raw LLM API calls force an ugly tradeoff on every turn:

1. **Prompt bloat (`HarnessTax`)**: Stuffing every project rule, post-cutoff schema, URI, and refusal boundary into a static system prompt burns thousands of tokens on every turn even when 95% of those rules are irrelevant to the current edit.
2. **Post-cutoff amnesia**: Omitting those local contracts makes even strong models hallucinate retired fields, skip optimistic concurrency (`expected_version`) or queue lease `fence` tokens, and miss newly created Task Objects.

In Classical Greece, a *herma* was an inscribed roadside stone pillar placed along the road with concise directional pointers for travellers *en route*. **Herma** sits inline between configurable coding harnesses (`muse-code`, `opencode`, `claude-code`, `codex`, `swarm-worker`, `personal-assistant`) and upstream model endpoints (`/v1/chat/completions`, `/v1/responses`, `/v1/messages`). On each request, Herma evaluates **three trigger tiers** (`keyword`, `semantic`, `micromodel`) with strict **`caller_scope` isolation** to either:

- **Respond directly (`action: "respond_directly"`)** in 0 upstream LLM tokens when a deterministic contract or natural-language schema lookup (`"What are tasks and task objects?"`) has an authoritative answer, or
- **Shim bounded Task Object & Task context (`action: "shim_context"`)** right before inference -- lifting frozen 150-row `Llama 3.2 3B` exact tool-call accuracy from **`52.0% -> 64.7%` (+12.7 pp)** with **zero weight updates** (see [`eval/shim_lift_summary.json`](eval/shim_lift_summary.json) and [`eval/herma-shim-lift.svg`](eval/herma-shim-lift.svg)).

![Herma Context Shim Lift & Meta Model Routing](eval/herma-shim-lift.svg)

## Which Meta Models Do What

Herma coordinates frontier Muse models, open-weights `Muse Glimmer` QLoRA specialists, local `Llama 3.2` Shim Routers / Parametric Memory LoRAs, and the `Muse Code` coding harness under one strict privacy invariant (`ContributorTierRefusedError` blocks every `*-contributor` tier so private or NGO inputs never enter training):

| Meta Model / Harness | Role in Herma & `ta-amps` | Memory / Routing Regime | Measured / Verified Signal |
| :--- | :--- | :--- | :--- |
| **`Muse Spark 1.3`** (`muse-spark-1.3`) | Frontier workhorse for open-ended multi-step coding, complex tool orchestration, and independent review Tasks (`verbs`). | Herma Context Shim + Standard-mode passthrough (`*-contributor` refused with HTTP 403). | Enforces `caller_scope` isolation, durable microdollar budget reservations, and SHA-256 `InjectionReceipt` auditing. |
| **`Muse Wonder 1.0`** (`muse-wonder-1.0`) | Fast structured synthesis and typed work-conversation proposals (`POST /v1/conversations/turn`). | Schema-checked single-proposal dialogue (`executed: false`; never runs domain side effects server-side). | Deterministic duplicate-key JSON rejection and exact picodollar/microdollar spend ceilings across Python and Worker. |
| **`Muse Glimmer 30B QLoRA`** | Open-weights specialist fine-tuned with 4-bit QLoRA adapters for recurring post-cutoff Task Object schemas and refusal rules. | **LoRA as Parametric Memory** -- internalizes stabilized schemas so turns avoid repeated `HarnessTax` prompt bloat. | **`93.3% -> 99.3%`** (+6.0 pp) exact tool-call match on pre-registered 150-row synthetic holdout (`100.0%` valid JSON). |
| **`Llama 3.2 1B / 3B`** | Sub-10ms local Tier-3 **Shim Router** (`1B` PEFT LoRA) & edge **LoRAs as Parametric Memory** (`1B`/`3B` PEFT LoRA). | Zero-weight Herma Shim first (`52.0% -> 64.7%` on `3B`), then PEFT LoRA (`r=16..32`) once schemas stabilize. | `Llama 3.2 3B`: `52.0%` base -> **`64.7%` Herma Shim** -> **`72.7%` promoted LoRA**; `1B`: `12.0% -> 50.7%` on 150-row frozen test. |
| **`Muse Code`** (`X-Herma-Harness: muse-code`) | Configurable agentic coding harness connecting inline to Herma over `/v1/responses` and `/v1/chat/completions`. | Benchmarked alongside **Harness Square / Harness2**, **OpenCode**, and **Pi** inside encapsulating `Feed` Task Objects. | Shimmed via `PROV-HARNESS-FEEDS-GUIDE` with explicit `HarnessTax` token overhead and receipt-backed benchmark profiles. |

## Prompt Shimming vs LoRAs as Parametric Memory (`training/` & `eval/`)

Herma pairs zero-weight prompt shimming with reproducible PEFT LoRA specifications (see [`training/README.md`](training/README.md), [`training/shim-router-lora-spec.json`](training/shim-router-lora-spec.json), and builtin starter `PROV-LORA-MEMORY-ROUTING`):

1. **Volatile or caller-scoped facts -> Herma Context Shim (`0` weight updates)**: Live queue lease rules, newly minted URIs, statute cards, and per-caller provisions (`POST /v1/context`, `PUT /v1/provisions/{id}`).
2. **Stable post-cutoff schemas -> PEFT LoRA as Parametric Memory**: Once a Task Object schema or natural-language routing boundary stabilizes across hundreds of turns, compile synthetic verified traces into a `Llama 3.2 1B/3B` or `Muse Glimmer 30B` PEFT LoRA adapter gated by held-out promotion checks.
3. **Novel multi-step reasoning -> Frontier Passthrough**: Route through Herma to `Muse Spark 1.3` or `Muse Wonder 1.0` in Standard mode.

## Core Architecture & Operational Boundaries

The default agentic executor is the worker's own harness holding a Tessera Task (`verb`). Inputs, contracts, artifacts, and evidence remain scoped Task Objects (`nouns`). Herma supplies configured context when useful; server model turns are explicit bounded exceptions.

- **Three-Tier Trigger Engine (`action: "shim_context"` or `"respond_directly"`)**:
  - **Tier 1 -- Keyword, Regex, File-Path & Tool Triggers**: Exact natural-language phrases, bounded regexes, workspace file globs (`src/tessera/*.py`, `training/*`), and declared tool names.
  - **Tier 2 -- Semantic Similarity Triggers**: Hybrid concept-cluster + subword cosine matching (plus optional `/v1/embeddings`) matching paraphrased engineering intent without shared literal IDs.
  - **Tier 3 -- Micromodel Router Triggers**: Lightweight classifier prompt (`HERMA_MICROMODEL_URL`, with deterministic offline fallback) invoked only when Tier 1 and Tier 2 did not already match in `any` mode.
  - **Typed & Offline Boundaries**: Model decisions require a JSON boolean `apply` and finite numeric confidence; malformed replies never activate fallback. Offline previews and dry-runs skip remote model/embedding calls. See [routing boundaries and evidence](docs/design-and-evidence.md#configured-shim-reasoning-and-offline-boundaries).
- **Deterministic Anti-RAG Entity Memory & Self-Improving Shim Loop**:
  - Extracts `file_path`, `code_symbol`, `tessera_uri`, `statute_card_id`, and `error_signature` entities with **zero LLM calls and zero embeddings**, tracks working-entity frequency per `(caller_scope, project_tag)` (`GET /v1/memory`), attributes follow-up retry errors (`POST /v1/outcomes`), and synthesizes reviewable draft `candidate_provisions` (`GET /v1/insights`) without auto-mutating active rules.
- **Typed Work Conversations & Provider Accounting**:
  - Optional [typed work conversations](docs/conversations.md) let authenticated harnesses request one schema-checked noun/verb proposal at a time (`executed: false`). Operator-funded providers support independent pause/backpressure ([provider availability](docs/conversations.md#operator-availability-and-automatic-backpressure)), per-caller [operator grants](docs/conversations.md#operator-grants-per-caller), durable exact-microdollar reservations, and the offline [Jev worker adapter](docs/conversations.md#jev-typed-decisions). See also the [worker-first execution policy](docs/WORKER-FIRST-EXECUTION.md) and [agent troubleshooting guide](docs/agent-troubleshooting.md).
- **Caller Isolation & Layer-1 Governance Lens**:
  - Starter provisions (`PROV-DIRECT-NOUN-VERB-SCHEMA`, `PROV-TESSERA-FENCING`, `PROV-RISK-REVIEW-NON-ACCUSATORY`, `PROV-HARNESS-FEEDS-GUIDE`, `PROV-LORA-MEMORY-ROUTING`, `PROV-NGO-HUMAN-BOUNDARY`, `PROV-EDGE-ORIGIN-LOCKDOWN`) carry verified `metadata_tags.fabric_governance` and live in protected `system_builtin` (`403 builtin_protected` for non-admins). Custom rules and receipts are isolated per `caller_scope = key:<key_id>`.

## Quick Start & Reproducible Container

```bash
git clone https://github.com/ta-amps/herma-infrastructure-shim-for-intelligent-agents.git
cd herma-infrastructure-shim-for-intelligent-agents
make setup
make check
make demo
```

Herma installs independently (`pyproject.toml` pins Tessera to an immutable public Git commit and `uv.lock` locks dependencies). You can also build and run the standalone container from the repository root:

```bash
docker build -t herma-shim:local .
docker run --rm -p 7730:7730 herma-shim:local
```

## The `ta-amps` Ecosystem

- **Eranos** (`https://eranos.ta-amps.workers.dev`), public surface: the two-sided marketplace where people donate spare AI capacity and their agents build and review agent kits for nonprofits (`github.com/ta-amps/eranos-public-marketplace-for-public-good-token-burn`)
- **Agora** (`https://ta-amps.github.io/agora-public-overview-architecture-setup-and-contribution/`), public surface: the single overview of architecture and setup, harness research feeds, use cases, connecting any agent, and contributing (`github.com/ta-amps/agora-public-overview-architecture-setup-and-contribution`)
- **Tessera** (`https://tessera.ta-amps.workers.dev`), infrastructure: atomic Task (`verb`) work queue and compare-and-set Task Object (`noun`) storage (`github.com/ta-amps/tessera-infrastructure-work-and-storage-engine`)
- **Herma** (`https://herma.ta-amps.workers.dev`), infrastructure: context-shimming AI middleware for configurable coding harnesses (`github.com/ta-amps/herma-infrastructure-shim-for-intelligent-agents`)
- **Pack library** (`github.com/ta-amps/seed-packs-library-of-nouns-and-verbs`): seed packs of Task Objects (`nouns`) and Tasks (`verbs`), including synthetic-only exploitation-evidence checks
- `https://home.ta-amps.workers.dev` redirects visitors to Agora and serves the agent brief as text at `/connect`.

## Documentation & Artifacts

- [docs/summary.md](docs/summary.md) -- one-page overview
- [docs/architecture.md](docs/architecture.md) -- components, trust boundaries, and invariants
- [docs/harnesses.md](docs/harnesses.md) -- connecting `muse-code`, `opencode`, `claude-code`, and `codex`
- [docs/setup.md](docs/setup.md) -- local setup, context database (`GET/POST /v1/context`), Tessera & handshake sync, and Cloudflare deploy
- [docs/handoff.md](docs/handoff.md) -- current status and roadmap
- [examples/provisions/README.md](examples/provisions/README.md) -- builtin starter provisions & atomic Task Object / Task context entries
- [training/README.md](training/README.md) -- PEFT LoRA Shim Router & Parametric Memory specification (`requirements-train.txt`, `shim-router-lora-spec.json`)
- [eval/shim_lift_summary.json](eval/shim_lift_summary.json) & [eval/herma-shim-lift.svg](eval/herma-shim-lift.svg) -- measured context-shim lift and trigger routing benchmarks

External coding harnesses and personal assistants: [anonymous previews and tracked Tessera access](docs/access-modes.md), or `GET /connect.json`.
