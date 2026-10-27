# Example Provisions & Atomic Noun/Verb Context

Each `examples/provisions/*.json` file conforms to `herma.schemas.Provision` (`extra="forbid"`), and `examples/provisions/context/*.json` holds sample `herma.schemas.ContextEntry` records (`noun`, `verb`, `detail`) seeded into Herma's context database:

- `PROV-DIRECT-NOUN-VERB-SCHEMA.json` — `action: "respond_directly"` rule that answers canonical noun/verb schema lookups directly in the caller's protocol (`/v1/chat/completions`, `/v1/responses`, `/v1/messages`, `/v1/dry-run`) with zero upstream LLM tokens, attaching `noun:tessera.lease_fence` and `verb:tessera.claim` from the context database.
- `PROV-TESSERA-FENCING.json` — Tier-1 keyword/path/tool + Tier-2 semantic trigger (`action: "shim_context"`) that shims monotonic lease fencing rules, authoritative URIs, and `context_refs` (`noun:tessera.lease_fence`, `verb:tessera.claim`).
- `PROV-SHAMASH-NON-ACCUSATORY.json` — Tier-1 keyword/path + Tier-2 semantic trigger enforcing non-accusatory risk indicators and `SYNTHETIC` bundle checks.
- `PROV-NGO-HUMAN-BOUNDARY.json` — Tier-3 micromodel classifier trigger enforcing `human_only` crisis boundaries and `drafter != reviewer`.
- `PROV-EDGE-ORIGIN-LOCKDOWN.json` — Tier-1 keyword/path trigger enforcing `x-edge-auth` (`EDGE_SECRET`), cookie stripping, HSTS, and CSP on Cloudflare Workers.
- `context/CONTEXT-TESSERA-NOUNS-VERBS.json` — Sample atomic `noun`, `verb`, and `detail` entries (`noun:tessera.lease_fence`, `verb:tessera.claim`, `detail:herma.shim_budget`) queryable via `GET /v1/context` and updatable via `POST /v1/context`.
