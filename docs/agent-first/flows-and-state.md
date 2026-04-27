# Flows And State

## Как использовать этот документ

Этот файл нужен intake-агенту для случаев, когда пользователь описывает не экран, а последовательность:

- "я вставил ссылку, потом оно зависло"
- "после выбора варианта всё сломалось"
- "экзекьютор подключил, но рендер не пошёл"
- "ролик уже был в очереди, а потом пропал"

Для каждого flow ниже указаны:

- `happy path`
- `alternate path`
- `blocked path`
- `failure / recovery path`
- `ключевые состояния`

## 1. Auth: login

### Happy path

1. Пользователь открывает `/login`.
2. Вводит email и password.
3. Нажимает `Войти`.
4. `POST /api/auth/login` возвращает session cookie.
5. UI делает redirect на `/`.
6. Главный shell грузит `/api/auth/me` и workspace context.

### Alternate path

1. Пользователь уже имеет активную session cookie.
2. При повторном входе попадает сразу в `/`.

### Blocked path

1. Пароль неверный.
2. Email не существует.
3. Session cookie не ставится из-за server-side проблемы.

### Failure / recovery

1. Пользователь видит inline error.
2. Агенту нужны:
  - email роли;
  - точное сообщение ошибки;
  - было ли перенаправление на `/`.

### Ключевые состояния

- anonymous
- authenticating
- authenticated
- auth_failed

## 2. Auth: public register

### Happy path

1. Пользователь открывает `/register`.
2. Заполняет имя, email, password.
3. Нажимает `Создать аккаунт`.
4. Получает активный `redactor`.
5. Попадает в `/`.

### Alternate path

1. Имя может быть пустым.
2. Workspace membership создаётся по default flow.

### Blocked path

1. Email уже занят.
2. Сервер не смог создать membership.

### Failure / recovery

1. Агент проверяет: это self-register или invite flow.
2. Если нужен `manager` или `redactor_limited`, self-register не подходит; нужен invite.

## 3. Auth: accept invite

### Happy path

1. Администратор создаёт invite на `/team`.
2. Пользователь открывает `/accept-invite`.
3. Вставляет токен, задаёт displayName и password.
4. Система создаёт пользователя с ролью invite.
5. Пользователь входит в `/`.

### Alternate path

1. Display name может быть произвольным.
2. Invite может выдавать `manager`, `redactor`, `redactor_limited`.

### Blocked path

1. Invite token не существует.
2. Invite уже использован.
3. Invite отозван или протух.

### Failure / recovery

1. Агенту нужны:
  - роль invite;
  - токен был создан только что или давно;
  - видел ли пользователь успешный вход после accept.

## 4. Auth: bootstrap owner

### Happy path

1. Новый инстанс без owner открывает `/setup/bootstrap-owner`.
2. Запрашивается bootstrap status.
3. Пользователь заполняет workspace name, email, password.
4. При необходимости добавляет bootstrap secret.
5. Система создаёт первого owner и workspace.
6. Redirect на `/`.

### Alternate path

1. На локальном/dev окружении bootstrap secret может не требоваться.

### Blocked path

1. Owner уже существует.
2. Secret обязателен, но не передан.

### Failure / recovery

1. Если пользователь видит `Владелец уже существует`, это не auth bug, а terminal state bootstrap flow.
2. Если owner не создаётся на свежей базе, ищите env/config issue.

## 5. Team management

### Happy path

1. `owner` или `manager` открывает `/team`.
2. Список участников грузится из `/api/workspace/members`.
3. Администратор меняет роль через combobox или создаёт invite.
4. UI показывает `Роль обновлена.` или `Приглашение создано.`

### Alternate path

1. `owner` может делать `manager`.
2. `manager` может переключать только `redactor` и `redactor_limited`.

### Blocked path

1. `redactor` или `redactor_limited` открывает `/team`.
2. Получает page-level forbidden surface.

### Failure / recovery

1. Если жалоба звучит как "не могу выдать менеджера", проверьте, не `manager` ли это пытается сделать.
2. Если invite создан, но пользователь ждал email, это не баг: v1 показывает token прямо на странице.

### Ключевые состояния

- can_manage_members
- forbidden
- busy_updating_role
- busy_creating_invite
- invite_token_ready

## 6. Channel creation and onboarding wizard

### Happy path

1. Роль с `canCreateChannel` открывает Channel Manager.
2. Нажимает `+ Новый канал`.
3. Проходит 4 шага wizard:
  - базовый канал;
  - базовый Stage 2;
  - reference links;
  - style directions.
