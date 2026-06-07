import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { Stage3SourceCrop } from "../app/components/types";
import {
  FINAL_WHISTLE_AUTHOR_HANDLE,
  FINAL_WHISTLE_AUTHOR_NAME,
  FINAL_WHISTLE_CHANNEL_USERNAME,
  FINAL_WHISTLE_REFERENCE_SEEDS,
  FINAL_WHISTLE_REFERENCE_WINDOW
} from "../lib/final-whistle-channel-preset";
import { createOrGetChatBySource, getChannelById } from "../lib/chat-history";
import {
  getCachedSourceMedia,
  storeUploadedSourceMedia
} from "../lib/source-media-cache";
import { renderStage3Video } from "../lib/stage3-render-service";
import { buildUploadedSourceUrl } from "../lib/uploaded-source";
import { upsertFinalWhistleChannel } from "./create-final-whistle-channel";

const INSTAGRAM_USER_ID = "78553422429";
const INSTAGRAM_PROFILE_URL = "https://www.instagram.com/ycnex_sport/";
const INSTAGRAM_FEED_URL = `https://i.instagram.com/api/v1/feed/user/${INSTAGRAM_USER_ID}/`;
const INSTAGRAM_HEADERS = {
  "x-ig-app-id": "936619743392459",
  "user-agent": "Instagram 219.0.0.12.117 Android",
  referer: "https://www.instagram.com/"
};

type BatchArgs = {
  pages: number;
  limit: number;
  outputDir?: string;
  avatarPath?: string;
  onlyShortcode?: string;
  render: boolean;
  dryRun: boolean;
};

type InstagramVideoVersion = {
  url?: string;
  width?: number;
  height?: number;
};

type InstagramItem = {
  code?: string;
  play_count?: number;
  ig_play_count?: number;
  video_duration?: number;
  caption?: {
    text?: string;
  };
  video_versions?: InstagramVideoVersion[];
};

type SourceQueueItem = {
  shortcode: string;
  link: string;
  category: string;
  used: boolean;
  playCount: number;
  durationSec: number | null;
  caption: string;
  videoUrl: string | null;
};

type CaptionDraft = {
  title: string;
  lead: string;
  mainCaption: string;
  highlights: string[];
};

type RenderedBatchItem = {
  index: number;
  shortcode: string;
  instagramUrl: string;
  category: string;
  used: boolean;
  playCount: number;
  durationSec: number | null;
  uploadedSourceUrl: string | null;
  chatId: string | null;
  outputPath: string | null;
  title: string;
  lead: string;
  mainCaption: string;
  error: string | null;
};

