import type { ChannelPublication, ChannelPublicationScheduleMode, Stage2Response } from "../app/components/types";
import {
  buildCustomPublicationCandidateFromLocalDateTime,
  buildChannelPublicationMetadata,
  buildPublicationSlotCandidateFromDateAndIndex,
  pickNextPublicationSlot
} from "./channel-publishing";
import { isChannelPublishIntegrationReady } from "./channel-publish-state";
import {
  appendChannelPublicationEvent,
  assertNoBlockingPublicationDuplicate,
  buildBlockingPublicationDuplicateMessage,
  cancelChannelPublication,
  createChannelPublication,
  createRenderExport,
  ensureRenderExportArtifactAvailable,
  extendChannelPublicationLease,
  findLatestPublicationForChat,
  findBlockingPublicationDuplicate,
  findLatestPublicationForRenderExport,
  getChannelPublicationById,
  getChannelPublicationProcessingState,
  getChannelPublishIntegration,
  getChannelPublishSettings,
  getRenderExportById,
  getStoredChannelPublishCredential,
  listChannelPublications,
  listFutureActivePublicationsForChannel,
  markChannelPublicationFailed,
  markChannelPublishIntegrationReauthRequired,
  markChannelPublicationScheduled,
  persistChannelPublicationUploadSession,
  retryChannelPublication,
  type RenderExportRecord,
  type StoredYoutubeCredential,
  updateChannelPublicationDraft,
  updateChannelPublishIntegrationSelection,
  updateStoredChannelPublishCredential
} from "./publication-store";
import {
  deleteYouTubeVideo,
  isYoutubeAccessTokenExpired,
  listManagedYouTubeChannels,
  refreshYouTubeAccessToken,
  updateYouTubeScheduledVideo,
  uploadYouTubeVideo,
  YouTubePublishError
} from "./youtube-publishing";
import { tryAppendFlowAuditEvent } from "./audit-log-store";
import { runInTransaction } from "./db/client";
import {
  PublicationMutationError,
  type PublicationMutationErrorField
} from "./publication-mutation-errors";

type PublicationEditorPatch = Partial<{
  title: string;
  description: string;
  tags: string[];
  scheduleMode: ChannelPublicationScheduleMode;
  scheduledAtLocal: string;
  slotDate: string;
  slotIndex: number;
  notifySubscribers: boolean;
}>;

export type PublicationShiftAxis = "slot" | "day";
export type PublicationShiftDirection = "prev" | "next";
export type PublicationSlotTarget = {
  slotDate: string;
  slotIndex: number;
};

function normalizeEditorText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return value.trim();
}

function getScheduleFieldFromPatch(
  patch: PublicationEditorPatch
): PublicationMutationErrorField {
  return patch.scheduleMode === "custom" ? "scheduledAtLocal" : "slot";
}

