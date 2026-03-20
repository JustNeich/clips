import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { CommentsPayload } from "../app/components/types";
import { normalizeComments, sortCommentsByPopularity } from "./comments";
import { readYtDlpMetadataArtifacts } from "./ytdlp-metadata";
import {
  buildLimitedCommentsExtractorArgs,
  createYtDlpAuthContext,
  extractYtDlpErrorFromUnknown,
  isSupportedUrl,
  normalizeSupportedUrl
} from "./ytdlp";
import { requireRuntimeTool } from "./runtime-capabilities";

const execFileAsync = promisify(execFile);

type YtDlpCommentsInfo = {
  title?: string;
  comments?: unknown;
};

export async function fetchCommentsPayloadForUrl(rawUrl: string): Promise<CommentsPayload> {
  const sourceUrl = normalizeSupportedUrl(rawUrl.trim());
  if (!sourceUrl || !isSupportedUrl(sourceUrl)) {
    throw new Error("Поддерживаются ссылки на YouTube Shorts, Instagram Reels и Facebook Reels.");
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clip-comments-"));

  try {
    const ytDlpPath = await requireRuntimeTool("ytDlp");
    const ytDlpAuth = await createYtDlpAuthContext(tmpDir);
    const outputTemplate = path.join(tmpDir, "metadata.%(ext)s");
    const args = [
      ...ytDlpAuth.args,
      "--skip-download",
      "--no-playlist",
      "--no-warnings",
      "--write-info-json",
      "--write-comments",
      ...buildLimitedCommentsExtractorArgs(sourceUrl, 300),
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
    const allComments = sortedComments.slice(0, 300);

    return {
      title: info.title ?? "video",
      totalComments: allComments.length,
      topComments: allComments.slice(0, 10),
      allComments
    };
  } catch (error) {
    throw new Error(
      extractYtDlpErrorFromUnknown(error) ??
        (error instanceof Error ? error.message : "Не удалось получить комментарии.")
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
