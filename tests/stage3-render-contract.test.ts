import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStage3ExtractSegmentFfmpegArgs,
  buildStage3FitClipVideoFilters,
  buildStage3PreparedDurationGuardFfmpegArgs,
  buildNormalizeStage3SourceFfmpegArgs,
  resolveStage3SegmentExtractionMode,
  resolveStage3SourcePreparationScaleFilter,
  STAGE3_RENDER_SAFE_SOURCE_SCALE_FILTER,
  STAGE3_NORMALIZED_SOURCE_VIDEO_FILTER
} from "../lib/stage3-media-agent";
import {
  buildFinalizeRenderedOutputArgs,
  normalizeRenderPlan as normalizeServerRenderPlan,
  buildStage3SourceBackgroundStillFfmpegArgs
} from "../lib/stage3-render-service";
import { buildStage3EditorSession } from "../lib/stage3-editor-core";
import { STAGE3_TEMPLATE_ID } from "../lib/stage3-template";
import { buildStage3VideoPlacementStyle } from "../lib/stage3-video-placement";
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
      nonce: "nonce1234567890"
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

test("render background still args avoid a second remotion source-video decode", () => {
  const args = buildStage3SourceBackgroundStillFfmpegArgs({
    inputPath: "/tmp/source.mp4",
    outputPath: "/tmp/background.jpg"
  });

  assert.deepEqual(args.slice(0, 5), ["-y", "-ss", "0", "-i", "/tmp/source.mp4"]);
  assert.ok(args.includes("-frames:v"));
  const filter = args[args.indexOf("-vf") + 1] ?? "";
  assert.match(filter, /scale=1080:1920:force_original_aspect_ratio=increase/);
  assert.match(filter, /crop=1080:1920/);
  assert.match(filter, /gblur=sigma=18/);
  assert.equal(args.at(-1), "/tmp/background.jpg");
});

test("render source duration guard pads short prepared clips with the final frame", () => {
  const args = buildStage3PreparedDurationGuardFfmpegArgs({
    inputPath: "/tmp/in.mp4",
    outputPath: "/tmp/out.mp4",
    inputDurationSec: 5.1,
    targetDurationSec: 6,
    sourceHasAudio: true,
    profile: "render"
  });
  const filter = args[args.indexOf("-filter_complex") + 1] ?? "";

  assert.match(filter, /tpad=stop_mode=clone:stop_duration=0\.900/);
  assert.match(filter, /trim=duration=6\.000/);
  assert.match(filter, /apad=pad_dur=0\.900/);
  assert.ok(args.includes("-t"));
  assert.equal(args[args.indexOf("-t") + 1], "6.000");
});

test("stage3 video placement anchors zoom transform to Position X and Y", () => {
  const style = buildStage3VideoPlacementStyle({
    focusX: 0.82,
    focusY: 0.18,
    videoZoom: 1.4,
    mirrorEnabled: false
  });

  assert.equal(style.objectPosition, "82.000% 18.000%");
  assert.equal(style.transform, "translate(-12.800%, 12.800%) scale(1.400, 1.400)");
  assert.equal(style.transformOrigin, "center center");
});

test("stage3 video placement keeps 1x zoom when only Position X/Y changes", () => {
  const style = buildStage3VideoPlacementStyle({
    focusX: 0.82,
    focusY: 0.18,
    videoZoom: 1,
    mirrorEnabled: false
  });

  assert.equal(style.objectPosition, "82.000% 18.000%");
  assert.equal(style.transform, "translate(0.000%, 0.000%) scale(1.000, 1.000)");
  assert.equal(style.transformOrigin, "center center");
});

test("stage3 mirrored video placement keeps the same visual pan while flipping X scale", () => {
  const style = buildStage3VideoPlacementStyle({
    focusX: 0.12,
    focusY: 0.88,
    videoZoom: 1.25,
    mirrorEnabled: true
  });

  assert.equal(style.objectPosition, "12.000% 88.000%");
  assert.equal(style.transform, "translate(9.500%, -9.500%) scale(-1.250, 1.250)");
  assert.equal(style.transformOrigin, "center center");
});

test("stage3 video placement can vertically squeeze only the source video", () => {
  const style = buildStage3VideoPlacementStyle({
    focusX: 0.5,
    focusY: 0.18,
    videoZoom: 1,
    videoScaleY: 0.75,
    mirrorEnabled: false
  });

  assert.equal(style.objectPosition, "50.000% 18.000%");
  assert.equal(style.transform, "translate(0.000%, 0.000%) scale(1.000, 0.750)");
  assert.equal(style.transformOrigin, "center center");
});

