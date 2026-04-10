import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPublicationInspectorDraft,
  isPublicationInspectorDirty,
  mapPublicationMutationPayloadToFieldErrors,
  mergePublicationMutationResult,
  resolvePublicationSelectionRequest,
  selectPreferredPublicationId,
  shouldHydratePublicationInspectorDraft
} from "../app/components/publishing-workspace-support";
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

test("selectPreferredPublicationId prefers the active chat publication when selection is empty", () => {
  const publications = [
    makePublication("later", { chatId: "chat-later", scheduledAt: "2026-03-30T19:30:00.000Z" }),
    makePublication("active", { chatId: "chat-active", scheduledAt: "2026-03-31T19:30:00.000Z" })
  ];

  const selected = selectPreferredPublicationId({
    publications,
    activeChatId: "chat-active",
    selectedPublicationId: null,
    now: new Date("2026-03-29T00:00:00.000Z").getTime()
  });

  assert.equal(selected, "active");
});

test("selectPreferredPublicationId preserves current selection when it still exists after refresh", () => {
  const publications = [
    makePublication("first", { scheduledAt: "2026-03-30T19:30:00.000Z" }),
    makePublication("second", { scheduledAt: "2026-03-31T19:30:00.000Z" })
  ];

  const selected = selectPreferredPublicationId({
    publications,
    activeChatId: null,
    selectedPublicationId: "second",
    now: new Date("2026-03-29T00:00:00.000Z").getTime()
  });

  assert.equal(selected, "second");
});

test("resolvePublicationSelectionRequest prompts when switching away from dirty draft", () => {
  assert.equal(
    resolvePublicationSelectionRequest({
      currentSelectionId: "current",
      nextSelectionId: "next",
      isDirty: true
    }),
    "prompt"
  );
  assert.equal(
    resolvePublicationSelectionRequest({
      currentSelectionId: "current",
      nextSelectionId: "current",
      isDirty: true
    }),
    "ignore"
  );
});

test("shouldHydratePublicationInspectorDraft keeps same dirty draft intact", () => {
  assert.equal(
    shouldHydratePublicationInspectorDraft({
      selectedPublicationId: "publication-1",
      draftPublicationId: "publication-1",
      hasDraft: true,
      isDirty: true
    }),
    false
  );

  assert.equal(
    shouldHydratePublicationInspectorDraft({
      selectedPublicationId: "publication-2",
      draftPublicationId: "publication-1",
      hasDraft: true,
      isDirty: true
    }),
    true
  );
});

test("isPublicationInspectorDirty ignores no-op whitespace but reacts to real metadata changes", () => {
  const publication = makePublication("dirty", {
    title: "Title dirty",
    description: "Description",
    tags: ["one", "two"]
  });
  const slotLabels = ["22:00", "22:15", "22:30", "22:45"];
  const draft = buildPublicationInspectorDraft(publication, slotLabels, "Europe/Moscow");

  const withWhitespace = {
    ...draft,
    title: " Title dirty ",
    description: "Description "
  };
  assert.equal(
    isPublicationInspectorDirty(publication, withWhitespace, slotLabels, "Europe/Moscow"),
    false
  );

  const changed = {
    ...draft,
    tags: "one, two, three"
  };
  assert.equal(
    isPublicationInspectorDirty(publication, changed, slotLabels, "Europe/Moscow"),
    true
  );
});

test("mapPublicationMutationPayloadToFieldErrors keeps field-level and form-level errors separate", () => {
  assert.deepEqual(
    mapPublicationMutationPayloadToFieldErrors({
      error: "Это время уже занято другой публикацией.",
      code: "TIME_OCCUPIED",
      field: "scheduledAtLocal"
    }),
    {
      scheduledAtLocal: "Это время уже занято другой публикацией."
    }
  );

  assert.deepEqual(
    mapPublicationMutationPayloadToFieldErrors({
      error: "Публикацию нельзя редактировать, пока ролик загружается в YouTube.",
      code: "PUBLICATION_UPLOAD_IN_PROGRESS"
    }),
    {
      form: "Публикацию нельзя редактировать, пока ролик загружается в YouTube."
    }
  );
});

test("mergePublicationMutationResult applies single and swap updates without losing the list", () => {
  const original = [
    makePublication("first", { slotIndex: 0 }),
    makePublication("second", { slotIndex: 1 })
  ];

  const moved = mergePublicationMutationResult(original, makePublication("first", { slotIndex: 2 }));
  assert.equal(moved.find((item) => item.id === "first")?.slotIndex, 2);
  assert.equal(moved.find((item) => item.id === "second")?.slotIndex, 1);

  const swapped = mergePublicationMutationResult(original, {
    publication: makePublication("first", { slotIndex: 1 }),
    swappedPublication: makePublication("second", { slotIndex: 0 })
  });
  assert.equal(swapped.find((item) => item.id === "first")?.slotIndex, 1);
  assert.equal(swapped.find((item) => item.id === "second")?.slotIndex, 0);
});
