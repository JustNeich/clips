export type Stage3WorkerControlFailureKind =
  | "authentication"
  | "protocol"
  | "transient"
  | "local";

export class Stage3WorkerControlPlaneError extends Error {
  readonly status: number;
  readonly phase: string;
  readonly retryAfterMs: number | null;

  constructor(input: {
    message: string;
    status: number;
    phase: string;
    retryAfterMs?: number | null;
  }) {
    super(input.message);
    this.name = "Stage3WorkerControlPlaneError";
    this.status = input.status;
    this.phase = input.phase;
    this.retryAfterMs = input.retryAfterMs ?? null;
  }
}

export type Stage3WorkerControlRetryState = {
  consecutiveFailures: number;
};

export type Stage3WorkerControlRetryDecision = {
  action: "retry" | "stop";
  kind: Stage3WorkerControlFailureKind;
  delayMs: number;
  nextState: Stage3WorkerControlRetryState;
};

const BASE_RETRY_DELAY_MS = 4_000;
const MAX_RETRY_DELAY_MS = 60_000;
const CIRCUIT_BREAKER_FAILURES = 8;
const CIRCUIT_BREAKER_DELAY_MS = 15 * 60_000;
const AUTH_RESTART_GUARD_MS = 15 * 60_000;
const PROTOCOL_RESTART_GUARD_MS = 5 * 60_000;
const TRANSIENT_RESTART_GUARD_MS = 60_000;

function parseRetryAfterMs(value: string | null, nowMs = Date.now()): number | null {
  if (!value) {
    return null;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1_000);
  }
  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt)) {
    return null;
  }
  return Math.max(0, retryAt - nowMs);
}

export async function createStage3WorkerControlPlaneError(input: {
  response: Response;
  phase: string;
  fallbackMessage: string;
}): Promise<Stage3WorkerControlPlaneError> {
  const body = (await input.response.json().catch(() => null)) as { error?: unknown } | null;
  const responseMessage = typeof body?.error === "string" ? body.error.trim() : "";
  return new Stage3WorkerControlPlaneError({
    message: responseMessage || `${input.fallbackMessage} (status ${input.response.status}).`,
    status: input.response.status,
    phase: input.phase,
    retryAfterMs: parseRetryAfterMs(input.response.headers.get("retry-after"))
  });
}

export function classifyStage3WorkerControlFailure(
  error: unknown
): Stage3WorkerControlFailureKind {
  if (error instanceof Stage3WorkerControlPlaneError) {
    if (error.status === 401 || error.status === 403) {
      return "authentication";
    }
    if (
      error.status === 408 ||
      error.status === 425 ||
      error.status === 429 ||
      error.status >= 500
    ) {
      return "transient";
    }
    return "protocol";
  }
  if (error instanceof TypeError) {
    return "transient";
  }
  const code = (error as NodeJS.ErrnoException | null | undefined)?.code;
  if (
    code === "ECONNABORTED" ||
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "EHOSTUNREACH" ||
    code === "ENETDOWN" ||
    code === "ENETUNREACH" ||
    code === "ENOTFOUND" ||
    code === "ETIMEDOUT"
  ) {
    return "transient";
  }
  return "local";
}

export function initialStage3WorkerControlRetryState(): Stage3WorkerControlRetryState {
  return { consecutiveFailures: 0 };
}

export function resolveStage3WorkerControlRetry(input: {
  error: unknown;
  state: Stage3WorkerControlRetryState;
  random?: () => number;
}): Stage3WorkerControlRetryDecision {
  const kind = classifyStage3WorkerControlFailure(input.error);
  const consecutiveFailures = input.state.consecutiveFailures + 1;
  const nextState = { consecutiveFailures };
  if (kind !== "transient") {
    return { action: "stop", kind, delayMs: 0, nextState };
  }

  const retryAfterMs =
    input.error instanceof Stage3WorkerControlPlaneError
      ? input.error.retryAfterMs
      : null;
  if (consecutiveFailures >= CIRCUIT_BREAKER_FAILURES) {
    return {
      action: "retry",
      kind,
      delayMs: Math.max(CIRCUIT_BREAKER_DELAY_MS, retryAfterMs ?? 0),
      nextState
    };
  }

  const exponentialDelay = Math.min(
    MAX_RETRY_DELAY_MS,
    BASE_RETRY_DELAY_MS * 2 ** (consecutiveFailures - 1)
  );
  const random = Math.min(1, Math.max(0, (input.random ?? Math.random)()));
  const jitteredDelay = Math.round(exponentialDelay * (0.8 + random * 0.4));
  return {
    action: "retry",
    kind,
    delayMs: Math.max(jitteredDelay, retryAfterMs ?? 0),
    nextState
  };
}

export function resolveStage3WorkerRestartGuardDelayMs(error: unknown): number {
  switch (classifyStage3WorkerControlFailure(error)) {
    case "authentication":
      return AUTH_RESTART_GUARD_MS;
    case "protocol":
    case "local":
      return PROTOCOL_RESTART_GUARD_MS;
    case "transient":
      return TRANSIENT_RESTART_GUARD_MS;
  }
}

export function formatStage3WorkerDelay(delayMs: number): string {
  if (delayMs >= 60_000) {
    return `${Math.round(delayMs / 60_000)}m`;
  }
  return `${Math.max(1, Math.round(delayMs / 1_000))}s`;
}
