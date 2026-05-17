# Copscopes Channel Preset

This document records the channel-specific Stage 2 / Stage 3 setup for the existing
`@copscopes` channel.

## Scope

- Target channel username: `copscopes`
- Source profile inspected: `https://www.instagram.com/copscopes`
- Reference window: `2026-04-22` through `2026-05-13`
- Reference sources:
  - `https://www.youtube.com/@HistorryExposed`
  - `https://www.youtube.com/@Military_Era`
  - `https://www.youtube.com/@PaleWitness-1`

The preset lives in [`lib/copscopes-channel-preset.ts`](../lib/copscopes-channel-preset.ts).
It contains:

- 60 compact Stage 2 examples: 20 per reference channel.
- A Copscopes-specific `storyOneShot` prompt.
- A Copscopes-specific caption highlighting prompt.
- A `Channel + Story` managed template snapshot with white body text and yellow keyword highlights.
- A patch builder that sets `stage2ExamplesConfig`, `stage2PromptConfig`, `stage2HardConstraints`,
  `stage2SourceOverlayConfig`, `templateId`, and default clip duration.
- For an already-designed production channel, apply with template preservation so the existing
  channel template is kept and only the Stage 2 preset, constraints, source overlay policy, and
  6-second duration are updated.

## Applying

Run a dry-run first:

```bash
npm exec tsx scripts/apply-copscopes-channel-preset.ts -- --username copscopes --dry-run
```

Apply to the active `APP_DATA_DIR` database:

```bash
npm exec tsx scripts/apply-copscopes-channel-preset.ts -- --username copscopes
```

Apply while preserving the current production template assignment:

```bash
npm exec tsx scripts/apply-copscopes-channel-preset.ts -- --username copscopes --preserve-template
```

The script refuses to create a missing channel. It expects the channel to already exist, because
production Copscopes already exists and accidental duplicate channels are worse than a visible stop.

## MCP Production Control

Read-only flow observability stays on `npm run mcp:flows` and continues to require only `flow:read`.
CopScopes mutations use a separate MCP server:

```bash
CLIPS_MCP_TOKEN=<control-write-token> npm run mcp:control
```

The token must include `control:write`; old `flow:read` tokens cannot call control tools.
In production, create this from Owner Observability -> MCP access by choosing `Control write`.
For a local MCP client pointed at production, pass the app URL as well:

```bash
CLIPS_APP_URL=https://clips-vy11.onrender.com CLIPS_MCP_TOKEN=<control-write-token> npm run mcp:control
```

Available control tools:

