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
  stage2PromptStages: Stage2PromptStageMeta[];
  autosaveState: AutosaveState;
  canEditWorkspaceDefaults: boolean;
  canEditHardConstraints: boolean;
  canEditChannelExamples: boolean;
  activeExamplesPreview: ActiveExamplesPreview;
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
};

export function ChannelManagerStage2Tab({
  isWorkspaceDefaultsSelection,
  workspaceExamplesCount,
  workspaceExamplesJson,
  workspaceExamplesError,
  stage2HardConstraints,
  bannedWordsInput,
  bannedOpenersInput,
  workspaceStage2PromptConfig,
  stage2PromptStages,
  autosaveState,
  canEditWorkspaceDefaults,
  canEditHardConstraints,
  canEditChannelExamples,
  activeExamplesPreview,
  customExamplesJson,
  customExamplesError,
  updateWorkspaceExamplesJson,
  updateCustomExamplesJson,
  updateStage2HardConstraint,
  updateBannedWordsInput,
  updateBannedOpenersInput,
  updateStage2PromptTemplate,
  updateStage2PromptReasoning,
  resetStage2PromptStage
}: ChannelManagerStage2TabProps) {
  if (isWorkspaceDefaultsSelection) {
    return (
      <div className="field-stack">
        <section className="control-card control-card-priority">
          <p className="field-label">Default settings</p>
          <p className="subtle-text">
            Здесь владелец задаёт общий Stage 2 default для всего workspace: corpus,
            hard constraints и default prompt/thinking для каждого этапа.
          </p>
        </section>

        <section className="control-card control-card-subtle">
          <div className="stage2-insight-grid">
            <article className="stage2-insight-card">
              <span className="field-label">Workspace corpus</span>
              <strong>{workspaceExamplesCount}</strong>
              <p className="subtle-text">примеров попадут в default corpus workspace</p>
            </article>
            <article className="stage2-insight-card">
              <span className="field-label">TOP</span>
              <strong>
                {stage2HardConstraints.topLengthMin}-{stage2HardConstraints.topLengthMax}
              </strong>
              <p className="subtle-text">default hard constraints</p>
            </article>
            <article className="stage2-insight-card">
              <span className="field-label">BOTTOM</span>
              <strong>
                {stage2HardConstraints.bottomLengthMin}-{stage2HardConstraints.bottomLengthMax}
              </strong>
              <p className="subtle-text">default hard constraints</p>
            </article>
          </div>

          <div className="compact-field">
            <label className="field-label">Workspace default corpus JSON</label>
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
                Это общий default corpus workspace. Все каналы используют его, если не
                включён channel custom corpus.
              </p>
            )}
          </div>

          <div className="compact-field">
            <p className="field-label">Default hard constraints</p>
            <div className="compact-grid">
              <div className="compact-field">
                <label className="field-label">Top min</label>
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
                <label className="field-label">Top max</label>
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
                <label className="field-label">Bottom min</label>
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
                <label className="field-label">Bottom max</label>
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
            <label className="field-label">Banned words</label>
            <textarea
              className="text-area"
              rows={3}
              value={bannedWordsInput}
              disabled={!canEditHardConstraints}
              onChange={(event) => updateBannedWordsInput(event.target.value)}
            />
            <p className="subtle-text">Разделяйте слова запятыми, точкой с запятой или с новой строки.</p>
            <label className="field-label">Banned openers</label>
            <textarea
              className="text-area"
              rows={3}
              value={bannedOpenersInput}
              disabled={!canEditHardConstraints}
              onChange={(event) => updateBannedOpenersInput(event.target.value)}
            />
            <p className="subtle-text">Banned openers проверяются в начале TOP и сохраняются как отдельный список.</p>
          </div>

          <div className="stage2-config-stage-list">
            {stage2PromptStages.map((stage, index) => {
              const stageConfig = workspaceStage2PromptConfig.stages[stage.id];
              const isDefaultPrompt =
                stageConfig.prompt === STAGE2_DEFAULT_STAGE_PROMPTS[stage.id];
              const isDefaultReasoning =
                stageConfig.reasoningEffort === STAGE2_DEFAULT_REASONING_EFFORTS[stage.id];
              return (
                <article key={stage.id} className="stage2-config-stage-card">
                  <div className="stage2-config-stage-head">
                    <div className="stage2-config-stage-index">{index + 1}</div>
                    <div className="stage2-config-stage-copy">
                      <div className="quick-edit-label-row">
                        <label className="field-label">
                          {stage.shortLabel} <span className="badge">LLM stage</span>
                        </label>
                        {!isDefaultPrompt || !isDefaultReasoning ? (
                          <span className="badge">Custom</span>
                        ) : (
                          <span className="badge muted">Default</span>
                        )}
                      </div>
                      <p className="subtle-text">{stage.description}</p>
                    </div>
                  </div>
                  <div className="stage2-config-stage-body">
                    <label className="field-label">Default prompt</label>
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
                        <label className="field-label">Default thinking</label>
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
                      <div className="stage2-config-stage-actions">
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={!canEditWorkspaceDefaults}
                          onClick={() => resetStage2PromptStage(stage.id)}
                        >
                          Reset to product default
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <p
            className={`subtle-text ${autosaveState.stage2Defaults.status === "error" ? "danger-text" : ""}`}
          >
            {autosaveState.stage2Defaults.message ??
              "Workspace Stage 2 defaults сохраняются автоматически."}
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="field-stack">
      <section className="control-card control-card-priority">
        <p className="field-label">Channel Stage 2</p>
        <p className="subtle-text">
          Для конкретного канала здесь настраивается один examples corpus JSON.
          Дефолтный corpus задаётся владельцем отдельно через пункт Default settings.
        </p>
      </section>
      <section className="control-card control-card-subtle">
        <div className="control-section-head">
          <div>
            <h3>Examples corpus</h3>
            <p className="subtle-text">
              Поле изначально заполнено workspace default corpus. Его можно просто
              отредактировать или полностью заменить.
            </p>
          </div>
        </div>
        <div className="stage2-insight-grid">
          <article className="stage2-insight-card">
            <span className="field-label">Workspace default</span>
            <strong>{workspaceExamplesCount}</strong>
            <p className="subtle-text">примеров находится в общем corpus workspace</p>
          </article>
          <article className="stage2-insight-card">
            <span className="field-label">Current corpus</span>
            <strong>{activeExamplesPreview.corpus.length}</strong>
            <p className="subtle-text">столько examples сейчас увидят selector и writer</p>
          </article>
          <article className="stage2-insight-card">
            <span className="field-label">Hard constraints</span>
            <strong>
              TOP {stage2HardConstraints.topLengthMin}-{stage2HardConstraints.topLengthMax}
            </strong>
            <p className="subtle-text">
              BOTTOM {stage2HardConstraints.bottomLengthMin}-{stage2HardConstraints.bottomLengthMax}
            </p>
          </article>
        </div>

        <div className="compact-field">
          <label className="field-label">Examples corpus JSON</label>
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
              По умолчанию сюда подставляется corpus из Default settings. Если вы
              редактируете JSON, этот канал начинает использовать отредактированную
              версию.
            </p>
          )}
        </div>
      </section>

      <section className="control-card control-card-subtle">
        <p className="field-label">Hard constraints</p>
        <p className="subtle-text">
          Эти лимиты применяются только к этому каналу. Workspace prompt defaults по-прежнему задаются
          владельцем в Default settings.
        </p>
        <div className="compact-grid">
          <div className="compact-field">
            <label className="field-label">Top min</label>
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
            <label className="field-label">Top max</label>
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
            <label className="field-label">Bottom min</label>
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
            <label className="field-label">Bottom max</label>
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
        <label className="field-label">Banned words</label>
        <textarea
          className="text-area"
          rows={3}
          value={bannedWordsInput}
          disabled={!canEditHardConstraints}
          onChange={(event) => updateBannedWordsInput(event.target.value)}
        />
        <p className="subtle-text">Разделяйте слова запятыми, точкой с запятой или с новой строки.</p>
        <label className="field-label">Banned openers</label>
        <textarea
          className="text-area"
          rows={3}
          value={bannedOpenersInput}
          disabled={!canEditHardConstraints}
          onChange={(event) => updateBannedOpenersInput(event.target.value)}
        />
        <p className="subtle-text">Banned openers проверяются в начале TOP и сохраняются как отдельный список.</p>
        <p className={`subtle-text ${autosaveState.stage2.status === "error" ? "danger-text" : ""}`}>
          {autosaveState.stage2.message ??
            "На уровне канала автоматически сохраняются examples corpus JSON и все hard constraints."}
        </p>
        <p className="subtle-text">
          Prompt defaults задаются владельцем в пункте Default settings. Здесь на уровне канала редактируются
          длины TOP/BOTTOM и banned lists.
        </p>
      </section>
    </div>
  );
}
