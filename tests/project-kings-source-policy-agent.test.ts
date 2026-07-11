import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PRODUCTION_AGENT_OUTPUT_SCHEMAS,
  PRODUCTION_SOURCE_POLICY_CLASSES,
  validateProductionAgentOutput,
  validateProductionAgentPacket,
  type SourcePolicyOutput,
  type SourcePolicyPacket
} from "../lib/project-kings/production-agent-contracts";
import {
  validateOutputAgainstPacket,
  validateProductionAgentModelSelection,
  type ProductionAgentModelSelection
} from "../lib/project-kings/production-agent-runtime";
import {
  runProjectKingsSourcePolicyAssessment
} from "../lib/project-kings/source-policy-assessment-runner";
import {
  PROJECT_KINGS_SOURCE_POLICY_SHA256,
  PROJECT_KINGS_SOURCE_POLICY_VERSION
} from "../lib/project-kings/source-rights-sensitive-policy";

const CHANNEL_ID = "UC1234567890123456789012";
const CONTENT_SHA = "a".repeat(64);

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function packet(): SourcePolicyPacket {
  const artifacts: SourcePolicyPacket["artifacts"] = [
    {
      id: "source-metadata",
      kind: "source_metadata",
      mediaType: "json",
      path: "/frozen/source-metadata.json",
      sha256: "1".repeat(64)
    },
    ...[1, 2, 3].map((index) => ({
      id: `frame-${index}`,
      kind: "key_frame" as const,
      mediaType: "image" as const,
      path: `/frozen/frame-${index}.jpg`,
      sha256: String(index + 1).repeat(64)
    })),
    {
      id: "ocr",
      kind: "ocr",
      mediaType: "text",
      path: "/frozen/ocr.txt",
      sha256: "5".repeat(64)
    },
    {
      id: "asr",
      kind: "transcript",
      mediaType: "text",
      path: "/frozen/asr.txt",
      sha256: "6".repeat(64)
    }
  ];
  return {
    schemaVersion: "production-agent-packet-v1",
    role: "source_policy",
    runId: "source-policy-run",
    itemId: "candidate-1",
    channelId: CHANNEL_ID,
    profileVersion: "project-kings-profile-v1",
    task: {
      candidateId: "candidate-1",
      sourceUrl: "https://www.instagram.com/reel/example/",
      contentSha256: CONTENT_SHA,
      profileKey: "dark-joy-boy",
      policyVersion: PROJECT_KINGS_SOURCE_POLICY_VERSION,
      policySha256: PROJECT_KINGS_SOURCE_POLICY_SHA256,
      prohibitedClasses: PRODUCTION_SOURCE_POLICY_CLASSES,
      orderedKeyFrameArtifactIds: ["frame-1", "frame-2", "frame-3"],
      ocrArtifactId: "ocr",
      asrArtifactId: "asr",
      sourceMetadataArtifactId: "source-metadata"
    },
    artifacts
  };
}

function output(overrides: Partial<SourcePolicyOutput> = {}): SourcePolicyOutput {
  return {
    candidateId: "candidate-1",
    contentSha256: CONTENT_SHA,
    signals: {
      graphicViolence: "absent",
      unsupportedAllegation: "present",
      minorInSensitiveIncident: "unknown",
      realisticPoliticalOrPublicFigureDeepfake: "absent"
    },
    evidenceArtifactIds: ["frame-1", "ocr", "asr"],
    reason: "OCR contains a serious allegation while the frames do not resolve whether a minor is identifiable.",
    ...overrides
  };
}

function selection(): ProductionAgentModelSelection {
  const policy = {
    requiresVision: true,
    requiresJsonSchema: true,
    minimumReasoning: "low" as const,
    minimumContextTokens: 0,
    minimumSampleSize: 30,
    minimumQualityScore: 1,
    minimumSchemaSuccessRate: 1,
    maximumP95LatencyMs: 90_000
  };
  const route = (routeId: string, fallbackRouteId: string) => ({
    route: {
      routeId,
      provider: "codex",
      model: routeId,
      capabilities: {
        vision: true,
        jsonSchema: true,
        reasoningEfforts: ["low", "medium", "high", "x-high"] as const,
        timeoutMs: 90_000,
        fallbackRouteIds: [fallbackRouteId]
      }
    },
    benchmark: {
      benchmarkVersion: "real-source-policy-benchmark-v1",
      routeId,
      reasoningEffort: "low" as const,
      sampleSize: 30,
      qualityScore: 1,
      schemaSuccessRate: 1,
      p95LatencyMs: 1_000,
      meanCost: 1,
      costUnit: "codex_credits" as const
    }
  });
  return {
    primary: route("primary", "fallback"),
    fallback: route("fallback", "primary"),
    policy
  };
}

