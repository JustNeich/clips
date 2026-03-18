import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export function nowUtc(): Date {
  return new Date();
}

export function isoformat(value: Date): string {
  return new Date(value.getTime() - value.getMilliseconds()).toISOString();
}

export function parseIso(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function parseUploadDate(value: string | null | undefined): string | null {
  if (!value || value.length !== 8) {
    return value ?? null;
  }
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`;
}

export function compact(text: string | null | undefined): string {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenOverlapScore(left: string, right: string): number {
  const leftTokens = new Set(
    compact(left)
      .toLowerCase()
      .match(/[a-z0-9]+/g)?.filter((token) => token.length > 2) ?? []
  );
  const rightTokens = new Set(
    compact(right)
      .toLowerCase()
      .match(/[a-z0-9]+/g)?.filter((token) => token.length > 2) ?? []
  );
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }

  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

export function medianOrDefault(values: number[], fallback: number): number {
  const cleaned = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (cleaned.length === 0) {
    return fallback;
  }
  const middle = Math.floor(cleaned.length / 2);
  if (cleaned.length % 2 === 1) {
    return cleaned[middle] ?? fallback;
  }
  return ((cleaned[middle - 1] ?? fallback) + (cleaned[middle] ?? fallback)) / 2;
}

export function expiresAfter(days: number): string {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  return isoformat(value);
}

export async function dumpJson(filePath: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}
