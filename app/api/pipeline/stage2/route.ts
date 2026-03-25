import { ensureCodexLoggedIn } from "../../../../lib/codex-runner";
import { getChatById, getDefaultChannel } from "../../../../lib/chat-history";
import {
  requireAuth,
  requireChannelOperate,
  requireChannelVisibility,
  requireSharedCodexAvailable
} from "../../../../lib/auth/guards";
import { requireRuntimeTool } from "../../../../lib/runtime-capabilities";
import {
  listStage2RunsForChat,
  findActiveStage2RunForChat,
  getStage2Run,
  Stage2RunMode,
  Stage2RunRecord
} from "../../../../lib/stage2-progress-store";
import {
  enqueueAndScheduleStage2Run,
  getStage2RunOrThrow,
  scheduleStage2RunProcessing
} from "../../../../lib/stage2-run-runtime";
import { buildStage2RunRequestSnapshot } from "../../../../lib/stage2-run-request";
import { getActiveSourceJobForChat } from "../../../../lib/source-job-runtime";
import {
  listChannelEditorialPassiveSelectionEvents,
  listChannelEditorialRatingEvents
} from "../../../../lib/channel-editorial-feedback-store";
import { buildStage2EditorialMemorySummary } from "../../../../lib/stage2-channel-learning";
import type { Stage2Response } from "../../../components/types";
import { isSupportedUrl, normalizeSupportedUrl } from "../../../../lib/ytdlp";
import type { Stage2DebugMode } from "../../../../lib/viral-shorts-worker/types";

export const runtime = "nodejs";

function normalizeMode(value: unknown): Stage2RunMode {
  if (value === "regenerate") {
    return "regenerate";
  }
  return value === "auto" ? "auto" : "manual";
}

function normalizeDebugMode(value: unknown): Stage2DebugMode {
  return value === "raw" ? "raw" : "summary";
}

