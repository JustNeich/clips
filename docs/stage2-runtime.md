# Stage 2 Runtime

Этот документ описывает **актуальную** Stage 2 архитектуру проекта после single-baseline cleanup.

Если текст в другом месте противоречит этому файлу, источником истины считается этот документ.

## 0. Коротко

- Active Stage 2 path теперь **один**: `native_caption_v3` в one-shot режиме.
- Единственный product baseline profile: `stable_reference_v7`.
- Старые ids вроде `stable_reference_v6`, `stable_reference_v6_experimental`, `stable_social_wave_v1`, `stable_skill_gap_v1`, `experimental` оставлены только для historical read-compat.
- Active prompt contract стал video-first minimal, но теперь source-настройки явно выбираются в UI:
  - `video_truth_json`
  - bounded `comments_hint_json`
  - optional `examples_json` из workspace default, system preset или channel custom
  - optional `examples_text` из channel custom
  - `hard_constraints_json`
  - `user_instruction`
- Comments больше не являются driver-ом угла, narrator stance или fallback mode. Это только weak hints.
- Multi-stage native flow, selector-style examples-routing, style discovery и editorial-memory steering больше не являются active runtime authority.

## 1. Runtime truth

### Единственный active path

Для новых Stage 2 run-ов всегда используется:

1. `oneShotReference`
2. `captionHighlighting` optional, fail-open
3. `captionTranslation`
4. `seo`
5. `assemble`

Quick regenerate остаётся отдельным run mode, но живёт в той же модели:

1. берёт сохранённый video-first base context
2. переписывает только visible shortlist
3. не запускает selector/writer/critic loops
4. не использует channel-learning steering

### Canonical identity

- active profile id: `stable_reference_v7`
- active execution path variant: `reference_one_shot_v2`

Historical aliases:

- `stable_reference_v6`
- `stable_reference_v6_experimental`
- `stable_social_wave_v1`
- `stable_skill_gap_v1`
- `experimental`

Они больше не должны появляться как active workspace/channel choice. Они нужны только чтобы:

- открывать старые run-ы;
- честно рендерить trace/export;
- не ломать persisted historical payloads.

## 2. Prompt contract

### Active one-shot input model

One-shot prompt больше не должен рассчитывать на:

- `line_profile_json`
- `channel_narrative_json`
- `editorial_memory_json`
- selector-stage examples-routing payloads
- lane plans
- selector fallback context

Active prompt contract:

- `video_truth_json`
  главный источник истины
- `comments_hint_json`
  bounded weak hints для harmless phrasing или weak consensus cues
- `examples_json`
  optional style references. Source may be workspace default, system preset, or channel custom. JSON may be an array, an object with `examples/items`, or a single arbitrary object. Runtime normalizes it into style examples, but facts from examples never override current video truth.
- `examples_text`
  optional plain-text channel examples or notes. It is available for channel custom examples and is a style/rhythm reference, not factual evidence.
- `hard_constraints_json`
  обязательные length/content guardrails
- `user_instruction`
  ручная правка оператора

### Comments policy

Comments теперь интерпретируются так:

- можно использовать как weak phrasing cue;
- можно использовать как weak consensus hint;
- нельзя использовать как narrator stance;
- нельзя использовать как engine для angle selection;
- отсутствие comments не должно переключать pipeline family или product semantics.

## 3. Caption provider routing

Workspace routing policy:

- `codex`
- `anthropic`
- `openrouter`

Но active external routing теперь узко ограничен:

- `oneShotReference`
- `regenerate`

Translation и SEO остаются downstream Codex-backed stages.

### Invariants

- Shared Codex остаётся baseline workspace integration.
- Anthropic/OpenRouter не заменяют весь Stage 2, а только overlay caption-writing stages.
- Если внешний provider выбран, но не готов, runtime падает fail-closed.
- Silent fallback обратно на Codex не допускается.

## 4. Workspace and channel authority

### Workspace-level active authority

Active workspace Stage 2 settings теперь только такие:

- `stage2_caption_provider_json`
- `workspace_codex_model_config_json` для `oneShotReference` / `regenerate`
- one-shot prompt source:
  - system preset `system_prompt`
  - system preset `animals_system_prompt`
  - custom workspace prompt
- workspace examples source:
  - system preset `system_examples`
  - system preset `animals_examples`
  - custom workspace JSON corpus
- default hard constraints

### Channel-level active authority

На уровне канала Stage 2 теперь редактируются:

- `stage2HardConstraints`
- optional `stage2PromptConfig`:
  - workspace default
  - system preset
  - custom channel prompt
