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
import { AutosaveState } from "./channel-manager-support";

type ChannelManagerStage2TabProps = {
  isWorkspaceDefaultsSelection: boolean;
  workspaceExamplesCount?: number;
  workspaceExamplesJson?: string;
  workspaceExamplesError?: string | null;
  stage2HardConstraints: Stage2HardConstraints;
  bannedWordsInput: string;
  bannedOpenersInput: string;
  workspaceStage2PromptConfig: Stage2PromptConfig;
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
  canEditChannelExamples?: boolean;
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
  customExamplesError?: string | null;
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
  updateCustomExamplesJson?: (value: string) => void;
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
  updateStage2HardConstraint: (
    key: keyof Stage2HardConstraints,
    value: string | boolean | string[]
  ) => void;
  updateBannedWordsInput: (value: string) => void;
  updateBannedOpenersInput: (value: string) => void;
}): React.ReactNode {
  return (
    <div className="compact-field">
      <p className="field-label">Hard constraints</p>
      <div className="compact-grid">
        <div className="compact-field">
          <label className="field-label">TOP мин.</label>
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
          <label className="field-label">TOP макс.</label>
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
          <label className="field-label">BOTTOM мин.</label>
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
          <label className="field-label">BOTTOM макс.</label>
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
      <p className="subtle-text">Проверяются только в начале верхней строки.</p>
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

export function ChannelManagerStage2Tab({
  isWorkspaceDefaultsSelection,
  stage2HardConstraints,
  bannedWordsInput,
  bannedOpenersInput,
  workspaceStage2PromptConfig,
  workspaceStage2CaptionProviderConfig = DEFAULT_STAGE2_CAPTION_PROVIDER_CONFIG,
  workspaceAnthropicIntegration = null,
  workspaceOpenRouterIntegration = null,
  anthropicApiKeyInput = "",
  anthropicIntegrationActionState = { status: "idle", message: null },
  openRouterApiKeyInput = "",
  openRouterIntegrationActionState = { status: "idle", message: null },
  workspaceCodexModelConfig = DEFAULT_WORKSPACE_CODEX_MODEL_CONFIG,
  resolvedWorkspaceCodexModelConfig = {
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
  updateWorkspaceCaptionProvider = () => undefined,
  updateWorkspaceAnthropicModel = () => undefined,
  updateWorkspaceOpenRouterModel = () => undefined,
  updateAnthropicApiKeyInput = () => undefined,
  saveWorkspaceAnthropicIntegration = async () => undefined,
  disconnectWorkspaceAnthropicIntegration = async () => undefined,
  updateOpenRouterApiKeyInput = () => undefined,
  saveWorkspaceOpenRouterIntegration = async () => undefined,
  disconnectWorkspaceOpenRouterIntegration = async () => undefined,
  updateStage2HardConstraint,
  updateBannedWordsInput,
  updateBannedOpenersInput,
  updateStage2PromptTemplate,
  updateStage2PromptReasoning,
  resetStage2PromptStage,
  updateWorkspaceCodexModelSetting = () => undefined
}: ChannelManagerStage2TabProps) {
  const referenceOneShotStageConfig = workspaceStage2PromptConfig.stages.oneShotReference;
  const anthropicModelValue =
    workspaceStage2CaptionProviderConfig.anthropicModel ?? DEFAULT_ANTHROPIC_CAPTION_MODEL;
  const openRouterModelValue =
    workspaceStage2CaptionProviderConfig.openrouterModel ?? DEFAULT_OPENROUTER_CAPTION_MODEL;
  const anthropicIntegrationConnected = workspaceAnthropicIntegration?.status === "connected";
  const openRouterIntegrationConnected = workspaceOpenRouterIntegration?.status === "connected";

  if (isWorkspaceDefaultsSelection) {
    return (
      <div className="field-stack">
        <section className="control-card control-card-priority">
          <p className="field-label">Single baseline Stage 2</p>
          <p className="subtle-text">
            Рабочее пространство теперь использует один stable one-shot pipeline. Активные настройки здесь:
            hard constraints, caption provider, one-shot model и единый one-shot prompt.
          </p>
        </section>

        <section className="control-card control-card-subtle">
          <div className="stage2-insight-grid">
            <article className="stage2-insight-card">
              <span className="field-label">Pipeline</span>
              <strong>native_caption_v3</strong>
              <p className="subtle-text">oneShotReference → highlighting? → translation → SEO → assemble</p>
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
              <p className="subtle-text">маршрутизирует только `oneShotReference` и `regenerate`</p>
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
              Внешний provider влияет только на `oneShotReference` и `regenerate`. Translation, SEO и остальные downstream product stages остаются на Shared Codex.
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
                value={referenceOneShotStageConfig.reasoningEffort}
                disabled={!canEditWorkspaceDefaults}
                onChange={(event) =>
                  updateStage2PromptReasoning(
                    "oneShotReference",
                    event.target.value as typeof referenceOneShotStageConfig.reasoningEffort
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
                Базовый уровень рассуждений для единственного active one-shot caption baseline.
              </p>
            </div>
          </div>

          <div className="compact-field">
            <label className="field-label">One-shot prompt</label>
            <textarea
              className="text-area mono"
              rows={18}
              value={referenceOneShotStageConfig.prompt}
              disabled={!canEditWorkspaceDefaults}
              onChange={(event) =>
                updateStage2PromptTemplate("oneShotReference", event.target.value)
              }
            />
            <p className="subtle-text">
              Активный prompt contract: `video_truth_json`, bounded `comments_hint_json`, `hard_constraints_json`, `user_instruction`.
            </p>
            <div className="stage2-config-stage-actions">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!canEditWorkspaceDefaults}
                onClick={() => resetStage2PromptStage("oneShotReference")}
              >
                Сбросить к продуктовым настройкам
              </button>
            </div>
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
          На уровне канала теперь редактируются только hard constraints. Provider, model и one-shot prompt наследуются из workspace defaults.
        </p>
      </section>

      <section className="control-card control-card-subtle">
        <div className="stage2-insight-grid">
          <article className="stage2-insight-card">
            <span className="field-label">Pipeline</span>
            <strong>Workspace baseline</strong>
            <p className="subtle-text">канал всегда использует единый stable one-shot baseline рабочего пространства</p>
          </article>
          <article className="stage2-insight-card">
            <span className="field-label">Provider</span>
            <strong>{workspaceStage2CaptionProviderConfig.provider === "codex" ? "Shared Codex" : workspaceStage2CaptionProviderConfig.provider === "anthropic" ? "Anthropic" : "OpenRouter"}</strong>
            <p className="subtle-text">управляется владельцем в общих настройках</p>
          </article>
          <article className="stage2-insight-card">
            <span className="field-label">Prompt</span>
            <strong>One-shot workspace prompt</strong>
            <p className="subtle-text">канал не переопределяет prompt family, examples corpus или worker profile</p>
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

        <div className="channel-onboarding-note-card">
          <strong>Legacy context</strong>
          <p className="subtle-text">
            Старые worker profile, examples corpus, style discovery и editorial memory больше не редактируются из active Stage 2 surface. Historical runs остаются открываемыми как read-only context.
          </p>
        </div>

        <p className={`subtle-text ${autosaveState.stage2.status === "error" ? "danger-text" : ""}`}>
          {autosaveState.stage2.message ?? "Настройки Stage 2 канала сохраняются автоматически."}
        </p>
      </section>
    </div>
  );
}
