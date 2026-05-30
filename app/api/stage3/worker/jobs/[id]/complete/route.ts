import { createWriteStream, promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { requireStage3WorkerAuth } from "../../../../../../../lib/auth/stage3-worker";
import {
  isStage3ArtifactStorageError,
  publishStage3VideoArtifact,
  STAGE3_ARTIFACT_STORAGE_FULL_MESSAGE
} from "../../../../../../../lib/stage3-job-artifacts";
import { buildStage3JobEnvelope } from "../../../../../../../lib/stage3-job-http";
import {
  DEFAULT_LOCAL_STAGE3_WORKER_LEASE_MS,
  appendStage3JobEvent,
  completeStage3Job,
  getStage3Job,
  heartbeatStage3Job,
  type Stage3JobRecord
} from "../../../../../../../lib/stage3-job-store";
import {
  persistRenderExportCompletion,
  recoverRenderExportCompletion
} from "../../../../../../../lib/stage3-job-runtime";
import {
  findLatestPublicationForRenderExport,
  getRenderExportByStage3JobId
} from "../../../../../../../lib/publication-store";
import { touchStage3WorkerHeartbeat } from "../../../../../../../lib/stage3-worker-store";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const require = createRequire(import.meta.url);
const Busboy = require("next/dist/compiled/busboy") as (options: {
  headers: Record<string, string>;
}) => {
  on(event: string, listener: (...args: any[]) => void): void;
  emit(event: string, ...args: any[]): boolean;
    };

function memorySnapshotMb(): Record<string, number> {
  const usage = process.memoryUsage();
  return {
    rssMb: Math.round((usage.rss / (1024 * 1024)) * 10) / 10,
    heapUsedMb: Math.round((usage.heapUsed / (1024 * 1024)) * 10) / 10,
    heapTotalMb: Math.round((usage.heapTotal / (1024 * 1024)) * 10) / 10,
    externalMb: Math.round((usage.external / (1024 * 1024)) * 10) / 10
  };
}

function logStage3WorkerCompletion(event: string, payload: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      scope: "stage3",
      event,
      at: new Date().toISOString(),
      ...payload
    })
  );
}

