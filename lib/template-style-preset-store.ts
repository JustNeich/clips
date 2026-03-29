import "server-only";

import path from "node:path";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { getStage3DesignLabPreset } from "./stage3-design-lab";
import { type TemplateContentFixture } from "./template-calibration-types";
import {
  STAGE3_TEMPLATE_ID,
  type Stage3TemplateConfig,
  getTemplateById
} from "./stage3-template";
import { listTemplateVariants } from "./stage3-template-registry";
import { clampStage3TextScaleUi } from "./stage3-text-fit";
import type {
  TemplateStyleBoxShadowLayer,
  TemplateStylePreset
} from "./template-style-preset-types";

const PRESETS_ROOT = path.join(process.cwd(), "design", "template-style-presets");
const SUPPORTED_TEMPLATE_IDS = new Set(listTemplateVariants().map((variant) => variant.id));

type TemplateStylePresetInput = {
  name?: unknown;
  description?: unknown;
  templateId?: unknown;
  content?: unknown;
  templateConfig?: unknown;
  shadowLayers?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizePresetId(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "").toLowerCase();
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return slug || "style-preset";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function cloneTemplateConfig(config: Stage3TemplateConfig): Stage3TemplateConfig {
  return {
    frame: { ...config.frame },
    card: { ...config.card },
    slot: { ...config.slot },
    author: { ...config.author },
    typography: {
      top: { ...config.typography.top },
      bottom: { ...config.typography.bottom },
      authorName: { ...config.typography.authorName },
      authorHandle: { ...config.typography.authorHandle }
    },
    palette: { ...config.palette }
  };
}

function resolveTemplateId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return STAGE3_TEMPLATE_ID;
  }
  const candidate = value.trim();
  return SUPPORTED_TEMPLATE_IDS.has(candidate) ? candidate : STAGE3_TEMPLATE_ID;
}

function buildDefaultContent(templateId: string): TemplateContentFixture {
  const preset = getStage3DesignLabPreset(templateId);
  return {
    topText: preset.topText,
    bottomText: preset.bottomText,
    channelName: preset.channelName,
    channelHandle: preset.channelHandle,
    topHighlightPhrases: [],
    topFontScale: 1,
    bottomFontScale: 1,
    previewScale: clamp(preset.defaultPreviewScale, 0.22, 0.5),
    mediaAsset: null,
    backgroundAsset: null,
    avatarAsset: null
  };
}

function buildDefaultName(templateId: string): string {
  return `${getStage3DesignLabPreset(templateId).label} Style`;
}

function normalizeContent(raw: unknown, templateId: string): TemplateContentFixture {
  const defaults = buildDefaultContent(templateId);
  if (!isRecord(raw)) {
    return defaults;
  }

  return {
    topText: typeof raw.topText === "string" ? raw.topText : defaults.topText,
    bottomText: typeof raw.bottomText === "string" ? raw.bottomText : defaults.bottomText,
    channelName: typeof raw.channelName === "string" ? raw.channelName : defaults.channelName,
    channelHandle: typeof raw.channelHandle === "string" ? raw.channelHandle : defaults.channelHandle,
    topHighlightPhrases: Array.isArray(raw.topHighlightPhrases)
      ? raw.topHighlightPhrases.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0
        )
      : defaults.topHighlightPhrases,
    topFontScale:
      typeof raw.topFontScale === "number" && Number.isFinite(raw.topFontScale)
        ? clampStage3TextScaleUi(raw.topFontScale)
        : defaults.topFontScale,
    bottomFontScale:
      typeof raw.bottomFontScale === "number" && Number.isFinite(raw.bottomFontScale)
        ? clampStage3TextScaleUi(raw.bottomFontScale)
        : defaults.bottomFontScale,
    previewScale:
      typeof raw.previewScale === "number" && Number.isFinite(raw.previewScale)
        ? clamp(raw.previewScale, 0.22, 0.5)
        : defaults.previewScale,
    mediaAsset:
      raw.mediaAsset === null ? null : typeof raw.mediaAsset === "string" ? raw.mediaAsset : defaults.mediaAsset,
    backgroundAsset:
      raw.backgroundAsset === null
        ? null
        : typeof raw.backgroundAsset === "string"
          ? raw.backgroundAsset
          : defaults.backgroundAsset,
    avatarAsset:
      raw.avatarAsset === null
        ? null
        : typeof raw.avatarAsset === "string"
          ? raw.avatarAsset
          : defaults.avatarAsset
  };
}

