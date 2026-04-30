# Stage 3 Template Integration Guide

Этот документ фиксирует практические правила, которые уже подтвердились в коде и в реальных итерациях по шаблонам. Его цель: чтобы добавление нового Stage 3 шаблона было не “попасть примерно рядом”, а повторяемым и предсказуемым процессом.

Используйте этот guide как source of truth для:
- интеграции нового шаблона;
- калибровки existing template;
- разбора багов вида “фон не применяется”, “карточка съела backdrop”, “бордер есть в конфиге, но его не видно”, “галка липнет к имени”, “шаблон слишком похож на другой”.

## 1. Базовая ментальная модель

Вся Stage 3 сцена состоит из трёх разных уровней:

1. `frame`
- полный ролик `1080x1920`
- это весь вертикальный видео-кадр, не карточка

2. `shell`
- фон за карточкой
- это backdrop / blur source / custom background / fallback background
- shell не должен подменять собой card

3. `card`
- белая или стилизованная карточка внутри видео
- именно card содержит `top`, `media`, `bottom`
- border, inset-shadow и большая часть chrome обычно принадлежат именно card, а не shell

Ключевое правило:
- **фон живёт на shell/frame-уровне**
- **контент и chrome живут на card-уровне**

Если перепутать эти уровни, появляются типичные баги:
- белая область перекрывает фон полностью;
- border рисуется “где-то”, но не вокруг карточки;
- backdrop asset подключён, но визуально не виден;
- шаблон начинает выглядеть как full-frame poster, а не как card-over-video layout.

## 2. Каноническая геометрия ScienceCard

Для всей ScienceCard-семьи канонической базой считается repo-backed spec:
- [design/templates/science-card-v1/figma-spec.json](/Users/neich/Documents/Macedonian Imperium/clips automations/design/templates/science-card-v1/figma-spec.json)

Базовые значения:

- `frame`: `1080 x 1920`
- `card`: `x=83, y=192, width=907, height=1461`
- `card radius`: `12`
- `card border`: `8px black`

Секции внутри card:
- `top`: `x=83, y=192, width=907, height=419`
- `media`: `x=83, y=611, width=907, height=750`
- `bottom`: `x=83, y=1361, width=907, height=292`
- `author`: `x=83, y=1361, width=907, height=132`
- `avatar`: `x=106, y=1379, width=101, height=101`
- `bottomText`: `x=106, y=1493, width=838, height=160`

Если новый шаблон заявлен как “ScienceCard-like”, он должен:
- сохранять эти card bounds;
- сохранять тот же разрез `top / media / bottom`;
- менять стиль, а не ломать саму ритмику карточки.

Именно это правило мы уже применяли к:
- `science-card-v7`
- `hedges-of-honor-v1`

Если нужен новый визуальный язык, но всё ещё “card inside a vertical video”, сначала попробуйте сохранить эту геометрию и менять только:
- border;
- shadow;
- backdrop;
- typography;
- palette;
- author row styling.

## 3. Что такое “шаблон похож на ScienceCard”, а что уже другой layout

Это **всё ещё ScienceCard-family**, если:
- card стоит внутри frame, а не занимает его целиком;
- media ограничено card bounds;
- bottom quote живёт в card bottom section;
- авторский блок приклеен к bottom section;
- текст адаптируется внутрь фиксированных слотов.

Это уже **другой layout family**, если:
- shell и card фактически сливаются;
- top/media/bottom уже не подчиняются тем же bounds;
- background становится частью самой карточки;
- author row выезжает в независимый floating layer;
- секции начинают жить по другой вертикальной ритмике.

Практическое правило:
- не называйте шаблон “новым ScienceCard”, если вы на самом деле строите другой shell/card contract.

## 3a. Family-aware text contract

Stage 3 теперь поддерживает не одну, а две независимые семьи шаблонов:
- `Top & Bottom` — классический `TOP / media / BOTTOM` контракт;
- `Channel + Story` — `channel row / optional lead / body / media`.

