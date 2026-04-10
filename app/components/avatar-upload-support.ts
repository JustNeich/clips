"use client";

export const AVATAR_UPLOAD_OUTPUT_SIZE = 512;
export const MIN_AVATAR_CROP_SIZE = 0.2;

export type AvatarCropSelection = {
  centerX: number;
  centerY: number;
  size: number;
};

export type AvatarCropBounds = {
  sourceX: number;
  sourceY: number;
  sourceSize: number;
  centerX: number;
  centerY: number;
  size: number;
  canMoveX: boolean;
  canMoveY: boolean;
  canResize: boolean;
};

export type AvatarPreviewMetrics = {
  offsetX: number;
  offsetY: number;
  imageWidth: number;
  imageHeight: number;
  scale: number;
};

export function clampAvatarCropPosition(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, value));
}

export function clampAvatarCropSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  return Math.min(1, Math.max(MIN_AVATAR_CROP_SIZE, value));
}

export function createDefaultAvatarCropSelection(): AvatarCropSelection {
  return {
    centerX: 0.5,
    centerY: 0.5,
    size: 1
  };
}

function resolveAvatarSourceDimension(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;
}

function clampAvatarCropCenter(value: number, lower: number, upper: number): number {
  if (lower >= upper) {
    return 0.5;
  }
  return Math.min(upper, Math.max(lower, clampAvatarCropPosition(value)));
}

export function resolveAvatarCropBounds(params: {
  sourceWidth: number;
  sourceHeight: number;
  centerX: number;
  centerY: number;
  size: number;
}): AvatarCropBounds {
  const width = resolveAvatarSourceDimension(params.sourceWidth);
  const height = resolveAvatarSourceDimension(params.sourceHeight);
  const shortestSide = Math.max(1, Math.min(width, height));
  const size = clampAvatarCropSize(params.size);
  const sourceSize = Math.max(1, Math.round(shortestSide * size));
  const halfWidthShare = sourceSize / (2 * width);
  const halfHeightShare = sourceSize / (2 * height);
  const centerX = clampAvatarCropCenter(params.centerX, halfWidthShare, 1 - halfWidthShare);
  const centerY = clampAvatarCropCenter(params.centerY, halfHeightShare, 1 - halfHeightShare);
  const sourceX = Math.round(width * centerX - sourceSize / 2);
  const sourceY = Math.round(height * centerY - sourceSize / 2);

  return {
    sourceX: Math.min(Math.max(0, sourceX), Math.max(0, width - sourceSize)),
    sourceY: Math.min(Math.max(0, sourceY), Math.max(0, height - sourceSize)),
    sourceSize,
    centerX,
    centerY,
    size,
    canMoveX: width > sourceSize,
    canMoveY: height > sourceSize,
    canResize: shortestSide > 1
  };
}

function resolveMaxAvatarCropSize(params: {
  sourceWidth: number;
  sourceHeight: number;
  centerX: number;
  centerY: number;
}): number {
  const width = resolveAvatarSourceDimension(params.sourceWidth);
  const height = resolveAvatarSourceDimension(params.sourceHeight);
  const shortestSide = Math.max(1, Math.min(width, height));
  const centerX = clampAvatarCropPosition(params.centerX);
  const centerY = clampAvatarCropPosition(params.centerY);
  const maxSizeByWidth = (2 * width * Math.min(centerX, 1 - centerX)) / shortestSide;
  const maxSizeByHeight = (2 * height * Math.min(centerY, 1 - centerY)) / shortestSide;
  return Math.max(
    MIN_AVATAR_CROP_SIZE,
    Math.min(1, maxSizeByWidth, maxSizeByHeight)
  );
}

export function translateAvatarCropSelection(params: {
  sourceWidth: number;
  sourceHeight: number;
  selection: AvatarCropSelection;
  deltaSourceX: number;
  deltaSourceY: number;
}): AvatarCropSelection {
  const width = resolveAvatarSourceDimension(params.sourceWidth);
  const height = resolveAvatarSourceDimension(params.sourceHeight);
  const normalized = resolveAvatarCropBounds({
    sourceWidth: width,
    sourceHeight: height,
    centerX: params.selection.centerX,
    centerY: params.selection.centerY,
    size: params.selection.size
  });

  const nextBounds = resolveAvatarCropBounds({
    sourceWidth: width,
    sourceHeight: height,
    centerX: normalized.centerX + params.deltaSourceX / width,
    centerY: normalized.centerY + params.deltaSourceY / height,
    size: normalized.size
  });

  return {
    centerX: nextBounds.centerX,
    centerY: nextBounds.centerY,
    size: nextBounds.size
  };
}

