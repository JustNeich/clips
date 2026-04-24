import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  resolveChannelManagerTemplateFormatGroup
} from "../app/components/ChannelManager";
import { ChannelManagerStage2Tab } from "../app/components/ChannelManagerStage2Tab";
import { buildQuickRegeneratePrompt } from "../lib/stage2-quick-regenerate";
import {
  DEFAULT_STAGE2_HARD_CONSTRAINTS,
  DEFAULT_STAGE2_EXAMPLES_CONFIG,
  normalizeStage2ExamplesConfig
} from "../lib/stage2-channel-config";
import {
  DEFAULT_STAGE2_PROMPT_CONFIG,
  normalizeStage2PromptConfig
} from "../lib/stage2-pipeline";
import {
  DEFAULT_STAGE2_CAPTION_PROVIDER_CONFIG
} from "../lib/stage2-caption-provider";
import {
  listStage2WorkerProfiles,
  resolveStage2WorkerProfile,
  DEFAULT_STAGE2_WORKER_PROFILE_ID
} from "../lib/stage2-worker-profile";
import {
  DEFAULT_WORKSPACE_CODEX_MODEL_CONFIG,
  resolveWorkspaceCodexModelConfig
} from "../lib/workspace-codex-models";
import { createChannel, getChannelById, updateChannelById } from "../lib/chat-history";
import { bootstrapOwner } from "../lib/team-store";
import { CHANNEL_STORY_TEMPLATE_ID, STAGE3_TEMPLATE_ID } from "../lib/stage3-template";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-stage2-single-baseline-test-"));
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

test("single-baseline worker registry exposes only the canonical active profile", () => {
  const profiles = listStage2WorkerProfiles();

  assert.deepEqual(profiles.map((profile) => profile.id), [DEFAULT_STAGE2_WORKER_PROFILE_ID]);
  assert.equal(profiles[0]?.executionMode, "one_shot_reference_v2");

  const historical = resolveStage2WorkerProfile("stable_reference_v6_experimental");
  assert.equal(historical.resolvedId, "stable_reference_v6_experimental");
  assert.equal(historical.origin, "channel_setting");
});

test("quick regenerate prompt uses the minimal video-first contract", () => {
  const prompt = buildQuickRegeneratePrompt({
    stage2: {
      source: {
        url: "https://example.com/clip",
        title: "Clip",
        frameDescriptions: ["frame 1", "frame 2"],
        topComments: [
          { id: "c1", author: "viewer", likes: 10, text: "wild clip" }
        ],
        allComments: [
          { id: "c1", author: "viewer", likes: 10, text: "wild clip" }
        ],
        commentsUsedForPrompt: 1
      },
      output: {
        inputAnalysis: {
          keyPhraseToAdapt: "did you know",
          commentVibe: "shocked"
        },
        captionOptions: [
          {
            option: 1,
            candidateId: "option_1",
            angle: "history_fact",
            top: "Did you know?",
            bottom: "This clip changed everything.",
            topRu: "А вы знали?",
            bottomRu: "Этот клип изменил всё."
          }
        ],
        titleOptions: [
          {
            option: 1,
            title: "History clip",
            titleRu: "Исторический клип"
          }
        ],
        finalPick: {
          option: 1,
          reason: "Best fit."
        }
      },
      diagnostics: null,
      seo: null,
      warnings: [],
      model: "gpt-5.4",
      channel: {
        id: "channel_1",
        name: "History",
        username: "history"
      }
    } as any,
    channel: {
      id: "channel_1",
      name: "History",
      username: "history",
      stage2HardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS,
      stage2StyleProfile: undefined,
      editorialMemory: undefined
    },
    userInstruction: "Make it shorter."
  });

  assert.match(prompt, /video-first/i);
  assert.match(prompt, /video_truth_json/);
  assert.match(prompt, /comments_hint_json/);
  assert.match(prompt, /hard_constraints_json/);
  assert.match(prompt, /user_instruction/);
  assert.doesNotMatch(prompt, /channelLearning/);
  assert.doesNotMatch(prompt, /editorialMemory/);
  assert.doesNotMatch(prompt, /selectedExamples/);
  assert.doesNotMatch(prompt, /retrieval/i);
});

