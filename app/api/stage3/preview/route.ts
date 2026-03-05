import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clampClipStart,
  downloadSourceVideo,
  prepareStage3SourceClip,
  probeVideoDurationSeconds,
  sanitizeClipDuration
} from "../../../../lib/stage3-media-agent";
import { getYtDlpError, isSupportedUrl } from "../../../../lib/ytdlp";
import { Stage3RenderPlan } from "../../../../lib/stage3-agent";
import { Stage3StateSnapshot } from "../../../../app/components/types";
import { getChannelAssetById } from "../../../../lib/chat-history";
import { readChannelAssetFile } from "../../../../lib/channel-assets";
import { SCIENCE_CARD } from "../../../../lib/stage3-template";

export const runtime = "nodejs";

const PREVIEW_CACHE_ROOT = path.join(os.tmpdir(), "clip-stage3-cache");
const SOURCE_CACHE_DIR = path.join(PREVIEW_CACHE_ROOT, "sources");
const PREVIEW_CACHE_DIR = path.join(PREVIEW_CACHE_ROOT, "previews");
const sourceInflight = new Map<
  string,
  Promise<{ sourcePath: string; sourceDurationSec: number | null; sourceKey: string }>
>();
const previewInflight = new Map<string, Promise<void>>();

type PreviewBody = {
  sourceUrl?: string;
  channelId?: string;
  clipStartSec?: number;
  clipDurationSec?: number;
  agentPrompt?: string;
  renderPlan?: Partial<Stage3RenderPlan>;
  snapshot?: Partial<Stage3StateSnapshot>;
};

function hashKey(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function pruneCacheDirectory(dirPath: string, maxFiles: number): Promise<void> {
  const entries = await fs.readdir(dirPath).catch(() => []);
  if (entries.length <= maxFiles) {
    return;
  }

  const files = await Promise.all(
    entries.map(async (name) => {
      const filePath = path.join(dirPath, name);
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat?.isFile()) {
        return null;
      }
      return { filePath, mtimeMs: stat.mtimeMs };
    })
  );
  const ordered = files
    .filter((item): item is { filePath: string; mtimeMs: number } => Boolean(item))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const stale = ordered.slice(maxFiles);
  await Promise.all(stale.map((item) => fs.rm(item.filePath, { force: true }).catch(() => undefined)));
}

