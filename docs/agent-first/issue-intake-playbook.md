# Issue Intake Playbook

## Цель

Этот документ определяет, как AI-агент должен превращать свободный пользовательский текст в тикет, который можно сразу отдавать инженеру или PM без повторного интервью.

## Непереговоримый output

Каждый тикет должен содержать как минимум:

```yaml
reported_role:
reported_surface:
reported_route:
reported_control:
entity_kind:
entity_identifier:
preconditions:
expected:
actual:
repro_steps:
frequency:
impact:
evidence_needed:
evidence_collected:
verification_level:
probable_code_area:
probable_api_area:
permission_hypothesis:
state_hypothesis:
notes:
```

## Поля тикета

| Поле | Что записывать |
| --- | --- |
| `reported_role` | `owner` / `manager` / `redactor` / `redactor_limited` / `unknown` |
| `reported_surface` | человеко-понятное имя surface, например `Step 2`, `Channel Manager → Publishing` |
| `reported_route` | route или route-like surface, например `/team`, `/`, `modal:channel-manager` |
| `reported_control` | конкретный control, например `Перегенерировать варианты`, `Команда`, `Удалить канал` |
| `entity_kind` | `channel`, `chat`, `stage2_run`, `stage3_version`, `publication`, `invite`, `template` и т.д. |
| `entity_identifier` | channel name, username, run id, publication id, если известно |
| `preconditions` | что уже должно было произойти до бага |
| `expected` | что пользователь ждал |
| `actual` | что реально произошло |
| `repro_steps` | пошаговый сценарий |
| `frequency` | `always`, `sometimes`, `once`, `unknown` |
| `impact` | `blocker`, `high`, `medium`, `low` |
| `evidence_needed` | что ещё нужно собрать |
| `evidence_collected` | что уже есть из текста, скриншота, route, error text |
| `verification_level` | `browser-verified`, `code-verified`, `needs-confirmation` |
| `probable_code_area` | компонент / модуль |
| `probable_api_area` | endpoint group |
| `permission_hypothesis` | suspected ACL / role issue или `none` |
| `state_hypothesis` | suspected stale state / missing entity / failed job |
| `notes` | всё, что не вошло выше |

## Алгоритм intake

## Шаг 1. Выделить жалобу или запрос

Нужно понять, это:

- bug
- access issue
- UX confusion
- quality complaint
- enhancement request
- internal tooling issue

## Шаг 2. Определить role

Подсказки:

- "владелец", "owner" -> `owner`
- "менеджер", "управляющий" -> `manager`
- "редактор" -> `redactor`
- "ограниченный" -> `redactor_limited`
- если роль не названа, восстановить по surface:
  - видит `/team` и меняет роли -> owner/manager
  - не видит `Команда`, но видит `Каналы` -> redactor
  - не видит `Каналы` -> вероятно redactor_limited

## Шаг 3. Привязать к surface

Используйте маркеры:

| Маркер в сообщении | Surface |
| --- | --- |
| "ссылка на видео", "reels", "shorts", "mp4" | Step 1 |
| "варианты", "перегенерация", "лайк", "заголовок" | Step 2 |
| "превью", "executor", "камера", "финальный текст" | Step 3 |
| "очередь", "слот", "опубликовать" | Publishing Planner |
| "команда", "приглашение", "роль" | `/team` |
| "доступ к каналу", "выдать доступ" | Channel Manager → `Доступ` |
| "общие настройки", "stable reference", "модели" | Channel Manager → owner defaults |
| "template-lab", "overlay", "capture snapshot" | `/design/template-lab` |
| "шаблон", "тень", "цвета", "сохранить версию шаблона" | `/design/template-road` |

## Шаг 4. Выделить control

Нужно свести проблему к самому узкому контролу:

- не "сломался второй этап"
- а "кнопка `Перегенерировать варианты` disabled у `redactor` на видимом канале"

## Шаг 5. Определить сущность

Чаще всего это:

- `channel`
- `chat`
- `stage2_run`
- `caption_option`
- `title_option`
- `feedback_event`
- `stage3_version`
- `worker`
- `publication`
- `invite`
- `template`

## Шаг 6. Проверить, не является ли это ожидаемым role behavior

Примеры ожидаемого поведения:

- `redactor` не видит `Команда`
- `redactor_limited` не видит `Каналы`
- `/team` для редактора показывает `Доступ запрещён.`
- delete channel disabled для канала, который не принадлежит `redactor`

Если это ожидаемое поведение, не создавайте bug-трактовку автоматически. Вместо этого:

- пометьте как `expected_by_role_model`
- предложите UX/docs improvement, если пользователь закономерно путается

## Шаг 7. Собрать гипотезу

Всегда укажите как минимум одну гипотезу:

- permission issue
- stale client state
- failed backend job
- broken polling
- missing entity relation
- unguarded internal route
- regression in template/render pipeline

## Карта probable code area

