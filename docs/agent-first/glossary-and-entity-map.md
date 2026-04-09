# Glossary And Entity Map

## Зачем это нужно

Пользователи редко говорят в терминах внутренней модели. Они пишут:

- "очередь"
- "варианты"
- "wizard"
- "preview"
- "экзекьютор"
- "слоты"
- "шаблон"

Задача intake-агента: перевести это в точные product entities, surfaces и code areas.

## Карта пользовательских слов

| Что говорит пользователь | Что это обычно значит | Где искать |
| --- | --- | --- |
| "очередь" | `publication queue` | Publishing Planner, `/api/publications/**` |
| "ролик в очереди" | `publication` со статусом `queued` или `scheduled` | Publishing Planner |
| "слот" | элемент channel publish grid | Channel Manager → Publishing, planner edit form |
| "таймслот" | то же, что `slot` | Publishing |
| "точное время" | `scheduleMode = custom` | Publication edit form |
| "автопостинг" | channel publishing defaults + YouTube integration | Channel Manager → Publishing |
| "канал" | чаще всего `Channel`, иногда YouTube destination channel | Shell selector или Channel Manager |
| "канал ютуба" | `selectedYoutubeChannelId` / destination | Channel Manager → Publishing |
| "доступ к каналу" | `channel access grant` | Channel Manager → Доступ |
| "редактор / ограниченный редактор" | `redactor` / `redactor_limited` | `/team`, ACL |
| "управляющий" | `manager` | `/team`, workspace roles |
| "owner" / "владелец" | `owner` | bootstrap, team, workspace defaults |
| "wizard" | Channel onboarding wizard | `+ Новый канал` |
| "референсы" | reference links для style discovery или template calibration assets | Channel onboarding / Stage 2 tab / template-lab |
| "варианты" | caption options Step 2 | Step 2 `Вариант {n}` |
| "заголовки" | title options Step 2 | Step 2 `Заголовок {n}` |
| "память канала" | feedback history + editorial memory | Step 2 diagnostics, Stage 2 tab |
| "лайк/дизлайк" | explicit channel feedback event | Step 2 feedback controls |
| "выбрать вариант" | set selected caption option | Step 2 card action `Выбрать` |
| "перегенерировать" | quick regenerate shortlist | Step 2 |
| "полный прогон" | rerun full Stage 2 pipeline | Step 2 |
| "история запусков" | Stage 2 run history | Step 2 run pills |
| "превью" / "preview" | live Stage 3 preview | Step 3 |
| "единый preview" | canonical 6-second Stage 3 preview | Step 3 |
| "черновик" / "draft" | live unsaved Stage 3 state | Step 3 |
| "версия" | saved Stage 3 version или template version | Step 3 drawer / template-road |
| "internal passes" | agent/internal Stage 3 pass breakdown | Step 3 versions drawer |
| "executor" / "локальный помощник" | paired Stage 3 worker | Step 3 executor modal |
| "локальный рендер" | render through local executor | Step 3 |
| "фрагменты" | source segments on Step 3 timeline | Step 3 timing/camera section |
| "камера" | vertical focus / framing controls | Step 3 |
| "фон" | background mode or background asset | Step 3 or channel render defaults |
| "музыка" | music asset + gain + source audio toggle | Step 3 |
| "ассеты" | uploaded channel assets | Channel Manager → Ассеты |
| "стиль канала" | Stage 2 style profile and directions | Channel Manager → Stage 2 |
| "направления" | style directions generated from references | Stage 2 tab / onboarding step 4 |
| "корпус" | example corpus JSON for Stage 2 | Stage 2 tab |
| "ограничения" | hard constraints for TOP/BOTTOM and banned phrases | Stage 2 tab |
| "линия" / "формат пайплайна" | selected Stage 2 worker profile | Stage 2 tab |
| "модели" | workspace Stage 2 / Stage 3 routing | owner `Общие настройки` |
| "template-lab" | calibration workbench | `/design/template-lab` |
| "template-road" | live template style editor | `/design/template-road` |
| "шаблон" | Stage 3 visual template or template record | Step 3 render config / internal design tooling |

## Главные сущности продукта

## Workspace

- контейнер команды, shared Codex и owner-wide defaults;
- пользователь почти никогда не называет его прямо;
- сигналы:
  - "у всей команды сломалось одно и то же"
  - "у всех каналов одинаковая проблема"

## Membership

- связь `user` ↔ `workspace` + роль;
- пользователь обычно описывает это как "мне выдали роль", "меня сделали менеджером".

## Channel

