import test from "node:test";
import assert from "node:assert/strict";

import type {
  Channel,
  Stage2Response,
  Stage3RenderPlan,
  Stage3SnapshotManagedTemplateState,
  Stage3StateSnapshot
} from "../app/components/types";
import {
  buildDefaultStage3RenderSnapshot,
  type BuildDefaultStage3RenderSnapshotInput
} from "../lib/stage3-default-snapshot";
import { normalizeRenderPlan } from "../lib/stage3-render-service";
import { resolveManagedTemplateRuntimeSync } from "../lib/managed-template-runtime";
import { buildTemplateRenderSnapshot } from "../lib/stage3-template-core";
import { assertStage3RenderTemplateSnapshotFresh } from "../lib/stage3-render-template-snapshot";
import {
  STAGE3_TEMPLATE_ID,
  cloneStage3TemplateConfig,
  getTemplateById
} from "../lib/stage3-template";

const TOP_TEXT = "ЭТО ВЕРХНИЙ ТЕКСТ";
const BOTTOM_TEXT = "а это нижний текст подписи";
const SOURCE_OVERLAY_TEXT = "источник: канал";
const MANAGED_TEMPLATE_ID = "managed-invention-terraon-test";

/**
 * Minimal synthetic Stage 2 result. `buildStage2ToStage3HandoffSummary` reads
 * `output.captionOptions[].{top,bottom,highlights,option}`,
 * `output.finalPick.option`, and `output.sourceOverlay*` via a loose cast, so a
 * partial output is sufficient for caption resolution.
 */
function makeStage2Response(): Stage2Response {
  return {
    source: {
      url: "https://www.youtube.com/watch?v=test",
      title: "Test",
      totalComments: 0,
      topComments: [],
      allComments: [],
      commentsUsedForPrompt: 0
    },
    output: {
      captionOptions: [
        {
          option: 1,
          top: TOP_TEXT,
          bottom: BOTTOM_TEXT,
          highlights: { top: [], bottom: [] }
        }
      ],
      finalPick: { option: 1 },
      sourceOverlayOptions: [{ option: 1, text: SOURCE_OVERLAY_TEXT }],
      sourceOverlayFinalPick: { option: 1 }
    }
  } as unknown as Stage2Response;
}

function makeChannel(templateId: string): Channel {
  return {
    id: "channel-test",
    name: "Wisdom Stories",
    username: "@wisdomstories",
    systemPrompt: "",
    descriptionPrompt: "",
    examplesJson: "[]",
    stage2WorkerProfileId: null,
    templateId,
    avatarAssetId: null,
    defaultBackgroundAssetId: null,
    defaultMusicAssetId: null,
    defaultClipDurationSec: 6,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  } as unknown as Channel;
}

function makeManagedTemplateState(): Stage3SnapshotManagedTemplateState {
  // A managed template whose base is a built-in variant but whose config is
  // tweaked. The worker must resolve it from the EMBEDDED snapshot state (it has
  // no workspace_templates row), not from its empty local DB.
  const baseTemplateId = STAGE3_TEMPLATE_ID;
  const templateConfig = cloneStage3TemplateConfig(getTemplateById(baseTemplateId));
  return {
    managedId: MANAGED_TEMPLATE_ID,
    baseTemplateId,
    templateConfig,
    updatedAt: new Date().toISOString()
  };
}

/**
 * Reproduces the Stage 3 render worker's `template_snapshot` recompute
 * (lib/stage3-render-service.ts ~1446-1510) for a given request body + snapshot.
 * Returns the recomputed base snapshot hash, or throws exactly as the worker
 * would (managed FK failure, or snapshot-freshness drift).
 */
