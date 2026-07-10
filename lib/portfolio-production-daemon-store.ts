import type { DatabaseSync } from "node:sqlite";

import { getDb, newId, nowIso, runInTransaction } from "./db/client";

export const PROJECT_KINGS_PORTFOLIO_DAEMON_ID = "project-kings-portfolio-v1";

export type PortfolioDaemonRuntimeStatus =
  | "standby"
  | "running"
  | "blocked"
  | "error"
  | "stopping"
  | "stopped";

export type PortfolioDaemonRuntimeRecord = Readonly<{
  scopeKey: string;
  workspaceId: string;
  daemonId: string;
  configSha256: string | null;
  config: Readonly<Record<string, unknown>>;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  dispatchOwner: string | null;
  dispatchToken: string | null;
  dispatchExpiresAt: string | null;
  dispatchHeartbeatAt: string | null;
  heartbeatAt: string | null;
  status: PortfolioDaemonRuntimeStatus;
  logicalDate: string | null;
  activeRunIds: readonly string[];
  lastError: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export class PortfolioDaemonLeaseError extends Error {
  readonly code: "invalid_input" | "lease_lost" | "dispatch_busy" | "ownership_conflict";

  constructor(code: PortfolioDaemonLeaseError["code"], message: string) {
    super(message);
    this.name = "PortfolioDaemonLeaseError";
    this.code = code;
  }
}

type Row = Record<string, unknown>;

function requiredText(value: string, field: string, maxLength = 512): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    throw new PortfolioDaemonLeaseError("invalid_input", `${field} is required and must be <= ${maxLength} characters.`);
  }
  return trimmed;
}

function optionalText(value: string | null | undefined, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) {
    throw new PortfolioDaemonLeaseError("invalid_input", `Optional text must be <= ${maxLength} characters.`);
  }
  return trimmed;
}

function parseIso(value: string | undefined, field: string): string {
  const resolved = value ?? nowIso();
  if (!Number.isFinite(Date.parse(resolved))) {
    throw new PortfolioDaemonLeaseError("invalid_input", `${field} must be an ISO timestamp.`);
  }
  return new Date(resolved).toISOString();
}

function boundedLeaseMs(value: number): number {
  if (!Number.isInteger(value) || value < 5_000 || value > 5 * 60_000) {
    throw new PortfolioDaemonLeaseError("invalid_input", "leaseMs must be an integer between 5000 and 300000.");
  }
  return value;
}

function scopeKey(workspaceId: string, daemonId: string): string {
  return `${requiredText(workspaceId, "workspaceId", 64)}:${requiredText(daemonId, "daemonId", 160)}`;
}

function normalizeRunIds(values: readonly string[] | undefined): string[] {
  const output = [...new Set((values ?? []).map((value) => requiredText(value, "activeRunId", 64)))].sort();
  if (output.length > 1_000) {
    throw new PortfolioDaemonLeaseError("invalid_input", "activeRunIds cannot exceed 1000 entries.");
  }
  return output;
}

function normalizeConfig(input: {
  configSha256?: string | null;
  config?: Readonly<Record<string, unknown>> | null;
}): { configSha256: string | null; configJson: string } {
  const configSha256 = optionalText(input.configSha256, 64);
  if (configSha256 && !/^[a-f0-9]{64}$/.test(configSha256)) {
    throw new PortfolioDaemonLeaseError("invalid_input", "configSha256 must be a lowercase SHA-256 digest.");
  }
  const configJson = JSON.stringify(input.config ?? {});
  if (Buffer.byteLength(configJson, "utf8") > 32_768) {
    throw new PortfolioDaemonLeaseError("invalid_input", "Portfolio daemon config must be <= 32768 bytes.");
  }
  return { configSha256, configJson };
}

