import React from "react";
import { TemplateBackdrop } from "./template-scene";
import {
  resolveTemplateAvatarBorderColor,
  resolveTemplateBuiltInBackdropAssetPath,
  resolveTemplateOverlayTint
} from "./stage3-template-registry";

export function resolveTemplateBackdropNode(
  templateId: string,
  assetUrl?: string | null
): React.JSX.Element {
  return <TemplateBackdrop templateId={templateId} assetUrl={assetUrl ?? undefined} />;
}

export function resolveTemplateBuiltInBackdropNode(templateId: string): React.JSX.Element | null {
  const assetPath = resolveTemplateBuiltInBackdropAssetPath(templateId);
  return resolveTemplateBackdropNode(templateId, assetPath);
}

export function resolveTemplateOverlayNode(templateId: string): React.JSX.Element | undefined {
  const overlayTint = resolveTemplateOverlayTint(templateId);
  if (!overlayTint) {
    return undefined;
  }
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: overlayTint,
        pointerEvents: "none"
      }}
    />
  );
}

export function resolveTemplateAvatarBorderColorNode(templateId: string): string {
  return resolveTemplateAvatarBorderColor(templateId);
}

