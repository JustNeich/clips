# Surfaces And Navigation

## Как читать этот документ

Каждая поверхность ниже описана как контекст для intake-агента:

- `route / entrypoint`
- `purpose`
- `roles`
- `preconditions`
- `controls`
- `resulting actions`
- `related APIs`
- `related entities`
- `success / failure states`
- `common user phrasings`

Если surface не имеет собственного route, он всё равно считается отдельной навигационной поверхностью, если у него есть собственные контролы, guard-ы или сценарии ошибки.

## Грамматика UI

### Глобальные паттерны

| Паттерн | Что значит |
| --- | --- |
| `Каналы` | Вход в Channel Manager modal |
| `Команда` | Переход на `/team` |
| `Вариант {n}` | Caption option Step 2 |
| `Заголовок {n}` | Title option Step 2 |
| `Фрагмент {n}` | Segment/fragment в Step 3 timeline |
| `Удалить реакцию {id}` | Удаление feedback event из истории канала |
| `- слот` / `+ слот` / `- день` / `+ день` | Быстрый сдвиг queued publication |
| `Подключить executor` / `Executor` | Открытие modal pairing локального worker-а |
| `Сбросить к продуктовым настройкам` | Возврат model routing / prompt routing к baseline |
| `Capture Snapshot` | Запись calibration artifact в internal template-lab |

### Типовые состояния

| Состояние | Как выглядит |
| --- | --- |
| Hidden action | Кнопка или вкладка отсутствует |
| Disabled action | Кнопка видна, но `disabled` |
| Forbidden route | Экран с текстом `Доступ запрещён.` и ссылкой назад |
| Inline progress | Кнопка уходит в `Запускаем...`, `Создаём...`, `Сохраняем...` |
| Drawer state | Версии, история или детали раскрываются поверх основного flow |
| Modal state | Channel Manager, onboarding wizard, executor setup |

## Публичные surface-ы

## `/login`

- `purpose`: вход в служебный аккаунт и точка входа в основной shell.
- `roles`: все будущие роли, если есть валидные credentials.
- `preconditions`: аккаунт уже создан или выдан invite.
- `controls`:
  - поле `Почта`
  - поле `Пароль`
  - кнопка `Войти`
  - link `Создать аккаунт редактора`
  - link `Принять приглашение`
  - link `Создать владельца`
- `resulting actions`:
  - `POST /api/auth/login`
  - при успехе redirect на `/`
- `related APIs`:
  - `app/api/auth/login/route.ts`
  - `app/api/auth/me/route.ts`
- `related entities`: `user`, `session`, `workspace membership`
- `success states`: redirect в рабочий shell.
- `failure states`: inline error под формой.
- `common user phrasings`:
  - "не пускает в приложение"
  - "логин крутится и ничего не происходит"
  - "после входа кидает обратно"

## `/register`

- `purpose`: self-serve регистрация полного редактора.
- `roles`: публичная поверхность, итоговая роль всегда `redactor`.
- `preconditions`: email ещё не занят.
- `controls`:
  - поле `Имя`
  - поле `Почта`
  - поле `Пароль`
  - кнопка `Создать аккаунт`
  - link `Назад ко входу`
- `resulting actions`:
  - `POST /api/auth/register`
  - при успехе redirect на `/`
- `related APIs`: `app/api/auth/register/route.ts`
- `related entities`: `user`, `workspace membership`
- `common user phrasings`:
  - "зарегистрировался как редактор"
  - "не создаётся аккаунт"

## `/accept-invite`

- `purpose`: активация инвайта с выдачей конкретной роли.
- `roles`: публичная поверхность, итоговая роль берётся из invite.
- `preconditions`: есть действующий invite token.
- `controls`:
  - поле `Токен приглашения`
  - поле `Имя`
  - поле `Пароль`
  - кнопка `Принять приглашение`
  - link `Назад ко входу`
- `resulting actions`:
  - `POST /api/auth/accept-invite`
  - при успехе redirect на `/`
- `related APIs`: `app/api/auth/accept-invite/route.ts`
- `related entities`: `invite`, `user`, `workspace membership`
- `failure states`:
  - невалидный токен
  - invite уже использован
  - invite expired / deleted
- `common user phrasings`:
  - "токен не принимается"
  - "приглашение не сработало"

