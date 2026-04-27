import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";

import { GET as getAdminFlows } from "../app/api/admin/flows/route";
import { GET as getAdminAuditEvents } from "../app/api/admin/audit-events/route";
import {
  GET as listMcpTokensRoute,
  POST as createMcpTokenRoute
} from "../app/api/admin/mcp-tokens/route";
import { DELETE as revokeMcpTokenRoute } from "../app/api/admin/mcp-tokens/[tokenId]/route";
import { APP_SESSION_COOKIE } from "../lib/auth/cookies";
import { appendFlowAuditEvent, listFlowAuditEvents } from "../lib/audit-log-store";
import { createChannel, createOrGetChatByUrl } from "../lib/chat-history";
import { buildPublicationSlotCandidateFromDateAndIndex, DEFAULT_CHANNEL_PUBLISH_SETTINGS } from "../lib/channel-publishing";
import { redactForFlowExport } from "../lib/flow-redaction";
import { listFlowObservability } from "../lib/flow-observability";
import { createRenderExport, createChannelPublication, cancelChannelPublication } from "../lib/publication-store";
import { createSourceJob, finalizeSourceJobSuccess, claimNextQueuedSourceJob } from "../lib/source-job-store";
import { completeStage3Job, enqueueStage3Job } from "../lib/stage3-job-store";
import {
  DEFAULT_STAGE2_EXAMPLES_CONFIG,
  DEFAULT_STAGE2_HARD_CONSTRAINTS
} from "../lib/stage2-channel-config";
import { createStage2Run, finalizeStage2RunSuccess, setStage2RunResultData } from "../lib/stage2-progress-store";
import {
  acceptInviteRegistration,
  bootstrapOwner,
  createInvite
} from "../lib/team-store";
import { middleware } from "../middleware";