async function createWorkerArtifactTempFile(source: NodeJS.ReadableStream): Promise<{ filePath: string; cleanupDir: string }> {
  const cleanupDir = await fs.mkdtemp(path.join(os.tmpdir(), "clips-stage3-worker-artifact-"));
  const filePath = path.join(cleanupDir, "artifact.mp4");
  try {
    await pipeline(source, createWriteStream(filePath));
    return { filePath, cleanupDir };
  } catch (error) {
    await fs.rm(cleanupDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function parseWorkerCompletionMultipart(request: Request): Promise<{
  resultJson: string | null;
  artifactFile:
    | {
        name: string;
        mimeType: string;
        filePath: string;
        cleanupDir: string;
      }
    | null;
}> {
  const contentType = request.headers.get("content-type")?.trim();
  if (!contentType || !request.body) {
    throw new Error("Missing multipart request body.");
  }

  return await new Promise((resolve, reject) => {
    const parser = Busboy({
      headers: {
        "content-type": contentType
      }
    });

    let resultJson: string | null = null;
    let artifactFile:
      | {
          name: string;
          mimeType: string;
          filePath: string;
          cleanupDir: string;
        }
      | null = null;
    const pendingFiles: Array<Promise<void>> = [];

    parser.on("field", (name: string, value: string) => {
      if (name === "resultJson") {
        resultJson = value;
      }
    });

    parser.on("file", (name: string, stream: NodeJS.ReadableStream, info: unknown, legacyEncoding?: string, legacyMime?: string) => {
      if (name !== "artifact") {
        stream.resume();
        return;
      }

      const meta =
        info && typeof info === "object"
          ? (info as { filename?: string; mimeType?: string })
          : null;
      const fileName = meta?.filename?.trim() || "artifact.mp4";
      const mimeType = meta?.mimeType?.trim() || legacyMime?.trim() || "video/mp4";

      pendingFiles.push(
        createWorkerArtifactTempFile(stream).then(({ filePath, cleanupDir }) => {
          artifactFile = {
            name: fileName,
            mimeType,
            filePath,
            cleanupDir
          };
        })
      );
    });

    parser.on("error", reject);
    parser.on("finish", () => {
      void Promise.all(pendingFiles)
        .then(() => {
          resolve({
            resultJson,
            artifactFile
          });
        })
        .catch(reject);
    });

    Readable.fromWeb(request.body as any).on("error", reject).pipe(parser as any);
  });
}

function decodeHeaderValue(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function decodeResultJsonHeader(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return Buffer.from(trimmed, "base64url").toString("utf-8");
  } catch {
    return null;
  }
}

function buildCompletedArtifactUrl(job: Stage3JobRecord): string | null {
  if (!job.artifact) {
    return null;
  }
  return job.kind === "editing-proxy"
    ? `/api/stage3/editing-proxy/jobs/${job.id}?download=1`
    : `/api/stage3/${job.kind}/jobs/${job.id}?download=1`;
}

async function recoverCompletedRenderExportIfNeeded(job: Stage3JobRecord): Promise<void> {
  if (job.kind !== "render" || job.status !== "completed" || !job.artifact || !job.artifactFilePath) {
    return;
  }
  const renderExport = getRenderExportByStage3JobId(job.id);
  const publication = renderExport ? findLatestPublicationForRenderExport(renderExport.id) : null;
  if (renderExport && publication) {
    return;
  }
  await recoverRenderExportCompletion(job, {
    jobId: job.id,
    artifactFileName: job.artifact.fileName,
    artifactFilePath: job.artifactFilePath,
    artifactMimeType: job.artifact.mimeType,
    artifactSizeBytes: job.artifact.sizeBytes,
    completedAt: job.completedAt ?? new Date().toISOString()
  });
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const startedAt = Date.now();
  try {
    const auth = requireStage3WorkerAuth(request);
    const { id } = await context.params;
    const current = getStage3Job(id);
    if (!current || current.workspaceId !== auth.workspaceId) {
      return Response.json({ error: "Stage 3 job not found." }, { status: 404 });
    }
    if (current.status === "completed") {
      await recoverCompletedRenderExportIfNeeded(current);
      return Response.json(
        buildStage3JobEnvelope(current, buildCompletedArtifactUrl(current)),
        { status: 200 }
      );
    }
    if (current.assignedWorkerId !== auth.worker.id) {
      return Response.json({ error: "Stage 3 job is not leased by this worker." }, { status: 409 });
    }
    heartbeatStage3Job(id, auth.worker.id, DEFAULT_LOCAL_STAGE3_WORKER_LEASE_MS);
    touchStage3WorkerHeartbeat({
      workerId: auth.worker.id
    });

    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    let resultJson: string | null = null;
    let artifactFile:
      | {
          name: string;
          mimeType: string;
          filePath: string;
          cleanupDir: string;
        }
      | null = null;

    if (contentType.includes("multipart/form-data")) {
      const parsed = await parseWorkerCompletionMultipart(request);
      resultJson = parsed.resultJson;
      artifactFile = parsed.artifactFile;
    } else if (request.headers.get("x-stage3-artifact-name")) {
      if (!request.body) {
        return Response.json({ error: "Artifact request body is missing." }, { status: 400 });
      }
      const storedArtifact = await createWorkerArtifactTempFile(Readable.fromWeb(request.body as any));
      artifactFile = {
        name: decodeHeaderValue(request.headers.get("x-stage3-artifact-name")) || `${current.id}.mp4`,
        mimeType:
          decodeHeaderValue(request.headers.get("x-stage3-artifact-mime-type")) ||
          contentType.split(";")[0]?.trim() ||
          "video/mp4",
        filePath: storedArtifact.filePath,
        cleanupDir: storedArtifact.cleanupDir
      };
      resultJson = decodeResultJsonHeader(request.headers.get("x-stage3-result-json"));
    } else if (contentType.includes("application/json")) {
      const body = (await request.json().catch(() => null)) as { resultJson?: unknown } | null;
      resultJson = typeof body?.resultJson === "string" ? body.resultJson : null;
    }

    let artifactInput:
      | {
          kind: "video";
          fileName: string;
          mimeType: string;
          filePath: string;
          sizeBytes: number;
        }
      | null = null;

    if (artifactFile) {
      try {
        if (current.kind !== "preview" && current.kind !== "render" && current.kind !== "editing-proxy") {
          return Response.json({ error: "Artifacts are only supported for preview/render/proxy jobs." }, { status: 400 });
        }
        const published = await publishStage3VideoArtifact(current.kind, current.id, artifactFile.filePath);
        artifactInput = {
          kind: "video",
          fileName: artifactFile.name || `${current.id}.mp4`,
          mimeType: artifactFile.mimeType || "video/mp4",
          filePath: published.filePath,
          sizeBytes: published.sizeBytes
        };
      } finally {
        await fs.rm(artifactFile.cleanupDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }

    logStage3WorkerCompletion("worker_complete_upload", {
      jobId: current.id,
      jobType: current.kind,
      artifactBytes: artifactInput?.sizeBytes ?? 0,
      hasResultJson: Boolean(resultJson),
      durationMs: Date.now() - startedAt,
      memoryMb: memorySnapshotMb()
    });

    touchStage3WorkerHeartbeat({
      workerId: auth.worker.id
    });

    const completed = completeStage3Job(id, {
      resultJson,
      artifact: artifactInput
    });

    if (current.kind === "render" && artifactInput) {
      try {
        await persistRenderExportCompletion(completed, {
          jobId: completed.id,
          artifactFileName: artifactInput.fileName,
          artifactFilePath: artifactInput.filePath,
          artifactMimeType: artifactInput.mimeType,
          artifactSizeBytes: artifactInput.sizeBytes,
          completedAt: completed.completedAt ?? new Date().toISOString()
        });
      } catch (error) {
        appendStage3JobEvent(
          completed.id,
          "warn",
          error instanceof Error
            ? error.message
            : "Не удалось сохранить server-side результат Stage 3 render."
        );
        throw error;
      }
    }

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
    const storageFull = isStage3ArtifactStorageError(error);
    return Response.json(
      {
        error: storageFull
          ? STAGE3_ARTIFACT_STORAGE_FULL_MESSAGE
          : error instanceof Error
            ? error.message
            : "Не удалось завершить Stage 3 job."
      },
      { status: storageFull ? 507 : 500 }
    );
  }
}
