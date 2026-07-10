import os from "node:os";

import {
  ackProductionOutbox,
  claimProductionOutbox,
  getNextProductionOutboxWakeAt,
  getProductionItem,
  getProductionProfile,
  getProductionRun,
  listProductionRunChannels,
  listProductionRuns,
  renewProductionOutboxLease,
  retryProductionOutbox,
  type ProductionOutboxDaemonFence,
  type ProductionOutboxRecord,
  type ProductionRunRecord
} from "./portfolio-production-store";
import {
  reconcilePortfolioProductionRun,
  type PortfolioOutboxDispatcher
} from "./portfolio-production-orchestrator";
import {
  createPortfolioLiveDispatcher,
  type PortfolioLiveRuntimeOptions
} from "./portfolio-production-live-runtime";
import {
  PortfolioProductionResourceLimiter,
  classifyPortfolioOutboxResource
} from "./portfolio-production-resource-limits";
import {
  loadFrozenProductionAgentRouteManifest,
  ProductionAgentRouteManifestError
} from "./project-kings/production-model-route-manifest";
import {
  isPortfolioDaemonDispatchLeaseActive,
  PROJECT_KINGS_PORTFOLIO_DAEMON_ID
} from "./portfolio-production-daemon-store";

const ACTIVE_BACKGROUND_RUN_STATUSES = [
  "created",
  "preflight",
  "ready",
  "running",
  "waiting_public",
  "cancel_requested"
] as const;
const DEFAULT_BATCH_LIMIT = 12;
const DEFAULT_OUTBOX_LEASE_MS = 5 * 60_000;
const DEFAULT_OUTBOX_HEARTBEAT_MS = 60_000;
const DEFAULT_RESOURCE_LEASE_MS = 30 * 60_000;
const DEFAULT_RETRY_DELAY_MS = 5_000;
const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_BOOTSTRAP_ATTEMPTS = 3;
const DEFAULT_BOOTSTRAP_BACKOFF_MS = [1_000, 3_000] as const;

const RETRYABLE_BOOTSTRAP_BLOCKER_CODES = new Set([
  "provider_unavailable",
  "background_runtime_start_failed"
]);

type TimerHandle = ReturnType<typeof setTimeout>;

export type PortfolioBackgroundEventOutcome = "delivered" | "retried" | "dead" | "lease_lost";

export type PortfolioBackgroundPassResult = Readonly<{
  runIds: readonly string[];
  reconciled: number;
  reconcileErrors: number;
  claimed: number;
  delivered: number;
  retried: number;
  dead: number;
  leaseLost: number;
}>;

export type PortfolioBackgroundRuntimeSnapshot = Readonly<{
  workspaceId: string;
  owner: string;
  registeredRunIds: readonly string[];
  running: boolean;
  wakeAt: string | null;
  stopped: boolean;
  lastPass: PortfolioBackgroundPassResult | null;
  lastError: string | null;
}>;

export type PortfolioBackgroundScheduleResult = Readonly<{
  scheduled: boolean;
  status: "scheduled" | "not_applicable" | "blocked";
  runId: string;
  blockerCode: string | null;
  blocker: string | null;
  manifestId: string | null;
  manifestSha256: string | null;
}>;

export type PortfolioBootstrapRetryDependencies = {
  bootstrap?: typeof bootstrapPortfolioProductionLiveBackgroundRuntime;
  sleep?: (delayMs: number) => Promise<void>;
};

export type PortfolioProductionBackgroundDependencies = {
  getRun?: typeof getProductionRun;
  getItem?: typeof getProductionItem;
  listRunChannels?: typeof listProductionRunChannels;
  reconcile?: typeof reconcilePortfolioProductionRun;
  claimOutbox?: typeof claimProductionOutbox;
  renewOutboxLease?: typeof renewProductionOutboxLease;
  ackOutbox?: typeof ackProductionOutbox;
  retryOutbox?: typeof retryProductionOutbox;
  getNextWakeAt?: typeof getNextProductionOutboxWakeAt;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (timer: TimerHandle) => void;
  queueTask?: (callback: () => void) => void;
  now?: () => Date;
  logger?: (event: string, payload: Record<string, unknown>) => void;
};

