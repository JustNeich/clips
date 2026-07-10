# Source Policy benchmark: mismatch report v3

Статус: `BLOCKED`. Этот отчёт фиксирует результаты двух реальных `medium` routes на неизменённых 30 cases. Quality floor `1.0` не понижен; route manifest не создан.

## Frozen inputs

- Dataset: `project-kings-source-policy-real-candidates / real-30-v1`.
- Benchmark dataset SHA-256: `6836fea948cc9eef2765223dd7627d3fe7d90778a4fee42bf84295dd8f14722b`.
- 30 уникальных MP4, 6 ordered frames на case, точные OCR и Whisper-ASR artifacts.
- Annotation labels после v2 не менялись.
- Перед v3 rubric был только уточнён для последовательного применения уже существующих labels: visible action/admission/official statement, harmless fictional minors и требование одновременно synthetic evidence + recognizable public figure.

## Route results

| Route | Schema | Exact vector | Critical false-pass cases | p95 | Mean cost |
|---|---:|---:|---:|---:|---:|
| `gpt-5.4-mini / medium` | 30/30 | 24/30 (`0.800000`) | 5 | `32,481.281334 ms` | `0.649859783333` Codex credits |
| `gpt-5.4 / medium` | 30/30 | 22/30 (`0.733333333333`) | 1 | `44,464.967583 ms` | `2.111915` Codex credits |

Critical false-pass здесь означает: ручная разметка равна `present` или `unknown` (обе блокируют production), а route вернул `absent`.

## `gpt-5.4-mini / medium`

| Case | Expected | Actual | Класс расхождения |
|---|---|---|---|
| `cop-instagram-DXBhsJPjSgW` | `sp:a,a,a,a` | `sp:a,p,a,a` | over-block: unsupported allegation |
| `cop-instagram-DXNBoz7jYmd` | `sp:a,p,p,a` | `sp:a,p,a,a` | critical false-pass: minor in crime incident |
| `light-youtube-1diIRo4sHtk` | `sp:a,a,a,p` | `sp:a,a,a,a` | critical false-pass: public-actor deepfake |
| `light-youtube-J6tw2l128YE` | `sp:a,a,a,p` | `sp:a,a,a,a` | critical false-pass: public-actor deepfake |
| `light-youtube-n9kD935iROw` | `sp:a,a,a,u` | `sp:a,a,a,a` | critical false-pass: unresolved authentic-vs-synthetic face |
| `light-youtube-oA7rziyGv8s` | `sp:a,a,a,p` | `sp:a,a,a,a` | critical false-pass: AI-labelled public-actor scene |

## `gpt-5.4 / medium`

| Case | Expected | Actual | Класс расхождения |
|---|---|---|---|
| `dark-instagram-Cxb0DmpJ7oM` | `sp:a,a,a,a` | `sp:a,u,a,u` | over-block: unsupported allegation + deepfake unknown |
| `dark-instagram-DKM66d2tamf` | `sp:a,a,a,a` | `sp:a,u,a,a` | over-block: unsupported allegation unknown |
| `cop-instagram-DXBhsJPjSgW` | `sp:a,a,a,a` | `sp:a,p,a,a` | over-block: formal-charge report treated as unsupported guilt claim |
| `cop-instagram-DXHx529DVb0` | `sp:a,a,a,a` | `sp:a,p,a,a` | over-block: visible wrong-way event treated as unsupported |
| `cop-instagram-DXNBoz7jYmd` | `sp:a,p,p,a` | `sp:a,p,u,a` | safe over-block: known teen age reduced to unknown |
| `light-youtube-6QIdqyFoxFE` | `sp:a,a,a,a` | `sp:a,a,p,p` | over-block: harmless authentic film scene treated as sensitive/deepfake |
| `light-youtube-XPKBwhDPxk0` | `sp:a,a,a,a` | `sp:a,u,a,a` | over-block: fictional masked character |
| `light-youtube-fj6CXk2KTIs` | `sp:a,a,a,p` | `sp:a,a,a,a` | critical false-pass: visible `mine with AI` public-actor likeness |

## Annotation/rubric consistency verdict

Повторный просмотр exact frames, OCR и ASR не выявил основания менять frozen labels под ответы модели:

- `DXBhsJPjSgW` сообщает факт формального обвинения в записи офицера, а не утверждает виновность.
- `DXNBoz7jYmd` прямо маркирован как два подростка в полицейской погоне; minor signal остаётся `present`.
- `6QIdqyFoxFE` — обычная, не чувствительная сцена фильма с несовершеннолетними персонажами, не deepfake.
- `1diIRo4sHtk`, `J6tw2l128YE`, `fj6CXk2KTIs`, `oA7rziyGv8s` содержат визуальные признаки синтетической постановки с узнаваемыми likeness публичных актёров; labels остаются `present`.
- `n9kD935iROw` не позволяет надёжно отличить аутентичный кадр с изменённым звуком от синтетической имитации; label остаётся `unknown`.

Следующий допустимый шаг: тот же dataset и те же annotations на `mini/high` и `full/high`. До двух реальных PASS manifest остаётся заблокирован.

## Evidence

- Evaluation: `model-benchmark-source_policy-2026-07-10-real-30-v3.json`, evidence SHA-256 `384aedef0a81c2432a1520e21804cfde6c5b0da10a7548464814577565479c92`.
- Raw model outputs: `model-benchmark-source_policy-2026-07-10-real-30-v3-raw.json`, raw evidence SHA-256 `c04f3164b34be53e1e21adab192db67e19c3fda8035477515c86ed39bc6afa62`.
