import type {
  Stage3TemplateConfig,
  Stage3TemplateFontAsset
} from "./stage3-template";

export type Stage3TemplateFontSlot = "top" | "bottom";

const SAFE_ASSET_ID_PATTERN = /^[a-zA-Z0-9_-]{8,100}$/;
const SAFE_FONT_URL_PREFIXES = [
  "/api/design/template-assets/",
  "/stage3-assets/",
  "stage3-assets/"
] as const;

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

  return {
    id,
    family,
    url,
    originalName,
    mimeType,
    sizeBytes,
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

export function buildStage3TemplateFontFaceCss(
  templateConfig: Pick<Stage3TemplateConfig, "typography">
): string {
  return collectStage3TemplateFontAssets(templateConfig)
    .map((asset) => {
      const family = quoteStage3TemplateFontFamily(asset.family);
      const url = escapeCssString(asset.url);
      const format = resolveFontFormat(asset);
      const formatSuffix = format ? ` format("${format}")` : "";
      return `@font-face{font-family:${family};src:url("${url}")${formatSuffix};font-display:swap;}`;
    })
    .join("\n");
}
