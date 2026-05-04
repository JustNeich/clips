import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const outputDir = path.join(repoRoot, "output", "desktop-worker");
const workerManifestPath = path.join(repoRoot, "public", "stage3-worker", "manifest.json");

async function readWorkerRuntimeVersion() {
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(workerManifestPath, "utf-8"));
  } catch (error) {
    throw new Error(
      "Desktop worker build requires public/stage3-worker/manifest.json. " +
        `Run npm run build:stage3-worker first. ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const runtimeVersion =
    typeof manifest.runtimeVersion === "string" && manifest.runtimeVersion.trim()
      ? manifest.runtimeVersion.trim()
      : typeof manifest.version === "string" && manifest.version.trim()
        ? manifest.version.trim()
        : "";
  if (!runtimeVersion) {
    throw new Error(
      "Desktop worker build requires a non-empty runtimeVersion in public/stage3-worker/manifest.json. " +
        "Run npm run build:stage3-worker first."
    );
  }
  return runtimeVersion;
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const runtimeVersion = await readWorkerRuntimeVersion();
  await Promise.all([
    build({
      entryPoints: [path.join(repoRoot, "apps", "desktop-worker", "main.ts")],
      bundle: true,
      format: "cjs",
      platform: "node",
      target: ["node22"],
      outfile: path.join(outputDir, "main.cjs"),
      sourcemap: false,
      legalComments: "none",
      external: [
        "electron",
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
    }),
    build({
      entryPoints: [path.join(repoRoot, "apps", "desktop-worker", "preload.ts")],
      bundle: true,
      format: "cjs",
      platform: "node",
      target: ["node22"],
      outfile: path.join(outputDir, "preload.cjs"),
      sourcemap: false,
      legalComments: "none",
      external: ["electron"]
    }),
    fs.copyFile(
      path.join(repoRoot, "apps", "desktop-worker", "renderer.html"),
      path.join(outputDir, "renderer.html")
    )
  ]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
