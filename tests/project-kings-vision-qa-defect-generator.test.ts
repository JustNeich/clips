import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  VISION_QA_CONTROLLED_DEFECTS,
  buildVisionQaDefectPlan,
  generateVisionQaDefectVariant,
  verifyVisionQaDefectRecipeManifest,
  type EligibleVisionQaCleanBase
} from "../lib/project-kings/vision-qa-defect-generator";

const execFileAsync = promisify(execFile);

function sha(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

test("controlled defect plan covers every required technical and visible defect without label paths", () => {
  assert.deepEqual(VISION_QA_CONTROLLED_DEFECTS, [
    "corrupt_mux", "flash_frame", "wrong_template", "lost_audio", "wrong_resolution",
    "donor_ui", "cta", "handle", "watermark", "foreign_captions", "banned_word",
    "unsafe_crop", "main_event_lost"
  ]);
  for (const defect of VISION_QA_CONTROLLED_DEFECTS) {
    const plan = buildVisionQaDefectPlan({
      defect,
      fontPath: "/opaque/font.ttf",
      bannedWord: "subscribe"
    });
    assert.ok(Object.keys(plan.parameters).length > 0);
    if (!["corrupt_mux", "lost_audio"].includes(defect)) assert.ok(plan.videoFilter || plan.bitmapOverlay);
  }
  assert.throws(
    () => buildVisionQaDefectPlan({ defect: "banned_word", fontPath: "/opaque/font.ttf" }),
    /requires a bounded bannedWord/
  );
});

test("generator seals opaque, hash-bound variants and verifies deterministic injections", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qa-variant-contract-"));
  try {
    const basePath = path.join(root, "base.mp4");
    await execFileAsync("ffmpeg", [
      "-nostdin", "-v", "error",
      "-f", "lavfi", "-i", "color=c=0x204060:s=320x568:r=25:d=1.2",
      "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=44100:duration=1.2",
      "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", basePath
    ], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    const baseBytes = await fs.readFile(basePath);
    const base: EligibleVisionQaCleanBase = {
      sourceAuditEvidenceSha256: "9".repeat(64),
      campaignManifestSha256: "a".repeat(64),
      runId: "shadow-run-01",
      productionItemId: "shadow-item-01",
      productionItemState: "final_approved",
      artifactPath: basePath,
      artifactSha256: sha(baseBytes),
      deterministicFinalPassBound: true,
      visionFinalPassBound: true,
      derivedFinalPass: true
    };
    const outputRoot = path.join(root, "output");
    const manifests = [];
    for (const defect of VISION_QA_CONTROLLED_DEFECTS) {
      const manifest = await generateVisionQaDefectVariant({
        base,
        defect,
        outputRoot,
        bannedWord: "subscribe",
        createdAt: "2026-07-10T15:00:00.000Z"
      });
      verifyVisionQaDefectRecipeManifest(manifest);
      assert.equal(manifest.probe.injectionObserved, true);
      assert.equal(
        manifest.probe.status,
        ["unsafe_crop", "main_event_lost"].includes(defect) ? "requires_vision" : "verified"
      );
      assert.doesNotMatch(manifest.blindArtifact.relativePath, new RegExp(defect));
      assert.equal(manifest.blindArtifact.relativePath.startsWith("blind-artifacts"), true);
      manifests.push(manifest);
    }
    assert.deepEqual(manifests.map((manifest) => manifest.probe.probeKind), [
      "decode_failure", "flash_pixel", "marker_pixel", "audio_absent", "resolution_mismatch",
      "marker_pixel", "marker_pixel", "marker_pixel", "marker_pixel", "marker_pixel", "marker_pixel",
      "geometry_transform", "geometry_transform"
    ]);
    const repeated = await generateVisionQaDefectVariant({
      base,
      defect: "lost_audio",
      outputRoot,
      bannedWord: "subscribe",
      createdAt: "2030-01-01T00:00:00.000Z"
    });
    assert.equal(repeated.manifestSha256, manifests.find((manifest) => manifest.defect === "lost_audio")!.manifestSha256);
    assert.equal(repeated.createdAt, "2026-07-10T15:00:00.000Z");

    const recipeFiles = await fs.readdir(path.join(outputRoot, "sealed-recipes"));
    const blindFiles = await fs.readdir(path.join(outputRoot, "blind-artifacts"));
    assert.equal(recipeFiles.length, VISION_QA_CONTROLLED_DEFECTS.length);
    assert.equal(blindFiles.length, VISION_QA_CONTROLLED_DEFECTS.length);
    assert.equal(blindFiles.every((file) => /^[a-f0-9]{32}\.mp4$/.test(file)), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("generator rejects an unapproved base instead of manufacturing corpus eligibility", async () => {
  const invalid = {
    sourceAuditEvidenceSha256: "9".repeat(64),
    campaignManifestSha256: "a".repeat(64),
    runId: "run",
    productionItemId: "item",
    productionItemState: "final_approved",
    artifactPath: "/missing.mp4",
    artifactSha256: "b".repeat(64),
    deterministicFinalPassBound: true,
    visionFinalPassBound: false,
    derivedFinalPass: false
  } as unknown as EligibleVisionQaCleanBase;
  await assert.rejects(
    () => generateVisionQaDefectVariant({ base: invalid, defect: "corrupt_mux", outputRoot: os.tmpdir() }),
    /requires an exact final_approved base/
  );
});
