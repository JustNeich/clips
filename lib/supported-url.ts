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

  if (hostname.includes("instagram.com")) {
    const pathSegments = normalized.pathname.split("/").filter(Boolean);
    const reelIndex = pathSegments.findIndex((segment) => {
      const lowered = segment.toLowerCase();
      return lowered === "reel" || lowered === "reels";
    });

    if (reelIndex >= 0 && pathSegments[reelIndex + 1]) {
      normalized.pathname = `/reel/${pathSegments[reelIndex + 1]}/`;
    }
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

    const normalizedHost = normalizeHostname(parsed.hostname);
    if (!SUPPORTED_HOSTS.has(normalizedHost)) {
      return false;
    }

    const pathname = parsed.pathname.toLowerCase();
    const isYouTubeWatchUrl =
      normalizedHost.includes("youtube.com") &&
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
