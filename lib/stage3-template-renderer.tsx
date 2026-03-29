import React from "react";
import { AutoFitTemplateScene } from "./auto-fit-template-scene";
import { type TemplateSceneProps } from "./template-scene";
import type {
  TemplateLayoutInput,
  TemplateLayoutOutput,
  TemplateRenderSnapshot
} from "./stage3-template-core";
import type { Stage3TemplateConfig } from "./stage3-template";

export type { TemplateLayoutInput, TemplateLayoutOutput };
export type { TemplateRenderSnapshot };

export type TemplateRuntimeBridge = Pick<
  TemplateSceneProps,
  | "backgroundNode"
  | "mediaNode"
  | "avatarNode"
  | "verificationBadgeNode"
  | "overlayNode"
  | "showGuides"
  | "showSafeArea"
  | "compareScope"
  | "className"
  | "style"
  | "sceneDataId"
>;

export type TemplateRendererProps = {
  templateId: TemplateSceneProps["templateId"];
  content: TemplateSceneProps["content"];
  snapshot?: TemplateRenderSnapshot;
  templateConfigOverride?: Stage3TemplateConfig;
  onComputedChange?: TemplateSceneProps["onComputedChange"];
  runtime?: TemplateRuntimeBridge;
};

export function Stage3TemplateRenderer({
  templateId,
  content,
  snapshot,
  templateConfigOverride,
  onComputedChange,
  runtime
}: TemplateRendererProps): React.JSX.Element {
  return (
    <AutoFitTemplateScene
      templateId={templateId}
      content={content}
      snapshot={snapshot}
      templateConfigOverride={templateConfigOverride}
      onComputedChange={onComputedChange}
      backgroundNode={runtime?.backgroundNode}
      mediaNode={runtime?.mediaNode}
      avatarNode={runtime?.avatarNode}
      verificationBadgeNode={runtime?.verificationBadgeNode}
      overlayNode={runtime?.overlayNode}
      showGuides={runtime?.showGuides}
      showSafeArea={runtime?.showSafeArea}
      compareScope={runtime?.compareScope}
      className={runtime?.className}
      style={runtime?.style}
      sceneDataId={runtime?.sceneDataId}
    />
  );
}
