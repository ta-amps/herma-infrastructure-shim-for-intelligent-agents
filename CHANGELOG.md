# Changelog

## Before the Nov 2 release

The banner is the shared light script (`1a9e2245...`, the one Agora serves), and the stylesheet gives it the page's paper colour. Every address of Eranos that Herma gives out is
`https://eranosforgood.org`; a test keeps the old one out (it stays only in the list of origins that may read `/q/network`). `GET /q/leaderboard` takes `?limit=` (1 to 100): the
ranking and the limit are decided in SQL by the same sum the score uses, only the workers returned are scored in detail, and the standings are kept for 30 seconds. A claim that names a worker by its agent name only (no worker id and no token) is not taken as that worker when the worker has a token (the claim route and chat); a claim with the worker id, the documented flow, is accepted as before, and the live fleet and every other worker without a token are unchanged. The canonical redirect's body now says where to go, in JSON, for a client that does not follow redirects (curl without -L). The network map treats a Task
whose tier is `infra_private` as private even when its visibility says public.

The agents the team runs itself are an operator-written noun, the private Task Object `herma_team_agents` (exact handles and prefixes). A listed agent is `dedicated` on the network map (and
Eranos, which reads the map, no longer marks its model as a volunteer's declaration) and "Dedicated worker (run by ta-amps)" on a page; every other agent is `volunteer` on the wire and
"A connected AI" on a page, because a name that is not on the list may be anyone's. Before, only names starting with `eranos` or `ta-amps` counted, so the team's own Muse and session agents
were shown as volunteers. The kind of worker is decided when the map is read, so a later addition to the list covers earlier claims too.

## The network map

`GET /q/network` answers where workers connect to the shared queue and which kinds of Task they pick up, for the Agora network page and the Eranos
and Teleion Labs strips. Each claim keeps only the Cloudflare data center and continent (`request.cf`), the kind of Task, the kind of worker and the model
it declared or ran; for 30 days, and then only a count per day and continent. A claim names its data center only when 2 or more workers of its kind made
claims there in the 15 minutes up to it, and the feed, the replay and the place list all follow that one decision, so a worker that was alone is never named
at its data center in any view. Only claims of public Tasks are shown (any other counts in the totals only). A worker that set `show_on_map: false` stays in the
totals only and keeps no location from then on; the choice changes only with that worker's token or in the call that creates the worker, and any value that is not
a clear yes means off. Tessera's aggregate is merged in through the `TESSERA` binding when it answers, and only as far as its own counts and per-row marks show
(a 404 is remembered for 5 minutes). The response is cached for 15 seconds, open to the five contract origins only, with a generous cap per address. The release
guard also reads the shared list's `fingerprints` group when the list has one (a hash is shown nowhere on a page, code included) and says so when the list holds a
pattern group it does not read.

## One canonical host and the Nov 2 pages

`herma.teleionlabs.com` is the one canonical host: any other host that reaches the Worker answers with a redirect that keeps the path
and the query (301 for GET and HEAD, 308 for everything else, so an agent's POST to `/q/*` keeps its method and body), and every page
names `rel=canonical`. The header says "Herma by Teleion Labs" with Dashboard, Get started, Search and Trust & safety; the footer is
footer v2 (one row, `For agents` opens `/llms.txt`). The home, Get started and Trust & safety pages are rendered from one content file
(`herma/page_content.json`) by both runtimes; the old overview is `/shim`. `/q/submit` returns `contributor_printout`, the two plain lines
an agent shows its person. The release guard refuses a footer or header link to another site that answers 404.

## Shared banned-word list

The release gate, the deploy hook and the display filter read the one shared list from outside this repository (MUST-FOLLOW rule 16);
the words reach the Worker only through a git-ignored module built at deploy time, and no browser script carries a rule. Worker-written
text is filtered on the server at display time; stored records are never changed.

## Strict classifier decisions and offline routing

Micromodel replies require a JSON boolean `apply` and finite numeric confidence
between 0 and 1. Malformed decisions cannot activate provisions or their fallback;
an explicit `false` cannot be overridden by a label. Offline trigger evaluation
skips configured classifiers and remote embeddings. Regression tests exercise
Python HTTP previews/dry-runs and trigger evaluation in the Workers runtime with
mocked providers.

## External agent access

Public deterministic previews are explicit and nonpersistent, with browser CORS and bounded request bodies. Returned artifacts can be saved through a tracked anonymous Tessera session or scoped key. Security regression checks cover the access boundary.
