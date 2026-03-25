"use client";

import { useMemo, useState } from "react";
import type { ChannelPublication, ChannelPublishIntegration, ChannelPublishSettings } from "./types";

type PublicationAction = "pause" | "resume" | "retry" | "publish-now" | "delete";

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
  onOpenPublishingSettings: () => void;
};

function formatSlotTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDateKey(value: Date): string {
  return value.toLocaleDateString("en-CA", {
    timeZone: "Europe/Moscow"
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
      return "В очереди";
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

function splitTags(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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
  onOpenPublishingSettings
}: PublishingPlannerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    title: string;
    description: string;
    tags: string;
    slotDate: string;
    slotIndex: number;
  } | null>(null);

  const slotLabels = useMemo(() => buildSlotLabels(settings), [settings]);
  const todayKey = formatDateKey(new Date());
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = formatDateKey(tomorrow);
  const grouped = useMemo(
    () => ({
      today: publications.filter((item) => item.slotDate === todayKey),
      tomorrow: publications.filter((item) => item.slotDate === tomorrowKey),
      later: publications.filter((item) => item.slotDate !== todayKey && item.slotDate !== tomorrowKey)
    }),
    [publications, todayKey, tomorrowKey]
  );

  const startEdit = (publication: ChannelPublication) => {
    setEditingId(publication.id);
    setDraft({
      title: publication.title,
      description: publication.description,
      tags: publication.tags.join(", "),
      slotDate: publication.slotDate,
      slotIndex: publication.slotIndex
    });
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
      setEditingId(null);
      setDraft(null);
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

  const renderPublicationCard = (publication: ChannelPublication) => {
    const isEditing = editingId === publication.id && draft;
    return (
      <article
        key={publication.id}
        className={`publishing-card ${activeChatId === publication.chatId ? "active-chat" : ""}`}
      >
        <div className="publishing-card-head">
          <div>
            <div className="publishing-card-title-row">
              <strong>{publication.chatTitle || publication.title}</strong>
              {publication.needsReview ? <span className="badge muted">needs review</span> : null}
              {activeChatId === publication.chatId ? <span className="badge">текущий чат</span> : null}
            </div>
            <p className="subtle-text">
              {formatSlotTime(publication.scheduledAt)} · {formatPublicationStatus(publication.status)}
            </p>
          </div>
          <div className="publishing-card-links">
            {publication.youtubeVideoUrl ? (
              <a href={publication.youtubeVideoUrl} target="_blank" rel="noreferrer" className="btn btn-ghost">
                YouTube
              </a>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => (isEditing ? (setEditingId(null), setDraft(null)) : startEdit(publication))}
            >
              {isEditing ? "Свернуть" : "Редактировать"}
            </button>
          </div>
        </div>

        {!isEditing ? (
          <>
            <p className="publishing-card-primary-line">{publication.title}</p>
            {publication.description ? <p className="subtle-text publishing-card-description">{publication.description}</p> : null}
            {publication.tags.length > 0 ? (
              <div className="publishing-tag-row">
                {publication.tags.map((tag) => (
                  <span key={`${publication.id}:${tag}`} className="meta-pill">
                    #{tag}
                  </span>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <div className="field-stack publishing-edit-form">
            <label className="field-stack">
              <span className="field-label">Title</span>
              <input
                className="text-input"
                value={draft.title}
                onChange={(event) => setDraft((current) => current ? { ...current, title: event.target.value } : current)}
              />
            </label>
            <label className="field-stack">
              <span className="field-label">Description</span>
              <textarea
                className="text-area"
                rows={5}
                value={draft.description}
                onChange={(event) => setDraft((current) => current ? { ...current, description: event.target.value } : current)}
              />
            </label>
            <label className="field-stack">
              <span className="field-label">Tags</span>
              <input
                className="text-input"
                value={draft.tags}
                onChange={(event) => setDraft((current) => current ? { ...current, tags: event.target.value } : current)}
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
                  onChange={(event) => setDraft((current) => current ? { ...current, slotDate: event.target.value } : current)}
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
                        ? { ...current, slotIndex: Number.parseInt(event.target.value || "0", 10) }
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
            </div>
          </div>
        )}

        <div className="control-actions publishing-card-actions">
          {publication.status === "paused" ? (
            <button type="button" className="btn btn-secondary" disabled={busyKey === `resume:${publication.id}`} onClick={() => void runAction(publication.id, "resume")}>
              Возобновить
            </button>
          ) : publication.status !== "published" ? (
            <button type="button" className="btn btn-ghost" disabled={busyKey === `pause:${publication.id}`} onClick={() => void runAction(publication.id, "pause")}>
              Пауза
            </button>
          ) : null}
          {publication.status === "failed" ? (
            <button type="button" className="btn btn-secondary" disabled={busyKey === `retry:${publication.id}`} onClick={() => void runAction(publication.id, "retry")}>
              Retry
            </button>
          ) : null}
          {publication.status !== "published" && publication.status !== "canceled" ? (
            <button type="button" className="btn btn-secondary" disabled={busyKey === `publish-now:${publication.id}`} onClick={() => void runAction(publication.id, "publish-now")}>
              Publish now
            </button>
          ) : null}
          {publication.status !== "published" ? (
            <button type="button" className="btn btn-ghost" disabled={busyKey === `delete:${publication.id}`} onClick={() => void runAction(publication.id, "delete")}>
              Удалить
            </button>
          ) : null}
        </div>

        {publication.lastError ? <p className="danger-text subtle-text">{publication.lastError}</p> : null}
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
            Слоты считаются по {settings?.timezone ?? "Europe/Moscow"} и автоматически забирают новые render-экспорты.
          </p>
        </div>
        <div className="control-actions">
          <button type="button" className="btn btn-secondary" onClick={onOpenPublishingSettings}>
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

      <div className="publishing-slot-summary">
        {slotLabels.map((slot) => (
          <span key={slot} className="meta-pill">
            {slot}
          </span>
        ))}
      </div>

      {grouped.today.length > 0 ? (
        <div className="publishing-group">
          <h4>Сегодня</h4>
          <div className="publishing-card-list">{grouped.today.map(renderPublicationCard)}</div>
        </div>
      ) : null}

      {grouped.tomorrow.length > 0 ? (
        <div className="publishing-group">
          <h4>Завтра</h4>
          <div className="publishing-card-list">{grouped.tomorrow.map(renderPublicationCard)}</div>
        </div>
      ) : null}

      {grouped.later.length > 0 ? (
        <div className="publishing-group">
          <h4>Позже</h4>
          <div className="publishing-card-list">{grouped.later.map(renderPublicationCard)}</div>
        </div>
      ) : null}

      {!loading && publications.length === 0 ? (
        <div className="publishing-empty-state">
          <p>Пока нет queued видео. После первого успешного render они появятся здесь автоматически.</p>
        </div>
      ) : null}
    </section>
  );
}
