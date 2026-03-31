import type { Stage2VNextFeatureFlagSnapshot } from "./contracts";

export function readStage2VNextBooleanFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function isStage2VNextEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return readStage2VNextBooleanFlag(env.STAGE2_VNEXT_ENABLED);
}

export function resolveStage2VNextEnabled(
  override?: boolean,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return typeof override === "boolean" ? override : isStage2VNextEnabled(env);
}

export function resolveStage2VNextFlagSnapshot(
  override?: boolean,
  env: NodeJS.ProcessEnv = process.env
): Stage2VNextFeatureFlagSnapshot {
  if (typeof override === "boolean") {
    return {
      STAGE2_VNEXT_ENABLED: override,
      source: "override",
      rawValue: null
    };
  }

  const rawValue = typeof env.STAGE2_VNEXT_ENABLED === "string" ? env.STAGE2_VNEXT_ENABLED : null;
  if (rawValue === null) {
    return {
      STAGE2_VNEXT_ENABLED: false,
      source: "default_false",
      rawValue: null
    };
  }

  return {
    STAGE2_VNEXT_ENABLED: readStage2VNextBooleanFlag(rawValue),
    source: "env",
    rawValue
  };
}
