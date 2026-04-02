"use client";

import React from "react";
import {
  DEFAULT_STAGE2_PROMPT_CONFIG,
  STAGE2_DEFAULT_REASONING_EFFORTS,
  STAGE2_DEFAULT_STAGE_PROMPTS,
  STAGE2_REASONING_EFFORT_OPTIONS,
  Stage2PromptConfig
} from "../../lib/stage2-pipeline";
import { Stage2CorpusExample, Stage2HardConstraints } from "../../lib/stage2-channel-config";
import type { ChannelFeedbackResponse } from "./types";
import {
  getSelectedStage2StyleDirections,
  type Stage2EditorialMemorySummary,
  Stage2StyleProfile
} from "../../lib/stage2-channel-learning";
import {
  DEFAULT_WORKSPACE_CODEX_MODEL_CONFIG,
  getWorkspaceCodexModelOptionsForStage,
  STAGE2_AUX_MODEL_STAGE_FIELDS,
  STAGE2_PROMPT_MODEL_STAGE_FIELDS,
  STAGE3_MODEL_STAGE_FIELDS,
  WORKSPACE_CODEX_MODEL_OPTIONS,
  type ResolvedWorkspaceCodexModelConfig,
  type WorkspaceCodexModelConfig,
  type WorkspaceCodexModelSetting,
  type WorkspaceCodexModelStageId
} from "../../lib/workspace-codex-models";
import type { ChannelStyleProfileEditorDraft } from "./channel-onboarding-support";
import { AutosaveState } from "./channel-manager-support";

type Stage2PromptStageMeta = {
  id: keyof Stage2PromptConfig["stages"];
  label: string;
  shortLabel: string;
  description: string;
  promptStageType: "llm" | "deterministic";
};

type ActiveExamplesPreview = {
  source: "workspace_default" | "channel_custom";
  corpus: Stage2CorpusExample[];
  workspaceCorpusCount: number;
};

type ChannelManagerStage2TabProps = {
  isWorkspaceDefaultsSelection: boolean;
  workspaceExamplesCount: number;
  workspaceExamplesJson: string;
  workspaceExamplesError: string | null;
  stage2HardConstraints: Stage2HardConstraints;
  bannedWordsInput: string;
  bannedOpenersInput: string;
  workspaceStage2PromptConfig: Stage2PromptConfig;
  workspaceCodexModelConfig?: WorkspaceCodexModelConfig;
  resolvedWorkspaceCodexModelConfig?: ResolvedWorkspaceCodexModelConfig;
  stage2PromptStages: Stage2PromptStageMeta[];
  autosaveState: AutosaveState;
  canEditWorkspaceDefaults: boolean;
  canEditHardConstraints: boolean;
  canEditChannelExamples: boolean;
  activeExamplesPreview: ActiveExamplesPreview;
  channelStyleProfile?: Stage2StyleProfile | null;
  channelStyleProfileDraft?: ChannelStyleProfileEditorDraft | null;
  channelStyleProfileStatus?: "missing" | "fresh" | "stale";
  channelStyleProfileDirty?: boolean;
  channelStyleProfileFeedbackHistory: ChannelFeedbackResponse["historyEvents"];
  channelStyleProfileFeedbackHistoryLoading: boolean;
  onDeleteChannelFeedbackEvent?: (eventId: string) => Promise<void>;
  deletingChannelFeedbackEventId?: string | null;
  channelEditorialMemory: Stage2EditorialMemorySummary | null;
  canEditChannelStyleProfile: boolean;
  channelStyleProfileDiscovering: boolean;
  channelStyleProfileDiscoveryError: string | null;
  channelStyleProfileSaveState: {
    status: "idle" | "saving" | "saved" | "error";
    message: string | null;
  };
  updateChannelStyleProfileReferenceLinks: (value: string) => void;
  updateChannelStyleProfileExplorationShare: (value: number) => void;
  toggleChannelStyleProfileDirectionSelection: (directionId: string) => void;
  selectAllChannelStyleProfileDirections: () => void;
  clearChannelStyleProfileDirectionSelection: () => void;
  startChannelStyleProfileDiscovery: () => Promise<void>;
  saveChannelStyleProfileDraft: () => Promise<void>;
  discardChannelStyleProfileDraft: () => void;
  customExamplesJson: string;
  customExamplesError: string | null;
  updateWorkspaceExamplesJson: (value: string) => void;
  updateCustomExamplesJson: (value: string) => void;
  updateStage2HardConstraint: (
    key: keyof Stage2HardConstraints,
    value: string | boolean | string[]
  ) => void;
  updateBannedWordsInput: (value: string) => void;
  updateBannedOpenersInput: (value: string) => void;
  updateStage2PromptTemplate: (
    stageId: keyof Stage2PromptConfig["stages"],
    prompt: string
  ) => void;
  updateStage2PromptReasoning: (
    stageId: keyof Stage2PromptConfig["stages"],
    reasoningEffort: Stage2PromptConfig["stages"][keyof Stage2PromptConfig["stages"]]["reasoningEffort"]
  ) => void;
  resetStage2PromptStage: (stageId: keyof Stage2PromptConfig["stages"]) => void;
  updateWorkspaceCodexModelSetting?: (
    stageId: WorkspaceCodexModelStageId,
    value: WorkspaceCodexModelSetting
  ) => void;
};

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

