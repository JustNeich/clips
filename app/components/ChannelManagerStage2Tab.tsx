"use client";

import React from "react";
import {
  STAGE2_REASONING_EFFORT_OPTIONS,
  type Stage2PromptConfig
} from "../../lib/stage2-pipeline";
import {
  DEFAULT_ANTHROPIC_CAPTION_MODEL,
  DEFAULT_OPENROUTER_CAPTION_MODEL,
  DEFAULT_STAGE2_CAPTION_PROVIDER_CONFIG,
  isCaptionProviderRoutedStage,
  type Stage2CaptionProvider,
  type Stage2CaptionProviderConfig
} from "../../lib/stage2-caption-provider";
import type {
  WorkspaceAnthropicIntegrationRecord,
  WorkspaceOpenRouterIntegrationRecord
} from "./types";
import {
  DEFAULT_WORKSPACE_CODEX_MODEL_CONFIG,
  getWorkspaceCodexModelOptionsForStage,
  type ResolvedWorkspaceCodexModelConfig,
  type WorkspaceCodexModelConfig,
  type WorkspaceCodexModelSetting,
  type WorkspaceCodexModelStageId
} from "../../lib/workspace-codex-models";
import type { Stage2HardConstraints } from "../../lib/stage2-channel-config";
import type {
  Stage2ExamplesConfig,
  Stage2ExamplesInputMode,
  Stage2ExamplesSourceMode
} from "../../lib/stage2-channel-config";
import {
  findStage2SystemExamplesPresetByJson,
  getStage2SystemExamplesPresetJson,
  STAGE2_SYSTEM_EXAMPLES_PRESETS,
  type Stage2SystemExamplesPresetId
} from "../../lib/stage2-system-presets";
import type { Stage3TemplateFormatGroup } from "../../lib/stage3-template-semantics";
import { AutosaveState } from "./channel-manager-support";

type ChannelManagerStage2TabProps = {
  isWorkspaceDefaultsSelection: boolean;
  workspaceExamplesCount?: number;
  workspaceExamplesJson?: string;
  workspaceExamplesError?: string | null;
  stage2HardConstraints: Stage2HardConstraints;
  bannedWordsInput: string;
  bannedOpenersInput: string;
  workspaceStage2ExamplesCorpusJson?: string;
  workspaceStage2ExamplesSourceMode?: Stage2ExamplesSourceMode;
  workspaceStage2PromptConfig: Stage2PromptConfig;
  channelStage2PromptConfig?: Stage2PromptConfig;
  channelStage2PromptOverridesActive?: boolean;
  workspaceStage2CaptionProviderConfig?: Stage2CaptionProviderConfig;
  workspaceAnthropicIntegration?: WorkspaceAnthropicIntegrationRecord | null;
  workspaceOpenRouterIntegration?: WorkspaceOpenRouterIntegrationRecord | null;
  anthropicApiKeyInput?: string;
  anthropicIntegrationActionState?: {
    status: "idle" | "saving" | "saved" | "error";
    message: string | null;
  };
  openRouterApiKeyInput?: string;
  openRouterIntegrationActionState?: {
    status: "idle" | "saving" | "saved" | "error";
    message: string | null;
  };
  workspaceCodexModelConfig?: WorkspaceCodexModelConfig;
  resolvedWorkspaceCodexModelConfig?: ResolvedWorkspaceCodexModelConfig;
  stage2PromptStages?: Array<{
    id: keyof Stage2PromptConfig["stages"];
    label: string;
    shortLabel: string;
    description: string;
    promptStageType: "llm" | "deterministic";
  }>;
  autosaveState: AutosaveState;
  canEditWorkspaceDefaults: boolean;
  canEditHardConstraints: boolean;
  canEditChannelPrompt?: boolean;
  canEditChannelExamples?: boolean;
  channelTemplateFormatGroup?: Stage3TemplateFormatGroup;
  canEditChannelTemplateFormat?: boolean;
  updateChannelTemplateFormat?: (formatGroup: Stage3TemplateFormatGroup) => void;
  stage2ExamplesConfig?: Stage2ExamplesConfig;
  customExamplesCount?: number;
  stage2WorkerProfileId?: string | null;
  canEditStage2WorkerProfile?: boolean;
  updateStage2WorkerProfileId?: (value: string) => void;
  activeExamplesPreview?: unknown;
  channelStyleProfile?: unknown;
  channelStyleProfileDraft?: unknown;
  channelStyleProfileStatus?: "missing" | "fresh" | "stale";
  channelStyleProfileDirty?: boolean;
  channelStyleProfileFeedbackHistory?: unknown[];
  channelStyleProfileFeedbackHistoryLoading?: boolean;
  onDeleteChannelFeedbackEvent?: (eventId: string) => Promise<void>;
  deletingChannelFeedbackEventId?: string | null;
  channelEditorialMemory?: unknown;
  canEditChannelStyleProfile?: boolean;
  channelStyleProfileDiscovering?: boolean;
  channelStyleProfileDiscoveryError?: string | null;
  channelStyleProfileSaveState?: {
    status: "idle" | "saving" | "saved" | "error";
    message: string | null;
  };
  updateChannelStyleProfileReferenceLinks?: (value: string) => void;
  updateChannelStyleProfileExplorationShare?: (value: number) => void;
  toggleChannelStyleProfileDirectionSelection?: (directionId: string) => void;
  selectAllChannelStyleProfileDirections?: () => void;
  clearChannelStyleProfileDirectionSelection?: () => void;
  startChannelStyleProfileDiscovery?: () => Promise<void>;
  saveChannelStyleProfileDraft?: () => Promise<void>;
  discardChannelStyleProfileDraft?: () => void;
  customExamplesJson?: string;
  customExamplesText?: string;
  customExamplesError?: string | null;
  updateWorkspaceExamplesSourceMode?: (sourceMode: Stage2ExamplesSourceMode) => void;
  updateWorkspaceExamplesPreset?: (presetId: Stage2SystemExamplesPresetId) => void;
  updateWorkspaceExamplesJson?: (value: string) => void;
  updateWorkspaceCaptionProvider?: (value: Stage2CaptionProvider) => void;
  updateWorkspaceAnthropicModel?: (value: string) => void;
  updateWorkspaceOpenRouterModel?: (value: string) => void;
  updateAnthropicApiKeyInput?: (value: string) => void;
  saveWorkspaceAnthropicIntegration?: () => Promise<void>;
  disconnectWorkspaceAnthropicIntegration?: () => Promise<void>;
  updateOpenRouterApiKeyInput?: (value: string) => void;
  saveWorkspaceOpenRouterIntegration?: () => Promise<void>;
  disconnectWorkspaceOpenRouterIntegration?: () => Promise<void>;
  updateChannelExamplesMode?: (useWorkspaceDefault: boolean) => void;
  updateChannelExamplesSourceMode?: (sourceMode: Stage2ExamplesSourceMode) => void;
  updateChannelExamplesSystemPreset?: (presetId: Stage2SystemExamplesPresetId) => void;
  updateChannelExamplesInputMode?: (inputMode: Stage2ExamplesInputMode) => void;
  updateCustomExamplesJson?: (value: string) => void;
  updateCustomExamplesText?: (value: string) => void;
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
  updateChannelStage2PromptTemplate?: (
    stageId: keyof Stage2PromptConfig["stages"],
    prompt: string
  ) => void;
  updateChannelStage2PromptReasoning?: (
    stageId: keyof Stage2PromptConfig["stages"],
    reasoningEffort: Stage2PromptConfig["stages"][keyof Stage2PromptConfig["stages"]]["reasoningEffort"]
  ) => void;
  resetChannelStage2PromptConfig?: () => void;
  updateWorkspaceCodexModelSetting?: (
    stageId: WorkspaceCodexModelStageId,
    value: WorkspaceCodexModelSetting
  ) => void;
};

