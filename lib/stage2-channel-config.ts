import bundledExamplesJson from "../data/examples.json";
import animalsExamplesJson from "../data/stage2-animals-examples.json";
import {
  STAGE2_ANIMALS_REFERENCE_ONE_SHOT_PROMPT,
  STAGE2_ANIMALS_REFERENCE_ONE_SHOT_PROMPT_VERSION,
  STAGE2_REFERENCE_ONE_SHOT_PROMPT_VERSION
} from "./stage2-prompt-specs";
import {
  getStage2DefaultPromptCompatibility,
  normalizeStage2PromptConfig,
  type Stage2PromptConfig
} from "./stage2-pipeline";

export type Stage2HardConstraints = {
  topLengthMin: number;
  topLengthMax: number;
  bottomLengthMin: number;
  bottomLengthMax: number;
  bannedWords: string[];
  bannedOpeners: string[];
};

export type Stage2CorpusExample = {
  id: string;
  ownerChannelId: string;
  ownerChannelName: string;
  sourceChannelId: string;
  sourceChannelName: string;
  title: string;
  overlayTop: string;
  overlayBottom: string;
  transcript: string;
  clipType: string;
  whyItWorks: string[];
  qualityScore: number | null;
};

export type Stage2ExamplesCorpusSource =
  | "workspace_default"
  | "system_preset"
  | "channel_custom";

export type Stage2PromptSelectionMode = "system" | "custom";
export type Stage2SystemPromptPresetId = "system_prompt" | "animals_system_prompt";
export type Stage2SystemExamplesPresetId = "system_examples" | "animals_examples";

export type Stage2ExamplesConfig = {
  version: 1 | 2;
  useWorkspaceDefault: boolean;
  promptMode?: Stage2PromptSelectionMode;
  systemPromptPresetId?: Stage2SystemPromptPresetId;
  customSystemPrompt?: string;
  systemExamplesPresetId?: Stage2SystemExamplesPresetId;
  customExamplesJson?: string;
  customExamplesText?: string;
  customExamples: Stage2CorpusExample[];
};

export const DEFAULT_STAGE2_HARD_CONSTRAINTS: Stage2HardConstraints = {
  topLengthMin: 18,
  topLengthMax: 80,
  bottomLengthMin: 22,
  bottomLengthMax: 110,
  bannedWords: [],
  bannedOpeners: []
};

export const DEFAULT_STAGE2_EXAMPLES_CONFIG: Stage2ExamplesConfig = {
  version: 2,
  useWorkspaceDefault: true,
  promptMode: "system",
  systemPromptPresetId: "system_prompt",
  customSystemPrompt: "",
  systemExamplesPresetId: "system_examples",
  customExamplesJson: "",
  customExamplesText: "",
  customExamples: []
};

const STAGE2_SYSTEM_PROMPT_PRESET_OPTIONS: Array<{
  value: Stage2SystemPromptPresetId;
  label: string;
  description: string;
}> = [
  {
    value: "system_prompt",
    label: "system_prompt",
    description: "Текущий workspace baseline one-shot prompt."
  },
  {
    value: "animals_system_prompt",
    label: "animals_system_prompt",
    description: "Animal / nature stakes-driven preset."
  }
];

const STAGE2_SYSTEM_EXAMPLES_PRESET_OPTIONS: Array<{
  value: Stage2SystemExamplesPresetId;
  label: string;
  description: string;
}> = [
  {
    value: "system_examples",
    label: "system_examples",
    description: "Текущий workspace corpus / bundled default examples."
  },
  {
    value: "animals_examples",
    label: "animals_examples",
    description: "Animal / nature reference corpus."
  }
];
const WORKSPACE_STAGE2_CORPUS_OWNER = {
  channelId: "workspace-default",
  channelName: "Workspace default"
} as const;

function sanitizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeBoundedText(value: unknown, limit: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > limit ? text.slice(0, limit) : text;
}

function sanitizeExamplesTextBlock(value: unknown): string {
  return sanitizeBoundedText(value, 80_000);
}

function sanitizePromptTextBlock(value: unknown): string {
  return sanitizeBoundedText(value, 80_000);
}

const STAGE2_STRING_LIST_SPLIT_PATTERN = /(?:\r?\n|,|;)+/g;

