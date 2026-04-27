import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createChannel, getChannelById, updateChannelById } from "../lib/chat-history";
import { createManagedTemplate } from "../lib/managed-template-store";
import {
  DEFAULT_STAGE2_EXAMPLES_CONFIG,
  DEFAULT_STAGE2_HARD_CONSTRAINTS
} from "../lib/stage2-channel-config";
import { DEFAULT_STAGE2_PROMPT_CONFIG } from "../lib/stage2-pipeline";
import { buildStage2RunChannelSnapshot } from "../lib/stage2-run-channel-snapshot";
import { buildStage2RunRequestSnapshot } from "../lib/stage2-run-request";
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

test("stage 2 run request snapshots keep template identity and explicit examples", () => {
  const snapshot = buildStage2RunRequestSnapshot({
    sourceUrl: "https://example.com/source",
    userInstruction: "Use the approved style.",
    mode: "manual",
    channel: {
      id: "channel_request_snapshot",
      name: "Request Snapshot",
      username: "request_snapshot",
      templateId: "channel-story-v1",
      formatPipeline: "story_lead_main_caption",
      stage2WorkerProfileId: null,
      stage2ExamplesConfig: {
        ...DEFAULT_STAGE2_EXAMPLES_CONFIG,
        useWorkspaceDefault: false,
        sourceMode: "custom",
        customExamples: [
          {
            id: "example_1",
            ownerChannelId: "channel_request_snapshot",
            ownerChannelName: "Request Snapshot",
            sourceChannelId: "channel_request_snapshot",
            sourceChannelName: "Request Snapshot",
            title: "Sealed chamber reveal",
            overlayTop: "The wall clue changes the whole chamber story",
            overlayBottom: "Then the sealed room stops looking like trivia and starts looking planned.",
            transcript: "",
            clipType: "history_mystery",
            whyItWorks: ["Lead names the concrete clue before the body releases the turn."],
            qualityScore: 0.91
          }
        ]
      },
      stage2HardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS,
      stage2PromptConfig: DEFAULT_STAGE2_PROMPT_CONFIG
    }
  });

  assert.equal(snapshot.channel.templateId, "channel-story-v1");
  assert.equal(snapshot.channel.formatPipeline, "story_lead_main_caption");
  assert.equal(snapshot.channel.stage2ExamplesConfig.useWorkspaceDefault, false);
  assert.equal(snapshot.channel.stage2ExamplesConfig.customExamples.length, 1);
  assert.equal(
    snapshot.channel.stage2PromptConfig?.stages.classicOneShot.prompt,
    DEFAULT_STAGE2_PROMPT_CONFIG.stages.classicOneShot.prompt
  );
  assert.equal(
    snapshot.channel.stage2ExamplesConfig.customExamples[0]?.overlayTop,
    "The wall clue changes the whole chamber story"
  );
});
