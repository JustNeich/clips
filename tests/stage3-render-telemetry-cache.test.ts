import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { Stage3RenderPlan } from "../app/components/types";
import {
  buildPreparedRenderSourceCacheKeyForTests,
  measureStage3RenderStageForTests,
  type Stage3RenderProgressEvent
} from "../lib/stage3-render-service";

test("Stage 3 render telemetry emits started and completed stage events with duration", async () => {
  const events: Stage3RenderProgressEvent[] = [];
  const result = await measureStage3RenderStageForTests(
    { onProgress: (event) => events.push(event) },
    "prepare_source",
    { cacheState: "miss" },
    async () => "ok"
  );

  assert.equal(result, "ok");
  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((event) => `${event.stage}:${event.status}`),
    ["prepare_source:started", "prepare_source:completed"]
  );
  assert.equal(events[1]?.payload?.cacheState, "miss");
  assert.equal(typeof events[1]?.durationMs, "number");
});

test("Stage 3 render telemetry emits failed stage events without swallowing the error", async () => {
  const events: Stage3RenderProgressEvent[] = [];
  await assert.rejects(
    () =>
      measureStage3RenderStageForTests(
        { onProgress: (event) => events.push(event) },
        "remotion_render",
        { timeoutMs: 1000 },
        async () => {
          throw new Error("render boom");
        }
      ),
    /render boom/
  );

  assert.deepEqual(
    events.map((event) => `${event.stage}:${event.status}`),
    ["remotion_render:started", "remotion_render:failed"]
  );
  assert.equal(events[1]?.errorMessage, "render boom");
});

test("prepared render source cache key is stable and changes with music signature", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "clips-stage3-render-cache-key-test-"));
  try {
    const musicPath = path.join(dir, "music.mp3");
    await writeFile(musicPath, "track-v1", "utf-8");
    const renderPlanA = {
      targetDurationSec: 6,
      segments: [{ startSec: 0, endSec: 6, speed: 1 }],
      focusY: 0.5
    } as unknown as Stage3RenderPlan;
    const renderPlanB = {
      focusY: 0.5,
      segments: [{ speed: 1, endSec: 6, startSec: 0 }],
      targetDurationSec: 6
    } as unknown as Stage3RenderPlan;

    const keyA = await buildPreparedRenderSourceCacheKeyForTests({
      sourceKey: "source-1",
      sourceDurationSec: 20,
      clipStartSec: 1,
      targetDurationSec: 6,
      renderPlan: renderPlanA,
      musicFilePath: musicPath
    });
    const keyB = await buildPreparedRenderSourceCacheKeyForTests({
      sourceKey: "source-1",
      sourceDurationSec: 20,
      clipStartSec: 1,
      targetDurationSec: 6,
      renderPlan: renderPlanB,
      musicFilePath: musicPath
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeFile(musicPath, "track-v2-longer", "utf-8");
    const changedMusicKey = await buildPreparedRenderSourceCacheKeyForTests({
      sourceKey: "source-1",
      sourceDurationSec: 20,
      clipStartSec: 1,
      targetDurationSec: 6,
      renderPlan: renderPlanA,
      musicFilePath: musicPath
    });

    assert.equal(keyA, keyB);
    assert.notEqual(keyA, changedMusicKey);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
