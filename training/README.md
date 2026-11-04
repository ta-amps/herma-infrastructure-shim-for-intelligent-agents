# the Teleion Fabric shim LoRA as Parametric Memory (`training/`)

This folder provides the reproducible LoRA specification and Python dependencies for training a **Muse Glimmer** 4-bit QLoRA adapter, fine-tuned by ta-amps, that pairs with the Teleion Fabric shim's inline context shim.

## Honest Scope & Artifact Boundary

- `shim-router-lora-spec.json` is a **reproducible Task Object training specification** (`noun` on the wire), not binary adapter weights checked into Git.
- Zero-weight the Teleion Fabric shim context shimming (`action: "shim_context"`) operates immediately with **0 weight updates**. The Muse Glimmer 4-bit QLoRA adapter reaches `99.3%` exact tool-call match (from `93.3%` for the base model) on a pre-registered fixed 150-task evaluation, with `100.0%` valid JSON (see [`../eval/shim_lift_summary.json`](../eval/shim_lift_summary.json)). That is one evaluation: the adapter is a promotion candidate and is not yet admitted.
- Private caller inputs, NGO case bundles, and `*-contributor` model outputs are **never** admitted into training corpora (`ContributorTierRefusedError` enforces Standard-mode-only routing).

## When to Shim vs When to Train a LoRA

| Regime | Target | Weight Updates | Per-Turn `HarnessTax` | Best Fit |
| :--- | :--- | :--- | :--- | :--- |
| **The Teleion Fabric shim Context Shim** | Any configured harness / model | `0` | Bounded (`<= 2400` chars/rule, deduped) | Volatile URIs, caller-scoped provisions, fresh statute cards, live queue fences |
| **LoRA as Parametric Memory** | `Muse Glimmer` | 4-bit QLoRA (`r=32, alpha=64`) | `0` static schema tokens | Stabilized post-cutoff Task Object schemas and strict JSON tool contracts |
| **Frontier Passthrough** | `Muse Wonder 1.0` / `Muse Spark 1.3` | `0` (Standard mode only) | Shimmed delta only | Open-ended multi-step synthesis, architecture, and independent review Tasks |

## Environment Setup

Install the training dependencies into an isolated virtual environment with CUDA support (2x T4 16 GB or 1x A10G/L4 is used for `Muse Glimmer` NF4 QLoRA):

```bash
python3 -m venv .venv-train
.venv-train/bin/pip install --upgrade pip
.venv-train/bin/pip install -r training/requirements-train.txt
```

## Tier-3 Classifier

the Teleion Fabric shim's Tier-3 micromodel classifier needs no training. It calls any OpenAI-compatible chat endpoint you configure and falls back to deterministic keyword rules when none is set. To run it on a Muse model through the Meta API at standard tier:

```bash
export HERMA_MICROMODEL_URL="https://api.meta.ai/v1/chat/completions"
export HERMA_MICROMODEL_MODEL="muse-spark-1.3"
export HERMA_MICROMODEL_API_KEY="<your Meta API key>"
uv run herma serve --host 127.0.0.1 --port 7730
```

Model ids containing `contributor` are refused before any call, and server-funded inference is an explicit exception that needs its own allowance.