function formatFeedbackScope(scope: "option" | "top" | "bottom"): string {
  if (scope === "top") {
    return "TOP";
  }
  if (scope === "bottom") {
    return "BOTTOM";
  }
  return "Опция";
}

function formatFeedbackTimestamp(value: string): string {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatFeedbackNoteMode(mode: ChannelFeedbackResponse["historyEvents"][number]["noteMode"]): string {
  if (mode === "hard_rule") {
    return "Hard rule";
  }
  if (mode === "situational_note") {
    return "Situational note";
  }
  return "Soft preference";
}

function getFeedbackSnippet(
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

function formatEffectiveCodexModel(model: string | null): string {
  if (!model) {
    return "стандартная модель деплоя";
  }
  const known = WORKSPACE_CODEX_MODEL_OPTIONS.find((option) => option.value === model);
  return known?.label ?? model;
}

function renderModelSettingField(input: {
  field: {
    id: WorkspaceCodexModelStageId;
    label: string;
    description: string;
    allowsImages: boolean;
  };
  workspaceCodexModelConfig: WorkspaceCodexModelConfig;
  resolvedWorkspaceCodexModelConfig: ResolvedWorkspaceCodexModelConfig;
  canEditWorkspaceDefaults: boolean;
  updateWorkspaceCodexModelSetting: (
    stageId: WorkspaceCodexModelStageId,
    value: WorkspaceCodexModelSetting
  ) => void;
}): React.ReactNode {
  const selectedValue = input.workspaceCodexModelConfig[input.field.id];
  const effectiveModel = input.resolvedWorkspaceCodexModelConfig[input.field.id];
  return (
    <div key={input.field.id} className="compact-field">
      <label className="field-label">{input.field.label}</label>
      <select
        className="text-input"
        value={selectedValue}
        disabled={!input.canEditWorkspaceDefaults}
        onChange={(event) =>
          input.updateWorkspaceCodexModelSetting(
            input.field.id,
            event.target.value as WorkspaceCodexModelSetting
          )
        }
      >
        <option value="deploy_default">Как на деплое</option>
        {getWorkspaceCodexModelOptionsForStage(input.field.id).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="subtle-text">{input.field.description}</p>
      <p className="subtle-text">
        Сейчас применяется: <strong>{formatEffectiveCodexModel(effectiveModel)}</strong>
      </p>
      {input.field.allowsImages ? (
        <p className="subtle-text">Этот маршрут мультимодальный, поэтому Spark здесь скрыт и не используется.</p>
      ) : (
        <p className="subtle-text">Этот маршрут текстовый, поэтому здесь можно использовать Spark.</p>
      )}
    </div>
  );
}

export function ChannelManagerStage2Tab({
  isWorkspaceDefaultsSelection,
  workspaceExamplesCount,
  workspaceExamplesJson,
  workspaceExamplesError,
  stage2HardConstraints,
  bannedWordsInput,
  bannedOpenersInput,
  workspaceStage2PromptConfig,
  workspaceCodexModelConfig = DEFAULT_WORKSPACE_CODEX_MODEL_CONFIG,
  resolvedWorkspaceCodexModelConfig = {
    contextPacket: null,
    candidateGenerator: null,
    qualityCourt: null,
    targetedRepair: null,
    captionTranslation: null,
    titleWriter: null,
    analyzer: null,
    selector: null,
    writer: null,
    critic: null,
    rewriter: null,
    finalSelector: null,
    titles: null,
    seo: null,
    regenerate: null,
    styleDiscovery: null,
    stage3Planner: "gpt-5.2"
  },
  stage2PromptStages,
  autosaveState,
  canEditWorkspaceDefaults,
  canEditHardConstraints,
  canEditChannelExamples,
  activeExamplesPreview,
  channelStyleProfile,
  channelStyleProfileDraft,
  channelStyleProfileStatus = "missing",
  channelStyleProfileDirty = false,
  channelStyleProfileFeedbackHistory,
  channelStyleProfileFeedbackHistoryLoading,
  onDeleteChannelFeedbackEvent,
  deletingChannelFeedbackEventId = null,
  channelEditorialMemory,
  canEditChannelStyleProfile,
  channelStyleProfileDiscovering,
  channelStyleProfileDiscoveryError,
  channelStyleProfileSaveState,
  updateChannelStyleProfileReferenceLinks,
  updateChannelStyleProfileExplorationShare,
  toggleChannelStyleProfileDirectionSelection,
  selectAllChannelStyleProfileDirections,
  clearChannelStyleProfileDirectionSelection,
  startChannelStyleProfileDiscovery,
  saveChannelStyleProfileDraft,
  discardChannelStyleProfileDraft,
  customExamplesJson,
  customExamplesError,
  updateWorkspaceExamplesJson,
  updateCustomExamplesJson,
  updateStage2HardConstraint,
  updateBannedWordsInput,
  updateBannedOpenersInput,
  updateStage2PromptTemplate,
  updateStage2PromptReasoning,
  resetStage2PromptStage,
  updateWorkspaceCodexModelSetting = () => undefined
}: ChannelManagerStage2TabProps) {
  if (isWorkspaceDefaultsSelection) {
    return (
      <div className="field-stack">
        <section className="control-card control-card-priority">
          <p className="field-label">Общие настройки</p>
          <p className="subtle-text">
            Здесь владелец задаёт общую базу Stage 2 для всего рабочего пространства:
            корпус примеров, ограничения, базовые промпты и модели Codex для ключевых этапов.
          </p>
        </section>

        <section className="control-card control-card-subtle">
          <div className="stage2-insight-grid">
            <article className="stage2-insight-card">
              <span className="field-label">Общий корпус</span>
              <strong>{workspaceExamplesCount}</strong>
              <p className="subtle-text">примеров попадут в общий корпус рабочего пространства</p>
            </article>
            <article className="stage2-insight-card">
              <span className="field-label">TOP</span>
              <strong>
                {stage2HardConstraints.topLengthMin}-{stage2HardConstraints.topLengthMax}
              </strong>
              <p className="subtle-text">ограничения по умолчанию</p>
            </article>
            <article className="stage2-insight-card">
              <span className="field-label">BOTTOM</span>
              <strong>
                {stage2HardConstraints.bottomLengthMin}-{stage2HardConstraints.bottomLengthMax}
              </strong>
              <p className="subtle-text">ограничения по умолчанию</p>
            </article>
          </div>

          <div className="compact-field">
            <label className="field-label">JSON общего корпуса</label>
            <textarea
              className="text-area mono"
              rows={10}
              value={workspaceExamplesJson}
              disabled={!canEditWorkspaceDefaults}
              onChange={(event) => updateWorkspaceExamplesJson(event.target.value)}
            />
            {workspaceExamplesError ? (
              <p className="subtle-text danger-text">{workspaceExamplesError}</p>
            ) : (
              <p className="subtle-text">
                Это общий корпус рабочего пространства. Все каналы используют его, если
                для канала не включён собственный корпус.
              </p>
            )}
          </div>

          <div className="compact-field">
            <p className="field-label">Ограничения по умолчанию</p>
            <div className="compact-grid">
              <div className="compact-field">
                <label className="field-label">TOP мин.</label>
                <input
                  className="text-input"
                  type="number"
                  value={stage2HardConstraints.topLengthMin}
                  disabled={!canEditHardConstraints}
                  onChange={(event) =>
                    updateStage2HardConstraint("topLengthMin", event.target.value)
                  }
                />
              </div>
              <div className="compact-field">
                <label className="field-label">TOP макс.</label>
                <input
                  className="text-input"
                  type="number"
                  value={stage2HardConstraints.topLengthMax}
                  disabled={!canEditHardConstraints}
                  onChange={(event) =>
                    updateStage2HardConstraint("topLengthMax", event.target.value)
                  }
                />
              </div>
              <div className="compact-field">
                <label className="field-label">BOTTOM мин.</label>
                <input
                  className="text-input"
                  type="number"
                  value={stage2HardConstraints.bottomLengthMin}
                  disabled={!canEditHardConstraints}
                  onChange={(event) =>
                    updateStage2HardConstraint("bottomLengthMin", event.target.value)
                  }
                />
              </div>
              <div className="compact-field">
                <label className="field-label">BOTTOM макс.</label>
                <input
                  className="text-input"
                  type="number"
                  value={stage2HardConstraints.bottomLengthMax}
                  disabled={!canEditHardConstraints}
                  onChange={(event) =>
                    updateStage2HardConstraint("bottomLengthMax", event.target.value)
                  }
                />
              </div>
            </div>
            <label className="field-label">Запрещённые слова</label>
            <textarea
              className="text-area"
              rows={3}
              value={bannedWordsInput}
              disabled={!canEditHardConstraints}
              onChange={(event) => updateBannedWordsInput(event.target.value)}
            />
            <p className="subtle-text">Разделяйте слова запятыми, точкой с запятой или с новой строки.</p>
            <label className="field-label">Запрещённые начала</label>
            <textarea
              className="text-area"
              rows={3}
              value={bannedOpenersInput}
              disabled={!canEditHardConstraints}
              onChange={(event) => updateBannedOpenersInput(event.target.value)}
            />
            <p className="subtle-text">Запрещённые начала проверяются только в начале TOP и хранятся отдельным списком.</p>
          </div>

          <div className="compact-field">
            <p className="field-label">Маршрутизация моделей Stage 2</p>
            <p className="subtle-text">
              Модель выбирается отдельно для каждого LLM-подэтапа. Мультимодальные шаги
              используют только модели, которые умеют принимать изображения; Spark доступен
              только на text-only маршрутах.
            </p>
          </div>

          <div className="stage2-config-stage-list">
            {stage2PromptStages.map((stage, index) => {
              const stageConfig = workspaceStage2PromptConfig.stages[stage.id];
              const isDefaultPrompt =
                stageConfig.prompt === STAGE2_DEFAULT_STAGE_PROMPTS[stage.id];
              const isDefaultReasoning =
                stageConfig.reasoningEffort === STAGE2_DEFAULT_REASONING_EFFORTS[stage.id];
              const modelField = STAGE2_PROMPT_MODEL_STAGE_FIELDS.find((field) => field.id === stage.id);
              return (
                <article key={stage.id} className="stage2-config-stage-card">
                  <div className="stage2-config-stage-head">
                    <div className="stage2-config-stage-index">{index + 1}</div>
                    <div className="stage2-config-stage-copy">
                      <div className="quick-edit-label-row">
                        <label className="field-label">
                          {stage.shortLabel} <span className="badge">LLM-этап</span>
                        </label>
                        {!isDefaultPrompt || !isDefaultReasoning ? (
                          <span className="badge">Переопределено</span>
                        ) : (
                          <span className="badge muted">По умолчанию</span>
                        )}
                      </div>
                      <p className="subtle-text">{stage.description}</p>
                    </div>
                  </div>
                  <div className="stage2-config-stage-body">
                    <label className="field-label">Базовый промпт</label>
                    <textarea
                      className="text-area mono"
                      rows={10}
                      value={stageConfig.prompt}
                      disabled={!canEditWorkspaceDefaults}
                      onChange={(event) =>
                        updateStage2PromptTemplate(stage.id, event.target.value)
                      }
                    />
                    <div className="stage2-config-stage-controls">
                      <div className="compact-field">
                        <label className="field-label">Базовый уровень рассуждений</label>
                        <select
                          className="text-input"
                          value={stageConfig.reasoningEffort}
                          disabled={!canEditWorkspaceDefaults}
                          onChange={(event) =>
                            updateStage2PromptReasoning(
                              stage.id,
                              event.target.value as typeof stageConfig.reasoningEffort
                            )
                          }
                        >
                          {STAGE2_REASONING_EFFORT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      {modelField
                        ? renderModelSettingField({
                            field: modelField,
                            workspaceCodexModelConfig,
                            resolvedWorkspaceCodexModelConfig,
                            canEditWorkspaceDefaults,
                            updateWorkspaceCodexModelSetting
                          })
                        : null}
                      <div className="stage2-config-stage-actions">
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={!canEditWorkspaceDefaults}
                          onClick={() => resetStage2PromptStage(stage.id)}
                        >
                          Сбросить к продуктовым настройкам
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="compact-field">
            <p className="field-label">Отдельные Stage 2 маршруты</p>
            <div className="compact-grid">
              {STAGE2_AUX_MODEL_STAGE_FIELDS.map((field) =>
                renderModelSettingField({
                  field,
                  workspaceCodexModelConfig,
                  resolvedWorkspaceCodexModelConfig,
                  canEditWorkspaceDefaults,
                  updateWorkspaceCodexModelSetting
                })
              )}
            </div>
          </div>

          <div className="compact-field">
            <p className="field-label">Связанный Stage 3 маршрут</p>
            <div className="compact-grid">
              {STAGE3_MODEL_STAGE_FIELDS.map((field) =>
                renderModelSettingField({
                  field,
                  workspaceCodexModelConfig,
                  resolvedWorkspaceCodexModelConfig,
                  canEditWorkspaceDefaults,
                  updateWorkspaceCodexModelSetting
                })
              )}
            </div>
          </div>

          <p
            className={`subtle-text ${autosaveState.stage2Defaults.status === "error" ? "danger-text" : ""}`}
          >
            {autosaveState.stage2Defaults.message ??
              "Общие AI-настройки сохраняются автоматически."}
          </p>
        </section>
      </div>
    );
  }

  const selectedPersistedDirections = channelStyleProfile
    ? getSelectedStage2StyleDirections(channelStyleProfile)
    : [];
  const selectedDraftDirections = channelStyleProfileDraft?.styleProfile
    ? channelStyleProfileDraft.styleProfile.candidateDirections.filter((direction) =>
        channelStyleProfileDraft.selectedStyleDirectionIds.includes(direction.id)
      )
    : [];
  const currentReferenceCount = channelStyleProfileDraft?.referenceLinksText
    ? channelStyleProfileDraft.referenceLinksText
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean).length
    : 0;

  return (
    <div className="field-stack">
      <section className="control-card control-card-priority">
        <p className="field-label">Настройки Stage 2 канала</p>
        <p className="subtle-text">
          Для конкретного канала здесь настраивается свой JSON корпуса примеров.
          Базовый корпус задаётся владельцем отдельно через раздел общих настроек.
        </p>
      </section>
      {!isWorkspaceDefaultsSelection && channelStyleProfile ? (
        <section className="control-card control-card-subtle">
          <div className="control-section-head">
            <div>
              <h3>Стиль канала</h3>
              <p className="subtle-text">
                После онбординга стиль можно спокойно донастроить: поменять референсы,
                пересобрать пул направлений, отметить новые карточки и подправить долю исследования.
              </p>
            </div>
            <span className={`badge ${channelStyleProfileStatus === "stale" ? "" : "muted"}`}>
              {channelStyleProfileStatus === "stale"
                ? "Нужна пересборка"
                : channelStyleProfileDirty
                  ? "Есть несохранённые изменения"
                  : "Синхронизировано"}
            </span>
          </div>
          <div className="stage2-insight-grid">
            <article className="stage2-insight-card">
              <span className="field-label">Референсные ссылки</span>
              <strong>{currentReferenceCount || channelStyleProfile.referenceLinks.length}</strong>
              <p className="subtle-text">текущий набор ссылок для следующей style discovery пересборки</p>
            </article>
            <article className="stage2-insight-card">
              <span className="field-label">Направления</span>
              <strong>{channelStyleProfileDraft?.styleProfile.candidateDirections.length ?? channelStyleProfile.candidateDirections.length}</strong>
              <p className="subtle-text">карточек сейчас доступно для стартового приоритета канала</p>
            </article>
            <article className="stage2-insight-card">
              <span className="field-label">Выбрано</span>
              <strong>{selectedDraftDirections.length || selectedPersistedDirections.length}</strong>
              <p className="subtle-text">жёсткого лимита нет, runtime сам сжимает это в компактный prior</p>
            </article>
            <article className="stage2-insight-card">
              <span className="field-label">Доля исследования</span>
              <strong>{Math.round((channelStyleProfileDraft?.explorationShare ?? channelStyleProfile.explorationShare) * 100)}%</strong>
              <p className="subtle-text">обычно 20–30%, выше — больше эксперимента</p>
            </article>
          </div>

          {channelEditorialMemory ? (
            <div className="channel-onboarding-note-card">
              <strong>Как сейчас учится канал</strong>
              <p className="subtle-text">{channelEditorialMemory.promptSummary}</p>
            </div>
          ) : null}
          {channelStyleProfile.bootstrapDiagnostics ? (
            <div className="channel-onboarding-note-card">
              <strong>
                Уверенность bootstrap: {channelStyleProfile.bootstrapDiagnostics.confidence === "high"
                  ? "высокая"
                  : channelStyleProfile.bootstrapDiagnostics.confidence === "medium"
                    ? "средняя"
                    : "осторожная"}
              </strong>
              <p className="subtle-text">{channelStyleProfile.bootstrapDiagnostics.summary}</p>
              {channelStyleProfile.audiencePortrait?.summary ? (
                <p className="subtle-text">
                  <strong>Портрет аудитории:</strong> {channelStyleProfile.audiencePortrait.summary}
                </p>
              ) : null}
              {channelStyleProfile.packagingPortrait?.summary ? (
                <p className="subtle-text">
                  <strong>Портрет упаковки:</strong> {channelStyleProfile.packagingPortrait.summary}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="compact-field">
            <label className="field-label">Референсные ссылки</label>
            <textarea
              className="text-area mono"
              rows={10}
              value={channelStyleProfileDraft?.referenceLinksText ?? ""}
              disabled={!canEditChannelStyleProfile}
              placeholder="По одной поддерживаемой ссылке на строку"
              onChange={(event) => updateChannelStyleProfileReferenceLinks(event.target.value)}
            />
            <p className="subtle-text">
              Можно добавлять, убирать и менять ссылки. Текущий пул карточек не исчезает, пока вы явно не запустите пересборку.
            </p>
            {channelStyleProfileStatus === "stale" ? (
              <p className="subtle-text danger-text">
                Ссылки изменились после последней генерации. Перед сохранением обновите пул направлений под текущий набор.
              </p>
            ) : null}
            {channelStyleProfileDiscoveryError ? (
              <p className="subtle-text danger-text">{channelStyleProfileDiscoveryError}</p>
            ) : null}
          </div>

          <div className="compact-field">
            <div className="quick-edit-label-row">
              <label className="field-label" htmlFor="channelStyleExplorationShare">
                Доля исследования
              </label>
              <strong>{Math.round((channelStyleProfileDraft?.explorationShare ?? channelStyleProfile.explorationShare) * 100)}%</strong>
            </div>
            <input
              id="channelStyleExplorationShare"
              type="range"
              min={10}
              max={40}
              step={5}
              disabled={!canEditChannelStyleProfile}
              value={Math.round((channelStyleProfileDraft?.explorationShare ?? channelStyleProfile.explorationShare) * 100)}
              onChange={(event) =>
                updateChannelStyleProfileExplorationShare(Number(event.target.value) / 100)
              }
            />
            <p className="subtle-text">
              Эта настройка меняет только долю исследовательских вариантов в runtime. Выбор карточек по-прежнему можно оставить широким.
            </p>
          </div>

          <div className="channel-onboarding-selection-toolbar">
            <p className="subtle-text">
              Отмечайте все реально подходящие направления. Рантайм сам использует их как взвешенный prior, а не как стену из одинаковых указаний.
            </p>
            <div className="channel-onboarding-selection-actions">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!canEditChannelStyleProfile || !channelStyleProfileDraft?.styleProfile.candidateDirections.length}
                onClick={selectAllChannelStyleProfileDirections}
              >
                Выбрать всё
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!canEditChannelStyleProfile || !channelStyleProfileDraft?.selectedStyleDirectionIds.length}
                onClick={clearChannelStyleProfileDirectionSelection}
              >
                Снять выбор
              </button>
            </div>
          </div>

          {channelStyleProfileDraft?.styleProfile.candidateDirections.length ? (
            <div className="channel-style-grid">
              {channelStyleProfileDraft.styleProfile.candidateDirections.map((direction) => {
                const selected = channelStyleProfileDraft.selectedStyleDirectionIds.includes(direction.id);
                return (
                  <button
                    key={direction.id}
                    type="button"
                    className={`channel-style-card ${selected ? "is-selected" : ""}`}
                    disabled={!canEditChannelStyleProfile}
                    onClick={() => toggleChannelStyleProfileDirectionSelection(direction.id)}
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
                        <span className="field-label">TOP</span>
                        <span>{direction.topPattern}</span>
                      </div>
                      <div className="channel-style-meta-block">
                        <span className="field-label">BOTTOM</span>
                        <span>{direction.bottomPattern}</span>
                      </div>
                      <div className="channel-style-tone-grid">
                        <span className="channel-style-tone-pill">Юмор: {formatStyleLevel(direction.humorLevel)}</span>
                        <span className="channel-style-tone-pill">Сарказм: {formatStyleLevel(direction.sarcasmLevel)}</span>
                        <span className="channel-style-tone-pill">Теплота: {formatStyleLevel(direction.warmthLevel)}</span>
                        <span className="channel-style-tone-pill">Инсайдерность: {formatStyleLevel(direction.insiderDensityLevel)}</span>
                      </div>
                      <div className="channel-style-meta-block">
                        <span className="field-label">Лучше всего работает</span>
                        <span>{direction.bestFor}</span>
                      </div>
                      <div className="channel-style-meta-block">
                        <span className="field-label">Лучше избегать</span>
                        <span>{direction.avoids}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="subtle-text">
              У канала ещё нет сохранённого style pool. Сначала соберите ссылки и запустите пересборку.
            </p>
          )}

          <div className="control-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!canEditChannelStyleProfile || currentReferenceCount < 10 || channelStyleProfileDiscovering}
              onClick={() => {
                void startChannelStyleProfileDiscovery();
              }}
            >
              {channelStyleProfileDiscovering ? "Пересобираем..." : "Перегенерировать направления"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!canEditChannelStyleProfile || !channelStyleProfileDirty}
              onClick={discardChannelStyleProfileDraft}
            >
              Отменить изменения
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                !canEditChannelStyleProfile ||
                !channelStyleProfileDirty ||
                channelStyleProfileStatus === "stale" ||
                channelStyleProfileSaveState.status === "saving"
              }
              onClick={() => {
                void saveChannelStyleProfileDraft();
              }}
            >
              {channelStyleProfileSaveState.status === "saving" ? "Сохраняем..." : "Сохранить стиль"}
            </button>
          </div>
          <p className={`subtle-text ${channelStyleProfileSaveState.status === "error" ? "danger-text" : ""}`}>
            {channelStyleProfileSaveState.message ??
              (channelStyleProfileStatus === "stale"
                ? "Сначала обновите пул направлений под текущие ссылки, затем сохраните стиль канала."
                : "Редактор канала может спокойно редактировать ссылки, направления и exploration share без повторного онбординга.")}
          </p>

          <section className="control-card control-card-subtle">
            <div className="control-section-head">
              <div>
                <h3>Последние реакции канала</h3>
                <p className="subtle-text">
                  Здесь видны только явные лайки и дизлайки. Пассивный выбор варианта остаётся системным слабым сигналом и в эту историю не попадает.
                </p>
              </div>
            </div>
            {channelStyleProfileFeedbackHistoryLoading ? (
              <p className="subtle-text">Загружаем историю реакций…</p>
            ) : channelStyleProfileFeedbackHistory.length > 0 ? (
              <div className="stage2-example-list">
                {channelStyleProfileFeedbackHistory.map((event) => (
                  <article key={event.id} className="stage2-example-card">
                    <div className="quick-edit-label-row">
                      <strong>{event.kind === "more_like_this" ? "👍" : "👎"} {formatFeedbackScope(event.scope)}</strong>
                      <div className="history-item-actions">
                        <span className="subtle-text">{formatFeedbackTimestamp(event.createdAt)}</span>
                        {canEditChannelStyleProfile && onDeleteChannelFeedbackEvent ? (
                          <button
                            type="button"
                            className="btn btn-ghost history-delete-btn"
                            aria-label={`Удалить реакцию ${event.id}`}
                            title="Удалить реакцию"
                            disabled={deletingChannelFeedbackEventId === event.id}
                            onClick={() => {
                              void onDeleteChannelFeedbackEvent(event.id);
                            }}
                          >
                            {deletingChannelFeedbackEventId === event.id ? "Удаляем…" : "Удалить"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <p className="subtle-text">Режим: {formatFeedbackNoteMode(event.noteMode)}</p>
                    <p className="subtle-text">{getFeedbackSnippet(event)}</p>
                    {event.note ? <p className="subtle-text">Заметка: {event.note}</p> : null}
                  </article>
                ))}
              </div>
            ) : (
              <p className="subtle-text">
                Явных лайков и дизлайков пока нет. Канал всё ещё больше опирается на bootstrap prior и дальнейший выбор редактора.
              </p>
            )}
          </section>
        </section>
      ) : null}
      <section className="control-card control-card-subtle">
        <div className="control-section-head">
          <div>
            <h3>Корпус примеров</h3>
            <p className="subtle-text">
              Поле изначально заполнено общим корпусом рабочего пространства. Его можно просто
              отредактировать или полностью заменить.
            </p>
          </div>
        </div>
        <div className="stage2-insight-grid">
          <article className="stage2-insight-card">
            <span className="field-label">Общий корпус</span>
            <strong>{workspaceExamplesCount}</strong>
            <p className="subtle-text">примеров сейчас лежит в общем корпусе рабочего пространства</p>
          </article>
          <article className="stage2-insight-card">
            <span className="field-label">Текущий корпус</span>
            <strong>{activeExamplesPreview.corpus.length}</strong>
            <p className="subtle-text">столько примеров сейчас увидят селектор и генератор</p>
          </article>
          <article className="stage2-insight-card">
            <span className="field-label">Ограничения</span>
            <strong>
              TOP {stage2HardConstraints.topLengthMin}-{stage2HardConstraints.topLengthMax}
            </strong>
            <p className="subtle-text">
              BOTTOM {stage2HardConstraints.bottomLengthMin}-{stage2HardConstraints.bottomLengthMax}
            </p>
          </article>
        </div>

        <div className="compact-field">
          <label className="field-label">JSON корпуса примеров</label>
          <textarea
            className="text-area mono"
            rows={12}
            value={customExamplesJson}
            disabled={!canEditChannelExamples}
            onChange={(event) => updateCustomExamplesJson(event.target.value)}
          />
          {customExamplesError ? (
            <p className="subtle-text danger-text">{customExamplesError}</p>
          ) : (
            <p className="subtle-text">
              По умолчанию сюда подставляется корпус из общих настроек. Если вы
              редактируете JSON, этот канал начинает использовать собственную версию.
            </p>
          )}
        </div>
      </section>

      <section className="control-card control-card-subtle">
        <p className="field-label">Ограничения</p>
        <p className="subtle-text">
          Эти лимиты применяются только к этому каналу. Базовые промпты Stage 2 по-прежнему
          задаются владельцем в общих настройках.
        </p>
        <div className="compact-grid">
          <div className="compact-field">
            <label className="field-label">TOP мин.</label>
            <input
              className="text-input"
              type="number"
              value={stage2HardConstraints.topLengthMin}
              disabled={!canEditHardConstraints}
              onChange={(event) =>
                updateStage2HardConstraint("topLengthMin", event.target.value)
              }
            />
          </div>
          <div className="compact-field">
            <label className="field-label">TOP макс.</label>
            <input
              className="text-input"
              type="number"
              value={stage2HardConstraints.topLengthMax}
              disabled={!canEditHardConstraints}
              onChange={(event) =>
                updateStage2HardConstraint("topLengthMax", event.target.value)
              }
            />
          </div>
          <div className="compact-field">
            <label className="field-label">BOTTOM мин.</label>
            <input
              className="text-input"
              type="number"
              value={stage2HardConstraints.bottomLengthMin}
              disabled={!canEditHardConstraints}
              onChange={(event) =>
                updateStage2HardConstraint("bottomLengthMin", event.target.value)
              }
            />
          </div>
          <div className="compact-field">
            <label className="field-label">BOTTOM макс.</label>
            <input
              className="text-input"
              type="number"
              value={stage2HardConstraints.bottomLengthMax}
              disabled={!canEditHardConstraints}
              onChange={(event) =>
                updateStage2HardConstraint("bottomLengthMax", event.target.value)
              }
            />
          </div>
        </div>
        <div className="compact-grid">
          <div className="compact-field">
            <span className="field-label">TOP</span>
            <strong>
              {stage2HardConstraints.topLengthMin}-{stage2HardConstraints.topLengthMax}
            </strong>
          </div>
          <div className="compact-field">
            <span className="field-label">BOTTOM</span>
            <strong>
              {stage2HardConstraints.bottomLengthMin}-{stage2HardConstraints.bottomLengthMax}
            </strong>
          </div>
        </div>
        <label className="field-label">Запрещённые слова</label>
        <textarea
          className="text-area"
          rows={3}
          value={bannedWordsInput}
          disabled={!canEditHardConstraints}
          onChange={(event) => updateBannedWordsInput(event.target.value)}
        />
        <p className="subtle-text">Разделяйте слова запятыми, точкой с запятой или с новой строки.</p>
        <label className="field-label">Запрещённые начала</label>
        <textarea
          className="text-area"
          rows={3}
          value={bannedOpenersInput}
          disabled={!canEditHardConstraints}
          onChange={(event) => updateBannedOpenersInput(event.target.value)}
        />
        <p className="subtle-text">Запрещённые начала проверяются только в начале TOP и хранятся отдельным списком.</p>
        <p className={`subtle-text ${autosaveState.stage2.status === "error" ? "danger-text" : ""}`}>
          {autosaveState.stage2.message ??
            "На уровне канала автоматически сохраняются JSON корпуса примеров и все ограничения."}
        </p>
        <p className="subtle-text">
          Базовые промпты задаются владельцем в разделе общих настроек. Здесь на уровне канала
          редактируются длины TOP/BOTTOM и списки запретов.
        </p>
      </section>
    </div>
  );
}
