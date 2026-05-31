import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  cloneStage3TemplateConfig,
  STAGE3_TEMPLATE_ID,
  type Stage3TemplateConfig
} from "./stage3-template";
import { resolveManagedTemplateAssetFile } from "./managed-template-assets";
import {
  normalizeStage3TemplateFontAsset,
  resolveStage3TemplateDefaultTextScales
} from "./stage3-template-fonts";
import { resolveManagedTemplateRuntimeSync } from "./managed-template-runtime";
import { buildTemplateRenderSnapshot } from "./stage3-template-core";
import { clampStage3TextScaleUi } from "./stage3-text-fit";
import { assertStage3RenderTemplateSnapshotFresh } from "./stage3-render-template-snapshot";
import {
  normalizeStage3VideoBrightness,
  normalizeStage3VideoContrast,
  normalizeStage3VideoExposure,
  normalizeStage3VideoSaturation
} from "./stage3-video-adjustments";
import { normalizeStage3VideoScaleY } from "./stage3-video-scale";
import {
  analyzeBestClipAndFocus,
  clampClipStart,
  prepareStage3SourceClip,
  sanitizeClipDuration,
  sanitizeFocusY
} from "./stage3-media-agent";
import {
  maybeDownloadStage3WorkerAsset,
  maybeDownloadStage3WorkerTemplateAsset
} from "./stage3-worker-asset-client";
import { extractYtDlpErrorFromUnknown, isSupportedUrl, normalizeSupportedUrl } from "./ytdlp";
import { Stage3RenderPlan } from "./stage3-agent";
import { Stage3StateSnapshot } from "../app/components/types";
import { STAGE3_MAX_VIDEO_ZOOM, STAGE3_MIN_VIDEO_ZOOM } from "./stage3-constants";
import {
  clampStage3FocusX,
  normalizeStage3CameraKeyframes,
  normalizeStage3CameraMotion,
  resolveStage3EffectiveCameraTracks
} from "./stage3-camera";
import {
  ensureStage3SourceCached,
  isStage3HostedRuntime,
  runHostedStage3HeavyJob
} from "./stage3-server-control";
import {
  buildStage3VariationManifest,
  createStage3SignalFallbackProfile,
  createStage3VariationProfile,
  Stage3VariationManifest,
  Stage3VariationProfile
} from "./stage3-render-variation";
import {
  normalizeStage3SegmentFocusOverride,
  normalizeStage3SegmentMirrorOverride,
  normalizeStage3SegmentZoomOverride
} from "./stage3-segment-transforms";
import {
  normalizeStage3SourceCrop,
  normalizeStage3RenderPlanSegments,
  resolveCanonicalStage3RenderPolicy
} from "./stage3-render-plan";
import { ensureStage3RenderBrowser } from "./stage3-browser-runtime";
import { repairStage3BlankFlashFrames } from "./stage3-video-flash-guard";
import { resolveStage3BackgroundMode } from "./stage3-background-mode";
import type { Stage3PreparedBrowser } from "./stage3-browser-runtime";
import type { TemplateCaptionHighlights } from "./template-highlights";
import {
  DEFAULT_STAGE3_CLIP_DURATION_SEC,
  normalizeStage3DurationMode,
  resolveStage3OutputDurationSec
} from "./stage3-duration";

export const REMOTION_RENDER_TIMEOUT_MS = 9 * 60_000;
export const RENDER_WAIT_TIMEOUT_MS = 60_000;

const DEFAULT_TEXT_SCALE = 1.25;
const execFileAsync = promisify(execFile);
const MEMORY_CONSTRAINED_REMOTION_CONCURRENCY = 1;
const SEGMENT_SPEED_SET = new Set<number>([1, 1.5, 2, 2.5, 3, 4, 5]);
let remotionServeUrlPromise: Promise<string> | null = null;
let remotionRuntimePromise: Promise<RemotionModule> | null = null;
let remotionBrowserPromise: Promise<Stage3PreparedBrowser> | null = null;

export async function prepareStage3TemplateFontAssetsForRender(params: {
  templateConfig: Stage3TemplateConfig;
  workspaceId: string | null;
  remotionAssetDir: string;
  remotionAssetBase: string;
}): Promise<Stage3TemplateConfig> {
  if (!params.workspaceId) {
    return params.templateConfig;
  }

  let nextConfig: Stage3TemplateConfig | null = null;
  for (const slot of ["top", "bottom"] as const) {
    const asset = normalizeStage3TemplateFontAsset(params.templateConfig.typography[slot].fontAsset);
    if (!asset) {
      continue;
    }

    const resolved = await resolveManagedTemplateAssetFile(asset.id);
    const localFont =
      resolved && resolved.record.kind === "font" && resolved.record.workspaceId === params.workspaceId
        ? {
            filePath: resolved.filePath,
            fileName: resolved.record.fileName,
            mimeType: resolved.record.mimeType
          }
        : await maybeDownloadStage3WorkerTemplateAsset({
            assetId: asset.id,
            tmpDir: params.remotionAssetDir,
            suggestedFileName: asset.originalName
          });
    if (!localFont) {
      continue;
    }

    const ext = path.extname(localFont.fileName ?? asset.originalName).toLowerCase() || ".woff2";
    const localFileName = `font-${slot}${ext}`;
    try {
      await fs.copyFile(localFont.filePath, path.join(params.remotionAssetDir, localFileName));
    } catch {
      continue;
    }

    nextConfig ??= cloneStage3TemplateConfig(params.templateConfig);
    nextConfig.typography[slot].fontAsset = {
      ...asset,
      url: `/${path.posix.join(params.remotionAssetBase, localFileName)}`
    };
  }

  return nextConfig ?? params.templateConfig;
}

