import { isSupportedUrl, normalizeSupportedUrl } from "../../../../../lib/ytdlp";
import { runAutonomousOptimization } from "../../../../../lib/stage3-agent-autonomous";
import { applyHostedStage3Limits } from "../../../../../lib/stage3-hosted-limits";
import { isStage3HostedBusyError } from "../../../../../lib/stage3-server-control";
import { summarizeUserFacingError } from "../../../../../lib/ui-error";
import { Stage3StateSnapshot } from "../../../../../app/components/types";
import { getChatById } from "../../../../../lib/chat-history";
import { requireAuth, requireChannelOperate, requireSharedCodexAvailable } from "../../../../../lib/auth/guards";

export const runtime = "nodejs";
const STAGE3_BUSY_RETRY_AFTER_SEC = "8";

type Stage3RunOptions = {
  maxIterations?: number;
  targetScore?: number;
  minGain?: number;
  operationBudget?: number;
  idempotencyKey?: string;
};

type Stage3RunBody = {
  sessionId?: string;
  projectId: string;
  mediaId: string;
  goalText: string;
  options?: Stage3RunOptions;
  sourceUrl?: string;
  sourceDurationSec?: number | null;
  currentSnapshot?: unknown;
  autoClipStartSec?: number | null;
  autoFocusY?: number | null;
  idempotencyKey?: string;
  plannerModel?: string;
  plannerReasoningEffort?: string;
  plannerTimeoutMs?: number;
};

function parseFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function buildRunAutonomousInput(body: Stage3RunBody, request: Request) {
  const trimmedProjectId = body.projectId?.trim();
  const trimmedMediaId = body.mediaId?.trim();
  const trimmedGoal = body.goalText?.trim();
  const rawSourceUrl = (body.sourceUrl ?? trimmedMediaId ?? "").trim();
  const sourceUrl = rawSourceUrl ? normalizeSupportedUrl(rawSourceUrl) : "";
  const mediaIdCandidate = trimmedMediaId || sourceUrl;
  const mediaId = mediaIdCandidate && isSupportedUrl(mediaIdCandidate)
    ? normalizeSupportedUrl(mediaIdCandidate)
    : mediaIdCandidate;
  const option = body.options ?? {};
  const idempotencyKey =
    request.headers.get("idempotency-key")?.trim() ||
    body.idempotencyKey?.trim() ||
    option.idempotencyKey?.trim() ||
    undefined;

  return applyHostedStage3Limits({
    projectId: trimmedProjectId,
    mediaId,
    goalText: trimmedGoal,
    sourceUrl,
    sourceDurationSec: parseFiniteNumber(body.sourceDurationSec),
    currentSnapshot:
      body.currentSnapshot && typeof body.currentSnapshot === "object"
        ? (body.currentSnapshot as Partial<Stage3StateSnapshot>)
        : undefined,
    autoClipStartSec: parseFiniteNumber(body.autoClipStartSec),
    autoFocusY: parseFiniteNumber(body.autoFocusY),
    idempotencyKey,
    options: {
      maxIterations: parseFiniteNumber(option.maxIterations),
      targetScore: parseFiniteNumber(option.targetScore),
      minGain: parseFiniteNumber(option.minGain),
      operationBudget: parseFiniteNumber(option.operationBudget)
    },
    plannerModel: body.plannerModel,
    plannerReasoningEffort: body.plannerReasoningEffort,
    plannerTimeoutMs: parseFiniteNumber(body.plannerTimeoutMs)
  });
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Stage3RunBody | null;
  if (!body) {
    return Response.json({ error: "Тело запроса невалидно." }, { status: 400 });
  }

  const payload = buildRunAutonomousInput(body, request);

  if (!payload.projectId) {
    return Response.json({ error: "Передайте projectId." }, { status: 400 });
  }
  if (!payload.mediaId) {
    return Response.json({ error: "Передайте mediaId." }, { status: 400 });
  }
  if (!payload.goalText) {
    return Response.json({ error: "Передайте goalText." }, { status: 400 });
  }
  if (!isSupportedUrl(payload.sourceUrl)) {
    return Response.json(
      {
        error:
          "Не удалось подготовить исходное видео для Stage 3 агента. Проверьте ссылку на ролик из Шага 1."
      },
      { status: 400 }
    );
  }

  try {
    const auth = await requireAuth();
    const chat = await getChatById(payload.projectId);
    if (!chat) {
      return Response.json({ error: "Project chat not found." }, { status: 404 });
    }
    await requireChannelOperate(auth, chat.channelId);
    const integration = requireSharedCodexAvailable(auth.workspace.id);
    const result = await runAutonomousOptimization({
      sessionId: body.sessionId?.trim() || undefined,
      projectId: payload.projectId,
      mediaId: payload.mediaId,
      sourceUrl: payload.sourceUrl,
      sourceDurationSec: payload.sourceDurationSec,
      goalText: payload.goalText,
      currentSnapshot: payload.currentSnapshot,
      autoClipStartSec: payload.autoClipStartSec,
      autoFocusY: payload.autoFocusY,
      options: payload.options,
      idempotencyKey: payload.idempotencyKey,
      codexSessionId: integration.codexSessionId ?? undefined,
      plannerModel: payload.plannerModel,
      plannerReasoningEffort: payload.plannerReasoningEffort,
      plannerTimeoutMs: payload.plannerTimeoutMs
    });

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
    return Response.json(
      {
        error: summarizeUserFacingError(
          error instanceof Error ? error.message : "Agent run failed."
        )
      },
      { status: 500 }
    );
  }
}
