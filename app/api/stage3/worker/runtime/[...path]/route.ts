import { promises as fs } from "node:fs";
import { authenticateStage3WorkerPairingToken } from "../../../../../../lib/stage3-worker-store";
import { requireStage3WorkerAuth } from "../../../../../../lib/auth/stage3-worker";
import { createNodeFileResponse } from "../../../../../../lib/node-file-response";
import {
  getStage3WorkerRuntimeContentType,
  resolveStage3WorkerRuntimeFile
} from "../../../../../../lib/stage3-worker-runtime-files";

export const runtime = "nodejs";

type Context = { params: Promise<{ path: string[] }> };

function hasWorkerRuntimeAccess(request: Request): boolean {
  try {
    requireStage3WorkerAuth(request);
    return true;
  } catch {
    const pairingToken = request.headers.get("x-stage3-worker-pairing-token")?.trim() || "";
    return Boolean(pairingToken && authenticateStage3WorkerPairingToken(pairingToken));
  }
}

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    if (!hasWorkerRuntimeAccess(request)) {
      return Response.json({ error: "Требуется worker token." }, { status: 401 });
    }

    const params = await context.params;
    const relativePath = params.path.join("/");
    const resolved = await resolveStage3WorkerRuntimeFile(relativePath);
    if (!resolved) {
      return Response.json({ error: "Runtime file not found." }, { status: 404 });
    }

    await fs.access(resolved.filePath);
    return createNodeFileResponse({
      request,
      filePath: resolved.filePath,
      signal: request.signal,
      headers: {
        "Content-Type": getStage3WorkerRuntimeContentType(resolved.normalizedPath),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return Response.json({ error: "Runtime file not found." }, { status: 404 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось прочитать runtime файл." },
      { status: 500 }
    );
  }
}

export async function HEAD(request: Request, context: Context): Promise<Response> {
  return GET(request, context);
}
