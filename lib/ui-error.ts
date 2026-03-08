export function looksLikeUnexpectedHtmlResponse(message: string): boolean {
  const raw = message.trim();
  const rawLower = raw.toLowerCase();

  if (
    rawLower.includes("<title>502") ||
    rawLower.includes("bad gateway") ||
    rawLower.includes("powered by render") ||
    rawLower.includes("this service is currently unavailable")
  ) {
    return true;
  }

  if (rawLower.includes("<!doctype html") || (rawLower.includes("<html") && rawLower.includes("<body"))) {
    return true;
  }

  return false;
}

export function sanitizeDisplayText(message: string): string {
  const normalized = message.trim();
  const lower = normalized.toLowerCase();

  if (
    looksLikeUnexpectedHtmlResponse(normalized) ||
    lower.startsWith("command failed:") ||
    lower.includes("shared codex unavailable") ||
    lower.includes("visolix api отклонил запрос") ||
    lower.includes("visolix rejected the request") ||
    lower.includes("sign in to confirm you’re not a bot") ||
    lower.includes("sign in to confirm you're not a bot")
  ) {
    return summarizeUserFacingError(normalized);
  }

  return normalized;
}

export function summarizeUserFacingError(message: string): string {
  const raw = message.trim();
  const rawLower = raw.toLowerCase();

  if (
    rawLower.includes("<title>502") ||
    rawLower.includes("bad gateway") ||
    rawLower.includes("powered by render") ||
    rawLower.includes("this service is currently unavailable")
  ) {
    return "Хостинг-сервис временно недоступен (502). Попробуйте снова через несколько минут.";
  }

  if (rawLower.includes("<!doctype html") || (rawLower.includes("<html") && rawLower.includes("<body"))) {
    return "Сервер вернул неожиданную HTML-страницу ошибки. Попробуйте снова через несколько минут.";
  }

  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Запрос не выполнен. Попробуйте еще раз.";
  }

  const lower = normalized.toLowerCase();

  if (
    lower.includes("sign in to confirm you’re not a bot") ||
    lower.includes("sign in to confirm you're not a bot") ||
    lower.includes("youtube отклонил запрос")
  ) {
    return "YouTube заблокировал это действие на сервере.";
  }
  if (lower.includes("platform mismatch")) {
    return "Хостинговый загрузчик не распознал ссылку как поддерживаемое видео.";
  }
  if (lower.includes("visolix api отклонил запрос") || lower.includes("visolix rejected the request")) {
    return "Visolix отклонил запрос. Проверьте ключ провайдера и доступ аккаунта.";
  }
  if (lower.includes("codex cli не найден") || lower.includes("codex cli not found")) {
    return "Среда выполнения Shared Codex не установлена на этом деплое.";
  }
  if (lower.includes("ffmpeg") || lower.includes("ffprobe")) {
    return "В среде выполнения отсутствуют ffmpeg/ffprobe на этом деплое.";
  }
  if (lower.startsWith("command failed:")) {
    if (lower.includes("yt-dlp")) {
      return "YouTube заблокировал это действие на сервере.";
    }
    return "Серверная команда завершилась ошибкой при обработке источника.";
  }
  if (lower.includes("shared codex unavailable")) {
    return "Shared Codex еще не подключен.";
  }

  if (normalized.length > 280) {
    return `${normalized.slice(0, 277).trimEnd()}...`;
  }

  return normalized;
}
