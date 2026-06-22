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

export const clipsOwnerRenderVideoInputSchema = z.object({
  ...channelRefSchema,
  chatId: z.string(),
  templateId: z.string().optional(),
  sourceDurationSec: z.number().positive().optional(),
  publishAfterRender: z.boolean().optional(),
  snapshot: looseObjectSchema.optional()
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
    inputSchema: z.object({
      ...channelRefSchema,
      name: z.string().optional(),
      username: z.string().optional(),
      systemPrompt: z.string().optional(),
      descriptionPrompt: z.string().optional(),
      examplesJson: z.string().optional(),
      templateId: z.string().optional(),
      defaultClipDurationSec: z.number().int().optional()
    })
  },
  async (input) => ownerControl("clips_owner_update_channel", input)
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
      "Enqueue a Stage 3 render for a chat on a channel. Returns the render job, a poll url, and an authenticated download url. Pass sourceDurationSec (seconds) to render the FULL source (e.g. a 53.6s talking-head) instead of the channel default clip length; omit it to use the channel's default duration.",
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
    title: "Render Clips Stage 3 preview frames",
    description:
      "Enqueue a headless Stage 3 PREVIEW job (full-phone frames, not a final MP4) for the editor/judge loop in a routine. Pass sourceUrl and the editor's snapshot (renderPlan.sourceCrop/videoFit/segments/...). Returns a job id and a poll url; poll /api/stage3/preview/jobs/<id> for the frames. No vision logic runs server-side.",
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
  "clips_owner_run_copscopes_daily_pool",
  {
    title: "Run CopScopes daily pool",
    description: "Run or dry-run the existing end-to-end CopScopes source-to-publication workflow.",
    inputSchema: z.object({
      ...channelRefSchema,
      categorySlug: z.string().optional(),
      limit: z.number().int().min(1).max(3).optional(),
      attemptBudget: z.number().int().min(1).max(12).optional(),
      dryRun: z.boolean().optional(),
      async: z.boolean().optional(),
      background: z.boolean().optional()
    })
  },
  async (input) => ownerControl("clips_owner_run_copscopes_daily_pool", input)
);

server.registerTool(
  "clips_owner_run_video_pipeline",
  {
    title: "Run Clips video pipeline",
    description: "Run the daily-pool pipeline, or create a chat and enqueue Stage 2 for one source URL.",
    inputSchema: z.object({
      ...channelRefSchema,
      sourceUrl: z.string().optional(),
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
      categorySlug: z.string().optional(),
      limit: z.number().int().min(1).max(3).optional(),
      attemptBudget: z.number().int().min(1).max(12).optional(),
      dryRun: z.boolean().optional(),
      async: z.boolean().optional(),
      background: z.boolean().optional()
    })
  },
  async (input) => ownerControl("clips_owner_run_video_pipeline", input)
);

server.registerTool(
  "clips_owner_run_agent_pipeline",
  {
    title: "Run Clips agent pipeline (decomposition)",
    description:
      "AGENT-ONLY. Create/get a chat for one source URL, download the source, and produce a reusable Stage-1 decomposition (comments + 1fps frames + subtitles + meta). Does NOT generate Stage 2 captions and does NOT alter the human manual flow. Poll the returned source job, then read clips_flow_get_source_decomposition.",
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
