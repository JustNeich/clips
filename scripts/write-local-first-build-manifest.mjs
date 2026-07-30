import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(repoRoot, "output", "local-first-build.json");
const lockfile = await fs.readFile(path.join(repoRoot, "package-lock.json"));
const workerManifest = JSON.parse(
  await fs.readFile(path.join(repoRoot, ".stage3-worker-runtime", "manifest.json"), "utf8")
);
const gitRevision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8"
}).trim();
const dirty = Boolean(
  execFileSync("git", ["status", "--porcelain"], {
    cwd: repoRoot,
    encoding: "utf8"
  }).trim()
);

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(
  outputPath,
  `${JSON.stringify(
    {
      format: "clips-local-first-build",
      gitRevision,
      lockfileSha256: createHash("sha256").update(lockfile).digest("hex"),
      nodeMajor: Number.parseInt(process.versions.node.split(".")[0] ?? "", 10),
      workerRuntimeVersion: workerManifest.runtimeVersion ?? null,
      dirty,
      builtAt: new Date().toISOString()
    },
    null,
    2
  )}\n`,
  "utf8"
);

console.log(`Wrote local-first build manifest: ${outputPath}`);
