import { isSupportedUrl, normalizeSupportedUrl } from "./supported-url";

function sanitizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeStage2StyleDiscoveryReferenceUrls(referenceLinks: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const rawLink of referenceLinks) {
    const trimmed = sanitizeString(rawLink);
    if (!trimmed) {
      continue;
    }
    const normalizedUrl = normalizeSupportedUrl(trimmed);
    if (!isSupportedUrl(normalizedUrl) || seen.has(normalizedUrl)) {
      continue;
    }
    seen.add(normalizedUrl);
    normalized.push(normalizedUrl);
  }
  return normalized;
}
