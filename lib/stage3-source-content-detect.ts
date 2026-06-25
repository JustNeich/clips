import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Detects the real picture rectangle inside a source whose own frame carries
// baked-in black bars (e.g. 16:9 footage centered in a 9:16 reel). ffmpeg's
// `cropdetect` filter reports the non-black bounding box; we strip those bars by
// turning the detected box into a normalized sourceCrop so the editor frames the
// actual content, not the donor letterbox/pillarbox. This is separate from the
// decorative background and from in-frame fit (see stage3-aspect-fit).

export type NormalizedContentRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DetectedSourceContent = {
  rect: NormalizedContentRect | null;
  // True only when the detected content is meaningfully smaller than the full
  // frame on at least one axis (i.e. real baked-in bars were found).
  hasBars: boolean;
  pixelCrop: { w: number; h: number; x: number; y: number } | null;
};

// Below this fraction of inset on an axis we treat the frame as full-bleed and
// do NOT crop — avoids fighting 1-2px encoder noise on clean sources.
const MIN_BAR_FRACTION = 0.04;
const DENSE_SAMPLE_WIDTH = 120;
const DENSE_SAMPLE_HEIGHT = 214;
const DENSE_LUMA_THRESHOLD = 32;
const DENSE_ROW_THRESHOLD = 0.55;
const DENSE_COL_THRESHOLD = 0.5;
const MIN_DENSE_HEIGHT_FRACTION = 0.3;
const MIN_DENSE_WIDTH_FRACTION = 0.55;
const MAX_OUTSIDE_DENSITY = 0.28;

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// Parses ffmpeg cropdetect stderr and returns the LAST `crop=W:H:X:Y` it emitted
// (cropdetect refines its estimate over time; the final line is the steady box).
export function parseCropdetectCrop(
  stderr: string
): { w: number; h: number; x: number; y: number } | null {
  if (typeof stderr !== "string" || !stderr) {
    return null;
  }
  const matches = stderr.match(/crop=(\d+):(\d+):(\d+):(\d+)/g);
  if (!matches || matches.length === 0) {
    return null;
  }
  const last = matches[matches.length - 1];
  const parts = last.replace("crop=", "").split(":");
  const [w, h, x, y] = parts.map((p) => Number.parseInt(p, 10));
  if (![w, h, x, y].every((n) => Number.isFinite(n) && n >= 0)) {
    return null;
  }
  if (w <= 0 || h <= 0) {
    return null;
  }
  return { w, h, x, y };
}

// Converts a detected pixel crop to a normalized rect against the full frame, and
// decides whether it represents real bars (worth cropping) vs full-bleed noise.
export function resolveDetectedContent(
  crop: { w: number; h: number; x: number; y: number } | null,
  sourceWidth: number,
  sourceHeight: number
): DetectedSourceContent {
  if (
    !crop ||
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    return { rect: null, hasBars: false, pixelCrop: null };
  }
  // Clamp the detected box inside the frame.
  const x = Math.min(Math.max(0, crop.x), sourceWidth);
  const y = Math.min(Math.max(0, crop.y), sourceHeight);
  const w = Math.min(crop.w, sourceWidth - x);
  const h = Math.min(crop.h, sourceHeight - y);
  if (w <= 0 || h <= 0) {
    return { rect: null, hasBars: false, pixelCrop: null };
  }
  const insetX = (sourceWidth - w) / sourceWidth;
  const insetY = (sourceHeight - h) / sourceHeight;
  const hasBars = insetX >= MIN_BAR_FRACTION || insetY >= MIN_BAR_FRACTION;
  if (!hasBars) {
    return { rect: null, hasBars: false, pixelCrop: null };
  }
  return {
    rect: {
      x: Number(clampUnit(x / sourceWidth).toFixed(6)),
      y: Number(clampUnit(y / sourceHeight).toFixed(6)),
      width: Number(clampUnit(w / sourceWidth).toFixed(6)),
      height: Number(clampUnit(h / sourceHeight).toFixed(6))
    },
    hasBars: true,
    pixelCrop: { w, h, x, y }
  };
}

type DensityBand = {
  start: number;
  end: number;
  score: number;
};

