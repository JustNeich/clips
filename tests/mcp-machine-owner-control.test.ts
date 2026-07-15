import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { GET as getAdminFlows } from "../app/api/admin/flows/route";
import { POST as ownerControlRoute } from "../app/api/admin/control/route";
import {
  appendChatEvent,
  createChannel,
  createOrGetChatByUrl,
  getChannelById
} from "../lib/chat-history";
import { buildPublicationSlotCandidateFromDateAndIndex, DEFAULT_CHANNEL_PUBLISH_SETTINGS } from "../lib/channel-publishing";
import {
  authenticateMcpMachineCredentialForScope,
  createMcpMachineCredential
} from "../lib/mcp-machine-credential-store";
import { createMcpAccessToken } from "../lib/mcp-token-store";
import { getDb } from "../lib/db/client";
import {
  createChannelPublication,
  createRenderExport,
  getChannelPublicationById,
  getChannelPublishSettings
} from "../lib/publication-store";
import { completeStage3Job, enqueueStage3Job, getStage3Job } from "../lib/stage3-job-store";
import { bootstrapOwner } from "../lib/team-store";

async function withIsolatedAppData<T>(run: (appDataDir: string) => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-mcp-machine-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousManagedTemplatesRoot = process.env.MANAGED_TEMPLATES_ROOT;
  process.env.APP_DATA_DIR = appDataDir;
  process.env.MANAGED_TEMPLATES_ROOT = path.join(appDataDir, "managed-templates");
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;

  try {
    return await run(appDataDir);
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

async function seedOwnerControl(appDataDir: string) {
  const owner = await bootstrapOwner({
    workspaceName: "Owner MCP",
    email: "owner@example.com",
    password: "Password123!",
    displayName: "Owner"
  });
  const channel = await createChannel({
    workspaceId: owner.workspace.id,
    creatorUserId: owner.user.id,
    name: "Owner Channel",
    username: "owner-channel"
  });
  const chat = await createOrGetChatByUrl("https://youtube.com/watch?v=owner-mcp-1", channel.id);
  const artifactPath = path.join(appDataDir, "owner.mp4");
  await writeFile(artifactPath, "video");
  const stage3 = enqueueStage3Job({
    workspaceId: owner.workspace.id,
    userId: owner.user.id,
    kind: "render",
    payloadJson: JSON.stringify({ chatId: chat.id, channelId: channel.id })
  });
  const renderExport = createRenderExport({
    workspaceId: owner.workspace.id,
    channelId: channel.id,
    chatId: chat.id,
    stage3JobId: stage3.id,
    artifactFileName: "owner.mp4",
    artifactFilePath: artifactPath,
    artifactMimeType: "video/mp4",
    artifactSizeBytes: 5,
    renderTitle: "Owner MCP video",
    sourceUrl: chat.url,
    snapshotJson: "{}",
    createdByUserId: owner.user.id
  });
  const slot = buildPublicationSlotCandidateFromDateAndIndex({
    settings: DEFAULT_CHANNEL_PUBLISH_SETTINGS,
    slotDate: "2040-01-01",
    slotIndex: 0
  });
  const publication = createChannelPublication({
    workspaceId: owner.workspace.id,
    channelId: channel.id,
    chatId: chat.id,
    renderExportId: renderExport.id,
    scheduleMode: "slot",
    scheduledAt: slot.scheduledAt,
    uploadReadyAt: slot.uploadReadyAt,
    slotDate: slot.slotDate,
    slotIndex: slot.slotIndex,
    title: "Owner MCP video",
    description: "desc",
    tags: [],
    notifySubscribers: false,
    needsReview: false,
    createdByUserId: owner.user.id
  });
  return { owner, channel, chat, publication };
}

async function appendStage2CaptionEvent(chatId: string): Promise<void> {
  await appendChatEvent(chatId, {
    role: "assistant",
    type: "stage2",
    text: "Stage 2 ready",
    data: {
      source: {
        url: "https://youtube.com/watch?v=owner-mcp-1",
        title: "Owner MCP source",
        totalComments: 0,
        topComments: [],
        allComments: [],
        commentsUsedForPrompt: 0
      },
      output: {
        captionOptions: [
          {
            option: 1,
            top: "SERVER SNAPSHOT TOP",
            bottom:
              "Server-side Stage 2 caption text must reach the complete MCP snapshot before every approved render.",
            highlights: { top: [], bottom: [] }
          }
        ],
        finalPick: { option: 1 },
        titleOptions: [{ option: 1, title: "Owner MCP video" }],
        sourceOverlayOptions: [{ option: 1, text: "source: owner mcp" }],
        sourceOverlayFinalPick: { option: 1 }
      }
    }
  });
}

function postOwnerControl(token: string, body: unknown): Promise<Response> {
  return ownerControlRoute(
    new Request("http://localhost/api/admin/control", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    })
  );
}

const APPROVED_VISUAL_GATE = {
  status: "approved",
  source: "inner-video-editor-loop",
  judgeVerdict: "approved",
  innerVideoOnly: true,
  donorWrapperVisible: false,
  approvedAt: "2040-01-01T00:00:00.000Z",
  previewFrames: ["preview/full-phone-01.png"],
  overlayFrames: ["overlay/source-01.png"],
  cleanExperimentId: "test-clean-run"
};

test("machine credential can read flows and owner status while short flow token cannot use owner control", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const { owner } = await seedOwnerControl(appDataDir);
    const machine = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "macmini-agent"
    });
    assert.ok(authenticateMcpMachineCredentialForScope(machine.secret, "flow:read"));
    assert.ok(authenticateMcpMachineCredentialForScope(machine.secret, "integration:readiness"));

    const flowResponse = await getAdminFlows(
      new Request("http://localhost/api/admin/flows", {
        headers: { authorization: `Bearer ${machine.secret}` }
      })
    );
    assert.equal(flowResponse.status, 200);

    const statusResponse = await postOwnerControl(machine.secret, {
      tool: "clips_owner_status",
      input: {}
    });
    assert.equal(statusResponse.status, 200);

    const shortToken = createMcpAccessToken({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      scopes: ["flow:read"]
    });
    const rejected = await postOwnerControl(shortToken.token, {
      tool: "clips_owner_status",
      input: {}
    });
    assert.equal(rejected.status, 401);
  });
});

