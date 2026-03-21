import type {
  ChatDraft,
  ChatEvent,
  ChatRenderExportRef,
  ChatThread,
  CommentItem,
  CommentsPayload,
  SourceJobDetail,
  SourceJobResult,
  Stage2Response,
  Stage2RunDetail,
  Stage3Version
} from "../app/components/types";
import { getChatById, getChatDraft, getChannelById } from "./chat-history";
import { findLatestRenderExport } from "./chat-workflow";
import { findLatestStage3AgentSessionRef, buildLegacyTimelineEntries, type Stage3AgentSessionRef } from "./stage3-legacy-bridge";
import { normalizeStage2ProgressSnapshot } from "./stage2-pipeline";
import { buildStage2ToStage3HandoffSummary, type Stage2ToStage3HandoffSummary } from "./stage2-stage3-handoff";
import {
  getWorkspaceStage2ExamplesCorpusJson,
  getWorkspaceStage2HardConstraints,
  getWorkspaceStage2PromptConfig,
  type WorkspaceRecord
} from "./team-store";
import { listSourceJobsForChat, type SourceJobRecord } from "./source-job-store";
import { listStage2RunsForChat, type Stage2RunRecord } from "./stage2-progress-store";
import { MAX_EXPORTED_COMMENTS, TRACE_EXPORT_VERSION } from "./chat-trace-export-shared";

export type ChatTraceExportComments = {
  available: boolean;
  totalComments: number;
  includedCount: number;
  truncated: boolean;
  provider: Stage2Response["source"]["commentsAcquisitionProvider"] | null;
  status: Stage2Response["source"]["commentsAcquisitionStatus"] | null;
  note: string | null;
  fallbackUsed: boolean;
  error: string | null;
  items: CommentItem[];
};

export type ChatTraceExport = {
  version: string;
  exportedAt: string;
  workspace: {
    id: string;
    name: string;
    slug: string;
  };
  channel: {
    id: string;
    name: string;
    username: string;
    stage2ExamplesConfig: unknown;
    stage2HardConstraints: unknown;
    templateId: string;
  };
  chat: {
    id: string;
    title: string;
    url: string;
    createdAt: string;
    updatedAt: string;
  };
  source: {
    url: string;
    title: string | null;
    downloadProvider: Stage2Response["source"]["downloadProvider"] | null;
    commentsAvailable: boolean;
    commentsError: string | null;
    totalComments: number;
    includedComments: number;
    commentsAcquisitionStatus: Stage2Response["source"]["commentsAcquisitionStatus"] | null;
    commentsAcquisitionProvider: Stage2Response["source"]["commentsAcquisitionProvider"] | null;
    commentsAcquisitionNote: string | null;
    commentsFallbackUsed: boolean;
    activeJobId: string | null;
    latestCompletedJobId: string | null;
  };
  comments: ChatTraceExportComments;
  sourceJobs: Array<SourceJobDetail & { request: SourceJobRecord["request"] }>;
  stage2: {
    selectedRunId: string | null;
    currentResult: Stage2Response | null;
    currentProgress: Stage2Response["progress"] | null;
    analysis: Stage2Response["diagnostics"] extends infer T
      ? T extends { analysis?: infer U }
        ? U | null
        : null
      : null;
    effectivePrompting: Stage2Response["diagnostics"] extends infer T
      ? T extends { effectivePrompting?: infer U }
        ? U | null
        : null
      : null;
    examples: Stage2Response["diagnostics"] extends infer T
      ? T extends { examples?: infer U }
        ? U | null
        : null
      : null;
    selection: Stage2Response["diagnostics"] extends infer T
      ? T extends { selection?: infer U }
        ? U | null
        : null
      : null;
    runs: Array<Stage2RunDetail & { request: Stage2RunRecord["request"] }>;
    workspaceDefaults: {
      examplesCorpusJson: string;
      hardConstraints: unknown;
      promptConfig: unknown;
    };
  };
  stage3: {
    draft: ChatDraft["stage3"] | null;
    handoff: Stage2ToStage3HandoffSummary;
    latestRenderExport: ChatRenderExportRef | null;
    latestAgentSession: Stage3AgentSessionRef | null;
    legacyVersions: Stage3Version[];
  };
  thread: {
    events: ChatEvent[];
  };
  draft: ChatDraft | null;
};

type BuildChatTraceExportInput = {
  workspace: WorkspaceRecord;
  userId: string;
  chatId: string;
  selectedRunId?: string | null;
};

function sanitizeCommentsPayload(payload: CommentsPayload | null): CommentsPayload | null {
  if (!payload) {
    return null;
  }

  const limitedTopComments = payload.topComments.slice(0, MAX_EXPORTED_COMMENTS);
  return {
    ...payload,
    topComments: limitedTopComments,
    allComments: limitedTopComments
  };
}

