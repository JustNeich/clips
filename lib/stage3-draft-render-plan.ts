import { Stage3RenderPlan } from "../app/components/types";

const STAGE3_DRAFT_RENDER_PLAN_OVERRIDE_KEYS = [
  "timingMode",
  "audioMode",
  "sourceAudioEnabled",
  "smoothSlowMo",
  "mirrorEnabled",
  "cameraMotion",
  "videoZoom",
  "topFontScale",
  "bottomFontScale",
  "musicGain",
  "textPolicy",
  "segments",
  "policy",
  "backgroundAssetId",
  "backgroundAssetMimeType",
  "musicAssetId",
  "musicAssetMimeType"
] as const;

export type Stage3DraftRenderPlanOverride = Partial<
  Pick<Stage3RenderPlan, (typeof STAGE3_DRAFT_RENDER_PLAN_OVERRIDE_KEYS)[number]>
>;

function areRenderPlanValuesEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  }
  return left === right;
}

export function sanitizeStage3DraftRenderPlanOverride(value: unknown): Stage3DraftRenderPlanOverride | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const sanitized: Stage3DraftRenderPlanOverride = {};

  for (const key of STAGE3_DRAFT_RENDER_PLAN_OVERRIDE_KEYS) {
    if (!(key in candidate)) {
      continue;
    }
    sanitized[key] = candidate[key] as never;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

export function buildStage3DraftRenderPlanOverride(
  current: Stage3RenderPlan,
  base: Stage3RenderPlan
): Stage3DraftRenderPlanOverride | null {
  const override: Stage3DraftRenderPlanOverride = {};

  for (const key of STAGE3_DRAFT_RENDER_PLAN_OVERRIDE_KEYS) {
    const currentValue = current[key];
    const baseValue = base[key];
    if (areRenderPlanValuesEqual(currentValue, baseValue)) {
      continue;
    }
    override[key] = currentValue as never;
  }

  return Object.keys(override).length > 0 ? override : null;
}
