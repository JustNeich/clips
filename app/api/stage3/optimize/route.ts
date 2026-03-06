import {
  buildGoalHash,
  buildStage3VersionFromStoreVersion,
  listVersions
} from "../../../../lib/stage3-session-store";
import { parseUserIntent } from "../../../../lib/stage3-agent";
import { isSupportedUrl } from "../../../../lib/ytdlp";
import { runAutonomousOptimization } from "../../../../lib/stage3-agent-autonomous";
import { Stage3StateSnapshot } from "../../../../app/components/types";
import { getChatById } from "../../../../lib/chat-history";
import { requireAuth, requireChannelOperate, requireSharedCodexAvailable } from "../../../../lib/auth/guards";

export const runtime = "nodejs";

type OptimizeBody = {
  sourceUrl?: string;
  chatId?: string;
  versionNo?: number;
  topText?: string;
  bottomText?: string;
  clipStartSec?: number;
  agentPrompt?: string;
  currentSnapshot?: Partial<Stage3StateSnapshot>;
  projectId?: string;
  idempotencyKey?: string;
  focusY?: number;
  clipDurationSec?: number;
  autoClipStartSec?: number;
  autoFocusY?: number;
};

function buildCurrentSnapshotFromLegacyInput(body: OptimizeBody): Partial<Stage3StateSnapshot> | undefined {
  const snapshot: Partial<Stage3StateSnapshot> = {
    ...(body.currentSnapshot ?? {})
  };

  if (typeof body.topText === "string") {
    snapshot.topText = body.topText;
  }
  if (typeof body.bottomText === "string") {
    snapshot.bottomText = body.bottomText;
  }

  const clipStartSec = parseFiniteNumber(body.clipStartSec);
  if (clipStartSec !== null) {
    snapshot.clipStartSec = clipStartSec;
  }

  const focusY = parseFiniteNumber(body.focusY);
  if (focusY !== null) {
    snapshot.focusY = focusY;
  }

  return Object.keys(snapshot).length > 0 ? snapshot : undefined;
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function buildStableSignature(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => buildStableSignature(item)).join(",")}]`;
  }

  if (value instanceof Date) {
    return `"${value.toISOString()}"`;
  }

  if (typeof value === "object") {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const entries = sortedKeys
      .map((key) => {
        const itemValue = (value as Record<string, unknown>)[key];
        return `${JSON.stringify(key)}:${buildStableSignature(itemValue)}`;
      })
      .join(",");
    return `{${entries}}`;
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  return String(value);
}

async function buildLegacyVersion(
  sessionId: string,
  versionId: string
): Promise<ReturnType<typeof buildStage3VersionFromStoreVersion> | null> {
  const versions = await listVersions(sessionId);
  const finalVersion = versions.find((entry) => entry.id === versionId) ?? null;
  if (!finalVersion) {
    return null;
  }

  const parent =
    finalVersion.parentVersionId !== null
      ? versions.find((entry) => entry.id === finalVersion.parentVersionId)
      : null;

  return buildStage3VersionFromStoreVersion(
    finalVersion,
    parent ?? finalVersion,
    finalVersion.iterationIndex,
    finalVersion.id
  );
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as OptimizeBody | null;
  const sourceUrl = body?.sourceUrl?.trim();

  if (!sourceUrl) {
    return Response.json({ error: "Передайте sourceUrl в теле запроса." }, { status: 400 });
  }
  if (!isSupportedUrl(sourceUrl)) {
    return Response.json(
      { error: "Поддерживаются ссылки на YouTube Shorts, Instagram Reels и Facebook Reels." },
      { status: 400 }
    );
  }

  const goalText = body?.agentPrompt?.trim() || "Оптимизируй текущий кадр Stage 3.";
  const projectId = body?.projectId?.trim() || body?.chatId?.trim() || `legacy-${buildGoalHash(sourceUrl)}`;
  const intent = parseUserIntent(goalText, null);

  try {
    const auth = await requireAuth();
    const chat = await getChatById(projectId);
    if (!chat) {
      return Response.json({ error: "Project chat not found." }, { status: 404 });
    }
    await requireChannelOperate(auth, chat.channelId);
    const integration = requireSharedCodexAvailable(auth.workspace.id);
    const requestIdempotencyKey = request.headers.get("idempotency-key");
    const mergedSnapshot = buildCurrentSnapshotFromLegacyInput(body ?? {});

    const result = await runAutonomousOptimization({
      projectId,
      mediaId: sourceUrl,
      sourceUrl,
      goalText,
      options: {
        maxIterations: 1
      },
      currentSnapshot: mergedSnapshot,
      autoClipStartSec:
        parseFiniteNumber(body?.autoClipStartSec) ?? parseFiniteNumber(body?.clipStartSec) ?? undefined,
      autoFocusY: parseFiniteNumber(body?.autoFocusY) ?? parseFiniteNumber(body?.focusY) ?? undefined,
      idempotencyKey:
        requestIdempotencyKey?.trim() || body?.idempotencyKey?.trim() || undefined,
      codexSessionId: integration.codexSessionId ?? undefined
    });

    const latestVersions = await listVersions(result.sessionId);
    const baseline =
      latestVersions.find((item) => item.id === result.summary.beforeVersionId) ??
      latestVersions.find((item) => item.iterationIndex === 0) ??
      latestVersions[0] ??
      null;
    const final = await buildLegacyVersion(result.sessionId, result.finalVersionId);

    if (!final) {
      return Response.json(
        {
          optimization: {
            changed: false,
            version: undefined,
            noOpReason: `Статус: ${result.status}. Идея не преобразована в версию.`,
            suggestions: ["Повторите попытку с более конкретной постановкой задачи."],
            intent: {
              zoomRequested: intent.zoomRequested,
              zoomValue: intent.zoomValue,
              actionOnly: intent.actionOnly,
              segmentsRequested: intent.segments.length,
              timingMode: intent.timingMode,
              audioMode: intent.audioMode
            }
          },
          planner: {
            mode: "autonomous",
            warning: "No final version was produced"
          }
        },
        { status: 200 }
      );
    }

    const finalTransform = final.final;
    const changed = baseline
      ? buildStableSignature(baseline.transformConfig) !== buildStableSignature(finalTransform)
      : result.status !== "failed";

    return Response.json(
      {
        optimization: {
          changed,
          version: final,
          noOpReason: !changed ? "Агент не нашел заметных улучшений за один проход." : undefined,
          suggestions: changed ? [] : ["Уточните цель для более точной правки."],
          intent: {
            zoomRequested: intent.zoomRequested,
            zoomValue: intent.zoomValue,
            actionOnly: intent.actionOnly,
            segmentsRequested: intent.segments.length,
            timingMode: intent.timingMode,
            audioMode: intent.audioMode
          }
        },
        planner: {
          mode: "autonomous",
          warning:
            result.status === "partiallyApplied"
              ? "Требуется несколько проходов для полного достижения цели."
              : undefined
        }
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Stage 3 optimization failed." },
      { status: 500 }
    );
  }
}
