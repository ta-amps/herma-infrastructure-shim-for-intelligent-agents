# Herma. Run `make help` for the list. Tessera must be cloned next to this repo (../tessera).
.DEFAULT_GOAL := help
SHELL := /bin/bash
API_PORT ?= 7730

.PHONY: help setup check lint types test public index index-check architecture demo serve

help: ## List the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-16s %s\n", $$1, $$2}'

setup: ## Install Python dependencies (uv)
	uv sync --all-groups

check: lint types test public index-check architecture ## Lint, types, tests, leak scan, index and architecture checks

lint: ## ruff lint and format check
	uv run ruff check .
	uv run ruff format --check .

types: ## mypy strict on herma/
	uv run mypy

test: ## Unit and integration tests
	uv run pytest -q

index: ## Rebuild INDEX.md, KEYWORDS.md, llms.txt and llms-full.txt from the files
	python3 scripts/build_index.py

index-check: ## Fail when the indexes are stale
	python3 scripts/build_index.py --check

public: ## Secret and private-name scan
	python3 scripts/check_public.py .

demo: ## End-to-end 3-tier trigger + Tessera sync + live/offline injection demo
	HERMA_DB=$$(mktemp -d)/herma.db uv run herma demo

serve: ## Seed example provisions and serve the Herma middleware on :7730
	@test -f .herma/herma.db || uv run herma seed
	uv run uvicorn herma.api.app:app --port $(API_PORT)

architecture: ## architecture.json must match the code: paths, tests, layering rules
	python3 scripts/check_architecture.py . --summary
