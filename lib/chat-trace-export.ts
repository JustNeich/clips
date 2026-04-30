import type {
  ChatDraft,
  ChatEvent,
  ChatRenderExportRef,
  ChatThread,
  CommentItem,
  CommentsPayload,
  SourceJobDetail,
  SourceJobResult,
  Stage2Response,
  Stage2RunDetail,
  Stage3Version
} from "../app/components/types";
import { getChatById, getChatDraft, getChannelById } from "./chat-history";
import { findLatestRenderExport } from "./chat-workflow";
import { findLatestStage3AgentSessionRef, buildLegacyTimelineEntries, type Stage3AgentSessionRef } from "./stage3-legacy-bridge";
import { normalizeStage2ProgressSnapshot } from "./stage2-pipeline";
import { buildStage2ToStage3HandoffSummary, type Stage2ToStage3HandoffSummary } from "./stage2-stage3-handoff";
import {
  getSelectedStage2StyleDirections,
  normalizeStage2EditorialMemorySummary,
  normalizeStage2StyleProfile
} from "./stage2-channel-learning";
import { normalizeStage2EditorialMemorySource } from "./stage2-editorial-memory-resolution";
import { resolveStage2WorkerProfile } from "./stage2-worker-profile";
import {
  getWorkspaceStage2ExamplesCorpusJson,
  getWorkspaceStage2HardConstraints,
  getWorkspaceStage2PromptConfig,
  type WorkspaceRecord
} from "./team-store";
import { listSourceJobsForChat, type SourceJobRecord } from "./source-job-store";
import { listStage2RunsForChat, type Stage2RunRecord } from "./stage2-progress-store";
import type { Stage2DiagnosticsPromptStage, Stage2PipelineExecution } from "./viral-shorts-worker/types";
import type {
  AudiencePacket,
  CandidateLineageRecord,
  ClipTruthPacket,
  ExampleRoutingDecision,
  FinalSelection as Stage2VNextFinalSelection,
  Stage2PipelineVersion,
  Stage2VNextCanonicalCounters,
  Stage2VNextCriticGate,
  Stage2VNextFeatureFlagSnapshot,
  Stage2VNextWorkerBuild
} from "./stage2-vnext/contracts";
import { MAX_EXPORTED_COMMENTS, TRACE_EXPORT_VERSION } from "./chat-trace-export-shared";

export type ChatTraceExportComments = {
  available: boolean;
  totalComments: number;
  includedCount: number;
  truncated: boolean;
  provider: Stage2Response["source"]["commentsAcquisitionProvider"] | null;
  status: Stage2Response["source"]["commentsAcquisitionStatus"] | null;
  note: string | null;
  fallbackUsed: boolean;
  error: string | null;
  items: CommentItem[];
  runtimeUsage: {
    totalExtractedCount: number;
    runtimeAvailableCount: number;
    analyzer: {
      passedCount: number;
      omittedCount: number;
      truncated: boolean;
      limit: number | null;
      passedCommentIds: string[];
    };
    selector: {
      passedCount: number;
      omittedCount: number;
      truncated: boolean;
      limit: number | null;
      passedCommentIds: string[];
    };
  };
  exportUsage: {
    includedCount: number;
    omittedCount: number;
    truncated: boolean;
    exportLimit: number;
    exportedCommentIds: string[];
  };
};

type ChatTraceExportTraceContract = {
  canonicalSections: {
    stage2CausalInputs: string;
    stage2StageManifests: string;
    stage2Execution: string;
    stage2Outcome: string;
    stage2NativeCaptionV3: string;
    stage2VNext: string;
    stage2VNextStageOutputs: string;
    stage2VNextExampleRouting: string;
    stage2VNextCanonicalCounters: string;
    stage2VNextValidation: string;
    stage2VNextCandidateLineage: string;
    stage2VNextCriticGate: string;
    commentsUsage: string;
    examplesUsage: string;
    stage2ConsistencyChecks: string;
  };
  convenienceMirrors: string[];
  note: string;
};

type ChatTraceExportConsistencyCheck = {
  id: string;
  ok: boolean;
  details: string;
};

type ChatTraceExportStageManifest = {
  stageId: string;
  label: string;
  summary: string;
  promptChars: number | null;
  reasoningEffort: string | null;
  promptSource?: Stage2DiagnosticsPromptStage["promptSource"];
  promptCompatibilityFamily?: string | null;
  promptCompatibilityVersion?: string | null;
  defaultPromptHash?: string | null;
  configuredPromptHash?: string | null;
  overrideAccepted?: boolean;
  overrideRejectedReason?: string | null;
  overrideCandidatePresent?: boolean;
  legacyFallbackBypassed?: boolean;
  usesImages: boolean;
  promptTextPresent: boolean;
  manifestSource: "runtime" | "missing";
  inputManifest: Stage2DiagnosticsPromptStage["inputManifest"] | null;
};

type ChatTraceExportOmissionSection = {
  path: string;
  availableCount: number;
  exportedCount: number;
  omittedCount: number;
  truncated: boolean;
  reason: string;
};

