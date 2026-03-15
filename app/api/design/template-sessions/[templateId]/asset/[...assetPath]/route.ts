import { readFile } from "node:fs/promises";
import { readTemplateCalibrationAsset } from "../../../../../../../lib/template-calibration-store";

export const runtime = "nodejs";

function ensureDesignApiEnabled(): Response | null {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  return null;
}

function getMimeType(pathname: string): string {
  if (pathname.endsWith(".png")) {
    return "image/png";
  }
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (pathname.endsWith(".webp")) {
    return "image/webp";
  }
  if (pathname.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  return "application/octet-stream";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ templateId: string; assetPath: string[] }> }
): Promise<Response> {
  const disabled = ensureDesignApiEnabled();
  if (disabled) {
    return disabled;
  }

  const { templateId, assetPath } = await params;
  const relative = assetPath.join("/");
  if (!relative || relative.includes("..")) {
    return Response.json({ error: "Invalid asset path." }, { status: 400 });
  }

  const asset = await readTemplateCalibrationAsset({
    templateId,
    assetPath: relative
  });
  if (!asset) {
    return Response.json({ error: "Asset not found." }, { status: 404 });
  }
  try {
    const data = await readFile(asset.filePath);
    return new Response(data, {
      status: 200,
      headers: {
        "content-type": asset.contentType || getMimeType(relative),
        "cache-control": "no-store"
      }
    });
  } catch {
    return Response.json({ error: "Asset not found." }, { status: 404 });
  }
}