const FOOTBALL_DRAFTS: Record<string, CaptionDraft> = {
  DYkYqJVA3r6: {
    title: "RONALDO FIRST REACTION",
    lead: "WATCH HIS REACTION",
    mainCaption:
      "Ronaldo is close enough to finish the move, but the ball goes somewhere else. The goal still counts, yet his first reaction becomes the story. That is why people argue about this side of him long after the net moves.",
    highlights: ["Ronaldo", "finish the move", "first reaction", "net"]
  },
  DYe9uOQIMNM: {
    title: "YAMAL STAYS CALM",
    lead: "SEVENTEEN LOOKS CALM",
    mainCaption:
      "Lamine Yamal does not rush the defender. He waits, shifts the ball, and makes the pressure look late. At seventeen, the strange part is how calm the decision looks before anyone can touch him.",
    highlights: ["Lamine Yamal", "defender", "shifts the ball", "seventeen"]
  },
  DYescxYoZVX: {
    title: "ZIDANE TRAINING DETAIL",
    lead: "ZIDANE DRILLED THIS",
    mainCaption:
      "Zidane's Real Madrid kept turning finishing into repetition. The angle changes, the body shape changes, but the demand stays the same: decide fast, strike clean, and make the next touch matter.",
    highlights: ["Zidane", "Real Madrid", "finishing", "next touch"]
  },
  DYcQ8QwoIOp: {
    title: "MARADONA FINAL PASS",
    lead: "THE FINAL TURNED",
    mainCaption:
      "The 1986 final had noise, pressure, and one player bending the match around him. Maradona did not need the last touch to own the moment. One pass through the gap changed Argentina's night.",
    highlights: ["1986 final", "Maradona", "last touch", "Argentina"]
  },
  DYX7iBdg0ar: {
    title: "MESSI FOUR STRAIGHT",
    lead: "FOUR BEFORE TWENTY SIX",
    mainCaption:
      "By 25, Messi had four straight Ballon d'Ors and a season that made the number feel normal. The trophies were not the strangest part. It was how quickly 91 goals became the standard around him.",
    highlights: ["Messi", "four straight", "Ballon d'Ors", "91 goals"]
  },
  DYVAQ1dAKii: {
    title: "PSG MILAN TIFO",
    lead: "THE TIFO AGED FAST",
    mainCaption:
      "PSG's ultras tried to turn Milan's devil into the target before kickoff. Paris won the first night, but the story kept moving. When the return leg came, the same banner felt completely different.",
    highlights: ["PSG", "Milan", "before kickoff", "return leg"]
  },
  DYTx7L0ApK7: {
    title: "MESSI MBAPPE MOMENT",
    lead: "HE ALMOST MISSED",
    mainCaption:
      "Messi leans in on instinct, already thinking the person beside him is his wife. Then he sees Mbappe at the last second, pulls away, and the celebration turns into a reaction everyone replays.",
    highlights: ["Messi", "Mbappe", "last second", "celebration"]
  },
  DYOtdDXAY_Y: {
    title: "BARCA PASSING MACHINE",
    lead: "THE BALL DID IT",
    mainCaption:
      "Barcelona's best years made pressure look pointless. The pass arrived before the tackle, the next angle opened, and the opponent spent the move chasing a ball that was already gone.",
    highlights: ["Barcelona", "pressure", "before the tackle", "ball"]
  },
  DYOtdDXAY_Y_ALT: {
    title: "BARCA PASSING MACHINE",
    lead: "THE BALL DID IT",
    mainCaption:
      "Barcelona's best years made pressure look pointless. The pass arrived before the tackle, the next angle opened, and the opponent spent the move chasing a ball that was already gone.",
    highlights: ["Barcelona", "pressure", "before the tackle", "ball"]
  },
  DYNNimeAqCc: {
    title: "SHAKIRA FIFA RETURN",
    lead: "THE ANTHEM RETURNED",
    mainCaption:
      "Shakira's World Cup link is not just nostalgia. Every tournament anthem becomes part of the memory around the matches, and one new song can make the next tournament feel familiar before kickoff.",
    highlights: ["Shakira", "World Cup", "anthem", "before kickoff"]
  },
  DYE2MfeghMY: {
    title: "KVARA BASE ROUTINE",
    lead: "HE LIVED THERE",
    mainCaption:
      "Khvicha Kvaratskhelia did not treat Rubin Kazan like a stop between matches. He lived on the club base, kept everything close, and built the routine before the bigger stage arrived.",
    highlights: ["Khvicha Kvaratskhelia", "Rubin Kazan", "club base", "routine"]
  }
};

