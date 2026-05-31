import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { POST as fetchComments } from "../app/api/comments/route";
import { POST as registerRoute } from "../app/api/auth/register/route";
import { GET as getChatTrace } from "../app/api/chat-trace/[id]/route";
import { GET as listChannelsRoute } from "../app/api/channels/route";
import { PATCH as patchChannelRoute } from "../app/api/channels/[id]/route";
import { POST as uploadChannelAssetRoute } from "../app/api/channels/[id]/assets/route";
import {
  GET as listManagedTemplatesRoute,
  POST as createManagedTemplateRoute
} from "../app/api/design/templates/route";
import { POST as importManagedTemplateRoute } from "../app/api/design/templates/import/route";
import { GET as getManagedTemplate } from "../app/api/design/templates/[templateId]/route";
import {
  DELETE as deleteManagedTemplateRoute,
  PUT as updateManagedTemplateRoute
} from "../app/api/design/templates/[templateId]/route";
import { POST as downloadSource } from "../app/api/download/route";
import { GET as getRuntimeCapabilities } from "../app/api/runtime/capabilities/route";
import { GET as readStage3Background } from "../app/api/stage3/background/[id]/route";
import { POST as uploadStage3Background } from "../app/api/stage3/background/route";
import { POST as fetchVideoMeta } from "../app/api/video/meta/route";
import { PATCH as patchPublicationRoute } from "../app/api/publications/[id]/route";
import { POST as shiftPublicationRoute } from "../app/api/publications/[id]/shift/route";
import { DELETE as deleteWorkspaceMemberRoute } from "../app/api/workspace/members/[memberId]/route";
import { APP_SESSION_COOKIE } from "../lib/auth/cookies";
import {
  buildPublicationSlotCandidateFromDateAndIndex,
  DEFAULT_CHANNEL_PUBLISH_SETTINGS
} from "../lib/channel-publishing";
import { getDb, newId, nowIso } from "../lib/db/client";
import {
  createManagedTemplate,
  deleteManagedTemplate,
  getWorkspaceDefaultTemplateId
} from "../lib/managed-template-store";
import { createChannelPublication, createRenderExport } from "../lib/publication-store";
import { STAGE3_TEMPLATE_ID } from "../lib/stage3-template";
import { setChannelAccess } from "../lib/team-store";
import {
  acceptInviteRegistration,
  bootstrapOwner,
  canManageInviteRole,
  createInvite,
  listWorkspaceMembers,
  loginWithPassword,
  registerPublicRedactor
} from "../lib/team-store";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-api-auth-test-"));
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

function buildAssetUploadRequest(input: {
  url: string;
  cookie: string;
  kind: "avatar" | "background" | "music";
  fileName: string;
  mimeType: string;
}): Request {
  const formData = new FormData();
  formData.set("kind", input.kind);
  formData.set("file", new File([new Uint8Array([1, 2, 3, 4])], input.fileName, { type: input.mimeType }));
  return new Request(input.url, {
    method: "POST",
    headers: { cookie: input.cookie },
    body: formData
  });
}

async function createQueuedPublicationForChannel(input: {
  workspaceId: string;
  userId: string;
  channelId: string;
  sourceSuffix: string;
  slotDate: string;
  slotIndex: number;
}) {
  const db = getDb();
  const stamp = nowIso();
  const chatHistory = await import("../lib/chat-history");
  const chat = await chatHistory.createOrGetChatByUrl(
    `https://youtube.com/watch?v=${input.sourceSuffix}`,
    input.channelId
  );
  const stage3JobId = newId();
  db.prepare(
    `INSERT INTO stage3_jobs
      (id, workspace_id, user_id, kind, status, dedupe_key, payload_json, result_json, error_code, error_message, recoverable, attempts, created_at, updated_at, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, ?, ?, ?, ?, NULL, NULL)`
  ).run(
    stage3JobId,
    input.workspaceId,
    input.userId,
    "render",
    "completed",
    JSON.stringify({ chatId: chat.id, channelId: input.channelId }),
    1,
    0,
    stamp,
    stamp
  );
  const renderExport = createRenderExport({
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    chatId: chat.id,
    stage3JobId,
    artifactFileName: `${input.sourceSuffix}.mp4`,
    artifactFilePath: `/tmp/${input.sourceSuffix}.mp4`,
    artifactMimeType: "video/mp4",
    artifactSizeBytes: 1024,
    renderTitle: `Render ${input.sourceSuffix}`,
    sourceUrl: chat.url,
    snapshotJson: "{}",
    createdByUserId: input.userId
  });
  const slot = buildPublicationSlotCandidateFromDateAndIndex({
    settings: DEFAULT_CHANNEL_PUBLISH_SETTINGS,
    slotDate: input.slotDate,
    slotIndex: input.slotIndex
  });

  return createChannelPublication({
    workspaceId: input.workspaceId,
    channelId: input.channelId,
    chatId: chat.id,
    renderExportId: renderExport.id,
    scheduleMode: "slot",
    scheduledAt: slot.scheduledAt,
    uploadReadyAt: slot.uploadReadyAt,
    slotDate: slot.slotDate,
    slotIndex: slot.slotIndex,
    title: `Render ${input.sourceSuffix}`,
    description: "",
    tags: [],
    notifySubscribers: false,
    needsReview: false,
    createdByUserId: input.userId
  });
}

