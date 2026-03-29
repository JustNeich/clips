import { restoreManagedTemplateVersion } from "../../../../../../../../lib/managed-template-store";
import { requireManagedTemplateEditAccess } from "../../../../../../../../lib/managed-template-guards";

export const runtime = "nodejs";

type Context = { params: Promise<{ templateId: string; versionId: string }> };

export async function POST(_request: Request, context: Context): Promise<Response> {
  const { templateId, versionId } = await context.params;
  await requireManagedTemplateEditAccess(templateId);
  const template = await restoreManagedTemplateVersion(templateId, versionId);
  if (!template) {
    return Response.json({ error: "Version not found." }, { status: 404 });
  }
  return Response.json({ template }, { status: 200 });
}
