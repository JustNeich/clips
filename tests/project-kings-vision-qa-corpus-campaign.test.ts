import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  createVisionQaCorpusCampaignManifest,
  verifyVisionQaLocalInventoryPreflightEvidence,
  type VisionQaCorpusSourceAuditEvidence,
  type VisionQaLocalInventoryPreflightEvidence
} from "../lib/project-kings/vision-qa-corpus-builder";
import { COPSCOPES_PROJECT_KINGS_PROFILE } from "../lib/project-kings/copscopes-production-profile";
import {
  VISION_QA_ADJUDICATION_RESPONSE_VERSION,
  VISION_QA_CORPUS_PREPARATION_PLAN_VERSION,
  VISION_QA_REVIEW_RESPONSE_VERSION,
  createVisionQaAdjudicationInputPacket,
  createVisionQaCorpusContextSeed,
  createVisionQaCorpusPreparationPlan,
  extractVisionQaFrameManifest,
  finalizeVisionQaCorpusCampaign,
  prepareVisionQaCorpusCampaign,
  verifyVisionQaCorpusPreparationPlan,
  type VisionQaAdjudicationResponse,
  type VisionQaCorpusContextSeed,
  type VisionQaReviewResponse
} from "../lib/project-kings/vision-qa-corpus-campaign";
import type {
  VisionQaAdjudicationAssignmentPacket,
  VisionQaAnnotationCampaignManifest,
  VisionQaAnnotationPacket,
  VisionQaAnnotationReviewerIdentity
} from "../lib/project-kings/vision-qa-annotation-runner";
import type {
  VisionQaControlledDefect,
  VisionQaDefectRecipeManifest
} from "../lib/project-kings/vision-qa-defect-generator";
import type { VisionQaEvalDefect, VisionQaFrameManifest } from "../lib/project-kings/vision-qa-eval";

const execFileAsync = promisify(execFile);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function sha(value: unknown): string {
  const payload = typeof value === "string" || value instanceof Uint8Array
    ? value
    : JSON.stringify(canonicalize(value));
  return createHash("sha256").update(payload).digest("hex");
}

function identity(id: string): VisionQaAnnotationReviewerIdentity {
  return {
    reviewerId: id,
    reviewerKind: "human",
    provider: "independent-test-review",
    model: null,
    routeId: null,
    reasoningEffort: null,
    isolationBoundary: "independent_human",
    independenceKey: `independence:${id}`,
    identityEvidenceSha256: sha(`identity:${id}`)
  };
}

