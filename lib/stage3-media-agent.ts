import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { STAGE3_SEGMENT_SPEED_OPTIONS } from "../app/components/types";
import { STAGE3_MAX_VIDEO_ZOOM, STAGE3_MIN_VIDEO_ZOOM } from "./stage3-constants";
import { downloadSourceMedia } from "./source-acquisition";
import { Stage3RenderPlan, Stage3StateSnapshot } from "./stage3-agent";
import { computeManagedTemplateTextFit } from "./managed-template-runtime";
import { maybeDownloadStage3WorkerSource } from "./stage3-worker-source-client";
import { sanitizeFileName } from "./ytdlp";

const execFileAsync = promisify(execFile);

const MOTION_SAMPLE_FPS = 8;
const DEFAULT_CLIP_DURATION_SEC = 6;
const SEGMENT_SPEED_SET = new Set<number>(STAGE3_SEGMENT_SPEED_OPTIONS);
type Stage3MediaProfile = "preview" | "render";

type EncodeProfile = {
  preset: string;
  crf: string;
  threads: string;
  fitScalePrefix: string;
};

type EditingProxyProfile = {
  preset: string;
  crf: string;
  threads: string;
  maxDimensionPx: number;
  fps: number;
  keyframeIntervalFrames: number;
};

export const STAGE3_EVEN_DIMENSIONS_FILTER = "scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,setsar=1";

export type VideoDimensions = {
  width: number;
  height: number;
};

export type Stage3ViewportBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  slotAspect: number;
  sourceWidth: number;
  sourceHeight: number;
};

export type Stage3FramingMetrics = {
  activeCenterY: number;
  activeSpan: number;
  topEdgeEnergy: number;
  bottomEdgeEnergy: number;
  leftEdgeEnergy: number;
  rightEdgeEnergy: number;
  centerEnergy: number;
  edgeEnergy: number;
  visualFocus: number;
  frameCount: number;
};

export type Stage3FramedPreviewAnalysis = {
  previewPath: string;
  keyframePaths: string[];
  viewport: Stage3ViewportBox | null;
  metrics: Stage3FramingMetrics;
};

function isMemoryConstrainedRuntime(): boolean {
  return process.env.RENDER === "true" || process.env.RENDER === "1";
}

function getEncodeProfile(profile: Stage3MediaProfile): EncodeProfile {
  const constrained = isMemoryConstrainedRuntime();
  if (profile === "preview") {
    return {
      preset: "ultrafast",
      crf: "30",
      threads: constrained ? "1" : "2",
      fitScalePrefix: ""
    };
  }
  return {
    preset: "veryfast",
    crf: "20",
    threads: constrained ? "1" : "0",
    fitScalePrefix: ""
  };
}

function getEditingProxyProfile(): EditingProxyProfile {
  const constrained = isMemoryConstrainedRuntime();
  return {
    preset: "ultrafast",
    crf: "34",
    threads: constrained ? "1" : "2",
    maxDimensionPx: constrained ? 720 : 960,
    fps: 30,
    keyframeIntervalFrames: 3
  };
}

export function buildStage3EditingProxyFfmpegArgs(params: {
  sourcePath: string;
  outputPath: string;
  profile: EditingProxyProfile;
}): string[] {
  const videoFilter = [
    `fps=${params.profile.fps},scale=${params.profile.maxDimensionPx}:-2:force_original_aspect_ratio=decrease`,
    STAGE3_EVEN_DIMENSIONS_FILTER
  ].join(",");
  return [
    "-y",
    "-i",
    params.sourcePath,
    "-vf",
    videoFilter,
    "-c:v",
    "libx264",
    "-preset",
    params.profile.preset,
    "-crf",
    params.profile.crf,
    "-threads",
    params.profile.threads,
    "-g",
    String(params.profile.keyframeIntervalFrames),
    "-keyint_min",
    String(params.profile.keyframeIntervalFrames),
    "-sc_threshold",
    "0",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-ar",
    "48000",
    "-ac",
    "2",
    params.outputPath
  ];
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeSegmentSpeed(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && SEGMENT_SPEED_SET.has(value)) {
    return value;
  }
  return 1;
}

