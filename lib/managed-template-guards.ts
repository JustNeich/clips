import { resolveChannelPermissions } from "./acl";
import { getChannelAccessForUser, listChannels } from "./chat-history";
import { requireAuth } from "./auth/guards";
import {
  canCreateManagedTemplates,
  canEditManagedTemplate,
  canViewManagedTemplate,
  collectEditableManagedTemplateIdsFromChannels
} from "./managed-template-access";
import { isSystemManagedTemplate, readManagedTemplate } from "./managed-template-store";

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

export async function requireManagedTemplateCreateAccess() {
  const auth = await requireAuth();
  if (!canCreateManagedTemplates(auth.membership.role)) {
    throw jsonError("Доступ запрещен.", 403);
  }
  return auth;
}

export async function requireManagedTemplateViewAccess(templateId: string, request?: Request) {
  const auth = await requireAuth(request);
  const template = await readManagedTemplate(templateId);
  if (!template || !canViewManagedTemplate(auth, template)) {
    throw jsonError("Template not found.", 404);
  }
  return { auth, template };
}

async function canViewManagedTemplateViaVisibleChannel(
  auth: Awaited<ReturnType<typeof requireAuth>>,
  templateId: string
): Promise<boolean> {
  const channels = await listChannels(auth.workspace.id);
  for (const channel of channels) {
    if (channel.templateId !== templateId) {
      continue;
    }
    const explicitAccess = await getChannelAccessForUser(channel.id, auth.user.id);
    const permissions = resolveChannelPermissions({
      membership: auth.membership,
      channel: {
        id: channel.id,
        creatorUserId: channel.creatorUserId
      },
      explicitAccess
    });
    if (permissions.isVisible) {
      return true;
    }
  }
  return false;
}

export async function requireManagedTemplateRuntimeViewAccess(templateId: string, request?: Request) {
  const auth = await requireAuth(request);
  const template = await readManagedTemplate(templateId);
  if (!template) {
    throw jsonError("Template not found.", 404);
  }
  if (canViewManagedTemplate(auth, template)) {
    return { auth, template };
  }
  if (!(await canViewManagedTemplateViaVisibleChannel(auth, templateId))) {
    throw jsonError("Template not found.", 404);
  }
  return { auth, template };
}

export async function requireManagedTemplateEditAccess(templateId: string, request?: Request) {
  const auth = await requireAuth(request);
  const template = await readManagedTemplate(templateId);
  if (!template) {
    throw jsonError("Template not found.", 404);
  }
  if (isSystemManagedTemplate(template)) {
    throw jsonError("Системный шаблон нельзя менять напрямую. Создай копию и редактируй её.", 403);
  }
  if (canEditManagedTemplate(auth, template)) {
    return { auth, template };
  }
  const editableViaChannels = await collectEditableManagedTemplateIdsFromChannels(auth);
  if (!editableViaChannels.has(template.id)) {
    if (!canViewManagedTemplate(auth, template)) {
      throw jsonError("Template not found.", 404);
    }
    throw jsonError("Доступ запрещен.", 403);
  }
  return { auth, template };
}
