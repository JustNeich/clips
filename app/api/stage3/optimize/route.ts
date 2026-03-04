import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  analyzeBestClipAndFocus,
  clampClipStart,
  downloadSourceVideo,
  probeVideoDurationSeconds,
  sanitizeClipDuration,
  sanitizeFocusY
} from "../../../../lib/stage3-media-agent";
import { buildStage3Version } from "../../../../lib/stage3-agent";
import { Stage3StateSnapshot } from "../../../../app/components/types";
import { getYtDlpError, isSupportedUrl } from "../../../../lib/ytdlp";

export const runtime = "nodejs";

type OptimizeBody = {
  sourceUrl?: string;
  chatId?: string;
  versionNo?: number;
  topText?: string;
  bottomText?: string;
  clipStartSec?: number;
  clipDurationSec?: number;
  focusY?: number;
  agentPrompt?: string;
  currentSnapshot?: Partial<Stage3StateSnapshot>;
};

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as OptimizeBody | null;
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

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "clip-stage3-opt-"));

  try {
    const downloaded = await downloadSourceVideo(rawSource, tmpDir);
    const sourceDurationSec = await probeVideoDurationSeconds(downloaded.filePath);
    const clipDurationSec = sanitizeClipDuration(body?.clipDurationSec);

    const auto = await analyzeBestClipAndFocus(
      downloaded.filePath,
      tmpDir,
      sourceDurationSec,
      clipDurationSec
    );

    const manualClipStartSec = clampClipStart(
      body?.clipStartSec ?? 0,
      sourceDurationSec,
      clipDurationSec
    );
    const manualFocusY = sanitizeFocusY(body?.focusY);
    const autoClipStartSec = clampClipStart(auto.clipStartSec, sourceDurationSec, clipDurationSec);
    const autoFocusY = sanitizeFocusY(auto.focusY);
    const inputTopText = body?.topText ?? "";
    const inputBottomText = body?.bottomText ?? "";
    const version = buildStage3Version({
      versionNo:
        typeof body?.versionNo === "number" && Number.isFinite(body.versionNo)
          ? Math.max(1, Math.floor(body.versionNo))
          : 1,
      prompt: body?.agentPrompt ?? "",
      topText: inputTopText,
      bottomText: inputBottomText,
      clipDurationSec,
      sourceDurationSec,
      manualClipStartSec,
      manualFocusY,
      autoClipStartSec,
      autoFocusY,
      currentSnapshot: body?.currentSnapshot ?? null
    });

    return Response.json(
      {
        optimization: {
          version
        }
      },
      { status: 200 }
    );
  } catch (error) {
    const stderr =
      typeof error === "object" && error && "stderr" in error
        ? String((error as { stderr?: string }).stderr ?? "")
        : "";
    if (stderr) {
      return Response.json({ error: getYtDlpError(stderr) }, { status: 500 });
    }

    return Response.json(
      { error: error instanceof Error ? error.message : "Stage 3 optimization failed." },
      { status: 500 }
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
