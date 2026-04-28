import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getAppDataDir } from "./app-paths";
import { getDb, newId, nowIso, runInTransaction } from "./db/client";
import { hashPassword, verifyPassword } from "./auth/password";
import {
  DEFAULT_STAGE2_HARD_CONSTRAINTS,
  getBundledStage2ExamplesSeedJson,
  parseStage2ExamplesJson,
  parseStage2HardConstraintsJson,
  stringifyStage2HardConstraints,
  type Stage2HardConstraints
} from "./stage2-channel-config";
import {
  DEFAULT_STAGE2_CAPTION_PROVIDER_CONFIG,
  normalizeStage2CaptionProviderConfig,
  parseStage2CaptionProviderConfigJson,
  stringifyStage2CaptionProviderConfig,
  type Stage2CaptionProviderConfig,
  type WorkspaceAnthropicIntegrationStatus,
  type WorkspaceOpenRouterIntegrationStatus
} from "./stage2-caption-provider";
import {
  DEFAULT_STAGE2_PROMPT_CONFIG,
  parseStage2PromptConfigJson,
  prepareStage2PromptConfigForExplicitSave,
  resetIncompatibleNativeStage2PromptOverrides,
  stringifyStage2PromptConfig,
  type Stage2PromptConfig,
  type Stage2PromptConfigStageId
} from "./stage2-pipeline";
import {
  DEFAULT_WORKSPACE_CODEX_MODEL_CONFIG,
  parseWorkspaceCodexModelConfigJson,
  stringifyWorkspaceCodexModelConfig,
  type WorkspaceCodexModelConfig
} from "./workspace-codex-models";
import {
  getDefaultStage3ExecutionTarget,
  normalizeStage3ExecutionTarget
} from "./stage3-execution";
import { ensureWorkspaceTemplateLibrary } from "./managed-template-store";
import { decryptJsonPayload, encryptJsonPayload } from "./app-crypto";
import type { Stage3ExecutionTarget } from "../app/components/types";

export type AppRole = "owner" | "manager" | "redactor" | "redactor_limited";
export type WorkspaceCodexStatus = "connected" | "disconnected" | "connecting" | "error";
export type ChannelAccessRole = "operate";

export type WorkspaceRecord = {
  id: string;
  name: string;
  slug: string;
  defaultTemplateId: string | null;
  stage2ExamplesCorpusJson: string;
  stage2HardConstraints: Stage2HardConstraints;
  stage2PromptConfig: Stage2PromptConfig;
  codexModelConfig: WorkspaceCodexModelConfig;
  stage2CaptionProviderConfig: Stage2CaptionProviderConfig;
  stage3ExecutionTarget: Stage3ExecutionTarget;
  createdAt: string;
  updatedAt: string;
};

export type UserRecord = {
  id: string;
  email: string;
  displayName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceMemberRecord = {
  id: string;
  workspaceId: string;
  userId: string;
  role: AppRole;
  createdAt: string;
  updatedAt: string;
};

export type AuthSessionRecord = {
  id: string;
  workspaceId: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  ipAddress: string | null;
};

export type WorkspaceCodexIntegrationRecord = {
  id: string;
  workspaceId: string;
  provider: "codex";
  status: WorkspaceCodexStatus;
  ownerUserId: string;
  codexSessionId: string | null;
  codexHomePath: string | null;
  loginStatusText: string | null;
  deviceAuthStatus: string | null;
  deviceAuthOutput: string | null;
  deviceAuthLoginUrl: string | null;
  deviceAuthUserCode: string | null;
  connectedAt: string | null;
  updatedAt: string;
};

export type WorkspaceAnthropicIntegrationRecord = {
  id: string;
  workspaceId: string;
  provider: "anthropic";
  status: WorkspaceAnthropicIntegrationStatus;
  ownerUserId: string;
  apiKeyHint: string | null;
  lastError: string | null;
  connectedAt: string | null;
  updatedAt: string;
};

export type WorkspaceOpenRouterIntegrationRecord = {
  id: string;
  workspaceId: string;
  provider: "openrouter";
  status: WorkspaceOpenRouterIntegrationStatus;
  ownerUserId: string;
  apiKeyHint: string | null;
  lastError: string | null;
  connectedAt: string | null;
  updatedAt: string;
};

export type ChannelAccessRecord = {
  id: string;
  channelId: string;
  userId: string;
  accessRole: ChannelAccessRole;
  grantedByUserId: string;
  createdAt: string;
  revokedAt: string | null;
};

type LegacyChannel = {
  id: string;
  name: string;
  username: string;
  systemPrompt: string;
  descriptionPrompt: string;
  examplesJson: string;
  templateId: string;
  avatarAssetId: string | null;
  defaultBackgroundAssetId: string | null;
  defaultMusicAssetId: string | null;
  createdAt: string;
  updatedAt: string;
};

type LegacyChannelAsset = {
  id: string;
  channelId: string;
  kind: "avatar" | "background" | "music";
  fileName: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

type LegacyChatEvent = {
  id: string;
  role: "user" | "assistant" | "system";
  type: "link" | "download" | "comments" | "stage2" | "error" | "note";
  text: string;
  data?: unknown;
  createdAt: string;
};

type LegacyChatThread = {
  id: string;
  channelId: string;
  url: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  events: LegacyChatEvent[];
};

export type EffectivePermissions = {
  canManageMembers: boolean;
  canManageCodex: boolean;
  canCreateChannel: boolean;
  canManageAnyChannelAccess: boolean;
};

export type AuthContext = {
  workspace: WorkspaceRecord;
  user: UserRecord;
  membership: WorkspaceMemberRecord;
  session: AuthSessionRecord;
};

type LegacyStore = {
  version?: number;
  channels?: unknown[];
  channelAssets?: unknown[];
  threads?: unknown[];
};

const STORE_PATH = path.join(getAppDataDir(), "chat-history.json");
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const DEFAULT_TEMPLATE_ID = "science-card-v1";

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function sanitizeSlug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "workspace";
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function mapWorkspace(row: Record<string, unknown>): WorkspaceRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    defaultTemplateId:
      typeof row.default_template_id === "string" && row.default_template_id.trim()
        ? String(row.default_template_id)
        : null,
    stage2ExamplesCorpusJson: normalizeWorkspaceStage2ExamplesCorpusJson(
      row.stage2_examples_corpus_json ? String(row.stage2_examples_corpus_json) : null
    ),
    stage2HardConstraints: normalizeWorkspaceStage2HardConstraints(
      row.stage2_hard_constraints_json ? String(row.stage2_hard_constraints_json) : null
    ),
    stage2PromptConfig: normalizeWorkspaceStage2PromptConfig(
      row.stage2_prompt_config_json ? String(row.stage2_prompt_config_json) : null
    ),
    codexModelConfig: normalizeWorkspaceCodexModelConfig(
      row.workspace_codex_model_config_json ? String(row.workspace_codex_model_config_json) : null
    ),
    stage2CaptionProviderConfig: normalizeWorkspaceStage2CaptionProviderConfig(
      row.stage2_caption_provider_json ? String(row.stage2_caption_provider_json) : null
    ),
    stage3ExecutionTarget:
      normalizeStage3ExecutionTarget(
        row.stage3_execution_target ? String(row.stage3_execution_target) : null
      ) ?? getDefaultStage3ExecutionTarget(),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function normalizeWorkspaceStage2ExamplesCorpusJson(value: string | null | undefined): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return getBundledStage2ExamplesSeedJson();
  }
  try {
    JSON.parse(trimmed);
    return JSON.stringify(
      parseStage2ExamplesJson(trimmed, {
        channelId: "workspace-default",
        channelName: "Workspace default"
      }),
      null,
      2
    );
  } catch {
    return getBundledStage2ExamplesSeedJson();
  }
}

function normalizeWorkspaceStage2HardConstraints(
  value: string | null | undefined
): Stage2HardConstraints {
  return parseStage2HardConstraintsJson(value);
}