const FINAL_WHISTLE_SOURCE_CROPS: Record<string, Stage3SourceCrop> = {
  DYkYqJVA3r6: {
    enabled: true,
    x: 0.06,
    y: 0.31,
    width: 0.885,
    height: 0.455,
    confidence: 0.86,
    source: "final-whistle-clean-source-crop-v1",
    reviewedAt: "2026-05-21",
    notes: "Keeps only the inner football clip; removes the source Reel headline, count and footer."
  },
  DYe9uOQIMNM: {
    enabled: true,
    x: 0.063,
    y: 0.26,
    width: 0.874,
    height: 0.527,
    confidence: 0.88,
    source: "final-whistle-clean-source-crop-v1",
    reviewedAt: "2026-05-21",
    notes: "Keeps only the inner football clip; removes the source Reel headline, count and footer."
  },
  DYescxYoZVX: {
    enabled: true,
    x: 0.037,
    y: 0.344,
    width: 0.926,
    height: 0.375,
    confidence: 0.86,
    source: "final-whistle-clean-source-crop-v1",
    reviewedAt: "2026-05-21",
    notes: "Keeps only the inner football clip; removes the source Reel headline, count and footer."
  },
  DYcQ8QwoIOp: {
    enabled: true,
    x: 0.044,
    y: 0.31,
    width: 0.911,
    height: 0.355,
    confidence: 0.84,
    source: "final-whistle-clean-source-crop-v1",
    reviewedAt: "2026-05-21",
    notes: "Keeps only the inner football clip; removes the source Reel headline, count and footer."
  },
  DYX7iBdg0ar: {
    enabled: true,
    x: 0.044,
    y: 0.315,
    width: 0.907,
    height: 0.445,
    confidence: 0.86,
    source: "final-whistle-clean-source-crop-v1",
    reviewedAt: "2026-05-21",
    notes: "Keeps only the inner football clip; removes the source Reel headline, count and footer."
  },
  DYVAQ1dAKii: {
    enabled: true,
    x: 0.022,
    y: 0.318,
    width: 0.952,
    height: 0.386,
    confidence: 0.86,
    source: "final-whistle-clean-source-crop-v1",
    reviewedAt: "2026-05-21",
    notes: "Keeps only the inner football clip; removes the source Reel headline, count and footer."
  },
  DYTx7L0ApK7: {
    enabled: true,
    x: 0.056,
    y: 0.325,
    width: 0.893,
    height: 0.444,
    confidence: 0.86,
    source: "final-whistle-clean-source-crop-v1",
    reviewedAt: "2026-05-21",
    notes: "Keeps only the inner football clip; removes the source Reel headline, count and footer."
  },
  "DYOtdDXAY-Y": {
    enabled: true,
    x: 0,
    y: 0.32,
    width: 1,
    height: 0.318,
    confidence: 0.84,
    source: "final-whistle-clean-source-crop-v1",
    reviewedAt: "2026-05-21",
    notes: "Keeps only the inner football clip; removes the source Reel headline, count and footer."
  }
};

const FINAL_WHISTLE_DEFAULT_SOURCE_CROP: Stage3SourceCrop = {
  enabled: true,
  x: 0.04,
  y: 0.31,
  width: 0.92,
  height: 0.42,
  confidence: 0.62,
  source: "final-whistle-default-clean-source-crop-v1",
  reviewedAt: "2026-05-21",
  notes: "Fallback crop for ycnex_sport framed Reels; calibrated clips should use shortcode-specific crops."
};

function resolveFinalWhistleSourceCrop(shortcode: string): Stage3SourceCrop {
  return FINAL_WHISTLE_SOURCE_CROPS[shortcode] ?? FINAL_WHISTLE_DEFAULT_SOURCE_CROP;
}

