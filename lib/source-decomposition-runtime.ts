import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { CommentsPayload } from "../app/components/types";
import { resolveExecutableFromCandidates } from "./command-path";
import { runWithHostedSubprocessGate } from "./hosted-subprocess";
import { isHostedRenderRuntime } from "./hosted-resource-budget";
import { getWorkspaceAnthropicApiKey } from "./team-store";
import { runAnthropicStructuredOutput } from "./anthropic-client";
import {
  getAgentDecompositionFramesDir,
  pruneExpiredSourceDecompositions,
  saveSourceDecomposition,
  type DecompositionComment,
  type DecompositionFrame,
  type DecompositionSubtitleSegment,
  type SourceDecompositionArtifact,
  type SourceDecompositionRecord
} from "./source-decomposition-store";

/**
 * Agent-flow Stage-1 decomposition runtime.
 *
 * AGENT-ONLY. Invoked exclusively from `processSourceJob` when the source job
 * request carries `agentDecomposition: true`. It NEVER runs for the human
 * manual flow and NEVER mutates the human source-media cache: it only reads the
 * already-downloaded mp4 by path and writes into the isolated
 * `agent-decomposition/` tree.
 */

const execFileAsync = promisify(execFile);

const FRAME_WIDTH = 512;
const FRAME_CAP = 300;
const WHISPER_CANDIDATES = ["/Users/neichyabazhi/.local/bin/whisper", "/opt/homebrew/bin/whisper", "whisper"];

const VISION_FRAME_DESCRIPTION_CAP = 40;
const VISION_MODEL = process.env.AGENT_DECOMP_VISION_MODEL?.trim() || "claude-3-5-sonnet-latest";

type ProbeResult = {
  durationSec: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
};

function agentDecompositionEnabled(): boolean {
  // Explicit opt-out kill switch; default ON for the agent entry.
  return process.env.AGENT_DECOMP_DISABLED !== "1";
}

function framesAllowedOnThisRuntime(): { allowed: boolean; reason: string | null } {
  if (!isHostedRenderRuntime()) {
    return { allowed: true, reason: null };
  }
  // Hosted Render persistent disk is small and shared with the human
  // source-media cache. Heavy frame payloads (15-60MB/clip) would pressure it,
  // so frame extraction is local-worker-only by default. Opt in explicitly.
  if (process.env.AGENT_DECOMP_ALLOW_HOSTED_FRAMES === "1") {
    return { allowed: true, reason: null };
  }
  return {
    allowed: false,
    reason: "frames are local-worker-only on hosted runtime (set AGENT_DECOMP_ALLOW_HOSTED_FRAMES=1 to override)"
  };
}

function whisperEnabled(): boolean {
  // Whisper is opt-in: transcription is CPU-heavy and not always provisioned.
  return process.env.AGENT_DECOMP_WHISPER === "1";
}

async function probeSourceMedia(videoPath: string): Promise<ProbeResult> {
  try {
    const { stdout } = await runWithHostedSubprocessGate(() =>
      execFileAsync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration:stream=codec_type,width,height",
          "-of",
          "json",
          videoPath
        ],
        { timeout: 30_000, maxBuffer: 1024 * 1024 * 2 }
      )
    );
    const payload = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
    };
    const streams = Array.isArray(payload.streams) ? payload.streams : [];
    const videoStream = streams.find((stream) => stream.codec_type === "video");
    const duration = Number.parseFloat(payload.format?.duration ?? "");
    return {
      durationSec: Number.isFinite(duration) && duration > 0 ? duration : null,
      width: typeof videoStream?.width === "number" ? videoStream.width : null,
      height: typeof videoStream?.height === "number" ? videoStream.height : null,
      hasAudio: streams.some((stream) => stream.codec_type === "audio")
    };
  } catch {
    return { durationSec: null, width: null, height: null, hasAudio: false };
  }
}

/**
 * Sample one frame per second, downscaled to width 512, capped at FRAME_CAP.
 * Returns the extracted frame file names sorted by index.
 */
async function extractOneFpsFrames(input: {
  videoPath: string;
  framesDir: string;
  durationSec: number | null;
}): Promise<string[]> {
  await fs.mkdir(input.framesDir, { recursive: true });
  // -vf fps=1 samples ~1 frame/sec; -frames:v caps the count defensively so a
  // mis-probed long clip cannot explode disk usage.
  await runWithHostedSubprocessGate(() =>
    execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-i",
        input.videoPath,
        "-vf",
        `fps=1,scale=${FRAME_WIDTH}:-2`,
        "-frames:v",
        String(FRAME_CAP),
        "-q:v",
        "4",
        path.join(input.framesDir, "frame-%04d.jpg")
      ],
      { timeout: 5 * 60_000, maxBuffer: 1024 * 1024 * 4 }
    )
  );
  const entries = await fs.readdir(input.framesDir).catch(() => []);
  return entries
    .filter((name) => /^frame-\d+\.jpg$/.test(name))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, FRAME_CAP);
}

