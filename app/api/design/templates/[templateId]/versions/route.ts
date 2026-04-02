import {
  createManagedTemplateVersion
} from "../../../../../../lib/managed-template-store";
import {
  requireManagedTemplateEditAccess,
  requireManagedTemplateViewAccess
} from "../../../../../../lib/managed-template-guards";

export const runtime = "nodejs";

type Context = { params: Promise<{ templateId: string }> };

export async function GET(_request: Request, context: Context): Promise<Response> {
  try {
    const { templateId } = await context.params;
    const { template } = await requireManagedTemplateViewAccess(templateId, _request);
    return Response.json({ versions: template.versions }, { status: 200 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    throw error;
  }
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { templateId } = await context.params;
    await requireManagedTemplateEditAccess(templateId, request);
    const body = (await request.json().catch(() => null)) as { label?: string | null } | null;
    const template = await createManagedTemplateVersion(templateId, body?.label);
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
