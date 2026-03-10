import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  STAGE3_TEMPLATE_ID,
  getTemplateById,
  getTemplateComputed
} from "./stage3-template";
import {
  analyzeBestClipAndFocus,
  clampClipStart,
  prepareStage3SourceClip,
  sanitizeClipDuration,
  sanitizeFocusY
} from "./stage3-media-agent";
import { maybeDownloadStage3WorkerAsset } from "./stage3-worker-asset-client";
import { extractYtDlpErrorFromUnknown, isSupportedUrl, normalizeSupportedUrl } from "./ytdlp";
import { Stage3RenderPlan } from "./stage3-agent";
import { Stage3StateSnapshot } from "../app/components/types";
import { STAGE3_MAX_VIDEO_ZOOM, STAGE3_MIN_VIDEO_ZOOM } from "./stage3-constants";
import {
  ensureStage3SourceCached,
  isStage3HostedRuntime,
  runHostedStage3HeavyJob
} from "./stage3-server-control";

export const REMOTION_RENDER_TIMEOUT_MS = 9 * 60_000;
export const RENDER_WAIT_TIMEOUT_MS = 60_000;

const DEFAULT_TEXT_SCALE = 1.25;
const execFileAsync = promisify(execFile);
const MEMORY_CONSTRAINED_REMOTION_CONCURRENCY = 1;
const SEGMENT_SPEED_SET = new Set<number>([1, 1.5, 2, 2.5, 3, 4, 5]);
let remotionServeUrlPromise: Promise<string> | null = null;
let remotionRuntimePromise: Promise<RemotionModule> | null = null;

function resolveStage3ExecutionRoot(): string {
  const workerRoot = process.env.STAGE3_WORKER_INSTALL_ROOT?.trim();
  if (workerRoot) {
    return workerRoot;
  }
  return process.cwd();
}

export type Stage3RenderRequestBody = {
  sourceUrl?: string;
  channelId?: string;
  renderTitle?: string;
  topText?: string;
  bottomText?: string;
  templateId?: string;
  clipStartSec?: number;
  clipDurationSec?: number;
  focusY?: number;
  agentPrompt?: string;
  renderPlan?: Partial<Stage3RenderPlan>;
  snapshot?: Partial<Stage3StateSnapshot>;
};

