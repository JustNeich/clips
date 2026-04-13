import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildCustomPublicationCandidateFromLocalDateTime,
  buildChannelPublicationMetadata,
  buildPublicationSlotCandidateFromDateAndIndex,
  normalizeChannelPublishSettings,
  pickNextPublicationSlot,
  type PublicationSlotCandidate,
  DEFAULT_CHANNEL_PUBLISH_SETTINGS
} from "../lib/channel-publishing";
import type { ChannelPublication, Stage2Response } from "../app/components/types";
import { createChannel } from "../lib/chat-history";
import { getChannelPublishSettings, upsertChannelPublishSettings } from "../lib/publication-store";
import { bootstrapOwner } from "../lib/team-store";

async function withIsolatedAppData<T>(run: () => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-channel-publishing-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appDataDir;
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
    await rm(appDataDir, { recursive: true, force: true });
  }
}

function publicationStub(
  slotDate: string,
  slotIndex: number,
  overrides?: Partial<Pick<ChannelPublication, "status" | "scheduledAt" | "canceledAt">>
): Pick<ChannelPublication, "slotDate" | "slotIndex" | "status" | "scheduledAt" | "canceledAt"> {
  return {
    slotDate,
    slotIndex,
    status: overrides?.status ?? "queued",
    scheduledAt: overrides?.scheduledAt ?? new Date(`${slotDate}T18:00:00.000Z`).toISOString(),
    canceledAt: overrides?.canceledAt ?? null
  };
}

function makeStage2Result(overrides?: Partial<Stage2Response>): Stage2Response {
  return {
    source: {
      url: "https://example.com/video",
      title: "Source title",
      totalComments: 0,
      topComments: [],
      allComments: [],
      commentsUsedForPrompt: 0
    },
    output: {
      inputAnalysis: {
        visualAnchors: [],
        commentVibe: "",
        keyPhraseToAdapt: ""
      },
      captionOptions: [],
      titleOptions: [{ option: 1, title: "Stage2 title" }],
      finalPick: {
        option: 1,
        reason: "best"
      }
    },
    seo: {
      description: "SEO description",
      tags: "alpha, beta, gamma"
    },
    warnings: [],
    ...overrides
  };
}

test("pickNextPublicationSlot uses today's earliest future Moscow slot", () => {
  const slot = pickNextPublicationSlot({
    settings: DEFAULT_CHANNEL_PUBLISH_SETTINGS,
    existingPublications: [],
    now: new Date("2026-03-25T17:40:00.000Z")
  });

  assert.equal(slot.slotDate, "2026-03-25");
  assert.equal(slot.slotIndex, 0);
  assert.equal(slot.scheduledAt, "2026-03-25T18:00:00.000Z");
  assert.equal(slot.uploadReadyAt, "2026-03-25T16:00:00.000Z");
});

test("pickNextPublicationSlot spills to tomorrow when today's slots are occupied", () => {
  const occupied = [0, 1, 2, 3].map((slotIndex) => publicationStub("2026-03-25", slotIndex));
  const slot = pickNextPublicationSlot({
    settings: DEFAULT_CHANNEL_PUBLISH_SETTINGS,
    existingPublications: occupied,
    now: new Date("2026-03-25T16:00:00.000Z")
  });

  assert.equal(slot.slotDate, "2026-03-26");
  assert.equal(slot.slotIndex, 0);
  assert.equal(slot.scheduledAt, "2026-03-26T18:00:00.000Z");
});

test("pickNextPublicationSlot skips past slots and selects the next free one today", () => {
  const slot = pickNextPublicationSlot({
    settings: DEFAULT_CHANNEL_PUBLISH_SETTINGS,
    existingPublications: [publicationStub("2026-03-25", 1)],
    now: new Date("2026-03-25T18:07:00.000Z")
  });

  assert.equal(slot.slotDate, "2026-03-25");
  assert.equal(slot.slotIndex, 2);
  assert.equal(slot.scheduledAt, "2026-03-25T18:30:00.000Z");
});

test("pickNextPublicationSlot skips a slot whose exact time is already occupied by a custom publication", () => {
  const slot = pickNextPublicationSlot({
    settings: DEFAULT_CHANNEL_PUBLISH_SETTINGS,
    existingPublications: [
      publicationStub("2026-03-25", -1, {
        scheduledAt: "2026-03-25T18:00:00.000Z"
      })
    ],
    now: new Date("2026-03-25T17:40:00.000Z")
  });

  assert.equal(slot.slotDate, "2026-03-25");
  assert.equal(slot.slotIndex, 1);
  assert.equal(slot.scheduledAt, "2026-03-25T18:15:00.000Z");
});

