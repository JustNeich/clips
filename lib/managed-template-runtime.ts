import { createHash } from "node:crypto";
import type { Stage3TemplateConfig } from "./stage3-template";
import {
  STAGE3_TEMPLATE_ID,
  cloneStage3TemplateConfig,
  getTemplateById,
  getTemplateComputedForConfig
} from "./stage3-template";
import { getTemplateRegistryEntry } from "./stage3-template-registry";
import type { TemplateContentFixture } from "./template-calibration-types";
import type { ManagedTemplate, ManagedTemplateShadowLayer } from "./managed-template-types";
import { assertServerRuntime } from "./server-runtime-guard";
import type { Stage3SnapshotManagedTemplateState } from "../app/components/types";
import { createEmptyTemplateCaptionHighlights } from "./template-highlights";
import { isBuiltInStage3TemplateId } from "./stage3-snapshot-managed-template";
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

function buildBuiltInTemplateRevision(templateId: string, templateConfig: Stage3TemplateConfig): string {
  return createHash("sha1")
    .update(templateId)
    .update("\u0000")
    .update(JSON.stringify(templateConfig))
    .digest("hex");
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

function resolveBuiltInTemplateId(templateId: string | null | undefined): string | null {
  const candidate = templateId?.trim();
  if (!candidate) {
    return null;
  }
  const resolved = getTemplateRegistryEntry(candidate).variant.id;
  return resolved === candidate ? resolved : null;
}

function toResolvedBuiltInRuntime(templateId: string): ResolvedManagedTemplateRuntime {
  const entry = getTemplateRegistryEntry(templateId);
  const templateConfig = cloneStage3TemplateConfig(getTemplateById(templateId));
  const revision = buildBuiltInTemplateRevision(templateId, templateConfig);
  return {
    managedTemplateId: templateId,
    name: entry.variant.label,
    description: "",
    baseTemplateId: templateId,
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
    updatedAt: revision,
    createdAt: revision
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
  snapshotState?: Stage3SnapshotManagedTemplateState | null,
  options?: { workspaceId?: string | null }
): Promise<ResolvedManagedTemplateRuntime> {
  const candidate = typeof templateId === "string" ? templateId.trim() : "";
  if (snapshotState?.managedId === candidate && snapshotState.updatedAt) {
    return toResolvedRuntimeFromSnapshot(snapshotState);
  }
  const builtInTemplateId = resolveBuiltInTemplateId(candidate);
  if (builtInTemplateId) {
    return toResolvedBuiltInRuntime(builtInTemplateId);
  }
  return toResolvedRuntime(await resolveManagedTemplate(templateId, options));
}

export function resolveManagedTemplateRuntimeSync(
  templateId: string | null | undefined,
  snapshotState?: Stage3SnapshotManagedTemplateState | null,
  options?: { workspaceId?: string | null }
): ResolvedManagedTemplateRuntime {
  const candidate = typeof templateId === "string" ? templateId.trim() : "";
  if (snapshotState?.managedId === candidate && snapshotState.updatedAt) {
    return toResolvedRuntimeFromSnapshot(snapshotState);
  }
  const builtInTemplateId = resolveBuiltInTemplateId(candidate);
  if (builtInTemplateId) {
    return toResolvedBuiltInRuntime(builtInTemplateId);
  }
  return toResolvedRuntime(resolveManagedTemplateSync(templateId, options));
}

/**
 * Resolve a managed (workspace-scoped, non-built-in) template id into the
 * portable {@link Stage3SnapshotManagedTemplateState} embedded in a Stage 3
 * render snapshot at ENQUEUE time on the cloud.
 *
 * The Stage 3 render worker keeps its local workspaces / workspace_templates
 * tables intentionally empty. When a render snapshot already carries
 * managedTemplateState whose managedId matches renderPlan.templateId, the worker
 * resolves the template entirely from the snapshot
 * (resolveManagedTemplateRuntimeSync -> toResolvedRuntimeFromSnapshot) and never
 * touches the DB. When it is absent for a managed id, the worker falls to
 * resolveManagedTemplateSync -> ensureWorkspaceDefaultTemplate ->
 * INSERT INTO workspace_templates, which FK-fails against the empty workspaces
 * table ("FOREIGN KEY constraint failed" at render stage "template_snapshot").
 *
 * Built-in template ids resolve on the worker without any DB write, so this
 * helper returns null for them and the built-in path is left untouched. It also
 * returns null when the managed template cannot be resolved to the exact
 * requested id (so we never silently swap a managed id for a default).
 */
export async function resolveSnapshotManagedTemplateStateForEnqueue(
  templateId: string | null | undefined,
  options?: { workspaceId?: string | null }
): Promise<Stage3SnapshotManagedTemplateState | null> {
  const candidate = typeof templateId === "string" ? templateId.trim() : "";
  if (!candidate) {
    return null;
  }
  // Built-in / layout-family ids resolve on the worker with no DB write.
  if (isBuiltInStage3TemplateId(candidate)) {
    return null;
  }
  const resolved = await resolveManagedTemplate(candidate, options);
  // Only attach when the cloud actually resolved the *requested* managed id.
  // resolveManagedTemplate falls back to a workspace default when the id is
  // missing; attaching that would lie about which template renders, and the
  // worker would reject the mismatched snapshot anyway (managedId !== templateId).
  if (!resolved || resolved.id !== candidate) {
    return null;
  }
  return {
    managedId: candidate,
    baseTemplateId: resolved.baseTemplateId,
    templateConfig: cloneStage3TemplateConfig(resolved.templateConfig),
    updatedAt: resolved.updatedAt ?? new Date().toISOString()
  };
}

export function computeManagedTemplateTextFit(input: {
  templateId: string;
  topText: string;
  bottomText: string;
  topFontScale?: number;
  bottomFontScale?: number;
  templateConfigOverride?: Stage3TemplateConfig;
}) {
  return getTemplateComputedForConfig(
    input.topText,
    input.bottomText,
    {
      topFontScale: input.topFontScale,
      bottomFontScale: input.bottomFontScale
    },
    input.templateConfigOverride ?? resolveManagedTemplateRuntimeSync(input.templateId).templateConfig
  );
}
