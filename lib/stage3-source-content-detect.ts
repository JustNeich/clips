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

// Runs ffmpeg cropdetect across a few sampled seconds of the source and returns
// the detected content rect (or null when the frame is full-bleed). Best-effort:
// any ffmpeg failure resolves to "no bars detected" so render never blocks on it.
export async function detectSourceContentRect(params: {
  sourcePath: string;
  sourceWidth: number;
  sourceHeight: number;
  sampleSeconds?: number;
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
    return resolveDetectedContent(crop, params.sourceWidth, params.sourceHeight);
  } catch {
    return { rect: null, hasBars: false, pixelCrop: null };
  }
}
