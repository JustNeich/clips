import type { CommentsPayload, SourceJobResult, Stage2Response } from "../app/components/types";
import { appendChatEvent, getChatById, getChannelById } from "./chat-history";
import { enqueueAndScheduleStage2Run } from "./stage2-run-runtime";
import { findActiveStage2RunForChat } from "./stage2-progress-store";
import { buildStage2RunChannelSnapshot } from "./stage2-run-channel-snapshot";
import { buildStage2RunRequestSnapshot } from "./stage2-run-request";
import { isUploadedSourceUrl } from "./uploaded-source";
import {
  claimQueuedSourceJob,
  claimNextQueuedSourceJob,
  createSourceJob,
  finalizeSourceJobFailure,
  finalizeSourceJobSuccess,
  findActiveSourceJobForChat,
  getSourceJob,
  hasQueuedSourceJobs,
  interruptRunningSourceJobs,
  listSourceJobsForChat,
  markSourceJobStageRunning,
  markSourceJobRetryScheduled,
  recoverInterruptedSourceJobs,
  SourceJobRecord,
  SourceJobRequest
} from "./source-job-store";
import { fetchCommentsForUrl } from "./source-comments";
import { ensureSourceMediaCached } from "./source-media-cache";
import { runSourceDecomposition } from "./source-decomposition-runtime";
import { getSourceDownloadErrorContext } from "./source-acquisition";
import { getWorkspaceCodexIntegration } from "./team-store";
import { clampHostedConcurrencyLimit, isHostedRenderRuntime } from "./hosted-resource-budget";

type SourceRuntimeState = {
  initialized: boolean;
  activeJobs: Set<string>;
  activeJobPromises: Map<string, Promise<void>>;
  schedulerPromise: Promise<void> | null;
};

type SourceRuntimeGlobal = typeof globalThis & {
  __clipsSourceRuntimeState__?: SourceRuntimeState;
  __clipsSourceJobProcessorOverride__?: SourceJobProcessor | null;
};

export type SourceJobProcessor = (job: SourceJobRecord) => Promise<SourceJobResult>;

function getRuntimeState(): SourceRuntimeState {
  const scope = globalThis as SourceRuntimeGlobal;
  if (!scope.__clipsSourceRuntimeState__) {
    scope.__clipsSourceRuntimeState__ = {
      initialized: false,
      activeJobs: new Set<string>(),
      activeJobPromises: new Map<string, Promise<void>>(),
      schedulerPromise: null
    };
  }
  if (!scope.__clipsSourceRuntimeState__.activeJobPromises) {
    scope.__clipsSourceRuntimeState__.activeJobPromises = new Map<string, Promise<void>>();
  }
  return scope.__clipsSourceRuntimeState__;
}

function getProcessor(): SourceJobProcessor {
  const scope = globalThis as SourceRuntimeGlobal;
  return scope.__clipsSourceJobProcessorOverride__ ?? processSourceJob;
}

export function setSourceJobProcessorForTests(processor: SourceJobProcessor | null): void {
  (globalThis as SourceRuntimeGlobal).__clipsSourceJobProcessorOverride__ = processor;
}

function logSourceRuntime(event: string, payload: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      scope: "source",
      event,
      at: new Date().toISOString(),
      ...payload
    })
  );
}

function getSourceConcurrencyLimit(): number {
  const raw = Number.parseInt(process.env.SOURCE_MAX_CONCURRENT_JOBS ?? "", 10);
  if (!Number.isFinite(raw) || raw <= 0) {
    return clampHostedConcurrencyLimit(2);
  }
  return clampHostedConcurrencyLimit(Math.max(1, Math.min(6, Math.floor(raw))));
}

function ensureSourceRuntime(): void {
  const state = getRuntimeState();
  if (state.initialized) {
    return;
  }
  state.initialized = true;
  if (isHostedRenderRuntime()) {
    const interrupted = interruptRunningSourceJobs(
      "Source job stopped after process restart on hosted runtime. Start it again manually."
    );
    if (interrupted > 0) {
      logSourceRuntime("bootstrap_interrupt_jobs", { count: interrupted });
    }
    return;
  }
  const recovered = recoverInterruptedSourceJobs();
  if (recovered > 0) {
    logSourceRuntime("bootstrap_requeue_jobs", { count: recovered });
  }
}

