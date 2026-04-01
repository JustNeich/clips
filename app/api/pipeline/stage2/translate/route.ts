import type { Stage2Response } from "../../../../components/types";
import { ensureCodexLoggedIn } from "../../../../../lib/codex-runner";
import { getChatById } from "../../../../../lib/chat-history";
import {
  requireAuth,
  requireChannelVisibility,
  requireSharedCodexAvailable
} from "../../../../../lib/auth/guards";
import { requireRuntimeTool } from "../../../../../lib/runtime-capabilities";
import { getStage2Run, type Stage2RunRecord } from "../../../../../lib/stage2-progress-store";
import { createStage2CodexExecutorContext } from "../../../../../lib/stage2-codex-executor";
import { ViralShortsWorkerService } from "../../../../../lib/viral-shorts-worker/service";

export const runtime = "nodejs";

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

  if (run.channelId) {
    await requireChannelVisibility(auth, run.channelId);
    return;
  }

  if (!run.chatId) {
    return;
  }

  const chat = await getChatById(run.chatId);
  if (!chat || chat.workspaceId !== auth.workspace.id) {
    throw new Response(JSON.stringify({ error: "Run not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }
  await requireChannelVisibility(auth, chat.channelId);
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { runId?: string } | null;
  const runId = body?.runId?.trim();
  if (!runId) {
    return Response.json({ error: "Передайте runId." }, { status: 400 });
  }

  try {
    const auth = await requireAuth();
    const run = getStage2Run(runId);
    if (!run) {
      return Response.json({ error: "Run not found." }, { status: 404 });
    }
    await requireRunVisibility(auth, run);

    const stage2 = (run.resultData ?? null) as Stage2Response | null;
    if (!stage2) {
      return Response.json({ error: "Run result is missing." }, { status: 409 });
    }
    if (stage2.output.pipeline?.execution?.pipelineVersion !== "native_caption_v3") {
      return Response.json(
        { error: "translation_not_supported", message: "Перевод finalists доступен только для native_caption_v3 runs." },
        { status: 409 }
      );
    }

    const finalists = stage2.output.finalists ?? [];
    if (finalists.length === 0) {
      return Response.json(
        { error: "missing_finalists", message: "В этом run нет finalists для перевода." },
        { status: 409 }
      );
    }

    await requireRuntimeTool("codex");
    const integration = requireSharedCodexAvailable(auth.workspace.id);
    await ensureCodexLoggedIn(integration.codexHomePath as string);
    const executorContext = await createStage2CodexExecutorContext(run.workspaceId);
    const service = new ViralShortsWorkerService();
    const translation = await service.translateNativeCaptionFinalists({
      finalists,
      executor: executorContext.executor,
      model: executorContext.resolvedCodexModelConfig.titleWriter,
      reasoningEffort: executorContext.reasoningEffort
    });

    return Response.json({ translation }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Не удалось перевести finalists."
      },
      { status: 500 }
    );
  }
}