test("source_policy exposes a strict schema and packet requires ordered frames, OCR and ASR", () => {
  assert.equal(PRODUCTION_AGENT_OUTPUT_SCHEMAS.source_policy.additionalProperties, false);
  assert.equal(
    JSON.stringify(PRODUCTION_AGENT_OUTPUT_SCHEMAS.source_policy).includes("uniqueItems"),
    false,
    "Codex structured output rejects uniqueItems; runtime validation enforces uniqueness"
  );
  const validated = validateProductionAgentPacket("source_policy", packet());
  assert.deepEqual(
    validated.task.orderedKeyFrameArtifactIds,
    ["frame-1", "frame-2", "frame-3"]
  );
  assert.deepEqual(validated.task.prohibitedClasses, PRODUCTION_SOURCE_POLICY_CLASSES);

  const reordered = packet();
  assert.throws(
    () => validateProductionAgentPacket("source_policy", {
      ...reordered,
      task: {
        ...reordered.task,
        orderedKeyFrameArtifactIds: ["frame-2", "frame-1", "frame-3"]
      }
    }),
    /must exactly match key_frame artifacts in packet order/i
  );
});

test("source_policy output preserves present and unknown and binds evidence to the packet", () => {
  const validatedOutput = validateProductionAgentOutput("source_policy", output());
  assert.equal(validatedOutput.signals.unsupportedAllegation, "present");
  assert.equal(validatedOutput.signals.minorInSensitiveIncident, "unknown");
  validateOutputAgainstPacket("source_policy", packet(), validatedOutput);

  assert.throws(
    () => validateProductionAgentOutput("source_policy", {
      ...output(),
      signals: { ...output().signals, graphicViolence: "maybe" }
    }),
    /must be one of absent, present, unknown/i
  );
  assert.throws(
    () => validateProductionAgentOutput("source_policy", {
      ...output(),
      evidenceArtifactIds: ["frame-1", "ocr", "asr", "asr"]
    }),
    /must be unique/i
  );
  assert.throws(
    () => validateOutputAgainstPacket(
      "source_policy",
      packet(),
      { ...output(), contentSha256: "b".repeat(64) }
    ),
    /does not match the exact source bytes/i
  );
  assert.throws(
    () => validateOutputAgainstPacket(
      "source_policy",
      packet(),
      { ...output(), evidenceArtifactIds: ["frame-1", "ocr"] }
    ),
    /must cite visual, OCR and ASR evidence/i
  );
});

test("source_policy model selection cannot claim production readiness below 30 benchmark cases", () => {
  const underSampled = selection();
  assert.throws(
    () => validateProductionAgentModelSelection({
      ...underSampled,
      policy: { ...underSampled.policy, minimumSampleSize: 29 }
    }, "source_policy"),
    /at least 30 real labeled samples/i
  );
});

test("source_policy fail-closed selection validates with a null fallback and explicit mode", () => {
  const base = selection();
  assert.doesNotThrow(() =>
    validateProductionAgentModelSelection(
      { primary: base.primary, fallback: null, fallbackMode: "fail_closed_none", policy: base.policy },
      "source_policy"
    )
  );
});

test("source_policy rejects a null fallback that does not declare fail-closed mode", () => {
  const base = selection();
  assert.throws(
    () =>
      validateProductionAgentModelSelection(
        { primary: base.primary, fallback: null, policy: base.policy },
        "source_policy"
      ),
    /explicit fail_closed_none fallbackMode/i
  );
});

