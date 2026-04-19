# Stage 2 Provider And Model Routing

Файл сохранён под историческим именем `stage2-codex-model-routing.md`, но теперь он описывает всю текущую routing-модель Stage 2, а не только Codex model policy.

## Purpose

В Stage 2 сейчас есть две независимые оси маршрутизации:

1. `caption provider routing`
   - решает, остаются ли eligible caption-writing stages на Shared Codex или уходят на Anthropic/OpenRouter API
2. `Codex model routing`
   - решает, какие модели использует Codex-backed часть Stage 2 по конкретным stage-ам

Главная инварианта: Stage 2 больше нельзя описывать как single-provider или single-model pipeline.

## 1. Baseline executor truth

- Shared Codex остаётся baseline workspace integration для Stage 2.
- Anthropic/OpenRouter не заменяют Shared Codex целиком; они only overlay eligible caption-writing stages.
- Поэтому любой Stage 2 run по-прежнему требует готовую Shared Codex integration.
- Если `provider = anthropic` или `provider = openrouter`, но внешний integration не готов, runtime падает fail-closed и не делает silent fallback обратно на Codex.

Основной runtime entry:
- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage2-codex-executor.ts`
- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/viral-shorts-worker/executor.ts`

## 2. Caption provider routing

Workspace setting:
- `workspaces.stage2_caption_provider_json`

Нормализованный config:

```ts
type Stage2CaptionProviderConfig = {
  provider: "codex" | "anthropic" | "openrouter";
  anthropicModel: string | null;
  openrouterModel: string | null;
};
```

Current default:
- `provider = "codex"`
- `anthropicModel = "claude-opus-4-6"`
- `openrouterModel = "anthropic/claude-opus-4.7"`

### Eligible external-provider stages

Только эти stages могут уйти на Anthropic/OpenRouter:

- `oneShotReference`
- `candidateGenerator`
- `targetedRepair`
- `regenerate`

### Always-Codex stages

Эти stages остаются на Shared Codex даже при `provider = anthropic` или `provider = openrouter`:

- `analyzer`
- `styleDiscovery`
- `contextPacket`
- `qualityCourt`
- `captionHighlighting`
- `captionTranslation`
- `titleWriter`
- `seo`
- Stage 3 planner / agent flows

### Runtime behavior

- `createStage2CodexExecutorContext()` всегда сначала поднимает Shared Codex integration.
- Если provider = `anthropic` или `provider = openrouter`, runtime дополнительно поднимает внешний executor и подменяет effective model только для eligible stages.
- `HybridJsonStageExecutor` маршрутизирует eligible stages во внешний executor, а все остальные — в Codex executor.
- На Anthropic/OpenRouter stages runtime не передаёт Codex-specific `reasoningEffort`.

## 3. Codex model routing

Workspace store:
- `workspaces.workspace_codex_model_config_json`

Нормализация:
- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/workspace-codex-models.ts`

Resolution order per Codex-backed stage:

1. explicit workspace override
2. deploy env default
3. safe built-in fallback

Current deploy env inputs:

- `CODEX_STAGE2_MODEL`
- `CODEX_STAGE2_DESCRIPTION_MODEL`
- `CODEX_STAGE3_MODEL`

`seo` сначала смотрит в `CODEX_STAGE2_DESCRIPTION_MODEL`, затем падает обратно в `CODEX_STAGE2_MODEL`.

## 4. Effective runtime configs

Runtime строит два разных snapshot-а:

- `resolvedCodexModelConfig`
  - только Codex policy, как если бы Anthropic overlay не был включён
- `resolvedStageModelConfig`
  - реальная effective stage policy для текущего run
  - при `provider = anthropic` подменяет eligible caption stages на `anthropicModel`
  - при `provider = openrouter` подменяет eligible caption stages на `openrouterModel`

Это distinction важно:

- UI owner defaults по-прежнему хранит Codex selections даже для Anthropic/OpenRouter-eligible stages;
- diagnostics, pipeline summary и trace должны показывать `resolvedStageModelConfig`, а не только historical Codex defaults;
- возврат с Anthropic/OpenRouter на `codex` использует сохранённые Codex stage selections без новой миграции.

## 5. Spark safety

Spark по-прежнему не может принимать images. Поэтому для Codex-backed multimodal stages сохраняются прежние guard-ы:

- UI не должен предлагать Spark для multimodal Codex stages
- normalization вычищает Spark из multimodal selections
- если deploy env всё же резолвит multimodal stage в Spark, runtime повышает stage до image-capable fallback

Anthropic overlay не отменяет эти правила; они всё ещё действуют для всех stages, которые остаются на Codex.

## 6. Diagnostics and operator truth

Stage 2 diagnostics должны позволять ответить на два вопроса отдельно:

1. какой provider реально выполнял stage
2. какая model policy реально была применена

Поэтому current truth model такая:

- Shared Codex status в shell = baseline workspace integration readiness
- `Caption provider` в owner defaults = routing policy только для eligible caption-writing stages
- prompt-stage diagnostics / `pipelineModelSummary` должны отражать effective mixed policy, если в run участвуют и Anthropic, и Codex stages

## 7. Related interfaces

- `GET /api/workspace`
- `PATCH /api/workspace`
- `GET /api/workspace/integrations/codex`
- `POST /api/workspace/integrations/codex`
- `GET /api/workspace/integrations/anthropic`
- `POST /api/workspace/integrations/anthropic`

## 8. Compatibility

- Внешний Stage 2 wire contract не меняется:
  - captions по-прежнему живут в `top` / `bottom`
  - Stage 3 handoff по-прежнему живёт на `topText` / `bottomText`
- Anthropic overlay — это runtime routing change, а не новая caption schema.
