import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  APP_DB_SCHEMA,
  CHANNEL_PUBLICATIONS_PORTFOLIO_OWNERSHIP_FENCE_TRIGGER_SQL
} from "./schema";
import { getAppDataDir } from "../app-paths";
import {
  DEFAULT_STAGE2_HARD_CONSTRAINTS,
  stringifyStage2HardConstraints
} from "../stage2-channel-config";
import { getBundledStage2ExamplesSeedJson } from "../stage2-examples-seed";
import {
  DEFAULT_STAGE2_CAPTION_PROVIDER_CONFIG,
  stringifyStage2CaptionProviderConfig
} from "../stage2-caption-provider";
import { stringifyStage2PromptConfig, DEFAULT_STAGE2_PROMPT_CONFIG } from "../stage2-pipeline";
import {
  DEFAULT_WORKSPACE_CODEX_MODEL_CONFIG,
  stringifyWorkspaceCodexModelConfig
} from "../workspace-codex-models";
import {
  DEFAULT_STAGE2_STYLE_PROFILE,
  stringifyStage2StyleProfile
} from "../stage2-channel-learning";
import { getDefaultStage3ExecutionTarget } from "../stage3-execution";
import {
  DEFAULT_STAGE3_CLIP_DURATION_SEC,
  MAX_STAGE3_CLIP_DURATION_SEC,
  MIN_STAGE3_CLIP_DURATION_SEC
} from "../stage3-duration";

type GlobalDbScope = typeof globalThis & {
  __clipsAppDb?: DatabaseSync;
};

const DEFAULT_DB_BUSY_TIMEOUT_MS = 15_000;
const MAX_DB_BUSY_TIMEOUT_MS = 60_000;

function resolveDbBusyTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.APP_DB_BUSY_TIMEOUT_MS ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_DB_BUSY_TIMEOUT_MS;
  }
  return Math.min(MAX_DB_BUSY_TIMEOUT_MS, Math.floor(parsed));
}

function hasTable(db: DatabaseSync, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(tableName) as { name?: string } | undefined;
  return Boolean(row?.name);
}

function hasColumn(db: DatabaseSync, tableName: string, columnName: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
  return rows.some((row) => row.name === columnName);
}

