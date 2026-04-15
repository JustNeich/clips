import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clampClipStart,
  prepareStage3SourceClip,
  sanitizeClipDuration
} from "./stage3-media-agent";
import { maybeDownloadStage3WorkerAsset } from "./stage3-worker-asset-client";
import { extractYtDlpErrorFromUnknown, isSupportedUrl, normalizeSupportedUrl } from "./ytdlp";
import { Stage3RenderPlan } from "./stage3-agent";
import { Stage3StateSnapshot } from "../app/components/types";
import { STAGE3_MAX_VIDEO_ZOOM, STAGE3_MIN_VIDEO_ZOOM } from "./stage3-constants";
import { STAGE3_TEMPLATE_ID } from "./stage3-template";
import { clampStage3TextScaleUi } from "./stage3-text-fit";
import {
  normalizeStage3VideoBrightness,
  normalizeStage3VideoContrast,
  normalizeStage3VideoExposure,
  normalizeStage3VideoSaturation
} from "./stage3-video-adjustments";
import {
  normalizeStage3CameraKeyframes,
  normalizeStage3CameraMotion,
  resolveStage3EffectiveCameraTracks
} from "./stage3-camera";
import { getAppDataDir } from "./app-paths";
import { createNodeStreamResponse } from "./node-stream-response";
import { isHostedRenderRuntime } from "./hosted-subprocess";
import {
  ensureStage3SourceCached,
  runHostedStage3HeavyJob
} from "./stage3-server-control";
import {
  normalizeStage3SegmentFocusOverride,
  normalizeStage3SegmentMirrorOverride,
  normalizeStage3SegmentZoomOverride
} from "./stage3-segment-transforms";
import { resolveManagedTemplateRuntimeSync } from "./managed-template-runtime";
import {
  normalizeStage3RenderPlanSegments,
  resolveCanonicalStage3RenderPolicy
} from "./stage3-render-plan";

const PREVIEW_CACHE_ROOT = path.join(getAppDataDir(), "stage3-cache");
const PREVIEW_CACHE_DIR = path.join(PREVIEW_CACHE_ROOT, "previews");
const STAGE3_PREVIEW_CACHE_VERSION = "v3";
const DEFAULT_TEXT_SCALE = 1.25;
const SEGMENT_SPEED_SET = new Set<number>([1, 1.5, 2, 2.5, 3, 4, 5]);
const previewInflight = new Map<string, Promise<void>>();

export const PREVIEW_WAIT_TIMEOUT_MS = 20_000;

export type Stage3PreviewRequestBody = {
  sourceUrl?: string;
  channelId?: string;
  workspaceId?: string;
  clipStartSec?: number;
  clipDurationSec?: number;
  agentPrompt?: string;
  renderPlan?: Partial<Stage3RenderPlan>;
  snapshot?: Partial<Stage3StateSnapshot>;
};

export type Stage3PreparedPreview = {
  filePath: string;
  cacheKey: string;
  cacheState: "hit" | "miss" | "wait";
};

async function resolveStage3AssetFile(params: {
  channelId: string;
  assetId: string;
  tmpDir: string;
}): Promise<{ filePath: string } | null> {
  const remoteAsset = await maybeDownloadStage3WorkerAsset({
    channelId: params.channelId,
    assetId: params.assetId,
    tmpDir: params.tmpDir
  });
  if (remoteAsset?.filePath) {
    return { filePath: remoteAsset.filePath };
  }

  const [{ getChannelAssetById }, { readChannelAssetFile }] = await Promise.all([
    import("./chat-history"),
    import("./channel-assets")
  ]);
  const asset = await getChannelAssetById(params.channelId, params.assetId);
  if (!asset) {
    return null;
  }
  const file = await readChannelAssetFile({
    channelId: params.channelId,
    fileName: asset.fileName
  });
  if (!file) {
    return null;
  }
  return { filePath: file.filePath };
}

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

