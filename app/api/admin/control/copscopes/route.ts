import { requireOwnerOrMcpControlWrite } from "../../../../../lib/auth/guards";
import { appendFlowAuditEvent } from "../../../../../lib/audit-log-store";
import { COPSCOPES_CHANNEL_USERNAME } from "../../../../../lib/copscopes-channel-preset";
import {
  exportCopscopesSourcePoolCsv,
  exportCopscopesSourcePoolMarkdown,
  importCopscopesSourcePool,
  listCopscopesSourcePool,
  resetCopscopesSourceReelForRetry,
  setActiveCopscopesCategory,
  type CopscopesSourceStatus
} from "../../../../../lib/copscopes-source-pool";
import { runCopscopesDailyPool } from "../../../../../lib/copscopes-daily-runner";
import { getDb } from "../../../../../lib/db/client";
import { applyCopscopesChannelPreset } from "../../../../../scripts/apply-copscopes-channel-preset";
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

function findChannelByUsername(workspaceId: string, username?: string | null): ChannelRow {
  const normalized = (username?.trim() || COPSCOPES_CHANNEL_USERNAME).replace(/^@+/, "").toLowerCase();
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
    const channel = findChannelByUsername(auth.workspace.id, channelUsername);

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

    if (tool === "clips_control_run_daily_pool") {
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
