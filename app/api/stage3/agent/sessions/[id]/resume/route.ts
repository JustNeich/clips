import { getSession } from "../../../../../../../lib/stage3-session-store";
import { resumeAutonomousSession } from "../../../../../../../lib/stage3-agent-autonomous";
import { applyHostedStage3Limits } from "../../../../../../../lib/stage3-hosted-limits";
import { isStage3HostedBusyError } from "../../../../../../../lib/stage3-server-control";
import { summarizeUserFacingError } from "../../../../../../../lib/ui-error";
import { getChatById } from "../../../../../../../lib/chat-history";
import {
  requireAuth,
  requireChannelOperate,
  requireSharedCodexAvailable
} from "../../../../../../../lib/auth/guards";

export const runtime = "nodejs";
const STAGE3_BUSY_RETRY_AFTER_SEC = "8";

type Stage3ResumeBody = {
  mediaId?: string;
  sourceUrl?: string;
  options?: {
    maxIterations?: number;
    targetScore?: number;
    minGain?: number;
    operationBudget?: number;
  };
  idempotencyKey?: string;
  plannerModel?: string;
  plannerReasoningEffort?: string;
  plannerTimeoutMs?: number;
};

function toOptions(raw: Stage3ResumeBody["options"] | undefined) {
  if (!raw) {
    return undefined;
  }
  return {
    maxIterations: Number.isFinite(raw.maxIterations) ? raw.maxIterations : undefined,
    targetScore: Number.isFinite(raw.targetScore) ? raw.targetScore : undefined,
    minGain: Number.isFinite(raw.minGain) ? raw.minGain : undefined,
    operationBudget: Number.isFinite(raw.operationBudget) ? raw.operationBudget : undefined
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Stage3ResumeBody | null;
  const requestIdempotencyKey = request.headers.get("idempotency-key");

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
    requireSharedCodexAvailable(auth.workspace.id);

    const mediaId = body?.mediaId?.trim() || session.mediaId;
    if (!mediaId) {
      return Response.json({ error: "Передайте mediaId." }, { status: 400 });
    }

    const tuning = applyHostedStage3Limits({
      options: toOptions(body?.options),
      plannerReasoningEffort: body?.plannerReasoningEffort,
      plannerTimeoutMs: Number.isFinite(body?.plannerTimeoutMs) ? body?.plannerTimeoutMs : undefined
    });

    const result = await resumeAutonomousSession(
      id,
      mediaId,
      tuning.options,
      body?.sourceUrl,
      requestIdempotencyKey?.trim() || body?.idempotencyKey?.trim() || undefined,
      body?.plannerModel,
      tuning.plannerReasoningEffort,
      tuning.plannerTimeoutMs
    );

    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    if (isStage3HostedBusyError(error)) {
      return Response.json(
        {
          error: "Хостинг занят другой тяжёлой задачей Stage 3. Повторите через минуту."
        },
        {
          status: 503,
          headers: {
            "Retry-After": STAGE3_BUSY_RETRY_AFTER_SEC,
            "x-stage3-busy": "1"
          }
        }
      );
    }
    const rawMessage = error instanceof Error ? error.message : "Resume run failed.";
    const message = summarizeUserFacingError(rawMessage);
    if (message === "Session not found.") {
      return Response.json({ error: message }, { status: 404 });
    }
    if (rawMessage.includes("mediaId")) {
      return Response.json({ error: message }, { status: 400 });
    }

    return Response.json({ error: message }, { status: 500 });
  }
}