async function readyFixture(root: string): Promise<{
  evidence: VisionQaCorpusSourceAuditEvidence;
  contexts: VisionQaCorpusContextSeed[];
  itemIds: string[];
}> {
  const runId = "qa-shadow-campaign-run";
  const productionManifestSha256 = "a".repeat(64);
  const campaign = createVisionQaCorpusCampaignManifest({
    campaignId: "qa-shadow-campaign",
    runs: [{ runId, productionManifestSha256 }]
  });
  const artifactDirectory = path.join(root, "exports");
  const sourceDirectory = path.join(root, "sources");
  await fs.mkdir(artifactDirectory, { recursive: true });
  await fs.mkdir(sourceDirectory, { recursive: true });
  const conceptContractSha256 = sha(COPSCOPES_PROJECT_KINGS_PROFILE.concept);
  const templateSha256 = "b".repeat(64);
  const itemIds: string[] = [];
  const contexts: VisionQaCorpusContextSeed[] = [];
  const artifacts = [];
  for (let index = 0; index < 43; index += 1) {
    const productionItemId = `item-${String(index).padStart(3, "0")}`;
    const artifactPath = path.join(artifactDirectory, `${productionItemId}.mp4`);
    const sourcePath = path.join(sourceDirectory, `${productionItemId}.mp4`);
    const artifactBytes = Buffer.from(`approved-final:${productionItemId}`);
    const sourceBytes = Buffer.from(`exact-source:${productionItemId}`);
    await fs.writeFile(artifactPath, artifactBytes);
    await fs.writeFile(sourcePath, sourceBytes);
    const artifactSha256 = sha(artifactBytes);
    const sourceSha256 = sha(sourceBytes);
    const storyEventId = `story-event-${String(index).padStart(3, "0")}`;
    itemIds.push(productionItemId);
    artifacts.push({
      relativePath: path.relative(root, artifactPath),
      sha256: artifactSha256,
      sizeBytes: artifactBytes.length,
      durationMs: 10_000,
      videoCodec: "h264",
      width: 1080,
      height: 1920,
      audioCodec: "aac",
      decodeComplete: true,
      decodeError: null,
      runId,
      runManifestSha256: productionManifestSha256,
      productionItemId,
      productionItemState: "final_approved",
      databaseMatchCount: 1,
      renderExportId: `render-${productionItemId}`,
      stage3JobId: `job-${productionItemId}`,
      channelId: `channel-${index % 3}`,
      profileId: `profile-${index % 3}`,
      profileVersion: 1,
      profileHash: sha(`profile:${index % 3}`),
      conceptContractSha256,
      sourceSha256,
      templateSha256,
      eventGroupId: storyEventId,
      completedRenderExport: true,
      exactDatabaseSize: true,
      exactFinalArtifactSha256: true,
      layoutAwareSourceCropBound: true,
      deterministicFinalPassBound: true,
      visionFinalPassBound: true,
      derivedFinalPass: true,
      explicitApprovalBound: true
    });
    const claim = `The visible action belongs to ${storyEventId}.`;
    const evidence = `Exact source frames are the only factual evidence for ${storyEventId}.`;
    contexts.push(createVisionQaCorpusContextSeed({
      productionItemId,
      sourceArtifact: { relativePath: path.relative(root, sourcePath), sha256: sourceSha256 },
      conceptContract: COPSCOPES_PROJECT_KINGS_PROFILE.concept,
      template: {
        templateSha256,
        layoutKind: "classic_top_bottom",
        frame: { width: 1080, height: 1920 },
        mediaViewport: { x: 0.05, y: 0.2, width: 0.9, height: 0.58 },
        authorizedText: {
          visibleText: [`Hook ${index}`, `Outcome ${index}`],
          channelName: "COP SCOPES",
          channelHandle: null
        }
      },
      sourceCrop: { x: 0, y: 0.05, width: 1, height: 0.9 },
      brief: {
        storyEventId,
        hook: `Hook ${index}`,
        action: `Preserve the visible action ${index}.`,
        payoff: `Outcome ${index}`
      },
      factualEvidence: [{ claim, evidence, evidenceSha256: sha({ claim, evidence }) }],
      duplicateLedger: { knownSourceSha256: [], knownStoryEventIds: [] },
      bannedWords: ["subscribe"]
    }));
  }
  const counts = {
    campaignRuns: 1,
    campaignProductionItems: 43,
    diskMp4: 43,
    completedRenderExportMatches: 43,
    finalApprovedItems: 43,
    finalApprovedCompletedRenderExportMatches: 43,
    finalApprovedDecodeComplete: 43,
    exactFinalArtifactHashes: 43,
    finalApprovedExactFinalArtifactHashes: 43,
    derivedFinalPasses: 43,
    finalApprovedDerivedFinalPasses: 43,
    layoutAwareSourceCrops: 43,
    finalApprovedLayoutAwareSourceCrops: 43,
    uniqueArtifacts: 43,
    uniqueSourceHashes: 43,
    uniqueEventGroups: 43,
    decodeComplete: 43,
    explicitApproved: 43,
    eligibleApprovedUnique: 43,
    approvedBaseDeficit: 0
  } as const;
  const withoutHash = {
    schemaVersion: "project-kings-vision-qa-source-audit-v2" as const,
    auditedAt: "2026-07-10T15:00:00.000Z",
    campaign,
    approvalPolicy: {
      policyId: "project-kings-final-approved-derived-pass-v1" as const,
      completedRenderExportIsApproval: false as const,
      requires: [
        "campaign_run_manifest_binding", "production_item_final_approved", "exact_final_mp4_sha256",
        "layout_aware_source_crop", "deterministic_final_pass", "vision_final_pass",
        "exact_quality_bindings", "quality_evidence_provenance"
      ] as const
    },
    requirements: { selectionBases: 3 as const, holdoutCleanBases: 40 as const, totalApprovedBases: 43 as const },
    counts,
    assetSetSha256: sha(artifacts.map((artifact) => artifact.sha256).sort()),
    artifacts,
    outcome: "ready" as const,
    blockers: []
  };
  return {
    evidence: { ...withoutHash, evidenceSha256: sha(withoutHash) } as VisionQaCorpusSourceAuditEvidence,
    contexts,
    itemIds
  };
}

