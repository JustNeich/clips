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
import { appendChatEvent, getChannelById, getChatById } from "./chat-history";
import { COPSCOPES_CHANNEL_USERNAME } from "./copscopes-channel-preset";
import { markCopscopesSourceReel } from "./copscopes-source-pool";
import { validateCopscopesRenderBodyForPublication } from "./copscopes-quality-gate";
import { findCopscopesDuplicateStory } from "./copscopes-story-dedupe";
import { findLatestStage2Event } from "./chat-workflow";
import { listFutureActivePublicationsForChannel } from "./publication-store";
import { persistRenderExportArtifact } from "./render-export-artifacts";
import {
  appendStage3JobEvent,
  claimNextQueuedStage3Job,
  completeStage3Job,
  enqueueStage3JobWithOutcome,
  finishStage3Job,
  getStage3Job,
  hasQueuedStage3Jobs,
  interruptPendingStage3Jobs,
  sweepHostStage3Jobs,
  Stage3JobRecord
} from "./stage3-job-store";
import { publishStage3VideoArtifact } from "./stage3-job-artifacts";
import { isHostStage3ExecutionAllowed } from "./stage3-execution";
import { Stage3RenderRequestBody } from "./stage3-render-service";
import type { Stage3RenderProgressEvent } from "./stage3-render-service";
import { isStage3HostedBusyError } from "./stage3-server-control";
import { clampHostedConcurrencyLimit } from "./hosted-resource-budget";
import { resolveStage3HostJobTimeoutMs } from "./stage3-worker-job-timeout";

const JOB_POLL_INTERVAL_MS = 350;
const INTERACTIVE_STAGE3_HOST_JOB_KINDS: Stage3JobKind[] = [
  "editing-proxy",
  "preview",
  "source-download",
  "agent-media-step"
];
const RENDER_STAGE3_HOST_JOB_KINDS: Stage3JobKind[] = ["render"];

type Stage3RuntimeState = {
  initialized: boolean;
  activeJobs: Map<string, Stage3JobKind>;
  schedulerPromise: Promise<void> | null;
};

type Stage3RuntimeGlobal = typeof globalThis & {
  __clipsStage3JobRuntimeState__?: Stage3RuntimeState;
  __clipsStage3JobProcessorOverride__?: Stage3JobProcessor | null;
};

type Stage3JobProcessorOptions = {
  signal?: AbortSignal | null;
};

export type Stage3JobProcessor = (job: Stage3JobRecord, options?: Stage3JobProcessorOptions) => Promise<void>;

type RenderExportCompletionState = {
  renderExport: ReturnType<typeof completeRenderExportAndMaybeQueue>["renderExport"];
  publication: ReturnType<typeof completeRenderExportAndMaybeQueue>["publication"];
};

function getCopscopesSourceReelId(payload: Stage3RenderRequestBody | null | undefined): string | null {
  const sourceReelId = payload?.copscopes?.sourceReelId?.trim();
  return sourceReelId || null;
}

async function isCopscopesChannel(channelId: string): Promise<boolean> {
  const channel = await getChannelById(channelId);
  return channel?.username?.toLowerCase() === COPSCOPES_CHANNEL_USERNAME;
}

function findCopscopesActivePublicationDuplicate(payload: Stage3RenderRequestBody) {
  const channelId = payload.channelId?.trim();
  if (!channelId) {
    return null;
  }
  return findCopscopesDuplicateStory({
    candidate: {
      id: "render",
      title: payload.renderTitle ?? "",
      caption: [payload.topText, payload.bottomText, payload.snapshot?.bottomText].filter(Boolean).join(" ")
    },
    existing: listFutureActivePublicationsForChannel(channelId).map((publication) => ({
      id: publication.id,
      title: publication.title,
      caption: [publication.description, publication.chatTitle].filter(Boolean).join(" ")
    }))
  });
}

