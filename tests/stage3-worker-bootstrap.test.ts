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

  assert.match(script, /function Write-ClipsStage3BootstrapLog/);
  assert.match(script, /Bootstrap log:/);
  assert.match(script, /Share this log with support:/);
  assert.match(script, /Invoke-WebRequest \$Uri -UseBasicParsing -ErrorAction Stop -OutFile \$OutFile/);
  assert.match(script, /Invoke-ClipsStage3Download -Uri "\$serverOrigin\/stage3-worker\/clips-stage3-worker\.cjs" -OutFile \$bundlePath -Label "worker bundle"/);
  assert.match(script, /Installing worker runtime dependencies with npm/);
});
