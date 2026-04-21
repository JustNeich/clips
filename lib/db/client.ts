import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { APP_DB_SCHEMA } from "./schema";
import { getAppDataDir } from "../app-paths";
import {
  DEFAULT_STAGE2_HARD_CONSTRAINTS,
  getBundledStage2ExamplesSeedJson,
  stringifyStage2HardConstraints
} from "../stage2-channel-config";
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

type GlobalDbScope = typeof globalThis & {
  __clipsAppDb?: DatabaseSync;
};

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
  addColumnIfMissing(db, "stage3_jobs", "execution_target", "TEXT NOT NULL DEFAULT 'local'");
  addColumnIfMissing(db, "stage3_jobs", "assigned_worker_id", "TEXT");
  addColumnIfMissing(db, "stage3_jobs", "lease_expires_at", "TEXT");
  addColumnIfMissing(db, "stage3_jobs", "heartbeat_at", "TEXT");
  addColumnIfMissing(db, "stage3_jobs", "attempt_limit", "INTEGER NOT NULL DEFAULT 3");
  addColumnIfMissing(db, "stage3_jobs", "attempt_group", "TEXT");
  addColumnIfMissing(
    db,
    "channel_publish_settings",
    "notify_subscribers_default",
    "INTEGER NOT NULL DEFAULT 0"
  );
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
  const db = new DatabaseSync(getDbPath());
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
