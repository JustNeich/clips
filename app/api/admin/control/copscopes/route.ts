import { randomUUID } from "node:crypto";
import { requireOwnerOrMcpControlWrite } from "../../../../../lib/auth/guards";
import { appendFlowAuditEvent } from "../../../../../lib/audit-log-store";
import { COPSCOPES_CHANNEL_USERNAME } from "../../../../../lib/copscopes-channel-preset";
import { GHOSTFACE_COUNTRY_CHANNEL_USERNAME } from "../../../../../lib/ghostface-country-channel-preset";
import {
  exportCopscopesSourcePoolCsv,
  exportCopscopesSourcePoolMarkdown,
  importCopscopesSourcePool,
  listCopscopesDailyRuns,
  listCopscopesSourcePool,
  resetCopscopesSourceReelForRetry,
  setActiveCopscopesCategory,
  type CopscopesSourceStatus
} from "../../../../../lib/copscopes-source-pool";
import { runCopscopesDailyPool } from "../../../../../lib/copscopes-daily-runner";
import { getDb } from "../../../../../lib/db/client";
import {
  deleteChannelPublicationWithRemoteSync,
  restoreCanceledChannelPublicationToQueue,
  updateChannelPublicationFromEditor
} from "../../../../../lib/channel-publication-service";
import { scheduleChannelPublicationProcessing } from "../../../../../lib/channel-publication-runtime";
import { isChannelPublishIntegrationReady } from "../../../../../lib/channel-publish-state";
import {
  getChannelPublicationById,
  getChannelPublishIntegration,
  getChannelPublishSettings,
  listChannelPublications,
  upsertChannelPublishSettings
} from "../../../../../lib/publication-store";
import { applyCopscopesChannelPreset } from "../../../../../scripts/apply-copscopes-channel-preset";
import { applyGhostfaceCountryChannelTemplate } from "../../../../../scripts/apply-ghostface-country-channel-template";
import type { Stage3SourceCrop } from "../../../../components/types";

export const runtime = "nodejs";

type ChannelRow = {
  id: string;
  workspace_id: string;
  name: string;
  username: string;
  avatar_asset_id: string | null;
};

type ControlBody = {
  tool?: string;
  input?: Record<string, unknown>;
};

type SourcePoolItem = {
  url: string;
  title?: string;
  caption?: string;
  viewsLabel?: string;
  viewCount?: number;
  postedAt?: string;
  categorySlug?: string;
  categoryLabel?: string;
  secondaryTags?: string[];
  qualityScore?: number;
  cropConfidence?: number;
  crop?: Stage3SourceCrop | null;
  metadata?: Record<string, unknown>;
};

function resolveString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveBoolean(value: unknown): boolean {
  return value === true;
}

function resolveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resolveDefaultControlUsername(tool: string): string {
  return tool === "clips_control_apply_ghostface_template"
    ? GHOSTFACE_COUNTRY_CHANNEL_USERNAME
    : COPSCOPES_CHANNEL_USERNAME;
}

function findChannelByUsername(workspaceId: string, tool: string, username?: string | null): ChannelRow {
  const normalized = (username?.trim() || resolveDefaultControlUsername(tool)).replace(/^@+/, "").toLowerCase();
  const row = getDb()
    .prepare(
      `SELECT id, workspace_id, name, username, avatar_asset_id
         FROM channels
        WHERE workspace_id = ?
          AND archived_at IS NULL
          AND lower(username) = ?
        ORDER BY updated_at DESC
        LIMIT 1`
    )
    .get(workspaceId, normalized) as ChannelRow | undefined;
  if (!row) {
    throw new Error(`Channel @${normalized} was not found.`);
  }
  return row;
}

function summarizeChannel(channel: ChannelRow): Record<string, unknown> {
  return {
    id: channel.id,
    name: channel.name,
    username: channel.username,
    hasAvatar: Boolean(channel.avatar_asset_id),
    avatarAssetId: channel.avatar_asset_id ?? null
  };
}

