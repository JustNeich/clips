import { promises as fs } from "node:fs";
import { cancelDeviceAuth, getCombinedCodexAuthState, startDeviceAuth } from "./codex-auth";
import { ensureCodexHomeForSession, createCodexSessionId } from "./codex-session";
import { ensureCodexLoggedIn } from "./codex-runner";
import {
  AppRole,
  AuthContext,
  getWorkspaceCodexIntegration,
  upsertWorkspaceCodexIntegration,
  type WorkspaceCodexIntegrationRecord
} from "./team-store";

export async function getWorkspaceCodexStatus(
  auth: AuthContext
): Promise<WorkspaceCodexIntegrationRecord | null> {
  const current = getWorkspaceCodexIntegration(auth.workspace.id);
  if (!current || !current.codexSessionId || !current.codexHomePath) {
    return current;
  }

  const state = await getCombinedCodexAuthState(current.codexSessionId, current.codexHomePath);
  return upsertWorkspaceCodexIntegration({
    workspaceId: auth.workspace.id,
    ownerUserId: current.ownerUserId,
    status: state.loggedIn
      ? "connected"
      : state.deviceAuth.status === "running"
        ? "connecting"
        : current.status === "error"
          ? "error"
          : "disconnected",
    codexSessionId: current.codexSessionId,
    codexHomePath: current.codexHomePath,
    loginStatusText: state.loginStatusText,
    deviceAuthStatus: state.deviceAuth.status,
    deviceAuthOutput: state.deviceAuth.output,
    deviceAuthLoginUrl: state.deviceAuth.loginUrl,
    deviceAuthUserCode: state.deviceAuth.userCode,
    connectedAt: state.loggedIn ? current.connectedAt ?? new Date().toISOString() : current.connectedAt
  });
}

export async function mutateWorkspaceCodexIntegration(input: {
  auth: AuthContext;
  action: "start" | "cancel" | "refresh" | "disconnect";
}): Promise<WorkspaceCodexIntegrationRecord | null> {
  if (input.auth.membership.role !== "owner") {
    throw new Error("Only owner can manage shared Codex integration.");
  }
  const current = getWorkspaceCodexIntegration(input.auth.workspace.id);

  if (input.action === "disconnect") {
    if (current?.codexSessionId) {
      cancelDeviceAuth(current.codexSessionId);
    }
    if (current?.codexHomePath) {
      await fs.rm(current.codexHomePath, { recursive: true, force: true }).catch(() => undefined);
    }
    return upsertWorkspaceCodexIntegration({
      workspaceId: input.auth.workspace.id,
      ownerUserId: input.auth.user.id,
      status: "disconnected",
      codexSessionId: null,
      codexHomePath: null,
      loginStatusText: "Отключен",
      deviceAuthStatus: "idle",
      deviceAuthOutput: "",
      deviceAuthLoginUrl: null,
      deviceAuthUserCode: null,
      connectedAt: null
    });
  }

  const codexSessionId = current?.codexSessionId ?? createCodexSessionId();
  const codexHome = await ensureCodexHomeForSession(codexSessionId);

  if (input.action === "start") {
    const device = await startDeviceAuth(codexSessionId, codexHome);
    return upsertWorkspaceCodexIntegration({
      workspaceId: input.auth.workspace.id,
      ownerUserId: input.auth.user.id,
      status: "connecting",
      codexSessionId,
      codexHomePath: codexHome,
      loginStatusText: current?.loginStatusText ?? "Device auth запущен",
      deviceAuthStatus: device.status,
      deviceAuthOutput: device.output,
      deviceAuthLoginUrl: device.loginUrl,
      deviceAuthUserCode: device.userCode
    });
  }

  if (input.action === "cancel") {
    cancelDeviceAuth(codexSessionId);
  }

  const refreshed = await getCombinedCodexAuthState(codexSessionId, codexHome);
  return upsertWorkspaceCodexIntegration({
    workspaceId: input.auth.workspace.id,
    ownerUserId: input.auth.user.id,
    status: refreshed.loggedIn
      ? "connected"
      : refreshed.deviceAuth.status === "running"
        ? "connecting"
        : refreshed.deviceAuth.status === "error"
          ? "error"
          : "disconnected",
    codexSessionId,
    codexHomePath: codexHome,
    loginStatusText: refreshed.loginStatusText,
    deviceAuthStatus: refreshed.deviceAuth.status,
    deviceAuthOutput: refreshed.deviceAuth.output,
    deviceAuthLoginUrl: refreshed.deviceAuth.loginUrl,
    deviceAuthUserCode: refreshed.deviceAuth.userCode,
    connectedAt: refreshed.loggedIn ? current?.connectedAt ?? new Date().toISOString() : current?.connectedAt ?? null
  });
}

export async function requireWorkspaceCodexHome(workspaceId: string): Promise<string> {
  const integration = getWorkspaceCodexIntegration(workspaceId);
  if (!integration?.codexHomePath) {
    throw new Error("shared_codex_unavailable");
  }
  await ensureCodexLoggedIn(integration.codexHomePath);
  return integration.codexHomePath;
}
