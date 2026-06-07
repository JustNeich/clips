import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  resolveStage3WorkerAdvertisedVersion,
  shouldRestartStage3WorkerAfterSync
} from "../lib/stage3-worker-runtime-sync";
import {
  getStage3WorkerHomeDir,
  isStage3WorkerRuntimeDependenciesArchiveCompatible,
  resolveStage3WorkerRuntimeDependenciesPlatform,
  syncStage3WorkerRuntime
} from "../lib/stage3-worker-runtime";

test("worker advertises the bundled runtime version instead of the downloaded manifest version", () => {
  assert.equal(
    resolveStage3WorkerAdvertisedVersion({
      bundledRuntimeVersion: "1.0.0+20260413170000",
      packageVersion: "1.0.0"
    }),
    "1.0.0+20260413170000"
  );
});

test("worker falls back to package version when the bundle has no embedded runtime version", () => {
  assert.equal(
    resolveStage3WorkerAdvertisedVersion({
      bundledRuntimeVersion: null,
      packageVersion: "1.0.0"
    }),
    "1.0.0"
  );
});

test("worker must restart after syncing a newer runtime than the currently running bundle", () => {
  assert.equal(
    shouldRestartStage3WorkerAfterSync({
      bundledRuntimeVersion: "1.0.0+20260413170000",
      syncResult: {
        updated: true,
        runtimeVersion: "1.0.0+20260413180500"
      }
    }),
    true
  );
});

test("worker does not restart when sync confirms the currently running runtime", () => {
  assert.equal(
    shouldRestartStage3WorkerAfterSync({
      bundledRuntimeVersion: "1.0.0+20260413180500",
      syncResult: {
        updated: false,
        runtimeVersion: "1.0.0+20260413180500"
      }
    }),
    false
  );
});

test("runtime dependency archive is used only for the matching OS and CPU", () => {
  assert.equal(
    resolveStage3WorkerRuntimeDependenciesPlatform({ platform: "win32", arch: "x64" }),
    "win32-x64"
  );
  assert.equal(
    isStage3WorkerRuntimeDependenciesArchiveCompatible({
      manifestPlatform: "linux-x64",
      workerPlatform: "win32-x64"
    }),
    false
  );
  assert.equal(
    isStage3WorkerRuntimeDependenciesArchiveCompatible({
      manifestPlatform: "WIN32-X64",
      workerPlatform: "win32-x64"
    }),
    true
  );
  assert.equal(
    isStage3WorkerRuntimeDependenciesArchiveCompatible({
      manifestPlatform: "",
      workerPlatform: "darwin-arm64"
    }),
    false
  );
});

test("runtime sync reads the private runtime manifest API with worker session auth", { concurrency: false }, async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "stage3-worker-runtime-home-"));
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  const previousLocalAppData = process.env.LOCALAPPDATA;
  const originalFetch = globalThis.fetch;
  const manifest = {
    version: "1.0.0",
    runtimeVersion: "1.0.0+runtime.private-api-test",
    bundleFile: "clips-stage3-worker.cjs",
    remotionFiles: ["index.tsx"],
    libFiles: ["stage3-template.ts"],
    designFiles: ["templates/science-card-v1/figma-spec.json"],
    publicFiles: ["asset.svg"]
  };

  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  process.env.LOCALAPPDATA = path.join(tempHome, "AppData", "Local");
  const workerHome = getStage3WorkerHomeDir();

  try {
    await fs.mkdir(path.join(workerHome, "bin"), { recursive: true });
    await fs.mkdir(path.join(workerHome, "remotion"), { recursive: true });
    await fs.mkdir(path.join(workerHome, "lib"), { recursive: true });
    await fs.mkdir(path.join(workerHome, "design", "templates", "science-card-v1"), { recursive: true });
    await fs.mkdir(path.join(workerHome, "public"), { recursive: true });
    for (const packageName of [
      ["@remotion", "renderer"],
      ["@remotion", "bundler"],
      ["esbuild"],
      ["remotion"],
      ["react"],
      ["react-dom"]
    ]) {
      await fs.mkdir(path.join(workerHome, "node_modules", ...packageName), { recursive: true });
      await fs.writeFile(path.join(workerHome, "node_modules", ...packageName, "package.json"), "{}");
    }
    await fs.writeFile(path.join(workerHome, "manifest.json"), JSON.stringify(manifest));
    await fs.writeFile(path.join(workerHome, "package.json"), "{}");
    await fs.writeFile(path.join(workerHome, "bin", "clips-stage3-worker.cjs"), "bundle");
    await fs.writeFile(path.join(workerHome, "remotion", "index.tsx"), "remotion");
    await fs.writeFile(path.join(workerHome, "lib", "stage3-template.ts"), "lib");
    await fs.writeFile(
      path.join(workerHome, "design", "templates", "science-card-v1", "figma-spec.json"),
      "{}"
    );
    await fs.writeFile(path.join(workerHome, "public", "asset.svg"), "<svg />");

    let manifestFetches = 0;
    globalThis.fetch = (async (input, init) => {
      manifestFetches += 1;
      assert.equal(
        String(input),
        "https://clips.example.com/api/stage3/worker/runtime/manifest.json"
      );
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer worker-session-token");
      return new Response(JSON.stringify(manifest), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as typeof fetch;

    const result = await syncStage3WorkerRuntime("https://clips.example.com/", {
      sessionToken: "worker-session-token"
    });

    assert.deepEqual(result, {
      updated: false,
      runtimeVersion: "1.0.0+runtime.private-api-test"
    });
    assert.equal(manifestFetches, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    if (previousUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = previousUserProfile;
    }
    if (previousLocalAppData === undefined) {
      delete process.env.LOCALAPPDATA;
    } else {
      process.env.LOCALAPPDATA = previousLocalAppData;
    }
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});