function summarizeCopscopesPublishing(channel: ChannelRow, limit = 12): Record<string, unknown> {
  const settings = getChannelPublishSettings(channel.id);
  const integration = getChannelPublishIntegration(channel.id);
  const publications = listChannelPublications(channel.id)
    .slice()
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .slice(0, Math.max(1, Math.min(50, Math.floor(limit))))
    .map((publication) => ({
      id: publication.id,
      chatId: publication.chatId,
      title: publication.title,
      status: publication.status,
      scheduleMode: publication.scheduleMode,
      scheduledAt: publication.scheduledAt,
      uploadReadyAt: publication.uploadReadyAt,
      slotDate: publication.slotDate,
      slotIndex: publication.slotIndex,
      needsReview: publication.needsReview,
      youtubeVideoUrl: publication.youtubeVideoUrl,
      lastError: publication.lastError,
      createdAt: publication.createdAt,
      updatedAt: publication.updatedAt
    }));
  return {
    settings,
    expectedGrid: {
      timezone: "Europe/Moscow",
      firstSlotLocalTime: "21:15",
      dailySlotCount: 3,
      slotIntervalMinutes: 15,
      autoQueueEnabled: true
    },
    gridMatchesExpected:
      settings.timezone === "Europe/Moscow" &&
      settings.firstSlotLocalTime === "21:15" &&
      settings.dailySlotCount === 3 &&
      settings.slotIntervalMinutes === 15 &&
      settings.autoQueueEnabled === true,
    integration: integration
      ? {
          provider: integration.provider,
          status: integration.status,
          ready: isChannelPublishIntegrationReady(integration),
          selectedYoutubeChannelId: integration.selectedYoutubeChannelId,
          selectedYoutubeChannelTitle: integration.selectedYoutubeChannelTitle,
          selectedYoutubeChannelCustomUrl: integration.selectedYoutubeChannelCustomUrl,
          selectedGoogleAccountEmail: integration.selectedGoogleAccountEmail,
          youtubeOAuthClientKey: integration.youtubeOAuthClientKey,
          youtubeOAuthClientLabel: integration.youtubeOAuthClientLabel,
          youtubeOAuthProjectNumber: integration.youtubeOAuthProjectNumber,
          lastVerifiedAt: integration.lastVerifiedAt,
          lastError: integration.lastError
        }
      : {
          provider: "youtube",
          status: "disconnected",
          ready: false,
          selectedYoutubeChannelId: null,
          selectedYoutubeChannelTitle: null,
          selectedYoutubeChannelCustomUrl: null,
          selectedGoogleAccountEmail: null,
          youtubeOAuthClientKey: null,
          youtubeOAuthClientLabel: null,
          youtubeOAuthProjectNumber: null,
          lastVerifiedAt: null,
          lastError: "YouTube publishing is not connected."
        },
    recentPublications: publications
  };
}

function auditControl(input: {
  workspaceId: string;
  userId: string;
  action: string;
  channelId?: string | null;
  entityId?: string | null;
  status: string;
  payload?: Record<string, unknown> | null;
}): void {
  appendFlowAuditEvent({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: input.action,
    entityType: "mcp_control",
    entityId: input.entityId ?? input.channelId ?? "copscopes-control",
    channelId: input.channelId ?? null,
    stage: "mcp",
    status: input.status,
    payload: input.payload ?? {}
  });
}

function normalizeSourceItem(value: unknown): SourcePoolItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Each source pool item must be an object.");
  }
  const item = value as Record<string, unknown>;
  const url = resolveString(item.url);
  if (!url) {
    throw new Error("Each source pool item requires url.");
  }
  return {
    url,
    title: resolveString(item.title),
    caption: resolveString(item.caption),
    viewsLabel: resolveString(item.viewsLabel),
    viewCount: resolveNumber(item.viewCount),
    postedAt: resolveString(item.postedAt),
    categorySlug: resolveString(item.categorySlug),
    categoryLabel: resolveString(item.categoryLabel),
    secondaryTags: Array.isArray(item.secondaryTags)
      ? item.secondaryTags.filter((tag): tag is string => typeof tag === "string")
      : undefined,
    qualityScore: resolveNumber(item.qualityScore),
    cropConfidence: resolveNumber(item.cropConfidence),
    crop: item.crop && typeof item.crop === "object" && !Array.isArray(item.crop) ? (item.crop as Stage3SourceCrop) : undefined,
    metadata:
      item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
        ? (item.metadata as Record<string, unknown>)
        : undefined
  };
}

