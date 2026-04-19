import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Step2PickCaption } from "../app/components/Step2PickCaption";
import {
  applyChannelOnboardingStyleDiscoveryResult,
  applyChannelStyleProfileEditorDiscoveryResult,
  buildChannelOnboardingCreatePayload,
  buildChannelStyleProfileFromEditorDraft,
  canNavigateChannelOnboardingStep,
  canSubmitChannelOnboardingDraft,
  canContinueChannelOnboardingStep,
  clearChannelStyleProfileEditorDirectionSelection,
  createChannelOnboardingDelimitedStringListDraft,
  createChannelStyleProfileEditorDraft,
  createChannelOnboardingDraft,
  getChannelStyleProfileEditorDiscoveryStatus,
  getChannelOnboardingProgressStepState,
  getChannelOnboardingStyleDiscoveryStatus,
  normalizePersistedChannelOnboardingState,
  normalizePersistedChannelStyleProfileEditorState,
  parseChannelOnboardingCustomExamples,
  parseChannelOnboardingReferenceLinks,
  selectAllChannelStyleProfileEditorDirections,
  setChannelOnboardingExplorationShare,
  setChannelStyleProfileEditorExplorationShare,
  toggleChannelStyleProfileEditorDirectionSelection,
  selectAllChannelOnboardingStyleDirections,
  toggleChannelOnboardingStyleDirectionSelection,
  updateChannelStyleProfileEditorReferenceLinks,
  updateChannelOnboardingReferenceLinks,
  updateChannelOnboardingDelimitedStringListDraft
} from "../app/components/channel-onboarding-support";
import type { Stage2Response } from "../app/components/types";
import {
  createChannelEditorialFeedbackEvent,
  deleteChannelEditorialFeedbackEvent,
  listChannelEditorialFeedbackEvents,
  listChannelEditorialPassiveSelectionEvents,
  listChannelEditorialRatingEvents
} from "../lib/channel-editorial-feedback-store";
import { resolveChannelEditorialMemory } from "../lib/stage2-editorial-memory-resolution";
import {
  type ChannelEditorialFeedbackEvent,
  buildStage2EditorialMemorySummary,
  normalizeStage2StyleProfile,
  STAGE2_EDITORIAL_EXPLORATION_SHARE,
  type Stage2StyleProfile
} from "../lib/stage2-channel-learning";
import {
  DEFAULT_STAGE2_HARD_CONSTRAINTS,
} from "../lib/stage2-channel-config";
import { DEFAULT_STAGE2_WORKER_PROFILE_ID } from "../lib/stage2-worker-profile";
import { buildStage2RunRequestSnapshot } from "../lib/stage2-run-request";
import { createStage2Run } from "../lib/stage2-progress-store";
import {
  buildStage2StyleDiscoveryReferenceSetEvidence,
  buildStage2StyleDiscoveryPrompt,
  buildStyleDiscoveryReferenceFramePlan,
  prioritizeStage2StyleDiscoveryComments,
  runStage2StyleDiscovery
} from "../lib/stage2-style-discovery";
import type { JsonStageExecutor } from "../lib/viral-shorts-worker/executor";
import { ViralShortsWorkerService } from "../lib/viral-shorts-worker/service";

class StaticExecutor implements JsonStageExecutor {
  constructor(private readonly response: unknown) {}

  async runJson<T>(_input: {
    stageId: string;
    prompt: string;
    schema: unknown;
    imagePaths?: string[];
    timeoutMs?: number;
    model?: string | null;
    reasoningEffort?: string | null;
  }): Promise<T> {
    return this.response as T;
  }
}

class CaptureExecutor implements JsonStageExecutor {
  public prompt = "";
  public imagePaths: string[] = [];

  constructor(private readonly response: unknown) {}

  async runJson<T>(input: {
    stageId: string;
    prompt: string;
    schema: unknown;
    imagePaths?: string[];
    timeoutMs?: number;
    model?: string | null;
    reasoningEffort?: string | null;
  }): Promise<T> {
    this.prompt = input.prompt;
    this.imagePaths = input.imagePaths ?? [];
    return this.response as T;
  }
}

function createReferenceUrls(count = 10): string[] {
  return Array.from(
    { length: count },
    (_, index) => `https://www.youtube.com/shorts/channel-style-${index + 1}`
  );
}

function createStyleProfile(selectedDirectionIds: string[] = ["direction_1", "direction_2"]): Stage2StyleProfile {
  return normalizeStage2StyleProfile({
    version: 1,
    createdAt: "2026-03-21T10:00:00.000Z",
    updatedAt: "2026-03-21T10:00:00.000Z",
    onboardingCompletedAt: "2026-03-21T10:00:00.000Z",
    discoveryPromptVersion: "test",
    referenceInfluenceSummary:
      "The reference links suggest gritty process clips, dry reactions, and a smaller exploratory slice.",
    audiencePortrait: null,
    packagingPortrait: null,
    bootstrapDiagnostics: null,
    explorationShare: STAGE2_EDITORIAL_EXPLORATION_SHARE,
    referenceLinks: createReferenceUrls(10).map((url, index) => ({
      id: `reference_${index + 1}`,
      url,
      normalizedUrl: url,
      title: `Reference ${index + 1}`,
      description: `Description ${index + 1}`,
      transcriptExcerpt: `Transcript ${index + 1}`,
      commentHighlights: [`Comment ${index + 1}`],
      totalCommentCount: 10 + index,
      selectedCommentCount: 4,
      audienceSignalSummary: `Audience summary ${index + 1}`,
      frameMoments: [
        `setup frame ${index + 1}`,
        `turn frame ${index + 1}`,
        `payoff frame ${index + 1}`
      ],
      framesUsed: true,
      sourceHint: "YouTube"
    })),
    candidateDirections: Array.from({ length: 20 }, (_, index) => ({
      id: `direction_${index + 1}`,
      fitBand: index < 8 ? "core" : index < 16 ? "adjacent" : "exploratory",
      name: `Direction ${index + 1}`,
      description: `Description for direction ${index + 1}`,
      voice: `Voice ${index + 1}`,
      topPattern: `Top pattern ${index + 1}`,
      bottomPattern: `Bottom pattern ${index + 1}`,
      humorLevel: index % 3 === 0 ? "high" : "medium",
      sarcasmLevel: index % 2 === 0 ? "medium" : "low",
      warmthLevel: index % 4 === 0 ? "medium" : "low",
      insiderDensityLevel: index % 5 === 0 ? "high" : "medium",
      bestFor: `Best for ${index + 1}`,
      avoids: `Avoid ${index + 1}`,
      microExample: `Example ${index + 1}`,
      sourceReferenceIds: index < 16 ? [`reference_${(index % 10) + 1}`] : [],
      internalPromptNotes: `Prompt note ${index + 1}`,
      axes: {
        humor: 0.4,
        sarcasm: 0.5,
        warmth: 0.3,
        insiderDensity: 0.6,
        intensity: 0.55,
        explanationDensity: 0.35,
        quoteDensity: 0.25,
        topCompression: 0.75
      }
    })),
    selectedDirectionIds
  });
}

