import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { POST as copscopesControlRoute } from "../app/api/admin/control/copscopes/route";
import { createChannel, createOrGetChatByUrl } from "../lib/chat-history";
import {
  authenticateMcpControlWriteToken,
  authenticateMcpFlowReadToken,
  createMcpAccessToken
} from "../lib/mcp-token-store";
import {
  detectCopscopesSourceCrop,
  importCopscopesSourcePool,
  listCopscopesSourcePool,
  markCopscopesSourceReel,
  resetCopscopesSourceReelForRetry,
  selectCopscopesDailyCandidates,
  setActiveCopscopesCategory
} from "../lib/copscopes-source-pool";
import { COPSCOPES_TIGHT_SOURCE_CROP_SOURCE } from "../lib/copscopes-quality-gate";
import { getDb } from "../lib/db/client";
import {
  createChannelPublication,
  createRenderExport,
  getChannelPublicationById
} from "../lib/publication-store";
import { enqueueStage3Job } from "../lib/stage3-job-store";
import { bootstrapOwner } from "../lib/team-store";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-copscopes-source-pool-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousManagedTemplatesRoot = process.env.MANAGED_TEMPLATES_ROOT;
  process.env.APP_DATA_DIR = appDataDir;
  process.env.MANAGED_TEMPLATES_ROOT = path.join(appDataDir, "managed-templates");
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;

  try {
    return await run();
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    if (previousManagedTemplatesRoot === undefined) {
      delete process.env.MANAGED_TEMPLATES_ROOT;
    } else {
      process.env.MANAGED_TEMPLATES_ROOT = previousManagedTemplatesRoot;
    }
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    await rm(appDataDir, { recursive: true, force: true });
  }
}

async function seedCopscopes() {
  const owner = await bootstrapOwner({
    workspaceName: "CopScopes Pool",
    email: "owner@example.com",
    password: "Password123!",
    displayName: "Owner"
  });
  const channel = await createChannel({
    workspaceId: owner.workspace.id,
    creatorUserId: owner.user.id,
    name: "CopScopes",
    username: "copscopes"
  });
  return { owner, channel };
}

test("MCP flow:read token cannot authenticate control tools while control:write can", async () => {
  await withIsolatedAppData(async () => {
    const { owner } = await seedCopscopes();
    const readToken = createMcpAccessToken({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      expiresInDays: 1
    });
    assert.ok(authenticateMcpFlowReadToken(readToken.token));
    assert.equal(authenticateMcpControlWriteToken(readToken.token), null);

    const controlToken = createMcpAccessToken({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      expiresInDays: 1,
      scopes: ["flow:read", "control:write"]
    });
    assert.ok(authenticateMcpFlowReadToken(controlToken.token));
    assert.ok(authenticateMcpControlWriteToken(controlToken.token));
  });
});

test("CopScopes control API rejects flow:read tokens and accepts control:write tokens", async () => {
  await withIsolatedAppData(async () => {
    const { owner } = await seedCopscopes();
    const readToken = createMcpAccessToken({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      expiresInDays: 1
    });
    const readResponse = await copscopesControlRoute(
      new Request("http://localhost/api/admin/control/copscopes", {
        method: "POST",
        headers: {
          authorization: `Bearer ${readToken.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          tool: "clips_control_list_source_pool",
          input: { channelUsername: "copscopes" }
        })
      })
    );
    assert.equal(readResponse.status, 401);

    const controlToken = createMcpAccessToken({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      expiresInDays: 1,
      scopes: ["flow:read", "control:write"]
    });
    const controlResponse = await copscopesControlRoute(
      new Request("http://localhost/api/admin/control/copscopes", {
        method: "POST",
        headers: {
          authorization: `Bearer ${controlToken.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          tool: "clips_control_list_source_pool",
          input: { channelUsername: "copscopes" }
        })
      })
    );
    const body = (await controlResponse.json()) as { categories?: unknown[] };
    assert.equal(controlResponse.status, 200);
    assert.ok(Array.isArray(body.categories));
  });
});