function addDaysToSlotDate(slotDate: string, deltaDays: number): string {
  const date = new Date(`${slotDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new PublicationMutationError("Некорректная дата слота.", {
      code: "INVALID_SLOT_DATE",
      field: "slot"
    });
  }
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

function resolveShiftTargetSlot(input: {
  slotDate: string;
  slotIndex: number;
  settings: ReturnType<typeof getChannelPublishSettings>;
  axis: PublicationShiftAxis;
  direction: PublicationShiftDirection;
}): {
  slotDate: string;
  slotIndex: number;
} {
  const directionValue = input.direction === "next" ? 1 : -1;
  if (input.axis === "day") {
    return {
      slotDate: addDaysToSlotDate(input.slotDate, directionValue),
      slotIndex: input.slotIndex
    };
  }

  const lastSlotIndex = Math.max(0, input.settings.dailySlotCount - 1);
  let nextSlotDate = input.slotDate;
  let nextSlotIndex = input.slotIndex + directionValue;

  if (nextSlotIndex < 0) {
    nextSlotDate = addDaysToSlotDate(input.slotDate, -1);
    nextSlotIndex = lastSlotIndex;
  } else if (nextSlotIndex > lastSlotIndex) {
    nextSlotDate = addDaysToSlotDate(input.slotDate, 1);
    nextSlotIndex = 0;
  }

  return {
    slotDate: nextSlotDate,
    slotIndex: nextSlotIndex
  };
}

function assertPublicationCanMove(publication: ChannelPublication): void {
  if (publication.status === "uploading") {
    throw new PublicationMutationError("Публикацию нельзя переносить, пока ролик загружается в YouTube.", {
      code: "PUBLICATION_UPLOAD_IN_PROGRESS"
    });
  }
  if (publication.status === "published" || publication.status === "canceled") {
    throw new PublicationMutationError("Эту публикацию больше нельзя переносить по слотам.", {
      code: "PUBLICATION_MOVE_FORBIDDEN",
      field: "slot"
    });
  }
  if (publication.scheduleMode === "custom") {
    throw new PublicationMutationError("Кастомное время не переносится по слотам. Откройте редактор публикации.", {
      code: "PUBLICATION_MOVE_FORBIDDEN",
      field: "slot"
    });
  }
}

function assertSlotIndexInRange(slotIndex: number, dailySlotCount: number): void {
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= dailySlotCount) {
    throw new PublicationMutationError("Некорректный слот публикации.", {
      code: "INVALID_SLOT",
      field: "slot"
    });
  }
}

function findFuturePublicationTimeConflict(input: {
  channelId: string;
  excludePublicationId: string;
  scheduledAt: string;
  excludeMatchedPublicationId?: string | null;
}): ChannelPublication | null {
  return (
    listFutureActivePublicationsForChannel(input.channelId).find(
      (item) =>
        item.id !== input.excludePublicationId &&
        item.id !== input.excludeMatchedPublicationId &&
        item.status !== "canceled" &&
        item.scheduledAt === input.scheduledAt
    ) ?? null
  );
}

async function moveChannelPublicationIntoSlot(input: {
  publication: ChannelPublication;
  targetSlot: PublicationSlotTarget;
}): Promise<{
  publication: ChannelPublication;
  swappedPublication: ChannelPublication | null;
  mode: "moved" | "swapped";
}> {
  const current = input.publication;
  assertPublicationCanMove(current);

  const settings = getChannelPublishSettings(current.channelId);
  assertSlotIndexInRange(input.targetSlot.slotIndex, settings.dailySlotCount);

  if (
    current.slotDate === input.targetSlot.slotDate &&
    current.slotIndex === input.targetSlot.slotIndex
  ) {
    return {
      publication: current,
      swappedPublication: null,
      mode: "moved"
    };
  }

  const targetSchedule = buildPublicationSlotCandidateFromDateAndIndex({
    settings,
    slotDate: input.targetSlot.slotDate,
    slotIndex: input.targetSlot.slotIndex
  });

  if (new Date(targetSchedule.scheduledAt).getTime() <= Date.now()) {
    throw new PublicationMutationError("Нельзя перенести ролик в уже прошедший слот.", {
      code: "SLOT_IN_PAST",
      field: "slot"
    });
  }

  const conflicting = listChannelPublications(current.channelId).find(
    (item) =>
      item.id !== current.id &&
      item.status !== "canceled" &&
      item.slotDate === targetSchedule.slotDate &&
      item.slotIndex === targetSchedule.slotIndex
  );

  const timeConflict = findFuturePublicationTimeConflict({
    channelId: current.channelId,
    excludePublicationId: current.id,
    scheduledAt: targetSchedule.scheduledAt,
    excludeMatchedPublicationId: conflicting?.id ?? null
  });
  if (timeConflict) {
    throw new PublicationMutationError("Это время уже занято другой публикацией.", {
      code: "TIME_OCCUPIED",
      field: "slot"
    });
  }

  if (!conflicting) {
    const updated = updateChannelPublicationDraft({
      publicationId: current.id,
      scheduledAt: targetSchedule.scheduledAt,
      uploadReadyAt: targetSchedule.uploadReadyAt,
      slotDate: targetSchedule.slotDate,
      slotIndex: targetSchedule.slotIndex,
      scheduleManual: true,
      clearLastError: true
    });
    appendChannelPublicationEvent(
      updated.id,
      "info",
      `Слот обновлён: ${current.slotDate} #${current.slotIndex + 1} → ${targetSchedule.slotDate} #${targetSchedule.slotIndex + 1}.`
    );
    return {
      publication: await syncScheduledPublicationIfNeeded(updated.id),
      swappedPublication: null,
      mode: "moved"
    };
  }

  if (conflicting.status === "published") {
    throw new PublicationMutationError("Этот слот уже занят опубликованным роликом. Свап недоступен.", {
      code: "SLOT_OCCUPIED",
      field: "slot"
    });
  }
  if (conflicting.status === "uploading") {
    throw new PublicationMutationError("Этот слот занят роликом, который уже загружается в YouTube.", {
      code: "PUBLICATION_UPLOAD_IN_PROGRESS",
      field: "slot"
    });
  }

  const currentSchedule = buildPublicationSlotCandidateFromDateAndIndex({
    settings,
    slotDate: current.slotDate,
    slotIndex: current.slotIndex
  });

  runInTransaction(() => {
    updateChannelPublicationDraft({
      publicationId: current.id,
      scheduledAt: targetSchedule.scheduledAt,
      uploadReadyAt: targetSchedule.uploadReadyAt,
      slotDate: targetSchedule.slotDate,
      slotIndex: targetSchedule.slotIndex,
      scheduleManual: true,
      clearLastError: true
    });
    updateChannelPublicationDraft({
      publicationId: conflicting.id,
      scheduledAt: currentSchedule.scheduledAt,
      uploadReadyAt: currentSchedule.uploadReadyAt,
      slotDate: currentSchedule.slotDate,
      slotIndex: currentSchedule.slotIndex,
      scheduleManual: true,
      clearLastError: true
    });
  });

  const updatedCurrent = getChannelPublicationById(current.id);
  const updatedConflicting = getChannelPublicationById(conflicting.id);

  if (!updatedCurrent || !updatedConflicting) {
    throw new PublicationMutationError("Не удалось переставить публикации местами.", {
      code: "UNKNOWN"
    });
  }

  appendChannelPublicationEvent(
    updatedCurrent.id,
    "info",
    `Слот обменян с публикацией "${conflicting.chatTitle || conflicting.title}".`
  );
  appendChannelPublicationEvent(
    updatedConflicting.id,
    "info",
    `Слот обменян с публикацией "${current.chatTitle || current.title}".`
  );

  const syncedCurrent = await syncScheduledPublicationIfNeeded(updatedCurrent.id);
  const syncedConflicting = await syncScheduledPublicationIfNeeded(updatedConflicting.id);

  return {
    publication: syncedCurrent,
    swappedPublication: syncedConflicting,
    mode: "swapped"
  };
}

