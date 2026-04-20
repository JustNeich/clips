# Stage 2 Runtime

Этот документ описывает **текущую** Stage 2 архитектуру проекта. Он отражает упрощённую продуктовую модель и должен читаться как source of truth для разработчиков.

## 0. Workspace integrations and terminology

- `Shared Codex` = baseline workspace integration и текущий UI label для codex-backed runtime path.
- `Stage 2 caption provider` = workspace-level routing policy для eligible caption-writing stages: `codex`, `anthropic` или `openrouter`.
- `workspace integrations` = owner-managed readiness layer для Stage 2 runtime; run нельзя корректно описывать как purely per-user auth flow.
- Anthropic и OpenRouter сейчас являются caption-provider overlays, а не полной заменой Shared Codex: baseline Codex integration всё ещё обязательна для non-eligible Stage 2 stages и сопутствующих flows.

## 1. Что такое Stage 2 сейчас

Stage 2 больше не строится вокруг competitor-sync / hot-pool / profile-driven preset architecture.

Для `native_caption_v3` теперь существуют **два runtime path внутри одного внешнего контракта**:

### `stable_reference_v6` -> `reference_one_shot_v1`

Это production baseline line.

Его hot path:
1. `oneShotReference`
2. `captionHighlighting` (optional, fail-open)
3. `captionTranslation`
4. `seo`
5. `assemble`
6. human pick / review в UI

Ключевая идея:
- product-owned one-shot prompt получает video truth, current comment wave, line policy, channel narrative и editorial memory;
- channel initialization и reaction history работают как style/tone steering layers;
- visible facts по-прежнему имеют приоритет над history/bootstrap priors.
- one-shot обязан сам вернуть 5 финальных publishable options и 5 titles;
- deterministic pruning, repair и template backfill для этой line больше не участвуют в сборке shortlist;
- runtime может применить только очень узкий deterministic exact-length polish для near-miss overflow на финальных строках, если это не меняет angle и не превращается в repair loop;
- если one-shot ломает контракт, нарушает banned-content rules или выдаёт meta leakage, run завершается `failed`, а не silently деградирует;
- если one-shot промахивается только по length window, runtime сохраняет shortlist с warnings и не переводит весь run в `failed`.

### `stable_reference_v6_experimental` -> `reference_one_shot_v1_experimental`

Это изолированный экспериментальный baseline line для проверки контекст-first и anti-meta поведения без изменения production stable line.

Его hot path совпадает по форме:
1. `oneShotReference`
2. `captionHighlighting` (optional, fail-open)
3. `captionTranslation`
4. `seo`
5. `assemble`
6. human pick / review в UI

Но contract другой:
- использует отдельный product-owned prompt bundle и отдельный `pathVariant` в trace;
- усиливает роль `editorial_memory`, особенно active hard rules;
- при weak grounding ослабляет давление comment wave;
- fail-closed режет media-commentary / audience-commentary phrasing, а не только schema/debug leakage;
- усиливает same-line learning от matching-line signals по сравнению со stable.

### `stable_social_wave_v1` / `stable_skill_gap_v1` / `experimental` -> `modular_native_v1`

Это текущий modular native flow:
1. `contextPacket`
2. `candidateGenerator`
3. `hardValidator`
4. `qualityCourt`
5. `targetedRepair` (optional)
6. `templateBackfill` (optional)
7. `captionHighlighting` (optional, fail-open)
8. `captionTranslation`
9. `titleWriter`
10. `seo`
11. human pick / review в UI

Ключевой принцип:
- Stage 2 всегда использует **один effective examples corpus на run**
- prompt configuration хранится по stage
- для `native_caption_v3` поверх stage prompts теперь есть явная platform-line policy:
  - `stable_reference_v6` = production baseline
  - `stable_reference_v6_experimental` = isolated one-shot experiment for context-first anti-meta reference writing
  - `stable_social_wave_v1` = social/comment-wave line
  - `stable_skill_gap_v1` = competence-gap / skill-gap line
  - `experimental` = intentionally looser exploratory line
- examples по умолчанию выключены в `native_caption_v3` hot path
- RU translation display shortlist теперь входит в Stage 2 transaction
- SEO generation теперь тоже входит в Stage 2 transaction и возвращается в top-level `stage2.seo`
- deterministic validity и template backfill живут только в modular native path, а не в `stable_reference_v6`
- `pipeline.execution.pipelineVersion` остаётся `native_caption_v3` для compatibility
- trace / diagnostics дополнительно показывают `pipeline.execution.pathVariant`, чтобы baseline one-shot и modular native были различимы

### Native display contract

Для processable `native_caption_v3` run runtime теперь обязан:
- всегда вернуть `output.captionOptions.length === 5`;
- держать `output.captionOptions[].top` и `bottom` strictly English-only; русский допускается только в `topRu` / `bottomRu`;
- отдельно хранить цветовые подсветки в `output.captionOptions[].highlights`, не добавляя marker-синтаксис в сами строки;
- для `reference_one_shot_v1` возвращать 5 finalist-grade options без filler slots;
- для modular native держать `output.finalists` как finalist-grade subset, а не зеркало visible shortlist;
- всегда вернуть один valid `winner`, если в visible shortlist вообще есть хотя бы один constraint-valid option;
- modular native никогда не показывает hard-invalid / hard-rejected options;
- `reference_one_shot_v1` может сохранить length-window misses в visible shortlist как warnings для ручного review, но не fail-closed run только из-за этого;
- маркировать degraded path через payload/trace только там, где это реально разрешено архитектурой.

