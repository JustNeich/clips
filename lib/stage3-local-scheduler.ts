import type { Stage3JobKind } from "../app/components/types";

export const STAGE3_SHORT_RENDER_MAX_DURATION_SEC = 18;

export type Stage3LocalResourceProfile =
  | "render-short"
  | "render-long"
  | "media"
  | "download";

export type Stage3LocalLane = "render" | "media" | "download";

export type Stage3WorkIdentity = {
  channelId: string | null;
  workItemId: string | null;
  revision: number;
};

export type Stage3LocalSchedulerLimits = {
  shortRender: number;
  media: number;
  download: number;
};

export type Stage3LocalActiveJob = {
  profile: Stage3LocalResourceProfile;
};

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanRevision(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : 1;
}

function parsePayload(payloadJson: string): Record<string, unknown> {
  try {
    const value = JSON.parse(payloadJson) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readFiniteDuration(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function resolveStage3WorkIdentity(payloadJson: string): Stage3WorkIdentity {
  const payload = parsePayload(payloadJson);
  return {
    channelId: cleanString(payload.channelId),
    workItemId: cleanString(payload.workItemId),
    revision: cleanRevision(payload.revision)
  };
}

export function resolveStage3RenderDurationSec(payloadJson: string): number | null {
  const payload = parsePayload(payloadJson);
  const renderPlan = payload.renderPlan && typeof payload.renderPlan === "object"
    ? (payload.renderPlan as Record<string, unknown>)
    : null;
  const snapshot = payload.snapshot && typeof payload.snapshot === "object"
    ? (payload.snapshot as Record<string, unknown>)
    : null;
  const snapshotRenderPlan = snapshot?.renderPlan && typeof snapshot.renderPlan === "object"
    ? (snapshot.renderPlan as Record<string, unknown>)
    : null;
  return (
    readFiniteDuration(renderPlan?.targetDurationSec) ??
    readFiniteDuration(snapshotRenderPlan?.targetDurationSec) ??
    readFiniteDuration(payload.clipDurationSec) ??
    readFiniteDuration(snapshot?.clipDurationSec)
  );
}

export function resolveStage3LocalResourceProfile(
  kind: Stage3JobKind,
  payloadJson: string
): Stage3LocalResourceProfile {
  if (kind === "source-download") {
    return "download";
  }
  if (kind !== "render") {
    return "media";
  }
  const durationSec = resolveStage3RenderDurationSec(payloadJson);
  return durationSec !== null && durationSec > STAGE3_SHORT_RENDER_MAX_DURATION_SEC
    ? "render-long"
    : "render-short";
}

export function resolveStage3LocalLane(profile: Stage3LocalResourceProfile): Stage3LocalLane {
  if (profile === "render-short" || profile === "render-long") {
    return "render";
  }
  return profile === "download" ? "download" : "media";
}

function readLimit(name: string, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.max(1, Math.min(maximum, Math.floor(parsed)));
}

export function resolveStage3LocalSchedulerLimits(): Stage3LocalSchedulerLimits {
  return {
    shortRender: readLimit("STAGE3_WORKER_SHORT_RENDER_MAX_CONCURRENT_JOBS", 1, 2),
    media: readLimit("STAGE3_WORKER_MEDIA_MAX_CONCURRENT_JOBS", 1, 2),
    download: readLimit("STAGE3_WORKER_DOWNLOAD_MAX_CONCURRENT_JOBS", 2, 4)
  };
}

export function resolveStage3LocalClaimProfiles(
  lane: Stage3LocalLane,
  activeJobs: Iterable<Stage3LocalActiveJob>,
  limits: Stage3LocalSchedulerLimits
): Stage3LocalResourceProfile[] {
  const profiles = [...activeJobs].map((job) => job.profile);
  const longRenderActive = profiles.includes("render-long");
  const shortRenderCount = profiles.filter((profile) => profile === "render-short").length;
  const mediaCount = profiles.filter((profile) => profile === "media").length;
  const downloadCount = profiles.filter((profile) => profile === "download").length;

  if (lane === "render") {
    if (longRenderActive || shortRenderCount >= limits.shortRender) {
      return [];
    }
    return shortRenderCount > 0 || mediaCount > 0 || downloadCount > 1
      ? ["render-short"]
      : ["render-short", "render-long"];
  }
  if (lane === "media") {
    return longRenderActive || mediaCount >= limits.media ? [] : ["media"];
  }
  const effectiveDownloadLimit = longRenderActive ? 1 : limits.download;
  return downloadCount >= effectiveDownloadLimit ? [] : ["download"];
}

export function getStage3LocalLaneKinds(lane: Stage3LocalLane): Stage3JobKind[] {
  if (lane === "render") {
    return ["render"];
  }
  if (lane === "download") {
    return ["source-download"];
  }
  return ["preview", "editing-proxy", "agent-media-step"];
}
