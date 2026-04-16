import path from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { getAppDataDir } from "./app-paths";
import { getDb, newId, nowIso, runInTransaction } from "./db/client";
import { getStage3DesignLabPreset } from "./stage3-design-lab";
import type { TemplateContentFixture } from "./template-calibration-types";
import {
  STAGE3_TEMPLATE_ID,
  cloneStage3TemplateConfig,
  type Stage3TemplateConfig,
  getTemplateById
} from "./stage3-template";
import { normalizeStage3VideoAdjustments } from "./stage3-video-adjustments";
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
  ManagedTemplateVersionSnapshot
} from "./managed-template-types";
import { assertServerRuntime } from "./server-runtime-guard";

assertServerRuntime("managed-template-store");

const SUPPORTED_LAYOUT_FAMILIES = new Set(listTemplateVariants().map((variant) => variant.id));
const workspaceTemplateBootstrapRevisions = new Map<string, number>();
let legacyTemplateSourceCache:
  | {
      fingerprint: string;
      revision: number;
      templates: ManagedTemplate[];
    }
  | null = null;
let managedTemplateStoreCacheScopeKey: string | null = null;

type ManagedTemplateInput = {
  name?: unknown;
  description?: unknown;
  layoutFamily?: unknown;
  baseTemplateId?: unknown;
  content?: unknown;
  templateConfig?: unknown;
  shadowLayers?: unknown;
};

type ManagedTemplateCreateMeta = {
  workspaceId: string;
  creatorUserId?: string | null;
  creatorDisplayName?: string | null;
};

export type ManagedTemplateDeleteResult = {
  deleted: boolean;
  fallbackTemplateId: string | null;
  reassignedChannels: number;
  reason?: "not_found" | "last_template" | "already_archived";
};

export type ManagedTemplateReferenceInspection = {
  templateId: string;
  status: "active" | "archived" | "missing";
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

function getManagedTemplateStoreCacheScopeKey(): string {
  return `${getAppDataDir()}::${getManagedTemplatesRoot()}::${getLegacyManagedTemplatesRoot()}`;
}

function resetManagedTemplateStoreCachesIfScopeChanged(): void {
  const nextScopeKey = getManagedTemplateStoreCacheScopeKey();
  if (managedTemplateStoreCacheScopeKey === nextScopeKey) {
    return;
  }
  managedTemplateStoreCacheScopeKey = nextScopeKey;
  workspaceTemplateBootstrapRevisions.clear();
  legacyTemplateSourceCache = null;
}

function getManagedTemplatesRoot(): string {
  const override = process.env.MANAGED_TEMPLATES_ROOT?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.join(getAppDataDir(), "managed-templates");
}

function getLegacyManagedTemplatesRoot(): string {
  const override = process.env.MANAGED_TEMPLATES_LEGACY_ROOT?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.join(process.cwd(), "design", "managed-templates");
}

function resolveLayoutFamily(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return STAGE3_TEMPLATE_ID;
  }
  const candidate = value.trim();
  return SUPPORTED_LAYOUT_FAMILIES.has(candidate) ? candidate : STAGE3_TEMPLATE_ID;
}

