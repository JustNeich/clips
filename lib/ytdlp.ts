import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeSupportedUrl } from "./supported-url";
export { isSupportedUrl, normalizeSupportedUrl } from "./supported-url";

export function buildLimitedCommentsExtractorArgs(rawUrl: string, maxComments = 300): string[] {
  const safeMaxComments = Math.max(1, Math.floor(maxComments));

  try {
    const parsed = new URL(normalizeSupportedUrl(rawUrl));
    const hostname = parsed.hostname.toLowerCase();
    const isYoutube = hostname === "youtu.be" || hostname.includes("youtube.com");
    if (!isYoutube) {
      return [];
    }

    return [
      "--extractor-args",
      `youtube:comment_sort=top;max_comments=${safeMaxComments},${safeMaxComments},0,0`
    ];
  } catch {
    return [];
  }
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "video";
}

export type YtDlpAuthContext = {
  args: string[];
  cleanup: () => Promise<void>;
};

export type YtDlpErrorDescriptor = {
  message: string;
  retryable: boolean;
};

type YtDlpErrorContext = {
  sourceUrl?: string | null;
};

function normalizeCookieSecret(value: string): string {
  const trimmed = value.trim();
  const normalized = trimmed.includes("\n") ? trimmed : trimmed.replace(/\\n/g, "\n");
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

export async function createYtDlpAuthContext(tmpDir?: string): Promise<YtDlpAuthContext> {
  const cookiesPath = process.env.YTDLP_COOKIES_PATH?.trim();
  if (cookiesPath) {
    return {
      args: ["--cookies", cookiesPath],
      cleanup: async () => {}
    };
  }

  const cookiesRaw = process.env.YTDLP_COOKIES?.trim();
  if (!cookiesRaw) {
    return {
      args: [],
      cleanup: async () => {}
    };
  }

  let ownedDir: string | null = null;
  const targetDir = tmpDir ?? (await fs.mkdtemp(path.join(os.tmpdir(), "yt-dlp-cookies-")));
  if (!tmpDir) {
    ownedDir = targetDir;
  }

  const filePath = path.join(targetDir, "cookies.txt");
  await fs.writeFile(filePath, normalizeCookieSecret(cookiesRaw), "utf-8");

  return {
    args: ["--cookies", filePath],
    cleanup: async () => {
      if (ownedDir) {
        await fs.rm(ownedDir, { recursive: true, force: true });
      }
    }
  };
}

function resolveSourcePlatformLabel(rawUrl?: string | null): "YouTube" | "Instagram" | "Facebook" | null {
  const trimmed = rawUrl?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(normalizeSupportedUrl(trimmed));
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "youtu.be" || hostname.includes("youtube.com")) {
      return "YouTube";
    }
    if (hostname.includes("instagram.com")) {
      return "Instagram";
    }
    if (hostname.includes("facebook.com") || hostname === "fb.watch") {
      return "Facebook";
    }
  } catch {
    return null;
  }

  return null;
}

export function getYtDlpErrorDescriptor(stderr: string, context?: YtDlpErrorContext): YtDlpErrorDescriptor {
  const normalized = stderr.toLowerCase();
  const workerRuntime = Boolean(process.env.STAGE3_WORKER_SERVER_ORIGIN);
  const sourcePlatform = resolveSourcePlatformLabel(context?.sourceUrl) ?? "Источник";

  if (!normalized.trim()) {
    return {
      message:
        process.env.VERCEL === "1"
          ? "yt-dlp недоступен на этом Vercel deployment. Step 1 fetch/download/comments не сможет обработать исходное видео."
          : workerRuntime
            ? "yt-dlp не найден на локальном executor."
            : "yt-dlp не найден в среде выполнения.",
      retryable: false
    };
  }
  if (normalized.includes("unsupported url")) {
    return {
      message: "Ссылка не поддерживается.",
      retryable: false
    };
  }
  if (normalized.includes("private")) {
    return {
      message: "Это приватное видео, скачать его нельзя.",
      retryable: false
    };
  }
  if (
    normalized.includes("sign in to confirm you're not a bot") ||
    normalized.includes("sign in to confirm you’re not a bot") ||
    normalized.includes("cookies-from-browser") ||
    normalized.includes("cookies for the authentication")
  ) {
    return {
      message: `${sourcePlatform} отклонил запрос на этом сервере (anti-bot/auth). Если YTDLP_COOKIES уже заданы, проблема может быть в IP или репутации runtime.`,
      retryable: false
    };
  }
  if (normalized.includes("login")) {
    return {
      message: "Источник требует авторизацию. Публичные ссылки работают лучше.",
      retryable: false
    };
  }
  if (normalized.includes("ffmpeg is not installed")) {
    return {
      message: workerRuntime
        ? "На локальном executor не установлен ffmpeg. Установите ffmpeg и повторите."
        : "В среде выполнения не установлен ffmpeg. Установите ffmpeg и повторите.",
      retryable: false
    };
  }
  if (normalized.includes("not found")) {
    return {
      message: "Видео не найдено.",
      retryable: false
    };
  }
  if (normalized.includes("comment")) {
    return {
      message: "Не удалось получить комментарии для этой ссылки.",
      retryable: false
    };
  }

  return {
    message: "Не удалось обработать ссылку.",
    retryable: true
  };
}

export function getYtDlpError(stderr: string, context?: YtDlpErrorContext): string {
  return getYtDlpErrorDescriptor(stderr, context).message;
}

export function extractYtDlpErrorFromText(message: string, context?: YtDlpErrorContext): string | null {
  const descriptor = extractYtDlpErrorDescriptorFromText(message, context);
  return descriptor?.message ?? null;
}

export function extractYtDlpErrorDescriptorFromText(
  message: string,
  context?: YtDlpErrorContext
): YtDlpErrorDescriptor | null {
  const normalized = message.toLowerCase();
  if (!YT_DLP_ERROR_SIGNALS.some((signal) => normalized.includes(signal))) {
    return null;
  }

  return getYtDlpErrorDescriptor(message, context);
}

const YT_DLP_ERROR_SIGNALS = [
  "yt-dlp",
  "[youtube]",
  "unsupported url",
  "sign in to confirm you're not a bot",
  "sign in to confirm you’re not a bot",
  "cookies-from-browser",
  "cookies for the authentication",
  "ffmpeg is not installed",
  "requested format is not available",
  "private video",
  "video unavailable",
  "not found"
];

export function extractYtDlpErrorFromUnknown(error: unknown, context?: YtDlpErrorContext): string | null {
  const descriptor = extractYtDlpErrorDescriptorFromUnknown(error, context);
  return descriptor?.message ?? null;
}

export function extractYtDlpErrorDescriptorFromUnknown(
  error: unknown,
  context?: YtDlpErrorContext
): YtDlpErrorDescriptor | null {
  const stderr =
    typeof error === "object" && error && "stderr" in error
      ? String((error as { stderr?: string }).stderr ?? "")
      : "";
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const combined = [stderr, message].filter(Boolean).join("\n").trim();

  if (!combined) {
    return null;
  }

  return extractYtDlpErrorDescriptorFromText(combined, context);
}
