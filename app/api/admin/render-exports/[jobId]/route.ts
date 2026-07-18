import { promises as fs } from "node:fs";
import { requireOwnerOrMcpMachineScope } from "../../../../../lib/auth/guards";
import { createNodeFileResponse } from "../../../../../lib/node-file-response";
import { getStage3JobArtifactDownloadRecord } from "../../../../../lib/stage3-job-store";

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
    const job = getStage3JobArtifactDownloadRecord(jobId);
    if (!job) {
      return Response.json(
        { error: "Render job not found.", code: "stage3_job_not_found", jobId },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }
    if (job.workspaceId !== auth.workspace.id) {
      return Response.json(
        { error: "Render job not found." },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }
    if (job.storedStatus !== "completed") {
      return Response.json(
        {
          error: "Render job has not completed yet.",
          code: "stage3_job_not_completed",
          jobId: job.id,
          status: job.storedStatus
        },
        { status: 409, headers: NO_STORE_HEADERS }
      );
    }
    const artifactStat = job.artifact
      ? await fs.stat(job.artifact.filePath).catch(() => null)
      : null;
    if (
      !job.artifact ||
      !artifactStat?.isFile() ||
      artifactStat.size !== job.artifact.sizeBytes
    ) {
      return Response.json(
        {
          error: "Completed Stage 3 artifact bytes are no longer available.",
          code: "immutable_artifact_unavailable",
          jobId: job.id,
          status: job.storedStatus,
          artifactId: job.artifact?.id ?? null,
          expectedSizeBytes: job.artifact?.sizeBytes ?? null
        },
        { status: 410, headers: NO_STORE_HEADERS }
      );
    }
    return createNodeFileResponse({
      request,
      filePath: job.artifact.filePath,
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
    return Response.json(
      { error: error instanceof Error ? error.message : "Render export download failed." },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
