import type { Stage3TemplateConfig } from "./stage3-template";
import {
  STAGE3_TEMPLATE_ID,
  cloneStage3TemplateConfig,
  getTemplateById,
  getScienceCardComputed
} from "./stage3-template";
import type { TemplateContentFixture } from "./template-calibration-types";
import type { ManagedTemplate, ManagedTemplateShadowLayer } from "./managed-template-types";
import { assertServerRuntime } from "./server-runtime-guard";
import type { Stage3SnapshotManagedTemplateState } from "../app/components/types";
import { createEmptyTemplateCaptionHighlights } from "./template-highlights";
import {
  resolveManagedTemplate,
  resolveManagedTemplateSync
} from "./managed-template-store";

assertServerRuntime("managed-template-runtime");

export type ResolvedManagedTemplateRuntime = {
  managedTemplateId: string;
  name: string;
  description: string;
  baseTemplateId: string;
  content: TemplateContentFixture;
  templateConfig: Stage3TemplateConfig;
  shadowLayers: ManagedTemplateShadowLayer[];
  versions: ManagedTemplate["versions"];
  updatedAt: string;
  createdAt: string;
};

function serializeShadowLayer(layer: ManagedTemplateShadowLayer): string {
  const rgba = toRgba(layer.color, layer.opacity);
  const shadow = `${Math.round(layer.offsetX)}px ${Math.round(layer.offsetY)}px ${Math.round(
    Math.max(0, layer.blur)
  )}px ${Math.round(layer.spread)}px ${rgba}`;
  return layer.inset ? `inset ${shadow}` : shadow;
}

function serializeShadowLayers(shadowLayers: ManagedTemplateShadowLayer[]): string | undefined {
  if (shadowLayers.length === 0) {
    return undefined;
  }
  return shadowLayers.map(serializeShadowLayer).join(", ");
}

function toRgba(color: string, opacity: number): string {
  const normalized = color.trim().replace(/^#/, "");
  const hex =
    normalized.length === 3
      ? normalized
          .split("")
          .map((part) => `${part}${part}`)
          .join("")
      : normalized.slice(0, 6);
  const safeHex = /^[0-9a-fA-F]{6}$/.test(hex) ? hex : "000000";
  const red = Number.parseInt(safeHex.slice(0, 2), 16);
  const green = Number.parseInt(safeHex.slice(2, 4), 16);
  const blue = Number.parseInt(safeHex.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(1, opacity)).toFixed(3)})`;
}

function toResolvedRuntime(template: ManagedTemplate | null): ResolvedManagedTemplateRuntime {
  const fallbackConfig = cloneStage3TemplateConfig(getTemplateById(STAGE3_TEMPLATE_ID));
  const shadowCss = template ? serializeShadowLayers(template.shadowLayers) : undefined;
  const baseTemplateConfig = template
    ? cloneStage3TemplateConfig(template.templateConfig)
    : fallbackConfig;

  return {
    managedTemplateId: template?.id ?? STAGE3_TEMPLATE_ID,
    name: template?.name ?? "Шаблон по умолчанию",
    description: template?.description ?? "",
    baseTemplateId: template?.baseTemplateId ?? STAGE3_TEMPLATE_ID,
    content: template?.content ?? {
      topText: "",
      bottomText: "",
      channelName: fallbackConfig.author.name,
      channelHandle: fallbackConfig.author.handle,
      highlights: createEmptyTemplateCaptionHighlights(),
      topHighlightPhrases: [],
      topFontScale: 1,
      bottomFontScale: 1,
      previewScale: 0.34,
      mediaAsset: null,
      backgroundAsset: null,
      avatarAsset: null
    },
    templateConfig: {
      ...baseTemplateConfig,
      card: {
        ...baseTemplateConfig.card,
        shadow: shadowCss ?? baseTemplateConfig.card.shadow
      }
    },
    shadowLayers: template?.shadowLayers ?? [],
    versions: template?.versions ?? [],
    updatedAt: template?.updatedAt ?? new Date().toISOString(),
    createdAt: template?.createdAt ?? new Date().toISOString()
  };
}

function toResolvedRuntimeFromSnapshot(
  snapshotState: Stage3SnapshotManagedTemplateState
): ResolvedManagedTemplateRuntime {
  const templateConfig = cloneStage3TemplateConfig(snapshotState.templateConfig);
  const updatedAt = snapshotState.updatedAt ?? new Date().toISOString();
  return {
    managedTemplateId: snapshotState.managedId,
    name: snapshotState.managedId,
    description: "",
    baseTemplateId: snapshotState.baseTemplateId,
    content: {
      topText: "",
      bottomText: "",
      channelName: templateConfig.author.name,
      channelHandle: templateConfig.author.handle,
      highlights: createEmptyTemplateCaptionHighlights(),
      topHighlightPhrases: [],
      topFontScale: 1,
      bottomFontScale: 1,
      previewScale: 0.34,
      mediaAsset: null,
      backgroundAsset: null,
      avatarAsset: null
    },
    templateConfig,
    shadowLayers: [],
    versions: [],
    updatedAt,
    createdAt: updatedAt
  };
}

export async function resolveManagedTemplateRuntime(
  templateId: string | null | undefined,
  snapshotState?: Stage3SnapshotManagedTemplateState | null
): Promise<ResolvedManagedTemplateRuntime> {
  const candidate = typeof templateId === "string" ? templateId.trim() : "";
  if (snapshotState?.managedId === candidate && snapshotState.updatedAt) {
    return toResolvedRuntimeFromSnapshot(snapshotState);
  }
  return toResolvedRuntime(await resolveManagedTemplate(templateId));
}

export function resolveManagedTemplateRuntimeSync(
  templateId: string | null | undefined,
  snapshotState?: Stage3SnapshotManagedTemplateState | null
): ResolvedManagedTemplateRuntime {
  const candidate = typeof templateId === "string" ? templateId.trim() : "";
  if (snapshotState?.managedId === candidate && snapshotState.updatedAt) {
    return toResolvedRuntimeFromSnapshot(snapshotState);
  }
  return toResolvedRuntime(resolveManagedTemplateSync(templateId));
}

export function computeManagedTemplateTextFit(input: {
  templateId: string;
  topText: string;
  bottomText: string;
  topFontScale?: number;
  bottomFontScale?: number;
  templateConfigOverride?: Stage3TemplateConfig;
}) {
  return getScienceCardComputed(
    input.topText,
    input.bottomText,
    {
      topFontScale: input.topFontScale,
      bottomFontScale: input.bottomFontScale
    },
    input.templateConfigOverride ?? resolveManagedTemplateRuntimeSync(input.templateId).templateConfig
  );
}
