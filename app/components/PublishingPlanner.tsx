"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { isChannelPublishIntegrationReady } from "../../lib/channel-publish-state";
import {
  PublicationMutationError,
  type PublicationMutationErrorPayload
} from "../../lib/publication-mutation-errors";
import type {
  ChannelPublication,
  ChannelPublicationScheduleMode,
  ChannelPublishIntegration,
  ChannelPublishSettings
} from "./types";
import {
  buildLocalDateTimeValue,
  buildPublicationDayGroups,
  buildPublicationInspectorDraft,
  buildPublicationPatchFromDraft,
  buildPublicationUiStatus,
  buildSlotLabels,
  findClosestSlotIndex,
  formatPublicationStatus,
  formatScheduledMoment,
  formatScheduledTime,
  getPublicationDisplayDayKey,
  getPublicationDisplaySlotIndex,
  getPublicationStatusTone,
  getPublicationWorkspaceFilterCount,
  isPublicationInspectorDirty,
  isPublicationSlotSynchronized,
  mapPublicationMutationPayloadToFieldErrors,
  matchesPublicationWorkspaceFilter,
  resolvePublicationSelectionRequest,
  selectPreferredPublicationId,
  shouldHydratePublicationInspectorDraft,
  summarizePublicationDay,
  type PublicationDayGroup,
  type PublicationFieldErrors,
  type PublicationInspectorDraft,
  type PublicationUiStatus,
  type PublicationUiStatusTone,
  type PublicationWorkspaceFilter
} from "./publishing-workspace-support";

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
  ) => Promise<ChannelPublication>;
  onRunAction: (
    publicationId: string,
    action: PublicationAction
  ) => Promise<ChannelPublication>;
  onShiftPublication: (
    publicationId: string,
    move: PublicationMoveRequest
  ) => Promise<{
    publication: ChannelPublication;
    swappedPublication: ChannelPublication | null;
    mode: "moved" | "swapped";
  }>;
  onOpenPublishingSettings: () => void;
};

type PublicationDragState = {
  publicationId: string;
  slotDate: string;
  slotIndex: number;
};

type PublicationDropTarget = {
  slotDate: string;
  slotIndex: number;
};

type PendingSelectionGuard = {
  nextPublicationId: string;
};

const FILTER_LABELS: Array<{ id: PublicationWorkspaceFilter; label: string }> = [
  { id: "all", label: "Все" },
  { id: "attention", label: "Нужны действия" },
  { id: "errors", label: "Ошибки" },
  { id: "scheduled", label: "Запланированы" }
];

function getPublicationBusyPrefix(publicationId: string): string {
  return `publication:${publicationId}:`;
}

function buildPublicationBusyKey(publicationId: string, action: string): string {
  return `${getPublicationBusyPrefix(publicationId)}${action}`;
}

function getPublicationMoveBusyKey(publicationId: string, move: PublicationMoveRequest): string {
  if ("axis" in move) {
    return buildPublicationBusyKey(publicationId, `shift:${move.axis}:${move.direction}`);
  }
  return buildPublicationBusyKey(publicationId, `shift:target:${move.slotDate}:${move.slotIndex}`);
}

function formatSubscriptionFeedLabel(notifySubscribers: boolean): string {
  return notifySubscribers ? "Фид подписок: вкл" : "Фид подписок: выкл";
}

