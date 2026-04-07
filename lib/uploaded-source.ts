export const UPLOADED_SOURCE_PROTOCOL = "upload:";

function safeBaseName(fileName: string): string {
  const normalized = String(fileName ?? "").replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "upload.mp4";
}

export function isUploadedSourceUrl(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).protocol === UPLOADED_SOURCE_PROTOCOL;
  } catch {
    return false;
  }
}

export function buildUploadedSourceUrl(uploadId: string, fileName: string): string {
  const safeName = encodeURIComponent(safeBaseName(fileName || "upload.mp4"));
  return `upload://${encodeURIComponent(uploadId)}/${safeName}`;
}

export function extractUploadedSourceId(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== UPLOADED_SOURCE_PROTOCOL) {
      return null;
    }
    const candidate = decodeURIComponent(parsed.hostname || "").trim();
    return candidate || null;
  } catch {
    return null;
  }
}

export function getUploadedSourceDisplayName(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== UPLOADED_SOURCE_PROTOCOL) {
      return null;
    }
    const candidate = decodeURIComponent(parsed.pathname.split("/").filter(Boolean)[0] ?? "").trim();
    return candidate || null;
  } catch {
    return null;
  }
}
