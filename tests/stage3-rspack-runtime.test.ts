import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isRspackNativeBindingError,
  readRspackRepairPlan,
  resolveRspackPlatformPackageName
} from "../lib/stage3-rspack-runtime";

test("resolveRspackPlatformPackageName maps supported worker platforms", () => {
  assert.equal(
    resolveRspackPlatformPackageName({ platform: "darwin", arch: "arm64" }),
    "@rspack/binding-darwin-arm64"
  );
  assert.equal(
    resolveRspackPlatformPackageName({ platform: "darwin", arch: "x64" }),
    "@rspack/binding-darwin-x64"
  );
  assert.equal(
    resolveRspackPlatformPackageName({ platform: "win32", arch: "x64" }),
    "@rspack/binding-win32-x64-msvc"
  );
  assert.equal(
    resolveRspackPlatformPackageName({ platform: "linux", arch: "x64", musl: false }),
    "@rspack/binding-linux-x64-gnu"
  );
  assert.equal(
    resolveRspackPlatformPackageName({ platform: "linux", arch: "x64", musl: true }),
    "@rspack/binding-linux-x64-musl"
  );
});

test("isRspackNativeBindingError recognizes npm optional native binding failures", () => {
  assert.equal(
    isRspackNativeBindingError(
      "Cannot find native binding. Cannot find module './rspack.darwin-universal.node'"
    ),
    true
  );
  assert.equal(
    isRspackNativeBindingError("Error: Cannot find module '@rspack/binding-darwin-arm64'"),
    true
  );
  assert.equal(isRspackNativeBindingError("Error: network timeout"), false);
});

test("readRspackRepairPlan uses installed rspack package metadata to build a repair install", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clips-rspack-runtime-test-"));
  try {
    const coreDir = path.join(root, "node_modules", "@rspack", "core");
    const bindingDir = path.join(root, "node_modules", "@rspack", "binding");
    await mkdir(coreDir, { recursive: true });
    await mkdir(bindingDir, { recursive: true });
    await writeFile(
      path.join(coreDir, "package.json"),
      JSON.stringify({
        name: "@rspack/core",
        version: "1.7.6",
        dependencies: {
          "@rspack/binding": "1.7.6"
        }
      }),
      "utf-8"
    );
    await writeFile(
      path.join(bindingDir, "package.json"),
      JSON.stringify({
        name: "@rspack/binding",
        version: "1.7.6",
        optionalDependencies: {
          "@rspack/binding-darwin-arm64": "1.7.6"
        }
      }),
      "utf-8"
    );

    const plan = await readRspackRepairPlan(root, {
      platform: "darwin",
      arch: "arm64"
    });

    assert.deepEqual(plan, {
      coreVersion: "1.7.6",
      bindingVersion: "1.7.6",
      platformPackageName: "@rspack/binding-darwin-arm64",
      platformPackageVersion: "1.7.6",
      installPackages: [
        "@rspack/core@1.7.6",
        "@rspack/binding@1.7.6",
        "@rspack/binding-darwin-arm64@1.7.6"
      ]
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
