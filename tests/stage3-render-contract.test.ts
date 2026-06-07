import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  buildStage3ExtractSegmentFfmpegArgs,
  buildStage3FitClipVideoFilters,
  buildStage3PreparedDurationGuardFfmpegArgs,
  buildStage3SourceAudioGainFfmpegArgs,
  buildNormalizeStage3SourceFfmpegArgs,
  prepareStage3SourceClip,
  resolveStage3AudioTrackOutputPath,
  resolveStage3SegmentExtractionMode,
  resolveStage3SourcePreparationScaleFilter,
  STAGE3_RENDER_SAFE_SOURCE_SCALE_FILTER,
  STAGE3_NORMALIZED_SOURCE_VIDEO_FILTER
} from "../lib/stage3-media-agent";
import {
  buildFinalizeRenderedOutputArgs,
  normalizeRenderPlan as normalizeServerRenderPlan,
  buildStage3CustomVideoBackgroundStillFfmpegArgs,
  buildStage3SourceBackgroundStillFfmpegArgs,
  shouldReuseRemotionBundle,
  shouldUseHostedFastVideoBackgroundStill
} from "../lib/stage3-render-service";
import { buildStage3EditorSession } from "../lib/stage3-editor-core";
import { STAGE3_TEMPLATE_ID } from "../lib/stage3-template";
import { buildStage3VideoPlacementStyle } from "../lib/stage3-video-placement";
import {
  createStage3VariationProfile,
  resolveStage3RenderVariationMode,
  type Stage3VariationProfile
} from "../lib/stage3-render-variation";

const execFileAsync = promisify(execFile);

