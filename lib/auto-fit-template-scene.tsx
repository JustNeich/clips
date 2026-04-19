"use client";

import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TemplateContentFixture } from "./template-calibration-types";
import {
  SCIENCE_CARD_TEMPLATE_ID,
  SCIENCE_CARD_BLUE_TEMPLATE_ID,
  SCIENCE_CARD_RED_TEMPLATE_ID,
  SCIENCE_CARD_GREEN_TEMPLATE_ID,
  SCIENCE_CARD_V7_TEMPLATE_ID,
  HEDGES_OF_HONOR_TEMPLATE_ID,
  Stage3TemplateConfig,
  isClassicScienceCardTemplateId,
  getTemplateById,
  getTemplateComputed,
  resolveScaledMaxLines
} from "./stage3-template";
import { getTemplateFigmaSpec } from "./stage3-template-spec";
import { buildTemplateRenderSnapshot, resolveTemplateChromeMetrics } from "./stage3-template-core";
import {
  ceilStage3TextFontPx,
  STAGE3_TEXT_SCALE_UI_MAX,
  STAGE3_TEXT_SCALE_UI_MIN,
  STAGE3_TEXT_FONT_STEP_PX,
  clampStage3TextScaleUi,
  getStage3TemplateTextFitPolicy,
  snapStage3TextFontPx
} from "./stage3-text-fit";
import { TemplateScene, type TemplateSceneProps } from "./template-scene";

type TemplateSceneComputed = ReturnType<typeof getTemplateComputed>;

export type MeasuredSlotSpec = {
  text: string;
  width: number;
  height: number;
  minFont: number;
  maxFont: number;
  preferredFont: number;
  maxLines: number;
  baseLineHeight: number;
  fillTargetMin: number;
  fillTargetMax: number;
  fontFamily: string;
  fontWeight: number;
  fontStyle: "normal" | "italic";
  letterSpacing: string;
  textAlign: "center" | "left";
  scale: number;
  lineHeightFloor: number;
  lineHeightCeil: number;
};

export type MeasuredSlotResult = {
  font: number;
  lineHeight: number;
};

const FIT_CACHE = new Map<string, TemplateSceneComputed>();
const FIT_CACHE_MAX_ENTRIES = 120;
const MAX_FONT_REFINEMENT_STEPS = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeScale(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  return clampStage3TextScaleUi(value);
}

function getBottomTextPaddingTop(templateConfig: Stage3TemplateConfig): number {
  return templateConfig.slot.bottomTextPaddingTop ?? templateConfig.slot.bottomTextPaddingY;
}

function getBottomTextPaddingBottom(templateConfig: Stage3TemplateConfig): number {
  return templateConfig.slot.bottomTextPaddingBottom ?? templateConfig.slot.bottomTextPaddingY;
}

function getBottomTextPaddingLeft(templateConfig: Stage3TemplateConfig): number {
  return templateConfig.slot.bottomTextPaddingLeft ?? templateConfig.slot.bottomTextPaddingX;
}

function getBottomTextPaddingRight(templateConfig: Stage3TemplateConfig): number {
  return templateConfig.slot.bottomTextPaddingRight ?? templateConfig.slot.bottomTextPaddingX;
}

function getSectionBorderLosses(templateId: string): {
  topWidth: number;
  topHeight: number;
  bottomWidth: number;
  bottomHeight: number;
} {
  if (
    templateId === SCIENCE_CARD_TEMPLATE_ID ||
    templateId === SCIENCE_CARD_BLUE_TEMPLATE_ID ||
    templateId === SCIENCE_CARD_RED_TEMPLATE_ID ||
    templateId === SCIENCE_CARD_GREEN_TEMPLATE_ID
  ) {
    return {
      topWidth: 0,
      topHeight: 0,
      bottomWidth: 0,
      bottomHeight: 0
    };
  }
  return {
    topWidth: 0,
    topHeight: 0,
    bottomWidth: 0,
    bottomHeight: 0
  };
}