function sanitizeStage2ResponseForExport(stage2: Stage2Response | null): Stage2Response | null {
  if (!stage2) {
    return null;
  }

  const limitedTopComments = stage2.source.topComments.slice(0, MAX_EXPORTED_COMMENTS);
  return {
    ...stage2,
    progress:
      stage2.progress !== undefined
        ? normalizeStage2ProgressSnapshot(
            stage2.progress,
            stage2.stage2Run?.runId ?? stage2.stage2Worker?.runId ?? "exported_run",
            stage2.stage2Run?.mode
          )
        : stage2.progress,
    source: {
      ...stage2.source,
      topComments: limitedTopComments,
      allComments: limitedTopComments
    }
  };
}

function sanitizeSourceJobResultForExport(result: SourceJobResult | null): SourceJobResult | null {
  if (!result) {
    return null;
  }

  return {
    ...result,
    commentsPayload: sanitizeCommentsPayload(result.commentsPayload)
  };
}

function sanitizeSourceJobForExport(job: SourceJobRecord): SourceJobDetail & { request: SourceJobRecord["request"] } {
  return {
    jobId: job.jobId,
    chatId: job.chatId,
    channelId: job.channelId,
    sourceUrl: job.sourceUrl,
    status: job.status,
    progress: job.progress,
    errorMessage: job.errorMessage,
    hasResult: Boolean(job.resultData),
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
    request: job.request,
    result: sanitizeSourceJobResultForExport(job.resultData)
  };
}

function sanitizeStage2RunForExport(run: Stage2RunRecord): Stage2RunDetail & { request: Stage2RunRecord["request"] } {
  return {
    runId: run.runId,
    chatId: run.chatId,
    channelId: run.channelId,
    sourceUrl: run.sourceUrl,
    userInstruction: run.userInstruction,
    mode: run.mode,
    baseRunId: run.baseRunId,
    status: run.status,
    progress: run.snapshot,
    errorMessage: run.errorMessage ?? run.snapshot.error ?? null,
    hasResult: Boolean(run.resultData),
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    finishedAt: run.finishedAt,
    request: run.request,
    result: sanitizeStage2ResponseForExport((run.resultData ?? null) as Stage2Response | null)
  };
}

function sanitizeChatEventForExport(event: ChatEvent): ChatEvent {
  if (event.type === "comments") {
    return {
      ...event,
      data: sanitizeCommentsPayload(event.data as CommentsPayload | null)
    };
  }

  if (event.type === "stage2") {
    return {
      ...event,
      data: sanitizeStage2ResponseForExport(event.data as Stage2Response | null)
    };
  }

  return event;
}

function pickSelectedStage2Run(
  runs: Stage2RunRecord[],
  selectedRunId?: string | null
): Stage2RunRecord | null {
  const explicitSelection =
    selectedRunId && selectedRunId.trim()
      ? runs.find((run) => run.runId === selectedRunId.trim()) ?? null
      : null;
  if (explicitSelection) {
    return explicitSelection;
  }

  const activeRun = runs.find((run) => run.status === "queued" || run.status === "running") ?? null;
  if (activeRun) {
    return activeRun;
  }

  const completedRun = runs.find((run) => Boolean(run.resultData)) ?? null;
  if (completedRun) {
    return completedRun;
  }

  return runs[0] ?? null;
}

function buildExportComments(input: {
  latestSourceResult: SourceJobResult | null;
  currentStage2Result: Stage2Response | null;
}): ChatTraceExportComments {
  const sourceComments = sanitizeCommentsPayload(input.latestSourceResult?.commentsPayload ?? null);
  if (sourceComments) {
    return {
      available: true,
      totalComments: sourceComments.totalComments,
      includedCount: sourceComments.topComments.length,
      truncated: sourceComments.totalComments > sourceComments.topComments.length,
      provider: input.latestSourceResult?.commentsAcquisitionProvider ?? null,
      status: input.latestSourceResult?.commentsAcquisitionStatus ?? "primary_success",
      note: input.latestSourceResult?.commentsAcquisitionNote ?? null,
      fallbackUsed: input.latestSourceResult?.commentsAcquisitionStatus === "fallback_success",
      error: input.latestSourceResult?.commentsError ?? null,
      items: sourceComments.topComments
    };
  }

  const stage2Comments = input.currentStage2Result?.source.topComments.slice(0, MAX_EXPORTED_COMMENTS) ?? [];
  const stage2Total = input.currentStage2Result?.source.totalComments ?? 0;
  return {
    available: stage2Comments.length > 0,
    totalComments: stage2Total,
    includedCount: stage2Comments.length,
    truncated: stage2Total > stage2Comments.length,
    provider: input.currentStage2Result?.source.commentsAcquisitionProvider ?? null,
    status: input.currentStage2Result?.source.commentsAcquisitionStatus ?? null,
    note: input.currentStage2Result?.source.commentsAcquisitionNote ?? null,
    fallbackUsed: input.currentStage2Result?.source.commentsAcquisitionStatus === "fallback_success",
    error: input.currentStage2Result?.source.commentsAcquisitionError ?? null,
    items: stage2Comments
  };
}

