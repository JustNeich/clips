import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeStage3SourceCrop,
  normalizeStage3RenderPlanSegments,
  resolveCanonicalStage3RenderPolicy
} from "../lib/stage3-render-plan";
import { buildStage3SourceCropFfmpegFilter } from "../lib/stage3-source-crop";
import {
  fallbackRenderPlan,
  hydrateStage3RenderPlanOverride,
  normalizeRenderPlan,
  rebaseStage3RenderPlanOnChannelBase
} from "../app/home-page-support";
import {
  buildStage3DraftRenderPlanOverride,
  sanitizeStage3DraftRenderPlanOverride
} from "../lib/stage3-draft-render-plan";

test("normalizeStage3RenderPlanSegments sorts fragments by source timing", () => {
  const normalized = normalizeStage3RenderPlanSegments([
    {
      startSec: 8,
      endSec: 9.5,
      speed: 1,
      label: "B"
    },
    {
      startSec: 1.2,
      endSec: 2.4,
      speed: 1,
      label: "A",
      focusX: 0.73,
      focusY: 0.21,
      videoZoom: 1.16
    }
  ]);

  assert.equal(normalized.length, 2);
  assert.equal(normalized[0]?.label, "A");
  assert.equal(normalized[0]?.focusX, 0.73);
  assert.equal(normalized[0]?.focusY, 0.21);
  assert.equal(normalized[1]?.label, "B");
});

test("stage 3 draft render-plan override keeps per-draft duration and source gain", () => {
  const base = fallbackRenderPlan();
  const current = normalizeRenderPlan(
    {
      ...base,
      targetDurationSec: 59,
      sourceAudioGain: 1.75,
      videoFit: "contain",
      sourceCrop: {
        enabled: true,
        x: 0,
        y: 0,
        width: 1,
        height: 0.84,
        confidence: 0.86,
        source: "channel-story-lower-source-strip-v1"
      }
    },
    base
  );

  assert.deepEqual(buildStage3DraftRenderPlanOverride(current, base), {
    targetDurationSec: 59,
    sourceAudioGain: 1.75,
    videoFit: "contain",
    sourceCrop: {
      enabled: true,
      x: 0,
      y: 0,
      width: 1,
      height: 0.84,
      confidence: 0.86,
      source: "channel-story-lower-source-strip-v1",
      reviewedAt: null,
      notes: null
    }
  });

  assert.deepEqual(
    sanitizeStage3DraftRenderPlanOverride({
      targetDurationSec: 15,
      durationMode: "channel_default",
      sourceAudioGain: 0.5,
      videoFit: "contain",
      sourceCrop: {
        enabled: true,
        x: 0,
        y: 0,
        width: 1,
        height: 0.84,
        confidence: 0.86,
        source: "channel-story-lower-source-strip-v1"
      },
      templateId: "template-owned-by-channel"
    }),
    {
      durationMode: "channel_default",
      targetDurationSec: 15,
      sourceAudioGain: 0.5,
      videoFit: "contain",
      sourceCrop: {
        enabled: true,
        x: 0,
        y: 0,
        width: 1,
        height: 0.84,
        confidence: 0.86,
        source: "channel-story-lower-source-strip-v1"
      }
    }
  );
});

test("saved Stage 3 version rebases channel template identity onto current channel", () => {
  const base = fallbackRenderPlan();
  const currentChannelBase = normalizeRenderPlan(
    {
      ...base,
      templateId: "the-legacy-journal-template",
      authorName: "The Legacy Journal",
      authorHandle: "@TheLegacyJournal",
      avatarAssetId: "legacy-avatar",
      avatarAssetMimeType: "image/jpeg"
    },
    base
  );
  const staleVersionPlan = normalizeRenderPlan(
    {
      ...currentChannelBase,
      templateId: "barracks-chronicles-template",
      authorName: "Barracks Chronicles",
      authorHandle: "@BarracksChronicles",
      avatarAssetId: "barracks-avatar",
      avatarAssetMimeType: "image/png",
      targetDurationSec: 12,
      videoZoom: 1.36,
      topFontScale: 1.42
    },
    base
  );

  const rebased = rebaseStage3RenderPlanOnChannelBase(staleVersionPlan, currentChannelBase);

  assert.equal(rebased.templateId, "the-legacy-journal-template");
  assert.equal(rebased.authorName, "The Legacy Journal");
  assert.equal(rebased.authorHandle, "@TheLegacyJournal");
  assert.equal(rebased.avatarAssetId, "legacy-avatar");
  assert.equal(rebased.avatarAssetMimeType, "image/jpeg");
  assert.equal(rebased.targetDurationSec, 12);
  assert.equal(rebased.videoZoom, 1.36);
  assert.equal(rebased.topFontScale, 1.42);
});

