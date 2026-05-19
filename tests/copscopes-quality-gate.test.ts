import assert from "node:assert/strict";
import test from "node:test";

import {
  COPSCOPES_TIGHT_SOURCE_CROP_SOURCE,
  createCopscopesTightSourceCrop,
  ensureCopscopesCaptionHighlights,
  validateCopscopesRenderBodyForPublication
} from "../lib/copscopes-quality-gate";

const denseBody =
  "The driver climbs out first, but the passenger is still trapped as flames move across the wreck. An officer reaches through the window while another voice calls for distance. The rescue has to happen before the fire reaches the cabin.";

test("CopScopes quality gate blocks missing avatar, short text, and weak source crops", () => {
  const weak = validateCopscopesRenderBodyForPublication({
    bottomText: "The passenger was still inside when the officer reached for the door.",
    clipDurationSec: 6,
    renderPlan: {
      sourceCrop: {
        enabled: true,
        x: 0.08,
        y: 0.16,
        width: 0.84,
        height: 0.66,
        confidence: 0.62,
        source: "copscopes-default-inner-frame"
      },
      avatarAssetId: null
    }
  });

  assert.equal(weak.passed, false);
  assert.ok(weak.reasons.includes("missing_channel_avatar_asset"));
  assert.ok(weak.reasons.some((reason) => reason.startsWith("main_caption_too_short")));
  assert.ok(weak.reasons.includes("source_crop_not_tight_enough"));
});

test("CopScopes quality gate accepts dense text with avatar, yellow highlights, and tight crop", () => {
  const highlights = ensureCopscopesCaptionHighlights({
    topText: "THE PASSENGER FIRST",
    bottomText: denseBody
  });
  const result = validateCopscopesRenderBodyForPublication({
    bottomText: denseBody,
    clipDurationSec: 6,
    renderPlan: {
      sourceCrop: createCopscopesTightSourceCrop(),
      avatarAssetId: "avatar_123",
      videoZoom: 1.02,
      mirrorEnabled: false
    },
    snapshot: {
      bottomText: denseBody,
      clipDurationSec: 6,
      focusY: 0.47,
      captionHighlights: highlights
    }
  });

  assert.equal(result.passed, true);
  assert.equal(highlights.bottom.length >= 2, true);
  assert.equal(createCopscopesTightSourceCrop().source, COPSCOPES_TIGHT_SOURCE_CROP_SOURCE);
});

test("CopScopes quality gate accepts source-full duration when it matches the source", () => {
  const highlights = ensureCopscopesCaptionHighlights({
    topText: "THE PASSENGER FIRST",
    bottomText: denseBody
  });
  const result = validateCopscopesRenderBodyForPublication({
    bottomText: denseBody,
    clipDurationSec: 44,
    renderPlan: {
      durationMode: "source_full",
      targetDurationSec: 44,
      sourceCrop: createCopscopesTightSourceCrop(),
      avatarAssetId: "avatar_123",
      videoZoom: 1.02,
      mirrorEnabled: false
    },
    snapshot: {
      bottomText: denseBody,
      clipDurationSec: 44,
      sourceDurationSec: 44,
      focusY: 0.47,
      captionHighlights: highlights
    }
  });

  assert.equal(result.passed, true);
});

test("CopScopes quality gate rejects source-full duration drift", () => {
  const result = validateCopscopesRenderBodyForPublication({
    bottomText: denseBody,
    clipDurationSec: 6,
    renderPlan: {
      durationMode: "source_full",
      targetDurationSec: 44,
      sourceCrop: createCopscopesTightSourceCrop(),
      avatarAssetId: "avatar_123",
      videoZoom: 1.02,
      mirrorEnabled: false
    },
    snapshot: {
      bottomText: denseBody,
      clipDurationSec: 6,
      sourceDurationSec: 44,
      focusY: 0.47,
      captionHighlights: ensureCopscopesCaptionHighlights({
        topText: "THE PASSENGER FIRST",
        bottomText: denseBody
      })
    }
  });

  assert.equal(result.passed, false);
  assert.ok(result.reasons.includes("duration_not_matching_full_source"));
});

test("CopScopes quality gate rejects source windows that can expose lower meta bands", () => {
  const result = validateCopscopesRenderBodyForPublication({
    bottomText: denseBody,
    clipDurationSec: 6,
    renderPlan: {
      sourceCrop: createCopscopesTightSourceCrop(),
      avatarAssetId: "avatar_123",
      videoZoom: 1.2,
      mirrorEnabled: true
    },
    snapshot: {
      bottomText: denseBody,
      clipDurationSec: 6,
      focusY: 0.5,
      captionHighlights: ensureCopscopesCaptionHighlights({
        topText: "THE PASSENGER FIRST",
        bottomText: denseBody
      })
    }
  });

  assert.equal(result.passed, false);
  assert.ok(result.reasons.includes("source_window_overzoomed"));
  assert.ok(result.reasons.includes("source_window_not_lifted_above_lower_meta"));
  assert.ok(result.reasons.includes("source_window_mirror_must_be_disabled"));
});

test("CopScopes quality gate rejects unreadably narrow crops even when they hide source meta", () => {
  const result = validateCopscopesRenderBodyForPublication({
    bottomText: denseBody,
    clipDurationSec: 6,
    renderPlan: {
      sourceCrop: {
        ...createCopscopesTightSourceCrop(),
        height: 0.24
      },
      avatarAssetId: "avatar_123",
      videoZoom: 1.02,
      mirrorEnabled: false
    },
    snapshot: {
      bottomText: denseBody,
      clipDurationSec: 6,
      focusY: 0.47,
      captionHighlights: ensureCopscopesCaptionHighlights({
        topText: "THE PASSENGER FIRST",
        bottomText: denseBody
      })
    }
  });

  assert.equal(result.passed, false);
  assert.ok(result.reasons.includes("source_crop_too_narrow_for_readability"));
});
