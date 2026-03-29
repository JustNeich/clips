import type { AuthContext, AppRole } from "./team-store";
import type { ManagedTemplate, ManagedTemplateSummary } from "./managed-template-types";
import { isManagerLike } from "./acl";

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
  if (!canViewManagedTemplate(auth, template)) {
    return false;
  }
  return canCreateManagedTemplates(auth.membership.role);
}

export function filterManagedTemplatesForAuth<T extends TemplateOwnership>(
  auth: Pick<AuthContext, "workspace" | "membership" | "user">,
  templates: T[]
): T[] {
  return templates.filter((template) => canViewManagedTemplate(auth, template));
}