function addColumnIfMissing(db: DatabaseSync, tableName: string, columnName: string, definition: string): void {
  if (hasColumn(db, tableName, columnName)) {
    return;
  }
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function migrateProductionCancellationStatuses(db: DatabaseSync): void {
  if (!hasTable(db, "production_runs") || !hasTable(db, "production_run_channels")) return;
  const tableSql = (tableName: string) => String((db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
  ).get(tableName) as { sql?: string | null } | undefined)?.sql ?? "").toLowerCase();
  if (
    tableSql("production_runs").includes("'cancel_requested'") &&
    tableSql("production_run_channels").includes("'cancel_requested'")
  ) {
    return;
  }

  const foreignKeysEnabled = Number((db.prepare("PRAGMA foreign_keys").get() as { foreign_keys?: number } | undefined)
    ?.foreign_keys ?? 0) === 1;
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DROP TABLE IF EXISTS production_run_channels_cancel_v2");
    db.exec("DROP TABLE IF EXISTS production_runs_cancel_v2");
    db.exec(`CREATE TABLE production_runs_cancel_v2 (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      portfolio_profile_hash TEXT NOT NULL,
      logical_date TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('simulation', 'shadow', 'live')),
      status TEXT NOT NULL CHECK (status IN ('created', 'preflight', 'ready', 'running', 'waiting_public', 'cancel_requested', 'completed', 'blocked', 'canceled', 'failed')),
      target_per_channel INTEGER NOT NULL,
      manifest_hash TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      request_idempotency_key TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      lease_owner TEXT,
      lease_token TEXT,
      lease_expires_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE (workspace_id, portfolio_profile_hash, logical_date, mode),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    )`);
    db.exec(`CREATE TABLE production_run_channels_cancel_v2 (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      profile_version INTEGER NOT NULL,
      profile_hash TEXT NOT NULL,
      expected_youtube_channel_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('created', 'preflight', 'ready', 'running', 'waiting_public', 'cancel_requested', 'completed', 'blocked', 'canceled', 'failed')),
      target_count INTEGER NOT NULL,
      public_verified_count INTEGER NOT NULL DEFAULT 0,
      next_slot_at TEXT,
      blocker_code TEXT,
      blocker_message TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE (run_id, channel_id),
      FOREIGN KEY (run_id) REFERENCES production_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (profile_id) REFERENCES production_profiles(id) ON DELETE RESTRICT
    )`);
    db.exec(`INSERT INTO production_runs_cancel_v2
      (id, workspace_id, portfolio_profile_hash, logical_date, mode, status, target_per_channel,
       manifest_hash, manifest_json, request_idempotency_key, version, lease_owner, lease_token,
       lease_expires_at, last_error, created_at, updated_at, completed_at)
      SELECT id, workspace_id, portfolio_profile_hash, logical_date, mode, status, target_per_channel,
       manifest_hash, manifest_json, request_idempotency_key, version, lease_owner, lease_token,
       lease_expires_at, last_error, created_at, updated_at, completed_at
      FROM production_runs`);
    db.exec(`INSERT INTO production_run_channels_cancel_v2
      (id, run_id, workspace_id, channel_id, profile_id, profile_version, profile_hash,
       expected_youtube_channel_id, status, target_count, public_verified_count, next_slot_at,
       blocker_code, blocker_message, version, created_at, updated_at, completed_at)
      SELECT id, run_id, workspace_id, channel_id, profile_id, profile_version, profile_hash,
       expected_youtube_channel_id, status, target_count, public_verified_count, next_slot_at,
       blocker_code, blocker_message, version, created_at, updated_at, completed_at
      FROM production_run_channels`);
    // SQLite validates trigger dependencies while rebuilding referenced tables.
    // Keep the ownership fence transactionally absent only for the rebuild itself,
    // then restore the exact canonical definition before commit.
    db.exec("DROP TRIGGER IF EXISTS channel_publications_portfolio_ownership_fence");
    db.exec("DROP TABLE production_run_channels");
    db.exec("DROP TABLE production_runs");
    db.exec("ALTER TABLE production_runs_cancel_v2 RENAME TO production_runs");
    db.exec("ALTER TABLE production_run_channels_cancel_v2 RENAME TO production_run_channels");
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_production_runs_request_idempotency
      ON production_runs(workspace_id, request_idempotency_key)
      WHERE request_idempotency_key IS NOT NULL`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_production_runs_status_updated
      ON production_runs(workspace_id, status, updated_at ASC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_production_run_channels_run
      ON production_run_channels(run_id, channel_id)`);
    db.exec(CHANNEL_PUBLICATIONS_PORTFOLIO_OWNERSHIP_FENCE_TRIGGER_SQL);
    const foreignKeyIssues = db.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyIssues.length > 0) {
      throw new Error(`Production cancellation status migration failed foreign_key_check: ${JSON.stringify(foreignKeyIssues)}`);
    }
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Preserve the original migration failure.
    }
    throw error;
  } finally {
    db.exec(`PRAGMA foreign_keys = ${foreignKeysEnabled ? "ON" : "OFF"}`);
  }
}

