import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { POST as fetchComments } from "../app/api/comments/route";
import { GET as getChatTrace } from "../app/api/chat-trace/[id]/route";
import { PATCH as patchChannelRoute } from "../app/api/channels/[id]/route";
import {
  GET as listManagedTemplatesRoute,
  POST as createManagedTemplateRoute
} from "../app/api/design/templates/route";
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
import { APP_SESSION_COOKIE } from "../lib/auth/cookies";
import {
  createManagedTemplate,
  deleteManagedTemplate,
  getWorkspaceDefaultTemplateId
} from "../lib/managed-template-store";
import { STAGE3_TEMPLATE_ID } from "../lib/stage3-template";
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
