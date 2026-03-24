import { createHash } from "node:crypto";
import { ensureStage3SourceCached } from "./stage3-server-control";
import { extractYtDlpErrorFromUnknown, isSupportedUrl, normalizeSupportedUrl } from "./ytdlp";

export const EDITING_PROXY_WAIT_TIMEOUT_MS = 20_000;

export type Stage3EditingProxyRequestBody = {
  sourceUrl?: string;
};

export type Stage3PreparedEditingProxy = {
  filePath: string;
  sourceDurationSec: number | null;
  sourceKey: string;
  fileName: string;
  cacheState: "hit";
};

function hashKey(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function resolveSourceUrl(rawSource: string | undefined): string {
  const sourceUrl = normalizeSupportedUrl(rawSource?.trim() ?? "");
  if (!sourceUrl) {
    throw new Error("Передайте sourceUrl в теле запроса.");
  }
  if (!isSupportedUrl(sourceUrl)) {
    throw new Error("Не удалось подготовить proxy-видео для редактора. Проверьте ссылку на ролик из Шага 1.");
  }
  return sourceUrl;
}

export async function buildStage3EditingProxyDedupeKey(
  body: Stage3EditingProxyRequestBody,
  scope?: { workspaceId?: string | null; userId?: string | null }
): Promise<string> {
  const sourceUrl = resolveSourceUrl(body.sourceUrl);
  const workspaceId = scope?.workspaceId?.trim() ?? "";
  const userId = scope?.userId?.trim() ?? "";
  const sourceKey = hashKey(sourceUrl);
  if (!workspaceId || !userId) {
    return `editing-proxy:v1:global:${sourceKey}`;
  }
  return `editing-proxy:v1:${workspaceId}:${userId}:${sourceKey}`;
}

export async function prepareStage3EditingProxy(
  body: Stage3EditingProxyRequestBody,
  options?: { signal?: AbortSignal; waitTimeoutMs?: number | null }
): Promise<Stage3PreparedEditingProxy> {
  const sourceUrl = resolveSourceUrl(body.sourceUrl);
  const waitTimeoutMs =
    typeof options?.waitTimeoutMs === "number" && Number.isFinite(options.waitTimeoutMs) && options.waitTimeoutMs > 0
      ? options.waitTimeoutMs
      : EDITING_PROXY_WAIT_TIMEOUT_MS;
  const source = await ensureStage3SourceCached(sourceUrl, {
    signal: options?.signal,
    waitTimeoutMs
  });
  return {
    filePath: source.sourcePath,
    sourceDurationSec: source.sourceDurationSec,
    sourceKey: source.sourceKey,
    fileName: source.fileName,
    cacheState: "hit"
  };
}

export function summarizeStage3EditingProxyError(error: unknown): string {
  const ytdlpMessage = extractYtDlpErrorFromUnknown(error);
  if (ytdlpMessage) {
    return ytdlpMessage;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Stage 3 editing proxy failed.";
}
