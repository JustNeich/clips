import type { Stage2Response, Stage3SourceCrop, Stage3StateSnapshot } from "../app/components/types";
import type { Stage3RenderRequestBody } from "./stage3-render-service";
import { DEFAULT_STAGE3_CLIP_DURATION_SEC } from "./stage3-duration";
import { normalizeStage3SourceCrop } from "./stage3-source-crop";
import {
  cloneTemplateCaptionHighlights,
  createEmptyTemplateCaptionHighlights,
  type TemplateCaptionHighlights
} from "./template-highlights";

export const COPSCOPES_TIGHT_SOURCE_CROP_SOURCE = "copscopes-readable-source-window-v5";
export const COPSCOPES_MIN_MAIN_CAPTION_CHARS = 190;
export const COPSCOPES_MAX_MAIN_CAPTION_CHARS = 340;
export const COPSCOPES_MIN_CROP_CONFIDENCE = 0.78;
export const COPSCOPES_MIN_CROP_Y = 0.42;
export const COPSCOPES_MIN_CROP_HEIGHT = 0.32;
export const COPSCOPES_MAX_CROP_HEIGHT = 0.4;
export const COPSCOPES_MIN_CROP_BOTTOM = 0.76;
export const COPSCOPES_MAX_CROP_BOTTOM = 0.86;
export const COPSCOPES_MIN_VIDEO_ZOOM = 1;
export const COPSCOPES_DEFAULT_VIDEO_ZOOM = 1.02;
export const COPSCOPES_MAX_VIDEO_ZOOM = 1.08;
export const COPSCOPES_MAX_FOCUS_Y = 0.47;

const HIGHLIGHT_SLOT_ID = "slot1" as const;

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeConfidence(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  if (value > 1) {
    return clampUnit(value / 100);
  }
  return clampUnit(value);
}

export function createCopscopesTightSourceCrop(confidence?: number | null): Stage3SourceCrop {
  return {
    enabled: true,
    x: 0.02,
    y: 0.46,
    width: 0.96,
    height: 0.34,
    confidence: Math.max(COPSCOPES_MIN_CROP_CONFIDENCE, normalizeConfidence(confidence, 0.88)),
    source: COPSCOPES_TIGHT_SOURCE_CROP_SOURCE,
    notes:
      "Readable crop keeps the original incident footage while removing CopScopes captions, frame, handle/watermark, and post-chrome layers before fitting."
  };
}

export function isCopscopesTightSourceCrop(crop: Stage3SourceCrop | null | undefined): boolean {
  const normalized = normalizeStage3SourceCrop(crop ?? null, null);
  if (!normalized?.enabled) {
    return false;
  }
  const confidence = normalized.confidence ?? 0;
  return (
    normalized.source === COPSCOPES_TIGHT_SOURCE_CROP_SOURCE &&
    normalized.y >= COPSCOPES_MIN_CROP_Y &&
    normalized.height >= COPSCOPES_MIN_CROP_HEIGHT &&
    normalized.height <= COPSCOPES_MAX_CROP_HEIGHT &&
    normalized.y + normalized.height >= COPSCOPES_MIN_CROP_BOTTOM &&
    normalized.y + normalized.height <= COPSCOPES_MAX_CROP_BOTTOM &&
    confidence >= COPSCOPES_MIN_CROP_CONFIDENCE
  );
}

export function resolveCopscopesProductionSourceCrop(
  crop: Stage3SourceCrop | null | undefined,
  cropConfidence?: number | null
): Stage3SourceCrop {
  const normalized = normalizeStage3SourceCrop(crop ?? null, null);
  if (isCopscopesTightSourceCrop(normalized)) {
    return {
      ...normalized!,
      confidence: normalizeConfidence(cropConfidence ?? normalized!.confidence, normalized!.confidence ?? 0.88)
    };
  }
  return createCopscopesTightSourceCrop(cropConfidence);
}

function overlaps(existing: TemplateCaptionHighlights["bottom"], start: number, end: number): boolean {
  return existing.some((span) => start < span.end && end > span.start);
}

function addHighlight(
  highlights: TemplateCaptionHighlights["bottom"],
  text: string,
  phrase: string
): boolean {
  const lower = text.toLowerCase();
  const phraseLower = phrase.toLowerCase();
  const start = lower.indexOf(phraseLower);
  if (start < 0) {
    return false;
  }
  const end = start + phrase.length;
  if (overlaps(highlights, start, end)) {
    return false;
  }
  highlights.push({ start, end, slotId: HIGHLIGHT_SLOT_ID });
  return true;
}

export function ensureCopscopesCaptionHighlights(input: {
  topText: string;
  bottomText: string;
  highlights?: TemplateCaptionHighlights | null;
}): TemplateCaptionHighlights {
  const next = cloneTemplateCaptionHighlights(input.highlights ?? createEmptyTemplateCaptionHighlights());
  next.top = [];
  next.bottom = next.bottom
    .filter((span) => span.start >= 0 && span.end > span.start && span.end <= input.bottomText.length)
    .slice(0, 5)
    .map((span) => ({ ...span, slotId: HIGHLIGHT_SLOT_ID }));
  if (next.bottom.length >= 2) {
    return next;
  }

  const phraseCandidates = [
    "officer",
    "officers",
    "deputy",
    "driver",
    "passenger",
    "suspect",
    "woman",
    "man",
    "car",
    "sedan",
    "cruiser",
    "patrol car",
    "wreck",
    "flames",
    "fire",
    "bridge",
    "door",
    "handcuffs",
    "taser",
    "trapped",
    "rolling",
    "stopped",
    "reaches",
    "pulls",
    "runs",
    "turns"
  ];

  for (const phrase of phraseCandidates) {
    if (next.bottom.length >= 5) {
      break;
    }
    addHighlight(next.bottom, input.bottomText, phrase);
  }
  next.bottom.sort((a, b) => a.start - b.start);
  return next;
}