function serializeStage2RunSummary(run: Stage2RunRecord) {
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

function serializeStage2RunDetail(run: Stage2RunRecord) {
  return {
    ...serializeStage2RunSummary(run),
    result: (run.resultData ?? null) as Stage2Response | null
  };
}

async function requireRunVisibility(
  auth: Awaited<ReturnType<typeof requireAuth>>,
  run: Stage2RunRecord
): Promise<void> {
  if (run.workspaceId !== auth.workspace.id) {
    throw new Response(JSON.stringify({ error: "Run not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }

  const channelId = run.channelId;
  if (channelId) {
    await requireChannelVisibility(auth, channelId);
    return;
  }

  if (run.chatId) {
    const chat = await getChatById(run.chatId);
    if (!chat || chat.workspaceId !== auth.workspace.id) {
      throw new Response(JSON.stringify({ error: "Run not found." }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }
    await requireChannelVisibility(auth, chat.channelId);
  }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const runId = url.searchParams.get("runId")?.trim();
  const chatId = url.searchParams.get("chatId")?.trim();

  if (!runId && !chatId) {
    return Response.json({ error: "Передайте runId или chatId." }, { status: 400 });
  }

  try {
    const auth = await requireAuth();
    scheduleStage2RunProcessing();

    if (runId) {
      const run = getStage2RunOrThrow(runId);
      await requireRunVisibility(auth, run);
      return Response.json(
        {
          run: serializeStage2RunDetail(run),
          progress: run.snapshot
        },
        { status: 200 }
      );
    }

    const chat = await getChatById(chatId as string);
    if (!chat || chat.workspaceId !== auth.workspace.id) {
      return Response.json({ error: "Chat not found." }, { status: 404 });
    }
    await requireChannelVisibility(auth, chat.channelId);
    const runs = listStage2RunsForChat(chat.id, auth.workspace.id).map(serializeStage2RunSummary);
    return Response.json({ runs }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить Stage 2 run." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | {
        url?: string;
        chatId?: string;
        userInstruction?: string;
        mode?: Stage2RunMode;
        baseRunId?: string;
        debugMode?: Stage2DebugMode;
      }
    | null;
  const mode = normalizeMode(body?.mode);
  const chatId = body?.chatId?.trim();
  const chat = chatId ? await getChatById(chatId) : null;
  const requestedBaseRunId = body?.baseRunId?.trim() || null;
  const debugMode = normalizeDebugMode(body?.debugMode);
  const userInstructionRaw = body?.userInstruction?.trim() ?? "";
  const userInstruction = userInstructionRaw ? userInstructionRaw.slice(0, 2000) : null;

  try {
    const auth = await requireAuth();
    const channel =
      chat?.channelId
        ? (await requireChannelOperate(auth, chat.channelId)).channel
        : await getDefaultChannel(auth.workspace.id);
    await requireChannelOperate(auth, channel.id);

    if (mode === "regenerate" && !requestedBaseRunId) {
      return Response.json({ error: "Передайте baseRunId для быстрой перегенерации." }, { status: 400 });
    }
    const baseRun =
      mode === "regenerate" && requestedBaseRunId ? getStage2Run(requestedBaseRunId) : null;
    if (mode === "regenerate" && requestedBaseRunId && !baseRun) {
      return Response.json({ error: "Выбранный base run не найден." }, { status: 404 });
    }
    if (baseRun) {
      await requireRunVisibility(auth, baseRun);
      if (chat?.id && baseRun.chatId && baseRun.chatId !== chat.id) {
        return Response.json(
          { error: "base_run_chat_mismatch", message: "Быстрая перегенерация должна использовать run из текущего чата." },
          { status: 400 }
        );
      }
      if (!baseRun.resultData) {
        return Response.json(
          { error: "base_run_missing_result", message: "Выбранный base run ещё не содержит результата." },
          { status: 409 }
        );
      }
    }

    const rawUrl = body?.url?.trim() || chat?.url?.trim() || baseRun?.sourceUrl?.trim();
    if (!rawUrl) {
      return Response.json({ error: "Передайте URL в теле запроса." }, { status: 400 });
    }
    const sourceUrl = normalizeSupportedUrl(rawUrl);
    if (!isSupportedUrl(sourceUrl)) {
      return Response.json(
        {
          error: "Поддерживаются ссылки на YouTube Shorts, Instagram Reels и Facebook Reels."
        },
        { status: 400 }
      );
    }

    await Promise.all(
      mode === "regenerate"
        ? [requireRuntimeTool("codex")]
        : [requireRuntimeTool("ffmpeg"), requireRuntimeTool("ffprobe"), requireRuntimeTool("codex")]
    );
    const integration = requireSharedCodexAvailable(auth.workspace.id);
    await ensureCodexLoggedIn(integration.codexHomePath as string);

    if (chat?.id) {
      const activeSourceJob = getActiveSourceJobForChat(chat.id, auth.workspace.id);
      if (activeSourceJob) {
        return Response.json(
          {
            error: "source_job_already_active",
            job: {
              jobId: activeSourceJob.jobId,
              chatId: activeSourceJob.chatId,
              channelId: activeSourceJob.channelId,
              sourceUrl: activeSourceJob.sourceUrl,
              status: activeSourceJob.status,
              progress: activeSourceJob.progress,
              errorMessage: activeSourceJob.errorMessage ?? activeSourceJob.progress.error ?? null,
              hasResult: Boolean(activeSourceJob.resultData),
              createdAt: activeSourceJob.createdAt,
              startedAt: activeSourceJob.startedAt,
              updatedAt: activeSourceJob.updatedAt,
              finishedAt: activeSourceJob.finishedAt
            }
          },
          { status: 409 }
        );
      }

      const activeRun = findActiveStage2RunForChat(chat.id, auth.workspace.id);
      if (activeRun) {
        return Response.json(
          {
            error: "stage2_run_already_active",
            run: serializeStage2RunDetail(activeRun)
          },
          { status: 409 }
        );
      }
    }

    const run = enqueueAndScheduleStage2Run({
      workspaceId: auth.workspace.id,
      creatorUserId: auth.user.id,
      chatId: chat?.id ?? null,
      request: buildStage2RunRequestSnapshot({
        sourceUrl,
        userInstruction,
        mode,
        baseRunId: baseRun?.runId ?? null,
        debugMode,
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

    return Response.json({ run: serializeStage2RunDetail(run) }, { status: 202 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось запустить Stage 2." },
      { status: 500 }
    );
  }
}
