import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";

type JsonRecord = Record<string, unknown>;

const appUrl = (process.env.CLIPS_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");

function getToken(): string {
  const token = process.env.CLIPS_MCP_TOKEN?.trim() ?? "";
  if (!token) {
    throw new Error("CLIPS_MCP_TOKEN is required.");
  }
  return token;
}

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

async function ownerControl(tool: string, input: JsonRecord = {}): Promise<ReturnType<typeof jsonContent>> {
  const response = await fetch(`${appUrl}/api/admin/control`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ tool, input })
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as JsonRecord).error)
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return jsonContent(payload);
}

const channelRefSchema = {
  channelId: z.string().optional(),
  channelUsername: z.string().optional(),
  username: z.string().optional()
};

const looseObjectSchema = z.object({}).passthrough();

export const clipsOwnerUpdateChannelInputSchema = z.object({
  ...channelRefSchema,
  name: z.string().optional(),
  username: z.string().optional(),
  systemPrompt: z.string().optional(),
  descriptionPrompt: z.string().optional(),
  examplesJson: z.string().optional(),
  stage2ExamplesConfig: looseObjectSchema.optional(),
  stage2HardConstraints: looseObjectSchema.optional(),
  stage2PromptConfig: looseObjectSchema.optional(),
  stage2SourceOverlayConfig: looseObjectSchema.optional(),
  templateId: z.string().optional(),
  avatarAssetId: z.string().nullable().optional(),
  defaultBackgroundAssetId: z.string().nullable().optional(),
  defaultMusicAssetId: z.string().nullable().optional(),
  defaultClipDurationSec: z.number().int().optional()
});

export const clipsOwnerUploadChannelAssetInputSchema = z.object({
  ...channelRefSchema,
  kind: z.enum(["avatar", "background", "music"]),
  fileName: z.string().optional(),
  mimeType: z.string(),
  dataBase64: z.string(),
  setAsDefault: z.boolean().optional()
});

export const clipsOwnerUpdateChannelPublishSettingsInputSchema = z.object({
  ...channelRefSchema,
  timezone: z.string().optional(),
  firstSlotLocalTime: z.string().optional(),
  dailySlotCount: z.number().int().min(1).max(12).optional(),
  slotIntervalMinutes: z.number().int().min(5).max(240).optional(),
  autoQueueEnabled: z.boolean().optional(),
  uploadLeadMinutes: z.number().int().min(5).max(1440).optional(),
  notifySubscribersByDefault: z.boolean().optional()
});

export const clipsOwnerRenderVideoInputSchema = z.object({
  ...channelRefSchema,
  chatId: z.string(),
  sourceDurationSec: z.number().positive().optional(),
  publishAfterRender: z.boolean().optional(),
  snapshot: looseObjectSchema.optional()
});

export const clipsOwnerRunVideoPipelineInputSchema = z
  .object({
    ...channelRefSchema,
    sourceUrl: z.string().min(1),
    title: z.string().optional(),
    eventText: z.string().optional(),
    userInstruction: z.string().optional(),
    mode: z.enum(["manual", "auto", "platform_v1", "agent_manual"]).optional(),
    agentCaption: z
      .object({
        top: z.string(),
        bottom: z.string(),
        topRu: z.string().optional(),
        bottomRu: z.string().optional(),
        highlights: z.any().optional()
      })
      .optional(),
    dryRun: z.boolean().optional(),
    async: z.boolean().optional()
  })
  .superRefine((value, context) => {
    if (value.mode === "agent_manual" && !value.agentCaption) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["agentCaption"],
        message: "agentCaption is required when mode=agent_manual; platform fallback is forbidden."
      });
    }
  });

const server = new McpServer({
  name: "clips-owner-control",
  version: "1.0.0"
});

server.registerTool(
  "clips_owner_status",
  {
    title: "Get Clips owner status",
    description: "Read workspace readiness, integrations, recent flows, publication counts, and Stage 3 workers.",
    inputSchema: z.object({})
  },
  async () => ownerControl("clips_owner_status")
);

