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

## 6. Assigned workspace template не должен тихо падать в built-in fallback

- Step 3 должен получать runtime-состояние workspace template, который реально назначен каналу.
- Библиотека шаблонов workspace-wide, поэтому UI не фильтрует её по owner/read-only/system visibility.
- При временной ошибке повторной загрузки UI больше не должен затирать последний успешный список и выбранный шаблон.
- Иначе preview строится по одной конфигурации, а final render по другой, что приводит к `Template snapshot drift detected`.

## 7. Render и preview обязаны использовать snapshot-backed workspace template runtime

- Если Step 3 уже собрал authoritative preview для workspace template, его `baseTemplateId`/`layoutFamily`, `templateConfig` и `updatedAt` должны ехать дальше в `snapshot`.
- Host render, accurate preview, viewport/crop расчёты и optimization agent не должны повторно угадывать тот же template через локальный `design/managed-templates/*.json`.
- Active template source of truth теперь SQLite `workspace_templates`; legacy JSON используется только для migration/bootstrap.

## 8. Missing workspace template должен self-heal к workspace default

- Если канал ссылается на отсутствующий `template_id`, read path должен перепривязать его к `workspace.default_template_id` и сохранить repair.
- Runtime не имеет права молча брать “последний обновлённый” или чужой template, потому что это превращает missing-id в произвольный layout.
- Если workspace default тоже повреждён, библиотека должна досеять нормальный workspace template; последний template workspace удалить нельзя.

## 9. System templates не участвуют в channel assignment

- Каналы ссылаются только на реальные строки `workspace_templates.id` из того же workspace.
- Built-in renderer families могут использоваться как стартовые presets при создании template row, но не являются selectable runtime identity.
- Workspace default template является обычной видимой строкой в библиотеке и отличается только ссылкой `workspaces.default_template_id`.

## 10. Channel template assignment должен быть валидируемым и предсказуемым

- Канал не должен принимать `templateId`, которого нет в `workspace_templates` этого же workspace.
- При удалении template все каналы, которые его использовали, должны уходить в `workspace.default_template_id` в той же transaction.
- Если удаляется текущий default, перед удалением должен быть выбран самый старый неархивный replacement.
- Последний template workspace удалить нельзя.
- Если запрос к template library временно падает, UI не должен затирать последний успешный список и притворяться, что активный шаблон “недоступен”.

## 11. Browser-facing video routes обязаны поддерживать byte-range seek

- Editing proxy, preview artifact и любые другие mp4/webm маршруты, которыми кормится browser preview, должны отвечать с `Accept-Ranges: bytes`.
- Если route игнорирует `Range` и всегда стримит только `200 OK`, браузер не может перейти в поздний source offset вроде `40s`, даже если transport выставил `video.currentTime = 40`.
- В таком состоянии Step 3 визуально ломается циклически: media остаётся в начале файла, а редакторская логика продолжает считать, что playhead должен быть уже в выбранном окне.
