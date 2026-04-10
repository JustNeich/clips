import { requireAuth } from "../../../../../lib/auth/guards";
import {
  deleteManagedTemplateDetailed,
  readManagedTemplate,
  updateManagedTemplate
} from "../../../../../lib/managed-template-store";

export const runtime = "nodejs";

type Context = { params: Promise<{ templateId: string }> };

export async function GET(_request: Request, context: Context): Promise<Response> {
  try {
    const { templateId } = await context.params;
    const auth = await requireAuth(_request);
    const template = await readManagedTemplate(templateId, { workspaceId: auth.workspace.id });
    if (!template) {
      return Response.json({ error: "Template not found." }, { status: 404 });
    }
    return Response.json({ template }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    throw error;
  }
}

export async function PUT(request: Request, context: Context): Promise<Response> {
  try {
    const { templateId } = await context.params;
    const auth = await requireAuth(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const template = await updateManagedTemplate(templateId, body ?? {}, {
      workspaceId: auth.workspace.id
    });
    if (!template) {
      return Response.json({ error: "Template not found." }, { status: 404 });
    }
    return Response.json({ template }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    throw error;
  }
}

export async function DELETE(_request: Request, context: Context): Promise<Response> {
  try {
    const { templateId } = await context.params;
    const auth = await requireAuth(_request);

    const result = await deleteManagedTemplateDetailed(templateId, {
      workspaceId: auth.workspace.id
    });
    if (!result.deleted) {
      const message =
        result.reason === "last_template"
          ? "Нельзя удалить последний шаблон workspace."
          : "Template not found.";
      return Response.json({ error: message }, { status: result.reason === "last_template" ? 409 : 404 });
    }

    return Response.json(
      {
        deletedId: templateId,
        fallbackTemplateId: result.fallbackTemplateId,
        reassignedChannels: result.reassignedChannels
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    throw error;
  }
}