Текущая top-level truth model:
- `captionOptions` = ровно 5 displayed options;
- `finalists` = finalist-grade options; в `reference_one_shot_v1` это тот же publishable visible five;
- `winner` = в `reference_one_shot_v1` всегда приходит из `finalist`; в modular native может прийти из `finalist`, `recovery` или `template_backfill`;
- `finalPick.option` = slot winner-а внутри `captionOptions`;
- `seo` = top-level description + tags block, сгенерированный после title stage внутри того же Stage 2 run;
- durable run storage по-прежнему остаётся только `completed` / `failed`.

## 2. End-to-end flow

### Step 1

`/api/pipeline/source` ставит durable source job в очередь.

Source job:
- подготавливает чат/источник
- пытается загрузить комментарии
- сохраняет partial-success state, если комментарии недоступны
- при необходимости один раз auto-enqueue'ит Stage 2

### Step 2

`/api/pipeline/stage2` создаёт durable Stage 2 run.

Run lifecycle:
- request сохраняется в `stage2_runs`
- runtime поднимает queued job
- progress по шагам сохраняется в snapshot
- completed / failed result живут в persistent storage и переживают reload/navigation
- snapshot request дополнительно фиксирует `channel.templateHighlightProfile`, то есть resolved highlight-config активного channel template на момент enqueue

Run modes:
- `manual` / `auto` проходят полный line-aware pipeline:
  - `stable_reference_v6` -> `oneShotReference -> captionHighlighting? -> captionTranslation -> seo -> assemble`
  - `stable_reference_v6_experimental` -> `oneShotReference -> captionHighlighting? -> captionTranslation -> seo -> assemble`
  - остальные native lines -> `contextPacket -> candidateGenerator -> hardValidator -> qualityCourt -> targetedRepair? -> templateBackfill? -> captionHighlighting? -> captionTranslation -> titleWriter`
- `regenerate` для `native_caption_v3` по-прежнему работает как lightweight rewrite path и не переключает line family
- исторический quick regenerate для legacy/vnext payloads остаётся только для compatibility
- regenerate по-прежнему использует coarse progress steps `База -> Перегенерация -> Сборка`

Caption provider overlay:
- persisted workspace setting: `workspaces.stage2_caption_provider_json`
- baseline requirement:
  - Shared Codex integration должна быть `connected` для любого Stage 2 run, даже если caption provider = `anthropic` или `openrouter`
  - причина: non-eligible stages и общая Stage 2 orchestration по-прежнему живут на Codex path
- allowed values:
  - `provider: "codex"` -> все Stage 2 LLM stages идут через Shared Codex
  - `provider: "anthropic"` -> только `oneShotReference`, `candidateGenerator`, `targetedRepair` и `regenerate` идут через Anthropic Messages API
  - `provider: "openrouter"` -> только `oneShotReference`, `candidateGenerator`, `targetedRepair` и `regenerate` идут через OpenRouter Chat Completions API
- transport detail:
  - Anthropic models through OpenRouter не должны использовать `response_format.json_schema` для caption stages
  - причина: Anthropic-via-OpenRouter режет часть array keyword-ов (`minItems` / `maxItems`) в `output_config.format.schema`
  - runtime поэтому использует strict tool-calling transport с Anthropic beta header и downstream contract validation остаётся fail-closed на нашей стороне
- даже при `provider: "anthropic"` или `provider: "openrouter"` следующие stages остаются на Shared Codex:
  - `qualityCourt`
  - `captionTranslation`
  - `titleWriter`
  - `seo`
  - `styleDiscovery`
  - все Stage 3 agent / planner flows
- fail-closed rule:
  - если Anthropic/OpenRouter key, model или structured output невалидны, caption stage падает явно
  - runtime не делает silent fallback обратно на Codex
- resolved runtime shape:
  - `resolvedCodexModelConfig` хранит effective Codex-only model policy
  - `resolvedStageModelConfig` строится поверх него и подменяет eligible caption stages на Anthropic/OpenRouter model, если внешний provider активен
  - diagnostics / pipeline model summary должны смотреть на `resolvedStageModelConfig`, а не на старый Codex-only snapshot
- caption wire contract не меняется:
  - Stage 2 продолжает хранить только `top` / `bottom`
  - Stage 3 продолжает жить на `topText` / `bottomText`
  - `channel_story` family не вводит отдельный single-text payload: основной body остаётся в `bottomText`, а `topText` зависит от `leadMode`

