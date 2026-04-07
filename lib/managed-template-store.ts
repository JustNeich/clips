import path from "node:path";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { getStage3DesignLabPreset } from "./stage3-design-lab";
import type { TemplateContentFixture } from "./template-calibration-types";
import {
  STAGE3_TEMPLATE_ID,
  cloneStage3TemplateConfig,
  type Stage3TemplateConfig,
  getTemplateById
} from "./stage3-template";
import { listTemplateVariants } from "./stage3-template-registry";
import { clampStage3TextScaleUi } from "./stage3-text-fit";
import {
  buildTemplateHighlightSpansFromPhrases,
  createEmptyTemplateCaptionHighlights,
  normalizeTemplateCaptionHighlights,
  normalizeTemplateHighlightConfig
} from "./template-highlights";
import type {
  ManagedTemplate,
  ManagedTemplateShadowLayer,
  ManagedTemplateSummary,
  ManagedTemplateVersion,
  ManagedTemplateVersionSnapshot
} from "./managed-template-types";
import { assertServerRuntime } from "./server-runtime-guard";

assertServerRuntime("managed-template-store");

const SUPPORTED_BASE_TEMPLATE_IDS = new Set(listTemplateVariants().map((variant) => variant.id));
const TEMPLATE_WRITE_QUEUE = new Map<string, Promise<void>>();
const MAX_MANAGED_TEMPLATE_VERSIONS = 24;

type ManagedTemplateInput = {
  name?: unknown;
  description?: unknown;
  baseTemplateId?: unknown;
  content?: unknown;
  templateConfig?: unknown;
  shadowLayers?: unknown;
};

type ManagedTemplateCreateMeta = {
  workspaceId: string;
  creatorUserId: string;
  creatorDisplayName?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sanitizeTemplateId(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "").toLowerCase();
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return slug || "template";
}

function getManagedTemplatesRoot(): string {
  const override = process.env.MANAGED_TEMPLATES_ROOT?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.join(process.cwd(), "design", "managed-templates");
}

function getSeededMarkerPath(): string {
  return path.join(getManagedTemplatesRoot(), ".seeded");
}

function resolveBaseTemplateId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return STAGE3_TEMPLATE_ID;
  }
  const candidate = value.trim();
  return SUPPORTED_BASE_TEMPLATE_IDS.has(candidate) ? candidate : STAGE3_TEMPLATE_ID;
}

function buildDefaultContent(baseTemplateId: string): TemplateContentFixture {
  const preset = getStage3DesignLabPreset(baseTemplateId);
  return {
    topText: preset.topText,
    bottomText: preset.bottomText,
    channelName: preset.channelName,
    channelHandle: preset.channelHandle,
    highlights: createEmptyTemplateCaptionHighlights(),
    topHighlightPhrases: [],
    topFontScale: 1,
    bottomFontScale: 1,
    previewScale: clamp(preset.defaultPreviewScale, 0.22, 0.5),
    mediaAsset: null,
    backgroundAsset: null,
    avatarAsset: null
  };
}

function buildSeedSnapshot(baseTemplateId: string): ManagedTemplateVersionSnapshot {
  const preset = getStage3DesignLabPreset(baseTemplateId);
  return {
    name: preset.label,
    description: preset.note,
    baseTemplateId,
    content: buildDefaultContent(baseTemplateId),
    templateConfig: cloneStage3TemplateConfig(getTemplateById(baseTemplateId)),
    shadowLayers: []
  };
}

function buildSystemManagedTemplate(baseTemplateId: string, createdAt = new Date().toISOString()): ManagedTemplate {
  const snapshot = buildSeedSnapshot(baseTemplateId);
  return {
    id: baseTemplateId,
    workspaceId: null,
    creatorUserId: null,
    creatorDisplayName: null,
    createdAt,
    updatedAt: createdAt,
    versions: [],
    ...snapshot
  };
}

export function isSystemManagedTemplate(
  template:
    | Pick<ManagedTemplate, "workspaceId" | "creatorUserId">
    | Pick<ManagedTemplateSummary, "workspaceId" | "creatorUserId">
    | null
    | undefined
): boolean {
  return !template?.workspaceId && !template?.creatorUserId;
}

