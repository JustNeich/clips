import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Stage2Response } from "../app/components/types";
import { runWithHostedSubprocessGate } from "./hosted-subprocess";
import { saveStage2RunDebugArtifact } from "./stage2-debug-artifacts";
import {
  normalizeComments,
  prepareCommentsForPrompt,
  sortCommentsByPopularity
} from "./comments";
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
import { getStage2ProgressStartStageId } from "./stage2-pipeline";
import {
  getWorkspaceStage2ExamplesCorpusJson,
  getWorkspaceStage2PromptConfig
} from "./team-store";
import {
  fetchOptionalYtDlpInfo
} from "./source-acquisition";
import { ensureSourceMediaCached } from "./source-media-cache";
import {
  extractYtDlpErrorFromUnknown,
  sanitizeFileName
} from "./ytdlp";
import { requireRuntimeTool } from "./runtime-capabilities";
import {
  buildVideoContext,
  ViralShortsWorkerService
} from "./viral-shorts-worker/service";
import { createStage2CodexExecutorContext } from "./stage2-codex-executor";
import type {
  NativeCaptionContextPacket,
  Stage2RunDebugArtifact,
  Stage2TokenUsage
} from "./viral-shorts-worker/types";

const execFileAsync = promisify(execFile);

type VideoInfoJson = {
  title?: string;
  description?: string;
  transcript?: string;
  comments?: unknown;
};

type Stage2WorkerRolloutAudit =
  | { ok: true }
  | {
      ok: false;
      message: string;
    };

function formatStage2WorkerBuildLabel(
  execution: NonNullable<NonNullable<Stage2Response["output"]["pipeline"]>["execution"]>
): string {
  const parts = [
    execution.workerBuild.buildId || "unknown-build",
    execution.workerBuild.startedAt || "unknown-start",
    execution.workerBuild.pid ? `pid=${execution.workerBuild.pid}` : null
  ].filter(Boolean);
  return parts.join(" ");
}

function resolveNativeStage2ResponseExecutionSettings(input: {
  output: Stage2Response["output"];
  promptConfig: ReturnType<typeof getWorkspaceStage2PromptConfig>;
  executorContext: Awaited<ReturnType<typeof createStage2CodexExecutorContext>>;
  hardConstraints: Stage2RunRecord["request"]["channel"]["stage2HardConstraints"];
}) {
  const isReferenceOneShot =
    input.output.pipeline?.execution?.pathVariant === "reference_one_shot_v1";
  const referenceOneShotModel =
    input.executorContext.resolvedCodexModelConfig.oneShotReference;
  const referenceOneShotModelSummary =
    referenceOneShotModel === input.executorContext.resolvedCodexModelConfig.captionTranslation &&
    referenceOneShotModel === input.executorContext.resolvedCodexModelConfig.seo
      ? referenceOneShotModel
      : "per-stage policy";
  return {
    model:
      (isReferenceOneShot
        ? referenceOneShotModelSummary
        : input.executorContext.pipelineModelSummary) ?? "default",
    reasoningEffort: isReferenceOneShot
      ? input.promptConfig.stages.oneShotReference.reasoningEffort
      : input.executorContext.reasoningEffort,
    stage2Spec: buildStage2Spec({
      name: "Native Caption Pipeline v3",
      outputSections: [
        "contextPacket",
        "captionOptions(5 bilingual display options)",
        isReferenceOneShot ? "finalists(5 publishable options)" : "finalists(0-3)",
        "winner",
        "titleOptions(5 bilingual winner-only)",
        "seo(description,tags)",
        "diagnostics(nativeCaptionV3,prompts)",
        "progress(stage snapshots)"
      ],
      hardConstraints: input.hardConstraints,
      enforcedVia: isReferenceOneShot
        ? "One-shot reference baseline + caption translation + title writer + seo writer + assemble"
        : "Context packet + candidate batch + quality court + targeted repair + caption translation + title writer + seo writer"
    })
  };
}

