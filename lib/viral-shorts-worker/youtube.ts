import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fetchTranscriptFromYtDlpInfo, type YtDlpCaptionInfo } from "../youtube-captions";
import { bestClipTypeForExample, computeQualityScore, deriveWhyItWorks, isAntiExample } from "./analysis";
import { SourceVideoRecord, VideoSnapshot } from "./types";
import { compact, isoformat, nowUtc, parseIso, parseUploadDate } from "./utils";
import { createYtDlpAuthContext } from "../ytdlp";
import { resolveYtDlpExecutable } from "../source-acquisition";

const execFileAsync = promisify(execFile);
const OCR_SCRIPT_PATH = path.join(process.cwd(), "scripts", "viral-shorts-ocr.swift");

type YtDlpInfo = YtDlpCaptionInfo & {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  webpage_url?: unknown;
  thumbnail?: unknown;
  upload_date?: unknown;
  duration?: unknown;
  view_count?: unknown;
  like_count?: unknown;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function resolveEntryUrl(entry: Record<string, unknown>): string {
  const rawUrl = asString(entry.url).trim();
  if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
    return rawUrl;
  }
  const id = asString(entry.id).trim() || rawUrl;
  return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
}

async function runYtDlpJson<T>(args: string[], tmpDir?: string): Promise<T> {
  const ytDlpPath = await resolveYtDlpExecutable();
  if (!ytDlpPath) {
    throw new Error("yt-dlp не найден в среде выполнения.");
  }

  const ownedTmpDir = tmpDir ?? (await mkdtemp(path.join(os.tmpdir(), "viral-shorts-ytdlp-")));
  const auth = await createYtDlpAuthContext(ownedTmpDir);

  try {
    const { stdout } = await execFileAsync(ytDlpPath, [...auth.args, ...args], {
      timeout: 3 * 60_000,
      maxBuffer: 1024 * 1024 * 32
    });
    return JSON.parse(stdout) as T;
  } finally {
    await auth.cleanup().catch(() => undefined);
    if (!tmpDir) {
      await rm(ownedTmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export async function fetchChannelEntries(
  channelUrl: string,
  limit: number,
  mode: "latest" | "popular" = "latest",
  popularWindow = 60
): Promise<Record<string, unknown>[]> {
  if (mode === "latest") {
    const data = await runYtDlpJson<{ entries?: Record<string, unknown>[] }>([
      "--flat-playlist",
      "--playlist-end",
      String(limit),
      "-J",
      `${channelUrl.replace(/\/+$/, "")}/shorts`
    ]);
    return (Array.isArray(data.entries) ? data.entries : []).slice(0, limit);
  }

  const entries = await fetchChannelEntries(channelUrl, popularWindow, "latest", popularWindow);
  const detailed: Record<string, unknown>[] = [];
  for (const entry of entries) {
    detailed.push(await fetchVideoInfo(resolveEntryUrl(entry)));
  }
  detailed.sort((left, right) => (asNumber(right.view_count) ?? 0) - (asNumber(left.view_count) ?? 0));
  return detailed.slice(0, limit);
}

export async function fetchVideoInfo(videoUrl: string): Promise<Record<string, unknown>> {
  return runYtDlpJson<Record<string, unknown>>([
    "--extractor-args",
    "youtube:player_client=android",
    "--skip-download",
    "-J",
    videoUrl
  ]);
}

export async function fetchTranscript(info: YtDlpInfo): Promise<string> {
  return fetchTranscriptFromYtDlpInfo(info);
}

type OcrResult = {
  path: string;
  fullText: string;
  topHalfText: string;
};

async function runOcr(imagePath: string): Promise<OcrResult | null> {
  if (process.platform !== "darwin") {
    return null;
  }

  try {
    const { stdout } = await execFileAsync("swift", [OCR_SCRIPT_PATH, imagePath], {
      timeout: 60_000,
      maxBuffer: 1024 * 1024 * 8
    });
    const parsed = JSON.parse(stdout) as OcrResult[];
    return parsed[0] ?? null;
  } catch {
    return null;
  }
}

function splitOverlayText(fullOcr: string, channelName: string): {
  overlayTop: string;
  overlayBottom: string;
} {
  const text = compact(fullOcr);
  if (!text) {
    return { overlayTop: "", overlayBottom: "" };
  }

  const marker = `@${channelName.replace(/\s+/g, "")}`;
  if (text.includes(marker)) {
    const [left, right] = text.split(marker, 2);
    return {
      overlayTop: compact(left),
      overlayBottom: compact(right)
    };
  }

  if (text.includes(channelName)) {
    const [left, right] = text.split(channelName, 2);
    return {
      overlayTop: compact(left),
      overlayBottom: compact(right)
    };
  }

  if (text.includes("@")) {
    const [before, after] = text.split("@", 2);
    const parts = compact(after).split(" ");
    return {
      overlayTop: compact(before),
      overlayBottom: compact(parts.slice(1).join(" "))
    };
  }

  return { overlayTop: text, overlayBottom: "" };
}

async function downloadThumbnail(thumbnailUrl: string, filePath: string): Promise<void> {
  const response = await fetch(thumbnailUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to download thumbnail.");
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(filePath, buffer);
}

export async function normalizeVideoRecord(params: {
  sourceChannelId: string;
  sourceChannelName: string;
  archetype: string;
  ownedAnchor: boolean;
  info: Record<string, unknown>;
}): Promise<SourceVideoRecord> {
  const info = params.info as YtDlpInfo;
  const videoId = asString(info.id);
  const title = compact(asString(info.title));
  const description = compact(asString(info.description));
  const thumbnailUrl = compact(asString(info.thumbnail));
  let overlayTop = title;
  let overlayBottom = "";
  let overlayFull = title;

  if (thumbnailUrl && videoId) {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "viral-shorts-thumb-"));
    const imagePath = path.join(tmpDir, `${videoId}.jpg`);
    try {
      await downloadThumbnail(thumbnailUrl, imagePath);
      const ocr = await runOcr(imagePath);
      if (ocr?.fullText) {
        overlayFull = compact(ocr.fullText);
        const split = splitOverlayText(ocr.fullText, params.sourceChannelName);
        overlayTop = split.overlayTop || overlayTop;
        overlayBottom = split.overlayBottom;
      }
    } catch {
      // OCR is best-effort. Title/transcript fallback is acceptable here.
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  const transcript = await fetchTranscript(info);
  if (!overlayBottom && description) {
    overlayBottom = description.split(/\.(?:\s|$)/)[0] ?? "";
  }

  const clipType = bestClipTypeForExample(
    params.archetype,
    title,
    overlayTop,
    overlayBottom,
    transcript
  );
  const whyItWorks = deriveWhyItWorks(title, overlayTop, overlayBottom, transcript, clipType);
  const qualityScore = computeQualityScore(title, overlayTop, overlayBottom, transcript);

  return {
    videoId,
    sourceChannelId: params.sourceChannelId,
    sourceChannelName: params.sourceChannelName,
    videoUrl:
      compact(asString(info.webpage_url)) ||
      `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    title,
    description,
    transcript,
    overlayTop,
    overlayBottom: compact(overlayBottom),
    overlayFull,
    publishedAt: parseUploadDate(asString(info.upload_date)),
    durationSeconds: asNumber(info.duration),
    currentViews: asNumber(info.view_count),
    currentLikes: asNumber(info.like_count),
    archetype: params.archetype,
    clipType,
    whyItWorks,
    isOwnedAnchor: params.ownedAnchor,
    isAntiExample: isAntiExample(overlayTop, overlayBottom, qualityScore),
    qualityScore,
    sampleKind: "fetched",
    lastSeenAt: isoformat(nowUtc())
  };
}

export function snapshotFromRecord(record: SourceVideoRecord): VideoSnapshot {
  const publishedAt = parseIso(record.publishedAt);
  const ageHours =
    publishedAt === null
      ? null
      : Math.max((Date.now() - publishedAt.getTime()) / (1000 * 60 * 60), 0.1);
  const views = record.currentViews ?? 0;
  const speed = ageHours === null ? null : Math.round((views / Math.max(ageHours, 1)) * 1000) / 1000;

  return {
    videoId: record.videoId,
    capturedAt: isoformat(nowUtc()),
    views: record.currentViews,
    likes: record.currentLikes,
    ageHours: ageHours === null ? null : Math.round(ageHours * 1000) / 1000,
    speed
  };
}