function average(values: number[], start: number, endExclusive: number): number | null {
  if (endExclusive <= start) {
    return null;
  }
  let total = 0;
  for (let i = start; i < endExclusive; i += 1) {
    total += values[i] ?? 0;
  }
  return total / (endExclusive - start);
}

function findLargestDenseBand(
  values: number[],
  threshold: number,
  minLength: number
): DensityBand | null {
  let best: DensityBand | null = null;
  let start = -1;
  for (let i = 0; i <= values.length; i += 1) {
    if (i < values.length && (values[i] ?? 0) >= threshold) {
      if (start < 0) {
        start = i;
      }
      continue;
    }
    if (start >= 0) {
      const end = i - 1;
      const length = end - start + 1;
      if (length >= minLength) {
        const score = average(values, start, i) ?? 0;
        if (!best || length > best.end - best.start + 1 || score > best.score) {
          best = { start, end, score };
        }
      }
      start = -1;
    }
  }
  return best;
}

function densityBandOutsideAverage(values: number[], band: DensityBand): number {
  const before = average(values, 0, band.start);
  const after = average(values, band.end + 1, values.length);
  const candidates = [before, after].filter((value): value is number => value !== null);
  if (!candidates.length) {
    return 1;
  }
  return Math.min(...candidates);
}

export function resolveDenseContentRect(
  rowDensity: number[],
  colDensity: number[],
  sourceWidth: number,
  sourceHeight: number
): DetectedSourceContent {
  if (
    !rowDensity.length ||
    !colDensity.length ||
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  ) {
    return { rect: null, hasBars: false, pixelCrop: null };
  }

  const minRowLength = Math.max(1, Math.round(rowDensity.length * MIN_DENSE_HEIGHT_FRACTION));
  const minColLength = Math.max(1, Math.round(colDensity.length * MIN_DENSE_WIDTH_FRACTION));
  const rowBand = findLargestDenseBand(rowDensity, DENSE_ROW_THRESHOLD, minRowLength);
  const colBand = findLargestDenseBand(colDensity, DENSE_COL_THRESHOLD, minColLength);
  if (!rowBand || !colBand) {
    return { rect: null, hasBars: false, pixelCrop: null };
  }

  const x = colBand.start / colDensity.length;
  const y = rowBand.start / rowDensity.length;
  const width = (colBand.end - colBand.start + 1) / colDensity.length;
  const height = (rowBand.end - rowBand.start + 1) / rowDensity.length;
  const insetX = 1 - width;
  const insetY = 1 - height;
  const hasBars = insetX >= MIN_BAR_FRACTION || insetY >= MIN_BAR_FRACTION;
  if (!hasBars) {
    return { rect: null, hasBars: false, pixelCrop: null };
  }

  const outsideDensity = Math.min(
    densityBandOutsideAverage(rowDensity, rowBand),
    densityBandOutsideAverage(colDensity, colBand)
  );
  if (outsideDensity > MAX_OUTSIDE_DENSITY) {
    return { rect: null, hasBars: false, pixelCrop: null };
  }

  const pixelCrop = {
    w: Math.max(1, Math.round(width * sourceWidth)),
    h: Math.max(1, Math.round(height * sourceHeight)),
    x: Math.max(0, Math.round(x * sourceWidth)),
    y: Math.max(0, Math.round(y * sourceHeight))
  };
  return {
    rect: {
      x: Number(clampUnit(x).toFixed(6)),
      y: Number(clampUnit(y).toFixed(6)),
      width: Number(clampUnit(width).toFixed(6)),
      height: Number(clampUnit(height).toFixed(6))
    },
    hasBars: true,
    pixelCrop
  };
}

