# Stage 3 Local Worker Rollout

Этот документ описывает, что нужно сделать владельцу проекта и конечным пользователям, чтобы Stage 3 preview/render/agent-media offload работал предсказуемо и не убивал web service на Render.

Важно: теперь production execution mode живёт на двух уровнях:

- env задаёт capability gates и seed default для новых workspace
- owner в `Channel Manager -> Общие настройки -> Рендер` выбирает workspace default `Локальный executor` или `Хостинг`

Если workspace сохранён на `Хостинг`, но `STAGE3_ALLOW_HOST_EXECUTION=0`, UI покажет честный fallback в `Локальный executor`, а новые heavy jobs пойдут локально.

## Что уже реализовано

- Хост работает только как control plane для Stage 3 heavy work:
  - auth
  - queue/jobs
  - artifacts
  - Codex orchestration
- Тяжелые Stage 3 job kinds идут в локальный worker:
  - `preview`
  - `render`
  - `source-download`
  - `agent-media-step`
- Основной пользовательский runtime теперь отдельное desktop-приложение `Clips Worker`:
  - tray app
  - status window
  - autostart worker loop after pairing through the same Node 22 CLI runtime used by the terminal fallback
  - reconnect/retry
  - logs in worker home
  - pairing через `clips-stage3-worker://pair?...`
- Worker поддерживает:
  - `macOS arm64/x64`
  - `Windows x64`
- Pairing и worker status доступны прямо из Stage 3 UI.
- Local executor is personal-by-default: compatible worker может claim-ить только jobs своего `userId` внутри workspace. Worker другого редактора не считается готовностью текущего пользователя и не забирает его jobs.
- CLI worker остался совместимым advanced fallback для localhost, диагностики и ручной поддержки.

## Что должен сделать владелец проекта

### 1. Включить workspace-level выбор execution mode

Проверьте, что в Render заданы:

- `STAGE3_DEFAULT_EXECUTION_TARGET=local`
- `STAGE3_ALLOW_HOST_EXECUTION=1`
- `STAGE2_MAX_CONCURRENT_RUNS=1`
- `SOURCE_MAX_CONCURRENT_JOBS=1`
- `CHANNEL_STYLE_DISCOVERY_MAX_CONCURRENT_RUNS=1`
- `HOSTED_CPU_CONCURRENCY_LIMIT=1`
- `HOSTED_SUBPROCESS_MAX_CONCURRENT=1`
- `STAGE3_HOST_MAX_CONCURRENT_JOBS=1`
- `STAGE3_HOSTED_HEAVY_JOB_MAX_CONCURRENT=1`

На Render-инстансе с 1 CPU эти лимиты должны оставаться равными `1`: Stage 2, source download,
hosted preview/render и вспомогательные subprocess-задачи конкурируют за один и тот же CPU-бюджет.
Увеличивать их можно только после фактического апгрейда CPU и повторной проверки очередей.
- `STAGE3_WORKER_PAIRING_TTL_SEC=600`
- `STAGE3_WORKER_SESSION_TTL_SEC=2592000`
- `PUBLIC_APP_ORIGIN=https://ваш-домен` при необходимости

`PUBLIC_APP_ORIGIN` нужен только если прокси/рантайм подставляет во внутренние запросы адрес вида `0.0.0.0` вместо публичного домена.

Эти значения уже добавлены в [render.yaml](/Users/neich/Documents/Macedonian Imperium/clips automations/render.yaml), но их нужно реально задеплоить.

После деплоя owner должен дополнительно проверить workspace default:

1. Открыть `Каналы` -> `Общие настройки`.
2. Перейти во вкладку `Рендер`.
3. Убедиться, что в `Stage 3 execution mode` доступны оба режима: `Локальный executor` и `Хостинг`.
4. Оставить `Локальный executor` как default или переключить workspace на `Хостинг`, если тяжёлые Stage 3 задачи должны идти на мощность Render.

### 2. Задеплоить новую версию хоста

Нужен новый deploy, потому что production должен начать:

- возвращать `desktopDeepLink` из `/api/stage3/workers/pairing`
- отдавать bootstrap scripts:
  - `/stage3-worker/bootstrap.sh`
  - `/stage3-worker/bootstrap.ps1`
