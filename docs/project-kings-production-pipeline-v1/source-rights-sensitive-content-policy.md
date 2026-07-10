# Project Kings: права на исходник и чувствительный контент

Статус: типизированный gate подключён к source-readiness, local import, production upload и sync boundaries. Реальные approval, provenance и assessments этим изменением не создавались. Это внутренняя операционная политика, а не юридическое заключение или гарантия наличия прав.

## Разделение ответственности

`Concept Fit` отвечает: «соответствует ли ролик обещанию канала?»

Этот gate отдельно проверяет:

1. Утвердил ли owner точную версию политики и точный список разрешённых source routes/donors.
2. Подтверждает ли provenance конкретного кандидата, что он получен через один из этих маршрутов.
3. Привязана ли независимая sensitive-content assessment к точным байтам видео.
4. Не обнаружен ли запрещённый или неизвестный риск.

Ни один положительный Concept Fit не может обойти этот gate. PASS этого gate также не означает, что Concept Fit пройден.

## Один owner approval вместо ручного решения по каждому ролику

Owner один раз утверждает `ProjectKingsSourcePolicyApproval` через аутентифицированный control plane. Approval содержит:

- точные policy version и policy SHA-256;
- полный snapshot разрешённых source routes и donors с отдельным SHA-256;
- owner principal, время и evidence события авторизации;
- собственный проверяемый `approvalSha256`.

Approval намеренно не содержит `candidateId`, URL или media hash. Поэтому одно утверждение применяется к любому числу кандидатов, пока их provenance соответствует утверждённым маршрутам, а version/hash политики не изменились. Ежедневный run не спрашивает owner о каждом новом исходнике.

Hash подтверждает целостность артефакта, но сам по себе не устанавливает личность владельца. `ownerAuthorizationEvidenceSha256` должен приходить из аутентифицированного owner control plane.

## Неизменяемая политика

- Version: `project-kings-source-rights-sensitive-policy-v2`.
- Policy SHA-256: `b6664c4364c4a3b172a1f1d653e3d100604e98f5ef1b33857324691fa894eb39`.
- Source-designations SHA-256: `a6452b6d6bd2e4721560df7238b47a3096c08ba978a4e1c614912612d547e4b4`.
- Код: `lib/project-kings/source-rights-sensitive-policy.ts`.
- Approval builder: `createProjectKingsSourcePolicyApproval(...)`.
- Deterministic evaluator: `evaluateProjectKingsSourcePolicy(...)`.

Изменение маршрута, donor, запрещённого класса или другого правила требует новой policy version, новых frozen hashes и нового owner approval. Несовпадение literal hashes и содержимого политики останавливает загрузку модуля.

## Утверждённые маршруты

Для Instagram разрешены:

- Dark Joy Boy: `kodyantle`, `spidermonkeywinston`, `myrtlebeachsafari`, `realdiddykong`;
- THE LIGHT KINGDOM: `learnaifaster`;
- COP SCOPES: `copscopes`.

YouTube Ask v3 разрешён только для THE LIGHT KINGDOM.

Расширение этого списка runtime-параметром невозможно. Donor или route вне frozen policy получает `policy_blocked`.

## Автоматический verdict для каждого кандидата

После decode система без участия owner формирует короткий typed packet:

- `candidateId`, профиль и canonical URL;
- `contentSha256` точных декодированных байтов;
- hash-bound provenance: provider, route, donor, upstream discovery evidence и rights-evidence status;
- независимую sensitive-content assessment по тем же байтам;
- ссылку на один действующий `ProjectKingsSourcePolicyApproval`.

Детерминированная функция создаёт отдельный `ProjectKingsSourcePolicyVerdict`. Он связывает:

- policy version/hash и `approvalSha256`;
- provenance evidence hash;
- точный `contentSha256`;
- sensitive assessment hash;
- общий `inputBindingSha256`;
- disposition, причины и итоговый `verdictSha256`.

Изменение байтов, provenance, route, assessment, policy или approval не позволяет повторно использовать старый PASS.

### Как создаётся независимая sensitive-content assessment

Для этого существует отдельная semantic role `source_policy` и runner `runProjectKingsSourcePolicyAssessment(...)`.

Runner читает точные замороженные bytes исходника, проверяет `contentSha256`, извлекает 3–12 кадров в хронологическом порядке и собирает короткий typed packet. Packet содержит точные `candidateId`, URL, profile, policy version/hash, четыре запрещённых класса, ordered key frames, OCR, ASR и source metadata. Модель обязана вернуть четыре независимых значения `absent | present | unknown`, точные `candidateId/contentSha256`, использованные artifact IDs и краткую причину. `present` и `unknown` нельзя скрыть или преобразовать в `absent`.

Runner вызывает только benchmark-selected vision route, записывает hash успешной попытки как upstream evidence и создаёт `ProjectKingsSensitiveContentAssessment`. Он намеренно не создаёт owner approval, policy verdict или qualification и не переводит source в готовое состояние.

