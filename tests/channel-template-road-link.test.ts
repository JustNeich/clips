import assert from "node:assert/strict";
import test from "node:test";

import { buildTemplateRoadHref } from "../app/components/template-road-link";

test("channel template editor link opens the selected managed template", () => {
  assert.equal(
    buildTemplateRoadHref("the legacy/journal template"),
    "/design/template-road?template=the%20legacy%2Fjournal%20template"
  );
});

test("channel template editor link falls back to the template road when no template is selected", () => {
  assert.equal(buildTemplateRoadHref("  "), "/design/template-road");
  assert.equal(buildTemplateRoadHref(null), "/design/template-road");
  assert.equal(buildTemplateRoadHref(undefined), "/design/template-road");
});