async function syncScheduledPublicationIfNeeded(publicationId: string): Promise<ChannelPublication> {
  const publication = getChannelPublicationById(publicationId);
  if (!publication) {
    throw new PublicationMutationError("Публикация не найдена.", {
      code: "PUBLICATION_NOT_FOUND",
      status: 404
    });
  }
  if (publication.status === "uploading") {
    throw new PublicationMutationError("Публикацию нельзя синхронизировать, пока ролик загружается в YouTube.", {
      code: "PUBLICATION_UPLOAD_IN_PROGRESS"
    });
  }
  if (publication.status === "scheduled" && publication.youtubeVideoId) {
    return syncScheduledPublicationToYouTube(publication.id);
  }
  return publication;
}

async function ensureFreshYouTubeCredential(channelId: string): Promise<{
  credential: StoredYoutubeCredential;
  integration: NonNullable<ReturnType<typeof getChannelPublishIntegration>>;
}> {
  const integration = getChannelPublishIntegration(channelId);
  if (!integration || integration.status !== "connected") {
    throw new YouTubePublishError("YouTube не подключён для этого канала.", {
      recoverable: false
    });
  }
  let credential = getStoredChannelPublishCredential(channelId);
  if (!credential) {
    throw new YouTubePublishError("Сервер не нашёл сохранённый YouTube refresh token.", {
      recoverable: false,
      reauthRequired: true
    });
  }

  if (isYoutubeAccessTokenExpired(credential)) {
    credential = await refreshYouTubeAccessToken(credential);
    updateStoredChannelPublishCredential(channelId, credential);
  }

  const availableChannels = await listManagedYouTubeChannels(credential.accessToken!);
  if (!integration.selectedYoutubeChannelId) {
    if (availableChannels.length === 1) {
      updateChannelPublishIntegrationSelection({
        channelId,
        selectedYoutubeChannelId: availableChannels[0]!.id,
        selectedYoutubeChannelTitle: availableChannels[0]!.title,
        selectedYoutubeChannelCustomUrl: availableChannels[0]!.customUrl
      });
    } else {
      throw new YouTubePublishError("Выберите целевой YouTube-канал перед публикацией.", {
        recoverable: false
      });
    }
  } else if (!availableChannels.some((item) => item.id === integration.selectedYoutubeChannelId)) {
    throw new YouTubePublishError("Подключённый YouTube identity больше не даёт доступ к выбранному каналу.", {
      recoverable: false,
      reauthRequired: true
    });
  }

  return {
    credential,
    integration: getChannelPublishIntegration(channelId)!
  };
}

function mergeQueuedPublicationDefaults(input: {
  current: ChannelPublication;
  renderExport: RenderExportRecord;
  defaults: ReturnType<typeof buildChannelPublicationMetadata>;
}): ChannelPublication {
  return updateChannelPublicationDraft({
    publicationId: input.current.id,
    renderExportId: input.renderExport.id,
    title: input.current.titleManual ? input.current.title : input.defaults.title,
    description: input.current.descriptionManual ? input.current.description : input.defaults.description,
    tags: input.current.tagsManual ? input.current.tags : input.defaults.tags,
    needsReview:
      input.current.titleManual || input.current.descriptionManual || input.current.tagsManual
        ? input.current.needsReview || input.defaults.needsReview
        : input.defaults.needsReview,
    clearLastError: true
  });
}