function normalizeWorkspaceStage2PromptConfig(value: string | null | undefined): Stage2PromptConfig {
  return resetIncompatibleNativeStage2PromptOverrides(parseStage2PromptConfigJson(value)).config;
}

function normalizeWorkspaceCodexModelConfig(value: string | null | undefined): WorkspaceCodexModelConfig {
  return parseWorkspaceCodexModelConfigJson(value);
}

function normalizeWorkspaceStage2CaptionProviderConfig(
  value: string | null | undefined
): Stage2CaptionProviderConfig {
  return parseStage2CaptionProviderConfigJson(value);
}

function mapUser(row: Record<string, unknown>): UserRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    displayName: String(row.display_name),
    status: String(row.status),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapMember(row: Record<string, unknown>): WorkspaceMemberRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    userId: String(row.user_id),
    role: String(row.role) as AppRole,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapSession(row: Record<string, unknown>): AuthSessionRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    userId: String(row.user_id),
    expiresAt: String(row.expires_at),
    createdAt: String(row.created_at),
    lastSeenAt: String(row.last_seen_at),
    userAgent: row.user_agent ? String(row.user_agent) : null,
    ipAddress: row.ip_address ? String(row.ip_address) : null
  };
}

function mapIntegration(row: Record<string, unknown>): WorkspaceCodexIntegrationRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    provider: "codex",
    status: String(row.status) as WorkspaceCodexStatus,
    ownerUserId: String(row.owner_user_id),
    codexSessionId: row.codex_session_id ? String(row.codex_session_id) : null,
    codexHomePath: row.codex_home_path ? String(row.codex_home_path) : null,
    loginStatusText: row.login_status_text ? String(row.login_status_text) : null,
    deviceAuthStatus: row.device_auth_status ? String(row.device_auth_status) : null,
    deviceAuthOutput: row.device_auth_output ? String(row.device_auth_output) : null,
    deviceAuthLoginUrl: row.device_auth_login_url ? String(row.device_auth_login_url) : null,
    deviceAuthUserCode: row.device_auth_user_code ? String(row.device_auth_user_code) : null,
    connectedAt: row.connected_at ? String(row.connected_at) : null,
    updatedAt: String(row.updated_at)
  };
}

function mapAnthropicIntegration(
  row: Record<string, unknown>
): WorkspaceAnthropicIntegrationRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    provider: "anthropic",
    status: String(row.status) as WorkspaceAnthropicIntegrationStatus,
    ownerUserId: String(row.owner_user_id),
    apiKeyHint: row.api_key_hint ? String(row.api_key_hint) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    connectedAt: row.connected_at ? String(row.connected_at) : null,
    updatedAt: String(row.updated_at)
  };
}

function mapOpenRouterIntegration(
  row: Record<string, unknown>
): WorkspaceOpenRouterIntegrationRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    provider: "openrouter",
    status: String(row.status) as WorkspaceOpenRouterIntegrationStatus,
    ownerUserId: String(row.owner_user_id),
    apiKeyHint: row.api_key_hint ? String(row.api_key_hint) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    connectedAt: row.connected_at ? String(row.connected_at) : null,
    updatedAt: String(row.updated_at)
  };
}

function mapChannelAccess(row: Record<string, unknown>): ChannelAccessRecord {
  return {
    id: String(row.id),
    channelId: String(row.channel_id),
    userId: String(row.user_id),
    accessRole: String(row.access_role) as ChannelAccessRole,
    grantedByUserId: String(row.granted_by_user_id),
    createdAt: String(row.created_at),
    revokedAt: row.revoked_at ? String(row.revoked_at) : null
  };
}

export function hasWorkspaceBootstrap(): boolean {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as count FROM workspace_members WHERE role = 'owner'").get() as
    | Record<string, unknown>
    | undefined;
  return Number(row?.count ?? 0) > 0;
}

export function getWorkspace(): WorkspaceRecord | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM workspaces ORDER BY created_at ASC LIMIT 1").get() as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    return null;
  }
  const stage2ExamplesCorpusJson = getWorkspaceStage2ExamplesCorpusJson(String(row.id));
  const stage3ExecutionTarget = getWorkspaceStage3ExecutionTarget(String(row.id));
  return {
    ...mapWorkspace({
      ...row,
      stage2_examples_corpus_json: stage2ExamplesCorpusJson,
      stage3_execution_target: stage3ExecutionTarget
    })
  };
}

export function getWorkspaceStage2ExamplesCorpusJson(workspaceId: string): string {
  const db = getDb();
  const row = db
    .prepare("SELECT stage2_examples_corpus_json FROM workspaces WHERE id = ? LIMIT 1")
    .get(workspaceId) as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error("Workspace not found.");
  }
  const normalized = normalizeWorkspaceStage2ExamplesCorpusJson(
    row.stage2_examples_corpus_json ? String(row.stage2_examples_corpus_json) : null
  );
  if ((row.stage2_examples_corpus_json ? String(row.stage2_examples_corpus_json) : null) !== normalized) {
    db.prepare("UPDATE workspaces SET stage2_examples_corpus_json = ? WHERE id = ?").run(
      normalized,
      workspaceId
    );
  }
  return normalized;
}

export function getWorkspaceStage2HardConstraints(workspaceId: string): Stage2HardConstraints {
  const db = getDb();
  const row = db
    .prepare("SELECT stage2_hard_constraints_json FROM workspaces WHERE id = ? LIMIT 1")
    .get(workspaceId) as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error("Workspace not found.");
  }
  const normalized = normalizeWorkspaceStage2HardConstraints(
    row.stage2_hard_constraints_json ? String(row.stage2_hard_constraints_json) : null
  );
  const serialized = stringifyStage2HardConstraints(normalized);
  if ((row.stage2_hard_constraints_json ? String(row.stage2_hard_constraints_json) : null) !== serialized) {
    db.prepare("UPDATE workspaces SET stage2_hard_constraints_json = ? WHERE id = ?").run(
      serialized,
      workspaceId
    );
  }
  return normalized;
}

export function getWorkspaceStage2PromptConfig(workspaceId: string): Stage2PromptConfig {
  const db = getDb();
  const row = db
    .prepare("SELECT stage2_prompt_config_json FROM workspaces WHERE id = ? LIMIT 1")
    .get(workspaceId) as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error("Workspace not found.");
  }
  return normalizeWorkspaceStage2PromptConfig(
    row.stage2_prompt_config_json ? String(row.stage2_prompt_config_json) : null
  );
}

export function getWorkspaceCodexModelConfig(workspaceId: string): WorkspaceCodexModelConfig {
  const db = getDb();
  const row = db
    .prepare("SELECT workspace_codex_model_config_json FROM workspaces WHERE id = ? LIMIT 1")
    .get(workspaceId) as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error("Workspace not found.");
  }
  const normalized = normalizeWorkspaceCodexModelConfig(
    row.workspace_codex_model_config_json ? String(row.workspace_codex_model_config_json) : null
  );
  const serialized = stringifyWorkspaceCodexModelConfig(normalized);
  if (
    (row.workspace_codex_model_config_json
      ? String(row.workspace_codex_model_config_json)
      : null) !== serialized
  ) {
    db.prepare("UPDATE workspaces SET workspace_codex_model_config_json = ? WHERE id = ?").run(
      serialized,
      workspaceId
    );
  }
  return normalized;
}

export function getWorkspaceStage2CaptionProviderConfig(
  workspaceId: string
): Stage2CaptionProviderConfig {
  const db = getDb();
  const row = db
    .prepare("SELECT stage2_caption_provider_json FROM workspaces WHERE id = ? LIMIT 1")
    .get(workspaceId) as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error("Workspace not found.");
  }
  const normalized = normalizeWorkspaceStage2CaptionProviderConfig(
    row.stage2_caption_provider_json ? String(row.stage2_caption_provider_json) : null
  );
  const serialized = stringifyStage2CaptionProviderConfig(normalized);
  if (
    (row.stage2_caption_provider_json
      ? String(row.stage2_caption_provider_json)
      : null) !== serialized
  ) {
    db.prepare("UPDATE workspaces SET stage2_caption_provider_json = ? WHERE id = ?").run(
      serialized,
      workspaceId
    );
  }
  return normalized;
}