test("runner reads exact frozen bytes and creates only a hash-bound sensitive assessment", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "source-policy-runner-"));
  try {
    const mediaBytes = new TextEncoder().encode("synthetic-frozen-media-bytes");
    const mediaPath = path.join(root, "candidate.mp4");
    const ocrPath = path.join(root, "ocr.txt");
    const asrPath = path.join(root, "asr.txt");
    await fs.writeFile(mediaPath, mediaBytes);
    await fs.writeFile(ocrPath, "Visible overlay accuses a person of a serious crime.\n");
    await fs.writeFile(asrPath, "No reliable speech was recoverable.\n");
    const contentSha256 = sha256(mediaBytes);
    let invoked = 0;
    const result = await runProjectKingsSourcePolicyAssessment({
      repoRoot: root,
      candidate: {
        candidateId: "candidate-runner",
        profileKey: "dark-joy-boy",
        channelId: CHANNEL_ID,
        profileVersion: "project-kings-profile-v1",
        sourceUrl: "https://www.instagram.com/reel/runner/",
        contentSha256,
        mediaPath
      },
      ocrEvidence: {
        artifactId: "source-ocr",
        filePath: ocrPath,
        sha256: sha256(await fs.readFile(ocrPath))
      },
      asrEvidence: {
        artifactId: "source-asr",
        filePath: asrPath,
        sha256: sha256(await fs.readFile(asrPath))
      },
      selection: selection(),
      invoker: async (invocation) => {
        invoked += 1;
        assert.equal(invocation.role, "source_policy");
        const invokedPacket = invocation.packet as SourcePolicyPacket;
        assert.equal(invokedPacket.task.contentSha256, contentSha256);
        assert.deepEqual(
          invokedPacket.task.orderedKeyFrameArtifactIds,
          ["source-key-frame-01", "source-key-frame-02", "source-key-frame-03"]
        );
        const semanticOutput: SourcePolicyOutput = {
          candidateId: "candidate-runner",
          contentSha256,
          signals: {
            graphicViolence: "absent",
            unsupportedAllegation: "present",
            minorInSensitiveIncident: "unknown",
            realisticPoliticalOrPublicFigureDeepfake: "absent"
          },
          evidenceArtifactIds: [
            "source-key-frame-01",
            "source-ocr",
            "source-asr"
          ],
          reason: "OCR contains an unsupported accusation; minor identity remains unresolved."
        };
        return {
          rawOutput: JSON.stringify(semanticOutput),
          usage: {
            inputTokens: 100,
            cachedInputTokens: 0,
            outputTokens: 30,
            reasoningOutputTokens: 5
          }
        };
      },
      frameCount: 3,
      temporaryRoot: root,
      extractFrames: async ({ outputDirectory, frameCount }) => {
        const frames = [];
        for (let index = 0; index < frameCount; index += 1) {
          const filePath = path.join(outputDirectory, `frame-${index}.jpg`);
          await fs.writeFile(filePath, `frame-${index}`);
          frames.push({ filePath, timestampMs: (index + 1) * 1_000 });
        }
        return frames;
      }
    });

    assert.equal(invoked, 1);
    assert.equal(result.assessment.signals.unsupportedAllegation, "present");
    assert.equal(result.assessment.signals.minorInSensitiveIncident, "unknown");
    assert.equal(
      result.assessment.upstreamEvidenceSha256,
      result.attemptEvidenceSha256
    );
    assert.equal(result.assessment.contentSha256, contentSha256);
    assert.equal("policyApproval" in result, false);
    assert.equal("qualification" in result, false);
    assert.match(result.packetBindingSha256, /^[a-f0-9]{64}$/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("runner rejects media hash drift before frame extraction or model invocation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "source-policy-hash-drift-"));
  try {
    const mediaPath = path.join(root, "candidate.mp4");
    const ocrPath = path.join(root, "ocr.txt");
    const asrPath = path.join(root, "asr.txt");
    await fs.writeFile(mediaPath, "actual-media");
    await fs.writeFile(ocrPath, "ocr");
    await fs.writeFile(asrPath, "asr");
    const ocrSha256 = sha256(await fs.readFile(ocrPath));
    const asrSha256 = sha256(await fs.readFile(asrPath));
    let extracted = 0;
    let invoked = 0;
    await assert.rejects(
      () => runProjectKingsSourcePolicyAssessment({
        repoRoot: root,
        candidate: {
          candidateId: "candidate-drift",
          profileKey: "copscopes-x2e",
          channelId: CHANNEL_ID,
          profileVersion: "project-kings-profile-v1",
          sourceUrl: "https://www.instagram.com/reel/drift/",
          contentSha256: "f".repeat(64),
          mediaPath
        },
        ocrEvidence: {
          artifactId: "ocr",
          filePath: ocrPath,
          sha256: ocrSha256
        },
        asrEvidence: {
          artifactId: "asr",
          filePath: asrPath,
          sha256: asrSha256
        },
        selection: selection(),
        invoker: async () => {
          invoked += 1;
          throw new Error("must not run");
        },
        extractFrames: async () => {
          extracted += 1;
          return [];
        }
      }),
      /differs from candidate.contentSha256/i
    );
    assert.equal(extracted, 0);
    assert.equal(invoked, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
