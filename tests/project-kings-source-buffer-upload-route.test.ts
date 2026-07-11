import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  GET as getSourceBufferRuntime,
  POST as uploadQualifiedSource
} from "../app/api/admin/project-kings/source-buffer/route";
import { createChannel } from "../lib/chat-history";
import { getDb } from "../lib/db/client";
import { createMcpMachineCredential } from "../lib/mcp-machine-credential-store";
import {
  buildProjectKingsSourceQualificationEvidence,
  inspectProjectKingsSourceMedia
} from "../lib/project-kings/source-buffer-readiness";
import {
  DARK_JOY_BOY_PROJECT_KINGS_PROFILE,
  PROJECT_KINGS_PILOT_PROFILES
} from "../lib/project-kings/pilot-production-profiles";
import { buildProjectKingsPilotProfileSnapshot } from "../lib/project-kings/pilot-profile-store";
import {
  createProjectKingsSensitiveContentAssessment,
  createProjectKingsSourceDesignationEvidence,
  PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256,
  PROJECT_KINGS_SOURCE_POLICY_SHA256,
  PROJECT_KINGS_SOURCE_POLICY_VERSION
} from "../lib/project-kings/source-rights-sensitive-policy";
import { approveCurrentProjectKingsSourcePolicy } from "../lib/project-kings/source-policy-approval-store";
import { listChannelSourceCandidates } from "../lib/portfolio-production-store";
import { bootstrapOwner } from "../lib/team-store";

const execFileAsync = promisify(execFile);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function sha256(value: string | Uint8Array | unknown): string {
  const bytes = typeof value === "string" || value instanceof Uint8Array
    ? value
    : JSON.stringify(canonicalize(value));
  return createHash("sha256").update(bytes).digest("hex");
}

async function withIsolatedAppData<T>(run: (root: string) => Promise<T>): Promise<T> {
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "clips-source-upload-route-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appDataDir;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  try {
    return await run(appDataDir);
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    await fs.rm(appDataDir, { recursive: true, force: true });
  }
}

async function createFixtureMp4(filePath: string): Promise<Uint8Array> {
  await execFileAsync("ffmpeg", [
    "-nostdin", "-v", "error",
    "-f", "lavfi", "-i", "color=c=blue:s=320x568:d=1",
    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
    "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-movflags", "+faststart", "-y", filePath
  ], { timeout: 60_000 });
  return fs.readFile(filePath);
}