server.registerTool(
  "clips_owner_get_integrations_readiness",
  {
    title: "Get Clips integrations readiness",
    description: "Read Codex, Anthropic, OpenRouter, caption provider and Stage 3 readiness without exposing raw secrets.",
    inputSchema: z.object({})
  },
  async () => ownerControl("clips_owner_get_integrations_readiness")
);

server.registerTool(
  "clips_owner_list_channels",
  {
    title: "List Clips channels",
    description: "List workspace channels with publishing readiness.",
    inputSchema: z.object({
      includeArchived: z.boolean().optional()
    })
  },
  async (input) => ownerControl("clips_owner_list_channels", input)
);

server.registerTool(
  "clips_owner_get_channel",
  {
    title: "Get Clips channel",
    description: "Get one channel by id or username.",
    inputSchema: z.object(channelRefSchema)
  },
  async (input) => ownerControl("clips_owner_get_channel", input)
);

server.registerTool(
  "clips_owner_create_channel",
  {
    title: "Create Clips channel",
    description: "Create a workspace channel with optional username, prompts, template and default duration.",
    inputSchema: z.object({
      name: z.string().optional(),
      username: z.string().optional(),
      systemPrompt: z.string().optional(),
      descriptionPrompt: z.string().optional(),
      examplesJson: z.string().optional(),
      stage2ExamplesConfig: looseObjectSchema.optional(),
      stage2HardConstraints: looseObjectSchema.optional(),
      stage2PromptConfig: looseObjectSchema.optional(),
      stage2SourceOverlayConfig: looseObjectSchema.optional(),
      templateId: z.string().optional(),
      defaultClipDurationSec: z.number().int().optional()
    })
  },
  async (input) => ownerControl("clips_owner_create_channel", input)
);

server.registerTool(
  "clips_owner_update_channel",
  {
    title: "Update Clips channel",
    description: "Update a workspace channel's identity, prompts, template, or default duration.",
    inputSchema: clipsOwnerUpdateChannelInputSchema
  },
  async (input) => ownerControl("clips_owner_update_channel", input)
);

server.registerTool(
  "clips_owner_upload_channel_asset",
  {
    title: "Upload Clips channel asset",
    description:
      "Upload an avatar, background, or music asset and optionally make it the channel default.",
    inputSchema: clipsOwnerUploadChannelAssetInputSchema
  },
  async (input) => ownerControl("clips_owner_upload_channel_asset", input)
);

server.registerTool(
  "clips_owner_update_channel_publish_settings",
  {
    title: "Update Clips channel publish settings",
    description:
      "Update a channel's timezone, slot grid, auto-queue, upload lead, and subscriber notification defaults.",
    inputSchema: clipsOwnerUpdateChannelPublishSettingsInputSchema
  },
  async (input) => ownerControl("clips_owner_update_channel_publish_settings", input)
);

server.registerTool(
  "clips_owner_delete_channel",
  {
    title: "Delete Clips channel",
    description: "Delete a channel. Requires intent containing the exact channel id.",
    inputSchema: z.object({
      ...channelRefSchema,
      intent: z.string()
    })
  },
  async (input) => ownerControl("clips_owner_delete_channel", input)
);

server.registerTool(
  "clips_owner_list_templates",
  {
    title: "List Clips templates",
    description: "List managed workspace template summaries.",
    inputSchema: z.object({})
  },
  async () => ownerControl("clips_owner_list_templates")
);

const templateBodySchema = {
  name: z.string().optional(),
  description: z.string().optional(),
  layoutFamily: z.string().optional(),
  baseTemplateId: z.string().optional(),
  content: z.record(z.string(), z.unknown()).optional(),
  templateConfig: z.record(z.string(), z.unknown()).optional(),
  shadowLayers: z.array(z.record(z.string(), z.unknown())).optional()
};

server.registerTool(
  "clips_owner_create_template",
  {
    title: "Create Clips template",
    description:
      "Create a managed workspace template from a layout family with optional content, template config, and shadow layers.",
    inputSchema: z.object(templateBodySchema)
  },
  async (input) => ownerControl("clips_owner_create_template", input)
);

