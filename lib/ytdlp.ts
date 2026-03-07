import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const SUPPORTED_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "instagram.com",
  "www.instagram.com",
  "facebook.com",
  "www.facebook.com",
  "fb.watch",
  "m.facebook.com"
]);

export function isSupportedUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return false;
    }

    const hostSupported = SUPPORTED_HOSTS.has(parsed.hostname.toLowerCase());
    if (!hostSupported) {
      return false;
    }

    const pathname = parsed.pathname.toLowerCase();
    return (
      pathname.includes("/shorts/") ||
      pathname.includes("/reel/") ||
      pathname.includes("/reels/") ||
      parsed.hostname.includes("fb.watch")
    );
  } catch {
    return false;
  }
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "video";
}

export type YtDlpAuthContext = {
  args: string[];
  cleanup: () => Promise<void>;
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

export function getYtDlpError(stderr: string): string {
  const normalized = stderr.toLowerCase();

  if (!normalized.trim()) {
    if (process.env.VERCEL === "1") {
      return "yt-dlp недоступен на этом Vercel deployment. Step 1 fetch/download/comments не сможет обработать исходное видео.";
    }
    return "yt-dlp не найден на сервере.";
  }
  if (normalized.includes("unsupported url")) {
    return "Ссылка не поддерживается.";
  }
  if (normalized.includes("private")) {
    return "Это приватное видео, скачать его нельзя.";
  }
  if (
    normalized.includes("sign in to confirm you're not a bot") ||
    normalized.includes("sign in to confirm you’re not a bot") ||
    normalized.includes("cookies-from-browser") ||
    normalized.includes("cookies for the authentication")
  ) {
    return "YouTube отклонил запрос на этом сервере (anti-bot/auth). Если YTDLP_COOKIES уже заданы, проблема может быть в IP или репутации runtime.";
  }
  if (normalized.includes("login")) {
    return "Источник требует авторизацию. Публичные ссылки работают лучше.";
  }
  if (normalized.includes("ffmpeg is not installed")) {
    return "На сервере не установлен ffmpeg. Установите ffmpeg и повторите.";
  }
  if (normalized.includes("not found")) {
    return "Видео не найдено.";
  }
  if (normalized.includes("comment")) {
    return "Не удалось получить комментарии для этой ссылки.";
  }

  return "Не удалось обработать ссылку.";
}

export function extractYtDlpErrorFromText(message: string): string | null {
  const normalized = message.toLowerCase();
  if (!YT_DLP_ERROR_SIGNALS.some((signal) => normalized.includes(signal))) {
    return null;
  }

  return getYtDlpError(message);
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

export function extractYtDlpErrorFromUnknown(error: unknown): string | null {
  const stderr =
    typeof error === "object" && error && "stderr" in error
      ? String((error as { stderr?: string }).stderr ?? "")
      : "";
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const combined = [stderr, message].filter(Boolean).join("\n").trim();

  if (!combined) {
    return null;
  }

  return extractYtDlpErrorFromText(combined);
}
