import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { POST as fetchComments } from "../app/api/comments/route";
import { GET as getChatTrace } from "../app/api/chat-trace/[id]/route";
import { GET as getManagedTemplate } from "../app/api/design/templates/[templateId]/route";
import { POST as downloadSource } from "../app/api/download/route";
import { GET as getRuntimeCapabilities } from "../app/api/runtime/capabilities/route";
import { GET as readStage3Background } from "../app/api/stage3/background/[id]/route";
import { POST as uploadStage3Background } from "../app/api/stage3/background/route";
import { POST as fetchVideoMeta } from "../app/api/video/meta/route";
import { APP_SESSION_COOKIE } from "../lib/auth/cookies";
import { createManagedTemplate, deleteManagedTemplate } from "../lib/managed-template-store";
import { setChannelAccess } from "../lib/team-store";
import {
  acceptInviteRegistration,
  bootstrapOwner,
  canManageInviteRole,
  createInvite,
  registerPublicRedactor
} from "../lib/team-store";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-api-auth-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appDataDir;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;

  try {
    return await run();
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    await rm(appDataDir, { recursive: true, force: true });
  }
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

test("team policy keeps full redactor as the standard editor role", async () => {
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

    const publicEditor = await registerPublicRedactor({
      email: "public-redactor@example.com",
      password: "Password123!",
      displayName: "Public Editor"
    });
    assert.equal(publicEditor.membership.role, "redactor");

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

test("redactor still cannot open an unrelated managed template outside visible channels", async () => {
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
      const body = (await response.json()) as { error?: string };

      assert.equal(response.status, 404);
      assert.equal(body.error, "Template not found.");
    } finally {
      await deleteManagedTemplate(template.id);
    }
  });
});
