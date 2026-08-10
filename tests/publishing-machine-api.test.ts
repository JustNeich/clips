import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { POST as createUploadRoute } from "../app/api/publishing/v1/uploads/route";
import { PUT as uploadContentRoute } from "../app/api/publishing/v1/uploads/[id]/content/route";
import { POST as commitUploadRoute } from "../app/api/publishing/v1/uploads/[id]/commit/route";
import { GET as getUploadRoute } from "../app/api/publishing/v1/uploads/[id]/route";
import { GET as getPublicationRoute } from "../app/api/publishing/v1/publications/[id]/route";
import { createChannel } from "../lib/chat-history";
import { getDb } from "../lib/db/client";
import {
  createMcpMachineCredential,
  McpMachineCredentialInputError
} from "../lib/mcp-machine-credential-store";
import {
  getRenderExportById,
  listChannelPublications,
  markChannelPublicationScheduled,
  saveChannelPublishIntegration,
  upsertChannelPublishSettings
} from "../lib/publication-store";
import { bootstrapOwner } from "../lib/team-store";

const execFileAsync = promisify(execFile);
const PUBLISH_AT = "2040-05-05T18:07:00.000Z";

type RuntimeScope = typeof globalThis & {
  __clipsAppDb?: unknown;
  __clipsStage3JobRuntimeState__?: unknown;
  __clipsChannelPublicationRuntimeState__?: { wakeTimer?: ReturnType<typeof setTimeout> | null };
};

async function withIsolatedAppData<T>(run: (appDataDir: string) => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-publishing-machine-api-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appDataDir;
  const scope = globalThis as RuntimeScope;
  delete scope.__clipsAppDb;
  delete scope.__clipsStage3JobRuntimeState__;
  delete scope.__clipsChannelPublicationRuntimeState__;
  try {
    return await run(appDataDir);
  } finally {
    const runtimeState = Reflect.get(scope, "__clipsChannelPublicationRuntimeState__") as
      | { wakeTimer?: ReturnType<typeof setTimeout> | null }
      | undefined;
    const timer = runtimeState?.wakeTimer;
    if (timer) {
      clearTimeout(timer);
    }
    delete scope.__clipsAppDb;
    delete scope.__clipsStage3JobRuntimeState__;
    delete scope.__clipsChannelPublicationRuntimeState__;
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    await rm(appDataDir, { recursive: true, force: true });
  }
}

async function createTinyMp4(outputPath: string): Promise<Uint8Array> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=180x320:d=0.5",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-an",
    "-movflags",
    "+faststart",
    outputPath
  ]);
  return new Uint8Array(await readFile(outputPath));
}

async function seedScenario(appDataDir: string) {
  const owner = await bootstrapOwner({
    workspaceName: "Publishing API Workspace",
    email: "owner@example.com",
    password: "Password123!",
    displayName: "Owner"
  });
  const channel = await createChannel({
    workspaceId: owner.workspace.id,
    creatorUserId: owner.user.id,
    name: "Allowed Channel",
    username: "allowed_channel"
  });
  const forbiddenChannel = await createChannel({
    workspaceId: owner.workspace.id,
    creatorUserId: owner.user.id,
    name: "Forbidden Channel",
    username: "forbidden_channel"
  });
  for (const current of [channel, forbiddenChannel]) {
    upsertChannelPublishSettings({
      workspaceId: owner.workspace.id,
      channelId: current.id,
      userId: owner.user.id,
      patch: { uploadLeadMinutes: 5, notifySubscribersByDefault: false }
    });
    saveChannelPublishIntegration({
      workspaceId: owner.workspace.id,
      channelId: current.id,
      userId: owner.user.id,
      status: "connected",
      credential: {
        refreshToken: `test-refresh-${current.id}`,
        accessToken: null,
        expiryDate: null,
        tokenType: "Bearer",
        scopes: ["youtube.upload"]
      },
      googleAccountEmail: "owner@example.com",
      selectedYoutubeChannelId: `youtube-${current.id}`,
      selectedYoutubeChannelTitle: current.name,
      selectedYoutubeChannelCustomUrl: `@${current.username}`,
      availableChannels: [
        {
          id: `youtube-${current.id}`,
          title: current.name,
          customUrl: `@${current.username}`,
          thumbnailUrl: null
        }
      ],
      scopes: ["youtube.upload"],
      lastError: null
    });
  }
  const mediaPath = path.join(appDataDir, "oracle-ready.mp4");
  const bytes = await createTinyMp4(mediaPath);
  const contentSha256 = createHash("sha256").update(bytes).digest("hex");
  return { owner, channel, forbiddenChannel, bytes, contentSha256 };
}