async function fakeExtract(input: {
  videoPath: string;
  outputDirectory: string;
  frameSetId: string;
}) {
  const root = path.join(input.outputDirectory, sha(`fake-frames:${input.frameSetId}`).slice(0, 32));
  await fs.mkdir(input.outputDirectory, { recursive: true });
  await fs.mkdir(root, { recursive: false });
  const videoSha256 = sha(await fs.readFile(input.videoPath));
  const frames = [];
  for (let index = 0; index < 3; index += 1) {
    const file = `${index}.png`;
    const bytes = Buffer.from(`frame:${input.frameSetId}:${index}`);
    await fs.writeFile(path.join(root, file), bytes);
    frames.push({ frameIndex: index, timestampMs: index * 1_000, file, sha256: sha(bytes) });
  }
  const manifest: VisionQaFrameManifest = {
    schemaVersion: "vision-qa-frame-manifest-v1",
    videoSha256,
    frames
  };
  const bytes = `${JSON.stringify(manifest)}\n`;
  const frameManifestPath = path.join(root, "manifest.json");
  await fs.writeFile(frameManifestPath, bytes);
  return {
    frameManifestPath,
    frameManifestSha256: sha(bytes),
    frames: frames.map((frame) => ({
      frameIndex: frame.frameIndex,
      timestampMs: frame.timestampMs,
      filePath: path.join(root, frame.file),
      sha256: frame.sha256
    }))
  };
}

async function fakeDefect(input: {
  base: { productionItemId: string; artifactSha256: string; campaignManifestSha256: string; sourceAuditEvidenceSha256: string; runId: string };
  defect: VisionQaControlledDefect;
  outputRoot: string;
  createdAt?: string;
}): Promise<VisionQaDefectRecipeManifest> {
  const recipeSha256 = sha({ base: input.base.productionItemId, defect: input.defect });
  const artifactBytes = Buffer.from(`controlled:${recipeSha256}`);
  const artifactSha256 = sha(artifactBytes);
  const opaqueArtifactId = sha(`opaque:${recipeSha256}`).slice(0, 32);
  const relativePath = path.join("blind-artifacts", `${opaqueArtifactId}.mp4`);
  const outputPath = path.join(input.outputRoot, relativePath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, artifactBytes, { flag: "wx" });
  const probeEvidence = { observed: true, recipeSha256 };
  const probe = {
    probeKind: "marker_pixel" as const,
    status: "verified" as const,
    injectionObserved: true,
    requiresVisionConfirmation: true,
    evidence: probeEvidence,
    evidenceSha256: sha(probeEvidence)
  };
  const withoutHash = {
    schemaVersion: "project-kings-vision-qa-defect-recipe-v1" as const,
    recipeId: recipeSha256.slice(0, 24),
    recipeSha256,
    campaignManifestSha256: input.base.campaignManifestSha256,
    base: {
      sourceAuditEvidenceSha256: input.base.sourceAuditEvidenceSha256,
      runId: input.base.runId,
      productionItemId: input.base.productionItemId,
      artifactSha256: input.base.artifactSha256
    },
    defect: input.defect,
    parameters: { test: true },
    toolchain: { ffmpegVersion: "test", ffprobeVersion: "test", fontSha256: null },
    blindArtifact: { opaqueArtifactId, relativePath, sha256: artifactSha256, sizeBytes: artifactBytes.length },
    probe,
    createdAt: input.createdAt ?? "2026-07-10T15:00:00.000Z"
  };
  return { ...withoutHash, manifestSha256: sha(withoutHash) };
}

function responseFor(input: {
  packet: VisionQaAnnotationPacket;
  campaign: VisionQaAnnotationCampaignManifest;
  truth: Map<string, { groundTruthClass: "clean" | "defective"; expectedDefect: VisionQaEvalDefect | null }>;
  completedAt: string;
}): VisionQaReviewResponse {
  const annotations = input.packet.cases.map((entry) => {
    const truth = input.truth.get(entry.blindCaseToken)!;
    return {
      blindCaseToken: entry.blindCaseToken,
      requestSha256: entry.requestSha256,
      decision: truth.groundTruthClass === "clean" ? "PASS" as const : "FAIL" as const,
      defects: truth.expectedDefect ? [truth.expectedDefect] : [],
      invocationEvidenceSha256: sha(`${input.packet.assignedIdentity.reviewerId}:${entry.blindCaseToken}`)
    };
  });
  const withoutHash = {
    schemaVersion: VISION_QA_REVIEW_RESPONSE_VERSION,
    campaignManifestSha256: input.campaign.manifestSha256,
    reviewerPacketSha256: input.packet.packetSha256,
    reviewerId: input.packet.assignedIdentity.reviewerId,
    completedAt: input.completedAt,
    annotations
  };
  return { ...withoutHash, responseSha256: sha(withoutHash) };
}