function reproduceWorkerTemplateSnapshot(args: {
  snapshot: Stage3StateSnapshot;
  bodyTemplateId: string | undefined;
  workerSourceDurationSec: number;
}): { baseSnapshotHash: string } {
  const { snapshot } = args;
  const templateIdFromInput =
    typeof (snapshot.renderPlan as Partial<Stage3RenderPlan> | undefined)?.templateId ===
      "string" && (snapshot.renderPlan as Partial<Stage3RenderPlan>).templateId?.trim()
      ? String((snapshot.renderPlan as Partial<Stage3RenderPlan>).templateId).trim()
      : args.bodyTemplateId?.trim() || STAGE3_TEMPLATE_ID;
  const renderPlan = normalizeRenderPlan(
    snapshot.renderPlan,
    args.workerSourceDurationSec,
    templateIdFromInput,
    undefined,
    snapshot.managedTemplateState ?? undefined
  );
  // resolveManagedTemplateRuntimeSync FK-fails here when renderPlan.templateId is
  // a managed (non-built-in) id AND no matching managedTemplateState is embedded.
  const managedTemplateRuntime = resolveManagedTemplateRuntimeSync(
    renderPlan.templateId,
    snapshot.managedTemplateState ?? undefined
  );
  const templateSnapshotContent = {
    topText: snapshot.topText ?? "",
    bottomText: snapshot.bottomText ?? "",
    sourceOverlayText: snapshot.sourceOverlayText ?? "",
    channelName: renderPlan.authorName,
    channelHandle: renderPlan.authorHandle,
    highlights: snapshot.captionHighlights ?? { top: [], bottom: [] },
    topFontScale: renderPlan.topFontScale,
    bottomFontScale: renderPlan.bottomFontScale,
    previewScale: 1,
    mediaAsset: null,
    backgroundAsset: null,
    avatarAsset: null
  };
  const baseTemplateSnapshot = buildTemplateRenderSnapshot({
    templateId: managedTemplateRuntime.baseTemplateId,
    templateConfigOverride: managedTemplateRuntime.templateConfig,
    content: templateSnapshotContent
  });
  const requestedTextFitOverride = snapshot.textFit
    ? {
        topFontPx: snapshot.textFit.topFontPx,
        bottomFontPx: snapshot.textFit.bottomFontPx,
        topLineHeight: snapshot.textFit.topLineHeight,
        bottomLineHeight: snapshot.textFit.bottomLineHeight,
        topLines: snapshot.textFit.topLines,
        bottomLines: snapshot.textFit.bottomLines,
        topCompacted: snapshot.textFit.topCompacted,
        bottomCompacted: snapshot.textFit.bottomCompacted
      }
    : undefined;
  const textFitTemplateSnapshot = requestedTextFitOverride
    ? buildTemplateRenderSnapshot({
        templateId: managedTemplateRuntime.baseTemplateId,
        templateConfigOverride: managedTemplateRuntime.templateConfig,
        content: templateSnapshotContent,
        fitOverride: requestedTextFitOverride
      })
    : null;
  assertStage3RenderTemplateSnapshotFresh({
    snapshot,
    baseTemplateSnapshot,
    textFitTemplateSnapshot
  });
  return { baseSnapshotHash: baseTemplateSnapshot.snapshotHash };
}

test("built-in channel_default: captions populated, hashes present, worker freshness passes", () => {
  const snapshot = buildDefaultStage3RenderSnapshot({
    stage2: makeStage2Response(),
    channel: makeChannel(STAGE3_TEMPLATE_ID),
    templateId: STAGE3_TEMPLATE_ID,
    managedTemplateState: null,
    sourceDurationSec: null
  } satisfies BuildDefaultStage3RenderSnapshotInput);

  assert.equal(snapshot.topText, TOP_TEXT);
  assert.equal(snapshot.bottomText, BOTTOM_TEXT);
  assert.ok(snapshot.templateSnapshot?.snapshotHash, "templateSnapshot.snapshotHash present");
  assert.ok(snapshot.textFit?.snapshotHash, "textFit.snapshotHash present");
  assert.ok(snapshot.textFit?.fitHash, "textFit.fitHash present");
  assert.equal(snapshot.renderPlan.durationMode, "channel_default");
  assert.equal(snapshot.renderPlan.targetDurationSec, 6);
  assert.equal(snapshot.renderPlan.authorName, "Wisdom Stories");
  assert.equal(snapshot.renderPlan.mirrorEnabled, false);

  // Worker computes its OWN source duration (e.g. 53.6) even though the server
  // built at null; the hash must still match because hash inputs are content-only.
  const { baseSnapshotHash } = reproduceWorkerTemplateSnapshot({
    snapshot,
    bodyTemplateId: STAGE3_TEMPLATE_ID,
    workerSourceDurationSec: 53.6
  });
  assert.equal(baseSnapshotHash, snapshot.templateSnapshot?.snapshotHash);
});