- отдавать bundled worker:
  - `/stage3-worker/clips-stage3-worker.cjs`
  - `/stage3-worker/package.json`
- отдавать managed tool manifest:
  - `/stage3-worker/tool-manifest.json`
- разрешать публичный доступ к bootstrap assets
- принимать worker auth / heartbeat / claim / complete / fail
- фильтровать `/api/stage3/workers` по текущему пользователю, а не показывать общий workspace pool

### 3. Собрать и раздать Clips Worker

V1 распространяется вручную внутри команды. Signing/notarization secrets в этой версии не нужны.

1. Собрать worker bundle:

```bash
npm run build:stage3-worker
```

2. Собрать desktop shell:

```bash
npm run build:desktop-worker
```

3. Собрать unsigned artifacts:

```bash
npm run dist:desktop-worker
```

4. Забрать `.dmg` / `.exe` из `output/desktop-worker`.
5. Раздать нужный artifact пользователям вручную.

Installer-файлы и содержимое `output/desktop-worker` не коммитятся.

### 4. Проверить production после деплоя

Минимальный smoke checklist для local mode:

1. Войти в приложение.
2. Открыть Step 3.
3. Нажать `Подключить executor`.
4. Убедиться, что появилась кнопка `Открыть Clips Worker`.
5. Нажать `Открыть Clips Worker`.
6. Разрешить браузеру открыть desktop app.
7. Убедиться, что Clips Worker сохранил pairing и запустил loop.
8. Дождаться статуса `Online` в Step 3.
9. Изменить `clip start` или `music gain` и убедиться, что preview уходит в queue/running и возвращается.
10. Нажать `Render` и убедиться, что job проходит через `queued -> running -> completed`.
11. Проверить, что assigned worker принадлежит текущему пользователю, а не другому редактору workspace.

Smoke checklist для personal routing:

1. Открыть Step 3 под пользователем A и подключить Clips Worker A.
2. Открыть Step 3 под пользователем B без worker.
3. Убедиться, что B не видит workspace как `Online` из-за worker A.
4. Создать preview/render job под B и убедиться, что worker A не claim-ит её.
5. Подключить Clips Worker B и убедиться, что job B выполняется именно worker B.

Если smoke делается через CLI fallback:

1. Открыть Stage 3.
2. Нажать `Подключить executor`.
3. Открыть advanced Terminal/PowerShell fallback.
4. Скопировать команду.
5. Запустить worker на локальной машине.
6. Дождаться статуса `Online`.

Если smoke делается для hosted режима:

1. В `Общие настройки -> Рендер` переключить `Stage 3 execution mode` на `Хостинг`.
2. Открыть Step 3 под редактором.
3. Убедиться, что pairing/executor CTA исчезли и UI явно пишет, что heavy Stage 3 задачи идут на хостинге.
4. Проверить `preview` и `render` в hosted path.

### 5. Подготовить поддержку пользователей

Основной пользовательский текст:

- Установите `Clips Worker`.
- Откройте Stage 3.
- Нажмите `Подключить executor`.
- Нажмите `Открыть Clips Worker`.
- Если браузер спросит подтверждение, разрешите открыть приложение.
- Дальше держите приложение запущенным в tray/menu bar.

Managed tools:

- `Clips Worker` проверяет `ffmpeg`, `ffprobe`, `yt-dlp` до claim jobs.
- Если `/stage3-worker/tool-manifest.json` содержит pinned downloads для платформы, worker скачивает tools в worker app-data/cache и проверяет `sha256`.
- Если manifest пустой или platform не настроена, worker использует уже установленные системные tools.
- Если download/doctor падает, worker не claim-ит jobs и показывает конкретную причину в UI/logs.
- Browser остаётся через существующий Remotion-managed fallback: локальный Chrome/Edge желателен, но при отсутствии worker готовит Remotion Headless Shell.
- Desktop shell сам не выполняет heavy render внутри Electron. После pairing он находит локальный Node.js 22+, синхронизирует общий Stage 3 runtime в worker home и запускает его отдельным child process. Если Node.js 22+ не найден, app показывает конкретную ошибку и не claim-ит jobs.

Legacy install hints, если manifest пока не заполнен:

