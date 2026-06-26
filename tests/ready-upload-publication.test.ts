import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { POST as uploadReadyVideoRoute } from "../app/api/channels/[id]/publications/ready-upload/route";
import { APP_SESSION_COOKIE } from "../lib/auth/cookies";
import { createChannel } from "../lib/chat-history";
import {
  getRenderExportById,
  listChannelPublications,
  saveChannelPublishIntegration,
  upsertChannelPublishSettings
} from "../lib/publication-store";
import { ensureSourceMediaCached } from "../lib/source-media-cache";
import { listSourceJobsForChat } from "../lib/source-job-store";
import { bootstrapOwner } from "../lib/team-store";

const execFileAsync = promisify(execFile);

async function withIsolatedAppData<T>(run: (appDataDir: string) => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-ready-upload-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appDataDir;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
  delete (globalThis as { __clipsStage3JobRuntimeState__?: unknown }).__clipsStage3JobRuntimeState__;
  delete (globalThis as { __clipsChannelPublicationRuntimeState__?: unknown }).__clipsChannelPublicationRuntimeState__;

  try {
    return await run(appDataDir);
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    delete (globalThis as { __clipsStage3JobRuntimeState__?: unknown }).__clipsStage3JobRuntimeState__;
    delete (globalThis as { __clipsChannelPublicationRuntimeState__?: unknown }).__clipsChannelPublicationRuntimeState__;
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    await rm(appDataDir, { recursive: true, force: true });
  }
}

function buildAuthedHeaders(sessionToken: string): Headers {
  const headers = new Headers();
  headers.set("cookie", `${APP_SESSION_COOKIE}=${sessionToken}`);
  return headers;
}

async function createTinyMp4File(outputPath: string): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=green:s=540x960:d=0.6",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-an",
    "-movflags",
    "+faststart",
    outputPath
  ]);
}

async function seedReadyUploadChannel() {
  const owner = await bootstrapOwner({
    workspaceName: "Ready Upload Workspace",
    email: "owner@example.com",
    password: "Password123!",
    displayName: "Owner"
  });
  const channel = await createChannel({
    workspaceId: owner.workspace.id,
    creatorUserId: owner.user.id,
    name: "Ready Upload Channel",
    username: "ready_upload"
  });
  upsertChannelPublishSettings({
    workspaceId: owner.workspace.id,
    channelId: channel.id,
    userId: owner.user.id,
    patch: {
      uploadLeadMinutes: 0,
      notifySubscribersByDefault: false
    }
  });

  return { owner, channel };
}

test("ready-upload route queues a finished mp4 for YouTube without creating a source job", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const { owner, channel } = await seedReadyUploadChannel();
    saveChannelPublishIntegration({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      userId: owner.user.id,
      status: "connected",
      credential: null,
      googleAccountEmail: "owner@example.com",
      selectedYoutubeChannelId: "youtube-channel-1",
      selectedYoutubeChannelTitle: "Ready Upload Channel",
      selectedYoutubeChannelCustomUrl: "@readyupload",
      availableChannels: [
        {
          id: "youtube-channel-1",
          title: "Ready Upload Channel",
          customUrl: "@readyupload"
        }
      ],
      scopes: ["youtube.upload"],
      lastError: null
    });

    const mediaDir = await mkdtemp(path.join(appDataDir, "media-"));
    const mp4Path = path.join(mediaDir, "ready-final.mp4");
    await createTinyMp4File(mp4Path);
    const fileBytes = await readFile(mp4Path);

    const formData = new FormData();
    formData.set("title", "Ready Final");
    formData.set(
      "file",
      new File([fileBytes], "ready-final.mp4", {
        type: "video/mp4"
      })
    );

    const response = await uploadReadyVideoRoute(
      new Request(`http://localhost/api/channels/${channel.id}/publications/ready-upload`, {
        method: "POST",
        headers: buildAuthedHeaders(owner.sessionToken),
        body: formData
      }),
      { params: Promise.resolve({ id: channel.id }) }
    );
    const body = (await response.json()) as {
      chat?: { id?: string; title?: string; url?: string };
      renderExport?: { id?: string; fileName?: string };
      publication?: { id?: string; status?: string; renderExportId?: string; title?: string };
      error?: string;
    };

    assert.equal(response.status, 201, JSON.stringify(body));
    assert.ok(body.chat?.id);
    assert.equal(body.chat?.title, "Ready Final");
    assert.match(body.chat?.url ?? "", /^upload:\/\//);
    assert.equal(body.renderExport?.fileName, "ready-final.mp4");
    assert.equal(body.publication?.status, "queued");
    assert.equal(body.publication?.title, "Ready Final");
    assert.equal(body.publication?.renderExportId, body.renderExport?.id);

    const publications = listChannelPublications(channel.id);
    assert.equal(publications.length, 1);
    assert.equal(publications[0]?.id, body.publication?.id);
    assert.equal(publications[0]?.renderFileName, "ready-final.mp4");
    assert.equal(publications[0]?.sourceUrl, body.chat?.url);
    assert.equal(publications[0]?.notifySubscribers, false);

    const renderExport = getRenderExportById(body.renderExport?.id ?? "");
    assert.ok(renderExport);
    assert.match(renderExport?.artifactFilePath ?? "", /stage3-job-artifacts\/render/);
    assert.equal(renderExport?.sourceUrl, body.chat?.url);

    const cachedSource = await ensureSourceMediaCached(body.chat?.url ?? "");
    assert.equal(cachedSource.downloadProvider, "upload");
    assert.equal(cachedSource.fileName, "ready-final.mp4");

    const sourceJobs = listSourceJobsForChat(body.chat?.id ?? "", owner.workspace.id, 10);
    assert.equal(sourceJobs.length, 0);
  });
});

test("ready-upload route rejects direct upload when YouTube destination is not ready", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const { owner, channel } = await seedReadyUploadChannel();
    const mediaDir = await mkdtemp(path.join(appDataDir, "media-"));
    const mp4Path = path.join(mediaDir, "ready-final.mp4");
    await createTinyMp4File(mp4Path);
    const fileBytes = await readFile(mp4Path);

    const formData = new FormData();
    formData.set(
      "file",
      new File([fileBytes], "ready-final.mp4", {
        type: "video/mp4"
      })
    );

    const response = await uploadReadyVideoRoute(
      new Request(`http://localhost/api/channels/${channel.id}/publications/ready-upload`, {
        method: "POST",
        headers: buildAuthedHeaders(owner.sessionToken),
        body: formData
      }),
      { params: Promise.resolve({ id: channel.id }) }
    );
    const body = (await response.json()) as { error?: string };

    assert.equal(response.status, 400);
    assert.match(body.error ?? "", /YouTube/i);
    assert.equal(listChannelPublications(channel.id).length, 0);
  });
});