function shouldReuseRemotionBundle(): boolean {
  const override = process.env.STAGE3_REUSE_REMOTION_BUNDLE?.trim();
  if (override === "1") {
    return true;
  }
  if (override === "0") {
    return false;
  }
  return process.env.NODE_ENV === "production";
}

function resolveStage3ExecutionRoot(): string {
  const workerRoot = process.env.STAGE3_WORKER_INSTALL_ROOT?.trim();
  if (workerRoot) {
    return workerRoot;
  }
  return process.cwd();
}

export type Stage3RenderRequestBody = {
  requestId?: string;
  sourceUrl?: string;
  channelId?: string;
  workspaceId?: string;
  chatId?: string;
  copscopes?: {
    runId?: string;
    sourceReelId?: string;
    shortcode?: string;
    categorySlug?: string;
  };
  publishAfterRender?: boolean;
  renderTitle?: string;
  topText?: string;
  bottomText?: string;
  sourceOverlayText?: string;
  templateId?: string;
  clipStartSec?: number;
  clipDurationSec?: number;
  focusY?: number;
  agentPrompt?: string;
  renderPlan?: Partial<Stage3RenderPlan>;
  snapshot?: Partial<Stage3StateSnapshot>;
  variationSeed?: string;
};

export type Stage3RenderedVideo = {
  filePath: string;
  outputName: string;
  topCompacted: boolean;
  bottomCompacted: boolean;
  cleanupDir: string;
  variationManifest: Stage3VariationManifest;
  variationManifestPath: string;
};

type AsyncFn = (...args: any[]) => Promise<any>;

type RemotionModule = {
  bundle: AsyncFn;
  getCompositions: AsyncFn;
  renderMedia: AsyncFn;
  selectComposition: AsyncFn | null;
};

function normalizeSegmentSpeed(value: unknown): Stage3RenderPlan["segments"][number]["speed"] {
  if (typeof value === "number" && Number.isFinite(value) && SEGMENT_SPEED_SET.has(value)) {
    return value as Stage3RenderPlan["segments"][number]["speed"];
  }
  return 1;
}

async function ensureRemotionRuntime(): Promise<RemotionModule> {
  if (!remotionRuntimePromise) {
    remotionRuntimePromise = Promise.all([import("@remotion/renderer"), import("@remotion/bundler")])
      .then(([rendererModule, bundlerModule]) => {
        const rendererDefault = unwrapDefaultExport(rendererModule);
        const bundlerDefault = unwrapDefaultExport(bundlerModule);

        const bundle = resolveFunction([rendererModule, rendererDefault, bundlerDefault], "bundle");
        const getCompositions = resolveFunction([rendererModule, rendererDefault], "getCompositions");
        const renderMedia = resolveFunction([rendererModule, rendererDefault], "renderMedia");
        const selectComposition = resolveFunction(
          [rendererModule, rendererDefault],
          "selectComposition",
          true
        );

        return { bundle, getCompositions, renderMedia, selectComposition };
      })
      .catch((error) => {
        remotionRuntimePromise = null;
        throw error;
      });
  }
  return remotionRuntimePromise;
}

async function resolveStage3AssetFile(params: {
  channelId: string;
  assetId: string;
  tmpDir: string;
}): Promise<{ filePath: string; fileName: string; mimeType: string | null } | null> {
  const remoteAsset = await maybeDownloadStage3WorkerAsset({
    channelId: params.channelId,
    assetId: params.assetId,
    tmpDir: params.tmpDir
  });
  if (remoteAsset?.filePath && remoteAsset.fileName) {
    return {
      filePath: remoteAsset.filePath,
      fileName: remoteAsset.fileName,
      mimeType: remoteAsset.mimeType
    };
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
  return {
    filePath: file.filePath,
    fileName: asset.fileName,
    mimeType: asset.mimeType
  };
}

async function getRemotionServeUrl(): Promise<string> {
  if (!shouldReuseRemotionBundle()) {
    const { bundle } = await ensureRemotionRuntime();
    const executionRoot = resolveStage3ExecutionRoot();
    const entryPoint = path.join(executionRoot, "remotion", "index.tsx");
    const publicDir = path.join(executionRoot, "public");
    return bundle({
      entryPoint,
      publicDir,
      ignoreRegisterRootWarning: true
    });
  }

  if (!remotionServeUrlPromise) {
    remotionServeUrlPromise = ensureRemotionRuntime().then(({ bundle }) => {
      const executionRoot = resolveStage3ExecutionRoot();
      const entryPoint = path.join(executionRoot, "remotion", "index.tsx");
      const publicDir = path.join(executionRoot, "public");
      return bundle({
        entryPoint,
        publicDir,
        ignoreRegisterRootWarning: true
      });
    }).catch((error) => {
      remotionServeUrlPromise = null;
      throw error;
    });
  }
  return remotionServeUrlPromise;
}

async function getRemotionBrowser(): Promise<Stage3PreparedBrowser> {
  if (!remotionBrowserPromise) {
    remotionBrowserPromise = ensureStage3RenderBrowser({
      logLevel: "warn"
    })
      .then((prepared) => {
        process.env.STAGE3_BROWSER_EXECUTABLE = prepared.browserExecutable;
        return prepared;
      })
      .catch((error) => {
        remotionBrowserPromise = null;
        throw error;
      });
  }

  return remotionBrowserPromise;
}

function unwrapDefaultExport(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  return record.default ?? value;
}

function resolveFunction(sources: unknown[], key: string, optional = false): AsyncFn {
  for (const source of sources) {
    if (!source || typeof source !== "object") {
      continue;
    }
    const fn = (source as Record<string, unknown>)[key];
    if (typeof fn === "function") {
      return fn as AsyncFn;
    }
  }

  if (optional) {
    return null as unknown as AsyncFn;
  }

  throw new Error(`Remotion API is incomplete: missing function ${key}.`);
}

function isMemoryConstrainedRuntime(): boolean {
  return isStage3HostedRuntime();
}

function buildRenderMetadataTitle(rawTitle: string | null | undefined): string | null {
  const trimmed = rawTitle?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, 120);
}

