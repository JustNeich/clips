import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildCodexExecArgs } from "../lib/codex-runner";
import { copyCodexExecImagesToDirectory } from "../lib/viral-shorts-worker/executor";

test("Stage 2 Codex exec uses isolated writable cwd for schema and output files", () => {
  const built = buildCodexExecArgs({
    imagePaths: ["/tmp/frame.png"],
    outputSchemaPath: "/tmp/stage2/schema.json",
    outputMessagePath: "/tmp/stage2/output.json",
    cwd: "/srv/app",
    executionCwd: "/tmp/stage2",
    codexHome: "/var/data/codex-sessions/session-1",
    model: "gpt-5.4-mini",
    reasoningEffort: "x-high"
  });

  assert.equal(built.cwd, "/tmp/stage2");
  assert.deepEqual(built.args.slice(0, 7), [
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    "workspace-write",
    "--cd",
    "/tmp/stage2",
    "--ephemeral"
  ]);
  assert.deepEqual(
    built.args.slice(built.args.indexOf("--add-dir"), built.args.indexOf("--add-dir") + 2),
    ["--add-dir", "/var/data/codex-sessions/session-1"]
  );
  assert.deepEqual(built.args.slice(-3), ["--image", "/tmp/frame.png", "-"]);
  assert.ok(built.args.includes("gpt-5.4-mini"));
  assert.ok(built.args.includes("model_reasoning_effort=\"xhigh\""));
});

test("Codex exec keeps read-only sandbox when no isolated execution cwd is provided", () => {
  const built = buildCodexExecArgs({
    imagePaths: [],
    outputSchemaPath: "/tmp/schema.json",
    outputMessagePath: "/tmp/output.json",
    cwd: "/srv/app"
  });

  assert.equal(built.cwd, "/srv/app");
  assert.deepEqual(built.args.slice(0, 6), [
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--cd",
    "/srv/app"
  ]);
  assert.equal(built.args.includes("--add-dir"), false);
});

test("Stage 2 copies Codex image inputs into the isolated execution cwd", async () => {
  const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage2-source-images-"));
  const executionDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage2-codex-images-"));
  try {
    const sourcePath = path.join(sourceDir, "frame-1.jpeg");
    await fs.writeFile(sourcePath, "frame-bytes");

    const copiedPaths = await copyCodexExecImagesToDirectory([sourcePath], executionDir);

    assert.deepEqual(copiedPaths, [path.join(executionDir, "image-1.jpeg")]);
    assert.equal(await fs.readFile(copiedPaths[0] ?? "", "utf-8"), "frame-bytes");
  } finally {
    await fs.rm(sourceDir, { recursive: true, force: true });
    await fs.rm(executionDir, { recursive: true, force: true });
  }
});
