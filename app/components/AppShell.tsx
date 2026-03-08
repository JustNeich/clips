"use client";

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sanitizeDisplayText } from "../../lib/ui-error";
import type { CodexDeviceAuth } from "./types";

export type FlowStep = {
  id: 1 | 2 | 3;
  label: string;
  enabled: boolean;
};

export type HistoryItem = {
  id: string;
  title: string;
  subtitle: string;
};

export type ChannelSelectorItem = {
  id: string;
  name: string;
  username: string;
};

type AppShellProps = {
  title: string;
  subtitle: string;
  steps: FlowStep[];
  currentStep: 1 | 2 | 3;
  onStepChange: (step: 1 | 2 | 3) => void;
  historyItems: HistoryItem[];
  activeHistoryId: string | null;
  onHistoryChange: (id: string) => void;
  onDeleteHistory: (id: string) => void;
  onCreateNew: () => void;
  channels: ChannelSelectorItem[];
  activeChannelId: string | null;
  onSelectChannel: (channelId: string) => void;
  onManageChannels: () => void;
  canManageChannels: boolean;
  canManageTeam: boolean;
  onOpenTeam: () => void;
  codexConnected: boolean;
  codexBusyConnect: boolean;
  codexBusyRefresh: boolean;
  canManageCodex: boolean;
  canConnectCodex: boolean;
  codexConnectBlockedReason?: string | null;
  codexStatusLabel?: string;
  codexActionLabel?: string;
  codexDeviceAuth?: CodexDeviceAuth | null;
  codexSecondaryActionLabel?: string | null;
  onConnectCodex: () => void;
  onRefreshCodex: () => void;
  onSecondaryCodexAction?: () => void;
  onCopyCodexLoginUrl?: () => void;
  onCopyCodexUserCode?: () => void;
  currentUserName: string | null;
  currentUserRole: string | null;
  workspaceName: string | null;
  onLogout: () => void;
  statusText: string;
  statusTone: "ok" | "error" | "";
  children: ReactNode;
  details: ReactNode;
};

function getStepState(stepId: number, currentStep: number): "completed" | "current" | "next" {
  if (stepId < currentStep) {
    return "completed";
  }
  if (stepId === currentStep) {
    return "current";
  }
  return "next";
}

function formatDeviceAuthStatus(status: CodexDeviceAuth["status"]): string {
  switch (status) {
    case "running":
      return "Ожидает входа";
    case "done":
      return "Вход завершен";
    case "error":
      return "Ошибка входа";
    case "canceled":
      return "Вход отменен";
    default:
      return "Нет активности";
  }
}

function formatRoleLabel(role: string | null): string | null {
  if (!role) {
    return null;
  }

  switch (role) {
    case "owner":
      return "Владелец";
    case "manager":
      return "Менеджер";
    case "redactor":
      return "Редактор";
    case "redactor_limited":
      return "Редактор (ограниченный доступ)";
    default:
      return role.replace(/_/g, " ");
  }
}

