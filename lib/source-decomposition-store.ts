import { promises as fs } from "node:fs";
import path from "node:path";
import { getAppDataDir } from "./app-paths";
import { getDb, newId, nowIso, runInTransaction } from "./db/client";

/**
 * Agent-flow Stage-1 decomposition artifact store.
 *
 * AGENT-ONLY: nothing in the human manual flow (UI Stage 1 -> 2 -> 3) reads or
 * writes this store. It is reachable solely from the explicit agent entry
 * (`clips_owner_run_agent_pipeline`) and the agent read tool
 * (`clips_flow_get_source_decomposition`).
 *
 * STORAGE ISOLATION: frames/subtitles/comments live under a dedicated
 * `agent-decomposition/` tree that is SEPARATE from `source-media-cache/`. The
 * human source-media cache and its pruning budgets are never touched, so the
 * heavy frame payloads (15-60MB/clip) cannot evict a human's cached mp4 or
 * count against the hosted-Render source cache ceiling.
 */

export type DecompositionComment = {
  author: string;
  text: string;
  likes: number;
  postedAt: string | null;
};

export type DecompositionFrame = {
  index: number;
  timestampSec: number;
  fileName: string;
  description: string;
};

export type DecompositionSubtitleSegment = {
  startSec: number;
  endSec: number;
  text: string;
};

export type DecompositionSubtitles = {
  available: boolean;
  language: string | null;
  skippedReason: string | null;
  segments: DecompositionSubtitleSegment[];
};

export type DecompositionMeta = {
  durationSec: number | null;
  width: number | null;
  height: number | null;
  frameCount: number;
  extractedAt: string;
  framesSkippedReason: string | null;
};

export type SourceDecompositionArtifact = {
  sourceKey: string;
  comments: DecompositionComment[];
  frames: DecompositionFrame[];
  subtitles: DecompositionSubtitles;
  meta: DecompositionMeta;
};

export type SourceDecompositionRecord = {
  id: string;
  workspaceId: string;
  channelId: string;
  chatId: string;
  sourceKey: string;
  sourceUrl: string;
  artifact: SourceDecompositionArtifact;
  framesDir: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

type SourceDecompositionRow = {
  id: string;
  workspace_id: string;
  channel_id: string;
  chat_id: string;
  source_key: string;
  source_url: string;
  artifact_json: string;
  frames_dir: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
};

// 24h TTL by default; agent re-decomposition refreshes it. Kept short so the
// frame payloads do not accumulate on disk.
const DECOMPOSITION_TTL_MS = 24 * 60 * 60_000;

export function getAgentDecompositionRoot(): string {
  return path.join(getAppDataDir(), "agent-decomposition");
}

export function getAgentDecompositionFramesDir(sourceKey: string): string {
  return path.join(getAgentDecompositionRoot(), sourceKey, "frames");
}

function parseArtifact(raw: string): SourceDecompositionArtifact | null {
  try {
    return JSON.parse(raw) as SourceDecompositionArtifact;
  } catch {
    return null;
  }
}

function mapRow(row: SourceDecompositionRow): SourceDecompositionRecord | null {
  const artifact = parseArtifact(row.artifact_json);
  if (!artifact) {
    return null;
  }
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    channelId: String(row.channel_id),
    chatId: String(row.chat_id),
    sourceKey: String(row.source_key),
    sourceUrl: String(row.source_url),
    artifact,
    framesDir: String(row.frames_dir),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    expiresAt: String(row.expires_at)
  };
}

function isExpired(record: SourceDecompositionRecord, at = Date.now()): boolean {
  const expires = Date.parse(record.expiresAt);
  return Number.isFinite(expires) && expires <= at;
}

async function removeFramesDirForKey(sourceKey: string): Promise<void> {
  const keyRoot = path.join(getAgentDecompositionRoot(), sourceKey);
  await fs.rm(keyRoot, { recursive: true, force: true }).catch(() => undefined);
}

/**
 * Persist (or replace) the decomposition for a chat. The frame image files are
 * expected to already be written under `framesDir`; this records the metadata
 * row and refreshes the TTL.
 */
export function saveSourceDecomposition(input: {
  workspaceId: string;
  channelId: string;
  chatId: string;
  sourceKey: string;
  sourceUrl: string;
  artifact: SourceDecompositionArtifact;
  framesDir: string;
  ttlMs?: number;
}): SourceDecompositionRecord {
  const db = getDb();
  const now = nowIso();
  const expiresAt = new Date(Date.now() + (input.ttlMs ?? DECOMPOSITION_TTL_MS)).toISOString();
  const id = newId();

  runInTransaction(() => {
    db.prepare("DELETE FROM source_decompositions WHERE workspace_id = ? AND chat_id = ?").run(
      input.workspaceId,
      input.chatId
    );
    db.prepare(
      `INSERT INTO source_decompositions
        (id, workspace_id, channel_id, chat_id, source_key, source_url, artifact_json, frames_dir, created_at, updated_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.workspaceId,
      input.channelId,
      input.chatId,
      input.sourceKey,
      input.sourceUrl,
      JSON.stringify(input.artifact),
      input.framesDir,
      now,
      now,
      expiresAt
    );
  });

  return {
    id,
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    chatId: input.chatId,
    sourceKey: input.sourceKey,
    sourceUrl: input.sourceUrl,
    artifact: input.artifact,
    framesDir: input.framesDir,
    createdAt: now,
    updatedAt: now,
    expiresAt
  };
}

export function getSourceDecompositionForChat(
  workspaceId: string,
  chatId: string
): SourceDecompositionRecord | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT * FROM source_decompositions WHERE workspace_id = ? AND chat_id = ? ORDER BY created_at DESC LIMIT 1"
    )
    .get(workspaceId, chatId) as SourceDecompositionRow | undefined;
  if (!row) {
    return null;
  }
  const record = mapRow(row);
  if (!record) {
    return null;
  }
  if (isExpired(record)) {
    return null;
  }
  return record;
}

/**
 * Resolve the absolute path of one frame image, guarding against path traversal
 * and confirming the frame belongs to the stored artifact.
 */
export function resolveDecompositionFramePath(
  record: SourceDecompositionRecord,
  frameIndex: number
): string | null {
  const frame = record.artifact.frames.find((entry) => entry.index === frameIndex);
  if (!frame) {
    return null;
  }
  const fileName = path.basename(frame.fileName);
  if (fileName !== frame.fileName) {
    return null;
  }
  return path.join(record.framesDir, fileName);
}

/**
 * Remove expired decomposition rows and their on-disk frame directories. Runs
 * independently of the source-media cache pruning.
 */
export async function pruneExpiredSourceDecompositions(): Promise<number> {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM source_decompositions").all() as SourceDecompositionRow[];
  const now = Date.now();
  let removed = 0;
  for (const row of rows) {
    const record = mapRow(row);
    if (!record || isExpired(record, now)) {
      db.prepare("DELETE FROM source_decompositions WHERE id = ?").run(String(row.id));
      await removeFramesDirForKey(String(row.source_key));
      removed += 1;
    }
  }
  return removed;
}
