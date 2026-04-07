import test from "node:test";
import assert from "node:assert/strict";
import { resolveStage3ReportedSourceDuration } from "../lib/stage3-preview-media";

test("mapped preview reports its loaded media duration as the source duration", () => {
  assert.equal(resolveStage3ReportedSourceDuration("mapped", 18.4), 18.4);
  assert.equal(resolveStage3ReportedSourceDuration("mapped", null), null);
});

test("linear accurate preview never overwrites the editor source duration", () => {
  assert.equal(resolveStage3ReportedSourceDuration("linear", 6), undefined);
  assert.equal(resolveStage3ReportedSourceDuration("linear", null), undefined);
});