async function markCopscopesRenderFailure(job: Stage3JobRecord, message: string): Promise<void> {
  if (job.kind !== "render") {
    return;
  }
  let payload: Stage3RenderRequestBody | null = null;
  try {
    payload = JSON.parse(job.payloadJson) as Stage3RenderRequestBody;
  } catch {
    return;
  }
  const sourceReelId = getCopscopesSourceReelId(payload);
  const channelId = payload.channelId?.trim();
  if (!sourceReelId || !channelId || !(await isCopscopesChannel(channelId))) {
    return;
  }
  markCopscopesSourceReel({
    reelId: sourceReelId,
    status: "failed",
    chatId: payload.chatId ?? null,
    stage3JobId: job.id,
    error: message || "copscopes_render_failed"
  });
}

type EnqueueJobInput = {
  workspaceId: string;
  userId: string;
  kind: Stage3JobKind;
  payloadJson: string;
  executionTarget?: Stage3ExecutionTarget | null;
  dedupeKey?: string | null;
  attemptLimit?: number | null;
  attemptGroup?: string | null;
  reuseCompleted?: boolean | null;
};

function getStage3RuntimeState(): Stage3RuntimeState {
  const scope = globalThis as Stage3RuntimeGlobal;
  if (!scope.__clipsStage3JobRuntimeState__) {
    scope.__clipsStage3JobRuntimeState__ = {
      initialized: false,
      activeJobs: new Map<string, Stage3JobKind>(),
      schedulerPromise: null
    };
  }
  return scope.__clipsStage3JobRuntimeState__;
}

function getProcessor(): Stage3JobProcessor {
  const scope = globalThis as Stage3RuntimeGlobal;
  return scope.__clipsStage3JobProcessorOverride__ ?? executeStage3Job;
}

