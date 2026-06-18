import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveChannelStoryContainedMediaMatteStyles } from "../lib/channel-story-media-matte";

test("channel-story contained media matte is a dense non-black underlay contract", () => {
  const styles = resolveChannelStoryContainedMediaMatteStyles();

  assert.equal(styles.containerStyle.background, "#050607");
  assert.notEqual(styles.containerStyle.background, "#000000");
  assert.equal(styles.containerStyle.overflow, "hidden");
  assert.equal(styles.underlayVideoStyle.left, -18);
  assert.equal(styles.underlayVideoStyle.top, -18);
  assert.equal(styles.underlayVideoStyle.width, "calc(100% + 36px)");
  assert.equal(styles.underlayVideoStyle.height, "calc(100% + 36px)");
  assert.match(String(styles.underlayVideoStyle.filter), /blur\(24px\)/);
  assert.match(String(styles.underlayVideoStyle.filter), /brightness\(0\.28\)/);
  assert.match(String(styles.underlayVideoStyle.filter), /saturate\(0\.72\)/);
  assert.equal(styles.underlayVideoStyle.transform, "scale(1.14)");
  assert.match(String(styles.densityOverlayStyle.background), /rgba\(5,6,7,0\.82\) 100%/);
});

test("template scene does not emit an over-media channel-story matte overlay", () => {
  const templateScene = readFileSync("lib/template-scene.tsx", "utf8");

  assert.doesNotMatch(templateScene, /channel-story-media-bottom-matte/);
  assert.doesNotMatch(templateScene, /channel-story-media-edge-guard/);
  assert.doesNotMatch(templateScene, /resolveChannelStoryContainedMediaMatteStyles/);
});

test("render and live preview use the shared contained media matte helper", () => {
  const renderSource = readFileSync("remotion/science-card-v1.tsx", "utf8");
  const previewSource = readFileSync("app/components/Step3RenderTemplate.tsx", "utf8");

  for (const source of [renderSource, previewSource]) {
    assert.match(source, /resolveChannelStoryContainedMediaMatteStyles/);
    assert.doesNotMatch(source, /blur\(18px\) brightness\(0\.48\) saturate\(0\.85\)/);
    assert.doesNotMatch(source, /rgba\(0,0,0,0\.26\)/);
  }
});