function normalizeTemplateConfig(raw: unknown, templateId: string): Stage3TemplateConfig {
  const base = cloneTemplateConfig(getTemplateById(templateId));
  if (!isRecord(raw)) {
    return base;
  }

  const card = isRecord(raw.card) ? raw.card : null;
  if (card) {
    if (typeof card.radius === "number" && Number.isFinite(card.radius)) {
      base.card.radius = clamp(card.radius, 0, 80);
    }
    if (typeof card.borderWidth === "number" && Number.isFinite(card.borderWidth)) {
      base.card.borderWidth = clamp(card.borderWidth, 0, 40);
    }
    if (typeof card.borderColor === "string") {
      base.card.borderColor = card.borderColor;
    }
    if (typeof card.fill === "string") {
      base.card.fill = card.fill;
    }
    if (typeof card.shadow === "string") {
      base.card.shadow = card.shadow;
    }
  }

  const slot = isRecord(raw.slot) ? raw.slot : null;
  if (slot) {
    const numericSlotKeys: Array<keyof Stage3TemplateConfig["slot"]> = [
      "topHeight",
      "bottomHeight",
      "topPaddingX",
      "topPaddingY",
      "topPaddingTop",
      "topPaddingBottom",
      "bottomMetaHeight",
      "bottomMetaPaddingX",
      "bottomMetaPaddingY",
      "bottomTextPaddingX",
      "bottomTextPaddingY",
      "bottomTextPaddingTop",
      "bottomTextPaddingBottom",
      "bottomTextPaddingLeft",
      "bottomTextPaddingRight"
    ];
    for (const key of numericSlotKeys) {
      const value = slot[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        base.slot[key] = Math.max(0, Math.round(value));
      }
    }
  }

  const author = isRecord(raw.author) ? raw.author : null;
  if (author) {
    const numericAuthorKeys: Array<
      "avatarSize" | "avatarBorder" | "checkSize" | "gap" | "copyGap" | "nameCheckGap"
    > = [
      "avatarSize",
      "avatarBorder",
      "checkSize",
      "gap",
      "copyGap",
      "nameCheckGap"
    ];
    for (const key of numericAuthorKeys) {
      const value = author[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        base.author[key] = Math.max(0, Math.round(value));
      }
    }
    if (typeof author.name === "string") {
      base.author.name = author.name;
    }
    if (typeof author.handle === "string") {
      base.author.handle = author.handle;
    }
    if (typeof author.checkAssetPath === "string") {
      base.author.checkAssetPath = author.checkAssetPath;
    }
  }

  const typography = isRecord(raw.typography) ? raw.typography : null;
  if (typography) {
    const top = isRecord(typography.top) ? typography.top : null;
    if (top) {
      if (typeof top.weight === "number" && Number.isFinite(top.weight)) {
        base.typography.top.weight = clamp(top.weight, 100, 900);
      }
      if (typeof top.letterSpacing === "string") {
        base.typography.top.letterSpacing = top.letterSpacing;
      }
      if (top.fontStyle === "normal" || top.fontStyle === "italic") {
        base.typography.top.fontStyle = top.fontStyle;
      }
      if (typeof top.fontFamily === "string") {
        base.typography.top.fontFamily = top.fontFamily;
      }
    }

    const bottom = isRecord(typography.bottom) ? typography.bottom : null;
    if (bottom) {
      if (typeof bottom.weight === "number" && Number.isFinite(bottom.weight)) {
        base.typography.bottom.weight = clamp(bottom.weight, 100, 900);
      }
      if (typeof bottom.letterSpacing === "string") {
        base.typography.bottom.letterSpacing = bottom.letterSpacing;
      }
      if (bottom.fontStyle === "normal" || bottom.fontStyle === "italic") {
        base.typography.bottom.fontStyle = bottom.fontStyle;
      }
      if (typeof bottom.fontFamily === "string") {
        base.typography.bottom.fontFamily = bottom.fontFamily;
      }
    }

    const authorName = isRecord(typography.authorName) ? typography.authorName : null;
    if (authorName) {
      if (typeof authorName.font === "number" && Number.isFinite(authorName.font)) {
        base.typography.authorName.font = clamp(authorName.font, 12, 96);
      }
      if (typeof authorName.weight === "number" && Number.isFinite(authorName.weight)) {
        base.typography.authorName.weight = clamp(authorName.weight, 100, 900);
      }
      if (typeof authorName.letterSpacing === "string") {
        base.typography.authorName.letterSpacing = authorName.letterSpacing;
      }
      if (typeof authorName.fontFamily === "string") {
        base.typography.authorName.fontFamily = authorName.fontFamily;
      }
    }

    const authorHandle = isRecord(typography.authorHandle) ? typography.authorHandle : null;
    if (authorHandle) {
      if (typeof authorHandle.font === "number" && Number.isFinite(authorHandle.font)) {
        base.typography.authorHandle.font = clamp(authorHandle.font, 12, 96);
      }
      if (typeof authorHandle.weight === "number" && Number.isFinite(authorHandle.weight)) {
        base.typography.authorHandle.weight = clamp(authorHandle.weight, 100, 900);
      }
      if (typeof authorHandle.letterSpacing === "string") {
        base.typography.authorHandle.letterSpacing = authorHandle.letterSpacing;
      }
      if (typeof authorHandle.fontFamily === "string") {
        base.typography.authorHandle.fontFamily = authorHandle.fontFamily;
      }
    }
  }

  const palette = isRecord(raw.palette) ? raw.palette : null;
  if (palette) {
    const colorKeys: Array<keyof Stage3TemplateConfig["palette"]> = [
      "cardFill",
      "topSectionFill",
      "bottomSectionFill",
      "topTextColor",
      "bottomTextColor",
      "authorNameColor",
      "authorHandleColor",
      "checkBadgeColor",
      "borderColor",
      "accentColor"
    ];
    for (const key of colorKeys) {
      const value = palette[key];
      if (typeof value === "string") {
        base.palette[key] = value;
      }
    }
  }

  return base;
}