export function auditStage2WorkerRollout(output: Stage2Response["output"]): Stage2WorkerRolloutAudit {
  const pipeline = output.pipeline;
  if (!pipeline) {
    return {
      ok: false,
      message: "Stage 2 rollout failed: worker output is missing pipeline metadata."
    };
  }

  const execution = pipeline.execution;
  if (!execution) {
    return {
      ok: false,
      message: "Stage 2 rollout failed: worker output is missing pipeline.execution metadata."
    };
  }

  if (execution.pipelineVersion === "native_caption_v3") {
    const isReferenceOneShot = execution.pathVariant === "reference_one_shot_v1";
    if (!pipeline.nativeCaptionV3) {
      return {
        ok: false,
        message:
          "Stage 2 rollout failed: pipelineVersion resolved to native_caption_v3 but stage2.nativeCaptionV3 is missing."
      };
    }
    if (!output.winner) {
      return {
        ok: false,
        message:
          "Stage 2 rollout failed: native_caption_v3 output is missing the winner payload."
      };
    }
    if (!pipeline.nativeCaptionV3.guardSummary) {
      return {
        ok: false,
        message:
          "Stage 2 rollout failed: native_caption_v3 output is missing guardSummary diagnostics."
      };
    }
    if (!Array.isArray(output.captionOptions) || output.captionOptions.length !== 5) {
      return {
        ok: false,
        message:
          `Stage 2 rollout failed: native_caption_v3 expected 5 display options, received ${output.captionOptions?.length ?? 0}.`
      };
    }
    if (
      output.captionOptions.some(
        (option) => !option.topRu?.trim() || !option.bottomRu?.trim()
      )
    ) {
      return {
        ok: false,
        message:
          "Stage 2 rollout failed: native_caption_v3 expected bilingual display options with topRu/bottomRu."
      };
    }
    const hasInvalidDisplayOption = output.captionOptions.some(
      (option) => option.constraintCheck?.passed === false
    );
    const hasValidDisplayOption = output.captionOptions.some(
      (option) => option.constraintCheck?.passed !== false
    );
    if (hasInvalidDisplayOption && !isReferenceOneShot) {
      return {
        ok: false,
        message:
          "Stage 2 rollout failed: native_caption_v3 returned an invalid display option after runtime gating."
      };
    }
    if (output.winner.constraintCheck?.passed === false && (!isReferenceOneShot || hasValidDisplayOption)) {
      return {
        ok: false,
        message:
          "Stage 2 rollout failed: native_caption_v3 returned an invalid winner after runtime gating."
      };
    }
    if (
      pipeline.nativeCaptionV3.guardSummary.winnerValidity !== "valid" &&
      (!isReferenceOneShot || hasValidDisplayOption)
    ) {
      return {
        ok: false,
        message:
          "Stage 2 rollout failed: native_caption_v3 guardSummary reports a non-valid winner."
      };
    }
    if (!Array.isArray(output.titleOptions) || output.titleOptions.length !== 5) {
      return {
        ok: false,
        message:
          `Stage 2 rollout failed: native_caption_v3 expected 5 title options, received ${output.titleOptions?.length ?? 0}.`
      };
    }
    if (output.titleOptions.some((option) => !option.titleRu?.trim())) {
      return {
        ok: false,
        message:
          "Stage 2 rollout failed: native_caption_v3 expected bilingual title options with titleRu."
      };
    }
    if (pipeline.nativeCaptionV3.guardSummary.displayShortlistCount !== 5) {
      return {
        ok: false,
        message:
          "Stage 2 rollout failed: native_caption_v3 guardSummary does not report a 5-option display shortlist."
      };
    }
    const winnerDisplayOption = output.captionOptions.find((option) => option.option === output.finalPick.option);
    if (!winnerDisplayOption || winnerDisplayOption.candidateId !== output.winner.candidateId) {
      return {
        ok: false,
        message:
          "Stage 2 rollout failed: finalPick.option does not resolve to the native winner inside captionOptions."
      };
    }
    const expectedDegradedSuccess = output.winner.displayTier !== "finalist";
    if (pipeline.nativeCaptionV3.guardSummary.degradedSuccess !== expectedDegradedSuccess) {
      return {
        ok: false,
        message:
          `Stage 2 rollout failed: native_caption_v3 degradedSuccess=${pipeline.nativeCaptionV3.guardSummary.degradedSuccess} but winner.displayTier=${output.winner.displayTier}.`
      };
    }
    return { ok: true };
  }

  if (execution.pipelineVersion !== "vnext" || execution.featureFlags.STAGE2_VNEXT_ENABLED !== true) {
    return {
      ok: false,
      message:
        `Stage 2 rollout failed: pipelineVersion=${execution.pipelineVersion}; ` +
        `STAGE2_VNEXT_ENABLED=${execution.featureFlags.STAGE2_VNEXT_ENABLED}; ` +
        `stageChainVersion=${execution.stageChainVersion || "missing"}; ` +
        `legacyFallbackReason=${execution.legacyFallbackReason ?? "none"}; ` +
        `workerBuild=${formatStage2WorkerBuildLabel(execution)}.`
    };
  }

  if (execution.stageChainVersion.includes("bridge")) {
    return {
      ok: false,
      message:
        `Stage 2 rollout failed: transitional stageChainVersion=${execution.stageChainVersion} is still active; ` +
        `workerBuild=${formatStage2WorkerBuildLabel(execution)}.`
    };
  }

  const vnext = pipeline.vnext;
  if (!vnext) {
    return {
      ok: false,
      message:
        "Stage 2 rollout failed: pipelineVersion resolved to vnext but stage2.vnext is missing from worker output."
    };
  }

  const missingSections: string[] = [];
  if (!vnext.exampleRouting) {
    missingSections.push("exampleRouting");
  }
  if (!vnext.canonicalCounters) {
    missingSections.push("canonicalCounters");
  }
  if (!vnext.validation) {
    missingSections.push("validation");
  }
  if (!Array.isArray(vnext.candidateLineage) || vnext.candidateLineage.length === 0) {
    missingSections.push("candidateLineage");
  }
  if (!vnext.criticGate) {
    missingSections.push("criticGate");
  }
  if (missingSections.length > 0) {
    return {
      ok: false,
      message:
        `Stage 2 rollout failed: stage2.vnext is missing canonical runtime sections: ${missingSections.join(", ")}. ` +
        `workerBuild=${formatStage2WorkerBuildLabel(execution)}.`
    };
  }

  if (vnext.trace.meta.compatibilityMode !== "none") {
    return {
      ok: false,
      message:
        `Stage 2 rollout failed: compatibilityMode=${vnext.trace.meta.compatibilityMode} instead of none.`
    };
  }

  if (!vnext.trace.stageOutputs.clipTruthExtractor || !vnext.trace.stageOutputs.audienceMiner) {
    return {
      ok: false,
      message:
        "Stage 2 rollout failed: canonical vNext stage outputs are incomplete (clipTruthExtractor/audienceMiner missing)."
    };
  }

  if (vnext.exampleRouting.mode === "disabled" && pipeline.selectedExamplesCount !== 0) {
    return {
      ok: false,
      message:
        `Stage 2 rollout failed: exampleRouting.mode=disabled but selectedExamplesCount=${pipeline.selectedExamplesCount}.`
    };
  }

  if (vnext.criticGate.reserveBackfillCount !== 0) {
    return {
      ok: false,
      message:
        `Stage 2 rollout failed: critic gate still reported reserveBackfillCount=${vnext.criticGate.reserveBackfillCount}.`
    };
  }

  if (!vnext.validation.ok) {
    return {
      ok: false,
      message: `Stage 2 rollout failed: vNext validation failed: ${vnext.validation.issues.join(" ")}`
    };
  }

  return { ok: true };
}

