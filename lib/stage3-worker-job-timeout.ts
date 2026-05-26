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

const ENV_KEY_BY_KIND: Record<Stage3WorkerJobKind, string> = {
  "editing-proxy": "STAGE3_WORKER_EDITING_PROXY_TIMEOUT_MS",
  preview: "STAGE3_WORKER_PREVIEW_TIMEOUT_MS",
  render: "STAGE3_WORKER_RENDER_TIMEOUT_MS",
  "source-download": "STAGE3_WORKER_SOURCE_DOWNLOAD_TIMEOUT_MS",
  "agent-media-step": "STAGE3_WORKER_AGENT_MEDIA_STEP_TIMEOUT_MS"
};

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

export function resolveStage3WorkerJobTimeoutMs(
  kind: Stage3WorkerJobKind,
  env: Record<string, string | undefined> = process.env
): number {
  return (
    parsePositiveInteger(env[ENV_KEY_BY_KIND[kind]]) ??
    parsePositiveInteger(env.STAGE3_WORKER_JOB_TIMEOUT_MS) ??
    DEFAULT_TIMEOUT_MS_BY_KIND[kind]
  );
}

export function isStage3WorkerJobTimeoutError(error: unknown): error is Stage3WorkerJobTimeoutError {
  return error instanceof Stage3WorkerJobTimeoutError;
}
