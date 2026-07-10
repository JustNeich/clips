import { createHash } from "node:crypto";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_INITIAL_RETRY_DELAY_MS = 1_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 15_000;
const DEFAULT_MAX_ELAPSED_MS = 5 * 60_000;

const OWNER_READY_STATES = new Set(["scheduled", "published", "public_verified"]);
const OWNER_TERMINAL_STATES = new Set([
  "canceled",
  "failed",
  "policy_blocked",
  "quarantined",
  "replaced"
]);

export type ClipsPublicationPublicState = {
  publicationId: string;
  status: string;
  youtubeVideoId: string | null;
  youtubeChannelId: string | null;
  lastError?: string | null;
};

export type YouTubePublicVerificationInput = {
  publicationId: string;
  expectedVideoId: string;
  expectedChannelId: string;
};

export type YouTubePublicVerificationReason =
  | "PUBLIC_VERIFIED"
  | "CLIPS_READ_ERROR"
  | "CLIPS_PUBLICATION_ID_MISMATCH"
  | "CLIPS_VIDEO_ID_MISMATCH"
  | "CLIPS_CHANNEL_ID_MISMATCH"
  | "CLIPS_LAST_ERROR"
  | "CLIPS_TERMINAL_STATE"
  | "CLIPS_NOT_PUBLISHED"
  | "RSS_FETCH_ERROR"
  | "RSS_HTTP_ERROR"
  | "RSS_FEED_UNREADABLE"
  | "RSS_CHANNEL_ID_MISMATCH"
  | "RSS_ENTRY_CHANNEL_ID_MISMATCH"
  | "RSS_VIDEO_NOT_FOUND"
  | "SHORTS_FETCH_ERROR"
  | "SHORTS_HTTP_ERROR"
  | "SHORTS_PAGE_UNREADABLE"
  | "SHORTS_VIDEO_ID_MISMATCH"
  | "SHORTS_CHANNEL_ID_MISMATCH"
  | "SHORTS_NOT_PUBLIC_OR_PLAYABLE";

export type YouTubePublicVerificationOutcome =
  | "public_verified"
  | "retry_exhausted"
  | "terminal_failure";

type FailureDisposition = "retryable" | "terminal";

export type VerificationHttpEvidence = {
  requestedUrl: string;
  finalUrl: string | null;
  status: number | null;
  contentType: string | null;
  bodySha256: string | null;
  error: string | null;
};

export type VerificationRssEvidence = VerificationHttpEvidence & {
  feedChannelId: string | null;
  matchingVideoFound: boolean;
  matchingEntryChannelId: string | null;
};

export type VerificationShortsEvidence = VerificationHttpEvidence & {
  playerResponseFound: boolean;
  videoId: string | null;
  channelId: string | null;
  playabilityStatus: string | null;
  isPrivate: boolean | null;
  playableStreamCount: number;
};

export type YouTubePublicVerificationAttemptEvidence = {
  schemaVersion: 1;
  attempt: number;
  checkedAt: string;
  expected: YouTubePublicVerificationInput;
  clips: {
    state: ClipsPublicationPublicState | null;
    stateSha256: string | null;
    error: string | null;
  };
  rss: VerificationRssEvidence | null;
  shortsPage: VerificationShortsEvidence | null;
  verdict: {
    verified: boolean;
    disposition: FailureDisposition | null;
    reason: YouTubePublicVerificationReason;
  };
  evidenceSha256: string;
};

export type YouTubePublicVerificationResult = {
  verified: boolean;
  outcome: YouTubePublicVerificationOutcome;
  reason: YouTubePublicVerificationReason;
  attempts: YouTubePublicVerificationAttemptEvidence[];
  retryDelaysMs: number[];
  evidenceSha256: string;
};

export type YouTubePublicVerificationDependencies = {
  readClipsPublication: (publicationId: string) => Promise<ClipsPublicationPublicState>;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  now?: () => Date;
  sleep?: (delayMs: number) => Promise<void>;
};

export type YouTubePublicVerificationPolicy = {
  maxAttempts?: number;
  initialRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  maxElapsedMs?: number;
};

type AttemptVerdict = {
  verified: boolean;
  disposition: FailureDisposition | null;
  reason: YouTubePublicVerificationReason;
};