function normalizeShadowLayers(raw: unknown): TemplateStyleBoxShadowLayer[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item): TemplateStyleBoxShadowLayer | null => {
      if (!isRecord(item)) {
        return null;
      }
      const offsetX = typeof item.offsetX === "number" && Number.isFinite(item.offsetX) ? item.offsetX : 0;
      const offsetY = typeof item.offsetY === "number" && Number.isFinite(item.offsetY) ? item.offsetY : 12;
      const blur = typeof item.blur === "number" && Number.isFinite(item.blur) ? item.blur : 32;
      const spread = typeof item.spread === "number" && Number.isFinite(item.spread) ? item.spread : 0;
      const opacity =
        typeof item.opacity === "number" && Number.isFinite(item.opacity) ? clamp(item.opacity, 0, 1) : 0.25;
      const color = typeof item.color === "string" ? item.color : "#000000";
      return {
        id:
          typeof item.id === "string" && item.id.trim()
            ? sanitizePresetId(item.id)
            : randomUUID().slice(0, 8),
        offsetX,
        offsetY,
        blur: Math.max(0, blur),
        spread,
        opacity,
        color,
        inset: item.inset === true
      };
    })
    .filter((item): item is TemplateStyleBoxShadowLayer => item !== null);
}

function normalizePresetInput(input: TemplateStylePresetInput): Omit<
  TemplateStylePreset,
  "id" | "createdAt" | "updatedAt"
