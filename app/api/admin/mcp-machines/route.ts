import { requireOwner } from "../../../../lib/auth/guards";
import {
  createMcpMachineCredential,
  listMcpMachineCredentials,
  normalizeMcpMachineCredentialScopes,
  type McpMachineCredentialScope
} from "../../../../lib/mcp-machine-credential-store";

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
          rotatesInDays?: number;
          replaceExisting?: boolean;
        }
      | null;
    const machineId = body?.machineId?.trim() || "macmini-agent";
    const created = createMcpMachineCredential({
      workspaceId: auth.workspace.id,
      ownerUserId: auth.user.id,
      machineId,
      scopes: normalizeMcpMachineCredentialScopes(body?.scopes),
      rotatesInDays: body?.rotatesInDays,
      replaceExisting: body?.replaceExisting ?? false
    });
    return Response.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось создать MCP machine credential." },
      { status: 500 }
    );
  }
}
