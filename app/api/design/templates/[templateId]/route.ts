import { reassignChannelsTemplateId } from "../../../../../lib/chat-history";
import { filterManagedTemplatesForAuth } from "../../../../../lib/managed-template-access";
import {
  requireManagedTemplateEditAccess,
  requireManagedTemplateViewAccess
} from "../../../../../lib/managed-template-guards";
import { STAGE3_TEMPLATE_ID } from "../../../../../lib/stage3-template";
import {
  deleteManagedTemplate,
  listManagedTemplates,
  updateManagedTemplate
} from "../../../../../lib/managed-template-store";

export const runtime = "nodejs";

type Context = { params: Promise<{ templateId: string }> };

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { templateId } = await context.params;
  const { template } = await requireManagedTemplateViewAccess(templateId);
  return Response.json({ template }, { status: 200 });
}

export async function PUT(request: Request, context: Context): Promise<Response> {
  const { templateId } = await context.params;
  await requireManagedTemplateEditAccess(templateId);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const template = await updateManagedTemplate(templateId, body ?? {});
  if (!template) {
    return Response.json({ error: "Template not found." }, { status: 404 });
  }
  return Response.json({ template }, { status: 200 });
}

export async function DELETE(_request: Request, context: Context): Promise<Response> {
  const { templateId } = await context.params;
  const { auth } = await requireManagedTemplateEditAccess(templateId);

  const deleted = await deleteManagedTemplate(templateId);
  if (!deleted) {
    return Response.json({ error: "Template not found." }, { status: 404 });
  }

  const fallbackTemplateId =
    filterManagedTemplatesForAuth(auth, await listManagedTemplates()).find(
      (template) => template.id !== templateId
    )?.id ?? STAGE3_TEMPLATE_ID;

  let reassignedChannels = 0;
  if (fallbackTemplateId && fallbackTemplateId !== templateId) {
    reassignedChannels = await reassignChannelsTemplateId(templateId, fallbackTemplateId);
  }

  return Response.json(
    {
      deletedId: templateId,
      fallbackTemplateId,
      reassignedChannels
    },
    { status: 200 }
  );
}