## `/setup/bootstrap-owner`

- `purpose`: одноразовый bootstrap первого владельца workspace.
- `roles`: публичная админская поверхность до инициализации.
- `preconditions`: owner ещё не создан; в части окружений может требоваться `APP_BOOTSTRAP_SECRET`.
- `controls`:
  - поле `Название рабочего пространства`
  - поле `Имя`
  - поле `Почта`
  - поле `Пароль`
  - условное поле `Секрет инициализации`
  - кнопка `Создать владельца`
  - link `Назад ко входу`
- `resulting actions`:
  - `GET /api/auth/bootstrap-owner` для статуса
  - `POST /api/auth/bootstrap-owner` для создания owner
- `success states`: redirect на `/`
- `failure states`:
  - `Владелец уже существует. Используйте страницу входа.`
  - `Не удалось создать владельца.`
- `common user phrasings`:
  - "не могу поднять первого владельца"
  - "просит секрет"

## Главный shell `/`

## Header и shell chrome

- `purpose`: главный контейнер операторского пайплайна.
- `roles`: все авторизованные роли.
- `verification`: `browser-verified`.
- `controls`:
  - кнопка `Открыть историю` / `Скрыть историю`
  - title `Автоматизация клипов`
  - subtitle про 3-step flow
  - блок `Канал`
  - кнопка `Еще`
  - правый user/Codex блок с именем, ролью, статусом Shared Codex и кнопкой `Управление`
  - step nav: `Шаг 1`, `Шаг 2`, `Шаг 3`
  - collapsible zone `Логи и комментарии`
- `resulting actions`:
  - открывает history panel
  - переключает канал
  - вызывает Channel Manager
  - открывает team page
  - управляет shared Codex auth/logout/refresh
- `related APIs`:
  - `GET /api/auth/me`
  - `GET /api/workspace`
  - `GET /api/channels`
  - `GET /api/workspace/integrations/codex`
- `related entities`: `workspace`, `membership`, `channel`, `codex connection`, `chat history`
- `common user phrasings`:
  - "слева пропала история"
  - "не тот канал выбран"
  - "справа пишет, что Codex не подключен"

## History panel

- `entrypoint`: кнопка `Открыть историю`.
- `purpose`: быстрый доступ к прошлым `chat` циклам.
- `controls`:
  - карточки истории, сгруппированные по дням
  - progress/status badge
  - открытие конкретного chat
  - удаление history item
  - action для создания нового chat через header workflow
- `resulting actions`:
  - `GET /api/chats`
  - `GET /api/chats/[id]`
  - `DELETE /api/chats/[id]`
- `entities`: `chat`, `chat workflow status`, `publication summary`
- `status language`:
  - `Новый`
  - `Источник готов`
  - `Опции готовы`
  - `Редактирование`
  - `Агент`
  - `Экспорт`
  - `Ошибка`
  - publication labels `Ожидает`, `Загрузка`, `Запланировано`, `Опубликовано`, `Ошибка`, `На паузе`, `Удалено`
- `common user phrasings`:
  - "пропал вчерашний ролик"
  - "в истории висит ошибка"
  - "карточка открывает не тот шаг"

## Channel selector

- `entrypoint`: кнопка с названием канала и username.
- `purpose`: переключение активного канала для текущего chat flow.
- `controls`:
  - current channel button
  - выпадающее меню каналов
- `role behavior`:
  - `owner`, `manager`: видят все каналы workspace
  - `redactor`: видит созданные им каналы и каналы с grant access
  - `redactor_limited`: видит только granted channels
- `entities`: `channel`, `channel access grant`
- `common user phrasings`:
  - "не вижу свой канал в списке"
  - "переключился не тот канал"

## Overflow menu `Еще`

- `entrypoint`: кнопка `Еще` рядом с selector.
- `purpose`: вторичное меню для channel/team/history actions.
- `browser-verified role states`:
  - `owner`: `Каналы`, `Команда`, `Скачать историю`
  - `manager`: `Каналы`, `Команда`, `Скачать историю`
  - `redactor`: `Каналы`, `Скачать историю`
  - `redactor_limited`: только `Скачать историю`