| Surface | Вероятный code area |
| --- | --- |
| Login/Register/Invite/Bootstrap | [`app/login/page.tsx`](/Users/neich/Documents/Macedonian Imperium/clips automations/app/login/page.tsx), [`app/register/page.tsx`](/Users/neich/Documents/Macedonian Imperium/clips automations/app/register/page.tsx), [`app/accept-invite/page.tsx`](/Users/neich/Documents/Macedonian Imperium/clips automations/app/accept-invite/page.tsx), [`app/setup/bootstrap-owner/page.tsx`](/Users/neich/Documents/Macedonian Imperium/clips automations/app/setup/bootstrap-owner/page.tsx), `app/api/auth/**` |
| Shell header / history / menus | [`app/components/AppShell.tsx`](/Users/neich/Documents/Macedonian Imperium/clips automations/app/components/AppShell.tsx) |
| Step 1 | [`app/components/Step1PasteLink.tsx`](/Users/neich/Documents/Macedonian Imperium/clips automations/app/components/Step1PasteLink.tsx), `app/api/pipeline/source*`, `app/api/comments/route.ts` |
| Step 2 | [`app/components/Step2PickCaption.tsx`](/Users/neich/Documents/Macedonian Imperium/clips automations/app/components/Step2PickCaption.tsx), `lib/stage2-*`, `app/api/pipeline/stage2/**`, `app/api/channels/[id]/feedback/route.ts` |
| Step 3 | [`app/components/Step3RenderTemplate.tsx`](/Users/neich/Documents/Macedonian Imperium/clips automations/app/components/Step3RenderTemplate.tsx), `lib/stage3-*`, `app/api/stage3/**` |
| Publishing Planner | [`app/components/PublishingPlanner.tsx`](/Users/neich/Documents/Macedonian Imperium/clips automations/app/components/PublishingPlanner.tsx), `app/api/publications/**`, `app/api/channels/[id]/publications/route.ts` |
| Channel Manager | [`app/components/ChannelManager.tsx`](/Users/neich/Documents/Macedonian Imperium/clips automations/app/components/ChannelManager.tsx), [`app/components/ChannelManagerStage2Tab.tsx`](/Users/neich/Documents/Macedonian Imperium/clips automations/app/components/ChannelManagerStage2Tab.tsx), [`app/components/ChannelManagerPublishingTab.tsx`](/Users/neich/Documents/Macedonian Imperium/clips automations/app/components/ChannelManagerPublishingTab.tsx), `app/api/channels/**` |
| Team | [`app/team/page.tsx`](/Users/neich/Documents/Macedonian Imperium/clips automations/app/team/page.tsx), `app/api/workspace/**`, [`lib/team-store.ts`](/Users/neich/Documents/Macedonian Imperium/clips automations/lib/team-store.ts) |
| Role/visibility issues | [`lib/acl.ts`](/Users/neich/Documents/Macedonian Imperium/clips automations/lib/acl.ts), [`lib/team-store.ts`](/Users/neich/Documents/Macedonian Imperium/clips automations/lib/team-store.ts), [`lib/auth/guards.ts`](/Users/neich/Documents/Macedonian Imperium/clips automations/lib/auth/guards.ts) |
| Internal design tooling | [`app/components/Stage3TemplateLab.tsx`](/Users/neich/Documents/Macedonian Imperium/clips automations/app/components/Stage3TemplateLab.tsx), [`app/components/TemplateStyleEditor.tsx`](/Users/neich/Documents/Macedonian Imperium/clips automations/app/components/TemplateStyleEditor.tsx), `app/api/design/**` |

## Карта probable API area

| User complaint pattern | API area |
| --- | --- |
| Не могу войти / создать аккаунт | `/api/auth/**` |
| Не грузится источник / mp4 / комментарии | `/api/pipeline/source*`, `/api/comments`, `/api/source-media` |
| Не запускается второй этап | `/api/pipeline/stage2`, `/api/pipeline/stage2/debug` |
| Не сохраняется лайк/дизлайк | `/api/channels/[id]/feedback` |
| Не строится preview / render | `/api/stage3/preview*`, `/api/stage3/render*`, `/api/stage3/agent/**` |
| Executor offline | `/api/stage3/workers/**`, `/api/stage3/worker/**` |
| Публикация не двигается / не удаляется | `/api/publications/[id]/**` |
| Не создаётся invite / не меняется роль | `/api/workspace/members/**`, `/api/workspace/invites` |
| Не даёт доступ к каналу | `/api/channels/[id]/access` |
| Сломан template tooling | `/api/design/**` |

## Evidence checklist

Агент должен пытаться собрать следующее:

| Тип проблемы | Минимальные evidence |
| --- | --- |
| Hidden/forbidden control | роль, surface, какой control ожидался |
| Disabled button | control, текст tooltip/title, preconditions |
| Failed job | run/status id, screen state, error text |
| Wrong content in Step 2 | channel, option number, feedback history, expected editorial direction |
| Wrong preview/render | template, channel, version state, executor state, screenshot if possible |
| Publishing issue | publication status, schedule mode, channel publish settings, `lastError` |
| Team/invite issue | acting role, target role, invite token or member id |
| Internal tooling issue | route, template id, action button, saved artifact/version expectation |