function migrateProductionOutboxDedupeKey(db: DatabaseSync): void {
  if (!hasTable(db, "production_outbox")) {
    return;
  }
  const table = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'production_outbox' LIMIT 1"
  ).get() as { sql?: string | null } | undefined;
  const normalizedSql = String(table?.sql ?? "")
    .toLowerCase()
    .replaceAll(/\s+/g, " ");
  const hasLegacyEventKindConstraint =
    normalizedSql.includes("unique (production_item_id, event_kind)") ||
    normalizedSql.includes("unique(production_item_id, event_kind)");
  const needsRebuild = !hasColumn(db, "production_outbox", "dedupe_key") || hasLegacyEventKindConstraint;

  if (needsRebuild) {
    const legacyHasDedupeKey = hasColumn(db, "production_outbox", "dedupe_key");
    const legacyHasDeadLetterCode = hasColumn(db, "production_outbox", "dead_letter_code");
    const legacyHasProjectedAt = hasColumn(db, "production_outbox", "projected_at");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("DROP TABLE IF EXISTS production_outbox_v2");
      db.exec(`CREATE TABLE production_outbox_v2 (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        production_item_id TEXT NOT NULL,
        event_kind TEXT NOT NULL,
        dedupe_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'delivered', 'dead')),
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        available_at TEXT NOT NULL,
        lease_owner TEXT,
        lease_token TEXT,
        lease_expires_at TEXT,
        last_error TEXT,
        dead_letter_code TEXT,
        projected_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        delivered_at TEXT,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (run_id) REFERENCES production_runs(id) ON DELETE CASCADE,
        FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
        FOREIGN KEY (production_item_id) REFERENCES production_items(id) ON DELETE CASCADE
      )`);
      db.exec(`INSERT INTO production_outbox_v2
        (id, workspace_id, run_id, channel_id, production_item_id, event_kind, dedupe_key,
         payload_json, status, attempts, max_attempts, available_at, lease_owner, lease_token,
         lease_expires_at, last_error, dead_letter_code, projected_at, created_at, updated_at, delivered_at)
        SELECT id, workspace_id, run_id, channel_id, production_item_id, event_kind,
          ${legacyHasDedupeKey
            ? "COALESCE(NULLIF(dedupe_key, ''), event_kind || ':legacy:' || id)"
            : "event_kind || ':legacy:' || id"},
          payload_json, status, attempts, max_attempts, available_at, lease_owner, lease_token,
          lease_expires_at, last_error,
          ${legacyHasDeadLetterCode ? "dead_letter_code" : "NULL"},
          ${legacyHasProjectedAt ? "projected_at" : "NULL"},
          created_at, updated_at, delivered_at
        FROM production_outbox`);
      db.exec("DROP TABLE production_outbox");
      db.exec("ALTER TABLE production_outbox_v2 RENAME TO production_outbox");
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Preserve the original migration failure.
      }
      throw error;
    }
  } else {
    addColumnIfMissing(db, "production_outbox", "dead_letter_code", "TEXT");
    addColumnIfMissing(db, "production_outbox", "projected_at", "TEXT");
  }

  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_production_outbox_item_dedupe ON production_outbox(production_item_id, dedupe_key)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_production_outbox_claim ON production_outbox(status, available_at ASC, created_at ASC)"
  );
  db.exec(`CREATE TRIGGER IF NOT EXISTS production_outbox_intent_immutable
    BEFORE UPDATE OF workspace_id, run_id, channel_id, production_item_id, event_kind, dedupe_key, payload_json
    ON production_outbox
    BEGIN
      SELECT RAISE(ABORT, 'production outbox intent is immutable');
    END`);
}

function migrateQualityVerdictEvidenceBindings(db: DatabaseSync): void {
  if (!hasTable(db, "quality_verdicts")) {
    return;
  }
  const table = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'quality_verdicts' LIMIT 1"
  ).get() as { sql?: string | null } | undefined;
  const normalizedSql = String(table?.sql ?? "")
    .toLowerCase()
    .replaceAll(/\s+/g, " ");
  const current =
    normalizedSql.includes("'semantic'") &&
    !normalizedSql.includes("'combined'") &&
    hasColumn(db, "quality_verdicts", "evidence_sha256") &&
    hasColumn(db, "quality_verdicts", "evidence_artifact_path");
  if (current) {
    return;
  }

  const legacyHasEvidenceSha256 = hasColumn(db, "quality_verdicts", "evidence_sha256");
  const legacyHasEvidencePath = hasColumn(db, "quality_verdicts", "evidence_artifact_path");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DROP INDEX IF EXISTS idx_quality_verdicts_item_gate_hash");
    db.exec("DROP TABLE IF EXISTS quality_verdicts_v2");
    db.exec(`CREATE TABLE quality_verdicts_v2 (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      production_item_id TEXT NOT NULL,
      gate_type TEXT NOT NULL CHECK (gate_type IN ('source', 'preview', 'final')),
      judge_kind TEXT NOT NULL CHECK (judge_kind IN ('deterministic', 'semantic', 'vision')),
      verdict TEXT NOT NULL CHECK (verdict IN ('pass', 'fail')),
      attempt_no INTEGER NOT NULL,
      artifact_sha256 TEXT NOT NULL,
      source_sha256 TEXT,
      preview_sha256 TEXT,
      template_sha256 TEXT,
      settings_sha256 TEXT,
      agent_attempt_id TEXT,
      evidence_sha256 TEXT,
      evidence_artifact_path TEXT,
      defects_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (production_item_id, gate_type, judge_kind, artifact_sha256, attempt_no),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (run_id) REFERENCES production_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (production_item_id) REFERENCES production_items(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_attempt_id) REFERENCES agent_attempts(id) ON DELETE SET NULL
    )`);
    db.exec(`INSERT INTO quality_verdicts_v2
      (id, workspace_id, run_id, production_item_id, gate_type, judge_kind, verdict, attempt_no,
       artifact_sha256, source_sha256, preview_sha256, template_sha256, settings_sha256,
       agent_attempt_id, evidence_sha256, evidence_artifact_path, defects_json, created_at)
      SELECT id, workspace_id, run_id, production_item_id, gate_type, judge_kind, verdict, attempt_no,
       artifact_sha256, source_sha256, preview_sha256, template_sha256, settings_sha256,
       agent_attempt_id,
       ${legacyHasEvidenceSha256 ? "evidence_sha256" : "NULL"},
       ${legacyHasEvidencePath ? "evidence_artifact_path" : "NULL"},
       defects_json, created_at
      FROM quality_verdicts
      WHERE judge_kind IN ('deterministic', 'vision')`);
    db.exec("DROP TABLE quality_verdicts");
    db.exec("ALTER TABLE quality_verdicts_v2 RENAME TO quality_verdicts");
    db.exec(`CREATE INDEX idx_quality_verdicts_item_gate_hash
      ON quality_verdicts(production_item_id, gate_type, artifact_sha256, created_at DESC)`);
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Preserve the original migration failure.
    }
    throw error;
  }
}