export function parseStage2DelimitedStringList(value: unknown): string[] {
  const entries = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(STAGE2_STRING_LIST_SPLIT_PATTERN)
      : [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of entries) {
    const sanitized = sanitizeString(entry);
    if (!sanitized) {
      continue;
    }
    const dedupeKey = sanitized.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    normalized.push(sanitized);
  }
  return normalized;
}

export function formatStage2DelimitedStringList(values: readonly string[]): string {
  return parseStage2DelimitedStringList(values).join(", ");
}

function sanitizeStringList(value: unknown): string[] {
  return parseStage2DelimitedStringList(value);
}

function compactUnknownForExample(value: unknown, maxLength = 180): string {
  if (typeof value === "string") {
    return sanitizeString(value).slice(0, maxLength);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value).slice(0, maxLength);
  } catch {
    return "";
  }
}

function findFirstMeaningfulString(candidate: Record<string, unknown>): string {
  for (const value of Object.values(candidate)) {
    const text = sanitizeString(value);
    if (text.length >= 8) {
      return text;
    }
  }
  return "";
}

function sanitizeNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeCorpusExample(
  input: unknown,
  fallbackOwner: { channelId: string; channelName: string },
  index: number
): Stage2CorpusExample | null {
  const candidate = input && typeof input === "object" ? (input as Record<string, unknown>) : null;
  if (!candidate) {
    return null;
  }

  const title = sanitizeString(candidate.title ?? candidate.headline ?? candidate.name);
  const overlayTop = sanitizeString(
    candidate.overlayTop ??
      candidate.top ??
      candidate.overlay_top ??
      candidate.overlay_top_text ??
      candidate.topText ??
      candidate.top_caption
  );
  const overlayBottom = sanitizeString(
    candidate.overlayBottom ??
      candidate.bottom ??
      candidate.overlay_bottom ??
      candidate.overlay_bottom_text ??
      candidate.bottomText ??
      candidate.bottom_caption
  );
  const transcript = sanitizeString(
    candidate.transcript ??
      candidate.description ??
      candidate.text ??
      candidate.content ??
      candidate.caption ??
      candidate.overlayFull ??
      candidate.full_caption
  );
  const fallbackCaptionText = sanitizeString(
    candidate.text ?? candidate.content ?? candidate.caption ?? candidate.description ?? candidate.transcript
  );
  const firstFallbackText = findFirstMeaningfulString(candidate);
  if (!title && !overlayTop && !overlayBottom && !transcript && !firstFallbackText) {
    return null;
  }

  const ownerChannelId =
    sanitizeString(candidate.ownerChannelId ?? candidate.channelId) || fallbackOwner.channelId;
  const ownerChannelName =
    sanitizeString(candidate.ownerChannelName ?? candidate.channelName ?? candidate.channel) ||
    fallbackOwner.channelName;
  const sourceChannelId =
    sanitizeString(candidate.sourceChannelId ?? candidate.channelId) || ownerChannelId;
  const sourceChannelName =
    sanitizeString(candidate.sourceChannelName ?? candidate.channelName ?? candidate.channel) ||
    ownerChannelName;

  return {
    id:
      sanitizeString(candidate.id ?? candidate.exampleId ?? candidate.videoId) ||
      `${ownerChannelId}__example_${index + 1}`,
    ownerChannelId,
    ownerChannelName,
    sourceChannelId,
    sourceChannelName,
    title: title || overlayTop || overlayBottom || firstFallbackText.slice(0, 120),
    overlayTop: overlayTop || fallbackCaptionText.slice(0, 210) || firstFallbackText.slice(0, 210),
    overlayBottom: overlayBottom || transcript.slice(0, 160),
    transcript,
    clipType: sanitizeString(candidate.clipType ?? candidate.inferred_clip_type) || "general",
    whyItWorks:
      sanitizeStringList(candidate.whyItWorks ?? candidate.why_it_works).length > 0
        ? sanitizeStringList(candidate.whyItWorks ?? candidate.why_it_works)
        : Object.entries(candidate)
            .slice(0, 10)
            .map(([key, value]) => `${key}: ${compactUnknownForExample(value)}`)
            .filter((entry) => entry.length > 3)
            .slice(0, 6),
    qualityScore:
      candidate.qualityScore === null || candidate.qualityScore === undefined
        ? null
        : sanitizeNumber(candidate.qualityScore, 0)
  };
}

