import { promises as fs } from "node:fs";
import path from "node:path";

import {
  VISION_QA_CONTROLLED_DEFECTS,
  generateVisionQaDefectVariant,
  selectEligibleVisionQaCleanBasesFromAudit,
  type VisionQaControlledDefect
} from "../lib/project-kings/vision-qa-defect-generator";
import type { VisionQaCorpusSourceAuditEvidence } from "../lib/project-kings/vision-qa-corpus-builder";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

const planPath = argument("--plan");
const outputRoot = argument("--output-root");
if (!planPath || !outputRoot) {
  throw new Error("Usage: --plan <json> --output-root <directory>. This command never assigns ground-truth labels.");
}
const plan = JSON.parse(await fs.readFile(path.resolve(planPath), "utf8")) as {
  repoRoot: string;
  sourceAuditPath: string;
  productionItemIds?: string[];
  defects?: VisionQaControlledDefect[];
  fontPath?: string | null;
  bannedWord?: string | null;
};
if (!plan.repoRoot?.trim() || !plan.sourceAuditPath?.trim()) {
  throw new Error("Plan requires repoRoot and a sealed sourceAuditPath; caller-supplied eligibility booleans are forbidden.");
}
const repoRoot = path.resolve(plan.repoRoot);
const sourceAuditPath = path.isAbsolute(plan.sourceAuditPath)
  ? plan.sourceAuditPath
  : path.join(repoRoot, plan.sourceAuditPath);
const sourceAudit = JSON.parse(await fs.readFile(sourceAuditPath, "utf8")) as VisionQaCorpusSourceAuditEvidence;
const bases = selectEligibleVisionQaCleanBasesFromAudit({
  repoRoot,
  evidence: sourceAudit,
  productionItemIds: plan.productionItemIds
});
const defects = plan.defects ?? [...VISION_QA_CONTROLLED_DEFECTS];
if (!Array.isArray(defects) || defects.some((defect) => !VISION_QA_CONTROLLED_DEFECTS.includes(defect))) {
  throw new Error("Plan contains an unsupported controlled defect.");
}

const results = [];
for (const base of bases) {
  for (const defect of defects) {
    results.push(await generateVisionQaDefectVariant({
      base,
      defect,
      outputRoot: path.resolve(outputRoot),
      fontPath: plan.fontPath,
      bannedWord: plan.bannedWord
    }));
  }
}
process.stdout.write(`${JSON.stringify({
  schemaVersion: "project-kings-vision-qa-defect-generation-result-v1",
  generated: results.length,
  recipeManifestSha256: results.map((result) => result.manifestSha256)
}, null, 2)}\n`);
