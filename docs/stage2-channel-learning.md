# Stage 2 Channel Learning

Этот документ описывает новый слой channel bootstrap + adaptive learning для Stage 2.

Цель системы:
- не заставлять редактора заполнять сложную style-анкету;
- не зашивать канал в маленькую публичную библиотеку preset-архетипов;
- не позволять первым 10 reference links автоматически и навсегда определить identity канала;
- дать Stage 2 мягкий, обучаемый, но не застывший editorial prior.

Важно:
- channel learning не заменяет platform line policy в `native_caption_v3`;
- line selector задаёт production family boundary (`stable_reference_v6`, `stable_social_wave_v1`, `stable_skill_gap_v1`, `experimental`);
- bootstrap style profile + editorial memory живут поверх этой boundary и уточняют channel-specific steering.
- у `stable_reference_v6` эти сигналы теперь особенно важны, потому что baseline line работает через product-owned one-shot prompt:
  - current clip comments читаются как clip-local social read;
  - channel bootstrap и reaction history читаются как style/tone boundaries;
  - они не могут переопределять visible facts из текущего ролика.
  - one-shot обязан сам собрать 5 publishable options без runtime filler/backfill.
  - runtime допускает только tiny deterministic exact-length polish для маленьких перелётов по длине, если publishable wording остаётся тем же по смыслу.

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
- для `stable_reference_v6` выбранные directions и editorial memory влияют на narrator DNA внутри product-owned one-shot baseline, а не через внешний validator/repair loop.

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
- подтягивает title / description / transcript excerpt, если это возможно;
- приоритизирует более сильный comments signal:
  - берёт не только крошечный slice;
  - поднимает более залайканные и более signal-rich comments;
  - старается не давать generic fandom noise доминировать;
- по возможности сэмплирует 3 реальных кадра на reference:
  - early/setup;
  - middle/turn;
  - late/payoff;
- собирает richer reference packet для style-discovery prompt.

### Step 4. Style picks

LLM генерирует около 20 human-readable style directions.

Редактор может выбрать много карточек, включая почти весь пул.

Именно этот выбор становится initial channel prior.

Дополнительно:
- UI больше не заставляет искусственно ужимать всё до 5 карточек;
- можно выбрать хоть весь пул;
- при этом карточки всё равно раскладываются на опорные, соседние и exploratory предложения;
- exploration share можно подправить уже на шаге выбора карточек, а потом и после onboarding в менеджере канала.

## 3. Style discovery model

### Что делает модель

Style discovery не ищет preset в фиксированной библиотеке. Вместо этого модель:
- смотрит на reference links;
- читает comments как главный audience-signal;
- читает реальные sampled frames как главный packaging-signal;
- использует metadata и transcript как supportive context, а не как единственный источник правды;
- собирает `audiencePortrait` и `packagingPortrait`;
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
- `audiencePortrait`
- `packagingPortrait`
- `bootstrapDiagnostics`
- `candidateDirections`
- `selectedDirectionIds`
- `explorationShare`

`bootstrapDiagnostics` хранит компактный audit layer:
- `confidence`
- `summary`
- usable / transcript / comments / frames coverage
- `imagesUsed`
- prompt version / model / reasoning effort
- extraction / comment coverage summaries
- evidence notes

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

После onboarding этот профиль остаётся редактируемым в менеджере канала:
- редактор может менять reference links;
- может явно перегенерировать style pool;
- может переотмечать selected directions;
- может менять exploration share без повторного прохождения полного wizard.

Важно:
- правка links не пишет новый runtime profile автоматически;
- если links поменялись, editor draft помечается как `stale`;
- старый pool остаётся видимым;
- сохранить новый runtime profile можно только после явной пересборки под текущие ссылки.

### Editorial feedback events

Хранятся в:
- `channel_editorial_feedback_events`

Каждое событие может содержать:
- `kind`
- `scope`
- optional `note`
- `optionSnapshot`
- `chatId`
- `stage2RunId`
- timestamp

Сейчас поддерживаются:
- `more_like_this`
- `less_like_this`
- `selected_option`

`scope` бывает:
- `option`
- `top`
- `bottom`

`optionSnapshot` по-прежнему хранит полный видимый вариант, но scope говорит runtime, какая часть реально была оценена.

## 5. Feedback loop

В normal Stage 2 work editor может дать сверхлёгкий feedback:
- `лайк` / `дизлайк` по whole option
- `лайк` / `дизлайк` только по `TOP`
- `лайк` / `дизлайк` только по `BOTTOM`
- optional note

Также система считает полезным сигналом:
- явный выбор caption option в UI как `selected_option`

Сигналы не требуют от редактора думать в терминах:
- audience target
- narrative taxonomy
- sarcasm sliders
- reaction archetypes

Вместо этого система сама переводит feedback в soft weights.

UI truth model:
- в пользовательской истории видны только явные `like / dislike` события;
- `selected_option` остаётся отдельным слабым пассивным сигналом и в историю не попадает;
- после `Save` feedback фиксируется даже без note, а composer скрывается.
- явные реакции можно удалить из истории; после удаления editorial memory сразу пересчитывается по оставшимся сигналам.

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
- line-aware assembly живёт в:
  - `lib/stage2-editorial-memory-resolution.ts`

Ключевой builder:
- `buildStage2EditorialMemorySummary(...)`

