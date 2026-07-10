import { requireStage3WorkerAuth } from "../../../../../../../../lib/auth/stage3-worker";
import { createNodeStreamResponse } from "../../../../../../../../lib/node-stream-response";
import {
  openProductionSemanticInput,
  ProductionSemanticInputStoreError
} from "../../../../../../../../lib/project-kings/production-semantic-input-store";
import { parseProductionSemanticJobPayloadJson } from "../../../../../../../../lib/project-kings/production-semantic-job-contract";
import { getStage3Job } from "../../../../../../../../lib/stage3-job-store";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; inputId: string }> };

function contentType(mediaType: "image" | "json" | "text", fileName: string): string {
  if (mediaType === "json") return "application/json; charset=utf-8";
  if (mediaType === "text") return "text/plain; charset=utf-8";
  const extension = fileName.toLowerCase().split(".").pop();
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  return "image/jpeg";
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const auth = requireStage3WorkerAuth(request);
    const { id, inputId } = await context.params;
    const job = getStage3Job(id);
    if (!job || job.workspaceId !== auth.workspaceId || job.userId !== auth.userId) {
      return Response.json({ error: "Stage 3 job not found." }, { status: 404 });
    }
    if (
      job.kind !== "production-semantic" ||
      job.status !== "running" ||
      job.assignedWorkerId !== auth.worker.id
    ) {
      return Response.json({ error: "Semantic input is not leased by this worker." }, { status: 409 });
    }
    const leaseExpiresAt = job.leaseUntil ? Date.parse(job.leaseUntil) : Number.NaN;
    if (!Number.isFinite(leaseExpiresAt) || leaseExpiresAt <= Date.now()) {
      return Response.json({ error: "Semantic input lease has expired." }, { status: 409 });
    }

    const payload = parseProductionSemanticJobPayloadJson(job.payloadJson);
    const ref = payload.packet.artifacts.find((artifact) => artifact.inputId === inputId);
    if (!ref) {
      return Response.json({ error: "Semantic input not found." }, { status: 404 });
    }
    const opened = await openProductionSemanticInput(ref);
    return createNodeStreamResponse({
      stream: opened.stream,
      signal: request.signal,
      headers: {
        "Content-Type": contentType(opened.mediaType, opened.fileName),
        "Content-Length": String(opened.sizeBytes),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(opened.fileName)}`,
        "Cache-Control": "private, no-store, max-age=0",
        Pragma: "no-cache",
        "X-Content-Type-Options": "nosniff",
        "x-production-semantic-input-id": ref.inputId,
        "x-production-semantic-sha256": opened.sha256
      }
    });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof ProductionSemanticInputStoreError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.code === "stored_input_missing" ? 404 : 409 }
      );
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to read semantic input." },
      { status: 422 }
    );
  }
}
