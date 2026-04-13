import type {
  ChannelPublication,
  ChannelPublicationScheduleMode,
  ChannelPublishSettings,
  Stage2Response
} from "../app/components/types";

export const DEFAULT_CHANNEL_PUBLISH_SETTINGS: ChannelPublishSettings = {
  timezone: "Europe/Moscow",
  firstSlotLocalTime: "21:00",
  dailySlotCount: 4,
  slotIntervalMinutes: 15,
  autoQueueEnabled: true,
  uploadLeadMinutes: 120,
  notifySubscribersByDefault: false
};

export type PublicationSlotCandidate = {
  scheduleMode: ChannelPublicationScheduleMode;
  scheduledAt: string;
  uploadReadyAt: string;
  slotDate: string;
  slotIndex: number;
};

export const CUSTOM_PUBLICATION_SLOT_INDEX = -1;

type DateParts = {
  year: number;
  month: number;
  day: number;
};

type TimeZoneDateParts = DateParts & {
  hour: number;
  minute: number;
  second: number;
};

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function normalizeLocalTime(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return fallback;
  }
  const hour = Number.parseInt(match[1] ?? "", 10);
  const minute = Number.parseInt(match[2] ?? "", 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return fallback;
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return fallback;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeTimezone(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return fallback;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw }).format(new Date());
    return raw;
  } catch {
    return fallback;
  }
}

function getOffsetMinutesAt(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const rawOffset = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT+00:00";
  const match = rawOffset.match(/GMT([+-])(\d{2}):(\d{2})/i);
  if (!match) {
    return 0;
  }
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number.parseInt(match[2] ?? "", 10);
  const minutes = Number.parseInt(match[3] ?? "", 10);
  return sign * (hours * 60 + minutes);
}

function getTimeZoneDateParts(date: Date, timeZone: string): TimeZoneDateParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) =>
    Number.parseInt(parts.find((part) => part.type === type)?.value ?? "0", 10);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second")
  };
}

function addDaysToDateParts(parts: DateParts, days: number): DateParts {
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate()
  };
}

function formatSlotDate(parts: DateParts): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function zonedLocalDateTimeToUtcIso(parts: DateParts, hour: number, minute: number, timeZone: string): string {
  const naiveUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, 0, 0);
  let adjusted = naiveUtcMs - getOffsetMinutesAt(new Date(naiveUtcMs), timeZone) * 60_000;
  adjusted = naiveUtcMs - getOffsetMinutesAt(new Date(adjusted), timeZone) * 60_000;
  return new Date(adjusted).toISOString();
}

function parseSlotDate(value: string): DateParts {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error("Некорректная дата слота публикации.");
  }
  return {
    year: Number.parseInt(match[1] ?? "", 10),
    month: Number.parseInt(match[2] ?? "", 10),
    day: Number.parseInt(match[3] ?? "", 10)
  };
}

function parseLocalDateTime(value: string): DateParts & { hour: number; minute: number } {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error("Некорректная дата и время публикации.");
  }
  return {
    year: Number.parseInt(match[1] ?? "", 10),
    month: Number.parseInt(match[2] ?? "", 10),
    day: Number.parseInt(match[3] ?? "", 10),
    hour: Number.parseInt(match[4] ?? "", 10),
    minute: Number.parseInt(match[5] ?? "", 10)
  };
}

function parseFirstSlotMinutes(value: string): number {
  const [hourRaw = "21", minuteRaw = "00"] = value.split(":");
  const hour = Number.parseInt(hourRaw, 10);
  const minute = Number.parseInt(minuteRaw, 10);
  return Math.max(0, Math.min(23 * 60 + 59, hour * 60 + minute));
}

export function normalizeChannelPublishSettings(
  value: Partial<ChannelPublishSettings> | null | undefined
): ChannelPublishSettings {
  return {
    timezone: normalizeTimezone(value?.timezone, DEFAULT_CHANNEL_PUBLISH_SETTINGS.timezone),
    firstSlotLocalTime: normalizeLocalTime(
      value?.firstSlotLocalTime,
      DEFAULT_CHANNEL_PUBLISH_SETTINGS.firstSlotLocalTime
    ),
    dailySlotCount: clampInteger(
      value?.dailySlotCount,
      DEFAULT_CHANNEL_PUBLISH_SETTINGS.dailySlotCount,
      1,
      12
    ),
    slotIntervalMinutes: clampInteger(
      value?.slotIntervalMinutes,
      DEFAULT_CHANNEL_PUBLISH_SETTINGS.slotIntervalMinutes,
      5,
      240
    ),
    autoQueueEnabled:
      typeof value?.autoQueueEnabled === "boolean"
        ? value.autoQueueEnabled
        : DEFAULT_CHANNEL_PUBLISH_SETTINGS.autoQueueEnabled,
    uploadLeadMinutes: clampInteger(
      value?.uploadLeadMinutes,
      DEFAULT_CHANNEL_PUBLISH_SETTINGS.uploadLeadMinutes,
      5,
      24 * 60
    ),
    notifySubscribersByDefault:
      typeof value?.notifySubscribersByDefault === "boolean"
        ? value.notifySubscribersByDefault
        : DEFAULT_CHANNEL_PUBLISH_SETTINGS.notifySubscribersByDefault
  };
}

