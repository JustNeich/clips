import { requireAuth } from "../../../../lib/auth/guards";
import {
  createManagedTemplate,
  listManagedTemplateSummaries
} from "../../../../lib/managed-template-store";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const auth = await requireAuth(request);
  const templates = await listManagedTemplateSummaries(auth.workspace.id);
  return Response.json(
    {
      templates,
      capabilities: {
        canCreate: true,
        visibilityScope: "workspace"
      }
    },
    { status: 200 }
  );
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireAuth(request);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const template = await createManagedTemplate(body ?? {}, {
    workspaceId: auth.workspace.id,
    creatorUserId: auth.user.id,
    creatorDisplayName: auth.user.displayName
  });
  return Response.json({ template }, { status: 201 });
}