async function appendSourceSuccessEvent(result: SourceJobResult, commentsPayload: CommentsPayload | null): Promise<void> {
  if (commentsPayload) {
    await appendChatEvent(result.chatId, {
      role: "assistant",
      type: "comments",
      text: `Комментарии загружены: ${commentsPayload.totalComments}`,
      data: commentsPayload
    });
    return;
  }

  await appendChatEvent(result.chatId, {
    role: "assistant",
    type: "note",
    text: result.commentsError
      ? `Источник подготовлен. Комментарии недоступны: ${result.commentsError}`
      : "Источник подготовлен. Продолжаем без комментариев.",
    data: {
      stage1Ready: true,
      sourceCacheKey: result.sourceCacheKey ?? null,
      sourceCacheState: result.sourceCacheState ?? null,
      downloadProvider: result.downloadProvider ?? null,
      downloadFallbackUsed: result.downloadFallbackUsed ?? false,
      commentsAvailable: false,
      commentsError: result.commentsError
    }
  });
}

async function appendSourceFailureEvent(job: SourceJobRecord, message: string): Promise<void> {
  await appendChatEvent(job.chatId, {
    role: "assistant",
    type: "error",
    text: message,
    data: {
      kind: "source-job-error",
      jobId: job.jobId
    }
  });
}

async function maybeEnqueueStage2(job: SourceJobRecord): Promise<string | null> {
  if (!job.request.autoRunStage2) {
    return null;
  }
  if (findActiveStage2RunForChat(job.chatId, job.workspaceId)) {
    return null;
  }

  const integration = getWorkspaceCodexIntegration(job.workspaceId);
  if (!integration || integration.status !== "connected" || !integration.codexHomePath) {
    return null;
  }

  const chat = await getChatById(job.chatId);
  const channel = chat ? await getChannelById(chat.channelId) : null;
  if (!chat || !channel) {
    return null;
  }

  const run = enqueueAndScheduleStage2Run({
    workspaceId: job.workspaceId,
    creatorUserId: job.creatorUserId ?? integration.ownerUserId,
    chatId: chat.id,
    request: buildStage2RunRequestSnapshot({
      sourceUrl: chat.url,
      userInstruction: null,
      mode: "auto",
      channel: buildStage2RunChannelSnapshot(channel, { workspaceId: job.workspaceId })
    })
  });
  return run.runId;
}