type PromptFirstChannelStageId = "classicOneShot" | "storyOneShot";

const STAGE2_TEMPLATE_FORMAT_CHOICES: Array<{
  formatGroup: Stage3TemplateFormatGroup;
  label: string;
  description: string;
  pipelineLabel: string;
  stageId: PromptFirstChannelStageId;
  reasoningLabel: string;
  promptLabel: string;
  topLabel: string;
  bottomLabel: string;
  examplesPlaceholder: string;
}> = [
  {
    formatGroup: "classic_top_bottom",
    label: "Top / Bottom",
    description: "classicOneShot для двух overlay-строк",
    pipelineLabel: "classicOneShot -> translation -> SEO",
    stageId: "classicOneShot",
    reasoningLabel: "Classic reasoning",
    promptLabel: "Classic channel prompt",
    topLabel: "TOP",
    bottomLabel: "BOTTOM",
    examplesPlaceholder: '[{"top":"...", "bottom":"...", "note":"любые дополнительные поля"}]'
  },
  {
    formatGroup: "channel_story",
    label: "Lead / Main Caption",
    description: "storyOneShot для story-шаблонов",
    pipelineLabel: "storyOneShot -> translation -> SEO",
    stageId: "storyOneShot",
    reasoningLabel: "Story reasoning",
    promptLabel: "Story channel prompt",
    topLabel: "Lead",
    bottomLabel: "Main Caption",
    examplesPlaceholder: '[{"lead":"...", "mainCaption":"...", "note":"любые дополнительные поля"}]'
  }
];

function getStage2TemplateFormatChoice(formatGroup: Stage3TemplateFormatGroup) {
  return (
    STAGE2_TEMPLATE_FORMAT_CHOICES.find((choice) => choice.formatGroup === formatGroup) ??
    STAGE2_TEMPLATE_FORMAT_CHOICES[0]
  );
}

function formatEffectiveCodexModel(model: string | null): string {
  if (!model) {
    return "стандартная модель деплоя";
  }
  const known = getWorkspaceCodexModelOptionsForStage("oneShotReference").find(
    (option) => option.value === model
  );
  return known?.label ?? model;
}

function formatProviderIntegrationStatus(
  integration:
    | WorkspaceAnthropicIntegrationRecord
    | WorkspaceOpenRouterIntegrationRecord
    | null
    | undefined
): string {
  if (!integration || integration.status === "disconnected") {
    return "Не подключено";
  }
  if (integration.status === "error") {
    return "Ошибка проверки";
  }
  return "Подключено";
}

function describeCaptionProviderIntegration(input: {
  provider: Stage2CaptionProvider;
  integration:
    | WorkspaceAnthropicIntegrationRecord
    | WorkspaceOpenRouterIntegrationRecord
    | null
    | undefined;
  providerValue: "anthropic" | "openrouter";
  providerLabel: string;
}): { note: string | null; disconnectLabel: string } {
  if (input.integration?.status !== "connected") {
    return {
      note: null,
      disconnectLabel: `Отключить ${input.providerLabel}`
    };
  }
  if (input.provider === input.providerValue) {
    return {
      note: `${input.providerLabel} сейчас активен для caption-этапов Stage 2.`,
      disconnectLabel: `Отключить ${input.providerLabel}`
    };
  }
  return {
    note: `${input.providerLabel} подключён, но captions сейчас идут через Shared Codex.`,
    disconnectLabel: `Отключить сохранённый key ${input.providerLabel}`
  };
}

function resolveEffectiveStageModelLabel(input: {
  fieldId: WorkspaceCodexModelStageId;
  resolvedWorkspaceCodexModelConfig: ResolvedWorkspaceCodexModelConfig;
  workspaceStage2CaptionProviderConfig: Stage2CaptionProviderConfig;
}): {
  label: string;
  note: string | null;
} {
  if (
    input.workspaceStage2CaptionProviderConfig.provider !== "codex" &&
    isCaptionProviderRoutedStage(input.fieldId)
  ) {
    const providerLabel =
      input.workspaceStage2CaptionProviderConfig.provider === "openrouter"
        ? "OpenRouter"
        : "Anthropic";
    const providerModel =
      input.workspaceStage2CaptionProviderConfig.provider === "openrouter"
        ? input.workspaceStage2CaptionProviderConfig.openrouterModel?.trim() ||
          DEFAULT_OPENROUTER_CAPTION_MODEL
        : input.workspaceStage2CaptionProviderConfig.anthropicModel?.trim() ||
          DEFAULT_ANTHROPIC_CAPTION_MODEL;
    return {
      label: providerModel,
      note: `Сейчас captions для этого этапа идут через ${providerLabel}. Выбор Shared Codex сохранится как fallback.`
    };
  }
  return {
    label: formatEffectiveCodexModel(input.resolvedWorkspaceCodexModelConfig[input.fieldId]),
    note: null
  };
}