function pathExists(filePath: string): Promise<boolean> {
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

async function pruneCacheDirectory(dirPath: string, options: { maxFiles: number; maxBytes: number; maxAgeMs: number }) {
  const now = Date.now();
  const entries = await fs.readdir(dirPath).catch(() => []);
  const files = (
    await Promise.all(
      entries.map(async (name) => {
        const filePath = path.join(dirPath, name);
        const stat = await fs.stat(filePath).catch(() => null);
        if (!stat?.isFile()) {
          return null;
        }
        return {
          filePath,
          sizeBytes: stat.size,
          mtimeMs: stat.mtimeMs
        };
      })
    )
  ).filter((item): item is { filePath: string; sizeBytes: number; mtimeMs: number } => Boolean(item));

  const expired = files.filter((file) => now - file.mtimeMs > options.maxAgeMs);
  await Promise.all(expired.map((file) => fs.rm(file.filePath, { force: true }).catch(() => undefined)));

  const fresh = files
    .filter((file) => now - file.mtimeMs <= options.maxAgeMs)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  let totalBytes = fresh.reduce((sum, file) => sum + file.sizeBytes, 0);
  for (let index = options.maxFiles; index < fresh.length; index += 1) {
    const file = fresh[index];
    totalBytes -= file.sizeBytes;
    await fs.rm(file.filePath, { force: true }).catch(() => undefined);
  }

  const sized = fresh.slice(0, options.maxFiles);
  for (let index = sized.length - 1; index >= 0 && totalBytes > options.maxBytes; index -= 1) {
    totalBytes -= sized[index].sizeBytes;
    await fs.rm(sized[index].filePath, { force: true }).catch(() => undefined);
  }
}

function getPreviewCacheLimits() {
  if (isHostedRenderRuntime()) {
    return {
      maxFiles: 12,
      maxBytes: 128 * 1024 * 1024,
      maxAgeMs: 20 * 60_000
    };
  }
  return {
    maxFiles: 32,
    maxBytes: 512 * 1024 * 1024,
    maxAgeMs: 45 * 60_000
  };
}

async function createVideoFileResponse(
  filePath: string,
  headers: Record<string, string>
): Promise<Response> {
  const stat = await fs.stat(filePath);
  const stream = createReadStream(filePath);
  return createNodeStreamResponse({
    stream,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(stat.size),
      ...headers
    }
  });
}