export function parseStage2ExamplesJson(
  raw: string | null | undefined,
  fallbackOwner: { channelId: string; channelName: string }
): Stage2CorpusExample[] {
  const trimmed = sanitizeString(raw);
  if (!trimmed) {
    return [];
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const entries = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object"
        ? Array.isArray((parsed as { examples?: unknown }).examples)
          ? ((parsed as { examples: unknown[] }).examples ?? [])
          : Array.isArray((parsed as { items?: unknown }).items)
            ? ((parsed as { items: unknown[] }).items ?? [])
            : [parsed]
        : [];

    return entries
      .map((entry, index) => normalizeCorpusExample(entry, fallbackOwner, index))
      .filter((entry): entry is Stage2CorpusExample => entry !== null);
  } catch {
    return [];
  }
}

const BUNDLED_STAGE2_EXAMPLES_SEED = dedupeStage2CorpusExamples(
  parseStage2ExamplesJson(JSON.stringify(bundledExamplesJson), WORKSPACE_STAGE2_CORPUS_OWNER).map(
    (example) => ({
      ...example,
      ownerChannelId: WORKSPACE_STAGE2_CORPUS_OWNER.channelId,
      ownerChannelName: WORKSPACE_STAGE2_CORPUS_OWNER.channelName,
      sourceChannelId: example.sourceChannelId || WORKSPACE_STAGE2_CORPUS_OWNER.channelId,
      sourceChannelName: example.sourceChannelName || WORKSPACE_STAGE2_CORPUS_OWNER.channelName
    })
  )
);

export function getBundledStage2ExamplesSeed(): Stage2CorpusExample[] {
  return BUNDLED_STAGE2_EXAMPLES_SEED.map((example) => ({
    ...example,
    whyItWorks: [...example.whyItWorks]
  }));
}

export function getBundledStage2ExamplesSeedJson(): string {
  return JSON.stringify(getBundledStage2ExamplesSeed(), null, 2);
}

const ANIMALS_STAGE2_EXAMPLES_SEED = dedupeStage2CorpusExamples(
  parseStage2ExamplesJson(JSON.stringify(animalsExamplesJson), WORKSPACE_STAGE2_CORPUS_OWNER).map(
    (example) => ({
      ...example,
      ownerChannelId: WORKSPACE_STAGE2_CORPUS_OWNER.channelId,
      ownerChannelName: WORKSPACE_STAGE2_CORPUS_OWNER.channelName,
      sourceChannelId: example.sourceChannelId || WORKSPACE_STAGE2_CORPUS_OWNER.channelId,
      sourceChannelName: example.sourceChannelName || WORKSPACE_STAGE2_CORPUS_OWNER.channelName
    })
  )
);

const ANIMALS_STAGE2_EXAMPLES_JSON = JSON.stringify(animalsExamplesJson, null, 2);

function sanitizePromptMode(value: unknown): Stage2PromptSelectionMode {
  return value === "custom" ? "custom" : "system";
}

function sanitizeSystemPromptPresetId(value: unknown): Stage2SystemPromptPresetId {
  return value === "animals_system_prompt" ? "animals_system_prompt" : "system_prompt";
}

function sanitizeSystemExamplesPresetId(value: unknown): Stage2SystemExamplesPresetId {
  return value === "animals_examples" ? "animals_examples" : "system_examples";
}

function resolveWorkspaceExamplesRawJson(
  workspaceStage2ExamplesCorpusJson: string | null | undefined
): string {
  const trimmed = sanitizeString(workspaceStage2ExamplesCorpusJson);
  if (!trimmed) {
    return JSON.stringify(bundledExamplesJson, null, 2);
  }
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    return JSON.stringify(bundledExamplesJson, null, 2);
  }
}

export function getStage2SystemPromptPresetOptions(): Array<{
  value: Stage2SystemPromptPresetId;
  label: string;
  description: string;
}> {
  return STAGE2_SYSTEM_PROMPT_PRESET_OPTIONS.map((option) => ({ ...option }));
}

export function getStage2SystemExamplesPresetOptions(): Array<{
  value: Stage2SystemExamplesPresetId;
  label: string;
  description: string;
}> {
  return STAGE2_SYSTEM_EXAMPLES_PRESET_OPTIONS.map((option) => ({ ...option }));
}

