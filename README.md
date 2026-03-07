# Shorts / Reels MP4 Downloader (Next.js)

Простое приложение на Next.js:
- поле для ссылки (`YouTube Shorts`, `Instagram Reels`, `Facebook Reels`);
- история чатов: каждая ссылка = отдельный чат;
- скачивание видео в `mp4`;
- загрузка комментариев;
- показ топ-10 популярных комментариев (по лайкам);
- экспорт всех комментариев в `json`;
- Stage 2 пайплайн генерации контента через LLM (Codex auth):
  - скачивание видео + комментариев;
  - анализ кадров видео + комментариев;
  - генерация 5 вариантов caption + 5 title + final pick по системному промпту.

## 1. Установка зависимостей проекта

Требуется `Node.js 22`.

```bash
npm install
```

## 2. Установка системных инструментов

Нужны:
- `yt-dlp` в `PATH`;
- `ffmpeg` и `ffprobe` в `PATH`;
- `codex` CLI;
- `@remotion/renderer` и `@remotion/bundler` для Stage 3 (выполните `npm install` после обновления `package.json`).
- `@remotion/cli` для подготовки headless-browser под рендер.

Пример для macOS (Homebrew):

```bash
brew install yt-dlp ffmpeg
```

Проверка:

```bash
yt-dlp --version
ffmpeg -version
ffprobe -version
codex --version
npx remotion --version
npx remotion browser ensure
```

## 3. Запуск

```bash
npm run dev
```

Откройте:
`http://localhost:3000`

## Как это работает

- UI хранит историю в backend-файле `.data/chat-history.json`.
- Каждый URL создает отдельный чат (или открывает уже существующий).
- UI отправляет ссылку на `POST /api/download`.
- API запускает `yt-dlp`, получает видео и возвращает клиенту `mp4` как attachment.
- UI может отправить ссылку на `POST /api/comments`.
- API получает комментарии через `yt-dlp`, сортирует по лайкам и возвращает:
  - `topComments` (до 10 шт),
  - `allComments` (полный список для экспорта JSON).
- UI может запустить Stage 2 через `POST /api/pipeline/stage2`.
- Stage 2:
  - скачивает видео и комментарии;
  - если `--write-comments` недоступен для источника, делает fallback (видео + доступные метаданные);
  - извлекает 3 кадра из видео;
  - использует системный промпт + `data/examples.json`;
  - вызывает `codex exec` с авторизацией пользователя через кнопку `Connect Codex` (device auth);
  - возвращает структурированный JSON:
    - `inputAnalysis`
    - `captionOptions` (5)
    - `titleOptions` (5)
    - `finalPick`

## Stage 3 рендер

- Финальный рендер теперь делает Remotion (через `POST /api/stage3/render`).
- На сервере выполняется:
  - повторное скачивание исходного видео;
  - рендер композиции `science-card-v1`;
  - возврат готового `mp4` в ответе.
- Добавлен агент монтажер:
  - `POST /api/stage3/optimize` подбирает фокус (top/center/bottom), старт 6-секундного клипа и оптимизирует TOP/BOTTOM текст под слоты без выезда.
  - `POST /api/video/meta` возвращает длительность источника для UI-слайдера.

## Connect Codex (device auth)

- В UI есть кнопка `Connect Codex`.
- Приложение запускает `codex login --device-auth` для пользовательской session-id.
- Пользователь завершает вход по URL/коду, показанным в интерфейсе.
- После статуса `Logged in` можно запускать Stage 2.
- Каждая browser-session использует отдельный `CODEX_HOME` в `.codex-user-sessions/<session-id>`.

## Stage 2 спецификация (из системного промпта)

Этап 2 реализован как строго-структурированный JSON-ответ (через JSON schema в `codex exec`):
- `inputAnalysis`: 3 visual anchors + comment vibe + key phrase;
- `captionOptions`: ровно 5 опций, каждая с `TOP` и `BOTTOM`;
- `titleOptions`: ровно 5 заголовков;
- `finalPick`: выбор лучшей опции + причина.

Дополнительная валидация:
- `TOP`: 140–210 символов;
- `BOTTOM`: 80–160 символов.

