import { requireAuth } from "../../../../../lib/auth/guards";
import { asErrorResponse } from "../../../../../lib/http";
import {
  getWorkspaceOpenRouterStatus,
  mutateWorkspaceOpenRouterIntegration
} from "../../../../../lib/workspace-openrouter";

export const runtime = "nodejs";

type Body = {
  action?: "save" | "disconnect";
  apiKey?: string | null;
  model?: string | null;
};

export async function GET(): Promise<Response> {
  try {
    const auth = await requireAuth();
    if (auth.membership.role !== "owner") {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }
    const integration = await getWorkspaceOpenRouterStatus(auth);
    return Response.json({ integration }, { status: 200 });
  } catch (error) {
    return asErrorResponse(error, "Не удалось загрузить OpenRouter integration.", 403);
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Body | null;
  const action = body?.action;
  if (action !== "save" && action !== "disconnect") {
    return Response.json({ error: "Неподдерживаемое действие." }, { status: 400 });
  }

  try {
    const auth = await requireAuth();
    const integration = await mutateWorkspaceOpenRouterIntegration({
      auth,
      action,
      apiKey: body?.apiKey ?? null,
      model: body?.model ?? null
    });
    return Response.json({ integration }, { status: 200 });
  } catch (error) {
    return asErrorResponse(error, "Не удалось обновить OpenRouter integration.", 403);
  }
}
