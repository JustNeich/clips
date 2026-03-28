import assert from "node:assert/strict";
import test from "node:test";

import nextConfig from "../next.config.mjs";

test("next config raises middleware client body size to match asset upload limits", () => {
  const sizeLimit = nextConfig.experimental?.middlewareClientMaxBodySize;
  assert.equal(sizeLimit, 90 * 1024 * 1024);
});
