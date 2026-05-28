import { listTemplateCalibrationBundles } from "../../../../lib/template-calibration-store";
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
  const bundles = await listTemplateCalibrationBundles();
  return Response.json({ bundles }, { status: 200 });
}
