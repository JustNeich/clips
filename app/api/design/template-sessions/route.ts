import { listTemplateCalibrationBundles } from "../../../../lib/template-calibration-store";

export const runtime = "nodejs";

function ensureDesignApiEnabled(): Response | null {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  return null;
}

export async function GET(): Promise<Response> {
  const disabled = ensureDesignApiEnabled();
  if (disabled) {
    return disabled;
  }

  const bundles = await listTemplateCalibrationBundles();
  return Response.json({ bundles }, { status: 200 });
}
