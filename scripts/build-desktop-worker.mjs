import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const outputDir = path.join(repoRoot, "output", "desktop-worker");

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
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
        __CLIPS_STAGE3_WORKER_RUNTIME_VERSION__: JSON.stringify(null)
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
