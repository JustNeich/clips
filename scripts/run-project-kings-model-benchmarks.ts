import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

import {
  type ProductionAgentArtifact,
  type ProductionAgentOutputByRole,
  type ProductionAgentPacketByRole,
  type ProductionAgentRole
} from "../lib/project-kings/production-agent-contracts";
import {
  ModelBenchmarkHarnessError,
  SOURCE_POLICY_PRODUCTION_MINIMUM_SAMPLE_SIZE,
  runStageSpecificModelBenchmark,
  type ModelBenchmarkPricingEvidence,
  type ModelBenchmarkQualityEvaluation,
  type ModelBenchmarkQualityEvaluator,
  type StageModelBenchmarkDataset
} from "../lib/project-kings/model-benchmark";
import {
  PROJECT_KINGS_V1_MODEL_REGISTRY,
  type ModelSelectionPolicy
} from "../lib/project-kings/model-routing";
import { createCodexProductionAgentInvoker } from "../lib/project-kings/production-agent-runtime";
import {
  loadProjectKingsSourcePolicyBenchmarkDataset
} from "../lib/project-kings/source-policy-benchmark-dataset";
import {
  DARK_JOY_BOY_PROJECT_KINGS_PROFILE,
  LIGHT_KINGDOM_PROJECT_KINGS_PROFILE
} from "../lib/project-kings/pilot-production-profiles";
import { COPSCOPES_PROJECT_KINGS_PROFILE } from "../lib/project-kings/copscopes-production-profile";

const REPO_ROOT = path.resolve(__dirname, "..");
const EVIDENCE_ROOT = path.join(
  REPO_ROOT,
  "docs/project-kings-production-pipeline-v1/evidence"
);
const RATE_CARD_PATH = path.join(EVIDENCE_ROOT, "codex-rate-card-2026-07-10.json");
const BENCHMARK_VERSION = "project-kings-stage-models-2026-07-10-v9";
const BENCHMARK_EVIDENCE_VERSION = "v9";
const SOURCE_POLICY_BENCHMARK_VERSION =
  "project-kings-source-policy-real-30-2026-07-10-v4";
const SOURCE_POLICY_BENCHMARK_EVIDENCE_VERSION = "real-30-v4";

type AnyPacket = ProductionAgentPacketByRole[ProductionAgentRole];
type AnyOutput = ProductionAgentOutputByRole[ProductionAgentRole];

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
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

function sha256Json(value: unknown): string {
  return sha256(JSON.stringify(canonicalize(value)));
}

function compactError(value: unknown): string {
  const message = (value instanceof Error ? value.message : String(value)).trim();
  return message.length <= 4_000
    ? message
    : `${message.slice(0, 750)}\n... [diagnostics truncated] ...\n${message.slice(-3_000)}`;
}

async function writeFixture(
  root: string,
  fileName: string,
  value: unknown,
  kind: ProductionAgentArtifact["kind"]
): Promise<ProductionAgentArtifact> {
  const filePath = path.join(root, fileName);
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(filePath, content, { encoding: "utf-8", flag: "wx" });
  return {
    id: path.parse(fileName).name,
    kind,
    mediaType: "json",
    path: filePath,
    sha256: sha256(content)
  };
}

async function imageArtifact(
  id: string,
  relativePath: string
): Promise<ProductionAgentArtifact> {
  const filePath = path.join(REPO_ROOT, relativePath);
  const bytes = await fs.readFile(filePath);
  return {
    id,
    kind: "preview_frame",
    mediaType: "image",
    path: filePath,
    sha256: sha256(bytes)
  };
}

function escapeSvgText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function svgTextLines(input: {
  lines: readonly string[];
  startY: number;
  lineHeight: number;
  fontSize: number;
  fill: string;
  fontWeight?: number;
}): string {
  return input.lines
    .map((line, index) =>
      `<text x="360" y="${input.startY + index * input.lineHeight}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${input.fontSize}" font-weight="${input.fontWeight ?? 700}" fill="${input.fill}">${escapeSvgText(line)}</text>`
    )
    .join("");
}