test("clips_owner_list_render_exports returns only judge-approved montages, filtered by template", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const { owner, channel, chat } = await seedOwnerControl(appDataDir);
    const machine = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "macmini-agent"
    });

    const makeExport = (templateId: string, approved: boolean, title: string) => {
      const job = enqueueStage3Job({
        workspaceId: owner.workspace.id,
        userId: owner.user.id,
        kind: "render",
        payloadJson: JSON.stringify({ chatId: chat.id, channelId: channel.id })
      });
      const snapshot = {
        clipStartSec: 9.2,
        clipDurationSec: 28.5,
        focusX: 0.5,
        focusY: 0.4,
        renderPlan: {
          templateId,
          sourceCrop: { enabled: true, x: 0, y: 0.31, width: 1, height: 0.51, source: "editor-controlled" },
          videoFit: "contain",
          videoZoom: 1,
          durationMode: "source_full",
          segments: [{ startSec: 0, endSec: 28.5, speed: 1, focusY: 0.4 }],
          watermarkBlurs: [],
          mirrorEnabled: false
        },
        zoroKingApproval: approved
          ? APPROVED_VISUAL_GATE
          : { status: "needs_rework", judgeVerdict: "needs_rework" }
      };
      return createRenderExport({
        workspaceId: owner.workspace.id,
        channelId: channel.id,
        chatId: chat.id,
        stage3JobId: job.id,
        artifactFileName: `${title}.mp4`,
        artifactFilePath: path.join(appDataDir, `${title}.mp4`),
        artifactMimeType: "video/mp4",
        artifactSizeBytes: 5,
        renderTitle: title,
        sourceUrl: chat.url,
        snapshotJson: JSON.stringify(snapshot),
        createdByUserId: owner.user.id
      });
    };

    makeExport("science-card-red-1cbf5e07", true, "approved-a");
    makeExport("science-card-red-1cbf5e07", true, "approved-b");
    makeExport("science-card-red-1cbf5e07", false, "needs-rework");
    makeExport("cop-scopes-darkwall-glow-bb4319ef", true, "other-template");

    const all = await postOwnerControl(machine.secret, {
      tool: "clips_owner_list_render_exports",
      input: { channelId: channel.id, limit: 10 }
    });
    assert.equal(all.status, 200);
    const allBody = (await all.json()) as { renderExports: Array<Record<string, any>> };
    // 3 approved montages (2 science-card + 1 cop-scopes); the needs_rework export is excluded.
    assert.equal(allBody.renderExports.length, 3);
    for (const entry of allBody.renderExports) {
      assert.equal(entry.approval.status, "approved");
      assert.equal(entry.approval.judgeVerdict, "approved");
      assert.ok(entry.montage.sourceCrop, "montage geometry is present");
      assert.equal(entry.montage.durationMode, "source_full");
    }

    const filtered = await postOwnerControl(machine.secret, {
      tool: "clips_owner_list_render_exports",
      input: { channelId: channel.id, templateId: "cop-scopes-darkwall-glow-bb4319ef" }
    });
    assert.equal(filtered.status, 200);
    const filteredBody = (await filtered.json()) as { renderExports: Array<Record<string, any>> };
    assert.equal(filteredBody.renderExports.length, 1);
    assert.equal(filteredBody.renderExports[0].templateId, "cop-scopes-darkwall-glow-bb4319ef");
  });
});

test("clips_owner_render_preview enqueues a headless preview job (or degrades when no worker)", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const { owner, channel, chat } = await seedOwnerControl(appDataDir);
    const machine = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "preview-agent",
      scopes: ["flow:read", "pipeline:run"]
    });

    // Missing sourceUrl -> 400
    const badUrl = await postOwnerControl(machine.secret, {
      tool: "clips_owner_render_preview",
      input: { channelId: channel.id }
    });
    assert.equal(badUrl.status, 400);

    const preview = await postOwnerControl(machine.secret, {
      tool: "clips_owner_render_preview",
      input: {
        channelId: channel.id,
        sourceUrl: chat.url,
        snapshot: { renderPlan: { sourceCrop: { enabled: true, x: 0, y: 0.3, width: 1, height: 0.5 } } }
      }
    });
    if (preview.status === 200 || preview.status === 202) {
      // Enqueued as a preview job (202 while queued, 200 once it reaches a terminal state).
      const body = (await preview.json()) as { job: { id: string; kind: string }; pollUrl: string };
      assert.equal(body.job.kind, "preview");
      assert.equal(body.pollUrl, `/api/stage3/preview/jobs/${body.job.id}`);
      const enqueued = getStage3Job(body.job.id);
      assert.equal(enqueued?.kind, "preview");
      const payload = JSON.parse(enqueued?.payloadJson ?? "{}") as {
        snapshot?: {
          managedTemplateState?: { managedId?: string };
          renderPlan?: { templateId?: string };
        };
      };
      assert.equal(payload.snapshot?.renderPlan?.templateId, channel.templateId);
      assert.equal(payload.snapshot?.managedTemplateState?.managedId, channel.templateId);
    } else {
      // No local Stage 3 worker in the harness -> honest 503 degrade.
      assert.equal(preview.status, 503);
      const body = (await preview.json()) as { error: string };
      assert.equal(body.error, "stage3_worker_unavailable");
    }
  });
});

