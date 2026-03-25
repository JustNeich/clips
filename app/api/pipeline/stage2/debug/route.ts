import { getChatById } from "../../../../../lib/chat-history";
import {
  requireAuth,
  requireChannelVisibility
} from "../../../../../lib/auth/guards";
import { getStage2RunOrThrow } from "../../../../../lib/stage2-run-runtime";
import { loadStage2RunDebugArtifact } from "../../../../../lib/stage2-debug-artifacts";

export const runtime = "nodejs";

async function requireRunVisibility(
  auth: Awaited<ReturnType<typeof requireAuth>>,
  run: ReturnType<typeof getStage2RunOrThrow>
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
  const debugRef = url.searchParams.get("debugRef")?.trim();

  if (!runId || !debugRef) {
    return Response.json({ error: "Передайте runId и debugRef." }, { status: 400 });
  }

  try {
    const auth = await requireAuth();
    const run = getStage2RunOrThrow(runId);
    await requireRunVisibility(auth, run);
    const artifact = await loadStage2RunDebugArtifact(runId, debugRef);
    if (!artifact) {
      return Response.json({ error: "Debug artifact not found." }, { status: 404 });
    }
    return Response.json({ artifact }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить raw diagnostics." },
      { status: 500 }
    );
  }
}
