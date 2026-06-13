import { requireOwnerOrMcpMachineScope } from "../../../../../lib/auth/guards";
import { createNodeFileResponse } from "../../../../../lib/node-file-response";
import { getStage3JobOrThrow } from "../../../../../lib/stage3-job-runtime";

export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store"
} as const;

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const auth = await requireOwnerOrMcpMachineScope(request, "flow:read");
    const { jobId } = await context.params;
    const job = getStage3JobOrThrow(jobId);
    if (job.workspaceId !== auth.workspace.id) {
      return Response.json(
        { error: "Render job not found." },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }
    if (job.status !== "completed" || !job.artifact || !job.artifactFilePath) {
      return Response.json(
        {
          error:
            job.status === "completed"
              ? "Render artifact is not available."
              : "Render job has not completed yet.",
          jobId: job.id,
          status: job.status
        },
        { status: 409, headers: NO_STORE_HEADERS }
      );
    }
    return createNodeFileResponse({
      request,
      filePath: job.artifactFilePath,
      signal: request.signal,
      headers: {
        "Content-Type": job.artifact.mimeType,
        "Content-Disposition": `attachment; filename="${job.artifact.fileName}"`,
        "Cache-Control": "private, max-age=900"
      }
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    if (error instanceof Error && error.message === "Stage 3 job not found.") {
      return Response.json(
        { error: "Render job not found." },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Render export download failed." },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