function migrateLegacyStage3WorkerTokens(db: DatabaseSync): void {
  if (!hasTable(db, "stage3_worker_tokens")) {
    return;
  }

  const hasScopes = hasColumn(db, "stage3_worker_tokens", "scopes");
  const hasLastSeenAt = hasColumn(db, "stage3_worker_tokens", "last_seen_at");
  const hasRevoked = hasColumn(db, "stage3_worker_tokens", "revoked");
  const hasTokenKind = hasColumn(db, "stage3_worker_tokens", "token_kind");
  const hasConsumedAt = hasColumn(db, "stage3_worker_tokens", "consumed_at");
  const hasRevokedAt = hasColumn(db, "stage3_worker_tokens", "revoked_at");
  const hasUpdatedAt = hasColumn(db, "stage3_worker_tokens", "updated_at");

  if (hasScopes || hasLastSeenAt || hasRevoked) {
    db.exec("DROP INDEX IF EXISTS idx_stage3_worker_tokens_worker");
    db.exec(
      `CREATE TABLE IF NOT EXISTS stage3_worker_tokens_v2 (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        worker_id TEXT,
        token_hash TEXT NOT NULL UNIQUE,
        token_kind TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (worker_id) REFERENCES stage3_workers(id) ON DELETE CASCADE
      )`
    );

    const legacyKindExpr = hasScopes
      ? "CASE WHEN lower(scopes) LIKE '%pair%' THEN 'pairing' ELSE 'session' END"
      : "'session'";
    const legacyUpdatedAtExpr = hasUpdatedAt
      ? (hasLastSeenAt
          ? "COALESCE(updated_at, last_seen_at, created_at, expires_at)"
          : "COALESCE(updated_at, created_at, expires_at)")
      : (hasLastSeenAt ? "COALESCE(last_seen_at, created_at, expires_at)" : "COALESCE(created_at, expires_at)");
    const revokedAtExpr = hasRevoked
      ? `CASE WHEN revoked = 1 THEN ${legacyUpdatedAtExpr} END`
      : "revoked_at";

    db.exec(
      `INSERT INTO stage3_worker_tokens_v2
        (id, workspace_id, user_id, worker_id, token_hash, token_kind, expires_at, consumed_at, revoked_at, created_at, updated_at)
        SELECT
          legacy.id,
          legacy.workspace_id,
          legacy.user_id,
          CASE
            WHEN legacy.worker_id IS NULL OR legacy.worker_id = '' THEN NULL
            WHEN EXISTS (SELECT 1 FROM stage3_workers workers WHERE workers.id = legacy.worker_id) THEN legacy.worker_id
            ELSE NULL
          END,
          legacy.token_hash,
          ${hasTokenKind ? `COALESCE(NULLIF(token_kind, ''), ${legacyKindExpr})` : legacyKindExpr},
          legacy.expires_at,
          ${hasConsumedAt ? "consumed_at" : "NULL"},
          ${hasRevokedAt ? `COALESCE(revoked_at, ${revokedAtExpr})` : revokedAtExpr},
          legacy.created_at,
          ${legacyUpdatedAtExpr}
        FROM stage3_worker_tokens legacy
       WHERE EXISTS (SELECT 1 FROM workspaces workspace WHERE workspace.id = legacy.workspace_id)
         AND EXISTS (SELECT 1 FROM users usr WHERE usr.id = legacy.user_id)`
    );

    db.exec("DROP TABLE stage3_worker_tokens");
    db.exec("ALTER TABLE stage3_worker_tokens_v2 RENAME TO stage3_worker_tokens");
  } else {
    if (!hasTokenKind) {
      addColumnIfMissing(db, "stage3_worker_tokens", "token_kind", "TEXT");
    }
    if (!hasConsumedAt) {
      addColumnIfMissing(db, "stage3_worker_tokens", "consumed_at", "TEXT");
    }
    if (!hasRevokedAt) {
      addColumnIfMissing(db, "stage3_worker_tokens", "revoked_at", "TEXT");
    }
    if (!hasUpdatedAt) {
      addColumnIfMissing(db, "stage3_worker_tokens", "updated_at", "TEXT");
    }

    db.exec(
      `UPDATE stage3_worker_tokens
          SET token_kind = COALESCE(NULLIF(token_kind, ''), 'session')
        WHERE token_kind IS NULL OR token_kind = ''`
    );
    db.exec(
      `UPDATE stage3_worker_tokens
          SET updated_at = COALESCE(updated_at, created_at, expires_at)
        WHERE updated_at IS NULL OR updated_at = ''`
    );
  }

  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_stage3_worker_tokens_worker ON stage3_worker_tokens(worker_id, token_kind, expires_at DESC)"
  );
}

