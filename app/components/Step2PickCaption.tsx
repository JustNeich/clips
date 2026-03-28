"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChannelFeedbackResponse,
  Stage2Response,
  Stage2RunStatus,
  Stage2RunSummary
} from "./types";
import { StepWorkspace } from "./StepWorkspace";
import {
  type ChannelEditorialFeedbackNoteMode,
  createEmptyStage2EditorialMemorySummary,
  DEFAULT_STAGE2_STYLE_PROFILE,
  normalizeStage2EditorialMemorySummary,
  normalizeStage2StyleProfile
} from "../../lib/stage2-channel-learning";
import type { Stage2RunDebugArtifact } from "../../lib/viral-shorts-worker/types";

type Step2PickCaptionProps = {
  channelName?: string | null;
  channelUsername?: string | null;
  stage2: Stage2Response | null;
  progress: Stage2Response["progress"] | null;
  stageCreatedAt: string | null;
  commentsAvailable?: boolean;
  instruction: string;
  runs: Stage2RunSummary[];
  selectedRunId: string | null;
  currentRunStatus: Stage2RunStatus | null;
  currentRunError: string | null;
  canRunStage2: boolean;
  canQuickRegenerate: boolean;
  runBlockedReason?: string | null;
  quickRegenerateBlockedReason?: string | null;
  canSubmitFeedback?: boolean;
  feedbackHistory?: ChannelFeedbackResponse["historyEvents"];
  feedbackHistoryLoading?: boolean;
  showCreateNextChatShortcut?: boolean;
  isLaunching: boolean;
  isRunning: boolean;
  expectedDurationMs: number;
  elapsedMs: number;
  selectedOption: number | null;
  selectedTitleOption: number | null;
  onInstructionChange: (value: string) => void;
  onQuickRegenerate: () => void;
  onRunStage2: () => void;
  onSelectRun: (runId: string) => void;
  onSelectOption: (option: number) => void;
  onSelectTitleOption: (option: number) => void;
  onSubmitOptionFeedback?: (input: {
    option: number;
    kind: "more_like_this" | "less_like_this" | "selected_option";
    scope: "option" | "top" | "bottom";
    noteMode: ChannelEditorialFeedbackNoteMode;
    note: string;
  }) => Promise<void>;
  onDeleteFeedbackEvent?: (eventId: string) => Promise<void>;
  deletingFeedbackEventId?: string | null;
  onCreateNextChat?: () => void;
  onCopy: (value: string, successMessage: string) => void;
};

type DiagnosticsView = NonNullable<Stage2Response["diagnostics"]>;
type DiagnosticsPromptStage = DiagnosticsView["effectivePrompting"]["promptStages"][number];
type DiagnosticsExample = DiagnosticsView["examples"]["availableExamples"][number];

