import type {
  ChannelPublication,
  ChannelPublicationScheduleMode,
  ChannelPublishSettings
} from "./types";
import type {
  PublicationMutationErrorField,
  PublicationMutationErrorPayload
} from "../../lib/publication-mutation-errors";

export type PublicationWorkspaceFilter = "all" | "attention" | "errors" | "scheduled";

export type PublicationInspectorDraft = {
  title: string;
  description: string;
  tags: string;
  scheduleMode: ChannelPublicationScheduleMode;
  scheduledAtLocal: string;
  slotDate: string;
  slotIndex: number;
  notifySubscribers: boolean;
};

export type PublicationFieldErrors = Partial<Record<PublicationMutationErrorField, string>> & {
  form?: string;
};

export type PublicationUiStatusTone =
  | "queued"
  | "running"
  | "scheduled"
  | "published"
  | "error"
  | "paused"
  | "muted";

export type PublicationUiStatus = {
  label: string;
  tone: PublicationUiStatusTone;
  note: string | null;
  recommendedAction: string | null;
  latestMessage: string | null;
  attention: boolean;
};

export type PublicationDayGroup = {
  id: string;
  label: string;
  items: ChannelPublication[];
};

export function formatDateKey(value: Date, timeZone: string): string {
  return value.toLocaleDateString("en-CA", { timeZone });
}

