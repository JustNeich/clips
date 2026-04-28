# Stage 2 Runtime

Этот документ описывает **актуальную** Stage 2 архитектуру проекта после single-baseline cleanup.

Если текст в другом месте противоречит этому файлу, источником истины считается этот документ.

## 0. Коротко

- Active Stage 2 path теперь **prompt-first**: `native_caption_v3` выбирает один из двух изолированных one-shot routes по формату шаблона.
- Единственный product baseline profile: `stable_reference_v7`.
- Старые ids вроде `stable_reference_v6`, `stable_reference_v6_experimental`, `stable_social_wave_v1`, `stable_skill_gap_v1`, `experimental` оставлены только для historical read-compat.
- Active prompt contract стал raw-block based:
  - `source_video_json`
  - `examples_json` со всеми active examples в сохранённом порядке
  - `format_contract_json`
  - `hard_constraints_json`
  - `user_instruction`
- Runtime больше не выбирает, не ранжирует, не скорит и не суммаризирует examples для новых full runs.
- Если prompt-first payload превышает preflight/context limit, run падает видимо: diagnostics/error содержат examples count, prompt chars, stage и model.
- Multi-stage native flow, old examples-routing selector loops, style discovery и editorial-memory steering больше не являются active runtime authority.

## 1. Runtime truth

### Единственный active path

Для новых Stage 2 full run-ов используется один из двух route ids:

1. `classicOneShot` для `classic_top_bottom`
2. `storyOneShot` для `story_lead_main_caption`
3. `captionHighlighting` optional, fail-open
4. `captionTranslation`
5. `seo`
6. `assemble`

Legacy `oneShotReference` остаётся только для старых/compatibility paths и regenerate context compatibility; новые full runs его не используют.

Старый общий путь:

1. `oneShotReference`
2. `captionHighlighting` optional, fail-open
3. `captionTranslation`
4. `seo`
5. `assemble`

считается legacy-compatible, не active full-run truth.

Quick regenerate остаётся отдельным run mode, но живёт в той же модели:

1. берёт сохранённый video-first base context
2. переписывает только visible shortlist
3. не запускает selector/writer/critic loops
4. не использует channel-learning steering

### Canonical identity

- active profile id: `stable_reference_v7`
- active execution path variants: `classic_one_shot_v1`, `story_one_shot_v1`

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
- old selector/writer examples-routing payloads
- lane plans
- selector fallback context

Active prompt contract:

- `source_video_json`
  title, description, transcript, extracted frame descriptions, acquired comments, and basic deterministic video facts seed
- `examples_json`
  все examples из resolved active source: channel custom when enabled, otherwise workspace default
- `format_contract_json`
  selected format pipeline, provider stage id, expected output shape, template/render metadata, and Stage 2 -> Stage 3 handoff field names
- `hard_constraints_json`
  видимые пользовательские/шаблонные ограничения как данные для prompt-а
- `user_instruction`
  ручная правка оператора

Запрещено в новом prompt-first full-run path:

- `examples_guidance_json`
- prompt pool / per-source limits
- `selectedExampleIds`
- semantic/form/weak guidance labels
- role summaries
- runtime bridge, объясняющий модели, как именно examples должны влиять

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

Active external routing теперь узко ограничен caption-writing one-shots:

- `classicOneShot`
- `storyOneShot`
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
- `workspace_codex_model_config_json` для `classicOneShot` / `storyOneShot` / `regenerate`
- `stage2_examples_corpus_json` как default examples source для каналов без custom corpus
- default editable prompts для `classicOneShot` и `storyOneShot`
- default hard constraints

### Channel-level active authority

На уровне канала Stage 2 active authority:

- render template format group: `classic_top_bottom` выбирает `classicOneShot`, `channel_story` выбирает `storyOneShot`
- `stage2HardConstraints`
- `stage2PromptConfig` для channel-specific prompt overrides
- `stage2ExamplesConfig`: если `useWorkspaceDefault=false`, все custom examples становятся active source
- render template отдельно в Channel Manager / Stage 3 surfaces

Channel больше **не** должен активно управлять:

- worker profile
- style discovery
- stage2 style profile
- editorial memory
- hidden prompt family mixing между classic/story lines

`stage2ExamplesConfig` больше не является bounded retrieval pool: resolved active source целиком попадает в `examples_json`.

### Parse-tolerant legacy fields

Следующие поля могут по-прежнему существовать в persisted JSON/DB ради compatibility, но runtime не возвращает им старую authority:

- `stage2WorkerProfileId`
- `stage2ExamplesConfig` — legacy shape retained, but active semantics are all-or-workspace-default examples source
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
- one-shot model fallback
- default prompts for `classicOneShot` and `storyOneShot`
- examples source: system preset or custom workspace JSON corpus

Channel tab:

- template type selector: `Top / Bottom` или `Lead / Main Caption`
- active prompt contract only: `classicOneShot` для `Top / Bottom`, `storyOneShot` для `Lead / Main Caption`
- hard constraints
- channel prompt overrides
- channel examples source: workspace default, system preset, custom JSON, or custom plain text

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
- no examples-routing context;
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
- `channels.stage2_examples_config_json` = historical compatibility field
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
- examples corpus as active caption driver
- style discovery as active onboarding/runtime dependency
- editorial feedback as active adaptive pipeline promise

Если мы захотим снова усложнять Stage 2, это должно происходить уже поверх этого single-baseline мира и только с отдельно измеряемым quality uplift.
