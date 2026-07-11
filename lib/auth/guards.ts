import { getAuthContextFromRequest, getCurrentAuthContext } from "./session";
import { AppRole, getWorkspaceCodexIntegration } from "../team-store";
import { getChannelAccessForUser, getChannelById } from "../chat-history";
import { resolveChannelPermissions } from "../acl";
import { authenticateMcpControlWriteToken, authenticateMcpFlowReadToken } from "../mcp-token-store";
import {
  authenticateMcpMachineCredentialForScope,
  type McpMachineCredentialScope
} from "../mcp-machine-credential-store";

export async function requireAuth(request?: Request) {
  const auth = request ? await getAuthContextFromRequest(request) : await getCurrentAuthContext();
  if (!auth) {
    throw new Response(JSON.stringify({ error: "Требуется авторизация." }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }
  return auth;
}

export function requireRole(role: AppRole, currentRole: AppRole): void {
  if (currentRole !== role) {
    throw new Response(JSON.stringify({ error: "Доступ запрещен." }), {
      status: 403,
      headers: { "Content-Type": "application/json" }
    });
  }
}

export async function requireOwner(request?: Request) {
  const auth = await requireAuth(request);
  requireRole("owner", auth.membership.role);
  return auth;
}

export async function requireOwnerOrMcpFlowRead(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  if (bearer) {
    const tokenAuth = authenticateMcpFlowReadToken(bearer);
    if (tokenAuth) {
      return {
        actor: "mcp_token" as const,
        workspace: tokenAuth.workspace,
        user: tokenAuth.user,
        token: tokenAuth.token
      };
    }
    const machineAuth = authenticateMcpMachineCredentialForScope(bearer, "flow:read");
    if (machineAuth) {
      return {
        actor: "mcp_machine" as const,
        workspace: machineAuth.workspace,
        user: machineAuth.user,
        credential: machineAuth.credential
      };
    }
  }

  const auth = await requireOwner(request);
  return {
    actor: "owner_session" as const,
    workspace: auth.workspace,
    user: auth.user,
    membership: auth.membership
  };
}

export async function requireOwnerOrMcpControlWrite(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  if (bearer) {
    const tokenAuth = authenticateMcpControlWriteToken(bearer);
    if (tokenAuth) {
      return {
        actor: "mcp_token" as const,
        workspace: tokenAuth.workspace,
        user: tokenAuth.user,
        token: tokenAuth.token
      };
    }
    const machineAuth = authenticateMcpMachineCredentialForScope(bearer, "control:write");
    if (machineAuth) {
      return {
        actor: "mcp_machine" as const,
        workspace: machineAuth.workspace,
        user: machineAuth.user,
        credential: machineAuth.credential
      };
    }
  }

  const auth = await requireOwner(request);
  return {
    actor: "owner_session" as const,
    workspace: auth.workspace,
    user: auth.user,
    membership: auth.membership
  };
}

export async function requireOwnerOrMcpMachineScope(request: Request, requiredScope: McpMachineCredentialScope) {
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  if (bearer) {
    const machineAuth = authenticateMcpMachineCredentialForScope(bearer, requiredScope);
    if (machineAuth) {
      return {
        actor: "mcp_machine" as const,
        workspace: machineAuth.workspace,
        user: machineAuth.user,
        credential: machineAuth.credential
      };
    }
  }

  const auth = await requireOwner(request);
  return {
    actor: "owner_session" as const,
    workspace: auth.workspace,
    user: auth.user,
    membership: auth.membership
  };
}

export async function requireAuthOrMcpMachineScope(request: Request, requiredScope: McpMachineCredentialScope) {
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  if (bearer) {
    const machineAuth = authenticateMcpMachineCredentialForScope(bearer, requiredScope);
    if (machineAuth) {
      return {
        actor: "mcp_machine" as const,
        workspace: machineAuth.workspace,
        user: machineAuth.user,
        credential: machineAuth.credential
      };
    }
  }

  const auth = await requireAuth(request);
  return {
    actor: "user_session" as const,
    ...auth
  };
}

export function requireOneOfRoles(roles: AppRole[], currentRole: AppRole): void {
  if (!roles.includes(currentRole)) {
    throw new Response(JSON.stringify({ error: "Доступ запрещен." }), {
      status: 403,
      headers: { "Content-Type": "application/json" }
    });
  }
}

export async function requireChannelVisibility(auth: Awaited<ReturnType<typeof requireAuth>>, channelId: string) {
  const channel = await getChannelById(channelId);
  if (!channel || channel.workspaceId !== auth.workspace.id) {
    throw new Response(JSON.stringify({ error: "Канал не найден." }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }
  const grant = await getChannelAccessForUser(channelId, auth.user.id);
  const permissions = resolveChannelPermissions({
    membership: auth.membership,
    channel: { id: channel.id, creatorUserId: channel.creatorUserId },
    explicitAccess: grant
  });
  if (!permissions.isVisible) {
    throw new Response(JSON.stringify({ error: "Доступ запрещен." }), {
      status: 403,
      headers: { "Content-Type": "application/json" }
    });
  }
  return { channel, permissions };
}

export async function requireChannelOperate(auth: Awaited<ReturnType<typeof requireAuth>>, channelId: string) {
  const { channel, permissions } = await requireChannelVisibility(auth, channelId);
  if (!permissions.canOperate) {
    throw new Response(JSON.stringify({ error: "Доступ запрещен." }), {
      status: 403,
      headers: { "Content-Type": "application/json" }
    });
  }
  return { channel, permissions };
}

export async function requireChannelSetupEdit(auth: Awaited<ReturnType<typeof requireAuth>>, channelId: string) {
  const { channel, permissions } = await requireChannelVisibility(auth, channelId);
  if (!permissions.canEditSetup) {
    throw new Response(JSON.stringify({ error: "Доступ запрещен." }), {
      status: 403,
      headers: { "Content-Type": "application/json" }
    });
  }
  return { channel, permissions };
}

export async function requireChannelAccessManage(auth: Awaited<ReturnType<typeof requireAuth>>, channelId: string) {
  const { channel, permissions } = await requireChannelVisibility(auth, channelId);
  if (!permissions.canManageAccess) {
    throw new Response(JSON.stringify({ error: "Доступ запрещен." }), {
      status: 403,
      headers: { "Content-Type": "application/json" }
    });
  }
  return { channel, permissions };
}

export function requireSharedCodexAvailable(workspaceId: string) {
  const integration = getWorkspaceCodexIntegration(workspaceId);
  if (!integration || integration.status !== "connected" || !integration.codexHomePath) {
    throw new Response(JSON.stringify({ error: "shared_codex_unavailable" }), {
      status: 412,
      headers: { "Content-Type": "application/json" }
    });
  }
  return integration;
}
