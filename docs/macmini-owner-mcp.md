# Persistent Agent Owner MCP Integration

This document is the repo-backed setup guide for giving an approved MacBook or
Mac mini agent persistent owner-level access to Clips Automations without
repeatedly creating short-lived MCP tokens.

## Access Model

- `npm run mcp:flows` remains the read-only observability server.
- `npm run mcp:owner` is the owner-control server for the approved production machine.
- The machine uses a credential from `/api/admin/mcp-machines`, not a 30-90 day UI token.
- A machine credential gets the full supported scope set when `scopes` is omitted. `rotatesAt` is an audit reminder, not an automatic expiry; a credential remains usable until explicitly revoked.
- Raw OAuth/API secrets are never returned through MCP. The agent can read readiness and trigger owner workflows, but it cannot dump stored provider secrets.
- Destructive owner tools require an `intent` string containing the exact entity id, for example a publication id.

## One-Time Machine Enroll

1. Sign in as workspace owner in the Clips production app.
2. Create a machine credential with `machineId: "macmini-agent"` through:
   - `POST /api/admin/mcp-machines`
   - body:

```json
{
  "machineId": "project-kings-macbook-agent",
  "replaceExisting": true,
  "rotatesInDays": 180
}
```

3. Copy the returned `secret` once. It will not be recoverable later.
4. Store it on the selected production machine:

```bash
mkdir -p ~/.config/assistant
chmod 700 ~/.config/assistant
cat > ~/.config/assistant/clips-mcp.env <<'EOF'
CLIPS_APP_URL=https://clips-vy11.onrender.com
CLIPS_MCP_TOKEN=PASTE_MACHINE_SECRET_HERE
EOF
chmod 600 ~/.config/assistant/clips-mcp.env
```

## MCP Servers

Use the same env file for the approved Codex MCP entries. Do not copy this
credential to the other machine unless that machine is separately selected and
enrolled.

```json
{
  "clips-flow": {
    "command": "npm",
    "args": ["run", "mcp:flows"],
    "cwd": "/ABSOLUTE/PATH/TO/clips automations",
    "envFile": "/Users/OWNER/.config/assistant/clips-mcp.env"
  },
  "clips-owner": {
    "command": "npm",
    "args": ["run", "mcp:owner"],
    "cwd": "/ABSOLUTE/PATH/TO/clips automations",
    "envFile": "/Users/OWNER/.config/assistant/clips-mcp.env"
  }
}
```

If a client does not support `envFile`, load the file before launching the MCP server:

```bash
set -a
. ~/.config/assistant/clips-mcp.env
set +a
npm run mcp:owner
```

## Healthcheck

Run on the selected production machine after enrollment:

```bash
cd "/Users/neichyabazhi/Documents/Macedonian Imperium/clips automations"
npm run macmini:healthcheck
```

The healthcheck verifies local tools, GitHub access, production health, and owner MCP status if `CLIPS_MCP_TOKEN` is present. It prints only token presence/status, never the token itself.

## Owner Tools

Core tools exposed by `clips-owner`:

- `clips_owner_status`
- `clips_owner_get_integrations_readiness`
- `clips_owner_list_channels`
- `clips_owner_get_channel`
- `clips_owner_create_channel`
- `clips_owner_update_channel`
- `clips_owner_inspect_channel_asset`
- `clips_owner_upload_channel_asset`
- `clips_owner_update_channel_publish_settings`
- `clips_owner_delete_channel`
- `clips_owner_list_templates`
- `clips_owner_create_template`
- `clips_owner_get_template`
- `clips_owner_update_template`
- `clips_owner_list_members`
- `clips_owner_list_channel_access`
- `clips_owner_set_channel_access`
- `clips_owner_revoke_channel_access`
- `clips_owner_list_publications`
- `clips_owner_get_flow`
- `clips_owner_update_publication`
- `clips_owner_schedule_publication`
- `clips_owner_cancel_publication`
- `clips_owner_list_stage3_workers`
- `clips_owner_pair_stage3_worker`
- `clips_owner_run_copscopes_daily_pool`
- `clips_owner_run_video_pipeline`
- `clips_owner_render_video`
- `clips_owner_render_preview`
- `clips_owner_preflight_completed_source`
- `clips_owner_download_stage3_artifact`
- `clips_owner_list_render_exports`
- `clips_owner_run_agent_pipeline`
- `clips_flow_get_source_decomposition`