export async function processSourceJob(job: SourceJobRecord): Promise<SourceJobResult> {
  markSourceJobStageRunning(job.jobId, "prepare", "Готовим чат и источник.");

  const chat = await getChatById(job.chatId);
  if (!chat) {
    throw new Error("Chat not found for source job.");
  }

  markSourceJobStageRunning(
    job.jobId,
    "prepare",
    isUploadedSourceUrl(job.sourceUrl)
      ? "Проверяем загруженный mp4 и фиксируем его в source cache."
      : "Скачиваем и кэшируем исходное видео."
  );
  const cachedSource = await ensureSourceMediaCached(job.sourceUrl, {
    localWorkerFallback: job.creatorUserId
      ? {
          workspaceId: job.workspaceId,
          userId: job.creatorUserId
        }
      : null,
    onRetryScheduled: ({ attempt, maxAttempts, retryAt, providerErrorSummary }) => {
      markSourceJobRetryScheduled(job.jobId, {
        detail: "Visolix временно недоступен. Повторяем через 5 с.",
        attempt,
        maxAttempts,
        nextRetryAt: retryAt,
        retryEligible: providerErrorSummary.primaryRetryEligible,
        providerErrorSummary
      });
    }
  });

  let commentsPayload: CommentsPayload | null = null;
  let commentsAvailable = false;
  let commentsError: string | null = null;

  markSourceJobStageRunning(job.jobId, "comments", "Пробуем загрузить комментарии.");
  const commentsResolution = await fetchCommentsForUrl(job.sourceUrl);
  if (commentsResolution.payload) {
    commentsPayload = commentsResolution.payload;
    commentsAvailable = true;
  } else {
    commentsError = commentsResolution.error ?? "Не удалось получить комментарии.";
  }

  // AGENT-ONLY: produce the reusable Stage-1 decomposition artifact. Guarded by
  // the agentDecomposition flag, which is never set by the human manual flow, so
  // this is a no-op for every human source job. Best-effort: a decomposition
  // failure must not fail the source job or alter its result.
  if (job.request.agentDecomposition) {
    markSourceJobStageRunning(job.jobId, "comments", "Готовим агентскую декомпозицию источника.");
    try {
      await runSourceDecomposition({
        workspaceId: job.workspaceId,
        channelId: job.channelId,
        chatId: job.chatId,
        sourceKey: cachedSource.sourceKey,
        sourceUrl: job.sourceUrl,
        sourcePath: cachedSource.sourcePath,
        commentsPayload
      });
    } catch (error) {
      logSourceRuntime("agent_decomposition_failed", {
        jobId: job.jobId,
        chatId: job.chatId,
        message: error instanceof Error ? error.message : "decomposition failed"
      });
    }
  }

  let autoStage2RunId: string | null = null;
  if (job.request.autoRunStage2) {
    markSourceJobStageRunning(job.jobId, "stage2", "Проверяем автостарт второго этапа.");
    autoStage2RunId = await maybeEnqueueStage2(job);
  }

  const result: SourceJobResult = {
    chatId: job.chatId,
    channelId: job.channelId,
    sourceUrl: job.sourceUrl,
    stage1Ready: true,
    title: commentsPayload?.title ?? cachedSource.title ?? chat.title ?? null,
    videoFileName: cachedSource.fileName,
    videoSizeBytes: cachedSource.videoSizeBytes,
    sourceCacheKey: cachedSource.sourceKey,
    sourceCacheState: cachedSource.cacheState,
    downloadProvider: cachedSource.downloadProvider,
    primaryProviderError: cachedSource.primaryProviderError,
    downloadFallbackUsed: cachedSource.downloadFallbackUsed,
    providerErrorSummary: cachedSource.providerErrorSummary,
    commentsAvailable,
    commentsError,
    commentsPayload,
    commentsAcquisitionStatus: commentsResolution.status,
    commentsAcquisitionProvider: commentsResolution.provider,
    commentsAcquisitionNote: commentsResolution.note,
    autoStage2RunId
  };

  await appendSourceSuccessEvent(result, commentsPayload);
  return result;
}

