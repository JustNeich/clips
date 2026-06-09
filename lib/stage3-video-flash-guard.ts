import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type Stage3FlashGuardRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Stage3SignalStatsFrame = {
  frame: number;
  yMin: number;
  yLow: number;
  yAvg: number;
  yHigh: number;
  yMax: number;
  uAvg: number;
  vAvg: number;
};

export type Stage3FlashRepairRange = {
  first: number;
  last: number;
  replace: number;
};

export type Stage3FlashGuardResult = {
  outputPath: string;
  mode: "clean" | "repaired";
  scannedFrameCount: number;
  repairedFrames: number[];
  repairedRanges: Stage3FlashRepairRange[];
};

const SIGNAL_STATS_KEY_MAP: Record<string, keyof Omit<Stage3SignalStatsFrame, "frame">> = {
  YMIN: "yMin",
  YLOW: "yLow",
  YAVG: "yAvg",
  YHIGH: "yHigh",
  YMAX: "yMax",
  UAVG: "uAvg",
  VAVG: "vAvg"
};

function hasCompleteSignalStatsFrame(
  value: Partial<Stage3SignalStatsFrame>
): value is Stage3SignalStatsFrame {
  return (
    typeof value.frame === "number" &&
    typeof value.yMin === "number" &&
    typeof value.yLow === "number" &&
    typeof value.yAvg === "number" &&
    typeof value.yHigh === "number" &&
    typeof value.yMax === "number" &&
    typeof value.uAvg === "number" &&
    typeof value.vAvg === "number"
  );
}

export function parseStage3SignalStats(raw: string): Stage3SignalStatsFrame[] {
  const frames = new Map<number, Partial<Stage3SignalStatsFrame>>();
  let currentFrame: Partial<Stage3SignalStatsFrame> | null = null;

  for (const line of raw.split(/\r?\n/)) {
    const frameMatch = line.match(/^frame:\s*(\d+)/);
    if (frameMatch) {
      const frame = Number.parseInt(frameMatch[1] ?? "", 10);
      if (Number.isFinite(frame)) {
        currentFrame = { frame };
        frames.set(frame, currentFrame);
      }
      continue;
    }

    if (!currentFrame) {
      continue;
    }

    const statMatch = line.match(/^lavfi\.signalstats\.([A-Z]+)=(-?\d+(?:\.\d+)?)/);
    if (!statMatch) {
      continue;
    }
    const key = SIGNAL_STATS_KEY_MAP[statMatch[1] ?? ""];
    if (!key) {
      continue;
    }
    const value = Number.parseFloat(statMatch[2] ?? "");
    if (Number.isFinite(value)) {
      currentFrame[key] = value;
    }
  }

  return [...frames.values()].filter(hasCompleteSignalStatsFrame).sort((left, right) => left.frame - right.frame);
}

export function isStage3BlankFlashSignal(frame: Stage3SignalStatsFrame): boolean {
  const lumaRange = Math.max(frame.yMax - frame.yMin, frame.yHigh - frame.yLow);
  const neutralChroma = Math.abs(frame.uAvg - 128) <= 6 && Math.abs(frame.vAvg - 128) <= 8;
  const brightBlank = frame.yAvg >= 224 && frame.yLow >= 220;
  const darkBlank = frame.yAvg <= 24 && frame.yHigh <= 32;
  return neutralChroma && lumaRange <= 6 && (brightBlank || darkBlank);
}

export function detectStage3BlankFlashFrames(params: {
  fullFrameStats: Stage3SignalStatsFrame[];
  mediaStats?: Stage3SignalStatsFrame[] | null;
  probeStats?: Stage3SignalStatsFrame[][] | null;
}): number[] {
  const frames = new Set<number>();
  for (const frame of params.fullFrameStats) {
    if (isStage3BlankFlashSignal(frame)) {
      frames.add(frame.frame);
    }
  }
  for (const stats of [params.mediaStats, ...(params.probeStats ?? [])]) {
    for (const frame of stats ?? []) {
      if (isStage3BlankFlashSignal(frame)) {
        frames.add(frame.frame);
      }
    }
  }
  return [...frames].sort((left, right) => left - right);
}

export function buildStage3FlashRepairRanges(
  frameIndexes: number[],
  frameCount: number
): Stage3FlashRepairRange[] {
  const validFrames = [...new Set(frameIndexes)]
    .filter((frame) => Number.isInteger(frame) && frame >= 0 && frame < frameCount)
    .sort((left, right) => left - right);
  if (!validFrames.length || frameCount <= 1) {
    return [];
  }

  const flashSet = new Set(validFrames);
  const ranges: Array<{ first: number; last: number }> = [];
  for (const frame of validFrames) {
    const last = ranges.at(-1);
    if (last && frame === last.last + 1) {
      last.last = frame;
    } else {
      ranges.push({ first: frame, last: frame });
    }
  }

  return ranges
    .map((range) => {
      for (let offset = 1; offset < frameCount; offset += 1) {
        const before = range.first - offset;
        if (before >= 0 && !flashSet.has(before)) {
          return { ...range, replace: before };
        }
        const after = range.last + offset;
        if (after < frameCount && !flashSet.has(after)) {
          return { ...range, replace: after };
        }
      }
      return null;
    })
    .filter((range): range is Stage3FlashRepairRange => Boolean(range));
}