- Node.js: установить текущий LTS с `nodejs.org`, затем полностью перезапустить `Clips Worker`
- macOS: `brew install ffmpeg yt-dlp`
- Windows: `winget install Gyan.FFmpeg yt-dlp.yt-dlp`

## Что должен сделать пользователь

### Основной путь: Clips Worker

1. Установить `Clips Worker` для своей платформы.
2. Убедиться, что установлен Node.js 22+.
3. Открыть Stage 3.
4. Нажать `Подключить executor`.
5. Нажать `Открыть Clips Worker`.
6. Подтвердить открытие приложения по deep link.
7. Дождаться:
   - pairing
   - managed tool setup / doctor
   - worker loop
   - статуса `Online` в браузере.
8. Оставить Clips Worker запущенным, пока используются preview/render/source-download/agent-media-step.

Если Clips Worker запущен без pairing, он показывает: `Open Stage 3 and click Open Clips Worker`.

### Advanced fallback: macOS / Terminal

1. Открыть Stage 3.
2. Нажать `Подключить executor`.
3. Открыть advanced Terminal/PowerShell fallback.
4. Скопировать macOS command.
5. Вставить её в Terminal.
6. Дождаться pairing, doctor и запуска worker loop.
7. Оставить Terminal открытым.

### Advanced fallback: Windows / PowerShell

1. Открыть Stage 3.
2. Нажать `Подключить executor`.
3. Открыть advanced Terminal/PowerShell fallback.
4. Скопировать Windows PowerShell command.
5. Вставить её в PowerShell.
6. Дождаться pairing, doctor и запуска worker loop.
7. Оставить PowerShell открытым.

Если после запуска fallback-команды в PowerShell долго не появляется ни одной строки:

1. Подождать 10-15 секунд: новая команда теперь должна сразу печатать `Downloading Stage 3 bootstrap...` и `Running Stage 3 bootstrap...`.
2. Если тишина сохраняется, попросить редактора запустить ту же команду в обычном `Windows PowerShell`, а не в терминале IDE.
3. Если bootstrap уже стартовал и упал позже, лог лежит в `%LOCALAPPDATA%\\Clips Stage3 Worker\\logs\\bootstrap-*.log`.
4. Для поддержки нужен либо текст из окна PowerShell, либо последний `bootstrap-*.log`.

На старом Windows PowerShell причиной зависания часто был `Invoke-WebRequest` без `-UseBasicParsing`; bootstrap теперь принудительно использует basic parsing и пишет шаги установки в лог.
Новая Windows/macOS bootstrap-команда также сначала тянет уже собранный runtime archive с вашего приложения, поэтому ограниченный интернет у редактора больше не должен ломать установку на шаге `npm install`.

Если PowerShell пишет parser error еще до строк `Downloading Stage 3 bootstrap...` или ошибку вида `Invoke-Expression ... Cannot convert "System.Byte[]" to "System.String"`, значит была запущена старая версия команды. Откройте Step 3 заново и скопируйте свежую команду: теперь Windows-команда отправляется через `-EncodedCommand`, затем bootstrap сохраняется во временный `.ps1`-файл и запускается оттуда без исполнения `Content` из web response.

## Что ожидать в UI

- `Not paired`:
  worker еще ни разу не подключался
- `Offline`:
  worker был подключен, но не шлет heartbeat
- `Online`:
  worker готов забирать jobs текущего пользователя в текущем workspace
- `Busy`:
  worker сейчас выполняет активный Stage 3 job; в описании статуса дополнительно показывается тип задачи (`preview`, `render`, `editing-proxy` и т.д.)

UI worker list теперь при каждом poll автоматически очищает протухшие local leases. Если job уже потерял lease и больше не выполняется, статус должен вернуться из `Busy` в `Online` без ручного сброса executor.

Если executor перезапущен, пока за ним ещё числится активная Stage 3 job, следующий worker claim после короткого heartbeat grace возвращает эту job в очередь и забирает её заново тем же worker-ом вместо ожидания полного lease window.

Если тяжелая local job зависла внутри executor и продолжает держать `Busy`, worker теперь имеет hard watchdog:

- `editing-proxy`: 5 минут;
- `preview`: 150 секунд;
- `source-download`: 5 минут;
- `render` и `agent-media-step`: 10 минут.

