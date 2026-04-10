"use client";

export const AVATAR_UPLOAD_OUTPUT_SIZE = 512;

export type AvatarCropBounds = {
  sourceX: number;
  sourceY: number;
  sourceSize: number;
  positionX: number;
  positionY: number;
  canMoveX: boolean;
  canMoveY: boolean;
};

export function clampAvatarCropPosition(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, value));
}

export function resolveAvatarCropBounds(params: {
  sourceWidth: number;
  sourceHeight: number;
  positionX: number;
  positionY: number;
}): AvatarCropBounds {
  const width = Number.isFinite(params.sourceWidth) ? Math.max(1, Math.round(params.sourceWidth)) : 1;
  const height = Number.isFinite(params.sourceHeight) ? Math.max(1, Math.round(params.sourceHeight)) : 1;
  const sourceSize = Math.max(1, Math.min(width, height));
  const maxOffsetX = Math.max(0, width - sourceSize);
  const maxOffsetY = Math.max(0, height - sourceSize);
  const positionX = maxOffsetX > 0 ? clampAvatarCropPosition(params.positionX) : 0.5;
  const positionY = maxOffsetY > 0 ? clampAvatarCropPosition(params.positionY) : 0.5;

  return {
    sourceX: Math.round(maxOffsetX * positionX),
    sourceY: Math.round(maxOffsetY * positionY),
    sourceSize,
    positionX,
    positionY,
    canMoveX: maxOffsetX > 0,
    canMoveY: maxOffsetY > 0
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
  positionX: number;
  positionY: number;
}): Promise<File> {
  const image = await loadImageElementFromFile(params.file);
  const crop = resolveAvatarCropBounds({
    sourceWidth: image.naturalWidth,
    sourceHeight: image.naturalHeight,
    positionX: params.positionX,
    positionY: params.positionY
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