function formatDate(value: string): string {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatSourceProviderLabel(provider: Stage2Response["source"]["downloadProvider"]): string | null {
  if (provider === "visolix") {
    return "Visolix";
  }
  if (provider === "ytDlp") {
    return "Локальный резервный загрузчик";
  }
  return null;
}

function formatCommentsAcquisitionLabel(source: Stage2Response["source"] | null | undefined): string | null {
  if (!source?.commentsAcquisitionStatus) {
    return null;
  }
  if (source.commentsAcquisitionStatus === "fallback_success") {
    return source.commentsAcquisitionNote || "Комментарии получены через резервный путь.";
  }
  if (source.commentsAcquisitionStatus === "unavailable") {
    return source.commentsAcquisitionNote || source.commentsAcquisitionError || "Комментарии недоступны.";
  }
  if (source.commentsAcquisitionProvider === "youtubeDataApi") {
    return "Комментарии получены через основной YouTube-провайдер.";
  }
  if (source.commentsAcquisitionProvider === "ytDlp") {
    return "Комментарии получены напрямую через yt-dlp.";
  }
  return source.commentsAcquisitionNote || null;
}

function formatFeedbackScopeLabel(scope: "option" | "top" | "bottom"): string {
  if (scope === "top") {
    return "TOP";
  }
  if (scope === "bottom") {
    return "BOTTOM";
  }
  return "Опция";
}

function formatFeedbackHistoryTimestamp(value: string): string {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatFeedbackNoteModeLabel(mode: ChannelEditorialFeedbackNoteMode): string {
  if (mode === "hard_rule") {
    return "Hard rule";
  }
  if (mode === "situational_note") {
    return "Situational note";
  }
  return "Soft preference";
}

function formatFeedbackNoteModeHelp(mode: ChannelEditorialFeedbackNoteMode): string {
  if (mode === "hard_rule") {
    return "Останется активным правилом канала, даже когда обычные реакции выйдут из окна последних 30.";
  }
  if (mode === "situational_note") {
    return "Больше похоже на локальную подсказку для похожих кейсов, чем на долгую привычку канала.";
  }
  return "Базовый режим: мягко влияет на будущие варианты и живёт внутри окна последних 30 реакций.";
}

function formatRussianCount(
  count: number,
  one: string,
  few: string,
  many: string
): string {
  const abs = Math.abs(count) % 100;
  const modTen = abs % 10;
  if (abs > 10 && abs < 20) {
    return many;
  }
  if (modTen === 1) {
    return one;
  }
  if (modTen >= 2 && modTen <= 4) {
    return few;
  }
  return many;
}

function formatReactionCountLabel(count: number): string {
  return `${count} ${formatRussianCount(count, "реакция", "реакции", "реакций")}`;
}

function getFeedbackHistorySnippet(
  event: ChannelFeedbackResponse["historyEvents"][number]
): string {
  if (!event.optionSnapshot) {
    return "Снимок варианта недоступен.";
  }
  const optionLabel = event.optionSnapshot.optionNumber
    ? `Вариант ${event.optionSnapshot.optionNumber}`
    : event.optionSnapshot.candidateId;
  if (event.scope === "top") {
    return `${optionLabel}: ${event.optionSnapshot.top}`;
  }
  if (event.scope === "bottom") {
    return `${optionLabel}: ${event.optionSnapshot.bottom}`;
  }
  return `${optionLabel}: ${event.optionSnapshot.top} · ${event.optionSnapshot.bottom}`;
}

function formatDurationMs(value: number): string {
  const safe = Math.max(0, value);
  if (safe < 60_000) {
    return `${(safe / 1000).toFixed(2)}с`;
  }
  const minutes = Math.floor(safe / 60_000);
  const seconds = ((safe % 60_000) / 1000).toFixed(2).padStart(5, "0");
  return `${minutes}:${seconds}`;
}

function getStage2ProgressRatio(elapsedMs: number, expectedDurationMs: number): number {
  if (expectedDurationMs <= 0) {
    return 0;
  }
  const ratio = elapsedMs / expectedDurationMs;
  if (ratio <= 1) {
    return Math.min(0.96, ratio * 0.96);
  }
  const overflow = ratio - 1;
  return Math.min(0.995, 0.96 + (1 - Math.exp(-overflow * 1.6)) * 0.035);
}

function formatReasoningEffort(value: string | null | undefined): string {
  if (!value) {
    return "Не задан";
  }
  if (value === "x-high" || value === "xhigh") {
    return "X-High";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatRunStatusLabel(status: Stage2RunStatus): string {
  switch (status) {
    case "queued":
      return "В очереди";
    case "running":
      return "Идёт";
    case "completed":
      return "Готов";
    case "failed":
      return "Ошибка";
    default:
      return status;
  }
}

function formatRunModeLabel(mode: Stage2RunSummary["mode"]): string {
  if (mode === "auto") {
    return "авто";
  }
  if (mode === "regenerate") {
    return "быстрый";
  }
  return "полный";
}

function formatStageProgressStatusLabel(input: {
  stepState: NonNullable<Stage2Response["progress"]>["steps"][number]["state"];
  progressStatus: NonNullable<Stage2Response["progress"]>["status"];
  blockedAfterFailure: boolean;
}): string {
  if (input.blockedAfterFailure) {
    return "Не запускался";
  }
  if (input.stepState === "running") {
    return "Идёт";
  }
  if (input.stepState === "completed") {
    return "Готов";
  }
  if (input.stepState === "failed") {
    return "Ошибка";
  }
  return input.progressStatus === "queued" ? "В очереди" : "Ожидает запуска";
}

function formatExamplesSourceLabel(value: "workspace_default" | "channel_custom"): string {
  return value === "channel_custom" ? "собственный корпус канала" : "общий корпус";
}

function formatRetrievalConfidenceLabel(value: DiagnosticsView["examples"]["retrievalConfidence"]): string {
  if (value === "high") {
    return "Высокая";
  }
  if (value === "medium") {
    return "Средняя";
  }
  return "Низкая";
}

function formatExamplesModeLabel(value: DiagnosticsView["examples"]["examplesMode"]): string {
  if (value === "domain_guided") {
    return "Доменный режим";
  }
  if (value === "form_guided") {
    return "Формальный режим";
  }
  return "Style-guided режим";
}

function formatGuidanceRoleLabel(value: DiagnosticsExample["guidanceRole"]): string {
  if (value === "semantic_guidance") {
    return "семантическая опора";
  }
  if (value === "form_guidance") {
    return "опора по форме";
  }
  return "слабая опора";
}

function truncateText(value: string, maxLength = 140): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

function isVerboseStageDetail(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const trimmed = value.trim();
  return trimmed.length > 220 || trimmed.includes("\n");
}

function summarizeStageDetail(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const firstMeaningfulLine =
    value
      .split("\n")
      .map((item) => item.trim())
      .find(Boolean) ?? value.trim();
  return firstMeaningfulLine ? truncateText(firstMeaningfulLine, 120) : null;
}

function formatNullableNumber(value: number | null | undefined, digits = 2): string | null {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : null;
}

function formatInteger(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("ru-RU") : null;
}

function formatByteCount(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
    : [];
}

function normalizeDiagnosticsExample(input: unknown, bucket: DiagnosticsExample["bucket"]): DiagnosticsExample {
  const candidate = asObject(input);
  const sourceChannelId =
    asString(candidate?.sourceChannelId) ||
    asString(candidate?.ownerChannelId) ||
    asString(candidate?.videoId) ||
    "unknown-source";
  const sourceChannelName =
    asString(candidate?.sourceChannelName) ||
    asString(candidate?.ownerChannelName) ||
    "Unknown source";
  return {
    id:
      asString(candidate?.id) ||
      asString(candidate?.exampleId) ||
      `${bucket}:${sourceChannelId}:${asString(candidate?.videoId) || asString(candidate?.title) || "example"}`,
    bucket,
    channelName: sourceChannelName,
    sourceChannelId,
    sourceChannelName,
    videoId: asOptionalString(candidate?.videoId),
    title:
      asString(candidate?.title) ||
      asString(candidate?.overlayTop) ||
      asString(candidate?.overlayBottom) ||
      "Untitled example",
    clipType: asString(candidate?.clipType, "unknown"),
    overlayTop: asString(candidate?.overlayTop),
    overlayBottom: asString(candidate?.overlayBottom),
    whyItWorks: Array.isArray(candidate?.whyItWorks)
      ? candidate!.whyItWorks
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean)
      : typeof candidate?.whyItWorks === "string" && candidate.whyItWorks.trim()
        ? [candidate.whyItWorks.trim()]
        : [],
    qualityScore: asNumber(candidate?.qualityScore),
    retrievalScore: asNumber(candidate?.retrievalScore),
    retrievalReasons: asStringArray(candidate?.retrievalReasons),
    guidanceRole:
      candidate?.guidanceRole === "semantic_guidance"
        ? "semantic_guidance"
        : candidate?.guidanceRole === "form_guidance"
          ? "form_guidance"
          : "weak_support",
    sampleKind: asOptionalString(candidate?.sampleKind),
    isOwnedAnchor: Boolean(candidate?.isOwnedAnchor),
    isAntiExample: Boolean(candidate?.isAntiExample),
    publishedAt: asOptionalString(candidate?.publishedAt),
    views: asNumber(candidate?.views),
    ageHours: asNumber(candidate?.ageHours),
    anomalyScore: asNumber(candidate?.anomalyScore)
  };
}

function normalizePromptStage(input: unknown, index: number): DiagnosticsPromptStage | null {
  const candidate = asObject(input);
  if (!candidate) {
    return null;
  }

  const stageId = asString(candidate.stageId) || `stage_${index + 1}`;
  const defaultPrompt =
    asString(candidate.defaultPrompt) || asString(candidate.defaultTemplate);
  const configuredPrompt =
    asString(candidate.configuredPrompt) ||
    asString(candidate.effectiveTemplate) ||
    asString(candidate.channelOverride) ||
    defaultPrompt;
  return {
    stageId,
    label: asString(candidate.label) || stageId,
    stageType: "llm_prompt",
    defaultPrompt,
    configuredPrompt,
    reasoningEffort: asOptionalString(candidate.reasoningEffort),
    isCustomPrompt:
      typeof candidate.isCustomPrompt === "boolean"
        ? candidate.isCustomPrompt
        : configuredPrompt !== defaultPrompt,
    promptText: asOptionalString(candidate.promptText),
    promptTextAvailable: Boolean(candidate.promptTextAvailable),
    promptChars: asNumber(candidate.promptChars),
    estimatedInputTokens: asNumber(candidate.estimatedInputTokens),
    estimatedOutputTokens: asNumber(candidate.estimatedOutputTokens),
    serializedResultBytes: asNumber(candidate.serializedResultBytes),
    persistedPayloadBytes: asNumber(candidate.persistedPayloadBytes),
    usesImages: Boolean(candidate.usesImages),
    summary: asString(candidate.summary)
  };
}

export function normalizeStage2DiagnosticsForView(
  input: Stage2Response["diagnostics"] | null | undefined,
  fallback: {
    channelName?: string | null;
    channelUsername?: string | null;
  }
): DiagnosticsView | null {
  const candidate = asObject(input);
  if (!candidate) {
    return null;
  }

  const currentChannel = asObject(candidate.channel);
  const legacyProfile = asObject(candidate.profile);
  const selectionCandidate = asObject(candidate.selection);
  const promptingCandidate = asObject(candidate.effectivePrompting);
  const examplesCandidate = asObject(candidate.examples);
  const analysisCandidate = asObject(candidate.analysis);
  const legacyRetrieval = asObject(candidate.retrieval);

  const promptStages = Array.isArray(promptingCandidate?.promptStages)
    ? promptingCandidate.promptStages
        .map((stage, index) => normalizePromptStage(stage, index))
        .filter((stage): stage is DiagnosticsPromptStage => stage !== null)
    : [];

  const availableExamples =
    Array.isArray(examplesCandidate?.availableExamples) && examplesCandidate.availableExamples.length > 0
      ? examplesCandidate.availableExamples.map((item) => normalizeDiagnosticsExample(item, "available"))
      : [
          ...(Array.isArray(legacyRetrieval?.stableExamples) ? legacyRetrieval.stableExamples : []),
          ...(Array.isArray(legacyRetrieval?.hotExamples) ? legacyRetrieval.hotExamples : []),
          ...(Array.isArray(legacyRetrieval?.antiExamples) ? legacyRetrieval.antiExamples : [])
        ].map((item) => normalizeDiagnosticsExample(item, "available"));

  const selectedExamples =
    Array.isArray(examplesCandidate?.selectedExamples) && examplesCandidate.selectedExamples.length > 0
      ? examplesCandidate.selectedExamples.map((item) => normalizeDiagnosticsExample(item, "selected"))
      : availableExamples.slice(0, Math.min(3, availableExamples.length)).map((item) => ({
          ...item,
          bucket: "selected" as const
        }));

  const rankedAnglesRaw = Array.isArray(selectionCandidate?.rankedAngles)
    ? selectionCandidate.rankedAngles
    : [];
  const rankedAngles = rankedAnglesRaw
    .map((item) => {
      const ranked = asObject(item);
      const angle = asString(ranked?.angle);
      const why = asString(ranked?.why);
      const score = asNumber(ranked?.score);
      if (!angle || !why || score === null) {
        return null;
      }
      return { angle, why, score };
    })
    .filter(
      (
        item
      ): item is DiagnosticsView["selection"]["rankedAngles"][number] => item !== null
    );

  return {
    channel: {
      channelId:
        asString(currentChannel?.channelId) ||
        asString(currentChannel?.id) ||
        asString(legacyProfile?.profileId) ||
        "current-channel",
      name: asString(currentChannel?.name) || asString(legacyProfile?.name) || fallback.channelName || "Текущий канал",
      username: asString(currentChannel?.username) || fallback.channelUsername || "",
      examplesSource:
        currentChannel?.examplesSource === "channel_custom" ? "channel_custom" : "workspace_default",
      hardConstraints:
        asObject(currentChannel?.hardConstraints) && currentChannel?.hardConstraints
          ? (currentChannel.hardConstraints as DiagnosticsView["channel"]["hardConstraints"])
          : {
              topLengthMin: 0,
              topLengthMax: 0,
              bottomLengthMin: 0,
              bottomLengthMax: 0,
              bannedWords: [],
              bannedOpeners: []
            },
      styleProfile: currentChannel?.styleProfile
        ? normalizeStage2StyleProfile(currentChannel.styleProfile)
        : DEFAULT_STAGE2_STYLE_PROFILE,
      editorialMemory: currentChannel?.editorialMemory
        ? normalizeStage2EditorialMemorySummary(
            currentChannel.editorialMemory,
            currentChannel?.styleProfile
              ? normalizeStage2StyleProfile(currentChannel.styleProfile)
              : DEFAULT_STAGE2_STYLE_PROFILE
          )
        : createEmptyStage2EditorialMemorySummary(
            currentChannel?.styleProfile
              ? normalizeStage2StyleProfile(currentChannel.styleProfile)
              : DEFAULT_STAGE2_STYLE_PROFILE
          ),
      workspaceCorpusCount: asNumber(currentChannel?.workspaceCorpusCount) ?? availableExamples.length,
      activeCorpusCount: asNumber(currentChannel?.activeCorpusCount) ?? availableExamples.length
    },
    selection: {
      clipType:
        asString(selectionCandidate?.clipType) ||
        availableExamples[0]?.clipType ||
        "unknown",
      primaryAngle: asString(selectionCandidate?.primaryAngle),
      secondaryAngles: Array.isArray(selectionCandidate?.secondaryAngles)
        ? selectionCandidate.secondaryAngles
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean)
        : [],
      rankedAngles,
      coreTrigger: asString(selectionCandidate?.coreTrigger),
      humanStake: asString(selectionCandidate?.humanStake),
      narrativeFrame: asString(selectionCandidate?.narrativeFrame),
      whyViewerCares: asString(selectionCandidate?.whyViewerCares),
      topStrategy: asString(selectionCandidate?.topStrategy),
      bottomEnergy: asString(selectionCandidate?.bottomEnergy),
      whyOldV6WouldWorkHere: asString(selectionCandidate?.whyOldV6WouldWorkHere),
      failureModes: Array.isArray(selectionCandidate?.failureModes)
        ? selectionCandidate.failureModes
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean)
        : [],
      writerBrief: asString(selectionCandidate?.writerBrief),
      rationale: asOptionalString(selectionCandidate?.rationale),
      selectedExampleIds: Array.isArray(selectionCandidate?.selectedExampleIds)
        ? selectionCandidate.selectedExampleIds
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean)
        : []
    },
    analysis: {
      visualAnchors: asStringArray(analysisCandidate?.visualAnchors),
      specificNouns: asStringArray(analysisCandidate?.specificNouns),
      visibleActions: asStringArray(analysisCandidate?.visibleActions),
      firstSecondsSignal: asString(analysisCandidate?.firstSecondsSignal),
      sceneBeats: asStringArray(analysisCandidate?.sceneBeats),
      revealMoment: asString(analysisCandidate?.revealMoment),
      lateClipChange: asString(analysisCandidate?.lateClipChange),
      whyViewerCares: asString(analysisCandidate?.whyViewerCares),
      bestBottomEnergy: asString(analysisCandidate?.bestBottomEnergy),
      commentVibe: asString(analysisCandidate?.commentVibe),
      commentConsensusLane: asString(analysisCandidate?.commentConsensusLane),
      commentJokeLane: asString(analysisCandidate?.commentJokeLane),
      commentDissentLane: asString(analysisCandidate?.commentDissentLane),
      commentSuspicionLane: asString(analysisCandidate?.commentSuspicionLane),
      slangToAdapt: asStringArray(analysisCandidate?.slangToAdapt),
      commentLanguageCues: asStringArray(analysisCandidate?.commentLanguageCues),
      hiddenDetail: asString(analysisCandidate?.hiddenDetail),
      genericRisks: asStringArray(analysisCandidate?.genericRisks),
      uncertaintyNotes: asStringArray(analysisCandidate?.uncertaintyNotes),
      rawSummary: asString(analysisCandidate?.rawSummary)
    },
    effectivePrompting: {
      promptStages
    },
    examples: {
      source:
        examplesCandidate?.source === "channel_custom" ? "channel_custom" : "workspace_default",
      workspaceCorpusCount:
        asNumber(examplesCandidate?.workspaceCorpusCount) ?? availableExamples.length,
      activeCorpusCount: asNumber(examplesCandidate?.activeCorpusCount) ?? availableExamples.length,
      selectorCandidateCount:
        asNumber(examplesCandidate?.selectorCandidateCount) ?? availableExamples.length,
      retrievalConfidence:
        examplesCandidate?.retrievalConfidence === "high"
          ? "high"
          : examplesCandidate?.retrievalConfidence === "medium"
            ? "medium"
            : "low",
      examplesMode:
        examplesCandidate?.examplesMode === "domain_guided"
          ? "domain_guided"
          : examplesCandidate?.examplesMode === "form_guided"
            ? "form_guided"
            : "style_guided",
      explanation: asString(examplesCandidate?.explanation),
      evidence: asStringArray(examplesCandidate?.evidence),
      retrievalWarning: asOptionalString(examplesCandidate?.retrievalWarning),
      examplesRoleSummary: asString(examplesCandidate?.examplesRoleSummary),
      primaryDriverSummary: asString(examplesCandidate?.primaryDriverSummary),
      primaryDrivers: asStringArray(examplesCandidate?.primaryDrivers),
      channelStylePriority:
        examplesCandidate?.channelStylePriority === "primary"
          ? "primary"
          : examplesCandidate?.channelStylePriority === "elevated"
            ? "elevated"
            : "supporting",
      editorialMemoryPriority:
        examplesCandidate?.editorialMemoryPriority === "primary"
          ? "primary"
          : examplesCandidate?.editorialMemoryPriority === "elevated"
            ? "elevated"
            : "supporting",
      availableExamples,
      selectedExamples
    }
  };
}