test("machine-scoped upload admits only the exact decoded bytes and is idempotent", async () => {
  await withIsolatedAppData(async (root) => {
    const owner = await bootstrapOwner({
      workspaceName: "Project Kings Source Upload",
      email: "source-upload@example.com",
      password: "Password123!",
      displayName: "Source Upload Owner"
    });
    for (const [key, profile] of Object.entries(PROJECT_KINGS_PILOT_PROFILES)) {
      const channel = await createChannel({
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        name: profile.youtube.titleAdvisory,
        username: `source_upload_${key.replace(/[^a-z0-9]/g, "_")}`
      });
      getDb().prepare("UPDATE channels SET id = ? WHERE id = ?").run(profile.profileId, channel.id);
    }
    const machine = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "zoro-source-refiller",
      scopes: ["control:write"]
    });
    const fixturePath = path.join(root, "qualified-source.mp4");
    const bytes = await createFixtureMp4(fixturePath);
    const media = await inspectProjectKingsSourceMedia(fixturePath, ".data/qualified-source.mp4");
    const candidateId = "dark-upload-fixture";
    const sourceUrl = "https://www.instagram.com/reel/DARKUPLOADFIXTURE/";
    const eventId = "event-dark-upload-fixture";
    const liveInventorySha256 = sha256("live-inventory");
    const output = {
      decision: "PASS" as const,
      candidateId,
      storyEventId: eventId,
      conceptMatch: true,
      factualFit: true,
      duplicateVideo: false,
      duplicateEvent: false,
      sourceUsable: true,
      reason: "Synthetic route fixture is accepted only to exercise the immutable upload binding.",
      factualClaims: []
    };
    const policyApproval = approveCurrentProjectKingsSourcePolicy({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      policyVersion: PROJECT_KINGS_SOURCE_POLICY_VERSION,
      policySha256: PROJECT_KINGS_SOURCE_POLICY_SHA256,
      sourceDesignationsSha256: PROJECT_KINGS_SOURCE_DESIGNATIONS_SHA256,
      ownerAuthorizationEvidenceSha256: sha256("synthetic-owner-approval-event"),
      approvedAt: "2026-07-10T12:50:00.000Z"
    }).approval.approval;
    const sourceDesignation = createProjectKingsSourceDesignationEvidence({
      candidateId,
      profileKey: "dark-joy-boy",
      provider: "instagram",
      route: "instagram_donor_pool",
      donorUsername: "kodyantle",
      canonicalSourceUrl: sourceUrl,
      rightsEvidenceStatus: "covered_by_approved_source_policy",
      upstreamDiscoveryEvidenceSha256: sha256("synthetic-donor-provenance")
    });
    const sensitiveAssessment = createProjectKingsSensitiveContentAssessment({
      candidateId,
      contentSha256: media.contentSha256,
      upstreamEvidenceSha256: sha256("synthetic-independent-sensitive-assessment"),
      signals: {
        graphicViolence: "absent",
        unsupportedAllegation: "absent",
        minorInSensitiveIncident: "absent",
        realisticPoliticalOrPublicFigureDeepfake: "absent"
      }
    });
    const qualification = buildProjectKingsSourceQualificationEvidence({
      capturedAt: "2026-07-10T13:00:00.000Z",
      candidateId,
      profileKey: "dark-joy-boy",
      sourceUrl,
      provider: "instagram",
      provisionalStoryEventId: eventId,
      rightsStatus: "owner_approved_source_pool",
      media: {
        resolvedCopies: [media.relativePath],
        duplicateCopiesIgnored: [],
        uniqueContentHashes: [media.contentSha256],
        selected: media,
        ambiguous: false
      },
      liveInventorySha256,
      discoveryState: "frozen_catalog",
      sourcePolicyApproval: policyApproval,
      sourceDesignation,
      sensitiveAssessment,
      sourceFitAttestation: {
        candidateId,
        profileKey: "dark-joy-boy",
        sourceUrl,
        contentSha256: media.contentSha256,
        profileHash: buildProjectKingsPilotProfileSnapshot("dark-joy-boy").profileHash,
        liveInventorySha256,
        agentAttemptId: "source-fit-upload-route-fixture",
        model: "gpt-test",
        reasoningLevel: "low",
        promptSha256: sha256("prompt"),
        artifactSetSha256: sha256("artifacts"),
        rawOutputSha256: sha256("raw-output"),
        outputSha256: sha256(output),
        finishedAt: "2026-07-10T12:59:00.000Z",
        output
      }
    });
    assert.equal(qualification.status, "qualified");

    const makeRequest = (
      bodyBytes: Uint8Array,
      evidence: unknown = qualification.evidence
    ) => {
      const form = new FormData();
      form.set("profileKey", "dark-joy-boy");
      form.set("sourceBufferEvidenceSha256", sha256("source-buffer"));
      form.set("qualificationEvidence", JSON.stringify(evidence));
      form.set("file", new Blob([bodyBytes], { type: "video/mp4" }), "qualified-source.mp4");
      return new Request("http://localhost/api/admin/project-kings/source-buffer", {
        method: "POST",
        headers: { authorization: `Bearer ${machine.secret}` },
        body: form
      });
    };

    const initialRuntime = await getSourceBufferRuntime(new Request(
      "http://localhost/api/admin/project-kings/source-buffer",
      { headers: { authorization: `Bearer ${machine.secret}` } }
    ));
    assert.equal(initialRuntime.status, 200);
    const initialBody = await initialRuntime.json() as {
      workspaceId: string;
      ready: boolean;
      sourcePolicyApproval: { approvalSha256: string } | null;
      sourcePolicyApprovalSha256: string | null;
      channels: Array<{ profileKey: string; qualifiedAvailable: number; refill: { shouldRefill: boolean } }>;
    };
    assert.equal(initialBody.workspaceId, owner.workspace.id);
    assert.equal(initialBody.sourcePolicyApproval?.approvalSha256, policyApproval.approvalSha256);
    assert.equal(initialBody.sourcePolicyApprovalSha256, policyApproval.approvalSha256);
    assert.equal(initialBody.ready, false);
    assert.ok(initialBody.channels.every((channel) =>
      channel.qualifiedAvailable === 0 && channel.refill.shouldRefill
    ));

    const first = await uploadQualifiedSource(makeRequest(bytes));
    assert.equal(first.status, 201, await first.clone().text());
    const firstBody = await first.json() as { created: boolean };
    assert.equal(firstBody.created, true);

    const second = await uploadQualifiedSource(makeRequest(bytes));
    assert.equal(second.status, 200, await second.clone().text());
    const secondBody = await second.json() as { created: boolean };
    assert.equal(secondBody.created, false);
    assert.equal(listChannelSourceCandidates({
      workspaceId: owner.workspace.id,
      channelId: DARK_JOY_BOY_PROJECT_KINGS_PROFILE.profileId,
      qualificationStatus: "qualified",
      limit: 10
    }).length, 1);

    const corruptBytes = Uint8Array.from(bytes);
    corruptBytes[corruptBytes.length - 1] = (corruptBytes[corruptBytes.length - 1] ?? 0) ^ 1;
    const rejected = await uploadQualifiedSource(makeRequest(corruptBytes));
    assert.equal(rejected.status, 400);
    assert.match(await rejected.text(), /differ from qualification evidence/i);

    const legacyEvidence = {
      ...qualification.evidence!,
      schemaVersion: "project-kings-source-qualification-v1"
    };
    const legacyRejected = await uploadQualifiedSource(
      makeRequest(bytes, legacyEvidence)
    );
    assert.equal(legacyRejected.status, 400);
    assert.match(await legacyRejected.text(), /requires policy-bound v2 evidence/i);
  });
});