function buildPublishAfterRenderUnavailableMessage(
  integration: ReturnType<typeof getChannelPublishIntegration>
): string {
  if (!integration) {
    return "Рендер готов, но публикация не поставлена в очередь: подключите YouTube и выберите канал назначения.";
  }
  if (integration.status === "reauth_required") {
    return integration.lastError?.trim() || "Рендер готов, но YouTube требует переподключения.";
  }
  if (!integration.selectedYoutubeChannelId?.trim()) {
    return "Рендер готов, но публикация не поставлена в очередь: выберите канал назначения в Publishing.";
  }
  return (
    integration.lastError?.trim() ||
    "Рендер готов, но публикация не поставлена в очередь: YouTube publishing сейчас недоступен."
  );
}

function createFailedDuplicatePublication(input: {
  workspaceId: string;
  channelId: string;
  chatId: string;
  renderExportId: string;
  settings: ReturnType<typeof getChannelPublishSettings>;
  defaults: ReturnType<typeof buildChannelPublicationMetadata>;
  duplicate: NonNullable<ReturnType<typeof findBlockingPublicationDuplicate>>;
  createdByUserId: string;
}): ChannelPublication {
  const slot = pickNextPublicationSlot({
    settings: input.settings,
    existingPublications: listFutureActivePublicationsForChannel(input.channelId)
  });
  const publication = createChannelPublication({
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    chatId: input.chatId,
    renderExportId: input.renderExportId,
    scheduleMode: slot.scheduleMode,
    scheduledAt: slot.scheduledAt,
    uploadReadyAt: slot.uploadReadyAt,
    slotDate: slot.slotDate,
    slotIndex: slot.slotIndex,
    title: input.defaults.title,
    description: input.defaults.description,
    tags: input.defaults.tags,
    notifySubscribers: input.settings.notifySubscribersByDefault,
    needsReview: true,
    createdByUserId: input.createdByUserId
  });
  return markPublicationFailedForDuplicate(publication.id, input.duplicate);
}

function markPublicationFailedForDuplicate(
  publicationId: string,
  duplicate: NonNullable<ReturnType<typeof findBlockingPublicationDuplicate>>
): ChannelPublication {
  return markChannelPublicationFailed(
    publicationId,
    `${buildBlockingPublicationDuplicateMessage(duplicate)} Измените title или отмените старую публикацию, если это действительно новый ролик.`
  );
}

function failPublicationIfDuplicate(publication: ChannelPublication): ChannelPublication | null {
  const duplicate = findBlockingPublicationDuplicate({
    channelId: publication.channelId,
    title: publication.title,
    sourceUrl: publication.sourceUrl,
    excludePublicationId: publication.id
  });
  if (!duplicate) {
    return null;
  }
  return markPublicationFailedForDuplicate(publication.id, duplicate);
}

function shouldBlockPublicationUploadForDuplicate(
  current: ChannelPublication,
  duplicate: ChannelPublication
): boolean {
  if (
    duplicate.status === "uploading" ||
    duplicate.status === "scheduled" ||
    duplicate.status === "published"
  ) {
    return true;
  }
  const duplicateCreated = new Date(duplicate.createdAt).getTime();
  const currentCreated = new Date(current.createdAt).getTime();
  if (Number.isFinite(duplicateCreated) && Number.isFinite(currentCreated) && duplicateCreated !== currentCreated) {
    return duplicateCreated < currentCreated;
  }
  return duplicate.id < current.id;
}

