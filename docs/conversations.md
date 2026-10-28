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
| `HERMA_CONVERSATION_MAX_OUTPUT` | 2048, bounded to 512 through 8192 |
| `HERMA_CONVERSATION_REASONING` | `low` for Meta |
| `HERMA_META_BUDGET_USD` | 5 cumulative reserved dollars, maximum 150 |
| `HERMA_OLLAMA_CALLS_PER_DAY` | 30 shared UTC-day reservations in the Worker |

Use `META_API_KEY` and `OLLAMA_API_KEY` only in the server secret store. Their destinations are fixed to the provider's HTTPS host; redirects are refused. Contributor models are refused. Model bodies are capped at 32 KiB, responses at 1 MiB, and requests time out. Each caller is limited to 60 turns and 200,000 conservatively reserved tokens per hour. Meta reservations also share a durable global ceiling across callers. The price ceiling uses the standard Spark and Wonder tariffs in the [Meta pricing documentation](https://dev.meta.ai/docs/pricing-rate-limits); review those rates before changing models.

Reservations are not invoices. Responses retain reported token usage, or null if absent, while cost stays null with a reason. Uncertain calls are not refunded automatically. Starting another conversation cannot reset a caller's hourly quota or the global provider ceiling.

The Worker reports `reservation_status` as pending, reserved or denied, separately from the planned `reservation_ceiling_usd`. A denied provider budget returns 429 with a stored blocked receipt; its exact replay also returns 429. `GET /v1/admin/conversation-budget` requires the existing admin credential and shows aggregate reserved dollars and daily call counts without tokens or transcripts. Increasing the budget variable changes the cumulative ceiling; a deployment does not reset the ledger. Python experiment databases and the deployed Worker have separate ledgers, so the operator must reconcile both against the account-wide ceiling.

Deploy with the repository's pinned Wrangler after `npm ci --ignore-scripts` and `make check`. The additive `work-conversation-v1` migration creates `WorkConversation` and `WorkReasoningBudget`; D1 context/auth tables remain authoritative. Set provider keys with Wrangler secrets, then enable the flag. To stop new model turns, disable the flag and retain the DO bindings/classes and budget ledger. Roll forward with the disabled flag for an emergency rollback; do not remove stateful classes or reset their namespace. The public MCP tools stay deterministic; paid conversations are reached through the authenticated HTTP route.

Recovery proceeds one step at a time: clarify required fields, narrow the task, choose fewer context entries, then adjust an operator-owned reasoning/output profile or provider. Explicit function schemas are used because [Ollama Cloud does not currently support structured outputs](https://docs.ollama.com/capabilities/structured-outputs). Keep the original failure and controls when evaluating a repair. A successful proposal is evidence of schema conformance, not evidence that a real task completed.
