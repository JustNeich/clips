import test from "node:test";
import assert from "node:assert/strict";

import type {
  Channel,
  Stage2Response,
  Stage3RenderPlan,
  Stage3SourceCrop,
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
  CHANNEL_STORY_TEMPLATE_ID,
  STAGE3_TEMPLATE_ID,
  cloneStage3TemplateConfig,
  getTemplateById
} from "../lib/stage3-template";
import { CHANNEL_STORY_LOWER_SOURCE_STRIP_CROP_SOURCE } from "../lib/stage3-source-crop";

const TOP_TEXT = "ЭТО ВЕРХНИЙ ТЕКСТ";
const BOTTOM_TEXT = "а это нижний текст подписи";
const SOURCE_OVERLAY_TEXT = "источник: канал";
const MANAGED_TEMPLATE_ID = "managed-invention-terraon-test";
const WISDOM_STORIES_TEMPLATE_ID = "wisdom-stories-invention-1c607d01";
const DONOR_SOURCE_STRIP_START_Y = 0.84;

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

function makeChannelStoryManagedTemplateState(): Stage3SnapshotManagedTemplateState {
  const templateConfig = cloneStage3TemplateConfig(getTemplateById(CHANNEL_STORY_TEMPLATE_ID));
  templateConfig.author.name = "Wisdom Stories";
  templateConfig.author.handle = "@wisdomstories9";
  return {
    managedId: WISDOM_STORIES_TEMPLATE_ID,
    baseTemplateId: CHANNEL_STORY_TEMPLATE_ID,
    templateConfig,
    updatedAt: new Date().toISOString()
  };
}

function resolveVisibleSourceYRange(input: {
  sourceAspect: number;
  viewportAspect: number;
  sourceCrop: Stage3SourceCrop | null;
}): { top: number; bottom: number } {
  const crop = input.sourceCrop ?? {
    enabled: true,
    x: 0,
    y: 0,
    width: 1,
    height: 1
  };
  if (!crop.enabled) {
    return { top: 0, bottom: 1 };
  }
  const croppedSourceAspect = (input.sourceAspect * crop.width) / crop.height;
  if (croppedSourceAspect >= input.viewportAspect) {
    return {
      top: crop.y,
      bottom: crop.y + crop.height
    };
  }
  const visibleHeightWithinCrop = Math.min(1, croppedSourceAspect / input.viewportAspect);
  const hiddenHeightWithinCrop = Math.max(0, 1 - visibleHeightWithinCrop);
  return {
    top: crop.y + crop.height * (hiddenHeightWithinCrop / 2),
    bottom: crop.y + crop.height * (1 - hiddenHeightWithinCrop / 2)
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

test("channel_story source_full default snapshot crops the lower source strip inside media", () => {
  const managedState = makeChannelStoryManagedTemplateState();
  const snapshot = buildDefaultStage3RenderSnapshot({
    stage2: makeStage2Response(),
    channel: makeChannel(WISDOM_STORIES_TEMPLATE_ID),
    templateId: WISDOM_STORIES_TEMPLATE_ID,
    managedTemplateState: managedState,
    sourceDurationSec: 54
  });

  assert.equal(snapshot.renderPlan.templateId, WISDOM_STORIES_TEMPLATE_ID);
  assert.equal(snapshot.managedTemplateState?.managedId, WISDOM_STORIES_TEMPLATE_ID);
  assert.equal(snapshot.managedTemplateState?.baseTemplateId, CHANNEL_STORY_TEMPLATE_ID);
  assert.equal(snapshot.managedTemplateState?.templateConfig.layoutKind, "channel_story");
  assert.equal(snapshot.renderPlan.durationMode, "source_full");
  assert.equal(snapshot.renderPlan.targetDurationSec, 54);
  assert.equal(snapshot.clipDurationSec, 54);
  assert.equal(snapshot.sourceDurationSec, 54);
  assert.equal(snapshot.renderPlan.mirrorEnabled, false);
  assert.equal(snapshot.renderPlan.authorName, "Wisdom Stories");
  assert.equal(snapshot.renderPlan.authorHandle, "@wisdomstories");
  assert.equal(snapshot.renderPlan.videoFit, "contain");
  assert.ok(snapshot.topText.trim());
  assert.ok(snapshot.bottomText.trim());

  const crop = snapshot.renderPlan.sourceCrop;
  assert.ok(crop, "channel_story full-source default snapshot must include sourceCrop");
  assert.equal(crop.source, CHANNEL_STORY_LOWER_SOURCE_STRIP_CROP_SOURCE);
  assert.equal(crop.x, 0);
  assert.equal(crop.y, 0);
  assert.equal(crop.width, 1);
  assert.equal(crop.height, 0.84);

  const renderSnapshot = buildTemplateRenderSnapshot({
    templateId: CHANNEL_STORY_TEMPLATE_ID,
    templateConfigOverride: managedState.templateConfig,
    content: {
      topText: snapshot.topText,
      bottomText: snapshot.bottomText,
      sourceOverlayText: snapshot.sourceOverlayText ?? "",
      channelName: snapshot.renderPlan.authorName,
      channelHandle: snapshot.renderPlan.authorHandle,
      highlights: snapshot.captionHighlights,
      topFontScale: snapshot.renderPlan.topFontScale,
      bottomFontScale: snapshot.renderPlan.bottomFontScale,
      previewScale: 1,
      mediaAsset: null,
      backgroundAsset: null,
      avatarAsset: null
    }
  });
  assert.equal(renderSnapshot.layout.frame.width, 1080);
  assert.equal(renderSnapshot.layout.frame.height, 1920);

  const viewportAspect = renderSnapshot.layout.media.width / renderSnapshot.layout.media.height;
  const beforeCrop = resolveVisibleSourceYRange({
    sourceAspect: 16 / 9,
    viewportAspect,
    sourceCrop: null
  });
  const afterCrop = resolveVisibleSourceYRange({
    sourceAspect: 16 / 9,
    viewportAspect,
    sourceCrop: crop
  });
  assert.ok(
    beforeCrop.bottom > DONOR_SOURCE_STRIP_START_Y,
    "without sourceCrop the lower donor/source strip can remain visible in a landscape source"
  );
  assert.ok(
    afterCrop.bottom <= DONOR_SOURCE_STRIP_START_Y,
    "sourceCrop excludes the lower donor/source strip before fitting the media viewport"
  );

  const workerPlan = normalizeRenderPlan(
    snapshot.renderPlan,
    54,
    WISDOM_STORIES_TEMPLATE_ID,
    undefined,
    snapshot.managedTemplateState
  );
  assert.equal(workerPlan.sourceCrop?.source, CHANNEL_STORY_LOWER_SOURCE_STRIP_CROP_SOURCE);
  assert.equal(workerPlan.durationMode, "source_full");
  assert.equal(workerPlan.mirrorEnabled, false);
  assert.equal(workerPlan.videoFit, "contain");

  const { baseSnapshotHash } = reproduceWorkerTemplateSnapshot({
    snapshot,
    bodyTemplateId: WISDOM_STORIES_TEMPLATE_ID,
    workerSourceDurationSec: 54
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
