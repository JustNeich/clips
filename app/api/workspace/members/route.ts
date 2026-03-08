import { requireAuth } from "../../../../lib/auth/guards";
import { listWorkspaceMembers } from "../../../../lib/team-store";
import { asErrorResponse } from "../../../../lib/http";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const auth = await requireAuth();
    if (auth.membership.role !== "owner" && auth.membership.role !== "manager") {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }
    const members = listWorkspaceMembers(auth.workspace.id);
    return Response.json({ members }, { status: 200 });
  } catch (error) {
    return asErrorResponse(error, "Не удалось получить список участников.");
  }
}
