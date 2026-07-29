import { requireOwner } from "../../../../lib/auth/guards";
import {
  createMcpMachineCredential,
  listMcpMachineCredentials,
  McpMachineCredentialInputError,
  normalizeMcpMachineAllowedChannelIds,
  type McpMachineCredentialScope
} from "../../../../lib/mcp-machine-credential-store";
import { getChannelById } from "../../../../lib/chat-history";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const auth = await requireOwner(request);
    return Response.json({ machines: listMcpMachineCredentials(auth.workspace.id) }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить MCP machine credentials." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = await requireOwner(request);
    const body = (await request.json().catch(() => null)) as
      | {
          machineId?: string;
          scopes?: McpMachineCredentialScope[];
          allowedChannelIds?: string[];
          rotatesInDays?: number;
          replaceExisting?: boolean;
        }
      | null;
    const machineId = body?.machineId?.trim() || "macmini-agent";
    if (body?.scopes !== undefined && !Array.isArray(body.scopes)) {
      return Response.json(
        { error: "scopes must be an array.", code: "INVALID_MACHINE_SCOPES", field: "scopes" },
        { status: 400 }
      );
    }
    if (body?.allowedChannelIds !== undefined && !Array.isArray(body.allowedChannelIds)) {
      return Response.json(
        { error: "allowedChannelIds must be an array.", code: "INVALID_PUBLISHING_CHANNEL_ALLOWLIST", field: "allowedChannelIds" },
        { status: 400 }
      );
    }
    const scopes = body?.scopes;
    if (
      body?.allowedChannelIds &&
      (body.allowedChannelIds.length > 100 ||
        body.allowedChannelIds.some((channelId) => typeof channelId !== "string" || !channelId.trim()))
    ) {
      return Response.json(
        { error: "allowedChannelIds must contain at most 100 non-empty Clips channel ids.", code: "INVALID_PUBLISHING_CHANNEL_ALLOWLIST", field: "allowedChannelIds" },
        { status: 400 }
      );
    }
    const allowedChannelIds = normalizeMcpMachineAllowedChannelIds(body?.allowedChannelIds);
    if (scopes?.some((scope) => scope === "publication:create" || scope === "publication:read")) {
      for (const channelId of allowedChannelIds) {
        const channel = await getChannelById(channelId);
        if (!channel || channel.workspaceId !== auth.workspace.id || channel.archivedAt) {
          return Response.json(
            {
              error: "Publishing channel allowlist contains an unavailable channel.",
              code: "INVALID_PUBLISHING_CHANNEL_ALLOWLIST",
              field: "allowedChannelIds"
            },
            { status: 400 }
          );
        }
      }
    }
    const created = createMcpMachineCredential({
      workspaceId: auth.workspace.id,
      ownerUserId: auth.user.id,
      machineId,
      scopes,
      allowedChannelIds,
      rotatesInDays: body?.rotatesInDays,
      replaceExisting: body?.replaceExisting ?? false
    });
    return Response.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    if (error instanceof McpMachineCredentialInputError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось создать MCP machine credential." },
      { status: 500 }
    );
  }
}
