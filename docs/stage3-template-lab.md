# Stage 3 Template Lab

Отдельный стенд для последовательной сборки библиотеки шаблонов через живой preview и параллельный Playwright-pass.

## Основные route

- `/design/template-road`
- `/design/template-lab`

Оба route используют один и тот же lab-компонент. `template-road` оставлен как более понятный адрес для ежедневной работы.

## Как использовать

1. Открыть `template-road` в браузере и держать вкладку открытой.
2. Выбрать шаблон в левой колонке.
3. Подгрузить reference image или вставить URL.
4. При необходимости поправить copy, channel name, font scale и preview scale прямо в lab.
5. Во время прохода через Playwright смотреть только на live preview и reference side-by-side.
6. После завершения pass поменять статус шаблона:
   - `Queue`
   - `In Progress`
   - `Review`
   - `Approved`
7. Зафиксировать следующие шаги в `Заметки по проходу`.

## Где "поднимать" reference

`template-road` и `template-lab` берут `reference`/`media`/`background`/`avatar` только с того host, который у вас открыт в браузере.

- Если вы открываете `template-road` на `localhost:3000`, файлы лежат в вашей локальной версии репозитория (`design/templates/<template-id>/`).
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
3. Откройте `template-road?template=<template-id>` на этом же хосте и нажмите `Reference`.

## Почему это лучше обычной доработки через Editor

- у каждого шаблона свой отдельный draft
- переключение между шаблонами не сбрасывает изменения
- есть статусы для всей библиотеки, а не только для одного активного шаблона
- reference-panel и live preview живут на одной странице
- route удобно держать открытым, пока изменения вносятся из кода

## Базовый цикл для 10 шаблонов

1. Добавить шаблон в `lib/stage3-design-lab.ts`
2. Подключить его визуальную отрисовку в `app/components/Stage3TemplateLab.tsx`
3. Открыть `template-road?template=<template-id>`
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
