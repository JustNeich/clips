import path from "node:path";
import type { ChannelPublication } from "../app/components/types";
import { completeRenderExportAndMaybeQueue } from "./channel-publication-service";
import { appendChatEvent, createOrGetChatBySource, type ChatThread } from "./chat-history";
import { scheduleChannelPublicationProcessing } from "./channel-publication-runtime";
import type { RenderExportRecord } from "./publication-store";
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

export async function createReadyVideoPublication(input: {
  workspaceId: string;
  userId: string;
  channelId: string;
  sourceUrl: string;
  title: string;
  fileName: string;
  sourcePath: string;
}): Promise<ReadyVideoPublicationResult> {
  const fileName = path.basename(input.fileName.trim() || "ready-upload.mp4");
  const title = input.title.trim() || path.parse(fileName).name || "Готовый ролик";
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

  const { renderExport, publication } = completeRenderExportAndMaybeQueue({
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
    publishAfterRender: true
  });

  if (publication?.status === "queued" || publication?.status === "uploading") {
    scheduleChannelPublicationProcessing();
  }
  await appendChatEvent(chat.id, {
    role: "assistant",
    type: "note",
    text: publication
      ? `Готовый mp4 поставлен в очередь публикации: ${publication.title}`
      : "Готовый mp4 сохранён как publishable export."
  }).catch(() => undefined);

  return {
    chat,
    job: completedJob,
    renderExport,
    publication
  };
}
