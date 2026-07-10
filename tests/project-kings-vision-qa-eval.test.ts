import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

import type { VisionQaOutput } from "../lib/project-kings/production-agent-contracts";
import { COPSCOPES_PROJECT_KINGS_PROFILE } from "../lib/project-kings/copscopes-production-profile";
import {
  VISION_QA_EVAL_CORPUS_VERSION,
  VisionQaEvalError,
  assembleFrozenVisionQaEvalCorpus,
  calculateBlindSafeVisionQaContextPacketSha256,
  calculateBlindVisionQaJudgeInvocationEvidenceSha256,
  calculateBlindVisionQaJudgeRequestSha256,
  calculateBlindVisionQaJudgeVerdictSha256,
  freezeVisionQaEvalPartition,
  runBlindVisionQaLaunchEvaluation,
  writeFrozenVisionQaEvalPartition,
  type BlindVisionQaJudge,
  type FrozenVisionQaEvalCorpus,
  type VisionQaEvalCase,
  type VisionQaEvalDefect,
  type VisionQaEvalPartitionInput
} from "../lib/project-kings/vision-qa-eval";

const CHANNEL_ID = "UC1234567890123456789012";
const TEMPLATE_SHA = "f".repeat(64);
const JUDGE = {
  routeId: "codex:gpt-5.4",
  model: "gpt-5.4",
  reasoningEffort: "high",
  selectionBenchmarkEvidenceSha256: "e".repeat(64),
  routeManifestSha256: "c".repeat(64),
  routeBenchmarkEvidenceSha256: "d".repeat(64),
  isolation: {
    executionBoundary: "separate_process" as const,
    adapterId: "vision-qa-isolated-adapter-v1",
    adapterSha256: "a".repeat(64),
    attestationSha256: "b".repeat(64)
  }
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object" && !(value instanceof Uint8Array)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
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

function defect(code: "unsafe_crop" | "missing_hook"): VisionQaEvalDefect {
  return {
    code,
    severity: code === "unsafe_crop" ? "critical" : "noncritical",
    rationale:
      code === "unsafe_crop"
        ? "The crop removes the visible main action."
        : "The opening contains no visible hook."
  };
}

async function createCase(input: {
  root: string;
  prefix: string;
  index: number;
  groundTruthClass: "clean" | "defective";
  defectCode?: "unsafe_crop" | "missing_hook";
}): Promise<VisionQaEvalCase> {
  const caseId = `${input.prefix}-case-${String(input.index).padStart(3, "0")}`;
  const caseDir = path.join(input.root, caseId);
  await fs.mkdir(caseDir, { recursive: true });
  const artifactPath = path.join(caseDir, "render.mp4");
  const artifactBytes = Buffer.from(`video:${caseId}`);
  await fs.writeFile(artifactPath, artifactBytes);
  const artifactSha256 = sha(artifactBytes);
  const sourceArtifactPath = path.join(caseDir, "source.mp4");
  const sourceBytes = Buffer.from(`source-video:${caseId}`);
  await fs.writeFile(sourceArtifactPath, sourceBytes);
  const sourceSha256 = sha(sourceBytes);
  const templateReferencePath = path.join(caseDir, "template-reference.png");
  const templateReferenceBytes = Buffer.from(`template-reference:${caseId}`);
  await fs.writeFile(templateReferencePath, templateReferenceBytes);
  const sourceFrames = [];
  for (let frameIndex = 0; frameIndex < 3; frameIndex += 1) {
    const sourceFramePath = path.join(caseDir, `source-frame-${frameIndex}.png`);
    const sourceFrameBytes = Buffer.from(`source-frame:${caseId}:${frameIndex}`);
    await fs.writeFile(sourceFramePath, sourceFrameBytes);
    sourceFrames.push({
      frameIndex,
      timestampMs: frameIndex * 1_000,
      filePath: sourceFramePath,
      sha256: sha(sourceFrameBytes)
    });
  }
  const frames = [];
  for (let frameIndex = 0; frameIndex < 3; frameIndex += 1) {
    const file = `frame-${frameIndex}.png`;
    const bytes = Buffer.from(`frame:${caseId}:${frameIndex}`);
    await fs.writeFile(path.join(caseDir, file), bytes);
    frames.push({
      frameIndex,
      timestampMs: frameIndex * 1_000,
      file,
      sha256: sha(bytes)
    });
  }
  const frameManifestPath = path.join(caseDir, "frames.json");
  const manifestBytes = Buffer.from(
    JSON.stringify({
      schemaVersion: "vision-qa-frame-manifest-v1",
      videoSha256: artifactSha256,
      frames
    })
  );
  await fs.writeFile(frameManifestPath, manifestBytes);
  const defects = input.groundTruthClass === "defective" ? [defect(input.defectCode ?? "unsafe_crop")] : [];
  const decision = defects.length ? "FAIL" : "PASS";
  const completedAt = "2026-07-10T08:00:00.000Z";
  const storyEventId = `event:${caseId}`;
  const reviewerProvenance = (reviewer: "a" | "b" | "c") => ({
    reviewerKind: "human" as const,
    provider: "synthetic-contract-test",
    model: null,
    routeId: null,
    reasoningEffort: null,
    isolationBoundary: "independent_human" as const,
    independenceKey: `${caseId}:reviewer:${reviewer}`,
    invocationEvidenceSha256: sha(`${caseId}:review-evidence:${reviewer}`)
  });
  const factualClaim = "The visible action in the source is the only factual basis for the edit.";
  const factualEvidenceText = "Hash-bound source frames support the visible action; no external claim is added.";
  const blindContextPacket = {
    schemaVersion: "project-kings-vision-qa-blind-context-v1" as const,
    conceptContract: COPSCOPES_PROJECT_KINGS_PROFILE.concept,
    template: {
      templateSha256: TEMPLATE_SHA,
      layoutKind: "classic_top_bottom" as const,
      frame: { width: 1080, height: 1920 },
      mediaViewport: { x: 0.05, y: 0.22, width: 0.9, height: 0.55 },
      reference: { filePath: templateReferencePath, sha256: sha(templateReferenceBytes) },
      authorizedText: {
        visibleText: ["Visible hook", "Visible outcome"],
        channelName: "COP SCOPES",
        channelHandle: null
      }
    },
    source: {
      artifact: { filePath: sourceArtifactPath, sha256: sourceSha256 },
      frames: sourceFrames,
      crop: {
        coordinateSpace: "normalized_source" as const,
        x: 0,
        y: 0.1,
        width: 1,
        height: 0.8
      }
    },
    brief: {
      storyEventId,
      hook: "Visible hook",
      action: "Preserve the visible action inside the template media viewport.",
      payoff: "Visible outcome"
    },
    factualEvidence: [{
      claim: factualClaim,
      evidence: factualEvidenceText,
      evidenceSha256: sha({ claim: factualClaim, evidence: factualEvidenceText })
    }],
    duplicateLedger: { knownSourceSha256: [], knownStoryEventIds: [] },
    bannedWords: ["subscribe"]
  };
  return {
    caseId,
    sourceSha256,
    storyEventId,
    channelId: CHANNEL_ID,
    templateSha256: TEMPLATE_SHA,
    conceptId: COPSCOPES_PROJECT_KINGS_PROFILE.concept.conceptId,
    groundTruthClass: input.groundTruthClass,
    artifactPath,
    artifactSha256,
    frameManifestPath,
    frameManifestSha256: sha(manifestBytes),
    blindContextPacket,
    blindContextPacketSha256: calculateBlindSafeVisionQaContextPacketSha256(blindContextPacket),
    deterministicVerdict: {
      decision: "PASS",
      defectCodes: []
    },
    annotations: [
      {
        annotationId: `${caseId}:annotation:a`,
        annotatorId: "annotator-a",
        annotationVersion: "rubric-v1",
        completedAt,
        blind: true,
        provenance: reviewerProvenance("a"),
        decision,
        defects
      },
      {
        annotationId: `${caseId}:annotation:b`,
        annotatorId: "annotator-b",
        annotationVersion: "rubric-v1",
        completedAt,
        blind: true,
        provenance: reviewerProvenance("b"),
        decision,
        defects
      }
    ],
    adjudication: {
      adjudicationId: `${caseId}:adjudication`,
      adjudicatorId: "adjudicator-c",
      adjudicationVersion: "rubric-v1",
      completedAt,
      provenance: reviewerProvenance("c"),
      decision,
      defects,
      resolution: defects.length ? "Both annotations identify the same visible defect." : "Both annotations confirm a clean render."
    }
  };
}

type Fixture = {
  root: string;
  selectionInput: VisionQaEvalPartitionInput;
  holdoutInput: VisionQaEvalPartitionInput;
  corpus: FrozenVisionQaEvalCorpus;
  truthByArtifact: Map<string, VisionQaEvalCase>;
};

let fixture: Fixture;

before(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kings-vision-qa-eval-"));
  const selectionCases = [
    await createCase({ root, prefix: "selection", index: 0, groundTruthClass: "clean" }),
    await createCase({
      root,
      prefix: "selection",
      index: 1,
      groundTruthClass: "defective",
      defectCode: "unsafe_crop"
    })
  ];
  const holdoutCases: VisionQaEvalCase[] = [];
  for (let index = 0; index < 120; index += 1) {
    holdoutCases.push(
      await createCase({
        root,
        prefix: "holdout",
        index,
        groundTruthClass: index < 40 ? "clean" : "defective",
        defectCode: index < 80 ? "unsafe_crop" : "missing_hook"
      })
    );
  }
  const selectionInput: VisionQaEvalPartitionInput = {
    schemaVersion: VISION_QA_EVAL_CORPUS_VERSION,
    partition: "selection_pool",
    datasetId: "vision-qa-selection",
    datasetVersion: "v1",
    cases: selectionCases
  };
  const holdoutInput: VisionQaEvalPartitionInput = {
    schemaVersion: VISION_QA_EVAL_CORPUS_VERSION,
    partition: "final_holdout",
    datasetId: "vision-qa-final-holdout",
    datasetVersion: "v1",
    cases: holdoutCases
  };
  const selectionPool = await freezeVisionQaEvalPartition(selectionInput);
  const finalHoldout = await freezeVisionQaEvalPartition(holdoutInput);
  fixture = {
    root,
    selectionInput,
    holdoutInput,
    corpus: assembleFrozenVisionQaEvalCorpus({ selectionPool, finalHoldout }),
    truthByArtifact: new Map(holdoutCases.map((evalCase) => [evalCase.artifactSha256, evalCase]))
  };
});