export type PortfolioProductionBackgroundRuntimeInput = {
  workspaceId: string;
  dispatcher: PortfolioOutboxDispatcher;
  limiter?: PortfolioProductionResourceLimiter;
  owner?: string;
  batchLimit?: number;
  outboxLeaseMs?: number;
  heartbeatMs?: number;
  resourceLeaseMs?: number;
  retryDelayMs?: number;
  pollIntervalMs?: number;
  autoSchedule?: boolean;
  dispatchFence?: () => boolean;
  daemonFence?: ProductionOutboxDaemonFence | null;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultLogger(event: string, payload: Record<string, unknown>): void {
  console.info(JSON.stringify({
    scope: "portfolio-production-background",
    event,
    at: new Date().toISOString(),
    ...payload
  }));
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number, field: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}.`);
  }
  return resolved;
}

function delayDefault(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function retryDelay(backoffMs: readonly number[], completedAttempt: number): number {
  const delay = backoffMs[Math.min(completedAttempt - 1, backoffMs.length - 1)] ?? 0;
  if (!Number.isInteger(delay) || delay < 0 || delay > 60_000) {
    throw new Error("Retry backoff values must be integers between 0 and 60000 milliseconds.");
  }
  return delay;
}

function isTerminalRun(run: ProductionRunRecord): boolean {
  return ["completed", "blocked", "canceled", "failed"].includes(run.status);
}

export class PortfolioProductionBackgroundRuntime {
  private readonly workspaceId: string;
  private readonly dispatcher: PortfolioOutboxDispatcher;
  private readonly limiter: PortfolioProductionResourceLimiter;
  private readonly owner: string;
  private readonly batchLimit: number;
  private readonly outboxLeaseMs: number;
  private readonly heartbeatMs: number;
  private readonly resourceLeaseMs: number;
  private readonly retryDelayMs: number;
  private readonly pollIntervalMs: number;
  private readonly autoSchedule: boolean;
  private readonly dispatchFence: () => boolean;
  private readonly daemonFence: ProductionOutboxDaemonFence | null;
  private readonly dependencies: Required<PortfolioProductionBackgroundDependencies>;
  private readonly runIds = new Set<string>();
  private runnerPromise: Promise<PortfolioBackgroundPassResult> | null = null;
  private wakeTimer: TimerHandle | null = null;
  private wakeAt: string | null = null;
  private stopped = false;
  private lastPass: PortfolioBackgroundPassResult | null = null;
  private lastError: string | null = null;

  constructor(
    input: PortfolioProductionBackgroundRuntimeInput,
    dependencies: PortfolioProductionBackgroundDependencies = {}
  ) {
    if (!input.workspaceId.trim()) throw new Error("workspaceId is required.");
    this.workspaceId = input.workspaceId.trim();
    this.dispatcher = input.dispatcher;
    this.limiter = input.limiter ?? new PortfolioProductionResourceLimiter();
    this.owner = input.owner?.trim() || `portfolio-live:${os.hostname()}:${process.pid}`;
    this.batchLimit = boundedInteger(input.batchLimit, DEFAULT_BATCH_LIMIT, 1, 100, "batchLimit");
    this.outboxLeaseMs = boundedInteger(
      input.outboxLeaseMs,
      DEFAULT_OUTBOX_LEASE_MS,
      1_000,
      60 * 60_000,
      "outboxLeaseMs"
    );
    this.heartbeatMs = boundedInteger(
      input.heartbeatMs,
      DEFAULT_OUTBOX_HEARTBEAT_MS,
      0,
      this.outboxLeaseMs - 1,
      "heartbeatMs"
    );
    this.resourceLeaseMs = boundedInteger(
      input.resourceLeaseMs,
      DEFAULT_RESOURCE_LEASE_MS,
      1_000,
      60 * 60_000,
      "resourceLeaseMs"
    );
    this.retryDelayMs = boundedInteger(input.retryDelayMs, DEFAULT_RETRY_DELAY_MS, 0, 60 * 60_000, "retryDelayMs");
    this.pollIntervalMs = boundedInteger(
      input.pollIntervalMs,
      DEFAULT_POLL_INTERVAL_MS,
      100,
      60 * 60_000,
      "pollIntervalMs"
    );
    this.autoSchedule = input.autoSchedule ?? false;
    this.dispatchFence = input.dispatchFence ?? (() => true);
    this.daemonFence = input.daemonFence ?? null;
    this.dependencies = {
      getRun: dependencies.getRun ?? getProductionRun,
      getItem: dependencies.getItem ?? getProductionItem,
      listRunChannels: dependencies.listRunChannels ?? listProductionRunChannels,
      reconcile: dependencies.reconcile ?? reconcilePortfolioProductionRun,
      claimOutbox: dependencies.claimOutbox ?? claimProductionOutbox,
      renewOutboxLease: dependencies.renewOutboxLease ?? renewProductionOutboxLease,
      ackOutbox: dependencies.ackOutbox ?? ackProductionOutbox,
      retryOutbox: dependencies.retryOutbox ?? retryProductionOutbox,
      getNextWakeAt: dependencies.getNextWakeAt ?? getNextProductionOutboxWakeAt,
      setTimer: dependencies.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs)),
      clearTimer: dependencies.clearTimer ?? ((timer) => clearTimeout(timer)),
      queueTask: dependencies.queueTask ?? queueMicrotask,
      now: dependencies.now ?? (() => new Date()),
      logger: dependencies.logger ?? defaultLogger
    };
  }

  scheduleRun(runId: string): void {
    if (this.stopped) throw new Error("Portfolio background runtime is stopped.");
    const run = this.dependencies.getRun(runId);
    if (!run || run.workspaceId !== this.workspaceId) {
      throw new Error(`Production run not found in workspace ${this.workspaceId}: ${runId}`);
    }
    if (run.mode === "simulation") {
      throw new Error("Live background runtime refuses simulation runs.");
    }
    if (["blocked", "canceled", "failed"].includes(run.status)) {
      throw new Error(`Live background runtime refuses terminal ${run.status} runs.`);
    }
    this.runIds.add(run.id);
    if (this.autoSchedule) this.wakeNow();
  }

  wakeNow(): void {
    if (this.stopped || this.runnerPromise) return;
    this.clearWakeTimer();
    this.dependencies.queueTask(() => {
      void this.runNow().catch((error) => {
        this.lastError = errorMessage(error);
        this.dependencies.logger("pass_failed", { workspaceId: this.workspaceId, error: this.lastError });
      });
    });
  }

  async runNow(): Promise<PortfolioBackgroundPassResult> {
    if (this.stopped) throw new Error("Portfolio background runtime is stopped.");
    if (this.runnerPromise) return this.runnerPromise;
    this.clearWakeTimer();
    this.runnerPromise = this.runPass()
      .then((result) => {
        this.lastPass = result;
        this.lastError = null;
        return result;
      })
      .catch((error) => {
        this.lastError = errorMessage(error);
        throw error;
      })
      .finally(() => {
        this.runnerPromise = null;
        if (this.autoSchedule && !this.stopped) this.scheduleNextWake();
      });
    return this.runnerPromise;
  }

  stop(): void {
    this.stopped = true;
    this.clearWakeTimer();
  }

  getSnapshot(): PortfolioBackgroundRuntimeSnapshot {
    return {
      workspaceId: this.workspaceId,
      owner: this.owner,
      registeredRunIds: [...this.runIds].sort(),
      running: Boolean(this.runnerPromise),
      wakeAt: this.wakeAt,
      stopped: this.stopped,
      lastPass: this.lastPass,
      lastError: this.lastError
    };
  }

  private registeredRuns(): ProductionRunRecord[] {
    const runs: ProductionRunRecord[] = [];
    for (const runId of [...this.runIds]) {
      const run = this.dependencies.getRun(runId);
      if (
        !run ||
        run.workspaceId !== this.workspaceId ||
        run.mode === "simulation" ||
        ["blocked", "canceled", "failed"].includes(run.status)
      ) {
        this.runIds.delete(runId);
        continue;
      }
      runs.push(run);
    }
    return runs;
  }

  private async runPass(): Promise<PortfolioBackgroundPassResult> {
    const initialRuns = this.registeredRuns();
    if (!this.dispatchFence()) {
      this.dependencies.logger("singleton_fence_closed", {
        workspaceId: this.workspaceId,
        runIds: initialRuns.map((run) => run.id)
      });
      return {
        runIds: initialRuns.map((run) => run.id),
        reconciled: 0,
        reconcileErrors: 0,
        claimed: 0,
        delivered: 0,
        retried: 0,
        dead: 0,
        leaseLost: 0
      };
    }
    let reconciled = 0;
    let reconcileErrors = 0;
    for (const run of initialRuns) {
      if (isTerminalRun(run)) continue;
      try {
        this.dependencies.reconcile({
          runId: run.id,
          leaseOwner: `${this.owner}:reconcile`,
          leaseMs: 30_000
        });
        reconciled += 1;
      } catch (error) {
        reconcileErrors += 1;
        this.dependencies.logger("reconcile_failed", { runId: run.id, error: errorMessage(error) });
      }
    }

    const runIds = this.registeredRuns().map((run) => run.id);
    if (runIds.length === 0) {
      return { runIds, reconciled, reconcileErrors, claimed: 0, delivered: 0, retried: 0, dead: 0, leaseLost: 0 };
    }
    const claimedAt = this.dependencies.now();
    if (!this.dispatchFence()) {
      return { runIds, reconciled, reconcileErrors, claimed: 0, delivered: 0, retried: 0, dead: 0, leaseLost: 0 };
    }
    const claimed = this.dependencies.claimOutbox({
      owner: this.owner,
      leaseMs: this.outboxLeaseMs,
      limit: this.batchLimit,
      workspaceId: this.workspaceId,
      runIds,
      daemonFence: this.daemonFence,
      now: claimedAt.toISOString()
    });
    const outcomes = await Promise.all(claimed.map((event) => this.processClaimedEvent(event)));

    for (const runId of new Set(claimed.map((event) => event.runId))) {
      const run = this.dependencies.getRun(runId);
      if (!run || isTerminalRun(run)) continue;
      try {
        this.dependencies.reconcile({
          runId,
          leaseOwner: `${this.owner}:reconcile`,
          leaseMs: 30_000
        });
        reconciled += 1;
      } catch (error) {
        reconcileErrors += 1;
        this.dependencies.logger("reconcile_failed", { runId, error: errorMessage(error) });
      }
    }

    for (const run of this.registeredRuns()) {
      if (!isTerminalRun(run)) continue;
      const hasOpenOutbox = Boolean(this.dependencies.getNextWakeAt({
        workspaceId: this.workspaceId,
        runIds: [run.id]
      }));
      if (!hasOpenOutbox) this.runIds.delete(run.id);
    }

    const result = {
      runIds,
      reconciled,
      reconcileErrors,
      claimed: claimed.length,
      delivered: outcomes.filter((outcome) => outcome === "delivered").length,
      retried: outcomes.filter((outcome) => outcome === "retried").length,
      dead: outcomes.filter((outcome) => outcome === "dead").length,
      leaseLost: outcomes.filter((outcome) => outcome === "lease_lost").length
    } satisfies PortfolioBackgroundPassResult;
    if (result.claimed > 0 || result.reconcileErrors > 0 || result.dead > 0 || result.leaseLost > 0) {
      this.dependencies.logger("pass_completed", { workspaceId: this.workspaceId, ...result });
    }
    return result;
  }

  private async processClaimedEvent(event: ProductionOutboxRecord): Promise<PortfolioBackgroundEventOutcome> {
    const leaseToken = event.leaseToken;
    if (!leaseToken) return "lease_lost";
    let leaseLost = false;
    let heartbeatTimer: TimerHandle | null = null;
    const scheduleHeartbeat = () => {
      if (this.heartbeatMs === 0 || leaseLost) return;
      heartbeatTimer = this.dependencies.setTimer(() => {
        try {
          this.dependencies.renewOutboxLease({
            outboxId: event.id,
            leaseToken,
            leaseMs: this.outboxLeaseMs,
            daemonFence: this.daemonFence,
            now: this.dependencies.now().toISOString()
          });
          scheduleHeartbeat();
        } catch (error) {
          leaseLost = true;
          this.dependencies.logger("outbox_lease_lost", { outboxId: event.id, error: errorMessage(error) });
        }
      }, this.heartbeatMs);
      heartbeatTimer.unref?.();
    };
    scheduleHeartbeat();
    try {
      const run = this.dependencies.getRun(event.runId);
      if (!run || run.workspaceId !== this.workspaceId || !this.runIds.has(run.id)) {
        throw new Error("Claimed event is outside the registered workspace/run scope.");
      }
      if (run.mode === "simulation") throw new Error("Live dispatcher refuses simulation events.");
      if (!this.dispatchFence()) return "lease_lost";
      if (!(run.mode === "shadow" && event.eventKind === "publication.requested")) {
        const item = this.dependencies.getItem(event.productionItemId);
        const runChannel = this.dependencies.listRunChannels(event.runId)
          .find((channel) => channel.id === item?.runChannelId || channel.channelId === event.channelId);
        const resourceRequest = classifyPortfolioOutboxResource(event, {
          profileId: runChannel?.profileId ?? null,
          usesReasoningTokens: event.eventKind === "public_verify.requested" ? false : undefined,
          leaseMs: this.resourceLeaseMs
        });
        if (resourceRequest) {
          await this.limiter.withLease(resourceRequest, async () => this.dispatcher(event));
        } else {
          await this.dispatcher(event);
        }
      }
      if (leaseLost) return "lease_lost";
      this.dependencies.ackOutbox({
        outboxId: event.id,
        leaseToken,
        daemonFence: this.daemonFence,
        now: this.dependencies.now().toISOString()
      });
      return "delivered";
    } catch (error) {
      if (leaseLost) return "lease_lost";
      try {
        const now = this.dependencies.now();
        const retried = this.dependencies.retryOutbox({
          outboxId: event.id,
          leaseToken,
          error: errorMessage(error),
          daemonFence: this.daemonFence,
          availableAt: new Date(now.getTime() + this.retryDelayMs).toISOString(),
          now: now.toISOString()
        });
        return retried.status === "dead" ? "dead" : "retried";
      } catch (retryError) {
        this.dependencies.logger("outbox_retry_lost", {
          outboxId: event.id,
          error: errorMessage(retryError),
          originalError: errorMessage(error)
        });
        return "lease_lost";
      }
    } finally {
      if (heartbeatTimer) this.dependencies.clearTimer(heartbeatTimer);
    }
  }

  private scheduleNextWake(): void {
    const runs = this.registeredRuns();
    if (runs.length === 0 || this.runnerPromise || this.stopped) {
      this.clearWakeTimer();
      return;
    }
    const nowMs = this.dependencies.now().getTime();
    const durableWakeAt = this.dependencies.getNextWakeAt({
      workspaceId: this.workspaceId,
      runIds: runs.map((run) => run.id)
    });
    const durableWakeMs = durableWakeAt ? Date.parse(durableWakeAt) : Number.POSITIVE_INFINITY;
    const wakeMs = Math.min(nowMs + this.pollIntervalMs, durableWakeMs);
    const boundedWakeMs = Number.isFinite(wakeMs) ? Math.max(nowMs, wakeMs) : nowMs + this.pollIntervalMs;
    this.clearWakeTimer();
    this.wakeAt = new Date(boundedWakeMs).toISOString();
    this.wakeTimer = this.dependencies.setTimer(() => {
      this.wakeTimer = null;
      this.wakeAt = null;
      this.wakeNow();
    }, Math.max(0, boundedWakeMs - nowMs));
    this.wakeTimer.unref?.();
  }

  private clearWakeTimer(): void {
    if (this.wakeTimer) this.dependencies.clearTimer(this.wakeTimer);
    this.wakeTimer = null;
    this.wakeAt = null;
  }
}

function blockedScheduleResult(
  runId: string,
  blockerCode: string,
  blocker: string
): PortfolioBackgroundScheduleResult {
  return {
    scheduled: false,
    status: "blocked",
    runId,
    blockerCode,
    blocker,
    manifestId: null,
    manifestSha256: null
  };
}

function resolveRunManifestBinding(run: ProductionRunRecord): {
  manifestId: string;
  manifestSha256: string;
  approvedByUserId: string;
} {
  const profiles = listProductionRunChannels(run.id).map((channel) => getProductionProfile(channel.profileId));
  if (profiles.some((profile) => !profile || profile.workspaceId !== run.workspaceId)) {
    throw new Error("Run references a missing or cross-workspace production profile.");
  }
  const manifestIds = new Set(profiles.map((profile) => profile!.modelRouteManifestId));
  if (manifestIds.size !== 1) throw new Error("Run profiles are not bound to one model route manifest.");
  const manifestHashes = new Set(profiles.map((profile) => profile!.modelRouteManifestSha256));
  if (manifestHashes.size !== 1 || !/^[a-f0-9]{64}$/.test([...manifestHashes][0] ?? "")) {
    throw new Error("Run profiles are not bound to one exact model route manifest SHA-256.");
  }
  const approvedByUserIds = new Set(profiles.map((profile) => profile!.approvedByUserId).filter(Boolean));
  if (approvedByUserIds.size !== 1) throw new Error("Run profiles are not approved by one durable owner identity.");
  return {
    manifestId: [...manifestIds][0]!,
    manifestSha256: [...manifestHashes][0]!,
    approvedByUserId: [...approvedByUserIds][0]!
  };
}

export async function schedulePortfolioProductionLiveBackgroundRun(input: {
  runId: string;
  workspaceId: string;
  userId?: string | null;
  repoCwd?: string;
  manifestPath?: string | null;
  daemonLease?: {
    daemonId?: string;
    leaseToken: string;
    dispatchToken: string;
    configSha256: string;
  } | null;
}): Promise<PortfolioBackgroundScheduleResult> {
  const run = getProductionRun(input.runId);
  if (!run || run.workspaceId !== input.workspaceId) {
    return blockedScheduleResult(input.runId, "run_not_found", "Production run was not found in this workspace.");
  }
  if (run.mode === "simulation") {
    return {
      scheduled: false,
      status: "not_applicable",
      runId: run.id,
      blockerCode: null,
      blocker: null,
      manifestId: null,
      manifestSha256: null
    };
  }
  if (["blocked", "canceled", "failed"].includes(run.status)) {
    return blockedScheduleResult(
      run.id,
      "run_terminal",
      `Production run is terminal (${run.status}); background dispatch remains disabled.`
    );
  }
  if (run.mode === "live" && process.env.PORTFOLIO_PIPELINE_V1_ENABLED !== "1") {
    return blockedScheduleResult(
      run.id,
      "portfolio_feature_flag_disabled",
      "PORTFOLIO_PIPELINE_V1_ENABLED is not enabled; live background dispatch remains disabled."
    );
  }
  let binding: ReturnType<typeof resolveRunManifestBinding>;
  try {
    binding = resolveRunManifestBinding(run);
  } catch (error) {
    return blockedScheduleResult(run.id, "route_manifest_binding_invalid", errorMessage(error));
  }
  if (input.userId && input.userId !== binding.approvedByUserId) {
    return blockedScheduleResult(
      run.id,
      "runtime_owner_mismatch",
      "The requesting owner does not match the durable profile approver bound to this run."
    );
  }
  const userId = input.userId ?? binding.approvedByUserId;
  const repoCwd = input.repoCwd ?? process.cwd();
  let manifest;
  try {
    manifest = await loadFrozenProductionAgentRouteManifest({
      repoCwd,
      manifestPath: input.manifestPath,
      expectedManifestId: binding.manifestId
    });
  } catch (error) {
    const code = error instanceof ProductionAgentRouteManifestError ? error.code : "route_manifest_invalid";
    return blockedScheduleResult(run.id, code, errorMessage(error));
  }
  if (manifest.manifestSha256 !== binding.manifestSha256) {
    return blockedScheduleResult(
      run.id,
      "route_manifest_hash_mismatch",
      `Frozen route manifest hash ${manifest.manifestSha256} does not match profile binding ${binding.manifestSha256}.`
    );
  }
  const runtimeOptions: PortfolioLiveRuntimeOptions = {
    workspaceId: run.workspaceId,
    userId,
    routeManifestId: manifest.manifestId,
    routeManifestSha256: manifest.manifestSha256,
    selections: manifest.selections
  };
  if (!input.daemonLease) {
    return blockedScheduleResult(
      run.id,
      "portfolio_daemon_dispatch_lease_required",
      "Shadow/live dispatch is driven only by a bounded Zoro owner tick with exact daemon and dispatch leases."
    );
  }
  const daemonId = input.daemonLease?.daemonId ?? PROJECT_KINGS_PORTFOLIO_DAEMON_ID;
  const daemonLeaseToken = input.daemonLease.leaseToken;
  const dispatchToken = input.daemonLease.dispatchToken;
  const dispatchFence = () =>
    (run.mode !== "live" || process.env.PORTFOLIO_PIPELINE_V1_ENABLED === "1") &&
    isPortfolioDaemonDispatchLeaseActive({
      workspaceId: run.workspaceId,
      daemonId,
      daemonLeaseToken,
      dispatchToken
    });
  if (!dispatchFence()) {
    return blockedScheduleResult(
      run.id,
      "portfolio_daemon_lease_lost",
      "The persistent portfolio daemon or bounded dispatch lease is missing or expired."
    );
  }
  let runtime: PortfolioProductionBackgroundRuntime | null = null;
  try {
    runtime = new PortfolioProductionBackgroundRuntime({
      workspaceId: run.workspaceId,
      dispatcher: createPortfolioLiveDispatcher(runtimeOptions),
      limiter: new PortfolioProductionResourceLimiter(),
      owner: `portfolio-tick:${daemonId}:${dispatchToken}`,
      autoSchedule: false,
      dispatchFence,
      daemonFence: {
        daemonId,
        daemonLeaseToken,
        dispatchToken,
        configSha256: input.daemonLease.configSha256
      }
    });
    runtime.scheduleRun(run.id);
    await runtime.runNow();
  } catch (error) {
    return blockedScheduleResult(run.id, "background_runtime_start_failed", errorMessage(error));
  } finally {
    runtime?.stop();
  }
  return {
    scheduled: true,
    status: "scheduled",
    runId: run.id,
    blockerCode: null,
    blocker: null,
    manifestId: manifest.manifestId,
    manifestSha256: manifest.manifestSha256
  };
}

export function stopPortfolioProductionLiveBackgroundRuntime(input: {
  workspaceId: string;
  userId?: string | null;
}): number {
  void input;
  return 0;
}

export async function bootstrapPortfolioProductionLiveBackgroundRuntime(input: {
  repoCwd?: string;
  manifestPath?: string | null;
} = {}): Promise<PortfolioBackgroundScheduleResult[]> {
  if (process.env.PORTFOLIO_PIPELINE_V1_ENABLED !== "1") return [];
  const activeRuns = listProductionRuns({
    modes: ["shadow", "live"],
    statuses: [...ACTIVE_BACKGROUND_RUN_STATUSES],
    limit: 1_000
  });
  const completedRunsWithOpenOutbox = listProductionRuns({
    modes: ["shadow", "live"],
    statuses: ["completed"],
    hasOpenOutbox: true,
    limit: 1_000
  });
  const runs = [...activeRuns, ...completedRunsWithOpenOutbox];
  const results: PortfolioBackgroundScheduleResult[] = [];
  for (const run of runs) {
    results.push(await schedulePortfolioProductionLiveBackgroundRun({
      runId: run.id,
      workspaceId: run.workspaceId,
      repoCwd: input.repoCwd,
      manifestPath: input.manifestPath
    }));
  }
  return results;
}

export async function bootstrapPortfolioProductionLiveBackgroundRuntimeWithRetry(input: {
  repoCwd?: string;
  manifestPath?: string | null;
  maxAttempts?: number;
  backoffMs?: readonly number[];
} = {}, dependencies: PortfolioBootstrapRetryDependencies = {}): Promise<PortfolioBackgroundScheduleResult[]> {
  const maxAttempts = boundedInteger(
    input.maxAttempts,
    DEFAULT_BOOTSTRAP_ATTEMPTS,
    1,
    5,
    "bootstrap.maxAttempts"
  );
  const backoffMs = input.backoffMs ?? DEFAULT_BOOTSTRAP_BACKOFF_MS;
  const bootstrap = dependencies.bootstrap ?? bootstrapPortfolioProductionLiveBackgroundRuntime;
  const sleep = dependencies.sleep ?? delayDefault;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const results = await bootstrap({
        repoCwd: input.repoCwd,
        manifestPath: input.manifestPath
      });
      const hasRetryableBlocker = results.some(
        (result) => result.status === "blocked" && RETRYABLE_BOOTSTRAP_BLOCKER_CODES.has(result.blockerCode ?? "")
      );
      if (!hasRetryableBlocker || attempt === maxAttempts) return results;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) throw error;
    }
    await sleep(retryDelay(backoffMs, attempt));
  }

  throw lastError ?? new Error("Portfolio background bootstrap exhausted its retry budget.");
}

export function resetPortfolioProductionLiveBackgroundRuntimeForTests(): void {
  // The portfolio control plane has no process-global runtime or timer registry.
}
