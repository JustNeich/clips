import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/db/client";
import {
  readManagedTemplate,
  updateManagedTemplate
} from "../../../../lib/managed-template-store";
import type { ManagedTemplate } from "../../../../lib/managed-template-types";

export const runtime = "nodejs";

const TARGET_CHANNELS = [
  { username: "copscopes", name: "COP SCOPES" },
  { username: "ghostscopes", name: "GHOST SCOPES" }
] as const;

type ChannelRow = {
  id: string;
  workspace_id: string;
  name: string;
  username: string;
  template_id: string;
};

function isAuthorized(request: Request): boolean {
  const secret = process.env.APP_BOOTSTRAP_SECRET?.trim();
  return Boolean(secret && request.headers.get("x-codex-ops-secret") === secret);
}

function readChannel(username: string): ChannelRow | null {
  const row = getDb()
    .prepare(
      `SELECT id, workspace_id, name, username, template_id
       FROM channels
       WHERE lower(username) = ?
         AND archived_at IS NULL
       ORDER BY created_at ASC
       LIMIT 1`
    )
    .get(username.toLowerCase()) as ChannelRow | undefined;
  return row ?? null;
}

function summarizeTemplate(template: ManagedTemplate): Record<string, unknown> {
  return {
    content: {
      channelName: template.content.channelName,
      channelHandle: template.content.channelHandle,
      topFontScale: template.content.topFontScale,
      bottomFontScale: template.content.bottomFontScale
    },
    card: {
      x: template.templateConfig.card.x,
      y: template.templateConfig.card.y,
      width: template.templateConfig.card.width,
      height: template.templateConfig.card.height,
      radius: template.templateConfig.card.radius,
      borderWidth: template.templateConfig.card.borderWidth
    },
    author: {
      avatarSize: template.templateConfig.author.avatarSize,
      gap: template.templateConfig.author.gap,
      copyGap: template.templateConfig.author.copyGap,
      checkSize: template.templateConfig.author.checkSize,
      nameFont: template.templateConfig.typography.authorName.font,
      handleFont: template.templateConfig.typography.authorHandle.font
    },
    channelStory: template.templateConfig.channelStory
      ? {
          contentPaddingTop: template.templateConfig.channelStory.contentPaddingTop,
          contentPaddingX: template.templateConfig.channelStory.contentPaddingX,
          headerHeight: template.templateConfig.channelStory.headerHeight,
          headerToLeadGap: template.templateConfig.channelStory.headerToLeadGap,
          leadHeight: template.templateConfig.channelStory.leadHeight,
          leadToBodyGap: template.templateConfig.channelStory.leadToBodyGap,
          bodyHeight: template.templateConfig.channelStory.bodyHeight,
          bodyToMediaGap: template.templateConfig.channelStory.bodyToMediaGap,
          mediaInsetX: template.templateConfig.channelStory.mediaInsetX,
          mediaRadius: template.templateConfig.channelStory.mediaRadius
        }
      : null
  };
}

