import {
  AMERICAN_NEWS_TEMPLATE_ID,
  CHANNEL_STORY_TEMPLATE_ID,
  SCIENCE_CARD_TEMPLATE_ID,
  SCIENCE_CARD_BLUE_TEMPLATE_ID,
  SCIENCE_CARD_RED_TEMPLATE_ID,
  SCIENCE_CARD_GREEN_TEMPLATE_ID,
  SCIENCE_CARD_V7_TEMPLATE_ID,
  HEDGES_OF_HONOR_TEMPLATE_ID,
  STAGE3_TEMPLATE_ID,
  getTemplateById,
  templateUsesBuiltInBackdrop
} from "./stage3-template";
import {
  resolveTemplateFormatGroupLabel,
  type Stage3TemplateFormatGroup
} from "./stage3-template-semantics";

export type TemplateRuntimeConfig = {
  usesBuiltInBackdrop: boolean;
  builtInBackdropAssetPath?: string;
  overlayTint?: string;
  avatarBorderColor: string;
  previewFrameMode?: "full-frame" | "template-shell";
};

export type TemplateVariant = {
  id: string;
  label: string;
  formatGroup: Stage3TemplateFormatGroup;
  formatLabel: string;
  runtime: TemplateRuntimeConfig;
};

export type TemplateRegistryEntry = {
  variant: TemplateVariant;
  getConfig: () => ReturnType<typeof getTemplateById>;
};

const TEMPLATE_VARIANTS: TemplateVariant[] = [
  {
    id: SCIENCE_CARD_TEMPLATE_ID,
    label: "Science Card V1",
    formatGroup: "classic_top_bottom",
    formatLabel: resolveTemplateFormatGroupLabel("classic_top_bottom"),
    runtime: {
      usesBuiltInBackdrop: templateUsesBuiltInBackdrop(SCIENCE_CARD_TEMPLATE_ID),
      avatarBorderColor: "rgba(7, 13, 23, 0.25)",
      previewFrameMode: "full-frame"
    }
  },
  {
    id: AMERICAN_NEWS_TEMPLATE_ID,
    label: "American News",
    formatGroup: "classic_top_bottom",
    formatLabel: resolveTemplateFormatGroupLabel("classic_top_bottom"),
    runtime: {
      usesBuiltInBackdrop: templateUsesBuiltInBackdrop(AMERICAN_NEWS_TEMPLATE_ID),
      avatarBorderColor: "rgba(255,255,255,0)",
      previewFrameMode: "full-frame"
    }
  },
  {
    id: SCIENCE_CARD_BLUE_TEMPLATE_ID,
    label: "Science Card Blue",
    formatGroup: "classic_top_bottom",
    formatLabel: resolveTemplateFormatGroupLabel("classic_top_bottom"),
    runtime: {
      usesBuiltInBackdrop: templateUsesBuiltInBackdrop(SCIENCE_CARD_BLUE_TEMPLATE_ID),
      avatarBorderColor: "rgba(7, 13, 23, 0.25)",
      previewFrameMode: "full-frame"
    }
  },
  {
    id: SCIENCE_CARD_RED_TEMPLATE_ID,
    label: "Science Card Red",
    formatGroup: "classic_top_bottom",
    formatLabel: resolveTemplateFormatGroupLabel("classic_top_bottom"),
    runtime: {
      usesBuiltInBackdrop: templateUsesBuiltInBackdrop(SCIENCE_CARD_RED_TEMPLATE_ID),
      avatarBorderColor: "rgba(7, 13, 23, 0.25)",
      previewFrameMode: "full-frame"
    }
  },
  {
    id: SCIENCE_CARD_GREEN_TEMPLATE_ID,
    label: "Science Card Green",
    formatGroup: "classic_top_bottom",
    formatLabel: resolveTemplateFormatGroupLabel("classic_top_bottom"),
    runtime: {
      usesBuiltInBackdrop: templateUsesBuiltInBackdrop(SCIENCE_CARD_GREEN_TEMPLATE_ID),
      avatarBorderColor: "rgba(7, 13, 23, 0.25)",
      previewFrameMode: "full-frame"
    }
  },
  {
    id: SCIENCE_CARD_V7_TEMPLATE_ID,
    label: "Science Card Skyframe",
    formatGroup: "classic_top_bottom",
    formatLabel: resolveTemplateFormatGroupLabel("classic_top_bottom"),
    runtime: {
      usesBuiltInBackdrop: templateUsesBuiltInBackdrop(SCIENCE_CARD_V7_TEMPLATE_ID),
      builtInBackdropAssetPath: "/stage3-template-backdrops/science-card-v7-shell.svg",
      avatarBorderColor: "rgba(255,255,255,0)",
      previewFrameMode: "template-shell"
    }
  },
  {
    id: HEDGES_OF_HONOR_TEMPLATE_ID,
    label: "Hedges of Honor",
    formatGroup: "classic_top_bottom",
    formatLabel: resolveTemplateFormatGroupLabel("classic_top_bottom"),
    runtime: {
      usesBuiltInBackdrop: templateUsesBuiltInBackdrop(HEDGES_OF_HONOR_TEMPLATE_ID),
      builtInBackdropAssetPath: "/stage3-template-backdrops/hedges-of-honor-v1-shell.svg",
      avatarBorderColor: "rgba(0, 0, 0, 0.2)",
      previewFrameMode: "full-frame"
    }
  },
  {
    id: CHANNEL_STORY_TEMPLATE_ID,
    label: "Channel + Story",
    formatGroup: "channel_story",
    formatLabel: resolveTemplateFormatGroupLabel("channel_story"),
    runtime: {
      usesBuiltInBackdrop: templateUsesBuiltInBackdrop(CHANNEL_STORY_TEMPLATE_ID),
      avatarBorderColor: "rgba(255,255,255,0)",
      previewFrameMode: "full-frame"
    }
  }
];