function makeEven(value: number, min = 2): number {
  const rounded = Math.max(min, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

export function buildStage3FitClipVideoFilters(params: {
  effectiveRatio: number;
  smoothSlowMo: boolean;
  pts: string;
  scalePrefix?: string;
}): string {
  const filters: string[] = [];
  const prefix = params.scalePrefix?.trim();
  if (prefix) {
    filters.push(prefix.replace(/,+$/, ""));
  }
  filters.push(`setpts=${params.pts}*PTS`);
  if (params.smoothSlowMo && params.effectiveRatio > 1) {
    filters.push("minterpolate=fps=60", "fps=30");
  }
  filters.push(STAGE3_EVEN_DIMENSIONS_FILTER);
  return filters.join(",");
}

export function sanitizeFocusY(rawFocusY?: number | null): number {
  const value = parseNumeric(rawFocusY);
  if (value === null) {
    return 0.5;
  }
  return clampNumber(value, 0.12, 0.88);
}

export function sanitizeClipDuration(rawDuration?: number | null): number {
  const value = parseNumeric(rawDuration);
  if (value === null) {
    return DEFAULT_CLIP_DURATION_SEC;
  }
  return clampNumber(value, DEFAULT_CLIP_DURATION_SEC, DEFAULT_CLIP_DURATION_SEC);
}

export function clampClipStart(
  rawStartSec: number | null | undefined,
  sourceDurationSec: number | null,
  clipDurationSec: number
): number {
  const requested = parseNumeric(rawStartSec) ?? 0;
  if (!sourceDurationSec || sourceDurationSec <= clipDurationSec) {
    return 0;
  }
  return clampNumber(requested, 0, Math.max(0, sourceDurationSec - clipDurationSec));
}

export async function downloadSourceVideo(
  rawUrl: string,
  tmpDir: string
): Promise<{ filePath: string; fileName: string }> {
  try {
    const downloaded = await downloadSourceMedia(rawUrl, tmpDir);
    return {
      filePath: downloaded.filePath,
      fileName: sanitizeFileName(downloaded.fileName)
    };
  } catch (localError) {
    try {
      const hosted = await maybeDownloadStage3WorkerSource({
        sourceUrl: rawUrl,
        tmpDir
      });
      if (hosted) {
        return {
          filePath: hosted.filePath,
          fileName: sanitizeFileName(hosted.fileName)
        };
      }
    } catch (hostedError) {
      const localMessage =
        localError instanceof Error ? localError.message : "local source fetch failed";
      const hostedMessage =
        hostedError instanceof Error ? hostedError.message : "host source fallback failed";
      throw new Error(`${localMessage} Host fallback: ${hostedMessage}`);
    }

    throw localError;
  }
}

export async function probeVideoDurationSeconds(videoPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        videoPath
      ],
      { timeout: 30_000, maxBuffer: 1024 * 1024 }
    );

    const parsed = Number.parseFloat(stdout.trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export async function probeVideoDimensions(videoPath: string): Promise<VideoDimensions | null> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=p=0:s=x",
        videoPath
      ],
      { timeout: 30_000, maxBuffer: 1024 * 1024 }
    );

    const [widthRaw, heightRaw] = stdout.trim().split("x");
    const width = Number.parseInt(widthRaw ?? "", 10);
    const height = Number.parseInt(heightRaw ?? "", 10);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }
    return { width, height };
  } catch {
    return null;
  }
}

function computeViewportBox(
  snapshot: Stage3StateSnapshot,
  sourceDimensions: VideoDimensions
): Stage3ViewportBox {
  const computed = computeManagedTemplateTextFit({
    templateId: snapshot.renderPlan.templateId,
    topText: snapshot.topText,
    bottomText: snapshot.bottomText,
    topFontScale: snapshot.renderPlan.topFontScale,
    bottomFontScale: snapshot.renderPlan.bottomFontScale,
    templateConfigOverride: snapshot.managedTemplateState?.templateConfig
  });

  const slotAspect = computed.videoWidth / Math.max(1, computed.videoHeight);
  const sourceAspect = sourceDimensions.width / Math.max(1, sourceDimensions.height);

  let baseWidth = sourceDimensions.width;
  let baseHeight = sourceDimensions.height;

  if (sourceAspect > slotAspect) {
    baseHeight = sourceDimensions.height;
    baseWidth = Math.min(sourceDimensions.width, baseHeight * slotAspect);
  } else {
    baseWidth = sourceDimensions.width;
    baseHeight = Math.min(sourceDimensions.height, baseWidth / slotAspect);
  }

  const zoom = clampNumber(snapshot.renderPlan.videoZoom, STAGE3_MIN_VIDEO_ZOOM, STAGE3_MAX_VIDEO_ZOOM);
  const viewportWidth = Math.min(sourceDimensions.width, makeEven(clampNumber(baseWidth / zoom, 16, sourceDimensions.width)));
  const viewportHeight = Math.min(sourceDimensions.height, makeEven(clampNumber(baseHeight / zoom, 16, sourceDimensions.height)));
  const x = makeEven(
    clampNumber((sourceDimensions.width - viewportWidth) / 2, 0, sourceDimensions.width - viewportWidth),
    0
  );
  const y = Math.round(
    clampNumber(
      (sourceDimensions.height - viewportHeight) * clampNumber(snapshot.focusY, 0, 1),
      0,
      sourceDimensions.height - viewportHeight
    )
  );

  return {
    x,
    y,
    width: viewportWidth,
    height: viewportHeight,
    slotAspect,
    sourceWidth: sourceDimensions.width,
    sourceHeight: sourceDimensions.height
  };
}