function getTopFontFamily(templateId: string, templateConfig: Stage3TemplateConfig): string {
  if (templateConfig.typography.top.fontFamily) {
    return templateConfig.typography.top.fontFamily;
  }
  if (templateId === SCIENCE_CARD_V7_TEMPLATE_ID || templateId === HEDGES_OF_HONOR_TEMPLATE_ID) {
    return '"Arial Rounded MT Bold",".SF NS Rounded","SF Pro Rounded","Helvetica Rounded","Arial",sans-serif';
  }
  return '"Inter","Helvetica Neue",Helvetica,sans-serif';
}

function getBottomFontFamily(templateId: string, templateConfig: Stage3TemplateConfig): string {
  if (templateConfig.typography.bottom.fontFamily) {
    return templateConfig.typography.bottom.fontFamily;
  }
  if (templateId === SCIENCE_CARD_V7_TEMPLATE_ID || templateId === HEDGES_OF_HONOR_TEMPLATE_ID) {
    return '".SF NS Rounded","SF Pro Rounded","Helvetica Rounded","Arial Rounded MT Bold","Arial",sans-serif';
  }
  return '"Inter","Helvetica Neue",Helvetica,sans-serif';
}

function getTopFontHeadroom(templateId: string): number {
  if (templateId === SCIENCE_CARD_V7_TEMPLATE_ID || templateId === HEDGES_OF_HONOR_TEMPLATE_ID) {
    return 1.04;
  }
  return 1.02;
}

function getBottomFontHeadroom(templateId: string): number {
  if (templateId === SCIENCE_CARD_V7_TEMPLATE_ID || templateId === HEDGES_OF_HONOR_TEMPLATE_ID) {
    return 1.04;
  }
  return 1.02;
}

function getScaleCeiling(scale: number, maxScaleBoost: number): number {
  return scale > 1 ? Math.min(scale, maxScaleBoost) : 1;
}

function buildCacheKey(
  templateId: string,
  content: TemplateContentFixture,
  baseComputed: TemplateSceneComputed,
  templateConfig: Stage3TemplateConfig
): string {
  return JSON.stringify({
    version: "scene-autofit-v10",
    templateId,
    topText: baseComputed.top,
    bottomText: baseComputed.bottom,
    topScale: normalizeScale(content.topFontScale),
    bottomScale: normalizeScale(content.bottomFontScale),
    topHeight: templateConfig.slot.topHeight,
    bottomHeight: templateConfig.slot.bottomHeight,
    bottomMetaHeight: templateConfig.slot.bottomMetaHeight,
    topPaddingX: templateConfig.slot.topPaddingX,
    topPaddingTop: templateConfig.slot.topPaddingTop ?? templateConfig.slot.topPaddingY,
    topPaddingBottom: templateConfig.slot.topPaddingBottom ?? templateConfig.slot.topPaddingY,
    bottomTextPaddingLeft: getBottomTextPaddingLeft(templateConfig),
    bottomTextPaddingRight: getBottomTextPaddingRight(templateConfig),
    bottomTextPaddingTop: getBottomTextPaddingTop(templateConfig),
    bottomTextPaddingBottom: getBottomTextPaddingBottom(templateConfig),
    topTypography: templateConfig.typography.top,
    bottomTypography: templateConfig.typography.bottom
  });
}

function applyMeasurementStyle(node: HTMLParagraphElement, spec: MeasuredSlotSpec, font: number, lineHeight: number) {
  node.textContent = spec.text;
  node.style.width = `${spec.width}px`;
  node.style.margin = "0";
  node.style.padding = "0";
  node.style.position = "relative";
  node.style.display = "block";
  node.style.whiteSpace = "normal";
  node.style.wordBreak = "normal";
  node.style.overflowWrap = "break-word";
  node.style.fontFamily = spec.fontFamily;
  node.style.fontWeight = String(spec.fontWeight);
  node.style.fontStyle = spec.fontStyle;
  node.style.letterSpacing = spec.letterSpacing;
  node.style.fontSize = `${font}px`;
  node.style.lineHeight = String(lineHeight);
  node.style.textAlign = spec.textAlign;
}

