import { createHash } from "node:crypto";

export const PROJECT_KINGS_QUALITY_POLICY_VERSION =
  "project-kings-production-quality-policy-v1" as const;
export const PROJECT_KINGS_QUALITY_POLICY_ID = "project-kings-quality-v1" as const;

export const PROJECT_KINGS_PRODUCTION_QUALITY_POLICY = Object.freeze({
  policyVersion: PROJECT_KINGS_QUALITY_POLICY_VERSION,
  policyId: PROJECT_KINGS_QUALITY_POLICY_ID,
  approvalBinding: Object.freeze({
    requiredFields: Object.freeze([
      "channelId",
      "sourceSha256",
      "previewSha256",
      "templateSha256",
      "settingsSha256"
    ]),
    staleApprovalDisposition: "fail"
  }),
  deterministicFinalArtifact: Object.freeze({
    fullDecodeRequired: true,
    allowedContainers: Object.freeze(["mp4", "mov"]),
    videoCodec: "h264",
    exactProfileResolutionRequired: true,
    exactPlannedDurationRequired: true,
    durationToleranceSec: 0.25,
    audioRequired: true,
    blankFlashFramesAllowed: 0
  }),
  independentVisionQa: Object.freeze({
    requiredForPreview: true,
    requiredForFinalArtifact: true,
    exactChannelAndTemplateRequired: true,
    conceptMatchRequired: true,
    uniqueVideoAndEventRequired: true,
    narrativeRequired: Object.freeze(["hook", "action", "payoff"]),
    prohibitedVisibleElements: Object.freeze([
      "donor_ui",
      "cta",
      "handle",
      "watermark",
      "foreign_captions"
    ]),
    mainEventAndSafeCropRequired: true,
    factualClaimsVerifiedRequired: true,
    bannedWordsAllowed: false,
    deterministicDisagreementDisposition: "fail"
  }),
  revisions: Object.freeze({
    maximumTotalAttempts: 5,
    maximumVisualRevisions: 3,
    deterministicTextRepairAttempts: 1,
    targetedTextRegenerationAttempts: 1,
    exhaustedDisposition: "replace_source",
    unsafeSourceDisposition: "quarantine_source"
  })
} as const);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

export function hashProjectKingsProductionQualityPolicy(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

// Frozen literal: every material rule edit requires a new policy version and
// an explicitly reviewed profile snapshot instead of silently reusing approval.
export const PROJECT_KINGS_QUALITY_POLICY_SHA256 =
  "0351589b610bdb7f3175190d4b9135858b6bbb0aee18c4b63bb51d9ab4357726" as const;

const calculatedQualityPolicySha256 = hashProjectKingsProductionQualityPolicy(
  PROJECT_KINGS_PRODUCTION_QUALITY_POLICY
);
if (calculatedQualityPolicySha256 !== PROJECT_KINGS_QUALITY_POLICY_SHA256) {
  throw new Error(
    "Project Kings quality policy hash mismatch: " +
      `expected ${PROJECT_KINGS_QUALITY_POLICY_SHA256}, calculated ${calculatedQualityPolicySha256}`
  );
}