export function getCopscopesStage2WinnerHighlights(stage2: Stage2Response): TemplateCaptionHighlights {
  const output = stage2.output;
  const option = output.winner?.option ?? output.finalPick.option;
  const story = output.storyOptions?.find((candidate) => candidate.option === option) ?? output.storyOptions?.[0] ?? null;
  const classic =
    output.classicOptions?.find((candidate) => candidate.option === option) ??
    output.captionOptions.find((candidate) => candidate.option === option) ??
    output.classicOptions?.[0] ??
    output.captionOptions[0] ??
    null;
  return cloneTemplateCaptionHighlights(story?.highlights ?? classic?.highlights ?? null);
}

export type CopscopesRenderGateResult = {
  passed: boolean;
  reasons: string[];
};

export function validateCopscopesRenderBodyForPublication(
  body: Pick<
    Stage3RenderRequestBody,
    "topText" | "bottomText" | "clipDurationSec" | "renderPlan" | "snapshot" | "publishAfterRender"
  >
): CopscopesRenderGateResult {
  const snapshot = body.snapshot as Partial<Stage3StateSnapshot> | undefined;
  const renderPlan = snapshot?.renderPlan ?? body.renderPlan ?? null;
  const bottomText = (snapshot?.bottomText ?? body.bottomText ?? "").replace(/\s+/g, " ").trim();
  const clipDurationSec =
    typeof snapshot?.clipDurationSec === "number" && Number.isFinite(snapshot.clipDurationSec)
      ? snapshot.clipDurationSec
      : typeof body.clipDurationSec === "number" && Number.isFinite(body.clipDurationSec)
        ? body.clipDurationSec
        : null;
  const crop = normalizeStage3SourceCrop(renderPlan?.sourceCrop ?? null, null);
  const focusY =
    typeof snapshot?.focusY === "number" && Number.isFinite(snapshot.focusY)
      ? snapshot.focusY
      : null;
  const videoZoom =
    typeof renderPlan?.videoZoom === "number" && Number.isFinite(renderPlan.videoZoom)
      ? renderPlan.videoZoom
      : null;
  const highlights = ensureCopscopesCaptionHighlights({
    topText: snapshot?.topText ?? body.topText ?? "",
    bottomText,
    highlights: snapshot?.captionHighlights ?? null
  });
  const reasons: string[] = [];

  if (!renderPlan?.avatarAssetId) {
    reasons.push("missing_channel_avatar_asset");
  }
  if (bottomText.length < COPSCOPES_MIN_MAIN_CAPTION_CHARS) {
    reasons.push(`main_caption_too_short:${bottomText.length}`);
  }
  if (bottomText.length > COPSCOPES_MAX_MAIN_CAPTION_CHARS) {
    reasons.push(`main_caption_too_long:${bottomText.length}`);
  }
  if (!isCopscopesTightSourceCrop(crop)) {
    reasons.push("source_crop_not_tight_enough");
    if (crop?.enabled && crop.height < COPSCOPES_MIN_CROP_HEIGHT) {
      reasons.push("source_crop_too_narrow_for_readability");
    }
    if (crop?.enabled && crop.y + crop.height > COPSCOPES_MAX_CROP_BOTTOM) {
      reasons.push("source_crop_extends_into_lower_meta");
    }
  }
  if (videoZoom === null || videoZoom < COPSCOPES_MIN_VIDEO_ZOOM) {
    reasons.push("source_window_not_safely_zoomed");
  }
  if (videoZoom !== null && videoZoom > COPSCOPES_MAX_VIDEO_ZOOM) {
    reasons.push("source_window_overzoomed");
  }
  if (focusY === null || focusY > COPSCOPES_MAX_FOCUS_Y) {
    reasons.push("source_window_not_lifted_above_lower_meta");
  }
  if (renderPlan?.mirrorEnabled !== false) {
    reasons.push("source_window_mirror_must_be_disabled");
  }
  if (highlights.bottom.length < 2) {
    reasons.push("missing_yellow_caption_highlights");
  }
  const sourceDurationSec =
    typeof snapshot?.sourceDurationSec === "number" && Number.isFinite(snapshot.sourceDurationSec)
      ? snapshot.sourceDurationSec
      : null;
  if (renderPlan?.durationMode === "source_full") {
    const expectedDurationSec =
      sourceDurationSec ??
      (typeof renderPlan.targetDurationSec === "number" && Number.isFinite(renderPlan.targetDurationSec)
        ? renderPlan.targetDurationSec
        : null);
    if (
      clipDurationSec === null ||
      expectedDurationSec === null ||
      Math.abs(clipDurationSec - expectedDurationSec) > 0.05
    ) {
      reasons.push("duration_not_matching_full_source");
    }
  } else if (clipDurationSec === null || Math.abs(clipDurationSec - DEFAULT_STAGE3_CLIP_DURATION_SEC) > 0.05) {
    reasons.push("duration_not_exactly_6_seconds");
  }

  return {
    passed: reasons.length === 0,
    reasons
  };
}
