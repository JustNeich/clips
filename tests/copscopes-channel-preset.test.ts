import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  COPSCOPES_EXCLUDED_REFERENCE_IDS,
  COPSCOPES_REFERENCE_SEEDS,
  COPSCOPES_STAGE2_STORY_PROMPT,
  createCopscopesManagedTemplateSnapshot,
  createCopscopesStage2Examples,
  createCopscopesStage2PromptConfig
} from "../lib/copscopes-channel-preset";
import { createChannel, getChannelById } from "../lib/chat-history";
import { readManagedTemplate } from "../lib/managed-template-store";
import { buildStage2RunChannelSnapshot } from "../lib/stage2-run-channel-snapshot";
import { bootstrapOwner } from "../lib/team-store";
import { applyCopscopesChannelPreset } from "../scripts/apply-copscopes-channel-preset";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-copscopes-preset-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousManagedTemplatesRoot = process.env.MANAGED_TEMPLATES_ROOT;
  const previousManagedTemplatesLegacyRoot = process.env.MANAGED_TEMPLATES_LEGACY_ROOT;
  process.env.APP_DATA_DIR = appDataDir;
  process.env.MANAGED_TEMPLATES_ROOT = path.join(appDataDir, "managed-templates");
  process.env.MANAGED_TEMPLATES_LEGACY_ROOT = path.join(appDataDir, "legacy-managed-templates");
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
    if (previousManagedTemplatesRoot === undefined) {
      delete process.env.MANAGED_TEMPLATES_ROOT;
    } else {
      process.env.MANAGED_TEMPLATES_ROOT = previousManagedTemplatesRoot;
    }
    if (previousManagedTemplatesLegacyRoot === undefined) {
      delete process.env.MANAGED_TEMPLATES_LEGACY_ROOT;
    } else {
      process.env.MANAGED_TEMPLATES_LEGACY_ROOT = previousManagedTemplatesLegacyRoot;
    }
    await rm(appDataDir, { recursive: true, force: true });
  }
}

test("Copscopes preset keeps exactly 20 examples from each reference channel", () => {
  const examples = createCopscopesStage2Examples({
    ownerChannelId: "copscopes-channel",
    ownerChannelName: "Copscopes"
  });
  const counts = new Map<string, number>();

  for (const example of examples) {
    counts.set(example.sourceChannelName, (counts.get(example.sourceChannelName) ?? 0) + 1);
    assert.equal(example.ownerChannelId, "copscopes-channel");
    assert.equal(example.ownerChannelName, "Copscopes");
    assert.ok(example.overlayTop.length > 0);
    assert.ok(example.overlayBottom.length >= 60);
    assert.ok(example.whyItWorks.length >= 3);
  }

  assert.equal(examples.length, 60);
  assert.equal(counts.get("HistorryExposed"), 20);
  assert.equal(counts.get("Military Era"), 20);
  assert.equal(counts.get("Pale Witness"), 20);
  assert.equal(
    COPSCOPES_REFERENCE_SEEDS.some((seed) =>
      COPSCOPES_EXCLUDED_REFERENCE_IDS.includes(seed.id as (typeof COPSCOPES_EXCLUDED_REFERENCE_IDS)[number])
    ),
    false
  );
});

test("Copscopes prompt and template encode story format plus PaleWitness-style yellow highlights", () => {
  const promptConfig = createCopscopesStage2PromptConfig();
  const template = createCopscopesManagedTemplateSnapshot();

  assert.equal(promptConfig.useWorkspaceDefault, false);
  assert.equal(promptConfig.stages.storyOneShot.prompt, COPSCOPES_STAGE2_STORY_PROMPT);
  assert.match(promptConfig.stages.storyOneShot.prompt, /story_lead_main_caption/);
  assert.match(promptConfig.stages.storyOneShot.prompt, /Instagram captions may contain follow requests/);
  assert.match(promptConfig.stages.storyOneShot.prompt, /Do not use paranormal language for Copscopes/);
  assert.equal(template.layoutFamily, "channel-story-v1");
  assert.equal(template.templateConfig.palette.bottomTextColor, "#f8f9fb");
  assert.equal(template.templateConfig.highlights.enabled, true);
  assert.equal(template.templateConfig.highlights.topEnabled, false);
  assert.equal(template.templateConfig.highlights.bottomEnabled, true);
  assert.equal(template.templateConfig.highlights.slots[0].color, "#f4df36");
  assert.equal(template.templateConfig.highlights.slots[1].enabled, false);
  assert.equal(template.templateConfig.highlights.slots[2].enabled, false);
});

test("Copscopes apply script updates an existing channel without mutating on dry run", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Copscopes Preset",
      email: "owner-copscopes@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Copscopes",
      username: "copscopes"
    });

    const dryRun = await applyCopscopesChannelPreset({
      username: "copscopes",
      dryRun: true
    });
    const afterDryRun = await getChannelById(channel.id);

    assert.equal(dryRun.dryRun, true);
    assert.equal(dryRun.examplesCount, 60);
    assert.equal(afterDryRun?.stage2ExamplesConfig.useWorkspaceDefault, true);

    const applied = await applyCopscopesChannelPreset({
      username: "copscopes",
      dryRun: false
    });
    const reloaded = await getChannelById(channel.id);
    assert.ok(reloaded);
    const template = await readManagedTemplate(applied.templateId, {
      workspaceId: owner.workspace.id
    });

    assert.equal(applied.dryRun, false);
    assert.equal(applied.templateAction, "create");
    assert.equal(reloaded.stage2ExamplesConfig.useWorkspaceDefault, false);
    assert.equal(reloaded.stage2ExamplesConfig.sourceMode, "custom");
    assert.equal(reloaded.stage2ExamplesConfig.customExamples.length, 60);
    assert.equal(reloaded.stage2PromptConfig.useWorkspaceDefault, false);
    assert.equal(reloaded.templateId, applied.templateId);
    assert.equal(template?.templateConfig.highlights.slots[0].color, "#f4df36");

    const snapshot = buildStage2RunChannelSnapshot(reloaded, {
      workspaceId: owner.workspace.id
    });
    assert.equal(snapshot.formatPipeline, "story_lead_main_caption");
    assert.ok(snapshot.templateHighlightProfile);
    assert.equal(snapshot.templateHighlightProfile.bottomEnabled, true);
    assert.equal(snapshot.templateHighlightProfile.slots[0].color, "#f4df36");
  });
});