- `controls`:
  - `Каналы`: открывает Channel Manager
  - `Команда`: ведёт на `/team`
  - `Скачать историю`: экспорт trace/history, может быть disabled
- `related APIs`:
  - `GET /api/chat-trace/[id]`
  - team / channel APIs по открываемым поверхностям
- `common user phrasings`:
  - "у меня нет кнопки команда"
  - "у ограниченного редактора пропал канал менеджер"

## User / Codex menu `Управление`

- `entrypoint`: кнопка `Управление` в правом верхнем user block.
- `purpose`: управление shared Codex connection и logout.
- `browser-verified owner controls`:
  - `Переподключить`
  - `Отключить`
  - `Обновить`
  - `Выйти из приложения`
- `role semantics`:
  - `owner` управляет shared Codex полностью
  - `manager` и редакторы видят connection state, но их полномочия уже описываются guard-ами и workspace permissions
- `related APIs`:
  - `app/api/codex/auth/route.ts`
  - `app/api/workspace/integrations/codex/route.ts`
  - `app/api/auth/logout/route.ts`
- `common user phrasings`:
  - "Codex слетел"
  - "не обновляется статус подключения"
  - "не могу выйти из приложения"

## Step navigation

- `controls`:
  - `Шаг 1 Вставить ссылку`
  - `Шаг 2 Проверить и выбрать`
  - `Шаг 3 Рендер видео`
- `rules`:
  - следующий шаг может быть disabled, пока не готов предшествующий state
  - shell запоминает preferred step per chat
- `entities`: `chat draft`, `source state`, `stage2 state`, `stage3 state`

## Step 1: `Источник`

- `surface`: левая панель Step 1 внутри `/`
- `purpose`: получить media source, комментарии и подготовить основу для Step 2.
- `controls`:
  - поле `Ссылка на видео`
  - кнопка `Вставить`
  - file input `Choose File` с `multiple`
  - кнопка `Выбрать mp4`
  - кнопка `Получить источник`
  - checkbox `Автоматически запускать Stage 2 после завершения Step 1`
  - collapsible `Дополнительно`
  - в advanced state: блок текущего Step 1 job, download buttons, source preview
- `resulting actions`:
  - `POST /api/pipeline/source`
  - `POST /api/pipeline/source-upload`
  - `GET /api/source-media`
  - `POST /api/comments`
  - optional auto-trigger `POST /api/pipeline/stage2`
- `entities`: `source job`, `source media`, `comments payload`, `chat`
- `success states`:
  - источник прикреплён к chat
  - несколько uploaded mp4 могут быть собраны в один composite upload:// source перед Step 3
  - preview/context справа показывает source metadata
- `failure states`:
  - invalid link
  - comments unavailable on current server
  - upload blocked
  - fetch blocked by active chat reuse / runtime capability
- `common user phrasings`:
  - "ссылка не вставляется"
  - "mp4 не загружается"
  - "комментарии не подтянулись"
  - "второй этап не запустился автоматически"

## Step 2: `Выбор`

- `surface`: Step 2 внутри `/`
- `purpose`: сгенерировать shortlist caption/title вариантов, выбрать основу, отправить editorial feedback.
- `controls`:
  - header `Выбор`
  - details `Контекст запуска`
  - section `Перегенерация`
  - кнопка `Перегенерировать варианты`
  - кнопка `Полный прогон Stage 2`
  - details `Тонкая настройка`
  - textarea `Инструкция для перегенерации`
  - details `Статус и история запусков`
  - run pills `Запуски`
  - section `Готовые варианты`
  - dynamic cards `Вариант {n}`
  - card actions:
    - `Выбрать`
    - `Копировать`
    - whole-option feedback `👍` / `👎`
    - per-field feedback `👍` / `👎` для `TOP` и `BOTTOM`
  - feedback composer:
    - select `Режим заметки`
    - textarea note
    - `Сохранить`
    - `Отмена`
  - section `Готовые заголовки` или `Варианты заголовка`
  - title card actions `Выбрать`, `Копировать`
  - details `SEO, память канала и диагностика`
  - section `Описание ролика`
  - actions `Копировать описание`, `Копировать теги`
  - section `Run warnings`
  - section `Последние реакции канала`
  - dynamic action `Удалить`
  - details `Дополнительно` с raw JSON