function measureSlot(node: HTMLParagraphElement, spec: MeasuredSlotSpec, font: number, lineHeight: number) {
  applyMeasurementStyle(node, spec, font, lineHeight);
  const measuredHeight = node.getBoundingClientRect().height;
  const lineBoxHeight = Math.max(1, font * lineHeight);
  const measuredLines = Math.max(1, Math.round(measuredHeight / lineBoxHeight));
  return {
    height: measuredHeight,
    lines: measuredLines
  };
}

function fitsSlot(
  measurement: ReturnType<typeof measureSlot>,
  spec: MeasuredSlotSpec
): boolean {
  return measurement.height <= spec.height + 0.75 && measurement.lines <= spec.maxLines;
}

function normalizeScalePreference(scale: number): number {
  if (STAGE3_TEXT_SCALE_UI_MAX <= STAGE3_TEXT_SCALE_UI_MIN) {
    return 0.5;
  }
  const clamped = clampStage3TextScaleUi(scale);
  if (clamped <= 1) {
    return clamp((clamped - STAGE3_TEXT_SCALE_UI_MIN) / Math.max(0.0001, 1 - STAGE3_TEXT_SCALE_UI_MIN), 0, 1) * 0.5;
  }
  return 0.5 + clamp((clamped - 1) / Math.max(0.0001, STAGE3_TEXT_SCALE_UI_MAX - 1), 0, 1) * 0.5;
}

function resolveAdaptiveBottomLineHeightFloor(baseLineHeight: number, scale: number): number {
  const progress = clamp((scale - 1.02) / 0.16, 0, 1);
  const reduction = 0.08 + (0.22 - 0.08) * progress;
  return Math.max(0.78, Number((baseLineHeight - reduction).toFixed(3)));
}

function snapLineHeight(value: number): number {
  return Number(value.toFixed(3));
}

function buildLineHeightCandidates(spec: MeasuredSlotSpec): number[] {
  const candidates = new Set<number>();
  const midpoint = snapLineHeight((spec.lineHeightFloor + spec.lineHeightCeil) / 2);
  const base = clamp(spec.baseLineHeight, spec.lineHeightFloor, spec.lineHeightCeil);
  const offsets = [-0.04, -0.02, 0, 0.02, 0.04];

  candidates.add(spec.lineHeightFloor);
  candidates.add(spec.lineHeightCeil);
  candidates.add(midpoint);
  candidates.add(snapLineHeight(base));
  candidates.add(snapLineHeight((spec.lineHeightFloor + base) / 2));
  candidates.add(snapLineHeight((spec.lineHeightCeil + base) / 2));

  for (const offset of offsets) {
    candidates.add(snapLineHeight(clamp(base + offset, spec.lineHeightFloor, spec.lineHeightCeil)));
  }

  return [...candidates].sort((left, right) => left - right);
}

function getFontStepBounds(spec: MeasuredSlotSpec): { minStep: number; maxStep: number } {
  return {
    minStep: Math.round(spec.minFont / STAGE3_TEXT_FONT_STEP_PX),
    maxStep: Math.round(spec.maxFont / STAGE3_TEXT_FONT_STEP_PX)
  };
}

type SlotMeasurement = ReturnType<typeof measureSlot>;
type SlotMeasureFn = (font: number, lineHeight: number) => SlotMeasurement;