function parseMotionStats(raw: string): number[] {
  const matches = raw.match(/lavfi\.signalstats\.YDIF=([0-9.]+)/g);
  if (!matches?.length) {
    return [];
  }
  return matches
    .map((entry) => Number.parseFloat(entry.split("=")[1] ?? "0"))
    .filter((value) => Number.isFinite(value));
}

async function collectBandMotionScores(
  videoPath: string,
  tmpDir: string,
  band: "top" | "middle" | "bottom"
): Promise<number[]> {
  const statsPath = path.join(tmpDir, `motion-${band}.txt`);
  const yExpr = band === "top" ? "0" : band === "middle" ? "ih/3" : "2*ih/3";
  const filter = `fps=${MOTION_SAMPLE_FPS},scale=360:-2,crop=iw:ih/3:0:${yExpr},signalstats,metadata=mode=print:file=${statsPath}`;

  await execFileAsync(
    "ffmpeg",
    ["-v", "error", "-i", videoPath, "-vf", filter, "-an", "-f", "null", "-"],
    { timeout: 2 * 60_000, maxBuffer: 1024 * 1024 * 8 }
  );

  const raw = await fs.readFile(statsPath, "utf-8").catch(() => "");
  return parseMotionStats(raw);
}

function mean(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function clamp01(value: number): number {
  return clampNumber(value, 0, 1);
}

function readPpmToken(buffer: Buffer, startIndex: number): { token: string; nextIndex: number } | null {
  let index = startIndex;
  while (index < buffer.length) {
    const char = buffer[index];
    if (char === 35) {
      while (index < buffer.length && buffer[index] !== 10) {
        index += 1;
      }
      continue;
    }
    if (char === 9 || char === 10 || char === 13 || char === 32) {
      index += 1;
      continue;
    }
    break;
  }

  if (index >= buffer.length) {
    return null;
  }

  let end = index;
  while (end < buffer.length) {
    const char = buffer[end];
    if (char === 35 || char === 9 || char === 10 || char === 13 || char === 32) {
      break;
    }
    end += 1;
  }

  return {
    token: buffer.toString("ascii", index, end),
    nextIndex: end
  };
}

function parsePpm(buffer: Buffer): { width: number; height: number; data: Buffer } | null {
  const magic = readPpmToken(buffer, 0);
  const widthToken = magic ? readPpmToken(buffer, magic.nextIndex) : null;
  const heightToken = widthToken ? readPpmToken(buffer, widthToken.nextIndex) : null;
  const maxToken = heightToken ? readPpmToken(buffer, heightToken.nextIndex) : null;

  if (!magic || !widthToken || !heightToken || !maxToken || magic.token !== "P6") {
    return null;
  }

  const width = Number.parseInt(widthToken.token, 10);
  const height = Number.parseInt(heightToken.token, 10);
  const max = Number.parseInt(maxToken.token, 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || max !== 255) {
    return null;
  }

  let dataIndex = maxToken.nextIndex;
  while (dataIndex < buffer.length) {
    const char = buffer[dataIndex];
    if (char === 9 || char === 10 || char === 13 || char === 32) {
      dataIndex += 1;
      continue;
    }
    break;
  }

  const expectedLength = width * height * 3;
  const data = buffer.subarray(dataIndex, dataIndex + expectedLength);
  if (data.length < expectedLength) {
    return null;
  }

  return { width, height, data };
}

function meanSlice(values: number[], from: number, to: number): number {
  const clampedFrom = clampNumber(from, 0, values.length);
  const clampedTo = clampNumber(to, clampedFrom + 1, values.length);
  let total = 0;
  for (let index = clampedFrom; index < clampedTo; index += 1) {
    total += values[index];
  }
  return total / Math.max(1, clampedTo - clampedFrom);
}

function analyzePpmFrame(buffer: Buffer): Stage3FramingMetrics | null {
  const parsed = parsePpm(buffer);
  if (!parsed) {
    return null;
  }

  const { width, height, data } = parsed;
  const rowEnergy = new Array<number>(height).fill(0);
  const colEnergy = new Array<number>(width).fill(0);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 3;
      if (x < width - 1) {
        const rightIndex = index + 3;
        const diff =
          Math.abs(data[index] - data[rightIndex]) +
          Math.abs(data[index + 1] - data[rightIndex + 1]) +
          Math.abs(data[index + 2] - data[rightIndex + 2]);
        const normalized = diff / 765;
        rowEnergy[y] += normalized;
        colEnergy[x] += normalized;
      }
      if (y < height - 1) {
        const bottomIndex = index + width * 3;
        const diff =
          Math.abs(data[index] - data[bottomIndex]) +
          Math.abs(data[index + 1] - data[bottomIndex + 1]) +
          Math.abs(data[index + 2] - data[bottomIndex + 2]);
        const normalized = diff / 765;
        rowEnergy[y] += normalized;
        colEnergy[x] += normalized;
      }
    }
  }

  const normalizedRowEnergy = rowEnergy.map((value) => value / Math.max(1, width * 2));
  const normalizedColEnergy = colEnergy.map((value) => value / Math.max(1, height * 2));
  const rowMean = mean(normalizedRowEnergy);
  const colMean = mean(normalizedColEnergy);
  const rowThreshold = rowMean * 0.92;
  const activeRows = normalizedRowEnergy
    .map((value, index) => ({ value, index }))
    .filter((row) => row.value >= rowThreshold);

  const rowWeightedTotal = normalizedRowEnergy.reduce((acc, value) => acc + value, 0);
  const weightedCenter =
    rowWeightedTotal > 0
      ? normalizedRowEnergy.reduce((acc, value, index) => acc + value * (index / Math.max(1, height - 1)), 0) /
        rowWeightedTotal
      : 0.5;

  const activeFirst = activeRows.at(0)?.index ?? 0;
  const activeLast = activeRows.at(-1)?.index ?? Math.max(0, height - 1);
  const activeSpan = clamp01((activeLast - activeFirst + 1) / Math.max(1, height));

  const topBand = Math.max(1, Math.round(height * 0.1));
  const bottomBandStart = Math.max(0, height - topBand);
  const sideBand = Math.max(1, Math.round(width * 0.12));
  const rightBandStart = Math.max(0, width - sideBand);

  const topEdgeEnergy = clamp01(meanSlice(normalizedRowEnergy, 0, topBand) / Math.max(0.0001, rowMean * 1.6));
  const bottomEdgeEnergy = clamp01(
    meanSlice(normalizedRowEnergy, bottomBandStart, height) / Math.max(0.0001, rowMean * 1.6)
  );
  const leftEdgeEnergy = clamp01(meanSlice(normalizedColEnergy, 0, sideBand) / Math.max(0.0001, colMean * 1.6));
  const rightEdgeEnergy = clamp01(
    meanSlice(normalizedColEnergy, rightBandStart, width) / Math.max(0.0001, colMean * 1.6)
  );
  const centerEnergy = clamp01(
    meanSlice(normalizedRowEnergy, Math.round(height * 0.28), Math.round(height * 0.72)) /
      Math.max(0.0001, rowMean * 1.4)
  );
  const edgeEnergy = clamp01((topEdgeEnergy + bottomEdgeEnergy + leftEdgeEnergy + rightEdgeEnergy) / 4);
  const visualFocus = clamp01(centerEnergy / Math.max(0.001, centerEnergy + edgeEnergy));

  return {
    activeCenterY: clamp01(weightedCenter),
    activeSpan,
    topEdgeEnergy,
    bottomEdgeEnergy,
    leftEdgeEnergy,
    rightEdgeEnergy,
    centerEnergy,
    edgeEnergy,
    visualFocus,
    frameCount: 1
  };
}

