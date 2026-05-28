import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { appendFlowAuditEvent } from "../lib/audit-log-store";
import { COPSCOPES_CHANNEL_USERNAME } from "../lib/copscopes-channel-preset";
import { GHOSTFACE_COUNTRY_CHANNEL_USERNAME } from "../lib/ghostface-country-channel-preset";
import {
  exportCopscopesSourcePoolCsv,
  exportCopscopesSourcePoolMarkdown,
  importCopscopesSourcePool,
  listCopscopesDailyRuns,
  listCopscopesSourcePool,
  resetCopscopesSourceReelForRetry,
  setActiveCopscopesCategory,
  type CopscopesSourceStatus
} from "../lib/copscopes-source-pool";
import { runCopscopesDailyPool } from "../lib/copscopes-daily-runner";
import { getDb } from "../lib/db/client";
import { authenticateMcpControlWriteToken, type McpTokenAuthContext } from "../lib/mcp-token-store";
import { isChannelPublishIntegrationReady } from "../lib/channel-publish-state";
import {
  getChannelPublishIntegration,
  getChannelPublishSettings,
  listChannelPublications,
  upsertChannelPublishSettings
} from "../lib/publication-store";
import { applyCopscopesChannelPreset } from "./apply-copscopes-channel-preset";
import { applyGhostfaceCountryChannelTemplate } from "./apply-ghostface-country-channel-template";
import type { Stage3SourceCrop } from "../app/components/types";

type ChannelRow = {
  id: string;
  workspace_id: string;
  name: string;
  username: string;
};

const appUrl = process.env.CLIPS_APP_URL?.trim().replace(/\/+$/, "") ?? "";
const remoteMode = Boolean(appUrl);
const token = process.env.CLIPS_MCP_TOKEN?.trim() ?? "";
if (!token) {
  console.error("CLIPS_MCP_TOKEN is required.");
  process.exit(1);
}

const authenticated = remoteMode ? null : authenticateMcpControlWriteToken(token);
if (!remoteMode && !authenticated) {
  console.error("CLIPS_MCP_TOKEN must be a non-revoked token with control:write scope.");
  process.exit(1);
}
const auth = authenticated;

