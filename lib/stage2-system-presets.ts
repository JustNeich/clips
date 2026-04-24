import defaultExamples from "../data/examples.json";
import animalsExamples from "../data/animals_examples.json";
import {
  STAGE2_ANIMALS_REFERENCE_ONE_SHOT_PROMPT,
  STAGE2_REFERENCE_ONE_SHOT_PROMPT
} from "./stage2-prompt-specs";

export const STAGE2_SYSTEM_PROMPT_PRESETS = [
  {
    id: "system_prompt",
    label: "System prompt",
    description: "V6 general Shorts/Reels baseline for visually anchored, human-like overlays.",
    prompt: STAGE2_REFERENCE_ONE_SHOT_PROMPT
  },
  {
    id: "animals_system_prompt",
    label: "Animals system prompt",
    description: "V7 animal/nature baseline with archetype, stakes, and existential framing.",
    prompt: STAGE2_ANIMALS_REFERENCE_ONE_SHOT_PROMPT
  }
] as const;

export type Stage2SystemPromptPresetId = (typeof STAGE2_SYSTEM_PROMPT_PRESETS)[number]["id"];

export const DEFAULT_STAGE2_SYSTEM_PROMPT_PRESET_ID: Stage2SystemPromptPresetId = "system_prompt";

export const STAGE2_SYSTEM_EXAMPLES_PRESETS = [
  {
    id: "system_examples",
    label: "System examples",
    description: "General viral Shorts/Reels examples used by the default workspace corpus.",
    examples: defaultExamples
  },
  {
    id: "animals_examples",
    label: "Animals examples",
    description: "Animal/nature examples for the animals system prompt.",
    examples: animalsExamples
  }
] as const;

export type Stage2SystemExamplesPresetId = (typeof STAGE2_SYSTEM_EXAMPLES_PRESETS)[number]["id"];

export const DEFAULT_STAGE2_SYSTEM_EXAMPLES_PRESET_ID: Stage2SystemExamplesPresetId = "system_examples";

export function isStage2SystemPromptPresetId(value: unknown): value is Stage2SystemPromptPresetId {
  return STAGE2_SYSTEM_PROMPT_PRESETS.some((preset) => preset.id === value);
}

export function isStage2SystemExamplesPresetId(value: unknown): value is Stage2SystemExamplesPresetId {
  return STAGE2_SYSTEM_EXAMPLES_PRESETS.some((preset) => preset.id === value);
}

export function getStage2SystemPromptPreset(id: unknown) {
  return (
    STAGE2_SYSTEM_PROMPT_PRESETS.find((preset) => preset.id === id) ??
    STAGE2_SYSTEM_PROMPT_PRESETS[0]
  );
}

export function getStage2SystemExamplesPreset(id: unknown) {
  return (
    STAGE2_SYSTEM_EXAMPLES_PRESETS.find((preset) => preset.id === id) ??
    STAGE2_SYSTEM_EXAMPLES_PRESETS[0]
  );
}

export function findStage2SystemPromptPresetByPrompt(prompt: string): Stage2SystemPromptPresetId | null {
  const normalized = prompt.trim();
  return STAGE2_SYSTEM_PROMPT_PRESETS.find((preset) => preset.prompt.trim() === normalized)?.id ?? null;
}

export function findStage2SystemExamplesPresetByJson(rawJson: string): Stage2SystemExamplesPresetId | null {
  const normalized = normalizeComparableJson(rawJson);
  if (!normalized) {
    return null;
  }
  return (
    STAGE2_SYSTEM_EXAMPLES_PRESETS.find(
      (preset) => normalizeComparableJson(JSON.stringify(preset.examples)) === normalized
    )?.id ?? null
  );
}

export function getStage2SystemExamplesPresetJson(id: unknown): string {
  return JSON.stringify(getStage2SystemExamplesPreset(id).examples, null, 2);
}

function normalizeComparableJson(rawJson: string): string | null {
  try {
    return JSON.stringify(JSON.parse(rawJson));
  } catch {
    return null;
  }
}
