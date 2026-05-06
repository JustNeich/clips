import assert from "node:assert/strict";
import test from "node:test";

import { buildStage3WorkerNpmInvocation } from "../lib/stage3-worker-npm";

test("worker npm runner invokes npm.cmd through cmd.exe on Windows", () => {
  assert.deepEqual(
    buildStage3WorkerNpmInvocation({
      platform: "win32",
      npmArgs: ["install", "--omit=dev"]
    }),
    {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "npm.cmd", "install", "--omit=dev"]
    }
  );
});

test("worker npm runner wraps absolute Windows command shims", () => {
  assert.deepEqual(
    buildStage3WorkerNpmInvocation({
      platform: "win32",
      npmCommand: "C:\\Program Files\\nodejs\\npm.cmd",
      npmArgs: ["install", "@rspack/binding-win32-x64-msvc"]
    }),
    {
      command: "cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        "C:\\Program Files\\nodejs\\npm.cmd",
        "install",
        "@rspack/binding-win32-x64-msvc"
      ]
    }
  );
});

test("worker npm runner keeps direct npm execution on non-Windows platforms", () => {
  assert.deepEqual(
    buildStage3WorkerNpmInvocation({
      platform: "darwin",
      npmArgs: ["install", "--omit=dev"]
    }),
    {
      command: "npm",
      args: ["install", "--omit=dev"]
    }
  );
});

test("worker npm runner does not wrap non-shim commands on Windows", () => {
  assert.deepEqual(
    buildStage3WorkerNpmInvocation({
      platform: "win32",
      npmCommand: "node",
      npmArgs: ["npm-cli.js", "install"]
    }),
    {
      command: "node",
      args: ["npm-cli.js", "install"]
    }
  );
});
