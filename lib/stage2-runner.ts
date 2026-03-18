import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Stage2Response } from "../app/components/types";
import { ensureCodexLoggedIn, runCodexExec } from "./codex-runner";
import {
  normalizeComments,
  prepareCommentsForPrompt,
  sortCommentsByPopularity
} from "./comments";
import {
  buildStage2SeoPrompt,
  parseStage2SeoOutput,
  STAGE2_SEO_OUTPUT_SCHEMA,
  validateStage2Output
} from "./stage2";
import {
  getStage2Run,
  markStage2RunStageCompleted,
  markStage2RunStageFailed,
  markStage2RunStageRunning,
  Stage2RunRecord
} from "./stage2-progress-store";
import { getWorkspaceStage2ExamplesCorpusJson } from "./team-store";
import {
  fetchOptionalYtDlpInfo,
  downloadSourceMedia
} from "./source-acquisition";
import {
  extractYtDlpErrorFromUnknown,
  sanitizeFileName
} from "./ytdlp";
import { requireSharedCodexAvailable } from "./auth/guards";
import { requireRuntimeTool } from "./runtime-capabilities";
import { CodexJsonStageExecutor } from "./viral-shorts-worker/executor";
import { resolveStage2PromptTemplate } from "./viral-shorts-worker/prompts";
import {
  buildVideoContext,
  ViralShortsWorkerService
} from "./viral-shorts-worker/service";

const execFileAsync = promisify(execFile);

type VideoInfoJson = {
  title?: string;
  description?: string;
  comments?: unknown;
};

