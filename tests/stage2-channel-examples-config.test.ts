import assert from "node:assert/strict";
import test from "node:test";

import {
  collectChannelStage2Examples,
  normalizeStage2ExamplesConfig,
  parseStage2ExamplesJson,
  resolveStage2ExamplesCorpus
} from "../lib/stage2-channel-config";
import { STAGE2_REFERENCE_ONE_SHOT_PROMPT } from "../lib/stage2-prompt-specs";

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

test("workspace default examples resolve to an effective prompt-ready examples config", () => {
  const workspaceExamplesJson = JSON.stringify([
    {
      top: "This driver isn't parking, he's negotiating with physics.",
      bottom: "The cone lost that argument before it started."
    }
  ]);

  const resolved = resolveStage2ExamplesCorpus({
    channel: {
      id: OWNER.channelId,
      name: OWNER.channelName,
      stage2ExamplesConfig: normalizeStage2ExamplesConfig(
        {
          useWorkspaceDefault: true
        },
        OWNER
      )
    },
    workspaceStage2ExamplesCorpusJson: workspaceExamplesJson
  });

  assert.equal(resolved.source, "workspace_default");
  assert.equal(resolved.corpus.length, 1);
  assert.equal(resolved.effectiveConfig.useWorkspaceDefault, false);
  assert.equal(resolved.effectiveConfig.sourceMode, "custom");
  assert.match(resolved.effectiveConfig.customExamplesJson ?? "", /negotiating with physics/);
  assert.equal(resolved.effectiveConfig.customExamples.length, 1);
});
