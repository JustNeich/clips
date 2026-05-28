import {
  readTemplateCalibrationBundle,
  saveTemplateCalibrationData
} from "../../../../../lib/template-calibration-store";
import {
  TemplateCalibrationSession,
  TemplateContentFixture
} from "../../../../components/types";
import { requireAuth } from "../../../../../lib/auth/guards";
import { requireSensitiveArtifactAccess } from "../../../../../lib/sensitive-access";

export const runtime = "nodejs";

function ensureDesignApiEnabled(): Response | null {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  return null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ templateId: string }> }
): Promise<Response> {
  const disabled = ensureDesignApiEnabled();
  if (disabled) {
    return disabled;
  }

  const auth = await requireAuth(_request);
  requireSensitiveArtifactAccess(auth);
  const { templateId } = await params;
  const bundle = await readTemplateCalibrationBundle(templateId);
  return Response.json(bundle, { status: 200 });
}

export async function PUT(
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
  const body = (await request.json().catch(() => null)) as {
    content?: TemplateContentFixture;
    session?: TemplateCalibrationSession;
    notes?: string;
  } | null;

  const bundle = await saveTemplateCalibrationData({
    templateId,
    content: body?.content,
    session: body?.session,
    notes: body?.notes
  });
  return Response.json(bundle, { status: 200 });
}
