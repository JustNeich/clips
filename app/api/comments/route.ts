import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { normalizeComments, sortCommentsByPopularity } from "../../../lib/comments";
import {
  createYtDlpAuthContext,
  extractYtDlpErrorFromUnknown,
  getYtDlpError,
  isSupportedUrl,
  normalizeSupportedUrl
} from "../../../lib/ytdlp";
import { requireRuntimeTool } from "../../../lib/runtime-capabilities";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { url?: string } | null;
  const rawUrl = body?.url?.trim();

  if (!rawUrl) {
    return Response.json({ error: "Передайте URL в теле запроса." }, { status: 400 });
  }

  const sourceUrl = normalizeSupportedUrl(rawUrl);

  if (!isSupportedUrl(sourceUrl)) {
    return Response.json(
      {
        error: "Поддерживаются ссылки на YouTube Shorts, Instagram Reels и Facebook Reels."
      },
      { status: 400 }
    );
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
      "-o",
      outputTemplate,
      sourceUrl
    ];

    await execFileAsync(ytDlpPath, args, {
      timeout: 3 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 16
    });

    const files = await fs.readdir(tmpDir);
    const infoJsonFile = files.find((file) => file.endsWith(".info.json"));

    if (!infoJsonFile) {
      return Response.json({ error: "Не удалось получить метаданные видео." }, { status: 500 });
    }

    const infoJsonPath = path.join(tmpDir, infoJsonFile);
    const infoJson = JSON.parse(await fs.readFile(infoJsonPath, "utf-8")) as {
      title?: string;
      comments?: unknown;
    };

    const allComments = sortCommentsByPopularity(normalizeComments(infoJson.comments));
    const topComments = allComments.slice(0, 10);

    return Response.json(
      {
        title: infoJson.title ?? "video",
        totalComments: allComments.length,
        topComments,
        allComments
      },
      { status: 200 }
    );
  } catch (error) {
    const ytDlpError = extractYtDlpErrorFromUnknown(error);
    if (ytDlpError) {
      return Response.json({ error: ytDlpError }, { status: 503 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось получить комментарии." },
      { status: 500 }
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