export function getWorkspaceStage3ExecutionTarget(workspaceId: string): Stage3ExecutionTarget {
  const db = getDb();
  const row = db
    .prepare("SELECT stage3_execution_target FROM workspaces WHERE id = ? LIMIT 1")
    .get(workspaceId) as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error("Workspace not found.");
  }
  const normalized =
    normalizeStage3ExecutionTarget(
      row.stage3_execution_target ? String(row.stage3_execution_target) : null
    ) ?? getDefaultStage3ExecutionTarget();
  if ((row.stage3_execution_target ? String(row.stage3_execution_target) : null) !== normalized) {
    db.prepare("UPDATE workspaces SET stage3_execution_target = ? WHERE id = ?").run(
      normalized,
      workspaceId
    );
  }
  return normalized;
}

export function updateWorkspaceStage2ExamplesCorpusJson(
  workspaceId: string,
  rawJson: string
): WorkspaceRecord {
  const trimmed = rawJson.trim();
  if (!trimmed) {
    throw new Error("Workspace examples corpus JSON не должен быть пустым.");
  }
  try {
    JSON.parse(trimmed);
  } catch {
    throw new Error("Workspace examples corpus JSON должен быть валидным JSON.");
  }

  const normalized = JSON.stringify(
    parseStage2ExamplesJson(trimmed, {
      channelId: "workspace-default",
      channelName: "Workspace default"
    }),
    null,
    2
  );
  const updatedAt = nowIso();
  const db = getDb();
  db.prepare(
    "UPDATE workspaces SET stage2_examples_corpus_json = ?, updated_at = ? WHERE id = ?"
  ).run(normalized, updatedAt, workspaceId);
  const row = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(workspaceId) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    throw new Error("Workspace not found.");
  }
  return mapWorkspace(row);
}

export function updateWorkspaceStage2HardConstraints(
  workspaceId: string,
  constraints: Stage2HardConstraints
): WorkspaceRecord {
  const serialized = stringifyStage2HardConstraints(constraints);
  const updatedAt = nowIso();
  const db = getDb();
  db.prepare(
    "UPDATE workspaces SET stage2_hard_constraints_json = ?, updated_at = ? WHERE id = ?"
  ).run(serialized, updatedAt, workspaceId);
  const row = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(workspaceId) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    throw new Error("Workspace not found.");
  }
  return mapWorkspace(row);
}

export function updateWorkspaceStage2PromptConfig(
  workspaceId: string,
  promptConfig: Stage2PromptConfig
): WorkspaceRecord {
  const db = getDb();
  const existingRow = db
    .prepare("SELECT stage2_prompt_config_json FROM workspaces WHERE id = ? LIMIT 1")
    .get(workspaceId) as Record<string, unknown> | undefined;
  if (!existingRow) {
    throw new Error("Workspace not found.");
  }
  const preparedConfig = prepareStage2PromptConfigForExplicitSave({
    nextConfig: promptConfig,
    previousConfig: parseStage2PromptConfigJson(
      existingRow.stage2_prompt_config_json ? String(existingRow.stage2_prompt_config_json) : null
    )
  });
  const serialized = stringifyStage2PromptConfig(preparedConfig);
  const updatedAt = nowIso();
  db.prepare(
    "UPDATE workspaces SET stage2_prompt_config_json = ?, updated_at = ? WHERE id = ?"
  ).run(serialized, updatedAt, workspaceId);
  const row = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(workspaceId) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    throw new Error("Workspace not found.");
  }
  return mapWorkspace(row);
}

export function resetWorkspaceIncompatibleNativePromptOverrides(workspaceId: string): {
  workspace: WorkspaceRecord;
  removedStageIds: Stage2PromptConfigStageId[];
  previousConfig: Stage2PromptConfig;
  nextConfig: Stage2PromptConfig;
} {
  const db = getDb();
  const row = db
    .prepare("SELECT stage2_prompt_config_json FROM workspaces WHERE id = ? LIMIT 1")
    .get(workspaceId) as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error("Workspace not found.");
  }
  const previousConfig = parseStage2PromptConfigJson(
    row.stage2_prompt_config_json ? String(row.stage2_prompt_config_json) : null
  );
  const resetResult = resetIncompatibleNativeStage2PromptOverrides(previousConfig);
  if (resetResult.removedStageIds.length > 0) {
    db.prepare(
      "UPDATE workspaces SET stage2_prompt_config_json = ?, updated_at = ? WHERE id = ?"
    ).run(stringifyStage2PromptConfig(resetResult.config), nowIso(), workspaceId);
  }
  const updatedRow = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(workspaceId) as
    | Record<string, unknown>
    | undefined;
  if (!updatedRow) {
    throw new Error("Workspace not found.");
  }
  const workspace = mapWorkspace(updatedRow);
  return {
    workspace,
    removedStageIds: resetResult.removedStageIds,
    previousConfig,
    nextConfig: resetResult.config
  };
}

export function updateWorkspaceCodexModelConfig(
  workspaceId: string,
  codexModelConfig: WorkspaceCodexModelConfig
): WorkspaceRecord {
  const serialized = stringifyWorkspaceCodexModelConfig(codexModelConfig);
  const updatedAt = nowIso();
  const db = getDb();
  db.prepare(
    "UPDATE workspaces SET workspace_codex_model_config_json = ?, updated_at = ? WHERE id = ?"
  ).run(serialized, updatedAt, workspaceId);
  const row = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(workspaceId) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    throw new Error("Workspace not found.");
  }
  return mapWorkspace(row);
}

export function updateWorkspaceStage2CaptionProviderConfig(
  workspaceId: string,
  captionProviderConfig: Stage2CaptionProviderConfig
): WorkspaceRecord {
  const normalized = normalizeStage2CaptionProviderConfig(captionProviderConfig);
  if (normalized.provider === "anthropic") {
    const integration = getWorkspaceAnthropicIntegration(workspaceId);
    if (!integration || integration.status !== "connected" || !getWorkspaceAnthropicApiKey(workspaceId)) {
      throw new Error("Anthropic captions недоступны: сначала подключите и проверьте API key.");
    }
    if (!normalized.anthropicModel?.trim()) {
      throw new Error("Укажите модель Anthropic для captions.");
    }
  }
  if (normalized.provider === "openrouter") {
    const integration = getWorkspaceOpenRouterIntegration(workspaceId);
    if (!integration || integration.status !== "connected" || !getWorkspaceOpenRouterApiKey(workspaceId)) {
      throw new Error("OpenRouter captions недоступны: сначала подключите и проверьте API key.");
    }
    if (!normalized.openrouterModel?.trim()) {
      throw new Error("Укажите модель OpenRouter для captions.");
    }
  }
  const serialized = stringifyStage2CaptionProviderConfig(normalized);
  const updatedAt = nowIso();
  const db = getDb();
  db.prepare(
    "UPDATE workspaces SET stage2_caption_provider_json = ?, updated_at = ? WHERE id = ?"
  ).run(serialized, updatedAt, workspaceId);
  const row = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(workspaceId) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    throw new Error("Workspace not found.");
  }
  return mapWorkspace(row);
}

export function updateWorkspaceStage3ExecutionTarget(
  workspaceId: string,
  stage3ExecutionTarget: Stage3ExecutionTarget
): WorkspaceRecord {
  const normalized = normalizeStage3ExecutionTarget(stage3ExecutionTarget);
  if (!normalized) {
    throw new Error("Stage 3 execution target is invalid.");
  }
  const updatedAt = nowIso();
  const db = getDb();
  db.prepare(
    "UPDATE workspaces SET stage3_execution_target = ?, updated_at = ? WHERE id = ?"
  ).run(normalized, updatedAt, workspaceId);
  const row = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(workspaceId) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    throw new Error("Workspace not found.");
  }
  return mapWorkspace(row);
}

