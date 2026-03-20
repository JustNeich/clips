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

Downstream stages используют selector output напрямую:
- writer
- critic
- rewriter
- final selector
- titles

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

То есть `Shortlist 2` / `Shortlist 3` / `Shortlist empty` больше не являются допустимым successful outcome.

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

Legacy fields such as channel-level worker profile ids or channel-level prompt config must not be treated as active runtime authority for the simplified Stage 2 model.

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
   - analyzer read (`analysis`)
   - active corpus vs selector candidate pool
   - selected examples
   - effective prompts
   - Stage 2 -> Stage 3 handoff summary

### Comments-specific debugging

Если comments отсутствуют:
- `warnings[]` должен содержать явное объяснение no-comments fallback;
- `diagnostics.analysis.commentVibe` должен быть сформулирован truthfully, а не как fake crowd consensus;
- trace export должен сохранять `analysis`, чтобы было видно `revealMoment`, `lateClipChange`, `sceneBeats`, `uncertaintyNotes`.

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