async function writeVideoWithAudio(filePath: string, durationSec: number, audioDurationSec = durationSec): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=s=64x64:r=30:d=${durationSec}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:sample_rate=48000:duration=${audioDurationSec}`,
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

async function probeStreamDurations(filePath: string): Promise<{ video: number | null; audio: number | null; format: number | null }> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,duration:format=duration",
    "-of",
    "json",
    filePath
  ]);
  const parsed = JSON.parse(stdout) as {
    streams?: Array<{ codec_type?: string; duration?: string }>;
    format?: { duration?: string };
  };
  const readDuration = (value: unknown): number | null => {
    const parsedValue = typeof value === "string" ? Number.parseFloat(value) : NaN;
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null;
  };
  return {
    video: readDuration(parsed.streams?.find((stream) => stream.codec_type === "video")?.duration),
    audio: readDuration(parsed.streams?.find((stream) => stream.codec_type === "audio")?.duration),
    format: readDuration(parsed.format?.duration)
  };
}

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

function withEnv<T>(patch: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(patch)) {
    previous.set(key, process.env[key]);
    const value = patch[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("stage3 source normalization args force stable CFR and limited-range color contract", () => {
  const args = buildNormalizeStage3SourceFfmpegArgs({
    sourcePath: "/tmp/in.mp4",
    outputPath: "/tmp/out.mp4",
    sourceHasAudio: true
  });

  assert.deepEqual(args.slice(0, 4), ["-y", "-i", "/tmp/in.mp4", "-vf"]);
  assert.equal(args[4], STAGE3_NORMALIZED_SOURCE_VIDEO_FILTER);
  assert.deepEqual(args.slice(args.indexOf("-map"), args.indexOf("-map") + 2), ["-map", "0:v:0"]);
  assert.ok(args.includes("0:a:0"));
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

test("stage3 source audio gain re-encodes only the audio stream", () => {
  const args = buildStage3SourceAudioGainFfmpegArgs({
    inputPath: "/tmp/in.mp4",
    outputPath: "/tmp/out.mp4",
    durationSec: 9,
    sourceAudioGain: 1.5
  });

  assert.deepEqual(args.slice(0, 4), ["-y", "-i", "/tmp/in.mp4", "-filter_complex"]);
  assert.equal(args[args.indexOf("-filter_complex") + 1], "[0:a]volume=1.500[a]");
  assert.ok(args.includes("-c:v"));
  assert.equal(args[args.indexOf("-c:v") + 1], "copy");
  assert.ok(args.includes("-c:a"));
  assert.equal(args[args.indexOf("-t") + 1], "9.000");
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

test("hosted fast custom video background still args extract one render-sized frame", () => {
  const args = buildStage3CustomVideoBackgroundStillFfmpegArgs({
    inputPath: "/tmp/background.mp4",
    outputPath: "/tmp/background.jpg",
    width: 1080,
    height: 1920
  });

  assert.deepEqual(args.slice(0, 5), ["-y", "-ss", "0", "-i", "/tmp/background.mp4"]);
  assert.ok(args.includes("-frames:v"));
  const filter = args[args.indexOf("-vf") + 1] ?? "";
  assert.match(filter, /scale=1080:1920:force_original_aspect_ratio=increase/);
  assert.match(filter, /crop=1080:1920/);
  assert.match(filter, /format=yuv420p/);
  assert.equal(args.at(-1), "/tmp/background.jpg");
});

test("hosted fast custom video background still is enabled only for Render fast profile", () => {
  withEnv(
    {
      RENDER: "true",
      STAGE3_HOSTED_FAST_RENDER_PROFILE: undefined,
      STAGE3_HOSTED_FAST_VIDEO_BACKGROUND_STILL: undefined
    },
    () => {
      assert.equal(shouldUseHostedFastVideoBackgroundStill(), true);
    }
  );
  withEnv(
    {
      RENDER: "true",
      STAGE3_HOSTED_FAST_RENDER_PROFILE: undefined,
      STAGE3_HOSTED_FAST_VIDEO_BACKGROUND_STILL: "0"
    },
    () => {
      assert.equal(shouldUseHostedFastVideoBackgroundStill(), false);
    }
  );
  withEnv(
    {
      RENDER: undefined,
      STAGE3_HOSTED_FAST_RENDER_PROFILE: undefined,
      STAGE3_HOSTED_FAST_VIDEO_BACKGROUND_STILL: undefined
    },
    () => {
      assert.equal(shouldUseHostedFastVideoBackgroundStill(), false);
    }
  );
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

test("render source preparation pads truncated source audio to the target duration", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage3-prepared-audio-duration-"));
  const sourcePath = path.join(tmpDir, "source-short-audio.mp4");

  try {
    await writeVideoWithAudio(sourcePath, 6, 3);
    const renderPlan = normalizeServerRenderPlan(
      {
        targetDurationSec: 6,
        durationMode: "channel_default",
        audioMode: "source_only",
        sourceAudioEnabled: true
      },
      6,
      STAGE3_TEMPLATE_ID,
      undefined
    );
    const prepared = await prepareStage3SourceClip({
      sourcePath,
      tmpDir,
      sourceDurationSec: 6,
      clipStartSec: 0,
      clipDurationSec: 6,
      renderPlan,
      profile: "render"
    });
    const durations = await probeStreamDurations(prepared.preparedPath);

    assert.ok((durations.video ?? 0) >= 5.8, `expected prepared video near target, got ${durations.video}`);
    assert.ok((durations.audio ?? 0) >= 5.8, `expected prepared audio near target, got ${durations.audio}`);
    assert.ok((durations.format ?? 0) >= 5.8, `expected prepared container near target, got ${durations.format}`);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("Stage 3 audio track helper avoids in-place ffmpeg output paths", () => {
  const tmpDir = path.join(os.tmpdir(), "stage3-audio-track-collision");

  assert.equal(
    resolveStage3AudioTrackOutputPath(path.join(tmpDir, "clip-fit.mp4"), tmpDir),
    path.join(tmpDir, "clip-audio.mp4")
  );
  assert.equal(
    resolveStage3AudioTrackOutputPath(path.join(tmpDir, "clip-audio.mp4"), tmpDir),
    path.join(tmpDir, "clip-audio-track.mp4")
  );
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

test("hosted fast render segment extraction uses fast seek to avoid decoding the whole source", () => {
  withEnv(
    {
      RENDER: "true",
      STAGE3_HOSTED_FAST_RENDER_PROFILE: undefined
    },
    () => {
      assert.equal(resolveStage3SegmentExtractionMode("render"), "fast");
      const args = buildStage3ExtractSegmentFfmpegArgs({
        sourcePath: "/tmp/in.mp4",
        outputPath: "/tmp/out.mp4",
        segment: {
          startSec: 41.2,
          endSec: 47.2,
          speed: 1
        },
        profile: "render",
        sourceHasAudio: true
      });

      assert.deepEqual(args.slice(0, 6), ["-y", "-ss", "41.200", "-t", "6.000", "-i"]);
      assert.equal(args[6], "/tmp/in.mp4");
      assert.equal(args.includes("-fflags"), false);
      assert.equal(args.includes("-avoid_negative_ts"), false);
    }
  );
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
  assert.ok(args.includes("-bitexact"));
  assert.equal(
    args.some((value, index) => value === "-c" && args[index + 1] === "copy"),
    false
  );
});

test("final render args can take video from remotion output and audio from prepared source", () => {
  const args = buildFinalizeRenderedOutputArgs({
    inputPath: "/tmp/visual.mp4",
    audioInputPath: "/tmp/prepared-source.mp4",
    outputPath: "/tmp/final.mp4",
    metadataTitle: "Stable Render",
    variationProfile: createVariationProfile("off")
  });

  assert.deepEqual(args.slice(0, 7), [
    "-y",
    "-i",
    "/tmp/visual.mp4",
    "-i",
    "/tmp/prepared-source.mp4",
    "-map",
    "0:v:0"
  ]);
  assert.ok(args.includes("1:a?"));
  assert.equal(args.includes("0:a?"), false);
  assert.ok(args.includes("-shortest"));
});

test("final render args can clamp muxed output to the render target duration", () => {
  const args = buildFinalizeRenderedOutputArgs({
    inputPath: "/tmp/visual.mp4",
    audioInputPath: "/tmp/prepared-source.mp4",
    outputPath: "/tmp/final.mp4",
    metadataTitle: "Stable Render",
    durationSec: 6,
    variationProfile: createVariationProfile("off")
  });

  assert.ok(args.includes("-t"));
  assert.equal(args[args.indexOf("-t") + 1], "6.000");
  assert.equal(args.includes("-shortest"), false);
});

test("hosted fast final render args stream-copy video instead of re-encoding it", () => {
  const args = buildFinalizeRenderedOutputArgs({
    inputPath: "/tmp/visual.mp4",
    audioInputPath: "/tmp/prepared-source.mp4",
    outputPath: "/tmp/final.mp4",
    metadataTitle: "Stable Render",
    durationSec: 6,
    variationProfile: createVariationProfile("encode"),
    videoMode: "copy"
  });

  assert.ok(args.includes("-c:v"));
  assert.equal(args[args.indexOf("-c:v") + 1], "copy");
  assert.equal(args.includes("-vf"), false);
  assert.equal(args.includes("libx264"), false);
  assert.ok(args.includes("-c:a"));
  assert.equal(args[args.indexOf("-c:a") + 1], "copy");
  assert.ok(args.includes("+faststart"));
  assert.ok(args.includes("-map_metadata"));
  // Copy path must still stamp the bt709 limited-range colour VUI and strip the
  // encoder SEI fingerprint via bitstream filters (no transcode).
  const bsf = args[args.indexOf("-bsf:v") + 1] ?? "";
  assert.match(bsf, /h264_metadata/);
  assert.match(bsf, /colour_primaries=1/);
  assert.match(bsf, /matrix_coefficients=1/);
  assert.match(bsf, /video_full_range_flag=0/);
  assert.match(bsf, /filter_units=remove_types=6/);
});

test("final render mux preserves prepared source audio when remotion output has only video", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage3-final-audio-mux-"));
  const visualPath = path.join(tmpDir, "visual.mp4");
  const preparedPath = path.join(tmpDir, "prepared.mp4");
  const finalPath = path.join(tmpDir, "final.mp4");

  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=64x64:r=30:d=1",
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      visualPath
    ]);
    await execFileAsync("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=64x64:r=30:d=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=1",
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
      preparedPath
    ]);
    await execFileAsync("ffmpeg", buildFinalizeRenderedOutputArgs({
      inputPath: visualPath,
      audioInputPath: preparedPath,
      outputPath: finalPath,
      metadataTitle: null,
      variationProfile: createVariationProfile("off")
    }));
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_type",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      finalPath
    ]);

    assert.equal(stdout.trim(), "audio");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("final render copy mode remuxes to a valid bt709 stream without re-encoding", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage3-final-copy-"));
  const visualPath = path.join(tmpDir, "visual.mp4");
  const finalPath = path.join(tmpDir, "final.mp4");
  try {
    // H.264 yuv420p with UNSPECIFIED colour (like a Remotion render) so the copy
    // path's h264_metadata bitstream filter must stamp bt709 without a transcode.
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "testsrc=s=256x256:r=30:d=1",
      "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", visualPath
    ]);
    await execFileAsync(
      "ffmpeg",
      buildFinalizeRenderedOutputArgs({
        inputPath: visualPath,
        outputPath: finalPath,
        metadataTitle: "Copy Mode",
        variationProfile: createVariationProfile("off"),
        videoMode: "copy"
      })
    );
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,color_primaries,color_transfer,color_space",
      "-of", "default=noprint_wrappers=1", finalPath
    ]);
    assert.match(stdout, /codec_name=h264/);
    assert.match(stdout, /color_primaries=bt709/);
    assert.match(stdout, /color_transfer=bt709/);
    assert.match(stdout, /color_space=bt709/);
    // Decodes cleanly end-to-end.
    await execFileAsync("ffmpeg", ["-v", "error", "-i", finalPath, "-f", "null", "-"]);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
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
    assert.ok(["medium", "fast"].includes(profile.encode.x264Preset));
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

test("remotion bundle is reused inside the worker runtime so it is not rebuilt per render", () => {
  const prevWorker = process.env.STAGE3_WORKER_INSTALL_ROOT;
  const prevOverride = process.env.STAGE3_REUSE_REMOTION_BUNDLE;
  try {
    delete process.env.STAGE3_REUSE_REMOTION_BUNDLE;
    // Inside the worker runtime (STAGE3_WORKER_INSTALL_ROOT set) the bundle is
    // reused even though the worker never sets NODE_ENV=production.
    process.env.STAGE3_WORKER_INSTALL_ROOT = "/tmp/clips-stage3-worker";
    assert.equal(shouldReuseRemotionBundle(), true);

    // Outside the worker (and not production, as in the test env) it is not reused.
    delete process.env.STAGE3_WORKER_INSTALL_ROOT;
    assert.equal(shouldReuseRemotionBundle(), false);

    // Explicit opt-out wins even inside the worker.
    process.env.STAGE3_WORKER_INSTALL_ROOT = "/tmp/clips-stage3-worker";
    process.env.STAGE3_REUSE_REMOTION_BUNDLE = "0";
    assert.equal(shouldReuseRemotionBundle(), false);
  } finally {
    if (prevWorker === undefined) delete process.env.STAGE3_WORKER_INSTALL_ROOT;
    else process.env.STAGE3_WORKER_INSTALL_ROOT = prevWorker;
    if (prevOverride === undefined) delete process.env.STAGE3_REUSE_REMOTION_BUNDLE;
    else process.env.STAGE3_REUSE_REMOTION_BUNDLE = prevOverride;
  }
});