function createMachine(input: {
  owner: Awaited<ReturnType<typeof bootstrapOwner>>;
  channelId: string;
  scopes: Array<"publication:create" | "publication:read">;
  machineId?: string;
}) {
  return createMcpMachineCredential({
    workspaceId: input.owner.workspace.id,
    ownerUserId: input.owner.user.id,
    machineId: input.machineId ?? `oracle-${input.scopes.join("-")}`,
    scopes: input.scopes,
    allowedChannelIds: [input.channelId]
  });
}

function machineHeaders(secret: string, idempotencyKey?: string, contentSha256?: string): Headers {
  const headers = new Headers({ Authorization: `Bearer ${secret}` });
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  if (contentSha256) headers.set("Content-SHA256", contentSha256);
  return headers;
}

function createBody(channelId: string, bytes: Uint8Array, contentSha256: string, publishAt = PUBLISH_AT) {
  return {
    channelId,
    fileName: "oracle-ready.mp4",
    contentType: "video/mp4",
    contentLength: bytes.byteLength,
    contentSha256,
    publishAt,
    title: "Oracle exact-time upload",
    description: "Uploaded by Oracle through the machine contract.",
    tags: ["oracle", "clips"],
    notifySubscribers: false
  };
}

async function createUpload(input: {
  secret: string;
  key: string;
  body: ReturnType<typeof createBody>;
}) {
  const response = await createUploadRoute(
    new Request("http://localhost/api/publishing/v1/uploads", {
      method: "POST",
      headers: { ...Object.fromEntries(machineHeaders(input.secret, input.key)), "content-type": "application/json" },
      body: JSON.stringify(input.body)
    })
  );
  return { response, body: (await response.json()) as any };
}

async function uploadContent(input: {
  uploadId: string;
  secret: string;
  key: string;
  contentSha256: string;
  bytes: Uint8Array;
}) {
  const headers = machineHeaders(input.secret, input.key, input.contentSha256);
  headers.set("Content-Type", "video/mp4");
  headers.set("Content-Length", String(input.bytes.byteLength));
  const response = await uploadContentRoute(
    new Request(`http://localhost/api/publishing/v1/uploads/${input.uploadId}/content`, {
      method: "PUT",
      headers,
      body: input.bytes
    }),
    { params: Promise.resolve({ id: input.uploadId }) }
  );
  return { response, body: (await response.json()) as any };
}

async function commitUpload(input: {
  uploadId: string;
  secret: string;
  key: string;
  contentSha256: string;
}) {
  const response = await commitUploadRoute(
    new Request(`http://localhost/api/publishing/v1/uploads/${input.uploadId}/commit`, {
      method: "POST",
      headers: machineHeaders(input.secret, input.key, input.contentSha256)
    }),
    { params: Promise.resolve({ id: input.uploadId }) }
  );
  return { response, body: (await response.json()) as any };
}

