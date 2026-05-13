import { getDb, newId, nowIso, runInTransaction } from "./db/client";
import { normalizeSupportedUrl } from "./ytdlp";
import {
  normalizeStage3SourceCrop
} from "./stage3-source-crop";
import type { Stage3SourceCrop } from "../app/components/types";

export type CopscopesSourceStatus =
  | "available"
  | "in_progress"
  | "consumed"
  | "needs_review"
  | "skipped"
  | "failed";

export type CopscopesCategoryStatus = "available" | "active" | "exhausted" | "paused";

export type CopscopesRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "exhausted"
  | "failed"
  | "dry_run";

export type CopscopesSourcePoolImportItem = {
  url: string;
  title?: string | null;
  caption?: string | null;
  viewsLabel?: string | null;
  viewCount?: number | null;
  postedAt?: string | null;
  categorySlug?: string | null;
  categoryLabel?: string | null;
  secondaryTags?: string[] | null;
  qualityScore?: number | null;
  cropConfidence?: number | null;
  crop?: Stage3SourceCrop | null;
  metadata?: Record<string, unknown> | null;
};

export type CopscopesSourceCategory = {
  id: string;
  workspaceId: string;
  channelId: string;
  slug: string;
  label: string;
  description: string;
  status: CopscopesCategoryStatus;
  sortOrder: number;
  availableCount: number;
  inProgressCount: number;
  consumedCount: number;
  needsReviewCount: number;
  failedCount: number;
  skippedCount: number;
  totalCount: number;
  createdAt: string;
  updatedAt: string;
  exhaustedAt: string | null;
};

export type CopscopesSourceReel = {
  id: string;
  workspaceId: string;
  channelId: string;
  sourceUrl: string;
  canonicalUrl: string;
  shortcode: string;
  title: string;
  caption: string;
  viewCount: number | null;
  viewsLabel: string | null;
  postedAt: string | null;
  categoryId: string | null;
  categorySlug: string;
  secondaryTags: string[];
  qualityScore: number | null;
  cropConfidence: number | null;
  crop: Stage3SourceCrop | null;
  metadata: Record<string, unknown>;
  status: CopscopesSourceStatus;
  consumedChatId: string | null;
  consumedStage2RunId: string | null;
  consumedStage3JobId: string | null;
  lastError: string | null;
  importedAt: string;
  updatedAt: string;
  consumedAt: string | null;
};

export type ImportCopscopesSourcePoolResult = {
  dryRun: boolean;
  created: number;
  updated: number;
  skipped: number;
  duplicates: number;
  invalid: Array<{ url: string; reason: string }>;
  categories: CopscopesSourceCategory[];
  reels: CopscopesSourceReel[];
};

export const COPSCOPES_DEFAULT_CATEGORIES = [
  {
    slug: "vehicle-pursuit",
    label: "Vehicle pursuits",
    description: "High-speed chases, PIT attempts, crashes, stolen cars and fleeing drivers."
  },
  {
    slug: "traffic-stop",
    label: "Traffic stops",
    description: "Stops that turn because of warrants, contraband, arguments, or unexpected behavior."
  },
  {
    slug: "arrest-struggle",
    label: "Arrest struggles",
    description: "Physical resistance, takedowns, cuffs, tasers, K9 contact, or chaotic suspect control."
  },
  {
    slug: "foot-chase",
    label: "Foot chases",
    description: "Suspects running on foot, fence hops, hiding, and short pursuit captures."
  },
  {
    slug: "rescue-fire",
    label: "Rescue and fire",
    description: "Officers pulling people from crashes, fire, water, overdose, or immediate danger."
  },
  {
    slug: "search-discovery",
    label: "Search and discovery",
    description: "Vehicle searches, hidden evidence, warrants, weapons, drugs, and discovery reveals."
  },
  {
    slug: "officer-close-call",
    label: "Officer close calls",
    description: "Near misses, sudden weapons, ambush risk, crashes into officers, and split-second danger."
  },
  {
    slug: "other-bodycam",
    label: "Other bodycam moments",
    description: "Police/bodycam clips that do not clearly fit the stronger production categories."
  }
] as const;

type ReelRow = {
  id: string;
  workspace_id: string;
  channel_id: string;
  source_url: string;
  canonical_url: string;
  shortcode: string;
  title: string;
  caption: string;
  view_count?: number | null;
  views_label?: string | null;
  posted_at?: string | null;
  category_id?: string | null;
  category_slug: string;
  secondary_tags_json: string;
  quality_score?: number | null;
  crop_confidence?: number | null;
  crop_json?: string | null;
  metadata_json: string;
  status: string;
  consumed_chat_id?: string | null;
  consumed_stage2_run_id?: string | null;
  consumed_stage3_job_id?: string | null;
  last_error?: string | null;
  imported_at: string;
  updated_at: string;
  consumed_at?: string | null;
};

