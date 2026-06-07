import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const workerEntry = path.join(repoRoot, "apps", "stage3-worker", "index.ts");
const publicDir = path.join(repoRoot, "public", "stage3-worker");
const runtimeDir = path.resolve(
  repoRoot,
  process.env.STAGE3_WORKER_RUNTIME_DIR?.trim() || ".stage3-worker-runtime"
);
const bundlePath = path.join(runtimeDir, "clips-stage3-worker.cjs");
const manifestPath = path.join(runtimeDir, "manifest.json");
const workerPackagePath = path.join(runtimeDir, "package.json");
const runtimeDependenciesArchivePath = path.join(runtimeDir, "runtime-deps.tar.gz");
const runtimeSourcesArchivePath = path.join(runtimeDir, "runtime-sources.tar.gz");
const remotionRuntimeDir = path.join(runtimeDir, "remotion");
const libRuntimeDir = path.join(runtimeDir, "lib");
const designRuntimeDir = path.join(runtimeDir, "design");
const workerRuntimeAssetsDir = path.join(runtimeDir, "public");
const packageJsonPath = path.join(repoRoot, "package.json");
const remotionSourceDir = path.join(repoRoot, "remotion");
const libSourceDir = path.join(repoRoot, "lib");
const designSourceDir = path.join(repoRoot, "design");
const publicSourceDir = path.join(repoRoot, "public");

const WORKER_RUNTIME_DEPENDENCIES = [
  "@remotion/bundler",
  "@remotion/renderer",
  "react",
  "react-dom",
  "remotion"
];

const WORKER_LIB_RUNTIME_FILES = [
  "stage3-duration.ts",
  "stage3-template.ts",
  "stage3-template-semantics.ts",
  "stage3-template-fonts.ts",
  "stage3-constants.ts",
  "template-scene.tsx",
  "stage3-verified-badge.tsx",
  "template-calibration-types.ts",
  "auto-fit-template-scene.tsx",
  "stage3-template-core.ts",
  "template-highlights.ts",
  "stage3-render-variation.ts",
  "stage3-camera.ts",
  "stage3-text-fit.ts",
  "stage3-template-spec.ts",
  "stage3-template-renderer.tsx",
  "stage3-template-runtime.tsx",
  "stage3-template-registry.ts",
  "stage3-background-mode.ts",
  "stage3-video-adjustments.ts",
  "stage3-video-scale.ts",
  "stage3-video-placement.ts",
  "stage3-worker-job-timeout.ts"
];

const WORKER_BUNDLE_SOURCE_FILES = [
  "stage3-worker-runtime.ts",
  "stage3-worker-managed-tools.ts"
];

const WORKER_TEMPLATE_SPEC_FILES = [
  // Only repo-backed specs that stage3-template-spec.ts imports at runtime.
  // Other registered templates are generated from code and must not make
  // local executor bootstrap scale with the template workspace/library size.
  "templates/science-card-v1/figma-spec.json",
  "templates/science-card-v7/figma-spec.json",
  "templates/hedges-of-honor-v1/figma-spec.json"
];

const WORKER_PUBLIC_RUNTIME_FILES = [
  "stage3-template-backdrops/hedges-of-honor-v1-shell.svg",
  "stage3-template-backdrops/science-card-v7-shell.svg",
  "stage3-template-badges/american-news-badge.svg",
  "stage3-template-badges/gold-glow-badge.png",
  "stage3-template-badges/honor-verified-badge.svg",
  "stage3-template-badges/pink-glow-badge.png",
  "stage3-template-badges/science-card-v1-check.png",
  "stage3-template-badges/twitter-verified-badge.png"
];

