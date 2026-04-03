"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  collectWorkspaceStage2Examples,
  formatStage2DelimitedStringList,
  parseStage2DelimitedStringList,
  type Stage2ExamplesConfig,
  type Stage2HardConstraints
} from "../../lib/stage2-channel-config";
import { type Stage2StyleProfile } from "../../lib/stage2-channel-learning";
import type { ChannelStyleDiscoveryRunDetail } from "../../lib/channel-style-discovery-types";
import {
  listStage2WorkerProfiles,
  resolveStage2WorkerProfile
} from "../../lib/stage2-worker-profile";
import {
  applyChannelOnboardingStyleDiscoveryResult,
  buildChannelOnboardingCreatePayload,
  canNavigateChannelOnboardingStep,
  canSubmitChannelOnboardingDraft,
  canContinueChannelOnboardingStep,
  CHANNEL_ONBOARDING_STEPS,
  clearChannelOnboardingStyleDirectionSelection,
  createChannelOnboardingDraft,
  getChannelOnboardingFurthestStep,
  getChannelOnboardingProgressStepState,
  getChannelOnboardingStyleDiscoveryStatus,
  normalizeChannelOnboardingUsername,
  normalizePersistedChannelOnboardingState,
  parseChannelOnboardingCustomExamples,
  parseChannelOnboardingReferenceLinks,
  selectAllChannelOnboardingStyleDirections,
  setChannelOnboardingExplorationShare,
  toggleChannelOnboardingStyleDirectionSelection,
  updateChannelOnboardingReferenceLinks,
  type ChannelOnboardingDraft,
  type ChannelOnboardingStepId
} from "./channel-onboarding-support";

type ChannelOnboardingWizardProps = {
  open: boolean;
  storageKey: string | null;
  workspaceStage2ExamplesCorpusJson: string;
  workspaceStage2HardConstraints: Stage2HardConstraints;
  onClose: () => void;
  onStartStyleDiscovery: (input: {
    name: string;
    username: string;
    stage2HardConstraints: Stage2HardConstraints;
    referenceLinks: string[];
  }) => Promise<ChannelStyleDiscoveryRunDetail>;
  onGetStyleDiscoveryRun: (runId: string) => Promise<ChannelStyleDiscoveryRunDetail>;
  onSubmit: (input: {
    name: string;
    username: string;
    stage2WorkerProfileId: string;
    stage2HardConstraints: Stage2HardConstraints;
    stage2ExamplesConfig: Stage2ExamplesConfig;
    stage2StyleProfile: Stage2StyleProfile;
    referenceUrls: string[];
    avatarFile: File | null;
  }) => Promise<void>;
};

function nextStepId(stepId: ChannelOnboardingStepId): ChannelOnboardingStepId | null {
  const currentIndex = CHANNEL_ONBOARDING_STEPS.findIndex((step) => step.id === stepId);
  return CHANNEL_ONBOARDING_STEPS[currentIndex + 1]?.id ?? null;
}

function previousStepId(stepId: ChannelOnboardingStepId): ChannelOnboardingStepId | null {
  const currentIndex = CHANNEL_ONBOARDING_STEPS.findIndex((step) => step.id === stepId);
  return CHANNEL_ONBOARDING_STEPS[currentIndex - 1]?.id ?? null;
}

function selectionSummary(
  selectedCount: number,
  totalCount: number,
  discoveryStatus: "missing" | "fresh" | "stale"
): string {
  if (discoveryStatus === "stale") {
    return "Ссылки изменились. Обновите пул стилей.";
  }
  if (selectedCount === 0) {
    return "Выберите хотя бы одно направление. Жёсткого лимита нет.";
  }
  if (selectedCount === totalCount && totalCount > 0) {
    return "Выбран весь текущий пул.";
  }
  return `Выбрано ${selectedCount} из ${totalCount}. Можно отмечать столько карточек, сколько реально подходят.`;
}

function formatStyleLevel(level: "low" | "medium" | "high"): string {
  if (level === "low") {
    return "низкий";
  }
  if (level === "high") {
    return "высокий";
  }
  return "средний";
}

