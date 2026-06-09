import type { ChatEvent, ChatThread, Channel } from "./chat-history";
import type { ChatTraceExport } from "./chat-trace-export";
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

export function canInspectChannelStage2Setup(input: {
  role: AppRole | null | undefined;
  canEditSetup?: boolean;
}): boolean {
  return (
    canInspectSensitiveArtifacts(input.role) ||
    (input.role === "redactor" && input.canEditSetup === true)
  );
}

export const canInspectChannelPromptConfig = canInspectChannelStage2Setup;

export function sanitizeChannelForRole<T extends Channel>(
  channel: T,
  role: AppRole,
  options: { allowChannelStage2Setup?: boolean; allowChannelPromptConfig?: boolean } = {}
): T {
  if (canInspectSensitiveArtifacts(role)) {
    return channel;
  }

  const allowChannelStage2Setup =
    role === "redactor" &&
    (options.allowChannelStage2Setup || options.allowChannelPromptConfig);

  return {
    ...channel,
    systemPrompt: "",
    descriptionPrompt: "",
    examplesJson: "[]",
    stage2ExamplesConfig: allowChannelStage2Setup ? channel.stage2ExamplesConfig : undefined,
    stage2HardConstraints: allowChannelStage2Setup ? channel.stage2HardConstraints : undefined,
    stage2PromptConfig:
      allowChannelStage2Setup ? channel.stage2PromptConfig : undefined,
    stage2StyleProfile: undefined,
    stage2SourceOverlayConfig:
      allowChannelStage2Setup ? channel.stage2SourceOverlayConfig : undefined
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

export function sanitizeChatTraceExportForRole(trace: ChatTraceExport, role: AppRole): ChatTraceExport {
  if (canInspectSensitiveArtifacts(role)) {
    return trace;
  }

  const sanitized = JSON.parse(JSON.stringify(trace)) as ChatTraceExport;
  const stage2 = sanitized.stage2;

  sanitized.channel.stage2ExamplesConfig = null;
  sanitized.channel.stage2HardConstraints = null;

  stage2.causalInputs.run.userInstruction = null;
  stage2.causalInputs.channelSnapshotUsed.stage2WorkerProfileId = null;
  stage2.causalInputs.channelSnapshotUsed.hardConstraints = null;
  stage2.causalInputs.channelSnapshotUsed.examplesConfig = null;
  stage2.causalInputs.workerProfile = {
    requestedId: null,
    resolvedId: null,
    label: null,
    description: null,
    summary: null,
    origin: null
  };
  stage2.causalInputs.stylePrior = {
    selectedDirectionIds: [],
    selectedDirections: [],
    explorationShare: 0,
    referenceInfluenceSummary: ""
  };
  stage2.causalInputs.editorialMemory = null;
  stage2.causalInputs.editorialMemorySource = null;

  stage2.stageManifests = stage2.stageManifests.map((manifest) => ({
    ...manifest,
    promptSource: undefined,
    promptCompatibilityFamily: null,
    promptCompatibilityVersion: null,
    defaultPromptHash: null,
    configuredPromptHash: null,
    overrideAccepted: undefined,
    overrideRejectedReason: null,
    overrideCandidatePresent: undefined,
    promptTextPresent: false,
    inputManifest: null
  }));
  stage2.execution = {
    ...stage2.execution,
    featureFlags: null,
    workerBuild: null,
    promptPolicyVersion: null
  };
  stage2.outcome = {
    ...stage2.outcome,
    examplesRoleSummary: null,
    primaryDriverSummary: null,
    rationaleInternalRaw: null,
    rationaleInternalModelRaw: null,
    topSignalSummary: null
  };
  stage2.nativeCaptionV3 = {
    ...stage2.nativeCaptionV3,
    contextPacket: null,
    candidateBatch: [],
    hardValidator: null,
    qualityCourt: null,
    repair: null,
    templateBackfill: null,
    titleWriter: null,
    captionTranslation: null,
    translation: null
  };
  stage2.examplesRuntimeUsage = {
    ...stage2.examplesRuntimeUsage,
    selectedExamples: [],
    rejectedExamples: [],
    explanation: null,
    evidence: [],
    examplesRoleSummary: null,
    primaryDriverSummary: null,
    primaryDrivers: []
  };
  stage2.vnext = {
    ...stage2.vnext,
    stageOutputs: null,
    exampleRouting: null,
    candidateLineage: [],
    criticGate: null
  };
  stage2.currentResult = sanitizeStage2ResponseForRole(stage2.currentResult, role);
  stage2.analysis = null;
  stage2.effectivePrompting = null;
  stage2.examples = null;
  stage2.selection = null;
  stage2.runs = stage2.runs.map((run) => {
    const output = { ...run } as Record<string, unknown>;
    output.userInstruction = null;
    if (output.request && typeof output.request === "object") {
      const request = { ...(output.request as Record<string, unknown>) };
      request.userInstruction = null;
      if (request.channel && typeof request.channel === "object") {
        request.channel = {
          ...(request.channel as Record<string, unknown>),
          stage2WorkerProfileId: null,
          hardConstraints: null,
          examplesConfig: null,
          promptConfig: null,
          editorialMemory: null,
          editorialMemorySource: null
        };
      }
      output.request = request;
    }
    if (output.result) {
      output.result = sanitizeStage2ResponseForRole(output.result as Stage2Response, role);
    }
    return output as unknown as typeof run;
  });
  stage2.workspaceDefaults = {
    examplesCorpusJson: "[]",
    hardConstraints: null,
    promptConfig: null
  };
  sanitized.thread.events = sanitized.thread.events.map((event) => {
    if (event.type !== "stage2" || !isStage2EventData(event.data)) {
      return event;
    }
    return {
      ...event,
      data: sanitizeStage2ResponseForRole(event.data, role)
    };
  });

  return sanitized;
}
