import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProductionArtifactBindingSha256,
  decideProductionRevision,
  evaluateProductionQualityGate,
  type FinalMp4Probe,
  type ProductionArtifactBinding,
  type ProductionVisionVerdict
} from "../lib/production-quality-gate";
import {
  PROJECT_KINGS_PRODUCTION_QUALITY_POLICY,
  PROJECT_KINGS_QUALITY_POLICY_SHA256,
  hashProjectKingsProductionQualityPolicy
} from "../lib/project-kings/production-quality-policy";

const binding: ProductionArtifactBinding = {
  channelId: "channel-dark",
  sourceSha256: "source-sha",
  previewSha256: "preview-sha",
  templateSha256: "template-sha",
  settingsSha256: "settings-sha"
};

const cleanProbe: FinalMp4Probe = {
  artifactSha256: "final-sha",
  fullyDecodable: true,
  decodeError: null,
  container: "mov,mp4,m4a,3gp,3g2,mj2",
  videoCodec: "h264",
  width: 1080,
  height: 1920,
  durationSec: 30,
  audioStreamCount: 1,
  flashFrameIndexes: []
};

const cleanVision: ProductionVisionVerdict = {
  decision: "PASS",
  channelId: binding.channelId,
  templateSha256: binding.templateSha256,
  conceptMatch: true,
  duplicateVideo: false,
  duplicateEvent: false,
  hookPresent: true,
  actionPresent: true,
  payoffPresent: true,
  donorUiVisible: false,
  ctaVisible: false,
  handleVisible: false,
  watermarkVisible: false,
  foreignCaptionsVisible: false,
  mainEventPreserved: true,
  cropSafe: true,
  factualClaimsVerified: true,
  bannedWordsPresent: false,
  defects: []
};

function evaluate(overrides: {
  approval?: string;
  probe?: FinalMp4Probe;
  vision?: ProductionVisionVerdict;
} = {}) {
  return evaluateProductionQualityGate({
    binding,
    recordedApprovalBindingSha256:
      overrides.approval ?? buildProductionArtifactBindingSha256(binding),
    finalProbe: overrides.probe ?? cleanProbe,
    finalExpectations: {
      width: 1080,
      height: 1920,
      durationSec: 30,
      artifactSha256: "final-sha"
    },
    vision: overrides.vision ?? cleanVision
  });
}

test("quality policy has one frozen hash and any rule drift changes it", () => {
  assert.equal(
    hashProjectKingsProductionQualityPolicy(PROJECT_KINGS_PRODUCTION_QUALITY_POLICY),
    PROJECT_KINGS_QUALITY_POLICY_SHA256
  );
  assert.notEqual(
    hashProjectKingsProductionQualityPolicy({
      ...PROJECT_KINGS_PRODUCTION_QUALITY_POLICY,
      revisions: {
        ...PROJECT_KINGS_PRODUCTION_QUALITY_POLICY.revisions,
        maximumVisualRevisions: 4
      }
    }),
    PROJECT_KINGS_QUALITY_POLICY_SHA256
  );
});

test("quality gate passes only when technical, hash-bound and vision checks pass", () => {
  const verdict = evaluate();
  assert.equal(verdict.decision, "PASS");
  assert.equal(verdict.deterministicPass, true);
  assert.equal(verdict.visionPass, true);
  assert.deepEqual(verdict.deterministicDefects, []);
  assert.deepEqual(verdict.visionDefects, []);
  assert.deepEqual(verdict.defects, []);
});

test("stale preview approval fails closed", () => {
  const verdict = evaluate({ approval: "old-binding" });
  assert.equal(verdict.decision, "FAIL");
  assert.ok(verdict.deterministicDefects.some((defect) => defect.code === "preview_approval_stale"));
  assert.deepEqual(verdict.visionDefects, []);
  assert.ok(verdict.defects.some((defect) => defect.code === "preview_approval_stale"));
});

test("corrupt mux, wrong resolution, missing audio and flash frames are all retained", () => {
  const verdict = evaluate({
    probe: {
      ...cleanProbe,
      fullyDecodable: false,
      decodeError: "invalid NAL",
      width: 720,
      height: 1280,
      audioStreamCount: 0,
      flashFrameIndexes: [0, 91]
    }
  });
  assert.equal(verdict.decision, "FAIL");
  assert.ok(verdict.deterministicDefects.some((defect) => defect.code === "corrupt_mp4"));
  assert.deepEqual(verdict.visionDefects, []);
  assert.deepEqual(
    new Set(verdict.defects.map((defect) => defect.code)),
    new Set([
      "corrupt_mp4",
      "wrong_resolution",
      "missing_audio",
      "flash_frame",
      "vision_deterministic_disagreement"
    ])
  );
});

test("vision PASS cannot overrule donor UI or a lost main event", () => {
  const verdict = evaluate({
    vision: {
      ...cleanVision,
      decision: "PASS",
      donorUiVisible: true,
      mainEventPreserved: false
    }
  });
  assert.equal(verdict.decision, "FAIL");
  assert.ok(verdict.defects.some((defect) => defect.code === "donor_ui"));
  assert.ok(verdict.defects.some((defect) => defect.code === "main_event_lost"));
});

test("wrong channel or template is critical even when vision says PASS", () => {
  const verdict = evaluate({
    vision: {
      ...cleanVision,
      channelId: "channel-light",
      templateSha256: "different-template"
    }
  });
  assert.equal(verdict.decision, "FAIL");
  assert.ok(verdict.defects.some((defect) => defect.code === "wrong_channel"));
  assert.ok(verdict.defects.some((defect) => defect.code === "wrong_template"));
});

test("revision policy is bounded and quarantines unsafe sources", () => {
  assert.equal(
    decideProductionRevision({
      defects: [{ code: "watermark", severity: "critical", message: "visible" }],
      totalAttempts: 1,
      textAttempts: 0,
      visualAttempts: 0
    }).action,
    "quarantine_source"
  );
  assert.equal(
    decideProductionRevision({
      defects: [{ code: "unsafe_crop", severity: "critical", message: "lost action" }],
      totalAttempts: 2,
      textAttempts: 0,
      visualAttempts: 2
    }).action,
    "targeted_visual_revision"
  );
  assert.equal(
    decideProductionRevision({
      defects: [{ code: "unsafe_crop", severity: "critical", message: "lost action" }],
      totalAttempts: 3,
      textAttempts: 0,
      visualAttempts: 3
    }).action,
    "replace_source"
  );
});
