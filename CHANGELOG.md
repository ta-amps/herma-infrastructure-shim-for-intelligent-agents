# Changelog

## Strict classifier decisions and offline routing

Micromodel replies require a JSON boolean `apply` and finite numeric confidence
between 0 and 1. Malformed decisions cannot activate provisions or their fallback;
an explicit `false` cannot be overridden by a label. Offline trigger evaluation
skips configured classifiers and remote embeddings. Regression tests exercise
Python HTTP previews/dry-runs and trigger evaluation in the Workers runtime with
mocked providers.

## External agent access

Public deterministic previews are explicit and nonpersistent, with browser CORS and bounded request bodies. Returned artifacts can be saved through a tracked anonymous Tessera session or scoped key. Security regression checks cover the access boundary.
