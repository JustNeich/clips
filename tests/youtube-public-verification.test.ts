import assert from "node:assert/strict";
import test from "node:test";

import {
  reconcileYouTubePublicVerification,
  type ClipsPublicationPublicState,
  type YouTubePublicVerificationDependencies
} from "../lib/youtube-public-verification";

const PUBLICATION_ID = "publication-kings-001";
const VIDEO_ID = "AbCdEf12345";
const CHANNEL_ID = "UC1234567890123456789012";

function ownerState(overrides: Partial<ClipsPublicationPublicState> = {}): ClipsPublicationPublicState {
  return {
    publicationId: PUBLICATION_ID,
    status: "published",
    youtubeVideoId: VIDEO_ID,
    youtubeChannelId: CHANNEL_ID,
    lastError: null,
    ...overrides
  };
}

function rssFeed(input: {
  feedChannelId?: string;
  videoId?: string;
  entryChannelId?: string;
} = {}): string {
  const feedChannelId = input.feedChannelId ?? CHANNEL_ID;
  const videoId = input.videoId ?? VIDEO_ID;
  const entryChannelId = input.entryChannelId ?? feedChannelId;
  return `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
      <yt:channelId>${feedChannelId}</yt:channelId>
      <link rel="alternate" href="https://www.youtube.com/channel/${feedChannelId}" />
      <entry>
        <yt:videoId>${videoId}</yt:videoId>
        <yt:channelId>${entryChannelId}</yt:channelId>
      </entry>
    </feed>`;
}

function shortsPage(input: {
  videoId?: string;
  channelId?: string;
  status?: string;
  isPrivate?: boolean;
  streamCount?: number;
} = {}): string {
  const streamCount = input.streamCount ?? 1;
  const playerResponse = {
    playabilityStatus: {
      status: input.status ?? "OK"
    },
    streamingData: {
      formats: Array.from({ length: streamCount }, (_, index) => ({ itag: 18 + index }))
    },
    videoDetails: {
      videoId: input.videoId ?? VIDEO_ID,
      channelId: input.channelId ?? CHANNEL_ID,
      isPrivate: input.isPrivate ?? false
    }
  };
  return `<html><script>var ytInitialPlayerResponse = ${JSON.stringify(playerResponse)};</script></html>`;
}

function response(body: string, status = 200, contentType = "text/html"): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": contentType
    }
  });
}

function createDependencies(input: {
  states?: ClipsPublicationPublicState[];
  rssResponses?: Response[];
  shortsResponses?: Response[];
} = {}): YouTubePublicVerificationDependencies & {
  calls: string[];
  sleeps: number[];
} {
  const states = [...(input.states ?? [ownerState()])];
  const rssResponses = [...(input.rssResponses ?? [response(rssFeed(), 200, "application/atom+xml")])];
  const shortsResponses = [...(input.shortsResponses ?? [response(shortsPage())])];
  const calls: string[] = [];
  const sleeps: number[] = [];
  let nowMs = Date.parse("2026-07-10T10:00:00.000Z");

  return {
    calls,
    sleeps,
    now: () => new Date(nowMs),
    sleep: async (delayMs) => {
      sleeps.push(delayMs);
      nowMs += delayMs;
    },
    readClipsPublication: async (publicationId) => {
      calls.push(`clips:${publicationId}`);
      const state = states.shift() ?? states.at(-1);
      if (!state) {
        throw new Error("No Clips state fixture remains.");
      }
      return state;
    },
    fetch: async (url) => {
      calls.push(url);
      if (url.includes("feeds/videos.xml")) {
        const next = rssResponses.shift();
        if (!next) {
          throw new Error("No RSS response fixture remains.");
        }
        return next;
      }
      if (url.includes("/shorts/")) {
        const next = shortsResponses.shift();
        if (!next) {
          throw new Error("No Shorts response fixture remains.");
        }
        return next;
      }
      throw new Error(`Unexpected public verification URL: ${url}`);
    }
  };
}

const expected = {
  publicationId: PUBLICATION_ID,
  expectedVideoId: VIDEO_ID,
  expectedChannelId: CHANNEL_ID
};

test("public verification requires matching Clips state, channel RSS, and playable exact Shorts page", async () => {
  const dependencies = createDependencies();

  const result = await reconcileYouTubePublicVerification(expected, dependencies, {
    maxAttempts: 1
  });

  assert.equal(result.verified, true);
  assert.equal(result.outcome, "public_verified");
  assert.equal(result.reason, "PUBLIC_VERIFIED");
  assert.match(result.evidenceSha256, /^[a-f0-9]{64}$/);
  assert.match(result.attempts[0]?.evidenceSha256 ?? "", /^[a-f0-9]{64}$/);
  assert.match(result.attempts[0]?.clips.stateSha256 ?? "", /^[a-f0-9]{64}$/);
  assert.equal(result.attempts[0]?.rss?.matchingVideoFound, true);
  assert.equal(result.attempts[0]?.shortsPage?.playableStreamCount, 1);
  assert.deepEqual(dependencies.calls, [
    `clips:${PUBLICATION_ID}`,
    `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`,
    `https://www.youtube.com/shorts/${VIDEO_ID}`
  ]);
});

