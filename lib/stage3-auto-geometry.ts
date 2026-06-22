// Deterministic, server-side geometry resolution for a Stage 3 render.
//
// The owner-correct behaviour for "no black bars" already lives in two pure
// engines that, until now, were never invoked in the render path:
//   - `detectSourceContentRect` (stage3-source-content-detect): cropdetect the
//     real inner-content rectangle so baked-in donor letterbox/pillarbox is
//     stripped via sourceCrop;
//   - `resolveStage3AspectFit` (stage3-aspect-fit): given the content aspect and
//     the template media slot, decide HOW to fill it with no bars — shrink the
//     media-region height for content WIDER than the slot (Option A: the card
//     gets shorter, the bottom panel rides up), or zoom-to-fill / slight stretch
//     for content NARROWER than the slot.
//
// This module composes those two engines plus source probing into ONE resolver
// that returns a renderPlan patch. It is computed ONCE, cloud-side, from the
// cached source, and merged into non-authoritative render plans before BOTH the
// headless preview and the final render. Once the editor has already supplied a
// live-preview snapshot, that snapshot wins: render must not add hidden geometry
// that the editor never showed. The Stage 3 worker stays a pure consumer of
// `mediaRegionHeightPx` / `videoScaleX` / `sourceCrop` / `videoFit` (already
// plumbed), so nothing new is vendored to it.

import {
  DEFAULT_STAGE3_ASPECT_FIT_CAPS,
  resolveStage3AspectFit,
  type Stage3AspectFitCaps,
  type Stage3AspectFitDecision
} from "./stage3-aspect-fit";
import {
  detectSourceContentRect,
  type DetectedSourceContent
} from "./stage3-source-content-detect";
import { computeManagedTemplateTextFit } from "./managed-template-runtime";
import type { Stage3TemplateConfig } from "./stage3-template";
import type { Stage3RenderPlan } from "./stage3-agent";
import type { Stage3SourceCrop } from "../app/components/types";
import { isChannelStoryLowerSourceStripCrop } from "./stage3-source-crop";

export type Stage3AutoGeometryPatch = {
  mediaRegionHeightPx?: number;
  videoScaleX?: number;
  videoScaleY?: number;
  videoFit?: "cover" | "contain";
  sourceCrop?: Stage3SourceCrop;
};

export type Stage3AutoGeometryResult = {
  patch: Stage3AutoGeometryPatch;
  decision: Stage3AspectFitDecision;
  detected: DetectedSourceContent;
  sourceWidthPx: number;
  sourceHeightPx: number;
  contentAspect: number;
  slotWidthPx: number;
  slotHeightPx: number;
  // True when the deterministic fit hit a quality boundary the vision judge
  // should be allowed to veto (floor-clamped region height, or an over-cap cover
  // crop). The baseline still renders without bars; this just flags it.
  escalateToJudge: boolean;
  escalationReason: string | null;
  source: "deterministic";
};

export function shouldApplyStage3AutoGeometryBaseline(params: {
  hasAuthoritativeSnapshot?: boolean;
  sourceCrop?: unknown;
}): boolean {
  if (params.hasAuthoritativeSnapshot !== true) {
    return true;
  }
  return isChannelStoryLowerSourceStripCrop(params.sourceCrop);
}

type ProbeDimensions = (sourcePath: string) => Promise<{ width: number; height: number } | null>;
type DetectContentRect = typeof detectSourceContentRect;

type NormalizedCrop = { x: number; y: number; width: number; height: number };

