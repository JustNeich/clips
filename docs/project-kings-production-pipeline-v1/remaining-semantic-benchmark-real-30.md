# Project Kings: benchmark оставшихся semantic-ролей на 30 случаях

Статус: `model calls in progress / production selection not frozen`.

Этот контур закрывает четыре роли, для которых прежние проверки на трёх fixtures доказывали только связь с моделью:

- `source_search`;
- `source_fit`;
- `caption`;
- `montage_planner`.

## Данные

Основа — те же 30 реальных MP4 Project Kings, которые уже были полностью декодированы для source-policy corpus:

- 8 Dark Joy Boy;
- 10 COP SCOPES;
- 12 THE LIGHT KINGDOM.

Для каждого MP4 используются точный SHA-256, source metadata и три распределённых по ролику реальных key frames. Ground truth был заморожен до вызова тестируемых моделей. Он связан с уже существовавшими human source-research verdicts и pilot catalog, а не с ответами benchmark-моделей.

Файл аннотаций:

`docs/project-kings-production-pipeline-v1/evidence/remaining-semantic-benchmark-real-30-v2/annotations.json`

В каждой роли ровно 30 уникальных typed packets:

- Source Search: 15 pool с одним source той же концепции и 15 pool только с cross-profile sources. Search оценивает только concept/supply; downstream reject из Source Fit не используется как Search-label;
- Source Fit: реальные target/reject решения плюс шесть явно внесённых video+event duplicates;
- Caption: 19 уникальных прошедших исходников и 11 вторых редакционных ограничений на реальных исходниках;
- Montage Planner: тот же пригодный пул, но с разными реальными duration и двумя target-duration режимами.

## Gates

Общие требования для каждого route/reasoning:

- 30/30 schema-valid outputs;
- 30/30 deterministic quality PASS;
- p95 не выше SLA этапа;
- полная usage/cost telemetry;
- второй прошедший route обязателен как fallback.

Дополнительный scorer проверяет не только поле `decision`:

- Source Search не может выбрать выдуманный или human-rejected candidate;
- Source Fit обязан сохранить duplicate flags и fail-closed отклонить непригодный source;
- Caption обязан соблюдать max length, title, banned/meta gates, `hook → action → payoff`, factual claims и минимум два content anchors;
- Montage обязан вернуть точную duration, непересекающуюся временную шкалу, порядок `hook → action → payoff` и 75–125% требуемого полезного хронометража.

## Запуск

```bash
PROJECT_KINGS_REMAINING_BENCHMARK_ROLE=source_search \
PROJECT_KINGS_REMAINING_BENCHMARK_VERSION=real-30-v2 \
node --import tsx scripts/run-project-kings-remaining-semantic-benchmarks.mts
```

Для каждого запуска сохраняются два immutable файла:

- нормализованное evidence с dataset/prompt/schema/evaluator/policy SHA;
- raw evidence с каждым JSON-ответом, model, reasoning, tokens, cost inputs, duration, outcome и собственным SHA.

Модельный manifest этим скриптом намеренно не меняется. Его можно freeze только после успешного завершения всех ролей и отдельной проверки evidence.

Первый `source_search real-30-v1` сохранён как отрицательное историческое evidence: он ошибочно использовал downstream Source Fit rejection как `NO_MATCH`, а затем попал в account usage limit. Его нельзя использовать для model selection. В v2 граница роли исправлена до новых model calls; старые labels не были подогнаны под ответы.