export function createOrUpdateQueuedPublicationFromRenderExport(input: {
  workspaceId: string;
  channelId: string;
  chatId: string;
  chatTitle: string;
  renderExport: RenderExportRecord;
  stage2Result: Stage2Response | null;
  createdByUserId: string;
  publishAfterRender?: boolean;
}): ChannelPublication | null {
  return runInTransaction(() => {
    const settings = getChannelPublishSettings(input.channelId);
    const shouldPublishAfterRender = input.publishAfterRender ?? settings.autoQueueEnabled;
    if (!shouldPublishAfterRender) {
      return null;
    }
    const integration = getChannelPublishIntegration(input.channelId);
    const isIntegrationReady = isChannelPublishIntegrationReady(integration);
    const unavailableMessage = isIntegrationReady
      ? null
      : buildPublishAfterRenderUnavailableMessage(integration);

    const defaults = buildChannelPublicationMetadata({
      renderTitle: input.renderExport.renderTitle,
      chatTitle: input.chatTitle,
      stage2Result: input.stage2Result
    });
    const existingForRenderExport = findLatestPublicationForRenderExport(input.renderExport.id);
    if (existingForRenderExport) {
      if (
        existingForRenderExport.status === "queued" ||
        existingForRenderExport.status === "paused" ||
        existingForRenderExport.status === "failed"
      ) {
        const updated = mergeQueuedPublicationDefaults({
          current: existingForRenderExport,
          renderExport: input.renderExport,
          defaults
        });
        const failedDuplicate = failPublicationIfDuplicate(updated);
        if (failedDuplicate) {
          return failedDuplicate;
        }
        if (!isIntegrationReady && unavailableMessage) {
          return markChannelPublicationFailed(updated.id, unavailableMessage);
        }
        appendChannelPublicationEvent(updated.id, "info", "Рендер повторно синхронизирован с текущей публикацией.");
        return updated;
      }
      return existingForRenderExport.status === "canceled" ? null : existingForRenderExport;
    }

    const existingForChat = findLatestPublicationForChat(input.chatId);
    if (existingForChat) {
      if (
        existingForChat.status === "queued" ||
        existingForChat.status === "paused" ||
        existingForChat.status === "failed"
      ) {
        const updated = mergeQueuedPublicationDefaults({
          current: existingForChat,
          renderExport: input.renderExport,
          defaults
        });
        const failedDuplicate = failPublicationIfDuplicate(updated);
        if (failedDuplicate) {
          return failedDuplicate;
        }
        if (!isIntegrationReady && unavailableMessage) {
          return markChannelPublicationFailed(updated.id, unavailableMessage);
        }
        appendChannelPublicationEvent(updated.id, "info", "Рендер обновлён, публикация синхронизирована с новым экспортом.");
        return updated;
      }

      appendChannelPublicationEvent(
        existingForChat.id,
        "warn",
        "Новый рендер не поставлен отдельной публикацией: этот ролик уже публикуется или опубликован."
      );
      return existingForChat;
    }

    const duplicate = findBlockingPublicationDuplicate({
      channelId: input.channelId,
      title: defaults.title,
      sourceUrl: input.renderExport.sourceUrl
    });
    if (duplicate) {
      return createFailedDuplicatePublication({
        workspaceId: input.workspaceId,
        channelId: input.channelId,
        chatId: input.chatId,
        renderExportId: input.renderExport.id,
        settings,
        defaults,
        duplicate,
        createdByUserId: input.createdByUserId
      });
    }

    const slot = pickNextPublicationSlot({
      settings,
      existingPublications: listFutureActivePublicationsForChannel(input.channelId)
    });
    const created = createChannelPublication({
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      chatId: input.chatId,
      renderExportId: input.renderExport.id,
      scheduleMode: slot.scheduleMode,
      scheduledAt: slot.scheduledAt,
      uploadReadyAt: slot.uploadReadyAt,
      slotDate: slot.slotDate,
      slotIndex: slot.slotIndex,
      title: defaults.title,
      description: defaults.description,
      tags: defaults.tags,
      notifySubscribers: settings.notifySubscribersByDefault,
      needsReview: defaults.needsReview,
      createdByUserId: input.createdByUserId
    });
    if (!isIntegrationReady && unavailableMessage) {
      return markChannelPublicationFailed(created.id, unavailableMessage);
    }
    return created;
  });
}

export function completeRenderExportAndMaybeQueue(input: {
  workspaceId: string;
  channelId: string;
  chatId: string;
  chatTitle: string;
  stage3JobId: string;
  artifactFileName: string;
  artifactFilePath: string;
  artifactMimeType: string;
  artifactSizeBytes: number;
  renderTitle: string | null;
  sourceUrl: string;
  snapshotJson: string;
  createdByUserId: string;
  stage2Result: Stage2Response | null;
  publishAfterRender?: boolean;
}): {
  renderExport: RenderExportRecord;
  publication: ChannelPublication | null;
} {
  const renderExport = createRenderExport({
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    chatId: input.chatId,
    stage3JobId: input.stage3JobId,
    artifactFileName: input.artifactFileName,
    artifactFilePath: input.artifactFilePath,
    artifactMimeType: input.artifactMimeType,
    artifactSizeBytes: input.artifactSizeBytes,
    renderTitle: input.renderTitle,
    sourceUrl: input.sourceUrl,
    snapshotJson: input.snapshotJson,
    createdByUserId: input.createdByUserId
  });
  const publication = createOrUpdateQueuedPublicationFromRenderExport({
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    chatId: input.chatId,
    chatTitle: input.chatTitle,
    renderExport,
    stage2Result: input.stage2Result,
    createdByUserId: input.createdByUserId,
    publishAfterRender: input.publishAfterRender
  });
  return { renderExport, publication };
}

export async function syncScheduledPublicationToYouTube(publicationId: string): Promise<ChannelPublication> {
  const publication = getChannelPublicationById(publicationId);
  if (!publication) {
    throw new PublicationMutationError("Публикация не найдена.", {
      code: "PUBLICATION_NOT_FOUND",
      status: 404
    });
  }
  if (!publication.youtubeVideoId || publication.status !== "scheduled") {
    return publication;
  }

  try {
    const { credential } = await ensureFreshYouTubeCredential(publication.channelId);
    await updateYouTubeScheduledVideo({
      accessToken: credential.accessToken!,
      videoId: publication.youtubeVideoId,
      title: publication.title,
      description: publication.description,
      tags: publication.tags,
      publishAt: publication.scheduledAt
    });
    appendChannelPublicationEvent(publication.id, "info", "Изменения синхронизированы в YouTube.");
    return getChannelPublicationById(publication.id)!;
  } catch (error) {
    if (error instanceof YouTubePublishError && error.reauthRequired) {
      markChannelPublishIntegrationReauthRequired(publication.channelId, error.message);
    }
    throw error;
  }
}

