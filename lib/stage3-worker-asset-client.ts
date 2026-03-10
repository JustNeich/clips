import { promises as fs } from "node:fs";
import path from "node:path";

export type Stage3WorkerDownloadedAsset = {
  filePath: string;
  fileName: string | null;
  mimeType: string | null;
};

function readWorkerAssetEnv(): { serverOrigin: string; sessionToken: string } | null {
  const serverOrigin = process.env.STAGE3_WORKER_SERVER_ORIGIN?.trim();
  const sessionToken = process.env.STAGE3_WORKER_SESSION_TOKEN?.trim();
  if (!serverOrigin || !sessionToken) {
    return null;
  }
  return { serverOrigin: serverOrigin.replace(/\/+$/, ""), sessionToken };
}

function sanitizeFileName(value: string | null | undefined, assetId: string): string {
  const raw = (value ?? "").trim();
  const candidate = raw && !raw.includes("/") && !raw.includes("\\") ? raw : assetId;
  return candidate.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export async function maybeDownloadStage3WorkerAsset(params: {
  channelId: string;
  assetId: string;
  tmpDir: string;
  suggestedFileName?: string | null;
}): Promise<Stage3WorkerDownloadedAsset | null> {
  const workerEnv = readWorkerAssetEnv();
  if (!workerEnv) {
    return null;
  }

  const url = new URL(`${workerEnv.serverOrigin}/api/stage3/worker/assets/${encodeURIComponent(params.assetId)}`);
  url.searchParams.set("channelId", params.channelId);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${workerEnv.sessionToken}`
    }
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Failed to fetch Stage 3 asset ${params.assetId}.`);
  }

  const fileName = sanitizeFileName(
    response.headers.get("x-stage3-asset-file-name") || params.suggestedFileName,
    params.assetId
  );
  const outputPath = path.join(params.tmpDir, `worker-asset-${params.assetId}-${fileName}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputPath, bytes);
  return {
    filePath: outputPath,
    fileName,
    mimeType: response.headers.get("content-type")
  };
}