export function resizeAvatarCropSelection(params: {
  sourceWidth: number;
  sourceHeight: number;
  selection: AvatarCropSelection;
  nextSize: number;
}): AvatarCropSelection {
  const width = resolveAvatarSourceDimension(params.sourceWidth);
  const height = resolveAvatarSourceDimension(params.sourceHeight);
  const normalized = resolveAvatarCropBounds({
    sourceWidth: width,
    sourceHeight: height,
    centerX: params.selection.centerX,
    centerY: params.selection.centerY,
    size: params.selection.size
  });
  const boundedSize = Math.min(
    clampAvatarCropSize(params.nextSize),
    resolveMaxAvatarCropSize({
      sourceWidth: width,
      sourceHeight: height,
      centerX: normalized.centerX,
      centerY: normalized.centerY
    })
  );
  const nextBounds = resolveAvatarCropBounds({
    sourceWidth: width,
    sourceHeight: height,
    centerX: normalized.centerX,
    centerY: normalized.centerY,
    size: boundedSize
  });

  return {
    centerX: nextBounds.centerX,
    centerY: nextBounds.centerY,
    size: nextBounds.size
  };
}

export function resolveAvatarPreviewMetrics(params: {
  viewportWidth: number;
  viewportHeight: number;
  sourceWidth: number;
  sourceHeight: number;
}): AvatarPreviewMetrics {
  const viewportWidth = Number.isFinite(params.viewportWidth) ? Math.max(0, params.viewportWidth) : 0;
  const viewportHeight = Number.isFinite(params.viewportHeight) ? Math.max(0, params.viewportHeight) : 0;
  const sourceWidth = resolveAvatarSourceDimension(params.sourceWidth);
  const sourceHeight = resolveAvatarSourceDimension(params.sourceHeight);
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return {
      offsetX: 0,
      offsetY: 0,
      imageWidth: 0,
      imageHeight: 0,
      scale: 0
    };
  }

  const imageAspect = sourceWidth / sourceHeight;
  const viewportAspect = viewportWidth / viewportHeight;
  if (imageAspect >= viewportAspect) {
    const imageWidth = viewportWidth;
    const imageHeight = imageWidth / imageAspect;
    return {
      offsetX: 0,
      offsetY: (viewportHeight - imageHeight) / 2,
      imageWidth,
      imageHeight,
      scale: imageWidth / sourceWidth
    };
  }

  const imageHeight = viewportHeight;
  const imageWidth = imageHeight * imageAspect;
  return {
    offsetX: (viewportWidth - imageWidth) / 2,
    offsetY: 0,
    imageWidth,
    imageHeight,
    scale: imageHeight / sourceHeight
  };
}

function buildAvatarUploadFileName(fileName: string): string {
  const trimmed = fileName.trim();
  const dotIndex = trimmed.lastIndexOf(".");
  const stem = dotIndex > 0 ? trimmed.slice(0, dotIndex) : trimmed;
  const safeStem = stem.trim() || "avatar";
  return `${safeStem}-avatar.png`;
}

async function loadImageElementFromFile(file: File): Promise<HTMLImageElement> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.decoding = "async";
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error("Не удалось открыть изображение."));
      nextImage.src = objectUrl;
    });
    if (typeof image.decode === "function") {
      await image.decode().catch(() => undefined);
    }
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function canvasToPngFile(canvas: HTMLCanvasElement, fileName: string): Promise<File> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) {
        resolve(result);
        return;
      }
      reject(new Error("Не удалось подготовить PNG для аватара."));
    }, "image/png");
  });

  return new File([blob], fileName, {
    type: "image/png",
    lastModified: Date.now()
  });
}

export async function buildPositionedAvatarUpload(params: {
  file: File;
  centerX: number;
  centerY: number;
  size: number;
}): Promise<File> {
  const image = await loadImageElementFromFile(params.file);
  const crop = resolveAvatarCropBounds({
    sourceWidth: image.naturalWidth,
    sourceHeight: image.naturalHeight,
    centerX: params.centerX,
    centerY: params.centerY,
    size: params.size
  });
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_UPLOAD_OUTPUT_SIZE;
  canvas.height = AVATAR_UPLOAD_OUTPUT_SIZE;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("2D canvas context is unavailable.");
  }
  context.drawImage(
    image,
    crop.sourceX,
    crop.sourceY,
    crop.sourceSize,
    crop.sourceSize,
    0,
    0,
    AVATAR_UPLOAD_OUTPUT_SIZE,
    AVATAR_UPLOAD_OUTPUT_SIZE
  );
  return canvasToPngFile(canvas, buildAvatarUploadFileName(params.file.name));
}