export async function updateChannelPublicationFromEditor(input: {
  publicationId: string;
  patch: PublicationEditorPatch;
}): Promise<ChannelPublication> {
  const current = getChannelPublicationById(input.publicationId);
  if (!current) {
    throw new PublicationMutationError("Публикация не найдена.", {
      code: "PUBLICATION_NOT_FOUND",
      status: 404
    });
  }
  if (current.status === "uploading") {
    throw new PublicationMutationError("Публикацию нельзя редактировать, пока ролик загружается в YouTube.", {
      code: "PUBLICATION_UPLOAD_IN_PROGRESS"
    });
  }
  if (
    current.youtubeVideoId &&
    typeof input.patch.notifySubscribers === "boolean" &&
    input.patch.notifySubscribers !== current.notifySubscribers
  ) {
    throw new PublicationMutationError(
      "Этот флаг YouTube применяет только при первой загрузке видео. Для уже загруженного ролика измените его вручную в Studio.",
      {
        code: "NOTIFY_SUBSCRIBERS_LOCKED",
        field: "notifySubscribers"
      }
    );
  }

  let scheduledPatch:
    | {
        scheduleMode: ChannelPublicationScheduleMode;
        scheduledAt: string;
        uploadReadyAt: string;
        slotDate: string;
        slotIndex: number;
      }
    | undefined;
  if (input.patch.scheduleMode === "custom") {
    if (!input.patch.scheduledAtLocal?.trim()) {
      throw new PublicationMutationError("Для кастомной публикации укажите дату и время.", {
        code: "CUSTOM_TIME_REQUIRED",
        field: "scheduledAtLocal"
      });
    }
    const settings = getChannelPublishSettings(current.channelId);
    scheduledPatch = buildCustomPublicationCandidateFromLocalDateTime({
      settings,
      localDateTime: input.patch.scheduledAtLocal
    });
    if (new Date(scheduledPatch.scheduledAt).getTime() <= Date.now()) {
      throw new PublicationMutationError(
        "Кастомное время уже в прошлом. Выберите будущее время или нажмите Publish now.",
        {
          code: "CUSTOM_TIME_IN_PAST",
          field: "scheduledAtLocal"
        }
      );
    }
  } else if (
    input.patch.scheduleMode === "slot" ||
    (input.patch.slotDate && typeof input.patch.slotIndex === "number")
  ) {
    if (!input.patch.slotDate || typeof input.patch.slotIndex !== "number") {
      throw new PublicationMutationError("Для слот-публикации передайте slotDate и slotIndex.", {
        code: "SLOT_SELECTION_REQUIRED",
        field: "slot"
      });
    }
    const settings = getChannelPublishSettings(current.channelId);
    const conflicting = listFutureActivePublicationsForChannel(current.channelId).find(
      (item) =>
        item.id !== current.id &&
        item.scheduleMode === "slot" &&
        item.slotDate === input.patch.slotDate &&
        item.slotIndex === input.patch.slotIndex &&
        item.status !== "canceled"
    );
    if (conflicting) {
      throw new PublicationMutationError("Этот слот уже занят другой публикацией.", {
        code: "SLOT_OCCUPIED",
        field: "slot"
      });
    }
    scheduledPatch = buildPublicationSlotCandidateFromDateAndIndex({
      settings,
      slotDate: input.patch.slotDate,
      slotIndex: input.patch.slotIndex
    });
    if (new Date(scheduledPatch.scheduledAt).getTime() <= Date.now()) {
      throw new PublicationMutationError("Нельзя перенести ролик в уже прошедший слот.", {
        code: "SLOT_IN_PAST",
        field: "slot"
      });
    }
  }

  if (scheduledPatch) {
    const timeConflict = findFuturePublicationTimeConflict({
      channelId: current.channelId,
      excludePublicationId: current.id,
      scheduledAt: scheduledPatch.scheduledAt
    });
    if (timeConflict) {
      throw new PublicationMutationError("Это время уже занято другой публикацией.", {
        code: "TIME_OCCUPIED",
        field: getScheduleFieldFromPatch(input.patch)
      });
    }
  }

  const nextTitle = normalizeEditorText(input.patch.title) ?? current.title;
  const updated = runInTransaction(() => {
    assertNoBlockingPublicationDuplicate({
      channelId: current.channelId,
      title: nextTitle,
      sourceUrl: current.sourceUrl,
      excludePublicationId: current.id
    });
    return updateChannelPublicationDraft({
      publicationId: input.publicationId,
      title: normalizeEditorText(input.patch.title),
      description: normalizeEditorText(input.patch.description),
      tags: input.patch.tags,
      titleManual: typeof input.patch.title === "string",
      descriptionManual: typeof input.patch.description === "string",
      tagsManual: Array.isArray(input.patch.tags),
      notifySubscribers: input.patch.notifySubscribers,
      scheduleMode: scheduledPatch?.scheduleMode,
      scheduledAt: scheduledPatch?.scheduledAt,
      uploadReadyAt: scheduledPatch?.uploadReadyAt,
      slotDate: scheduledPatch?.slotDate,
      slotIndex: scheduledPatch?.slotIndex,
      scheduleManual: Boolean(scheduledPatch)
    });
  });

  appendChannelPublicationEvent(
    updated.id,
    "info",
    updated.status === "scheduled" ? "Публикация обновлена и будет синхронизирована с YouTube." : "Публикация обновлена."
  );
  if (updated.status === "scheduled" && updated.youtubeVideoId) {
    return syncScheduledPublicationToYouTube(updated.id);
  }
  return updated;
}

