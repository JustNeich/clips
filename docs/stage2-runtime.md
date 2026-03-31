# Stage 2 Runtime

Этот документ описывает **текущую** Stage 2 архитектуру проекта. Он отражает упрощённую продуктовую модель и должен читаться как source of truth для разработчиков.

## 1. Что такое Stage 2 сейчас

Stage 2 больше не является one-shot prompt и больше не строится вокруг competitor-sync / hot-pool / profile-driven preset architecture.

Текущий pipeline:

1. `analyzer`
2. `selector`
3. `writer`
4. `critic`
5. `rewriter`
6. `final selector`
7. `titles`
8. human pick в UI
9. optional `seo` call после готового shortlist

Ключевой принцип:
- Stage 2 всегда использует **один effective examples corpus на run**
- prompt configuration хранится по stage
- selector является **LLM-driven editorial stage**, а не deterministic classifier

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

Run modes:
- `manual` / `auto` проходят полный multi-stage pipeline
- `regenerate` использует уже сохранённый successful run как base run и делает один быстрый LLM pass только по visible options
- быстрый regenerate не притворяется полным pipeline: у него отдельные progress steps `База -> Перегенерация -> Сборка`

Основной runtime entry:
- `/Users/neich/dev/clips automations/lib/stage2-runner.ts`

Pipeline orchestration:
- `/Users/neich/dev/clips automations/lib/viral-shorts-worker/service.ts`

Durable store:
- `/Users/neich/dev/clips automations/lib/stage2-progress-store.ts`
- `/Users/neich/dev/clips automations/lib/stage2-run-runtime.ts`

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
- `/Users/neich/dev/clips automations/lib/stage2-channel-config.ts`
- `/Users/neich/dev/clips automations/app/components/ChannelManager.tsx`

## 4. Prompt model

Prompt configuration задаётся **по stage**, а не через vague guidance.

Workspace owner редактирует defaults в `Default settings`:
- default prompt
- default thinking / reasoning effort
- hard constraints

Эти defaults живут на workspace уровне:
- `workspaces.stage2_prompt_config_json`
- `workspaces.stage2_hard_constraints_json`

Channel-level prompt editing больше не является primary runtime path.

Основной код:
- `/Users/neich/dev/clips automations/lib/stage2-pipeline.ts`
- `/Users/neich/dev/clips automations/lib/stage2-prompt-specs.ts`
- `/Users/neich/dev/clips automations/lib/viral-shorts-worker/prompts.ts`

## 4.1 Channel onboarding and learning layer

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
- `/Users/neich/dev/clips automations/app/components/ChannelOnboardingWizard.tsx`
- `/Users/neich/dev/clips automations/lib/stage2-style-discovery.ts`
- `/Users/neich/dev/clips automations/lib/channel-style-discovery-runtime.ts`
- `/Users/neich/dev/clips automations/lib/channel-style-discovery-store.ts`
- `/Users/neich/dev/clips automations/docs/stage2-channel-learning.md`

## 4.2 Ongoing editorial learning

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

UI truth model:
- user-facing history показывает только явные ratings;
- `selected_option` не показывается в истории;
- после `Save` feedback фиксируется даже без note, а composer скрывается сразу.
- explicit reactions можно удалить; после удаления runtime пересобирает `editorialMemory` из оставшихся событий.

Ключевые runtime объекты:
- `stage2StyleProfile`
- `editorialMemory`

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
- `/Users/neich/dev/clips automations/lib/stage2-channel-learning.ts`
- `/Users/neich/dev/clips automations/lib/channel-editorial-feedback-store.ts`

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

## 6. Final shortlist contract

Финальный shortlist в success-path всегда должен содержать **ровно 5 visible options**.

Текущая политика:
- final selector просит 5 strongest finalists
- затем shortlist проходит constraint-safe repair и hard-constraint validation
- если publishable пятёрка не собирается даже после deterministic backfill/reserve fill, run **не считается successful** и падает явно

Required invariants для completed run:
- `output.captionOptions.length === 5`
- `output.pipeline.finalSelector.candidateOptionMap.length === 5`
- `output.pipeline.finalSelector.shortlistCandidateIds.length === 5`
- `output.pipeline.finalSelector.finalPickCandidateId` входит в visible shortlist
- `progress.finalSelector.summary/detail` совпадают с persisted shortlist
- `rationaleInternalRaw` описывает ту же visible shortlist, что видит оператор
- `rationaleInternalModelRaw` не должен противоречить persisted shortlist; если raw model prose устарел после shortlist repair, он sanitiz'ится в shortlist-consistent text

