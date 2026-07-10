# Phase 2: topology and safety spine — implementation evidence

Status: `implementation_evidence_only`.

Это доказательство локальной реализации и тестов. Оно не означает deploy,
загрузку launchd, включение feature flag или live-приёмку `3 × 3`.

## Что реализовано

- Zoro запускает bounded server tick; Render не поднимает собственный постоянный
  portfolio timer по умолчанию.
- Один singleton daemon lease допускает только одного владельца конфигурации.
- Отдельный dispatch lease не позволяет второму запросу начать ту же длинную
  обработку, даже если первый HTTP-клиент получил timeout.
- Daemon и dispatch lease продлеваются во время ожидаемого server-side прохода.
- Claim, renew, acknowledge и retry каждой outbox-записи требуют точные
  `daemon lease token + dispatch token + config SHA-256`.
- Ограничения параллельности опираются на durable processing claims в SQLite:
  semantic `3`, render `1`, publication `2` глобально и `1` на канал,
  source-ingest `1` на profile/channel.
- Введено durable владение pilot-каналами. Пока v1 владеет каналом, legacy не
  может создать публикацию; SQL-trigger закрывает race между проверкой и insert.
- Stop сначала переводит владение в `releasing`, запрещает новые outbox intents
  и только после полного drain переводит его в `released`. После этого legacy
  снова разрешён.
- launchd использует content-addressed копию daemon runtime, exact config hash
  и отказывается запускаться при изменении байтов runtime/config.
- Миграция старых CHECK constraints временно снимает ownership-trigger только
  внутри одной транзакции и восстанавливает его точную canonical-версию до
  commit.

## Проверки

Целевой runtime-набор:

```text
83/83 TypeScript tests PASS
27/27 daemon/installer MJS tests PASS
```

В набор входят отдельные проверки:

- два daemon-процесса и один допустимый dispatch;
- потеря lease посередине batch без последующих side effects;
- reclaim истёкшей outbox lease новым владельцем;
- все глобальные и поканальные лимиты;
- блокировка legacy для CopScopes при active/releasing ownership;
- отсутствие новых intents после stop;
- безопасный drain и возврат legacy после release;
- timeout клиента при незавершённой semantic-работе без второго dispatch;
- сохранность items/outbox при миграции legacy-схемы;
- tamper runtime/config после установки.

Дополнительные статические gates:

```text
npm run typecheck — PASS
npx eslint <all Phase-2 changed files> — PASS
```

Baseline до изменения: `54/54` выбранных тестов PASS.

## Основные точки кода

- `lib/portfolio-production-daemon-store.ts` — singleton, dispatch lease и
  ownership lifecycle.
- `lib/portfolio-production-store.ts` — fence каждой outbox-операции и durable
  resource capacity.
- `lib/portfolio-production-live-background-runtime.ts` — один bounded pass без
  process-global scheduler/limiter.
- `lib/project-kings/portfolio-daemon.ts` — heartbeat, dispatch fencing,
  ownership и безопасная остановка.
- `lib/publication-store.ts` и `lib/db/schema.ts` — mutual exclusion legacy/v1 и
  атомарные SQL fences.
- `scripts/run-project-kings-portfolio-daemon.mjs` — bounded retries, длинный
  HTTP timeout и exact config-byte check.
- `scripts/install-project-kings-portfolio-launchd.mjs` — immutable
  content-addressed runtime release.

## Оставшееся ограничение

Один tick остаётся bounded, но удерживает один HTTP-запрос до завершения
текущего этапа; текущий максимум клиента — 30 минут, default — 15 минут. Lease
heartbeat делает это безопасным от split-brain, однако будущий enqueue/poll
протокол сможет уменьшить длительность соединения без изменения state machine.

Production deploy, установка plist, активация launchd и live `3 × 3` в рамках
этого изменения не выполнялись.
