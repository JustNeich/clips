import assert from "node:assert/strict";
import test from "node:test";

import {
  applyChannelStage2PromptSelection,
  collectChannelStage2Examples,
  DEFAULT_STAGE2_EXAMPLES_CONFIG,
  normalizeStage2ExamplesConfig,
  parseStage2ExamplesJson,
  resolveStage2ChannelPromptSelection,
  resolveStage2ExamplesCorpus
} from "../lib/stage2-channel-config";
import {
  STAGE2_ANIMALS_REFERENCE_ONE_SHOT_PROMPT,
  STAGE2_REFERENCE_ONE_SHOT_PROMPT
} from "../lib/stage2-prompt-specs";
import { normalizeStage2PromptConfig } from "../lib/stage2-pipeline";

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

test("channel prompt selection defaults to the system prompt and can switch to animals preset", () => {
  const defaultSelection = resolveStage2ChannelPromptSelection({
    stage2ExamplesConfig: DEFAULT_STAGE2_EXAMPLES_CONFIG,
    workspacePromptConfig: normalizeStage2PromptConfig({})
  });
  const animalsSelection = resolveStage2ChannelPromptSelection({
    stage2ExamplesConfig: normalizeStage2ExamplesConfig(
      {
        systemPromptPresetId: "animals_system_prompt"
      },
      OWNER
    ),
    workspacePromptConfig: normalizeStage2PromptConfig({})
  });

  assert.equal(defaultSelection.presetId, "system_prompt");
  assert.equal(defaultSelection.promptText, STAGE2_REFERENCE_ONE_SHOT_PROMPT);
  assert.equal(animalsSelection.presetId, "animals_system_prompt");
  assert.equal(animalsSelection.promptText, STAGE2_ANIMALS_REFERENCE_ONE_SHOT_PROMPT);
});

test("channel custom prompt overrides workspace one-shot prompt without touching other stages", () => {
  const { promptConfig, promptConfigSource } = applyChannelStage2PromptSelection({
    workspacePromptConfig: normalizeStage2PromptConfig({
      stages: {
        analyzer: {
          prompt: "Analyzer override",
          reasoningEffort: "high"
        }
      }
    }),
    stage2ExamplesConfig: normalizeStage2ExamplesConfig(
      {
        promptMode: "custom",
        customSystemPrompt: "CUSTOM CHANNEL PROMPT"
      },
      OWNER
    )
  });

  assert.equal(promptConfigSource, "channel_override");
  assert.equal(promptConfig.stages.oneShotReference.prompt, "CUSTOM CHANNEL PROMPT");
  assert.equal(promptConfig.stages.analyzer.prompt, "Analyzer override");
});

test("system examples preset can switch from workspace default corpus to animals corpus", () => {
  const workspaceResolved = resolveStage2ExamplesCorpus({
    channel: {
      id: OWNER.channelId,
      name: OWNER.channelName,
      stage2ExamplesConfig: DEFAULT_STAGE2_EXAMPLES_CONFIG
    },
    workspaceStage2ExamplesCorpusJson: JSON.stringify([{ title: "workspace", top: "A", bottom: "B" }])
  });
  const animalsResolved = resolveStage2ExamplesCorpus({
    channel: {
      id: OWNER.channelId,
      name: OWNER.channelName,
      stage2ExamplesConfig: normalizeStage2ExamplesConfig(
        {
          systemExamplesPresetId: "animals_examples"
        },
        OWNER
      )
    },
    workspaceStage2ExamplesCorpusJson: JSON.stringify([{ title: "workspace", top: "A", bottom: "B" }])
  });

  assert.equal(workspaceResolved.source, "workspace_default");
  assert.equal(workspaceResolved.presetId, "system_examples");
  assert.equal(workspaceResolved.corpus.length, 1);
  assert.equal(animalsResolved.source, "system_preset");
  assert.equal(animalsResolved.presetId, "animals_examples");
  assert.equal(animalsResolved.corpus.length, 50);
  assert.match(animalsResolved.rawJson ?? "", /PrimateShorts/);
});
