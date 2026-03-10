import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { requireAuth } from "../../../../../../lib/auth/guards";
import { buildStage3JobEnvelope, buildStage3JobErrorBody } from "../../../../../../lib/stage3-job-http";
import { getStage3JobOrThrow } from "../../../../../../lib/stage3-job-runtime";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const auth = await requireAuth();
    const { id } = await context.params;
    const job = getStage3JobOrThrow(id);
    if (job.workspaceId !== auth.workspace.id || job.userId !== auth.user.id) {
      return Response.json({ error: "Stage 3 job not found." }, { status: 404 });
    }

    const url = new URL(request.url);
    if (url.searchParams.get("download") === "1") {
      if (!job.artifactFilePath || !job.artifact) {
        return Response.json(
          buildStage3JobErrorBody({
            message: job.errorMessage ?? "Preview artifact is not ready yet.",
            jobId: job.id,
            recoverable: job.recoverable
          }),
          { status: job.status === "completed" ? 410 : 409 }
        );
      }
      const stat = await fs.stat(job.artifactFilePath);
      const stream = createReadStream(job.artifactFilePath);
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 200,
        headers: {
          "Content-Type": job.artifact.mimeType,
          "Content-Length": String(stat.size),
          "Cache-Control": "private, max-age=300"
        }
      });
    }

    return Response.json(
      buildStage3JobEnvelope(job, job.artifact ? `/api/stage3/preview/jobs/${job.id}?download=1` : null)
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    if (error instanceof Error && error.message === "Stage 3 job not found.") {
      return Response.json({ error: error.message }, { status: 404 });
    }
    return Response.json(
      buildStage3JobErrorBody({
        message: error instanceof Error ? error.message : "Не удалось получить статус preview job.",
        recoverable: true
      }),
      { status: 500 }
    );
  }
}
