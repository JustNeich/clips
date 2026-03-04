"use client";

import { ReactNode } from "react";

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
  return (
    <main className="flow-layout">
      <aside className="history-sidebar" aria-label="History list">
        <div className="history-sidebar-head">
          <div>
            <p className="history-kicker">History</p>
            <h2>Recent Items</h2>
          </div>
          <button type="button" className="btn btn-secondary" onClick={onCreateNew}>
            + New
          </button>
        </div>

        <div className="history-list-wrap">
          {historyItems.length === 0 ? (
            <p className="history-empty">No items yet. Add a link in Step 1.</p>
          ) : (
            <ul className="history-list">
              {historyItems.map((item) => {
                const active = item.id === activeHistoryId;
                return (
                  <li key={item.id} className={`history-item ${active ? "active" : ""}`}>
                    <button
                      type="button"
                      className="history-select"
                      onClick={() => onHistoryChange(item.id)}
                      aria-current={active ? "true" : undefined}
                    >
                      <span className="history-title">{item.title}</span>
                      <span className="history-subtitle">{item.subtitle}</span>
                    </button>
                    <button
                      type="button"
                      className="history-delete"
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
      </aside>

      <section className="flow-app">
        <header className="flow-header">
          <div className="brand-block">
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>

          <div className="header-controls">
            <span className={`status-badge ${codexConnected ? "connected" : "idle"}`}>
              Codex {codexConnected ? "Connected" : "Disconnected"}
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

        <nav className="flow-stepper" aria-label="Workflow steps">
          {steps.map((step) => {
            const active = step.id === currentStep;
            const done = step.id < currentStep;
            return (
              <button
                key={step.id}
                type="button"
                className={`step-pill ${active ? "active" : ""} ${done ? "done" : ""}`}
                onClick={() => onStepChange(step.id)}
                disabled={!step.enabled}
                aria-current={active ? "step" : undefined}
              >
                <span className="step-num">Step {step.id}</span>
                <span className="step-label">{step.label}</span>
              </button>
            );
          })}
        </nav>

        <section className="flow-main">{children}</section>

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