test("private API routes reject fake app-session cookies instead of trusting cookie presence", async () => {
  await withIsolatedAppData(async () => {
    const fakeCookie = `${APP_SESSION_COOKIE}=definitely-not-a-real-session`;
    const cases = [
      () => downloadSource(new Request("http://localhost/api/download", { method: "POST", headers: { cookie: fakeCookie } })),
      () => fetchComments(new Request("http://localhost/api/comments", { method: "POST", headers: { cookie: fakeCookie } })),
      () => fetchVideoMeta(new Request("http://localhost/api/video/meta", { method: "POST", headers: { cookie: fakeCookie } })),
      () =>
        uploadStage3Background(
          new Request("http://localhost/api/stage3/background", {
            method: "POST",
            headers: { cookie: fakeCookie }
          })
        ),
      () =>
        getRuntimeCapabilities(
          new Request("http://localhost/api/runtime/capabilities", {
            headers: { cookie: fakeCookie }
          })
        ),
      () =>
        listManagedTemplatesRoute(
          new Request("http://localhost/api/design/templates", {
            headers: { cookie: fakeCookie }
          })
        ),
      () =>
        createManagedTemplateRoute(
          new Request("http://localhost/api/design/templates", {
            method: "POST",
            headers: {
              cookie: fakeCookie,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              name: "Should Fail",
              baseTemplateId: "science-card-v1"
            })
          })
        ),
      () =>
        importManagedTemplateRoute(
          new Request("http://localhost/api/design/templates/import", {
            method: "POST",
            headers: {
              cookie: fakeCookie,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              exportVersion: "managed-template-backup-v1",
              template: { name: "Should Fail" }
            })
          })
        ),
      () =>
        readStage3Background(
          new Request("http://localhost/api/stage3/background/asset_123", {
            headers: { cookie: fakeCookie }
          }),
          { params: Promise.resolve({ id: "asset_123" }) }
        )
    ];

    for (const run of cases) {
      const response = await run();
      const body = (await response.json()) as { error?: string };
      assert.equal(response.status, 401);
      assert.equal(body.error, "Требуется авторизация.");
    }
  });
});

test("chat trace export route returns an attachment for authenticated workspace members", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Trace Route Workspace",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const chatHistory = await import("../lib/chat-history");
    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Trace Route Channel",
      username: "trace_route"
    });
    const chat = await chatHistory.createOrGetChatByUrl(
      "https://www.youtube.com/watch?v=traceRoute01",
      channel.id
    );

    const response = await getChatTrace(
      new Request(`http://localhost/api/chat-trace/${chat.id}`, {
        headers: { cookie: `${APP_SESSION_COOKIE}=${owner.sessionToken}` }
      }),
      { params: Promise.resolve({ id: chat.id }) }
    );
    const body = (await response.json()) as { version?: string; chat?: { id?: string } };

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/i);
    assert.match(response.headers.get("content-disposition") ?? "", /attachment; filename="clip-trace-trace_route-/);
    assert.equal(body.version, "clip-trace-export-v3");
    assert.equal(body.chat?.id, chat.id);
  });
});

