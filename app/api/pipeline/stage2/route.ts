import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ensureCodexLoggedIn, runCodexExec } from "../../../../lib/codex-runner";
import {
  normalizeComments,
  prepareCommentsForPrompt,
  sortCommentsByPopularity
} from "../../../../lib/comments";
import {
  buildStage2Prompt,
  parseStage2Output,
  STAGE2_OUTPUT_SCHEMA,
  validateStage2Output
} from "../../../../lib/stage2";
import { ensureCodexHomeForSession, normalizeCodexSessionId } from "../../../../lib/codex-session";
import { getYtDlpError, isSupportedUrl, sanitizeFileName } from "../../../../lib/ytdlp";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";

type VideoInfoJson = {
  title?: string;
  comments?: unknown;
};

function extractSessionId(request: Request): string {
  const sessionId = normalizeCodexSessionId(request.headers.get("x-codex-session-id"));
  if (!sessionId) {
    throw new Error("Missing or invalid x-codex-session-id.");
  }
  return sessionId;
}

async function downloadVideoAndMetadata(url: string, tmpDir: string): Promise<{
  videoPath: string;
  videoFileName: string;
  title: string;
  infoJson: VideoInfoJson;
  videoSizeBytes: number;
  commentsExtractionFallbackUsed: boolean;
}> {
  const outputTemplate = path.join(tmpDir, "video.%(ext)s");
  const baseArgs = [
    "--no-playlist",
    "--no-warnings",
    "--write-info-json",
    "--merge-output-format",
    "mp4",
    "-f",
    "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
    "-o",
    outputTemplate,
    url
  ];

  const runDownload = async (withComments: boolean): Promise<void> => {
    const args = withComments
      ? [...baseArgs.slice(0, 3), "--write-comments", ...baseArgs.slice(3)]
      : baseArgs;
    await execFileAsync("yt-dlp", args, {
      timeout: 5 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 16
    });
  };

  let commentsExtractionFallbackUsed = false;

  try {
    await runDownload(true);
  } catch {
    commentsExtractionFallbackUsed = true;
    await runDownload(false);
  }

  const files = await fs.readdir(tmpDir);
  const mp4File = files.find((file) => file.endsWith(".mp4"));
  const infoJsonFile = files.find((file) => file.endsWith(".info.json"));

  if (!mp4File) {
    throw new Error("Файл mp4 не был создан.");
  }
  if (!infoJsonFile) {
    throw new Error("Не удалось получить info.json после скачивания.");
  }

  const videoPath = path.join(tmpDir, mp4File);
  const infoJsonPath = path.join(tmpDir, infoJsonFile);
  const infoJson = JSON.parse(await fs.readFile(infoJsonPath, "utf-8")) as VideoInfoJson;
  const videoStat = await fs.stat(videoPath);

  return {
    videoPath,
    videoFileName: `${sanitizeFileName(path.parse(mp4File).name)}.mp4`,
    title: infoJson.title ?? "video",
    infoJson,
    videoSizeBytes: videoStat.size,
    commentsExtractionFallbackUsed
  };
}

async function probeVideoDurationSeconds(videoPath: string): Promise<number | null> {
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
      {
        timeout: 30_000,
        maxBuffer: 1024 * 1024
      }
    );
    const value = Number.parseFloat(stdout.trim());
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function buildFrameTimestamps(durationSeconds: number | null): number[] {
  const safeDuration = durationSeconds && durationSeconds > 0.5 ? durationSeconds : 12;
  const maxTs = Math.max(0.1, safeDuration - 0.1);
  const points = [0.15, 0.5, 0.85].map((ratio) =>
    Math.max(0.1, Math.min(maxTs, safeDuration * ratio))
  );

  return points.map((point, index) => Math.max(0.1, point + index * 0.01));
}

async function extractFrameImages(
  videoPath: string,
  tmpDir: string
): Promise<{ framePaths: string[]; frameDescriptions: string[] }> {
  const duration = await probeVideoDurationSeconds(videoPath);
  const timestamps = buildFrameTimestamps(duration);
  const framePaths: string[] = [];
  const frameDescriptions: string[] = [];

  for (let i = 0; i < timestamps.length; i += 1) {
    const second = timestamps[i];
    const framePath = path.join(tmpDir, `frame-${i + 1}.jpg`);
    await execFileAsync(
      "ffmpeg",
      ["-y", "-ss", second.toFixed(3), "-i", videoPath, "-frames:v", "1", "-q:v", "3", framePath],
      {
        timeout: 60_000,
        maxBuffer: 1024 * 1024 * 2
      }
    );
    framePaths.push(framePath);
    frameDescriptions.push(`frame_${i + 1}_at_${second.toFixed(2)}s`);
  }

  return { framePaths, frameDescriptions };
}

function getPipelineErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes("codex")) {
    return message;
  }
  if (lower.includes("ffmpeg") || lower.includes("ffprobe")) {
    return "На сервере не установлен ffmpeg/ffprobe. Установите ffmpeg и повторите.";
  }
  if (lower.includes("yt-dlp")) {
    return "Ошибка yt-dlp при скачивании видео или комментариев.";
  }

  return message || "Пайплайн Stage 2 завершился с ошибкой.";
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | { url?: string; userInstruction?: string }
    | null;
  const rawUrl = body?.url?.trim();
  const userInstructionRaw = body?.userInstruction?.trim() ?? "";
  const userInstruction = userInstructionRaw ? userInstructionRaw.slice(0, 2000) : null;

  if (!rawUrl) {
    return Response.json({ error: "Передайте URL в теле запроса." }, { status: 400 });
  }

  if (!isSupportedUrl(rawUrl)) {
    return Response.json(
      {
        error: "Поддерживаются ссылки на YouTube Shorts, Instagram Reels и Facebook Reels."
      },
      { status: 400 }
    );
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clip-stage2-"));

  try {
    const sessionId = extractSessionId(request);
    const codexHome = await ensureCodexHomeForSession(sessionId);
    await ensureCodexLoggedIn(codexHome);

    const downloaded = await downloadVideoAndMetadata(rawUrl, tmpDir);
    const allComments = sortCommentsByPopularity(normalizeComments(downloaded.infoJson.comments));
    const promptComments = prepareCommentsForPrompt(allComments, {
      maxComments: 250,
      maxChars: 35_000
    });
    const frames = await extractFrameImages(downloaded.videoPath, tmpDir);

    const examplesPath = path.join(process.cwd(), "data", "examples.json");
    const examplesJson = await fs.readFile(examplesPath, "utf-8");
    const prompt = buildStage2Prompt({
      sourceUrl: rawUrl,
      title: downloaded.title,
      comments: promptComments.included,
      omittedCommentsCount: promptComments.omittedCount,
      frameDescriptions: frames.frameDescriptions,
      examplesJson,
      userInstruction
    });

    const schemaPath = path.join(tmpDir, "stage2.output.schema.json");
    const outputPath = path.join(tmpDir, "stage2.output.json");
    await fs.writeFile(schemaPath, JSON.stringify(STAGE2_OUTPUT_SCHEMA, null, 2), "utf-8");

    const timeoutFromEnv = Number.parseInt(process.env.CODEX_STAGE2_TIMEOUT_MS ?? "", 10);
    const timeoutMs =
      Number.isFinite(timeoutFromEnv) && timeoutFromEnv > 0 ? timeoutFromEnv : 8 * 60_000;
    const model = process.env.CODEX_STAGE2_MODEL ?? null;
    const reasoningEffort = process.env.CODEX_STAGE2_REASONING_EFFORT ?? "high";

    await runCodexExec({
      prompt,
      imagePaths: frames.framePaths,
      outputSchemaPath: schemaPath,
      outputMessagePath: outputPath,
      cwd: process.cwd(),
      codexHome,
      timeoutMs,
      model,
      reasoningEffort
    });

    const rawOutput = await fs.readFile(outputPath, "utf-8");
    const parsedOutput = parseStage2Output(rawOutput);
    const warnings = validateStage2Output(parsedOutput);

    return Response.json(
      {
        source: {
          url: rawUrl,
          title: downloaded.title,
          videoFileName: downloaded.videoFileName,
          videoSizeBytes: downloaded.videoSizeBytes,
          totalComments: allComments.length,
          topComments: allComments.slice(0, 10),
          allComments,
          commentsUsedForPrompt: promptComments.included.length,
          commentsOmittedFromPrompt: promptComments.omittedCount,
          frameDescriptions: frames.frameDescriptions,
          commentsExtractionFallbackUsed: downloaded.commentsExtractionFallbackUsed
        },
        stage2Spec: {
          name: "Viral Shorts Overlay Generation",
          outputSections: [
            "inputAnalysis",
            "captionOptions(5)",
            "titleOptions(5)",
            "finalPick"
          ],
          topLengthRule: "140-210 chars",
          bottomLengthRule: "80-160 chars",
          enforcedVia: "Codex JSON schema + post-validation"
        },
        output: parsedOutput,
        warnings,
        model: model ?? "default",
        reasoningEffort,
        userInstructionUsed: userInstruction
      },
      { status: 200 }
    );
  } catch (error) {
    const stderr =
      typeof error === "object" && error && "stderr" in error
        ? String((error as { stderr?: string }).stderr ?? "")
        : "";

    const ytdlpMessage = stderr ? getYtDlpError(stderr) : null;
    const errorMessage = ytdlpMessage ?? getPipelineErrorMessage(error);

    return Response.json({ error: errorMessage }, { status: 500 });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
