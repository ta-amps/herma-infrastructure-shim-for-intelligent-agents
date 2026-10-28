# Design decisions and measured limits

Herma exists to supply the right small contract at the point of use. A longer
prompt can provide missing information, but it cannot enforce permissions, make
an invalid payload valid, or prove that a tool executed. These responsibilities
stay separate so another harness can reuse the same workflow.

| Decision | Reason | Tradeoff |
| --- | --- | --- |
| Tessera owns shared nouns and verbs | One authority for leases, CAS, grants and task receipts | Availability and projection freshness must be handled explicitly |
| Context is caller-scoped | A custom rule must not alter another caller's request | Operators must provision a separate harness credential |
| One typed proposal per conversation turn | Invalid types are rejected before any work action | The client must execute and report the result |
| Deterministic checks retain authority | Models can suggest actions without minting permissions | Semantic correctness still needs appropriate tests |
| Provider secrets stay on Herma | Server reasoning is possible without distributing operator keys | Paid access requires scoped authentication and budgets |
| Explicit request ID and version | Lost responses can be replayed without paying twice | Changed input or concurrent turns require conflict handling |

A noun is versioned information: a contract, context entry, observation, artifact
or receipt. A verb is work: inputs, expected output, permissions, dependency,
lease and completion evidence. Category names organize these resources; they do
not certify that their contents are correct. Herma conversation state is not a
second work queue. The client uses its own Tessera identity to perform work.

Workers should test and check their own work first. Server checks of schemas,
permissions, content hashes and receipt relationships are deterministic. Work
needing additional judgment becomes a review verb for a capable independent
agent, with the relevant evidence attached. Independent review remains necessary
for consequential shared-artifact publication. This is not a requirement to call
a server-side LLM on each task or turn. Server-funded LLM review is an exceptional
bounded fallback, not the default work-completion path. Herma currently proposes
and clarifies; it does not automatically grade or approve Tessera completions.

## Observations, not a reliability benchmark

The following observations were recorded on 2026-10-28. Local regression commands
are `make check` and `npm run check`; provider checks require an authorized live
credential and consume the operator's configured allowance. They are not run in CI.
The [public observation summary](evidence/conversation-observations.json) contains
reported usage and receipt hashes without credentials or private transcripts.

| Attempt | Observed outcome | What it establishes |
| --- | --- | --- |
| OpenCode 2.1.2 with Ollama Muse Spark Open, generic CAS value | Native calls stored a string rather than the requested object | A generic JSON field does not express the task's object contract |
| Add candidate instructions to the prompt only | No actual native tool calls in the bounded attempt | Text resembling calls is not execution |
| Select a typed validating connector, OpenCode/Ollama | Native put/get and independent object readback passed | One fixture passed with that schema and transport |
| Same typed fixture, Muse Code 1.4.14/Meta Spark 1.3 | Native put/get and independent readback passed | Native Responses and ordinary approval/sandbox paths worked for that fixture |
| Initial Meta Spark tool probe with 512 output tokens | Length finish, no usable tool call | Reasoning consumed almost all the output allowance |
| Meta Wonder typed tool probe | Valid typed call | A different model worked for one case, not every harness |
| Initial live Ollama conversation | Invalid proposal; explicit follow-up recovered | Retain the failure and use precise missing-field feedback |
| Fresh deployed Herma Meta and Ollama turns | Both returned the exact typed object; identical requests replayed | Installed server secrets, validation and idempotent response replay worked |

The last Meta turn reported 1,042 input and 482 output tokens. Ollama reported
881 input and 1,200 output tokens. The Meta uncached tariff estimate is $0.003351,
not an invoice. Unknown account balance and Ollama cost remain unknown. A native
Muse run's main usage summary previously omitted two approval-child calls; use
the provider gateway's complete observations when accounting for that run.

These experiments changed catalog size, schema and transport together, so they
are not a controlled causal estimate of a prompt's benefit. No universal success
rate, complete personal-assistant compatibility or quality improvement is claimed.
Full hosted native claim/heartbeat/write/submit loops for both principal modes,
repeated-run reliability, Grokbot and other personal-assistant clients remain
separate validation work. A passing proposal has `executed:false`.

## Remaining operational differences

Worker conversations use per-caller Durable Objects, crash-recovery alarms and
24-hour transcript expiration. Local Python retains transcripts and needs
operator reconciliation after a crash. Their provider ledgers are separate.
Reservations conservatively retain uncertain calls and are not provider invoices.
Read [conversation configuration](conversations.md) before raising a budget.

The generic upstream proxy and the typed conversation endpoint are separate
interfaces. The proxy now allows an explicitly selected `api.meta.ai` provider
with a caller-owned key; alternate origins cannot borrow an operator key.
Typed conversations use fixed Meta/Ollama destinations and their server secrets.
Do not interpret public deterministic preview access as free paid inference.

The default recovery sequence is classify the failure, supply missing fields,
select less context, split a larger verb if needed, then make one bounded profile
adjustment. Record the original input, environment, model, actual calls, schema
errors and receipt. If progress stops, park the work with a concrete question.
More retries or encouragement do not replace a valid contract.
