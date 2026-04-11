# Shorts / Reels MP4 Downloader (Next.js)

Простое приложение на Next.js:
- поле для ссылки (`YouTube Shorts`, `Instagram Reels`, `Facebook Reels`, `public Reddit posts`);
- история чатов: каждая ссылка = отдельный чат;
- скачивание видео в `mp4`;
- загрузка комментариев;
- загрузка до 300 самых залайканных комментариев;
- экспорт всех комментариев в `json`;
- Stage 2 пайплайн генерации контента через LLM (Codex auth):
  - скачивание видео + комментариев;
  - анализ кадров видео + комментариев;
  - `native_caption_v3` hot path:
    - `contextPacket -> candidateGenerator -> qualityCourt -> targetedRepair? -> titleWriter`;
    - 1-3 finalists + winner-first titles;
    - без hot-path SEO и без hot-path RU перевода;
    - отдельный optional action для перевода finalists после завершения run.
- Channel onboarding теперь проходит через guided wizard:
  - basic setup;
  - Stage 2 baseline settings;
  - 10+ reference links;
  - dynamic style discovery with a broad selectable startup pool, including explicit regeneration.
  - `banned words` / `banned openers` fields now preserve raw separators while typing, while the saved Stage 2 arrays still normalize comma / semicolon / newline-delimited input.
  - bootstrap style discovery now weights liked comments more aggressively, samples real reference frames, and builds compact audience + packaging portraits.
  - onboarding draft persists across panel close/reopen and page reload;
  - bootstrap style discovery runs durably on the server and reattaches by `runId`.
- После onboarding редактор канала может донастраивать style profile без повторного wizard:
  - менять reference links;
  - явно перегенерировать pool направлений;
  - менять selected directions;
  - менять exploration share.
- В Stage 3 publication planner удаление ролика из очереди не сбрасывает пользователя со страницы рендера:
  - карточка исчезает после локальной синхронизации очереди;
  - UI показывает success toast об удалении.
- Publication planner теперь работает как publishing workspace:
  - слева очередь по дням и слотам с фильтрами и быстрыми действиями;
  - справа sticky inspector выбранной публикации для времени, title/description/tags и delivery-настроек;
  - на мобильных inspector открывается drawer-ом, а не ломает основной список;
  - save/action/shift обновляют очередь локально и затем делают background revalidate без полного blocking refresh;
  - exact-time toggle больше не сбрасывается сам при клике, `Опубликовать сейчас` требует явного подтверждения вторым нажатием, а desktop inspector скроллится независимо от страницы;
  - фоновые refresh-и и same-chat live hydration после render/save/publication actions больше не перетягивают пользователя на Step 1/2 поверх его ручного выбора;
  - publication routes возвращают typed mutation errors (`code` + `field`), поэтому form-level и field-level ошибки показываются в правильном месте.

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

## Команда и роли

- Публичная регистрация создаёт активный аккаунт редактора с ролью `redactor`.
- В интерфейсе команды приглашение по умолчанию тоже создаётся для полного редактора (`redactor`).
- `redactor_limited` остаётся отдельной явной ролью для случаев, когда нужно оставить доступ к работе с каналом без права менять setup.

## Как это работает

- UI хранит историю в backend-файле `.data/chat-history.json`.
- Каждый URL создает отдельный чат (или открывает уже существующий).
- UI отправляет ссылку на `POST /api/download`.
- API выбирает provider-specific source path, получает видео и возвращает клиенту `mp4` как attachment.
  - для hosted `YouTube` media path использует `Visolix` и один автоматический retry на transient infra error;
  - hosted `YouTube` source download не уходит в `yt-dlp` fallback;
  - local/dev path по-прежнему может использовать `yt-dlp`, если это допустимо для конкретного runtime.
