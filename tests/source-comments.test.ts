import assert from "node:assert/strict";
import test from "node:test";
import { fetchCommentsForUrl } from "../lib/source-comments";
import {
  extractYouTubeVideoIdFromUrl,
  fetchYouTubeCommentsPayload,
  mapYouTubeDataApiError,
  YouTubeCommentsApiError
} from "../lib/youtube-comments";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function makePayload(label: string) {
  return {
    title: `${label} title`,
    totalComments: 1,
    topComments: [
      {
        id: `${label}-1`,
        author: `${label} author`,
        text: `${label} text`,
        likes: 10,
        postedAt: "2026-03-20T10:00:00.000Z"
      }
    ],
    allComments: [
      {
        id: `${label}-1`,
        author: `${label} author`,
        text: `${label} text`,
        likes: 10,
        postedAt: "2026-03-20T10:00:00.000Z"
      }
    ]
  };
}

test("extractYouTubeVideoIdFromUrl supports watch, shorts, and short links", () => {
  assert.equal(
    extractYouTubeVideoIdFromUrl("https://www.youtube.com/watch?v=abc123XYZ89"),
    "abc123XYZ89"
  );
  assert.equal(
    extractYouTubeVideoIdFromUrl("https://www.youtube.com/shorts/abc123XYZ89?feature=share"),
    "abc123XYZ89"
  );
  assert.equal(
    extractYouTubeVideoIdFromUrl("https://youtu.be/abc123XYZ89?t=7"),
    "abc123XYZ89"
  );
});