test("team policy requires invite-issued editor accounts", async () => {
  assert.equal(canManageInviteRole("owner", "manager"), true);
  assert.equal(canManageInviteRole("owner", "redactor"), true);
  assert.equal(canManageInviteRole("owner", "redactor_limited"), true);
  assert.equal(canManageInviteRole("manager", "redactor"), true);
  assert.equal(canManageInviteRole("manager", "redactor_limited"), true);
  assert.equal(canManageInviteRole("manager", "manager"), false);

  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Roles Workspace",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });

    await assert.rejects(
      () =>
        registerPublicRedactor({
          email: "public-redactor@example.com",
          password: "Password123!",
          displayName: "Public Editor"
        }),
      /Регистрация закрыта/
    );

    const registerResponse = await registerRoute();
    const registerBody = (await registerResponse.json()) as { error?: string };

    assert.equal(registerResponse.status, 403);
    assert.match(registerBody.error ?? "", /Регистрация закрыта/);

    const invite = await createInvite({
      workspaceId: owner.workspace.id,
      email: "invited-redactor@example.com",
      role: "redactor",
      createdByUserId: owner.user.id
    });
    const invitedEditor = await acceptInviteRegistration({
      token: invite.token,
      password: "Password123!",
      displayName: "Invited Editor"
    });

    assert.equal(invitedEditor.membership.role, "redactor");
  });
});

test("team member removal closes access while allowing a later invite for the same email", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Remove Member Workspace",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const invite = await createInvite({
      workspaceId: owner.workspace.id,
      email: "remove-me@example.com",
      role: "redactor",
      createdByUserId: owner.user.id
    });
    const editor = await acceptInviteRegistration({
      token: invite.token,
      password: "Password123!",
      displayName: "Editor"
    });

    const deleteResponse = await deleteWorkspaceMemberRoute(
      new Request(`http://localhost/api/workspace/members/${editor.membership.id}`, {
        method: "DELETE",
        headers: {
          cookie: `${APP_SESSION_COOKIE}=${owner.sessionToken}`
        }
      }),
      { params: Promise.resolve({ memberId: editor.membership.id }) }
    );
    const deleteBody = (await deleteResponse.json()) as { member?: { userId?: string }; error?: string };

    assert.equal(deleteResponse.status, 200);
    assert.equal(deleteBody.member?.userId, editor.user.id);
    assert.deepEqual(
      listWorkspaceMembers(owner.workspace.id).map((member) => member.user.email),
      ["owner@example.com"]
    );
    await assert.rejects(
      () =>
        loginWithPassword({
          email: "remove-me@example.com",
          password: "Password123!"
        }),
      /Workspace membership not found/
    );

    const reinvite = await createInvite({
      workspaceId: owner.workspace.id,
      email: "remove-me@example.com",
      role: "redactor_limited",
      createdByUserId: owner.user.id
    });
    const rejoined = await acceptInviteRegistration({
      token: reinvite.token,
      password: "NewPassword123!",
      displayName: "Editor Rejoined"
    });

    assert.equal(rejoined.user.id, editor.user.id);
    assert.equal(rejoined.membership.role, "redactor_limited");
  });
});

test("channels API only returns channels visible to the current redactor", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Visible Channels Workspace",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const invite = await createInvite({
      workspaceId: owner.workspace.id,
      email: "limited@example.com",
      role: "redactor_limited",
      createdByUserId: owner.user.id
    });
    const limitedEditor = await acceptInviteRegistration({
      token: invite.token,
      password: "Password123!",
      displayName: "Limited Editor"
    });
    const chatHistory = await import("../lib/chat-history");
    const visibleChannel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Visible Channel",
      username: "visible_channel"
    });
    await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Hidden Channel",
      username: "hidden_channel"
    });
    setChannelAccess({
      channelId: visibleChannel.id,
      userId: limitedEditor.user.id,
      grantedByUserId: owner.user.id
    });

    const response = await listChannelsRoute(
      new Request("http://localhost/api/channels", {
        headers: {
          cookie: `${APP_SESSION_COOKIE}=${limitedEditor.sessionToken}`
        }
      })
    );
    const body = (await response.json()) as {
      channels?: Array<{
        id: string;
        currentUserCanOperate?: boolean;
        currentUserCanEditSetup?: boolean;
      }>;
    };

    assert.equal(response.status, 200);
    assert.deepEqual(body.channels?.map((channel) => channel.id), [visibleChannel.id]);
    assert.equal(body.channels?.[0]?.currentUserCanOperate, true);
    assert.equal(body.channels?.[0]?.currentUserCanEditSetup, false);
  });
});