test("buildPublicationSlotCandidateFromDateAndIndex preserves stable slot mapping", () => {
  const slot: PublicationSlotCandidate = buildPublicationSlotCandidateFromDateAndIndex({
    settings: DEFAULT_CHANNEL_PUBLISH_SETTINGS,
    slotDate: "2026-03-27",
    slotIndex: 3
  });

  assert.equal(slot.slotDate, "2026-03-27");
  assert.equal(slot.slotIndex, 3);
  assert.equal(slot.scheduledAt, "2026-03-27T18:45:00.000Z");
  assert.equal(slot.uploadReadyAt, "2026-03-27T16:45:00.000Z");
});

test("buildCustomPublicationCandidateFromLocalDateTime keeps custom mode and channel-local date", () => {
  const slot = buildCustomPublicationCandidateFromLocalDateTime({
    settings: DEFAULT_CHANNEL_PUBLISH_SETTINGS,
    localDateTime: "2026-03-27T21:07"
  });

  assert.equal(slot.scheduleMode, "custom");
  assert.equal(slot.slotDate, "2026-03-27");
  assert.equal(slot.slotIndex, -1);
  assert.equal(slot.scheduledAt, "2026-03-27T18:07:00.000Z");
  assert.equal(slot.uploadReadyAt, "2026-03-27T16:07:00.000Z");
});

test("buildChannelPublicationMetadata prefers render title and stage2 SEO fields", () => {
  const metadata = buildChannelPublicationMetadata({
    renderTitle: "Render title",
    chatTitle: "Chat title",
    stage2Result: makeStage2Result()
  });

  assert.deepEqual(metadata, {
    title: "Render title",
    description: "SEO description",
    tags: ["alpha", "beta", "gamma"],
    needsReview: false
  });
});

test("buildChannelPublicationMetadata falls back when SEO is missing", () => {
  const metadata = buildChannelPublicationMetadata({
    renderTitle: null,
    chatTitle: "Fallback chat title",
    stage2Result: makeStage2Result({
      output: {
        inputAnalysis: {
          visualAnchors: [],
          commentVibe: "",
          keyPhraseToAdapt: ""
        },
        captionOptions: [],
        titleOptions: [{ option: 1, title: "Stage2 fallback title" }],
        finalPick: {
          option: 1,
          reason: "best"
        }
      },
      seo: null
    })
  });

  assert.equal(metadata.title, "Stage2 fallback title");
  assert.equal(
    metadata.description,
    "Stage2 fallback title"
  );
  assert.deepEqual(metadata.tags, ["stage2", "fallback", "title"]);
  assert.equal(metadata.needsReview, true);
});

test("buildChannelPublicationMetadata derives publish-time metadata from the winner caption when SEO is absent", () => {
  const metadata = buildChannelPublicationMetadata({
    renderTitle: null,
    chatTitle: "Fallback chat title",
    stage2Result: makeStage2Result({
      output: {
        inputAnalysis: {
          visualAnchors: [],
          commentVibe: "",
          keyPhraseToAdapt: ""
        },
        captionOptions: [
          {
            option: 1,
            candidateId: "cand_1",
            angle: "awkward_pause",
            top: "That pause told the whole room what was happening.",
            bottom: "Nobody needed the follow-up once that look landed."
          }
        ],
        finalists: [
          {
            option: 1,
            candidateId: "cand_1",
            laneId: "balanced_clean",
            angle: "awkward_pause",
            top: "That pause told the whole room what was happening.",
            bottom: "Nobody needed the follow-up once that look landed.",
            displayTier: "finalist",
            sourceStage: "qualityCourt",
            displayReason: "Won the editorial court.",
            retainedHandle: false,
            preservedHandle: false,
            constraintCheck: {
              passed: true,
              repaired: false,
              topLength: 48,
              bottomLength: 51,
              issues: []
            }
          }
        ],
        titleOptions: [{ option: 1, title: "Stage2 fallback title" }],
        finalPick: {
          option: 1,
          reason: "best"
        },
        winner: {
          candidateId: "cand_1",
          option: 1,
          reason: "best",
          displayTier: "finalist",
          sourceStage: "qualityCourt"
        }
      },
      seo: null
    })
  });

  assert.equal(
    metadata.description,
    [
      "Stage2 fallback title",
      "TOP: That pause told the whole room what was happening.",
      "BOTTOM: Nobody needed the follow-up once that look landed."
    ].join("\n")
  );
  assert.deepEqual(metadata.tags.slice(0, 6), [
    "stage2",
    "fallback",
    "title",
    "pause",
    "told",
    "whole"
  ]);
  assert.equal(metadata.needsReview, true);
});