function deterministicFrameDescription(timestampSec: number, durationSec: number | null): string {
  if (durationSec && durationSec > 0) {
    const ratio = Math.min(1, Math.max(0, timestampSec / durationSec));
    const beat =
      ratio <= 0.12
        ? "opening setup"
        : ratio <= 0.4
          ? "building action"
          : ratio <= 0.6
            ? "mid-clip progression"
            : ratio <= 0.85
              ? "payoff beat"
              : "late aftermath";
    return `frame at ${timestampSec.toFixed(0)}s of ${durationSec.toFixed(0)}s (${beat})`;
  }
  return `frame at ${timestampSec.toFixed(0)}s`;
}

const FRAME_DESCRIPTION_SCHEMA = {
  type: "object",
  properties: {
    descriptions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "number" },
          description: { type: "string" }
        },
        required: ["index", "description"]
      }
    }
  },
  required: ["descriptions"]
} as const;

/**
 * Best-effort vision descriptions for a bounded subset of frames using the
 * workspace Anthropic key. On any failure (no key, model error) it returns null
 * and the caller falls back to deterministic beat labels. Never throws.
 */
async function describeFramesWithVision(input: {
  workspaceId: string;
  framePaths: Array<{ index: number; absPath: string }>;
}): Promise<Map<number, string> | null> {
  const apiKey = getWorkspaceAnthropicApiKey(input.workspaceId);
  if (!apiKey) {
    return null;
  }
  const subset = input.framePaths.slice(0, VISION_FRAME_DESCRIPTION_CAP);
  if (subset.length === 0) {
    return null;
  }
  try {
    const result = await runAnthropicStructuredOutput<{
      descriptions: Array<{ index: number; description: string }>;
    }>({
      apiKey,
      model: VISION_MODEL,
      prompt:
        "You are decomposing a short source video into per-frame visual notes for a downstream caption agent. " +
        "The attached images are sampled frames in order. For EACH image, return a single concise sentence " +
        "describing what is visible (subjects, action, on-screen text, setting). Use the 0-based image position " +
        "as `index`. Return descriptions for every image.",
      schema: FRAME_DESCRIPTION_SCHEMA,
      imagePaths: subset.map((entry) => entry.absPath),
      timeoutMs: 2 * 60_000
    });
    const byPosition = new Map<number, string>();
    for (const entry of result.descriptions ?? []) {
      if (typeof entry.index === "number" && typeof entry.description === "string") {
        byPosition.set(Math.trunc(entry.index), entry.description.trim());
      }
    }
    const out = new Map<number, string>();
    subset.forEach((frame, position) => {
      const description = byPosition.get(position);
      if (description) {
        out.set(frame.index, description);
      }
    });
    return out.size > 0 ? out : null;
  } catch {
    return null;
  }
}

function parseWhisperVtt(content: string): DecompositionSubtitleSegment[] {
  const segments: DecompositionSubtitleSegment[] = [];
  const lines = content.split(/\r?\n/);
  const timeRe = /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/;
  for (let i = 0; i < lines.length; i += 1) {
    const match = timeRe.exec(lines[i] ?? "");
    if (!match) {
      continue;
    }
    const startSec =
      Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
    const endSec =
      Number(match[5]) * 3600 + Number(match[6]) * 60 + Number(match[7]) + Number(match[8]) / 1000;
    const textLines: string[] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j] ?? "";
      if (!line.trim() || timeRe.test(line)) {
        break;
      }
      textLines.push(line.trim());
    }
    const text = textLines.join(" ").trim();
    if (text) {
      segments.push({ startSec, endSec, text });
    }
  }
  return segments;
}

/**
 * Best-effort Whisper transcription. Opt-in (AGENT_DECOMP_WHISPER=1) and skipped
 * when the clip has no audio or the binary is missing. Never throws.
 */