export function splitChannelPublicationTags(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 30);
}

export function stringifyChannelPublicationTags(tags: string[]): string {
  return JSON.stringify(
    tags
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 30)
    );
}

const PUBLICATION_TAG_STOPWORDS = new Set([
  "that",
  "this",
  "with",
  "from",
  "they",
  "them",
  "what",
  "when",
  "then",
  "into",
  "just",
  "once",
  "after",
  "before",
  "there",
  "their",
  "about",
  "have",
  "your"
]);

function buildFallbackPublicationTags(texts: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const text of texts) {
    const words = String(text ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]+/g, " ")
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length >= 4 && !PUBLICATION_TAG_STOPWORDS.has(word));
    for (const word of words) {
      if (seen.has(word)) {
        continue;
      }
      seen.add(word);
      tags.push(word);
      if (tags.length >= 12) {
        return tags;
      }
    }
  }
  return tags;
}

export function parseChannelPublicationTagsJson(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 30)
      : [];
  } catch {
    return [];
  }
}

export function buildPublicationSlotKey(slotDate: string, slotIndex: number): string {
  return `${slotDate}:${slotIndex}`;
}

export function buildPublicationSlotCandidates(input: {
  settings: ChannelPublishSettings;
  now?: Date;
  daysToScan?: number;
}): PublicationSlotCandidate[] {
  const settings = normalizeChannelPublishSettings(input.settings);
  const now = input.now ?? new Date();
  const baseParts = getTimeZoneDateParts(now, settings.timezone);
  const startMinutes = parseFirstSlotMinutes(settings.firstSlotLocalTime);
  const candidates: PublicationSlotCandidate[] = [];
  const daysToScan = Math.max(1, Math.min(90, input.daysToScan ?? 30));

  for (let dayOffset = 0; dayOffset < daysToScan; dayOffset += 1) {
    const dayParts = addDaysToDateParts(baseParts, dayOffset);
    for (let slotIndex = 0; slotIndex < settings.dailySlotCount; slotIndex += 1) {
      const slotMinutes = startMinutes + slotIndex * settings.slotIntervalMinutes;
      const extraDays = Math.floor(slotMinutes / (24 * 60));
      const dayAdjusted = extraDays > 0 ? addDaysToDateParts(dayParts, extraDays) : dayParts;
      const minuteOfDay = ((slotMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
      const slotHour = Math.floor(minuteOfDay / 60);
      const slotMinute = minuteOfDay % 60;
      const scheduledAt = zonedLocalDateTimeToUtcIso(dayAdjusted, slotHour, slotMinute, settings.timezone);
      const scheduledDate = new Date(scheduledAt);
      if (scheduledDate.getTime() <= now.getTime()) {
        continue;
      }
      const uploadReadyAt = new Date(
        scheduledDate.getTime() - settings.uploadLeadMinutes * 60_000
      ).toISOString();
      candidates.push({
        scheduleMode: "slot",
        scheduledAt,
        uploadReadyAt,
        slotDate: formatSlotDate(dayAdjusted),
        slotIndex
      });
    }
  }

  return candidates;
}

export function buildPublicationSlotCandidateFromDateAndIndex(input: {
  settings: ChannelPublishSettings;
  slotDate: string;
  slotIndex: number;
}): PublicationSlotCandidate {
  const settings = normalizeChannelPublishSettings(input.settings);
  const parsedDate = parseSlotDate(input.slotDate);
  const startMinutes = parseFirstSlotMinutes(settings.firstSlotLocalTime);
  const slotMinutes = startMinutes + Math.max(0, input.slotIndex) * settings.slotIntervalMinutes;
  const extraDays = Math.floor(slotMinutes / (24 * 60));
  const dayAdjusted = extraDays > 0 ? addDaysToDateParts(parsedDate, extraDays) : parsedDate;
  const minuteOfDay = ((slotMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const slotHour = Math.floor(minuteOfDay / 60);
  const slotMinute = minuteOfDay % 60;
  const scheduledAt = zonedLocalDateTimeToUtcIso(dayAdjusted, slotHour, slotMinute, settings.timezone);
  return {
    scheduleMode: "slot",
    scheduledAt,
    uploadReadyAt: new Date(
      new Date(scheduledAt).getTime() - settings.uploadLeadMinutes * 60_000
    ).toISOString(),
    slotDate: formatSlotDate(dayAdjusted),
    slotIndex: input.slotIndex
  };
}

export function buildCustomPublicationCandidateFromLocalDateTime(input: {
  settings: ChannelPublishSettings;
  localDateTime: string;
}): PublicationSlotCandidate {
  const settings = normalizeChannelPublishSettings(input.settings);
  const parts = parseLocalDateTime(input.localDateTime);
  const scheduledAt = zonedLocalDateTimeToUtcIso(parts, parts.hour, parts.minute, settings.timezone);
  return buildCustomPublicationCandidateFromUtcIso({
    settings,
    scheduledAt
  });
}

export function buildCustomPublicationCandidateFromUtcIso(input: {
  settings: ChannelPublishSettings;
  scheduledAt: string;
}): PublicationSlotCandidate {
  const settings = normalizeChannelPublishSettings(input.settings);
  const scheduledDate = new Date(input.scheduledAt);
  if (Number.isNaN(scheduledDate.getTime())) {
    throw new Error("Некорректное время публикации.");
  }
  const localParts = getTimeZoneDateParts(scheduledDate, settings.timezone);
  return {
    scheduleMode: "custom",
    scheduledAt: scheduledDate.toISOString(),
    uploadReadyAt: new Date(
      scheduledDate.getTime() - settings.uploadLeadMinutes * 60_000
    ).toISOString(),
    slotDate: formatSlotDate(localParts),
    slotIndex: CUSTOM_PUBLICATION_SLOT_INDEX
  };
}

export function pickNextPublicationSlot(input: {
  settings: ChannelPublishSettings;
  existingPublications: Array<
    Pick<ChannelPublication, "slotDate" | "slotIndex" | "status" | "scheduledAt" | "canceledAt">
  >;
  now?: Date;
}): PublicationSlotCandidate {
  const occupied = new Set(
    input.existingPublications
      .filter((item) => item.status !== "canceled")
      .map((item) => buildPublicationSlotKey(item.slotDate, item.slotIndex))
  );
  const occupiedMoments = new Set(
    input.existingPublications
      .filter((item) => item.status !== "canceled")
      .map((item) => {
        const scheduledAt = new Date(item.scheduledAt);
        return Number.isNaN(scheduledAt.getTime()) ? null : scheduledAt.toISOString();
      })
      .filter((item): item is string => Boolean(item))
  );
  const candidates = buildPublicationSlotCandidates({
    settings: input.settings,
    now: input.now,
    daysToScan: 60
  });
  const next = candidates.find(
    (candidate) =>
      !occupied.has(buildPublicationSlotKey(candidate.slotDate, candidate.slotIndex)) &&
      !occupiedMoments.has(candidate.scheduledAt)
  );
  if (!next) {
    throw new Error("Не удалось подобрать ближайший слот публикации.");
  }
  return next;
}

export function buildChannelPublicationMetadata(input: {
  renderTitle: string | null | undefined;
  chatTitle: string | null | undefined;
  stage2Result: Stage2Response | null | undefined;
}): {
  title: string;
  description: string;
  tags: string[];
  needsReview: boolean;
} {
  const selectedCaptionCandidate =
    input.stage2Result?.output.captionOptions.find(
      (option) => option.option === input.stage2Result?.output.finalPick.option
    ) ?? input.stage2Result?.output.captionOptions[0] ?? null;
  const selectedCaption =
    selectedCaptionCandidate?.constraintCheck?.passed === false ? null : selectedCaptionCandidate;
  const title =
    input.renderTitle?.trim() ||
    input.stage2Result?.output.titleOptions[0]?.title?.trim() ||
    input.chatTitle?.trim() ||
    "Short video";
  const seoDescription = input.stage2Result?.seo?.description?.trim() ?? "";
  const seoTags = splitChannelPublicationTags(input.stage2Result?.seo?.tags ?? "");
  const description =
    seoDescription ||
    [
      title,
      selectedCaption?.top ? `TOP: ${selectedCaption.top}` : null,
      selectedCaption?.bottom ? `BOTTOM: ${selectedCaption.bottom}` : null
    ]
      .filter(Boolean)
      .join("\n");
  const tags =
    seoTags.length > 0
      ? seoTags
      : buildFallbackPublicationTags([title, selectedCaption?.top, selectedCaption?.bottom]);
  return {
    title,
    description,
    tags,
    needsReview:
      !seoDescription ||
      seoTags.length === 0 ||
      (!seoDescription && selectedCaption === null) ||
      description.length === 0 ||
      tags.length === 0
  };
}
