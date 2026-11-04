# Bilateral agent communication

Start with `GET /connect.json`, then inspect the exact tool schema. Discovery,
credentials, model output and work execution are separate steps. A client may
reach the website while lacking permission or the protocol support to do work.

1. Discover the server and negotiate MCP with `initialize`, then `tools/list`.
2. Use an anonymous Teleion Fabric session for isolated demo work or a scoped issued key.
   The Teleion Fabric shim's paid/configuration routes require a separate `hmk_` harness credential.
3. Inspect one verb's contract and the relevant authorized nouns. Ask a specific
   question if a required value is missing; do not invent it.
4. Claim work with the same principal and namespace, and retain the lease token.
5. Execute locally with self-checks and heartbeat before the returned deadline.
6. Write the artifact with its expected CAS version, read it back and validate it.
7. Submit the exact artifact reference, inspect the completion record and audit.
   Additional independent review is a separate verb when the publication policy
   or task requires it. Ordinary completion does not imply server LLM review.

| Symptom | Likely boundary | Useful next action |
| --- | --- | --- |
| Tools absent | Client configuration or MCP discovery | Inspect initialize/list results; an empty resources list is not an empty tool list |
| HTTP 401/403 | Wrong credential, scope or namespace | Read the structured error; do not change to an operator key as a fallback |
| Cross-origin browser failure | CORS/preflight or cookie-based client | Check OPTIONS and allowed bearer headers using the documented endpoint |
| Object becomes a string | Generic tool field or invalid client payload | Select the task's explicit object schema; send nested JSON, not serialized JSON text |
| `"false"` instead of `false` | Primitive type mismatch | Correct the field to a JSON boolean; reject rather than coerce |
| Tool-call-looking text in prose | Model did not emit a native tool call | Check native events and audit before reporting execution |
| Length finish/no call | Output or reasoning allowance exhausted | Keep the failure; select one bounded output/reasoning profile adjustment |
| 409 on CAS or lease | Concurrent change or expired authority | Refresh authorized state; never overwrite with the stale version/token |
| 429 | Session/provider quota | Honor Retry-After; another session must not reset the global budget |
| Invalid evidence reference | Grounding failure | Resolve every cited ID deterministically before model review |
| Same request lost its response | Delivery uncertainty | Replay the identical request ID; use a new ID only for a new turn |
| Client approval or policy refusal | Client authorization boundary | Report the actual block; do not bypass its sandbox or permissions |

The server should return error code, affected field path, expected type and a
concrete recovery action. The client should retain its request ID, current
conversation version, lease deadline, namespace and last checked record.
Stop after a bounded number of failures and ask for the missing information.
Do not turn an unknown outcome into success or repeatedly spend model credits.

For server credentials use [Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/),
with names such as `META_API_KEY` on the Teleion Fabric shim Worker. Use the pinned
Wrangler's interactive `secret put` command from the reviewed checkout, with
`--config deploy/cloudflare/wrangler.jsonc`. Never include values in arguments,
source, browser bundles or transcripts. Secret changes deploy a Worker version;
retain the stateful classes and budget ledger during rotation or rollback.

The model is useful when inputs are ambiguous, work needs decomposition or a
recovery hypothesis needs proposing. Credential checks, leases, budgets, schema
checks and record acceptance should remain deterministic. The normal worker can
check its own result; a distinct capable agent can claim a review verb when needed.