test("scheduled Clips state can pass only with matching RSS and exact playable page", async () => {
  const dependencies = createDependencies({
    states: [ownerState({ status: "scheduled" })]
  });

  const result = await reconcileYouTubePublicVerification(expected, dependencies, {
    maxAttempts: 1
  });

  assert.equal(result.verified, true);
  assert.equal(result.outcome, "public_verified");
  assert.equal(result.reason, "PUBLIC_VERIFIED");
  assert.equal(result.attempts[0]?.rss?.matchingVideoFound, true);
  assert.equal(result.attempts[0]?.shortsPage?.playabilityStatus, "OK");
});

test("scheduled but private video never passes merely because its slot time arrived", async () => {
  const dependencies = createDependencies({
    states: [ownerState({ status: "scheduled" })],
    shortsResponses: [
      response(shortsPage({ status: "LOGIN_REQUIRED", isPrivate: true, streamCount: 0 }))
    ]
  });

  const result = await reconcileYouTubePublicVerification(expected, dependencies, {
    maxAttempts: 1
  });

  assert.equal(result.verified, false);
  assert.equal(result.outcome, "retry_exhausted");
  assert.equal(result.reason, "SHORTS_NOT_PUBLIC_OR_PLAYABLE");
});

test("Clips lastError fails closed before public requests", async () => {
  const dependencies = createDependencies({
    states: [ownerState({ status: "scheduled", lastError: "youtube rejected metadata" })]
  });

  const result = await reconcileYouTubePublicVerification(expected, dependencies, {
    maxAttempts: 3
  });

  assert.equal(result.verified, false);
  assert.equal(result.outcome, "terminal_failure");
  assert.equal(result.reason, "CLIPS_LAST_ERROR");
  assert.deepEqual(dependencies.calls, [`clips:${PUBLICATION_ID}`]);
});

test("private or unplayable exact Shorts page fails closed", async () => {
  const dependencies = createDependencies({
    shortsResponses: [
      response(
        shortsPage({
          status: "LOGIN_REQUIRED",
          isPrivate: true,
          streamCount: 0
        })
      )
    ]
  });

  const result = await reconcileYouTubePublicVerification(expected, dependencies, {
    maxAttempts: 1
  });

  assert.equal(result.verified, false);
  assert.equal(result.outcome, "retry_exhausted");
  assert.equal(result.reason, "SHORTS_NOT_PUBLIC_OR_PLAYABLE");
  assert.equal(result.attempts[0]?.rss?.matchingVideoFound, true);
  assert.equal(result.attempts[0]?.shortsPage?.isPrivate, true);
  assert.equal(result.attempts[0]?.shortsPage?.playableStreamCount, 0);
});

test("RSS for a different stable channel is a terminal mismatch", async () => {
  const wrongChannelId = "UC9999999999999999999999";
  const dependencies = createDependencies({
    rssResponses: [
      response(
        rssFeed({
          feedChannelId: wrongChannelId,
          entryChannelId: wrongChannelId
        }),
        200,
        "application/atom+xml"
      )
    ]
  });

  const result = await reconcileYouTubePublicVerification(expected, dependencies, {
    maxAttempts: 3,
    initialRetryDelayMs: 0
  });

  assert.equal(result.verified, false);
  assert.equal(result.outcome, "terminal_failure");
  assert.equal(result.reason, "RSS_CHANNEL_ID_MISMATCH");
  assert.equal(result.attempts.length, 1);
  assert.deepEqual(result.retryDelaysMs, []);
});

test("real YouTube RSS root quirk is resolved through its canonical stable channel link", async () => {
  const rootWithoutUcPrefix = CHANNEL_ID.slice(2);
  const liveShape = `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
      <yt:channelId>${rootWithoutUcPrefix}</yt:channelId>
      <link rel="alternate" href="https://www.youtube.com/channel/${CHANNEL_ID}" />
      <entry>
        <yt:videoId>${VIDEO_ID}</yt:videoId>
        <yt:channelId>${CHANNEL_ID}</yt:channelId>
      </entry>
    </feed>`;
  const dependencies = createDependencies({
    rssResponses: [response(liveShape, 200, "text/xml")]
  });

  const result = await reconcileYouTubePublicVerification(expected, dependencies, {
    maxAttempts: 1
  });

  assert.equal(result.outcome, "public_verified");
  assert.equal(result.attempts[0]?.rss?.feedChannelId, CHANNEL_ID);
  assert.equal(result.attempts[0]?.rss?.matchingEntryChannelId, CHANNEL_ID);
});

