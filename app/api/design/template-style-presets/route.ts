import {
  createTemplateStylePreset,
  listTemplateStylePresets
} from "../../../../lib/template-style-preset-store";
import { requireAuth } from "../../../../lib/auth/guards";
import { requireSensitiveArtifactAccess } from "../../../../lib/sensitive-access";

export const runtime = "nodejs";

function ensureDesignApiEnabled(): Response | null {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  return null;
}

export async function GET(request: Request): Promise<Response> {
  const disabled = ensureDesignApiEnabled();
  if (disabled) {
    return disabled;
  }

  const auth = await requireAuth(request);
  requireSensitiveArtifactAccess(auth);
  const presets = await listTemplateStylePresets();
  return Response.json({ presets }, { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
  const disabled = ensureDesignApiEnabled();
  if (disabled) {
    return disabled;
  }

  const auth = await requireAuth(request);
  requireSensitiveArtifactAccess(auth);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const preset = await createTemplateStylePreset(body ?? {});
  return Response.json(preset, { status: 201 });
}
