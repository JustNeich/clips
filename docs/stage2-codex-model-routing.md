# Stage 2 Provider And Model Routing

Файл сохранён под историческим именем `stage2-codex-model-routing.md`, но теперь он описывает routing для **single-baseline Stage 2**, а не старый multi-line мир.

## 0. Current truth

В Stage 2 теперь есть только один active caption-writing baseline:

- profile id: `stable_reference_v7`
- path variant: `reference_one_shot_v2`

Routing больше не выбирает между line families. Он решает только:

1. какой provider исполняет caption-writing stage
2. какая модель используется внутри этого provider path

## 1. Provider routing

Workspace setting:

```ts
type Stage2CaptionProviderConfig = {
  provider: "codex" | "anthropic" | "openrouter";
  anthropicModel: string | null;
  openrouterModel: string | null;
};
```

### Eligible external-provider stages

Только эти Stage 2 stages могут уходить во внешний provider:

- `oneShotReference`
- `regenerate`

### Always-Codex stages

Эти product stages остаются на Shared Codex:

- `captionHighlighting`
- `captionTranslation`
- `seo`
- Stage 3 planner / agent flows

## 2. Baseline executor rule

- Shared Codex остаётся baseline workspace integration.
- Anthropic/OpenRouter являются overlay, а не полной заменой Stage 2 runtime.
- Поэтому Stage 2 нельзя описывать как “весь pipeline исполняется Anthropic” или “весь pipeline исполняется OpenRouter”.

### Fail-closed behavior

- если внешний provider выбран, но integration/model не ready, caption stage падает явно;
- silent fallback обратно на Codex не допускается.

## 3. Codex model routing

Workspace store:

- `workspaces.workspace_codex_model_config_json`

Но в single-baseline мире active Codex authority сужена:

- `oneShotReference`
- `regenerate`

Скрытые legacy stage selections могут сохраняться в JSON ради compatibility, но не должны считаться active runtime authority.

## 4. Effective runtime configs

Runtime по-прежнему различает:

- `resolvedCodexModelConfig`
  - Codex-only policy
- `resolvedStageModelConfig`
  - реальная effective policy для текущего run

Когда `provider = anthropic` или `provider = openrouter`:

- `resolvedStageModelConfig.oneShotReference`
- `resolvedStageModelConfig.regenerate`

подменяются provider-specific model id.

Остальные Stage 2 / Stage 3 product stages смотрят на Codex-backed resolution.

## 5. UI implications

В owner defaults Stage 2 surface теперь должны существовать только:

- provider selector
- one-shot model selector
- one-shot prompt
- hard constraints

В Channel Manager на уровне канала:

- provider/model/prompt read-only inherited from workspace
- editable only hard constraints

## 6. Historical compatibility

Старые поля и старые stage names ещё могут встречаться в:

- persisted configs
- historical run payloads
- trace/export
- docs/archive context

Но routing новых run-ов не должен использовать:

- `candidateGenerator`
- `targetedRepair`
- `qualityCourt`
- `contextPacket`
- line family selection

как active provider-routing choices.

## 7. Relevant files

- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage2-caption-provider.ts`
- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage2-codex-executor.ts`
- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/workspace-codex-models.ts`
- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage2-runner.ts`
