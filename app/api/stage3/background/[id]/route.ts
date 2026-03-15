import { createReadStream, promises as fs } from "node:fs";
import { readStage3BackgroundAsset } from "../../../../../lib/stage3-background";
import { createNodeStreamResponse } from "../../../../../lib/node-stream-response";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  const asset = await readStage3BackgroundAsset(id);
  if (!asset) {
    return Response.json({ error: "Background not found." }, { status: 404 });
  }

  const stat = await fs.stat(asset.filePath).catch(() => null);
  if (!stat?.isFile()) {
    return Response.json({ error: "Background file is unavailable." }, { status: 404 });
  }

  return createNodeStreamResponse({
    stream: createReadStream(asset.filePath),
    signal: request.signal,
    headers: {
      "Content-Type": asset.mimeType,
      "Content-Length": String(stat.size),
      "Cache-Control": "public, max-age=86400, immutable"
    }
  });
}
