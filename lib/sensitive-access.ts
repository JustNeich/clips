import type { ChatEvent, ChatThread, Channel } from "./chat-history";
import type { AppRole, AuthContext, WorkspaceRecord } from "./team-store";
import type { ChannelPublishIntegration, Stage2Response } from "../app/components/types";

type Stage2ResponseWithDebugArtifact = Stage2Response & {
  rawDebugArtifact?: unknown;
};

type SerializableChat = ChatThread & {
  events: ChatEvent[];
};

export function canInspectSensitiveArtifacts(role: AppRole | null | undefined): boolean {
  return role === "owner" || role === "manager";
}

export function requireSensitiveArtifactAccess(auth: AuthContext): void {
  if (canInspectSensitiveArtifacts(auth.membership.role)) {
    return;
  }

  throw new Response(JSON.stringify({ error: "Доступ запрещен." }), {
    status: 403,
    headers: { "Content-Type": "application/json" }
  });
}

export function sanitizeWorkspaceForRole<T extends WorkspaceRecord>(
  workspace: T,
  role: AppRole
): T {
  if (canInspectSensitiveArtifacts(role)) {
    return workspace;
  }

  return {
    ...workspace,
    stage2ExamplesCorpusJson: "[]",
    stage2HardConstraints: undefined,
    stage2PromptConfig: undefined,
    codexModelConfig: undefined,
    stage2CaptionProviderConfig: undefined
  } as T;
}

export function sanitizeChannelForRole<T extends Channel>(channel: T, role: AppRole): T {
  if (canInspectSensitiveArtifacts(role)) {
    return channel;
  }

  return {
    ...channel,
    systemPrompt: "",
    descriptionPrompt: "",
    examplesJson: "[]",
    stage2ExamplesConfig: undefined,
    stage2HardConstraints: undefined,
    stage2PromptConfig: undefined,
    stage2StyleProfile: undefined,
    stage2SourceOverlayConfig: undefined
  } as T;
}

export function sanitizePublishIntegrationForRole(
  integration: ChannelPublishIntegration | null,
  role: AppRole
): ChannelPublishIntegration | null {
  if (!integration || canInspectSensitiveArtifacts(role)) {
    return integration;
  }

  return {
    ...integration,
    youtubeOAuthClientKey: "",
    youtubeOAuthProjectNumber: null,
    youtubeOAuthDailyUploadBudget: null,
    selectedYoutubeChannelId: null,
    selectedGoogleAccountEmail: null,
    availableChannels: [],
    scopes: [],
    lastError: null
  };
}

export function sanitizeStage2ResponseForRole(
  response: Stage2Response | null,
  role: AppRole
): Stage2Response | null {
  if (!response || canInspectSensitiveArtifacts(role)) {
    return response;
  }

  const output: Stage2Response["output"] = {
    ...response.output,
    pipeline: undefined
  };
  const source: Stage2Response["source"] = {
    ...response.source,
    commentsUsedForPrompt: 0,
    commentsOmittedFromPrompt: undefined,
    frameDescriptions: undefined
  };
  const sanitized: Stage2ResponseWithDebugArtifact = {
    ...response,
    source,
    output,
    diagnostics: undefined,
    tokenUsage: undefined,
    debugMode: undefined,
    debugRef: null,
    model: undefined,
    reasoningEffort: undefined,
    userInstructionUsed: undefined,
    stage2Spec: undefined,
    stage2Worker: undefined
  };
  delete sanitized.rawDebugArtifact;
  return sanitized;
}

function isStage2EventData(data: unknown): data is Stage2Response {
  if (!data || typeof data !== "object") {
    return false;
  }
  const candidate = data as Partial<Stage2Response>;
  return Boolean(candidate.output && typeof candidate.output === "object");
}

export function sanitizeChatForRole<T extends SerializableChat>(chat: T, role: AppRole): T {
  if (canInspectSensitiveArtifacts(role)) {
    return chat;
  }

  return {
    ...chat,
    events: chat.events.map((event) => {
      if (event.type !== "stage2" || !isStage2EventData(event.data)) {
        return event;
      }
      return {
        ...event,
        data: sanitizeStage2ResponseForRole(event.data, role)
      };
    })
  };
}