- UI может отправить ссылку на `POST /api/comments`.
- API получает комментарии провайдерно:
  - для `YouTube` сначала использует `YouTube Data API v3`;
  - если API временно недоступен или не настроен, может сделать fallback через `yt-dlp`;
  - для `Reddit` использует официальный `Reddit OAuth API`, а затем работает с media URL из `v.redd.it` / Reddit CDN;
  - для `Instagram / Facebook` сохраняется текущий `yt-dlp`-path;
  - если комментарии недоступны, source flow продолжает работу без них.
- После этого backend сортирует комментарии по лайкам и возвращает:
  - до 300 самых популярных комментариев,
  - `topComments` для preview,
  - `allComments` для локального inspect/export в пределах cap.
- UI может запустить Stage 2 через `POST /api/pipeline/stage2`.
- Stage 2:
  - скачивает видео и комментарии;
  - для `YouTube` использует тот же API-first comments path, а `yt-dlp` оставляет fallback-ом;
  - для `Reddit` не использует `Visolix`, а получает metadata/comments через OAuth и скачивает actual media URL напрямую;
  - если комментарии недоступны, продолжает пайплайн с доступными видео-метаданными;
  - извлекает адаптивно сэмплированный набор кадров из видео, а не фиксированные 3 stills;
  - ставит durable background run в очередь и продолжает его независимо от открытой вкладки;
  - использует pipeline `contextPacket -> candidateGenerator -> qualityCourt -> targetedRepair? -> titleWriter`;
  - использует один effective examples corpus на run: либо `workspace default corpus`, либо `channel custom corpus`;
  - использует channel learning layer:
    - bootstrap style profile из onboarding;
    - rolling editorial memory из последних explicit feedback events;
  - separate weaker passive `selected_option` signal;
  - removable explicit like/dislike reactions with immediate editorial-memory recompute;
  - confidence-aware examples mode: `domain_guided`, `form_guided`, or `style_guided` depending on retrieval quality;
    - controlled exploratory share, чтобы варианты не схлопывались в один mode;
  - поддерживает editor feedback по трём scope:
    - whole option;
    - top only;
    - bottom only;
  - использует comments-aware prompt stack:
    - analyzer separates mixed audience lanes instead of flattening them;
    - writer/critic/rewriter suppress stock generic tails and batch sameness;
    - final selector keeps real stylistic alternatives in the visible five;
  - clip trace export is forensic-oriented:
    - canonical causal inputs live in `stage2.causalInputs`;
    - per-stage prompt manifests live in `stage2.stageManifests`;
    - resolved worker mode / build / feature-flag truth lives in `stage2.execution`;
    - final outcome truth lives in `stage2.outcome`;
    - native caption sections live in `stage2.nativeCaptionV3`;
    - legacy / historical vNext audit sections remain in `stage2.vnext`;
    - export truncation is reported explicitly instead of being silently hidden;
  - worker rollout is fail-closed:
    - Stage 2 run aborts if `native_caption_v3` metadata is missing for new runs;
    - historical `vnext` payloads stay readable in trace/export and UI;
  - `data/examples.json` используется только один раз как seed для нового workspace, а не как live runtime source;
  - вызывает `codex exec` по stage-этапам с авторизацией пользователя через кнопку `Connect Codex` (device auth);
  - отдает live progress snapshot по шагам pipeline (`GET /api/pipeline/stage2?runId=...`);
  - возвращает структурированный JSON:
    - `finalists` (1-3)
    - `winner`
    - `titleOptions` (5 for the winner)
    - compatibility mirrors `captionOptions/finalPick` for downstream consumers
    - `progress`

### Stage 2 runtime state

- Durable run state хранится в основной app DB и переживает refresh/navigation:
  - queued/running/completed/failed status;
  - per-stage progress snapshot;
  - result payload и error payload.
- Старый Stage 2 refresh CLI оставлен только как compatibility stub и больше не обновляет examples corpus:

```bash
npm run stage2-worker
```

## Stage 3 рендер