server.registerTool(
  "clips_owner_get_template",
  {
    title: "Get Clips template",
    description: "Get one managed workspace template by id, including content and template config.",
    inputSchema: z.object({
      templateId: z.string()
    })
  },
  async (input) => ownerControl("clips_owner_get_template", input)
);

server.registerTool(
  "clips_owner_update_template",
  {
    title: "Update Clips template",
    description: "Update a managed workspace template's name, description, content, or template config.",
    inputSchema: z.object({
      templateId: z.string(),
      ...templateBodySchema
    })
  },
  async (input) => ownerControl("clips_owner_update_template", input)
);

server.registerTool(
  "clips_owner_render_video",
  {
    title: "Render Clips video",
    description:
      "Enqueue Stage 3 for one chat on its exact channel. The channel's assigned template is authoritative and the caller cannot choose another one. Keep publishAfterRender=false until an explicit owner publication gate. If the tool returns repair_required, fix that one condition and retry the same step; it does not finish the production task. Pass sourceDurationSec only when the story needs the full explicit duration.",
    inputSchema: clipsOwnerRenderVideoInputSchema
  },
  async (input) => ownerControl("clips_owner_render_video", input)
);

server.registerTool(
  "clips_owner_list_members",
  {
    title: "List Clips workspace members",
    description: "List workspace members and roles.",
    inputSchema: z.object({})
  },
  async () => ownerControl("clips_owner_list_members")
);

server.registerTool(
  "clips_owner_list_channel_access",
  {
    title: "List Clips channel access",
    description: "List explicit user grants for a channel.",
    inputSchema: z.object(channelRefSchema)
  },
  async (input) => ownerControl("clips_owner_list_channel_access", input)
);

server.registerTool(
  "clips_owner_set_channel_access",
  {
    title: "Grant Clips channel access",
    description: "Grant operate access for a user on a channel.",
    inputSchema: z.object({
      ...channelRefSchema,
      userId: z.string()
    })
  },
  async (input) => ownerControl("clips_owner_set_channel_access", input)
);

server.registerTool(
  "clips_owner_revoke_channel_access",
  {
    title: "Revoke Clips channel access",
    description: "Revoke a user's explicit channel grant. Requires intent containing channelId:userId.",
    inputSchema: z.object({
      ...channelRefSchema,
      userId: z.string(),
      intent: z.string()
    })
  },
  async (input) => ownerControl("clips_owner_revoke_channel_access", input)
);

server.registerTool(
  "clips_owner_list_publications",
  {
    title: "List Clips publications",
    description: "List publication queue records across the workspace or one channel.",
    inputSchema: z.object({
      ...channelRefSchema,
      status: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional()
    })
  },
  async (input) => ownerControl("clips_owner_list_publications", input)
);

server.registerTool(
  "clips_owner_get_flow",
  {
    title: "Get Clips flow detail",
    description: "Get a redacted flow detail by chat id.",
    inputSchema: z.object({
      chatId: z.string(),
      selectedRunId: z.string().optional()
    })
  },
  async (input) => ownerControl("clips_owner_get_flow", input)
);

server.registerTool(
  "clips_owner_list_render_exports",
  {
    title: "List approved Clips montage history",
    description:
      "List the most recent JUDGE-APPROVED montage snapshots for a channel (optionally one templateId), to seed the vision editor with worked examples. Read-only; returns montage geometry (sourceCrop, videoFit, focus, segments, watermarkBlurs, clip window) plus the approval marker. Returns an empty list when there is no approved history.",
    inputSchema: z.object({
      ...channelRefSchema,
      templateId: z.string().optional(),
      limit: z.number().int().min(1).max(25).optional()
    })
  },
  async (input) => ownerControl("clips_owner_list_render_exports", input)
);

server.registerTool(
  "clips_owner_render_preview",
  {
    title: "Prepare Clips Stage 3 source preview",
    description:
      "Prepare only the inner source-media preview used for crop/timing checks. This is not a full vertical template preview and cannot approve the final format. The selected channel's assigned template is authoritative; a missing or mismatched template blocks the job.",
    inputSchema: z.object({
      ...channelRefSchema,
      sourceUrl: z.string(),
      chatId: z.string().optional(),
      snapshot: looseObjectSchema.optional()
    })
  },
  async (input) => ownerControl("clips_owner_render_preview", input)
);