async function transcribeWithWhisper(input: {
  videoPath: string;
  hasAudio: boolean;
}): Promise<{ available: boolean; language: string | null; skippedReason: string | null; segments: DecompositionSubtitleSegment[] }> {
  if (!whisperEnabled()) {
    return { available: false, language: null, skippedReason: "whisper disabled (set AGENT_DECOMP_WHISPER=1)", segments: [] };
  }
  if (!input.hasAudio) {
    return { available: false, language: null, skippedReason: "no audio track", segments: [] };
  }
  const whisperBin = await resolveExecutableFromCandidates(WHISPER_CANDIDATES).catch(() => null);
  if (!whisperBin) {
    return { available: false, language: null, skippedReason: "whisper binary not found", segments: [] };
  }
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-decomp-whisper-"));
  try {
    await runWithHostedSubprocessGate(() =>
      execFileAsync(
        whisperBin,
        [input.videoPath, "--model", "base", "--output_format", "vtt", "--output_dir", outDir, "--task", "transcribe"],
        { timeout: 10 * 60_000, maxBuffer: 1024 * 1024 * 16 }
      )
    );
    const files = await fs.readdir(outDir).catch(() => []);
    const vtt = files.find((name) => name.endsWith(".vtt"));
    if (!vtt) {
      return { available: false, language: null, skippedReason: "whisper produced no transcript", segments: [] };
    }
    const content = await fs.readFile(path.join(outDir, vtt), "utf-8").catch(() => "");
    const segments = parseWhisperVtt(content);
    if (segments.length === 0) {
      return { available: false, language: null, skippedReason: "no speech detected", segments: [] };
    }
    return { available: true, language: null, skippedReason: null, segments };
  } catch (error) {
    return {
      available: false,
      language: null,
      skippedReason: error instanceof Error ? `whisper failed: ${error.message}` : "whisper failed",
      segments: []
    };
  } finally {
    await fs.rm(outDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function bundleComments(commentsPayload: CommentsPayload | null): DecompositionComment[] {
  if (!commentsPayload) {
    return [];
  }
  const source = commentsPayload.allComments?.length ? commentsPayload.allComments : commentsPayload.topComments ?? [];
  return source.map((comment) => ({
    author: comment.author,
    text: comment.text,
    likes: comment.likes,
    postedAt: comment.postedAt ?? null
  }));
}

/**
 * Produce and persist the agent-flow decomposition artifact for a downloaded
 * source. `sourcePath` MUST be the already-cached human mp4 path; this reads it
 * read-only. Returns null when decomposition is disabled.
 */
export async function runSourceDecomposition(input: {
  workspaceId: string;
  channelId: string;
  chatId: string;
  sourceKey: string;
  sourceUrl: string;
  sourcePath: string;
  commentsPayload: CommentsPayload | null;
}): Promise<SourceDecompositionRecord | null> {
  if (!agentDecompositionEnabled()) {
    return null;
  }

  // Best-effort housekeeping of expired artifacts; never blocks the build.
  void pruneExpiredSourceDecompositions().catch(() => undefined);

  const probe = await probeSourceMedia(input.sourcePath);
  const framesGate = framesAllowedOnThisRuntime();
  const framesDir = getAgentDecompositionFramesDir(input.sourceKey);

  let frames: DecompositionFrame[] = [];
  let framesSkippedReason: string | null = framesGate.reason;

  if (framesGate.allowed) {
    try {
      const frameFiles = await extractOneFpsFrames({
        videoPath: input.sourcePath,
        framesDir,
        durationSec: probe.durationSec
      });
      const framePaths = frameFiles.map((fileName, position) => ({
        index: position,
        absPath: path.join(framesDir, fileName),
        fileName,
        // fps=1 sampling => frame N is ~N seconds in.
        timestampSec: position
      }));
      const visionDescriptions = await describeFramesWithVision({
        workspaceId: input.workspaceId,
        framePaths: framePaths.map((frame) => ({ index: frame.index, absPath: frame.absPath }))
      });
      frames = framePaths.map((frame) => ({
        index: frame.index,
        timestampSec: frame.timestampSec,
        fileName: frame.fileName,
        description:
          visionDescriptions?.get(frame.index) ??
          deterministicFrameDescription(frame.timestampSec, probe.durationSec)
      }));
      if (frames.length === 0) {
        framesSkippedReason = "no frames extracted";
      }
    } catch (error) {
      framesSkippedReason = error instanceof Error ? `frame extraction failed: ${error.message}` : "frame extraction failed";
      frames = [];
    }
  }

  const subtitles = await transcribeWithWhisper({
    videoPath: input.sourcePath,
    hasAudio: probe.hasAudio
  });

  const artifact: SourceDecompositionArtifact = {
    sourceKey: input.sourceKey,
    comments: bundleComments(input.commentsPayload),
    frames,
    subtitles,
    meta: {
      durationSec: probe.durationSec,
      width: probe.width,
      height: probe.height,
      frameCount: frames.length,
      extractedAt: new Date().toISOString(),
      framesSkippedReason
    }
  };

  return saveSourceDecomposition({
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    chatId: input.chatId,
    sourceKey: input.sourceKey,
    sourceUrl: input.sourceUrl,
    artifact,
    framesDir
  });
}
