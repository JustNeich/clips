import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  VISION_QA_REQUIRED_APPROVED_BASES,
  VisionQaCorpusBuildBlockedError,
  assertVisionQaCorpusBuildReady,
  auditVisionQaCorpusSourceInventory,
  createVisionQaCorpusCampaignManifest,
  hasExplicitVisionQaSourceApproval,
  hasLayoutAwareVisionQaSourceCrop,
  verifyVisionQaCorpusCampaignManifest,
  verifyVisionQaCorpusSourceAuditEvidence,
  writeVisionQaCorpusSourceAudit,
  type VisionQaArtifactInspection
} from "../lib/project-kings/vision-qa-corpus-builder";
import { selectEligibleVisionQaCleanBasesFromAudit } from "../lib/project-kings/vision-qa-defect-generator";
import { COPSCOPES_PROJECT_KINGS_PROFILE } from "../lib/project-kings/copscopes-production-profile";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function sha(value: Buffer | string | unknown): string {
  const payload = Buffer.isBuffer(value) || typeof value === "string"
    ? value
    : JSON.stringify(canonicalize(value));
  return createHash("sha256").update(payload).digest("hex");
}

function explicitApprovalSnapshot(): Record<string, unknown> {
  return {
    renderPlan: {
      templateId: "managed-template",
      sourceCrop: { enabled: true, x: 0, y: 0.1, width: 1, height: 0.8 }
    },
    managedTemplateState: {
      managedId: "managed-template",
      templateConfig: {
        layoutKind: "classic_top_bottom",
        frame: { width: 1080, height: 1920 },
        card: { height: 1700 },
        slot: { topHeight: 300, bottomHeight: 400 }
      }
    },
    zoroKingApproval: {
      status: "approved",
      judgeVerdict: "approved",
      innerVideoOnly: true,
      donorWrapperVisible: false,
      previewFrames: ["frame-01.jpg"]
    }
  };
}

test("source crop approval is bound to the exact template layout", () => {
  const approved = explicitApprovalSnapshot();
  assert.equal(hasLayoutAwareVisionQaSourceCrop(approved), true);
  assert.equal(hasExplicitVisionQaSourceApproval(approved), true);
  assert.equal(hasLayoutAwareVisionQaSourceCrop({
    ...approved,
    managedTemplateState: {
      ...(approved.managedTemplateState as Record<string, unknown>),
      managedId: "another-template"
    }
  }), false);
  assert.equal(hasLayoutAwareVisionQaSourceCrop({
    ...approved,
    renderPlan: {
      templateId: "managed-template",
      sourceCrop: { enabled: true, x: 0.8, y: 0, width: 0.5, height: 1 }
    }
  }), false);
});

