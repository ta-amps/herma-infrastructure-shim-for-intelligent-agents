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

Generation JSON cannot replace the model, inputs, tools, storage controls or output allowance. Configure the allowance separately so the exact submitted bound and pre-call reservation agree. Supported native settings survive without a forced temperature or reasoning effort. For example, Ollama generation JSON can contain `{"think":true,"options":{"num_ctx":524288,"temperature":0.4}}`; that does not change `num_predict`. A configured 300,000-token allowance remains 300,000, subject to the selected provider/model's actual support. There is no hidden 2,048-token reservation or implicit 200,000-token hourly cutoff. Configure a smaller explicit allowance when the task needs one, or a verified provider capacity when it needs the full model range.

This managed capability reserves and parses one proposal. `n` may only be the integer `1` for Muse/OpenRouter Chat Completions; multiple outputs and `best_of` require accounting/parser support that this profile does not have. Opaque `prompt`/`prompt_id` references are unsupported because their expanded context is outside the locally scoped input and reservation. Generation overrides for `speed` and `inference_geo` are also unsupported. These settings return `unsupported_generation_configuration` before provider allowance is reserved; an explicit provider plan may advance only to another permitted, independently funded choice.

OpenAI requests explicitly set `service_tier:default`; Anthropic requests set `service_tier:standard_only`, including when generation JSON omits the field. Other tier values are rejected because there is no tier-aware tariff contract here. OpenAI documents that omission selects `auto`, which can inherit project settings, while `default` selects standard pricing. Anthropic documents `standard_only` for standard capacity and service-tier availability across models. These are documented protocol choices, not new live qualification of every model or both configured Anthropic API versions. Operators must still verify their selected model/version and tariff ceiling. See [OpenAI Responses](https://developers.openai.com/api/reference/python/resources/responses/methods/create), [Anthropic service tiers](https://platform.claude.com/docs/en/api/service-tiers) and [Messages speed/region options](https://platform.claude.com/docs/en/api/go/messages/create), checked October 29, 2026. The ordinary caller-funded proxy retains its native generation settings.

The output allowance is required only for this operator-funded server exception. Missing configuration returns `output_allowance_required` before inference. Deployments upgrading from the old implicit default must configure the provider allowances deliberately or leave the conversation flag disabled. Model request bodies remain limited to 32 KiB and parsed responses to 1 MiB to bound request handling; these are transport protections, not generation settings. Requests time out and each caller has 60 server conversation turns per hour. Meta and OpenAI reservations also share separate durable global dollar ceilings across callers. Meta prices use the standard Spark and Wonder tariffs in the [Meta pricing documentation](https://dev.meta.ai/docs/pricing-rate-limits); review those rates and OpenAI's configured tariff before changing models. These server spending controls do not limit Tessera worker claims or caller-funded proxy output.

Reservations are not invoices. Responses retain reported token usage, or null if absent, while cost stays null with a reason. Uncertain calls are not refunded automatically. Starting another conversation cannot reset a caller's hourly quota or the global provider ceiling.

The selected operator credential is checked before reserving provider or caller tokens. A missing key records a `provider_not_configured`, `not_sent`, `not_reserved` attempt with zero reserved tokens; it cannot borrow another provider's key. Pure request construction and reservation estimation remain available offline without credentials. An explicitly permitted fallback can use its own allowance after this known skip.

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

Selection is deterministic. Missing configuration and known provider rejection may advance only along the authorized order. Provider limits use shared operator provider/account/model health in the existing allowance coordinator, so a different caller cannot repeat a request while that resource is known to be limited. Unknown provider outcomes retain their full reservation and stop by default. Advancing after an unknown outcome requires both `allow_uncertain_outcome:true` and the operator flag; each additional attempt reserves its own allowance. Caller/global budget exhaustion, scope failure, failed storage/coordination and lost turn fences stop. A known per-provider budget denial may advance only to another explicitly permitted, independently budgeted provider. A confirmed denial releases the caller tokens held for that unissued attempt; unknown or malformed reservation outcomes are not refunded.

An unexpected non-200 success response, including HTTP 202, is `provider_outcome_uncertain` with `outcome:unknown`, rather than a known rejection. OpenAI HTTP 200 bodies explicitly marked `queued` or `in_progress` have the same treatment. Their reservations remain held and shared health remains uncertain; further failover requires both existing uncertainty grants. Herma does not poll a job URL, repeat the request or follow a response location. Completed responses with invalid typed proposals remain completed model attempts. HTTP 202 alone establishes acceptance for processing, not completion; see [RFC 9110 section 15.3.3](https://www.rfc-editor.org/rfc/rfc9110.html#name-202-accepted).

Each attempt is persisted before dispatch and retains its requested provider/model, destination, optional gateway provider, payer, output allowance, reservation, outcome, reported usage and reported provider/model when available. Unknown usage stays null. The same private turn receipt includes deterministic authorization/validation actions with `model:null` and a reason, linked to the model attempt where applicable. `GET /v1/conversations/{id}` exposes recent attempts only to the authenticated owner. Exact request replay returns the original receipt and does not repeat paid calls. The Worker keeps the existing two-minute turn recovery boundary; individual dispatches receive at most 25 seconds and cannot run past that turn boundary. Python uses its configured per-attempt timeout and retains uncertain state for operator reconciliation.

An attempt also retains `upstream_http_status` when observed. Non-200 responses have `provider_diagnostics` with fixed, recognized error type/code/parameter values and a normalized reason such as `unsupported_parameter`, `model_unavailable`, `credit_or_quota_exhausted` or `unknown`. Parsing retains at most 16 KiB of error-body bytes; oversized, malformed, unreadable and unrecognized bodies remain classified as unknown. Raw messages, nested provider metadata, headers, request/account identifiers and echoed input or credentials are never copied into these diagnostics. Python requests uncompressed responses and skips diagnostic parsing of encoded error bodies. These fields describe provider-reported evidence, not an independently established root cause. They do not authorize retry, refund, failover or additional spending. A failed error-body read preserves the known HTTP status and existing outcome policy.

The allowlisted classification follows the official [OpenAI error guidance](https://developers.openai.com/api/docs/guides/error-codes), [Anthropic error shape](https://platform.claude.com/docs/en/api/errors) and [OpenRouter error shape](https://openrouter.ai/docs/api_reference/errors-and-debugging), checked October 29, 2026. Provider messages and codes can change; unfamiliar errors retain their HTTP status with an unknown reason.

The attempt records cover this explicit capability, not every existing call site in the repository. Optional micromodel/embedding routing and the legacy agent demo remain separate exception-audit and migration work. Offline protocol tests are not live-provider qualification.

## Operator availability and automatic backpressure

`HERMA_CONVERSATION_DISABLED_PROVIDERS` is a JSON list of operator-funded providers to pause. It governs managed typed conversations and ordinary proxy forwarding when the proxy actually selects an operator-supplied upstream key for a recognized provider host. The checked deployment settings currently use `["anthropic","openrouter"]`; keys, adapters and allowances remain intact. Use `[]` to clear the operator override after checking account readiness. This flag does not disable worker-funded/BYO proxy routes, delete credentials or clear automatic health state and retained reservations. A disabled conversation choice produces a recorded `provider_operator_disabled` skip, with no model request. An explicitly authorized plan may continue to another enabled choice.

The ordinary Python proxy's fallback key is `HERMA_UPSTREAM_API_KEY`; the Worker's is `UPSTREAM_LLM_API_KEY`. An explicit caller `X-Upstream-Api-Key` still wins and does not consult operator availability settings. When an operator key is selected, the existing configured-origin binding still applies, then exact parsed hosts `api.meta.ai`, `ollama.com`, `api.openai.com`, `api.anthropic.com` and `openrouter.ai` map to the corresponding pause. Hostname substrings and custom gateway identities are not guessed. A paused operator fallback returns `provider_operator_disabled` before forwarding. Automatic shared cooldown, probes and paid rotation remain confined to managed typed conversations; they are not added to the ordinary proxy. Optional embedding/micromodel routes and legacy demos retain their separate configuration and unresolved exception-audit work.

`HERMA_CONVERSATION_<PROVIDER>_ACCOUNT_SCOPE` is an optional opaque operator account alias, defaulting to `operator`. Use the same alias for credentials sharing an account limit. It stays stable when a key changes; no automatic key rotation occurs. Only configure a different alias for a genuinely independent authorized account, never to evade a limit. Ordinary callers cannot set this scope. Health is keyed by provider, account alias and model; diagnosed credit exhaustion or HTTP 402 payment requirements also block the account across models. Request/model incompatibility alone does not disable unrelated providers or models. Python shares health within its existing database; Worker callers share it in the existing `WorkReasoningBudget` object. Separate deployments/databases require operator coordination and do not magically share a ledger.

HTTP 429, diagnosed rate limits, timeout/unknown outcomes and provider unavailability open a temporary cooldown. The coordinator follows valid `Retry-After` seconds/date guidance, otherwise known OpenAI duration reset headers or Anthropic timestamp reset headers. Only normalized seconds and a fixed source label are retained. Without usable guidance it uses increasing backoff: 30 seconds initially, or 300 seconds for credit/payment conditions, doubling after repeated unsuccessful recovery up to one hour. These are recovery delays after observed failures, not fixed throughput caps on healthy providers. See the current [OpenAI rate-limit headers](https://developers.openai.com/api/docs/guides/rate-limits) and [Anthropic rate-limit headers](https://platform.claude.com/docs/en/api/rate-limits), checked October 29, 2026.

After an ordinary known cooldown, the next fresh request already authorized for that provider/model/payer may become the single recovery probe within its existing allowance. This works for existing single-provider requests and provider plans without a new opt-in. A plan can explicitly set `allow_recovery_probe:false` to pause recovery. The coordinator atomically admits at most one probe for a limited resource together with its allowance, including one account-wide probe across models after credit failure. Its persisted lease lasts 120 seconds. Competing requests receive a recorded skip with the reason and next eligible time; only an existing explicit plan may choose another provider. No background probe, automatic replay of the failed turn, sleep loop or extra spending grant is created.

An expired or disconnected probe becomes an uncertain outcome on the next admission check. Its reservation remains held, and further recovery needs the existing caller `allow_uncertain_outcome:true` plus operator `HERMA_CONVERSATION_ALLOW_UNCERTAIN_FAILOVER=true` grants. A stale successful call cannot clear a newer limit. Operator shutdown wins over recovery permissions, and clearing shutdown preserves health. Attempt receipts expose only that caller's actions and safe availability categories; they never include another caller's attempt identity, transcript, provider message or credentials. The existing admin budget summary additionally exposes shared resource health and operator-disabled choices. No public health-reset endpoint exists.

This availability state is a private management noun associated with existing reservations and turn receipts. Its updates are deterministic infrastructure inside the existing lifecycle, not a new reasoning service, queue or policy authority. The additive database fields belong to the existing coordinator. For rollback, stop new conversations and roll forward with the disabled flag; do not run older writers against the expanded tables or erase health/budget state.

Attempt receipts distinguish `not_reserved`, `pending`, `reserved` and `denied` from planned `reservation_ceiling_tokens`/`reservation_ceiling_usd`. A known caller-budget denial reports zero reserved attempt tokens. In the Worker, the attempt becomes `pending` after caller tokens are held and before the shared allowance RPC; an unavailable or malformed RPC reply preserves that pending evidence and held tokens, without claiming no reservation occurred. A confirmed provider-budget denial releases only the known-unissued attempt's caller tokens. A denied provider budget returns 429 with a stored blocked receipt; its exact replay also returns 429. `GET /v1/admin/conversation-budget` requires the existing admin credential and shows aggregate reserved dollars and daily call counts without tokens or transcripts. Increasing the budget variable changes the cumulative ceiling; a deployment does not reset the ledger. Python experiment databases and the deployed Worker have separate ledgers, so the operator must reconcile both against the account-wide ceiling.

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
