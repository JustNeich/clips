import { createHash } from "node:crypto";

import {
  claimPortfolioChannelOwnerships,
  claimPortfolioDaemonDispatchLease,
  claimPortfolioDaemonLease,
  getPortfolioDaemonRuntime,
  heartbeatPortfolioDaemonDispatchLease,
  heartbeatPortfolioDaemonLease,
  markPortfolioDaemonStopping,
  PortfolioDaemonLeaseError,
  PROJECT_KINGS_PORTFOLIO_DAEMON_ID,
  releasePortfolioDaemonDispatchLease,
  releasePortfolioDaemonLease,
  requestPortfolioChannelOwnershipRelease,
  type PortfolioDaemonRuntimeRecord
} from "../portfolio-production-daemon-store";
import {
  schedulePortfolioProductionLiveBackgroundRun,
  stopPortfolioProductionLiveBackgroundRuntime,
  type PortfolioBackgroundScheduleResult
} from "../portfolio-production-live-background-runtime";
import { buildPortfolioLiveProfileValidator } from "../portfolio-production-live-preflight";
import { getActiveProjectKingsSourcePolicyApproval } from "./source-policy-approval-store";
import {
  getProductionProfile,
  isProductionProfileExplicitlyApproved,
  listProductionRunChannels,
  listProductionRuns,
  type ProductionProfileRecord,
  type ProductionRunMode,
  type ProductionRunRecord
} from "../portfolio-production-store";
import {
  PORTFOLIO_PIPELINE_FEATURE_FLAG,
  PORTFOLIO_PIPELINE_POST_CANARY_FEATURE_FLAG,
  PROJECT_KINGS_PUBLISH_POLICY_ID,
  resolveRunCanaryPolicy,
  startPortfolioProductionRun,
  validatePortfolioProductionProfile,
  type ProductionCanaryPolicy,
  type ProductionProfilePreflight
} from "../portfolio-production-orchestrator";

const RESUMABLE_RUN_STATUSES = [
  "created",
  "preflight",
  "ready",
  "running",
  "waiting_public",
  "cancel_requested"
] as const;

export const PROJECT_KINGS_PORTFOLIO_DAEMON_LEASE_MS = 90_000;
export const PROJECT_KINGS_PORTFOLIO_DISPATCH_LEASE_MS = 90_000;
export const PROJECT_KINGS_PORTFOLIO_FENCE_HEARTBEAT_MS = 30_000;

export class ProjectKingsPortfolioDaemonInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectKingsPortfolioDaemonInputError";
  }
}

export type ProjectKingsPortfolioDaemonConfig = Readonly<{
  profileIds: readonly [string, string, string];
  mode: Extract<ProductionRunMode, "shadow" | "live">;
  canaryPolicy: ProductionCanaryPolicy;
  timezone: string;
  targetPerChannel: 3;
  publishPolicyId: typeof PROJECT_KINGS_PUBLISH_POLICY_ID;
  daemonId: typeof PROJECT_KINGS_PORTFOLIO_DAEMON_ID;
}>;

export type ProjectKingsPortfolioDaemonTickInput = Readonly<{
  workspaceId: string;
  leaseOwner: string;
  leaseToken?: string | null;
  profileIds: readonly string[];
  mode: "shadow" | "live";
  canaryPolicy?: ProductionCanaryPolicy | null;
  timezone?: string | null;
  repoCwd?: string;
  manifestPath?: string | null;
  leaseMs?: number;
}>;

export type ProjectKingsPortfolioDaemonTickResult = Readonly<{
  role: "leader" | "standby";
  status: "running" | "blocked" | "error";
  daemonId: typeof PROJECT_KINGS_PORTFOLIO_DAEMON_ID;
  logicalDate: string;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  heartbeatAt: string | null;
  runtimeVersion: number | null;
  startedRunId: string | null;
  activeRunIds: readonly string[];
  scheduledRunIds: readonly string[];
  blockers: readonly string[];
}>;

export type ProjectKingsPortfolioDaemonReleaseResult = Readonly<{
  released: boolean;
  daemonId: typeof PROJECT_KINGS_PORTFOLIO_DAEMON_ID;
  stoppedRuntimes: number;
  status: "stopping" | "stopped" | "lease_lost";
  channelOwnershipsReleased: boolean;
}>;