export async function tryCreateStage3PreviewResponse(
  filePath: string,
  headers: Record<string, string>
): Promise<Response | null> {
  try {
    return await createVideoFileResponse(filePath, headers);
  } catch (error) {
    if (error instanceof Error && "code" in error && String((error as NodeJS.ErrnoException).code ?? "") === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function normalizeRenderPlan(
  rawPlan: Partial<Stage3RenderPlan> | undefined,
  sourceDurationSec: number | null,
  managedTemplateState?: Stage3StateSnapshot["managedTemplateState"],
  workspaceId?: string | null
): Stage3RenderPlan {
  const policyFallback =
    sourceDurationSec !== null && sourceDurationSec > 12 ? "adaptive_window" : "full_source_normalize";
  const templateId =
    typeof rawPlan?.templateId === "string" && rawPlan.templateId.trim()
      ? rawPlan.templateId.trim()
      : STAGE3_TEMPLATE_ID;
  const template = resolveManagedTemplateRuntimeSync(templateId, managedTemplateState, {
    workspaceId
  }).templateConfig;
  const templateVideoAdjustments = template.videoAdjustments;
  const videoZoom =
    typeof rawPlan?.videoZoom === "number" && Number.isFinite(rawPlan.videoZoom)
      ? Math.min(STAGE3_MAX_VIDEO_ZOOM, Math.max(STAGE3_MIN_VIDEO_ZOOM, rawPlan.videoZoom))
      : 1;
  const cameraTracks = resolveStage3EffectiveCameraTracks({
    cameraPositionKeyframes: rawPlan?.cameraPositionKeyframes,
    cameraScaleKeyframes: rawPlan?.cameraScaleKeyframes,
    cameraKeyframes: rawPlan?.cameraKeyframes,
    cameraMotion: rawPlan?.cameraMotion,
    clipDurationSec: 6,
    baseFocusY: 0.5,
    baseZoom: videoZoom
  });

  const segments = normalizeStage3RenderPlanSegments(rawPlan?.segments);
  const normalizeToTargetEnabled =
    typeof rawPlan?.normalizeToTargetEnabled === "boolean"
      ? rawPlan.normalizeToTargetEnabled
      : rawPlan?.timingMode === "compress" ||
          rawPlan?.timingMode === "stretch" ||
          rawPlan?.policy === "full_source_normalize";

  return {
    targetDurationSec: 6,
    timingMode:
      rawPlan?.timingMode === "compress" || rawPlan?.timingMode === "stretch" || rawPlan?.timingMode === "auto"
        ? rawPlan.timingMode
        : "auto",
    normalizeToTargetEnabled,
    audioMode:
      rawPlan?.audioMode === "source_only" || rawPlan?.audioMode === "source_plus_music"
        ? rawPlan.audioMode
        : "source_only",
    sourceAudioEnabled: Boolean(rawPlan?.sourceAudioEnabled ?? true),
    smoothSlowMo: Boolean(rawPlan?.smoothSlowMo),
    mirrorEnabled: Boolean(rawPlan?.mirrorEnabled ?? true),
    cameraMotion: normalizeStage3CameraMotion(rawPlan?.cameraMotion),
    cameraKeyframes: normalizeStage3CameraKeyframes(rawPlan?.cameraKeyframes, {
      clipDurationSec: 6,
      fallbackFocusY: 0.5,
      fallbackZoom: videoZoom
    }),
    cameraPositionKeyframes: cameraTracks.positionKeyframes,
    cameraScaleKeyframes: cameraTracks.scaleKeyframes,
    videoZoom,
    videoBrightness: normalizeStage3VideoBrightness(rawPlan?.videoBrightness, templateVideoAdjustments.brightness),
    videoExposure: normalizeStage3VideoExposure(rawPlan?.videoExposure, templateVideoAdjustments.exposure),
    videoContrast: normalizeStage3VideoContrast(rawPlan?.videoContrast, templateVideoAdjustments.contrast),
    videoSaturation: normalizeStage3VideoSaturation(rawPlan?.videoSaturation, templateVideoAdjustments.saturation),
    topFontScale:
      typeof rawPlan?.topFontScale === "number" && Number.isFinite(rawPlan.topFontScale)
        ? clampStage3TextScaleUi(rawPlan.topFontScale)
        : DEFAULT_TEXT_SCALE,
    bottomFontScale:
      typeof rawPlan?.bottomFontScale === "number" && Number.isFinite(rawPlan.bottomFontScale)
        ? clampStage3TextScaleUi(rawPlan.bottomFontScale)
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
    segments,
    policy: resolveCanonicalStage3RenderPolicy({
      segments,
      normalizeToTargetEnabled,
      requestedPolicy:
        rawPlan?.policy === "adaptive_window" ||
        rawPlan?.policy === "full_source_normalize" ||
        rawPlan?.policy === "fixed_segments"
          ? rawPlan.policy
          : policyFallback
    }),
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
    prompt: ""
  };
}

function resolveSourceUrl(rawSource: string | undefined): string {
  const sourceUrl = normalizeSupportedUrl(rawSource?.trim() ?? "");
  if (!sourceUrl) {
    throw new Error("Передайте sourceUrl в теле запроса.");
  }
  if (!isSupportedUrl(sourceUrl)) {
    throw new Error("Не удалось подготовить исходное видео для предпросмотра. Проверьте ссылку на ролик из Шага 1.");
  }
  return sourceUrl;
}

function buildPreviewCacheKey(params: {
  sourceKey: string;
  clipStartSec: number;
  renderPlan: Stage3RenderPlan;
  templateRevision: string;
}): string {
  return hashKey(
    JSON.stringify({
      previewCacheVersion: STAGE3_PREVIEW_CACHE_VERSION,
      sourceKey: params.sourceKey,
      clipStartSec: Number(params.clipStartSec.toFixed(3)),
      clipDurationSec: params.renderPlan.targetDurationSec,
      templateRevision: params.templateRevision,
      renderPlan: params.renderPlan,
      musicAssetId: params.renderPlan.musicAssetId,
      musicGain: Number(params.renderPlan.musicGain.toFixed(3))
    })
  );
}

export async function buildStage3PreviewDedupeKey(
  body: Stage3PreviewRequestBody,
  scope?: { workspaceId?: string | null; userId?: string | null }
): Promise<string> {
  const sourceUrl = resolveSourceUrl(body.sourceUrl);
  const snapshot = body.snapshot;
  const workspaceId = scope?.workspaceId?.trim() || body.workspaceId?.trim() || "";
  const clipStartSec = parseFiniteNumber(snapshot?.clipStartSec) ?? parseFiniteNumber(body.clipStartSec) ?? 0;
  const renderPlan = normalizeRenderPlan(
    snapshot?.renderPlan ?? body.renderPlan,
    null,
    snapshot?.managedTemplateState,
    workspaceId || null
  );
  const managedTemplateRuntime = resolveManagedTemplateRuntimeSync(
    renderPlan.templateId,
    snapshot?.managedTemplateState,
    { workspaceId: workspaceId || null }
  );
  const previewKey = buildPreviewCacheKey({
    sourceKey: hashKey(sourceUrl),
    clipStartSec,
    renderPlan,
    templateRevision: managedTemplateRuntime.updatedAt
  });
  const userId = scope?.userId?.trim() ?? "";
  if (!workspaceId || !userId) {
    return `preview:${STAGE3_PREVIEW_CACHE_VERSION}:global:${previewKey}`;
  }
  return `preview:${STAGE3_PREVIEW_CACHE_VERSION}:${workspaceId}:${userId}:${previewKey}`;
}

export async function prepareStage3Preview(
  body: Stage3PreviewRequestBody,
  options?: { signal?: AbortSignal; waitTimeoutMs?: number | null }
): Promise<Stage3PreparedPreview> {
  const sourceUrl = resolveSourceUrl(body.sourceUrl);
  const waitTimeoutMs =
    typeof options?.waitTimeoutMs === "number" && Number.isFinite(options.waitTimeoutMs) && options.waitTimeoutMs > 0
      ? options.waitTimeoutMs
      : PREVIEW_WAIT_TIMEOUT_MS;

  await fs.mkdir(PREVIEW_CACHE_DIR, { recursive: true });
  const source = await ensureStage3SourceCached(sourceUrl, {
    signal: options?.signal,
    waitTimeoutMs
  });
  const clipDurationSec = sanitizeClipDuration(body.clipDurationSec);
  const snapshot = body.snapshot;
  const workspaceId = body.workspaceId?.trim() || null;

  const clipStartCandidate = parseFiniteNumber(snapshot?.clipStartSec) ?? parseFiniteNumber(body.clipStartSec) ?? 0;
  const clipStartSec = clampClipStart(clipStartCandidate, source.sourceDurationSec, clipDurationSec);
  const rawPlan = snapshot?.renderPlan ?? body.renderPlan;
  const renderPlan = normalizeRenderPlan(
    rawPlan,
    source.sourceDurationSec,
    snapshot?.managedTemplateState,
    workspaceId
  );
  const managedTemplateRuntime = resolveManagedTemplateRuntimeSync(
    renderPlan.templateId,
    snapshot?.managedTemplateState,
    { workspaceId }
  );
  const assetTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clip-stage3-preview-assets-"));
  let musicFilePath: string | null = null;
  try {
    if (body.channelId && renderPlan.musicAssetId) {
      const musicFile = await resolveStage3AssetFile({
        channelId: body.channelId,
        assetId: renderPlan.musicAssetId,
        tmpDir: assetTmpDir
      });
      if (musicFile) {
        musicFilePath = musicFile.filePath;
      }
    }

    const previewKey = buildPreviewCacheKey({
      sourceKey: source.sourceKey,
      clipStartSec,
      renderPlan,
      templateRevision: managedTemplateRuntime.updatedAt
    });
    const previewPath = path.join(PREVIEW_CACHE_DIR, `${previewKey}.mp4`);

    if (await pathExists(previewPath)) {
      return {
        filePath: previewPath,
        cacheKey: previewKey,
        cacheState: "hit"
      };
    }

    const running = previewInflight.get(previewKey);
    const waitedForExistingTask = Boolean(running);
    if (running) {
      await running;
    } else {
      const task = (async () => {
        const localTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clip-stage3-preview-"));
        try {
          if (options?.signal?.aborted) {
            return;
          }
          const prepared = await runHostedStage3HeavyJob(
            () =>
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
              signal: options?.signal,
              waitTimeoutMs
            }
          );
          if (options?.signal?.aborted) {
            return;
          }
          const publishPath = `${previewPath}.part-${hashKey(`${Date.now()}-${Math.random()}`)}`;
          await fs.copyFile(prepared.preparedPath, publishPath);
          await fs.rename(publishPath, previewPath);
        } finally {
          await fs.rm(localTmpDir, { recursive: true, force: true }).catch(() => undefined);
        }
      })();
      previewInflight.set(previewKey, task);
      try {
        await task;
      } finally {
        previewInflight.delete(previewKey);
      }
    }

    if (options?.signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    if (!(await pathExists(previewPath))) {
      throw new Error("Черновой предпросмотр не удалось подготовить. Повторите ещё раз.");
    }

    await pruneCacheDirectory(PREVIEW_CACHE_DIR, getPreviewCacheLimits()).catch(() => undefined);

    return {
      filePath: previewPath,
      cacheKey: previewKey,
      cacheState: waitedForExistingTask ? "wait" : "miss"
    };
  } finally {
    await fs.rm(assetTmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function summarizeStage3PreviewError(error: unknown): string {
  const ytdlpMessage = extractYtDlpErrorFromUnknown(error);
  if (ytdlpMessage) {
    return ytdlpMessage;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Stage 3 preview failed.";
}
