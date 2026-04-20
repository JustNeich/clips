import assert from "node:assert/strict";
import test from "node:test";

import { resolveStage3WorkerRestartLaunch } from "../lib/stage3-worker-restart";

test("worker restart uses the bundled cmd wrapper on Windows when it is available", () => {
  const launch = resolveStage3WorkerRestartLaunch({
    platform: "win32",
    execPath: "C:\\Program Files\\nodejs\\node.exe",
    argv: [
      "C:\\Program Files\\nodejs\\node.exe",
      "C:\\Users\\tester\\AppData\\Local\\Clips Stage3 Worker\\bin\\clips-stage3-worker.cjs",
      "start"
    ],
    cwd: "C:\\Users\\tester\\AppData\\Local\\Clips Stage3 Worker",
    installRoot: "C:\\Users\\tester\\AppData\\Local\\Clips Stage3 Worker",
    comspec: "C:\\Windows\\System32\\cmd.exe",
    wrapperExists: true
  });

  assert.deepEqual(launch, {
    command: "C:\\Windows\\System32\\cmd.exe",
    args: [
      "/d",
      "/s",
      "/c",
      "\"C:\\Users\\tester\\AppData\\Local\\Clips Stage3 Worker\\bin\\clips-stage3-worker.cmd\" start"
    ],
    cwd: "C:\\Users\\tester\\AppData\\Local\\Clips Stage3 Worker"
  });
});

test("worker restart falls back to the current node process when no Windows wrapper is available", () => {
  const launch = resolveStage3WorkerRestartLaunch({
    platform: "win32",
    execPath: "C:\\Program Files\\nodejs\\node.exe",
    argv: ["C:\\Program Files\\nodejs\\node.exe", "C:\\repo\\apps\\stage3-worker\\index.ts", "start"],
    cwd: "C:\\repo",
    installRoot: "C:\\Users\\tester\\AppData\\Local\\Clips Stage3 Worker",
    wrapperExists: false
  });

  assert.deepEqual(launch, {
    command: "C:\\Program Files\\nodejs\\node.exe",
    args: ["C:\\repo\\apps\\stage3-worker\\index.ts", "start"],
    cwd: "C:\\repo"
  });
});
