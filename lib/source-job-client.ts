import type { SourceJobProgressSnapshot, SourceJobSummary } from "../app/components/types";

export function isSourceJobActive(
  job: Pick<SourceJobSummary, "status"> | null | undefined
): boolean {
  return job?.status === "queued" || job?.status === "running";
}

export function pickPreferredSourceJobId(
  jobs: SourceJobSummary[],
  preferredJobId?: string | null
): string | null {
  if (preferredJobId && jobs.some((job) => job.jobId === preferredJobId)) {
    return preferredJobId;
  }

  const active = jobs.find((job) => isSourceJobActive(job));
  if (active) {
    return active.jobId;
  }

  const failed = jobs.find((job) => job.status === "failed");
  if (failed) {
    return failed.jobId;
  }

  return jobs[0]?.jobId ?? null;
}

export function getSourceJobElapsedMs(
  progress: SourceJobProgressSnapshot | null | undefined,
  nowMs = Date.now()
): number {
  if (!progress?.startedAt) {
    return 0;
  }
  const startedAt = new Date(progress.startedAt).getTime();
  if (!Number.isFinite(startedAt)) {
    return 0;
  }
  const endSource =
    progress.status === "completed" || progress.status === "failed"
      ? progress.finishedAt
      : null;
  const finishedAt = endSource ? new Date(endSource).getTime() : nowMs;
  if (!Number.isFinite(finishedAt)) {
    return 0;
  }
  return Math.max(0, finishedAt - startedAt);
}
