import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";

import corpusBuilderRuntime from "../lib/project-kings/vision-qa-corpus-builder";
import corpusCampaignRuntime from "../lib/project-kings/vision-qa-corpus-campaign";
import type { VisionQaCorpusCampaignManifest } from "../lib/project-kings/vision-qa-corpus-builder";
import type {
  VisionQaAdjudicationInputPacket,
  VisionQaAdjudicationResponse,
  VisionQaCorpusPreparationPlan,
  VisionQaPreparedCampaignManifest,
  VisionQaReviewResponse
} from "../lib/project-kings/vision-qa-corpus-campaign";
import type {
  VisionQaAdjudicationAssignmentPacket,
  VisionQaAnnotationCampaignManifest,
  VisionQaAnnotationPacket
} from "../lib/project-kings/vision-qa-annotation-runner";

const {
  assertVisionQaCorpusBuildReady,
  auditVisionQaCorpusSourceInventory,
  auditVisionQaLocalInventoryPreflight,
  verifyVisionQaCorpusCampaignManifest,
  writeVisionQaCorpusSourceAudit,
  writeVisionQaLocalInventoryPreflight
} = corpusBuilderRuntime;
const {
  VISION_QA_CORPUS_PREPARATION_CONTRACT,
  createVisionQaAdjudicationInputPacket,
  finalizeVisionQaCorpusCampaign,
  prepareVisionQaCorpusCampaign,
  verifyVisionQaCorpusPreparationPlan
} = corpusCampaignRuntime;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function json<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.resolve(filePath), "utf8")) as T;
}

async function writeExclusiveJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o444
  });
}

const outputDirectory = path.resolve(
  argument("--output-directory") ?? path.join(repoRoot, ".data/project-kings/vision-qa-corpus-v2")
);

if (process.argv.includes("--print-preparation-contract")) {
  process.stdout.write(`${JSON.stringify(VISION_QA_CORPUS_PREPARATION_CONTRACT, null, 2)}\n`);
  process.exit(0);
}

if (process.argv.includes("--inventory-preflight")) {
  const evidence = await auditVisionQaLocalInventoryPreflight({ repoRoot, concurrency: 8 });
  const evidencePath = await writeVisionQaLocalInventoryPreflight({ outputDirectory, evidence });
  process.stdout.write(`${JSON.stringify({
    schemaVersion: "project-kings-vision-qa-inventory-preflight-result-v1",
    outcome: evidence.outcome,
    qualificationAllowed: evidence.qualificationAllowed,
    counts: evidence.counts,
    blockers: evidence.blockers,
    preparationContract: VISION_QA_CORPUS_PREPARATION_CONTRACT,
    evidenceSha256: evidence.evidenceSha256,
    evidencePath: path.relative(repoRoot, evidencePath)
  }, null, 2)}\n`);
  process.exit(0);
}

if (process.argv.includes("--open-adjudication")) {
  const campaignPath = argument("--annotation-campaign-manifest");
  const assignmentPath = argument("--adjudication-assignment");
  const packetAPath = argument("--reviewer-packet-a");
  const packetBPath = argument("--reviewer-packet-b");
  const responseAPath = argument("--review-response-a");
  const responseBPath = argument("--review-response-b");
  const outputPath = argument("--adjudication-output");
  if (!campaignPath || !assignmentPath || !packetAPath || !packetBPath ||
      !responseAPath || !responseBPath || !outputPath) {
    throw new Error("--open-adjudication requires annotation campaign, assignment, two reviewer packets, two review responses and an exclusive output path.");
  }
  const packet = createVisionQaAdjudicationInputPacket({
    campaign: await json<VisionQaAnnotationCampaignManifest>(campaignPath),
    assignment: await json<VisionQaAdjudicationAssignmentPacket>(assignmentPath),
    reviewerPackets: [await json<VisionQaAnnotationPacket>(packetAPath), await json<VisionQaAnnotationPacket>(packetBPath)],
    responses: [await json<VisionQaReviewResponse>(responseAPath), await json<VisionQaReviewResponse>(responseBPath)]
  });
  await writeExclusiveJson(path.resolve(outputPath), packet);
  process.stdout.write(`${JSON.stringify({
    schemaVersion: "project-kings-vision-qa-adjudication-open-result-v1",
    state: "awaiting_independent_adjudication",
    caseCount: packet.cases.length,
    packetSha256: packet.packetSha256
  }, null, 2)}\n`);
  process.exit(0);
}