function mapRow(row: Row): PortfolioDaemonRuntimeRecord {
  let activeRunIds: string[] = [];
  try {
    const parsed = JSON.parse(String(row.active_run_ids_json ?? "[]"));
    if (Array.isArray(parsed)) activeRunIds = parsed.filter((value): value is string => typeof value === "string");
  } catch {
    activeRunIds = [];
  }
  let config: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(String(row.config_json ?? "{}"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      config = parsed as Record<string, unknown>;
    }
  } catch {
    config = {};
  }
  return {
    scopeKey: String(row.scope_key),
    workspaceId: String(row.workspace_id),
    daemonId: String(row.daemon_id),
    configSha256: typeof row.config_sha256 === "string" ? row.config_sha256 : null,
    config,
    leaseOwner: typeof row.lease_owner === "string" ? row.lease_owner : null,
    leaseToken: typeof row.lease_token === "string" ? row.lease_token : null,
    leaseExpiresAt: typeof row.lease_expires_at === "string" ? row.lease_expires_at : null,
    dispatchOwner: typeof row.dispatch_owner === "string" ? row.dispatch_owner : null,
    dispatchToken: typeof row.dispatch_token === "string" ? row.dispatch_token : null,
    dispatchExpiresAt: typeof row.dispatch_expires_at === "string" ? row.dispatch_expires_at : null,
    dispatchHeartbeatAt: typeof row.dispatch_heartbeat_at === "string" ? row.dispatch_heartbeat_at : null,
    heartbeatAt: typeof row.heartbeat_at === "string" ? row.heartbeat_at : null,
    status: String(row.status) as PortfolioDaemonRuntimeStatus,
    logicalDate: typeof row.logical_date === "string" ? row.logical_date : null,
    activeRunIds,
    lastError: typeof row.last_error === "string" ? row.last_error : null,
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function readRecord(workspaceId: string, daemonId: string): PortfolioDaemonRuntimeRecord | null {
  const row = getDb().prepare("SELECT * FROM production_daemon_runtime WHERE scope_key = ? LIMIT 1")
    .get(scopeKey(workspaceId, daemonId)) as Row | undefined;
  return row ? mapRow(row) : null;
}

export function getPortfolioDaemonRuntime(input: {
  workspaceId: string;
  daemonId?: string;
}): PortfolioDaemonRuntimeRecord | null {
  return readRecord(input.workspaceId, input.daemonId ?? PROJECT_KINGS_PORTFOLIO_DAEMON_ID);
}

export function claimPortfolioDaemonLease(input: {
  workspaceId: string;
  daemonId?: string;
  owner: string;
  leaseMs: number;
  configSha256?: string | null;
  config?: Readonly<Record<string, unknown>> | null;
  now?: string;
}): PortfolioDaemonRuntimeRecord | null {
  return runInTransaction((db) => {
    const workspaceId = requiredText(input.workspaceId, "workspaceId", 64);
    const daemonId = requiredText(input.daemonId ?? PROJECT_KINGS_PORTFOLIO_DAEMON_ID, "daemonId", 160);
    const owner = requiredText(input.owner, "owner", 320);
    const stamp = parseIso(input.now, "now");
    const expiresAt = new Date(Date.parse(stamp) + boundedLeaseMs(input.leaseMs)).toISOString();
    const config = normalizeConfig(input);
    const key = scopeKey(workspaceId, daemonId);
    const existing = db.prepare("SELECT * FROM production_daemon_runtime WHERE scope_key = ? LIMIT 1")
      .get(key) as Row | undefined;
    if (!existing) {
      const leaseToken = newId();
      db.prepare(`INSERT INTO production_daemon_runtime
        (scope_key, workspace_id, daemon_id, config_sha256, config_json, lease_owner, lease_token, lease_expires_at,
         heartbeat_at, status, logical_date, active_run_ids_json, last_error, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', NULL, '[]', NULL, 1, ?, ?)`) 
        .run(
          key,
          workspaceId,
          daemonId,
          config.configSha256,
          config.configJson,
          owner,
          leaseToken,
          expiresAt,
          stamp,
          stamp,
          stamp
        );
      return mapRow(db.prepare("SELECT * FROM production_daemon_runtime WHERE scope_key = ?").get(key) as Row);
    }
    const current = mapRow(existing);
    const leaseActive = Boolean(current.leaseToken && current.leaseExpiresAt && Date.parse(current.leaseExpiresAt) > Date.parse(stamp));
    if (leaseActive) return null;
    const leaseToken = newId();
    const result = db.prepare(`UPDATE production_daemon_runtime SET
      config_sha256 = ?, config_json = ?, lease_owner = ?, lease_token = ?, lease_expires_at = ?, heartbeat_at = ?, status = 'running',
      dispatch_owner = NULL, dispatch_token = NULL, dispatch_expires_at = NULL, dispatch_heartbeat_at = NULL,
      last_error = NULL, version = version + 1, updated_at = ?
      WHERE scope_key = ? AND version = ?`)
      .run(
        config.configSha256,
        config.configJson,
        owner,
        leaseToken,
        expiresAt,
        stamp,
        stamp,
        key,
        current.version
      );
    if (Number(result.changes) !== 1) return null;
    return mapRow(db.prepare("SELECT * FROM production_daemon_runtime WHERE scope_key = ?").get(key) as Row);
  });
}

export function heartbeatPortfolioDaemonLease(input: {
  workspaceId: string;
  daemonId?: string;
  leaseToken: string;
  leaseMs: number;
  configSha256?: string | null;
  status: Exclude<PortfolioDaemonRuntimeStatus, "standby" | "stopped">;
  logicalDate?: string | null;
  activeRunIds?: readonly string[];
  lastError?: string | null;
  now?: string;
}): PortfolioDaemonRuntimeRecord {
  return runInTransaction((db) => {
    const daemonId = input.daemonId ?? PROJECT_KINGS_PORTFOLIO_DAEMON_ID;
    const key = scopeKey(input.workspaceId, daemonId);
    const token = requiredText(input.leaseToken, "leaseToken", 64);
    const stamp = parseIso(input.now, "now");
    const expiresAt = new Date(Date.parse(stamp) + boundedLeaseMs(input.leaseMs)).toISOString();
    const runIds = normalizeRunIds(input.activeRunIds);
    const configSha256 = optionalText(input.configSha256, 64);
    if (configSha256 && !/^[a-f0-9]{64}$/.test(configSha256)) {
      throw new PortfolioDaemonLeaseError("invalid_input", "configSha256 must be a lowercase SHA-256 digest.");
    }
    const logicalDate = input.logicalDate === undefined
      ? undefined
      : input.logicalDate === null
        ? null
        : requiredText(input.logicalDate, "logicalDate", 10);
    const result = db.prepare(`UPDATE production_daemon_runtime SET
      lease_expires_at = ?, heartbeat_at = ?, status = ?,
      logical_date = CASE WHEN ? = 1 THEN ? ELSE logical_date END,
      active_run_ids_json = ?, last_error = ?, version = version + 1, updated_at = ?
      WHERE scope_key = ? AND lease_token = ? AND lease_expires_at > ?
        AND (? IS NULL OR config_sha256 = ?)`)
      .run(
        expiresAt,
        stamp,
        input.status,
        input.logicalDate === undefined ? 0 : 1,
        logicalDate ?? null,
        JSON.stringify(runIds),
        optionalText(input.lastError, 4000),
        stamp,
        key,
        token,
        stamp,
        configSha256,
        configSha256
      );
    if (Number(result.changes) !== 1) {
      throw new PortfolioDaemonLeaseError("lease_lost", "Portfolio daemon singleton lease is missing, expired, or owned by another process.");
    }
    return mapRow(db.prepare("SELECT * FROM production_daemon_runtime WHERE scope_key = ?").get(key) as Row);
  });
}

export function isPortfolioDaemonLeaseActive(input: {
  workspaceId: string;
  daemonId?: string;
  leaseToken: string;
  now?: string;
}): boolean {
  const stamp = parseIso(input.now, "now");
  const row = getDb().prepare(`SELECT 1 AS active FROM production_daemon_runtime
    WHERE scope_key = ? AND lease_token = ? AND lease_expires_at > ? LIMIT 1`)
    .get(
      scopeKey(input.workspaceId, input.daemonId ?? PROJECT_KINGS_PORTFOLIO_DAEMON_ID),
      requiredText(input.leaseToken, "leaseToken", 64),
      stamp
    ) as { active?: number } | undefined;
  return row?.active === 1;
}

export type PortfolioDaemonDispatchLease = Readonly<{
  workspaceId: string;
  daemonId: string;
  daemonLeaseToken: string;
  dispatchOwner: string;
  dispatchToken: string;
  dispatchExpiresAt: string;
  dispatchHeartbeatAt: string;
}>;

function mapDispatchLease(row: Row): PortfolioDaemonDispatchLease {
  return {
    workspaceId: String(row.workspace_id),
    daemonId: String(row.daemon_id),
    daemonLeaseToken: String(row.lease_token),
    dispatchOwner: String(row.dispatch_owner),
    dispatchToken: String(row.dispatch_token),
    dispatchExpiresAt: String(row.dispatch_expires_at),
    dispatchHeartbeatAt: String(row.dispatch_heartbeat_at)
  };
}

export function claimPortfolioDaemonDispatchLease(input: {
  workspaceId: string;
  daemonId?: string;
  daemonLeaseToken: string;
  owner: string;
  leaseMs: number;
  now?: string;
}): PortfolioDaemonDispatchLease | null {
  return runInTransaction((db) => {
    const daemonId = input.daemonId ?? PROJECT_KINGS_PORTFOLIO_DAEMON_ID;
    const key = scopeKey(input.workspaceId, daemonId);
    const daemonLeaseToken = requiredText(input.daemonLeaseToken, "daemonLeaseToken", 64);
    const owner = requiredText(input.owner, "dispatchOwner", 320);
    const stamp = parseIso(input.now, "now");
    const expiresAt = new Date(Date.parse(stamp) + boundedLeaseMs(input.leaseMs)).toISOString();
    const current = db.prepare("SELECT * FROM production_daemon_runtime WHERE scope_key = ? LIMIT 1")
      .get(key) as Row | undefined;
    if (!current || current.lease_token !== daemonLeaseToken ||
        typeof current.lease_expires_at !== "string" || Date.parse(current.lease_expires_at) <= Date.parse(stamp) ||
        current.status !== "running") {
      throw new PortfolioDaemonLeaseError(
        "lease_lost",
        "Portfolio daemon dispatch cannot start without the exact active singleton lease."
      );
    }
    const dispatchActive = Boolean(
      current.dispatch_token &&
      current.dispatch_expires_at &&
      Date.parse(String(current.dispatch_expires_at)) > Date.parse(stamp)
    );
    if (dispatchActive) return null;
    const dispatchToken = newId();
    const result = db.prepare(`UPDATE production_daemon_runtime SET
      dispatch_owner = ?, dispatch_token = ?, dispatch_expires_at = ?, dispatch_heartbeat_at = ?,
      version = version + 1, updated_at = ?
      WHERE scope_key = ? AND lease_token = ? AND lease_expires_at > ? AND status = 'running'
        AND (dispatch_token IS NULL OR dispatch_expires_at IS NULL OR dispatch_expires_at <= ?)`)
      .run(owner, dispatchToken, expiresAt, stamp, stamp, key, daemonLeaseToken, stamp, stamp);
    if (Number(result.changes) !== 1) return null;
    return mapDispatchLease(db.prepare("SELECT * FROM production_daemon_runtime WHERE scope_key = ?").get(key) as Row);
  });
}

export function heartbeatPortfolioDaemonDispatchLease(input: {
  workspaceId: string;
  daemonId?: string;
  daemonLeaseToken: string;
  dispatchToken: string;
  leaseMs: number;
  now?: string;
}): PortfolioDaemonDispatchLease {
  return runInTransaction((db) => {
    const daemonId = input.daemonId ?? PROJECT_KINGS_PORTFOLIO_DAEMON_ID;
    const key = scopeKey(input.workspaceId, daemonId);
    const stamp = parseIso(input.now, "now");
    const expiresAt = new Date(Date.parse(stamp) + boundedLeaseMs(input.leaseMs)).toISOString();
    const result = db.prepare(`UPDATE production_daemon_runtime SET
      dispatch_expires_at = ?, dispatch_heartbeat_at = ?, version = version + 1, updated_at = ?
      WHERE scope_key = ? AND lease_token = ? AND lease_expires_at > ? AND status = 'running'
        AND dispatch_token = ? AND dispatch_expires_at > ?`)
      .run(
        expiresAt,
        stamp,
        stamp,
        key,
        requiredText(input.daemonLeaseToken, "daemonLeaseToken", 64),
        stamp,
        requiredText(input.dispatchToken, "dispatchToken", 64),
        stamp
      );
    if (Number(result.changes) !== 1) {
      throw new PortfolioDaemonLeaseError("lease_lost", "Portfolio daemon dispatch lease was lost.");
    }
    return mapDispatchLease(db.prepare("SELECT * FROM production_daemon_runtime WHERE scope_key = ?").get(key) as Row);
  });
}

export function isPortfolioDaemonDispatchLeaseActive(input: {
  workspaceId: string;
  daemonId?: string;
  daemonLeaseToken: string;
  dispatchToken: string;
  now?: string;
}): boolean {
  const stamp = parseIso(input.now, "now");
  const row = getDb().prepare(`SELECT 1 AS active FROM production_daemon_runtime
    WHERE scope_key = ? AND lease_token = ? AND lease_expires_at > ? AND status = 'running'
      AND dispatch_token = ? AND dispatch_expires_at > ? LIMIT 1`)
    .get(
      scopeKey(input.workspaceId, input.daemonId ?? PROJECT_KINGS_PORTFOLIO_DAEMON_ID),
      requiredText(input.daemonLeaseToken, "daemonLeaseToken", 64),
      stamp,
      requiredText(input.dispatchToken, "dispatchToken", 64),
      stamp
    ) as { active?: number } | undefined;
  return row?.active === 1;
}

export function releasePortfolioDaemonDispatchLease(input: {
  workspaceId: string;
  daemonId?: string;
  daemonLeaseToken: string;
  dispatchToken: string;
  now?: string;
}): boolean {
  return runInTransaction((db) => {
    const stamp = parseIso(input.now, "now");
    const result = db.prepare(`UPDATE production_daemon_runtime SET
      dispatch_owner = NULL, dispatch_token = NULL, dispatch_expires_at = NULL, dispatch_heartbeat_at = NULL,
      version = version + 1, updated_at = ?
      WHERE scope_key = ? AND lease_token = ? AND dispatch_token = ?`)
      .run(
        stamp,
        scopeKey(input.workspaceId, input.daemonId ?? PROJECT_KINGS_PORTFOLIO_DAEMON_ID),
        requiredText(input.daemonLeaseToken, "daemonLeaseToken", 64),
        requiredText(input.dispatchToken, "dispatchToken", 64)
      );
    return Number(result.changes) === 1;
  });
}

export type PortfolioChannelOwnershipStatus = "active" | "releasing" | "released";

export type PortfolioChannelOwnershipRecord = Readonly<{
  workspaceId: string;
  channelId: string;
  daemonId: string;
  configSha256: string;
  profileId: string;
  profileVersion: number;
  profileHash: string;
  status: PortfolioChannelOwnershipStatus;
  fenceToken: string | null;
  activatedAt: string;
  releaseRequestedAt: string | null;
  releasedAt: string | null;
  updatedAt: string;
}>;

function mapChannelOwnership(row: Row): PortfolioChannelOwnershipRecord {
  return {
    workspaceId: String(row.workspace_id),
    channelId: String(row.channel_id),
    daemonId: String(row.daemon_id),
    configSha256: String(row.config_sha256),
    profileId: String(row.profile_id),
    profileVersion: Number(row.profile_version),
    profileHash: String(row.profile_hash),
    status: String(row.status) as PortfolioChannelOwnershipStatus,
    fenceToken: typeof row.fence_token === "string" ? row.fence_token : null,
    activatedAt: String(row.activated_at),
    releaseRequestedAt: typeof row.release_requested_at === "string" ? row.release_requested_at : null,
    releasedAt: typeof row.released_at === "string" ? row.released_at : null,
    updatedAt: String(row.updated_at)
  };
}

function exactSha256(value: string, field: string): string {
  const normalized = requiredText(value, field, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new PortfolioDaemonLeaseError("invalid_input", `${field} must be a lowercase SHA-256 digest.`);
  }
  return normalized;
}

export function getPortfolioChannelOwnership(input: {
  workspaceId: string;
  channelId: string;
}): PortfolioChannelOwnershipRecord | null {
  const row = getDb().prepare(`SELECT * FROM production_channel_ownership
    WHERE workspace_id = ? AND channel_id = ? LIMIT 1`)
    .get(
      requiredText(input.workspaceId, "workspaceId", 64),
      requiredText(input.channelId, "channelId", 64)
    ) as Row | undefined;
  return row ? mapChannelOwnership(row) : null;
}

export function claimPortfolioChannelOwnerships(input: {
  workspaceId: string;
  daemonId?: string;
  daemonLeaseToken: string;
  configSha256: string;
  profiles: readonly {
    id: string;
    channelId: string;
    version: number;
    profileHash: string;
  }[];
  now?: string;
}): PortfolioChannelOwnershipRecord[] {
  return runInTransaction((db) => {
    const workspaceId = requiredText(input.workspaceId, "workspaceId", 64);
    const daemonId = requiredText(input.daemonId ?? PROJECT_KINGS_PORTFOLIO_DAEMON_ID, "daemonId", 160);
    const daemonLeaseToken = requiredText(input.daemonLeaseToken, "daemonLeaseToken", 64);
    const configSha256 = exactSha256(input.configSha256, "configSha256");
    const stamp = parseIso(input.now, "now");
    const daemon = db.prepare(`SELECT lease_token, lease_expires_at, status, config_sha256
      FROM production_daemon_runtime WHERE scope_key = ? LIMIT 1`)
      .get(scopeKey(workspaceId, daemonId)) as Row | undefined;
    if (!daemon || daemon.lease_token !== daemonLeaseToken || daemon.status !== "running" ||
        daemon.config_sha256 !== configSha256 || typeof daemon.lease_expires_at !== "string" ||
        Date.parse(daemon.lease_expires_at) <= Date.parse(stamp)) {
      throw new PortfolioDaemonLeaseError(
        "lease_lost",
        "Pilot-channel ownership requires the exact active daemon/config fence."
      );
    }
    const profiles = input.profiles.map((profile) => ({
      id: requiredText(profile.id, "profileId", 64),
      channelId: requiredText(profile.channelId, "channelId", 64),
      version: profile.version,
      profileHash: exactSha256(profile.profileHash, "profileHash")
    }));
    if (profiles.length === 0 || new Set(profiles.map((profile) => profile.channelId)).size !== profiles.length) {
      throw new PortfolioDaemonLeaseError("invalid_input", "Channel ownership profiles must have unique channels.");
    }
    for (const profile of profiles) {
      if (!Number.isInteger(profile.version) || profile.version < 1) {
        throw new PortfolioDaemonLeaseError("invalid_input", "profileVersion must be a positive integer.");
      }
      const legacyPublication = db.prepare(`SELECT p.id
        FROM channel_publications p
        WHERE p.workspace_id = ? AND p.channel_id = ? AND p.status IN ('queued', 'uploading')
          AND NOT EXISTS (
            SELECT 1 FROM render_exports re
            JOIN production_items pi ON pi.stage3_job_id = re.stage3_job_id
            JOIN production_run_channels prc ON prc.id = pi.run_channel_id
            WHERE re.id = p.render_export_id AND prc.profile_id = ?
          )
        ORDER BY p.created_at ASC LIMIT 1`)
        .get(workspaceId, profile.channelId, profile.id) as { id?: string } | undefined;
      if (legacyPublication?.id) {
        throw new PortfolioDaemonLeaseError(
          "ownership_conflict",
          `Channel ${profile.channelId} still has legacy publication ${legacyPublication.id} queued or uploading.`
        );
      }
      const existing = db.prepare(`SELECT * FROM production_channel_ownership
        WHERE workspace_id = ? AND channel_id = ? LIMIT 1`)
        .get(workspaceId, profile.channelId) as Row | undefined;
      if (existing && existing.status !== "released") {
        const sameOwner = existing.daemon_id === daemonId &&
          existing.config_sha256 === configSha256 &&
          existing.profile_id === profile.id &&
          Number(existing.profile_version) === profile.version &&
          existing.profile_hash === profile.profileHash;
        if (!sameOwner) {
          throw new PortfolioDaemonLeaseError(
            "ownership_conflict",
            `Channel ${profile.channelId} is already owned by another production contour.`
          );
        }
      }
      db.prepare(`INSERT INTO production_channel_ownership
        (workspace_id, channel_id, daemon_id, config_sha256, profile_id, profile_version, profile_hash,
         status, fence_token, activated_at, release_requested_at, released_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL, NULL, ?)
        ON CONFLICT(workspace_id, channel_id) DO UPDATE SET
          daemon_id = excluded.daemon_id,
          config_sha256 = excluded.config_sha256,
          profile_id = excluded.profile_id,
          profile_version = excluded.profile_version,
          profile_hash = excluded.profile_hash,
          status = 'active',
          fence_token = excluded.fence_token,
          activated_at = excluded.activated_at,
          release_requested_at = NULL,
          released_at = NULL,
          updated_at = excluded.updated_at`)
        .run(
          workspaceId,
          profile.channelId,
          daemonId,
          configSha256,
          profile.id,
          profile.version,
          profile.profileHash,
          daemonLeaseToken,
          stamp,
          stamp
        );
    }
    return profiles.map((profile) => mapChannelOwnership(
      db.prepare(`SELECT * FROM production_channel_ownership
        WHERE workspace_id = ? AND channel_id = ?`).get(workspaceId, profile.channelId) as Row
    ));
  });
}

function channelOwnershipCanRelease(db: DatabaseSync, ownership: PortfolioChannelOwnershipRecord): boolean {
  const open = db.prepare(`SELECT 1 AS blocked
    FROM production_run_channels prc
    JOIN production_runs pr ON pr.id = prc.run_id
    WHERE prc.workspace_id = ? AND prc.channel_id = ? AND prc.profile_id = ?
      AND (
        pr.status NOT IN ('completed', 'blocked', 'canceled', 'failed')
        OR EXISTS (
          SELECT 1 FROM production_outbox po
          WHERE po.run_id = pr.id AND po.channel_id = prc.channel_id AND po.status IN ('pending', 'processing')
        )
        OR EXISTS (
          SELECT 1 FROM production_items pi
          JOIN render_exports re ON re.stage3_job_id = pi.stage3_job_id
          JOIN channel_publications cp ON cp.render_export_id = re.id
          WHERE pi.run_channel_id = prc.id AND cp.status = 'uploading'
        )
      )
    LIMIT 1`).get(ownership.workspaceId, ownership.channelId, ownership.profileId) as { blocked?: number } | undefined;
  return open?.blocked !== 1;
}

export function requestPortfolioChannelOwnershipRelease(input: {
  workspaceId: string;
  daemonId?: string;
  daemonLeaseToken: string;
  now?: string;
}): { allReleased: boolean; ownerships: PortfolioChannelOwnershipRecord[] } {
  return runInTransaction((db) => {
    const workspaceId = requiredText(input.workspaceId, "workspaceId", 64);
    const daemonId = requiredText(input.daemonId ?? PROJECT_KINGS_PORTFOLIO_DAEMON_ID, "daemonId", 160);
    const daemonLeaseToken = requiredText(input.daemonLeaseToken, "daemonLeaseToken", 64);
    const stamp = parseIso(input.now, "now");
    const daemon = db.prepare(`SELECT lease_token FROM production_daemon_runtime
      WHERE scope_key = ? AND lease_token = ? LIMIT 1`)
      .get(scopeKey(workspaceId, daemonId), daemonLeaseToken) as Row | undefined;
    if (!daemon) {
      throw new PortfolioDaemonLeaseError("lease_lost", "Only the active daemon fence can release channel ownership.");
    }
    const rows = db.prepare(`SELECT * FROM production_channel_ownership
      WHERE workspace_id = ? AND daemon_id = ? AND status != 'released'
      ORDER BY channel_id ASC`).all(workspaceId, daemonId) as Row[];
    const ownerships: PortfolioChannelOwnershipRecord[] = [];
    for (const row of rows) {
      const current = mapChannelOwnership(row);
      const canRelease = channelOwnershipCanRelease(db, current);
      db.prepare(`UPDATE production_channel_ownership SET
        status = ?, fence_token = CASE WHEN ? THEN NULL ELSE fence_token END,
        release_requested_at = COALESCE(release_requested_at, ?),
        released_at = CASE WHEN ? THEN ? ELSE released_at END,
        updated_at = ?
        WHERE workspace_id = ? AND channel_id = ? AND daemon_id = ?`)
        .run(
          canRelease ? "released" : "releasing",
          canRelease ? 1 : 0,
          stamp,
          canRelease ? 1 : 0,
          stamp,
          stamp,
          workspaceId,
          current.channelId,
          daemonId
        );
      ownerships.push(mapChannelOwnership(
        db.prepare(`SELECT * FROM production_channel_ownership
          WHERE workspace_id = ? AND channel_id = ?`).get(workspaceId, current.channelId) as Row
      ));
    }
    return {
      allReleased: ownerships.every((ownership) => ownership.status === "released"),
      ownerships
    };
  });
}

export function markPortfolioDaemonStopping(input: {
  workspaceId: string;
  daemonId?: string;
  leaseToken: string;
  now?: string;
}): PortfolioDaemonRuntimeRecord {
  return runInTransaction((db) => {
    const key = scopeKey(input.workspaceId, input.daemonId ?? PROJECT_KINGS_PORTFOLIO_DAEMON_ID);
    const stamp = parseIso(input.now, "now");
    const result = db.prepare(`UPDATE production_daemon_runtime SET
      status = 'stopping', dispatch_owner = NULL, dispatch_token = NULL,
      dispatch_expires_at = NULL, dispatch_heartbeat_at = NULL,
      heartbeat_at = ?, version = version + 1, updated_at = ?
      WHERE scope_key = ? AND lease_token = ?`)
      .run(stamp, stamp, key, requiredText(input.leaseToken, "leaseToken", 64));
    if (Number(result.changes) !== 1) {
      throw new PortfolioDaemonLeaseError("lease_lost", "Portfolio daemon cannot enter stopping without its exact lease.");
    }
    return mapRow(db.prepare("SELECT * FROM production_daemon_runtime WHERE scope_key = ?").get(key) as Row);
  });
}

export function releasePortfolioDaemonLease(input: {
  workspaceId: string;
  daemonId?: string;
  leaseToken: string;
  status?: Extract<PortfolioDaemonRuntimeStatus, "stopping" | "stopped">;
  now?: string;
}): PortfolioDaemonRuntimeRecord {
  return runInTransaction((db) => {
    const key = scopeKey(input.workspaceId, input.daemonId ?? PROJECT_KINGS_PORTFOLIO_DAEMON_ID);
    const stamp = parseIso(input.now, "now");
    const result = db.prepare(`UPDATE production_daemon_runtime SET
      lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, heartbeat_at = ?,
      dispatch_owner = NULL, dispatch_token = NULL, dispatch_expires_at = NULL, dispatch_heartbeat_at = NULL,
      status = ?, version = version + 1, updated_at = ?
      WHERE scope_key = ? AND lease_token = ?`)
      .run(stamp, input.status ?? "stopped", stamp, key, requiredText(input.leaseToken, "leaseToken", 64));
    if (Number(result.changes) !== 1) {
      throw new PortfolioDaemonLeaseError("lease_lost", "Portfolio daemon singleton lease cannot be released by this process.");
    }
    return mapRow(db.prepare("SELECT * FROM production_daemon_runtime WHERE scope_key = ?").get(key) as Row);
  });
}