function newControlRunId(): string {
  return randomUUID().replace(/-/g, "");
}

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = await requireOwnerOrMcpControlWrite(request);
    const body = (await request.json().catch(() => null)) as ControlBody | null;
    const tool = body?.tool?.trim();
    const input = body?.input && typeof body.input === "object" ? body.input : {};
    if (!tool) {
      return Response.json({ error: "tool is required." }, { status: 400 });
    }

    const channelUsername = resolveString(input.username) ?? resolveString(input.channelUsername);
    const channel = findChannelByUsername(auth.workspace.id, tool, channelUsername);

    if (tool === "clips_control_apply_channel_preset") {
      auditControl({
        workspaceId: auth.workspace.id,
        userId: auth.user.id,
        action: "copscopes_control.apply_preset.attempted",
        channelId: channel.id,
        status: "attempted",
        payload: {
          username: channel.username,
          dryRun: resolveBoolean(input.dryRun),
          preserveTemplate: resolveBoolean(input.preserveTemplate)
        }
      });
      const result = await applyCopscopesChannelPreset({
        username: channel.username,
        dryRun: resolveBoolean(input.dryRun),
        templateMode: resolveBoolean(input.preserveTemplate) ? "preserve" : "managed",
        workspaceId: auth.workspace.id
      });
      auditControl({
        workspaceId: auth.workspace.id,
        userId: auth.user.id,
        action: "copscopes_control.apply_preset.succeeded",
        channelId: channel.id,
        status: "succeeded",
        payload: {
          dryRun: result.dryRun,
          templateAction: result.templateAction,
          examplesCount: result.examplesCount,
          preserveTemplate: resolveBoolean(input.preserveTemplate)
        }
      });
      return Response.json(result, { status: 200 });
    }

    if (tool === "clips_control_apply_ghostface_template") {
      auditControl({
        workspaceId: auth.workspace.id,
        userId: auth.user.id,
        action: "ghostface_control.apply_template.attempted",
        channelId: channel.id,
        status: "attempted",
        payload: {
          username: channel.username,
          dryRun: resolveBoolean(input.dryRun),
          templateOnly: resolveBoolean(input.templateOnly)
        }
      });
      const result = await applyGhostfaceCountryChannelTemplate({
        username: channel.username,
        dryRun: resolveBoolean(input.dryRun),
        templateOnly: resolveBoolean(input.templateOnly),
        workspaceId: auth.workspace.id
      });
      auditControl({
        workspaceId: auth.workspace.id,
        userId: auth.user.id,
        action: "ghostface_control.apply_template.succeeded",
        channelId: channel.id,
        status: "succeeded",
        payload: {
          dryRun: result.dryRun,
          templateAction: result.templateAction,
          channelAction: result.channelAction,
          templateId: result.templateId
        }
      });
      return Response.json(result, { status: 200 });
    }

    if (tool === "clips_control_import_source_pool") {
      const rawItems = Array.isArray(input.items) ? input.items : [];
      if (rawItems.length === 0) {
        return Response.json({ error: "items must contain at least one source." }, { status: 400 });
      }
      auditControl({
        workspaceId: auth.workspace.id,
        userId: auth.user.id,
        action: "copscopes_control.import_source_pool.attempted",
        channelId: channel.id,
        status: "attempted",
        payload: {
          count: rawItems.length,
          dryRun: resolveBoolean(input.dryRun)
        }
      });
      const result = importCopscopesSourcePool({
        workspaceId: auth.workspace.id,
        channelId: channel.id,
        items: rawItems.map(normalizeSourceItem),
        dryRun: resolveBoolean(input.dryRun)
      });
      const listed = listCopscopesSourcePool({
        workspaceId: auth.workspace.id,
        channelId: channel.id
      });
      auditControl({
        workspaceId: auth.workspace.id,
        userId: auth.user.id,
        action: "copscopes_control.import_source_pool.succeeded",
        channelId: channel.id,
        status: "succeeded",
        payload: {
          dryRun: resolveBoolean(input.dryRun),
          created: result.created,
          updated: result.updated,
          duplicates: result.duplicates,
          invalidCount: result.invalid.length
        }
      });
      return Response.json(
        {
          channel: summarizeChannel(channel),
          ...result,
          markdown: resolveBoolean(input.exportMarkdown) ? exportCopscopesSourcePoolMarkdown(listed) : undefined,
          csv: resolveBoolean(input.exportCsv) ? exportCopscopesSourcePoolCsv(listed.reels) : undefined
        },
        { status: 200 }
      );
    }

    if (tool === "clips_control_list_source_pool") {
      const result = listCopscopesSourcePool({
        workspaceId: auth.workspace.id,
        channelId: channel.id,
        categorySlug: resolveString(input.categorySlug),
        status: resolveString(input.status) as CopscopesSourceStatus | undefined,
        limit: resolveNumber(input.limit)
      });
      return Response.json(
        {
          channel: summarizeChannel(channel),
          ...result,
          markdown: resolveBoolean(input.exportMarkdown) ? exportCopscopesSourcePoolMarkdown(result) : undefined,
          csv: resolveBoolean(input.exportCsv) ? exportCopscopesSourcePoolCsv(result.reels) : undefined
        },
        { status: 200 }
      );
    }

    if (tool === "clips_control_get_channel_status") {
      const pool = listCopscopesSourcePool({
        workspaceId: auth.workspace.id,
        channelId: channel.id,
        categorySlug: resolveString(input.categorySlug),
        limit: resolveNumber(input.poolLimit) ?? 20
      });
      const dailyRuns = listCopscopesDailyRuns({
        workspaceId: auth.workspace.id,
        channelId: channel.id,
        limit: resolveNumber(input.dailyRunsLimit) ?? 10,
        runId: resolveString(input.runId)
      });
      const publishing = summarizeCopscopesPublishing(channel, resolveNumber(input.publicationsLimit) ?? 12);
      auditControl({
        workspaceId: auth.workspace.id,
        userId: auth.user.id,
        action: "copscopes_control.get_channel_status.succeeded",
        channelId: channel.id,
        status: "succeeded",
        payload: {
          activeCategory: pool.categories.find((category) => category.status === "active")?.slug ?? null,
          gridMatchesExpected: publishing.gridMatchesExpected,
          integrationStatus:
            typeof publishing.integration === "object" && publishing.integration !== null
              ? (publishing.integration as Record<string, unknown>).status
              : null
        }
      });
      return Response.json(
        {
          channel: summarizeChannel(channel),
          publishing,
          categories: pool.categories,
          reels: pool.reels,
          dailyRuns
        },
        { status: 200 }
      );
    }

    if (tool === "clips_control_set_active_category") {
      const categorySlug = resolveString(input.categorySlug);
      if (!categorySlug) {
        return Response.json({ error: "categorySlug is required." }, { status: 400 });
      }
      const category = setActiveCopscopesCategory({
        workspaceId: auth.workspace.id,
        channelId: channel.id,
        categorySlug
      });
      auditControl({
        workspaceId: auth.workspace.id,
        userId: auth.user.id,
        action: "copscopes_control.set_active_category.succeeded",
        channelId: channel.id,
        status: "succeeded",
        payload: { categorySlug: category.slug }
      });
      return Response.json({ channel: summarizeChannel(channel), category }, { status: 200 });
    }

    if (tool === "clips_control_set_publish_schedule") {
      const timezone = resolveString(input.timezone) ?? "Europe/Moscow";
      const firstSlotLocalTime = resolveString(input.firstSlotLocalTime) ?? "21:15";
      const dailySlotCount = resolveNumber(input.dailySlotCount) ?? 3;
      const slotIntervalMinutes = resolveNumber(input.slotIntervalMinutes) ?? 15;
      const autoQueueEnabled =
        typeof input.autoQueueEnabled === "boolean" ? resolveBoolean(input.autoQueueEnabled) : true;
      const uploadLeadMinutes = resolveNumber(input.uploadLeadMinutes);
      const notifySubscribersByDefault =
        typeof input.notifySubscribersByDefault === "boolean"
          ? resolveBoolean(input.notifySubscribersByDefault)
          : undefined;
      const dryRun = resolveBoolean(input.dryRun);
      const current = getChannelPublishSettings(channel.id);
      const patch = {
        timezone,
        firstSlotLocalTime,
        dailySlotCount,
        slotIntervalMinutes,
        autoQueueEnabled,
        ...(uploadLeadMinutes === undefined ? {} : { uploadLeadMinutes }),
        ...(notifySubscribersByDefault === undefined ? {} : { notifySubscribersByDefault })
      };
      auditControl({
        workspaceId: auth.workspace.id,
        userId: auth.user.id,
        action: "copscopes_control.set_publish_schedule.attempted",
        channelId: channel.id,
        status: "attempted",
        payload: {
          dryRun,
          current,
          patch
        }
      });
      const settings = dryRun
        ? current
        : upsertChannelPublishSettings({
            workspaceId: auth.workspace.id,
            channelId: channel.id,
            userId: auth.user.id,
            patch
          });
      auditControl({
        workspaceId: auth.workspace.id,
        userId: auth.user.id,
        action: "copscopes_control.set_publish_schedule.succeeded",
        channelId: channel.id,
        status: "succeeded",
        payload: {
          dryRun,
          settings
        }
      });
      return Response.json(
        {
          channel: summarizeChannel(channel),
          dryRun,
          previousSettings: current,
          publishing: summarizeCopscopesPublishing(channel)
        },
        { status: 200 }
      );
    }

    if (tool === "clips_control_reset_source_pool_item") {
      const reel = resetCopscopesSourceReelForRetry({
        workspaceId: auth.workspace.id,
        channelId: channel.id,
        reelId: resolveString(input.reelId),
        shortcode: resolveString(input.shortcode),
        url: resolveString(input.url)
      });
      auditControl({
        workspaceId: auth.workspace.id,
        userId: auth.user.id,
        action: "copscopes_control.reset_source_pool_item.succeeded",
        channelId: channel.id,
        entityId: reel.id,
        status: "succeeded",
        payload: {
          shortcode: reel.shortcode,
          status: reel.status
        }
      });
      return Response.json({ channel: summarizeChannel(channel), reel }, { status: 200 });
    }

    if (tool === "clips_control_cancel_publication") {
      const publicationId = resolveString(input.publicationId);
      if (!publicationId) {
        return Response.json({ error: "publicationId is required." }, { status: 400 });
      }
      const publication = getChannelPublicationById(publicationId);
      if (!publication || publication.workspaceId !== auth.workspace.id || publication.channelId !== channel.id) {
        return Response.json({ error: "Publication was not found for this CopScopes channel." }, { status: 404 });
      }
      const allowPublished = resolveBoolean(input.allowPublished);
      auditControl({
        workspaceId: auth.workspace.id,
        userId: auth.user.id,
        action: "copscopes_control.cancel_publication.attempted",
        channelId: channel.id,
        entityId: publication.id,
        status: "attempted",
        payload: {
          title: publication.title,
          status: publication.status,
          youtubeVideoUrl: publication.youtubeVideoUrl,
          allowPublished
        }
      });
      const canceled = await deleteChannelPublicationWithRemoteSync(publication.id, {
        userId: auth.user.id,
        allowPublished
      });
      auditControl({
        workspaceId: auth.workspace.id,
        userId: auth.user.id,
        action: "copscopes_control.cancel_publication.succeeded",
        channelId: channel.id,
        entityId: canceled.id,
        status: "succeeded",
        payload: {
          status: canceled.status,
          youtubeVideoUrl: canceled.youtubeVideoUrl,
          allowPublished
        }
      });
      return Response.json({ channel: summarizeChannel(channel), publication: canceled }, { status: 200 });
    }

    if (tool === "clips_control_schedule_publication") {
      const publicationId = resolveString(input.publicationId);
      if (!publicationId) {
        return Response.json({ error: "publicationId is required." }, { status: 400 });
      }
      const publication = getChannelPublicationById(publicationId);
      if (!publication || publication.workspaceId !== auth.workspace.id || publication.channelId !== channel.id) {
        return Response.json({ error: "Publication was not found for this CopScopes channel." }, { status: 404 });
      }
      const scheduledAtLocal = resolveString(input.scheduledAtLocal);
      const slotDate = resolveString(input.slotDate);
      const slotIndex = resolveNumber(input.slotIndex);
      if (!scheduledAtLocal && (!slotDate || typeof slotIndex !== "number")) {
        return Response.json(
          { error: "scheduledAtLocal or slotDate + slotIndex is required." },
          { status: 400 }
        );
      }
      auditControl({
        workspaceId: auth.workspace.id,
        userId: auth.user.id,
        action: "copscopes_control.schedule_publication.attempted",
        channelId: channel.id,
        entityId: publication.id,
        status: "attempted",
        payload: {
          title: publication.title,
          status: publication.status,
          scheduledAtLocal: scheduledAtLocal ?? null,
          slotDate: slotDate ?? null,
          slotIndex: typeof slotIndex === "number" ? slotIndex : null
        }
      });
      const restored = publication.status === "canceled"
        ? restoreCanceledChannelPublicationToQueue(publication.id)
        : publication;
      let scheduled;
      try {
        scheduled = await updateChannelPublicationFromEditor({
          publicationId: restored.id,
          patch: scheduledAtLocal
            ? {
                scheduleMode: "custom",
                scheduledAtLocal
              }
            : {
                scheduleMode: "slot",
                slotDate: slotDate!,
                slotIndex: slotIndex!
              }
        });
      } catch (error) {
        if (publication.status === "canceled") {
          await deleteChannelPublicationWithRemoteSync(restored.id, { userId: auth.user.id }).catch(() => null);
        }
        throw error;
      }
      scheduleChannelPublicationProcessing();
      auditControl({
        workspaceId: auth.workspace.id,
        userId: auth.user.id,
        action: "copscopes_control.schedule_publication.succeeded",
        channelId: channel.id,
        entityId: scheduled.id,
        status: "succeeded",
        payload: {
          restoredFromCanceled: publication.status === "canceled",
          status: scheduled.status,
          scheduledAt: scheduled.scheduledAt,
          scheduleMode: scheduled.scheduleMode,
          slotDate: scheduled.slotDate,
          slotIndex: scheduled.slotIndex
        }
      });
      return Response.json(
        {
          channel: summarizeChannel(channel),
          restoredFromCanceled: publication.status === "canceled",
          publication: scheduled
        },
        { status: 200 }
      );
    }

    if (tool === "clips_control_run_daily_pool") {
      const runAsync = resolveBoolean(input.async) || resolveBoolean(input.background);
      if (runAsync && !resolveBoolean(input.dryRun)) {
        const runId = newControlRunId();
        const categorySlug = resolveString(input.categorySlug);
        const limit = resolveNumber(input.limit);
        const attemptBudget = resolveNumber(input.attemptBudget);
        auditControl({
          workspaceId: auth.workspace.id,
          userId: auth.user.id,
          action: "copscopes_control.run_daily_pool.accepted",
          channelId: channel.id,
          entityId: runId,
          status: "queued",
          payload: {
            async: true,
            categorySlug: categorySlug ?? null,
            limit: limit ?? null,
            attemptBudget: attemptBudget ?? null
          }
        });
        void runCopscopesDailyPool({
          workspaceId: auth.workspace.id,
          channelId: channel.id,
          userId: auth.user.id,
          runId,
          categorySlug,
          limit,
          attemptBudget,
          dryRun: false
        }).catch((error) => {
          appendFlowAuditEvent({
            workspaceId: auth.workspace.id,
            userId: auth.user.id,
            action: "copscopes_daily_pool.failed",
            entityType: "copscopes_daily_run",
            entityId: runId,
            channelId: channel.id,
            stage: "mcp",
            status: "failed",
            severity: "error",
            payload: {
              error: error instanceof Error ? error.message : String(error)
            }
          });
        });
        return Response.json(
          {
            channel: summarizeChannel(channel),
            accepted: true,
            async: true,
            runId
          },
          { status: 202 }
        );
      }
      const result = await runCopscopesDailyPool({
        workspaceId: auth.workspace.id,
        channelId: channel.id,
        userId: auth.user.id,
        categorySlug: resolveString(input.categorySlug),
        limit: resolveNumber(input.limit),
        attemptBudget: resolveNumber(input.attemptBudget),
        dryRun: resolveBoolean(input.dryRun)
      });
      auditControl({
        workspaceId: auth.workspace.id,
        userId: auth.user.id,
        action: "copscopes_control.run_daily_pool.succeeded",
        channelId: channel.id,
        entityId: result.runId,
        status: "succeeded",
        payload: {
          dryRun: result.dryRun,
          categorySlug: result.categorySlug,
          queuedCount: result.queuedCount,
          reviewedCount: result.reviewedCount,
          failedCount: result.failedCount,
          exhausted: result.exhausted
        }
      });
      return Response.json({ channel: summarizeChannel(channel), ...result }, { status: 200 });
    }

    return Response.json({ error: `Unknown control tool: ${tool}` }, { status: 400 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "CopScopes control action failed." },
      { status: 500 }
    );
  }
}
