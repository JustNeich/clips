"use client";

import { useMemo, useState, type DragEvent } from "react";
import type {
  ChannelPublication,
  ChannelPublicationScheduleMode,
  ChannelPublishIntegration,
  ChannelPublishSettings
} from "./types";

type PublicationAction = "pause" | "resume" | "retry" | "publish-now" | "delete";
type PublicationShiftAxis = "slot" | "day";
type PublicationShiftDirection = "prev" | "next";
type PublicationMoveRequest =
  | {
      axis: PublicationShiftAxis;
      direction: PublicationShiftDirection;
    }
  | {
      slotDate: string;
      slotIndex: number;
    };

type PublishingPlannerProps = {
  channelName: string | null;
  settings: ChannelPublishSettings | null | undefined;
  integration: ChannelPublishIntegration | null | undefined;
  publications: ChannelPublication[];
  activeChatId: string | null;
  loading: boolean;
  onSavePublication: (
    publicationId: string,
    patch: Partial<{
      title: string;
      description: string;
      tags: string[];
      scheduleMode: ChannelPublicationScheduleMode;
      scheduledAtLocal: string;
      slotDate: string;
      slotIndex: number;
      notifySubscribers: boolean;
    }>
  ) => Promise<void>;
  onRunAction: (publicationId: string, action: PublicationAction) => Promise<void>;
  onShiftPublication: (
    publicationId: string,
    move: PublicationMoveRequest
  ) => Promise<void>;
  onOpenPublishingSettings: () => void;
};

type PublicationDayGroup = {
  id: string;
  label: string;
  items: ChannelPublication[];
};

type PublicationStatusTone =
  | "queued"
  | "running"
  | "scheduled"
  | "published"
  | "error"
  | "paused"
  | "muted";

type PublicationDragState = {
  publicationId: string;
  slotDate: string;
  slotIndex: number;
};

type PublicationDropTarget = {
  slotDate: string;
  slotIndex: number;
};

function formatDateKey(value: Date, timeZone: string): string {
  return value.toLocaleDateString("en-CA", { timeZone });
}

function formatScheduledTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatScheduledMoment(iso: string, timeZone: string): string {
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

function formatDateTimeLocalValue(iso: string, timeZone: string): string {
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

function buildLocalDateTimeValue(date: string, timeLabel: string): string {
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

function findClosestSlotIndex(timeLabel: string, slotLabels: string[]): number {
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

function formatSlotDateLabel(slotDate: string, timeZone: string, now = new Date()): string {
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

function buildSlotLabels(settings: ChannelPublishSettings | null | undefined): string[] {
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
    const hour = Math.floor(((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60) / 60);
    const minute = ((totalMinutes % 60) + 60) % 60;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  });
}

function formatPublicationStatus(status: ChannelPublication["status"]): string {
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

function getPublicationStatusTone(status: ChannelPublication["status"]): PublicationStatusTone {
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

function splitTags(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getPublicationMoveBusyKey(publicationId: string, move: PublicationMoveRequest): string {
  if ("axis" in move) {
    return `shift:${publicationId}:${move.axis}:${move.direction}`;
  }
  return `shift:${publicationId}:target:${move.slotDate}:${move.slotIndex}`;
}

function formatSubscriptionFeedLabel(notifySubscribers: boolean): string {
  return notifySubscribers ? "Фид подписок: вкл" : "Фид подписок: выкл";
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

export function PublishingPlanner({
  channelName,
  settings,
  integration,
  publications,
  activeChatId,
  loading,
  onSavePublication,
  onRunAction,
  onShiftPublication,
  onOpenPublishingSettings
}: PublishingPlannerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [dragState, setDragState] = useState<PublicationDragState | null>(null);
  const [dropTarget, setDropTarget] = useState<PublicationDropTarget | null>(null);
  const [draft, setDraft] = useState<{
    title: string;
    description: string;
    tags: string;
    scheduleMode: ChannelPublicationScheduleMode;
    scheduledAtLocal: string;
    slotDate: string;
    slotIndex: number;
    notifySubscribers: boolean;
  } | null>(null);

  const timeZone = settings?.timezone ?? "Europe/Moscow";
  const slotLabels = useMemo(() => buildSlotLabels(settings), [settings]);
  const dayGroups = useMemo(
    () => buildPublicationDayGroups(publications, timeZone),
    [publications, timeZone]
  );

  const startEdit = (publication: ChannelPublication) => {
    const scheduledAtLocal = formatDateTimeLocalValue(publication.scheduledAt, timeZone);
    const displaySlotIndex = getPublicationDisplaySlotIndex(publication, slotLabels, timeZone);
    setExpandedId(publication.id);
    setEditingId(publication.id);
    setDraft({
      title: publication.title,
      description: publication.description,
      tags: publication.tags.join(", "),
      scheduleMode: publication.scheduleMode,
      scheduledAtLocal,
      slotDate: getPublicationDisplayDayKey(publication, timeZone),
      slotIndex:
        publication.scheduleMode === "slot"
          ? (displaySlotIndex ?? 0)
          : findClosestSlotIndex(scheduledAtLocal.slice(11, 16), slotLabels),
      notifySubscribers: publication.notifySubscribers
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
  };

  const clearDragState = () => {
    setDragState(null);
    setDropTarget(null);
  };

  const saveEdit = async (publicationId: string) => {
    if (!draft) {
      return;
    }
    setBusyKey(`save:${publicationId}`);
    try {
      const patch: Partial<{
        title: string;
        description: string;
        tags: string[];
        scheduleMode: ChannelPublicationScheduleMode;
        scheduledAtLocal: string;
        slotDate: string;
        slotIndex: number;
        notifySubscribers: boolean;
      }> = {
        title: draft.title,
        description: draft.description,
        tags: splitTags(draft.tags),
        scheduleMode: draft.scheduleMode,
        notifySubscribers: draft.notifySubscribers
      };
      if (draft.scheduleMode === "custom") {
        patch.scheduledAtLocal = draft.scheduledAtLocal;
      } else {
        patch.slotDate = draft.slotDate;
        patch.slotIndex = draft.slotIndex;
      }
      await onSavePublication(publicationId, patch);
      cancelEdit();
    } finally {
      setBusyKey(null);
    }
  };

  const runAction = async (publicationId: string, action: PublicationAction) => {
    if (action === "delete" && !window.confirm("Удалить публикацию из очереди?")) {
      return;
    }
    setBusyKey(`${action}:${publicationId}`);
    try {
      await onRunAction(publicationId, action);
    } finally {
      setBusyKey(null);
    }
  };

  const runShift = async (
    publicationId: string,
    move: PublicationMoveRequest
  ) => {
    setBusyKey(getPublicationMoveBusyKey(publicationId, move));
    try {
      await onShiftPublication(publicationId, move);
    } finally {
      setBusyKey(null);
      clearDragState();
    }
  };

  const canDropIntoSlot = (
    targetSlotDate: string,
    targetSlotIndex: number,
    targetPublication: ChannelPublication | null
  ): boolean => {
    if (!dragState || busyKey !== null) {
      return false;
    }
    if (targetSlotIndex < 0 || dragState.slotIndex < 0) {
      return false;
    }
    if (dragState.slotDate !== targetSlotDate) {
      return false;
    }
    if (dragState.slotDate === targetSlotDate && dragState.slotIndex === targetSlotIndex) {
      return false;
    }
    if (
      targetPublication?.status === "published" ||
      targetPublication?.status === "canceled"
    ) {
      return false;
    }
    return true;
  };

  const markDropTarget = (slotDate: string, slotIndex: number) => {
    setDropTarget((current) =>
      current?.slotDate === slotDate && current.slotIndex === slotIndex
        ? current
        : { slotDate, slotIndex }
    );
  };

  const handlePublicationDragStart = (
    event: DragEvent<HTMLElement>,
    publication: ChannelPublication
  ) => {
    if (
      busyKey !== null ||
      editingId === publication.id ||
      publication.scheduleMode !== "slot" ||
      publication.status === "published" ||
      publication.status === "canceled"
    ) {
      event.preventDefault();
      return;
    }
    setDragState({
      publicationId: publication.id,
      slotDate: publication.slotDate,
      slotIndex: publication.slotIndex
    });
    setDropTarget(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", publication.id);
  };

  const handlePublicationDragEnd = () => {
    clearDragState();
  };

  const handleSlotDragOver = (
    event: DragEvent<HTMLElement>,
    slotDate: string,
    slotIndex: number,
    targetPublication: ChannelPublication | null
  ) => {
    if (!canDropIntoSlot(slotDate, slotIndex, targetPublication)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    markDropTarget(slotDate, slotIndex);
  };

  const handleSlotDrop = async (
    event: DragEvent<HTMLElement>,
    slotDate: string,
    slotIndex: number,
    targetPublication: ChannelPublication | null
  ) => {
    event.preventDefault();
    if (!dragState || !canDropIntoSlot(slotDate, slotIndex, targetPublication)) {
      clearDragState();
      return;
    }
    const publicationId = dragState.publicationId;
    await runShift(publicationId, {
      slotDate,
      slotIndex
    });
  };

  const renderPublicationCard = (publication: ChannelPublication) => {
    const isEditing = editingId === publication.id && draft;
    const isExpanded = expandedId === publication.id || Boolean(isEditing);
    const statusTone = getPublicationStatusTone(publication.status);
    const displayDayKey = getPublicationDisplayDayKey(publication, timeZone);
    const displaySlotIndex = getPublicationDisplaySlotIndex(publication, slotLabels, timeZone);
    const slotSynchronized = isPublicationSlotSynchronized(publication, slotLabels, timeZone);
    const isMovable =
      publication.scheduleMode === "slot" &&
      slotSynchronized &&
      publication.status !== "published" &&
      publication.status !== "canceled";
    const isDragging = dragState?.publicationId === publication.id;
    const isDropTarget =
      displaySlotIndex !== null &&
      dropTarget?.slotDate === displayDayKey &&
      dropTarget.slotIndex === displaySlotIndex;
    const slotLabel =
      publication.scheduleMode === "slot"
        ? (displaySlotIndex !== null
            ? slotLabels[displaySlotIndex]
            : formatScheduledTime(publication.scheduledAt, timeZone))
        : formatScheduledTime(publication.scheduledAt, timeZone);
    const compactDescription = publication.description.trim();
    const notifySubscribersLocked = Boolean(publication.youtubeVideoId);

    return (
      <article
        key={publication.id}
        className={`publishing-card status-${statusTone} ${activeChatId === publication.chatId ? "active-chat" : ""} ${isDragging ? "is-dragging" : ""} ${isDropTarget ? "is-drop-target" : ""}`}
        onDragOver={(event) =>
          displaySlotIndex === null
            ? undefined
            : handleSlotDragOver(event, displayDayKey, displaySlotIndex, publication)
        }
        onDrop={(event) =>
          displaySlotIndex === null
            ? undefined
            : void handleSlotDrop(event, displayDayKey, displaySlotIndex, publication)
        }
      >
        <div className="publishing-card-head">
          <div className="publishing-card-main">
            <div className="publishing-card-pill-row">
              <span
                className={`publishing-slot-pill ${isMovable && !isEditing && busyKey === null ? "is-draggable" : ""}`}
                draggable={isMovable && !isEditing && busyKey === null}
                onDragStart={(event) => handlePublicationDragStart(event, publication)}
                onDragEnd={handlePublicationDragEnd}
                title={
                  isMovable
                    ? "Перетащите в другой слот внутри этого дня"
                    : publication.scheduleMode === "custom"
                      ? "Точное время публикации"
                      : undefined
                }
              >
                {slotLabel}
              </span>
              <span className={`publishing-status-pill tone-${statusTone}`}>
                {formatPublicationStatus(publication.status)}
              </span>
              {publication.needsReview ? (
                <span className="publishing-status-pill tone-muted">Нужна проверка</span>
              ) : null}
              {publication.scheduleMode === "custom" ? (
                <span className="publishing-status-pill tone-muted">Кастомное время</span>
              ) : null}
              <span className="publishing-status-pill tone-muted">
                {formatSubscriptionFeedLabel(publication.notifySubscribers)}
              </span>
              {activeChatId === publication.chatId ? (
                <span className="publishing-status-pill tone-muted">Текущий чат</span>
              ) : null}
            </div>
            <strong className="publishing-card-chat-title">
              {publication.chatTitle || publication.title}
            </strong>
            {publication.title && publication.title !== publication.chatTitle ? (
              <p className="publishing-card-primary-line">{publication.title}</p>
            ) : null}
            <p className="subtle-text publishing-card-meta-line">
              {formatScheduledMoment(publication.scheduledAt, timeZone)}
            </p>
          </div>

          <div className="publishing-card-top-actions">
            {publication.youtubeVideoUrl ? (
              <a
                href={publication.youtubeVideoUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost"
              >
                YouTube
              </a>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                setExpandedId((current) => (current === publication.id ? null : publication.id))
              }
            >
              {isExpanded ? "Скрыть" : "Подробнее"}
            </button>
            {publication.status !== "published" ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() =>
                  isEditing ? cancelEdit() : startEdit(publication)
                }
              >
                {isEditing ? "Закрыть редактор" : "Редактировать"}
              </button>
            ) : null}
          </div>
        </div>

        {isExpanded && !isEditing ? (
          <div className="publishing-card-details">
            {compactDescription ? (
              <p className="publishing-card-description">{compactDescription}</p>
            ) : (
              <p className="subtle-text publishing-card-description">
                Описание пока пустое.
              </p>
            )}
            <p className="subtle-text">{formatSubscriptionFeedLabel(publication.notifySubscribers)}</p>
            {publication.scheduleMode === "custom" ? (
              <p className="subtle-text">
                Эта публикация идёт по точному времени и не участвует в слот-перестановках.
              </p>
            ) : !slotSynchronized ? (
              <p className="subtle-text">
                Эта слот-публикация больше не совпадает с текущей сеткой канала. Для переноса
                откройте редактор и сохраните новую дату или слот.
              </p>
            ) : null}
            {publication.tags.length > 0 ? (
              <div className="publishing-tag-row">
                {publication.tags.map((tag) => (
                  <span key={`${publication.id}:${tag}`} className="meta-pill">
                    #{tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {isEditing ? (
          <div className="field-stack publishing-edit-form">
            <label className="field-stack">
              <span className="field-label">Заголовок</span>
              <input
                className="text-input"
                value={draft.title}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, title: event.target.value } : current
                  )
                }
              />
            </label>
            <label className="field-stack">
              <span className="field-label">Описание</span>
              <textarea
                className="text-area"
                rows={4}
                value={draft.description}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, description: event.target.value } : current
                  )
                }
              />
            </label>
            <label className="field-stack">
              <span className="field-label">Теги</span>
              <input
                className="text-input"
                value={draft.tags}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, tags: event.target.value } : current
                  )
                }
                placeholder="tag1, tag2, tag3"
              />
            </label>
            <div className="field-stack">
              <span className="field-label">Режим публикации</span>
              <div className="publishing-schedule-mode" role="tablist" aria-label="Режим времени публикации">
                <button
                  type="button"
                  className={`btn ${draft.scheduleMode === "slot" ? "btn-primary" : "btn-ghost"}`}
                  onClick={() =>
                    setDraft((current) => {
                      if (!current) {
                        return current;
                      }
                      const nextSlotDate = current.scheduledAtLocal.slice(0, 10) || current.slotDate;
                      const nextSlotIndex = findClosestSlotIndex(
                        current.scheduledAtLocal.slice(11, 16),
                        slotLabels
                      );
                      return {
                        ...current,
                        scheduleMode: "slot",
                        slotDate: nextSlotDate,
                        slotIndex: nextSlotIndex
                      };
                    })
                  }
                >
                  По слотам
                </button>
                <button
                  type="button"
                  className={`btn ${draft.scheduleMode === "custom" ? "btn-primary" : "btn-ghost"}`}
                  onClick={() =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            scheduleMode: "custom",
                            scheduledAtLocal: buildLocalDateTimeValue(
                              current.slotDate,
                              slotLabels[current.slotIndex] ?? slotLabels[0] ?? "00:00"
                            )
                          }
                        : current
                    )
                  }
                >
                  Точное время
                </button>
              </div>
              <p className="subtle-text">
                Автопланировщик живёт по слотам, но любой ролик можно перевести на точную дату и время.
              </p>
            </div>
            {draft.scheduleMode === "slot" ? (
              <div className="compact-grid publishing-edit-grid">
                <label className="field-stack">
                  <span className="field-label">Дата</span>
                  <input
                    className="text-input"
                    type="date"
                    value={draft.slotDate}
                    onChange={(event) =>
                      setDraft((current) =>
                        current
                          ? {
                              ...current,
                              slotDate: event.target.value,
                              scheduledAtLocal: buildLocalDateTimeValue(
                                event.target.value,
                                slotLabels[current.slotIndex] ?? slotLabels[0] ?? "00:00"
                              )
                            }
                          : current
                      )
                    }
                  />
                </label>
                <label className="field-stack">
                  <span className="field-label">Слот</span>
                  <select
                    className="text-input"
                    value={draft.slotIndex}
                    onChange={(event) =>
                      setDraft((current) => {
                        if (!current) {
                          return current;
                        }
                        const nextSlotIndex = Number.parseInt(event.target.value || "0", 10);
                        return {
                          ...current,
                          slotIndex: nextSlotIndex,
                          scheduledAtLocal: buildLocalDateTimeValue(
                            current.slotDate,
                            slotLabels[nextSlotIndex] ?? slotLabels[0] ?? "00:00"
                          )
                        };
                      })
                    }
                  >
                    {slotLabels.map((label, index) => (
                      <option key={`${publication.id}:slot:${index}`} value={index}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : (
              <label className="field-stack">
                <span className="field-label">Дата и время ({timeZone})</span>
                <input
                  className="text-input"
                  type="datetime-local"
                  value={draft.scheduledAtLocal}
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            scheduledAtLocal: event.target.value,
                            slotDate: event.target.value.slice(0, 10) || current.slotDate
                          }
                        : current
                    )
                  }
                />
                <span className="subtle-text">
                  Сервер сохранит именно это локальное время канала и синхронизирует его с YouTube.
                </span>
              </label>
            )}
            <label className="field-label fragment-toggle publishing-manager-toggle">
              <input
                type="checkbox"
                checked={draft.notifySubscribers}
                disabled={notifySubscribersLocked}
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, notifySubscribers: event.target.checked } : current
                  )
                }
              />
              <span>Публиковать в фид подписок и уведомлять подписчиков</span>
            </label>
            <p className="subtle-text">
              {notifySubscribersLocked
                ? "После первой загрузки YouTube API уже не даёт надёжно поменять этот флаг. Для такого ролика правьте его вручную в Studio."
                : "Это значение будет применено при первой загрузке ролика в YouTube."}
            </p>
            <div className="control-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busyKey === `save:${publication.id}`}
                onClick={() => {
                  void saveEdit(publication.id);
                }}
              >
                Сохранить
              </button>
              <button type="button" className="btn btn-ghost" onClick={cancelEdit}>
                Отмена
              </button>
            </div>
          </div>
        ) : null}

        <div className="publishing-card-footer">
          {isMovable ? (
            <div className="publishing-quick-move-row">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busyKey === `shift:${publication.id}:slot:prev`}
                onClick={() => {
                  void runShift(publication.id, { axis: "slot", direction: "prev" });
                }}
              >
                - слот
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busyKey === `shift:${publication.id}:slot:next`}
                onClick={() => {
                  void runShift(publication.id, { axis: "slot", direction: "next" });
                }}
              >
                + слот
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busyKey === `shift:${publication.id}:day:prev`}
                onClick={() => {
                  void runShift(publication.id, { axis: "day", direction: "prev" });
                }}
              >
                - день
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busyKey === `shift:${publication.id}:day:next`}
                onClick={() => {
                  void runShift(publication.id, { axis: "day", direction: "next" });
                }}
              >
                + день
              </button>
            </div>
          ) : publication.scheduleMode === "custom" ? (
            <p className="subtle-text publishing-custom-hint">
              Точное время не двигается по слотам. Если нужно сдвинуть публикацию, откройте редактор.
            </p>
          ) : !slotSynchronized ? (
            <p className="subtle-text publishing-custom-hint">
              Сетка канала изменилась после постановки в очередь. Откройте редактор, чтобы
              перепривязать ролик к текущему дню или слоту.
            </p>
          ) : null}

          <div className="publishing-card-actions">
            {publication.status === "paused" ? (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busyKey === `resume:${publication.id}`}
                onClick={() => void runAction(publication.id, "resume")}
              >
                Возобновить
              </button>
            ) : publication.status !== "published" ? (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busyKey === `pause:${publication.id}`}
                onClick={() => void runAction(publication.id, "pause")}
              >
                Пауза
              </button>
            ) : null}
            {publication.status === "failed" ? (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busyKey === `retry:${publication.id}`}
                onClick={() => void runAction(publication.id, "retry")}
              >
                Повторить
              </button>
            ) : null}
            {publication.status !== "published" &&
            publication.status !== "canceled" ? (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busyKey === `publish-now:${publication.id}`}
                onClick={() => void runAction(publication.id, "publish-now")}
              >
                Опубликовать сейчас
              </button>
            ) : null}
            {publication.status !== "published" ? (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busyKey === `delete:${publication.id}`}
                onClick={() => void runAction(publication.id, "delete")}
              >
                Удалить
              </button>
            ) : null}
          </div>
        </div>

        {publication.lastError ? (
          <p className="danger-text subtle-text">{publication.lastError}</p>
        ) : null}
      </article>
    );
  };

  return (
    <section className="publishing-planner-panel">
      <div className="publishing-planner-head">
        <div>
          <p className="kicker">Публикация</p>
          <h3>{channelName ? `План публикаций для ${channelName}` : "План публикаций"}</h3>
          <p className="subtle-text">
            Автопланировщик использует слот-сетку по {timeZone}, но любую отдельную публикацию
            можно перевести на точное время. Карточки со слотами можно перетаскивать внутри дня,
            а кастомные публикации редактируются прямо в карточке.
          </p>
        </div>
        <div className="control-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onOpenPublishingSettings}
          >
            Настроить канал
          </button>
        </div>
      </div>

      {!integration || integration.status === "disconnected" ? (
        <div className="publishing-empty-state">
          <p>Сначала подключите YouTube в Channel Manager → Publishing.</p>
        </div>
      ) : null}

      {loading ? <p className="subtle-text">Загружаем очередь публикаций…</p> : null}

      {!loading && dayGroups.length > 0 ? (
        <div className="publishing-day-list">
          {dayGroups.map((group) => {
            const itemsBySlot = new Map(
              group.items
                .map((item) => {
                  const slotIndex = getPublicationDisplaySlotIndex(item, slotLabels, timeZone);
                  return slotIndex === null ? null : [slotIndex, item] as const;
                })
                .filter((entry): entry is readonly [number, ChannelPublication] => Boolean(entry))
            );
            const customCount = group.items.filter((item) => item.scheduleMode === "custom").length;
            const slotCount = group.items.length - customCount;
            return (
              <section key={group.id} className="publishing-day-group">
                <div className="publishing-day-head">
                  <div>
                    <h4>{group.label}</h4>
                    <p className="subtle-text">
                      {group.items.length} ролик{group.items.length === 1 ? "" : group.items.length < 5 ? "а" : "ов"}
                      {customCount > 0 ? ` · слоты ${slotCount}, точное время ${customCount}` : ""}
                    </p>
                  </div>
                  <div className="publishing-day-slots" aria-label={`Слоты на ${group.label}`}>
                    {slotLabels.map((label, slotIndex) => {
                      const slotItem = itemsBySlot.get(slotIndex) ?? null;
                      const isSlotDropTarget =
                        dropTarget?.slotDate === group.id && dropTarget.slotIndex === slotIndex;
                      return (
                        <span
                          key={`${group.id}:${label}`}
                          className={`publishing-day-slot ${slotItem ? `tone-${getPublicationStatusTone(slotItem.status)}` : "tone-empty"} ${isSlotDropTarget ? "is-drop-target" : ""}`}
                          onDragOver={(event) =>
                            handleSlotDragOver(event, group.id, slotIndex, slotItem)
                          }
                          onDrop={(event) =>
                            void handleSlotDrop(event, group.id, slotIndex, slotItem)
                          }
                          title={
                            slotItem
                              ? "Перетащите сюда, чтобы поменять ролики местами"
                              : "Перетащите сюда, чтобы занять этот слот"
                          }
                        >
                          {label}
                        </span>
                      );
                    })}
                  </div>
                </div>

                <div className="publishing-card-list">
                  {group.items.map(renderPublicationCard)}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}

      {!loading && publications.length === 0 ? (
        <div className="publishing-empty-state">
          <p>
            Пока нет queued видео. После первого успешного render они появятся здесь
            автоматически.
          </p>
        </div>
      ) : null}
    </section>
  );
}
