import { promises as fs } from "node:fs";
import path from "node:path";
import { getAppDataDir } from "./app-paths";
import { buildStage3TemplateUploadedFontFamily } from "./stage3-template-fonts";

const MANAGED_TEMPLATE_ASSETS_ROOT = path.join(getAppDataDir(), "managed-template-assets");
const MANAGED_TEMPLATE_ASSETS_FILES_ROOT = path.join(MANAGED_TEMPLATE_ASSETS_ROOT, "files");
const MANAGED_TEMPLATE_ASSETS_META_ROOT = path.join(MANAGED_TEMPLATE_ASSETS_ROOT, "meta");

export type ManagedTemplateAssetRecord = {
  id: string;
  kind: "background" | "font";
  fileName: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  workspaceId: string;
  creatorUserId: string;
  creatorDisplayName: string | null;
  createdAt: string;
  fontFamily?: string;
};

function sanitizeAssetId(raw: string): string | null {
  const value = raw.trim();
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(value)) {
    return null;
  }
  return value;
}

function safeFileName(raw: string): string {
  const value = raw.trim();
  if (!value || value.includes("/") || value.includes("\\")) {
    throw new Error("Invalid file name.");
  }
  return value;
}

function metadataPath(assetIdRaw: string): string {
  const assetId = sanitizeAssetId(assetIdRaw);
  if (!assetId) {
    throw new Error("Invalid asset id.");
  }
  return path.join(MANAGED_TEMPLATE_ASSETS_META_ROOT, `${assetId}.json`);
}

function filePath(fileNameRaw: string): string {
  return path.join(MANAGED_TEMPLATE_ASSETS_FILES_ROOT, safeFileName(fileNameRaw));
}

function extFromMime(mimeTypeRaw: string): string {
  const mimeType = mimeTypeRaw.trim().toLowerCase();
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  if (mimeType === "image/avif") return ".avif";
  if (mimeType === "image/svg+xml") return ".svg";
  return ".bin";
}

function extFromFontUpload(mimeTypeRaw: string, originalNameRaw: string): string {
  const originalExt = path.extname(originalNameRaw.trim()).toLowerCase();
  if ([".ttf", ".otf", ".woff", ".woff2"].includes(originalExt)) {
    return originalExt;
  }

  const mimeType = mimeTypeRaw.trim().toLowerCase();
  if (mimeType.includes("woff2")) return ".woff2";
  if (mimeType.includes("woff")) return ".woff";
  if (mimeType.includes("otf") || mimeType.includes("opentype")) return ".otf";
  if (mimeType.includes("ttf") || mimeType.includes("truetype")) return ".ttf";
  return ".bin";
}

export function validateManagedTemplateBackgroundMime(mimeTypeRaw: string): boolean {
  const mimeType = mimeTypeRaw.trim().toLowerCase();
  return [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
    "image/svg+xml"
  ].includes(mimeType);
}

export function validateManagedTemplateFontUpload(params: {
  mimeType: string;
  originalName: string;
}): boolean {
  const mimeType = params.mimeType.trim().toLowerCase();
  const ext = path.extname(params.originalName.trim()).toLowerCase();
  const hasFontExt = [".ttf", ".otf", ".woff", ".woff2"].includes(ext);
  const hasFontMime = [
    "font/ttf",
    "font/otf",
    "font/woff",
    "font/woff2",
    "application/font-woff",
    "application/font-woff2",
    "application/x-font-ttf",
    "application/x-font-otf",
    "application/x-font-truetype",
    "application/x-font-opentype",
    "application/vnd.ms-opentype"
  ].includes(mimeType);

  if (hasFontMime && hasFontExt) {
    return true;
  }

  return hasFontExt && (mimeType === "application/octet-stream" || mimeType === "binary/octet-stream");
}

export function buildManagedTemplateAssetUrl(assetIdRaw: string): string {
  const assetId = sanitizeAssetId(assetIdRaw);
  if (!assetId) {
    throw new Error("Invalid asset id.");
  }
  return `/api/design/template-assets/${assetId}`;
}