- optional `stage2ExamplesConfig`:
  - workspace default
  - system preset
  - custom JSON examples
  - custom plain-text examples
- render template отдельно в Channel Manager / Stage 3 surfaces

Channel-level Stage 2 prompt/examples settings are editable by any user who has channel setup access for that channel (`owner`, `manager`, or `redactor` on a visible/owned/granted channel). Workspace defaults remain owner-only.

Channel больше **не** должен активно управлять:

- worker profile
- selector-style examples corpus as a ranking/router authority
- style discovery
- stage2 style profile
- editorial memory

### Parse-tolerant legacy fields

Следующие поля могут по-прежнему существовать в persisted JSON/DB ради compatibility, но runtime их игнорирует как active authority:

- `stage2WorkerProfileId`
- `stage2StyleProfile`
- `editorialMemory`
- `editorialMemorySource`
- hidden multi-stage prompt/model settings

## 5. UI truth

### Channel creation

Новый канал создаётся через простой identity flow:

- name
- username
- avatar optional

После создания:

- Stage 2 наследует workspace baseline автоматически;
- позже можно поправить channel-level hard constraints и render template;
- references/style discovery/worker-profile onboarding больше не являются active product flow.

### Channel Manager -> Stage 2

Workspace defaults tab:

- hard constraints
- caption provider
- one-shot model
- one-shot prompt source: system/custom
- examples source: system/custom JSON

Channel tab:

- hard constraints
- optional channel prompt source:
  - workspace default
  - system preset
  - channel custom prompt
- optional channel examples source:
  - workspace default
  - system preset
  - channel custom JSON upload/paste
  - channel custom plain-text upload/paste
- note о том, что provider/model наследуются из workspace

## 6. Historical compatibility

Мы сохраняем compatibility на чтение, а не на исполнение.

Это означает:

- старые completed run-ы должны открываться и отображаться truthfully;
- trace/export для legacy payloads должен продолжать работать;
- старые worker profile ids могут резолвиться в historical context;
- но runtime больше не исполняет legacy/modular/vnext branches для новых run-ов.

## 7. Quick regenerate

Quick regenerate теперь следует тем же принципам, что и full run:

- video-first base context;
- weak comments hints only;
- hard constraints remain mandatory;
- no style directions;
- no exploration-mode steering;
- no selector-style examples-routing context;
- no editorial-memory steering.

Практически это значит:

- regenerate переписывает только visible shortlist;
- не поднимает старую multi-stage machinery;
- diagnostics должны показывать single-stage regenerate truth, а не fake modular lineage.

## 8. Persistence truth

Сейчас важно различать:

- active runtime authority
- historical persisted context

Примеры:

- `workspaces.stage2_caption_provider_json` = active authority
- `workspace_anthropic_integrations` / `workspace_openrouter_integrations` = active authority
- `channels.stage2_worker_profile_id` = historical compatibility field
- `channels.stage2_examples_config_json` = active optional channel examples input plus legacy compatibility wrapper
- `channels.stage2_style_profile_json` = historical compatibility field

## 9. Relevant files

Runtime:

- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage2-runner.ts`
- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/viral-shorts-worker/service.ts`
- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage2-quick-regenerate.ts`

Config and routing:

- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage2-worker-profile.ts`
- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage2-caption-provider.ts`
- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage2-codex-executor.ts`
- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/workspace-codex-models.ts`

Persistence and API:

- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/chat-history.ts`
- `/Users/neich/Documents/Macedonian Imperium/clips automations/app/api/channels/route.ts`
- `/Users/neich/Documents/Macedonian Imperium/clips automations/app/api/channels/[id]/route.ts`

UI:

- `/Users/neich/Documents/Macedonian Imperium/clips automations/app/components/ChannelManager.tsx`
- `/Users/neich/Documents/Macedonian Imperium/clips automations/app/components/ChannelManagerStage2Tab.tsx`
- `/Users/neich/Documents/Macedonian Imperium/clips automations/app/components/ChannelOnboardingWizard.tsx`

## 10. Non-goals right now

В Stage 2 сейчас **не** считается текущей продуктовой моделью:

- modular native path
- writer / critic / review loops
- stage family selector
- channel-learning steering
- selector-style examples corpus as active caption driver
- style discovery as active onboarding/runtime dependency
- editorial feedback as active adaptive pipeline promise

Если мы захотим снова усложнять Stage 2, это должно происходить уже поверх этого single-baseline мира и только с отдельно измеряемым quality uplift.