function averageFramingMetrics(metrics: Stage3FramingMetrics[]): Stage3FramingMetrics {
  if (!metrics.length) {
    return {
      activeCenterY: 0.5,
      activeSpan: 0.82,
      topEdgeEnergy: 0.18,
      bottomEdgeEnergy: 0.18,
      leftEdgeEnergy: 0.18,
      rightEdgeEnergy: 0.18,
      centerEnergy: 0.6,
      edgeEnergy: 0.24,
      visualFocus: 0.58,
      frameCount: 0
    };
  }

  const totalFrames = metrics.reduce((acc, metric) => acc + metric.frameCount, 0);
  const average = (selector: (metric: Stage3FramingMetrics) => number) =>
    metrics.reduce((acc, metric) => acc + selector(metric), 0) / metrics.length;

  return {
    activeCenterY: average((metric) => metric.activeCenterY),
    activeSpan: average((metric) => metric.activeSpan),
    topEdgeEnergy: average((metric) => metric.topEdgeEnergy),
    bottomEdgeEnergy: average((metric) => metric.bottomEdgeEnergy),
    leftEdgeEnergy: average((metric) => metric.leftEdgeEnergy),
    rightEdgeEnergy: average((metric) => metric.rightEdgeEnergy),
    centerEnergy: average((metric) => metric.centerEnergy),
    edgeEnergy: average((metric) => metric.edgeEnergy),
    visualFocus: average((metric) => metric.visualFocus),
    frameCount: totalFrames
  };
}

