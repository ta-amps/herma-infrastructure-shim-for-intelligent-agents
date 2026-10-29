# Setup, Context Database, Backing Stores & Cloudflare Deployment

> Herma: context-shimming AI middleware for configurable coding harnesses -- intercepts requests via keyword, semantic, or micromodel rules to respond directly or shim atomic noun, verb, and URI context from a user-configured database before LLM execution.

## Local Development

Clone this repository alone. Tessera is installed from the immutable commit
`b1b470475c3ff03db0963bbcf6b271911d79f73e` through a standard PEP 508 Git dependency.
`uv.lock` records the resolution; no local sibling checkout is required.
The installer needs Python 3.12+, Git, uv and network access to the public repository.

```bash
make setup
make check
make demo
uv run herma serve --host 127.0.0.1 --port 7730
```

## Caller-Isolated Atomic Noun, Verb & Detail Database (`/v1/context`)

1. **Populate & Query Caller-Scoped Context Entries (`configure` scope)**:
   - `POST /v1/context` upserts single or batched `ContextEntry` records (`kind`: `"noun"`, `"verb"`, or `"detail"`; `entry_id`, `title`, `summary`, `schema_or_body`, `source_uri`) into `context_entries` partitioned by `caller_scope` (`?expected_version=<n>&check_cas=true` enforces single-statement atomic SQL CAS).
   - `GET /v1/context?kind=noun&prefix=noun:tessera.` returns `system_builtin` + the caller's own entries; non-admin attempts to overwrite `system_builtin` entries return `403 builtin_protected`.
2. **Tessera (`herma.provisions` + Governed Noun/Verb Stores + Verified Blobs)**:
   - Local Python store: `store.publish_to_tessera_store(t_store)` and `store.sync_from_tessera_store(t_store)`.
   - Over HTTP or Cloudflare Service Binding: `POST /v1/sync/tessera` with `{"base_url": "https://tessera.ta-amps.workers.dev", "bearer_token": "..."}`. Content-addressed `tessera://blobs/<sha256>` URIs are verified against `^[0-9a-f]{64}$` and `sha256(bytes)`, and items pass Herma's Layer-1 Governance Lens (`status:quarantined` refused, `visibility_scope` / `allowed_surfaces` / `X-Herma-Cohort` enforced).
3. **Entity Memory, Outcomes & Candidate Insights (`route` scope)**:
   - `GET /v1/memory?project_tag=<tag>` inspects top-of-mind extracted entities (`file_path`, `code_symbol`, `tessera_uri`, `statute_card_id`, `error_signature`).
   - `POST /v1/outcomes` records explicit `accepted` / `retry_error` / `ignored` / `overridden` signals, and `GET /v1/insights` returns telemetry plus reviewable draft `candidate_provisions`.
4. **Remote Handshake Provision & Context Server**:
   - `POST /v1/sync/remote` negotiates version and clamped `max_chars` via `POST /v1/handshake` (passing configurable `surface_header` + `surface_id`) before loading `/v1/provisions` (and optional `context_entries`).

## Deploying on Cloudflare `workers.dev` (24/7 Cloud-Persistent Mode)

`deploy/cloudflare/wrangler.jsonc` runs natively in Cloudflare's cloud (`STORAGE_MODE = "cloud"`) backed by the `ta-amps-herma` D1 database (`HERMA_DB`, auto-migrating composite `caller_scope` primary keys) and a direct `TESSERA` Service Binding (`deploy/cloudflare/d1-herma.sql`), or proxies to an external `ORIGIN` when `STORAGE_MODE = "origin"`:

```bash
npx --yes wrangler@4.149.0 d1 execute ta-amps-herma --remote --file deploy/cloudflare/d1-herma.sql --config deploy/cloudflare/wrangler.jsonc -y
npx --yes wrangler@4.149.0 deploy --config deploy/cloudflare/wrangler.jsonc
npx --yes wrangler@4.149.0 secret put BOOTSTRAP_SECRET --config deploy/cloudflare/wrangler.jsonc < /path/to/bootstrap.secret
```
