import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ChannelManagerStage2Tab } from "../app/components/ChannelManagerStage2Tab";
import { buildQuickRegeneratePrompt } from "../lib/stage2-quick-regenerate";
import {
  DEFAULT_STAGE2_HARD_CONSTRAINTS,
  DEFAULT_STAGE2_EXAMPLES_CONFIG
} from "../lib/stage2-channel-config";
import { DEFAULT_STAGE2_PROMPT_CONFIG } from "../lib/stage2-pipeline";
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

test("channel persistence keeps channel Stage 2 prompt/examples config while still ignoring legacy worker profile mutations", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Single Baseline Workspace",
      email: "single-baseline@example.com",
      password: "Password123!",
      displayName: "Owner"
    });

    const channel = await createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "History Explained",
      username: "historyexplained13",
      stage2WorkerProfileId: "stable_social_wave_v1",
      stage2ExamplesConfig: {
        ...DEFAULT_STAGE2_EXAMPLES_CONFIG,
        useWorkspaceDefault: false,
        customExamples: [
          {
            id: "custom_1",
            ownerChannelId: "legacy_owner",
            ownerChannelName: "Legacy",
            sourceChannelId: "legacy_source",
            sourceChannelName: "Legacy",
            title: "Legacy example",
            overlayTop: "LEGACY",
            overlayBottom: "EXAMPLE",
            transcript: "",
            clipType: "history",
            whyItWorks: ["old"],
            qualityScore: null
          }
        ]
      }
    });

    assert.equal(channel.stage2WorkerProfileId, null);
    assert.equal(channel.stage2ExamplesConfig.useWorkspaceDefault, false);
    assert.equal(channel.stage2ExamplesConfig.customExamples.length, 1);

    const updated = await updateChannelById(channel.id, {
      stage2WorkerProfileId: "stable_skill_gap_v1",
      stage2ExamplesConfig: {
        ...DEFAULT_STAGE2_EXAMPLES_CONFIG,
        useWorkspaceDefault: false,
        promptMode: "custom",
        customSystemPrompt: "CUSTOM CHANNEL PROMPT",
        customExamplesJson: JSON.stringify([
          {
            top: "A custom top",
            bottom: "A custom bottom"
          }
        ])
      },
      stage2HardConstraints: {
        ...DEFAULT_STAGE2_HARD_CONSTRAINTS,
        topLengthMin: 18
      }
    });

    assert.equal(updated.stage2WorkerProfileId, null);
    assert.equal(updated.stage2ExamplesConfig.useWorkspaceDefault, false);
    assert.equal(updated.stage2ExamplesConfig.promptMode, "custom");
    assert.equal(updated.stage2ExamplesConfig.customSystemPrompt, "CUSTOM CHANNEL PROMPT");
    assert.equal(updated.stage2ExamplesConfig.customExamples.length, 1);
    assert.equal(updated.stage2HardConstraints.topLengthMin, 18);

    const reloaded = await getChannelById(channel.id);
    assert.equal(reloaded?.stage2WorkerProfileId, null);
    assert.equal(reloaded?.stage2ExamplesConfig.useWorkspaceDefault, false);
    assert.equal(reloaded?.stage2ExamplesConfig.promptMode, "custom");
    assert.equal(reloaded?.stage2ExamplesConfig.customSystemPrompt, "CUSTOM CHANNEL PROMPT");
    assert.equal(reloaded?.stage2ExamplesConfig.customExamples.length, 1);
    assert.equal(reloaded?.stage2HardConstraints.topLengthMin, 18);
  });
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

  assert.match(html, /Single baseline Stage 2/);
  assert.match(html, /One-shot prompt/);
  assert.match(html, /One-shot model/);
  assert.match(html, /Caption provider/);
  assert.doesNotMatch(html, /Формат pipeline/);
  assert.doesNotMatch(html, /JSON общего корпуса/);
  assert.doesNotMatch(html, /Стиль канала/);
});