export function resolveStage2ChannelPromptSelection(input: {
  stage2ExamplesConfig?: Stage2ExamplesConfig | null;
  workspacePromptConfig?: Stage2PromptConfig | null;
}): {
  source: "workspace_default" | "system_preset" | "channel_custom";
  mode: Stage2PromptSelectionMode;
  presetId: Stage2SystemPromptPresetId;
  promptText: string;
  promptVersion: string;
} {
  const workspacePromptConfig = normalizeStage2PromptConfig(input.workspacePromptConfig);
  const config = normalizeStage2ExamplesConfig(
    input.stage2ExamplesConfig,
    WORKSPACE_STAGE2_CORPUS_OWNER
  );
  const customPrompt = sanitizePromptTextBlock(config.customSystemPrompt);
  if (config.promptMode === "custom" && customPrompt) {
    return {
      source: "channel_custom",
      mode: "custom",
      presetId: config.systemPromptPresetId ?? "system_prompt",
      promptText: customPrompt,
      promptVersion: "channel_custom_prompt"
    };
  }
  if (config.systemPromptPresetId === "animals_system_prompt") {
    return {
      source: "system_preset",
      mode: "system",
      presetId: "animals_system_prompt",
      promptText: STAGE2_ANIMALS_REFERENCE_ONE_SHOT_PROMPT,
      promptVersion: STAGE2_ANIMALS_REFERENCE_ONE_SHOT_PROMPT_VERSION
    };
  }
  return {
    source: "workspace_default",
    mode: "system",
    presetId: "system_prompt",
    promptText: workspacePromptConfig.stages.oneShotReference.prompt,
    promptVersion:
      workspacePromptConfig.stages.oneShotReference.compatibility?.bundleVersion ??
      STAGE2_REFERENCE_ONE_SHOT_PROMPT_VERSION
  };
}

export function applyChannelStage2PromptSelection(input: {
  workspacePromptConfig?: Stage2PromptConfig | null;
  stage2ExamplesConfig?: Stage2ExamplesConfig | null;
}): {
  promptConfig: Stage2PromptConfig;
  promptConfigSource: "workspace_override" | "channel_override";
  selection: ReturnType<typeof resolveStage2ChannelPromptSelection>;
} {
  const workspacePromptConfig = normalizeStage2PromptConfig(input.workspacePromptConfig);
  const selection = resolveStage2ChannelPromptSelection({
    stage2ExamplesConfig: input.stage2ExamplesConfig,
    workspacePromptConfig
  });
  if (selection.source === "workspace_default") {
    return {
      promptConfig: workspacePromptConfig,
      promptConfigSource: "workspace_override",
      selection
    };
  }

  return {
    promptConfig: normalizeStage2PromptConfig({
      ...workspacePromptConfig,
      stages: {
        ...workspacePromptConfig.stages,
        oneShotReference: {
          ...workspacePromptConfig.stages.oneShotReference,
          prompt: selection.promptText,
          compatibility: getStage2DefaultPromptCompatibility("oneShotReference")
        }
      }
    }),
    promptConfigSource: "channel_override",
    selection
  };
}

export function normalizeStage2HardConstraints(input: unknown): Stage2HardConstraints {
  const candidate =
    input && typeof input === "object" ? (input as Partial<Stage2HardConstraints>) : undefined;

  return {
    topLengthMin: sanitizeNumber(candidate?.topLengthMin, DEFAULT_STAGE2_HARD_CONSTRAINTS.topLengthMin),
    topLengthMax: sanitizeNumber(candidate?.topLengthMax, DEFAULT_STAGE2_HARD_CONSTRAINTS.topLengthMax),
    bottomLengthMin: sanitizeNumber(
      candidate?.bottomLengthMin,
      DEFAULT_STAGE2_HARD_CONSTRAINTS.bottomLengthMin
    ),
    bottomLengthMax: sanitizeNumber(
      candidate?.bottomLengthMax,
      DEFAULT_STAGE2_HARD_CONSTRAINTS.bottomLengthMax
    ),
    bannedWords:
      sanitizeStringList(candidate?.bannedWords).length > 0
        ? sanitizeStringList(candidate?.bannedWords)
        : [...DEFAULT_STAGE2_HARD_CONSTRAINTS.bannedWords],
    bannedOpeners:
      sanitizeStringList(candidate?.bannedOpeners).length > 0
        ? sanitizeStringList(candidate?.bannedOpeners)
        : [...DEFAULT_STAGE2_HARD_CONSTRAINTS.bannedOpeners]
  };
}