function parseArgs(argv: string[]): BatchArgs {
  const args: BatchArgs = {
    pages: 4,
    limit: 8,
    render: true,
    dryRun: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--no-render") {
      args.render = false;
      continue;
    }
    if (arg === "--pages") {
      const value = Number.parseInt(argv[index + 1] ?? "", 10);
      if (!Number.isFinite(value) || value < 1) throw new Error("--pages requires a positive integer.");
      args.pages = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--pages=")) {
      const value = Number.parseInt(arg.slice("--pages=".length), 10);
      if (!Number.isFinite(value) || value < 1) throw new Error("--pages requires a positive integer.");
      args.pages = value;
      continue;
    }
    if (arg === "--limit") {
      const value = Number.parseInt(argv[index + 1] ?? "", 10);
      if (!Number.isFinite(value) || value < 1) throw new Error("--limit requires a positive integer.");
      args.limit = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      const value = Number.parseInt(arg.slice("--limit=".length), 10);
      if (!Number.isFinite(value) || value < 1) throw new Error("--limit requires a positive integer.");
      args.limit = value;
      continue;
    }
    if (arg === "--output-dir") {
      const value = argv[index + 1]?.trim();
      if (!value) throw new Error("--output-dir requires a path.");
      args.outputDir = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--output-dir=")) {
      args.outputDir = arg.slice("--output-dir=".length).trim();
      continue;
    }
    if (arg === "--avatar") {
      const value = argv[index + 1]?.trim();
      if (!value) throw new Error("--avatar requires a file path.");
      args.avatarPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--avatar=")) {
      args.avatarPath = arg.slice("--avatar=".length).trim();
      continue;
    }
    if (arg === "--only-shortcode") {
      const value = argv[index + 1]?.trim();
      if (!value) throw new Error("--only-shortcode requires a shortcode.");
      args.onlyShortcode = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--only-shortcode=")) {
      args.onlyShortcode = arg.slice("--only-shortcode=".length).trim();
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (args.dryRun) {
    args.render = false;
  }
  return args;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCode(code: string): string {
  return code.trim();
}

function buildInstagramUrl(shortcode: string): string {
  return `https://www.instagram.com/reel/${shortcode}/`;
}

function classifySportsCategory(caption: string): string {
  const text = caption.toLowerCase();
  const combatKeywords = [
    "ufc",
    "мма",
    "бокс",
    "боевых",
    "единоборств",
    "чимаев",
    "strickland",
    "mcgregor",
    "макгрегор",
    "хабиб",
    "pereira",
    "перейра",
    "holloway"
  ];
  if (combatKeywords.some((keyword) => text.includes(keyword))) return "combat_sports";
  if (["tennis", "теннис", "радукану", "raducanu"].some((keyword) => text.includes(keyword))) return "tennis";
  if (
    [
      "формуле-1",
      "формула-1",
      "гран-при",
      "ферстаппен",
      "verstappen",
      "spa-francorchamps",
      "шумахер"
    ].some((keyword) => text.includes(keyword))
  ) {
    return "motorsport";
  }
  if (["мотоциклист", "байкер", "трассе", "гонщик"].some((keyword) => text.includes(keyword))) {
    return "motorsport";
  }
  const footballKeywords = [
    "футбол",
    "ворот",
    "гол",
    "команде",
    "cristiano",
    "ronaldo",
    "ламин",
    "yamal",
    "реал мадрид",
    "real madrid",
    "зидан",
    "zidane",
    "марадона",
    "maradona",
    "чемпионата мира",
    "world cup",
    "lionel",
    "messi",
    "месси",
    "ballon",
    "псж",
    "psg",
    "milan",
    "милан",
    "mbappe",
    "мбаппе",
    "барселона",
    "barcelona",
    "тики-таки",
    "fifa",
    "кварацхелия",
    "kvaratskhelia",
    "rubin kazan"
  ];
  if (footballKeywords.some((keyword) => text.includes(keyword))) return "football";
  if (["трамплин", "поезд", "прыж"].some((keyword) => text.includes(keyword))) return "stunt";
  return "other";
}

function pickVideoUrl(item: InstagramItem): string | null {
  const versions = Array.isArray(item.video_versions) ? item.video_versions : [];
  const sorted = versions
    .filter((version) => typeof version.url === "string" && version.url.trim())
    .sort((left, right) => {
      const leftPixels = Number(left.width ?? 0) * Number(left.height ?? 0);
      const rightPixels = Number(right.width ?? 0) * Number(right.height ?? 0);
      return rightPixels - leftPixels;
    });
  return sorted[0]?.url?.trim() ?? null;
}

async function fetchInstagramItems(maxPages: number): Promise<InstagramItem[]> {
  const items: InstagramItem[] = [];
  let maxId: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(INSTAGRAM_FEED_URL);
    url.searchParams.set("count", "20");
    if (maxId) url.searchParams.set("max_id", maxId);
    const response = await fetch(url, { headers: INSTAGRAM_HEADERS });
    if (!response.ok) {
      throw new Error(`Instagram feed request failed: ${response.status} ${response.statusText}`);
    }
    const payload = (await response.json()) as {
      items?: InstagramItem[];
      next_max_id?: string;
      more_available?: boolean;
    };
    items.push(...(payload.items ?? []));
    maxId = typeof payload.next_max_id === "string" && payload.next_max_id ? payload.next_max_id : null;
    if (!payload.more_available || !maxId) break;
    await sleep(350);
  }
  return items;
}

function toSourceQueue(items: InstagramItem[]): SourceQueueItem[] {
  const seen = new Set<string>();
  const queue: SourceQueueItem[] = [];
  for (const item of items) {
    const shortcode = normalizeCode(item.code ?? "");
    if (!shortcode || seen.has(shortcode)) continue;
    seen.add(shortcode);
    const caption = item.caption?.text?.trim() ?? "";
    queue.push({
      shortcode,
      link: buildInstagramUrl(shortcode),
      category: classifySportsCategory(caption),
      used: false,
      playCount: Number(item.play_count ?? item.ig_play_count ?? 0) || 0,
      durationSec:
        typeof item.video_duration === "number" && Number.isFinite(item.video_duration)
          ? item.video_duration
          : null,
      caption,
      videoUrl: pickVideoUrl(item)
    });
  }
  return queue;
}

function csvEscape(value: string | number | boolean | null): string {
  const text = value === null ? "" : String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function buildQueueCsv(queue: SourceQueueItem[]): string {
  const rows = [["link", "category", "used"], ...queue.map((item) => [item.link, item.category, item.used])];
  return `${rows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`;
}

function draftForItem(item: SourceQueueItem): CaptionDraft {
  const direct = FOOTBALL_DRAFTS[item.shortcode] ?? FOOTBALL_DRAFTS[item.shortcode.replace("-", "_")];
  if (direct) return direct;
  const shortCaption = item.caption.replace(/\s+/g, " ").slice(0, 160);
  return {
    title: `SPORTS MOMENT ${item.shortcode}`,
    lead: "WATCH THE MOMENT",
    mainCaption:
      "The source gives the setup, but the strongest part is still the visible action. Watch the body shape, the timing, and the reaction after the move. That is where the story becomes clear.",
    highlights: ["visible action", "timing", "reaction", shortCaption.split(" ")[0] ?? ""].filter(Boolean)
  };
}

function buildHighlights(text: string, phrases: string[]): Array<{ start: number; end: number; slotId: "slot1" }> {
  const lower = text.toLowerCase();
  const highlights: Array<{ start: number; end: number; slotId: "slot1" }> = [];
  for (const phrase of phrases) {
    const normalized = phrase.trim();
    if (!normalized) continue;
    const start = lower.indexOf(normalized.toLowerCase());
    if (start < 0) continue;
    const end = start + normalized.length;
    const overlaps = highlights.some((highlight) => start < highlight.end && end > highlight.start);
    if (!overlaps) {
      highlights.push({ start, end, slotId: "slot1" });
    }
  }
  return highlights.sort((left, right) => left.start - right.start).slice(0, 5);
}

function sanitizeFileStem(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function ensureUploadedSource(item: SourceQueueItem): Promise<string> {
  if (!item.videoUrl) {
    throw new Error(`Instagram item ${item.shortcode} has no direct video URL.`);
  }
  const uploadId = `final-whistle-${item.shortcode.toLowerCase()}`;
  const fileName = `${item.shortcode}.mp4`;
  const sourceUrl = buildUploadedSourceUrl(uploadId, fileName);
  const cached = await getCachedSourceMedia(sourceUrl);
  if (cached) return sourceUrl;

  const response = await fetch(item.videoUrl, { headers: INSTAGRAM_HEADERS });
  if (!response.ok || !response.body) {
    throw new Error(`Could not download ${item.shortcode}: ${response.status} ${response.statusText}`);
  }
  await storeUploadedSourceMedia({
    sourceUrl,
    fileName,
    title: `ycnex_sport ${item.shortcode}`,
    sourceStream: response.body,
    maxBytes: 250 * 1024 * 1024
  });
  return sourceUrl;
}

async function renderOne(input: {
  item: SourceQueueItem;
  index: number;
  channelId: string;
  workspaceId: string;
  templateId: string;
  avatarAssetId: string | null;
  outputDir: string;
}): Promise<RenderedBatchItem> {
  const draft = draftForItem(input.item);
  const uploadedSourceUrl = await ensureUploadedSource(input.item);
  const chat = await createOrGetChatBySource({
    rawUrl: uploadedSourceUrl,
    channelIdRaw: input.channelId,
    title: `ycnex_sport ${input.item.shortcode}`,
    eventText: `Instagram source queued: ${input.item.link}`
  });
  const renderTitle = `${String(input.index).padStart(2, "0")}-${sanitizeFileStem(draft.title)}-${input.item.shortcode}`;
  const targetDurationSec = Math.min(
    15,
    Math.max(8, Math.round(input.item.durationSec && input.item.durationSec < 15 ? input.item.durationSec : 12))
  );
  const sourceCrop = resolveFinalWhistleSourceCrop(input.item.shortcode);
  const rendered = await renderStage3Video(
    {
      requestId: randomUUID(),
      sourceUrl: uploadedSourceUrl,
      channelId: input.channelId,
      workspaceId: input.workspaceId,
      chatId: chat.id,
      renderTitle,
      topText: draft.lead,
      bottomText: draft.mainCaption,
      templateId: input.templateId,
      renderPlan: {
        templateId: input.templateId,
        targetDurationSec,
        durationMode: "channel_default",
        timingMode: "auto",
        normalizeToTargetEnabled: false,
        audioMode: "source_only",
        sourceAudioEnabled: true,
        mirrorEnabled: false,
        sourceCrop,
        textPolicy: "strict_fit",
        authorName: FINAL_WHISTLE_AUTHOR_NAME,
        authorHandle: FINAL_WHISTLE_AUTHOR_HANDLE,
        avatarAssetId: input.avatarAssetId ?? null,
        avatarAssetMimeType: input.avatarAssetId ? "image/png" : null
      },
      snapshot: {
        topText: draft.lead,
        bottomText: draft.mainCaption,
        captionHighlights: {
          top: [],
          bottom: buildHighlights(draft.mainCaption, draft.highlights)
        }
      },
      variationSeed: input.item.shortcode
    },
    { waitTimeoutMs: 120_000 }
  );

  const outputPath = path.join(input.outputDir, `${rendered.outputName}`);
  const variationPath = path.join(
    input.outputDir,
    `${path.basename(rendered.outputName, ".mp4")}.variation.json`
  );
  await fs.copyFile(rendered.filePath, outputPath);
  await fs.copyFile(rendered.variationManifestPath, variationPath).catch(() => undefined);
  await fs.rm(rendered.cleanupDir, { recursive: true, force: true }).catch(() => undefined);

  return {
    index: input.index,
    shortcode: input.item.shortcode,
    instagramUrl: input.item.link,
    category: input.item.category,
    used: true,
    playCount: input.item.playCount,
    durationSec: input.item.durationSec,
    uploadedSourceUrl,
    chatId: chat.id,
    outputPath,
    title: draft.title,
    lead: draft.lead,
    mainCaption: draft.mainCaption,
    error: null
  };
}

async function runBatch(args: BatchArgs): Promise<{
  outputDir: string;
  channelId: string;
  templateId: string;
  sourcePoolCsvPath: string;
  sourcePoolJsonPath: string;
  referencePath: string;
  manifestPath: string;
  rendered: RenderedBatchItem[];
}> {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
  const outputDir = path.resolve(args.outputDir ?? path.join("artifacts", "final-whistle", `first-batch-${timestamp}`));
  await fs.mkdir(outputDir, { recursive: true });

  const channelResult = await upsertFinalWhistleChannel({
    username: FINAL_WHISTLE_CHANNEL_USERNAME,
    avatarPath: args.avatarPath,
    dryRun: args.dryRun
  });
  const channel = args.dryRun ? null : await getChannelById(channelResult.channelId);
  const avatarAssetId = channel?.avatarAssetId ?? channelResult.avatarAssetId ?? null;

  const instagramItems = await fetchInstagramItems(args.pages);
  const queue = toSourceQueue(instagramItems);
  const selected = args.onlyShortcode
    ? queue.filter((item) => item.shortcode === args.onlyShortcode && item.videoUrl)
    : queue.filter((item) => item.category === "football" && item.videoUrl).slice(0, args.limit);
  const expectedSelected = args.onlyShortcode ? 1 : args.limit;
  if (selected.length < expectedSelected) {
    const expected = expectedSelected;
    throw new Error(`Only ${selected.length} football videos were found, expected ${expected}.`);
  }

  const rendered: RenderedBatchItem[] = [];
  if (args.render && !args.dryRun) {
    for (let index = 0; index < selected.length; index += 1) {
      const item = selected[index];
      try {
        const result = await renderOne({
          item,
          index: index + 1,
          channelId: channelResult.channelId,
          workspaceId: channelResult.workspaceId,
          templateId: channelResult.templateId,
          avatarAssetId,
          outputDir
        });
        item.used = true;
        rendered.push(result);
        await fs.writeFile(path.join(outputDir, "batch_manifest.partial.json"), JSON.stringify(rendered, null, 2));
      } catch (error) {
        const draft = draftForItem(item);
        rendered.push({
          index: index + 1,
          shortcode: item.shortcode,
          instagramUrl: item.link,
          category: item.category,
          used: false,
          playCount: item.playCount,
          durationSec: item.durationSec,
          uploadedSourceUrl: null,
          chatId: null,
          outputPath: null,
          title: draft.title,
          lead: draft.lead,
          mainCaption: draft.mainCaption,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  } else {
    for (let index = 0; index < selected.length; index += 1) {
      const item = selected[index];
      const draft = draftForItem(item);
      rendered.push({
        index: index + 1,
        shortcode: item.shortcode,
        instagramUrl: item.link,
        category: item.category,
        used: false,
        playCount: item.playCount,
        durationSec: item.durationSec,
        uploadedSourceUrl: null,
        chatId: null,
        outputPath: null,
        title: draft.title,
        lead: draft.lead,
        mainCaption: draft.mainCaption,
        error: null
      });
    }
  }

  const sourcePoolCsvPath = path.join(outputDir, "ycnex-sport-source-pool.csv");
  const sourcePoolJsonPath = path.join(outputDir, "ycnex-sport-source-pool.json");
  const referencePath = path.join(outputDir, "reference-channels.json");
  const manifestPath = path.join(outputDir, "batch_manifest.json");
  await fs.writeFile(sourcePoolCsvPath, buildQueueCsv(queue), "utf-8");
  await fs.writeFile(sourcePoolJsonPath, JSON.stringify(queue, null, 2), "utf-8");
  await fs.writeFile(
    referencePath,
    JSON.stringify(
      {
        referenceWindow: FINAL_WHISTLE_REFERENCE_WINDOW,
        examplesCount: FINAL_WHISTLE_REFERENCE_SEEDS.length,
        selectedExamples: FINAL_WHISTLE_REFERENCE_SEEDS.map((seed) => ({
          sourceChannelName: seed.sourceChannelName,
          url: seed.url,
          views: seed.views,
          title: seed.title,
          lead: seed.lead,
          clipType: seed.clipType
        }))
      },
      null,
      2
    ),
    "utf-8"
  );
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        instagramProfile: INSTAGRAM_PROFILE_URL,
        channel: channelResult,
        selectedCount: selected.length,
        renderEnabled: args.render && !args.dryRun,
        outputDir,
        sourcePoolCsvPath,
        sourcePoolJsonPath,
        referencePath,
        videos: rendered
      },
      null,
      2
    ),
    "utf-8"
  );

  return {
    outputDir,
    channelId: channelResult.channelId,
    templateId: channelResult.templateId,
    sourcePoolCsvPath,
    sourcePoolJsonPath,
    referencePath,
    manifestPath,
    rendered
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await runBatch(args);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
