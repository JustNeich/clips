import { saveTemplateCalibrationArtifacts } from "../../../../../../lib/template-calibration-store";
import { TemplateDiffReport } from "../../../../../components/types";

export const runtime = "nodejs";

function ensureDesignApiEnabled(): Response | null {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  return null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ templateId: string }> }
): Promise<Response> {
  const disabled = ensureDesignApiEnabled();
  if (disabled) {
    return disabled;
  }

  const { templateId } = await params;
  const formData = await request.formData();
  const currentFile = formData.get("current");
  const diffFile = formData.get("diff");
  const heatmapFile = formData.get("heatmap");
  const reportJson = formData.get("report");

  if (!(currentFile instanceof File) || !(diffFile instanceof File) || typeof reportJson !== "string") {
    return Response.json({ error: "Expected current, diff and report." }, { status: 400 });
  }

  const report = JSON.parse(reportJson) as TemplateDiffReport;
  const bundle = await saveTemplateCalibrationArtifacts({
    templateId,
    currentPng: Buffer.from(await currentFile.arrayBuffer()),
    diffPng: Buffer.from(await diffFile.arrayBuffer()),
    heatmapPng: heatmapFile instanceof File ? Buffer.from(await heatmapFile.arrayBuffer()) : null,
    report
  });
  return Response.json(bundle, { status: 200 });
}
