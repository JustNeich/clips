import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  ProductionAgentArtifact,
  ProductionAgentOutputByRole,
  ProductionAgentPacketByRole,
  ProductionAgentRole
} from "./production-agent-contracts";
import type {
  ModelBenchmarkQualityEvaluation,
  ModelBenchmarkQualityEvaluator,
  StageModelBenchmarkDataset
} from "./model-benchmark";
import {
  PROJECT_KINGS_PILOT_PROFILES,
  type ProjectKingsPilotProfileKey
} from "./pilot-production-profiles";

export const REMAINING_SEMANTIC_BENCHMARK_ROLES = [
  "source_search",
  "source_fit",
  "caption",
  "montage_planner"
] as const;

export type RemainingSemanticBenchmarkRole =
  (typeof REMAINING_SEMANTIC_BENCHMARK_ROLES)[number];

const ANNOTATION_SCHEMA_VERSION =
  "project-kings-remaining-semantic-benchmark-annotations-v1" as const;
const DATASET_VERSION = "real-30-v2" as const;
/*
 * The source_search role carries a corrected role-boundary revision on top of
 * the frozen shared annotations. The shared annotation identity (and therefore
 * annotationsSha256, which is bound into every role's checkpoint keys) must
 * stay byte-identical to real-30-v2 so caption/montage/source_fit checkpoint
 * replay keeps working. All search-specific corrections live in the frozen
 * overlay file below and only affect the source_search dataset and evaluator.
 */
// v4: overlay v2 restores the dropped factual attribute in the DW0w8RMjY3Y
// summary (static frame, no visible physical action) after the v3 run showed
// the neutralized wording read as an ordinary eventful stop. Labels unchanged.
const SOURCE_SEARCH_DATASET_VERSION = "real-30-v5-search-boundary" as const;
const SOURCE_SEARCH_BOUNDARY_OVERLAY_RELATIVE_PATH =
  "docs/project-kings-production-pipeline-v1/source-search-role-boundary-v3.overlay.json";
const SOURCE_SEARCH_BOUNDARY_OVERLAY_SCHEMA_VERSION =
  "project-kings-source-search-role-boundary-overlay-v1" as const;
const SOURCE_POLICY_DATASET_RELATIVE_PATH =
  "docs/project-kings-production-pipeline-v1/evidence/source-policy-benchmark-real-30-v1/dataset.json";
const SOURCE_POLICY_CASE_ROOT =
  "docs/project-kings-production-pipeline-v1/evidence/source-policy-benchmark-real-30-v1/cases";

type HumanDisposition = "target" | "reject";

type HumanCaseAnnotation = Readonly<{
  mediaId: string;
  profileKey: ProjectKingsPilotProfileKey;
  disposition: HumanDisposition;
  storyEventId: string;
  englishSummary: string;
  sourceEvidenceRelativePath: string;
}>;

/*
 * These labels were transcribed from the already-existing human source-research
 * verdicts and pilot-catalog observations. They are intentionally frozen in
 * code before any route under this benchmark is invoked. The builder also
 * hashes the named source files into the annotation evidence packet.
 */