function normalizeContent(raw: unknown, baseTemplateId: string): TemplateContentFixture {
  const defaults = buildDefaultContent(baseTemplateId);
  if (!isRecord(raw)) {
    return defaults;
  }

  const topText = typeof raw.topText === "string" ? raw.topText : defaults.topText;
  const bottomText = typeof raw.bottomText === "string" ? raw.bottomText : defaults.bottomText;
  const topHighlightPhrases = (
    Array.isArray(raw.topHighlightPhrases)
      ? raw.topHighlightPhrases.filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0
        )
      : defaults.topHighlightPhrases
  ) ?? [];
  const highlights = normalizeTemplateCaptionHighlights(raw.highlights, {
    top: topText,
    bottom: bottomText
  });
  if (highlights.top.length === 0 && highlights.bottom.length === 0 && topHighlightPhrases.length > 0) {
    highlights.top = buildTemplateHighlightSpansFromPhrases({
      text: topText,
      annotations: topHighlightPhrases.map((phrase) => ({
        phrase,
        slotId: "slot1" as const
      }))
    });
  }

  return {
    topText,
    bottomText,
    channelName: typeof raw.channelName === "string" ? raw.channelName : defaults.channelName,
    channelHandle: typeof raw.channelHandle === "string" ? raw.channelHandle : defaults.channelHandle,
    highlights,
    topHighlightPhrases,
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

function normalizeTemplateConfig(raw: unknown, baseTemplateId: string): Stage3TemplateConfig {
  const base = cloneStage3TemplateConfig(getTemplateById(baseTemplateId));
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

  base.highlights = normalizeTemplateHighlightConfig(raw.highlights, {
    accentColor: base.palette.accentColor ?? base.palette.topTextColor
  });

  return base;
}

function normalizeShadowLayers(raw: unknown): ManagedTemplateShadowLayer[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item): ManagedTemplateShadowLayer | null => {
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
            ? sanitizeTemplateId(item.id)
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
    .filter((item): item is ManagedTemplateShadowLayer => item !== null);
}

function normalizeSnapshot(
  input: ManagedTemplateInput,
  fallback?: Partial<ManagedTemplateVersionSnapshot>
): ManagedTemplateVersionSnapshot {
  const baseTemplateId = resolveBaseTemplateId(input.baseTemplateId ?? fallback?.baseTemplateId);
  const seed = buildSeedSnapshot(baseTemplateId);
  return {
    name:
      typeof input.name === "string" && input.name.trim()
        ? input.name.trim()
        : fallback?.name?.trim() || seed.name,
    description:
      typeof input.description === "string"
        ? input.description.trim()
        : fallback?.description?.trim() || seed.description,
    baseTemplateId,
    content: normalizeContent(input.content ?? fallback?.content, baseTemplateId),
    templateConfig: normalizeTemplateConfig(
      input.templateConfig ?? fallback?.templateConfig,
      baseTemplateId
    ),
    shadowLayers: normalizeShadowLayers(input.shadowLayers ?? fallback?.shadowLayers)
  };
}

function buildVersion(
  template: ManagedTemplateVersionSnapshot,
  label: string,
  createdAt = new Date().toISOString()
): ManagedTemplateVersion {
  return {
    id: randomUUID().slice(0, 8),
    createdAt,
    label,
    snapshot: {
      name: template.name,
      description: template.description,
      baseTemplateId: template.baseTemplateId,
      content: { ...template.content },
      templateConfig: cloneStage3TemplateConfig(template.templateConfig),
      shadowLayers: template.shadowLayers.map((layer) => ({ ...layer }))
    }
  };
}

function versionLabelFromTimestamp(stamp: string): string {
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) {
    return "Сохранённая версия";
  }
  return `Версия ${date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  })}`;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureManagedTemplatesRoot(): Promise<void> {
  const root = getManagedTemplatesRoot();
  await fs.mkdir(root, { recursive: true });

  const existingTemplateFiles = new Set(
    (await fs.readdir(root))
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => path.basename(entry, ".json"))
  );

  const now = new Date().toISOString();
  const missingSystemTemplates = listTemplateVariants()
    .map((variant) => variant.id)
    .filter((templateId) => !existingTemplateFiles.has(sanitizeTemplateId(templateId)));

  if (missingSystemTemplates.length > 0) {
    await Promise.all(
      missingSystemTemplates.map((templateId) => writeManagedTemplate(buildSystemManagedTemplate(templateId, now)))
    );
  }

  await fs.writeFile(getSeededMarkerPath(), "seeded\n", "utf-8");
}

