# Project Kings: постоянный runtime

## Что является источником истины

Production-база остаётся только на Render. Zoro/Mac mini не открывает локальный
`APP_DATA_DIR` и не исполняет production pipeline напрямую.

Постоянный процесс на Zoro делает один ограниченный по времени server tick:

`launchd → remote daemon client → POST /api/admin/control → production DB → background runtime`

Для запроса используется machine credential из
`~/.config/assistant/clips-mcp.env`. Это замена интерактивному website login,
а не копирование cookies. Токен не хранится в plist, аргументах процесса,
state-файле или логах.

## Один heartbeat

Owner-команда `clips_owner_tick_portfolio_daemon` выполняет на Render:

1. Захватывает или продлевает singleton lease
   `project-kings-portfolio-v1` в таблице `production_daemon_runtime`.
2. Проверяет hash неизменившейся конфигурации: ровно три profile ID, режим,
   timezone, цель `3`, publication policy и canary policy.
3. Вычисляет logical date в timezone профиля.
4. До создания нового daily run выполняет profile preflight. Buffer/worker/
   template blocker записывается в heartbeat без создания terminal run, поэтому
   после исправления следующий tick всё ещё может начать этот logical date.
5. Находит или idempotently создаёт один run с ключом
   `project-kings-portfolio-v1:<mode>:<YYYY-MM-DD>`.
6. Возобновляет только runs с теми же тремя profile ID.
7. Захватывает отдельный dispatch lease. Пока текущий проход ждёт semantic или
   другой долгий этап, server продлевает оба lease; повторный запрос получает
   `portfolio_dispatch_busy`, а не начинает второй проход.
8. Передаёт точные daemon token, dispatch token и config hash внутреннему
   background runtime. Claim, renew, acknowledge и retry каждой outbox-записи
   повторно проверяют весь fence в production DB.
9. Записывает heartbeat, active run IDs, статус и blocker в ту же production DB.

Второй daemon до истечения lease получает `standby` и не может dispatch-ить
работу. После crash новый процесс продолжает с durable run/outbox state; он не
создаёт второй run за ту же logical date.

Команда `clips_owner_release_portfolio_daemon` сначала прекращает новый
dispatch и переводит владение pilot-каналами в `releasing`. Если осталась
активная работа, она отвечает `stopping`: новые intents уже запрещены, но run и
публикации не удаляются. После durable drain повторный release переводит
владение в `released` и освобождает lease.

## Fail-closed правила

- Live mode работает только при server-side
  `PORTFOLIO_PIPELINE_V1_ENABLED=1`.
- Live `canaryPolicy=none` дополнительно требует отдельный server-side
  `PORTFOLIO_PIPELINE_POST_CANARY_ENABLED=1`. Клиентский input сам не может
  включить этот допуск.
- Конфигурация daemon не может выбрать другой daemon ID и тем самым обойти
  singleton.
- Изменение profile IDs/mode/timezone под действующим token закрывает lease
  path до controlled restart/takeover.
- Run с preflight blocker, включая source buffer меньше `6`, остаётся
  `blocked`; повторный heartbeat не переименовывает его в ready/running.
- Истёкший или чужой lease token не останавливает runtime нового владельца.
- Next instrumentation больше не поднимает portfolio pipeline сам при старте.
  Повторный запуск после Render restart приходит от authenticated daemon tick.

## Исполнение моделей — отдельная граница

`CLIPS_MCP_TOKEN` авторизует Zoro в owner control API. Он не авторизует
семантические модели. Render не запускает Codex CLI и не проверяет workspace
`CODEX_HOME`: он создаёт hash-bound `production-semantic` Stage 3 job и ждёт
durable result. Отдельный semantic-only worker на Zoro проверяет собственный
локальный login и точный frozen route manifest до того, как объявит себя ready.

