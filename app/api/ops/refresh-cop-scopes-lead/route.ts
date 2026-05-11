import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/db/client";
import { readManagedTemplate, updateManagedTemplate } from "../../../../lib/managed-template-store";

export const runtime = "nodejs";

type ChannelRow = {
  id: string;
  workspace_id: string;
  name: string;
  username: string;
  template_id: string;
};

function isAuthorized(request: Request): boolean {
  const secret = process.env.APP_BOOTSTRAP_SECRET?.trim();
  return Boolean(secret && request.headers.get("x-app-bootstrap-secret") === secret);
}

export async function POST(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const channel = getDb()
    .prepare(
      `SELECT id, workspace_id, name, username, template_id
       FROM channels
       WHERE lower(username) = 'copscopes' AND archived_at IS NULL
       LIMIT 1`
    )
    .get() as ChannelRow | undefined;

  if (!channel) {
    return NextResponse.json({ ok: false, error: "COP SCOPES channel not found" }, { status: 404 });
  }

  const template = await readManagedTemplate(channel.template_id, { workspaceId: channel.workspace_id });
  if (!template) {
    return NextResponse.json({ ok: false, error: "COP SCOPES template not found" }, { status: 404 });
  }

  const updated = await updateManagedTemplate(
    template.id,
    {
      name: template.name,
      description: template.description,
      layoutFamily: template.layoutFamily,
      baseTemplateId: template.baseTemplateId,
      content: {
        ...template.content,
        topText: "Did they tell you...",
        channelName: "COP SCOPES",
        channelHandle: "@copscopes",
        topFontScale: 1.32,
        bottomFontScale: 1.02
      },
      templateConfig: {
        ...template.templateConfig,
        palette: {
          ...template.templateConfig.palette,
          topTextColor: "#ffffff",
          bottomTextColor: "#f8f8f5",
          accentColor: "#f0d83a"
        },
        typography: {
          ...template.templateConfig.typography,
          top: {
            ...template.templateConfig.typography.top,
            weight: 900,
            lineHeight: 0.92,
            letterSpacing: "-0.018em",
            textShadow:
              "0 0 4px rgba(255,255,255,0.96), 0 0 12px rgba(255,255,255,0.9), 0 0 28px rgba(54,145,255,0.98), 0 0 56px rgba(31,104,255,0.72)"
          },
          bottom: {
            ...template.templateConfig.typography.bottom,
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
              headerHeight: 112,
              headerToLeadGap: 8,
              leadHeight: 146,
              leadToBodyGap: 8,
              leadGlowEnabled: true,
              leadGlowColor: "rgba(42,132,255,0.9)",
              leadGlowHeight: 76,
              leadGlowBlur: 28,
              leadGlowOpacity: 0.86,
              leadGlowSpreadX: 250
            }
          : template.templateConfig.channelStory
      },
      shadowLayers: template.shadowLayers
    },
    { workspaceId: channel.workspace_id }
  );

  if (!updated) {
    return NextResponse.json({ ok: false, error: "COP SCOPES template update failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    channelId: channel.id,
    username: channel.username,
    templateId: updated.id,
    topText: updated.content.topText,
    topFontScale: updated.content.topFontScale,
    leadGlow: updated.templateConfig.channelStory
      ? {
          enabled: updated.templateConfig.channelStory.leadGlowEnabled,
          color: updated.templateConfig.channelStory.leadGlowColor,
          height: updated.templateConfig.channelStory.leadGlowHeight,
          blur: updated.templateConfig.channelStory.leadGlowBlur,
          opacity: updated.templateConfig.channelStory.leadGlowOpacity,
          spreadX: updated.templateConfig.channelStory.leadGlowSpreadX
        }
      : null
  });
}
