import { promises as fs } from "node:fs";
import path from "node:path";

import refillModule from "../lib/project-kings/source-buffer-refill";
import type { ProjectKingsSourceBufferReadinessEvidence } from "../lib/project-kings/source-buffer-readiness";

const { importQualifiedProjectKingsSourceBuffer } = refillModule;
const repoRoot = path.resolve(import.meta.dirname, "..");

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function requiredArgument(name: string): string {
  const value = argument(name)?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function resolveFromRoot(value: string): string {
  return path.isAbsolute(value) ? value : path.join(repoRoot, value);
}

const workspaceId = requiredArgument("--workspace-id");
const evidencePath = resolveFromRoot(
  argument("--evidence") ??
    "docs/project-kings-production-pipeline-v1/evidence/source-buffer-readiness-2026-07-10-v7.json"
);
const evidence = JSON.parse(
  await fs.readFile(evidencePath, "utf8")
) as ProjectKingsSourceBufferReadinessEvidence;
const result = await importQualifiedProjectKingsSourceBuffer({
  workspaceId,
  repoRoot,
  evidence
});

process.stdout.write(`${JSON.stringify({
  workspaceId,
  evidencePath: path.relative(repoRoot, evidencePath),
  ...result
}, null, 2)}\n`);
if (result.failed > 0 || result.channels.some((channel) => channel.deficitAfter > 0)) {
  process.exitCode = 1;
}