Runtime invariant:
- каждый template id, который может попасть в `Stage3RenderPlan.templateId`, обязан быть зарегистрирован и в template registry, и в Remotion compositions. Для `Channel + Story` это включает `channel-story-v1`; иначе preview/render падает с ошибкой `Could not find composition with ID ...` даже если Template Road и assignment уже видят шаблон.

Ключевое правило:
- UI, snapshot builder, autofit, preview, Remotion render и managed-template persistence должны читать не “сырой top/bottom смысл”, а `layoutKind` и `leadMode`.

Совместимость со старым wire-контрактом сохраняется так:
- для `classic_top_bottom` `topText` остаётся `TOP`, а `bottomText` остаётся `BOTTOM`;
- для `channel_story + clip_custom` `topText` становится `lead`, а `bottomText` становится `body`;
- для `channel_story + template_default` операторский flow не редактирует `topText` напрямую, но `content.topText` всё ещё хранит template-level default lead;
- для `channel_story + off` `topText` исключается из operator flow, а `bottomText` остаётся единственным body-блоком.

Практический смысл:
- не ломаем legacy Stage 2/Stage 3 storage;
- не плодим отдельную wire-модель ради новой семьи;
- но всё пользовательское поведение обязано быть family-aware в `Template Road`, `template-lab`, channel assignment, Step 2 и Step 3.

Дополнительные invariants для `Channel + Story`:
- в `Template Road` операторский порядок должен идти сверху вниз: сначала формат/основа, затем `Канал и lead-политика`, потом demo/body и только после этого chrome/spacing/details;
- при изменении `card.width`, `card.borderWidth` и других shell-параметров внутренний контент обязан считаться от inner safe area карточки, а не от полного outer rect;
- border/radius нельзя silently брать только из locked spec: live editor overrides должны доходить до snapshot, preview и финального render.
- `bodyToMediaGap` управляет только вертикальным зазором `Body -> video`; боковая/нижняя чёрная рамка задаётся отдельными `mediaInsetX`, `footerHeight`, `mediaBorderWidth` и `card.fill`.

## 4. Background contract

Фон выбирается не “по шаблону вообще”, а по явному приоритету:
- `custom background`
- `blur from source video`
- `built-in template backdrop`
- `fallback`

Source of truth:
- [lib/stage3-background-mode.ts](/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage3-background-mode.ts)

Это означает:
- встроенный backdrop шаблона не должен безусловно побеждать всё остальное;
- если выбран собственный background asset, он обязан перекрыть built-in backdrop;
- если custom background нет, но есть source video, допустим blur-source режим;
- built-in backdrop нужен как визуальный дефолт, а не как hard override.

Типичный баг:
- built-in backdrop подключён, но card растянута слишком широко или shell/card перепутаны, поэтому кажется, что backdrop “не применяется”.

Проверка:
- вокруг карточки должен оставаться явный фон;
- у card должны читаться свои собственные границы;
- backdrop не должен становиться белым полем карточки.

## 4a. Video adjustment contract

Шаблон теперь может задавать не только геометрию и palette, но и стартовую цветокоррекцию source-video:
- `brightness`
- `exposure`
- `contrast`
- `saturation`

Это **template-level defaults**, а не жёсткий bake-in.

Правила:
- значения шаблона должны становиться initial state в Stage 3 для нового live draft;
- редактор в Stage 3 может менять эти значения только для текущего ролика, не перетирая template defaults;
- preview и final render обязаны использовать один и тот же video adjustment contract;
- если template defaults меняются, старый draft не должен терять уже внесённый per-video override.

Практический смысл:
- template задаёт “look” канала по умолчанию;
- конкретный ролик может стать чуть темнее/ярче/контрастнее без форка шаблона.

## 5. Border contract

Если reference говорит, что у карточки есть border, border должен принадлежать именно **card**, а не frame/shell.

Практика показала два важных правила:

1. Если border тонкий и card имеет собственные секции, border удобнее рисовать отдельным chrome-layer, а не надеяться, что его не съедят внутренние слои.

