# Stage 3 Fragment Editor

This note captures the reliability rules for the manual fragment editor in Stage 3.

## Interaction model

- Each fragment row is split into three scan zones:
  - source-position rail,
  - meta/action header,
  - control area with separate `Тайминг` and `Кадрирование` cards.
- `Position X`, `Position Y`, and `Zoom` use sliders instead of numeric-only inputs because these values are tuned iteratively while watching preview.
- Changing `Position X` or `Position Y` must not silently raise `Zoom`; only the explicit zoom control changes scale.
- `Высота исходника` changes only the source video's vertical scale. It must not scale the card, text, source-blur background, or surrounding template chrome.
- The destructive action stays in the header, isolated from the timing fields, so accidental deletes are less likely during rapid editing.
- The editor has a canonical output model per render plan:
  - normal mode produces exactly the channel render target duration;
  - `source_full` mode produces exactly the source media duration for that individual video.
- The red playhead always represents output time `0..targetDurationSec`; it is never allowed to drift onto source time.
- Any timing edit resets preview playback back to `0s`.
- The source overview rail is the primary direct-manipulation surface:
  - when there are no explicit fragments, the blue window itself is the clip-range control, so there is no separate `Начало клипа` slider;
  - in whole-window mode, drag the blue window body to move the selected source range and drag either edge to change its duration;
  - drag the fragment body to move a manual fragment;
  - drag the left handle to trim `От`;
  - drag the right handle to trim `До`.
- The old `Подогнать к 6с` toggle is removed. Normal mode always normalizes the selected material to the exact channel render target timeline.
- The `Вся длина исходника` toggle switches the render plan to `durationMode: source_full`; Stage 3 uses one full-source segment from `0` to the source duration, disables routine fragmentation, and keeps playback at `1x`.
- Whole-window mode is no longer fixed to a 6-second source slice. In normal mode the selected source range may be shorter or longer than the channel target duration, and Stage 3 stretches or compresses it into that fixed output timeline. In `source_full` mode the selected range is always the full source and the output timeline expands to match it.

## Per-fragment transforms

- `focusX`, `focusY`, `videoZoom`, and `mirrorEnabled` are stored on each segment as optional overrides.
- If a fragment does not define one of these fields, Stage 3 falls back to the global editor values.
- New fragments inherit the current editor framing values at creation time so the first render stays predictable.

## Validation rules

- Fragment timing is still clamped to the same source bounds used by numeric inputs.
- Whole-window timing follows the same clamp rules as fragment timing, including the `1.0s` minimum width whenever the source is at least one second long.
- Minimum fragment duration is now `1.0s` for normal sources; if the source itself is shorter than one second, Stage 3 uses the full available source span instead.
- Manual fragments are sorted, clamped to source duration, and de-overlapped before preview/render.
- Overfilled selections are compressed into `targetDurationSec`.
- Underfilled selections are stretched into `targetDurationSec` with smooth slowmo.
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
- Final Remotion render resolves the same fragment transform on the same output timeline, so `X / Y / Zoom / Mirror` stay aligned with the editor.
- Segment-level framing does not require a separate FFmpeg preprocessing path; it is applied at preview/render composition time, while source extraction uses the same canonical fragment plan.
