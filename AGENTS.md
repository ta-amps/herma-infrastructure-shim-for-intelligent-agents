# AGENTS.md — Herma Hard Rules

1. **Configurable Harnesses Only**: Never weaken `herma/harness_gate.py`. Provision management (`configure` scope) and request interception (`route` scope) require scoped `hmk_` credentials and reject generic consumer chat surfaces (such as Muse Personal Assistant), browser navigation, and cookie auth.
2. **Standard Mode Only**: Refuse every `-contributor` model ID in both outbound proxy payloads and micromodel classifier configs (`ContributorTierRefusedError`).
3. **Domain-Neutral Core**: Keep `herma/` domain-neutral. Specific project provisions belong in `examples/provisions/*.json`, Tessera stores (`herma.provisions`), or remote handshake stores.
4. **Public Repo Hygiene**: Run `make check` (`ruff`, `mypy --strict`, `pytest`, `check_public.py`, `build_index.py --check`, `check_architecture.py`) before every commit. Never include secrets, tokens, or private names.
5. **Git Identity**: Commit as `ta-amps <348409696+ta-amps@users.noreply.github.com>` with zero `Co-Authored-By` trailers.
