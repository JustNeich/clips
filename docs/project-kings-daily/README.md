# Project Kings Daily

Это короткий production-контур для ежедневного выпуска ровно трёх новых Shorts на каждый канал:

- Dark Joy Boy — Clips `4b59c5cf412e4c07b192f3312361c2eb`, YouTube `UCwO37rtHMhHX8caUr5Rc0Bw`;
- THE LIGHT KINGDOM — Clips `43923d42c1c0495282f29d4c6e09b0b4`, YouTube `UC0LWZYpYuYAWK55WmvDqxbg`;
- COP SCOPES — Clips `6187aeeea7bd47188e08089c5916edc1`, YouTube `UCJhBMXXQ5GrTbrhqjwT1leg`.

## Запуск

Обычный запуск использует существующие Clips API, workers, расписание и защищённые credentials:

```bash
npm run project-kings:daily
```

Контрольный прогон по одному ролику на канал без публикации:

```bash
npm run project-kings:daily -- --target-per-channel 1 --no-publish
```

Токен не передаётся в командной строке и не запрашивается у владельца во время нормального запуска. Runner загружает `CHANNELS.md`, `SOURCE.md`, `CAPTION_MONTAGE.md` и `QA.md` как рабочие инструкции агентов; порядок ремонта берёт из `RUNBOOK.md`.

На production-машине runner читает `CLIPS_MCP_TOKEN` из защищённого env или `~/.config/assistant/clips-mcp.env`. Для owner-контроля без публикации допустим существующий авторизованный CDP-сеанс через `--cdp-url`. Если внешний downloader недоступен, runner использует подготовленный MP4/локальный `yt-dlp` и существующий Clips source-upload.

## Готово

Цикл завершён только когда одновременно выполнено всё:

1. Есть `3/3/3` новых `public_verified` Shorts на точных YouTube channel ID выше.
2. Для каждого ролика совпали Clips state, YouTube RSS и точная `/shorts/<id>`-страница.
3. Нет повторов источника или сюжета и нет upload с неизвестным результатом.
4. Каждый финальный MP4 прошёл техническую проверку и независимого судью.
5. Источники помечены `used` только после публичной проверки.
6. После выпуска снова есть минимум шесть готовых источников на каждый канал.
7. Следующий scheduled wake сохранён и начал обработку без команды из чата.

Зелёные тесты, готовый render или статус `scheduled` сами по себе не означают «Готово».

## Безопасная остановка

Отправь runner один `SIGTERM` или нажми `Ctrl-C` один раз. Он прекращает брать новые slots, сохраняет текущий этап и даёт начатой загрузке перейти в известное состояние. После остановки сначала reconcile уже созданный YouTube ID; никогда не повторяй upload вслепую. Повторный запуск продолжает работу из сохранённого ledger.

Во время daily run запрещены deploy, migration, смена credentials, channel bindings и архитектурные изменения.
