export const STAGE3_TEXT_SCALE_UI_MIN = 0.85;
export const STAGE3_TEXT_SCALE_UI_MAX = 1.35;
export const STAGE3_TEXT_SCALE_UI_PRESETS = [0.9, 1, 1.15, 1.3] as const;

type Stage3TextFitHashParams = {
  templateId: string;
  snapshotHash: string;
  topText: string;
  bottomText: string;
  topFontScale: number;
  bottomFontScale: number;
};

type Stage3TextFitSnapshotShape = {
  topFontPx: number;
  bottomFontPx: number;
  topLineHeight?: number;
  bottomLineHeight?: number;
  topLines?: number;
  bottomLines?: number;
  topCompacted: boolean;
  bottomCompacted: boolean;
};

type Stage3TemplateTextFitPolicy = {
  revision: string;
  topFillTargetMin: number;
  topFillTargetMax: number;
  topLineHeightFloor: number;
  topLineHeightCeil: number;
  bottomFillTargetMin: number;
  bottomFillTargetMax: number;
  bottomLineHeightFloor: number;
  bottomLineHeightCeil: number;
};

const DEFAULT_TEXT_FIT_POLICY: Stage3TemplateTextFitPolicy = {
  revision: "fit-policy-v1",
  topFillTargetMin: 0.88,
  topFillTargetMax: 0.94,
  topLineHeightFloor: 0.9,
  topLineHeightCeil: 1.12,
  bottomFillTargetMin: 0.84,
  bottomFillTargetMax: 0.9,
  bottomLineHeightFloor: 0.92,
  bottomLineHeightCeil: 1.12
};

const SCIENCE_CARD_V1_TEXT_FIT_POLICY: Stage3TemplateTextFitPolicy = {
  revision: "science-card-v1-fit-v2",
  topFillTargetMin: 0.94,
  topFillTargetMax: 0.99,
  topLineHeightFloor: 0.99,
  topLineHeightCeil: 1.04,
  bottomFillTargetMin: 0.8,
  bottomFillTargetMax: 0.9,
  bottomLineHeightFloor: 0.96,
  bottomLineHeightCeil: 1.12
};

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `f${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clampStage3TextScaleUi(value: number): number {
  return clamp(value, STAGE3_TEXT_SCALE_UI_MIN, STAGE3_TEXT_SCALE_UI_MAX);
}

export function getStage3TemplateTextFitPolicy(templateId: string): Stage3TemplateTextFitPolicy {
  if (templateId === "science-card-v1") {
    return SCIENCE_CARD_V1_TEXT_FIT_POLICY;
  }
  return DEFAULT_TEXT_FIT_POLICY;
}

export function buildStage3TextFitHash(params: Stage3TextFitHashParams): string {
  const policy = getStage3TemplateTextFitPolicy(params.templateId);
  return stableHash(
    JSON.stringify({
      version: "stage3-fit-hash-v1",
      templateId: params.templateId,
      snapshotHash: params.snapshotHash,
      topText: params.topText,
      bottomText: params.bottomText,
      topFontScale: clampStage3TextScaleUi(params.topFontScale),
      bottomFontScale: clampStage3TextScaleUi(params.bottomFontScale),
      policyRevision: policy.revision
    })
  );
}

export function createStage3TextFitSnapshot(
  identity: Stage3TextFitHashParams,
  fit: Stage3TextFitSnapshotShape
) {
  return {
    ...fit,
    snapshotHash: identity.snapshotHash,
    fitHash: buildStage3TextFitHash(identity)
  };
}
