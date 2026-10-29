# External agent access

Herma accepts public MCP discovery and deterministic previews at `/mcp` with no secret. Coding harnesses and personal assistants use the same public routes. Read `/connect.json` for machine-readable access and limits. Public responses are `persisted:false`.

For tracked noun/verb work, [connect to Tessera](https://tessera.ta-amps.workers.dev/connect). Mint a short-lived anonymous session with `POST /v1/session/anonymous`, then send its returned `tan_` bearer token to Tessera. Writes stay in the session's `demo.<principal>` namespace with immutable demo/untrusted labels. Use the returned quotas and expiry, not assumed values. Existing `tsk_` keys retain scoped authenticated access. Tessera's `/v1/me` and `/v1/me/audit` identify the current principal and its own events.

Public preview endpoints never use operator credentials to publish artifacts. A request with `persist_to_fabric:true` is refused with `403 principal_required_for_persistence`. Save the returned artifact with Tessera's `put_record` tool under your own session or key, observing its namespace, scopes, CAS version and quotas.

```json
{"mcpServers":{"herma":{"url":"https://herma.ta-amps.workers.dev/mcp"}}}
```

Browser agents receive CORS preflight `204` for `/mcp`, `/api/*`, and `/v1/*`. Bearer credentials are explicit headers; cookies are not supported. Requests are limited to 256 KiB, including chunked bodies. `X-Request-Id` is returned, and `ETag`, `Retry-After`, and `X-Request-Id` are exposed to browsers.

Herma's `/api/preview` is an open, nonpersistent, offline preview of builtin rules. Private routing, rules, context, traces, entities and insights require scoped `hmk_` credentials. A Tessera key does not authorize Herma management. Use `X-Herma-Key` (or its bearer equivalent) and `X-Herma-Harness: personal-assistant` for an operator-issued personal-assistant key; the declaration must match that key for configuration. Contributor models remain refused.

`/v1/chat/completions`, `/v1/responses`, and `/v1/messages` reserve an atomic per-key budget of 60 routed requests per UTC hour before any model call. Exhaustion returns `429` with `Retry-After: 3600`; dry runs and previews never call a model. Operator provider keys may only be sent to the configured provider origin, and redirects are not followed. Allowlisted alternate providers require `X-Upstream-Api-Key` supplied by that caller.

Fabric imports require the canonical six-field governance envelope, `status:verified`, an explicit public/Herma-allowlisted visibility and a matching cohort. Local caller-owned rules and builtins are trusted separately. Raw blob hashes and tag-only bucket headers are insufficient authority for inlining; their URIs remain available for separately authenticated retrieval. Governance survives synchronization and is rechecked for rule/context injection.

Telemetry `latency_ms` records shim evaluation time, not upstream latency savings. Existing `tokens_saved_est` values are labeled estimates, not provider usage. Unknown actual token savings and latency deltas must not be described as measured.