- Финальный рендер и live preview для Stage 3 больше не должны нагружать production web service напрямую.
- В production тяжелые задачи Stage 3 выполняет локальный worker пользователя:
  - `preview`
  - `render`
  - `source-download`
  - `agent-media-step`
- Хост остается control plane:
  - auth
  - queue/jobs
  - artifacts
  - Codex orchestration
- Добавлен агент монтажер:
  - `POST /api/stage3/optimize` и `POST /api/stage3/agent/run` используют local media subjobs для тяжелого анализа.
  - `POST /api/video/meta` возвращает длительность источника для UI-слайдера.

### Stage 3 template layout contract (обязательные правила)

- Высоты секций карточки фиксированы и одинаково интерпретируются в editor preview, template-lab и final render.
- Текст в `top` и `bottom` секциях обязан автоматически подстраиваться под доступный слот, чтобы визуально заполнять секцию и не оставлять крупных пустых зон.
- Любые изменения typography/padding допустимы только если не нарушают предыдущее правило на коротком, среднем и длинном тексте.
- Запрещено менять поведение так, чтобы текст “выпадал” за границы секции или появлялись несоразмерные вертикальные gaps.

Подробный guide по интеграции и калибровке новых Stage 3 шаблонов:
- [docs/stage3-template-integration.md](/Users/neich/dev/clips automations/docs/stage3-template-integration.md)

Подробный rollout-гайд: [docs/stage3-local-worker.md](/Users/neich/dev/clips automations/docs/stage3-local-worker.md)

## Stage 3 local worker

- Поддерживаемые платформы v1:
  - `macOS arm64/x64`
  - `Windows x64`
- Worker pairing доступен прямо из Stage 3 UI через блок `Local Executor`.
- Для localhost используется repo-local CLI:

```bash
npm run stage3-worker -- pair --server http://localhost:3000 --token <PAIRING_TOKEN>
npm run stage3-worker -- start
```

- Для production UI выдает bootstrap one-liner:
  - macOS shell command
  - Windows PowerShell command

Требования на машине пользователя:
- `Node.js 22+`
- `npm`
- `ffmpeg`
- `ffprobe`
- `yt-dlp`

## Stage 1 sources

- Поддерживаются ссылки на:
  - `youtube.com/shorts/...`
  - `instagram.com/reel/...`
  - `facebook.com/reel/...`
- Дополнительно редактор может загрузить один или несколько готовых `mp4` прямо в Stage 1.
- В Step 1 есть чекбокс автозапуска Stage 2:
  - по умолчанию включён
  - если выключить, Step 2 стартует только вручную по кнопке `Генерировать варианты`
- Для загруженного `mp4` комментарии недоступны, но Step 2 и Step 3 продолжают работать по видеоконтексту.
- Если выбрать несколько `mp4`, Step 1 соберет их в один composite `upload://` source, после чего Stage 3 segment editor продолжит работать на единой таймлинии.

## Connect Codex (device auth)

- В UI есть кнопка `Connect Codex`.
- Приложение запускает `codex login --device-auth` для пользовательской session-id.
- Пользователь завершает вход по URL/коду, показанным в интерфейсе.
- После статуса `Logged in` можно запускать Stage 2.
- Каждая browser-session использует отдельный `CODEX_HOME` в `.codex-user-sessions/<session-id>`.

## Stage 2 спецификация

Этап 2 реализован как multi-stage viral worker с строго-структурированными JSON stage-ответами:
- `analyzer` -> visual anchors / vibe / reusable phrasing
- `selector` -> clip type / top 3 angles / chosen examples from the active corpus
- `writer` -> 20 candidate overlays
- `critic` -> rescoring / keep set
- `rewriter` -> sharpened shortlist candidates
- `final selector` -> 5 final options for human pick
- `titles` -> 5 title options for the shortlist