server.registerTool(
  "clips_owner_update_publication",
  {
    title: "Update Clips publication",
    description: "Edit title, description, tags, schedule, or notify flag for a queued/scheduled publication.",
    inputSchema: z.object({
      publicationId: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
      notifySubscribers: z.boolean().optional(),
      scheduledAtLocal: z.string().optional(),
      slotDate: z.string().optional(),
      slotIndex: z.number().int().optional()
    })
  },
  async (input) => ownerControl("clips_owner_update_publication", input)
);

server.registerTool(
  "clips_owner_schedule_publication",
  {
    title: "Schedule Clips publication",
    description: "Move or restore a publication into a custom time or channel slot.",
    inputSchema: z.object({
      publicationId: z.string(),
      scheduledAtLocal: z.string().optional(),
      slotDate: z.string().optional(),
      slotIndex: z.number().int().optional()
    })
  },
  async (input) => ownerControl("clips_owner_schedule_publication", input)
);

server.registerTool(
  "clips_owner_cancel_publication",
  {
    title: "Cancel or delete Clips publication",
    description: "Cancel a publication and optionally remote-delete a published YouTube video. Requires intent containing the exact publication id.",
    inputSchema: z.object({
      publicationId: z.string(),
      intent: z.string(),
      allowPublished: z.boolean().optional()
    })
  },
  async (input) => ownerControl("clips_owner_cancel_publication", input)
);

server.registerTool(
  "clips_owner_list_stage3_workers",
  {
    title: "List Stage 3 workers",
    description: "List paired local Stage 3 workers and current jobs.",
    inputSchema: z.object({
      userId: z.string().optional()
    })
  },
  async (input) => ownerControl("clips_owner_list_stage3_workers", input)
);

server.registerTool(
  "clips_owner_pair_stage3_worker",
  {
    title: "Create Stage 3 worker pairing token",
    description: "Create a pairing token, deep link, and CLI commands for a local Stage 3 worker.",
    inputSchema: z.object({
      label: z.string().optional()
    })
  },
  async (input) => ownerControl("clips_owner_pair_stage3_worker", input)
);

server.registerTool(
  "clips_owner_run_video_pipeline",
  {
    title: "Run Clips video pipeline",
    description:
      "Start the single production path for one explicit source URL: create/open the exact channel chat and enqueue its normal Stage 2. Continue with the same chat in Stage 3. There is no daily-pool fallback and no publication unless it is explicitly approved later.",
    inputSchema: clipsOwnerRunVideoPipelineInputSchema
  },
  async (input) => ownerControl("clips_owner_run_video_pipeline", input)
);

server.registerTool(
  "clips_owner_run_agent_pipeline",
  {
    title: "Run Clips agent pipeline (decomposition)",
    description:
      "ANALYSIS ONLY, NOT A PRODUCTION VIDEO PATH. Create/get a chat for one source URL, download it, and produce a reusable Stage-1 decomposition. It does not run Stage 2, Stage 3, render, or publication. Production videos must use clips_owner_run_video_pipeline.",
    inputSchema: z.object({
      ...channelRefSchema,
      sourceUrl: z.string(),
      title: z.string().optional(),
      eventText: z.string().optional(),
      dryRun: z.boolean().optional()
    })
  },
  async (input) => ownerControl("clips_owner_run_agent_pipeline", input)
);

server.registerTool(
  "clips_flow_get_source_decomposition",
  {
    title: "Get Clips source decomposition",
    description:
      "AGENT-ONLY. Read the Stage-1 decomposition artifact for a chat: comments, 1fps frames (each with a fetchable imageUrl and a description), subtitles, and meta (durationSec/width/height/frameCount/extractedAt).",
    inputSchema: z.object({
      chatId: z.string()
    })
  },
  async (input) => ownerControl("clips_flow_get_source_decomposition", input)
);

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
