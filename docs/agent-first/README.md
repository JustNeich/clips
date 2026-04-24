# Agent-First Documentation

## Назначение

Этот набор документов нужен не для обучения пользователя, а для работы AI-агента, который:

1. принимает жалобы, пожелания и баг-репорты по приложению;
2. понимает, о каком экране, контроле, шаге пайплайна или роли говорит пользователь;
3. нормализует это в тикет с корректным `surface`, `control`, `entity`, `role`, `expected`, `actual`, `probable_code_area`.

Ключевой принцип: агент должен мыслить не только страницами, но и состояниями, guard-ами, скрытыми контролами, фоновыми задачами и role-specific UI.

## Что входит в набор

| Файл | Роль |
| --- | --- |
| `docs/agent-first/README.md` | Точка входа: карта продукта, источники истины, route map, правила эскалации |
| `docs/agent-first/surfaces-and-navigation.md` | Все UI-поверхности, модалки, вкладки, меню, кнопки, поля, шаблоны действий |
| `docs/agent-first/roles-and-permissions.md` | Полная матрица ролей `owner` / `manager` / `redactor` / `redactor_limited` |
| `docs/agent-first/flows-and-state.md` | Сквозные happy-path, alternate-path, blocked-path и recovery-path по всему приложению |
| `docs/agent-first/glossary-and-entity-map.md` | Перевод пользовательского языка в доменные сущности и UI-термины |
| `docs/agent-first/issue-intake-playbook.md` | Как превращать жалобу или запрос в тикет инженерного качества |

## Терминология и alias-ы

- `Shared Codex` = текущее UI имя baseline workspace AI integration.
- `Connect Codex` = owner-managed device-auth control для этой baseline integration.
- `Stage 2 caption provider` = workspace-level routing policy для eligible caption-writing stages: `codex`, `anthropic` или `openrouter`.
- `workspace integrations` = owner-managed readiness layer для Stage 2 runtime; жалобы нельзя нормализовать как purely per-user auth issue без проверки этого слоя.

## Источники истины

Используйте их в таком порядке:

1. Live UI evidence из `output/playwright/agent-docs/`
2. Guard-ы и role logic в [`lib/acl.ts`](/Users/neich/Documents/Macedonian Imperium/clips automations/lib/acl.ts), [`lib/team-store.ts`](/Users/neich/Documents/Macedonian Imperium/clips automations/lib/team-store.ts), [`lib/auth/guards.ts`](/Users/neich/Documents/Macedonian Imperium/clips automations/lib/auth/guards.ts), [`lib/channel-edit-permissions.ts`](/Users/neich/Documents/Macedonian Imperium/clips automations/lib/channel-edit-permissions.ts)
3. Реальный route/UI code в [`app/page.tsx`](/Users/neich/Documents/Macedonian Imperium/clips automations/app/page.tsx), [`app/components/AppShell.tsx`](/Users/neich/Documents/Macedonian Imperium/clips automations/app/components/AppShell.tsx) и связанных компонентах
4. API contracts в `app/api/**/route.ts`
5. Существующие feature docs в `docs/`

Если live UI и код расходятся, приоритизируйте:

- live UI для вопроса "что видит пользователь сейчас";
- код для вопроса "что продукт задумывает или должен делать";
- guard/store logic для вопроса "кому это вообще разрешено".

## Уровни достоверности

Во всех документах используются три уровня:

- `browser-verified`: подтверждено Playwright на локальном инстансе `http://localhost:3101`
- `code-verified`: подтверждено по React/Next/API/guard code, но не всегда воспроизводится на текущих данных
- `db-verified`: подтверждено через текущую SQLite-структуру и seed/clone данных

## Методология съёма контекста

- Для документации использовалась изолированная копия `APP_DATA_DIR`, а не живая `.data`.
- В изолированной среде были подготовлены четыре роли: `owner`, `manager`, `redactor`, `redactor_limited`.
- Live walkthrough был выполнен для:
  - `/login`
  - `/register`
  - `/accept-invite`
  - `/setup/bootstrap-owner`
  - `/`
  - `/team`
  - Channel Manager
  - role-specific overflow menus
  - internal design routes `/design/template-lab` и `/design/template-road`
- Browser evidence сохранён в `output/playwright/agent-docs/`.

## Route Map

### Публичные и полупубличные route-ы

| Route | Назначение | Примечание |
| --- | --- | --- |
| `/login` | Вход в служебный аккаунт | Переход в рабочее приложение |
| `/register` | Публичная регистрация редактора | Создаёт `redactor` |
| `/accept-invite` | Принятие invite-токена | Назначает роль из invite |
| `/setup/bootstrap-owner` | Одноразовое создание первого владельца | После инициализации показывает блокирующее сообщение |

### Основной операторский route

| Route | Назначение |
| --- | --- |
| `/` | Главный рабочий shell: Step 1, Step 2, Step 3, история, выбор канала, Channel Manager, Publishing |
| `/team` | Управление участниками и invite-ами |

### Internal design tooling