function ensureManagedTemplatesRootSync(): void {
  const root = getManagedTemplatesRoot();
  mkdirSync(root, { recursive: true });

  const existingTemplateFiles = new Set(
    readdirSync(root)
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => path.basename(entry, ".json"))
  );
  const now = new Date().toISOString();
  const missingSystemTemplates = listTemplateVariants()
    .map((variant) => variant.id)
    .filter((templateId) => !existingTemplateFiles.has(sanitizeTemplateId(templateId)));

  for (const templateId of missingSystemTemplates) {
    writeManagedTemplateSync(buildSystemManagedTemplate(templateId, now));
  }

  writeFileSync(getSeededMarkerPath(), "seeded\n", "utf-8");
}

function getManagedTemplatePath(templateId: string): string {
  return path.join(getManagedTemplatesRoot(), `${sanitizeTemplateId(templateId)}.json`);
}

function toManagedTemplateSummary(template: ManagedTemplate): ManagedTemplateSummary {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    baseTemplateId: template.baseTemplateId,
    workspaceId: template.workspaceId,
    creatorUserId: template.creatorUserId,
    creatorDisplayName: template.creatorDisplayName,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    versionsCount: template.versions.length
  };
}

function extractLeadingJsonObject(raw: string): string | null {
  let started = false;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];

    if (!started) {
      if (/\s/.test(character)) {
        continue;
      }
      if (character !== "{") {
        return null;
      }
      started = true;
      depth = 1;
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === "\"") {
        inString = false;
      }
      continue;
    }

    if (character === "\"") {
      inString = true;
      continue;
    }

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(0, index + 1);
      }
    }
  }

  return null;
}

function parseManagedTemplateRecord(
  parsed: Record<string, unknown>,
  fallbackId: string
): ManagedTemplate | null {
  const safeId =
    typeof parsed.id === "string" && parsed.id.trim()
      ? sanitizeTemplateId(parsed.id)
      : sanitizeTemplateId(fallbackId);
  if (!safeId) {
    return null;
  }

  const fallback = buildSeedSnapshot(resolveBaseTemplateId(parsed.baseTemplateId));
  const snapshot = normalizeSnapshot(parsed, fallback);
  const rawVersions = Array.isArray(parsed.versions) ? parsed.versions : [];

  const versions = rawVersions
    .map((item): ManagedTemplateVersion | null => {
      if (!isRecord(item)) {
        return null;
      }
      const createdAt =
        typeof item.createdAt === "string" && item.createdAt.trim()
          ? item.createdAt
          : new Date().toISOString();
      const versionSnapshot = normalizeSnapshot(
        isRecord(item.snapshot) ? (item.snapshot as ManagedTemplateInput) : {},
        snapshot
      );
      return {
        id:
          typeof item.id === "string" && item.id.trim()
            ? sanitizeTemplateId(item.id)
            : randomUUID().slice(0, 8),
        createdAt,
        label:
          typeof item.label === "string" && item.label.trim()
            ? item.label.trim()
            : versionLabelFromTimestamp(createdAt),
        snapshot: versionSnapshot
      };
    })
    .filter((item): item is ManagedTemplateVersion => item !== null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return {
    id: safeId,
    workspaceId:
      typeof parsed.workspaceId === "string" && parsed.workspaceId.trim()
        ? parsed.workspaceId.trim()
        : null,
    creatorUserId:
      typeof parsed.creatorUserId === "string" && parsed.creatorUserId.trim()
        ? parsed.creatorUserId.trim()
        : null,
    creatorDisplayName:
      typeof parsed.creatorDisplayName === "string" && parsed.creatorDisplayName.trim()
        ? parsed.creatorDisplayName.trim()
        : null,
    createdAt:
      typeof parsed.createdAt === "string" && parsed.createdAt.trim()
        ? parsed.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof parsed.updatedAt === "string" && parsed.updatedAt.trim()
        ? parsed.updatedAt
        : new Date().toISOString(),
    versions,
    ...snapshot
  };
}

function parseManagedTemplateSource(
  raw: string,
  filePath: string
): { template: ManagedTemplate | null; recovered: boolean } {
  const fallbackId = path.basename(filePath, ".json");

  try {
    return {
      template: parseManagedTemplateRecord(JSON.parse(raw) as Record<string, unknown>, fallbackId),
      recovered: false
    };
  } catch {
    const recoveredRaw = extractLeadingJsonObject(raw);
    if (!recoveredRaw || recoveredRaw.trim() === raw.trim()) {
      return { template: null, recovered: false };
    }

    try {
      return {
        template: parseManagedTemplateRecord(
          JSON.parse(recoveredRaw) as Record<string, unknown>,
          fallbackId
        ),
        recovered: true
      };
    } catch {
      return { template: null, recovered: false };
    }
  }
}

async function readManagedTemplateFile(filePath: string): Promise<ManagedTemplate | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = parseManagedTemplateSource(raw, filePath);
    if (!parsed.template) {
      return null;
    }
    if (parsed.recovered) {
      await writeManagedTemplate(parsed.template);
    }
    return parsed.template;
  } catch {
    return null;
  }
}