async function extractKeyframePpmPaths(videoPath: string, tmpDir: string): Promise<string[]> {
  const framePattern = path.join(tmpDir, "frame-%02d.ppm");
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-i",
      videoPath,
      "-vf",
      "fps=0.5,scale=180:-1:flags=bilinear",
      "-frames:v",
      "3",
      framePattern
    ],
    { timeout: 90_000, maxBuffer: 1024 * 1024 * 8 }
  );

  const files = (await fs.readdir(tmpDir))
    .filter((file) => /^frame-\d+\.ppm$/i.test(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return files.map((file) => path.join(tmpDir, file));
}

async function renderFramedPreviewVideo(params: {
  inputPath: string;
  tmpDir: string;
  snapshot: Stage3StateSnapshot;
  profile: Stage3MediaProfile;
}): Promise<{ outputPath: string; viewport: Stage3ViewportBox | null }> {
  const sourceDimensions = await probeVideoDimensions(params.inputPath);
  const outputPath = path.join(params.tmpDir, "source-framed.mp4");
  if (!sourceDimensions) {
    await fs.copyFile(params.inputPath, outputPath);
    return { outputPath, viewport: null };
  }

  const viewport = computeViewportBox(params.snapshot, sourceDimensions);
  const encode = getEncodeProfile(params.profile);
  const targetWidth = makeEven(params.profile === "preview" ? 480 : 720);
  const targetHeight = makeEven(targetWidth / Math.max(0.1, viewport.slotAspect));
  const cropFilter = `crop=${viewport.width}:${viewport.height}:${viewport.x}:${viewport.y},scale=${targetWidth}:${targetHeight}:flags=lanczos,setsar=1`;

  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-i",
      params.inputPath,
      "-vf",
      cropFilter,
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      encode.preset,
      "-crf",
      encode.crf,
      "-threads",
      encode.threads,
      outputPath
    ],
    { timeout: 2 * 60_000, maxBuffer: 1024 * 1024 * 16 }
  );

  return { outputPath, viewport };
}

export async function analyzeStage3FramedPreview(params: {
  sourcePath: string;
  tmpDir: string;
  sourceDurationSec: number | null;
  snapshot: Stage3StateSnapshot;
  musicFilePath?: string | null;
  profile?: Stage3MediaProfile;
}): Promise<Stage3FramedPreviewAnalysis> {
  const profile = params.profile ?? "preview";
  const prepared = await prepareStage3SourceClip({
    sourcePath: params.sourcePath,
    tmpDir: params.tmpDir,
    sourceDurationSec: params.sourceDurationSec,
    clipStartSec: params.snapshot.clipStartSec,
    clipDurationSec: params.snapshot.clipDurationSec,
    renderPlan: params.snapshot.renderPlan,
    musicFilePath: params.musicFilePath,
    profile
  });

  const framed = await renderFramedPreviewVideo({
    inputPath: prepared.preparedPath,
    tmpDir: params.tmpDir,
    snapshot: params.snapshot,
    profile
  });

  const keyframePaths = await extractKeyframePpmPaths(framed.outputPath, params.tmpDir).catch(() => []);
  const metrics = averageFramingMetrics(
    (
      await Promise.all(
        keyframePaths.map(async (filePath) => {
          const buffer = await fs.readFile(filePath).catch(() => null);
          return buffer ? analyzePpmFrame(buffer) : null;
        })
      )
    ).filter((metric): metric is Stage3FramingMetrics => Boolean(metric))
  );

  return {
    previewPath: framed.outputPath,
    keyframePaths,
    viewport: framed.viewport,
    metrics
  };
}

export async function analyzeBestClipAndFocus(
  videoPath: string,
  tmpDir: string,
  sourceDurationSec: number | null,
  clipDurationSec = DEFAULT_CLIP_DURATION_SEC
): Promise<{ clipStartSec: number; focusY: number }> {
  try {
    const [topScores, midScores, bottomScores] = await Promise.all([
      collectBandMotionScores(videoPath, tmpDir, "top"),
      collectBandMotionScores(videoPath, tmpDir, "middle"),
      collectBandMotionScores(videoPath, tmpDir, "bottom")
    ]);

    const scoreLength = Math.min(topScores.length, midScores.length, bottomScores.length);
    if (scoreLength <= 0) {
      return { clipStartSec: 0, focusY: 0.5 };
    }

    const windowFrames = Math.max(1, Math.round(clipDurationSec * MOTION_SAMPLE_FPS));
    const maxStartFrame = Math.max(0, scoreLength - windowFrames);
    let bestFrame = 0;
    let bestScore = -Infinity;

    for (let start = 0; start <= maxStartFrame; start += 1) {
      let score = 0;
      for (let frame = start; frame < start + windowFrames && frame < scoreLength; frame += 1) {
        score += topScores[frame] + midScores[frame] + bottomScores[frame];
      }
      const normalized = score / (windowFrames * 3);
      if (normalized > bestScore) {
        bestScore = normalized;
        bestFrame = start;
      }
    }

    const from = bestFrame;
    const to = Math.min(scoreLength, bestFrame + windowFrames);
    const topAvg = mean(topScores.slice(from, to));
    const midAvg = mean(midScores.slice(from, to));
    const bottomAvg = mean(bottomScores.slice(from, to));

    let focusY = 0.5;
    if (topAvg > midAvg && topAvg >= bottomAvg) {
      focusY = 0.24;
    } else if (bottomAvg > midAvg && bottomAvg >= topAvg) {
      focusY = 0.76;
    }

    const autoStart = bestFrame / MOTION_SAMPLE_FPS;
    const clippedStart = clampClipStart(autoStart, sourceDurationSec, clipDurationSec);

    return { clipStartSec: clippedStart, focusY };
  } catch {
    return { clipStartSec: 0, focusY: 0.5 };
  }
}