type StoredProfileResolution = Readonly<{
  profiles: readonly ProductionProfileRecord[];
  approvedByUserId: string;
}>;

type StartResult = Readonly<{
  run: ProductionRunRecord;
  existing?: boolean;
}>;

type FenceHeartbeatHandle = ReturnType<typeof setInterval>;

export type ProjectKingsPortfolioDaemonDependencies = {
  now?: () => Date;
  getRuntime?: typeof getPortfolioDaemonRuntime;
  claimLease?: typeof claimPortfolioDaemonLease;
  heartbeatLease?: typeof heartbeatPortfolioDaemonLease;
  releaseLease?: typeof releasePortfolioDaemonLease;
  resolveProfiles?: (input: {
    workspaceId: string;
    config: ProjectKingsPortfolioDaemonConfig;
  }) => StoredProfileResolution;
  listRuns?: typeof listProductionRuns;
  listRunChannels?: typeof listProductionRunChannels;
  preflightProfiles?: (input: {
    workspaceId: string;
    approvedByUserId: string;
    profiles: readonly ProductionProfileRecord[];
  }) => Promise<readonly ProductionProfilePreflight[]>;
  startDailyRun?: (input: {
    workspaceId: string;
    approvedByUserId: string;
    config: ProjectKingsPortfolioDaemonConfig;
    logicalDate: string;
  }) => Promise<StartResult>;
  scheduleRun?: (input: {
    workspaceId: string;
    approvedByUserId: string;
    config: ProjectKingsPortfolioDaemonConfig;
    run: ProductionRunRecord;
    leaseToken: string;
    dispatchToken: string;
    configSha256: string;
    repoCwd: string;
    manifestPath: string | null;
  }) => Promise<PortfolioBackgroundScheduleResult>;
  stopRuntime?: typeof stopPortfolioProductionLiveBackgroundRuntime;
  claimDispatchLease?: typeof claimPortfolioDaemonDispatchLease;
  heartbeatDispatchLease?: typeof heartbeatPortfolioDaemonDispatchLease;
  releaseDispatchLease?: typeof releasePortfolioDaemonDispatchLease;
  claimChannelOwnerships?: typeof claimPortfolioChannelOwnerships;
  requestChannelOwnershipRelease?: typeof requestPortfolioChannelOwnershipRelease;
  markStopping?: typeof markPortfolioDaemonStopping;
  setFenceHeartbeat?: (callback: () => void, intervalMs: number) => FenceHeartbeatHandle;
  clearFenceHeartbeat?: (handle: FenceHeartbeatHandle) => void;
  featureFlagEnabled?: () => boolean;
  postCanaryEnabled?: () => boolean;
};

function requiredText(value: string, field: string, maxLength = 512): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    throw new ProjectKingsPortfolioDaemonInputError(
      `${field} is required and must be <= ${maxLength} characters.`
    );
  }
  return trimmed;
}

