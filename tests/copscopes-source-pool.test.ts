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

test("CopScopes control API can restore a reviewed canceled publication into a custom schedule", async () => {
  await withIsolatedAppData(async () => {
    const { owner, channel } = await seedCopscopes();
    const chat = await createOrGetChatByUrl("https://www.instagram.com/reel/RESTORE1/", channel.id);
    const stage3Job = enqueueStage3Job({
      workspaceId: owner.workspace.id,
      userId: owner.user.id,
      kind: "render",
      payloadJson: JSON.stringify({ chatId: chat.id, channelId: channel.id })
    });
    const artifactPath = path.join(process.env.APP_DATA_DIR!, "copscopes-control-restore.mp4");
    await writeFile(artifactPath, "video");
    const renderExport = createRenderExport({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      chatId: chat.id,
      stage3JobId: stage3Job.id,
      artifactFileName: "copscopes-control-restore.mp4",
      artifactFilePath: artifactPath,
      artifactMimeType: "video/mp4",
      artifactSizeBytes: 5,
      renderTitle: "Reviewed CopScopes render",
      sourceUrl: "https://www.instagram.com/reel/RESTORE1/",
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
      title: "Reviewed CopScopes render",
      description: "desc",
      tags: [],
      notifySubscribers: true,
      needsReview: false,
      createdByUserId: owner.user.id
    });
    getDb()
      .prepare(
        `UPDATE channel_publications
            SET status = 'canceled',
                canceled_at = '2039-12-31T10:00:00.000Z',
                youtube_video_id = 'deleted-remote-video',
                youtube_video_url = 'https://youtu.be/deleted-remote-video'
          WHERE id = ?`
      )
      .run(publication.id);
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
          tool: "clips_control_schedule_publication",
          input: {
            channelUsername: "copscopes",
            publicationId: publication.id,
            scheduledAtLocal: "2040-01-02T21:15"
          }
        })
      })
    );
    const body = (await response.json()) as {
      restoredFromCanceled?: boolean;
      publication?: {
        status?: string;
        canceledAt?: string | null;
        scheduleMode?: string;
        youtubeVideoId?: string | null;
      };
    };
    const stored = getChannelPublicationById(publication.id);

    assert.equal(response.status, 200);
    assert.equal(body.restoredFromCanceled, true);
    assert.equal(body.publication?.status, "queued");
    assert.equal(body.publication?.canceledAt, null);
    assert.equal(body.publication?.scheduleMode, "custom");
    assert.equal(body.publication?.youtubeVideoId, null);
    assert.equal(stored?.status, "queued");
    assert.equal(stored?.canceledAt, null);
    assert.equal(stored?.scheduleMode, "custom");
    assert.equal(stored?.youtubeVideoId, null);
  });
});

