# AGENTS.md -- Herma Hard Rules

## Worker execution direction

Follow the [worker-first execution policy](docs/WORKER-FIRST-EXECUTION.md) when designing agentic work. Prefer claimed verbs and authorized workers, including private workers. Keep ordinary coordination deterministic; additional review is a verb when required. Distinguish required procedures from useful pointers and open-ended discovery. Tool preparation and separate-process execution follow the task workspace and execution contract. The policy does not widen effect, spending or publication authority.

Nouns and verbs are the domain primitives, supported by limited infrastructure and surfaces. Projects are human groupings or surface metadata, not a third primitive. Seed packs contain nouns and verbs. Server management work retains scoped noun/verb contracts; its location grants no general reasoning exception.

> Herma: context-shimming AI middleware for configurable coding harnesses -- intercepts requests via keyword, semantic, or micromodel rules to respond directly or shim atomic noun, verb, and URI context from a user-configured database before LLM execution.

1. **Configurable Harnesses & Caller Isolation Only**: Never weaken `herma/harness_gate.py` or `caller_scope` isolation. Provision and context-database management (`configure` scope), request interception (`route` scope), and working-entity memory require scoped `hmk_` credentials, isolate state per `caller_scope = key:<key_id>`, protect `system_builtin` entries (`403 builtin_protected`), require admin secrets on `/v1/admin/keys` (`403 admin_required`), and accept personal assistants with the same scoped credentials while rejecting browser navigation and cookie auth.
2. **Standard Mode Only**: Refuse every model ID containing `contributor` (including `contributor` and `*-contributor`) in outbound proxy payloads, micromodel classifier configs, provider plans, operator grants and managed conversation configuration, with one classifier in both runtimes (`ContributorTierRefusedError`).
3. **Domain-Neutral Core & HTTP Discipline**: Keep `herma/` domain-neutral. Specific project provisions and atomic `noun`/`verb`/`detail` context entries belong in `examples/provisions/`, SQLite/D1 `context_entries` (`POST /v1/context`), Tessera stores (`herma.provisions`), or remote handshake stores. Writes stay strictly `POST`/`PUT`/`DELETE` (`GET` on write-only endpoints returns `405`).
4. **Public Repo Hygiene**: Run `make check` (`ruff`, `mypy --strict`, `pytest`, `check_public.py`, `build_index.py --check`, `check_architecture.py`) before every commit. Never include secrets, tokens, em-dashes, or private names.
5. **Git Identity**: Commit as `ta-amps <348409696+ta-amps@users.noreply.github.com>` with zero `Co-Authored-By` trailers.