type CategoryRow = {
  id: string;
  workspace_id: string;
  channel_id: string;
  slug: string;
  label: string;
  description: string;
  status: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  exhausted_at?: string | null;
  available_count?: number | null;
  in_progress_count?: number | null;
  consumed_count?: number | null;
  needs_review_count?: number | null;
  failed_count?: number | null;
  skipped_count?: number | null;
  total_count?: number | null;
};

function parseJsonArray(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw ?? "[]") as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function sanitizeString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, maxLength);
}

function sanitizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }
  return [
    ...new Set(
      tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 12)
    )
  ];
}

function normalizeScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(100, Math.max(0, Number(value.toFixed(3))));
}

function mapCategory(row: CategoryRow): CopscopesSourceCategory {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    channelId: String(row.channel_id),
    slug: String(row.slug),
    label: String(row.label),
    description: String(row.description),
    status: normalizeCategoryStatus(row.status),
    sortOrder: Number(row.sort_order ?? 0),
    availableCount: Number(row.available_count ?? 0),
    inProgressCount: Number(row.in_progress_count ?? 0),
    consumedCount: Number(row.consumed_count ?? 0),
    needsReviewCount: Number(row.needs_review_count ?? 0),
    failedCount: Number(row.failed_count ?? 0),
    skippedCount: Number(row.skipped_count ?? 0),
    totalCount: Number(row.total_count ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    exhaustedAt: row.exhausted_at ? String(row.exhausted_at) : null
  };
}

function mapReel(row: ReelRow): CopscopesSourceReel {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    channelId: String(row.channel_id),
    sourceUrl: String(row.source_url),
    canonicalUrl: String(row.canonical_url),
    shortcode: String(row.shortcode),
    title: String(row.title ?? ""),
    caption: String(row.caption ?? ""),
    viewCount: row.view_count === null || row.view_count === undefined ? null : Number(row.view_count),
    viewsLabel: row.views_label ? String(row.views_label) : null,
    postedAt: row.posted_at ? String(row.posted_at) : null,
    categoryId: row.category_id ? String(row.category_id) : null,
    categorySlug: String(row.category_slug),
    secondaryTags: parseJsonArray(row.secondary_tags_json),
    qualityScore: row.quality_score === null || row.quality_score === undefined ? null : Number(row.quality_score),
    cropConfidence: row.crop_confidence === null || row.crop_confidence === undefined ? null : Number(row.crop_confidence),
    crop: normalizeStage3SourceCrop(parseJsonObject(row.crop_json), null),
    metadata: parseJsonObject(row.metadata_json),
    status: normalizeSourceStatus(row.status),
    consumedChatId: row.consumed_chat_id ? String(row.consumed_chat_id) : null,
    consumedStage2RunId: row.consumed_stage2_run_id ? String(row.consumed_stage2_run_id) : null,
    consumedStage3JobId: row.consumed_stage3_job_id ? String(row.consumed_stage3_job_id) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    importedAt: String(row.imported_at),
    updatedAt: String(row.updated_at),
    consumedAt: row.consumed_at ? String(row.consumed_at) : null
  };
}

export function normalizeSourceStatus(status: unknown): CopscopesSourceStatus {
  return status === "in_progress" ||
    status === "consumed" ||
    status === "needs_review" ||
    status === "skipped" ||
    status === "failed"
    ? status
    : "available";
}

export function normalizeCategoryStatus(status: unknown): CopscopesCategoryStatus {
  return status === "active" || status === "exhausted" || status === "paused" ? status : "available";
}

export function normalizeCopscopesCategorySlug(value: unknown): string {
  const slug =
    typeof value === "string"
      ? value
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
      : "";
  return slug || "other-bodycam";
}

