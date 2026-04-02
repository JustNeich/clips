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

## 3. Accurate preview работает только в surface `Финал`

- В режиме `Редактор` нужен быстрый feedback loop, а не дорогой linear preview.
- Поэтому автоматический accurate preview запускается только когда surface находится в режиме `Финал`.
- Переключение в `Редактор` перестаёт подпитывать host queue тяжёлыми preview job'ами.

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
