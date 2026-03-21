# Stage 2 Channel Learning

Этот документ описывает новый слой channel bootstrap + adaptive learning для Stage 2.

Цель системы:
- не заставлять редактора заполнять сложную style-анкету;
- не зашивать канал в маленькую публичную библиотеку preset-архетипов;
- не позволять первым 10 reference links автоматически и навсегда определить identity канала;
- дать Stage 2 мягкий, обучаемый, но не застывший editorial prior.

## 1. Product model

Новая модель работает так:

1. редактор проходит guided onboarding wizard;
2. добавляет 10+ reference links;
3. LLM анализирует эти ссылки и предлагает около 20 style directions;
4. редактор выбирает столько стартовых направлений, сколько реально подходят каналу;
5. Stage 2 использует их как initial prior, а не как жёсткий preset;
6. дальше канал мягко дообучается от последних редакторских сигналов;
7. около 25% пространства вариантов всегда остаётся exploratory.

Ключевое правило:
- references сужают proposal space, но не принимают финальное решение вместо редактора.

## 2. Guided onboarding flow

Новый `+ New Channel` больше не создаёт канал молча в старом manager flow.

Теперь используется wizard:

### Step 1. Basic setup

Собирает:
- `name`
- `username`
- `avatar`
- lightweight identity fields, которые уже поддерживает канал

Все поля остаются редактируемыми после onboarding.

### Step 2. Stage 2 base

Собирает baseline Stage 2 настройки:
- examples corpus
- top/bottom length limits
- banned words
- banned openers
- прочие существующие hard constraints

Этот шаг intentionally light:
- editor может оставить workspace defaults;
- wizard не превращается в expert-only prompt form.

### Step 3. References

Редактор добавляет минимум 10 supported links.

Runtime:
- нормализует URL;
- дедуплицирует их;
- подтягивает title / description / transcript excerpt / top comments, если это возможно;
- собирает компактный reference packet для style-discovery prompt.

### Step 4. Style picks

LLM генерирует около 20 human-readable style directions.

Редактор может выбрать много карточек, включая почти весь пул.

Именно этот выбор становится initial channel prior.

Дополнительно:
- UI больше не заставляет искусственно ужимать всё до 5 карточек;
- можно выбрать хоть весь пул;
- при этом карточки всё равно раскладываются на опорные, соседние и exploratory предложения.

## 3. Style discovery model

### Что делает модель

Style discovery не ищет preset в фиксированной библиотеке. Вместо этого модель:
- смотрит на reference links;
- выявляет повторяющиеся voice / framing / tone / TOP/BOTTOM patterns;
- отдельно резервирует adjacent + exploratory lanes;
- возвращает editor-friendly direction cards.

Цель discovery:
- не отзеркалить референсы в 20 слегка переименованных карточках;
- а собрать channel-relevant editorial possibility space:
  - core high-fit directions;
  - adjacent stylistic possibilities;
  - smaller exploratory tail.

### Что модель не должна делать

Модель не должна:
- автоматически выбирать final channel identity;
- сводить всё к одному очевидному стилю;
- выдавать 20 micro-labels, которые отличаются только красивой переформулировкой одного и того же сюжетного жеста;
- подменять human editor decision;
- использовать user-facing taxonomy codes как основную UX-модель.

### Где лежит prompt logic

Основной prompt-builder находится в:
- `lib/stage2-style-discovery.ts`

Ключевые entry points:
- `buildStage2StyleDiscoveryPrompt(...)`
- `runStage2StyleDiscovery(...)`
- `discoverStage2StyleProfile(...)`

Текущая prompt version:
- `STAGE2_STYLE_DISCOVERY_PROMPT_VERSION`

### Output contract

Style discovery возвращает `Stage2StyleProfile`, внутри которого живут:
- `referenceLinks`
- `referenceInfluenceSummary`
- `candidateDirections`
- `selectedDirectionIds`
- `explorationShare`

Каждый `Stage2StyleDirection` содержит editor-facing copy:
- `fitBand`
- `name`
- `description`
- `voice`
- `topPattern`
- `bottomPattern`
- `bestFor`
- `avoids`
- `microExample`

