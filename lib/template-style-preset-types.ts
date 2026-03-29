import type { TemplateContentFixture } from "./template-calibration-types";
import type { Stage3TemplateConfig } from "./stage3-template";

export type TemplateStyleBoxShadowLayer = {
  id: string;
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  opacity: number;
  color: string;
  inset: boolean;
};

export type TemplateStylePreset = {
  id: string;
  name: string;
  description: string;
  templateId: string;
  content: TemplateContentFixture;
  templateConfig: Stage3TemplateConfig;
  shadowLayers: TemplateStyleBoxShadowLayer[];
  createdAt: string;
  updatedAt: string;
};