function formatStyleFitBand(fitBand: "core" | "adjacent" | "exploratory"): string {
  if (fitBand === "core") {
    return "Опорное";
  }
  if (fitBand === "adjacent") {
    return "Соседний ход";
  }
  return "Исследование";
}

export function ChannelOnboardingWizard({
  open,
  storageKey,
  workspaceStage2ExamplesCorpusJson,
  workspaceStage2HardConstraints,
  onClose,
  onStartStyleDiscovery,
  onGetStyleDiscoveryRun,
  onSubmit
}: ChannelOnboardingWizardProps) {
  const [mounted, setMounted] = useState(false);
  const [hasHydratedPersistedState, setHasHydratedPersistedState] = useState(false);
  const [step, setStep] = useState<ChannelOnboardingStepId>("identity");
  const [furthestUnlockedStep, setFurthestUnlockedStep] = useState<ChannelOnboardingStepId>("identity");
  const [draft, setDraft] = useState<ChannelOnboardingDraft>(() =>
    createChannelOnboardingDraft({
      workspaceStage2HardConstraints
    })
  );
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [activeStyleDiscoveryRunId, setActiveStyleDiscoveryRunId] = useState<string | null>(null);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    const fallbackDraft = createChannelOnboardingDraft({
      workspaceStage2HardConstraints
    });

    if (!storageKey || typeof window === "undefined") {
      setStep("identity");
      setFurthestUnlockedStep("identity");
      setDraft(fallbackDraft);
      setActiveStyleDiscoveryRunId(null);
      setHasHydratedPersistedState(true);
      return;
    }

    try {
      const persisted = normalizePersistedChannelOnboardingState(
        JSON.parse(window.localStorage.getItem(storageKey) ?? "null"),
        workspaceStage2HardConstraints
      );
      if (persisted) {
        setStep(persisted.step);
        setFurthestUnlockedStep(persisted.furthestUnlockedStep);
        setDraft(persisted.draft);
        setActiveStyleDiscoveryRunId(persisted.activeStyleDiscoveryRunId);
      } else {
        setStep("identity");
        setFurthestUnlockedStep("identity");
        setDraft(fallbackDraft);
        setActiveStyleDiscoveryRunId(null);
      }
    } catch {
      setStep("identity");
      setFurthestUnlockedStep("identity");
      setDraft(fallbackDraft);
      setActiveStyleDiscoveryRunId(null);
    } finally {
      setAvatarFile(null);
      setAvatarPreviewUrl(null);
      setDiscoveryError(null);
      setIsSubmitting(false);
      setSubmitError(null);
      setHasHydratedPersistedState(true);
    }
  }, [mounted, storageKey, workspaceStage2HardConstraints]);

  useEffect(() => {
    if (!mounted || !hasHydratedPersistedState || !storageKey || typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          step,
          furthestUnlockedStep,
          draft,
          activeStyleDiscoveryRunId
        })
      );
    } catch {
      // Draft persistence is best-effort and must never break the wizard.
    }
  }, [activeStyleDiscoveryRunId, draft, furthestUnlockedStep, hasHydratedPersistedState, mounted, step, storageKey]);

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreviewUrl(null);
      return;
    }
    const nextUrl = URL.createObjectURL(avatarFile);
    setAvatarPreviewUrl(nextUrl);
    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [avatarFile]);

  useEffect(() => {
    if (!open || !mounted) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mounted, onClose, open]);

  const workspaceExamplesCount = useMemo(
    () => collectWorkspaceStage2Examples(workspaceStage2ExamplesCorpusJson).length,
    [workspaceStage2ExamplesCorpusJson]
  );
  const workerProfiles = useMemo(() => listStage2WorkerProfiles(), []);
  const resolvedWorkerProfile = useMemo(
    () => resolveStage2WorkerProfile(draft.stage2WorkerProfileId),
    [draft.stage2WorkerProfileId]
  );
  const referenceLinks = useMemo(
    () => parseChannelOnboardingReferenceLinks(draft.referenceLinksText),
    [draft.referenceLinksText]
  );
  const selectedStyleCount = draft.selectedStyleDirectionIds.length;
  const discoveryStatus = getChannelOnboardingStyleDiscoveryStatus(draft);
  const styleDirectionCount = draft.styleProfile?.candidateDirections.length ?? 0;
  const hasStyleProfile = Boolean(draft.styleProfile);
  const stylesNeedRefresh = discoveryStatus === "stale";

  const resetWizardState = (): void => {
    setStep("identity");
    setFurthestUnlockedStep("identity");
    setDraft(
      createChannelOnboardingDraft({
        workspaceStage2HardConstraints
      })
    );
    setAvatarFile(null);
    setAvatarPreviewUrl(null);
    setIsDiscovering(false);
    setActiveStyleDiscoveryRunId(null);
    setDiscoveryError(null);
    setIsSubmitting(false);
    setSubmitError(null);
    if (storageKey && typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // Ignore storage cleanup failures so a successful channel create still completes.
      }
    }
  };

  const updateConstraint = (
    key: keyof Stage2HardConstraints,
    value: number | string[]
  ) => {
    setDraft((current) => ({
      ...current,
      stage2HardConstraints: {
        ...current.stage2HardConstraints,
        [key]: value
      }
    }));
  };

  const moveToStep = (targetStep: ChannelOnboardingStepId): void => {
    if (!canNavigateChannelOnboardingStep(targetStep, furthestUnlockedStep)) {
      return;
    }
    setStep(targetStep);
  };

  const advanceToNextStep = (): void => {
    const nextStep = nextStepId(step);
    if (!nextStep) {
      return;
    }
    setFurthestUnlockedStep((current) => getChannelOnboardingFurthestStep(current, nextStep));
    setStep(nextStep);
  };

  const triggerDiscovery = async (): Promise<void> => {
    setDiscoveryError(null);
    setIsDiscovering(true);
    try {
      const run = await onStartStyleDiscovery({
        name: draft.name,
        username: normalizeChannelOnboardingUsername(draft.username),
        stage2HardConstraints: draft.stage2HardConstraints,
        referenceLinks
      });
      if (run.status === "completed" && run.result) {
        setDraft((current) =>
          applyChannelOnboardingStyleDiscoveryResult(current, run.result as Stage2StyleProfile)
        );
        setFurthestUnlockedStep("styles");
        setStep("styles");
        setIsDiscovering(false);
        setActiveStyleDiscoveryRunId(null);
        return;
      }
      setActiveStyleDiscoveryRunId(run.runId);
    } catch (error) {
      setDiscoveryError(error instanceof Error ? error.message : "Не удалось предложить стили.");
      setIsDiscovering(false);
    }
  };

  const submit = async (): Promise<void> => {
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const payload = buildChannelOnboardingCreatePayload(draft);
      await onSubmit({
        ...payload,
        avatarFile
      });
      resetWizardState();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Не удалось создать канал.");
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (!activeStyleDiscoveryRunId) {
      setIsDiscovering(false);
      return;
    }

    let cancelled = false;
    let timer = 0;

    const scheduleNextPoll = (delayMs: number) => {
      if (cancelled) {
        return;
      }
      timer = window.setTimeout(() => {
        void poll();
      }, delayMs);
    };

    const poll = async (): Promise<void> => {
      try {
        const run = await onGetStyleDiscoveryRun(activeStyleDiscoveryRunId);
        if (cancelled) {
          return;
        }
        if (run.status === "completed" && run.result) {
          setDraft((current) => applyChannelOnboardingStyleDiscoveryResult(current, run.result as Stage2StyleProfile));
          setFurthestUnlockedStep("styles");
          setStep("styles");
          setIsDiscovering(false);
          setDiscoveryError(null);
          setActiveStyleDiscoveryRunId(null);
          return;
        }
        if (run.status === "failed") {
          setIsDiscovering(false);
          setDiscoveryError(run.errorMessage ?? "Не удалось предложить стили.");
          setActiveStyleDiscoveryRunId(null);
          return;
        }

        setIsDiscovering(true);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setIsDiscovering(true);
        scheduleNextPoll(document.hidden ? 2500 : 900);
        return;
      }

      scheduleNextPoll(document.hidden ? 2500 : 900);
    };

    void poll();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeStyleDiscoveryRunId, onGetStyleDiscoveryRun]);

  if (!open || !mounted || !hasHydratedPersistedState) {
    return null;
  }

  return createPortal(
    <div
      className="channel-onboarding-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Создание нового канала"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="channel-onboarding-shell">
        <header className="channel-onboarding-head">
          <div>
            <p className="kicker">Новый канал</p>
            <h2>Соберите канал за 4 понятных шага</h2>
            <p className="subtle-text">
              Сначала задаём основу, затем лёгкую базу второго этапа, потом 10+ референсов, и только
              после этого система предлагает стартовые стилистические направления на выбор.
            </p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Закрыть
          </button>
        </header>

        <div className="channel-onboarding-progress">
          {CHANNEL_ONBOARDING_STEPS.map((item) => {
            const state = getChannelOnboardingProgressStepState({
              step: item.id,
              currentStep: step,
              furthestUnlockedStep,
              draft
            });
            return (
              <button
                key={item.id}
                type="button"
                className={`channel-onboarding-step state-${state}`}
                disabled={state === "locked"}
                onClick={() => moveToStep(item.id)}
              >
                <span className="channel-onboarding-step-index">
                  {CHANNEL_ONBOARDING_STEPS.findIndex((candidate) => candidate.id === item.id) + 1}
                </span>
                <strong>{item.label}</strong>
                <span>{item.description}</span>
              </button>
            );
          })}
        </div>

        <div className="channel-onboarding-body">
          {step === "identity" ? (
            <section className="channel-onboarding-panel">
              <div className="channel-onboarding-panel-head">
                <div>
                  <p className="kicker">Шаг 1</p>
                  <h3>Базовая настройка канала</h3>
                </div>
                <span className="badge muted">Можно изменить позже</span>
              </div>
              <div className="channel-onboarding-grid">
                <div className="field-stack">
                  <label className="field-label">Название канала</label>
                  <input
                    className="text-input"
                    value={draft.name}
                    placeholder="Например: Честный цех"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        name: event.target.value,
                        username:
                          current.username.trim().length > 0
                            ? current.username
                            : normalizeChannelOnboardingUsername(event.target.value)
                      }))
                    }
                  />
                </div>
                <div className="field-stack">
                  <label className="field-label">Username канала</label>
                  <input
                    className="text-input"
                    value={draft.username}
                    placeholder="chestny_ceh"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        username: normalizeChannelOnboardingUsername(event.target.value)
                      }))
                    }
                  />
                  <p className="subtle-text">
                    Здесь достаточно короткого username. При необходимости его можно будет
                    поменять позже.
                  </p>
                </div>
              </div>
              <div className="channel-onboarding-avatar">
                <div className="channel-onboarding-avatar-preview">
                  {avatarPreviewUrl ? (
                    <Image
                      src={avatarPreviewUrl}
                      alt="Предпросмотр аватара"
                      width={92}
                      height={92}
                      unoptimized
                    />
                  ) : (
                    <span>Аватар</span>
                  )}
                </div>
                <div className="field-stack channel-onboarding-avatar-copy">
                  <label className="field-label" htmlFor="channelOnboardingAvatarInput">
                    Аватар канала
                  </label>
                  <p className="subtle-text">
                    Небольшой аватар помогает быстрее отличать канал в списке и в Stage 3.
                  </p>
                  <input
                    id="channelOnboardingAvatarInput"
                    type="file"
                    accept="image/*"
                    className="channel-onboarding-file-input"
                    onChange={(event) => {
                      setAvatarFile(event.target.files?.[0] ?? null);
                      event.currentTarget.value = "";
                    }}
                  />
                  <div className="channel-onboarding-avatar-actions">
                    <label
                      htmlFor="channelOnboardingAvatarInput"
                      className="btn btn-secondary channel-onboarding-file-btn"
                    >
                      {avatarFile ? "Заменить аватар" : "Загрузить аватар"}
                    </label>
                    {avatarFile ? (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setAvatarFile(null)}
                      >
                        Убрать
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="channel-onboarding-note-card">
                <strong>Что важно на этом шаге</strong>
                <p className="subtle-text">
                  Сейчас мы задаём только узнаваемую основу канала. Никаких сложных стилистических
                  форм здесь не нужно.
                </p>
              </div>
            </section>
          ) : null}

          {step === "baseline" ? (
            <section className="channel-onboarding-panel">
              <div className="channel-onboarding-panel-head">
                <div>
                  <p className="kicker">Шаг 2</p>
                  <h3>Базовая настройка Stage 2</h3>
                </div>
                <span className="badge muted">Можно оставить дефолты</span>
              </div>
              <div className="channel-onboarding-highlight">
                <strong>{workspaceExamplesCount}</strong>
                <span>примеров уже доступно по умолчанию из общего корпуса рабочего пространства</span>
              </div>
              <div className="field-stack">
                <label className="field-label">Формат pipeline</label>
                <select
                  className="text-input"
                  value={draft.stage2WorkerProfileId}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      stage2WorkerProfileId: event.target.value as typeof current.stage2WorkerProfileId
                    }))
                  }
                >
                  {workerProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.label}
                    </option>
                  ))}
                </select>
                <p className="subtle-text">
                  Этот переключатель задаёт базовую линию Stage 2: benchmark-reference,
                  social-wave, skill-gap или experimental. Ниже по-прежнему можно оставлять
                  общий корпус и обычные ограничения.
                </p>
              </div>
              <div className="channel-onboarding-note-card">
                <strong>{resolvedWorkerProfile.label}</strong>
                <p className="subtle-text">{resolvedWorkerProfile.description}</p>
                <p className="subtle-text">
                  <strong>Как это влияет на runtime:</strong> {resolvedWorkerProfile.summary}
                </p>
              </div>
              <div className="channel-onboarding-toggle-row">
                <button
                  type="button"
                  className={`btn ${draft.useWorkspaceExamples ? "btn-primary" : "btn-secondary"}`}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      useWorkspaceExamples: true,
                      customExamplesError: null
                    }))
                  }
                >
                  Использовать общий корпус
                </button>
                <button
                  type="button"
                  className={`btn ${draft.useWorkspaceExamples ? "btn-secondary" : "btn-primary"}`}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      useWorkspaceExamples: false
                    }))
                  }
                >
                  Использовать свой корпус
                </button>
              </div>
              {!draft.useWorkspaceExamples ? (
                <div className="field-stack">
                  <label className="field-label">Кастомный JSON с примерами</label>
                  <textarea
                    className="text-area mono"
                    rows={10}
                    value={draft.customExamplesJson}
                    onChange={(event) => {
                      const parsed = parseChannelOnboardingCustomExamples({
                        json: event.target.value,
                        channelName: draft.name
                      });
                      setDraft((current) => ({
                        ...current,
                        customExamplesJson: event.target.value,
                        customExamplesError: parsed.error
                      }));
                    }}
                  />
                  <p className={`subtle-text ${draft.customExamplesError ? "danger-text" : ""}`}>
                    {draft.customExamplesError ??
                      "Это необязательная продвинутая настройка. Если нужен самый быстрый старт, оставьте общий корпус."}
                  </p>
                </div>
              ) : null}

              <div className="channel-onboarding-grid">
                <div className="compact-field">
                  <label className="field-label">TOP мин.</label>
                  <input
                    className="text-input"
                    type="number"
                    value={draft.stage2HardConstraints.topLengthMin}
                    onChange={(event) =>
                      updateConstraint("topLengthMin", Number(event.target.value) || 0)
                    }
                  />
                </div>
                <div className="compact-field">
                  <label className="field-label">TOP макс.</label>
                  <input
                    className="text-input"
                    type="number"
                    value={draft.stage2HardConstraints.topLengthMax}
                    onChange={(event) =>
                      updateConstraint("topLengthMax", Number(event.target.value) || 0)
                    }
                  />
                </div>
                <div className="compact-field">
                  <label className="field-label">BOTTOM мин.</label>
                  <input
                    className="text-input"
                    type="number"
                    value={draft.stage2HardConstraints.bottomLengthMin}
                    onChange={(event) =>
                      updateConstraint("bottomLengthMin", Number(event.target.value) || 0)
                    }
                  />
                </div>
                <div className="compact-field">
                  <label className="field-label">BOTTOM макс.</label>
                  <input
                    className="text-input"
                    type="number"
                    value={draft.stage2HardConstraints.bottomLengthMax}
                    onChange={(event) =>
                      updateConstraint("bottomLengthMax", Number(event.target.value) || 0)
                    }
                  />
                </div>
              </div>

              <div className="channel-onboarding-grid">
                <div className="field-stack">
                  <label className="field-label">Запрещённые слова</label>
                  <p className="subtle-text">Слова и фразы, которые нельзя использовать в тексте.</p>
                  <textarea
                    className="text-area"
                    rows={4}
                    value={formatStage2DelimitedStringList(draft.stage2HardConstraints.bannedWords)}
                    onChange={(event) =>
                      updateConstraint(
                        "bannedWords",
                        parseStage2DelimitedStringList(event.target.value)
                      )
                    }
                  />
                </div>
                <div className="field-stack">
                  <label className="field-label">Запрещённые начала</label>
                  <p className="subtle-text">Стартовые формулировки, с которых TOP не должен начинаться.</p>
                  <textarea
                    className="text-area"
                    rows={4}
                    value={formatStage2DelimitedStringList(draft.stage2HardConstraints.bannedOpeners)}
                    onChange={(event) =>
                      updateConstraint(
                        "bannedOpeners",
                        parseStage2DelimitedStringList(event.target.value)
                      )
                    }
                  />
                </div>
              </div>

              <p className="subtle-text">
                Тонкие настройки промптов по этапам останутся доступны в менеджере канала после
                создания. Этот шаг специально сделан лёгким.
              </p>
            </section>
          ) : null}

          {step === "references" ? (
            <section className="channel-onboarding-panel">
              <div className="channel-onboarding-panel-head">
                <div>
                  <p className="kicker">Шаг 3</p>
                  <h3>Добавьте 10+ референсных ссылок</h3>
                </div>
                <span className={`badge ${referenceLinks.length >= 10 ? "" : "muted"}`}>
                  {referenceLinks.length}/10 готово
                </span>
              </div>
              <p className="subtle-text">
                Эти ссылки помогают системе понять возможные стилистические направления, но не
                определяют канал автоматически. Финальный стартовый набор всё равно выбирает редактор.
              </p>
              <textarea
                className="text-area mono"
                rows={14}
                placeholder="По одной поддерживаемой ссылке на строку"
                value={draft.referenceLinksText}
                onChange={(event) => {
                  setDiscoveryError(null);
                  setDraft((current) =>
                    updateChannelOnboardingReferenceLinks(current, event.target.value)
                  );
                }}
              />
              {hasStyleProfile ? (
                <div className={`channel-onboarding-note-card ${stylesNeedRefresh ? "is-warning" : ""}`}>
                  <strong>
                    {stylesNeedRefresh
                      ? "Пул стилей отстал от текущих ссылок"
                      : "Пул стилей уже собран и остаётся доступным"}
                  </strong>
                  <p className="subtle-text">
                    {stylesNeedRefresh
                      ? "Вы изменили набор референсов после последнего анализа. Старые карточки не удалены, но перед финальным созданием канала их нужно обновить под текущие ссылки."
                      : "Можно спокойно вернуться к шагу 4 и посмотреть карточки без повторного анализа. Пересборка нужна только если вы хотите заменить текущий пул новым."}
                  </p>
                </div>
              ) : null}
              <div className="channel-onboarding-reference-foot">
                <p className="subtle-text">
                  Поддерживаемых и уникальных ссылок: {referenceLinks.length}. Нужно минимум 10.
                </p>
                {discoveryError ? <p className="subtle-text danger-text">{discoveryError}</p> : null}
              </div>
            </section>
          ) : null}

          {step === "styles" ? (
            <section className="channel-onboarding-panel">
              <div className="channel-onboarding-panel-head">
                <div>
                  <p className="kicker">Шаг 4</p>
                  <h3>Выберите стартовые стилистические направления</h3>
                </div>
                <span className={`badge ${selectedStyleCount > 0 && !stylesNeedRefresh ? "" : "muted"}`}>
                  {selectionSummary(selectedStyleCount, styleDirectionCount, discoveryStatus)}
                </span>
              </div>
              <p className="subtle-text">
                {draft.styleProfile?.referenceInfluenceSummary ||
                  "Модель использовала референсы, чтобы предложить направления, но стартовую смесь всё равно определяет редактор."}
              </p>
              {draft.styleProfile?.bootstrapDiagnostics ? (
                <div className="channel-onboarding-note-card">
                  <strong>
                    Уверенность bootstrap: {draft.styleProfile.bootstrapDiagnostics.confidence === "high"
                      ? "высокая"
                      : draft.styleProfile.bootstrapDiagnostics.confidence === "medium"
                        ? "средняя"
                        : "осторожная"}
                  </strong>
                  <p className="subtle-text">{draft.styleProfile.bootstrapDiagnostics.summary}</p>
                </div>
              ) : null}
              {draft.styleProfile?.audiencePortrait?.summary || draft.styleProfile?.packagingPortrait?.summary ? (
                <div className="channel-onboarding-note-card">
                  {draft.styleProfile?.audiencePortrait?.summary ? (
                    <p className="subtle-text">
                      <strong>Портрет аудитории:</strong> {draft.styleProfile.audiencePortrait.summary}
                    </p>
                  ) : null}
                  {draft.styleProfile?.packagingPortrait?.summary ? (
                    <p className="subtle-text">
                      <strong>Портрет упаковки:</strong> {draft.styleProfile.packagingPortrait.summary}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {stylesNeedRefresh ? (
                <div className="channel-onboarding-note-card is-warning">
                  <strong>Эти карточки собраны по предыдущему набору ссылок</strong>
                  <p className="subtle-text">
                    Навигация по шагам остаётся свободной, но анализ не перезапускается сам. Если хотите
                    обновить карточки под текущие ссылки, запустите явную пересборку.
                  </p>
                </div>
              ) : null}
              <div className="channel-onboarding-note-card">
                <strong>Как читать эти карточки</strong>
                <p className="subtle-text">
                  Каждая карточка показывает общее ощущение, поведение TOP и BOTTOM, тональность
                  и маленький пример, чтобы сразу понять, как стиль проявится в живой подписи.
                </p>
              </div>
              <div className="channel-onboarding-selection-toolbar">
                <p className="subtle-text">
                  Можно выбрать хоть весь пул. Обычно отмечают все карточки, которые правда подходят,
                  а не пытаются любой ценой ужаться до маленького числа.
                </p>
                <div className="channel-onboarding-selection-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={!hasStyleProfile || styleDirectionCount === 0}
                    onClick={() =>
                      setDraft((current) => selectAllChannelOnboardingStyleDirections(current))
                    }
                  >
                    Выбрать весь пул
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={selectedStyleCount === 0}
                    onClick={() =>
                      setDraft((current) => clearChannelOnboardingStyleDirectionSelection(current))
                    }
                  >
                    Снять выбор
                  </button>
                </div>
              </div>
              <div className="compact-field">
                <div className="quick-edit-label-row">
                  <label className="field-label" htmlFor="channelOnboardingExplorationShare">
                    Доля исследования
                  </label>
                  <strong>{Math.round(draft.explorationShare * 100)}%</strong>
                </div>
                <input
                  id="channelOnboardingExplorationShare"
                  type="range"
                  min={10}
                  max={40}
                  step={5}
                  value={Math.round(draft.explorationShare * 100)}
                  onChange={(event) =>
                    setDraft((current) =>
                      setChannelOnboardingExplorationShare(
                        current,
                        Number(event.target.value) / 100
                      )
                    )
                  }
                />
                <p className="subtle-text">
                  Обычно достаточно 20–30%. Чем выше значение, тем больше канал оставляет места для исследовательских вариантов.
                </p>
              </div>
              <div className="channel-style-grid">
                {draft.styleProfile?.candidateDirections.map((direction) => {
                  const selected = draft.selectedStyleDirectionIds.includes(direction.id);
                  return (
                    <button
                      key={direction.id}
                      type="button"
                      className={`channel-style-card ${selected ? "is-selected" : ""}`}
                      onClick={() =>
                        setDraft((current) =>
                          toggleChannelOnboardingStyleDirectionSelection(current, direction.id)
                        )
                      }
                    >
                      <div className="channel-style-card-head">
                        <div className="channel-style-card-title">
                          <strong>{direction.name}</strong>
                          <div className="channel-style-card-tags">
                            <span className={`badge channel-style-fit-badge fit-${direction.fitBand}`}>
                              {formatStyleFitBand(direction.fitBand)}
                            </span>
                            <span className={`badge ${selected ? "" : "muted"}`}>
                              {selected ? "Выбрано" : "Выбрать"}
                            </span>
                          </div>
                        </div>
                      </div>
                      <p>{direction.description}</p>
                      <div className="channel-style-card-meta">
                        <div className="channel-style-meta-block">
                          <span className="field-label">Как ощущается</span>
                          <span>{direction.voice}</span>
                        </div>
                        <div className="channel-style-meta-block">
                          <span className="field-label">Как это проявится в TOP</span>
                          <span>{direction.topPattern}</span>
                        </div>
                        <div className="channel-style-meta-block">
                          <span className="field-label">Как это проявится в BOTTOM</span>
                          <span>{direction.bottomPattern}</span>
                        </div>
                        <div className="channel-style-tone-grid">
                          <span className="channel-style-tone-pill">
                            Юмор: {formatStyleLevel(direction.humorLevel)}
                          </span>
                          <span className="channel-style-tone-pill">
                            Сарказм: {formatStyleLevel(direction.sarcasmLevel)}
                          </span>
                          <span className="channel-style-tone-pill">
                            Теплота: {formatStyleLevel(direction.warmthLevel)}
                          </span>
                          <span className="channel-style-tone-pill">
                            Инсайдерность: {formatStyleLevel(direction.insiderDensityLevel)}
                          </span>
                        </div>
                        <div className="channel-style-meta-block">
                          <span className="field-label">Лучше всего подходит для</span>
                          <span>{direction.bestFor}</span>
                        </div>
                        <div className="channel-style-meta-block">
                          <span className="field-label">Лучше избегать</span>
                          <span>{direction.avoids}</span>
                        </div>
                        {direction.microExample ? (
                          <div className="channel-style-preview">
                            <span className="field-label">Как это может звучать</span>
                            <span>{direction.microExample}</span>
                          </div>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
              {submitError ? <p className="subtle-text danger-text">{submitError}</p> : null}
            </section>
          ) : null}
        </div>

        <footer className="channel-onboarding-footer">
          <div className="channel-onboarding-footer-copy">
            {step === "references" ? (
              <p className="subtle-text">
                Система предложит около 20 направлений на основе этих ссылок. Навигация между
                шагами не запускает анализ сама по себе: сборка и пересборка происходят только по
                явной кнопке.
              </p>
            ) : step === "styles" ? (
              <p className="subtle-text">
                {stylesNeedRefresh
                  ? "Текущие карточки ещё полезны как ориентир, но для создания канала с обновлёнными референсами сначала нужно пересобрать пул."
                  : "Выбранные направления станут стартовым приоритетом канала. Дальше он будет мягко дообучаться от редакторского выбора и обратной связи."}
              </p>
            ) : (
              <p className="subtle-text">До финального подтверждения по шагам можно свободно вернуться назад.</p>
            )}
          </div>
          <div className="channel-onboarding-actions">
            {previousStepId(step) ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => moveToStep(previousStepId(step) as ChannelOnboardingStepId)}
              >
                Назад
              </button>
            ) : null}
            {step === "references" ? (
              <>
                {hasStyleProfile ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => moveToStep("styles")}
                  >
                    К карточкам
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={referenceLinks.length < 10 || isDiscovering}
                  onClick={() => {
                    void triggerDiscovery();
                  }}
                >
                  {isDiscovering
                    ? "Анализируем референсы..."
                    : hasStyleProfile
                      ? stylesNeedRefresh
                        ? "Обновить пул стилей"
                        : "Пересобрать пул стилей"
                      : "Предложить стили"}
                </button>
              </>
            ) : step === "styles" ? (
              stylesNeedRefresh ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={referenceLinks.length < 10 || isDiscovering}
                  onClick={() => {
                    void triggerDiscovery();
                  }}
                >
                  {isDiscovering ? "Обновляем пул..." : "Обновить пул стилей"}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!canSubmitChannelOnboardingDraft(draft) || isSubmitting}
                  onClick={() => {
                    void submit();
                  }}
                >
                  {isSubmitting ? "Создаём канал..." : "Создать канал"}
                </button>
              )
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canContinueChannelOnboardingStep(step, draft)}
                onClick={() => advanceToNextStep()}
              >
                Далее
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
}
