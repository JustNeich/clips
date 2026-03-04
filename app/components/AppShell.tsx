"use client";

import { ReactNode, useMemo, useState } from "react";

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
  codexConnected: boolean;
  codexBusyConnect: boolean;
  codexBusyRefresh: boolean;
  onConnectCodex: () => void;
  onRefreshCodex: () => void;
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
  codexConnected,
  codexBusyConnect,
  codexBusyRefresh,
  onConnectCodex,
  onRefreshCodex,
  statusText,
  statusTone,
  children,
  details
}: AppShellProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");

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
              onMouseEnter={() => setHistoryOpen(true)}
              onMouseLeave={() => setHistoryOpen(false)}
            >
              <button
                type="button"
                className="history-trigger"
                aria-label="Open history"
                aria-expanded={historyOpen}
                onFocus={() => setHistoryOpen(true)}
                onClick={() => setHistoryOpen((prev) => !prev)}
              >
                <span aria-hidden="true">🕘</span>
                <span>History</span>
                <span className="history-count">{historyItems.length}</span>
              </button>

              {historyOpen ? (
                <div
                  className="history-popover"
                  onFocusCapture={() => setHistoryOpen(true)}
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      setHistoryOpen(false);
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
          </div>

          <div className="topbar-actions">
            <span className={`status-chip ${codexConnected ? "online" : "offline"}`}>
              {codexConnected ? "Codex connected" : "Codex disconnected"}
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onConnectCodex}
              aria-busy={codexBusyConnect}
              disabled={codexBusyConnect}
            >
              {codexBusyConnect ? "Connecting..." : "Connect"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onRefreshCodex}
              aria-busy={codexBusyRefresh}
              disabled={codexBusyRefresh}
            >
              {codexBusyRefresh ? "Refreshing..." : "Refresh"}
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