test("CopScopes control API re-cancels a reviewed publication when scheduling fails", async () => {
  await withIsolatedAppData(async () => {
    const { owner, channel } = await seedCopscopes();
    const controlToken = createMcpAccessToken({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      expiresInDays: 1,
      scopes: ["flow:read", "control:write"]
    });

    async function createPublicationFixture(shortcode: string, title: string) {
      const chat = await createOrGetChatByUrl(`https://www.instagram.com/reel/${shortcode}/`, channel.id);
      const stage3Job = enqueueStage3Job({
        workspaceId: owner.workspace.id,
        userId: owner.user.id,
        kind: "render",
        payloadJson: JSON.stringify({ chatId: chat.id, channelId: channel.id })
      });
      const artifactPath = path.join(process.env.APP_DATA_DIR!, `${shortcode}.mp4`);
      await writeFile(artifactPath, "video");
      const renderExport = createRenderExport({
        workspaceId: owner.workspace.id,
        channelId: channel.id,
        chatId: chat.id,
        stage3JobId: stage3Job.id,
        artifactFileName: `${shortcode}.mp4`,
        artifactFilePath: artifactPath,
        artifactMimeType: "video/mp4",
        artifactSizeBytes: 5,
        renderTitle: title,
        sourceUrl: `https://www.instagram.com/reel/${shortcode}/`,
        snapshotJson: "{}",
        createdByUserId: owner.user.id
      });
      return createChannelPublication({
        workspaceId: owner.workspace.id,
        channelId: channel.id,
        chatId: chat.id,
        renderExportId: renderExport.id,
        scheduleMode: "custom",
        scheduledAt: "2040-01-02T18:15:00.000Z",
        uploadReadyAt: "2040-01-02T16:15:00.000Z",
        slotDate: "2040-01-02",
        slotIndex: -1,
        title,
        description: "desc",
        tags: [],
        notifySubscribers: true,
        needsReview: false,
        createdByUserId: owner.user.id
      });
    }

    const occupied = await createPublicationFixture("OCCUPIED1", "Occupied CopScopes render");
    const reviewed = await createPublicationFixture("RESTORE2", "Reviewed CopScopes render two");
    getDb()
      .prepare(
        `UPDATE channel_publications
            SET status = 'canceled',
                canceled_at = '2039-12-31T10:00:00.000Z'
          WHERE id = ?`
      )
      .run(reviewed.id);

    const response = await copscopesControlRoute(
      new Request("http://localhost/api/admin/control/copscopes", {
        method: "POST",
        headers: {
          authorization: `Bearer ${controlToken.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          tool: "clips_control_schedule_publication",
          input: {
            channelUsername: "copscopes",
            publicationId: reviewed.id,
            scheduledAtLocal: "2040-01-02T21:15"
          }
        })
      })
    );
    const storedReviewed = getChannelPublicationById(reviewed.id);
    const storedOccupied = getChannelPublicationById(occupied.id);

    assert.equal(response.status, 500);
    assert.match(JSON.stringify(await response.json()), /занято/);
    assert.equal(storedReviewed?.status, "canceled");
    assert.ok(storedReviewed?.canceledAt);
    assert.equal(storedOccupied?.status, "queued");
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
    assert.equal(crop.y >= 0.42, true);
    assert.equal(crop.height >= 0.32, true);
    assert.equal(crop.height <= 0.4, true);
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
    assert.equal(reel.crop?.y, 0.46);
    assert.equal(reel.crop?.height, 0.34);
    assert.equal((reel.cropConfidence ?? 0) >= 0.78, true);
  });
});

test("CopScopes source crop upgrades prior v2/v3/v4 crops that either leaked meta or over-tightened the source", async () => {
  await withIsolatedAppData(async () => {
    for (const previous of [
      { source: "copscopes-tight-source-window-v2", height: 0.57 },
      { source: "copscopes-tight-source-window-v3", height: 0.37 },
      { source: "copscopes-tight-source-window-v4", height: 0.24 }
    ]) {
      const crop = detectCopscopesSourceCrop({
        crop: {
          enabled: true,
          x: 0.02,
          y: 0.43,
          width: 0.96,
          height: previous.height,
          confidence: 0.88,
          source: previous.source
        },
        cropConfidence: 0.88
      });

      assert.equal(crop.source, COPSCOPES_TIGHT_SOURCE_CROP_SOURCE);
      assert.equal(crop.height, 0.34);
    }
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

test("CopScopes daily selector skips duplicate incidents even when Instagram shortcodes differ", async () => {
  await withIsolatedAppData(async () => {
    const { owner, channel } = await seedCopscopes();
    const duplicateCaption =
      "Police in California released dashcam footage showing a domestic violence suspect jumping onto a moving car before the blue sedan kept rolling through traffic and officers closed in.";
    importCopscopesSourcePool({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      items: [
        {
          url: "https://www.instagram.com/copscopes/reel/DUP1/",
          categorySlug: "vehicle-pursuit",
          caption: duplicateCaption,
          viewCount: 5000
        },
        {
          url: "https://www.instagram.com/copscopes/reel/DUP2/",
          categorySlug: "vehicle-pursuit",
          caption: duplicateCaption,
          viewCount: 4900
        },
        {
          url: "https://www.instagram.com/copscopes/reel/UNIQ1/",
          categorySlug: "vehicle-pursuit",
          caption:
            "A stolen truck spins out after a PIT attempt, and the driver runs across the shoulder before deputies catch him near the guardrail.",
          viewCount: 4800
        }
      ]
    });
    setActiveCopscopesCategory({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      categorySlug: "vehicle-pursuit"
    });

    const selected = selectCopscopesDailyCandidates({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      limit: 2,
      markInProgress: true
    });

    assert.deepEqual(
      selected.reels.map((reel) => reel.shortcode),
      ["DUP1", "UNIQ1"]
    );
    const listed = listCopscopesSourcePool({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      categorySlug: "vehicle-pursuit"
    });
    const duplicate = listed.reels.find((reel) => reel.shortcode === "DUP2");
    assert.equal(duplicate?.status, "skipped");
    assert.match(duplicate?.lastError ?? "", /duplicate_copscopes_story/);
  });
});
