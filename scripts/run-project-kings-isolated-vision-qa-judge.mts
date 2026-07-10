import path from "node:path";
import { fileURLToPath } from "node:url";

import { runIsolatedVisionQaJudgeCli } from "../lib/project-kings/vision-qa-isolated-judge";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

const requestPath = argument("--request");
const outputPath = argument("--output");
const manifestPath = argument("--manifest");
const codexHome = argument("--codex-home");
const adapterId = argument("--adapter-id");
const expectedAdapterSha256 = argument("--adapter-sha256");
if (!requestPath || !outputPath || !manifestPath || !codexHome || !adapterId || !expectedAdapterSha256) {
  throw new Error(
    "Isolated Vision QA CLI requires --request, --output, --manifest, --codex-home, --adapter-id and --adapter-sha256."
  );
}

await runIsolatedVisionQaJudgeCli({
  requestPath: path.resolve(requestPath),
  outputPath: path.resolve(outputPath),
  manifestPath: path.resolve(manifestPath),
  codexHome: path.resolve(codexHome),
  adapterPath: fileURLToPath(import.meta.url),
  adapterId,
  expectedAdapterSha256
});
