import { promises as fs } from "node:fs";
import path from "node:path";

import {
  createVisionQaAnnotationCampaign,
  type CreateVisionQaAnnotationCampaignInput
} from "../lib/project-kings/vision-qa-annotation-runner";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

const planPath = argument("--plan");
const outputRoot = argument("--output-root");
if (!planPath || !outputRoot) {
  throw new Error(
    "Usage: --plan <blind-assignment-plan.json> --output-root <directory>. This command prepares packets only and never runs reviewers."
  );
}
const plan = JSON.parse(await fs.readFile(path.resolve(planPath), "utf8")) as Omit<
  CreateVisionQaAnnotationCampaignInput,
  "outputRoot"
>;
const created = await createVisionQaAnnotationCampaign({
  ...plan,
  outputRoot: path.resolve(outputRoot)
});
process.stdout.write(`${JSON.stringify({
  schemaVersion: "project-kings-vision-qa-annotation-preparation-result-v1",
  manifestSha256: created.manifest.manifestSha256,
  annotationCount: created.manifest.annotationCount,
  adjudicationCount: created.manifest.adjudicationCount,
  reviewerPacketCount: created.reviewerPacketPaths.length,
  state: "awaiting_independent_reviewers"
}, null, 2)}\n`);
