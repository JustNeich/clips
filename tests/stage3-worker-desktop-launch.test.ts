import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  buildStage3DesktopWorkerChildLaunch,
  buildStage3DesktopWorkerNodeCandidates
} from "../lib/stage3-worker-desktop-launch";

test("desktop worker checks explicit and common macOS Node locations", () => {
  const candidates = buildStage3DesktopWorkerNodeCandidates({
    platform: "darwin",
    homeDir: "/Users/editor",
    env: {
      NODE_ENV: "test",
      CLIPS_STAGE3_WORKER_NODE_PATH: "/custom/node"
    }
  });

  assert.equal(candidates[0], "/custom/node");
  assert.ok(candidates.includes("node"));
  assert.ok(candidates.includes("/opt/homebrew/bin/node"));
  assert.ok(candidates.includes("/usr/local/bin/node"));
});

test("desktop worker checks common Windows Node locations", () => {
  const candidates = buildStage3DesktopWorkerNodeCandidates({
    platform: "win32",
    homeDir: "C:\\Users\\Editor",
    env: {
      NODE_ENV: "test",
      PROGRAMFILES: "C:\\Program Files",
      "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
      LOCALAPPDATA: "C:\\Users\\Editor\\AppData\\Local"
    }
  });

  assert.ok(candidates.includes("node.exe"));
  assert.ok(candidates.includes("C:\\Program Files\\nodejs\\node.exe"));
  assert.ok(candidates.includes("C:\\Program Files (x86)\\nodejs\\node.exe"));
  assert.ok(candidates.includes("C:\\Users\\Editor\\AppData\\Local\\Programs\\nodejs\\node.exe"));
});

test("desktop worker child launch runs the shared CLI bundle from worker home", () => {
  const installRoot = path.join("/Users/editor/Library/Application Support", "Clips Stage3 Worker");
  const launch = buildStage3DesktopWorkerChildLaunch({
    nodeCommand: "/opt/homebrew/bin/node",
    installRoot,
    env: {
      NODE_ENV: "test",
      PATH: "/usr/bin"
    }
  });

  assert.equal(launch.command, "/opt/homebrew/bin/node");
  assert.deepEqual(launch.args, [path.join(installRoot, "bin", "clips-stage3-worker.cjs"), "start"]);
  assert.equal(launch.cwd, installRoot);
  assert.equal(launch.env.STAGE3_WORKER_INSTALL_ROOT, installRoot);
  assert.match(launch.env.PATH ?? "", /^\/opt\/homebrew\/bin:/);
});