export function parseInstagramReelShortcode(rawUrl: string): string | null {
  const value = rawUrl.trim();
  const match = value.match(/instagram\.com\/(?:[^/]+\/)?(?:reel|reels)\/([^/?#]+)/i);
  if (!match?.[1]) {
    return null;
  }
  return match[1].trim();
}

export function canonicalizeInstagramReelUrl(rawUrl: string): { canonicalUrl: string; shortcode: string } | null {
  const normalized = normalizeSupportedUrl(rawUrl.trim()) || rawUrl.trim();
  const shortcode = parseInstagramReelShortcode(normalized) ?? parseInstagramReelShortcode(rawUrl);
  if (!shortcode) {
    return null;
  }
  return {
    canonicalUrl: `https://www.instagram.com/reel/${shortcode}/`,
    shortcode
  };
}

export function classifyCopscopesCategory(item: Pick<CopscopesSourcePoolImportItem, "title" | "caption" | "metadata">): {
  slug: string;
  tags: string[];
} {
  const metadataText = item.metadata ? JSON.stringify(item.metadata) : "";
  const text = `${item.title ?? ""} ${item.caption ?? ""} ${metadataText}`.toLowerCase();
  const has = (cues: string[]) => cues.some((cue) => text.includes(cue));

  if (has(["pit", "pursuit", "chase", "stolen car", "fleeing driver", "crash", "vehicle pursuit"])) {
    return { slug: "vehicle-pursuit", tags: ["pursuit"] };
  }
  if (has(["traffic stop", "pulled over", "plate", "speeding", "dui", "dashcam stop"])) {
    return { slug: "traffic-stop", tags: ["traffic-stop"] };
  }
  if (has(["taser", "resisting", "arrest", "fight", "struggle", "handcuff", "k9", "body slam"])) {
    return { slug: "arrest-struggle", tags: ["arrest"] };
  }
  if (has(["foot chase", "ran away", "runs away", "fence", "backyard", "hide", "hiding"])) {
    return { slug: "foot-chase", tags: ["foot-chase"] };
  }
  if (has(["rescue", "fire", "burning", "overdose", "water", "river", "baby", "saved", "pulls him out"])) {
    return { slug: "rescue-fire", tags: ["rescue"] };
  }
  if (has(["search", "found", "weapon", "gun", "drugs", "warrant", "evidence", "hidden"])) {
    return { slug: "search-discovery", tags: ["search"] };
  }
  if (has(["shooting", "gunfire", "near miss", "ambush", "close call", "knife", "weapon drawn"])) {
    return { slug: "officer-close-call", tags: ["close-call"] };
  }
  return { slug: "other-bodycam", tags: [] };
}

export function detectCopscopesSourceCrop(input?: {
  crop?: Stage3SourceCrop | null;
  cropConfidence?: number | null;
}): Stage3SourceCrop {
  const normalized = normalizeStage3SourceCrop(input?.crop, null);
  if (normalized?.enabled) {
    return {
      ...normalized,
      confidence: normalizeScore(input?.cropConfidence) ?? normalized.confidence ?? 0.7
    };
  }
  return {
    enabled: true,
    x: 0.08,
    y: 0.16,
    width: 0.84,
    height: 0.66,
    confidence: normalizeScore(input?.cropConfidence) ?? 0.62,
    source: "copscopes-default-inner-frame",
    notes:
      "Default crop removes CopScopes black frame, top/bottom text, captions, and profile meta before fitting the source into our template."
  };
}

function estimateQualityScore(item: CopscopesSourcePoolImportItem, categorySlug: string): number {
  const explicit = normalizeScore(item.qualityScore);
  if (explicit !== null) {
    return explicit;
  }
  const views = typeof item.viewCount === "number" && Number.isFinite(item.viewCount) ? item.viewCount : 0;
  const viewsScore = Math.min(58, Math.log10(Math.max(1, views)) * 10);
  const textScore = Math.min(22, `${item.title ?? ""} ${item.caption ?? ""}`.trim().length / 7);
  const categoryScore = categorySlug === "other-bodycam" ? 6 : 14;
  return Number(Math.min(100, viewsScore + textScore + categoryScore).toFixed(3));
}

function getCategorySeed(slug: string): (typeof COPSCOPES_DEFAULT_CATEGORIES)[number] | null {
  return COPSCOPES_DEFAULT_CATEGORIES.find((category) => category.slug === slug) ?? null;
}

function ensureCopscopesCategory(input: {
  workspaceId: string;
  channelId: string;
  slug: string;
  label?: string | null;
  description?: string | null;
  sortOrder?: number | null;
}): string {
  const db = getDb();
  const stamp = nowIso();
  const slug = normalizeCopscopesCategorySlug(input.slug);
  const seed = getCategorySeed(slug);
  const label = sanitizeString(input.label, 80) || seed?.label || slug.replace(/-/g, " ");
  const description = sanitizeString(input.description, 240) || seed?.description || "";
  const sortOrder =
    typeof input.sortOrder === "number" && Number.isFinite(input.sortOrder)
      ? Math.floor(input.sortOrder)
      : COPSCOPES_DEFAULT_CATEGORIES.findIndex((category) => category.slug === slug);
  const existing = db
    .prepare(
      `SELECT id
         FROM copscopes_source_categories
        WHERE workspace_id = ?
          AND channel_id = ?
          AND slug = ?
        LIMIT 1`
    )
    .get(input.workspaceId, input.channelId, slug) as { id: string } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE copscopes_source_categories
          SET label = ?,
              description = ?,
              updated_at = ?
        WHERE id = ?`
    ).run(label, description, stamp, existing.id);
    return existing.id;
  }
  const id = newId();
  db.prepare(
    `INSERT INTO copscopes_source_categories
      (id, workspace_id, channel_id, slug, label, description, status, sort_order, created_at, updated_at, exhausted_at)
      VALUES (?, ?, ?, ?, ?, ?, 'available', ?, ?, ?, NULL)`
  ).run(
    id,
    input.workspaceId,
    input.channelId,
    slug,
    label,
    description,
    sortOrder >= 0 ? sortOrder : 999,
    stamp,
    stamp
  );
  return id;
}

export function seedCopscopesDefaultCategories(input: { workspaceId: string; channelId: string }): void {
  COPSCOPES_DEFAULT_CATEGORIES.forEach((category, index) => {
    ensureCopscopesCategory({
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      slug: category.slug,
      label: category.label,
      description: category.description,
      sortOrder: index
    });
  });
}

export function importCopscopesSourcePool(input: {
  workspaceId: string;
  channelId: string;
  items: CopscopesSourcePoolImportItem[];
  dryRun?: boolean | null;
}): ImportCopscopesSourcePoolResult {
  const dryRun = Boolean(input.dryRun);
  const seen = new Set<string>();
  const validItems: Array<CopscopesSourcePoolImportItem & { canonicalUrl: string; shortcode: string; categorySlug: string }> = [];
  const invalid: Array<{ url: string; reason: string }> = [];
  let duplicates = 0;

  for (const item of input.items) {
    const canonical = canonicalizeInstagramReelUrl(item.url);
    if (!canonical) {
      invalid.push({ url: item.url, reason: "not_instagram_reel_url" });
      continue;
    }
    if (seen.has(canonical.canonicalUrl)) {
      duplicates += 1;
      continue;
    }
    seen.add(canonical.canonicalUrl);
    const classified = classifyCopscopesCategory(item);
    validItems.push({
      ...item,
      canonicalUrl: canonical.canonicalUrl,
      shortcode: canonical.shortcode,
      categorySlug: normalizeCopscopesCategorySlug(item.categorySlug ?? classified.slug),
      secondaryTags: [...new Set([...sanitizeTags(item.secondaryTags), ...classified.tags])]
    });
  }

  if (dryRun) {
    const db = getDb();
    let created = 0;
    let updated = 0;
    for (const item of validItems) {
      const existing = db
        .prepare(
          `SELECT id
             FROM copscopes_source_reels
            WHERE workspace_id = ?
              AND channel_id = ?
              AND canonical_url = ?
            LIMIT 1`
        )
        .get(input.workspaceId, input.channelId, item.canonicalUrl) as { id: string } | undefined;
      if (existing) {
        updated += 1;
      } else {
        created += 1;
      }
    }
    return {
      dryRun,
      created,
      updated,
      skipped: invalid.length,
      duplicates,
      invalid,
      categories: listCopscopesSourcePool({ workspaceId: input.workspaceId, channelId: input.channelId }).categories,
      reels: []
    };
  }

  runInTransaction(() => {
    seedCopscopesDefaultCategories(input);
    for (const item of validItems) {
      const categorySeed = getCategorySeed(item.categorySlug);
      const categoryId = ensureCopscopesCategory({
        workspaceId: input.workspaceId,
        channelId: input.channelId,
        slug: item.categorySlug,
        label: item.categoryLabel ?? categorySeed?.label,
        description: categorySeed?.description ?? null
      });
      const stamp = nowIso();
      const crop = detectCopscopesSourceCrop({
        crop: item.crop ?? null,
        cropConfidence: item.cropConfidence ?? null
      });
      const cropConfidence = normalizeScore(item.cropConfidence) ?? crop.confidence;
      const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
      const qualityScore = estimateQualityScore(item, item.categorySlug);
      const existing = getDb()
        .prepare(
          `SELECT id, status
             FROM copscopes_source_reels
            WHERE workspace_id = ?
              AND channel_id = ?
              AND canonical_url = ?
            LIMIT 1`
        )
        .get(input.workspaceId, input.channelId, item.canonicalUrl) as { id: string; status: string } | undefined;
      if (existing) {
        getDb()
          .prepare(
            `UPDATE copscopes_source_reels
                SET source_url = ?,
                    shortcode = ?,
                    title = ?,
                    caption = ?,
                    view_count = ?,
                    views_label = ?,
                    posted_at = ?,
                    category_id = ?,
                    category_slug = ?,
                    secondary_tags_json = ?,
                    quality_score = ?,
                    crop_confidence = ?,
                    crop_json = ?,
                    metadata_json = ?,
                    updated_at = ?
              WHERE id = ?`
          )
          .run(
            item.url,
            item.shortcode,
            sanitizeString(item.title, 240),
            sanitizeString(item.caption, 4000),
            typeof item.viewCount === "number" && Number.isFinite(item.viewCount) ? Math.max(0, Math.floor(item.viewCount)) : null,
            sanitizeString(item.viewsLabel, 40) || null,
            sanitizeString(item.postedAt, 40) || null,
            categoryId,
            item.categorySlug,
            JSON.stringify(item.secondaryTags),
            qualityScore,
            cropConfidence,
            JSON.stringify(crop),
            JSON.stringify(metadata),
            stamp,
            existing.id
          );
      } else {
        getDb()
          .prepare(
            `INSERT INTO copscopes_source_reels
              (id, workspace_id, channel_id, source_url, canonical_url, shortcode, title, caption, view_count,
               views_label, posted_at, category_id, category_slug, secondary_tags_json, quality_score,
               crop_confidence, crop_json, metadata_json, status, consumed_chat_id, consumed_stage2_run_id,
               consumed_stage3_job_id, last_error, imported_at, updated_at, consumed_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', NULL, NULL, NULL, NULL, ?, ?, NULL)`
          )
          .run(
            newId(),
            input.workspaceId,
            input.channelId,
            item.url,
            item.canonicalUrl,
            item.shortcode,
            sanitizeString(item.title, 240),
            sanitizeString(item.caption, 4000),
            typeof item.viewCount === "number" && Number.isFinite(item.viewCount) ? Math.max(0, Math.floor(item.viewCount)) : null,
            sanitizeString(item.viewsLabel, 40) || null,
            sanitizeString(item.postedAt, 40) || null,
            categoryId,
            item.categorySlug,
            JSON.stringify(item.secondaryTags),
            qualityScore,
            cropConfidence,
            JSON.stringify(crop),
            JSON.stringify(metadata),
            stamp,
            stamp
          );
      }
    }
  });

  const listed = listCopscopesSourcePool({ workspaceId: input.workspaceId, channelId: input.channelId });
  const importedCanonicals = new Set(validItems.map((item) => item.canonicalUrl));
  const importedReels = listed.reels.filter((reel) => importedCanonicals.has(reel.canonicalUrl));
  const existingCanonicals = new Set(importedReels.map((reel) => reel.canonicalUrl));
  return {
    dryRun,
    created: importedReels.filter((reel) => reel.importedAt === reel.updatedAt).length,
    updated: validItems.filter((item) => existingCanonicals.has(item.canonicalUrl)).length - importedReels.filter((reel) => reel.importedAt === reel.updatedAt).length,
    skipped: invalid.length,
    duplicates,
    invalid,
    categories: listed.categories,
    reels: importedReels
  };
}

