"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Stage2Response, Stage2RunStatus, Stage2RunSummary } from "./types";
import { StepWorkspace } from "./StepWorkspace";
import {
  createEmptyStage2EditorialMemorySummary,
  DEFAULT_STAGE2_STYLE_PROFILE,
  normalizeStage2EditorialMemorySummary,
  normalizeStage2StyleProfile
} from "../../lib/stage2-channel-learning";

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
    note: string;
  }) => Promise<void>;
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
    promptChars: asNumber(candidate.promptChars),
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
  diagnostics
}: {
  diagnostics: DiagnosticsView | null;
}) {
  const overrideCount = useMemo(() => {
    if (!diagnostics) {
      return 0;
    }
    return diagnostics.effectivePrompting.promptStages.filter((stage) => stage.isCustomPrompt).length;
  }, [diagnostics]);

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

      <details className="details-drawer">
        <summary>
          <span>Эффективные промпты</span>
          <small>Что реально ведёт Stage 2</small>
        </summary>
        <div className="details-content">
          <p className="subtle-text">
            Здесь видно, какой конкретный промпт и какой уровень рассуждений реально были настроены
            для каждого Stage 2 этапа.
          </p>
          <div className="stage2-prompt-stage-list">
            {diagnostics.effectivePrompting.promptStages.map((stage) => (
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
                </div>
                <div className="stage2-prompt-meta">
                  <span className="field-label">Текущий промпт</span>
                  <p className="text-block">{stage.configuredPrompt}</p>
                </div>
                <details className="advanced-block">
                  <summary>Показать полный промпт с контекстом</summary>
                  <div className="advanced-content">
                    <pre className="json-view">{stage.promptText}</pre>
                  </div>
                </details>
              </article>
            ))}
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
  onCopy
}: Step2PickCaptionProps) {
  const [jsonOpen, setJsonOpen] = useState(false);
  const [feedbackDraft, setFeedbackDraft] = useState<{
    option: number;
    kind: "more_like_this" | "less_like_this";
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

  useEffect(() => {
    setFeedbackDraft(null);
  }, [stage2?.stage2Run?.runId]);

  const openFeedbackComposer = (
    option: number,
    kind: "more_like_this" | "less_like_this"
  ) => {
    setFeedbackDraft((current) => {
      if (current?.option === option && current.kind === kind) {
        return current;
      }
      return {
        option,
        kind,
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
        note: feedbackDraft.note
      });
      setFeedbackDraft((current) =>
        current
          ? {
              ...current,
              status: "saved",
              message: "Обратная связь сохранена для будущих запусков."
            }
          : current
      );
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
            <p>Сгенерируйте варианты подписей, сравните их рядом и затем выберите один для рендера.</p>
            <p className="subtle-text">
              Итоговую ручную правку TOP/BOTTOM теперь лучше делать на шаге 3: там есть финальный editor и быстрый mix из вариантов ниже.
            </p>
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
          </header>

          <section className="control-card">
            <label className="field-label" htmlFor="instruction">
              Инструкция для перегенерации (необязательно)
            </label>
            <textarea
              id="instruction"
              className="text-area"
              rows={3}
              value={instruction}
              onChange={(event) => onInstructionChange(event.target.value.slice(0, 2000))}
              placeholder="Например: сделай короче, добавь одну сухую шутку, избегай сленга."
            />
            <p className="subtle-text">Используйте это, если модель неверно поняла контекст или тон.</p>
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
                {isLaunching ? "Запускаем..." : "Перегенерировать варианты"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onRunStage2}
                disabled={!canRunStage2}
                aria-busy={isLaunching}
                title={!canRunStage2 && !isAttachedStage2Run ? runBlockedReason ?? undefined : undefined}
              >
                {isLaunching ? "Запускаем..." : "Полный прогон Stage 2"}
              </button>
            </div>
            <p className="subtle-text">
              Быстрая перегенерация использует текущий выбранный запуск как базу. Полный прогон
              заново проходит весь пайплайн Stage 2.
            </p>
            <section className="stage2-timing-card" aria-live="polite">
              <div className="stage2-timing-row">
                <span className="field-label">Обычно занимает</span>
                <strong>{formatDurationMs(expectedDurationMs)}</strong>
              </div>
              <div className="stage2-timing-row">
                <span className="field-label">{isRunning ? "Прошло" : "Последний ориентир"}</span>
                <strong>{formatDurationMs(isRunning ? elapsedMs : expectedDurationMs)}</strong>
              </div>
              <div className="stage2-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressRatio * 100)}>
                <div className="stage2-progress-fill" style={{ width: `${(progressRatio * 100).toFixed(1)}%` }} />
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
                    const isActive = visibleProgress.activeStageId === step.id || step.state === "running";
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
                                    {step.state === "failed" ? "Показать лог ошибки" : "Показать детали этапа"}
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
              {stage2.warnings.length > 0 ? (
                <section className="control-card control-card-subtle">
                  <div className="option-card-head">
                    <div>
                      <h3>Run warnings</h3>
                      <p className="subtle-text">
                        Здесь видны реальные degraded states и runtime decisions, которые стоит учитывать перед выбором финального текста.
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
                            <>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => openFeedbackComposer(option.option, "more_like_this")}
                              >
                                Больше в эту сторону
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => openFeedbackComposer(option.option, "less_like_this")}
                              >
                                Меньше в эту сторону
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>

                      <div className="translation-row">
                        <span className="field-label">TOP</span>
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
                        <span className="field-label">BOTTOM</span>
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
                                ? "Больше в эту сторону"
                                : "Меньше в эту сторону"}
                            </strong>
                            <span className="subtle-text">
                              Необязательная заметка для будущих запусков Stage 2
                            </span>
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
                              {feedbackDraft.status === "saving" ? "Сохраняем..." : "Сохранить обратную связь"}
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