function buildDefaultContent(layoutFamily: string): TemplateContentFixture {
  const preset = getStage3DesignLabPreset(layoutFamily);
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

function buildSeedSnapshot(layoutFamily: string): ManagedTemplateVersionSnapshot {
  const preset = getStage3DesignLabPreset(layoutFamily);
  return {
    name: preset.label,
    description: preset.note,
    layoutFamily,
    baseTemplateId: layoutFamily,
    content: buildDefaultContent(layoutFamily),
    templateConfig: cloneStage3TemplateConfig(getTemplateById(layoutFamily)),
    shadowLayers: []
  };
}

function buildDetachedPresetRevision(layoutFamily: string): string {
  const digest = createHash("sha1")
    .update(JSON.stringify(buildSeedSnapshot(layoutFamily)))
    .digest("hex");
  const timestampMs = Number.parseInt(digest.slice(0, 12), 16) % Date.UTC(2100, 0, 1);
  return new Date(timestampMs).toISOString();
}

function normalizeContent(raw: unknown, layoutFamily: string): TemplateContentFixture {
  const defaults = buildDefaultContent(layoutFamily);
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

function normalizeTemplateConfig(raw: unknown, layoutFamily: string): Stage3TemplateConfig {
  const base = cloneStage3TemplateConfig(getTemplateById(layoutFamily));
  if (!isRecord(raw)) {
    return base;
  }

  const card = isRecord(raw.card) ? raw.card : null;
  if (card) {
    if (typeof card.x === "number" && Number.isFinite(card.x)) {
      base.card.x = clamp(card.x, 0, base.frame.width);
    }
    if (typeof card.y === "number" && Number.isFinite(card.y)) {
      base.card.y = clamp(card.y, 0, base.frame.height);
    }
    if (typeof card.width === "number" && Number.isFinite(card.width)) {
      base.card.width = clamp(card.width, 160, base.frame.width);
    }
    if (typeof card.height === "number" && Number.isFinite(card.height)) {
      base.card.height = clamp(card.height, 160, base.frame.height);
    }
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

  if (isRecord(raw.videoAdjustments)) {
    base.videoAdjustments = normalizeStage3VideoAdjustments(raw.videoAdjustments, base.videoAdjustments);
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
      if (typeof top.lineHeight === "number" && Number.isFinite(top.lineHeight)) {
        base.typography.top.lineHeight = clamp(top.lineHeight, 0.7, 2);
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
      if (typeof bottom.lineHeight === "number" && Number.isFinite(bottom.lineHeight)) {
        base.typography.bottom.lineHeight = clamp(bottom.lineHeight, 0.7, 2);
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
      if (typeof authorName.lineHeight === "number" && Number.isFinite(authorName.lineHeight)) {
        base.typography.authorName.lineHeight = clamp(authorName.lineHeight, 0.7, 2);
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
      if (typeof authorHandle.lineHeight === "number" && Number.isFinite(authorHandle.lineHeight)) {
        base.typography.authorHandle.lineHeight = clamp(authorHandle.lineHeight, 0.7, 2);
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
  const layoutFamily = resolveLayoutFamily(
    input.layoutFamily ?? input.baseTemplateId ?? fallback?.layoutFamily ?? fallback?.baseTemplateId
  );
  const seed = buildSeedSnapshot(layoutFamily);
  return {
    name:
      typeof input.name === "string" && input.name.trim()
        ? input.name.trim()
        : fallback?.name?.trim() || seed.name,
    description:
      typeof input.description === "string"
        ? input.description.trim()
        : fallback?.description?.trim() || seed.description,
    layoutFamily,
    baseTemplateId: layoutFamily,
    content: normalizeContent(input.content ?? fallback?.content, layoutFamily),
    templateConfig: normalizeTemplateConfig(
      input.templateConfig ?? fallback?.templateConfig,
      layoutFamily
    ),
    shadowLayers: normalizeShadowLayers(input.shadowLayers ?? fallback?.shadowLayers)
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

function buildManagedTemplateFromSnapshot(input: {
  id: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  snapshot: ManagedTemplateVersionSnapshot;
}): ManagedTemplate {
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    creatorUserId: null,
    creatorDisplayName: null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    archivedAt: input.archivedAt ?? null,
    versions: [],
    ...input.snapshot
  };
}

function buildDetachedPresetTemplate(layoutFamilyRaw: string, workspaceId = "detached-workspace"): ManagedTemplate {
  const layoutFamily = resolveLayoutFamily(layoutFamilyRaw);
  const revision = buildDetachedPresetRevision(layoutFamily);
  return buildManagedTemplateFromSnapshot({
    id: layoutFamily,
    workspaceId,
    createdAt: revision,
    updatedAt: revision,
    snapshot: buildSeedSnapshot(layoutFamily)
  });
}

function parseLegacyTemplateRecord(parsed: Record<string, unknown>, fallbackId: string): ManagedTemplate | null {
  const safeId =
    typeof parsed.id === "string" && parsed.id.trim()
      ? sanitizeTemplateId(parsed.id)
      : sanitizeTemplateId(fallbackId);
  if (!safeId) {
    return null;
  }
  const snapshot = normalizeSnapshot(parsed);
  const now = nowIso();
  const workspaceId =
    typeof parsed.workspaceId === "string" && parsed.workspaceId.trim()
      ? parsed.workspaceId.trim()
      : "";

  return {
    id: safeId,
    workspaceId,
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
        : now,
    updatedAt:
      typeof parsed.updatedAt === "string" && parsed.updatedAt.trim()
        ? parsed.updatedAt
        : now,
    archivedAt: null,
    versions: [],
    ...snapshot
  };
}

function parseLegacyTemplateFile(filePath: string): ManagedTemplate | null {
  const raw = readFileSync(filePath, "utf-8");
  const fallbackId = path.basename(filePath, ".json");
  try {
    return parseLegacyTemplateRecord(JSON.parse(raw) as Record<string, unknown>, fallbackId);
  } catch {
    const recoveredRaw = extractLeadingJsonObject(raw);
    if (!recoveredRaw || recoveredRaw.trim() === raw.trim()) {
      return null;
    }
    try {
      return parseLegacyTemplateRecord(JSON.parse(recoveredRaw) as Record<string, unknown>, fallbackId);
    } catch {
      return null;
    }
  }
}

function readLegacyTemplateSources(): ManagedTemplate[] {
  resetManagedTemplateStoreCachesIfScopeChanged();
  const roots = [getManagedTemplatesRoot(), getLegacyManagedTemplatesRoot()];
  const fingerprint = JSON.stringify(
    roots.map((root) => ({
      root,
      entries: existsSync(root)
        ? readdirSync(root)
            .filter((item) => item.endsWith(".json"))
            .sort()
        : []
    }))
  );
  if (legacyTemplateSourceCache?.fingerprint === fingerprint) {
    return legacyTemplateSourceCache.templates;
  }
  const byId = new Map<string, ManagedTemplate>();

  for (const root of roots) {
    if (!existsSync(root)) {
      continue;
    }
    for (const entry of readdirSync(root).filter((item) => item.endsWith(".json")).sort()) {
      const filePath = path.join(root, entry);
      try {
        const template = parseLegacyTemplateFile(filePath);
        if (template && !byId.has(template.id)) {
          byId.set(template.id, template);
        }
      } catch {
        // Legacy file import is best effort. Broken JSON must not block app startup.
      }
    }
  }

  const templates = [...byId.values()];
  legacyTemplateSourceCache = {
    fingerprint,
    revision: (legacyTemplateSourceCache?.revision ?? 0) + 1,
    templates
  };
  return templates;
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value);
}

function deserializeJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapTemplateRow(row: Record<string, unknown>): ManagedTemplate {
  const layoutFamily = resolveLayoutFamily(row.layout_family);
  const seed = buildSeedSnapshot(layoutFamily);
  const snapshot = normalizeSnapshot(
    {
      name: row.name,
      description: row.description,
      layoutFamily,
      content: deserializeJson(row.content_json, seed.content),
      templateConfig: deserializeJson(row.template_config_json, seed.templateConfig),
      shadowLayers: deserializeJson(row.shadow_layers_json, seed.shadowLayers)
    },
    seed
  );
  return buildManagedTemplateFromSnapshot({
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    snapshot
  });
}

function toManagedTemplateSummary(template: ManagedTemplate): ManagedTemplateSummary {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    layoutFamily: template.layoutFamily,
    baseTemplateId: template.layoutFamily,
    workspaceId: template.workspaceId,
    creatorUserId: null,
    creatorDisplayName: null,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    versionsCount: 0
  };
}

function insertOrUpdateTemplateRow(template: ManagedTemplate): void {
  const db = getDb();
  const existingWorkspaceId = getTemplateRowWorkspaceId(template.id);
  if (existingWorkspaceId && existingWorkspaceId !== template.workspaceId) {
    throw new Error(`Template id collision across workspaces: ${template.id}`);
  }
  db.prepare(
    `INSERT INTO workspace_templates
      (id, workspace_id, name, description, layout_family, content_json, template_config_json, shadow_layers_json, created_at, updated_at, archived_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        name = excluded.name,
        description = excluded.description,
        layout_family = excluded.layout_family,
        content_json = excluded.content_json,
        template_config_json = excluded.template_config_json,
        shadow_layers_json = excluded.shadow_layers_json,
        updated_at = excluded.updated_at,
        archived_at = excluded.archived_at`
  ).run(
    template.id,
    template.workspaceId,
    template.name,
    template.description,
    template.layoutFamily,
    serializeJson(template.content),
    serializeJson(template.templateConfig),
    serializeJson(template.shadowLayers),
    template.createdAt,
    template.updatedAt,
    template.archivedAt
  );
}

function workspaceIds(): string[] {
  resetManagedTemplateStoreCachesIfScopeChanged();
  const db = getDb();
  const rows = db.prepare("SELECT id FROM workspaces ORDER BY created_at ASC").all() as Array<{ id: string }>;
  return rows.map((row) => String(row.id));
}

function resolveWorkspaceId(workspaceId?: string | null): string {
  const candidate = workspaceId?.trim();
  if (candidate) {
    return candidate;
  }
  const first = workspaceIds()[0];
  if (!first) {
    throw new Error("Workspace is not initialized.");
  }
  return first;
}

function activeTemplateExists(templateId: string, workspaceId?: string | null): boolean {
  const db = getDb();
  const row = workspaceId
    ? db
        .prepare(
          "SELECT id FROM workspace_templates WHERE id = ? AND workspace_id = ? AND archived_at IS NULL LIMIT 1"
        )
        .get(templateId, workspaceId)
    : db
        .prepare("SELECT id FROM workspace_templates WHERE id = ? AND archived_at IS NULL LIMIT 1")
        .get(templateId);
  return Boolean((row as Record<string, unknown> | undefined)?.id);
}

function templateRowExists(templateId: string, workspaceId?: string | null): boolean {
  const db = getDb();
  const row = workspaceId
    ? db
        .prepare("SELECT id FROM workspace_templates WHERE id = ? AND workspace_id = ? LIMIT 1")
        .get(templateId, workspaceId)
    : db
        .prepare("SELECT id FROM workspace_templates WHERE id = ? LIMIT 1")
        .get(templateId);
  return Boolean((row as Record<string, unknown> | undefined)?.id);
}

export function inspectManagedTemplateReferenceSync(
  templateId: string,
  options?: { workspaceId?: string | null }
): ManagedTemplateReferenceInspection {
  const safeId = sanitizeTemplateId(templateId);
  if (!safeId) {
    return {
      templateId: "",
      status: "missing"
    };
  }
  if (activeTemplateExists(safeId, options?.workspaceId)) {
    return {
      templateId: safeId,
      status: "active"
    };
  }
  return {
    templateId: safeId,
    status: templateRowExists(safeId, options?.workspaceId) ? "archived" : "missing"
  };
}

export async function inspectManagedTemplateReference(
  templateId: string,
  options?: { workspaceId?: string | null }
): Promise<ManagedTemplateReferenceInspection> {
  return inspectManagedTemplateReferenceSync(templateId, options);
}

function getTemplateRowWorkspaceId(templateId: string): string | null {
  const db = getDb();
  const row = db
    .prepare("SELECT workspace_id FROM workspace_templates WHERE id = ? LIMIT 1")
    .get(templateId) as Record<string, unknown> | undefined;
  return typeof row?.workspace_id === "string" ? row.workspace_id : null;
}

function resolveWorkspaceScopedTemplateId(preferredId: string, workspaceId: string): string {
  const baseId = sanitizeTemplateId(preferredId) || `template-${sanitizeTemplateId(workspaceId).slice(0, 8)}`;
  const ownerWorkspaceId = getTemplateRowWorkspaceId(baseId);
  if (!ownerWorkspaceId || ownerWorkspaceId === workspaceId) {
    return baseId;
  }

  const suffixBase = `${baseId}-${sanitizeTemplateId(workspaceId).slice(0, 8) || "workspace"}`;
  let candidate = suffixBase;
  let suffix = 2;
  while (true) {
    const candidateOwnerWorkspaceId = getTemplateRowWorkspaceId(candidate);
    if (!candidateOwnerWorkspaceId || candidateOwnerWorkspaceId === workspaceId) {
      return candidate;
    }
    candidate = `${suffixBase}-${suffix}`;
    suffix += 1;
  }
}

function deterministicPresetTemplateId(workspaceId: string, layoutFamily: string): string {
  return `wtpl-${workspaceId.slice(0, 10)}-${sanitizeTemplateId(layoutFamily)}`;
}

function createPresetTemplateRecord(params: {
  workspaceId: string;
  layoutFamily: string;
  id?: string;
  createdAt?: string;
  updatedAt?: string;
}): ManagedTemplate {
  const layoutFamily = resolveLayoutFamily(params.layoutFamily);
  const snapshot = buildSeedSnapshot(layoutFamily);
  const stamp = params.updatedAt ?? params.createdAt ?? nowIso();
  return buildManagedTemplateFromSnapshot({
    id: params.id ?? deterministicPresetTemplateId(params.workspaceId, layoutFamily),
    workspaceId: params.workspaceId,
    createdAt: params.createdAt ?? stamp,
    updatedAt: stamp,
    snapshot
  });
}

function insertPresetTemplateIfMissing(workspaceId: string, layoutFamily: string): ManagedTemplate {
  const id = resolveWorkspaceScopedTemplateId(
    deterministicPresetTemplateId(workspaceId, layoutFamily),
    workspaceId
  );
  const existing = readManagedTemplateSync(id, { workspaceId, skipEnsure: true });
  if (existing && existing.archivedAt === null) {
    return existing;
  }
  const template = createPresetTemplateRecord({ workspaceId, layoutFamily, id });
  insertOrUpdateTemplateRow(template);
  return template;
}

function findOldestActiveTemplateId(workspaceId: string, excludeTemplateId?: string | null): string | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id
       FROM workspace_templates
       WHERE workspace_id = ?
         AND archived_at IS NULL
         AND (? IS NULL OR id != ?)
       ORDER BY created_at ASC, id ASC
       LIMIT 1`
    )
    .get(workspaceId, excludeTemplateId ?? null, excludeTemplateId ?? null) as
    | Record<string, unknown>
    | undefined;
  return typeof row?.id === "string" ? row.id : null;
}

function importLegacyCustomTemplatesForWorkspace(workspaceId: string, legacyTemplates: ManagedTemplate[]): void {
  for (const template of legacyTemplates) {
    if (template.workspaceId !== workspaceId) {
      continue;
    }
    if (SUPPORTED_LAYOUT_FAMILIES.has(template.id) && !template.creatorUserId) {
      continue;
    }
    const importId = resolveWorkspaceScopedTemplateId(template.id, workspaceId);
    if (templateRowExists(importId, workspaceId)) {
      continue;
    }
    insertOrUpdateTemplateRow({
      ...template,
      id: importId,
      workspaceId,
      creatorUserId: null,
      creatorDisplayName: null,
      archivedAt: null,
      versions: []
    });
  }
}

function migrateLegacyChannelTemplateRefs(workspaceId: string, legacyTemplates: ManagedTemplate[]): void {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT DISTINCT template_id
       FROM channels
       WHERE workspace_id = ?
         AND archived_at IS NULL
         AND template_id IS NOT NULL
         AND trim(template_id) != ''`
    )
    .all(workspaceId) as Array<{ template_id?: string }>;
  const legacyById = new Map(legacyTemplates.map((template) => [template.id, template]));

  for (const row of rows) {
    const legacyTemplateId = String(row.template_id ?? "").trim();
    if (!legacyTemplateId || activeTemplateExists(legacyTemplateId, workspaceId)) {
      continue;
    }

    const legacyTemplate = legacyById.get(legacyTemplateId);
    if (legacyTemplate?.workspaceId === workspaceId) {
      const importId = resolveWorkspaceScopedTemplateId(legacyTemplate.id, workspaceId);
      if (!templateRowExists(importId, workspaceId)) {
        insertOrUpdateTemplateRow({
          ...legacyTemplate,
          id: importId,
          workspaceId,
          creatorUserId: null,
          creatorDisplayName: null,
          archivedAt: null,
          versions: []
        });
      }
      if (importId !== legacyTemplateId) {
        db.prepare(
          `UPDATE channels
           SET template_id = ?, updated_at = ?
           WHERE workspace_id = ? AND template_id = ?`
        ).run(importId, nowIso(), workspaceId, legacyTemplateId);
      }
      continue;
    }

    if (SUPPORTED_LAYOUT_FAMILIES.has(legacyTemplateId)) {
      const workspaceTemplate = insertPresetTemplateIfMissing(workspaceId, legacyTemplateId);
      db.prepare(
        `UPDATE channels
         SET template_id = ?, updated_at = ?
         WHERE workspace_id = ? AND template_id = ?`
      ).run(workspaceTemplate.id, nowIso(), workspaceId, legacyTemplateId);
    }
  }
}

function ensureWorkspaceDefaultTemplate(workspaceId: string): string {
  const db = getDb();
  const workspaceRow = db
    .prepare("SELECT default_template_id FROM workspaces WHERE id = ? LIMIT 1")
    .get(workspaceId) as { default_template_id?: unknown } | undefined;
  let defaultTemplateId =
    typeof workspaceRow?.default_template_id === "string" ? workspaceRow.default_template_id.trim() : "";

  if (defaultTemplateId && activeTemplateExists(defaultTemplateId, workspaceId)) {
    return defaultTemplateId;
  }

  let fallbackTemplateId = findOldestActiveTemplateId(workspaceId);
  if (!fallbackTemplateId) {
    fallbackTemplateId = insertPresetTemplateIfMissing(workspaceId, STAGE3_TEMPLATE_ID).id;
  }

  db.prepare("UPDATE workspaces SET default_template_id = ?, updated_at = ? WHERE id = ?").run(
    fallbackTemplateId,
    nowIso(),
    workspaceId
  );
  return fallbackTemplateId;
}

function repairBrokenChannelTemplateRefs(workspaceId: string, fallbackTemplateId: string): number {
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE channels
       SET template_id = ?, updated_at = ?
       WHERE workspace_id = ?
         AND archived_at IS NULL
         AND (
           template_id IS NULL
           OR trim(template_id) = ''
           OR template_id NOT IN (
             SELECT id FROM workspace_templates
             WHERE workspace_id = ? AND archived_at IS NULL
           )
         )`
    )
    .run(fallbackTemplateId, nowIso(), workspaceId, workspaceId);
  return Number(result.changes ?? 0);
}

function templateHighlightConfigMatchesSeedExceptEnabled(template: ManagedTemplate): boolean {
  const seedHighlights = cloneStage3TemplateConfig(getTemplateById(template.layoutFamily)).highlights;
  const currentHighlights = template.templateConfig.highlights;

  if (
    currentHighlights.enabled ||
    currentHighlights.topEnabled !== seedHighlights.topEnabled ||
    currentHighlights.bottomEnabled !== seedHighlights.bottomEnabled ||
    currentHighlights.slots.length !== seedHighlights.slots.length
  ) {
    return false;
  }

  return currentHighlights.slots.every((slot, index) => {
    const seedSlot = seedHighlights.slots[index];
    return (
      slot.slotId === seedSlot.slotId &&
      slot.enabled === seedSlot.enabled &&
      slot.color === seedSlot.color &&
      slot.label === seedSlot.label &&
      slot.guidance === seedSlot.guidance
    );
  });
}

function migrateWorkspaceTemplateHighlightDefaults(workspaceId: string): number {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT *
       FROM workspace_templates
       WHERE workspace_id = ? AND archived_at IS NULL`
    )
    .all(workspaceId) as Record<string, unknown>[];
  let migrated = 0;

  for (const row of rows) {
    const template = mapTemplateRow(row);
    if (!templateHighlightConfigMatchesSeedExceptEnabled(template)) {
      continue;
    }

    insertOrUpdateTemplateRow({
      ...template,
      updatedAt: nowIso(),
      templateConfig: {
        ...template.templateConfig,
        highlights: {
          ...template.templateConfig.highlights,
          enabled: true
        }
      }
    });
    migrated += 1;
  }

  return migrated;
}

function ensureWorkspaceTemplateLibrarySync(workspaceId: string): string {
  resetManagedTemplateStoreCachesIfScopeChanged();
  const legacyTemplates = readLegacyTemplateSources();
  const legacyRevision = legacyTemplateSourceCache?.revision ?? 0;
  if (workspaceTemplateBootstrapRevisions.get(workspaceId) !== legacyRevision) {
    importLegacyCustomTemplatesForWorkspace(workspaceId, legacyTemplates);
    workspaceTemplateBootstrapRevisions.set(workspaceId, legacyRevision);
  }
  migrateLegacyChannelTemplateRefs(workspaceId, legacyTemplates);
  migrateWorkspaceTemplateHighlightDefaults(workspaceId);
  const defaultTemplateId = ensureWorkspaceDefaultTemplate(workspaceId);
  repairBrokenChannelTemplateRefs(workspaceId, defaultTemplateId);
  return defaultTemplateId;
}

export function ensureWorkspaceTemplateLibrariesInitializedSync(workspaceId?: string | null): string | null {
  const ids = workspaceId?.trim() ? [workspaceId.trim()] : workspaceIds();
  let firstDefault: string | null = null;
  for (const id of ids) {
    const defaultId = ensureWorkspaceTemplateLibrarySync(id);
    if (!firstDefault) {
      firstDefault = defaultId;
    }
  }
  return firstDefault;
}

export async function ensureWorkspaceTemplateLibrary(workspaceId?: string | null): Promise<string | null> {
  return ensureWorkspaceTemplateLibrariesInitializedSync(workspaceId);
}

export function getWorkspaceDefaultTemplateIdSync(workspaceId?: string | null): string {
  const resolvedWorkspaceId = resolveWorkspaceId(workspaceId);
  return ensureWorkspaceTemplateLibrarySync(resolvedWorkspaceId);
}

export async function getWorkspaceDefaultTemplateId(workspaceId?: string | null): Promise<string> {
  return getWorkspaceDefaultTemplateIdSync(workspaceId);
}

export function listManagedTemplatesSync(workspaceId?: string | null): ManagedTemplate[] {
  const resolvedWorkspaceId = resolveWorkspaceId(workspaceId);
  ensureWorkspaceTemplateLibrarySync(resolvedWorkspaceId);
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT *
       FROM workspace_templates
       WHERE workspace_id = ? AND archived_at IS NULL
       ORDER BY updated_at DESC, created_at DESC`
    )
    .all(resolvedWorkspaceId) as Record<string, unknown>[];
  return rows.map(mapTemplateRow);
}

export async function listManagedTemplates(workspaceId?: string | null): Promise<ManagedTemplate[]> {
  return listManagedTemplatesSync(workspaceId);
}

export function listManagedTemplateSummariesSync(workspaceId?: string | null): ManagedTemplateSummary[] {
  return listManagedTemplatesSync(workspaceId).map(toManagedTemplateSummary);
}

export async function listManagedTemplateSummaries(
  workspaceId?: string | null
): Promise<ManagedTemplateSummary[]> {
  return listManagedTemplateSummariesSync(workspaceId);
}

export function readManagedTemplateSync(
  templateId: string,
  options?: { workspaceId?: string | null; skipEnsure?: boolean }
): ManagedTemplate | null {
  const safeId = sanitizeTemplateId(templateId);
  if (!safeId) {
    return null;
  }
  if (!options?.skipEnsure) {
    ensureWorkspaceTemplateLibrariesInitializedSync(options?.workspaceId);
  }
  const db = getDb();
  const row = options?.workspaceId
    ? db
        .prepare(
          "SELECT * FROM workspace_templates WHERE id = ? AND workspace_id = ? AND archived_at IS NULL LIMIT 1"
        )
        .get(safeId, options.workspaceId)
    : db
        .prepare("SELECT * FROM workspace_templates WHERE id = ? AND archived_at IS NULL LIMIT 1")
        .get(safeId);
  return row ? mapTemplateRow(row as Record<string, unknown>) : null;
}

export async function readManagedTemplate(
  templateId: string,
  options?: { workspaceId?: string | null }
): Promise<ManagedTemplate | null> {
  return readManagedTemplateSync(templateId, options);
}

function resolveDefaultTemplateSync(workspaceId?: string | null): ManagedTemplate | null {
  const workspaceIdsToTry = workspaceId?.trim() ? [workspaceId.trim()] : workspaceIds();
  for (const id of workspaceIdsToTry) {
    const defaultTemplateId = ensureWorkspaceTemplateLibrarySync(id);
    const template = readManagedTemplateSync(defaultTemplateId, {
      workspaceId: id,
      skipEnsure: true
    });
    if (template) {
      return template;
    }
  }
  return null;
}

export function resolveManagedTemplateSync(
  templateId: string | null | undefined,
  options?: { workspaceId?: string | null }
): ManagedTemplate | null {
  const candidate = typeof templateId === "string" && templateId.trim() ? templateId.trim() : "";
  if (candidate) {
    if (SUPPORTED_LAYOUT_FAMILIES.has(candidate)) {
      const workspaceId = options?.workspaceId?.trim();
      if (workspaceId) {
        ensureWorkspaceTemplateLibrarySync(workspaceId);
        return insertPresetTemplateIfMissing(workspaceId, candidate);
      }
      return buildDetachedPresetTemplate(candidate, options?.workspaceId ?? "detached-workspace");
    }
    const direct = readManagedTemplateSync(candidate, options);
    if (direct) {
      return direct;
    }
    return resolveDefaultTemplateSync(options?.workspaceId);
  }
  return resolveDefaultTemplateSync(options?.workspaceId);
}

export async function resolveManagedTemplate(
  templateId: string | null | undefined,
  options?: { workspaceId?: string | null }
): Promise<ManagedTemplate | null> {
  return resolveManagedTemplateSync(templateId, options);
}

export async function createManagedTemplate(
  input: ManagedTemplateInput,
  meta: ManagedTemplateCreateMeta
): Promise<ManagedTemplate> {
  const workspaceId = resolveWorkspaceId(meta.workspaceId);
  ensureWorkspaceTemplateLibrarySync(workspaceId);
  const snapshot = normalizeSnapshot(input);
  const now = nowIso();
  const template = buildManagedTemplateFromSnapshot({
    id: `${slugify(snapshot.name)}-${newId().slice(0, 8)}`,
    workspaceId,
    createdAt: now,
    updatedAt: now,
    snapshot
  });
  insertOrUpdateTemplateRow(template);
  ensureWorkspaceDefaultTemplate(workspaceId);
  return template;
}

export async function updateManagedTemplate(
  templateId: string,
  input: ManagedTemplateInput,
  options?: { workspaceId?: string | null }
): Promise<ManagedTemplate | null> {
  const existing = readManagedTemplateSync(templateId, options);
  if (!existing) {
    return null;
  }
  const snapshot = normalizeSnapshot(input, existing);
  const updated = buildManagedTemplateFromSnapshot({
    id: existing.id,
    workspaceId: existing.workspaceId,
    createdAt: existing.createdAt,
    updatedAt: nowIso(),
    snapshot
  });
  insertOrUpdateTemplateRow(updated);
  return updated;
}

export async function createManagedTemplateVersion(): Promise<ManagedTemplate | null> {
  return null;
}

export async function restoreManagedTemplateVersion(): Promise<ManagedTemplate | null> {
  return null;
}

export function deleteManagedTemplateDetailedSync(
  templateId: string,
  options?: { workspaceId?: string | null }
): ManagedTemplateDeleteResult {
  const inspection = inspectManagedTemplateReferenceSync(templateId, options);
  if (inspection.status === "archived") {
    return { deleted: false, fallbackTemplateId: null, reassignedChannels: 0, reason: "already_archived" };
  }
  if (inspection.status === "missing") {
    return { deleted: false, fallbackTemplateId: null, reassignedChannels: 0, reason: "not_found" };
  }
  const template = readManagedTemplateSync(templateId, options);
  if (!template) {
    return { deleted: false, fallbackTemplateId: null, reassignedChannels: 0, reason: "not_found" };
  }
  const workspaceId = template.workspaceId;
  const activeCount = Number(
    (
      getDb()
        .prepare(
          "SELECT COUNT(*) as count FROM workspace_templates WHERE workspace_id = ? AND archived_at IS NULL"
        )
        .get(workspaceId) as Record<string, unknown> | undefined
    )?.count ?? 0
  );
  if (activeCount <= 1) {
    return { deleted: false, fallbackTemplateId: null, reassignedChannels: 0, reason: "last_template" };
  }

  return runInTransaction((db) => {
    const now = nowIso();
    const currentDefault = (
      db.prepare("SELECT default_template_id FROM workspaces WHERE id = ? LIMIT 1").get(workspaceId) as
        | Record<string, unknown>
        | undefined
    )?.default_template_id;
    const nextDefault =
      currentDefault === template.id
        ? findOldestActiveTemplateId(workspaceId, template.id)
        : typeof currentDefault === "string" && activeTemplateExists(currentDefault, workspaceId)
          ? currentDefault
          : findOldestActiveTemplateId(workspaceId, template.id);

    if (!nextDefault) {
      return { deleted: false, fallbackTemplateId: null, reassignedChannels: 0, reason: "last_template" };
    }

    db.prepare("UPDATE workspace_templates SET archived_at = ?, updated_at = ? WHERE id = ?").run(
      now,
      now,
      template.id
    );
    db.prepare("UPDATE workspaces SET default_template_id = ?, updated_at = ? WHERE id = ?").run(
      nextDefault,
      now,
      workspaceId
    );
    const reassigned = db
      .prepare(
        `UPDATE channels
         SET template_id = ?, updated_at = ?
         WHERE workspace_id = ? AND template_id = ?`
      )
      .run(nextDefault, now, workspaceId, template.id);
    return {
      deleted: true,
      fallbackTemplateId: nextDefault,
      reassignedChannels: Number(reassigned.changes ?? 0)
    };
  });
}

export async function deleteManagedTemplateDetailed(
  templateId: string,
  options?: { workspaceId?: string | null }
): Promise<ManagedTemplateDeleteResult> {
  return deleteManagedTemplateDetailedSync(templateId, options);
}

export async function deleteManagedTemplate(
  templateId: string,
  options?: { workspaceId?: string | null }
): Promise<boolean> {
  return deleteManagedTemplateDetailedSync(templateId, options).deleted;
}

export function deleteManagedTemplateSync(
  templateId: string,
  options?: { workspaceId?: string | null }
): boolean {
  return deleteManagedTemplateDetailedSync(templateId, options).deleted;
}

export function isSystemManagedTemplate(_template?: unknown): boolean {
  return false;
}