function renderConstraintEditor(input: {
  stage2HardConstraints: Stage2HardConstraints;
  bannedWordsInput: string;
  bannedOpenersInput: string;
  canEditHardConstraints: boolean;
  topLabel?: string;
  bottomLabel?: string;
  updateStage2HardConstraint: (
    key: keyof Stage2HardConstraints,
    value: string | boolean | string[]
  ) => void;
  updateBannedWordsInput: (value: string) => void;
  updateBannedOpenersInput: (value: string) => void;
}): React.ReactNode {
  const topLabel = input.topLabel ?? "TOP";
  const bottomLabel = input.bottomLabel ?? "BOTTOM";

  return (
    <div className="compact-field">
      <p className="field-label">Hard constraints</p>
      <div className="compact-grid">
        <div className="compact-field">
          <label className="field-label">{topLabel} мин.</label>
          <input
            className="text-input"
            type="number"
            value={input.stage2HardConstraints.topLengthMin}
            disabled={!input.canEditHardConstraints}
            onChange={(event) =>
              input.updateStage2HardConstraint("topLengthMin", event.target.value)
            }
          />
        </div>
        <div className="compact-field">
          <label className="field-label">{topLabel} макс.</label>
          <input
            className="text-input"
            type="number"
            value={input.stage2HardConstraints.topLengthMax}
            disabled={!input.canEditHardConstraints}
            onChange={(event) =>
              input.updateStage2HardConstraint("topLengthMax", event.target.value)
            }
          />
        </div>
        <div className="compact-field">
          <label className="field-label">{bottomLabel} мин.</label>
          <input
            className="text-input"
            type="number"
            value={input.stage2HardConstraints.bottomLengthMin}
            disabled={!input.canEditHardConstraints}
            onChange={(event) =>
              input.updateStage2HardConstraint("bottomLengthMin", event.target.value)
            }
          />
        </div>
        <div className="compact-field">
          <label className="field-label">{bottomLabel} макс.</label>
          <input
            className="text-input"
            type="number"
            value={input.stage2HardConstraints.bottomLengthMax}
            disabled={!input.canEditHardConstraints}
            onChange={(event) =>
              input.updateStage2HardConstraint("bottomLengthMax", event.target.value)
            }
          />
        </div>
      </div>
      <label className="field-label">Запрещённые слова</label>
      <textarea
        className="text-area"
        rows={3}
        value={input.bannedWordsInput}
        disabled={!input.canEditHardConstraints}
        onChange={(event) => input.updateBannedWordsInput(event.target.value)}
      />
      <p className="subtle-text">Разделяйте слова запятыми, точкой с запятой или новой строкой.</p>
      <label className="field-label">Запрещённые начала</label>
      <textarea
        className="text-area"
        rows={3}
        value={input.bannedOpenersInput}
        disabled={!input.canEditHardConstraints}
        onChange={(event) => input.updateBannedOpenersInput(event.target.value)}
      />
      <p className="subtle-text">Проверяются только в начале поля {topLabel}.</p>
    </div>
  );
}

