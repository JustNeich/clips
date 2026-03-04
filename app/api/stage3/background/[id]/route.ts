import { promises as fs } from "node:fs";
import { readStage3BackgroundAsset } from "../../../../../lib/stage3-background";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  const asset = await readStage3BackgroundAsset(id);
  if (!asset) {
    return Response.json({ error: "Background not found." }, { status: 404 });
  }

  const file = await fs.readFile(asset.filePath).catch(() => null);
  if (!file) {
    return Response.json({ error: "Background file is unavailable." }, { status: 404 });
  }

  return new Response(file, {
    status: 200,
    headers: {
      "Content-Type": asset.mimeType,
      "Cache-Control": "public, max-age=86400, immutable"
    }
  });
}
