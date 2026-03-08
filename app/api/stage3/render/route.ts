import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import {
  STAGE3_TEMPLATE_ID,
  getTemplateById,
  getTemplateComputed
} from "../../../../lib/stage3-template";
import {
  analyzeBestClipAndFocus,
  clampClipStart,
  downloadSourceVideo,
  prepareStage3SourceClip,
  probeVideoDurationSeconds,
  sanitizeClipDuration,
  sanitizeFocusY
} from "../../../../lib/stage3-media-agent";
import { extractYtDlpErrorFromUnknown, isSupportedUrl } from "../../../../lib/ytdlp";
import { Stage3RenderPlan } from "../../../../lib/stage3-agent";
import { Stage3StateSnapshot } from "../../../../app/components/types";
import { getChannelAssetById } from "../../../../lib/chat-history";
import { readChannelAssetFile } from "../../../../lib/channel-assets";
import { requireAuth, requireChannelVisibility } from "../../../../lib/auth/guards";

export const runtime = "nodejs";

const REMOTION_RENDER_TIMEOUT_MS = 9 * 60_000;
const DEFAULT_TEXT_SCALE = 1.25;
const execFileAsync = promisify(execFile);
const MEMORY_CONSTRAINED_REMOTION_CONCURRENCY = 1;

type RenderBody = {
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

type AsyncFn = (...args: any[]) => Promise<any>;

type RemotionModule = {
  bundle: AsyncFn;
  getCompositions: AsyncFn;
  renderMedia: AsyncFn;
  selectComposition: AsyncFn | null;
};

function ensureRemotionRuntime(): RemotionModule {
  const runtimeRequire = createRequire(import.meta.url);
  const rendererModule = runtimeRequire("@remotion/renderer");
  const bundlerModule = runtimeRequire("@remotion/bundler");
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

function isMemoryConstrainedRuntime(): boolean {
  return process.env.RENDER === "true" || process.env.RENDER === "1";
}

function scheduleDirectoryCleanup(dirPath: string): void {
  const cleanup = () => {
    void fs.rm(dirPath, { recursive: true, force: true }).catch(() => undefined);
  };
  const timer = setTimeout(cleanup, 120_000);
  timer.unref?.();
}

async function createVideoAttachmentResponse(
  filePath: string,
  attachmentName: string,
  extraHeaders?: Record<string, string>
): Promise<Response> {
  const stat = await fs.stat(filePath);
  const stream = createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${attachmentName}"`,
      ...extraHeaders
    }
  });
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
  publicDir: string;
  outputPath: string;
  topText: string;
  bottomText: string;
  clipStartSec: number;
  clipDurationSec: number;
  focusY: number;
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
  const { bundle, getCompositions, renderMedia, selectComposition } = ensureRemotionRuntime();
  const entryPoint = path.join(process.cwd(), "remotion", "index.tsx");

  const serveUrl = await bundle({
    entryPoint,
    publicDir: params.publicDir,
    ignoreRegisterRootWarning: true
  });

  const inputProps = {
    templateId: params.templateId,
    topText: params.topText,
    bottomText: params.bottomText,
    clipStartSec: params.clipStartSec,
    clipDurationSec: params.clipDurationSec,
    focusY: params.focusY,
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
  } catch {
    await renderMedia({
      ...renderArgs,
      props: inputProps,
      inputProps: undefined
    });
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as RenderBody | null;
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

  const configuredTimeout = Number.parseInt(process.env.REMOTION_RENDER_TIMEOUT_MS ?? "", 10);
  const timeoutMs =
    Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? configuredTimeout
      : REMOTION_RENDER_TIMEOUT_MS;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clip-stage3-"));
  let cleanupScheduled = false;

  try {
    const auth = await requireAuth();
    if (body?.channelId?.trim()) {
      await requireChannelVisibility(auth, body.channelId.trim());
    }
    const downloaded = await downloadSourceVideo(rawSource, tmpDir);
    const sourceDurationSec = await probeVideoDurationSeconds(downloaded.filePath);
    const clipDurationSec = sanitizeClipDuration(body?.clipDurationSec);

    const snapshot = body?.snapshot;
    const requestedClipStart =
      typeof snapshot?.clipStartSec === "number" && Number.isFinite(snapshot.clipStartSec)
        ? snapshot.clipStartSec
        : typeof body?.clipStartSec === "number" && Number.isFinite(body.clipStartSec)
          ? body.clipStartSec
          : null;
    const requestedFocus =
      typeof snapshot?.focusY === "number" && Number.isFinite(snapshot.focusY)
        ? snapshot.focusY
        : typeof body?.focusY === "number" && Number.isFinite(body.focusY)
          ? body.focusY
          : null;

    const auto =
      requestedClipStart === null || requestedFocus === null
        ? await analyzeBestClipAndFocus(downloaded.filePath, tmpDir, sourceDurationSec, clipDurationSec)
        : { clipStartSec: 0, focusY: 0.5 };

    const clipStartSec = clampClipStart(
      requestedClipStart ?? auto.clipStartSec,
      sourceDurationSec,
      clipDurationSec
    );
    const focusY = sanitizeFocusY(requestedFocus ?? auto.focusY);
    const templateIdFromInput =
      typeof (snapshot?.renderPlan as Partial<Stage3RenderPlan> | undefined)?.templateId === "string" &&
      (snapshot?.renderPlan as Partial<Stage3RenderPlan>).templateId?.trim()
        ? String((snapshot?.renderPlan as Partial<Stage3RenderPlan>).templateId).trim()
        : typeof body?.renderPlan?.templateId === "string" && body.renderPlan.templateId.trim()
          ? body.renderPlan.templateId.trim()
          : body?.templateId?.trim() || STAGE3_TEMPLATE_ID;
    const template = getTemplateById(templateIdFromInput);
    const rawPlan = snapshot?.renderPlan ?? body?.renderPlan;
    const policyFallback =
      sourceDurationSec !== null && sourceDurationSec > 12 ? "adaptive_window" : "full_source_normalize";
    const renderPlan: Stage3RenderPlan = {
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
                label: typeof segment.label === "string" ? segment.label : `${start.toFixed(1)}-${end ?? "end"}`
              };
            })
            .filter(
              (segment): segment is { startSec: number; endSec: number | null; label: string } =>
                Boolean(segment)
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
          : template.author.name,
      authorHandle:
        typeof rawPlan?.authorHandle === "string" && rawPlan.authorHandle.trim()
          ? rawPlan.authorHandle.trim()
          : template.author.handle,
      templateId:
        typeof rawPlan?.templateId === "string" && rawPlan.templateId.trim()
          ? rawPlan.templateId.trim()
          : templateIdFromInput,
      prompt: rawPlan?.prompt?.trim() || body?.agentPrompt?.trim() || ""
    };
    const computed = getTemplateComputed(
      renderPlan.templateId,
      snapshot?.topText ?? body?.topText ?? "",
      snapshot?.bottomText ?? body?.bottomText ?? "",
      {
        topFontScale: renderPlan.topFontScale,
        bottomFontScale: renderPlan.bottomFontScale
      }
    );

    const templateId = renderPlan.templateId || STAGE3_TEMPLATE_ID;
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

    const prepared = await prepareStage3SourceClip({
      sourcePath: downloaded.filePath,
      tmpDir,
      sourceDurationSec,
      clipStartSec,
      clipDurationSec: renderPlan.targetDurationSec,
      renderPlan,
      musicFilePath,
      profile: "render"
    });

    let backgroundAssetFileName: string | null = null;
    let backgroundAssetMimeType: string | null = null;
    let avatarAssetFileName: string | null = null;
    let avatarAssetMimeType: string | null = null;
    if (body?.channelId && renderPlan.backgroundAssetId) {
      const asset = await getChannelAssetById(body.channelId, renderPlan.backgroundAssetId);
      if (asset) {
        const bgFile = await readChannelAssetFile({ channelId: body.channelId, fileName: asset.fileName });
        if (bgFile) {
          const ext = path.extname(asset.fileName) || ".jpg";
          backgroundAssetFileName = `background${ext.toLowerCase()}`;
          await fs.copyFile(
            bgFile.filePath,
            path.join(path.dirname(prepared.preparedPath), backgroundAssetFileName)
          );
          backgroundAssetMimeType = asset.mimeType;
        }
      }
    }
    if (body?.channelId && renderPlan.avatarAssetId) {
      const asset = await getChannelAssetById(body.channelId, renderPlan.avatarAssetId);
      if (asset) {
        const avatarFile = await readChannelAssetFile({ channelId: body.channelId, fileName: asset.fileName });
        if (avatarFile) {
          const ext = path.extname(asset.fileName) || ".jpg";
          avatarAssetFileName = `avatar${ext.toLowerCase()}`;
          await fs.copyFile(
            avatarFile.filePath,
            path.join(path.dirname(prepared.preparedPath), avatarAssetFileName)
          );
          avatarAssetMimeType = asset.mimeType;
        }
      }
    }

    const metadataTitle = buildRenderMetadataTitle(body?.renderTitle);
    const outputStem = buildRenderFileStem(body?.renderTitle, downloaded.fileName);
    const remotionOutputPath = path.join(tmpDir, "render.raw.mp4");
    const outputPath = path.join(tmpDir, `${outputStem}.mp4`);
    await runRemotionRender({
      templateId,
      publicDir: path.dirname(prepared.preparedPath),
      outputPath: remotionOutputPath,
      topText: computed.top,
      bottomText: computed.bottom,
      clipStartSec: prepared.clipStartSec,
      clipDurationSec: prepared.clipDurationSec,
      focusY,
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

    const attachmentName = `${outputStem}.mp4`;
    const response = await createVideoAttachmentResponse(outputPath, attachmentName, {
      "x-stage3-top-compacted": computed.topCompacted ? "1" : "0",
      "x-stage3-bottom-compacted": computed.bottomCompacted ? "1" : "0"
    });
    scheduleDirectoryCleanup(tmpDir);
    cleanupScheduled = true;
    return response;
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    const ytdlpMessage = extractYtDlpErrorFromUnknown(error);
    if (ytdlpMessage) {
      return Response.json({ error: ytdlpMessage }, { status: 503 });
    }
    return Response.json({ error: parseRenderError(error) }, { status: 500 });
  } finally {
    if (!cleanupScheduled) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }
}
