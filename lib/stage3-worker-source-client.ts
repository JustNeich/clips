import { promises as fs } from "node:fs";
import path from "node:path";

export type Stage3WorkerDownloadedSource = {
  filePath: string;
  fileName: string;
  provider: string | null;
};

function readWorkerSourceEnv(): { serverOrigin: string; sessionToken: string } | null {
  const serverOrigin = process.env.STAGE3_WORKER_SERVER_ORIGIN?.trim();
  const sessionToken = process.env.STAGE3_WORKER_SESSION_TOKEN?.trim();
  if (!serverOrigin || !sessionToken) {
    return null;
  }
  return {
    serverOrigin: serverOrigin.replace(/\/+$/, ""),
    sessionToken
  };
}

function sanitizeSourceFileName(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  const fallback = raw || "source";
  return fallback.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function decodeStage3SourceFileNameHeader(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function maybeDownloadStage3WorkerSource(params: {
  sourceUrl: string;
  tmpDir: string;
}): Promise<Stage3WorkerDownloadedSource | null> {
  const workerEnv = readWorkerSourceEnv();
  if (!workerEnv) {
    return null;
  }

  const response = await fetch(`${workerEnv.serverOrigin}/api/stage3/worker/source`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${workerEnv.sessionToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      url: params.sourceUrl
    })
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || "Failed to fetch Stage 3 source from host.");
  }

  const fileName = sanitizeSourceFileName(
    decodeStage3SourceFileNameHeader(response.headers.get("x-stage3-source-file-name"))
  );
  const outputPath = path.join(params.tmpDir, `worker-source-${fileName}.mp4`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputPath, bytes);

  return {
    filePath: outputPath,
    fileName,
    provider: response.headers.get("x-stage3-source-provider")
  };
}
