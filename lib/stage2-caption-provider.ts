export const DEFAULT_ANTHROPIC_CAPTION_MODEL = "claude-opus-4-6";
export const DEFAULT_OPENROUTER_CAPTION_MODEL = "anthropic/claude-opus-4.7";

export type Stage2CaptionProvider = "codex" | "anthropic" | "openrouter";

export type Stage2CaptionProviderConfig = {
  provider: Stage2CaptionProvider;
  anthropicModel: string | null;
  openrouterModel: string | null;
};

export type WorkspaceAnthropicIntegrationStatus = "connected" | "disconnected" | "error";
export type WorkspaceOpenRouterIntegrationStatus = "connected" | "disconnected" | "error";

export const DEFAULT_STAGE2_CAPTION_PROVIDER_CONFIG: Stage2CaptionProviderConfig = {
  provider: "codex",
  anthropicModel: DEFAULT_ANTHROPIC_CAPTION_MODEL,
  openrouterModel: DEFAULT_OPENROUTER_CAPTION_MODEL
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeAnthropicModel(value: unknown): string | null {
  if (typeof value !== "string") {
    return DEFAULT_ANTHROPIC_CAPTION_MODEL;
  }
  const trimmed = value.trim();
  return trimmed || DEFAULT_ANTHROPIC_CAPTION_MODEL;
}

function normalizeOpenRouterModel(value: unknown): string | null {
  if (typeof value !== "string") {
    return DEFAULT_OPENROUTER_CAPTION_MODEL;
  }
  const trimmed = value.trim();
  return trimmed || DEFAULT_OPENROUTER_CAPTION_MODEL;
}

export function normalizeStage2CaptionProviderConfig(
  value: unknown
): Stage2CaptionProviderConfig {
  let candidate: Record<string, unknown> | null = null;
  if (typeof value === "string") {
    try {
      candidate = asRecord(JSON.parse(value || "null"));
    } catch {
      candidate = null;
    }
  } else {
    candidate = asRecord(value);
  }
  const provider =
    candidate?.provider === "anthropic"
      ? "anthropic"
      : candidate?.provider === "openrouter"
        ? "openrouter"
        : "codex";
  return {
    provider,
    anthropicModel: normalizeAnthropicModel(candidate?.anthropicModel),
    openrouterModel: normalizeOpenRouterModel(candidate?.openrouterModel)
  };
}

export function parseStage2CaptionProviderConfigJson(
  value: string | null | undefined
): Stage2CaptionProviderConfig {
  if (!value?.trim()) {
    return { ...DEFAULT_STAGE2_CAPTION_PROVIDER_CONFIG };
  }
  try {
    return normalizeStage2CaptionProviderConfig(value);
  } catch {
    return { ...DEFAULT_STAGE2_CAPTION_PROVIDER_CONFIG };
  }
}

export function stringifyStage2CaptionProviderConfig(
  value: Stage2CaptionProviderConfig
): string {
  return JSON.stringify(normalizeStage2CaptionProviderConfig(value));
}

export type Stage2HybridCaptionStageId =
  | "classicOneShot"
  | "storyOneShot"
  | "oneShotReference"
  | "regenerate";

const ANTHROPIC_CAPTION_STAGE_IDS = new Set<Stage2HybridCaptionStageId>([
  "classicOneShot",
  "storyOneShot",
  "oneShotReference",
  "regenerate"
]);

export function isCaptionProviderRoutedStage(
  stageId: string
): stageId is Stage2HybridCaptionStageId {
  return ANTHROPIC_CAPTION_STAGE_IDS.has(stageId as Stage2HybridCaptionStageId);
}

export const isAnthropicCaptionStage = isCaptionProviderRoutedStage;
