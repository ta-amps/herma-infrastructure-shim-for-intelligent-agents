# Herma Shim Router & LoRAs as Parametric Memory (`training/`)

This folder provides the reproducible PEFT LoRA specification and Python dependencies for training local **Tier-3 Shim Router** classifiers (`Llama 3.2 1B`) and **LoRAs as Parametric Memory** adapters (`Llama 3.2 1B/3B` and `Muse Glimmer 30B` 4-bit QLoRA) that pair with Herma's inline context shim.

## Honest Scope & Artifact Boundary

- `shim-router-lora-spec.json` is a **reproducible Task Object training specification** (`noun` on the wire), not binary adapter weights checked into Git.
- Zero-weight Herma context shimming (`action: "shim_context"`) operates immediately with **0 weight updates** and lifts frozen 150-row synthetic tool-call accuracy on `Llama-3.2-3B-Instruct` from **`52.0% -> 64.7%` (+12.7 pp)**; promoted local tuning reaches `72.7%` (`3B`) and `50.7%` (`1B`), while `Muse Glimmer 30B` 4-bit QLoRA reaches `99.3%` (from `93.3%`) on pre-registered synthetic holdouts (see [`../eval/shim_lift_summary.json`](../eval/shim_lift_summary.json)).
- Private caller inputs, NGO case bundles, and `*-contributor` model outputs are **never** admitted into training corpora (`ContributorTierRefusedError` enforces Standard-mode-only routing).

## When to Shim vs When to Train a LoRA

| Regime | Target | Weight Updates | Per-Turn `HarnessTax` | Best Fit |
| :--- | :--- | :--- | :--- | :--- |
| **Herma Context Shim** | Any configured harness / model | `0` | Bounded (`<= 2400` chars/rule, deduped) | Volatile URIs, caller-scoped provisions, fresh statute cards, live queue fences |
| **Tier-3 Shim Router LoRA** | `meta-llama/Llama-3.2-1B-Instruct` | PEFT LoRA (`r=16, alpha=32`) | Minimal classifier prompt (`<= 512` tokens) | Natural-language intent classification when Tier-1 keyword & Tier-2 cosine abstain |
| **LoRA as Parametric Memory** | `Llama-3.2-3B-Instruct` / `Muse Glimmer 30B` | PEFT LoRA / 4-bit QLoRA (`r=32, alpha=64`) | `0` static schema tokens | Stabilized post-cutoff Task Object (`noun`) schemas and strict JSON tool contracts |
| **Frontier Passthrough** | `Muse Spark 1.3` / `Muse Wonder 1.0` | `0` (Standard mode only) | Shimmed delta only | Open-ended multi-step synthesis, architecture, and independent review Tasks (`verbs`) |

## Environment Setup

Install the training dependencies into an isolated virtual environment with CUDA support (12 GB VRAM such as an RTX 3060 is sufficient for `Llama 3.2 1B/3B` bf16 LoRA; 2x T4 16 GB or 1x A10G/L4 is used for `Muse Glimmer 30B` NF4 QLoRA):

```bash
python3 -m venv .venv-train
.venv-train/bin/pip install --upgrade pip
.venv-train/bin/pip install -r training/requirements-train.txt
```

## Serving a Trained Tier-3 Shim Router Behind Herma

Once an adapter passes all promotion gates in `training/shim-router-lora-spec.json` (`exact_action_accuracy`, `contributor_refusal_recall == 1.0`, and `8/8` reload determinism), point Herma's Tier-3 micromodel classifier at the local OpenAI-compatible server:

```bash
export HERMA_MICROMODEL_URL="http://127.0.0.1:8081/v1/chat/completions"
export HERMA_MICROMODEL_MODEL="llama-3.2-1b-shim-router"
uv run herma serve --host 127.0.0.1 --port 7730
```