export function getUserById(userId: string): UserRecord | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as
    | Record<string, unknown>
    | undefined;
  return row ? mapUser(row) : null;
}

function getUserWithPasswordByEmail(email: string): (UserRecord & { passwordHash: string }) | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(normalizeEmail(email)) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    return null;
  }
  return {
    ...mapUser(row),
    passwordHash: String(row.password_hash)
  };
}

function withoutPasswordHash(user: UserRecord & { passwordHash: string }): UserRecord {
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
}

function getPendingInviteByEmail(
  workspaceId: string,
  email: string
): { id: string; expiresAt: string } | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, expires_at
       FROM workspace_invites
       WHERE workspace_id = ? AND email = ? AND accepted_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(workspaceId, normalizeEmail(email)) as Record<string, unknown> | undefined;
  if (!row) {
    return null;
  }
  if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
    return null;
  }
  return {
    id: String(row.id),
    expiresAt: String(row.expires_at)
  };
}

export function getMembership(userId: string, workspaceId: string): WorkspaceMemberRecord | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM workspace_members WHERE user_id = ? AND workspace_id = ?")
    .get(userId, workspaceId) as Record<string, unknown> | undefined;
  return row ? mapMember(row) : null;
}

export function getWorkspaceMember(
  workspaceId: string,
  memberOrUserId: string
): WorkspaceMemberRecord | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT * FROM workspace_members WHERE workspace_id = ? AND (user_id = ? OR id = ?) LIMIT 1"
    )
    .get(workspaceId, memberOrUserId, memberOrUserId) as Record<string, unknown> | undefined;
  return row ? mapMember(row) : null;
}

export function listWorkspaceMembers(workspaceId: string): Array<
  WorkspaceMemberRecord & { user: UserRecord }
> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT wm.*, u.email, u.display_name, u.status, u.created_at as user_created_at, u.updated_at as user_updated_at, u.id as joined_user_id
       FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = ?
       ORDER BY CASE wm.role
         WHEN 'owner' THEN 0
         WHEN 'manager' THEN 1
         WHEN 'redactor' THEN 2
         ELSE 3
       END, u.created_at ASC`
    )
    .all(workspaceId) as Record<string, unknown>[];

  return rows.map((row) => ({
    ...mapMember(row),
    user: {
      id: String(row.joined_user_id),
      email: String(row.email),
      displayName: String(row.display_name),
      status: String(row.status),
      createdAt: String(row.user_created_at),
      updatedAt: String(row.user_updated_at)
    }
  }));
}

export async function bootstrapOwner(input: {
  workspaceName: string;
  email: string;
  password: string;
  displayName: string;
}): Promise<AuthContext & { sessionToken: string }> {
  if (hasWorkspaceBootstrap()) {
    throw new Error("Owner already exists.");
  }

  const now = nowIso();
  const workspaceId = newId();
  const workspace: WorkspaceRecord = {
    id: workspaceId,
    name: input.workspaceName.trim() || "Workspace",
    slug: sanitizeSlug(input.workspaceName),
    defaultTemplateId: null,
    stage2ExamplesCorpusJson: getBundledStage2ExamplesSeedJson(),
    stage2HardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS,
    stage2PromptConfig: DEFAULT_STAGE2_PROMPT_CONFIG,
    codexModelConfig: DEFAULT_WORKSPACE_CODEX_MODEL_CONFIG,
    stage2CaptionProviderConfig: DEFAULT_STAGE2_CAPTION_PROVIDER_CONFIG,
    stage3ExecutionTarget: getDefaultStage3ExecutionTarget(),
    createdAt: now,
    updatedAt: now
  };
  const userId = newId();
  const passwordHash = await hashPassword(input.password);
  const user: UserRecord = {
    id: userId,
    email: normalizeEmail(input.email),
    displayName: input.displayName.trim() || "Owner",
    status: "active",
    createdAt: now,
    updatedAt: now
  };
  const membership: WorkspaceMemberRecord = {
    id: newId(),
    workspaceId,
    userId,
    role: "owner",
    createdAt: now,
    updatedAt: now
  };

  runInTransaction((db) => {
    db.prepare(
      "INSERT INTO workspaces (id, name, slug, default_template_id, stage2_examples_corpus_json, stage2_hard_constraints_json, stage2_prompt_config_json, workspace_codex_model_config_json, stage2_caption_provider_json, stage3_execution_target, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      workspace.id,
      workspace.name,
      workspace.slug,
      workspace.defaultTemplateId,
      workspace.stage2ExamplesCorpusJson,
      stringifyStage2HardConstraints(workspace.stage2HardConstraints),
      stringifyStage2PromptConfig(workspace.stage2PromptConfig),
      stringifyWorkspaceCodexModelConfig(workspace.codexModelConfig),
      stringifyStage2CaptionProviderConfig(workspace.stage2CaptionProviderConfig),
      workspace.stage3ExecutionTarget,
      workspace.createdAt,
      workspace.updatedAt
    );
    db.prepare(
      "INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      user.id,
      user.email,
      passwordHash,
      user.displayName,
      user.status,
      user.createdAt,
      user.updatedAt
    );
    db.prepare(
      "INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      membership.id,
      membership.workspaceId,
      membership.userId,
      membership.role,
      membership.createdAt,
      membership.updatedAt
    );
  });

  await ensureWorkspaceSeeded(workspace.id, user.id);
  await ensureWorkspaceTemplateLibrary(workspace.id);
  const session = createAuthSession({
    workspaceId: workspace.id,
    userId: user.id,
    userAgent: null,
    ipAddress: null
  });

  return {
    workspace,
    user,
    membership,
    session: session.record,
    sessionToken: session.token
  };
}

export async function registerPublicRedactor(input: {
  email: string;
  password: string;
  displayName: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}): Promise<AuthContext & { sessionToken: string }> {
  const workspace = getWorkspace();
  if (!workspace) {
    throw new Error("Workspace is not initialized.");
  }
  if (getUserWithPasswordByEmail(input.email)) {
    throw new Error("Пользователь с таким email уже существует.");
  }

  const now = nowIso();
  const userId = newId();
  const passwordHash = await hashPassword(input.password);
  const user: UserRecord = {
    id: userId,
    email: normalizeEmail(input.email),
    displayName: input.displayName.trim() || "Redactor",
    status: "active",
    createdAt: now,
    updatedAt: now
  };
  const membership: WorkspaceMemberRecord = {
    id: newId(),
    workspaceId: workspace.id,
    userId,
    role: "redactor",
    createdAt: now,
    updatedAt: now
  };

  runInTransaction((db) => {
    db.prepare(
      "INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      user.id,
      user.email,
      passwordHash,
      user.displayName,
      user.status,
      user.createdAt,
      user.updatedAt
    );
    db.prepare(
      "INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      membership.id,
      membership.workspaceId,
      membership.userId,
      membership.role,
      membership.createdAt,
      membership.updatedAt
    );
  });

  const session = createAuthSession({
    workspaceId: workspace.id,
    userId: user.id,
    userAgent: input.userAgent ?? null,
    ipAddress: input.ipAddress ?? null
  });

  return {
    workspace,
    user,
    membership,
    session: session.record,
    sessionToken: session.token
  };
}

export async function createUserByInvite(input: {
  workspaceId: string;
  role: AppRole;
  email: string;
  password: string;
  displayName: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}): Promise<AuthContext & { sessionToken: string }> {
  if (input.role === "owner") {
    throw new Error("Owner invite is not supported.");
  }
  if (getUserWithPasswordByEmail(input.email)) {
    throw new Error("Пользователь с таким email уже существует.");
  }
  const workspace = getWorkspace();
  if (!workspace || workspace.id !== input.workspaceId) {
    throw new Error("Workspace not found.");
  }

  const now = nowIso();
  const userId = newId();
  const passwordHash = await hashPassword(input.password);
  const user: UserRecord = {
    id: userId,
    email: normalizeEmail(input.email),
    displayName: input.displayName.trim() || input.role,
    status: "active",
    createdAt: now,
    updatedAt: now
  };
  const membership: WorkspaceMemberRecord = {
    id: newId(),
    workspaceId: workspace.id,
    userId,
    role: input.role,
    createdAt: now,
    updatedAt: now
  };

  runInTransaction((db) => {
    db.prepare(
      "INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      user.id,
      user.email,
      passwordHash,
      user.displayName,
      user.status,
      user.createdAt,
      user.updatedAt
    );
    db.prepare(
      "INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      membership.id,
      membership.workspaceId,
      membership.userId,
      membership.role,
      membership.createdAt,
      membership.updatedAt
    );
  });

  const session = createAuthSession({
    workspaceId: workspace.id,
    userId: user.id,
    userAgent: input.userAgent ?? null,
    ipAddress: input.ipAddress ?? null
  });

  return {
    workspace,
    user,
    membership,
    session: session.record,
    sessionToken: session.token
  };
}

export async function loginWithPassword(input: {
  email: string;
  password: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}): Promise<AuthContext & { sessionToken: string }> {
  const candidate = getUserWithPasswordByEmail(input.email);
  if (!candidate) {
    throw new Error("Неверный email или пароль.");
  }
  const ok = await verifyPassword(input.password, candidate.passwordHash);
  if (!ok) {
    throw new Error("Неверный email или пароль.");
  }

  const workspace = getWorkspace();
  if (!workspace) {
    throw new Error("Workspace is not initialized.");
  }
  const membership = getMembership(candidate.id, workspace.id);
  if (!membership) {
    throw new Error("Workspace membership not found.");
  }

  const session = createAuthSession({
    workspaceId: workspace.id,
    userId: candidate.id,
    userAgent: input.userAgent ?? null,
    ipAddress: input.ipAddress ?? null
  });

  return {
    workspace,
    user: withoutPasswordHash(candidate),
    membership,
    session: session.record,
    sessionToken: session.token
  };
}

export function createAuthSession(input: {
  workspaceId: string;
  userId: string;
  userAgent: string | null;
  ipAddress: string | null;
}): { token: string; record: AuthSessionRecord } {
  const now = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const token = randomBytes(32).toString("hex");
  const record: AuthSessionRecord = {
    id: newId(),
    workspaceId: input.workspaceId,
    userId: input.userId,
    expiresAt,
    createdAt: now,
    lastSeenAt: now,
    userAgent: input.userAgent,
    ipAddress: input.ipAddress
  };

  const db = getDb();
  db.prepare(
    "INSERT INTO auth_sessions (id, workspace_id, user_id, session_token_hash, expires_at, created_at, last_seen_at, user_agent, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    record.id,
    record.workspaceId,
    record.userId,
    hashToken(token),
    record.expiresAt,
    record.createdAt,
    record.lastSeenAt,
    record.userAgent,
    record.ipAddress
  );

  return { token, record };
}

export function invalidateAuthSession(sessionToken: string): void {
  const db = getDb();
  db.prepare("DELETE FROM auth_sessions WHERE session_token_hash = ?").run(hashToken(sessionToken));
}

export function getAuthContextByToken(sessionToken: string): AuthContext | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
        s.*,
        u.email,
        u.display_name,
        u.status as user_status,
        u.created_at as user_created_at,
        u.updated_at as user_updated_at,
        wm.id as membership_id,
        wm.role as membership_role,
        wm.created_at as membership_created_at,
        wm.updated_at as membership_updated_at,
        w.name as workspace_name,
        w.slug as workspace_slug,
        w.default_template_id as workspace_default_template_id,
        w.stage2_examples_corpus_json as workspace_stage2_examples_corpus_json,
        w.stage2_hard_constraints_json as workspace_stage2_hard_constraints_json,
        w.stage2_prompt_config_json as workspace_stage2_prompt_config_json,
        w.created_at as workspace_created_at,
        w.updated_at as workspace_updated_at
      FROM auth_sessions s
      JOIN users u ON u.id = s.user_id
      JOIN workspace_members wm ON wm.user_id = s.user_id AND wm.workspace_id = s.workspace_id
      JOIN workspaces w ON w.id = s.workspace_id
      WHERE s.session_token_hash = ?`
    )
    .get(hashToken(sessionToken)) as Record<string, unknown> | undefined;

  if (!row) {
    return null;
  }
  if (String(row.user_status) !== "active") {
    db.prepare("DELETE FROM auth_sessions WHERE id = ?").run(String(row.id));
    return null;
  }
  if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
    db.prepare("DELETE FROM auth_sessions WHERE id = ?").run(String(row.id));
    return null;
  }

  const now = nowIso();
  db.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?").run(now, String(row.id));

  return {
    workspace: {
      id: String(row.workspace_id),
      name: String(row.workspace_name),
      slug: String(row.workspace_slug),
      defaultTemplateId:
        typeof row.workspace_default_template_id === "string" && row.workspace_default_template_id.trim()
          ? String(row.workspace_default_template_id)
          : null,
      stage2ExamplesCorpusJson: getWorkspaceStage2ExamplesCorpusJson(String(row.workspace_id)),
      stage2HardConstraints: getWorkspaceStage2HardConstraints(String(row.workspace_id)),
      stage2PromptConfig: getWorkspaceStage2PromptConfig(String(row.workspace_id)),
      codexModelConfig: getWorkspaceCodexModelConfig(String(row.workspace_id)),
      stage2CaptionProviderConfig: getWorkspaceStage2CaptionProviderConfig(String(row.workspace_id)),
      stage3ExecutionTarget: getWorkspaceStage3ExecutionTarget(String(row.workspace_id)),
      createdAt: String(row.workspace_created_at),
      updatedAt: String(row.workspace_updated_at)
    },
    user: {
      id: String(row.user_id),
      email: String(row.email),
      displayName: String(row.display_name),
      status: String(row.user_status),
      createdAt: String(row.user_created_at),
      updatedAt: String(row.user_updated_at)
    },
    membership: {
      id: String(row.membership_id),
      workspaceId: String(row.workspace_id),
      userId: String(row.user_id),
      role: String(row.membership_role) as AppRole,
      createdAt: String(row.membership_created_at),
      updatedAt: String(row.membership_updated_at)
    },
    session: {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      userId: String(row.user_id),
      expiresAt: String(row.expires_at),
      createdAt: String(row.created_at),
      lastSeenAt: now,
      userAgent: row.user_agent ? String(row.user_agent) : null,
      ipAddress: row.ip_address ? String(row.ip_address) : null
    }
  };
}

export function getEffectivePermissions(role: AppRole): EffectivePermissions {
  return {
    canManageMembers: role === "owner" || role === "manager",
    canManageCodex: role === "owner",
    canCreateChannel: role !== "redactor_limited",
    canManageAnyChannelAccess: role === "owner" || role === "manager"
  };
}

export function getWorkspaceCodexIntegration(
  workspaceId: string
): WorkspaceCodexIntegrationRecord | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM workspace_codex_integrations WHERE workspace_id = ?")
    .get(workspaceId) as Record<string, unknown> | undefined;
  return row ? mapIntegration(row) : null;
}

export function getWorkspaceAnthropicIntegration(
  workspaceId: string
): WorkspaceAnthropicIntegrationRecord | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM workspace_anthropic_integrations WHERE workspace_id = ?")
    .get(workspaceId) as Record<string, unknown> | undefined;
  return row ? mapAnthropicIntegration(row) : null;
}

export function getWorkspaceOpenRouterIntegration(
  workspaceId: string
): WorkspaceOpenRouterIntegrationRecord | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM workspace_openrouter_integrations WHERE workspace_id = ?")
    .get(workspaceId) as Record<string, unknown> | undefined;
  return row ? mapOpenRouterIntegration(row) : null;
}

