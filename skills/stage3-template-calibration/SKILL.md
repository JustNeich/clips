---
name: stage3-template-calibration
description: Calibrate Stage 3 visual templates against repo-backed reference images with a persistent, measurement-driven workflow. Use when Codex needs to match or refine a Stage 3 template to a reference image, add a new reference-driven template, reduce overlay or pixel-diff mismatch, normalize reference bounds, or iterate on `template-road` / `design/templates/<templateId>` assets and session state.
---

# Stage 3 Template Calibration

Use this skill to turn template matching into a repeatable calibration loop instead of a one-off visual guess.

## Core Rule

Treat the repo-backed reference file as the source of truth. Do not rely on chat screenshots for pixel-accurate matching.

Treat every visible difference as real work, not noise. The goal is not "similar" or "close enough". The goal is to match the reference across all observable factors.

Always continue from the existing calibration session when it exists:

- `design/templates/<templateId>/content.json`
- `design/templates/<templateId>/session.json`
- `design/templates/<templateId>/notes.md`
- `design/templates/<templateId>/artifacts/report.json`

Do not reset the session or overwrite artifacts unless there is a concrete reason.

Fail fast on missing inputs. Do not spend a long time editing, capturing, or analyzing if critical calibration inputs are absent. First check what exists, list every missing item explicitly, and stop until the missing inputs are resolved.

When the user says the reference image should be enough, switch to `reference-first` calibration instead of blocking on every missing fixture. In that mode:

- treat the repo-backed reference as the primary source of geometry, chrome, colors, section rhythm, and typography
- treat avatar and other channel-specific identity assets as optional unless the user explicitly says they are critical
- derive or approximate secondary fixtures from the reference when that is the fastest safe path
- do not ask the user to manually hunt for supporting assets unless the remaining mismatch is genuinely impossible to resolve without them

## Pixel-Exact Standard

Calibrate against every observable detail, not just the large blocks.

That includes:

- presence or absence of every element
- exact element bounds
- all paddings, gaps, and distances to edges
- border presence, thickness, radius, and color
- divider lines and their weight
- corner rounding
- background colors, fills, gradients, opacity, and contrast
- typography family, weight, size, line-height, letter-spacing, line clamp, and alignment
- avatar size, border, spacing, and vertical alignment
- verification badge size, shape, fill, color, and placement
- text block position relative to neighboring elements
- media window bounds and the relationship between media and chrome
- shadow, stroke, and any decorative treatment that is visibly present

Use literal thinking:

- If the reference has a border, the template must have a border.
- If the border looks like `4px`, calibrate to `4px`, not `2px` or "roughly there".
- If the bottom text sits `5px` from the lower edge, match that spacing.
- If an element does not exist in the reference, remove it instead of rationalizing it away.

Do not collapse details into broad categories like "layout is close" or "color is roughly right". Every mismatch in presence, spacing, size, radius, stroke, color, opacity, or alignment is part of the task until proven otherwise.

## Workflow

### 1. Build context before editing

Read only the files that drive the calibration loop:

- `design/templates/<templateId>/content.json`
- `design/templates/<templateId>/session.json`
- `design/templates/<templateId>/notes.md`
- `design/templates/<templateId>/artifacts/report.json` if it exists
- `lib/template-scene.tsx`
- `lib/stage3-template.ts`
- `app/components/Stage3TemplateLab.tsx`

If the user added a new template, also read:

- `lib/stage3-design-lab.ts`
- `app/design/template-road/page.tsx`
- `lib/template-calibration-store.ts`
- `lib/template-calibration-types.ts`

### 2. Run a fail-fast preflight

Before any substantial work, explicitly verify all required inputs and report the result.

Minimum required input for any real calibration:

- repo-backed `reference.*`
- target `templateId`
- readable calibration session files

Additional inputs required for trustworthy comparison, depending on scope:

- `media.*` for `full` diff if the reference includes meaningful media content
- `background.*` if the background is part of the visual match
- `avatar.*` if the avatar is visible in the reference
- prior `report.json` if you need to compare trend against an earlier pass

If anything required is missing, respond immediately with a concrete checklist and stop. Do not continue into a long calibration pass.

Exception for `reference-first` mode:

- do not fail solely because `avatar.*` is missing
- do not fail solely because `background.*` is missing if the missing background can be approximated from CSS or derived from the reference
- do not fail solely because `media.*` is missing if `chrome-only` calibration can still make real progress