type McpToken = {
  id: string;
  tokenHint: string;
  scopes: string[];
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

async function withIsolatedAppData<T>(run: (appDataDir: string) => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-flow-observability-test-"));
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

async function seedFlow(appDataDir: string) {
  const owner = await bootstrapOwner({
    workspaceName: "Flow Observability",
    email: "owner@example.com",
    password: "Password123!",
    displayName: "Owner"
  });
  const channel = await createChannel({
    workspaceId: owner.workspace.id,
    creatorUserId: owner.user.id,
    name: "Owner Flow Channel",
    username: "owner_flow"
  });
  const chat = await createOrGetChatByUrl("https://youtube.com/watch?v=flow-observe-1", channel.id);
  const sourceJob = createSourceJob({
    workspaceId: owner.workspace.id,
    creatorUserId: owner.user.id,
    request: {
      sourceUrl: chat.url,
      autoRunStage2: false,
      trigger: "fetch",
      chat: { id: chat.id, channelId: channel.id },
      channel: { id: channel.id, name: channel.name, username: channel.username }
    }
  });
  claimNextQueuedSourceJob();
  finalizeSourceJobSuccess(sourceJob.jobId, {
    chatId: chat.id,
    channelId: channel.id,
    sourceUrl: chat.url,
    stage1Ready: true,
    title: "Observed flow",
    commentsAvailable: false,
    commentsError: null,
    commentsPayload: null,
    commentsAcquisitionStatus: "unavailable",
    commentsAcquisitionProvider: null,
    commentsAcquisitionNote: null,
    autoStage2RunId: null
  });

  const stage2 = createStage2Run({
    workspaceId: owner.workspace.id,
    creatorUserId: owner.user.id,
    chatId: chat.id,
    request: {
      sourceUrl: chat.url,
      userInstruction: "watch the flow",
      mode: "manual",
      channel: {
        id: channel.id,
        name: channel.name,
        username: channel.username,
        stage2ExamplesConfig: DEFAULT_STAGE2_EXAMPLES_CONFIG,
        stage2HardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS,
        formatPipeline: "classic_top_bottom"
      }
    }
  });
  setStage2RunResultData(stage2.runId, {
    output: {
      captionOptions: [],
      pipeline: { provider: "codex" }
    },
    diagnostics: {
      effectivePrompting: {
        promptStages: [
          {
            stageId: "classicOneShot",
            model: "gpt-test",
            promptText: "full prompt",
            promptChars: 11,
            promptSource: "channel_override"
          }
        ]
      }
    },
    model: "gpt-test",
    warnings: []
  });
  finalizeStage2RunSuccess(stage2.runId);

  const artifactPath = path.join(appDataDir, "flow.mp4");
  await writeFile(artifactPath, "video");
  const stage3 = enqueueStage3Job({
    workspaceId: owner.workspace.id,
    userId: owner.user.id,
    kind: "render",
    payloadJson: JSON.stringify({ chatId: chat.id, channelId: channel.id })
  });
  completeStage3Job(stage3.id, {
    artifact: {
      fileName: "flow.mp4",
      filePath: artifactPath,
      mimeType: "video/mp4",
      sizeBytes: 5
    },
    resultJson: JSON.stringify({ ok: true })
  });
  const renderExport = createRenderExport({
    workspaceId: owner.workspace.id,
    channelId: channel.id,
    chatId: chat.id,
    stage3JobId: stage3.id,
    artifactFileName: "flow.mp4",
    artifactFilePath: artifactPath,
    artifactMimeType: "video/mp4",
    artifactSizeBytes: 5,
    renderTitle: "Observed flow",
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
    title: "Observed flow",
    description: "desc",
    tags: [],
    notifySubscribers: true,
    needsReview: false,
    createdByUserId: owner.user.id
  });
  const canceledPublication = cancelChannelPublication(publication.id);
  return { owner, channel, chat, sourceJob, stage2, stage3, publication: canceledPublication };
}

test("flow redaction removes secrets recursively but preserves prompt and model fields", () => {
  const sharedPrompt = {
    promptText: "shared prompt appears in multiple trace sections",
    model: "gpt-test",
    provider: "codex"
  };
  const redacted = redactForFlowExport({
    apiKey: "sk-secret",
    authorization: "Bearer abc",
    firstPromptSection: sharedPrompt,
    secondPromptSection: sharedPrompt,
    nested: {
      refreshToken: "refresh",
      promptText: "keep this full prompt but hide sk-inline-secret",
      model: "gpt-test",
      provider: "codex"
    }
  }) as Record<string, unknown>;

  assert.equal(redacted.apiKey, "[redacted]");
  assert.equal(redacted.authorization, "[redacted]");
  assert.deepEqual(redacted.firstPromptSection, sharedPrompt);
  assert.deepEqual(redacted.secondPromptSection, sharedPrompt);
  assert.deepEqual(redacted.nested, {
    refreshToken: "[redacted]",
    promptText: "keep this full prompt but hide [redacted]",
    model: "gpt-test",
    provider: "codex"
  });
});

test("flow audit records source, stage2, stage3, publication, deletion, and redacted payload facts", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const { owner, chat, publication } = await seedFlow(appDataDir);
    appendFlowAuditEvent({
      workspaceId: owner.workspace.id,
      userId: owner.user.id,
      action: "chat.deleted",
      entityType: "chat",
      entityId: chat.id,
      channelId: publication.channelId,
      chatId: chat.id,
      stage: "chat",
      status: "deleted",
      payload: {
        promptText: "should not be present in deleted video audit",
        accessToken: "secret"
      }
    });

    const events = listFlowAuditEvents({ workspaceId: owner.workspace.id, limit: 100 });
    assert.ok(events.some((event) => event.action === "source_job.queued"));
    assert.ok(events.some((event) => event.action === "source_job.completed"));
    assert.ok(events.some((event) => event.action === "stage2_run.queued"));
    assert.ok(events.some((event) => event.action === "stage2_run.failed") === false);
    assert.ok(events.some((event) => event.action === "stage3_job.queued"));
    assert.ok(events.some((event) => event.action === "stage3_job.completed"));
    assert.ok(events.some((event) => event.action === "publication.queued"));
    assert.ok(events.some((event) => event.action === "publication.canceled"));

    const deleteEvent = events.find((event) => event.action === "publication.canceled");
    assert.ok(deleteEvent);
    assert.equal(deleteEvent.payload?.title, "Observed flow");
    assert.equal("promptText" in (deleteEvent.payload ?? {}), false);
    assert.equal(deleteEvent.payload?.accessToken, undefined);
  });
});

