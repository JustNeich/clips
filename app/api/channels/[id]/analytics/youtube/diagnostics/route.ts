import { getChannelById } from "../../../../../../../lib/chat-history";
import { requireOwnerOrMcpMachineScope } from "../../../../../../../lib/auth/guards";
import {
  getChannelPublishIntegration,
  getStoredChannelPublishCredential,
  listChannelPublications,
  updateStoredChannelPublishCredential
} from "../../../../../../../lib/publication-store";
import { refreshYouTubeAccessToken } from "../../../../../../../lib/youtube-publishing";
import {
  fetchYouTubeVideoAnalyticsDiagnostics,
  hasYouTubeAnalyticsReadonlyScope,
  YOUTUBE_ANALYTICS_READONLY_SCOPE
} from "../../../../../../../lib/youtube-analytics";
import type { ChannelPublication } from "../../../../../../../app/components/types";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseDateOnly(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  return value;
}

function resolveEndDate(searchParams: URLSearchParams): string {
  return parseDateOnly(searchParams.get("endDate")) ?? dateOnly(new Date());
}

function resolveStartDate(searchParams: URLSearchParams, publication: ChannelPublication | null): string {
  const explicit = parseDateOnly(searchParams.get("startDate"));
  if (explicit) {
    return explicit;
  }
  const publishedAt = publication?.publishedAt ?? publication?.scheduledAt ?? null;
  if (publishedAt) {
    const parsed = new Date(publishedAt);
    if (!Number.isNaN(parsed.getTime())) {
      return dateOnly(parsed);
    }
  }
  const fallback = new Date();
  fallback.setUTCDate(fallback.getUTCDate() - 28);
  return dateOnly(fallback);
}

function findDiagnosticPublication(publications: ChannelPublication[], videoId: string | null): ChannelPublication | null {
  const withVideo = publications.filter((publication) => publication.youtubeVideoId);
  if (videoId) {
    return withVideo.find((publication) => publication.youtubeVideoId === videoId) ?? null;
  }
  return withVideo
    .slice()
    .sort((left, right) => {
      const leftTime = new Date(left.publishedAt ?? left.scheduledAt ?? left.updatedAt).getTime();
      const rightTime = new Date(right.publishedAt ?? right.scheduledAt ?? right.updatedAt).getTime();
      return rightTime - leftTime;
    })[0] ?? null;
}

function summarizePublication(publication: ChannelPublication | null): Record<string, unknown> | null {
  if (!publication) {
    return null;
  }
  return {
    id: publication.id,
    status: publication.status,
    title: publication.title,
    youtubeVideoId: publication.youtubeVideoId,
    youtubeVideoUrl: publication.youtubeVideoUrl,
    scheduledAt: publication.scheduledAt,
    publishedAt: publication.publishedAt,
    sourceUrl: publication.sourceUrl,
    chatId: publication.chatId
  };
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  try {
    const auth = await requireOwnerOrMcpMachineScope(request, "integration:readiness");
    const channel = await getChannelById(id);
    if (!channel || channel.workspaceId !== auth.workspace.id) {
      return Response.json({ error: "Channel not found." }, { status: 404 });
    }

    const integration = getChannelPublishIntegration(channel.id);
    if (!integration) {
      return Response.json(
        {
          channel: { id: channel.id, name: channel.name, username: channel.username },
          status: "youtube_integration_missing",
          missingData: ["youtube_publish_integration"]
        },
        { status: 200 }
      );
    }

    const searchParams = new URL(request.url).searchParams;
    const requestedVideoId = searchParams.get("videoId")?.trim() || null;
    const publication = findDiagnosticPublication(listChannelPublications(channel.id), requestedVideoId);
    const videoId = requestedVideoId ?? publication?.youtubeVideoId ?? null;
    const hasAnalyticsScope = hasYouTubeAnalyticsReadonlyScope(integration.scopes);
    const basePayload = {
      channel: { id: channel.id, name: channel.name, username: channel.username },
      integration: {
        status: integration.status,
        selectedYoutubeChannelId: integration.selectedYoutubeChannelId,
        selectedYoutubeChannelTitle: integration.selectedYoutubeChannelTitle,
        selectedYoutubeChannelCustomUrl: integration.selectedYoutubeChannelCustomUrl,
        selectedGoogleAccountEmail: integration.selectedGoogleAccountEmail,
        scopes: integration.scopes,
        hasAnalyticsScope,
        lastVerifiedAt: integration.lastVerifiedAt,
        lastError: integration.lastError
      },
      publication: summarizePublication(publication)
    };

    if (!videoId) {
      return Response.json(
        {
          ...basePayload,
          status: "youtube_video_missing",
          missingData: ["youtube_video_id"]
        },
        { status: 200 }
      );
    }

    if (!hasAnalyticsScope) {
      return Response.json(
        {
          ...basePayload,
          status: "reauth_required_for_analytics",
          missingData: ["youtube_analytics_scope_missing"],
          requiredScope: YOUTUBE_ANALYTICS_READONLY_SCOPE,
          videoId
        },
        { status: 200 }
      );
    }

    const credential = getStoredChannelPublishCredential(channel.id);
    if (!credential?.refreshToken) {
      return Response.json(
        {
          ...basePayload,
          status: "youtube_credential_missing",
          missingData: ["youtube_refresh_token"]
        },
        { status: 200 }
      );
    }

    const refreshedCredential = await refreshYouTubeAccessToken(credential, integration.youtubeOAuthClientKey);
    updateStoredChannelPublishCredential(channel.id, refreshedCredential);
    if (!refreshedCredential.accessToken) {
      return Response.json(
        {
          ...basePayload,
          status: "youtube_access_token_missing",
          missingData: ["youtube_access_token"]
        },
        { status: 200 }
      );
    }

    const startDate = resolveStartDate(searchParams, publication);
    const endDate = resolveEndDate(searchParams);
    const diagnostics = await fetchYouTubeVideoAnalyticsDiagnostics({
      accessToken: refreshedCredential.accessToken,
      channelId: integration.selectedYoutubeChannelId,
      videoId,
      startDate,
      endDate
    });

    return Response.json(
      {
        ...basePayload,
        status: diagnostics.coverage.enoughForCoreArgusBriefing ? "core_metrics_available" : "partial_metrics",
        videoId,
        diagnostics
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      {
        error: error instanceof Error ? error.message : "YouTube analytics diagnostics failed."
      },
      { status: 500 }
    );
  }
}
