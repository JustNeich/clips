import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
  clampClipStart,
  prepareStage3SourceClip,
  sanitizeClipDuration
} from "../../../../lib/stage3-media-agent";
import { extractYtDlpErrorFromUnknown, isSupportedUrl, normalizeSupportedUrl } from "../../../../lib/ytdlp";
import { Stage3RenderPlan } from "../../../../lib/stage3-agent";
import { Stage3StateSnapshot } from "../../../../app/components/types";
import { getChannelAssetById } from "../../../../lib/chat-history";
import { readChannelAssetFile } from "../../../../lib/channel-assets";
import { STAGE3_TEMPLATE_ID, getTemplateById } from "../../../../lib/stage3-template";
import { requireAuth, requireChannelVisibility } from "../../../../lib/auth/guards";
import { summarizeUserFacingError } from "../../../../lib/ui-error";
import {
  ensureStage3SourceCached,
  isStage3HostedBusyError,
  pruneStage3SourceCache,
  runHostedStage3HeavyJob
} from "../../../../lib/stage3-server-control";

export const runtime = "nodejs";

const PREVIEW_CACHE_ROOT = path.join(os.tmpdir(), "clip-stage3-cache");
const PREVIEW_CACHE_DIR = path.join(PREVIEW_CACHE_ROOT, "previews");
const DEFAULT_TEXT_SCALE = 1.25;
const previewInflight = new Map<string, Promise<void>>();
const SEGMENT_SPEED_SET = new Set<number>([1, 1.5, 2, 2.5, 3, 4, 5]);
const PREVIEW_BUSY_RETRY_AFTER_SEC = "6";
const PREVIEW_WAIT_TIMEOUT_MS = 20_000;

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

function normalizeSegmentSpeed(value: unknown): Stage3RenderPlan["segments"][number]["speed"] {
  if (typeof value === "number" && Number.isFinite(value) && SEGMENT_SPEED_SET.has(value)) {
    return value as Stage3RenderPlan["segments"][number]["speed"];
  }
  return 1;
}

function normalizeCameraMotion(value: unknown): Stage3RenderPlan["cameraMotion"] {
  return value === "top_to_bottom" || value === "bottom_to_top" ? value : "disabled";
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

async function createVideoFileResponse(
  filePath: string,
  headers: Record<string, string>
): Promise<Response> {
  const stat = await fs.stat(filePath);
  const stream = createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(stat.size),
      ...headers
    }
  });
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    String((error as NodeJS.ErrnoException).code ?? "") === "ENOENT"
  );
}

