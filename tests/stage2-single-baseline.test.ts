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
  DEFAULT_STAGE2_EXAMPLES_CONFIG,
  type Stage2CorpusExample
} from "../lib/stage2-channel-config";
import {
  DEFAULT_STAGE2_PROMPT_CONFIG,
  prepareStage2PromptConfigForExplicitSave,
  resolveEffectiveStage2PromptConfig
} from "../lib/stage2-pipeline";
import {
  DEFAULT_STAGE2_CAPTION_PROVIDER_CONFIG
} from "../lib/stage2-caption-provider";
import type { JsonStageExecutor } from "../lib/viral-shorts-worker/executor";
import {
  buildVideoContext,
  ViralShortsWorkerService
} from "../lib/viral-shorts-worker/service";
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

test("default classic Stage 2 prompt uses the V6 voice with the classic prompt-first contract", () => {
  const classicPrompt = DEFAULT_STAGE2_PROMPT_CONFIG.stages.classicOneShot.prompt;
  const storyPrompt = DEFAULT_STAGE2_PROMPT_CONFIG.stages.storyOneShot.prompt;

  assert.match(classicPrompt, /^SYSTEM PROMPT v6/);
  assert.match(classicPrompt, /classic_top_bottom/);
  assert.match(classicPrompt, /classicOptions/);
  assert.match(classicPrompt, /Paused Frame Rule/);
  assert.doesNotMatch(classicPrompt, /storyOptions/);
  assert.match(storyPrompt, /story_lead_main_caption/);
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

test("prompt-first story run sends all active examples as raw examples_json", async () => {
  const service = new ViralShortsWorkerService();
  const workspaceExamples: Stage2CorpusExample[] = Array.from({ length: 4 }, (_, index) => ({
    id: `workspace_example_${index + 1}`,
    ownerChannelId: "workspace-default",
    ownerChannelName: "Workspace default",
    sourceChannelId: "workspace-default",
    sourceChannelName: "Workspace default",
    title: `Sealed chamber clue ${index + 1}`,
    overlayTop: `The tiny clue ${index + 1} changes the whole chamber story`,
    overlayBottom: `Then the sealed chamber stops looking like trivia ${index + 1}.`,
    transcript: "",
    clipType: "history_mystery",
    whyItWorks: [`Example ${index + 1} names the concrete clue before the body lands the turn.`],
    qualityScore: 0.9 + index / 100
  }));
  const promptConfig = prepareStage2PromptConfigForExplicitSave({
    nextConfig: {
      ...DEFAULT_STAGE2_PROMPT_CONFIG,
      stages: {
        ...DEFAULT_STAGE2_PROMPT_CONFIG.stages,
        storyOneShot: {
          ...DEFAULT_STAGE2_PROMPT_CONFIG.stages.storyOneShot,
          prompt:
            "CUSTOM STORY PROMPT: decide how to use source_video_json, examples_json, format_contract_json, hard_constraints_json, and user_instruction.",
          reasoningEffort: "low"
        }
      }
    }
  });
  const calls: Array<Parameters<JsonStageExecutor["runJson"]>[0]> = [];
  const executor: JsonStageExecutor = {
    async runJson<T>(input: Parameters<JsonStageExecutor["runJson"]>[0]): Promise<T> {
      calls.push(input);
      if (input.stageId === "storyOneShot") {
        return {
          formatPipeline: "story_lead_main_caption",
          analysis: {
            visual_anchors: ["cave wall", "sealed chamber", "guide points to a clue"],
            comment_vibe: "curious disbelief",
            key_phrase_to_adapt: "sealed chamber"
          },
          storyOptions: Array.from({ length: 5 }, (_, index) => ({
            candidate_id: `cand_${index + 1}`,
            lead: `Cave clue ${index + 1}`,
            mainCaption: `Then the sealed chamber stops looking like trivia and starts looking planned ${index + 1}.`,
            retained_handle: false,
            rationale: "Grounded in the visible clue."
          })),
          winner_candidate_id: "cand_1",
          titles: Array.from({ length: 5 }, (_, index) => ({
            title: `SEALED CHAMBER CLUE ${index + 1}`,
            title_ru: `SEALED CHAMBER CLUE ${index + 1}`
          }))
        } as T;
      }
      if (input.stageId === "captionTranslation") {
        return Array.from({ length: 5 }, (_, index) => ({
          candidate_id: `cand_${index + 1}`,
          top_ru: `RU TOP ${index + 1}`,
          bottom_ru: `RU BOTTOM ${index + 1}`
        })) as T;
      }
      throw new Error(`Unexpected stage ${input.stageId}`);
    }
  };

  const result = await service.runNativeCaptionPipeline({
    channel: {
      id: "channel_1",
      name: "History Explained",
      username: "historyexplained13",
      stage2ExamplesConfig: DEFAULT_STAGE2_EXAMPLES_CONFIG,
      stage2HardConstraints: {
        ...DEFAULT_STAGE2_HARD_CONSTRAINTS,
        topLengthMax: 90,
        bottomLengthMin: 20,
        bottomLengthMax: 120
      },
      templateHighlightProfile: null,
      templateTextSemantics: {
        formatGroup: "channel_story",
        formatLabel: "Channel + Story",
        topLabel: "Lead",
        bottomLabel: "Body",
        topVisible: true,
        bottomVisible: true,
        topOptional: false,
        topNote: null,
        bottomNote: null,
        leadMode: "clip_custom",
        lengthHints: {
          topLengthMin: DEFAULT_STAGE2_HARD_CONSTRAINTS.topLengthMin,
          topLengthMax: 90,
          bottomLengthMin: 20,
          bottomLengthMax: 120
        }
      }
    },
    workspaceStage2ExamplesCorpusJson: JSON.stringify(workspaceExamples),
    videoContext: buildVideoContext({
      sourceUrl: "https://example.com/history",
      title: "Sealed chamber clue in a cave wall",
      description: "A guide points out the tiny cave wall mark before the sealed chamber reveal.",
      frameDescriptions: ["A guide points at a cave wall.", "A sealed chamber entrance appears."],
      userInstruction: "Keep the AI Studio prompt behavior."
    }),
    imagePaths: [],
    executor,
    promptConfig
  });

  const oneShotCall = calls.find((call) => call.stageId === "storyOneShot");
  assert.ok(oneShotCall);
  assert.match(JSON.stringify(oneShotCall.schema), /storyOptions/);
  assert.doesNotMatch(JSON.stringify(oneShotCall.schema), /"top"/);
  assert.doesNotMatch(JSON.stringify(oneShotCall.schema), /"bottom"/);
  assert.match(oneShotCall.prompt, /CUSTOM STORY PROMPT/);
  assert.match(oneShotCall.prompt, /source_video_json/);
  assert.match(oneShotCall.prompt, /examples_json/);
  assert.match(oneShotCall.prompt, /format_contract_json/);
  assert.match(oneShotCall.prompt, /story_lead_main_caption/);
  assert.doesNotMatch(oneShotCall.prompt, /examples_guidance_json/);
  assert.doesNotMatch(oneShotCall.prompt, /template_semantics_json/);
  assert.doesNotMatch(oneShotCall.prompt, /prompt_pool/i);
  assert.doesNotMatch(oneShotCall.prompt, /selectedExampleIds/);
  for (const example of workspaceExamples) {
    assert.match(oneShotCall.prompt, new RegExp(example.id));
    assert.match(oneShotCall.prompt, new RegExp(example.overlayTop));
  }
  assert.equal(result.output.formatPipeline, "story_lead_main_caption");
  assert.equal(result.output.storyOptions?.length, 5);
  assert.equal(result.output.storyOptions?.[0]?.lead, "Cave clue 1");
  assert.equal(result.output.pipeline?.availableExamplesCount, 4);
  assert.equal(result.output.pipeline?.selectedExamplesCount, 4);
  assert.equal(result.diagnostics.examples.activeCorpusCount, 4);
  assert.equal(result.diagnostics.examples.selectorCandidateCount, 0);
  assert.equal(
    result.diagnostics.effectivePrompting.promptStages.find(
      (stage) => stage.stageId === "storyOneShot"
    )?.isCustomPrompt,
    true
  );
  assert.equal(
    result.diagnostics.effectivePrompting.promptStages.find(
      (stage) => stage.stageId === "storyOneShot"
    )?.inputManifest?.examples?.activeCorpusCount,
    4
  );
  assert.equal(
    result.diagnostics.effectivePrompting.promptStages.find(
      (stage) => stage.stageId === "storyOneShot"
    )?.inputManifest?.examples?.omittedCount,
    0
  );
});

test("prompt-first preflight fails visibly instead of truncating examples", async () => {
  const previousLimit = process.env.STAGE2_PROMPT_FIRST_MAX_CHARS;
  process.env.STAGE2_PROMPT_FIRST_MAX_CHARS = "900";
  try {
    const service = new ViralShortsWorkerService();
    const executor: JsonStageExecutor = {
      async runJson<T>(): Promise<T> {
        throw new Error("provider should not be called after preflight failure");
      }
    };
    const examples: Stage2CorpusExample[] = Array.from({ length: 3 }, (_, index) => ({
      id: `large_example_${index + 1}`,
      ownerChannelId: "workspace-default",
      ownerChannelName: "Workspace default",
      sourceChannelId: "workspace-default",
      sourceChannelName: "Workspace default",
      title: `Large example ${index + 1}`,
      overlayTop: "A very long reference lead ".repeat(10),
      overlayBottom: "A very long reference body ".repeat(10),
      transcript: "Long transcript ".repeat(30),
      clipType: "large",
      whyItWorks: ["Large fixture"],
      qualityScore: 0.9
    }));

    await assert.rejects(
      () =>
        service.runNativeCaptionPipeline({
          channel: {
            id: "channel_1",
            name: "Large Prompt",
            username: "largeprompt",
            stage2ExamplesConfig: DEFAULT_STAGE2_EXAMPLES_CONFIG,
            stage2HardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS,
            templateHighlightProfile: null
          },
          workspaceStage2ExamplesCorpusJson: JSON.stringify(examples),
          videoContext: buildVideoContext({
            sourceUrl: "https://example.com/large",
            title: "Large prompt clip",
            description: "Description ".repeat(40),
            transcript: "Transcript ".repeat(40),
            frameDescriptions: ["Frame ".repeat(40)]
          }),
          imagePaths: [],
          executor,
          promptConfig: DEFAULT_STAGE2_PROMPT_CONFIG
        }),
      /preflight limit.*examples=3.*promptChars=.*limit=900.*stage=classicOneShot/
    );
  } finally {
    if (previousLimit === undefined) {
      delete process.env.STAGE2_PROMPT_FIRST_MAX_CHARS;
    } else {
      process.env.STAGE2_PROMPT_FIRST_MAX_CHARS = previousLimit;
    }
  }
});

test("prompt-first classic run uses classicOneShot schema without story fields", async () => {
  const service = new ViralShortsWorkerService();
  const calls: Array<Parameters<JsonStageExecutor["runJson"]>[0]> = [];
  const executor: JsonStageExecutor = {
    async runJson<T>(input: Parameters<JsonStageExecutor["runJson"]>[0]): Promise<T> {
      calls.push(input);
      if (input.stageId === "classicOneShot") {
        return {
          formatPipeline: "classic_top_bottom",
          analysis: {
            visual_anchors: ["machine", "operator", "clean motion"],
            comment_vibe: "quiet respect",
            key_phrase_to_adapt: "clean motion"
          },
          classicOptions: Array.from({ length: 5 }, (_, index) => ({
            candidate_id: `cand_${index + 1}`,
            top: `The machine movement makes the whole setup readable ${index + 1}`,
            bottom: `Then the operator makes the risky part look completely normal ${index + 1}.`,
            retained_handle: false
          })),
          winner_candidate_id: "cand_1",
          titles: Array.from({ length: 5 }, (_, index) => ({
            title: `CLEAN MACHINE MOVE ${index + 1}`,
            title_ru: `CLEAN MACHINE MOVE ${index + 1}`
          }))
        } as T;
      }
      if (input.stageId === "captionTranslation") {
        return Array.from({ length: 5 }, (_, index) => ({
          candidate_id: `cand_${index + 1}`,
          top_ru: `RU TOP ${index + 1}`,
          bottom_ru: `RU BOTTOM ${index + 1}`
        })) as T;
      }
      throw new Error(`Unexpected stage ${input.stageId}`);
    }
  };

  const result = await service.runNativeCaptionPipeline({
    channel: {
      id: "channel_1",
      name: "Machines",
      username: "machines",
      stage2ExamplesConfig: DEFAULT_STAGE2_EXAMPLES_CONFIG,
      stage2HardConstraints: {
        ...DEFAULT_STAGE2_HARD_CONSTRAINTS,
        topLengthMax: 90,
        bottomLengthMax: 120
      },
      templateHighlightProfile: null
    },
    workspaceStage2ExamplesCorpusJson: "[]",
    videoContext: buildVideoContext({
      sourceUrl: "https://example.com/machine",
      title: "Machine operator",
      frameDescriptions: ["A machine moves cleanly."]
    }),
    imagePaths: [],
    executor,
    promptConfig: DEFAULT_STAGE2_PROMPT_CONFIG
  });

  const oneShotCall = calls.find((call) => call.stageId === "classicOneShot");
  assert.ok(oneShotCall);
  assert.match(JSON.stringify(oneShotCall.schema), /classicOptions/);
  assert.doesNotMatch(JSON.stringify(oneShotCall.schema), /lead/);
  assert.doesNotMatch(JSON.stringify(oneShotCall.schema), /mainCaption/);
  assert.equal(result.output.formatPipeline, "classic_top_bottom");
  assert.equal(result.output.classicOptions?.[0]?.top, "The machine movement makes the whole setup readable 1");
});

test("channel persistence keeps active examples and channel-level Stage 2 prompt overrides", async () => {
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
        sourceMode: "custom",
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
        sourceMode: "custom",
        customExamples: [
          {
            id: "custom_2",
            ownerChannelId: channel.id,
            ownerChannelName: channel.name,
            sourceChannelId: channel.id,
            sourceChannelName: channel.name,
            title: "Updated example",
            overlayTop: "UPDATED TOP",
            overlayBottom: "UPDATED BOTTOM",
            transcript: "",
            clipType: "history",
            whyItWorks: ["updated"],
            qualityScore: null
          }
        ]
      },
      stage2PromptConfig: prepareStage2PromptConfigForExplicitSave({
        nextConfig: {
          ...DEFAULT_STAGE2_PROMPT_CONFIG,
          stages: {
            ...DEFAULT_STAGE2_PROMPT_CONFIG.stages,
            classicOneShot: {
              ...DEFAULT_STAGE2_PROMPT_CONFIG.stages.classicOneShot,
              prompt: "CHANNEL CLASSIC PROMPT",
              reasoningEffort: "low"
            }
          }
        },
        previousConfig: DEFAULT_STAGE2_PROMPT_CONFIG
      }),
      stage2HardConstraints: {
        ...DEFAULT_STAGE2_HARD_CONSTRAINTS,
        topLengthMin: 18
      }
    });

    assert.equal(updated.stage2WorkerProfileId, null);
    assert.equal(updated.stage2ExamplesConfig.useWorkspaceDefault, false);
    assert.equal(updated.stage2ExamplesConfig.customExamples[0]?.overlayTop, "UPDATED TOP");
    assert.equal(updated.stage2PromptConfig.stages.classicOneShot.prompt, "CHANNEL CLASSIC PROMPT");
    assert.equal(updated.stage2HardConstraints.topLengthMin, 18);

    const reloaded = await getChannelById(channel.id);
    assert.equal(reloaded?.stage2WorkerProfileId, null);
    assert.equal(reloaded?.stage2ExamplesConfig.useWorkspaceDefault, false);
    assert.equal(reloaded?.stage2ExamplesConfig.customExamples[0]?.overlayTop, "UPDATED TOP");
    assert.equal(reloaded?.stage2PromptConfig.stages.classicOneShot.prompt, "CHANNEL CLASSIC PROMPT");
    assert.equal(reloaded?.stage2PromptConfig.useWorkspaceDefault, false);
    assert.equal(reloaded?.stage2HardConstraints.topLengthMin, 18);

    const effectivePromptConfig = resolveEffectiveStage2PromptConfig({
      workspacePromptConfig: DEFAULT_STAGE2_PROMPT_CONFIG,
      channelPromptConfig: reloaded?.stage2PromptConfig
    });
    assert.equal(effectivePromptConfig.stages.classicOneShot.prompt, "CHANNEL CLASSIC PROMPT");

    const reset = await updateChannelById(channel.id, {
      stage2PromptConfig: DEFAULT_STAGE2_PROMPT_CONFIG
    });
    assert.equal(reset.stage2PromptConfig.useWorkspaceDefault, true);
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
  assert.match(html, /Classic prompt/);
  assert.match(html, /Story prompt/);
  assert.match(html, /One-shot model/);
  assert.match(html, /Caption provider/);
  assert.doesNotMatch(html, /Формат pipeline/);
  assert.doesNotMatch(html, /JSON общего корпуса/);
  assert.doesNotMatch(html, /Стиль канала/);
});
