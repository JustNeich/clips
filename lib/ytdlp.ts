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

export function getYtDlpError(stderr: string): string {
  const normalized = stderr.toLowerCase();

  if (normalized.includes("unsupported url")) {
    return "Ссылка не поддерживается.";
  }
  if (normalized.includes("private")) {
    return "Это приватное видео, скачать его нельзя.";
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
