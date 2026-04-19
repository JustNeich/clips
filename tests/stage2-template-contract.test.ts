import assert from "node:assert/strict";
import test from "node:test";

import type { Stage2Output } from "../app/components/types";
import { validateStage2Output } from "../lib/stage2-output-validation";
import { DEFAULT_STAGE2_HARD_CONSTRAINTS } from "../lib/stage2-channel-config";
import { resolveEffectiveStage2HardConstraints } from "../lib/stage2-template-contract";
import { CHANNEL_STORY, CHANNEL_STORY_TEMPLATE_ID, SCIENCE_CARD, cloneStage3TemplateConfig } from "../lib/stage3-template";
import { resolveTemplateStage2HardConstraints } from "../lib/stage3-template-semantics";

function buildOutput(top: string, bottom: string): Stage2Output {
  return {
    inputAnalysis: {
      visualAnchors: ["anchor"],
      commentVibe: "dry disbelief",
      keyPhraseToAdapt: "quiet disbelief"
    },
    captionOptions: [
      {
        option: 1,
        top,
        bottom,
        topRu: top,
        bottomRu: bottom
      }
    ],
    titleOptions: [
      {
        option: 1,
        title: "Title",
        titleRu: "Заголовок"
      }
    ],
    finalPick: {
      option: 1,
      reason: "Reason"
    }
  };
}

test("channel story body-only lead modes zero out top hard constraints", () => {
  const templateDefaultConfig = cloneStage3TemplateConfig(CHANNEL_STORY);
  templateDefaultConfig.channelStory!.leadMode = "template_default";
  const offConfig = cloneStage3TemplateConfig(CHANNEL_STORY);
  offConfig.channelStory!.leadMode = "off";

  const baseConstraints = {
    ...DEFAULT_STAGE2_HARD_CONSTRAINTS,
    topLengthMin: 18,
    topLengthMax: 80,
    bottomLengthMin: 24,
    bottomLengthMax: 140
  };

  const templateDefaultConstraints = resolveTemplateStage2HardConstraints(
    baseConstraints,
    templateDefaultConfig
  );
  const offConstraints = resolveTemplateStage2HardConstraints(baseConstraints, offConfig);
  const classicConstraints = resolveTemplateStage2HardConstraints(baseConstraints, SCIENCE_CARD);

  assert.equal(templateDefaultConstraints.topLengthMin, 0);
  assert.equal(templateDefaultConstraints.topLengthMax, 0);
  assert.equal(offConstraints.topLengthMin, 0);
  assert.equal(offConstraints.topLengthMax, 0);
  assert.equal(classicConstraints.topLengthMin, 18);
  assert.equal(classicConstraints.topLengthMax, 80);
});

test("effective stage 2 hard constraints resolve channel story built-ins through template ids", () => {
  const resolved = resolveEffectiveStage2HardConstraints({
    hardConstraints: {
      ...DEFAULT_STAGE2_HARD_CONSTRAINTS,
      topLengthMin: 22,
      topLengthMax: 90
    },
    templateId: CHANNEL_STORY_TEMPLATE_ID
  });

  assert.equal(resolved.topLengthMin, 22);
  assert.equal(resolved.topLengthMax, 90);
});

test("stage 2 validation accepts empty top when channel story lead is template-managed", () => {
  const templateConfig = cloneStage3TemplateConfig(CHANNEL_STORY);
  templateConfig.channelStory!.leadMode = "template_default";
  const constraints = resolveTemplateStage2HardConstraints(
    {
      ...DEFAULT_STAGE2_HARD_CONSTRAINTS,
      topLengthMin: 18,
      topLengthMax: 80,
      bottomLengthMin: 10,
      bottomLengthMax: 200
    },
    templateConfig
  );

  const warnings = validateStage2Output(
    buildOutput("", "This body still follows the active constraints."),
    constraints
  );

  assert.equal(
    warnings.some((warning) => warning.field.endsWith(".top")),
    false
  );
});