- `resulting actions`:
  - `POST /api/pipeline/stage2`
  - `GET /api/pipeline/stage2/debug`
  - `POST /api/channels/[id]/feedback`
  - `DELETE /api/chat-events/[id]` для feedback history entries
- `entities`:
  - `stage2_run`
  - `caption option`
  - `title option`
  - `seo description`
  - `channel editorial feedback`
  - `run warnings`
- `status surfaces`:
  - `Обычно занимает`
  - `Прошло`
  - progressbar
  - step-by-step pipeline list with failed / blocked / completed labels
- `common user phrasings`:
  - "варианты пустые"
  - "лайк не сохранился"
  - "заголовки не выбираются"
  - "второй этап завис на одном шаге"
  - "после фидбека перегенерация не учитывает комментарий"

## Step 3: `Финализация и монтаж`

- `surface`: Step 3 внутри `/`
- `purpose`: финальный preview, монтаж окна/фрагментов, typography, audio/background, versions, executor-based render.
- `controls`:
  - header `Финализация и монтаж`
  - executor chip и кнопка `Подключить executor` / `Executor`
  - details `Контекст шага`
  - section `Единый preview`
  - status pills `Executor`, `Фон`, `Звук`, `Таймлайн 0 → 6с`
  - details `Оформление и звук`
  - typography sliders:
    - `Размер верхнего текста`
    - `Размер нижнего текста`
    - preset chips `%`
  - background block:
    - `Upload`
    - background asset select
    - `Clear`
  - audio block:
    - `Upload`
    - music asset select
    - `Clear`
    - checkbox `Оставить звук исходника`
    - slider `Громкость музыки`
  - card `Финальный текст`
    - textarea/inputs `TOP`, `BOTTOM`
    - actions to sync from Stage 2 / clear manual override / other quick edits
    - inline status card `Подсветка слов и template customization`
      - current template highlight status
      - highlight count for current draft / selected option
      - count of caption options that already contain highlight-spans
      - recovery CTA to apply the first option with color spans when the selected option has none
      - link `Открыть template customization`
  - details `Источники и быстрый mix`
    - per-option highlight count pills
  - toggle for background/source modes
  - button `Очистить текущий flow и перейти к следующей ссылке`
  - button `Экспорт`
  - primary render button
  - section `Тайминг и камера`
    - button `Вернуть цельный клип`
    - source rail with draggable window / fragments
    - dynamic fragment controls `Фрагмент {n}`
    - window/fragment coverage pills
  - preview toolbar:
    - play/pause
    - frame-step previous / next
    - zoom controls
    - versions drawer open
  - versions drawer:
    - version list
    - diff summary
    - `Internal passes`
    - pass tabs
- `resulting actions`:
  - `POST /api/stage3/preview`
  - `POST /api/stage3/render`
  - `POST /api/stage3/agent/run`
  - `POST /api/stage3/agent/sessions/[id]/resume`
  - `GET /api/stage3/agent/[id]/timeline`
  - `POST /api/stage3/agent/[id]/rollback`
  - `GET /api/stage3/render/jobs/[id]`
  - `GET /api/stage3/preview/jobs/[id]`
- `entities`:
  - `stage3 draft`
  - `preview snapshot`
  - `render job`
  - `version`
  - `internal pass`
  - `segment`
  - `executor / worker`
- `common user phrasings`:
  - "preview не обновляется"
  - "executor не коннектится"
  - "версия пропала"
  - "камера съехала"
  - "экспорт не стартует"
  - "фон/музыка не применяются"

## Local executor setup modal

- `entrypoint`: кнопка `Подключить executor` или `Executor`.
- `purpose`: pairing локального Stage 3 worker-а.
- `controls`:
  - `Закрыть`
  - status card
  - OS tabs `Mac` / `Windows`
  - button `Подготовить команду` / `Обновить команду`
  - button `Скопировать команду`
  - official links cards for install dependencies
  - button `Скопировать команду установки`
- `related APIs`:
  - `POST /api/stage3/workers/pairing`
  - `GET /api/stage3/workers`
  - worker auth / heartbeat / claim endpoints
- `entities`: `stage3 worker`, `pairing command`, `heartbeat`
- `common user phrasings`:
  - "executor offline"
  - "команда не копируется"
  - "после запуска в терминале браузер не видит компьютер"