И одновременно hidden runtime structure:
- `internalPromptNotes`
- `axes`
- normalized tone levels

Это важно:
- editor видит human cards;
- runtime может учиться по скрытым soft attributes;
- discovery UX не ограничивается заранее заданной публичной классификацией.

### Relevance vs breadth

Discovery должен соблюдать баланс:
- `core`: сильные high-fit направления, явно опирающиеся на recurring signals референсов;
- `adjacent`: правдоподобные соседние ходы, которые расширяют пространство по тону, дистанции, плотности объяснения, warmth, compression;
- `exploratory`: небольшой хвост на будущее, чтобы старт не схлопнулся в одно настроение.

Практическое правило:
- references сужают пространство вариантов;
- но discovery не должен механически отзеркаливать точные surface narratives референсов;
- если два варианта отличаются только микропереименованием одного сюжетного хода, это плохой discovery.

### Regeneration behavior

Style pool регенерируется только явно.

Если редактор меняет reference links после discovery:
- предыдущий pool не стирается автоматически;
- wizard помечает pool как `stale`;
- шаг 4 остаётся доступным для просмотра;
- для актуализации нужен явный action `Пересобрать / Обновить пул стилей`.

Это сделано специально, чтобы редактор не терял exploration history из-за случайной правки ссылок.

## 4. Persistence model

Новые persistent сущности:

### Onboarding draft state

Черновик onboarding wizard хранится клиентом scoped по `workspace + user` в `localStorage`.

Это означает:
- закрытие панели не сбрасывает progress;
- повторное открытие `+ New Channel` продолжает тот же draft;
- после reload wizard гидратится из сохранённого состояния;
- успешное создание канала очищает сохранённый draft.

Важно:
- это best-effort client persistence, а не source of truth для finished channel;
- `avatarFile` не сериализуется и после полного reload должен быть выбран заново;
- close panel и discard draft не являются одним и тем же действием.

### Channel style profile

Хранится в:
- `channels.stage2_style_profile_json`

Используется для:
- bootstrap references;
- candidate directions;
- selected directions;
- exploration share;
- onboarding completion state.

### Editorial feedback events

Хранятся в:
- `channel_editorial_feedback_events`

Каждое событие может содержать:
- `kind`
- optional `note`
- `optionSnapshot`
- `chatId`
- `stage2RunId`
- timestamp

Сейчас поддерживаются:
- `more_like_this`
- `less_like_this`
- `selected_option`

## 5. Feedback loop

В normal Stage 2 work editor может дать сверхлёгкий feedback:
- `More like this`
- `Less like this`
- optional note

Также система считает полезным сигналом:
- явный выбор caption option в UI как `selected_option`

Сигналы не требуют от редактора думать в терминах:
- audience target
- narrative taxonomy
- sarcasm sliders
- reaction archetypes

Вместо этого система сама переводит feedback в soft weights.

## 5.1 Retrieval honesty and cold-start behavior

Stage 2 не должен делать вид, что examples всегда одинаково полезны.

Теперь retrieval layer явно вычисляет:
- `retrievalConfidence`
- `examplesMode`
- explanation / warning / evidence

Поддерживаются 3 режима:

### `domain_guided`

Используется, когда pool реально domain-near.

В этом режиме examples могут честно влиять на:
- framing
- trigger logic
- narrative angle
- structure
- tone

### `form_guided`

Используется, когда прямых thematic neighbors нет, но pool всё ещё полезен по форме.

В этом режиме examples должны влиять в основном на:
- top/bottom construction
- overlay density
- pacing
- narrator rhythm
- structural compression

И не должны:
- диктовать nouns
- подменять clip truth
- тянуть writer в чужой market logic

### `style_guided`

Используется, когда retrieval confidence низкий и pool mostly weak/generic.

В этом режиме Stage 2 опирается в первую очередь на:
1. actual clip truth
2. bootstrap channel style directions
3. rolling editorial memory
4. retrieval examples as weak support

Это важно для cold-start channels и новых topic families, где сильных domain-near examples пока просто нет.

## 6. Rolling editorial memory

Rolling memory строится в:
- `lib/stage2-channel-learning.ts`

