import assert from "node:assert/strict";
import test from "node:test";

import {
  collectChannelStage2Examples,
  DEFAULT_WORKSPACE_STAGE2_EXAMPLES_CONFIG,
  normalizeStage2ExamplesConfig,
  parseStage2ExamplesJson,
  resolveEffectiveStage2ExamplesConfigForFormat
} from "../lib/stage2-channel-config";
import { STAGE2_REFERENCE_ONE_SHOT_PROMPT } from "../lib/stage2-prompt-specs";
import {
  DEFAULT_STAGE2_PROMPT_CONFIG,
  normalizeStage2PromptConfig,
  resolveEffectiveStage2PromptConfigForFormat
} from "../lib/stage2-pipeline";

const OWNER = {
  channelId: "channel-mobile-capture",
  channelName: "Mobile Capture"
};

test("stage 2 channel examples accept arbitrary JSON arrays and keep plain text notes", () => {
  const rawJson = JSON.stringify([
    {
      hook: "This guy turns a mop bucket into a barracks rodeo.",
      punchline: "That floor didn't get cleaned, it got court-martialed.",
      weird_field_from_editor: { rhythm: "blue collar sarcasm", color: "dry" }
    }
  ]);
  const config = normalizeStage2ExamplesConfig(
    {
      useWorkspaceDefault: false,
      customExamplesJson: rawJson,
      customExamplesText: "Use dry, specific, present-tense captions. Avoid glossy marketing language."
    },
    OWNER
  );

  assert.equal(config.useWorkspaceDefault, false);
  assert.equal(config.customExamplesJson, rawJson);
  assert.match(config.customExamplesText ?? "", /present-tense captions/);
  assert.equal(config.customExamples.length, 1);
  assert.equal(config.customExamples[0]?.ownerChannelId, OWNER.channelId);
  assert.match(config.customExamples[0]?.overlayTop ?? "", /mop bucket/);
  assert.match(config.customExamples[0]?.whyItWorks.join(" ") ?? "", /weird_field_from_editor/);
});

test("stage 2 channel examples treat a single arbitrary JSON object as one reference example", () => {
  const examples = parseStage2ExamplesJson(
    JSON.stringify({
      title: "GUARD EDITION",
      text: "A singer leans into chaos while the security guard keeps inventorying exits.",
      note: "short title, visible action first"
    }),
    OWNER
  );

  assert.equal(examples.length, 1);
  assert.equal(examples[0]?.title, "GUARD EDITION");
  assert.match(examples[0]?.overlayTop ?? "", /singer leans into chaos/);
});

test("channel custom examples are collected for runtime use and v6 prompt names both payloads", () => {
  const stage2ExamplesConfig = normalizeStage2ExamplesConfig(
    {
      useWorkspaceDefault: false,
      customExamplesJson: JSON.stringify([
        {
          top: "This driver isn't parking, he's negotiating with physics.",
          bottom: "The cone lost that argument before it started."
        }
      ]),
      customExamplesText: "Prefer specific visible objects over generic nouns."
    },
    OWNER
  );

  const collected = collectChannelStage2Examples({
    channel: {
      id: OWNER.channelId,
      name: OWNER.channelName,
      stage2ExamplesConfig
    }
  });

  assert.equal(collected.length, 1);
  assert.match(collected[0]?.overlayTop ?? "", /negotiating with physics/);
  assert.match(STAGE2_REFERENCE_ONE_SHOT_PROMPT, /examples_json/);
  assert.match(STAGE2_REFERENCE_ONE_SHOT_PROMPT, /examples_text/);
  assert.match(STAGE2_REFERENCE_ONE_SHOT_PROMPT, /template_semantics_json/);
});

test("channel examples normalization is idempotent when raw JSON is stored with derived examples", () => {
  const rawJson = JSON.stringify([
    {
      top: "This driver isn't parking, he's negotiating with physics.",
      bottom: "The cone lost that argument before it started."
    }
  ]);
  const firstPass = normalizeStage2ExamplesConfig(
    {
      useWorkspaceDefault: false,
      customExamplesJson: rawJson
    },
    OWNER
  );
  const secondPass = normalizeStage2ExamplesConfig(firstPass, OWNER);

  assert.equal(firstPass.customExamples.length, 1);
  assert.equal(secondPass.customExamples.length, 1);
  assert.deepEqual(secondPass.customExamples, firstPass.customExamples);
});