Caption highlighting:
- optional pass запускается только если active workspace template имеет включённый `highlights.enabled` и хотя бы один enabled slot;
- input — финальные `captionOptions`, block scope `top` / `bottom` и resolved template highlight profile из snapshot request;
- stored output — только structured spans `captionOptions[].highlights.top[]` / `bottom[]` с `{ start, end, slotId }`;
- visible caption text не должен содержать marker-синтаксис или служебные кавычки;
- ручная правка текста в Stage 3 должна сохранять все spans вне реально изменённого участка строки; нельзя очищать весь block из-за одного символа;
- если model возвращает phrase-level annotations, server normalization обязан сопоставить их с финальным текстом и сохранить exact char spans;
- overlap rule: сортировать по `start ASC`, затем длинный span первым, оставить первый non-overlapping span и отбросить конфликтующие;
- pass fail-open: invalid response, mismatch или runtime error дают empty highlights для блока и не валят весь Stage 2 run.

Основной runtime entry:
- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage2-runner.ts`

Pipeline orchestration:
- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/viral-shorts-worker/service.ts`

Durable store:
- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage2-progress-store.ts`
- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage2-run-runtime.ts`

## 2.1 Source context quality inputs

Analyzer больше не работает от фиксированных 3 still frames.

Текущая модель:
- используется adaptive frame sampling с bounded coverage по длине клипа;
- transcript, если доступен, передаётся в `videoContext` и идёт в analyzer/selector как supporting context;
- comments используются как vibe/context layer, но не заменяют visual truth;
- если comments недоступны, run не ломается, но diagnostics и warnings должны честно показывать no-comments fallback.

Практический смысл:
- analyzer читает клип как короткую последовательность, а не как одну freeze-frame;
- no-comments runs не должны притворяться, что у нас есть реальный audience consensus;
- selector и downstream stages получают более truthful source context.
- если comments дают сильный shorthand pressure, runtime теперь старается не только понять его в analyzer, но и протащить хотя бы один clean comment-native lane в visible shortlist.

## 3. Examples corpus resolution

### Workspace default corpus

Workspace owner редактирует общий default corpus в `Channel Manager -> Default settings`.

Stored source of truth:
- `workspaces.stage2_examples_corpus_json`

Seed source:
- `data/examples.json` используется только для bootstrap/seed нового workspace
- live runtime больше не читает repo file как runtime source of truth

### Channel-level corpus

Для конкретного канала UI показывает **одно editable поле** `Examples corpus JSON`.

Поведение:
- если канал ещё использует workspace default, поле изначально заполнено workspace corpus
- если оператор редактирует JSON, канал начинает использовать свою версию corpus
- если содержимое снова совпадает с workspace default, канал считается вернувшимся к default behavior

Таким образом:
- у канала всегда один effective corpus
- UI не заставляет оператора мыслить через `useWorkspaceDefault + customExamples`
- runtime всё равно хранит совместимую внутреннюю config-модель

Основной код:
- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage2-channel-config.ts`
- `/Users/neich/Documents/Macedonian Imperium/clips automations/app/components/ChannelManager.tsx`

## 4. Prompt model

Prompt configuration задаётся **по stage**, а не через vague guidance.

Для текущего Stage 2 теперь всегда нужно мыслить в двух routing layers:

1. `caption provider routing`
   - решает, останутся ли eligible caption-writing stages на Shared Codex или уйдут на Anthropic/OpenRouter
2. `Codex model routing`
   - задаёт per-stage model policy для Codex-backed stages
   - при `provider = anthropic` или `provider = openrouter` Codex selections для eligible stages сохраняются как dormant config и снова становятся active после возврата на `codex`

Дополнительно для native hot path существует явный line selector:
- persisted field: `channels.stage2_worker_profile_id`
- runtime snapshot: `stage2_runs.request_json.channel.stage2WorkerProfileId`
- trace export: `stage2.causalInputs.workerProfile`
- trace/runtime metadata: `pipeline.execution.pathVariant`
- UI:
  - `Channel onboarding -> Базовая настройка Stage 2 -> Формат pipeline`
  - `Channel manager -> Stage 2 -> Формат pipeline`

Смысл:
- channel learning задаёт мягкий channel prior;
- platform line задаёт production family policy для style card / lane plan / judging boundary;
- эти два слоя не должны подменять друг друга.
- `stable_reference_v6` и `stable_reference_v6_experimental` используют product-owned one-shot prompts и **не** редактируются через workspace stage prompts;
- остальные native lines продолжают жить на stage-configurable modular prompt stack.

Workspace owner редактирует defaults в `Default settings`:
- default prompt
- default thinking / reasoning effort
- hard constraints
- caption provider policy
- per-stage Codex model policy

Эти defaults живут на workspace уровне:
- `workspaces.stage2_prompt_config_json`
- `workspaces.stage2_hard_constraints_json`
- `workspaces.stage2_caption_provider_json`
- `workspaces.workspace_codex_model_config_json`

Anthropic/OpenRouter integrations живут отдельно от prompt/model defaults:
- tables `workspace_anthropic_integrations`, `workspace_openrouter_integrations`
- keys хранятся зашифрованно через `lib/app-crypto.ts`
- UI surface: `Channel Manager -> Общие настройки -> Caption provider`
- возврат на `provider = codex` не удаляет внешний key: Anthropic/OpenRouter integration остаётся подключённой, но inactive, пока owner явно не нажмёт `Отключить ... key`
- disconnect Anthropic/OpenRouter now fail-safe сразу демотит workspace caption provider обратно на `codex`, даже если локальный UI autosave был прерван
- setup links:
  - [API keys](https://platform.claude.com/settings/keys)
  - [Billing](https://platform.claude.com/settings/billing)
  - [Pricing](https://docs.anthropic.com/en/docs/about-claude/pricing)
  - [OpenRouter API keys](https://openrouter.ai/settings/keys)
  - [OpenRouter Credits](https://openrouter.ai/settings/credits/)
  - [OpenRouter Pricing](https://openrouter.ai/pricing)

Отдельно для `stable_reference_v6` теперь есть workspace-only control surface:
- `Default settings -> Stage 2 model routing -> Stable Reference v6`
- там можно выбрать только `model` и `reasoning effort` для `oneShotReference`
- prompt text для этого baseline остаётся product-owned и не редактируется через UI

Runtime resolution:
- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage2-codex-executor.ts` поднимает baseline Shared Codex integration и, при необходимости, Anthropic/OpenRouter executor
- `HybridJsonStageExecutor` маршрутизирует только eligible caption stages во внешний provider, а всё остальное оставляет на Codex executor
- если provider = `anthropic` или `provider = openrouter`, Stage 2 worker получает внешний model как effective model только для eligible stages; `reasoningEffort` на этих stages больше не идёт из Codex policy