Повтор outbox после timeout повторно использует тот же in-flight или уже
completed Stage 3 job по immutable `invocationKey`; успешный model call не
запускается заново. Если worker не online/ready, profile preflight блокирует
только запуск, не пытается автоматически входить через браузер, переносить
cookies или ослаблять quality gates.

## Zoro config

Machine credential:

`~/.config/assistant/clips-mcp.env` (`0600`):

```env
CLIPS_APP_URL=https://clips-vy11.onrender.com
CLIPS_MCP_TOKEN=<machine credential>
```

Daemon config:

`~/.config/assistant/project-kings-portfolio.env` (`0600`):

```env
CLIPS_MCP_ENV_FILE=/Users/neichyabazhi/.config/assistant/clips-mcp.env
PROJECT_KINGS_PORTFOLIO_ARMED=0
PROJECT_KINGS_PORTFOLIO_MODE=shadow
PROJECT_KINGS_PORTFOLIO_CANARY_POLICY=none
PROJECT_KINGS_PORTFOLIO_PROFILE_IDS=<dark-profile-id>,<light-profile-id>,<cop-profile-id>
PROJECT_KINGS_PORTFOLIO_TIMEZONE=Europe/Moscow
PROJECT_KINGS_PORTFOLIO_POLL_INTERVAL_MS=30000
PROJECT_KINGS_PORTFOLIO_HTTP_TIMEOUT_MS=900000
PROJECT_KINGS_PORTFOLIO_BLOCKED_BACKOFF_MS=300000
PROJECT_KINGS_PORTFOLIO_STATE_DIR=/Users/neichyabazhi/Library/Application Support/com.zoro.clips-project-kings-portfolio
PROJECT_KINGS_PORTFOLIO_KILL_SWITCH_PATH=/Users/neichyabazhi/Library/Application Support/com.zoro.clips-project-kings-portfolio/DISABLED
```

Свежий daemon с `ARMED=0` не делает API-вызовов. Если действующий лидер
переключён в disarmed, он сначала один раз best-effort освобождает in-memory
lease. Kill-switch всегда имеет приоритет и делает ноль удалённых вызовов;
lease сам безопасно истекает. Live требует одновременно `ARMED=1`, `MODE=live`
и включённый server-side flag.

## launchd

Шаблон хранится в
`support/launchd/com.zoro.clips-project-kings-portfolio.plist.tmpl`.
Installer по умолчанию работает как dry-run. `--install` создаёт
content-addressed копию daemon runtime и plist, привязанный к точным hash
runtime и config; он не вызывает `launchctl` и не активирует сервис.

```bash
npm run project-kings:launchd:plan
npm run project-kings:launchd:install
```

Первая команда ничего не записывает. Вторая только устанавливает plist. Его
осознанная активация остаётся отдельным owner-действием после shadow gates.

В этой реализации launchd не загружался и production deploy не выполнялся.

Server lease token живёт только в памяти процесса. При штатном SIGTERM/SIGINT
daemon best-effort освобождает его; после hard crash новый процесс ждёт не более
90 секунд до безопасного takeover. Health JSON остаётся приватным (`0600`) и
дополнительно отвергает любые поля с token/secret/credential.

## Что ещё не доказано

Persistent runtime закрывает restart, singleton и machine-auth contour, но не
является доказательством полной приёмки Project Kings Pipeline v1.

- По умолчанию live использует immutable
  `first_item_per_channel_public_verified`: два оставшихся items каждого канала
  ждут публичного подтверждения canary именно этого канала. Controlled policy `none` входит в manifest,
  idempotency и daemon config; только при отдельном server flag она одной
  транзакцией резервирует источники и создаёт девять `source_ingest` intents.
  Этот быстрый путь покрыт replay/idempotency-тестами, но ещё не проходил live
  canary на production.
- Source refiller остаётся отдельным background-контуром. Daemon честно
  блокирует запуск при buffer `< 6`, но сам не пополняет источники.
- Plist подготовлен, но не установлен/не загружен; live 3×3 этим изменением не
  запускался.