## Publishing planner

- `entrypoint`: publishing panel внутри Step 3 / shell.
- `purpose`: управление queued/scheduled/published YouTube публикациями.
- `controls`:
  - header `План публикаций`
  - button `Настроить канал`
  - publication card actions:
    - `YouTube`
    - `Подробнее` / `Скрыть`
    - `Редактировать` / `Закрыть редактор`
  - edit form fields:
    - `Заголовок`
    - `Описание`
    - `Теги`
    - schedule mode tabs `По слотам` / `Точное время`
    - `Дата`
    - `Слот`
    - `Дата и время ({timeZone})`
    - checkbox `Публиковать в фид подписок и уведомлять подписчиков`
    - `Сохранить`
    - `Отмена`
  - quick move actions:
    - `- слот`
    - `+ слот`
    - `- день`
    - `+ день`
  - publication actions:
    - `Пауза`
    - `Возобновить`
    - `Повторить`
    - `Опубликовать сейчас`
    - `Удалить`
- `resulting actions`:
  - `PATCH /api/publications/[id]`
  - `POST /api/publications/[id]/shift`
  - `POST /api/publications/[id]/pause`
  - `POST /api/publications/[id]/resume`
  - `POST /api/publications/[id]/retry`
  - `POST /api/publications/[id]/publish-now`
  - `POST /api/publications/[id]/delete`
- `entities`: `publication`, `slot`, `schedule mode`, `youtube upload state`
- `failure states`:
  - slot mismatch with updated channel grid
  - failed upload / `lastError`
  - notify-subscribers flag locked after first upload
- `common user phrasings`:
  - "ролик не встал в слот"
  - "не двигается по дням"
  - "опубликовать сейчас не работает"
  - "уже загруженный ролик не даёт поменять уведомления"

## Channel Manager modal

- `entrypoint`: overflow action `Каналы`.
- `purpose`: channel CRUD, brand/stage2/render/publishing/assets/access admin.
- `verification`: `browser-verified` + `code-verified`.
- `common controls`:
  - channel select combobox
  - button `+ Новый канал`
  - button `Удалить канал`
  - tabs `Бренд`, `Stage 2`, `Рендер`, `Publishing`, `Ассеты`
  - conditional tab `Доступ`
  - owner-only synthetic target `Общие настройки`
- `role behavior`:
  - `owner`: все каналы + `Общие настройки` + tab `Доступ`
  - `manager`: все каналы, нет `Общие настройки`, есть `Доступ`
  - `redactor`: только доступные каналы, нет `Доступ`, delete может быть disabled
  - `redactor_limited`: в live UI вход в modal отсутствует

## Channel onboarding wizard

- `entrypoint`: `+ Новый канал`
- `purpose`: guided creation канала в 4 шага.
- `steps`:
  - `Базовая настройка канала`
  - `Базовая настройка Stage 2`
  - `Добавьте 10+ референсных ссылок`
  - `Выберите стартовые стилистические направления`
- `controls`:
  - basic fields `Название канала`, `Username канала`, avatar upload with draggable circular crop modal
  - Stage 2 fields: pipeline format, example corpus, hard constraints, banned words/openers
  - reference links textarea
  - style direction cards, selection toggles, exploration share slider
  - navigation buttons previous / next / finish / cancel
- `related APIs`:
  - `POST /api/channels`
  - `POST /api/channels/style-discovery`
- `entities`: `channel`, `style discovery run`, `style directions`
- `common user phrasings`:
  - "wizard не даёт закончить канал"
  - "референсы не принимаются"
  - "направления не перегенерируются"

## Channel Manager tab: `Бренд`

- `purpose`: name, username, avatar.
- `controls`:
  - `Название канала`
  - `Username канала`
  - `Загрузить аватар` with draggable circular crop modal
  - avatar asset select
- `save model`: autosave.
- `APIs`:
  - `PATCH /api/channels/[id]`
  - `POST /api/channels/[id]/assets`

## Channel Manager tab: `Stage 2`