async function ensureSourceCached(
  rawSource: string
): Promise<{ sourcePath: string; sourceDurationSec: number | null; sourceKey: string }> {
  const sourceKey = hashKey(rawSource);
  const sourcePath = path.join(SOURCE_CACHE_DIR, `${sourceKey}.mp4`);
  const metaPath = path.join(SOURCE_CACHE_DIR, `${sourceKey}.json`);

  if (await pathExists(sourcePath)) {
    const rawMeta = await fs.readFile(metaPath, "utf-8").catch(() => "");
    let fromMeta: { sourceDurationSec?: number } | null = null;
    if (rawMeta) {
      try {
        fromMeta = JSON.parse(rawMeta) as { sourceDurationSec?: number };
      } catch {
        fromMeta = null;
      }
    }
    const sourceDurationSec =
      typeof fromMeta?.sourceDurationSec === "number" && Number.isFinite(fromMeta.sourceDurationSec)
        ? fromMeta.sourceDurationSec
        : await probeVideoDurationSeconds(sourcePath);
    if (!rawMeta && sourceDurationSec !== null) {
      await fs.writeFile(metaPath, JSON.stringify({ sourceDurationSec }), "utf-8").catch(() => undefined);
    }
    return { sourcePath, sourceDurationSec, sourceKey };
  }

  const pending = sourceInflight.get(sourceKey);
  if (pending) {
    return pending;
  }

  const task = (async () => {
    await fs.mkdir(SOURCE_CACHE_DIR, { recursive: true });
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clip-stage3-source-cache-"));
    try {
      const downloaded = await downloadSourceVideo(rawSource, tmpDir);
      await fs.copyFile(downloaded.filePath, sourcePath);
      const sourceDurationSec = await probeVideoDurationSeconds(sourcePath);
      await fs
        .writeFile(metaPath, JSON.stringify({ sourceDurationSec }), "utf-8")
        .catch(() => undefined);
      return { sourcePath, sourceDurationSec, sourceKey };
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  })();

  sourceInflight.set(sourceKey, task);
  try {
    return await task;
  } finally {
    sourceInflight.delete(sourceKey);
  }
}

function normalizeRenderPlan(
  rawPlan: Partial<Stage3RenderPlan> | undefined,
  sourceDurationSec: number | null
): Stage3RenderPlan {
  const policyFallback =
    sourceDurationSec !== null && sourceDurationSec > 12 ? "adaptive_window" : "full_source_normalize";

  return {
    targetDurationSec: 6,
    timingMode:
      rawPlan?.timingMode === "compress" || rawPlan?.timingMode === "stretch" || rawPlan?.timingMode === "auto"
        ? rawPlan.timingMode
        : "auto",
    audioMode:
      rawPlan?.audioMode === "source_only" || rawPlan?.audioMode === "source_plus_music"
        ? rawPlan.audioMode
        : "source_only",
    smoothSlowMo: Boolean(rawPlan?.smoothSlowMo),
    segments: Array.isArray(rawPlan?.segments)
      ? rawPlan.segments
          .map((segment) => {
            if (!segment || typeof segment !== "object") {
              return null;
            }
            const start =
              typeof segment.startSec === "number" && Number.isFinite(segment.startSec)
                ? segment.startSec
                : null;
            const end =
              segment.endSec === null
                ? null
                : typeof segment.endSec === "number" && Number.isFinite(segment.endSec)
                  ? segment.endSec
                  : null;
            if (start === null) {
              return null;
            }
            return {
              startSec: start,
              endSec: end,
              label: typeof segment.label === "string" ? segment.label : `${start.toFixed(1)}-${end ?? "end"}`
            };
          })
          .filter(
            (segment): segment is { startSec: number; endSec: number | null; label: string } => Boolean(segment)
          )
      : [],
    policy:
      rawPlan?.policy === "adaptive_window" ||
      rawPlan?.policy === "full_source_normalize" ||
      rawPlan?.policy === "fixed_segments"
        ? rawPlan.policy
        : policyFallback,
    backgroundAssetId:
      typeof rawPlan?.backgroundAssetId === "string" && rawPlan.backgroundAssetId.trim()
        ? rawPlan.backgroundAssetId.trim()
        : null,
    backgroundAssetMimeType:
      typeof rawPlan?.backgroundAssetMimeType === "string" && rawPlan.backgroundAssetMimeType.trim()
        ? rawPlan.backgroundAssetMimeType.trim()
        : null,
    musicAssetId:
      typeof rawPlan?.musicAssetId === "string" && rawPlan.musicAssetId.trim()
        ? rawPlan.musicAssetId.trim()
        : null,
    musicAssetMimeType:
      typeof rawPlan?.musicAssetMimeType === "string" && rawPlan.musicAssetMimeType.trim()
        ? rawPlan.musicAssetMimeType.trim()
        : null,
    avatarAssetId:
      typeof rawPlan?.avatarAssetId === "string" && rawPlan.avatarAssetId.trim()
        ? rawPlan.avatarAssetId.trim()
        : null,
    avatarAssetMimeType:
      typeof rawPlan?.avatarAssetMimeType === "string" && rawPlan.avatarAssetMimeType.trim()
        ? rawPlan.avatarAssetMimeType.trim()
        : null,
    authorName:
      typeof rawPlan?.authorName === "string" && rawPlan.authorName.trim()
        ? rawPlan.authorName.trim()
        : SCIENCE_CARD.author.name,
    authorHandle:
      typeof rawPlan?.authorHandle === "string" && rawPlan.authorHandle.trim()
        ? rawPlan.authorHandle.trim()
        : SCIENCE_CARD.author.handle,
    templateId:
      typeof rawPlan?.templateId === "string" && rawPlan.templateId.trim()
        ? rawPlan.templateId.trim()
        : "science-card-v1",
    // Prompt text does not affect media transform and should not split cache keys.
    prompt: ""
  };
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as PreviewBody | null;
  const rawSource = body?.sourceUrl?.trim();

  if (!rawSource) {
    return Response.json({ error: "Передайте sourceUrl в теле запроса." }, { status: 400 });
  }
  if (!isSupportedUrl(rawSource)) {
    return Response.json(
      { error: "Поддерживаются ссылки на YouTube Shorts, Instagram Reels и Facebook Reels." },
      { status: 400 }
    );
  }

  try {
    await fs.mkdir(PREVIEW_CACHE_DIR, { recursive: true });
    const source = await ensureSourceCached(rawSource);
    const clipDurationSec = sanitizeClipDuration(body?.clipDurationSec);
    const snapshot = body?.snapshot;

    const clipStartCandidate =
      parseFiniteNumber(snapshot?.clipStartSec) ?? parseFiniteNumber(body?.clipStartSec) ?? 0;
    const clipStartSec = clampClipStart(clipStartCandidate, source.sourceDurationSec, clipDurationSec);
    const rawPlan = snapshot?.renderPlan ?? body?.renderPlan;
    const renderPlan = normalizeRenderPlan(rawPlan, source.sourceDurationSec);
    let musicFilePath: string | null = null;
    if (body?.channelId && renderPlan.musicAssetId) {
      const musicAsset = await getChannelAssetById(body.channelId, renderPlan.musicAssetId);
      if (musicAsset) {
        const musicFile = await readChannelAssetFile({
          channelId: body.channelId,
          fileName: musicAsset.fileName
        });
        if (musicFile) {
          musicFilePath = musicFile.filePath;
        }
      }
    }

    const previewKey = hashKey(
      JSON.stringify({
        sourceKey: source.sourceKey,
        clipStartSec: Number(clipStartSec.toFixed(3)),
        clipDurationSec: renderPlan.targetDurationSec,
        renderPlan,
        musicAssetId: renderPlan.musicAssetId
      })
    );
    const previewPath = path.join(PREVIEW_CACHE_DIR, `${previewKey}.mp4`);

    if (await pathExists(previewPath)) {
      const rendered = await fs.readFile(previewPath);
      return new Response(rendered, {
        status: 200,
        headers: {
          "Content-Type": "video/mp4",
          "Cache-Control": "public, max-age=600",
          "x-stage3-preview": "1",
          "x-stage3-cache": "hit"
        }
      });
    }

    const running = previewInflight.get(previewKey);
    if (running) {
      await running;
    } else {
      const task = (async () => {
        const localTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clip-stage3-preview-"));
        try {
          const prepared = await prepareStage3SourceClip({
            sourcePath: source.sourcePath,
            tmpDir: localTmpDir,
            sourceDurationSec: source.sourceDurationSec,
            clipStartSec,
            clipDurationSec: renderPlan.targetDurationSec,
            renderPlan,
            musicFilePath,
            profile: "preview"
          });
          await fs.copyFile(prepared.preparedPath, previewPath);
        } finally {
          await fs.rm(localTmpDir, { recursive: true, force: true });
        }
      })();
      previewInflight.set(previewKey, task);
      try {
        await task;
      } finally {
        previewInflight.delete(previewKey);
      }
    }

    await pruneCacheDirectory(PREVIEW_CACHE_DIR, 48).catch(() => undefined);
    await pruneCacheDirectory(SOURCE_CACHE_DIR, 24).catch(() => undefined);

    const rendered = await fs.readFile(previewPath);
    return new Response(rendered, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Cache-Control": "public, max-age=600",
        "x-stage3-preview": "1",
        "x-stage3-cache": "miss"
      }
    });
  } catch (error) {
    const stderr =
      typeof error === "object" && error && "stderr" in error
        ? String((error as { stderr?: string }).stderr ?? "")
        : "";
    if (stderr) {
      return Response.json({ error: getYtDlpError(stderr) }, { status: 500 });
    }

    return Response.json(
      { error: error instanceof Error ? error.message : "Stage 3 preview failed." },
      { status: 500 }
    );
  }
}
