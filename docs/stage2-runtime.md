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

Основной runtime entry:
- `/Users/neich/dev/clips automations/lib/stage2-runner.ts`

Pipeline orchestration:
- `/Users/neich/dev/clips automations/lib/viral-shorts-worker/service.ts`

Durable store:
- `/Users/neich/dev/clips automations/lib/stage2-progress-store.ts`
- `/Users/neich/dev/clips automations/lib/stage2-run-runtime.ts`

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
- available examples corpus

Downstream stages используют selector output напрямую:
- writer
- critic
- rewriter
- final selector
- titles

## 6. Progress and durability

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

## 7. Active runtime contract

Stage 2 run request intentionally carries only the runtime fields that Stage 2 actually uses:
- source url
- user instruction
- mode
- channel id / name / username
- channel stage2 examples config
- effective hard constraints snapshot

Legacy fields such as channel-level worker profile ids or channel-level prompt config must not be treated as active runtime authority for the simplified Stage 2 model.

## 8. Stage 2 -> Stage 3 handoff

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

## 9. Debugging incomplete or failed runs

When a run looks suspicious:
1. Inspect the durable run in `stage2_runs`.
2. Check `progress.status`, `activeStageId`, and each step's `status/finishedAt/summary/detail`.
3. Compare `output.finalPick.reason` with `pipeline.finalSelector.rationaleRaw`.
   The first is operator-facing and must refer to visible options.
   The second may still contain internal candidate ids for debugging.
4. Use clip trace export to verify:
   - selected run id
   - selected examples
   - effective prompts
   - Stage 2 -> Stage 3 handoff summary

## 10. Related files

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