- `clips_control_apply_channel_preset` (`preserveTemplate: true` keeps the channel's current template)
- `clips_control_import_source_pool`
- `clips_control_list_source_pool`
- `clips_control_set_active_category`
- `clips_control_get_channel_status` (publishing grid, YouTube readiness, recent publications, categories, and pool sample)
- `clips_control_set_publish_schedule` (repairs the CopScopes grid to the approved daily publication slots)
- `clips_control_reset_source_pool_item` (operator retry path for failed or reviewed source Reels)
- `clips_control_cancel_publication` (removes an unsafe CopScopes publication, including remote YouTube deletion when applicable; pass `allowPublished: true` only for explicit owner cleanup of an already-published bad render)
- `clips_control_run_daily_pool`

The approved CopScopes publishing grid is `Europe/Moscow`, three daily slots, first slot `21:15`,
15-minute interval, with auto-queue enabled. The deterministic production wrapper checks and, unless
`--no-repair-schedule` is passed, repairs that grid before running the live source pool:

```bash
npm run copscopes:daily-production -- --limit 3 --attempt-budget 8
```

Use `--dry-run` to run health, channel-status, schedule and source-pool checks without queueing new
Stage 3 render jobs.

Live production runs use `clips_control_run_daily_pool` in async mode and then poll
`clips_control_get_channel_status` by `runId`. This keeps the MCP/control request short while the
slow ingest, Stage 2, Stage 3 editor loop, render queue, and quality gate continue in the app
process.

If production has not yet deployed the newer status/schedule control tools, the wrapper enters
`legacy-control` compatibility mode: it still runs health, source-pool dry-run selection, and the
live `clips_control_run_daily_pool` action, then polls the selected source statuses if the legacy
long HTTP request disconnects. It reports publishing-grid verification as unavailable. This keeps
the daily automation from silently stopping just because the stricter preflight endpoint is
temporarily behind the pushed code.

Source pool records are stored in `copscopes_source_categories`, `copscopes_source_reels`,
`copscopes_daily_runs`, and `copscopes_daily_run_items`. The pool keeps canonical Instagram Reel
URLs, shortcodes, category, secondary tags, quality score, source crop metadata, and lifecycle
status: `available`, `in_progress`, `consumed`, `needs_review`, `skipped`, or `failed`.

Daily pool runs select from the active category with a default limit of 3 finished videos and a
small attempt budget. The runner only marks a Reel `consumed` after the Stage 3 review gate confirms
the crop, exact 6-second duration, no CopScopes meta-layer leakage, and a publication-queue-safe
render outcome.

CopScopes source crops use `copscopes-readable-source-window-v5`: a readable inner source-footage
window with safe focus, mirror disabled, and only light zoom. Older `v2`/`v3`/`v4` crops are
intentionally upgraded because they either exposed CopScopes meta text or made the source window so
tight that the incident could become unreadable.

Daily source selection also performs story-level dedupe. A Reel can be skipped even with a unique
Instagram shortcode when its title/caption describe the same incident as an already selected,
queued, reviewed, or consumed CopScopes source. This blocks cases where Instagram exposes multiple
Reels for the same pursuit/rescue/crash with nearly identical metadata.

## Source Reels Found

The public Instagram profile exposed these direct Reel URLs without a logged-in in-app browser session:

- `https://www.instagram.com/copscopes/reel/DYRVHZIN0ta/`
- `https://www.instagram.com/copscopes/reel/DYRHmpAMS_o/`
- `https://www.instagram.com/copscopes/reel/DYRHZNrseVo/`
- `https://www.instagram.com/copscopes/reel/DYNJ6WiNZaK/`
- `https://www.instagram.com/copscopes/reel/DYNItcINWax/`
- `https://www.instagram.com/copscopes/reel/DYNIDDqNMRZ/`
- `https://www.instagram.com/copscopes/reel/DYMFo6ptlkr/`
- `https://www.instagram.com/copscopes/reel/DYMEE7ZtpGN/`
- `https://www.instagram.com/copscopes/reel/DYMD40CNM1a/`
- `https://www.instagram.com/copscopes/reel/DYMDoh8tHtA/`
- `https://www.instagram.com/copscopes/reel/DYKFYtTNZsW/`
- `https://www.instagram.com/copscopes/reel/DXZVe2qDItJ/`

Useful test source:

- `DYRVHZIN0ta`: Farmington street-racing pursuit, flipped burning car, passenger rescue.

Weak source examples:

- Several Copscopes posts expose generic cruiser-fiction or engagement captions through Instagram
  metadata. The prompt explicitly tells Stage 2 to ignore those unless source video truth supports
  them.
- `DYKFYtTNZsW` is product/ad-like and should not be used as a style anchor.

## Reference Selection

Selection rule:

1. Pull accessible Shorts metadata in the three-week window.
2. Sort by views.
3. Keep 20 per channel.
4. For Military Era, exclude older top/bottom military-tech/comedy entries. Excluded ids:
   `7CaqtjLXP1A`, `dO_Z8ytSsz4`, `v9N4dcgCkuM`.

## Prompt Iterations

The final prompt was shaped by five critique passes against the Copscopes source shape.

1. Baseline reference blend:
   The first prompt over-inherited PaleWitness and Military Era mystery language. Risk: Copscopes
   bodycam outputs could sound supernatural or invented.

2. Source hygiene pass:
   Added hard rules to ignore Instagram follow text, hashtags, ad copy, and repeated cruiser fiction.
   This matters because several Reel pages expose generic metadata unrelated to the real incident.

3. Police/bodycam truth pass:
   Added neutral labels and banned unsupported charges, motives, convictions, injuries, and outcomes.
   This keeps real incidents tense without making legal claims the source does not prove.

4. Format pass:
   Forced `story_lead_main_caption`, short all-caps leads, and compact body sequence:
   setup -> visible action -> consequence or unanswered tension.

5. Highlight/template pass:
   Moved PaleWitness style into the template and highlight prompt: body text stays white, only
   specific nouns/times/actions receive yellow. Top highlights are disabled so the lead remains a
   stable format cue.

## Final Test Copy

For the Farmington burning-car Reel, a strong Stage 2 target should look like this family:

- Lead: `THE PASSENGER WAS STILL INSIDE`
- Main caption: `Officers followed a street race until one car flipped and caught fire. The driver got out first, but the passenger was still trapped as flames moved through the vehicle.`

The exact winner should still be generated from the source run, not hard-coded from this note.