Ключевой builder:
- `buildStage2EditorialMemorySummary(...)`

Правила памяти:
- strongest influence дают только последние `~30` событий;
- старые события не остаются равно сильными бесконечно;
- внутри окна новые реакции важнее старых;
- bootstrap selections дают мягкий стартовый prior, но не фиксируют канал навсегда.

Технически summary включает:
- `directionScores`
- `angleScores`
- `preferredTextCues`
- `discouragedTextCues`
- `recentNotes`
- `normalizedAxes`
- `promptSummary`

Это summary является runtime-friendly representation того, чему канал научился к текущему моменту.

Важно про wording:
- bootstrap prior и recent feedback больше не должны описываться одними и теми же словами;
- если `recentFeedbackCount = 0`, `promptSummary` не должен притворяться, что есть “Recent positive pull”;
- bootstrap prior должен называться bootstrap prior;
- recent feedback должен называться recent feedback только если такие события реально были.

## 6.1 Durable style discovery runs

Bootstrap style discovery больше не живёт как одноразовый client-side `fetch`.

Теперь:
- `POST /api/channels/style-discovery` создаёт durable run в `channel_style_discovery_runs`;
- UI сохраняет `activeStyleDiscoveryRunId` внутри onboarding draft;
- после reload / close / reopen wizard переподключается к тому же run по `runId`;
- runtime re-queue'ит `running` style discovery runs после restart-style recovery.

Практический смысл:
- navigation не должна случайно повторно запускать анализ;
- закрытие панели не убивает bootstrap analysis;
- completed result остаётся inspectable и может быть повторно загружен клиентом.

## 6.2 Distilled bootstrap style lessons

Помимо selected direction cards, runtime теперь выводит compact bootstrap lessons из onboarding style prior:
- what TOP usually does
- what BOTTOM usually does
- what tone wins
- what to avoid

Эти lessons не заменяют clip truth, но особенно полезны в `style_guided` runs, когда retrieval слабый и channel learning должен нести больше веса.

### Runtime compaction and weighting

UI всё ещё разрешает выбрать много или даже все style directions.

Это intentionally preserved:
- editor shape'ит prior широко;
- onboarding не превращается обратно в жёсткий “выбери только 5”.

Но runtime prompt layer больше не должен:
- передавать все выбранные cards как одинаково важные;
- дублировать весь full-card payload на каждом Stage 2 этапе;
- раздувать prompts только потому, что editor выбрал почти весь пул.

Текущая prompt strategy:
- selected directions сворачиваются в `selectionSummary`;
- runtime считает `fitBand` balance (`core / adjacent / exploratory`);
- в prompts уходит только небольшой weighted highlight subset;
- `core` обычно весят больше, чем `adjacent`, а `exploratory` сохраняют ограниченное место;
- distilled lessons и editorial-memory summary несут основной reusable signal вместо полного списка cards.

Это важно:
- editor keeps freedom;
- runtime keeps compactness;
- channel learning остаётся рабочим, а не декоративным.

## 7. Exploration rule

Система специально не даёт каналу “схлопнуться” в один mode.

Current policy:
- `STAGE2_EDITORIAL_EXPLORATION_SHARE = 0.25`

Практический смысл:
- примерно 70-80% option space следует текущему learned prior;
- примерно 20-30% остаётся exploratory;
- channel может адаптироваться, если вкус редактора меняется;
- pipeline не застывает в repetitive caption loop.

Exploration действует в двух местах:
- bootstrap discovery при генерации style directions;
- downstream Stage 2 generation при создании candidate captions.

## 8. How Stage 2 consumes channel learning

Stage 2 run snapshot теперь несёт два новых runtime блока:
- `stage2StyleProfile`
- `editorialMemory`

Они прикрепляются в:
- `lib/stage2-run-request.ts`
- `app/api/pipeline/stage2/route.ts`
- `lib/source-job-runtime.ts`

### Prompt consumption

Prompt payload строится в:
- `lib/viral-shorts-worker/prompts.ts`

Там появляется `channelLearning`, который объединяет:
- bootstrap directions
- reference influence summary
- rolling editorial memory
- exploration share

### Stage expectations