type HttpSnapshot = VerificationHttpEvidence & {
  ok: boolean;
  body: string | null;
};

type RssCheck = {
  evidence: VerificationRssEvidence;
  verdict: AttemptVerdict;
};

type ShortsCheck = {
  evidence: VerificationShortsEvidence;
  verdict: AttemptVerdict;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}

function sha256(value: unknown): string {
  const serialized = typeof value === "string" ? value : JSON.stringify(canonicalize(value));
  return createHash("sha256").update(serialized).digest("hex");
}

function normalizeError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, 500);
  }
  return String(error || "Unknown error").slice(0, 500);
}

function assertSafeIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(normalized)) {
    throw new Error(`${label} must be a stable YouTube identifier.`);
  }
  return normalized;
}

function normalizeInput(input: YouTubePublicVerificationInput): YouTubePublicVerificationInput {
  const publicationId = input.publicationId.trim();
  if (!publicationId) {
    throw new Error("publicationId is required.");
  }
  return {
    publicationId,
    expectedVideoId: assertSafeIdentifier(input.expectedVideoId, "expectedVideoId"),
    expectedChannelId: assertSafeIdentifier(input.expectedChannelId, "expectedChannelId")
  };
}

function asBoundedInteger(value: number | undefined, fallback: number, label: string, maximum: number): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new Error(`${label} must be an integer between 1 and ${maximum}.`);
  }
  return resolved;
}

function asBoundedDuration(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < 0 || resolved > 30 * 60_000) {
    throw new Error(`${label} must be between 0 and 1800000 milliseconds.`);
  }
  return resolved;
}

function terminal(reason: YouTubePublicVerificationReason): AttemptVerdict {
  return { verified: false, disposition: "terminal", reason };
}

function retryable(reason: YouTubePublicVerificationReason): AttemptVerdict {
  return { verified: false, disposition: "retryable", reason };
}

function success(): AttemptVerdict {
  return { verified: true, disposition: null, reason: "PUBLIC_VERIFIED" };
}

function withAttemptHash(
  evidence: Omit<YouTubePublicVerificationAttemptEvidence, "evidenceSha256">
): YouTubePublicVerificationAttemptEvidence {
  return {
    ...evidence,
    evidenceSha256: sha256(evidence)
  };
}

function normalizeOwnerState(state: ClipsPublicationPublicState): ClipsPublicationPublicState {
  return {
    publicationId: state.publicationId.trim(),
    status: state.status.trim().toLowerCase(),
    youtubeVideoId: state.youtubeVideoId?.trim() || null,
    youtubeChannelId: state.youtubeChannelId?.trim() || null,
    lastError: state.lastError?.trim() || null
  };
}

function verifyOwnerState(
  expected: YouTubePublicVerificationInput,
  state: ClipsPublicationPublicState
): AttemptVerdict {
  if (state.publicationId !== expected.publicationId) {
    return terminal("CLIPS_PUBLICATION_ID_MISMATCH");
  }
  if (state.youtubeVideoId && state.youtubeVideoId !== expected.expectedVideoId) {
    return terminal("CLIPS_VIDEO_ID_MISMATCH");
  }
  if (state.youtubeChannelId && state.youtubeChannelId !== expected.expectedChannelId) {
    return terminal("CLIPS_CHANNEL_ID_MISMATCH");
  }
  if (state.lastError) {
    return terminal("CLIPS_LAST_ERROR");
  }
  if (OWNER_TERMINAL_STATES.has(state.status)) {
    return terminal("CLIPS_TERMINAL_STATE");
  }
  if (
    !OWNER_READY_STATES.has(state.status) ||
    state.youtubeVideoId !== expected.expectedVideoId ||
    state.youtubeChannelId !== expected.expectedChannelId
  ) {
    return retryable("CLIPS_NOT_PUBLISHED");
  }
  return success();
}

async function readHttpSnapshot(
  fetcher: YouTubePublicVerificationDependencies["fetch"],
  url: string
): Promise<HttpSnapshot> {
  try {
    const response = await fetcher(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        Accept: "text/html,application/atom+xml,application/xml;q=0.9,*/*;q=0.8",
        "Cache-Control": "no-cache"
      }
    });
    const body = await response.text();
    return {
      requestedUrl: url,
      finalUrl: response.url || null,
      status: response.status,
      contentType: response.headers.get("content-type"),
      bodySha256: sha256(body),
      error: null,
      ok: response.ok,
      body
    };
  } catch (error) {
    return {
      requestedUrl: url,
      finalUrl: null,
      status: null,
      contentType: null,
      bodySha256: null,
      error: normalizeError(error),
      ok: false,
      body: null
    };
  }
}

