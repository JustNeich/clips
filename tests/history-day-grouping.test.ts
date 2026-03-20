import assert from "node:assert/strict";
import test from "node:test";

import { formatHistoryDayLabel, groupHistoryItemsByDay } from "../app/components/AppShell";
import type { ChatListItem } from "../app/components/types";

function makeItem(id: string, updatedAt: string): ChatListItem {
  return {
    id,
    channelId: "channel",
    url: `https://example.com/${id}`,
    title: `Video ${id}`,
    updatedAt,
    status: "editing",
    maxStep: 3,
    preferredStep: 3,
    hasDraft: true,
    exportTitle: null,
    liveAction: null
  };
}

test("history groups items by local day and keeps newest items first within each day", () => {
  const now = new Date("2026-03-19T21:00:00+03:00");
  const groups = groupHistoryItemsByDay(
    [
      makeItem("older-today", "2026-03-19T10:15:00+03:00"),
      makeItem("yesterday", "2026-03-18T23:10:00+03:00"),
      makeItem("newest-today", "2026-03-19T20:56:00+03:00"),
      makeItem("march-17", "2026-03-17T08:00:00+03:00")
    ],
    now
  );

  assert.deepEqual(
    groups.map((group) => group.label),
    ["Сегодня", "Вчера", "17 марта"]
  );
  assert.deepEqual(
    groups[0]?.items.map((item) => item.id),
    ["newest-today", "older-today"]
  );
  assert.deepEqual(groups[1]?.items.map((item) => item.id), ["yesterday"]);
});

test("history day labels include year for older calendar years", () => {
  const now = new Date("2026-03-19T12:00:00+03:00");
  assert.equal(formatHistoryDayLabel("2026-03-19T09:00:00+03:00", now), "Сегодня");
  assert.equal(formatHistoryDayLabel("2026-03-18T09:00:00+03:00", now), "Вчера");
  assert.equal(formatHistoryDayLabel("2025-12-30T09:00:00+03:00", now), "30 декабря 2025 г.");
});
