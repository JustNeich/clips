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
  buildStage2SeoPrompt,
  buildStage2Prompt,
  parseStage2SeoOutput,
  parseStage2Output,
  STAGE2_DESCRIPTION_SYSTEM_PROMPT,
  STAGE2_OUTPUT_SCHEMA,
  STAGE2_SEO_OUTPUT_SCHEMA,
  STAGE2_SYSTEM_PROMPT,
  validateStage2Output
} from "../../../../lib/stage2";
import {
  fetchOptionalYtDlpInfo,
  downloadSourceMedia
} from "../../../../lib/source-acquisition";
import { extractYtDlpErrorFromUnknown, isSupportedUrl, sanitizeFileName } from "../../../../lib/ytdlp";
import { getChannelById, getChatById, getDefaultChannel } from "../../../../lib/chat-history";
import {
  requireAuth,
  requireChannelOperate,
  requireSharedCodexAvailable
} from "../../../../lib/auth/guards";
import { requireRuntimeTool } from "../../../../lib/runtime-capabilities";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";

type VideoInfoJson = {
  title?: string;
  comments?: unknown;
};

async function downloadVideoAndMetadata(url: string, tmpDir: string): Promise<{
  videoPath: string;
  videoFileName: string;
  title: string;
  infoJson: VideoInfoJson;
  videoSizeBytes: number;
  commentsExtractionFallbackUsed: boolean;
}> {
  const downloaded = await downloadSourceMedia(url, tmpDir);
  const optionalInfo = await fetchOptionalYtDlpInfo(url, tmpDir);
  const title = optionalInfo.infoJson?.title?.trim() || downloaded.title?.trim() || "video";
  const infoJson: VideoInfoJson = {
    title,
    comments: optionalInfo.infoJson?.comments
  };

  return {
    videoPath: downloaded.filePath,
    videoFileName: `${sanitizeFileName(downloaded.fileName)}.mp4`,
    title,
    infoJson,
    videoSizeBytes: downloaded.videoSizeBytes,
    commentsExtractionFallbackUsed: optionalInfo.commentsExtractionFallbackUsed
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
  const ytDlpError = extractYtDlpErrorFromUnknown(error);

  if (lower.includes("codex")) {
    return message;
  }
  if (lower.includes("ffmpeg") || lower.includes("ffprobe")) {
    return "На сервере не установлен ffmpeg/ffprobe. Установите ffmpeg и повторите.";
  }
  if (ytDlpError) {
    return ytDlpError;
  }

  return message || "Пайплайн Stage 2 завершился с ошибкой.";
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | { url?: string; chatId?: string; userInstruction?: string }
    | null;
  const chatId = body?.chatId?.trim();
  const chat = chatId ? await getChatById(chatId) : null;
  const rawUrl = body?.url?.trim() || chat?.url?.trim();
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
    await Promise.all([
      requireRuntimeTool("ffmpeg"),
      requireRuntimeTool("ffprobe"),
      requireRuntimeTool("codex")
    ]);
    const auth = await requireAuth();
    const integration = requireSharedCodexAvailable(auth.workspace.id);
    const codexHome = integration.codexHomePath as string;
    await ensureCodexLoggedIn(codexHome);

    const downloaded = await downloadVideoAndMetadata(rawUrl, tmpDir);
    const allComments = sortCommentsByPopularity(normalizeComments(downloaded.infoJson.comments));
    const promptComments = prepareCommentsForPrompt(allComments, {
      maxComments: 250,
      maxChars: 35_000
    });
    const frames = await extractFrameImages(downloaded.videoPath, tmpDir);

    const channel =
      chat?.channelId
        ? (await requireChannelOperate(auth, chat.channelId)).channel
        : await getDefaultChannel(auth.workspace.id);
    if (!chat?.channelId && auth.membership.role === "redactor_limited") {
      await requireChannelOperate(auth, channel.id);
    }
    const examplesPath = path.join(process.cwd(), "data", "examples.json");
    const fallbackExamplesJson = await fs.readFile(examplesPath, "utf-8").catch(() => "[]");
    const examplesJson = channel.examplesJson?.trim() || fallbackExamplesJson;
    const systemPrompt = channel.systemPrompt?.trim() || STAGE2_SYSTEM_PROMPT;
    const descriptionPrompt =
      channel.descriptionPrompt?.trim() || STAGE2_DESCRIPTION_SYSTEM_PROMPT;
    const prompt = buildStage2Prompt({
      sourceUrl: rawUrl,
      title: downloaded.title,
      comments: promptComments.included,
      omittedCommentsCount: promptComments.omittedCount,
      frameDescriptions: frames.frameDescriptions,
      examplesJson,
      systemPrompt,
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

    let seo: { description: string; tags: string } | null = null;
    try {
      const seoPrompt = buildStage2SeoPrompt({
        sourceUrl: rawUrl,
        title: downloaded.title,
        comments: promptComments.included,
        omittedCommentsCount: promptComments.omittedCount,
        stage2Output: parsedOutput,
        descriptionPrompt,
        userInstruction
      });

      const seoSchemaPath = path.join(tmpDir, "stage2.description.schema.json");
      const seoOutputPath = path.join(tmpDir, "stage2.description.output.json");
      await fs.writeFile(seoSchemaPath, JSON.stringify(STAGE2_SEO_OUTPUT_SCHEMA, null, 2), "utf-8");

      const seoTimeoutFromEnv = Number.parseInt(
        process.env.CODEX_STAGE2_DESCRIPTION_TIMEOUT_MS ?? "",
        10
      );
      const seoTimeoutMs =
        Number.isFinite(seoTimeoutFromEnv) && seoTimeoutFromEnv > 0
          ? seoTimeoutFromEnv
          : 4 * 60_000;
      const seoModel = process.env.CODEX_STAGE2_DESCRIPTION_MODEL ?? model;
      const seoReasoningEffort = process.env.CODEX_STAGE2_DESCRIPTION_REASONING_EFFORT ?? "medium";

      await runCodexExec({
        prompt: seoPrompt,
        imagePaths: [],
        outputSchemaPath: seoSchemaPath,
        outputMessagePath: seoOutputPath,
        cwd: process.cwd(),
        codexHome,
        timeoutMs: seoTimeoutMs,
        model: seoModel,
        reasoningEffort: seoReasoningEffort
      });

      const rawSeoOutput = await fs.readFile(seoOutputPath, "utf-8");
      seo = parseStage2SeoOutput(rawSeoOutput);
    } catch (seoError) {
      warnings.push({
        field: "seo",
        message:
          seoError instanceof Error
            ? `SEO description generation failed: ${seoError.message}`
            : "SEO description generation failed."
      });
    }

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
            "finalPick",
            "seo(description,tags)"
          ],
          topLengthRule: "140-210 chars",
          bottomLengthRule: "80-160 chars",
          enforcedVia: "Codex JSON schema + post-validation"
        },
        output: parsedOutput,
        seo,
        warnings,
        model: model ?? "default",
        reasoningEffort,
        userInstructionUsed: userInstruction,
        channel: {
          id: channel.id,
          name: channel.name,
          username: channel.username
        }
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    const ytdlpMessage = extractYtDlpErrorFromUnknown(error);
    const errorMessage = ytdlpMessage ?? getPipelineErrorMessage(error);

    return Response.json({ error: errorMessage }, { status: 500 });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
