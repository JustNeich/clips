import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { CommentsPayload } from "../app/components/types";
import { resolveExecutableFromCandidates } from "./command-path";
import { normalizeComments, sortCommentsByPopularity } from "./comments";
import {
  fetchYouTubeCommentsPayload,
  shouldFallbackFromYouTubeCommentsError,
  extractYouTubeVideoIdFromUrl
} from "./youtube-comments";
import { readYtDlpMetadataArtifacts } from "./ytdlp-metadata";
import {
  buildLimitedCommentsExtractorArgs,
  createYtDlpAuthContext,
  extractYtDlpErrorFromUnknown,
  isSupportedUrl,
  normalizeSupportedUrl
} from "./ytdlp";
import { SUPPORTED_SOURCE_ERROR_MESSAGE } from "./supported-url";
import { isUploadedSourceUrl } from "./uploaded-source";

const execFileAsync = promisify(execFile);

const YTDLP_CANDIDATES = ["/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp", "yt-dlp"];
const DEFAULT_COMMENTS_CAP = 300;

type YtDlpCommentsInfo = {
  title?: string;
  comments?: unknown;
};

export type CommentsProviderId = "youtubeDataApi" | "ytDlp";
export type CommentsFetchStatus = "primary_success" | "fallback_success" | "unavailable";

export type CommentsFetchResolution = {
  payload: CommentsPayload | null;
  provider: CommentsProviderId | null;
  fallbackUsed: boolean;
  status: CommentsFetchStatus;
  note: string | null;
  error: string | null;
};

type FetchCommentsForUrlOptions = {
  maxComments?: number;
  fetchImpl?: typeof fetch;
  youtubeApiKey?: string | null;
  youtubeApiProvider?: typeof fetchYouTubeCommentsPayload;
  ytDlpProvider?: (input: { rawUrl: string; maxComments: number }) => Promise<CommentsPayload>;
};

function getYtDlpUnavailableMessage(): string {
  if (process.env.STAGE3_WORKER_SERVER_ORIGIN?.trim()) {
    return "yt-dlp не найден на локальном executor.";
  }
  if (process.env.VERCEL === "1") {
    return "yt-dlp недоступен на этом Vercel deployment. Комментарии нельзя получить через fallback scraping path.";
  }
  if (process.env.RENDER === "true" || process.env.RENDER === "1") {
    return "yt-dlp не найден на Render. Для fallback comments path нужен Docker runtime с установленным yt-dlp.";
  }
  return "yt-dlp не найден на сервере.";
}

async function resolveYtDlpExecutable(): Promise<string> {
  const resolved = await resolveExecutableFromCandidates(YTDLP_CANDIDATES);
  if (!resolved) {
    throw new Error(getYtDlpUnavailableMessage());
  }
  return resolved;
}

function clampCommentsCap(value: number | null | undefined): number {
  const numeric = Number.isFinite(value) ? Number(value) : DEFAULT_COMMENTS_CAP;
  return Math.max(1, Math.min(DEFAULT_COMMENTS_CAP, Math.floor(numeric)));
}

function toErrorMessage(error: unknown, fallbackMessage: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallbackMessage;
}

function buildYouTubeCommentsFailureMessage(primaryError: string, fallbackError: string | null): string {
  if (!fallbackError) {
    return primaryError;
  }
  return `Комментарии YouTube недоступны. YouTube Data API: ${primaryError} Fallback yt-dlp: ${fallbackError}`;
}

