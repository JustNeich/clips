import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanupOrphanedStage3BrowserProcesses,
  isOrphanedStage3BrowserProcess,
  parseStage3WorkerProcessList,
  type Stage3WorkerProcessRecord
} from "../lib/stage3-worker-process-cleanup";

const workerRoot = "/Users/tester/Library/Application Support/Clips Stage3 Worker";

test("orphan matcher selects only reparented worker-owned headless browsers", () => {
  const records = parseStage3WorkerProcessList(
    [
      `101 1 ${workerRoot}/cache/remotion/chrome-headless-shell --type=renderer`,
      `102 99 ${workerRoot}/cache/remotion/chrome-headless-shell --type=renderer`,
      "103 1 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless",
      "104 1 /Users/tester/Library/Caches/remotion/headless-shell/chrome-headless-shell --type=gpu-process"
    ].join("\n")
  );

  assert.equal(isOrphanedStage3BrowserProcess(records[0]!, workerRoot), true);
  assert.equal(isOrphanedStage3BrowserProcess(records[1]!, workerRoot), false);
  assert.equal(isOrphanedStage3BrowserProcess(records[2]!, workerRoot), false);
  assert.equal(isOrphanedStage3BrowserProcess(records[3]!, workerRoot), true);
});

test("cleanup terminates and then force-kills only surviving orphan candidates", async () => {
  const orphan: Stage3WorkerProcessRecord = {
    pid: 201,
    parentPid: 1,
    command: `${workerRoot}/cache/remotion/chrome-headless-shell --type=renderer`
  };
  const activeChild: Stage3WorkerProcessRecord = {
    pid: 202,
    parentPid: 77,
    command: `${workerRoot}/cache/remotion/chrome-headless-shell --type=renderer`
  };
  let reads = 0;
  const signals: Array<[number, NodeJS.Signals]> = [];
  const cleaned = await cleanupOrphanedStage3BrowserProcesses({
    workerRoot,
    processListReader: async () => {
      reads += 1;
      return reads === 1 ? [orphan, activeChild] : [orphan, activeChild];
    },
    killProcess: (pid, signal) => {
      signals.push([pid, signal]);
    },
    delay: async () => undefined
  });

  assert.equal(cleaned, 1);
  assert.deepEqual(signals, [
    [201, "SIGTERM"],
    [201, "SIGKILL"]
  ]);
});
