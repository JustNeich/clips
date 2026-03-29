import { promises as fs } from "node:fs";
import {
  Stage3ExecutionTarget,
  Stage3JobKind,
  ChatRenderExportRef,
  Stage3JobStatus,
  Stage2Response,
  Stage3JobSummary
} from "../app/components/types";
import { completeRenderExportAndMaybeQueue } from "./channel-publication-service";
import { scheduleChannelPublicationProcessing } from "./channel-publication-runtime";
import { appendChatEvent, getChatById } from "./chat-history";
import { findLatestStage2Event } from "./chat-workflow";
import {
  appendStage3JobEvent,
  claimNextQueuedStage3Job,
  completeStage3Job,
  enqueueStage3Job,
  finishStage3Job,
  getStage3Job,
  hasQueuedStage3Jobs,
  interruptPendingStage3Jobs,
  Stage3JobRecord
} from "./stage3-job-store";
import { publishStage3VideoArtifact } from "./stage3-job-artifacts";
import { isHostStage3ExecutionAllowed } from "./stage3-execution";
import { Stage3RenderRequestBody } from "./stage3-render-service";
import { isStage3HostedBusyError } from "./stage3-server-control";

const JOB_POLL_INTERVAL_MS = 350;

type Stage3RuntimeState = {
  initialized: boolean;
  runnerPromise: Promise<void> | null;
};

type Stage3RuntimeGlobal = typeof globalThis & {
  __clipsStage3JobRuntimeState__?: Stage3RuntimeState;
};

type RenderExportCompletionState = {
  renderExport: ReturnType<typeof completeRenderExportAndMaybeQueue>["renderExport"];
  publication: ReturnType<typeof completeRenderExportAndMaybeQueue>["publication"];
};

type EnqueueJobInput = {
  workspaceId: string;
  userId: string;
  kind: Stage3JobKind;
  payloadJson: string;
  executionTarget?: Stage3ExecutionTarget | null;
  dedupeKey?: string | null;
  attemptLimit?: number | null;
  attemptGroup?: string | null;
};

function getStage3RuntimeState(): Stage3RuntimeState {
  const scope = globalThis as Stage3RuntimeGlobal;
  if (!scope.__clipsStage3JobRuntimeState__) {
    scope.__clipsStage3JobRuntimeState__ = {
      initialized: false,
      runnerPromise: null
    };
  }
  return scope.__clipsStage3JobRuntimeState__;
}

function memorySnapshotMb(): Record<string, number> {
  const usage = process.memoryUsage();
  return {
    rssMb: Math.round((usage.rss / (1024 * 1024)) * 10) / 10,
    heapUsedMb: Math.round((usage.heapUsed / (1024 * 1024)) * 10) / 10,
    heapTotalMb: Math.round((usage.heapTotal / (1024 * 1024)) * 10) / 10,
    externalMb: Math.round((usage.external / (1024 * 1024)) * 10) / 10
  };
}

function logStage3Runtime(event: string, payload: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      scope: "stage3",
      event,
      at: new Date().toISOString(),
      ...payload
    })
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function isTerminalStatus(status: Stage3JobStatus): boolean {
  return status === "completed" || status === "failed" || status === "interrupted";
}

async function summarizeJobFailure(job: Stage3JobRecord, error: unknown): Promise<string> {
  try {
    const executor = await import("./stage3-job-executor");
    return executor.summarizeStage3HeavyJobError(job.kind, error);
  } catch {
    return error instanceof Error ? error.message : "Stage 3 job failed.";
  }
}

async function normalizeJobFailure(job: Stage3JobRecord, error: unknown): Promise<{
  status: Extract<Stage3JobStatus, "failed" | "interrupted">;
  code: string;
  message: string;
  recoverable: boolean;
}> {
  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      status: "interrupted",
      code: "aborted",
      message: "Stage 3 job was interrupted.",
      recoverable: true
    };
  }
  if (isStage3HostedBusyError(error)) {
    return {
      status: "failed",
      code: "busy",
      message: "Хостинг занят другой тяжёлой задачей Stage 3. Повторите через минуту.",
      recoverable: true
    };
  }
  return {
    status: "failed",
    code:
      job.kind === "preview"
        ? "preview_failed"
        : job.kind === "render"
          ? "render_failed"
          : job.kind === "editing-proxy"
            ? "editing_proxy_failed"
            : job.kind === "source-download"
            ? "source_download_failed"
            : "job_failed",
    message: await summarizeJobFailure(job, error),
    recoverable: true
  };
}