test("owner control blocks channel-story render_video until an editor/judge snapshot is approved", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const { owner, channel, chat } = await seedOwnerControl(appDataDir);
    await appendStage2CaptionEvent(chat.id);
    const machine = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "channel-story-gate-agent",
      scopes: ["entity:write", "flow:read", "pipeline:run"]
    });

    const createResponse = await postOwnerControl(machine.secret, {
      tool: "clips_owner_create_template",
      input: {
        name: "Story Gate Template",
        baseTemplateId: "channel-story-v1",
        layoutFamily: "channel-story-v1"
      }
    });
    assert.equal(createResponse.status, 200);
    const created = (await createResponse.json()) as { template: { id: string } };
    const assignResponse = await postOwnerControl(machine.secret, {
      tool: "clips_owner_update_channel",
      input: { channelId: channel.id, templateId: created.template.id }
    });
    assert.equal(assignResponse.status, 200);

    const blocked = await postOwnerControl(machine.secret, {
      tool: "clips_owner_render_video",
      input: {
        channelId: channel.id,
        chatId: chat.id,
        snapshot: {
          renderPlan: {
            sourceCrop: {
              enabled: true,
              x: 0,
              y: 0.3,
              width: 1,
              height: 0.5,
              confidence: 0.9,
              source: "unapproved-editor-crop"
            }
          }
        }
      }
    });
    assert.equal(blocked.status, 409);
    const body = (await blocked.json()) as { code?: string };
    assert.equal(body.code, "needs_editor_approval");

    const unapprovedArtifactPath = path.join(appDataDir, "unapproved-crop.mp4");
    await writeFile(unapprovedArtifactPath, "unapproved");
    const unapprovedJob = enqueueStage3Job({
      workspaceId: owner.workspace.id,
      userId: owner.user.id,
      kind: "render",
      payloadJson: JSON.stringify({
        chatId: chat.id,
        channelId: channel.id,
        snapshot: {
          renderPlan: {
            sourceCrop: {
              enabled: true,
              x: 0,
              y: 0.25,
              width: 1,
              height: 0.55,
              confidence: 0.91,
              source: "historical-unapproved-crop"
            }
          }
        }
      })
    });
    completeStage3Job(unapprovedJob.id, {
      artifact: {
        fileName: "unapproved-crop.mp4",
        filePath: unapprovedArtifactPath,
        mimeType: "video/mp4",
        sizeBytes: 10
      }
    });

    const blockedReuse = await postOwnerControl(machine.secret, {
      tool: "clips_owner_render_video",
      input: {
        channelId: channel.id,
        chatId: chat.id,
        templateId: created.template.id
      }
    });
    assert.equal(blockedReuse.status, 409);
    const blockedReuseBody = (await blockedReuse.json()) as { code?: string };
    assert.equal(blockedReuseBody.code, "needs_editor_approval");

    const approved = await postOwnerControl(machine.secret, {
      tool: "clips_owner_render_video",
      input: {
        channelId: channel.id,
        chatId: chat.id,
        templateId: created.template.id,
        snapshot: {
          zoroKingApproval: APPROVED_VISUAL_GATE,
          renderPlan: {
            sourceCrop: {
              enabled: true,
              x: 0,
              y: 0.3,
              width: 1,
              height: 0.5,
              confidence: 0.96,
              source: "approved-inner-video-boundary"
            }
          }
        }
      }
    });
    assert.equal(
      approved.status,
      202,
      JSON.stringify(await approved.clone().json().catch(() => null))
    );
    const rendered = (await approved.json()) as { job: { id: string } };
    const enqueued = getStage3Job(rendered.job.id);
    assert.ok(enqueued);
    const payload = JSON.parse(enqueued?.payloadJson ?? "{}") as {
      snapshot?: { zoroKingApproval?: { status?: string; judgeVerdict?: string } };
    };
    assert.equal(payload.snapshot?.zoroKingApproval?.status, "approved");
    assert.equal(payload.snapshot?.zoroKingApproval?.judgeVerdict, "approved");
  });
});

