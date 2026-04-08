# Stage 3 Fragment Editor

This note captures the reliability rules for the manual fragment editor in Stage 3.

## Interaction model

- Each fragment row is split into three scan zones:
  - source-position rail,
  - meta/action header,
  - control area with separate `Тайминг` and `Кадрирование` cards.
- `Position Y` and `Zoom` use sliders instead of numeric-only inputs because these values are tuned iteratively while watching preview.
- The destructive action stays in the header, isolated from the timing fields, so accidental deletes are less likely during rapid editing.
- The editor now has a single canonical output model: every Stage 3 edit produces exactly `6.0s` of output.
- The red playhead always represents output time `0..6s`; it is never allowed to drift onto source time.
- Any timing edit resets preview playback back to `0s`.
- The source overview rail is the primary direct-manipulation surface:
  - when there are no explicit fragments, the blue window itself is the clip-range control, so there is no separate `Начало клипа` slider;
  - drag the segment body to move the fragment;
  - drag the left handle to trim `От`;
  - drag the right handle to trim `До`.
- The old `Подогнать к 6с` toggle is removed. The editor always normalizes the selected material to the exact 6-second output timeline.

## Per-fragment transforms

- `focusY`, `videoZoom`, and `mirrorEnabled` are stored on each segment as optional overrides.
- If a fragment does not define one of these fields, Stage 3 falls back to the global editor values.
- New fragments inherit the current editor framing values at creation time so the first render stays predictable.

## Validation rules

- Fragment timing is still clamped to the same source bounds used by numeric inputs.
- Minimum fragment duration remains `0.1s`.
- Manual fragments are sorted, clamped to source duration, and de-overlapped before preview/render.
- Overfilled selections are compressed into `6.0s`.
- Underfilled selections are stretched into `6.0s` with smooth slowmo.
- The same normalization runs for:
  - manual input,
  - source-rail drag/resize,
  - draft restore,
  - preview/render request normalization.

## Preview and render consistency

- Preview and render both consume the same canonical Stage 3 editor session.
- Stage 3 now exposes one canonical preview surface. There is no separate `Редактор / Финал` playback mode anymore.
- Live editor preview resolves the active fragment by output timeline time and applies that fragment's framing overrides.
- Saved versions and the heavier accurate/final artifact stay outside the main transport flow and are opened from the versions drawer instead of replacing the primary preview surface.
- Final Remotion render resolves the same fragment transform on the same output timeline, so `Y / Zoom / Mirror` stay aligned with the editor.
- Segment-level framing does not require a separate FFmpeg preprocessing path; it is applied at preview/render composition time, while source extraction uses the same canonical fragment plan.