async function executeStage3Job(job: Stage3JobRecord): Promise<void> {
  const startedAt = Date.now();
  const queueWaitMs = Math.max(0, startedAt - new Date(job.createdAt).getTime());
  const beforeMemory = memorySnapshotMb();
  appendStage3JobEvent(job.id, "info", "Executing job.", {
    kind: job.kind,
    queueWaitMs,
    memoryMb: beforeMemory
  });
  logStage3Runtime("job_start", {
    jobId: job.id,
    jobType: job.kind,
    queueWaitMs,
    memoryMb: beforeMemory
  });

  try {
    const executor = await import("./stage3-job-executor");
    const executed = await executor.executeStage3HeavyJobPayload(job.kind, job.payloadJson);
    try {
      const published =
        executed.artifact && (job.kind === "preview" || job.kind === "render" || job.kind === "editing-proxy")
          ? await publishStage3VideoArtifact(job.kind, job.id, executed.artifact.filePath)
          : null;
      if (job.kind === "render" && executed.artifact && published) {
        await persistRenderExportCompletion(job, {
          jobId: job.id,
          artifactFileName: executed.artifact.fileName,
          artifactFilePath: published.filePath,
          artifactMimeType: executed.artifact.mimeType,
          artifactSizeBytes: published.sizeBytes,
          completedAt: new Date().toISOString()
        }).catch((error) => {
          const message =
            error instanceof Error
              ? error.message
              : "Не удалось сохранить server-side результат Stage 3 render.";
          appendStage3JobEvent(job.id, "warn", message);
          logStage3Runtime("render_completion_persist_fail", {
            jobId: job.id,
            message
          });
        });
      }
      completeStage3Job(job.id, {
        resultJson: executed.resultJson,
        artifact:
          executed.artifact && published
            ? {
                kind: "video",
                fileName: executed.artifact.fileName,
                mimeType: executed.artifact.mimeType,
                filePath: published.filePath,
                sizeBytes: published.sizeBytes
              }
            : null
      });
      if (published && executed.artifact) {
        appendStage3JobEvent(job.id, "info", "Published artifact.", {
          kind: job.kind,
          fileName: executed.artifact.fileName,
          sizeBytes: published.sizeBytes
        });
      }
    } finally {
      await executed.cleanup?.();
    }

    const execMs = Date.now() - startedAt;
    const afterMemory = memorySnapshotMb();
    logStage3Runtime("job_complete", {
      jobId: job.id,
      jobType: job.kind,
      execMs,
      result: "completed",
      memoryMb: afterMemory
    });
    appendStage3JobEvent(job.id, "info", "Execution finished.", {
      execMs,
      memoryMb: afterMemory
    });
  } catch (error) {
    const execMs = Date.now() - startedAt;
    const failure = await normalizeJobFailure(job, error);
    finishStage3Job(job.id, {
      status: failure.status,
      errorCode: failure.code,
      errorMessage: failure.message,
      recoverable: failure.recoverable
    });
    logStage3Runtime("job_fail", {
      jobId: job.id,
      jobType: job.kind,
      execMs,
      result: failure.status,
      code: failure.code,
      memoryMb: memorySnapshotMb()
    });
  }
}