test("stage3 vertical source scale keeps Y pan based on effective vertical overflow", () => {
  const style = buildStage3VideoPlacementStyle({
    focusX: 0.82,
    focusY: 0.18,
    videoZoom: 1.4,
    videoScaleY: 0.8,
    mirrorEnabled: false
  });

  assert.equal(style.objectPosition, "82.000% 18.000%");
  assert.equal(style.transform, "translate(-12.800%, 3.840%) scale(1.400, 1.120)");
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
  const filters = args[args.indexOf("-vf") + 1] ?? "";
  assert.ok(filters.includes(STAGE3_RENDER_SAFE_SOURCE_SCALE_FILTER));
  assert.match(filters, /fps=30/);
  assert.match(filters, /setpts=PTS-STARTPTS/);
  assert.match(filters, /format=yuv420p/);
  assert.ok(args.includes("-c:a"));
});

test("server render plan preserves whole-window selection for local worker renders", () => {
  const renderPlan = normalizeServerRenderPlan(
    {
      targetDurationSec: 6,
      editorSelectionMode: "window",
      normalizeToTargetEnabled: true,
      policy: "fixed_segments",
      segments: [
        {
          startSec: 2,
          endSec: 10,
          speed: 1,
          label: "Window"
        }
      ]
    },
    18,
    STAGE3_TEMPLATE_ID,
    undefined
  );

  assert.equal(renderPlan.editorSelectionMode, "window");
  assert.equal(renderPlan.policy, "fixed_segments");
  assert.deepEqual(renderPlan.segments, [
    {
      startSec: 2,
      endSec: 10,
      speed: 1,
      label: "Window",
      focusX: null,
      focusY: null,
      videoZoom: null,
      mirrorEnabled: null
    }
  ]);

  const session = buildStage3EditorSession({
    rawSegments: renderPlan.segments,
    selectionMode: renderPlan.editorSelectionMode,
    legacyRenderPolicy: renderPlan.policy,
    legacyNormalizeToTargetEnabled: renderPlan.normalizeToTargetEnabled,
    clipStartSec: 2,
    clipDurationSec: renderPlan.targetDurationSec,
    targetDurationSec: renderPlan.targetDurationSec,
    sourceDurationSec: 18
  });

  assert.equal(session.source.selectionMode, "window");
  assert.equal(session.output.timingMode, "compress");
  assert.equal(session.source.totalSelectedSourceDurationSec, 8);
  assert.equal(session.output.totalOutputDurationSec, 6);
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

test("final render args do not write variation metadata into the mp4 container", () => {
  const args = buildFinalizeRenderedOutputArgs({
    inputPath: "/tmp/raw.mp4",
    outputPath: "/tmp/final.mp4",
    metadataTitle: null,
    variationProfile: createVariationProfile("hybrid")
  });

  assert.ok(args.includes("+faststart"));
  assert.equal(args.includes("+faststart+use_metadata_tags"), false);
  assert.equal(args.includes("-empty_hdlr_name"), false);
  assert.equal(args.includes("-write_tmcd"), false);
  assert.doesNotMatch(args.join("\n"), /variation_(seed|profile_version|mode|nonce)/);
  assert.doesNotMatch(args.join("\n"), /0123456789abcdef0123456789abcdef/);
});

test("stage3 render variation defaults to ultra-subtle hybrid mode when no override is set", () => {
  const previous = process.env.STAGE3_RENDER_VARIATION_MODE;
  delete process.env.STAGE3_RENDER_VARIATION_MODE;

  try {
    assert.equal(resolveStage3RenderVariationMode(), "hybrid");
    const profile = createStage3VariationProfile();
    assert.equal(profile.requestedMode, "hybrid");
    assert.equal(profile.appliedMode, "hybrid");
    assert.equal(profile.signal.enabled, true);
    assert.ok(profile.signal.opacity >= 0.0025);
    assert.ok(profile.signal.opacity <= 0.0055);
    assert.ok([17, 18, 19].includes(profile.encode.crf));
    assert.ok(["slow", "medium"].includes(profile.encode.x264Preset));
  } finally {
    if (previous === undefined) {
      delete process.env.STAGE3_RENDER_VARIATION_MODE;
    } else {
      process.env.STAGE3_RENDER_VARIATION_MODE = previous;
    }
  }
});

test("stage3 render variation can still run encode-only without visual signal", () => {
  const profile = createStage3VariationProfile({ requestedMode: "encode" });

  assert.equal(profile.requestedMode, "encode");
  assert.equal(profile.appliedMode, "encode");
  assert.equal(profile.signal.enabled, false);
  assert.equal(profile.signal.opacity, 0);
});