export type ChatTraceExport = {
  version: string;
  exportedAt: string;
  traceContract: ChatTraceExportTraceContract;
  workspace: {
    id: string;
    name: string;
    slug: string;
  };
  channel: {
    id: string;
    name: string;
    username: string;
    stage2ExamplesConfig: unknown;
    stage2HardConstraints: unknown;
    templateId: string;
  };
  chat: {
    id: string;
    title: string;
    url: string;
    createdAt: string;
    updatedAt: string;
  };
  source: {
    url: string;
    title: string | null;
    downloadProvider: Stage2Response["source"]["downloadProvider"] | null;
    primaryProviderError: string | null;
    downloadFallbackUsed: boolean;
    commentsAvailable: boolean;
    commentsError: string | null;
    totalComments: number;
    includedComments: number;
    commentsAcquisitionStatus: Stage2Response["source"]["commentsAcquisitionStatus"] | null;
    commentsAcquisitionProvider: Stage2Response["source"]["commentsAcquisitionProvider"] | null;
    commentsAcquisitionNote: string | null;
    commentsFallbackUsed: boolean;
    activeJobId: string | null;
    latestCompletedJobId: string | null;
  };
  comments: ChatTraceExportComments;
  sourceJobs: Array<SourceJobDetail & { request: SourceJobRecord["request"] }>;
  stage2: {
    selectedRunId: string | null;
    causalInputs: {
      run: {
        selectedRunId: string | null;
        mode: Stage2RunRecord["mode"] | null;
        baseRunId: string | null;
        userInstruction: string | null;
      };
      channelSnapshotUsed: {
        channelId: string | null;
        name: string | null;
        username: string | null;
        stage2WorkerProfileId: string | null;
        hardConstraints: unknown | null;
        examplesConfig: unknown | null;
      };
      workerProfile: {
        requestedId: string | null;
        resolvedId: string | null;
        label: string | null;
        description: string | null;
        summary: string | null;
        origin: "channel_setting" | "default_baseline" | null;
      };
      stylePrior: {
        selectedDirectionIds: string[];
        selectedDirections: ReturnType<typeof getSelectedStage2StyleDirections>;
        explorationShare: number;
        referenceInfluenceSummary: string;
      };
      editorialMemory: Stage2RunRecord["request"]["channel"]["editorialMemory"] | null;
      editorialMemorySource: Stage2RunRecord["request"]["channel"]["editorialMemorySource"] | null;
      sourceContext: {
        sourceUrl: string | null;
        title: string | null;
        descriptionChars: number;
        transcriptChars: number;
        speechGroundingStatus: "transcript_present" | "no_speech_detected" | "speech_uncertain";
        frameCount: number;
        runtimeCommentsAvailable: number;
        runtimeCommentIds: string[];
        commentsOmittedFromPrompt: number;
        downloadProvider: Stage2Response["source"]["downloadProvider"] | null;
        primaryProviderError: string | null;
        downloadFallbackUsed: boolean;
        commentsAcquisitionStatus: Stage2Response["source"]["commentsAcquisitionStatus"] | null;
        commentsAcquisitionProvider: Stage2Response["source"]["commentsAcquisitionProvider"] | null;
        commentsAcquisitionNote: string | null;
        commentsExtractionFallbackUsed: boolean;
      };
    };
    stageManifests: ChatTraceExportStageManifest[];
    exportOmissions: {
      comments: {
        exportLimit: number;
        sections: ChatTraceExportOmissionSection[];
      };
      notes: string[];
    };
    execution: {
      exporterVersion: string;
      resolvedAt: string | null;
      pipelineVersion: Stage2PipelineVersion | null;
      pathVariant: Stage2PipelineExecution["pathVariant"] | null;
      stageChainVersion: string | null;
      featureFlags: Stage2VNextFeatureFlagSnapshot | null;
      workerBuild: Stage2VNextWorkerBuild | null;
      legacyFallbackReason: string | null;
      promptPolicyVersion: string | null;
      selectorOutputAuthority: "authoritative" | "derived_non_authoritative" | null;
    };
    outcome: {
      retrievalConfidence: Stage2Response["diagnostics"] extends infer T
        ? T extends { examples?: { retrievalConfidence?: infer U } }
          ? U | null
          : null
        : null;
      examplesMode: Stage2Response["diagnostics"] extends infer T
        ? T extends { examples?: { examplesMode?: infer U } }
          ? U | null
          : null
        : null;
      examplesRoleSummary: string | null;
      primaryDriverSummary: string | null;
      candidateOptionMap: Array<{ option: number; candidateId: string }>;
      visibleOptionToCandidateMap: Array<{ option: number; candidateId: string }>;
      shortlistCandidateIds: string[];
      finalPickCandidateId: string | null;
      finalPickOption: number | null;
      finalPickReason: string | null;
      winnerTier: "finalist" | "recovery" | "template_backfill" | "missing" | null;
      degradedSuccess: boolean | null;
      rationaleRaw: string | null;
      rationaleInternalRaw: string | null;
      rationaleInternalModelRaw: string | null;
      topSignalSummary: Stage2Response["output"] extends infer T
        ? T extends {
            pipeline?: {
              finalSelector?: {
                shortlistStats?: {
                  topSignalSummary?: infer U;
                };
              };
            };
          }
          ? U | null
          : null
        : null;
    };
    nativeCaptionV3: {
      present: boolean;
      contextPacket: Stage2Response["output"] extends infer T
        ? T extends {
            pipeline?: {
              nativeCaptionV3?: {
                contextPacket?: infer U;
              };
            };
          }
          ? U | null
          : null
        : null;
      candidateBatch: Stage2Response["output"] extends infer T
        ? T extends {
            pipeline?: {
              nativeCaptionV3?: {
                candidateBatch?: infer U;
              };
            };
          }
          ? U | []
          : []
        : [];
      hardValidator: Stage2Response["output"] extends infer T
        ? T extends {
            pipeline?: {
              nativeCaptionV3?: {
                hardValidator?: infer U;
              };
            };
          }
          ? U | null
          : null
        : null;
      qualityCourt: Stage2Response["output"] extends infer T
        ? T extends {
            pipeline?: {
              nativeCaptionV3?: {
                qualityCourt?: infer U;
              };
            };
          }
          ? U | null
          : null
        : null;
      repair: Stage2Response["output"] extends infer T
        ? T extends {
            pipeline?: {
              nativeCaptionV3?: {
                repair?: infer U;
              };
            };
          }
          ? U | null
          : null
        : null;
      templateBackfill: Stage2Response["output"] extends infer T
        ? T extends {
            pipeline?: {
              nativeCaptionV3?: {
                templateBackfill?: infer U;
              };
            };
          }
          ? U | null
          : null
        : null;
      guardSummary: Stage2Response["output"] extends infer T
        ? T extends {
            pipeline?: {
              nativeCaptionV3?: {
                guardSummary?: infer U;
              };
            };
          }
          ? U | null
          : null
        : null;
      displayOptions: Stage2Response["output"] extends infer T
        ? T extends {
            pipeline?: {
              nativeCaptionV3?: {
                displayOptions?: infer U;
              };
            };
          }
          ? U | []
          : []
        : [];
      titleWriter: Stage2Response["output"] extends infer T
        ? T extends {
            pipeline?: {
              nativeCaptionV3?: {
                titleWriter?: infer U;
              };
            };
          }
          ? U | null
          : null
        : null;
      captionTranslation: Stage2Response["output"] extends infer T
        ? T extends {
            pipeline?: {
              nativeCaptionV3?: {
                translation?: infer U;
              };
            };
          }
          ? U | null
          : null
        : null;
      translation: Stage2Response["output"] extends infer T
        ? T extends {
            pipeline?: {
              nativeCaptionV3?: {
                translation?: infer U;
              };
            };
          }
          ? U | null
          : null
        : null;
    };
    examplesRuntimeUsage: {
      source: Stage2Response["diagnostics"] extends infer T
        ? T extends { examples?: { source?: infer U } }
          ? U | null
          : null
        : null;
      activeCorpusCount: number;
      selectorPromptPoolCount: number;
      promptPoolExampleIds: string[];
      selectedExampleIds: string[];
      rejectedExampleIds: string[];
      selectedExamples: Stage2Response["diagnostics"] extends infer T
        ? T extends { examples?: { selectedExamples?: infer U } }
          ? U
          : []
        : [];
      rejectedExamples: Stage2Response["diagnostics"] extends infer T
        ? T extends { examples?: { availableExamples?: infer U } }
          ? U
          : []
        : [];
      retrievalConfidence: Stage2Response["diagnostics"] extends infer T
        ? T extends { examples?: { retrievalConfidence?: infer U } }
          ? U | null
          : null
        : null;
      examplesMode: Stage2Response["diagnostics"] extends infer T
        ? T extends { examples?: { examplesMode?: infer U } }
          ? U | null
          : null
        : null;
      explanation: string | null;
      evidence: string[];
      retrievalWarning: string | null;
      examplesRoleSummary: string | null;
      primaryDriverSummary: string | null;
      primaryDrivers: string[];
      guidanceRoleBuckets: {
        semanticGuidanceIds: string[];
        formGuidanceIds: string[];
        weakSupportIds: string[];
      };
    };
    vnext: {
      present: boolean;
      phase: number | null;
      stageOutputs: {
        clipTruthExtractor: ClipTruthPacket | null;
        audienceMiner: AudiencePacket | null;
        rankedFinalSelector: Stage2VNextFinalSelection | null;
        memory:
          | {
              status: "disabled";
              reason: string;
            }
          | null;
      } | null;
      exampleRouting: ExampleRoutingDecision | null;
      canonicalCounters: Stage2VNextCanonicalCounters | null;
      validation: {
        ok: boolean;
        issues: string[];
        validatorsRun: string[];
      } | null;
      candidateLineage: CandidateLineageRecord[];
      criticGate: Stage2VNextCriticGate | null;
      traceMeta: {
        version: string;
        compatibilityMode: "none";
        stageChainVersion: string | null;
        pipelineVersion: Stage2PipelineVersion | null;
        workerBuild: Stage2VNextWorkerBuild | null;
      } | null;
    };
    consistencyChecks: ChatTraceExportConsistencyCheck[];
    currentResult: Stage2Response | null;
    currentProgress: Stage2Response["progress"] | null;
    analysis: Stage2Response["diagnostics"] extends infer T
      ? T extends { analysis?: infer U }
        ? U | null
        : null
      : null;
    effectivePrompting: Stage2Response["diagnostics"] extends infer T
      ? T extends { effectivePrompting?: infer U }
        ? U | null
        : null
      : null;
    examples: Stage2Response["diagnostics"] extends infer T
      ? T extends { examples?: infer U }
        ? U | null
        : null
      : null;
    selection: Stage2Response["diagnostics"] extends infer T
      ? T extends { selection?: infer U }
        ? U | null
        : null
      : null;
    runs: Array<Stage2RunDetail & { request: Stage2RunRecord["request"] }>;
    workspaceDefaults: {
      examplesCorpusJson: string;
      hardConstraints: unknown;
      promptConfig: unknown;
    };
  };
  stage3: {
    draft: ChatDraft["stage3"] | null;
    handoff: Stage2ToStage3HandoffSummary;
    latestRenderExport: ChatRenderExportRef | null;
    latestAgentSession: Stage3AgentSessionRef | null;
    legacyVersions: Stage3Version[];
  };
  thread: {
    events: ChatEvent[];
  };
  draft: ChatDraft | null;
};

