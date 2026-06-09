# Roles And Permissions

## Источники

- `browser-verified`: owner, manager, redactor, redactor_limited walkthrough в изолированной среде
- `code-verified`: [`lib/acl.ts`](/Users/neich/Documents/Macedonian Imperium/clips automations/lib/acl.ts), [`lib/team-store.ts`](/Users/neich/Documents/Macedonian Imperium/clips automations/lib/team-store.ts), [`lib/auth/guards.ts`](/Users/neich/Documents/Macedonian Imperium/clips automations/lib/auth/guards.ts), [`lib/channel-edit-permissions.ts`](/Users/neich/Documents/Macedonian Imperium/clips automations/lib/channel-edit-permissions.ts)
- `db-verified`: cloned SQLite data и seeded role accounts

## Поддерживаемые роли

| Роль | Системное имя | Смысл |
| --- | --- | --- |
| Владелец | `owner` | Полный контроль workspace |
| Управляющий | `manager` | Операционный администратор без owner-only прав |
| Редактор | `redactor` | Полный production flow по доступным каналам |
| Ограниченный редактор | `redactor_limited` | Операторские действия и ограниченные render/assets настройки без полного channel setup |

## Workspace-level permissions

| Permission | owner | manager | redactor | redactor_limited | Источник |
| --- | --- | --- | --- | --- | --- |
| Manage members | yes | yes | no | no | `team-store.ts`, browser `/team` |
| Manage Shared Codex integration | yes | no | no | no | `team-store.ts`, `workspace-codex.ts` |
| Manage Anthropic caption integration | yes | no | no | no | `team-store.ts`, `workspace-anthropic.ts` |
| Create channel | yes | yes | yes | no | `team-store.ts` |
| Manage any channel access | yes | yes | no | no | `team-store.ts`, `acl.ts` |
| View internal design routes | yes | yes | yes | no | browser + code pages |
| Inspect prompts, raw traces, debug artifacts, template editing internals | yes | yes | active channel Stage 2 setup only for editable channels | no | `sensitive-access.ts`, API tests |
| Use runtime template library and personal Stage 3 executor pairing | yes | yes | yes | yes, for granted channels | API tests, Step 3 flow |

## Channel-level permissions

`resolveChannelPermissions` в ACL определяет итоговые флаги.

| Channel permission | owner | manager | redactor | redactor_limited |
| --- | --- | --- | --- | --- |
| See channel | all | all | own or granted | granted only |
| Operate channel in daily flow | yes | yes | yes if visible | yes if granted |
| Edit channel setup | yes | yes | yes if visible | no |
| View/edit channel Stage 2 setup | yes | yes | yes if editable; workspace defaults stay read-only fallback | no |
| Manage channel access | yes | yes | no | no |
| Delete channel | yes | yes | only own channels | no |

## Route access matrix

| Route | owner | manager | redactor | redactor_limited | Notes |
| --- | --- | --- | --- | --- | --- |
| `/login` | public | public | public | public | До входа |
| `/register` | public | public | public | public | Self-serve регистрация закрыта, аккаунт не создаётся |
| `/accept-invite` | public | public | public | public | Роль берётся из invite |
| `/setup/bootstrap-owner` | public | public | public | public | Практически только до инициализации |
| `/` | allow | allow | allow | allow | Главный shell |
| `/team` | allow | allow | forbidden | forbidden | Browser-verified |
| `/admin/flows` | allow | forbidden | forbidden | forbidden | Owner observability |
| `/design/template-lab` | allow | allow | not found | not found | Internal tooling |
| `/design/template-road` | allow | allow | not found | not found | Internal tooling |
| `/design/science-card` | allow | allow | not found | not found | Preview route |
| `/design/badger-card` | allow | allow | not found | not found | Preview route |

## UI visibility matrix

## Overflow menu `Еще`

| Control | owner | manager | redactor | redactor_limited | Verification |
| --- | --- | --- | --- | --- | --- |
| `Каналы` | visible | visible | visible | visible when granted channel exists | browser-verified/code-verified |
| `Команда` | visible | visible | hidden | hidden | browser-verified |
| `Журнал процессов` | visible | hidden | hidden | hidden | code-verified |
| `Скачать историю` | visible | visible | visible | visible | browser-verified |

## User block

