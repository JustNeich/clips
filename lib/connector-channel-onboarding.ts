import type { ChannelPublishIntegrationOption } from "../app/components/types";
import { deleteChannelAssetFile, inspectChannelAssetBuffer, saveChannelAssetFile } from "./channel-assets";
import { createChannelAsset, getChannelById } from "./chat-history";
import { newId } from "./db/client";

const MAX_CONNECTOR_AVATAR_BYTES = 5 * 1024 * 1024;
const SUPPORTED_AVATAR_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp"
]);

export type ConnectorChannelIdentity = {
  name: string;
  username: string;
  onboardingStatus: "needs_identity" | "ready";
  confirmedHandle: string | null;
};

function extractConfirmedYouTubeHandle(customUrl: string | null): string | null {
  const value = customUrl?.trim() ?? "";
  const match = value.match(/(?:^|\/)@([a-zA-Z0-9._-]{1,100})(?:\/|$)/);
  return match?.[1] ?? null;
}

function internalYoutubeSlug(youtubeChannelId: string): string {
  const suffix = youtubeChannelId.replace(/[^a-zA-Z0-9]/g, "").slice(-24) || "channel";
  return `youtube_${suffix}`;
}

export function buildConnectorChannelIdentity(
  option: ChannelPublishIntegrationOption
): ConnectorChannelIdentity {
  const title = option.title.trim();
  const confirmedHandle = extractConfirmedYouTubeHandle(option.customUrl);
  return {
    name: title || "Новый YouTube-канал",
    username: confirmedHandle || internalYoutubeSlug(option.id),
    onboardingStatus: title ? "ready" : "needs_identity",
    confirmedHandle
  };
}

function isAllowedYouTubeAvatarUrl(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    const allowed =
      url.protocol === "https:" &&
      (hostname === "i.ytimg.com" ||
        hostname === "yt3.ggpht.com" ||
        hostname.endsWith(".ggpht.com") ||
        hostname.endsWith(".googleusercontent.com"));
    return allowed ? url : null;
  } catch {
    return null;
  }
}

function normalizeImageMimeType(raw: string | null): string {
  const mimeType = raw?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mimeType === "image/jpg" ? "image/jpeg" : mimeType;
}

export async function importConnectorChannelAvatar(input: {
  channelId: string;
  thumbnailUrl: string | null | undefined;
}): Promise<{ imported: boolean; reason?: string }> {
  const thumbnailUrl = input.thumbnailUrl?.trim() ?? "";
  const requestedUrl = isAllowedYouTubeAvatarUrl(thumbnailUrl);
  if (!requestedUrl) {
    return { imported: false, reason: thumbnailUrl ? "avatar_host_not_allowed" : "avatar_missing" };
  }
  const channel = await getChannelById(input.channelId);
  if (!channel || channel.avatarAssetId) {
    return { imported: false, reason: channel ? "avatar_already_present" : "channel_missing" };
  }

  const response = await fetch(requestedUrl, {
    redirect: "follow",
    headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif" }
  });
  if (!response.ok || !isAllowedYouTubeAvatarUrl(response.url || requestedUrl.toString())) {
    return { imported: false, reason: "avatar_download_failed" };
  }
  const declaredSize = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredSize) && declaredSize > MAX_CONNECTOR_AVATAR_BYTES) {
    return { imported: false, reason: "avatar_too_large" };
  }
  const mimeType = normalizeImageMimeType(response.headers.get("content-type"));
  if (!SUPPORTED_AVATAR_MIME_TYPES.has(mimeType)) {
    return { imported: false, reason: "avatar_mime_not_allowed" };
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_CONNECTOR_AVATAR_BYTES) {
    return { imported: false, reason: "avatar_size_invalid" };
  }
  const inspection = inspectChannelAssetBuffer(buffer);
  if (!inspection.signatureMimeType || inspection.signatureMimeType !== mimeType) {
    return { imported: false, reason: "avatar_signature_invalid" };
  }

  const assetId = newId();
  const saved = await saveChannelAssetFile({
    channelId: input.channelId,
    assetId,
    mimeType,
    buffer
  });
  try {
    await createChannelAsset({
      channelId: input.channelId,
      kind: "avatar",
      fileName: saved.fileName,
      originalName: "youtube-avatar",
      mimeType,
      sizeBytes: buffer.byteLength,
      assetId
    });
  } catch (error) {
    await deleteChannelAssetFile({ channelId: input.channelId, fileName: saved.fileName });
    throw error;
  }
  return { imported: true };
}
