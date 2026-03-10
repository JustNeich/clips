import { Stage3ExecutionTarget } from "../app/components/types";

function normalizeExecutionTarget(value: string | null | undefined): Stage3ExecutionTarget | null {
  if (value === "host" || value === "local") {
    return value;
  }
  return null;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return fallback;
  }
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function isHostStage3ExecutionAllowed(): boolean {
  return readBooleanEnv("STAGE3_ALLOW_HOST_EXECUTION", false);
}

export function getDefaultStage3ExecutionTarget(): Stage3ExecutionTarget {
  const configured = normalizeExecutionTarget(process.env.STAGE3_DEFAULT_EXECUTION_TARGET?.trim());
  if (configured === "host" && isHostStage3ExecutionAllowed()) {
    return "host";
  }
  return configured ?? "local";
}

export function resolveStage3ExecutionTarget(preferred?: Stage3ExecutionTarget | null): Stage3ExecutionTarget {
  if (preferred === "host") {
    return isHostStage3ExecutionAllowed() ? "host" : "local";
  }
  if (preferred === "local") {
    return "local";
  }
  return getDefaultStage3ExecutionTarget();
}