function maskApiKeyHint(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 12) {
    return trimmed;
  }
  return `${trimmed.slice(0, 12)}...${trimmed.slice(-4)}`;
}

export function getWorkspaceAnthropicApiKey(workspaceId: string): string | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT encrypted_api_key_json FROM workspace_anthropic_integrations WHERE workspace_id = ? LIMIT 1"
    )
    .get(workspaceId) as Record<string, unknown> | undefined;
  const stored = decryptJsonPayload<{ apiKey?: string }>(
    row?.encrypted_api_key_json ? String(row.encrypted_api_key_json) : null
  );
  const apiKey = typeof stored?.apiKey === "string" ? stored.apiKey.trim() : "";
  return apiKey || null;
}

export function getWorkspaceOpenRouterApiKey(workspaceId: string): string | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT encrypted_api_key_json FROM workspace_openrouter_integrations WHERE workspace_id = ? LIMIT 1"
    )
    .get(workspaceId) as Record<string, unknown> | undefined;
  const stored = decryptJsonPayload<{ apiKey?: string }>(
    row?.encrypted_api_key_json ? String(row.encrypted_api_key_json) : null
  );
  const apiKey = typeof stored?.apiKey === "string" ? stored.apiKey.trim() : "";
  return apiKey || null;
}

export function upsertWorkspaceCodexIntegration(input: {
  workspaceId: string;
  ownerUserId: string;
  status: WorkspaceCodexStatus;
  codexSessionId?: string | null;
  codexHomePath?: string | null;
  loginStatusText?: string | null;
  deviceAuthStatus?: string | null;
  deviceAuthOutput?: string | null;
  deviceAuthLoginUrl?: string | null;
  deviceAuthUserCode?: string | null;
  connectedAt?: string | null;
}): WorkspaceCodexIntegrationRecord {
  const current = getWorkspaceCodexIntegration(input.workspaceId);
  const resolveNullable = <T>(nextValue: T | null | undefined, currentValue: T | null | undefined): T | null =>
    nextValue === undefined ? (currentValue ?? null) : nextValue;
  const record = {
    id: current?.id ?? newId(),
    workspaceId: input.workspaceId,
    provider: "codex" as const,
    status: input.status,
    ownerUserId: input.ownerUserId,
    codexSessionId: resolveNullable(input.codexSessionId, current?.codexSessionId),
    codexHomePath: resolveNullable(input.codexHomePath, current?.codexHomePath),
    loginStatusText: resolveNullable(input.loginStatusText, current?.loginStatusText),
    deviceAuthStatus: resolveNullable(input.deviceAuthStatus, current?.deviceAuthStatus),
    deviceAuthOutput: resolveNullable(input.deviceAuthOutput, current?.deviceAuthOutput),
    deviceAuthLoginUrl: resolveNullable(input.deviceAuthLoginUrl, current?.deviceAuthLoginUrl),
    deviceAuthUserCode: resolveNullable(input.deviceAuthUserCode, current?.deviceAuthUserCode),
    connectedAt:
      input.connectedAt === undefined ? current?.connectedAt ?? null : input.connectedAt,
    updatedAt: nowIso()
  };

  const db = getDb();
  db.prepare(
    `INSERT INTO workspace_codex_integrations
    (id, workspace_id, provider, status, owner_user_id, codex_session_id, codex_home_path, login_status_text, device_auth_status, device_auth_output, device_auth_login_url, device_auth_user_code, connected_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      status = excluded.status,
      owner_user_id = excluded.owner_user_id,
      codex_session_id = excluded.codex_session_id,
      codex_home_path = excluded.codex_home_path,
      login_status_text = excluded.login_status_text,
      device_auth_status = excluded.device_auth_status,
      device_auth_output = excluded.device_auth_output,
      device_auth_login_url = excluded.device_auth_login_url,
      device_auth_user_code = excluded.device_auth_user_code,
      connected_at = excluded.connected_at,
      updated_at = excluded.updated_at`
  ).run(
    record.id,
    record.workspaceId,
    record.provider,
    record.status,
    record.ownerUserId,
    record.codexSessionId,
    record.codexHomePath,
    record.loginStatusText,
    record.deviceAuthStatus,
    record.deviceAuthOutput,
    record.deviceAuthLoginUrl,
    record.deviceAuthUserCode,
    record.connectedAt,
    record.updatedAt
  );

  return record;
}

export function upsertWorkspaceAnthropicIntegration(input: {
  workspaceId: string;
  ownerUserId: string;
  status: WorkspaceAnthropicIntegrationStatus;
  apiKey?: string | null;
  lastError?: string | null;
  connectedAt?: string | null;
}): WorkspaceAnthropicIntegrationRecord {
  const current = getWorkspaceAnthropicIntegration(input.workspaceId);
  const currentApiKey = getWorkspaceAnthropicApiKey(input.workspaceId);
  const nextApiKey = input.apiKey === undefined ? currentApiKey : input.apiKey?.trim() || null;
  const encryptedApiKey =
    nextApiKey !== null ? encryptJsonPayload({ apiKey: nextApiKey }) : null;
  const record = {
    id: current?.id ?? newId(),
    workspaceId: input.workspaceId,
    provider: "anthropic" as const,
    status: input.status,
    ownerUserId: input.ownerUserId,
    encryptedApiKeyJson: encryptedApiKey,
    apiKeyHint: nextApiKey ? maskApiKeyHint(nextApiKey) : null,
    lastError:
      input.lastError === undefined
        ? current?.lastError ?? null
        : input.lastError,
    connectedAt:
      input.connectedAt === undefined ? current?.connectedAt ?? null : input.connectedAt,
    updatedAt: nowIso()
  };

  const db = getDb();
  db.prepare(
    `INSERT INTO workspace_anthropic_integrations
    (id, workspace_id, provider, status, owner_user_id, encrypted_api_key_json, api_key_hint, last_error, connected_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      status = excluded.status,
      owner_user_id = excluded.owner_user_id,
      encrypted_api_key_json = excluded.encrypted_api_key_json,
      api_key_hint = excluded.api_key_hint,
      last_error = excluded.last_error,
      connected_at = excluded.connected_at,
      updated_at = excluded.updated_at`
  ).run(
    record.id,
    record.workspaceId,
    record.provider,
    record.status,
    record.ownerUserId,
    record.encryptedApiKeyJson,
    record.apiKeyHint,
    record.lastError,
    record.connectedAt,
    record.updatedAt
  );

  return {
    id: record.id,
    workspaceId: record.workspaceId,
    provider: record.provider,
    status: record.status,
    ownerUserId: record.ownerUserId,
    apiKeyHint: record.apiKeyHint,
    lastError: record.lastError,
    connectedAt: record.connectedAt,
    updatedAt: record.updatedAt
  };
}

