import { saveTemplateCalibrationImage } from "../../../../../../lib/template-calibration-store";
import { requireAuth } from "../../../../../../lib/auth/guards";
import { requireSensitiveArtifactAccess } from "../../../../../../lib/sensitive-access";

export const runtime = "nodejs";

function ensureDesignApiEnabled(): Response | null {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  return null;
}

function isSupportedKind(value: string): value is "reference" | "mask" | "media" | "background" | "avatar" {
  return value === "reference" || value === "mask" || value === "media" || value === "background" || value === "avatar";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ templateId: string }> }
): Promise<Response> {
  const disabled = ensureDesignApiEnabled();
  if (disabled) {
    return disabled;
  }

  const auth = await requireAuth(request);
  requireSensitiveArtifactAccess(auth);
  const { templateId } = await params;
  const formData = await request.formData();
  const kind = String(formData.get("kind") ?? "");
  const file = formData.get("file");

  if (!isSupportedKind(kind) || !(file instanceof File)) {
    return Response.json({ error: "Expected kind and file." }, { status: 400 });
  }

  const bundle = await saveTemplateCalibrationImage({
    templateId,
    kind,
    bytes: Buffer.from(await file.arrayBuffer())
  });
  return Response.json(bundle, { status: 200 });
}