function createDiscoveryEvidenceFixture() {
  const baseReferences = createStyleProfile([]).referenceLinks.slice(0, 2);
  return buildStage2StyleDiscoveryReferenceSetEvidence({
    promptVersion: "test-prompt-version",
    references: [
      {
        referenceLink: {
          ...baseReferences[0]!,
          audienceSignalSummary:
            "Аудитория любит сухую шутку и сразу цепляется за реакцию в кадре."
        },
        prioritizedComments: [
          {
            id: "comment_1",
            author: "A",
            text: "the side eye is the whole clip",
            likes: 4300,
            lane: "joke",
            score: 4.9
          },
          {
            id: "comment_2",
            author: "B",
            text: "nobody in that room buys the act",
            likes: 2500,
            lane: "suspicion",
            score: 4.4
          }
        ],
        commentPortrait: {
          summary:
            "Аудитория быстро шутит про side eye и часто ищет постановку или фальшь.",
          rewards: ["side eye sells the moment"],
          jokes: ["the side eye is the whole clip"],
          pushback: ["too polished for a real reaction"],
          suspicion: ["nobody in that room buys the act"],
          repeatedLanguage: ["side eye", "room"],
          dominantPosture: "аудитория быстро уходит в сухую шутку и скрытый скепсис",
          tonePreferences: ["сухая ирония", "скепсис"],
          rejects: ["слишком доверчивый пафос"]
        },
        frameMoments: [
          { slot: "setup", description: "setup frame: side glance lands immediately" },
          { slot: "turn", description: "turn frame: room catches the switch" },
          { slot: "payoff", description: "payoff frame: late awkward aftermath" }
        ],
        frameImagePaths: ["/tmp/ref-1-setup.jpg", "/tmp/ref-1-turn.jpg", "/tmp/ref-1-payoff.jpg"],
        extractionNotes: ["Sampled 3 real frames from the clip."],
        usable: true
      },
      {
        referenceLink: {
          ...baseReferences[1]!,
          audienceSignalSummary:
            "Аудитория снова замечает awkward room energy и сжимает реакцию в одну сухую формулировку."
        },
        prioritizedComments: [
          {
            id: "comment_3",
            author: "C",
            text: "that room knew immediately",
            likes: 3800,
            lane: "observation",
            score: 4.6
          },
          {
            id: "comment_4",
            author: "D",
            text: "another side eye masterpiece",
            likes: 2100,
            lane: "joke",
            score: 4.1
          }
        ],
        commentPortrait: {
          summary:
            "Аудитория вознаграждает комнатную реакцию, awkward energy и короткую мемную компрессию.",
          rewards: ["that room knew immediately"],
          jokes: ["another side eye masterpiece"],
          pushback: [],
          suspicion: [],
          repeatedLanguage: ["side eye", "room"],
          dominantPosture: "аудитория читает социальную реакцию быстрее самого сюжета",
          tonePreferences: ["сухая ирония", "мемная компрессия"],
          rejects: ["лишнее объяснение"]
        },
        frameMoments: [
          { slot: "setup", description: "setup frame: awkward room still settling" },
          { slot: "turn", description: "turn frame: reaction becomes the story" },
          { slot: "payoff", description: "payoff frame: late group read locks in" }
        ],
        frameImagePaths: ["/tmp/ref-2-setup.jpg", "/tmp/ref-2-turn.jpg", "/tmp/ref-2-payoff.jpg"],
        extractionNotes: ["Sampled 3 real frames from the clip."],
        usable: true
      }
    ]
  });
}

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-channel-learning-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;

  try {
    process.env.APP_DATA_DIR = appDataDir;
    return await run();
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    await rm(appDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2_000,
  intervalMs = 20
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition.`);
}

test("channel onboarding support walks through the four-step wizard and builds a create payload", () => {
  const draft = createChannelOnboardingDraft({
    workspaceStage2HardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS
  });
  assert.equal(draft.stage2WorkerProfileId, DEFAULT_STAGE2_WORKER_PROFILE_ID);
  assert.equal(canContinueChannelOnboardingStep("identity", draft), false);

  draft.name = "Dry Process Channel";
  draft.username = "dry_process_channel";
  assert.equal(canContinueChannelOnboardingStep("identity", draft), true);

  draft.useWorkspaceExamples = false;
  draft.stage2WorkerProfileId = "stable_skill_gap_v1";
  draft.customExamplesJson = JSON.stringify([
    {
      id: "example_1",
      ownerChannelId: "channel_1",
      ownerChannelName: "Channel 1",
      sourceChannelId: "channel_1",
      sourceChannelName: "Channel 1",
      title: "Custom example",
      overlayTop: "TOP",
      overlayBottom: "BOTTOM",
      transcript: "Transcript",
      clipType: "process",
      whyItWorks: ["specific"],
      qualityScore: 0.8
    }
  ]);
  draft.customExamplesError = parseChannelOnboardingCustomExamples({
    json: draft.customExamplesJson,
    channelName: draft.name
  }).error;
  assert.equal(canContinueChannelOnboardingStep("baseline", draft), true);

  draft.referenceLinksText = createReferenceUrls(10).join("\n");
  assert.equal(parseChannelOnboardingReferenceLinks(draft.referenceLinksText).length, 10);
  assert.equal(canContinueChannelOnboardingStep("references", draft), true);

  draft.styleProfile = createStyleProfile(["direction_1", "direction_3"]);
  draft.selectedStyleDirectionIds = ["direction_1", "direction_3"];
  const adjustedDraft = setChannelOnboardingExplorationShare(draft, 0.35);
  assert.equal(canContinueChannelOnboardingStep("styles", adjustedDraft), true);

  const payload = buildChannelOnboardingCreatePayload(adjustedDraft);
  assert.equal(payload.name, "Dry Process Channel");
  assert.equal(payload.username, "dry_process_channel");
  assert.equal(payload.stage2WorkerProfileId, "stable_skill_gap_v1");
  assert.equal(payload.referenceUrls.length, 10);
  assert.equal(payload.stage2ExamplesConfig.useWorkspaceDefault, false);
  assert.equal(payload.stage2StyleProfile.explorationShare, 0.35);
  assert.deepEqual(payload.stage2StyleProfile.selectedDirectionIds, ["direction_1", "direction_3"]);
  assert.ok(payload.stage2StyleProfile.onboardingCompletedAt);
});

test("channel onboarding delimited hard constraint drafts preserve raw separators while parsed arrays stay normalized", () => {
  const rawDraft = createChannelOnboardingDelimitedStringListDraft({
    bannedWords: ["literal", "generic"],
    bannedOpeners: ["Here is a", "This is"]
  });

  assert.equal(rawDraft.bannedWordsText, "literal, generic");
  assert.equal(rawDraft.bannedOpenersText, "Here is a, This is");

  const next = updateChannelOnboardingDelimitedStringListDraft(
    rawDraft,
    {
      ...DEFAULT_STAGE2_HARD_CONSTRAINTS,
      bannedWords: ["literal", "generic"],
      bannedOpeners: ["Here is a", "This is"]
    },
    "bannedWordsText",
    "literal, generic, "
  );

  assert.equal(next.textDraft.bannedWordsText, "literal, generic, ");
  assert.deepEqual(next.stage2HardConstraints.bannedWords, ["literal", "generic"]);
  assert.deepEqual(next.stage2HardConstraints.bannedOpeners, ["Here is a", "This is"]);

  const draft = createChannelOnboardingDraft({
    workspaceStage2HardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS
  });
  draft.name = "Raw Separator Channel";
  draft.username = "raw_separator_channel";
  draft.stage2HardConstraints = next.stage2HardConstraints;

  const payload = buildChannelOnboardingCreatePayload(draft);

  assert.deepEqual(payload.stage2HardConstraints.bannedWords, ["literal", "generic"]);
  assert.deepEqual(payload.stage2HardConstraints.bannedOpeners, ["Here is a", "This is"]);
});

test("style selection supports selecting many directions without a hard cap", () => {
  let draft = createChannelOnboardingDraft({
    workspaceStage2HardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS
  });
  draft.referenceLinksText = createReferenceUrls(10).join("\n");
  draft = applyChannelOnboardingStyleDiscoveryResult(draft, createStyleProfile([]));

  for (const direction of draft.styleProfile?.candidateDirections.slice(0, 8) ?? []) {
    draft = toggleChannelOnboardingStyleDirectionSelection(draft, direction.id);
  }

  assert.equal(draft.selectedStyleDirectionIds.length, 8);
  assert.equal(canContinueChannelOnboardingStep("styles", draft), true);

  draft = selectAllChannelOnboardingStyleDirections(draft);
  assert.equal(
    draft.selectedStyleDirectionIds.length,
    draft.styleProfile?.candidateDirections.length ?? 0
  );
  assert.equal(canSubmitChannelOnboardingDraft(draft), false);

  draft.name = "Wide Prior Channel";
  draft.username = "wide_prior_channel";
  assert.equal(canSubmitChannelOnboardingDraft(draft), true);
});

test("reference link edits keep the previous style pool until explicit regeneration and mark it stale", () => {
  let draft = createChannelOnboardingDraft({
    workspaceStage2HardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS
  });
  draft.name = "Stale Pool";
  draft.username = "stale_pool";
  draft.referenceLinksText = createReferenceUrls(10).join("\n");
  draft = applyChannelOnboardingStyleDiscoveryResult(draft, createStyleProfile(["direction_1", "direction_2"]));
  draft = toggleChannelOnboardingStyleDirectionSelection(draft, "direction_1");
  draft = toggleChannelOnboardingStyleDirectionSelection(draft, "direction_2");

  assert.equal(getChannelOnboardingStyleDiscoveryStatus(draft), "fresh");
  assert.equal(canContinueChannelOnboardingStep("styles", draft), true);

  draft = updateChannelOnboardingReferenceLinks(
    draft,
    [...createReferenceUrls(9), "https://www.youtube.com/shorts/channel-style-fresh-10"].join("\n")
  );

  assert.equal(getChannelOnboardingStyleDiscoveryStatus(draft), "stale");
  assert.equal(draft.styleProfile?.candidateDirections.length, 20);
  assert.deepEqual(draft.selectedStyleDirectionIds, ["direction_1", "direction_2"]);
  assert.equal(canContinueChannelOnboardingStep("styles", draft), false);
});

test("post-onboarding style profile draft stays stale until explicit regeneration and preserves exploration share", () => {
  let draft = createChannelStyleProfileEditorDraft(createStyleProfile(["direction_1", "direction_2"]));
  draft = setChannelStyleProfileEditorExplorationShare(draft, 0.35);
  draft = clearChannelStyleProfileEditorDirectionSelection(draft);
  draft = toggleChannelStyleProfileEditorDirectionSelection(draft, "direction_1");
  draft = toggleChannelStyleProfileEditorDirectionSelection(draft, "direction_2");
  draft = selectAllChannelStyleProfileEditorDirections(draft);

  assert.equal(getChannelStyleProfileEditorDiscoveryStatus(draft), "fresh");

  draft = updateChannelStyleProfileEditorReferenceLinks(
    draft,
    [...createReferenceUrls(9), "https://www.youtube.com/shorts/channel-style-editor-fresh-10"].join("\n")
  );

  assert.equal(getChannelStyleProfileEditorDiscoveryStatus(draft), "stale");
  assert.equal(draft.styleProfile.candidateDirections.length, 20);

  const regenerated = createStyleProfile(["direction_2", "direction_4"]);
  regenerated.referenceLinks = createReferenceUrls(9)
    .concat("https://www.youtube.com/shorts/channel-style-editor-fresh-10")
    .map((url, index) => ({
      ...createStyleProfile().referenceLinks[index]!,
      id: `reference_editor_${index + 1}`,
      url,
      normalizedUrl: url
    }));
  const refreshed = applyChannelStyleProfileEditorDiscoveryResult(draft, regenerated);

  assert.equal(getChannelStyleProfileEditorDiscoveryStatus(refreshed), "fresh");
  assert.equal(refreshed.explorationShare, 0.35);

  const payload = buildChannelStyleProfileFromEditorDraft(refreshed);
  assert.equal(payload.explorationShare, 0.35);
});

test("completed onboarding steps remain unlocked and navigable after moving backward", () => {
  const draft = applyChannelOnboardingStyleDiscoveryResult(
    {
      ...createChannelOnboardingDraft({
        workspaceStage2HardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS
      }),
      name: "Unlocked Flow",
      username: "unlocked_flow",
      referenceLinksText: createReferenceUrls(10).join("\n")
    },
    createStyleProfile(["direction_1"])
  );
  draft.selectedStyleDirectionIds = ["direction_1"];

  assert.equal(canNavigateChannelOnboardingStep("styles", "styles"), true);
  assert.equal(
    getChannelOnboardingProgressStepState({
      step: "styles",
      currentStep: "baseline",
      furthestUnlockedStep: "styles",
      draft
    }),
    "completed"
  );
  assert.equal(
    getChannelOnboardingProgressStepState({
      step: "references",
      currentStep: "baseline",
      furthestUnlockedStep: "styles",
      draft
    }),
    "completed"
  );
});

test("persisted onboarding draft restores the unlocked step and active discovery run after reload-style hydration", () => {
  const hydrated = normalizePersistedChannelOnboardingState(
    {
      step: "styles",
      furthestUnlockedStep: "styles",
      activeStyleDiscoveryRunId: "run_restore_1",
      draft: {
        ...createChannelOnboardingDraft({
          workspaceStage2HardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS
        }),
        name: "Reload Safe Channel",
        username: "reload_safe_channel",
        stage2WorkerProfileId: "stable_social_wave_v1",
        referenceLinksText: createReferenceUrls(10).join("\n"),
        styleProfile: createStyleProfile(["direction_2", "direction_4"]),
        selectedStyleDirectionIds: ["direction_2", "direction_4"]
      }
    },
    DEFAULT_STAGE2_HARD_CONSTRAINTS
  );

  assert.ok(hydrated);
  assert.equal(hydrated.step, "styles");
  assert.equal(hydrated.furthestUnlockedStep, "styles");
  assert.equal(hydrated.activeStyleDiscoveryRunId, "run_restore_1");
  assert.equal(hydrated.draft.name, "Reload Safe Channel");
  assert.equal(hydrated.draft.stage2WorkerProfileId, "stable_social_wave_v1");
  assert.equal(hydrated.draft.styleProfile?.candidateDirections.length, 20);
  assert.deepEqual(hydrated.draft.selectedStyleDirectionIds, ["direction_2", "direction_4"]);
});

test("persisted style profile editor draft restores selected directions, exploration share and active run", () => {
  const restored = normalizePersistedChannelStyleProfileEditorState(
    {
      activeStyleDiscoveryRunId: "style_run_1",
      draft: {
        referenceLinksText: createReferenceUrls(10).join("\n"),
        styleProfile: createStyleProfile(["direction_1", "direction_3"]),
        selectedStyleDirectionIds: ["direction_1", "direction_3"],
        explorationShare: 0.3
      }
    },
    createStyleProfile(["direction_2"])
  );

  assert.ok(restored);
  assert.equal(restored.activeStyleDiscoveryRunId, "style_run_1");
  assert.equal(restored.draft.explorationShare, 0.3);
  assert.deepEqual(restored.draft.selectedStyleDirectionIds, ["direction_1", "direction_3"]);
});

test("runStage2StyleDiscovery normalizes generated style direction candidates", async () => {
  const rawResult = {
    reference_influence_summary:
      "Повторяющийся сигнал у референсов сухой и процессный, но рядом остаётся место для соседних и более исследовательских ходов.",
    directions: Array.from({ length: 20 }, (_, index) => ({
      id: `generated_${index + 1}`,
      fitBand: index < 8 ? "core" : index < 16 ? "adjacent" : "exploratory",
      name: `Generated direction ${index + 1}`,
      description: `Generated description ${index + 1}`,
      voice: `Voice ${index + 1}`,
      topPattern: `Top pattern ${index + 1}`,
      bottomPattern: `Bottom pattern ${index + 1}`,
      humorLevel: "medium",
      sarcasmLevel: "low",
      warmthLevel: "low",
      insiderDensityLevel: "high",
      bestFor: `Best for ${index + 1}`,
      avoids: `Avoid ${index + 1}`,
      microExample: `Example ${index + 1}`,
      sourceReferenceIds: index < 16 ? [`reference_${(index % 10) + 1}`] : [],
      internalPromptNotes: `Prompt note ${index + 1}`,
      axes: {
        humor: 0.5,
        sarcasm: 0.3,
        warmth: 0.2,
        insiderDensity: 0.7,
        intensity: 0.6,
        explanationDensity: 0.3,
        quoteDensity: 0.2,
        topCompression: 0.8
      }
    }))
  };

  const profile = await runStage2StyleDiscovery({
    executor: new StaticExecutor(rawResult),
    channelName: "Generated Channel",
    username: "generated_channel",
    hardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS,
    referenceLinks: createStyleProfile().referenceLinks
  });

  assert.equal(profile.candidateDirections.length, 20);
  assert.equal(profile.selectedDirectionIds.length, 0);
  assert.match(profile.referenceInfluenceSummary, /сухой и процессный/i);
  assert.ok(profile.candidateDirections.some((direction) => direction.fitBand === "adjacent"));
  assert.ok(profile.candidateDirections.some((direction) => direction.fitBand === "exploratory"));
  assert.ok(
    profile.candidateDirections.some(
      (direction) => direction.fitBand === "exploratory" && direction.sourceReferenceIds.length === 0
    )
  );
});

test("style discovery prompt explicitly asks for breadth instead of hyper-local paraphrases", () => {
  const prompt = buildStage2StyleDiscoveryPrompt({
    channelName: "Breadth Channel",
    username: "breadth_channel",
    hardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS,
    referenceLinks: createStyleProfile([]).referenceLinks
  });

  assert.match(prompt, /8-10 core high-fit directions/i);
  assert.match(prompt, /6-8 adjacent directions/i);
  assert.match(prompt, /3-5 exploratory directions/i);
  assert.match(prompt, /not paraphrasing the same references 20 times/i);
  assert.match(prompt, /do not keep rephrasing the same specific plot beat/i);
  assert.match(prompt, /sourceReferenceIds may be empty for exploratory lanes/i);
});

test("style discovery comment prioritization keeps more than three strong comments and weights liked signal", () => {
  const prioritized = prioritizeStage2StyleDiscoveryComments([
    {
      id: "c1",
      author: "A",
      text: "the side eye is the whole clip",
      likes: 5600,
      timestamp: null,
      postedAt: null
    },
    {
      id: "c2",
      author: "B",
      text: "this feels staged to me",
      likes: 4100,
      timestamp: null,
      postedAt: null
    },
    {
      id: "c3",
      author: "C",
      text: "room knew instantly",
      likes: 3200,
      timestamp: null,
      postedAt: null
    },
    {
      id: "c4",
      author: "D",
      text: "respect for how dry this reaction is",
      likes: 2900,
      timestamp: null,
      postedAt: null
    },
    {
      id: "c5",
      author: "E",
      text: "first",
      likes: 9000,
      timestamp: null,
      postedAt: null
    },
    {
      id: "c6",
      author: "F",
      text: "another insane side eye",
      likes: 2500,
      timestamp: null,
      postedAt: null
    }
  ]);

  assert.ok(prioritized.length > 3);
  assert.ok(prioritized.some((comment) => comment.id === "c1"));
  assert.ok(prioritized.some((comment) => comment.id === "c2" && comment.lane === "suspicion"));
  assert.ok(prioritized.findIndex((comment) => comment.id === "c5") > 1);
});

test("style discovery evidence synthesizes repeated audience patterns across references", () => {
  const evidence = createDiscoveryEvidenceFixture();

  assert.match(evidence.audienceSeed.summary, /side eye/i);
  assert.ok(evidence.audienceSeed.languageCues.some((cue) => cue.includes("side eye")));
  assert.ok(evidence.audienceSeed.tonePreferences.some((tone) => /ирони/i.test(tone)));
  assert.equal(evidence.diagnosticsSeed.referencesWithComments, 2);
});

test("style discovery frame plan samples setup turn and payoff without requiring OCR", () => {
  const framePlan = buildStyleDiscoveryReferenceFramePlan(18);
  const prompt = buildStage2StyleDiscoveryPrompt({
    channelName: "Visual Channel",
    username: "visual_channel",
    hardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS,
    referenceLinks: createStyleProfile([]).referenceLinks.slice(0, 10),
    evidence: createDiscoveryEvidenceFixture()
  });

  assert.deepEqual(
    framePlan.map((frame) => frame.slot),
    ["setup", "turn", "payoff"]
  );
  assert.match(prompt, /imagesManifest maps the attached images/i);
  assert.match(prompt, /OCR is not the primary task/i);
});

test("style discovery passes sampled frames to the executor and compacts a larger hidden pool down to the visible set", async () => {
  const captureExecutor = new CaptureExecutor({
    reference_influence_summary: "Комментарии и реальные кадры показывают сухую, социальную и чуть колкую упаковку.",
    audience_portrait: {
      summary: "Аудитория любит сухую шутку, social reads и короткий язык реакции.",
      rewards: ["social read lands fast"],
      jokes: ["side eye does the job"],
      pushback: ["too polished reactions"],
      suspicion: ["maybe staged"],
      language_cues: ["side eye", "room knew"],
      dominant_posture: "сухая ирония поверх social read",
      tone_preferences: ["сухая ирония", "мемная компрессия"],
      rejects: ["пересказ без редакторского угла"]
    },
    packaging_portrait: {
      summary: "Клипам важны реакция, awkward turn и поздний social payoff.",
      moment_patterns: ["reaction becomes the story", "late group read"],
      visual_triggers: ["side glance", "room reaction"],
      top_mechanics: ["start from the visible reaction"],
      bottom_mechanics: ["land on the social read"],
      framing_modes: ["reaction-first", "awkward-social"]
    },
    bootstrap_confidence: {
      level: "high",
      summary: "Есть достаточно comments и реальных кадров, чтобы уверенно описать вкус аудитории и упаковку.",
      evidence_notes: ["10/10 usable references.", "10/10 references contributed real frames."]
    },
    directions: Array.from({ length: 28 }, (_, index) => ({
      id: `direction_${index + 1}`,
      name: `Направление ${index + 1}`,
      fitBand: index < 11 ? "core" : index < 21 ? "adjacent" : "exploratory",
      description: `Описание ${index + 1}`,
      voice: `Голос ${index + 1}`,
      topPattern: `TOP ${index + 1}`,
      bottomPattern: `BOTTOM ${index + 1}`,
      humorLevel: "medium",
      sarcasmLevel: "low",
      warmthLevel: "medium",
      insiderDensityLevel: "medium",
      bestFor: `Лучше всего ${index + 1}`,
      avoids: `Избегает ${index + 1}`,
      microExample: `Пример ${index + 1}`,
      sourceReferenceIds: index < 21 ? ["reference_1"] : [],
      internalPromptNotes: `Internal ${index + 1}`,
      axes: {
        humor: 0.5,
        sarcasm: 0.4,
        warmth: 0.5,
        insiderDensity: 0.5,
        intensity: 0.55,
        explanationDensity: 0.4,
        quoteDensity: 0.3,
        topCompression: 0.7
      }
    }))
  });
  const evidence = createDiscoveryEvidenceFixture();
  const profile = await runStage2StyleDiscovery({
    executor: captureExecutor,
    channelName: "Visual Bootstrap",
    username: "visual_bootstrap",
    hardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS,
    referenceLinks: createStyleProfile([]).referenceLinks,
    imagePaths: evidence.imagesManifest.map(
      (image, index) => `/tmp/bootstrap-image-${index + 1}-${image.referenceId}.jpg`
    ),
    evidence,
    model: "gpt-test",
    reasoningEffort: "high"
  });

  assert.equal(captureExecutor.imagePaths.length, evidence.imagesManifest.length);
  assert.match(captureExecutor.prompt, /comments are the primary signal for audience taste/i);
  assert.match(captureExecutor.prompt, /real sampled frames are the primary signal/i);
  assert.equal(profile.candidateDirections.length, 20);
  assert.equal(profile.bootstrapDiagnostics?.hiddenCandidatePoolSize, 28);
  assert.equal(profile.bootstrapDiagnostics?.surfacedCandidateCount, 20);
  assert.equal(profile.bootstrapDiagnostics?.imagesUsed, true);
  assert.equal(profile.bootstrapDiagnostics?.model, "gpt-test");
  assert.equal(profile.audiencePortrait?.languageCues[0], "side eye");
  assert.ok(profile.packagingPortrait?.summary.length);
});

test("style discovery stays stable when some references are weak or mixed", async () => {
  const rawResult = {
    reference_influence_summary: "Сигналы смешанные, поэтому adjacent room оставлен шире обычного.",
    audience_portrait: {
      summary: "Comments signal uneven, but recurring jokes and warmth still show up across the usable references.",
      rewards: ["gentle approval"],
      jokes: ["awkward room energy"],
      pushback: [],
      suspicion: [],
      language_cues: ["awkward room"],
      dominant_posture: "мягкое одобрение вперемешку с сухой шуткой",
      tone_preferences: ["тёплое одобрение"],
      rejects: ["слишком жёсткий сарказм"]
    },
    packaging_portrait: {
      summary: "Часть набора визуально сильная, часть почти пустая, поэтому packaging portrait остаётся осторожным.",
      moment_patterns: ["late reveal beat"],
      visual_triggers: ["reaction on the face"],
      top_mechanics: ["start from the cleanest visible trigger"],
      bottom_mechanics: ["stay human and specific"],
      framing_modes: ["reaction-first"]
    },
    bootstrap_confidence: {
      level: "medium",
      summary: "Coverage is mixed, but there is enough usable evidence to propose grounded starting lanes.",
      evidence_notes: ["7/10 usable references.", "4/10 references contributed transcript text."]
    },
    directions: Array.from({ length: 22 }, (_, index) => ({
      name: `Направление ${index + 1}`,
      fitBand: index < 8 ? "core" : index < 16 ? "adjacent" : "exploratory",
      description: `Описание ${index + 1}`,
      voice: `Голос ${index + 1}`,
      topPattern: `TOP ${index + 1}`,
      bottomPattern: `BOTTOM ${index + 1}`,
      humorLevel: "medium",
      sarcasmLevel: "low",
      warmthLevel: "medium",
      insiderDensityLevel: "medium",
      bestFor: `Лучше всего ${index + 1}`,
      avoids: `Избегает ${index + 1}`,
      microExample: `Пример ${index + 1}`,
      sourceReferenceIds: index < 16 ? [`reference_${(index % 5) + 1}`] : [],
      internalPromptNotes: `Internal ${index + 1}`,
      axes: {
        humor: 0.5,
        sarcasm: 0.4,
        warmth: 0.5,
        insiderDensity: 0.5,
        intensity: 0.55,
        explanationDensity: 0.4,
        quoteDensity: 0.3,
        topCompression: 0.7
      }
    }))
  };

  const profile = await runStage2StyleDiscovery({
    executor: new StaticExecutor(rawResult),
    channelName: "Mixed Bootstrap",
    username: "mixed_bootstrap",
    hardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS,
    referenceLinks: normalizeStage2StyleProfile({
      ...createStyleProfile([]),
      referenceLinks: createStyleProfile([]).referenceLinks.map((reference, index) => ({
        ...reference,
        transcriptExcerpt: index < 4 ? reference.transcriptExcerpt : "",
        commentHighlights: index < 7 ? reference.commentHighlights : [],
        totalCommentCount: index < 7 ? reference.totalCommentCount : 0,
        selectedCommentCount: index < 7 ? reference.selectedCommentCount : 0,
        frameMoments: index < 6 ? reference.frameMoments : [],
        framesUsed: index < 6
      }))
    }).referenceLinks,
    evidence: createDiscoveryEvidenceFixture()
  });

  assert.equal(profile.candidateDirections.length, 20);
  assert.equal(profile.bootstrapDiagnostics?.confidence, "medium");
  assert.ok(profile.referenceInfluenceSummary.length > 0);
});

test("style discovery runtime re-queues a running bootstrap analysis after restart-style recovery", { concurrency: false }, async () => {
  await withIsolatedAppData(async () => {
    const teamStore = await import("../lib/team-store");
    const store = await import("../lib/channel-style-discovery-store");
    const runtime = await import("../lib/channel-style-discovery-runtime");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Style Discovery Recovery",
      email: "owner-style-recovery@example.com",
      password: "Password123!",
      displayName: "Owner"
    });

    const run = store.createChannelStyleDiscoveryRun({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      request: {
        channelName: "Recovery Channel",
        username: "recovery_channel",
        hardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS,
        referenceUrls: createReferenceUrls(10)
      }
    });

    const claimed = store.claimNextQueuedChannelStyleDiscoveryRun();
    assert.equal(claimed?.runId, run.runId);
    assert.equal(store.getChannelStyleDiscoveryRun(run.runId)?.status, "running");

    delete (globalThis as { __clipsChannelStyleDiscoveryRuntimeState__?: unknown })
      .__clipsChannelStyleDiscoveryRuntimeState__;

    let recoveredRunningStateObserved = false;
    runtime.setChannelStyleDiscoveryProcessorForTests(async (claimedRun) => {
      const reloaded = store.getChannelStyleDiscoveryRun(claimedRun.runId);
      recoveredRunningStateObserved = reloaded?.status === "running";
      assert.equal(claimedRun.request.referenceUrls.length, 10);
      await sleep(30);
      return createStyleProfile(["direction_1", "direction_5"]);
    });

    try {
      runtime.scheduleChannelStyleDiscoveryProcessing();
      await waitFor(() => store.getChannelStyleDiscoveryRun(run.runId)?.status === "completed");

      assert.equal(recoveredRunningStateObserved, true);

      delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
      const reloaded = store.getChannelStyleDiscoveryRun(run.runId);
      assert.equal(reloaded?.status, "completed");
      assert.deepEqual(reloaded?.result?.selectedDirectionIds, ["direction_1", "direction_5"]);
      assert.equal(reloaded?.request.referenceUrls.length, 10);
    } finally {
      runtime.setChannelStyleDiscoveryProcessorForTests(null);
    }
  });
});

test("style discovery reuses the latest completed run when the fingerprint is unchanged", async () => {
  await withIsolatedAppData(async () => {
    const teamStore = await import("../lib/team-store");
    const store = await import("../lib/channel-style-discovery-store");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Style Discovery Cache",
      email: "owner-style-cache@example.com",
      password: "Password123!",
      displayName: "Owner"
    });

    const request = {
      channelName: "Cache Channel",
      username: "cache_channel",
      hardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS,
      referenceUrls: createReferenceUrls(10)
    };

    const firstRun = store.createChannelStyleDiscoveryRun({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      request
    });

    const claimed = store.claimNextQueuedChannelStyleDiscoveryRun();
    assert.equal(claimed?.runId, firstRun.runId);
    store.finalizeChannelStyleDiscoveryRunSuccess(
      firstRun.runId,
      createStyleProfile(["direction_3", "direction_7"])
    );

    const reusedRun = store.createChannelStyleDiscoveryRun({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      request: {
        channelName: "Cache Channel",
        username: "cache_channel",
        hardConstraints: { ...DEFAULT_STAGE2_HARD_CONSTRAINTS },
        referenceUrls: [...createReferenceUrls(10)].reverse()
      }
    });

    assert.equal(reusedRun.runId, firstRun.runId);
    assert.equal(reusedRun.status, "completed");
    assert.deepEqual(reusedRun.result?.selectedDirectionIds, ["direction_3", "direction_7"]);
    assert.equal(store.claimNextQueuedChannelStyleDiscoveryRun(), null);
  });
});

test("channel bootstrap profile persists and regular channel edits still work afterwards", async () => {
  await withIsolatedAppData(async () => {
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Bootstrap Persistence",
      email: "owner-bootstrap@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const styleProfile = createStyleProfile(["direction_2", "direction_4"]);
    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Bootstrap Channel",
      username: "bootstrap_channel",
      stage2StyleProfile: styleProfile
    });

    const reloaded = await chatHistory.getChannelById(channel.id);
    assert.ok(reloaded);
    assert.deepEqual(reloaded.stage2StyleProfile.selectedDirectionIds, ["direction_2", "direction_4"]);

    const updated = await chatHistory.updateChannelById(channel.id, {
      name: "Bootstrap Channel Updated",
      stage2HardConstraints: {
        ...DEFAULT_STAGE2_HARD_CONSTRAINTS,
        bannedWords: ["generic"]
      }
    });
    assert.equal(updated.name, "Bootstrap Channel Updated");
    assert.equal(updated.stage2StyleProfile.selectedDirectionIds.length, 2);
    assert.deepEqual(updated.stage2HardConstraints.bannedWords, ["generic"]);
  });
});

test("feedback events persist and rolling editorial memory favors recent signals while preserving exploration", async () => {
  await withIsolatedAppData(async () => {
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Feedback Memory",
      email: "owner-feedback@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const styleProfile = createStyleProfile(["direction_1", "direction_2"]);
    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Feedback Channel",
      username: "feedback_channel",
      stage2StyleProfile: styleProfile
    });

    createChannelEditorialFeedbackEvent({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      userId: owner.user.id,
      kind: "more_like_this",
      note: "Keep the process commentary tight.",
      optionSnapshot: {
        candidateId: "cand_1",
        top: "The frame locks onto the exact moment the process flips.",
        bottom: "That's the kind of detail only the people doing the job notice.",
        angle: "tight process read",
        styleDirectionIds: ["direction_1"],
        explorationMode: "aligned"
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 6));
    createChannelEditorialFeedbackEvent({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      userId: owner.user.id,
      kind: "less_like_this",
      note: "Too polished. Pull it away from this lane.",
      optionSnapshot: {
        candidateId: "cand_2",
        top: "The polished version is too clean for this channel.",
        bottom: "It stops sounding like a real person talking.",
        angle: "tight process read",
        styleDirectionIds: ["direction_1"],
        explorationMode: "aligned"
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 6));
    createChannelEditorialFeedbackEvent({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      userId: owner.user.id,
      kind: "more_like_this",
      note: "This warmer lane is the better fit now.",
      optionSnapshot: {
        candidateId: "cand_3",
        top: "The frame makes the payoff feel earned instead of flashy.",
        bottom: "That kind of respect lands better here.",
        angle: "earned respect",
        styleDirectionIds: ["direction_2"],
        explorationMode: "aligned"
      }
    });

    const memory = buildStage2EditorialMemorySummary({
      profile: channel.stage2StyleProfile,
      feedbackEvents: listChannelEditorialFeedbackEvents(channel.id, 30)
    });
    const direction2 = memory.directionScores.find((entry) => entry.id === "direction_2");
    const direction1 = memory.directionScores.find((entry) => entry.id === "direction_1");

    assert.ok(direction2 && direction1);
    assert.ok(direction2.score > direction1.score);
    assert.equal(memory.explorationShare, STAGE2_EDITORIAL_EXPLORATION_SHARE);
    assert.match(memory.promptSummary, /25%/);
    assert.match(memory.promptSummary, /warmer lane is the better fit now/i);
  });
});

test("feedback store exposes explicit rating history separately from passive selections", async () => {
  await withIsolatedAppData(async () => {
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Feedback Store Split",
      email: "owner-feedback-store@example.com",
      password: "Password123!",
      displayName: "Owner"
    });

    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Feedback Split",
      username: "feedback_split",
      stage2StyleProfile: createStyleProfile(["direction_1"])
    });

    createChannelEditorialFeedbackEvent({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      userId: owner.user.id,
      kind: "more_like_this",
      scope: "option",
      note: "Like the option as a whole.",
      optionSnapshot: {
        candidateId: "cand_1",
        optionNumber: 1,
        top: "Top 1",
        bottom: "Bottom 1",
        angle: "angle 1",
        styleDirectionIds: ["direction_1"],
        explorationMode: "aligned"
      }
    });
    createChannelEditorialFeedbackEvent({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      userId: owner.user.id,
      kind: "selected_option",
      scope: "option",
      note: null,
      optionSnapshot: {
        candidateId: "cand_2",
        optionNumber: 2,
        top: "Top 2",
        bottom: "Bottom 2",
        angle: "angle 2",
        styleDirectionIds: ["direction_1"],
        explorationMode: "aligned"
      }
    });

    assert.equal(listChannelEditorialFeedbackEvents(channel.id, 30).length, 2);
    assert.equal(listChannelEditorialRatingEvents(channel.id, 30).length, 1);
    assert.equal(listChannelEditorialPassiveSelectionEvents(channel.id, 12).length, 1);
  });
});

test("hard-rule feedback stays active beyond the rolling last-30 explicit reactions", async () => {
  await withIsolatedAppData(async () => {
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Pinned Hard Rules",
      email: "owner-pinned-hard-rules@example.com",
      password: "Password123!",
      displayName: "Owner"
    });

    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Pinned Rules",
      username: "pinned_rules",
      stage2StyleProfile: createStyleProfile(["direction_1", "direction_2"])
    });

    const hardRule = createChannelEditorialFeedbackEvent({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      userId: owner.user.id,
      kind: "less_like_this",
      scope: "bottom",
      noteMode: "hard_rule",
      note: "Не уходить на метауровень комментариев.",
      optionSnapshot: {
        candidateId: "cand_hard_rule",
        optionNumber: 1,
        top: "Top",
        bottom: "Bottom",
        angle: "grounded lane",
        styleDirectionIds: ["direction_1"],
        explorationMode: "aligned"
      }
    });

    for (let index = 0; index < 35; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      createChannelEditorialFeedbackEvent({
        workspaceId: owner.workspace.id,
        channelId: channel.id,
        userId: owner.user.id,
        kind: index % 2 === 0 ? "more_like_this" : "less_like_this",
        scope: "option",
        noteMode: "soft_preference",
        note: `Soft preference ${index + 1}`,
        optionSnapshot: {
          candidateId: `cand_${index + 1}`,
          optionNumber: index + 2,
          top: `Top ${index + 1}`,
          bottom: `Bottom ${index + 1}`,
          angle: index % 2 === 0 ? "directional lane" : "alternative lane",
          styleDirectionIds: [index % 2 === 0 ? "direction_1" : "direction_2"],
          explorationMode: "aligned"
        }
      });
    }

    const activeRatings = listChannelEditorialRatingEvents(channel.id, 30);
    assert.equal(activeRatings.length, 31);
    assert.equal(activeRatings.some((event) => event.id === hardRule.id), true);

    const memory = buildStage2EditorialMemorySummary({
      profile: channel.stage2StyleProfile,
      feedbackEvents: activeRatings
    });

    assert.equal(memory.activeHardRuleCount, 1);
    assert.match(memory.promptSummary, /Active hard rules/i);
    assert.match(memory.promptSummary, /метауровень комментариев/i);
    assert.equal(memory.hardRuleNotes[0], "Не уходить на метауровень комментариев.");
  });
});

test("same-line-first editorial memory prefers matching worker-profile runs and only blends fallback when the signal is sparse", async () => {
  await withIsolatedAppData(async () => {
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Same Line Memory",
      email: "owner-same-line-memory@example.com",
      password: "Password123!",
      displayName: "Owner"
    });

    const styleProfile = createStyleProfile(["direction_1", "direction_2"]);
    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Same Line Channel",
      username: "same_line_channel",
      stage2StyleProfile: styleProfile
    });

    const socialRun = createStage2Run({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      request: buildStage2RunRequestSnapshot({
        sourceUrl: "https://example.com/social-run",
        userInstruction: null,
        mode: "manual",
        channel: {
          id: channel.id,
          name: channel.name,
          username: channel.username,
          stage2WorkerProfileId: "stable_social_wave_v1",
          stage2ExamplesConfig: channel.stage2ExamplesConfig,
          stage2HardConstraints: channel.stage2HardConstraints,
          stage2StyleProfile: channel.stage2StyleProfile
        }
      })
    });
    const skillRun = createStage2Run({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      request: buildStage2RunRequestSnapshot({
        sourceUrl: "https://example.com/skill-run",
        userInstruction: null,
        mode: "manual",
        channel: {
          id: channel.id,
          name: channel.name,
          username: channel.username,
          stage2WorkerProfileId: "stable_skill_gap_v1",
          stage2ExamplesConfig: channel.stage2ExamplesConfig,
          stage2HardConstraints: channel.stage2HardConstraints,
          stage2StyleProfile: channel.stage2StyleProfile
        }
      })
    });

    const socialEvent = createChannelEditorialFeedbackEvent({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      userId: owner.user.id,
      stage2RunId: socialRun.runId,
      kind: "more_like_this",
      note: "Keep the crowd phrase alive.",
      optionSnapshot: {
        candidateId: "social_cand",
        optionNumber: 1,
        top: "Top",
        bottom: "Bottom",
        angle: "comment-native lane",
        styleDirectionIds: ["direction_1"],
        explorationMode: "aligned"
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const skillEvent = createChannelEditorialFeedbackEvent({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      userId: owner.user.id,
      stage2RunId: skillRun.runId,
      kind: "less_like_this",
      note: "Too process-heavy for this social lane.",
      optionSnapshot: {
        candidateId: "skill_cand",
        optionNumber: 2,
        top: "Top",
        bottom: "Bottom",
        angle: "skill-gap lane",
        styleDirectionIds: ["direction_2"],
        explorationMode: "aligned"
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const runlessEvent = createChannelEditorialFeedbackEvent({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      userId: owner.user.id,
      kind: "more_like_this",
      note: "Runless fallback note should only join the blended pool.",
      optionSnapshot: {
        candidateId: "runless_cand",
        optionNumber: 3,
        top: "Top",
        bottom: "Bottom",
        angle: "fallback lane",
        styleDirectionIds: ["direction_1"],
        explorationMode: "aligned"
      }
    });
    createChannelEditorialFeedbackEvent({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      userId: owner.user.id,
      kind: "less_like_this",
      noteMode: "hard_rule",
      note: "Never smooth the harmless public handle into generic English.",
      optionSnapshot: {
        candidateId: "hard_rule",
        optionNumber: 4,
        top: "Top",
        bottom: "Bottom",
        angle: "handle lane",
        styleDirectionIds: ["direction_1"],
        explorationMode: "aligned"
      }
    });
    createChannelEditorialFeedbackEvent({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      userId: owner.user.id,
      stage2RunId: socialRun.runId,
      kind: "selected_option",
      note: null,
      optionSnapshot: {
        candidateId: "social_selected",
        optionNumber: 5,
        top: "Top",
        bottom: "Bottom",
        angle: "comment-native lane",
        styleDirectionIds: ["direction_1"],
        explorationMode: "aligned"
      }
    });

    const sameLineOnly = resolveChannelEditorialMemory({
      channelId: channel.id,
      stage2StyleProfile: channel.stage2StyleProfile,
      stage2WorkerProfileId: "stable_social_wave_v1",
      sameLineExplicitMinimum: 1
    });
    assert.equal(sameLineOnly.source.strategy, "same_line_only");
    assert.equal(sameLineOnly.source.sameLineExplicitCount, 1);
    assert.equal(
      sameLineOnly.historyEvents.some((event) => event.id === socialEvent.id),
      true
    );
    assert.equal(
      sameLineOnly.historyEvents.some((event) => event.id === skillEvent.id),
      false
    );
    assert.equal(
      sameLineOnly.historyEvents.some((event) => event.id === runlessEvent.id),
      false
    );

    const blended = resolveChannelEditorialMemory({
      channelId: channel.id,
      stage2StyleProfile: channel.stage2StyleProfile,
      stage2WorkerProfileId: "stable_social_wave_v1",
      sameLineExplicitMinimum: 2
    });
    assert.equal(blended.source.strategy, "same_line_plus_channel_fallback");
    assert.equal(blended.source.sameLineExplicitCount, 1);
    assert.equal(blended.source.supplementedWithFallback, true);
    assert.equal(
      blended.historyEvents.some((event) => event.id === socialEvent.id),
      true
    );
    assert.equal(
      blended.historyEvents.some((event) => event.id === runlessEvent.id),
      true
    );
    assert.match(
      blended.editorialMemory.promptSummary,
      /Never smooth the harmless public handle into generic English/i
    );
  });
});

test("experimental reference editorial memory treats same-line hard rules plus passive selections as sufficient signal", async () => {
  await withIsolatedAppData(async () => {
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Experimental Reference Memory",
      email: "owner-experimental-reference-memory@example.com",
      password: "Password123!",
      displayName: "Owner"
    });

    const styleProfile = createStyleProfile(["direction_1", "direction_2"]);
    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Experimental Reference Channel",
      username: "experimental_reference_channel",
      stage2StyleProfile: styleProfile
    });

    const experimentalRun = createStage2Run({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      request: buildStage2RunRequestSnapshot({
        sourceUrl: "https://example.com/reference-experimental-run",
        userInstruction: null,
        mode: "manual",
        channel: {
          id: channel.id,
          name: channel.name,
          username: channel.username,
          stage2WorkerProfileId: "stable_reference_v6_experimental",
          stage2ExamplesConfig: channel.stage2ExamplesConfig,
          stage2HardConstraints: channel.stage2HardConstraints,
          stage2StyleProfile: channel.stage2StyleProfile
        }
      })
    });
    const fallbackRun = createStage2Run({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      request: buildStage2RunRequestSnapshot({
        sourceUrl: "https://example.com/reference-fallback-run",
        userInstruction: null,
        mode: "manual",
        channel: {
          id: channel.id,
          name: channel.name,
          username: channel.username,
          stage2WorkerProfileId: "stable_social_wave_v1",
          stage2ExamplesConfig: channel.stage2ExamplesConfig,
          stage2HardConstraints: channel.stage2HardConstraints,
          stage2StyleProfile: channel.stage2StyleProfile
        }
      })
    });

    createChannelEditorialFeedbackEvent({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      userId: owner.user.id,
      stage2RunId: experimentalRun.runId,
      kind: "less_like_this",
      noteMode: "hard_rule",
      note: "Не уходи в clip/edit/comments meta, сначала контекст происходящего.",
      optionSnapshot: {
        candidateId: "experimental_hard_rule",
        optionNumber: 1,
        top: "Top",
        bottom: "Bottom",
        angle: "context_first_reference",
        styleDirectionIds: ["direction_1"],
        explorationMode: "aligned"
      }
    });
    createChannelEditorialFeedbackEvent({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      userId: owner.user.id,
      stage2RunId: experimentalRun.runId,
      kind: "selected_option",
      note: null,
      optionSnapshot: {
        candidateId: "experimental_selected_1",
        optionNumber: 2,
        top: "Top",
        bottom: "Bottom",
        angle: "context_first_reference",
        styleDirectionIds: ["direction_1"],
        explorationMode: "aligned"
      }
    });
    createChannelEditorialFeedbackEvent({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      userId: owner.user.id,
      stage2RunId: experimentalRun.runId,
      kind: "selected_option",
      note: null,
      optionSnapshot: {
        candidateId: "experimental_selected_2",
        optionNumber: 3,
        top: "Top",
        bottom: "Bottom",
        angle: "human_punchline",
        styleDirectionIds: ["direction_2"],
        explorationMode: "aligned"
      }
    });
    createChannelEditorialFeedbackEvent({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      userId: owner.user.id,
      stage2RunId: fallbackRun.runId,
      kind: "more_like_this",
      note: "Fallback social signal.",
      optionSnapshot: {
        candidateId: "fallback_signal",
        optionNumber: 4,
        top: "Top",
        bottom: "Bottom",
        angle: "comment-native lane",
        styleDirectionIds: ["direction_1"],
        explorationMode: "aligned"
      }
    });

    const resolved = resolveChannelEditorialMemory({
      channelId: channel.id,
      stage2StyleProfile: channel.stage2StyleProfile,
      stage2WorkerProfileId: "stable_reference_v6_experimental"
    });

    assert.equal(resolved.source.strategy, "same_line_only");
    assert.equal(resolved.source.sameLineExplicitCount, 0);
    assert.equal(resolved.source.sameLineSelectionCount, 2);
    assert.equal(resolved.source.supplementedWithFallback, false);
    assert.equal(resolved.source.explicitThreshold, 3);
    assert.equal(resolved.editorialMemory.recentSelectionCount, 2);
    assert.match(
      resolved.editorialMemory.promptSummary,
      /medium-strength same-line signals/i
    );
  });
});

test("explicit feedback events can be deleted and editorial memory recomputes from the remaining signals", async () => {
  await withIsolatedAppData(async () => {
    const teamStore = await import("../lib/team-store");
    const chatHistory = await import("../lib/chat-history");

    const owner = await teamStore.bootstrapOwner({
      workspaceName: "Feedback Delete",
      email: "owner-feedback-delete@example.com",
      password: "Password123!",
      displayName: "Owner"
    });

    const channel = await chatHistory.createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Feedback Delete",
      username: "feedback_delete",
      stage2StyleProfile: createStyleProfile(["direction_1", "direction_2"])
    });

    const deletedEvent = createChannelEditorialFeedbackEvent({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      userId: owner.user.id,
      kind: "more_like_this",
      scope: "top",
      note: "Сохранить старый сухой TOP.",
      optionSnapshot: {
        candidateId: "cand_delete",
        optionNumber: 1,
        top: "Old dry top.",
        bottom: "Old bottom.",
        angle: "old lane",
        styleDirectionIds: ["direction_1"],
        explorationMode: "aligned"
      }
    });
    const survivingEvent = createChannelEditorialFeedbackEvent({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      userId: owner.user.id,
      kind: "less_like_this",
      scope: "bottom",
      note: "BOTTOM нужно сделать суше.",
      optionSnapshot: {
        candidateId: "cand_keep",
        optionNumber: 2,
        top: "Current top.",
        bottom: "Current bottom.",
        angle: "current lane",
        styleDirectionIds: ["direction_2"],
        explorationMode: "aligned"
      }
    });
    createChannelEditorialFeedbackEvent({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      userId: owner.user.id,
      kind: "selected_option",
      scope: "option",
      note: null,
      optionSnapshot: {
        candidateId: "cand_passive",
        optionNumber: 3,
        top: "Passive top.",
        bottom: "Passive bottom.",
        angle: "passive lane",
        styleDirectionIds: ["direction_2"],
        explorationMode: "aligned"
      }
    });

    assert.equal(listChannelEditorialRatingEvents(channel.id, 30).length, 2);
    assert.equal(deleteChannelEditorialFeedbackEvent(channel.id, deletedEvent.id), true);
    assert.equal(deleteChannelEditorialFeedbackEvent(channel.id, "missing_event"), false);

    const ratingEvents = listChannelEditorialRatingEvents(channel.id, 30);
    assert.equal(ratingEvents.length, 1);
    assert.equal(ratingEvents[0]?.id, survivingEvent.id);

    const memory = buildStage2EditorialMemorySummary({
      profile: channel.stage2StyleProfile,
      feedbackEvents: [
        ...ratingEvents,
        ...listChannelEditorialPassiveSelectionEvents(channel.id, 12)
      ]
    });

    assert.equal(memory.recentFeedbackCount, 1);
    assert.equal(memory.recentSelectionCount, 1);
    assert.match(memory.promptSummary, /BOTTOM нужно сделать суше/i);
    assert.doesNotMatch(memory.promptSummary, /старый сухой TOP/i);
  });
});

test("editorial memory keeps only the latest rolling window of reactions", () => {
  const profile = createStyleProfile(["direction_2"]);
  const baseTime = Date.parse("2026-03-21T10:00:00.000Z");
  const feedbackEvents: ChannelEditorialFeedbackEvent[] = Array.from(
    { length: 35 },
    (_, index) => {
      const favorRecentDirection = index >= 5;
      return {
        id: `feedback_${index + 1}`,
        workspaceId: "workspace_1",
        channelId: "channel_1",
        userId: "user_1",
        chatId: null,
        stage2RunId: null,
        kind: "more_like_this",
        scope: "option",
        noteMode: "soft_preference",
        note: null,
        optionSnapshot: {
          candidateId: `candidate_${index + 1}`,
          optionNumber: index + 1,
          top: favorRecentDirection
            ? "Keep the earned-respect framing active."
            : "Old direction that should decay out.",
          bottom: favorRecentDirection
            ? "That calmer respect lane is the current fit."
            : "This older note should stop steering the channel.",
          angle: favorRecentDirection ? "earned respect" : "old lane",
          styleDirectionIds: favorRecentDirection ? ["direction_2"] : ["direction_1"],
          explorationMode: "aligned"
        },
        createdAt: new Date(baseTime + index * 1000).toISOString()
      };
    }
  );

  const memory = buildStage2EditorialMemorySummary({
    profile,
    feedbackEvents,
    windowSize: 30
  });

  assert.equal(memory.recentFeedbackCount, 30);
  assert.equal(memory.recentSelectionCount, 0);
  assert.ok(memory.directionScores.some((entry) => entry.id === "direction_2"));
  assert.ok(!memory.directionScores.some((entry) => entry.id === "direction_1"));
  assert.match(memory.promptSummary, /30%|25%/);
});

test("editorial memory counts only explicit ratings in recentFeedbackCount and keeps passive selections separate", () => {
  const profile = createStyleProfile(["direction_1", "direction_2"]);
  const feedbackEvents: ChannelEditorialFeedbackEvent[] = [
    {
      id: "explicit_top_like",
      workspaceId: "workspace_1",
      channelId: "channel_1",
      userId: "user_1",
      chatId: null,
      stage2RunId: null,
      kind: "more_like_this",
      scope: "top",
      noteMode: "soft_preference",
      note: "Top should stay drier.",
      optionSnapshot: {
        candidateId: "candidate_1",
        optionNumber: 1,
        top: "The top reads like a dry social read.",
        bottom: "The bottom can stay calmer.",
        angle: "dry social read",
        styleDirectionIds: ["direction_1"],
        explorationMode: "aligned"
      },
      createdAt: "2026-03-21T10:00:00.000Z"
    },
    {
      id: "passive_select",
      workspaceId: "workspace_1",
      channelId: "channel_1",
      userId: "user_1",
      chatId: null,
      stage2RunId: null,
      kind: "selected_option",
      scope: "option",
      noteMode: "soft_preference",
      note: null,
      optionSnapshot: {
        candidateId: "candidate_2",
        optionNumber: 2,
        top: "A warmer opening lands better.",
        bottom: "The calmer close should stay.",
        angle: "warmer lane",
        styleDirectionIds: ["direction_2"],
        explorationMode: "aligned"
      },
      createdAt: "2026-03-21T10:01:00.000Z"
    }
  ];

  const memory = buildStage2EditorialMemorySummary({
    profile,
    feedbackEvents
  });

  assert.equal(memory.recentFeedbackCount, 1);
  assert.equal(memory.recentSelectionCount, 1);
  assert.match(memory.promptSummary, /No recent explicit editor ratings yet|Passive option selections lately|Top should stay drier/i);
  assert.match(memory.promptSummary, /Passive option selections lately/i);
});

test("Stage 2 run snapshots and prompt packets include bootstrap style profile plus editorial memory", () => {
  const styleProfile = createStyleProfile(["direction_1", "direction_2"]);
  const editorialMemory = buildStage2EditorialMemorySummary({
    profile: styleProfile,
    feedbackEvents: []
  });
  const editorialMemorySource = {
    strategy: "same_line_only" as const,
    requestedWorkerProfileId: "stable_reference_v6",
    resolvedWorkerProfileId: "stable_reference_v6" as const,
    sameLineExplicitCount: 2,
    fallbackExplicitCount: 0,
    sameLineSelectionCount: 1,
    fallbackSelectionCount: 0,
    supplementedWithFallback: false,
    explicitThreshold: 2
  };

  const request = buildStage2RunRequestSnapshot({
    sourceUrl: "https://www.youtube.com/shorts/with-memory",
    userInstruction: "keep it dry",
    mode: "manual",
    channel: {
      id: "channel_1",
      name: "Channel 1",
      username: "channel_1",
      stage2ExamplesConfig: {
        version: 1,
        useWorkspaceDefault: true,
        customExamples: []
      },
      stage2HardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS,
      stage2StyleProfile: styleProfile,
      editorialMemory,
      editorialMemorySource
    }
  });

  assert.deepEqual(request.channel.stage2StyleProfile?.selectedDirectionIds, [
    "direction_1",
    "direction_2"
  ]);
  assert.match(request.channel.editorialMemory?.promptSummary ?? "", /Bootstrap directions/);
  assert.equal(request.channel.editorialMemorySource?.strategy, "same_line_only");
  assert.equal(request.channel.editorialMemorySource?.resolvedWorkerProfileId, "stable_reference_v6");

  const workerService = new ViralShortsWorkerService();
  const promptPacket = workerService.buildPromptPacket({
    channel: {
      id: "channel_1",
      name: "Channel 1",
      username: "channel_1",
      stage2ExamplesConfig: {
        version: 1,
        useWorkspaceDefault: true,
        customExamples: []
      },
      stage2HardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS,
      stage2StyleProfile: styleProfile,
      editorialMemory
    },
    workspaceStage2ExamplesCorpusJson: "[]",
    videoContext: {
      sourceUrl: "https://www.youtube.com/shorts/with-memory",
      title: "A process-heavy clip",
      description: "Description",
      transcript: "Transcript",
      frameDescriptions: ["Frame one", "Frame two"],
      comments: [],
      userInstruction: "keep it dry"
    }
  });

  assert.match(promptPacket.prompts.writer, /channelLearning/);
  assert.match(promptPacket.prompts.writer, /Bootstrap directions/);
  assert.match(promptPacket.prompts.writer, /TOP tends to work when it/i);
});

test("prompt packets keep literal historical text cues out of channel-learning runtime context", () => {
  const styleProfile = createStyleProfile(["direction_1", "direction_2"]);
  const editorialMemory = {
    ...buildStage2EditorialMemorySummary({
      profile: styleProfile,
      feedbackEvents: []
    }),
    preferredTextCues: [
      "That slow little spectator shuffle says everything.",
      "This isn't a clean demo anymore."
    ],
    discouragedTextCues: ["What starts like a normal military driving pass turns into"]
  };

  const workerService = new ViralShortsWorkerService();
  const promptPacket = workerService.buildPromptPacket({
    channel: {
      id: "channel_1",
      name: "Channel 1",
      username: "channel_1",
      stage2ExamplesConfig: {
        version: 1,
        useWorkspaceDefault: true,
        customExamples: []
      },
      stage2HardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS,
      stage2StyleProfile: styleProfile,
      editorialMemory
    },
    workspaceStage2ExamplesCorpusJson: "[]",
    videoContext: {
      sourceUrl: "https://www.youtube.com/shorts/no-literal-cues",
      title: "A different clip family entirely",
      description: "Description",
      transcript: "Transcript",
      frameDescriptions: ["Frame one", "Frame two"],
      comments: [],
      userInstruction: null
    }
  });

  assert.match(promptPacket.prompts.writer, /channelLearning/);
  assert.doesNotMatch(promptPacket.prompts.writer, /spectator shuffle says everything/i);
  assert.doesNotMatch(promptPacket.prompts.writer, /This isn't a clean demo anymore/i);
  assert.doesNotMatch(promptPacket.prompts.writer, /normal military driving pass/i);
});

test("editorial memory wording keeps bootstrap prior distinct from recent feedback when no feedback exists", () => {
  const styleProfile = createStyleProfile(
    Array.from({ length: 20 }, (_, index) => `direction_${index + 1}`)
  );
  const memory = buildStage2EditorialMemorySummary({
    profile: styleProfile,
    feedbackEvents: []
  });

  assert.equal(memory.recentFeedbackCount, 0);
  assert.equal(memory.recentSelectionCount, 0);
  assert.match(memory.promptSummary, /Bootstrap directions/);
  assert.match(memory.promptSummary, /No recent explicit editor ratings yet/i);
  assert.doesNotMatch(memory.promptSummary, /Recent positive pull/i);
});

test("prompt packets compact large selected-direction sets into weighted highlights without removing channel learning", () => {
  const selectedDirectionIds = Array.from({ length: 20 }, (_, index) => `direction_${index + 1}`);
  const verboseBaseProfile = createStyleProfile(selectedDirectionIds);
  const verboseProfile = normalizeStage2StyleProfile({
    ...verboseBaseProfile,
    referenceInfluenceSummary:
      "Тёплая поп-культурная awkward-химия и наблюдение за микрореакциями. ".repeat(40),
    candidateDirections: verboseBaseProfile.candidateDirections.map((direction, index) => ({
      ...direction,
      description: `Подробное описание направления ${index + 1}. `.repeat(30),
      voice: `Голос направления ${index + 1}, мягкий и наблюдательный. `.repeat(12),
      topPattern: `TOP-паттерн ${index + 1}: быстро назвать момент и поймать его нерв. `.repeat(12),
      bottomPattern: `BOTTOM-паттерн ${index + 1}: коротко дожать считывание жеста. `.repeat(12),
      bestFor: `Лучше всего работает на awkward-поп-моментах ${index + 1}. `.repeat(12),
      avoids: `Избегает тяжёлого осуждения и длинного лора ${index + 1}. `.repeat(12),
      microExample: `Пример ${index + 1}: он всё понял по одному взгляду. `.repeat(10),
      internalPromptNotes: `Внутренняя заметка ${index + 1}. `.repeat(20)
    }))
  });
  const editorialMemory = buildStage2EditorialMemorySummary({
    profile: verboseProfile,
    feedbackEvents: []
  });

  const workerService = new ViralShortsWorkerService();
  const promptPacket = workerService.buildPromptPacket({
    channel: {
      id: "channel_1",
      name: "Channel 1",
      username: "channel_1",
      stage2ExamplesConfig: {
        version: 1,
        useWorkspaceDefault: true,
        customExamples: []
      },
      stage2HardConstraints: DEFAULT_STAGE2_HARD_CONSTRAINTS,
      stage2StyleProfile: verboseProfile,
      editorialMemory
    },
    workspaceStage2ExamplesCorpusJson: "[]",
    videoContext: {
      sourceUrl: "https://www.youtube.com/shorts/with-many-directions",
      title: "A dense pop-culture reaction clip",
      description: "Description",
      transcript: "Transcript",
      frameDescriptions: ["Frame one", "Frame two"],
      comments: [],
      userInstruction: "keep it dry"
    }
  });

  assert.match(promptPacket.prompts.writer, /"selectedDirectionCount": 20/);
  assert.match(promptPacket.prompts.writer, /"directionHighlights": \[/);
  assert.match(promptPacket.prompts.writer, /weighted highlights/i);
  assert.doesNotMatch(promptPacket.prompts.writer, /"selectedDirections": \[/);
  assert.doesNotMatch(promptPacket.prompts.writer, /"internalPromptNotes":/);
  assert.ok(promptPacket.prompts.writer.length < 25000);
  assert.ok(promptPacket.prompts.analyzer.length < 18000);
});

test("Step2PickCaption renders Russian feedback controls for lighter editorial learning", () => {
  const stage2: Stage2Response = {
    source: {
      url: "https://www.youtube.com/shorts/feedback-ui",
      title: "Feedback UI",
      totalComments: 0,
      topComments: [],
      allComments: [],
      commentsUsedForPrompt: 0
    },
    output: {
      inputAnalysis: {
        visualAnchors: ["Anchor"],
        commentVibe: "Dry",
        keyPhraseToAdapt: "Anchor"
      },
      captionOptions: [
        {
          option: 1,
          candidateId: "cand_1",
          angle: "tight process read",
          top: "The frame locks onto the exact process change.",
          bottom: "That is the detail the crowd would miss.",
          topRu: "В кадре видно точный перелом процесса.",
          bottomRu: "Вот ту самую деталь толпа бы и пропустила.",
          styleDirectionIds: ["direction_1"],
          explorationMode: "aligned"
        }
      ],
      titleOptions: [
        {
          option: 1,
          title: "HOW DOES THIS PROCESS FLIP",
          titleRu: "КАК ЭТОТ ПРОЦЕСС ПЕРЕВОРАЧИВАЕТСЯ"
        }
      ],
      finalPick: {
        option: 1,
        reason: "Option 1 is strongest."
      }
    },
    warnings: [],
    channel: {
      id: "channel_1",
      name: "Feedback UI",
      username: "feedback_ui"
    },
    stage2Run: {
      runId: "run_1",
      mode: "manual",
      createdAt: "2026-03-21T10:00:00.000Z"
    }
  };

  const markup = renderToStaticMarkup(
    React.createElement(Step2PickCaption, {
      channelName: "Feedback UI",
      channelUsername: "feedback_ui",
      stage2,
      progress: null,
      stageCreatedAt: "2026-03-21T10:00:00.000Z",
      instruction: "",
      runs: [],
      selectedRunId: null,
      currentRunStatus: "completed",
      currentRunError: null,
      canRunStage2: true,
      canQuickRegenerate: true,
      canSubmitFeedback: true,
      feedbackHistory: [
        {
          id: "feedback_1",
          workspaceId: "workspace_1",
          channelId: "channel_1",
          userId: "user_1",
          chatId: null,
          stage2RunId: "run_1",
          kind: "more_like_this",
          scope: "top",
          noteMode: "hard_rule",
          note: "Оставить этот сухой TOP.",
          optionSnapshot: {
            candidateId: "cand_1",
            optionNumber: 1,
            top: "The frame locks onto the exact process change.",
            bottom: "That is the detail the crowd would miss.",
            angle: "tight process read",
            styleDirectionIds: ["direction_1"],
            explorationMode: "aligned"
          },
          createdAt: "2026-03-21T10:05:00.000Z"
        }
      ],
      feedbackHistoryLoading: false,
      isLaunching: false,
      isRunning: false,
      expectedDurationMs: 1000,
      elapsedMs: 500,
      selectedOption: 1,
      selectedTitleOption: 1,
      onInstructionChange: () => undefined,
      onQuickRegenerate: () => undefined,
      onRunStage2: () => undefined,
      onSelectRun: () => undefined,
      onSelectOption: () => undefined,
      onSelectTitleOption: () => undefined,
      onSubmitOptionFeedback: async () => undefined,
      onDeleteFeedbackEvent: async () => undefined,
      deletingFeedbackEventId: null,
      onCopy: () => undefined
    })
  );

  assert.match(markup, /Лайкнуть вариант 1/);
  assert.match(markup, /Дизлайкнуть TOP варианта 1/);
  assert.match(markup, /Новые реакции: 1 реакция/);
  assert.match(markup, /Новые редакторские сигналы с последнего запуска: 1 реакция \(1 👍 \/ 0 👎\)/);
  assert.match(markup, /Последние реакции канала/);
  assert.match(markup, /Режим: Hard rule/);
  assert.match(markup, /Оставить этот сухой TOP/);
  assert.match(markup, /Удалить реакцию feedback_1/);
});