> {
  const templateId = resolveTemplateId(input.templateId);
  const name =
    typeof input.name === "string" && input.name.trim()
      ? input.name.trim()
      : buildDefaultName(templateId);
  const description =
    typeof input.description === "string" ? input.description.trim() : "";

  return {
    name,
    description,
    templateId,
    content: normalizeContent(input.content, templateId),
    templateConfig: normalizeTemplateConfig(input.templateConfig, templateId),
    shadowLayers: normalizeShadowLayers(input.shadowLayers)
  };
}

async function ensurePresetsRoot(): Promise<void> {
  await fs.mkdir(PRESETS_ROOT, { recursive: true });
}

function getPresetPath(presetId: string): string {
  return path.join(PRESETS_ROOT, `${sanitizePresetId(presetId)}.json`);
}

async function readPresetFile(filePath: string): Promise<TemplateStylePreset | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as TemplateStylePresetInput & {
      id?: unknown;
      createdAt?: unknown;
      updatedAt?: unknown;
    };
    const normalized = normalizePresetInput(parsed);
    const fallbackId = path.basename(filePath, ".json");
    return {
      id:
        typeof parsed.id === "string" && parsed.id.trim()
          ? sanitizePresetId(parsed.id)
          : sanitizePresetId(fallbackId),
      createdAt:
        typeof parsed.createdAt === "string" && parsed.createdAt.trim()
          ? parsed.createdAt
          : new Date().toISOString(),
      updatedAt:
        typeof parsed.updatedAt === "string" && parsed.updatedAt.trim()
          ? parsed.updatedAt
          : new Date().toISOString(),
      ...normalized
    };
  } catch {
    return null;
  }
}

async function writePreset(preset: TemplateStylePreset): Promise<void> {
  await ensurePresetsRoot();
  await fs.writeFile(getPresetPath(preset.id), `${JSON.stringify(preset, null, 2)}\n`, "utf-8");
}

export async function listTemplateStylePresets(): Promise<TemplateStylePreset[]> {
  await ensurePresetsRoot();
  const files = (await fs.readdir(PRESETS_ROOT))
    .filter((entry) => entry.endsWith(".json"))
    .sort();

  const presets = (
    await Promise.all(files.map((entry) => readPresetFile(path.join(PRESETS_ROOT, entry))))
  ).filter((item): item is TemplateStylePreset => item !== null);

  return presets.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function readTemplateStylePreset(
  presetId: string
): Promise<TemplateStylePreset | null> {
  const safePresetId = sanitizePresetId(presetId);
  if (!safePresetId) {
    return null;
  }
  return readPresetFile(getPresetPath(safePresetId));
}

export async function createTemplateStylePreset(
  input: TemplateStylePresetInput
): Promise<TemplateStylePreset> {
  const normalized = normalizePresetInput(input);
  const now = new Date().toISOString();
  const id = `${slugify(normalized.name)}-${randomUUID().slice(0, 8)}`;
  const preset: TemplateStylePreset = {
    id,
    createdAt: now,
    updatedAt: now,
    ...normalized
  };
  await writePreset(preset);
  return preset;
}

export async function updateTemplateStylePreset(
  presetId: string,
  input: TemplateStylePresetInput
): Promise<TemplateStylePreset | null> {
  const existing = await readTemplateStylePreset(presetId);
  if (!existing) {
    return null;
  }

  const normalized = normalizePresetInput({
    name: input.name ?? existing.name,
    description: input.description ?? existing.description,
    templateId: input.templateId ?? existing.templateId,
    content: input.content ?? existing.content,
    templateConfig: input.templateConfig ?? existing.templateConfig,
    shadowLayers: input.shadowLayers ?? existing.shadowLayers
  });

  const updated: TemplateStylePreset = {
    ...existing,
    ...normalized,
    updatedAt: new Date().toISOString()
  };
  await writePreset(updated);
  return updated;
}

export async function deleteTemplateStylePreset(presetId: string): Promise<boolean> {
  const safePresetId = sanitizePresetId(presetId);
  if (!safePresetId) {
    return false;
  }

  try {
    await fs.unlink(getPresetPath(safePresetId));
    return true;
  } catch {
    return false;
  }
}