export function listCopscopesSourcePool(input: {
  workspaceId: string;
  channelId: string;
  categorySlug?: string | null;
  status?: CopscopesSourceStatus | null;
  limit?: number | null;
}): { categories: CopscopesSourceCategory[]; reels: CopscopesSourceReel[] } {
  const db = getDb();
  const categoryRows = db
    .prepare(
      `SELECT category.*,
              SUM(CASE WHEN reel.status = 'available' THEN 1 ELSE 0 END) AS available_count,
              SUM(CASE WHEN reel.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_count,
              SUM(CASE WHEN reel.status = 'consumed' THEN 1 ELSE 0 END) AS consumed_count,
              SUM(CASE WHEN reel.status = 'needs_review' THEN 1 ELSE 0 END) AS needs_review_count,
              SUM(CASE WHEN reel.status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
              SUM(CASE WHEN reel.status = 'skipped' THEN 1 ELSE 0 END) AS skipped_count,
              COUNT(reel.id) AS total_count
         FROM copscopes_source_categories category
         LEFT JOIN copscopes_source_reels reel
           ON reel.category_id = category.id
        WHERE category.workspace_id = ?
          AND category.channel_id = ?
        GROUP BY category.id
        ORDER BY category.sort_order ASC, category.label ASC`
    )
    .all(input.workspaceId, input.channelId) as CategoryRow[];

  const filters = ["workspace_id = ?", "channel_id = ?"];
  const params: Array<string | number> = [input.workspaceId, input.channelId];
  if (input.categorySlug) {
    filters.push("category_slug = ?");
    params.push(normalizeCopscopesCategorySlug(input.categorySlug));
  }
  if (input.status) {
    filters.push("status = ?");
    params.push(normalizeSourceStatus(input.status));
  }
  const limit = typeof input.limit === "number" && Number.isFinite(input.limit)
    ? Math.max(1, Math.min(500, Math.floor(input.limit)))
    : 500;
  params.push(limit);
  const reelRows = db
    .prepare(
      `SELECT *
         FROM copscopes_source_reels
        WHERE ${filters.join(" AND ")}
        ORDER BY category_slug ASC,
                 COALESCE(quality_score, -1) DESC,
                 imported_at ASC
        LIMIT ?`
    )
    .all(...params) as ReelRow[];

  return {
    categories: categoryRows.map(mapCategory),
    reels: reelRows.map(mapReel)
  };
}