test("channel persistence keeps channel prompt and examples overrides while ignoring legacy worker profile", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Single Baseline Workspace",
      email: "single-baseline@example.com",
      password: "Password123!",
      displayName: "Owner"
    });

    const customExamplesConfig = normalizeStage2ExamplesConfig(
      {
        useWorkspaceDefault: false,
        customExamplesJson: JSON.stringify([
          {
            top: "This guard isn't watching a concert, he's counting exits.",
            bottom: "Somebody has to be allergic to chaos."
          }
        ]),
        customExamplesText: "Use dry, specific, present-tense captions."
      },
      {
        channelId: "channel",
        channelName: "History Explained"
      }
    );
    const customPromptConfig = normalizeStage2PromptConfig({
      ...DEFAULT_STAGE2_PROMPT_CONFIG,
      useWorkspaceDefault: false,
      sourceMode: "custom",
      stages: {
        ...DEFAULT_STAGE2_PROMPT_CONFIG.stages,
        oneShotReference: {
          ...DEFAULT_STAGE2_PROMPT_CONFIG.stages.oneShotReference,
          prompt: "Custom channel one-shot prompt with video_truth_json and examples_json."
        }
      }
    });

    const channel = await createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "History Explained",
      username: "historyexplained13",
      stage2WorkerProfileId: "stable_social_wave_v1",
      stage2ExamplesConfig: customExamplesConfig,
      stage2PromptConfig: customPromptConfig
    });

    assert.equal(channel.stage2WorkerProfileId, null);
    assert.equal(channel.stage2ExamplesConfig.useWorkspaceDefault, false);
    assert.equal(channel.stage2ExamplesConfig.sourceMode, "custom");
    assert.equal(channel.stage2ExamplesConfig.customExamples.length, 1);
    assert.equal(channel.stage2PromptConfig.useWorkspaceDefault, false);
    assert.equal(channel.stage2PromptConfig.sourceMode, "custom");
    assert.match(channel.stage2PromptConfig.stages.oneShotReference.prompt, /Custom channel/);

    const updated = await updateChannelById(channel.id, {
      stage2WorkerProfileId: "stable_skill_gap_v1",
      stage2ExamplesConfig: normalizeStage2ExamplesConfig(
        {
          useWorkspaceDefault: false,
          sourceMode: "system",
          systemPresetId: "animals_examples"
        },
        {
          channelId: channel.id,
          channelName: channel.name
        }
      ),
      stage2PromptConfig: normalizeStage2PromptConfig({
        ...DEFAULT_STAGE2_PROMPT_CONFIG,
        useWorkspaceDefault: false,
        sourceMode: "system",
        systemPresetId: "animals_system_prompt"
      }),
      stage2HardConstraints: {
        ...DEFAULT_STAGE2_HARD_CONSTRAINTS,
        topLengthMin: 18
      }
    });

    assert.equal(updated.stage2WorkerProfileId, null);
    assert.equal(updated.stage2ExamplesConfig.useWorkspaceDefault, false);
    assert.equal(updated.stage2ExamplesConfig.sourceMode, "system");
    assert.equal(updated.stage2ExamplesConfig.systemPresetId, "animals_examples");
    assert.equal(updated.stage2PromptConfig.useWorkspaceDefault, false);
    assert.equal(updated.stage2PromptConfig.sourceMode, "system");
    assert.equal(updated.stage2PromptConfig.systemPresetId, "animals_system_prompt");
    assert.equal(updated.stage2HardConstraints.topLengthMin, 18);

    const reloaded = await getChannelById(channel.id);
    assert.equal(reloaded?.stage2WorkerProfileId, null);
    assert.equal(reloaded?.stage2ExamplesConfig.useWorkspaceDefault, false);
    assert.equal(reloaded?.stage2ExamplesConfig.sourceMode, "system");
    assert.equal(reloaded?.stage2ExamplesConfig.systemPresetId, "animals_examples");
    assert.equal(reloaded?.stage2PromptConfig.useWorkspaceDefault, false);
    assert.equal(reloaded?.stage2PromptConfig.systemPresetId, "animals_system_prompt");
    assert.equal(reloaded?.stage2HardConstraints.topLengthMin, 18);
  });
});

