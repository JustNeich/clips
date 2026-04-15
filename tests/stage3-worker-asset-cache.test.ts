import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { GET as getStage3WorkerAsset } from "../app/api/stage3/worker/assets/[assetId]/route";
import { saveChannelAssetFile } from "../lib/channel-assets";
import { createChannelAsset } from "../lib/chat-history";
import { maybeDownloadStage3WorkerAsset } from "../lib/stage3-worker-asset-client";
import { bootstrapOwner } from "../lib/team-store";
import { exchangeStage3WorkerPairingToken, issueStage3WorkerPairingToken } from "../lib/stage3-worker-store";

test("worker asset downloads stream into a persistent cache and reuse the cached file", { concurrency: false }, async () => {
  const appDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "stage3-worker-asset-cache-app-"));
  const workerRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stage3-worker-asset-cache-worker-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousServerOrigin = process.env.STAGE3_WORKER_SERVER_ORIGIN;
  const previousSessionToken = process.env.STAGE3_WORKER_SESSION_TOKEN;
  const previousInstallRoot = process.env.STAGE3_WORKER_INSTALL_ROOT;
  const originalFetch = globalThis.fetch;

  process.env.APP_DATA_DIR = appDataDir;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;

  try {
    const owner = await bootstrapOwner({
      workspaceName: "Stage 3 Worker Assets",
      email: "worker-assets@example.com",
      password: "Password123!",
      displayName: "Worker Assets"
    });
    const chatHistory = await import("../lib/chat-history");
    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Worker Asset Channel",
      username: "worker_asset_channel"
    });
    const assetId = "musicasset01";
    const saved = await saveChannelAssetFile({
      channelId: channel.id,
      assetId,
      mimeType: "audio/mpeg",
      buffer: Buffer.from("stage3-worker-asset-cache")
    });
    await createChannelAsset({
      channelId: channel.id,
      kind: "music",
      fileName: saved.fileName,
      originalName: "theme-song.mp3",
      mimeType: "audio/mpeg",
      sizeBytes: Buffer.byteLength("stage3-worker-asset-cache"),
      assetId
    });

    const { token: pairingToken } = issueStage3WorkerPairingToken({
      workspaceId: owner.workspace.id,
      userId: owner.user.id
    });
    const { sessionToken } = exchangeStage3WorkerPairingToken({
      pairingToken,
      label: "Worker Asset Cache",
      platform: "darwin-arm64"
    });

    process.env.STAGE3_WORKER_SERVER_ORIGIN = "https://clips.example.com";
    process.env.STAGE3_WORKER_SESSION_TOKEN = sessionToken;
    process.env.STAGE3_WORKER_INSTALL_ROOT = workerRoot;

    let fetchCalls = 0;
    globalThis.fetch = (async (input, init) => {
      fetchCalls += 1;
      assert.equal(String(input), `https://clips.example.com/api/stage3/worker/assets/${assetId}?channelId=${channel.id}`);
      assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${sessionToken}`);
      return getStage3WorkerAsset(
        new Request(String(input), {
          headers: init?.headers,
          signal: init?.signal
        }),
        { params: Promise.resolve({ assetId }) }
      );
    }) as typeof fetch;

    const first = await maybeDownloadStage3WorkerAsset({
      channelId: channel.id,
      assetId,
      tmpDir: workerRoot
    });
    const second = await maybeDownloadStage3WorkerAsset({
      channelId: channel.id,
      assetId,
      tmpDir: workerRoot
    });

    assert.ok(first);
    assert.ok(second);
    assert.equal(fetchCalls, 1);
    assert.equal(first?.filePath, second?.filePath);
    assert.equal(first?.mimeType, "audio/mpeg");
    assert.equal(path.dirname(first?.filePath ?? ""), path.join(workerRoot, "cache", "assets"));
    assert.equal(await fs.readFile(first?.filePath ?? "", "utf-8"), "stage3-worker-asset-cache");
    assert.ok(
      await fs
        .access(path.join(workerRoot, "cache", "assets", `asset-${assetId}.json`))
        .then(() => true)
        .catch(() => false)
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    if (previousServerOrigin === undefined) {
      delete process.env.STAGE3_WORKER_SERVER_ORIGIN;
    } else {
      process.env.STAGE3_WORKER_SERVER_ORIGIN = previousServerOrigin;
    }
    if (previousSessionToken === undefined) {
      delete process.env.STAGE3_WORKER_SESSION_TOKEN;
    } else {
      process.env.STAGE3_WORKER_SESSION_TOKEN = previousSessionToken;
    }
    if (previousInstallRoot === undefined) {
      delete process.env.STAGE3_WORKER_INSTALL_ROOT;
    } else {
      process.env.STAGE3_WORKER_INSTALL_ROOT = previousInstallRoot;
    }
    await fs.rm(workerRoot, { recursive: true, force: true });
    await fs.rm(appDataDir, { recursive: true, force: true });
  }
});
