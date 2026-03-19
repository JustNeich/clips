import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const REDIRECT_QUERY_KEYS = ["u", "url"];
const REDIRECT_HOSTS = new Set([
  "l.instagram.com",
  "lm.instagram.com",
  "l.facebook.com",
  "lm.facebook.com"
]);

const HOST_ALIASES = new Map<string, string>([
  ["youtube.com", "www.youtube.com"],
  ["m.youtube.com", "www.youtube.com"],
  ["instagram.com", "www.instagram.com"],
  ["m.instagram.com", "www.instagram.com"],
  ["instagr.am", "www.instagram.com"],
  ["www.instagr.am", "www.instagram.com"],
  ["facebook.com", "www.facebook.com"],
  ["m.facebook.com", "www.facebook.com"]
]);

const SUPPORTED_HOSTS = new Set([
  "www.youtube.com",
  "youtu.be",
  "www.instagram.com",
  "www.facebook.com",
  "fb.watch"
]);

function normalizeHostname(hostname: string): string {
  const lowered = hostname.toLowerCase();
  return HOST_ALIASES.get(lowered) ?? lowered;
}

function maybeUnwrapRedirect(parsed: URL): string | null {
  if (!REDIRECT_HOSTS.has(parsed.hostname.toLowerCase())) {
    return null;
  }

  for (const key of REDIRECT_QUERY_KEYS) {
    const candidate = parsed.searchParams.get(key)?.trim();
    if (!candidate) {
      continue;
    }

    try {
      return new URL(candidate).toString();
    } catch {
      continue;
    }
  }

  return null;
}

function normalizeYouTubeUrl(parsed: URL): string {
  const hostname = normalizeHostname(parsed.hostname);
  const pathname = parsed.pathname;

  if (hostname === "youtu.be") {
    const id = pathname.split("/").filter(Boolean)[0];
    if (id) {
      return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
    }
  }

  if (pathname.startsWith("/shorts/")) {
    const id = pathname.split("/").filter(Boolean)[1];
    if (id) {
      return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
    }
  }

  if (pathname === "/watch" && parsed.searchParams.get("v")) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(parsed.searchParams.get("v") ?? "")}`;
  }

  const normalized = new URL(parsed.toString());
  normalized.protocol = "https:";
  normalized.hostname = hostname;
  normalized.username = "";
  normalized.password = "";
  normalized.hash = "";
  return normalized.toString();
}

function normalizeDirectSupportedUrl(parsed: URL): string {
  const hostname = normalizeHostname(parsed.hostname);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return parsed.toString();
  }

  if (hostname === "youtu.be" || hostname.includes("youtube.com")) {
    return normalizeYouTubeUrl(parsed);
  }

  const normalized = new URL(parsed.toString());
  normalized.protocol = "https:";
  normalized.hostname = hostname;
  normalized.username = "";
  normalized.password = "";
  normalized.hash = "";

  if (
    hostname.includes("instagram.com") &&
    (normalized.pathname.toLowerCase().startsWith("/share/reel/") ||
      normalized.pathname.toLowerCase().startsWith("/share/reels/"))
  ) {
    normalized.pathname = normalized.pathname.replace(/^\/share\/reels?\//i, "/reel/");
  }

  if (hostname.includes("instagram.com") || hostname.includes("facebook.com") || hostname === "fb.watch") {
    normalized.search = "";
  }

  return normalized.toString();
}

export function normalizeSupportedUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return trimmed;
  }

  let current = trimmed;
  for (let depth = 0; depth < 3; depth += 1) {
    try {
      const parsed = new URL(current);
      const unwrapped = maybeUnwrapRedirect(parsed);
      if (!unwrapped || unwrapped === current) {
        return normalizeDirectSupportedUrl(parsed);
      }
      current = unwrapped;
    } catch {
      return trimmed;
    }
  }

  try {
    return normalizeDirectSupportedUrl(new URL(current));
  } catch {
    return trimmed;
  }
}

export function isSupportedUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(normalizeSupportedUrl(rawUrl));
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return false;
    }

    const hostSupported = SUPPORTED_HOSTS.has(normalizeHostname(parsed.hostname));
    if (!hostSupported) {
      return false;
    }

    const pathname = parsed.pathname.toLowerCase();
    const isYouTubeWatchUrl =
      normalizeHostname(parsed.hostname).includes("youtube.com") &&
      pathname === "/watch" &&
      Boolean(parsed.searchParams.get("v"));

    return (
      isYouTubeWatchUrl ||
      pathname.includes("/shorts/") ||
      pathname.includes("/reel/") ||
      pathname.includes("/reels/") ||
      pathname.includes("/share/reel/") ||
      pathname.includes("/share/reels/") ||
      parsed.hostname.includes("fb.watch")
    );
  } catch {
    return false;
  }
}

export function buildLimitedCommentsExtractorArgs(rawUrl: string, maxComments = 300): string[] {
  const safeMaxComments = Math.max(1, Math.floor(maxComments));

  try {
    const parsed = new URL(normalizeSupportedUrl(rawUrl));
    const hostname = normalizeHostname(parsed.hostname);
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
  const workerRuntime = Boolean(process.env.STAGE3_WORKER_SERVER_ORIGIN);

  if (!normalized.trim()) {
    if (process.env.VERCEL === "1") {
      return "yt-dlp недоступен на этом Vercel deployment. Step 1 fetch/download/comments не сможет обработать исходное видео.";
    }
    return workerRuntime ? "yt-dlp не найден на локальном executor." : "yt-dlp не найден в среде выполнения.";
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
    return workerRuntime
      ? "На локальном executor не установлен ffmpeg. Установите ffmpeg и повторите."
      : "В среде выполнения не установлен ffmpeg. Установите ffmpeg и повторите.";
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