async function calibrateChannel(target: (typeof TARGET_CHANNELS)[number]) {
  const channel = readChannel(target.username);
  if (!channel) {
    return {
      username: target.username,
      ok: false,
      error: "Channel not found."
    };
  }

  const template = await readManagedTemplate(channel.template_id, { workspaceId: channel.workspace_id });
  if (!template) {
    return {
      username: target.username,
      ok: false,
      channelId: channel.id,
      error: "Template not found."
    };
  }

  const before = summarizeTemplate(template);
  const updated = await updateManagedTemplate(
    template.id,
    {
      name: template.name,
      description: template.description,
      layoutFamily: template.layoutFamily,
      baseTemplateId: template.baseTemplateId,
      content: {
        ...template.content,
        channelName: target.name,
        channelHandle: `@${target.username}`,
        topFontScale: 1.2,
        bottomFontScale: 1
      },
      templateConfig: {
        ...template.templateConfig,
        layoutKind: "channel_story",
        card: {
          ...template.templateConfig.card,
          x: 0,
          y: 0,
          width: 1080,
          height: 1920,
          radius: 0,
          borderWidth: 0,
          borderColor: "#000000",
          fill: "#050607",
          shadow: "none"
        },
        author: {
          ...template.templateConfig.author,
          name: target.name,
          handle: `@${target.username}`,
          avatarSize: 146,
          avatarBorder: 0,
          checkSize: 0,
          gap: 20,
          copyGap: 0,
          nameCheckGap: 0,
          checkAssetPath: ""
        },
        palette: {
          ...template.templateConfig.palette,
          cardFill: "#050607",
          topSectionFill: "#050607",
          bottomSectionFill: "#050607",
          topTextColor: "#ffffff",
          bottomTextColor: "#f8f8f5",
          authorNameColor: "#ffffff",
          authorHandleColor: "#d5d8df",
          accentColor: "#f0d83a",
          borderColor: "#000000"
        },
        typography: {
          ...template.templateConfig.typography,
          authorName: {
            ...template.templateConfig.typography.authorName,
            font: 48,
            lineHeight: 1.02,
            weight: 800,
            letterSpacing: "0"
          },
          authorHandle: {
            ...template.templateConfig.typography.authorHandle,
            font: 28,
            lineHeight: 1.08,
            weight: 500,
            letterSpacing: "0"
          },
          top: {
            ...template.templateConfig.typography.top,
            min: 44,
            max: 98,
            lineHeight: 0.94,
            weight: 900,
            letterSpacing: "0",
            horizontalSafety: 0.965,
            fillTargetMin: 0.88,
            fillTargetMax: 0.98,
            textShadow:
              "0 0 4px rgba(255,255,255,0.96), 0 0 12px rgba(255,255,255,0.9), 0 0 28px rgba(54,145,255,0.98), 0 0 56px rgba(31,104,255,0.72)"
          },
          bottom: {
            ...template.templateConfig.typography.bottom,
            min: 30,
            max: 52,
            lineHeight: 1.06,
            weight: 800,
            letterSpacing: "0",
            horizontalSafety: 0.975,
            fillTargetMin: 0.86,
            fillTargetMax: 0.95,
            textShadow:
              template.templateConfig.typography.bottom.textShadow ??
              "0 0 7px rgba(0,0,0,0.68)"
          }
        },
        channelStory: template.templateConfig.channelStory
          ? {
              ...template.templateConfig.channelStory,
              leadMode: "clip_custom",
              defaultLeadText: "Did they tell you...",
              headerAlign: "center",
              bodyTextAlign: "center",
              contentPaddingX: 44,
              contentPaddingTop: 28,
              contentPaddingBottom: 28,
              headerHeight: 154,
              headerToLeadGap: 4,
              leadHeight: 150,
              leadToBodyGap: 4,
              bodyHeight: 330,
              bodyToMediaGap: 22,
              footerHeight: 72,
              mediaInsetX: 0,
              mediaRadius: 0,
              mediaBorderWidth: 0,
              mediaBorderColor: "rgba(255,255,255,0)",
              accentTopLineWidth: 0,
              accentBottomLineWidth: 0,
              leadGlowEnabled: true,
              leadGlowColor: "rgba(42,132,255,0.9)",
              leadGlowHeight: 82,
              leadGlowBlur: 30,
              leadGlowOpacity: 0.82,
              leadGlowSpreadX: 280
            }
          : template.templateConfig.channelStory
      },
      shadowLayers: []
    },
    { workspaceId: channel.workspace_id }
  );

  if (!updated) {
    return {
      username: target.username,
      ok: false,
      channelId: channel.id,
      templateId: template.id,
      error: "Template update failed."
    };
  }

  return {
    username: target.username,
    ok: true,
    channelId: channel.id,
    templateId: updated.id,
    before,
    after: summarizeTemplate(updated)
  };
}

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const results = await Promise.all(TARGET_CHANNELS.map((target) => calibrateChannel(target)));
  const ok = results.every((result) => result.ok);
  return NextResponse.json({ ok, results }, { status: ok ? 200 : 207 });
}