async function downloadVideoAndMetadata(url: string, tmpDir: string): Promise<{
  videoPath: string;
  videoFileName: string;
  title: string;
  infoJson: VideoInfoJson;
  videoSizeBytes: number;
  downloadProvider: "visolix" | "ytDlp";
  commentsExtractionFallbackUsed: boolean;
}> {
  const downloaded = await downloadSourceMedia(url, tmpDir);
  const optionalInfo = await fetchOptionalYtDlpInfo(url, tmpDir);
  const title = optionalInfo.infoJson?.title?.trim() || downloaded.title?.trim() || "video";
  const infoJson: VideoInfoJson = {
    title,
    description: optionalInfo.infoJson?.description?.trim() || "",
    comments: optionalInfo.infoJson?.comments
  };

  return {
    videoPath: downloaded.filePath,
    videoFileName: `${sanitizeFileName(downloaded.fileName)}.mp4`,
    title,
    infoJson,
    videoSizeBytes: downloaded.videoSizeBytes,
    downloadProvider: downloaded.provider,
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

export async function processStage2Run(run: Stage2RunRecord): Promise<Stage2Response> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clip-stage2-"));

  try {
    await Promise.all([
      requireRuntimeTool("ffmpeg"),
      requireRuntimeTool("ffprobe"),
      requireRuntimeTool("codex")
    ]);

    const integration = requireSharedCodexAvailable(run.workspaceId);
    const codexHome = integration.codexHomePath as string;
    await ensureCodexLoggedIn(codexHome);

    const channel = run.request.channel;
    markStage2RunStageRunning(run.runId, "analyzer", {
      detail: "Подготавливаем source media, кадры и комментарии."
    });

    const downloaded = await downloadVideoAndMetadata(run.sourceUrl, tmpDir);
    const allComments = sortCommentsByPopularity(normalizeComments(downloaded.infoJson.comments));
    const promptComments = prepareCommentsForPrompt(allComments, {
      maxComments: 250,
      maxChars: 35_000
    });
    const frames = await extractFrameImages(downloaded.videoPath, tmpDir);

    const timeoutFromEnv = Number.parseInt(process.env.CODEX_STAGE2_TIMEOUT_MS ?? "", 10);
    const timeoutMs =
      Number.isFinite(timeoutFromEnv) && timeoutFromEnv > 0 ? timeoutFromEnv : 8 * 60_000;
    const model = process.env.CODEX_STAGE2_MODEL ?? null;
    const isDevelopment = process.env.NODE_ENV === "development";
    const reasoningEffort =
      process.env.CODEX_STAGE2_REASONING_EFFORT ?? (isDevelopment ? "low" : "high");

    const workerService = new ViralShortsWorkerService();
    const workspaceStage2ExamplesCorpusJson = getWorkspaceStage2ExamplesCorpusJson(run.workspaceId);
    const executor = new CodexJsonStageExecutor({
      cwd: process.cwd(),
      codexHome,
      defaultTimeoutMs: timeoutMs,
      defaultModel: model,
      defaultReasoningEffort: reasoningEffort
    });
    const videoContext = buildVideoContext({
      sourceUrl: run.sourceUrl,
      title: downloaded.title,
      description: downloaded.infoJson.description,
      comments: promptComments.included,
      frameDescriptions: frames.frameDescriptions,
      userInstruction: run.userInstruction
    });
    const pipelineResult = await workerService.runPipeline({
      channel: {
        id: channel.id,
        name: channel.name,
        username: channel.username,
        stage2ExamplesConfig: channel.stage2ExamplesConfig,
        stage2HardConstraints: channel.stage2HardConstraints
      },
      workspaceStage2ExamplesCorpusJson,
      videoContext,
      imagePaths: frames.framePaths,
      executor,
      promptConfig: channel.stage2PromptConfig,
      onProgress: async (event) => {
        if (event.state === "running") {
          markStage2RunStageRunning(run.runId, event.stageId, {
            detail: event.detail ?? null,
            promptChars: event.promptChars ?? null,
            reasoningEffort: event.reasoningEffort ?? null
          });
          return;
        }
        if (event.state === "completed") {
          markStage2RunStageCompleted(run.runId, event.stageId, {
            detail: event.detail ?? null,
            durationMs: event.durationMs ?? null,
            promptChars: event.promptChars ?? null,
            reasoningEffort: event.reasoningEffort ?? null
          });
          return;
        }
        markStage2RunStageFailed(run.runId, event.stageId, event.detail ?? "Stage failed.", {
          durationMs: event.durationMs ?? null,
          promptChars: event.promptChars ?? null,
          reasoningEffort: event.reasoningEffort ?? null
        });
      }
    });
    const parsedOutput = pipelineResult.output;
    const warnings = [...pipelineResult.warnings, ...validateStage2Output(parsedOutput)];

    let seo: { description: string; tags: string } | null = null;
    const seoTemplate = resolveStage2PromptTemplate("seo", channel.stage2PromptConfig);
    let seoPromptText: string | null = null;
    try {
      const seoPrompt = buildStage2SeoPrompt({
        sourceUrl: run.sourceUrl,
        title: downloaded.title,
        comments: promptComments.included,
        omittedCommentsCount: promptComments.omittedCount,
        stage2Output: parsedOutput,
        descriptionPrompt: seoTemplate.configuredPrompt,
        userInstruction: run.userInstruction
      });
      seoPromptText = seoPrompt;
      const seoModel = process.env.CODEX_STAGE2_DESCRIPTION_MODEL ?? model;
      const seoReasoningEffort = seoTemplate.reasoningEffort;
      markStage2RunStageRunning(run.runId, "seo", {
        detail: "Генерируем описание и tags.",
        promptChars: seoPrompt.length,
        reasoningEffort: seoReasoningEffort
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

      const seoStartedAt = Date.now();
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
      markStage2RunStageCompleted(run.runId, "seo", {
        detail: "SEO metadata готова.",
        durationMs: Date.now() - seoStartedAt,
        promptChars: seoPrompt.length,
        reasoningEffort: seoReasoningEffort
      });
    } catch (seoError) {
      const message =
        seoError instanceof Error
          ? `SEO description generation failed: ${seoError.message}`
          : "SEO description generation failed.";
      warnings.push({
        field: "seo",
        message
      });
      markStage2RunStageCompleted(run.runId, "seo", {
        detail: `Fallback/no SEO: ${message}`
      });
    }

    return {
      source: {
        url: run.sourceUrl,
        title: downloaded.title,
        videoFileName: downloaded.videoFileName,
        videoSizeBytes: downloaded.videoSizeBytes,
        downloadProvider: downloaded.downloadProvider,
        totalComments: allComments.length,
        topComments: allComments.slice(0, 10),
        allComments,
        commentsUsedForPrompt: promptComments.included.length,
        commentsOmittedFromPrompt: promptComments.omittedCount,
        frameDescriptions: frames.frameDescriptions,
        commentsExtractionFallbackUsed: downloaded.commentsExtractionFallbackUsed
      },
      stage2Spec: {
        name: "Viral Shorts Worker Overlay Generation",
        outputSections: [
          "inputAnalysis",
          "captionOptions(5)",
          "titleOptions(5)",
          "finalPick",
          "seo(description,tags)",
          "diagnostics(channel,prompts,examples)",
          "progress(stage snapshots)"
        ],
        topLengthRule: "175-180 chars",
        bottomLengthRule: "140-150 chars",
        enforcedVia: "Multi-stage worker pipeline + Codex JSON stages + post-validation"
      },
      output: parsedOutput,
      seo,
      warnings,
      diagnostics: pipelineResult.diagnostics
        ? {
            ...pipelineResult.diagnostics,
            effectivePrompting: {
              ...pipelineResult.diagnostics.effectivePrompting,
              promptStages: [
                ...pipelineResult.diagnostics.effectivePrompting.promptStages,
                {
                  stageId: "seo",
                  label: "SEO",
                  stageType: "llm_prompt",
                  defaultPrompt: seoTemplate.defaultPrompt,
                  configuredPrompt: seoTemplate.configuredPrompt,
                  reasoningEffort: seoTemplate.reasoningEffort,
                  isCustomPrompt: seoTemplate.isCustomPrompt,
                  promptText: seoPromptText,
                  promptChars: seoPromptText?.length ?? null,
                  usesImages: false,
                  summary: "LLM stage: generates SEO description and tags from the final Stage 2 pick."
                }
              ]
            }
          }
        : pipelineResult.diagnostics,
      progress: getStage2Run(run.runId)?.snapshot ?? null,
      model: model ?? "default",
      reasoningEffort,
      userInstructionUsed: run.userInstruction,
      stage2Worker: {
        runId: run.runId
      },
      stage2Run: {
        runId: run.runId,
        mode: run.mode,
        createdAt: run.createdAt,
        startedAt: run.startedAt
      },
      channel: {
        id: channel.id,
        name: channel.name,
        username: channel.username
      }
    } as Stage2Response;
  } catch (error) {
    const ytdlpMessage = extractYtDlpErrorFromUnknown(error);
    const errorMessage = ytdlpMessage ?? getPipelineErrorMessage(error);
    const activeStageId = getStage2Run(run.runId)?.snapshot.activeStageId ?? "analyzer";
    markStage2RunStageFailed(run.runId, activeStageId, errorMessage);
    throw new Error(errorMessage);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