function findMaxFittingFontStep(
  spec: MeasuredSlotSpec,
  lineHeight: number,
  safeHeight: number,
  measure: SlotMeasureFn
): { step: number; measurement: SlotMeasurement } | null {
  const { minStep, maxStep } = getFontStepBounds(spec);
  let low = minStep;
  let high = maxStep;
  let best: { step: number; measurement: SlotMeasurement } | null = null;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const font = Number((mid * STAGE3_TEXT_FONT_STEP_PX).toFixed(2));
    const measurement = measure(font, lineHeight);
    const fits = fitsSlot(measurement, spec) && measurement.height <= safeHeight;
    if (fits) {
      best = { step: mid, measurement };
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}

export function solveMeasuredSlotForMeasurements(
  spec: MeasuredSlotSpec,
  measure: SlotMeasureFn
): MeasuredSlotResult {
  const scalePreference = normalizeScalePreference(spec.scale);
  const targetFill =
    spec.fillTargetMin + (spec.fillTargetMax - spec.fillTargetMin) * scalePreference;
  const safeHeight = spec.height * 0.98;
  const candidates: Array<{
    font: number;
    lineHeight: number;
    fill: number;
    baseScore: number;
  }> = [];

  for (const lineHeight of buildLineHeightCandidates(spec)) {
    const maxFit = findMaxFittingFontStep(spec, lineHeight, safeHeight, measure);
    if (!maxFit) {
      continue;
    }
    const { minStep } = getFontStepBounds(spec);
    const refinementStart = Math.max(minStep, maxFit.step - MAX_FONT_REFINEMENT_STEPS);
    for (let step = refinementStart; step <= maxFit.step; step += 1) {
      const font = Number((step * STAGE3_TEXT_FONT_STEP_PX).toFixed(2));
      const measurement = step === maxFit.step ? maxFit.measurement : measure(font, lineHeight);
      if (!fitsSlot(measurement, spec) || measurement.height > safeHeight) {
        continue;
      }

      const fill = clamp(measurement.height / Math.max(1, spec.height), 0, 1.2);
      const baseScore =
        Math.abs(fill - targetFill) * 100 +
        Math.max(0, targetFill - fill) * 22 +
        Math.abs(lineHeight - spec.baseLineHeight) * 4 +
        (spec.maxFont - font) / Math.max(1, spec.maxFont - spec.minFont + 1);
      candidates.push({
        font,
        lineHeight,
        fill,
        baseScore
      });
    }
  }

  if (candidates.length > 0) {
    let bestCandidate:
      | {
          font: number;
          lineHeight: number;
          fill: number;
          score: number;
        }
      | null = null;

    for (const candidate of candidates) {
      const score =
        candidate.baseScore +
        Math.abs(candidate.font - spec.preferredFont) * 6 +
        Math.abs(candidate.fill - targetFill) * Math.max(0, scalePreference - 0.5) * 8;

      if (
        !bestCandidate ||
        score < bestCandidate.score - 0.0001 ||
        (Math.abs(score - bestCandidate.score) <= 0.0001 &&
          (candidate.fill > bestCandidate.fill + 0.0001 ||
            (Math.abs(candidate.fill - bestCandidate.fill) <= 0.0001 && candidate.font > bestCandidate.font)))
      ) {
        bestCandidate = {
          font: candidate.font,
          lineHeight: candidate.lineHeight,
          fill: candidate.fill,
          score
        };
      }
    }

    if (bestCandidate) {
      return {
        font: bestCandidate.font,
        lineHeight: bestCandidate.lineHeight
      };
    }
  }

  return {
    font: spec.minFont,
    lineHeight: spec.baseLineHeight
  };
}

function solveMeasuredSlot(node: HTMLParagraphElement, spec: MeasuredSlotSpec): MeasuredSlotResult {
  return solveMeasuredSlotForMeasurements(spec, (font, lineHeight) => measureSlot(node, spec, font, lineHeight));
}

function readFitCache(key: string): TemplateSceneComputed | null {
  const cached = FIT_CACHE.get(key);
  if (!cached) {
    return null;
  }
  FIT_CACHE.delete(key);
  FIT_CACHE.set(key, cached);
  return cached;
}

function writeFitCache(key: string, computed: TemplateSceneComputed): void {
  if (FIT_CACHE.has(key)) {
    FIT_CACHE.delete(key);
  }
  FIT_CACHE.set(key, computed);
  while (FIT_CACHE.size > FIT_CACHE_MAX_ENTRIES) {
    const oldestKey = FIT_CACHE.keys().next().value;
    if (!oldestKey) {
      break;
    }
    FIT_CACHE.delete(oldestKey);
  }
}

function buildMeasuredComputed(
  templateId: string,
  templateConfig: Stage3TemplateConfig,
  content: TemplateContentFixture,
  baseComputed: TemplateSceneComputed,
  renderSnapshot: ReturnType<typeof buildTemplateRenderSnapshot>,
  topMeasureNode: HTMLParagraphElement,
  bottomMeasureNode: HTMLParagraphElement
): TemplateSceneComputed {
  const templateSpec = getTemplateFigmaSpec(templateId);
  const chromeMetrics = resolveTemplateChromeMetrics(templateId, templateConfig, templateSpec);
  const fitPolicy = getStage3TemplateTextFitPolicy(templateId);
  const layout = renderSnapshot.layout;
  const topScale = normalizeScale(content.topFontScale);
  const bottomScale = normalizeScale(content.bottomFontScale);
  const topFigmaFont = templateSpec.typography?.topText?.fontSize ?? baseComputed.topFont;
  const usesClassicScienceCardChrome = isClassicScienceCardTemplateId(templateId);
  const topFigmaLineHeight = Number(
    (
      (templateSpec.typography?.topText?.lineHeightPx ?? topFigmaFont * baseComputed.topLineHeight) /
      Math.max(1, topFigmaFont)
    ).toFixed(3)
  );
  const bottomFigmaFont = templateSpec.typography?.bottomText?.fontSize ?? baseComputed.bottomFont;
  const scienceCardPreferredTopLineHeight = 1;
  const topPaddingTop = chromeMetrics.topPaddingTop;
  const topPaddingBottom = chromeMetrics.topPaddingBottom;
  const sectionBorderLosses = getSectionBorderLosses(templateId);
  const usesWideHeadlineScaling =
    templateId === SCIENCE_CARD_V7_TEMPLATE_ID || templateId === HEDGES_OF_HONOR_TEMPLATE_ID;
  const usesChannelStoryLayout = templateConfig.layoutKind === "channel_story";

  const topSpec: MeasuredSlotSpec = {
    text: baseComputed.top,
    width: usesChannelStoryLayout
      ? layout.top.width
      : layout.top.width - sectionBorderLosses.topWidth - chromeMetrics.topPaddingX * 2,
    height: usesChannelStoryLayout
      ? layout.top.height
      : layout.top.height - sectionBorderLosses.topHeight - topPaddingTop - topPaddingBottom,
    minFont: ceilStage3TextFontPx(Math.max(14, Math.floor(templateConfig.typography.top.min * 0.58))),
    maxFont: Math.max(
      topFigmaFont,
      templateConfig.typography.top.max,
      snapStage3TextFontPx(
        templateConfig.typography.top.max *
          getTopFontHeadroom(templateId) *
          getScaleCeiling(topScale, usesWideHeadlineScaling ? 1.24 : 1.18)
      )
    ),
    preferredFont: baseComputed.topFont,
    maxLines: resolveScaledMaxLines(templateConfig.typography.top.maxLines, topScale, "top"),
    baseLineHeight: usesClassicScienceCardChrome ? scienceCardPreferredTopLineHeight : baseComputed.topLineHeight,
    fillTargetMin: fitPolicy.topFillTargetMin,
    fillTargetMax: fitPolicy.topFillTargetMax,
    fontFamily: getTopFontFamily(templateId, templateConfig),
    fontWeight: templateConfig.typography.top.weight ?? 800,
    fontStyle: templateConfig.typography.top.fontStyle ?? "normal",
    letterSpacing: templateConfig.typography.top.letterSpacing ?? "-0.015em",
    textAlign: "center",
    scale: topScale,
    lineHeightFloor: Math.max(
      fitPolicy.topLineHeightFloor,
      usesClassicScienceCardChrome
        ? fitPolicy.topLineHeightFloor
        : Math.max(topFigmaLineHeight, Math.max(0.84, Number((baseComputed.topLineHeight - 0.08).toFixed(3))))
    ),
    lineHeightCeil: Math.min(
      fitPolicy.topLineHeightCeil,
      usesClassicScienceCardChrome
        ? fitPolicy.topLineHeightCeil
        : Math.min(1.22, Number((baseComputed.topLineHeight + 0.08).toFixed(3)))
    )
  };
  if (topScale < 1) {
    topSpec.maxFont = Math.min(topSpec.maxFont, Math.max(topSpec.minFont, baseComputed.topFont));
  }

  const bottomBodyHeight = Math.max(
    80,
    layout.bottom.height - sectionBorderLosses.bottomHeight - layout.author.height
  );
  const bottomSpec: MeasuredSlotSpec = {
    text: baseComputed.bottom,
    width: layout.bottomText.width,
    height: layout.bottomText.height,
    minFont: ceilStage3TextFontPx(Math.max(14, Math.floor(templateConfig.typography.bottom.min * 0.58))),
    maxFont: Math.max(
      bottomFigmaFont,
      templateConfig.typography.bottom.max,
      snapStage3TextFontPx(
        templateConfig.typography.bottom.max *
          getBottomFontHeadroom(templateId) *
          getScaleCeiling(bottomScale, usesWideHeadlineScaling ? 1.4 : 1.3)
      )
    ),
    preferredFont: baseComputed.bottomFont,
    maxLines: resolveScaledMaxLines(templateConfig.typography.bottom.maxLines, bottomScale, "bottom"),
    baseLineHeight: usesClassicScienceCardChrome ? baseComputed.bottomLineHeight : baseComputed.bottomLineHeight,
    fillTargetMin: fitPolicy.bottomFillTargetMin,
    fillTargetMax: fitPolicy.bottomFillTargetMax,
    fontFamily: getBottomFontFamily(templateId, templateConfig),
    fontWeight: templateConfig.typography.bottom.weight ?? 500,
    fontStyle: templateConfig.typography.bottom.fontStyle ?? "normal",
    letterSpacing: templateConfig.typography.bottom.letterSpacing ?? "0",
    textAlign: "left",
    scale: bottomScale,
    lineHeightFloor: Math.max(
      fitPolicy.bottomLineHeightFloor,
      usesClassicScienceCardChrome
        ? fitPolicy.bottomLineHeightFloor
        : Math.max(0.92, resolveAdaptiveBottomLineHeightFloor(baseComputed.bottomLineHeight, bottomScale))
    ),
    lineHeightCeil: Math.min(
      fitPolicy.bottomLineHeightCeil,
      usesClassicScienceCardChrome
        ? fitPolicy.bottomLineHeightCeil
        : Math.min(1.32, Number((baseComputed.bottomLineHeight + 0.08).toFixed(3)))
    )
  };
  if (bottomScale < 1) {
    bottomSpec.maxFont = Math.min(
      bottomSpec.maxFont,
      Math.max(bottomSpec.minFont, baseComputed.bottomFont)
    );
  }

  const topResult =
    topSpec.height <= 1 || !topSpec.text.trim()
      ? {
          font: baseComputed.topFont,
          lineHeight: baseComputed.topLineHeight
        }
      : solveMeasuredSlot(topMeasureNode, topSpec);
  const bottomResult = solveMeasuredSlot(bottomMeasureNode, bottomSpec);

  return {
    ...baseComputed,
    topFont: topResult.font,
    topLineHeight: topResult.lineHeight,
    bottomFont: bottomResult.font,
    bottomLineHeight: bottomResult.lineHeight
  };
}

export function AutoFitTemplateScene(props: TemplateSceneProps): React.JSX.Element {
  const onComputedChange = props.onComputedChange;
  const templateConfig = useMemo(
    () => props.templateConfigOverride ?? getTemplateById(props.templateId),
    [props.templateConfigOverride, props.templateId]
  );
  const renderSnapshot = useMemo(
    () =>
      props.snapshot ??
      buildTemplateRenderSnapshot({
        templateId: props.templateId,
        content: props.content,
        templateConfigOverride: templateConfig
      }),
    [props.content, props.snapshot, props.templateId, templateConfig]
  );

  const effectiveContent = renderSnapshot.content;
  const baseComputed = useMemo(
    () => renderSnapshot.computed,
    [renderSnapshot]
  );

  const cacheKey = useMemo(
    () =>
      `${renderSnapshot.snapshotHash}:${buildCacheKey(
        props.templateId,
        effectiveContent,
        baseComputed,
        templateConfig
      )}`,
    [
      baseComputed,
      effectiveContent,
      props.templateId,
      renderSnapshot.snapshotHash,
      templateConfig
    ]
  );

  const topMeasureRef = useRef<HTMLParagraphElement | null>(null);
  const bottomMeasureRef = useRef<HTMLParagraphElement | null>(null);
  const publishedComputedKeyRef = useRef<string>("");
  const [computed, setComputed] = useState<TemplateSceneComputed>(() => FIT_CACHE.get(cacheKey) ?? baseComputed);
  const [ready, setReady] = useState<boolean>(() => FIT_CACHE.has(cacheKey));

  useLayoutEffect(() => {
    const cached = readFitCache(cacheKey);
    if (cached) {
      setComputed(cached);
      setReady(true);
      return;
    }

    if (!topMeasureRef.current || !bottomMeasureRef.current) {
      setComputed(baseComputed);
      setReady(false);
      return;
    }

    let cancelled = false;

    const runMeasurement = () => {
      if (cancelled || !topMeasureRef.current || !bottomMeasureRef.current) {
        return;
      }
      const nextComputed = buildMeasuredComputed(
        props.templateId,
        templateConfig,
        effectiveContent,
        baseComputed,
        renderSnapshot,
        topMeasureRef.current,
        bottomMeasureRef.current
      );
      writeFitCache(cacheKey, nextComputed);
      if (!cancelled) {
        setComputed(nextComputed);
        setReady(true);
      }
    };

    setComputed(baseComputed);
    setReady(false);
    runMeasurement();
    void document.fonts?.ready?.then(() => {
      runMeasurement();
    });

    return () => {
      cancelled = true;
    };
  }, [
    baseComputed,
    cacheKey,
    effectiveContent,
    props.templateId,
    renderSnapshot,
    templateConfig
  ]);

  useLayoutEffect(() => {
    if (!ready || !onComputedChange) {
      return;
    }
    const publishedKey = JSON.stringify({
      snapshotHash: renderSnapshot.snapshotHash,
      topText: computed.top,
      bottomText: computed.bottom,
      topFont: computed.topFont,
      bottomFont: computed.bottomFont,
      topLineHeight: computed.topLineHeight,
      bottomLineHeight: computed.bottomLineHeight,
      topLines: computed.topLines,
      bottomLines: computed.bottomLines,
      topCompacted: computed.topCompacted,
      bottomCompacted: computed.bottomCompacted
    });
    if (publishedComputedKeyRef.current === publishedKey) {
      return;
    }
    publishedComputedKeyRef.current = publishedKey;
    onComputedChange(computed);
  }, [computed, onComputedChange, ready, renderSnapshot.snapshotHash]);

  return (
    <>
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          left: -100000,
          top: 0,
          visibility: "hidden",
          pointerEvents: "none",
          contain: "layout style paint"
        }}
      >
        <p ref={topMeasureRef} />
        <p ref={bottomMeasureRef} />
      </div>
      <TemplateScene
        {...props}
        content={effectiveContent}
        snapshot={renderSnapshot}
        templateConfigOverride={templateConfig}
        computedOverride={computed}
        sceneReady={ready}
      />
    </>
  );
}