test("redactor_limited can upload Step 3 background and music and change publication time", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Limited Operator Workspace",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const invite = await createInvite({
      workspaceId: owner.workspace.id,
      email: "limited-operator@example.com",
      role: "redactor_limited",
      createdByUserId: owner.user.id
    });
    const limited = await acceptInviteRegistration({
      token: invite.token,
      password: "Password123!",
      displayName: "Limited Operator"
    });
    const chatHistory = await import("../lib/chat-history");
    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Limited Ops Channel",
      username: "limited_ops"
    });
    setChannelAccess({
      channelId: channel.id,
      userId: limited.user.id,
      grantedByUserId: owner.user.id
    });
    const cookie = `${APP_SESSION_COOKIE}=${limited.sessionToken}`;

    const sourceTemplate = await createManagedTemplate(
      {
        name: "Limited Draft Backup",
        baseTemplateId: STAGE3_TEMPLATE_ID,
        content: {
          topText: "Limited import top",
          bottomText: "Limited import bottom"
        }
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        creatorDisplayName: owner.user.displayName
      }
    );
    const templateImportResponse = await importManagedTemplateRoute(
      new Request("http://localhost/api/design/templates/import", {
        method: "POST",
        headers: {
          cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          exportVersion: "managed-template-backup-v1",
          exportedAt: "2040-05-01T00:00:00.000Z",
          template: sourceTemplate
        })
      })
    );
    const templateImportBody = (await templateImportResponse.json()) as {
      template?: { id?: string; name?: string };
      error?: string;
    };
    assert.equal(templateImportResponse.status, 201);
    assert.equal(templateImportBody.template?.name, "Limited Draft Backup");
    assert.notEqual(templateImportBody.template?.id, sourceTemplate.id);
    assert.equal((await chatHistory.getChannelById(channel.id))?.templateId, channel.templateId);

    const uploadUrl = `http://localhost/api/channels/${channel.id}/assets`;

    const backgroundResponse = await uploadChannelAssetRoute(
      buildAssetUploadRequest({
        url: uploadUrl,
        cookie,
        kind: "background",
        fileName: "limited-bg.png",
        mimeType: "image/png"
      }),
      { params: Promise.resolve({ id: channel.id }) }
    );
    const backgroundBody = (await backgroundResponse.json()) as {
      asset?: { id?: string; kind?: string; mimeType?: string };
      error?: string;
    };
    assert.equal(backgroundResponse.status, 200);
    assert.equal(backgroundBody.asset?.kind, "background");
    assert.equal(backgroundBody.asset?.mimeType, "image/png");

    const musicResponse = await uploadChannelAssetRoute(
      buildAssetUploadRequest({
        url: uploadUrl,
        cookie,
        kind: "music",
        fileName: "limited-music.mp3",
        mimeType: "audio/mpeg"
      }),
      { params: Promise.resolve({ id: channel.id }) }
    );
    const musicBody = (await musicResponse.json()) as {
      asset?: { id?: string; kind?: string; mimeType?: string };
      error?: string;
    };
    assert.equal(musicResponse.status, 200);
    assert.equal(musicBody.asset?.kind, "music");
    assert.equal(musicBody.asset?.mimeType, "audio/mpeg");

    const avatarResponse = await uploadChannelAssetRoute(
      buildAssetUploadRequest({
        url: uploadUrl,
        cookie,
        kind: "avatar",
        fileName: "limited-avatar.png",
        mimeType: "image/png"
      }),
      { params: Promise.resolve({ id: channel.id }) }
    );
    assert.equal(avatarResponse.status, 403);

    const customTimePublication = await createQueuedPublicationForChannel({
      workspaceId: owner.workspace.id,
      userId: owner.user.id,
      channelId: channel.id,
      sourceSuffix: "limitedCustom001",
      slotDate: "2040-05-05",
      slotIndex: 0
    });
    const patchResponse = await patchPublicationRoute(
      new Request(`http://localhost/api/publications/${customTimePublication.id}`, {
        method: "PATCH",
        headers: {
          cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          scheduleMode: "custom",
          scheduledAtLocal: "2040-05-06T14:30"
        })
      }),
      { params: Promise.resolve({ id: customTimePublication.id }) }
    );
    const patchBody = (await patchResponse.json()) as {
      publication?: { scheduleMode?: string; scheduledAt?: string; slotDate?: string };
      error?: string;
    };
    assert.equal(patchResponse.status, 200);
    assert.equal(patchBody.publication?.scheduleMode, "custom");
    assert.match(patchBody.publication?.scheduledAt ?? "", /^2040-05-06T/);

    const shiftPublication = await createQueuedPublicationForChannel({
      workspaceId: owner.workspace.id,
      userId: owner.user.id,
      channelId: channel.id,
      sourceSuffix: "limitedShift001",
      slotDate: "2040-05-07",
      slotIndex: 0
    });
    const shiftResponse = await shiftPublicationRoute(
      new Request(`http://localhost/api/publications/${shiftPublication.id}/shift`, {
        method: "POST",
        headers: {
          cookie,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          axis: "slot",
          direction: "next"
        })
      }),
      { params: Promise.resolve({ id: shiftPublication.id }) }
    );
    const shiftBody = (await shiftResponse.json()) as {
      publication?: { slotIndex?: number; slotDate?: string };
      error?: string;
    };
    assert.equal(shiftResponse.status, 200);
    assert.equal(shiftBody.publication?.slotIndex, 1);
    assert.equal(shiftBody.publication?.slotDate, "2040-05-07");
  });
});