function extractXmlTag(body: string, localName: string): string | null {
  const pattern = new RegExp(
    `<(?:[A-Za-z0-9_-]+:)?${localName}\\b[^>]*>([^<]+)</(?:[A-Za-z0-9_-]+:)?${localName}>`,
    "i"
  );
  return pattern.exec(body)?.[1]?.trim() || null;
}

function extractFeedChannelId(feedHeader: string): string | null {
  const canonicalChannelLink =
    /https?:\/\/(?:www\.)?youtube\.com\/channel\/([A-Za-z0-9_-]{6,64})/i.exec(feedHeader)?.[1]?.trim() ?? null;
  return canonicalChannelLink || extractXmlTag(feedHeader, "channelId");
}

function checkRss(snapshot: HttpSnapshot, expected: YouTubePublicVerificationInput): RssCheck {
  const baseEvidence: VerificationRssEvidence = {
    requestedUrl: snapshot.requestedUrl,
    finalUrl: snapshot.finalUrl,
    status: snapshot.status,
    contentType: snapshot.contentType,
    bodySha256: snapshot.bodySha256,
    error: snapshot.error,
    feedChannelId: null,
    matchingVideoFound: false,
    matchingEntryChannelId: null
  };
  if (snapshot.error) {
    return { evidence: baseEvidence, verdict: retryable("RSS_FETCH_ERROR") };
  }
  if (!snapshot.ok || !snapshot.body) {
    return { evidence: baseEvidence, verdict: retryable("RSS_HTTP_ERROR") };
  }

  const entries = Array.from(snapshot.body.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi), (match) => match[1]);
  const feedHeader = snapshot.body.replace(/<entry\b[^>]*>[\s\S]*?<\/entry>/gi, "");
  // YouTube's live Atom feed can omit the leading `UC` in the feed-level
  // yt:channelId while retaining the full stable ID in its canonical channel
  // link and each entry. Prefer that canonical link and still require the
  // matching entry to carry the exact expected stable channel ID.
  const feedChannelId = extractFeedChannelId(feedHeader);
  const matchingEntry = entries.find((entry) => extractXmlTag(entry, "videoId") === expected.expectedVideoId) ?? null;
  const matchingEntryChannelId = matchingEntry ? extractXmlTag(matchingEntry, "channelId") : null;
  const evidence: VerificationRssEvidence = {
    ...baseEvidence,
    feedChannelId,
    matchingVideoFound: Boolean(matchingEntry),
    matchingEntryChannelId
  };

  if (!feedChannelId) {
    return { evidence, verdict: retryable("RSS_FEED_UNREADABLE") };
  }
  if (feedChannelId !== expected.expectedChannelId) {
    return { evidence, verdict: terminal("RSS_CHANNEL_ID_MISMATCH") };
  }
  if (!matchingEntry) {
    return { evidence, verdict: retryable("RSS_VIDEO_NOT_FOUND") };
  }
  if (matchingEntryChannelId !== expected.expectedChannelId) {
    return { evidence, verdict: terminal("RSS_ENTRY_CHANNEL_ID_MISMATCH") };
  }
  return { evidence, verdict: success() };
}

function extractBalancedJsonObject(source: string, marker: string): Record<string, unknown> | null {
  let searchFrom = 0;
  while (searchFrom < source.length) {
    const markerIndex = source.indexOf(marker, searchFrom);
    if (markerIndex < 0) {
      return null;
    }
    const start = source.indexOf("{", markerIndex + marker.length);
    if (start < 0) {
      return null;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }
      if (character === '"') {
        inString = true;
      } else if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(source.slice(start, index + 1)) as Record<string, unknown>;
          } catch {
            break;
          }
        }
      }
    }
    searchFrom = markerIndex + marker.length;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function countPlayableStreams(playerResponse: Record<string, unknown>): number {
  const streamingData = asRecord(playerResponse.streamingData);
  if (!streamingData) {
    return 0;
  }
  const formats = Array.isArray(streamingData.formats) ? streamingData.formats : [];
  const adaptiveFormats = Array.isArray(streamingData.adaptiveFormats) ? streamingData.adaptiveFormats : [];
  return formats.length + adaptiveFormats.length;
}