export function AppShell({
  title,
  subtitle,
  steps,
  currentStep,
  onStepChange,
  historyItems,
  activeHistoryId,
  onHistoryChange,
  onDeleteHistory,
  onCreateNew,
  channels,
  activeChannelId,
  onSelectChannel,
  onManageChannels,
  canManageChannels,
  canManageTeam,
  onOpenTeam,
  codexConnected,
  codexBusyConnect,
  codexBusyRefresh,
  canManageCodex,
  canConnectCodex,
  codexConnectBlockedReason,
  codexStatusLabel,
  codexActionLabel,
  codexDeviceAuth,
  codexSecondaryActionLabel,
  onConnectCodex,
  onRefreshCodex,
  onSecondaryCodexAction,
  onCopyCodexLoginUrl,
  onCopyCodexUserCode,
  currentUserName,
  currentUserRole,
  workspaceName,
  onLogout,
  statusText,
  statusTone,
  children,
  details
}: AppShellProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [codexPanelOpen, setCodexPanelOpen] = useState(false);
  const historyCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHistoryCloseTimer = useCallback(() => {
    if (historyCloseTimerRef.current) {
      clearTimeout(historyCloseTimerRef.current);
      historyCloseTimerRef.current = null;
    }
  }, []);

  const openHistory = useCallback(() => {
    clearHistoryCloseTimer();
    setHistoryOpen(true);
  }, [clearHistoryCloseTimer]);

  const scheduleCloseHistory = useCallback(() => {
    clearHistoryCloseTimer();
    historyCloseTimerRef.current = setTimeout(() => {
      setHistoryOpen(false);
      historyCloseTimerRef.current = null;
    }, 140);
  }, [clearHistoryCloseTimer]);

  useEffect(() => {
    return () => {
      clearHistoryCloseTimer();
    };
  }, [clearHistoryCloseTimer]);

  const filteredHistory = useMemo(() => {
    const query = historyQuery.trim().toLowerCase();
    if (!query) {
      return historyItems;
    }
    return historyItems.filter((item) => {
      const title = item.title.toLowerCase();
      const subtitle = item.subtitle.toLowerCase();
      return title.includes(query) || subtitle.includes(query);
    });
  }, [historyItems, historyQuery]);

  const hasCodexDeviceAuthDetails = Boolean(
    canManageCodex &&
      codexDeviceAuth &&
      (codexDeviceAuth.status !== "idle" ||
        Boolean(codexDeviceAuth.loginUrl) ||
        Boolean(codexDeviceAuth.userCode) ||
        Boolean(codexDeviceAuth.output.trim()))
  );
  const showDeviceAuthDetails = Boolean(
    canManageCodex &&
      codexDeviceAuth &&
      (!codexConnected ||
        codexDeviceAuth.status === "running" ||
        codexDeviceAuth.status === "error" ||
        codexDeviceAuth.status === "canceled") &&
      (Boolean(codexDeviceAuth.loginUrl) ||
        Boolean(codexDeviceAuth.userCode) ||
        Boolean(codexDeviceAuth.output.trim()))
  );
  const codexPanelStatus =
    codexConnected && (codexDeviceAuth?.status ?? "idle") === "idle"
      ? "Подключен"
      : formatDeviceAuthStatus(codexDeviceAuth?.status ?? "idle");
  const showCodexDetailsToggle = Boolean(!codexConnected && hasCodexDeviceAuthDetails);
  const showCodexPanel = Boolean(
    canManageCodex && (showDeviceAuthDetails || (codexPanelOpen && !codexConnected))
  );

  useEffect(() => {
    if (
      hasCodexDeviceAuthDetails &&
      (codexDeviceAuth?.status === "running" ||
        codexDeviceAuth?.status === "error" ||
        codexDeviceAuth?.status === "canceled")
    ) {
      setCodexPanelOpen(true);
    }
  }, [codexDeviceAuth?.status, hasCodexDeviceAuthDetails]);

  useEffect(() => {
    if (codexConnected && (codexDeviceAuth?.status ?? "idle") === "idle") {
      setCodexPanelOpen(false);
    }
  }, [codexConnected, codexDeviceAuth?.status]);

  return (
    <main className="app-layout">
      <section className="app-main">
        <header className="app-topbar">
          <div className="topbar-primary">
            <div className="topbar-brand-row">
              <div
                className="history-flyout"
                onMouseEnter={openHistory}
                onMouseLeave={scheduleCloseHistory}
              >
                <button
                  type="button"
                  className="history-trigger"
                  aria-label="Открыть историю"
                  aria-expanded={historyOpen}
                  onFocus={openHistory}
                  onClick={() => setHistoryOpen((prev) => !prev)}
                >
                  <span aria-hidden="true">🕘</span>
                  <span>История</span>
                  <span className="history-count">{historyItems.length}</span>
                </button>

                {historyOpen ? (
                  <div
                    className="history-popover"
                    onMouseEnter={openHistory}
                    onMouseLeave={scheduleCloseHistory}
                    onFocusCapture={openHistory}
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        scheduleCloseHistory();
                      }
                    }}
                  >
                    <div className="history-popover-head">
                      <h2>Недавнее</h2>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => {
                          onCreateNew();
                          setHistoryOpen(false);
                        }}
                      >
                        + Новый
                      </button>
                    </div>

                    <input
                      className="text-input"
                      value={historyQuery}
                      onChange={(event) => setHistoryQuery(event.target.value)}
                      placeholder="Поиск..."
                      aria-label="Поиск по истории"
                    />

                    <div className="history-popover-scroll">
                      {filteredHistory.length === 0 ? (
                        <p className="empty-box">Ничего не найдено.</p>
                      ) : (
                        <ul className="history-list">
                          {filteredHistory.map((item) => {
                            const active = item.id === activeHistoryId;
                            return (
                              <li key={item.id} className={`history-row ${active ? "active" : ""}`}>
                                <button
                                  type="button"
                                  className="history-open"
                                  onClick={() => {
                                    onHistoryChange(item.id);
                                    setHistoryOpen(false);
                                  }}
                                  aria-current={active ? "true" : undefined}
                                >
                                  <span className="history-title">{item.title}</span>
                                  <span className="history-subtitle">{item.subtitle}</span>
                                </button>
                                <button
                                  type="button"
                                  className="history-remove"
                                  aria-label={`Удалить ${item.title}`}
                                  onClick={() => onDeleteHistory(item.id)}
                                >
                                  ✕
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="topbar-brand">
                <h1>{title}</h1>
                <p>{subtitle}</p>
              </div>
            </div>

            <div className="channel-switcher">
              <label className="field-label" htmlFor="channelSelect">
                Канал
              </label>
              <div className="channel-switcher-row">
                <select
                  id="channelSelect"
                  className="text-input"
                  value={activeChannelId ?? ""}
                  onChange={(event) => onSelectChannel(event.target.value)}
                >
                  {channels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channel.name} @{channel.username}
                    </option>
                  ))}
                </select>
                {canManageChannels ? (
                  <button type="button" className="btn btn-secondary" onClick={onManageChannels}>
                    Каналы
                  </button>
                ) : null}
                {canManageTeam ? (
                  <button type="button" className="btn btn-ghost" onClick={onOpenTeam}>
                    Команда
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <aside className="topbar-utility">
            <section className="workspace-card">
              <div className="workspace-card-copy">
                <span className="workspace-kicker">{workspaceName ?? "Рабочее пространство"}</span>
                <div className="workspace-card-title-row">
                  <strong>{currentUserName ?? "Пользователь рабочего пространства"}</strong>
                  {currentUserRole ? <span className="workspace-role">{formatRoleLabel(currentUserRole)}</span> : null}
                  <span className={`status-chip ${codexConnected ? "online" : "offline"}`}>
                    {codexStatusLabel ?? (codexConnected ? "Shared Codex подключен" : "Shared Codex недоступен")}
                  </span>
                </div>
              </div>

              <div className="workspace-card-actions">
                {canManageCodex ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={onConnectCodex}
                      aria-busy={codexBusyConnect}
                      disabled={codexBusyConnect || !canConnectCodex}
                      title={!canConnectCodex ? codexConnectBlockedReason ?? undefined : undefined}
                    >
                      {codexBusyConnect ? "Подключение..." : codexActionLabel ?? "Подключить"}
                    </button>
                    {codexSecondaryActionLabel && onSecondaryCodexAction ? (
                      <button type="button" className="btn btn-ghost" onClick={onSecondaryCodexAction}>
                        {codexSecondaryActionLabel}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={onRefreshCodex}
                      aria-busy={codexBusyRefresh}
                      disabled={codexBusyRefresh}
                    >
                      {codexBusyRefresh ? "Обновление..." : "Обновить"}
                    </button>
                    {showCodexDetailsToggle && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setCodexPanelOpen((prev) => !prev)}
                      >
                        {codexPanelOpen ? "Скрыть детали" : "Показать детали"}
                      </button>
                    )}
                  </>
                ) : null}
                <button type="button" className="btn btn-ghost" onClick={onLogout}>
                  Выйти
                </button>
              </div>
            </section>

            {showCodexPanel ? (
              <section className="codex-control-panel">
                <div className="codex-device-head">
                  <div>
                    <strong>Вход в Shared Codex</strong>
                    <p className="subtle-text">
                      Подключите один раз, завершите вход в браузере и затем обновите статус.
                    </p>
                  </div>
                  <span className={`status-chip ${codexConnected ? "online" : "offline"}`}>{codexPanelStatus}</span>
                </div>

                {!canConnectCodex && codexConnectBlockedReason ? (
                  <p className="subtle-text danger-text">{codexConnectBlockedReason}</p>
                ) : null}

                {showDeviceAuthDetails && codexDeviceAuth?.loginUrl ? (
                  <div className="codex-device-row">
                    <span className="field-label">Ссылка для входа</span>
                    <div className="codex-device-actions">
                      <a
                        className="btn btn-secondary codex-device-link"
                        href={codexDeviceAuth.loginUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Открыть страницу входа
                      </a>
                      {onCopyCodexLoginUrl ? (
                        <button type="button" className="btn btn-ghost" onClick={onCopyCodexLoginUrl}>
                          Копировать ссылку
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {showDeviceAuthDetails && codexDeviceAuth?.userCode ? (
                  <div className="codex-device-row">
                    <span className="field-label">Код устройства</span>
                    <div className="codex-device-actions">
                      <code className="codex-device-code">{codexDeviceAuth.userCode}</code>
                      {onCopyCodexUserCode ? (
                        <button type="button" className="btn btn-ghost" onClick={onCopyCodexUserCode}>
                          Копировать код
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {showDeviceAuthDetails && codexDeviceAuth?.output.trim() ? (
                  <details className="codex-device-log">
                    <summary>Вывод CLI</summary>
                    <pre>{codexDeviceAuth.output}</pre>
                  </details>
                ) : null}
              </section>
            ) : null}
          </aside>
        </header>

        <nav className="wizard-stepper" aria-label="Шаги процесса">
          {steps.map((step) => {
            const stepState = getStepState(step.id, currentStep);
            const statusLabel =
              stepState === "completed" ? "Завершено" : stepState === "current" ? "Текущий" : "Далее";
            return (
              <button
                key={step.id}
                type="button"
                className={`wizard-step ${stepState}`}
                onClick={() => onStepChange(step.id)}
                disabled={!step.enabled}
                aria-current={stepState === "current" ? "step" : undefined}
              >
                <span className="wizard-step-num">Шаг {step.id}</span>
                <span className="wizard-step-label">{step.label}</span>
                <span className="wizard-step-state">{statusLabel}</span>
              </button>
            );
          })}
        </nav>

        <section className="shell-content">{children}</section>

        {statusText ? (
          <p
            className={`status-line ${statusTone === "error" ? "error" : "ok"}`}
            role="status"
            aria-live={statusTone === "error" ? "assertive" : "polite"}
          >
            {sanitizeDisplayText(statusText)}
          </p>
        ) : null}

        {details}
      </section>
    </main>
  );
}