2. Если border не видно, это часто не “не тот цвет”, а один из двух structural bugs:
- border лежит под top/media/bottom секциями;
- border висит на shell, а не на card.

Для `Hedges of Honor` и `Science Card Skyframe` важное правило:
- border — это **2px black stroke вокруг card bounds**
- не вокруг всей сцены
- не вокруг backdrop

## 6. Radius contract

Radius никогда нельзя “наследовать по привычке”.

Если reference:
- округлый — radius должен быть явно задан;
- острый — radius должен быть `0`.

Мы уже поймали этот баг на `Hedges of Honor`: он унаследовал ощущение rounded card, хотя reference требовал жёсткий прямоугольник.

Правило:
- radius — это часть идентичности шаблона, а не декоративная мелочь.

## 7. Shadow contract

У card может быть два разных shadow-типа, и это не одно и то же:

1. `outer shadow`
- отделяет карточку от backdrop
- даёт силуэт и глубину относительно фона

2. `inner shadow` / `inset shadow`
- даёт объём самой карточке
- особенно важен на белых card surfaces

Ключевой урок:
- если inset-shadow слишком слабый или лежит не на том слое, визуально кажется, что его нет вообще
- если outer shadow есть, а inset-shadow нет, карточка может выглядеть как плоский скриншот

Для аккуратных белых карточек хорошо работает:
- отдельный outer shadow;
- очень мягкий inset-shadow;
- без грязного “грязно-серого” edge glow.

## 8. Author row, avatar и verification badge

У author row есть своя микрогеометрия:
- avatar size;
- avatar-to-copy gap;
- name/handle line heights;
- badge size;
- gap между именем и badge.

Практический урок:
- если badge нужен не generic, не полагайтесь на renderer fallback с кружком и `✓`
- заведите отдельный asset

Для `science-card-v7` и `hedges-of-honor-v1` это уже сделано через:
- [public/stage3-template-badges/honor-verified-badge.svg](/Users/neich/Documents/Macedonian Imperium/clips automations/public/stage3-template-badges/honor-verified-badge.svg)

И ещё один важный урок:
- слишком маленький `nameCheckGap` делает badge “прилипшим” к имени;
- визуально это ломает весь авторский блок сильнее, чем кажется по коду.

Если badge выглядит тесно:
- сначала проверьте `nameCheckGap`;
- потом `checkSize`;
- и только потом думайте про font-size/weight у имени.

## 9. TOP / MEDIA / BOTTOM contract

Top, media и bottom — это не “примерные зоны”, а фиксированные layout slots.

Нерушимые правила:
- секции не растягиваются под текст;
- подстраивается typography, а не высота секции;
- media всегда живёт в media slot;
- bottom copy не должна вылезать в author row;
- большие пустые зоны так же плохи, как и overflow.

То есть при работе с шаблоном вы настраиваете:
- font scale;
- line-height;
- letter-spacing;
- padding;
- but not the whole slot contract every time.

Для `Channel + Story` body/lead text scale есть stability guard около нейтральных `100%`: маленькие изменения вроде `99% -> 100%` не должны добавлять целую лишнюю строку, если минимальное sub-pixel уменьшение шрифта сохраняет тот же wrap. Так Step 3 typography controls меняются визуально плавно и всё ещё уважают фиксированные slots.

## 10. Какие файлы за что отвечают

### Конфиг шаблона
- [lib/stage3-template.ts](/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage3-template.ts)

Там живёт:
- card geometry/runtime config;
- palette;
- author metrics;
- typography defaults;
- template identity.

### Канонический renderer
- [lib/template-scene.tsx](/Users/neich/Documents/Macedonian Imperium/clips automations/lib/template-scene.tsx)

Там живёт:
- реальная вложенность слоёв;
- card/shell chrome;
- author row rendering;
- badge rendering;
- media placement;
- top/bottom section paint order.

Если что-то “в конфиге есть, но визуально не видно”, чаще всего проблема именно здесь.

