# Stage 3 Fragment Editor

This note captures the reliability rules for the manual fragment editor in Stage 3.

## Interaction model

- Each fragment row is split into three scan zones:
  - source-position rail,
  - meta/action header,
  - control area with separate `Тайминг` and `Кадрирование` cards.
- `Position Y` and `Zoom` use sliders instead of numeric-only inputs because these values are tuned iteratively while watching preview.
- The destructive action stays in the header, isolated from the timing fields, so accidental deletes are less likely during rapid editing.
- The source overview rail is the primary direct-manipulation surface:
  - when there are no explicit fragments, the blue window itself is the clip-range control, so there is no separate `Начало клипа` slider;
  - drag the segment body to move the fragment;
  - drag the left handle to trim `От`;
  - drag the right handle to trim `До`.
- If there are no explicit fragments and normalize-to-6s is enabled, the editor treats the whole source video as active coverage and compresses that full span into the 6-second output.

## Per-fragment transforms

- `focusY`, `videoZoom`, and `mirrorEnabled` are stored on each segment as optional overrides.
- If a fragment does not define one of these fields, Stage 3 falls back to the global editor values.
- New fragments inherit the current editor framing values at creation time so the first render stays predictable.

## Validation rules

- Fragment timing is still clamped to the same source bounds used by numeric inputs.
- Minimum fragment duration remains `0.1s`.
- When normalize-to-6s is disabled, drag/resize cannot grow a fragment beyond the remaining target duration budget.
- The same normalization runs for:
  - manual input,
  - source-rail drag/resize,
  - draft restore,
  - preview/render request normalization.

## Preview and render consistency

- Live editor preview resolves the active fragment by output timeline time and applies that fragment's framing overrides.
- Final Remotion render resolves the same fragment transform on the same output timeline, so `Y / Zoom / Mirror` stay aligned with the editor.
- Segment-level framing does not require a separate FFmpeg preprocessing path; it is applied at preview/render composition time.
