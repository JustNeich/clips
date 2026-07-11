# Project Kings autonomous source refill

Статус: реализован как отдельный bounded contour и подготовлен ежедневный
LaunchAgent. Установка по умолчанию является dry-run, `--install` только пишет
plist, а загрузка launchd требует отдельного `--arm`. Production daemon в рамках
этой подготовки не включался и live upload не запускался.

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

Для ограниченного bootstrap допускается приватный hash-bound каталог через
`PROJECT_KINGS_SOURCE_REFILL_CATALOG_PATH`. Файл обязан иметь mode `0600`,
содержать только canonical URL и точные разрешённые пары provider/route/donor.
При наличии этой настройки CLI использует каталог как единственный discovery
provider; catalog SHA входит в request identity. Это временный способ наполнить
конкретный дефицит, а не бесконечный источник: перед recurring arm надо
подтвердить запас для всех дефицитных профилей либо убрать настройку и вернуться
к обычному discovery.

Runtime не принимает список donors из env или CLI. Donors и YouTube permission читаются только из frozen source policy.

## Семантические gates

`source_policy` и `source_fit` получают selection из одного schema-v2 route manifest. Если manifest отсутствует, повреждён, legacy или не содержит обе роли, refiller останавливается до discovery/model call.

Policy использует один заранее утверждённый owner approval на точную version/hash политики. Ручного approval для каждого кандидата нет. Каждый кандидат всё равно получает собственные hash-bound provenance, sensitive assessment, policy verdict и Source Fit attestation.

## Режимы

- `dry_run`: читает runtime и создаёт план в ledger; discovery, download, модели и upload не вызываются.
- `shadow`: выполняет полный contour до готового qualification evidence, но не вызывает upload.
- `execute`: дополнительно вызывает idempotent source-buffer upload. Нужны одновременно `--allow-upload` и `PROJECT_KINGS_SOURCE_REFILL_UPLOAD_ARMED=1`.

Первый production execute 11 июля 2026 года завершился честным `partial`:
Dark пополнен до 12, Cop получил один qualified source, Light остался на 2.
Текущий bootstrap-каталог добавлен именно для закрытия дефицита Light/Cop;
ни один catalog candidate не минует decode, OCR/ASR, dedupe, policy или
Source Fit. Daemon/launchd при этом остаётся disarmed до завершения live 3×3.

## Restart safety

Локальный ledger хранится атомарным JSON с mode `0600`. Каждый request,
candidate и весь ledger имеют проверяемые SHA-256. Повтор того же
`workspace + logicalDate + mode + manifest + runtime snapshot` возвращает
существующий request. Для временного каталога к identity добавляется его SHA,
поэтому новый точный каталог не сливается со старым terminal request;
отсутствующий/null scope сохраняет прежнюю identity без drift. Уже завершённые
`qualified_shadow`/`uploaded` кандидаты не запускаются повторно; повтор POST
после crash безопасен благодаря idempotent server import по URL/content/event
binding.

Ledger запрещает credential-like поля. Секреты, session/access tokens и cookies остаются только в приватном machine env и не входят в health/result/evidence. Числовые метрики `inputTokens`, `cachedInputTokens`, `outputTokens` и `reasoningOutputTokens` не являются credentials: для каждого вызова `source_policy` и `source_fit` ledger сохраняет модель, reasoning, route, attempt, duration, token counts, вычисленную стоимость, outcome и hash prompt/output. Стоимость берётся из frozen Codex rate card, а для новой модели без локальной rate card — из того же benchmark snapshot с явной пометкой `benchmark_mean`.

## Daily LaunchAgent

LaunchAgent запускает one-shot supervisor ежедневно в 04:10 по локальному
времени Zoro и один раз сразу после явного arm. `KeepAlive` не используется.
Supervisor:

- при `PROJECT_KINGS_AUTONOMOUS_REFILL_ARMED!=1` завершает работу без сети,
  моделей, download и upload;
- допускает не более одного процесса через PID/nonce lock и безопасно убирает
  lock только после подтверждённого завершения владельца;
- требует Node 22, Codex CLI не ниже `0.144.1`, активный login,
  `CODEX_HOME` и точный route manifest v4;
- для `execute` дополнительно требует независимый
  `PROJECT_KINGS_SOURCE_REFILL_UPLOAD_ARMED=1`;
- пишет ledger, lock и `last-launchd-run.json` в стабильный private state dir,
  stdout/stderr — в отдельный `~/Library/Logs/...` каталог;
- сохраняет plist backup при replace/uninstall; rollback восстанавливает backup,
  но оставляет unit выгруженным до нового `--arm`.

Переход с исторического frozen-catalog runner выполняется тем же launchd label:
`--arm` сначала делает `bootout` старого unit и только затем `bootstrap` нового
ежедневного one-shot plist.

## Код и проверки

- orchestration: `lib/project-kings/source-refill-contour.ts`;
- adapters: `lib/project-kings/source-refill-adapters.ts`;
- durable ledger: `lib/project-kings/source-refill-ledger.ts`;
- reusable Source Fit runner: `lib/project-kings/source-fit-assessment-runner.ts`;
- one-shot CLI: `scripts/run-project-kings-autonomous-source-refill.mts`;
- launchd supervisor: `scripts/run-project-kings-autonomous-source-refill-launchd.mjs`;
- installer/arm/uninstall/rollback: `scripts/install-project-kings-source-buffer-refiller-launchd.mjs`;
- tests: `tests/project-kings-autonomous-source-refill.test.ts`.
