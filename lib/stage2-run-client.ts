import type { Stage2ProgressSnapshot } from "./stage2-pipeline";
import type { Stage2RunSummary } from "../app/components/types";

export type ScopedRequestVersions = Record<string, number>;

export function isStage2RunActive(
  run: Pick<Stage2RunSummary, "status"> | null | undefined
): boolean {
  return run?.status === "queued" || run?.status === "running";
}

export function pickPreferredStage2RunId(
  runs: Stage2RunSummary[],
  preferredRunId?: string | null
): string | null {
  if (preferredRunId && runs.some((run) => run.runId === preferredRunId)) {
    return preferredRunId;
  }

  const active = runs.find((run) => isStage2RunActive(run));
  if (active) {
    return active.runId;
  }

  const failed = runs.find((run) => run.status === "failed");
  if (failed) {
    return failed.runId;
  }

  return runs[0]?.runId ?? null;
}

export function getStage2ElapsedMs(
  progress: Stage2ProgressSnapshot | null | undefined,
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

export function issueScopedRequestVersion(
  versions: ScopedRequestVersions,
  scope: string
): { version: number; nextVersions: ScopedRequestVersions } {
  const current = versions[scope] ?? 0;
  const version = current + 1;
  return {
    version,
    nextVersions: {
      ...versions,
      [scope]: version
    }
  };
}

export function matchesScopedRequestVersion(
  versions: ScopedRequestVersions,
  scope: string,
  version: number
): boolean {
  return (versions[scope] ?? 0) === version;
}