Channel-level prompt editing больше не является primary runtime path.

Основной код:
- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage2-pipeline.ts`
- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage2-prompt-specs.ts`
- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/viral-shorts-worker/prompts.ts`

## 4.2 Channel onboarding and learning layer

Поверх текущей Stage 2 architecture добавлен отдельный channel bootstrap + learning layer.

Новый create flow:
- `+ New Channel` теперь открывает guided wizard, а не создаёт канал сразу в old manager flow;
- wizard проходит 4 шага: basics -> Stage 2 base -> references -> style picks;
- editor сначала добавляет 10+ reference links;
- затем отдельный LLM pass генерирует около 20 dynamic style directions;
- editor может выбрать много направлений как initial prior, вплоть до почти всего пула.

Важно:
- references влияют на proposal space;
- references не определяют final identity автоматически;
- discovery должен расширять релевантное style space, а не отзеркаливать 20 раз один и тот же surface narrative;
- human choice остаётся source of truth для стартового channel flavor.

Поведение wizard:
- completed / unlocked steps остаются кликабельными;
- переход между шагами не запускает analysis/regeneration автоматически;
- если reference links изменены после discovery, старый pool помечается как stale и сохраняется до явной пересборки;
- финальное создание канала не допускается со stale style pool.
- close/open панели не сбрасывает wizard draft;
- reload страницы поднимает тот же draft из scoped `localStorage`;
- активный style discovery re-attach'ится по сохранённому `runId`, а не запускается заново скрытым сайд-эффектом navigation.

После onboarding тот же learning layer доступен и в Channel Manager:
- редактор канала может менять reference links;
- может явно перегенерировать style directions;
- может менять selected directions и exploration share;
- manager использует тот же `style-discovery` durable run contract и тот же `fresh / stale` semantics.

Основной код:
- `/Users/neich/Documents/Macedonian Imperium/clips automations/app/components/ChannelOnboardingWizard.tsx`
- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage2-style-discovery.ts`
- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/channel-style-discovery-runtime.ts`
- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/channel-style-discovery-store.ts`
- `/Users/neich/Documents/Macedonian Imperium/clips automations/docs/stage2-channel-learning.md`

## 4.3 Ongoing editorial learning

После onboarding канал получает lightweight feedback loop:
- явный `лайк` / `дизлайк` по whole option;
- явный `лайк` / `дизлайк` только по `TOP`;
- явный `лайк` / `дизлайк` только по `BOTTOM`;
- optional note
- explicit option selection также может сохраняться как soft positive signal

Feedback события сохраняются отдельно и собираются в bounded rolling memory:
- сильнее всего влияют только последние ~30 явных rating events;
- passive `selected_option` signals учитываются отдельно и слабее;
- внутри окна более новые реакции важнее старых;
- exploration share сохраняется, чтобы Stage 2 не схлопывался в один repetitive mode.

Дополнительно для platform lines теперь действует `same-line-first` resolution:
- если run знает свой `stage2WorkerProfileId`, runtime сначала берёт feedback из run'ов этой же line;
- pinned `hard_rule` notes всегда остаются активными;
- channel-wide fallback примешивается только если same-line explicit signal недостаточно;
- passive selections могут дополнять memory, но не доминируют над explicit ratings;
- query/debug surfaces могут запросить тот же slice через `stage2WorkerProfileId`, чтобы UI видел ту же editorial memory, что и runtime.

UI truth model:
- user-facing history показывает только явные ratings;
- `selected_option` не показывается в истории;
- после `Save` feedback фиксируется даже без note, а composer скрывается сразу.
- explicit reactions можно удалить; после удаления runtime пересобирает `editorialMemory` из оставшихся событий.