async function probeHasAudio(videoPath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=codec_type",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        videoPath
      ],
      { timeout: 30_000, maxBuffer: 1024 * 1024 }
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

function sortPreparedSegments(
  segments: Array<{ startSec: number; endSec: number; speed: number }>
): Array<{ startSec: number; endSec: number; speed: number }> {
  return [...segments].sort((left, right) => {
    if (left.startSec !== right.startSec) {
      return left.startSec - right.startSec;
    }
    if (left.endSec !== right.endSec) {
      return left.endSec - right.endSec;
    }
    return left.speed - right.speed;
  });
}

function normalizeSegments(params: {
  renderPlan: Stage3RenderPlan;
  sourceDurationSec: number | null;
  clipStartSec: number;
  clipDurationSec: number;
}): Array<{ startSec: number; endSec: number; speed: number }> {
  const sourceDuration = params.sourceDurationSec ?? null;
  const raw = params.renderPlan.segments ?? [];

  const fallbackWindow = (): Array<{ startSec: number; endSec: number; speed: number }> => {
    const start = clampClipStart(params.clipStartSec, sourceDuration, params.clipDurationSec);
    const end = sourceDuration
      ? Math.min(sourceDuration, start + params.clipDurationSec)
      : start + params.clipDurationSec;
    return [{ startSec: start, endSec: Math.max(start + 0.05, end), speed: 1 }];
  };

  const normalized: Array<{ startSec: number; endSec: number; speed: number }> = [];
  for (const segment of raw) {
    const start = clampNumber(segment.startSec, 0, sourceDuration ?? Number.POSITIVE_INFINITY);
    const endRaw = segment.endSec ?? sourceDuration ?? start + params.clipDurationSec;
    const end = clampNumber(endRaw, start + 0.05, sourceDuration ?? endRaw);
    if (end > start + 0.03) {
      normalized.push({
        startSec: start,
        endSec: end,
        speed: normalizeSegmentSpeed(segment.speed)
      });
    }
  }

  if (normalized.length > 0) {
    return sortPreparedSegments(normalized);
  }

  if (params.renderPlan.policy === "full_source_normalize") {
    if (sourceDuration && sourceDuration > 0.05) {
      return [{ startSec: 0, endSec: sourceDuration, speed: 1 }];
    }
    return fallbackWindow();
  }

  if (params.renderPlan.policy === "adaptive_window") {
    if (!sourceDuration || sourceDuration <= params.clipDurationSec) {
      return fallbackWindow();
    }

    let windowDuration = params.clipDurationSec;
    if (sourceDuration <= 12) {
      windowDuration = sourceDuration;
    } else if (sourceDuration <= 20) {
      windowDuration = clampNumber(sourceDuration * 0.55, 8, 12);
    } else {
      windowDuration = params.clipDurationSec;
    }
    windowDuration = clampNumber(windowDuration, params.clipDurationSec, sourceDuration);

    const start = clampNumber(params.clipStartSec, 0, Math.max(0, sourceDuration - windowDuration));
    const end = start + windowDuration;
    return [{ startSec: start, endSec: end, speed: 1 }];
  }

  return fallbackWindow();
}

async function extractSegmentsToFiles(
  sourcePath: string,
  tmpDir: string,
  segments: Array<{ startSec: number; endSec: number; speed: number }>,
  profile: Stage3MediaProfile
): Promise<string[]> {
  const encode = getEncodeProfile(profile);
  const previewScaleFilter =
    profile === "preview" ? "scale=540:-2:force_original_aspect_ratio=decrease,setsar=1" : null;
  const outputs: string[] = [];
  const sourceHasAudio = await probeHasAudio(sourcePath);

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const output = path.join(tmpDir, `seg-${i + 1}.mp4`);
    const speed = normalizeSegmentSpeed(segment.speed);
    const videoFilters: string[] = [];
    if (previewScaleFilter) {
      videoFilters.push(previewScaleFilter);
    }
    if (Math.abs(speed - 1) > 0.001) {
      videoFilters.push(`setpts=PTS/${speed.toFixed(6)}`);
    }
    videoFilters.push(STAGE3_EVEN_DIMENSIONS_FILTER);

    const args = [
      "-y",
      "-ss",
      segment.startSec.toFixed(3),
      "-to",
      segment.endSec.toFixed(3),
      "-i",
      sourcePath
    ];

    if (Math.abs(speed - 1) > 0.001 && sourceHasAudio) {
      args.push(
        "-filter_complex",
        `[0:v]${videoFilters.join(",")}[v];[0:a]${buildAtempoChain(speed)}[a]`,
        "-map",
        "[v]",
        "-map",
        "[a]"
      );
    } else if (videoFilters.length > 0) {
      args.push("-vf", videoFilters.join(","));
      if (!sourceHasAudio) {
        args.push("-an");
      }
    } else if (!sourceHasAudio) {
      args.push("-an");
    }

    args.push(
      "-c:v",
      "libx264",
      "-preset",
      encode.preset,
      "-crf",
      encode.crf,
      "-threads",
      encode.threads
    );

    if (sourceHasAudio) {
      args.push("-c:a", "aac", "-ar", "48000", "-ac", "2");
    }

    args.push(output);

    await execFileAsync("ffmpeg", args, {
      timeout: 2 * 60_000,
      maxBuffer: 1024 * 1024 * 16
    });
    outputs.push(output);
  }

  return outputs;
}