test("ChannelManager resolves active format from managed template layout family", () => {
  assert.equal(
    resolveChannelManagerTemplateFormatGroup("workspace-story-template", [
      {
        id: "workspace-story-template",
        name: "Workspace Story Template",
        description: "",
        layoutFamily: CHANNEL_STORY_TEMPLATE_ID,
        baseTemplateId: CHANNEL_STORY_TEMPLATE_ID,
        workspaceId: "workspace_1",
        creatorUserId: "owner_1",
        creatorDisplayName: "Owner",
        createdAt: "2026-04-24T00:00:00.000Z",
        updatedAt: "2026-04-24T00:00:00.000Z",
        versionsCount: 0
      }
    ]),
    "channel_story"
  );
  assert.equal(
    resolveChannelManagerTemplateFormatGroup(STAGE3_TEMPLATE_ID, []),
    "classic_top_bottom"
  );
});

test("ChannelManagerStage2Tab renders the minimal single-baseline Stage 2 surface", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChannelManagerStage2Tab, {
      isWorkspaceDefaultsSelection: true,
      stage2HardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS,
      bannedWordsInput: "",
      bannedOpenersInput: "",
      workspaceStage2PromptConfig: DEFAULT_STAGE2_PROMPT_CONFIG,
      workspaceStage2CaptionProviderConfig: DEFAULT_STAGE2_CAPTION_PROVIDER_CONFIG,
      workspaceCodexModelConfig: DEFAULT_WORKSPACE_CODEX_MODEL_CONFIG,
      resolvedWorkspaceCodexModelConfig: resolveWorkspaceCodexModelConfig({
        config: DEFAULT_WORKSPACE_CODEX_MODEL_CONFIG
      }),
      autosaveState: {
        brand: { status: "idle", message: null },
        stage2: { status: "idle", message: null },
        stage2Defaults: { status: "idle", message: null },
        render: { status: "idle", message: null }
      },
      canEditWorkspaceDefaults: true,
      canEditHardConstraints: true,
      updateStage2HardConstraint: () => undefined,
      updateBannedWordsInput: () => undefined,
      updateBannedOpenersInput: () => undefined,
      updateStage2PromptTemplate: () => undefined,
      updateStage2PromptReasoning: () => undefined,
      resetStage2PromptStage: () => undefined,
      updateWorkspaceCaptionProvider: () => undefined,
      updateWorkspaceAnthropicModel: () => undefined,
      updateWorkspaceOpenRouterModel: () => undefined,
      updateAnthropicApiKeyInput: () => undefined,
      saveWorkspaceAnthropicIntegration: async () => undefined,
      disconnectWorkspaceAnthropicIntegration: async () => undefined,
      updateOpenRouterApiKeyInput: () => undefined,
      saveWorkspaceOpenRouterIntegration: async () => undefined,
      disconnectWorkspaceOpenRouterIntegration: async () => undefined,
      updateWorkspaceCodexModelSetting: () => undefined
    })
  );

  assert.match(html, /Stage 2 caption engine/);
  assert.match(html, /System prompt/);
  assert.match(html, /Animals system prompt/);
  assert.match(html, /Channel \+ Story profile/);
  assert.match(html, /Top &amp; Bottom/);
  assert.match(html, /Examples corpus/);
  assert.match(html, /One-shot model/);
  assert.match(html, /Caption provider/);
  assert.doesNotMatch(html, /Формат pipeline/);
  assert.doesNotMatch(html, /Custom examples JSON/);
  assert.doesNotMatch(html, /Стиль канала/);
});
