# Stage 3 Preview Reliability

Этот документ фиксирует минимальные инварианты, которые держат Step 3 редактор предсказуемым в ежедневной работе.

## 1. Proxy редактора не должен ждать точный preview

- `editing-proxy` является базовой зависимостью editor-loop: без него нельзя быстро менять тайминг, кадр и фон.
- `preview` является более дорогим и вторичным job kind'ом.
- В host queue все non-preview job kinds теперь забираются раньше `preview`, даже если `preview` встал в очередь раньше.
- Практический смысл: editor proxy и render больше не должны зависать за длинным accurate preview.

## 2. Live preview не должен стирать последнее рабочее видео

- При рефреше proxy или accurate preview UI больше не обнуляет последнее удачное видео заранее.
- Пока новый артефакт готовится, пользователь продолжает видеть последнюю рабочую версию вместо placeholder'а.
- Это снижает визуальный flicker и убирает ложное ощущение, что фон или исходник “слетели”.

## 3. Главный preview всегда остаётся live draft

- В Step 3 больше нет split surface `Редактор / Финал`.
- Основной preview всегда работает от live draft и канонического `0..6s` playback plan.
- Accurate/final artifact может собираться в фоне, но он не имеет права подменять главный preview transport и его red playhead.
- История версий и точный артефакт открываются из drawer, а не через переключение режима поверхности.

## 4. Background mode не должен самопроизвольно деградировать

- Если у шаблона нет кастомного background asset, но уже есть source preview video, preview сохраняет режим `source-blur`.
- Editor больше не подменяет этот режим на fallback только из-за surface mode.
- Фон должен меняться только по явному действию пользователя или из-за реального отсутствия source/custom asset.

## 5. Source duration должна переиспользоваться из editing-proxy

- Editing proxy уже знает `sourceDurationSec`.
- UI читает это значение из job result и использует как ранний источник правды.
- Медленный `/api/video/meta` остаётся fallback-путём, а не единственным способом узнать длительность ролика.

## 6. Assigned managed template не должен тихо падать в built-in fallback

- Step 3 должен получать runtime-состояние шаблона, который реально назначен видимому каналу, даже если библиотека шаблонов в редакторе ограничена personal scope.
- При временной ошибке повторной загрузки UI больше не должен затирать уже загруженный managed template built-in fallback'ом.
- Иначе preview строится по одной конфигурации, а final render по другой, что и приводит к `Template snapshot drift detected`.

## 7. Render и preview обязаны использовать snapshot-backed managed template runtime

- Если Step 3 уже собрал authoritative preview для custom template, его `baseTemplateId`, `templateConfig` и `updatedAt` должны ехать дальше в `snapshot`.
- Host render, accurate preview, viewport/crop расчёты и optimization agent не должны повторно угадывать тот же template через локальный `design/managed-templates/*.json`.
- Это особенно важно для production/local worker, где нужный managed template может отсутствовать на диске.

## 8. Missing custom template не должен подменяться другим сохранённым template

- Если запрошенный managed template id не найден, runtime не имеет права молча брать “последний обновлённый” чужой template.
- Без этого missing-id на worker превращается не в понятный fallback, а в произвольный layout, и drift становится непредсказуемым.
- Безопасный fallback здесь только built-in template или snapshot-backed runtime, если он был передан из preview.

## 9. System templates должны быть immutable, а built-ins должны досеиваться автоматически

- Встроенные template ids являются общей базой проекта: они должны быть видимы всем ролям, но не должны редактироваться или удаляться через managed template API/UI.
- Иначе редактор может случайно испортить глобальный fallback для всего workspace и получить эффект “шаблон внезапно пропал”.
- Seed marker `.seeded` не должен блокировать появление новых built-in templates в старых инсталляциях: runtime обязан досоздавать недостающие JSON-файлы инкрементально.

## 10. Channel template assignment должен быть валидируемым и предсказуемым

- Канал не должен молча принимать `templateId`, которого текущий пользователь не видит в своей template library.
- При удалении custom template все каналы, которые его использовали, должны уходить в стабильный built-in fallback `science-card-v1`, а не в случайный шаблон из персонального списка удаляющего пользователя.
- Если запрос к template library временно падает, UI не должен затирать последний успешный список и притворяться, что активный шаблон “недоступен”.

## 11. Browser-facing video routes обязаны поддерживать byte-range seek

- Editing proxy, preview artifact и любые другие mp4/webm маршруты, которыми кормится browser preview, должны отвечать с `Accept-Ranges: bytes`.
- Если route игнорирует `Range` и всегда стримит только `200 OK`, браузер не может перейти в поздний source offset вроде `40s`, даже если transport выставил `video.currentTime = 40`.
- В таком состоянии Step 3 визуально ломается циклически: media остаётся в начале файла, а редакторская логика продолжает считать, что playhead должен быть уже в выбранном окне.
