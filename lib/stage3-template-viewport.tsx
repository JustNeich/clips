import React, { CSSProperties } from "react";
import {
  STAGE3_TEMPLATE_ID,
  getTemplateById
} from "./stage3-template";
import { getTemplateFigmaSpec } from "./stage3-template-spec";
import { resolveTemplatePreviewFrameMode } from "./stage3-template-registry";

export type TemplatePreviewViewportMetrics = {
  mode: "full-frame" | "template-shell";
  width: number;
  height: number;
  borderRadius: number;
  offsetX: number;
  offsetY: number;
  background?: string;
  border?: string;
};

export function getTemplatePreviewViewportMetrics(
  templateId: string | null | undefined,
  modeOverride?: "full-frame" | "template-shell"
): TemplatePreviewViewportMetrics {
  const resolvedTemplateId = templateId?.trim() || STAGE3_TEMPLATE_ID;
  const templateConfig = getTemplateById(resolvedTemplateId);
  const templateSpec = getTemplateFigmaSpec(resolvedTemplateId);
  const mode = modeOverride ?? resolveTemplatePreviewFrameMode(resolvedTemplateId);

  if (mode === "template-shell") {
    return {
      mode,
      width: templateSpec.shell.width,
      height: templateSpec.shell.height,
      borderRadius: templateSpec.shell.radius,
      offsetX: templateSpec.shell.x,
      offsetY: templateSpec.shell.y,
      background: templateSpec.shell.background,
      border: templateSpec.shell.border
    };
  }

  return {
    mode,
    width: templateConfig.frame.width,
    height: templateConfig.frame.height,
    borderRadius: 28,
    offsetX: 0,
    offsetY: 0
  };
}

export type Stage3TemplateViewportProps = {
  templateId: string | null | undefined;
  modeOverride?: "full-frame" | "template-shell";
  className?: string;
  style?: CSSProperties;
  sceneStyle?: CSSProperties;
  sceneRef?: React.Ref<HTMLDivElement>;
  children: React.ReactNode;
};

export function Stage3TemplateViewport({
  templateId,
  modeOverride,
  className,
  style,
  sceneStyle,
  sceneRef,
  children
}: Stage3TemplateViewportProps): React.JSX.Element {
  const resolvedTemplateId = templateId?.trim() || STAGE3_TEMPLATE_ID;
  const templateConfig = getTemplateById(resolvedTemplateId);
  const viewport = getTemplatePreviewViewportMetrics(resolvedTemplateId, modeOverride);

  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: viewport.width,
        height: viewport.height,
        overflow: "hidden",
        borderRadius: viewport.borderRadius,
        background: viewport.background,
        border: viewport.border,
        boxSizing: "border-box",
        ...style
      }}
    >
      <div
        ref={sceneRef}
        style={{
          position: "absolute",
          left: -viewport.offsetX,
          top: -viewport.offsetY,
          width: templateConfig.frame.width,
          height: templateConfig.frame.height,
          ...sceneStyle
        }}
      >
        {children}
      </div>
    </div>
  );
}
