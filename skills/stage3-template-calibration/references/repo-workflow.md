# Repo Workflow

Use this reference file only when working on the Stage 3 template calibration flow in this repository.

## Primary files

- `app/components/Stage3TemplateLab.tsx`
  - calibration UI
  - overlay controls
  - reference bounds controls
  - live diff computation
- `lib/template-scene.tsx`
  - canonical template renderer
  - must stay aligned with editor preview and Remotion render
- `lib/stage3-template.ts`
  - template geometry
  - typography defaults
  - palette definitions
- `lib/template-calibration-store.ts`
  - repo-backed session read/write
  - normalization of session values
- `lib/template-calibration-types.ts`
  - calibration data contract
- `scripts/template-calibration-capture.ts`
  - Playwright capture loop
- `design/templates/<templateId>/`
  - per-template inputs and artifacts

## Session fields that matter most

- `referenceCropX`
- `referenceCropY`
- `referenceCropWidth`
- `referenceCropHeight`
- `referenceOffsetX`
- `referenceOffsetY`
- `referenceScale`
- `compareScope`
- `splitPosition`

## Standard commands

Start local dev:

```bash
HOST=127.0.0.1 PORT=<free-port> npm run dev
```

Capture and persist artifacts:

```bash
npm run -s design:template:capture -- --template=<templateId> --origin=http://127.0.0.1:<free-port> --mode=overlay --capture=1
```

Run static verification:

```bash
npm run -s typecheck
```

## Iteration checklist

1. Read current `session.json` and latest `report.json`.
2. Normalize reference bounds first.
3. Capture a fresh baseline.
4. Change only the smallest relevant layout or style inputs.
5. Re-capture.
6. Compare mismatch trend and visual overlay.
7. Record remaining mismatch cause in `notes.md`.

## Preflight checklist

Before any long calibration run, verify and report:

- `design/templates/<templateId>/reference.*` exists
- `content.json` exists and is readable
- `session.json` exists and is readable
- `notes.md` exists
- `artifacts/report.json` exists if trend comparison is expected
- `media.*` exists if `full` diff is being used and media matters
- `background.*` exists if the background is visible and important
- `avatar.*` exists if the avatar is visible and important

If one or more required items are missing:

1. list every missing item explicitly
2. explain why it blocks trustworthy calibration
3. stop before doing long analysis or repeated visual iterations

Do not continue into template tuning when the preflight failed.

## Pixel-Exact checklist

For every pass, verify all of these explicitly:

- element exists if and only if it exists in the reference
- shell width, height, radius, and outer bounds
- section heights and transitions between sections
- borders, divider lines, and strokes
- border thickness and border color
- paddings and distances to the nearest edge
- spacing between avatar, name, handle, badge, and text blocks
- exact text block width and height footprint
- font size, weight, line-height, letter spacing, and alignment
- badge diameter, fill color, and alignment
- media window size and chrome overlap rules
- background fill, gradient behavior, and visible contrast
- bottom text distance to the lower edge

If one of these is still wrong, the template is not calibrated yet.

## Known failure modes

### Reference is not really 9:16

Symptoms:

- overlay looks globally offset even when local parts seem similar
- mismatch stays high everywhere

Fix:

- use crop bounds first
- use `Auto 9:16 crop`
- then fine-tune offset and scale

### `splitPosition` behaves strangely

Symptoms:

- swipe divider appears in the wrong place

Fix:

- keep `splitPosition` in `0..1`
- never save percentage values like `50`

### Full diff is noisy

Symptoms:

- mismatch is dominated by media content instead of layout

Fix:

- switch to `chrome-only`
- ensure exact media/background/avatar fixtures exist before trusting `full`

### Improvement is not durable

Symptoms:

- next session starts from confusion again

Fix:

- capture artifacts after each real pass
- keep `session.json` current
- update `notes.md` with what changed and what still fails