`clips_owner_update_channel` covers the active Stage 2 setup fields, managed
template selection, asset selection, and default clip duration.
`clips_owner_update_channel_publish_settings` covers timezone, slot grid,
auto-queue, upload lead, and subscriber notification defaults. Destructive
tools keep their exact-id intent checks even when the machine credential has all
scopes.

When a source URL can resolve to changing platform media, bind Stage 3 to the
already-completed Stage 1 artifact:

1. Call `clips_owner_preflight_completed_source` with `channelId`, `chatId`, and
   `completedSource` containing `jobId`, `expectedCacheKey`,
   `expectedDurationSec`, `expectedWidth`, `expectedHeight`, and optional
   `expectedSizeBytes`.
2. The read-only preflight checks workspace/channel/chat ownership and the
   current host bytes, then returns an immutable SHA-256 binding. It creates no
   Stage 3 job.
3. Pass the same `completedSource` object to `clips_owner_render_preview` or
   `clips_owner_render_video`. The server embeds the verified binding in the
   worker job. A bound worker request rejects missing or mismatched bytes and
   never falls back to downloading the URL.

Calls that omit `completedSource` retain the existing URL acquisition behavior.

Use `clips_owner_inspect_channel_asset` with an exact `channelId` and `assetId`
to verify an existing asset without downloading or changing it. The read-only
result includes the stored byte count, database-size match, SHA-256, detected
file signature, declared-MIME match, supported image dimensions, and whether
the asset is the channel's active avatar/background/music reference. A missing
stored file returns HTTP 410 `channel_asset_file_unavailable`.

`clips_owner_render_preview` creates a media-only MP4 for checking the selected
source window, crop/fit, segments, and audio. It does not render the full
template. Check the full template in the final render. After either preview or
final render completes, call `clips_owner_download_stage3_artifact` with its
`jobId`; the MCP process saves the artifact under the operating system's
temporary `clips-owner-artifacts` directory and returns the local path, byte
size, SHA-256 hash, and MIME type. The caller cannot choose an arbitrary output
directory. The endpoint resolves the exact requested job even when a newer job
exists in the same flow. If retention has already removed bytes for an otherwise
completed job, it returns HTTP 410 with `immutable_artifact_unavailable` instead
of reporting that the job is unfinished.

Before every worker claim, the selected machine reports CPU/load, free memory,
active render processes, and active worker jobs. Missing telemetry, high load,
low memory, or another active render defers the claim. Long-render Remotion
concurrency is chosen from the current CPU/load/memory snapshot instead of a
fixed worker setting.

## Git and Render Deploy Access

Git changes use the normal repository SSH remote and an authenticated `gh`
session. Keep production deploy authentication separate from the Clips machine
credential.

For non-interactive Render deploys, use a non-expiring Render API key stored
outside the repository:

```bash
mkdir -p ~/.config/assistant
chmod 700 ~/.config/assistant
cat > ~/.config/assistant/render.env <<'EOF'
RENDER_API_KEY=PASTE_RENDER_API_KEY_HERE
RENDER_SERVICE_ID=PASTE_CLIPS_SERVICE_ID_HERE
EOF
chmod 600 ~/.config/assistant/render.env
```

The API key is created in Render Account Settings. `render login` is useful for
interactive work, but its CLI token can expire and is not the unattended deploy
credential.

Deploy one reviewed Git commit and wait for the result:

```bash
set -a
. ~/.config/assistant/render.env
set +a
git push origin HEAD
DEPLOY_SHA="$(git rev-parse HEAD)"
render deploys create "$RENDER_SERVICE_ID" --commit "$DEPLOY_SHA" --wait --confirm --output json
```

Verify `/api/health`, then verify the required owner MCP tools. Roll back by
deploying the exact last known-good commit with the same command. Do not use a
working-tree directory as the deploy artifact and do not deploy an unpushed
commit.

For current end-to-end production videos, prefer `clips_owner_run_copscopes_daily_pool` or `clips_owner_run_video_pipeline` without `sourceUrl`; that uses the existing daily-pool runner. With `sourceUrl`, `clips_owner_run_video_pipeline` creates/opens the chat and queues Stage 2, then a selected Stage 2 option still has to be rendered through Stage 3.
