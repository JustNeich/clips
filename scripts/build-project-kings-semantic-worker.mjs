import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outputDir = path.resolve(
  repoRoot,
  process.env.PROJECT_KINGS_SEMANTIC_WORKER_BUILD_DIR?.trim() ||
    ".project-kings-semantic-worker-runtime"
);
const entryPoint = path.join(repoRoot, "apps", "project-kings-semantic-worker", "index.ts");
const stage3ManifestPath = path.resolve(
  repoRoot,
  process.env.PROJECT_KINGS_SEMANTIC_STAGE3_MANIFEST_PATH?.trim() ||
    ".stage3-worker-runtime/manifest.json"
);
const bundlePath = path.join(outputDir, "project-kings-semantic-worker.cjs");
const manifestPath = path.join(outputDir, "manifest.json");

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)])
    );
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readStage3AppVersion() {
  const raw = JSON.parse(await fs.readFile(stage3ManifestPath, "utf-8"));
  const appVersion =
    typeof raw.runtimeVersion === "string" && raw.runtimeVersion.trim()
      ? raw.runtimeVersion.trim()
      : typeof raw.version === "string" && raw.version.trim()
        ? raw.version.trim()
        : "";
  if (!appVersion) {
    throw new Error("Stage 3 runtime manifest does not contain runtimeVersion/version.");
  }
  return { appVersion, sourceManifestSha256: sha256(JSON.stringify(canonical(raw))) };
}

async function bundle(input) {
  return build({
    entryPoints: [entryPoint],
    bundle: true,
    write: input.write,
    outfile: input.write ? bundlePath : undefined,
    format: "cjs",
    platform: "node",
    target: ["node22"],
    sourcemap: false,
    legalComments: "none",
    banner: { js: "#!/usr/bin/env node" },
    define: {
      __PROJECT_KINGS_SEMANTIC_WORKER_RUNTIME_VERSION__: JSON.stringify(
        input.semanticRuntimeVersion
      ),
      __PROJECT_KINGS_SEMANTIC_WORKER_STAGE3_APP_VERSION__: JSON.stringify(
        input.stage3AppVersion
      )
    }
  });
}

async function main() {
  const stage3 = await readStage3AppVersion();
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });
  const preview = await bundle({
    write: false,
    semanticRuntimeVersion: "project-kings-semantic.pending",
    stage3AppVersion: stage3.appVersion
  });
  const previewBytes = preview.outputFiles?.[0]?.contents;
  if (!previewBytes) throw new Error("Semantic worker preview bundle was not produced.");
  const semanticRuntimeVersion = `project-kings-semantic-v1+${sha256(previewBytes).slice(0, 16)}`;
  await bundle({
    write: true,
    semanticRuntimeVersion,
    stage3AppVersion: stage3.appVersion
  });
  await fs.chmod(bundlePath, 0o755);
  const bundleBytes = await fs.readFile(bundlePath);
  const unsigned = {
    schemaVersion: "project-kings-semantic-worker-bundle-v1",
    builtAt: new Date().toISOString(),
    nodeEngine: ">=22",
    bundleFile: path.basename(bundlePath),
    bundleSha256: sha256(bundleBytes),
    bundleSizeBytes: bundleBytes.byteLength,
    semanticRuntimeVersion,
    stage3AppVersion: stage3.appVersion,
    stage3SourceManifestSha256: stage3.sourceManifestSha256,
    supportedKinds: ["production-semantic"],
    maxConcurrentJobsPerProcess: 3,
    intendedLaunchdInstances: 1,
    credentialsInBundle: false
  };
  const manifest = {
    ...unsigned,
    manifestSha256: sha256(JSON.stringify(canonical(unsigned)))
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
