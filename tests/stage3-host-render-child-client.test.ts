import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { executeStage3HeavyJobPayload } from "../lib/stage3-job-executor";
import {
  renderStage3VideoInChildProcess,
  shouldUseStage3HostRenderChildProcess,
  STAGE3_HOST_RENDER_PROGRESS_PREFIX
} from "../lib/stage3-host-render-child-client";

function fakeChildScript(source: string): string {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const output = args[args.indexOf("--output") + 1];
${source}
`;
}

async function withFakeChildBundle<T>(source: string, run: (bundlePath: string, dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "clips-stage3-child-test-"));
  const bundlePath = path.join(dir, "child.cjs");
  const previousBundle = process.env.STAGE3_HOST_RENDER_CHILD_BUNDLE;
  const previousFlag = process.env.STAGE3_HOST_RENDER_CHILD_PROCESS;
  const previousRender = process.env.RENDER;
  process.env.STAGE3_HOST_RENDER_CHILD_BUNDLE = bundlePath;
  process.env.STAGE3_HOST_RENDER_CHILD_PROCESS = "1";
  process.env.RENDER = "1";
  try {
    await writeFile(bundlePath, fakeChildScript(source), "utf-8");
    return await run(bundlePath, dir);
  } finally {
    if (previousBundle === undefined) {
      delete process.env.STAGE3_HOST_RENDER_CHILD_BUNDLE;
    } else {
      process.env.STAGE3_HOST_RENDER_CHILD_BUNDLE = previousBundle;
    }
    if (previousFlag === undefined) {
      delete process.env.STAGE3_HOST_RENDER_CHILD_PROCESS;
    } else {
      process.env.STAGE3_HOST_RENDER_CHILD_PROCESS = previousFlag;
    }
    if (previousRender === undefined) {
      delete process.env.RENDER;
    } else {
      process.env.RENDER = previousRender;
    }
    await rm(dir, { recursive: true, force: true });
  }
}

test("host render child client returns result and forwards progress events", async () => {
  await withFakeChildBundle(
    `
console.log(${JSON.stringify(STAGE3_HOST_RENDER_PROGRESS_PREFIX)} + JSON.stringify({ stage: "remotion_render", status: "started" }));
fs.writeFileSync(output, JSON.stringify({
  ok: true,
  resultJson: JSON.stringify({ outputName: "out.mp4" }),
  artifact: { filePath: "/tmp/out.mp4", fileName: "out.mp4", mimeType: "video/mp4" },
  cleanupDir: "/tmp/cleanup"
}));
`,
    async () => {
      const events: string[] = [];
      const result = await renderStage3VideoInChildProcess("{}", {
        onProgress: (event) => events.push(`${event.stage}:${event.status}`)
      });

      assert.deepEqual(events, ["remotion_render:started"]);
      assert.equal(result.artifact.fileName, "out.mp4");
      assert.equal(result.resultJson, JSON.stringify({ outputName: "out.mp4" }));
    }
  );
});

test("stage3 render executor uses hosted child process when enabled", async () => {
  await withFakeChildBundle(
    `
fs.writeFileSync(output, JSON.stringify({
  ok: true,
  resultJson: JSON.stringify({ outputName: "child.mp4" }),
  artifact: { filePath: "/tmp/child.mp4", fileName: "child.mp4", mimeType: "video/mp4" },
  cleanupDir: "/tmp/cleanup"
}));
`,
    async () => {
      assert.equal(shouldUseStage3HostRenderChildProcess(), true);
      const result = await executeStage3HeavyJobPayload("render", JSON.stringify({ sourceUrl: "unused" }));
      assert.equal(result.artifact?.fileName, "child.mp4");
      assert.equal(result.resultJson, JSON.stringify({ outputName: "child.mp4" }));
    }
  );
});

test("host render child client aborts a hung child process", async () => {
  await withFakeChildBundle(
    `
setInterval(() => {}, 1000);
`,
    async () => {
      const controller = new AbortController();
      const promise = renderStage3VideoInChildProcess("{}", { signal: controller.signal });
      setTimeout(() => controller.abort(new Error("test abort")), 25);
      await assert.rejects(promise, /test abort/);
    }
  );
});