export async function buildChatTraceExport(
  input: BuildChatTraceExportInput
): Promise<ChatTraceExport | null> {
  const chat = await getChatById(input.chatId);
  if (!chat || chat.workspaceId !== input.workspace.id) {
    return null;
  }

  const channel = await getChannelById(chat.channelId);
  if (!channel || channel.workspaceId !== input.workspace.id) {
    return null;
  }

  const draft = await getChatDraft(chat.id, input.userId);
  const sourceJobs = listSourceJobsForChat(chat.id, input.workspace.id);
  const stage2Runs = listStage2RunsForChat(chat.id, input.workspace.id);
  const selectedRun = pickSelectedStage2Run(stage2Runs, input.selectedRunId);
  const sanitizedCurrentStage2 = sanitizeStage2ResponseForExport(
    (selectedRun?.resultData ?? null) as Stage2Response | null
  );
  const latestSourceJobWithResult = sourceJobs.find((job) => Boolean(job.resultData)) ?? null;
  const exportComments = buildExportComments({
    latestSourceResult: latestSourceJobWithResult?.resultData ?? null,
    currentStage2Result: sanitizedCurrentStage2
  });
  const workspaceDefaults = {
    examplesCorpusJson: getWorkspaceStage2ExamplesCorpusJson(input.workspace.id),
    hardConstraints: getWorkspaceStage2HardConstraints(input.workspace.id),
    promptConfig: getWorkspaceStage2PromptConfig(input.workspace.id)
  };
  const legacyVersions = buildLegacyTimelineEntries(
    chat.events
      .filter((event) => event.type === "note" && event.role === "assistant")
      .map((event) => ({
        id: event.id,
        createdAt: event.createdAt,
        data: event.data
      }))
  );
  const latestLegacyVersion = legacyVersions[legacyVersions.length - 1] ?? null;
  const stage3Handoff = buildStage2ToStage3HandoffSummary({
    stage2: sanitizedCurrentStage2,
    draft,
    latestVersion: latestLegacyVersion
  });
  const exportedAt = new Date().toISOString();

  return {
    version: TRACE_EXPORT_VERSION,
    exportedAt,
    workspace: {
      id: input.workspace.id,
      name: input.workspace.name,
      slug: input.workspace.slug
    },
    channel: {
      id: channel.id,
      name: channel.name,
      username: channel.username,
      stage2ExamplesConfig: channel.stage2ExamplesConfig,
      stage2HardConstraints: channel.stage2HardConstraints,
      templateId: channel.templateId
    },
    chat: {
      id: chat.id,
      title: chat.title,
      url: chat.url,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt
    },
    source: {
      url: chat.url,
      title:
        latestSourceJobWithResult?.resultData?.title ??
        sanitizedCurrentStage2?.source.title ??
        (chat.title !== chat.url ? chat.title : null),
      downloadProvider: sanitizedCurrentStage2?.source.downloadProvider ?? null,
      commentsAvailable: exportComments.available,
      commentsError: latestSourceJobWithResult?.resultData?.commentsError ?? null,
      totalComments: exportComments.totalComments,
      includedComments: exportComments.includedCount,
      commentsAcquisitionStatus:
        latestSourceJobWithResult?.resultData?.commentsAcquisitionStatus ??
        sanitizedCurrentStage2?.source.commentsAcquisitionStatus ??
        null,
      commentsAcquisitionProvider:
        latestSourceJobWithResult?.resultData?.commentsAcquisitionProvider ??
        sanitizedCurrentStage2?.source.commentsAcquisitionProvider ??
        null,
      commentsAcquisitionNote:
        latestSourceJobWithResult?.resultData?.commentsAcquisitionNote ??
        sanitizedCurrentStage2?.source.commentsAcquisitionNote ??
        null,
      commentsFallbackUsed:
        (latestSourceJobWithResult?.resultData?.commentsAcquisitionStatus ??
          sanitizedCurrentStage2?.source.commentsAcquisitionStatus ??
          null) === "fallback_success",
      activeJobId: sourceJobs.find((job) => job.status === "queued" || job.status === "running")?.jobId ?? null,
      latestCompletedJobId: latestSourceJobWithResult?.jobId ?? null
    },
    comments: exportComments,
    sourceJobs: sourceJobs.map(sanitizeSourceJobForExport),
    stage2: {
      selectedRunId: selectedRun?.runId ?? null,
      currentResult: sanitizedCurrentStage2,
      currentProgress: sanitizedCurrentStage2?.progress ?? selectedRun?.snapshot ?? null,
      analysis: sanitizedCurrentStage2?.diagnostics?.analysis ?? null,
      effectivePrompting: sanitizedCurrentStage2?.diagnostics?.effectivePrompting ?? null,
      examples: sanitizedCurrentStage2?.diagnostics?.examples ?? null,
      selection: sanitizedCurrentStage2?.diagnostics?.selection ?? null,
      runs: stage2Runs.map(sanitizeStage2RunForExport),
      workspaceDefaults
    },
    stage3: {
      draft: draft?.stage3 ?? null,
      handoff: stage3Handoff,
      latestRenderExport: findLatestRenderExport(chat.events),
      latestAgentSession: findLatestStage3AgentSessionRef(chat.events),
      legacyVersions
    },
    thread: {
      events: chat.events.map(sanitizeChatEventForExport)
    },
    draft
  };
}