async function createPreviewFrameArtifact(input: {
  root: string;
  id: string;
  sourceRelativePath: string;
  topLines: readonly string[];
  bottomLines: readonly string[];
  foreignCaptionLines?: readonly string[];
}): Promise<ProductionAgentArtifact> {
  const width = 720;
  const height = 1_280;
  const topHeight = 280;
  const mediaHeight = 720;
  const bottomY = topHeight + mediaHeight;
  const sourcePath = path.join(REPO_ROOT, input.sourceRelativePath);
  const outputPath = path.join(input.root, `${input.id}.jpg`);
  const media = await sharp(sourcePath)
    .resize(width, mediaHeight, { fit: "contain", background: "#10151b" })
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toBuffer();
  const overlay = Buffer.from([
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`,
    `<rect x="0" y="0" width="${width}" height="${topHeight}" fill="#ffffff"/>`,
    `<rect x="0" y="${bottomY}" width="${width}" height="${height - bottomY}" fill="#ffffff"/>`,
    svgTextLines({ lines: input.topLines, startY: 84, lineHeight: 72, fontSize: 54, fill: "#101010", fontWeight: 800 }),
    svgTextLines({ lines: input.bottomLines, startY: bottomY + 94, lineHeight: 68, fontSize: 48, fill: "#101010", fontWeight: 700 }),
    input.foreignCaptionLines?.length
      ? [
          `<rect x="70" y="700" width="580" height="138" rx="10" fill="#000000" fill-opacity="0.72"/>`,
          svgTextLines({ lines: input.foreignCaptionLines, startY: 754, lineHeight: 54, fontSize: 36, fill: "#ffffff", fontWeight: 700 })
        ].join("")
      : "",
    "</svg>"
  ].join(""));
  await sharp({ create: { width, height, channels: 3, background: "#0a1118" } })
    .composite([
      { input: media, left: 0, top: topHeight },
      { input: overlay, left: 0, top: 0 }
    ])
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toFile(outputPath);
  const bytes = await fs.readFile(outputPath);
  return {
    id: input.id,
    kind: "preview_frame",
    mediaType: "image",
    path: outputPath,
    sha256: sha256(bytes)
  };
}

function orderedArtifactSha256(artifacts: readonly ProductionAgentArtifact[]): string {
  return sha256(artifacts.map((artifact) => `${artifact.id}:${artifact.sha256}`).join("\n"));
}

async function orderedFileSha256(relativePaths: readonly string[]): Promise<string> {
  const hashes = await Promise.all(relativePaths.map(async (relativePath) => {
    const bytes = await fs.readFile(path.join(REPO_ROOT, relativePath));
    return `${relativePath}:${sha256(bytes)}`;
  }));
  return sha256(hashes.join("\n"));
}

function basePacket<R extends ProductionAgentRole>(input: {
  role: R;
  caseId: string;
  channelId: string;
  task: ProductionAgentPacketByRole[R]["task"];
  artifacts: ProductionAgentArtifact[];
}): ProductionAgentPacketByRole[R] {
  return {
    schemaVersion: "production-agent-packet-v1",
    role: input.role,
    runId: `benchmark-${input.role}`,
    itemId: input.caseId,
    channelId: input.channelId,
    profileVersion: "project-kings-profile-v1",
    task: input.task,
    artifacts: input.artifacts
  } as unknown as ProductionAgentPacketByRole[R];
}

function evaluateBenchmarkQuality(input: {
  role: ProductionAgentRole;
  caseId: string;
  expectedQualityLabel: string;
  output: AnyOutput;
}): ModelBenchmarkQualityEvaluation {
  const record = input.output as unknown as Record<string, unknown>;
  let actual = typeof record.decision === "string"
    ? record.decision
    : typeof record.action === "string"
      ? record.action
      : "missing";
  if (input.role === "source_policy") {
    const signals = record.signals && typeof record.signals === "object"
      ? record.signals as Record<string, unknown>
      : null;
    const abbreviate = (value: unknown) =>
      value === "absent" ? "a" : value === "present" ? "p" : value === "unknown" ? "u" : "x";
    actual = signals
      ? `sp:${[
          "graphicViolence",
          "unsupportedAllegation",
          "minorInSensitiveIncident",
          "realisticPoliticalOrPublicFigureDeepfake"
        ].map((key) => abbreviate(signals[key])).join(",")}`
      : "missing";
  }
  const evidence: string[] = [`expected=${input.expectedQualityLabel}`, `actual=${actual}`];
  let passed = actual === input.expectedQualityLabel;

  if (input.role === "source_search") {
    const candidates = Array.isArray(record.candidates) ? record.candidates : [];
    passed &&= actual === "NO_MATCH" ? candidates.length === 0 : candidates.length > 0;
    evidence.push(`candidates=${candidates.length}`);
  } else if (input.role === "source_fit") {
    if (input.caseId.includes("clean")) {
      passed &&= record.conceptMatch === true && record.factualFit === true && record.sourceUsable === true;
    }
    if (input.caseId.includes("duplicate")) passed &&= record.duplicateEvent === true || record.duplicateVideo === true;
    if (input.caseId.includes("offconcept")) passed &&= record.conceptMatch === false;
  } else if (input.role === "source_policy") {
    const signals = record.signals as Record<string, unknown> | undefined;
    passed &&=
      Boolean(signals) &&
      Object.keys(signals ?? {}).length === 4 &&
      record.candidateId === input.caseId;
    evidence.push(`signals=${JSON.stringify(signals ?? {})}`);
  } else if (input.role === "caption") {
    const banned = Array.isArray(record.bannedWordsFound) ? record.bannedWordsFound : [];
    passed &&=
      typeof record.hook === "string" && record.hook.length > 0 &&
      typeof record.action === "string" && record.action.length > 0 &&
      typeof record.payoff === "string" && record.payoff.length > 0 &&
      banned.length === 0;
    evidence.push(`bannedWordsFound=${banned.length}`);
  } else if (input.role === "montage_planner") {
    const segments = Array.isArray(record.segments) ? record.segments as Array<Record<string, unknown>> : [];
    const purposes = new Set(segments.map((segment) => segment.purpose));
    passed &&= purposes.has("hook") && purposes.has("action") && purposes.has("payoff");
    evidence.push(`segments=${segments.length}`);
  } else if (input.role === "vision_qa") {
    const defects = Array.isArray(record.defects) ? record.defects as Array<Record<string, unknown>> : [];
    const defectCodes = defects
      .map((defect) => defect.code)
      .filter((code): code is string => typeof code === "string");
    if (input.caseId.includes("clean")) {
      passed &&=
        defects.length === 0 &&
        record.conceptMatch === true &&
        record.duplicateVideo === false &&
        record.duplicateEvent === false &&
        record.hookPresent === true &&
        record.actionPresent === true &&
        record.payoffPresent === true &&
        record.donorUiVisible === false &&
        record.ctaVisible === false &&
        record.handleVisible === false &&
        record.watermarkVisible === false &&
        record.foreignCaptionsVisible === false &&
        record.mainEventPreserved === true &&
        record.cropSafe === true &&
        record.factualClaimsVerified === true &&
        record.bannedWordsPresent === false;
    }
    if (input.caseId.includes("hardsub")) {
      passed &&=
        record.foreignCaptionsVisible === true &&
        defectCodes.includes("foreign_captions");
    }
    if (input.caseId.includes("offconcept")) {
      passed &&=
        record.conceptMatch === false &&
        defectCodes.includes("concept_mismatch");
    }
    evidence.push(
      `defects=${defects.length}`,
      `defectCodes=${defectCodes.join(",") || "none"}`,
      `conceptMatch=${String(record.conceptMatch)}`,
      `foreignCaptionsVisible=${String(record.foreignCaptionsVisible)}`
    );
  } else if (input.role === "revision") {
    const changes = Array.isArray(record.changes) ? record.changes : [];
    if (["deterministic_repair", "targeted_regenerate", "targeted_visual_revision"].includes(actual)) {
      passed &&= changes.length > 0;
    }
    evidence.push(
      `changes=${changes.length}`,
      `resumeState=${String(record.resumeState)}`
    );
  }

  return {
    label: actual,
    score: passed ? 1 : 0,
    passed,
    evidence
  };
}

function qualityEvaluator(): ModelBenchmarkQualityEvaluator {
  const rules = {
    version: 1,
    sourceSearch: "decision and candidate cardinality",
    sourceFit: "decision plus fit/duplicate flags",
    sourcePolicy: "exact ordered four-signal absent/present/unknown vector plus candidate binding",
    caption: "hook-action-payoff and banned words",
    montage: "hook-action-payoff segments",
    vision: "decision plus required defect class",
    revision: "exact action plus non-empty targeted changes"
  };
  return {
    evaluatorId: "project-kings-stage-quality",
    evaluatorVersion: "v1",
    implementationSha256: sha256(`${evaluateBenchmarkQuality.toString()}\n${JSON.stringify(rules)}`),
    config: rules,
    evaluate: ({ role, caseId, expectedQualityLabel, output }) =>
      evaluateBenchmarkQuality({ role, caseId, expectedQualityLabel, output })
  };
}

async function buildDatasets(root: string): Promise<Record<ProductionAgentRole, StageModelBenchmarkDataset<any>>> {
  const darkConcept = await writeFixture(root, "dark-concept.json", DARK_JOY_BOY_PROJECT_KINGS_PROFILE, "concept_contract");
  const lightConcept = await writeFixture(root, "light-concept.json", LIGHT_KINGDOM_PROJECT_KINGS_PROFILE, "concept_contract");
  const copConcept = await writeFixture(root, "cop-concept.json", COPSCOPES_PROJECT_KINGS_PROFILE, "concept_contract");
  const sourcePool = await writeFixture(root, "source-pool.json", {
    candidates: [
      { id: "dark-clean", url: "https://www.instagram.com/reel/Cxb0DmpJ7oM/", storyEventId: "event-towel-wrapped-spider-monkey-held-close", summary: "A keeper holds a baby spider monkey close." },
      { id: "cop-clean", url: "https://www.instagram.com/reel/DXUPExpjCs2/", storyEventId: "event-troopers-save-choking-baby", summary: "Troopers visibly rescue a choking baby." }
    ]
  }, "source_pool");
  const emptyPool = await writeFixture(root, "empty-source-pool.json", { candidates: [], exhausted: ["instagram", "youtube_ask", "reserve_pool"] }, "source_pool");
  const darkMetadata = await writeFixture(root, "dark-source-metadata.json", {
    candidateId: "dark-clean",
    sourceUrl: "https://www.instagram.com/reel/DDR2PcXRP4j/",
    storyEventId: "event-man-bathes-baby-spider-monkey",
    visibleEvent: "A man visibly bathes a baby spider monkey in a bathtub.",
    sourceUsable: true,
    factualClaims: []
  }, "source_metadata");
  const duplicateMetadata = await writeFixture(root, "duplicate-source-metadata.json", {
    candidateId: "duplicate-event",
    sourceUrl: "https://www.instagram.com/reel/repost-one/",
    storyEventId: "event-towel-wrapped-spider-monkey-held-close",
    contentSha256: "b".repeat(64),
    visibleEvent: "The same previously used event is reposted."
  }, "source_metadata");
  const offConceptMetadata = await writeFixture(root, "offconcept-source-metadata.json", {
    candidateId: "offconcept-police",
    sourceUrl: "https://www.instagram.com/reel/DW5oCZGjPCs/",
    storyEventId: "event-police-firefight",
    visibleEvent: "Police bodycam footage shows an armed roadside incident; no human-animal contact."
  }, "source_metadata");
  const captionEvidence = await writeFixture(root, "caption-evidence.json", {
    verifiedVisibleFacts: ["A keeper holds a towel-wrapped baby spider monkey close.", "The monkey looks toward the keeper."],
    requiredStructure: ["hook", "action", "payoff"],
    prohibitedClaims: ["rescue", "danger", "abandoned"]
  }, "factual_evidence");
  const lightMetadata = await writeFixture(root, "light-source-metadata.json", {
    candidateId: "light-candidate",
    sourceUrl: "https://www.instagram.com/reel/DYpHeq4pM-R/",
    storyEventId: "event-ai-remakes-the-boys-ending",
    visibleEvent: "A recognizable The Boys ending is visibly regenerated into a different AI action payoff.",
    sourceUsable: true,
    factualClaims: []
  }, "source_metadata");
  const lightCaptionEvidence = await writeFixture(root, "light-caption-evidence.json", {
    verifiedVisibleFacts: ["A recognizable The Boys scene is visibly AI-regenerated.", "The changed action payoff is visible without audio."],
    requiredStructure: ["hook", "action", "payoff"],
    prohibitedClaims: ["official ending", "real footage", "studio release"]
  }, "factual_evidence");
  const copMetadata = await writeFixture(root, "cop-source-metadata.json", {
    candidateId: "cop-candidate",
    sourceUrl: "https://www.instagram.com/reel/DXUPExpjCs2/",
    storyEventId: "event-troopers-save-choking-baby",
    visibleEvent: "Maryland troopers visibly help a choking baby and the child begins breathing.",
    sourceUsable: true,
    factualClaims: []
  }, "source_metadata");
  const copCaptionEvidence = await writeFixture(root, "cop-caption-evidence.json", {
    verifiedVisibleFacts: ["Troopers visibly assist a choking baby.", "The rescue payoff is visible."],
    requiredStructure: ["hook", "action", "payoff"],
    prohibitedClaims: ["guilty", "killed", "miracle", "unverified location"]
  }, "factual_evidence");
  const montageBrief = await writeFixture(root, "montage-brief.json", {
    caption: "A BABY MONKEY TRUSTS HIS KEEPER — HE LEANS CLOSER FOR THE FINAL CUDDLE.",
    hook: "A BABY MONKEY TRUSTS HIS KEEPER",
    action: "HE LEANS CLOSER",
    payoff: "THE FINAL CUDDLE"
  }, "caption_brief");

  const cleanAnimalFrame = await imageArtifact("clean-animal-frame", "experiments/source-researcher/gold/darkness-joyboy/frames/DDR2PcXRP4j/out_05.jpg");
  const policeFrame = await imageArtifact("offconcept-police-frame", "experiments/source-researcher/gold/copscopes-x2e/frames/DW5oCZGjPCs/out_04.jpg");

  const cleanSourceFrames = [
    "t0000.5.jpg",
    "t0007.7.jpg",
    "t0015.9.jpg"
  ].map((fileName) => `experiments/montage-agent/variants/v3-input/v3-dark-joyboy-DDR2PcXRP4j/${fileName}`);
  const hardSubSourceFrames = [
    "t0003.6.jpg",
    "t0027.9.jpg",
    "t0054.6.jpg"
  ].map((fileName) => `experiments/montage-agent/variants/v3-input/v3-light-kingdom-DYpHeq4pM-R/${fileName}`);
  const offConceptSourceFrames = [
    "t0002.3.jpg",
    "t0039.5.jpg",
    "t0090.6.jpg"
  ].map((fileName) => `experiments/montage-agent/variants/v3-input/v3-copscopes-DW5oCZGjPCs/${fileName}`);
  const [cleanSourceSha256, hardSubSourceSha256, offConceptSourceSha256] = await Promise.all([
    orderedFileSha256(cleanSourceFrames),
    orderedFileSha256(hardSubSourceFrames),
    orderedFileSha256(offConceptSourceFrames)
  ]);
  const cleanPreviewFrames = await Promise.all(cleanSourceFrames.map((sourceRelativePath, index) => createPreviewFrameArtifact({
    root,
    id: `vision-clean-frame-${index}`,
    sourceRelativePath,
    topLines: ["THE MONKEY REACHES", "TOWARD THE TUB WALL"],
    bottomLines: ["THE KEEPER KEEPS", "BOTH HANDS CLOSE"]
  })));
  const hardSubPreviewFrames = await Promise.all(hardSubSourceFrames.map((sourceRelativePath, index) => createPreviewFrameArtifact({
    root,
    id: `vision-hardsub-frame-${index}`,
    sourceRelativePath,
    topLines: ["A FAMILIAR HERO", "GETS AN AI TWIST"],
    bottomLines: ["THE FINAL SHOWDOWN", "ENDS DIFFERENTLY"],
    foreignCaptionLines: ["enterprise contract with", "rising infrastructure costs"]
  })));
  const offConceptPreviewFrames = await Promise.all(offConceptSourceFrames.map((sourceRelativePath, index) => createPreviewFrameArtifact({
    root,
    id: `vision-offconcept-frame-${index}`,
    sourceRelativePath,
    topLines: ["THE STOP CHANGES", "IN ONE SECOND"],
    bottomLines: ["THE OFFICER MOVES", "TOWARD THE CAR"]
  })));
  const cleanPreviewSha256 = orderedArtifactSha256(cleanPreviewFrames);
  const hardSubPreviewSha256 = orderedArtifactSha256(hardSubPreviewFrames);
  const offConceptPreviewSha256 = orderedArtifactSha256(offConceptPreviewFrames);
  const cleanPreviewEvidence = await writeFixture(root, "vision-clean-grounding.json", {
    evidenceType: "complete_preview_keyframes",
    sourceSha256: cleanSourceSha256,
    previewSha256: cleanPreviewSha256,
    frameOrder: cleanPreviewFrames.map((artifact) => artifact.id),
    timeline: { hook: [0], action: [1], payoff: [2] },
    verifiedVisibleFacts: [
      "A keeper keeps both hands close to a monkey during a bath.",
      "The monkey remains fully visible and reaches toward the tub wall."
    ],
    authorizedTemplateText: [
      "THE MONKEY REACHES TOWARD THE TUB WALL",
      "THE KEEPER KEEPS BOTH HANDS CLOSE"
    ],
    templateRegions: { top: "y=0..279", media: "y=280..999", bottom: "y=1000..1279" },
    bannedWords: [],
    duplicateSourceSha256: [],
    duplicateStoryEventIds: []
  }, "factual_evidence");
  const hardSubPreviewEvidence = await writeFixture(root, "vision-hardsub-grounding.json", {
    evidenceType: "complete_preview_keyframes",
    sourceSha256: hardSubSourceSha256,
    previewSha256: hardSubPreviewSha256,
    frameOrder: hardSubPreviewFrames.map((artifact) => artifact.id),
    timeline: { hook: [0], action: [1], payoff: [2] },
    verifiedVisibleFacts: [
      "A recognizable fictional scene changes into a visible AI-generated action payoff."
    ],
    authorizedTemplateText: [
      "A FAMILIAR HERO GETS AN AI TWIST",
      "THE FINAL SHOWDOWN ENDS DIFFERENTLY"
    ],
    templateRegions: { top: "y=0..279", media: "y=280..999", bottom: "y=1000..1279" },
    bannedWords: [],
    duplicateSourceSha256: [],
    duplicateStoryEventIds: []
  }, "factual_evidence");
  const offConceptPreviewEvidence = await writeFixture(root, "vision-offconcept-grounding.json", {
    evidenceType: "complete_preview_keyframes",
    sourceSha256: offConceptSourceSha256,
    previewSha256: offConceptPreviewSha256,
    frameOrder: offConceptPreviewFrames.map((artifact) => artifact.id),
    timeline: { hook: [0], action: [1], payoff: [2] },
    verifiedVisibleFacts: [
      "The frames show a police traffic-stop incident and no human-animal contact."
    ],
    authorizedTemplateText: [
      "THE STOP CHANGES IN ONE SECOND",
      "THE OFFICER MOVES TOWARD THE CAR"
    ],
    templateRegions: { top: "y=0..279", media: "y=280..999", bottom: "y=1000..1279" },
    bannedWords: [],
    duplicateSourceSha256: [],
    duplicateStoryEventIds: []
  }, "factual_evidence");

  const sourceSearchCases = [
    {
      caseId: "source-search-dark-found",
      expectedQualityLabel: "FOUND",
      packet: basePacket({ role: "source_search", caseId: "source-search-dark-found", channelId: DARK_JOY_BOY_PROJECT_KINGS_PROFILE.youtube.channelId, task: { targetCandidateCount: 2, querySeeds: ["close human contact with exotic animals"], allowedStrategies: ["instagram", "reserve_pool"], excludedStoryEventIds: [] }, artifacts: [darkConcept, sourcePool] })
    },
    {
      caseId: "source-search-cop-found",
      expectedQualityLabel: "FOUND",
      packet: basePacket({ role: "source_search", caseId: "source-search-cop-found", channelId: COPSCOPES_PROJECT_KINGS_PROFILE.youtube.channelId, task: { targetCandidateCount: 1, querySeeds: ["visible police rescue payoff"], allowedStrategies: ["instagram", "reserve_pool"], excludedStoryEventIds: ["event-police-firefight"] }, artifacts: [copConcept, sourcePool] })
    },
    {
      caseId: "source-search-exhausted",
      expectedQualityLabel: "NO_MATCH",
      packet: basePacket({ role: "source_search", caseId: "source-search-exhausted", channelId: LIGHT_KINGDOM_PROJECT_KINGS_PROFILE.youtube.channelId, task: { targetCandidateCount: 2, querySeeds: ["recognizable fiction with visible AI twist"], allowedStrategies: ["instagram", "youtube_ask", "reserve_pool"], excludedStoryEventIds: ["event-claude-inside-the-office", "event-ai-remakes-the-boys-ending", "event-michael-scott-onboards-karpathy"] }, artifacts: [lightConcept, emptyPool] })
    }
  ];

  const sourcePolicyDataset = await loadProjectKingsSourcePolicyBenchmarkDataset({
    repoRoot: REPO_ROOT
  });

  const sourceFitCases = [
    {
      caseId: "source-fit-clean",
      expectedQualityLabel: "PASS",
      packet: basePacket({ role: "source_fit", caseId: "source-fit-clean", channelId: DARK_JOY_BOY_PROJECT_KINGS_PROFILE.youtube.channelId, task: { candidateId: "dark-clean", sourceUrl: "https://www.instagram.com/reel/DDR2PcXRP4j/", sourceSha256: "b".repeat(64), claimedStoryEventId: "event-man-bathes-baby-spider-monkey", knownSourceSha256: [], knownStoryEventIds: [] }, artifacts: [darkConcept, darkMetadata, cleanAnimalFrame] })
    },
    {
      caseId: "source-fit-duplicate",
      expectedQualityLabel: "FAIL",
      packet: basePacket({ role: "source_fit", caseId: "source-fit-duplicate", channelId: DARK_JOY_BOY_PROJECT_KINGS_PROFILE.youtube.channelId, task: { candidateId: "duplicate-event", sourceUrl: "https://www.instagram.com/reel/repost-one/", sourceSha256: "b".repeat(64), claimedStoryEventId: "event-towel-wrapped-spider-monkey-held-close", knownSourceSha256: ["b".repeat(64)], knownStoryEventIds: ["event-towel-wrapped-spider-monkey-held-close"] }, artifacts: [darkConcept, duplicateMetadata, cleanAnimalFrame] })
    },
    {
      caseId: "source-fit-offconcept",
      expectedQualityLabel: "FAIL",
      packet: basePacket({ role: "source_fit", caseId: "source-fit-offconcept", channelId: DARK_JOY_BOY_PROJECT_KINGS_PROFILE.youtube.channelId, task: { candidateId: "offconcept-police", sourceUrl: "https://www.instagram.com/reel/DW5oCZGjPCs/", sourceSha256: "c".repeat(64), claimedStoryEventId: "event-police-firefight", knownSourceSha256: [], knownStoryEventIds: [] }, artifacts: [darkConcept, offConceptMetadata, policeFrame] })
    }
  ];

  const captionCases = ["dark", "light", "cop"].map((kind) => {
    const profile = kind === "dark" ? DARK_JOY_BOY_PROJECT_KINGS_PROFILE : kind === "light" ? LIGHT_KINGDOM_PROJECT_KINGS_PROFILE : COPSCOPES_PROJECT_KINGS_PROFILE;
    const concept = kind === "dark" ? darkConcept : kind === "light" ? lightConcept : copConcept;
    const metadata = kind === "dark" ? darkMetadata : kind === "light" ? lightMetadata : copMetadata;
    const evidence = kind === "dark" ? captionEvidence : kind === "light" ? lightCaptionEvidence : copCaptionEvidence;
    const caseId = `caption-${kind}`;
    return {
      caseId,
      expectedQualityLabel: "PASS",
      packet: basePacket({ role: "caption", caseId, channelId: profile.youtube.channelId, task: { candidateId: `${kind}-candidate`, language: "English", templateType: kind === "cop" ? "lead_main" : "top_bottom", maxCharacters: 180, bannedWords: ["killed", "guilty", "shocking", "unbelievable"] }, artifacts: [concept, metadata, evidence] })
    };
  });

  const montageCases = [18, 24, 30].map((targetDurationSec, index) => {
    const caseId = `montage-${targetDurationSec}s`;
    return {
      caseId,
      expectedQualityLabel: "PASS",
      packet: basePacket({ role: "montage_planner", caseId, channelId: DARK_JOY_BOY_PROJECT_KINGS_PROFILE.youtube.channelId, task: { candidateId: `montage-${index + 1}`, sourceDurationSec: 42, targetDurationSec, captionText: "A BABY MONKEY TRUSTS HIS KEEPER — HE LEANS CLOSER FOR THE FINAL CUDDLE." }, artifacts: [darkConcept, darkMetadata, montageBrief, cleanAnimalFrame] })
    };
  });

  const visionCases = [
    {
      caseId: "vision-clean",
      expectedQualityLabel: "PASS",
      packet: basePacket({ role: "vision_qa", caseId: "vision-clean", channelId: DARK_JOY_BOY_PROJECT_KINGS_PROFILE.youtube.channelId, task: { templateSha256: DARK_JOY_BOY_PROJECT_KINGS_PROFILE.templateIdentity.templateSha, conceptId: DARK_JOY_BOY_PROJECT_KINGS_PROFILE.concept.conceptId, sourceSha256: cleanSourceSha256, previewSha256: cleanPreviewSha256, knownSourceSha256: [], knownStoryEventIds: [] }, artifacts: [darkConcept, cleanPreviewEvidence, ...cleanPreviewFrames] })
    },
    {
      caseId: "vision-hardsub",
      expectedQualityLabel: "FAIL",
      packet: basePacket({ role: "vision_qa", caseId: "vision-hardsub", channelId: LIGHT_KINGDOM_PROJECT_KINGS_PROFILE.youtube.channelId, task: { templateSha256: LIGHT_KINGDOM_PROJECT_KINGS_PROFILE.templateIdentity.templateSha, conceptId: LIGHT_KINGDOM_PROJECT_KINGS_PROFILE.concept.conceptId, sourceSha256: hardSubSourceSha256, previewSha256: hardSubPreviewSha256, knownSourceSha256: [], knownStoryEventIds: [] }, artifacts: [lightConcept, hardSubPreviewEvidence, ...hardSubPreviewFrames] })
    },
    {
      caseId: "vision-offconcept",
      expectedQualityLabel: "FAIL",
      packet: basePacket({ role: "vision_qa", caseId: "vision-offconcept", channelId: DARK_JOY_BOY_PROJECT_KINGS_PROFILE.youtube.channelId, task: { templateSha256: DARK_JOY_BOY_PROJECT_KINGS_PROFILE.templateIdentity.templateSha, conceptId: DARK_JOY_BOY_PROJECT_KINGS_PROFILE.concept.conceptId, sourceSha256: offConceptSourceSha256, previewSha256: offConceptPreviewSha256, knownSourceSha256: [], knownStoryEventIds: [] }, artifacts: [darkConcept, offConceptPreviewEvidence, ...offConceptPreviewFrames] })
    }
  ];

  const unsafeCropPlan = await writeFixture(root, "revision-unsafe-crop-plan.json", {
    targetDurationSec: 18,
    crop: { focusX: 0.98, focusY: 0.5, reason: "Stale crop excludes the monkey during payoff." },
    segments: [
      { startSec: 0, endSec: 4, purpose: "hook" },
      { startSec: 4, endSec: 12, purpose: "action" },
      { startSec: 12, endSec: 18, purpose: "payoff" }
    ]
  }, "montage_plan");
  const bannedCaption = await writeFixture(root, "revision-banned-caption.json", {
    caption: "THE GUILTY KEEPER FORCES THE MONKEY INTO THE BATH.",
    hook: "THE GUILTY KEEPER",
    action: "FORCES THE MONKEY",
    payoff: "INTO THE BATH"
  }, "caption_brief");
  const watermarkedSource = await writeFixture(root, "revision-watermarked-source.json", {
    sourceProvider: "instagram-aggregator",
    embeddedMark: "DONOR DAILY",
    markLocation: "center of the only visible payoff",
    removableBySafeCrop: false
  }, "source_metadata");
  const revisionInputs = [
    {
      caseId: "revision-unsafe-crop",
      expectedQualityLabel: "targeted_visual_revision",
      defects: [{ code: "unsafe_crop" as const, severity: "critical" as const, message: "The crop removes the monkey during the payoff." }],
      targetArtifact: unsafeCropPlan
    },
    {
      caseId: "revision-banned-word",
      expectedQualityLabel: "deterministic_repair",
      defects: [{ code: "banned_word" as const, severity: "major" as const, message: "The caption contains the banned accusation 'guilty'." }],
      targetArtifact: bannedCaption
    },
    {
      caseId: "revision-watermark",
      expectedQualityLabel: "quarantine_source",
      defects: [{ code: "watermark" as const, severity: "critical" as const, message: "An upstream aggregator watermark covers the only visible payoff and cannot be cropped safely." }],
      targetArtifact: watermarkedSource
    }
  ];
  const revisionQualityEvidence = await Promise.all(revisionInputs.map((entry) =>
    writeFixture(root, `${entry.caseId}-quality-verdict.json`, {
      decision: "FAIL",
      artifactSha256: entry.targetArtifact.sha256,
      defects: entry.defects
    }, "quality_verdict")
  ));
  const revisionCases = revisionInputs.map((entry, index) => ({
    caseId: entry.caseId,
    expectedQualityLabel: entry.expectedQualityLabel,
    packet: basePacket({ role: "revision", caseId: entry.caseId, channelId: DARK_JOY_BOY_PROJECT_KINGS_PROFILE.youtube.channelId, task: { attempt: 1, maxAttempts: 5, artifactSha256: entry.targetArtifact.sha256, defects: entry.defects }, artifacts: [revisionQualityEvidence[index], entry.targetArtifact] })
  }));

  return {
    source_search: { datasetId: "project-kings-source-search", datasetVersion: "v1", role: "source_search", cases: sourceSearchCases },
    source_fit: { datasetId: "project-kings-source-fit", datasetVersion: "v1", role: "source_fit", cases: sourceFitCases },
    source_policy: sourcePolicyDataset,
    caption: { datasetId: "project-kings-caption", datasetVersion: "v1", role: "caption", cases: captionCases },
    montage_planner: { datasetId: "project-kings-montage-planner", datasetVersion: "v1", role: "montage_planner", cases: montageCases },
    vision_qa: { datasetId: "project-kings-vision-qa", datasetVersion: "v3", role: "vision_qa", cases: visionCases },
    revision: { datasetId: "project-kings-revision", datasetVersion: "v2", role: "revision", cases: revisionCases }
  };
}

const STAGE_POLICIES: Record<ProductionAgentRole, ModelSelectionPolicy> = {
  source_search: { requiresVision: false, requiresJsonSchema: true, minimumReasoning: "low", minimumContextTokens: 0, minimumSampleSize: 3, minimumQualityScore: 1, minimumSchemaSuccessRate: 1, maximumP95LatencyMs: 300_000 },
  source_fit: { requiresVision: false, requiresJsonSchema: true, minimumReasoning: "low", minimumContextTokens: 0, minimumSampleSize: 3, minimumQualityScore: 1, minimumSchemaSuccessRate: 1, maximumP95LatencyMs: 90_000 },
  source_policy: { requiresVision: true, requiresJsonSchema: true, minimumReasoning: "low", minimumContextTokens: 0, minimumSampleSize: SOURCE_POLICY_PRODUCTION_MINIMUM_SAMPLE_SIZE, minimumQualityScore: 1, minimumSchemaSuccessRate: 1, maximumP95LatencyMs: 90_000 },
  caption: { requiresVision: false, requiresJsonSchema: true, minimumReasoning: "low", minimumContextTokens: 0, minimumSampleSize: 3, minimumQualityScore: 1, minimumSchemaSuccessRate: 1, maximumP95LatencyMs: 240_000 },
  montage_planner: { requiresVision: false, requiresJsonSchema: true, minimumReasoning: "low", minimumContextTokens: 0, minimumSampleSize: 3, minimumQualityScore: 1, minimumSchemaSuccessRate: 1, maximumP95LatencyMs: 240_000 },
  vision_qa: { requiresVision: true, requiresJsonSchema: true, minimumReasoning: "low", minimumContextTokens: 0, minimumSampleSize: 3, minimumQualityScore: 1, minimumSchemaSuccessRate: 1, maximumP95LatencyMs: 45_000 },
  revision: { requiresVision: false, requiresJsonSchema: true, minimumReasoning: "low", minimumContextTokens: 0, minimumSampleSize: 3, minimumQualityScore: 1, minimumSchemaSuccessRate: 1, maximumP95LatencyMs: 90_000 }
};

async function main(): Promise<void> {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "project-kings-model-benchmark-"));
  try {
    const datasets = await buildDatasets(fixtureRoot);
    const rateCardBytes = await fs.readFile(RATE_CARD_PATH);
    const pricing: ModelBenchmarkPricingEvidence[] = [
      {
        routeId: "codex:gpt-5.4-mini",
        costUnit: "codex_credits",
        inputPerMillionTokens: 18.75,
        cachedInputPerMillionTokens: 1.875,
        outputPerMillionTokens: 113,
        source: "OpenAI Codex rate card captured in docs/project-kings-production-pipeline-v1/evidence/codex-rate-card-2026-07-10.json",
        verifiedAt: "2026-07-10T10:25:00.000Z",
        sourceSha256: sha256(rateCardBytes)
      },
      {
        routeId: "codex:gpt-5.4",
        costUnit: "codex_credits",
        inputPerMillionTokens: 62.5,
        cachedInputPerMillionTokens: 6.25,
        outputPerMillionTokens: 375,
        source: "OpenAI Codex rate card captured in docs/project-kings-production-pipeline-v1/evidence/codex-rate-card-2026-07-10.json",
        verifiedAt: "2026-07-10T10:25:00.000Z",
        sourceSha256: sha256(rateCardBytes)
      }
    ];
    const baseInvoker = createCodexProductionAgentInvoker({
      repoCwd: REPO_ROOT,
      codexHome: process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex")
    });
    const allRoles = ["source_fit", "source_policy", "vision_qa", "revision"] as const;
    const requestedRole = process.env.PROJECT_KINGS_BENCHMARK_ROLE?.trim();
    if (requestedRole && !allRoles.includes(requestedRole as (typeof allRoles)[number])) {
      throw new Error(`PROJECT_KINGS_BENCHMARK_ROLE must be one of ${allRoles.join(", ")}.`);
    }
    const roles: Array<(typeof allRoles)[number]> = requestedRole
      ? [requestedRole as (typeof allRoles)[number]]
      : [...allRoles];
    const failures: string[] = [];
    const runRole = async (role: (typeof roles)[number]) => {
      const evidenceVersion = role === "source_policy"
        ? SOURCE_POLICY_BENCHMARK_EVIDENCE_VERSION
        : BENCHMARK_EVIDENCE_VERSION;
      const benchmarkVersion = role === "source_policy"
        ? SOURCE_POLICY_BENCHMARK_VERSION
        : BENCHMARK_VERSION;
      const outputPath = path.join(EVIDENCE_ROOT, `model-benchmark-${role}-2026-07-10-${evidenceVersion}.json`);
      const rawOutputPath = path.join(EVIDENCE_ROOT, `model-benchmark-${role}-2026-07-10-${evidenceVersion}-raw.json`);
      const rawCalls: Array<Record<string, unknown>> = [];
      const invoker = role === "source_policy"
        ? async (input: Parameters<typeof baseInvoker>[0]) => {
            const startedAt = new Date().toISOString();
            const started = performance.now();
            try {
              const result = await baseInvoker(input);
              rawCalls.push({
                caseId: input.packet.itemId,
                routeId: input.route.routeId,
                model: input.route.model,
                reasoningEffort: input.route.reasoningEffort,
                promptSha256: sha256(input.prompt),
                startedAt,
                durationMs: Number((performance.now() - started).toFixed(6)),
                outcome: "returned",
                rawOutput: result.rawOutput,
                outputSha256: sha256(result.rawOutput),
                usage: result.usage,
                error: null
              });
              return result;
            } catch (error) {
              rawCalls.push({
                caseId: input.packet.itemId,
                routeId: input.route.routeId,
                model: input.route.model,
                reasoningEffort: input.route.reasoningEffort,
                promptSha256: sha256(input.prompt),
                startedAt,
                durationMs: Number((performance.now() - started).toFixed(6)),
                outcome: "invoke_error",
                rawOutput: null,
                outputSha256: null,
                usage: null,
                error: compactError(error)
              });
              throw error;
            }
          }
        : baseInvoker;
      const candidates = role === "source_policy"
        ? [
            { routeId: "codex:gpt-5.4-mini", reasoningEffort: "high" as const },
            { routeId: "codex:gpt-5.4", reasoningEffort: "high" as const }
          ]
        : role === "revision"
        ? [
            { routeId: "codex:gpt-5.4-mini", reasoningEffort: "low" as const },
            { routeId: "codex:gpt-5.4", reasoningEffort: "low" as const },
            { routeId: "codex:gpt-5.4", reasoningEffort: "medium" as const },
            { routeId: "codex:gpt-5.4", reasoningEffort: "high" as const }
          ]
        : [
            { routeId: "codex:gpt-5.4-mini", reasoningEffort: "low" as const },
            { routeId: "codex:gpt-5.4-mini", reasoningEffort: "medium" as const },
            { routeId: "codex:gpt-5.4", reasoningEffort: "low" as const },
            { routeId: "codex:gpt-5.4", reasoningEffort: "medium" as const }
          ];
      let roleOutcome = "blocked";
      let roleError: string | null = null;
      try {
        const result = await runStageSpecificModelBenchmark({
          benchmarkVersion,
          registry: PROJECT_KINGS_V1_MODEL_REGISTRY,
          policy: STAGE_POLICIES[role],
          dataset: datasets[role],
          candidates,
          pricing,
          qualityEvaluator: qualityEvaluator(),
          invoker,
          outputPath
        });
        roleOutcome = "pass";
        process.stdout.write(`${role}: ${result.evidence.selection?.primary.model}/${result.evidence.selection?.primary.reasoningEffort} -> fallback ${result.evidence.selection?.fallback.model}/${result.evidence.selection?.fallback.reasoningEffort}\n`);
      } catch (error) {
        if (!(error instanceof ModelBenchmarkHarnessError) || !error.evidence) throw error;
        roleError = error.message;
        failures.push(`${role}: ${error.message}`);
        process.stdout.write(`${role}: FAIL (${error.message}); immutable evidence=${path.relative(REPO_ROOT, outputPath)}\n`);
      } finally {
        if (role === "source_policy") {
          const benchmarkEvidence = JSON.parse(await fs.readFile(outputPath, "utf8")) as {
            evidenceSha256?: string;
          };
          const rawPayload = {
            schemaVersion: "project-kings-source-policy-model-raw-evidence-v1",
            benchmarkVersion,
            stageRole: role,
            createdAt: new Date().toISOString(),
            datasetSha256: sha256(await fs.readFile(path.join(
              EVIDENCE_ROOT,
              "source-policy-benchmark-real-30-v1/dataset.json"
            ))),
            annotationsSha256: sha256(await fs.readFile(path.join(
              EVIDENCE_ROOT,
              "source-policy-benchmark-real-30-v1/annotations.json"
            ))),
            benchmarkEvidenceSha256: benchmarkEvidence.evidenceSha256 ?? null,
            outcome: roleOutcome,
            error: roleError,
            callCount: rawCalls.length,
            calls: rawCalls
          };
          const frozenRaw = {
            ...rawPayload,
            rawEvidenceSha256: sha256Json(rawPayload)
          };
          await fs.writeFile(rawOutputPath, `${JSON.stringify(frozenRaw, null, 2)}\n`, {
            encoding: "utf8",
            flag: "wx"
          });
        }
      }
    };
    for (const role of roles) {
      await runRole(role);
    }
    if (failures.length > 0) {
      throw new Error(`Benchmark gates failed: ${failures.join("; ")}`);
    }
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
