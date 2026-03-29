import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Stage2Response } from "../app/components/types";
import { runCodexExec } from "./codex-runner";
import { saveStage2RunDebugArtifact } from "./stage2-debug-artifacts";
import {
  normalizeComments,
  prepareCommentsForPrompt,
  sortCommentsByPopularity
} from "./comments";
import {
  buildStage2SeoPrompt,
  parseStage2SeoOutput,
  STAGE2_SEO_OUTPUT_SCHEMA
} from "./stage2-seo";
import { buildStage2Spec } from "./stage2-spec";
import {
  buildQuickRegenerateResult,
  runQuickRegenerateModel
} from "./stage2-quick-regenerate";
import { validateStage2Output } from "./stage2-output-validation";
import {
  getStage2Run,
  markStage2RunStageCompleted,
  markStage2RunStageFailed,
  markStage2RunStageRunning,
  Stage2RunRecord
} from "./stage2-progress-store";
import {
  getWorkspaceStage2ExamplesCorpusJson,
  getWorkspaceStage2PromptConfig
} from "./team-store";
import {
  fetchOptionalYtDlpInfo,
  downloadSourceMedia
} from "./source-acquisition";
import {
  extractYtDlpErrorFromUnknown,
  sanitizeFileName
} from "./ytdlp";
import { requireRuntimeTool } from "./runtime-capabilities";
import { resolveStage2PromptTemplate } from "./viral-shorts-worker/prompts";
import {
  buildVideoContext,
  ViralShortsWorkerService
} from "./viral-shorts-worker/service";
import { createStage2CodexExecutorContext } from "./stage2-codex-executor";
import type { Stage2RunDebugArtifact, Stage2TokenUsage } from "./viral-shorts-worker/types";

const execFileAsync = promisify(execFile);

