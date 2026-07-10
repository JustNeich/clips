# Project Kings autonomous source refill

Статус: реализован как отдельный bounded contour; production daemon не включён и live upload не запускался.

## Что заменено

Основная команда source refiller больше не синхронизирует старый frozen readiness JSON. Она строит новый запрос только если готовых источников меньше 6, стремится довести буфер до 12 и прекращает работу после 9 кандидатов на канал.

Порядок:

`runtime inventory → discovery → download → full decode → OCR/ASR → content/event dedupe → source_policy → source_fit → shadow result или upload`

Три канала обрабатываются параллельно. Внутри одного профиля Instagram discovery и обработка кандидатов идут последовательно, поэтому один профиль не создаёт конкурирующие Instagram-запросы.

## Источники и fallback

1. Instagram public ephemeral session.
2. Если публичный download получил auth/transient blocker и явно настроен CDP origin — owner Clips/CDP fallback.
3. YouTube Ask доступен только для профиля, где frozen source policy разрешает `youtube_ask_v3` (сейчас THE LIGHT KINGDOM).
4. Reserve provider может быть подключён через типизированный provider interface.

Runtime не принимает список donors из env или CLI. Donors и YouTube permission читаются только из frozen source policy.

## Семантические gates

`source_policy` и `source_fit` получают selection из одного schema-v2 route manifest. Если manifest отсутствует, повреждён, legacy или не содержит обе роли, refiller останавливается до discovery/model call.

Policy использует один заранее утверждённый owner approval на точную version/hash политики. Ручного approval для каждого кандидата нет. Каждый кандидат всё равно получает собственные hash-bound provenance, sensitive assessment, policy verdict и Source Fit attestation.

## Режимы

- `dry_run`: читает runtime и создаёт план в ledger; discovery, download, модели и upload не вызываются.
- `shadow`: выполняет полный contour до готового qualification evidence, но не вызывает upload.
- `execute`: дополнительно вызывает idempotent source-buffer upload. Нужны одновременно `--allow-upload` и `PROJECT_KINGS_SOURCE_REFILL_UPLOAD_ARMED=1`.

В этой реализации execute не запускался, daemon/launchd не менялся и production state не мутировался.

## Restart safety

Локальный ledger хранится атомарным JSON с mode `0600`. Каждый request, candidate и весь ledger имеют проверяемые SHA-256. Повтор того же `workspace + logicalDate + mode + manifest + runtime snapshot` возвращает существующий request. Уже завершённые `qualified_shadow`/`uploaded` кандидаты не запускаются повторно; повтор POST после crash безопасен благодаря idempotent server import по URL/content/event binding.

Ledger запрещает credential-like поля. Секреты, session/access tokens и cookies остаются только в приватном machine env и не входят в health/result/evidence. Числовые метрики `inputTokens`, `cachedInputTokens`, `outputTokens` и `reasoningOutputTokens` не являются credentials: для каждого вызова `source_policy` и `source_fit` ledger сохраняет модель, reasoning, route, attempt, duration, token counts, вычисленную стоимость, outcome и hash prompt/output. Стоимость берётся из frozen Codex rate card, а для новой модели без локальной rate card — из того же benchmark snapshot с явной пометкой `benchmark_mean`.

## Код и проверки

- orchestration: `lib/project-kings/source-refill-contour.ts`;
- adapters: `lib/project-kings/source-refill-adapters.ts`;
- durable ledger: `lib/project-kings/source-refill-ledger.ts`;
- reusable Source Fit runner: `lib/project-kings/source-fit-assessment-runner.ts`;
- one-shot CLI: `scripts/run-project-kings-autonomous-source-refill.mts`;
- tests: `tests/project-kings-autonomous-source-refill.test.ts`.