function buildRenderExportChatRef(input: {
  completedAt: string | null;
  fileName: string;
  renderTitle: string | null;
  payload: Stage3RenderRequestBody;
}): ChatRenderExportRef {
  const clipStartSec =
    typeof input.payload.snapshot?.clipStartSec === "number" && Number.isFinite(input.payload.snapshot.clipStartSec)
      ? input.payload.snapshot.clipStartSec
      : null;
  const clipDurationSec =
    typeof input.payload.clipDurationSec === "number" && Number.isFinite(input.payload.clipDurationSec)
      ? input.payload.clipDurationSec
      : null;
  const clipEndSec =
    clipStartSec !== null && clipDurationSec !== null ? clipStartSec + clipDurationSec : null;
  const focusY =
    typeof input.payload.snapshot?.focusY === "number" && Number.isFinite(input.payload.snapshot.focusY)
      ? input.payload.snapshot.focusY
      : null;
  const templateId =
    typeof input.payload.snapshot?.renderPlan?.templateId === "string" && input.payload.snapshot.renderPlan.templateId.trim()
      ? input.payload.snapshot.renderPlan.templateId.trim()
      : typeof input.payload.templateId === "string" && input.payload.templateId.trim()
        ? input.payload.templateId.trim()
        : null;

  return {
    kind: "stage3-render-export",
    fileName: input.fileName,
    renderTitle: input.renderTitle,
    clipStartSec,
    clipEndSec,
    focusY,
    templateId,
    createdAt: input.completedAt ?? new Date().toISOString()
  };
}

function shouldScheduleRecoveredPublication(publication: RenderExportCompletionState["publication"]): boolean {
  return Boolean(publication && (publication.status === "queued" || publication.status === "uploading"));
}

async function ensureRenderExportCompletionState(
  initialJob: Stage3JobRecord,
  completedArtifact: {
    jobId: string;
    artifactFileName: string;
    artifactFilePath: string;
    artifactMimeType: string;
    artifactSizeBytes: number;
    completedAt: string;
  }
): Promise<{
  chatId: string;
  payload: Stage3RenderRequestBody;
  completion: RenderExportCompletionState;
} | null> {
  const payload = JSON.parse(initialJob.payloadJson) as Stage3RenderRequestBody;
  const chatId = payload.chatId?.trim() ?? "";
  if (!chatId) {
    return null;
  }

  const chat = await getChatById(chatId);
  if (!chat || chat.workspaceId !== initialJob.workspaceId) {
    return null;
  }

  const stage2Result = findLatestStage2Event(chat)?.payload ?? null;
  const completion = completeRenderExportAndMaybeQueue({
    workspaceId: initialJob.workspaceId,
    channelId: chat.channelId,
    chatId: chat.id,
    chatTitle: chat.title,
    stage3JobId: completedArtifact.jobId,
    artifactFileName: completedArtifact.artifactFileName,
    artifactFilePath: completedArtifact.artifactFilePath,
    artifactMimeType: completedArtifact.artifactMimeType,
    artifactSizeBytes: completedArtifact.artifactSizeBytes,
    renderTitle: payload.renderTitle?.trim() || null,
    sourceUrl: payload.sourceUrl?.trim() || chat.url,
    snapshotJson: JSON.stringify(payload.snapshot ?? null),
    createdByUserId: initialJob.userId,
    stage2Result: (stage2Result ?? null) as Stage2Response | null
  });

  return {
    chatId: chat.id,
    payload,
    completion
  };
}

export async function recoverRenderExportCompletion(
  initialJob: Stage3JobRecord,
  completedArtifact: {
    jobId: string;
    artifactFileName: string;
    artifactFilePath: string;
    artifactMimeType: string;
    artifactSizeBytes: number;
    completedAt: string;
  }
): Promise<void> {
  const state = await ensureRenderExportCompletionState(initialJob, completedArtifact);
  if (!state) {
    return;
  }
  if (shouldScheduleRecoveredPublication(state.completion.publication)) {
    scheduleChannelPublicationProcessing();
  }
}

