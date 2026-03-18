import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getAppDataDir } from "../app-paths";
import {
  HotPoolItem,
  SourceChannelConfig,
  SourceVideoRecord,
  StableExample,
  VideoSnapshot,
  ViralShortsChannelProfile
} from "./types";

const WORKER_DB_SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS channel_profiles (
  channel_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  language TEXT NOT NULL,
  archetype TEXT NOT NULL,
  audience TEXT NOT NULL,
  voice_notes_json TEXT NOT NULL,
  hard_constraints_json TEXT NOT NULL,
  competitor_source_ids_json TEXT NOT NULL,
  stable_source_ids_json TEXT NOT NULL,
  hot_pool_enabled INTEGER NOT NULL,
  hot_pool_limit INTEGER NOT NULL,
  hot_pool_per_source_limit INTEGER NOT NULL,
  hot_pool_ttl_days INTEGER NOT NULL,
  hot_pool_lookback_hours INTEGER NOT NULL,
  latest_fetch_limit INTEGER NOT NULL,
  popular_fetch_limit INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS source_channels (
  source_channel_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  archetype TEXT NOT NULL,
  owned INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS source_videos (
  video_id TEXT PRIMARY KEY,
  source_channel_id TEXT NOT NULL,
  source_channel_name TEXT NOT NULL,
  video_url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  transcript TEXT NOT NULL,
  overlay_top TEXT NOT NULL,
  overlay_bottom TEXT NOT NULL,
  overlay_full TEXT NOT NULL,
  published_at TEXT,
  duration_seconds INTEGER,
  current_views INTEGER,
  current_likes INTEGER,
  archetype TEXT NOT NULL,
  clip_type TEXT NOT NULL,
  why_it_works_json TEXT NOT NULL,
  is_owned_anchor INTEGER NOT NULL DEFAULT 0,
  is_anti_example INTEGER NOT NULL DEFAULT 0,
  quality_score REAL NOT NULL DEFAULT 0,
  sample_kind TEXT NOT NULL DEFAULT 'seed',
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS video_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  views INTEGER,
  likes INTEGER,
  age_hours REAL,
  speed REAL,
  UNIQUE(video_id, captured_at)
);

CREATE TABLE IF NOT EXISTS stable_examples (
  example_id TEXT PRIMARY KEY,
  owner_channel_id TEXT NOT NULL,
  source_channel_id TEXT NOT NULL,
  source_channel_name TEXT NOT NULL,
  video_id TEXT NOT NULL,
  archetype TEXT NOT NULL,
  clip_type TEXT NOT NULL,
  overlay_top TEXT NOT NULL,
  overlay_bottom TEXT NOT NULL,
  title TEXT NOT NULL,
  transcript TEXT NOT NULL,
  why_it_works_json TEXT NOT NULL,
  is_owned_anchor INTEGER NOT NULL DEFAULT 0,
  is_anti_example INTEGER NOT NULL DEFAULT 0,
  quality_score REAL NOT NULL DEFAULT 0,
  sample_kind TEXT NOT NULL DEFAULT 'seed',
  last_refreshed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hot_pool_items (
  owner_channel_id TEXT NOT NULL,
  source_channel_id TEXT NOT NULL,
  source_channel_name TEXT NOT NULL,
  video_id TEXT NOT NULL,
  video_url TEXT NOT NULL,
  title TEXT NOT NULL,
  published_at TEXT,
  views INTEGER,
  age_hours REAL,
  anomaly_score REAL NOT NULL,
  overlay_top TEXT NOT NULL,
  overlay_bottom TEXT NOT NULL,
  clip_type TEXT NOT NULL,
  promoted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(owner_channel_id, video_id)
);

CREATE TABLE IF NOT EXISTS run_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_channel_id TEXT,
  run_type TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  details_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_source_videos_source_channel
  ON source_videos(source_channel_id);
CREATE INDEX IF NOT EXISTS idx_source_videos_clip_type
  ON source_videos(archetype, clip_type);
CREATE INDEX IF NOT EXISTS idx_video_snapshots_video
  ON video_snapshots(video_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_stable_examples_owner
  ON stable_examples(owner_channel_id, archetype, clip_type);
CREATE INDEX IF NOT EXISTS idx_hot_pool_owner_expiry
  ON hot_pool_items(owner_channel_id, expires_at);
`;

function resolveStateDir(explicit?: string): string {
  return explicit ?? path.join(getAppDataDir(), "viral-shorts-worker");
}

export class ViralShortsWorkerStore {
  readonly stateDir: string;
  readonly dbPath: string;
  private readonly db: DatabaseSync;

  constructor(explicitStateDir?: string) {
    this.stateDir = resolveStateDir(explicitStateDir);
    this.dbPath = path.join(this.stateDir, "worker.sqlite3");
    if (!existsSync(this.stateDir)) {
      mkdirSync(this.stateDir, { recursive: true });
    }
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(WORKER_DB_SCHEMA);
  }

  initializeCatalog(
    profiles: ViralShortsChannelProfile[],
    sourceChannels: SourceChannelConfig[]
  ): void {
    const upsertProfile = this.db.prepare(
      `INSERT INTO channel_profiles (
        channel_id, name, url, language, archetype, audience,
        voice_notes_json, hard_constraints_json,
        competitor_source_ids_json, stable_source_ids_json,
        hot_pool_enabled, hot_pool_limit, hot_pool_per_source_limit,
        hot_pool_ttl_days, hot_pool_lookback_hours,
        latest_fetch_limit, popular_fetch_limit
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel_id) DO UPDATE SET
        name = excluded.name,
        url = excluded.url,
        language = excluded.language,
        archetype = excluded.archetype,
        audience = excluded.audience,
        voice_notes_json = excluded.voice_notes_json,
        hard_constraints_json = excluded.hard_constraints_json,
        competitor_source_ids_json = excluded.competitor_source_ids_json,
        stable_source_ids_json = excluded.stable_source_ids_json,
        hot_pool_enabled = excluded.hot_pool_enabled,
        hot_pool_limit = excluded.hot_pool_limit,
        hot_pool_per_source_limit = excluded.hot_pool_per_source_limit,
        hot_pool_ttl_days = excluded.hot_pool_ttl_days,
        hot_pool_lookback_hours = excluded.hot_pool_lookback_hours,
        latest_fetch_limit = excluded.latest_fetch_limit,
        popular_fetch_limit = excluded.popular_fetch_limit`
    );
    const upsertSource = this.db.prepare(
      `INSERT INTO source_channels (source_channel_id, name, url, archetype, owned)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(source_channel_id) DO UPDATE SET
        name = excluded.name,
        url = excluded.url,
        archetype = excluded.archetype,
        owned = excluded.owned`
    );

    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const profile of profiles) {
        upsertProfile.run(
          profile.channelId,
          profile.name,
          profile.url,
          profile.language,
          profile.archetype,
          profile.audience,
          JSON.stringify(profile.voiceNotes),
          JSON.stringify(profile.hardConstraints),
          JSON.stringify(profile.competitorSourceIds),
          JSON.stringify(profile.stableSourceIds),
          profile.hotPoolEnabled ? 1 : 0,
          profile.hotPoolLimit,
          profile.hotPoolPerSourceLimit,
          profile.hotPoolTtlDays,
          profile.hotPoolLookbackHours,
          profile.latestFetchLimit,
          profile.popularFetchLimit
        );
      }

      for (const sourceChannel of sourceChannels) {
        upsertSource.run(
          sourceChannel.sourceChannelId,
          sourceChannel.name,
          sourceChannel.url,
          sourceChannel.archetype,
          sourceChannel.owned ? 1 : 0
        );
      }

      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  upsertSourceVideo(row: SourceVideoRecord): void {
    this.db.prepare(
      `INSERT INTO source_videos (
        video_id, source_channel_id, source_channel_name, video_url, title,
        description, transcript, overlay_top, overlay_bottom, overlay_full,
        published_at, duration_seconds, current_views, current_likes,
        archetype, clip_type, why_it_works_json, is_owned_anchor,
        is_anti_example, quality_score, sample_kind, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(video_id) DO UPDATE SET
        source_channel_id = excluded.source_channel_id,
        source_channel_name = excluded.source_channel_name,
        video_url = excluded.video_url,
        title = excluded.title,
        description = excluded.description,
        transcript = excluded.transcript,
        overlay_top = excluded.overlay_top,
        overlay_bottom = excluded.overlay_bottom,
        overlay_full = excluded.overlay_full,
        published_at = excluded.published_at,
        duration_seconds = excluded.duration_seconds,
        current_views = excluded.current_views,
        current_likes = excluded.current_likes,
        archetype = excluded.archetype,
        clip_type = excluded.clip_type,
        why_it_works_json = excluded.why_it_works_json,
        is_owned_anchor = excluded.is_owned_anchor,
        is_anti_example = excluded.is_anti_example,
        quality_score = excluded.quality_score,
        sample_kind = excluded.sample_kind,
        last_seen_at = excluded.last_seen_at`
    ).run(
      row.videoId,
      row.sourceChannelId,
      row.sourceChannelName,
      row.videoUrl,
      row.title,
      row.description,
      row.transcript,
      row.overlayTop,
      row.overlayBottom,
      row.overlayFull,
      row.publishedAt,
      row.durationSeconds,
      row.currentViews,
      row.currentLikes,
      row.archetype,
      row.clipType,
      JSON.stringify(row.whyItWorks),
      row.isOwnedAnchor ? 1 : 0,
      row.isAntiExample ? 1 : 0,
      row.qualityScore,
      row.sampleKind,
      row.lastSeenAt
    );
  }

  insertSnapshot(row: VideoSnapshot): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO video_snapshots (
        video_id, captured_at, views, likes, age_hours, speed
      ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(row.videoId, row.capturedAt, row.views, row.likes, row.ageHours, row.speed);
  }

  replaceStableExamplesForOwner(ownerChannelId: string, rows: StableExample[]): void {
    const deleteStatement = this.db.prepare(
      "DELETE FROM stable_examples WHERE owner_channel_id = ?"
    );
    const insertStatement = this.db.prepare(
      `INSERT INTO stable_examples (
        example_id, owner_channel_id, source_channel_id, source_channel_name,
        video_id, archetype, clip_type, overlay_top, overlay_bottom, title,
        transcript, why_it_works_json, is_owned_anchor, is_anti_example,
        quality_score, sample_kind, last_refreshed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    this.db.exec("BEGIN IMMEDIATE");
    try {
      deleteStatement.run(ownerChannelId);
      for (const row of rows) {
        insertStatement.run(
          row.exampleId,
          row.ownerChannelId,
          row.sourceChannelId,
          row.sourceChannelName,
          row.videoId,
          row.archetype,
          row.clipType,
          row.overlayTop,
          row.overlayBottom,
          row.title,
          row.transcript,
          JSON.stringify(row.whyItWorks),
          row.isOwnedAnchor ? 1 : 0,
          row.isAntiExample ? 1 : 0,
          row.qualityScore,
          row.sampleKind,
          row.lastRefreshedAt
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  upsertHotPoolItem(row: HotPoolItem): void {
    this.db.prepare(
      `INSERT INTO hot_pool_items (
        owner_channel_id, source_channel_id, source_channel_name, video_id,
        video_url, title, published_at, views, age_hours, anomaly_score,
        overlay_top, overlay_bottom, clip_type, promoted_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_channel_id, video_id) DO UPDATE SET
        source_channel_id = excluded.source_channel_id,
        source_channel_name = excluded.source_channel_name,
        video_url = excluded.video_url,
        title = excluded.title,
        published_at = excluded.published_at,
        views = excluded.views,
        age_hours = excluded.age_hours,
        anomaly_score = excluded.anomaly_score,
        overlay_top = excluded.overlay_top,
        overlay_bottom = excluded.overlay_bottom,
        clip_type = excluded.clip_type,
        promoted_at = excluded.promoted_at,
        expires_at = excluded.expires_at`
    ).run(
      row.ownerChannelId,
      row.sourceChannelId,
      row.sourceChannelName,
      row.videoId,
      row.videoUrl,
      row.title,
      row.publishedAt,
      row.views,
      row.ageHours,
      row.anomalyScore,
      row.overlayTop,
      row.overlayBottom,
      row.clipType,
      row.promotedAt,
      row.expiresAt
    );
  }

  expireHotPoolItems(nowIso: string): void {
    this.db.prepare("DELETE FROM hot_pool_items WHERE expires_at <= ?").run(nowIso);
  }

  listStableExamples(ownerChannelId: string): StableExample[] {
    return this.db
      .prepare("SELECT * FROM stable_examples WHERE owner_channel_id = ? ORDER BY quality_score DESC")
      .all(ownerChannelId)
      .map((row) => this.mapStableExample(row as Record<string, unknown>));
  }

  listHotPoolItems(ownerChannelId: string, nowIso?: string): HotPoolItem[] {
    const rows = nowIso
      ? this.db
          .prepare(
            "SELECT * FROM hot_pool_items WHERE owner_channel_id = ? AND expires_at > ? ORDER BY anomaly_score DESC"
          )
          .all(ownerChannelId, nowIso)
      : this.db
          .prepare("SELECT * FROM hot_pool_items WHERE owner_channel_id = ? ORDER BY anomaly_score DESC")
          .all(ownerChannelId);
    return rows.map((row) => this.mapHotPoolItem(row as Record<string, unknown>));
  }

  fetchSourceVideosBySource(sourceChannelId: string): SourceVideoRecord[] {
    return this.db
      .prepare(
        "SELECT * FROM source_videos WHERE source_channel_id = ? ORDER BY quality_score DESC, current_views DESC"
      )
      .all(sourceChannelId)
      .map((row) => this.mapSourceVideo(row as Record<string, unknown>));
  }

  fetchRows<T extends Record<string, unknown>>(
    query: string,
    ...params: Array<string | number | bigint | Uint8Array | null>
  ): T[] {
    return this.db.prepare(query).all(...params) as T[];
  }

  getLastStableRefreshAt(ownerChannelId: string): string | null {
    const row = this.db
      .prepare(
        "SELECT MAX(last_refreshed_at) AS value FROM stable_examples WHERE owner_channel_id = ?"
      )
      .get(ownerChannelId) as { value?: string | null } | undefined;
    return row?.value ?? null;
  }

  getLastHotRefreshAt(ownerChannelId: string): string | null {
    const row = this.db
      .prepare("SELECT MAX(promoted_at) AS value FROM hot_pool_items WHERE owner_channel_id = ?")
      .get(ownerChannelId) as { value?: string | null } | undefined;
    return row?.value ?? null;
  }

  getHotPoolCount(ownerChannelId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM hot_pool_items WHERE owner_channel_id = ?")
      .get(ownerChannelId) as { count?: number } | undefined;
    return Number(row?.count ?? 0);
  }

  logRun(input: {
    ownerChannelId?: string | null;
    runType: string;
    startedAt: string;
    completedAt?: string | null;
    status: string;
    details: unknown;
  }): void {
    this.db.prepare(
      `INSERT INTO run_logs (
        owner_channel_id, run_type, started_at, completed_at, status, details_json
      ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      input.ownerChannelId ?? null,
      input.runType,
      input.startedAt,
      input.completedAt ?? null,
      input.status,
      JSON.stringify(input.details ?? {})
    );
  }

  private mapSourceVideo(row: Record<string, unknown>): SourceVideoRecord {
    return {
      videoId: String(row.video_id),
      sourceChannelId: String(row.source_channel_id),
      sourceChannelName: String(row.source_channel_name),
      videoUrl: String(row.video_url),
      title: String(row.title),
      description: String(row.description ?? ""),
      transcript: String(row.transcript ?? ""),
      overlayTop: String(row.overlay_top ?? ""),
      overlayBottom: String(row.overlay_bottom ?? ""),
      overlayFull: String(row.overlay_full ?? ""),
      publishedAt: row.published_at ? String(row.published_at) : null,
      durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
      currentViews: row.current_views === null ? null : Number(row.current_views),
      currentLikes: row.current_likes === null ? null : Number(row.current_likes),
      archetype: String(row.archetype),
      clipType: String(row.clip_type),
      whyItWorks: JSON.parse(String(row.why_it_works_json ?? "[]")) as string[],
      isOwnedAnchor: Boolean(row.is_owned_anchor),
      isAntiExample: Boolean(row.is_anti_example),
      qualityScore: Number(row.quality_score ?? 0),
      sampleKind: String(row.sample_kind ?? "seed"),
      lastSeenAt: String(row.last_seen_at)
    };
  }

  private mapStableExample(row: Record<string, unknown>): StableExample {
    return {
      exampleId: String(row.example_id),
      ownerChannelId: String(row.owner_channel_id),
      sourceChannelId: String(row.source_channel_id),
      sourceChannelName: String(row.source_channel_name),
      videoId: String(row.video_id),
      archetype: String(row.archetype),
      clipType: String(row.clip_type),
      overlayTop: String(row.overlay_top ?? ""),
      overlayBottom: String(row.overlay_bottom ?? ""),
      title: String(row.title ?? ""),
      transcript: String(row.transcript ?? ""),
      whyItWorks: JSON.parse(String(row.why_it_works_json ?? "[]")) as string[],
      isOwnedAnchor: Boolean(row.is_owned_anchor),
      isAntiExample: Boolean(row.is_anti_example),
      qualityScore: Number(row.quality_score ?? 0),
      sampleKind: String(row.sample_kind ?? "seed"),
      lastRefreshedAt: String(row.last_refreshed_at)
    };
  }

  private mapHotPoolItem(row: Record<string, unknown>): HotPoolItem {
    return {
      ownerChannelId: String(row.owner_channel_id),
      sourceChannelId: String(row.source_channel_id),
      sourceChannelName: String(row.source_channel_name),
      videoId: String(row.video_id),
      videoUrl: String(row.video_url),
      title: String(row.title ?? ""),
      publishedAt: row.published_at ? String(row.published_at) : null,
      views: row.views === null ? null : Number(row.views),
      ageHours: row.age_hours === null ? null : Number(row.age_hours),
      anomalyScore: Number(row.anomaly_score ?? 0),
      overlayTop: String(row.overlay_top ?? ""),
      overlayBottom: String(row.overlay_bottom ?? ""),
      clipType: String(row.clip_type),
      promotedAt: String(row.promoted_at),
      expiresAt: String(row.expires_at)
    };
  }
}
