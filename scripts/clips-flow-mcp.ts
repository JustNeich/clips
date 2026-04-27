import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

type JsonRecord = Record<string, unknown>;

const appUrl = (process.env.CLIPS_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const token = process.env.CLIPS_MCP_TOKEN?.trim() ?? "";

if (!token) {
  console.error("CLIPS_MCP_TOKEN is required.");
  process.exit(1);
}

async function apiGet(path: string, params?: Record<string, string | number | null | undefined>): Promise<unknown> {
  const url = new URL(`${appUrl}${path}`);
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined && String(value).trim()) {
      url.searchParams.set(key, String(value));
    }
  });
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
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
  return payload;
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

function extractStageRun(detail: unknown, stage: string, id?: string | null): unknown {
  const trace =
    detail && typeof detail === "object" && "trace" in detail
      ? (detail as { trace?: unknown }).trace
      : null;
  if (!trace || typeof trace !== "object") {
    return null;
  }
  const root = trace as JsonRecord;
  if (stage === "source") {
    const jobs = ((root.sourceJobs as unknown[]) ?? []).filter(Boolean);
    return id ? jobs.find((job) => (job as JsonRecord).jobId === id) ?? null : jobs[0] ?? null;
  }
  if (stage === "stage2") {
    const stage2 = root.stage2 as JsonRecord | undefined;
    const runs = ((stage2?.runs as unknown[]) ?? []).filter(Boolean);
    return id ? runs.find((run) => (run as JsonRecord).runId === id) ?? null : runs[0] ?? null;
  }
  if (stage === "stage3") {
    const detailObject = detail as JsonRecord;
    const jobs = ((detailObject.stage3Jobs as unknown[]) ?? []).filter(Boolean);
    if (id) {
      return jobs.find((job) => (job as JsonRecord).id === id) ?? null;
    }
    return {
      latestJob: jobs[0] ?? null,
      jobs,
      trace: (root.stage3 as JsonRecord | undefined) ?? null
    };
  }
  if (stage === "publishing") {
    const detailObject = detail as JsonRecord;
    return {
      flow: detailObject.flow,
      auditEvents: ((detailObject.auditEvents as unknown[]) ?? []).filter((event) => {
        const candidate = event as JsonRecord;
        return candidate.stage === "publishing" || candidate.stage === "youtube";
      })
    };
  }
  return null;
}

const server = new McpServer({
  name: "clips-flow-observability",
  version: "1.0.0"
});

server.registerTool(
  "clips_list_flows",
  {
    title: "List Clips flows",
    description: "List read-only production Clips flows with optional filters.",
    inputSchema: z.object({
      search: z.string().optional(),
      channelId: z.string().optional(),
      stage: z.string().optional(),
      status: z.string().optional(),
      provider: z.string().optional(),
      model: z.string().optional(),
      dateBasis: z.enum(["created", "lastActivity"]).optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      todayFrom: z.string().optional(),
      todayTo: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional()
    })
  },
  async (input) => jsonContent(await apiGet("/api/admin/flows", input))
);

server.registerTool(
  "clips_list_channels",
  {
    title: "List Clips channels",
    description: "Derive visible workspace channels from live flow summaries.",
    inputSchema: z.object({})
  },
  async () => {
    const payload = await apiGet("/api/admin/flows", { limit: 200 });
    const flows = payload && typeof payload === "object" ? ((payload as JsonRecord).flows as JsonRecord[] | undefined) ?? [] : [];
    const channels = [...new Map(
      flows.map((flow) => [
        String(flow.channelId),
        {
          id: flow.channelId,
          name: flow.channelName,
          username: flow.channelUsername
        }
      ])
    ).values()];
    return jsonContent({ channels });
  }
);

server.registerTool(
  "clips_get_flow",
  {
    title: "Get Clips flow",
    description: "Get a redacted end-to-end flow detail by chat id.",
    inputSchema: z.object({
      chatId: z.string(),
      selectedRunId: z.string().optional()
    })
  },
  async ({ chatId, selectedRunId }) =>
    jsonContent(await apiGet(`/api/admin/flows/${encodeURIComponent(chatId)}`, { selectedRunId }))
);

server.registerTool(
  "clips_get_stage_run",
  {
    title: "Get Clips stage run",
    description: "Extract a source, Stage 2, Stage 3, or publishing run from a flow trace.",
    inputSchema: z.object({
      chatId: z.string(),
      stage: z.enum(["source", "stage2", "stage3", "publishing"]),
      id: z.string().optional()
    })
  },
  async ({ chatId, stage, id }) => {
    const detail = await apiGet(`/api/admin/flows/${encodeURIComponent(chatId)}`);
    return jsonContent(extractStageRun(detail, stage, id ?? null));
  }
);

server.registerTool(
  "clips_get_audit_events",
  {
    title: "Get Clips audit events",
    description: "Read append-only audit events.",
    inputSchema: z.object({
      chatId: z.string().optional(),
      channelId: z.string().optional(),
      stage: z.string().optional(),
      status: z.string().optional(),
      severity: z.string().optional(),
      search: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      limit: z.number().int().min(1).max(500).optional()
    })
  },
  async (input) => jsonContent(await apiGet("/api/admin/audit-events", input))
);

server.registerTool(
  "clips_export_trace",
  {
    title: "Export Clips trace",
    description: "Return the redacted trace JSON for a flow.",
    inputSchema: z.object({
      chatId: z.string(),
      selectedRunId: z.string().optional()
    })
  },
  async ({ chatId, selectedRunId }) =>
    jsonContent(await apiGet(`/api/admin/flows/${encodeURIComponent(chatId)}/trace`, { selectedRunId }))
);

server.registerTool(
  "clips_find_by_url_or_video_id",
  {
    title: "Find Clips flow",
    description: "Find flows by source URL, title, YouTube video id, run id, or publication id.",
    inputSchema: z.object({
      query: z.string(),
      limit: z.number().int().min(1).max(100).optional()
    })
  },
  async ({ query, limit }) => jsonContent(await apiGet("/api/admin/flows", { search: query, limit: limit ?? 20 }))
);

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
