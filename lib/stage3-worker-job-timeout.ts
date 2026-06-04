export type Stage3WorkerJobKind =
  | "editing-proxy"
  | "preview"
  | "render"
  | "source-download"
  | "agent-media-step";

const DEFAULT_TIMEOUT_MS_BY_KIND: Record<Stage3WorkerJobKind, number> = {
  "editing-proxy": 5 * 60_000,
  preview: 150_000,
  render: 10 * 60_000,
  "source-download": 5 * 60_000,
  "agent-media-step": 10 * 60_000
};

const DEFAULT_HOST_TIMEOUT_MS_BY_KIND: Record<Stage3WorkerJobKind, number> = {
  "editing-proxy": 5 * 60_000,
  preview: 150_000,
  render: 12 * 60_000,
  "source-download": 5 * 60_000,
  "agent-media-step": 10 * 60_000
};

const ENV_KEY_BY_KIND: Record<Stage3WorkerJobKind, string> = {
  "editing-proxy": "STAGE3_WORKER_EDITING_PROXY_TIMEOUT_MS",
  preview: "STAGE3_WORKER_PREVIEW_TIMEOUT_MS",
  render: "STAGE3_WORKER_RENDER_TIMEOUT_MS",
  "source-download": "STAGE3_WORKER_SOURCE_DOWNLOAD_TIMEOUT_MS",
  "agent-media-step": "STAGE3_WORKER_AGENT_MEDIA_STEP_TIMEOUT_MS"
};

const HOST_ENV_KEY_BY_KIND: Record<Stage3WorkerJobKind, string> = {
  "editing-proxy": "STAGE3_HOST_EDITING_PROXY_TIMEOUT_MS",
  preview: "STAGE3_HOST_PREVIEW_TIMEOUT_MS",
  render: "STAGE3_HOST_RENDER_TIMEOUT_MS",
  "source-download": "STAGE3_HOST_SOURCE_DOWNLOAD_TIMEOUT_MS",
  "agent-media-step": "STAGE3_HOST_AGENT_MEDIA_STEP_TIMEOUT_MS"
};

const LOCAL_STAGE3_RENDER_MIN_TIMEOUT_MS = 3 * 60_000;
const LOCAL_STAGE3_RENDER_BASE_TIMEOUT_MS = 2 * 60_000;
const LOCAL_STAGE3_RENDER_PER_OUTPUT_SECOND_MS = 10_000;

const HOST_STAGE3_RENDER_MIN_TIMEOUT_MS = 6 * 60_000;
const HOST_STAGE3_RENDER_BASE_TIMEOUT_MS = 4 * 60_000;
const HOST_STAGE3_RENDER_PER_OUTPUT_SECOND_MS = 15_000;
const HOST_STAGE3_RENDER_ENGINE_WATCHDOG_HEADROOM_MS = 30_000;

export class Stage3WorkerJobTimeoutError extends Error {
  readonly kind: Stage3WorkerJobKind;
  readonly timeoutMs: number;

  constructor(kind: Stage3WorkerJobKind, timeoutMs: number) {
    super(`Stage 3 local executor timed out while running ${kind} after ${Math.round(timeoutMs / 1000)}s.`);
    this.name = "Stage3WorkerJobTimeoutError";
    this.kind = kind;
    this.timeoutMs = timeoutMs;
  }
}

