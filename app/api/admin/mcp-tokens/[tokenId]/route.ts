import { requireOwner } from "../../../../../lib/auth/guards";
import { revokeMcpAccessToken } from "../../../../../lib/mcp-token-store";

export const runtime = "nodejs";

type Context = { params: Promise<{ tokenId: string }> };

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const { tokenId } = await context.params;
  try {
    const auth = await requireOwner(request);
    const token = revokeMcpAccessToken({
      workspaceId: auth.workspace.id,
      tokenId,
      ownerUserId: auth.user.id
    });
    if (!token) {
      return Response.json({ error: "MCP token not found." }, { status: 404 });
    }
    return Response.json({ token }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось отозвать MCP token." },
      { status: 500 }
    );
  }
}
