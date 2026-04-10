import type { ChatListItem, ChatWorkflowStatus } from "./types";

export type HistoryFilter = "all" | "working" | "archive" | "error";

export type HistorySection = {
  id: string;
  title: string;
  items: ChatListItem[];
};

export type HistoryProgressBadgeTone = "neutral" | "available" | "running" | "ready";

export type HistoryProgressBadge = {
  label: string;
  tone: HistoryProgressBadgeTone;
};

export type HistoryDayGroup = {
  id: string;
  label: string;
  items: ChatListItem[];
};

export type BuildHistorySectionsInput = {
  allItems: ChatListItem[];
  visibleItems: ChatListItem[];
  activeHistoryId: string | null;
  recentHistoryIds: string[];
  filter: HistoryFilter;
  recentLimit?: number;
};

const WORKING_STATUSES = new Set<ChatWorkflowStatus>([
  "new",
  "sourceReady",
  "stage2Ready",
  "editing",
  "agentRunning"
]);

function getHistoryTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function getHistoryGroupingValue(item: ChatListItem): string {
  return item.publication?.scheduledAt ?? item.updatedAt;
}

export function isWorkingHistoryStatus(status: ChatWorkflowStatus): boolean {
  return WORKING_STATUSES.has(status);
}

export function compareHistoryItemsByMeaningfulUpdate(left: ChatListItem, right: ChatListItem): number {
  const timestampDelta = getHistoryTimestamp(right.updatedAt) - getHistoryTimestamp(left.updatedAt);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }
  return left.id.localeCompare(right.id);
}

export function sortHistoryItemsByMeaningfulUpdate(items: ChatListItem[]): ChatListItem[] {
  return [...items].sort(compareHistoryItemsByMeaningfulUpdate);
}

export function compareHistoryItemsByPublishingMoment(left: ChatListItem, right: ChatListItem): number {
  const timestampDelta =
    getHistoryTimestamp(getHistoryGroupingValue(right)) -
    getHistoryTimestamp(getHistoryGroupingValue(left));
  if (timestampDelta !== 0) {
    return timestampDelta;
  }
  return compareHistoryItemsByMeaningfulUpdate(left, right);
}

export function sortHistoryItemsByPublishingMoment(items: ChatListItem[]): ChatListItem[] {
  return [...items].sort(compareHistoryItemsByPublishingMoment);
}

function buildHistoryDayKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return `unknown:${value}`;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatHistoryDayLabel(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Без даты";
  }

  const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const currentDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayDelta = Math.round((currentDay.getTime() - targetDay.getTime()) / 86_400_000);

  if (dayDelta === 0) {
    return "Сегодня";
  }
  if (dayDelta === 1) {
    return "Вчера";
  }

  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {})
  });
}

export function groupHistoryItemsByDay(items: ChatListItem[], now = new Date()): HistoryDayGroup[] {
  const groups = new Map<string, HistoryDayGroup>();

  sortHistoryItemsByPublishingMoment(items).forEach((item) => {
    const groupingValue = getHistoryGroupingValue(item);
    const key = buildHistoryDayKey(groupingValue);
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
      return;
    }
    groups.set(key, {
      id: key,
      label: formatHistoryDayLabel(groupingValue, now),
      items: [item]
    });
  });

  return Array.from(groups.values());
}

export function upsertHistoryItemByMeaningfulUpdate(
  items: ChatListItem[],
  nextItem: ChatListItem
): ChatListItem[] {
  const without = items.filter((item) => item.id !== nextItem.id);
  return sortHistoryItemsByMeaningfulUpdate([...without, nextItem]);
}

export function matchesHistoryFilter(item: ChatListItem, filter: HistoryFilter): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "working") {
    return isWorkingHistoryStatus(item.status);
  }
  if (filter === "error") {
    return item.status === "error";
  }
  return !isWorkingHistoryStatus(item.status);
}

export function getHistoryProgressBadge(item: ChatListItem): HistoryProgressBadge {
  if (item.liveAction === "Rendering") {
    return {
      label: "Шаг 3: в процессе",
      tone: "running"
    };
  }

  if (item.liveAction === "Stage 2") {
    return {
      label: "Шаг 2: в процессе",
      tone: "running"
    };
  }

  if (item.maxStep >= 3) {
    return {
      label: "Опции готовы",
      tone: "ready"
    };
  }

  if (item.liveAction === "Fetching" || item.liveAction === "Retrying" || item.liveAction === "Comments") {
    return {
      label: "Шаг 1: в процессе",
      tone: "running"
    };
  }

  if (item.maxStep >= 2 || item.status === "sourceReady") {
    return {
      label: "Готов к шагу 2",
      tone: "available"
    };
  }

  return {
    label: "Новый чат",
    tone: "neutral"
  };
}

export function buildHistorySections({
  allItems,
  visibleItems,
  activeHistoryId,
  recentHistoryIds,
  filter,
  recentLimit = 4
}: BuildHistorySectionsInput): HistorySection[] {
  const sections: HistorySection[] = [];
  const activeItem = activeHistoryId ? allItems.find((item) => item.id === activeHistoryId) ?? null : null;
  const visibleById = new Map(visibleItems.map((item) => [item.id, item]));
  const consumedIds = new Set<string>();

  if (activeItem) {
    sections.push({
      id: "current",
      title: "Открыт сейчас",
      items: [activeItem]
    });
    consumedIds.add(activeItem.id);
  }

  const recentItems: ChatListItem[] = [];
  for (const id of recentHistoryIds) {
    if (recentItems.length >= recentLimit || consumedIds.has(id)) {
      continue;
    }
    const item = visibleById.get(id);
    if (!item) {
      continue;
    }
    recentItems.push(item);
    consumedIds.add(id);
  }

  if (recentItems.length > 0) {
    sections.push({
      id: "recent",
      title: "Недавно открывали",
      items: recentItems
    });
  }

  const remainder = sortHistoryItemsByMeaningfulUpdate(
    visibleItems.filter((item) => !consumedIds.has(item.id))
  );
  const working = remainder.filter((item) => isWorkingHistoryStatus(item.status));
  const archive = remainder.filter((item) => !isWorkingHistoryStatus(item.status));

  if (filter === "working") {
    if (working.length > 0) {
      sections.push({ id: "working", title: "В работе", items: working });
    }
    return sections;
  }

  if (filter === "error") {
    const errored = archive.filter((item) => item.status === "error");
    if (errored.length > 0) {
      sections.push({ id: "error", title: "С ошибкой", items: errored });
    }
    return sections;
  }

  if (working.length > 0) {
    sections.push({ id: "working", title: "В работе", items: working });
  }
  if (archive.length > 0) {
    sections.push({ id: "archive", title: "Архив", items: archive });
  }

  return sections;
}