async function detectDenseContentRect(params: {
  sourcePath: string;
  sourceWidth: number;
  sourceHeight: number;
  sampleSeconds: number;
}): Promise<DetectedSourceContent> {
  const { stdout } = await execFileAsync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-t",
      params.sampleSeconds.toFixed(2),
      "-i",
      params.sourcePath,
      "-vf",
      `fps=1,scale=${DENSE_SAMPLE_WIDTH}:${DENSE_SAMPLE_HEIGHT},format=gray`,
      "-frames:v",
      String(Math.max(1, Math.ceil(params.sampleSeconds))),
      "-f",
      "rawvideo",
      "-"
    ],
    { maxBuffer: 8 * 1024 * 1024, encoding: "buffer" } as never
  );
  const buffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout as string, "binary");
  const frameSize = DENSE_SAMPLE_WIDTH * DENSE_SAMPLE_HEIGHT;
  const frameCount = Math.floor(buffer.length / frameSize);
  if (frameCount <= 0) {
    return { rect: null, hasBars: false, pixelCrop: null };
  }
  const rowDensity = Array.from({ length: DENSE_SAMPLE_HEIGHT }, () => 0);
  const colDensity = Array.from({ length: DENSE_SAMPLE_WIDTH }, () => 0);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = frame * frameSize;
    for (let y = 0; y < DENSE_SAMPLE_HEIGHT; y += 1) {
      let rowCount = 0;
      for (let x = 0; x < DENSE_SAMPLE_WIDTH; x += 1) {
        if ((buffer[offset + y * DENSE_SAMPLE_WIDTH + x] ?? 0) > DENSE_LUMA_THRESHOLD) {
          rowCount += 1;
        }
      }
      rowDensity[y] += rowCount / DENSE_SAMPLE_WIDTH;
    }
    for (let x = 0; x < DENSE_SAMPLE_WIDTH; x += 1) {
      let colCount = 0;
      for (let y = 0; y < DENSE_SAMPLE_HEIGHT; y += 1) {
        if ((buffer[offset + y * DENSE_SAMPLE_WIDTH + x] ?? 0) > DENSE_LUMA_THRESHOLD) {
          colCount += 1;
        }
      }
      colDensity[x] += colCount / DENSE_SAMPLE_HEIGHT;
    }
  }
  for (let y = 0; y < rowDensity.length; y += 1) {
    rowDensity[y] /= frameCount;
  }
  for (let x = 0; x < colDensity.length; x += 1) {
    colDensity[x] /= frameCount;
  }
  return resolveDenseContentRect(rowDensity, colDensity, params.sourceWidth, params.sourceHeight);
}

// Runs ffmpeg cropdetect across a few sampled seconds of the source and returns
// the detected content rect (or null when the frame is full-bleed). Best-effort:
// any ffmpeg failure resolves to "no bars detected" so render never blocks on it.
export async function detectSourceContentRect(params: {
  sourcePath: string;
  sourceWidth: number;
  sourceHeight: number;
  sampleSeconds?: number;
  detectSparseOverlayWrapper?: boolean;
}): Promise<DetectedSourceContent> {
  try {
    const sampleSeconds =
      typeof params.sampleSeconds === "number" && params.sampleSeconds > 0
        ? params.sampleSeconds
        : 4;
    // cropdetect with a low threshold + frequent reset; null muxer, log to stderr.
    const { stderr } = await execFileAsync(
      "ffmpeg",
      [
        "-hide_banner",
        "-t",
        sampleSeconds.toFixed(2),
        "-i",
        params.sourcePath,
        "-vf",
        "cropdetect=limit=24:round=2:reset=0",
        "-f",
        "null",
        "-"
      ],
      { maxBuffer: 8 * 1024 * 1024 }
    ).catch((err: { stderr?: string }) => ({ stderr: err?.stderr ?? "" }));
    const crop = parseCropdetectCrop(stderr ?? "");
    const cropDetected = resolveDetectedContent(crop, params.sourceWidth, params.sourceHeight);
    if (cropDetected.hasBars || !params.detectSparseOverlayWrapper) {
      return cropDetected;
    }
    const sourceAspect = params.sourceWidth / params.sourceHeight;
    if (!(sourceAspect > 0.45 && sourceAspect < 0.75)) {
      return cropDetected;
    }
    const denseDetected = await detectDenseContentRect({
      sourcePath: params.sourcePath,
      sourceWidth: params.sourceWidth,
      sourceHeight: params.sourceHeight,
      sampleSeconds
    });
    return denseDetected.hasBars ? denseDetected : cropDetected;
  } catch {
    return { rect: null, hasBars: false, pixelCrop: null };
  }
}