test("campaign-scoped audit accepts only exact final_approved items with derived persisted final PASS", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vision-qa-corpus-builder-"));
  try {
    const renderDirectory = path.join(root, ".data/render-exports");
    const evidenceDirectory = path.join(root, ".data/quality-evidence");
    await fs.mkdir(renderDirectory, { recursive: true });
    await fs.mkdir(evidenceDirectory, { recursive: true });
    const firstBytes = Buffer.from("decode-complete-approved-fixture");
    const secondBytes = Buffer.from("decode-complete-not-final-approved-fixture");
    const firstPath = path.join(renderDirectory, "first.mp4");
    const secondPath = path.join(renderDirectory, "second.mp4");
    await fs.writeFile(firstPath, firstBytes);
    await fs.writeFile(secondPath, secondBytes);
    const deterministicEvidencePath = path.join(evidenceDirectory, "deterministic.json");
    const visionEvidencePath = path.join(evidenceDirectory, "vision.json");
    await fs.writeFile(deterministicEvidencePath, "deterministic evidence");
    await fs.writeFile(visionEvidencePath, "vision evidence");

    const runId = "campaign-run-01";
    const productionManifestSha256 = "a".repeat(64);
    const sourceSha256 = "b".repeat(64);
    const previewSha256 = "c".repeat(64);
    const templateSha256 = "d".repeat(64);
    const settingsSha256 = "e".repeat(64);
    const finalSha256 = sha(firstBytes);
    const qualityBindingSha256 = sha({
      gateType: "final",
      artifactSha256: finalSha256,
      sourceSha256,
      previewSha256,
      templateSha256,
      settingsSha256
    });
    const campaignManifest = createVisionQaCorpusCampaignManifest({
      campaignId: "shadow-clean-base-campaign",
      runs: [{ runId, productionManifestSha256 }]
    });
    verifyVisionQaCorpusCampaignManifest(campaignManifest);

    const databasePath = path.join(root, ".data/app.db");
    const db = new DatabaseSync(databasePath);
    db.exec(`CREATE TABLE production_runs (id TEXT PRIMARY KEY, manifest_hash TEXT NOT NULL);
    CREATE TABLE production_profiles (id TEXT PRIMARY KEY, config_json TEXT NOT NULL);
    CREATE TABLE production_run_channels (
      id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, profile_version INTEGER NOT NULL, profile_hash TEXT NOT NULL
    );
    CREATE TABLE channel_source_candidates (id TEXT PRIMARY KEY, event_fingerprint TEXT);
    CREATE TABLE production_items (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, state TEXT NOT NULL, channel_id TEXT NOT NULL,
      run_channel_id TEXT NOT NULL, item_slot INTEGER NOT NULL, generation INTEGER NOT NULL, source_candidate_id TEXT,
      source_sha256 TEXT, preview_sha256 TEXT, template_sha256 TEXT, settings_sha256 TEXT,
      final_artifact_sha256 TEXT, stage3_job_id TEXT
    );
    CREATE TABLE stage3_jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL);
    CREATE TABLE render_exports (
      id TEXT PRIMARY KEY, stage3_job_id TEXT NOT NULL, artifact_file_path TEXT NOT NULL,
      artifact_file_name TEXT NOT NULL, artifact_size_bytes INTEGER NOT NULL,
      artifact_mime_type TEXT NOT NULL, snapshot_json TEXT NOT NULL
    );
    CREATE TABLE agent_attempts (
      id TEXT PRIMARY KEY, role TEXT, status TEXT, output_hash TEXT, quality_binding_sha256 TEXT
    );
    CREATE TABLE quality_verdicts (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, production_item_id TEXT NOT NULL,
      gate_type TEXT NOT NULL, judge_kind TEXT NOT NULL, verdict TEXT NOT NULL,
      artifact_sha256 TEXT NOT NULL, source_sha256 TEXT, preview_sha256 TEXT,
      template_sha256 TEXT, settings_sha256 TEXT, agent_attempt_id TEXT,
      evidence_sha256 TEXT, evidence_artifact_path TEXT, defects_json TEXT NOT NULL
    )`);
    db.prepare("INSERT INTO production_runs (id, manifest_hash) VALUES (?, ?)")
      .run(runId, productionManifestSha256);
    db.prepare("INSERT INTO production_profiles (id, config_json) VALUES (?, ?)")
      .run("profile-first", JSON.stringify({ concept: COPSCOPES_PROJECT_KINGS_PROFILE.concept }));
    db.prepare(`INSERT INTO production_run_channels
      (id, profile_id, profile_version, profile_hash) VALUES (?, ?, ?, ?)`)
      .run("run-channel-first", "profile-first", 1, "8".repeat(64));
    db.prepare("INSERT INTO channel_source_candidates (id, event_fingerprint) VALUES (?, ?)")
      .run("source-first", "event-group-one");
    db.prepare("INSERT INTO channel_source_candidates (id, event_fingerprint) VALUES (?, ?)")
      .run("source-second", "event-group-two");
    const insertItem = db.prepare(`INSERT INTO production_items
      (id, run_id, state, channel_id, run_channel_id, item_slot, generation, source_candidate_id, source_sha256,
       preview_sha256, template_sha256, settings_sha256, final_artifact_sha256, stage3_job_id)
      VALUES (?, ?, ?, 'channel-fixture', 'run-channel-first', ?, 1, ?, ?, ?, ?, ?, ?, ?)`);
    insertItem.run(
      "item-first", runId, "final_approved", 1, "source-first", sourceSha256, previewSha256,
      templateSha256, settingsSha256, finalSha256, "job-first"
    );
    insertItem.run(
      "item-second", runId, "final_rendered", 2, "source-second", "f".repeat(64), previewSha256,
      templateSha256, settingsSha256, sha(secondBytes), null
    );
    const insertJob = db.prepare("INSERT INTO stage3_jobs (id, status) VALUES (?, 'completed')");
    insertJob.run("job-first");
    const insertRender = db.prepare(`INSERT INTO render_exports
      (id, stage3_job_id, artifact_file_path, artifact_file_name, artifact_size_bytes,
       artifact_mime_type, snapshot_json)
      VALUES (?, ?, ?, ?, ?, 'video/mp4', ?)`);
    insertRender.run(
      "render-first", "job-first", firstPath, "first.mp4", firstBytes.length,
      JSON.stringify(explicitApprovalSnapshot())
    );
    db.prepare(`INSERT INTO agent_attempts
      (id, role, status, output_hash, quality_binding_sha256)
      VALUES ('vision-attempt', 'vision_qa', 'passed', ?, ?)`)
      .run("1".repeat(64), qualityBindingSha256);
    const insertVerdict = db.prepare(`INSERT INTO quality_verdicts
      (id, run_id, production_item_id, gate_type, judge_kind, verdict, artifact_sha256,
       source_sha256, preview_sha256, template_sha256, settings_sha256, agent_attempt_id,
       evidence_sha256, evidence_artifact_path, defects_json)
      VALUES (?, ?, 'item-first', 'final', ?, 'pass', ?, ?, ?, ?, ?, ?, ?, ?, '[]')`);
    insertVerdict.run(
      "deterministic-pass", runId, "deterministic", finalSha256, sourceSha256, previewSha256,
      templateSha256, settingsSha256, null, sha("deterministic evidence"), deterministicEvidencePath
    );
    insertVerdict.run(
      "vision-pass", runId, "vision", finalSha256, sourceSha256, previewSha256,
      templateSha256, settingsSha256, "vision-attempt", sha("vision evidence"), visionEvidencePath
    );
    db.close();

    const inspectArtifact = async (filePath: string): Promise<VisionQaArtifactInspection> => {
      const bytes = await fs.readFile(filePath);
      return {
        sizeBytes: bytes.length,
        sha256: sha(bytes),
        durationMs: 10_000,
        videoCodec: "h264",
        width: 1080,
        height: 1920,
        audioCodec: "aac",
        decodeComplete: true,
        decodeError: null
      };
    };
    const evidence = await auditVisionQaCorpusSourceInventory({
      repoRoot: root,
      databasePath,
      campaignManifest,
      auditedAt: "2026-07-10T12:00:00.000Z",
      inspectArtifact
    });
    verifyVisionQaCorpusSourceAuditEvidence(evidence);
    assert.equal(evidence.counts.campaignRuns, 1);
    assert.equal(evidence.counts.campaignProductionItems, 2);
    assert.equal(evidence.counts.decodeComplete, 1);
    assert.equal(evidence.counts.finalApprovedItems, 1);
    assert.equal(evidence.counts.derivedFinalPasses, 1);
    assert.equal(evidence.counts.uniqueSourceHashes, 1);
    assert.equal(evidence.counts.uniqueEventGroups, 1);
    assert.equal(evidence.counts.eligibleApprovedUnique, 1);
    assert.equal(evidence.counts.approvedBaseDeficit, VISION_QA_REQUIRED_APPROVED_BASES - 1);
    assert.equal(evidence.artifacts[0]!.deterministicFinalPassBound, true);
    assert.equal(evidence.artifacts[0]!.visionFinalPassBound, true);
    const selectedCleanBases = selectEligibleVisionQaCleanBasesFromAudit({ repoRoot: root, evidence });
    assert.equal(selectedCleanBases.length, 1);
    assert.equal(selectedCleanBases[0]!.productionItemId, "item-first");
    assert.equal(selectedCleanBases[0]!.sourceAuditEvidenceSha256, evidence.evidenceSha256);
    assert.throws(
      () => selectEligibleVisionQaCleanBasesFromAudit({
        repoRoot: root,
        evidence,
        productionItemIds: ["item-second"]
      }),
      /not eligible in the sealed audit/
    );
    assert.equal(evidence.outcome, "blocked");
    assert.equal(evidence.blockers.some((blocker) => [
      "decode_failure", "database_provenance_gap", "final_artifact_hash_mismatch"
    ].includes(blocker.code)), false, "non-final campaign items do not poison clean-base eligibility");
    assert.throws(
      () => assertVisionQaCorpusBuildReady(evidence),
      (error: unknown) => error instanceof VisionQaCorpusBuildBlockedError &&
        error.evidence.evidenceSha256 === evidence.evidenceSha256
    );

    const outputDirectory = path.join(root, ".data/project-kings/vision-qa-corpus-v2");
    const written = await writeVisionQaCorpusSourceAudit({ outputDirectory, evidence });
    assert.ok(written.blockerPath);
    assert.deepEqual((await fs.readdir(outputDirectory)).sort(), ["BUILD_BLOCKED.md", "source-audit.json"]);
    const frozen = JSON.parse(await fs.readFile(written.evidencePath, "utf8"));
    assert.equal(frozen.evidenceSha256, evidence.evidenceSha256);

    await fs.writeFile(visionEvidencePath, "tampered vision evidence");
    const tamperedQualityEvidence = await auditVisionQaCorpusSourceInventory({
      repoRoot: root,
      databasePath,
      campaignManifest,
      auditedAt: "2026-07-10T12:00:00.000Z",
      inspectArtifact
    });
    assert.equal(tamperedQualityEvidence.counts.finalApprovedDerivedFinalPasses, 0);
    assert.equal(tamperedQualityEvidence.counts.eligibleApprovedUnique, 0);
    assert.ok(tamperedQualityEvidence.blockers.some((blocker) => blocker.code === "final_quality_binding_gap"));

    const wrongCampaign = createVisionQaCorpusCampaignManifest({
      campaignId: "wrong-manifest",
      runs: [{ runId, productionManifestSha256: "9".repeat(64) }]
    });
    const wrong = await auditVisionQaCorpusSourceInventory({
      repoRoot: root,
      databasePath,
      campaignManifest: wrongCampaign,
      auditedAt: "2026-07-10T12:00:00.000Z",
      inspectArtifact
    });
    assert.equal(wrong.counts.eligibleApprovedUnique, 0);
    assert.ok(wrong.blockers.some((blocker) => blocker.code === "campaign_scope_mismatch"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