Ключевые runtime объекты:
- `stage2StyleProfile`
- `editorialMemory`
- `editorialMemorySource`

`stage2StyleProfile` после нового bootstrap теперь может нести не только selected directions, но и компактные bootstrap summaries:
- `audiencePortrait`
- `packagingPortrait`
- `bootstrapDiagnostics`

Смысл:
- comments остаются главным сигналом audience taste;
- sampled reference frames остаются главным сигналом packaging style;
- runtime видит эти summaries как soft prior, а не как жёсткий preset.
- downstream stages не должны терять dominant audience shorthand, если он clip-safe и реально sharpen'ит bottom.

Основной код:
- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage2-channel-learning.ts`
- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/channel-editorial-feedback-store.ts`
- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage2-editorial-memory-resolution.ts`

## 5. Selector contract

Selector stage должен:
- выбрать primary / secondary angles
- выбрать релевантные examples из available corpus
- вернуть editorial target для writer
- указать failure modes

Selector prompt собирается из:
- channel info
- hard constraints
- analyzer output
- compact source context
- curated selector candidate pool

### Active corpus vs selector candidate pool

Stage 2 может иметь большой active corpus, но selector не получает весь corpus raw.

Текущая модель:
- `activeCorpusCount` = полный effective corpus на run
- `selectorCandidateCount` = curated subset, который реально уходит в selector prompt
- selector candidate pool режется по signal quality и cap-ится по размеру, чтобы не раздувать prompt и не засорять selection noisy examples
- diagnostics panel и trace export теперь явно показывают оба числа

Важно:
- selector по-прежнему остаётся editorial LLM stage
- это не старый retrieval architecture return
- curated pool нужен только как truthful runtime boundary между corpus hygiene и selector prompt size

### Retrieval confidence and examples mode

Curated pool теперь не считается автоматически “семантически релевантным” только потому, что в нём есть top-ranked entries.

Runtime явно вычисляет:
- `retrievalConfidence = high | medium | low`
- `examplesMode = domain_guided | form_guided | style_guided`
- explanation / warning / evidence для выбранного режима

Смысл режимов:
- `domain_guided`: pool реально достаточно domain-near; examples могут помогать с framing, trigger logic, structure и tone
- `form_guided`: thematic overlap слабее; examples используются в основном для top/bottom construction, pacing, narrator rhythm и compression
- `style_guided`: retrieval слабый или generic; clip truth + channel learning становятся primary driver, а examples остаются weak support only

Важно:
- слабый retrieval больше не маскируется под сильный;
- diagnostics и trace показывают, когда examples были только structural help;
- selector / writer / critic получают этот mode как часть prompt context и должны вести себя по-разному в mature-market и cold-start случаях.

### Order of influence in cold-start runs

Когда `examplesMode = style_guided`, intended order of influence такой:
1. actual clip truth
2. bootstrap channel style directions
3. rolling editorial memory
4. retrieval examples
5. generic fallback examples

Это правило существует специально, чтобы новый market/topic не тянулся за weak neighboring examples и не начинал уверенно заимствовать чужую семантику.

Downstream stages используют selector output напрямую:
- writer
- critic
- rewriter
- final selector
- titles

### Prompt compaction for channel learning

Channel learning остаётся частью runtime truth, но prompts больше не должны нести полный дамп всех selected style cards.

Текущая модель:
- editor по-прежнему может выбрать много или все style directions;
- runtime не превращает их в равновесный wall of cards;
- prompt layer собирает compact guidance layer:
  - `selectionSummary`
  - counts по `core / adjacent / exploratory`
  - weighted direction highlights
  - distilled bootstrap lessons
  - compact editorial-memory summary

Важно:
- writer / critic / rewriter получают `compact` learning payload;
- analyzer / final selector / titles получают ещё более `minimal` версию;
- это уменьшает prompt size без отката bootstrap prior / editorial memory logic.

Практический смысл:
- selected directions влияют на run даже при выборе “почти всего”;
- но prompt не раздувается из-за передачи всех full cards с одинаковым весом;
- `core` обычно имеют больший runtime weight, а `exploratory` сохраняют controlled presence вместо полного исчезновения.
- literal historical text cues больше не прокидываются в prompts как общий lexical prior; иначе прошлые phrasing-wins начинают загрязнять новые clip families.
- editorial memory теперь разделяет обычные последние `30` явных реакций и pinned `hard_rule` notes: hard rules не выпадают автоматически и отдельно попадают в prompt context.

### Prompt philosophy after alignment pass

Текущий prompt stack должен быть одновременно:
- comments-aware;
- retrieval-mode-aware;
- channel-learning-aware;
- cold-start honest;
- менее robotic и менее templated по bottom continuation logic.

Ключевые правила по стадиям:
- `analyzer` должен жёстко заполнять `why_viewer_cares` и `best_bottom_energy`, а при mixed comments разносить аудиторию по lane'ам (`consensus`, `joke`, `dissent`, `suspicion`) вместо одного flat vibe sentence;
- `analyzer` и runtime comment-intelligence должны поднимать dominant audience shorthand из high-like comments: acronyms, nicknames и compact punchlines вроде `SADF` / `god pack` не должны размазываться в generic paraphrase, если они clip-safe и реально ведут audience read;
- `selector` должен переводить это в operational `writerBrief`, а не в vague editorial advice;
- `writer` должен держать batch variety по bottom openings и tail functions и не скатываться в stock continuations вроде `the reaction basically writes itself`;
- `critic` должен резать polished-but-interchangeable bottoms даже если они формально валидны;
- `rewriter` должен агрессивно убирать fragments, generic tails и не “улучшать” линию до безличной гладкости;
- `final selector` должен смотреть на реальное feel-diversity visible five, используя `style_direction_ids`, `exploration_mode` и batch sameness signals, а не только angle labels.
- при high comment pressure shortlist assembly и final selector дополнительно учитывают `comment carry`:
  - насколько candidate использует dominant audience cues;
  - не проигрывает ли human-native line просто потому, что generic line безопаснее;
  - есть ли в visible five хотя бы один сильный comment-native alternate, когда quality close.

Важно:
- comments можно адаптировать как lived-in language;
- comments нельзя clumsy-copy'ить в BOTTOM как pasted meme text;
- channel learning должен влиять на voice, но не превращаться в жёсткий preset cage.

### Retrieval hygiene expectations

Selector candidate pool должен быть чище, чем полный corpus:
- weak/noisy examples с плохим overlay signal downrank-ятся или выпадают;
- richer metadata (`clipType`, `whyItWorks`, `qualityScore`) используется как quality signal;
- generic `clipType=general` examples не должны доминировать, если есть более релевантные metadata-rich matches;
- diagnostics должны показывать и active corpus, и curated selector pool, чтобы оператор видел реальный runtime boundary.

## 6. Native shortlist contract

Для `native_caption_v3` финальный public contract теперь строится не вокруг “5 finalists”, а вокруг **5 displayed options** с явным tiering.

Display assembly order:
1. `finalists`
2. `displaySafeExtras`
3. `recovery`
4. `template_backfill`

Ключевые правила:
- `hardValidator` режет только objective invalidity: length windows, banned words/openers, empty fields, meta leakage, malformed shape;
- `qualityCourt` делает editorial choice и может вернуть только `finalists`, `displaySafeExtras`, `hardRejected`, `winnerCandidateId`, `recoveryPlan`;
- hard-rejected candidates не могут вернуться в visible shortlist;
- soft rejects могут жить как `displaySafeExtras`, но не должны silently считаться “best five”;
- если у клипа есть benign public handle и есть хотя бы один safe candidate, хотя бы один finalist обязан его сохранить;
- если finalists/recovery collapse, runtime fail-open заполняет visible five через recovery/backfill и помечает результат как degraded.

Required invariants для processable completed native run:
- `output.captionOptions.length === 5`
- каждый displayed option проходит `constraintCheck.passed === true`
- каждый displayed option уже несёт `topRu` и `bottomRu` внутри основного run
- `output.finalists.length` находится в диапазоне `0..3`
- `output.winner` всегда существует и всегда указывает на option внутри `captionOptions`
- `output.finalPick.option === output.winner.option`
- `output.winner.displayTier !== "finalist"` означает `output.pipeline.nativeCaptionV3.guardSummary.degradedSuccess === true`
- `output.captionOptions[n]` всегда несёт `displayTier`, `sourceStage`, `displayReason`, `constraintCheck`
- `output.titleOptions.length === 5` и каждый item уже несёт `titleRu`

`displaySafeExtras` intentionally не являются winner-grade.
Если winner не может прийти из finalists или recovery, runtime обязан зарезервировать visible slot под `template_backfill`, а не silently повышать extra до winner.

Trace truth для native path теперь включает:
- `validPoolCount`
- `finalistCount`
- `displaySafeExtraCount`
- `recoveryCount`
- `templateBackfillCount`
- `displayShortlistCount`
- `winnerTier`
- `degradedSuccess`
- `dominantHarmlessHandle`
- `audienceHandlePreservedInFinalists`
- `recoveryTriggered`
- `recoveryReason`
- `captionTranslation.coverage`
- `titleWriter.translationCoverage`
- per-option `displayTier` / `displayReason`

Downstream consumers должны читать `captionOptions` как единственный visible shortlist.
`finalists` остаётся editorial subset для UI/trace/explainability, а не source of truth для Stage 3 handoff, publishing fallback, или trace export.

### Comments acquisition truthfulness

`commentsExtractionFallbackUsed` сам по себе оказался слишком грубым diagnostic flag.

Теперь source/debug surfaces дополнительно несут:
- `commentsAcquisitionStatus = primary_success | fallback_success | unavailable`
- `commentsAcquisitionProvider`
- `commentsAcquisitionNote`

Как это читать:
- `primary_success`: comments path сработал напрямую;
- `fallback_success`: основной provider не сработал, но резервный path успешно вернул комментарии;
- `unavailable`: комментарии реально недоступны, even if video / metadata path survived.

Это нужно, чтобы:
- successful fallback не выглядел как partial failure;
- отсутствие комментариев не путалось с нормальным degraded-but-working fallback;
- trace честно показывал, comments ли реально участвовали в run.

## 7. Progress and durability

Progress truth lives in backend state, not in component memory.

What survives refresh/navigation:
- queued / running / completed / failed
- active stage id
- per-stage status / state
- per-stage `startedAt` / `finishedAt`
- per-stage concise `summary`
- per-stage full `detail`
- final result
- failure payload

UI reconnect logic:
- Step 1 reconnects to active source job
- Step 2 reconnects to preferred active/current run
- chat switching should not require refresh to see live progress

### Stage 2 progress snapshot contract

Each step in `progress.steps` is expected to carry:
- `status`
- `state`
- `startedAt`
- `finishedAt`
- `summary`
- `detail`

Notes:
- `status` and `state` are intentionally kept in sync. `state` exists for backward compatibility with older UI paths, while `status` makes the lifecycle easier to inspect in traces and exports.
- `completedAt` is still kept as a compatibility alias, but `finishedAt` should be treated as the primary timestamp for a finished step.
- old stored snapshots are normalized on read so legacy runs still render truthfully in UI and trace export.

## 8. Active runtime contract

Stage 2 run request intentionally carries only the runtime fields that Stage 2 actually uses:
- source url
- user instruction
- mode
- channel id / name / username
- channel stage2 examples config
- effective hard constraints snapshot
- channel bootstrap style profile snapshot
- rolling editorial memory summary

### Quick regenerate alignment

`regenerate` остаётся single-stage shortcut, но больше не должен жить по отдельной старой prompt-философии.

Сейчас quick regenerate:
- видит retrieval context и channel-learning summary из base run;
- сохраняет `styleDirectionIds` и `explorationMode` у visible options;
- использует те же anti-generic guardrails, что и full pipeline:
  - без stock tails;
  - без broken fragments;
  - без схлопывания visible five в один bottom rhythm.

Legacy fields such as channel-level worker profile ids or channel-level prompt config must not be treated as active runtime authority for the simplified Stage 2 model.

Эти новые learning fields не заменяют examples corpus / hard constraints / prompt-config.
Они являются отдельным soft-preference layer, который:
- помогает selector / writer / critic держать channel continuity;
- остаётся адаптивным во времени;
- всё равно сохраняет примерно 20-30% exploratory option space.

## 9. Stage 2 -> Stage 3 handoff

The current handoff model is:
- Stage 2 persists the shortlist and final pick
- chat draft persists only:
  - selected caption option
  - selected title option
  - Stage 3 overrides relative to the current defaults

This means:
- `topText` / `bottomText` stay `null` in draft until the operator or Stage 3 actually diverges from the current default caption-derived text
- Stage 3 can still hydrate deterministically from:
  1. draft overrides
  2. latest saved Stage 3 version
  3. selected Stage 2 caption

### Final caption editing lives in Step 3

Step 2 is still the place to:
- compare options
- choose the preferred caption option
- choose the title option

TOP guidance defaults:
- `TOP` is a contextual hook and compressed setup, not a screenshot-style inventory of the paused frame.
- Stage 2 prefers lines that land the why-care clause early while staying visually defensible.
- For reveal-driven clips the default policy is `hint, don't fully spoil`: `TOP` should frame the normal read plus the tension or misread, without fully narrating the payoff unless that clearly improves the hook.
- During shortlist assembly Stage 2 now applies soft penalties, not hard drops, to descriptive `TOP` anti-patterns such as comma-chained object lists, beat-by-beat camera-log narration, and hooks that arrive only in the final third of the line.
- For simple social beats, Stage 2 also prefers plain spoken or comment-native phrasing over synthetic editorial English. Invented pseudo-slang or abstract summary phrasing is treated as a quality negative even when the candidate is otherwise structurally valid.