Источник стиля:
- `data/examples.json` (копия вашего `examples.json`).

## Переменные окружения (опционально)

- `CODEX_STAGE2_MODEL` — принудительно выбрать модель для `codex exec`.
- `CODEX_STAGE2_REASONING_EFFORT` — reasoning effort для модели (`low|medium|high|xhigh`, можно передать `extra-high`).
- `CODEX_STAGE2_TIMEOUT_MS` — таймаут Stage 2 в миллисекундах.
- `CODEX_BIN` — путь к бинарнику codex, если Next.js не видит его в PATH.
  Пример для macOS app: `/Applications/Codex.app/Contents/Resources/codex`
- `REMOTION_RENDER_TIMEOUT_MS` — таймаут Stage 3 рендера в миллисекундах.
- `APP_BOOTSTRAP_SECRET` — обязателен в production и на Vercel для one-time owner bootstrap.

Шаблон:

```bash
cp .env.example .env.local
```

## Vercel deployment

Текущее приложение не является полностью Vercel-native. В серверной части оно использует:
- локальный `codex` CLI;
- `yt-dlp`;
- `ffmpeg` и `ffprobe`;
- локальную файловую БД `.data/app.db`.

Из-за этого на Vercel:
- UI и базовый auth shell могут собраться;
- полный `Step 2`, `Step 3`, shared Codex integration и media pipeline в текущем виде не гарантированно заработают.

Если всё же нужен preview deploy:

1. В `Project Settings -> Build and Deployment`:
   - `Framework Preset` = `Next.js`
   - `Node.js Version` = `22.x`
   - `Build Command` = `npm run build`
   - `Install Command` = `npm install`
   - `Output Directory` = пусто
2. В `Environment Variables` добавьте:
   - `APP_BOOTSTRAP_SECRET`
   - при необходимости `APP_DATA_DIR` и `CODEX_SESSIONS_DIR`
   - при желании tuning vars из `.env.example`
3. Не задавайте `CODEX_BIN=/Applications/...` на Vercel. Этот путь работает только локально на macOS.

На Vercel приложение теперь по умолчанию использует:
- `APP_DATA_DIR=/tmp/clips-automations-data`
- `CODEX_SESSIONS_DIR=/tmp/clips-automations-codex-sessions`

Это убирает проблему записи в read-only deployment bundle, но не делает автоматически доступными системные бинарники вроде `yt-dlp`, `ffmpeg` и локального `codex`.

Если нужен рабочий production для всего пайплайна, а не только UI preview, выносите backend на VM/container, где можно поставить `codex`, `yt-dlp`, `ffmpeg` и держать постоянное файловое хранилище.

## Render deployment (recommended)

Для полного пайплайна на Render используйте не native `Node` runtime, а `Docker`:

1. Подключите репозиторий к Render.
2. Создайте `Web Service` с `Docker` runtime
3. Выберите `Starter` или выше
4. Добавьте persistent disk на `/var/data`
5. Добавьте `APP_BOOTSTRAP_SECRET`
6. Если YouTube отвечает `Sign in to confirm you’re not a bot`, добавьте:
   - `YTDLP_COOKIES_PATH=/var/data/yt-dlp/cookies.txt`
   - или `YTDLP_COOKIES` с содержимым `cookies.txt`

В репозитории уже есть:
- `Dockerfile` с установкой `yt-dlp`, `ffmpeg`, `ffprobe` и `codex`
- `render.yaml` с рекомендованным регионом `Frankfurt`, `Starter` plan и mount path `/var/data`

Если сервис создан как native `Node` web service, он не увидит системные бинарники. В этом случае создайте новый Docker-based service или переведите сервис на `runtime: docker` через Render Blueprint.

## Ограничения

- Работают только публичные ссылки.
- Если на сервере нет `yt-dlp`/`ffmpeg`/`ffprobe`, скачивание и Stage 2 не заработают.
- Для Stage 2 нужен успешный `Connect Codex` в текущей browser-session.
- Количество комментариев зависит от того, что реально отдаёт источник/экстрактор `yt-dlp`.
- Используйте только контент, на который у вас есть права.
