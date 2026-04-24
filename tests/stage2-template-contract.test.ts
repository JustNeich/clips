import assert from "node:assert/strict";
import test from "node:test";

import type { Stage2Output } from "../app/components/types";
import { validateStage2Output } from "../lib/stage2-output-validation";
import { DEFAULT_STAGE2_HARD_CONSTRAINTS } from "../lib/stage2-channel-config";
import {
  resolveEffectiveStage2HardConstraints,
  resolveStage2TemplateTextSemantics
} from "../lib/stage2-template-contract";
import { CHANNEL_STORY, CHANNEL_STORY_TEMPLATE_ID, SCIENCE_CARD, cloneStage3TemplateConfig } from "../lib/stage3-template";
import {
  resolveTemplateStage2HardConstraints,
  resolveTemplateTextFieldSemantics
} from "../lib/stage3-template-semantics";

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

  assert.equal(resolved.topLengthMin >= 6 && resolved.topLengthMin <= 18, true);
  assert.equal(resolved.topLengthMax >= 24 && resolved.topLengthMax <= 56, true);
  assert.equal(resolved.bottomLengthMin >= 40, true);
  assert.equal(resolved.bottomLengthMax >= 120, true);
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

test("channel story clip custom mode narrows lead and widens body into family-specific windows", () => {
  const templateConfig = cloneStage3TemplateConfig(CHANNEL_STORY);
  templateConfig.channelStory!.leadMode = "clip_custom";

  const constraints = resolveTemplateStage2HardConstraints(
    {
      ...DEFAULT_STAGE2_HARD_CONSTRAINTS,
      topLengthMin: 24,
      topLengthMax: 110,
      bottomLengthMin: 22,
      bottomLengthMax: 110
    },
    templateConfig
  );

  assert.equal(constraints.topLengthMin >= 6 && constraints.topLengthMin <= 18, true);
  assert.equal(constraints.topLengthMax >= 24 && constraints.topLengthMax <= 56, true);
  assert.equal(constraints.bottomLengthMin >= 40 && constraints.bottomLengthMin <= 120, true);
  assert.equal(constraints.bottomLengthMax >= 120 && constraints.bottomLengthMax <= 260, true);
  assert.equal(constraints.topLengthMax < 110, true);
  assert.equal(constraints.bottomLengthMax > 110, true);
});

test("channel story text semantics hide template-managed lead fields outside clip-custom mode", () => {
  const clipCustom = cloneStage3TemplateConfig(CHANNEL_STORY);
  clipCustom.channelStory!.leadMode = "clip_custom";
  const templateDefault = cloneStage3TemplateConfig(CHANNEL_STORY);
  templateDefault.channelStory!.leadMode = "template_default";
  templateDefault.channelStory!.defaultLeadText = "Did you know?";
  const off = cloneStage3TemplateConfig(CHANNEL_STORY);
  off.channelStory!.leadMode = "off";

  const clipCustomSemantics = resolveTemplateTextFieldSemantics(clipCustom);
  const templateDefaultSemantics = resolveTemplateTextFieldSemantics(templateDefault);
  const offSemantics = resolveTemplateTextFieldSemantics(off);

  assert.equal(clipCustomSemantics.topVisible, true);
  assert.equal(clipCustomSemantics.topNote, null);
  assert.equal(templateDefaultSemantics.topVisible, false);
  assert.equal(
    templateDefaultSemantics.topNote,
    "Шаблон сам подставит lead: Did you know?"
  );
  assert.equal(offSemantics.topVisible, false);
  assert.equal(offSemantics.topNote, "Этот шаблон не использует отдельный lead.");
});

test("stage 2 template semantics snapshot carries format labels and effective length hints", () => {
  const semantics = resolveStage2TemplateTextSemantics({
    templateId: CHANNEL_STORY_TEMPLATE_ID,
    hardConstraints: {
      ...DEFAULT_STAGE2_HARD_CONSTRAINTS,
      topLengthMin: 22,
      topLengthMax: 90,
      bottomLengthMin: 22,
      bottomLengthMax: 110
    }
  });

  assert.equal(semantics.formatGroup, "channel_story");
  assert.equal(semantics.topLabel, "Lead");
  assert.equal(semantics.bottomLabel, "Body");
  assert.equal(semantics.lengthHints.topLengthMax < 90, true);
  assert.equal(semantics.lengthHints.bottomLengthMax > 110, true);
});
