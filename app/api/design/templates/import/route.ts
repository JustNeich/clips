import { requireAuth } from "../../../../../lib/auth/guards";
import { importManagedTemplateBackup } from "../../../../../lib/managed-template-store";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const auth = await requireAuth(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const template = await importManagedTemplateBackup(body ?? {}, {
      workspaceId: auth.workspace.id,
      creatorUserId: auth.user.id,
      creatorDisplayName: auth.user.displayName
    });
    return Response.json({ template }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      {
        error:
          error instanceof Error && error.message
            ? error.message
            : "Не удалось импортировать backup шаблона."
      },
      { status: 400 }
    );
  }
}
