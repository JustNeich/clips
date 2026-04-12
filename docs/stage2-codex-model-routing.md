# Stage 2 Codex Model Routing

## Purpose

Stage 2 no longer uses one shared Codex model for the whole pipeline. Model policy is now stored and resolved per substage so text-only routes can use `gpt-5.3-codex-spark`, while multimodal routes stay on an image-capable model.

## Stage Mapping

### Multimodal stages

- `analyzer`
- `styleDiscovery`

These stages may send real `imagePaths` into Codex. Spark is never used here.

### Text-only stages

- `selector`
- `writer`
- `critic`
- `rewriter`
- `finalSelector`
- `titles`
- `seo`
- `regenerate`

These stages work from textual digests, saved analysis, examples, or shortlisted options. Spark is allowed here.

## Resolution Rules

Model settings are stored in `workspace_codex_model_config_json` and normalized by `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/workspace-codex-models.ts`.

Resolution order per stage:

1. explicit workspace override for that stage
2. deploy default from env
3. safe built-in fallback when needed

Current deploy env inputs:

- `CODEX_STAGE2_MODEL`
- `CODEX_STAGE2_DESCRIPTION_MODEL`
- `CODEX_STAGE3_MODEL`

`seo` resolves from `CODEX_STAGE2_DESCRIPTION_MODEL` first and falls back to `CODEX_STAGE2_MODEL`.

## Spark Safety

Spark cannot accept images. To keep Stage 2 safe:

- the UI hides Spark for `analyzer` and `styleDiscovery`
- config normalization coerces invalid multimodal Spark selections back to `deploy_default`
- if deploy env still resolves a multimodal stage to Spark, runtime upgrades that stage to `gpt-5.4`

This keeps deploy defaults backward-compatible without allowing a broken multimodal route.

## Legacy Migration

Older workspaces may still have the coarse config shape:

- `stage2Pipeline`
- `stage2Seo`
- `stage3Planner`

Normalization migrates that format into the new per-stage shape:

- `stage2Pipeline` fans out to all Stage 2 text routes
- valid image-capable values also propagate to multimodal routes
- Spark is stripped from multimodal routes during migration
- `stage2Seo` still overrides only `seo`

## Runtime Application

Main Stage 2 paths now resolve models explicitly:

- full pipeline: `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage2-runner.ts`
- quick regenerate: `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage2-quick-regenerate.ts`
- style discovery: `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage2-style-discovery.ts`

The worker receives explicit per-stage `model` values for:

- `analyzer`
- `selector`
- `writer`
- `critic`
- `rewriter`
- `finalSelector`
- `titles`
- `seo`
- `contextPacket`
- `candidateGenerator`
- `qualityCourt`
- `targetedRepair`
- `captionHighlighting`
- `captionTranslation`
- `titleWriter`

SEO now runs inside the same Stage 2 worker flow and is persisted in the top-level Stage 2 response.

## Diagnostics

Prompt-stage diagnostics now include the effective model per LLM stage. The top-level Stage 2 response shows:

- one concrete model if all visible Stage 2 prompt stages use the same model
- `per-stage policy` if multiple models are active

This keeps the UI honest when Stage 2 is split across multiple models.
