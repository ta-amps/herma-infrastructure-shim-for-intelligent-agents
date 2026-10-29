# Typed work conversations

`POST /v1/conversations/turn` provides optional model-assisted clarification and next-action proposals in Python and the Cloudflare Worker. It requires the same scoped `hmk_` route credential as interception and is disabled unless `HERMA_CONVERSATION_ENABLED=true`. Public preview remains deterministic.

Configure context entries through the existing `configure` scope. An entry's `schema_or_body.work_contract` contains an `operation_id`, a canonical Tessera `category_id`, a short `description`, and a JSON object `input_schema` with explicit field types. Objects require `properties` and `additionalProperties:false`; arrays require typed `items`. The portable profile permits primitive types, primitive enum/const, required fields, length/item/numeric bounds and at most eight anyOf/oneOf alternatives. Schemas are limited to 12 KiB, 128 nodes and depth eight. References, regular expressions and unknown keywords are rejected. Each operation becomes its own function tool. Category membership does not itself certify artifact quality. Worker category guidance and system instructions are generated from the installed Python source with `scripts/build_conversation_data.py`; CI checks freshness.

Example request, using a context entry already visible to the authenticated caller:

`GET /api/conversation-schema` returns the generated turn, work-contract and proposal schemas without authentication. Use `/connect.json` to discover that route and the enabled flag. JSON Schema describes the data shapes; the bounded portable profile above adds runtime constraints.

```json
{
  "conversation_id": "work-session-001",
  "request_id": "turn-request-001",
  "expected_version": 0,
  "message": "Hello. What work can I do today?",
  "context_refs": ["work.observation"],
  "provider": "meta"
}
```

The result is `clarify`, `ready` or `blocked`, always with `executed:false`. A ready proposal contains validated arguments. The caller executes through its own authorized task harness and reports the result in a subsequent turn. A model cannot create new tools, mint permissions or execute code through this endpoint. Incorrect payload types produce field paths and a clarification; they are never silently coerced.

Use the returned version as `expected_version` on the next turn. Repeating an identical request ID returns its stored response without another model call. Reusing that ID for different input returns 409. An active turn or changed contract also returns 409. `GET /v1/conversations/{id}` shows only the current caller's transcript and active request. Conversations stop accepting turns after 24 hours.

The Worker uses one SQLite Durable Object per caller and a separate small provider-budget coordinator. It allows at most two active turns per caller. An alarm seals unfinished turns after two minutes as `provider_outcome_uncertain`; it never retries the model. At conversation expiry, alarms remove transcripts and turn responses while retaining ID/version tombstones, which prevent expired IDs from being reused. Retention in provider/platform backups follows their separate policies. A caller can create at most 10,000 conversation IDs before operator maintenance. The local Python implementation retains transcripts and requires operator reconciliation after a process crash; it does not run the Worker's alarms.

Provider configuration is operator-owned:

