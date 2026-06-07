import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { GET as getWorkerRuntimeFile } from "../app/api/stage3/worker/runtime/[...path]/route";
import {
  buildStage3WorkerCommands,
  buildStage3WorkerDesktopDeepLink
} from "../lib/stage3-worker-commands";
import { issueStage3WorkerPairingToken } from "../lib/stage3-worker-store";
import { getDb, newId, nowIso } from "../lib/db/client";

function decodePowershellEncodedCommand(command: string): string {
  const match = command.match(/-EncodedCommand\s+([A-Za-z0-9+/=]+)/);
  assert.ok(match, "expected -EncodedCommand payload");
  return Buffer.from(match[1], "base64").toString("utf16le");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("powershell bootstrap command enables visible diagnostics and fail-fast settings", () => {
  const commands = buildStage3WorkerCommands({
    origin: "https://clips-vy11.onrender.com",
    pairingToken: "token-123"
  });

  assert.match(commands.powershell, /powershell -NoProfile -ExecutionPolicy Bypass/);
  assert.match(commands.powershell, /-EncodedCommand\s+[A-Za-z0-9+/=]+$/);
  assert.doesNotMatch(commands.powershell, /-Command\s+"/);

  const decodedScript = decodePowershellEncodedCommand(commands.powershell);
  assert.match(decodedScript, /\$ErrorActionPreference = 'Stop'/);
  assert.match(decodedScript, /\$ProgressPreference = 'SilentlyContinue'/);
  assert.match(decodedScript, /\$bootstrapPath = Join-Path \(\[System\.IO\.Path\]::GetTempPath\(\)\) \('clips-stage3-bootstrap-'/);
  assert.match(decodedScript, /Downloading Stage 3 bootstrap/);
  assert.match(decodedScript, /Invoke-WebRequest 'https:\/\/clips-vy11\.onrender\.com\/stage3-worker\/bootstrap\.ps1' -UseBasicParsing -ErrorAction Stop -OutFile \$bootstrapPath/);
  assert.match(decodedScript, /try \{ \. \$bootstrapPath \} finally \{ Remove-Item \$bootstrapPath -Force -ErrorAction SilentlyContinue \}/);
  assert.match(decodedScript, /Install-ClipsStage3Worker -Server 'https:\/\/clips-vy11\.onrender\.com' -Token 'token-123'/);
});

test("desktop worker pairing deep link carries server, token and label", () => {
  const deepLink = buildStage3WorkerDesktopDeepLink({
    origin: "https://clips-vy11.onrender.com/",
    pairingToken: "token-123",
    label: "Katya Worker"
  });
  const parsed = new URL(deepLink);

  assert.equal(parsed.protocol, "clips-stage3-worker:");
  assert.equal(parsed.hostname, "pair");
  assert.equal(parsed.searchParams.get("server"), "https://clips-vy11.onrender.com");
  assert.equal(parsed.searchParams.get("token"), "token-123");
  assert.equal(parsed.searchParams.get("label"), "Katya Worker");
});

function privateWorkerRuntimeManifestPath(): string {
  return path.join(process.cwd(), ".stage3-worker-runtime", "manifest.json");
}

test("desktop worker build embeds the Stage 3 runtime version from the private runtime manifest", () => {
  const scriptPath = path.join(process.cwd(), "scripts", "build-desktop-worker.mjs");
  const script = readFileSync(scriptPath, "utf8");

  assert.match(script, /\.stage3-worker-runtime/s);
  assert.match(script, /runtimeVersion/);
  assert.match(script, /__CLIPS_STAGE3_WORKER_RUNTIME_VERSION__:\s*JSON\.stringify\(runtimeVersion\)/);
  assert.doesNotMatch(script, /__CLIPS_STAGE3_WORKER_RUNTIME_VERSION__:\s*JSON\.stringify\(null\)/);
});

test("desktop worker runtime sync can hydrate local runtime dependencies without npm", () => {
  const runtimePath = path.join(process.cwd(), "lib", "stage3-worker-runtime.ts");
  const runtime = readFileSync(runtimePath, "utf8");

  assert.match(runtime, /runtimeDependenciesArchiveFile/);
  assert.match(runtime, /replaceExtractedWorkerRuntimeDependencies/);
  assert.match(runtime, /workerRuntimeDependenciesMissing/);
  assert.match(runtime, /node_modules/);
});

test("worker build keeps a legacy public runtime mirror for installed desktop shells", () => {
  const scriptPath = path.join(process.cwd(), "scripts", "build-stage3-worker.mjs");
  const script = readFileSync(scriptPath, "utf8");

  assert.match(script, /syncLegacyPublicRuntimeOutputs/);
  assert.match(script, /removeLegacyPublicRuntimeOutputs/);
  assert.match(script, /runtimeDependenciesArchivePath/);
  assert.match(script, /runtimeSourcesArchivePath/);
  assert.match(script, /fs\.cp\(sourceDir, path\.join\(publicDir, targetName\), \{ recursive: true \}\)/);
});

test("windows bootstrap script uses basic parsing and writes bootstrap logs", () => {
  const scriptPath = path.join(process.cwd(), "public", "stage3-worker", "bootstrap.ps1");
  const script = readFileSync(scriptPath, "utf8");
  const manifestPath = privateWorkerRuntimeManifestPath();
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    runtimeDependenciesArchiveFile?: string;
    runtimeDependenciesPlatform?: string;
    runtimeSourcesArchiveFile?: string;
    libFiles?: string[];
  };

  assert.match(script, /function Write-ClipsStage3BootstrapLog/);
  assert.match(script, /function Expand-ClipsStage3RuntimeArchive/);
  assert.match(script, /Bootstrap log:/);
  assert.match(script, /Share this log with support:/);
  assert.match(script, /Invoke-WebRequest \$Uri -UseBasicParsing -ErrorAction Stop -Headers \$headers -OutFile \$OutFile/);
  assert.match(script, /Invoke-ClipsStage3Download -Uri "\$runtimeBase\/clips-stage3-worker\.cjs" -OutFile \$bundlePath -Label "worker bundle"/);
  assert.equal(manifest.runtimeDependenciesArchiveFile, "runtime-deps.tar.gz");
  assert.equal(manifest.runtimeDependenciesPlatform, `${process.platform}-${process.arch}`);
  assert.equal(manifest.runtimeSourcesArchiveFile, "runtime-sources.tar.gz");
  assert.ok(manifest.libFiles?.includes("stage3-verified-badge.tsx"));
  assert.match(script, /runtimeDependenciesArchiveFile/);
  assert.match(script, /runtimeDependenciesPlatform/);
  assert.match(script, /Detected runtime dependency platform/);
  assert.match(script, /Installing with npm instead/);
  assert.match(script, /runtimeSourcesArchiveFile/);
  assert.match(script, /Bundled runtime sources unpacked locally\./);
  assert.match(script, /stage3-verified-badge\.tsx/);
  assert.match(script, /Bundled runtime dependencies unpacked locally\. npm registry access is not required\./);
  assert.match(script, /Installing worker runtime dependencies with npm/);
});

test("worker manifest ships only runtime-required template specs", () => {
  const manifestPath = privateWorkerRuntimeManifestPath();
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    designFiles?: string[];
    publicFiles?: string[];
  };

  assert.deepEqual([...(manifest.designFiles ?? [])].sort(), [
    "templates/hedges-of-honor-v1/figma-spec.json",
    "templates/science-card-v1/figma-spec.json",
    "templates/science-card-v7/figma-spec.json"
  ]);
  assert.ok(
    !(manifest.designFiles ?? []).includes("templates/channel-story-v1/figma-spec.json"),
    "generated specs must not be copied into the executor runtime"
  );
  assert.ok(
    !(manifest.designFiles ?? []).includes("templates/american-news-v1/figma-spec.json"),
    "template workspace growth must not expand executor bootstrap inputs"
  );
  assert.deepEqual([...(manifest.publicFiles ?? [])].sort(), [
    "stage3-template-backdrops/hedges-of-honor-v1-shell.svg",
    "stage3-template-backdrops/science-card-v7-shell.svg",
    "stage3-template-badges/american-news-badge.svg",
    "stage3-template-badges/gold-glow-badge.png",
    "stage3-template-badges/honor-verified-badge.svg",
    "stage3-template-badges/pink-glow-badge.png",
    "stage3-template-badges/science-card-v1-check.png",
    "stage3-template-badges/twitter-verified-badge.png"
  ]);
});

test("bootstrap fallback file lists stay aligned with worker runtime manifest", () => {
  const shellScriptPath = path.join(process.cwd(), "public", "stage3-worker", "bootstrap.sh");
  const powershellScriptPath = path.join(process.cwd(), "public", "stage3-worker", "bootstrap.ps1");
  const manifestPath = privateWorkerRuntimeManifestPath();
  const shellScript = readFileSync(shellScriptPath, "utf8");
  const powershellScript = readFileSync(powershellScriptPath, "utf8");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    designFiles?: string[];
    libFiles?: string[];
    publicFiles?: string[];
  };
  const scripts = [shellScript, powershellScript];

  assert.match(shellScript, /runtimeDependenciesPlatform/);
  assert.match(shellScript, /LOCAL_RUNTIME_DEPENDENCIES_PLATFORM/);
  assert.match(shellScript, /Installing with npm instead/);

  for (const file of [
    ...(manifest.libFiles ?? []),
    ...(manifest.designFiles ?? []),
    ...(manifest.publicFiles ?? [])
  ]) {
    for (const script of scripts) {
      assert.match(script, new RegExp(escapeRegExp(file)));
    }
  }

  const generatedTemplateSpecs = [
    "templates/american-news-v1/figma-spec.json",
    "templates/channel-story-v1/figma-spec.json",
    "templates/science-card-blue-v1/figma-spec.json",
    "templates/science-card-green-v1/figma-spec.json",
    "templates/science-card-red-v1/figma-spec.json"
  ];

  for (const file of generatedTemplateSpecs) {
    for (const script of scripts) {
      assert.doesNotMatch(script, new RegExp(escapeRegExp(file)));
    }
  }
});

