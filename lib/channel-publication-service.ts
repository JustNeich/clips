import type { ChannelPublication, Stage2Response } from "../app/components/types";
import {
  buildChannelPublicationMetadata,
  buildPublicationSlotCandidateFromDateAndIndex,
  pickNextPublicationSlot
} from "./channel-publishing";
import {
  appendChannelPublicationEvent,
  cancelChannelPublication,
  createChannelPublication,
  createRenderExport,
  findLatestReusablePublicationForChat,
  getChannelPublicationById,
  getChannelPublishIntegration,
  getChannelPublishSettings,
  getRenderExportById,
  getStoredChannelPublishCredential,
  listChannelPublications,
  listFutureActivePublicationsForChannel,
  markChannelPublicationFailed,
  markChannelPublishIntegrationReauthRequired,
  markChannelPublicationScheduled,
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
import { runInTransaction } from "./db/client";

type PublicationEditorPatch = Partial<{
  title: string;
  description: string;
  tags: string[];
  slotDate: string;
  slotIndex: number;
}>;

export type PublicationShiftAxis = "slot" | "day";
export type PublicationShiftDirection = "prev" | "next";

function normalizeEditorText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return value.trim();
}

function addDaysToSlotDate(slotDate: string, deltaDays: number): string {
  const date = new Date(`${slotDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Некорректная дата слота.");
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

async function syncScheduledPublicationIfNeeded(publicationId: string): Promise<ChannelPublication> {
  const publication = getChannelPublicationById(publicationId);
  if (!publication) {
    throw new Error("Публикация не найдена.");
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

export function createOrUpdateQueuedPublicationFromRenderExport(input: {
  workspaceId: string;
  channelId: string;
  chatId: string;
  chatTitle: string;
  renderExport: RenderExportRecord;
  stage2Result: Stage2Response | null;
  createdByUserId: string;
}): ChannelPublication | null {
  const settings = getChannelPublishSettings(input.channelId);
  if (!settings.autoQueueEnabled) {
    return null;
  }

  const defaults = buildChannelPublicationMetadata({
    renderTitle: input.renderExport.renderTitle,
    chatTitle: input.chatTitle,
    stage2Result: input.stage2Result
  });
  const existing = findLatestReusablePublicationForChat(input.chatId);
  if (existing) {
    const updated = mergeQueuedPublicationDefaults({
      current: existing,
      renderExport: input.renderExport,
      defaults
    });
    appendChannelPublicationEvent(updated.id, "info", "Рендер обновлён, публикация синхронизирована с новым экспортом.");
    return updated;
  }

  const slot = pickNextPublicationSlot({
    settings,
    existingPublications: listFutureActivePublicationsForChannel(input.channelId)
  });
  return createChannelPublication({
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    chatId: input.chatId,
    renderExportId: input.renderExport.id,
    scheduledAt: slot.scheduledAt,
    uploadReadyAt: slot.uploadReadyAt,
    slotDate: slot.slotDate,
    slotIndex: slot.slotIndex,
    title: defaults.title,
    description: defaults.description,
    tags: defaults.tags,
    needsReview: defaults.needsReview,
    createdByUserId: input.createdByUserId
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
    createdByUserId: input.createdByUserId
  });
  return { renderExport, publication };
}

export async function syncScheduledPublicationToYouTube(publicationId: string): Promise<ChannelPublication> {
  const publication = getChannelPublicationById(publicationId);
  if (!publication) {
    throw new Error("Публикация не найдена.");
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
    throw new Error("Публикация не найдена.");
  }

  let scheduledPatch:
    | {
        scheduledAt: string;
        uploadReadyAt: string;
        slotDate: string;
        slotIndex: number;
      }
    | undefined;
  if (input.patch.slotDate && typeof input.patch.slotIndex === "number") {
    const settings = getChannelPublishSettings(current.channelId);
    const conflicting = listFutureActivePublicationsForChannel(current.channelId).find(
      (item) =>
        item.id !== current.id &&
        item.slotDate === input.patch.slotDate &&
        item.slotIndex === input.patch.slotIndex &&
        item.status !== "canceled"
    );
    if (conflicting) {
      throw new Error("Этот слот уже занят другой публикацией.");
    }
    scheduledPatch = buildPublicationSlotCandidateFromDateAndIndex({
      settings,
      slotDate: input.patch.slotDate,
      slotIndex: input.patch.slotIndex
    });
  }

  const updated = updateChannelPublicationDraft({
    publicationId: input.publicationId,
    title: normalizeEditorText(input.patch.title),
    description: normalizeEditorText(input.patch.description),
    tags: input.patch.tags,
    titleManual: typeof input.patch.title === "string",
    descriptionManual: typeof input.patch.description === "string",
    tagsManual: Array.isArray(input.patch.tags),
    scheduledAt: scheduledPatch?.scheduledAt,
    uploadReadyAt: scheduledPatch?.uploadReadyAt,
    slotDate: scheduledPatch?.slotDate,
    slotIndex: scheduledPatch?.slotIndex,
    scheduleManual: Boolean(scheduledPatch)
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
    throw new Error("Публикация не найдена.");
  }
  if (current.status === "published" || current.status === "canceled") {
    throw new Error("Эту публикацию больше нельзя переносить по слотам.");
  }

  const settings = getChannelPublishSettings(current.channelId);
  const targetSlot = resolveShiftTargetSlot({
    slotDate: current.slotDate,
    slotIndex: current.slotIndex,
    settings,
    axis: input.axis,
    direction: input.direction
  });
  const targetSchedule = buildPublicationSlotCandidateFromDateAndIndex({
    settings,
    slotDate: targetSlot.slotDate,
    slotIndex: targetSlot.slotIndex
  });

  if (new Date(targetSchedule.scheduledAt).getTime() <= Date.now()) {
    throw new Error("Нельзя перенести ролик в уже прошедший слот.");
  }

  const conflicting = listChannelPublications(current.channelId).find(
    (item) =>
      item.id !== current.id &&
      item.status !== "canceled" &&
      item.slotDate === targetSlot.slotDate &&
      item.slotIndex === targetSlot.slotIndex
  );

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
    throw new Error("Этот слот уже занят опубликованным роликом. Свап недоступен.");
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
    throw new Error("Не удалось переставить публикации местами.");
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

export async function processQueuedChannelPublication(publication: ChannelPublication): Promise<ChannelPublication> {
  if (publication.status !== "uploading" && publication.status !== "queued") {
    return publication;
  }

  try {
    const { credential } = await ensureFreshYouTubeCredential(publication.channelId);
    if (publication.youtubeVideoId) {
      await updateYouTubeScheduledVideo({
        accessToken: credential.accessToken!,
        videoId: publication.youtubeVideoId,
        title: publication.title,
        description: publication.description,
        tags: publication.tags,
        publishAt: publication.scheduledAt
      });
      return markChannelPublicationScheduled({
        publicationId: publication.id,
        youtubeVideoId: publication.youtubeVideoId,
        youtubeVideoUrl: publication.youtubeVideoUrl
      });
    }

    const latest = getChannelPublicationById(publication.id);
    if (!latest) {
      throw new Error("Публикация исчезла из очереди.");
    }
    const renderExport = getRenderExportById(latest.renderExportId);
    if (!renderExport) {
      throw new Error("Не найден render export для публикации.");
    }
    const remote = await uploadYouTubeVideo({
      accessToken: credential.accessToken!,
      filePath: renderExport.artifactFilePath,
      mimeType: renderExport.artifactMimeType || "video/mp4",
      title: latest.title,
      description: latest.description,
      tags: latest.tags,
      publishAt: latest.scheduledAt
    });
    return markChannelPublicationScheduled({
      publicationId: publication.id,
      youtubeVideoId: remote.videoId,
      youtubeVideoUrl: remote.videoUrl
    });
  } catch (error) {
    if (error instanceof YouTubePublishError && error.reauthRequired) {
      markChannelPublishIntegrationReauthRequired(publication.channelId, error.message);
    }
    return markChannelPublicationFailed(
      publication.id,
      error instanceof Error ? error.message : "Не удалось опубликовать видео в YouTube."
    );
  }
}

export async function deleteChannelPublicationWithRemoteSync(publicationId: string): Promise<ChannelPublication> {
  const publication = getChannelPublicationById(publicationId);
  if (!publication) {
    throw new Error("Публикация не найдена.");
  }
  if (publication.status === "scheduled" && publication.youtubeVideoId) {
    const { credential } = await ensureFreshYouTubeCredential(publication.channelId);
    await deleteYouTubeVideo({
      accessToken: credential.accessToken!,
      videoId: publication.youtubeVideoId
    });
  }
  return cancelChannelPublication(publicationId);
}

export async function retryFailedChannelPublication(publicationId: string): Promise<ChannelPublication> {
  const publication = retryChannelPublication(publicationId);
  return publication;
}