export async function shiftChannelPublicationSlot(input: {
  publicationId: string;
  axis: PublicationShiftAxis;
  direction: PublicationShiftDirection;
}): Promise<{
  publication: ChannelPublication;
  swappedPublication: ChannelPublication | null;
  mode: "moved" | "swapped";
}> {
  const current = getChannelPublicationById(input.publicationId);
  if (!current) {
    throw new PublicationMutationError("Публикация не найдена.", {
      code: "PUBLICATION_NOT_FOUND",
      status: 404
    });
  }
  const settings = getChannelPublishSettings(current.channelId);
  const targetSlot = resolveShiftTargetSlot({
    slotDate: current.slotDate,
    slotIndex: current.slotIndex,
    settings,
    axis: input.axis,
    direction: input.direction
  });
  return moveChannelPublicationIntoSlot({
    publication: current,
    targetSlot
  });
}

export async function moveChannelPublicationToSlot(input: {
  publicationId: string;
  slotDate: string;
  slotIndex: number;
}): Promise<{
  publication: ChannelPublication;
  swappedPublication: ChannelPublication | null;
  mode: "moved" | "swapped";
}> {
  const current = getChannelPublicationById(input.publicationId);
  if (!current) {
    throw new PublicationMutationError("Публикация не найдена.", {
      code: "PUBLICATION_NOT_FOUND",
      status: 404
    });
  }

  return moveChannelPublicationIntoSlot({
    publication: current,
    targetSlot: {
      slotDate: input.slotDate,
      slotIndex: input.slotIndex
    }
  });
}