- `purpose`: pipeline profile, style profile, example corpus, hard constraints, model routing.
- `controls`:
  - block `Формат pipeline`
  - `Активная линия`
  - block `Стиль канала`
  - `Референсные ссылки`
  - `Доля исследования`
  - actions `Перегенерировать направления`, `Очистить выбор`, `Выбрать всё`, `Сохранить стиль`
  - style direction cards with explanation fields
  - block `Последние реакции канала`
  - dynamic `Удалить реакцию`
  - block `Корпус примеров`
  - textarea `JSON корпуса примеров`
  - block `Ограничения`
  - `TOP мин.`, `TOP макс.`, `BOTTOM мин.`, `BOTTOM макс.`
  - `Запрещённые слова`
  - `Запрещённые начала`
  - owner-only block `Общие настройки`
  - owner-only block `Маршрутизация моделей Stage 2`
  - owner-only model controls:
    - `Stable Reference v6`
    - per-stage reasoning/model selects
    - repeated `Сбросить к продуктовым настройкам`
    - `Quick regenerate`
    - `Style discovery`
    - `Stage 3 planner`
- `related APIs`:
  - `PATCH /api/channels/[id]`
  - `POST /api/channels/style-discovery`
  - workspace defaults save through workspace endpoints

## Channel Manager tab: `Рендер`

- `purpose`: template selection and channel render defaults.
- `controls`:
  - template picker
  - background/music default selects
  - asset-dependent render defaults
- `related APIs`:
  - `PATCH /api/channels/[id]`
  - assets APIs

## Channel Manager tab: `Publishing`

- `purpose`: YouTube OAuth + destination + channel slot grid defaults.
- `default behavior`: новые каналы и fallback-state держат `notify subscribers` выключенным, пока оператор не включит его явно.
- `controls`:
  - section `YouTube`
  - button `Подключить YouTube` / `Переподключить YouTube`
  - button `Отключить`
  - select `Канал, куда публикуем`
  - button `Сохранить канал`
  - section `Слоты публикации`
  - `Таймзона`
  - `Первый слот`
  - `Слотов в день`
  - `Интервал, мин`
  - `Окно до upload, мин`
  - checkbox `По умолчанию включать чекбокс «Опубликовать» для новых рендеров`
  - checkbox `По умолчанию публиковать в фид подписок и уведомлять подписчиков`
  - button `Сохранить настройки`
- `related APIs`:
  - `POST /api/channels/[id]/publishing/youtube/connect`
  - `GET /api/channels/[id]/publishing/youtube/connection`
  - `POST /api/channels/[id]/publishing/settings`

## Channel Manager tab: `Ассеты`

- `purpose`: channel-scoped assets for avatar, background, music and render defaults.
- `controls`:
  - upload by asset kind
  - delete asset
  - select asset for defaults
- `related APIs`:
  - `GET /api/channels/[id]/assets`
  - `POST /api/channels/[id]/assets`
  - `DELETE /api/channels/[id]/assets/[assetId]`

## Channel Manager tab: `Доступ`

- `purpose`: grant/revoke channel operate access.
- `visibility`: только `owner` и `manager`.
- `controls`:
  - member list with role subtitle
  - dynamic button `Выдать рабочий доступ`
  - dynamic button `Отозвать`
- `related APIs`: `POST /api/channels/[id]/access`
- `entities`: `channel_access_grant`, `workspace member`
- `common user phrasings`:
  - "редактор не видит канал"
  - "ограниченному редактору случайно дали лишний доступ"

## `/team`

- `purpose`: управление участниками workspace и invite-ами.
- `roles`:
  - `owner`, `manager`: доступ
  - `redactor`, `redactor_limited`: forbidden screen
- `controls`:
  - `Назад`
  - list `Участники`
  - role combobox per member
  - block `Создать приглашение`
  - email field
  - invite role select
  - button `Создать приглашение`
  - inline token output
- `resulting actions`:
  - `GET /api/workspace/members`
  - `PATCH /api/workspace/members/[memberId]`
  - `POST /api/workspace/invites`
- `role nuances`:
  - owner может выдавать `manager`, `redactor`, `redactor_limited`
  - manager может переключать только между `redactor` и `redactor_limited`
  - owner/member combobox может быть disabled
- `common user phrasings`:
  - "не могу сделать менеджера"
  - "инвайт создался, но токен не видно"
  - "редактору пишет доступ запрещён"

## Internal design route: `/design/template-lab`

