import assert from "node:assert/strict";
import test from "node:test";
import { buildStage3EditingProxyFfmpegArgs } from "../lib/stage3-media-agent";
import { STAGE3_EDITING_PROXY_CACHE_VERSION } from "../lib/stage3-editing-proxy-contract";

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
    }
  });

  assert.deepEqual(args.slice(0, 4), ["-y", "-i", "/tmp/source.mp4", "-vf"]);
  assert.ok(args.includes("fps=30,scale=960:-2:force_original_aspect_ratio=decrease,setsar=1"));
  assert.deepEqual(args.slice(args.indexOf("-g"), args.indexOf("-g") + 2), ["-g", "3"]);
  assert.deepEqual(
    args.slice(args.indexOf("-keyint_min"), args.indexOf("-keyint_min") + 2),
    ["-keyint_min", "3"]
  );
  assert.deepEqual(
    args.slice(args.indexOf("-sc_threshold"), args.indexOf("-sc_threshold") + 2),
    ["-sc_threshold", "0"]
  );
});

test("editing proxy cache version is bumped when seek semantics change", () => {
  assert.equal(STAGE3_EDITING_PROXY_CACHE_VERSION, "v3");
});
