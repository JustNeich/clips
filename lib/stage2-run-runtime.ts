import type { Stage2Response } from "../app/components/types";
import { appendChatEvent } from "./chat-history";
import {
  claimNextQueuedStage2Run,
  createStage2Run,
  finalizeStage2RunFailure,
  finalizeStage2RunSuccess,
  getStage2Run,
  hasQueuedStage2Runs,
  interruptRunningStage2Runs,
  recoverInterruptedStage2Runs,
  setStage2RunResultData,
  Stage2RunRecord,
  Stage2RunRequest
} from "./stage2-progress-store";
import { processStage2Run } from "./stage2-runner";

type Stage2RuntimeState = {
  initialized: boolean;
  activeRuns: Set<string>;
  schedulerPromise: Promise<void> | null;
};

type Stage2RuntimeGlobal = typeof globalThis & {
  __clipsStage2RuntimeState__?: Stage2RuntimeState;
  __clipsStage2RunProcessorOverride__?: Stage2RunProcessor | null;
};

export type Stage2RunProcessor = (run: Stage2RunRecord) => Promise<Stage2Response>;

function getRuntimeState(): Stage2RuntimeState {
  const scope = globalThis as Stage2RuntimeGlobal;
  if (!scope.__clipsStage2RuntimeState__) {
    scope.__clipsStage2RuntimeState__ = {
      initialized: false,
      activeRuns: new Set<string>(),
      schedulerPromise: null
    };
  }
  return scope.__clipsStage2RuntimeState__;
}

function getProcessor(): Stage2RunProcessor {
  const scope = globalThis as Stage2RuntimeGlobal;
  return scope.__clipsStage2RunProcessorOverride__ ?? processStage2Run;
}

export function setStage2RunProcessorForTests(processor: Stage2RunProcessor | null): void {
  (globalThis as Stage2RuntimeGlobal).__clipsStage2RunProcessorOverride__ = processor;
}

function logStage2Runtime(event: string, payload: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      scope: "stage2",
      event,
      at: new Date().toISOString(),
      ...payload
    })
  );
}

function getStage2ConcurrencyLimit(): number {
  const raw = Number.parseInt(process.env.STAGE2_MAX_CONCURRENT_RUNS ?? "", 10);
  if (!Number.isFinite(raw) || raw <= 0) {
    return 4;
  }
  return Math.max(1, Math.min(12, Math.floor(raw)));
}

function isHostedRenderRuntime(): boolean {
  return process.env.RENDER === "true" || process.env.RENDER === "1";
}

function formatSourceProviderLabel(provider: Stage2Response["source"]["downloadProvider"]): string | null {
  if (provider === "visolix") {
    return "Visolix";
  }
  if (provider === "ytDlp") {
    return "Локальный резервный загрузчик";
  }
  if (provider === "upload") {
    return "Ручную загрузку mp4";
  }
  return null;
}

function ensureStage2Runtime(): void {
  const state = getRuntimeState();
  if (state.initialized) {
    return;
  }
  state.initialized = true;
  if (isHostedRenderRuntime()) {
    const interrupted = interruptRunningStage2Runs(
      "Stage 2 run stopped after process restart on hosted runtime. Start it again manually."
    );
    if (interrupted > 0) {
      logStage2Runtime("bootstrap_interrupt_runs", { count: interrupted });
    }
    return;
  }
  const recovered = recoverInterruptedStage2Runs();
  if (recovered > 0) {
    logStage2Runtime("bootstrap_requeue_runs", { count: recovered });
  }
}

async function persistTerminalChatEvent(
  run: Stage2RunRecord,
  input:
    | { type: "stage2"; payload: Stage2Response }
    | { type: "error"; message: string }
): Promise<void> {
  if (!run.chatId) {
    return;
  }

  if (input.type === "stage2") {
    const providerLabel = formatSourceProviderLabel(input.payload.source.downloadProvider);
    await appendChatEvent(run.chatId, {
      role: "assistant",
      type: "stage2",
      text: providerLabel ? `Stage 2 завершен. Источник: ${providerLabel}.` : "Stage 2 завершен.",
      data: input.payload
    });
    return;
  }

  await appendChatEvent(run.chatId, {
    role: "assistant",
    type: "error",
    text: input.message,
    data: {
      kind: "stage2-run-error",
      runId: run.runId
    }
  });
}

