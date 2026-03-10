import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { Stage3StateSnapshot } from "../app/components/types";
import {
  analyzeBestClipAndFocus,
  analyzeStage3FramedPreview,
  clampClipStart,
  sanitizeFocusY,
  type Stage3FramingMetrics
} from "./stage3-media-agent";
import { ensureStage3SourceCached } from "./stage3-server-control";

const DEFAULT_CLIP_DURATION_SEC = 6;
const PREVIEW_FPS = 3;
const execFileAsync = promisify(execFile);

export type Stage3AgentRealityMetrics = Stage3FramingMetrics & {
  stability: number;
  motionMean: number;
  previewPath: string;
  keyframePaths: string[];
};

export type Stage3AgentMediaStepPayload =
  | {
      operation: "analyze-best-clip-focus";
      sourceUrl: string;
      sourceDurationSec?: number | null;
      clipDurationSec?: number;
    }
  | {
      operation: "reality-preview";
      sourceUrl: string;
      sourceDurationSec?: number | null;
      snapshot: Stage3StateSnapshot;
    };

export type Stage3AgentMediaStepResult =
  | {
      operation: "analyze-best-clip-focus";
      sourceDurationSec: number | null;
      clipStartSec: number;
      focusY: number;
    }
  | {
      operation: "reality-preview";
      sourceDurationSec: number | null;
      metrics: Stage3AgentRealityMetrics;
    };

async function extractMotionMetrics(previewPath: string, tmpDir: string): Promise<{ stability: number; motionMean: number }> {
  const statsPath = path.join(tmpDir, `stage3-motion-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  await execFileAsync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      previewPath,
      "-vf",
      `fps=${PREVIEW_FPS},signalstats,metadata=mode=print:file=${statsPath}`,
      "-f",
      "null",
      "-"
    ],
    { timeout: 90_000, maxBuffer: 1024 * 1024 * 8 }
  );

  const raw = await fs.readFile(statsPath, "utf-8").catch(() => "");
  if (!raw) {
    return { stability: 0.6, motionMean: 0.4 };
  }

  const values =
    raw
      .match(/YDIF=([0-9.]+)/g)
      ?.map((entry) => Number.parseFloat(entry.split("=").at(-1) ?? "0"))
      .filter((entry) => Number.isFinite(entry) && entry >= 0) ?? [];

  if (!values.length) {
    return { stability: 0.6, motionMean: 0.4 };
  }

  const mean = values.reduce((acc, value) => acc + value, 0) / values.length;
  const variance =
    values.reduce((acc, value) => {
      const delta = value - mean;
      return acc + delta * delta;
    }, 0) / values.length;

  const stability = Math.max(0, Math.min(1, 1 - Math.min(1, Math.sqrt(variance) / (mean + 0.001))));
  return {
    stability,
    motionMean: Math.max(0, Math.min(1, mean / 60))
  };
}

export async function executeStage3AgentMediaStep(
  payload: Stage3AgentMediaStepPayload
): Promise<Stage3AgentMediaStepResult> {
  const cached = await ensureStage3SourceCached(payload.sourceUrl);
  const sourceDurationSec = cached.sourceDurationSec ?? payload.sourceDurationSec ?? null;

  if (payload.operation === "analyze-best-clip-focus") {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage3-agent-step-"));
    try {
      const clipDurationSec =
        typeof payload.clipDurationSec === "number" && Number.isFinite(payload.clipDurationSec) && payload.clipDurationSec > 0
          ? payload.clipDurationSec
          : DEFAULT_CLIP_DURATION_SEC;
      const analyzed = await analyzeBestClipAndFocus(
        cached.sourcePath,
        tmpDir,
        sourceDurationSec,
        clipDurationSec
      );
      return {
        operation: "analyze-best-clip-focus",
        sourceDurationSec,
        clipStartSec: clampClipStart(analyzed.clipStartSec, sourceDurationSec, clipDurationSec),
        focusY: sanitizeFocusY(analyzed.focusY)
      };
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage3-agent-preview-"));
  try {
    const analysis = await analyzeStage3FramedPreview({
      sourcePath: cached.sourcePath,
      tmpDir,
      sourceDurationSec,
      snapshot: payload.snapshot,
      profile: "preview"
    });
    const motion = await extractMotionMetrics(analysis.previewPath, tmpDir);
    return {
      operation: "reality-preview",
      sourceDurationSec,
      metrics: {
        ...analysis.metrics,
        stability: motion.stability,
        motionMean: motion.motionMean,
        previewPath: "",
        keyframePaths: []
      }
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