test("owner control creates, reads, and updates managed templates", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const { owner } = await seedOwnerControl(appDataDir);
    const entityWriteMachine = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "entity-write-agent",
      scopes: ["entity:write", "flow:read"]
    });

    const createResponse = await postOwnerControl(entityWriteMachine.secret, {
      tool: "clips_owner_create_template",
      input: { name: "Agent Template", description: "Created by agent" }
    });
    assert.equal(createResponse.status, 200);
    const created = (await createResponse.json()) as {
      template: { id: string; name: string; description: string };
    };
    assert.equal(created.template.name, "Agent Template");
    assert.ok(created.template.id);

    const getResponse = await postOwnerControl(entityWriteMachine.secret, {
      tool: "clips_owner_get_template",
      input: { templateId: created.template.id }
    });
    assert.equal(getResponse.status, 200);
    const fetched = (await getResponse.json()) as { template: { id: string; name: string } };
    assert.equal(fetched.template.id, created.template.id);
    assert.equal(fetched.template.name, "Agent Template");

    const updateResponse = await postOwnerControl(entityWriteMachine.secret, {
      tool: "clips_owner_update_template",
      input: { templateId: created.template.id, name: "Agent Template v2" }
    });
    assert.equal(updateResponse.status, 200);
    const updated = (await updateResponse.json()) as { template: { id: string; name: string } };
    assert.equal(updated.template.id, created.template.id);
    assert.equal(updated.template.name, "Agent Template v2");

    const missing = await postOwnerControl(entityWriteMachine.secret, {
      tool: "clips_owner_get_template",
      input: { templateId: "does-not-exist" }
    });
    assert.equal(missing.status, 404);
  });
});

test("owner control administers channel setup, assets, and publish settings", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const { owner, channel } = await seedOwnerControl(appDataDir);
    const machine = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "channel-admin-agent",
      scopes: ["entity:write", "flow:read"]
    });

    const setupResponse = await postOwnerControl(machine.secret, {
      tool: "clips_owner_update_channel",
      input: {
        channelId: channel.id,
        systemPrompt: "Agent-managed channel concept",
        stage2HardConstraints: {
          topLengthMin: 20,
          topLengthMax: 70,
          bottomLengthMin: 24,
          bottomLengthMax: 100,
          bannedWords: ["forbidden"],
          bannedOpeners: []
        },
        stage2SourceOverlayConfig: {
          enabled: false,
          prompt: "Keep the source clean."
        }
      }
    });
    assert.equal(setupResponse.status, 200);
    const setup = (await setupResponse.json()) as {
      channel: {
        systemPrompt: string;
        stage2HardConstraints: { topLengthMin: number; bannedWords: string[] };
        stage2SourceOverlayConfig: { enabled: boolean };
      };
    };
    assert.equal(setup.channel.systemPrompt, "Agent-managed channel concept");
    assert.equal(setup.channel.stage2HardConstraints.topLengthMin, 20);
    assert.deepEqual(setup.channel.stage2HardConstraints.bannedWords, ["forbidden"]);
    assert.equal(setup.channel.stage2SourceOverlayConfig.enabled, false);

    const assetResponse = await postOwnerControl(machine.secret, {
      tool: "clips_owner_upload_channel_asset",
      input: {
        channelId: channel.id,
        kind: "background",
        fileName: "background.png",
        mimeType: "image/png",
        dataBase64: Buffer.from("test-background").toString("base64"),
        setAsDefault: true
      }
    });
    assert.equal(assetResponse.status, 200);
    const uploaded = (await assetResponse.json()) as { asset: { id: string } };
    assert.equal((await getChannelById(channel.id))?.defaultBackgroundAssetId, uploaded.asset.id);

    const publishResponse = await postOwnerControl(machine.secret, {
      tool: "clips_owner_update_channel_publish_settings",
      input: {
        channelId: channel.id,
        autoQueueEnabled: false,
        dailySlotCount: 3,
        notifySubscribersByDefault: false
      }
    });
    assert.equal(publishResponse.status, 200);
    assert.equal(getChannelPublishSettings(channel.id).autoQueueEnabled, false);
    assert.equal(getChannelPublishSettings(channel.id).dailySlotCount, 3);

    const clearResponse = await postOwnerControl(machine.secret, {
      tool: "clips_owner_update_channel",
      input: { channelId: channel.id, defaultBackgroundAssetId: null }
    });
    assert.equal(clearResponse.status, 200);
    assert.equal((await getChannelById(channel.id))?.defaultBackgroundAssetId, null);
  });
});

test("owner control enqueues a Stage 3 render job", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const { owner, channel, chat } = await seedOwnerControl(appDataDir);
    const machine = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "render-agent"
    });

    const renderResponse = await postOwnerControl(machine.secret, {
      tool: "clips_owner_render_video",
      input: { channelId: channel.id, chatId: chat.id }
    });
    // No Stage 3 worker runs in the test harness, so the job stays queued (202).
    assert.equal(renderResponse.status, 202);
    const rendered = (await renderResponse.json()) as {
      job: { id: string; kind: string; status: string };
      pollUrl: string;
      downloadUrl: string;
    };
    assert.equal(rendered.job.kind, "render");
    assert.ok(rendered.job.id);
    assert.equal(rendered.downloadUrl, `/api/admin/render-exports/${rendered.job.id}`);
    assert.equal(rendered.pollUrl, `/api/stage3/render/jobs/${rendered.job.id}`);

    const enqueued = getStage3Job(rendered.job.id);
    assert.ok(enqueued);
    assert.equal(enqueued?.kind, "render");
  });
});