// The content remotion fits into the media slot is the source AFTER sourceCrop is
// applied (ffmpeg extracts the inner region first), so the aspect that drives the
// fit is the CROP region's aspect, not the full frame's. A non-full agent crop is
// authoritative; a full-frame crop (0,0,1,1) means "no wrapper crop", so we fall
// back to cropdetect to catch baked-in letterbox/pillarbox.
function normalizeAgentCrop(value: unknown): NormalizedCrop | null {
  if (isChannelStoryLowerSourceStripCrop(value)) {
    return null;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const c = value as { enabled?: unknown; x?: unknown; y?: unknown; width?: unknown; height?: unknown };
  if (c.enabled === false) {
    return null;
  }
  const width = typeof c.width === "number" ? c.width : NaN;
  const height = typeof c.height === "number" ? c.height : NaN;
  if (!(width > 0 && width <= 1) || !(height > 0 && height <= 1)) {
    return null;
  }
  if (width >= 0.999 && height >= 0.999) {
    return null;
  }
  return {
    x: typeof c.x === "number" ? c.x : 0,
    y: typeof c.y === "number" ? c.y : 0,
    width,
    height
  };
}

async function defaultProbeDimensions(sourcePath: string): Promise<{ width: number; height: number } | null> {
  // Lazy import keeps this module (and its unit tests, which inject stubs) free
  // of stage3-media-agent's heavy transitive graph at load time.
  const { probeVideoDimensions } = await import("./stage3-media-agent");
  return probeVideoDimensions(sourcePath);
}

/**
 * Resolve the deterministic geometry patch for a source against a template media
 * slot. Returns `null` (never blocks the render) when the source dimensions are
 * unprobeable or the slot is degenerate; the caller then keeps whatever the
 * render plan already carries.
 */
export async function resolveStage3AutoGeometry(params: {
  sourcePath: string;
  slotWidthPx: number;
  slotHeightPx: number;
  sourceCrop?: unknown;
  caps?: Partial<Stage3AspectFitCaps>;
  probeDimensions?: ProbeDimensions;
  detectContentRect?: DetectContentRect;
}): Promise<Stage3AutoGeometryResult | null> {
  if (!(params.slotWidthPx > 0) || !(params.slotHeightPx > 0)) {
    return null;
  }
  const probe = params.probeDimensions ?? defaultProbeDimensions;
  const dims = await probe(params.sourcePath);
  if (!dims || !(dims.width > 0) || !(dims.height > 0)) {
    return null;
  }

  // The effective content region = the agent's wrapper crop when it supplied one;
  // otherwise cropdetect's baked-in-bar rectangle; otherwise the full frame.
  const replaceableChannelStoryFallbackCrop = isChannelStoryLowerSourceStripCrop(params.sourceCrop);
  const agentCrop = normalizeAgentCrop(params.sourceCrop);
  let detected: DetectedSourceContent = { rect: null, hasBars: false, pixelCrop: null };
  let cropWidthFrac = 1;
  let cropHeightFrac = 1;
  if (agentCrop) {
    cropWidthFrac = agentCrop.width;
    cropHeightFrac = agentCrop.height;
  } else {
    const detect = params.detectContentRect ?? detectSourceContentRect;
    detected = await detect({
      sourcePath: params.sourcePath,
      sourceWidth: dims.width,
      sourceHeight: dims.height,
      detectSparseOverlayWrapper: replaceableChannelStoryFallbackCrop
    });
    if (detected.hasBars && detected.rect) {
      cropWidthFrac = detected.rect.width;
      cropHeightFrac = detected.rect.height;
    }
  }

  // Aspect of the REAL inner content fed to the slot, after the crop is applied.
  const contentWidthPx = Math.max(1, cropWidthFrac * dims.width);
  const contentHeightPx = Math.max(1, cropHeightFrac * dims.height);
  const contentAspect = contentWidthPx / contentHeightPx;

  const caps = { ...DEFAULT_STAGE3_ASPECT_FIT_CAPS, ...(params.caps ?? {}) };
  const decision = resolveStage3AspectFit({
    contentAspect,
    regionWidthPx: params.slotWidthPx,
    regionHeightPx: params.slotHeightPx,
    caps
  });

  const patch: Stage3AutoGeometryPatch = { ...decision.patch };
  // Only contribute a sourceCrop when the agent did NOT supply one (mergeAutoGeometry
  // keeps the agent's anyway); cropdetect strips baked-in bars in that fallback case.
  if (!agentCrop && detected.hasBars && detected.rect) {
    patch.sourceCrop = {
      enabled: true,
      x: detected.rect.x,
      y: detected.rect.y,
      width: detected.rect.width,
      height: detected.rect.height,
      confidence: null,
      source: "auto-aspect-fit"
    };
  }

  let escalateToJudge = false;
  let escalationReason: string | null = null;
  if (decision.mode === "region_height" && typeof decision.patch.mediaRegionHeightPx === "number") {
    const floor = params.slotHeightPx * caps.minRegionHeightFraction;
    if (decision.patch.mediaRegionHeightPx <= floor + 1) {
      escalateToJudge = true;
      escalationReason = `media region height floor-clamped to ${decision.patch.mediaRegionHeightPx}px (content aspect ${contentAspect.toFixed(2)} very wide)`;
    }
  } else if (
    decision.mode === "zoom" &&
    typeof decision.estimatedCoverCropFraction === "number" &&
    decision.estimatedCoverCropFraction > caps.maxCoverCrop
  ) {
    escalateToJudge = true;
    escalationReason = `cover crops ~${Math.round(decision.estimatedCoverCropFraction * 100)}% (over cap ${Math.round(caps.maxCoverCrop * 100)}%)`;
  }

  return {
    patch,
    decision,
    detected,
    sourceWidthPx: dims.width,
    sourceHeightPx: dims.height,
    contentAspect,
    slotWidthPx: params.slotWidthPx,
    slotHeightPx: params.slotHeightPx,
    escalateToJudge,
    escalationReason,
    source: "deterministic"
  };
}

/**
 * Merge a deterministic geometry patch into a raw render plan as a BASELINE: each
 * field is filled from the patch ONLY when the caller (agent/judge) did not set
 * it. An explicit agent override always wins. The merged raw plan still flows
 * through `normalizeRenderPlan`, so every value is clamped exactly as before.
 */
export function mergeAutoGeometry(
  rawPlan: Partial<Stage3RenderPlan> | null | undefined,
  patch: Stage3AutoGeometryPatch | null | undefined
): Partial<Stage3RenderPlan> {
  const base: Partial<Stage3RenderPlan> = { ...(rawPlan ?? {}) };
  if (!patch) {
    return base;
  }
  const isUnset = (value: unknown): boolean => value === undefined || value === null;
  if (isUnset(base.mediaRegionHeightPx) && typeof patch.mediaRegionHeightPx === "number") {
    base.mediaRegionHeightPx = patch.mediaRegionHeightPx;
  }
  if (isUnset(base.videoScaleX) && typeof patch.videoScaleX === "number") {
    base.videoScaleX = patch.videoScaleX;
  }
  if (isUnset(base.videoScaleY) && typeof patch.videoScaleY === "number") {
    base.videoScaleY = patch.videoScaleY;
  }
  if (isUnset(base.videoFit) && patch.videoFit) {
    base.videoFit = patch.videoFit;
  }
  if ((isUnset(base.sourceCrop) || isChannelStoryLowerSourceStripCrop(base.sourceCrop)) && patch.sourceCrop) {
    base.sourceCrop = patch.sourceCrop;
  }
  return base;
}

export function selectStage3AutoGeometryPatch(params: {
  patch: Stage3AutoGeometryPatch | null | undefined;
  hasAuthoritativeSnapshot?: boolean;
  sourceCrop?: unknown;
}): Stage3AutoGeometryPatch | null {
  if (!params.patch) {
    return null;
  }
  if (params.hasAuthoritativeSnapshot === true && isChannelStoryLowerSourceStripCrop(params.sourceCrop)) {
    return params.patch.sourceCrop ? { sourceCrop: params.patch.sourceCrop } : null;
  }
  return params.patch;
}

/** Template media-slot dimensions (the region the source video fills). */
export function resolveTemplateMediaSlot(input: {
  templateId: string;
  topText: string;
  bottomText: string;
  topFontScale?: number;
  bottomFontScale?: number;
  templateConfigOverride?: Stage3TemplateConfig;
}): { slotWidthPx: number; slotHeightPx: number } {
  const computed = computeManagedTemplateTextFit(input);
  return { slotWidthPx: computed.videoWidth, slotHeightPx: computed.videoHeight };
}