test("redactor can load a managed template when it is assigned to a visible channel", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Template Runtime Workspace",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const invite = await createInvite({
      workspaceId: owner.workspace.id,
      email: "editor@example.com",
      role: "redactor",
      createdByUserId: owner.user.id
    });
    const editor = await acceptInviteRegistration({
      token: invite.token,
      password: "Password123!",
      displayName: "Editor"
    });
    const chatHistory = await import("../lib/chat-history");
    const template = await createManagedTemplate(
      {
        name: "Shared Runtime Template",
        baseTemplateId: "science-card-v1",
        templateConfig: {
          card: {
            borderWidth: 18,
            borderColor: "#2057d6"
          }
        }
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        creatorDisplayName: owner.user.displayName
      }
    );

    try {
      const channel = await chatHistory.createChannel({
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        name: "Shared Channel",
        username: "shared_channel",
        templateId: template.id
      });
      setChannelAccess({
        channelId: channel.id,
        userId: editor.user.id,
        grantedByUserId: owner.user.id
      });

      const response = await getManagedTemplate(
        new Request(`http://localhost/api/design/templates/${template.id}`, {
          headers: { cookie: `${APP_SESSION_COOKIE}=${editor.sessionToken}` }
        }),
        { params: Promise.resolve({ templateId: template.id }) }
      );
      const body = (await response.json()) as {
        error?: string;
        template?: { id?: string; name?: string; templateConfig?: { card?: { borderWidth?: number } } };
      };

      assert.equal(response.status, 200);
      assert.equal(body.template?.id, template.id);
      assert.equal(body.template?.name, "Shared Runtime Template");
      assert.equal(body.template?.templateConfig?.card?.borderWidth, 18);
    } finally {
      await deleteManagedTemplate(template.id);
    }
  });
});

test("redactor can open any template in the same workspace library", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Template Scope Workspace",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const invite = await createInvite({
      workspaceId: owner.workspace.id,
      email: "editor@example.com",
      role: "redactor",
      createdByUserId: owner.user.id
    });
    const editor = await acceptInviteRegistration({
      token: invite.token,
      password: "Password123!",
      displayName: "Editor"
    });
    const template = await createManagedTemplate(
      {
        name: "Private Draft Template",
        baseTemplateId: "science-card-v1"
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        creatorDisplayName: owner.user.displayName
      }
    );

    try {
      const response = await getManagedTemplate(
        new Request(`http://localhost/api/design/templates/${template.id}`, {
          headers: { cookie: `${APP_SESSION_COOKIE}=${editor.sessionToken}` }
        }),
        { params: Promise.resolve({ templateId: template.id }) }
      );
      const body = (await response.json()) as { error?: string; template?: { id?: string; name?: string } };

      assert.equal(response.status, 200);
      assert.equal(body.template?.id, template.id);
      assert.equal(body.template?.name, "Private Draft Template");
    } finally {
      await deleteManagedTemplate(template.id);
    }
  });
});