test("exact Shorts page owned by another channel is a terminal mismatch", async () => {
  const wrongChannelId = "UC9999999999999999999999";
  const dependencies = createDependencies({
    shortsResponses: [response(shortsPage({ channelId: wrongChannelId }))]
  });

  const result = await reconcileYouTubePublicVerification(expected, dependencies, {
    maxAttempts: 3,
    initialRetryDelayMs: 0
  });

  assert.equal(result.verified, false);
  assert.equal(result.outcome, "terminal_failure");
  assert.equal(result.reason, "SHORTS_CHANNEL_ID_MISMATCH");
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0]?.rss?.matchingVideoFound, true);
});

test("RSS evidence alone cannot verify a video when the exact Shorts page is unavailable", async () => {
  const dependencies = createDependencies({
    shortsResponses: [response("Service unavailable", 503)]
  });

  const result = await reconcileYouTubePublicVerification(expected, dependencies, {
    maxAttempts: 1
  });

  assert.equal(result.verified, false);
  assert.equal(result.reason, "SHORTS_HTTP_ERROR");
  assert.equal(result.attempts[0]?.rss?.matchingVideoFound, true);
  assert.equal(result.attempts[0]?.shortsPage?.status, 503);
});

test("exact Shorts page evidence alone cannot verify a video missing from channel RSS", async () => {
  const dependencies = createDependencies({
    rssResponses: [
      response(
        rssFeed({
          videoId: "ZyXwVu98765"
        }),
        200,
        "application/atom+xml"
      )
    ]
  });

  const result = await reconcileYouTubePublicVerification(expected, dependencies, {
    maxAttempts: 1
  });

  assert.equal(result.verified, false);
  assert.equal(result.reason, "RSS_VIDEO_NOT_FOUND");
  assert.equal(result.attempts[0]?.shortsPage?.playabilityStatus, "OK");
  assert.equal(result.attempts[0]?.rss?.matchingVideoFound, false);
});

test("bounded reconcile retries transient 429 and 5xx responses, then verifies", async () => {
  const dependencies = createDependencies({
    states: [ownerState(), ownerState()],
    rssResponses: [
      response("Too many requests", 429),
      response(rssFeed(), 200, "application/atom+xml")
    ],
    shortsResponses: [response("Service unavailable", 503), response(shortsPage())]
  });

  const result = await reconcileYouTubePublicVerification(expected, dependencies, {
    maxAttempts: 3,
    initialRetryDelayMs: 25,
    maxRetryDelayMs: 100,
    maxElapsedMs: 1_000
  });

  assert.equal(result.verified, true);
  assert.equal(result.outcome, "public_verified");
  assert.equal(result.attempts.length, 2);
  assert.deepEqual(result.retryDelaysMs, [25]);
  assert.deepEqual(dependencies.sleeps, [25]);
  assert.equal(result.attempts[0]?.rss?.status, 429);
  assert.equal(result.attempts[0]?.shortsPage?.status, 503);
});

test("bounded reconcile stops after its elapsed-time budget", async () => {
  const dependencies = createDependencies({
    rssResponses: [response("Too many requests", 429)]
  });

  const result = await reconcileYouTubePublicVerification(expected, dependencies, {
    maxAttempts: 5,
    initialRetryDelayMs: 100,
    maxElapsedMs: 50
  });

  assert.equal(result.verified, false);
  assert.equal(result.outcome, "retry_exhausted");
  assert.equal(result.attempts.length, 1);
  assert.deepEqual(result.retryDelaysMs, []);
  assert.deepEqual(dependencies.sleeps, []);
});

test("exact Clips video mismatch is terminal and never reaches public endpoints", async () => {
  const dependencies = createDependencies({
    states: [ownerState({ youtubeVideoId: "WrongId9876" })]
  });

  const result = await reconcileYouTubePublicVerification(expected, dependencies, {
    maxAttempts: 3,
    initialRetryDelayMs: 0
  });

  assert.equal(result.verified, false);
  assert.equal(result.outcome, "terminal_failure");
  assert.equal(result.reason, "CLIPS_VIDEO_ID_MISMATCH");
  assert.equal(result.attempts.length, 1);
  assert.deepEqual(dependencies.calls, [`clips:${PUBLICATION_ID}`]);
});
