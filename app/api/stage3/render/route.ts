import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getScienceCardComputed, STAGE3_TEMPLATE_ID } from "../../../../lib/stage3-template";
import {
  analyzeBestClipAndFocus,
  clampClipStart,
  downloadSourceVideo,
  prepareStage3SourceClip,
  probeVideoDurationSeconds,
  sanitizeClipDuration,
  sanitizeFocusY
} from "../../../../lib/stage3-media-agent";
import { getYtDlpError, isSupportedUrl } from "../../../../lib/ytdlp";
import { Stage3RenderPlan } from "../../../../lib/stage3-agent";
import { Stage3StateSnapshot } from "../../../../app/components/types";
import { readStage3BackgroundAsset } from "../../../../lib/stage3-background";

export const runtime = "nodejs";

const REMOTION_RENDER_TIMEOUT_MS = 9 * 60_000;

type RenderBody = {
  sourceUrl?: string;
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
  if (lower.includes("ffmpeg")) {
    return "Ошибка ffmpeg/Remotion rendering. Проверьте ffmpeg и remotion runtime.";
  }
  if (lower.includes("yt-dlp")) {
    return "Ошибка скачивания видео через yt-dlp.";
  }
  if (lower.includes("remotion")) {
    return message;
  }
  return message || "Не удалось отрендерить видео.";
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
    topText: params.topText,
    bottomText: params.bottomText,
    clipStartSec: params.clipStartSec,
    clipDurationSec: params.clipDurationSec,
    focusY: params.focusY,
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
    timeoutInMilliseconds: params.timeoutMs
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
  const templateId = body?.templateId?.trim() || STAGE3_TEMPLATE_ID;

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

  try {
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
    const computed = getScienceCardComputed(
      snapshot?.topText ?? body?.topText ?? "",
      snapshot?.bottomText ?? body?.bottomText ?? ""
    );
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
      prompt: rawPlan?.prompt?.trim() || body?.agentPrompt?.trim() || ""
    };

    const prepared = await prepareStage3SourceClip({
      sourcePath: downloaded.filePath,
      tmpDir,
      sourceDurationSec,
      clipStartSec,
      clipDurationSec: renderPlan.targetDurationSec,
      renderPlan,
      profile: "render"
    });

    let backgroundAssetFileName: string | null = null;
    let backgroundAssetMimeType: string | null = null;
    if (renderPlan.backgroundAssetId) {
      const asset = await readStage3BackgroundAsset(renderPlan.backgroundAssetId);
      if (asset) {
        const ext = path.extname(asset.fileName) || (asset.kind === "video" ? ".mp4" : ".jpg");
        backgroundAssetFileName = `background${ext.toLowerCase()}`;
        await fs.copyFile(
          asset.filePath,
          path.join(path.dirname(prepared.preparedPath), backgroundAssetFileName)
        );
        backgroundAssetMimeType = asset.mimeType;
      }
    }

    const outputPath = path.join(tmpDir, `${downloaded.fileName}_${templateId}.mp4`);
    await runRemotionRender({
      templateId,
      publicDir: path.dirname(prepared.preparedPath),
      outputPath,
      topText: computed.top,
      bottomText: computed.bottom,
      clipStartSec: prepared.clipStartSec,
      clipDurationSec: prepared.clipDurationSec,
      focusY,
      backgroundAssetFileName,
      backgroundAssetMimeType,
      timeoutMs
    });

    const rendered = await fs.readFile(outputPath);
    const attachmentName = `${downloaded.fileName}_${templateId}.mp4`;

    return new Response(rendered, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="${attachmentName}"`,
        "x-stage3-top-compacted": computed.topCompacted ? "1" : "0",
        "x-stage3-bottom-compacted": computed.bottomCompacted ? "1" : "0"
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
    return Response.json({ error: parseRenderError(error) }, { status: 500 });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