## Default clarification prompts

Спрашивать только если без этого нельзя сделать качественный тикет.

### Для role/access issues

- Какая у вас роль в приложении?
- На каком экране это произошло?
- Кнопка отсутствует совсем или видна, но не нажимается?

### Для Step 2 issues

- Это было на `Перегенерировать варианты` или на `Полный прогон Stage 2`?
- Какая именно карточка ломается: `Вариант {n}` или `Заголовок {n}`?
- Лайк/дизлайк сохранился или открылся с ошибкой?

### Для Step 3 issues

- Проблема в live preview, в экспорте или в локальном executor?
- Это произошло на текущем draft, после сохранённой версии или после rollback?

### Для publishing issues

- Это слот-публикация или точное время?
- Проблема с самим queue item или с настройками канала в Publishing?

## Триаж: expected behavior vs bug

Создавайте `bug` только если хотя бы одно из условий выполнено:

1. control должен быть доступен по role model, но скрыт или forbidden;
2. control виден и активен, но действие не совершает ожидаемого изменения состояния;
3. job уходит в ошибку или зависает без recoverable path;
4. UI и backend расходятся;
5. internal tooling ломает downstream production behavior.

Помечайте как `expected behavior / docs gap`, если:

1. пользователь просит доступ, которого у роли нет по модели;
2. surface скрыт намеренно;
3. disabled state соответствует корректному precondition;
4. пользователь путает operator flow и internal tooling.

## Примеры хороших тикетов

## Пример 1. Role visibility bug

```yaml
reported_role: redactor
reported_surface: "Shell overflow menu"
reported_route: "/"
reported_control: "Каналы"
entity_kind: channel
entity_identifier: "Test @Test"
preconditions: "Пользователь вошёл как redactor и имеет grant к каналу"
expected: "В overflow меню должна быть кнопка открытия Channel Manager"
actual: "Кнопки Каналы нет, остаётся только Скачать историю"
repro_steps:
  - "Войти как redactor"
  - "Открыть /"
  - "Нажать Еще"
frequency: always
impact: high
evidence_needed:
  - "Скрин меню"
  - "Подтверждение роли"
evidence_collected:
  - "Пользователь явно назвал роль redactor"
verification_level: browser-verified
probable_code_area:
  - "app/components/AppShell.tsx"
  - "lib/acl.ts"
probable_api_area:
  - "/api/auth/me"
permission_hypothesis: "UI incorrectly resolved canManageChannels-like visibility for redactor"
state_hypothesis: "ACL or client role state mismatch"
notes: "По текущей документации redactor должен видеть Каналы"
```

## Пример 2. Step 2 quality + feedback issue

```yaml
reported_role: redactor
reported_surface: "Step 2"
reported_route: "/"
reported_control: "Перегенерировать варианты"
entity_kind: stage2_run
entity_identifier: "channel=Science Snack, option=3"
preconditions: "Пользователь сохранил дизлайк whole option с note"
expected: "Новый shortlist должен заметно оттолкнуться от отвергнутой позы"
actual: "После quick regenerate пришли почти те же варианты"
frequency: sometimes
impact: medium
verification_level: needs-confirmation
probable_code_area:
  - "app/components/Step2PickCaption.tsx"
  - "lib/stage2-quick-regenerate.ts"
  - "lib/stage2-channel-learning.ts"
probable_api_area:
  - "/api/channels/[id]/feedback"
  - "/api/pipeline/stage2"
permission_hypothesis: none
state_hypothesis: "feedback saved but retrieval/memory resolution did not influence shortlist strongly enough"
```

## Пример 3. Publishing failure

```yaml
reported_role: manager
reported_surface: "Publishing Planner"
reported_route: "/"
reported_control: "Опубликовать сейчас"
entity_kind: publication
entity_identifier: "publication status=failed"
preconditions: "YouTube already connected and destination selected"
expected: "Publication should move to uploading/published"
actual: "Card stays failed and shows lastError"
frequency: always
impact: high
verification_level: needs-confirmation
probable_code_area:
  - "app/components/PublishingPlanner.tsx"
  - "lib/youtube-publishing.ts"
probable_api_area:
  - "/api/publications/[id]/publish-now"
permission_hypothesis: none
state_hypothesis: "YouTube integration is connected but channel publish state or upload path is invalid"
```

## Когда эскалировать как security / permissions issue

Немедленно повышайте приоритет, если:

- пользователь видит internal admin surface, который по role model должен быть hidden;
- `redactor_limited` может менять channel setup;
- любой non-owner управляет shared Codex как owner-level сущностью;
- route guard пропускает на `/team` неподходящую роль;
- internal design tooling unexpectedly public и меняет production artifacts.
