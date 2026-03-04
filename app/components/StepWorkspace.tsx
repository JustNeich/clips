"use client";

import { ReactNode, useState } from "react";

type WorkspaceTab = "edit" | "preview";

type StepWorkspaceProps = {
  left: ReactNode;
  right: ReactNode;
  leftFooter?: ReactNode;
  editLabel?: string;
  previewLabel?: string;
  previewViewportHeight?: boolean;
};

export function StepWorkspace({
  left,
  right,
  leftFooter,
  editLabel = "Edit",
  previewLabel = "Preview",
  previewViewportHeight = false
}: StepWorkspaceProps) {
  const [mobileTab, setMobileTab] = useState<WorkspaceTab>("edit");

  return (
    <section className={`step-workspace ${previewViewportHeight ? "preview-vh" : ""}`} aria-label="Step workspace">
      <div className="workspace-tabs" role="tablist" aria-label="Workspace tabs">
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

      <div className={`workspace-pane workspace-pane-edit ${mobileTab === "edit" ? "show-mobile" : "hide-mobile"}`}>
        <div className="workspace-pane-scroll">{left}</div>
        {leftFooter ? <footer className="workspace-pane-footer">{leftFooter}</footer> : null}
      </div>

      <aside
        className={`workspace-pane workspace-pane-preview ${mobileTab === "preview" ? "show-mobile" : "hide-mobile"}`}
      >
        <div className="workspace-preview-sticky">{right}</div>
      </aside>
    </section>
  );
}
