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
    return "The hosted service is temporarily unavailable (502). Try again in a few minutes.";
  }

  if (rawLower.includes("<!doctype html") || (rawLower.includes("<html") && rawLower.includes("<body"))) {
    return "The server returned an unexpected HTML error page. Try again in a few minutes.";
  }

  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "The request failed. Try again.";
  }

  const lower = normalized.toLowerCase();

  if (
    lower.includes("sign in to confirm you’re not a bot") ||
    lower.includes("sign in to confirm you're not a bot") ||
    lower.includes("youtube отклонил запрос")
  ) {
    return "YouTube blocked this action on the server.";
  }
  if (lower.includes("platform mismatch")) {
    return "The hosted downloader could not recognize this link as a supported video.";
  }
  if (lower.includes("visolix api отклонил запрос") || lower.includes("visolix rejected the request")) {
    return "Visolix rejected the request. Check the provider key and account access.";
  }
  if (lower.includes("codex cli не найден") || lower.includes("codex cli not found")) {
    return "Shared Codex runtime is not installed on this deployment.";
  }
  if (lower.includes("ffmpeg") || lower.includes("ffprobe")) {
    return "The media runtime is missing ffmpeg/ffprobe on this deployment.";
  }
  if (lower.startsWith("command failed:")) {
    if (lower.includes("yt-dlp")) {
      return "YouTube blocked this action on the server.";
    }
    return "A server command failed while processing the source.";
  }
  if (lower.includes("shared codex unavailable")) {
    return "Shared Codex is not connected yet.";
  }

  if (normalized.length > 280) {
    return `${normalized.slice(0, 277).trimEnd()}...`;
  }

  return normalized;
}
