import assert from "node:assert/strict";
import test from "node:test";

import {
  assertStage3JobManagedTemplateState,
  classifyStage3HeavyJobError
} from "../lib/stage3-job-executor";
import { Stage3ArtifactStorageError, STAGE3_ARTIFACT_STORAGE_FULL_MESSAGE } from "../lib/stage3-job-artifacts";
import { SCIENCE_CARD, STAGE3_TEMPLATE_ID } from "../lib/stage3-template";
import type { Stage3RenderRequestBody } from "../lib/stage3-render-service";

test("editing proxy anti-bot failures are marked as non-recoverable", () => {
  const classified = classifyStage3HeavyJobError(
    "editing-proxy",
    new Error("sign in to confirm you're not a bot")
  );

  assert.equal(classified.code, "editing_proxy_failed");
  assert.equal(classified.recoverable, false);
  assert.equal(
    classified.message,
    "Источник отклонил запрос на этом сервере (anti-bot/auth). Если YTDLP_COOKIES уже заданы, проблема может быть в IP или репутации runtime."
  );
});

test("generic render failures stay recoverable", () => {
  const classified = classifyStage3HeavyJobError("render", new Error("Remotion crashed"));

  assert.equal(classified.code, "render_failed");
  assert.equal(classified.recoverable, true);
  assert.equal(classified.message, "Remotion crashed");
});

test("artifact storage pressure is a recoverable Stage 3 failure", () => {
  const classified = classifyStage3HeavyJobError("editing-proxy", new Stage3ArtifactStorageError(new Error("ENOSPC")));

  assert.equal(classified.code, "artifact_storage_full");
  assert.equal(classified.recoverable, true);
  assert.equal(classified.message, STAGE3_ARTIFACT_STORAGE_FULL_MESSAGE);
});

test("Stage 3 worker accepts built-in or exact embedded templates and rejects silent custom fallback", () => {
  assert.doesNotThrow(() =>
    assertStage3JobManagedTemplateState("render", {
      templateId: STAGE3_TEMPLATE_ID,
      snapshot: { renderPlan: { templateId: STAGE3_TEMPLATE_ID } }
    } as unknown as Stage3RenderRequestBody)
  );

  assert.doesNotThrow(() =>
    assertStage3JobManagedTemplateState("render", {
      templateId: "managed-template-1",
      snapshot: {
        renderPlan: { templateId: "managed-template-1" },
        managedTemplateState: {
          managedId: "managed-template-1",
          baseTemplateId: STAGE3_TEMPLATE_ID,
          templateConfig: SCIENCE_CARD,
          updatedAt: "2026-07-15T12:00:00.000Z"
        }
      }
    } as unknown as Stage3RenderRequestBody)
  );

  assert.throws(
    () =>
      assertStage3JobManagedTemplateState("render", {
        templateId: "managed-template-1",
        snapshot: { renderPlan: { templateId: "managed-template-1" } }
      } as unknown as Stage3RenderRequestBody),
    /managed_template_state_required/
  );

  assert.throws(
    () =>
      assertStage3JobManagedTemplateState("render", {
        sourceUrl: "https://www.youtube.com/shorts/source"
      }),
    /channel_template_required/
  );

  const classified = classifyStage3HeavyJobError(
    "render",
    new Error("managed_template_state_required: template managed-template-1 has no exact embedded state")
  );
  assert.equal(classified.code, "managed_template_state_required");
  assert.equal(classified.recoverable, false);
});
