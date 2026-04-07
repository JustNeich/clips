import { requireAuth } from "../../../../lib/auth/guards";
import {
  canCreateManagedTemplates,
  filterManagedTemplatesForAuthIncludingVisibleChannels
} from "../../../../lib/managed-template-access";
import {
  createManagedTemplate,
  listManagedTemplateSummaries
} from "../../../../lib/managed-template-store";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const auth = await requireAuth(request);
  const templates = await filterManagedTemplatesForAuthIncludingVisibleChannels(
    auth,
    await listManagedTemplateSummaries()
  );
  return Response.json(
    {
      templates,
      capabilities: {
        canCreate: canCreateManagedTemplates(auth.membership.role),
        visibilityScope:
          auth.membership.role === "owner" || auth.membership.role === "manager" ? "all" : "own"
      }
    },
    { status: 200 }
  );
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireAuth(request);
  if (!canCreateManagedTemplates(auth.membership.role)) {
    return Response.json({ error: "Доступ запрещен." }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const template = await createManagedTemplate(body ?? {}, {
    workspaceId: auth.workspace.id,
    creatorUserId: auth.user.id,
    creatorDisplayName: auth.user.displayName
  });
  return Response.json({ template }, { status: 201 });
}