test("owner control embeds managedTemplateState in the render snapshot for a managed template", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const { owner, channel, chat } = await seedOwnerControl(appDataDir);
    const machine = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "render-managed-agent",
      scopes: ["entity:write", "flow:read", "pipeline:run"]
    });

    const createResponse = await postOwnerControl(machine.secret, {
      tool: "clips_owner_create_template",
      input: { name: "Invention Template", description: "managed" }
    });
    assert.equal(createResponse.status, 200);
    const created = (await createResponse.json()) as { template: { id: string } };
    assert.ok(created.template.id);
    const assignResponse = await postOwnerControl(machine.secret, {
      tool: "clips_owner_update_channel",
      input: { channelId: channel.id, templateId: created.template.id }
    });
    assert.equal(assignResponse.status, 200);

    const renderResponse = await postOwnerControl(machine.secret, {
      tool: "clips_owner_render_video",
      input: { channelId: channel.id, chatId: chat.id }
    });
    assert.equal(renderResponse.status, 202);
    const rendered = (await renderResponse.json()) as { job: { id: string } };

    // The managed template must be resolved on the cloud at enqueue time and
    // embedded in the render snapshot so the Stage 3 worker resolves it from the
    // snapshot instead of the intentionally-empty workspace_templates table
    // (the FK fix). managedId must equal the requested templateId for the
    // worker's snapshot-first branch to fire.
    const enqueued = getStage3Job(rendered.job.id);
    assert.ok(enqueued);
    const payload = JSON.parse(enqueued?.payloadJson ?? "{}") as {
      templateId?: string;
      snapshot?: { managedTemplateState?: { managedId?: string } };
    };
    assert.equal(payload.templateId, created.template.id);
    assert.equal(payload.snapshot?.managedTemplateState?.managedId, created.template.id);
  });
});

test("owner control rejects a caller template that differs from the selected channel", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const { owner, channel, chat } = await seedOwnerControl(appDataDir);
    const machine = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "render-template-mismatch-agent",
      scopes: ["flow:read", "pipeline:run"]
    });
    const before = getDb().prepare("SELECT COUNT(*) AS count FROM stage3_jobs").get() as { count: number };

    const response = await postOwnerControl(machine.secret, {
      tool: "clips_owner_render_video",
      input: {
        channelId: channel.id,
        chatId: chat.id,
        templateId: "caller-selected-wrong-template"
      }
    });

    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "template_id_mismatch");
    const after = getDb().prepare("SELECT COUNT(*) AS count FROM stage3_jobs").get() as { count: number };
    assert.equal(after.count, before.count);
  });
});

test("owner control render_video builds a full caption snapshot with upright source defaults", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const { owner, channel, chat } = await seedOwnerControl(appDataDir);
    await appendStage2CaptionEvent(chat.id);
    const machine = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "render-snapshot-agent",
      scopes: ["flow:read", "pipeline:run"]
    });

    const renderResponse = await postOwnerControl(machine.secret, {
      tool: "clips_owner_render_video",
      input: { channelId: channel.id, chatId: chat.id, sourceDurationSec: 53.6 }
    });
    assert.equal(renderResponse.status, 202);
    const rendered = (await renderResponse.json()) as { job: { id: string } };
    const enqueued = getStage3Job(rendered.job.id);
    assert.ok(enqueued);
    const payload = JSON.parse(enqueued?.payloadJson ?? "{}") as {
      snapshot?: {
        topText?: string;
        bottomText?: string;
        sourceOverlayText?: string;
        templateSnapshot?: { snapshotHash?: string };
        textFit?: { fitHash?: string };
        managedTemplateState?: { managedId?: string };
        renderPlan?: {
          durationMode?: string;
          mirrorEnabled?: boolean;
          targetDurationSec?: number;
          templateId?: string;
        };
      };
    };

    assert.equal(payload.snapshot?.topText, "SERVER SNAPSHOT TOP");
    assert.equal(
      payload.snapshot?.bottomText,
      "Server-side Stage 2 caption text must reach the complete MCP snapshot before every approved render."
    );
    assert.equal(payload.snapshot?.sourceOverlayText, "source: owner mcp");
    assert.equal(payload.snapshot?.renderPlan?.durationMode, "source_full");
    assert.equal(payload.snapshot?.renderPlan?.targetDurationSec, 53.6);
    assert.equal(payload.snapshot?.renderPlan?.mirrorEnabled, false);
    assert.equal(payload.snapshot?.renderPlan?.templateId, channel.templateId);
    assert.equal(payload.snapshot?.managedTemplateState?.managedId, channel.templateId);
    assert.ok(payload.snapshot?.templateSnapshot?.snapshotHash);
    assert.ok(payload.snapshot?.textFit?.fitHash);
  });
});

