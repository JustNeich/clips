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
  buildChannelOnboardingCreatePayload,
  canNavigateChannelOnboardingStep,
  canSubmitChannelOnboardingDraft,
  canContinueChannelOnboardingStep,
  createChannelOnboardingDraft,
  getChannelOnboardingProgressStepState,
  getChannelOnboardingStyleDiscoveryStatus,
  normalizePersistedChannelOnboardingState,
  parseChannelOnboardingCustomExamples,
  parseChannelOnboardingReferenceLinks,
  selectAllChannelOnboardingStyleDirections,
  toggleChannelOnboardingStyleDirectionSelection,
  updateChannelOnboardingReferenceLinks
} from "../app/components/channel-onboarding-support";
import type { Stage2Response } from "../app/components/types";
import {
  createChannelEditorialFeedbackEvent,
  listChannelEditorialFeedbackEvents
} from "../lib/channel-editorial-feedback-store";
import {
  type ChannelEditorialFeedbackEvent,
  buildStage2EditorialMemorySummary,
  normalizeStage2StyleProfile,
  STAGE2_EDITORIAL_EXPLORATION_SHARE,
  type Stage2StyleProfile
} from "../lib/stage2-channel-learning";
import {
  DEFAULT_STAGE2_HARD_CONSTRAINTS,
  type Stage2HardConstraints
} from "../lib/stage2-channel-config";
import { buildStage2RunRequestSnapshot } from "../lib/stage2-run-request";
import {
  buildStage2StyleDiscoveryPrompt,
  runStage2StyleDiscovery
} from "../lib/stage2-style-discovery";
import type { JsonStageExecutor } from "../lib/viral-shorts-worker/executor";
import { ViralShortsWorkerService } from "../lib/viral-shorts-worker/service";

class StaticExecutor implements JsonStageExecutor {
  constructor(private readonly response: unknown) {}

  async runJson<T>(): Promise<T> {
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
    explorationShare: STAGE2_EDITORIAL_EXPLORATION_SHARE,
    referenceLinks: createReferenceUrls(10).map((url, index) => ({
      id: `reference_${index + 1}`,
      url,
      normalizedUrl: url,
      title: `Reference ${index + 1}`,
      description: `Description ${index + 1}`,
      transcriptExcerpt: `Transcript ${index + 1}`,
      commentHighlights: [`Comment ${index + 1}`],
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
  assert.equal(canContinueChannelOnboardingStep("identity", draft), false);

  draft.name = "Dry Process Channel";
  draft.username = "dry_process_channel";
  assert.equal(canContinueChannelOnboardingStep("identity", draft), true);

  draft.useWorkspaceExamples = false;
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
  assert.equal(canContinueChannelOnboardingStep("styles", draft), true);

  const payload = buildChannelOnboardingCreatePayload(draft);
  assert.equal(payload.name, "Dry Process Channel");
  assert.equal(payload.username, "dry_process_channel");
  assert.equal(payload.referenceUrls.length, 10);
  assert.equal(payload.stage2ExamplesConfig.useWorkspaceDefault, false);
  assert.deepEqual(payload.stage2StyleProfile.selectedDirectionIds, ["direction_1", "direction_3"]);
  assert.ok(payload.stage2StyleProfile.onboardingCompletedAt);
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
  assert.equal(hydrated.draft.styleProfile?.candidateDirections.length, 20);
  assert.deepEqual(hydrated.draft.selectedStyleDirectionIds, ["direction_2", "direction_4"]);
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
        note: null,
        optionSnapshot: {
          candidateId: `candidate_${index + 1}`,
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
  assert.ok(memory.directionScores.some((entry) => entry.id === "direction_2"));
  assert.ok(!memory.directionScores.some((entry) => entry.id === "direction_1"));
  assert.match(memory.promptSummary, /30%|25%/);
});

test("Stage 2 run snapshots and prompt packets include bootstrap style profile plus editorial memory", () => {
  const styleProfile = createStyleProfile(["direction_1", "direction_2"]);
  const editorialMemory = buildStage2EditorialMemorySummary({
    profile: styleProfile,
    feedbackEvents: []
  });

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
      editorialMemory
    }
  });

  assert.deepEqual(request.channel.stage2StyleProfile?.selectedDirectionIds, [
    "direction_1",
    "direction_2"
  ]);
  assert.match(request.channel.editorialMemory?.promptSummary ?? "", /Bootstrap directions/);

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

test("editorial memory wording keeps bootstrap prior distinct from recent feedback when no feedback exists", () => {
  const styleProfile = createStyleProfile(
    Array.from({ length: 20 }, (_, index) => `direction_${index + 1}`)
  );
  const memory = buildStage2EditorialMemorySummary({
    profile: styleProfile,
    feedbackEvents: []
  });

  assert.equal(memory.recentFeedbackCount, 0);
  assert.match(memory.promptSummary, /Bootstrap directions/);
  assert.match(memory.promptSummary, /No recent editor feedback yet/i);
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
      onCopy: () => undefined
    })
  );

  assert.match(markup, /Больше в эту сторону/);
  assert.match(markup, /Меньше в эту сторону/);
});