function checkShortsPage(snapshot: HttpSnapshot, expected: YouTubePublicVerificationInput): ShortsCheck {
  const baseEvidence: VerificationShortsEvidence = {
    requestedUrl: snapshot.requestedUrl,
    finalUrl: snapshot.finalUrl,
    status: snapshot.status,
    contentType: snapshot.contentType,
    bodySha256: snapshot.bodySha256,
    error: snapshot.error,
    playerResponseFound: false,
    videoId: null,
    channelId: null,
    playabilityStatus: null,
    isPrivate: null,
    playableStreamCount: 0
  };
  if (snapshot.error) {
    return { evidence: baseEvidence, verdict: retryable("SHORTS_FETCH_ERROR") };
  }
  if (!snapshot.ok || !snapshot.body) {
    return { evidence: baseEvidence, verdict: retryable("SHORTS_HTTP_ERROR") };
  }

  const playerResponse = extractBalancedJsonObject(snapshot.body, "ytInitialPlayerResponse");
  if (!playerResponse) {
    return { evidence: baseEvidence, verdict: retryable("SHORTS_PAGE_UNREADABLE") };
  }
  const videoDetails = asRecord(playerResponse.videoDetails);
  const playabilityStatus = asRecord(playerResponse.playabilityStatus);
  const videoId = asString(videoDetails?.videoId);
  const channelId = asString(videoDetails?.channelId);
  const status = asString(playabilityStatus?.status);
  const isPrivate = asBoolean(videoDetails?.isPrivate);
  const playableStreamCount = countPlayableStreams(playerResponse);
  const evidence: VerificationShortsEvidence = {
    ...baseEvidence,
    playerResponseFound: true,
    videoId,
    channelId,
    playabilityStatus: status,
    isPrivate,
    playableStreamCount
  };

  if (videoId && videoId !== expected.expectedVideoId) {
    return { evidence, verdict: terminal("SHORTS_VIDEO_ID_MISMATCH") };
  }
  if (channelId && channelId !== expected.expectedChannelId) {
    return { evidence, verdict: terminal("SHORTS_CHANNEL_ID_MISMATCH") };
  }
  if (
    videoId !== expected.expectedVideoId ||
    channelId !== expected.expectedChannelId ||
    status !== "OK" ||
    isPrivate !== false ||
    playableStreamCount < 1
  ) {
    return { evidence, verdict: retryable("SHORTS_NOT_PUBLIC_OR_PLAYABLE") };
  }
  return { evidence, verdict: success() };
}

function chooseFailure(...verdicts: AttemptVerdict[]): AttemptVerdict {
  return (
    verdicts.find((verdict) => verdict.disposition === "terminal") ??
    verdicts.find((verdict) => !verdict.verified) ??
    success()
  );
}

async function verifyAttempt(
  input: YouTubePublicVerificationInput,
  attempt: number,
  dependencies: Required<Pick<YouTubePublicVerificationDependencies, "readClipsPublication" | "fetch" | "now">>
): Promise<YouTubePublicVerificationAttemptEvidence> {
  const checkedAt = dependencies.now().toISOString();
  let ownerState: ClipsPublicationPublicState;
  try {
    ownerState = normalizeOwnerState(await dependencies.readClipsPublication(input.publicationId));
  } catch (error) {
    return withAttemptHash({
      schemaVersion: 1,
      attempt,
      checkedAt,
      expected: input,
      clips: {
        state: null,
        stateSha256: null,
        error: normalizeError(error)
      },
      rss: null,
      shortsPage: null,
      verdict: retryable("CLIPS_READ_ERROR")
    });
  }

  const ownerVerdict = verifyOwnerState(input, ownerState);
  const clipsEvidence = {
    state: ownerState,
    stateSha256: sha256(ownerState),
    error: null
  };
  if (!ownerVerdict.verified) {
    return withAttemptHash({
      schemaVersion: 1,
      attempt,
      checkedAt,
      expected: input,
      clips: clipsEvidence,
      rss: null,
      shortsPage: null,
      verdict: ownerVerdict
    });
  }

  const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(input.expectedChannelId)}`;
  const shortsUrl = `https://www.youtube.com/shorts/${encodeURIComponent(input.expectedVideoId)}`;
  const [rssSnapshot, shortsSnapshot] = await Promise.all([
    readHttpSnapshot(dependencies.fetch, rssUrl),
    readHttpSnapshot(dependencies.fetch, shortsUrl)
  ]);
  const rss = checkRss(rssSnapshot, input);
  const shorts = checkShortsPage(shortsSnapshot, input);
  const verdict = rss.verdict.verified && shorts.verdict.verified ? success() : chooseFailure(rss.verdict, shorts.verdict);
  return withAttemptHash({
    schemaVersion: 1,
    attempt,
    checkedAt,
    expected: input,
    clips: clipsEvidence,
    rss: rss.evidence,
    shortsPage: shorts.evidence,
    verdict
  });
}

