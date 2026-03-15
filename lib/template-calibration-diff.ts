import pixelmatch from "pixelmatch";
import type {
  TemplateCompareMode,
  TemplateCompareScope,
  TemplateContentFixture,
  TemplateDiffReport
} from "./template-calibration-types";
import { getTemplateSceneLayout } from "./template-scene";

type TemplateDiffImageSet = {
  current: ImageData;
  reference: ImageData;
  mask?: ImageData | null;
};

export const TEMPLATE_COMPARE_MODE_OPTIONS: Array<{
  value: TemplateCompareMode;
  label: string;
}> = [
  { value: "side-by-side", label: "Side by Side" },
  { value: "overlay", label: "Overlay" },
  { value: "difference", label: "Difference" },
  { value: "split-swipe", label: "Split Swipe" },
  { value: "heatmap", label: "Heatmap" }
];

export const TEMPLATE_COMPARE_SCOPE_OPTIONS: Array<{
  value: TemplateCompareScope;
  label: string;
}> = [
  { value: "full", label: "Full" },
  { value: "chrome-only", label: "Chrome Only" },
  { value: "top-only", label: "Top" },
  { value: "media-only", label: "Media" },
  { value: "bottom-only", label: "Bottom" },
  { value: "author-only", label: "Author" }
];

type TemplateDiffComputation = {
  diffImageData: ImageData;
  heatmapImageData: ImageData;
  report: TemplateDiffReport;
};

function pointInRect(x: number, y: number, rect: { x: number; y: number; width: number; height: number }): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}

function isMaskedIn(mask: ImageData | null | undefined, x: number, y: number): boolean {
  if (!mask) {
    return true;
  }
  const index = (y * mask.width + x) * 4 + 3;
  return (mask.data[index] ?? 0) > 0;
}

function buildScopePredicate(
  templateId: string,
  content: TemplateContentFixture,
  scope: TemplateCompareScope
): (x: number, y: number) => boolean {
  const layout = getTemplateSceneLayout(templateId, content);
  const { shell, top, media, bottom, author, avatar } = layout.regions;

  return (x: number, y: number) => {
    if (!pointInRect(x, y, shell)) {
      return false;
    }
    if (scope === "full") {
      return true;
    }
    if (scope === "chrome-only") {
      return !pointInRect(x, y, media) && !pointInRect(x, y, avatar);
    }
    if (scope === "top-only") {
      return pointInRect(x, y, top);
    }
    if (scope === "media-only") {
      return pointInRect(x, y, media);
    }
    if (scope === "bottom-only") {
      return pointInRect(x, y, bottom);
    }
    if (scope === "author-only") {
      return pointInRect(x, y, author);
    }
    return true;
  };
}

function buildMaskedImageData(
  source: ImageData,
  predicate: (x: number, y: number) => boolean,
  mask?: ImageData | null
): { imageData: ImageData; totalPixels: number } {
  const cloned = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
  let totalPixels = 0;

  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const inScope = predicate(x, y) && isMaskedIn(mask, x, y);
      const index = (y * source.width + x) * 4;
      if (!inScope) {
        cloned.data[index] = 0;
        cloned.data[index + 1] = 0;
        cloned.data[index + 2] = 0;
        cloned.data[index + 3] = 0;
        continue;
      }
      totalPixels += 1;
    }
  }

  return { imageData: cloned, totalPixels };
}

function buildHeatmapImageData(diffImageData: ImageData): ImageData {
  const heatmap = new ImageData(new Uint8ClampedArray(diffImageData.data), diffImageData.width, diffImageData.height);
  for (let index = 0; index < heatmap.data.length; index += 4) {
    const alpha = heatmap.data[index + 3] ?? 0;
    if (alpha === 0) {
      continue;
    }
    heatmap.data[index] = 255;
    heatmap.data[index + 1] = 76;
    heatmap.data[index + 2] = 111;
    heatmap.data[index + 3] = Math.max(alpha, 180);
  }
  return heatmap;
}

function runScopedDiff(
  templateId: string,
  content: TemplateContentFixture,
  scope: TemplateCompareScope,
  images: TemplateDiffImageSet
): {
  mismatchPixels: number;
  totalPixels: number;
  diffImageData: ImageData;
} {
  const predicate = buildScopePredicate(templateId, content, scope);
  const currentMasked = buildMaskedImageData(images.current, predicate, images.mask);
  const referenceMasked = buildMaskedImageData(images.reference, predicate, images.mask);
  const diffBuffer = new Uint8ClampedArray(images.current.width * images.current.height * 4);
  const mismatchPixels = pixelmatch(
    currentMasked.imageData.data,
    referenceMasked.imageData.data,
    diffBuffer,
    images.current.width,
    images.current.height,
    {
      threshold: 0.1,
      includeAA: false
    }
  );

  return {
    mismatchPixels,
    totalPixels: currentMasked.totalPixels,
    diffImageData: new ImageData(diffBuffer, images.current.width, images.current.height)
  };
}

export function computeTemplateDiff(params: {
  templateId: string;
  content: TemplateContentFixture;
  scope: TemplateCompareScope;
  threshold: number;
  images: TemplateDiffImageSet;
}): TemplateDiffComputation {
  const scoped = runScopedDiff(params.templateId, params.content, params.scope, params.images);
  const chrome =
    params.scope === "chrome-only"
      ? scoped
      : runScopedDiff(params.templateId, params.content, "chrome-only", params.images);
  const mismatchPercent = scoped.totalPixels > 0 ? (scoped.mismatchPixels / scoped.totalPixels) * 100 : 0;
  const chromeMismatchPercent = chrome.totalPixels > 0 ? (chrome.mismatchPixels / chrome.totalPixels) * 100 : 0;

  return {
    diffImageData: scoped.diffImageData,
    heatmapImageData: buildHeatmapImageData(scoped.diffImageData),
    report: {
      templateId: params.templateId,
      timestamp: new Date().toISOString(),
      compareScope: params.scope,
      mismatchPercent,
      mismatchPixels: scoped.mismatchPixels,
      totalPixels: scoped.totalPixels,
      threshold: params.threshold,
      pass: mismatchPercent <= params.threshold,
      chromeMismatchPercent
    }
  };
}
