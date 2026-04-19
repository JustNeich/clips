import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStage3ExtractSegmentFfmpegArgs,
  buildStage3FitClipVideoFilters,
  buildNormalizeStage3SourceFfmpegArgs,
  resolveStage3SegmentExtractionMode,
  resolveStage3SourcePreparationScaleFilter,
  STAGE3_RENDER_SAFE_SOURCE_SCALE_FILTER,
  STAGE3_NORMALIZED_SOURCE_VIDEO_FILTER
} from "../lib/stage3-media-agent";
import { buildFinalizeRenderedOutputArgs } from "../lib/stage3-render-service";
import {
  createStage3VariationProfile,
  resolveStage3RenderVariationMode,
  type Stage3VariationProfile
} from "../lib/stage3-render-variation";

function createVariationProfile(mode: Stage3VariationProfile["appliedMode"]): Stage3VariationProfile {
  return {
    profileVersion: 1,
    seed: "0123456789abcdef0123456789abcdef",
    requestedMode: mode,
    appliedMode: mode,
    signal: {
      enabled: mode === "hybrid",
      seed: 123,
      baseFrequencyX: 1,
      baseFrequencyY: 1,
      numOctaves: 1,
      opacity: mode === "hybrid" ? 0.02 : 0,
      blendMode: "soft-light"
    },
    encode: {
      codec: "h264",
      pixelFormat: "yuv420p",
      crf: 18,
      x264Preset: "medium",
      keyintFrames: 60,
      keyintMinFrames: 58
    },
    container: {
      faststart: true,
      metadataNonce: "nonce1234567890",
      metadataTagKey: "variation_seed"
    }
  };
}

test("stage3 source normalization args force stable CFR and limited-range color contract", () => {
  const args = buildNormalizeStage3SourceFfmpegArgs({
    sourcePath: "/tmp/in.mp4",
    outputPath: "/tmp/out.mp4",
    sourceHasAudio: true
  });

  assert.deepEqual(args.slice(0, 4), ["-y", "-i", "/tmp/in.mp4", "-vf"]);
  assert.equal(args[4], STAGE3_NORMALIZED_SOURCE_VIDEO_FILTER);
  assert.ok(args.includes("yuv420p"));
  assert.ok(args.includes("tv"));
  assert.ok(args.includes("bt709"));
  assert.ok(args.includes("-c:a"));
  assert.ok(!args.includes("-an"));
});

test("stage3 source normalization omits audio encoding when the source has no audio", () => {
  const args = buildNormalizeStage3SourceFfmpegArgs({
    sourcePath: "/tmp/in.mp4",
    outputPath: "/tmp/out.mp4",
    sourceHasAudio: false
  });

  assert.ok(args.includes("-an"));
  assert.equal(args.includes("-c:a"), false);
});

test("render source preparation caps oversized clips before remotion decodes them", () => {
  assert.equal(resolveStage3SourcePreparationScaleFilter("preview"), null);
  assert.equal(resolveStage3SourcePreparationScaleFilter("render"), STAGE3_RENDER_SAFE_SOURCE_SCALE_FILTER);
  const filters = buildStage3FitClipVideoFilters({
    effectiveRatio: 1,
    smoothSlowMo: false,
    pts: "1.000000",
    scalePrefix: resolveStage3SourcePreparationScaleFilter("render") ?? undefined
  });

  assert.match(filters, /^scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,/);
  assert.match(filters, /scale=trunc\(iw\/2\)\*2:trunc\(ih\/2\)\*2:flags=lanczos,setsar=1$/);
});

test("render segment extraction uses decode-accurate timestamps to reduce boundary flashes", () => {
  assert.equal(resolveStage3SegmentExtractionMode("render"), "accurate");
  const args = buildStage3ExtractSegmentFfmpegArgs({
    sourcePath: "/tmp/in.mp4",
    outputPath: "/tmp/out.mp4",
    segment: {
      startSec: 1.2,
      endSec: 2.7,
      speed: 1
    },
    profile: "render",
    sourceHasAudio: true
  });

  assert.deepEqual(args.slice(0, 6), ["-y", "-i", "/tmp/in.mp4", "-ss", "1.200", "-t"]);
  assert.equal(args[6], "1.500");
  assert.ok(args.includes("-fflags"));
  assert.ok(args.includes("+genpts"));
  assert.ok(args.includes("-avoid_negative_ts"));
  assert.ok(args.includes("make_zero"));
  assert.ok(args.some((value) => value.includes(STAGE3_RENDER_SAFE_SOURCE_SCALE_FILTER)));
  assert.ok(args.includes("-c:a"));
});

test("preview segment extraction keeps the fast seek path for editor responsiveness", () => {
  assert.equal(resolveStage3SegmentExtractionMode("preview"), "fast");
  const args = buildStage3ExtractSegmentFfmpegArgs({
    sourcePath: "/tmp/in.mp4",
    outputPath: "/tmp/out.mp4",
    segment: {
      startSec: 1.2,
      endSec: 2.7,
      speed: 1
    },
    profile: "preview",
    sourceHasAudio: false
  });

  assert.deepEqual(args.slice(0, 6), ["-y", "-ss", "1.200", "-t", "1.500", "-i"]);
  assert.equal(args[6], "/tmp/in.mp4");
  assert.equal(args.includes("-fflags"), false);
  assert.equal(args.includes("-avoid_negative_ts"), false);
  assert.ok(args.includes("-an"));
});

test("final render args re-encode video into a stable limited-range contract", () => {
  const args = buildFinalizeRenderedOutputArgs({
    inputPath: "/tmp/raw.mp4",
    outputPath: "/tmp/final.mp4",
    metadataTitle: "Stable Render",
    variationProfile: createVariationProfile("off")
  });

  assert.deepEqual(args.slice(0, 6), ["-y", "-i", "/tmp/raw.mp4", "-map", "0:v:0", "-map"]);
  assert.ok(args.includes("0:a?"));
  assert.ok(args.includes("format=yuv420p"));
  assert.ok(args.includes("libx264"));
  assert.ok(args.includes("tv"));
  assert.ok(args.includes("bt709"));
  assert.equal(
    args.some((value, index) => value === "-c" && args[index + 1] === "copy"),
    false
  );
});

test("final render args preserve variation metadata when variation is enabled", () => {
  const args = buildFinalizeRenderedOutputArgs({
    inputPath: "/tmp/raw.mp4",
    outputPath: "/tmp/final.mp4",
    metadataTitle: null,
    variationProfile: createVariationProfile("hybrid")
  });

  assert.ok(args.includes("+faststart+use_metadata_tags"));
  assert.ok(args.includes("variation_profile_version=1"));
  assert.ok(args.includes("variation_mode=hybrid"));
  assert.ok(args.includes("variation_seed=0123456789abcdef0123456789abcdef"));
});

test("stage3 render variation defaults to encode mode when no override is set", () => {
  const previous = process.env.STAGE3_RENDER_VARIATION_MODE;
  delete process.env.STAGE3_RENDER_VARIATION_MODE;

  try {
    assert.equal(resolveStage3RenderVariationMode(), "encode");
    const profile = createStage3VariationProfile();
    assert.equal(profile.requestedMode, "encode");
    assert.equal(profile.appliedMode, "encode");
    assert.equal(profile.signal.enabled, false);
  } finally {
    if (previous === undefined) {
      delete process.env.STAGE3_RENDER_VARIATION_MODE;
    } else {
      process.env.STAGE3_RENDER_VARIATION_MODE = previous;
    }
  }
});