export function setActiveCopscopesCategory(input: {
  workspaceId: string;
  channelId: string;
  categorySlug: string;
}): CopscopesSourceCategory {
  const slug = normalizeCopscopesCategorySlug(input.categorySlug);
  runInTransaction(() => {
    const existing = getDb()
      .prepare(
        `SELECT id
           FROM copscopes_source_categories
          WHERE workspace_id = ?
            AND channel_id = ?
            AND slug = ?
          LIMIT 1`
      )
      .get(input.workspaceId, input.channelId, slug) as { id: string } | undefined;
    if (!existing) {
      throw new Error(`CopScopes category "${slug}" was not found.`);
    }
    const stamp = nowIso();
    getDb()
      .prepare(
        `UPDATE copscopes_source_categories
            SET status = CASE
              WHEN slug = ? THEN 'active'
              WHEN status = 'active' THEN 'available'
              ELSE status
            END,
            exhausted_at = CASE WHEN slug = ? THEN NULL ELSE exhausted_at END,
            updated_at = ?
          WHERE workspace_id = ?
            AND channel_id = ?`
      )
      .run(slug, slug, stamp, input.workspaceId, input.channelId);
  });
  const category = listCopscopesSourcePool({ workspaceId: input.workspaceId, channelId: input.channelId }).categories.find(
    (candidate) => candidate.slug === slug
  );
  if (!category) {
    throw new Error(`CopScopes category "${slug}" disappeared after activation.`);
  }
  return category;
}