export function buildStage3FlashRepairFilterComplex(
  ranges: Stage3FlashRepairRange[]
): { filterComplex: string; outputLabel: string } {
  if (!ranges.length) {
    throw new Error("Cannot build Stage 3 flash repair filter without ranges.");
  }

  const labels = ["base", ...ranges.map((_, index) => `ref${index}`)];
  const parts = [`[0:v]split=${labels.length}${labels.map((label) => `[${label}]`).join("")}`];
  let current = "base";
  ranges.forEach((range, index) => {
    const next = `flash${index}`;
    parts.push(
      `[${current}][ref${index}]freezeframes=first=${range.first}:last=${range.last}:replace=${range.replace}[${next}]`
    );
    current = next;
  });

  return {
    filterComplex: parts.join(";"),
    outputLabel: `[${current}]`
  };
}

export function buildStage3FlashRepairFfmpegArgs(params: {
  inputPath: string;
  outputPath: string;
  ranges: Stage3FlashRepairRange[];
}): string[] {
  const { filterComplex, outputLabel } = buildStage3FlashRepairFilterComplex(params.ranges);
  return [
    "-y",
    "-i",
    params.inputPath,
    "-filter_complex",
    filterComplex,
    "-map",
    outputLabel,
    "-map",
    "0:a?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "12",
    "-pix_fmt",
    "yuv420p",
    "-color_range",
    "tv",
    "-colorspace",
    "bt709",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    params.outputPath
  ];
}

function normalizeRect(rect: Stage3FlashGuardRect): Stage3FlashGuardRect {
  return {
    x: Math.max(0, Math.round(rect.x)),
    y: Math.max(0, Math.round(rect.y)),
    width: Math.max(2, Math.round(rect.width)),
    height: Math.max(2, Math.round(rect.height))
  };
}

function buildSignalStatsFilter(rect?: Stage3FlashGuardRect | null): string {
  const filters: string[] = [];
  if (rect) {
    const normalized = normalizeRect(rect);
    filters.push(`crop=${normalized.width}:${normalized.height}:${normalized.x}:${normalized.y}`);
  }
  filters.push("scale=96:-2:flags=bilinear", "signalstats", "metadata=mode=print:file=-");
  return filters.join(",");
}

async function collectSignalStats(
  inputPath: string,
  rect?: Stage3FlashGuardRect | null
): Promise<Stage3SignalStatsFrame[]> {
  const { stdout } = await execFileAsync(
    "ffmpeg",
    ["-v", "error", "-i", inputPath, "-vf", buildSignalStatsFilter(rect), "-an", "-f", "null", "-"],
    {
      timeout: 2 * 60_000,
      maxBuffer: 1024 * 1024 * 8
    }
  );
  return parseStage3SignalStats(stdout);
}

export async function repairStage3BlankFlashFrames(params: {
  inputPath: string;
  outputPath: string;
  mediaRect?: Stage3FlashGuardRect | null;
  probeRects?: Stage3FlashGuardRect[] | null;
}): Promise<Stage3FlashGuardResult> {
  const fullFrameStats = await collectSignalStats(params.inputPath);
  const mediaStats = params.mediaRect ? await collectSignalStats(params.inputPath, params.mediaRect) : null;
  const probeStats = await Promise.all(
    (params.probeRects ?? []).map((rect) => collectSignalStats(params.inputPath, rect))
  );
  const scannedFrameCount = Math.max(
    fullFrameStats.length,
    mediaStats?.length ?? 0,
    ...probeStats.map((stats) => stats.length)
  );
  if (scannedFrameCount <= 0) {
    throw new Error("Stage 3 flash guard could not scan video frames.");
  }
  const repairedFrames = detectStage3BlankFlashFrames({
    fullFrameStats,
    mediaStats,
    probeStats
  });
  const repairedRanges = buildStage3FlashRepairRanges(repairedFrames, scannedFrameCount);

  if (!repairedRanges.length) {
    return {
      outputPath: params.inputPath,
      mode: "clean",
      scannedFrameCount,
      repairedFrames: [],
      repairedRanges: []
    };
  }

  await execFileAsync(
    "ffmpeg",
    buildStage3FlashRepairFfmpegArgs({
      inputPath: params.inputPath,
      outputPath: params.outputPath,
      ranges: repairedRanges
    }),
    {
      timeout: 3 * 60_000,
      maxBuffer: 1024 * 1024 * 16
    }
  );

  return {
    outputPath: params.outputPath,
    mode: "repaired",
    scannedFrameCount,
    repairedFrames,
    repairedRanges
  };
}