4. Система создаёт channel и при необходимости style discovery context.

### Alternate path

1. Пользователь может закончить с базовым конфигом, а потом донастроить Stage 2 в Channel Manager.
2. Style directions можно регенерировать повторно.

### Blocked path

1. `redactor_limited` не видит вход в Channel Manager и не может создать канал.
2. Невалидные reference links ломают style discovery.

### Failure / recovery

1. Если пользователь говорит "wizard не заканчивается", нужно выяснить, на каком из 4 шагов.
2. Если проблема в directions, это может быть bug в style-discovery run, а не в самом wizard UI.

### Ключевые состояния

- wizard_open
- wizard_step_1..4
- style_discovery_running
- style_discovery_ready
- channel_created

## 7. Channel access management

### Happy path

1. `owner` или `manager` открывает Channel Manager tab `Доступ`.
2. Нажимает `Выдать рабочий доступ` или `Отозвать`.
3. ACL для канала обновляется.
4. Пользователь начинает или перестаёт видеть канал в selector/manager.

### Alternate path

1. Full `redactor` может видеть канал, если он creator, даже без grant.
2. `redactor_limited` всегда зависит от явного grant.

### Blocked path

1. `redactor` не видит tab `Доступ`.
2. `redactor_limited` вообще не видит вход в Channel Manager.

### Failure / recovery

1. Если редактор не видит канал, проверьте:
  - роль;
  - creator ли он;
  - есть ли запись в `channel_access`;
  - нет ли stale client state.

## 8. Step 1: source ingest

### Happy path

1. Пользователь вставляет URL или загружает mp4.
2. Нажимает `Получить источник`.
3. Source job создаётся и идёт до ready state.
4. При включённом auto-run запускается Stage 2.
5. Shell переводит chat к следующему шагу.

### Alternate path

1. Source можно загрузить как mp4 вместо external URL.
2. Если выбрано несколько mp4, Step 1 сначала собирает composite uploaded source и затем запускает обычный source job.
3. Комментарии могут быть недоступны, но Step 1 всё равно завершится.
4. Активный chat может быть переиспользован вместо создания нового.

### Blocked path

1. Нет source URL и нет mp4.
2. Runtime capability не позволяет upload/fetch.
3. Required workspace AI integration/provider не ready, поэтому auto-run не запускает Stage 2.
4. Текущий UI чаще всего формулирует этот blocked state как `Shared Codex не подключен`, даже если operator говорит в терминах caption provider.

### Failure / recovery

1. Если пользователь говорит "завис Step 1", проверьте:
  - source job detail;
  - есть ли source preview;
  - comments acquisition state;
  - активен ли reuse existing chat.

### Ключевые состояния

- no_source
- source_fetching
- source_ready
- comments_partial
- source_failed

## 9. Step 2: full run

### Happy path

1. Пользователь приходит на Step 2 с готовым source.
2. Нажимает `Полный прогон Stage 2`.
3. Пайплайн идёт по этапам.
4. Появляются caption options, title options, SEO.
5. Пользователь выбирает caption и title.
6. Выбранные значения уходят в Stage 3 handoff.

### Alternate path

1. Stage 2 может работать без comments payload.
2. Native caption v3 surface может показывать richer badges и bilingual blocks.
3. Run warnings могут существовать даже при usable shortlist.
4. Length-only hard-constraint misses больше не блокируют Step 3 handoff: оператор всё равно может открыть Step 3 и вручную дочистить текст там.
5. Owner может оставить весь run на Shared Codex или перевести eligible caption-writing stages на Anthropic через `Caption provider`.

### Blocked path

1. Нет source.
2. Уже идёт attached Stage 2 run.
3. Есть run-blocked reason от runtime/guard.
4. Workspace integration/provider не ready:
  - baseline Shared Codex не подключён;
  - или выбран `Anthropic API`, но owner не завершил setup / verification key.

### Failure / recovery

1. Если run упал, UI показывает failed stage и history run pills.
2. Recovery обычно один из трёх:
  - quick regenerate;
  - full rerun;
  - ручная диагностика warnings/prompt/debug.
3. Для integration-related failure agent должен различать:
  - broken baseline Shared Codex integration;
  - broken Anthropic overlay только на eligible caption stages;
  - stale operator interpretation, когда UI alias `Shared Codex` подменяет более широкий runtime issue.

### Ключевые состояния

- idle
- running
- completed
- degraded_success
- failed
- attached_run_without_result

## 10. Step 2: quick regenerate and feedback loop

### Happy path

