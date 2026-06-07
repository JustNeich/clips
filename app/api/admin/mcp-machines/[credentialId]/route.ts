import { requireOwner } from "../../../../../lib/auth/guards";
import { revokeMcpMachineCredential } from "../../../../../lib/mcp-machine-credential-store";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ credentialId: string }> }
): Promise<Response> {
  try {
    const auth = await requireOwner(request);
    const { credentialId } = await context.params;
    const credential = revokeMcpMachineCredential({
      workspaceId: auth.workspace.id,
      credentialId,
      ownerUserId: auth.user.id
    });
    if (!credential) {
      return Response.json({ error: "MCP machine credential not found." }, { status: 404 });
    }
    return Response.json({ credential }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось отозвать MCP machine credential." },
      { status: 500 }
    );
  }
}