async function listWorkerRemotionRuntimeFiles() {
  const entries = await fs.readdir(remotionSourceDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

async function copyWorkerTemplateSpecs() {
  const copiedFiles = [];
  for (const relativeFilePath of WORKER_TEMPLATE_SPEC_FILES) {
    const sourcePath = path.join(designSourceDir, relativeFilePath);
    const targetPath = path.join(designRuntimeDir, relativeFilePath);
    await fs.access(sourcePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
    copiedFiles.push(relativeFilePath);
  }
  return copiedFiles.sort();
}

async function copyWorkerPublicAssets() {
  const copiedFiles = [];
  for (const relativeFilePath of WORKER_PUBLIC_RUNTIME_FILES) {
    const sourcePath = path.join(publicSourceDir, relativeFilePath);
    const targetPath = path.join(workerRuntimeAssetsDir, relativeFilePath);
    await fs.access(sourcePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
    copiedFiles.push(relativeFilePath);
  }
  return copiedFiles.sort();
}

async function hashFile(hash, label, filePath) {
  hash.update(`file:${label}\0`);
  hash.update(await fs.readFile(filePath));
  hash.update("\0");
}

async function buildRuntimeVersion(baseVersion, input) {
  const hash = createHash("sha256");
  hash.update(`version:${baseVersion}\0`);
  hash.update(`worker-package:${JSON.stringify(input.workerPackageJson)}\0`);
  if (input.workerBundlePreviewBytes) {
    hash.update("worker-bundle-preview\0");
    hash.update(input.workerBundlePreviewBytes);
    hash.update("\0");
  }
  await hashFile(hash, "scripts/build-stage3-worker.mjs", __filename);
  await hashFile(hash, "apps/stage3-worker/index.ts", workerEntry);
  for (const fileName of WORKER_BUNDLE_SOURCE_FILES) {
    await hashFile(hash, `lib/${fileName}`, path.join(libSourceDir, fileName));
  }

  for (const fileName of [...input.remotionFiles].sort()) {
    await hashFile(hash, `remotion/${fileName}`, path.join(remotionSourceDir, fileName));
  }
  for (const fileName of [...WORKER_LIB_RUNTIME_FILES].sort()) {
    await hashFile(hash, `lib/${fileName}`, path.join(libSourceDir, fileName));
  }
  for (const fileName of [...input.designFiles].sort()) {
    await hashFile(hash, `design/${fileName}`, path.join(designSourceDir, fileName));
  }
  for (const fileName of [...input.publicFiles].sort()) {
    await hashFile(hash, `public/${fileName}`, path.join(publicSourceDir, fileName));
  }

  return `${baseVersion}+runtime.${hash.digest("hex").slice(0, 12)}`;
}

async function buildWorkerBundle(runtimeVersion, options = {}) {
  return build({
    entryPoints: [workerEntry],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: ["node22"],
    outfile: bundlePath,
    write: options.write !== false,
    sourcemap: false,
    legalComments: "none",
    banner: {
      js: "#!/usr/bin/env node"
    },
    external: [
      "@remotion/bundler",
      "@remotion/renderer",
      "remotion",
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "./chat-history",
      "./channel-assets"
    ],
    define: {
      __CLIPS_STAGE3_WORKER_RUNTIME_VERSION__: JSON.stringify(runtimeVersion)
    }
  });
}

async function readPackageJson() {
  const raw = await fs.readFile(packageJsonPath, "utf-8");
  return JSON.parse(raw);
}

function pickWorkerDependencies(rootPackageJson) {
  const rootDeps = rootPackageJson.dependencies ?? {};
  return Object.fromEntries(
    WORKER_RUNTIME_DEPENDENCIES.map((name) => {
      const version = rootDeps[name];
      if (typeof version !== "string" || !version.trim()) {
        throw new Error(`Missing runtime dependency version for ${name} in root package.json.`);
      }
      return [name, version];
    })
  );
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options
  });
  if (result.status !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}${typeof result.status === "number" ? ` (exit ${result.status})` : ""}`
    );
  }
}

function resolveNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function resolveRuntimeDependenciesPlatform() {
  return `${process.platform}-${process.arch}`;
}

async function buildWorkerRuntimeArchive(workerPackageJson) {
  const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), "clips-stage3-worker-runtime-"));
  try {
    await fs.writeFile(
      path.join(stagingDir, "package.json"),
      `${JSON.stringify(workerPackageJson, null, 2)}\n`,
      "utf-8"
    );
    runCommand(resolveNpmCommand(), ["install", "--omit=dev", "--no-fund", "--no-audit"], {
      cwd: stagingDir
    });
    await fs.rm(runtimeDependenciesArchivePath, { force: true }).catch(() => undefined);
    runCommand("tar", ["-czf", runtimeDependenciesArchivePath, "node_modules"], {
      cwd: stagingDir
    });
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function buildWorkerSourcesArchive() {
  await fs.rm(runtimeSourcesArchivePath, { force: true }).catch(() => undefined);
  runCommand("tar", ["-czf", runtimeSourcesArchivePath, "remotion", "lib", "design", "public"], {
    cwd: runtimeDir
  });
}

async function syncWorkerRuntimeSources() {
  await fs.rm(remotionRuntimeDir, { recursive: true, force: true }).catch(() => undefined);
  await fs.rm(libRuntimeDir, { recursive: true, force: true }).catch(() => undefined);
  await fs.rm(designRuntimeDir, { recursive: true, force: true }).catch(() => undefined);
  await fs.rm(workerRuntimeAssetsDir, { recursive: true, force: true }).catch(() => undefined);
  await fs.mkdir(remotionRuntimeDir, { recursive: true });
  await fs.mkdir(libRuntimeDir, { recursive: true });
  await fs.mkdir(designRuntimeDir, { recursive: true });
  await fs.mkdir(workerRuntimeAssetsDir, { recursive: true });

  await fs.cp(remotionSourceDir, remotionRuntimeDir, { recursive: true });
  const designFiles = await copyWorkerTemplateSpecs();
  const publicFiles = await copyWorkerPublicAssets();
  for (const fileName of WORKER_LIB_RUNTIME_FILES) {
    const sourcePath = path.join(libSourceDir, fileName);
    const destinationPath = path.join(libRuntimeDir, fileName);
    await fs.copyFile(sourcePath, destinationPath);
  }

  const copiedFiles = await fs.readdir(libRuntimeDir);
  const expected = new Set(WORKER_LIB_RUNTIME_FILES);
  const unexpected = copiedFiles.filter((fileName) => !expected.has(fileName));
  if (unexpected.length > 0) {
    throw new Error(
        `Worker runtime contains unexpected lib files: ${unexpected.join(", ")}. ` +
        "Do not maintain manual template source mirrors in the worker runtime lib directory."
    );
  }

  return {
    designFiles,
    publicFiles
  };
}

async function removeLegacyPublicRuntimeOutputs() {
  const legacyRuntimePaths = [
    "clips-stage3-worker.cjs",
    "manifest.json",
    "package.json",
    "runtime-deps.tar.gz",
    "runtime-sources.tar.gz",
    "remotion",
    "lib",
    "design",
    "public"
  ];
  await Promise.all(
    legacyRuntimePaths.map((relativePath) =>
      fs.rm(path.join(publicDir, relativePath), { recursive: true, force: true }).catch(() => undefined)
    )
  );
}

async function syncLegacyPublicRuntimeOutputs() {
  // Already installed Clips Worker desktop shells can still read /stage3-worker/*
  // before they download the newer private-runtime-aware worker bundle.
  await removeLegacyPublicRuntimeOutputs();
  await fs.mkdir(publicDir, { recursive: true });

  const rootFiles = [
    bundlePath,
    manifestPath,
    workerPackagePath,
    runtimeDependenciesArchivePath,
    runtimeSourcesArchivePath
  ];
  for (const sourcePath of rootFiles) {
    await fs.copyFile(sourcePath, path.join(publicDir, path.basename(sourcePath)));
  }

  const runtimeDirs = [
    [remotionRuntimeDir, "remotion"],
    [libRuntimeDir, "lib"],
    [designRuntimeDir, "design"],
    [workerRuntimeAssetsDir, "public"]
  ];
  for (const [sourceDir, targetName] of runtimeDirs) {
    await fs.cp(sourceDir, path.join(publicDir, targetName), { recursive: true });
  }
}

async function main() {
  const rootPackageJson = await readPackageJson();
  const version =
    typeof rootPackageJson.version === "string" && rootPackageJson.version.trim()
      ? rootPackageJson.version.trim()
      : "0.0.0";
  const remotionFiles = await listWorkerRemotionRuntimeFiles();
  await fs.mkdir(publicDir, { recursive: true });
  await fs.mkdir(runtimeDir, { recursive: true });
  await removeLegacyPublicRuntimeOutputs();
  const runtimeSources = await syncWorkerRuntimeSources();
  const workerPackageJson = {
    name: "clips-stage3-worker",
    version,
    private: true,
    type: "commonjs",
    engines: {
      node: ">=22"
    },
    dependencies: pickWorkerDependencies(rootPackageJson)
  };
  const previewBundle = await buildWorkerBundle("pending-runtime-version", { write: false });
  const workerBundlePreviewBytes = previewBundle.outputFiles?.[0]?.contents;
  const runtimeVersion = await buildRuntimeVersion(version, {
    remotionFiles,
    designFiles: runtimeSources.designFiles,
    publicFiles: runtimeSources.publicFiles,
    workerPackageJson,
    workerBundlePreviewBytes
  });

  await buildWorkerBundle(runtimeVersion);

  await fs.chmod(bundlePath, 0o755).catch(() => undefined);
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        version,
        runtimeVersion,
        builtAt: new Date().toISOString(),
        bundleFile: path.basename(bundlePath),
        runtimeDependenciesArchiveFile: path.basename(runtimeDependenciesArchivePath),
        runtimeDependenciesPlatform: resolveRuntimeDependenciesPlatform(),
        runtimeSourcesArchiveFile: path.basename(runtimeSourcesArchivePath),
        remotionFiles,
        libFiles: WORKER_LIB_RUNTIME_FILES,
        designFiles: runtimeSources.designFiles,
        publicFiles: runtimeSources.publicFiles
      },
      null,
      2
    ),
    "utf-8"
  );
  await fs.writeFile(
    workerPackagePath,
    JSON.stringify(workerPackageJson, null, 2),
    "utf-8"
  );
  await buildWorkerRuntimeArchive(workerPackageJson);
  await buildWorkerSourcesArchive();
  await syncLegacyPublicRuntimeOutputs();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