export function parseStage2HardConstraintsJson(
  raw: string | null | undefined
): Stage2HardConstraints {
  const trimmed = sanitizeString(raw);
  if (!trimmed) {
    return DEFAULT_STAGE2_HARD_CONSTRAINTS;
  }
  try {
    return normalizeStage2HardConstraints(JSON.parse(trimmed));
  } catch {
    return DEFAULT_STAGE2_HARD_CONSTRAINTS;
  }
}

export function stringifyStage2HardConstraints(constraints: Stage2HardConstraints): string {
  return JSON.stringify(normalizeStage2HardConstraints(constraints));
}

export function normalizeStage2ExamplesConfig(
  input: unknown,
  fallbackOwner: { channelId: string; channelName: string }
): Stage2ExamplesConfig {
  const candidate =
    input && typeof input === "object" ? (input as Partial<Stage2ExamplesConfig>) : undefined;

  const useWorkspaceDefaultCandidate =
    typeof candidate?.useWorkspaceDefault === "boolean"
      ? candidate.useWorkspaceDefault
      : sanitizeString((candidate as { mode?: unknown } | undefined)?.mode) !== "manual";
  const promptMode = sanitizePromptMode(
    candidate?.promptMode ??
      (candidate as { promptSource?: unknown } | undefined)?.promptSource ??
      (candidate as { systemPromptMode?: unknown } | undefined)?.systemPromptMode
  );
  const systemPromptPresetId = sanitizeSystemPromptPresetId(
    candidate?.systemPromptPresetId ??
      (candidate as { promptPresetId?: unknown } | undefined)?.promptPresetId
  );
  const customSystemPrompt = sanitizePromptTextBlock(
    candidate?.customSystemPrompt ??
      (candidate as { customPromptText?: unknown } | undefined)?.customPromptText ??
      (candidate as { systemPrompt?: unknown } | undefined)?.systemPrompt
  );
  const systemExamplesPresetId = sanitizeSystemExamplesPresetId(
    (candidate as { systemExamplesPresetId?: unknown } | undefined)?.systemExamplesPresetId ??
      (candidate as { examplesPresetId?: unknown } | undefined)?.examplesPresetId
  );
  const customExamplesRaw = Array.isArray(candidate?.customExamples)
    ? candidate.customExamples
    : Array.isArray((candidate as { manualExamples?: unknown[] } | undefined)?.manualExamples)
      ? ((candidate as { manualExamples: unknown[] }).manualExamples ?? [])
      : [];
  const customExamplesJson = sanitizeExamplesTextBlock(
    candidate?.customExamplesJson ??
      (candidate as { rawExamplesJson?: unknown } | undefined)?.rawExamplesJson ??
      (candidate as { examplesJson?: unknown } | undefined)?.examplesJson
  );
  const customExamplesText = sanitizeExamplesTextBlock(
    candidate?.customExamplesText ??
      (candidate as { plainTextExamples?: unknown } | undefined)?.plainTextExamples ??
      (candidate as { examplesText?: unknown } | undefined)?.examplesText
  );
  const customExamplesFromJson = parseStage2ExamplesJson(customExamplesJson, fallbackOwner);
  const legacyCustomExamples = customExamplesJson
    ? []
    : customExamplesRaw
      .map((entry, index) => normalizeCorpusExample(entry, fallbackOwner, index))
      .filter((entry): entry is Stage2CorpusExample => entry !== null);

  return {
    version: 2,
    useWorkspaceDefault: useWorkspaceDefaultCandidate,
    promptMode,
    systemPromptPresetId,
    customSystemPrompt,
    systemExamplesPresetId,
    customExamplesJson,
    customExamplesText,
    customExamples: dedupeStage2CorpusExamples([...customExamplesFromJson, ...legacyCustomExamples])
  };
}

export function parseStage2ExamplesConfigJson(
  raw: string | null | undefined,
  fallbackOwner: { channelId: string; channelName: string }
): Stage2ExamplesConfig {
  const trimmed = sanitizeString(raw);
  if (!trimmed) {
    return DEFAULT_STAGE2_EXAMPLES_CONFIG;
  }
  try {
    return normalizeStage2ExamplesConfig(JSON.parse(trimmed), fallbackOwner);
  } catch {
    return DEFAULT_STAGE2_EXAMPLES_CONFIG;
  }
}

