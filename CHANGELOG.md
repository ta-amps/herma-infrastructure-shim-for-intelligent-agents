# Changelog

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

## Strict classifier decisions and offline routing

Micromodel replies require a JSON boolean `apply` and finite numeric confidence
between 0 and 1. Malformed decisions cannot activate provisions or their fallback;
an explicit `false` cannot be overridden by a label. Offline trigger evaluation
skips configured classifiers and remote embeddings. Regression tests exercise
Python HTTP previews/dry-runs and trigger evaluation in the Workers runtime with
mocked providers.

## External agent access

Public deterministic previews are explicit and nonpersistent, with browser CORS and bounded request bodies. Returned artifacts can be saved through a tracked anonymous Tessera session or scoped key. Security regression checks cover the access boundary.
