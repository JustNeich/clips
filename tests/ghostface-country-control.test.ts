import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { POST as controlRoute } from "../app/api/admin/control/copscopes/route";
import {
  GHOSTFACE_COUNTRY_CHANNEL_NAME,
  GHOSTFACE_COUNTRY_CHANNEL_USERNAME,
  GHOSTFACE_COUNTRY_TEMPLATE_NAME
} from "../lib/ghostface-country-channel-preset";
import { createChannel, getChannelById } from "../lib/chat-history";
import { createMcpAccessToken } from "../lib/mcp-token-store";
import { readManagedTemplate } from "../lib/managed-template-store";
import { bootstrapOwner } from "../lib/team-store";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-ghostface-control-test-"));
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

test("control API creates and assigns the Ghostface Country managed template", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Ghostface Workspace",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: GHOSTFACE_COUNTRY_CHANNEL_NAME,
      username: GHOSTFACE_COUNTRY_CHANNEL_USERNAME
    });
    const controlToken = createMcpAccessToken({
      workspaceId: owner.workspace.id,
      ownerUserId: owner.user.id,
      expiresInDays: 1,
      scopes: ["flow:read", "control:write"]
    });

    const response = await controlRoute(
      new Request("http://localhost/api/admin/control/copscopes", {
        method: "POST",
        headers: {
          authorization: `Bearer ${controlToken.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          tool: "clips_control_apply_ghostface_template",
          input: {}
        })
      })
    );

    const body = (await response.json()) as {
      channelId?: string;
      templateId?: string;
      templateAction?: string;
      channelAction?: string;
    };
    assert.equal(response.status, 200);
    assert.equal(body.channelId, channel.id);
    assert.equal(body.templateAction, "create");
    assert.equal(body.channelAction, "update");

    const updatedChannel = await getChannelById(channel.id);
    assert.equal(updatedChannel?.templateId, body.templateId);
    const template = await readManagedTemplate(body.templateId ?? "", {
      workspaceId: owner.workspace.id
    });
    assert.equal(template?.name, GHOSTFACE_COUNTRY_TEMPLATE_NAME);
    assert.equal(template?.baseTemplateId, "ghostface-country-v1");
    assert.equal(template?.layoutFamily, "ghostface-country-v1");
  });
});
