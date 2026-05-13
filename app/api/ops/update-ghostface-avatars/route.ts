import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  createChannelAsset,
  getChannelAssetById,
  getChannelById,
  listChannels,
  updateChannelById
} from "../../../../lib/chat-history";
import { readChannelAssetFile, saveChannelAssetFile } from "../../../../lib/channel-assets";

export const runtime = "nodejs";

const TARGETS = [
  {
    name: "GHOSTFACE COUNTRY",
    username: "ghostfacecountry",
    sourceFile: "public/ops/ghostface-country-avatar-v2.jpg",
    originalName: "ghostface-country-avatar-v2.jpg",
    referenceChannel: "Ghost Face Facts",
    referenceUrl: "https://www.youtube.com/@GhostFaceFacts"
  },
  {
    name: "GHOSTFACE WORKSHOP",
    username: "ghostfaceworkshop",
    sourceFile: "public/ops/ghostface-workshop-avatar-v2.jpg",
    originalName: "ghostface-workshop-avatar-v2.jpg",
    referenceChannel: "Ghost Face Science",
    referenceUrl: "https://www.youtube.com/@GhostFaceScience"
  }
] as const;

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function loadSource(target: (typeof TARGETS)[number]): Promise<{
  buffer: Buffer;
  hash: string;
  sizeBytes: number;
}> {
  const buffer = await fs.readFile(path.join(process.cwd(), target.sourceFile));
  return {
    buffer,
    hash: sha256(buffer),
    sizeBytes: buffer.byteLength
  };
}

async function inspectTarget(target: (typeof TARGETS)[number], apply: boolean): Promise<Record<string, unknown>> {
  const channels = await listChannels();
  const channel = channels.find((item) => item.username === target.username);
  const source = await loadSource(target);

  if (!channel) {
    return {
      name: target.name,
      username: target.username,
      found: false,
      updated: false,
      avatarMatches: false,
      expectedSha256: source.hash,
      sourceSizeBytes: source.sizeBytes
    };
  }

  let nextAvatarAssetId = channel.avatarAssetId;
  if (apply) {
    const assetId = randomBytes(16).toString("hex");
    const saved = await saveChannelAssetFile({
      channelId: channel.id,
      assetId,
      mimeType: "image/jpeg",
      buffer: source.buffer
    });
    const asset = await createChannelAsset({
      channelId: channel.id,
      kind: "avatar",
      assetId,
      fileName: saved.fileName,
      originalName: target.originalName,
      mimeType: "image/jpeg",
      sizeBytes: source.sizeBytes
    });
    await updateChannelById(channel.id, { avatarAssetId: asset.id });
    nextAvatarAssetId = asset.id;
  }

  const refreshed = await getChannelById(channel.id);
  const activeAvatarAssetId = refreshed?.avatarAssetId ?? nextAvatarAssetId;
  const activeAsset = activeAvatarAssetId
    ? await getChannelAssetById(channel.id, activeAvatarAssetId)
    : null;
  const activeFile = activeAsset
    ? await readChannelAssetFile({
        channelId: channel.id,
        fileName: activeAsset.fileName
      })
    : null;
  const activeHash = activeFile ? sha256(activeFile.buffer) : null;

  return {
    id: channel.id,
    name: channel.name,
    username: channel.username,
    found: true,
    updated: apply,
    referenceChannel: target.referenceChannel,
    referenceUrl: target.referenceUrl,
    expectedSha256: source.hash,
    sourceSizeBytes: source.sizeBytes,
    activeAvatarAssetId,
    activeAvatarOriginalName: activeAsset?.originalName ?? null,
    activeAvatarMimeType: activeAsset?.mimeType ?? null,
    activeAvatarSizeBytes: activeAsset?.sizeBytes ?? null,
    activeSha256: activeHash,
    avatarMatches: activeHash === source.hash
  };
}

async function handle(apply: boolean): Promise<Response> {
  try {
    const channels = [];
    for (const target of TARGETS) {
      channels.push(await inspectTarget(target, apply));
    }

    const ok = channels.every((channel) => channel.found === true && channel.avatarMatches === true);
    return NextResponse.json(
      {
        ok,
        applied: apply,
        channels
      },
      { status: ok || !apply ? 200 : 500 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        applied: apply,
        error: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}

export async function GET(): Promise<Response> {
  return handle(false);
}

export async function POST(): Promise<Response> {
  return handle(true);
}
