import { Stage3ExecutionTarget } from "../app/components/types";

const PREVIEW_SOURCE_ERROR_SIGNALS = [
  "youtube отклонил запрос",
  "anti-bot/auth",
  "источник требует авторизацию",
  "приватное видео",
  "видео не найдено",
  "yt-dlp",
  "ffmpeg"
];

type Stage3SourceFailureNoticeMode = "proxy-preview" | "accurate-preview" | "render";

function resolveStage3SourceFailureLabel(mode: Stage3SourceFailureNoticeMode): string {
  if (mode === "proxy-preview") {
    return "Stage 3 preview";
  }
  if (mode === "accurate-preview") {
    return "точного clip-preview";
  }
  return "Stage 3 рендера";
}

export function normalizeStage3SourceFailureNotice(
  message: string | null | undefined,
  options?: {
    executionTarget?: Stage3ExecutionTarget | null;
    mode?: Stage3SourceFailureNoticeMode;
  }
): string | null {
  const trimmed = typeof message === "string" ? message.trim() : "";
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.toLowerCase();
  if (!PREVIEW_SOURCE_ERROR_SIGNALS.some((signal) => normalized.includes(signal))) {
    return trimmed;
  }

  const executionTarget = options?.executionTarget ?? null;
  const label = resolveStage3SourceFailureLabel(options?.mode ?? "proxy-preview");
  return executionTarget === "local"
    ? `Не удалось подготовить исходник для ${label} на локальном executor. Проверьте ссылку из Шага 1 или откройте логи executor.`
    : `Не удалось подготовить исходник для ${label}. Проверьте ссылку из Шага 1.`;
}

export function normalizeStage3EditorPreviewNotice(
  message: string | null | undefined,
  executionTarget: Stage3ExecutionTarget | null = null
): string | null {
  return normalizeStage3SourceFailureNotice(message, {
    executionTarget,
    mode: "proxy-preview"
  });
}
