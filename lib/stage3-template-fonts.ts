import type {
  Stage3TemplateConfig,
  Stage3TemplateFontAsset
} from "./stage3-template";

export type Stage3TemplateFontSlot = "top" | "bottom";
export type Stage3TemplateFontFaceMetadata = {
  weight: number;
  style: "normal" | "italic";
};

const SAFE_ASSET_ID_PATTERN = /^[a-zA-Z0-9_-]{8,100}$/;
const SAFE_FONT_URL_PREFIXES = [
  "/api/design/template-assets/",
  "/stage3-assets/",
  "stage3-assets/"
] as const;
const STAGE3_UPLOADED_FONT_DEFAULT_TEXT_SCALE = 1;
const STAGE3_TEMPLATE_FONT_LOAD_TIMEOUT_MS = 6000;
const STAGE3_TEMPLATE_DEFAULT_FONT_FACE_METADATA: Stage3TemplateFontFaceMetadata = {
  weight: 400,
  style: "normal"
};

const FONT_WEIGHT_NAME_TOKENS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /(?:^|[^a-z0-9])(?:hairline|thin)(?:[^a-z0-9]|$)/, weight: 100 },
  { pattern: /(?:^|[^a-z0-9])(?:extra|ultra)[^a-z0-9]*light(?:[^a-z0-9]|$)/, weight: 200 },
  { pattern: /(?:^|[^a-z0-9])light(?:[^a-z0-9]|$)/, weight: 300 },
  { pattern: /(?:^|[^a-z0-9])(?:regular|normal|book|roman)(?:[^a-z0-9]|$)/, weight: 400 },
  { pattern: /(?:^|[^a-z0-9])medium(?:[^a-z0-9]|$)/, weight: 500 },
  { pattern: /(?:^|[^a-z0-9])(?:semi|demi)[^a-z0-9]*bold(?:[^a-z0-9]|$)/, weight: 600 },
  { pattern: /(?:^|[^a-z0-9])(?:extra|ultra)[^a-z0-9]*bold(?:[^a-z0-9]|$)/, weight: 800 },
  { pattern: /(?:^|[^a-z0-9])bold(?:[^a-z0-9]|$)/, weight: 700 },
  { pattern: /(?:^|[^a-z0-9])(?:black|heavy)(?:[^a-z0-9]|$)/, weight: 900 }
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const cleaned = value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  if (!cleaned) {
    return null;
  }
  return cleaned.slice(0, maxLength);
}

function isSafeTemplateFontUrl(value: string): boolean {
  return SAFE_FONT_URL_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function normalizeStage3TemplateFontWeight(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(100, Math.min(900, Math.round(value / 50) * 50));
}

function normalizeStage3TemplateFontStyle(value: unknown): Stage3TemplateFontFaceMetadata["style"] | null {
  return value === "italic" || value === "normal" ? value : null;
}

function normalizeFontNameForInference(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\.[a-z0-9]+$/i, "")
    .toLowerCase()
    .replace(/_/g, "-");
}

function inferWeightFromFontName(value: string): number | null {
  const normalized = normalizeFontNameForInference(value);
  for (const item of FONT_WEIGHT_NAME_TOKENS) {
    if (item.pattern.test(normalized)) {
      return item.weight;
    }
  }
  return null;
}

function inferStyleFromFontName(value: string): Stage3TemplateFontFaceMetadata["style"] | null {
  return /(?:^|[^a-z0-9])(?:italic|oblique)(?:[^a-z0-9]|$)/.test(normalizeFontNameForInference(value))
    ? "italic"
    : null;
}

export function inferStage3TemplateFontFaceMetadata(input: {
  originalName?: string | null;
  weight?: unknown;
  style?: unknown;
}): Stage3TemplateFontFaceMetadata {
  const originalName = typeof input.originalName === "string" ? input.originalName : "";
  return {
    weight:
      normalizeStage3TemplateFontWeight(input.weight) ??
      inferWeightFromFontName(originalName) ??
      STAGE3_TEMPLATE_DEFAULT_FONT_FACE_METADATA.weight,
    style:
      normalizeStage3TemplateFontStyle(input.style) ??
      inferStyleFromFontName(originalName) ??
      STAGE3_TEMPLATE_DEFAULT_FONT_FACE_METADATA.style
  };
}

function escapeCssString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "");
}

function resolveFontFormat(asset: Pick<Stage3TemplateFontAsset, "mimeType" | "originalName" | "url">): string | null {
  const mimeType = asset.mimeType.trim().toLowerCase();
  const lowerName = asset.originalName.trim().toLowerCase();
  const lowerUrl = asset.url.trim().toLowerCase();
  if (mimeType.includes("woff2") || lowerName.endsWith(".woff2") || lowerUrl.endsWith(".woff2")) {
    return "woff2";
  }
  if (mimeType.includes("woff") || lowerName.endsWith(".woff") || lowerUrl.endsWith(".woff")) {
    return "woff";
  }
  if (mimeType.includes("opentype") || mimeType.includes("otf") || lowerName.endsWith(".otf") || lowerUrl.endsWith(".otf")) {
    return "opentype";
  }
  if (mimeType.includes("truetype") || mimeType.includes("ttf") || lowerName.endsWith(".ttf") || lowerUrl.endsWith(".ttf")) {
    return "truetype";
  }
  return null;
}

function resolveFontCssUrl(asset: Pick<Stage3TemplateFontAsset, "url">): string {
  const url = asset.url.trim();
  const remotionStaticBase =
    typeof window === "undefined"
      ? ""
      : ((window as typeof window & { remotion_staticBase?: string }).remotion_staticBase ?? "").trim();
  if (
    remotionStaticBase &&
    (url.startsWith("/stage3-assets/") || url.startsWith("stage3-assets/"))
  ) {
    return `${remotionStaticBase.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}`;
  }
  return url;
}

