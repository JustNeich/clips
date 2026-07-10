# Vision QA eval: как собрать настоящее доказательство

Статус: **offline builder/finalizer реализован; реальный corpus evidence ещё заблокирован отсутствием 43 campaign-scoped approved bases и не пройден моделью**.

Тесты репозитория используют синтетические байты и детерминированного fake judge. Они доказывают корректность подсчётов, blind-передачи и fail-closed правил, но не являются доказательством качества реальной модели.

## Что считается настоящим корпусом

Финальный blind holdout содержит минимум:

- 120 уникальных финальных render artifacts;
- 40 подтверждённо чистых роликов;
- 80 роликов с реальными или контролируемо внесёнными дефектами;
- хотя бы один критический дефект;
- два независимых blind annotation на каждый ролик;
- отдельную adjudication от третьего человека;
- SHA-256 видео, frame manifest и каждого извлечённого кадра.

Selection pool и final holdout замораживаются отдельно. Между ними запрещено повторять case ID, финальный artifact, frame manifest, исходник или story event. Модель и reasoning выбираются только по selection pool. Final holdout нельзя открывать автору prompt-а или использовать для настройки модели.

## Taxonomy

Критические дефекты:

- wrong channel или template;
- concept mismatch;
- donor UI, CTA, handle, watermark или foreign captions;
- потерянное главное событие;
- небезопасный crop;
- неподтверждённый factual claim.

Некритические дефекты:

- duplicate video/event;
- отсутствующий hook/action/payoff;
- banned word.

Severity задаётся taxonomy framework-а, а не свободным мнением annotator-а.

## Сборка реального корпуса

Точный executable contract, CLI и текущий source blocker описаны в `CORPUS_BUILDER.md`. Builder сам создаёт controlled variants, frame manifests, два blind reviewer packets и закрытый adjudication flow; ручное назначение PASS запрещено.

1. Собрать selection pool из уже проверенных production-like renders.
2. Отдельно получить неиспользованные исходники для final holdout.
3. Сделать чистые renders и defect variants через контролируемые fault injections. Не использовать один и тот же финальный MP4 дважды.
4. Для каждого MP4 выполнить полный decode и извлечь минимум три репрезентативных кадра: начало/hook, главное действие и payoff. Для длинного или сложного ролика кадров должно быть больше.
5. Создать `vision-qa-frame-manifest-v1` с относительными путями, timestamp, frame index и SHA-256.
6. Два annotator-а независимо смотрят ролик без ответов друг друга и выставляют PASS/FAIL + defect codes.
7. Третий adjudicator разрешает расхождения и фиксирует окончательный ground truth.
8. Вызвать `freezeVisionQaEvalPartition` отдельно для selection pool и final holdout. Сохранить оба snapshot через `writeFrozenVisionQaEvalPartition`; существующий файл намеренно не перезаписывается.
9. Выбрать judge route/model/reasoning по selection pool и сохранить hash benchmark evidence.
10. Соединить partitions через `assembleFrozenVisionQaEvalCorpus`. Любое пересечение или недостача случаев блокирует продолжение.
11. Выполнить `runBlindVisionQaLaunchEvaluation` с реальным Vision QA invoker. Framework последовательно, без параллельного смешивания, делает три полных прогона одного frozen holdout.

Минимальный вызов:

```ts
const selectionPool = await freezeVisionQaEvalPartition(selectionInput);
const finalHoldout = await freezeVisionQaEvalPartition(holdoutInput);
const corpus = assembleFrozenVisionQaEvalCorpus({ selectionPool, finalHoldout });

const result = await runBlindVisionQaLaunchEvaluation({
  corpus,
  selectedJudge: {
    routeId,
    model,
    reasoningEffort,
    selectionPoolSha256: selectionPool.partitionSha256,
    selectionBenchmarkEvidenceSha256
  },
  judge: realVisionJudge,
  outputDirectory: evidenceDirectory
});
```

Judge получает только opaque blind token, ожидаемые channel/template/concept identities, exact video artifact и проверенные frames. Ground truth, partition, annotations, adjudication и deterministic verdict в judge input не передаются.

Production `realVisionJudge` должен работать как отдельный adapter/process и получать только этот input. Ему нельзя замыкать в память corpus object, читать frozen annotation-файлы или выводить label из имени каталога. Перед отправкой модели artifact paths следует нормализовать в изолированном временном cwd, как это делает production agent runtime.

## Launch gates

Каждый из трёх последовательных прогонов обязан одновременно показать:

- 100% recall критических дефектов;
- не менее 95% recall всех дефектов;
- не менее 90% precision для чистого PASS;
- 0 critical false-pass.

Если deterministic gate и Vision judge расходятся, итог конкретного ролика всегда FAIL. Framework отдельно считает число таких расхождений.

`launchReady=true` появляется только когда все четыре условия выполнены во всех трёх прогонах. Один успешный прогон, synthetic tests или отсутствие ошибок выполнения не заменяют это доказательство.

## Выходные evidence packets

При заданном `outputDirectory` создаются четыре неизменяемых файла:

- `vision-qa-eval-run-01.json`;
- `vision-qa-eval-run-02.json`;
- `vision-qa-eval-run-03.json`;
- `vision-qa-launch-evidence.json`.

Каждый run хранит hashes frozen holdout и judge invocation, решения по всем случаям, найденные defect codes, пять основных метрик и собственный evidence SHA-256. Файлы создаются эксклюзивно и не перезаписываются.
