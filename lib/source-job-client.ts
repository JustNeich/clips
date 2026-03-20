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

export function shouldReuseActiveChatForSourceFetch(input: {
  activeChatId?: string | null;
  activeChatUrl?: string | null;
  draftUrl?: string | null;
}): boolean {
  const draftUrl = input.draftUrl?.trim() ?? "";
  const activeChatUrl = input.activeChatUrl?.trim() ?? "";
  return Boolean(input.activeChatId && draftUrl && activeChatUrl && draftUrl === activeChatUrl);
}

export function resolveSourceFetchBlockedReason(input: {
  activeChannelId?: string | null;
  fetchSourceAvailable: boolean;
  fetchSourceBlockedReason?: string | null;
  reusesActiveChat: boolean;
  hasActiveSourceJob: boolean;
  hasActiveStage2Run: boolean;
}): string | null {
  if (!input.activeChannelId) {
    return "Сначала создайте или выберите канал.";
  }
  if (!input.fetchSourceAvailable) {
    return input.fetchSourceBlockedReason ?? "Source fetch is unavailable on this deployment.";
  }
  if (!input.reusesActiveChat) {
    return null;
  }
  if (input.hasActiveSourceJob) {
    return "Для этого чата уже идёт получение источника.";
  }
  if (input.hasActiveStage2Run) {
    return "Для этого чата уже идёт Stage 2. Дождитесь завершения перед новым получением источника.";
  }
  return null;
}
