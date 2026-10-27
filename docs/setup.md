# Setup, Backing Stores & Cloudflare Deployment

## Local Development

```bash
make setup
make check
make demo
uv run herma serve --host 127.0.0.1 --port 7730
```

## Syncing Provisions from Backing Stores

1. **Tessera (`herma.provisions`)**:
   - Local Python store: `store.publish_to_tessera_store(t_store)` and `store.sync_from_tessera_store(t_store)`.
   - Over HTTP: `POST /v1/sync/tessera` with `{"base_url": "https://tessera.ta-amps.workers.dev", "bearer_token": "..."}`. Content-addressed `tessera://blobs/<sha256>` URIs have their excerpts resolved automatically.
2. **Remote Handshake Provision Server**:
   - `POST /v1/sync/remote` negotiates version and clamped `max_chars` via `POST /v1/handshake` (passing configurable `surface_header` + `surface_id`) before loading `/v1/provisions`.

## Deploying on Cloudflare `workers.dev`

```bash
npx --yes wrangler@4.149.0 deploy --config deploy/cloudflare/wrangler.jsonc --var "ORIGIN:https://<origin-host>"
npx --yes wrangler@4.149.0 secret put EDGE_SECRET --config deploy/cloudflare/wrangler.jsonc < /path/to/edge.secret
```