- основная рабочая единица;
- несёт:
  - бренд;
  - Stage 2 config;
  - render defaults;
  - publish settings;
  - assets;
  - grants.

Типовые пользовательские формулировки:

- "мой канал"
- "канал не отображается"
- "канал не публикует"
- "бренд канала слетел"

## Chat

- один рабочий цикл по одному source video;
- пользователь чаще говорит:
  - "этот ролик"
  - "этот кейс"
  - "карточка в истории"
  - "текущий flow"

## Source job

- fetch/upload/normalization на Step 1;
- слова пользователя:
  - "источник"
  - "ссылка"
  - "shorts/reels"
  - "mp4"

## Stage 2 run

- генерация caption/title/SEO shortlist;
- пользовательские слова:
  - "второй этап"
  - "варианты"
  - "перегенерация"
  - "запуск"

## Feedback event

- explicit editorial signal, не равен простому выбору варианта;
- пользовательские слова:
  - "лайк"
  - "дизлайк"
  - "заметка"
  - "правило для канала"

## Stage 3 draft

- живое монтажное состояние;
- слова:
  - "превью"
  - "финальный текст"
  - "тайминг"
  - "камера"
  - "монтаж"

## Stage 3 version

- сохранённая контрольная точка Step 3;
- слова:
  - "версия"
  - "откат"
  - "история версий"

## Executor / Worker

- локальный процесс на компьютере пользователя;
- слова:
  - "executor"
  - "локальный помощник"
  - "локальный рендер"
  - "мой компьютер"

## Publication

- YouTube публикация, рождённая из render-а;
- слова:
  - "очередь"
  - "публикация"
  - "слот"
  - "тайм"
  - "выложить сейчас"

## Template

- visual template Stage 3;
- два разных продуктовых смысла:
  - production template для render-а;
  - internal design asset для calibration/editing.

Агент должен различать:

- "шаблон рендера в Step 3" — operator-facing;
- "template-lab / template-road" — internal tooling.

## Карта ambiguous phrases

## "Канал"

Может означать одно из трёх:

1. production `Channel` в selector;
2. YouTube destination channel;
3. просто тему/бренд, без понимания внутренней модели.

Нужно уточнять контекст:

- "выбираю канал сверху" — shell selector
- "куда публикуем" — YouTube destination
- "канал не выглядит как раньше" — brand/style/template defaults

## "Очередь"

Может означать:

1. publication queue;
2. список history chats;
3. очередь internal template statuses `В очереди`.

Самый частый смысл: publication queue.

## "История"

Может означать:

1. history panel по chat-ам;
2. история запусков Stage 2;
3. история версий Step 3;
4. история версий template в template-road.

Уточнение строится вокруг вопроса "что именно пользователь ожидал увидеть в истории".

## "Удалить"

Может означать:

1. delete chat/history item;
2. delete channel;
3. delete feedback event;
4. delete publication from queue;
5. delete shadow layer or template record in internal tooling.

## "Не работает рендер"

Обычно один из слоёв:

1. preview не строится;
2. export/render button не запускает job;
3. local executor offline;
4. final artifact не открывается;
5. template changed and visually broke render.

## "Не видит"

Это почти всегда одна из четырёх вещей:

1. route forbidden;
2. control hidden by role;
3. entity missing from selector/list;
4. stale polling/client state.

## Триггеры для правильного маппинга

| Фраза | Скорее всего surface |
| --- | --- |
| "кнопка команда" | overflow menu |
| "ссылка на видео" | Step 1 |
| "вариант 3" | Step 2 caption card |
| "заголовок 2" | Step 2 title card |
| "лайк на top" | Step 2 field-level feedback |
| "вернуть цельный клип" | Step 3 fragment editor |
| "executor online/offline" | Step 3 worker modal |
| "по слотам / точное время" | publication edit form |
| "общие настройки" | owner-only Channel Manager target |
| "stable reference" | owner Stage 2 routing controls |
| "capture snapshot" | template-lab |
| "сохранить версию шаблона" | template-road |

## Короткий словарь для тикета

Когда агент создаёт тикет, лучше использовать эти canonical names:

| User wording | Ticket wording |
| --- | --- |
| "очередь" | `publication queue` |
| "варианты" | `stage2 caption options` |
| "заголовки" | `stage2 title options` |
| "экзекьютор" | `stage3 local executor` |
| "превью" | `stage3 live preview` |
| "wizard" | `channel onboarding wizard` |
| "направления" | `channel style directions` |
| "история роликов" | `chat history panel` |
| "история запусков" | `stage2 run history` |
| "история версий" | `stage3 version drawer` or `template version history` |