export function Stage2RunDiagnosticsPanels({
  diagnostics,
  stage2Result = null
}: {
  diagnostics: DiagnosticsView | null;
  stage2Result?: Stage2Response | null;
}) {
  const overrideCount = useMemo(() => {
    if (!diagnostics) {
      return 0;
    }
    return diagnostics.effectivePrompting.promptStages.filter((stage) => stage.isCustomPrompt).length;
  }, [diagnostics]);
  const [rawDebugArtifact, setRawDebugArtifact] = useState<Stage2RunDebugArtifact | null>(null);
  const [rawDebugArtifactLoading, setRawDebugArtifactLoading] = useState(false);
  const [rawDebugArtifactError, setRawDebugArtifactError] = useState<string | null>(null);
  const rawDebugRunId = stage2Result?.stage2Run?.runId ?? null;
  const rawDebugRef =
    stage2Result?.debugRef?.kind === "stage2-run-debug" ? stage2Result.debugRef.ref : null;
  const canLoadRawPromptArtifact = Boolean(rawDebugRunId && rawDebugRef);
  const hasDeferredPromptStages = useMemo(
    () =>
      (diagnostics?.effectivePrompting.promptStages ?? []).some(
        (stage) => !stage.promptText && stage.promptTextAvailable
      ),
    [diagnostics]
  );
  const rawPromptTextByStageId = useMemo(() => {
    const entries = rawDebugArtifact?.promptStages ?? [];
    return new Map(
      entries
        .filter((stage) => typeof stage.promptText === "string" && stage.promptText.trim())
        .map((stage) => [stage.stageId, stage.promptText as string])
    );
  }, [rawDebugArtifact]);

  useEffect(() => {
    setRawDebugArtifact(null);
    setRawDebugArtifactError(null);
    setRawDebugArtifactLoading(false);
  }, [rawDebugRef, rawDebugRunId]);

  const loadRawPromptArtifact = useCallback(async (): Promise<void> => {
    if (!rawDebugRunId || !rawDebugRef || rawDebugArtifact || rawDebugArtifactLoading) {
      return;
    }
    setRawDebugArtifactLoading(true);
    setRawDebugArtifactError(null);
    try {
      const response = await fetch(
        `/api/pipeline/stage2/debug?runId=${encodeURIComponent(rawDebugRunId)}&debugRef=${encodeURIComponent(rawDebugRef)}`
      );
      const payload = (await response.json().catch(() => null)) as
        | { artifact?: Stage2RunDebugArtifact; error?: string }
        | null;
      if (!response.ok || !payload?.artifact) {
        throw new Error(payload?.error || "Не удалось загрузить raw prompt context.");
      }
      setRawDebugArtifact(payload.artifact);
    } catch (error) {
      setRawDebugArtifactError(
        error instanceof Error ? error.message : "Не удалось загрузить raw prompt context."
      );
    } finally {
      setRawDebugArtifactLoading(false);
    }
  }, [rawDebugArtifact, rawDebugArtifactLoading, rawDebugRef, rawDebugRunId]);

  if (!diagnostics) {
    return null;
  }

  return (
    <>
      <section className="control-card control-card-subtle">
        <div className="option-card-head">
          <div>
            <h3>Как этот запуск реально устроен</h3>
            <p className="subtle-text">
              Ниже показаны реальные настройки канала, активный корпус примеров и то, что выбрал
              селектор для этого запуска второго этапа.
            </p>
          </div>
        </div>
        <div className="stage2-insight-grid">
          <article className="stage2-insight-card">
            <span className="field-label">Канал</span>
            <strong>{diagnostics.channel.name}</strong>
            <p className="subtle-text">
              @{diagnostics.channel.username} · источник корпуса{" "}
              {formatExamplesSourceLabel(diagnostics.channel.examplesSource)}
            </p>
          </article>
          <article className="stage2-insight-card">
            <span className="field-label">Выбор</span>
            <strong>{diagnostics.selection.clipType}</strong>
            <p className="subtle-text">
              {diagnostics.selection.rankedAngles.map((item) => item.angle).slice(0, 3).join(", ")}
            </p>
          </article>
          <article className="stage2-insight-card">
            <span className="field-label">Примеры</span>
            <strong>
              в промпте {diagnostics.examples.selectorCandidateCount} / активно{" "}
              {diagnostics.examples.activeCorpusCount}
            </strong>
            <p className="subtle-text">
              селектор выбрал {diagnostics.examples.selectedExamples.length} · в общем корпусе{" "}
              {diagnostics.examples.workspaceCorpusCount}
            </p>
          </article>
          <article className="stage2-insight-card">
            <span className="field-label">Retrieval режим</span>
            <strong>
              {formatExamplesModeLabel(diagnostics.examples.examplesMode)} ·{" "}
              {formatRetrievalConfidenceLabel(diagnostics.examples.retrievalConfidence)}
            </strong>
            <p className="subtle-text">
              {diagnostics.examples.examplesRoleSummary || diagnostics.examples.primaryDriverSummary}
            </p>
          </article>
          <article className="stage2-insight-card">
            <span className="field-label">Анализатор</span>
            <strong>{diagnostics.analysis.sceneBeats.length} смысловых ударов</strong>
            <p className="subtle-text">
              {diagnostics.analysis.revealMoment || diagnostics.analysis.firstSecondsSignal || "прочтение последовательности"}
            </p>
          </article>
          <article className="stage2-insight-card">
            <span className="field-label">Переопределения</span>
            <strong>{overrideCount}</strong>
            <p className="subtle-text">этапов используют промпты, отличные от базовых</p>
          </article>
          {stage2Result?.tokenUsage ? (
            <article className="stage2-insight-card">
              <span className="field-label">LLM budget</span>
              <strong>
                {formatInteger(stage2Result.tokenUsage.totalEstimatedInputTokens) ?? "0"} in ·{" "}
                {formatInteger(stage2Result.tokenUsage.totalEstimatedOutputTokens) ?? "0"} out
              </strong>
              <p className="subtle-text">
                {formatInteger(stage2Result.tokenUsage.totalPromptChars) ?? "0"} символов промптов
                {" · "}
                {formatByteCount(stage2Result.tokenUsage.totalPersistedPayloadBytes) ?? "n/a"} сохранено
              </p>
            </article>
          ) : null}
        </div>
      </section>

      <details className="details-drawer">
        <summary>
          <span>Чтение клипа анализатором</span>
          <small>Что Stage 2 увидел в последовательности клипа</small>
        </summary>
        <div className="details-content">
          <section className="details-section">
            <h3>Понимание последовательности</h3>
            {diagnostics.analysis.rawSummary ? (
              <p className="subtle-text">{diagnostics.analysis.rawSummary}</p>
            ) : null}
            {diagnostics.analysis.firstSecondsSignal ? (
              <p className="subtle-text">Открывающий сигнал: {diagnostics.analysis.firstSecondsSignal}</p>
            ) : null}
            {diagnostics.analysis.revealMoment ? (
              <p className="subtle-text">Момент раскрытия: {diagnostics.analysis.revealMoment}</p>
            ) : null}
            {diagnostics.analysis.lateClipChange ? (
              <p className="subtle-text">Поздний поворот клипа: {diagnostics.analysis.lateClipChange}</p>
            ) : null}
            {diagnostics.selection.coreTrigger ? (
              <p className="subtle-text">Главный триггер: {diagnostics.selection.coreTrigger}</p>
            ) : null}
            {diagnostics.selection.whyViewerCares ? (
              <p className="subtle-text">Почему зрителю не всё равно: {diagnostics.selection.whyViewerCares}</p>
            ) : null}
            {diagnostics.analysis.commentVibe ? (
              <p className="subtle-text">Чтение комментариев: {diagnostics.analysis.commentVibe}</p>
            ) : null}
            {diagnostics.analysis.bestBottomEnergy ? (
              <p className="subtle-text">
                Натуральная энергия bottom: {diagnostics.analysis.bestBottomEnergy}
              </p>
            ) : null}
            {diagnostics.analysis.commentConsensusLane ? (
              <p className="subtle-text">
                Consensus lane: {diagnostics.analysis.commentConsensusLane}
              </p>
            ) : null}
            {diagnostics.analysis.commentJokeLane ? (
              <p className="subtle-text">
                Joke lane: {diagnostics.analysis.commentJokeLane}
              </p>
            ) : null}
            {diagnostics.analysis.commentDissentLane ? (
              <p className="subtle-text">
                Dissent lane: {diagnostics.analysis.commentDissentLane}
              </p>
            ) : null}
            {diagnostics.analysis.commentSuspicionLane ? (
              <p className="subtle-text">
                Suspicion lane: {diagnostics.analysis.commentSuspicionLane}
              </p>
            ) : null}
            {diagnostics.analysis.slangToAdapt?.length ? (
              <p className="subtle-text">
                Фразы аудитории: {diagnostics.analysis.slangToAdapt.join(" · ")}
              </p>
            ) : null}
            {diagnostics.analysis.commentLanguageCues?.length ? (
              <p className="subtle-text">
                Живые языковые cues: {diagnostics.analysis.commentLanguageCues.join(" · ")}
              </p>
            ) : null}
            {diagnostics.analysis.hiddenDetail ? (
              <p className="subtle-text">Скрытая деталь: {diagnostics.analysis.hiddenDetail}</p>
            ) : null}
            {diagnostics.analysis.sceneBeats.length > 0 ? (
              <p className="subtle-text">Смысловые удары: {diagnostics.analysis.sceneBeats.join(" · ")}</p>
            ) : null}
            {diagnostics.analysis.genericRisks?.length ? (
              <p className="subtle-text">
                Чего избегать: {diagnostics.analysis.genericRisks.join(" · ")}
              </p>
            ) : null}
            {diagnostics.analysis.uncertaintyNotes.length > 0 ? (
              <p className="subtle-text">
                Неопределённость: {diagnostics.analysis.uncertaintyNotes.join(" · ")}
              </p>
            ) : null}
          </section>
        </div>
      </details>

      <details
        className="details-drawer"
        onToggle={(event) => {
          if (
            (event.currentTarget as HTMLDetailsElement).open &&
            hasDeferredPromptStages &&
            canLoadRawPromptArtifact
          ) {
            void loadRawPromptArtifact();
          }
        }}
      >
        <summary>
          <span>Эффективные промпты</span>
          <small>Что реально ведёт Stage 2</small>
        </summary>
        <div className="details-content">
          <p className="subtle-text">
            Здесь видно, какой конкретный промпт и какой уровень рассуждений реально были настроены
            для каждого Stage 2 этапа.
          </p>
          {hasDeferredPromptStages && canLoadRawPromptArtifact ? (
            <p className="subtle-text">
              Raw prompt contexts вынесены из основного Stage 2 payload и подгружаются отдельно
              только при открытии этого блока.
            </p>
          ) : null}
          {rawDebugArtifactLoading ? (
            <p className="subtle-text">Подгружаем raw prompt context…</p>
          ) : null}
          {rawDebugArtifactError ? (
            <p className="subtle-text danger-text">{rawDebugArtifactError}</p>
          ) : null}
          <div className="stage2-prompt-stage-list">
            {diagnostics.effectivePrompting.promptStages.map((stage) => {
              const resolvedPromptText =
                stage.promptText ?? rawPromptTextByStageId.get(stage.stageId) ?? null;
              return (
                <article key={stage.stageId} className="stage2-prompt-stage-card">
                  <div className="stage2-prompt-stage-head">
                    <div>
                      <strong>{stage.label}</strong>
                      <p className="subtle-text">
                        LLM-этап
                        {" · системный промпт"}
                        {stage.usesImages ? " · использует извлечённые кадры" : ""}
                        {stage.promptChars ? ` · ${stage.promptChars} символов` : ""}
                      </p>
                    </div>
                    {stage.isCustomPrompt ? (
                      <span className="badge">Свой промпт</span>
                    ) : (
                      <span className="badge muted">Базовый промпт</span>
                    )}
                  </div>
                  <p className="subtle-text">{stage.summary}</p>
                  <div className="stage2-prompt-meta-row">
                    <div className="stage2-prompt-meta">
                      <span className="field-label">Уровень рассуждений</span>
                      <p className="text-block">{formatReasoningEffort(stage.reasoningEffort)}</p>
                    </div>
                    <div className="stage2-prompt-meta">
                      <span className="field-label">Источник промпта</span>
                      <p className="text-block">
                        {stage.isCustomPrompt ? "Промпт канала" : "Базовый промпт"}
                      </p>
                    </div>
                    {stage.estimatedInputTokens != null || stage.estimatedOutputTokens != null ? (
                      <div className="stage2-prompt-meta">
                        <span className="field-label">Token budget</span>
                        <p className="text-block">
                          {formatInteger(stage.estimatedInputTokens) ?? "0"} in ·{" "}
                          {formatInteger(stage.estimatedOutputTokens) ?? "0"} out
                        </p>
                      </div>
                    ) : null}
                  </div>
                  <div className="stage2-prompt-meta-row">
                    <div className="stage2-prompt-meta">
                      <span className="field-label">Текущий промпт</span>
                      <p className="text-block">{stage.configuredPrompt}</p>
                    </div>
                    {stage.serializedResultBytes != null || stage.persistedPayloadBytes != null ? (
                      <div className="stage2-prompt-meta">
                        <span className="field-label">Payload</span>
                        <p className="text-block">
                          {formatByteCount(stage.serializedResultBytes) ?? "n/a"} result ·{" "}
                          {formatByteCount(stage.persistedPayloadBytes) ?? "n/a"} saved
                        </p>
                      </div>
                    ) : null}
                  </div>
                  <details className="advanced-block">
                    <summary>Показать полный промпт с контекстом</summary>
                    <div className="advanced-content">
                      {resolvedPromptText ? (
                        <pre className="json-view">{resolvedPromptText}</pre>
                      ) : rawDebugArtifactLoading && stage.promptTextAvailable && canLoadRawPromptArtifact ? (
                        <p className="subtle-text">Подгружаем raw prompt context…</p>
                      ) : rawDebugArtifactError && stage.promptTextAvailable && canLoadRawPromptArtifact ? (
                        <p className="subtle-text danger-text">{rawDebugArtifactError}</p>
                      ) : stage.promptTextAvailable && canLoadRawPromptArtifact ? (
                        <p className="subtle-text">
                          Raw prompt context хранится отдельно и загрузится при открытии блока
                          “Эффективные промпты”.
                        </p>
                      ) : (
                        <p className="subtle-text">
                          Raw prompt context больше не хранится inline в обычном результате Stage 2.
                        </p>
                      )}
                    </div>
                  </details>
                </article>
              );
            })}
          </div>
        </div>
      </details>

      <details className="details-drawer">
        <summary>
          <span>Использованные примеры</span>
          <small>Активный корпус и выбор селектора</small>
        </summary>
        <div className="details-content">
          <section className="details-section">
            <h3>Контекст выбора</h3>
            <p className="subtle-text">Краткая задача для генератора: {diagnostics.selection.writerBrief}</p>
            <p className="subtle-text">
              Retrieval: {formatExamplesModeLabel(diagnostics.examples.examplesMode)} ·{" "}
              {formatRetrievalConfidenceLabel(diagnostics.examples.retrievalConfidence)}
            </p>
            {diagnostics.examples.explanation ? (
              <p className="subtle-text">{diagnostics.examples.explanation}</p>
            ) : null}
            {diagnostics.examples.retrievalWarning ? (
              <p className="subtle-text danger-text">{diagnostics.examples.retrievalWarning}</p>
            ) : null}
            {diagnostics.examples.primaryDriverSummary ? (
              <p className="subtle-text">
                Что реально вело run: {diagnostics.examples.primaryDriverSummary}
              </p>
            ) : null}
            {diagnostics.examples.primaryDrivers.length > 0 ? (
              <p className="subtle-text">
                Порядок влияния: {diagnostics.examples.primaryDrivers.join(" · ")}
              </p>
            ) : null}
            {diagnostics.examples.evidence.length > 0 ? (
              <p className="subtle-text">
                Почему выбран этот режим: {diagnostics.examples.evidence.join(" · ")}
              </p>
            ) : null}
            <p className="subtle-text">
              Ранжированные углы: {diagnostics.selection.rankedAngles.map((item) => `${item.angle} (${item.score.toFixed(1)})`).join(", ")}
            </p>
            {diagnostics.selection.rationale ? (
              <p className="subtle-text">Почему селектор выбрал это: {diagnostics.selection.rationale}</p>
            ) : null}
            <p className="subtle-text">
              Источник корпуса: {formatExamplesSourceLabel(diagnostics.examples.source)} · активно{" "}
              {diagnostics.examples.activeCorpusCount} · селектор увидел{" "}
              {diagnostics.examples.selectorCandidateCount} / из общего корпуса{" "}
              {diagnostics.examples.workspaceCorpusCount}
            </p>
          </section>

          {([
            ["selectedExamples", "Выбранные селектором"],
            ["availableExamples", "Пул примеров в промпте селектора"]
          ] as const).map(([key, label]) => {
            const items = diagnostics.examples[key];
            return (
              <section key={key} className="details-section">
                <h3>
                  {label} ({items.length})
                </h3>
                {items.length === 0 ? (
                  <p className="subtle-text">В этом запуске элементов не было.</p>
                ) : (
                  <ul className="stage2-example-list">
                    {items.map((item, index) => (
                      <li key={`${key}-${item.sourceChannelId}-${item.title}-${index}`} className="stage2-example-card">
                        <div className="stage2-example-head">
                          <strong>{item.title}</strong>
                          <span className="subtle-text">
                            {item.sourceChannelName} · {item.clipType}
                          </span>
                        </div>
                        <p className="subtle-text">
                          TOP: {truncateText(item.overlayTop)}
                        </p>
                        <p className="subtle-text">
                          BOTTOM: {truncateText(item.overlayBottom)}
                        </p>
                        <p className="subtle-text">
                          {formatGuidanceRoleLabel(item.guidanceRole)} · quality {formatNullableNumber(item.qualityScore) ?? "n/a"} · score {formatNullableNumber(item.retrievalScore) ?? "n/a"} · {item.sampleKind ?? "n/a"}
                        </p>
                        {item.whyItWorks.length > 0 ? (
                          <p className="subtle-text">
                            Why it works: {item.whyItWorks.join(", ")}
                          </p>
                        ) : null}
                        {item.retrievalReasons.length > 0 ? (
                          <p className="subtle-text">
                            Выбрано потому что: {item.retrievalReasons.join(", ")}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </details>
    </>
  );
}

export function Step2PickCaption({
  channelName,
  channelUsername,
  stage2,
  progress,
  stageCreatedAt,
  commentsAvailable = true,
  instruction,
  runs,
  selectedRunId,
  currentRunStatus,
  currentRunError,
  canRunStage2,
  canQuickRegenerate,
  runBlockedReason,
  quickRegenerateBlockedReason,
  canSubmitFeedback = false,
  feedbackHistory = [],
  feedbackHistoryLoading = false,
  isLaunching,
  isRunning,
  expectedDurationMs,
  elapsedMs,
  selectedOption,
  selectedTitleOption,
  onInstructionChange,
  onQuickRegenerate,
  onRunStage2,
  onSelectRun,
  onSelectOption,
  onSelectTitleOption,
  onSubmitOptionFeedback,
  onDeleteFeedbackEvent,
  deletingFeedbackEventId = null,
  onCopy
}: Step2PickCaptionProps) {
  const [jsonOpen, setJsonOpen] = useState(false);
  const [regenerationDetailsOpen, setRegenerationDetailsOpen] = useState(false);
  const [runStatusOpen, setRunStatusOpen] = useState(false);
  const [feedbackDraft, setFeedbackDraft] = useState<{
    option: number;
    scope: "option" | "top" | "bottom";
    kind: "more_like_this" | "less_like_this";
    noteMode: ChannelEditorialFeedbackNoteMode;
    note: string;
    status: "idle" | "saving" | "saved" | "error";
    message: string | null;
  } | null>(null);
  const selectedRun = useMemo(
    () => runs.find((run) => run.runId === selectedRunId) ?? null,
    [runs, selectedRunId]
  );
  const hasActiveRunWithoutResult =
    !stage2 &&
    (currentRunStatus === "queued" ||
      currentRunStatus === "running" ||
      selectedRun?.status === "queued" ||
      selectedRun?.status === "running");

  useEffect(() => {
    if (!stage2) {
      return;
    }
    if (!selectedOption) {
      onSelectOption(stage2.output.finalPick.option);
    }
  }, [onSelectOption, selectedOption, stage2]);

  const activeOption = useMemo(() => {
    if (!stage2) {
      return null;
    }
    const preferred = selectedOption ?? stage2.output.finalPick.option;
    return (
      stage2.output.captionOptions.find((item) => item.option === preferred) ??
      stage2.output.captionOptions[0] ??
      null
    );
  }, [selectedOption, stage2]);
  const activeTitleOption = useMemo(() => {
    if (!stage2) {
      return null;
    }
    const preferred = selectedTitleOption ?? stage2.output.titleOptions[0]?.option ?? 1;
    return (
      stage2.output.titleOptions.find((item) => item.option === preferred) ??
      stage2.output.titleOptions[0] ??
      null
    );
  }, [selectedTitleOption, stage2]);
  const sourceProviderLabel = formatSourceProviderLabel(stage2?.source.downloadProvider);
  const commentsAcquisitionLabel = formatCommentsAcquisitionLabel(stage2?.source ?? null);
  const pendingFeedbackSinceVisibleRun = useMemo(() => {
    if (!stage2 || feedbackHistory.length === 0) {
      return [];
    }
    const baselineValue = stageCreatedAt ?? stage2.stage2Run?.createdAt ?? null;
    const baselineTs = baselineValue ? Date.parse(baselineValue) : Number.NaN;
    if (!Number.isFinite(baselineTs)) {
      return [];
    }
    return feedbackHistory.filter((event) => {
      const createdAtTs = Date.parse(event.createdAt);
      return Number.isFinite(createdAtTs) && createdAtTs > baselineTs;
    });
  }, [feedbackHistory, stage2, stageCreatedAt]);
  const pendingFeedbackSummary = useMemo(() => {
    if (pendingFeedbackSinceVisibleRun.length === 0) {
      return null;
    }
    const positiveCount = pendingFeedbackSinceVisibleRun.filter(
      (event) => event.kind === "more_like_this"
    ).length;
    const negativeCount = pendingFeedbackSinceVisibleRun.filter(
      (event) => event.kind === "less_like_this"
    ).length;
    const noteCount = pendingFeedbackSinceVisibleRun.filter(
      (event) => Boolean(event.note?.trim())
    ).length;
    const countLabel = formatReactionCountLabel(pendingFeedbackSinceVisibleRun.length);
    const noteLabel =
      noteCount > 0
        ? ` · ${noteCount} ${formatRussianCount(noteCount, "с заметкой", "с заметками", "с заметками")}`
        : "";
    return {
      count: pendingFeedbackSinceVisibleRun.length,
      badgeLabel: `+${pendingFeedbackSinceVisibleRun.length}`,
      title: `Новые реакции: ${countLabel}`,
      detail:
        `Новые редакторские сигналы с последнего запуска: ${countLabel} (${positiveCount} 👍 / ${negativeCount} 👎)` +
        `${noteLabel}. Быстрая перегенерация и полный прогон Stage 2 учтут их в следующем запуске.`
    };
  }, [pendingFeedbackSinceVisibleRun]);
  const visibleProgress = progress ?? stage2?.progress ?? null;
  const activeProgressStep = useMemo(() => {
    if (!visibleProgress) {
      return null;
    }
    return (
      visibleProgress.steps.find((step) => step.id === visibleProgress.activeStageId) ??
      visibleProgress.steps.find((step) => step.state === "running") ??
      null
    );
  }, [visibleProgress]);
  const failedProgressStepIndex = useMemo(() => {
    if (!visibleProgress || visibleProgress.status !== "failed") {
      return -1;
    }
    const explicitFailedIndex = visibleProgress.steps.findIndex((step) => step.state === "failed");
    if (explicitFailedIndex >= 0) {
      return explicitFailedIndex;
    }
    return visibleProgress.activeStageId
      ? visibleProgress.steps.findIndex((step) => step.id === visibleProgress.activeStageId)
      : -1;
  }, [visibleProgress]);
  const progressRatio = useMemo(
    () => getStage2ProgressRatio(elapsedMs, expectedDurationMs),
    [elapsedMs, expectedDurationMs]
  );
  const isAttachedStage2Run =
    (isRunning || currentRunStatus === "queued" || currentRunStatus === "running") &&
    typeof runBlockedReason === "string" &&
    runBlockedReason.startsWith("Для этого чата уже идёт Stage 2.");
  const inlineRunMessage = isAttachedStage2Run
    ? "Stage 2 уже выполняется в фоне. Ниже показан текущий подключённый запуск."
    : runBlockedReason ?? null;
  const activeRunSummary = useMemo(() => {
    if (!selectedRun) {
      return null;
    }
    return {
      title: `Запуск ${selectedRun.runId.slice(0, 8)}`,
      detail: `${formatRunStatusLabel(selectedRun.status)} · ${formatRunModeLabel(selectedRun.mode)} · ${formatDate(selectedRun.createdAt)}${
        currentRunError ? ` · ${currentRunError}` : ""
      }`
    };
  }, [currentRunError, selectedRun]);
  const activeProgressSummary = useMemo(() => {
    if (isRunning || hasActiveRunWithoutResult) {
      return activeProgressStep
        ? `Сейчас идёт ${activeProgressStep.shortLabel.toLowerCase()}.`
        : "Stage 2 выполняется в фоне.";
    }
    if (visibleProgress?.status === "failed") {
      return "Последний запуск остановился с ошибкой. Детали ниже в истории запуска.";
    }
    if (visibleProgress?.status === "completed") {
      return "Последний запуск Stage 2 завершился успешно.";
    }
    return null;
  }, [activeProgressStep, hasActiveRunWithoutResult, isRunning, visibleProgress]);

  useEffect(() => {
    setFeedbackDraft(null);
  }, [stage2?.stage2Run?.runId]);

  useEffect(() => {
    if (instruction.trim() || pendingFeedbackSummary) {
      setRegenerationDetailsOpen(true);
    }
  }, [instruction, pendingFeedbackSummary]);

  useEffect(() => {
    if (
      isRunning ||
      hasActiveRunWithoutResult ||
      currentRunStatus === "failed" ||
      visibleProgress?.status === "failed"
    ) {
      setRunStatusOpen(true);
    }
  }, [currentRunStatus, hasActiveRunWithoutResult, isRunning, visibleProgress]);

  const openFeedbackComposer = (
    option: number,
    scope: "option" | "top" | "bottom",
    kind: "more_like_this" | "less_like_this"
  ) => {
    setFeedbackDraft((current) => {
      if (current?.option === option && current.scope === scope && current.kind === kind) {
        return current;
      }
      return {
        option,
        scope,
        kind,
        noteMode: "soft_preference",
        note: "",
        status: "idle",
        message: null
      };
    });
  };

  const submitFeedback = async (): Promise<void> => {
    if (!feedbackDraft || !onSubmitOptionFeedback) {
      return;
    }
    setFeedbackDraft((current) =>
      current
        ? {
            ...current,
            status: "saving",
            message: null
          }
        : current
    );
    try {
      await onSubmitOptionFeedback({
        option: feedbackDraft.option,
        kind: feedbackDraft.kind,
        scope: feedbackDraft.scope,
        noteMode: feedbackDraft.noteMode,
        note: feedbackDraft.note
      });
      setFeedbackDraft(null);
    } catch (error) {
      setFeedbackDraft((current) =>
        current
          ? {
              ...current,
              status: "error",
              message: error instanceof Error ? error.message : "Не удалось сохранить обратную связь."
            }
          : current
      );
    }
  };

  const handleChooseOption = (option: number): void => {
    const changed = selectedOption !== option;
    onSelectOption(option);
    if (!changed || !canSubmitFeedback || !onSubmitOptionFeedback) {
      return;
    }
    void onSubmitOptionFeedback({
      option,
      kind: "selected_option",
      scope: "option",
      noteMode: "soft_preference",
      note: ""
    }).catch(() => undefined);
  };

  return (
    <StepWorkspace
      editLabel="Редактирование"
      previewLabel="Предпросмотр"
      left={
        <div className="step-panel-stack">
          <header className="step-head">
            <p className="kicker">Шаг 2</p>
            <h2>Выбор</h2>
            <p>
              Сгенерируйте варианты, быстро сравните их и выберите основу для рендера. Финальную ручную
              правку TOP/BOTTOM лучше делать уже на шаге 3.
            </p>
            {channelName ||
            stageCreatedAt ||
            sourceProviderLabel ||
            commentsAcquisitionLabel ||
            !commentsAvailable ? (
              <details className="advanced-block">
                <summary>Контекст запуска</summary>
                <div className="advanced-content">
                  {channelName ? (
                    <p className="subtle-text">
                      Канал: <strong>{channelName}</strong>
                      {channelUsername ? ` (@${channelUsername})` : ""}
                    </p>
                  ) : null}
                  {stageCreatedAt ? (
                    <p className="subtle-text">Обновлено: {formatDate(stageCreatedAt)}</p>
                  ) : null}
                  {sourceProviderLabel ? (
                    <p className="subtle-text">Источник медиа: {sourceProviderLabel}</p>
                  ) : null}
                  {commentsAcquisitionLabel ? (
                    <p className="subtle-text">Комментарии: {commentsAcquisitionLabel}</p>
                  ) : null}
                  {!commentsAvailable ? (
                    <p className="subtle-text">
                      Комментарии недоступны на этом сервере. Второй этап использует только видеоконтекст.
                    </p>
                  ) : null}
                </div>
              </details>
            ) : null}
          </header>

          <section className="control-card">
            <div className="control-section-head">
              <div>
                <h3>Перегенерация</h3>
                <p className="subtle-text">
                  На поверхности только перезапуск. Все пояснения и тонкие настройки спрятаны ниже.
                </p>
              </div>
            </div>
            {pendingFeedbackSummary ? (
              <div className="stage2-feedback-delta" aria-live="polite">
                <span className="stage2-feedback-delta-badge">{pendingFeedbackSummary.title}</span>
                <span className="subtle-text">{pendingFeedbackSummary.detail}</span>
              </div>
            ) : null}
            {activeRunSummary || activeProgressSummary ? (
              <div className="stage2-feedback-delta" aria-live="polite">
                {activeRunSummary ? (
                  <span className="stage2-feedback-delta-badge">{activeRunSummary.title}</span>
                ) : null}
                <span className="subtle-text">
                  {activeRunSummary?.detail}
                  {activeRunSummary && activeProgressSummary ? " · " : ""}
                  {activeProgressSummary}
                </span>
              </div>
            ) : null}
            <div className="control-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={onQuickRegenerate}
                disabled={!canQuickRegenerate}
                aria-busy={isLaunching}
                title={
                  !canQuickRegenerate && !isAttachedStage2Run
                    ? quickRegenerateBlockedReason ?? undefined
                    : undefined
                }
              >
                <span className="btn-inline-content">
                  <span>{isLaunching ? "Запускаем..." : "Перегенерировать варианты"}</span>
                  {pendingFeedbackSummary && !isLaunching ? (
                    <span className="stage2-feedback-button-badge" aria-hidden="true">
                      {pendingFeedbackSummary.badgeLabel}
                    </span>
                  ) : null}
                </span>
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onRunStage2}
                disabled={!canRunStage2}
                aria-busy={isLaunching}
                title={!canRunStage2 && !isAttachedStage2Run ? runBlockedReason ?? undefined : undefined}
              >
                <span className="btn-inline-content">
                  <span>{isLaunching ? "Запускаем..." : "Полный прогон Stage 2"}</span>
                  {pendingFeedbackSummary && !isLaunching ? (
                    <span className="stage2-feedback-button-badge" aria-hidden="true">
                      {pendingFeedbackSummary.badgeLabel}
                    </span>
                  ) : null}
                </span>
              </button>
            </div>
            <details
              className="advanced-block"
              open={regenerationDetailsOpen}
              onToggle={(event) => setRegenerationDetailsOpen(event.currentTarget.open)}
            >
              <summary>Тонкая настройка</summary>
              <div className="advanced-content">
                <label className="field-label" htmlFor="instruction">
                  Инструкция для перегенерации
                </label>
                <textarea
                  id="instruction"
                  className="text-area"
                  rows={3}
                  value={instruction}
                  onChange={(event) => onInstructionChange(event.target.value.slice(0, 2000))}
                  placeholder="Например: сделай короче, добавь одну сухую шутку, избегай сленга."
                />
                <p className="subtle-text">
                  Быстрая перегенерация использует текущий выбранный запуск как базу. Полный прогон
                  заново проходит весь пайплайн Stage 2.
                </p>
              </div>
            </details>
            {visibleProgress || runs.length > 0 || inlineRunMessage ? (
              <details
                className="advanced-block"
                open={runStatusOpen}
                onToggle={(event) => setRunStatusOpen(event.currentTarget.open)}
              >
                <summary>Статус и история запусков</summary>
                <div className="advanced-content">
                  <section className="stage2-timing-card" aria-live="polite">
                    <div className="stage2-timing-row">
                      <span className="field-label">Обычно занимает</span>
                      <strong>{formatDurationMs(expectedDurationMs)}</strong>
                    </div>
                    <div className="stage2-timing-row">
                      <span className="field-label">{isRunning ? "Прошло" : "Последний ориентир"}</span>
                      <strong>{formatDurationMs(isRunning ? elapsedMs : expectedDurationMs)}</strong>
                    </div>
                    <div
                      className="stage2-progress"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(progressRatio * 100)}
                    >
                      <div
                        className="stage2-progress-fill"
                        style={{ width: `${(progressRatio * 100).toFixed(1)}%` }}
                      />
                    </div>
                    <p className="subtle-text">
                      {isRunning
                        ? elapsedMs > expectedDurationMs
                          ? "Уже дольше обычного, но процесс продолжается."
                          : activeProgressStep
                            ? `Сейчас: ${activeProgressStep.shortLabel}.`
                            : "Идет генерация. Оценка основана на предыдущем успешном запуске."
                        : visibleProgress?.status === "failed"
                          ? "Последний запуск остановился на этапе, отмеченном ниже."
                          : visibleProgress?.status === "completed"
                            ? "Последний запуск завершился по шагам ниже."
                            : "Оценка обновляется после каждого успешного запуска второго этапа."}
                    </p>
                    {selectedRun ? (
                      <p className={`subtle-text ${currentRunStatus === "failed" ? "danger-text" : ""}`}>
                        Запуск {selectedRun.runId.slice(0, 8)} · {formatRunStatusLabel(selectedRun.status)}
                        {` · ${formatRunModeLabel(selectedRun.mode)}`}
                        {currentRunError ? ` · ${currentRunError}` : ""}
                      </p>
                    ) : null}
                    {visibleProgress ? (
                      <ol className="stage2-stage-list" aria-label="Прогресс пайплайна Stage 2">
                        {visibleProgress.steps.map((step, index) => {
                          const isActive =
                            visibleProgress.activeStageId === step.id || step.state === "running";
                          const blockedAfterFailure =
                            visibleProgress.status === "failed" &&
                            failedProgressStepIndex >= 0 &&
                            index > failedProgressStepIndex &&
                            step.state === "pending";
                          const displayState = blockedAfterFailure ? "blocked" : step.state;
                          const displayStatusLabel = formatStageProgressStatusLabel({
                            stepState: step.state,
                            progressStatus: visibleProgress.status,
                            blockedAfterFailure
                          });
                          const displayDetail = blockedAfterFailure
                            ? "Этот этап не запускался, потому что запуск завершился ошибкой на предыдущем шаге."
                            : step.detail;
                          return (
                            <li
                              key={step.id}
                              className={`stage2-stage-item state-${displayState} ${isActive ? "is-active" : ""}`}
                              aria-current={isActive ? "step" : undefined}
                            >
                              <div className="stage2-stage-index">{index + 1}</div>
                              <div className="stage2-stage-body">
                                <div className="stage2-stage-head">
                                  <strong>{step.shortLabel}</strong>
                                  <span className="subtle-text">{displayStatusLabel}</span>
                                </div>
                                <p className="subtle-text">{step.description}</p>
                                {step.summary &&
                                step.summary !== step.description &&
                                step.summary !== displayDetail ? (
                                  <p className="subtle-text">{step.summary}</p>
                                ) : null}
                                {displayDetail && displayDetail !== step.description ? (
                                  isVerboseStageDetail(displayDetail) ? (
                                    <details className="stage2-stage-detail-toggle">
                                      <summary>
                                        <span>
                                          {step.state === "failed"
                                            ? "Показать лог ошибки"
                                            : "Показать детали этапа"}
                                        </span>
                                        {summarizeStageDetail(displayDetail) ? (
                                          <small>{summarizeStageDetail(displayDetail)}</small>
                                        ) : null}
                                      </summary>
                                      <div className="stage2-stage-detail-panel">
                                        <pre className="stage2-stage-detail-log">{displayDetail}</pre>
                                      </div>
                                    </details>
                                  ) : (
                                    <p className="subtle-text">{displayDetail}</p>
                                  )
                                ) : null}
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    ) : null}
                  </section>
                  {runs.length > 0 ? (
                    <section className="stage2-run-picker" aria-label="История запусков Stage 2">
                      <div className="stage2-run-picker-head">
                        <span className="field-label">Запуски</span>
                        <span className="subtle-text">
                          Текущий экран привязан к устойчивому состоянию запуска, а не к просто
                          открытой вкладке.
                        </span>
                      </div>
                      <div className="stage2-run-pill-list">
                        {runs.map((run) => (
                          <button
                            key={run.runId}
                            type="button"
                            className={`stage2-run-pill ${selectedRunId === run.runId ? "is-active" : ""} status-${run.status}`}
                            onClick={() => onSelectRun(run.runId)}
                          >
                            <strong>{formatRunStatusLabel(run.status)} · {formatRunModeLabel(run.mode)}</strong>
                            <span>{formatDate(run.createdAt)}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                  ) : null}
                </div>
              </details>
            ) : null}
            {!canRunStage2 && inlineRunMessage ? (
              <p className={`subtle-text${isAttachedStage2Run ? "" : " danger-text"}`}>{inlineRunMessage}</p>
            ) : null}
          </section>

          {!stage2 ? (
            <div className="empty-box">
              {hasActiveRunWithoutResult
                ? "Результат этого запуска ещё не готов. Прогресс второго этапа уже идёт выше и появится здесь сразу после завершения."
                : "Результат второго этапа пуст. Сначала запустите второй этап."}
              {!commentsAvailable && !hasActiveRunWithoutResult
                ? " Комментарии необязательны для этого запуска."
                : ""}
            </div>
          ) : (
            <>
              <section className="options-grid options-grid-stage2">
                {stage2.output.captionOptions.map((option) => {
                  const selected = activeOption?.option === option.option;
                  const finalPick = stage2.output.finalPick.option === option.option;
                  const topRu = option.topRu?.trim() || option.top;
                  const bottomRu = option.bottomRu?.trim() || option.bottom;

                  return (
                    <article
                      key={option.option}
                      className={`option-card ${selected ? "selected" : ""}`}
                      aria-label={`Caption option ${option.option}`}
                    >
                      <div className="option-card-head">
                        <div className="option-title-row">
                          <h3>Вариант {option.option}</h3>
                          {finalPick ? <span className="badge">Финальный выбор</span> : null}
                          {selected ? <span className="badge muted">Выбран</span> : null}
                          {option.explorationMode === "exploratory" ? (
                            <span className="badge muted">Эксперимент</span>
                          ) : null}
                        </div>
                        <div className="option-actions">
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => handleChooseOption(option.option)}
                          >
                            Выбрать
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() =>
                              onCopy(
                                [
                                  `TOP EN: ${option.top}`,
                                  `TOP RU: ${topRu}`,
                                  `BOTTOM EN: ${option.bottom}`,
                                  `BOTTOM RU: ${bottomRu}`
                                ].join("\n"),
                                `Вариант ${option.option} скопирован.`
                              )
                            }
                          >
                            Копировать
                          </button>
                          {canSubmitFeedback ? (
                            <div className="option-feedback-hover-actions">
                              <button
                                type="button"
                                className="btn btn-ghost option-feedback-icon-btn"
                                title="Лайкнуть весь вариант"
                                aria-label={`Лайкнуть вариант ${option.option}`}
                                onClick={() => openFeedbackComposer(option.option, "option", "more_like_this")}
                              >
                                <span aria-hidden="true">👍</span>
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost option-feedback-icon-btn"
                                title="Дизлайкнуть весь вариант"
                                aria-label={`Дизлайкнуть вариант ${option.option}`}
                                onClick={() => openFeedbackComposer(option.option, "option", "less_like_this")}
                              >
                                <span aria-hidden="true">👎</span>
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="translation-row">
                        <div className="option-feedback-scope-head">
                          <span className="field-label">TOP</span>
                          {canSubmitFeedback ? (
                            <div className="option-feedback-scope-actions">
                              <button
                                type="button"
                                className="btn btn-ghost option-feedback-icon-btn"
                                title="Лайкнуть только TOP"
                                aria-label={`Лайкнуть TOP варианта ${option.option}`}
                                onClick={() => openFeedbackComposer(option.option, "top", "more_like_this")}
                              >
                                <span aria-hidden="true">👍</span>
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost option-feedback-icon-btn"
                                title="Дизлайкнуть только TOP"
                                aria-label={`Дизлайкнуть TOP варианта ${option.option}`}
                                onClick={() => openFeedbackComposer(option.option, "top", "less_like_this")}
                              >
                                <span aria-hidden="true">👎</span>
                              </button>
                            </div>
                          ) : null}
                        </div>
                        <div className="translation-grid">
                          <div className="translation-col">
                            <span className="translation-label">EN</span>
                            <p className="text-block">{option.top}</p>
                          </div>
                          <div className="translation-col">
                            <span className="translation-label">RU</span>
                            <p className="text-block">{topRu}</p>
                          </div>
                        </div>
                      </div>
                      <div className="translation-row">
                        <div className="option-feedback-scope-head">
                          <span className="field-label">BOTTOM</span>
                          {canSubmitFeedback ? (
                            <div className="option-feedback-scope-actions">
                              <button
                                type="button"
                                className="btn btn-ghost option-feedback-icon-btn"
                                title="Лайкнуть только BOTTOM"
                                aria-label={`Лайкнуть BOTTOM варианта ${option.option}`}
                                onClick={() => openFeedbackComposer(option.option, "bottom", "more_like_this")}
                              >
                                <span aria-hidden="true">👍</span>
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost option-feedback-icon-btn"
                                title="Дизлайкнуть только BOTTOM"
                                aria-label={`Дизлайкнуть BOTTOM варианта ${option.option}`}
                                onClick={() => openFeedbackComposer(option.option, "bottom", "less_like_this")}
                              >
                                <span aria-hidden="true">👎</span>
                              </button>
                            </div>
                          ) : null}
                        </div>
                        <div className="translation-grid">
                          <div className="translation-col">
                            <span className="translation-label">EN</span>
                            <p className="text-block">{option.bottom}</p>
                          </div>
                          <div className="translation-col">
                            <span className="translation-label">RU</span>
                            <p className="text-block">{bottomRu}</p>
                          </div>
                        </div>
                      </div>
                      {feedbackDraft?.option === option.option ? (
                        <div className="option-feedback-panel">
                          <div className="option-feedback-head">
                            <strong>
                              {feedbackDraft.kind === "more_like_this"
                                ? "Лайк"
                                : "Дизлайк"}
                            </strong>
                            <span className="subtle-text">
                              {formatFeedbackScopeLabel(feedbackDraft.scope)} · {formatFeedbackNoteModeLabel(feedbackDraft.noteMode)}
                            </span>
                          </div>
                          <div className="compact-field">
                            <label className="field-label" htmlFor={`feedback-note-mode-${option.option}`}>
                              Режим заметки
                            </label>
                            <select
                              id={`feedback-note-mode-${option.option}`}
                              className="text-input"
                              value={feedbackDraft.noteMode}
                              onChange={(event) =>
                                setFeedbackDraft((current) =>
                                  current
                                    ? {
                                        ...current,
                                        noteMode: event.target.value as ChannelEditorialFeedbackNoteMode,
                                        status: current.status === "saved" ? "idle" : current.status,
                                        message: null
                                      }
                                    : current
                                )
                              }
                            >
                              <option value="soft_preference">Soft preference</option>
                              <option value="hard_rule">Hard rule</option>
                              <option value="situational_note">Situational note</option>
                            </select>
                            <p className="subtle-text">
                              {formatFeedbackNoteModeHelp(feedbackDraft.noteMode)}
                            </p>
                          </div>
                          <textarea
                            className="text-area"
                            rows={3}
                            placeholder="Например: меньше позы, больше живого наблюдения"
                            value={feedbackDraft.note}
                            onChange={(event) =>
                              setFeedbackDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      note: event.target.value,
                                      status: current.status === "saved" ? "idle" : current.status,
                                      message: null
                                    }
                                  : current
                              )
                            }
                          />
                          <div className="option-feedback-actions">
                            <button
                              type="button"
                              className="btn btn-primary"
                              disabled={feedbackDraft.status === "saving"}
                              onClick={() => {
                                void submitFeedback();
                              }}
                            >
                              {feedbackDraft.status === "saving" ? "Сохраняем..." : "Сохранить"}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => setFeedbackDraft(null)}
                            >
                              Отмена
                            </button>
                          </div>
                          {feedbackDraft.message ? (
                            <p
                              className={`subtle-text ${
                                feedbackDraft.status === "error" ? "danger-text" : ""
                              }`}
                            >
                              {feedbackDraft.message}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </section>

              <section className="control-card">
                <div className="option-card-head">
                  <div>
                    <h3>Варианты заголовка</h3>
                    <p className="subtle-text">
                      Выбранный заголовок используется в имени экспортируемого файла.
                    </p>
                  </div>
                </div>
                <div className="options-grid options-grid-stage2">
                  {stage2.output.titleOptions.map((titleOption) => {
                    const selected = activeTitleOption?.option === titleOption.option;
                    const titleRu = titleOption.titleRu?.trim() || titleOption.title;

                    return (
                      <article
                        key={titleOption.option}
                        className={`option-card ${selected ? "selected" : ""}`}
                        aria-label={`Вариант заголовка ${titleOption.option}`}
                      >
                        <div className="option-card-head">
                          <div className="option-title-row">
                            <h3>Заголовок {titleOption.option}</h3>
                            {selected ? <span className="badge muted">Выбран для файла</span> : null}
                          </div>
                          <div className="option-actions">
                            <button
                              type="button"
                            className="btn btn-secondary"
                            onClick={() => onSelectTitleOption(titleOption.option)}
                          >
                              Выбрать
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() =>
                                onCopy(
                                  [`TITLE EN: ${titleOption.title}`, `TITLE RU: ${titleRu}`].join("\n"),
                                  `Заголовок ${titleOption.option} скопирован.`
                                )
                              }
                            >
                              Копировать
                            </button>
                          </div>
                        </div>

                        <div className="translation-row">
                          <span className="field-label">TITLE</span>
                          <div className="translation-grid">
                            <div className="translation-col">
                              <span className="translation-label">EN</span>
                              <p className="text-block">{titleOption.title}</p>
                            </div>
                            <div className="translation-col">
                              <span className="translation-label">RU</span>
                              <p className="text-block">{titleRu}</p>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>

              <details className="advanced-block">
                <summary>SEO, память канала и диагностика</summary>
                <div className="advanced-content">
                  {stage2.seo?.description ? (
                    <section className="control-card seo-card">
                      <div className="option-card-head">
                        <div>
                          <h3 className="seo-card-title">Описание ролика</h3>
                          <p className="subtle-text">Сгенерировано отдельным SEO-запросом после опций.</p>
                        </div>
                        <div className="option-actions">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => onCopy(stage2.seo?.description ?? "", "Описание скопировано.")}
                          >
                            Копировать описание
                          </button>
                          {stage2.seo?.tags ? (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => onCopy(stage2.seo?.tags ?? "", "Tags скопированы.")}
                            >
                              Копировать теги
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <pre className="seo-description-view">{stage2.seo.description}</pre>
                      {stage2.seo.tags ? (
                        <div className="translation-row">
                          <span className="field-label">Теги</span>
                          <p className="text-block seo-tags-view">{stage2.seo.tags}</p>
                        </div>
                      ) : null}
                    </section>
                  ) : null}

                  {stage2.warnings.length > 0 ? (
                    <section className="control-card control-card-subtle">
                      <div className="option-card-head">
                        <div>
                          <h3>Run warnings</h3>
                          <p className="subtle-text">
                            Диагностика рантайма и degraded states. Основной рабочий выбор уже выше.
                          </p>
                        </div>
                      </div>
                      <ul className="stage2-example-list">
                        {stage2.warnings.map((warning, index) => (
                          <li key={`${warning.field}-${index}`} className="stage2-example-card">
                            <strong>{warning.field}</strong>
                            <p className="subtle-text">{warning.message}</p>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}

                  <section className="control-card control-card-subtle">
                    <div className="option-card-head">
                      <div>
                        <h3>Последние реакции канала</h3>
                        <p className="subtle-text">
                          Здесь видны только явные лайки и дизлайки по whole option, TOP или BOTTOM.
                          Автосигнал от простого выбора варианта в эту историю не попадает.
                        </p>
                      </div>
                    </div>
                    {feedbackHistoryLoading ? (
                      <p className="subtle-text">Загружаем историю реакций…</p>
                    ) : feedbackHistory.length > 0 ? (
                      <div className="stage2-example-list">
                        {feedbackHistory.map((event) => (
                          <article key={event.id} className="stage2-example-card">
                            <div className="quick-edit-label-row">
                              <strong>
                                {event.kind === "more_like_this" ? "👍" : "👎"} {formatFeedbackScopeLabel(event.scope)}
                              </strong>
                              <div className="history-item-actions">
                                <span className="subtle-text">{formatFeedbackHistoryTimestamp(event.createdAt)}</span>
                                {canSubmitFeedback && onDeleteFeedbackEvent ? (
                                  <button
                                    type="button"
                                    className="btn btn-ghost history-delete-btn"
                                    aria-label={`Удалить реакцию ${event.id}`}
                                    title="Удалить реакцию"
                                    disabled={deletingFeedbackEventId === event.id}
                                    onClick={() => {
                                      void onDeleteFeedbackEvent(event.id);
                                    }}
                                  >
                                    {deletingFeedbackEventId === event.id ? "Удаляем…" : "Удалить"}
                                  </button>
                                ) : null}
                              </div>
                            </div>
                            <p className="subtle-text">Режим: {formatFeedbackNoteModeLabel(event.noteMode)}</p>
                            <p className="subtle-text">{getFeedbackHistorySnippet(event)}</p>
                            {event.note ? <p className="subtle-text">Заметка: {event.note}</p> : null}
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="subtle-text">
                        Явных реакций ещё нет. Канал пока больше опирается на bootstrap prior и текущий
                        выбор редактора.
                      </p>
                    )}
                  </section>
                </div>
              </details>
            </>
          )}

          {stage2 ? (
            <details className="advanced-block" open={jsonOpen} onToggle={(event) => setJsonOpen(event.currentTarget.open)}>
              <summary>Дополнительно</summary>
              <div className="advanced-content">
                <pre className="json-view">{JSON.stringify(stage2, null, 2)}</pre>
              </div>
            </details>
          ) : null}
        </div>
      }
    />
  );
}