const HUMAN_CASES = Object.freeze([
  {
    mediaId: "BtDnmx6HRr_",
    profileKey: "dark-joy-boy",
    disposition: "target",
    storyEventId: "event-man-tiger-chase-embrace-roll",
    englishSummary: "A man and a tiger chase, embrace, roll together, and remain in close contact.",
    sourceEvidenceRelativePath: "experiments/source-researcher/runs/donors/02/joyboy-verdicts.json"
  },
  {
    mediaId: "C-0YpsCAODv",
    profileKey: "dark-joy-boy",
    disposition: "target",
    storyEventId: "event-woman-smiles-chimp-shoulders",
    englishSummary: "A smiling woman carries a chimpanzee on her shoulders while both wave at the camera.",
    sourceEvidenceRelativePath: "experiments/source-researcher/runs/donors/02/joyboy-verdicts.json"
  },
  {
    mediaId: "C9gLu79MklN",
    profileKey: "dark-joy-boy",
    disposition: "target",
    storyEventId: "event-owner-feeds-plays-spider-monkey",
    englishSummary: "An owner feeds and plays with a diapered spider monkey in one continuous interaction.",
    sourceEvidenceRelativePath: "experiments/source-researcher/runs/donors/02/joyboy-verdicts.json"
  },
  {
    mediaId: "CsYa4skNBjP",
    profileKey: "dark-joy-boy",
    disposition: "target",
    storyEventId: "event-man-bottle-feeds-lion",
    englishSummary: "A man bottle-feeds a large lion, holds its paw, and stays close while the lion drinks.",
    sourceEvidenceRelativePath: "experiments/source-researcher/runs/donors/02/joyboy-verdicts.json"
  },
  {
    mediaId: "Cw_QTMmA69_",
    profileKey: "dark-joy-boy",
    disposition: "target",
    storyEventId: "event-woman-bottle-feeds-liger",
    englishSummary: "A woman bottle-feeds a giant liger and strokes its head in a close continuous moment.",
    sourceEvidenceRelativePath: "experiments/source-researcher/runs/donors/02/joyboy-verdicts.json"
  },
  {
    mediaId: "Cxb0DmpJ7oM",
    profileKey: "dark-joy-boy",
    disposition: "target",
    storyEventId: "event-man-holds-towel-wrapped-baby-monkey",
    englishSummary: "A man holds a towel-wrapped baby spider monkey close to his face.",
    sourceEvidenceRelativePath: "experiments/source-researcher/runs/donors/02/joyboy-verdicts.json"
  },
  {
    mediaId: "DIUYX9QStl3",
    profileKey: "dark-joy-boy",
    disposition: "target",
    storyEventId: "event-man-swims-hugging-chimp",
    englishSummary: "A man swims while hugging a chimpanzee and both remain in close playful contact.",
    sourceEvidenceRelativePath: "experiments/source-researcher/runs/donors/02/joyboy-verdicts.json"
  },
  {
    mediaId: "DKM66d2tamf",
    profileKey: "dark-joy-boy",
    disposition: "target",
    storyEventId: "event-man-rubs-tiger-cub-belly",
    englishSummary: "A young tiger rests on a man's lap while he rubs its belly and it licks his hand.",
    sourceEvidenceRelativePath: "experiments/source-researcher/runs/donors/02/joyboy-verdicts.json"
  },
  {
    mediaId: "DW0w8RMjY3Y",
    profileKey: "copscopes-x2e",
    disposition: "reject",
    storyEventId: "event-static-drunk-driving-stop-dialogue",
    englishSummary: "A static traffic stop relies on dialogue captions and does not show a physical action payoff.",
    sourceEvidenceRelativePath: "experiments/source-researcher/runs/donors/02/copscopes-verdicts.json"
  },
  {
    mediaId: "DW5s3qoDbHC",
    profileKey: "copscopes-x2e",
    disposition: "target",
    storyEventId: "event-passenger-flees-traffic-stop-foot-chase",
    englishSummary: "A passenger flees a traffic stop on foot before an officer catches and restrains him.",
    sourceEvidenceRelativePath: "experiments/source-researcher/runs/donors/02/copscopes-verdicts.json"
  },
  {
    mediaId: "DWjH5fWjBnt",
    profileKey: "copscopes-x2e",
    disposition: "target",
    storyEventId: "event-police-grappler-catches-fleeing-pickup",
    englishSummary: "Police pursue a pickup and deploy a grappler strap toward its rear wheel.",
    sourceEvidenceRelativePath: "experiments/source-researcher/runs/donors/02/copscopes-b2-verdicts.json"
  },
  {
    mediaId: "DWnxlyIDcoK",
    profileKey: "copscopes-x2e",
    disposition: "reject",
    storyEventId: "event-seated-officer-argument-dialogue",
    englishSummary: "A seated officer argues with a civilian while dialogue subtitles carry the entire story.",
    sourceEvidenceRelativePath: "experiments/source-researcher/runs/donors/02/copscopes-verdicts.json"
  },
  {
    mediaId: "DWwSVVOjMqO",
    profileKey: "copscopes-x2e",
    disposition: "reject",
    storyEventId: "event-compiled-street-race-crash-interview",
    englishSummary: "The source combines a night crash and fire with a separate daytime interview and hard subtitles.",
    sourceEvidenceRelativePath: "experiments/source-researcher/runs/donors/02/copscopes-verdicts.json"
  },
  {
    mediaId: "DXBhsJPjSgW",
    profileKey: "copscopes-x2e",
    disposition: "reject",
    storyEventId: "event-hospital-captions-crash-aftermath",
    englishSummary: "Large word-reveal captions cover a hospital scene while the crash appears only as aftermath.",
    sourceEvidenceRelativePath: "experiments/source-researcher/runs/donors/02/copscopes-verdicts.json"
  },
  {
    mediaId: "DXHx529DVb0",
    profileKey: "copscopes-x2e",
    disposition: "target",
    storyEventId: "event-trooper-stops-wrong-way-driver-collision",
    englishSummary: "Dashcam shows a trooper confronting a wrong-way driver and the damaged patrol vehicle payoff.",
    sourceEvidenceRelativePath: "experiments/source-researcher/runs/donors/02/copscopes-b2-verdicts.json"
  },
  {
    mediaId: "DXNBoz7jYmd",
    profileKey: "copscopes-x2e",
    disposition: "target",
    storyEventId: "event-stolen-car-neighborhood-pursuit",
    englishSummary: "Police pursue a stolen car through a neighborhood and stop it with an armed-officer payoff.",
    sourceEvidenceRelativePath: "experiments/source-researcher/runs/donors/02/copscopes-verdicts.json"
  },
  {
    mediaId: "DXOzkCdjMue",
    profileKey: "copscopes-x2e",
    disposition: "target",
    storyEventId: "event-suspect-clings-moving-car-during-pursuit",
    englishSummary: "A fleeing suspect clings to a moving car while police follow on the highway.",
    sourceEvidenceRelativePath: "experiments/source-researcher/runs/donors/02/copscopes-verdicts.json"
  },
  {
    mediaId: "DXUPExpjCs2",
    profileKey: "copscopes-x2e",
    disposition: "target",
    storyEventId: "event-troopers-rescue-choking-baby",
    englishSummary: "Two state troopers help a choking baby until the child begins breathing again.",
    sourceEvidenceRelativePath: "experiments/source-researcher/judge/holdout-v0/copscopes-x2e/verdicts.json"
  },
  {
    mediaId: "1diIRo4sHtk",
    profileKey: "light-kingdom",
    disposition: "reject",
    storyEventId: "event-ai-fiction-dense-foreign-captions",
    englishSummary: "Dense foreign burned-in captions cover the fiction source and make it unusable.",
    sourceEvidenceRelativePath: "lib/project-kings/pilot-source-candidate-catalog.ts"
  },
  {
    mediaId: "6IlkA1MLVYA",
    profileKey: "light-kingdom",
    disposition: "reject",
    storyEventId: "event-ranking-ui-subscribe-overlay",
    englishSummary: "Ranking interface and explicit subscribe overlays dominate the source.",
    sourceEvidenceRelativePath: "lib/project-kings/pilot-source-candidate-catalog.ts"
  },
  {
    mediaId: "6QIdqyFoxFE",
    profileKey: "light-kingdom",
    disposition: "target",
    storyEventId: "event-ai-fiction-parody-part-nine",
    englishSummary: "Recognizable fiction is visibly rebuilt as an AI parody with a changed action payoff.",
    sourceEvidenceRelativePath: "lib/project-kings/pilot-source-candidate-catalog.ts"
  },
  {
    mediaId: "BwIaEb5vGDo",
    profileKey: "light-kingdom",
    disposition: "target",
    storyEventId: "event-ai-mandalorian-grogu-short-scene",
    englishSummary: "The Mandalorian and Grogu appear in a clean AI-rebuilt short fiction scene.",
    sourceEvidenceRelativePath: "lib/project-kings/pilot-source-candidate-catalog.ts"
  },
  {
    mediaId: "EYkw1ELHXq0",
    profileKey: "light-kingdom",
    disposition: "reject",
    storyEventId: "event-ai-fiction-large-burned-captions",
    englishSummary: "Large burned-in captions cover the AI-fiction source and make it unusable.",
    sourceEvidenceRelativePath: "lib/project-kings/pilot-source-candidate-catalog.ts"
  },
  {
    mediaId: "J6tw2l128YE",
    profileKey: "light-kingdom",
    disposition: "target",
    storyEventId: "event-ai-harry-potter-afterparty",
    englishSummary: "Recognizable Harry Potter characters appear in a transformed AI afterparty scene.",
    sourceEvidenceRelativePath: "lib/project-kings/pilot-source-candidate-catalog.ts"
  },
  {
    mediaId: "V-xIvJs0Jbo",
    profileKey: "light-kingdom",
    disposition: "target",
    storyEventId: "event-ai-public-figure-inside-harry-potter-two",
    englishSummary: "A generated public-figure character is placed inside a recognizable Harry Potter scene.",
    sourceEvidenceRelativePath: "lib/project-kings/pilot-source-candidate-catalog.ts"
  },
  {
    mediaId: "WkEyab1jINA",
    profileKey: "light-kingdom",
    disposition: "target",
    storyEventId: "event-ai-public-figure-inside-harry-potter-one",
    englishSummary: "A generated public-figure character enters a recognizable Harry Potter fiction scene.",
    sourceEvidenceRelativePath: "lib/project-kings/pilot-source-candidate-catalog.ts"
  },
  {
    mediaId: "XPKBwhDPxk0",
    profileKey: "light-kingdom",
    disposition: "reject",
    storyEventId: "event-like-subscribe-overlay-end-card",
    englishSummary: "A large like-and-subscribe overlay and end card violate the clean source format.",
    sourceEvidenceRelativePath: "lib/project-kings/pilot-source-candidate-catalog.ts"
  },
  {
    mediaId: "fj6CXk2KTIs",
    profileKey: "light-kingdom",
    disposition: "reject",
    storyEventId: "event-split-screen-large-text-watermark",
    englishSummary: "Split-screen layout, large text, and a watermark block a clean AI-fiction crop.",
    sourceEvidenceRelativePath: "lib/project-kings/pilot-source-candidate-catalog.ts"
  },
  {
    mediaId: "n9kD935iROw",
    profileKey: "light-kingdom",
    disposition: "reject",
    storyEventId: "event-ordinary-horizontal-fiction-footage",
    englishSummary: "The footage reads as ordinary horizontal fiction and does not establish a visible AI premise.",
    sourceEvidenceRelativePath: "lib/project-kings/pilot-source-candidate-catalog.ts"
  },
  {
    mediaId: "oA7rziyGv8s",
    profileKey: "light-kingdom",
    disposition: "reject",
    storyEventId: "event-strangeai-watermark-foreign-captions",
    englishSummary: "A StrangeAI watermark and foreign burned-in captions make the source unusable.",
    sourceEvidenceRelativePath: "lib/project-kings/pilot-source-candidate-catalog.ts"
  }
] satisfies readonly HumanCaseAnnotation[]);

