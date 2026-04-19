import type { AuthContext } from "./team-store";
import {
  getWorkspaceStage2CaptionProviderConfig,
  getWorkspaceOpenRouterIntegration,
  updateWorkspaceStage2CaptionProviderConfig,
  upsertWorkspaceOpenRouterIntegration,
  type WorkspaceOpenRouterIntegrationRecord
} from "./team-store";
import { testOpenRouterApiKey } from "./openrouter-client";

function buildDisconnectedOpenRouterState(
  auth: AuthContext
): WorkspaceOpenRouterIntegrationRecord {
  return {
    id: "workspace-openrouter-disconnected",
    workspaceId: auth.workspace.id,
    provider: "openrouter",
    status: "disconnected",
    ownerUserId: auth.user.id,
    apiKeyHint: null,
    lastError: null,
    connectedAt: null,
    updatedAt: auth.workspace.updatedAt
  };
}

export async function getWorkspaceOpenRouterStatus(
  auth: AuthContext
): Promise<WorkspaceOpenRouterIntegrationRecord> {
  return getWorkspaceOpenRouterIntegration(auth.workspace.id) ?? buildDisconnectedOpenRouterState(auth);
}

export async function mutateWorkspaceOpenRouterIntegration(input: {
  auth: AuthContext;
  action: "save" | "disconnect";
  apiKey?: string | null;
  model?: string | null;
}): Promise<WorkspaceOpenRouterIntegrationRecord> {
  if (input.auth.membership.role !== "owner") {
    throw new Error("Only owner can manage OpenRouter caption integration.");
  }

  if (input.action === "disconnect") {
    const disconnected = upsertWorkspaceOpenRouterIntegration({
      workspaceId: input.auth.workspace.id,
      ownerUserId: input.auth.user.id,
      status: "disconnected",
      apiKey: null,
      lastError: null,
      connectedAt: null
    });
    const captionProviderConfig = getWorkspaceStage2CaptionProviderConfig(input.auth.workspace.id);
    if (captionProviderConfig.provider === "openrouter") {
      updateWorkspaceStage2CaptionProviderConfig(input.auth.workspace.id, {
        ...captionProviderConfig,
        provider: "codex"
      });
    }
    return disconnected;
  }

  const apiKey = input.apiKey?.trim() ?? "";
  const model = input.model?.trim() ?? "";
  if (!apiKey) {
    throw new Error("Введите OpenRouter API key.");
  }
  if (!model) {
    throw new Error("Укажите OpenRouter model для проверки.");
  }

  try {
    await testOpenRouterApiKey({ apiKey, model });
    return upsertWorkspaceOpenRouterIntegration({
      workspaceId: input.auth.workspace.id,
      ownerUserId: input.auth.user.id,
      status: "connected",
      apiKey,
      lastError: null,
      connectedAt: new Date().toISOString()
    });
  } catch (error) {
    return upsertWorkspaceOpenRouterIntegration({
      workspaceId: input.auth.workspace.id,
      ownerUserId: input.auth.user.id,
      status: "error",
      apiKey,
      lastError: error instanceof Error ? error.message : "Не удалось проверить OpenRouter API key.",
      connectedAt: null
    });
  }
}