async function concatSegments(
  segmentFiles: string[],
  tmpDir: string,
  profile: Stage3MediaProfile
): Promise<string> {
  const encode = getEncodeProfile(profile);
  const listPath = path.join(tmpDir, "segments.txt");
  const list = segmentFiles.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n");
  await fs.writeFile(listPath, list, "utf-8");

  const output = path.join(tmpDir, "segments-joined.mp4");
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c:v",
      "libx264",
      "-preset",
      encode.preset,
      "-crf",
      encode.crf,
      "-threads",
      encode.threads,
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-ac",
      "2",
      output
    ],
    { timeout: 2 * 60_000, maxBuffer: 1024 * 1024 * 16 }
  );
  return output;
}

function buildAtempoChain(tempo: number): string {
  let remaining = tempo;
  const chain: string[] = [];

  while (remaining > 2.0) {
    chain.push("atempo=2.0");
    remaining /= 2.0;
  }
  while (remaining < 0.5) {
    chain.push("atempo=0.5");
    remaining /= 0.5;
  }
  chain.push(`atempo=${remaining.toFixed(6)}`);
  return chain.join(",");
}

async function fitClipToDuration(params: {
  inputPath: string;
  tmpDir: string;
  targetDurationSec: number;
  timingMode: "auto" | "compress" | "stretch";
  smoothSlowMo: boolean;
  profile: Stage3MediaProfile;
}): Promise<string> {
  const encode = getEncodeProfile(params.profile);
  const withAudio = await ensureAudioTrack(params.inputPath, params.tmpDir);
  const inputDuration = (await probeVideoDurationSeconds(withAudio)) ?? params.targetDurationSec;
  const target = params.targetDurationSec;
  const output = path.join(params.tmpDir, "clip-fit.mp4");
  const shouldTransform = Math.abs(inputDuration - target) > 0.005;
  if (!shouldTransform) {
    return withAudio;
  }
  const requiresCompression = inputDuration > target + 0.005;
  const requiresStretch = inputDuration < target - 0.005;
  if (params.timingMode === "compress" && !requiresCompression) {
    return withAudio;
  }
  if (params.timingMode === "stretch" && !requiresStretch) {
    return withAudio;
  }

  const ratio = target / Math.max(0.05, inputDuration);
  const effectiveRatio = ratio;
  const pts = effectiveRatio.toFixed(6);
  const tempo = (1 / effectiveRatio).toFixed(6);
  const scalePrefix = encode.fitScalePrefix;
  const videoFilters = buildStage3FitClipVideoFilters({
    effectiveRatio,
    smoothSlowMo: params.smoothSlowMo,
    pts,
    scalePrefix
  });
  const audioFilters = buildAtempoChain(Number.parseFloat(tempo));

  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-i",
      withAudio,
      "-filter_complex",
      `[0:v]${videoFilters}[v];[0:a]${audioFilters}[a]`,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-t",
      target.toFixed(3),
      "-c:v",
      "libx264",
      "-preset",
      encode.preset,
      "-crf",
      encode.crf,
      "-threads",
      encode.threads,
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-ac",
      "2",
      output
    ],
    { timeout: 3 * 60_000, maxBuffer: 1024 * 1024 * 16 }
  );

  return output;
}

async function ensureAudioTrack(inputPath: string, tmpDir: string, durationSec?: number): Promise<string> {
  const hasAudio = await probeHasAudio(inputPath);
  if (hasAudio) {
    return inputPath;
  }
  const inferredDuration = durationSec ?? (await probeVideoDurationSeconds(inputPath)) ?? DEFAULT_CLIP_DURATION_SEC;
  const output = path.join(tmpDir, "clip-audio.mp4");
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-i",
      inputPath,
      "-f",
      "lavfi",
      "-t",
      inferredDuration.toFixed(3),
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-shortest",
      output
    ],
    { timeout: 60_000, maxBuffer: 1024 * 1024 * 8 }
  );
  return output;
}

async function replaceAudioWithSilence(
  inputPath: string,
  tmpDir: string,
  durationSec: number
): Promise<string> {
  const output = path.join(tmpDir, "clip-silent.mp4");
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-i",
      inputPath,
      "-f",
      "lavfi",
      "-t",
      durationSec.toFixed(3),
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-shortest",
      output
    ],
    { timeout: 60_000, maxBuffer: 1024 * 1024 * 8 }
  );
  return output;
}

