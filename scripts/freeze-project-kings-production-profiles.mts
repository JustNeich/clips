import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import profileStoreModule from "../lib/project-kings/pilot-profile-store";
import type { ProjectKingsPilotProfileKey } from "../lib/project-kings/pilot-production-profiles";

const { buildProjectKingsPilotProfileSnapshot } = profileStoreModule;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT =
  "docs/project-kings-production-pipeline-v1/evidence/project-kings-production-profiles-v2.json";
const PROFILE_KEYS: readonly ProjectKingsPilotProfileKey[] = [
  "dark-joy-boy",
  "light-kingdom",
  "copscopes-x2e"
];

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

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

const outputArgument = argument("--output") ?? DEFAULT_OUTPUT;
const outputPath = path.resolve(REPO_ROOT, outputArgument);
const relative = path.relative(REPO_ROOT, outputPath);
if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
  throw new Error("Profile evidence output must remain inside the repository.");
}

const profiles = PROFILE_KEYS.map((key) => buildProjectKingsPilotProfileSnapshot(key));
const evidenceWithoutHash = {
  schemaVersion: "project-kings-production-profile-snapshots-v2",
  executionApproval: "not_granted_by_this_snapshot",
  approvalMechanism:
    "clips_owner_approve_production_profile binds one stored profile id, version and profileHash to shadow or live scope",
  mutableSecretsIncluded: false,
  profiles
};
const evidenceSha256 = createHash("sha256")
  .update(JSON.stringify(canonicalize(evidenceWithoutHash)))
  .digest("hex");
const evidence = { ...evidenceWithoutHash, evidenceSha256 };

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
process.stdout.write(`${relative} sha256=${evidenceSha256} profiles=${profiles.length}\n`);