async function executeRun(run: Stage2RunRecord): Promise<void> {
  const startedAt = Date.now();
  logStage2Runtime("run_start", {
    runId: run.runId,
    chatId: run.chatId,
    mode: run.mode
  });

  try {
    const result = await getProcessor()(run);
    const completed = finalizeStage2RunSuccess(run.runId);
    const finalResult: Stage2Response = {
      ...result,
      progress: completed?.snapshot ?? result.progress ?? null,
      stage2Run: {
        runId: run.runId,
        mode: run.mode,
        baseRunId: run.baseRunId,
        createdAt: run.createdAt,
        startedAt: completed?.startedAt ?? run.startedAt,
        finishedAt: completed?.finishedAt ?? null
      }
    };

    try {
      await persistTerminalChatEvent(run, {
        type: "stage2",
        payload: finalResult
      });
    } catch (eventError) {
      finalResult.warnings = [
        ...finalResult.warnings,
        {
          field: "chat",
          message:
            eventError instanceof Error
              ? `Не удалось записать результат Stage 2 в чат: ${eventError.message}`
              : "Не удалось записать результат Stage 2 в чат."
        }
      ];
    }

    setStage2RunResultData(run.runId, finalResult);
    logStage2Runtime("run_complete", {
      runId: run.runId,
      execMs: Date.now() - startedAt
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stage 2 run failed.";
    try {
      await persistTerminalChatEvent(run, {
        type: "error",
        message
      });
    } catch {
      // Keep the durable run failure even if the chat write also fails.
    }
    finalizeStage2RunFailure(run.runId, message);
    logStage2Runtime("run_fail", {
      runId: run.runId,
      execMs: Date.now() - startedAt,
      message
    });
  }
}

function startClaimedRun(run: Stage2RunRecord): void {
  const state = getRuntimeState();
  if (state.activeRuns.has(run.runId)) {
    return;
  }

  state.activeRuns.add(run.runId);
  void executeRun(run).finally(() => {
    state.activeRuns.delete(run.runId);
    scheduleStage2RunProcessing();
  });
}

function runSchedulerPass(): void {
  const state = getRuntimeState();
  const limit = getStage2ConcurrencyLimit();
  while (state.activeRuns.size < limit) {
    const claimed = claimNextQueuedStage2Run();
    if (!claimed) {
      break;
    }
    startClaimedRun(claimed);
  }
}

export function scheduleStage2RunProcessing(): void {
  ensureStage2Runtime();
  const state = getRuntimeState();
  if (state.schedulerPromise) {
    return;
  }

  state.schedulerPromise = Promise.resolve()
    .then(() => {
      runSchedulerPass();
    })
    .finally(() => {
      const latest = getRuntimeState();
      latest.schedulerPromise = null;
      if (latest.activeRuns.size < getStage2ConcurrencyLimit() && hasQueuedStage2Runs()) {
        scheduleStage2RunProcessing();
      }
    });
}

export function enqueueAndScheduleStage2Run(input: {
  workspaceId: string;
  creatorUserId: string;
  chatId?: string | null;
  request: Stage2RunRequest;
}): Stage2RunRecord {
  const run = createStage2Run(input);
  logStage2Runtime("run_enqueue", {
    runId: run.runId,
    chatId: run.chatId,
    mode: run.mode
  });
  scheduleStage2RunProcessing();
  return run;
}

export function getStage2RunOrThrow(runId: string): Stage2RunRecord {
  ensureStage2Runtime();
  scheduleStage2RunProcessing();
  const run = getStage2Run(runId);
  if (!run) {
    throw new Error("Stage 2 run not found.");
  }
  return run;
}