function buildRenderFileStem(rawTitle: string | null | undefined, fallback: string): string {
  const normalize = (value: string): string =>
    value
      .trim()
      .toUpperCase()
      .replace(/['"`]/g, "")
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/_+/g, "_")
      .slice(0, 120);

  const preferred = rawTitle ? normalize(rawTitle) : "";
  if (preferred) {
    return preferred;
  }

  const fallbackStem = normalize(fallback);
  return fallbackStem || "RENDER";
}

async function finalizeRenderedOutput(params: {
  inputPath: string;
  audioInputPath?: string | null;
  outputPath: string;
  metadataTitle: string | null;
  durationSec?: number | null;
  variationProfile: Stage3VariationProfile;
  variationManifest: Stage3VariationManifest;
  variationManifestPath: string;
}): Promise<void> {
  const args = buildFinalizeRenderedOutputArgs(params);
  await execFileAsync("ffmpeg", args, {
    timeout: 90_000,
    maxBuffer: 1024 * 1024 * 8
  });

  await fs.writeFile(params.variationManifestPath, JSON.stringify(params.variationManifest, null, 2), "utf-8");
}

export function buildFinalizeRenderedOutputArgs(params: {
  inputPath: string;
  audioInputPath?: string | null;
  outputPath: string;
  metadataTitle: string | null;
  durationSec?: number | null;
  variationProfile: Stage3VariationProfile;
}): string[] {
  const audioInputPath = params.audioInputPath?.trim() || null;
  const durationSec =
    typeof params.durationSec === "number" && Number.isFinite(params.durationSec) && params.durationSec > 0
      ? params.durationSec
      : null;
  const args = [
    "-y",
    "-i",
    params.inputPath
  ];
  if (audioInputPath) {
    args.push("-i", audioInputPath);
  }

  args.push(
    "-map",
    "0:v:0",
    "-map",
    audioInputPath ? "1:a?" : "0:a?",
    "-map_metadata",
    "-1",
    "-map_metadata:s:v",
    "-1",
    "-map_metadata:s:a",
    "-1",
    "-map_chapters",
    "-1",
    "-vf",
    "format=yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    params.variationProfile.encode.x264Preset,
    "-crf",
    String(params.variationProfile.encode.crf),
    "-pix_fmt",
    params.variationProfile.encode.pixelFormat,
    "-g",
    String(params.variationProfile.encode.keyintFrames),
    "-keyint_min",
    String(params.variationProfile.encode.keyintMinFrames),
    "-sc_threshold",
    "0",
    "-color_range",
    "tv",
    "-colorspace",
    "bt709",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-c:a",
    "copy"
  );

  if (durationSec !== null) {
    args.push("-t", durationSec.toFixed(3));
  } else if (audioInputPath) {
    args.push("-shortest");
  }

  args.push(
    "-movflags",
    "+faststart",
    "-metadata",
    "comment=",
    "-metadata",
    "description=",
    "-metadata",
    "synopsis=",
    "-metadata",
    "artist=",
    "-metadata",
    "album=",
    "-metadata",
    "copyright=",
    "-metadata",
    "creation_time=",
    "-metadata",
    "encoder="
  );

  if (params.metadataTitle) {
    args.push("-metadata", `title=${params.metadataTitle}`);
  }

  args.push("-bitexact");
  args.push(params.outputPath);
  return args;
}

export function buildStage3SourceBackgroundStillFfmpegArgs(params: {
  inputPath: string;
  outputPath: string;
  width?: number;
  height?: number;
}): string[] {
  const width =
    typeof params.width === "number" && Number.isFinite(params.width)
      ? Math.max(2, Math.round(params.width))
      : 1080;
  const height =
    typeof params.height === "number" && Number.isFinite(params.height)
      ? Math.max(2, Math.round(params.height))
      : 1920;
  return [
    "-y",
    "-ss",
    "0",
    "-i",
    params.inputPath,
    "-frames:v",
    "1",
    "-vf",
    `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},gblur=sigma=18,eq=brightness=-0.08:saturation=1.05,format=yuv420p`,
    "-q:v",
    "3",
    params.outputPath
  ];
}

async function prepareStage3SourceBackgroundStill(params: {
  inputPath: string;
  outputPath: string;
}): Promise<void> {
  await execFileAsync("ffmpeg", buildStage3SourceBackgroundStillFfmpegArgs(params), {
    timeout: 60_000,
    maxBuffer: 1024 * 1024 * 8
  });
}

async function runRemotionRender(params: {
  serveUrl: string;
  templateId: string;
  templateConfigOverride: Stage3TemplateConfig;
  outputPath: string;
  sourceVideoFileName: string;
  topText: string;
  bottomText: string;
  sourceOverlayText: string;
  captionHighlights: TemplateCaptionHighlights;
  clipStartSec: number;
  clipDurationSec: number;
  focusX: number;
  focusY: number;
  mirrorEnabled: boolean;
  timingMode: Stage3RenderPlan["timingMode"];
  segments: Stage3RenderPlan["segments"];
  cameraMotion: Stage3RenderPlan["cameraMotion"];
  cameraKeyframes: Stage3RenderPlan["cameraKeyframes"];
  cameraPositionKeyframes: Stage3RenderPlan["cameraPositionKeyframes"];
  cameraScaleKeyframes: Stage3RenderPlan["cameraScaleKeyframes"];
  videoZoom: number;
  videoScaleY: number;
  videoBrightness: number;
  videoExposure: number;
  videoContrast: number;
  videoSaturation: number;
  topFontScale: number;
  bottomFontScale: number;
  authorName: string;
  authorHandle: string;
  avatarAssetFileName: string | null;
  avatarAssetMimeType: string | null;
  backgroundAssetFileName: string | null;
  backgroundAssetMimeType: string | null;
  sourceBlurBackgroundDisabled: boolean;
  textFit: {
    topFontPx: number;
    bottomFontPx: number;
    topLineHeight: number;
    bottomLineHeight: number;
    topLines: number;
    bottomLines: number;
    topCompacted: boolean;
    bottomCompacted: boolean;
  };
  variationProfile: Stage3VariationProfile;
  timeoutMs: number;
}): Promise<Stage3VariationProfile> {
  const { getCompositions, renderMedia, selectComposition } = await ensureRemotionRuntime();
  const serveUrl = params.serveUrl;
  const preparedBrowser = await getRemotionBrowser();
  const browserExecutable = preparedBrowser.browserExecutable;
  const chromeMode = preparedBrowser.chromeMode;

  const buildInputProps = (variationProfile: Stage3VariationProfile) => ({
    templateId: params.templateId,
    templateConfigOverride: params.templateConfigOverride,
    sourceVideoFileName: params.sourceVideoFileName,
    topText: params.topText,
    bottomText: params.bottomText,
    sourceOverlayText: params.sourceOverlayText,
    captionHighlights: params.captionHighlights,
    clipStartSec: params.clipStartSec,
    clipDurationSec: params.clipDurationSec,
    focusX: params.focusX,
    focusY: params.focusY,
    mirrorEnabled: params.mirrorEnabled,
    timingMode: params.timingMode,
    segments: params.segments,
    cameraMotion: params.cameraMotion,
    cameraKeyframes: params.cameraKeyframes,
    cameraPositionKeyframes: params.cameraPositionKeyframes,
    cameraScaleKeyframes: params.cameraScaleKeyframes,
    videoZoom: params.videoZoom,
    videoScaleY: params.videoScaleY,
    videoBrightness: params.videoBrightness,
    videoExposure: params.videoExposure,
    videoContrast: params.videoContrast,
    videoSaturation: params.videoSaturation,
    topFontScale: params.topFontScale,
    bottomFontScale: params.bottomFontScale,
    authorName: params.authorName,
    authorHandle: params.authorHandle,
    avatarAssetFileName: params.avatarAssetFileName,
    avatarAssetMimeType: params.avatarAssetMimeType,
    backgroundAssetFileName: params.backgroundAssetFileName,
    backgroundAssetMimeType: params.backgroundAssetMimeType,
    sourceBlurBackgroundDisabled: params.sourceBlurBackgroundDisabled,
    textFit: params.textFit,
    variationProfile
  });

  const inputProps = buildInputProps(params.variationProfile);

  const composition =
    (selectComposition
      ? await selectComposition({
          id: params.templateId,
          serveUrl,
          inputProps,
          browserExecutable,
          chromeMode
        })
      : null) ??
    (await getCompositions(serveUrl)).find((item: { id?: string }) => item.id === params.templateId);

  if (!composition) {
    throw new Error(`Composition ${params.templateId} не найден в remotion-сборке.`);
  }

  const renderArgs = {
    composition: composition as { id: string } & Record<string, unknown>,
    serveUrl,
    outputLocation: params.outputPath,
    inputProps,
    codec: params.variationProfile.encode.codec,
    crf: params.variationProfile.encode.crf,
    pixelFormat: params.variationProfile.encode.pixelFormat,
    x264Preset: params.variationProfile.encode.x264Preset,
    logLevel: "warn",
    timeoutInMilliseconds: params.timeoutMs,
    browserExecutable,
    chromeMode,
    concurrency: isMemoryConstrainedRuntime() ? MEMORY_CONSTRAINED_REMOTION_CONCURRENCY : null,
    disallowParallelEncoding: isMemoryConstrainedRuntime(),
    chromiumOptions: isMemoryConstrainedRuntime()
      ? {
          enableMultiProcessOnLinux: false,
          gl: null
        }
      : undefined,
    offthreadVideoThreads: isMemoryConstrainedRuntime() ? 1 : undefined,
    offthreadVideoCacheSizeInBytes: isMemoryConstrainedRuntime() ? 32 * 1024 * 1024 : undefined,
    mediaCacheSizeInBytes: isMemoryConstrainedRuntime() ? 32 * 1024 * 1024 : undefined,
    ffmpegOverride: ({ type, args }: { type: "pre-stitcher" | "stitcher"; args: string[] }) => {
      if (type !== "stitcher" || args.length === 0) {
        return args;
      }
      const outputLocation = args.at(-1);
      if (!outputLocation) {
        return args;
      }
      return [
        ...args.slice(0, -1),
        "-g",
        String(params.variationProfile.encode.keyintFrames),
        "-keyint_min",
        String(params.variationProfile.encode.keyintMinFrames),
        outputLocation
      ];
    }
  };

  const renderOnce = async (props: typeof inputProps) => {
    try {
      await renderMedia({
        ...renderArgs,
        inputProps: props
      });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      const shouldRetryWithLegacyProps =
        message.includes("inputprops") ||
        (message.includes("props") && (message.includes("missing") || message.includes("unexpected")));
      if (!shouldRetryWithLegacyProps) {
        throw error;
      }
      await renderMedia({
        ...renderArgs,
        props,
        inputProps: undefined
      });
    }
  };

  try {
    await renderOnce(inputProps);
    return params.variationProfile;
  } catch (error) {
    if (!params.variationProfile.signal.enabled || params.variationProfile.appliedMode !== "hybrid") {
      throw error;
    }
    const fallbackProfile = createStage3SignalFallbackProfile(params.variationProfile);
    await renderOnce(buildInputProps(fallbackProfile));
    return fallbackProfile;
  }
}

function resolveSourceUrl(rawSource: string | undefined): string {
  const sourceUrl = normalizeSupportedUrl(rawSource?.trim() ?? "");
  if (!sourceUrl) {
    throw new Error("Передайте sourceUrl в теле запроса.");
  }
  if (!isSupportedUrl(sourceUrl)) {
    throw new Error("Не удалось подготовить исходное видео для рендера. Проверьте ссылку на ролик из Шага 1.");
  }
  return sourceUrl;
}

export function normalizeRenderPlan(
  rawPlan: Partial<Stage3RenderPlan> | undefined,
  sourceDurationSec: number | null,
  fallbackTemplateId: string,
  agentPrompt: string | undefined,
  managedTemplateState?: Stage3StateSnapshot["managedTemplateState"],
  workspaceId?: string | null
): Stage3RenderPlan {
  const template = resolveManagedTemplateRuntimeSync(fallbackTemplateId, managedTemplateState, {
    workspaceId
  }).templateConfig;
  const templateVideoAdjustments = template.videoAdjustments;
  const textScaleDefaults = resolveStage3TemplateDefaultTextScales(template, DEFAULT_TEXT_SCALE);
  const policyFallback =
    sourceDurationSec !== null && sourceDurationSec > 12 ? "adaptive_window" : "full_source_normalize";
  const durationMode = normalizeStage3DurationMode(rawPlan?.durationMode);
  const targetDurationSec = resolveStage3OutputDurationSec({
    mode: durationMode,
    targetDurationSec: rawPlan?.targetDurationSec,
    sourceDurationSec,
    fallback: DEFAULT_STAGE3_CLIP_DURATION_SEC
  });
  const videoZoom =
    typeof rawPlan?.videoZoom === "number" && Number.isFinite(rawPlan.videoZoom)
      ? Math.min(STAGE3_MAX_VIDEO_ZOOM, Math.max(STAGE3_MIN_VIDEO_ZOOM, rawPlan.videoZoom))
      : 1;
  const videoScaleY = normalizeStage3VideoScaleY(rawPlan?.videoScaleY);
  const cameraTracks = resolveStage3EffectiveCameraTracks({
    cameraPositionKeyframes: rawPlan?.cameraPositionKeyframes,
    cameraScaleKeyframes: rawPlan?.cameraScaleKeyframes,
    cameraKeyframes: rawPlan?.cameraKeyframes,
    cameraMotion: rawPlan?.cameraMotion,
    clipDurationSec: targetDurationSec,
    baseFocusY: 0.5,
    baseZoom: videoZoom
  });
  const segments = normalizeStage3RenderPlanSegments(rawPlan?.segments);
  const normalizeToTargetEnabled =
    typeof rawPlan?.normalizeToTargetEnabled === "boolean"
      ? rawPlan.normalizeToTargetEnabled
      : rawPlan?.timingMode === "compress" ||
          rawPlan?.timingMode === "stretch" ||
          rawPlan?.policy === "full_source_normalize" ||
          durationMode === "source_full";
  return {
    targetDurationSec,
    durationMode,
    timingMode:
      rawPlan?.timingMode === "compress" || rawPlan?.timingMode === "stretch" || rawPlan?.timingMode === "auto"
        ? rawPlan.timingMode
        : "auto",
    normalizeToTargetEnabled,
    editorSelectionMode:
      rawPlan?.editorSelectionMode === "window" || rawPlan?.editorSelectionMode === "fragments"
        ? rawPlan.editorSelectionMode
        : undefined,
    audioMode:
      rawPlan?.audioMode === "source_only" || rawPlan?.audioMode === "source_plus_music"
        ? rawPlan.audioMode
        : "source_only",
    sourceAudioEnabled: Boolean(rawPlan?.sourceAudioEnabled ?? true),
    smoothSlowMo: Boolean(rawPlan?.smoothSlowMo),
    mirrorEnabled: Boolean(rawPlan?.mirrorEnabled ?? true),
    cameraMotion: normalizeStage3CameraMotion(rawPlan?.cameraMotion),
    cameraKeyframes: normalizeStage3CameraKeyframes(rawPlan?.cameraKeyframes, {
      clipDurationSec: targetDurationSec,
      fallbackFocusY: 0.5,
      fallbackZoom: videoZoom
    }),
    cameraPositionKeyframes: cameraTracks.positionKeyframes,
    cameraScaleKeyframes: cameraTracks.scaleKeyframes,
    focusX:
      typeof rawPlan?.focusX === "number" && Number.isFinite(rawPlan.focusX)
        ? clampStage3FocusX(rawPlan.focusX)
        : 0.5,
    videoZoom,
    videoScaleY,
    videoBrightness: normalizeStage3VideoBrightness(rawPlan?.videoBrightness, templateVideoAdjustments.brightness),
    videoExposure: normalizeStage3VideoExposure(rawPlan?.videoExposure, templateVideoAdjustments.exposure),
    videoContrast: normalizeStage3VideoContrast(rawPlan?.videoContrast, templateVideoAdjustments.contrast),
    videoSaturation: normalizeStage3VideoSaturation(rawPlan?.videoSaturation, templateVideoAdjustments.saturation),
    sourceCrop: normalizeStage3SourceCrop(rawPlan?.sourceCrop, null),
    topFontScale:
      typeof rawPlan?.topFontScale === "number" && Number.isFinite(rawPlan.topFontScale)
        ? clampStage3TextScaleUi(rawPlan.topFontScale)
        : textScaleDefaults.topFontScale,
    bottomFontScale:
      typeof rawPlan?.bottomFontScale === "number" && Number.isFinite(rawPlan.bottomFontScale)
        ? clampStage3TextScaleUi(rawPlan.bottomFontScale)
        : textScaleDefaults.bottomFontScale,
    sourceAudioGain:
      typeof rawPlan?.sourceAudioGain === "number" && Number.isFinite(rawPlan.sourceAudioGain)
        ? Math.min(2, Math.max(0, rawPlan.sourceAudioGain))
        : 1,
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
    templateId:
      typeof rawPlan?.templateId === "string" && rawPlan.templateId.trim()
        ? rawPlan.templateId.trim()
        : fallbackTemplateId,
    prompt: rawPlan?.prompt?.trim() || agentPrompt?.trim() || ""
  };
}

function parseRenderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  const ytdlpMessage = extractYtDlpErrorFromUnknown(error);
  if (lower.includes("chrome headless shell") || lower.includes("storage.googleapis.com")) {
    return "Stage 3 worker не смог подготовить браузер для Remotion. Проверьте локальный Chrome/Edge или доступ к Remotion browser download.";
  }
  if (lower.includes("ffmpeg")) {
    return "Ошибка ffmpeg/Remotion rendering. Проверьте ffmpeg и remotion runtime.";
  }
  if (ytdlpMessage) {
    return ytdlpMessage;
  }
  if (lower.includes("remotion")) {
    return message;
  }
  return message || "Не удалось отрендерить видео.";
}

