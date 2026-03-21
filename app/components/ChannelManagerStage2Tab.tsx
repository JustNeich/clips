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
import { getSelectedStage2StyleDirections, Stage2StyleProfile } from "../../lib/stage2-channel-learning";
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
  channelStyleProfile?: Stage2StyleProfile | null;
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
  channelStyleProfile,
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
          <p className="field-label">Общие настройки</p>
          <p className="subtle-text">
            Здесь владелец задаёт общую базу Stage 2 для всего рабочего пространства:
            корпус примеров, ограничения и базовые промпты с уровнем рассуждений для каждого этапа.
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

          <p
            className={`subtle-text ${autosaveState.stage2Defaults.status === "error" ? "danger-text" : ""}`}
          >
            {autosaveState.stage2Defaults.message ??
              "Общие настройки Stage 2 сохраняются автоматически."}
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
          Для конкретного канала здесь настраивается свой JSON корпуса примеров.
          Базовый корпус задаётся владельцем отдельно через раздел общих настроек.
        </p>
      </section>
      {!isWorkspaceDefaultsSelection && channelStyleProfile ? (
        <section className="control-card control-card-subtle">
          <div className="control-section-head">
            <div>
              <h3>Стартовый стиль</h3>
              <p className="subtle-text">
                Стартовый стиль теперь формируется через пошаговый мастер: референсные ссылки
                сужают пространство вариантов, но финальный стартовый набор направлений
                выбирает редактор.
              </p>
            </div>
          </div>
          <div className="stage2-insight-grid">
            <article className="stage2-insight-card">
              <span className="field-label">Референсные ссылки</span>
              <strong>{channelStyleProfile.referenceLinks.length}</strong>
              <p className="subtle-text">ссылок было использовано для стартовой настройки</p>
            </article>
            <article className="stage2-insight-card">
              <span className="field-label">Предложенные направления</span>
              <strong>{channelStyleProfile.candidateDirections.length}</strong>
              <p className="subtle-text">кандидатных направлений было предложено</p>
            </article>
            <article className="stage2-insight-card">
              <span className="field-label">Доля исследования</span>
              <strong>{Math.round(channelStyleProfile.explorationShare * 100)}%</strong>
              <p className="subtle-text">резервируется под контролируемое разнообразие</p>
            </article>
          </div>
          {getSelectedStage2StyleDirections(channelStyleProfile).length > 0 ? (
            <div className="stage2-style-pill-list">
              {getSelectedStage2StyleDirections(channelStyleProfile).map((direction) => (
                <article key={direction.id} className="stage2-style-pill">
                  <strong>{direction.name}</strong>
                  <p className="subtle-text">{direction.description}</p>
                  <p className="subtle-text">
                    TOP: {direction.topPattern}
                    {" · "}
                    BOTTOM: {direction.bottomPattern}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <p className="subtle-text">
              Этот канал ещё не прошёл новый стартовый мастер или пока не выбраны стартовые
              направления.
            </p>
          )}
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