test("owner control render_video preserves caller snapshot media controls", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const { owner, channel, chat } = await seedOwnerControl(appDataDir);
    await appendStage2CaptionEvent(chat.id);
    const machine = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "render-caller-snapshot-agent",
      scopes: ["flow:read", "pipeline:run"]
    });
    const callerSnapshot = {
      topText: "CALLER SNAPSHOT TOP",
      bottomText: "Caller snapshot bottom",
      clipStartSec: 4.25,
      clipDurationSec: 54,
      focusY: 0.41,
      sourceDurationSec: 54,
      renderPlan: {
        templateId: channel.templateId,
        durationMode: "source_full",
        targetDurationSec: 54,
        mirrorEnabled: false,
        videoZoom: 1.13,
        sourceCrop: {
          enabled: true,
          x: 0,
          y: 0,
          width: 1,
          height: 0.82,
          confidence: 0.93,
          source: "editor-controlled-source-crop"
        }
      }
    };

    const renderResponse = await postOwnerControl(machine.secret, {
      tool: "clips_owner_render_video",
      input: {
        channelId: channel.id,
        chatId: chat.id,
        sourceDurationSec: 54,
        snapshot: callerSnapshot
      }
    });
    assert.equal(renderResponse.status, 202);
    const rendered = (await renderResponse.json()) as { job: { id: string } };
    const enqueued = getStage3Job(rendered.job.id);
    assert.ok(enqueued);
    const payload = JSON.parse(enqueued?.payloadJson ?? "{}") as {
      snapshot?: {
        topText?: string;
        bottomText?: string;
        clipStartSec?: number;
        focusY?: number;
        renderPlan?: {
          durationMode?: string;
          targetDurationSec?: number;
          mirrorEnabled?: boolean;
          videoZoom?: number;
          sourceCrop?: {
            enabled?: boolean;
            height?: number;
            source?: string;
          };
        };
      };
    };

    assert.equal(payload.snapshot?.topText, "CALLER SNAPSHOT TOP");
    assert.equal(payload.snapshot?.bottomText, "Caller snapshot bottom");
    assert.equal(payload.snapshot?.clipStartSec, 4.25);
    assert.equal(payload.snapshot?.focusY, 0.41);
    assert.equal(payload.snapshot?.renderPlan?.durationMode, "source_full");
    assert.equal(payload.snapshot?.renderPlan?.targetDurationSec, 54);
    assert.equal(payload.snapshot?.renderPlan?.mirrorEnabled, false);
    assert.equal(payload.snapshot?.renderPlan?.videoZoom, 1.13);
    assert.equal(payload.snapshot?.renderPlan?.sourceCrop?.enabled, true);
    assert.equal(payload.snapshot?.renderPlan?.sourceCrop?.height, 0.82);
    assert.equal(payload.snapshot?.renderPlan?.sourceCrop?.source, "editor-controlled-source-crop");
  });
});

test("owner control render_video merges a caller renderPlan patch onto the full server snapshot", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const { owner, channel, chat } = await seedOwnerControl(appDataDir);
    await appendStage2CaptionEvent(chat.id);
    const machine = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "render-crop-patch-agent",
      scopes: ["flow:read", "pipeline:run"]
    });

    const renderResponse = await postOwnerControl(machine.secret, {
      tool: "clips_owner_render_video",
      input: {
        channelId: channel.id,
        chatId: chat.id,
        sourceDurationSec: 54,
        snapshot: {
          managedTemplateState: {
            managedId: "stale-template",
            updatedAt: "2025-01-01T00:00:00.000Z"
          },
          templateSnapshot: { snapshotHash: "stale-snapshot" },
          textFit: { fitHash: "stale-fit" },
          renderPlan: {
            sourceCrop: {
              enabled: true,
              x: 0.08,
              y: 0.18,
              width: 0.84,
              height: 0.62,
              confidence: 0.91,
              source: "editor-clean-inner-media"
            }
          }
        }
      }
    });
    assert.equal(renderResponse.status, 202);
    const rendered = (await renderResponse.json()) as { job: { id: string } };
    const enqueued = getStage3Job(rendered.job.id);
    assert.ok(enqueued);
    const payload = JSON.parse(enqueued?.payloadJson ?? "{}") as {
      snapshot?: {
        topText?: string;
        bottomText?: string;
        templateSnapshot?: { snapshotHash?: string };
        textFit?: { fitHash?: string };
        managedTemplateState?: { managedId?: string };
        renderPlan?: {
          mirrorEnabled?: boolean;
          sourceCrop?: {
            enabled?: boolean;
            y?: number;
            height?: number;
            source?: string;
          };
        };
      };
    };

    assert.equal(payload.snapshot?.topText, "SERVER SNAPSHOT TOP");
    assert.equal(
      payload.snapshot?.bottomText,
      "Server-side Stage 2 caption text must reach the complete MCP snapshot before every approved render."
    );
    assert.ok(payload.snapshot?.templateSnapshot?.snapshotHash);
    assert.ok(payload.snapshot?.textFit?.fitHash);
    assert.notEqual(payload.snapshot?.templateSnapshot?.snapshotHash, "stale-snapshot");
    assert.notEqual(payload.snapshot?.textFit?.fitHash, "stale-fit");
    assert.equal(payload.snapshot?.managedTemplateState?.managedId, channel.templateId);
    assert.equal(payload.snapshot?.renderPlan?.mirrorEnabled, false);
    assert.equal(payload.snapshot?.renderPlan?.sourceCrop?.enabled, true);
    assert.equal(payload.snapshot?.renderPlan?.sourceCrop?.y, 0.18);
    assert.equal(payload.snapshot?.renderPlan?.sourceCrop?.height, 0.62);
    assert.equal(payload.snapshot?.renderPlan?.sourceCrop?.source, "editor-clean-inner-media");
  });
});

