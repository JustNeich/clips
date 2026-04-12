import assert from "node:assert/strict";
import test from "node:test";
import type { EnsureBrowserOptions } from "@remotion/renderer";

import {
  detectPreferredStage3Browser,
  ensureStage3RenderBrowser
} from "../lib/stage3-browser-runtime";

function testEnv(entries: Record<string, string>): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    ...entries
  } as NodeJS.ProcessEnv;
}

test("detectPreferredStage3Browser honors STAGE3_BROWSER_EXECUTABLE when it exists", async () => {
  const browserPath = "/custom/browser";
  const detected = await detectPreferredStage3Browser({
    env: testEnv({
      STAGE3_BROWSER_EXECUTABLE: browserPath
    }),
    fileExists: async (filePath) => filePath === browserPath,
    homeDir: "/Users/tester",
    platform: "darwin"
  });

  assert.deepEqual(detected, {
    browserExecutable: browserPath,
    label: "STAGE3_BROWSER_EXECUTABLE",
    source: "configured-path"
  });
});

test("detectPreferredStage3Browser throws when STAGE3_BROWSER_EXECUTABLE points to a missing file", async () => {
  await assert.rejects(
    () =>
      detectPreferredStage3Browser({
        env: testEnv({
          STAGE3_BROWSER_EXECUTABLE: "/missing/browser"
        }),
        fileExists: async () => false,
        homeDir: "/Users/tester",
        platform: "darwin"
      }),
    /STAGE3_BROWSER_EXECUTABLE points to a missing file/i
  );
});

test("detectPreferredStage3Browser finds local Windows Edge before falling back to download", async () => {
  const edgePath = "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe";
  const detected = await detectPreferredStage3Browser({
    env: testEnv({
      PROGRAMFILES: "C:\\Program Files",
      "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
      LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local"
    }),
    fileExists: async (filePath) => filePath === edgePath,
    homeDir: "C:\\Users\\tester",
    platform: "win32"
  });

  assert.deepEqual(detected, {
    browserExecutable: edgePath,
    label: "Microsoft Edge",
    source: "local-install"
  });
});

test("ensureStage3RenderBrowser passes the detected browser path into Remotion", async () => {
  const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  let receivedOptions: EnsureBrowserOptions | undefined;

  const prepared = await ensureStage3RenderBrowser({
    env: testEnv({}),
    fileExists: async (filePath) => filePath === chromePath,
    homeDir: "/Users/tester",
    platform: "darwin",
    ensureBrowserImpl: async (options) => {
      receivedOptions = options;
      return {
        type: "user-defined-path",
        path: chromePath
      };
    },
    logLevel: "error"
  });

  assert.equal(receivedOptions?.browserExecutable, chromePath);
  assert.equal(receivedOptions?.chromeMode, "headless-shell");
  assert.equal(prepared.browserExecutable, chromePath);
  assert.equal(prepared.source, "local-install");
});

test("ensureStage3RenderBrowser falls back to Remotion-managed browser when no local install is found", async () => {
  let receivedOptions: EnsureBrowserOptions | undefined;

  const prepared = await ensureStage3RenderBrowser({
    env: testEnv({}),
    fileExists: async () => false,
    homeDir: "/Users/tester",
    platform: "darwin",
    ensureBrowserImpl: async (options) => {
      receivedOptions = options;
      return {
        type: "local-puppeteer-browser",
        path: "/Users/tester/.cache/remotion/headless-shell"
      };
    },
    logLevel: "warn"
  });

  assert.equal(receivedOptions?.browserExecutable, null);
  assert.equal(prepared.browserExecutable, "/Users/tester/.cache/remotion/headless-shell");
  assert.equal(prepared.source, "remotion-managed");
});