function buildResult(
  outcome: YouTubePublicVerificationOutcome,
  attempts: YouTubePublicVerificationAttemptEvidence[],
  retryDelaysMs: number[]
): YouTubePublicVerificationResult {
  const finalAttempt = attempts.at(-1);
  if (!finalAttempt) {
    throw new Error("At least one verification attempt is required.");
  }
  const resultWithoutHash = {
    verified: outcome === "public_verified",
    outcome,
    reason: finalAttempt.verdict.reason,
    attempts,
    retryDelaysMs
  };
  return {
    ...resultWithoutHash,
    evidenceSha256: sha256({
      schemaVersion: 1,
      verified: resultWithoutHash.verified,
      outcome,
      reason: resultWithoutHash.reason,
      retryDelaysMs,
      attemptEvidenceSha256: attempts.map((attempt) => attempt.evidenceSha256)
    })
  };
}

export async function reconcileYouTubePublicVerification(
  rawInput: YouTubePublicVerificationInput,
  dependencies: YouTubePublicVerificationDependencies,
  policy: YouTubePublicVerificationPolicy = {}
): Promise<YouTubePublicVerificationResult> {
  const input = normalizeInput(rawInput);
  const maxAttempts = asBoundedInteger(policy.maxAttempts, DEFAULT_MAX_ATTEMPTS, "maxAttempts", 20);
  const initialRetryDelayMs = asBoundedDuration(
    policy.initialRetryDelayMs,
    DEFAULT_INITIAL_RETRY_DELAY_MS,
    "initialRetryDelayMs"
  );
  const maxRetryDelayMs = asBoundedDuration(
    policy.maxRetryDelayMs,
    DEFAULT_MAX_RETRY_DELAY_MS,
    "maxRetryDelayMs"
  );
  const maxElapsedMs = asBoundedDuration(policy.maxElapsedMs, DEFAULT_MAX_ELAPSED_MS, "maxElapsedMs");
  const now = dependencies.now ?? (() => new Date());
  const sleep =
    dependencies.sleep ??
    ((delayMs: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs);
      }));
  const resolvedDependencies = {
    readClipsPublication: dependencies.readClipsPublication,
    fetch: dependencies.fetch,
    now
  };
  const attempts: YouTubePublicVerificationAttemptEvidence[] = [];
  const retryDelaysMs: number[] = [];
  const startedAtMs = now().getTime();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const evidence = await verifyAttempt(input, attempt, resolvedDependencies);
    attempts.push(evidence);
    if (evidence.verdict.verified) {
      return buildResult("public_verified", attempts, retryDelaysMs);
    }
    if (evidence.verdict.disposition === "terminal") {
      return buildResult("terminal_failure", attempts, retryDelaysMs);
    }
    if (attempt === maxAttempts) {
      break;
    }

    const retryDelayMs = Math.min(initialRetryDelayMs * 2 ** (attempt - 1), maxRetryDelayMs);
    const elapsedMs = Math.max(0, now().getTime() - startedAtMs);
    if (elapsedMs + retryDelayMs > maxElapsedMs) {
      break;
    }
    retryDelaysMs.push(retryDelayMs);
    await sleep(retryDelayMs);
  }

  return buildResult("retry_exhausted", attempts, retryDelaysMs);
}