export function stringifyStage2ExamplesConfig(
  config: Stage2ExamplesConfig,
  fallbackOwner: { channelId: string; channelName: string }
): string {
  return JSON.stringify(normalizeStage2ExamplesConfig(config, fallbackOwner));
}

export function dedupeStage2CorpusExamples(
  examples: Stage2CorpusExample[]
): Stage2CorpusExample[] {
  const seen = new Set<string>();
  const deduped: Stage2CorpusExample[] = [];
  for (const example of examples) {
    const key = [
      example.id,
      example.ownerChannelId,
      example.sourceChannelId,
      example.title,
      example.overlayTop,
      example.overlayBottom
    ]
      .map((value) => sanitizeString(value))
      .join("::");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(example);
  }
  return deduped;
}

export function collectChannelStage2Examples(input: {
  channel: {
    id: string;
    name: string;
    stage2ExamplesConfig?: Stage2ExamplesConfig | null;
  };
}): Stage2CorpusExample[] {
  const fallbackOwner = {
    channelId: input.channel.id,
    channelName: input.channel.name
  };
  const configured = input.channel.stage2ExamplesConfig?.customExamples ?? [];
  if (configured.length === 0) {
    return [];
  }

  return dedupeStage2CorpusExamples(
    configured
      .map((example, index) => normalizeCorpusExample(example, fallbackOwner, index))
      .filter((example): example is Stage2CorpusExample => example !== null)
      .map((example) => ({
        ...example,
        ownerChannelId: example.ownerChannelId || fallbackOwner.channelId,
        ownerChannelName: example.ownerChannelName || fallbackOwner.channelName
      }))
  );
}

export function collectWorkspaceStage2Examples(
  workspaceStage2ExamplesCorpusJson: string | null | undefined
): Stage2CorpusExample[] {
  return dedupeStage2CorpusExamples(
    parseStage2ExamplesJson(
      resolveWorkspaceExamplesRawJson(workspaceStage2ExamplesCorpusJson),
      WORKSPACE_STAGE2_CORPUS_OWNER
    )
  );
}

export function resolveStage2ExamplesCorpus(input: {
  channel: {
    id: string;
    name: string;
    stage2ExamplesConfig: Stage2ExamplesConfig;
  };
  workspaceStage2ExamplesCorpusJson: string | null | undefined;
}): {
  source: Stage2ExamplesCorpusSource;
  corpus: Stage2CorpusExample[];
  workspaceCorpusCount: number;
  rawJson: string | null;
  rawText: string | null;
  presetId: Stage2SystemExamplesPresetId | null;
} {
  const workspaceRawJson = resolveWorkspaceExamplesRawJson(input.workspaceStage2ExamplesCorpusJson);
  const workspaceCorpus = collectWorkspaceStage2Examples(input.workspaceStage2ExamplesCorpusJson);
  if (!input.channel.stage2ExamplesConfig.useWorkspaceDefault) {
    return {
      source: "channel_custom",
      corpus: dedupeStage2CorpusExamples(input.channel.stage2ExamplesConfig.customExamples),
      workspaceCorpusCount: workspaceCorpus.length,
      rawJson: sanitizeString(input.channel.stage2ExamplesConfig.customExamplesJson) || null,
      rawText: sanitizeString(input.channel.stage2ExamplesConfig.customExamplesText) || null,
      presetId: null
    };
  }

  if (input.channel.stage2ExamplesConfig.systemExamplesPresetId === "animals_examples") {
    return {
      source: "system_preset",
      corpus: ANIMALS_STAGE2_EXAMPLES_SEED.map((example) => ({
        ...example,
        whyItWorks: [...example.whyItWorks]
      })),
      workspaceCorpusCount: workspaceCorpus.length,
      rawJson: ANIMALS_STAGE2_EXAMPLES_JSON,
      rawText: null,
      presetId: "animals_examples"
    };
  }

  return {
    source: "workspace_default",
    corpus: workspaceCorpus,
    workspaceCorpusCount: workspaceCorpus.length,
    rawJson: workspaceRawJson,
    rawText: null,
    presetId: "system_examples"
  };
}