test("machine Publishing API commits an allowed MP4 at Oracle's explicit publishAt and returns a durable receipt", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const scenario = await seedScenario(appDataDir);
    const machine = createMachine({
      owner: scenario.owner,
      channelId: scenario.channel.id,
      scopes: ["publication:create", "publication:read"]
    });
    const key = "oracle-video-001";
    const created = await createUpload({
      secret: machine.secret,
      key,
      body: {
        ...createBody(scenario.channel.id, scenario.bytes, scenario.contentSha256),
        description: "Source: https://www.instagram.com/reel/example/"
      }
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    const uploadId = String(created.body.upload.id);
    const uploaded = await uploadContent({
      uploadId,
      secret: machine.secret,
      key,
      contentSha256: scenario.contentSha256,
      bytes: scenario.bytes
    });
    assert.equal(uploaded.response.status, 200, JSON.stringify(uploaded.body));
    assert.equal(uploaded.body.upload.status, "uploaded");
    const committed = await commitUpload({
      uploadId,
      secret: machine.secret,
      key,
      contentSha256: scenario.contentSha256
    });
    assert.equal(committed.response.status, 201, JSON.stringify(committed.body));
    assert.equal(committed.body.receipt.publishAt, PUBLISH_AT);
    assert.equal(committed.body.receipt.contentSha256, scenario.contentSha256);
    assert.equal(committed.body.receipt.status, "queued");

    const publications = listChannelPublications(scenario.channel.id);
    assert.equal(publications.length, 1);
    assert.equal(publications[0]?.id, committed.body.receipt.publicationId);
    assert.equal(publications[0]?.scheduleMode, "custom");
    assert.equal(publications[0]?.scheduledAt, PUBLISH_AT);
    assert.equal(publications[0]?.slotIndex, -1);
    assert.equal(publications[0]?.description, "");
    const uploadReadyDelayMs = new Date(publications[0]?.uploadReadyAt ?? "").getTime() - Date.now();
    assert.ok(uploadReadyDelayMs >= 0 && uploadReadyDelayMs <= 5_000, "machine upload must become ready immediately");

    const runtimeScope = globalThis as RuntimeScope;
    const timer = runtimeScope.__clipsChannelPublicationRuntimeState__?.wakeTimer;
    if (timer) clearTimeout(timer);
    const dbBeforeRestart = getDb();
    const futureUploadReadyAt = "2040-05-05T16:07:00.000Z";
    dbBeforeRestart
      .prepare("UPDATE channel_publications SET upload_ready_at = ? WHERE id = ?")
      .run(futureUploadReadyAt, committed.body.receipt.publicationId);
    dbBeforeRestart.close();
    delete runtimeScope.__clipsAppDb;
    delete runtimeScope.__clipsChannelPublicationRuntimeState__;
    const migratedPublication = listChannelPublications(scenario.channel.id)[0];
    assert.ok(
      new Date(migratedPublication?.uploadReadyAt ?? "").getTime() <= Date.now(),
      "startup migration must release already-queued machine uploads immediately"
    );
    const staleUpdatedAt = new Date(Date.now() - 6 * 60_000).toISOString();
    getDb()
      .prepare(
        `UPDATE channel_publications
            SET status = 'uploading',
                updated_at = ?,
                lease_token = 'stale-machine-lease',
                lease_expires_at = '2040-05-05T19:07:00.000Z'
          WHERE id = ?`
      )
      .run(staleUpdatedAt, committed.body.receipt.publicationId);
    getDb().close();
    delete runtimeScope.__clipsAppDb;
    const recoveredPublication = listChannelPublications(scenario.channel.id)[0];
    assert.equal(recoveredPublication?.status, "queued");
    const recoveredLease = getDb()
      .prepare("SELECT lease_token, lease_expires_at FROM channel_publications WHERE id = ?")
      .get(committed.body.receipt.publicationId) as
      | { lease_token?: string | null; lease_expires_at?: string | null }
      | undefined;
    assert.equal(recoveredLease?.lease_token, null);
    assert.equal(recoveredLease?.lease_expires_at, null);
    const uploadRow = getDb()
      .prepare("SELECT render_export_id FROM publishing_api_uploads WHERE id = ?")
      .get(uploadId) as { render_export_id?: string } | undefined;
    const renderExport = getRenderExportById(uploadRow?.render_export_id ?? "");
    assert.ok(renderExport);
    assert.match(renderExport?.artifactFilePath ?? "", /render-exports/);

    markChannelPublicationScheduled({
      publicationId: committed.body.receipt.publicationId,
      youtubeVideoId: "youtube-video-machine-1",
      youtubeVideoUrl: "https://www.youtube.com/watch?v=youtube-video-machine-1"
    });

    const statusResponse = await getPublicationRoute(
      new Request(`http://localhost/api/publishing/v1/publications/${committed.body.receipt.publicationId}`, {
        headers: machineHeaders(machine.secret)
      }),
      { params: Promise.resolve({ id: committed.body.receipt.publicationId }) }
    );
    const statusBody = (await statusResponse.json()) as any;
    assert.equal(statusResponse.status, 200, JSON.stringify(statusBody));
    assert.equal(statusBody.receipt.publicationId, committed.body.receipt.publicationId);
    assert.equal(statusBody.receipt.status, "scheduled");
    assert.equal(statusBody.receipt.youtubeVideoId, "youtube-video-machine-1");
    assert.equal(
      statusBody.receipt.youtubeVideoUrl,
      "https://www.youtube.com/watch?v=youtube-video-machine-1"
    );
  });
});