if (process.argv.includes("--finalize")) {
  const campaignRoot = argument("--prepared-root");
  const preparedPath = argument("--prepared-manifest");
  const campaignPath = argument("--annotation-campaign-manifest");
  const packetAPath = argument("--reviewer-packet-a");
  const packetBPath = argument("--reviewer-packet-b");
  const responseAPath = argument("--review-response-a");
  const responseBPath = argument("--review-response-b");
  const adjudicationPacketPath = argument("--adjudication-input");
  const adjudicationResponsePath = argument("--adjudication-response");
  if (!campaignRoot || !preparedPath || !campaignPath || !packetAPath || !packetBPath ||
      !responseAPath || !responseBPath || !adjudicationPacketPath || !adjudicationResponsePath) {
    throw new Error("--finalize requires prepared root/manifest, annotation campaign, two reviewer packets/responses and adjudication input/response.");
  }
  const result = await finalizeVisionQaCorpusCampaign({
    campaignRoot: path.resolve(campaignRoot),
    preparedManifest: await json<VisionQaPreparedCampaignManifest>(preparedPath),
    campaign: await json<VisionQaAnnotationCampaignManifest>(campaignPath),
    reviewerPackets: [await json<VisionQaAnnotationPacket>(packetAPath), await json<VisionQaAnnotationPacket>(packetBPath)],
    reviewResponses: [await json<VisionQaReviewResponse>(responseAPath), await json<VisionQaReviewResponse>(responseBPath)],
    adjudicationPacket: await json<VisionQaAdjudicationInputPacket>(adjudicationPacketPath),
    adjudicationResponse: await json<VisionQaAdjudicationResponse>(adjudicationResponsePath)
  });
  process.stdout.write(`${JSON.stringify({
    schemaVersion: "project-kings-vision-qa-corpus-finalization-result-v1",
    state: "frozen",
    corpusSha256: result.corpus.corpusSha256,
    selectionPoolSha256: result.corpus.selectionPool.partitionSha256,
    finalHoldoutSha256: result.corpus.finalHoldout.partitionSha256,
    manifestPath: path.relative(repoRoot, result.manifestPath)
  }, null, 2)}\n`);
  process.exit(0);
}

const campaignManifestPath = argument("--campaign-manifest");
if (!campaignManifestPath) {
  throw new Error("--campaign-manifest <path> is required; corpus qualification may not scan unscoped production runs. Use --inventory-preflight only for non-qualifying raw inventory.");
}
const campaignManifest = await json<VisionQaCorpusCampaignManifest>(campaignManifestPath);
verifyVisionQaCorpusCampaignManifest(campaignManifest);
const evidence = await auditVisionQaCorpusSourceInventory({
  repoRoot,
  campaignManifest,
  concurrency: 8
});
const written = await writeVisionQaCorpusSourceAudit({ outputDirectory, evidence });

if (process.argv.includes("--audit-only")) {
  process.stdout.write(`${JSON.stringify({
    schemaVersion: "project-kings-vision-qa-corpus-builder-result-v3",
    phase: "source_audit",
    outcome: evidence.outcome,
    counts: evidence.counts,
    campaignManifestSha256: evidence.campaign.manifestSha256,
    assetSetSha256: evidence.assetSetSha256,
    evidenceSha256: evidence.evidenceSha256,
    evidencePath: path.relative(repoRoot, written.evidencePath),
    blockerPath: written.blockerPath ? path.relative(repoRoot, written.blockerPath) : null
  }, null, 2)}\n`);
  process.exit(0);
}

assertVisionQaCorpusBuildReady(evidence);
const preparationPlanPath = argument("--preparation-plan");
if (!preparationPlanPath) {
  throw new Error("Approved-source gate passed, but --preparation-plan <path> is required for exact 3-base selection, 40-base holdout, context, reviewer and adjudicator bindings.");
}
const plan = await json<VisionQaCorpusPreparationPlan>(preparationPlanPath);
verifyVisionQaCorpusPreparationPlan(plan);
const prepared = await prepareVisionQaCorpusCampaign({
  repoRoot,
  outputRoot: outputDirectory,
  evidence,
  plan
});
process.stdout.write(`${JSON.stringify({
  schemaVersion: "project-kings-vision-qa-corpus-builder-result-v3",
  phase: "prepared",
  outcome: "awaiting_two_independent_annotations",
  counts: prepared.manifest.counts,
  preparedManifestSha256: prepared.manifest.manifestSha256,
  preparedManifestPath: path.relative(repoRoot, prepared.manifestPath),
  reviewerPacketPaths: prepared.manifest.annotationCampaign.reviewerPacketRelativePaths.map((relativePath) =>
    path.relative(repoRoot, path.join(prepared.root, relativePath))),
  adjudicationAssignmentPath: path.relative(
    repoRoot,
    path.join(prepared.root, prepared.manifest.annotationCampaign.adjudicationAssignmentRelativePath)
  )
}, null, 2)}\n`);
