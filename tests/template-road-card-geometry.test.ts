import assert from "node:assert/strict";
import test from "node:test";

import { cloneStage3TemplateConfig, SCIENCE_CARD } from "../lib/stage3-template";
import { updateTemplateRoadCard } from "../lib/template-road-card-geometry";

test("width changes keep the card centered and snap x to an integer pixel", () => {
  const templateConfig = cloneStage3TemplateConfig(SCIENCE_CARD);

  const updated = updateTemplateRoadCard(templateConfig.card, templateConfig.frame, "width", 806);

  assert.equal(updated.width, 806);
  assert.equal(updated.x, 134);
  assert.equal(updated.y, templateConfig.card.y);
});

test("width changes clamp the centered card inside the frame bounds", () => {
  const templateConfig = cloneStage3TemplateConfig(SCIENCE_CARD);

  const shiftedCard = {
    ...templateConfig.card,
    x: 0,
    width: 907
  };

  const updated = updateTemplateRoadCard(shiftedCard, templateConfig.frame, "width", 1080);

  assert.equal(updated.width, 1080);
  assert.equal(updated.x, 0);
});

test("non-width updates keep manual positioning untouched", () => {
  const templateConfig = cloneStage3TemplateConfig(SCIENCE_CARD);

  const updated = updateTemplateRoadCard(templateConfig.card, templateConfig.frame, "height", 1400);

  assert.equal(updated.height, 1400);
  assert.equal(updated.width, templateConfig.card.width);
  assert.equal(updated.x, templateConfig.card.x);
});