test("channel allowlist and publication:create/publication:read scopes fail closed", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const scenario = await seedScenario(appDataDir);
    const readOnly = createMachine({
      owner: scenario.owner,
      channelId: scenario.channel.id,
      scopes: ["publication:read"],
      machineId: "oracle-read"
    });
    const createOnly = createMachine({
      owner: scenario.owner,
      channelId: scenario.channel.id,
      scopes: ["publication:create"],
      machineId: "oracle-create"
    });
    const readDenied = await createUpload({
      secret: readOnly.secret,
      key: "read-cannot-create",
      body: createBody(scenario.channel.id, scenario.bytes, scenario.contentSha256)
    });
    assert.equal(readDenied.response.status, 403);
    assert.equal(readDenied.body.code, "SCOPE_FORBIDDEN");

    const forbidden = await createUpload({
      secret: createOnly.secret,
      key: "forbidden-channel",
      body: createBody(scenario.forbiddenChannel.id, scenario.bytes, scenario.contentSha256)
    });
    assert.equal(forbidden.response.status, 403);
    assert.equal(forbidden.body.code, "CHANNEL_NOT_ALLOWED");

    const statusDenied = await getUploadRoute(
      new Request("http://localhost/api/publishing/v1/uploads/missing", {
        headers: machineHeaders(createOnly.secret)
      }),
      { params: Promise.resolve({ id: "missing" }) }
    );
    const statusBody = (await statusDenied.json()) as any;
    assert.equal(statusDenied.status, 403);
    assert.equal(statusBody.code, "SCOPE_FORBIDDEN");
  });
});

test("create and commit are idempotent, while key or payload conflicts are typed", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const scenario = await seedScenario(appDataDir);
    const machine = createMachine({
      owner: scenario.owner,
      channelId: scenario.channel.id,
      scopes: ["publication:create", "publication:read"]
    });
    const key = "idempotent-video";
    const requestBody = createBody(scenario.channel.id, scenario.bytes, scenario.contentSha256);
    const first = await createUpload({ secret: machine.secret, key, body: requestBody });
    const replay = await createUpload({ secret: machine.secret, key, body: requestBody });
    assert.equal(first.response.status, 201);
    assert.equal(replay.response.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.upload.id, first.body.upload.id);

    const conflict = await createUpload({
      secret: machine.secret,
      key,
      body: { ...requestBody, publishAt: "2040-05-05T18:08:00.000Z" }
    });
    assert.equal(conflict.response.status, 409);
    assert.equal(conflict.body.code, "IDEMPOTENCY_KEY_CONFLICT");

    await uploadContent({
      uploadId: first.body.upload.id,
      secret: machine.secret,
      key,
      contentSha256: scenario.contentSha256,
      bytes: scenario.bytes
    });
    const wrongCommitHash = await commitUpload({
      uploadId: first.body.upload.id,
      secret: machine.secret,
      key,
      contentSha256: "0".repeat(64)
    });
    assert.equal(wrongCommitHash.response.status, 409);
    assert.equal(wrongCommitHash.body.code, "IDEMPOTENCY_KEY_CONFLICT");
    const committed = await commitUpload({
      uploadId: first.body.upload.id,
      secret: machine.secret,
      key,
      contentSha256: scenario.contentSha256
    });
    const commitReplay = await commitUpload({
      uploadId: first.body.upload.id,
      secret: machine.secret,
      key,
      contentSha256: scenario.contentSha256
    });
    assert.equal(committed.response.status, 201);
    assert.equal(commitReplay.response.status, 200);
    assert.equal(commitReplay.body.replayed, true);
    assert.equal(commitReplay.body.receipt.publicationId, committed.body.receipt.publicationId);
    assert.equal(listChannelPublications(scenario.channel.id).length, 1);

    // Simulate a process stop after the queue transaction but before the API
    // receipt link was saved. The same commit must recover the durable job.
    getDb()
      .prepare(
        `UPDATE publishing_api_uploads
            SET status = 'committing', publication_id = NULL, render_export_id = NULL,
                committed_at = NULL, updated_at = ?
          WHERE id = ?`
      )
      .run(new Date().toISOString(), first.body.upload.id);
    const recovered = await commitUpload({
      uploadId: first.body.upload.id,
      secret: machine.secret,
      key,
      contentSha256: scenario.contentSha256
    });
    assert.equal(recovered.response.status, 200, JSON.stringify(recovered.body));
    assert.equal(recovered.body.replayed, true);
    assert.equal(recovered.body.receipt.publicationId, committed.body.receipt.publicationId);
    assert.equal(listChannelPublications(scenario.channel.id).length, 1);

    getDb()
      .prepare(
        "UPDATE channel_publish_integrations SET status = 'disconnected', encrypted_token_json = NULL WHERE channel_id = ?"
      )
      .run(scenario.channel.id);
    const replayAfterDisconnect = await createUpload({ secret: machine.secret, key, body: requestBody });
    assert.equal(replayAfterDisconnect.response.status, 200, JSON.stringify(replayAfterDisconnect.body));
    assert.equal(replayAfterDisconnect.body.receipt.publicationId, committed.body.receipt.publicationId);
  });
});

