import { promises as fs } from "node:fs";
import path from "node:path";
import {
  Stage3JobKind,
  Stage3JobStatus,
  Stage3JobSummary
} from "../app/components/types";
import { getAppDataDir } from "./app-paths";
import {
  appendStage3JobEvent,
  claimNextQueuedStage3Job,
  completeStage3Job,
  enqueueStage3Job,
  finishStage3Job,
  getStage3Job,
  hasQueuedStage3Jobs,
  interruptPendingStage3Jobs,
  Stage3JobRecord
} from "./stage3-job-store";
import {
  prepareStage3Preview,
  PREVIEW_WAIT_TIMEOUT_MS,
  Stage3PreviewRequestBody,
  summarizeStage3PreviewError
} from "./stage3-preview-service";
import {
  renderStage3Video,
  RENDER_WAIT_TIMEOUT_MS,
  Stage3RenderRequestBody,
  summarizeStage3RenderError
} from "./stage3-render-service";
import { isStage3HostedBusyError } from "./stage3-server-control";

const JOB_ARTIFACT_ROOT = path.join(getAppDataDir(), "stage3-job-artifacts");
const JOB_POLL_INTERVAL_MS = 350;

type Stage3RuntimeState = {
  initialized: boolean;
  runnerPromise: Promise<void> | null;
};

type Stage3RuntimeGlobal = typeof globalThis & {
  __clipsStage3JobRuntimeState__?: Stage3RuntimeState;
};

type EnqueueJobInput = {
  workspaceId: string;
  userId: string;
  kind: Stage3JobKind;
  payloadJson: string;
  dedupeKey?: string | null;
};

function getStage3RuntimeState(): Stage3RuntimeState {
  const scope = globalThis as Stage3RuntimeGlobal;
  if (!scope.__clipsStage3JobRuntimeState__) {
    scope.__clipsStage3JobRuntimeState__ = {
      initialized: false,
      runnerPromise: null
    };
  }
  return scope.__clipsStage3JobRuntimeState__;
}

function memorySnapshotMb(): Record<string, number> {
  const usage = process.memoryUsage();
  return {
    rssMb: Math.round((usage.rss / (1024 * 1024)) * 10) / 10,
    heapUsedMb: Math.round((usage.heapUsed / (1024 * 1024)) * 10) / 10,
    heapTotalMb: Math.round((usage.heapTotal / (1024 * 1024)) * 10) / 10,
    externalMb: Math.round((usage.external / (1024 * 1024)) * 10) / 10
  };
}

function logStage3Runtime(event: string, payload: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      scope: "stage3",
      event,
      at: new Date().toISOString(),
      ...payload
    })
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function isTerminalStatus(status: Stage3JobStatus): boolean {
  return status === "completed" || status === "failed" || status === "interrupted";
}

async function pruneArtifactDirectory(
  dirPath: string,
  options: { maxFiles: number; maxBytes: number; maxAgeMs: number }
): Promise<void> {
  const now = Date.now();
  const entries = await fs.readdir(dirPath).catch(() => []);
  const files = (
    await Promise.all(
      entries.map(async (name) => {
        const filePath = path.join(dirPath, name);
        const stat = await fs.stat(filePath).catch(() => null);
        if (!stat?.isFile()) {
          return null;
        }
        return {
          filePath,
          sizeBytes: stat.size,
          mtimeMs: stat.mtimeMs
        };
      })
    )
  ).filter((item): item is { filePath: string; sizeBytes: number; mtimeMs: number } => Boolean(item));

  const expired = files.filter((file) => now - file.mtimeMs > options.maxAgeMs);
  await Promise.all(expired.map((file) => fs.rm(file.filePath, { force: true }).catch(() => undefined)));

  const fresh = files
    .filter((file) => now - file.mtimeMs <= options.maxAgeMs)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  let totalBytes = fresh.reduce((sum, file) => sum + file.sizeBytes, 0);

  for (let index = options.maxFiles; index < fresh.length; index += 1) {
    totalBytes -= fresh[index].sizeBytes;
    await fs.rm(fresh[index].filePath, { force: true }).catch(() => undefined);
  }

  const capped = fresh.slice(0, options.maxFiles);
  for (let index = capped.length - 1; index >= 0 && totalBytes > options.maxBytes; index -= 1) {
    totalBytes -= capped[index].sizeBytes;
    await fs.rm(capped[index].filePath, { force: true }).catch(() => undefined);
  }
}