async function tryCreateVideoFileResponse(
  filePath: string,
  headers: Record<string, string>
): Promise<Response | null> {
  try {
    return await createVideoFileResponse(filePath, headers);
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}

function normalizeRenderPlan(
  rawPlan: Partial<Stage3RenderPlan> | undefined,
  sourceDurationSec: number | null
): Stage3RenderPlan {
  const policyFallback =
    sourceDurationSec !== null && sourceDurationSec > 12 ? "adaptive_window" : "full_source_normalize";
  const templateId =
    typeof rawPlan?.templateId === "string" && rawPlan.templateId.trim()
      ? rawPlan.templateId.trim()
      : STAGE3_TEMPLATE_ID;
  const template = getTemplateById(templateId);

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
    sourceAudioEnabled: Boolean(rawPlan?.sourceAudioEnabled ?? true),
    smoothSlowMo: Boolean(rawPlan?.smoothSlowMo),
    mirrorEnabled: Boolean(rawPlan?.mirrorEnabled ?? true),
    cameraMotion: normalizeCameraMotion(rawPlan?.cameraMotion),
    videoZoom:
      typeof rawPlan?.videoZoom === "number" && Number.isFinite(rawPlan.videoZoom)
        ? Math.min(1.6, Math.max(1, rawPlan.videoZoom))
        : 1,
    topFontScale:
      typeof rawPlan?.topFontScale === "number" && Number.isFinite(rawPlan.topFontScale)
        ? Math.min(1.9, Math.max(0.7, rawPlan.topFontScale))
        : DEFAULT_TEXT_SCALE,
    bottomFontScale:
      typeof rawPlan?.bottomFontScale === "number" && Number.isFinite(rawPlan.bottomFontScale)
        ? Math.min(1.9, Math.max(0.7, rawPlan.bottomFontScale))
        : DEFAULT_TEXT_SCALE,
    musicGain:
      typeof rawPlan?.musicGain === "number" && Number.isFinite(rawPlan.musicGain)
        ? Math.min(1, Math.max(0, rawPlan.musicGain))
        : 0.65,
    textPolicy:
      rawPlan?.textPolicy === "strict_fit" ||
      rawPlan?.textPolicy === "preserve_words" ||
      rawPlan?.textPolicy === "aggressive_compact"
        ? rawPlan.textPolicy
        : "strict_fit",
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
              speed: normalizeSegmentSpeed((segment as { speed?: unknown }).speed),
              label: typeof segment.label === "string" ? segment.label : `${start.toFixed(1)}-${end ?? "end"}`
            };
          })
          .filter((segment): segment is NonNullable<typeof segment> => Boolean(segment))
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
        : template.author.name,
    authorHandle:
      typeof rawPlan?.authorHandle === "string" && rawPlan.authorHandle.trim()
        ? rawPlan.authorHandle.trim()
        : template.author.handle,
    templateId,
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
  const sourceUrl = normalizeSupportedUrl(rawSource);
  if (!isSupportedUrl(sourceUrl)) {
    return Response.json(
      {
        error:
          "Не удалось подготовить исходное видео для предпросмотра. Проверьте ссылку на ролик из Шага 1."
      },
      { status: 400 }
    );
  }

  try {
    const auth = await requireAuth();
    if (body?.channelId?.trim()) {
      await requireChannelVisibility(auth, body.channelId.trim());
    }
    await fs.mkdir(PREVIEW_CACHE_DIR, { recursive: true });
    const source = await ensureStage3SourceCached(sourceUrl, {
      signal: request.signal,
      waitTimeoutMs: PREVIEW_WAIT_TIMEOUT_MS
    });
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
        musicAssetId: renderPlan.musicAssetId,
        musicGain: Number(renderPlan.musicGain.toFixed(3))
      })
    );
    const previewPath = path.join(PREVIEW_CACHE_DIR, `${previewKey}.mp4`);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const cachedResponse = await tryCreateVideoFileResponse(previewPath, {
        "Cache-Control": "public, max-age=600",
        "x-stage3-preview": "1",
        "x-stage3-cache": "hit"
      });
      if (cachedResponse) {
        return cachedResponse;
      }

      const running = previewInflight.get(previewKey);
      const waitedForExistingTask = Boolean(running);
      if (running) {
        await running;
      } else {
        const task = (async () => {
          const localTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clip-stage3-preview-"));
          try {
            if (request.signal.aborted) {
              return;
            }
            const prepared = await runHostedStage3HeavyJob(() =>
              prepareStage3SourceClip({
                sourcePath: source.sourcePath,
                tmpDir: localTmpDir,
                sourceDurationSec: source.sourceDurationSec,
                clipStartSec,
                clipDurationSec: renderPlan.targetDurationSec,
                renderPlan,
                musicFilePath,
                profile: "preview"
              }),
              {
                signal: request.signal,
                waitTimeoutMs: PREVIEW_WAIT_TIMEOUT_MS
              }
            );
            if (request.signal.aborted) {
              return;
            }
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

      if (request.signal.aborted) {
        return new Response(null, { status: 204 });
      }

      const readyResponse = await tryCreateVideoFileResponse(previewPath, {
        "Cache-Control": "public, max-age=600",
        "x-stage3-preview": "1",
        "x-stage3-cache": waitedForExistingTask ? "wait" : "miss"
      });
      if (readyResponse) {
        await pruneCacheDirectory(PREVIEW_CACHE_DIR, 48).catch(() => undefined);
        await pruneStage3SourceCache(24).catch(() => undefined);
        return readyResponse;
      }

      if (!waitedForExistingTask) {
        break;
      }
    }

    if (request.signal.aborted) {
      return new Response(null, { status: 204 });
    }

    return Response.json(
      {
        error: "Черновой предпросмотр не удалось подготовить. Повторите ещё раз."
      },
      { status: 503 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    if (isStage3HostedBusyError(error)) {
      return Response.json(
        {
          error: "Хостинг занят другой тяжёлой задачей Stage 3. Повторите через минуту."
        },
        {
          status: 503,
          headers: {
            "Retry-After": PREVIEW_BUSY_RETRY_AFTER_SEC,
            "x-stage3-busy": "1"
          }
        }
      );
    }
    const ytdlpMessage = extractYtDlpErrorFromUnknown(error);
    if (ytdlpMessage) {
      return Response.json({ error: summarizeUserFacingError(ytdlpMessage) }, { status: 503 });
    }

    return Response.json(
      {
        error: summarizeUserFacingError(error instanceof Error ? error.message : "Stage 3 preview failed.")
      },
      { status: 500 }
    );
  }
}
