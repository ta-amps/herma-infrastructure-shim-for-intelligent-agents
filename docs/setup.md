# Setup, Context Database, Backing Stores & Cloudflare Deployment

> Herma: context-shimming AI middleware for configurable coding harnesses — intercepts requests via keyword, semantic, or micromodel rules to respond directly or shim atomic noun, verb, and URI context from a user-configured database before LLM execution.

## Local Development

```bash
make setup
make check
make demo
uv run herma serve --host 127.0.0.1 --port 7730
```

## User-Configured Atomic Noun, Verb & Detail Database (`/v1/context`)

1. **Populate & Query Context Entries (`configure` scope)**:
   - `POST /v1/context` upserts single or batched `ContextEntry` records (`kind`: `"noun"`, `"verb"`, or `"detail"`; `entry_id`, `title`, `summary`, `schema_or_body`, `source_uri`) into `context_entries`.
   - `GET /v1/context?kind=noun&prefix=noun:tessera.` lists stored entries; provisions reference them via `context_refs` (`["noun:tessera.lease_fence", "verb:tessera.claim"]`) to shim a bounded `[NOUN/VERB CONTEXT]` block or enrich `action: "respond_directly"` answers.
2. **Tessera (`herma.provisions` + Noun/Verb Stores + Buckets)**:
   - Local Python store: `store.publish_to_tessera_store(t_store)` and `store.sync_from_tessera_store(t_store)`.
   - Over HTTP or Cloudflare Service Binding: `POST /v1/sync/tessera` with `{"base_url": "https://tessera.ta-amps.workers.dev", "bearer_token": "..."}`. Content-addressed `tessera://blobs/<sha256>` URIs, `tessera://buckets/<bucket>/<key>` objects, and `noun:<store>/<key>` / `verb:<store>/<key>` `context_refs` resolve automatically.
3. **Remote Handshake Provision & Context Server**:
   - `POST /v1/sync/remote` negotiates version and clamped `max_chars` via `POST /v1/handshake` (passing configurable `surface_header` + `surface_id`) before loading `/v1/provisions` (and optional `context_entries`).

## Deploying on Cloudflare `workers.dev` (24/7 Cloud-Persistent Mode)

`deploy/cloudflare/wrangler.jsonc` runs natively in Cloudflare's cloud (`STORAGE_MODE = "cloud"`) backed by the `ta-amps-herma` D1 database (`HERMA_DB`, auto-ensuring `context_entries`) and a direct `TESSERA` Service Binding (`deploy/cloudflare/d1-herma.sql`), or proxies to an external `ORIGIN` when `STORAGE_MODE = "origin"`:

```bash
npx --yes wrangler@4.149.0 d1 execute ta-amps-herma --remote --file deploy/cloudflare/d1-herma.sql --config deploy/cloudflare/wrangler.jsonc -y
npx --yes wrangler@4.149.0 deploy --config deploy/cloudflare/wrangler.jsonc
npx --yes wrangler@4.149.0 secret put BOOTSTRAP_SECRET --config deploy/cloudflare/wrangler.jsonc < /path/to/bootstrap.secret
```
