import { promises as fs } from "node:fs";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

const COMMENT_JSON_FILE_RE = /\.(json|jsonl|ndjson)$/i;
const COMMENT_NAME_RE = /comment/i;

function parseJsonLines(text: string): unknown[] | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return null;
  }

  const parsed: unknown[] = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      return null;
    }
  }

  return parsed;
}

function parseJsonOrJsonLines(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return parseJsonLines(trimmed);
  }
}

function extractCommentCollection(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const record = raw as JsonRecord;
  for (const key of ["comments", "items", "entries"]) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return null;
}

function rankMetadataFile(fileName: string, preferredStem: string, kind: "info" | "comments"): number {
  const normalizedName = fileName.toLowerCase();
  const preferredPrefix = `${preferredStem.toLowerCase()}.`;

  if (kind === "info") {
    if (normalizedName === `${preferredStem.toLowerCase()}.info.json`) {
      return 0;
    }
    if (normalizedName.startsWith(preferredPrefix) && normalizedName.endsWith(".info.json")) {
      return 1;
    }
    return 2;
  }

  const stemBoost = normalizedName.startsWith(preferredPrefix) ? 0 : 10;
  const explicitCommentsBoost = normalizedName.includes(".comments.") ? 0 : 1;
  return stemBoost + explicitCommentsBoost;
}

export function pickPreferredYtDlpInfoJsonFile(
  files: string[],
  preferredStem = "metadata"
): string | null {
  const candidates = files.filter((file) => file.endsWith(".info.json"));
  if (candidates.length === 0) {
    return null;
  }

  return [...candidates].sort((left, right) => {
    const rankDiff =
      rankMetadataFile(left, preferredStem, "info") - rankMetadataFile(right, preferredStem, "info");
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return left.localeCompare(right);
  })[0] ?? null;
}

async function readPreferredCommentsArtifact(
  tmpDir: string,
  files: string[],
  preferredStem: string
): Promise<unknown[] | null> {
  const candidates = files
    .filter(
      (file) =>
        file !== `${preferredStem}.info.json` &&
        !file.endsWith(".info.json") &&
        COMMENT_NAME_RE.test(file) &&
        COMMENT_JSON_FILE_RE.test(file)
    )
    .sort((left, right) => {
      const rankDiff =
        rankMetadataFile(left, preferredStem, "comments") -
        rankMetadataFile(right, preferredStem, "comments");
      if (rankDiff !== 0) {
        return rankDiff;
      }
      return left.localeCompare(right);
    });

  for (const file of candidates) {
    const filePath = path.join(tmpDir, file);
    const rawText = await fs.readFile(filePath, "utf-8");
    const parsed = parseJsonOrJsonLines(rawText);
    const comments = extractCommentCollection(parsed);
    if (comments) {
      return comments;
    }
  }

  return null;
}

export async function readYtDlpMetadataArtifacts(
  tmpDir: string,
  preferredStem = "metadata"
): Promise<{ infoJson: JsonRecord | null; comments: unknown[] }> {
  const files = await fs.readdir(tmpDir);
  const infoJsonFile = pickPreferredYtDlpInfoJsonFile(files, preferredStem);
  const infoJson = infoJsonFile
    ? (JSON.parse(await fs.readFile(path.join(tmpDir, infoJsonFile), "utf-8")) as JsonRecord)
    : null;

  const embeddedComments = extractCommentCollection(infoJson?.comments);
  if (embeddedComments && embeddedComments.length > 0) {
    return {
      infoJson,
      comments: embeddedComments
    };
  }

  const artifactComments = await readPreferredCommentsArtifact(tmpDir, files, preferredStem);
  if (artifactComments && artifactComments.length > 0) {
    return {
      infoJson,
      comments: artifactComments
    };
  }

  return {
    infoJson,
    comments: embeddedComments ?? artifactComments ?? []
  };
}
