import { requireAuth } from "../../../../lib/auth/guards";
import { requireRuntimeTool } from "../../../../lib/runtime-capabilities";
import {
  enqueueAndScheduleChannelStyleDiscoveryRun,
  getChannelStyleDiscoveryRunOrThrow,
  scheduleChannelStyleDiscoveryProcessing
} from "../../../../lib/channel-style-discovery-runtime";
import type { ChannelStyleDiscoveryRunDetail } from "../../../../lib/channel-style-discovery-types";
import {
  DEFAULT_STAGE2_HARD_CONSTRAINTS,
  normalizeStage2HardConstraints,
  type Stage2HardConstraints
} from "../../../../lib/stage2-channel-config";
import { normalizeStage2StyleDiscoveryReferenceUrls } from "../../../../lib/stage2-style-reference-links";
import { STAGE2_STYLE_MIN_REFERENCE_LINKS } from "../../../../lib/stage2-channel-learning";

export const runtime = "nodejs";

type StyleDiscoveryBody = {
  name?: string;
  username?: string;
  stage2HardConstraints?: Stage2HardConstraints;
  referenceLinks?: string[];
};

function serializeRun(run: ChannelStyleDiscoveryRunDetail) {
  return {
    runId: run.runId,
    workspaceId: run.workspaceId,
    creatorUserId: run.creatorUserId,
    status: run.status,
    request: run.request,
    result: run.result,
    errorMessage: run.errorMessage,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    finishedAt: run.finishedAt
  };
}

async function requireStyleDiscoveryRunVisibility(
  auth: Awaited<ReturnType<typeof requireAuth>>,
  run: ChannelStyleDiscoveryRunDetail
): Promise<void> {
  if (run.workspaceId !== auth.workspace.id || run.creatorUserId !== auth.user.id) {
    throw new Response(JSON.stringify({ error: "Style discovery run not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const runId = url.searchParams.get("runId")?.trim();
  if (!runId) {
    return Response.json({ error: "Передайте runId." }, { status: 400 });
  }

  try {
    const auth = await requireAuth();
    scheduleChannelStyleDiscoveryProcessing();
    const run = getChannelStyleDiscoveryRunOrThrow(runId);
    await requireStyleDiscoveryRunVisibility(auth, run);
    return Response.json({ run: serializeRun(run) }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load style discovery run."
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as StyleDiscoveryBody | null;

  try {
    const auth = await requireAuth();
    if (auth.membership.role === "redactor_limited") {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }

    await requireRuntimeTool("codex");

    const referenceLinks = Array.isArray(body?.referenceLinks)
      ? body.referenceLinks.filter((item): item is string => typeof item === "string")
      : [];
    const normalizedReferenceLinks = normalizeStage2StyleDiscoveryReferenceUrls(referenceLinks);
    if (normalizedReferenceLinks.length < STAGE2_STYLE_MIN_REFERENCE_LINKS) {
      return Response.json(
        {
          error: `Добавьте минимум ${STAGE2_STYLE_MIN_REFERENCE_LINKS} поддерживаемых ссылок перед запуском style discovery.`
        },
        { status: 400 }
      );
    }
    const stage2HardConstraints = body?.stage2HardConstraints
      ? normalizeStage2HardConstraints(body.stage2HardConstraints)
      : DEFAULT_STAGE2_HARD_CONSTRAINTS;

    const run = enqueueAndScheduleChannelStyleDiscoveryRun({
      workspaceId: auth.workspace.id,
      creatorUserId: auth.user.id,
      request: {
        channelName: body?.name?.trim() || "Untitled channel",
        username: body?.username?.trim() || "channel",
        hardConstraints: stage2HardConstraints,
        referenceUrls: normalizedReferenceLinks
      }
    });

    return Response.json({ run: serializeRun(run) }, { status: 202 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate style directions from the reference links."
      },
      { status: 400 }
    );
  }
}