type BuildChatTraceExportInput = {
  workspace: WorkspaceRecord;
  userId: string;
  chatId: string;
  selectedRunId?: string | null;
};

function sanitizeCommentsPayload(payload: CommentsPayload | null): CommentsPayload | null {
  if (!payload) {
    return null;
  }

  const topComments = Array.isArray(payload.topComments) ? payload.topComments : [];
  const limitedTopComments = topComments.slice(0, MAX_EXPORTED_COMMENTS);
  return {
    ...payload,
    topComments: limitedTopComments,
    allComments: limitedTopComments
  };
}

function getStage2SourceForExport(
  stage2: Stage2Response | null | undefined
): Partial<Stage2Response["source"]> | null {
  const source = (stage2 as { source?: Partial<Stage2Response["source"]> } | null | undefined)
    ?.source;
  return source && typeof source === "object" ? source : null;
}

function getStage2RuntimeComments(stage2: Stage2Response | null | undefined): CommentItem[] {
  const source = getStage2SourceForExport(stage2);
  const allComments = Array.isArray(source?.allComments) ? source.allComments : [];
  const usedCount =
    typeof source?.commentsUsedForPrompt === "number" && Number.isFinite(source.commentsUsedForPrompt)
      ? Math.max(0, source.commentsUsedForPrompt)
      : allComments.length;
  return allComments.slice(0, usedCount || allComments.length);
}

function sanitizeStage2ResponseForExport(stage2: Stage2Response | null): Stage2Response | null {
  if (!stage2) {
    return null;
  }

  const runtimeComments = getStage2RuntimeComments(stage2);
  const exportedComments = runtimeComments.slice(0, MAX_EXPORTED_COMMENTS);
  const sanitizedStage2 = {
    ...stage2,
    progress:
      stage2.progress !== undefined
        ? normalizeStage2ProgressSnapshot(
            stage2.progress,
            stage2.stage2Run?.runId ?? stage2.stage2Worker?.runId ?? "exported_run",
            stage2.stage2Run?.mode
          )
        : stage2.progress,
  };
  const source = getStage2SourceForExport(stage2);
  if (!source) {
    return sanitizedStage2 as Stage2Response;
  }
  return {
    ...sanitizedStage2,
    source: {
      ...source,
      topComments: exportedComments,
      allComments: exportedComments
    }
  } as Stage2Response;
}

function sanitizeSourceJobResultForExport(result: SourceJobResult | null): SourceJobResult | null {
  if (!result) {
    return null;
  }

  return {
    ...result,
    commentsPayload: sanitizeCommentsPayload(result.commentsPayload)
  };
}

function sanitizeSourceJobForExport(job: SourceJobRecord): SourceJobDetail & { request: SourceJobRecord["request"] } {
  return {
    jobId: job.jobId,
    chatId: job.chatId,
    channelId: job.channelId,
    sourceUrl: job.sourceUrl,
    status: job.status,
    progress: job.progress,
    errorMessage: job.errorMessage,
    hasResult: Boolean(job.resultData),
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
    request: job.request,
    result: sanitizeSourceJobResultForExport(job.resultData)
  };
}

function sanitizeStage2RunForExport(run: Stage2RunRecord): Stage2RunDetail & { request: Stage2RunRecord["request"] } {
  return {
    runId: run.runId,
    chatId: run.chatId,
    channelId: run.channelId,
    sourceUrl: run.sourceUrl,
    userInstruction: run.userInstruction,
    mode: run.mode,
    baseRunId: run.baseRunId,
    status: run.status,
    progress: run.snapshot,
    errorMessage: run.errorMessage ?? run.snapshot.error ?? null,
    hasResult: Boolean(run.resultData),
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    finishedAt: run.finishedAt,
    request: run.request,
    result: sanitizeStage2ResponseForExport((run.resultData ?? null) as Stage2Response | null)
  };
}

function sanitizeChatEventForExport(event: ChatEvent): ChatEvent {
  if (event.type === "comments") {
    return {
      ...event,
      data: sanitizeCommentsPayload(event.data as CommentsPayload | null)
    };
  }

  if (event.type === "stage2") {
    return {
      ...event,
      data: sanitizeStage2ResponseForExport(event.data as Stage2Response | null)
    };
  }

  return event;
}

function pickSelectedStage2Run(
  runs: Stage2RunRecord[],
  selectedRunId?: string | null
): Stage2RunRecord | null {
  const explicitSelection =
    selectedRunId && selectedRunId.trim()
      ? runs.find((run) => run.runId === selectedRunId.trim()) ?? null
      : null;
  if (explicitSelection) {
    return explicitSelection;
  }

  const activeRun = runs.find((run) => run.status === "queued" || run.status === "running") ?? null;
  if (activeRun) {
    return activeRun;
  }

  const completedRun = runs.find((run) => Boolean(run.resultData)) ?? null;
  if (completedRun) {
    return completedRun;
  }

  return runs[0] ?? null;
}