export function upsertWorkspaceOpenRouterIntegration(input: {
  workspaceId: string;
  ownerUserId: string;
  status: WorkspaceOpenRouterIntegrationStatus;
  apiKey?: string | null;
  lastError?: string | null;
  connectedAt?: string | null;
}): WorkspaceOpenRouterIntegrationRecord {
  const current = getWorkspaceOpenRouterIntegration(input.workspaceId);
  const currentApiKey = getWorkspaceOpenRouterApiKey(input.workspaceId);
  const nextApiKey = input.apiKey === undefined ? currentApiKey : input.apiKey?.trim() || null;
  const encryptedApiKey =
    nextApiKey !== null ? encryptJsonPayload({ apiKey: nextApiKey }) : null;
  const record = {
    id: current?.id ?? newId(),
    workspaceId: input.workspaceId,
    provider: "openrouter" as const,
    status: input.status,
    ownerUserId: input.ownerUserId,
    encryptedApiKeyJson: encryptedApiKey,
    apiKeyHint: nextApiKey ? maskApiKeyHint(nextApiKey) : null,
    lastError:
      input.lastError === undefined
        ? current?.lastError ?? null
        : input.lastError,
    connectedAt:
      input.connectedAt === undefined ? current?.connectedAt ?? null : input.connectedAt,
    updatedAt: nowIso()
  };

  const db = getDb();
  db.prepare(
    `INSERT INTO workspace_openrouter_integrations
    (id, workspace_id, provider, status, owner_user_id, encrypted_api_key_json, api_key_hint, last_error, connected_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      status = excluded.status,
      owner_user_id = excluded.owner_user_id,
      encrypted_api_key_json = excluded.encrypted_api_key_json,
      api_key_hint = excluded.api_key_hint,
      last_error = excluded.last_error,
      connected_at = excluded.connected_at,
      updated_at = excluded.updated_at`
  ).run(
    record.id,
    record.workspaceId,
    record.provider,
    record.status,
    record.ownerUserId,
    record.encryptedApiKeyJson,
    record.apiKeyHint,
    record.lastError,
    record.connectedAt,
    record.updatedAt
  );

  return {
    id: record.id,
    workspaceId: record.workspaceId,
    provider: record.provider,
    status: record.status,
    ownerUserId: record.ownerUserId,
    apiKeyHint: record.apiKeyHint,
    lastError: record.lastError,
    connectedAt: record.connectedAt,
    updatedAt: record.updatedAt
  };
}

export function listChannelAccess(channelId: string): ChannelAccessRecord[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM channel_access WHERE channel_id = ? AND revoked_at IS NULL ORDER BY created_at ASC")
    .all(channelId) as Record<string, unknown>[];
  return rows.map(mapChannelAccess);
}

export function setChannelAccess(input: {
  channelId: string;
  userId: string;
  grantedByUserId: string;
}): ChannelAccessRecord {
  const existing = listChannelAccess(input.channelId).find((item) => item.userId === input.userId);
  if (existing) {
    return existing;
  }
  const record: ChannelAccessRecord = {
    id: newId(),
    channelId: input.channelId,
    userId: input.userId,
    accessRole: "operate",
    grantedByUserId: input.grantedByUserId,
    createdAt: nowIso(),
    revokedAt: null
  };
  const db = getDb();
  db.prepare(
    `INSERT INTO channel_access (id, channel_id, user_id, access_role, granted_by_user_id, created_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(channel_id, user_id) DO UPDATE SET
      access_role = excluded.access_role,
      granted_by_user_id = excluded.granted_by_user_id,
      created_at = excluded.created_at,
      revoked_at = NULL`
  ).run(
    record.id,
    record.channelId,
    record.userId,
    record.accessRole,
    record.grantedByUserId,
    record.createdAt
  );
  return record;
}

export function revokeChannelAccess(channelId: string, userId: string): void {
  const db = getDb();
  db.prepare("UPDATE channel_access SET revoked_at = ? WHERE channel_id = ? AND user_id = ?").run(
    nowIso(),
    channelId,
    userId
  );
}

export function updateWorkspaceMemberRole(
  workspaceId: string,
  memberOrUserId: string,
  role: AppRole
): WorkspaceMemberRecord {
  const db = getDb();
  const current = getWorkspaceMember(workspaceId, memberOrUserId);
  if (!current) {
    throw new Error("Member not found.");
  }
  if (current.role === "owner" || role === "owner") {
    throw new Error("Owner role cannot be changed.");
  }
  const updatedAt = nowIso();
  db.prepare("UPDATE workspace_members SET role = ?, updated_at = ? WHERE id = ?").run(
    role,
    updatedAt,
    current.id
  );
  return {
    ...current,
    role,
    updatedAt
  };
}

export async function createInvite(input: {
  workspaceId: string;
  email: string;
  role: AppRole;
  createdByUserId: string;
}): Promise<{ id: string; role: AppRole; email: string; token: string; expiresAt: string }> {
  if (input.role === "owner") {
    throw new Error("Owner invite is not supported.");
  }
  if (getUserWithPasswordByEmail(input.email)) {
    throw new Error("Пользователь с таким email уже существует.");
  }
  if (getPendingInviteByEmail(input.workspaceId, input.email)) {
    throw new Error("Для этого email уже существует активный invite.");
  }
  const token = randomBytes(24).toString("hex");
  const record = {
    id: newId(),
    workspaceId: input.workspaceId,
    email: normalizeEmail(input.email),
    role: input.role,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
    createdByUserId: input.createdByUserId,
    createdAt: nowIso()
  };
  const db = getDb();
  db.prepare(
    "INSERT INTO workspace_invites (id, workspace_id, email, role, token_hash, expires_at, accepted_at, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)"
  ).run(
    record.id,
    record.workspaceId,
    record.email,
    record.role,
    record.tokenHash,
    record.expiresAt,
    record.createdByUserId,
    record.createdAt
  );
  return {
    id: record.id,
    role: record.role,
    email: record.email,
    token,
    expiresAt: record.expiresAt
  };
}

export function consumeInvite(token: string): {
  id: string;
  workspaceId: string;
  email: string;
  role: AppRole;
} | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM workspace_invites WHERE token_hash = ? AND accepted_at IS NULL")
    .get(hashToken(token)) as Record<string, unknown> | undefined;
  if (!row) {
    return null;
  }
  if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
    return null;
  }
  db.prepare("UPDATE workspace_invites SET accepted_at = ? WHERE id = ?").run(nowIso(), String(row.id));
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    email: String(row.email),
    role: String(row.role) as AppRole
  };
}

export function canManageInviteRole(actorRole: AppRole, targetRole: AppRole): boolean {
  if (actorRole === "owner") {
    return targetRole === "manager" || targetRole === "redactor" || targetRole === "redactor_limited";
  }
  if (actorRole === "manager") {
    return targetRole === "redactor" || targetRole === "redactor_limited";
  }
  return false;
}

export function canManageMemberRoleTransition(
  actorRole: AppRole,
  currentRole: AppRole,
  nextRole: AppRole
): boolean {
  if (currentRole === "owner" || nextRole === "owner") {
    return false;
  }
  if (actorRole === "owner") {
    return true;
  }
  if (actorRole === "manager") {
    const managerAllowedCurrent = currentRole === "redactor" || currentRole === "redactor_limited";
    const managerAllowedNext = nextRole === "redactor" || nextRole === "redactor_limited";
    return managerAllowedCurrent && managerAllowedNext;
  }
  return false;
}