async function publishVideoArtifact(
  kind: Extract<Stage3JobKind, "preview" | "render">,
  jobId: string,
  sourcePath: string,
  fileName: string
): Promise<{ filePath: string; sizeBytes: number }> {
  const dirPath = path.join(JOB_ARTIFACT_ROOT, kind);
  await fs.mkdir(dirPath, { recursive: true });
  const finalPath = path.join(dirPath, `${jobId}.mp4`);
  const tempPath = path.join(dirPath, `${jobId}.part-${Date.now()}.mp4`);
  await fs.copyFile(sourcePath, tempPath);
  await fs.rename(tempPath, finalPath);
  const stat = await fs.stat(finalPath);
  await pruneArtifactDirectory(dirPath, {
    maxFiles: kind === "preview" ? 40 : 16,
    maxBytes: kind === "preview" ? 768 * 1024 * 1024 : 1024 * 1024 * 1024,
    maxAgeMs: kind === "preview" ? 60 * 60_000 : 6 * 60 * 60_000
  }).catch(() => undefined);
  appendStage3JobEvent(jobId, "info", "Published artifact.", {
    kind,
    fileName,
    sizeBytes: stat.size
  });
  return {
    filePath: finalPath,
    sizeBytes: stat.size
  };
}

async function executePreviewJob(job: Stage3JobRecord): Promise<void> {
  const payload = JSON.parse(job.payloadJson) as Stage3PreviewRequestBody;
  const prepared = await prepareStage3Preview(payload, {
    waitTimeoutMs: PREVIEW_WAIT_TIMEOUT_MS
  });
  const published = await publishVideoArtifact("preview", job.id, prepared.filePath, `${prepared.cacheKey}.mp4`);
  completeStage3Job(job.id, {
    resultJson: JSON.stringify({
      cacheKey: prepared.cacheKey,
      cacheState: prepared.cacheState
    }),
    artifact: {
      kind: "video",
      fileName: `${prepared.cacheKey}.mp4`,
      mimeType: "video/mp4",
      filePath: published.filePath,
      sizeBytes: published.sizeBytes
    }
  });
}

