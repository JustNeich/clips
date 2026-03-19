import {
  SCIENCE_CARD_TEMPLATE_ID,
  SCIENCE_CARD_V2_TEMPLATE_ID,
  SCIENCE_CARD_V3_TEMPLATE_ID,
  SCIENCE_CARD_V4_TEMPLATE_ID,
  SCIENCE_CARD_V5_TEMPLATE_ID,
  SCIENCE_CARD_V6_TEMPLATE_ID,
  SCIENCE_CARD_V7_TEMPLATE_ID,
  STAGE3_TEMPLATE_ID,
  TURBO_FACE_TEMPLATE_ID,
  getTemplateById,
  templateUsesBuiltInBackdrop
} from "./stage3-template";

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
    runtime: {
      usesBuiltInBackdrop: templateUsesBuiltInBackdrop(SCIENCE_CARD_TEMPLATE_ID),
      avatarBorderColor: "rgba(7, 13, 23, 0.25)",
      previewFrameMode: "full-frame"
    }
  },
  {
    id: TURBO_FACE_TEMPLATE_ID,
    label: "Stone Face Turbo",
    runtime: {
      usesBuiltInBackdrop: templateUsesBuiltInBackdrop(TURBO_FACE_TEMPLATE_ID),
      overlayTint: "rgba(0, 0, 0, 0.08)",
      avatarBorderColor: "rgba(8,12,18,0.16)",
      previewFrameMode: "full-frame"
    }
  },
  {
    id: SCIENCE_CARD_V2_TEMPLATE_ID,
    label: "Science Card V2",
    runtime: {
      usesBuiltInBackdrop: templateUsesBuiltInBackdrop(SCIENCE_CARD_V2_TEMPLATE_ID),
      builtInBackdropAssetPath: "/stage3-template-backdrops/science-card-v2.png",
      avatarBorderColor: "rgba(218, 189, 136, 0.34)",
      previewFrameMode: "full-frame"
    }
  },
  {
    id: SCIENCE_CARD_V3_TEMPLATE_ID,
    label: "Science Card Halo",
    runtime: {
      usesBuiltInBackdrop: templateUsesBuiltInBackdrop(SCIENCE_CARD_V3_TEMPLATE_ID),
      overlayTint: "linear-gradient(180deg, rgba(8, 28, 48, 0.08), rgba(8, 28, 48, 0.02))",
      avatarBorderColor: "rgba(24, 74, 138, 0.24)",
      previewFrameMode: "full-frame"
    }
  },
  {
    id: SCIENCE_CARD_V4_TEMPLATE_ID,
    label: "Science Card Nightglass",
    runtime: {
      usesBuiltInBackdrop: templateUsesBuiltInBackdrop(SCIENCE_CARD_V4_TEMPLATE_ID),
      overlayTint: "linear-gradient(180deg, rgba(0, 11, 20, 0.22), rgba(0, 11, 20, 0.08))",
      avatarBorderColor: "rgba(101, 224, 255, 0.3)",
      previewFrameMode: "full-frame"
    }
  },
  {
    id: SCIENCE_CARD_V5_TEMPLATE_ID,
    label: "Science Card Copperline",
    runtime: {
      usesBuiltInBackdrop: templateUsesBuiltInBackdrop(SCIENCE_CARD_V5_TEMPLATE_ID),
      overlayTint: "linear-gradient(180deg, rgba(112, 58, 27, 0.08), rgba(112, 58, 27, 0.02))",
      avatarBorderColor: "rgba(122, 58, 25, 0.26)",
      previewFrameMode: "full-frame"
    }
  },
  {
    id: SCIENCE_CARD_V6_TEMPLATE_ID,
    label: "Science Card Arcade",
    runtime: {
      usesBuiltInBackdrop: templateUsesBuiltInBackdrop(SCIENCE_CARD_V6_TEMPLATE_ID),
      avatarBorderColor: "rgba(79, 217, 42, 0.34)",
      previewFrameMode: "full-frame"
    }
  },
  {
    id: SCIENCE_CARD_V7_TEMPLATE_ID,
    label: "Science Card Skyframe",
    runtime: {
      usesBuiltInBackdrop: templateUsesBuiltInBackdrop(SCIENCE_CARD_V7_TEMPLATE_ID),
      avatarBorderColor: "rgba(255,255,255,0)",
      previewFrameMode: "template-shell"
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
