const YOUTUBE_ANALYTICS_REPORTS_URL = "https://youtubeanalytics.googleapis.com/v2/reports";
const YOUTUBE_DATA_API_URL = "https://www.googleapis.com/youtube/v3";

export const YOUTUBE_ANALYTICS_READONLY_SCOPE = "https://www.googleapis.com/auth/yt-analytics.readonly";

export const ARGUS_ANALYTICS_SUMMARY_METRICS = [
  "views",
  "engagedViews",
  "estimatedMinutesWatched",
  "averageViewDuration",
  "averageViewPercentage",
  "likes",
  "comments",
  "shares",
  "subscribersGained",
  "subscribersLost"
] as const;

export const ARGUS_RETENTION_METRICS = [
  "audienceWatchRatio",
  "relativeRetentionPerformance",
  "startedWatching",
  "stoppedWatching",
  "totalSegmentImpressions"
] as const;

export const ARGUS_STUDIO_ONLY_METRICS = [
  "shown_in_feed",
  "stayed_to_watch_rate",
  "swiped_away_rate",
  "shorts_feed_ctr"
] as const;

export type YouTubeAnalyticsErrorKind = "auth" | "quota" | "request" | "server";

export class YouTubeAnalyticsError extends Error {
  readonly status: number;
  readonly kind: YouTubeAnalyticsErrorKind;

  constructor(message: string, options: { status: number; kind: YouTubeAnalyticsErrorKind }) {
    super(message);
    this.name = "YouTubeAnalyticsError";
    this.status = options.status;
    this.kind = options.kind;
  }
}

export type YouTubeAnalyticsColumnHeader = {
  name: string;
  columnType: string;
  dataType: string;
};

export type YouTubeAnalyticsReport = {
  kind?: string;
  columnHeaders?: YouTubeAnalyticsColumnHeader[];
  rows?: Array<Array<string | number | null>>;
};

export type YouTubeAnalyticsTable = {
  columnHeaders: YouTubeAnalyticsColumnHeader[];
  rows: Array<Record<string, string | number | null>>;
  raw: YouTubeAnalyticsReport;
};

export type YouTubeVideoDataSnapshot = {
  videoId: string;
  title: string | null;
  publishedAt: string | null;
  duration: string | null;
  privacyStatus: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  raw: Record<string, unknown> | null;
};

export type ArgusMetricCoverageItem = {
  metric: string;
  status: "available" | "missing_scope" | "no_data" | "studio_only" | "request_failed";
  source: "youtube_data_api" | "youtube_analytics_api" | "youtube_studio";
  value?: string | number | null;
  note?: string;
};

export type YouTubeVideoAnalyticsDiagnostics = {
  videoId: string;
  ids: string;
  startDate: string;
  endDate: string;
  dataApi: {
    ok: boolean;
    video: YouTubeVideoDataSnapshot | null;
    error: string | null;
  };
  analyticsSummary: {
    ok: boolean;
    rows: Array<Record<string, string | number | null>>;
    error: string | null;
  };
  retention: {
    ok: boolean;
    pointCount: number;
    sample: Array<Record<string, string | number | null>>;
    error: string | null;
  };
  coverage: {
    enoughForCoreArgusBriefing: boolean;
    requiresStudioFallbackForShortsFeedMetrics: boolean;
    items: ArgusMetricCoverageItem[];
    missingData: string[];
  };
};

type QueryYouTubeAnalyticsInput = {
  accessToken: string;
  ids: string;
  startDate: string;
  endDate: string;
  metrics: readonly string[];
  dimensions?: string;
  filters?: string;
  sort?: string;
  maxResults?: number;
};

type FetchVideoDiagnosticsInput = {
  accessToken: string;
  channelId: string | null;
  videoId: string;
  startDate: string;
  endDate: string;
};

function readGoogleApiError(payload: Record<string, unknown> | null): string | null {
  const error = payload?.error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message.trim();
    }
  }
  if (typeof payload?.error_description === "string" && payload.error_description.trim()) {
    return payload.error_description.trim();
  }
  return null;
}

function classifyErrorStatus(status: number): YouTubeAnalyticsErrorKind {
  if (status === 401 || status === 403) {
    return "auth";
  }
  if (status === 429) {
    return "quota";
  }
  if (status >= 500) {
    return "server";
  }
  return "request";
}

async function authorizedJson<T>(input: {
  accessToken: string;
  url: string;
  serviceName: string;
}): Promise<T> {
  const response = await fetch(input.url, {
    headers: {
      Authorization: `Bearer ${input.accessToken}`
    }
  });
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new YouTubeAnalyticsError(
      readGoogleApiError(payload) ?? `${input.serviceName} request failed with status ${response.status}.`,
      {
        status: response.status,
        kind: classifyErrorStatus(response.status)
      }
    );
  }
  return (payload ?? {}) as T;
}