1. Пользователь смотрит варианты.
2. Оставляет `👍` / `👎` по option или по полям `TOP` / `BOTTOM`.
3. Добавляет note mode и note text.
4. Нажимает `Сохранить`.
5. Затем жмёт `Перегенерировать варианты`.
6. Новый shortlist учитывает feedback history.

### Alternate path

1. Можно не оставлять note, а дать только signal.
2. Можно отправить `soft_preference`, `hard_rule`, `situational_note`.

### Blocked path

1. Feedback composer открыт, но callback save/delete отсутствует.
2. Пользователь не имеет доступа к этому каналу.

### Failure / recovery

1. Если редактор говорит "лайк не повлиял", нужно отличать:
  - feedback save issue;
  - retrieval / model reasoning issue;
  - ожидание пользователя, что выбор варианта сам по себе создаёт memory signal.
2. Важно: простой `Выбрать` не равен explicit feedback event.

## 11. Step 3: preview editing

### Happy path

1. Step 2 handoff передаёт caption/title в Step 3.
2. Live preview строится на каноническом 6-секундном timeline.
3. Пользователь правит TOP/BOTTOM, typography, background, audio, fragments.
4. Если нужны цветные слова, Step 3 показывает текущий highlight-status шаблона, напоминает что demo phrases из template-road не красят Step 3 напрямую, и ведёт в template customization; сами spans по-прежнему приходят из Stage 2.
5. При ручной правке TOP/BOTTOM соответствующий блок highlight-spans очищается, чтобы preview/render не использовали stale offsets.
6. Preview обновляется.
7. Пользователь экспортирует или запускает render.

### Alternate path

1. Можно оставить цельный клип.
2. Можно перейти к fragment mode и собрать окно вручную.
3. Background может быть:
  - source blur
  - custom asset
  - built-in backdrop
  - fallback

### Blocked path

1. Нет исходника.
2. Preview job не стартует.
3. Required asset missing.

### Failure / recovery

1. Если preview frozen:
  - проверьте preview job state;
  - проверьте version/draft divergence;
  - проверьте executor vs hosted preview path.
2. Если пользователь жалуется на "съехала камера", ищите fragment/timeline/manual focus state, а не только text changes.

### Ключевые состояния

- live_draft
- manual_caption_override
- preview_pending
- preview_ready
- render_pending
- render_ready
- render_failed

## 12. Step 3: versions and rollback

### Happy path

1. Пользователь открывает drawer версий.
2. Видит diff summary и internal passes.
3. Выбирает version или делает rollback.
4. Live draft переключается на нужное состояние.

### Alternate path

1. Можно оставаться на unsaved live draft.
2. Внутри version доступны internal passes для детального анализа.

### Blocked path

1. Нет сохранённых версий.
2. Rollback не проходит.

### Failure / recovery

1. Если пользователь говорит "пропала версия", уточняйте:
  - это saved version или live draft;
  - был ли rollback;
  - обновился ли selected version state в drawer.

## 13. Local executor pairing

### Happy path

1. Пользователь нажимает `Подключить executor`.
2. Выбирает `Mac` или `Windows`.
3. Нажимает `Подготовить команду`.
4. Копирует команду.
5. Запускает её на своей машине.
6. Worker проходит auth/pairing/heartbeat.
7. UI показывает `Online`.

### Alternate path

1. Если зависимости отсутствуют, пользователь копирует install command.
2. Можно обновить pair command повторно.

### Blocked path

1. Pairing command не создаётся.
2. Worker не heartbeat-ит.
3. Platform mismatch или dependency missing.

### Failure / recovery

1. Для жалоб про executor нужны:
  - OS;
  - был ли pair command;
  - что пишет terminal/PowerShell;
  - обновился ли статус в браузере.

## 14. Publishing queue

### Happy path

1. Канал подключён к YouTube и выбран destination.
2. У канала сохранены publish slot settings.
3. Новый render попадает в ближайший свободный слот.
4. Пользователь при необходимости редактирует метаданные публикации.
5. Publication доходит до queued/scheduled/published.

### Alternate path

1. Публикацию можно перевести в `Точное время`.
2. Можно двигать queued item по слотам и дням.
3. Можно вручную `Опубликовать сейчас`.

### Blocked path

1. YouTube не подключён.
2. Destination channel не выбран.
3. Slot grid невалидна или изменилась после постановки.

### Failure / recovery

1. Если публикация failed:
  - проверить `lastError`;
  - статус YouTube connection;
  - не locked ли `notifySubscribers`;
  - можно ли `Повторить`.