async function executeJob(job: SourceJobRecord): Promise<void> {
  logSourceRuntime("job_start", {
    jobId: job.jobId,
    chatId: job.chatId,
    trigger: job.request.trigger
  });

  try {
    const result = await getProcessor()(job);
    finalizeSourceJobSuccess(job.jobId, result);
    logSourceRuntime("job_complete", {
      jobId: job.jobId,
      chatId: job.chatId,
      autoStage2RunId: result.autoStage2RunId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Source job failed.";
    const errorContext = getSourceDownloadErrorContext(error);
    try {
      await appendSourceFailureEvent(job, message);
    } catch {
      // Keep durable failure even if chat event append also fails.
    }
    finalizeSourceJobFailure(job.jobId, message, {
      attempt: errorContext?.attempt ?? null,
      maxAttempts: errorContext?.maxAttempts ?? null,
      retryEligible: errorContext?.providerErrorSummary.primaryRetryEligible ?? false,
      providerErrorSummary: errorContext?.providerErrorSummary ?? null
    });
    logSourceRuntime("job_fail", {
      jobId: job.jobId,
      chatId: job.chatId,
      message
    });
  }
}

function startClaimedJob(job: SourceJobRecord): Promise<void> | null {
  const state = getRuntimeState();
  const existing = state.activeJobPromises.get(job.jobId);
  if (existing) {
    return existing;
  }
  if (state.activeJobs.has(job.jobId)) {
    return null;
  }

  state.activeJobs.add(job.jobId);
  const task = executeJob(job).finally(() => {
    state.activeJobs.delete(job.jobId);
    state.activeJobPromises.delete(job.jobId);
    scheduleSourceJobProcessing();
  });
  state.activeJobPromises.set(job.jobId, task);
  return task;
}

function runSchedulerPass(): void {
  const state = getRuntimeState();
  const limit = getSourceConcurrencyLimit();
  while (state.activeJobs.size < limit) {
    const claimed = claimNextQueuedSourceJob();
    if (!claimed) {
      break;
    }
    startClaimedJob(claimed);
  }
}

export function scheduleSourceJobProcessing(): void {
  ensureSourceRuntime();
  const state = getRuntimeState();
  if (state.schedulerPromise) {
    return;
  }

  state.schedulerPromise = Promise.resolve()
    .then(() => {
      runSchedulerPass();
    })
    .finally(() => {
      const latest = getRuntimeState();
      latest.schedulerPromise = null;
      if (latest.activeJobs.size < getSourceConcurrencyLimit() && hasQueuedSourceJobs()) {
        scheduleSourceJobProcessing();
      }
    });
}

export function enqueueAndScheduleSourceJob(input: {
  workspaceId: string;
  creatorUserId: string;
  request: SourceJobRequest;
}): SourceJobRecord {
  const job = createSourceJob(input);
  logSourceRuntime("job_enqueue", {
    jobId: job.jobId,
    chatId: job.chatId,
    trigger: job.request.trigger
  });
  scheduleSourceJobProcessing();
  return job;
}

function isSameSourceJobRequest(
  job: SourceJobRecord,
  input: Parameters<typeof enqueueAndScheduleSourceJob>[0]
): boolean {
  return job.workspaceId === input.workspaceId &&
    job.creatorUserId === input.creatorUserId &&
    job.channelId === input.request.channel.id &&
    job.chatId === input.request.chat.id &&
    job.sourceUrl === input.request.sourceUrl &&
    job.request.trigger === input.request.trigger &&
    job.request.autoRunStage2 === input.request.autoRunStage2 &&
    job.request.agentDecomposition === input.request.agentDecomposition;
}

export async function runSourceJobInline(jobId: string): Promise<SourceJobRecord> {
  ensureSourceRuntime();
  while (true) {
    const job = getSourceJob(jobId);
    if (!job) {
      throw new Error("Source job not found.");
    }
    if (job.status === "completed" || job.status === "failed") {
      return job;
    }

    const state = getRuntimeState();
    const activeTask = state.activeJobPromises.get(jobId);
    if (activeTask) {
      await activeTask;
      continue;
    }
    if (job.status === "running") {
      throw new Error(
        "Source job is already running outside this runtime; refusing duplicate inline execution."
      );
    }

    if (state.activeJobs.size >= getSourceConcurrencyLimit()) {
      const tasks = [...state.activeJobPromises.values()];
      if (tasks.length === 0) {
        throw new Error("Source runtime has no awaitable capacity owner for an active job.");
      }
      await Promise.race(tasks.map((task) => task.catch(() => undefined)));
      continue;
    }

    const claimed = claimQueuedSourceJob(jobId);
    if (!claimed) {
      continue;
    }
    const task = startClaimedJob(claimed);
    if (!task) {
      throw new Error("Source job was claimed without an awaitable runtime owner.");
    }
    await task;
  }
}

export async function enqueueAndRunSourceJob(input: {
  workspaceId: string;
  creatorUserId: string;
  request: SourceJobRequest;
}): Promise<SourceJobRecord> {
  ensureSourceRuntime();
  const reusable = listSourceJobsForChat(
    input.request.chat.id,
    input.workspaceId,
    20
  ).find((job) => job.status !== "failed" && isSameSourceJobRequest(job, input));
  const job = reusable ?? createSourceJob(input);
  logSourceRuntime(reusable ? "job_resume_inline" : "job_enqueue_inline", {
    jobId: job.jobId,
    chatId: job.chatId,
    trigger: job.request.trigger,
    status: job.status
  });
  return runSourceJobInline(job.jobId);
}

export function getSourceJobOrThrow(jobId: string): SourceJobRecord {
  ensureSourceRuntime();
  scheduleSourceJobProcessing();
  const job = getSourceJob(jobId);
  if (!job) {
    throw new Error("Source job not found.");
  }
  return job;
}

export function getActiveSourceJobForChat(
  chatId: string,
  workspaceId: string
): SourceJobRecord | null {
  ensureSourceRuntime();
  scheduleSourceJobProcessing();
  return findActiveSourceJobForChat(chatId, workspaceId);
}
