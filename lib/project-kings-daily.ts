import { appendFileSync, existsSync, readFileSync, truncateSync } from "node:fs";

export const PROJECT_KINGS_CHANNELS = ["dark", "light", "cop"] as const;
export type ProjectKingsChannelKey = (typeof PROJECT_KINGS_CHANNELS)[number];

export type ProjectKingsLedgerEvent = {
  runId: string;
  channelKey: ProjectKingsChannelKey | "portfolio";
  slot: number | null;
  stage: string;
  sourceUrl?: string | null;
  attemptKind?: "external" | "semantic" | null;
  attempt?: number | null;
  artifactRefs?: Record<string, unknown> | null;
  publicationId?: string | null;
  youtubeVideoId?: string | null;
  stopReason?: string | null;
  at: string;
};

export type ProjectKingsChannelPreflight = {
  key: ProjectKingsChannelKey;
  channelId: string;
  expectedYoutubeChannelId: string;
  actualYoutubeChannelId: string | null;
  publishingReady: boolean;
  timezone: string | null;
  candidates: Array<{ sourceUrl: string }>;
};

export type ProjectKingsPreflightResult = {
  ready: boolean;
  errors: string[];
  channels: Array<{
    key: ProjectKingsChannelKey;
    availableDistinct: number;
    required: number;
  }>;
};

export type SemanticVerdict = "PASS" | "REWORK" | "REPLACE";

export function normalizeProjectKingsSourceKey(raw: string): string {
  const value = raw.trim();
  if (!value) {
    return "";
  }
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") {
      return `youtube:${url.pathname.split("/").filter(Boolean)[0] ?? ""}`;
    }
    if (host.endsWith("youtube.com")) {
      const parts = url.pathname.split("/").filter(Boolean);
      const id = url.searchParams.get("v") ?? (parts[0] === "shorts" ? parts[1] : null);
      if (id) {
        return `youtube:${id}`;
      }
    }
    if (host.endsWith("instagram.com")) {
      const parts = url.pathname.split("/").filter(Boolean);
      const reelIndex = parts.findIndex((part) => part === "reel" || part === "reels" || part === "p");
      if (reelIndex >= 0 && parts[reelIndex + 1]) {
        return `instagram:${parts[reelIndex + 1]}`;
      }
    }
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_") || ["igsh", "si", "feature", "share"].includes(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

export function publicVerifiedSourceKeys(events: ProjectKingsLedgerEvent[]): Set<string> {
  return new Set(
    events
      .filter((event) => event.stage === "public_verified" && event.sourceUrl)
      .map((event) => normalizeProjectKingsSourceKey(event.sourceUrl ?? ""))
      .filter(Boolean)
  );
}

export function buildProjectKingsPreflight(input: {
  channels: ProjectKingsChannelPreflight[];
  ledger: ProjectKingsLedgerEvent[];
  publications?: Array<{ sourceUrl?: string | null; status?: string | null }>;
  minBuffer?: number;
}): ProjectKingsPreflightResult {
  const minBuffer = input.minBuffer ?? 6;
  const used = publicVerifiedSourceKeys(input.ledger);
  for (const publication of input.publications ?? []) {
    if (publication.sourceUrl && publication.status !== "canceled") {
      used.add(normalizeProjectKingsSourceKey(publication.sourceUrl));
    }
  }
  const errors: string[] = [];
  const channelResults = input.channels.map((channel) => {
    const available = new Set(
      channel.candidates
        .map((candidate) => normalizeProjectKingsSourceKey(candidate.sourceUrl))
        .filter((key) => key && !used.has(key))
    );
    if (!channel.publishingReady) {
      errors.push(`${channel.key}: YouTube publishing is not ready.`);
    }
    if (channel.actualYoutubeChannelId !== channel.expectedYoutubeChannelId) {
      errors.push(
        `${channel.key}: YouTube binding mismatch (${channel.actualYoutubeChannelId ?? "missing"} != ${channel.expectedYoutubeChannelId}).`
      );
    }
    if (channel.timezone !== "Europe/Moscow") {
      errors.push(`${channel.key}: timezone must be Europe/Moscow.`);
    }
    if (available.size < minBuffer) {
      errors.push(`${channel.key}: source buffer ${available.size}/${minBuffer}.`);
    }
    return { key: channel.key, availableDistinct: available.size, required: minBuffer };
  });
  const seenKeys = new Set(input.channels.map((channel) => channel.key));
  for (const required of PROJECT_KINGS_CHANNELS) {
    if (!seenKeys.has(required)) {
      errors.push(`${required}: channel is missing from preflight.`);
    }
  }
  return { ready: errors.length === 0, errors, channels: channelResults };
}