test("owner control render_video reuses the latest editor source crop instead of regressing to a default render", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const { owner, channel, chat } = await seedOwnerControl(appDataDir);
    await appendStage2CaptionEvent(chat.id);
    const machine = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "render-montage-reuse-agent",
      scopes: ["flow:read", "pipeline:run"]
    });

    const cleanArtifactPath = path.join(appDataDir, "clean-editor.mp4");
    await writeFile(cleanArtifactPath, "clean");
    const cleanJob = enqueueStage3Job({
      workspaceId: owner.workspace.id,
      userId: owner.user.id,
      kind: "render",
      payloadJson: JSON.stringify({
        chatId: chat.id,
        channelId: channel.id,
        snapshot: {
          zoroKingApproval: APPROVED_VISUAL_GATE,
          bottomText: "OLD EDITOR TEXT",
          clipStartSec: 3.5,
          clipDurationSec: 7.75,
          focusY: 0.44,
          renderPlan: {
            targetDurationSec: 7.75,
            durationMode: "fixed_segments",
            timingMode: "auto",
            normalizeToTargetEnabled: false,
            editorSelectionMode: "window",
            mirrorEnabled: false,
            videoFit: "contain",
            videoZoom: 1.08,
            focusX: 0.51,
            sourceCrop: {
              enabled: true,
              x: 0.08,
              y: 0.36,
              width: 0.86,
              height: 0.42,
              confidence: 0.96,
              source: "editor-inner-video-boundary"
            },
            segments: [{ startSec: 3.5, endSec: 11.25, speed: 1, label: "editor window" }],
            policy: "fixed_segments"
          }
        }
      })
    });
    completeStage3Job(cleanJob.id, {
      artifact: {
        fileName: "clean-editor.mp4",
        filePath: cleanArtifactPath,
        mimeType: "video/mp4",
        sizeBytes: 5
      }
    });

    const defaultArtifactPath = path.join(appDataDir, "default-regression.mp4");
    await writeFile(defaultArtifactPath, "bad");
    const badJob = enqueueStage3Job({
      workspaceId: owner.workspace.id,
      userId: owner.user.id,
      kind: "render",
      payloadJson: JSON.stringify({
        chatId: chat.id,
        channelId: channel.id,
        snapshot: {
          bottomText: "BAD DEFAULT TEXT",
          renderPlan: {
            durationMode: "channel_default",
            mirrorEnabled: false,
            videoFit: "cover",
            videoZoom: 1,
            sourceCrop: null
          }
        }
      })
    });
    completeStage3Job(badJob.id, {
      artifact: {
        fileName: "default-regression.mp4",
        filePath: defaultArtifactPath,
        mimeType: "video/mp4",
        sizeBytes: 3
      }
    });

    const renderResponse = await postOwnerControl(machine.secret, {
      tool: "clips_owner_render_video",
      input: { channelId: channel.id, chatId: chat.id }
    });
    assert.equal(renderResponse.status, 202);
    const rendered = (await renderResponse.json()) as { job: { id: string } };
    const enqueued = getStage3Job(rendered.job.id);
    assert.ok(enqueued);
    const payload = JSON.parse(enqueued?.payloadJson ?? "{}") as {
      snapshot?: {
        bottomText?: string;
        clipStartSec?: number;
        clipDurationSec?: number;
        focusY?: number;
        renderPlan?: {
          durationMode?: string;
          targetDurationSec?: number;
          normalizeToTargetEnabled?: boolean;
          videoFit?: string;
          videoZoom?: number;
          sourceCrop?: {
            enabled?: boolean;
            y?: number;
            height?: number;
            source?: string;
          } | null;
        };
      };
    };

    assert.equal(
      payload.snapshot?.bottomText,
      "Server-side Stage 2 caption text must reach the complete MCP snapshot before every approved render."
    );
    assert.equal(payload.snapshot?.clipStartSec, 3.5);
    assert.equal(payload.snapshot?.clipDurationSec, 7.75);
    assert.equal(payload.snapshot?.focusY, 0.44);
    assert.equal(payload.snapshot?.renderPlan?.durationMode, "fixed_segments");
    assert.equal(payload.snapshot?.renderPlan?.targetDurationSec, 7.75);
    assert.equal(payload.snapshot?.renderPlan?.normalizeToTargetEnabled, false);
    assert.equal(payload.snapshot?.renderPlan?.videoFit, "contain");
    assert.equal(payload.snapshot?.renderPlan?.videoZoom, 1.08);
    assert.equal(payload.snapshot?.renderPlan?.sourceCrop?.enabled, true);
    assert.equal(payload.snapshot?.renderPlan?.sourceCrop?.y, 0.36);
    assert.equal(payload.snapshot?.renderPlan?.sourceCrop?.height, 0.42);
    assert.equal(payload.snapshot?.renderPlan?.sourceCrop?.source, "editor-inner-video-boundary");
  });
});

test("owner control render_video drops stale server text fit when caller patches caption text", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const { owner, channel, chat } = await seedOwnerControl(appDataDir);
    await appendStage2CaptionEvent(chat.id);
    const machine = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "render-text-patch-agent",
      scopes: ["flow:read", "pipeline:run"]
    });

    const renderResponse = await postOwnerControl(machine.secret, {
      tool: "clips_owner_render_video",
      input: {
        channelId: channel.id,
        chatId: chat.id,
        snapshot: {
          topText: "CALLER PATCH TOP TEXT",
          renderPlan: {
            sourceCrop: {
              enabled: true,
              x: 0.1,
              y: 0.2,
              width: 0.8,
              height: 0.6,
              confidence: 0.9,
              source: "editor-clean-inner-media"
            }
          }
        }
      }
    });
    assert.equal(renderResponse.status, 202);
    const rendered = (await renderResponse.json()) as { job: { id: string } };
    const enqueued = getStage3Job(rendered.job.id);
    assert.ok(enqueued);
    const payload = JSON.parse(enqueued?.payloadJson ?? "{}") as {
      snapshot?: {
        topText?: string;
        bottomText?: string;
        templateSnapshot?: unknown;
        textFit?: unknown;
        renderPlan?: {
          sourceCrop?: {
            enabled?: boolean;
            x?: number;
          };
        };
      };
    };

    assert.equal(payload.snapshot?.topText, "CALLER PATCH TOP TEXT");
    assert.equal(
      payload.snapshot?.bottomText,
      "Server-side Stage 2 caption text must reach the complete MCP snapshot before every approved render."
    );
    assert.equal(payload.snapshot?.templateSnapshot, undefined);
    assert.equal(payload.snapshot?.textFit, undefined);
    assert.equal(payload.snapshot?.renderPlan?.sourceCrop?.enabled, true);
    assert.equal(payload.snapshot?.renderPlan?.sourceCrop?.x, 0.1);
  });
});