| Route | Назначение | Класс поверхности |
| --- | --- | --- |
| `/design/template-lab` | Pixel-perfect calibration workbench | Internal tooling |
| `/design/template-road` | Живой редактор шаблона | Internal tooling |
| `/design/science-card` | Dev/design preview для renderer-based template | Internal tooling |
| `/design/badger-card` | Dev/design preview для отдельной card-сцены | Internal tooling |

Важно: internal design routes отделены от операторского пайплайна. Жалобы на них нельзя смешивать с проблемами ежедневного production flow редактора.

## Продуктовая карта

### Верхнеуровневая модель

1. `Workspace` задаёт команду, общие Stage 2 defaults, workspace AI integrations и provider/model routing.
2. `Channel` задаёт бренд, Stage 2 style profile, render defaults, assets и publishing settings.
3. `Chat` — единица рабочего цикла по одному источнику видео.
4. `Source job` — получение/нормализация источника на Step 1.
5. `Stage 2 run` — генерация caption/title/SEO и retrieval/feedback контекста.
6. `Stage 3 draft / preview / version` — финальная сборка, preview, executor, render plan.
7. `Publication` — queued/scheduled/published запись для YouTube.

### Ежедневный операторский сценарий

1. Выбрать канал.
2. Вставить ссылку или загрузить mp4.
3. Запустить Step 1.
4. Сгенерировать и выбрать варианты Step 2.
5. Дошлифовать финальный текст и монтаж на Step 3.
6. При необходимости поставить ролик в publishing queue.

### Administrative сценарии

1. Настроить канал.
2. Провести onboarding нового канала.
3. Назначить доступы к каналу.
4. Настроить YouTube publishing.
5. Управлять участниками команды и invite-ами.
6. Калибровать и редактировать design templates.

## Быстрый role summary

| Роль | Основная зона ответственности | Ключевое ограничение |
| --- | --- | --- |
| `owner` | Полный контроль workspace, каналов, команды, AI integrations и Stage 2 defaults | Ограничений нет |
| `manager` | Операционное управление каналами и участниками | Не управляет owner-only workspace integrations и owner-wide bootstrap |
| `redactor` | Ежедневный production flow и настройка доступных ему каналов | Не управляет командой и общими workspace defaults |
| `redactor_limited` | Только рабочий цикл по выданным каналам | Не создаёт каналы, не меняет channel setup, не управляет доступами |

Полная матрица находится в [`docs/agent-first/roles-and-permissions.md`](/Users/neich/Documents/Macedonian Imperium/clips automations/docs/agent-first/roles-and-permissions.md).

## Как агент должен пользоваться документацией

### Если пришла жалоба

1. Определить роль пользователя.
2. Выделить surface, где это произошло.
3. Нормализовать сущность: `channel`, `chat`, `stage2_run`, `stage3_version`, `publication`, `invite`, `template`.
4. Проверить, была ли проблема на `browser-verified` поверхности или только в `code-verified` ветке.
5. Собрать тикет по playbook из [`docs/agent-first/issue-intake-playbook.md`](/Users/neich/Documents/Macedonian Imperium/clips automations/docs/agent-first/issue-intake-playbook.md).

### Если пришло пожелание

1. Понять, это просьба про UX, права, performance, publishing, template tooling или AI quality.
2. Определить, ломает ли изменение ролевую модель.
3. Определить, это изменение публичного operator flow или internal tooling.
4. Привязать к вероятной code area и API.

## Правила эскалации для AI-агента

Эскалируйте в инженерный тикет немедленно, если:

- пользователь говорит о пропавшей кнопке или блокировке действия для конкретной роли;
- publishing ушёл в `failed`, `paused`, `canceled` или перестал совпадать со слотами;
- Step 2 выдал пустой результат, warnings или деградировал после feedback;
- Step 3 потерял preview, версии, executor pairing или render artifact;
- internal template tooling меняет production preview, assets или template versions;
- пользователь не может понять, в каком канале или каком flow он находится.

Сначала уточняйте, только если без этого нельзя определить:

- роль;
- канал;
- шаг пайплайна;
- точный control или действие;
- ожидаемое поведение.

## Связанные документы

- [`docs/agent-first/surfaces-and-navigation.md`](/Users/neich/Documents/Macedonian Imperium/clips automations/docs/agent-first/surfaces-and-navigation.md)
- [`docs/agent-first/roles-and-permissions.md`](/Users/neich/Documents/Macedonian Imperium/clips automations/docs/agent-first/roles-and-permissions.md)
- [`docs/agent-first/flows-and-state.md`](/Users/neich/Documents/Macedonian Imperium/clips automations/docs/agent-first/flows-and-state.md)
- [`docs/agent-first/glossary-and-entity-map.md`](/Users/neich/Documents/Macedonian Imperium/clips automations/docs/agent-first/glossary-and-entity-map.md)
- [`docs/agent-first/issue-intake-playbook.md`](/Users/neich/Documents/Macedonian Imperium/clips automations/docs/agent-first/issue-intake-playbook.md)
