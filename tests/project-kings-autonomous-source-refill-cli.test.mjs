import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--import",
      "tsx",
      path.join(REPO_ROOT, "scripts/run-project-kings-autonomous-source-refill.mts"),
      ...args
    ], {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

test("autonomous source-refill CLI loads CommonJS-backed TypeScript modules before config validation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "project-kings-refill-cli-"));
  try {
    const missingConfig = path.join(root, "missing.env");
    const result = await runCli(["--config", missingConfig, "--mode", "dry_run"]);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.doesNotMatch(result.stderr, /SyntaxError|does not provide an export named/);
    const payload = JSON.parse(result.stderr.trim().split(/\r?\n/).at(-1));
    assert.equal(payload.scope, "project-kings-autonomous-source-refill");
    assert.equal(payload.status, "blocked");
    assert.match(payload.error, /Private source-refill config is missing/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