Финальный API-ответ по-прежнему содержит:
- `inputAnalysis`: 3 visual anchors + comment vibe + key phrase;
- `captionOptions`: ровно 5 опций, каждая с `TOP` и `BOTTOM`;
- `titleOptions`: ровно 5 заголовков;
- `finalPick`: выбор лучшей опции + причина.

Инвариант success-path:
- successful Stage 2 run должен завершаться ровно 5 visible caption options;
- если после repair/validation нельзя собрать publishable shortlist из 5 distinct options, run падает явно, а не сохраняет противоречивый partial-success.

Дополнительная валидация:
- `TOP`: диапазон задается channel hard constraints; сам `TOP` трактуется как contextual hook / compressed setup, а не как буквальное описание скриншота;
- `BOTTOM`: диапазон задается channel hard constraints;
- сохраняются banned words / banned openers / anti-AI ограничения из worker config.
- `BOTTOM` больше не зависит от legacy правила `bottom quote required`; quoted opener допускается только если это естественно для конкретного клипа.
- Для reveal-клипов default policy: `hint, don't fully spoil`. `TOP` должен ввести в контекст и напряжение, а не пересказать весь payoff заранее.
- Во время shortlist assembly worker теперь мягко штрафует screenshot-style `TOP`-ы: comma-chained object lists, beat-by-beat narration, поздний why-care hook и другие inventory-first формулировки проигрывают hook-forward альтернативам.
- На social / meme clips Stage 2 теперь дополнительно предпочитает plain spoken / comment-native phrasing вместо synthetic editorial English. Псевдо-сленг и сконструированные выражения вроде `social math`, `human move`, `shared-room` и похожие конструкции получают мягкий penalty на shortlist.

Channel-specific mapping теперь задается через `Stage 2` в Channel Manager.

### Guided channel bootstrap and learning

- `+ New Channel` больше не создаёт канал сразу в старой edit-форме.
- Вместо этого открывается wizard, который проводит редактора через:
  - basics;
  - Stage 2 base settings;
  - reference links;
  - dynamic style picks.
- После добавления 10+ reference clips запускается отдельный LLM discovery pass.
- Этот pass генерирует около 20 human-readable style directions.
- Discovery обязан держать баланс между core high-fit directions, adjacent possibilities и smaller exploratory tail, а не просто перефразировать одни и те же reference narratives.
- Editor может выбрать много направлений, включая почти весь пул, и именно этот набор становится initial style prior канала.
- Если reference links меняются после discovery, старый style pool не пропадает автоматически: wizard помечает его как stale и ждёт явного regenerate.
- Дальше normal Stage 2 work может дообучать канал через:
  - `More like this`
  - `Less like this`
  - optional note
  - lightweight `selected option` signal
- Feedback хранится как bounded rolling memory: сильнее всего влияют последние ~30 реакций.
- При этом около 25% option space всегда остаётся exploratory, чтобы канал мог эволюционировать.

Подробная документация по новому learning layer:
- [docs/stage2-channel-learning.md](/Users/neich/dev/clips automations/docs/stage2-channel-learning.md)

Primary Stage 2 control surface:
- owner редактирует workspace-wide defaults через `Default settings`;
- там же задаются:
  - `workspace default corpus`
  - `hard constraints`
  - default prompt + default thinking по стадиям `analyzer, selector, writer, critic, rewriter, final selector, titles, seo`
- у конкретного канала теперь есть **одно** editable поле `Examples corpus JSON`;
- это поле по умолчанию заполняется workspace default corpus, но может быть полностью заменено локальной версией для канала;
- `selector` является реальным LLM stage и сам выбирает angle и релевантные examples из доступного corpus;
- UI во время генерации показывает активный pipeline step в реальном времени.