### Repo-backed spec
- `design/templates/<template-id>/figma-spec.json`

Используется как reference/contract-level описание геометрии.

### Registry и runtime backdrop
- [lib/stage3-template-registry.ts](/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage3-template-registry.ts)
- [lib/stage3-template-runtime.tsx](/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage3-template-runtime.tsx)

Здесь определяется:
- есть ли built-in backdrop;
- какой asset-path используется;
- как template представлен в UI/preview runtime.

### Background mode
- [lib/stage3-background-mode.ts](/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage3-background-mode.ts)

### Template Lab / calibration workflow
- [docs/stage3-template-lab.md](/Users/neich/Documents/Macedonian Imperium/clips automations/docs/stage3-template-lab.md)

## 11. Checklist при добавлении нового шаблона

1. Определить family:
- это ScienceCard-family или новый layout family?

2. Зафиксировать:
- frame;
- card bounds;
- section bounds;
- radius;
- border;
- outer shadow;
- inset shadow;
- author row metrics;
- badge style.

3. Добавить template config:
- [lib/stage3-template.ts](/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage3-template.ts)

4. Добавить template registry/runtime metadata:
- [lib/stage3-template-registry.ts](/Users/neich/Documents/Macedonian Imperium/clips automations/lib/stage3-template-registry.ts)

5. Добавить built-in assets, если нужны:
- backdrop
- badge
- avatar fixture

6. Проверить background precedence:
- custom > blur source > built-in > fallback

7. Проверить, что:
- card не перекрывает весь shell;
- backdrop виден;
- border читается;
- inset shadow читается;
- author row не “липкий”;
- badge не fallback, если reference требует конкретную форму.

8. Синхронизировать spec/notes:
- `design/templates/<template-id>/figma-spec.json`
- `design/templates/<template-id>/notes.md`

9. Добавить regression tests.

## 12. Checklist при разборе визуального бага

Если “не видно border”:
- проверить, не рисуется ли border на shell вместо card;
- проверить paint order в renderer;
- проверить, не закрывают ли внутренние секции край карточки.

Если “не применяется фон”:
- проверить resolved background mode;
- проверить, остаётся ли вокруг card видимая shell-area;
- проверить, не съедает ли card весь frame.

Если “тени нет”:
- проверить, что это именно inset-shadow, а не только outer shadow;
- проверить силу shadow и layer, на котором он рисуется.

Если “галка странная”:
- проверить `checkAssetPath`;
- проверить, не сработал ли fallback badge;
- проверить `nameCheckGap`.

Если “шаблон вообще похож на другой”:
- сравнить family contract, а не только цвета;
- проверить radius, border, backdrop, author row и vertical rhythm;
- не пытаться лечить structural bug одной typography-правкой.

## 13. Конкретные уроки из Hedges of Honor / Skyframe

- `Hedges of Honor` не должен наследовать rounded silhouette от ScienceCard, если reference просит sharp rectangle.
- `Skyframe` и `Hedges` не должны отличаться только цветом фона. У них должны различаться именно card/chrome decisions.
- Border у карточки может “как будто быть”, но реально не читаться, если его положить не на тот слой.
- Built-in backdrop сам по себе не гарантирует, что фон будет виден: card может физически перекрыть shell.
- Белая карточка почти всегда требует очень аккуратный inset-shadow, иначе выглядит плоско.

## 14. Что считать done

Шаблон считается готовым не когда он “примерно похож”, а когда:
- background ведёт себя по правилам;
- card живёт отдельно от shell;
- border/radius/shadow соответствуют reference;
- author row и badge выглядят как часть reference, а не generic fallback;
- top/media/bottom сохраняют читаемую и стабильную ритмику;
- preview, editor и final render не расходятся по геометрии.

Если остаётся ощущение “вроде всё на месте, но выглядит не так”, почти всегда проблема в одном из трёх мест:
- shell vs card перепутаны;
- chrome рисуется не на том слое;
- family contract шаблона не был формально определён.
