import type {
  Channel,
  ChannelAsset,
  Stage2Response,
  Stage3RenderPlan,
  Stage3SnapshotManagedTemplateState,
  Stage3StateSnapshot
} from "../app/components/types";
import { buildStage2ToStage3HandoffSummary } from "./stage2-stage3-handoff";
import {
  cloneTemplateCaptionHighlights,
  createEmptyTemplateCaptionHighlights
} from "./template-highlights";
import {
  normalizeStage3ClipDurationSec,
  normalizeStage3SourceFullDurationSec,
  resolveStage3OutputDurationSec
} from "./stage3-duration";
import { buildStage3EditorSession } from "./stage3-editor-core";
import { buildTemplateRenderSnapshot } from "./stage3-template-core";
import { createStage3TextFitSnapshot } from "./stage3-text-fit";
import {
  resolveStage3SnapshotManagedTemplateState,
  toSnapshotManagedTemplateState
} from "./stage3-snapshot-managed-template";
import { STAGE3_TEMPLATE_ID } from "./stage3-template";
// The render worker normalizer is the canonical, server-safe Stage3RenderPlan
// builder. We deliberately DO NOT import app/home-page-support's client
// (`"use client"`) applyChannelToRenderPlan/normalizeRenderPlan/findAssetById;
// pulling that module into a server route would drag DOM-only code in.
import { normalizeRenderPlan } from "./stage3-render-service";

function findAssetById(
  assets: ChannelAsset[],
  assetId: string | null | undefined
): ChannelAsset | null {
  if (!assetId) {
    return null;
  }
  return assets.find((asset) => asset.id === assetId) ?? null;
}

/**
 * Server-side equivalent of app/page.tsx `applyChannelToRenderPlan`: resolves a
 * channel (plus its assets) into a normalized Stage3RenderPlan with NO user
 * overrides. Built with the worker's own `normalizeRenderPlan` so the result is
 * server-safe and matches what the render stage will re-normalize.
 */
function buildChannelRenderPlan(
  channel: Channel,
  assets: ChannelAsset[],
  templateIdOverride?: string | null
): Stage3RenderPlan {
  const resolvedTemplateId =
    (typeof templateIdOverride === "string" && templateIdOverride.trim()
      ? templateIdOverride.trim()
      : channel.templateId) || STAGE3_TEMPLATE_ID;
  const avatar = findAssetById(assets, channel.avatarAssetId);
  const background = findAssetById(assets, channel.defaultBackgroundAssetId);
  const music = findAssetById(assets, channel.defaultMusicAssetId);
  return normalizeRenderPlan(
    {
      targetDurationSec: normalizeStage3ClipDurationSec(channel.defaultClipDurationSec),
      durationMode: "channel_default",
      templateId: resolvedTemplateId,
      authorName: channel.name || undefined,
      authorHandle: channel.username.startsWith("@")
        ? channel.username
        : `@${channel.username || "channel"}`,
      avatarAssetId: channel.avatarAssetId,
      avatarAssetMimeType: avatar?.mimeType ?? null,
      backgroundAssetId: channel.defaultBackgroundAssetId,
      backgroundAssetMimeType: background?.mimeType ?? null,
      musicAssetId: channel.defaultMusicAssetId,
      musicAssetMimeType: music?.mimeType ?? null,
      audioMode: channel.defaultMusicAssetId ? "source_plus_music" : "source_only",
      // ZoroKing/copscopes standard: never horizontally mirror the source. The
      // product-wide default (`normalizeRenderPlan` falls back to `mirrorEnabled
      // ?? true`) mirrors footage for anti-fingerprinting, but that reverses any
      // baked donor captions/watermarks left-to-right — which is exactly the
      // broken "flipped text" we saw on the first MCP render. The copscopes
      // publication quality gate already REQUIRES `mirrorEnabled === false`; the
      // MCP default snapshot must agree so the Stage 3 worker draws upright text.
      mirrorEnabled: false
    },
    null,
    resolvedTemplateId,
    undefined,
    null
  );
}