export async function acceptInviteRegistration(input: {
  token: string;
  password: string;
  displayName: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}): Promise<AuthContext & { sessionToken: string }> {
  const tokenHash = hashToken(input.token.trim());
  const workspace = getWorkspace();
  if (!workspace) {
    throw new Error("Workspace is not initialized.");
  }

  const preview = getDb()
    .prepare("SELECT * FROM workspace_invites WHERE token_hash = ? AND accepted_at IS NULL")
    .get(tokenHash) as Record<string, unknown> | undefined;
  if (!preview) {
    throw new Error("Invite not found or expired.");
  }
  if (new Date(String(preview.expires_at)).getTime() <= Date.now()) {
    throw new Error("Invite not found or expired.");
  }

  const inviteEmail = String(preview.email);
  if (getUserWithPasswordByEmail(inviteEmail)) {
    throw new Error("Пользователь с таким email уже существует.");
  }

  const passwordHash = await hashPassword(input.password);
  const now = nowIso();
  const userId = newId();
  const role = String(preview.role) as AppRole;
  if (role === "owner") {
    throw new Error("Owner invite is not supported.");
  }

  const user: UserRecord = {
    id: userId,
    email: inviteEmail,
    displayName: input.displayName.trim() || role,
    status: "active",
    createdAt: now,
    updatedAt: now
  };
  const membership: WorkspaceMemberRecord = {
    id: newId(),
    workspaceId: String(preview.workspace_id),
    userId,
    role,
    createdAt: now,
    updatedAt: now
  };
  const sessionToken = randomBytes(32).toString("hex");
  const session: AuthSessionRecord = {
    id: newId(),
    workspaceId: membership.workspaceId,
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    createdAt: now,
    lastSeenAt: now,
    userAgent: input.userAgent ?? null,
    ipAddress: input.ipAddress ?? null
  };

  runInTransaction((db) => {
    const inviteRow = db
      .prepare("SELECT * FROM workspace_invites WHERE token_hash = ? AND accepted_at IS NULL")
      .get(tokenHash) as Record<string, unknown> | undefined;
    if (!inviteRow) {
      throw new Error("Invite not found or expired.");
    }
    if (new Date(String(inviteRow.expires_at)).getTime() <= Date.now()) {
      throw new Error("Invite not found or expired.");
    }
    const existingUser = db
      .prepare("SELECT id FROM users WHERE email = ? LIMIT 1")
      .get(inviteEmail) as Record<string, unknown> | undefined;
    if (existingUser) {
      throw new Error("Пользователь с таким email уже существует.");
    }

    db.prepare(
      "INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      user.id,
      user.email,
      passwordHash,
      user.displayName,
      user.status,
      user.createdAt,
      user.updatedAt
    );
    db.prepare(
      "INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      membership.id,
      membership.workspaceId,
      membership.userId,
      membership.role,
      membership.createdAt,
      membership.updatedAt
    );
    db.prepare(
      "INSERT INTO auth_sessions (id, workspace_id, user_id, session_token_hash, expires_at, created_at, last_seen_at, user_agent, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      session.id,
      session.workspaceId,
      session.userId,
      hashToken(sessionToken),
      session.expiresAt,
      session.createdAt,
      session.lastSeenAt,
      session.userAgent,
      session.ipAddress
    );
    db.prepare("UPDATE workspace_invites SET accepted_at = ? WHERE id = ?").run(
      now,
      String(inviteRow.id)
    );
    db.prepare(
      "DELETE FROM workspace_invites WHERE workspace_id = ? AND email = ? AND accepted_at IS NULL AND id != ?"
    ).run(membership.workspaceId, inviteEmail, String(inviteRow.id));
  });

  return {
    workspace,
    user,
    membership,
    session,
    sessionToken
  };
}

export async function ensureWorkspaceSeeded(workspaceId: string, ownerUserId: string): Promise<void> {
  const db = getDb();
  const channelCount = Number(
    (db.prepare("SELECT COUNT(*) as count FROM channels WHERE workspace_id = ?").get(workspaceId) as
      | Record<string, unknown>
      | undefined)?.count ?? 0
  );
  if (channelCount > 0) {
    return;
  }

  const raw = await fs.readFile(STORE_PATH, "utf-8").catch(() => null);
  if (!raw) {
    const now = nowIso();
    db.prepare(
      `INSERT INTO channels
      (id, workspace_id, creator_user_id, name, username, system_prompt, description_prompt, examples_json, stage2_worker_profile_id, stage2_prompt_config_json, template_id, avatar_asset_id, default_background_asset_id, default_music_asset_id, created_at, updated_at, archived_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, ?, ?, NULL)`
    ).run(
      newId(),
      workspaceId,
      ownerUserId,
      "Default",
      "science_snack",
      "",
      "",
      "[]",
      null,
      DEFAULT_TEMPLATE_ID,
      now,
      now
    );
    return;
  }

  const parsed = JSON.parse(raw) as LegacyStore;
  const legacyChannels = Array.isArray(parsed.channels) ? parsed.channels : [];
  const legacyAssets = Array.isArray(parsed.channelAssets) ? parsed.channelAssets : [];
  const legacyThreads = Array.isArray(parsed.threads) ? parsed.threads : [];
  const importedChannelIds = new Set<string>();

  runInTransaction((tx) => {
    for (const rawChannel of legacyChannels) {
      if (!rawChannel || typeof rawChannel !== "object") {
        continue;
      }
      const channel = rawChannel as LegacyChannel;
      if (!channel.id || typeof channel.id !== "string") {
        continue;
      }
      importedChannelIds.add(channel.id);
      tx.prepare(
        `INSERT INTO channels
        (id, workspace_id, creator_user_id, name, username, system_prompt, description_prompt, examples_json, stage2_worker_profile_id, stage2_prompt_config_json, template_id, avatar_asset_id, default_background_asset_id, default_music_asset_id, created_at, updated_at, archived_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL)`
      ).run(
        channel.id,
        workspaceId,
        ownerUserId,
        channel.name,
        channel.username,
        channel.systemPrompt,
        channel.descriptionPrompt,
        channel.examplesJson,
        null,
        channel.templateId || DEFAULT_TEMPLATE_ID,
        channel.avatarAssetId,
        channel.defaultBackgroundAssetId,
        channel.defaultMusicAssetId,
        channel.createdAt || nowIso(),
        channel.updatedAt || nowIso()
      );
    }

    if (importedChannelIds.size === 0) {
      const now = nowIso();
      const channelId = newId();
      importedChannelIds.add(channelId);
      tx.prepare(
        `INSERT INTO channels
        (id, workspace_id, creator_user_id, name, username, system_prompt, description_prompt, examples_json, stage2_worker_profile_id, stage2_prompt_config_json, template_id, avatar_asset_id, default_background_asset_id, default_music_asset_id, created_at, updated_at, archived_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, ?, ?, NULL)`
      ).run(
        channelId,
        workspaceId,
        ownerUserId,
        "Default",
        "science_snack",
        "",
        "",
        "[]",
        null,
        DEFAULT_TEMPLATE_ID,
        now,
        now
      );
    }

    for (const rawAsset of legacyAssets) {
      if (!rawAsset || typeof rawAsset !== "object") {
        continue;
      }
      const asset = rawAsset as LegacyChannelAsset;
      if (!importedChannelIds.has(asset.channelId)) {
        continue;
      }
      tx.prepare(
        `INSERT INTO channel_assets
        (id, workspace_id, channel_id, kind, file_name, original_name, mime_type, size_bytes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        asset.id,
        workspaceId,
        asset.channelId,
        asset.kind,
        asset.fileName,
        asset.originalName,
        asset.mimeType,
        asset.sizeBytes,
        asset.createdAt || nowIso()
      );
    }

    for (const rawThread of legacyThreads) {
      if (!rawThread || typeof rawThread !== "object") {
        continue;
      }
      const thread = rawThread as LegacyChatThread;
      const channelId = importedChannelIds.has(thread.channelId)
        ? thread.channelId
        : Array.from(importedChannelIds)[0];
      tx.prepare(
        `INSERT INTO chat_threads (id, workspace_id, channel_id, url, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        thread.id,
        workspaceId,
        channelId,
        thread.url,
        thread.title,
        thread.createdAt || nowIso(),
        thread.updatedAt || thread.createdAt || nowIso()
      );
      const events = Array.isArray(thread.events) ? thread.events : [];
      for (const rawEvent of events) {
        if (!rawEvent || typeof rawEvent !== "object") {
          continue;
        }
        const event = rawEvent as LegacyChatEvent;
        tx.prepare(
          `INSERT INTO chat_events (id, thread_id, role, type, text, data_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          event.id,
          thread.id,
          event.role,
          event.type,
          event.text,
          event.data === undefined ? null : JSON.stringify(event.data),
          event.createdAt || nowIso()
        );
      }
    }
  });
}

export function getRequestMetadata(request: Request): { userAgent: string | null; ipAddress: string | null } {
  return {
    userAgent: request.headers.get("user-agent"),
    ipAddress:
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip")?.trim() ||
      null
  };
}

export function validateInviteRole(roleRaw: string | null | undefined): AppRole | null {
  if (
    roleRaw === "owner" ||
    roleRaw === "manager" ||
    roleRaw === "redactor" ||
    roleRaw === "redactor_limited"
  ) {
    return roleRaw;
  }
  return null;
}
