"use client";

import React, { ReactNode, useState } from "react";

type WorkspaceTab = "edit" | "preview";

type StepWorkspaceProps = {
  left: ReactNode;
  right?: ReactNode;
  leftFooter?: ReactNode;
  editLabel?: string;
  previewLabel?: string;
  previewViewportHeight?: boolean;
};

export function StepWorkspace({
  left,
  right,
  leftFooter,
  editLabel = "Редактирование",
  previewLabel = "Предпросмотр",
  previewViewportHeight = false
}: StepWorkspaceProps) {
  const [mobileTab, setMobileTab] = useState<WorkspaceTab>("edit");
  const hasPreview = Boolean(right);

  return (
    <section
      className={`step-workspace ${previewViewportHeight ? "preview-vh" : ""} ${
        hasPreview ? "" : "single-pane"
      }`}
      aria-label="Рабочая область шага"
    >
      {hasPreview ? (
        <div className="workspace-tabs" role="tablist" aria-label="Вкладки рабочей области">
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === "edit"}
            className={`workspace-tab ${mobileTab === "edit" ? "active" : ""}`}
            onClick={() => setMobileTab("edit")}
          >
            {editLabel}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === "preview"}
            className={`workspace-tab ${mobileTab === "preview" ? "active" : ""}`}
            onClick={() => setMobileTab("preview")}
          >
            {previewLabel}
          </button>
        </div>
      ) : null}

      <div className={`workspace-pane workspace-pane-edit ${mobileTab === "edit" ? "show-mobile" : "hide-mobile"}`}>
        <div className="workspace-pane-scroll">{left}</div>
        {leftFooter ? <footer className="workspace-pane-footer">{leftFooter}</footer> : null}
      </div>

      {hasPreview ? (
        <aside
          className={`workspace-pane workspace-pane-preview ${
            mobileTab === "preview" ? "show-mobile" : "hide-mobile"
          }`}
        >
          <div className="workspace-preview-sticky">{right}</div>
        </aside>
      ) : null}
    </section>
  );
}