- `purpose`: pixel-perfect calibration workbench для reference-driven template matching.
- `surface class`: internal tooling, не ежедневный операторский flow.
- `browser-verified`: route открыт и рендерится в live инстансе.
- `controls`:
  - heading `Pixel-Perfect Workbench`
  - status chips `Repo-backed session`, template id, calibration state
  - section `Процесс`
  - section `Шаблоны` с template cards
  - section `Контент`:
    - `Верхний текст`
    - `Нижний текст`
    - `Канал`
    - `Handle`
    - `Top scale`
    - `Bottom scale`
    - status buttons `В очереди`, `В работе`, `На проверке`, `Утверждено`
  - compare mode buttons:
    - `Side by Side`
    - `Overlay`
    - `Difference`
    - `Split Swipe`
    - `Heatmap`
  - crop/alignment controls
  - button `Capture Snapshot`
  - buttons for session assets `reference.png`, `media.png`, `background.png`, `avatar.png`, `mask.png`
- `related APIs`:
  - `app/api/design/template-sessions/**`
  - `app/api/design/template-assets/**`
- `entities`: `template session`, `reference asset`, `report`, `artifact`
- `common user phrasings`:
  - "diff невалиден"
  - "reference missing"
  - "не пишет snapshot в репозиторий"

## Internal design route: `/design/template-road`

- `purpose`: live style editor для production template-а.
- `surface class`: internal tooling.
- `browser-verified`: рендерится как full editor даже в live instance.
- `controls`:
  - top summary chips
  - actions `Сбросить оформление`, `Сбросить демо-текст`, `Показать подсказки`, `Новый шаблон`
  - work actions `Сохранить версию`, `Удалить шаблон`
  - quick sections:
    - `Шаблон`
    - `История`
    - `Основа`
    - `Демо-текст`
    - `Карточка`
    - `Тень`
    - `Цвета`
    - `Шрифты`
    - `Отступы`
    - `Детали`
  - section `Текущий шаблон`:
    - `Открыть шаблон`
    - `Название шаблона`
    - `Примечание`
  - section `Версии шаблона`
  - section `Базовая компоновка`
  - section `Текст и highlight-профиль`
    - open by default
    - demo TOP/BOTTOM
    - highlight toggles / slots / colors / guidance
    - demo phrases expect exact substrings from the current demo copy, not semantic categories
  - section `Силуэт и оболочка`
  - section `Генератор тени`
  - section `Шрифты`
    - font family presets / custom stacks
    - line-height sliders for TOP/BOTTOM
  - dynamic shadow layer actions `Дублировать`, `Удалить`, `Добавить слой тени`
- `related APIs`:
  - `app/api/design/templates/**`
  - `app/api/design/template-style-presets/**`
- `entities`: `template`, `template version`, `style preset`
- `common user phrasings`:
  - "автосохранение сломалось"
  - "не сохраняется версия шаблона"
  - "редактор шаблонов поменял production preview"

## Internal design preview routes

### `/design/science-card`

- renderer-backed template preview page;
- принимает search params для template/text/scale/highlights/export;
- используется как dev/design scene, а не как операторский экран.

### `/design/badger-card`

- отдельная card scene с export mode;
- нужен для capture/export, а не для production operator workflow.

## Surface-to-API quick map

| Surface | Главные API |
| --- | --- |
| Login/Register/Invite/Bootstrap | `/api/auth/**` |
| Main shell boot | `/api/auth/me`, `/api/workspace`, `/api/channels` |
| Step 1 | `/api/pipeline/source`, `/api/pipeline/source-upload`, `/api/comments`, `/api/source-media` |
| Step 2 | `/api/pipeline/stage2`, `/api/pipeline/stage2/debug`, `/api/channels/[id]/feedback` |
| Step 3 | `/api/stage3/preview`, `/api/stage3/render`, `/api/stage3/agent/**`, `/api/stage3/workers/**` |
| Publishing | `/api/channels/[id]/publications`, `/api/publications/[id]/**` |
| Team | `/api/workspace/members/**`, `/api/workspace/invites` |
| Channel Manager | `/api/channels/**`, `/api/channels/[id]/access`, `/api/channels/[id]/assets/**`, `/api/channels/[id]/publishing/**` |
| Internal design tooling | `/api/design/**` |