export async function renderStage3Video(
  body: Stage3RenderRequestBody,
  options?: { signal?: AbortSignal; waitTimeoutMs?: number | null }
): Promise<Stage3RenderedVideo> {
  const sourceUrl = resolveSourceUrl(body.sourceUrl);
  const configuredTimeout = Number.parseInt(process.env.REMOTION_RENDER_TIMEOUT_MS ?? "", 10);
  const timeoutMs =
    Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? configuredTimeout
      : REMOTION_RENDER_TIMEOUT_MS;
  const waitTimeoutMs =
    typeof options?.waitTimeoutMs === "number" && Number.isFinite(options.waitTimeoutMs) && options.waitTimeoutMs > 0
      ? options.waitTimeoutMs
      : RENDER_WAIT_TIMEOUT_MS;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clip-stage3-job-render-"));
  try {
    const source = await ensureStage3SourceCached(sourceUrl, {
      signal: options?.signal,
      waitTimeoutMs
    });
    const sourceDurationSec = source.sourceDurationSec;
    const clipDurationSec = sanitizeClipDuration(body.clipDurationSec);
    const snapshot = body.snapshot;
    const workspaceId = body.workspaceId?.trim() || null;
    const requestedClipStart =
      typeof snapshot?.clipStartSec === "number" && Number.isFinite(snapshot.clipStartSec)
        ? snapshot.clipStartSec
        : typeof body.clipStartSec === "number" && Number.isFinite(body.clipStartSec)
          ? body.clipStartSec
          : null;
    const requestedFocus =
      typeof snapshot?.focusY === "number" && Number.isFinite(snapshot.focusY)
        ? snapshot.focusY
        : typeof body.focusY === "number" && Number.isFinite(body.focusY)
          ? body.focusY
          : null;

    const auto =
      requestedClipStart === null || requestedFocus === null
        ? await runHostedStage3HeavyJob(
            () => analyzeBestClipAndFocus(source.sourcePath, tmpDir, sourceDurationSec, clipDurationSec),
            {
              signal: options?.signal,
              waitTimeoutMs
            }
          )
        : { clipStartSec: 0, focusY: 0.5 };

    const clipStartSec = clampClipStart(requestedClipStart ?? auto.clipStartSec, sourceDurationSec, clipDurationSec);
    const focusY = sanitizeFocusY(requestedFocus ?? auto.focusY);
    const templateIdFromInput =
      typeof (snapshot?.renderPlan as Partial<Stage3RenderPlan> | undefined)?.templateId === "string" &&
      (snapshot?.renderPlan as Partial<Stage3RenderPlan>).templateId?.trim()
        ? String((snapshot?.renderPlan as Partial<Stage3RenderPlan>).templateId).trim()
        : typeof body.renderPlan?.templateId === "string" && body.renderPlan.templateId.trim()
          ? body.renderPlan.templateId.trim()
          : body.templateId?.trim() || STAGE3_TEMPLATE_ID;
    const renderPlan = normalizeRenderPlan(
      snapshot?.renderPlan ?? body.renderPlan,
      sourceDurationSec,
      templateIdFromInput,
      body.agentPrompt,
      snapshot?.managedTemplateState,
      workspaceId
    );
    const managedTemplateRuntime = resolveManagedTemplateRuntimeSync(
      renderPlan.templateId,
      snapshot?.managedTemplateState,
      { workspaceId }
    );
    const templateSnapshotContent = {
      topText: snapshot?.topText ?? body.topText ?? "",
      bottomText: snapshot?.bottomText ?? body.bottomText ?? "",
      sourceOverlayText: snapshot?.sourceOverlayText ?? body.sourceOverlayText ?? "",
      channelName: renderPlan.authorName,
      channelHandle: renderPlan.authorHandle,
      highlights: snapshot?.captionHighlights ?? { top: [], bottom: [] },
      topFontScale: renderPlan.topFontScale,
      bottomFontScale: renderPlan.bottomFontScale,
      previewScale: 1,
      mediaAsset: null,
      backgroundAsset: null,
      avatarAsset: null
    };
    const requestedTextFitOverride = snapshot?.textFit
      ? {
          topFontPx: snapshot.textFit.topFontPx,
          bottomFontPx: snapshot.textFit.bottomFontPx,
          topLineHeight: snapshot.textFit.topLineHeight,
          bottomLineHeight: snapshot.textFit.bottomLineHeight,
          topLines: snapshot.textFit.topLines,
          bottomLines: snapshot.textFit.bottomLines,
          topCompacted: snapshot.textFit.topCompacted,
          bottomCompacted: snapshot.textFit.bottomCompacted
        }
      : undefined;
    const baseTemplateSnapshot = buildTemplateRenderSnapshot({
      templateId: managedTemplateRuntime.baseTemplateId,
      templateConfigOverride: managedTemplateRuntime.templateConfig,
      content: templateSnapshotContent
    });
    // The client sends templateSnapshot from the base preview model and textFit separately.
    // Drift checks must stay anchored to the base snapshot hash, then measured text fit can be applied for render.
    const textFitTemplateSnapshot = requestedTextFitOverride
      ? buildTemplateRenderSnapshot({
          templateId: managedTemplateRuntime.baseTemplateId,
          templateConfigOverride: managedTemplateRuntime.templateConfig,
          content: templateSnapshotContent,
          fitOverride: requestedTextFitOverride
        })
      : null;
    assertStage3RenderTemplateSnapshotFresh({
      snapshot,
      baseTemplateSnapshot,
      textFitTemplateSnapshot
    });
    const templateSnapshot = textFitTemplateSnapshot ?? baseTemplateSnapshot;

    let musicFilePath: string | null = null;
    if (body.channelId && renderPlan.musicAssetId) {
      const musicFile = await resolveStage3AssetFile({
        channelId: body.channelId,
        assetId: renderPlan.musicAssetId,
        tmpDir
      });
      if (musicFile) {
        musicFilePath = musicFile.filePath;
      }
    }

    const metadataTitle = buildRenderMetadataTitle(body.renderTitle);
    const outputStem = buildRenderFileStem(body.renderTitle, source.fileName);
    const remotionOutputPath = path.join(tmpDir, "render.raw.mp4");
    const outputPath = path.join(tmpDir, `${outputStem}.mp4`);
    const variationManifestPath = path.join(tmpDir, `${outputStem}.variation.json`);
    const variationProfile = createStage3VariationProfile({
      requestedSeed: body.variationSeed
    });
    let appliedVariationManifest = buildStage3VariationManifest({
      profile: variationProfile,
      templateId: renderPlan.templateId || STAGE3_TEMPLATE_ID,
      snapshotHash: templateSnapshot.snapshotHash,
      specRevision: templateSnapshot.specRevision,
      fitRevision: templateSnapshot.fitRevision,
      outputName: `${outputStem}.mp4`
    });

    await runHostedStage3HeavyJob(async () => {
      const serveUrl = await getRemotionServeUrl();
      const assetToken = randomUUID().replace(/-/g, "");
      const remotionAssetDir = path.join(serveUrl, "public", "stage3-assets", assetToken);
      const remotionAssetBase = path.posix.join("stage3-assets", assetToken);
      await fs.mkdir(remotionAssetDir, { recursive: true });

      const prepared = await prepareStage3SourceClip({
        sourcePath: source.sourcePath,
        tmpDir,
        sourceDurationSec,
        clipStartSec,
        clipDurationSec: renderPlan.targetDurationSec,
        renderPlan,
        musicFilePath,
        profile: "render"
      });

      const sourceVideoFileName = path.posix.join(remotionAssetBase, "source.mp4");
      await fs.copyFile(prepared.preparedPath, path.join(remotionAssetDir, "source.mp4"));

      let backgroundAssetFileName: string | null = null;
      let backgroundAssetMimeType: string | null = null;
      let sourceBlurBackgroundDisabled = false;
      let avatarAssetFileName: string | null = null;
      let avatarAssetMimeType: string | null = null;
      try {
        if (
          !renderPlan.backgroundAssetId &&
          resolveStage3BackgroundMode(managedTemplateRuntime.baseTemplateId, {
            hasCustomBackground: false,
            hasSourceVideo: true
          }) === "source-blur"
        ) {
          const localFileName = "background.jpg";
          try {
            await prepareStage3SourceBackgroundStill({
              inputPath: prepared.preparedPath,
              outputPath: path.join(remotionAssetDir, localFileName)
            });
            backgroundAssetFileName = path.posix.join(remotionAssetBase, localFileName);
            backgroundAssetMimeType = "image/jpeg";
          } catch {
            sourceBlurBackgroundDisabled = true;
          }
        }

        if (body.channelId && renderPlan.backgroundAssetId) {
          const asset = await resolveStage3AssetFile({
            channelId: body.channelId,
            assetId: renderPlan.backgroundAssetId,
            tmpDir
          });
          if (asset) {
            const ext = path.extname(asset.fileName) || ".jpg";
            const localFileName = `background${ext.toLowerCase()}`;
            backgroundAssetFileName = path.posix.join(remotionAssetBase, localFileName);
            await fs.copyFile(asset.filePath, path.join(remotionAssetDir, localFileName));
            backgroundAssetMimeType = asset.mimeType;
          }
        }

        if (body.channelId && renderPlan.avatarAssetId) {
          const asset = await resolveStage3AssetFile({
            channelId: body.channelId,
            assetId: renderPlan.avatarAssetId,
            tmpDir
          });
          if (asset) {
            const ext = path.extname(asset.fileName) || ".jpg";
            const localFileName = `avatar${ext.toLowerCase()}`;
            avatarAssetFileName = path.posix.join(remotionAssetBase, localFileName);
            await fs.copyFile(asset.filePath, path.join(remotionAssetDir, localFileName));
            avatarAssetMimeType = asset.mimeType;
          }
        }
        if (body.copscopes && (!renderPlan.avatarAssetId || !avatarAssetFileName)) {
          throw new Error("CopScopes render blocked: channel avatar asset is required and must resolve before publication.");
        }

        const renderTemplateConfig = await prepareStage3TemplateFontAssetsForRender({
          templateConfig: managedTemplateRuntime.templateConfig,
          workspaceId,
          remotionAssetDir,
          remotionAssetBase
        });

        const appliedVariationProfile = await runRemotionRender({
          serveUrl,
          templateId: managedTemplateRuntime.baseTemplateId,
          templateConfigOverride: renderTemplateConfig,
          outputPath: remotionOutputPath,
          sourceVideoFileName,
          topText: templateSnapshot.content.topText,
          bottomText: templateSnapshot.content.bottomText,
          sourceOverlayText: templateSnapshot.content.sourceOverlayText ?? "",
          captionHighlights: templateSnapshot.content.highlights,
          clipStartSec: prepared.clipStartSec,
          clipDurationSec: prepared.clipDurationSec,
          focusX: renderPlan.focusX,
          focusY,
          mirrorEnabled: renderPlan.mirrorEnabled,
          timingMode: renderPlan.timingMode,
          segments: renderPlan.segments,
          cameraMotion: renderPlan.cameraMotion,
          cameraKeyframes: renderPlan.cameraKeyframes,
          cameraPositionKeyframes: renderPlan.cameraPositionKeyframes,
          cameraScaleKeyframes: renderPlan.cameraScaleKeyframes,
          videoZoom: renderPlan.videoZoom,
          videoScaleY: renderPlan.videoScaleY,
          videoBrightness: renderPlan.videoBrightness,
          videoExposure: renderPlan.videoExposure,
          videoContrast: renderPlan.videoContrast,
          videoSaturation: renderPlan.videoSaturation,
          topFontScale: renderPlan.topFontScale,
          bottomFontScale: renderPlan.bottomFontScale,
          authorName: renderPlan.authorName,
          authorHandle: renderPlan.authorHandle,
          avatarAssetFileName,
          avatarAssetMimeType,
          backgroundAssetFileName,
          backgroundAssetMimeType,
          sourceBlurBackgroundDisabled,
          textFit: {
            topFontPx: templateSnapshot.fit.topFontPx,
            bottomFontPx: templateSnapshot.fit.bottomFontPx,
            topLineHeight: templateSnapshot.fit.topLineHeight,
            bottomLineHeight: templateSnapshot.fit.bottomLineHeight,
            topLines: templateSnapshot.fit.topLines,
            bottomLines: templateSnapshot.fit.bottomLines,
            topCompacted: templateSnapshot.fit.topCompacted,
            bottomCompacted: templateSnapshot.fit.bottomCompacted
          },
          variationProfile,
          timeoutMs
        });

        appliedVariationManifest = buildStage3VariationManifest({
          profile: appliedVariationProfile,
          templateId: renderPlan.templateId || STAGE3_TEMPLATE_ID,
          snapshotHash: templateSnapshot.snapshotHash,
          specRevision: templateSnapshot.specRevision,
          fitRevision: templateSnapshot.fitRevision,
          outputName: `${outputStem}.mp4`
        });

        const flashGuarded = await repairStage3BlankFlashFrames({
          inputPath: remotionOutputPath,
          outputPath: path.join(tmpDir, "render.flash-guard.mp4"),
          mediaRect: templateSnapshot.layout.media
        });

        await finalizeRenderedOutput({
          inputPath: flashGuarded.outputPath,
          audioInputPath: prepared.preparedPath,
          outputPath,
          metadataTitle,
          durationSec: renderPlan.targetDurationSec,
          variationProfile: appliedVariationProfile,
          variationManifest: appliedVariationManifest,
          variationManifestPath
        });
      } finally {
        await fs.rm(remotionAssetDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }, {
      signal: options?.signal,
      waitTimeoutMs
    });

    return {
      filePath: outputPath,
      outputName: `${outputStem}.mp4`,
      topCompacted: templateSnapshot.fit.topCompacted,
      bottomCompacted: templateSnapshot.fit.bottomCompacted,
      cleanupDir: tmpDir,
      variationManifest: appliedVariationManifest,
      variationManifestPath
    };
  } catch (error) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export function summarizeStage3RenderError(error: unknown): string {
  return parseRenderError(error);
}
