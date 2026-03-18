"use client";

import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TemplateContentFixture } from "./template-calibration-types";
import {
  SCIENCE_CARD_TEMPLATE_ID,
  SCIENCE_CARD_V2_TEMPLATE_ID,
  TURBO_FACE_TEMPLATE_ID,
  getTemplateById,
  getTemplateComputed,
  resolveScaledMaxLines
} from "./stage3-template";
import { getTemplateFigmaSpec } from "./stage3-template-spec";
import { buildTemplateRenderSnapshot, resolveTemplateChromeMetrics } from "./stage3-template-core";
import {
  STAGE3_TEXT_SCALE_UI_MAX,
  STAGE3_TEXT_SCALE_UI_MIN,
  clampStage3TextScaleUi,
  getStage3TemplateTextFitPolicy
} from "./stage3-text-fit";
import { TemplateScene, type TemplateSceneProps } from "./template-scene";

type TemplateSceneComputed = ReturnType<typeof getTemplateComputed>;

type MeasuredSlotSpec = {
  text: string;
  width: number;
  height: number;
  minFont: number;
  maxFont: number;
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

type MeasuredSlotResult = {
  font: number;
  lineHeight: number;
};

const FIT_CACHE = new Map<string, TemplateSceneComputed>();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeScale(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  return clampStage3TextScaleUi(value);
}

function getBottomTextPaddingTop(templateId: string): number {
  const template = getTemplateById(templateId);
  return template.slot.bottomTextPaddingTop ?? template.slot.bottomTextPaddingY;
}

function getBottomTextPaddingBottom(templateId: string): number {
  const template = getTemplateById(templateId);
  return template.slot.bottomTextPaddingBottom ?? template.slot.bottomTextPaddingY;
}

function getBottomTextPaddingLeft(templateId: string): number {
  const template = getTemplateById(templateId);
  return template.slot.bottomTextPaddingLeft ?? template.slot.bottomTextPaddingX;
}

function getBottomTextPaddingRight(templateId: string): number {
  const template = getTemplateById(templateId);
  return template.slot.bottomTextPaddingRight ?? template.slot.bottomTextPaddingX;
}

function getSectionBorderLosses(templateId: string): {
  topWidth: number;
  topHeight: number;
  bottomWidth: number;
  bottomHeight: number;
} {
  if (templateId === "science-card-v1") {
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

function getTopFontFamily(templateId: string): string {
  if (templateId === TURBO_FACE_TEMPLATE_ID) {
    return '"Arial Black","Arial",sans-serif';
  }
  return '"Inter","Helvetica Neue",Helvetica,sans-serif';
}

function getBottomFontFamily(templateId: string): string {
  if (templateId === TURBO_FACE_TEMPLATE_ID) {
    return '"Arial","Helvetica Neue",Helvetica,sans-serif';
  }
  return '"Inter","Helvetica Neue",Helvetica,sans-serif';
}

function getTopFontHeadroom(templateId: string): number {
  if (templateId === TURBO_FACE_TEMPLATE_ID) {
    return 1.08;
  }
  if (templateId === SCIENCE_CARD_V2_TEMPLATE_ID) {
    return 1.04;
  }
  return 1.02;
}

function getBottomFontHeadroom(templateId: string): number {
  if (templateId === TURBO_FACE_TEMPLATE_ID) {
    return 1.08;
  }
  return 1.02;
}

function getScaleCeiling(scale: number, maxScaleBoost: number): number {
  return scale > 1 ? Math.min(scale, maxScaleBoost) : 1;
}

function buildCacheKey(templateId: string, content: TemplateContentFixture, baseComputed: TemplateSceneComputed): string {
  const template = getTemplateById(templateId);
  return JSON.stringify({
    version: "scene-autofit-v8",
    templateId,
    topText: baseComputed.top,
    bottomText: baseComputed.bottom,
    topScale: normalizeScale(content.topFontScale),
    bottomScale: normalizeScale(content.bottomFontScale),
    topHeight: template.slot.topHeight,
    bottomHeight: template.slot.bottomHeight,
    bottomMetaHeight: template.slot.bottomMetaHeight,
    topPaddingX: template.slot.topPaddingX,
    topPaddingTop: template.slot.topPaddingTop ?? template.slot.topPaddingY,
    topPaddingBottom: template.slot.topPaddingBottom ?? template.slot.topPaddingY,
    bottomTextPaddingLeft: getBottomTextPaddingLeft(templateId),
    bottomTextPaddingRight: getBottomTextPaddingRight(templateId),
    bottomTextPaddingTop: getBottomTextPaddingTop(templateId),
    bottomTextPaddingBottom: getBottomTextPaddingBottom(templateId),
    topTypography: template.typography.top,
    bottomTypography: template.typography.bottom
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

function solveMeasuredSlot(node: HTMLParagraphElement, spec: MeasuredSlotSpec): MeasuredSlotResult {
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

  for (let font = spec.minFont; font <= spec.maxFont; font += 1) {
    for (
      let lineHeight = spec.lineHeightFloor;
      lineHeight <= spec.lineHeightCeil + 0.0001;
      lineHeight = Number((lineHeight + 0.01).toFixed(3))
    ) {
      const measurement = measureSlot(node, spec, font, lineHeight);
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
    const minCandidateFont = Math.min(...candidates.map((candidate) => candidate.font));
    const maxCandidateFont = Math.max(...candidates.map((candidate) => candidate.font));
    let bestCandidate:
      | {
          font: number;
          lineHeight: number;
          fill: number;
          score: number;
        }
      | null = null;

    for (const candidate of candidates) {
      const fontPosition =
        maxCandidateFont <= minCandidateFont
          ? 0.5
          : (candidate.font - minCandidateFont) / (maxCandidateFont - minCandidateFont);
      const score = candidate.baseScore + Math.abs(fontPosition - scalePreference) * 18;

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

function buildMeasuredComputed(
  templateId: string,
  content: TemplateContentFixture,
  baseComputed: TemplateSceneComputed,
  renderSnapshot: ReturnType<typeof buildTemplateRenderSnapshot>,
  topMeasureNode: HTMLParagraphElement,
  bottomMeasureNode: HTMLParagraphElement
): TemplateSceneComputed {
  const template = getTemplateById(templateId);
  const templateSpec = getTemplateFigmaSpec(templateId);
  const chromeMetrics = resolveTemplateChromeMetrics(templateId, template, templateSpec);
  const fitPolicy = getStage3TemplateTextFitPolicy(templateId);
  const layout = renderSnapshot.layout;
  const topScale = normalizeScale(content.topFontScale);
  const bottomScale = normalizeScale(content.bottomFontScale);
  const topFigmaFont = templateSpec.typography?.topText?.fontSize ?? baseComputed.topFont;
  const isScienceCardV1 = templateId === SCIENCE_CARD_TEMPLATE_ID;
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

  const topSpec: MeasuredSlotSpec = {
    text: baseComputed.top,
    width: layout.top.width - sectionBorderLosses.topWidth - chromeMetrics.topPaddingX * 2,
    height: layout.top.height - sectionBorderLosses.topHeight - topPaddingTop - topPaddingBottom,
    minFont: Math.max(14, Math.floor(template.typography.top.min * 0.58)),
    maxFont: Math.max(
      topFigmaFont,
      template.typography.top.max,
      Math.round(
        template.typography.top.max *
          getTopFontHeadroom(templateId) *
          getScaleCeiling(topScale, templateId === TURBO_FACE_TEMPLATE_ID ? 1.35 : 1.18)
      )
    ),
    maxLines: resolveScaledMaxLines(template.typography.top.maxLines, topScale, "top"),
    baseLineHeight: isScienceCardV1 ? scienceCardPreferredTopLineHeight : baseComputed.topLineHeight,
    fillTargetMin: fitPolicy.topFillTargetMin,
    fillTargetMax: fitPolicy.topFillTargetMax,
    fontFamily: getTopFontFamily(templateId),
    fontWeight: template.typography.top.weight ?? (templateId === TURBO_FACE_TEMPLATE_ID ? 850 : 800),
    fontStyle: template.typography.top.fontStyle ?? "normal",
    letterSpacing: template.typography.top.letterSpacing ?? "-0.015em",
    textAlign: "center",
    scale: topScale,
    lineHeightFloor: Math.max(
      fitPolicy.topLineHeightFloor,
      isScienceCardV1
        ? fitPolicy.topLineHeightFloor
        : Math.max(topFigmaLineHeight, Math.max(0.84, Number((baseComputed.topLineHeight - 0.08).toFixed(3))))
    ),
    lineHeightCeil: Math.min(
      fitPolicy.topLineHeightCeil,
      isScienceCardV1
        ? fitPolicy.topLineHeightCeil
        : Math.min(1.22, Number((baseComputed.topLineHeight + 0.08).toFixed(3)))
    )
  };

  const bottomBodyHeight = Math.max(
    80,
    layout.bottom.height - sectionBorderLosses.bottomHeight - layout.author.height
  );
  const bottomSpec: MeasuredSlotSpec = {
    text: baseComputed.bottom,
    width: layout.bottomText.width,
    height: layout.bottomText.height,
    minFont: Math.max(14, Math.floor(template.typography.bottom.min * 0.58)),
    maxFont: Math.max(
      bottomFigmaFont,
      template.typography.bottom.max,
      Math.round(
        template.typography.bottom.max *
          getBottomFontHeadroom(templateId) *
          getScaleCeiling(bottomScale, templateId === TURBO_FACE_TEMPLATE_ID ? 1.6 : 1.3)
      )
    ),
    maxLines: resolveScaledMaxLines(template.typography.bottom.maxLines, bottomScale, "bottom"),
    baseLineHeight: isScienceCardV1 ? baseComputed.bottomLineHeight : baseComputed.bottomLineHeight,
    fillTargetMin: fitPolicy.bottomFillTargetMin,
    fillTargetMax: fitPolicy.bottomFillTargetMax,
    fontFamily: getBottomFontFamily(templateId),
    fontWeight: template.typography.bottom.weight ?? 500,
    fontStyle: template.typography.bottom.fontStyle ?? "normal",
    letterSpacing: template.typography.bottom.letterSpacing ?? "0",
    textAlign: "left",
    scale: bottomScale,
    lineHeightFloor: Math.max(
      fitPolicy.bottomLineHeightFloor,
      isScienceCardV1
        ? fitPolicy.bottomLineHeightFloor
        : bottomScale > 1.05
          ? Math.max(0.78, Number((baseComputed.bottomLineHeight - 0.22).toFixed(3)))
          : Math.max(0.92, Number((baseComputed.bottomLineHeight - 0.08).toFixed(3)))
    ),
    lineHeightCeil: Math.min(
      fitPolicy.bottomLineHeightCeil,
      isScienceCardV1
        ? fitPolicy.bottomLineHeightCeil
        : Math.min(1.32, Number((baseComputed.bottomLineHeight + 0.08).toFixed(3)))
    )
  };

  const topResult = solveMeasuredSlot(topMeasureNode, topSpec);
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
  const renderSnapshot = useMemo(
    () =>
      props.snapshot ??
      buildTemplateRenderSnapshot({
        templateId: props.templateId,
        content: props.content
      }),
    [props.content, props.snapshot, props.templateId]
  );

  const effectiveContent = renderSnapshot.content;
  const baseComputed = useMemo(
    () => renderSnapshot.computed,
    [renderSnapshot]
  );

  const cacheKey = useMemo(
    () => `${renderSnapshot.snapshotHash}:${buildCacheKey(props.templateId, effectiveContent, baseComputed)}`,
    [
      baseComputed,
      effectiveContent,
      props.templateId,
      renderSnapshot.snapshotHash
    ]
  );

  const topMeasureRef = useRef<HTMLParagraphElement | null>(null);
  const bottomMeasureRef = useRef<HTMLParagraphElement | null>(null);
  const publishedComputedKeyRef = useRef<string>("");
  const [computed, setComputed] = useState<TemplateSceneComputed>(() => FIT_CACHE.get(cacheKey) ?? baseComputed);
  const [ready, setReady] = useState<boolean>(() => FIT_CACHE.has(cacheKey));

  useLayoutEffect(() => {
    const cached = FIT_CACHE.get(cacheKey);
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
        effectiveContent,
        baseComputed,
        renderSnapshot,
        topMeasureRef.current,
        bottomMeasureRef.current
      );
      FIT_CACHE.set(cacheKey, nextComputed);
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
    renderSnapshot
  ]);

  useLayoutEffect(() => {
    if (!ready || !props.onComputedChange) {
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
    props.onComputedChange(computed);
  }, [computed, props.onComputedChange]);

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
        computedOverride={computed}
        sceneReady={ready}
      />
    </>
  );
}