function reportToTable(report: YouTubeAnalyticsReport): YouTubeAnalyticsTable {
  const columnHeaders = report.columnHeaders ?? [];
  const rows = (report.rows ?? []).map((row) => {
    const output: Record<string, string | number | null> = {};
    columnHeaders.forEach((header, index) => {
      output[header.name] = row[index] ?? null;
    });
    return output;
  });
  return { columnHeaders, rows, raw: report };
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstRowValue(rows: Array<Record<string, string | number | null>>, key: string): string | number | null {
  return rows[0]?.[key] ?? null;
}

function buildIds(channelId: string | null): string {
  return channelId?.trim() ? `channel==${channelId.trim()}` : "channel==MINE";
}

function buildCoverage(input: {
  hasAnalyticsRows: boolean;
  analyticsRows: Array<Record<string, string | number | null>>;
  hasRetentionRows: boolean;
  video: YouTubeVideoDataSnapshot | null;
  analyticsError: string | null;
  retentionError: string | null;
  dataApiError: string | null;
}): YouTubeVideoAnalyticsDiagnostics["coverage"] {
  const items: ArgusMetricCoverageItem[] = [];
  const missingData: string[] = [];

  const addDataMetric = (metric: string, value: string | number | null | undefined) => {
    const available = value !== null && value !== undefined;
    if (!available) {
      missingData.push(metric);
    }
    items.push({
      metric,
      source: "youtube_data_api",
      status: available ? "available" : input.dataApiError ? "request_failed" : "no_data",
      value: value ?? null,
      note: available ? undefined : input.dataApiError ?? undefined
    });
  };

  addDataMetric("published_at", input.video?.publishedAt);
  addDataMetric("duration", input.video?.duration);
  addDataMetric("data_api_view_count", input.video?.viewCount);
  addDataMetric("data_api_like_count", input.video?.likeCount);
  addDataMetric("data_api_comment_count", input.video?.commentCount);

  for (const metric of ARGUS_ANALYTICS_SUMMARY_METRICS) {
    const value = firstRowValue(input.analyticsRows, metric);
    const available = input.hasAnalyticsRows && value !== null && value !== undefined;
    if (!available) {
      missingData.push(metric);
    }
    items.push({
      metric,
      source: "youtube_analytics_api",
      status: available ? "available" : input.analyticsError ? "request_failed" : "no_data",
      value: value ?? null,
      note: available ? undefined : input.analyticsError ?? undefined
    });
  }

  for (const metric of ARGUS_RETENTION_METRICS) {
    const available = input.hasRetentionRows;
    if (!available) {
      missingData.push(metric);
    }
    items.push({
      metric,
      source: "youtube_analytics_api",
      status: available ? "available" : input.retentionError ? "request_failed" : "no_data",
      note: available ? "retention curve returned at least one elapsedVideoTimeRatio row" : input.retentionError ?? undefined
    });
  }

  for (const metric of ARGUS_STUDIO_ONLY_METRICS) {
    missingData.push(metric);
    items.push({
      metric,
      source: "youtube_studio",
      status: "studio_only",
      note: "Not verified as available in the current YouTube Analytics/Data API contract; keep Studio/export fallback."
    });
  }

  return {
    enoughForCoreArgusBriefing:
      !input.dataApiError &&
      input.hasAnalyticsRows &&
      numericValue(firstRowValue(input.analyticsRows, "views")) !== null &&
      numericValue(firstRowValue(input.analyticsRows, "averageViewDuration")) !== null &&
      numericValue(firstRowValue(input.analyticsRows, "averageViewPercentage")) !== null,
    requiresStudioFallbackForShortsFeedMetrics: true,
    items,
    missingData: Array.from(new Set(missingData))
  };
}

export function hasYouTubeAnalyticsReadonlyScope(scopes: readonly string[] | null | undefined): boolean {
  return Boolean(scopes?.includes(YOUTUBE_ANALYTICS_READONLY_SCOPE));
}

export async function queryYouTubeAnalyticsReport(
  input: QueryYouTubeAnalyticsInput
): Promise<YouTubeAnalyticsTable> {
  const params = new URLSearchParams({
    ids: input.ids,
    startDate: input.startDate,
    endDate: input.endDate,
    metrics: input.metrics.join(",")
  });
  if (input.dimensions) {
    params.set("dimensions", input.dimensions);
  }
  if (input.filters) {
    params.set("filters", input.filters);
  }
  if (input.sort) {
    params.set("sort", input.sort);
  }
  if (input.maxResults) {
    params.set("maxResults", String(input.maxResults));
  }

  return reportToTable(
    await authorizedJson<YouTubeAnalyticsReport>({
      accessToken: input.accessToken,
      url: `${YOUTUBE_ANALYTICS_REPORTS_URL}?${params.toString()}`,
      serviceName: "YouTube Analytics"
    })
  );
}

export async function fetchYouTubeVideoData(input: {
  accessToken: string;
  videoId: string;
}): Promise<YouTubeVideoDataSnapshot | null> {
  const params = new URLSearchParams({
    part: "snippet,contentDetails,statistics,status",
    id: input.videoId
  });
  const payload = await authorizedJson<{ items?: Array<Record<string, unknown>> }>({
    accessToken: input.accessToken,
    url: `${YOUTUBE_DATA_API_URL}/videos?${params.toString()}`,
    serviceName: "YouTube Data API"
  });
  const item = payload.items?.[0];
  if (!item) {
    return null;
  }
  const snippet = (item.snippet ?? {}) as Record<string, unknown>;
  const contentDetails = (item.contentDetails ?? {}) as Record<string, unknown>;
  const status = (item.status ?? {}) as Record<string, unknown>;
  const statistics = (item.statistics ?? {}) as Record<string, unknown>;
  return {
    videoId: String(item.id ?? input.videoId),
    title: typeof snippet.title === "string" ? snippet.title : null,
    publishedAt: typeof snippet.publishedAt === "string" ? snippet.publishedAt : null,
    duration: typeof contentDetails.duration === "string" ? contentDetails.duration : null,
    privacyStatus: typeof status.privacyStatus === "string" ? status.privacyStatus : null,
    viewCount: numericValue(statistics.viewCount),
    likeCount: numericValue(statistics.likeCount),
    commentCount: numericValue(statistics.commentCount),
    raw: item
  };
}

export async function fetchYouTubeVideoAnalyticsDiagnostics(
  input: FetchVideoDiagnosticsInput
): Promise<YouTubeVideoAnalyticsDiagnostics> {
  const ids = buildIds(input.channelId);
  const filters = `video==${input.videoId}`;

  let video: YouTubeVideoDataSnapshot | null = null;
  let dataApiError: string | null = null;
  try {
    video = await fetchYouTubeVideoData({
      accessToken: input.accessToken,
      videoId: input.videoId
    });
  } catch (error) {
    dataApiError = error instanceof Error ? error.message : "YouTube Data API request failed.";
  }

  let analyticsRows: Array<Record<string, string | number | null>> = [];
  let analyticsError: string | null = null;
  try {
    analyticsRows = (
      await queryYouTubeAnalyticsReport({
        accessToken: input.accessToken,
        ids,
        startDate: input.startDate,
        endDate: input.endDate,
        metrics: ARGUS_ANALYTICS_SUMMARY_METRICS,
        filters
      })
    ).rows;
  } catch (error) {
    analyticsError = error instanceof Error ? error.message : "YouTube Analytics summary request failed.";
  }

  let retentionRows: Array<Record<string, string | number | null>> = [];
  let retentionError: string | null = null;
  try {
    retentionRows = (
      await queryYouTubeAnalyticsReport({
        accessToken: input.accessToken,
        ids,
        startDate: input.startDate,
        endDate: input.endDate,
        metrics: ARGUS_RETENTION_METRICS,
        dimensions: "elapsedVideoTimeRatio",
        filters,
        sort: "elapsedVideoTimeRatio",
        maxResults: 100
      })
    ).rows;
  } catch (error) {
    retentionError = error instanceof Error ? error.message : "YouTube Analytics retention request failed.";
  }

  const coverage = buildCoverage({
    hasAnalyticsRows: analyticsRows.length > 0,
    analyticsRows,
    hasRetentionRows: retentionRows.length > 0,
    video,
    analyticsError,
    retentionError,
    dataApiError
  });

  return {
    videoId: input.videoId,
    ids,
    startDate: input.startDate,
    endDate: input.endDate,
    dataApi: {
      ok: Boolean(video && !dataApiError),
      video,
      error: dataApiError
    },
    analyticsSummary: {
      ok: !analyticsError && analyticsRows.length > 0,
      rows: analyticsRows,
      error: analyticsError
    },
    retention: {
      ok: !retentionError && retentionRows.length > 0,
      pointCount: retentionRows.length,
      sample: retentionRows.slice(0, 5),
      error: retentionError
    },
    coverage
  };
}