export type Stage3RenderedVideo = {
  filePath: string;
  outputName: string;
  topCompacted: boolean;
  bottomCompacted: boolean;
  cleanupDir: string;
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

function normalizeCameraMotion(value: unknown): Stage3RenderPlan["cameraMotion"] {
  return value === "top_to_bottom" || value === "bottom_to_top" ? value : "disabled";
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

async function rewriteRenderedMetadata(params: {
  inputPath: string;
  outputPath: string;
  metadataTitle: string | null;
}): Promise<void> {
  const args = [
    "-y",
    "-i",
    params.inputPath,
    "-map",
    "0",
    "-map_metadata",
    "-1",
    "-map_metadata:s:v",
    "-1",
    "-map_metadata:s:a",
    "-1",
    "-map_chapters",
    "-1",
    "-fflags",
    "+bitexact",
    "-flags:v",
    "+bitexact",
    "-flags:a",
    "+bitexact",
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    "-empty_hdlr_name",
    "1",
    "-write_tmcd",
    "false",
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
  ];

  if (params.metadataTitle) {
    args.push("-metadata", `title=${params.metadataTitle}`);
  }

  args.push(params.outputPath);

  await execFileAsync("ffmpeg", args, {
    timeout: 90_000,
    maxBuffer: 1024 * 1024 * 8
  });
}

async function runRemotionRender(params: {
  templateId: string;
  outputPath: string;
  sourceVideoFileName: string;
  topText: string;
  bottomText: string;
  clipStartSec: number;
  clipDurationSec: number;
  focusY: number;
  mirrorEnabled: boolean;
  cameraMotion: Stage3RenderPlan["cameraMotion"];
  videoZoom: number;
  topFontScale: number;
  bottomFontScale: number;
  authorName: string;
  authorHandle: string;
  avatarAssetFileName: string | null;
  avatarAssetMimeType: string | null;
  backgroundAssetFileName: string | null;
  backgroundAssetMimeType: string | null;
  timeoutMs: number;
}) {
  const { getCompositions, renderMedia, selectComposition } = await ensureRemotionRuntime();
  const serveUrl = await getRemotionServeUrl();

  const inputProps = {
    templateId: params.templateId,
    sourceVideoFileName: params.sourceVideoFileName,
    topText: params.topText,
    bottomText: params.bottomText,
    clipStartSec: params.clipStartSec,
    clipDurationSec: params.clipDurationSec,
    focusY: params.focusY,
    mirrorEnabled: params.mirrorEnabled,
    cameraMotion: params.cameraMotion,
    videoZoom: params.videoZoom,
    topFontScale: params.topFontScale,
    bottomFontScale: params.bottomFontScale,
    authorName: params.authorName,
    authorHandle: params.authorHandle,
    avatarAssetFileName: params.avatarAssetFileName,
    avatarAssetMimeType: params.avatarAssetMimeType,
    backgroundAssetFileName: params.backgroundAssetFileName,
    backgroundAssetMimeType: params.backgroundAssetMimeType
  };

  const composition =
    (selectComposition
      ? await selectComposition({ id: params.templateId, serveUrl, inputProps })
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
    codec: "h264",
    crf: 18,
    logLevel: "warn",
    timeoutInMilliseconds: params.timeoutMs,
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
    mediaCacheSizeInBytes: isMemoryConstrainedRuntime() ? 32 * 1024 * 1024 : undefined
  };

  try {
    await renderMedia(renderArgs);
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
      props: inputProps,
      inputProps: undefined
    });
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

function normalizeRenderPlan(
  rawPlan: Partial<Stage3RenderPlan> | undefined,
  sourceDurationSec: number | null,
  fallbackTemplateId: string,
  agentPrompt: string | undefined
): Stage3RenderPlan {
  const template = getTemplateById(fallbackTemplateId);
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
    sourceAudioEnabled: Boolean(rawPlan?.sourceAudioEnabled ?? true),
    smoothSlowMo: Boolean(rawPlan?.smoothSlowMo),
    mirrorEnabled: Boolean(rawPlan?.mirrorEnabled ?? true),
    cameraMotion: normalizeCameraMotion(rawPlan?.cameraMotion),
    videoZoom:
      typeof rawPlan?.videoZoom === "number" && Number.isFinite(rawPlan.videoZoom)
        ? Math.min(STAGE3_MAX_VIDEO_ZOOM, Math.max(STAGE3_MIN_VIDEO_ZOOM, rawPlan.videoZoom))
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
    const renderPlan = normalizeRenderPlan(snapshot?.renderPlan ?? body.renderPlan, sourceDurationSec, templateIdFromInput, body.agentPrompt);
    const computed = getTemplateComputed(
      renderPlan.templateId,
      snapshot?.topText ?? body.topText ?? "",
      snapshot?.bottomText ?? body.bottomText ?? "",
      {
        topFontScale: renderPlan.topFontScale,
        bottomFontScale: renderPlan.bottomFontScale
      }
    );

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
      let avatarAssetFileName: string | null = null;
      let avatarAssetMimeType: string | null = null;
      try {
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

        await runRemotionRender({
          templateId: renderPlan.templateId || STAGE3_TEMPLATE_ID,
          outputPath: remotionOutputPath,
          sourceVideoFileName,
          topText: computed.top,
          bottomText: computed.bottom,
          clipStartSec: prepared.clipStartSec,
          clipDurationSec: prepared.clipDurationSec,
          focusY,
          mirrorEnabled: renderPlan.mirrorEnabled,
          cameraMotion: renderPlan.cameraMotion,
          videoZoom: renderPlan.videoZoom,
          topFontScale: renderPlan.topFontScale,
          bottomFontScale: renderPlan.bottomFontScale,
          authorName: renderPlan.authorName,
          authorHandle: renderPlan.authorHandle,
          avatarAssetFileName,
          avatarAssetMimeType,
          backgroundAssetFileName,
          backgroundAssetMimeType,
          timeoutMs
        });

        await rewriteRenderedMetadata({
          inputPath: remotionOutputPath,
          outputPath,
          metadataTitle
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
      topCompacted: computed.topCompacted,
      bottomCompacted: computed.bottomCompacted,
      cleanupDir: tmpDir
    };
  } catch (error) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export function summarizeStage3RenderError(error: unknown): string {
  return parseRenderError(error);
}
