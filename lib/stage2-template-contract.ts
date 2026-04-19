import type { Stage2HardConstraints } from "./stage2-channel-config";
import type { Stage3TemplateConfig } from "./stage3-template";
import { resolveManagedTemplateRuntimeSync } from "./managed-template-runtime";
import { resolveTemplateStage2HardConstraints } from "./stage3-template-semantics";

export function resolveStage2TemplateConfig(input: {
  templateId?: string | null;
  workspaceId?: string | null;
}): Stage3TemplateConfig {
  return resolveManagedTemplateRuntimeSync(input.templateId ?? null, null, {
    workspaceId: input.workspaceId ?? null
  }).templateConfig;
}

export function resolveEffectiveStage2HardConstraints(input: {
  hardConstraints: Stage2HardConstraints;
  templateId?: string | null;
  workspaceId?: string | null;
}): Stage2HardConstraints {
  return resolveTemplateStage2HardConstraints(
    input.hardConstraints,
    resolveStage2TemplateConfig({
      templateId: input.templateId,
      workspaceId: input.workspaceId
    })
  );
}