test("source_full honors a passed source duration (full-length render)", () => {
  const snapshot = buildDefaultStage3RenderSnapshot({
    stage2: makeStage2Response(),
    channel: makeChannel(STAGE3_TEMPLATE_ID),
    templateId: STAGE3_TEMPLATE_ID,
    managedTemplateState: null,
    sourceDurationSec: 53.6
  });

  assert.equal(snapshot.renderPlan.durationMode, "source_full");
  assert.equal(snapshot.clipDurationSec, 53.6);
  assert.equal(snapshot.sourceDurationSec, 53.6);
  assert.equal(snapshot.renderPlan.mirrorEnabled, false);

  const { baseSnapshotHash } = reproduceWorkerTemplateSnapshot({
    snapshot,
    bodyTemplateId: STAGE3_TEMPLATE_ID,
    workerSourceDurationSec: 53.6
  });
  assert.equal(baseSnapshotHash, snapshot.templateSnapshot?.snapshotHash);
});

test("managed channel template: embedded state lets the worker resolve WITHOUT a FK failure", () => {
  const managedState = makeManagedTemplateState();
  const snapshot = buildDefaultStage3RenderSnapshot({
    stage2: makeStage2Response(),
    channel: makeChannel(MANAGED_TEMPLATE_ID),
    // The route resolves managedTemplateState against the SAME effective template
    // id (channel.templateId here) and passes it in. This is the regression fix:
    // a managed renderPlan.templateId MUST ship with its embedded state.
    templateId: MANAGED_TEMPLATE_ID,
    managedTemplateState: managedState,
    sourceDurationSec: 53.6
  });

  assert.equal(snapshot.renderPlan.templateId, MANAGED_TEMPLATE_ID);
  assert.equal(snapshot.managedTemplateState?.managedId, MANAGED_TEMPLATE_ID);
  assert.equal(snapshot.topText, TOP_TEXT);

  // Worker recompute must NOT throw "FOREIGN KEY constraint failed": the managed
  // template resolves entirely from the embedded snapshot state.
  assert.doesNotThrow(() => {
    const { baseSnapshotHash } = reproduceWorkerTemplateSnapshot({
      snapshot,
      bodyTemplateId: MANAGED_TEMPLATE_ID,
      workerSourceDurationSec: 53.6
    });
    assert.equal(baseSnapshotHash, snapshot.templateSnapshot?.snapshotHash);
  });
});

test("REGRESSION: a managed renderPlan.templateId WITHOUT embedded state would FK-fail on the worker", () => {
  // This is the bug the route fix prevents: build a snapshot for a managed
  // channel but strip the embedded managedTemplateState (simulating the old
  // route that resolved managed state only from input.templateId). The worker
  // can no longer resolve the managed id and throws.
  const managedState = makeManagedTemplateState();
  const snapshot = buildDefaultStage3RenderSnapshot({
    stage2: makeStage2Response(),
    channel: makeChannel(MANAGED_TEMPLATE_ID),
    templateId: MANAGED_TEMPLATE_ID,
    managedTemplateState: managedState,
    sourceDurationSec: null
  });
  const strippedSnapshot: Stage3StateSnapshot = {
    ...snapshot,
    managedTemplateState: null
  };

  assert.throws(
    () =>
      reproduceWorkerTemplateSnapshot({
        snapshot: strippedSnapshot,
        bodyTemplateId: MANAGED_TEMPLATE_ID,
        workerSourceDurationSec: 53.6
      }),
    /FOREIGN KEY|constraint|template/i,
    "worker must reject a managed id with no embedded state"
  );
});
