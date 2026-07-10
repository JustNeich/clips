import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { COPSCOPES_PROJECT_KINGS_PROFILE } from "../lib/project-kings/copscopes-production-profile";
import {
  calculateProductionAgentRouteManifestSha256,
  parseFrozenProductionAgentRouteManifest
} from "../lib/project-kings/production-model-route-manifest";
import type { VisionQaOutput } from "../lib/project-kings/production-agent-contracts";
import {
  calculateBlindSafeVisionQaContextPacketSha256,
  calculateBlindVisionQaJudgeInvocationEvidenceSha256,
  calculateBlindVisionQaJudgeRequestSha256,
  calculateBlindVisionQaJudgeVerdictSha256,
  type BlindVisionQaJudgeInput,
  type BlindVisionQaJudgeResult
} from "../lib/project-kings/vision-qa-eval";
import {
  ISOLATED_VISION_QA_JUDGE_PROTOCOL_VERSION,
  createSeparateProcessBlindVisionQaJudge,
  executeIsolatedVisionQaJudgeEnvelope,
  inspectIsolatedVisionQaJudgeAdapter,
  type IsolatedVisionQaJudgeEnvelope
} from "../lib/project-kings/vision-qa-isolated-judge";

function sha(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function createRequest(root: string): Promise<BlindVisionQaJudgeInput> {
  const write = async (name: string, content: string) => {
    const filePath = path.join(root, name);
    const bytes = Buffer.from(content);
    await fs.writeFile(filePath, bytes);
    return { filePath, sha256: sha(bytes) };
  };
  const artifact = await write("a001.mp4", "opaque-final-video");
  const outputFrames = [];
  const sourceFrames = [];
  for (let index = 0; index < 3; index += 1) {
    outputFrames.push({
      frameIndex: index,
      timestampMs: index * 1_000,
      ...await write(`a01${index}.png`, `output-frame-${index}`)
    });
    sourceFrames.push({
      frameIndex: index,
      timestampMs: index * 1_000,
      ...await write(`a02${index}.png`, `source-frame-${index}`)
    });
  }
  const templateReference = await write("a030.png", "template-reference");
  const sourceArtifact = await write("a031.mp4", "source-video");
  const contextPacket = {
    schemaVersion: "project-kings-vision-qa-blind-context-v1" as const,
    conceptContract: COPSCOPES_PROJECT_KINGS_PROFILE.concept,
    template: {
      templateSha256: COPSCOPES_PROJECT_KINGS_PROFILE.templateIdentity.templateSha,
      layoutKind: "classic_top_bottom" as const,
      frame: { width: 1080, height: 1920 },
      mediaViewport: { x: 0.05, y: 0.2, width: 0.9, height: 0.6 },
      reference: templateReference,
      authorizedText: {
        visibleText: ["Visible hook", "Visible outcome"],
        channelName: "COP SCOPES",
        channelHandle: null
      }
    },
    source: {
      artifact: sourceArtifact,
      frames: sourceFrames,
      crop: { coordinateSpace: "normalized_source" as const, x: 0, y: 0.1, width: 1, height: 0.8 }
    },
    brief: {
      storyEventId: "event-opaque-001",
      hook: "Visible hook",
      action: "Preserve the visible source action.",
      payoff: "Visible outcome"
    },
    factualEvidence: [],
    duplicateLedger: { knownSourceSha256: [], knownStoryEventIds: [] },
    bannedWords: ["subscribe"]
  };
  return {
    blindCaseToken: "c".repeat(64),
    channelId: COPSCOPES_PROJECT_KINGS_PROFILE.youtube.channelId,
    templateSha256: COPSCOPES_PROJECT_KINGS_PROFILE.templateIdentity.templateSha,
    conceptId: COPSCOPES_PROJECT_KINGS_PROFILE.concept.conceptId,
    artifact,
    frames: outputFrames,
    contextPacket,
    contextPacketSha256: calculateBlindSafeVisionQaContextPacketSha256(contextPacket)
  };
}

function passVerdict(request: BlindVisionQaJudgeInput): VisionQaOutput {
  return {
    decision: "PASS",
    channelId: request.channelId,
    templateSha256: request.templateSha256,
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
}

async function loadManifest() {
  return parseFrozenProductionAgentRouteManifest(JSON.parse(await fs.readFile(
    path.join(process.cwd(), "docs/project-kings-production-pipeline-v1/evidence/project-kings-model-routes-v2.json"),
    "utf8"
  )));
}

async function writeProductionReadyManifest(root: string) {
  const legacy = await loadManifest();
  const sourcePolicySelection = {
    primary: {
      ...legacy.selections.vision_qa.primary,
      benchmark: {
        ...legacy.selections.vision_qa.primary.benchmark,
        benchmarkVersion: "isolated-source-policy-test-v1",
        sampleSize: 30
      }
    },
    fallback: {
      ...legacy.selections.vision_qa.fallback,
      benchmark: {
        ...legacy.selections.vision_qa.fallback.benchmark,
        benchmarkVersion: "isolated-source-policy-test-v1",
        sampleSize: 30
      }
    },
    policy: {
      ...legacy.selections.vision_qa.policy,
      requiresVision: true,
      minimumSampleSize: 30
    }
  };
  const withoutHash = {
    schemaVersion: 2 as const,
    manifestId: "isolated-vision-qa-test-routes-v2",
    createdAt: "2026-07-10T00:00:00.000Z",
    evidence: {
      ...legacy.evidence,
      source_policy: {
        role: "source_policy" as const,
        benchmarkVersion: "isolated-source-policy-test-v1",
        evidenceSha256: sha("isolated-source-policy-test-evidence")
      }
    },
    selections: {
      ...legacy.selections,
      source_policy: sourcePolicySelection
    }
  };
  const raw = {
    ...withoutHash,
    manifestSha256: calculateProductionAgentRouteManifestSha256(withoutHash)
  };
  const manifest = parseFrozenProductionAgentRouteManifest(raw);
  const manifestPath = path.join(root, "production-ready-route-manifest.json");
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, manifestPath };
}

test("isolated envelope uses frozen Vision QA route and exact request/verdict/provenance hashes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qa-isolated-contract-"));
  try {
    const request = await createRequest(root);
    const manifest = await loadManifest();
    const envelope: IsolatedVisionQaJudgeEnvelope = {
      schemaVersion: ISOLATED_VISION_QA_JUDGE_PROTOCOL_VERSION,
      request,
      requestSha256: calculateBlindVisionQaJudgeRequestSha256(request),
      routeManifestSha256: manifest.manifestSha256,
      adapter: { adapterId: "isolated-test-adapter", adapterSha256: "a".repeat(64) }
    };
    let packetJson = "";
    const result = await executeIsolatedVisionQaJudgeEnvelope({
      envelope,
      manifest,
      workingDirectory: root,
      invoker: async (invocation) => {
        packetJson = JSON.stringify(invocation.packet);
        assert.equal(invocation.role, "vision_qa");
        assert.equal(invocation.route.routeId, manifest.selections.vision_qa.primary.route.routeId);
        assert.equal(invocation.packet.artifacts.length <= 24, true);
        return {
          rawOutput: JSON.stringify(passVerdict(request)),
          usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 50, reasoningOutputTokens: 10 }
        };
      }
    });
    assert.doesNotMatch(packetJson, /groundTruthClass|sealed-recipes|injectionRecipe|adjudication/);
    assert.equal(result.provenance.executionBoundary, "separate_process");
    assert.equal(result.provenance.requestSha256, envelope.requestSha256);
    assert.equal(result.provenance.verdictSha256, calculateBlindVisionQaJudgeVerdictSha256(result.verdict));
    assert.equal(
      result.invocationEvidenceSha256,
      calculateBlindVisionQaJudgeInvocationEvidenceSha256(result.provenance)
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("separate-process client stages only allowlisted evidence into a random opaque directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qa-client-contract-"));
  const tempRoot = path.join(root, "temp");
  try {
    await fs.mkdir(tempRoot, { recursive: true });
    const sourceRoot = path.join(root, "source-private");
    await fs.mkdir(sourceRoot);
    const request = await createRequest(sourceRoot);
    const { manifestPath, manifest } = await writeProductionReadyManifest(root);
    const adapterCliPath = path.join(process.cwd(), "scripts/run-project-kings-isolated-vision-qa-judge.mts");
    const adapterIdentity = await inspectIsolatedVisionQaJudgeAdapter({ adapterPath: adapterCliPath });
    let observedCwd = "";
    const judge = createSeparateProcessBlindVisionQaJudge({
      repoRoot: process.cwd(),
      adapterCliPath,
      routeManifestPath: manifestPath,
      codexHome: path.join(root, "codex-home"),
      adapterIdentity,
      tempRoot,
      processExecutor: async (execution) => {
        observedCwd = execution.cwd;
        assert.equal(path.dirname(observedCwd), tempRoot);
        assert.match(path.basename(observedCwd), /^qa-[a-f0-9]+-/);
        const arg = (name: string) => execution.args[execution.args.indexOf(name) + 1]!;
        const envelope = JSON.parse(await fs.readFile(arg("--request"), "utf8")) as IsolatedVisionQaJudgeEnvelope;
        const serialized = JSON.stringify(envelope);
        assert.equal(serialized.includes(sourceRoot), false);
        assert.doesNotMatch(serialized, /groundTruthClass|sealed-recipes|defect_recipe|injectionRecipe|adjudication/);
        const stagedPaths = [
          envelope.request.artifact.filePath,
          ...envelope.request.frames.map((frame) => frame.filePath),
          envelope.request.contextPacket.template.reference.filePath,
          envelope.request.contextPacket.source.artifact.filePath,
          ...envelope.request.contextPacket.source.frames.map((frame) => frame.filePath)
        ];
        assert.equal(stagedPaths.every((filePath) => path.dirname(filePath) === observedCwd), true);
        const verdict = passVerdict(envelope.request);
        const primary = manifest.selections.vision_qa.primary;
        const provenance: BlindVisionQaJudgeResult["provenance"] = {
          invocationId: "contract-stub-invocation",
          routeId: primary.route.routeId,
          model: primary.route.model,
          reasoningEffort: primary.benchmark.reasoningEffort,
          executionBoundary: "separate_process",
          adapterId: adapterIdentity.adapterId,
          adapterSha256: adapterIdentity.adapterSha256,
          routeManifestSha256: manifest.manifestSha256,
          routeBenchmarkEvidenceSha256: manifest.evidence.vision_qa.evidenceSha256,
          requestSha256: envelope.requestSha256,
          verdictSha256: calculateBlindVisionQaJudgeVerdictSha256(verdict)
        };
        const result: BlindVisionQaJudgeResult = {
          verdict,
          provenance,
          invocationEvidenceSha256: calculateBlindVisionQaJudgeInvocationEvidenceSha256(provenance)
        };
        await fs.writeFile(arg("--output"), `${JSON.stringify(result)}\n`, { flag: "wx" });
        return { stdout: "", stderr: "" };
      }
    });
    const result = await judge(request);
    assert.equal(result.verdict.decision, "PASS");
    assert.equal(await fs.stat(observedCwd).catch(() => null), null, "opaque process directory is removed");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
