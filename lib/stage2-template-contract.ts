import type { Stage2HardConstraints } from "./stage2-channel-config";
import type { Stage3TemplateConfig } from "./stage3-template";
import { resolveManagedTemplateRuntimeSync } from "./managed-template-runtime";
import {
  resolveTemplateLeadMode,
  resolveTemplateStage2HardConstraints,
  resolveTemplateTextFieldSemantics,
  type Stage3TemplateFormatGroup,
  type Stage3TemplateTextFieldSemantics
} from "./stage3-template-semantics";

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

export type Stage2TemplateSemanticsSnapshot = Stage3TemplateTextFieldSemantics & {
  leadMode: ReturnType<typeof resolveTemplateLeadMode>;
  lengthHints: Pick<
    Stage2HardConstraints,
    "topLengthMin" | "topLengthMax" | "bottomLengthMin" | "bottomLengthMax"
  >;
};

export function resolveStage2TemplateTextSemantics(input: {
  templateId?: string | null;
  workspaceId?: string | null;
  hardConstraints: Stage2HardConstraints;
}): Stage2TemplateSemanticsSnapshot {
  const templateConfig = resolveStage2TemplateConfig({
    templateId: input.templateId,
    workspaceId: input.workspaceId
  });
  const semantics = resolveTemplateTextFieldSemantics(templateConfig);
  const lengthHints = resolveTemplateStage2HardConstraints(input.hardConstraints, templateConfig);
  return {
    ...semantics,
    leadMode: resolveTemplateLeadMode(templateConfig),
    lengthHints: {
      topLengthMin: lengthHints.topLengthMin,
      topLengthMax: lengthHints.topLengthMax,
      bottomLengthMin: lengthHints.bottomLengthMin,
      bottomLengthMax: lengthHints.bottomLengthMax
    }
  };
}

export function resolveStage2TemplateFormatGroup(input: {
  templateId?: string | null;
  workspaceId?: string | null;
}): Stage3TemplateFormatGroup {
  return resolveTemplateTextFieldSemantics(
    resolveStage2TemplateConfig({
      templateId: input.templateId,
      workspaceId: input.workspaceId
    })
  ).formatGroup;
}
