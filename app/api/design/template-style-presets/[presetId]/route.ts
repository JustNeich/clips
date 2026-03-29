import {
  deleteTemplateStylePreset,
  readTemplateStylePreset,
  updateTemplateStylePreset
} from "../../../../../lib/template-style-preset-store";

export const runtime = "nodejs";

function ensureDesignApiEnabled(): Response | null {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  return null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ presetId: string }> }
): Promise<Response> {
  const disabled = ensureDesignApiEnabled();
  if (disabled) {
    return disabled;
  }

  const { presetId } = await params;
  const preset = await readTemplateStylePreset(presetId);
  if (!preset) {
    return Response.json({ error: "Preset not found." }, { status: 404 });
  }
  return Response.json(preset, { status: 200 });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ presetId: string }> }
): Promise<Response> {
  const disabled = ensureDesignApiEnabled();
  if (disabled) {
    return disabled;
  }

  const { presetId } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const preset = await updateTemplateStylePreset(presetId, body ?? {});
  if (!preset) {
    return Response.json({ error: "Preset not found." }, { status: 404 });
  }
  return Response.json(preset, { status: 200 });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ presetId: string }> }
): Promise<Response> {
  const disabled = ensureDesignApiEnabled();
  if (disabled) {
    return disabled;
  }

  const { presetId } = await params;
  const deleted = await deleteTemplateStylePreset(presetId);
  if (!deleted) {
    return Response.json({ error: "Preset not found." }, { status: 404 });
  }
  return new Response(null, { status: 204 });
}
