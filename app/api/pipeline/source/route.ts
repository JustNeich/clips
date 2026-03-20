import { createOrGetChatByUrl, getChatById } from "../../../../lib/chat-history";
import { requireAuth, requireChannelOperate, requireChannelVisibility } from "../../../../lib/auth/guards";
import { findActiveStage2RunForChat } from "../../../../lib/stage2-progress-store";
import {
  enqueueAndScheduleSourceJob,
  getActiveSourceJobForChat,
  getSourceJobOrThrow,
  scheduleSourceJobProcessing
} from "../../../../lib/source-job-runtime";
import { listSourceJobsForChat, SourceJobRecord, SourceJobTrigger } from "../../../../lib/source-job-store";
import type { SourceJobDetail, Stage2RunSummary } from "../../../components/types";
import { getRuntimeCapabilities } from "../../../../lib/runtime-capabilities";
import { isSupportedUrl, normalizeSupportedUrl } from "../../../../lib/ytdlp";
import { getWorkspaceCodexIntegration } from "../../../../lib/team-store";

export const runtime = "nodejs";

function serializeStage2RunSummary(run: {
  runId: string;
  chatId: string | null;
  channelId: string | null;
  sourceUrl: string;
  userInstruction: string | null;
  mode: Stage2RunSummary["mode"];
  baseRunId: string | null;
  status: Stage2RunSummary["status"];
  snapshot: Stage2RunSummary["progress"];
  errorMessage: string | null;
  resultData: unknown | null;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  finishedAt: string | null;
}): Stage2RunSummary {
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
    finishedAt: run.finishedAt
  };
}

function serializeSourceJobSummary(job: SourceJobRecord) {
  return {
    jobId: job.jobId,
    chatId: job.chatId,
    channelId: job.channelId,
    sourceUrl: job.sourceUrl,
    status: job.status,
    progress: job.progress,
    errorMessage: job.errorMessage ?? job.progress.error ?? null,
    hasResult: Boolean(job.resultData),
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt
  };
}

function serializeSourceJobDetail(job: SourceJobRecord): SourceJobDetail {
  return {
    ...serializeSourceJobSummary(job),
    result: job.resultData
  };
}

async function requireSourceJobVisibility(
  auth: Awaited<ReturnType<typeof requireAuth>>,
  job: SourceJobRecord
): Promise<void> {
  if (job.workspaceId !== auth.workspace.id) {
    throw new Response(JSON.stringify({ error: "Source job not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }
  await requireChannelVisibility(auth, job.channelId);
}

function normalizeTrigger(value: unknown): SourceJobTrigger {
  return value === "comments" ? "comments" : "fetch";
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId")?.trim();
  const chatId = url.searchParams.get("chatId")?.trim();

  if (!jobId && !chatId) {
    return Response.json({ error: "Передайте jobId или chatId." }, { status: 400 });
  }

  try {
    const auth = await requireAuth();
    scheduleSourceJobProcessing();

    if (jobId) {
      const job = getSourceJobOrThrow(jobId);
      await requireSourceJobVisibility(auth, job);
      return Response.json({ job: serializeSourceJobDetail(job) }, { status: 200 });
    }

    const chat = await getChatById(chatId as string);
    if (!chat || chat.workspaceId !== auth.workspace.id) {
      return Response.json({ error: "Chat not found." }, { status: 404 });
    }
    await requireChannelVisibility(auth, chat.channelId);
    const jobs = listSourceJobsForChat(chat.id, auth.workspace.id).map(serializeSourceJobSummary);
    return Response.json({ jobs }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить source job." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | {
        url?: string;
        chatId?: string;
        channelId?: string;
        autoRunStage2?: boolean;
        trigger?: SourceJobTrigger;
      }
    | null;

  try {
    const auth = await requireAuth();
    const chatId = body?.chatId?.trim();
    const incomingUrl = body?.url?.trim();
    let chat = chatId ? await getChatById(chatId) : null;
    let channelName = "";
    let channelUsername = "";

    if (chat) {
      const operate = await requireChannelOperate(auth, chat.channelId);
      channelName = operate.channel.name;
      channelUsername = operate.channel.username;
    } else {
      const channelId = body?.channelId?.trim();
      if (!channelId) {
        return Response.json({ error: "Передайте channelId." }, { status: 400 });
      }
      const operate = await requireChannelOperate(auth, channelId);
      channelName = operate.channel.name;
      channelUsername = operate.channel.username;
      if (!incomingUrl) {
        return Response.json({ error: "Передайте URL в теле запроса." }, { status: 400 });
      }
      const normalizedUrl = normalizeSupportedUrl(incomingUrl);
      if (!isSupportedUrl(normalizedUrl)) {
        return Response.json(
          { error: "Поддерживаются ссылки на YouTube Shorts, Instagram Reels и Facebook Reels." },
          { status: 400 }
        );
      }
      chat = await createOrGetChatByUrl(normalizedUrl, channelId);
    }

    if (!chat || chat.workspaceId !== auth.workspace.id) {
      return Response.json({ error: "Chat not found." }, { status: 404 });
    }

    const sourceUrl = normalizeSupportedUrl(incomingUrl || chat.url || "");
    if (!sourceUrl || !isSupportedUrl(sourceUrl)) {
      return Response.json(
        { error: "Поддерживаются ссылки на YouTube Shorts, Instagram Reels и Facebook Reels." },
        { status: 400 }
      );
    }

    const activeSourceJob = getActiveSourceJobForChat(chat.id, auth.workspace.id);
    if (activeSourceJob) {
      return Response.json(
        {
          error: "source_job_already_active",
          chat,
          job: serializeSourceJobDetail(activeSourceJob)
        },
        { status: 409 }
      );
    }

    const activeStage2Run = findActiveStage2RunForChat(chat.id, auth.workspace.id);
    if (activeStage2Run) {
      return Response.json(
        {
          error: "stage2_run_already_active",
          chat,
          run: serializeStage2RunSummary(activeStage2Run)
        },
        { status: 409 }
      );
    }

    const capabilities = await getRuntimeCapabilities();
    const autoRunStage2Requested = body?.autoRunStage2 === true;
    const integration = getWorkspaceCodexIntegration(auth.workspace.id);
    const autoRunStage2 =
      autoRunStage2Requested &&
      Boolean(integration?.status === "connected" && integration.codexHomePath) &&
      capabilities.features.stage2;

    const job = enqueueAndScheduleSourceJob({
      workspaceId: auth.workspace.id,
      creatorUserId: auth.user.id,
      request: {
        sourceUrl,
        autoRunStage2,
        trigger: normalizeTrigger(body?.trigger),
        chat: {
          id: chat.id,
          channelId: chat.channelId
        },
        channel: {
          id: chat.channelId,
          name: channelName,
          username: channelUsername
        }
      }
    });

    return Response.json({ chat, job: serializeSourceJobDetail(job) }, { status: 202 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось запустить получение источника." },
      { status: 500 }
    );
  }
}