| Surface | owner | manager | redactor | redactor_limited | Notes |
| --- | --- | --- | --- | --- | --- |
| Role label in header | `Владелец` | `Менеджер` | `Редактор` | `Редактор (ограниченный)` | browser-verified |
| Shared Codex status line | visible | visible | visible | visible | browser-verified, current UI alias for baseline integration |
| Shared Codex reconnect/disconnect authority | full | limited / read-mostly | limited / read-mostly | limited / read-mostly | code-verified, owner verified live |

## Channel Manager modal

| Surface / control | owner | manager | redactor | redactor_limited | Verification |
| --- | --- | --- | --- | --- | --- |
| Open modal from overflow | yes | yes | yes | yes, limited mode | browser-verified/code-verified |
| See all channels in selector | yes | yes | no | no | browser + ACL |
| See only granted/own channels | n/a | n/a | yes | yes | code-verified, redactor verified |
| `Общие настройки` target | yes | no | no | no | browser-verified |
| `+ Новый канал` | yes | yes | yes | no | browser-verified |
| `Удалить канал` | yes | yes | conditional | no | browser + ACL |
| Tab `Бренд` | yes | yes | yes | hidden | browser-verified/code-verified |
| Tab `Stage 2` | yes | yes | yes | hidden | browser-verified/code-verified |
| Tab `Рендер` | yes | yes | yes | limited render defaults | browser-verified/code-verified |
| Tab `Publishing` | yes | yes | yes | hidden | browser-verified/code-verified |
| Tab `Ассеты` | yes | yes | yes | background/music upload + defaults only | browser-verified/code-verified |
| Download music assets | yes | yes | yes | yes, for granted channels | code-verified |
| Tab `Доступ` | yes | yes | no | no | browser-verified |
| Block `Caption provider` in `Общие настройки` | yes | no | no | no | browser + code |

## Team page `/team`

| Capability | owner | manager | redactor | redactor_limited |
| --- | --- | --- | --- | --- |
| View members list | yes | yes | no | no |
| Change owner role | no | no | n/a | n/a |
| Change manager role | yes | no | n/a | n/a |
| Toggle redactor ↔ redactor_limited | yes | yes | n/a | n/a |
| Remove manager | yes | no | n/a | n/a |
| Remove redactor / redactor_limited | yes | yes | n/a | n/a |
| Create manager invite | yes | no | n/a | n/a |
| Create redactor invite | yes | yes | n/a | n/a |
| Create redactor_limited invite | yes | yes | n/a | n/a |

## Step-by-step product flow permissions

## Step 1

| Capability | owner | manager | redactor | redactor_limited |
| --- | --- | --- | --- | --- |
| Insert source URL | yes | yes | yes | yes |
| Upload mp4 | yes | yes | yes | yes |
| Fetch source | yes | yes | yes | yes |
| Toggle auto-run Stage 2 | yes | yes | yes | yes |

## Step 2

| Capability | owner | manager | redactor | redactor_limited |
| --- | --- | --- | --- | --- |
| Run full Stage 2 | yes | yes | yes | yes |
| Quick regenerate | yes | yes | yes | yes |
| Select caption option | yes | yes | yes | yes |
| Select title option | yes | yes | yes | yes |
| Copy options | yes | yes | yes | yes |
| Submit channel feedback | yes | yes | yes if channel visible | yes if channel granted and flow open |
| Delete feedback event | yes | yes | conditional by UI callback | generally no channel admin tools |
| View Stage 2 diagnostics / debug details | yes | yes | no | no |
| Open raw Stage 2 debug artifact | yes | yes | no | no |

Примечание: feedback write path зависит не от workspace role, а от доступности канала и того, подключён ли callback на удаление/сохранение в конкретной surface state.

## Step 3

| Capability | owner | manager | redactor | redactor_limited |
| --- | --- | --- | --- | --- |
| Edit final TOP/BOTTOM | yes | yes | yes | yes |
| Edit timing/fragments | yes | yes | yes | yes |
| Upload background/music assets into draft | yes | yes | yes | yes |
| Import template backup into current draft | yes | yes | yes | yes |
| Export / render | yes | yes | yes | yes |
| Export JSON payload | yes | yes | no | no |
| Pair local executor | yes | yes | yes | yes |
| Open template customization tooling | yes | yes | no | no |
| Open version drawer | yes | yes | yes | yes |

## Publishing

