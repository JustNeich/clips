import type { Stage2HardConstraints } from "./stage2-channel-config";
import type { Stage3TemplateConfig } from "./stage3-template";
import {
  cloneTemplateCaptionHighlights,
  type TemplateCaptionHighlights
} from "./template-highlights";

export type Stage3TemplateLayoutKind = "classic_top_bottom" | "channel_story";
export type Stage3TemplateFormatGroup = Stage3TemplateLayoutKind;
export type Stage3TemplateLeadMode = "off" | "template_default" | "clip_custom";

export type Stage3TemplateResolvedText = {
  topText: string;
  bottomText: string;
  highlights: TemplateCaptionHighlights;
  leadMode: Stage3TemplateLeadMode;
};

export type Stage3TemplateTextFieldSemantics = {
  formatGroup: Stage3TemplateFormatGroup;
  formatLabel: string;
  topLabel: string;
  bottomLabel: string;
  topVisible: boolean;
  bottomVisible: boolean;
  topOptional: boolean;
  topNote: string | null;
  bottomNote: string | null;
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function resolveTemplateLayoutKind(
  templateConfig: Pick<Stage3TemplateConfig, "layoutKind"> | null | undefined
): Stage3TemplateLayoutKind {
  return templateConfig?.layoutKind === "channel_story" ? "channel_story" : "classic_top_bottom";
}

export function resolveTemplateFormatGroupLabel(formatGroup: Stage3TemplateFormatGroup): string {
  return formatGroup === "channel_story" ? "Channel + Story" : "Top & Bottom";
}

export function resolveTemplateLeadMode(
  templateConfig: Stage3TemplateConfig | null | undefined
): Stage3TemplateLeadMode {
  if (resolveTemplateLayoutKind(templateConfig) !== "channel_story") {
    return "clip_custom";
  }
  return templateConfig?.channelStory?.leadMode ?? "clip_custom";
}

export function resolveTemplateDefaultLeadText(
  templateConfig: Stage3TemplateConfig | null | undefined
): string {
  if (resolveTemplateLayoutKind(templateConfig) !== "channel_story") {
    return "";
  }
  return normalizeText(templateConfig?.channelStory?.defaultLeadText);
}

export function resolveTemplateTextFieldSemantics(
  templateConfig: Stage3TemplateConfig | null | undefined
): Stage3TemplateTextFieldSemantics {
  const formatGroup = resolveTemplateLayoutKind(templateConfig);
  if (formatGroup === "classic_top_bottom") {
    return {
      formatGroup,
      formatLabel: resolveTemplateFormatGroupLabel(formatGroup),
      topLabel: "TOP",
      bottomLabel: "BOTTOM",
      topVisible: true,
      bottomVisible: true,
      topOptional: false,
      topNote: null,
      bottomNote: null
    };
  }

  const leadMode = resolveTemplateLeadMode(templateConfig);
  if (leadMode === "off") {
    return {
      formatGroup,
      formatLabel: resolveTemplateFormatGroupLabel(formatGroup),
      topLabel: "Lead",
      bottomLabel: "Body",
      topVisible: false,
      bottomVisible: true,
      topOptional: true,
      topNote: "Этот шаблон не использует отдельный lead.",
      bottomNote: null
    };
  }

  if (leadMode === "template_default") {
    const defaultLead = resolveTemplateDefaultLeadText(templateConfig);
    return {
      formatGroup,
      formatLabel: resolveTemplateFormatGroupLabel(formatGroup),
      topLabel: "Lead",
      bottomLabel: "Body",
      topVisible: false,
      bottomVisible: true,
      topOptional: true,
      topNote: defaultLead ? `Шаблон сам подставит lead: ${defaultLead}` : "Lead задаётся в самом шаблоне.",
      bottomNote: null
    };
  }

  return {
    formatGroup,
    formatLabel: resolveTemplateFormatGroupLabel(formatGroup),
    topLabel: "Lead",
    bottomLabel: "Body",
    topVisible: true,
    bottomVisible: true,
    topOptional: false,
    topNote: null,
    bottomNote: null
  };
}

export function resolveTemplateRenderText(input: {
  templateConfig: Stage3TemplateConfig | null | undefined;
  topText: string;
  bottomText: string;
  highlights: TemplateCaptionHighlights | null | undefined;
}): Stage3TemplateResolvedText {
  const leadMode = resolveTemplateLeadMode(input.templateConfig);
  const nextHighlights = cloneTemplateCaptionHighlights(input.highlights);
  if (resolveTemplateLayoutKind(input.templateConfig) === "classic_top_bottom") {
    return {
      topText: input.topText,
      bottomText: input.bottomText,
      highlights: nextHighlights,
      leadMode
    };
  }

  if (leadMode === "off") {
    nextHighlights.top = [];
    return {
      topText: "",
      bottomText: input.bottomText,
      highlights: nextHighlights,
      leadMode
    };
  }

  if (leadMode === "template_default") {
    nextHighlights.top = [];
    return {
      topText: resolveTemplateDefaultLeadText(input.templateConfig) || input.topText,
      bottomText: input.bottomText,
      highlights: nextHighlights,
      leadMode
    };
  }

  return {
    topText: input.topText,
    bottomText: input.bottomText,
    highlights: nextHighlights,
    leadMode
  };
}

export function resolveTemplateStage2HardConstraints(
  constraints: Stage2HardConstraints,
  templateConfig: Stage3TemplateConfig | null | undefined
): Stage2HardConstraints {
  const leadMode = resolveTemplateLeadMode(templateConfig);
  if (resolveTemplateLayoutKind(templateConfig) !== "channel_story") {
    return { ...constraints };
  }
  if (leadMode === "clip_custom") {
    return { ...constraints };
  }
  return {
    ...constraints,
    topLengthMin: 0,
    topLengthMax: 0
  };
}