function shiftSlotDate(slotDate: string, deltaDays: number): string {
  const date = new Date(`${slotDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

function getMutationErrorPayload(error: unknown): PublicationMutationErrorPayload | null {
  if (error instanceof PublicationMutationError) {
    return {
      error: error.message,
      code: error.code,
      ...(error.field ? { field: error.field } : {})
    };
  }
  return null;
}

function getUiToneClass(tone: PublicationUiStatusTone): string {
  return tone === "running" ? "tone-running" : `tone-${tone}`;
}

function renderPublicationStatusChips(publication: ChannelPublication, uiStatus: PublicationUiStatus) {
  return (
    <>
      <span className={`publishing-status-pill ${getUiToneClass(uiStatus.tone)}`}>
        {uiStatus.label}
      </span>
      {publication.needsReview ? (
        <span className="publishing-status-pill tone-muted">Нужна проверка</span>
      ) : null}
      {publication.scheduleMode === "custom" ? (
        <span className="publishing-status-pill tone-muted">Точное время</span>
      ) : null}
    </>
  );
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
  const [selectedPublicationId, setSelectedPublicationId] = useState<string | null>(null);
  const [filter, setFilter] = useState<PublicationWorkspaceFilter>("all");
  const [draft, setDraft] = useState<PublicationInspectorDraft | null>(null);
  const [draftPublicationId, setDraftPublicationId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<PublicationFieldErrors>({});
  const [busyKeys, setBusyKeys] = useState<string[]>([]);
  const busyKeysRef = useRef(new Set<string>());
  const [dragState, setDragState] = useState<PublicationDragState | null>(null);
  const [dropTarget, setDropTarget] = useState<PublicationDropTarget | null>(null);
  const [isCompactLayout, setIsCompactLayout] = useState(false);
  const [isMobileInspectorOpen, setIsMobileInspectorOpen] = useState(false);
  const [pendingSelectionGuard, setPendingSelectionGuard] = useState<PendingSelectionGuard | null>(null);
  const [publishNowConfirmId, setPublishNowConfirmId] = useState<string | null>(null);

  const timeZone = settings?.timezone ?? "Europe/Moscow";
  const slotLabels = useMemo(() => buildSlotLabels(settings), [settings]);
  const isPublishingOffline =
    !integration ||
    integration.status === "disconnected" ||
    integration.status === "pending_selection" ||
    !isChannelPublishIntegrationReady(integration);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    const media = window.matchMedia("(max-width: 1024px)");
    const update = () => setIsCompactLayout(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!isCompactLayout) {
      setIsMobileInspectorOpen(false);
    }
  }, [isCompactLayout]);

  useEffect(() => {
    const nextId = selectPreferredPublicationId({
      publications,
      activeChatId,
      selectedPublicationId
    });
    if (nextId !== selectedPublicationId) {
      setSelectedPublicationId(nextId);
    }
  }, [activeChatId, publications, selectedPublicationId]);

  const publicationsById = useMemo(
    () => new Map(publications.map((publication) => [publication.id, publication])),
    [publications]
  );

  const selectedPublication = selectedPublicationId
    ? publicationsById.get(selectedPublicationId) ?? null
    : null;

  const draftDirty =
    Boolean(selectedPublication) &&
    Boolean(draft) &&
    draftPublicationId === selectedPublication?.id &&
    isPublicationInspectorDirty(selectedPublication!, draft!, slotLabels, timeZone);
  const draftRef = useRef<PublicationInspectorDraft | null>(null);
  const draftPublicationIdRef = useRef<string | null>(null);
  const draftDirtyRef = useRef(false);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    draftPublicationIdRef.current = draftPublicationId;
  }, [draftPublicationId]);

  useEffect(() => {
    draftDirtyRef.current = Boolean(draftDirty);
  }, [draftDirty]);

  useEffect(() => {
    if (!selectedPublication) {
      setDraft(null);
      setDraftPublicationId(null);
      setFieldErrors({});
      return;
    }

    const selectedChanged = draftPublicationIdRef.current !== selectedPublication.id;
    const shouldHydrateDraft = shouldHydratePublicationInspectorDraft({
      selectedPublicationId: selectedPublication.id,
      draftPublicationId: draftPublicationIdRef.current,
      hasDraft: Boolean(draftRef.current),
      isDirty: draftDirtyRef.current
    });
    if (shouldHydrateDraft) {
      setDraft(buildPublicationInspectorDraft(selectedPublication, slotLabels, timeZone));
      setDraftPublicationId(selectedPublication.id);
      if (selectedChanged || !draftDirtyRef.current) {
        setFieldErrors({});
      }
    }
  }, [selectedPublication, slotLabels, timeZone]);

  useEffect(() => {
    if (!publishNowConfirmId) {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => {
      setPublishNowConfirmId((current) => (current === publishNowConfirmId ? null : current));
    }, 5000);
    return () => window.clearTimeout(timeoutId);
  }, [publishNowConfirmId]);

  useEffect(() => {
    if (publishNowConfirmId && !publicationsById.has(publishNowConfirmId)) {
      setPublishNowConfirmId(null);
    }
  }, [publishNowConfirmId, publicationsById]);

  const filteredPublications = useMemo(
    () => publications.filter((publication) => matchesPublicationWorkspaceFilter(publication, filter)),
    [filter, publications]
  );
  const dayGroups = useMemo(
    () => buildPublicationDayGroups(filteredPublications, timeZone),
    [filteredPublications, timeZone]
  );

  const hasBusyKey = (key: string): boolean => busyKeysRef.current.has(key);

  const hasBusyPublication = (publicationId: string): boolean =>
    busyKeys.some((key) => key.startsWith(getPublicationBusyPrefix(publicationId)));

  const beginBusy = (key: string): boolean => {
    if (busyKeysRef.current.has(key)) {
      return false;
    }
    busyKeysRef.current.add(key);
    setBusyKeys(Array.from(busyKeysRef.current));
    return true;
  };

  const endBusy = (key: string): void => {
    if (!busyKeysRef.current.delete(key)) {
      return;
    }
    setBusyKeys(Array.from(busyKeysRef.current));
  };

  const clearDragState = (): void => {
    setDragState(null);
    setDropTarget(null);
  };

  const clearFieldErrorKeys = (...keys: Array<keyof PublicationFieldErrors>): void => {
    setFieldErrors((current) => {
      if (keys.length === 0) {
        return {};
      }
      const next = { ...current };
      keys.forEach((key) => {
        delete next[key];
      });
      return next;
    });
  };

  const handleMutationError = (error: unknown, publicationId?: string): void => {
    const payload = getMutationErrorPayload(error);
    const nextErrors = payload
      ? mapPublicationMutationPayloadToFieldErrors(payload)
      : {
          form: error instanceof Error ? error.message : "Не удалось обновить публикацию."
        };
    if (publicationId && publicationId !== selectedPublicationId) {
      return;
    }
    setFieldErrors(nextErrors);
  };

  const commitSelection = (nextPublicationId: string): void => {
    setSelectedPublicationId(nextPublicationId);
    if (isCompactLayout) {
      setIsMobileInspectorOpen(true);
    }
  };

  const requestPublicationSelection = (nextPublicationId: string): void => {
    const resolution = resolvePublicationSelectionRequest({
      currentSelectionId: selectedPublicationId,
      nextSelectionId: nextPublicationId,
      isDirty: Boolean(draftDirty)
    });

    if (resolution === "ignore") {
      if (isCompactLayout) {
        setIsMobileInspectorOpen(true);
      }
      return;
    }
    if (resolution === "prompt") {
      setPendingSelectionGuard({ nextPublicationId });
      return;
    }
    commitSelection(nextPublicationId);
  };

  const saveSelectedPublication = async (nextPublicationId?: string): Promise<boolean> => {
    if (!selectedPublication || !draft) {
      return false;
    }
    const busyKey = buildPublicationBusyKey(selectedPublication.id, "save");
    if (!beginBusy(busyKey)) {
      return false;
    }

    clearFieldErrorKeys("form", "scheduledAtLocal", "slot", "notifySubscribers", "title", "description", "tags");

    try {
      const updated = await onSavePublication(
        selectedPublication.id,
        buildPublicationPatchFromDraft(draft)
      );
      setDraft(buildPublicationInspectorDraft(updated, slotLabels, timeZone));
      setDraftPublicationId(updated.id);
      setFieldErrors({});
      if (nextPublicationId) {
        commitSelection(nextPublicationId);
      }
      return true;
    } catch (error) {
      handleMutationError(error, selectedPublication.id);
      return false;
    } finally {
      endBusy(busyKey);
      setPendingSelectionGuard(null);
    }
  };

  const resetDraft = (): void => {
    if (!selectedPublication) {
      return;
    }
    setDraft(buildPublicationInspectorDraft(selectedPublication, slotLabels, timeZone));
    setDraftPublicationId(selectedPublication.id);
    setFieldErrors({});
  };

  const runAction = async (
    publication: ChannelPublication,
    action: PublicationAction
  ): Promise<void> => {
    if (action === "publish-now") {
      if (publishNowConfirmId !== publication.id) {
        setPublishNowConfirmId(publication.id);
        return;
      }
      setPublishNowConfirmId(null);
    }
    if (action === "delete" && !window.confirm("Удалить публикацию из очереди?")) {
      return;
    }
    const busyKey = buildPublicationBusyKey(publication.id, `action:${action}`);
    if (!beginBusy(busyKey)) {
      return;
    }

    if (publication.id === selectedPublicationId) {
      clearFieldErrorKeys("form");
    }

    try {
      await onRunAction(publication.id, action);
      if (action === "publish-now") {
        setPublishNowConfirmId(null);
      }
      if (publication.id === selectedPublicationId && action !== "delete") {
        setFieldErrors({});
      }
    } catch (error) {
      if (action === "publish-now") {
        setPublishNowConfirmId(null);
      }
      handleMutationError(error, publication.id);
    } finally {
      endBusy(busyKey);
    }
  };

  const runShift = async (publication: ChannelPublication, move: PublicationMoveRequest): Promise<void> => {
    const busyKey = getPublicationMoveBusyKey(publication.id, move);
    if (!beginBusy(busyKey)) {
      return;
    }

    if (publication.id === selectedPublicationId) {
      clearFieldErrorKeys("form", "slot", "scheduledAtLocal");
    }

    try {
      await onShiftPublication(publication.id, move);
    } catch (error) {
      handleMutationError(error, publication.id);
    } finally {
      endBusy(busyKey);
      clearDragState();
    }
  };

  const canDropIntoSlot = (
    targetSlotDate: string,
    targetSlotIndex: number,
    targetPublication: ChannelPublication | null
  ): boolean => {
    if (!dragState) {
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
      targetPublication?.status === "uploading" ||
      targetPublication?.status === "published" ||
      targetPublication?.status === "canceled"
    ) {
      return false;
    }
    if (hasBusyPublication(dragState.publicationId)) {
      return false;
    }
    return true;
  };

  const handlePublicationDragStart = (
    event: DragEvent<HTMLElement>,
    publication: ChannelPublication
  ) => {
    const slotSynchronized = isPublicationSlotSynchronized(publication, slotLabels, timeZone);
    const isMovable =
      publication.scheduleMode === "slot" &&
      slotSynchronized &&
      publication.status !== "uploading" &&
      publication.status !== "published" &&
      publication.status !== "canceled" &&
      !hasBusyPublication(publication.id) &&
      !(selectedPublicationId === publication.id && draftDirty);

    if (!isMovable) {
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
    setDropTarget((current) =>
      current?.slotDate === slotDate && current.slotIndex === slotIndex
        ? current
        : { slotDate, slotIndex }
    );
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
    const draggedPublication = publicationsById.get(dragState.publicationId);
    if (!draggedPublication) {
      clearDragState();
      return;
    }
    await runShift(draggedPublication, { slotDate, slotIndex });
  };

  const mutateDraft = (
    updater: (current: PublicationInspectorDraft) => PublicationInspectorDraft,
    ...fieldsToClear: Array<keyof PublicationFieldErrors>
  ): void => {
    setDraft((current) => (current ? updater(current) : current));
    clearFieldErrorKeys("form", ...fieldsToClear);
  };

  const shiftDraft = (axis: PublicationShiftAxis, direction: PublicationShiftDirection): void => {
    mutateDraft((current) => {
      if (current.scheduleMode !== "slot") {
        return current;
      }

      const directionValue = direction === "next" ? 1 : -1;
      const lastSlotIndex = Math.max(0, slotLabels.length - 1);
      let nextSlotDate = current.slotDate;
      let nextSlotIndex = current.slotIndex;

      if (axis === "day") {
        nextSlotDate = shiftSlotDate(current.slotDate, directionValue);
      } else {
        nextSlotIndex = current.slotIndex + directionValue;
        if (nextSlotIndex < 0) {
          nextSlotDate = shiftSlotDate(current.slotDate, -1);
          nextSlotIndex = lastSlotIndex;
        } else if (nextSlotIndex > lastSlotIndex) {
          nextSlotDate = shiftSlotDate(current.slotDate, 1);
          nextSlotIndex = 0;
        }
      }

      return {
        ...current,
        slotDate: nextSlotDate,
        slotIndex: nextSlotIndex,
        scheduledAtLocal: buildLocalDateTimeValue(
          nextSlotDate,
          slotLabels[nextSlotIndex] ?? slotLabels[0] ?? "00:00"
        )
      };
    }, "slot", "scheduledAtLocal");
  };

  const renderActionButtons = (publication: ChannelPublication, compact = false) => {
    const publicationBusy = hasBusyPublication(publication.id);
    const blockForDirtySelected = selectedPublicationId === publication.id && draftDirty;
    const disabled = publicationBusy || blockForDirtySelected;
    const isUploading = publication.status === "uploading";

    const buttons: ReactNode[] = [];
    if (publication.youtubeVideoUrl) {
      buttons.push(
        <a
          key={`${publication.id}:youtube`}
          href={publication.youtubeVideoUrl}
          target="_blank"
          rel="noreferrer"
          className="btn btn-ghost"
          onClick={(event) => event.stopPropagation()}
        >
          YouTube
        </a>
      );
    }

    if (publication.status === "paused") {
      buttons.push(
        <button
          key={`${publication.id}:resume`}
          type="button"
          className="btn btn-secondary"
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            void runAction(publication, "resume");
          }}
        >
          Возобновить
        </button>
      );
    } else if (publication.status !== "published" && !isUploading) {
      buttons.push(
        <button
          key={`${publication.id}:pause`}
          type="button"
          className="btn btn-ghost"
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            void runAction(publication, "pause");
          }}
        >
          Пауза
        </button>
      );
    }

    if (publication.status === "failed") {
      buttons.push(
        <button
          key={`${publication.id}:retry`}
          type="button"
          className="btn btn-secondary"
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            void runAction(publication, "retry");
          }}
        >
          Повторить
        </button>
      );
    }

    if (publication.status !== "published" && publication.status !== "canceled" && !isUploading) {
      const isPublishNowConfirming = publishNowConfirmId === publication.id;
      buttons.push(
        <button
          key={`${publication.id}:publish-now`}
          type="button"
          className={`btn ${
            isPublishNowConfirming
              ? "btn-danger-soft publishing-action-confirm"
              : "btn-secondary"
          }`}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            void runAction(publication, "publish-now");
          }}
        >
          {isPublishNowConfirming ? "Подтвердить сейчас" : "Опубликовать сейчас"}
        </button>
      );
    }

    if (publication.status !== "published" && !isUploading) {
      buttons.push(
        <button
          key={`${publication.id}:delete`}
          type="button"
          className="btn btn-ghost"
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            void runAction(publication, "delete");
          }}
        >
          Удалить
        </button>
      );
    }

    return (
      <div className={`publishing-row-actions ${compact ? "compact" : ""}`}>
        {buttons}
      </div>
    );
  };

  const renderPublicationRow = (publication: ChannelPublication) => {
    const uiStatus = buildPublicationUiStatus(publication);
    const displayDayKey = getPublicationDisplayDayKey(publication, timeZone);
    const displaySlotIndex = getPublicationDisplaySlotIndex(publication, slotLabels, timeZone);
    const slotSynchronized = isPublicationSlotSynchronized(publication, slotLabels, timeZone);
    const isMovable =
      publication.scheduleMode === "slot" &&
      slotSynchronized &&
      publication.status !== "uploading" &&
      publication.status !== "published" &&
      publication.status !== "canceled" &&
      !hasBusyPublication(publication.id) &&
      !(selectedPublicationId === publication.id && draftDirty);
    const isDragging = dragState?.publicationId === publication.id;
    const isSelected = selectedPublicationId === publication.id;
    const slotLabel =
      publication.scheduleMode === "slot"
        ? displaySlotIndex !== null
          ? slotLabels[displaySlotIndex]
          : formatScheduledTime(publication.scheduledAt, timeZone)
        : formatScheduledTime(publication.scheduledAt, timeZone);
    const leadingMessage = uiStatus.note ?? formatSubscriptionFeedLabel(publication.notifySubscribers);

    return (
      <article
        key={publication.id}
        className={`publishing-queue-row ${isSelected ? "is-selected" : ""} ${isDragging ? "is-dragging" : ""}`}
        onClick={() => requestPublicationSelection(publication.id)}
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
        <div className="publishing-queue-row-main">
          <div className="publishing-queue-row-pill-row">
            <span
              className={`publishing-slot-pill ${isMovable ? "is-draggable" : ""}`}
              draggable={isMovable}
              onDragStart={(event) => handlePublicationDragStart(event, publication)}
              onDragEnd={clearDragState}
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
            {renderPublicationStatusChips(publication, uiStatus)}
            <span className="publishing-status-pill tone-muted">
              {formatSubscriptionFeedLabel(publication.notifySubscribers)}
            </span>
            {activeChatId === publication.chatId ? (
              <span className="publishing-status-pill tone-muted">Текущий чат</span>
            ) : null}
          </div>
          <strong className="publishing-row-title">{publication.chatTitle || publication.title}</strong>
          {publication.title && publication.title !== publication.chatTitle ? (
            <p className="publishing-row-subtitle">{publication.title}</p>
          ) : null}
          <p className="publishing-row-meta">
            {formatScheduledMoment(publication.scheduledAt, timeZone)}
          </p>
          <p className={`publishing-row-note ${uiStatus.attention ? "attention" : ""}`}>
            {leadingMessage}
          </p>
        </div>
        <div className="publishing-queue-row-side">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={(event) => {
              event.stopPropagation();
              requestPublicationSelection(publication.id);
            }}
          >
            {isSelected && !isCompactLayout ? "В инспекторе" : "Открыть"}
          </button>
          {renderActionButtons(publication, true)}
        </div>
      </article>
    );
  };

  const renderInspector = (publication: ChannelPublication, mobile: boolean) => {
    const uiStatus = buildPublicationUiStatus(publication);
    const publicationBusy = hasBusyPublication(publication.id);
    const notifySubscribersLocked = Boolean(publication.youtubeVideoId);
    const slotSynchronized = isPublicationSlotSynchronized(publication, slotLabels, timeZone);

    return (
      <div className={`publishing-inspector-card ${mobile ? "mobile" : ""}`} onClick={(event) => event.stopPropagation()}>
        <div className="publishing-inspector-head">
          <div className="publishing-inspector-title-block">
            <p className="kicker">Публикация</p>
            <h4>{publication.chatTitle || publication.title}</h4>
            {publication.title && publication.title !== publication.chatTitle ? (
              <p className="publishing-inspector-subtitle">{publication.title}</p>
            ) : null}
          </div>
          {mobile ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setIsMobileInspectorOpen(false)}
            >
              Закрыть
            </button>
          ) : null}
        </div>

        <section className="publishing-inspector-status">
          <div className="publishing-card-pill-row">
            {renderPublicationStatusChips(publication, uiStatus)}
            <span className="publishing-status-pill tone-muted">
              {formatSubscriptionFeedLabel(publication.notifySubscribers)}
            </span>
          </div>
          <p className="publishing-inspector-status-primary">{uiStatus.label}</p>
          <p className="publishing-inspector-status-note">
            {uiStatus.note ?? "Публикация готова к работе."}
          </p>
          {uiStatus.recommendedAction ? (
            <p className="publishing-inspector-status-recommendation">{uiStatus.recommendedAction}</p>
          ) : null}
        </section>

        <section className="details-section publishing-inspector-section">
          <div className="publishing-inspector-section-head">
            <h5>Время публикации</h5>
            <span className="subtle-text">{timeZone}</span>
          </div>
          <div className="publishing-schedule-mode" role="tablist" aria-label="Режим времени публикации">
            <button
              type="button"
              className={`btn ${draft?.scheduleMode === "slot" ? "btn-primary" : "btn-ghost"}`}
              disabled={publicationBusy || !draft}
              onClick={() => {
                mutateDraft((current) => {
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
                }, "slot", "scheduledAtLocal");
              }}
            >
              По слотам
            </button>
            <button
              type="button"
              className={`btn ${draft?.scheduleMode === "custom" ? "btn-primary" : "btn-ghost"}`}
              disabled={publicationBusy || !draft}
              onClick={() => {
                mutateDraft((current) => ({
                  ...current,
                  scheduleMode: "custom",
                  scheduledAtLocal: buildLocalDateTimeValue(
                    current.slotDate,
                    slotLabels[current.slotIndex] ?? slotLabels[0] ?? "00:00"
                  )
                }), "slot", "scheduledAtLocal");
              }}
            >
              Точное время
            </button>
          </div>
          <p className="subtle-text">
            Автопланировщик работает по слотам, но любой ролик можно перевести на точную дату и время.
          </p>
          {draft?.scheduleMode === "slot" ? (
            <>
              <div className="compact-grid publishing-edit-grid">
                <label className="field-stack">
                  <span className="field-label">Дата</span>
                  <input
                    className="text-input"
                    type="date"
                    value={draft.slotDate}
                    disabled={publicationBusy}
                    onChange={(event) =>
                      mutateDraft((current) => ({
                        ...current,
                        slotDate: event.target.value,
                        scheduledAtLocal: buildLocalDateTimeValue(
                          event.target.value,
                          slotLabels[current.slotIndex] ?? slotLabels[0] ?? "00:00"
                        )
                      }), "slot", "scheduledAtLocal")
                    }
                  />
                </label>
                <label className="field-stack">
                  <span className="field-label">Слот</span>
                  <select
                    className="text-input"
                    value={draft.slotIndex}
                    disabled={publicationBusy}
                    onChange={(event) =>
                      mutateDraft((current) => {
                        const nextSlotIndex = Number.parseInt(event.target.value || "0", 10);
                        return {
                          ...current,
                          slotIndex: nextSlotIndex,
                          scheduledAtLocal: buildLocalDateTimeValue(
                            current.slotDate,
                            slotLabels[nextSlotIndex] ?? slotLabels[0] ?? "00:00"
                          )
                        };
                      }, "slot", "scheduledAtLocal")
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
              {fieldErrors.slot ? <p className="danger-text subtle-text">{fieldErrors.slot}</p> : null}
              <div className="publishing-quick-move-row">
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={publicationBusy}
                  onClick={() => shiftDraft("slot", "prev")}
                >
                  - слот
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={publicationBusy}
                  onClick={() => shiftDraft("slot", "next")}
                >
                  + слот
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={publicationBusy}
                  onClick={() => shiftDraft("day", "prev")}
                >
                  - день
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={publicationBusy}
                  onClick={() => shiftDraft("day", "next")}
                >
                  + день
                </button>
              </div>
              {!slotSynchronized ? (
                <p className="subtle-text">
                  Текущий слот больше не совпадает с активной сеткой канала. Пересохраните дату или слот.
                </p>
              ) : null}
            </>
          ) : (
            <>
              <label className="field-stack">
                <span className="field-label">Дата и время ({timeZone})</span>
                <input
                  className="text-input"
                  type="datetime-local"
                  value={draft?.scheduledAtLocal ?? ""}
                  disabled={publicationBusy}
                  onChange={(event) =>
                    mutateDraft((current) => ({
                      ...current,
                      scheduledAtLocal: event.target.value,
                      slotDate: event.target.value.slice(0, 10) || current.slotDate
                    }), "scheduledAtLocal", "slot")
                  }
                />
              </label>
              {fieldErrors.scheduledAtLocal ? (
                <p className="danger-text subtle-text">{fieldErrors.scheduledAtLocal}</p>
              ) : null}
            </>
          )}
        </section>

        <section className="details-section publishing-inspector-section">
          <div className="publishing-inspector-section-head">
            <h5>Метаданные</h5>
            <span className="subtle-text">То, что увидит зритель</span>
          </div>
          <label className="field-stack">
            <span className="field-label">Заголовок</span>
            <input
              className="text-input"
              value={draft?.title ?? ""}
              disabled={publicationBusy}
              onChange={(event) =>
                mutateDraft((current) => ({ ...current, title: event.target.value }), "title")
              }
            />
            {fieldErrors.title ? <span className="danger-text subtle-text">{fieldErrors.title}</span> : null}
          </label>
          <label className="field-stack">
            <span className="field-label">Описание</span>
            <textarea
              className="text-area"
              rows={5}
              value={draft?.description ?? ""}
              disabled={publicationBusy}
              onChange={(event) =>
                mutateDraft((current) => ({ ...current, description: event.target.value }), "description")
              }
            />
            {fieldErrors.description ? (
              <span className="danger-text subtle-text">{fieldErrors.description}</span>
            ) : null}
          </label>
          <label className="field-stack">
            <span className="field-label">Теги</span>
            <input
              className="text-input"
              value={draft?.tags ?? ""}
              disabled={publicationBusy}
              onChange={(event) =>
                mutateDraft((current) => ({ ...current, tags: event.target.value }), "tags")
              }
              placeholder="tag1, tag2, tag3"
            />
            {fieldErrors.tags ? <span className="danger-text subtle-text">{fieldErrors.tags}</span> : null}
          </label>
        </section>

        <section className="details-section publishing-inspector-section">
          <div className="publishing-inspector-section-head">
            <h5>Доставка</h5>
            <span className="subtle-text">Что произойдет при первой загрузке</span>
          </div>
          <label className="field-label fragment-toggle publishing-manager-toggle">
            <input
              type="checkbox"
              checked={Boolean(draft?.notifySubscribers)}
              disabled={publicationBusy || notifySubscribersLocked}
              onChange={(event) =>
                mutateDraft((current) => ({
                  ...current,
                  notifySubscribers: event.target.checked
                }), "notifySubscribers")
              }
            />
            <span>Публиковать в фид подписок и уведомлять подписчиков</span>
          </label>
          {fieldErrors.notifySubscribers ? (
            <p className="danger-text subtle-text">{fieldErrors.notifySubscribers}</p>
          ) : null}
          <p className="subtle-text">
            {notifySubscribersLocked
              ? "После первой загрузки этот флаг уже нельзя надежно поменять через API. Если нужно, правьте его в YouTube Studio."
              : "Это значение будет применено при первой загрузке ролика в YouTube."}
          </p>
          <div className="publishing-card-pill-row">
            <span className="publishing-status-pill tone-muted">{publication.renderFileName}</span>
            {publication.youtubeVideoUrl ? (
              <a
                href={publication.youtubeVideoUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost"
              >
                Открыть в YouTube
              </a>
            ) : null}
          </div>
          {renderActionButtons(publication)}
        </section>

        <details className="details-drawer">
          <summary>
            <span>Диагностика</span>
            <small>только если нужен контекст по состоянию</small>
          </summary>
          <div className="details-content">
            {publication.events.length === 0 ? (
              <p className="subtle-text">Событий пока нет.</p>
            ) : (
              <ul className="publishing-diagnostics-list">
                {[...publication.events].reverse().map((event) => (
                  <li key={event.id} className={`publishing-diagnostics-item tone-${event.level}`}>
                    <div className="publishing-diagnostics-meta">
                      <span>{event.level.toUpperCase()}</span>
                      <time dateTime={event.createdAt}>{formatScheduledMoment(event.createdAt, timeZone)}</time>
                    </div>
                    <p>{event.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>

        <div className="publishing-inspector-footer">
          {fieldErrors.form ? <p className="danger-text subtle-text">{fieldErrors.form}</p> : null}
          <div className="control-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!draft || !draftDirty || publicationBusy || hasBusyKey(buildPublicationBusyKey(publication.id, "save"))}
              onClick={() => {
                void saveSelectedPublication();
              }}
            >
              Сохранить
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!draftDirty || publicationBusy}
              onClick={resetDraft}
            >
              Отменить
            </button>
          </div>
        </div>
      </div>
    );
  };

  const selectedInspector = selectedPublication ? renderInspector(selectedPublication, false) : null;

  return (
    <section className="publishing-planner-panel">
      <div className="publishing-planner-head">
        <div>
          <p className="kicker">Публикация</p>
          <h3>{channelName ? `Publishing workspace для ${channelName}` : "Publishing workspace"}</h3>
          <p className="subtle-text">
            Планировщик показывает очередь по дням, а все правки выбранной публикации живут в отдельном инспекторе справа.
          </p>
        </div>
        <div className="control-actions">
          <button type="button" className="btn btn-secondary" onClick={onOpenPublishingSettings}>
            Настроить канал
          </button>
          {isCompactLayout && selectedPublication ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setIsMobileInspectorOpen(true)}
            >
              Открыть публикацию
            </button>
          ) : null}
        </div>
      </div>

      {isPublishingOffline ? (
        <div className="publishing-empty-state">
          <p>Модуль публикации сейчас оффлайн. Подключите YouTube и выберите канал назначения в Channel Manager → Publishing.</p>
        </div>
      ) : null}

      {loading ? <p className="subtle-text">Загружаем очередь публикаций…</p> : null}

      {!loading && !isPublishingOffline && publications.length > 0 ? (
        <>
          <div className="publishing-workspace-toolbar">
            <div className="publishing-workspace-filters" role="tablist" aria-label="Фильтры очереди публикаций">
              {FILTER_LABELS.map((item) => {
                const count = getPublicationWorkspaceFilterCount(publications, item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`publishing-filter-pill ${filter === item.id ? "is-active" : ""}`}
                    onClick={() => setFilter(item.id)}
                  >
                    <span>{item.label}</span>
                    <small>{count}</small>
                  </button>
                );
              })}
            </div>
            {selectedPublication ? (
              <p className="subtle-text publishing-workspace-selection-note">
                Выбрано: {selectedPublication.chatTitle || selectedPublication.title}
              </p>
            ) : null}
          </div>

          <div className="publishing-workspace-grid">
            <div className="publishing-workspace-main">
              {dayGroups.length > 0 ? (
                <div className="publishing-day-list">
                  {dayGroups.map((group: PublicationDayGroup) => {
                    const itemsBySlot = new Map(
                      group.items
                        .map((item) => {
                          const slotIndex = getPublicationDisplaySlotIndex(item, slotLabels, timeZone);
                          return slotIndex === null ? null : [slotIndex, item] as const;
                        })
                        .filter((entry): entry is readonly [number, ChannelPublication] => Boolean(entry))
                    );

                    return (
                      <section key={group.id} className="publishing-day-group">
                        <div className="publishing-day-head">
                          <div>
                            <h4>{group.label}</h4>
                            <p className="subtle-text">
                              {group.items.length} ролик{group.items.length === 1 ? "" : group.items.length < 5 ? "а" : "ов"}
                              {group.items.length > 0 ? ` · ${summarizePublicationDay(group.items)}` : ""}
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
                                  className={`publishing-day-slot ${slotItem ? getUiToneClass(getPublicationStatusTone(slotItem.status)) : "tone-empty"} ${isSlotDropTarget ? "is-drop-target" : ""}`}
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
                        <div className="publishing-queue-list">
                          {group.items.map(renderPublicationRow)}
                        </div>
                      </section>
                    );
                  })}
                </div>
              ) : (
                <div className="publishing-empty-state">
                  <p>По текущему фильтру публикаций пока нет. Попробуйте переключить фильтр или выбрать другой день.</p>
                </div>
              )}
            </div>

            {!isCompactLayout ? (
              <aside className="publishing-workspace-inspector" aria-label="Инспектор публикации">
                {selectedInspector ?? (
                  <div className="publishing-empty-state">
                    <p>Выберите публикацию слева, чтобы отредактировать время, метаданные и действия.</p>
                  </div>
                )}
              </aside>
            ) : null}
          </div>
        </>
      ) : null}

      {!loading && !isPublishingOffline && publications.length === 0 ? (
        <div className="publishing-empty-state">
          <p>
            Пока нет queued видео. После первого успешного render и активного YouTube-подключения они появятся здесь автоматически.
          </p>
        </div>
      ) : null}

      {isCompactLayout && isMobileInspectorOpen && selectedPublication ? (
        <div
          className="publishing-inspector-drawer"
          onClick={() => setIsMobileInspectorOpen(false)}
        >
          <div className="publishing-inspector-drawer-backdrop" />
          <div className="publishing-inspector-drawer-sheet">
            {renderInspector(selectedPublication, true)}
          </div>
        </div>
      ) : null}

      {pendingSelectionGuard ? (
        <div className="publishing-guard-overlay" role="presentation">
          <div className="publishing-guard-dialog" role="dialog" aria-modal="true" aria-label="Несохраненные изменения">
            <h4>Есть несохраненные изменения</h4>
            <p className="subtle-text">
              Сохранить правки перед переходом к другой публикации?
            </p>
            <div className="control-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  void saveSelectedPublication(pendingSelectionGuard.nextPublicationId);
                }}
              >
                Сохранить и перейти
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setPendingSelectionGuard(null);
                  setFieldErrors({});
                  setDraft(null);
                  setDraftPublicationId(null);
                  commitSelection(pendingSelectionGuard.nextPublicationId);
                }}
              >
                Сбросить
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setPendingSelectionGuard(null)}
              >
                Остаться
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export {
  buildPublicationDayGroups,
  getPublicationDisplayDayKey,
  getPublicationDisplaySlotIndex,
  isPublicationSlotSynchronized
} from "./publishing-workspace-support";