async function executeRenderJob(job: Stage3JobRecord): Promise<void> {
  const payload = JSON.parse(job.payloadJson) as Stage3RenderRequestBody;
  const rendered = await renderStage3Video(payload, {
    waitTimeoutMs: RENDER_WAIT_TIMEOUT_MS
  });
  try {
    const published = await publishVideoArtifact("render", job.id, rendered.filePath, rendered.outputName);
    completeStage3Job(job.id, {
      resultJson: JSON.stringify({
        outputName: rendered.outputName,
        topCompacted: rendered.topCompacted,
        bottomCompacted: rendered.bottomCompacted
      }),
      artifact: {
        kind: "video",
        fileName: rendered.outputName,
        mimeType: "video/mp4",
        filePath: published.filePath,
        sizeBytes: published.sizeBytes
      }
    });
  } finally {
    await fs.rm(rendered.cleanupDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function normalizeJobFailure(job: Stage3JobRecord, error: unknown): {
  status: Extract<Stage3JobStatus, "failed" | "interrupted">;
  code: string;
  message: string;
  recoverable: boolean;
} {
  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      status: "interrupted",
      code: "aborted",
      message: "Stage 3 job was interrupted.",
      recoverable: true
    };
  }
  if (isStage3HostedBusyError(error)) {
    return {
      status: "failed",
      code: "busy",
      message: "Хостинг занят другой тяжёлой задачей Stage 3. Повторите через минуту.",
      recoverable: true
    };
  }
  if (job.kind === "preview") {
    return {
      status: "failed",
      code: "preview_failed",
      message: summarizeStage3PreviewError(error),
      recoverable: true
    };
  }
  if (job.kind === "render") {
    return {
      status: "failed",
      code: "render_failed",
      message: summarizeStage3RenderError(error),
      recoverable: true
    };
  }
  return {
    status: "failed",
    code: "job_failed",
    message: error instanceof Error ? error.message : "Stage 3 job failed.",
    recoverable: true
  };
}

async function executeStage3Job(job: Stage3JobRecord): Promise<void> {
  const startedAt = Date.now();
  const queueWaitMs = Math.max(0, startedAt - new Date(job.createdAt).getTime());
  const beforeMemory = memorySnapshotMb();
  appendStage3JobEvent(job.id, "info", "Executing job.", {
    kind: job.kind,
    queueWaitMs,
    memoryMb: beforeMemory
  });
  logStage3Runtime("job_start", {
    jobId: job.id,
    jobType: job.kind,
    queueWaitMs,
    memoryMb: beforeMemory
  });

  try {
    if (job.kind === "preview") {
      await executePreviewJob(job);
    } else if (job.kind === "render") {
      await executeRenderJob(job);
    } else {
      throw new Error(`Unsupported Stage 3 job kind: ${job.kind}`);
    }
    const execMs = Date.now() - startedAt;
    const afterMemory = memorySnapshotMb();
    logStage3Runtime("job_complete", {
      jobId: job.id,
      jobType: job.kind,
      execMs,
      result: "completed",
      memoryMb: afterMemory
    });
    appendStage3JobEvent(job.id, "info", "Execution finished.", {
      execMs,
      memoryMb: afterMemory
    });
  } catch (error) {
    const execMs = Date.now() - startedAt;
    const failure = normalizeJobFailure(job, error);
    finishStage3Job(job.id, {
      status: failure.status,
      errorCode: failure.code,
      errorMessage: failure.message,
      recoverable: failure.recoverable
    });
    logStage3Runtime("job_fail", {
      jobId: job.id,
      jobType: job.kind,
      execMs,
      result: failure.status,
      code: failure.code,
      memoryMb: memorySnapshotMb()
    });
  }
}

function ensureStage3JobRuntime(): void {
  const state = getStage3RuntimeState();
  if (state.initialized) {
    return;
  }
  state.initialized = true;
  const interrupted = interruptPendingStage3Jobs();
  if (interrupted > 0) {
    logStage3Runtime("bootstrap_interrupt_jobs", { count: interrupted });
  }
}

async function runStage3JobLoop(): Promise<void> {
  while (true) {
    const job = claimNextQueuedStage3Job();
    if (!job) {
      break;
    }
    await executeStage3Job(job);
  }
}

export function scheduleStage3JobProcessing(): void {
  ensureStage3JobRuntime();
  const state = getStage3RuntimeState();
  if (state.runnerPromise) {
    return;
  }
  state.runnerPromise = runStage3JobLoop().finally(() => {
    const latestState = getStage3RuntimeState();
    latestState.runnerPromise = null;
    if (hasQueuedStage3Jobs()) {
      scheduleStage3JobProcessing();
    }
  });
}

export function enqueueAndScheduleStage3Job(input: EnqueueJobInput): Stage3JobRecord {
  const job = enqueueStage3Job(input);
  logStage3Runtime("job_enqueue", {
    jobId: job.id,
    jobType: job.kind,
    status: job.status,
    dedupeKey: job.dedupeKey,
    memoryMb: memorySnapshotMb()
  });
  scheduleStage3JobProcessing();
  return job;
}

export function getStage3JobOrThrow(jobId: string): Stage3JobRecord {
  ensureStage3JobRuntime();
  const job = getStage3Job(jobId);
  if (!job) {
    throw new Error("Stage 3 job not found.");
  }
  if (job.status === "queued") {
    scheduleStage3JobProcessing();
  }
  return job;
}

export async function waitForStage3Job(
  jobId: string,
  options?: { timeoutMs?: number; signal?: AbortSignal | null }
): Promise<Stage3JobRecord> {
  ensureStage3JobRuntime();
  scheduleStage3JobProcessing();
  const timeoutMs =
    typeof options?.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : 30_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    if (options?.signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    const job = getStage3Job(jobId);
    if (!job) {
      throw new Error("Stage 3 job not found.");
    }
    if (isTerminalStatus(job.status)) {
      return job;
    }
    await delay(JOB_POLL_INTERVAL_MS);
  }

  throw new Error("Timed out waiting for Stage 3 job.");
}
