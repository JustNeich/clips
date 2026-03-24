import { requireStage3WorkerAuth } from "../../../../../../../lib/auth/stage3-worker";
import { publishStage3VideoArtifactFromBuffer } from "../../../../../../../lib/stage3-job-artifacts";
import { buildStage3JobEnvelope } from "../../../../../../../lib/stage3-job-http";
import { completeStage3Job, getStage3Job } from "../../../../../../../lib/stage3-job-store";
import { touchStage3WorkerHeartbeat } from "../../../../../../../lib/stage3-worker-store";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const auth = requireStage3WorkerAuth(request);
    const { id } = await context.params;
    const current = getStage3Job(id);
    if (!current || current.workspaceId !== auth.workspaceId || current.userId !== auth.userId) {
      return Response.json({ error: "Stage 3 job not found." }, { status: 404 });
    }
    if (current.assignedWorkerId !== auth.worker.id) {
      return Response.json({ error: "Stage 3 job is not leased by this worker." }, { status: 409 });
    }

    const form = await request.formData();
    const resultJson = typeof form.get("resultJson") === "string" ? String(form.get("resultJson")) : null;
    const artifactFile = form.get("artifact");
    let artifactInput:
      | {
          kind: "video";
          fileName: string;
          mimeType: string;
          filePath: string;
          sizeBytes: number;
        }
      | null = null;

    if (artifactFile instanceof File) {
      if (current.kind !== "preview" && current.kind !== "render" && current.kind !== "editing-proxy") {
        return Response.json({ error: "Artifacts are only supported for preview/render/proxy jobs." }, { status: 400 });
      }
      const bytes = new Uint8Array(await artifactFile.arrayBuffer());
      const published = await publishStage3VideoArtifactFromBuffer(current.kind, current.id, bytes);
      artifactInput = {
        kind: "video",
        fileName: artifactFile.name || `${current.id}.mp4`,
        mimeType: artifactFile.type || "video/mp4",
        filePath: published.filePath,
        sizeBytes: published.sizeBytes
      };
    }

    touchStage3WorkerHeartbeat({
      workerId: auth.worker.id
    });

    const completed = completeStage3Job(id, {
      resultJson,
      artifact: artifactInput
    });
    return Response.json(
      buildStage3JobEnvelope(
        completed,
        completed.artifact
          ? completed.kind === "editing-proxy"
            ? `/api/stage3/editing-proxy/jobs/${completed.id}?download=1`
            : `/api/stage3/${completed.kind}/jobs/${completed.id}?download=1`
          : null
      ),
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось завершить Stage 3 job." },
      { status: 500 }
    );
  }
}