test("publishing credential provisioning is pure-purpose and always requires a channel allowlist", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const scenario = await seedScenario(appDataDir);
    assert.throws(
      () =>
        createMcpMachineCredential({
          workspaceId: scenario.owner.workspace.id,
          ownerUserId: scenario.owner.user.id,
          machineId: "mixed-publishing-control",
          scopes: ["publication:create", "control:write"],
          allowedChannelIds: [scenario.channel.id]
        }),
      (error: unknown) =>
        error instanceof McpMachineCredentialInputError && error.code === "PUBLISHING_SCOPE_MIX_FORBIDDEN"
    );
    assert.throws(
      () =>
        createMcpMachineCredential({
          workspaceId: scenario.owner.workspace.id,
          ownerUserId: scenario.owner.user.id,
          machineId: "missing-publishing-allowlist",
          scopes: ["publication:read"],
          allowedChannelIds: []
        }),
      (error: unknown) =>
        error instanceof McpMachineCredentialInputError && error.code === "PUBLISHING_CHANNEL_ALLOWLIST_REQUIRED"
    );
    const publishing = createMachine({
      owner: scenario.owner,
      channelId: scenario.channel.id,
      scopes: ["publication:create", "publication:read"],
      machineId: "pure-publishing"
    });
    assert.deepEqual(publishing.record.scopes, ["publication:create", "publication:read"]);
    assert.deepEqual(publishing.record.allowedChannelIds, [scenario.channel.id]);
  });
});

test("hash mismatch can be retried with the bound bytes, and concurrent states expose bounded retry semantics", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const scenario = await seedScenario(appDataDir);
    const machine = createMachine({
      owner: scenario.owner,
      channelId: scenario.channel.id,
      scopes: ["publication:create", "publication:read"]
    });
    const key = "hash-retry";
    const created = await createUpload({
      secret: machine.secret,
      key,
      body: createBody(scenario.channel.id, scenario.bytes, scenario.contentSha256)
    });
    const wrongBytes = new Uint8Array(scenario.bytes);
    wrongBytes[wrongBytes.length - 1] = (wrongBytes[wrongBytes.length - 1] ?? 0) ^ 1;
    const mismatch = await uploadContent({
      uploadId: created.body.upload.id,
      secret: machine.secret,
      key,
      contentSha256: scenario.contentSha256,
      bytes: wrongBytes
    });
    assert.equal(mismatch.response.status, 422);
    assert.equal(mismatch.body.code, "CONTENT_HASH_MISMATCH");

    const retry = await uploadContent({
      uploadId: created.body.upload.id,
      secret: machine.secret,
      key,
      contentSha256: scenario.contentSha256,
      bytes: scenario.bytes
    });
    assert.equal(retry.response.status, 200, JSON.stringify(retry.body));

    getDb().prepare("UPDATE publishing_api_uploads SET status = 'committing', updated_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      created.body.upload.id
    );
    const busy = await commitUpload({
      uploadId: created.body.upload.id,
      secret: machine.secret,
      key,
      contentSha256: scenario.contentSha256
    });
    assert.equal(busy.response.status, 409);
    assert.equal(busy.body.code, "COMMIT_IN_PROGRESS");
    assert.equal(busy.body.retryable, true);
    assert.equal(busy.response.headers.get("retry-after"), "2");
  });
});

