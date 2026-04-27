import { requireOwner } from "../../../../lib/auth/guards";
import { createMcpAccessToken, listMcpAccessTokens } from "../../../../lib/mcp-token-store";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const auth = await requireOwner(request);
    return Response.json({ tokens: listMcpAccessTokens(auth.workspace.id) }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить MCP tokens." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = await requireOwner(request);
    const body = (await request.json().catch(() => null)) as { expiresInDays?: number } | null;
    const created = createMcpAccessToken({
      workspaceId: auth.workspace.id,
      ownerUserId: auth.user.id,
      expiresInDays: body?.expiresInDays
    });
    return Response.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось создать MCP token." },
      { status: 500 }
    );
  }
}
