import { promises as fs } from "node:fs";
import path from "node:path";
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
const remotionPublicDir = path.join(publicDir, "remotion");
const libPublicDir = path.join(publicDir, "lib");
const packageJsonPath = path.join(repoRoot, "package.json");
const remotionSourceDir = path.join(repoRoot, "remotion");
const stage3TemplateSourcePath = path.join(repoRoot, "lib", "stage3-template.ts");
const stage3ConstantsSourcePath = path.join(repoRoot, "lib", "stage3-constants.ts");

const WORKER_RUNTIME_DEPENDENCIES = [
  "@remotion/bundler",
  "@remotion/renderer",
  "react",
  "react-dom",
  "remotion"
];

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

async function main() {
  const rootPackageJson = await readPackageJson();
  const version =
    typeof rootPackageJson.version === "string" && rootPackageJson.version.trim()
      ? rootPackageJson.version.trim()
      : "0.0.0";
  await fs.mkdir(publicDir, { recursive: true });
  await fs.rm(remotionPublicDir, { recursive: true, force: true }).catch(() => undefined);
  await fs.mkdir(remotionPublicDir, { recursive: true });
  await fs.mkdir(libPublicDir, { recursive: true });
  await fs.cp(remotionSourceDir, remotionPublicDir, { recursive: true });
  await fs.copyFile(stage3TemplateSourcePath, path.join(libPublicDir, "stage3-template.ts"));
  await fs.copyFile(stage3ConstantsSourcePath, path.join(libPublicDir, "stage3-constants.ts"));

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
      "process.env.CLIPS_STAGE3_WORKER_VERSION": JSON.stringify(version)
    }
  });

  await fs.chmod(bundlePath, 0o755).catch(() => undefined);
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        version,
        builtAt: new Date().toISOString(),
        bundleFile: path.basename(bundlePath)
      },
      null,
      2
    ),
    "utf-8"
  );
  await fs.writeFile(
    workerPackagePath,
    JSON.stringify(
      {
        name: "clips-stage3-worker",
        version,
        private: true,
        type: "commonjs",
        engines: {
          node: ">=22"
        },
        dependencies: pickWorkerDependencies(rootPackageJson)
      },
      null,
      2
    ),
    "utf-8"
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
