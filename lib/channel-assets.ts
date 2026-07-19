import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { ChannelAssetKind } from "./chat-history";
import { getAppDataDir } from "./app-paths";

const CHANNEL_ASSETS_ROOT = path.join(getAppDataDir(), "channel-assets");

function sanitizeId(raw: string): string | null {
  const value = raw.trim();
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(value)) {
    return null;
  }
  return value;
}

function extFromMime(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized === "image/jpeg") return ".jpg";
  if (normalized === "image/png") return ".png";
  if (normalized === "image/webp") return ".webp";
  if (normalized === "image/gif") return ".gif";
  if (normalized === "image/heic") return ".heic";
  if (normalized === "video/mp4") return ".mp4";
  if (normalized === "video/webm") return ".webm";
  if (normalized === "video/quicktime") return ".mov";
  if (normalized === "audio/mpeg") return ".mp3";
  if (normalized === "audio/wav") return ".wav";
  if (normalized === "audio/x-wav") return ".wav";
  if (normalized === "audio/mp4") return ".m4a";
  if (normalized === "audio/aac") return ".aac";
  if (normalized === "audio/webm") return ".webm";
  if (normalized === "audio/ogg") return ".ogg";
  return ".bin";
}

export function validateChannelAssetMime(kind: ChannelAssetKind, mimeTypeRaw: string): boolean {
  const mimeType = mimeTypeRaw.trim().toLowerCase();
  if (!mimeType) {
    return false;
  }
  if (kind === "avatar") {
    return mimeType.startsWith("image/");
  }
  if (kind === "background") {
    return mimeType.startsWith("image/") || mimeType.startsWith("video/");
  }
  if (kind === "music") {
    return mimeType.startsWith("audio/");
  }
  return false;
}

function safeJoinChannelRoot(channelIdRaw: string): string {
  const channelId = sanitizeId(channelIdRaw);
  if (!channelId) {
    throw new Error("Invalid channel id.");
  }
  return path.join(CHANNEL_ASSETS_ROOT, channelId);
}

function safeFileName(raw: string): string {
  const fileName = raw.trim();
  if (!fileName || fileName.includes("/") || fileName.includes("\\")) {
    throw new Error("Invalid file name.");
  }
  return fileName;
}

export async function saveChannelAssetFile(params: {
  channelId: string;
  assetId: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<{ fileName: string; filePath: string }> {
  const channelRoot = safeJoinChannelRoot(params.channelId);
  const assetId = sanitizeId(params.assetId);
  if (!assetId) {
    throw new Error("Invalid asset id.");
  }
  const ext = extFromMime(params.mimeType.trim().toLowerCase());
  const fileName = `${assetId}${ext}`;
  await fs.mkdir(channelRoot, { recursive: true });
  const filePath = path.join(channelRoot, fileName);
  await fs.writeFile(filePath, params.buffer);
  return { fileName, filePath };
}

export async function readChannelAssetFile(params: {
  channelId: string;
  fileName: string;
}): Promise<{ filePath: string; buffer: Buffer } | null> {
  const channelRoot = safeJoinChannelRoot(params.channelId);
  const fileName = safeFileName(params.fileName);
  const filePath = path.join(channelRoot, fileName);
  const buffer = await fs.readFile(filePath).catch(() => null);
  if (!buffer) {
    return null;
  }
  return { filePath, buffer };
}

export async function resolveChannelAssetFile(params: {
  channelId: string;
  fileName: string;
}): Promise<{ filePath: string; size: number } | null> {
  const channelRoot = safeJoinChannelRoot(params.channelId);
  const fileName = safeFileName(params.fileName);
  const filePath = path.join(channelRoot, fileName);
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) {
    return null;
  }
  return { filePath, size: stat.size };
}

export async function deleteChannelAssetFile(params: {
  channelId: string;
  fileName: string;
}): Promise<void> {
  const channelRoot = safeJoinChannelRoot(params.channelId);
  const fileName = safeFileName(params.fileName);
  await fs.rm(path.join(channelRoot, fileName), { force: true }).catch(() => undefined);
}

export async function deleteChannelAssetDir(channelId: string): Promise<void> {
  const channelRoot = safeJoinChannelRoot(channelId);
  await fs.rm(channelRoot, { recursive: true, force: true }).catch(() => undefined);
}

export function buildChannelAssetUrl(channelId: string, assetId: string): string {
  return `/api/channels/${channelId}/assets/${assetId}`;
}

export type ChannelAssetBufferInspection = {
  sizeBytes: number;
  sha256: string;
  signatureMimeType: string | null;
  imageDimensions: { width: number; height: number } | null;
};

export function inspectChannelAssetBuffer(buffer: Buffer): ChannelAssetBufferInspection {
  const isPng =
    buffer.length >= 24 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
    buffer.subarray(12, 16).toString("ascii") === "IHDR";
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isGif =
    buffer.length >= 10 &&
    (buffer.subarray(0, 6).toString("ascii") === "GIF87a" ||
      buffer.subarray(0, 6).toString("ascii") === "GIF89a");
  const isWebp =
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP";

  const signatureMimeType = isPng
    ? "image/png"
    : isJpeg
      ? "image/jpeg"
      : isGif
        ? "image/gif"
        : isWebp
          ? "image/webp"
          : null;
  const imageDimensions = isPng
    ? {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20)
      }
    : isGif
      ? {
          width: buffer.readUInt16LE(6),
          height: buffer.readUInt16LE(8)
        }
      : null;

  return {
    sizeBytes: buffer.byteLength,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    signatureMimeType,
    imageDimensions:
      imageDimensions && imageDimensions.width > 0 && imageDimensions.height > 0
        ? imageDimensions
        : null
  };
}