Step 3 is now the official place to:
- manually edit final `TOP` / `BOTTOM`
- mix `TOP` from one Stage 2 option with `BOTTOM` from another
- reset back to the currently selected Stage 2 option

Important behavior:
- while the operator has not manually changed the text, Step 3 may auto-inherit the selected Stage 2 caption
- once the operator changes the text in Step 3, that text becomes the active render draft and must not be silently overwritten by later selection changes
- `take all` from a Stage 2 option re-establishes that option as the current default source
- `take TOP` / `take BOTTOM` are treated as explicit Stage 3 text overrides

The shared helper for this contract lives in:
- `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage2-stage3-handoff.ts`

Trace export uses the same helper to explain:
- which caption/title option is currently selected
- what the default selection is
- whether Stage 3 text comes from a draft override, latest version, or selected caption
- whether the current editor state can be reset back to the selected Stage 2 caption

## 10. Debugging incomplete or failed runs

When a run looks suspicious:
1. Inspect the durable run in `stage2_runs`.
2. Check `progress.status`, `activeStageId`, and each step's `status/finishedAt/summary/detail`.
3. Compare `pipeline.finalSelector.shortlistStats.visibleCount` with:
   - `output.captionOptions.length`
   - `pipeline.finalSelector.candidateOptionMap.length`
   - `pipeline.finalSelector.shortlistCandidateIds.length`