function getActiveCategory(input: { workspaceId: string; channelId: string; categorySlug?: string | null }): CategoryRow | null {
  const db = getDb();
  if (input.categorySlug) {
    return (db
      .prepare(
        `SELECT *
           FROM copscopes_source_categories
          WHERE workspace_id = ?
            AND channel_id = ?
            AND slug = ?
          LIMIT 1`
      )
      .get(input.workspaceId, input.channelId, normalizeCopscopesCategorySlug(input.categorySlug)) as CategoryRow | undefined) ?? null;
  }
  return (db
    .prepare(
      `SELECT *
         FROM copscopes_source_categories
        WHERE workspace_id = ?
          AND channel_id = ?
          AND status = 'active'
        ORDER BY updated_at DESC
        LIMIT 1`
    )
    .get(input.workspaceId, input.channelId) as CategoryRow | undefined) ?? null;
}

export function selectCopscopesDailyCandidates(input: {
  workspaceId: string;
  channelId: string;
  categorySlug?: string | null;
  limit: number;
  markInProgress?: boolean | null;
}): {
  category: CopscopesSourceCategory | null;
  reels: CopscopesSourceReel[];
  exhausted: boolean;
} {
  const limit = Math.max(1, Math.min(10, Math.floor(input.limit)));
  const selected = runInTransaction(() => {
    const category = getActiveCategory(input);
    if (!category) {
      return { category: null, reels: [], exhausted: false };
    }
    const rows = getDb()
      .prepare(
        `SELECT *
           FROM copscopes_source_reels
          WHERE workspace_id = ?
            AND channel_id = ?
            AND category_slug = ?
            AND status = 'available'
          ORDER BY COALESCE(quality_score, -1) DESC,
                   imported_at ASC
          LIMIT ?`
      )
      .all(input.workspaceId, input.channelId, category.slug, limit) as ReelRow[];
    if (rows.length === 0) {
      const stamp = nowIso();
      getDb()
        .prepare(
          `UPDATE copscopes_source_categories
              SET status = 'exhausted',
                  exhausted_at = COALESCE(exhausted_at, ?),
                  updated_at = ?
            WHERE id = ?`
        )
        .run(stamp, stamp, category.id);
      return { category, reels: [], exhausted: true };
    }
    if (input.markInProgress) {
      const stamp = nowIso();
      for (const row of rows) {
        getDb()
          .prepare(
            `UPDATE copscopes_source_reels
                SET status = 'in_progress',
                    updated_at = ?,
                    last_error = NULL
              WHERE id = ?
                AND status = 'available'`
          )
          .run(stamp, row.id);
      }
    }
    return { category, reels: rows.map(mapReel), exhausted: false };
  });
  const category = selected.category
    ? listCopscopesSourcePool({ workspaceId: input.workspaceId, channelId: input.channelId }).categories.find(
        (candidate) => candidate.slug === selected.category?.slug
      ) ?? null
    : null;
  const reels = selected.reels.map((reel) => {
    if (!input.markInProgress) {
      return reel;
    }
    return { ...reel, status: "in_progress" as CopscopesSourceStatus };
  });
  return { category, reels, exhausted: selected.exhausted };
}

