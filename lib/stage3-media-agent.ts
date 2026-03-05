import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { Stage3RenderPlan } from "./stage3-agent";
import { sanitizeFileName } from "./ytdlp";

const execFileAsync = promisify(execFile);

const MOTION_SAMPLE_FPS = 8;
const DEFAULT_CLIP_DURATION_SEC = 6;
type Stage3MediaProfile = "preview" | "render";

type EncodeProfile = {
  preset: string;
  crf: string;
  threads: string;
  fitScalePrefix: string;
};

function getEncodeProfile(profile: Stage3MediaProfile): EncodeProfile {
  if (profile === "preview") {
    return {
      preset: "ultrafast",
      crf: "30",
      threads: "2",
      fitScalePrefix: "scale=540:-2:force_original_aspect_ratio=decrease,setsar=1,"
    };
  }
  return {
    preset: "veryfast",
    crf: "20",
    threads: "0",
    fitScalePrefix: ""
  };
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
  const outputTemplate = path.join(tmpDir, "source.%(ext)s");
  const args = [
    "--no-playlist",
    "--no-warnings",
    "--merge-output-format",
    "mp4",
    "-f",
    "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
    "-o",
    outputTemplate,
    rawUrl
  ];

  await execFileAsync("yt-dlp", args, {
    timeout: 5 * 60_000,
    maxBuffer: 1024 * 1024 * 16
  });

  const files = await fs.readdir(tmpDir);
  const mp4File = files.find((file) => file.endsWith(".mp4"));
  if (!mp4File) {
    throw new Error("Не удалось скачать mp4 из источника.");
  }

  const downloadedPath = path.join(tmpDir, mp4File);
  const canonicalPath = path.join(tmpDir, "source.mp4");
  if (downloadedPath !== canonicalPath) {
    await fs.copyFile(downloadedPath, canonicalPath);
  }

  return {
    filePath: canonicalPath,
    fileName: sanitizeFileName(path.parse(mp4File).name)
  };
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

function normalizeSegments(params: {
  renderPlan: Stage3RenderPlan;
  sourceDurationSec: number | null;
  clipStartSec: number;
  clipDurationSec: number;
}): Array<{ startSec: number; endSec: number }> {
  const sourceDuration = params.sourceDurationSec ?? null;
  const raw = params.renderPlan.segments ?? [];

  const fallbackWindow = (): Array<{ startSec: number; endSec: number }> => {
    const start = clampClipStart(params.clipStartSec, sourceDuration, params.clipDurationSec);
    const end = sourceDuration
      ? Math.min(sourceDuration, start + params.clipDurationSec)
      : start + params.clipDurationSec;
    return [{ startSec: start, endSec: Math.max(start + 0.05, end) }];
  };

  const normalized: Array<{ startSec: number; endSec: number }> = [];
  for (const segment of raw) {
    const start = clampNumber(segment.startSec, 0, sourceDuration ?? Number.POSITIVE_INFINITY);
    const endRaw = segment.endSec ?? sourceDuration ?? start + params.clipDurationSec;
    const end = clampNumber(endRaw, start + 0.05, sourceDuration ?? endRaw);
    if (end > start + 0.03) {
      normalized.push({ startSec: start, endSec: end });
    }
  }

  if (normalized.length > 0) {
    return normalized;
  }

  if (params.renderPlan.policy === "full_source_normalize") {
    if (sourceDuration && sourceDuration > 0.05) {
      return [{ startSec: 0, endSec: sourceDuration }];
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
    return [{ startSec: start, endSec: end }];
  }

  return fallbackWindow();
}

async function extractSegmentsToFiles(
  sourcePath: string,
  tmpDir: string,
  segments: Array<{ startSec: number; endSec: number }>,
  profile: Stage3MediaProfile
): Promise<string[]> {
  const encode = getEncodeProfile(profile);
  const outputs: string[] = [];

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const output = path.join(tmpDir, `seg-${i + 1}.mp4`);
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-ss",
        segment.startSec.toFixed(3),
        "-to",
        segment.endSec.toFixed(3),
        "-i",
        sourcePath,
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

  const ratio = target / Math.max(0.05, inputDuration);
  const effectiveRatio = ratio;
  const pts = effectiveRatio.toFixed(6);
  const tempo = (1 / effectiveRatio).toFixed(6);
  const scalePrefix = encode.fitScalePrefix;
  const videoFilters =
    params.smoothSlowMo && effectiveRatio > 1
      ? `${scalePrefix}setpts=${pts}*PTS,minterpolate=fps=60,fps=30`
      : `${scalePrefix}setpts=${pts}*PTS`;
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

async function mixMusicIfNeeded(params: {
  inputPath: string;
  tmpDir: string;
  durationSec: number;
  audioMode: "source_only" | "source_plus_music";
  musicFilePath?: string | null;
}): Promise<string> {
  if (params.audioMode !== "source_plus_music") {
    return params.inputPath;
  }

  const withAudio = await ensureAudioTrack(params.inputPath, params.tmpDir, params.durationSec);
  const generatedMusicPath = path.join(params.tmpDir, "music-bed.wav");
  const output = path.join(params.tmpDir, "clip-music.mp4");

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
      `[1:a]atrim=duration=${params.durationSec},asetpts=N/SR/TB[mus];[0:a]volume=1.0[a0];[mus]volume=0.65[a1];[a0][a1]amix=inputs=2:duration=first:normalize=0[a]`,
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
  const joined = await concatSegments(segmentFiles, params.tmpDir, profile);
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
