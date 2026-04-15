import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const workerEntry = path.join(repoRoot, "apps", "stage3-worker", "index.ts");
const publicDir = path.join(repoRoot, "public", "stage3-worker");
const bundlePath = path.join(publicDir, "clips-stage3-worker.cjs");
const manifestPath = path.join(publicDir, "manifest.json");
const workerPackagePath = path.join(publicDir, "package.json");
const runtimeDependenciesArchivePath = path.join(publicDir, "runtime-deps.tar.gz");
const remotionPublicDir = path.join(publicDir, "remotion");
const libPublicDir = path.join(publicDir, "lib");
const designPublicDir = path.join(publicDir, "design");
const workerPublicAssetsDir = path.join(publicDir, "public");
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
  "stage3-template.ts",
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
  "stage3-video-adjustments.ts"
];

async function listWorkerRemotionRuntimeFiles() {
  const entries = await fs.readdir(remotionSourceDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

async function copyWorkerTemplateSpecs() {
  const templatesSourceDir = path.join(designSourceDir, "templates");
  const templatesPublicDir = path.join(designPublicDir, "templates");
  await fs.mkdir(templatesPublicDir, { recursive: true });
  const entries = await fs.readdir(templatesSourceDir, { withFileTypes: true }).catch(() => []);
  const copiedFiles = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const sourcePath = path.join(templatesSourceDir, entry.name, "figma-spec.json");
    try {
      await fs.access(sourcePath);
    } catch {
      continue;
    }
    const targetDir = path.join(templatesPublicDir, entry.name);
    await fs.mkdir(targetDir, { recursive: true });
    const relativeFilePath = path.join("templates", entry.name, "figma-spec.json");
    await fs.copyFile(sourcePath, path.join(targetDir, "figma-spec.json"));
    copiedFiles.push(relativeFilePath);
  }
  return copiedFiles.sort();
}

async function copyWorkerPublicAssets() {
  const copiedFiles = [];
  const relativeDirs = ["stage3-template-badges", "stage3-template-backdrops"];
  for (const relativeDir of relativeDirs) {
    const sourceDir = path.join(publicSourceDir, relativeDir);
    const targetDir = path.join(workerPublicAssetsDir, relativeDir);
    const entries = await fs.readdir(sourceDir, { withFileTypes: true }).catch(() => []);
    if (entries.length === 0) {
      continue;
    }
    await fs.mkdir(targetDir, { recursive: true });
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      await fs.copyFile(path.join(sourceDir, entry.name), path.join(targetDir, entry.name));
      copiedFiles.push(path.join(relativeDir, entry.name));
    }
  }
  return copiedFiles.sort();
}

function buildRuntimeVersion(baseVersion) {
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  return `${baseVersion}+${stamp}`;
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

async function syncWorkerRuntimeSources() {
  await fs.rm(remotionPublicDir, { recursive: true, force: true }).catch(() => undefined);
  await fs.rm(libPublicDir, { recursive: true, force: true }).catch(() => undefined);
  await fs.rm(designPublicDir, { recursive: true, force: true }).catch(() => undefined);
  await fs.rm(workerPublicAssetsDir, { recursive: true, force: true }).catch(() => undefined);
  await fs.mkdir(remotionPublicDir, { recursive: true });
  await fs.mkdir(libPublicDir, { recursive: true });
  await fs.mkdir(designPublicDir, { recursive: true });
  await fs.mkdir(workerPublicAssetsDir, { recursive: true });

  await fs.cp(remotionSourceDir, remotionPublicDir, { recursive: true });
  const designFiles = await copyWorkerTemplateSpecs();
  const publicFiles = await copyWorkerPublicAssets();
  for (const fileName of WORKER_LIB_RUNTIME_FILES) {
    const sourcePath = path.join(libSourceDir, fileName);
    const destinationPath = path.join(libPublicDir, fileName);
    await fs.copyFile(sourcePath, destinationPath);
  }

  const copiedFiles = await fs.readdir(libPublicDir);
  const expected = new Set(WORKER_LIB_RUNTIME_FILES);
  const unexpected = copiedFiles.filter((fileName) => !expected.has(fileName));
  if (unexpected.length > 0) {
    throw new Error(
      `Worker runtime contains unexpected lib files: ${unexpected.join(", ")}. ` +
        "Do not maintain manual template source mirrors in public/stage3-worker/lib."
    );
  }

  return {
    designFiles,
    publicFiles
  };
}

async function main() {
  const rootPackageJson = await readPackageJson();
  const version =
    typeof rootPackageJson.version === "string" && rootPackageJson.version.trim()
      ? rootPackageJson.version.trim()
      : "0.0.0";
  const runtimeVersion = buildRuntimeVersion(version);
  const remotionFiles = await listWorkerRemotionRuntimeFiles();
  await fs.mkdir(publicDir, { recursive: true });
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

  await build({
    entryPoints: [workerEntry],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: ["node22"],
    outfile: bundlePath,
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
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
