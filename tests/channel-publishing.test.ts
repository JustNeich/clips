import assert from "node:assert/strict";
import test from "node:test";

import {
  buildChannelPublicationMetadata,
  buildPublicationSlotCandidateFromDateAndIndex,
  pickNextPublicationSlot,
  type PublicationSlotCandidate,
  DEFAULT_CHANNEL_PUBLISH_SETTINGS
} from "../lib/channel-publishing";
import type { ChannelPublication, Stage2Response } from "../app/components/types";

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

  assert.deepEqual(metadata, {
    title: "Stage2 fallback title",
    description: "",
    tags: [],
    needsReview: true
  });
});
