# Example Provisions

Each JSON file in this folder conforms to `herma.schemas.Provision` (`extra="forbid"`):

- `PROV-TESSERA-FENCING.json` — Tier-1 keyword/path/tool + Tier-2 semantic trigger for atomic lease fencing and CAS writes.
- `PROV-SHAMASH-NON-ACCUSATORY.json` — Tier-1 keyword/path + Tier-2 semantic trigger enforcing non-accusatory risk indicators and `SYNTHETIC` bundle checks.
- `PROV-NGO-HUMAN-BOUNDARY.json` — Tier-3 micromodel classifier trigger enforcing `human_only` crisis boundaries and `drafter != reviewer`.
- `PROV-EDGE-ORIGIN-LOCKDOWN.json` — Tier-1 keyword/path trigger enforcing `x-edge-auth` (`EDGE_SECRET`), cookie stripping, HSTS, and CSP on Cloudflare Workers.