4. For native runs also verify:
   - every `output.captionOptions[n]` already has `topRu/bottomRu`
   - every `output.titleOptions[n]` already has `titleRu`
   - `stage2.nativeCaptionV3.captionTranslation.coverage` truthfully records retry/fallback
5. If any visible-count invariant is not `5`, treat the run as contract-broken.
   Successful runs must not persist a reduced visible shortlist anymore.
6. Use clip trace export to verify:
   - selected run id
   - canonical causal inputs in `stage2.causalInputs`
   - per-stage manifests in `stage2.stageManifests`
   - resolved pipeline mode / worker build / feature flag state in `stage2.execution`
   - active corpus vs selector prompt pool in `stage2.examplesRuntimeUsage`
   - canonical final-selector outcome in `stage2.outcome`
   - canonical vNext audit data in `stage2.vnext`
   - `stage2.outcome.topSignalSummary` when debugging weak or overly descriptive `TOP` behavior
   - explicit export truncation in `stage2.exportOmissions`
   - Stage 2 -> Stage 3 handoff summary

### Trace export contract

For forensic debugging, treat these sections as canonical:
- `stage2.causalInputs`
- `stage2.stageManifests`
- `stage2.execution`
- `stage2.outcome`
- `stage2.vnext`
- `stage2.vnext.stageOutputs`
- `comments.runtimeUsage`
- `stage2.examplesRuntimeUsage`

