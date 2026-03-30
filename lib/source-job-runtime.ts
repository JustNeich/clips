import type { CommentsPayload, SourceJobResult, Stage2Response } from "../app/components/types";
import { appendChatEvent, getChatById, getChannelById } from "./chat-history";
import { enqueueAndScheduleStage2Run } from "./stage2-run-runtime";
import { findActiveStage2RunForChat } from "./stage2-progress-store";
import { buildStage2RunRequestSnapshot } from "./stage2-run-request";
import {
  listChannelEditorialPassiveSelectionEvents,
  listChannelEditorialRatingEvents
} from "./channel-editorial-feedback-store";
import { buildStage2EditorialMemorySummary } from "./stage2-channel-learning";
import {
  claimNextQueuedSourceJob,
  createSourceJob,
  finalizeSourceJobFailure,
  finalizeSourceJobSuccess,
  findActiveSourceJobForChat,
  getSourceJob,
  hasQueuedSourceJobs,
  markSourceJobStageRunning,
  recoverInterruptedSourceJobs,
  SourceJobRecord,
  SourceJobRequest
} from "./source-job-store";
import { fetchCommentsForUrl } from "./source-comments";
import { ensureSourceMediaCached } from "./source-media-cache";
import { getWorkspaceCodexIntegration } from "./team-store";

type SourceRuntimeState = {
  initialized: boolean;
  activeJobs: Set<string>;
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
      schedulerPromise: null
    };
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
    return 2;
  }
  return Math.max(1, Math.min(6, Math.floor(raw)));
}

function ensureSourceRuntime(): void {
  const state = getRuntimeState();
  if (state.initialized) {
    return;
  }
  state.initialized = true;
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
    text: result.sourceMediaReady
      ? result.commentsError
        ? `Источник проверен. Комментарии недоступны: ${result.commentsError}`
        : "Источник проверен. Продолжаем без комментариев."
      : result.commentsError
        ? `Комментарии недоступны: ${result.commentsError}`
        : "Комментарии для этого источника недоступны.",
    data: {
      stage1Ready: true,
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
      channel: {
        id: channel.id,
        name: channel.name,
        username: channel.username,
        stage2ExamplesConfig: channel.stage2ExamplesConfig,
        stage2HardConstraints: channel.stage2HardConstraints,
        stage2StyleProfile: channel.stage2StyleProfile,
        editorialMemory: buildStage2EditorialMemorySummary({
          profile: channel.stage2StyleProfile,
          feedbackEvents: [
            ...listChannelEditorialRatingEvents(channel.id, 30),
            ...listChannelEditorialPassiveSelectionEvents(channel.id, 12)
          ]
        })
      }
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

  let sourceMediaProvider: SourceJobResult["sourceMediaProvider"] = null;
  let sourceMediaTitle: string | null = null;
  let sourceMediaReady = false;

  if (job.request.trigger === "fetch") {
    markSourceJobStageRunning(job.jobId, "prepare", "Проверяем и кэшируем исходное видео.");
    const cachedSource = await ensureSourceMediaCached(job.sourceUrl);
    sourceMediaProvider = cachedSource.provider;
    sourceMediaTitle = cachedSource.title;
    sourceMediaReady = true;
  }

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
    title: commentsPayload?.title ?? sourceMediaTitle ?? chat.title ?? null,
    sourceMediaReady,
    sourceMediaProvider,
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
    try {
      await appendSourceFailureEvent(job, message);
    } catch {
      // Keep durable failure even if chat event append also fails.
    }
    finalizeSourceJobFailure(job.jobId, message);
    logSourceRuntime("job_fail", {
      jobId: job.jobId,
      chatId: job.chatId,
      message
    });
  }
}

function startClaimedJob(job: SourceJobRecord): void {
  const state = getRuntimeState();
  if (state.activeJobs.has(job.jobId)) {
    return;
  }

  state.activeJobs.add(job.jobId);
  void executeJob(job).finally(() => {
    state.activeJobs.delete(job.jobId);
    scheduleSourceJobProcessing();
  });
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