export async function downloadVideoAndMetadata(
  url: string,
  tmpDir: string,
  deps?: {
    ensureCached?: typeof ensureSourceMediaCached;
    fetchOptionalInfo?: typeof fetchOptionalYtDlpInfo;
  }
): Promise<{
  videoPath: string;
  videoFileName: string;
  title: string;
  infoJson: VideoInfoJson;
  videoSizeBytes: number;
  sourceCacheKey: string;
  sourceCacheState: "hit" | "miss" | "wait";
  downloadProvider: "visolix" | "ytDlp" | "upload";
  primaryProviderError: string | null;
  downloadFallbackUsed: boolean;
  providerErrorSummary: Stage2Response["source"]["providerErrorSummary"];
  commentsExtractionFallbackUsed: boolean;
  commentsAcquisition: {
    status: "primary_success" | "fallback_success" | "unavailable";
    provider: "youtubeDataApi" | "ytDlp" | null;
    note: string | null;
    error: string | null;
  };
}> {
  const cachedSource = await (deps?.ensureCached ?? ensureSourceMediaCached)(url);
  const optionalInfo = await (deps?.fetchOptionalInfo ?? fetchOptionalYtDlpInfo)(url, tmpDir);
  const title = optionalInfo.infoJson?.title?.trim() || cachedSource.title?.trim() || "video";
  const infoJson: VideoInfoJson = {
    title,
    description: optionalInfo.infoJson?.description?.trim() || "",
    transcript: optionalInfo.infoJson?.transcript?.trim() || "",
    comments: optionalInfo.infoJson?.comments
  };

  return {
    videoPath: cachedSource.sourcePath,
    videoFileName: `${sanitizeFileName(cachedSource.fileName)}.mp4`,
    title,
    infoJson,
    videoSizeBytes: cachedSource.videoSizeBytes,
    sourceCacheKey: cachedSource.sourceKey,
    sourceCacheState: cachedSource.cacheState,
    downloadProvider: cachedSource.downloadProvider,
    primaryProviderError: cachedSource.primaryProviderError,
    downloadFallbackUsed: cachedSource.downloadFallbackUsed,
    providerErrorSummary: cachedSource.providerErrorSummary,
    commentsExtractionFallbackUsed: optionalInfo.commentsExtractionFallbackUsed,
    commentsAcquisition: optionalInfo.commentsAcquisition
  };
}

