import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { GET as getAdminFlows } from "../app/api/admin/flows/route";
import { POST as ownerControlRoute } from "../app/api/admin/control/route";
import { appendChatEvent, createChannel, createOrGetChatByUrl } from "../lib/chat-history";
import { buildPublicationSlotCandidateFromDateAndIndex, DEFAULT_CHANNEL_PUBLISH_SETTINGS } from "../lib/channel-publishing";
import {
  authenticateMcpMachineCredentialForScope,
  createMcpMachineCredential
} from "../lib/mcp-machine-credential-store";
import { createMcpAccessToken } from "../lib/mcp-token-store";
import {
  createChannelPublication,
  createRenderExport,
  getChannelPublicationById
} from "../lib/publication-store";
import { enqueueStage3Job, getStage3Job } from "../lib/stage3-job-store";
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
            bottom: "Server-side Stage 2 caption text must reach the MCP render snapshot.",
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

    const renderResponse = await postOwnerControl(machine.secret, {
      tool: "clips_owner_render_video",
      input: { channelId: channel.id, chatId: chat.id, templateId: created.template.id }
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
      "Server-side Stage 2 caption text must reach the MCP render snapshot."
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
