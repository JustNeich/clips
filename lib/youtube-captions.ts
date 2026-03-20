import { compact } from "./viral-shorts-worker/utils";

export type YtDlpCaptionInfo = {
  language?: unknown;
  subtitles?: Record<string, Array<{ ext?: unknown; url?: unknown }>> | null;
  automatic_captions?: Record<string, Array<{ ext?: unknown; url?: unknown }>> | null;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function chooseCaptionUrl(info: YtDlpCaptionInfo): string | null {
  const subtitles = info.subtitles ?? {};
  const automatic = info.automatic_captions ?? {};
  const preferred = [asString(info.language), "en", "en-US", "ru", "ru-RU"].filter(Boolean);

  for (const key of preferred) {
    const entries = subtitles[key] ?? automatic[key];
    if (!entries) {
      continue;
    }
    for (const entry of entries) {
      const ext = asString(entry.ext);
      const url = asString(entry.url);
      if (url && ["json3", "vtt", "srv3"].includes(ext)) {
        return url;
      }
    }
  }

  for (const pool of [subtitles, automatic]) {
    for (const entries of Object.values(pool)) {
      for (const entry of entries ?? []) {
        const ext = asString(entry.ext);
        const url = asString(entry.url);
        if (url && ["json3", "vtt", "srv3"].includes(ext)) {
          return url;
        }
      }
    }
  }

  return null;
}

function vttToText(payload: string): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of payload.split("\n")) {
    const line = compact(rawLine);
    if (
      !line ||
      line === "WEBVTT" ||
      line.includes("-->") ||
      line.startsWith("Kind:") ||
      line.startsWith("Language:")
    ) {
      continue;
    }
    if (!seen.has(line)) {
      seen.add(line);
      lines.push(line);
    }
  }
  return compact(lines.join(" "));
}

function json3ToText(payload: string): string {
  const data = JSON.parse(payload) as {
    events?: Array<{ segs?: Array<{ utf8?: string }> }>;
  };
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const event of data.events ?? []) {
    for (const segment of event.segs ?? []) {
      const value = compact(asString(segment.utf8).replace(/\n/g, " "));
      if (value && !seen.has(value)) {
        seen.add(value);
        lines.push(value);
      }
    }
  }
  return compact(lines.join(" "));
}

export async function fetchTranscriptFromYtDlpInfo(info: YtDlpCaptionInfo): Promise<string> {
  const captionUrl = chooseCaptionUrl(info);
  if (!captionUrl) {
    return "";
  }

  try {
    const response = await fetch(captionUrl, { cache: "no-store" });
    if (!response.ok) {
      return "";
    }
    const payload = await response.text();
    if (payload.startsWith("WEBVTT")) {
      return vttToText(payload);
    }
    if (payload.trim().startsWith("{")) {
      return json3ToText(payload);
    }
    return compact(payload);
  } catch {
    return "";
  }
}