export async function fetchCommentsPayloadViaYtDlp(input: {
  rawUrl: string;
  maxComments?: number;
}): Promise<CommentsPayload> {
  const sourceUrl = normalizeSupportedUrl(input.rawUrl.trim());
  const maxComments = clampCommentsCap(input.maxComments);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clip-comments-"));

  try {
    const ytDlpPath = await resolveYtDlpExecutable();
    const ytDlpAuth = await createYtDlpAuthContext(tmpDir);
    const outputTemplate = path.join(tmpDir, "metadata.%(ext)s");
    const args = [
      ...ytDlpAuth.args,
      "--skip-download",
      "--no-playlist",
      "--no-warnings",
      "--write-info-json",
      "--write-comments",
      ...buildLimitedCommentsExtractorArgs(sourceUrl, maxComments),
      "-o",
      outputTemplate,
      sourceUrl
    ];

    await execFileAsync(ytDlpPath, args, {
      timeout: 3 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 16
    });

    const { infoJson, comments } = await readYtDlpMetadataArtifacts(tmpDir, "metadata");
    if (!infoJson) {
      throw new Error("Не удалось получить метаданные видео.");
    }

    const info = infoJson as YtDlpCommentsInfo;
    const sortedComments = sortCommentsByPopularity(normalizeComments(comments));
    const allComments = sortedComments.slice(0, maxComments);

    return {
      title: info.title ?? "video",
      totalComments: allComments.length,
      topComments: allComments.slice(0, 10),
      allComments
    };
  } catch (error) {
    throw new Error(
      extractYtDlpErrorFromUnknown(error, { sourceUrl }) ??
        toErrorMessage(error, "Не удалось получить комментарии.")
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

export async function fetchCommentsForUrl(
  rawUrl: string,
  options: FetchCommentsForUrlOptions = {}
): Promise<CommentsFetchResolution> {
  const sourceUrl = normalizeSupportedUrl(rawUrl.trim());
  if (!sourceUrl || !isSupportedUrl(sourceUrl)) {
      return {
        payload: null,
        provider: null,
        fallbackUsed: false,
        status: "unavailable",
        note: "Источник не поддерживается для загрузки комментариев.",
        error: SUPPORTED_SOURCE_ERROR_MESSAGE
      };
  }

  const maxComments = clampCommentsCap(options.maxComments);
  const ytDlpProvider = options.ytDlpProvider ?? fetchCommentsPayloadViaYtDlp;
  if (isUploadedSourceUrl(sourceUrl)) {
    return {
      payload: null,
      provider: null,
      fallbackUsed: false,
      status: "unavailable",
      note: "Для загруженного mp4 комментарии недоступны. Продолжаем только с видеоконтекстом.",
      error: "Комментарии для загруженного mp4 недоступны."
    };
  }

  if (extractYouTubeVideoIdFromUrl(sourceUrl)) {
    const youtubeApiProvider = options.youtubeApiProvider ?? fetchYouTubeCommentsPayload;
    let primaryErrorMessage: string | null = null;

    try {
      const payload = await youtubeApiProvider({
        rawUrl: sourceUrl,
        maxComments,
        fetchImpl: options.fetchImpl,
        apiKey: options.youtubeApiKey
      });
      return {
        payload,
        provider: "youtubeDataApi",
        fallbackUsed: false,
        status: "primary_success",
        note: "Комментарии загружены через YouTube Data API.",
        error: null
      };
    } catch (error) {
      primaryErrorMessage = toErrorMessage(error, "Не удалось получить комментарии через YouTube Data API.");
      if (!shouldFallbackFromYouTubeCommentsError(error)) {
        return {
          payload: null,
          provider: null,
          fallbackUsed: false,
          status: "unavailable",
          note: primaryErrorMessage,
          error: primaryErrorMessage
        };
      }
    }

    try {
      const payload = await ytDlpProvider({
        rawUrl: sourceUrl,
        maxComments
      });
      return {
        payload,
        provider: "ytDlp",
        fallbackUsed: true,
        status: "fallback_success",
        note:
          "Основной YouTube-провайдер комментариев был недоступен, поэтому комментарии успешно получены через резервный путь yt-dlp.",
        error: null
      };
    } catch (fallbackError) {
      return {
        payload: null,
        provider: null,
        fallbackUsed: true,
        status: "unavailable",
        note: buildYouTubeCommentsFailureMessage(
          primaryErrorMessage ?? "Не удалось получить комментарии через YouTube Data API.",
          toErrorMessage(fallbackError, "yt-dlp fallback тоже не смог получить комментарии.")
        ),
        error: buildYouTubeCommentsFailureMessage(
          primaryErrorMessage ?? "Не удалось получить комментарии через YouTube Data API.",
          toErrorMessage(fallbackError, "yt-dlp fallback тоже не смог получить комментарии.")
        )
      };
    }
  }

  try {
    const payload = await ytDlpProvider({
      rawUrl: sourceUrl,
      maxComments
    });
    return {
      payload,
      provider: "ytDlp",
      fallbackUsed: false,
      status: "primary_success",
      note: "Комментарии загружены через yt-dlp.",
      error: null
    };
  } catch (error) {
    return {
      payload: null,
      provider: null,
      fallbackUsed: false,
      status: "unavailable",
      note: toErrorMessage(error, "Не удалось получить комментарии."),
      error: toErrorMessage(error, "Не удалось получить комментарии.")
    };
  }
}

export async function fetchCommentsPayloadForUrl(rawUrl: string): Promise<CommentsPayload> {
  const result = await fetchCommentsForUrl(rawUrl);
  if (result.payload) {
    return result.payload;
  }
  throw new Error(result.error ?? "Не удалось получить комментарии.");
}
