# Design decisions and measured limits

the Teleion Fabric shim exists to supply the right small contract at the point of use. A longer
prompt can provide missing information, but it cannot enforce permissions, make
an invalid payload valid, or prove that a tool executed. These responsibilities
stay separate so another harness can reuse the same workflow.

| Decision | Reason | Tradeoff |
| --- | --- | --- |
| Teleion Fabric owns shared nouns and verbs | One authority for leases, CAS, grants and task records | Availability and projection freshness must be handled explicitly |
| Context is caller-scoped | A custom rule must not alter another caller's request | Operators must provision a separate harness credential |
| One typed proposal per conversation turn | Invalid types are rejected before any work action | The client must execute and report the result |
| Deterministic checks retain authority | Models can suggest actions without minting permissions | Semantic correctness still needs appropriate tests |
| Provider secrets stay on the Teleion Fabric shim | Server reasoning is possible without distributing operator keys | Paid access requires scoped authentication and budgets |
| Explicit request ID and version | Lost responses can be replayed without paying twice | Changed input or concurrent turns require conflict handling |

A noun is versioned information: a contract, context entry, observation, artifact
or record. A verb is work: inputs, expected output, permissions, dependency,
lease and completion evidence. Category names organize these resources; they do
not certify that their contents are correct. The Teleion Fabric shim conversation state is not a
second work queue. The client uses its own Teleion Fabric identity to perform work.

Workers should test and check their own work first. Server checks of schemas,
permissions, content hashes and record relationships are deterministic. Work
needing additional judgment becomes a review verb for a capable independent
agent, with the relevant evidence attached. Independent review remains necessary
for consequential shared-artifact publication. This is not a requirement to call
a server-side LLM on each task or turn. Server-funded LLM review is an exceptional
bounded fallback, not the default work-completion path. The Teleion Fabric shim currently proposes
and clarifies; it does not automatically grade or approve Teleion Fabric completions.

## Default execution belongs to workers

Most agentic reasoning should happen inside a worker's configured harness while
it holds a bounded Teleion Fabric verb. The verb references versioned input, contract,
artifact and evidence nouns. The Teleion Fabric shim is optional: configured rules can supply a
small permitted contract or context entry before the worker's own model call.
Reading a noun, calculating a hash, checking a type or acquiring a lease does not
need a model turn. The typed conversation endpoint is an explicit exception path,
not the default router for every work action.

| Work | Normal executor | the Teleion Fabric shim's role |
| --- | --- | --- |
| Clarify or decompose a brief | Authorized worker; park or create bounded dependent verbs | Supply configured context and the missing-field contract |
| Research, coding and self-check | Worker harness and deterministic local tools | Inject only scoped, relevant nouns and checked reusable context |
| Extra judgment before shared publication | Separate capable reviewer claiming its review verb | Optional permitted context; no automatic approval |
| Private infrastructure diagnosis | A specifically authorized private worker | Scoped context; server reasoning only when explicitly selected and budgeted |
| Credential, CAS, lease or record acceptance | Deterministic fabric handlers | No authority override or model judgment |

This is an orchestration pattern on existing interfaces, not a new claim that
every provider or external action has an implemented adapter. A worker must name
its required capabilities and effect class, validate its output and preserve
actual failure/record evidence. A server exception needs a concrete reason,
configured credentials and budget; it must not silently follow every retry.

