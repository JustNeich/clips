import assert from "node:assert/strict";
import test from "node:test";

import {
  createStage3VariationProfile,
  isStage3HostedFastRenderProfileEnabled,
  resolveStage3RenderVariationMode
} from "../lib/stage3-render-variation";

function withEnv<T>(patch: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(patch)) {
    previous.set(key, process.env[key]);
    const value = patch[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("hosted fast render profile defaults render variation to encode-only fast x264", () => {
  withEnv(
    {
      RENDER: "true",
      STAGE3_HOSTED_FAST_RENDER_PROFILE: undefined,
      STAGE3_RENDER_VARIATION_MODE: undefined
    },
    () => {
      assert.equal(isStage3HostedFastRenderProfileEnabled(), true);
      assert.equal(resolveStage3RenderVariationMode(), "encode");

      const profile = createStage3VariationProfile();
      assert.equal(profile.requestedMode, "encode");
      assert.equal(profile.signal.enabled, false);
      assert.ok([20, 21, 22].includes(profile.encode.crf));
      assert.ok(["veryfast", "fast"].includes(profile.encode.x264Preset));
    }
  );
});

test("hosted fast render profile can be disabled explicitly", () => {
  withEnv(
    {
      RENDER: "true",
      STAGE3_HOSTED_FAST_RENDER_PROFILE: "0",
      STAGE3_RENDER_VARIATION_MODE: undefined
    },
    () => {
      assert.equal(isStage3HostedFastRenderProfileEnabled(), false);
      assert.equal(resolveStage3RenderVariationMode(), "hybrid");
    }
  );
});
