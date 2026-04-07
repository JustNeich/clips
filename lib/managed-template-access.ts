import type { AuthContext, AppRole } from "./team-store";
import type { ManagedTemplate, ManagedTemplateSummary } from "./managed-template-types";
import { isManagerLike, resolveChannelPermissions } from "./acl";
import { getChannelAccessForUser, listChannels } from "./chat-history";
import { isSystemManagedTemplate } from "./managed-template-store";

type TemplateOwnership = Pick<
  ManagedTemplate,
  "workspaceId" | "creatorUserId"
> | Pick<ManagedTemplateSummary, "workspaceId" | "creatorUserId">;

export function canCreateManagedTemplates(role: AppRole): boolean {
  return role === "owner" || role === "manager" || role === "redactor";
}

export function canViewManagedTemplate(
  auth: Pick<AuthContext, "workspace" | "membership" | "user">,
  template: TemplateOwnership
): boolean {
  if (isSystemManagedTemplate(template)) {
    return true;
  }
  if (template.workspaceId && template.workspaceId !== auth.workspace.id) {
    return false;
  }
  if (isManagerLike(auth.membership.role)) {
    return true;
  }
  return Boolean(template.creatorUserId && template.creatorUserId === auth.user.id);
}

export function canEditManagedTemplate(
  auth: Pick<AuthContext, "workspace" | "membership" | "user">,
  template: TemplateOwnership
): boolean {
  if (isSystemManagedTemplate(template)) {
    return false;
  }
  if (template.workspaceId && template.workspaceId !== auth.workspace.id) {
    return false;
  }
  if (!canCreateManagedTemplates(auth.membership.role)) {
    return false;
  }
  if (isManagerLike(auth.membership.role)) {
    return true;
  }
  return Boolean(template.creatorUserId && template.creatorUserId === auth.user.id);
}

export function filterManagedTemplatesForAuth<T extends TemplateOwnership>(
  auth: Pick<AuthContext, "workspace" | "membership" | "user">,
  templates: T[]
): T[] {
  return templates.filter((template) => canViewManagedTemplate(auth, template));
}

export async function collectManagedTemplateIdsFromVisibleChannels(
  auth: Pick<AuthContext, "workspace" | "membership" | "user">
): Promise<Set<string>> {
  const channels = await listChannels(auth.workspace.id);
  const visibleTemplateIds = new Set<string>();
  for (const channel of channels) {
    const explicitAccess = await getChannelAccessForUser(channel.id, auth.user.id);
    const permissions = resolveChannelPermissions({
      membership: auth.membership,
      channel: {
        id: channel.id,
        creatorUserId: channel.creatorUserId
      },
      explicitAccess
    });
    if (permissions.isVisible && channel.templateId.trim()) {
      visibleTemplateIds.add(channel.templateId.trim());
    }
  }
  return visibleTemplateIds;
}

export async function collectEditableManagedTemplateIdsFromChannels(
  auth: Pick<AuthContext, "workspace" | "membership" | "user">
): Promise<Set<string>> {
  const channels = await listChannels(auth.workspace.id);
  const editableTemplateIds = new Set<string>();
  for (const channel of channels) {
    const explicitAccess = await getChannelAccessForUser(channel.id, auth.user.id);
    const permissions = resolveChannelPermissions({
      membership: auth.membership,
      channel: {
        id: channel.id,
        creatorUserId: channel.creatorUserId
      },
      explicitAccess
    });
    if (permissions.canEditSetup && channel.templateId.trim()) {
      editableTemplateIds.add(channel.templateId.trim());
    }
  }
  return editableTemplateIds;
}

export async function filterManagedTemplatesForAuthIncludingVisibleChannels<T extends TemplateOwnership & { id: string }>(
  auth: Pick<AuthContext, "workspace" | "membership" | "user">,
  templates: T[]
): Promise<T[]> {
  const visibleTemplateIds = await collectManagedTemplateIdsFromVisibleChannels(auth);
  return templates.filter(
    (template) => canViewManagedTemplate(auth, template) || visibleTemplateIds.has(template.id)
  );
}