async function probeVideoDurationSeconds(videoPath: string): Promise<number | null> {
  try {
    const { stdout } = await runWithHostedSubprocessGate(() =>
      execFileAsync(
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
      )
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
    await runWithHostedSubprocessGate(() =>
      execFileAsync(
        "ffmpeg",
        ["-y", "-ss", second.toFixed(3), "-i", videoPath, "-frames:v", "1", "-q:v", "3", framePath],
        {
          timeout: 60_000,
          maxBuffer: 1024 * 1024 * 2
        }
      )
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

  const basePipelineVersion = baseResult.output.pipeline?.execution?.pipelineVersion ?? "legacy";
  if (basePipelineVersion === "native_caption_v3") {
    const contextPacket =
      baseResult.output.pipeline?.nativeCaptionV3?.contextPacket ??
      baseResult.output.pipeline?.contextPacket ??
      null;
    if (!contextPacket) {
      markStage2RunStageFailed(
        run.runId,
        "regenerate",
        "The selected native caption run is missing its saved context packet."
      );
      throw new Error("The selected native caption run is missing its saved context packet.");
    }

    const executorContext = await createStage2CodexExecutorContext(run.workspaceId);
    const workerService = new ViralShortsWorkerService();
    const channel = run.request.channel;
    const workspaceStage2ExamplesCorpusJson = getWorkspaceStage2ExamplesCorpusJson(run.workspaceId);
    const workspaceStage2PromptConfig = getWorkspaceStage2PromptConfig(run.workspaceId);
    markStage2RunStageRunning(run.runId, "regenerate", {
      detail: "Reusing the saved context packet and rerunning native caption generation.",
      reasoningEffort: executorContext.reasoningEffort
    });
    const regenerateStartedAt = Date.now();

    let pipelineResult;
    try {
      pipelineResult = await workerService.runNativeCaptionPipelineFromContext({
        channel: {
          id: channel.id,
          name: channel.name,
          username: channel.username,
          stage2WorkerProfileId: channel.stage2WorkerProfileId,
          stage2ExamplesConfig: channel.stage2ExamplesConfig,
          stage2HardConstraints: channel.stage2HardConstraints,
          stage2StyleProfile: channel.stage2StyleProfile,
          editorialMemory: channel.editorialMemory,
          templateHighlightProfile: channel.templateHighlightProfile ?? null
        },
        workspaceStage2ExamplesCorpusJson,
        videoContext: buildStage2RuntimeVideoContext({
          sourceUrl: baseResult.source.url,
          title: baseResult.source.title,
          description: "",
          transcript: "",
          comments: baseResult.source.topComments ?? [],
          frameDescriptions: baseResult.source.frameDescriptions ?? [],
          userInstruction: run.userInstruction
        }),
        contextPacket: contextPacket as NativeCaptionContextPacket,
        executor: executorContext.executor,
        stageModels: {
          oneShotReference: executorContext.resolvedCodexModelConfig.oneShotReference,
          contextPacket: executorContext.resolvedCodexModelConfig.contextPacket,
          candidateGenerator: executorContext.resolvedCodexModelConfig.candidateGenerator,
          qualityCourt: executorContext.resolvedCodexModelConfig.qualityCourt,
          targetedRepair: executorContext.resolvedCodexModelConfig.targetedRepair,
          captionHighlighting: executorContext.resolvedCodexModelConfig.captionHighlighting,
          captionTranslation: executorContext.resolvedCodexModelConfig.captionTranslation,
          titleWriter: executorContext.resolvedCodexModelConfig.titleWriter,
          seo: executorContext.resolvedCodexModelConfig.seo
        },
        promptConfig: workspaceStage2PromptConfig,
        debugMode: run.request.debugMode
      });
      markStage2RunStageCompleted(run.runId, "regenerate", {
        detail: "Native caption rerun finished.",
        durationMs: Date.now() - regenerateStartedAt,
        reasoningEffort: executorContext.reasoningEffort
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Native caption regenerate failed.";
      markStage2RunStageFailed(run.runId, "regenerate", message, {
        durationMs: Date.now() - regenerateStartedAt,
        reasoningEffort: executorContext.reasoningEffort
      });
      throw error instanceof Error ? error : new Error(message);
    }

    markStage2RunStageRunning(run.runId, "assemble", {
      detail: "Persisting the native caption rerun result."
    });
    const debugRef = await persistStage2RawDebugArtifact({
      runId: run.runId,
      rawDebugArtifact: pipelineResult.rawDebugArtifact
    });
    const baseResponse = {
      ...baseResult,
      output: pipelineResult.output,
      seo: pipelineResult.seo,
      warnings: [
        ...pipelineResult.warnings,
        ...validateStage2Output(pipelineResult.output, channel.stage2HardConstraints)
      ],
      diagnostics: pipelineResult.diagnostics,
      progress: getStage2Run(run.runId)?.snapshot ?? null,
      ...resolveNativeStage2ResponseExecutionSettings({
        output: pipelineResult.output,
        promptConfig: workspaceStage2PromptConfig,
        executorContext,
        hardConstraints: channel.stage2HardConstraints
      }),
      userInstructionUsed: run.userInstruction,
      debugMode: run.request.debugMode === "raw" ? "raw" : "summary",
      debugRef: debugRef ? { kind: "stage2-run-debug" as const, ref: debugRef } : null,
      stage2Worker: {
        runId: run.runId,
        buildId: pipelineResult.output.pipeline.execution?.workerBuild.buildId,
        startedAt: pipelineResult.output.pipeline.execution?.workerBuild.startedAt,
        pid: pipelineResult.output.pipeline.execution?.workerBuild.pid,
        pipelineVersion: pipelineResult.output.pipeline.execution?.pipelineVersion,
        stageChainVersion: pipelineResult.output.pipeline.execution?.stageChainVersion,
        featureFlags: pipelineResult.output.pipeline.execution?.featureFlags
      },
      stage2Run: {
        runId: run.runId,
        mode: run.mode,
        baseRunId,
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
      pipelineResult.tokenUsage,
      measurePersistedPayloadBytes(baseResponse)
    );
    markStage2RunStageCompleted(run.runId, "assemble", {
        detail: `Native caption rerun saved ${pipelineResult.output.finalists?.length ?? 0} finalists and ${pipelineResult.output.titleOptions.length} winner titles.`
      });

    return {
      ...baseResponse,
      tokenUsage
    } as Stage2Response;
  }

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
    markStage2RunStageRunning(
      run.runId,
      getStage2ProgressStartStageId(run.mode, channel.stage2WorkerProfileId),
      {
      detail: "Подготавливаем source media, кадры и комментарии."
      }
    );

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
    const pipelineResult = await workerService.runNativeCaptionPipeline({
      channel: {
        id: channel.id,
        name: channel.name,
        username: channel.username,
        stage2WorkerProfileId: channel.stage2WorkerProfileId,
        stage2ExamplesConfig: channel.stage2ExamplesConfig,
        stage2HardConstraints: channel.stage2HardConstraints,
        stage2StyleProfile: channel.stage2StyleProfile,
        editorialMemory: channel.editorialMemory,
        templateHighlightProfile: channel.templateHighlightProfile ?? null
      },
      workspaceStage2ExamplesCorpusJson,
      videoContext,
      imagePaths: frames.framePaths,
      executor: executorContext.executor,
      stageModels: {
        oneShotReference: executorContext.resolvedCodexModelConfig.oneShotReference,
        contextPacket: executorContext.resolvedCodexModelConfig.contextPacket,
        candidateGenerator: executorContext.resolvedCodexModelConfig.candidateGenerator,
        qualityCourt: executorContext.resolvedCodexModelConfig.qualityCourt,
        targetedRepair: executorContext.resolvedCodexModelConfig.targetedRepair,
        captionHighlighting: executorContext.resolvedCodexModelConfig.captionHighlighting,
        captionTranslation: executorContext.resolvedCodexModelConfig.captionTranslation,
        titleWriter: executorContext.resolvedCodexModelConfig.titleWriter,
        seo: executorContext.resolvedCodexModelConfig.seo
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
    const rolloutAudit = auditStage2WorkerRollout(parsedOutput);
    if (!rolloutAudit.ok) {
      throw new Error(rolloutAudit.message);
    }
    const warnings = [
      ...pipelineResult.warnings,
      ...validateStage2Output(parsedOutput, channel.stage2HardConstraints)
    ];
    const diagnostics = pipelineResult.diagnostics;
    const rawDebugArtifact =
      run.request.debugMode === "raw" && pipelineResult.rawDebugArtifact
        ? {
            ...pipelineResult.rawDebugArtifact,
            runId: run.runId
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
        sourceCacheKey: downloaded.sourceCacheKey,
        sourceCacheState: downloaded.sourceCacheState,
        downloadProvider: downloaded.downloadProvider,
        primaryProviderError: downloaded.primaryProviderError,
        downloadFallbackUsed: downloaded.downloadFallbackUsed,
        providerErrorSummary: downloaded.providerErrorSummary,
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
      ...resolveNativeStage2ResponseExecutionSettings({
        output: parsedOutput,
        promptConfig: workspaceStage2PromptConfig,
        executorContext,
        hardConstraints: channel.stage2HardConstraints
      }),
      output: parsedOutput,
      seo: pipelineResult.seo,
      warnings,
      diagnostics,
      progress: getStage2Run(run.runId)?.snapshot ?? null,
      userInstructionUsed: run.userInstruction,
      debugMode: run.request.debugMode === "raw" ? "raw" : "summary",
      debugRef: debugRef ? { kind: "stage2-run-debug" as const, ref: debugRef } : null,
      stage2Worker: {
        runId: run.runId,
        buildId: parsedOutput.pipeline.execution?.workerBuild.buildId,
        startedAt: parsedOutput.pipeline.execution?.workerBuild.startedAt,
        pid: parsedOutput.pipeline.execution?.workerBuild.pid,
        pipelineVersion: parsedOutput.pipeline.execution?.pipelineVersion,
        stageChainVersion: parsedOutput.pipeline.execution?.stageChainVersion,
        featureFlags: parsedOutput.pipeline.execution?.featureFlags
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
      pipelineResult.tokenUsage,
      measurePersistedPayloadBytes(baseResponse)
    );
    return {
      ...baseResponse,
      tokenUsage
    } as Stage2Response;
  } catch (error) {
    const ytdlpMessage = extractYtDlpErrorFromUnknown(error);
    const errorMessage = ytdlpMessage ?? getPipelineErrorMessage(error);
    const activeStageId =
      getStage2Run(run.runId)?.snapshot.activeStageId ??
      getStage2ProgressStartStageId(run.mode, run.request.channel.stage2WorkerProfileId);
    markStage2RunStageFailed(run.runId, activeStageId, errorMessage);
    throw new Error(errorMessage);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
