import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { requireStage3WorkerAuth } from "../../../../../../../lib/auth/stage3-worker";
import { publishStage3VideoArtifactFromBuffer } from "../../../../../../../lib/stage3-job-artifacts";
import { buildStage3JobEnvelope } from "../../../../../../../lib/stage3-job-http";
import { appendStage3JobEvent, completeStage3Job, getStage3Job } from "../../../../../../../lib/stage3-job-store";
import { persistRenderExportCompletion } from "../../../../../../../lib/stage3-job-runtime";
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

async function parseWorkerCompletionMultipart(request: Request): Promise<{
  resultJson: string | null;
  artifactFile:
    | {
        name: string;
        mimeType: string;
        bytes: Uint8Array;
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
          bytes: Uint8Array;
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
      const chunks: Buffer[] = [];

      pendingFiles.push(
        new Promise<void>((fileResolve, fileReject) => {
          stream.on("data", (chunk: Buffer | Uint8Array) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          stream.on("end", () => {
            artifactFile = {
              name: fileName,
              mimeType,
              bytes: new Uint8Array(Buffer.concat(chunks))
            };
            fileResolve();
          });
          stream.on("error", fileReject);
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

    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    let resultJson: string | null = null;
    let artifactFile:
      | {
          name: string;
          mimeType: string;
          bytes: Uint8Array;
        }
      | null = null;

    if (contentType.includes("multipart/form-data")) {
      const parsed = await parseWorkerCompletionMultipart(request);
      resultJson = parsed.resultJson;
      artifactFile = parsed.artifactFile;
    } else if (request.headers.get("x-stage3-artifact-name")) {
      const bytes = new Uint8Array(await request.arrayBuffer());
      artifactFile = {
        name: decodeHeaderValue(request.headers.get("x-stage3-artifact-name")) || `${current.id}.mp4`,
        mimeType:
          decodeHeaderValue(request.headers.get("x-stage3-artifact-mime-type")) ||
          contentType.split(";")[0]?.trim() ||
          "video/mp4",
        bytes
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
      if (current.kind !== "preview" && current.kind !== "render" && current.kind !== "editing-proxy") {
        return Response.json({ error: "Artifacts are only supported for preview/render/proxy jobs." }, { status: 400 });
      }
      const published = await publishStage3VideoArtifactFromBuffer(current.kind, current.id, artifactFile.bytes);
      artifactInput = {
        kind: "video",
        fileName: artifactFile.name || `${current.id}.mp4`,
        mimeType: artifactFile.mimeType || "video/mp4",
        filePath: published.filePath,
        sizeBytes: published.sizeBytes
      };
    }

    touchStage3WorkerHeartbeat({
      workerId: auth.worker.id
    });

    if (current.kind === "render" && artifactInput) {
      await persistRenderExportCompletion(current, {
        jobId: current.id,
        artifactFileName: artifactInput.fileName,
        artifactFilePath: artifactInput.filePath,
        artifactMimeType: artifactInput.mimeType,
        artifactSizeBytes: artifactInput.sizeBytes,
        completedAt: new Date().toISOString()
      }).catch((error) => {
        appendStage3JobEvent(
          current.id,
          "warn",
          error instanceof Error
            ? error.message
            : "Не удалось сохранить server-side результат Stage 3 render."
        );
      });
    }

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