export function setStage3JobProcessorForTests(processor: Stage3JobProcessor | null): void {
  (globalThis as Stage3RuntimeGlobal).__clipsStage3JobProcessorOverride__ = processor;
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

function isJobStillRunning(jobId: string): boolean {
  return getStage3Job(jobId)?.status === "running";
}

function buildStage3JobTimeoutErrorCode(kind: Stage3JobKind): string {
  return `${kind.replaceAll("-", "_")}_timeout`;
}

function buildHostJobTimeoutMessage(job: Stage3JobRecord, timeoutMs: number): string {
  const timeoutSec = Math.round(timeoutMs / 1000);
  return `Хостинг Stage 3 не завершил ${job.kind} за ${timeoutSec} секунд; watchdog освободил очередь.`;
}

function appendRenderProgressEvent(job: Stage3JobRecord, event: Stage3RenderProgressEvent): void {
  const level = event.status === "failed" ? "error" : "info";
  const payload = {
    stage: event.stage,
    status: event.status,
    durationMs: event.durationMs ?? null,
    errorMessage: event.errorMessage ?? null,
    ...(event.payload ?? {})
  };
  appendStage3JobEvent(job.id, level, `Render stage ${event.stage} ${event.status}.`, payload);
  logStage3Runtime("render_stage", {
    jobId: job.id,
    jobType: job.kind,
    ...payload
  });
}

type Stage3HostJobLane = "interactive" | "render";

function getStage3HostJobLane(kind: Stage3JobKind): Stage3HostJobLane {
  return kind === "render" ? "render" : "interactive";
}

function getStage3HostLaneKinds(lane: Stage3HostJobLane): Stage3JobKind[] {
  return lane === "render" ? RENDER_STAGE3_HOST_JOB_KINDS : INTERACTIVE_STAGE3_HOST_JOB_KINDS;
}

function getStage3HostLaneConcurrencyLimit(lane: Stage3HostJobLane): number {
  const raw =
    lane === "render"
      ? (process.env.STAGE3_HOST_RENDER_MAX_CONCURRENT_JOBS ?? process.env.STAGE3_HOST_MAX_CONCURRENT_JOBS)
      : (process.env.STAGE3_HOST_INTERACTIVE_MAX_CONCURRENT_JOBS ??
        process.env.STAGE3_HOST_FAST_MAX_CONCURRENT_JOBS ??
        process.env.STAGE3_HOST_MAX_CONCURRENT_JOBS);
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return clampHostedConcurrencyLimit(Math.max(1, Math.min(8, Math.floor(parsed))));
}

function countActiveHostLaneJobs(state: Stage3RuntimeState, lane: Stage3HostJobLane): number {
  let count = 0;
  for (const kind of state.activeJobs.values()) {
    if (getStage3HostJobLane(kind) === lane) {
      count += 1;
    }
  }
  return count;
}

function hasOpenHostLaneCapacityForQueuedJobs(state: Stage3RuntimeState): boolean {
  return (["interactive", "render"] as Stage3HostJobLane[]).some(
    (lane) =>
      countActiveHostLaneJobs(state, lane) < getStage3HostLaneConcurrencyLimit(lane) &&
      hasQueuedStage3Jobs("host", { kinds: getStage3HostLaneKinds(lane) })
  );
}

async function classifyJobFailure(job: Stage3JobRecord, error: unknown): Promise<{
  code: string;
  message: string;
  recoverable: boolean;
}> {
  try {
    const executor = await import("./stage3-job-executor");
    return executor.classifyStage3HeavyJobError(job.kind, error);
  } catch {
    return {
      code: "job_failed",
      message: error instanceof Error ? error.message : "Stage 3 job failed.",
      recoverable: true
    };
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
  const classified = await classifyJobFailure(job, error);
  return {
    status: "failed",
    code: classified.code,
    message: classified.message,
    recoverable: classified.recoverable
  };
}

async function executeStage3Job(job: Stage3JobRecord, options?: Stage3JobProcessorOptions): Promise<void> {
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
    const executed = await executor.executeStage3HeavyJobPayload(job.kind, job.payloadJson, {
      signal: options?.signal ?? null,
      onRenderProgress: job.kind === "render" ? (event) => appendRenderProgressEvent(job, event) : undefined
    });
    try {
      if (!isJobStillRunning(job.id)) {
        appendStage3JobEvent(job.id, "warn", "Discarded host job result because the job is no longer running.", {
          kind: job.kind
        });
        return;
      }
      const published =
        executed.artifact && (job.kind === "preview" || job.kind === "render" || job.kind === "editing-proxy")
          ? await publishStage3VideoArtifact(job.kind, job.id, executed.artifact.filePath)
          : null;
      if (!isJobStillRunning(job.id)) {
        appendStage3JobEvent(job.id, "warn", "Discarded published host job artifact because the job is no longer running.", {
          kind: job.kind,
          artifact: Boolean(published)
        });
        return;
      }
      const completed = completeStage3Job(job.id, {
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
      if (job.kind === "render" && executed.artifact && published) {
        await persistRenderExportCompletion(completed, {
          jobId: job.id,
          artifactFileName: executed.artifact.fileName,
          artifactFilePath: published.filePath,
          artifactMimeType: executed.artifact.mimeType,
          artifactSizeBytes: published.sizeBytes,
          completedAt: new Date().toISOString()
        }).catch((error) => {
          appendStage3JobEvent(
            completed.id,
            "warn",
            error instanceof Error
              ? `Render completed, but post-render export/publication recovery failed: ${error.message}`
              : "Render completed, but post-render export/publication recovery failed."
          );
        });
      }
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
    if (!isJobStillRunning(job.id)) {
      appendStage3JobEvent(job.id, "warn", "Ignored host job failure because the job is no longer running.", {
        kind: job.kind
      });
      return;
    }
    const execMs = Date.now() - startedAt;
    const failure = await normalizeJobFailure(job, error);
    finishStage3Job(job.id, {
      status: failure.status,
      errorCode: failure.code,
      errorMessage: failure.message,
      recoverable: failure.recoverable
    });
    await markCopscopesRenderFailure(job, failure.message).catch((markError) => {
      const message = markError instanceof Error ? markError.message : String(markError);
      appendStage3JobEvent(job.id, "warn", `Could not update CopScopes source pool after render failure: ${message}`);
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

async function runClaimedHostJobWithWatchdog(job: Stage3JobRecord): Promise<void> {
  const processor = getProcessor();
  const timeoutMs = resolveStage3HostJobTimeoutMs(job.kind, process.env, job.payloadJson);
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  appendStage3JobEvent(job.id, "info", "Host job watchdog armed.", {
    kind: job.kind,
    timeoutMs
  });

  const timeoutPromise = new Promise<void>((resolve) => {
    timeoutId = setTimeout(() => {
      const message = buildHostJobTimeoutMessage(job, timeoutMs);
      if (isJobStillRunning(job.id)) {
        finishStage3Job(job.id, {
          status: "failed",
          errorCode: buildStage3JobTimeoutErrorCode(job.kind),
          errorMessage: message,
          recoverable: true
        });
        appendStage3JobEvent(job.id, "error", "Host job exceeded runtime watchdog; active slot released.", {
          kind: job.kind,
          timeoutMs
        });
      }
      controller.abort(new Error(message));
      resolve();
    }, timeoutMs);
    timeoutId.unref?.();
  });

  const processorPromise = Promise.resolve()
    .then(() => processor(job, { signal: controller.signal }))
    .then(() => undefined);
  void processorPromise.catch(() => undefined);

  try {
    await Promise.race([processorPromise, timeoutPromise]);
  } catch (error) {
    if (isJobStillRunning(job.id)) {
      const failure = await normalizeJobFailure(job, error);
      finishStage3Job(job.id, {
        status: failure.status,
        errorCode: failure.code,
        errorMessage: failure.message,
        recoverable: failure.recoverable
      });
    }
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
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

  const durableArtifact = await persistRenderExportArtifact({
    stage3JobId: completedArtifact.jobId,
    sourcePath: completedArtifact.artifactFilePath,
    fileName: completedArtifact.artifactFileName
  });

  const stage2Result = findLatestStage2Event(chat)?.payload ?? null;
  let publishAfterRender =
    typeof payload.publishAfterRender === "boolean" ? payload.publishAfterRender : undefined;
  const copscopesSourceReelId = getCopscopesSourceReelId(payload);
  if (copscopesSourceReelId && (await isCopscopesChannel(chat.channelId))) {
    const gate = validateCopscopesRenderBodyForPublication(payload);
    if (!gate.passed) {
      publishAfterRender = false;
      const message = `CopScopes post-render quality gate blocked publication: ${gate.reasons.join(", ")}`;
      appendStage3JobEvent(completedArtifact.jobId, "warn", message);
      markCopscopesSourceReel({
        reelId: copscopesSourceReelId,
        status: "needs_review",
        chatId: chat.id,
        stage3JobId: completedArtifact.jobId,
        error: message
      });
    }
    const duplicate = findCopscopesActivePublicationDuplicate(payload);
    if (duplicate) {
      publishAfterRender = false;
      const message = [
        "CopScopes post-render story dedupe blocked publication",
        `publication=${duplicate.existing.id}`,
        `reason=${duplicate.match.reason}`,
        `overlap=${duplicate.match.overlapCoefficient}`
      ].join(": ");
      appendStage3JobEvent(completedArtifact.jobId, "warn", message);
      markCopscopesSourceReel({
        reelId: copscopesSourceReelId,
        status: "skipped",
        chatId: chat.id,
        stage3JobId: completedArtifact.jobId,
        error: message
      });
    }
  }
  const completion = completeRenderExportAndMaybeQueue({
    workspaceId: initialJob.workspaceId,
    channelId: chat.channelId,
    chatId: chat.id,
    chatTitle: chat.title,
    stage3JobId: completedArtifact.jobId,
    artifactFileName: completedArtifact.artifactFileName,
    artifactFilePath: durableArtifact.filePath,
    artifactMimeType: completedArtifact.artifactMimeType,
    artifactSizeBytes: durableArtifact.sizeBytes,
    renderTitle: payload.renderTitle?.trim() || null,
    sourceUrl: payload.sourceUrl?.trim() || chat.url,
    snapshotJson: JSON.stringify(payload.snapshot ?? null),
    createdByUserId: initialJob.userId,
    stage2Result: (stage2Result ?? null) as Stage2Response | null,
    publishAfterRender
  });
  if (copscopesSourceReelId && (await isCopscopesChannel(chat.channelId))) {
    const publication = completion.publication;
    const publicationQueued = Boolean(
      publication &&
        publication.status !== "failed" &&
        publication.status !== "canceled"
    );
    if (publicationQueued) {
      markCopscopesSourceReel({
        reelId: copscopesSourceReelId,
        status: "consumed",
        chatId: chat.id,
        stage3JobId: completedArtifact.jobId,
        error: null
      });
    } else if (publishAfterRender !== false) {
      markCopscopesSourceReel({
        reelId: copscopesSourceReelId,
        status: "needs_review",
        chatId: chat.id,
        stage3JobId: completedArtifact.jobId,
        error: "copscopes_publication_not_queued_after_render"
      });
    }
  }

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

function startClaimedJob(job: Stage3JobRecord): void {
  const state = getStage3RuntimeState();
  if (state.activeJobs.has(job.id)) {
    return;
  }

  state.activeJobs.set(job.id, job.kind);
  void Promise.resolve()
    .then(() => runClaimedHostJobWithWatchdog(job))
    .finally(() => {
      const latestState = getStage3RuntimeState();
      latestState.activeJobs.delete(job.id);
      scheduleStage3JobProcessing();
    });
}

function runSchedulerPass(): void {
  sweepHostStage3Jobs();
  const state = getStage3RuntimeState();
  for (const lane of ["interactive", "render"] as Stage3HostJobLane[]) {
    const limit = getStage3HostLaneConcurrencyLimit(lane);
    while (countActiveHostLaneJobs(state, lane) < limit) {
      const claimed = claimNextQueuedStage3Job({ kinds: getStage3HostLaneKinds(lane) });
      if (!claimed) {
        break;
      }
      startClaimedJob(claimed);
    }
  }
}

export function scheduleStage3JobProcessing(): void {
  if (!isHostStage3ExecutionAllowed()) {
    return;
  }
  ensureStage3JobRuntime();
  sweepHostStage3Jobs();
  const state = getStage3RuntimeState();
  if (state.schedulerPromise) {
    return;
  }
  state.schedulerPromise = Promise.resolve()
    .then(() => {
      runSchedulerPass();
    })
    .finally(() => {
      const latestState = getStage3RuntimeState();
      latestState.schedulerPromise = null;
      if (hasOpenHostLaneCapacityForQueuedJobs(latestState)) {
        scheduleStage3JobProcessing();
      }
    });
}

export function enqueueAndScheduleStage3Job(input: EnqueueJobInput): Stage3JobRecord {
  if (input.executionTarget === "host") {
    ensureStage3JobRuntime();
  }
  const { job, outcome } = enqueueStage3JobWithOutcome(input);
  if (outcome === "created" || outcome === "requeued") {
    logStage3Runtime("job_enqueue", {
      jobId: job.id,
      jobType: job.kind,
      status: job.status,
      executionTarget: job.executionTarget,
      dedupeKey: job.dedupeKey,
      enqueueOutcome: outcome,
      payloadBytes: Buffer.byteLength(job.payloadJson, "utf8"),
      memoryMb: memorySnapshotMb()
    });
  }
  if ((outcome === "created" || outcome === "requeued") && job.executionTarget === "host") {
    scheduleStage3JobProcessing();
  }
  return job;
}

export function getStage3JobOrThrow(jobId: string): Stage3JobRecord {
  ensureStage3JobRuntime();
  sweepHostStage3Jobs();
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
