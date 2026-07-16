# Stage 3 Preview Reliability

Этот документ фиксирует минимальные инварианты, которые держат Step 3 редактор предсказуемым в ежедневной работе.

## 1. Proxy редактора не должен ждать точный preview

- `editing-proxy` является базовой зависимостью editor-loop: без него нельзя быстро менять тайминг, кадр и фон.
- `preview` является более дорогим и вторичным job kind'ом.
- В host queue все non-preview job kinds теперь забираются раньше `preview`, даже если `preview` встал в очередь раньше.
- Local worker queue использует тот же принцип: `render`, `source-download` и `agent-media-step` не должны голодать за новым `preview`.
- Практический смысл: editor proxy и render больше не должны зависать за длинным accurate preview.

## 2. Live preview не должен стирать последнее рабочее видео

- При рефреше proxy или accurate preview UI больше не обнуляет последнее удачное видео заранее.
- Пока новый артефакт готовится, пользователь продолжает видеть последнюю рабочую версию вместо placeholder'а.
- При первом открытии Step 3 UI может показать `cacheOnly` source media из server source cache ещё до готовности `editing-proxy`; это только ранний first paint, а не замена плотного proxy для seek/scrub.
- `cacheOnly` routes не имеют права скачивать source заново: если cache холодный, UI остаётся на обычном пути `editing-proxy`.
- Это снижает визуальный flicker и убирает ложное ощущение, что фон или исходник “слетели”.

## 3. Главный preview всегда остаётся live draft

- В Step 3 больше нет split surface `Редактор / Финал`.
- Основной preview всегда работает от live draft и канонического `0..targetDurationSec` playback plan.
- `targetDurationSec` обычно приходит из настройки длительности рендера канала, по умолчанию `6s`, с диапазоном `3..59s`.
- Оператор может переопределить `targetDurationSec` прямо в Step 3 для текущего ролика; это сохраняется в draft/render plan и не меняет дефолт канала.
- Для отдельных роликов render plan может включить `durationMode: source_full`; тогда effective duration берётся из metadata/proxy исходника и не сжимается в канал-дефолт.
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
- Локальный desktop/CLI worker перед прямым скачиванием source сначала пробует забрать уже готовый source из host cache в `cacheOnly` режиме. Если host cache холодный, worker продолжает прежний локальный путь и не блокируется этой оптимизацией.

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

## 12. Stage 3 ошибки должны быть flow-observable

