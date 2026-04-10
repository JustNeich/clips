import assert from "node:assert/strict";
import test from "node:test";
import {
  clampAvatarCropPosition,
  clampAvatarCropSize,
  createDefaultAvatarCropSelection,
  resizeAvatarCropSelection,
  resolveAvatarCropBounds,
  translateAvatarCropSelection
} from "../app/components/avatar-upload-support";

test("clampAvatarCropPosition falls back to center for invalid values", () => {
  assert.equal(clampAvatarCropPosition(undefined), 0.5);
  assert.equal(clampAvatarCropPosition(Number.NaN), 0.5);
  assert.equal(clampAvatarCropPosition(-1), 0);
  assert.equal(clampAvatarCropPosition(2), 1);
});

test("clampAvatarCropSize keeps the crop within sane bounds", () => {
  assert.equal(clampAvatarCropSize(undefined), 1);
  assert.equal(clampAvatarCropSize(Number.NaN), 1);
  assert.equal(clampAvatarCropSize(0.05), 0.2);
  assert.equal(clampAvatarCropSize(2), 1);
});

test("default avatar crop selection starts centered and full size", () => {
  assert.deepEqual(createDefaultAvatarCropSelection(), {
    centerX: 0.5,
    centerY: 0.5,
    size: 1
  });
});

test("resolveAvatarCropBounds keeps square images centered without movement", () => {
  const crop = resolveAvatarCropBounds({
    sourceWidth: 800,
    sourceHeight: 800,
    centerX: 0,
    centerY: 1,
    size: 1
  });

  assert.deepEqual(crop, {
    sourceX: 0,
    sourceY: 0,
    sourceSize: 800,
    centerX: 0.5,
    centerY: 0.5,
    size: 1,
    canMoveX: false,
    canMoveY: false,
    canResize: true
  });
});

test("resolveAvatarCropBounds shifts landscape images horizontally", () => {
  const leftCrop = resolveAvatarCropBounds({
    sourceWidth: 1600,
    sourceHeight: 1000,
    centerX: 0,
    centerY: 0.9,
    size: 1
  });
  const rightCrop = resolveAvatarCropBounds({
    sourceWidth: 1600,
    sourceHeight: 1000,
    centerX: 1,
    centerY: 0.1,
    size: 1
  });

  assert.equal(leftCrop.sourceSize, 1000);
  assert.equal(leftCrop.sourceX, 0);
  assert.equal(leftCrop.sourceY, 0);
  assert.equal(leftCrop.centerY, 0.5);
  assert.equal(leftCrop.canMoveX, true);
  assert.equal(leftCrop.canMoveY, false);

  assert.equal(rightCrop.sourceX, 600);
  assert.equal(rightCrop.centerX, 0.6875);
});

test("resolveAvatarCropBounds shifts portrait images vertically", () => {
  const topCrop = resolveAvatarCropBounds({
    sourceWidth: 900,
    sourceHeight: 1500,
    centerX: 0.2,
    centerY: 0,
    size: 1
  });
  const bottomCrop = resolveAvatarCropBounds({
    sourceWidth: 900,
    sourceHeight: 1500,
    centerX: 0.8,
    centerY: 1,
    size: 1
  });

  assert.equal(topCrop.sourceSize, 900);
  assert.equal(topCrop.sourceX, 0);
  assert.equal(topCrop.sourceY, 0);
  assert.equal(topCrop.centerX, 0.5);
  assert.equal(topCrop.canMoveX, false);
  assert.equal(topCrop.canMoveY, true);

  assert.equal(bottomCrop.sourceY, 600);
  assert.equal(bottomCrop.centerY, 0.7);
});

test("translateAvatarCropSelection moves the crop and clamps it at the image edge", () => {
  const moved = translateAvatarCropSelection({
    sourceWidth: 1600,
    sourceHeight: 1000,
    selection: {
      centerX: 0.5,
      centerY: 0.5,
      size: 0.5
    },
    deltaSourceX: 900,
    deltaSourceY: -900
  });

  assert.deepEqual(moved, {
    centerX: 0.84375,
    centerY: 0.25,
    size: 0.5
  });
});

test("resizeAvatarCropSelection keeps the circle inside the image while enlarging", () => {
  const resized = resizeAvatarCropSelection({
    sourceWidth: 1600,
    sourceHeight: 1000,
    selection: {
      centerX: 0.75,
      centerY: 0.5,
      size: 0.3
    },
    nextSize: 1
  });

  assert.deepEqual(resized, {
    centerX: 0.75,
    centerY: 0.5,
    size: 0.8
  });
});