test("managed template list returns the whole workspace library to redactors", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Template List Workspace",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const invite = await createInvite({
      workspaceId: owner.workspace.id,
      email: "editor@example.com",
      role: "redactor",
      createdByUserId: owner.user.id
    });
    const editor = await acceptInviteRegistration({
      token: invite.token,
      password: "Password123!",
      displayName: "Editor"
    });
    const chatHistory = await import("../lib/chat-history");
    const sharedTemplate = await createManagedTemplate(
      {
        name: "Shared Channel Template",
        baseTemplateId: "science-card-v1"
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        creatorDisplayName: owner.user.displayName
      }
    );
    const privateTemplate = await createManagedTemplate(
      {
        name: "Private Draft Template",
        baseTemplateId: "science-card-v1"
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        creatorDisplayName: owner.user.displayName
      }
    );

    try {
      const channel = await chatHistory.createChannel({
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        name: "Template Visibility Channel",
        username: "template_visibility",
        templateId: sharedTemplate.id
      });
      setChannelAccess({
        channelId: channel.id,
        userId: editor.user.id,
        grantedByUserId: owner.user.id
      });

      const response = await listManagedTemplatesRoute(
        new Request("http://localhost/api/design/templates", {
          headers: { cookie: `${APP_SESSION_COOKIE}=${editor.sessionToken}` }
        })
      );
      const body = (await response.json()) as {
        templates?: Array<{ id: string; layoutFamily?: string }>;
      };

      assert.equal(response.status, 200);
      assert.ok(body.templates?.some((template) => template.layoutFamily === STAGE3_TEMPLATE_ID));
      assert.ok(body.templates?.some((template) => template.id === sharedTemplate.id));
      assert.ok(body.templates?.some((template) => template.id === privateTemplate.id));
    } finally {
      await deleteManagedTemplate(sharedTemplate.id);
      await deleteManagedTemplate(privateTemplate.id);
    }
  });
});