| Capability | owner | manager | redactor | redactor_limited |
| --- | --- | --- | --- | --- |
| Edit per-publication metadata | yes | yes | yes | yes if publication visible |
| Shift slot/day | yes | yes | yes | yes if publication visible |
| Pause/resume/retry/delete publication | yes | yes | yes | yes if publication visible |
| Configure channel slot defaults | yes | yes | yes if can edit setup | no |
| Connect/disconnect YouTube for channel | yes | yes | no | no |
| Choose YouTube destination channel | yes | yes | no | no |

Примечание: `redactor` не управляет OAuth/destination setup, но Step 3 получает read-only readiness выбранного YouTube destination для доступных каналов, чтобы уже настроенная публикация не выглядела offline.

## Owner-only surfaces and controls

`owner` — единственная роль, которая одновременно:

- видит `Общие настройки` в Channel Manager;
- редактирует workspace-wide Stage 2 defaults;
- управляет workspace AI integrations на уровне workspace;
- видит owner-only `/admin/flows` и создаёт read-only MCP tokens для production flow observability;
- может выдавать роль `manager`;
- может управлять всеми каналами и всем team composition без ограничений.

## Manager-specific behavior

`manager` по UX почти совпадает с `owner`, но с двумя ключевыми ограничениями:

- нет owner-wide `Общие настройки`;
- нет owner-only управления workspace AI integrations как системной сущностью.

Зато `manager` всё ещё:

- видит `/team`;
- может выдавать `redactor` и `redactor_limited`;
- открывает Channel Manager на всех каналах;
- управляет tab `Доступ`.

## Redactor-specific behavior

`redactor` — это production editor с channel-level setup, но без workspace admin прав.

Browser-verified:

- в overflow видит `Каналы`, но не видит `Команда`;
- может открыть Channel Manager;
- видит только доступные ему каналы;
- не видит tab `Доступ`;
- на протестированных каналах кнопка `Удалить канал` была disabled.

Code-verified:

- может удалять только собственные каналы;
- может редактировать только не-sensitive setup тех каналов, которые ему видимы по ACL;
- не может читать или менять channel-level Stage 2 prompt/examples/hard constraints и другие внутренние Stage 2 настройки;
- не может управлять grants других пользователей.

Sensitive artifact access теперь owner/manager-only. Обычный `redactor` остаётся production editor по видимым каналам: runtime-шаблоны, sanitized history export и personal Stage 3 executor pairing доступны для ежедневной работы, но prompt config, raw debug artifacts, template editing internals, YouTube setup и внутренние Stage 2 настройки остаются закрыты.

## Redactor Limited behavior

`redactor_limited` — это оператор daily flow без полного channel setup.

Browser-verified:

- в overflow есть `Каналы`, если у пользователя есть granted channel;
- в overflow нет `Команда`;
- Channel Manager открывается только с вкладками `Рендер` и `Ассеты`;
- `/team` открывается как forbidden page;
- основной shell и шаги 1-3 доступны.

Code-verified:

- видит только granted channels;
- не создаёт канал;
- может менять только render defaults канала: `templateId`, `defaultBackgroundAssetId`, `defaultMusicAssetId`, `defaultClipDurationSec`;
- может загружать только background/music channel assets;
- не меняет бренд, Stage 2 setup, Publishing setup, YouTube/OAuth, avatar/default avatar и доступы;
- не выдаёт и не отзывает channel access;
- не удаляет канал.

## Hidden vs disabled vs forbidden

Эта разница критична для triage.

| Тип ограничения | Пример | Что означает для тикета |
| --- | --- | --- |
| Hidden | `redactor` не видит `Команда` | Вероятнее всего ACL/UI visibility, а не runtime failure |
| Disabled | `Удалить канал` видно, но disabled | Пользователь внутри правильной поверхности, но не проходит guard/precondition |
| Forbidden route | `/team` показывает `Доступ запрещён.` | Прямой route guard сработал корректно или ошибочно |

## Быстрые правила для intake-агента

1. Если пользователь говорит "у меня нет кнопки", сначала проверяйте role-specific hidden state.
2. Если пользователь говорит "кнопка есть, но серая", ищите disabled precondition.
3. Если пользователь говорит "меня выкидывает" или "страница запрещена", ищите route guard или missing membership.
4. Если `redactor_limited` с granted channel не видит Channel Manager или видит disabled import backup в `Рендер`, это regression в limited render/settings доступе.
5. Если `redactor` не видит granted channel, это почти всегда issue в `channel_access` или ACL resolution.
