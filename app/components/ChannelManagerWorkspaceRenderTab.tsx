"use client";

import React from "react";
import {
  Stage3ExecutionCapabilities,
  Stage3ExecutionTarget
} from "./types";

type ChannelManagerWorkspaceRenderTabProps = {
  canEditWorkspaceDefaults: boolean;
  configuredTarget: Stage3ExecutionTarget;
  resolvedTarget: Stage3ExecutionTarget;
  capabilities: Stage3ExecutionCapabilities;
  saveState: {
    status: "idle" | "saving" | "saved" | "error";
    message: string | null;
  };
  onChangeTarget: (target: Stage3ExecutionTarget) => void;
};

export function ChannelManagerWorkspaceRenderTab({
  canEditWorkspaceDefaults,
  configuredTarget,
  resolvedTarget,
  capabilities,
  saveState,
  onChangeTarget
}: ChannelManagerWorkspaceRenderTabProps) {
  const fallbackWarning =
    configuredTarget !== resolvedTarget
      ? configuredTarget === "host"
        ? "Хостинг сохранён как default, но сейчас выключен на deployment. Новые Stage 3 heavy jobs временно пойдут через локальный executor."
        : "Локальный executor сохранён как default, но сейчас недоступен на deployment. Новые Stage 3 heavy jobs временно пойдут через хостинг."
      : null;

  const resolvedDescription =
    resolvedTarget === "host"
      ? "Тяжёлые Stage 3 задачи будут выполняться на сервере. Пользовательский executor для этого режима не нужен."
      : "Тяжёлые Stage 3 задачи будут выполняться через локальный executor редактора по текущей local-worker схеме.";

  return (
    <div className="field-stack">
      <div className="control-card">
        <div className="control-section-head">
          <div>
            <h3>Stage 3 execution mode</h3>
            <p className="subtle-text">
              Этот workspace default определяет, где выполняются preview, render и другие тяжёлые Stage 3 задачи по умолчанию.
            </p>
          </div>
        </div>
        <label className="field-label">Режим выполнения</label>
        <select
          className="text-input"
          value={configuredTarget}
          disabled={!canEditWorkspaceDefaults || saveState.status === "saving"}
          onChange={(event) => onChangeTarget(event.target.value as Stage3ExecutionTarget)}
        >
          <option value="local" disabled={!capabilities.localAvailable}>
            {capabilities.localAvailable || configuredTarget === "local"
              ? "Локальный executor"
              : "Локальный executor (недоступен)"}
          </option>
          {capabilities.hostAvailable || configuredTarget === "host" ? (
            <option value="host" disabled={!capabilities.hostAvailable}>
              {capabilities.hostAvailable ? "Хостинг" : "Хостинг (недоступен)"}
            </option>
          ) : null}
        </select>
        <div className="editing-status-row">
          <span className="meta-pill">
            Выбрано: {configuredTarget === "host" ? "Хостинг" : "Локальный executor"}
          </span>
          <span className="meta-pill">
            Сейчас работает: {resolvedTarget === "host" ? "Хостинг" : "Локальный executor"}
          </span>
        </div>
        <p className={`subtle-text ${fallbackWarning ? "danger-text" : ""}`}>
          {fallbackWarning ?? resolvedDescription}
        </p>
        <p className={`subtle-text ${saveState.status === "error" ? "danger-text" : ""}`}>
          {saveState.message ??
            "Изменение применяется ко всем новым heavy Stage 3 задачам этого workspace."}
        </p>
      </div>
    </div>
  );
}