function buildTraceContract(): ChatTraceExportTraceContract {
  return {
    canonicalSections: {
      stage2CausalInputs: "stage2.causalInputs",
      stage2StageManifests: "stage2.stageManifests",
      stage2Execution: "stage2.execution",
      stage2Outcome: "stage2.outcome",
      stage2NativeCaptionV3: "stage2.nativeCaptionV3",
      stage2VNext: "stage2.vnext",
      stage2VNextStageOutputs: "stage2.vnext.stageOutputs",
      stage2VNextExampleRouting: "stage2.vnext.exampleRouting",
      stage2VNextCanonicalCounters: "stage2.vnext.canonicalCounters",
      stage2VNextValidation: "stage2.vnext.validation",
      stage2VNextCandidateLineage: "stage2.vnext.candidateLineage",
      stage2VNextCriticGate: "stage2.vnext.criticGate",
      commentsUsage: "comments.runtimeUsage",
      examplesUsage: "stage2.examplesRuntimeUsage",
      stage2ConsistencyChecks: "stage2.consistencyChecks"
    },
    convenienceMirrors: [
      "stage2.currentResult",
      "stage2.analysis",
      "stage2.selection",
      "stage2.examples",
      "stage2.effectivePrompting",
      "thread.events[*].data",
      "sourceJobs[*].result"
    ],
    note:
      "Canonical sections above are the trace's source-of-truth summaries. stage2.execution plus stage2.nativeCaptionV3 or stage2.vnext are authoritative for resolved pipeline mode, worker build, candidate decisions, repair, lineage, and validation. Existing nested result/diagnostics/raw event payloads remain as convenience mirrors only."
  };
}

function buildStageManifestSummaries(
  promptStages: Stage2DiagnosticsPromptStage[] | null | undefined
): ChatTraceExportStageManifest[] {
  return (promptStages ?? []).map((stage) => ({
    stageId: stage.stageId,
    label: stage.label,
    summary: stage.summary,
    promptChars: stage.promptChars,
    reasoningEffort: stage.reasoningEffort,
    promptSource: stage.promptSource,
    promptCompatibilityFamily: stage.promptCompatibilityFamily ?? null,
    promptCompatibilityVersion: stage.promptCompatibilityVersion ?? null,
    defaultPromptHash: stage.defaultPromptHash ?? null,
    configuredPromptHash: stage.configuredPromptHash ?? null,
    overrideAccepted: stage.overrideAccepted ?? false,
    overrideRejectedReason: stage.overrideRejectedReason ?? null,
    overrideCandidatePresent: stage.overrideCandidatePresent ?? false,
    legacyFallbackBypassed: stage.legacyFallbackBypassed ?? false,
    usesImages: stage.usesImages,
    promptTextPresent: Boolean(stage.promptText),
    manifestSource: stage.inputManifest ? "runtime" : "missing",
    inputManifest: stage.inputManifest ?? null
  }));
}

function buildStage2Execution(
  rawStage2: Stage2Response | null
): ChatTraceExport["stage2"]["execution"] {
  const execution = (rawStage2?.output.pipeline?.execution ?? null) as Stage2PipelineExecution | null;
  return {
    exporterVersion: TRACE_EXPORT_VERSION,
    resolvedAt: execution?.resolvedAt ?? null,
    pipelineVersion: execution?.pipelineVersion ?? rawStage2?.stage2Worker?.pipelineVersion ?? null,
    pathVariant: execution?.pathVariant ?? null,
    stageChainVersion: execution?.stageChainVersion ?? rawStage2?.stage2Worker?.stageChainVersion ?? null,
    featureFlags: execution?.featureFlags ?? rawStage2?.stage2Worker?.featureFlags ?? null,
    workerBuild:
      execution?.workerBuild ??
      (rawStage2?.stage2Worker?.buildId
        ? {
            buildId: rawStage2.stage2Worker.buildId,
            startedAt: rawStage2.stage2Worker.startedAt ?? "",
            pid: rawStage2.stage2Worker.pid ?? null
          }
        : null),
    legacyFallbackReason: execution?.legacyFallbackReason ?? null,
    promptPolicyVersion: execution?.promptPolicyVersion ?? null,
    selectorOutputAuthority: execution?.selectorOutputAuthority ?? null
  };
}

function buildStage2VNextCanonical(
  rawStage2: Stage2Response | null
): ChatTraceExport["stage2"]["vnext"] {
  const vnext = rawStage2?.output.pipeline?.vnext ?? null;
  return {
    present: Boolean(vnext),
    phase: vnext?.phase ?? null,
    stageOutputs: vnext
      ? {
          clipTruthExtractor: vnext.trace.stageOutputs.clipTruthExtractor,
          audienceMiner: vnext.trace.stageOutputs.audienceMiner,
          rankedFinalSelector: vnext.trace.stageOutputs.rankedFinalSelector,
          memory: vnext.trace.memory
        }
      : null,
    exampleRouting: vnext?.exampleRouting ?? null,
    canonicalCounters: vnext?.canonicalCounters ?? vnext?.trace.canonicalCounters ?? null,
    validation: vnext
      ? {
          ok: vnext.validation.ok,
          issues: vnext.validation.issues,
          validatorsRun: vnext.trace.validation.validatorsRun
        }
      : null,
    candidateLineage: vnext?.candidateLineage ?? vnext?.trace.candidateLineage ?? [],
    criticGate: vnext?.criticGate ?? vnext?.trace.criticGate ?? null,
    traceMeta: vnext
      ? {
          version: vnext.trace.meta.version,
          compatibilityMode: vnext.trace.meta.compatibilityMode,
          stageChainVersion: vnext.trace.meta.stageChainVersion,
          pipelineVersion: vnext.trace.meta.pipelineVersion,
          workerBuild: vnext.trace.meta.workerBuild
        }
      : null
  };
}