`visibility_scope=private` means owner-key-only in Teleion Fabric. A team-private pool
uses a dedicated namespace plus authenticated surface-only or allowlisted access
and explicit grants to separate keys. A shared account, category or private tag
does not grant a worker access. The Teleion Fabric shim's `hmk_` scope remains separate from Teleion Fabric
authority, and shimming cannot create either permission. See the central
[work routing contract](https://github.com/ta-amps/teleion-fabric-infrastructure-work-and-storage-engine/blob/main/docs/work-routing.md).

## Observations, not a reliability benchmark

The following observations were recorded on 2026-10-28. The second hosted provider they used was retired on 2026-11-01; the Teleion Fabric shim now routes to Muse models through the Meta API at standard tier. Local regression commands
are `make check` and `npm run check`; provider checks require an authorized live
credential and consume the operator's configured allowance. They are not run in CI.
The [public observation summary](evidence/conversation-observations.json) contains
reported usage and record hashes without credentials or private transcripts.

| Attempt | Observed outcome | What it establishes |
| --- | --- | --- |
| OpenCode 2.1.2 with a hosted open-weight model (provider since retired), generic CAS value | Native calls stored a string rather than the requested object | A generic JSON field does not express the task's object contract |
| Add candidate instructions to the prompt only | No actual native tool calls in the bounded attempt | Text resembling calls is not execution |
| Select a typed validating connector, OpenCode with the same hosted model | Native put/get and independent object readback passed | One fixture passed with that schema and transport |
| Same typed fixture, Muse Code 1.4.14/Meta Spark 1.3 | Native put/get and independent readback passed | Native Responses and ordinary approval/sandbox paths worked for that fixture |
| Hosted typed connector, OpenCode 2.1.2 with the same hosted model | Nine native MCP calls completed anonymous claim, heartbeat, typed CAS, readback, submit and audit; independent HTTP checks passed | One complete hosted anonymous work loop, with worker reasoning and no server LLM reviewer |
| Initial Meta Spark tool probe with 512 output tokens | Length finish, no usable tool call | Reasoning consumed almost all the output allowance |
| Meta Wonder typed tool probe | Valid typed call | A different model worked for one case, not every harness |
| Initial live conversation on the retired provider | Invalid proposal; explicit follow-up recovered | Retain the failure and use precise missing-field feedback |
| Fresh deployed the Teleion Fabric shim turns on Meta and the retired provider | Both returned the exact typed object; identical requests replayed | Installed server secrets, validation and idempotent response replay worked |

The last Meta turn reported 1,042 input and 482 output tokens. The retired provider
reported 881 input and 1,200 output tokens. The Meta uncached tariff estimate is $0.003351,
not an invoice. Unknown account balance and that provider's cost remain unknown. A native
Muse run's main usage summary previously omitted two approval-child calls; use
the provider gateway's complete observations when accounting for that run.

These experiments changed catalog size, schema and transport together, so they
are not a controlled causal estimate of a prompt's benefit. No universal success
rate, complete personal-assistant compatibility or quality improvement is claimed.
The hosted OpenCode run is summarized in
[the native observation record](evidence/native-hosted-observation.json). Its two
earlier attempts stopped before inference on test-recorder and overly literal
resolved-policy comparison bugs. They were fixed with offline controls without
loosening the client permissions. Native keyed and native Muse hosted full loops,
repeated-run reliability, Grokbot and other personal-assistant clients remain
separate validation work. A passing the Teleion Fabric shim proposal still has `executed:false`.

## Remaining operational differences

Worker conversations use per-caller Durable Objects, crash-recovery alarms and
24-hour transcript expiration. Local Python retains transcripts and needs
operator reconciliation after a crash. Their provider ledgers are separate.
Reservations conservatively retain uncertain calls and are not provider invoices.
Read [conversation configuration](conversations.md) before raising a budget.

The generic upstream proxy and the typed conversation endpoint are separate
interfaces. The proxy now allows an explicitly selected `api.meta.ai` provider
with a caller-owned key; alternate origins cannot borrow an operator key.
Typed conversations use fixed provider destinations, led by the Meta API, and their server secrets.
Do not interpret public deterministic preview access as free paid inference.

The default recovery sequence is classify the failure, supply missing fields,
select less context, split a larger verb if needed, then make one bounded profile
adjustment. Record the original input, environment, model, actual calls, schema
errors and record. If progress stops, park the work with a concrete question.
More retries or encouragement do not replace a valid contract.

## Configured shim reasoning and offline boundaries

A configured shim may routinely use an approved model for interpretation or
routing. This is separate from executing a verb, reviewing every result or
granting permissions. The caller's existing scope and provision governance still
apply. A model's decision activates only an already configured provision.

The micromodel response must contain `apply` as a JSON boolean and `confidence`
as a finite number from 0 to 1. When supplied, `label` and `reason` must be
strings. Only `apply: true` at the configured threshold can match; a label cannot
override `apply: false`. Strings such as `"false"`, integers such as `1`, missing
decisions and malformed provider responses are rejected without activating a
fallback. An unavailable provider can still use the provision's explicitly
configured keyword fallback, with `micromodel:fallback` attribution.

`offline_only=True` in Python and `offlineOnly: true` in the Worker skip
micromodel provider requests. Python also skips remote embeddings and uses its
local semantic matcher. The Worker currently uses local semantic matching in
both modes. Public previews and authenticated dry-runs select this offline
trigger path. Offline matching does not disable ordinary configured online
shim requests or expand access to context.

Network-free regression tests in `tests/test_triggers.py`,
`tests/test_api_and_proxy.py` and `test/triggers.test.js` check typed decisions,
malformed responses with matching fallback keywords, zero provider calls in
offline mode, and continued online routing. A retained local before/after probe
reproduced a string `"false"` activating a rule and one mocked embedding call in
offline mode before the fixes; both are rejected or suppressed afterward.
These fixtures establish the tested boundaries, not live model quality or a
universal routing-success rate. Run `make check` to reproduce the repository
gates; the tests use recorded example responses without provider credentials or spend.

## Worker placement policy

The [worker-first execution policy](WORKER-FIRST-EXECUTION.md) distinguishes worker-requested proxy traffic, private managed workers and direct server inference. Keep those costs and authorities separate.