test("raw inventory preflight can report files but can never qualify unscoped bases", () => {
  const withoutHash = {
    schemaVersion: "project-kings-vision-qa-local-inventory-preflight-v1" as const,
    auditedAt: "2026-07-10T15:00:00.000Z",
    renderExportDirectory: "/tmp/exports",
    databasePath: "/tmp/app.db",
    counts: {
      rawMp4: 56,
      uniqueMp4Hashes: 56,
      decodeComplete: 56,
      databaseRenderExports: 101,
      campaignScopedEligibleBases: 0 as const
    },
    requiredProductionTables: {
      production_runs: false,
      production_run_channels: false,
      production_profiles: false,
      production_items: false,
      channel_source_candidates: false,
      quality_verdicts: false,
      agent_attempts: false
    },
    qualificationAllowed: false as const,
    outcome: "blocked" as const,
    blockers: [
      { code: "campaign_manifest_required" as const, detail: "A canonical campaign is required." },
      { code: "production_schema_missing" as const, detail: "Durable production tables are missing." }
    ],
    assetSetSha256: "a".repeat(64)
  };
  const evidence: VisionQaLocalInventoryPreflightEvidence = {
    ...withoutHash,
    evidenceSha256: sha(withoutHash)
  };
  verifyVisionQaLocalInventoryPreflightEvidence(evidence);
  assert.equal(evidence.qualificationAllowed, false);
  assert.equal(evidence.counts.campaignScopedEligibleBases, 0);
});