These sections answer:
- what exact channel snapshot and learning state shaped the run;
- what each prompt stage actually received;
- which worker build handled the run and whether vNext was actually enabled there;
- what the final selector really evaluated and picked;
- what the vNext clip-truth packet, audience packet, critic gate, lineage, counters, and validation actually recorded;
- whether comments/examples were runtime-truncated or only export-truncated.

Worker rollout behavior is fail-closed:
- `processStage2Run` now aborts the run if `stage2.execution.pipelineVersion !== "native_caption_v3"`;
- the worker also aborts if `stage2.execution.stageChainVersion` still contains transitional bridge naming;
- the worker also aborts if `stage2.vnext` is missing canonical runtime sections (`exampleRouting`, `canonicalCounters`, `validation`, `candidateLineage`, `criticGate`);
- the worker also aborts if canonical trace stage outputs are incomplete (`clipTruthExtractor`, `audienceMiner`) or if `compatibilityMode !== "none"`;
- weak-example leakage or any non-zero `reserveBackfillCount` is treated as rollout failure, not as a silent legacy fallback.

Convenience mirrors still remain in the trace:
- `stage2.currentResult`
- `stage2.analysis`
- `stage2.selection`
- `stage2.examples`
- `stage2.effectivePrompting`
- `thread.events[*].data`

Those mirrors are useful for raw inspection, but the canonical sections above are the source of truth for audits.

### Comments-specific debugging

Если comments отсутствуют:
- `warnings[]` должен содержать явное объяснение no-comments fallback;
- `diagnostics.analysis.commentVibe` должен быть сформулирован truthfully, а не как fake crowd consensus;
- trace export должен сохранять `analysis`, чтобы было видно `revealMoment`, `lateClipChange`, `sceneBeats`, `uncertaintyNotes`.

When comments do exist, trace export now distinguishes:
- total extracted comments;
- comments available to runtime after prompt-prep filtering via `stage2.causalInputs.sourceContext.runtimeCommentsAvailable`;
- analyzer comment subset;
- selector comment subset;
- comments exported into the trace file;
- export truncation vs runtime truncation.

Speech grounding is also explicit in trace export:
- `stage2.causalInputs.sourceContext.transcriptChars > 0` means transcript grounding is present;
- otherwise `stage2.causalInputs.sourceContext.speechGroundingStatus` explains whether speech was absent (`no_speech_detected`) or simply unavailable (`speech_uncertain`).

## 11. Related files

- API:
  - `/Users/neich/Documents/Macedonian Imperium/clips automations/app/api/pipeline/source/route.ts`
  - `/Users/neich/Documents/Macedonian Imperium/clips automations/app/api/pipeline/stage2/route.ts`
  - `/Users/neich/Documents/Macedonian Imperium/clips automations/app/api/workspace/route.ts`
- UI:
  - `/Users/neich/Documents/Macedonian Imperium/clips automations/app/page.tsx`
  - `/Users/neich/Documents/Macedonian Imperium/clips automations/app/components/Step1PasteLink.tsx`
  - `/Users/neich/Documents/Macedonian Imperium/clips automations/app/components/Step2PickCaption.tsx`
  - `/Users/neich/Documents/Macedonian Imperium/clips automations/app/components/ChannelManager.tsx`
- Stores / orchestration:
  - `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/source-job-store.ts`
  - `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/source-job-runtime.ts`
  - `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage2-progress-store.ts`
  - `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage2-stage3-handoff.ts`
  - `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage2-run-runtime.ts`
  - `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage2-runner.ts`
  - `/Users/neich/Documents/Macedonian Imperium/clips automations/lib/viral-shorts-worker/service.ts`
