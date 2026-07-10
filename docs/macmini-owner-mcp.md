# Mac mini Owner MCP Integration

This document is the repo-backed setup guide for giving the Mac mini Assistant agent persistent owner-level access to Clips Automations without repeatedly creating short-lived MCP tokens.

## Access Model

- `npm run mcp:flows` remains the read-only observability server.
- `npm run mcp:owner` is the owner-control server for the Mac mini agent.
- The Mac mini uses a machine credential from `/api/admin/mcp-machines`, not a 30-90 day UI token.
- Raw OAuth/API secrets are never returned through MCP. The agent can read readiness and trigger owner workflows, but it cannot dump stored provider secrets.
- Destructive owner tools require an `intent` string containing the exact entity id, for example a publication id.

## One-Time Owner Enroll

1. Sign in as workspace owner in the Clips production app.
2. Create a machine credential with `machineId: "macmini-agent"` through:
   - `POST /api/admin/mcp-machines`
   - body:

```json
{
  "machineId": "macmini-agent",
  "replaceExisting": true,
  "rotatesInDays": 180
}
```

3. Copy the returned `secret` once. It will not be recoverable later.
4. Store it on the Mac mini:

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

Use the same env file for Codex and Claude MCP entries.

```json
{
  "clips-flow": {
    "command": "npm",
    "args": ["run", "mcp:flows"],
    "cwd": "/Users/neichyabazhi/Documents/Macedonian Imperium/clips automations",
    "envFile": "/Users/neichyabazhi/.config/assistant/clips-mcp.env"
  },
  "clips-owner": {
    "command": "npm",
    "args": ["run", "mcp:owner"],
    "cwd": "/Users/neichyabazhi/Documents/Macedonian Imperium/clips automations",
    "envFile": "/Users/neichyabazhi/.config/assistant/clips-mcp.env"
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

Run on the Mac mini after login:

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
- `clips_owner_delete_channel`
- `clips_owner_list_templates`
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
- `clips_owner_tick_portfolio_daemon`
- `clips_owner_release_portfolio_daemon`

For current end-to-end production videos, prefer `clips_owner_run_copscopes_daily_pool` or `clips_owner_run_video_pipeline` without `sourceUrl`; that uses the existing daily-pool runner. With `sourceUrl`, `clips_owner_run_video_pipeline` creates/opens the chat and queues Stage 2, then a selected Stage 2 option still has to be rendered through Stage 3.