test("real frame extractor writes five hash-bound representative PNG frames", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kings-frames-"));
  try {
    const videoPath = path.join(root, "video.mp4");
    await execFileAsync("ffmpeg", [
      "-nostdin", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=320x568:r=25:d=1.2",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=1.2", "-shortest",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", videoPath
    ], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    const extracted = await extractVisionQaFrameManifest({
      videoPath,
      outputDirectory: path.join(root, "frames"),
      frameSetId: "representative-set"
    });
    assert.equal(extracted.frames.length, 5);
    assert.equal(new Set(extracted.frames.map((frame) => frame.sha256)).size, 5);
    const manifestBytes = await fs.readFile(extracted.frameManifestPath);
    assert.equal(sha(manifestBytes), extracted.frameManifestSha256);
    const manifest = JSON.parse(manifestBytes.toString("utf8")) as VisionQaFrameManifest;
    assert.equal(manifest.videoSha256, sha(await fs.readFile(videoPath)));
    assert.deepEqual(manifest.frames.map((frame) => frame.timestampMs), [40, 300, 600, 900, 1160]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("preparation rejects repeated source or story evidence before creating any partition artifact", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kings-corpus-leak-"));
  try {
    const fixture = await readyFixture(root);
    const firstArtifact = fixture.evidence.artifacts[0]!;
    const secondArtifact = fixture.evidence.artifacts[1]!;
    const artifacts = fixture.evidence.artifacts.map((artifact, index) => index === 1 ? {
      ...artifact,
      sourceSha256: firstArtifact.sourceSha256
    } : artifact);
    const { evidenceSha256: _oldHash, ...evidenceWithoutHash } = fixture.evidence;
    const duplicateEvidenceWithoutHash = {
      ...evidenceWithoutHash,
      counts: { ...evidenceWithoutHash.counts, uniqueSourceHashes: 42 },
      artifacts
    };
    const duplicateEvidence = {
      ...duplicateEvidenceWithoutHash,
      evidenceSha256: sha(duplicateEvidenceWithoutHash)
    } as VisionQaCorpusSourceAuditEvidence;
    const contexts = fixture.contexts.map((context, index) => {
      if (index !== 1) return context;
      const { contextSeedSha256: _contextHash, ...withoutContextHash } = context;
      return createVisionQaCorpusContextSeed({
        ...withoutContextHash,
        sourceArtifact: fixture.contexts[0]!.sourceArtifact
      });
    });
    const plan = createVisionQaCorpusPreparationPlan({
      campaignManifestSha256: duplicateEvidence.campaign.manifestSha256,
      sourceAuditEvidenceSha256: duplicateEvidence.evidenceSha256,
      datasetId: "project-kings-leak-test",
      datasetVersion: "v1",
      createdAt: "2026-07-10T15:00:00.000Z",
      rubricVersion: "vision-rubric-v1",
      selectionProductionItemIds: fixture.itemIds.slice(0, 3),
      holdoutProductionItemIds: fixture.itemIds.slice(3),
      contexts,
      reviewers: [identity("leak-reviewer-a"), identity("leak-reviewer-b")],
      adjudicator: identity("leak-adjudicator-c")
    });
    await assert.rejects(
      () => prepareVisionQaCorpusCampaign({
        repoRoot: root,
        outputRoot: path.join(root, "output"),
        evidence: duplicateEvidence,
        plan,
        dependencies: { generateDefectVariant: fakeDefect as never, extractFrames: fakeExtract as never }
      }),
      /unique source hashes and story events/
    );
    assert.equal(await fs.stat(path.join(root, "output", "campaigns")).catch(() => null), null);
    assert.equal(secondArtifact.productionItemId, "item-001");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("offline campaign prepares exact 3+6 and 40+80 blind cases, then freezes only after independent reviews and adjudication", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kings-corpus-"));
  try {
    const fixture = await readyFixture(root);
    const plan = createVisionQaCorpusPreparationPlan({
      campaignManifestSha256: fixture.evidence.campaign.manifestSha256,
      sourceAuditEvidenceSha256: fixture.evidence.evidenceSha256,
      datasetId: "project-kings-qa",
      datasetVersion: "v1",
      createdAt: "2026-07-10T15:00:00.000Z",
      rubricVersion: "vision-rubric-v1",
      selectionProductionItemIds: fixture.itemIds.slice(0, 3),
      holdoutProductionItemIds: fixture.itemIds.slice(3),
      contexts: fixture.contexts,
      reviewers: [identity("reviewer-a"), identity("reviewer-b")],
      adjudicator: identity("adjudicator-c")
    });
    assert.equal(plan.schemaVersion, VISION_QA_CORPUS_PREPARATION_PLAN_VERSION);
    verifyVisionQaCorpusPreparationPlan(plan);
    const prepared = await prepareVisionQaCorpusCampaign({
      repoRoot: root,
      outputRoot: path.join(root, "corpus-output"),
      evidence: fixture.evidence,
      plan,
      dependencies: {
        generateDefectVariant: fakeDefect as never,
        extractFrames: fakeExtract as never
      }
    });
    assert.deepEqual(prepared.manifest.counts, {
      selectionClean: 3,
      selectionDefective: 6,
      holdoutClean: 40,
      holdoutDefective: 80,
      holdoutTotal: 120,
      uniqueFinalArtifactHashes: 129
    });
    assert.equal((await fs.stat(prepared.manifestPath)).mode & 0o777, 0o444);
    await assert.rejects(
      () => prepareVisionQaCorpusCampaign({
        repoRoot: root,
        outputRoot: path.join(root, "corpus-output"),
        evidence: fixture.evidence,
        plan,
        dependencies: { generateDefectVariant: fakeDefect as never, extractFrames: fakeExtract as never }
      }),
      /EEXIST/
    );

    const campaign = JSON.parse(await fs.readFile(
      path.join(prepared.root, prepared.manifest.annotationCampaign.relativePath), "utf8"
    )) as VisionQaAnnotationCampaignManifest;
    const reviewerPackets = await Promise.all(prepared.manifest.annotationCampaign.reviewerPacketRelativePaths.map(
      async (relativePath) => JSON.parse(await fs.readFile(path.join(prepared.root, relativePath), "utf8")) as VisionQaAnnotationPacket
    )) as [VisionQaAnnotationPacket, VisionQaAnnotationPacket];
    const assignment = JSON.parse(await fs.readFile(
      path.join(prepared.root, prepared.manifest.annotationCampaign.adjudicationAssignmentRelativePath), "utf8"
    )) as VisionQaAdjudicationAssignmentPacket;
    assert.equal(campaign.annotationCount, 0);
    assert.equal(campaign.adjudicationCount, 0);
    assert.equal(reviewerPackets[0].cases.length, 129);
    assert.equal(reviewerPackets[1].cases.length, 129);
    assert.equal(JSON.stringify(reviewerPackets).includes("groundTruthClass"), false);
    assert.equal(assignment.state, "awaiting_two_independent_annotations");

    const truthFile = JSON.parse(await fs.readFile(
      path.join(prepared.root, prepared.manifest.sealedTruthSeeds.relativePath), "utf8"
    )) as { seeds: Array<{ blindCaseToken: string; groundTruthClass: "clean" | "defective"; expectedDefect: VisionQaEvalDefect | null }> };
    const truth = new Map(truthFile.seeds.map((seed) => [seed.blindCaseToken, seed]));
    const responses = reviewerPackets.map((packet) => responseFor({
      packet,
      campaign,
      truth,
      completedAt: "2026-07-10T16:00:00.000Z"
    })) as [VisionQaReviewResponse, VisionQaReviewResponse];
    assert.throws(
      () => createVisionQaAdjudicationInputPacket({
        campaign,
        assignment,
        reviewerPackets: [reviewerPackets[1], reviewerPackets[0]],
        responses: [responses[1], responses[0]]
      }),
      /exact packets frozen in the campaign manifest/
    );
    const adjudicationPacket = createVisionQaAdjudicationInputPacket({
      campaign,
      assignment,
      reviewerPackets,
      responses
    });
    assert.equal(JSON.stringify(adjudicationPacket).includes("groundTruthClass"), false);
    assert.equal(JSON.stringify(adjudicationPacket).includes("controlled_fault_injection"), false);
    const adjudicationCases = adjudicationPacket.cases.map((entry) => {
      const expected = truth.get(entry.blindCaseToken)!;
      return {
        blindCaseToken: entry.blindCaseToken,
        requestSha256: entry.requestSha256,
        decision: expected.groundTruthClass === "clean" ? "PASS" as const : "FAIL" as const,
        defects: expected.expectedDefect ? [expected.expectedDefect] : [],
        resolution: expected.groundTruthClass === "clean"
          ? "Both independent reviews found no defect in the approved base."
          : "Both independent reviews confirmed the controlled visible defect.",
        invocationEvidenceSha256: sha(`adjudication:${entry.blindCaseToken}`)
      };
    });
    const adjudicationWithoutHash = {
      schemaVersion: VISION_QA_ADJUDICATION_RESPONSE_VERSION,
      campaignManifestSha256: campaign.manifestSha256,
      adjudicationInputPacketSha256: adjudicationPacket.packetSha256,
      adjudicatorId: assignment.assignedIdentity.reviewerId,
      completedAt: "2026-07-10T17:00:00.000Z",
      cases: adjudicationCases
    };
    const adjudicationResponse: VisionQaAdjudicationResponse = {
      ...adjudicationWithoutHash,
      responseSha256: sha(adjudicationWithoutHash)
    };
    const firstClean = adjudicationCases.findIndex((entry) => entry.decision === "PASS");
    const dishonestCases = adjudicationCases.map((entry, index) => index === firstClean ? {
      ...entry,
      decision: "FAIL" as const,
      defects: [{ code: "donor_ui" as const, severity: "critical" as const, rationale: "Synthetic contradiction." }]
    } : entry);
    const dishonestWithoutHash = { ...adjudicationWithoutHash, cases: dishonestCases };
    await assert.rejects(
      () => finalizeVisionQaCorpusCampaign({
        campaignRoot: prepared.root,
        preparedManifest: prepared.manifest,
        reviewerPackets,
        campaign,
        reviewResponses: responses,
        adjudicationPacket,
        adjudicationResponse: { ...dishonestWithoutHash, responseSha256: sha(dishonestWithoutHash) }
      }),
      /replace it instead of inventing PASS/
    );
    assert.equal(await fs.stat(path.join(prepared.root, "frozen")).catch(() => null), null);

    const finalized = await finalizeVisionQaCorpusCampaign({
      campaignRoot: prepared.root,
      preparedManifest: prepared.manifest,
      reviewerPackets,
      campaign,
      reviewResponses: responses,
      adjudicationPacket,
      adjudicationResponse
    });
    assert.deepEqual(finalized.corpus.finalHoldout.counts, {
      total: 120,
      clean: 40,
      defective: 80,
      criticalDefective: 71
    });
    assert.equal(finalized.corpus.selectionPool.counts.total, 9);
    assert.match(finalized.corpus.corpusSha256, /^[a-f0-9]{64}$/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
