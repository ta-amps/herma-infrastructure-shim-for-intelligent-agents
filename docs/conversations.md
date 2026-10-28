# Typed work conversations

`POST /v1/conversations/turn` provides optional model-assisted clarification and next-action proposals. It requires the same scoped `hmk_` route credential as interception and is disabled unless `HERMA_CONVERSATION_ENABLED=true`. Public preview remains deterministic. The Python implementation is available for local evaluation; Worker parity is pending.

Configure context entries through the existing `configure` scope. An entry's `schema_or_body.work_contract` contains an `operation_id`, a canonical Tessera `category_id`, a short `description`, and a JSON object `input_schema` with explicit field types. References and unconstrained property schemas are rejected. Each operation becomes its own function tool. Category membership does not itself certify artifact quality.

Example request, using a context entry already visible to the authenticated caller:

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

Use the returned version as `expected_version` on the next turn. Repeating an identical request ID returns its stored response without another model call. Reusing that ID for different input returns 409. An active turn or changed contract also returns 409. `GET /v1/conversations/{id}` shows only the current caller's transcript and active request. Conversations stop accepting turns after 24 hours; stored transcripts are not automatically deleted. A process crash may leave a reservation pending: an operator must reconcile it instead of blindly repeating a paid call.

Provider configuration is operator-owned:

| Setting | Default |
| --- | --- |
| `HERMA_CONVERSATION_ENABLED` | disabled |
| `HERMA_CONVERSATION_META_MODEL` | `muse-spark-1.3` |
| `HERMA_CONVERSATION_OLLAMA_MODEL` | `muse-spark-open` |
| `HERMA_CONVERSATION_MAX_OUTPUT` | 2048, bounded to 512 through 8192 |
| `HERMA_CONVERSATION_REASONING` | `low` for Meta |
| `HERMA_META_BUDGET_USD` | 5 cumulative reserved dollars, maximum 150 |

Use `META_API_KEY` and `OLLAMA_API_KEY` only in the server secret store. Their destinations are fixed to the provider's HTTPS host; redirects are refused. Contributor models are refused. Model bodies are capped at 32 KiB, responses at 1 MiB, and requests time out. Each caller is limited to 60 turns and 200,000 conservatively reserved tokens per hour. Meta reservations also share a durable global ceiling across callers. The price ceiling uses the standard Spark and Wonder tariffs in the [Meta pricing documentation](https://dev.meta.ai/docs/pricing-rate-limits); review those rates before changing models.

Reservations are not invoices. Responses retain reported token usage, or null if absent, while cost stays null with a reason. Uncertain calls are not refunded automatically. Starting another conversation cannot reset a caller's hourly quota or the global provider ceiling.

Recovery proceeds one step at a time: clarify required fields, narrow the task, choose fewer context entries, then adjust an operator-owned reasoning/output profile or provider. Explicit function schemas are used because [Ollama Cloud does not currently support structured outputs](https://docs.ollama.com/capabilities/structured-outputs). Keep the original failure and controls when evaluating a repair. A successful proposal is evidence of schema conformance, not evidence that a real task completed.
