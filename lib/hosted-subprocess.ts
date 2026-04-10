import { AsyncLocalStorage } from "node:async_hooks";

const DEFAULT_HOSTED_SUBPROCESS_LIMIT = 1;

const hostedSubprocessContext = new AsyncLocalStorage<boolean>();
let activeHostedSubprocesses = 0;
const hostedSubprocessWaiters: Array<(release: () => void) => void> = [];

export function isHostedRenderRuntime(): boolean {
  return process.env.RENDER === "true" || process.env.RENDER === "1";
}

function getHostedSubprocessLimit(): number {
  if (!isHostedRenderRuntime()) {
    return Number.POSITIVE_INFINITY;
  }
  const raw = Number.parseInt(process.env.HOSTED_SUBPROCESS_MAX_CONCURRENT ?? "", 10);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_HOSTED_SUBPROCESS_LIMIT;
  }
  return Math.max(1, Math.floor(raw));
}

async function acquireHostedSubprocessSlot(): Promise<() => void> {
  const limit = getHostedSubprocessLimit();
  if (!Number.isFinite(limit) || hostedSubprocessContext.getStore()) {
    return () => undefined;
  }

  if (activeHostedSubprocesses < limit) {
    activeHostedSubprocesses += 1;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const next = hostedSubprocessWaiters.shift();
      if (next) {
        next(acquireReleasedSubprocessSlot());
        return;
      }
      activeHostedSubprocesses = Math.max(0, activeHostedSubprocesses - 1);
    };
  }

  return new Promise<() => void>((resolve) => {
    hostedSubprocessWaiters.push(resolve);
  });
}

function acquireReleasedSubprocessSlot(): () => void {
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    const next = hostedSubprocessWaiters.shift();
    if (next) {
      next(acquireReleasedSubprocessSlot());
      return;
    }
    activeHostedSubprocesses = Math.max(0, activeHostedSubprocesses - 1);
  };
}

export async function runWithHostedSubprocessGate<T>(task: () => Promise<T>): Promise<T> {
  if (!isHostedRenderRuntime()) {
    return task();
  }

  const release = await acquireHostedSubprocessSlot();
  try {
    return await hostedSubprocessContext.run(true, task);
  } finally {
    release();
  }
}
