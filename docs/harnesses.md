# Connecting Configurable Agentic Coding Harnesses

Herma accepts model routing and configuration from coding harnesses and personal assistants with scoped `hmk_` credentials. Public deterministic previews require no key. Matched requests either receive shimmed rule, URI, and `[NOUN/VERB CONTEXT]` entries from Herma's database or receive a zero-token direct response (`action: "respond_directly"`).

## 1. Issue a Key

```bash
uv run herma keys issue --label workstation --harness opencode --scopes route,configure
```

Save the printed `hmk_<id>.<secret>` token in a `0600` secret file.

This CLI issues a key in the selected local database. It does not provision the
hosted Worker. For hosted access an operator issues a scoped key through the
authenticated `/v1/admin/keys` route. A Tessera `tsk_` or `tan_` credential does
not substitute for a Herma harness key. Client labels do not create authority.

## 2. OpenCode / OpenAI-Compatible Harnesses (`/v1/chat/completions`)

Point your provider `baseURL` at `https://herma.ta-amps.workers.dev/v1` (or `http://127.0.0.1:7730/v1` locally) and attach:
- `X-Herma-Key: hmk_<id>.<secret>`
- `X-Herma-Harness: opencode`
- `X-Upstream-Api-Key: <your-upstream-llm-key>` (or set `HERMA_UPSTREAM_API_KEY` on the Herma origin; direct-response rules answer without an upstream key)

For an explicitly selected Meta provider, set `X-Upstream-Base-Url` to
`https://api.meta.ai/v1` with a caller-owned upstream key. The allowed hostname
does not let the request borrow an operator credential configured for another
origin. In Workers the generic proxy uses `UPSTREAM_LLM_URL` and
`UPSTREAM_LLM_API_KEY`; the paid conversation API uses separate provider secrets,
`META_API_KEY` first. These are different configuration paths.

## 3. Muse Code / Responses-Compatible Harnesses (`/v1/responses`)

Point the Responses endpoint at `https://herma.ta-amps.workers.dev/v1/responses` with `X-Herma-Harness: muse-code` and `--contributor-mode off`. Herma shims matched provisions + noun/verb context into `instructions` or returns a direct `response` object.

This describes the Responses wire adapter, not a full native provider-host
replacement. Native Muse startup also requests `/muse-code/models`; a client that
sets only a global base URL may fail before inference. The recorded native Muse
fixture used Meta's provider path with a separate typed MCP connector. Full native
Muse startup through Herma's generic proxy is not certified. Preserve ordinary
client approvals and sandboxing; inspect actual native tool events.

## 4. Claude Code (`/v1/messages`)

Set `ANTHROPIC_BASE_URL=https://herma.ta-amps.workers.dev` and pass `X-Herma-Key` + `X-Herma-Harness: claude-code` via custom headers. Herma shims matched provisions + noun/verb context into the top-level `system` prompt or returns a direct Anthropic `message` object.

## Credential and client requirements

Personal assistants that support tool or MCP connections can use the open preview. Private routing and configuration require `X-Herma-Key` and a matching `X-Herma-Harness` declaration; client names and user-agent strings are not authorization.

See [the experiment matrix](design-and-evidence.md) for the distinction between
HTTP tests, native fixtures and pending full-loop tests, and the
[bilateral troubleshooting guide](agent-troubleshooting.md) for recovery steps.