test("format-aware examples resolver preserves legacy default and applies explicit profile precedence", () => {
  const workspaceDefault = normalizeStage2ExamplesConfig(
    {
      ...DEFAULT_WORKSPACE_STAGE2_EXAMPLES_CONFIG,
      sourceMode: "custom",
      customExamplesJson: JSON.stringify([{ top: "workspace default", bottom: "baseline" }])
    },
    { channelId: "workspace-default", channelName: "Workspace default" }
  );
  const workspaceFormat = normalizeStage2ExamplesConfig(
    {
      ...workspaceDefault,
      formatProfiles: {
        channel_story: {
          useDefault: false,
          sourceMode: "custom",
          systemPresetId: "system_examples",
          customInputMode: "json",
          customExamplesJson: JSON.stringify([{ top: "workspace story", bottom: "lead body" }]),
          customExamplesText: "",
          customExamples: []
        }
      }
    },
    { channelId: "workspace-default", channelName: "Workspace default" }
  );
  const channelDefault = normalizeStage2ExamplesConfig(
    {
      useWorkspaceDefault: false,
      sourceMode: "custom",
      customExamplesJson: JSON.stringify([{ top: "channel default", bottom: "classic" }])
    },
    OWNER
  );
  const channelFormat = normalizeStage2ExamplesConfig(
    {
      ...channelDefault,
      formatProfiles: {
        channel_story: {
          useDefault: false,
          sourceMode: "custom",
          systemPresetId: "system_examples",
          customInputMode: "json",
          customExamplesJson: JSON.stringify([{ top: "channel story", bottom: "wins" }]),
          customExamplesText: "",
          customExamples: []
        }
      }
    },
    OWNER
  );

  assert.match(
    resolveEffectiveStage2ExamplesConfigForFormat({
      workspaceStage2ExamplesConfig: workspaceDefault,
      channelOwner: OWNER,
      formatGroup: "classic_top_bottom"
    }).config.customExamplesJson ?? "",
    /workspace default/
  );
  assert.match(
    resolveEffectiveStage2ExamplesConfigForFormat({
      workspaceStage2ExamplesConfig: workspaceFormat,
      channelOwner: OWNER,
      formatGroup: "channel_story"
    }).config.customExamplesJson ?? "",
    /workspace story/
  );
  assert.match(
    resolveEffectiveStage2ExamplesConfigForFormat({
      workspaceStage2ExamplesConfig: workspaceFormat,
      channelStage2ExamplesConfig: channelDefault,
      channelOwner: OWNER,
      formatGroup: "channel_story"
    }).config.customExamplesJson ?? "",
    /channel default/
  );
  assert.match(
    resolveEffectiveStage2ExamplesConfigForFormat({
      workspaceStage2ExamplesConfig: workspaceFormat,
      channelStage2ExamplesConfig: channelFormat,
      channelOwner: OWNER,
      formatGroup: "channel_story"
    }).config.customExamplesJson ?? "",
    /channel story/
  );
});

test("format-aware prompt resolver keeps legacy flat configs as default profile and applies channel story override", () => {
  const workspacePrompt = normalizeStage2PromptConfig({
    ...DEFAULT_STAGE2_PROMPT_CONFIG,
    sourceMode: "custom",
    stages: {
      ...DEFAULT_STAGE2_PROMPT_CONFIG.stages,
      oneShotReference: {
        ...DEFAULT_STAGE2_PROMPT_CONFIG.stages.oneShotReference,
        prompt: "Workspace default marker video_truth_json examples_json hard_constraints_json"
      }
    }
  });
  const channelPrompt = normalizeStage2PromptConfig({
    useWorkspaceDefault: true,
    formatProfiles: {
      channel_story: {
        useDefault: false,
        sourceMode: "custom",
        systemPresetId: "system_prompt",
        stages: {
          ...DEFAULT_STAGE2_PROMPT_CONFIG.stages,
          oneShotReference: {
            ...DEFAULT_STAGE2_PROMPT_CONFIG.stages.oneShotReference,
            prompt: "Channel story marker template_semantics_json Lead Body"
          }
        }
      }
    }
  });

  const classic = resolveEffectiveStage2PromptConfigForFormat({
    workspacePromptConfig: workspacePrompt,
    channelPromptConfig: channelPrompt,
    formatGroup: "classic_top_bottom"
  });
  const story = resolveEffectiveStage2PromptConfigForFormat({
    workspacePromptConfig: workspacePrompt,
    channelPromptConfig: channelPrompt,
    formatGroup: "channel_story"
  });

  assert.equal(classic.source, "workspace_default");
  assert.match(classic.config.stages.oneShotReference.prompt, /Workspace default marker/);
  assert.equal(story.source, "channel_format");
  assert.match(story.config.stages.oneShotReference.prompt, /Channel story marker/);
});