type VideoInfoJson = {
  title?: string;
  description?: string;
  transcript?: string;
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
  commentsAcquisition: {
    status: "primary_success" | "fallback_success" | "unavailable";
    provider: "youtubeDataApi" | "ytDlp" | null;
    note: string | null;
    error: string | null;
  };
}> {
  const downloaded = await downloadSourceMedia(url, tmpDir);
  const optionalInfo = await fetchOptionalYtDlpInfo(url, tmpDir);
  const title = optionalInfo.infoJson?.title?.trim() || downloaded.title?.trim() || "video";
  const infoJson: VideoInfoJson = {
    title,
    description: optionalInfo.infoJson?.description?.trim() || "",
    transcript: optionalInfo.infoJson?.transcript?.trim() || "",
    comments: optionalInfo.infoJson?.comments
  };

  return {
    videoPath: downloaded.filePath,
    videoFileName: `${sanitizeFileName(downloaded.fileName)}.mp4`,
    title,
    infoJson,
    videoSizeBytes: downloaded.videoSizeBytes,
    downloadProvider: downloaded.provider,
    commentsExtractionFallbackUsed: optionalInfo.commentsExtractionFallbackUsed,
    commentsAcquisition: optionalInfo.commentsAcquisition
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
  const ratios =
    safeDuration <= 8
      ? [0.08, 0.3, 0.62, 0.9]
      : safeDuration <= 15
        ? [0.06, 0.22, 0.45, 0.72, 0.92]
        : safeDuration <= 25
          ? [0.05, 0.16, 0.32, 0.52, 0.74, 0.92]
          : safeDuration <= 40
            ? [0.04, 0.12, 0.23, 0.36, 0.5, 0.64, 0.79, 0.93]
            : safeDuration <= 60
              ? [0.03, 0.1, 0.18, 0.28, 0.4, 0.52, 0.64, 0.76, 0.87, 0.95]
              : [0.03, 0.08, 0.14, 0.21, 0.3, 0.41, 0.52, 0.63, 0.74, 0.83, 0.9, 0.96];

  return ratios.map((ratio, index) =>
    Math.max(0.1, Math.min(maxTs, safeDuration * ratio + index * 0.01))
  );
}

function describeFrameMoment(
  second: number,
  durationSeconds: number | null,
  index: number,
  totalFrames: number
): string {
  const safeDuration = durationSeconds && durationSeconds > 0.5 ? durationSeconds : null;
  const ratio = safeDuration ? second / safeDuration : totalFrames <= 1 ? 0 : index / (totalFrames - 1);
  const beat =
    ratio <= 0.12
      ? "opening setup"
      : ratio <= 0.24
        ? "early setup"
        : ratio <= 0.4
          ? "building action"
          : ratio <= 0.58
            ? "mid-clip progression"
            : ratio <= 0.74
              ? "pre-payoff turn"
              : ratio <= 0.88
                ? "payoff beat"
                : "late aftermath";

  if (safeDuration) {
    return `frame ${index + 1}: ${beat} at ${second.toFixed(2)}s of ${safeDuration.toFixed(2)}s`;
  }
  return `frame ${index + 1}: ${beat} at ${second.toFixed(2)}s`;
}

export function buildAdaptiveFramePlan(
  durationSeconds: number | null
): Array<{ timestampSec: number; description: string }> {
  const timestamps = buildFrameTimestamps(durationSeconds);
  return timestamps.map((timestampSec, index) => ({
    timestampSec,
    description: describeFrameMoment(timestampSec, durationSeconds, index, timestamps.length)
  }));
}

async function extractFrameImages(
  videoPath: string,
  tmpDir: string
): Promise<{ framePaths: string[]; frameDescriptions: string[] }> {
  const duration = await probeVideoDurationSeconds(videoPath);
  const framePlan = buildAdaptiveFramePlan(duration);
  const framePaths: string[] = [];
  const frameDescriptions: string[] = [];

  for (let i = 0; i < framePlan.length; i += 1) {
    const second = framePlan[i]?.timestampSec ?? 0.1;
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
    frameDescriptions.push(framePlan[i]?.description ?? `frame ${i + 1} at ${second.toFixed(2)}s`);
  }

  return { framePaths, frameDescriptions };
}

export function buildStage2RuntimeVideoContext(input: {
  sourceUrl: string;
  title: string;
  description?: string | null;
  transcript?: string | null;
  comments: Array<{ author: string; likes: number; text: string }>;
  frameDescriptions: string[];
  userInstruction?: string | null;
}) {
  return buildVideoContext({
    sourceUrl: input.sourceUrl,
    title: input.title,
    description: input.description,
    transcript: input.transcript,
    comments: input.comments,
    frameDescriptions: input.frameDescriptions,
    userInstruction: input.userInstruction
  });
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

function measurePersistedPayloadBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function finalizeTokenUsage(
  tokenUsage: Stage2TokenUsage | undefined,
  persistedPayloadBytes: number
): Stage2TokenUsage | undefined {
  if (!tokenUsage) {
    return undefined;
  }
  return {
    ...tokenUsage,
    totalPersistedPayloadBytes: persistedPayloadBytes
  };
}

async function persistStage2RawDebugArtifact(input: {
  runId: string;
  rawDebugArtifact: Stage2RunDebugArtifact | null;
}): Promise<string | null> {
  if (!input.rawDebugArtifact) {
    return null;
  }
  return saveStage2RunDebugArtifact({
    runId: input.runId,
    artifact: {
      ...input.rawDebugArtifact,
      runId: input.runId
    }
  });
}

async function processRegenerateStage2Run(run: Stage2RunRecord): Promise<Stage2Response> {
  await requireRuntimeTool("codex");
  const baseRunId = run.baseRunId ?? run.request.baseRunId ?? null;
  if (!baseRunId) {
    throw new Error("Quick regenerate requires a base Stage 2 run.");
  }

  markStage2RunStageRunning(run.runId, "base", {
    detail: `Loading base run ${baseRunId.slice(0, 8)}.`
  });
  const baseRun = getStage2Run(baseRunId);
  if (!baseRun || !baseRun.resultData) {
    markStage2RunStageFailed(
      run.runId,
      "base",
      "The selected base Stage 2 run could not be loaded."
    );
    throw new Error("The selected base Stage 2 run could not be loaded.");
  }
  const baseResult = baseRun.resultData as Stage2Response;
  markStage2RunStageCompleted(run.runId, "base", {
    detail: `Base run ${baseRunId.slice(0, 8)} loaded.`
  });

  const channel = run.request.channel;
  const executorContext = await createStage2CodexExecutorContext(run.workspaceId);
  markStage2RunStageRunning(run.runId, "regenerate", {
    detail: "Quick-regenerating the visible shortlist and paired titles.",
    reasoningEffort: executorContext.reasoningEffort
  });
  const regenerateStartedAt = Date.now();

  let promptText = "";
  let rawOutput = null;
  try {
    const quickResult = await runQuickRegenerateModel({
      stage2: baseResult,
      channel,
      userInstruction: run.userInstruction,
      executor: executorContext.executor,
      model: executorContext.resolvedCodexModelConfig.regenerate,
      reasoningEffort: executorContext.reasoningEffort
    });
    promptText = quickResult.promptText;
    rawOutput = quickResult.rawOutput;
    markStage2RunStageCompleted(run.runId, "regenerate", {
      detail: "Quick regenerate response received.",
      durationMs: Date.now() - regenerateStartedAt,
      promptChars: promptText.length,
      reasoningEffort: executorContext.reasoningEffort
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Quick regenerate failed.";
    markStage2RunStageFailed(run.runId, "regenerate", message, {
      durationMs: Date.now() - regenerateStartedAt,
      promptChars: promptText.length || null,
      reasoningEffort: executorContext.reasoningEffort
    });
    throw error instanceof Error ? error : new Error(message);
  }

  markStage2RunStageRunning(run.runId, "assemble", {
    detail: "Normalizing quick regenerate output and persisting the new run."
  });
  const assembled = buildQuickRegenerateResult({
    runId: run.runId,
    createdAt: run.createdAt,
    mode: "regenerate",
    baseRunId,
    baseResult,
    channel,
    userInstruction: run.userInstruction,
    promptText,
    reasoningEffort: executorContext.reasoningEffort,
    model: executorContext.resolvedCodexModelConfig.regenerate,
    rawOutput,
    debugMode: run.request.debugMode
  });
  const debugRef = await persistStage2RawDebugArtifact({
    runId: run.runId,
    rawDebugArtifact: assembled.rawDebugArtifact
  });
  const persistedPayloadBytes = measurePersistedPayloadBytes({
    ...assembled.response,
    tokenUsage: finalizeTokenUsage(assembled.tokenUsage, 0)
  });
  markStage2RunStageCompleted(run.runId, "assemble", {
    detail: `Quick regenerate saved ${assembled.response.output.captionOptions.length} caption options and ${assembled.response.output.titleOptions.length} title options.`
  });

  return {
    ...assembled.response,
    debugMode: run.request.debugMode === "raw" ? "raw" : "summary",
    debugRef: debugRef ? { kind: "stage2-run-debug", ref: debugRef } : null,
    tokenUsage: finalizeTokenUsage(assembled.tokenUsage, persistedPayloadBytes),
    progress: getStage2Run(run.runId)?.snapshot ?? assembled.response.progress ?? null
  };
}

export async function processStage2Run(run: Stage2RunRecord): Promise<Stage2Response> {
  if (run.mode === "regenerate") {
    return processRegenerateStage2Run(run);
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clip-stage2-"));

  try {
    await Promise.all([
      requireRuntimeTool("ffmpeg"),
      requireRuntimeTool("ffprobe"),
      requireRuntimeTool("codex")
    ]);
    const executorContext = await createStage2CodexExecutorContext(run.workspaceId);

    const channel = run.request.channel;
    markStage2RunStageRunning(run.runId, "analyzer", {
      detail: "Подготавливаем source media, кадры и комментарии."
    });

    const downloaded = await downloadVideoAndMetadata(run.sourceUrl, tmpDir);
    const allComments = sortCommentsByPopularity(normalizeComments(downloaded.infoJson.comments)).slice(0, 300);
    const promptComments = prepareCommentsForPrompt(allComments, {
      maxComments: 300,
      maxChars: 35_000
    });
    const frames = await extractFrameImages(downloaded.videoPath, tmpDir);

    const workerService = new ViralShortsWorkerService();
    const workspaceStage2ExamplesCorpusJson = getWorkspaceStage2ExamplesCorpusJson(run.workspaceId);
    const workspaceStage2PromptConfig = getWorkspaceStage2PromptConfig(run.workspaceId);
    const videoContext = buildStage2RuntimeVideoContext({
      sourceUrl: run.sourceUrl,
      title: downloaded.title,
      description: downloaded.infoJson.description,
      transcript: downloaded.infoJson.transcript,
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
        stage2HardConstraints: channel.stage2HardConstraints,
        stage2StyleProfile: channel.stage2StyleProfile,
        editorialMemory: channel.editorialMemory
      },
      workspaceStage2ExamplesCorpusJson,
      videoContext,
      imagePaths: frames.framePaths,
      executor: executorContext.executor,
      stageModels: {
        analyzer: executorContext.resolvedCodexModelConfig.analyzer,
        selector: executorContext.resolvedCodexModelConfig.selector,
        writer: executorContext.resolvedCodexModelConfig.writer,
        critic: executorContext.resolvedCodexModelConfig.critic,
        rewriter: executorContext.resolvedCodexModelConfig.rewriter,
        finalSelector: executorContext.resolvedCodexModelConfig.finalSelector,
        titles: executorContext.resolvedCodexModelConfig.titles
      },
      promptConfig: workspaceStage2PromptConfig,
      debugMode: run.request.debugMode,
      onProgress: async (event) => {
        if (event.state === "running") {
          markStage2RunStageRunning(run.runId, event.stageId, {
            summary: event.summary ?? null,
            detail: event.detail ?? null,
            promptChars: event.promptChars ?? null,
            reasoningEffort: event.reasoningEffort ?? null
          });
          return;
        }
        if (event.state === "completed") {
          markStage2RunStageCompleted(run.runId, event.stageId, {
            summary: event.summary ?? null,
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
    const warnings = [
      ...pipelineResult.warnings,
      ...validateStage2Output(parsedOutput, channel.stage2HardConstraints)
    ];

    let seo: { description: string; tags: string } | null = null;
    const seoTemplate = resolveStage2PromptTemplate("seo", workspaceStage2PromptConfig);
    let seoPromptText: string | null = null;
    let seoSerializedResultBytes: number | null = null;
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
      const seoModel = executorContext.resolvedCodexModelConfig.seo;
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
        codexHome: executorContext.codexHome,
        timeoutMs: seoTimeoutMs,
        model: seoModel,
        reasoningEffort: seoReasoningEffort
      });

      const rawSeoOutput = await fs.readFile(seoOutputPath, "utf-8");
      seo = parseStage2SeoOutput(rawSeoOutput);
      seoSerializedResultBytes = measurePersistedPayloadBytes(seo);
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
    const seoPromptStage = {
      stageId: "seo",
      label: "SEO",
      stageType: "llm_prompt" as const,
      defaultPrompt: seoTemplate.defaultPrompt,
      configuredPrompt: seoTemplate.configuredPrompt,
      model: executorContext.resolvedCodexModelConfig.seo,
      reasoningEffort: seoTemplate.reasoningEffort,
      isCustomPrompt: seoTemplate.isCustomPrompt,
      promptText: null,
      promptTextAvailable: Boolean(seoPromptText),
      promptChars: seoPromptText?.length ?? null,
      estimatedInputTokens: seoPromptText ? Math.max(1, Math.ceil(seoPromptText.length / 4)) : null,
      estimatedOutputTokens:
        seoSerializedResultBytes !== null ? Math.max(1, Math.ceil(seoSerializedResultBytes / 4)) : null,
      serializedResultBytes: seoSerializedResultBytes,
      persistedPayloadBytes: null,
      usesImages: false,
      summary: "LLM stage: generates SEO description and tags from the final Stage 2 pick."
    };
    const diagnostics = pipelineResult.diagnostics
      ? {
          ...pipelineResult.diagnostics,
          effectivePrompting: {
            ...pipelineResult.diagnostics.effectivePrompting,
            promptStages: [...pipelineResult.diagnostics.effectivePrompting.promptStages, seoPromptStage]
          }
        }
      : pipelineResult.diagnostics;
    const rawDebugArtifact =
      run.request.debugMode === "raw" && pipelineResult.rawDebugArtifact
        ? {
            ...pipelineResult.rawDebugArtifact,
            runId: run.runId,
            promptStages: [
              ...pipelineResult.rawDebugArtifact.promptStages,
              {
                ...seoPromptStage,
                promptText: seoPromptText
              }
            ]
          }
        : null;
    const debugRef = await persistStage2RawDebugArtifact({
      runId: run.runId,
      rawDebugArtifact
    });
    const baseResponse = {
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
        commentsExtractionFallbackUsed: downloaded.commentsExtractionFallbackUsed,
        commentsAcquisitionStatus: downloaded.commentsAcquisition.status,
        commentsAcquisitionProvider: downloaded.commentsAcquisition.provider,
        commentsAcquisitionNote: downloaded.commentsAcquisition.note,
        commentsAcquisitionError: downloaded.commentsAcquisition.error
      },
      stage2Spec: buildStage2Spec({
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
        hardConstraints: channel.stage2HardConstraints,
        enforcedVia: "Multi-stage worker pipeline + Codex JSON stages + post-validation"
      }),
      output: parsedOutput,
      seo,
      warnings,
      diagnostics,
      progress: getStage2Run(run.runId)?.snapshot ?? null,
      model: executorContext.pipelineModelSummary ?? "default",
      reasoningEffort: executorContext.reasoningEffort,
      userInstructionUsed: run.userInstruction,
      debugMode: run.request.debugMode === "raw" ? "raw" : "summary",
      debugRef: debugRef ? { kind: "stage2-run-debug" as const, ref: debugRef } : null,
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
    };
    const tokenUsage = finalizeTokenUsage(
      {
        ...pipelineResult.tokenUsage,
        stages: [
          ...pipelineResult.tokenUsage.stages,
          {
            stageId: "seo",
            promptChars: seoPromptText?.length ?? null,
            estimatedInputTokens: seoPromptText ? Math.max(1, Math.ceil(seoPromptText.length / 4)) : null,
            estimatedOutputTokens:
              seoSerializedResultBytes !== null ? Math.max(1, Math.ceil(seoSerializedResultBytes / 4)) : null,
            serializedResultBytes: seoSerializedResultBytes,
            persistedPayloadBytes: 0
          }
        ]
      },
      measurePersistedPayloadBytes(baseResponse)
    );
    return {
      ...baseResponse,
      tokenUsage
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
