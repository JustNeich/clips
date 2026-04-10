import assert from "node:assert/strict";
import test from "node:test";
import {
  clampAvatarCropPosition,
  resolveAvatarCropBounds
} from "../app/components/avatar-upload-support";

test("clampAvatarCropPosition falls back to center for invalid values", () => {
  assert.equal(clampAvatarCropPosition(undefined), 0.5);
  assert.equal(clampAvatarCropPosition(Number.NaN), 0.5);
  assert.equal(clampAvatarCropPosition(-1), 0);
  assert.equal(clampAvatarCropPosition(2), 1);
});

test("resolveAvatarCropBounds keeps square images centered without movement", () => {
  const crop = resolveAvatarCropBounds({
    sourceWidth: 800,
    sourceHeight: 800,
    positionX: 0,
    positionY: 1
  });

  assert.deepEqual(crop, {
    sourceX: 0,
    sourceY: 0,
    sourceSize: 800,
    positionX: 0.5,
    positionY: 0.5,
    canMoveX: false,
    canMoveY: false
  });
});

test("resolveAvatarCropBounds shifts landscape images horizontally", () => {
  const leftCrop = resolveAvatarCropBounds({
    sourceWidth: 1600,
    sourceHeight: 1000,
    positionX: 0,
    positionY: 0.9
  });
  const rightCrop = resolveAvatarCropBounds({
    sourceWidth: 1600,
    sourceHeight: 1000,
    positionX: 1,
    positionY: 0.1
  });

  assert.equal(leftCrop.sourceSize, 1000);
  assert.equal(leftCrop.sourceX, 0);
  assert.equal(leftCrop.sourceY, 0);
  assert.equal(leftCrop.positionY, 0.5);
  assert.equal(leftCrop.canMoveX, true);
  assert.equal(leftCrop.canMoveY, false);

  assert.equal(rightCrop.sourceX, 600);
  assert.equal(rightCrop.positionX, 1);
});

test("resolveAvatarCropBounds shifts portrait images vertically", () => {
  const topCrop = resolveAvatarCropBounds({
    sourceWidth: 900,
    sourceHeight: 1500,
    positionX: 0.2,
    positionY: 0
  });
  const bottomCrop = resolveAvatarCropBounds({
    sourceWidth: 900,
    sourceHeight: 1500,
    positionX: 0.8,
    positionY: 1
  });

  assert.equal(topCrop.sourceSize, 900);
  assert.equal(topCrop.sourceX, 0);
  assert.equal(topCrop.sourceY, 0);
  assert.equal(topCrop.positionX, 0.5);
  assert.equal(topCrop.canMoveX, false);
  assert.equal(topCrop.canMoveY, true);

  assert.equal(bottomCrop.sourceY, 600);
  assert.equal(bottomCrop.positionY, 1);
});