test("managed template backup import route creates a new workspace template", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Template Import Workspace",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const sourceTemplate = await createManagedTemplate(
      {
        name: "Route Backup Source",
        baseTemplateId: "science-card-v1",
        content: {
          topText: "Route backup top",
          bottomText: "Route backup bottom"
        }
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        creatorDisplayName: owner.user.displayName
      }
    );

    try {
      const response = await importManagedTemplateRoute(
        new Request("http://localhost/api/design/templates/import", {
          method: "POST",
          headers: {
            cookie: `${APP_SESSION_COOKIE}=${owner.sessionToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            exportVersion: "managed-template-backup-v1",
            exportedAt: "2026-04-30T00:00:00.000Z",
            template: sourceTemplate
          })
        })
      );
      const body = (await response.json()) as {
        error?: string;
        template?: { id?: string; name?: string; content?: { topText?: string } };
      };

      assert.equal(response.status, 201);
      assert.notEqual(body.template?.id, sourceTemplate.id);
      assert.equal(body.template?.name, "Route Backup Source");
      assert.equal(body.template?.content?.topText, "Route backup top");
    } finally {
      await deleteManagedTemplate(sourceTemplate.id);
    }
  });
});

test("redactor can update a managed template when it is assigned to an editable channel", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Template Edit Workspace",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const invite = await createInvite({
      workspaceId: owner.workspace.id,
      email: "editor@example.com",
      role: "redactor",
      createdByUserId: owner.user.id
    });
    const editor = await acceptInviteRegistration({
      token: invite.token,
      password: "Password123!",
      displayName: "Editor"
    });
    const chatHistory = await import("../lib/chat-history");
    const template = await createManagedTemplate(
      {
        name: "Editable Shared Template",
        baseTemplateId: "science-card-v1"
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        creatorDisplayName: owner.user.displayName
      }
    );

    try {
      const channel = await chatHistory.createChannel({
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        name: "Editable Shared Channel",
        username: "editable_shared_channel",
        templateId: template.id
      });
      setChannelAccess({
        channelId: channel.id,
        userId: editor.user.id,
        grantedByUserId: owner.user.id
      });

      const response = await updateManagedTemplateRoute(
        new Request(`http://localhost/api/design/templates/${template.id}`, {
          method: "PUT",
          headers: {
            cookie: `${APP_SESSION_COOKIE}=${editor.sessionToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            name: "Editable Shared Template Updated",
            description: "Updated through channel access"
          })
        }),
        { params: Promise.resolve({ templateId: template.id }) }
      );
      const body = (await response.json()) as {
        error?: string;
        template?: { id?: string; name?: string; description?: string };
      };

      assert.equal(response.status, 200);
      assert.equal(body.template?.id, template.id);
      assert.equal(body.template?.name, "Editable Shared Template Updated");
      assert.equal(body.template?.description, "Updated through channel access");
    } finally {
      await deleteManagedTemplate(template.id);
    }
  });
});

test("workspace default template is editable but the last template cannot be deleted", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Workspace Template Guard Workspace",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const defaultTemplateId = await getWorkspaceDefaultTemplateId(owner.workspace.id);

    const updateResponse = await updateManagedTemplateRoute(
      new Request(`http://localhost/api/design/templates/${defaultTemplateId}`, {
        method: "PUT",
        headers: {
          cookie: `${APP_SESSION_COOKIE}=${owner.sessionToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: "Updated Default Template"
        })
      }),
      { params: Promise.resolve({ templateId: defaultTemplateId }) }
    );
    const updateBody = (await updateResponse.json()) as { error?: string; template?: { name?: string } };

    assert.equal(updateResponse.status, 200);
    assert.equal(updateBody.template?.name, "Updated Default Template");

    const deleteResponse = await deleteManagedTemplateRoute(
      new Request(`http://localhost/api/design/templates/${defaultTemplateId}`, {
        method: "DELETE",
        headers: {
          cookie: `${APP_SESSION_COOKIE}=${owner.sessionToken}`
        }
      }),
      { params: Promise.resolve({ templateId: defaultTemplateId }) }
    );
    const deleteBody = (await deleteResponse.json()) as { error?: string };

    assert.equal(deleteResponse.status, 409);
    assert.equal(deleteBody.error, "Нельзя удалить последний шаблон workspace.");
  });
});

test("channels self-heal to the default template when a custom managed template is missing", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Channel Template Repair Workspace",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const chatHistory = await import("../lib/chat-history");
    const defaultTemplateId = await getWorkspaceDefaultTemplateId(owner.workspace.id);
    const template = await createManagedTemplate(
      {
        name: "Ephemeral Template",
        baseTemplateId: "science-card-v1"
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        creatorDisplayName: owner.user.displayName
      }
    );

    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Repair Channel",
      username: "repair_channel",
      templateId: template.id
    });

    await deleteManagedTemplate(template.id);

    const reloaded = await chatHistory.getChannelById(channel.id);
    assert.equal(reloaded?.templateId, defaultTemplateId);

    const listed = await chatHistory.listChannels(owner.workspace.id);
    assert.equal(listed.find((item) => item.id === channel.id)?.templateId, defaultTemplateId);
  });
});

