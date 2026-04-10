import type { TemplateContentFixture } from "./template-calibration-types";
import type { Stage3TemplateConfig } from "./stage3-template";

export type ManagedTemplateShadowLayer = {
  id: string;
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  opacity: number;
  color: string;
  inset: boolean;
};

export type ManagedTemplateVersionSnapshot = {
  name: string;
  description: string;
  layoutFamily: string;
  baseTemplateId: string;
  content: TemplateContentFixture;
  templateConfig: Stage3TemplateConfig;
  shadowLayers: ManagedTemplateShadowLayer[];
};

export type ManagedTemplateVersion = {
  id: string;
  createdAt: string;
  label: string;
  snapshot: ManagedTemplateVersionSnapshot;
};

export type ManagedTemplate = ManagedTemplateVersionSnapshot & {
  id: string;
  workspaceId: string;
  creatorUserId: string | null;
  creatorDisplayName: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  versions: ManagedTemplateVersion[];
};

export type ManagedTemplateSummary = Pick<
  ManagedTemplate,
  | "id"
  | "name"
  | "description"
  | "layoutFamily"
  | "baseTemplateId"
  | "workspaceId"
  | "creatorUserId"
  | "creatorDisplayName"
  | "createdAt"
  | "updatedAt"
> & {
  versionsCount: number;
};