export async function saveManagedTemplateBackgroundAsset(params: {
  assetId: string;
  mimeType: string;
  buffer: Buffer;
  originalName: string;
  sizeBytes: number;
  workspaceId: string;
  creatorUserId: string;
  creatorDisplayName?: string | null;
}): Promise<ManagedTemplateAssetRecord> {
  const assetId = sanitizeAssetId(params.assetId);
  if (!assetId) {
    throw new Error("Invalid asset id.");
  }

  const fileName = `${assetId}${extFromMime(params.mimeType)}`;
  const record: ManagedTemplateAssetRecord = {
    id: assetId,
    kind: "background",
    fileName,
    originalName: params.originalName.trim() || "background-image",
    mimeType: params.mimeType.trim().toLowerCase(),
    sizeBytes: Math.max(0, Math.round(params.sizeBytes)),
    workspaceId: params.workspaceId,
    creatorUserId: params.creatorUserId,
    creatorDisplayName: params.creatorDisplayName?.trim() || null,
    createdAt: new Date().toISOString()
  };

  await fs.mkdir(MANAGED_TEMPLATE_ASSETS_FILES_ROOT, { recursive: true });
  await fs.mkdir(MANAGED_TEMPLATE_ASSETS_META_ROOT, { recursive: true });
  await fs.writeFile(filePath(fileName), params.buffer);
  await fs.writeFile(metadataPath(assetId), JSON.stringify(record, null, 2));
  return record;
}

export async function saveManagedTemplateFontAsset(params: {
  assetId: string;
  mimeType: string;
  buffer: Buffer;
  originalName: string;
  sizeBytes: number;
  workspaceId: string;
  creatorUserId: string;
  creatorDisplayName?: string | null;
}): Promise<ManagedTemplateAssetRecord> {
  const assetId = sanitizeAssetId(params.assetId);
  if (!assetId) {
    throw new Error("Invalid asset id.");
  }

  const fileName = `${assetId}${extFromFontUpload(params.mimeType, params.originalName)}`;
  const record: ManagedTemplateAssetRecord = {
    id: assetId,
    kind: "font",
    fileName,
    originalName: params.originalName.trim() || "uploaded-font",
    mimeType: params.mimeType.trim().toLowerCase(),
    sizeBytes: Math.max(0, Math.round(params.sizeBytes)),
    workspaceId: params.workspaceId,
    creatorUserId: params.creatorUserId,
    creatorDisplayName: params.creatorDisplayName?.trim() || null,
    createdAt: new Date().toISOString(),
    fontFamily: buildStage3TemplateUploadedFontFamily(assetId)
  };

  await fs.mkdir(MANAGED_TEMPLATE_ASSETS_FILES_ROOT, { recursive: true });
  await fs.mkdir(MANAGED_TEMPLATE_ASSETS_META_ROOT, { recursive: true });
  await fs.writeFile(filePath(fileName), params.buffer);
  await fs.writeFile(metadataPath(assetId), JSON.stringify(record, null, 2));
  return record;
}

export async function readManagedTemplateAssetRecord(
  assetIdRaw: string
): Promise<ManagedTemplateAssetRecord | null> {
  const raw = await fs.readFile(metadataPath(assetIdRaw), "utf8").catch(() => null);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ManagedTemplateAssetRecord>;
    if (
      typeof parsed?.id !== "string" ||
      typeof parsed.fileName !== "string" ||
      typeof parsed.mimeType !== "string" ||
      typeof parsed.workspaceId !== "string" ||
      typeof parsed.creatorUserId !== "string" ||
      typeof parsed.createdAt !== "string"
    ) {
      return null;
    }
    const kind = parsed.kind === "font" ? "font" : "background";
    return {
      id: parsed.id,
      kind,
      fileName: parsed.fileName,
      originalName:
        typeof parsed.originalName === "string" && parsed.originalName.trim()
          ? parsed.originalName.trim()
          : kind === "font"
            ? "uploaded-font"
            : "background-image",
      mimeType: parsed.mimeType,
      sizeBytes:
        typeof parsed.sizeBytes === "number" && Number.isFinite(parsed.sizeBytes)
          ? Math.max(0, Math.round(parsed.sizeBytes))
          : 0,
      workspaceId: parsed.workspaceId,
      creatorUserId: parsed.creatorUserId,
      creatorDisplayName:
        typeof parsed.creatorDisplayName === "string" && parsed.creatorDisplayName.trim()
          ? parsed.creatorDisplayName.trim()
          : null,
      createdAt: parsed.createdAt,
      fontFamily:
        kind === "font" && typeof parsed.fontFamily === "string" && parsed.fontFamily.trim()
          ? parsed.fontFamily.trim()
          : kind === "font"
            ? buildStage3TemplateUploadedFontFamily(parsed.id)
            : undefined
    };
  } catch {
    return null;
  }
}

export async function resolveManagedTemplateAssetFile(
  assetIdRaw: string
): Promise<{ record: ManagedTemplateAssetRecord; filePath: string; size: number } | null> {
  const record = await readManagedTemplateAssetRecord(assetIdRaw);
  if (!record) {
    return null;
  }

  const resolvedFilePath = filePath(record.fileName);
  const stat = await fs.stat(resolvedFilePath).catch(() => null);
  if (!stat?.isFile()) {
    return null;
  }

  return {
    record,
    filePath: resolvedFilePath,
    size: stat.size
  };
}