function jsonContent(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function getLocalAuth(): McpTokenAuthContext {
  if (!auth) {
    throw new Error("Local control mode requires a valid control:write token.");
  }
  return auth;
}

async function remoteControl(tool: string, input: Record<string, unknown>): Promise<ReturnType<typeof jsonContent>> {
  const response = await fetch(`${appUrl}/api/admin/control/copscopes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ tool, input })
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as Record<string, unknown>).error)
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return jsonContent(payload);
}

function findChannelByUsername(username: string): ChannelRow {
  const localAuth = getLocalAuth();
  const normalized = username.trim().replace(/^@+/, "").toLowerCase();
  const row = getDb()
    .prepare(
      `SELECT id, workspace_id, name, username
         FROM channels
        WHERE workspace_id = ?
          AND archived_at IS NULL
          AND lower(username) = ?
        ORDER BY updated_at DESC
        LIMIT 1`
    )
    .get(localAuth.workspace.id, normalized) as ChannelRow | undefined;
  if (!row) {
    throw new Error(`Channel @${normalized} was not found in the active APP_DATA_DIR database.`);
  }
  return row;
}

function resolveChannel(username?: string | null): ChannelRow {
  return findChannelByUsername(username?.trim() || COPSCOPES_CHANNEL_USERNAME);
}

function resolveGhostfaceChannel(username?: string | null): ChannelRow {
  return findChannelByUsername(username?.trim() || GHOSTFACE_COUNTRY_CHANNEL_USERNAME);
}

function auditControl(input: {
  action: string;
  channelId?: string | null;
  entityId?: string | null;
  status: string;
  payload?: Record<string, unknown> | null;
}): void {
  const localAuth = getLocalAuth();
  appendFlowAuditEvent({
    workspaceId: localAuth.workspace.id,
    userId: localAuth.user.id,
    action: input.action,
    entityType: "mcp_control",
    entityId: input.entityId ?? input.channelId ?? localAuth.token.id,
    channelId: input.channelId ?? null,
    stage: "mcp",
    status: input.status,
    payload: {
      tokenHint: localAuth.token.tokenHint,
      ...input.payload
    }
  });
}

function newControlRunId(): string {
  return randomUUID().replace(/-/g, "");
}

function summarizeCopscopesPublishing(channel: ChannelRow, limit = 12): Record<string, unknown> {
  const settings = getChannelPublishSettings(channel.id);
  const integration = getChannelPublishIntegration(channel.id);
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
    recentPublications: listChannelPublications(channel.id)
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
      }))
  };
}

const sourceItemSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  caption: z.string().optional(),
  viewsLabel: z.string().optional(),
  viewCount: z.number().int().nonnegative().optional(),
  postedAt: z.string().optional(),
  categorySlug: z.string().optional(),
  categoryLabel: z.string().optional(),
  secondaryTags: z.array(z.string()).optional(),
  qualityScore: z.number().min(0).max(100).optional(),
  cropConfidence: z.number().min(0).max(1).optional(),
  crop: z
    .object({
      enabled: z.boolean(),
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      confidence: z.number().min(0).max(1).nullable().optional(),
      source: z.string().nullable().optional(),
      reviewedAt: z.string().nullable().optional(),
      notes: z.string().nullable().optional()
    })
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

function normalizeInputCrop(crop: z.infer<typeof sourceItemSchema>["crop"]): Stage3SourceCrop | null | undefined {
  if (!crop) {
    return undefined;
  }
  return {
    enabled: crop.enabled,
    x: crop.x,
    y: crop.y,
    width: crop.width,
    height: crop.height,
    confidence: crop.confidence ?? null,
    source: crop.source ?? null,
    reviewedAt: crop.reviewedAt ?? null,
    notes: crop.notes ?? null
  };
}

const server = new McpServer({
  name: "clips-control",
  version: "1.0.0"
});

server.registerTool(
  "clips_control_apply_channel_preset",
  {
    title: "Apply CopScopes channel preset",
    description: "Apply or dry-run the CopScopes preset, examples and managed template for the target channel.",
    inputSchema: z.object({
      username: z.string().optional(),
      dryRun: z.boolean().optional(),
      preserveTemplate: z.boolean().optional()
    })
  },
  async ({ username, dryRun, preserveTemplate }) => {
    if (remoteMode) {
      return remoteControl("clips_control_apply_channel_preset", {
        username,
        dryRun: Boolean(dryRun),
        preserveTemplate: Boolean(preserveTemplate)
      });
    }
    const channel = resolveChannel(username);
    auditControl({
      action: "copscopes_control.apply_preset.attempted",
      channelId: channel.id,
      status: "attempted",
      payload: {
        username: channel.username,
        dryRun: Boolean(dryRun),
        preserveTemplate: Boolean(preserveTemplate)
      }
    });
    const result = await applyCopscopesChannelPreset({
      username: channel.username,
      dryRun: Boolean(dryRun),
      templateMode: preserveTemplate ? "preserve" : "managed",
      workspaceId: getLocalAuth().workspace.id
    });
    auditControl({
      action: "copscopes_control.apply_preset.succeeded",
      channelId: channel.id,
      status: "succeeded",
      payload: {
        dryRun: result.dryRun,
        templateAction: result.templateAction,
        examplesCount: result.examplesCount,
        preserveTemplate: Boolean(preserveTemplate)
      }
    });
    return jsonContent(result);
  }
);

server.registerTool(
  "clips_control_apply_ghostface_template",
  {
    title: "Apply Ghostface Country template",
    description: "Create/update the Ghostface Country managed template and assign it to the target channel.",
    inputSchema: z.object({
      username: z.string().optional(),
      dryRun: z.boolean().optional(),
      templateOnly: z.boolean().optional()
    })
  },
  async ({ username, dryRun, templateOnly }) => {
    if (remoteMode) {
      return remoteControl("clips_control_apply_ghostface_template", {
        username,
        dryRun: Boolean(dryRun),
        templateOnly: Boolean(templateOnly)
      });
    }
    const channel = resolveGhostfaceChannel(username);
    auditControl({
      action: "ghostface_control.apply_template.attempted",
      channelId: channel.id,
      status: "attempted",
      payload: {
        username: channel.username,
        dryRun: Boolean(dryRun),
        templateOnly: Boolean(templateOnly)
      }
    });
    const result = await applyGhostfaceCountryChannelTemplate({
      username: channel.username,
      dryRun: Boolean(dryRun),
      templateOnly: Boolean(templateOnly),
      workspaceId: getLocalAuth().workspace.id
    });
    auditControl({
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
    return jsonContent(result);
  }
);

server.registerTool(
  "clips_control_import_source_pool",
  {
    title: "Import CopScopes source pool",
    description: "Import Instagram Reel URLs into the persistent CopScopes source pool.",
    inputSchema: z.object({
      channelUsername: z.string().optional(),
      items: z.array(sourceItemSchema).min(1).max(1000),
      dryRun: z.boolean().optional(),
      exportMarkdown: z.boolean().optional(),
      exportCsv: z.boolean().optional()
    })
  },
  async ({ channelUsername, items, dryRun, exportMarkdown, exportCsv }) => {
    if (remoteMode) {
      return remoteControl("clips_control_import_source_pool", {
        channelUsername,
        items,
        dryRun: Boolean(dryRun),
        exportMarkdown: Boolean(exportMarkdown),
        exportCsv: Boolean(exportCsv)
      });
    }
    const localAuth = getLocalAuth();
    const channel = resolveChannel(channelUsername);
    auditControl({
      action: "copscopes_control.import_source_pool.attempted",
      channelId: channel.id,
      status: "attempted",
      payload: { count: items.length, dryRun: Boolean(dryRun) }
    });
    const result = importCopscopesSourcePool({
      workspaceId: localAuth.workspace.id,
      channelId: channel.id,
      items: items.map((item) => ({
        ...item,
        crop: normalizeInputCrop(item.crop)
      })),
      dryRun: Boolean(dryRun)
    });
    const listed = listCopscopesSourcePool({
      workspaceId: localAuth.workspace.id,
      channelId: channel.id
    });
    const response = {
      ...result,
      markdown: exportMarkdown ? exportCopscopesSourcePoolMarkdown(listed) : undefined,
      csv: exportCsv ? exportCopscopesSourcePoolCsv(listed.reels) : undefined
    };
    auditControl({
      action: "copscopes_control.import_source_pool.succeeded",
      channelId: channel.id,
      status: "succeeded",
      payload: {
        dryRun: Boolean(dryRun),
        created: result.created,
        updated: result.updated,
        duplicates: result.duplicates,
        invalidCount: result.invalid.length
      }
    });
    return jsonContent(response);
  }
);

server.registerTool(
  "clips_control_list_source_pool",
  {
    title: "List CopScopes source pool",
    description: "List CopScopes category counts and source Reel records.",
    inputSchema: z.object({
      channelUsername: z.string().optional(),
      categorySlug: z.string().optional(),
      status: z
        .enum(["available", "in_progress", "consumed", "needs_review", "skipped", "failed"])
        .optional(),
      limit: z.number().int().min(1).max(500).optional(),
      exportMarkdown: z.boolean().optional(),
      exportCsv: z.boolean().optional()
    })
  },
  async ({ channelUsername, categorySlug, status, limit, exportMarkdown, exportCsv }) => {
    if (remoteMode) {
      return remoteControl("clips_control_list_source_pool", {
        channelUsername,
        categorySlug,
        status,
        limit,
        exportMarkdown: Boolean(exportMarkdown),
        exportCsv: Boolean(exportCsv)
      });
    }
    const localAuth = getLocalAuth();
    const channel = resolveChannel(channelUsername);
    const result = listCopscopesSourcePool({
      workspaceId: localAuth.workspace.id,
      channelId: channel.id,
      categorySlug,
      status: status as CopscopesSourceStatus | undefined,
      limit
    });
    return jsonContent({
      ...result,
      markdown: exportMarkdown ? exportCopscopesSourcePoolMarkdown(result) : undefined,
      csv: exportCsv ? exportCopscopesSourcePoolCsv(result.reels) : undefined
    });
  }
);

server.registerTool(
  "clips_control_get_channel_status",
  {
    title: "Get CopScopes channel status",
    description: "Read CopScopes publishing settings, YouTube readiness, recent publications, categories, and source pool sample.",
    inputSchema: z.object({
      channelUsername: z.string().optional(),
      categorySlug: z.string().optional(),
      poolLimit: z.number().int().min(1).max(500).optional(),
      publicationsLimit: z.number().int().min(1).max(50).optional(),
      dailyRunsLimit: z.number().int().min(1).max(50).optional(),
      runId: z.string().optional()
    })
  },
  async ({ channelUsername, categorySlug, poolLimit, publicationsLimit, dailyRunsLimit, runId }) => {
    if (remoteMode) {
      return remoteControl("clips_control_get_channel_status", {
        channelUsername,
        categorySlug,
        poolLimit,
        publicationsLimit,
        dailyRunsLimit,
        runId
      });
    }
    const localAuth = getLocalAuth();
    const channel = resolveChannel(channelUsername);
    const pool = listCopscopesSourcePool({
      workspaceId: localAuth.workspace.id,
      channelId: channel.id,
      categorySlug,
      limit: poolLimit ?? 20
    });
    auditControl({
      action: "copscopes_control.get_channel_status.succeeded",
      channelId: channel.id,
      status: "succeeded",
      payload: {
        activeCategory: pool.categories.find((category) => category.status === "active")?.slug ?? null
      }
    });
    return jsonContent({
      channel,
      publishing: summarizeCopscopesPublishing(channel, publicationsLimit ?? 12),
      categories: pool.categories,
      reels: pool.reels,
      dailyRuns: listCopscopesDailyRuns({
        workspaceId: localAuth.workspace.id,
        channelId: channel.id,
        limit: dailyRunsLimit ?? 10,
        runId
      })
    });
  }
);

server.registerTool(
  "clips_control_set_active_category",
  {
    title: "Set active CopScopes category",
    description: "Choose the category consumed by the daily CopScopes pool automation.",
    inputSchema: z.object({
      channelUsername: z.string().optional(),
      categorySlug: z.string()
    })
  },
  async ({ channelUsername, categorySlug }) => {
    if (remoteMode) {
      return remoteControl("clips_control_set_active_category", {
        channelUsername,
        categorySlug
      });
    }
    const localAuth = getLocalAuth();
    const channel = resolveChannel(channelUsername);
    const category = setActiveCopscopesCategory({
      workspaceId: localAuth.workspace.id,
      channelId: channel.id,
      categorySlug
    });
    auditControl({
      action: "copscopes_control.set_active_category.succeeded",
      channelId: channel.id,
      status: "succeeded",
      payload: { categorySlug: category.slug }
    });
    return jsonContent({ category });
  }
);

server.registerTool(
  "clips_control_set_publish_schedule",
  {
    title: "Set CopScopes publish schedule",
    description: "Set the CopScopes channel publish grid used by automatic publication queueing.",
    inputSchema: z.object({
      channelUsername: z.string().optional(),
      timezone: z.string().optional(),
      firstSlotLocalTime: z.string().optional(),
      dailySlotCount: z.number().int().min(1).max(12).optional(),
      slotIntervalMinutes: z.number().int().min(5).max(240).optional(),
      autoQueueEnabled: z.boolean().optional(),
      uploadLeadMinutes: z.number().int().min(5).max(1440).optional(),
      notifySubscribersByDefault: z.boolean().optional(),
      dryRun: z.boolean().optional()
    })
  },
  async ({
    channelUsername,
    timezone,
    firstSlotLocalTime,
    dailySlotCount,
    slotIntervalMinutes,
    autoQueueEnabled,
    uploadLeadMinutes,
    notifySubscribersByDefault,
    dryRun
  }) => {
    const input = {
      channelUsername,
      timezone: timezone ?? "Europe/Moscow",
      firstSlotLocalTime: firstSlotLocalTime ?? "21:15",
      dailySlotCount: dailySlotCount ?? 3,
      slotIntervalMinutes: slotIntervalMinutes ?? 15,
      autoQueueEnabled: autoQueueEnabled ?? true,
      uploadLeadMinutes,
      notifySubscribersByDefault,
      dryRun: Boolean(dryRun)
    };
    if (remoteMode) {
      return remoteControl("clips_control_set_publish_schedule", input);
    }
    const localAuth = getLocalAuth();
    const channel = resolveChannel(channelUsername);
    const current = getChannelPublishSettings(channel.id);
    const patch = {
      timezone: input.timezone,
      firstSlotLocalTime: input.firstSlotLocalTime,
      dailySlotCount: input.dailySlotCount,
      slotIntervalMinutes: input.slotIntervalMinutes,
      autoQueueEnabled: input.autoQueueEnabled,
      ...(uploadLeadMinutes === undefined ? {} : { uploadLeadMinutes }),
      ...(notifySubscribersByDefault === undefined ? {} : { notifySubscribersByDefault })
    };
    auditControl({
      action: "copscopes_control.set_publish_schedule.attempted",
      channelId: channel.id,
      status: "attempted",
      payload: {
        dryRun: input.dryRun,
        current,
        patch
      }
    });
    if (!input.dryRun) {
      upsertChannelPublishSettings({
        workspaceId: localAuth.workspace.id,
        channelId: channel.id,
        userId: localAuth.user.id,
        patch
      });
    }
    auditControl({
      action: "copscopes_control.set_publish_schedule.succeeded",
      channelId: channel.id,
      status: "succeeded",
      payload: {
        dryRun: input.dryRun,
        settings: getChannelPublishSettings(channel.id)
      }
    });
    return jsonContent({
      channel,
      dryRun: input.dryRun,
      previousSettings: current,
      publishing: summarizeCopscopesPublishing(channel)
    });
  }
);

server.registerTool(
  "clips_control_reset_source_pool_item",
  {
    title: "Reset CopScopes source pool item",
    description: "Reset a failed or reviewable CopScopes source Reel back to available for a controlled retry.",
    inputSchema: z.object({
      channelUsername: z.string().optional(),
      reelId: z.string().optional(),
      shortcode: z.string().optional(),
      url: z.string().optional()
    })
  },
  async ({ channelUsername, reelId, shortcode, url }) => {
    if (remoteMode) {
      return remoteControl("clips_control_reset_source_pool_item", {
        channelUsername,
        reelId,
        shortcode,
        url
      });
    }
    const localAuth = getLocalAuth();
    const channel = resolveChannel(channelUsername);
    const reel = resetCopscopesSourceReelForRetry({
      workspaceId: localAuth.workspace.id,
      channelId: channel.id,
      reelId,
      shortcode,
      url
    });
    auditControl({
      action: "copscopes_control.reset_source_pool_item.succeeded",
      channelId: channel.id,
      entityId: reel.id,
      status: "succeeded",
      payload: {
        shortcode: reel.shortcode,
        status: reel.status
      }
    });
    return jsonContent({ reel });
  }
);

server.registerTool(
  "clips_control_run_daily_pool",
  {
    title: "Run CopScopes daily pool",
    description: "Select up to three available CopScopes Reels from the active category and run/dry-run the daily workflow.",
    inputSchema: z.object({
      channelUsername: z.string().optional(),
      categorySlug: z.string().optional(),
      limit: z.number().int().min(1).max(3).optional(),
      attemptBudget: z.number().int().min(1).max(12).optional(),
      dryRun: z.boolean().optional(),
      async: z.boolean().optional(),
      background: z.boolean().optional()
    })
  },
  async ({ channelUsername, categorySlug, limit, attemptBudget, dryRun, async: runAsync, background }) => {
    if (remoteMode) {
      return remoteControl("clips_control_run_daily_pool", {
        channelUsername,
        categorySlug,
        limit,
        attemptBudget,
        dryRun: Boolean(dryRun),
        async: Boolean(runAsync),
        background: Boolean(background)
      });
    }
    const localAuth = getLocalAuth();
    const channel = resolveChannel(channelUsername);
    if ((Boolean(runAsync) || Boolean(background)) && !Boolean(dryRun)) {
      const runId = newControlRunId();
      auditControl({
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
        workspaceId: localAuth.workspace.id,
        channelId: channel.id,
        userId: localAuth.user.id,
        runId,
        categorySlug,
        limit,
        attemptBudget,
        dryRun: false
      }).catch((error) => {
        appendFlowAuditEvent({
          workspaceId: localAuth.workspace.id,
          userId: localAuth.user.id,
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
      return jsonContent({
        channel,
        accepted: true,
        async: true,
        runId
      });
    }
    const result = await runCopscopesDailyPool({
      workspaceId: localAuth.workspace.id,
      channelId: channel.id,
      userId: localAuth.user.id,
      categorySlug,
      limit,
      attemptBudget,
      dryRun: Boolean(dryRun)
    });
    auditControl({
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
    return jsonContent(result);
  }
);

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