- Preview, render и editing-proxy jobs, стартующие из Step 3, должны нести `chatId` и `channelId`, чтобы owner journal и MCP могли собрать всю историю по конкретному ролику.
- Ошибки до создания job, например отсутствующий source или недоступный локальный executor, фиксируются compact audit event-ом `stage3_request.failed`.
- Local worker readiness personal-by-default: snapshot готовности считается по worker-ам текущего пользователя, а не по общему workspace pool. Worker другого редактора не должен превращать Step 3 текущего пользователя в `Online`.
- Local worker claim personal-by-default: `preview`, `render`, `source-download` и `agent-media-step` jobs текущего пользователя не могут быть claim-нуты worker-ом другого пользователя. Shared render machine может появиться только как отдельный явный режим.
- Local worker runtime не должен claim-ить jobs, если runtime dependency install не соответствует платформе пользователя. Серверный `runtime-deps.tar.gz` используется только при совпадении `runtimeDependenciesPlatform`; иначе worker делает локальный `npm install` и чинит native bindings до входа в job loop.
- `worker_unavailable` / `worker_runtime_outdated` audit events сохраняют snapshot готовности локального executor: `onlineWorkers`, `compatibleOnlineWorkers`, `expectedRuntimeVersion`.
- Ошибки внутри job фиксируются в `stage3_jobs`, `stage3_job_events` и audit event `stage3_job.failed`.
- Если несовместимый worker уже online и пытается claim-ить jobs после deploy, queued local jobs текущего пользователя не должны бесконечно показывать `Ожидает локальный executor`: при отсутствии совместимого online worker-а они fail-visible как recoverable `worker_runtime_outdated`.
- Host не должен доверять только свежему worker heartbeat для long-running local jobs: если `editing-proxy` / `preview` / `render` / `source-download` / `agent-media-step` старше kind-specific watchdog timeout, серверный sweep переводит job в recoverable `*_timeout`, очищает lease и освобождает очередь. Для local `render` timeout duration-aware: короткие 6-20s renders получают 10-минутный production-safe floor, а длинные ролики плавно получают больше времени до 15-минутного cap. Это предотвращает `Busy` без ошибки, когда зависший `editing-proxy` или stuck render блокирует последующий render.
- Серверный и локальный executor используют один duration-aware timeout resolver. Если heartbeat по running job получает `404/409`, worker считает lease потерянным, abort-ит текущую Stage 3 операцию и завершает процесс, чтобы старый render не продолжал занимать локальный executor после того, как сервер уже освободил job.
- Если queued local job осталась после watchdog timeout, но у текущего пользователя больше нет running local job и свежего online worker-а, статусный poll должен завершить её recoverable `worker_unavailable`, а не оставлять UI в бесконечном `Ожидает локальный executor`. Для `editing-proxy` это окно короче, чем для render/source jobs: editor proxy является интерактивной зависимостью Step 3 и должен fail-visible примерно через 15 секунд без executor, а не через 90 секунд.
- Host executor использует отдельный kind-specific timeout guard для active jobs. Если hosted `editing-proxy` / `preview` / `render` завис и держит единственный CPU slot, runtime помечает job recoverable `*_timeout`, отправляет abort-сигнал и запускает следующий queued job. Hosted `render` не наследует короткий local-worker floor: даже короткий 6s output получает минимум 15 минут на host job, 20s production renders получают около 20 минут, а слишком низкие host/env caps не могут опустить render ниже production-safe floor. Remotion `timeoutInMilliseconds` на hosted runtime поднимается выше слишком низкого `REMOTION_RENDER_TIMEOUT_MS`, чтобы env вроде 180s не убивал нормальный render раньше очередного watchdog.
- Hosted `render` не должен быть чёрным ящиком. Job events должны показывать стадии `source_cache`, `prepare_source`, `asset_resolve`, `remotion_render`, `flash_guard`, `finalize` с duration и ключевыми размерами файлов/profile payload, чтобы 6-секундный render больше не мог висеть 10-15 минут без внутренних событий.
- Hosted `render` выполняется в отдельном child process, если собран `output/stage3-host-render-child.cjs` или явно включён `STAGE3_HOST_RENDER_CHILD_PROCESS=1`. Parent process остаётся watchdog-ом: при timeout он помечает job recoverable, освобождает lane slot и завершает child process group через `SIGTERM`/`SIGKILL`.
- Hosted fast render profile включён по умолчанию на Render runtime, если не задан `STAGE3_HOSTED_FAST_RENDER_PROFILE=0`. Он использует encode-only variation, x264 `veryfast`, CRF `20..22` и не включает hybrid SVG noise overlay как default для production host.
- Hosted fast render profile не должен тратить минуты на подготовку всего исходника, если финальный ролик использует только короткое окно. Для render он может брать уже проверенный source-media cache напрямую и нормализовать только выбранный render-сегмент.
- На Render fast path кастомный video-background по умолчанию превращается в один render-sized still frame перед Remotion (`STAGE3_HOSTED_FAST_VIDEO_BACKGROUND_STILL=0` отключает это). Это сохраняет brand background как визуальный фон, но не заставляет Remotion декодировать второй MP4 на каждый кадр; локальный executor продолжает использовать animated background video.
- Hosted fast finalize не должен повторно кодировать видео после Remotion/flash-guard: финальный pass делает stream-copy video mux с подготовленным audio и metadata cleanup.
- Hosted fast render profile кеширует подготовленный render source по source key, source duration, segments, target duration, music signature и render plan. Retry того же render не должен повторно пересчитывать source prep, если cache entry валиден.
- Host scheduler разделяет lanes: `render` идёт отдельно от interactive jobs (`editing-proxy`, `preview`, `source-download`, `agent-media-step`). Свободная render lane не должна вызывать reschedule loop, если в очереди ждут только interactive jobs при полной interactive lane, и наоборот. Практический смысл: preview/editor proxy не ждут production render.
- Host queue, как и local queue, прерывает superseded queued `preview` / `render` для того же workspace/user/chat или source, чтобы повторные клики редактора не превращались в длинный хвост устаревших задач.
- Flow list / MCP summary отдаёт `stage3Runtime` backlog-снимок: queued/running local/host jobs, oldest queued/running age, expired local leases и свежие `worker_unavailable` события.
- Template drift не должен выглядеть как generic render failure: он классифицируется как `template_snapshot_drift` и остаётся recoverable, потому что операторский recovery — обновить preview и повторить render.
- Host artifact storage должен чистить старые `preview` / `render` / `editing-proxy` файлы до записи нового артефакта, а не только после успешной записи. Иначе заполненный persistent disk превращает worker completion в повторяющиеся `ENOSPC` / HTTP 500.
- Persistent storage cleanup не должен удалять актуальные данные: активные source/stage3 jobs, свежие uploaded-чаты и artifacts активных публикаций защищены. Неактивные старые render exports и uploaded-source mp4 могут удаляться, чтобы local worker completion не падал на серверном `/var/data`.