type SourcePolicyDatasetCase = Readonly<{
  caseId: string;
  profileKey: ProjectKingsPilotProfileKey;
  channelId: string;
  sourceUrl: string;
  mediaRelativePath: string;
  contentSha256: string;
  durationSec: number;
  artifacts: Readonly<{
    sourceMetadata: Readonly<{
      artifactId: string;
      relativePath: string;
      sha256: string;
    }>;
    orderedKeyFrames: readonly Readonly<{
      artifactId: string;
      relativePath: string;
      sha256: string;
    }>[];
    ocr: Readonly<{ artifactId: string; relativePath: string; sha256: string }>;
    asr: Readonly<{ artifactId: string; relativePath: string; sha256: string }>;
  }>;
}>;

type SourcePolicyDatasetFile = Readonly<{
  datasetSha256: string;
  sampleSize: number;
  cases: readonly SourcePolicyDatasetCase[];
}>;

type RoleExpected = Readonly<{
  caseId: string;
  expectedQualityLabel: string;
  expectedCandidateIds?: readonly string[];
  duplicate?: boolean;
  maxCharacters?: number;
  targetDurationSec?: number;
  sourceDurationSec?: number;
  anchorTokens?: readonly string[];
  note?: string;
}>;

type SourceSearchBoundaryOverlayCase = Readonly<{
  mediaId: string;
  profileKey: ProjectKingsPilotProfileKey;
  conceptRelevant: boolean;
  searchEventSummary: string;
  note: string;
}>;

type SourceSearchBoundaryOverlay = Readonly<{
  schemaVersion: typeof SOURCE_SEARCH_BOUNDARY_OVERLAY_SCHEMA_VERSION;
  revisionId: string;
  baseAnnotationSetId: string;
  baseAnnotationsSha256: string;
  boundary: string;
  cases: readonly SourceSearchBoundaryOverlayCase[];
}>;

export type SourceSearchBoundaryExpectations = Readonly<{
  revisionId: string;
  overlayRelativePath: string;
  overlaySha256: string;
  roleCases: readonly RoleExpected[];
}>;

export type RemainingSemanticBenchmarkAnnotations = Readonly<{
  schemaVersion: typeof ANNOTATION_SCHEMA_VERSION;
  annotationSetId: string;
  datasetVersion: typeof DATASET_VERSION;
  createdAt: string;
  independentFromModelRoutesUnderTest: true;
  sourcePolicyDatasetSha256: string;
  sourceEvidence: readonly Readonly<{ relativePath: string; sha256: string }>[];
  mediaCases: readonly HumanCaseAnnotation[];
  roleCases: Readonly<Record<RemainingSemanticBenchmarkRole, readonly RoleExpected[]>>;
  annotationsSha256: string;
}>;