test("fetchYouTubeCommentsPayload normalizes official API results into CommentsPayload", async () => {
  const seenUrls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    seenUrls.push(url);
    if (url.includes("/commentThreads?")) {
      return jsonResponse({
        items: [
          {
            id: "thread-1",
            snippet: {
              topLevelComment: {
                id: "comment-1",
                snippet: {
                  authorDisplayName: "Viewer One",
                  textOriginal: "This payoff is wild",
                  likeCount: 87,
                  publishedAt: "2026-03-20T10:00:00Z"
                }
              }
            }
          },
          {
            id: "thread-2",
            snippet: {
              topLevelComment: {
                id: "comment-2",
                snippet: {
                  authorDisplayName: "Viewer Two",
                  textDisplay: "The transition sells it",
                  likeCount: 42,
                  publishedAt: "2026-03-20T09:00:00Z"
                }
              }
            }
          }
        ]
      });
    }
    if (url.includes("/videos?")) {
      return jsonResponse({
        items: [
          {
            id: "abc123XYZ89",
            snippet: {
              title: "Public Shorts clip"
            }
          }
        ]
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const payload = await fetchYouTubeCommentsPayload({
    rawUrl: "https://www.youtube.com/watch?v=abc123XYZ89",
    apiKey: "server-key",
    fetchImpl
  });

  assert.equal(payload.title, "Public Shorts clip");
  assert.equal(payload.totalComments, 2);
  assert.equal(payload.topComments.length, 2);
  assert.deepEqual(
    payload.allComments.map((item) => ({
      id: item.id,
      author: item.author,
      text: item.text,
      likes: item.likes
    })),
    [
      {
        id: "comment-1",
        author: "Viewer One",
        text: "This payoff is wild",
        likes: 87
      },
      {
        id: "comment-2",
        author: "Viewer Two",
        text: "The transition sells it",
        likes: 42
      }
    ]
  );
  assert.ok(seenUrls.some((url) => url.includes("/commentThreads?")));
  assert.ok(seenUrls.some((url) => url.includes("/videos?")));
});

test("fetchYouTubeCommentsPayload reuses a short-lived cache by videoId", async () => {
  let calls = 0;
  const videoId = "cache987XYZ12";
  const fetchImpl: typeof fetch = async (input) => {
    calls += 1;
    const url = String(input);
    if (url.includes("/commentThreads?")) {
      return jsonResponse({
        items: [
          {
            id: "thread-1",
            snippet: {
              topLevelComment: {
                id: "comment-1",
                snippet: {
                  authorDisplayName: "Viewer One",
                  textOriginal: "Cached comment",
                  likeCount: 10,
                  publishedAt: "2026-03-20T10:00:00Z"
                }
              }
            }
          }
        ]
      });
    }
    if (url.includes("/videos?")) {
      return jsonResponse({
        items: [
          {
            id: videoId,
            snippet: {
              title: "Cached video"
            }
          }
        ]
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const now = () => 1_710_000_000_000;
  await fetchYouTubeCommentsPayload({
    rawUrl: `https://www.youtube.com/watch?v=${videoId}`,
    apiKey: "server-key",
    fetchImpl,
    nowMs: now
  });
  await fetchYouTubeCommentsPayload({
    rawUrl: `https://www.youtube.com/watch?v=${videoId}`,
    apiKey: "server-key",
    fetchImpl,
    nowMs: now
  });

  assert.equal(calls, 2);
});

test("YouTube URLs use the YouTube Data API path as primary", async () => {
  const calls: string[] = [];
  const resolution = await fetchCommentsForUrl("https://www.youtube.com/watch?v=abc123XYZ89", {
    youtubeApiProvider: async () => {
      calls.push("youtube");
      return makePayload("youtube");
    },
    ytDlpProvider: async () => {
      calls.push("ytdlp");
      return makePayload("ytdlp");
    }
  });

  assert.equal(resolution.provider, "youtubeDataApi");
  assert.equal(resolution.fallbackUsed, false);
  assert.equal(resolution.payload?.title, "youtube title");
  assert.deepEqual(calls, ["youtube"]);
});

test("YouTube provider supports public videos from arbitrary channels because it only needs videoId", async () => {
  const payload = await fetchCommentsForUrl("https://www.youtube.com/shorts/abc123XYZ89", {
    youtubeApiProvider: async ({ rawUrl }) => {
      assert.equal(rawUrl, "https://www.youtube.com/watch?v=abc123XYZ89");
      return makePayload("public");
    },
    ytDlpProvider: async () => {
      throw new Error("yt-dlp should not be used");
    }
  });

  assert.equal(payload.provider, "youtubeDataApi");
  assert.equal(payload.payload?.title, "public title");
});

test("fetchCommentsForUrl falls back to yt-dlp when the YouTube Data API fails transiently", async () => {
  const resolution = await fetchCommentsForUrl("https://www.youtube.com/watch?v=abc123XYZ89", {
    youtubeApiProvider: async () => {
      throw new YouTubeCommentsApiError({
        code: "quota_exceeded",
        message: "API quota exceeded",
        retryable: true,
        status: 403
      });
    },
    ytDlpProvider: async () => makePayload("fallback")
  });

  assert.equal(resolution.provider, "ytDlp");
  assert.equal(resolution.fallbackUsed, true);
  assert.equal(resolution.payload?.title, "fallback title");
  assert.equal(resolution.error, null);
});

test("fetchCommentsForUrl does not fall back when comments are disabled", async () => {
  let ytDlpCalled = false;
  const resolution = await fetchCommentsForUrl("https://www.youtube.com/watch?v=abc123XYZ89", {
    youtubeApiProvider: async () => {
      throw new YouTubeCommentsApiError({
        code: "comments_disabled",
        message: "Комментарии отключены для этого YouTube-видео.",
        retryable: false,
        status: 403
      });
    },
    ytDlpProvider: async () => {
      ytDlpCalled = true;
      return makePayload("fallback");
    }
  });

  assert.equal(resolution.payload, null);
  assert.equal(resolution.provider, null);
  assert.equal(resolution.fallbackUsed, false);
  assert.equal(resolution.error, "Комментарии отключены для этого YouTube-видео.");
  assert.equal(ytDlpCalled, false);
});

test("fetchCommentsForUrl returns a clean degraded error when both YouTube paths fail", async () => {
  const resolution = await fetchCommentsForUrl("https://www.youtube.com/watch?v=abc123XYZ89", {
    youtubeApiProvider: async () => {
      throw new YouTubeCommentsApiError({
        code: "config_missing",
        message: "YOUTUBE_DATA_API_KEY не задан на сервере.",
        retryable: true
      });
    },
    ytDlpProvider: async () => {
      throw new Error("YouTube отклонил yt-dlp fallback.");
    }
  });

  assert.equal(resolution.payload, null);
  assert.equal(resolution.provider, null);
  assert.equal(resolution.fallbackUsed, true);
  assert.match(
    resolution.error ?? "",
    /YOUTUBE_DATA_API_KEY.*yt-dlp/i
  );
});

test("non-YouTube URLs preserve the existing yt-dlp comments path", async () => {
  let youtubeCalled = false;
  const resolution = await fetchCommentsForUrl("https://www.instagram.com/reel/abc123/", {
    youtubeApiProvider: async () => {
      youtubeCalled = true;
      return makePayload("youtube");
    },
    ytDlpProvider: async () => makePayload("instagram")
  });

  assert.equal(resolution.provider, "ytDlp");
  assert.equal(resolution.fallbackUsed, false);
  assert.equal(resolution.payload?.title, "instagram title");
  assert.equal(youtubeCalled, false);
});

test("uploaded mp4 sources degrade gracefully without comments", async () => {
  const resolution = await fetchCommentsForUrl("upload://abc123/final-cut.mp4");
  assert.equal(resolution.payload, null);
  assert.equal(resolution.provider, null);
  assert.equal(resolution.fallbackUsed, false);
  assert.equal(resolution.status, "unavailable");
  assert.equal(resolution.error, "Комментарии для загруженного mp4 недоступны.");
});

test("fetchYouTubeCommentsPayload surfaces missing server config clearly", async () => {
  await assert.rejects(
    () =>
      fetchYouTubeCommentsPayload({
        rawUrl: "https://www.youtube.com/watch?v=abc123XYZ89",
        apiKey: null,
        fetchImpl: async () => {
          throw new Error("fetch should not run without key");
        }
      }),
    /YOUTUBE_DATA_API_KEY/
  );
});

test("mapYouTubeDataApiError keeps important API failure modes distinct", () => {
  assert.equal(
    mapYouTubeDataApiError(403, {
      error: {
        message: "Comments disabled",
        errors: [{ reason: "commentsDisabled" }]
      }
    }).code,
    "comments_disabled"
  );

  assert.equal(
    mapYouTubeDataApiError(403, {
      error: {
        message: "Quota exceeded",
        errors: [{ reason: "quotaExceeded" }]
      }
    }).code,
    "quota_exceeded"
  );
});
