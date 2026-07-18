import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import { promisify } from "node:util";
import type { SourceJobRecord } from "./source-job-store";
import { getSourceJob } from "./source-job-store";
import type { CachedSourceMedia } from "./source-media-cache";
import { getCachedSourceMedia } from "./source-media-cache";
import { normalizeSupportedUrl } from "./ytdlp";

const execFileAsync = promisify(execFile);
const SOURCE_DURATION_TOLERANCE_SEC = 0.05;

export type Stage3CompletedSourceExpectation = {
  jobId: string;
  expectedCacheKey: string;
  expectedDurationSec: number;
  expectedWidth: number;
  expectedHeight: number;
  expectedSizeBytes?: number;
};

export type Stage3CompletedSourceBinding = {
  kind: "completed-source-job";
  sourceJobId: string;
  sourceCacheKey: string;
  sourceUrl: string;
  sourceDurationSec: number;
  sourceWidth: number;
  sourceHeight: number;
  sourceSizeBytes: number;
  sourceSha256: string;
};

export class Stage3SourceBindingError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 409) {
    super(message);
    this.name = "Stage3SourceBindingError";
    this.code = code;
    this.status = status;
  }
}

type Stage3SourceFileIdentity = {
  durationSec: number;
  width: number;
  height: number;
  sizeBytes: number;
  sha256: string;
};

type ResolveCompletedSourceBindingDependencies = {
  getSourceJob: (jobId: string) => SourceJobRecord | null;
  getCachedSourceMedia: (sourceUrl: string) => Promise<CachedSourceMedia | null>;
  inspectSourceFile: (filePath: string) => Promise<Stage3SourceFileIdentity>;
};

function normalizePositiveInteger(value: number): number {
  return Math.max(1, Math.floor(value));
}

function assertExpectedDuration(actual: number, expected: number): void {
  if (Math.abs(actual - expected) > SOURCE_DURATION_TOLERANCE_SEC) {
    throw new Stage3SourceBindingError(
      "completed_source_duration_mismatch",
      `Completed source duration mismatch: expected ${expected.toFixed(3)}s, got ${actual.toFixed(3)}s.`
    );
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function inspectSourceFile(filePath: string): Promise<Stage3SourceFileIdentity> {
  const [{ stdout }, stat, sha256] = await Promise.all([
    execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height:format=duration",
        "-of",
        "json",
        filePath
      ],
      { timeout: 30_000, maxBuffer: 1024 * 1024 }
    ),
    fs.stat(filePath),
    sha256File(filePath)
  ]);
  const parsed = JSON.parse(stdout) as {
    streams?: Array<{ width?: unknown; height?: unknown }>;
    format?: { duration?: unknown };
  };
  const stream = parsed.streams?.[0];
  const durationSec = Number.parseFloat(String(parsed.format?.duration ?? ""));
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  if (
    !Number.isFinite(durationSec) ||
    durationSec <= 0 ||
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    throw new Stage3SourceBindingError(
      "completed_source_media_invalid",
      "Completed source media could not be probed.",
      422
    );
  }
  return {
    durationSec,
    width: normalizePositiveInteger(width),
    height: normalizePositiveInteger(height),
    sizeBytes: stat.size,
    sha256
  };
}

function assertSourceJobOwnership(input: {
  job: SourceJobRecord;
  workspaceId: string;
  channelId: string;
  chatId: string;
}): void {
  if (input.job.workspaceId !== input.workspaceId) {
    throw new Stage3SourceBindingError(
      "completed_source_job_not_found",
      "Completed source job not found.",
      404
    );
  }
  if (input.job.channelId !== input.channelId) {
    throw new Stage3SourceBindingError(
      "completed_source_channel_mismatch",
      "Completed source job does not belong to the requested channel.",
      403
    );
  }
  if (input.job.chatId !== input.chatId) {
    throw new Stage3SourceBindingError(
      "completed_source_chat_mismatch",
      "Completed source job does not belong to the requested chat.",
      403
    );
  }
}