async function writeManagedTemplate(template: ManagedTemplate): Promise<void> {
  await fs.mkdir(getManagedTemplatesRoot(), { recursive: true });
  const filePath = getManagedTemplatePath(template.id);
  const payload = `${JSON.stringify(template, null, 2)}\n`;
  const previousWrite = TEMPLATE_WRITE_QUEUE.get(filePath) ?? Promise.resolve();
  let currentWrite: Promise<void> | null = null;
  currentWrite = previousWrite
    .catch(() => {})
    .then(async () => {
      const tempPath = `${filePath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
      await fs.writeFile(tempPath, payload, "utf-8");
      await fs.rename(tempPath, filePath);
    })
    .finally(() => {
      if (TEMPLATE_WRITE_QUEUE.get(filePath) === currentWrite) {
        TEMPLATE_WRITE_QUEUE.delete(filePath);
      }
    });
  TEMPLATE_WRITE_QUEUE.set(filePath, currentWrite);
  await currentWrite;
}

function writeManagedTemplateSync(template: ManagedTemplate): void {
  mkdirSync(getManagedTemplatesRoot(), { recursive: true });
  const filePath = getManagedTemplatePath(template.id);
  const tempPath = `${filePath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(template, null, 2)}\n`, "utf-8");
  renameSync(tempPath, filePath);
}

export async function listManagedTemplates(): Promise<ManagedTemplate[]> {
  await ensureManagedTemplatesRoot();
  const files = (await fs.readdir(getManagedTemplatesRoot()))
    .filter((entry) => entry.endsWith(".json"))
    .sort();
  const root = getManagedTemplatesRoot();
  const templates = (
    await Promise.all(files.map((entry) => readManagedTemplateFile(path.join(root, entry))))
  ).filter((item): item is ManagedTemplate => item !== null);
  return templates.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function listManagedTemplateSummaries(): Promise<ManagedTemplateSummary[]> {
  return (await listManagedTemplates()).map(toManagedTemplateSummary);
}

export async function readManagedTemplate(templateId: string): Promise<ManagedTemplate | null> {
  await ensureManagedTemplatesRoot();
  const safeId = sanitizeTemplateId(templateId);
  if (!safeId) {
    return null;
  }
  return readManagedTemplateFile(getManagedTemplatePath(safeId));
}

export async function resolveManagedTemplate(
  templateId: string | null | undefined
): Promise<ManagedTemplate | null> {
  const candidate = typeof templateId === "string" && templateId.trim() ? templateId.trim() : "";
  if (candidate) {
    const direct = await readManagedTemplate(candidate);
    if (direct) {
      return direct;
    }
    return null;
  }

  return readManagedTemplate(STAGE3_TEMPLATE_ID);
}

export async function createManagedTemplate(
  input: ManagedTemplateInput,
  meta: ManagedTemplateCreateMeta
): Promise<ManagedTemplate> {
  await ensureManagedTemplatesRoot();
  const snapshot = normalizeSnapshot(input);
  const now = new Date().toISOString();
  const template: ManagedTemplate = {
    id: `${slugify(snapshot.name)}-${randomUUID().slice(0, 8)}`,
    workspaceId: meta.workspaceId,
    creatorUserId: meta.creatorUserId,
    creatorDisplayName: meta.creatorDisplayName?.trim() || null,
    createdAt: now,
    updatedAt: now,
    versions: [],
    ...snapshot
  };
  await writeManagedTemplate(template);
  return template;
}

export async function updateManagedTemplate(
  templateId: string,
  input: ManagedTemplateInput
): Promise<ManagedTemplate | null> {
  const existing = await readManagedTemplate(templateId);
  if (!existing || isSystemManagedTemplate(existing)) {
    return null;
  }
  const snapshot = normalizeSnapshot(input, existing);
  const updated: ManagedTemplate = {
    ...existing,
    ...snapshot,
    updatedAt: new Date().toISOString()
  };
  await writeManagedTemplate(updated);
  return updated;
}

export async function createManagedTemplateVersion(
  templateId: string,
  label?: string | null
): Promise<ManagedTemplate | null> {
  const existing = await readManagedTemplate(templateId);
  if (!existing || isSystemManagedTemplate(existing)) {
    return null;
  }
  const stamp = new Date().toISOString();
  const version = buildVersion(
    {
      name: existing.name,
      description: existing.description,
      baseTemplateId: existing.baseTemplateId,
      content: existing.content,
      templateConfig: existing.templateConfig,
      shadowLayers: existing.shadowLayers
    },
    label?.trim() || versionLabelFromTimestamp(stamp),
    stamp
  );
  const updated: ManagedTemplate = {
    ...existing,
    updatedAt: stamp,
    versions: [version, ...existing.versions].slice(0, MAX_MANAGED_TEMPLATE_VERSIONS)
  };
  await writeManagedTemplate(updated);
  return updated;
}

export async function restoreManagedTemplateVersion(
  templateId: string,
  versionId: string
): Promise<ManagedTemplate | null> {
  const existing = await readManagedTemplate(templateId);
  if (!existing || isSystemManagedTemplate(existing)) {
    return null;
  }
  const selected = existing.versions.find((version) => version.id === sanitizeTemplateId(versionId));
  if (!selected) {
    return null;
  }

  const stamp = new Date().toISOString();
  const rollbackVersion = buildVersion(
    {
      name: existing.name,
      description: existing.description,
      baseTemplateId: existing.baseTemplateId,
      content: existing.content,
      templateConfig: existing.templateConfig,
      shadowLayers: existing.shadowLayers
    },
    `Автоснимок перед откатом ${new Date(stamp).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    })}`,
    stamp
  );

  const restored: ManagedTemplate = {
    ...existing,
    ...normalizeSnapshot(selected.snapshot, existing),
    updatedAt: stamp,
    versions: [rollbackVersion, ...existing.versions].slice(0, MAX_MANAGED_TEMPLATE_VERSIONS)
  };
  await writeManagedTemplate(restored);
  return restored;
}

export async function deleteManagedTemplate(templateId: string): Promise<boolean> {
  const safeId = sanitizeTemplateId(templateId);
  if (!safeId) {
    return false;
  }
  const existing = await readManagedTemplate(safeId);
  if (!existing || isSystemManagedTemplate(existing)) {
    return false;
  }
  try {
    await fs.unlink(getManagedTemplatePath(safeId));
    return true;
  } catch {
    return false;
  }
}

export function readManagedTemplateSync(templateId: string): ManagedTemplate | null {
  ensureManagedTemplatesRootSync();
  const safeId = sanitizeTemplateId(templateId);
  if (!safeId) {
    return null;
  }
  const filePath = getManagedTemplatePath(safeId);
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = parseManagedTemplateSource(raw, filePath);
    if (!parsed.template) {
      return null;
    }
    if (parsed.recovered) {
      writeManagedTemplateSync(parsed.template);
    }
    return parsed.template;
  } catch {
    return null;
  }
}

export function resolveManagedTemplateSync(
  templateId: string | null | undefined
): ManagedTemplate | null {
  const candidate = typeof templateId === "string" && templateId.trim() ? templateId.trim() : "";
  if (candidate) {
    const direct = readManagedTemplateSync(candidate);
    if (direct) {
      return direct;
    }
    return null;
  }

  return readManagedTemplateSync(STAGE3_TEMPLATE_ID);
}

export function deleteManagedTemplateSync(templateId: string): boolean {
  const safeId = sanitizeTemplateId(templateId);
  if (!safeId) {
    return false;
  }
  const existing = readManagedTemplateSync(safeId);
  if (!existing || isSystemManagedTemplate(existing)) {
    return false;
  }
  try {
    unlinkSync(getManagedTemplatePath(safeId));
    return true;
  } catch {
    return false;
  }
}