Publishing / YouTube queue:
- planner публикации остаётся offline, пока для канала не подключён YouTube OAuth и не выбран целевой YouTube-канал;
- успешный render сохраняет `render export`, но не создаёт queued-публикацию, если publishing integration ещё не готова.
- в Step 3 рядом с render доступен чекбокс `Опубликовать`: только при включённом флаге render ставится в publish queue, а UI заранее показывает ожидаемое время публикации.
- один chat/source clip не создаёт вторую активную публикацию: повторный render обновляет queued/paused/failed запись или возвращает уже uploading/scheduled/published запись без нового upload.
- во время `uploading` planner блокирует конфликтующие действия, а сервер не принимает мутации, которые могли бы сбросить lease и породить второй YouTube upload.
- YouTube upload использует сохранённый resumable session URL и lease heartbeat, поэтому после сбоя процесс продолжает тот же upload session вместо открытия дублирующего.

Подробная документация по текущей Stage 2 архитектуре:
- [docs/stage2-runtime.md](/Users/neich/dev/clips automations/docs/stage2-runtime.md)

## Переменные окружения (опционально)

- `CODEX_STAGE2_MODEL` — принудительно выбрать модель для `codex exec`.
- `CODEX_STAGE2_REASONING_EFFORT` — reasoning effort для Stage 2 worker (`low|medium|high|xhigh`, можно передать `extra-high`).
  В `next dev` по умолчанию используется `low`, чтобы тяжелые writer stages реже упирались в timeout.
- `CODEX_STAGE2_TIMEOUT_MS` — таймаут Stage 2 в миллисекундах.
- `CODEX_STAGE2_DESCRIPTION_REASONING_EFFORT` — отдельный reasoning effort для SEO-генерации.
- `CODEX_BIN` — путь к бинарнику codex, если Next.js не видит его в PATH.
  Пример для macOS app: `/Applications/Codex.app/Contents/Resources/codex`