test("CopScopes control API can cancel an owner-approved published publication with control:write", async () => {
  await withIsolatedAppData(async () => {
    const { owner, channel } = await seedCopscopes();
    const chat = await createOrGetChatByUrl("https://www.instagram.com/reel/CANCEL1/", channel.id);
    const stage3Job = enqueueStage3Job({
      workspaceId: owner.workspace.id,
      userId: owner.user.id,
      kind: "render",
      payloadJson: JSON.stringify({ chatId: chat.id, channelId: channel.id })
    });
    const artifactPath = path.join(process.env.APP_DATA_DIR!, "copscopes-control-cancel.mp4");
    await writeFile(artifactPath, "video");
    const renderExport = createRenderExport({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      chatId: chat.id,
      stage3JobId: stage3Job.id,
      artifactFileName: "copscopes-control-cancel.mp4",
      artifactFilePath: artifactPath,
      artifactMimeType: "video/mp4",
      artifactSizeBytes: 5,
      renderTitle: "Unsafe CopScopes render",
      sourceUrl: "https://www.instagram.com/reel/CANCEL1/",
      snapshotJson: "{}",
      createdByUserId: owner.user.id
    });
    const publication = createChannelPublication({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      chatId: chat.id,
      renderExportId: renderExport.id,
      scheduleMode: "slot",
      scheduledAt: "2040-01-01T10:00:00.000Z",
      uploadReadyAt: "2040-01-01T09:00:00.000Z",
      slotDate: "2040-01-01",
      slotIndex: 0,
      title: "Unsafe CopScopes render",
      description: "desc",
      tags: [],
      notifySubscribers: true,
      needsReview: false,
      createdByUserId: owner.user.id
    });
    getDb().prepare("UPDATE channel_publications SET status = 'published' WHERE id = ?").run(publication.id);
    const controlToken = createMcpAccessToken({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      expiresInDays: 1,
      scopes: ["flow:read", "control:write"]
    });

    const response = await copscopesControlRoute(
      new Request("http://localhost/api/admin/control/copscopes", {
        method: "POST",
        headers: {
          authorization: `Bearer ${controlToken.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          tool: "clips_control_cancel_publication",
          input: {
            channelUsername: "copscopes",
            publicationId: publication.id,
            allowPublished: true
          }
        })
      })
    );
    const body = (await response.json()) as { publication?: { status?: string } };

    assert.equal(response.status, 200);
    assert.equal(body.publication?.status, "canceled");
    assert.equal(getChannelPublicationById(publication.id)?.status, "canceled");
  });
});

test("CopScopes source pool import dedupes by canonical Instagram URL", async () => {
  await withIsolatedAppData(async () => {
    const { owner, channel } = await seedCopscopes();
    const result = importCopscopesSourcePool({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      items: [
        {
          url: "https://www.instagram.com/copscopes/reel/ABC123/?igsh=test",
          title: "Police chase ends in crash",
          viewCount: 1000
        },
        {
          url: "https://www.instagram.com/reel/ABC123/",
          title: "Duplicate canonical URL",
          viewCount: 2000
        },
        {
          url: "https://www.instagram.com/copscopes/reel/DEF456/",
          caption: "Traffic stop turns into arrest",
          viewCount: 3000
        }
      ]
    });

    assert.equal(result.created, 2);
    assert.equal(result.duplicates, 1);
    const listed = listCopscopesSourcePool({
      workspaceId: owner.workspace.id,
      channelId: channel.id
    });
    assert.equal(listed.reels.length, 2);
    assert.deepEqual(
      listed.reels.map((reel) => reel.canonicalUrl).sort(),
      ["https://www.instagram.com/reel/ABC123/", "https://www.instagram.com/reel/DEF456/"]
    );
  });
});

test("CopScopes source pool upgrades weak default crops to the tight source-window crop", async () => {
  await withIsolatedAppData(async () => {
    const { owner, channel } = await seedCopscopes();
    const crop = detectCopscopesSourceCrop({
      crop: {
        enabled: true,
        x: 0.08,
        y: 0.16,
        width: 0.84,
        height: 0.66,
        confidence: 0.62,
        source: "copscopes-default-inner-frame"
      },
      cropConfidence: 0.62
    });

    assert.equal(crop.source, COPSCOPES_TIGHT_SOURCE_CROP_SOURCE);
    assert.equal(crop.y >= 0.38, true);
    assert.equal(crop.height <= 0.42, true);
    assert.equal((crop.confidence ?? 0) >= 0.78, true);

    importCopscopesSourcePool({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      items: [
        {
          url: "https://www.instagram.com/copscopes/reel/CROP1/",
          categorySlug: "vehicle-pursuit"
        }
      ]
    });
    const reel = listCopscopesSourcePool({
      workspaceId: owner.workspace.id,
      channelId: channel.id
    }).reels[0];

    assert.equal(reel.crop?.source, COPSCOPES_TIGHT_SOURCE_CROP_SOURCE);
    assert.equal(reel.crop?.y, 0.43);
    assert.equal(reel.crop?.height, 0.37);
    assert.equal((reel.cropConfidence ?? 0) >= 0.78, true);
  });
});

test("CopScopes source crop upgrades prior v2 crops that still included the lower watermark band", async () => {
  await withIsolatedAppData(async () => {
    const crop = detectCopscopesSourceCrop({
      crop: {
        enabled: true,
        x: 0.02,
        y: 0.43,
        width: 0.96,
        height: 0.57,
        confidence: 0.88,
        source: "copscopes-tight-source-window-v2"
      },
      cropConfidence: 0.88
    });

    assert.equal(crop.source, COPSCOPES_TIGHT_SOURCE_CROP_SOURCE);
    assert.equal(crop.height, 0.37);
  });
});

test("CopScopes source pool reset makes a failed Reel available for retry", async () => {
  await withIsolatedAppData(async () => {
    const { owner, channel } = await seedCopscopes();
    importCopscopesSourcePool({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      items: [
        {
          url: "https://www.instagram.com/copscopes/reel/RESET1/",
          categorySlug: "vehicle-pursuit",
          viewCount: 1000
        }
      ]
    });
    const reel = listCopscopesSourcePool({
      workspaceId: owner.workspace.id,
      channelId: channel.id
    }).reels[0];
    markCopscopesSourceReel({
      reelId: reel.id,
      status: "failed",
      chatId: "chat-reset",
      stage2RunId: "stage2-reset",
      stage3JobId: "stage3-reset",
      error: "worker timeout"
    });

    const reset = resetCopscopesSourceReelForRetry({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      shortcode: "RESET1"
    });

    assert.equal(reset.status, "available");
    assert.equal(reset.consumedChatId, null);
    assert.equal(reset.consumedStage2RunId, null);
    assert.equal(reset.consumedStage3JobId, null);
    assert.equal(reset.lastError, null);
  });
});

test("CopScopes daily selector skips unavailable items and exhausts empty active category", async () => {
  await withIsolatedAppData(async () => {
    const { owner, channel } = await seedCopscopes();
    importCopscopesSourcePool({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      items: [
        { url: "https://www.instagram.com/copscopes/reel/A1/", categorySlug: "vehicle-pursuit", viewCount: 10 },
        { url: "https://www.instagram.com/copscopes/reel/A2/", categorySlug: "vehicle-pursuit", viewCount: 20 },
        { url: "https://www.instagram.com/copscopes/reel/A3/", categorySlug: "traffic-stop", viewCount: 30 }
      ]
    });
    setActiveCopscopesCategory({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      categorySlug: "vehicle-pursuit"
    });

    const first = selectCopscopesDailyCandidates({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      limit: 1,
      markInProgress: true
    });
    assert.equal(first.reels.length, 1);
    assert.equal(first.reels[0].status, "in_progress");

    const second = selectCopscopesDailyCandidates({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      limit: 5,
      markInProgress: true
    });
    assert.equal(second.reels.length, 1);
    assert.equal(second.reels[0].shortcode, "A1");

    const exhausted = selectCopscopesDailyCandidates({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      limit: 5,
      markInProgress: true
    });
    assert.equal(exhausted.exhausted, true);
    assert.equal(exhausted.reels.length, 0);
    const category = listCopscopesSourcePool({
      workspaceId: owner.workspace.id,
      channelId: channel.id
    }).categories.find((candidate) => candidate.slug === "vehicle-pursuit");
    assert.equal(category?.status, "exhausted");
  });
});