`selector`:
- не обязан выбирать из rigid angle library;
- может предлагать clip-specific editorial lane labels;
- должен учитывать channel learning как soft context;
- обязан читать `retrievalConfidence` и `examplesMode` и по-разному обращаться с examples в `domain_guided`, `form_guided` и `style_guided`.

`writer`:
- использует learning layer как guidance, а не как fixed template;
- должен маркировать кандидатов через `style_direction_ids` и `exploration_mode`;
- обязан сохранять aligned + exploratory mix;
- в `form_guided` и `style_guided` не должен импортировать чужие nouns / trigger logic / market assumptions из weak examples.
- должен использовать comments как stance/language source selectively:
  - можно брать lived-in phrasing cues;
  - нельзя paste'ить comment text как готовый bottom;
  - нельзя уходить в generic stock tails только потому, что batch уже звучит “нормально”.

`critic` и `final selector`:
- не должны автоматически убивать все exploratory кандидаты;
- должны сохранять минимум один сильный exploratory alternate, если он конкурентен по качеству;
- critic отдельно штрафует wrong-market semantic borrowing, если candidate хорошо звучит по форме, но семантически приехал из слабого example pool.
- critic дополнительно следит за batch-level sameness:
  - одинаковые bottom openings;
  - одинаковая tail function;
  - polished-but-interchangeable lines.
- final selector смотрит не только на angle labels, но и на `style_direction_ids`, `exploration_mode` и реальную rhythm/feel-diversity visible five.

### Robotic phrasing suppression

Base prompt stack intentionally suppresses:
- interchangeable quote-first bottoms;
- stock tails вроде `the reaction basically writes itself`;
- over-clean smoothing, после которого line звучит “publishable”, но перестаёт быть human;
- fake comment usage, где comments supposedly matter, но по факту превращаются в one-line vibe cliche.

Это важно для cold-start и style-guided runs:
- когда external examples слабые,
- channel learning и clip truth должны давать живой voice,
- а не просто polished generic commentary.

## 9. Wizard navigation rules

Navigation и generation теперь принципиально разделены.

Правила:
- completed / unlocked steps остаются кликабельными;
- переход назад и вперёд по уже unlocked шагам не запускает discovery повторно;
- heavy side effects живут только на явных action-кнопках;
- stale style pool не блокирует просмотр шага 4, но блокирует финальное подтверждение, пока pool не будет обновлён под текущие ссылки.

Ключевой продуктовый смысл:
- navigation is navigation;
- generation is generation;
- эти вещи не должны быть сцеплены скрытыми сайд-эффектами.

## 10. Files to edit when changing this system

UX / onboarding:
- `app/components/ChannelOnboardingWizard.tsx`
- `app/components/channel-onboarding-support.ts`
- `app/components/ChannelManager.tsx`
- `app/components/ChannelManagerStage2Tab.tsx`
- `app/page.tsx`

Style discovery:
- `app/api/channels/style-discovery/route.ts`
- `lib/stage2-style-discovery.ts`

Persistence:
- `lib/db/schema.ts`
- `lib/db/client.ts`
- `lib/chat-history.ts`
- `lib/channel-editorial-feedback-store.ts`

Runtime / prompts:
- `lib/stage2-run-request.ts`
- `lib/stage2-progress-store.ts`
- `lib/stage2-prompt-specs.ts`
- `lib/viral-shorts-worker/prompts.ts`
- `lib/viral-shorts-worker/service.ts`
- `lib/source-job-runtime.ts`

Tests:
- `tests/channel-learning-onboarding.test.ts`
- `tests/viral-shorts-worker.test.ts`

## 11. Intentional non-goals

Эта система специально не делает следующее:
- не требует editor-facing style forms с десятками полей;
- не делает первые 10 references deterministic style lock;
- не заменяет examples corpus / hard constraints / prompt-config;
- не ломает текущую Stage 2 pipeline architecture;
- не hard-bias'ит всю систему глобально в sarcasm / humor / quote-heavy voice.

Channel flavor должен приходить из:
- bootstrap selections,
- rolling feedback memory,
- clip context,

а не из одного узкого глобального base prompt.