export async function persistRenderExportCompletion(
  initialJob: Stage3JobRecord,
  completedArtifact: {
    jobId: string;
    artifactFileName: string;
    artifactFilePath: string;
    artifactMimeType: string;
    artifactSizeBytes: number;
    completedAt: string;
  }
): Promise<void> {
  const state = await ensureRenderExportCompletionState(initialJob, completedArtifact);
  if (!state) {
    return;
  }
  const { chatId, payload, completion } = state;

  if (shouldScheduleRecoveredPublication(completion.publication)) {
    scheduleChannelPublicationProcessing();
  }

  const exportRef = buildRenderExportChatRef({
    completedAt: completedArtifact.completedAt,
    fileName: completedArtifact.artifactFileName,
    renderTitle: payload.renderTitle?.trim() || null,
    payload
  });
  try {
    await appendChatEvent(chatId, {
      role: "assistant",
      type: "note",
      text: `Stage 3 export finished: ${exportRef.fileName} (title ${exportRef.renderTitle ?? "n/a"}, clip ${exportRef.clipStartSec?.toFixed(1) ?? "n/a"}-${exportRef.clipEndSec?.toFixed(1) ?? "n/a"}s, focus ${exportRef.focusY === null ? "n/a" : Math.round(exportRef.focusY * 100)}%)`,
      data: {
        ...exportRef,
        renderExportId: completion.renderExport.id,
        publicationId: completion.publication?.id ?? null,
        publicationStatus: completion.publication?.status ?? null,
        publicationScheduledAt: completion.publication?.scheduledAt ?? null
      }
    });
  } catch (error) {
    appendStage3JobEvent(
      initialJob.id,
      "warn",
      error instanceof Error ? error.message : "Не удалось записать событие о завершении Stage 3 render в чат."
    );
  }
}

function ensureStage3JobRuntime(): void {
  const state = getStage3RuntimeState();
  if (state.initialized) {
    return;
  }
  state.initialized = true;
  const interrupted = interruptPendingStage3Jobs();
  if (interrupted > 0) {
    logStage3Runtime("bootstrap_interrupt_jobs", { count: interrupted });
  }
}

async function runStage3JobLoop(): Promise<void> {
  while (true) {
    const job = claimNextQueuedStage3Job();
    if (!job) {
      break;
    }
    await executeStage3Job(job);
  }
}

export function scheduleStage3JobProcessing(): void {
  if (!isHostStage3ExecutionAllowed()) {
    return;
  }
  ensureStage3JobRuntime();
  const state = getStage3RuntimeState();
  if (state.runnerPromise) {
    return;
  }
  state.runnerPromise = runStage3JobLoop().finally(() => {
    const latestState = getStage3RuntimeState();
    latestState.runnerPromise = null;
    if (hasQueuedStage3Jobs("host")) {
      scheduleStage3JobProcessing();
    }
  });
}

export function enqueueAndScheduleStage3Job(input: EnqueueJobInput): Stage3JobRecord {
  const job = enqueueStage3Job(input);
  logStage3Runtime("job_enqueue", {
    jobId: job.id,
    jobType: job.kind,
    status: job.status,
    executionTarget: job.executionTarget,
    dedupeKey: job.dedupeKey,
    memoryMb: memorySnapshotMb()
  });
  if (job.executionTarget === "host") {
    scheduleStage3JobProcessing();
  }
  return job;
}

export function getStage3JobOrThrow(jobId: string): Stage3JobRecord {
  ensureStage3JobRuntime();
  const job = getStage3Job(jobId);
  if (!job) {
    throw new Error("Stage 3 job not found.");
  }
  if (job.status === "queued" && job.executionTarget === "host") {
    scheduleStage3JobProcessing();
  }
  return job;
}

export async function waitForStage3Job(
  jobId: string,
  options?: { timeoutMs?: number; signal?: AbortSignal | null }
): Promise<Stage3JobRecord> {
  ensureStage3JobRuntime();
  const initial = getStage3Job(jobId);
  if (initial?.executionTarget === "host") {
    scheduleStage3JobProcessing();
  }
  const timeoutMs =
    typeof options?.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : 30_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    if (options?.signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    const job = getStage3Job(jobId);
    if (!job) {
      throw new Error("Stage 3 job not found.");
    }
    if (isTerminalStatus(job.status)) {
      return job;
    }
    await delay(JOB_POLL_INTERVAL_MS);
  }

  throw new Error("Timed out waiting for Stage 3 job.");
}