async function mixMusicIfNeeded(params: {
  inputPath: string;
  tmpDir: string;
  durationSec: number;
  audioMode: "source_only" | "source_plus_music";
  sourceAudioEnabled: boolean;
  musicGain?: number;
  musicFilePath?: string | null;
}): Promise<string> {
  const withAudio = params.sourceAudioEnabled
    ? await ensureAudioTrack(params.inputPath, params.tmpDir, params.durationSec)
    : await replaceAudioWithSilence(params.inputPath, params.tmpDir, params.durationSec);

  if (params.audioMode !== "source_plus_music") {
    return withAudio;
  }

  const generatedMusicPath = path.join(params.tmpDir, "music-bed.wav");
  const output = path.join(params.tmpDir, "clip-music.mp4");
  const musicGain = clampNumber(params.musicGain ?? 0.65, 0, 1);

  let musicInputPath = params.musicFilePath ?? null;
  if (!musicInputPath) {
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=220:sample_rate=48000:duration=${params.durationSec},volume=0.025`,
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=330:sample_rate=48000:duration=${params.durationSec},volume=0.018`,
        "-filter_complex",
        "[0:a][1:a]amix=inputs=2:normalize=0,afade=t=in:st=0:d=0.25,afade=t=out:st=5.4:d=0.6[m]",
        "-map",
        "[m]",
        "-c:a",
        "aac",
        "-ar",
        "48000",
        "-ac",
        "2",
        generatedMusicPath
      ],
      { timeout: 60_000, maxBuffer: 1024 * 1024 * 8 }
    );
    musicInputPath = generatedMusicPath;
  }

  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-i",
      withAudio,
      "-stream_loop",
      "-1",
      "-i",
      musicInputPath,
      "-filter_complex",
      `[1:a]atrim=duration=${params.durationSec},asetpts=N/SR/TB[mus];[0:a]volume=1.0[a0];[mus]volume=${musicGain.toFixed(3)}[a1];[a0][a1]amix=inputs=2:duration=first:normalize=0[a]`,
      "-map",
      "0:v:0",
      "-map",
      "[a]",
      "-t",
      params.durationSec.toFixed(3),
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-ac",
      "2",
      output
    ],
    { timeout: 90_000, maxBuffer: 1024 * 1024 * 8 }
  );

  return output;
}

export async function prepareStage3EditingProxy(params: {
  sourcePath: string;
  tmpDir: string;
  sourceFileName?: string | null;
}): Promise<{ proxyPath: string; fileName: string }> {
  const profile = getEditingProxyProfile();
  const output = path.join(params.tmpDir, "editing-proxy.mp4");
  const fileBase =
    (params.sourceFileName ? path.parse(sanitizeFileName(params.sourceFileName)).name : "").trim() || "source";

  await execFileAsync(
    "ffmpeg",
    buildStage3EditingProxyFfmpegArgs({
      sourcePath: params.sourcePath,
      outputPath: output,
      profile
    }),
    { timeout: 10 * 60_000, maxBuffer: 1024 * 1024 * 16 }
  );

  return {
    proxyPath: output,
    fileName: `${fileBase}.editing-proxy.mp4`
  };
}

export async function prepareStage3SourceClip(params: {
  sourcePath: string;
  tmpDir: string;
  sourceDurationSec: number | null;
  clipStartSec: number;
  clipDurationSec: number;
  renderPlan: Stage3RenderPlan;
  musicFilePath?: string | null;
  profile?: Stage3MediaProfile;
}): Promise<{ preparedPath: string; clipStartSec: number; clipDurationSec: number }> {
  const profile = params.profile ?? "render";
  const segments = normalizeSegments({
    renderPlan: params.renderPlan,
    sourceDurationSec: params.sourceDurationSec,
    clipStartSec: params.clipStartSec,
    clipDurationSec: params.clipDurationSec
  });

  const segmentFiles = await extractSegmentsToFiles(params.sourcePath, params.tmpDir, segments, profile);
  const joined =
    segmentFiles.length === 1 ? segmentFiles[0] : await concatSegments(segmentFiles, params.tmpDir, profile);
  const fitted = await fitClipToDuration({
    inputPath: joined,
    tmpDir: params.tmpDir,
    targetDurationSec: params.renderPlan.targetDurationSec,
    timingMode: params.renderPlan.timingMode,
    smoothSlowMo: params.renderPlan.smoothSlowMo,
    profile
  });
  const mixed = await mixMusicIfNeeded({
    inputPath: fitted,
    tmpDir: params.tmpDir,
    durationSec: params.renderPlan.targetDurationSec,
    audioMode: params.renderPlan.audioMode,
    sourceAudioEnabled: params.renderPlan.sourceAudioEnabled,
    musicGain: params.renderPlan.musicGain,
    musicFilePath: params.musicFilePath
  });

  const finalPath = path.join(params.tmpDir, "source.mp4");
  if (mixed !== finalPath) {
    await fs.copyFile(mixed, finalPath);
  }

  return {
    preparedPath: finalPath,
    clipStartSec: 0,
    clipDurationSec: params.renderPlan.targetDurationSec
  };
}
