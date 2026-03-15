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
  return clamp(value, 0.7, 1.9);
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
    version: "scene-autofit-v7",
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

function hasManualScaleOverride(scale: number): boolean {
  return Math.abs(scale - 1) > 0.001;
}

function ensureManualFit(
  node: HTMLParagraphElement,
  spec: MeasuredSlotSpec,
  manual: MeasuredSlotResult
): MeasuredSlotResult {
  let font = clamp(Math.round(manual.font), spec.minFont, spec.maxFont);
  let lineHeight = Number(clamp(manual.lineHeight, spec.lineHeightFloor, spec.lineHeightCeil).toFixed(3));
  let measurement = measureSlot(node, spec, font, lineHeight);

  while ((!fitsSlot(measurement, spec) || measurement.height > spec.height + 0.75) && font > spec.minFont) {
    font -= 1;
    measurement = measureSlot(node, spec, font, lineHeight);
  }

  while (
    (!fitsSlot(measurement, spec) || measurement.height > spec.height + 0.75) &&
    lineHeight > spec.lineHeightFloor
  ) {
    lineHeight = Number(Math.max(spec.lineHeightFloor, lineHeight - 0.01).toFixed(3));
    measurement = measureSlot(node, spec, font, lineHeight);
  }

  return { font, lineHeight };
}

function solveMeasuredSlot(node: HTMLParagraphElement, spec: MeasuredSlotSpec): MeasuredSlotResult {
  let low = spec.minFont;
  let high = spec.maxFont;
  let bestFont = spec.minFont;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const measurement = measureSlot(node, spec, mid, spec.baseLineHeight);
    if (fitsSlot(measurement, spec)) {
      bestFont = mid;
      low = mid + 1;
      continue;
    }
    high = mid - 1;
  }

  let font = clamp(Math.round(bestFont * spec.scale), spec.minFont, spec.maxFont);
  let lineHeight = spec.baseLineHeight;
  let measurement = measureSlot(node, spec, font, lineHeight);

  while (!fitsSlot(measurement, spec)) {
    if (measurement.lines <= spec.maxLines && lineHeight > spec.lineHeightFloor) {
      const nextLineHeight = Number(Math.max(spec.lineHeightFloor, lineHeight - 0.01).toFixed(3));
      if (nextLineHeight < lineHeight) {
        const tighterMeasurement = measureSlot(node, spec, font, nextLineHeight);
        if (tighterMeasurement.height < measurement.height) {
          lineHeight = nextLineHeight;
          measurement = tighterMeasurement;
          continue;
        }
      }
    }
    if (font <= spec.minFont) {
      break;
    }
    font -= 1;
    measurement = measureSlot(node, spec, font, lineHeight);
  }

  if (spec.scale >= 0.999) {
    const targetMinHeight = spec.height * spec.fillTargetMin;
    const targetMaxHeight = spec.height * spec.fillTargetMax;
    let iterations = 0;

    while (measurement.height < targetMinHeight && iterations < 48) {
      iterations += 1;
      const nextFont = font + 1;
      const canGrowFont = nextFont <= spec.maxFont;
      if (canGrowFont) {
        const fontMeasurement = measureSlot(node, spec, nextFont, lineHeight);
        if (fitsSlot(fontMeasurement, spec) && fontMeasurement.height <= spec.height + 0.75) {
          font = nextFont;
          measurement = fontMeasurement;
          continue;
        }
      }

      const nextLineHeight = Number(Math.min(spec.lineHeightCeil, lineHeight + 0.01).toFixed(3));
      if (nextLineHeight <= lineHeight) {
        break;
      }
      const lineMeasurement = measureSlot(node, spec, font, nextLineHeight);
      if (fitsSlot(lineMeasurement, spec) && lineMeasurement.height <= targetMaxHeight + 1) {
        lineHeight = nextLineHeight;
        measurement = lineMeasurement;
        continue;
      }
      break;
    }

    while ((measurement.height > spec.height + 0.75 || measurement.lines > spec.maxLines) && lineHeight > spec.lineHeightFloor) {
      lineHeight = Number(Math.max(spec.lineHeightFloor, lineHeight - 0.01).toFixed(3));
      measurement = measureSlot(node, spec, font, lineHeight);
    }
  }

  const safeHeight = spec.height * 0.965;
  while ((measurement.height > safeHeight || measurement.lines > spec.maxLines) && font > spec.minFont) {
    font -= 1;
    measurement = measureSlot(node, spec, font, lineHeight);
  }

  while ((measurement.height > safeHeight || measurement.lines > spec.maxLines) && lineHeight > spec.lineHeightFloor) {
    lineHeight = Number(Math.max(spec.lineHeightFloor, lineHeight - 0.01).toFixed(3));
    measurement = measureSlot(node, spec, font, lineHeight);
  }

  return {
    font,
    lineHeight
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
    fillTargetMin: isScienceCardV1 ? 0.96 : template.typography.top.fillTargetMin ?? 0.88,
    fillTargetMax: isScienceCardV1 ? 0.99 : template.typography.top.fillTargetMax ?? 0.94,
    fontFamily: getTopFontFamily(templateId),
    fontWeight: template.typography.top.weight ?? (templateId === TURBO_FACE_TEMPLATE_ID ? 850 : 800),
    fontStyle: template.typography.top.fontStyle ?? "normal",
    letterSpacing: template.typography.top.letterSpacing ?? "-0.015em",
    textAlign: "center",
    scale: topScale,
    lineHeightFloor: isScienceCardV1
      ? 0.94
      : Math.max(topFigmaLineHeight, Math.max(0.84, Number((baseComputed.topLineHeight - 0.08).toFixed(3)))),
    lineHeightCeil: isScienceCardV1
      ? 1.04
      : Math.min(1.22, Number((baseComputed.topLineHeight + 0.08).toFixed(3)))
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
    fillTargetMin: isScienceCardV1 ? 0.86 : template.typography.bottom.fillTargetMin ?? 0.84,
    fillTargetMax: isScienceCardV1 ? 0.92 : template.typography.bottom.fillTargetMax ?? 0.9,
    fontFamily: getBottomFontFamily(templateId),
    fontWeight: template.typography.bottom.weight ?? 500,
    fontStyle: template.typography.bottom.fontStyle ?? "normal",
    letterSpacing: template.typography.bottom.letterSpacing ?? "0",
    textAlign: "left",
    scale: bottomScale,
    lineHeightFloor: isScienceCardV1
      ? 0.96
      : bottomScale > 1.05
        ? Math.max(0.78, Number((baseComputed.bottomLineHeight - 0.22).toFixed(3)))
        : Math.max(0.92, Number((baseComputed.bottomLineHeight - 0.08).toFixed(3))),
    lineHeightCeil: isScienceCardV1
      ? 1.12
      : Math.min(1.32, Number((baseComputed.bottomLineHeight + 0.08).toFixed(3)))
  };

  const topResult = hasManualScaleOverride(topScale)
    ? ensureManualFit(topMeasureNode, topSpec, {
        font: baseComputed.topFont,
        lineHeight: baseComputed.topLineHeight
      })
    : solveMeasuredSlot(topMeasureNode, topSpec);
  const bottomResult = bottomScale > 1.05
    ? solveMeasuredSlot(bottomMeasureNode, bottomSpec)
    : hasManualScaleOverride(bottomScale)
    ? ensureManualFit(bottomMeasureNode, bottomSpec, {
        font: baseComputed.bottomFont,
        lineHeight: baseComputed.bottomLineHeight
      })
    : solveMeasuredSlot(bottomMeasureNode, bottomSpec);

  return {
    ...baseComputed,
    topFont: topResult.font,
    topLineHeight: topResult.lineHeight,
    bottomFont: bottomResult.font,
    bottomLineHeight: bottomResult.lineHeight
  };
}

