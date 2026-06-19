import type { Stage3WatermarkBlurBox } from "../app/components/types";

// Watermark-blur boxes are expressed in RAW source-frame normalized coordinates
// (the same frame the editor samples to mark inner_video_bounds). The blur pass
// runs once on the source before crop/segmentation, so a static donor watermark
// that sits inside the kept inner video is softened in place instead of forcing
// a resolution-destroying zoom crop to push it out of frame.

const MIN_BLUR_SIDE = 0.02;
const MAX_BLUR_BOXES = 4;
const DEFAULT_BLUR_RADIUS = 14;
const MIN_BLUR_RADIUS = 4;
const MAX_BLUR_RADIUS = 40;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeUnit(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return clamp(value, 0, 1);
}

function normalizeOptionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

export function normalizeStage3WatermarkBlurs(value: unknown): Stage3WatermarkBlurBox[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const boxes: Stage3WatermarkBlurBox[] = [];
  for (const raw of value) {
    if (boxes.length >= MAX_BLUR_BOXES) {
      break;
    }
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const candidate = raw as Partial<Stage3WatermarkBlurBox> & { enabled?: unknown };
    if (candidate.enabled === false) {
      continue;
    }
    const rawX = normalizeUnit(candidate.x);
    const rawY = normalizeUnit(candidate.y);
    const rawWidth = normalizeUnit(candidate.width);
    const rawHeight = normalizeUnit(candidate.height);
    if (rawX === null || rawY === null || rawWidth === null || rawHeight === null) {
      continue;
    }
    const x = clamp(rawX, 0, 1 - MIN_BLUR_SIDE);
    const y = clamp(rawY, 0, 1 - MIN_BLUR_SIDE);
    const width = clamp(rawWidth, MIN_BLUR_SIDE, 1 - x);
    const height = clamp(rawHeight, MIN_BLUR_SIDE, 1 - y);
    const strength =
      typeof candidate.strength === "number" && Number.isFinite(candidate.strength)
        ? clamp(Math.round(candidate.strength), MIN_BLUR_RADIUS, MAX_BLUR_RADIUS)
        : DEFAULT_BLUR_RADIUS;
    boxes.push({
      x: Number(x.toFixed(6)),
      y: Number(y.toFixed(6)),
      width: Number(width.toFixed(6)),
      height: Number(height.toFixed(6)),
      strength,
      source: normalizeOptionalString(candidate.source, 80),
      notes: normalizeOptionalString(candidate.notes, 240)
    });
  }
  return boxes;
}

function evenPx(dimension: "iw" | "ih", fraction: number): string {
  return `trunc(${dimension}*${fraction.toFixed(6)}/2)*2`;
}

// Builds a filter_complex graph that blurs each box region in place: the source
// is split into a base plus one copy per box, each copy is cropped to the box
// and boxblur'd, then overlaid back onto the base at the box origin. Output pad
// is [vwm]. Returns null when there is nothing to blur.
export function buildStage3WatermarkBlurFilterComplex(
  boxes: Stage3WatermarkBlurBox[]
): string | null {
  const normalized = normalizeStage3WatermarkBlurs(boxes);
  if (normalized.length === 0) {
    return null;
  }
  const count = normalized.length;
  const parts: string[] = [];
  const splitLabels = ["wmbase", ...normalized.map((_, index) => `wmsrc${index}`)];
  parts.push(`[0:v]split=${count + 1}[${splitLabels.join("][")}]`);

  normalized.forEach((box, index) => {
    const width = evenPx("iw", box.width);
    const height = evenPx("ih", box.height);
    const x = evenPx("iw", box.x);
    const y = evenPx("ih", box.y);
    parts.push(
      `[wmsrc${index}]crop=${width}:${height}:${x}:${y},boxblur=lr=${box.strength}:cr=${box.strength}[wmblur${index}]`
    );
  });

  let previous = "wmbase";
  normalized.forEach((box, index) => {
    const x = evenPx("iw", box.x);
    const y = evenPx("ih", box.y);
    const output = index === count - 1 ? "vwm" : `wmstage${index}`;
    parts.push(`[${previous}][wmblur${index}]overlay=${x}:${y}[${output}]`);
    previous = output;
  });

  return parts.join(";");
}

export function buildStage3WatermarkBlurFfmpegArgs(params: {
  sourcePath: string;
  outputPath: string;
  boxes: Stage3WatermarkBlurBox[];
  sourceHasAudio: boolean;
  encode?: { preset: string; crf: string; threads: string };
}): string[] | null {
  const graph = buildStage3WatermarkBlurFilterComplex(params.boxes);
  if (!graph) {
    return null;
  }
  const args = ["-y", "-i", params.sourcePath, "-filter_complex", graph, "-map", "[vwm]"];
  if (params.sourceHasAudio) {
    args.push("-map", "0:a:0", "-c:a", "aac", "-ar", "48000", "-ac", "2");
  } else {
    args.push("-an");
  }
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    params.encode?.preset ?? "veryfast",
    "-crf",
    params.encode?.crf ?? "18",
    "-pix_fmt",
    "yuv420p",
    params.outputPath
  );
  return args;
}