Host дополнительно зеркалит эти лимиты серверным watchdog-ом с небольшой grace-паузой. Если worker продолжает слать heartbeat, но job уже старше своего kind-timeout, host сам переводит её в recoverable `*_timeout`, сбрасывает `assigned_worker_id` / lease и освобождает очередь. Это защищает render от состояния, где зависший `editing-proxy` держит executor в `Busy` до длинного lease window без видимой ошибки.

После watchdog timeout job помечается как recoverable failure на хосте, а локальный worker завершает процесс, чтобы не продолжать держать скрытый зависший render/proxy. Автоматические повторные запросы по той же dedupe-key сохраняют счётчик попыток и останавливаются на лимите, чтобы перезапуск executor-а не возвращал один и тот же проблемный proxy/render в бесконечный цикл. Оператор должен перезапустить свежую команду из Step 3 и повторить действие. Таймауты можно временно переопределить через `STAGE3_WORKER_JOB_TIMEOUT_MS` или kind-specific env вроде `STAGE3_WORKER_RENDER_TIMEOUT_MS`.

Preview/render больше не должны тихо падать обратно на host. Если worker offline, job останется в очереди и UI покажет честное состояние ожидания.

Local executor теперь намеренно привязан к конкретному пользователю после pairing. Если Даша запустила executor в том же workspace, Катя не должна видеть workspace как готовый к локальному Stage 3, пока не подключит свой Clips Worker. Preview/render job Кати не может быть выполнен executor-ом Даши. Это закрывает class сбоев, где рендер уходил на чужой компьютер.

Совместимость runtime теперь асимметрична: если у worker тот же базовый release, но build новее серверного, он считается допустимым. Блокировать нужно именно более старые runtime-сборки, которые еще не знают про текущий хост.

Если локальный `yt-dlp` на машине пользователя упрется в YouTube anti-bot/IP issue, Stage 3 worker теперь пробует скачать source через хост по своему worker token. Это снижает вероятность user-specific сбоев, когда production runtime проходит YouTube, а конкретный локальный IP нет.

## Локальная разработка

Для localhost вместо production bootstrap используйте repo-local режим:

1. Запустить приложение:

```bash
npm run dev
```

2. В отдельном терминале создать/запустить CLI worker:

```bash
npm run stage3-worker -- pair --server http://localhost:3000 --token <PAIRING_TOKEN>
npm run stage3-worker -- start
```

Для проверки desktop shell:

```bash
npm run desktop-worker:dev
```

## Ограничения v1

- Worker v1 — unsigned internal desktop app, а не замена web-приложения.
- Web остаётся основным интерфейсом; desktop app только выполняет Stage 3 heavy jobs.
- Shared render machine не реализован. Если он появится позже, это будет отдельный явный режим, а не скрытый workspace pool.
- Installer artifacts раздаются вручную и не хостятся Render-ом.
- Managed tool downloads работают только для платформ, добавленных в pinned manifest с `sha256`; пустой manifest означает fallback к системным tools.
- Browser runtime для Remotion теперь проверяется до входа worker в job loop: если локальный Chrome/Edge найден, он используется напрямую; если нет, worker пытается подготовить Remotion-managed browser заранее, а не во время render job.
- Linux и Windows ARM не входят в v1 scope.
- Runtime dependencies platform-scoped: manifest явно указывает, для какой пары OS/CPU собран `runtime-deps.tar.gz`. Если архив был собран на Linux, а worker запускается на Windows/macOS, worker не распаковывает чужой `node_modules`, удаляет старую локальную копию и делает чистый `npm install` уже на компьютере пользователя. Windows npm запускается через `cmd.exe`, поэтому `.cmd` shim не должен падать с `spawn EINVAL`.
- Native packages, которые зависят от платформы (`esbuild`, `@rspack/*` bindings), дополнительно проверяются до claim jobs. Если после обновления они всё равно повреждены, worker self-heal переустанавливает их под текущую платформу вместо того, чтобы падать внутри preview/render.
- Managed template assets, например загруженные шрифты, worker скачивает через authenticated worker endpoint и кладет в локальный Remotion `public`, чтобы render не обращался к `/api/design/template-assets/*` на локальном `localhost`.