function validateTimezone(value: string): string {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: value }).format(new Date());
    return value;
  } catch {
    throw new ProjectKingsPortfolioDaemonInputError(`Invalid Project Kings portfolio timezone: ${value}`);
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export function resolveProjectKingsPortfolioDaemonConfig(input: {
  profileIds: readonly string[];
  mode: "shadow" | "live";
  canaryPolicy?: ProductionCanaryPolicy | null;
  timezone?: string | null;
}): ProjectKingsPortfolioDaemonConfig {
  const profileIds = input.profileIds.map((value) => requiredText(value, "profileId", 64));
  if (profileIds.length !== 3 || new Set(profileIds).size !== 3) {
    throw new ProjectKingsPortfolioDaemonInputError(
      "Project Kings portfolio daemon requires exactly three unique stored profile IDs."
    );
  }
  if (input.mode !== "shadow" && input.mode !== "live") {
    throw new ProjectKingsPortfolioDaemonInputError("Project Kings portfolio daemon mode must be shadow or live.");
  }
  const canaryPolicy = input.canaryPolicy ?? (input.mode === "live" ? "first_item_per_channel_public_verified" : "none");
  if (canaryPolicy !== "first_item_per_channel_public_verified" && canaryPolicy !== "none") {
    throw new ProjectKingsPortfolioDaemonInputError(`Unsupported portfolio canary policy: ${String(canaryPolicy)}`);
  }
  if (input.mode === "shadow" && canaryPolicy !== "none") {
    throw new ProjectKingsPortfolioDaemonInputError("Shadow portfolio daemon always requires canaryPolicy=none.");
  }
  return {
    profileIds: profileIds as [string, string, string],
    mode: input.mode,
    canaryPolicy,
    timezone: validateTimezone(input.timezone?.trim() || "Europe/Moscow"),
    targetPerChannel: 3,
    publishPolicyId: PROJECT_KINGS_PUBLISH_POLICY_ID,
    daemonId: PROJECT_KINGS_PORTFOLIO_DAEMON_ID
  };
}

export function projectKingsLogicalDate(now: Date, timezone: string): string {
  if (!Number.isFinite(now.getTime())) {
    throw new ProjectKingsPortfolioDaemonInputError("Project Kings portfolio daemon clock is invalid.");
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: validateTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function configEvidence(config: ProjectKingsPortfolioDaemonConfig): Record<string, unknown> {
  return {
    schemaVersion: 2,
    daemonId: config.daemonId,
    mode: config.mode,
    canaryPolicy: config.canaryPolicy,
    timezone: config.timezone,
    profileIds: [...config.profileIds].sort(),
    targetPerChannel: config.targetPerChannel,
    publishPolicyId: config.publishPolicyId
  };
}

export function hashProjectKingsPortfolioDaemonConfig(config: ProjectKingsPortfolioDaemonConfig): string {
  return sha256(configEvidence(config));
}

function resolveStoredProfiles(input: {
  workspaceId: string;
  config: ProjectKingsPortfolioDaemonConfig;
}): StoredProfileResolution {
  if (!getActiveProjectKingsSourcePolicyApproval(input.workspaceId)) {
    throw new Error(
      "Shadow/live daemon requires an active owner approval for the exact current Project Kings source policy."
    );
  }
  const profiles = input.config.profileIds.map((profileId) => getProductionProfile(profileId));
  if (profiles.some((profile) => !profile)) {
    throw new Error("One or more configured Project Kings production profiles do not exist.");
  }
  const resolved = profiles as ProductionProfileRecord[];
  if (new Set(resolved.map((profile) => profile.channelId)).size !== 3) {
    throw new Error("Configured profiles must represent exactly three unique channels.");
  }
  if (new Set(resolved.map((profile) => profile.expectedYoutubeChannelId)).size !== 3) {
    throw new Error("Configured profiles must represent exactly three unique YouTube destinations.");
  }
  for (const profile of resolved) {
    if (profile.workspaceId !== input.workspaceId) {
      throw new Error(`Profile ${profile.id} belongs to another workspace.`);
    }
    if (profile.publishPolicyId !== input.config.publishPolicyId) {
      throw new Error(`Profile ${profile.id} is not bound to ${input.config.publishPolicyId}.`);
    }
    if (profile.targetPerLogicalDay !== input.config.targetPerChannel) {
      throw new Error(`Profile ${profile.id} targetPerLogicalDay must equal 3.`);
    }
    if (input.config.mode === "live" && !isProductionProfileExplicitlyApproved(profile, "live")) {
      throw new Error(`Live daemon requires an explicitly approved active profile ${profile.id}.`);
    }
    if (input.config.mode === "shadow" && !isProductionProfileExplicitlyApproved(profile, "shadow")) {
      throw new Error(`Shadow daemon requires an explicitly approved shadow or active profile ${profile.id}.`);
    }
  }
  const approvers = new Set(resolved.map((profile) => profile.approvedByUserId).filter(Boolean));
  if (approvers.size !== 1) {
    throw new Error("Configured profiles must share one durable approving owner.");
  }
  return { profiles: resolved, approvedByUserId: [...approvers][0]! };
}

function runMatchesConfig(
  run: ProductionRunRecord,
  config: ProjectKingsPortfolioDaemonConfig,
  listRunChannels: typeof listProductionRunChannels
): boolean {
  const expected = [...config.profileIds].sort();
  const actual = listRunChannels(run.id).map((channel) => channel.profileId).sort();
  return actual.length === expected.length &&
    actual.every((profileId, index) => profileId === expected[index]) &&
    resolveRunCanaryPolicy(run) === config.canaryPolicy;
}

function listConfiguredRuns(input: {
  workspaceId: string;
  config: ProjectKingsPortfolioDaemonConfig;
  dependencies: Required<ProjectKingsPortfolioDaemonDependencies>;
  resumableOnly: boolean;
}): ProductionRunRecord[] {
  const active = input.dependencies.listRuns({
    workspaceId: input.workspaceId,
    modes: [input.config.mode],
    statuses: input.resumableOnly ? [...RESUMABLE_RUN_STATUSES] : undefined,
    limit: 1_000
  });
  const completedWithOutbox = input.resumableOnly
    ? input.dependencies.listRuns({
        workspaceId: input.workspaceId,
        modes: [input.config.mode],
        statuses: ["completed"],
        hasOpenOutbox: true,
        limit: 1_000
      })
    : [];
  return [...new Map([...active, ...completedWithOutbox].map((run) => [run.id, run])).values()]
    .filter((run) => runMatchesConfig(run, input.config, input.dependencies.listRunChannels));
}

function defaultDependencies(): Required<ProjectKingsPortfolioDaemonDependencies> {
  return {
    now: () => new Date(),
    getRuntime: getPortfolioDaemonRuntime,
    claimLease: claimPortfolioDaemonLease,
    heartbeatLease: heartbeatPortfolioDaemonLease,
    releaseLease: releasePortfolioDaemonLease,
    claimDispatchLease: claimPortfolioDaemonDispatchLease,
    heartbeatDispatchLease: heartbeatPortfolioDaemonDispatchLease,
    releaseDispatchLease: releasePortfolioDaemonDispatchLease,
    claimChannelOwnerships: claimPortfolioChannelOwnerships,
    requestChannelOwnershipRelease: requestPortfolioChannelOwnershipRelease,
    markStopping: markPortfolioDaemonStopping,
    setFenceHeartbeat: (callback, intervalMs) => setInterval(callback, intervalMs),
    clearFenceHeartbeat: (handle) => clearInterval(handle),
    resolveProfiles: resolveStoredProfiles,
    listRuns: listProductionRuns,
    listRunChannels: listProductionRunChannels,
    preflightProfiles: async ({ workspaceId, approvedByUserId, profiles }) => {
      const validateLiveProfile = buildPortfolioLiveProfileValidator({
        workspaceId,
        userId: approvedByUserId
      });
      return Promise.all(
        profiles.map((profile) => validatePortfolioProductionProfile(profile, { validateLiveProfile }))
      );
    },
    startDailyRun: async ({ workspaceId, approvedByUserId, config, logicalDate }) =>
      startPortfolioProductionRun({
        workspaceId,
        profileIds: [...config.profileIds],
        logicalDate,
        mode: config.mode,
        canaryPolicy: config.canaryPolicy,
        targetPerChannel: config.targetPerChannel,
        publishPolicyId: config.publishPolicyId,
        idempotencyKey: `${config.daemonId}:${config.mode}:${config.canaryPolicy}:${logicalDate}`
      }, {
        validateLiveProfile: buildPortfolioLiveProfileValidator({ workspaceId, userId: approvedByUserId }),
        featureFlagEnabled: (flag) =>
          flag === PORTFOLIO_PIPELINE_FEATURE_FLAG
            ? config.mode !== "live" || process.env.PORTFOLIO_PIPELINE_V1_ENABLED === "1"
            : flag === PORTFOLIO_PIPELINE_POST_CANARY_FEATURE_FLAG &&
              process.env.PORTFOLIO_PIPELINE_POST_CANARY_ENABLED === "1"
      }),
    scheduleRun: async ({
      workspaceId,
      approvedByUserId,
      config,
      run,
      leaseToken,
      dispatchToken,
      configSha256,
      repoCwd,
      manifestPath
    }) =>
      schedulePortfolioProductionLiveBackgroundRun({
        runId: run.id,
        workspaceId,
        userId: approvedByUserId,
        repoCwd,
        manifestPath,
        daemonLease: { daemonId: config.daemonId, leaseToken, dispatchToken, configSha256 }
      }),
    stopRuntime: stopPortfolioProductionLiveBackgroundRuntime,
    featureFlagEnabled: () => process.env.PORTFOLIO_PIPELINE_V1_ENABLED === "1",
    postCanaryEnabled: () => process.env.PORTFOLIO_PIPELINE_POST_CANARY_ENABLED === "1"
  };
}

function withDependencies(
  overrides: ProjectKingsPortfolioDaemonDependencies
): Required<ProjectKingsPortfolioDaemonDependencies> {
  return { ...defaultDependencies(), ...overrides };
}

function standbyResult(input: {
  logicalDate: string;
  runtime: PortfolioDaemonRuntimeRecord | null;
  status?: "running" | "blocked" | "error";
  blockers?: readonly string[];
}): ProjectKingsPortfolioDaemonTickResult {
  return {
    role: "standby",
    status: input.status ?? "running",
    daemonId: PROJECT_KINGS_PORTFOLIO_DAEMON_ID,
    logicalDate: input.logicalDate,
    leaseToken: null,
    leaseExpiresAt: input.runtime?.leaseExpiresAt ?? null,
    heartbeatAt: input.runtime?.heartbeatAt ?? null,
    runtimeVersion: input.runtime?.version ?? null,
    startedRunId: null,
    activeRunIds: input.runtime?.activeRunIds ?? [],
    scheduledRunIds: [],
    blockers: input.blockers ?? []
  };
}

function boundedLeaseMs(value: number | undefined): number {
  const resolved = value ?? PROJECT_KINGS_PORTFOLIO_DAEMON_LEASE_MS;
  if (!Number.isInteger(resolved) || resolved < 30_000 || resolved > 5 * 60_000) {
    throw new ProjectKingsPortfolioDaemonInputError(
      "Project Kings portfolio daemon lease must be between 30000 and 300000 milliseconds."
    );
  }
  return resolved;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function collectRunBlockers(
  run: ProductionRunRecord,
  listRunChannels: typeof listProductionRunChannels
): string[] {
  const blockers: string[] = [];
  if (["blocked", "failed", "canceled"].includes(run.status)) {
    blockers.push(`${run.id}: run_${run.status}: ${run.lastError ?? "no detail"}`);
  }
  for (const channel of listRunChannels(run.id)) {
    if (!["blocked", "failed", "canceled"].includes(channel.status)) continue;
    blockers.push(
      `${run.id}/${channel.channelId}: channel_${channel.status}: ${channel.blockerCode ?? "no_code"}: ${channel.blockerMessage ?? "no detail"}`
    );
  }
  return blockers;
}

export async function tickProjectKingsPortfolioDaemon(
  input: ProjectKingsPortfolioDaemonTickInput,
  dependencyOverrides: ProjectKingsPortfolioDaemonDependencies = {}
): Promise<ProjectKingsPortfolioDaemonTickResult> {
  const dependencies = withDependencies(dependencyOverrides);
  const workspaceId = requiredText(input.workspaceId, "workspaceId", 64);
  const leaseOwner = requiredText(input.leaseOwner, "leaseOwner", 320);
  const config = resolveProjectKingsPortfolioDaemonConfig({
    profileIds: input.profileIds,
    mode: input.mode,
    canaryPolicy: input.canaryPolicy,
    timezone: input.timezone
  });
  const now = dependencies.now();
  const stamp = now.toISOString();
  const logicalDate = projectKingsLogicalDate(now, config.timezone);
  const leaseMs = boundedLeaseMs(input.leaseMs);
  const configSha256 = hashProjectKingsPortfolioDaemonConfig(config);
  const configRecord = configEvidence(config);
  let runtime: PortfolioDaemonRuntimeRecord | null;

  if (input.leaseToken?.trim()) {
    const current = dependencies.getRuntime({ workspaceId, daemonId: config.daemonId });
    try {
      runtime = dependencies.heartbeatLease({
        workspaceId,
        daemonId: config.daemonId,
        leaseToken: input.leaseToken.trim(),
        leaseMs,
        configSha256,
        status: "running",
        logicalDate,
        activeRunIds: current?.activeRunIds ?? [],
        lastError: null,
        now: stamp
      });
    } catch (error) {
      if (error instanceof PortfolioDaemonLeaseError && error.code === "lease_lost") {
        return standbyResult({
          logicalDate,
          runtime: dependencies.getRuntime({ workspaceId, daemonId: config.daemonId }),
          status: "error",
          blockers: ["portfolio_daemon_lease_lost"]
        });
      }
      throw error;
    }
  } else {
    runtime = dependencies.claimLease({
      workspaceId,
      daemonId: config.daemonId,
      owner: leaseOwner,
      leaseMs,
      configSha256,
      config: configRecord,
      now: stamp
    });
    if (!runtime?.leaseToken) {
      return standbyResult({
        logicalDate,
        runtime: dependencies.getRuntime({ workspaceId, daemonId: config.daemonId })
      });
    }
  }

  const leaseToken = runtime.leaseToken!;
  const heartbeat = (status: "running" | "blocked" | "error", activeRunIds: readonly string[], lastError: string | null) =>
    dependencies.heartbeatLease({
      workspaceId,
      daemonId: config.daemonId,
      leaseToken,
      leaseMs,
      configSha256,
      status,
      logicalDate,
      activeRunIds,
      lastError,
      now: dependencies.now().toISOString()
    });

  if (config.mode === "live" && !dependencies.featureFlagEnabled()) {
    dependencies.stopRuntime({ workspaceId });
    const blocker = "portfolio_feature_flag_disabled";
    runtime = heartbeat("blocked", [], blocker);
    return {
      ...standbyResult({ logicalDate, runtime, status: "blocked", blockers: [blocker] }),
      role: "leader",
      leaseToken
    };
  }

  if (config.mode === "live" && config.canaryPolicy === "none" && !dependencies.postCanaryEnabled()) {
    dependencies.stopRuntime({ workspaceId });
    const blocker = "post_canary_feature_flag_disabled";
    runtime = heartbeat("blocked", [], blocker);
    return {
      ...standbyResult({ logicalDate, runtime, status: "blocked", blockers: [blocker] }),
      role: "leader",
      leaseToken
    };
  }

  let profiles: StoredProfileResolution;
  try {
    profiles = dependencies.resolveProfiles({ workspaceId, config });
    if (profiles.profiles.length > 0) {
      if (profiles.profiles.length !== config.profileIds.length) {
        throw new Error("Resolved production profiles are incomplete for channel ownership.");
      }
      dependencies.claimChannelOwnerships({
        workspaceId,
        daemonId: config.daemonId,
        daemonLeaseToken: leaseToken,
        configSha256,
        profiles: profiles.profiles.map((profile) => ({
          id: profile.id,
          channelId: profile.channelId,
          version: profile.version,
          profileHash: profile.profileHash
        })),
        now: dependencies.now().toISOString()
      });
    }
  } catch (error) {
    dependencies.stopRuntime({ workspaceId });
    const blocker = `profile_config_invalid: ${errorMessage(error)}`;
    runtime = heartbeat("blocked", [], blocker);
    return {
      ...standbyResult({ logicalDate, runtime, status: "blocked", blockers: [blocker] }),
      role: "leader",
      leaseToken
    };
  }

  const dispatchLease = dependencies.claimDispatchLease({
    workspaceId,
    daemonId: config.daemonId,
    daemonLeaseToken: leaseToken,
    owner: `${leaseOwner}:bounded-tick`,
    leaseMs: PROJECT_KINGS_PORTFOLIO_DISPATCH_LEASE_MS,
    now: dependencies.now().toISOString()
  });
  if (!dispatchLease) {
    const activeRuns = listConfiguredRuns({ workspaceId, config, dependencies, resumableOnly: true });
    runtime = heartbeat("running", activeRuns.map((run) => run.id), null);
    return {
      role: "leader",
      status: "running",
      daemonId: config.daemonId,
      logicalDate,
      leaseToken,
      leaseExpiresAt: runtime.leaseExpiresAt,
      heartbeatAt: runtime.heartbeatAt,
      runtimeVersion: runtime.version,
      startedRunId: null,
      activeRunIds: activeRuns.map((run) => run.id).sort(),
      scheduledRunIds: [],
      blockers: ["portfolio_dispatch_busy"]
    };
  }
  let heartbeatRunIds: readonly string[] = runtime.activeRunIds;
  let fenceHeartbeatError: string | null = null;
  const fenceHeartbeatTimer = dependencies.setFenceHeartbeat(() => {
    try {
      runtime = heartbeat("running", heartbeatRunIds, null);
      dependencies.heartbeatDispatchLease({
        workspaceId,
        daemonId: config.daemonId,
        daemonLeaseToken: leaseToken,
        dispatchToken: dispatchLease.dispatchToken,
        leaseMs: PROJECT_KINGS_PORTFOLIO_DISPATCH_LEASE_MS,
        now: dependencies.now().toISOString()
      });
    } catch (error) {
      fenceHeartbeatError = errorMessage(error);
      dependencies.clearFenceHeartbeat(fenceHeartbeatTimer);
    }
  }, PROJECT_KINGS_PORTFOLIO_FENCE_HEARTBEAT_MS);
  fenceHeartbeatTimer.unref?.();

  let startedRunId: string | null = null;
  const blockers: string[] = [];
  try {
    const sameDay = listConfiguredRuns({
      workspaceId,
      config,
      dependencies,
      resumableOnly: false
    }).find((run) => run.logicalDate === logicalDate);
    if (!sameDay) {
      const preflight = await dependencies.preflightProfiles({
        workspaceId,
        approvedByUserId: profiles.approvedByUserId,
        profiles: profiles.profiles
      });
      const expectedPreflightIds = [...config.profileIds].sort();
      const actualPreflightIds = preflight.map((profile) => profile.profileId).sort();
      const preflightBlockers = actualPreflightIds.length === expectedPreflightIds.length &&
          actualPreflightIds.every((profileId, index) => profileId === expectedPreflightIds[index])
        ? preflight.flatMap((profile) =>
        profile.blockers.map((blocker) => `${profile.profileId}: ${blocker}`)
          )
        : ["daily_preflight_incomplete: expected one result for each configured profile"];
      if (preflightBlockers.length) {
        blockers.push(...preflightBlockers);
      } else {
        const started = await dependencies.startDailyRun({
          workspaceId,
          approvedByUserId: profiles.approvedByUserId,
          config,
          logicalDate
        });
        startedRunId = started.run.id;
        blockers.push(...collectRunBlockers(started.run, dependencies.listRunChannels));
      }
    } else {
      startedRunId = sameDay.id;
      blockers.push(...collectRunBlockers(sameDay, dependencies.listRunChannels));
    }

    const activeRuns = listConfiguredRuns({ workspaceId, config, dependencies, resumableOnly: true });
    heartbeatRunIds = activeRuns.map((run) => run.id).sort();
    const scheduledRunIds: string[] = [];
    for (const run of activeRuns) {
      if (fenceHeartbeatError) {
        blockers.push(`portfolio_daemon_lease_lost: ${fenceHeartbeatError}`);
        break;
      }
      const scheduled = await dependencies.scheduleRun({
        workspaceId,
        approvedByUserId: profiles.approvedByUserId,
        config,
        run,
        leaseToken,
        dispatchToken: dispatchLease.dispatchToken,
        configSha256,
        repoCwd: input.repoCwd ?? process.cwd(),
        manifestPath: input.manifestPath ?? null
      });
      if (scheduled.scheduled) {
        scheduledRunIds.push(run.id);
      } else if (scheduled.status === "blocked") {
        blockers.push(`${run.id}: ${scheduled.blockerCode ?? "background_blocked"}: ${scheduled.blocker ?? "no detail"}`);
      }
    }
    if (fenceHeartbeatError && !blockers.some((blocker) => blocker.startsWith("portfolio_daemon_lease_lost"))) {
      blockers.push(`portfolio_daemon_lease_lost: ${fenceHeartbeatError}`);
    }
    const activeRunIds = activeRuns.map((run) => run.id).sort();
    runtime = heartbeat(
      blockers.length ? "blocked" : "running",
      activeRunIds,
      blockers.length ? blockers.join("; ").slice(0, 4000) : null
    );
    return {
      role: "leader",
      status: blockers.length ? "blocked" : "running",
      daemonId: config.daemonId,
      logicalDate,
      leaseToken,
      leaseExpiresAt: runtime.leaseExpiresAt,
      heartbeatAt: runtime.heartbeatAt,
      runtimeVersion: runtime.version,
      startedRunId,
      activeRunIds,
      scheduledRunIds: scheduledRunIds.sort(),
      blockers
    };
  } catch (error) {
    const blocker = errorMessage(error).slice(0, 4000);
    try {
      runtime = heartbeat("error", runtime.activeRunIds, blocker);
    } catch (heartbeatError) {
      if (heartbeatError instanceof PortfolioDaemonLeaseError && heartbeatError.code === "lease_lost") {
        return standbyResult({
          logicalDate,
          runtime: dependencies.getRuntime({ workspaceId, daemonId: config.daemonId }),
          status: "error",
          blockers: ["portfolio_daemon_lease_lost", blocker]
        });
      }
      throw heartbeatError;
    }
    return {
      role: "leader",
      status: "error",
      daemonId: config.daemonId,
      logicalDate,
      leaseToken,
      leaseExpiresAt: runtime.leaseExpiresAt,
      heartbeatAt: runtime.heartbeatAt,
      runtimeVersion: runtime.version,
      startedRunId,
      activeRunIds: runtime.activeRunIds,
      scheduledRunIds: [],
      blockers: [blocker]
    };
  } finally {
    dependencies.clearFenceHeartbeat(fenceHeartbeatTimer);
    dependencies.releaseDispatchLease({
      workspaceId,
      daemonId: config.daemonId,
      daemonLeaseToken: leaseToken,
      dispatchToken: dispatchLease.dispatchToken,
      now: dependencies.now().toISOString()
    });
  }
}

export function releaseProjectKingsPortfolioDaemon(input: {
  workspaceId: string;
  leaseToken: string;
  now?: string;
}, dependencyOverrides: Pick<
  ProjectKingsPortfolioDaemonDependencies,
  "releaseLease" | "stopRuntime" | "requestChannelOwnershipRelease" | "markStopping"
> = {}): ProjectKingsPortfolioDaemonReleaseResult {
  const workspaceId = requiredText(input.workspaceId, "workspaceId", 64);
  const leaseToken = requiredText(input.leaseToken, "leaseToken", 64);
  const releaseLease = dependencyOverrides.releaseLease ?? releasePortfolioDaemonLease;
  const stopRuntime = dependencyOverrides.stopRuntime ?? stopPortfolioProductionLiveBackgroundRuntime;
  const requestOwnershipRelease = dependencyOverrides.requestChannelOwnershipRelease ?? requestPortfolioChannelOwnershipRelease;
  const markStopping = dependencyOverrides.markStopping ?? markPortfolioDaemonStopping;
  try {
    const ownershipRelease = requestOwnershipRelease({
      workspaceId,
      daemonId: PROJECT_KINGS_PORTFOLIO_DAEMON_ID,
      daemonLeaseToken: leaseToken,
      now: input.now
    });
    if (!ownershipRelease.allReleased) {
      markStopping({
        workspaceId,
        daemonId: PROJECT_KINGS_PORTFOLIO_DAEMON_ID,
        leaseToken,
        now: input.now
      });
      return {
        released: false,
        daemonId: PROJECT_KINGS_PORTFOLIO_DAEMON_ID,
        stoppedRuntimes: stopRuntime({ workspaceId }),
        status: "stopping",
        channelOwnershipsReleased: false
      };
    }
    releaseLease({
      workspaceId,
      daemonId: PROJECT_KINGS_PORTFOLIO_DAEMON_ID,
      leaseToken,
      status: "stopped",
      now: input.now
    });
  } catch (error) {
    if (error instanceof PortfolioDaemonLeaseError && error.code === "lease_lost") {
      return {
        released: false,
        daemonId: PROJECT_KINGS_PORTFOLIO_DAEMON_ID,
        stoppedRuntimes: 0,
        status: "lease_lost",
        channelOwnershipsReleased: false
      };
    }
    throw error;
  }
  return {
    released: true,
    daemonId: PROJECT_KINGS_PORTFOLIO_DAEMON_ID,
    stoppedRuntimes: stopRuntime({ workspaceId }),
    status: "stopped",
    channelOwnershipsReleased: true
  };
}
