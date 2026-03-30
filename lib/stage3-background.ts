import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getAppDataDir } from "./app-paths";

const MAX_ASSET_AGE_MS = 1000 * 60 * 60 * 24 * 7;

export type Stage3BackgroundKind = "image" | "video";

export type Stage3BackgroundAsset = {
  id: string;
  fileName: string;
  mimeType: string;
  kind: Stage3BackgroundKind;
  sizeBytes: number;
  createdAt: string;
  filePath: string;
};

function sanitizeAssetId(raw: string): string | null {
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
  if (normalized === "video/mp4") return ".mp4";
  if (normalized === "video/quicktime") return ".mov";
  if (normalized === "video/webm") return ".webm";
  return ".bin";
}

function detectKind(mimeType: string): Stage3BackgroundKind | null {
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (mimeType.startsWith("video/")) {
    return "video";
  }
  return null;
}

function primaryBackgroundRoot(): string {
  return path.join(getAppDataDir(), "stage3-backgrounds");
}

function legacyBackgroundRoot(): string {
  return path.join(os.tmpdir(), "clip-stage3-backgrounds");
}

function listBackgroundRoots(): string[] {
  const roots = [primaryBackgroundRoot(), legacyBackgroundRoot()];
  return Array.from(new Set(roots));
}

async function pruneOldAssetsInRoot(rootPath: string): Promise<void> {
  const entries = await fs.readdir(rootPath).catch(() => []);
  if (!entries.length) {
    return;
  }
  const now = Date.now();
  await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(rootPath, entry);
      const stat = await fs.stat(full).catch(() => null);
      if (!stat) {
        return;
      }
      if (now - stat.mtimeMs <= MAX_ASSET_AGE_MS) {
        return;
      }
      await fs.rm(full, { force: true }).catch(() => undefined);
    })
  );
}

async function pruneOldAssets(): Promise<void> {
  await Promise.all(listBackgroundRoots().map((rootPath) => pruneOldAssetsInRoot(rootPath)));
}

export async function saveStage3BackgroundAsset(params: {
  buffer: Buffer;
  mimeType: string;
  originalName?: string | null;
}): Promise<Omit<Stage3BackgroundAsset, "filePath">> {
  const mimeType = params.mimeType.trim().toLowerCase();
  const kind = detectKind(mimeType);
  if (!kind) {
    throw new Error("Поддерживаются только image/* и video/* файлы.");
  }

  const rootPath = primaryBackgroundRoot();
  await fs.mkdir(rootPath, { recursive: true });
  await pruneOldAssets().catch(() => undefined);

  const id = randomUUID().replace(/-/g, "");
  const ext = extFromMime(mimeType);
  const fileName = `${id}${ext}`;
  const filePath = path.join(rootPath, fileName);
  const createdAt = new Date().toISOString();
  const metaPath = path.join(rootPath, `${id}.json`);

  await fs.writeFile(filePath, params.buffer);
  await fs.writeFile(
    metaPath,
    JSON.stringify(
      {
        id,
        fileName,
        mimeType,
        kind,
        sizeBytes: params.buffer.length,
        createdAt
      },
      null,
      2
    ),
    "utf-8"
  );

  return {
    id,
    fileName,
    mimeType,
    kind,
    sizeBytes: params.buffer.length,
    createdAt
  };
}

async function readStage3BackgroundMeta(
  rootPath: string,
  id: string
): Promise<{
  meta: {
    fileName?: string;
    mimeType?: string;
    kind?: Stage3BackgroundKind;
    sizeBytes?: number;
    createdAt?: string;
  } | null;
} | null> {
  const metaPath = path.join(rootPath, `${id}.json`);
  const rawMeta = await fs.readFile(metaPath, "utf-8").catch(() => null);
  if (!rawMeta) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawMeta) as {
      fileName?: string;
      mimeType?: string;
      kind?: Stage3BackgroundKind;
      sizeBytes?: number;
      createdAt?: string;
    };
    return { meta: parsed };
  } catch {
    return null;
  }
}

export async function readStage3BackgroundAsset(idRaw: string): Promise<Stage3BackgroundAsset | null> {
  const id = sanitizeAssetId(idRaw);
  if (!id) {
    return null;
  }

  for (const rootPath of listBackgroundRoots()) {
    const resolved = await readStage3BackgroundMeta(rootPath, id);
    if (!resolved) {
      continue;
    }

    const parsed = resolved.meta;
    const fileName = parsed?.fileName ?? "";
    if (!fileName || fileName.includes("/") || fileName.includes("\\")) {
      continue;
    }
    const filePath = path.join(rootPath, fileName);
    const exists = await fs.access(filePath).then(() => true).catch(() => false);
    if (!exists) {
      continue;
    }

    const kind =
      parsed?.kind === "image" || parsed?.kind === "video" ? parsed.kind : detectKind(parsed?.mimeType ?? "");
    if (!kind) {
      continue;
    }

    return {
      id,
      fileName,
      mimeType: parsed?.mimeType ?? "application/octet-stream",
      kind,
      sizeBytes: typeof parsed?.sizeBytes === "number" ? parsed.sizeBytes : 0,
      createdAt: parsed?.createdAt ?? new Date(0).toISOString(),
      filePath
    };
  }

  return null;
}

export function buildStage3BackgroundUrl(id: string): string {
  return `/api/stage3/background/${id}`;
}
