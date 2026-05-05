import assert from "node:assert/strict";
import test from "node:test";

import {
  validateManagedTemplateFontUpload,
  validateManagedTemplateBackgroundMime
} from "../lib/managed-template-assets";

test("managed template asset validation accepts font files without widening background uploads", () => {
  assert.equal(validateManagedTemplateFontUpload({
    mimeType: "font/woff2",
    originalName: "LeadDisplay.woff2"
  }), true);
  assert.equal(validateManagedTemplateFontUpload({
    mimeType: "application/octet-stream",
    originalName: "MainText.otf"
  }), true);
  assert.equal(validateManagedTemplateFontUpload({
    mimeType: "application/x-font-woff",
    originalName: "BrowserReported.woff"
  }), true);
  assert.equal(validateManagedTemplateFontUpload({
    mimeType: "font/sfnt",
    originalName: "VariableFont.ttf"
  }), true);
  assert.equal(validateManagedTemplateFontUpload({
    mimeType: "image/svg+xml",
    originalName: "not-a-font.svg"
  }), false);
  assert.equal(validateManagedTemplateFontUpload({
    mimeType: "font/woff2",
    originalName: "missing-extension"
  }), false);

  assert.equal(validateManagedTemplateBackgroundMime("image/png"), true);
  assert.equal(validateManagedTemplateBackgroundMime("font/woff2"), false);
});