export type BuildDefaultStage3RenderSnapshotInput = {
  stage2: Stage2Response | null | undefined;
  channel: Channel;
  channelAssets?: ChannelAsset[];
  managedTemplateState: Stage3SnapshotManagedTemplateState | null;
  /**
   * Explicit template id to render. When omitted the channel's own
   * `channel.templateId` is used (UI parity). The caller MUST resolve
   * `managedTemplateState` against this SAME id (the route does), otherwise a
   * managed (non-built-in) template id ships without its embedded state and the
   * Stage 3 worker FK-fails resolving it from its intentionally-empty
   * workspace_templates table.
   */
  templateId?: string | null;
  /**
   * Source media duration in seconds, if the caller already knows it. When
   * provided the plan renders the FULL source (durationMode `source_full`),
   * mirroring the interactive "Полный исходник" path so a 53.6s talking-head
   * renders full-length instead of the 6s channel default. When null the worker
   * resolves the real source duration itself and the channel default is used.
   */
  sourceDurationSec?: number | null;
};

/**
 * Builds the SAME Stage3StateSnapshot that app/page.tsx `makeLiveSnapshot`
 * produces with NO user overrides (no draftOverrides, no textFitOverride, no
 * authoritativePreviewSnapshot), from the chat's latest Stage 2 result + the
 * channel. The returned snapshot carries the full templateSnapshot + textFit so
 * the render worker draws captions AND passes
 * `assertStage3RenderTemplateSnapshotFresh`.
 */