function parsePositiveInteger(value: string | null | undefined): number | null {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function readPositiveFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function readStage3RenderOutputDurationSec(payloadJson: string): number | null {
  try {
    const payload = readObject(JSON.parse(payloadJson));
    if (!payload) {
      return null;
    }
    const renderPlan = readObject(payload.renderPlan);
    const snapshot = readObject(payload.snapshot);
    const snapshotRenderPlan = readObject(snapshot?.renderPlan);
    return (
      readPositiveFiniteNumber(renderPlan?.targetDurationSec) ??
      readPositiveFiniteNumber(snapshotRenderPlan?.targetDurationSec) ??
      readPositiveFiniteNumber(payload.clipDurationSec) ??
      readPositiveFiniteNumber(snapshot?.clipDurationSec)
    );
  } catch {
    return null;
  }
}

function resolveDurationAwareRenderTimeoutMs(
  baseTimeoutMs: number,
  payloadJson: string | null | undefined,
  policy: {
    minTimeoutMs: number;
    baseTimeoutMs: number;
    perOutputSecondMs: number;
    enforceMinimumFloor: boolean;
  }
): number {
  if (!payloadJson) {
    return baseTimeoutMs;
  }
  const outputDurationSec = readStage3RenderOutputDurationSec(payloadJson);
  if (outputDurationSec === null) {
    return baseTimeoutMs;
  }
  const durationAwareTimeoutMs =
    policy.baseTimeoutMs + Math.ceil(outputDurationSec) * policy.perOutputSecondMs;
  const cappedTimeoutMs = Math.min(baseTimeoutMs, Math.max(policy.minTimeoutMs, durationAwareTimeoutMs));
  return policy.enforceMinimumFloor ? Math.max(policy.minTimeoutMs, cappedTimeoutMs) : cappedTimeoutMs;
}

export function resolveStage3WorkerJobTimeoutMs(
  kind: Stage3WorkerJobKind,
  env: Record<string, string | undefined> = process.env,
  payloadJson?: string | null
): number {
  const baseTimeoutMs =
    parsePositiveInteger(env[ENV_KEY_BY_KIND[kind]]) ??
    parsePositiveInteger(env.STAGE3_WORKER_JOB_TIMEOUT_MS) ??
    DEFAULT_TIMEOUT_MS_BY_KIND[kind];
  return kind === "render"
    ? resolveDurationAwareRenderTimeoutMs(baseTimeoutMs, payloadJson, {
        minTimeoutMs: LOCAL_STAGE3_RENDER_MIN_TIMEOUT_MS,
        baseTimeoutMs: LOCAL_STAGE3_RENDER_BASE_TIMEOUT_MS,
        perOutputSecondMs: LOCAL_STAGE3_RENDER_PER_OUTPUT_SECOND_MS,
        enforceMinimumFloor: false
      })
    : baseTimeoutMs;
}

export function resolveStage3HostJobTimeoutMs(
  kind: Stage3WorkerJobKind,
  env: Record<string, string | undefined> = process.env,
  payloadJson?: string | null
): number {
  const baseTimeoutMs =
    parsePositiveInteger(env[HOST_ENV_KEY_BY_KIND[kind]]) ??
    parsePositiveInteger(env.STAGE3_HOST_JOB_TIMEOUT_MS) ??
    DEFAULT_HOST_TIMEOUT_MS_BY_KIND[kind];
  return kind === "render"
    ? resolveDurationAwareRenderTimeoutMs(baseTimeoutMs, payloadJson, {
        minTimeoutMs: HOST_STAGE3_RENDER_MIN_TIMEOUT_MS,
        baseTimeoutMs: HOST_STAGE3_RENDER_BASE_TIMEOUT_MS,
        perOutputSecondMs: HOST_STAGE3_RENDER_PER_OUTPUT_SECOND_MS,
        enforceMinimumFloor: true
      })
    : baseTimeoutMs;
}

export function resolveStage3HostedRenderEngineTimeoutMs(
  env: Record<string, string | undefined> = process.env,
  payloadJson?: string | null,
  fallbackTimeoutMs = 9 * 60_000
): number {
  const configuredTimeoutMs = parsePositiveInteger(env.REMOTION_RENDER_TIMEOUT_MS) ?? fallbackTimeoutMs;
  const hostJobTimeoutMs = resolveStage3HostJobTimeoutMs("render", env, payloadJson);
  const engineTimeoutFloor = Math.max(
    60_000,
    hostJobTimeoutMs - HOST_STAGE3_RENDER_ENGINE_WATCHDOG_HEADROOM_MS
  );
  return Math.max(configuredTimeoutMs, engineTimeoutFloor);
}

export function isStage3WorkerJobTimeoutError(error: unknown): error is Stage3WorkerJobTimeoutError {
  return error instanceof Stage3WorkerJobTimeoutError;
}
