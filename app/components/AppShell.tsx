"use client";

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  codexSecondaryActionLabel?: string | null;
  onConnectCodex: () => void;
  onRefreshCodex: () => void;
  onSecondaryCodexAction?: () => void;
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
  codexSecondaryActionLabel,
  onConnectCodex,
  onRefreshCodex,
  onSecondaryCodexAction,
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

  return (
    <main className="app-layout">
      <section className="app-main">
        <header className="app-topbar">
          <div className="topbar-left">
            <div
              className="history-flyout"
              onMouseEnter={openHistory}
              onMouseLeave={scheduleCloseHistory}
            >
              <button
                type="button"
                className="history-trigger"
                aria-label="Open history"
                aria-expanded={historyOpen}
                onFocus={openHistory}
                onClick={() => setHistoryOpen((prev) => !prev)}
              >
                <span aria-hidden="true">🕘</span>
                <span>History</span>
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
                    <h2>Recent</h2>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        onCreateNew();
                        setHistoryOpen(false);
                      }}
                    >
                      + New
                    </button>
                  </div>

                  <input
                    className="text-input"
                    value={historyQuery}
                    onChange={(event) => setHistoryQuery(event.target.value)}
                    placeholder="Search..."
                    aria-label="Search history"
                  />

                  <div className="history-popover-scroll">
                    {filteredHistory.length === 0 ? (
                      <p className="empty-box">No items found.</p>
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
                                aria-label={`Delete ${item.title}`}
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

            <div className="channel-switcher">
              <label className="field-label" htmlFor="channelSelect">
                Channel
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
                    Manage channels
                  </button>
                ) : null}
                {canManageTeam ? (
                  <button type="button" className="btn btn-ghost" onClick={onOpenTeam}>
                    Team
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="topbar-actions">
            <div className="topbar-identity">
              {workspaceName ? <span className="status-chip">{workspaceName}</span> : null}
              {currentUserName ? <span className="status-chip">{currentUserName}</span> : null}
              {currentUserRole ? <span className="status-chip">{currentUserRole}</span> : null}
            </div>
            <span className={`status-chip ${codexConnected ? "online" : "offline"}`}>
              {codexStatusLabel ?? (codexConnected ? "Shared Codex connected" : "Shared Codex unavailable")}
            </span>
            {canManageCodex ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onConnectCodex}
                aria-busy={codexBusyConnect}
                disabled={codexBusyConnect || !canConnectCodex}
                title={!canConnectCodex ? codexConnectBlockedReason ?? undefined : undefined}
              >
                {codexBusyConnect ? "Connecting..." : "Connect"}
              </button>
            ) : null}
            {canManageCodex && codexSecondaryActionLabel && onSecondaryCodexAction ? (
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
              {codexBusyRefresh ? "Refreshing..." : "Refresh"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onLogout}>
              Logout
            </button>
          </div>
        </header>

        <nav className="wizard-stepper" aria-label="Workflow steps">
          {steps.map((step) => {
            const stepState = getStepState(step.id, currentStep);
            const statusLabel =
              stepState === "completed" ? "Completed" : stepState === "current" ? "Current" : "Next";
            return (
              <button
                key={step.id}
                type="button"
                className={`wizard-step ${stepState}`}
                onClick={() => onStepChange(step.id)}
                disabled={!step.enabled}
                aria-current={stepState === "current" ? "step" : undefined}
              >
                <span className="wizard-step-num">Step {step.id}</span>
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
            {statusText}
          </p>
        ) : null}

        {details}
      </section>
    </main>
  );
}