Production-маршрут для этой роли остаётся закрыт до реального benchmark минимум на 30 размеченных кандидатах. Пустой dataset в `scripts/run-project-kings-model-benchmarks.ts` — только fail-closed scaffold: он останавливается до вызова модели и не создаёт фиктивное evidence. Старые route manifests schema v1 можно читать как историческое evidence, но production loader принимает только schema v2 со свежим `source_policy` selection и benchmark hash.

## Qualification и import boundary

Production qualification использует только `project-kings-source-qualification-v2`. Evidence v2 содержит:

- полный действующий `ProjectKingsSourcePolicyApproval` и его hash;
- полное designation/provenance evidence и его hash;
- независимую sensitive assessment и её hash;
- автоматически пересчитываемый PASS `policy_verdict`;
- policy version/hash, точные media bytes и Source Fit PASS.

Verifier заново запускает deterministic policy evaluator и сравнивает весь verdict. Одного сохранённого слова `pass` или набора несвязанных hashes недостаточно.

Local importer, production upload route, source-buffer sync и runtime count отклоняют legacy qualification. Stored candidate учитывается как готовый только с imported-evidence v2 и approval, который всё ещё активен в его workspace.

Исторические readiness-файлы, включая `source-buffer-readiness-2026-07-10-v13.json`, остаются доказательством прошлой работы, но больше не являются production-ready: внутри них qualification v1 без policy verdict.

## Fail-closed правила

- отсутствует или повреждён policy approval -> `policy_blocked`;
- policy/hash/routes в approval отличаются от frozen policy -> `policy_blocked`;
- rights evidence неизвестен или отклонён -> `policy_blocked`;
- donor/route не утверждён -> `policy_blocked`;
- provenance не связан с точным candidate/URL -> `policy_blocked`;
- assessment отсутствует, повреждена или относится к другим байтам -> `policy_blocked`;
- хотя бы один sensitive-сигнал равен `unknown` -> `policy_blocked`.

Старая catalog-метка `owner_approved_source_pool` сама по себе не является policy approval или достаточным provenance evidence.

Старый per-candidate attestation v1 распознаётся как недействительный артефакт и безопасно получает `policy_blocked`; он не может заменить новый глобальный approval. Это намеренный fail-closed разрыв совместимости: принятие старого ручного решения вернуло бы ежедневную зависимость от owner.

## Dynamic discovery

Новый результат поиска всегда остаётся `discovery_only`, даже при действующем policy approval. Он не получает PASS, пока контролируемый процесс не зафиксирует точные bytes, provenance, rights evidence и независимую assessment. Для этого не требуется новое решение owner: используется уже утверждённая policy.

В autonomous refiller эта граница реализована буквально: discovery packet сначала записывается в durable ledger, затем источник скачивается, полностью декодируется и получает OCR/ASR и hash точных bytes. Только после этого кандидат становится замороженным входом qualification и может получить автоматический policy verdict. Слово `frozen_catalog` в qualification означает этот зафиксированный exact-candidate packet, а не старый общий JSON-каталог v13.

## Запрещённые классы

Gate блокирует:

- `graphic_violence` — графическое изображение тяжёлой травмы, расчленения, крови или смерти;
- `unsupported_allegation` — неподтверждённое обвинение человека или организации в преступлении, насилии либо серьёзном проступке;
- `minor_in_sensitive_incident` — несовершеннолетний в чувствительном происшествии, включая насилие, преступление, эксплуатацию или тяжёлую чрезвычайную ситуацию;
- `realistic_political_or_public_figure_deepfake` — реалистичную синтетическую имитацию политика или другой публичной фигуры.

## Выход

- `pass` — только policy gate пройден, исходник можно передать в отдельный Source Fit;
- `policy_blocked` — item не продолжает работу, причины записаны точными issue codes;
- `discovery_only` — это результат поиска, а не производственный исходник.

`legalGuarantee` всегда равен `false`. Ни approval, ни автоматический PASS не являются юридической гарантией.

## Проверка

`tests/project-kings-source-rights-sensitive-policy.test.ts` проверяет:

- frozen version/hash и целостность approval;
- использование одного approval для нескольких exact candidates;
- invalidation при drift approval hash, policy version и approved routes;
- привязку verdict к media bytes, provenance и assessment;
- unknown/rejected rights и donor вне policy;
- сохранение `discovery_only`;
- четыре запрещённых класса и unknown assessment;
- frozen-catalog пример с реалистичной AI-имитацией Trump;
- воспроизводимость hash итогового `policy_verdict`.

`tests/project-kings-source-policy-agent.test.ts` отдельно проверяет строгую schema, packet binding, ordered frames/OCR/ASR, сохранение `present/unknown`, hash drift и отсутствие несанкционированного approval/qualification. Benchmark и manifest guards проверяются в `tests/project-kings-model-benchmark.test.ts` и `tests/project-kings-production-model-route-manifest.test.ts`.