function buildStage2ConsistencyChecks(
  rawStage2: Stage2Response | null,
  stageManifests: ChatTraceExportStageManifest[]
): ChatTraceExportConsistencyCheck[] {
  if (!rawStage2) {
    return [];
  }

  const checks: ChatTraceExportConsistencyCheck[] = [];
  const analyzerComments = stageManifests.find((stage) => stage.stageId === "analyzer")?.inputManifest?.comments;
  const selectorComments = stageManifests.find((stage) => stage.stageId === "selector")?.inputManifest?.comments;
  const runtimeComments = getStage2SourceForExport(rawStage2)?.commentsUsedForPrompt ?? 0;
  checks.push({
    id: "comments_prompt_accounting",
    ok:
      (analyzerComments?.passedCount ?? 0) <= runtimeComments &&
      (selectorComments?.passedCount ?? 0) <= runtimeComments,
    details:
      `runtimeAvailable=${runtimeComments}; analyzerPassed=${analyzerComments?.passedCount ?? 0}; ` +
      `selectorPassed=${selectorComments?.passedCount ?? 0}.`
  });

  const selectorSelectedExampleIds =
    rawStage2.output.pipeline?.selectorOutput &&
    typeof rawStage2.output.pipeline.selectorOutput === "object" &&
    Array.isArray((rawStage2.output.pipeline.selectorOutput as { selectedExampleIds?: unknown }).selectedExampleIds)
      ? ((rawStage2.output.pipeline.selectorOutput as { selectedExampleIds?: string[] }).selectedExampleIds ?? [])
      : [];
  const diagnosticsSelectedExampleIds =
    rawStage2.diagnostics?.examples?.selectedExamples?.map((example) => example.id) ?? [];
  const selectedExampleIds =
    diagnosticsSelectedExampleIds.length > 0 ? diagnosticsSelectedExampleIds : selectorSelectedExampleIds;
  checks.push({
    id: "selected_examples_count_alignment",
    ok: (rawStage2.output.pipeline?.selectedExamplesCount ?? 0) === selectedExampleIds.length,
    details:
      `selectedExamplesCount=${rawStage2.output.pipeline?.selectedExamplesCount ?? 0}; ` +
      `selectorSelectedIds=${selectorSelectedExampleIds.length}; ` +
      `diagnosticsSelectedIds=${diagnosticsSelectedExampleIds.length}.`
  });

  const vnext = rawStage2.output.pipeline?.vnext;
  if (vnext) {
    const criticGate = vnext.criticGate ?? vnext.trace.criticGate;
    const validatedPoolIds = new Set(criticGate.validatedShortlistPoolIds);
    const criticManifestCandidates =
      stageManifests.find((stage) => stage.stageId === "critic")?.inputManifest?.candidates ?? null;
    checks.push({
      id: "vnext_disabled_examples",
      ok:
        vnext.exampleRouting.mode !== "disabled" ||
        ((rawStage2.output.pipeline?.selectedExamplesCount ?? 0) === 0 &&
          (vnext.canonicalCounters ?? vnext.trace.canonicalCounters).examplesPassedDownstream === 0),
      details:
        `mode=${vnext.exampleRouting.mode}; selectedExamplesCount=${rawStage2.output.pipeline?.selectedExamplesCount ?? 0}; ` +
        `examplesPassedDownstream=${(vnext.canonicalCounters ?? vnext.trace.canonicalCounters).examplesPassedDownstream}.`
    });
    checks.push({
      id: "critic_gate_alignment",
      ok:
        criticGate.reserveBackfillCount === 0 &&
        criticGate.rewriteCandidateIds.length === criticGate.criticKeptCandidateIds.length &&
        criticGate.rewriteCandidateIds.every((candidateId) =>
          criticGate.criticKeptCandidateIds.includes(candidateId)
        ) &&
        criticGate.visibleShortlistCandidateIds.every((candidateId) => validatedPoolIds.has(candidateId)),
      details:
        `criticKept=${criticGate.criticKeptCandidateIds.length}; rewritePool=${criticGate.rewriteCandidateIds.length}; ` +
        `validatedPool=${criticGate.validatedShortlistPoolIds.length}; visible=${criticGate.visibleShortlistCandidateIds.length}; ` +
        `reserveBackfill=${criticGate.reserveBackfillCount}.`
    });
    checks.push({
      id: "critic_manifest_alignment",
      ok:
        (criticManifestCandidates?.passedCount ?? criticGate.evaluatedCandidateIds.length) ===
          criticGate.evaluatedCandidateIds.length &&
        (criticManifestCandidates?.criticScoreCount ?? criticGate.evaluatedCandidateIds.length) ===
          criticGate.evaluatedCandidateIds.length,
      details:
        `criticManifestPassed=${criticManifestCandidates?.passedCount ?? "missing"}; ` +
        `criticManifestScores=${criticManifestCandidates?.criticScoreCount ?? "missing"}; ` +
        `criticGateEvaluated=${criticGate.evaluatedCandidateIds.length}.`
    });
  }

  return checks;
}

function buildStage2Outcome(rawStage2: Stage2Response | null) {
  const finalSelector = rawStage2?.output.pipeline?.finalSelector;
  const finalists = rawStage2?.output.finalists ?? [];
  const nativeWinner = rawStage2?.output.winner ?? null;
  const visibleCaptionOptions = rawStage2?.output.captionOptions ?? [];
  const nativeCandidateOptionMap =
    visibleCaptionOptions.length > 0
      ? visibleCaptionOptions.map((option) => ({
          option: option.option,
          candidateId: option.candidateId ?? `option_${option.option}`
        }))
      : finalists.map((finalist) => ({
          option: finalist.option,
          candidateId: finalist.candidateId
        }));
  return {
    retrievalConfidence: rawStage2?.diagnostics?.examples?.retrievalConfidence ?? null,
    examplesMode: rawStage2?.diagnostics?.examples?.examplesMode ?? null,
    examplesRoleSummary: rawStage2?.diagnostics?.examples?.examplesRoleSummary ?? null,
    primaryDriverSummary: rawStage2?.diagnostics?.examples?.primaryDriverSummary ?? null,
    candidateOptionMap: finalSelector?.candidateOptionMap ?? nativeCandidateOptionMap,
    visibleOptionToCandidateMap: nativeCandidateOptionMap,
    shortlistCandidateIds:
      finalSelector?.shortlistCandidateIds ??
      visibleCaptionOptions.map((option) => option.candidateId ?? `option_${option.option}`),
    finalPickCandidateId: finalSelector?.finalPickCandidateId ?? nativeWinner?.candidateId ?? null,
    finalPickOption: rawStage2?.output.finalPick?.option ?? nativeWinner?.option ?? null,
    finalPickReason: rawStage2?.output.finalPick?.reason ?? nativeWinner?.reason ?? null,
    winnerTier: rawStage2?.output.winner?.displayTier ?? rawStage2?.output.pipeline?.nativeCaptionV3?.guardSummary?.winnerTier ?? null,
    degradedSuccess:
      rawStage2?.output.pipeline?.nativeCaptionV3?.guardSummary?.degradedSuccess ?? null,
    rationaleRaw: finalSelector?.rationaleRaw ?? nativeWinner?.reason ?? null,
    rationaleInternalRaw: finalSelector?.rationaleInternalRaw ?? null,
    rationaleInternalModelRaw: finalSelector?.rationaleInternalModelRaw ?? null,
    topSignalSummary: finalSelector?.shortlistStats?.topSignalSummary ?? null
  };
}

function buildStage2NativeCaptionV3(rawStage2: Stage2Response | null) {
  const nativeCaption = rawStage2?.output.pipeline?.nativeCaptionV3 ?? null;
  return {
    present: Boolean(nativeCaption),
    contextPacket: nativeCaption?.contextPacket ?? null,
    candidateBatch: nativeCaption?.candidateBatch ?? [],
    hardValidator: nativeCaption?.hardValidator ?? null,
    qualityCourt: nativeCaption?.qualityCourt ?? null,
    repair: nativeCaption?.repair ?? null,
    templateBackfill: nativeCaption?.templateBackfill ?? null,
    guardSummary: nativeCaption?.guardSummary ?? null,
    displayOptions: nativeCaption?.displayOptions ?? [],
    titleWriter: nativeCaption?.titleWriter ?? null,
    captionTranslation: nativeCaption?.translation ?? null,
    translation: nativeCaption?.translation ?? null
  };
}