test("channel setup allows assigning any template from the same workspace library", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Channel Template Scope Workspace",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const invite = await createInvite({
      workspaceId: owner.workspace.id,
      email: "editor@example.com",
      role: "redactor",
      createdByUserId: owner.user.id
    });
    const editor = await acceptInviteRegistration({
      token: invite.token,
      password: "Password123!",
      displayName: "Editor"
    });
    const chatHistory = await import("../lib/chat-history");
    const privateTemplate = await createManagedTemplate(
      {
        name: "Owner Private Template",
        baseTemplateId: "science-card-v1"
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        creatorDisplayName: owner.user.displayName
      }
    );
    const sharedTemplate = await createManagedTemplate(
      {
        name: "Editor Shared Template",
        baseTemplateId: "science-card-v1"
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        creatorDisplayName: owner.user.displayName
      }
    );

    try {
      const channel = await chatHistory.createChannel({
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        name: "Scoped Channel",
        username: "scoped_channel",
        templateId: sharedTemplate.id
      });
      setChannelAccess({
        channelId: channel.id,
        userId: editor.user.id,
        grantedByUserId: owner.user.id
      });

      const response = await patchChannelRoute(
        new Request(`http://localhost/api/channels/${channel.id}`, {
          method: "PATCH",
          headers: {
            cookie: `${APP_SESSION_COOKIE}=${editor.sessionToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            templateId: privateTemplate.id
          })
        }),
        { params: Promise.resolve({ id: channel.id }) }
      );
      const body = (await response.json()) as { error?: string };
      const reloaded = await chatHistory.getChannelById(channel.id);

      assert.equal(response.status, 200);
      assert.equal(body.error, undefined);
      assert.equal(reloaded?.templateId, privateTemplate.id);
    } finally {
      await deleteManagedTemplate(privateTemplate.id);
      await deleteManagedTemplate(sharedTemplate.id);
    }
  });
});

test("deleting a custom template reassigns channels to the stable default template", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Template Delete Fallback Workspace",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const chatHistory = await import("../lib/chat-history");
    const defaultTemplateId = await getWorkspaceDefaultTemplateId(owner.workspace.id);
    const template = await createManagedTemplate(
      {
        name: "Delete Me",
        baseTemplateId: "science-card-v1"
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        creatorDisplayName: owner.user.displayName
      }
    );

    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Delete Fallback Channel",
      username: "delete_fallback_channel",
      templateId: template.id
    });

    const response = await deleteManagedTemplateRoute(
      new Request(`http://localhost/api/design/templates/${template.id}`, {
        method: "DELETE",
        headers: {
          cookie: `${APP_SESSION_COOKIE}=${owner.sessionToken}`
        }
      }),
      { params: Promise.resolve({ templateId: template.id }) }
    );
    const body = (await response.json()) as {
      deletedId?: string;
      fallbackTemplateId?: string;
      reassignedChannels?: number;
    };
    const reloaded = await chatHistory.getChannelById(channel.id);

    assert.equal(response.status, 200);
    assert.equal(body.deletedId, template.id);
    assert.equal(body.fallbackTemplateId, defaultTemplateId);
    assert.equal(body.reassignedChannels, 1);
    assert.equal(reloaded?.templateId, defaultTemplateId);
  });
});

test("managed template GET reports archived references instead of a generic missing error", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Template Archived Ref Workspace",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const template = await createManagedTemplate(
      {
        name: "Archive Me",
        baseTemplateId: "science-card-v1"
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        creatorDisplayName: owner.user.displayName
      }
    );

    await deleteManagedTemplate(template.id, { workspaceId: owner.workspace.id });

    const response = await getManagedTemplate(
      new Request(`http://localhost/api/design/templates/${template.id}`, {
        headers: {
          cookie: `${APP_SESSION_COOKIE}=${owner.sessionToken}`
        }
      }),
      { params: Promise.resolve({ templateId: template.id }) }
    );
    const body = (await response.json()) as {
      error?: string;
      referenceStatus?: string;
    };

    assert.equal(response.status, 404);
    assert.equal(body.error, "Template is archived.");
    assert.equal(body.referenceStatus, "archived");
  });
});

test("deleting an already archived template is idempotent and returns a recovery fallback", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Template Idempotent Delete Workspace",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const defaultTemplateId = await getWorkspaceDefaultTemplateId(owner.workspace.id);
    const template = await createManagedTemplate(
      {
        name: "Archive Me Twice",
        baseTemplateId: "science-card-v1"
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        creatorDisplayName: owner.user.displayName
      }
    );

    await deleteManagedTemplate(template.id, { workspaceId: owner.workspace.id });

    const response = await deleteManagedTemplateRoute(
      new Request(`http://localhost/api/design/templates/${template.id}`, {
        method: "DELETE",
        headers: {
          cookie: `${APP_SESSION_COOKIE}=${owner.sessionToken}`
        }
      }),
      { params: Promise.resolve({ templateId: template.id }) }
    );
    const body = (await response.json()) as {
      deletedId?: string;
      fallbackTemplateId?: string | null;
      alreadyDeleted?: boolean;
    };

    assert.equal(response.status, 200);
    assert.equal(body.deletedId, template.id);
    assert.equal(body.fallbackTemplateId, defaultTemplateId);
    assert.equal(body.alreadyDeleted, true);
  });
});