test("buildChannelPublicationMetadata refuses to use an invalid winner caption as the SEO fallback", () => {
  const metadata = buildChannelPublicationMetadata({
    renderTitle: null,
    chatTitle: "Fallback chat title",
    stage2Result: makeStage2Result({
      output: {
        inputAnalysis: {
          visualAnchors: [],
          commentVibe: "",
          keyPhraseToAdapt: ""
        },
        captionOptions: [
          {
            option: 1,
            candidateId: "cand_1",
            angle: "awkward_pause",
            top: "That pause told the whole room what was happening.",
            bottom:
              "Nobody needed the follow-up once that look landed and the caption keeps going far past the allowed bottom length window for this channel.",
            constraintCheck: {
              passed: false,
              repaired: false,
              topLength: 48,
              bottomLength: 132,
              issues: ["BOTTOM length is 132, expected 140-150."]
            }
          }
        ],
        finalists: [
          {
            option: 1,
            candidateId: "cand_1",
            laneId: "balanced_clean",
            angle: "awkward_pause",
            top: "That pause told the whole room what was happening.",
            bottom:
              "Nobody needed the follow-up once that look landed and the caption keeps going far past the allowed bottom length window for this channel.",
            displayTier: "finalist",
            sourceStage: "qualityCourt",
            displayReason: "Won the editorial court.",
            retainedHandle: false,
            preservedHandle: false,
            constraintCheck: {
              passed: false,
              repaired: false,
              topLength: 48,
              bottomLength: 132,
              issues: ["BOTTOM length is 132, expected 140-150."]
            }
          }
        ],
        titleOptions: [{ option: 1, title: "Stage2 fallback title" }],
        finalPick: {
          option: 1,
          reason: "best"
        },
        winner: {
          candidateId: "cand_1",
          option: 1,
          reason: "best",
          displayTier: "finalist",
          sourceStage: "qualityCourt",
          constraintCheck: {
            passed: false,
            repaired: false,
            topLength: 48,
            bottomLength: 132,
            issues: ["BOTTOM length is 132, expected 140-150."]
          }
        }
      },
      seo: null
    })
  });

  assert.equal(metadata.description, "Stage2 fallback title");
  assert.deepEqual(metadata.tags, ["stage2", "fallback", "title"]);
  assert.equal(metadata.needsReview, true);
});

test("normalizeChannelPublishSettings preserves notifySubscribersByDefault overrides", () => {
  const settings = normalizeChannelPublishSettings({
    notifySubscribersByDefault: false
  });

  assert.equal(settings.notifySubscribersByDefault, false);
  assert.equal(settings.autoQueueEnabled, DEFAULT_CHANNEL_PUBLISH_SETTINGS.autoQueueEnabled);
});

test("channel publication defaults keep subscriber notifications disabled until the operator opts in", () => {
  assert.equal(DEFAULT_CHANNEL_PUBLISH_SETTINGS.notifySubscribersByDefault, false);
  assert.equal(normalizeChannelPublishSettings({}).notifySubscribersByDefault, false);
});

test("database migration resets legacy channel notify-subscribers defaults to off", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Publishing Defaults Workspace",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const channel = await createChannel({
      workspaceId: owner.workspace.id,
      creatorUserId: owner.user.id,
      name: "Publishing Channel",
      username: "publishing_channel"
    });

    upsertChannelPublishSettings({
      workspaceId: owner.workspace.id,
      channelId: channel.id,
      userId: owner.user.id,
      patch: {
        notifySubscribersByDefault: true
      }
    });
    assert.equal(getChannelPublishSettings(channel.id).notifySubscribersByDefault, true);

    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;

    assert.equal(getChannelPublishSettings(channel.id).notifySubscribersByDefault, false);
  });
});