function buildExamplesRuntimeUsage(rawStage2: Stage2Response | null) {
  const diagnosticsExamples = rawStage2?.diagnostics?.examples;
  const availableExamples = diagnosticsExamples?.availableExamples ?? [];
  const selectedExamples = diagnosticsExamples?.selectedExamples ?? [];
  const selectorPipelineOutput =
    (rawStage2?.output.pipeline?.selectorOutput as
      | {
          selectedExampleIds?: string[];
          rejectedExampleIds?: string[];
        }
      | undefined) ?? undefined;
  const diagnosticsSelectedExampleIds =
    diagnosticsExamples?.selectedExamples.map((example) => example.id) ?? [];
  const selectorSelectedExampleIds = selectorPipelineOutput?.selectedExampleIds ?? [];
  const selectedExampleIds = new Set(
    diagnosticsSelectedExampleIds.length > 0
      ? diagnosticsSelectedExampleIds
      : selectorSelectedExampleIds.length > 0
        ? selectorSelectedExampleIds
        : rawStage2?.diagnostics?.selection?.selectedExampleIds ?? []
  );
  const rejectedExampleIds = new Set(
    selectorPipelineOutput?.rejectedExampleIds ??
      availableExamples
        .filter((example) => !selectedExampleIds.has(example.id))
        .map((example) => example.id)
  );
  return {
    source: diagnosticsExamples?.source ?? null,
    activeCorpusCount: diagnosticsExamples?.activeCorpusCount ?? 0,
    selectorPromptPoolCount: diagnosticsExamples?.selectorCandidateCount ?? 0,
    promptPoolExampleIds: availableExamples.map((example) => example.id),
    selectedExampleIds: Array.from(selectedExampleIds),
    rejectedExampleIds: Array.from(rejectedExampleIds),
    selectedExamples,
    rejectedExamples: availableExamples.filter(
      (example) => rejectedExampleIds.has(example.id) || !selectedExampleIds.has(example.id)
    ),
    retrievalConfidence: diagnosticsExamples?.retrievalConfidence ?? null,
    examplesMode: diagnosticsExamples?.examplesMode ?? null,
    explanation: diagnosticsExamples?.explanation ?? null,
    evidence: diagnosticsExamples?.evidence ?? [],
    retrievalWarning: diagnosticsExamples?.retrievalWarning ?? null,
    examplesRoleSummary: diagnosticsExamples?.examplesRoleSummary ?? null,
    primaryDriverSummary: diagnosticsExamples?.primaryDriverSummary ?? null,
    primaryDrivers: diagnosticsExamples?.primaryDrivers ?? [],
    guidanceRoleBuckets: {
      semanticGuidanceIds: availableExamples
        .filter((example) => example.guidanceRole === "semantic_guidance")
        .map((example) => example.id),
      formGuidanceIds: availableExamples
        .filter((example) => example.guidanceRole === "form_guidance")
        .map((example) => example.id),
      weakSupportIds: availableExamples
        .filter((example) => example.guidanceRole === "weak_support")
        .map((example) => example.id)
    }
  };
}

function buildStage2CausalInputs(input: {
  selectedRun: Stage2RunRecord | null;
  rawStage2: Stage2Response | null;
}) {
  const channelSnapshot = input.selectedRun?.request.channel;
  const workerProfile = resolveStage2WorkerProfile(channelSnapshot?.stage2WorkerProfileId);
  const styleProfile = normalizeStage2StyleProfile(channelSnapshot?.stage2StyleProfile);
  const editorialMemory = normalizeStage2EditorialMemorySummary(
    channelSnapshot?.editorialMemory,
    styleProfile
  );
  const editorialMemorySource = normalizeStage2EditorialMemorySource(
    channelSnapshot?.editorialMemorySource
  );
  const selectedDirections = getSelectedStage2StyleDirections(styleProfile);
  const sourceContext = input.rawStage2?.diagnostics?.sourceContext;
  const rawStage2Source = getStage2SourceForExport(input.rawStage2);
  return {
    run: {
      selectedRunId: input.selectedRun?.runId ?? null,
      mode: input.selectedRun?.mode ?? null,
      baseRunId: input.selectedRun?.baseRunId ?? null,
      userInstruction: input.selectedRun?.userInstruction ?? null
    },
    channelSnapshotUsed: {
      channelId: channelSnapshot?.id ?? null,
      name: channelSnapshot?.name ?? null,
      username: channelSnapshot?.username ?? null,
      stage2WorkerProfileId: channelSnapshot?.stage2WorkerProfileId ?? null,
      hardConstraints: channelSnapshot?.stage2HardConstraints ?? null,
      examplesConfig: channelSnapshot?.stage2ExamplesConfig ?? null
    },
    workerProfile: {
      requestedId: workerProfile.requestedId,
      resolvedId: workerProfile.resolvedId,
      label: workerProfile.label,
      description: workerProfile.description,
      summary: workerProfile.summary,
      origin: workerProfile.origin
    },
    stylePrior: {
      selectedDirectionIds: styleProfile.selectedDirectionIds,
      selectedDirections,
      explorationShare: styleProfile.explorationShare,
      referenceInfluenceSummary: styleProfile.referenceInfluenceSummary
    },
    editorialMemory,
    editorialMemorySource,
    sourceContext: {
      sourceUrl: sourceContext?.sourceUrl ?? rawStage2Source?.url ?? null,
      title: sourceContext?.title ?? rawStage2Source?.title ?? null,
      descriptionChars: sourceContext?.descriptionChars ?? 0,
      transcriptChars: sourceContext?.transcriptChars ?? 0,
      speechGroundingStatus: sourceContext?.speechGroundingStatus ?? "speech_uncertain",
      frameCount: sourceContext?.frameCount ?? rawStage2Source?.frameDescriptions?.length ?? 0,
      runtimeCommentsAvailable:
        sourceContext?.runtimeCommentCount ?? rawStage2Source?.commentsUsedForPrompt ?? 0,
      runtimeCommentIds: sourceContext?.runtimeCommentIds ?? [],
      commentsOmittedFromPrompt: rawStage2Source?.commentsOmittedFromPrompt ?? 0,
      downloadProvider: rawStage2Source?.downloadProvider ?? null,
      primaryProviderError: rawStage2Source?.primaryProviderError ?? null,
      downloadFallbackUsed: rawStage2Source?.downloadFallbackUsed ?? false,
      commentsAcquisitionStatus: rawStage2Source?.commentsAcquisitionStatus ?? null,
      commentsAcquisitionProvider: rawStage2Source?.commentsAcquisitionProvider ?? null,
      commentsAcquisitionNote: rawStage2Source?.commentsAcquisitionNote ?? null,
      commentsExtractionFallbackUsed: rawStage2Source?.commentsExtractionFallbackUsed ?? false
    }
  };
}