test("corrupted ftyp bytes are rejected by ffprobe and content duplicates are blocked across keys", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const scenario = await seedScenario(appDataDir);
    const machine = createMachine({
      owner: scenario.owner,
      channelId: scenario.channel.id,
      scopes: ["publication:create", "publication:read"]
    });
    const fakeMp4 = new Uint8Array(64);
    fakeMp4.set(new TextEncoder().encode("ftyp"), 4);
    const fakeHash = createHash("sha256").update(fakeMp4).digest("hex");
    const fakeCreated = await createUpload({
      secret: machine.secret,
      key: "corrupted-mp4",
      body: createBody(scenario.channel.id, fakeMp4, fakeHash)
    });
    const corrupted = await uploadContent({
      uploadId: fakeCreated.body.upload.id,
      secret: machine.secret,
      key: "corrupted-mp4",
      contentSha256: fakeHash,
      bytes: fakeMp4
    });
    assert.equal(corrupted.response.status, 422);
    assert.equal(corrupted.body.code, "INVALID_MP4");

    const first = await createUpload({
      secret: machine.secret,
      key: "content-original",
      body: createBody(scenario.channel.id, scenario.bytes, scenario.contentSha256)
    });
    assert.equal(first.response.status, 201);
    const duplicate = await createUpload({
      secret: machine.secret,
      key: "content-duplicate",
      body: { ...createBody(scenario.channel.id, scenario.bytes, scenario.contentSha256), title: "Different title" }
    });
    assert.equal(duplicate.response.status, 409);
    assert.equal(duplicate.body.code, "DUPLICATE_CONTENT");

    const uploaded = await uploadContent({
      uploadId: first.body.upload.id,
      secret: machine.secret,
      key: "content-original",
      contentSha256: scenario.contentSha256,
      bytes: scenario.bytes
    });
    assert.equal(uploaded.response.status, 200, JSON.stringify(uploaded.body));
    const stored = getDb()
      .prepare("SELECT source_path FROM publishing_api_uploads WHERE id = ?")
      .get(first.body.upload.id) as { source_path?: string } | undefined;
    assert.ok(stored?.source_path);
    await writeFile(stored.source_path, fakeMp4);
    getDb()
      .prepare(
        `UPDATE publishing_api_uploads
            SET content_length = ?, content_sha256 = ?, uploaded_size_bytes = ?, uploaded_sha256 = ?
          WHERE id = ?`
      )
      .run(fakeMp4.byteLength, fakeHash, fakeMp4.byteLength, fakeHash, first.body.upload.id);
    const corruptedAtCommit = await commitUpload({
      uploadId: first.body.upload.id,
      secret: machine.secret,
      key: "content-original",
      contentSha256: fakeHash
    });
    assert.equal(corruptedAtCommit.response.status, 422);
    assert.equal(corruptedAtCommit.body.code, "INVALID_MP4");
    const failedRow = getDb()
      .prepare("SELECT status FROM publishing_api_uploads WHERE id = ?")
      .get(first.body.upload.id) as { status?: string } | undefined;
    assert.equal(failedRow?.status, "failed");
  });
});

test("connected metadata without a stored server-side YouTube credential is treated as disconnected", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const scenario = await seedScenario(appDataDir);
    const noCredentialChannel = await createChannel({
      workspaceId: scenario.owner.workspace.id,
      creatorUserId: scenario.owner.user.id,
      name: "No Credential",
      username: "no_credential"
    });
    saveChannelPublishIntegration({
      workspaceId: scenario.owner.workspace.id,
      channelId: noCredentialChannel.id,
      userId: scenario.owner.user.id,
      status: "connected",
      credential: null,
      googleAccountEmail: "owner@example.com",
      selectedYoutubeChannelId: "youtube-no-credential",
      selectedYoutubeChannelTitle: "No Credential",
      selectedYoutubeChannelCustomUrl: "@no_credential",
      availableChannels: [],
      scopes: ["youtube.upload"],
      lastError: null
    });
    const machine = createMachine({
      owner: scenario.owner,
      channelId: noCredentialChannel.id,
      scopes: ["publication:create", "publication:read"]
    });
    const created = await createUpload({
      secret: machine.secret,
      key: "no-server-credential",
      body: createBody(noCredentialChannel.id, scenario.bytes, scenario.contentSha256)
    });
    assert.equal(created.response.status, 409);
    assert.equal(created.body.code, "DESTINATION_NOT_READY");
  });
});
