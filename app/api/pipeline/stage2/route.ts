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
  Stage2RunMode,
  Stage2RunRecord
} from "../../../../lib/stage2-progress-store";
import {
  enqueueAndScheduleStage2Run,
  getStage2RunOrThrow,
  scheduleStage2RunProcessing
} from "../../../../lib/stage2-run-runtime";
import type { Stage2Response } from "../../../components/types";
import { isSupportedUrl, normalizeSupportedUrl } from "../../../../lib/ytdlp";

export const runtime = "nodejs";

function normalizeMode(value: unknown): Stage2RunMode {
  return value === "auto" ? "auto" : "manual";
}

function serializeStage2RunSummary(run: Stage2RunRecord) {
  return {
    runId: run.runId,
    chatId: run.chatId,
    channelId: run.channelId,
    sourceUrl: run.sourceUrl,
    userInstruction: run.userInstruction,
    mode: run.mode,
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
    | { url?: string; chatId?: string; userInstruction?: string; mode?: Stage2RunMode }
    | null;
  const chatId = body?.chatId?.trim();
  const chat = chatId ? await getChatById(chatId) : null;
  const rawUrl = body?.url?.trim() || chat?.url?.trim();
  const userInstructionRaw = body?.userInstruction?.trim() ?? "";
  const userInstruction = userInstructionRaw ? userInstructionRaw.slice(0, 2000) : null;

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

  try {
    const auth = await requireAuth();
    const channel =
      chat?.channelId
        ? (await requireChannelOperate(auth, chat.channelId)).channel
        : await getDefaultChannel(auth.workspace.id);
    await requireChannelOperate(auth, channel.id);

    await Promise.all([
      requireRuntimeTool("ffmpeg"),
      requireRuntimeTool("ffprobe"),
      requireRuntimeTool("codex")
    ]);
    const integration = requireSharedCodexAvailable(auth.workspace.id);
    await ensureCodexLoggedIn(integration.codexHomePath as string);

    const run = enqueueAndScheduleStage2Run({
      workspaceId: auth.workspace.id,
      creatorUserId: auth.user.id,
      chatId: chat?.id ?? null,
      request: {
        sourceUrl,
        userInstruction,
        mode: normalizeMode(body?.mode),
        channel: {
          id: channel.id,
          name: channel.name,
          username: channel.username,
          descriptionPrompt: channel.descriptionPrompt,
          examplesJson: channel.examplesJson,
          stage2WorkerProfileId: channel.stage2WorkerProfileId,
          stage2ExamplesConfig: channel.stage2ExamplesConfig,
          stage2HardConstraints: channel.stage2HardConstraints,
          stage2PromptConfig: channel.stage2PromptConfig
        }
      }
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
