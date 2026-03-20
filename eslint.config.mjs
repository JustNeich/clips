import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals"),
  {
    ignores: [
      ".next/**",
      ".data/**",
      ".codex/**",
      ".codex-user-sessions/**",
      ".codex-user-test/**",
      ".playwright/**",
      "node_modules/**",
      "output/**",
      "public/stage3-worker/**"
    ]
  }
];

export default eslintConfig;
