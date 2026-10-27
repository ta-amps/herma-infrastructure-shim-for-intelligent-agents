# Setup, Backing Stores & Cloudflare Deployment

## Local Development

```bash
make setup
make check
make demo
uv run herma serve --host 127.0.0.1 --port 7730
```

## Syncing Provisions from Backing Stores

1. **Tessera (`herma.provisions` + `provisions` bucket)**:
   - Local Python store: `store.publish_to_tessera_store(t_store)` and `store.sync_from_tessera_store(t_store)`.
   - Over HTTP or Cloudflare Service Binding: `POST /v1/sync/tessera` with `{"base_url": "https://tessera.ta-amps.workers.dev", "bearer_token": "..."}`. Content-addressed `tessera://blobs/<sha256>` and bucket-backed `tessera://buckets/<bucket>/<key>` URIs have their excerpts resolved automatically.
2. **Remote Handshake Provision Server**:
   - `POST /v1/sync/remote` negotiates version and clamped `max_chars` via `POST /v1/handshake` (passing configurable `surface_header` + `surface_id`) before loading `/v1/provisions`.

## Deploying on Cloudflare `workers.dev` (24/7 Cloud-Persistent Mode)

`deploy/cloudflare/wrangler.jsonc` runs natively in Cloudflare's cloud (`STORAGE_MODE = "cloud"`) backed by the `ta-amps-herma` D1 database (`HERMA_DB`) and a direct `TESSERA` Service Binding (`deploy/cloudflare/d1-herma.sql`), or proxies to an external `ORIGIN` when `STORAGE_MODE = "proxy"`:

```bash
npx --yes wrangler@4.149.0 d1 execute ta-amps-herma --remote --file deploy/cloudflare/d1-herma.sql --config deploy/cloudflare/wrangler.jsonc -y
npx --yes wrangler@4.149.0 deploy --config deploy/cloudflare/wrangler.jsonc
npx --yes wrangler@4.149.0 secret put BOOTSTRAP_SECRET --config deploy/cloudflare/wrangler.jsonc < /path/to/bootstrap.secret
```
