import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isEsbuildNativeBinaryError,
  ensureEsbuildRuntimeAvailable,
  readEsbuildRepairPlan,
  resolveEsbuildPlatformPackageName
} from "../lib/stage3-esbuild-runtime";

test("resolveEsbuildPlatformPackageName maps supported worker platforms", () => {
  assert.equal(
    resolveEsbuildPlatformPackageName({ platform: "darwin", arch: "arm64" }),
    "@esbuild/darwin-arm64"
  );
  assert.equal(
    resolveEsbuildPlatformPackageName({ platform: "darwin", arch: "x64" }),
    "@esbuild/darwin-x64"
  );
  assert.equal(
    resolveEsbuildPlatformPackageName({ platform: "win32", arch: "x64" }),
    "@esbuild/win32-x64"
  );
  assert.equal(
    resolveEsbuildPlatformPackageName({ platform: "linux", arch: "x64" }),
    "@esbuild/linux-x64"
  );
  assert.equal(
    resolveEsbuildPlatformPackageName({ platform: "linux", arch: "arm64" }),
    "@esbuild/linux-arm64"
  );
});

test("isEsbuildNativeBinaryError recognizes copied node_modules platform mismatch", () => {
  assert.equal(
    isEsbuildNativeBinaryError(
      "You installed esbuild for another platform than the one you're currently using. " +
        "Specifically the \"@esbuild/linux-x64\" package is present but this platform needs the \"@esbuild/win32-x64\" package instead."
    ),
    true
  );
  assert.equal(isEsbuildNativeBinaryError("Error: network timeout"), false);
});

test("readEsbuildRepairPlan uses installed esbuild metadata to build a platform repair install", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clips-esbuild-runtime-test-"));
  try {
    const esbuildDir = path.join(root, "node_modules", "esbuild");
    await mkdir(esbuildDir, { recursive: true });
    await writeFile(
      path.join(esbuildDir, "package.json"),
      JSON.stringify({
        name: "esbuild",
        version: "0.25.12",
        optionalDependencies: {
          "@esbuild/linux-x64": "0.25.12",
          "@esbuild/win32-x64": "0.25.12"
        }
      }),
      "utf-8"
    );

    const plan = await readEsbuildRepairPlan(root, {
      platform: "win32",
      arch: "x64"
    });

    assert.deepEqual(plan, {
      esbuildVersion: "0.25.12",
      platformPackageName: "@esbuild/win32-x64",
      platformPackageVersion: "0.25.12",
      installPackages: [
        "esbuild@0.25.12",
        "@esbuild/win32-x64@0.25.12"
      ]
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ensureEsbuildRuntimeAvailable repairs copied node_modules with a mocked npm install", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clips-esbuild-runtime-repair-test-"));
  try {
    const esbuildDir = path.join(root, "node_modules", "esbuild");
    await mkdir(esbuildDir, { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "worker-root" }), "utf-8");
    await writeFile(
      path.join(esbuildDir, "package.json"),
      JSON.stringify({
        name: "esbuild",
        version: "0.25.12",
        main: "index.js",
        optionalDependencies: {
          "@esbuild/darwin-arm64": "0.25.12",
          "@esbuild/linux-x64": "0.25.12",
          "@esbuild/win32-x64": "0.25.12"
        }
      }),
      "utf-8"
    );
    await writeFile(
      path.join(esbuildDir, "index.js"),
      [
        "exports.transformSync = () => {",
        "  throw new Error('You installed esbuild for another platform than the one you are currently using. Specifically the \"@esbuild/linux-x64\" package is present.');",
        "};"
      ].join("\n"),
      "utf-8"
    );
    const npmCommand = path.join(root, "mock-npm.js");
    await writeFile(
      npmCommand,
      [
        "#!/usr/bin/env node",
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        "fs.writeFileSync(path.join(process.cwd(), 'node_modules', 'esbuild', 'index.js'), 'exports.transformSync = () => ({ code: \"ok\" });\\n');"
      ].join("\n"),
      "utf-8"
    );
    await chmod(npmCommand, 0o755);

    const result = await ensureEsbuildRuntimeAvailable({
      installRoot: root,
      npmCommand
    });

    assert.equal(result.ready, true);
    assert.equal(result.repaired, true);
    assert.equal(result.repairPlan?.platformPackageName, resolveEsbuildPlatformPackageName());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