export async function processQueuedChannelPublication(
  publication: ChannelPublication,
  options?: { leaseToken?: string | null }
): Promise<ChannelPublication> {
  if (publication.status !== "uploading" && publication.status !== "queued") {
    return publication;
  }
  const expectedLeaseToken = options?.leaseToken?.trim() || null;

  try {
    const latest = getChannelPublicationById(publication.id);
    if (!latest) {
      throw new Error("Публикация исчезла из очереди.");
    }
    if (latest.status !== "uploading" && latest.status !== "queued") {
      return latest;
    }
    const duplicate = findBlockingPublicationDuplicate({
      channelId: latest.channelId,
      title: latest.title,
      sourceUrl: latest.sourceUrl,
      excludePublicationId: latest.id
    });
    if (duplicate && shouldBlockPublicationUploadForDuplicate(latest, duplicate.publication)) {
      return markChannelPublicationFailed(
        latest.id,
        `${buildBlockingPublicationDuplicateMessage(duplicate)} Upload остановлен до обращения к YouTube.`,
        {
          expectedLeaseToken
        }
      );
    }
    if (!expectedLeaseToken) {
      throw new YouTubePublishError("Публикация не имеет активного lease. Upload остановлен, чтобы не создать дубль.", {
        recoverable: true
      });
    }
    const { credential } = await ensureFreshYouTubeCredential(publication.channelId);
    if (latest.youtubeVideoId) {
      await updateYouTubeScheduledVideo({
        accessToken: credential.accessToken!,
        videoId: latest.youtubeVideoId,
        title: latest.title,
        description: latest.description,
        tags: latest.tags,
        publishAt: latest.scheduledAt
      });
      return markChannelPublicationScheduled({
        publicationId: latest.id,
        youtubeVideoId: latest.youtubeVideoId,
        youtubeVideoUrl: latest.youtubeVideoUrl,
        expectedLeaseToken
      });
    }

    const renderExport = await ensureRenderExportArtifactAvailable(latest.renderExportId);
    if (!renderExport) {
      throw new YouTubePublishError(
        "Не найден сохранённый render artifact для этой публикации. Повторите рендер, чтобы поставить ролик в очередь заново.",
        { recoverable: true }
      );
    }
    const processingState = getChannelPublicationProcessingState(latest.id);
    const remote = await uploadYouTubeVideo({
      accessToken: credential.accessToken!,
      filePath: renderExport.artifactFilePath,
      mimeType: renderExport.artifactMimeType || "video/mp4",
      title: latest.title,
      description: latest.description,
      tags: latest.tags,
      notifySubscribers: latest.notifySubscribers,
      publishAt: latest.scheduledAt,
      sessionUrl: processingState?.uploadSessionUrl ?? null,
      onSessionUrl: async (sessionUrl) => {
        if (
          !expectedLeaseToken ||
          !persistChannelPublicationUploadSession({
            publicationId: latest.id,
            sessionUrl,
            expectedLeaseToken
          })
        ) {
          throw new YouTubePublishError(
            "Upload session не закрепился за текущей публикацией. Загрузка остановлена, чтобы не создать дубль.",
            { recoverable: true }
          );
        }
      },
      onHeartbeat: () => {
        if (!expectedLeaseToken) {
          return;
        }
        extendChannelPublicationLease({
          publicationId: latest.id,
          expectedLeaseToken
        });
      }
    });
    const scheduled = markChannelPublicationScheduled({
      publicationId: publication.id,
      youtubeVideoId: remote.videoId,
      youtubeVideoUrl: remote.videoUrl,
      expectedLeaseToken
    });
    if (scheduled.status === "scheduled" && scheduled.youtubeVideoId) {
      try {
        await updateYouTubeScheduledVideo({
          accessToken: credential.accessToken!,
          videoId: scheduled.youtubeVideoId,
          title: scheduled.title,
          description: scheduled.description,
          tags: scheduled.tags,
          publishAt: scheduled.scheduledAt
        });
      } catch (syncError) {
        if (syncError instanceof YouTubePublishError && syncError.reauthRequired) {
          markChannelPublishIntegrationReauthRequired(scheduled.channelId, syncError.message);
        }
        appendChannelPublicationEvent(
          scheduled.id,
          "warn",
          syncError instanceof Error
            ? `Видео загружено, но финальная синхронизация метаданных не прошла: ${syncError.message}`
            : "Видео загружено, но финальная синхронизация метаданных не прошла."
        );
      }
    }
    return scheduled;
  } catch (error) {
    if (error instanceof YouTubePublishError && error.reauthRequired) {
      markChannelPublishIntegrationReauthRequired(publication.channelId, error.message);
    }
    return markChannelPublicationFailed(
      publication.id,
      error instanceof Error ? error.message : "Не удалось опубликовать видео в YouTube.",
      {
        expectedLeaseToken
      }
    );
  }
}

function auditYoutubeDelete(
  action: string,
  publication: ChannelPublication,
  status: "attempted" | "succeeded" | "failed",
  options?: { userId?: string | null; errorMessage?: string | null }
): void {
  tryAppendFlowAuditEvent({
    workspaceId: publication.workspaceId,
    userId: options?.userId ?? null,
    action,
    entityType: "publication",
    entityId: publication.id,
    channelId: publication.channelId,
    chatId: publication.chatId,
    correlationId: publication.id,
    stage: "youtube",
    status,
    severity: status === "failed" ? "error" : "info",
    payload: {
      title: publication.title,
      youtubeVideoId: publication.youtubeVideoId,
      youtubeVideoUrl: publication.youtubeVideoUrl,
      remoteDeleteAttempted: true,
      remoteDeleteSucceeded: status === "succeeded",
      errorMessage: options?.errorMessage ?? null
    }
  });
}

export async function deleteChannelPublicationWithRemoteSync(
  publicationId: string,
  options?: { userId?: string | null }
): Promise<ChannelPublication> {
  const publication = getChannelPublicationById(publicationId);
  if (!publication) {
    throw new PublicationMutationError("Публикация не найдена.", {
      code: "PUBLICATION_NOT_FOUND",
      status: 404
    });
  }
  if (publication.status === "scheduled" && publication.youtubeVideoId) {
    auditYoutubeDelete("publication.delete.attempted", publication, "attempted", {
      userId: options?.userId ?? null
    });
    try {
      const { credential } = await ensureFreshYouTubeCredential(publication.channelId);
      await deleteYouTubeVideo({
        accessToken: credential.accessToken!,
        videoId: publication.youtubeVideoId
      });
      auditYoutubeDelete("publication.delete.succeeded", publication, "succeeded", {
        userId: options?.userId ?? null
      });
    } catch (error) {
      auditYoutubeDelete("publication.delete.failed", publication, "failed", {
        userId: options?.userId ?? null,
        errorMessage: error instanceof Error ? error.message : "Remote YouTube delete failed."
      });
      throw error;
    }
  }
  return cancelChannelPublication(publicationId);
}

export async function retryFailedChannelPublication(publicationId: string): Promise<ChannelPublication> {
  const publication = retryChannelPublication(publicationId);
  return publication;
}
