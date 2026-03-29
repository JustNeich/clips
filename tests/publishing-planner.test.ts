import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPublicationDayGroups,
  getPublicationDisplayDayKey,
  getPublicationDisplaySlotIndex,
  isPublicationSlotSynchronized
} from "../app/components/PublishingPlanner";
import type { ChannelPublication } from "../app/components/types";

function makePublication(
  id: string,
  overrides?: Partial<ChannelPublication>
): ChannelPublication {
  return {
    id,
    workspaceId: "workspace",
    channelId: "channel",
    chatId: `chat-${id}`,
    renderExportId: `render-${id}`,
    status: "queued",
    scheduleMode: "slot",
    scheduledAt: "2026-03-29T19:30:00.000Z",
    uploadReadyAt: "2026-03-29T17:30:00.000Z",
    slotDate: "2026-03-29",
    slotIndex: 2,
    title: `Title ${id}`,
    description: "",
    tags: [],
    notifySubscribers: true,
    needsReview: false,
    titleManual: false,
    descriptionManual: false,
    tagsManual: false,
    scheduleManual: false,
    youtubeVideoId: null,
    youtubeVideoUrl: null,
    publishedAt: null,
    canceledAt: null,
    lastError: null,
    renderFileName: "render.mp4",
    sourceUrl: "https://example.com/source",
    chatTitle: `Chat ${id}`,
    createdAt: "2026-03-28T12:00:00.000Z",
    updatedAt: "2026-03-28T12:00:00.000Z",
    events: [],
    ...overrides
  };
}

test("planner groups publications by scheduledAt local day instead of stale slotDate", () => {
  const timeZone = "Europe/Moscow";
  const stalePublication = makePublication("stale-day", {
    scheduledAt: "2026-03-28T19:30:00.000Z",
    uploadReadyAt: "2026-03-28T17:30:00.000Z",
    slotDate: "2026-03-29",
    slotIndex: 2,
    status: "published"
  });
  const todayPublication = makePublication("today", {
    scheduledAt: "2026-03-29T19:00:00.000Z",
    uploadReadyAt: "2026-03-29T17:00:00.000Z",
    slotDate: "2026-03-29",
    slotIndex: 0
  });

  const groups = buildPublicationDayGroups([todayPublication, stalePublication], timeZone);
  const byId = new Map(groups.map((group) => [group.id, group.items.map((item) => item.id)]));

  assert.deepEqual(byId.get("2026-03-28"), ["stale-day"]);
  assert.deepEqual(byId.get("2026-03-29"), ["today"]);
  assert.equal(getPublicationDisplayDayKey(stalePublication, timeZone), "2026-03-28");
});

test("planner derives visible slot index from scheduledAt and detects stale slot metadata", () => {
  const slotLabels = ["22:00", "22:15", "22:30", "22:45"];
  const timeZone = "Europe/Moscow";
  const stalePublication = makePublication("stale-slot", {
    scheduledAt: "2026-03-28T19:30:00.000Z",
    uploadReadyAt: "2026-03-28T17:30:00.000Z",
    slotDate: "2026-03-29",
    slotIndex: 2
  });

  assert.equal(getPublicationDisplaySlotIndex(stalePublication, slotLabels, timeZone), 2);
  assert.equal(isPublicationSlotSynchronized(stalePublication, slotLabels, timeZone), false);
});

test("planner does not pretend unmatched exact times still belong to a slot", () => {
  const slotLabels = ["22:00", "22:15", "22:30", "22:45"];
  const timeZone = "Europe/Moscow";
  const unmatchedPublication = makePublication("custom-like", {
    scheduledAt: "2026-03-29T19:37:00.000Z",
    uploadReadyAt: "2026-03-29T17:37:00.000Z",
    slotDate: "2026-03-29",
    slotIndex: 2
  });

  assert.equal(getPublicationDisplaySlotIndex(unmatchedPublication, slotLabels, timeZone), null);
  assert.equal(isPublicationSlotSynchronized(unmatchedPublication, slotLabels, timeZone), false);
});