function renderOneShotModelField(input: {
  workspaceCodexModelConfig: WorkspaceCodexModelConfig;
  resolvedWorkspaceCodexModelConfig: ResolvedWorkspaceCodexModelConfig;
  workspaceStage2CaptionProviderConfig: Stage2CaptionProviderConfig;
  canEditWorkspaceDefaults: boolean;
  updateWorkspaceCodexModelSetting: (
    stageId: WorkspaceCodexModelStageId,
    value: WorkspaceCodexModelSetting
  ) => void;
}): React.ReactNode {
  const effectiveModel = resolveEffectiveStageModelLabel({
    fieldId: "oneShotReference",
    resolvedWorkspaceCodexModelConfig: input.resolvedWorkspaceCodexModelConfig,
    workspaceStage2CaptionProviderConfig: input.workspaceStage2CaptionProviderConfig
  });

  return (
    <div className="compact-field">
      <label className="field-label">One-shot model</label>
      <select
        className="text-input"
        value={input.workspaceCodexModelConfig.oneShotReference}
        disabled={!input.canEditWorkspaceDefaults}
        onChange={(event) =>
          input.updateWorkspaceCodexModelSetting(
            "oneShotReference",
            event.target.value as WorkspaceCodexModelSetting
          )
        }
      >
        <option value="deploy_default">Как на деплое</option>
        {getWorkspaceCodexModelOptionsForStage("oneShotReference").map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="subtle-text">
        Это единственная активная Stage 2 model override для caption-writing baseline.
      </p>
      <p className="subtle-text">
        Сейчас применяется: <strong>{effectiveModel.label}</strong>
      </p>
      {effectiveModel.note ? <p className="subtle-text">{effectiveModel.note}</p> : null}
    </div>
  );
}

function renderProviderIntegrationBlock(input: {
  providerLabel: string;
  provider: Stage2CaptionProvider;
  providerValue: "anthropic" | "openrouter";
  integration:
    | WorkspaceAnthropicIntegrationRecord
    | WorkspaceOpenRouterIntegrationRecord
    | null
    | undefined;
  modelValue: string;
  modelPlaceholder: string;
  apiKeyInput: string;
  actionState: {
    status: "idle" | "saving" | "saved" | "error";
    message: string | null;
  };
  canEditWorkspaceDefaults: boolean;
  updateModel: (value: string) => void;
  updateApiKeyInput: (value: string) => void;
  saveIntegration: () => Promise<void>;
  disconnectIntegration: () => Promise<void>;
  docsLinks: Array<{ href: string; label: string }>;
}): React.ReactNode {
  const details = describeCaptionProviderIntegration({
    provider: input.provider,
    integration: input.integration,
    providerValue: input.providerValue,
    providerLabel: input.providerLabel
  });

  return (
    <div className="compact-grid">
      <div className="compact-field">
        <label className="field-label">{input.providerLabel} model</label>
        <input
          className="text-input mono"
          value={input.modelValue}
          disabled={!input.canEditWorkspaceDefaults}
          onChange={(event) => input.updateModel(event.target.value)}
          placeholder={input.modelPlaceholder}
        />
        <p className="subtle-text">
          Поле свободное, чтобы можно было быстро переключать provider-specific model ids без миграции схемы.
        </p>
      </div>
      <div className="compact-field">
        <label className="field-label">{input.providerLabel} API key</label>
        <input
          className="text-input mono"
          type="password"
          value={input.apiKeyInput}
          disabled={!input.canEditWorkspaceDefaults || input.actionState.status === "saving"}
          onChange={(event) => input.updateApiKeyInput(event.target.value)}
        />
        <p className="subtle-text">
          Статус: <strong>{formatProviderIntegrationStatus(input.integration)}</strong>
          {input.integration?.apiKeyHint ? ` · ${input.integration.apiKeyHint}` : ""}
        </p>
        {input.integration?.connectedAt ? (
          <p className="subtle-text">
            Последняя успешная проверка: {new Date(input.integration.connectedAt).toLocaleString("ru-RU")}
          </p>
        ) : null}
        {input.integration?.lastError ? (
          <p className="subtle-text danger-text">{input.integration.lastError}</p>
        ) : null}
        {details.note ? <p className="subtle-text">{details.note}</p> : null}
        {input.actionState.message ? (
          <p className={`subtle-text ${input.actionState.status === "error" ? "danger-text" : ""}`}>
            {input.actionState.message}
          </p>
        ) : null}
      </div>
      <div className="compact-field">
        <label className="field-label">Настройка {input.providerLabel}</label>
        <div className="control-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!input.canEditWorkspaceDefaults || input.actionState.status === "saving"}
            onClick={() => {
              void input.saveIntegration();
            }}
          >
            {input.integration?.status === "connected" ? "Обновить key и проверить" : "Подключить key и проверить"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={
              !input.canEditWorkspaceDefaults ||
              input.actionState.status === "saving" ||
              !input.integration ||
              input.integration.status === "disconnected"
            }
            onClick={() => {
              void input.disconnectIntegration();
            }}
          >
            {details.disconnectLabel}
          </button>
        </div>
        <p className="subtle-text">
          {input.docsLinks.map((item, index) => (
            <React.Fragment key={item.href}>
              {index > 0 ? " · " : ""}
              <a href={item.href} target="_blank" rel="noreferrer">
                {item.label}
              </a>
            </React.Fragment>
          ))}
        </p>
      </div>
    </div>
  );
}

function ChoiceButton(input: {
  active: boolean;
  disabled?: boolean;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`settings-choice ${input.active ? "active" : ""}`}
      disabled={input.disabled}
      aria-pressed={input.active}
      aria-label={`${input.label}: ${input.description}`}
      onClick={input.onClick}
    >
      <strong>{input.label}</strong>
      <span>{input.description}</span>
    </button>
  );
}

function renderExamplesPresetChoices(input: {
  selectedId: Stage2SystemExamplesPresetId;
  disabled?: boolean;
  onSelect: (presetId: Stage2SystemExamplesPresetId) => void;
}) {
  return (
    <div className="settings-choice-grid">
      {STAGE2_SYSTEM_EXAMPLES_PRESETS.map((preset) => (
        <ChoiceButton
          key={preset.id}
          active={input.selectedId === preset.id}
          disabled={input.disabled}
          label={preset.label}
          description={preset.description}
          onClick={() => input.onSelect(preset.id)}
        />
      ))}
    </div>
  );
}

export function ChannelManagerStage2Tab({
  isWorkspaceDefaultsSelection,
  stage2HardConstraints,
  bannedWordsInput,
  bannedOpenersInput,
  workspaceStage2ExamplesCorpusJson = getStage2SystemExamplesPresetJson("system_examples"),
  workspaceStage2ExamplesSourceMode,
  workspaceStage2PromptConfig,
  channelStage2PromptConfig,
  channelStage2PromptOverridesActive = false,
  workspaceStage2CaptionProviderConfig = DEFAULT_STAGE2_CAPTION_PROVIDER_CONFIG,
  workspaceAnthropicIntegration = null,
  workspaceOpenRouterIntegration = null,
  anthropicApiKeyInput = "",
  anthropicIntegrationActionState = { status: "idle", message: null },
  openRouterApiKeyInput = "",
  openRouterIntegrationActionState = { status: "idle", message: null },
  workspaceCodexModelConfig = DEFAULT_WORKSPACE_CODEX_MODEL_CONFIG,
  resolvedWorkspaceCodexModelConfig = {
    classicOneShot: null,
    storyOneShot: null,
    oneShotReference: null,
    contextPacket: null,
    candidateGenerator: null,
    qualityCourt: null,
    targetedRepair: null,
    captionHighlighting: null,
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
  autosaveState,
  canEditWorkspaceDefaults,
  canEditHardConstraints,
  canEditChannelPrompt,
  canEditChannelExamples = false,
  channelTemplateFormatGroup = "classic_top_bottom",
  canEditChannelTemplateFormat = false,
  updateChannelTemplateFormat = () => undefined,
  stage2ExamplesConfig,
  customExamplesJson = "",
  customExamplesText = "",
  customExamplesCount = 0,
  updateWorkspaceExamplesSourceMode = () => undefined,
  updateWorkspaceExamplesPreset = () => undefined,
  updateWorkspaceExamplesJson = () => undefined,
  updateWorkspaceCaptionProvider = () => undefined,
  updateWorkspaceAnthropicModel = () => undefined,
  updateWorkspaceOpenRouterModel = () => undefined,
  updateAnthropicApiKeyInput = () => undefined,
  saveWorkspaceAnthropicIntegration = async () => undefined,
  disconnectWorkspaceAnthropicIntegration = async () => undefined,
  updateOpenRouterApiKeyInput = () => undefined,
  saveWorkspaceOpenRouterIntegration = async () => undefined,
  disconnectWorkspaceOpenRouterIntegration = async () => undefined,
  updateChannelExamplesMode = () => undefined,
  updateChannelExamplesSourceMode = () => undefined,
  updateChannelExamplesSystemPreset = () => undefined,
  updateChannelExamplesInputMode = () => undefined,
  updateCustomExamplesJson = () => undefined,
  updateCustomExamplesText = () => undefined,
  updateStage2HardConstraint,
  updateBannedWordsInput,
  updateBannedOpenersInput,
  updateStage2PromptTemplate,
  updateStage2PromptReasoning,
  resetStage2PromptStage,
  updateChannelStage2PromptTemplate = () => undefined,
  updateChannelStage2PromptReasoning = () => undefined,
  resetChannelStage2PromptConfig = () => undefined,
  updateWorkspaceCodexModelSetting = () => undefined
}: ChannelManagerStage2TabProps) {
  const classicOneShotStageConfig = workspaceStage2PromptConfig.stages.classicOneShot;
  const storyOneShotStageConfig = workspaceStage2PromptConfig.stages.storyOneShot;
  const effectiveChannelPromptConfig = channelStage2PromptOverridesActive
    ? channelStage2PromptConfig ?? workspaceStage2PromptConfig
    : workspaceStage2PromptConfig;
  const canEditEffectiveChannelPrompt = canEditChannelPrompt ?? canEditHardConstraints;
  const activeTemplateFormatChoice = getStage2TemplateFormatChoice(channelTemplateFormatGroup);
  const activeChannelPromptStageConfig =
    effectiveChannelPromptConfig.stages[activeTemplateFormatChoice.stageId];
  const anthropicModelValue =
    workspaceStage2CaptionProviderConfig.anthropicModel ?? DEFAULT_ANTHROPIC_CAPTION_MODEL;
  const openRouterModelValue =
    workspaceStage2CaptionProviderConfig.openrouterModel ?? DEFAULT_OPENROUTER_CAPTION_MODEL;
  const anthropicIntegrationConnected = workspaceAnthropicIntegration?.status === "connected";
  const openRouterIntegrationConnected = workspaceOpenRouterIntegration?.status === "connected";
  const workspaceExamplesPresetId =
    findStage2SystemExamplesPresetByJson(workspaceStage2ExamplesCorpusJson) ?? "system_examples";
  const resolvedWorkspaceExamplesSourceMode =
    workspaceStage2ExamplesSourceMode ??
    (findStage2SystemExamplesPresetByJson(workspaceStage2ExamplesCorpusJson)
      ? "system"
      : "custom");
  const channelExamplesMode = stage2ExamplesConfig?.useWorkspaceDefault === false ? "channel" : "workspace";
  const channelExamplesSourceMode = stage2ExamplesConfig?.sourceMode ?? "system";
  const channelExamplesInputMode = stage2ExamplesConfig?.customInputMode ?? "json";
  const channelExamplesSystemPresetId = stage2ExamplesConfig?.systemPresetId ?? "system_examples";
  const workspaceExamplesJsonError = (() => {
    if (!workspaceStage2ExamplesCorpusJson.trim()) {
      return null;
    }
    try {
      JSON.parse(workspaceStage2ExamplesCorpusJson);
      return null;
    } catch {
      return "JSON общего корпуса не парсится. Переключитесь на system preset или исправьте JSON.";
    }
  })();
  const customExamplesJsonError = (() => {
    if (!customExamplesJson.trim()) {
      return null;
    }
    try {
      JSON.parse(customExamplesJson);
      return null;
    } catch {
      return "JSON не парсится. Можно сохранить text examples отдельно, но этот JSON не попадёт в corpus.";
    }
  })();
  const readExamplesFile = async (
    file: File | undefined,
    applyValue: (value: string) => void
  ): Promise<void> => {
    if (!file) {
      return;
    }
    applyValue(await file.text());
  };

  if (isWorkspaceDefaultsSelection) {
    return (
      <div className="field-stack">
        <section className="control-card control-card-priority">
          <p className="field-label">Single baseline Stage 2</p>
          <p className="subtle-text">
            Рабочее пространство задаёт fallback для новых каналов: hard constraints, caption provider,
            one-shot model и два prompt-first contracts.
          </p>
        </section>

        <section className="control-card control-card-subtle">
          <div className="stage2-insight-grid">
            <article className="stage2-insight-card">
              <span className="field-label">Pipeline</span>
              <strong>native_caption_v3</strong>
              <p className="subtle-text">classicOneShot / storyOneShot → highlighting? → translation → SEO → assemble</p>
            </article>
            <article className="stage2-insight-card">
              <span className="field-label">TOP</span>
              <strong>
                {stage2HardConstraints.topLengthMin}-{stage2HardConstraints.topLengthMax}
              </strong>
              <p className="subtle-text">активный диапазон по умолчанию</p>
            </article>
            <article className="stage2-insight-card">
              <span className="field-label">BOTTOM</span>
              <strong>
                {stage2HardConstraints.bottomLengthMin}-{stage2HardConstraints.bottomLengthMax}
              </strong>
              <p className="subtle-text">активный диапазон по умолчанию</p>
            </article>
            <article className="stage2-insight-card">
              <span className="field-label">Caption provider</span>
              <strong>{workspaceStage2CaptionProviderConfig.provider === "codex" ? "Shared Codex" : workspaceStage2CaptionProviderConfig.provider === "anthropic" ? "Anthropic" : "OpenRouter"}</strong>
              <p className="subtle-text">маршрутизирует `classicOneShot`, `storyOneShot` и `regenerate`</p>
            </article>
          </div>

          {renderConstraintEditor({
            stage2HardConstraints,
            bannedWordsInput,
            bannedOpenersInput,
            canEditHardConstraints,
            updateStage2HardConstraint,
            updateBannedWordsInput,
            updateBannedOpenersInput
          })}

          <div className="compact-field">
            <p className="field-label">Caption provider</p>
            <p className="subtle-text">
              Внешний provider влияет только на prompt-first caption stages и `regenerate`. Translation, SEO и остальные downstream product stages остаются на Shared Codex.
            </p>
            <label className="field-label">Провайдер captions</label>
            <select
              className="text-input"
              value={workspaceStage2CaptionProviderConfig.provider}
              disabled={!canEditWorkspaceDefaults}
              onChange={(event) =>
                updateWorkspaceCaptionProvider(event.target.value as Stage2CaptionProvider)
              }
            >
              <option value="codex">Shared Codex</option>
              <option value="anthropic" disabled={!anthropicIntegrationConnected}>
                Anthropic API
              </option>
              <option value="openrouter" disabled={!openRouterIntegrationConnected}>
                OpenRouter API
              </option>
            </select>
            {!anthropicIntegrationConnected || !openRouterIntegrationConnected ? (
              <p className="subtle-text">
                Внешний provider станет доступен после успешной проверки соответствующего API key.
              </p>
            ) : null}
          </div>

          {renderProviderIntegrationBlock({
            providerLabel: "Anthropic",
            provider: workspaceStage2CaptionProviderConfig.provider,
            providerValue: "anthropic",
            integration: workspaceAnthropicIntegration,
            modelValue: anthropicModelValue,
            modelPlaceholder: DEFAULT_ANTHROPIC_CAPTION_MODEL,
            apiKeyInput: anthropicApiKeyInput,
            actionState: anthropicIntegrationActionState,
            canEditWorkspaceDefaults,
            updateModel: updateWorkspaceAnthropicModel,
            updateApiKeyInput: updateAnthropicApiKeyInput,
            saveIntegration: saveWorkspaceAnthropicIntegration,
            disconnectIntegration: disconnectWorkspaceAnthropicIntegration,
            docsLinks: [
              { href: "https://platform.claude.com/settings/keys", label: "API keys" },
              { href: "https://platform.claude.com/settings/billing", label: "Billing" },
              { href: "https://docs.anthropic.com/en/docs/about-claude/pricing", label: "Pricing" }
            ]
          })}

          {renderProviderIntegrationBlock({
            providerLabel: "OpenRouter",
            provider: workspaceStage2CaptionProviderConfig.provider,
            providerValue: "openrouter",
            integration: workspaceOpenRouterIntegration,
            modelValue: openRouterModelValue,
            modelPlaceholder: DEFAULT_OPENROUTER_CAPTION_MODEL,
            apiKeyInput: openRouterApiKeyInput,
            actionState: openRouterIntegrationActionState,
            canEditWorkspaceDefaults,
            updateModel: updateWorkspaceOpenRouterModel,
            updateApiKeyInput: updateOpenRouterApiKeyInput,
            saveIntegration: saveWorkspaceOpenRouterIntegration,
            disconnectIntegration: disconnectWorkspaceOpenRouterIntegration,
            docsLinks: [
              { href: "https://openrouter.ai/settings/keys", label: "API keys" },
              { href: "https://openrouter.ai/settings/credits/", label: "Credits" },
              { href: "https://openrouter.ai/pricing", label: "Pricing" }
            ]
          })}

          <div className="compact-grid">
            {renderOneShotModelField({
              workspaceCodexModelConfig,
              resolvedWorkspaceCodexModelConfig,
              workspaceStage2CaptionProviderConfig,
              canEditWorkspaceDefaults,
              updateWorkspaceCodexModelSetting
            })}
            <div className="compact-field">
              <label className="field-label">One-shot reasoning</label>
              <select
                className="text-input"
                value={classicOneShotStageConfig.reasoningEffort}
                disabled={!canEditWorkspaceDefaults}
                onChange={(event) =>
                  updateStage2PromptReasoning(
                    "classicOneShot",
                    event.target.value as typeof classicOneShotStageConfig.reasoningEffort
                  )
                }
              >
                {STAGE2_REASONING_EFFORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="subtle-text">
                Базовый уровень рассуждений для classic Top/Bottom prompt-first линии.
              </p>
            </div>
            <div className="compact-field">
              <label className="field-label">Story reasoning</label>
              <select
                className="text-input"
                value={storyOneShotStageConfig.reasoningEffort}
                disabled={!canEditWorkspaceDefaults}
                onChange={(event) =>
                  updateStage2PromptReasoning(
                    "storyOneShot",
                    event.target.value as typeof storyOneShotStageConfig.reasoningEffort
                  )
                }
              >
                {STAGE2_REASONING_EFFORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="subtle-text">
                Базовый уровень рассуждений для Lead/Main Caption prompt-first линии.
              </p>
            </div>
          </div>

          <div className="compact-field">
            <label className="field-label">Classic prompt</label>
            <textarea
              className="text-area mono"
              rows={18}
              value={classicOneShotStageConfig.prompt}
              disabled={!canEditWorkspaceDefaults}
              onChange={(event) =>
                updateStage2PromptTemplate("classicOneShot", event.target.value)
              }
            />
            <p className="subtle-text">
              Активный prompt contract: `source_video_json`, `examples_json`, `format_contract_json`, `hard_constraints_json`, `user_instruction`.
            </p>
            <div className="stage2-config-stage-actions">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!canEditWorkspaceDefaults}
                onClick={() => resetStage2PromptStage("classicOneShot")}
              >
                Сбросить к продуктовым настройкам
              </button>
            </div>
          </div>

          <div className="compact-field">
            <label className="field-label">Story prompt</label>
            <textarea
              className="text-area mono"
              rows={18}
              value={storyOneShotStageConfig.prompt}
              disabled={!canEditWorkspaceDefaults}
              onChange={(event) =>
                updateStage2PromptTemplate("storyOneShot", event.target.value)
              }
            />
            <p className="subtle-text">
              Отдельная Lead/Main Caption линия с собственным output schema.
            </p>
            <div className="stage2-config-stage-actions">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!canEditWorkspaceDefaults}
                onClick={() => resetStage2PromptStage("storyOneShot")}
              >
                Сбросить к продуктовым настройкам
              </button>
            </div>
          </div>

          <div className="compact-field">
            <p className="field-label">Examples corpus</p>
            <div className="settings-choice-row">
              <ChoiceButton
                active={resolvedWorkspaceExamplesSourceMode === "system"}
                disabled={!canEditWorkspaceDefaults}
                label="System"
                description="готовый examples corpus"
                onClick={() => updateWorkspaceExamplesSourceMode("system")}
              />
              <ChoiceButton
                active={resolvedWorkspaceExamplesSourceMode === "custom"}
                disabled={!canEditWorkspaceDefaults}
                label="Custom"
                description="ручной JSON corpus"
                onClick={() => updateWorkspaceExamplesSourceMode("custom")}
              />
            </div>
            {resolvedWorkspaceExamplesSourceMode === "system" ? (
              renderExamplesPresetChoices({
                selectedId: workspaceExamplesPresetId,
                disabled: !canEditWorkspaceDefaults,
                onSelect: updateWorkspaceExamplesPreset
              })
            ) : (
              <>
                <label className="field-label">Custom examples JSON</label>
                <textarea
                  className="text-area mono"
                  rows={12}
                  value={workspaceStage2ExamplesCorpusJson}
                  disabled={!canEditWorkspaceDefaults}
                  placeholder='[{"top":"...", "bottom":"...", "note":"любые поля"}]'
                  onChange={(event) => updateWorkspaceExamplesJson(event.target.value)}
                />
                <div className="control-actions">
                  <label className={`btn btn-ghost ${canEditWorkspaceDefaults ? "" : "disabled"}`}>
                    Upload JSON
                    <input
                      type="file"
                      accept=".json,application/json"
                      hidden
                      disabled={!canEditWorkspaceDefaults}
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        event.currentTarget.value = "";
                        void readExamplesFile(file, updateWorkspaceExamplesJson);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={!canEditWorkspaceDefaults || !workspaceStage2ExamplesCorpusJson.trim()}
                    onClick={() => updateWorkspaceExamplesJson("[]")}
                  >
                    Очистить JSON
                  </button>
                </div>
                <p className={`subtle-text ${workspaceExamplesJsonError ? "danger-text" : ""}`}>
                  {workspaceExamplesJsonError ??
                    "Все examples из active workspace corpus попадут в prompt-first `examples_json` без скрытой выборки."}
                </p>
              </>
            )}
          </div>

          <p
            className={`subtle-text ${autosaveState.stage2Defaults.status === "error" ? "danger-text" : ""}`}
          >
            {autosaveState.stage2Defaults.message ?? "Общие AI-настройки сохраняются автоматически."}
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="field-stack">
      <section className="control-card control-card-priority">
        <p className="field-label">Настройки Stage 2 канала</p>
        <p className="subtle-text">
          Канал выбирает тип шаблона, а Stage 2 показывает только настройки нужной prompt-first
          линии. Provider и model остаются общими настройками workspace.
        </p>
      </section>

      <section className="control-card control-card-subtle">
        <div className="stage2-insight-grid">
          <article className="stage2-insight-card">
            <span className="field-label">Template type</span>
            <strong>{activeTemplateFormatChoice.label}</strong>
            <p className="subtle-text">{activeTemplateFormatChoice.pipelineLabel}</p>
          </article>
          <article className="stage2-insight-card">
            <span className="field-label">Provider</span>
            <strong>{workspaceStage2CaptionProviderConfig.provider === "codex" ? "Shared Codex" : workspaceStage2CaptionProviderConfig.provider === "anthropic" ? "Anthropic" : "OpenRouter"}</strong>
            <p className="subtle-text">управляется владельцем в общих настройках</p>
          </article>
          <article className="stage2-insight-card">
            <span className="field-label">Prompt</span>
            <strong>
              {channelStage2PromptOverridesActive ? "Channel prompt override" : "Workspace prompt fallback"}
            </strong>
            <p className="subtle-text">
              {channelStage2PromptOverridesActive
                ? `канал использует собственный ${activeTemplateFormatChoice.label} contract`
                : "пока наследует workspace defaults; редактирование активного prompt создаст override"}
            </p>
          </article>
          <article className="stage2-insight-card">
            <span className="field-label">Examples</span>
            <strong>{channelExamplesMode === "workspace" ? "Workspace default" : "Channel override"}</strong>
            <p className="subtle-text">
              {channelExamplesMode === "workspace"
                ? resolvedWorkspaceExamplesSourceMode === "system"
                  ? "system examples"
                  : "workspace custom JSON"
                : channelExamplesSourceMode === "system"
                  ? "system preset"
                  : channelExamplesInputMode === "json"
                    ? `${customExamplesCount} JSON examples`
                    : "plain text examples"}
            </p>
          </article>
        </div>

        <div className="compact-field stage2-template-format-panel">
          <div className="stage2-section-head">
            <div>
              <p className="field-label">Template type</p>
              <p className="subtle-text">
                Выбор меняет Stage 3 template family канала и Stage 2 prompt contract для новых
                прогонов.
              </p>
            </div>
            <span className="meta-pill">{activeTemplateFormatChoice.pipelineLabel}</span>
          </div>
          <div className="settings-choice-row">
            {STAGE2_TEMPLATE_FORMAT_CHOICES.map((choice) => (
              <ChoiceButton
                key={choice.formatGroup}
                active={activeTemplateFormatChoice.formatGroup === choice.formatGroup}
                disabled={!canEditChannelTemplateFormat}
                label={choice.label}
                description={choice.description}
                onClick={() => updateChannelTemplateFormat(choice.formatGroup)}
              />
            ))}
          </div>
          <p className="subtle-text">
            Конкретный визуальный шаблон этого типа можно уточнить во вкладке «Рендер».
          </p>
        </div>

        {renderConstraintEditor({
          stage2HardConstraints,
          bannedWordsInput,
          bannedOpenersInput,
          canEditHardConstraints,
          topLabel: activeTemplateFormatChoice.topLabel,
          bottomLabel: activeTemplateFormatChoice.bottomLabel,
          updateStage2HardConstraint,
          updateBannedWordsInput,
          updateBannedOpenersInput
        })}

        <div className="compact-field">
          <p className="field-label">Channel prompt contracts</p>
          <div className="compact-grid">
            <div className="compact-field">
              <label className="field-label">{activeTemplateFormatChoice.reasoningLabel}</label>
              <select
                className="text-input"
                value={activeChannelPromptStageConfig.reasoningEffort}
                disabled={!canEditEffectiveChannelPrompt}
                onChange={(event) =>
                  updateChannelStage2PromptReasoning(
                    activeTemplateFormatChoice.stageId,
                    event.target.value as typeof activeChannelPromptStageConfig.reasoningEffort
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
            <div className="compact-field">
              <span className="field-label">Active contract</span>
              <strong>{activeTemplateFormatChoice.label}</strong>
              <p className="subtle-text">
                Редактируется только prompt, который реально получит provider для выбранного типа.
              </p>
            </div>
          </div>

          <label className="field-label">{activeTemplateFormatChoice.promptLabel}</label>
          <textarea
            className="text-area mono"
            rows={12}
            value={activeChannelPromptStageConfig.prompt}
            disabled={!canEditEffectiveChannelPrompt}
            onChange={(event) =>
              updateChannelStage2PromptTemplate(
                activeTemplateFormatChoice.stageId,
                event.target.value
              )
            }
          />
          <p className="subtle-text">
            Runtime передаёт provider-у raw-блоки: `source_video_json`, `examples_json`,
            `format_contract_json`, `hard_constraints_json`, `user_instruction`.
          </p>
          <div className="stage2-config-stage-actions">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!canEditEffectiveChannelPrompt || !channelStage2PromptOverridesActive}
              onClick={resetChannelStage2PromptConfig}
            >
              Наследовать workspace prompt
            </button>
          </div>
        </div>

        <div className="channel-onboarding-note-card">
          <strong>Legacy context</strong>
          <p className="subtle-text">
            Старые worker profile, style discovery и editorial memory больше не редактируются из active Stage 2 surface. Examples берутся целиком из active corpus: channel custom или workspace default.
          </p>
        </div>

        <div className="compact-field">
          <p className="field-label">Channel examples</p>
          <div className="settings-choice-row">
            <ChoiceButton
              active={channelExamplesMode === "workspace"}
              disabled={!canEditChannelExamples}
              label="Workspace default"
              description="наследовать общий corpus"
              onClick={() => updateChannelExamplesMode(true)}
            />
            <ChoiceButton
              active={channelExamplesMode === "channel"}
              disabled={!canEditChannelExamples}
              label="Channel override"
              description="отдельные examples"
              onClick={() => updateChannelExamplesMode(false)}
            />
          </div>
          {channelExamplesMode === "workspace" ? (
            <p className="subtle-text">
              Сейчас provider получает все examples из workspace default source.
            </p>
          ) : (
            <>
              <div className="settings-choice-row">
                <ChoiceButton
                  active={channelExamplesSourceMode === "system"}
                  disabled={!canEditChannelExamples}
                  label="System"
                  description="готовый corpus"
                  onClick={() => updateChannelExamplesSourceMode("system")}
                />
                <ChoiceButton
                  active={channelExamplesSourceMode === "custom"}
                  disabled={!canEditChannelExamples}
                  label="Custom"
                  description="JSON или text"
                  onClick={() => updateChannelExamplesSourceMode("custom")}
                />
              </div>
              {channelExamplesSourceMode === "system" ? (
                renderExamplesPresetChoices({
                  selectedId: channelExamplesSystemPresetId,
                  disabled: !canEditChannelExamples,
                  onSelect: updateChannelExamplesSystemPreset
                })
              ) : (
                <>
                  <div className="settings-choice-row">
                    <ChoiceButton
                      active={channelExamplesInputMode === "json"}
                      disabled={!canEditChannelExamples}
                      label="JSON"
                      description="массив примеров"
                      onClick={() => updateChannelExamplesInputMode("json")}
                    />
                    <ChoiceButton
                      active={channelExamplesInputMode === "text"}
                      disabled={!canEditChannelExamples}
                      label="Text"
                      description="свободный corpus"
                      onClick={() => updateChannelExamplesInputMode("text")}
                    />
                  </div>
                  {channelExamplesInputMode === "json" ? (
                    <>
                      <label className="field-label">JSON examples</label>
                      <textarea
                        className="text-area mono"
                        rows={10}
                        value={customExamplesJson}
                        disabled={!canEditChannelExamples}
                        placeholder={activeTemplateFormatChoice.examplesPlaceholder}
                        onChange={(event) => updateCustomExamplesJson(event.target.value)}
                      />
                      <div className="control-actions">
                        <label className={`btn btn-ghost ${canEditChannelExamples ? "" : "disabled"}`}>
                          Upload JSON
                          <input
                            type="file"
                            accept=".json,application/json"
                            hidden
                            disabled={!canEditChannelExamples}
                            onChange={(event) => {
                              const file = event.currentTarget.files?.[0];
                              event.currentTarget.value = "";
                              void readExamplesFile(file, updateCustomExamplesJson);
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={!canEditChannelExamples || !customExamplesJson.trim()}
                          onClick={() => updateCustomExamplesJson("")}
                        >
                          Очистить JSON
                        </button>
                      </div>
                      <p className={`subtle-text ${customExamplesJsonError ? "danger-text" : ""}`}>
                        {customExamplesJsonError ??
                          "Все parsed JSON examples попадут в `examples_json`; runtime не выбирает active corpus внутри себя."}
                      </p>
                    </>
                  ) : (
                    <>
                      <label className="field-label">Plain text examples</label>
                      <textarea
                        className="text-area"
                        rows={10}
                        value={customExamplesText}
                        disabled={!canEditChannelExamples}
                        placeholder="Вставьте примеры текстов, удачные формулировки, тональность или мини-корпус без JSON."
                        onChange={(event) => updateCustomExamplesText(event.target.value)}
                      />
                      <div className="control-actions">
                        <label className={`btn btn-ghost ${canEditChannelExamples ? "" : "disabled"}`}>
                          Upload TXT
                          <input
                            type="file"
                            accept=".txt,text/plain"
                            hidden
                            disabled={!canEditChannelExamples}
                            onChange={(event) => {
                              const file = event.currentTarget.files?.[0];
                              event.currentTarget.value = "";
                              void readExamplesFile(file, updateCustomExamplesText);
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={!canEditChannelExamples || !customExamplesText.trim()}
                          onClick={() => updateCustomExamplesText("")}
                        >
                          Очистить текст
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>

        <p className={`subtle-text ${autosaveState.stage2.status === "error" ? "danger-text" : ""}`}>
          {autosaveState.stage2.message ?? "Настройки Stage 2 канала сохраняются автоматически."}
        </p>
      </section>
    </div>
  );
}
