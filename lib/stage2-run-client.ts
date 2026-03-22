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
  const getRunRecencyMs = (run: Stage2RunSummary): number => {
    const timestamps = [run.updatedAt, run.finishedAt, run.startedAt, run.createdAt];
    for (const value of timestamps) {
      if (!value) {
        continue;
      }
      const parsed = new Date(value).getTime();
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return Number.NEGATIVE_INFINITY;
  };

  const pickMostRecent = (
    predicate: (run: Stage2RunSummary) => boolean
  ): Stage2RunSummary | null => {
    let best: Stage2RunSummary | null = null;
    let bestTs = Number.NEGATIVE_INFINITY;
    for (const run of runs) {
      if (!predicate(run)) {
        continue;
      }
      const ts = getRunRecencyMs(run);
      if (!best || ts > bestTs) {
        best = run;
        bestTs = ts;
      }
    }
    return best;
  };

  const preferredRun =
    preferredRunId && preferredRunId.trim()
      ? runs.find((run) => run.runId === preferredRunId.trim()) ?? null
      : null;

  if (preferredRun) {
    if (preferredRun.status === "failed") {
      const active = pickMostRecent((run) => isStage2RunActive(run));
      if (active) {
        return active.runId;
      }
      const completed = pickMostRecent((run) => run.status === "completed" || run.hasResult);
      if (completed) {
        const preferredTs = getRunRecencyMs(preferredRun);
        const completedTs = getRunRecencyMs(completed);
        if (completedTs > preferredTs) {
          return completed.runId;
        }
      }
    }
    return preferredRun.runId;
  }

  const active = pickMostRecent((run) => isStage2RunActive(run));
  if (active) {
    return active.runId;
  }

  const completed = pickMostRecent((run) => run.status === "completed" || run.hasResult);
  if (completed) {
    return completed.runId;
  }

  const failed = pickMostRecent((run) => run.status === "failed");
  if (failed) {
    return failed.runId;
  }

  return pickMostRecent(() => true)?.runId ?? null;
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