function applyDbMigrations(db: DatabaseSync): void {
  migrateProductionCancellationStatuses(db);
  migrateProductionOutboxDedupeKey(db);
  addColumnIfMissing(db, "production_daemon_runtime", "config_sha256", "TEXT");
  addColumnIfMissing(db, "production_daemon_runtime", "config_json", "TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing(db, "production_daemon_runtime", "dispatch_owner", "TEXT");
  addColumnIfMissing(db, "production_daemon_runtime", "dispatch_token", "TEXT");
  addColumnIfMissing(db, "production_daemon_runtime", "dispatch_expires_at", "TEXT");
  addColumnIfMissing(db, "production_daemon_runtime", "dispatch_heartbeat_at", "TEXT");
  addColumnIfMissing(db, "workspaces", "default_template_id", "TEXT");
  addColumnIfMissing(db, "workspaces", "stage2_examples_corpus_json", "TEXT");
  addColumnIfMissing(db, "workspaces", "stage2_hard_constraints_json", "TEXT");
  addColumnIfMissing(db, "workspaces", "stage2_prompt_config_json", "TEXT");
  addColumnIfMissing(db, "workspaces", "workspace_codex_model_config_json", "TEXT");
  addColumnIfMissing(db, "workspaces", "stage2_caption_provider_json", "TEXT");
  addColumnIfMissing(db, "workspaces", "stage3_execution_target", "TEXT");
  addColumnIfMissing(db, "channels", "stage2_worker_profile_id", "TEXT");
  addColumnIfMissing(db, "channels", "stage2_examples_config_json", "TEXT");
  addColumnIfMissing(db, "channels", "stage2_hard_constraints_json", "TEXT");
  addColumnIfMissing(db, "channels", "stage2_prompt_config_json", "TEXT");
  addColumnIfMissing(db, "channels", "stage2_style_profile_json", "TEXT");
  addColumnIfMissing(db, "channels", "stage2_source_overlay_config_json", "TEXT");
  addColumnIfMissing(
    db,
    "channels",
    "default_clip_duration_sec",
    `INTEGER NOT NULL DEFAULT ${DEFAULT_STAGE3_CLIP_DURATION_SEC}`
  );
  addColumnIfMissing(db, "stage2_runs", "creator_user_id", "TEXT");
  addColumnIfMissing(db, "stage2_runs", "channel_id", "TEXT");
  addColumnIfMissing(db, "stage2_runs", "source_url", "TEXT");
  addColumnIfMissing(db, "stage2_runs", "user_instruction", "TEXT");
  addColumnIfMissing(db, "stage2_runs", "mode", "TEXT");
  addColumnIfMissing(db, "stage2_runs", "request_json", "TEXT");
  addColumnIfMissing(db, "stage2_runs", "result_json", "TEXT");
  addColumnIfMissing(db, "stage2_runs", "error_message", "TEXT");
  addColumnIfMissing(db, "stage2_runs", "started_at", "TEXT");
  addColumnIfMissing(db, "source_jobs", "creator_user_id", "TEXT");
  addColumnIfMissing(db, "source_jobs", "channel_id", "TEXT");
  addColumnIfMissing(db, "source_jobs", "chat_id", "TEXT");
  addColumnIfMissing(db, "source_jobs", "source_url", "TEXT");
  addColumnIfMissing(db, "source_jobs", "request_json", "TEXT");
  addColumnIfMissing(db, "source_jobs", "result_json", "TEXT");
  addColumnIfMissing(db, "source_jobs", "error_message", "TEXT");
  addColumnIfMissing(db, "source_jobs", "started_at", "TEXT");
  addColumnIfMissing(db, "channel_style_discovery_runs", "creator_user_id", "TEXT");
  addColumnIfMissing(db, "channel_style_discovery_runs", "request_json", "TEXT");
  addColumnIfMissing(db, "channel_style_discovery_runs", "request_fingerprint", "TEXT");
  addColumnIfMissing(db, "channel_style_discovery_runs", "result_json", "TEXT");
  addColumnIfMissing(db, "channel_style_discovery_runs", "error_message", "TEXT");
  addColumnIfMissing(db, "channel_style_discovery_runs", "started_at", "TEXT");
  addColumnIfMissing(db, "audit_log", "channel_id", "TEXT");
  addColumnIfMissing(db, "audit_log", "chat_id", "TEXT");
  addColumnIfMissing(db, "audit_log", "correlation_id", "TEXT");
  addColumnIfMissing(db, "audit_log", "stage", "TEXT");
  addColumnIfMissing(db, "audit_log", "status", "TEXT");
  addColumnIfMissing(db, "audit_log", "severity", "TEXT NOT NULL DEFAULT 'info'");
  addColumnIfMissing(db, "stage3_jobs", "execution_target", "TEXT NOT NULL DEFAULT 'local'");
  addColumnIfMissing(db, "stage3_jobs", "assigned_worker_id", "TEXT");
  addColumnIfMissing(db, "stage3_jobs", "lease_expires_at", "TEXT");
  addColumnIfMissing(db, "stage3_jobs", "heartbeat_at", "TEXT");
  addColumnIfMissing(db, "stage3_jobs", "attempt_limit", "INTEGER NOT NULL DEFAULT 3");
  addColumnIfMissing(db, "stage3_jobs", "attempt_group", "TEXT");
  addColumnIfMissing(db, "agent_attempts", "cached_input_tokens", "INTEGER");
  addColumnIfMissing(db, "agent_attempts", "reasoning_output_tokens", "INTEGER");
  addColumnIfMissing(db, "agent_attempts", "cost_unit", "TEXT");
  addColumnIfMissing(db, "agent_attempts", "stage3_job_id", "TEXT REFERENCES stage3_jobs(id) ON DELETE SET NULL");
  addColumnIfMissing(db, "production_profiles", "model_route_manifest_sha256", "TEXT NOT NULL DEFAULT ''");
  // Old profiles may contain approved_at/approved_by_user_id written by the
  // former implicit seeding path. They intentionally remain unapproved until
  // an explicit owner action writes a hash-bound scope and binding.
  addColumnIfMissing(db, "production_profiles", "approval_scope", "TEXT");
  addColumnIfMissing(db, "production_profiles", "approval_binding_sha256", "TEXT");
  addColumnIfMissing(db, "agent_attempts", "quality_binding_sha256", "TEXT");
  migrateQualityVerdictEvidenceBindings(db);
  addColumnIfMissing(
    db,
    "channel_source_candidates",
    "qualification_status",
    "TEXT NOT NULL DEFAULT 'pending' CHECK (qualification_status IN ('discovered', 'pending', 'qualified', 'rejected', 'quarantined'))"
  );
  addColumnIfMissing(db, "channel_source_candidates", "qualification_evidence_sha256", "TEXT");
  addColumnIfMissing(
    db,
    "channel_publish_settings",
    "notify_subscribers_default",
    "INTEGER NOT NULL DEFAULT 0"
  );
  addColumnIfMissing(db, "channel_publish_integrations", "oauth_client_key", "TEXT");
  addColumnIfMissing(db, "channel_youtube_oauth_states", "oauth_client_key", "TEXT");
  addColumnIfMissing(
    db,
    "channel_publications",
    "notify_subscribers",
    "INTEGER NOT NULL DEFAULT 1"
  );
  addColumnIfMissing(
    db,
    "channel_publications",
    "schedule_mode",
    "TEXT NOT NULL DEFAULT 'slot'"
  );
  addColumnIfMissing(db, "channel_publications", "upload_session_url", "TEXT");
  addColumnIfMissing(db, "channel_publications", "remote_deleted_at", "TEXT");
  addColumnIfMissing(
    db,
    "channel_editorial_feedback_events",
    "scope",
    "TEXT NOT NULL DEFAULT 'option'"
  );
  addColumnIfMissing(
    db,
    "channel_editorial_feedback_events",
    "note_mode",
    "TEXT NOT NULL DEFAULT 'soft_preference'"
  );
  db.prepare(
    `UPDATE workspaces
        SET stage2_examples_corpus_json = ?
      WHERE stage2_examples_corpus_json IS NULL
         OR trim(stage2_examples_corpus_json) = ''`
  ).run(getBundledStage2ExamplesSeedJson());
  db.prepare(
    `UPDATE workspaces
        SET stage2_hard_constraints_json = ?
      WHERE stage2_hard_constraints_json IS NULL
         OR trim(stage2_hard_constraints_json) = ''`
  ).run(stringifyStage2HardConstraints(DEFAULT_STAGE2_HARD_CONSTRAINTS));
  db.prepare(
    `UPDATE workspaces
        SET stage2_prompt_config_json = ?
      WHERE stage2_prompt_config_json IS NULL
         OR trim(stage2_prompt_config_json) = ''`
  ).run(stringifyStage2PromptConfig(DEFAULT_STAGE2_PROMPT_CONFIG));
  db.prepare(
    `UPDATE workspaces
        SET workspace_codex_model_config_json = ?
      WHERE workspace_codex_model_config_json IS NULL
         OR trim(workspace_codex_model_config_json) = ''`
  ).run(stringifyWorkspaceCodexModelConfig(DEFAULT_WORKSPACE_CODEX_MODEL_CONFIG));
  db.prepare(
    `UPDATE workspaces
        SET stage2_caption_provider_json = ?
      WHERE stage2_caption_provider_json IS NULL
         OR trim(stage2_caption_provider_json) = ''`
  ).run(stringifyStage2CaptionProviderConfig(DEFAULT_STAGE2_CAPTION_PROVIDER_CONFIG));
  db.prepare(
    `UPDATE workspaces
        SET stage3_execution_target = ?
      WHERE stage3_execution_target IS NULL
         OR trim(stage3_execution_target) = ''`
  ).run(getDefaultStage3ExecutionTarget());
  db.prepare(
    `UPDATE channels
        SET stage2_style_profile_json = ?
      WHERE stage2_style_profile_json IS NULL
         OR trim(stage2_style_profile_json) = ''`
  ).run(stringifyStage2StyleProfile(DEFAULT_STAGE2_STYLE_PROFILE));
  db.prepare(
    `UPDATE channels
        SET default_clip_duration_sec = ?
      WHERE default_clip_duration_sec IS NULL
         OR default_clip_duration_sec < ?
         OR default_clip_duration_sec > ?`
  ).run(
    DEFAULT_STAGE3_CLIP_DURATION_SEC,
    MIN_STAGE3_CLIP_DURATION_SEC,
    MAX_STAGE3_CLIP_DURATION_SEC
  );
  if (hasTable(db, "channel_publish_settings") && hasColumn(db, "channel_publish_settings", "notify_subscribers_default")) {
    db.exec(
      `UPDATE channel_publish_settings
          SET notify_subscribers_default = 0
        WHERE notify_subscribers_default IS NULL
           OR notify_subscribers_default <> 0`
    );
  }
  migrateLegacyStage3WorkerTokens(db);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_channel_source_candidates_qualified_buffer ON channel_source_candidates(workspace_id, channel_id, status, qualification_status, created_at ASC)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_stage2_runs_workspace_updated ON stage2_runs(workspace_id, updated_at DESC)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_stage2_runs_chat_created ON stage2_runs(chat_id, created_at DESC)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_stage2_runs_status_created ON stage2_runs(status, created_at ASC)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_source_jobs_workspace_updated ON source_jobs(workspace_id, updated_at DESC)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_source_jobs_chat_created ON source_jobs(chat_id, created_at DESC)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_source_jobs_status_created ON source_jobs(status, created_at ASC)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_channel_editorial_feedback_channel ON channel_editorial_feedback_events(channel_id, created_at DESC)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_channel_editorial_feedback_workspace ON channel_editorial_feedback_events(workspace_id, created_at DESC)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_channel_style_discovery_runs_workspace_updated ON channel_style_discovery_runs(workspace_id, updated_at DESC)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_channel_style_discovery_runs_status_created ON channel_style_discovery_runs(status, created_at ASC)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_channel_style_discovery_runs_creator_fingerprint ON channel_style_discovery_runs(workspace_id, creator_user_id, request_fingerprint, created_at DESC)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_audit_log_workspace_created ON audit_log(workspace_id, created_at DESC)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_audit_log_chat_created ON audit_log(chat_id, created_at DESC)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_audit_log_channel_created ON audit_log(channel_id, created_at DESC)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_audit_log_stage_status ON audit_log(workspace_id, stage, status, created_at DESC)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_mcp_access_tokens_workspace ON mcp_access_tokens(workspace_id, created_at DESC)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_mcp_access_tokens_owner ON mcp_access_tokens(owner_user_id, created_at DESC)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_mcp_machine_credentials_workspace ON mcp_machine_credentials(workspace_id, status, updated_at DESC)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_mcp_machine_credentials_owner ON mcp_machine_credentials(owner_user_id, updated_at DESC)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_mcp_machine_credentials_machine ON mcp_machine_credentials(workspace_id, machine_id)"
  );
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_machine_credentials_active_machine ON mcp_machine_credentials(workspace_id, machine_id) WHERE status != 'revoked'"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_workspace_templates_workspace_updated ON workspace_templates(workspace_id, archived_at, updated_at DESC)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_workspace_templates_workspace_created ON workspace_templates(workspace_id, archived_at, created_at ASC)"
  );
  db.exec("DROP INDEX IF EXISTS idx_stage3_jobs_kind_dedupe");
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_stage3_jobs_kind_target_dedupe ON stage3_jobs(kind, execution_target, dedupe_key) WHERE dedupe_key IS NOT NULL"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_stage3_jobs_execution ON stage3_jobs(execution_target, status, created_at ASC)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_stage3_jobs_worker ON stage3_jobs(assigned_worker_id, status, updated_at DESC)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_agent_attempts_stage3_job ON agent_attempts(stage3_job_id)"
  );
}

function ensureDataDir(): void {
  const dataDir = getAppDataDir();
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

function getDbPath(): string {
  return path.join(getAppDataDir(), "app.db");
}

function createDb(): DatabaseSync {
  ensureDataDir();
  const busyTimeoutMs = resolveDbBusyTimeoutMs();
  const db = new DatabaseSync(getDbPath());
  db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
  db.exec(APP_DB_SCHEMA);
  applyDbMigrations(db);
  return db;
}

export function getDbFilePath(): string {
  return getDbPath();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return randomUUID().replace(/-/g, "");
}

export function runInTransaction<T>(fn: (db: DatabaseSync) => T): T {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn(db);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getDb(): DatabaseSync {
  const scope = globalThis as GlobalDbScope;
  if (!scope.__clipsAppDb) {
    scope.__clipsAppDb = createDb();
  }
  return scope.__clipsAppDb;
}