test("flow list aggregates jobs, runs, publication state, and model metadata", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const { owner, chat, stage2, publication } = await seedFlow(appDataDir);
    const result = listFlowObservability({ workspaceId: owner.workspace.id });
    const flow = result.flows.find((item) => item.chatId === chat.id);

    assert.ok(flow);
    assert.equal(flow?.stage2RunId, stage2.runId);
    assert.equal(flow?.publicationId, publication.id);
    assert.equal(flow?.provider, "codex");
    assert.equal(flow?.model, "gpt-test");
    assert.equal(result.metrics.deleted >= 1, true);
  });
});

test("admin flow APIs and MCP token routes are owner-only for session auth", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const { owner } = await seedFlow(appDataDir);
    const invite = await createInvite({
      workspaceId: owner.workspace.id,
      email: "manager@example.com",
      role: "manager",
      createdByUserId: owner.user.id
    });
    const manager = await acceptInviteRegistration({
      token: invite.token,
      password: "Password123!",
      displayName: "Manager"
    });

    const ownerCookie = `${APP_SESSION_COOKIE}=${owner.sessionToken}`;
    const managerCookie = `${APP_SESSION_COOKIE}=${manager.sessionToken}`;
    const ownerResponse = await getAdminFlows(new Request("http://localhost/api/admin/flows", {
      headers: { cookie: ownerCookie }
    }));
    assert.equal(ownerResponse.status, 200);

    const managerResponse = await getAdminFlows(new Request("http://localhost/api/admin/flows", {
      headers: { cookie: managerCookie }
    }));
    assert.equal(managerResponse.status, 403);

    const managerTokenResponse = await createMcpTokenRoute(new Request("http://localhost/api/admin/mcp-tokens", {
      method: "POST",
      headers: { cookie: managerCookie }
    }));
    assert.equal(managerTokenResponse.status, 403);

    const ownerTokenResponse = await createMcpTokenRoute(new Request("http://localhost/api/admin/mcp-tokens", {
      method: "POST",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ expiresInDays: 1 })
    }));
    const created = (await ownerTokenResponse.json()) as { token: string; record: McpToken };
    assert.equal(ownerTokenResponse.status, 201);
    assert.match(created.token, /^clips_mcp_/);

    const bearerResponse = await getAdminAuditEvents(new Request("http://localhost/api/admin/audit-events", {
      headers: { authorization: `Bearer ${created.token}` }
    }));
    assert.equal(bearerResponse.status, 200);

    const listTokensResponse = await listMcpTokensRoute(new Request("http://localhost/api/admin/mcp-tokens", {
      headers: { cookie: ownerCookie }
    }));
    assert.equal(listTokensResponse.status, 200);

    const revokeResponse = await revokeMcpTokenRoute(
      new Request(`http://localhost/api/admin/mcp-tokens/${created.record.id}`, {
        method: "DELETE",
        headers: { cookie: ownerCookie }
      }),
      { params: Promise.resolve({ tokenId: created.record.id }) }
    );
    assert.equal(revokeResponse.status, 200);

    const revokedBearerResponse = await getAdminFlows(new Request("http://localhost/api/admin/flows", {
      headers: { authorization: `Bearer ${created.token}` }
    }));
    assert.equal(revokedBearerResponse.status, 401);
  });
});

test("middleware lets read-only MCP bearer tokens reach flow observability APIs only", () => {
  const flowResponse = middleware(
    new NextRequest("http://localhost/api/admin/flows", {
      headers: { authorization: "Bearer clips_mcp_test" }
    })
  );
  assert.notEqual(flowResponse.status, 401);

  const traceResponse = middleware(
    new NextRequest("http://localhost/api/admin/flows/chat_1/trace", {
      headers: { authorization: "Bearer clips_mcp_test" }
    })
  );
  assert.notEqual(traceResponse.status, 401);

  const tokenMutationResponse = middleware(
    new NextRequest("http://localhost/api/admin/mcp-tokens", {
      headers: { authorization: "Bearer clips_mcp_test" }
    })
  );
  assert.equal(tokenMutationResponse.status, 401);
});
