export type Stage2SystemExamplesPresetId = "system_examples" | "animals_examples";

export type Stage2SystemExamplesPresetPayload = {
  id: Stage2SystemExamplesPresetId;
  label: string;
  description: string;
  examplesJson: string;
};

export const STAGE2_SYSTEM_EXAMPLES_PRESETS = [
  {
    id: "system_examples",
    label: "System examples",
    description: "General viral Shorts/Reels examples used by the default workspace corpus."
  },
  {
    id: "animals_examples",
    label: "Animals examples",
    description: "Animal/nature examples for the animals system prompt."
  }
] as const;

function normalizeComparableJson(rawJson: string): string | null {
  try {
    return JSON.stringify(JSON.parse(rawJson));
  } catch {
    return null;
  }
}

function resolvePresets(
  presets: Stage2SystemExamplesPresetPayload[] | null | undefined
): Stage2SystemExamplesPresetPayload[] {
  return presets?.length ? presets : [];
}

export function findStage2SystemExamplesPresetByJson(
  rawJson: string,
  presets?: Stage2SystemExamplesPresetPayload[] | null
): Stage2SystemExamplesPresetId | null {
  const normalized = normalizeComparableJson(rawJson);
  if (!normalized) {
    return null;
  }
  return (
    resolvePresets(presets).find((preset) => normalizeComparableJson(preset.examplesJson) === normalized)?.id ??
    null
  );
}

export function getStage2SystemExamplesPresetJson(
  id: unknown,
  presets?: Stage2SystemExamplesPresetPayload[] | null
): string {
  return (
    resolvePresets(presets).find((preset) => preset.id === id)?.examplesJson ??
    "[]"
  );
}
