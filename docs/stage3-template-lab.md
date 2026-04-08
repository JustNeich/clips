# Stage 3 Template Lab

Отдельный стенд для последовательной сборки библиотеки шаблонов через живой preview и параллельный Playwright-pass.

Перед началом нового шаблона или сложной калибровки сначала прочитайте:
- [docs/stage3-template-integration.md](/Users/neich/dev/clips automations/docs/stage3-template-integration.md)

Там зафиксированы базовые понятия `frame / shell / card`, каноническая ScienceCard-геометрия, правила для border/shadow/background/badge и checklist по добавлению нового шаблона.

## Основные route

- `/design/template-road`
- `/design/template-lab`

Теперь это два разных инструмента:
- `template-road` — style editor: фиксированный canvas слева, scrollable inspector справа. Нужен для быстрой настройки chrome, palette, typography и spacing.
- `template-lab` — calibration lab: reference/diff/artifacts и проходы до визуального совпадения.

С недавнего обновления `template-road` также хранит template-level highlighting profile:
- master toggle `Highlighting`
- отдельные тумблеры для `top` и `bottom`
- до 3 semantic color slots с `color + label + guidance`
- demo phrase inputs для live preview без запуска Stage 2

Важно:
- preview в редакторе и финальный render теперь читают structured `content.highlights`, а не inline markers;
- legacy `topHighlightPhrases` оставлен только как fallback при загрузке старых шаблонов;
- если оператор вручную меняет текст в Stage 3, highlight spans для этого блока должны считаться сброшенными до следующего apply из Stage 2.
- built-in/system templates всегда видны в библиотеке, но открываются только в `read-only`;
- чтобы изменить встроенный шаблон, нужно создать копию из `template-road`, после чего она становится обычным managed template;
- для ролей ниже manager библиотека показывает не только личные drafts, но и шаблоны, назначенные на видимые им каналы.
- managed templates по умолчанию хранятся в app-data storage, а не в `design/managed-templates` внутри рабочей копии;
- при первом доступе runtime автоматически мигрирует legacy templates из старой repo-backed папки в новое durable storage.

## Как использовать

1. Для style-прохода открыть `template-road` и выбрать базовый шаблон.
2. Справа через inspector крутить radius, border, fill, shadow, font stacks, weights, colors и внутренние отступы.
3. В секции `Демо-контент` при необходимости настроить `Highlighting`: включить top/bottom, выбрать до 3 слотов, задать `label/guidance` и demo phrases для проверки палитры.
4. Слева смотреть только на live canvas и оценивать hierarchy / breathing room без reference diff.
5. Когда нужна именно калибровка под референс, открыть `template-lab`.
6. В `template-lab` подгрузить reference image или URL и провести diff-pass.
7. После завершения calibration-pass поменять статус шаблона:
   - `Queue`
   - `In Progress`
   - `Review`
   - `Approved`
8. Зафиксировать следующие шаги в `Заметки по проходу`.

## Preset workflow

1. В `template-road` нажать `New draft`, если хотите начать новый стиль поверх базового шаблона.
2. После правок нажать `Create preset` или `Save as new`.
3. Preset сохраняется как JSON в `design/template-style-presets/<preset-id>.json`.
4. Чтобы вернуться к нему позже, открыть `template-road?preset=<preset-id>`.
5. Чтобы применить тот же стиль в render/view route, открыть `science-card?preset=<preset-id>`.
6. Для обновления существующего preset выбрать его в `Saved presets` и нажать `Save preset`.
7. Для удаления использовать `Delete` в library-секции.

## Где "поднимать" reference

`template-lab` берет `reference`/`media`/`background`/`avatar` только с того host, который у вас открыт в браузере. `template-road` теперь не является reference-менеджером и работает как локальный style inspector.

- Если вы открываете `template-lab` на `localhost:3000`, файлы лежат в вашей локальной версии репозитория (`design/templates/<template-id>/`).
- Если открываете на staging/production, reference должен существовать на этом host.
- В текущей реализации `production` design-API (`/api/design/template-sessions/*`) не открыт, поэтому reference management через UI доступен только в non-production окружении.

Практически:

1. Положите файлы в:
   - `design/templates/<template-id>/reference.png`
   - `design/templates/<template-id>/media.png` (опционально)
   - `design/templates/<template-id>/background.png` (опционально)
   - `design/templates/<template-id>/avatar.png` (опционально)
   - `design/templates/<template-id>/content.json` (текст и channel fields)
2. Проверьте, что хост, куда вы идете в браузере, видит эту папку.
3. Откройте `template-lab?template=<template-id>` на этом же хосте и нажмите `Reference`.

## Почему это лучше обычной доработки через Editor

- у каждого шаблона свой отдельный draft
- переключение между шаблонами не сбрасывает изменения
- есть статусы для всей библиотеки, а не только для одного активного шаблона
- reference-panel и live preview живут на одной странице
- route удобно держать открытым, пока изменения вносятся из кода

## Базовый цикл для 10 шаблонов

1. Добавить шаблон в `lib/stage3-design-lab.ts`
2. Подключить его визуальную отрисовку в `app/components/Stage3TemplateLab.tsx`
3. Открыть `template-road?template=<template-id>` для style-pass, затем `template-lab?template=<template-id>` для калибровки с reference.
4. Провести несколько Playwright-pass до визуального совпадения с reference
5. Перевести шаблон в `Review`
6. После ручного approve перевести в `Approved`

## Нерушимые инварианты верстки (обязательно)

- `TOP/BOTTOM` текст должен адаптироваться так, чтобы занимать рабочее пространство слота без крупных пустых зон.
- Фикс высот секций важнее текста: секции не растягиваются под контент, подстраивается именно typography.
- Любая правка считается невалидной, если:
  - появляется заметный пустой `gap` внизу или вверху текстового блока;
  - текст выходит за границы секции;
  - рендер в `template-lab`, editor preview и Remotion расходится по геометрии.