function buildCommentExportSections(input: {
  currentStage2Raw: Stage2Response | null;
  currentStage2Sanitized: Stage2Response | null;
  sourceJobs: SourceJobRecord[];
  threadEvents: ChatEvent[];
}): ChatTraceExportOmissionSection[] {
  const sections: ChatTraceExportOmissionSection[] = [];
  const pushSection = (path: string, availableCount: number, exportedCount: number) => {
    const omittedCount = Math.max(0, availableCount - exportedCount);
    sections.push({
      path,
      availableCount,
      exportedCount,
      omittedCount,
      truncated: omittedCount > 0,
      reason:
        omittedCount > 0
          ? `Trace export caps comment arrays at ${MAX_EXPORTED_COMMENTS} items to stay practical; this is export truncation only.`
          : "No export truncation on this path."
    });
  };

  if (input.currentStage2Raw && input.currentStage2Sanitized) {
    const rawRuntimeComments = getStage2RuntimeComments(input.currentStage2Raw);
    const sanitizedSource = getStage2SourceForExport(input.currentStage2Sanitized);
    pushSection(
      "stage2.currentResult.source.topComments",
      rawRuntimeComments.length,
      sanitizedSource?.topComments?.length ?? 0
    );
    pushSection(
      "stage2.currentResult.source.allComments",
      rawRuntimeComments.length,
      sanitizedSource?.allComments?.length ?? 0
    );
  }

  input.sourceJobs.forEach((job, index) => {
    const raw = job.resultData?.commentsPayload;
    const exported = sanitizeSourceJobResultForExport(job.resultData)?.commentsPayload;
    if (raw && exported) {
      pushSection(
        `sourceJobs[${index}].result.commentsPayload.topComments`,
        raw.topComments?.length ?? 0,
        exported.topComments?.length ?? 0
      );
      pushSection(
        `sourceJobs[${index}].result.commentsPayload.allComments`,
        raw.allComments?.length ?? 0,
        exported.allComments?.length ?? 0
      );
    }
  });

  input.threadEvents.forEach((event, index) => {
    if (event.type === "comments") {
      const raw = event.data as CommentsPayload | null;
      const exported = sanitizeCommentsPayload(raw);
      if (raw && exported) {
        pushSection(
          `thread.events[${index}].data.topComments`,
          raw.topComments?.length ?? 0,
          exported.topComments?.length ?? 0
        );
        pushSection(
          `thread.events[${index}].data.allComments`,
          raw.allComments?.length ?? 0,
          exported.allComments?.length ?? 0
        );
      }
    }
    if (event.type === "stage2") {
      const raw = event.data as Stage2Response | null;
      const exported = sanitizeStage2ResponseForExport(raw);
      if (raw && exported) {
        const rawRuntimeComments = getStage2RuntimeComments(raw);
        const exportedSource = getStage2SourceForExport(exported);
        pushSection(
          `thread.events[${index}].data.source.topComments`,
          rawRuntimeComments.length,
          exportedSource?.topComments?.length ?? 0
        );
        pushSection(
          `thread.events[${index}].data.source.allComments`,
          rawRuntimeComments.length,
          exportedSource?.allComments?.length ?? 0
        );
      }
    }
  });

  return sections;
}

function buildExportComments(input: {
  latestSourceResult: SourceJobResult | null;
  currentStage2Result: Stage2Response | null;
}): ChatTraceExportComments {
  const stage2Source = getStage2SourceForExport(input.currentStage2Result);
  const stage2PromptComments = getStage2RuntimeComments(input.currentStage2Result);
  const stage2TotalComments = stage2Source?.totalComments ?? 0;
  if (input.currentStage2Result) {
    const exportedItems = stage2PromptComments.slice(0, MAX_EXPORTED_COMMENTS);
    const runtimeAvailableCount =
      stage2Source?.commentsUsedForPrompt ?? stage2PromptComments.length;
    const analyzerManifest =
      input.currentStage2Result.diagnostics?.effectivePrompting?.promptStages.find(
        (stage) => stage.stageId === "analyzer"
      )?.inputManifest?.comments ?? null;
    const selectorManifest =
      input.currentStage2Result.diagnostics?.effectivePrompting?.promptStages.find(
        (stage) => stage.stageId === "selector"
      )?.inputManifest?.comments ?? null;
    const analyzerPassedCount = Math.min(
      runtimeAvailableCount,
      analyzerManifest?.passedCount ?? 20
    );
    const selectorPassedCount = Math.min(
      runtimeAvailableCount,
      selectorManifest?.passedCount ?? 12
    );
    return {
      available: runtimeAvailableCount > 0,
      totalComments: stage2TotalComments,
      includedCount: exportedItems.length,
      truncated: runtimeAvailableCount > exportedItems.length,
      provider: stage2Source?.commentsAcquisitionProvider ?? null,
      status: stage2Source?.commentsAcquisitionStatus ?? "primary_success",
      note: stage2Source?.commentsAcquisitionNote ?? null,
      fallbackUsed: stage2Source?.commentsAcquisitionStatus === "fallback_success",
      error: stage2Source?.commentsAcquisitionError ?? null,
      items: exportedItems,
      runtimeUsage: {
        totalExtractedCount: stage2TotalComments,
        runtimeAvailableCount,
        analyzer: {
          passedCount: analyzerPassedCount,
          omittedCount: Math.max(0, runtimeAvailableCount - analyzerPassedCount),
          truncated: runtimeAvailableCount > analyzerPassedCount,
          limit: analyzerManifest?.limit ?? 20,
          passedCommentIds: stage2PromptComments
            .slice(0, analyzerPassedCount)
            .map((comment) => comment.id)
        },
        selector: {
          passedCount: selectorPassedCount,
          omittedCount: Math.max(0, runtimeAvailableCount - selectorPassedCount),
          truncated: runtimeAvailableCount > selectorPassedCount,
          limit: selectorManifest?.limit ?? 12,
          passedCommentIds: stage2PromptComments
            .slice(0, selectorPassedCount)
            .map((comment) => comment.id)
        }
      },
      exportUsage: {
        includedCount: exportedItems.length,
        omittedCount: Math.max(0, runtimeAvailableCount - exportedItems.length),
        truncated: runtimeAvailableCount > exportedItems.length,
        exportLimit: MAX_EXPORTED_COMMENTS,
        exportedCommentIds: exportedItems.map((comment) => comment.id)
      }
    };
  }

  const sourceComments = sanitizeCommentsPayload(input.latestSourceResult?.commentsPayload ?? null);
  if (sourceComments) {
    return {
      available: true,
      totalComments: sourceComments.totalComments,
      includedCount: sourceComments.topComments.length,
      truncated: sourceComments.totalComments > sourceComments.topComments.length,
      provider: input.latestSourceResult?.commentsAcquisitionProvider ?? null,
      status: input.latestSourceResult?.commentsAcquisitionStatus ?? "primary_success",
      note: input.latestSourceResult?.commentsAcquisitionNote ?? null,
      fallbackUsed: input.latestSourceResult?.commentsAcquisitionStatus === "fallback_success",
      error: input.latestSourceResult?.commentsError ?? null,
      items: sourceComments.topComments,
      runtimeUsage: {
        totalExtractedCount: sourceComments.totalComments,
        runtimeAvailableCount: sourceComments.topComments.length,
        analyzer: {
          passedCount: 0,
          omittedCount: 0,
          truncated: false,
          limit: null,
          passedCommentIds: []
        },
        selector: {
          passedCount: 0,
          omittedCount: 0,
          truncated: false,
          limit: null,
          passedCommentIds: []
        }
      },
      exportUsage: {
        includedCount: sourceComments.topComments.length,
        omittedCount: Math.max(0, sourceComments.totalComments - sourceComments.topComments.length),
        truncated: sourceComments.totalComments > sourceComments.topComments.length,
        exportLimit: MAX_EXPORTED_COMMENTS,
        exportedCommentIds: sourceComments.topComments.map((comment) => comment.id)
      }
    };
  }

  return {
    available: false,
    totalComments: 0,
    includedCount: 0,
    truncated: false,
    provider: null,
    status: null,
    note: null,
    fallbackUsed: false,
    error: null,
    items: [],
    runtimeUsage: {
      totalExtractedCount: 0,
      runtimeAvailableCount: 0,
      analyzer: {
        passedCount: 0,
        omittedCount: 0,
        truncated: false,
        limit: null,
        passedCommentIds: []
      },
      selector: {
        passedCount: 0,
        omittedCount: 0,
        truncated: false,
        limit: null,
        passedCommentIds: []
      }
    },
    exportUsage: {
      includedCount: 0,
      omittedCount: 0,
      truncated: false,
      exportLimit: MAX_EXPORTED_COMMENTS,
      exportedCommentIds: []
    }
  };
}