test("private worker runtime API requires header token and manifest allowlist", async () => {
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "clips-worker-runtime-api-"));
  const previousRuntimeDir = process.env.STAGE3_WORKER_RUNTIME_DIR;
  process.env.STAGE3_WORKER_RUNTIME_DIR = runtimeDir;
  try {
    await mkdir(path.join(runtimeDir, "lib"), { recursive: true });
    await writeFile(
      path.join(runtimeDir, "manifest.json"),
      JSON.stringify({
        bundleFile: "clips-stage3-worker.cjs",
        libFiles: ["allowed.ts"]
      })
    );
    await writeFile(path.join(runtimeDir, "clips-stage3-worker.cjs"), "bundle");
    await writeFile(path.join(runtimeDir, "package.json"), "{}");
    await writeFile(path.join(runtimeDir, "lib", "allowed.ts"), "allowed");
    await writeFile(path.join(runtimeDir, "lib", "secret.ts"), "secret");
    const stamp = nowIso();
    const suffix = newId();
    const workspaceId = `runtime_ws_${suffix}`;
    const userId = `runtime_user_${suffix}`;
    getDb()
      .prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(workspaceId, "Runtime Workspace", `runtime-workspace-${suffix}`, stamp, stamp);
    getDb()
      .prepare(
        "INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(userId, `runtime-${suffix}@example.com`, "hash", "Runtime User", "active", stamp, stamp);
    getDb()
      .prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(newId(), workspaceId, userId, "owner", stamp, stamp);
    const pairing = issueStage3WorkerPairingToken({
      workspaceId,
      userId
    });

    const queryTokenResponse = await getWorkerRuntimeFile(
      new Request(`http://localhost/api/stage3/worker/runtime/manifest.json?pairingToken=${pairing.token}`),
      { params: Promise.resolve({ path: ["manifest.json"] }) }
    );
    assert.equal(queryTokenResponse.status, 401);

    const headers = { "X-Stage3-Worker-Pairing-Token": pairing.token };
    const allowedResponse = await getWorkerRuntimeFile(
      new Request("http://localhost/api/stage3/worker/runtime/lib/allowed.ts", { headers }),
      { params: Promise.resolve({ path: ["lib", "allowed.ts"] }) }
    );
    assert.equal(allowedResponse.status, 200);

    const secretResponse = await getWorkerRuntimeFile(
      new Request("http://localhost/api/stage3/worker/runtime/lib/secret.ts", { headers }),
      { params: Promise.resolve({ path: ["lib", "secret.ts"] }) }
    );
    assert.equal(secretResponse.status, 404);
  } finally {
    if (previousRuntimeDir === undefined) {
      delete process.env.STAGE3_WORKER_RUNTIME_DIR;
    } else {
      process.env.STAGE3_WORKER_RUNTIME_DIR = previousRuntimeDir;
    }
    await rm(runtimeDir, { recursive: true, force: true });
  }
});
