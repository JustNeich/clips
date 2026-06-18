# Wisdom Channel Story Rendering Spec

This spec freezes the current protected baseline for Wisdom-style `channel_story`
renders. It is a regression contract for future template, Stage 3, Remotion,
worker, and publication changes.

## Protected Baseline

Wisdom/channel-story output is a full-source story render, not a short cropped
classic card:

- `layoutKind` stays `channel_story`.
- `durationMode` stays `source_full` when the channel/story run is intended to
  preserve the source reel duration.
- `videoFit` stays `contain` for the source media slot.
- `mirrorEnabled` stays `false`; source text, donor captions, and visible UI must
  remain upright.
- the render plan carries a source crop before the source is fitted into the
  media slot.
- the final video is delivered only from a PASS state, with the original source
  link attached.

This baseline protects the working behavior covered by the current Stage 3
snapshot/render-plan/text-scale tests: full-source channel-story snapshots,
contained story media, preserved source crop metadata, and Wisdom-like four-line
body fitting.

## Inner-Video-Only Crop Rule

Source crop is allowed only to clean the source video before it enters the media
slot. It must not be used to crop the final 1080x1920 composition, the story
text, the channel row, the matte, or the card/shell chrome.

For current channel-story full-source defaults, the protected crop is the upper
source region:

- crop source: `channel-story-lower-source-strip-v1`
- `x = 0`
- `y = 0`
- `width = 1`
- `height = 0.84`

The intent is to remove lower donor/source strips before media fitting. If a
future source needs a different crop, the change must still be an inner-source
crop and must be validated against full-frame output. Do not compensate for a bad
source crop by moving text, hiding the bottom area, or hand-editing the exported
MP4.

## Horizontal Sources Use Contain

Horizontal and wide sources must use `contain` in the media slot. The renderer
must preserve readable source context instead of forcing destructive cover zoom.

Expected behavior:

- wide source content remains understandable in the media slot;
- no left/right text flipping;
- no donor lower strip after the source crop;
- no destructive zoom that cuts off the visible action;
- underfill from `contain` is handled by the media matte/blur, not by switching
  back to `cover`.

## Adaptive Four-Line Text

Wisdom body text is dense but must remain readable. The body solver must adapt
font size and layout so the body fits within the configured line cap.

Requirements:

- Wisdom-like body text must fit within four configured body lines.
- The body/media layout must respond to measured line count; media moves after
  the body plus the configured gap instead of overlapping it.
- Descenders must remain safe; text cannot clip the bottoms of letters.
- Manual font scale may influence size, but it cannot bypass the line cap or
  create overlap with the media slot.

If a new text profile wants more than four visible lines, that is a new template
contract and must not silently replace the Wisdom baseline.

## Bottom Dense Blur / Matte

Contained media must sit on a dark, dense visual bed so horizontal sources do not
look like a thin floating strip.

Requirements:

- the contained source has a blurred source-video matte behind it;
- the matte is dark enough to hide empty underfill and edge artifacts;
- the bottom area must not become a pure black stripe;
- there must be no visible seam between the sharp source clip and the blurred
  matte;
- the blur/matte belongs inside the media slot and must not cover story text or
  channel chrome.

Current Remotion behavior uses a blurred, darkened source-video layer behind
contained channel-story media. Future changes may tune values, but the visual
contract above must remain true on rendered frames.

## Visual QA Gates

A Wisdom/channel-story render can pass only after visual QA checks the actual
video frames, not only JSON, logs, or HTTP success.

Minimum PASS gates:

- final MP4 opens and plays for the expected source duration;
- the visible source is upright and not mirrored;
- the source action remains readable in the contained media slot;
- lower donor/source strips are removed by inner-source crop;
- body text is readable, unclipped, and within the configured line cap;
- body text, media, channel row, and chrome do not overlap;
- bottom matte is dark and dense, but not a pure black bottom stripe;
- no seam is visible between source clip and blur/matte;
- no blank flash frames or obvious decode artifacts;
- final rendered output matches the reviewed preview/snapshot contract.

Any failure is a pipeline failure, not a publishable asset.

## Clean Experiment Rule

Experiments must be clean and reproducible:

- if preview/render/publish output fails, fix the pipeline or template state and
  rerun the render;
- do not manually rescue bad outputs by editing exported MP4s, replacing frames,
  cropping the final file, or sending a manually patched artifact;
- do not mark a source consumed or publication-ready from a failed visual QA run;
- document any intentional baseline change before treating it as the new normal.

Manual inspection is allowed as QA evidence. Manual post-production is not a
valid replacement for a passing pipeline.

## Telegram Delivery Rule

Telegram delivery happens only after PASS.

The delivery message must contain:

- the rendered video;
- the source link.

Do not send intermediate screenshots, broken renders, speculative explanations,
or "almost pass" assets as the delivery package. If the render fails QA, report
the blocker separately and rerun after fixing the pipeline.

## Suggested Test Cases

- Default Wisdom/channel-story snapshot: `source_full`, `videoFit: contain`,
  `mirrorEnabled: false`, and `channel-story-lower-source-strip-v1` crop.
- Horizontal 16:9 source: contained media remains readable, crop removes lower
  donor strip, and matte hides underfill without a bottom black stripe.
- Dense Wisdom body: representative body text fits within four lines without
  descender clipping or media overlap.
- Matte seam regression: sample first/middle/last frames and verify no visible
  boundary between the sharp source and blurred matte.
- Fail-closed delivery: a render with failed visual QA cannot be marked PASS,
  consumed, queued for publication, or sent to Telegram as final delivery.