test("legacy full draft render plan cannot override active channel template identity", () => {
  const base = fallbackRenderPlan();
  const currentChannelBase = normalizeRenderPlan(
    {
      ...base,
      templateId: "the-legacy-journal-template",
      authorName: "The Legacy Journal",
      authorHandle: "@TheLegacyJournal",
      avatarAssetId: "legacy-avatar",
      avatarAssetMimeType: "image/jpeg"
    },
    base
  );
  const legacyFullDraftPlan = normalizeRenderPlan(
    {
      ...base,
      templateId: "barracks-chronicles-template",
      authorName: "Barracks Chronicles",
      authorHandle: "@BarracksChronicles",
      avatarAssetId: "barracks-avatar",
      avatarAssetMimeType: "image/png",
      targetDurationSec: 12,
      videoZoom: 1.36,
      topFontScale: 1.42
    },
    base
  );

  const hydrated = hydrateStage3RenderPlanOverride(legacyFullDraftPlan, currentChannelBase);

  assert.equal(hydrated.templateId, "the-legacy-journal-template");
  assert.equal(hydrated.authorName, "The Legacy Journal");
  assert.equal(hydrated.authorHandle, "@TheLegacyJournal");
  assert.equal(hydrated.avatarAssetId, "legacy-avatar");
  assert.equal(hydrated.avatarAssetMimeType, "image/jpeg");
  assert.equal(hydrated.targetDurationSec, 12);
  assert.equal(hydrated.videoZoom, 1.36);
  assert.equal(hydrated.topFontScale, 1.42);
});

test("resolveCanonicalStage3RenderPolicy forces fixed_segments when fragments exist", () => {
  const policy = resolveCanonicalStage3RenderPolicy({
    segments: normalizeStage3RenderPlanSegments([
      {
        startSec: 5,
        endSec: 6,
        speed: 1,
        label: "Only"
      }
    ]),
    normalizeToTargetEnabled: true,
    requestedPolicy: "full_source_normalize"
  });

  assert.equal(policy, "fixed_segments");
});

test("resolveCanonicalStage3RenderPolicy clears stale full_source_normalize when normalize mode is off", () => {
  const policy = resolveCanonicalStage3RenderPolicy({
    segments: [],
    normalizeToTargetEnabled: false,
    requestedPolicy: "full_source_normalize"
  });

  assert.equal(policy, "fixed_segments");
});

test("normalizeStage3SourceCrop clamps crop and preserves render-plan crop metadata", () => {
  const crop = normalizeStage3SourceCrop({
    enabled: true,
    x: 0.1,
    y: 0.2,
    width: 0.95,
    height: 0.9,
    confidence: 0.72,
    source: "copscopes-default-inner-frame"
  });

  assert.deepEqual(crop, {
    enabled: true,
    x: 0.1,
    y: 0.2,
    width: 0.9,
    height: 0.8,
    confidence: 0.72,
    source: "copscopes-default-inner-frame",
    reviewedAt: null,
    notes: null
  });
  assert.equal(
    buildStage3SourceCropFfmpegFilter(crop),
    "crop=trunc(iw*0.900000/2)*2:trunc(ih*0.800000/2)*2:trunc(iw*0.100000/2)*2:trunc(ih*0.200000/2)*2"
  );
});

test("normalizeRenderPlan preserves Stage 3 source crop", () => {
  const base = fallbackRenderPlan();
  const normalized = normalizeRenderPlan(
    {
      ...base,
      sourceCrop: {
        enabled: true,
        x: 0.08,
        y: 0.16,
        width: 0.84,
        height: 0.66,
        confidence: 0.62,
        source: "copscopes-default-inner-frame"
      }
    },
    base
  );

  assert.equal(normalized.sourceCrop?.enabled, true);
  assert.equal(normalized.sourceCrop?.x, 0.08);
  assert.equal(normalized.sourceCrop?.height, 0.66);
  assert.equal(normalized.sourceCrop?.confidence, 0.62);
});

test("normalizeRenderPlan preserves contain video fit and rejects invalid values", () => {
  const base = fallbackRenderPlan();
  const contained = normalizeRenderPlan(
    {
      ...base,
      videoFit: "contain"
    },
    base
  );
  const invalid = normalizeRenderPlan(
    {
      ...base,
      videoFit: "stretch" as never
    },
    base
  );

  assert.equal(contained.videoFit, "contain");
  assert.equal(invalid.videoFit, "cover");
});

test("normalizeRenderPlan preserves optional media region height", () => {
  const base = fallbackRenderPlan();
  const normalized = normalizeRenderPlan(
    {
      ...base,
      mediaRegionHeightPx: 510
    },
    base
  );

  assert.equal(normalized.mediaRegionHeightPx, 510);
});

test("normalizeRenderPlan preserves and clamps Stage 3 vertical source scale", () => {
  const base = fallbackRenderPlan();
  const normalized = normalizeRenderPlan(
    {
      ...base,
      videoScaleY: 0.72
    },
    base
  );
  const clamped = normalizeRenderPlan(
    {
      ...base,
      videoScaleY: 3
    },
    base
  );

  assert.equal(normalized.videoScaleY, 0.72);
  assert.equal(clamped.videoScaleY, 1.5);
});

test("normalizeRenderPlan preserves and clamps source audio gain", () => {
  const base = fallbackRenderPlan();
  const boosted = normalizeRenderPlan(
    {
      ...base,
      sourceAudioGain: 1.75
    },
    base
  );
  const clamped = normalizeRenderPlan(
    {
      ...base,
      sourceAudioGain: 5
    },
    base
  );

  assert.equal(boosted.sourceAudioGain, 1.75);
  assert.equal(clamped.sourceAudioGain, 2);
});
