# Connecting Configurable Agentic Coding Harnesses

Herma accepts requests **only** from configurable agentic coding harnesses that support custom provider endpoints, custom headers, and scoped `hmk_` credentials. Matched requests either receive shimmed rule, URI, and `[NOUN/VERB CONTEXT]` entries from Herma's database or receive a zero-token direct response (`action: "respond_directly"`).

## 1. Issue a Key

```bash
uv run herma keys issue --label workstation --harness opencode --scopes route,configure
```

Save the printed `hmk_<id>.<secret>` token in a `0600` secret file.

## 2. OpenCode / OpenAI-Compatible Harnesses (`/v1/chat/completions`)

Point your provider `baseURL` at `https://herma.ta-amps.workers.dev/v1` (or `http://127.0.0.1:7730/v1` locally) and attach:
- `X-Herma-Key: hmk_<id>.<secret>`
- `X-Herma-Harness: opencode`
- `X-Upstream-Api-Key: <your-upstream-llm-key>` (or set `HERMA_UPSTREAM_API_KEY` on the Herma origin; direct-response rules answer without an upstream key)

## 3. Muse Code / Responses-Compatible Harnesses (`/v1/responses`)

Point the Responses endpoint at `https://herma.ta-amps.workers.dev/v1/responses` with `X-Herma-Harness: muse-code` and `--contributor-mode off`. Herma shims matched provisions + noun/verb context into `instructions` or returns a direct `response` object.

## 4. Claude Code (`/v1/messages`)

Set `ANTHROPIC_BASE_URL=https://herma.ta-amps.workers.dev` and pass `X-Herma-Key` + `X-Herma-Harness: claude-code` via custom headers. Herma shims matched provisions + noun/verb context into the top-level `system` prompt or returns a direct Anthropic `message` object.

## Why Generic Consumer Assistants Cannot Access Herma

Locked consumer chat apps (such as a generic **Muse Personal Assistant** session on web/mobile) cannot set custom proxy base URLs, cannot attach `X-Herma-Key` / `X-Herma-Harness` headers, and are explicitly blocked by `herma/harness_gate.py` (`HTTP 403 harness_required`).