export async function buildChatTraceExport(
  input: BuildChatTraceExportInput
): Promise<ChatTraceExport | null> {
  const chat = await getChatById(input.chatId);
  if (!chat || chat.workspaceId !== input.workspace.id) {
    return null;
  }

  const channel = await getChannelById(chat.channelId);
  if (!channel || channel.workspaceId !== input.workspace.id) {
    return null;
  }

  const draft = await getChatDraft(chat.id, input.userId);
  const sourceJobs = listSourceJobsForChat(chat.id, input.workspace.id);
  const stage2Runs = listStage2RunsForChat(chat.id, input.workspace.id);
  const selectedRun = pickSelectedStage2Run(stage2Runs, input.selectedRunId);
  const rawCurrentStage2 = (selectedRun?.resultData ?? null) as Stage2Response | null;
  const sanitizedCurrentStage2 = sanitizeStage2ResponseForExport(
    rawCurrentStage2
  );
  const rawCurrentStage2Source = getStage2SourceForExport(rawCurrentStage2);
  const sanitizedCurrentStage2Source = getStage2SourceForExport(sanitizedCurrentStage2);
  const latestSourceJobWithResult = sourceJobs.find((job) => Boolean(job.resultData)) ?? null;
  const exportComments = buildExportComments({
    latestSourceResult: latestSourceJobWithResult?.resultData ?? null,
    currentStage2Result: rawCurrentStage2
  });
  const workspaceDefaults = {
    examplesCorpusJson: getWorkspaceStage2ExamplesCorpusJson(input.workspace.id),
    hardConstraints: getWorkspaceStage2HardConstraints(input.workspace.id),
    promptConfig: getWorkspaceStage2PromptConfig(input.workspace.id)
  };
  const legacyVersions = buildLegacyTimelineEntries(
    chat.events
      .filter((event) => event.type === "note" && event.role === "assistant")
      .map((event) => ({
        id: event.id,
        createdAt: event.createdAt,
        data: event.data
      }))
  );
  const latestLegacyVersion = legacyVersions[legacyVersions.length - 1] ?? null;
  const stage3Handoff = buildStage2ToStage3HandoffSummary({
    stage2: sanitizedCurrentStage2,
    draft,
    latestVersion: latestLegacyVersion
  });
  const exportedAt = new Date().toISOString();
  const examplesRuntimeUsage = buildExamplesRuntimeUsage(rawCurrentStage2);
  const commentExportSections = buildCommentExportSections({
    currentStage2Raw: rawCurrentStage2,
    currentStage2Sanitized: sanitizedCurrentStage2,
    sourceJobs,
    threadEvents: chat.events
  });
  const stageManifests = buildStageManifestSummaries(
    rawCurrentStage2?.diagnostics?.effectivePrompting?.promptStages
  );
  const execution = buildStage2Execution(rawCurrentStage2);
  const vnext = buildStage2VNextCanonical(rawCurrentStage2);
  const consistencyChecks = buildStage2ConsistencyChecks(rawCurrentStage2, stageManifests);

  return {
    version: TRACE_EXPORT_VERSION,
    exportedAt,
    traceContract: buildTraceContract(),
    workspace: {
      id: input.workspace.id,
      name: input.workspace.name,
      slug: input.workspace.slug
    },
    channel: {
      id: channel.id,
      name: channel.name,
      username: channel.username,
      stage2ExamplesConfig: channel.stage2ExamplesConfig,
      stage2HardConstraints: channel.stage2HardConstraints,
      templateId: channel.templateId
    },
    chat: {
      id: chat.id,
      title: chat.title,
      url: chat.url,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt
    },
    source: {
      url: chat.url,
      title:
        sanitizedCurrentStage2Source?.title ??
        latestSourceJobWithResult?.resultData?.title ??
        (chat.title !== chat.url ? chat.title : null),
      downloadProvider: sanitizedCurrentStage2Source?.downloadProvider ?? null,
      primaryProviderError: sanitizedCurrentStage2Source?.primaryProviderError ?? null,
      downloadFallbackUsed: sanitizedCurrentStage2Source?.downloadFallbackUsed ?? false,
      commentsAvailable: exportComments.available,
      commentsError:
        rawCurrentStage2Source?.commentsAcquisitionError ??
        latestSourceJobWithResult?.resultData?.commentsError ??
        null,
      totalComments: exportComments.totalComments,
      includedComments: exportComments.includedCount,
      commentsAcquisitionStatus:
        sanitizedCurrentStage2Source?.commentsAcquisitionStatus ??
        latestSourceJobWithResult?.resultData?.commentsAcquisitionStatus ??
        null,
      commentsAcquisitionProvider:
        sanitizedCurrentStage2Source?.commentsAcquisitionProvider ??
        latestSourceJobWithResult?.resultData?.commentsAcquisitionProvider ??
        null,
      commentsAcquisitionNote:
        sanitizedCurrentStage2Source?.commentsAcquisitionNote ??
        latestSourceJobWithResult?.resultData?.commentsAcquisitionNote ??
        null,
      commentsFallbackUsed:
        (sanitizedCurrentStage2Source?.commentsAcquisitionStatus ??
          latestSourceJobWithResult?.resultData?.commentsAcquisitionStatus ??
          null) === "fallback_success",
      activeJobId: sourceJobs.find((job) => job.status === "queued" || job.status === "running")?.jobId ?? null,
      latestCompletedJobId: latestSourceJobWithResult?.jobId ?? null
    },
    comments: exportComments,
    sourceJobs: sourceJobs.map(sanitizeSourceJobForExport),
    stage2: {
      selectedRunId: selectedRun?.runId ?? null,
      causalInputs: buildStage2CausalInputs({
        selectedRun,
        rawStage2: rawCurrentStage2
      }),
      stageManifests,
      exportOmissions: {
        comments: {
          exportLimit: MAX_EXPORTED_COMMENTS,
          sections: commentExportSections
        },
        notes: [
          "Canonical causal sections describe what shaped the selected run.",
          "Comment truncation in this section refers to export trimming only; runtime truncation lives in comments.runtimeUsage and stage2.stageManifests."
        ]
      },
      execution,
      outcome: buildStage2Outcome(rawCurrentStage2),
      examplesRuntimeUsage,
      nativeCaptionV3: buildStage2NativeCaptionV3(rawCurrentStage2),
      vnext,
      consistencyChecks,
      currentResult: sanitizedCurrentStage2,
      currentProgress: sanitizedCurrentStage2?.progress ?? selectedRun?.snapshot ?? null,
      analysis: sanitizedCurrentStage2?.diagnostics?.analysis ?? null,
      effectivePrompting: sanitizedCurrentStage2?.diagnostics?.effectivePrompting ?? null,
      examples: sanitizedCurrentStage2?.diagnostics?.examples ?? null,
      selection: sanitizedCurrentStage2?.diagnostics?.selection ?? null,
      runs: stage2Runs.map(sanitizeStage2RunForExport),
      workspaceDefaults
    },
    stage3: {
      draft: draft?.stage3 ?? null,
      handoff: stage3Handoff,
      latestRenderExport: findLatestRenderExport(chat.events),
      latestAgentSession: findLatestStage3AgentSessionRef(chat.events),
      legacyVersions
    },
    thread: {
      events: chat.events.map(sanitizeChatEventForExport)
    },
    draft
  };
}
