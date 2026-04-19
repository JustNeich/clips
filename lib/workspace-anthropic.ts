import type { AuthContext } from "./team-store";
import {
  getWorkspaceAnthropicIntegration,
  upsertWorkspaceAnthropicIntegration,
  type WorkspaceAnthropicIntegrationRecord
} from "./team-store";
import { testAnthropicApiKey } from "./anthropic-client";

function buildDisconnectedAnthropicState(
  auth: AuthContext
): WorkspaceAnthropicIntegrationRecord {
  return {
    id: "workspace-anthropic-disconnected",
    workspaceId: auth.workspace.id,
    provider: "anthropic",
    status: "disconnected",
    ownerUserId: auth.user.id,
    apiKeyHint: null,
    lastError: null,
    connectedAt: null,
    updatedAt: auth.workspace.updatedAt
  };
}

export async function getWorkspaceAnthropicStatus(
  auth: AuthContext
): Promise<WorkspaceAnthropicIntegrationRecord> {
  return getWorkspaceAnthropicIntegration(auth.workspace.id) ?? buildDisconnectedAnthropicState(auth);
}

export async function mutateWorkspaceAnthropicIntegration(input: {
  auth: AuthContext;
  action: "save" | "disconnect";
  apiKey?: string | null;
  model?: string | null;
}): Promise<WorkspaceAnthropicIntegrationRecord> {
  if (input.auth.membership.role !== "owner") {
    throw new Error("Only owner can manage Anthropic caption integration.");
  }

  if (input.action === "disconnect") {
    return upsertWorkspaceAnthropicIntegration({
      workspaceId: input.auth.workspace.id,
      ownerUserId: input.auth.user.id,
      status: "disconnected",
      apiKey: null,
      lastError: null,
      connectedAt: null
    });
  }

  const apiKey = input.apiKey?.trim() ?? "";
  const model = input.model?.trim() ?? "";
  if (!apiKey) {
    throw new Error("Введите Anthropic API key.");
  }
  if (!model) {
    throw new Error("Укажите Anthropic model для проверки.");
  }

  try {
    await testAnthropicApiKey({ apiKey, model });
    return upsertWorkspaceAnthropicIntegration({
      workspaceId: input.auth.workspace.id,
      ownerUserId: input.auth.user.id,
      status: "connected",
      apiKey,
      lastError: null,
      connectedAt: new Date().toISOString()
    });
  } catch (error) {
    return upsertWorkspaceAnthropicIntegration({
      workspaceId: input.auth.workspace.id,
      ownerUserId: input.auth.user.id,
      status: "error",
      apiKey,
      lastError: error instanceof Error ? error.message : "Не удалось проверить Anthropic API key.",
      connectedAt: null
    });
  }
}