Use explicit wording like:

- `Missing reference: design/templates/<templateId>/reference.*`
- `Missing media fixture for full diff`
- `Missing avatar fixture`
- `Missing previous report for trend comparison`

Never return a vague failure like "could not complete" when the real issue is missing inputs.

### 3. Confirm usable inputs

Before touching layout code, verify:

- A real repo-backed reference exists in `design/templates/<templateId>/reference.*`
- Exact fixture assets exist when possible:
  - `media.*`
  - `background.*`
  - `avatar.*`
- The template is rendered through the canonical renderer, not a separate mock renderer

If the reference is only available as a chat image, stop treating the comparison as pixel-perfect. Move it into the repo first.

If the required inputs are incomplete, stop here and enumerate every missing item in one response.

### 4. Normalize the reference first

Never start layout tuning until the reference is normalized to the canonical `1080x1920` frame.

Use the calibration UI and session fields to normalize reference placement:

- `referenceCropX`
- `referenceCropY`
- `referenceCropWidth`
- `referenceCropHeight`
- `referenceOffsetX`
- `referenceOffsetY`
- `referenceScale`

Default procedure:

1. Open `template-road` for the target template.
2. Run `Auto 9:16 crop` first.
3. Fine-tune `Crop X/Y/W/H` only if the reference file contains extra margins, browser chrome, or non-template padding.
4. Use `X/Y` and `Ref scale` only after crop bounds are correct.

Do not compensate for a bad crop by pushing `X/Y/scale` harder. Fix bounds first.

### 5. Measure before claiming progress

Start the local dev server and capture the current state with the repo’s capture script:

```bash
HOST=127.0.0.1 PORT=<free-port> npm run dev
npm run -s design:template:capture -- --template=<templateId> --origin=http://127.0.0.1:<free-port> --mode=overlay --capture=1
```

Read the latest bundle/report after capture and compare:

- `mismatchPercent`
- `chromeMismatchPercent`
- current `session`
- saved `artifacts`

Do not invent improvement claims. Ground them in the saved report or in a visible overlay result.

### 6. Tune in the correct order

Use this order every time:

1. Reference normalization
2. Shell geometry and section bounds
3. Author/meta proportions
4. Typography scale and weight
5. Color and contrast
6. Micro spacing and alignment
7. Presence and styling parity for all secondary details

Do not start with color if geometry is still visibly wrong.

Do not start with copy changes if the template chrome is still mismatched.

At each step, check both:

- macro structure
- all small details inside that structure

### 7. Edit only canonical render paths

Prefer editing these files:

- `lib/template-scene.tsx`
- `lib/stage3-template.ts`

Only touch other files when the evidence shows the mismatch lives there.

If the template is supposed to share the same shell size as ScienceCard, preserve the shell dimensions unless the user explicitly asks to break that contract.

### 8. Re-capture after each meaningful pass

After a real visual pass:

1. Run `typecheck`
2. Re-run capture with `--capture=1`
3. Compare the new report against the previous saved report
4. Update `notes.md` with what changed and what still looks wrong

Do not stop on a subjective “looks better” without a saved capture.

## Guardrails

- Keep using the existing session. Do not start from a blank state.
- Start every run with a preflight and missing-input report.
- Use the same reference normalization logic for both overlay and diff.
- Prefer `chrome-only` scope when media content is noisy.
- Use `full` scope only when fixtures match the reference content closely.
- Do not trust a mismatch percentage alone; inspect the overlay and the hotspot zones.
- Do not declare pixel-perfect completion if the reference is not an exact fixture match.
- Do not regress the canonical shell size for templates that intentionally share a shell contract.
- If required inputs are missing, stop early instead of doing speculative work.

## Acceptance

A pass is only acceptable when all of these are true:

- The reference is correctly normalized into the canonical frame.
- The latest saved artifacts were generated after the most recent edits.
- The mismatch trend improved or a specific remaining blocker is documented.
- Top block, media window, and bottom meta block no longer show obvious geometric drift in overlay mode.
- `npm run -s typecheck` passes.

## Playwright

Prefer the existing calibration route and capture script over ad-hoc browser poking:

- `/design/template-road?template=<templateId>&mode=overlay`
- `npm run -s design:template:capture ...`

Use headed browser inspection only when the saved report is not enough to explain the mismatch.

## References

Read [references/repo-workflow.md](references/repo-workflow.md) when you need the exact file map, command set, or iteration checklist for this repository.
