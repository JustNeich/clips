import { requireAuth } from "./auth/guards";
import { canCreateManagedTemplates, canEditManagedTemplate, canViewManagedTemplate } from "./managed-template-access";
import { readManagedTemplate } from "./managed-template-store";

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

export async function requireManagedTemplateViewAccess(templateId: string) {
  const auth = await requireAuth();
  const template = await readManagedTemplate(templateId);
  if (!template || !canViewManagedTemplate(auth, template)) {
    throw jsonError("Template not found.", 404);
  }
  return { auth, template };
}

export async function requireManagedTemplateEditAccess(templateId: string) {
  const auth = await requireAuth();
  const template = await readManagedTemplate(templateId);
  if (!template || !canViewManagedTemplate(auth, template)) {
    throw jsonError("Template not found.", 404);
  }
  if (!canEditManagedTemplate(auth, template)) {
    throw jsonError("Доступ запрещен.", 403);
  }
  return { auth, template };
}
