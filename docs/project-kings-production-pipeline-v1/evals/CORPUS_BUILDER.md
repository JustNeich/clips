# Vision QA corpus: offline build contract

Скрипт `scripts/build-project-kings-vision-qa-corpus.mts` теперь покрывает весь offline-контур: inventory → campaign-scoped audit → preparation → две независимые проверки → adjudication → frozen selection/holdout.

Это не даёт права считать старые MP4 чистыми. Полный decode доказывает только техническую читаемость файла. Clean base появляется только из `final_approved` production item с точными hash bindings и двумя сохранёнными PASS: deterministic + independent Vision QA.

## 1. Неквалифицирующий inventory

```bash
npm run project-kings:qa:corpus -- --inventory-preflight
```

Команда считает raw MP4, уникальные SHA-256, делает полный decode и проверяет наличие durable production-таблиц. Она всегда возвращает `qualificationAllowed=false`: без campaign manifest ни один файл не становится clean base.

Текущий локальный снимок от 10 июля 2026 года:

- raw MP4: 56;
- unique MP4 SHA-256: 56;
- full decode: 56/56;
- строк `render_exports` в старой базе: 101;
- campaign-scoped eligible bases: 0/43;
- причина: в этой базе ещё нет новых таблиц Project Kings и нет run-scoped campaign provenance.

Локальное evidence: `.data/project-kings/vision-qa-corpus-v2/inventory-preflight.json`, последний проверенный SHA-256 payload `65b03adb354b4d90bd50b3b966a1824ddcbf36b2ad26753c63824ce3dbbe6510`.

## 2. Campaign-scoped source audit

```bash
npm run project-kings:qa:corpus -- \
  --audit-only \
  --campaign-manifest /absolute/path/campaign.json
```

Campaign manifest обязан перечислить точные `runId + productionManifestSha256`. Аудит проверяет только эти runs и требует:

- ровно один завершённый render export для item;
- `final_approved` state;
- exact MP4 SHA-256 и размер из базы;
- полный decode;
- layout-aware crop;
- exact deterministic final PASS;
- exact independent Vision final PASS;
- hash-bound quality evidence и agent attempt;
- exact production profile/concept provenance.

До 43 уникальных eligible bases build останавливается. При блокировке не создаются partitions, defect variants, blind packets или labels.

## 3. Preparation plan

Машиночитаемый descriptor точного контракта:

```bash
npm run project-kings:qa:corpus -- --print-preparation-contract
```

После source gate нужен отдельный immutable `project-kings-vision-qa-preparation-plan-v1`. Он содержит:

- exact campaign manifest SHA-256 и source-audit evidence SHA-256;
- dataset ID/version, время, rubric version;
- ровно 3 отсортированных production item ID для selection;
- ровно 40 других production item ID для final holdout;
- ровно 43 context seeds;
- две разные reviewer identities;
- третью независимую adjudicator identity;
- собственный `planSha256`.

Каждый context seed содержит:

- production item ID;
- repo-relative source MP4 path + exact source SHA-256;
- полный `ConceptContract`;
- template SHA-256, layout, frame, media viewport и разрешённый текст;
- normalized source crop;
- story event, hook, action, payoff;
- factual evidence с hashes;
- duplicate ledger и banned words;
- `contextSeedSha256`.

Значения сверяются с source audit. Между 43 базами запрещены повторные source SHA или story event. Это заранее исключает leakage между selection и holdout.

Запуск:

```bash
npm run project-kings:qa:corpus -- \
  --campaign-manifest /absolute/path/campaign.json \
  --preparation-plan /absolute/path/preparation-plan.json
```

## 4. Что создаёт preparation

Selection строится из 3 clean bases и 6 controlled variants. Final holdout строится из 40 clean bases и 80 controlled variants — ровно два variants на base.

В visual corpus входят только дефекты из Vision taxonomy:

- wrong template;
- donor UI;
- CTA;
- handle;
- watermark;
- foreign captions;
- banned word;
- unsafe crop;
- main event lost.

`corrupt_mux`, `flash_frame`, `wrong_resolution` и `lost_audio` остаются в deterministic final-artifact tests. Их нельзя превращать в искусственные Vision labels: corrupt MP4 не даёт честных кадров, а остальные признаки не входят в frozen Vision taxonomy.

Preparation:

- создаёт не менее 120 уникальных final artifact hashes (фактически 129 с selection);
- копирует approved bases и source assets в immutable campaign directory;
- делает frame manifest и SHA-256 каждого кадра;
- сохраняет fault recipe/probe отдельно от blind surface;
- создаёт `blind-cases.json` без labels;
- создаёт отдельные sealed truth seeds из explicit approval или controlled recipe;
- выпускает два независимых reviewer packets;
- выпускает закрытый adjudication assignment со state `awaiting_two_independent_annotations`;
- не создаёт ни одной annotation, adjudication или PASS самостоятельно.

Повторная запись в тот же campaign directory запрещена.

## 5. Adjudication и freeze

Reviewer response использует version `project-kings-vision-qa-review-response-v1` и exact keys:

- campaign manifest hash;
- reviewer packet hash и reviewer ID;
- completedAt;
- для каждого назначенного blind token: request hash, PASS/FAIL, defects и invocation-evidence hash;
- response hash.

PASS допустим только с пустым defects. FAIL допустим только хотя бы с одним defect из frozen taxonomy и с правильной severity.

После двух полных reviewer responses открывается packet для третьего adjudicator-а:

```bash
npm run project-kings:qa:corpus -- --open-adjudication \
  --annotation-campaign-manifest ... \
  --adjudication-assignment ... \
  --reviewer-packet-a ... --reviewer-packet-b ... \
  --review-response-a ... --review-response-b ... \
  --adjudication-output ...
```

Adjudicator видит обе проверки, но не видит sealed truth, recipe или fault name из пути.

Adjudication response использует version `project-kings-vision-qa-adjudication-response-v1`: exact input-packet hash, adjudicator ID, completedAt, решение/defects/resolution/invocation evidence по каждому blind token и общий response hash.

`--finalize` принимает prepared manifest, два packets/responses и adjudication input/response. Freeze разрешён только если:

- обе проверки покрывают все cases и принадлежат назначенным независимым identities;
- adjudication выполнена третьей identity после проверок;
- approved clean base подтверждена PASS без defects;
- controlled variant подтверждён FAIL с ожидаемым injected defect;
- все видео, source assets, frames и manifests по-прежнему совпадают по SHA-256;
- selection/holdout не пересекаются по case, artifact, frame manifest, source или story event;
- final holdout содержит ровно 40 clean + 80 defective cases.

Если reviewer/adjudicator находит дефект в approved clean base, система требует заменить base. Она не переписывает ответ в PASS. Если controlled injection не подтверждён, variant тоже заменяется и ground truth не замораживается.

Финальные `selection-pool.json`, `final-holdout.json` и corpus manifest записываются эксклюзивно. Launch thresholds в `vision-qa-eval.ts` не менялись.