| Setting | Default |
| --- | --- |
| `HERMA_CONVERSATION_ENABLED` | disabled |
| `HERMA_CONVERSATION_META_MODEL` | `muse-spark-1.3` |
| `HERMA_CONVERSATION_OLLAMA_MODEL` | `muse-spark-open` |
| `HERMA_CONVERSATION_OPENAI_MODEL` | Required when selecting OpenAI; no guessed model |
| `HERMA_CONVERSATION_ANTHROPIC_MODEL` | Required when selecting Anthropic; no subscription/OAuth credential reuse |
| `HERMA_CONVERSATION_OPENROUTER_MODEL` | Required fixed model; auto routers, presets and online tool variants refused |
| `HERMA_CONVERSATION_OPENROUTER_PROVIDER` | Required underlying provider slug, pinned by `only` and `order` |
| `HERMA_CONVERSATION_ANTHROPIC_VERSION` | `2026-10-21`; explicit `2023-06-01` is also supported |
| `HERMA_CONVERSATION_<PROVIDER>_MAX_OUTPUT` | Required positive output allowance; no default or universal token clamp |
| `HERMA_CONVERSATION_MAX_OUTPUT` | Optional legacy shared allowance, overridden by the provider setting |
| `HERMA_CONVERSATION_<PROVIDER>_REASONING` | Omitted unless configured; optional shared `HERMA_CONVERSATION_REASONING` fallback |
| `HERMA_CONVERSATION_<PROVIDER>_GENERATION` | JSON object of native generation settings, empty by default |
| `HERMA_CONVERSATION_CALLER_TOKENS_PER_HOUR` | Optional cumulative caller token allowance; absent by default |
| `HERMA_META_BUDGET_USD` | 5 cumulative reserved dollars |
| `HERMA_OPENAI_BUDGET_USD` | Required positive cumulative reserved dollar allowance for OpenAI |
| `HERMA_ANTHROPIC_BUDGET_USD`, `HERMA_OPENROUTER_BUDGET_USD` | Required positive cumulative allowance for the selected provider |
| `HERMA_CONVERSATION_OPENAI_INPUT_USD_PER_MILLION` | Required configured model input price ceiling |
| `HERMA_CONVERSATION_OPENAI_OUTPUT_USD_PER_MILLION` | Required configured model output price ceiling |
| `HERMA_CONVERSATION_ANTHROPIC_INPUT_USD_PER_MILLION`, `HERMA_CONVERSATION_ANTHROPIC_OUTPUT_USD_PER_MILLION` | Required configured Anthropic tariff ceilings |
| `HERMA_CONVERSATION_OPENROUTER_INPUT_USD_PER_MILLION`, `HERMA_CONVERSATION_OPENROUTER_OUTPUT_USD_PER_MILLION` | Required configured OpenRouter tariff ceilings |
| `HERMA_CONVERSATION_PROVIDER_PLAN_ALLOWLIST` | JSON list of permitted provider/model pairs; empty by default |
| `HERMA_CONVERSATION_ALLOW_UNCERTAIN_FAILOVER` | false; requires a matching caller-plan grant too |
| `HERMA_OLLAMA_CALLS_PER_DAY` | 30 shared UTC-day reservations in the Worker |

`<PROVIDER>` is `META`, `OLLAMA`, `OPENAI`, `ANTHROPIC` or `OPENROUTER`. Use the corresponding `META_API_KEY`, `OLLAMA_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY` only in the authorized execution environment. Each credential has a fixed HTTPS destination; redirects are refused. A single-provider turn never silently changes providers. Contributor models are refused. These API keys are independent of harness subscriptions or signed-in application sessions. Claude Code is a harness; its subscription is not an Anthropic API credential.

| Turn provider | Protocol and destination | Generation mapping |
| --- | --- | --- |
| `meta` (Muse) | Chat Completions, `https://api.meta.ai/v1/chat/completions` | Explicit allowance becomes `max_tokens`; optional `reasoning_effort` |
| `ollama` (Cloud) | Native chat, `https://ollama.com/api/chat` | Explicit allowance becomes `options.num_predict`; native options and `think` survive |
| `openai` | Responses, `https://api.openai.com/v1/responses` | Explicit allowance becomes `max_output_tokens`; optional `reasoning` settings |
| `anthropic` | Messages, `https://api.anthropic.com/v1/messages` | Explicit allowance becomes `max_tokens`; native `thinking` and `output_config` survive |
| `openrouter` | Chat Completions, `https://openrouter.ai/api/v1/chat/completions` | Explicit allowance becomes `max_tokens`; underlying provider pinned with gateway fallbacks disabled |

OpenAI requires an explicitly priced model and operator allowance before spending. Responses function tools use the flat tool schema and parse completed `function_call` output items. `strict:false` preserves the existing portable contract's optional fields; Herma still validates every proposed payload locally. Responses storage and background execution are disabled. See the official [function calling guide](https://developers.openai.com/api/docs/guides/function-calling) and [Responses reference](https://developers.openai.com/api/reference/python/resources/responses/methods/create), checked October 29, 2026. OpenAI-compatible Chat Completions servers are not assumed to implement Responses.