2. Если "ролик пропал из очереди", отличайте:
  - `canceled` / deleted;
  - moved to custom time;
  - published;
  - view/filter confusion.

### Ключевые состояния

- queued
- uploading
- scheduled
- published
- failed
- paused
- canceled

## 15. Channel publishing settings

### Happy path

1. Администратор открывает Channel Manager → `Publishing`.
2. Подключает или переподключает YouTube.
3. Выбирает destination channel.
4. Настраивает timezone, first slot, daily slots, interval, upload lead.
5. Сохраняет настройки.

### Alternate path

1. Можно отключить интеграцию.
2. Можно менять auto-queue и notify-subscribers defaults отдельно от queue items.

### Blocked path

1. Роль не может edit setup.
2. OAuth требует reauth.
3. Google project ограничения мешают публичной публикации.

### Failure / recovery

1. Если пользователь говорит "YouTube подключён, но не публикует", проверьте три разных состояния:
  - OAuth connected?
  - destination selected?
  - publish settings saved?

## 16. Internal template calibration flow

### Happy path

1. Пользователь открывает `/design/template-lab`.
2. Выбирает template.
3. Загружает reference/session assets.
4. Выставляет compare mode, alignment и crop.
5. Нажимает `Capture Snapshot`.
6. Repo-backed artifacts и report обновляются.

### Alternate path

1. Можно только смотреть overlay/diff, не записывая snapshot.
2. Можно переключать template status между queue/review/approved states.

### Blocked path

1. `reference.png` отсутствует.
2. Diff invalid.
3. Capture disabled.

### Failure / recovery

1. Жалобы на template-lab почти всегда internal-tooling tickets и не должны уходить как operator UX bug.

## 17. Internal template editing flow

### Happy path

1. Пользователь открывает `/design/template-road`.
2. Выбирает template.
3. Секция `Текст и highlight-профиль` открыта сразу и даёт живой demo для Stage 2 / Stage 3.
4. Пользователь правит inspector sections, включая TOP/BOTTOM line-height и highlight slots; demo phrases используются как exact preview-substrings, а общая семантика цветов описывается через guidance.
5. Автосохранение применяет изменения.
6. После правки highlight-профиля оператор возвращается в основной flow и заново запускает Stage 2, если хочет получить новые цветные spans в Step 3.
7. При необходимости сохраняет version.

### Alternate path

1. Можно reset style.
2. Можно reset demo content.
3. Можно работать только с shadow/color/type/spacing sections.

### Blocked path

1. Template не выбран.
2. Save version disabled.
3. Delete template disabled.

### Failure / recovery

1. Если "редактор шаблонов поменял прод", это high-priority internal tooling issue, потому что template changes влияют на Step 3 preview/render downstream.

## 18. Owner flow observability

### Happy path

1. `owner` открывает `/admin/flows` из overflow menu `Еще`.
2. UI загружает redacted workspace flow summaries через `GET /api/admin/flows`.
3. Владелец фильтрует по каналу, stage, статусу или URL/run/publication id.
4. При выборе строки открывается detail panel с timeline, prompts, outputs, publication state и raw JSON.
5. `Trace JSON` выгружает redacted single-flow trace.
6. При необходимости owner создаёт MCP token и подключает `npm run mcp:flows` через `CLIPS_APP_URL` / `CLIPS_MCP_TOKEN`.

### Blocked path

1. Любая non-owner роль получает forbidden UI/API.
2. Revoked/expired MCP token не может читать flow APIs.
3. Секреты не отображаются даже owner/MCP reader-у; prompt/model/provider diagnostics остаются видимыми.

### Deleted video log

1. Удаление публикации фиксируется compact audit event-ом.
2. Для scheduled YouTube video дополнительно фиксируется remote delete attempted/succeeded/failed.
3. Deleted video event не обязан хранить полный Stage 2 / Stage 3 trace.

## 19. Global failure taxonomy

Для intake-агента это базовая развилка:

| Симптом | Вероятный слой |
| --- | --- |
| Нет route / forbidden | auth / ACL / guard |
| Нет кнопки | role visibility / feature gating |
| Кнопка disabled | precondition / missing entity state |
| Нажал, но ничего не произошло | client event / API failure / stale run attachment |
| Появился текст ошибки | backend/API surfaced failure |
| Surface показывает старые данные | polling / refresh / cache / attached run mismatch |
| Переехал preview | Stage 3 draft / template / fragment timeline |
| Пропал канал | ACL / grants / creator ownership / selector state |