export function summarizeProjectKingsProgress(
  events: ProjectKingsLedgerEvent[],
  runId: string,
  target = 3
): Record<ProjectKingsChannelKey, number> {
  const result = { dark: 0, light: 0, cop: 0 };
  for (const channelKey of PROJECT_KINGS_CHANNELS) {
    const uniqueSlots = new Set<number>();
    const videoIds = new Set<string>();
    for (const event of events) {
      if (event.runId !== runId || event.channelKey !== channelKey || event.stage !== "public_verified") {
        continue;
      }
      if (!event.slot || event.slot < 1 || event.slot > target) {
        throw new Error(`${channelKey}: invalid public_verified slot ${String(event.slot)}.`);
      }
      if (!event.youtubeVideoId) {
        throw new Error(`${channelKey}: public_verified event has no YouTube id.`);
      }
      if (uniqueSlots.has(event.slot) || videoIds.has(event.youtubeVideoId)) {
        throw new Error(`${channelKey}: duplicate public_verified slot or YouTube id.`);
      }
      uniqueSlots.add(event.slot);
      videoIds.add(event.youtubeVideoId);
    }
    result[channelKey] = uniqueSlots.size;
  }
  return result;
}

export function assertExactProjectKingsTarget(
  events: ProjectKingsLedgerEvent[],
  runId: string,
  target = 3
): void {
  const progress = summarizeProjectKingsProgress(events, runId, target);
  for (const channelKey of PROJECT_KINGS_CHANNELS) {
    if (progress[channelKey] !== target) {
      throw new Error(`${channelKey}: ${progress[channelKey]}/${target} public_verified.`);
    }
  }
}

export async function runProjectKingsChannelsInParallel<T>(
  runChannel: (channel: ProjectKingsChannelKey) => Promise<T>
): Promise<Record<ProjectKingsChannelKey, PromiseSettledResult<T>>> {
  const settled = await Promise.allSettled(PROJECT_KINGS_CHANNELS.map((channel) => runChannel(channel)));
  return {
    dark: settled[0]!,
    light: settled[1]!,
    cop: settled[2]!
  };
}

export async function withProjectKingsExternalRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: {
    maxAttempts?: number;
    isRetryable: (error: unknown) => boolean;
    sleep?: (ms: number) => Promise<void>;
    onAttempt?: (attempt: number, error: unknown | null) => void;
  }
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const value = await operation(attempt);
      options.onAttempt?.(attempt, null);
      return value;
    } catch (error) {
      lastError = error;
      options.onAttempt?.(attempt, error);
      if (attempt >= maxAttempts || !options.isRetryable(error)) {
        throw error;
      }
      await sleep(1_000 * attempt);
    }
  }
  throw lastError;
}

export function resolveProjectKingsSemanticVerdict(input: {
  verdict: SemanticVerdict;
  reworksDone: number;
  maxReworks?: number;
}): "advance" | "rework" | "replace" {
  if (input.verdict === "PASS") {
    return "advance";
  }
  if (input.verdict === "REPLACE") {
    return "replace";
  }
  return input.reworksDone < (input.maxReworks ?? 2) ? "rework" : "replace";
}

export function buildProjectKingsJudgePacket<TInput, TArtifact, TCriteria>(input: {
  sourceInput: TInput;
  artifact: TArtifact;
  criteria: TCriteria;
}): { sourceInput: TInput; artifact: TArtifact; criteria: TCriteria } {
  return {
    sourceInput: input.sourceInput,
    artifact: input.artifact,
    criteria: input.criteria
  };
}

export function resolveProjectKingsUnknownUpload(input: {
  publication?: { youtubeVideoId?: string | null } | null;
  uploadSessionUrl?: string | null;
  lookupFound?: boolean;
}): "reconcile_video_id" | "reconcile_session" | "lookup_publication" | "retry_upload" {
  if (input.publication?.youtubeVideoId) {
    return "reconcile_video_id";
  }
  if (input.uploadSessionUrl) {
    return "reconcile_session";
  }
  if (input.lookupFound === undefined) {
    return "lookup_publication";
  }
  return input.lookupFound ? "lookup_publication" : "retry_upload";
}

export function appendProjectKingsLedgerEvent(filePath: string, event: ProjectKingsLedgerEvent): void {
  let separator = "";
  if (existsSync(filePath)) {
    const raw = readFileSync(filePath, "utf8");
    if (raw.length > 0) {
      // Validate every complete line before changing the ledger. The reader
      // intentionally ignores only an invalid, unterminated final line.
      readProjectKingsLedger(filePath);
      if (!raw.endsWith("\n")) {
        const lastNewline = raw.lastIndexOf("\n");
        const tail = raw.slice(lastNewline + 1).trim();
        try {
          JSON.parse(tail);
          separator = "\n";
        } catch {
          const completePrefix = raw.slice(0, lastNewline + 1);
          truncateSync(filePath, Buffer.byteLength(completePrefix, "utf8"));
        }
      }
    }
  }
  appendFileSync(filePath, `${separator}${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
}

export function readProjectKingsLedger(filePath: string): ProjectKingsLedgerEvent[] {
  if (!existsSync(filePath)) {
    return [];
  }
  const raw = readFileSync(filePath, "utf8");
  const lines = raw.split("\n");
  const result: ProjectKingsLedgerEvent[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line) {
      continue;
    }
    try {
      result.push(JSON.parse(line) as ProjectKingsLedgerEvent);
    } catch (error) {
      const isTruncatedTail = index === lines.length - 1 && !raw.endsWith("\n");
      if (!isTruncatedTail) {
        throw new Error(`Malformed Project Kings ledger line ${index + 1}: ${String(error)}`);
      }
    }
  }
  return result;
}
