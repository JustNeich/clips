# Zoro semantic-only worker contour

Status: implementation and local verification only. No launchd service was installed and no production flag was enabled by this change.

## Boundary

The normal Stage 3 worker remains the single render lane. It does not receive a semantic executor and therefore does not advertise or claim `production-semantic`.

Project Kings uses a separate bundle, `project-kings-semantic-worker.cjs`. It advertises exactly one supported kind: `production-semantic`. One launchd supervisor owns three isolated job lanes, providing at most three local model calls in parallel; the server-side transactional claim limit remains authoritative. A dedicated semantic worker pairing/config keeps its restart lease identity separate from the render worker.

## Exact job flow

1. The process reads the existing Stage 3 worker session from a regular `0600` config file. The token is used only in authenticated HTTP headers and is never copied into a job, result, plist or log message.
2. Preflight requires explicit enablement, an absolute local `CODEX_HOME`, an explicit executable regular-file `CODEX_BIN` reporting Codex CLI `0.144.1` or newer, a successful `codex login status`, and a production-ready frozen route manifest. The semantic worker never falls back to the system `codex` binary.
3. The process claims only `production-semantic`.
4. For every artifact reference it calls `GET /api/stage3/worker/jobs/{jobId}/inputs/{inputId}` under the exact active lease.
5. It rejects redirects, unexpected status, missing/drifted headers, excess bytes, wrong size or wrong SHA-256 before a model call.
6. Verified bytes are materialized in a private temporary directory and converted into the normal typed production-agent packet.
7. `runProductionSemanticAgent` invokes the local Codex CLI. Lease loss aborts the same process signal.
8. The result is validated against the exact payload and written atomically to a local result spool before completion is sent.
9. If completion HTTP is uncertain, the process exits and retains the spool. After lease recovery/restart, the exact result is reused without a second model call.

## Build

The semantic bundle binds itself to the current frozen Stage 3 worker app version:

```bash
npm run build:project-kings-semantic-worker
```

Outputs are local-only under `.project-kings-semantic-worker-runtime/` and are ignored by git.

## Dry-run, install and rollback

The semantic supervisor uses its own Stage 3 worker identity rather than the render worker config. One time, issue a short-lived pairing token and create the private `0600` config:

```bash
PROJECT_KINGS_SEMANTIC_PAIRING_TOKEN='short-lived-token' \
CLIPS_APP_URL='https://clips.example' \
npm run project-kings:semantic-worker:pair
```

The command prints the worker id and config path, never the pairing/session token.

Dry-run performs all artifact, permission, hash, route-manifest, pinned-Codex version and three-lane supervisor plist checks without writing launchd state. `--codex-bin` is mandatory unless the same explicit path is supplied through `CODEX_BIN`; no PATH/Homebrew fallback is used:

```bash
npm run project-kings:semantic-worker:plan -- --codex-bin /absolute/path/to/codex-0.144.1
```

Install and rollback are explicit operations:

```bash
npm run project-kings:semantic-worker:install -- --codex-bin /absolute/path/to/codex-0.144.1
npm run project-kings:semantic-worker:rollback
```

The installer uses versioned directories and an atomic `current` symlink. The validated absolute `CODEX_BIN` is copied into the preflight environment and launchd plist, while credentials remain absent. Rollback switches the symlink to the recorded previous version and restarts the semantic supervisor. Neither operation puts a session token into launchd.

The real dry-run must remain blocked while the selected model-route manifest is legacy/read-only or lacks a real `source_policy` benchmark. This is a release gate, not an installer error to bypass.