function buildRenderedComputed(
  templateId: string,
  currentComputed: TemplateSceneComputed,
  sceneNode: HTMLDivElement
): TemplateSceneComputed | null {
  const template = getTemplateById(templateId);
  const topNode = sceneNode.querySelector('[data-template-slot="top-text"]') as HTMLParagraphElement | null;
  const bottomNode = sceneNode.querySelector('[data-template-slot="bottom-text"]') as HTMLParagraphElement | null;
  if (!topNode || !bottomNode) {
    return null;
  }

  const nextComputed = { ...currentComputed };
  let changed = false;

  const adjustRenderedSlot = (
    node: HTMLParagraphElement,
    fontKey: "topFont" | "bottomFont",
    lineHeightKey: "topLineHeight" | "bottomLineHeight",
    minFont: number,
    minLineHeight: number
  ) => {
    let font = nextComputed[fontKey];
    let lineHeight = nextComputed[lineHeightKey];
    let guard = 0;
    const parent = node.parentElement;
    const getNodeOverflowDelta = () => {
      return Math.max(
        node.scrollHeight - node.clientHeight,
        node.scrollWidth - node.clientWidth
      );
    };
    const getNodeOverflowAllowance = () => {
      const lineBoxHeight = Math.max(1, font * lineHeight);
      // WebKit line clamp often leaves a small scroll/client delta even when the
      // text is visually correct. Treat only a substantial fraction of a line box
      // as real clipping.
      return Math.max(8, lineBoxHeight * 0.45);
    };
    const hasOverflow = () => {
      if (!parent) {
        return getNodeOverflowDelta() > getNodeOverflowAllowance();
      }
      return (
        getNodeOverflowDelta() > getNodeOverflowAllowance() ||
        node.scrollHeight > parent.clientHeight + 1 ||
        node.scrollWidth > parent.clientWidth + 1
      );
    };

    while (hasOverflow() && guard < 64) {
      guard += 1;
      if (lineHeight > minLineHeight + 0.001) {
        lineHeight = Number(Math.max(minLineHeight, lineHeight - 0.01).toFixed(3));
        node.style.lineHeight = String(lineHeight);
        changed = true;
        continue;
      }

      if (font > minFont) {
        font -= 1;
        node.style.fontSize = `${font}px`;
        changed = true;
        continue;
      }

      break;
    }

    nextComputed[fontKey] = font;
    nextComputed[lineHeightKey] = lineHeight;
  };

  adjustRenderedSlot(
    topNode,
    "topFont",
    "topLineHeight",
    Math.max(14, Math.floor(template.typography.top.min * 0.58)),
    template.typography.top.lineHeight
  );
  adjustRenderedSlot(
    bottomNode,
    "bottomFont",
    "bottomLineHeight",
    Math.max(14, Math.floor(template.typography.bottom.min * 0.58)),
    template.typography.bottom.lineHeight
  );

  return changed ? nextComputed : null;
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
  const sceneRef = useRef<HTMLDivElement | null>(null);
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
    if (!ready || !sceneRef.current) {
      return;
    }

    const corrected = buildRenderedComputed(props.templateId, computed, sceneRef.current);
    if (!corrected) {
      return;
    }

    FIT_CACHE.set(cacheKey, corrected);
    setComputed(corrected);
  }, [cacheKey, computed, props.templateId, ready]);

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
        sceneRef={sceneRef}
        computedOverride={computed}
        sceneReady={ready}
      />
    </>
  );
}
