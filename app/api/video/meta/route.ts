import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createYtDlpAuthContext, getYtDlpError, isSupportedUrl } from "../../../../lib/ytdlp";
import { requireRuntimeTool } from "../../../../lib/runtime-capabilities";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";

type MetaBody = {
  url?: string;
};

type YtMeta = {
  duration?: number;
};

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as MetaBody | null;
  const rawUrl = body?.url?.trim();

  if (!rawUrl) {
    return Response.json({ error: "Передайте url." }, { status: 400 });
  }
  if (!isSupportedUrl(rawUrl)) {
    return Response.json(
      { error: "Поддерживаются ссылки на YouTube Shorts, Instagram Reels и Facebook Reels." },
      { status: 400 }
    );
  }

  try {
    const ytDlpPath = await requireRuntimeTool("ytDlp");
    const ytDlpAuth = await createYtDlpAuthContext();
    const { stdout } = await execFileAsync(
      ytDlpPath,
      [
        ...ytDlpAuth.args,
        "--dump-single-json",
        "--skip-download",
        "--no-warnings",
        "--no-playlist",
        rawUrl
      ],
      { timeout: 60_000, maxBuffer: 1024 * 1024 * 8 }
    );

    const meta = JSON.parse(stdout) as YtMeta;
    const duration =
      typeof meta.duration === "number" && Number.isFinite(meta.duration) && meta.duration > 0
        ? meta.duration
        : null;

    return Response.json({ durationSec: duration }, { status: 200 });
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("yt-dlp")) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    const stderr =
      typeof error === "object" && error && "stderr" in error
        ? String((error as { stderr?: string }).stderr ?? "")
        : "";
    return Response.json(
      {
        error: stderr
          ? getYtDlpError(stderr)
          : error instanceof Error
            ? error.message
            : "Не удалось получить duration."
      },
      { status: 500 }
    );
  }
}
