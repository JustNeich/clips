import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createChannel, getChannelById, updateChannelById } from "../lib/chat-history";
import { createManagedTemplate } from "../lib/managed-template-store";
import { buildStage2RunChannelSnapshot } from "../lib/stage2-run-channel-snapshot";
import { bootstrapOwner } from "../lib/team-store";
import { createDefaultTemplateHighlightConfig } from "../lib/template-highlights";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-stage2-channel-snapshot-test-"));
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

test("stage 2 channel snapshots keep the assigned managed-template highlight profile for auto/manual reuse", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Stage 2 Highlight Snapshot",
      email: "owner-stage2-highlight@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Highlight Snapshot Channel",
      username: "highlight_snapshot_channel"
    });

    const highlightProfile = createDefaultTemplateHighlightConfig({
      accentColor: "#f6c343"
    });
    highlightProfile.slots[0].enabled = false;
    highlightProfile.slots[1].enabled = true;
    highlightProfile.slots[1].color = "#18d9d2";
    highlightProfile.slots[1].label = "Facts";
    highlightProfile.slots[2].enabled = true;
    highlightProfile.slots[2].color = "#ff6b7a";
    highlightProfile.slots[2].label = "Urgency";

    const template = await createManagedTemplate(
      {
        name: "Auto Highlight Template",
        templateConfig: {
          highlights: highlightProfile
        }
      },
      {
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id
      }
    );

    await updateChannelById(channel.id, { templateId: template.id });
    const reloadedChannel = await getChannelById(channel.id);

    assert.ok(reloadedChannel);

    const snapshot = buildStage2RunChannelSnapshot(reloadedChannel, {
      workspaceId: owner.workspace.id
    });

    assert.deepEqual(snapshot.templateHighlightProfile, highlightProfile);
  });
});
