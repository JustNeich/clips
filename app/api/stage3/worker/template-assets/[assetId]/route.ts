import { createReadStream } from "node:fs";
import { requireStage3WorkerAuth } from "../../../../../../lib/auth/stage3-worker";
import { resolveManagedTemplateAssetFile } from "../../../../../../lib/managed-template-assets";
import { createNodeStreamResponse } from "../../../../../../lib/node-stream-response";

export const runtime = "nodejs";

type Context = { params: Promise<{ assetId: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const { assetId } = await context.params;
    const auth = requireStage3WorkerAuth(request);
    const asset = await resolveManagedTemplateAssetFile(assetId);
    if (!asset || asset.record.workspaceId !== auth.workspaceId) {
      return Response.json({ error: "Template asset not found." }, { status: 404 });
    }

    return createNodeStreamResponse({
      stream: createReadStream(asset.filePath),
      signal: request.signal,
      headers: {
        "Content-Type": asset.record.mimeType,
        "Content-Length": String(asset.size),
        "Cache-Control": "private, max-age=300",
        "x-stage3-asset-file-name": asset.record.fileName,
        "x-stage3-asset-created-at": asset.record.createdAt
      }
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось прочитать template asset." },
      { status: 500 }
    );
  }
}
