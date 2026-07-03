import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchYouTubeVideoAnalyticsDiagnostics,
  hasYouTubeAnalyticsReadonlyScope,
  YOUTUBE_ANALYTICS_READONLY_SCOPE
} from "../lib/youtube-analytics";

test("YouTube analytics scope detector matches the required readonly scope exactly", () => {
  assert.equal(hasYouTubeAnalyticsReadonlyScope(["openid", "email"]), false);
  assert.equal(hasYouTubeAnalyticsReadonlyScope([YOUTUBE_ANALYTICS_READONLY_SCOPE]), true);
});

test("video analytics diagnostics queries Data API, summary metrics, and retention metrics", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requestedUrls.push(url);

    if (url.includes("youtube/v3/videos")) {
      return Response.json({
        items: [
          {
            id: "video-1",
            snippet: {
              title: "Starzy sample",
              publishedAt: "2026-07-03T07:00:00Z"
            },
            contentDetails: {
              duration: "PT41S"
            },
            status: {
              privacyStatus: "public"
            },
            statistics: {
              viewCount: "1200",
              likeCount: "90",
              commentCount: "7"
            }
          }
        ]
      });
    }

    if (url.includes("youtubeanalytics.googleapis.com/v2/reports")) {
      const parsed = new URL(url);
      if (parsed.searchParams.get("dimensions") === "elapsedVideoTimeRatio") {
        return Response.json({
          columnHeaders: [
            { name: "elapsedVideoTimeRatio", columnType: "DIMENSION", dataType: "FLOAT" },
            { name: "audienceWatchRatio", columnType: "METRIC", dataType: "FLOAT" },
            { name: "relativeRetentionPerformance", columnType: "METRIC", dataType: "FLOAT" },
            { name: "startedWatching", columnType: "METRIC", dataType: "INTEGER" },
            { name: "stoppedWatching", columnType: "METRIC", dataType: "INTEGER" },
            { name: "totalSegmentImpressions", columnType: "METRIC", dataType: "INTEGER" }
          ],
          rows: [
            [0.01, 1, 0.52, 20, 0, 20],
            [0.02, 0.98, 0.51, 0, 1, 21]
          ]
        });
      }
      return Response.json({
        columnHeaders: [
          { name: "views", columnType: "METRIC", dataType: "INTEGER" },
          { name: "engagedViews", columnType: "METRIC", dataType: "INTEGER" },
          { name: "estimatedMinutesWatched", columnType: "METRIC", dataType: "INTEGER" },
          { name: "averageViewDuration", columnType: "METRIC", dataType: "INTEGER" },
          { name: "averageViewPercentage", columnType: "METRIC", dataType: "FLOAT" },
          { name: "likes", columnType: "METRIC", dataType: "INTEGER" },
          { name: "comments", columnType: "METRIC", dataType: "INTEGER" },
          { name: "shares", columnType: "METRIC", dataType: "INTEGER" },
          { name: "subscribersGained", columnType: "METRIC", dataType: "INTEGER" },
          { name: "subscribersLost", columnType: "METRIC", dataType: "INTEGER" }
        ],
        rows: [[1200, 900, 610, 31, 76, 90, 7, 12, 5, 1]]
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  }) as typeof fetch;

  try {
    const diagnostics = await fetchYouTubeVideoAnalyticsDiagnostics({
      accessToken: "access-token",
      channelId: "UC123",
      videoId: "video-1",
      startDate: "2026-07-03",
      endDate: "2026-07-04"
    });

    assert.equal(diagnostics.dataApi.ok, true);
    assert.equal(diagnostics.analyticsSummary.ok, true);
    assert.equal(diagnostics.retention.ok, true);
    assert.equal(diagnostics.retention.pointCount, 2);
    assert.equal(diagnostics.coverage.enoughForCoreArgusBriefing, true);
    assert.equal(diagnostics.coverage.requiresStudioFallbackForShortsFeedMetrics, true);
    assert.equal(diagnostics.coverage.missingData.includes("shown_in_feed"), true);
    assert.equal(diagnostics.coverage.missingData.includes("stayed_to_watch_rate"), true);
    assert.equal(
      requestedUrls.some((url) => url.includes("ids=channel%3D%3DUC123") && url.includes("filters=video%3D%3Dvideo-1")),
      true
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
