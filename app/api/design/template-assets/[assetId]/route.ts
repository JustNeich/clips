import { createReadStream } from "node:fs";
import { requireAuth } from "../../../../../lib/auth/guards";
import { resolveManagedTemplateAssetFile } from "../../../../../lib/managed-template-assets";
import { createNodeStreamResponse } from "../../../../../lib/node-stream-response";

export const runtime = "nodejs";

type Context = { params: Promise<{ assetId: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const { assetId } = await context.params;
  try {
    const auth = await requireAuth();
    const asset = await resolveManagedTemplateAssetFile(assetId);
    if (!asset || asset.record.workspaceId !== auth.workspace.id) {
      return Response.json({ error: "Asset not found." }, { status: 404 });
    }

    return createNodeStreamResponse({
      stream: createReadStream(asset.filePath),
      signal: request.signal,
      headers: {
        "Content-Type": asset.record.mimeType,
        "Content-Length": String(asset.size),
        "Cache-Control": "private, max-age=86400"
      }
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось прочитать фон." },
      { status: 500 }
    );
  }
}
