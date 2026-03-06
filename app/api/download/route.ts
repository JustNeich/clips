import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getYtDlpError, isSupportedUrl, sanitizeFileName } from "../../../lib/ytdlp";
import { requireRuntimeTool } from "../../../lib/runtime-capabilities";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { url?: string } | null;
  const rawUrl = body?.url?.trim();

  if (!rawUrl) {
    return Response.json({ error: "Передайте URL в теле запроса." }, { status: 400 });
  }

  if (!isSupportedUrl(rawUrl)) {
    return Response.json(
      {
        error: "Поддерживаются ссылки на YouTube Shorts, Instagram Reels и Facebook Reels."
      },
      { status: 400 }
    );
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clip-dl-"));

  try {
    const ytDlpPath = await requireRuntimeTool("ytDlp");
    const outputTemplate = path.join(tmpDir, "video.%(ext)s");
    const args = [
      "--no-playlist",
      "--no-warnings",
      "--merge-output-format",
      "mp4",
      "-f",
      "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
      "-o",
      outputTemplate,
      rawUrl
    ];

    await execFileAsync(ytDlpPath, args, {
      timeout: 2 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 8
    });

    const files = await fs.readdir(tmpDir);
    const mp4File = files.find((file) => file.endsWith(".mp4"));

    if (!mp4File) {
      return Response.json({ error: "Файл mp4 не был создан." }, { status: 500 });
    }

    const filePath = path.join(tmpDir, mp4File);
    const fileBuffer = await fs.readFile(filePath);
    const fileName = `${sanitizeFileName(path.parse(mp4File).name)}.mp4`;

    return new Response(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("yt-dlp")) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    const stderr =
      typeof error === "object" && error && "stderr" in error
        ? String((error as { stderr?: string }).stderr ?? "")
        : "";

    return Response.json({ error: getYtDlpError(stderr) }, { status: 500 });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