export function createCopscopesDailyRun(input: {
  workspaceId: string;
  channelId: string;
  categorySlug: string;
  categoryId?: string | null;
  status: CopscopesRunStatus;
  limit: number;
  attemptBudget: number;
  dryRun: boolean;
  selectedCount?: number | null;
  report?: Record<string, unknown> | null;
}): string {
  const id = newId();
  const stamp = nowIso();
  getDb()
    .prepare(
      `INSERT INTO copscopes_daily_runs
        (id, workspace_id, channel_id, category_id, category_slug, status, limit_count, attempt_budget,
         dry_run, selected_count, queued_count, reviewed_count, failed_count, report_json, created_at, updated_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, NULL)`
    )
    .run(
      id,
      input.workspaceId,
      input.channelId,
      input.categoryId ?? null,
      input.categorySlug,
      input.status,
      input.limit,
      input.attemptBudget,
      input.dryRun ? 1 : 0,
      input.selectedCount ?? 0,
      JSON.stringify(input.report ?? {}),
      stamp,
      stamp
    );
  return id;
}

export function recordCopscopesDailyRunItem(input: {
  runId: string;
  sourceReelId: string;
  status: string;
  chatId?: string | null;
  stage2RunId?: string | null;
  stage3JobId?: string | null;
  publicationId?: string | null;
  errorMessage?: string | null;
  result?: Record<string, unknown> | null;
}): void {
  const stamp = nowIso();
  getDb()
    .prepare(
      `INSERT INTO copscopes_daily_run_items
        (id, run_id, source_reel_id, status, chat_id, stage2_run_id, stage3_job_id,
         publication_id, error_message, result_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      newId(),
      input.runId,
      input.sourceReelId,
      input.status,
      input.chatId ?? null,
      input.stage2RunId ?? null,
      input.stage3JobId ?? null,
      input.publicationId ?? null,
      input.errorMessage ?? null,
      JSON.stringify(input.result ?? {}),
      stamp,
      stamp
    );
}

export function updateCopscopesDailyRunSummary(input: {
  runId: string;
  status: CopscopesRunStatus;
  queuedCount: number;
  reviewedCount: number;
  failedCount: number;
  report?: Record<string, unknown> | null;
}): void {
  const stamp = nowIso();
  getDb()
    .prepare(
      `UPDATE copscopes_daily_runs
          SET status = ?,
              queued_count = ?,
              reviewed_count = ?,
              failed_count = ?,
              report_json = ?,
              completed_at = ?,
              updated_at = ?
        WHERE id = ?`
    )
    .run(
      input.status,
      input.queuedCount,
      input.reviewedCount,
      input.failedCount,
      JSON.stringify(input.report ?? {}),
      stamp,
      stamp,
      input.runId
    );
}

export function markCopscopesSourceReel(input: {
  reelId: string;
  status: CopscopesSourceStatus;
  chatId?: string | null;
  stage2RunId?: string | null;
  stage3JobId?: string | null;
  error?: string | null;
}): CopscopesSourceReel | null {
  const stamp = nowIso();
  const consumedAt = input.status === "consumed" ? stamp : null;
  getDb()
    .prepare(
      `UPDATE copscopes_source_reels
          SET status = ?,
              consumed_chat_id = COALESCE(?, consumed_chat_id),
              consumed_stage2_run_id = COALESCE(?, consumed_stage2_run_id),
              consumed_stage3_job_id = COALESCE(?, consumed_stage3_job_id),
              last_error = ?,
              consumed_at = COALESCE(?, consumed_at),
              updated_at = ?
        WHERE id = ?`
    )
    .run(
      input.status,
      input.chatId ?? null,
      input.stage2RunId ?? null,
      input.stage3JobId ?? null,
      input.error ?? null,
      consumedAt,
      stamp,
      input.reelId
    );
  const row = getDb().prepare("SELECT * FROM copscopes_source_reels WHERE id = ? LIMIT 1").get(input.reelId) as
    | ReelRow
    | undefined;
  return row ? mapReel(row) : null;
}

export function resetCopscopesSourceReelForRetry(input: {
  workspaceId: string;
  channelId: string;
  reelId?: string | null;
  shortcode?: string | null;
  url?: string | null;
}): CopscopesSourceReel {
  const shortcode = sanitizeString(input.shortcode, 80);
  const canonicalUrl = input.url ? canonicalizeInstagramReelUrl(input.url)?.canonicalUrl ?? "" : "";
  const filters = ["workspace_id = ?", "channel_id = ?"];
  const params: string[] = [input.workspaceId, input.channelId];
  if (input.reelId) {
    filters.push("id = ?");
    params.push(input.reelId);
  } else if (shortcode) {
    filters.push("shortcode = ?");
    params.push(shortcode);
  } else if (canonicalUrl) {
    filters.push("canonical_url = ?");
    params.push(canonicalUrl);
  } else {
    throw new Error("reelId, shortcode, or url is required.");
  }

  const row = getDb()
    .prepare(`SELECT * FROM copscopes_source_reels WHERE ${filters.join(" AND ")} LIMIT 1`)
    .get(...params) as ReelRow | undefined;
  if (!row) {
    throw new Error("CopScopes source reel was not found.");
  }

  const stamp = nowIso();
  getDb()
    .prepare(
      `UPDATE copscopes_source_reels
          SET status = 'available',
              consumed_chat_id = NULL,
              consumed_stage2_run_id = NULL,
              consumed_stage3_job_id = NULL,
              last_error = NULL,
              consumed_at = NULL,
              updated_at = ?
        WHERE id = ?`
    )
    .run(stamp, row.id);
  const updated = getDb().prepare("SELECT * FROM copscopes_source_reels WHERE id = ? LIMIT 1").get(row.id) as
    | ReelRow
    | undefined;
  if (!updated) {
    throw new Error("CopScopes source reel disappeared during reset.");
  }
  return mapReel(updated);
}

export function exportCopscopesSourcePoolMarkdown(input: {
  categories: CopscopesSourceCategory[];
  reels: CopscopesSourceReel[];
}): string {
  const categoryRows = input.categories.map(
    (category) =>
      `| ${category.slug} | ${category.label} | ${category.status} | ${category.availableCount} | ${category.totalCount} |`
  );
  const reelRows = input.reels.map(
    (reel) =>
      `| ${reel.shortcode} | ${reel.categorySlug} | ${reel.status} | ${reel.viewsLabel ?? reel.viewCount ?? ""} | ${reel.qualityScore ?? ""} | ${reel.canonicalUrl} |`
  );
  return [
    "## CopScopes Categories",
    "",
    "| slug | label | status | available | total |",
    "| --- | --- | --- | ---: | ---: |",
    ...categoryRows,
    "",
    "## CopScopes Reels",
    "",
    "| shortcode | category | status | views | quality | url |",
    "| --- | --- | --- | ---: | ---: | --- |",
    ...reelRows
  ].join("\n");
}

export function exportCopscopesSourcePoolCsv(reels: CopscopesSourceReel[]): string {
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [
    [
      "shortcode",
      "canonical_url",
      "category_slug",
      "status",
      "views",
      "quality_score",
      "crop_confidence",
      "title"
    ].join(","),
    ...reels.map((reel) =>
      [
        escape(reel.shortcode),
        escape(reel.canonicalUrl),
        escape(reel.categorySlug),
        escape(reel.status),
        escape(reel.viewsLabel ?? reel.viewCount ?? ""),
        escape(reel.qualityScore ?? ""),
        escape(reel.cropConfidence ?? ""),
        escape(reel.title)
      ].join(",")
    )
  ].join("\n");
}
