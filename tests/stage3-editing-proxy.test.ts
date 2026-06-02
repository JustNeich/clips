import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  buildStage3EditingProxyFfmpegArgs,
  buildStage3FitClipVideoFilters,
  prepareStage3EditingProxy,
  STAGE3_EVEN_DIMENSIONS_FILTER
} from "../lib/stage3-media-agent";
import { STAGE3_EDITING_PROXY_CACHE_VERSION } from "../lib/stage3-editing-proxy-contract";

const execFileAsync = promisify(execFile);

async function writeVideoWithAudio(filePath: string): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=64x64:r=30:d=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=2",
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    filePath
  ]);
}

async function probeAudioDuration(filePath: string): Promise<number | null> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath
  ]);
  const parsed = Number.parseFloat(stdout.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

test("editing proxy ffmpeg args force dense keyframes for reliable fragment seeks", () => {
  const args = buildStage3EditingProxyFfmpegArgs({
    sourcePath: "/tmp/source.mp4",
    outputPath: "/tmp/proxy.mp4",
    profile: {
      preset: "ultrafast",
      crf: "34",
      threads: "2",
      maxDimensionPx: 960,
      fps: 30,
      keyframeIntervalFrames: 3
    },
    sourceHasAudio: true
  });

  assert.deepEqual(args.slice(0, 4), ["-y", "-i", "/tmp/source.mp4", "-vf"]);
  assert.ok(
    args.includes(
      `fps=30,scale=960:-2:force_original_aspect_ratio=decrease,${STAGE3_EVEN_DIMENSIONS_FILTER}`
    )
  );
  assert.deepEqual(args.slice(args.indexOf("-g"), args.indexOf("-g") + 2), ["-g", "3"]);
  assert.deepEqual(
    args.slice(args.indexOf("-keyint_min"), args.indexOf("-keyint_min") + 2),
    ["-keyint_min", "3"]
  );
  assert.deepEqual(
    args.slice(args.indexOf("-sc_threshold"), args.indexOf("-sc_threshold") + 2),
    ["-sc_threshold", "0"]
  );
  assert.deepEqual(args.slice(args.indexOf("-map"), args.indexOf("-map") + 2), ["-map", "0:v:0"]);
  assert.ok(args.includes("0:a:0"));
  assert.ok(args.includes("-c:a"));
  assert.equal(args.includes("-an"), false);
});

test("editing proxy omits audio encoding when the source has no audio stream", () => {
  const args = buildStage3EditingProxyFfmpegArgs({
    sourcePath: "/tmp/source.mp4",
    outputPath: "/tmp/proxy.mp4",
    profile: {
      preset: "ultrafast",
      crf: "34",
      threads: "2",
      maxDimensionPx: 960,
      fps: 30,
      keyframeIntervalFrames: 3
    },
    sourceHasAudio: false
  });

  assert.deepEqual(args.slice(args.indexOf("-map"), args.indexOf("-map") + 2), ["-map", "0:v:0"]);
  assert.ok(args.includes("-an"));
  assert.equal(args.includes("-c:a"), false);
});

test("editing proxy preserves source audio when the source has audio", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage3-editing-proxy-audio-"));
  const sourcePath = path.join(tmpDir, "source.mp4");

  try {
    await writeVideoWithAudio(sourcePath);
    const proxy = await prepareStage3EditingProxy({
      sourcePath,
      tmpDir,
      sourceFileName: "source.mp4"
    });
    const audioDuration = await probeAudioDuration(proxy.proxyPath);

    assert.ok(
      (audioDuration ?? 0) > 1.5,
      `expected editing proxy audio near source duration, got ${audioDuration}`
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("editing proxy cache version is bumped when seek semantics change", () => {
  assert.equal(STAGE3_EDITING_PROXY_CACHE_VERSION, "v5");
});

test("fit clip filters always force even frame dimensions before libx264 encode", () => {
  const filters = buildStage3FitClipVideoFilters({
    effectiveRatio: 1.125,
    smoothSlowMo: true,
    pts: "1.125000"
  });

  assert.ok(filters.startsWith("setpts=1.125000*PTS,minterpolate=fps=60,fps=30,"));
  assert.ok(filters.endsWith(STAGE3_EVEN_DIMENSIONS_FILTER));
});