after(async () => {
  if (fixture?.root) await fs.rm(fixture.root, { recursive: true, force: true });
});

function selectedJudge() {
  return {
    ...JUDGE,
    selectionPoolSha256: fixture.corpus.selectionPool.partitionSha256
  };
}

function baseVerdict(input: {
  channelId: string;
  templateSha256: string;
}): VisionQaOutput {
  return {
    decision: "PASS",
    channelId: input.channelId,
    templateSha256: input.templateSha256,
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

function fakeJudge(options: {
  missCritical?: boolean;
  missNoncriticalCount?: number;
  rejectCleanCount?: number;
  observe?: (keys: string[], token: string) => void;
} = {}): BlindVisionQaJudge {
  let noncriticalMisses = 0;
  return async (input) => {
    options.observe?.(Object.keys(input).sort(), input.blindCaseToken);
    const truth = fixture.truthByArtifact.get(input.artifact.sha256);
    assert.ok(truth);
    const verdict = baseVerdict(input);
    const groundTruthDefect = truth.adjudication.defects[0];
    const shouldMiss =
      (groundTruthDefect?.code === "unsafe_crop" && options.missCritical) ||
      (groundTruthDefect?.code === "missing_hook" &&
        noncriticalMisses++ < (options.missNoncriticalCount ?? 0));
    if (groundTruthDefect && !shouldMiss) {
      verdict.decision = "FAIL";
      if (groundTruthDefect.code === "unsafe_crop") verdict.cropSafe = false;
      if (groundTruthDefect.code === "missing_hook") verdict.hookPresent = false;
    }
    if (!groundTruthDefect && (options.rejectCleanCount ?? 0) > 0) {
      const caseIndex = Number(truth.caseId.split("-").at(-1));
      if (caseIndex < (options.rejectCleanCount ?? 0)) {
        verdict.decision = "FAIL";
        verdict.hookPresent = false;
      }
    }
    const provenance = {
      invocationId: `invocation:${input.blindCaseToken}`,
      routeId: JUDGE.routeId,
      model: JUDGE.model,
      reasoningEffort: JUDGE.reasoningEffort,
      executionBoundary: "separate_process" as const,
      adapterId: JUDGE.isolation.adapterId,
      adapterSha256: JUDGE.isolation.adapterSha256,
      routeManifestSha256: JUDGE.routeManifestSha256,
      routeBenchmarkEvidenceSha256: JUDGE.routeBenchmarkEvidenceSha256,
      requestSha256: calculateBlindVisionQaJudgeRequestSha256(input),
      verdictSha256: calculateBlindVisionQaJudgeVerdictSha256(verdict)
    };
    return {
      verdict,
      invocationEvidenceSha256: calculateBlindVisionQaJudgeInvocationEvidenceSha256(provenance),
      provenance
    };
  };
}

test("selection pool and 40-clean/80-defective final holdout are sealed separately", async () => {
  assert.equal(Object.isFrozen(fixture.corpus.selectionPool), true);
  assert.equal(Object.isFrozen(fixture.corpus.finalHoldout), true);
  assert.deepEqual(fixture.corpus.finalHoldout.counts, {
    total: 120,
    clean: 40,
    defective: 80,
    criticalDefective: 40
  });
  assert.match(fixture.corpus.selectionPool.partitionSha256, /^[a-f0-9]{64}$/);
  assert.match(fixture.corpus.finalHoldout.partitionSha256, /^[a-f0-9]{64}$/);
  assert.equal(fixture.corpus.finalHoldout.cases.every((evalCase) => evalCase.verifiedFrames.length === 3), true);

  const outputPath = path.join(fixture.root, "frozen-selection.json");
  await writeFrozenVisionQaEvalPartition(outputPath, fixture.corpus.selectionPool);
  await assert.rejects(
    () => writeFrozenVisionQaEvalPartition(outputPath, fixture.corpus.selectionPool),
    /EEXIST/
  );
});

test("perfect blind judge passes all exact launch gates in three sequential runs", async () => {
  const outputDirectory = path.join(fixture.root, "perfect-eval-evidence");
  const blindInputKeys = new Set<string>();
  const blindTokens = new Set<string>();
  let clock = 0;
  let active = 0;
  let maxActive = 0;
  let inspectedContext = false;
  const judge = fakeJudge({
    observe: (keys, token) => {
      blindInputKeys.add(keys.join(","));
      blindTokens.add(token);
    }
  });
  const result = await runBlindVisionQaLaunchEvaluation({
    corpus: fixture.corpus,
    selectedJudge: selectedJudge(),
    outputDirectory,
    now: () => new Date("2026-07-10T12:00:00.000Z"),
    monotonicNowMs: () => clock,
    judge: async (input) => {
      if (!inspectedContext) {
        inspectedContext = true;
        assert.equal(input.contextPacket.template.layoutKind, "classic_top_bottom");
        assert.deepEqual(input.contextPacket.template.mediaViewport, {
          x: 0.05, y: 0.22, width: 0.9, height: 0.55
        });
        assert.equal(input.contextPacket.source.crop.coordinateSpace, "normalized_source");
        const packetJson = JSON.stringify(input.contextPacket);
        assert.doesNotMatch(packetJson, /groundTruthClass|adjudication|annotationId|injectionRecipe/);
      }
      active += 1;
      maxActive = Math.max(maxActive, active);
      clock += 5;
      const judged = await judge(input);
      active -= 1;
      return judged;
    }
  });

  assert.equal(result.runs.length, 3);
  assert.equal(maxActive, 1);
  assert.equal(blindTokens.size, 360);
  assert.deepEqual([...blindInputKeys], [
    "artifact,blindCaseToken,channelId,conceptId,contextPacket,contextPacketSha256,frames,templateSha256"
  ]);
  for (const run of result.runs) {
    assert.equal(run.samples.length, 120);
    assert.equal(run.metrics.criticalDefectRecall, 1);
    assert.equal(run.metrics.allDefectRecall, 1);
    assert.equal(run.metrics.cleanPassPrecision, 1);
    assert.equal(run.metrics.cleanAcceptanceRate, 1);
    assert.equal(run.metrics.criticalFalsePasses, 0);
    assert.equal(run.metrics.judgeErrors, 0);
    assert.equal(run.metrics.deterministicVisionDisagreements, 80);
    assert.equal(run.metrics.byDefectCode.unsafe_crop.recall, 1);
    assert.equal(run.metrics.byDefectCode.missing_hook.recall, 1);
    assert.equal(run.metrics.byChannel[CHANNEL_ID]!.cleanAcceptanceRate, 1);
    assert.equal(run.launchGatePassed, true);
    assert.match(run.evidenceSha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(result.launch.launchReady, true);
  assert.deepEqual(result.launch.failedRunIndexes, []);
  assert.equal(Object.isFrozen(result.launch), true);
  assert.deepEqual((await fs.readdir(outputDirectory)).sort(), [
    "vision-qa-eval-run-01.json",
    "vision-qa-eval-run-02.json",
    "vision-qa-eval-run-03.json",
    "vision-qa-launch-evidence.json"
  ]);
});

test("critical false-passes block launch in every run", async () => {
  const result = await runBlindVisionQaLaunchEvaluation({
    corpus: fixture.corpus,
    selectedJudge: selectedJudge(),
    judge: fakeJudge({ missCritical: true })
  });

  for (const run of result.runs) {
    assert.equal(run.metrics.criticalDefectRecall, 0);
    assert.equal(run.metrics.criticalFalsePasses, 40);
    assert.equal(run.launchGatePassed, false);
  }
  assert.equal(result.launch.launchReady, false);
  assert.deepEqual(result.launch.failedRunIndexes, [1, 2, 3]);
});

test("95 percent all-defect recall and 90 percent clean PASS precision are inclusive gates", async () => {
  const boundary = await runBlindVisionQaLaunchEvaluation({
    corpus: fixture.corpus,
    selectedJudge: selectedJudge(),
    judge: fakeJudge({ missNoncriticalCount: 4 })
  });
  assert.equal(boundary.runs[0].metrics.allDefectRecall, 0.95);
  assert.ok(boundary.runs[0].metrics.cleanPassPrecision >= 0.9);
  assert.equal(boundary.launch.launchReady, true);

  const below = await runBlindVisionQaLaunchEvaluation({
    corpus: fixture.corpus,
    selectedJudge: selectedJudge(),
    judge: fakeJudge({ missNoncriticalCount: 5 })
  });
  assert.ok(below.runs[0].metrics.allDefectRecall < 0.95);
  assert.ok(below.runs[0].metrics.cleanPassPrecision < 0.9);
  assert.equal(below.launch.launchReady, false);
});

test("90 percent clean acceptance is an inclusive gate independent of clean PASS precision", async () => {
  const boundary = await runBlindVisionQaLaunchEvaluation({
    corpus: fixture.corpus,
    selectedJudge: selectedJudge(),
    judge: fakeJudge({ rejectCleanCount: 4 })
  });
  assert.equal(boundary.runs[0].metrics.cleanAcceptanceRate, 0.9);
  assert.equal(boundary.runs[0].metrics.cleanPassPrecision, 1);
  assert.equal(boundary.launch.launchReady, true);

  const below = await runBlindVisionQaLaunchEvaluation({
    corpus: fixture.corpus,
    selectedJudge: selectedJudge(),
    judge: fakeJudge({ rejectCleanCount: 5 })
  });
  assert.equal(below.runs[0].metrics.cleanAcceptanceRate, 0.875);
  assert.equal(below.runs[0].metrics.cleanPassPrecision, 1);
  assert.equal(below.launch.launchReady, false);
});

test("missing artifacts, duplicate hashes and non-independent annotation fail closed", async () => {
  const first = fixture.selectionInput.cases[0]!;
  await assert.rejects(
    () =>
      freezeVisionQaEvalPartition({
        ...fixture.selectionInput,
        cases: [{ ...first, artifactPath: path.join(fixture.root, "missing.mp4") }]
      }),
    /artifact is missing|hash changed/
  );

  await assert.rejects(
    () => freezeVisionQaEvalPartition({
      ...fixture.selectionInput,
      cases: [{
        ...first,
        artifactPath: path.join(fixture.root, "unsafe_crop", "render.mp4")
      }]
    }),
    /leaks a label or injection recipe/
  );

  const second = fixture.selectionInput.cases[1]!;
  await assert.rejects(
    () =>
      freezeVisionQaEvalPartition({
        ...fixture.selectionInput,
        cases: [
          first,
          {
            ...second,
            artifactPath: first.artifactPath,
            artifactSha256: first.artifactSha256,
            frameManifestPath: first.frameManifestPath,
            frameManifestSha256: first.frameManifestSha256
          }
        ]
      }),
    /Duplicate artifact hash/
  );

  await assert.rejects(
    () =>
      freezeVisionQaEvalPartition({
        ...fixture.selectionInput,
        cases: [
          {
            ...first,
            annotations: [
              first.annotations[0],
              { ...first.annotations[1], annotatorId: first.annotations[0].annotatorId }
            ]
          }
        ]
      }),
    /independent annotators/
  );

  await assert.rejects(
    () =>
      freezeVisionQaEvalPartition({
        ...fixture.selectionInput,
        cases: [{
          ...first,
          annotations: [
            first.annotations[0],
            {
              ...first.annotations[1],
              provenance: {
                ...first.annotations[1].provenance,
                independenceKey: first.annotations[0].provenance.independenceKey
              }
            }
          ]
        }]
      }),
    /independent reviewer provenance/
  );
});

test("selection-to-holdout leakage and insufficient final counts fail closed", async () => {
  const leakedHoldout = await freezeVisionQaEvalPartition({
    ...fixture.holdoutInput,
    cases: fixture.holdoutInput.cases.map((evalCase, index) => {
      if (index !== 0) return evalCase;
      const leakedSource = fixture.selectionInput.cases[0]!.blindContextPacket.source.artifact;
      const blindContextPacket = {
        ...evalCase.blindContextPacket,
        source: { ...evalCase.blindContextPacket.source, artifact: leakedSource }
      };
      return {
        ...evalCase,
        sourceSha256: leakedSource.sha256,
        blindContextPacket,
        blindContextPacketSha256: calculateBlindSafeVisionQaContextPacketSha256(blindContextPacket)
      };
    })
  });
  await assert.rejects(
    async () =>
      assembleFrozenVisionQaEvalCorpus({
        selectionPool: fixture.corpus.selectionPool,
        finalHoldout: leakedHoldout
      }),
    /data leakage.*source hash/i
  );

  const insufficientHoldout = await freezeVisionQaEvalPartition({
    ...fixture.holdoutInput,
    cases: fixture.holdoutInput.cases.slice(0, 119)
  });
  assert.throws(
    () =>
      assembleFrozenVisionQaEvalCorpus({
        selectionPool: fixture.corpus.selectionPool,
        finalHoldout: insufficientHoldout
      }),
    VisionQaEvalError
  );
});

test("judge selection binding and on-disk frozen artifacts are rechecked before evaluation", async () => {
  await assert.rejects(
    () =>
      runBlindVisionQaLaunchEvaluation({
        corpus: fixture.corpus,
        selectedJudge: { ...selectedJudge(), selectionPoolSha256: "0".repeat(64) },
        judge: fakeJudge()
      }),
    /not bound to this frozen selection pool/
  );

  await assert.rejects(
    () =>
      runBlindVisionQaLaunchEvaluation({
        corpus: fixture.corpus,
        selectedJudge: {
          ...selectedJudge(),
          isolation: undefined
        } as unknown as ReturnType<typeof selectedJudge>,
        judge: fakeJudge()
      }),
    /selectedJudge\.isolation/
  );

  const missingInvocationProvenance = await runBlindVisionQaLaunchEvaluation({
    corpus: fixture.corpus,
    selectedJudge: selectedJudge(),
    judge: (async (input) => {
      const valid = await fakeJudge()(input);
      return {
        verdict: valid.verdict,
        invocationEvidenceSha256: valid.invocationEvidenceSha256
      } as unknown as Awaited<ReturnType<BlindVisionQaJudge>>;
    })
  });
  assert.equal(missingInvocationProvenance.launch.launchReady, false);
  assert.equal(missingInvocationProvenance.runs[0].metrics.judgeErrors, 120);
  assert.equal(
    missingInvocationProvenance.runs[0].samples.every((sample) =>
      sample.visionDecision === "ERROR" && /provenance/.test(sample.error ?? "")),
    true
  );

  const framePath = fixture.corpus.finalHoldout.cases[0]!.verifiedFrames[0]!.filePath;
  const original = await fs.readFile(framePath);
  try {
    await fs.writeFile(framePath, "tampered-frame");
    await assert.rejects(
      () =>
        runBlindVisionQaLaunchEvaluation({
          corpus: fixture.corpus,
          selectedJudge: selectedJudge(),
          judge: fakeJudge()
        }),
      /Frozen partition frame.*changed/
    );
  } finally {
    await fs.writeFile(framePath, original);
  }

  const sourceFramePath = fixture.corpus.finalHoldout.cases[0]!.blindContextPacket.source.frames[0]!.filePath;
  const originalSourceFrame = await fs.readFile(sourceFramePath);
  try {
    await fs.writeFile(sourceFramePath, "tampered-source-frame");
    await assert.rejects(
      () => runBlindVisionQaLaunchEvaluation({
        corpus: fixture.corpus,
        selectedJudge: selectedJudge(),
        judge: fakeJudge()
      }),
      /source frame.*hash changed/
    );
  } finally {
    await fs.writeFile(sourceFramePath, originalSourceFrame);
  }
});