Правила памяти:
- strongest influence дают только последние `~30` явных rating events;
- `hard_rule`-реакции не выпадают из active memory вместе с обычным rolling window и остаются pinned, пока редактор их не удалит;
- passive `selected_option` signals учитываются отдельно и слабее;
- старые события не остаются равно сильными бесконечно;
- внутри окна новые реакции важнее старых;
- bootstrap selections дают мягкий стартовый prior, но не фиксируют канал навсегда.

Дополнительное правило для platform lines:
- если Stage 2 run знает `stage2WorkerProfileId`, editorial memory собирается по принципу `same-line-first`;
- primary pool = явные rating events из run'ов той же line;
- fallback pool = channel-wide recent events, если same-line explicit signal слишком слабый;
- events без `stage2RunId` участвуют только в fallback pool;
- hard rules остаются активными всегда, независимо от линии;
- passive selections могут дополнять картину, но не должны побеждать explicit ratings.

Режимы заметок:
- `soft_preference` — базовый режим, живёт внутри окна последних `30` явных реакций;
- `hard_rule` — pinned-слой поверх rolling window, не исчезает автоматически;
- `situational_note` — тоже идёт в rolling window, но слабее обычного soft preference и лучше работает как локальная подсказка, а не постоянная привычка канала.

Scope weighting:
- `option` влияет на cues / directions / angles полным весом;
- `top` сильнее двигает top-side text cues и мягче влияет на directions;
- `bottom` сильнее двигает bottom-side text cues и мягче влияет на directions.

Технически summary включает:
- `directionScores`
- `angleScores`
- `preferredTextCues`
- `discouragedTextCues`
- `hardRuleNotes`
- `recentNotes`
- `normalizedAxes`
- `promptSummary`

Это summary является runtime-friendly representation того, чему канал научился к текущему моменту.

Важно:
- literal `preferredTextCues` / `discouragedTextCues` можно хранить для inspectability и debugging;
- но они больше не должны попадать в runtime prompts как глобальный lexical prior для любого нового клипа;
- в prompt context уезжает только structural summary (`directions`, `angles`, `notes`, `axes`, bootstrap lessons), чтобы прошлые удачные формулировки не протекали между разными clip families.

Важно про wording:
- bootstrap prior и recent feedback больше не должны описываться одними и теми же словами;
- если `recentFeedbackCount = 0`, `promptSummary` не должен притворяться, что есть “Recent positive pull”;
- bootstrap prior должен называться bootstrap prior;
- explicit ratings и passive selections должны называться по-разному;
- recent feedback должен называться recent feedback только если такие события реально были.

## 6.1 Durable style discovery runs

Bootstrap style discovery больше не живёт как одноразовый client-side `fetch`.

Теперь:
- `POST /api/channels/style-discovery` создаёт durable run в `channel_style_discovery_runs`;
- UI сохраняет `activeStyleDiscoveryRunId` внутри onboarding draft;
- post-onboarding style editor использует тот же durable run contract;
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
- `editorialMemorySource`

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
- audience portrait summary
- packaging portrait summary
- bootstrap confidence summary
- rolling editorial memory
- exploration share

Для `stable_reference_v6` этот слой дополнительно компактизируется в two steering packets:
- `channel_narrative_json`
- `editorial_memory_json`

Они intentionally не содержат raw chain-of-thought или полный lexical dump прошлых caption wins.

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
  - high-like acronyms, nicknames и compact punchlines должны доходить до writing layer, если они реально sharpen the line;
  - если comments дали сильный shorthand pressure, writer должен выпустить не только safe visual lines, но и 1-2 clean comment-native lines;
  - нельзя paste'ить comment text как готовый bottom;
- нельзя уходить в generic stock tails только потому, что batch уже звучит “нормально”.

`stable_reference_v6` one-shot baseline:
- не использует workspace-editable stage prompts;
- получает тот же channel learning в виде compact steering JSON;
- обязан уважать порядок влияния:
  1. video truth
  2. current comment wave
  3. line policy
  4. channel bootstrap narrative
  5. editorial memory
- historical feedback может калибровать tone и narrator habit, но не имеет права добавлять факты, которых нет в текущем ролике.

`critic` и `final selector`:
- не должны автоматически убивать все exploratory кандидаты;
- должны сохранять минимум один сильный exploratory alternate, если он конкурентен по качеству;
- critic отдельно штрафует wrong-market semantic borrowing, если candidate хорошо звучит по форме, но семантически приехал из слабого example pool.
- critic дополнительно следит за batch-level sameness:
  - одинаковые bottom openings;
  - одинаковая tail function;
  - polished-but-interchangeable lines.
- critic и final selector теперь дополнительно смотрят на `comment carry`:
  - был ли у run сильный shorthand pressure;
  - есть ли в batch хотя бы один clean comment-native candidate;
  - не выиграл ли sanitized line только потому, что звучит безопаснее.
- final selector смотрит не только на angle labels, но и на `style_direction_ids`, `exploration_mode` и реальную rhythm/feel-diversity visible five.
- final selector дополнительно не должен оставлять repaired+generic winner наверху, если в visible five уже есть cleaner alternative.
- при близком качестве final selector может поднять comment-native candidate над safe generic line, если audience shorthand реально sharpen'ит clip-safe bottom.

### Robotic phrasing suppression

Base prompt stack intentionally suppresses:
- interchangeable quote-first bottoms;
- stock tails вроде `the reaction basically writes itself`;
- repaired fragments, reporting-verb cliffhangers и их rescue через generic filler;
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