export function buildStage3TemplateUploadedFontFamily(assetIdRaw: string): string {
  const assetId = assetIdRaw.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
  return `Stage3TemplateFont_${assetId || "uploaded"}`;
}

export function quoteStage3TemplateFontFamily(family: string): string {
  return `"${escapeCssString(family)}"`;
}

export function buildStage3TemplateUploadedFontStack(
  asset: Pick<Stage3TemplateFontAsset, "family">,
  fallbackStack = "sans-serif"
): string {
  const family = asset.family.trim();
  const quotedFamily = quoteStage3TemplateFontFamily(family);
  const fallback = fallbackStack.trim() || "sans-serif";
  return fallback.includes(family) ? fallback : `${quotedFamily},${fallback}`;
}

export function normalizeStage3TemplateFontAsset(raw: unknown): Stage3TemplateFontAsset | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = readCleanString(raw.id, 100);
  const url = readCleanString(raw.url, 300);
  if (!id || !SAFE_ASSET_ID_PATTERN.test(id) || !url || !isSafeTemplateFontUrl(url)) {
    return null;
  }

  const family =
    readCleanString(raw.family, 140) ??
    buildStage3TemplateUploadedFontFamily(id);
  const originalName = readCleanString(raw.originalName, 180) ?? "uploaded-font";
  const mimeType = readCleanString(raw.mimeType, 120) ?? "application/octet-stream";
  const sizeBytes =
    typeof raw.sizeBytes === "number" && Number.isFinite(raw.sizeBytes)
      ? Math.max(0, Math.round(raw.sizeBytes))
      : 0;
  const createdAt = readCleanString(raw.createdAt, 80) ?? undefined;
  const faceMetadata = inferStage3TemplateFontFaceMetadata({
    originalName,
    weight: raw.weight,
    style: raw.style
  });

  return {
    id,
    family,
    url,
    originalName,
    mimeType,
    sizeBytes,
    weight: faceMetadata.weight,
    style: faceMetadata.style,
    createdAt
  };
}

export function collectStage3TemplateFontAssets(
  templateConfig: Pick<Stage3TemplateConfig, "typography">
): Stage3TemplateFontAsset[] {
  const assets = new Map<string, Stage3TemplateFontAsset>();
  for (const slot of ["top", "bottom"] as const) {
    const asset = normalizeStage3TemplateFontAsset(templateConfig.typography[slot].fontAsset);
    if (!asset) {
      continue;
    }
    assets.set(`${asset.family}::${asset.url}`, asset);
  }
  return [...assets.values()];
}

export function hasStage3TemplateFontAsset(
  templateConfig: Pick<Stage3TemplateConfig, "typography">,
  slot: Stage3TemplateFontSlot
): boolean {
  return Boolean(normalizeStage3TemplateFontAsset(templateConfig.typography[slot].fontAsset));
}

export function resolveStage3TemplateSlotDefaultTextScale(
  templateConfig: Pick<Stage3TemplateConfig, "typography">,
  slot: Stage3TemplateFontSlot,
  fallbackScale: number
): number {
  return hasStage3TemplateFontAsset(templateConfig, slot)
    ? STAGE3_UPLOADED_FONT_DEFAULT_TEXT_SCALE
    : fallbackScale;
}

export function resolveStage3TemplateDefaultTextScales(
  templateConfig: Pick<Stage3TemplateConfig, "typography">,
  fallbackScale: number
): { topFontScale: number; bottomFontScale: number } {
  return {
    topFontScale: resolveStage3TemplateSlotDefaultTextScale(templateConfig, "top", fallbackScale),
    bottomFontScale: resolveStage3TemplateSlotDefaultTextScale(templateConfig, "bottom", fallbackScale)
  };
}

export function buildStage3TemplateFontLoadDescriptors(
  templateConfig: Pick<Stage3TemplateConfig, "typography">
): string[] {
  return collectStage3TemplateFontAssets(templateConfig).map((asset) => {
    const face = inferStage3TemplateFontFaceMetadata(asset);
    return `${face.style} ${face.weight} 16px ${quoteStage3TemplateFontFamily(asset.family)}`;
  });
}

function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

export async function waitForStage3TemplateFonts(
  templateConfig: Pick<Stage3TemplateConfig, "typography">,
  options?: { timeoutMs?: number }
): Promise<void> {
  if (typeof document === "undefined" || !document.fonts?.load) {
    return;
  }

  const descriptors = buildStage3TemplateFontLoadDescriptors(templateConfig);
  if (descriptors.length === 0) {
    return;
  }

  const timeoutMs = options?.timeoutMs ?? STAGE3_TEMPLATE_FONT_LOAD_TIMEOUT_MS;
  const loadFonts = Promise.all(
    descriptors.map((descriptor) => document.fonts.load(descriptor).catch(() => []))
  )
    .then(() => document.fonts.ready)
    .then(() => undefined)
    .catch(() => undefined);

  await Promise.race([loadFonts, timeout(timeoutMs)]);
}

export function buildStage3TemplateFontFaceCss(
  templateConfig: Pick<Stage3TemplateConfig, "typography">
): string {
  return collectStage3TemplateFontAssets(templateConfig)
    .map((asset) => {
      const family = quoteStage3TemplateFontFamily(asset.family);
      const url = escapeCssString(resolveFontCssUrl(asset));
      const format = resolveFontFormat(asset);
      const formatSuffix = format ? ` format("${format}")` : "";
      const face = inferStage3TemplateFontFaceMetadata(asset);
      return `@font-face{font-family:${family};src:url("${url}")${formatSuffix};font-weight:${face.weight};font-style:${face.style};font-display:swap;}`;
    })
    .join("\n");
}