test("owner control video pipeline accepts platform_v1 as the current manual Stage 2 alias", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const { owner, channel } = await seedOwnerControl(appDataDir);
    const machine = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "platform-v1-agent",
      scopes: ["pipeline:run"]
    });

    const response = await postOwnerControl(machine.secret, {
      tool: "clips_owner_run_video_pipeline",
      input: {
        channelId: channel.id,
        sourceUrl: "https://www.instagram.com/reel/DZA_hMoznPK/",
        userInstruction: "Use the ZoroKing platform_v1 instruction packet.",
        mode: "platform_v1",
        dryRun: true
      }
    });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { dryRun?: boolean; planned?: string[] };
    assert.equal(payload.dryRun, true);
    assert.deepEqual(payload.planned, ["create_or_get_chat", "enqueue_stage2_run"]);
  });
});

test("owner control refuses explicit agent_manual mode without a valid caption", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const { owner, channel } = await seedOwnerControl(appDataDir);
    const machine = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "agent-manual-caption-required",
      scopes: ["pipeline:run"]
    });

    const missing = await postOwnerControl(machine.secret, {
      tool: "clips_owner_run_video_pipeline",
      input: {
        channelId: channel.id,
        sourceUrl: "https://www.instagram.com/reel/DZA_hMoznPK/",
        mode: "agent_manual"
      }
    });
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).code, "agent_caption_required");

    const malformed = await postOwnerControl(machine.secret, {
      tool: "clips_owner_run_video_pipeline",
      input: {
        channelId: channel.id,
        sourceUrl: "https://www.instagram.com/reel/DZA_hMoznPK/",
        mode: "agent_manual",
        agentCaption: { top: "MISSING BOTTOM" }
      }
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).code, "agent_caption_malformed");
  });
});

test("owner control requires an explicit sourceUrl and never delegates to a daily pool", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const { owner, channel } = await seedOwnerControl(appDataDir);
    const machine = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "agent-manual-source-required",
      scopes: ["pipeline:run"]
    });
    const count = (table: "copscopes_daily_runs" | "stage3_jobs" | "channel_publications") =>
      Number(
        (
          getDb()
            .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
            .get() as { count: number }
        ).count
      );
    const before = {
      dailyRuns: count("copscopes_daily_runs"),
      stage3Jobs: count("stage3_jobs"),
      publications: count("channel_publications")
    };
    const caption = {
      top: "AGENT MANUAL SOURCE IS REQUIRED",
      bottom: "An explicit source must exist before the manual Stage 2 handoff can start."
    };

    for (const input of [
      { channelId: channel.id, mode: "agent_manual", agentCaption: caption },
      { channelId: channel.id, agentCaption: caption }
    ]) {
      const response = await postOwnerControl(machine.secret, {
        tool: "clips_owner_run_video_pipeline",
        input
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, "source_url_required");
    }

    assert.deepEqual(
      {
        dailyRuns: count("copscopes_daily_runs"),
        stage3Jobs: count("stage3_jobs"),
        publications: count("channel_publications")
      },
      before,
      "agent_manual without sourceUrl must not enter daily pool, Stage 3, or publication paths"
    );
  });
});

test("owner control enforces machine scopes and destructive intent", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const { owner, channel, publication } = await seedOwnerControl(appDataDir);
    const limited = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "readonly-agent",
      scopes: ["flow:read"]
    });
    const workerRejected = await postOwnerControl(limited.secret, {
      tool: "clips_owner_pair_stage3_worker",
      input: {}
    });
    assert.equal(workerRejected.status, 401);

    const machine = createMcpMachineCredential({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      machineId: "macmini-agent"
    });
    const listResponse = await postOwnerControl(machine.secret, {
      tool: "clips_owner_list_publications",
      input: { channelUsername: channel.username, limit: 10 }
    });
    assert.equal(listResponse.status, 200);
    const listed = (await listResponse.json()) as { publications: Array<{ id: string }> };
    assert.equal(listed.publications[0]?.id, publication.id);

    const missingIntent = await postOwnerControl(machine.secret, {
      tool: "clips_owner_cancel_publication",
      input: { publicationId: publication.id }
    });
    assert.equal(missingIntent.status, 400);

    const canceledResponse = await postOwnerControl(machine.secret, {
      tool: "clips_owner_cancel_publication",
      input: {
        publicationId: publication.id,
        intent: `Cancel publication ${publication.id} from owner MCP test`
      }
    });
    assert.equal(canceledResponse.status, 200);
    assert.equal(getChannelPublicationById(publication.id)?.status, "canceled");
  });
});