export function buildDefaultStage3RenderSnapshot(
  input: BuildDefaultStage3RenderSnapshotInput
): Stage3StateSnapshot {
  const sourceDurationSec =
    typeof input.sourceDurationSec === "number" && Number.isFinite(input.sourceDurationSec)
      ? input.sourceDurationSec
      : null;

  // 1. Resolve caption text / highlights / source overlay exactly like the
  //    client hydration path (buildStage2ToStage3HandoffSummary with no draft /
  //    no prior version).
  const handoff = buildStage2ToStage3HandoffSummary({
    stage2: input.stage2,
    draft: null,
    latestVersion: null
  });
  const topText = handoff.topText ?? "";
  const bottomText = handoff.bottomText ?? "";
  const sourceOverlayText = handoff.sourceOverlayText ?? "";
  const captionHighlights = handoff.caption?.highlights
    ? cloneTemplateCaptionHighlights(handoff.caption.highlights)
    : createEmptyTemplateCaptionHighlights();

  // 2. Channel -> base render plan (no overrides), then resolve the effective
  //    output duration. Honor source-full when the source duration is known.
  const channelRenderPlan = buildChannelRenderPlan(
    input.channel,
    input.channelAssets ?? [],
    input.templateId
  );
  const useSourceFull = sourceDurationSec !== null;
  const effectiveTargetDurationSec = useSourceFull
    ? normalizeStage3SourceFullDurationSec(sourceDurationSec, channelRenderPlan.targetDurationSec)
    : resolveStage3OutputDurationSec({
        mode: channelRenderPlan.durationMode,
        targetDurationSec: channelRenderPlan.targetDurationSec,
        sourceDurationSec
      });
  const baseRenderPlan: Stage3RenderPlan = useSourceFull
    ? {
        ...channelRenderPlan,
        durationMode: "source_full",
        targetDurationSec: effectiveTargetDurationSec,
        editorSelectionMode: "window",
        timingMode: "auto",
        normalizeToTargetEnabled: true,
        policy: "fixed_segments",
        segments: [
          {
            startSec: 0,
            endSec: effectiveTargetDurationSec,
            speed: 1,
            label: "Полный исходник"
          }
        ]
      }
    : {
        ...channelRenderPlan,
        targetDurationSec: effectiveTargetDurationSec
      };

  // 3. Editor session -> render plan patch (segments / timing), mirroring
  //    makeLiveSnapshot.
  const editorSession = buildStage3EditorSession({
    rawSegments: baseRenderPlan.segments,
    selectionMode: baseRenderPlan.editorSelectionMode,
    legacyRenderPolicy: baseRenderPlan.policy,
    legacyNormalizeToTargetEnabled: baseRenderPlan.normalizeToTargetEnabled,
    durationMode: baseRenderPlan.durationMode,
    clipStartSec: 0,
    clipDurationSec: baseRenderPlan.targetDurationSec,
    targetDurationSec: baseRenderPlan.targetDurationSec,
    sourceDurationSec
  });
  const renderPlan: Stage3RenderPlan = {
    ...baseRenderPlan,
    ...editorSession.renderPlanPatch
  };

  // 4. Managed template state (already resolved on the cloud and passed in).
  const activeManagedTemplateState = resolveStage3SnapshotManagedTemplateState({
    templateId: renderPlan.templateId,
    pageState: input.managedTemplateState,
    previewState: null
  });
  const snapshotManagedTemplateState = toSnapshotManagedTemplateState(
    activeManagedTemplateState,
    renderPlan.templateId
  );

  // 5. Template render snapshot + text fit, built with the SAME inputs the
  //    worker re-feeds buildTemplateRenderSnapshot at render stage, so the
  //    snapshotHash / fitHash match and freshness validation passes.
  const templateSnapshot = buildTemplateRenderSnapshot({
    templateId:
      snapshotManagedTemplateState?.baseTemplateId ??
      renderPlan.templateId ??
      STAGE3_TEMPLATE_ID,
    templateConfigOverride: snapshotManagedTemplateState?.templateConfig,
    content: {
      topText,
      bottomText,
      sourceOverlayText,
      channelName: renderPlan.authorName,
      channelHandle: renderPlan.authorHandle,
      highlights: captionHighlights,
      topFontScale: renderPlan.topFontScale,
      bottomFontScale: renderPlan.bottomFontScale,
      previewScale: 1,
      mediaAsset: null,
      backgroundAsset: null,
      avatarAsset: null
    }
  });

  return {
    topText: templateSnapshot.content.topText,
    bottomText: templateSnapshot.content.bottomText,
    sourceOverlayText: templateSnapshot.content.sourceOverlayText ?? sourceOverlayText,
    captionHighlights: cloneTemplateCaptionHighlights(templateSnapshot.content.highlights),
    clipStartSec: 0,
    clipDurationSec: renderPlan.targetDurationSec,
    focusX: renderPlan.focusX,
    focusY: 0.5,
    renderPlan,
    sourceDurationSec,
    managedTemplateState: snapshotManagedTemplateState,
    templateSnapshot: {
      templateId: templateSnapshot.templateId,
      specRevision: templateSnapshot.specRevision,
      snapshotHash: templateSnapshot.snapshotHash,
      fitRevision: templateSnapshot.fitRevision
    },
    textFit: createStage3TextFitSnapshot(
      {
        templateId: templateSnapshot.templateId,
        snapshotHash: templateSnapshot.snapshotHash,
        topText: templateSnapshot.content.topText,
        bottomText: templateSnapshot.content.bottomText,
        topFontScale: templateSnapshot.content.topFontScale,
        bottomFontScale: templateSnapshot.content.bottomFontScale
      },
      {
        topFontPx: templateSnapshot.fit.topFontPx,
        bottomFontPx: templateSnapshot.fit.bottomFontPx,
        topLineHeight: templateSnapshot.fit.topLineHeight,
        bottomLineHeight: templateSnapshot.fit.bottomLineHeight,
        topLines: templateSnapshot.fit.topLines,
        bottomLines: templateSnapshot.fit.bottomLines,
        topCompacted: templateSnapshot.fit.topCompacted,
        bottomCompacted: templateSnapshot.fit.bottomCompacted
      }
    )
  };
}
