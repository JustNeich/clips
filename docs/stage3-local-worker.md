# Stage 3 Local Worker Rollout

Этот документ описывает, что нужно сделать владельцу проекта и конечным пользователям, чтобы Stage 3 preview/render/agent-media offload работал предсказуемо и не убивал web service на Render.

## Что уже реализовано

- Хост работает как control plane:
  - auth
  - queue/jobs
  - artifacts
  - Codex orchestration
- Тяжелые Stage 3 job kinds идут в локальный worker:
  - `preview`
  - `render`
  - `source-download`
  - `agent-media-step`
- Worker поддерживает:
  - `macOS arm64/x64`
  - `Windows x64`
- Pairing и worker status доступны прямо из Stage 3 UI.

## Что должен сделать владелец проекта

### 1. Переключить production на local execution

Проверьте, что в Render заданы:

- `STAGE3_DEFAULT_EXECUTION_TARGET=local`
- `STAGE3_ALLOW_HOST_EXECUTION=0`
- `STAGE3_WORKER_PAIRING_TTL_SEC=600`
- `STAGE3_WORKER_SESSION_TTL_SEC=2592000`
- `PUBLIC_APP_ORIGIN=https://ваш-домен` при необходимости

`PUBLIC_APP_ORIGIN` нужен только если прокси/рантайм подставляет во внутренние запросы адрес вида `0.0.0.0` вместо публичного домена.

Эти значения уже добавлены в [render.yaml](/Users/neich/dev/clips automations/render.yaml), но их нужно реально задеплоить.

### 2. Задеплоить новую версию хоста

Нужен новый deploy, потому что production должен начать:

- отдавать bootstrap scripts:
  - `/stage3-worker/bootstrap.sh`
  - `/stage3-worker/bootstrap.ps1`
- отдавать bundled worker:
  - `/stage3-worker/clips-stage3-worker.cjs`
  - `/stage3-worker/package.json`
- разрешать публичный доступ к bootstrap assets
- принимать worker auth / heartbeat / claim / complete / fail

### 3. Проверить production после деплоя

Минимальный smoke checklist:

1. Войти в приложение.
2. Открыть Step 3.
3. Нажать `Подключить executor`.
4. Убедиться, что pairing command появился.
5. Запустить worker на локальной машине.
6. Дождаться статуса `Online`.
7. Изменить `clip start` или `music gain` и убедиться, что preview уходит в queue/running и возвращается.
8. Нажать `Render` и убедиться, что job проходит через `queued -> running -> completed`.

### 4. Подготовить поддержку пользователей

Пользователю нужны локально:

- `Node.js 22+`
- `npm`
- `ffmpeg`
- `ffprobe`
- `yt-dlp`

Рекомендуемый текст для поддержки:

- macOS: `brew install ffmpeg yt-dlp`
- Windows: `winget install Gyan.FFmpeg yt-dlp.yt-dlp`

## Что должен сделать пользователь

### Вариант A: macOS

1. Открыть Stage 3.
2. Нажать `Подключить executor`.
3. Скопировать команду из блока `Local Executor`.
4. Вставить ее в Terminal.
5. Дождаться:
   - pairing
   - doctor
   - запуска worker
6. Оставить Terminal открытым, пока используются preview/render в Stage 3.

Команда сама:

- скачает worker bundle с хоста
- скачает worker runtime package descriptor с хоста
- установит worker runtime зависимости через `npm install --omit=dev`
- создаст локальный wrapper
- выполнит pairing
- проверит зависимости
- запустит worker loop

### Вариант B: Windows

1. Открыть Stage 3.
2. Нажать `Подключить executor`.
3. Скопировать PowerShell команду из блока `Local Executor`.
4. Вставить ее в PowerShell.
5. Дождаться pairing и запуска worker.
6. Оставить окно PowerShell открытым во время работы со Stage 3.

Если после запуска команды в PowerShell долго не появляется ни одной строки:

1. Подождать 10-15 секунд: новая команда теперь должна сразу печатать `Downloading Stage 3 bootstrap...` и `Running Stage 3 bootstrap...`.
2. Если тишина сохраняется, попросить редактора запустить ту же команду в обычном `Windows PowerShell`, а не в терминале IDE.
3. Если bootstrap уже стартовал и упал позже, лог лежит в `%LOCALAPPDATA%\\Clips Stage3 Worker\\logs\\bootstrap-*.log`.
4. Для поддержки нужен либо текст из окна PowerShell, либо последний `bootstrap-*.log`.

На старом Windows PowerShell причиной зависания часто был `Invoke-WebRequest` без `-UseBasicParsing`; bootstrap теперь принудительно использует basic parsing и пишет шаги установки в лог.

Если PowerShell пишет parser error еще до строк `Downloading Stage 3 bootstrap...` или ошибку вида `Invoke-Expression ... Cannot convert "System.Byte[]" to "System.String"`, значит была запущена старая версия команды. Откройте Step 3 заново и скопируйте свежую команду: теперь Windows-команда отправляется через `-EncodedCommand`, затем bootstrap сохраняется во временный `.ps1`-файл и запускается оттуда без исполнения `Content` из web response.

## Что ожидать в UI

- `Not paired`:
  worker еще ни разу не подключался
- `Offline`:
  worker был подключен, но не шлет heartbeat
- `Online`:
  worker готов забирать jobs
- `Busy`:
  worker сейчас выполняет активный Stage 3 job; в описании статуса дополнительно показывается тип задачи (`preview`, `render`, `editing-proxy` и т.д.)

UI worker list теперь при каждом poll автоматически очищает протухшие local leases. Если job уже потерял lease и больше не выполняется, статус должен вернуться из `Busy` в `Online` без ручного сброса executor.

Preview/render больше не должны тихо падать обратно на host. Если worker offline, job останется в очереди и UI покажет честное состояние ожидания.

Если локальный `yt-dlp` на машине пользователя упрется в YouTube anti-bot/IP issue, Stage 3 worker теперь пробует скачать source через хост по своему worker token. Это снижает вероятность user-specific сбоев, когда production runtime проходит YouTube, а конкретный локальный IP нет.

## Локальная разработка

Для localhost вместо production bootstrap используйте repo-local режим:

1. Запустить приложение:

```bash
npm run dev
```

2. В отдельном терминале создать/запустить worker:

```bash
npm run stage3-worker -- pair --server http://localhost:3000 --token <PAIRING_TOKEN>
npm run stage3-worker -- start
```

## Ограничения v1

- Worker пока CLI-first, не background service.
- Пользователь должен держать Terminal/PowerShell открытым.
- Автоматической managed-install логики для `ffmpeg/ffprobe/yt-dlp` пока нет; есть doctor и install hints.
- Bootstrap сам ставит только Node runtime dependencies worker’а; системные media tools пользователь по-прежнему ставит отдельно.
- Linux и Windows ARM не входят в v1 scope.