## 13. Per-draft audio и manual highlights

- `sourceAudioGain` хранится в render plan рядом с `sourceAudioEnabled` и `musicGain`; final preview/render должен применять его к аудио исходника до микса с музыкой.
- Ручные highlight-spans в Step 3 являются частью `captionHighlights` текущего draft. Они не переписывают template profile и не требуют нового Stage 2 run.
- Если у шаблона включено несколько highlight-цветов, Step 3 показывает их как палитру: редактор выбирает цвет, затем выделяет слова в TOP/BOTTOM, а повторное выделение тем же цветом снимает только выбранный span.
- При ручной правке текста spans нормализуются к новому тексту тем же путём, что и Stage 2 highlight-spans.

## 14. Пустые flash-кадры не должны попадать в preview/render artifact

- Подготовленный Stage 3 source clip и сырой Remotion render проходят flash guard перед сохранением артефакта.
- Guard ищет нейтральные пустые белые/чёрные кадры по full-frame сигналу, а final render дополнительно проверяет media slot из template snapshot.
- Найденный пустой кадр заменяется ближайшим валидным соседним кадром, чтобы одиночная ошибка декодера, offthread-video frame extraction или source-prep не превращалась в видимую вспышку.
- Это именно fail-closed safety net: цветокоррекция остаётся пользовательской настройкой, а guard исправляет только кадры с uniform blank signature.

## 15. Source crop в owner MCP всегда нормализован

- `snapshot.renderPlan.sourceCrop.x/y/width/height` задаются долями исходного кадра от `0` до `1`, а не пикселями.
- Суммы `x + width` и `y + height` не могут выходить за `1`.
- Owner preview/render API отклоняет пиксельные или выходящие за границы значения до постановки job в очередь. Он не должен молча зажимать `y=465` или `height=552` до узкой нижней полосы.
- Пример полного внутреннего кадра: `x=0, y=0, width=1, height=1`. Пример обрезки верхних и нижних 20%: `x=0, y=0.2, width=1, height=0.6`.

## 16. Owner preview является media-only проверкой

- `clips_owner_render_preview` подготавливает только внутреннее исходное видео после timing/crop/fit. Это не композиция полной карточки.
- В preview намеренно отсутствуют channel card, author row, caption text и highlights. Их отсутствие не является ошибкой preview.
- Редактор использует этот artifact, чтобы доказать правильный фрагмент, кадрирование и отсутствие donor wrapper.
- Текст, карточка, шапка и highlights проверяются на полном финальном render с `publishAfterRender=false`.
- Ответ owner API явно возвращает `previewScope="media-only"`, список `validates` и список `doesNotValidate`, чтобы агент не угадывал назначение artifact.
