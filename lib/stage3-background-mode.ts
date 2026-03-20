import { templateUsesBuiltInBackdropFromRegistry } from "./stage3-template-registry";

export type Stage3BackgroundMode = "custom" | "source-blur" | "built-in" | "fallback";

export function resolveStage3BackgroundMode(
  templateId: string | null | undefined,
  options: {
    hasCustomBackground?: boolean | null;
    hasSourceVideo?: boolean | null;
  }
): Stage3BackgroundMode {
  if (options.hasCustomBackground) {
    return "custom";
  }
  if (options.hasSourceVideo) {
    return "source-blur";
  }
  if (templateUsesBuiltInBackdropFromRegistry(templateId)) {
    return "built-in";
  }
  return "fallback";
}
