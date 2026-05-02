import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { buildStage3WorkerCommands } from "../lib/stage3-worker-commands";

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

test("windows bootstrap script uses basic parsing and writes bootstrap logs", () => {
  const scriptPath = path.join(process.cwd(), "public", "stage3-worker", "bootstrap.ps1");
  const script = readFileSync(scriptPath, "utf8");
  const manifestPath = path.join(process.cwd(), "public", "stage3-worker", "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    runtimeDependenciesArchiveFile?: string;
    runtimeSourcesArchiveFile?: string;
    libFiles?: string[];
  };

  assert.match(script, /function Write-ClipsStage3BootstrapLog/);
  assert.match(script, /function Expand-ClipsStage3RuntimeArchive/);
  assert.match(script, /Bootstrap log:/);
  assert.match(script, /Share this log with support:/);
  assert.match(script, /Invoke-WebRequest \$Uri -UseBasicParsing -ErrorAction Stop -OutFile \$OutFile/);
  assert.match(script, /Invoke-ClipsStage3Download -Uri "\$serverOrigin\/stage3-worker\/clips-stage3-worker\.cjs" -OutFile \$bundlePath -Label "worker bundle"/);
  assert.equal(manifest.runtimeDependenciesArchiveFile, "runtime-deps.tar.gz");
  assert.equal(manifest.runtimeSourcesArchiveFile, "runtime-sources.tar.gz");
  assert.ok(manifest.libFiles?.includes("stage3-verified-badge.tsx"));
  assert.match(script, /runtimeDependenciesArchiveFile/);
  assert.match(script, /runtimeSourcesArchiveFile/);
  assert.match(script, /Bundled runtime sources unpacked locally\./);
  assert.match(script, /stage3-verified-badge\.tsx/);
  assert.match(script, /Bundled runtime dependencies unpacked locally\. npm registry access is not required\./);
  assert.match(script, /Installing worker runtime dependencies with npm/);
});

test("worker manifest ships only runtime-required template specs", () => {
  const manifestPath = path.join(process.cwd(), "public", "stage3-worker", "manifest.json");
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
  const manifestPath = path.join(process.cwd(), "public", "stage3-worker", "manifest.json");
  const shellScript = readFileSync(shellScriptPath, "utf8");
  const powershellScript = readFileSync(powershellScriptPath, "utf8");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    designFiles?: string[];
    libFiles?: string[];
    publicFiles?: string[];
  };
  const scripts = [shellScript, powershellScript];

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
