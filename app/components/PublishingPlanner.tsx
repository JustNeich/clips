"use client";

import { useMemo, useState, type DragEvent } from "react";
import type { ChannelPublication, ChannelPublishIntegration, ChannelPublishSettings } from "./types";

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
      slotDate: string;
      slotIndex: number;
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
    uploadLeadMinutes: 120
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

function sortPublicationsForPlanner(
  publications: ChannelPublication[],
  todayKey: string
): ChannelPublication[] {
  return [...publications].sort((left, right) => {
    const leftFuture = left.slotDate >= todayKey;
    const rightFuture = right.slotDate >= todayKey;
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

function buildPublicationDayGroups(
  publications: ChannelPublication[],
  timeZone: string
): PublicationDayGroup[] {
  const todayKey = formatDateKey(new Date(), timeZone);
  const groups = new Map<string, PublicationDayGroup>();

  sortPublicationsForPlanner(publications, todayKey).forEach((publication) => {
    const existing = groups.get(publication.slotDate);
    if (existing) {
      existing.items.push(publication);
      return;
    }
    groups.set(publication.slotDate, {
      id: publication.slotDate,
      label: formatSlotDateLabel(publication.slotDate, timeZone),
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
    slotDate: string;
    slotIndex: number;
  } | null>(null);

  const timeZone = settings?.timezone ?? "Europe/Moscow";
  const slotLabels = useMemo(() => buildSlotLabels(settings), [settings]);
  const dayGroups = useMemo(
    () => buildPublicationDayGroups(publications, timeZone),
    [publications, timeZone]
  );

  const startEdit = (publication: ChannelPublication) => {
    setExpandedId(publication.id);
    setEditingId(publication.id);
    setDraft({
      title: publication.title,
      description: publication.description,
      tags: publication.tags.join(", "),
      slotDate: publication.slotDate,
      slotIndex: publication.slotIndex
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
      await onSavePublication(publicationId, {
        title: draft.title,
        description: draft.description,
        tags: splitTags(draft.tags),
        slotDate: draft.slotDate,
        slotIndex: draft.slotIndex
      });
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
    const isMovable =
      publication.status !== "published" &&
      publication.status !== "canceled";
    const isDragging = dragState?.publicationId === publication.id;
    const isDropTarget =
      dropTarget?.slotDate === publication.slotDate &&
      dropTarget.slotIndex === publication.slotIndex;
    const slotLabel =
      slotLabels[publication.slotIndex] ?? formatScheduledTime(publication.scheduledAt, timeZone);
    const compactDescription = publication.description.trim();

    return (
      <article
        key={publication.id}
        className={`publishing-card status-${statusTone} ${activeChatId === publication.chatId ? "active-chat" : ""} ${isDragging ? "is-dragging" : ""} ${isDropTarget ? "is-drop-target" : ""}`}
        onDragOver={(event) =>
          handleSlotDragOver(event, publication.slotDate, publication.slotIndex, publication)
        }
        onDrop={(event) =>
          void handleSlotDrop(event, publication.slotDate, publication.slotIndex, publication)
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
                title={isMovable ? "Перетащите в другой слот внутри этого дня" : undefined}
              >
                {slotLabel}
              </span>
              <span className={`publishing-status-pill tone-${statusTone}`}>
                {formatPublicationStatus(publication.status)}
              </span>
              {publication.needsReview ? (
                <span className="publishing-status-pill tone-muted">Нужна проверка</span>
              ) : null}
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
              {isExpanded ? "Скрыть" : "Show more"}
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
            <div className="compact-grid publishing-edit-grid">
              <label className="field-stack">
                <span className="field-label">Дата</span>
                <input
                  className="text-input"
                  type="date"
                  value={draft.slotDate}
                  onChange={(event) =>
                    setDraft((current) =>
                      current ? { ...current, slotDate: event.target.value } : current
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
                    setDraft((current) =>
                      current
                        ? {
                            ...current,
                            slotIndex: Number.parseInt(event.target.value || "0", 10)
                          }
                        : current
                    )
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
                Retry
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
                Publish now
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
          <p className="kicker">Publishing</p>
          <h3>{channelName ? `План публикаций для ${channelName}` : "План публикаций"}</h3>
          <p className="subtle-text">
            Дни и слоты считаются по {timeZone}. Карточки можно перетаскивать между
            слотами внутри дня, а кнопки быстрых переносов остаются резервным способом.
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
            const itemsBySlot = new Map(group.items.map((item) => [item.slotIndex, item]));
            return (
              <section key={group.id} className="publishing-day-group">
                <div className="publishing-day-head">
                  <div>
                    <h4>{group.label}</h4>
                    <p className="subtle-text">
                      {group.items.length} ролик{group.items.length === 1 ? "" : group.items.length < 5 ? "а" : "ов"}
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
