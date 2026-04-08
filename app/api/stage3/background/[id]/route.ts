import { promises as fs } from "node:fs";
import { requireAuth } from "../../../../../lib/auth/guards";
import { createNodeFileResponse } from "../../../../../lib/node-file-response";
import { readStage3BackgroundAsset } from "../../../../../lib/stage3-background";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    await requireAuth(request);
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json({ error: "Требуется авторизация." }, { status: 401 });
  }
  const { id } = await context.params;
  const asset = await readStage3BackgroundAsset(id);
  if (!asset) {
    return Response.json({ error: "Background not found." }, { status: 404 });
  }

  const stat = await fs.stat(asset.filePath).catch(() => null);
  if (!stat?.isFile()) {
    return Response.json({ error: "Background file is unavailable." }, { status: 404 });
  }

  return createNodeFileResponse({
    request,
    filePath: asset.filePath,
    signal: request.signal,
    headers: {
      "Content-Type": asset.mimeType,
      "Cache-Control": "private, max-age=86400, immutable"
    }
  });
}