export function formatScheduledTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function formatScheduledMoment(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function getPublicationDisplayDayKey(
  publication: Pick<ChannelPublication, "scheduledAt">,
  timeZone: string
): string {
  return formatDateKey(new Date(publication.scheduledAt), timeZone);
}

export function formatDateTimeLocalValue(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function buildLocalDateTimeValue(date: string, timeLabel: string): string {
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "1970-01-01";
  const safeTime = /^\d{2}:\d{2}$/.test(timeLabel) ? timeLabel : "00:00";
  return `${safeDate}T${safeTime}`;
}

function parseTimeLabel(value: string): number | null {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const hour = Number.parseInt(match[1] ?? "", 10);
  const minute = Number.parseInt(match[2] ?? "", 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }
  return hour * 60 + minute;
}

export function splitPublicationTags(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildSlotLabels(settings: ChannelPublishSettings | null | undefined): string[] {
  const resolved = settings ?? {
    timezone: "Europe/Moscow",
    firstSlotLocalTime: "21:00",
    dailySlotCount: 4,
    slotIntervalMinutes: 15,
    autoQueueEnabled: true,
    uploadLeadMinutes: 120,
    notifySubscribersByDefault: true
  };
  const [hourString, minuteString] = resolved.firstSlotLocalTime.split(":");
  const baseHour = Number.parseInt(hourString ?? "21", 10);
  const baseMinute = Number.parseInt(minuteString ?? "0", 10);
  return Array.from({ length: resolved.dailySlotCount }, (_, index) => {
    const totalMinutes = baseHour * 60 + baseMinute + index * resolved.slotIntervalMinutes;
    const hour = Math.floor((((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60)) / 60);
    const minute = ((totalMinutes % 60) + 60) % 60;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  });
}

export function findClosestSlotIndex(timeLabel: string, slotLabels: string[]): number {
  const targetMinutes = parseTimeLabel(timeLabel);
  if (targetMinutes === null || slotLabels.length === 0) {
    return 0;
  }

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  slotLabels.forEach((label, index) => {
    const candidateMinutes = parseTimeLabel(label);
    if (candidateMinutes === null) {
      return;
    }
    const delta = Math.abs(candidateMinutes - targetMinutes);
    const wrappedDelta = Math.min(delta, 24 * 60 - delta);
    if (wrappedDelta < bestDistance) {
      bestDistance = wrappedDelta;
      bestIndex = index;
    }
  });
  return bestIndex;
}

export function getPublicationDisplaySlotIndex(
  publication: Pick<ChannelPublication, "scheduleMode" | "scheduledAt">,
  slotLabels: string[],
  timeZone: string
): number | null {
  if (publication.scheduleMode !== "slot") {
    return null;
  }
  const scheduledLabel = formatScheduledTime(publication.scheduledAt, timeZone);
  const slotIndex = slotLabels.findIndex((label) => label === scheduledLabel);
  return slotIndex >= 0 ? slotIndex : null;
}

export function isPublicationSlotSynchronized(
  publication: Pick<ChannelPublication, "scheduleMode" | "scheduledAt" | "slotDate" | "slotIndex">,
  slotLabels: string[],
  timeZone: string
): boolean {
  if (publication.scheduleMode !== "slot") {
    return true;
  }
  const displaySlotIndex = getPublicationDisplaySlotIndex(publication, slotLabels, timeZone);
  if (displaySlotIndex === null) {
    return false;
  }
  return (
    publication.slotDate === getPublicationDisplayDayKey(publication, timeZone) &&
    publication.slotIndex === displaySlotIndex
  );
}

export function formatSlotDateLabel(slotDate: string, timeZone: string, now = new Date()): string {
  const todayKey = formatDateKey(now, timeZone);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = formatDateKey(tomorrow, timeZone);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = formatDateKey(yesterday, timeZone);

  if (slotDate === todayKey) {
    return "Сегодня";
  }
  if (slotDate === tomorrowKey) {
    return "Завтра";
  }
  if (slotDate === yesterdayKey) {
    return "Вчера";
  }

  const displayDate = new Date(`${slotDate}T12:00:00.000Z`);
  return displayDate.toLocaleDateString("ru-RU", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    ...(displayDate.getUTCFullYear() !== now.getFullYear() ? { year: "numeric" } : {})
  });
}

function sortPublicationsForPlanner(
  publications: ChannelPublication[],
  todayKey: string,
  timeZone: string
): ChannelPublication[] {
  return [...publications].sort((left, right) => {
    const leftFuture = getPublicationDisplayDayKey(left, timeZone) >= todayKey;
    const rightFuture = getPublicationDisplayDayKey(right, timeZone) >= todayKey;
    if (leftFuture !== rightFuture) {
      return leftFuture ? -1 : 1;
    }

    const leftTimestamp = new Date(left.scheduledAt).getTime();
    const rightTimestamp = new Date(right.scheduledAt).getTime();
    if (leftFuture) {
      return leftTimestamp - rightTimestamp;
    }
    return rightTimestamp - leftTimestamp;
  });
}

export function buildPublicationDayGroups(
  publications: ChannelPublication[],
  timeZone: string
): PublicationDayGroup[] {
  const todayKey = formatDateKey(new Date(), timeZone);
  const groups = new Map<string, PublicationDayGroup>();

  sortPublicationsForPlanner(publications, todayKey, timeZone).forEach((publication) => {
    const dayKey = getPublicationDisplayDayKey(publication, timeZone);
    const existing = groups.get(dayKey);
    if (existing) {
      existing.items.push(publication);
      return;
    }
    groups.set(dayKey, {
      id: dayKey,
      label: formatSlotDateLabel(dayKey, timeZone),
      items: [publication]
    });
  });

  return Array.from(groups.values());
}

export function formatPublicationStatus(status: ChannelPublication["status"]): string {
  switch (status) {
    case "queued":
      return "Ожидает";
    case "uploading":
      return "Загрузка";
    case "scheduled":
      return "Запланировано";
    case "published":
      return "Опубликовано";
    case "failed":
      return "Ошибка";
    case "paused":
      return "На паузе";
    case "canceled":
      return "Удалено";
    default:
      return status;
  }
}

export function getPublicationStatusTone(status: ChannelPublication["status"]): PublicationUiStatusTone {
  switch (status) {
    case "queued":
      return "queued";
    case "uploading":
      return "running";
    case "scheduled":
      return "scheduled";
    case "published":
      return "published";
    case "failed":
      return "error";
    case "paused":
      return "paused";
    default:
      return "muted";
  }
}

function getPublicationLatestMessage(publication: ChannelPublication): string | null {
  if (publication.lastError?.trim()) {
    return publication.lastError.trim();
  }
  const latestImportantEvent = [...publication.events]
    .reverse()
    .find((event) => event.level === "error" || event.level === "warn");
  if (latestImportantEvent?.message.trim()) {
    return latestImportantEvent.message.trim();
  }
  const latestEvent = publication.events[publication.events.length - 1];
  return latestEvent?.message.trim() || null;
}

export function buildPublicationUiStatus(publication: ChannelPublication): PublicationUiStatus {
  const latestMessage = getPublicationLatestMessage(publication);
  const needsReviewNote = publication.needsReview
    ? "Перед публикацией стоит проверить заголовок, описание или время."
    : null;

  switch (publication.status) {
    case "uploading":
      return {
        label: "Идет загрузка в YouTube",
        tone: "running",
        note: "Пока загрузка не завершится, опасные действия временно заблокированы.",
        recommendedAction: "Дождитесь завершения загрузки.",
        latestMessage,
        attention: false
      };
    case "failed":
      return {
        label: "Нужна проверка",
        tone: "error",
        note: latestMessage,
        recommendedAction: "Проверьте сообщение и повторите публикацию.",
        latestMessage,
        attention: true
      };
    case "paused":
      return {
        label: "Публикация на паузе",
        tone: "paused",
        note: latestMessage ?? "Ролик временно снят с активной очереди.",
        recommendedAction: "Возобновите публикацию, когда будете готовы.",
        latestMessage,
        attention: true
      };
    case "scheduled":
      return {
        label: "Запланировано в YouTube",
        tone: "scheduled",
        note: needsReviewNote ?? latestMessage,
        recommendedAction: publication.needsReview ? "Проверьте метаданные до публикации." : null,
        latestMessage,
        attention: publication.needsReview
      };
    case "published":
      return {
        label: "Уже опубликовано",
        tone: "published",
        note: latestMessage,
        recommendedAction: null,
        latestMessage,
        attention: false
      };
    case "canceled":
      return {
        label: "Удалено из очереди",
        tone: "muted",
        note: latestMessage ?? "Публикация больше не участвует в очереди.",
        recommendedAction: null,
        latestMessage,
        attention: false
      };
    case "queued":
    default:
      return {
        label: publication.needsReview ? "Ожидает проверки и публикации" : "Готово к публикации",
        tone: "queued",
        note:
          needsReviewNote ??
          latestMessage ??
          "Ролик стоит в очереди и будет загружен ближе к времени публикации.",
        recommendedAction: publication.needsReview ? "Проверьте публикацию перед выходом." : null,
        latestMessage,
        attention: publication.needsReview
      };
  }
}

function isPublicationActionNeeded(publication: ChannelPublication): boolean {
  return (
    publication.status === "failed" ||
    publication.status === "paused" ||
    publication.needsReview ||
    Boolean(publication.lastError)
  );
}

export function matchesPublicationWorkspaceFilter(
  publication: ChannelPublication,
  filter: PublicationWorkspaceFilter
): boolean {
  switch (filter) {
    case "attention":
      return isPublicationActionNeeded(publication);
    case "errors":
      return publication.status === "failed" || Boolean(publication.lastError);
    case "scheduled":
      return (
        publication.status === "queued" ||
        publication.status === "uploading" ||
        publication.status === "scheduled"
      );
    case "all":
    default:
      return true;
  }
}

export function getPublicationWorkspaceFilterCount(
  publications: ChannelPublication[],
  filter: PublicationWorkspaceFilter
): number {
  return publications.filter((publication) => matchesPublicationWorkspaceFilter(publication, filter)).length;
}

export function summarizePublicationDay(publications: ChannelPublication[]): string {
  const counts = new Map<string, number>();
  publications.forEach((publication) => {
    const key =
      publication.status === "failed"
        ? "ошибка"
        : publication.status === "uploading"
          ? "загрузка"
          : publication.status === "scheduled"
            ? "запланировано"
            : publication.status === "paused"
              ? "пауза"
              : publication.status === "published"
                ? "опубликовано"
                : "очередь";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });

  return Array.from(counts.entries())
    .slice(0, 3)
    .map(([label, count]) => `${count} ${label}`)
    .join(" · ");
}

export function buildPublicationInspectorDraft(
  publication: ChannelPublication,
  slotLabels: string[],
  timeZone: string
): PublicationInspectorDraft {
  const scheduledAtLocal = formatDateTimeLocalValue(publication.scheduledAt, timeZone);
  const displaySlotIndex = getPublicationDisplaySlotIndex(publication, slotLabels, timeZone);
  return {
    title: publication.title,
    description: publication.description,
    tags: publication.tags.join(", "),
    scheduleMode: publication.scheduleMode,
    scheduledAtLocal,
    slotDate: getPublicationDisplayDayKey(publication, timeZone),
    slotIndex:
      publication.scheduleMode === "slot"
        ? displaySlotIndex ?? publication.slotIndex ?? 0
        : findClosestSlotIndex(scheduledAtLocal.slice(11, 16), slotLabels),
    notifySubscribers: publication.notifySubscribers
  };
}

type PublicationSavePatch = Partial<{
  title: string;
  description: string;
  tags: string[];
  scheduleMode: ChannelPublicationScheduleMode;
  scheduledAtLocal: string;
  slotDate: string;
  slotIndex: number;
  notifySubscribers: boolean;
}>;

export function buildPublicationPatchFromDraft(draft: PublicationInspectorDraft): PublicationSavePatch {
  const patch: PublicationSavePatch = {
    title: draft.title,
    description: draft.description,
    tags: splitPublicationTags(draft.tags),
    scheduleMode: draft.scheduleMode,
    notifySubscribers: draft.notifySubscribers
  };
  if (draft.scheduleMode === "custom") {
    patch.scheduledAtLocal = draft.scheduledAtLocal;
  } else {
    patch.slotDate = draft.slotDate;
    patch.slotIndex = draft.slotIndex;
  }
  return patch;
}

function normalizeOptionalText(value: string | undefined): string {
  return value?.trim() ?? "";
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => item === right[index]);
}

export function isPublicationInspectorDirty(
  publication: ChannelPublication,
  draft: PublicationInspectorDraft,
  slotLabels: string[],
  timeZone: string
): boolean {
  if (normalizeOptionalText(publication.title) !== normalizeOptionalText(draft.title)) {
    return true;
  }
  if (normalizeOptionalText(publication.description) !== normalizeOptionalText(draft.description)) {
    return true;
  }
  if (!areStringArraysEqual(publication.tags, splitPublicationTags(draft.tags))) {
    return true;
  }
  if (publication.notifySubscribers !== draft.notifySubscribers) {
    return true;
  }
  if (publication.scheduleMode !== draft.scheduleMode) {
    return true;
  }

  if (draft.scheduleMode === "custom") {
    return formatDateTimeLocalValue(publication.scheduledAt, timeZone) !== draft.scheduledAtLocal;
  }

  const currentSlotIndex = getPublicationDisplaySlotIndex(publication, slotLabels, timeZone) ?? publication.slotIndex;
  return publication.slotDate !== draft.slotDate || currentSlotIndex !== draft.slotIndex;
}

export function shouldHydratePublicationInspectorDraft(input: {
  selectedPublicationId: string | null;
  draftPublicationId: string | null;
  hasDraft: boolean;
  isDirty: boolean;
}): boolean {
  if (!input.selectedPublicationId) {
    return false;
  }
  if (input.draftPublicationId !== input.selectedPublicationId) {
    return true;
  }
  if (!input.hasDraft) {
    return true;
  }
  return !input.isDirty;
}

export function resolvePublicationSelectionRequest(input: {
  currentSelectionId: string | null;
  nextSelectionId: string | null;
  isDirty: boolean;
}): "allow" | "prompt" | "ignore" {
  if (!input.nextSelectionId || input.nextSelectionId === input.currentSelectionId) {
    return "ignore";
  }
  return input.isDirty ? "prompt" : "allow";
}

export function selectPreferredPublicationId(input: {
  publications: ChannelPublication[];
  activeChatId: string | null;
  selectedPublicationId?: string | null;
  now?: number;
}): string | null {
  if (!input.publications.length) {
    return null;
  }
  if (
    input.selectedPublicationId &&
    input.publications.some((publication) => publication.id === input.selectedPublicationId)
  ) {
    return input.selectedPublicationId;
  }

  const sorted = [...input.publications].sort(
    (left, right) => new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime()
  );

  if (input.activeChatId) {
    const activeChatPublication = sorted.find((publication) => publication.chatId === input.activeChatId);
    if (activeChatPublication) {
      return activeChatPublication.id;
    }
  }

  const now = input.now ?? Date.now();
  const futurePublication = sorted.find(
    (publication) =>
      publication.status !== "published" &&
      publication.status !== "canceled" &&
      new Date(publication.scheduledAt).getTime() >= now
  );
  if (futurePublication) {
    return futurePublication.id;
  }

  return sorted[0]?.id ?? null;
}

type PublicationMergeInput =
  | ChannelPublication
  | {
      publication: ChannelPublication;
      swappedPublication?: ChannelPublication | null;
    };

export function mergePublicationMutationResult(
  publications: ChannelPublication[],
  input: PublicationMergeInput
): ChannelPublication[] {
  const updates =
    "publication" in input
      ? [input.publication, ...(input.swappedPublication ? [input.swappedPublication] : [])]
      : [input];
  const updatesById = new Map(updates.map((publication) => [publication.id, publication]));
  const next = publications.map((publication) => updatesById.get(publication.id) ?? publication);
  updates.forEach((publication) => {
    if (!next.some((item) => item.id === publication.id)) {
      next.push(publication);
    }
  });
  return next;
}

export function mapPublicationMutationPayloadToFieldErrors(
  payload: PublicationMutationErrorPayload | null
): PublicationFieldErrors {
  if (!payload) {
    return {};
  }
  if (payload.field) {
    return {
      [payload.field]: payload.error
    };
  }
  return {
    form: payload.error
  };
}
