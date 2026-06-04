import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const entryPoint = path.join(repoRoot, "apps", "stage3-host-render-child", "index.ts");
const outfile = path.join(repoRoot, "output", "stage3-host-render-child.cjs");

await build({
  entryPoints: [entryPoint],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: ["node22"],
  outfile,
  sourcemap: false,
  legalComments: "none",
  banner: {
    js: "#!/usr/bin/env node"
  },
  external: [
    "@node-rs/argon2",
    "@remotion/bundler",
    "@remotion/renderer",
    "next",
    "react",
    "react-dom",
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
    "remotion",
    "server-only"
  ]
});

console.log(`Built Stage 3 host render child bundle: ${path.relative(repoRoot, outfile)}`);
