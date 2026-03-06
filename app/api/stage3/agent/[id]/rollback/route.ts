import {
  createMessage,
  createVersion,
  getSession,
  getVersion,
  listVersions,
  updateSession
} from "../../../../../../lib/stage3-session-store";
import { getChatById } from "../../../../../../lib/chat-history";
import { requireAuth, requireChannelOperate } from "../../../../../../lib/auth/guards";

export const runtime = "nodejs";

type RollbackBody = {
  targetVersionId?: string;
  reason?: string;
};

function summarizeSessionVersionId(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as RollbackBody | null;
  const targetVersionId = summarizeSessionVersionId(body?.targetVersionId);

  if (!targetVersionId) {
    return Response.json({ error: "Передайте targetVersionId." }, { status: 400 });
  }

  try {
    const auth = await requireAuth();
    const session = await getSession(id);
    if (!session) {
      return Response.json({ error: "Session not found." }, { status: 404 });
    }
    const chat = await getChatById(session.projectId);
    if (!chat) {
      return Response.json({ error: "Project chat not found." }, { status: 404 });
    }
    await requireChannelOperate(auth, chat.channelId);

    const targetVersion = await getVersion(targetVersionId);
    if (!targetVersion || targetVersion.sessionId !== session.id) {
      return Response.json({ error: "targetVersionId не найден для этой сессии." }, { status: 400 });
    }

    const versions = await listVersions(session.id);
    const maxIteration = versions.reduce((max, item) => Math.max(max, item.iterationIndex), 0);
    const reason = body?.reason?.trim() || "rollback";

    const rollbackVersion = await createVersion({
      sessionId: session.id,
      parentVersionId: targetVersion.id,
      iterationIndex: maxIteration + 1,
      source: "rollback",
      transformConfig: targetVersion.transformConfig,
      diffSummary: [`Rollback to version ${targetVersion.id} by reason: ${reason}`],
      rationale: "rollback_guard"
    });

    await updateSession(session.id, {
      currentVersionId: rollbackVersion.id,
      status: session.status
    });

    await createMessage({
      sessionId: session.id,
      role: "assistant_auto",
      text: "rollback",
      payload: {
        sessionId: session.id,
        targetVersionId,
        reason,
        rollbackVersionId: rollbackVersion.id
      }
    });

    return Response.json(
      {
        sessionId: session.id,
        targetVersionId,
        reason,
        rollbackVersionId: rollbackVersion.id,
        currentVersionId: rollbackVersion.id
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Rollback failed." },
      { status: 500 }
    );
  }
}