Anthropic uses `x-api-key` plus `anthropic-version`, a top-level system prompt, `input_schema` tools and native `tool_use` responses. Configure reasoning through native generation JSON; the shared reasoning-effort setting does not apply to Anthropic or Ollama. API version 2026-10-21 rejects legacy sampling parameters, so choose the provider-supported settings or explicitly select the older version when needed. See [Messages](https://platform.claude.com/docs/en/api/typescript/messages/create) and [API version migration](https://platform.claude.com/docs/en/api/migration-2026-10-21), checked October 29, 2026.

OpenRouter uses its own key and a fixed gateway origin. Herma sets `provider.only` and `provider.order` to the one configured underlying provider, `allow_fallbacks:false`, `require_parameters:true` and `data_collection:deny`. Provider/model routing, presets, plugins and provider-side tool activation cannot be injected through generation settings. `openrouter/*` automatic models, `@preset` model syntax and `:online` variants are rejected for this proposal-only capability. Requested routing and any reported provider/model are recorded separately. Review [provider selection](https://openrouter.ai/docs/guides/routing/provider-selection), [presets](https://openrouter.ai/docs/guides/features/presets) and [web search activation](https://openrouter.ai/docs/guides/features/plugins/web-search) before extending these boundaries.

Generation JSON cannot replace the model, inputs, tools, storage controls or output allowance. Configure the allowance separately so the exact submitted bound and pre-call reservation agree. Other native settings survive without a forced temperature or reasoning effort. For example, Ollama generation JSON can contain `{"think":true,"options":{"num_ctx":524288,"temperature":0.4}}`; that does not change `num_predict`. A configured 300,000-token allowance remains 300,000, subject to the selected provider/model's actual support. There is no hidden 2,048-token reservation or implicit 200,000-token hourly cutoff. Configure a smaller explicit allowance when the task needs one, or a verified provider capacity when it needs the full model range.

The output allowance is required only for this operator-funded server exception. Missing configuration returns `output_allowance_required` before inference. Deployments upgrading from the old implicit default must configure the provider allowances deliberately or leave the conversation flag disabled. Model request bodies remain limited to 32 KiB and parsed responses to 1 MiB to bound request handling; these are transport protections, not generation settings. Requests time out and each caller has 60 server conversation turns per hour. Meta and OpenAI reservations also share separate durable global dollar ceilings across callers. Meta prices use the standard Spark and Wonder tariffs in the [Meta pricing documentation](https://dev.meta.ai/docs/pricing-rate-limits); review those rates and OpenAI's configured tariff before changing models. These server spending controls do not limit Tessera worker claims or caller-funded proxy output.

Reservations are not invoices. Responses retain reported token usage, or null if absent, while cost stays null with a reason. Uncertain calls are not refunded automatically. Starting another conversation cannot reset a caller's hourly quota or the global provider ceiling.

The existing turn record persists `server_exception` before inference: the caller-requested interactive purpose, why that server capability was selected, authenticated principal, caller/conversation/context scope, proposal-only effect, operator payer, destination, exact output allowance, reservation, timeout and retry policy. This private `propose_typed_action` verb uses the existing Herma turn lifecycle; its inputs and receipt are nouns. It does not create another queue or grant authority to execute the proposed domain action. Private workers holding scoped Tessera verbs remain the preferred way to perform planning, research, generation and review. Empty queues, unavailable workers, malformed data and missing review capacity do not invoke this endpoint automatically.

## Explicit private provider plans

To permit rotation, create a caller-owned `kind:noun` context entry through the existing `configure` scope. Its entire policy is under `schema_or_body.provider_plan`:

```json
{
  "caller_scope": "key:your_authenticated_key_id",
  "purpose": "caller_requested_typed_proposal",
  "payer": "operator",
  "context_refs": ["work.observation"],
  "providers": [
    {"provider": "meta", "model": "muse-spark-1.3"},
    {"provider": "ollama", "model": "muse-spark-open"}
  ],
  "allow_failover": true,
  "allow_uncertain_outcome": false
}
```

Set `HERMA_CONVERSATION_PROVIDER_PLAN_ALLOWLIST` to the permitted provider/model objects separately. Both grants must agree. An OpenRouter choice additionally requires `routing_provider` matching its configured underlying provider in both lists. The turn must name `provider_plan_ref`, include that ref in `context_refs`, and select the plan's first `provider`. Its other context refs must exactly match the plan. The plan noun itself is not sent as a model instruction or work contract. Its version/content participates in the conversation fingerprint; changing it requires a new conversation. Shared built-ins cannot stand in for the caller-owned plan. Each provider can appear once, with its configured model, making every rotation finite.

Selection is deterministic. Missing configuration and known provider rejection may advance only along the authorized order. A 429 or unavailable provider records a caller-scoped cooldown using `Retry-After`, or 30 seconds when absent; no tight retry loop runs. Other callers' cooldowns and attempts are private. Unknown provider outcomes retain their full reservation and stop by default. Advancing after an unknown outcome requires both `allow_uncertain_outcome:true` and the operator flag; each additional attempt reserves its own allowance. Storage failure, failed coordination, exhausted caller allowance and lost turn fences stop the turn rather than causing paid fallback. A confirmed provider-budget denial releases the caller tokens reserved for that unissued attempt; unknown reservation outcomes are not refunded.

Each attempt is persisted before dispatch and retains its requested provider/model, destination, optional gateway provider, payer, output allowance, reservation, outcome, reported usage and reported provider/model when available. Unknown usage stays null. The same private turn receipt includes deterministic authorization/validation actions with `model:null` and a reason, linked to the model attempt where applicable. `GET /v1/conversations/{id}` exposes recent attempts only to the authenticated owner. Exact request replay returns the original receipt and does not repeat paid calls. The Worker keeps the existing two-minute turn recovery boundary; individual dispatches receive at most 25 seconds and cannot run past that turn boundary. Python uses its configured per-attempt timeout and retains uncertain state for operator reconciliation.

An attempt also retains `upstream_http_status` when observed. Non-200 responses have `provider_diagnostics` with fixed, recognized error type/code/parameter values and a normalized reason such as `unsupported_parameter`, `model_unavailable`, `credit_or_quota_exhausted` or `unknown`. Parsing retains at most 16 KiB of error-body bytes; oversized, malformed, unreadable and unrecognized bodies remain classified as unknown. Raw messages, nested provider metadata, headers, request/account identifiers and echoed input or credentials are never copied into these diagnostics. Python requests uncompressed responses and skips diagnostic parsing of encoded error bodies. These fields describe provider-reported evidence, not an independently established root cause. They do not authorize retry, refund, failover or additional spending. A failed error-body read preserves the known HTTP status and existing outcome policy.

The allowlisted classification follows the official [OpenAI error guidance](https://developers.openai.com/api/docs/guides/error-codes), [Anthropic error shape](https://platform.claude.com/docs/en/api/errors) and [OpenRouter error shape](https://openrouter.ai/docs/api_reference/errors-and-debugging), checked October 29, 2026. Provider messages and codes can change; unfamiliar errors retain their HTTP status with an unknown reason.

The attempt records cover this explicit capability, not every existing call site in the repository. Optional micromodel/embedding routing and the legacy agent demo remain separate exception-audit and migration work. Offline protocol tests are not live-provider qualification.

The Worker reports `reservation_status` as pending, reserved or denied, separately from the planned `reservation_ceiling_usd`. A denied provider budget returns 429 with a stored blocked receipt; its exact replay also returns 429. `GET /v1/admin/conversation-budget` requires the existing admin credential and shows aggregate reserved dollars and daily call counts without tokens or transcripts. Increasing the budget variable changes the cumulative ceiling; a deployment does not reset the ledger. Python experiment databases and the deployed Worker have separate ledgers, so the operator must reconcile both against the account-wide ceiling.

Deploy with the repository's pinned Wrangler after `npm ci --ignore-scripts` and `make check`. The additive `work-conversation-v1` migration creates `WorkConversation` and `WorkReasoningBudget`; D1 context/auth tables remain authoritative. Set provider keys with Wrangler secrets, then enable the flag. To stop new model turns, disable the flag and retain the DO bindings/classes and budget ledger. Roll forward with the disabled flag for an emergency rollback; do not remove stateful classes or reset their namespace. The public MCP tools stay deterministic; paid conversations are reached through the authenticated HTTP route.

Recovery proceeds one step at a time: clarify required fields, narrow the task, choose fewer context entries, then adjust an operator-owned reasoning/output profile or provider. Explicit function schemas are used because [Ollama Cloud does not currently support structured outputs](https://docs.ollama.com/capabilities/structured-outputs). Keep the original failure and controls when evaluating a repair. A successful proposal is evidence of schema conformance, not evidence that a real task completed.

## Worker-owned providers

The ordinary Herma shim accepts caller-funded `/v1/chat/completions`, `/v1/responses` and `/v1/messages` requests. Set `X-Upstream-Base-Url` or `X-Herma-Upstream-Url` explicitly and provide that destination's `X-Upstream-Api-Key`. The selected wire protocol must exist at the chosen service. Herma passes generation fields through, including an omitted output limit; it does not inject the server conversation allowance. An operator credential is bound to its configured origin and is never borrowed for an alternate provider.

| Worker resource | Herma route | Explicit upstream base |
| --- | --- | --- |
| OpenAI Responses model | `/v1/responses` | `https://api.openai.com` |
| Muse Chat Completions | `/v1/chat/completions` | `https://api.meta.ai` |
| Ollama Cloud compatibility endpoint | `/v1/chat/completions` | `https://ollama.com` |
| Local Ollama compatibility endpoint | `/v1/chat/completions` | `http://localhost:11434` |
| Other local compatible server | Its supported protocol route | Its explicit operator-allowlisted endpoint |

Localhost means the machine running Herma. Run the Python shim beside a local harness/model; a deployed Cloudflare Worker cannot use the caller's localhost. Default allowlisting includes localhost and 127.0.0.1. Additional hosts require `HERMA_ALLOWED_UPSTREAM_HOSTS`. Keep unrelated provider credentials out of the worker environment, and do not place keys in nouns, verb briefs or receipts. Native Ollama `/api/chat` is available to a worker directly; the ordinary shim's compatible route is `/v1/chat/completions`.

The project surface organizes these integration capabilities. Nouns remain versioned input/context/evidence, verbs remain claimable work, and Tessera's existing storage/task contracts own their lifecycle. Provider selection changes a worker's permitted execution resources; it does not create a new reasoning authority.

## Jev typed decisions

`herma.decision_provider` is a pure worker adapter for TypeSafe's native `POST https://api.typesafe.ai/v1/systemone` protocol. It prepares explicit `model`, `state` and typed Choice/Score/Noul questions, and validates the returned question IDs, probability bounds and normalization, chosen maximum, score mean and legend. A small floating-point tolerance of 1e-6 permits numeric serialization noise. Preparation records the authenticated caller scope, owning verb, input noun refs, requested provider/model, worker payer and a stable attempt ID. It performs no network, enqueue, installation or activation work. Response validation identifies worker-reported evidence and never claims independent transport verification.

The owning authorized worker is responsible for its current lease, data/effect permissions, request allowance, persisting the attempt noun before dispatch, resolving `TYPESAFE_API_KEY` only for the fixed origin, and recording the actual HTTP outcome. Jev produces decisions rather than arbitrary generated tool arguments; it cannot be selected in the generative provider plan. No server Jev route, live qualification or available credit is implied. See the official [quick start](https://docs.typesafe.ai/introduction/quickstart), [Choice](https://docs.typesafe.ai/primitives/choice) and [Score](https://docs.typesafe.ai/primitives/score), checked October 29, 2026.