Дополнительно после prompt-alignment pass:
- final visible five должны различаться по реальному feel, а не только по angle label;
- при близком качестве в shortlist желательно сохранять хотя бы один credible exploratory alternate;
- strongest aligned lane не должен пропадать из visible set просто потому, что пять кандидатов звучат “чисто” одинаково.
- repaired line с generic tail не должна выигрывать final pick у cleaner visible alternative;
- runtime repair не должен спасать broken reporting-verb endings вроде `... says.` / `... means.` через generic padding.

То есть `Shortlist 2` / `Shortlist 3` / `Shortlist empty` больше не являются допустимым successful outcome.

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
- `/Users/neich/dev/clips automations/lib/stage2-stage3-handoff.ts`

Trace export uses the same helper to explain:
- which caption/title option is currently selected
- what the default selection is
- whether Stage 3 text comes from a draft override, latest version, or selected caption
- whether the current editor state can be reset back to the selected Stage 2 caption

## 10. Debugging incomplete or failed runs

When a run looks suspicious:
1. Inspect the durable run in `stage2_runs`.
2. Check `progress.status`, `activeStageId`, and each step's `status/finishedAt/summary/detail`.
3. Compare `output.finalPick.reason` with `pipeline.finalSelector.rationaleRaw`.
   The first is operator-facing and must refer only to visible options.
4. Compare `pipeline.finalSelector.shortlistStats.visibleCount` with:
   - `output.captionOptions.length`
   - `pipeline.finalSelector.candidateOptionMap.length`
   - `pipeline.finalSelector.shortlistCandidateIds.length`
5. If any of those values is not `5`, treat the run as contract-broken.
   Successful runs must not persist a reduced visible shortlist anymore.
6. Use clip trace export to verify:
   - selected run id
   - canonical causal inputs in `stage2.causalInputs`
   - per-stage manifests in `stage2.stageManifests`
   - active corpus vs selector prompt pool in `stage2.examplesRuntimeUsage`
   - canonical final-selector outcome in `stage2.outcome`
   - `stage2.outcome.topSignalSummary` when debugging weak or overly descriptive `TOP` behavior
   - explicit export truncation in `stage2.exportOmissions`
   - Stage 2 -> Stage 3 handoff summary

### Trace export contract

For forensic debugging, treat these sections as canonical:
- `stage2.causalInputs`
- `stage2.stageManifests`
- `stage2.outcome`
- `comments.runtimeUsage`
- `stage2.examplesRuntimeUsage`

These sections answer:
- what exact channel snapshot and learning state shaped the run;
- what each prompt stage actually received;
- what the final selector really evaluated and picked;
- whether comments/examples were runtime-truncated or only export-truncated.

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
- comments available to runtime after prompt-prep filtering;
- analyzer comment subset;
- selector comment subset;
- comments exported into the trace file;
- export truncation vs runtime truncation.

## 11. Related files

- API:
  - `/Users/neich/dev/clips automations/app/api/pipeline/source/route.ts`
  - `/Users/neich/dev/clips automations/app/api/pipeline/stage2/route.ts`
  - `/Users/neich/dev/clips automations/app/api/workspace/route.ts`
- UI:
  - `/Users/neich/dev/clips automations/app/page.tsx`
  - `/Users/neich/dev/clips automations/app/components/Step1PasteLink.tsx`
  - `/Users/neich/dev/clips automations/app/components/Step2PickCaption.tsx`
  - `/Users/neich/dev/clips automations/app/components/ChannelManager.tsx`
- Stores / orchestration:
  - `/Users/neich/dev/clips automations/lib/source-job-store.ts`
  - `/Users/neich/dev/clips automations/lib/source-job-runtime.ts`
  - `/Users/neich/dev/clips automations/lib/stage2-progress-store.ts`
  - `/Users/neich/dev/clips automations/lib/stage2-stage3-handoff.ts`
  - `/Users/neich/dev/clips automations/lib/stage2-run-runtime.ts`
  - `/Users/neich/dev/clips automations/lib/stage2-runner.ts`
  - `/Users/neich/dev/clips automations/lib/viral-shorts-worker/service.ts`