export async function resolveCompletedSourceBindingForEnqueue(
  input: {
    workspaceId: string;
    channelId: string;
    chatId: string;
    sourceUrl?: string | null;
    expectation: Stage3CompletedSourceExpectation;
  },
  dependencies: ResolveCompletedSourceBindingDependencies = {
    getSourceJob,
    getCachedSourceMedia,
    inspectSourceFile
  }
): Promise<Stage3CompletedSourceBinding> {
  const job = dependencies.getSourceJob(input.expectation.jobId);
  if (!job) {
    throw new Stage3SourceBindingError(
      "completed_source_job_not_found",
      "Completed source job not found.",
      404
    );
  }
  assertSourceJobOwnership({
    job,
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    chatId: input.chatId
  });
  if (job.status !== "completed" || !job.resultData?.stage1Ready) {
    throw new Stage3SourceBindingError(
      "completed_source_job_not_ready",
      "Source job is not completed with reusable media."
    );
  }

  const sourceUrl = normalizeSupportedUrl(job.sourceUrl);
  const requestedSourceUrl = input.sourceUrl ? normalizeSupportedUrl(input.sourceUrl) : "";
  if (requestedSourceUrl && requestedSourceUrl !== sourceUrl) {
    throw new Stage3SourceBindingError(
      "completed_source_url_mismatch",
      "Completed source job URL does not match the requested source URL.",
      403
    );
  }

  const resultCacheKey = job.resultData.sourceCacheKey?.trim() ?? "";
  if (!resultCacheKey || resultCacheKey !== input.expectation.expectedCacheKey.trim()) {
    throw new Stage3SourceBindingError(
      "completed_source_cache_key_mismatch",
      "Completed source cache key does not match the expected media identity."
    );
  }

  const cached = await dependencies.getCachedSourceMedia(sourceUrl);
  if (!cached) {
    throw new Stage3SourceBindingError(
      "completed_source_media_missing",
      "Completed source media is no longer present in the host cache.",
      410
    );
  }
  if (cached.sourceKey !== resultCacheKey) {
    throw new Stage3SourceBindingError(
      "completed_source_cache_key_mismatch",
      "Host source cache does not match the completed source job."
    );
  }

  const identity = await dependencies.inspectSourceFile(cached.sourcePath);
  const resultSizeBytes = job.resultData.videoSizeBytes;
  if (
    typeof resultSizeBytes === "number" &&
    Number.isFinite(resultSizeBytes) &&
    resultSizeBytes > 0 &&
    identity.sizeBytes !== Math.floor(resultSizeBytes)
  ) {
    throw new Stage3SourceBindingError(
      "completed_source_size_mismatch",
      "Host source media size does not match the completed source job."
    );
  }
  if (
    typeof input.expectation.expectedSizeBytes === "number" &&
    identity.sizeBytes !== Math.floor(input.expectation.expectedSizeBytes)
  ) {
    throw new Stage3SourceBindingError(
      "completed_source_size_mismatch",
      "Completed source media size does not match the caller expectation."
    );
  }
  assertExpectedDuration(identity.durationSec, input.expectation.expectedDurationSec);
  if (
    identity.width !== normalizePositiveInteger(input.expectation.expectedWidth) ||
    identity.height !== normalizePositiveInteger(input.expectation.expectedHeight)
  ) {
    throw new Stage3SourceBindingError(
      "completed_source_dimensions_mismatch",
      `Completed source dimensions mismatch: expected ${normalizePositiveInteger(input.expectation.expectedWidth)}x${normalizePositiveInteger(input.expectation.expectedHeight)}, got ${identity.width}x${identity.height}.`
    );
  }

  return {
    kind: "completed-source-job",
    sourceJobId: job.jobId,
    sourceCacheKey: resultCacheKey,
    sourceUrl,
    sourceDurationSec: identity.durationSec,
    sourceWidth: identity.width,
    sourceHeight: identity.height,
    sourceSizeBytes: identity.sizeBytes,
    sourceSha256: identity.sha256
  };
}

export function stage3SourceBindingsEqual(
  left: Stage3CompletedSourceBinding | null | undefined,
  right: Stage3CompletedSourceBinding | null | undefined
): boolean {
  if (!left || !right) {
    return !left && !right;
  }
  return (
    left.kind === right.kind &&
    left.sourceJobId === right.sourceJobId &&
    left.sourceCacheKey === right.sourceCacheKey &&
    left.sourceUrl === right.sourceUrl &&
    left.sourceSha256 === right.sourceSha256 &&
    left.sourceSizeBytes === right.sourceSizeBytes &&
    left.sourceWidth === right.sourceWidth &&
    left.sourceHeight === right.sourceHeight &&
    Math.abs(left.sourceDurationSec - right.sourceDurationSec) <= 0.001
  );
}

export async function assertStage3CompletedSourceFile(
  filePath: string,
  binding: Stage3CompletedSourceBinding
): Promise<void> {
  const identity = await inspectSourceFile(filePath);
  if (identity.sha256 !== binding.sourceSha256) {
    throw new Stage3SourceBindingError(
      "completed_source_sha256_mismatch",
      "Completed source bytes do not match the bound media identity."
    );
  }
  if (identity.sizeBytes !== binding.sourceSizeBytes) {
    throw new Stage3SourceBindingError(
      "completed_source_size_mismatch",
      "Completed source bytes do not match the bound media size."
    );
  }
  assertExpectedDuration(identity.durationSec, binding.sourceDurationSec);
  if (identity.width !== binding.sourceWidth || identity.height !== binding.sourceHeight) {
    throw new Stage3SourceBindingError(
      "completed_source_dimensions_mismatch",
      "Completed source bytes do not match the bound media dimensions."
    );
  }
}