- `REMOTION_RENDER_TIMEOUT_MS` — таймаут Stage 3 рендера в миллисекундах.
- `STAGE3_DEFAULT_EXECUTION_TARGET` — `local|host`, по умолчанию должен быть `local`.
- `STAGE3_ALLOW_HOST_EXECUTION` — аварийный fallback на host-heavy execution. Для production должен быть `0`.
- `STAGE3_WORKER_PAIRING_TTL_SEC` — TTL pairing token в секундах.
- `STAGE3_WORKER_SESSION_TTL_SEC` — TTL worker session token в секундах.
- `APP_BOOTSTRAP_SECRET` — обязателен в production и на Vercel для one-time owner bootstrap.
- `APP_ENCRYPTION_KEY` — нужен для хранения OAuth credential payloads публикации. Для production задавайте стабильный ключ, а не dev fallback.
- `YOUTUBE_DATA_API_KEY` — серверный API key для `YouTube Data API v3`. Это основной production path для комментариев YouTube с любых публичных каналов. Ownership/OAuth не нужны.
- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` — обязательны для подключения YouTube канала и публикации через OAuth.
- `YTDLP_COOKIES` / `YTDLP_COOKIES_PATH` — optional fallback для `yt-dlp` comments/metadata paths и локального worker media path. Для hosted YouTube source download production path теперь использует `Visolix` и не пытается идти в `yt-dlp`.

Для Stage 3 local worker YouTube source сначала пробуется локально, но при user-specific anti-bot/IP отказе worker может сделать защищенный fallback через хост. Поэтому ситуация, когда Step 1/2 у всех проходит, а Stage 3 ломается только у одного пользователя, действительно может быть связана именно с его локальным runtime/IP.

Hosted Step 1 YouTube media path:
- primary path: `Visolix`
- если Visolix вернул transient/infra error, backend автоматически ждёт 5 секунд и делает ровно один повторный запрос
- если обе попытки не сработали, job падает с честной провайдерной причиной `Visolix`
- hosted runtime сознательно не запускает `yt-dlp` fallback для YouTube source download; `yt-dlp` остаётся для comments/metadata путей и local/dev сценариев

Ограничения comments fetch для YouTube:
- `comments disabled` — YouTube API честно вернёт, что комментарии отключены.
- `video unavailable / not found` — видео недоступно или удалено.
- `quota exceeded` — исчерпана квота `YouTube Data API`.
- `api auth/config broken` — серверный ключ невалиден или API не включён.
- если API временно падает, backend может сделать fallback через `yt-dlp`;
- если оба пути не сработали, источник всё равно можно продолжить без комментариев.

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
   - `APP_ENCRYPTION_KEY`, если нужен YouTube OAuth/publishing
   - `GOOGLE_OAUTH_CLIENT_ID` и `GOOGLE_OAUTH_CLIENT_SECRET`, если нужен YouTube OAuth/publishing
   - при необходимости `APP_DATA_DIR` и `CODEX_SESSIONS_DIR`
   - при желании tuning vars из `.env.example`
3. Не задавайте `CODEX_BIN=/Applications/...` на Vercel. Этот путь работает только локально на macOS.

На Vercel приложение теперь по умолчанию использует:
- `APP_DATA_DIR=/tmp/clips-automations-data`
- `CODEX_SESSIONS_DIR=/tmp/clips-automations-codex-sessions`

Это убирает проблему записи в read-only deployment bundle, но не делает автоматически доступными системные бинарники вроде `yt-dlp`, `ffmpeg` и локального `codex`.

Если нужен рабочий production для всего пайплайна, а не только UI preview, выносите backend на VM/container, где можно поставить `codex`, `yt-dlp`, `ffmpeg` и держать постоянное файловое хранилище.

## Render deployment (recommended)

Для полного пайплайна на Render используйте `Docker` runtime:

1. Подключите репозиторий к Render.
2. Создайте `Web Service` с `Docker` runtime
3. Выберите `Starter` или выше
4. Добавьте persistent disk на `/var/data`
5. Добавьте `APP_BOOTSTRAP_SECRET`
6. Если нужен YouTube OAuth/publishing, добавьте:
   - `APP_ENCRYPTION_KEY`
   - `GOOGLE_OAUTH_CLIENT_ID`
   - `GOOGLE_OAUTH_CLIENT_SECRET`
7. Если YouTube отвечает `Sign in to confirm you’re not a bot`, добавьте:
   - `YTDLP_COOKIES_PATH=/var/data/yt-dlp/cookies.txt`
   - или `YTDLP_COOKIES` с содержимым `cookies.txt`

В репозитории уже есть:
- `Dockerfile` с установкой `yt-dlp`, `ffmpeg`, `ffprobe` и `codex`
- `render.yaml` с рекомендованным регионом `Frankfurt`, `Starter` plan, mount path `/var/data` и local-worker defaults для Stage 3

Для `Starter` имеет смысл сразу зажать фоновые очереди:
- `STAGE2_MAX_CONCURRENT_RUNS=1`
- `SOURCE_MAX_CONCURRENT_JOBS=1`

Иначе несколько одновременных Stage 1/Stage 2 задач могут упереться в лимит памяти инстанса раньше, чем Render успеет восстановить сервис.

Если hosted instance всё же упал во время `Stage 1` / `Stage 2`, после следующего boot такие задачи не должны автоматически продолжаться по кругу. Их лучше запускать вручную после восстановления сервиса, иначе можно поймать restart-loop на маленьком инстансе.

Если сервис создан как native `Node` web service, он не увидит системные бинарники. В этом случае создайте новый Docker-based service или переведите сервис на `runtime: docker` через Render Blueprint.

## Ограничения

- Работают только публичные ссылки.
- Если у пользователя нет `yt-dlp`/`ffmpeg`/`ffprobe`, Stage 3 local worker не сможет выполнять preview/render/source-download.
- Для Stage 2 нужен успешный `Connect Codex` в текущей browser-session.
- Количество комментариев зависит от того, что реально отдаёт источник/экстрактор `yt-dlp`.
- Используйте только контент, на который у вас есть права.
