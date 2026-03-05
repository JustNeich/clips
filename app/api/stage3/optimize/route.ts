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
import { optimizeStage3Version } from "../../../../lib/stage3-agent";
import { planStage3OperationsWithCodex } from "../../../../lib/stage3-agent-llm";
import { Stage3StateSnapshot } from "../../../../app/components/types";
import { getYtDlpError, isSupportedUrl } from "../../../../lib/ytdlp";
import { ensureCodexLoggedIn } from "../../../../lib/codex-runner";
import { ensureCodexHomeForSession, normalizeCodexSessionId } from "../../../../lib/codex-session";

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
    const sessionId = normalizeCodexSessionId(request.headers.get("x-codex-session-id"));
    const plannerModel = process.env.CODEX_STAGE3_MODEL ?? "gpt-5.2";
    const plannerReasoning = process.env.CODEX_STAGE3_REASONING_EFFORT ?? "extra-high";
    const timeoutFromEnv = Number.parseInt(process.env.CODEX_STAGE3_TIMEOUT_MS ?? "", 10);
    const plannerTimeoutMs =
      Number.isFinite(timeoutFromEnv) && timeoutFromEnv > 0 ? timeoutFromEnv : 90_000;

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

    let plannerWarning: string | null = null;
    let planner: Parameters<typeof optimizeStage3Version>[0]["planner"] = null;

    if (sessionId) {
      try {
        const codexHome = await ensureCodexHomeForSession(sessionId);
        await ensureCodexLoggedIn(codexHome);
        planner = async (input) =>
          planStage3OperationsWithCodex({
            codexHome,
            prompt: input.prompt,
            snapshot: input.snapshot,
            sourceDurationSec: input.sourceDurationSec,
            passIndex: input.passIndex,
            maxPasses: input.maxPasses,
            scoreBefore: input.scoreBefore.total,
            lastPassSummary: input.lastPassSummary ?? null,
            model: plannerModel,
            reasoningEffort: plannerReasoning,
            timeoutMs: plannerTimeoutMs
          });
      } catch (error) {
        plannerWarning =
          error instanceof Error
            ? `LLM planner unavailable: ${error.message}`
            : "LLM planner unavailable for this optimize run.";
      }
    }

    const optimized = await optimizeStage3Version({
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
      currentSnapshot: body?.currentSnapshot ?? null,
      planner,
      model: planner ? plannerModel : "heuristic-hybrid",
      reasoningEffort: planner ? plannerReasoning : "n/a"
    });

    return Response.json(
      {
        optimization: {
          changed: optimized.changed,
          version: optimized.version,
          noOpReason: optimized.noOpReason,
          suggestions: optimized.suggestions,
          intent: optimized.intent
        },
        planner: {
          mode: planner ? "llm+heuristic" : "heuristic",
          warning: plannerWarning
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
