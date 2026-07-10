import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { COPSCOPES_PROJECT_KINGS_PROFILE } from "../lib/project-kings/copscopes-production-profile";
import {
  createVisionQaAnnotationCampaign,
  reviewerProvenanceMatchesIdentity,
  verifyVisionQaAnnotationCampaignManifest,
  verifyVisionQaAnnotationLedger,
  verifyVisionQaAnnotationPacket,
  type VisionQaAnnotationLedgerEvent,
  type VisionQaAnnotationReviewerIdentity
} from "../lib/project-kings/vision-qa-annotation-runner";
import {
  calculateBlindSafeVisionQaContextPacketSha256,
  type BlindVisionQaJudgeInput,
  type VisionQaReviewerProvenance
} from "../lib/project-kings/vision-qa-eval";

function sha(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function identity(id: string): VisionQaAnnotationReviewerIdentity {
  return {
    reviewerId: id,
    reviewerKind: "human",
    provider: "owner-approved-independent-review",
    model: null,
    routeId: null,
    reasoningEffort: null,
    isolationBoundary: "independent_human",
    independenceKey: `independence-${id}`,
    identityEvidenceSha256: sha(`identity-evidence-${id}`)
  };
}

async function blindRequest(root: string): Promise<BlindVisionQaJudgeInput> {
  const write = async (name: string, value: string) => {
    const filePath = path.join(root, name);
    const bytes = Buffer.from(value);
    await fs.writeFile(filePath, bytes);
    return { filePath, sha256: sha(bytes) };
  };
  const artifact = await write("a001.mp4", "blind-artifact");
  const sourceArtifact = await write("a002.mp4", "source-artifact");
  const templateReference = await write("a003.png", "template-reference");
  const frames = [];
  const sourceFrames = [];
  for (let index = 0; index < 3; index += 1) {
    frames.push({ frameIndex: index, timestampMs: index * 1_000, ...await write(`a01${index}.png`, `frame-${index}`) });
    sourceFrames.push({ frameIndex: index, timestampMs: index * 1_000, ...await write(`a02${index}.png`, `source-frame-${index}`) });
  }
  const contextPacket = {
    schemaVersion: "project-kings-vision-qa-blind-context-v1" as const,
    conceptContract: COPSCOPES_PROJECT_KINGS_PROFILE.concept,
    template: {
      templateSha256: COPSCOPES_PROJECT_KINGS_PROFILE.templateIdentity.templateSha,
      layoutKind: "classic_top_bottom" as const,
      frame: { width: 1080, height: 1920 },
      mediaViewport: { x: 0.05, y: 0.2, width: 0.9, height: 0.6 },
      reference: templateReference,
      authorizedText: { visibleText: ["Hook", "Outcome"], channelName: "COP SCOPES", channelHandle: null }
    },
    source: {
      artifact: sourceArtifact,
      frames: sourceFrames,
      crop: { coordinateSpace: "normalized_source" as const, x: 0, y: 0.1, width: 1, height: 0.8 }
    },
    brief: { storyEventId: "event-001", hook: "Hook", action: "Visible action", payoff: "Outcome" },
    factualEvidence: [],
    duplicateLedger: { knownSourceSha256: [], knownStoryEventIds: [] },
    bannedWords: ["subscribe"]
  };
  return {
    blindCaseToken: "d".repeat(64),
    channelId: COPSCOPES_PROJECT_KINGS_PROFILE.youtube.channelId,
    templateSha256: COPSCOPES_PROJECT_KINGS_PROFILE.templateIdentity.templateSha,
    conceptId: COPSCOPES_PROJECT_KINGS_PROFILE.concept.conceptId,
    artifact,
    frames,
    contextPacket,
    contextPacketSha256: calculateBlindSafeVisionQaContextPacketSha256(contextPacket)
  };
}

test("annotation runner creates two isolated reviewer packets and a closed adjudication assignment without labels", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qa-annotation-contract-"));
  try {
    const caseRoot = path.join(root, "case-files");
    await fs.mkdir(caseRoot);
    const request = await blindRequest(caseRoot);
    const reviewers = [identity("reviewer-a"), identity("reviewer-b")] as const;
    const adjudicator = identity("adjudicator-c");
    const input = {
      outputRoot: path.join(root, "campaigns"),
      campaignId: "qa-annotation-campaign-001",
      corpusManifestSha256: "a".repeat(64),
      createdAt: "2026-07-10T16:00:00.000Z",
      rubricVersion: "vision-qa-rubric-v1",
      reviewers,
      adjudicator,
      cases: [request]
    };
    const created = await createVisionQaAnnotationCampaign(input);
    assert.equal(created.manifest.annotationCount, 0);
    assert.equal(created.manifest.adjudicationCount, 0);
    assert.equal(created.manifest.groundTruthPresent, false);
    verifyVisionQaAnnotationCampaignManifest(created.manifest);
    assert.equal(created.reviewerPacketPaths.length, 2);
    const firstPacket = JSON.parse(await fs.readFile(created.reviewerPacketPaths[0], "utf8"));
    const secondPacket = JSON.parse(await fs.readFile(created.reviewerPacketPaths[1], "utf8"));
    const adjudicationPacket = JSON.parse(await fs.readFile(created.adjudicationAssignmentPath, "utf8"));
    verifyVisionQaAnnotationPacket(firstPacket);
    verifyVisionQaAnnotationPacket(secondPacket);
    verifyVisionQaAnnotationPacket(adjudicationPacket);
    assert.equal(firstPacket.assignedIdentity.reviewerId, "reviewer-a");
    assert.equal(secondPacket.assignedIdentity.reviewerId, "reviewer-b");
    assert.equal(JSON.stringify(firstPacket).includes("reviewer-b"), false);
    assert.equal(adjudicationPacket.state, "awaiting_two_independent_annotations");
    assert.deepEqual(adjudicationPacket.includedAnnotations, []);
    const combined = JSON.stringify([
      firstPacket.cases,
      secondPacket.cases,
      adjudicationPacket.includedAnnotations
    ]);
    assert.doesNotMatch(combined, /groundTruthClass|defect_recipe|sealed-recipes|injectionRecipe/);

    const events = (await fs.readFile(created.ledgerPath, "utf8")).trim().split("\n")
      .map((line) => JSON.parse(line) as VisionQaAnnotationLedgerEvent);
    verifyVisionQaAnnotationLedger(events);
    assert.deepEqual(events.map((event) => event.eventType), [
      "campaign_created", "review_packet_issued", "review_packet_issued", "adjudication_assignment_issued"
    ]);
    const before = await fs.readFile(created.ledgerPath, "utf8");
    await assert.rejects(() => createVisionQaAnnotationCampaign(input), /already exists.*append-only/);
    assert.equal(await fs.readFile(created.ledgerPath, "utf8"), before);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("annotation roster rejects shared reviewer identity or provenance", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qa-annotation-roster-"));
  try {
    const caseRoot = path.join(root, "case-files");
    await fs.mkdir(caseRoot);
    const request = await blindRequest(caseRoot);
    const reviewer = identity("reviewer-a");
    await assert.rejects(() => createVisionQaAnnotationCampaign({
      outputRoot: path.join(root, "campaigns"),
      campaignId: "duplicate-roster",
      corpusManifestSha256: "a".repeat(64),
      createdAt: "2026-07-10T16:00:00.000Z",
      rubricVersion: "vision-qa-rubric-v1",
      reviewers: [reviewer, { ...identity("reviewer-b"), independenceKey: reviewer.independenceKey }],
      adjudicator: identity("adjudicator-c"),
      cases: [request]
    }), /independenceKey values must be independent/);

    const provenance: VisionQaReviewerProvenance = {
      reviewerKind: "human",
      provider: reviewer.provider,
      model: null,
      routeId: null,
      reasoningEffort: null,
      isolationBoundary: "independent_human",
      independenceKey: reviewer.independenceKey,
      invocationEvidenceSha256: "b".repeat(64)
    };
    assert.equal(reviewerProvenanceMatchesIdentity({ provenance, identity: reviewer }), true);
    assert.equal(reviewerProvenanceMatchesIdentity({
      provenance: { ...provenance, independenceKey: "another-reviewer" },
      identity: reviewer
    }), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
