import path from "node:path";
import type { ChannelPublication } from "../app/components/types";
import {
  buildValidatedCustomPublicationSchedule,
  buildValidatedExactPublicationSchedule,
  completeRenderExportAndMaybeQueue,
  createExactQueuedPublicationFromRenderExport,
  updateChannelPublicationFromEditor
} from "./channel-publication-service";
import { appendChatEvent, createOrGetChatBySource, type ChatThread } from "./chat-history";
import { scheduleChannelPublicationProcessing } from "./channel-publication-runtime";
import { ensureRenderExportArtifactAvailable, type RenderExportRecord } from "./publication-store";
import { publishStage3VideoArtifact } from "./stage3-job-artifacts";
import { completeStage3Job, enqueueStage3Job, type Stage3JobRecord } from "./stage3-job-store";

export type ReadyVideoPublicationResult = {
  chat: ChatThread;
  job: Stage3JobRecord;
  renderExport: RenderExportRecord;
  publication: ChannelPublication | null;
};

function buildReadyUploadResultJson(input: {
  fileName: string;
  sourceUrl: string;
}): string {
  return JSON.stringify({
    ok: true,
    mode: "ready_upload",
    fileName: input.fileName,
    sourceUrl: input.sourceUrl
  });
}

function normalizeReadyUploadTags(tags: string[] | undefined): string[] {
  return (tags ?? [])
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 30);
}

export async function createReadyVideoPublication(input: {
  workspaceId: string;
  userId: string;
  channelId: string;
  sourceUrl: string;
  title: string;
  fileName: string;
  sourcePath: string;
  description?: string;
  tags?: string[];
  scheduledAtLocal?: string;
  publishAt?: string;
  notifySubscribers?: boolean;
}): Promise<ReadyVideoPublicationResult> {
  const fileName = path.basename(input.fileName.trim() || "ready-upload.mp4");
  const title = input.title.trim() || path.parse(fileName).name || "Готовый ролик";
  const manualDescription = input.description?.trim() ?? "";
  const manualTags = normalizeReadyUploadTags(input.tags);
  const manualScheduledAtLocal = input.scheduledAtLocal?.trim() ?? "";
  const publishAt = input.publishAt?.trim() ?? "";
  if (manualScheduledAtLocal && publishAt) {
    throw new Error("Передайте только publishAt или scheduledAtLocal.");
  }
  if (manualScheduledAtLocal) {
    buildValidatedCustomPublicationSchedule({
      channelId: input.channelId,
      scheduledAtLocal: manualScheduledAtLocal
    });
  }
  if (publishAt) {
    buildValidatedExactPublicationSchedule({
      channelId: input.channelId,
      publishAt
    });
  }
  const chat = await createOrGetChatBySource({
    rawUrl: input.sourceUrl,
    channelIdRaw: input.channelId,
    title,
    eventText: `Готовый mp4 добавлен для публикации: ${fileName}`
  });

  const queuedJob = enqueueStage3Job({
    workspaceId: input.workspaceId,
    userId: input.userId,
    kind: "render",
    executionTarget: "host",
    payloadJson: JSON.stringify({
      mode: "ready_upload",
      chatId: chat.id,
      channelId: input.channelId,
      sourceUrl: input.sourceUrl,
      workspaceId: input.workspaceId,
      renderTitle: title,
      publishAfterRender: true,
      snapshot: null
    }),
    reuseCompleted: false
  });

  const artifact = await publishStage3VideoArtifact("render", queuedJob.id, input.sourcePath);
  const completedJob = completeStage3Job(queuedJob.id, {
    resultJson: buildReadyUploadResultJson({
      fileName,
      sourceUrl: input.sourceUrl
    }),
    artifact: {
      kind: "video",
      fileName,
      mimeType: "video/mp4",
      filePath: artifact.filePath,
      sizeBytes: artifact.sizeBytes
    }
  });

  const { renderExport, publication: automaticallyQueuedPublication } = completeRenderExportAndMaybeQueue({
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    chatId: chat.id,
    chatTitle: chat.title,
    stage3JobId: completedJob.id,
    artifactFileName: fileName,
    artifactFilePath: completedJob.artifactFilePath ?? artifact.filePath,
    artifactMimeType: "video/mp4",
    artifactSizeBytes: completedJob.artifact?.sizeBytes ?? artifact.sizeBytes,
    renderTitle: title,
    sourceUrl: input.sourceUrl,
    snapshotJson: JSON.stringify({
      mode: "ready_upload",
      completedAt: completedJob.completedAt ?? new Date().toISOString()
    }),
    createdByUserId: input.userId,
    stage2Result: null,
    // The machine path creates its publication below with the exact Oracle
    // timestamp. It must never pass through the slot picker, even briefly.
    publishAfterRender: publishAt ? false : true
  });
  const durableRenderExport = await ensureRenderExportArtifactAvailable(renderExport.id);
  if (!durableRenderExport) {
    throw new Error("Не удалось сохранить долговечный render export для публикации.");
  }
  let queuedPublication = publishAt
    ? createExactQueuedPublicationFromRenderExport({
        workspaceId: input.workspaceId,
        channelId: input.channelId,
        chatId: chat.id,
        renderExport: durableRenderExport,
        title,
        description: manualDescription,
        tags: manualTags,
        publishAt,
        notifySubscribers: input.notifySubscribers === true,
        createdByUserId: input.userId
      })
    : automaticallyQueuedPublication;
  queuedPublication =
    !publishAt && queuedPublication && (manualDescription || manualTags.length > 0 || manualScheduledAtLocal || typeof input.notifySubscribers === "boolean")
      ? await updateChannelPublicationFromEditor({
          publicationId: queuedPublication.id,
          patch: {
            description: manualDescription || undefined,
            tags: manualTags.length > 0 ? manualTags : undefined,
            scheduleMode: manualScheduledAtLocal ? "custom" : undefined,
            scheduledAtLocal: manualScheduledAtLocal || undefined,
            notifySubscribers: input.notifySubscribers
          }
        })
      : queuedPublication;

  if (queuedPublication?.status === "queued" || queuedPublication?.status === "uploading") {
    scheduleChannelPublicationProcessing();
  }
  await appendChatEvent(chat.id, {
    role: "assistant",
    type: "note",
    text: queuedPublication
      ? `Готовый mp4 поставлен в очередь публикации: ${queuedPublication.title}`
      : "Готовый mp4 сохранён как publishable export."
  }).catch(() => undefined);

  return {
    chat,
    job: completedJob,
    renderExport: durableRenderExport,
    publication: queuedPublication
  };
}
