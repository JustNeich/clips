# Clips local-first

Ежедневный production video flow работает на одной активной машине. Локальный
Next API хранит очередь и артефакты, локальный Clips Worker выполняет heavy jobs.
Render не участвует в preflight, запуске, preview, render, recovery или handoff.

## Аудит прежней зависимости от Render

В прежней схеме worker был локальным, но обязательный control plane оставался на
Render: auth, SQLite queue, worker pairing/claim/heartbeat, runtime bundle и
artifact upload шли через `clips-vy11.onrender.com`; healthcheck и
`dev:prod-api` также подразумевали этот endpoint. Persistent `/var/data` делал
Render владельцем единственной рабочей DB.

Remotion preview/render, admission, serial lanes, ffmpeg/yt-dlp, Next API,
SQLite migrations, MCP и artifact storage технически уже могли работать
локально. Новый active-machine wrapper связывает именно эти существующие части,
а hard-coded remote dev/health defaults и hosted execution убраны из critical
path.

## Границы состояния

| Класс | Где живёт | Что входит |
| --- | --- | --- |
| Runtime | Git | код, `package-lock.json`, `.nvmrc`, DB schema/migrations, worker/runtime contracts, `render.yaml` |
| Локальное | `~/.config/clips` и `.env.local` | machine id/path, worker session, Codex home, API/OAuth encryption keys, cookies |
| Переносимое | `CLIPS_STATE_DIR` | `app.db`, queue/jobs, templates/assets, render exports, job artifacts, publication metadata |
| Пересоздаваемое | cache внутри data/worker home и `/tmp` | source cache, Stage 3 preview cache, decomposed frames, worker downloads/build output |

Portable transfer содержит checksummed state, но может содержать чувствительные
зашифрованные записи из DB. Передавайте его как секретный рабочий материал.
`APP_ENCRYPTION_KEY` и другие plaintext secrets в transfer не входят.

## Один раз на каждой машине

Нужны Node 22, `ffmpeg`, `ffprobe`, `yt-dlp` и чистый checkout. Runtime всегда
собирается из Git:

```bash
cd "/absolute/path/to/clips"
npm ci
npm run build
mkdir -p ~/.config/clips
chmod 700 ~/.config/clips
```

Mac Mini, `~/.config/clips/local-first.env`:

```dotenv
CLIPS_MACHINE_ID=mac-mini
CLIPS_STATE_DIR=/Users/OWNER/ClipsState
CLIPS_OWNER_EMAIL=owner@example.com
```

MacBook использует свой local-only файл:

```dotenv
CLIPS_MACHINE_ID=macbook
CLIPS_STATE_DIR=/Users/OWNER/ClipsState
CLIPS_OWNER_EMAIL=owner@example.com
```

Файл должен иметь mode `600`. `CLIPS_STATE_DIR` — локальный active copy, не
SQLite-файл, одновременно открытый через iCloud/Dropbox/NFS.

## Первый переход на Mac Mini

Остановите старые Clips API/worker. Старый checkout и `.data` команда не меняет:

```bash
cd "/absolute/path/to/clean/clips"
npm run local:first -- init --from-data "/absolute/path/to/old/.data"
npm run local:first:preflight
npm run test:local-first
npm run local:first:start
```

`init` копирует durable state, отбрасывает recreatable cache, переводит
non-running host jobs и workspace defaults в `local`, применяет versioned DB
schema и записывает Git/lockfile runtime identity. Он не создаёт media jobs.

## Обычный active-machine режим

На текущем owner:

```bash
cd "/absolute/path/to/clips"
git pull --ff-only
npm ci
npm run build
npm run local:first -- migrate
npm run local:first:preflight
npm run local:first:start
```

`start` поднимает `127.0.0.1:3000`, автоматически pair-ит machine-local worker и
запускает recovery supervisor. `Ctrl-C` мягко останавливает stack. Local-first
жёстко оставляет один render slot, даже если legacy env просит два.

Если Git SHA или lockfile изменились, preflight остановит запуск до `migrate`.
Если Node не 22, нет build/runtime bundle, SQLite повреждён, workspace всё ещё
host-default или state принадлежит другой машине, процессы не стартуют.

## Recovery после падения

Обычный restart:

```bash
npm run local:first:recover
npm run local:first:preflight
npm run local:first:start
```

После аварийного завершения всего active stack можно явно вернуть незавершённые
leased jobs в очередь:

```bash
npm run local:first -- recover --offline
```

Recovery agent чистит только безопасные cache при `ENOSPC` и requeue’ит
инфраструктурно корректируемые local failures: worker/runtime unavailable,
process restart, timeout, busy и transient local I/O/browser/network failures.
Semantic failures вроде template snapshot drift не повторяются вслепую.
Recovery history хранится в DB; после пяти автоматических циклов нужна
диагностика, а job остаётся recoverable.

## Handoff Mac Mini → MacBook

На Mac Mini остановите `start`; handoff сам фехтует source owner и сохраняет
queued jobs без запуска:

```bash
npm run local:first -- handoff \
  --to macbook \
  --out "/Volumes/Transfer/clips-state-macbook"
```

Команда выводит одноразовый handoff token. Передайте transfer directory штатным
способом (зашифрованный диск, AirDrop или `rsync`) и token отдельно. Source state
после успешного export имеет `handed_off` и больше не запускается.

На MacBook checkout должен содержать записанный в transfer Git SHA:

```bash
cd "/absolute/path/to/clips"
git fetch origin
git checkout "<git-sha-from-transfer>"
npm ci
npm run build
npm run local:first -- accept \
  --from "/absolute/path/to/clips-state-macbook" \
  --token "<handoff-token>"
npm run local:first:preflight
npm run local:first:start
```

`accept` проверяет SHA-256 inventory, target machine, token, state/runtime
contract и ownership epoch. Старый inactive target state сохраняется как backup.
Worker tokens и machine paths из source copy отзываются/очищаются; новый worker
pair-ится локально. Повторный handoff из fenced source отклоняется.

Обратный handoff выполняется симметрично с `--to mac-mini`.

## Что осталось внешним

- Git remote нужен только для получения/передачи кода; уже имеющийся checkout
  продолжает local preview/render/recovery без GitHub.
- Источники по URL, Codex/Anthropic/OpenRouter и YouTube API требуют свои сети и
  credentials только когда соответствующая операция реально выбрана.
- Передача state между физическими машинами требует одного надёжного transfer
  medium. Две вручную расклонированные active copies не образуют consensus;
  поддерживаемый handoff protocol обязателен.
- Publishing не является частью local render recovery и не запускается этими
  командами.

## Render policy

Render допустим только по отдельному решению как публичный UI/API, внешняя
диагностика или explicitly requested always-on service. `render.yaml` отключает
auto-deploy и host Stage 3 execution по умолчанию. Ни credential check, ни deploy,
ни Render health нельзя добавлять в production video preflight или делать
условием создания, проверки, recovery или передачи роликов.