const TEMPLATE_VARIANT_MAP = new Map(TEMPLATE_VARIANTS.map((variant) => [variant.id, variant] as const));
const TEMPLATE_REGISTRY_ENTRIES: TemplateRegistryEntry[] = TEMPLATE_VARIANTS.map((variant) => ({
  variant,
  getConfig: () => getTemplateById(variant.id)
}));
const TEMPLATE_REGISTRY_ENTRY_MAP = new Map(
  TEMPLATE_REGISTRY_ENTRIES.map((entry) => [entry.variant.id, entry] as const)
);

function resolveTemplateId(templateId: string | null | undefined): string {
  const candidate = templateId?.trim();
  if (!candidate) {
    return STAGE3_TEMPLATE_ID;
  }
  return TEMPLATE_VARIANT_MAP.has(candidate) ? candidate : STAGE3_TEMPLATE_ID;
}

export function listTemplateVariants(): TemplateVariant[] {
  return TEMPLATE_VARIANTS;
}

export function isBuiltInTemplateId(templateId: string | null | undefined): boolean {
  const candidate = templateId?.trim();
  return Boolean(candidate && TEMPLATE_VARIANT_MAP.has(candidate));
}

export function listTemplateRegistryEntries(): TemplateRegistryEntry[] {
  return TEMPLATE_REGISTRY_ENTRIES;
}

export function getTemplateVariant(templateId: string | null | undefined): TemplateVariant {
  const resolved = resolveTemplateId(templateId);
  return TEMPLATE_VARIANT_MAP.get(resolved) ?? TEMPLATE_VARIANT_MAP.get(STAGE3_TEMPLATE_ID)!;
}

export function getTemplateRegistryEntry(templateId: string | null | undefined): TemplateRegistryEntry {
  const resolved = resolveTemplateId(templateId);
  return (
    TEMPLATE_REGISTRY_ENTRY_MAP.get(resolved) ??
    TEMPLATE_REGISTRY_ENTRY_MAP.get(STAGE3_TEMPLATE_ID)!
  );
}

export function templateUsesBuiltInBackdropFromRegistry(templateId: string | null | undefined): boolean {
  return getTemplateVariant(templateId).runtime.usesBuiltInBackdrop;
}

export function resolveTemplateOverlayTint(templateId: string | null | undefined): string | null {
  return getTemplateVariant(templateId).runtime.overlayTint ?? null;
}

export function resolveTemplateAvatarBorderColor(templateId: string | null | undefined): string {
  return getTemplateVariant(templateId).runtime.avatarBorderColor;
}

export function resolveTemplateBuiltInBackdropAssetPath(templateId: string | null | undefined): string | null {
  return getTemplateVariant(templateId).runtime.builtInBackdropAssetPath ?? null;
}

export function resolveTemplatePreviewFrameMode(
  templateId: string | null | undefined
): "full-frame" | "template-shell" {
  return getTemplateVariant(templateId).runtime.previewFrameMode ?? "full-frame";
}

export function getTemplateConfigFromRegistry(templateId: string | null | undefined) {
  return getTemplateRegistryEntry(templateId).getConfig();
}