type BuiltRoleDatasets = {
  datasets: {
    [R in RemainingSemanticBenchmarkRole]: StageModelBenchmarkDataset<R>;
  };
  annotations: RemainingSemanticBenchmarkAnnotations;
  sourceSearchBoundary: SourceSearchBoundaryExpectations;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
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

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Json(value: unknown): string {
  return sha256(JSON.stringify(canonicalize(value)));
}

async function artifactFromExisting(input: {
  repoRoot: string;
  id: string;
  kind: ProductionAgentArtifact["kind"];
  mediaType: ProductionAgentArtifact["mediaType"];
  relativePath: string;
  expectedSha256?: string;
}): Promise<ProductionAgentArtifact> {
  const filePath = path.join(input.repoRoot, input.relativePath);
  const bytes = await fs.readFile(filePath);
  const actualSha256 = sha256(bytes);
  if (input.expectedSha256 && actualSha256 !== input.expectedSha256) {
    throw new Error(
      `Frozen artifact drift at ${input.relativePath}: expected ${input.expectedSha256}, got ${actualSha256}.`
    );
  }
  return {
    id: input.id,
    kind: input.kind,
    mediaType: input.mediaType,
    path: filePath,
    sha256: actualSha256
  };
}

async function writeFixture(input: {
  fixtureRoot: string;
  fileName: string;
  id: string;
  kind: ProductionAgentArtifact["kind"];
  value: unknown;
}): Promise<ProductionAgentArtifact> {
  const filePath = path.join(input.fixtureRoot, input.fileName);
  const content = `${JSON.stringify(input.value, null, 2)}\n`;
  await fs.writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
  return {
    id: input.id,
    kind: input.kind,
    mediaType: "json",
    path: filePath,
    sha256: sha256(content)
  };
}

function basePacket<R extends RemainingSemanticBenchmarkRole>(input: {
  role: R;
  caseId: string;
  channelId: string;
  task: ProductionAgentPacketByRole[R]["task"];
  artifacts: readonly ProductionAgentArtifact[];
  datasetVersion?: string;
}): ProductionAgentPacketByRole[R] {
  return {
    schemaVersion: "production-agent-packet-v1",
    role: input.role,
    runId: `benchmark-${input.role}-${input.datasetVersion ?? DATASET_VERSION}`,
    itemId: input.caseId,
    channelId: input.channelId,
    profileVersion: "channel-production-profile-v1",
    task: input.task,
    artifacts: input.artifacts
  } as ProductionAgentPacketByRole[R];
}

function mediaIdFromCaseId(caseId: string): string {
  return caseId.replace(/^(dark|cop)-instagram-/, "").replace(/^light-youtube-/, "");
}

function anchorTokens(summary: string): string[] {
  const stop = new Set([
    "about", "again", "after", "appear", "appears", "before", "cover", "covers", "during",
    "from", "inside", "into", "large", "make", "makes", "remain", "scene", "shows", "source",
    "their", "there", "these", "through", "until", "while", "with", "without"
  ]);
  return [...new Set(summary.toLowerCase().match(/[a-z0-9]+/g) ?? [])]
    .filter((token) => token.length >= 5 && !stop.has(token))
    .slice(0, 12);
}

function profileStrategy(profileKey: ProjectKingsPilotProfileKey): "instagram" | "youtube_ask" {
  return profileKey === "light-kingdom" ? "youtube_ask" : "instagram";
}

async function buildAnnotationPacket(input: {
  repoRoot: string;
  sourcePolicyDataset: SourcePolicyDatasetFile;
  roleCases: Readonly<Record<RemainingSemanticBenchmarkRole, readonly RoleExpected[]>>;
}): Promise<RemainingSemanticBenchmarkAnnotations> {
  const sourceEvidencePaths = [...new Set(HUMAN_CASES.map((entry) => entry.sourceEvidenceRelativePath))].sort();
  const sourceEvidence = await Promise.all(
    sourceEvidencePaths.map(async (relativePath) => ({
      relativePath,
      sha256: sha256(await fs.readFile(path.join(input.repoRoot, relativePath)))
    }))
  );
  const payload = {
    schemaVersion: ANNOTATION_SCHEMA_VERSION,
    annotationSetId: "project-kings-remaining-semantic-real-30-independent-v2",
    datasetVersion: DATASET_VERSION,
    createdAt: "2026-07-10T18:00:00.000Z",
    independentFromModelRoutesUnderTest: true as const,
    sourcePolicyDatasetSha256: input.sourcePolicyDataset.datasetSha256,
    sourceEvidence,
    mediaCases: HUMAN_CASES,
    roleCases: input.roleCases
  };
  return Object.freeze({ ...payload, annotationsSha256: sha256Json(payload) });
}

async function loadSourceSearchBoundaryOverlay(input: {
  overlayPath: string;
  annotations: RemainingSemanticBenchmarkAnnotations;
  corpusMediaIds: readonly string[];
  annotationsByMedia: ReadonlyMap<string, HumanCaseAnnotation>;
}): Promise<{
  overlay: SourceSearchBoundaryOverlay;
  overlaySha256: string;
  byMediaId: Map<string, SourceSearchBoundaryOverlayCase>;
}> {
  const overlayBytes = await fs.readFile(input.overlayPath);
  const overlay = JSON.parse(overlayBytes.toString("utf8")) as SourceSearchBoundaryOverlay;
  if (overlay.schemaVersion !== SOURCE_SEARCH_BOUNDARY_OVERLAY_SCHEMA_VERSION) {
    throw new Error("Unsupported source-search role-boundary overlay schema.");
  }
  if (typeof overlay.revisionId !== "string" || overlay.revisionId.length === 0) {
    throw new Error("Source-search role-boundary overlay is missing a revisionId.");
  }
  if (overlay.baseAnnotationsSha256 !== input.annotations.annotationsSha256) {
    throw new Error(
      "Source-search role-boundary overlay is not bound to the loaded base annotation set."
    );
  }
  if (overlay.baseAnnotationSetId !== input.annotations.annotationSetId) {
    throw new Error(
      "Source-search role-boundary overlay names a different base annotation set id."
    );
  }
  if (!Array.isArray(overlay.cases) || overlay.cases.length !== input.corpusMediaIds.length) {
    throw new Error("Source-search role-boundary overlay must cover every corpus case exactly once.");
  }
  const byMediaId = new Map<string, SourceSearchBoundaryOverlayCase>();
  for (const overlayCase of overlay.cases) {
    if (byMediaId.has(overlayCase.mediaId)) {
      throw new Error(`Source-search role-boundary overlay repeats media ${overlayCase.mediaId}.`);
    }
    const annotation = input.annotationsByMedia.get(overlayCase.mediaId);
    if (!annotation) {
      throw new Error(`Source-search role-boundary overlay names unknown media ${overlayCase.mediaId}.`);
    }
    if (overlayCase.profileKey !== annotation.profileKey) {
      throw new Error(`Source-search role-boundary overlay profile mismatch for ${overlayCase.mediaId}.`);
    }
    if (typeof overlayCase.conceptRelevant !== "boolean") {
      throw new Error(`Source-search role-boundary overlay conceptRelevant must be boolean for ${overlayCase.mediaId}.`);
    }
    if (typeof overlayCase.searchEventSummary !== "string" || overlayCase.searchEventSummary.length === 0) {
      throw new Error(`Source-search role-boundary overlay is missing searchEventSummary for ${overlayCase.mediaId}.`);
    }
    if (typeof overlayCase.note !== "string" || overlayCase.note.length === 0) {
      throw new Error(`Source-search role-boundary overlay is missing note for ${overlayCase.mediaId}.`);
    }
    byMediaId.set(overlayCase.mediaId, overlayCase);
  }
  if (input.corpusMediaIds.some((mediaId) => !byMediaId.has(mediaId))) {
    throw new Error("Source-search role-boundary overlay does not cover every corpus media id.");
  }
  return { overlay, overlaySha256: sha256(overlayBytes), byMediaId };
}

async function persistFrozenAnnotations(
  repoRoot: string,
  annotations: RemainingSemanticBenchmarkAnnotations
): Promise<void> {
  const outputPath = path.join(
    repoRoot,
    "docs/project-kings-production-pipeline-v1/evidence/remaining-semantic-benchmark-real-30-v2/annotations.json"
  );
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const content = `${JSON.stringify(annotations, null, 2)}\n`;
  try {
    await fs.writeFile(outputPath, content, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = JSON.parse(await fs.readFile(outputPath, "utf8")) as RemainingSemanticBenchmarkAnnotations;
    if (existing.annotationsSha256 !== annotations.annotationsSha256 || sha256Json({
      ...existing,
      annotationsSha256: undefined
    }) !== annotations.annotationsSha256) {
      throw new Error(`Frozen annotation evidence drifted at ${outputPath}.`);
    }
  }
}

export async function buildRemainingSemanticBenchmarkDatasets(input: {
  repoRoot: string;
  fixtureRoot: string;
  /* Test-only escape hatch; production callers use the frozen repo overlay. */
  sourceSearchOverlayPath?: string;
}): Promise<BuiltRoleDatasets> {
  const sourcePolicyDatasetPath = path.join(input.repoRoot, SOURCE_POLICY_DATASET_RELATIVE_PATH);
  const sourcePolicyDatasetBytes = await fs.readFile(sourcePolicyDatasetPath);
  const sourcePolicyDataset = JSON.parse(sourcePolicyDatasetBytes.toString("utf8")) as SourcePolicyDatasetFile;
  if (sourcePolicyDataset.sampleSize !== 30 || sourcePolicyDataset.cases.length !== 30) {
    throw new Error("Remaining-role benchmark requires the immutable 30-media source-policy corpus.");
  }
  const annotationsByMedia = new Map(HUMAN_CASES.map((entry) => [entry.mediaId, entry]));
  const corpusMediaIds = sourcePolicyDataset.cases.map((entry) => mediaIdFromCaseId(entry.caseId));
  if (
    corpusMediaIds.length !== HUMAN_CASES.length ||
    corpusMediaIds.some((mediaId) => !annotationsByMedia.has(mediaId)) ||
    new Set(corpusMediaIds).size !== 30
  ) {
    throw new Error("The human annotation set does not bind one-to-one to the 30-media corpus.");
  }

  const conceptArtifacts = new Map<ProjectKingsPilotProfileKey, ProductionAgentArtifact>();
  for (const profileKey of Object.keys(PROJECT_KINGS_PILOT_PROFILES) as ProjectKingsPilotProfileKey[]) {
    conceptArtifacts.set(
      profileKey,
      await writeFixture({
        fixtureRoot: input.fixtureRoot,
        fileName: `concept-${profileKey}.json`,
        id: `concept-${profileKey}`,
        kind: "concept_contract",
        value: PROJECT_KINGS_PILOT_PROFILES[profileKey]
      })
    );
  }

  const resolved = await Promise.all(
    sourcePolicyDataset.cases.map(async (corpusCase, index) => {
      const mediaId = mediaIdFromCaseId(corpusCase.caseId);
      const annotation = annotationsByMedia.get(mediaId)!;
      if (annotation.profileKey !== corpusCase.profileKey) {
        throw new Error(`Profile annotation mismatch for ${corpusCase.caseId}.`);
      }
      const selectedFrameIndexes = [0, 2, 5];
      const frames = await Promise.all(
        selectedFrameIndexes.map((frameIndex, position) => {
          const frame = corpusCase.artifacts.orderedKeyFrames[frameIndex];
          if (!frame) throw new Error(`Missing frame ${frameIndex} for ${corpusCase.caseId}.`);
          return artifactFromExisting({
            repoRoot: input.repoRoot,
            id: `key-frame-${position + 1}`,
            kind: "key_frame",
            mediaType: "image",
            relativePath: frame.relativePath,
            expectedSha256: frame.sha256
          });
        })
      );
      const evidence = await writeFixture({
        fixtureRoot: input.fixtureRoot,
        fileName: `human-evidence-${String(index + 1).padStart(2, "0")}.json`,
        id: "human-source-evidence",
        kind: "factual_evidence",
        value: {
          schemaVersion: "project-kings-human-source-evidence-v1",
          caseId: corpusCase.caseId,
          mediaId,
          profileKey: annotation.profileKey,
          sourceUrl: corpusCase.sourceUrl,
          contentSha256: corpusCase.contentSha256,
          durationSec: corpusCase.durationSec,
          storyEventId: annotation.storyEventId,
          humanDisposition: annotation.disposition,
          verifiedVisibleFacts: [annotation.englishSummary],
          requiredStructure: ["hook", "action", "payoff"],
          prohibitedClaims: ["unverified guilt", "invented location", "invented injury", "invented rescue"],
          independentAnnotationSource: annotation.sourceEvidenceRelativePath
        }
      });
      const sourceMetadata = await artifactFromExisting({
        repoRoot: input.repoRoot,
        id: "decoded-source-metadata",
        kind: "source_metadata",
        mediaType: "json",
        relativePath: corpusCase.artifacts.sourceMetadata.relativePath,
        expectedSha256: corpusCase.artifacts.sourceMetadata.sha256
      });
      return {
        corpusCase,
        mediaId,
        annotation,
        frames,
        evidence,
        sourceMetadata,
        concept: conceptArtifacts.get(annotation.profileKey)!,
        anchorTokens: anchorTokens(annotation.englishSummary)
      };
    })
  );

  const targetCases = resolved.filter((entry) => entry.annotation.disposition === "target");
  const rejectCases = resolved.filter((entry) => entry.annotation.disposition === "reject");
  if (targetCases.length !== 19 || rejectCases.length !== 11) {
    throw new Error(`Expected 19 target and 11 reject human cases, got ${targetCases.length}/${rejectCases.length}.`);
  }

  // Legacy parity-derived search expectations, frozen inside the shared
  // annotation packet SOLELY to keep the real-30-v2 annotation identity
  // byte-identical (annotationsSha256 is bound into the checkpoint keys of
  // every role, so changing it would invalidate caption/montage/source_fit
  // replay). The corrected, content-derived search expectations come from the
  // frozen role-boundary overlay and are applied only to the source_search
  // dataset and its evaluator expectations further below.
  const sourceSearchExpected: RoleExpected[] = resolved.map((entry, index) => {
    const legacyFound = index % 2 === 0;
    return {
      caseId: `source-search-${String(index + 1).padStart(2, "0")}-${entry.mediaId}`,
      expectedQualityLabel: legacyFound ? "FOUND" : "NO_MATCH",
      expectedCandidateIds: legacyFound ? [`candidate-${entry.mediaId}`] : []
    };
  });

  const duplicateMediaIds = new Set(targetCases.slice(0, 6).map((entry) => entry.mediaId));
  const sourceFitExpected: RoleExpected[] = [];
  const sourceFitCases = resolved.map((entry, index) => {
    const duplicate = duplicateMediaIds.has(entry.mediaId);
    const expectedPass = entry.annotation.disposition === "target" && !duplicate;
    const caseId = `source-fit-${String(index + 1).padStart(2, "0")}-${entry.mediaId}${duplicate ? "-duplicate" : ""}`;
    sourceFitExpected.push({
      caseId,
      expectedQualityLabel: expectedPass ? "PASS" : "FAIL",
      duplicate
    });
    return {
      caseId,
      expectedQualityLabel: expectedPass ? "PASS" : "FAIL",
      packet: basePacket({
        role: "source_fit",
        caseId,
        channelId: entry.corpusCase.channelId,
        task: {
          candidateId: `candidate-${entry.mediaId}`,
          sourceUrl: entry.corpusCase.sourceUrl,
          sourceSha256: entry.corpusCase.contentSha256,
          claimedStoryEventId: entry.annotation.storyEventId,
          knownSourceSha256: duplicate ? [entry.corpusCase.contentSha256] : [],
          knownStoryEventIds: duplicate ? [entry.annotation.storyEventId] : []
        },
        artifacts: [entry.concept, entry.sourceMetadata, entry.evidence, ...entry.frames]
      })
    };
  });

  const editorialCases = [
    ...targetCases,
    ...targetCases.slice(0, 11)
  ];
  const captionExpected: RoleExpected[] = [];
  const captionCases = editorialCases.map((entry, index) => {
    const variant = index >= targetCases.length ? 2 : 1;
    const maxCharacters = variant === 1 ? 180 : 150;
    const caseId = `caption-${String(index + 1).padStart(2, "0")}-${entry.mediaId}-v${variant}`;
    captionExpected.push({
      caseId,
      expectedQualityLabel: "PASS",
      maxCharacters,
      anchorTokens: entry.anchorTokens
    });
    return {
      caseId,
      expectedQualityLabel: "PASS",
      packet: basePacket({
        role: "caption",
        caseId,
        channelId: entry.corpusCase.channelId,
        task: {
          candidateId: `candidate-${entry.mediaId}`,
          language: "English",
          templateType: entry.annotation.profileKey === "copscopes-x2e" ? "lead_main" : "top_bottom",
          maxCharacters,
          bannedWords: ["guilty", "killed", "shocking", "unbelievable", "miracle"]
        },
        artifacts: [entry.concept, entry.sourceMetadata, entry.evidence, ...entry.frames]
      })
    };
  });

  const montageExpected: RoleExpected[] = [];
  const montageCases = editorialCases.map((entry, index) => {
    const variant = index >= targetCases.length ? 2 : 1;
    const sourceDurationSec = entry.corpusCase.durationSec;
    const targetDurationSec = Number(
      Math.max(6, Math.min(sourceDurationSec, variant === 1 ? 18 : 12)).toFixed(3)
    );
    const caseId = `montage-${String(index + 1).padStart(2, "0")}-${entry.mediaId}-v${variant}`;
    montageExpected.push({
      caseId,
      expectedQualityLabel: "PASS",
      targetDurationSec,
      sourceDurationSec
    });
    return {
      caseId,
      expectedQualityLabel: "PASS",
      packet: basePacket({
        role: "montage_planner",
        caseId,
        channelId: entry.corpusCase.channelId,
        task: {
          candidateId: `candidate-${entry.mediaId}`,
          sourceDurationSec,
          targetDurationSec,
          captionText: entry.annotation.englishSummary
        },
        artifacts: [entry.concept, entry.sourceMetadata, entry.evidence, ...entry.frames]
      })
    };
  });

  const roleCases = {
    source_search: sourceSearchExpected,
    source_fit: sourceFitExpected,
    caption: captionExpected,
    montage_planner: montageExpected
  } as const;
  for (const [role, cases] of Object.entries(roleCases)) {
    if (cases.length !== 30 || new Set(cases.map((entry) => entry.caseId)).size !== 30) {
      throw new Error(`${role} benchmark did not produce 30 unique typed cases.`);
    }
  }
  const annotations = await buildAnnotationPacket({
    repoRoot: input.repoRoot,
    sourcePolicyDataset,
    roleCases
  });
  await persistFrozenAnnotations(input.repoRoot, annotations);

  const { overlay, overlaySha256, byMediaId: overlayByMediaId } =
    await loadSourceSearchBoundaryOverlay({
      overlayPath:
        input.sourceSearchOverlayPath ??
        path.join(input.repoRoot, SOURCE_SEARCH_BOUNDARY_OVERLAY_RELATIVE_PATH),
      annotations,
      corpusMediaIds,
      annotationsByMedia
    });
  const sourceSearchBoundaryExpected: RoleExpected[] = [];
  const sourceSearchCases = resolved.map((entry, index) => {
    // Search owns channel-concept relevance and same-profile supply only.
    // Downstream Source Fit / Source Policy / Vision QA defects (burned-in
    // captions, watermarks, overlays/CTA, static framing, missing payoff,
    // unrelated compilations) must never leak back into this label.
    //
    // `candidateInPool` controls only whether the same-profile source is
    // placed in the pool (half the cases carry one; half are cross-profile
    // decoys only). The FOUND/NO_MATCH label is derived from content via the
    // frozen overlay: a same-profile candidate is FOUND only when it is
    // concept-relevant. A same-profile candidate that violates the channel
    // concept stays in the pool as a hard distractor whose correct decision
    // is NO_MATCH.
    const candidateInPool = index % 2 === 0;
    const overlayCase = overlayByMediaId.get(entry.mediaId)!;
    const expectedFound = candidateInPool && overlayCase.conceptRelevant;
    const crossProfileDecoys = resolved
      .filter((candidate) => candidate.annotation.profileKey !== entry.annotation.profileKey)
      .slice(index % 10, (index % 10) + 2);
    const poolEntries = [
      ...(candidateInPool ? [entry] : []),
      ...crossProfileDecoys
    ]
      .filter((candidate, candidateIndex, all) => all.findIndex((other) => other.mediaId === candidate.mediaId) === candidateIndex)
      .map((candidate) => ({
        candidateId: `candidate-${candidate.mediaId}`,
        sourceUrl: candidate.corpusCase.sourceUrl,
        strategy: profileStrategy(candidate.annotation.profileKey),
        storyEventId: candidate.annotation.storyEventId,
        // Neutral, content-only summary from the frozen overlay. Never the
        // human englishSummary, whose reject-case wording carries downstream
        // rejection/usability verdicts.
        eventSummary: overlayByMediaId.get(candidate.mediaId)!.searchEventSummary,
        profileKey: candidate.annotation.profileKey,
        sourceAvailable: true,
        evidenceCaseId: candidate.corpusCase.caseId
      }));
    const sourcePoolPromise = writeFixture({
      fixtureRoot: input.fixtureRoot,
      fileName: `source-pool-${String(index + 1).padStart(2, "0")}.json`,
      id: "source-pool",
      kind: "source_pool",
      value: {
        schemaVersion: "project-kings-benchmark-source-pool-v1",
        candidates: poolEntries,
        exhaustedStrategies: candidateInPool ? [] : ["instagram", "youtube_ask", "reserve_pool"]
      }
    });
    const caseId = `source-search-${String(index + 1).padStart(2, "0")}-${entry.mediaId}`;
    const expectedCandidateIds = expectedFound ? [`candidate-${entry.mediaId}`] : [];
    const note = !candidateInPool
      ? "Decoy-only pool with no same-profile candidate present; correct decision is NO_MATCH."
      : overlayCase.conceptRelevant
        ? "Concept-relevant same-profile candidate present; correct decision is FOUND regardless of downstream-fit defects."
        : `Same-profile candidate present but ${overlayCase.note}; hard distractor whose correct decision is NO_MATCH.`;
    sourceSearchBoundaryExpected.push({
      caseId,
      expectedQualityLabel: expectedFound ? "FOUND" : "NO_MATCH",
      expectedCandidateIds,
      note
    });
    return { entry, caseId, expectedFound, sourcePoolPromise };
  });
  const builtSourceSearchCases = await Promise.all(sourceSearchCases.map(async (value) => ({
    caseId: value.caseId,
    expectedQualityLabel: value.expectedFound ? "FOUND" : "NO_MATCH",
    packet: basePacket({
      role: "source_search",
      caseId: value.caseId,
      channelId: value.entry.corpusCase.channelId,
      datasetVersion: SOURCE_SEARCH_DATASET_VERSION,
      task: {
        targetCandidateCount: 1,
        querySeeds: [
          value.entry.annotation.profileKey === "dark-joy-boy"
            ? "continuous warm human contact with an exotic animal"
            : value.entry.annotation.profileKey === "copscopes-x2e"
              ? "one visible police incident with action and payoff"
              : "recognizable fiction visibly transformed with AI"
        ],
        allowedStrategies: [
          profileStrategy(value.entry.annotation.profileKey),
          "reserve_pool"
        ],
        excludedStoryEventIds: []
      },
      artifacts: [value.entry.concept, await value.sourcePoolPromise]
    })
  })));
  if (
    sourceSearchBoundaryExpected.length !== 30 ||
    new Set(sourceSearchBoundaryExpected.map((entry) => entry.caseId)).size !== 30
  ) {
    throw new Error("source_search boundary expectations did not produce 30 unique typed cases.");
  }
  const sourceSearchBoundary: SourceSearchBoundaryExpectations = Object.freeze({
    revisionId: overlay.revisionId,
    overlayRelativePath: SOURCE_SEARCH_BOUNDARY_OVERLAY_RELATIVE_PATH,
    overlaySha256,
    roleCases: sourceSearchBoundaryExpected
  });

  return {
    datasets: {
      source_search: {
        datasetId: "project-kings-source-search-real-30",
        datasetVersion: SOURCE_SEARCH_DATASET_VERSION,
        role: "source_search",
        cases: builtSourceSearchCases
      },
      source_fit: {
        datasetId: "project-kings-source-fit-real-30",
        datasetVersion: DATASET_VERSION,
        role: "source_fit",
        cases: sourceFitCases
      },
      caption: {
        datasetId: "project-kings-caption-real-30",
        datasetVersion: DATASET_VERSION,
        role: "caption",
        cases: captionCases
      },
      montage_planner: {
        datasetId: "project-kings-montage-planner-real-30",
        datasetVersion: DATASET_VERSION,
        role: "montage_planner",
        cases: montageCases
      }
    },
    annotations,
    sourceSearchBoundary
  };
}

function words(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function makeEvaluation(
  actualLabel: string,
  passed: boolean,
  evidence: readonly string[]
): ModelBenchmarkQualityEvaluation {
  return { label: actualLabel, score: passed ? 1 : 0, passed, evidence };
}

export function createRemainingSemanticBenchmarkQualityEvaluator(
  annotations: RemainingSemanticBenchmarkAnnotations,
  sourceSearchBoundary?: SourceSearchBoundaryExpectations
): ModelBenchmarkQualityEvaluator {
  const expectedByRole = new Map(
    REMAINING_SEMANTIC_BENCHMARK_ROLES.flatMap((role) =>
      annotations.roleCases[role].map((entry) => [`${role}:${entry.caseId}`, entry] as const)
    )
  );
  // The shared annotations keep the legacy parity-derived source_search labels
  // only for checkpoint-identity stability; scoring source_search requires the
  // corrected role-boundary expectations and fails closed without them.
  if (sourceSearchBoundary) {
    for (const entry of sourceSearchBoundary.roleCases) {
      expectedByRole.set(`source_search:${entry.caseId}`, entry);
    }
  }
  const config = {
    version: "real-30-v1",
    sourceSearch: "exact decision; candidate must be independently annotated eligible and non-excluded",
    sourceFit: "exact decision; target PASS fields, duplicate flags, and rejected-source fail-closed behavior",
    caption: "strict PASS, length/title/banned/meta gates, hook-action-payoff and factual anchor coverage",
    montage: "strict PASS, exact duration, ordered non-overlapping hook-action-payoff and usable timeline coverage",
    annotationsSha256: annotations.annotationsSha256,
    sourceSearchBoundaryRevisionId: sourceSearchBoundary?.revisionId ?? null,
    sourceSearchBoundaryOverlaySha256: sourceSearchBoundary?.overlaySha256 ?? null
  };
  const implementation = `${createRemainingSemanticBenchmarkQualityEvaluator.toString()}\n${makeEvaluation.toString()}\n${words.toString()}`;
  return {
    evaluatorId: "project-kings-remaining-semantic-real-30",
    evaluatorVersion: "v1",
    implementationSha256: sha256(`${implementation}\n${JSON.stringify(config)}`),
    config,
    evaluate: ({ role, caseId, output }) => {
      if (!REMAINING_SEMANTIC_BENCHMARK_ROLES.includes(role as RemainingSemanticBenchmarkRole)) {
        throw new Error(`Unsupported remaining-role evaluator input ${role}.`);
      }
      const benchmarkRole = role as RemainingSemanticBenchmarkRole;
      if (benchmarkRole === "source_search" && !sourceSearchBoundary) {
        throw new Error(
          "source_search evaluation requires the role-boundary overlay expectations; the shared annotations keep only the legacy identity labels."
        );
      }
      const expected = expectedByRole.get(`${benchmarkRole}:${caseId}`);
      if (!expected) throw new Error(`Missing frozen expected result for ${role}:${caseId}.`);
      const record = output as unknown as Record<string, unknown>;
      const actual = typeof record.decision === "string" ? record.decision : "missing";
      const evidence: string[] = [`expected=${expected.expectedQualityLabel}`, `actual=${actual}`];

      if (role === "source_search") {
        const candidates = Array.isArray(record.candidates)
          ? record.candidates as Array<Record<string, unknown>>
          : [];
        const actualIds = candidates
          .map((candidate) => candidate.candidateId)
          .filter((value): value is string => typeof value === "string");
        const expectedIds = new Set(expected.expectedCandidateIds ?? []);
        const idsValid =
          expected.expectedQualityLabel === "NO_MATCH"
            ? actualIds.length === 0
            : actualIds.length > 0 && actualIds.every((candidateId) => expectedIds.has(candidateId));
        const passed = actual === expected.expectedQualityLabel && idsValid;
        evidence.push(`candidateIds=${actualIds.join(",") || "none"}`);
        return makeEvaluation(actual, passed, evidence);
      }

      if (role === "source_fit") {
        const duplicateVideo = record.duplicateVideo === true;
        const duplicateEvent = record.duplicateEvent === true;
        const conceptMatch = record.conceptMatch === true;
        const factualFit = record.factualFit === true;
        const sourceUsable = record.sourceUsable === true;
        let passed = actual === expected.expectedQualityLabel;
        if (expected.duplicate) {
          passed &&= duplicateVideo && duplicateEvent;
        } else if (expected.expectedQualityLabel === "PASS") {
          passed &&= conceptMatch && factualFit && sourceUsable && !duplicateVideo && !duplicateEvent;
        } else {
          passed &&= !duplicateVideo && !duplicateEvent && (!conceptMatch || !factualFit || !sourceUsable);
        }
        evidence.push(
          `conceptMatch=${conceptMatch}`,
          `factualFit=${factualFit}`,
          `sourceUsable=${sourceUsable}`,
          `duplicateVideo=${duplicateVideo}`,
          `duplicateEvent=${duplicateEvent}`
        );
        return makeEvaluation(actual, passed, evidence);
      }

      if (role === "caption") {
        const caption = typeof record.caption === "string" ? record.caption : "";
        const title = typeof record.title === "string" ? record.title : "";
        const hook = typeof record.hook === "string" ? record.hook : "";
        const action = typeof record.action === "string" ? record.action : "";
        const payoff = typeof record.payoff === "string" ? record.payoff : "";
        const factualClaims = Array.isArray(record.factualClaims) ? record.factualClaims : [];
        const bannedWords = ["guilty", "killed", "shocking", "unbelievable", "miracle"];
        const combined = `${caption} ${title} ${hook} ${action} ${payoff}`.toLowerCase();
        const matchedAnchors = (expected.anchorTokens ?? []).filter((token) => combined.includes(token));
        const meta = ["the clip", "this video", "the footage", "viewers"].filter((phrase) => combined.includes(phrase));
        const passed =
          actual === "PASS" &&
          caption.length >= 40 &&
          caption.length <= (expected.maxCharacters ?? 0) &&
          words(title).length >= 3 &&
          words(title).length <= 12 &&
          Boolean(hook && action && payoff) &&
          factualClaims.length >= 1 &&
          bannedWords.every((word) => !combined.includes(word)) &&
          meta.length === 0 &&
          matchedAnchors.length >= 2;
        evidence.push(
          `captionLength=${caption.length}`,
          `titleWords=${words(title).length}`,
          `factualClaims=${factualClaims.length}`,
          `matchedAnchors=${matchedAnchors.join(",") || "none"}`,
          `meta=${meta.join(",") || "none"}`
        );
        return makeEvaluation(actual, passed, evidence);
      }

      const segments = Array.isArray(record.segments)
        ? record.segments as Array<Record<string, unknown>>
        : [];
      const purposes = segments.map((segment) => segment.purpose);
      const purposeIndexes = ["hook", "action", "payoff"].map((purpose) => purposes.indexOf(purpose));
      let previousEnd = 0;
      let selectedDuration = 0;
      let timelineValid = true;
      for (const segment of segments) {
        const startSec = typeof segment.startSec === "number" ? segment.startSec : Number.NaN;
        const endSec = typeof segment.endSec === "number" ? segment.endSec : Number.NaN;
        if (
          !Number.isFinite(startSec) ||
          !Number.isFinite(endSec) ||
          startSec < previousEnd ||
          endSec <= startSec ||
          endSec > (expected.sourceDurationSec ?? 0)
        ) {
          timelineValid = false;
        }
        selectedDuration += Math.max(0, endSec - startSec);
        previousEnd = endSec;
      }
      const targetDurationSec = typeof record.targetDurationSec === "number"
        ? record.targetDurationSec
        : Number.NaN;
      const expectedDuration = expected.targetDurationSec ?? 0;
      const coverageRatio = expectedDuration > 0 ? selectedDuration / expectedDuration : 0;
      const passed =
        actual === "PASS" &&
        Math.abs(targetDurationSec - expectedDuration) <= 0.01 &&
        timelineValid &&
        purposeIndexes.every((position) => position >= 0) &&
        purposeIndexes[0]! < purposeIndexes[1]! &&
        purposeIndexes[1]! < purposeIndexes[2]! &&
        coverageRatio >= 0.75 &&
        coverageRatio <= 1.25;
      evidence.push(
        `segments=${segments.length}`,
        `purposes=${purposes.join(",")}`,
        `coverageRatio=${coverageRatio.toFixed(3)}`,
        `timelineValid=${timelineValid}`
      );
      return makeEvaluation(actual, passed, evidence);
    }
  };
}

export function remainingSemanticAnnotationSha256(
  annotations: RemainingSemanticBenchmarkAnnotations
): string {
  return annotations.annotationsSha256;
}
