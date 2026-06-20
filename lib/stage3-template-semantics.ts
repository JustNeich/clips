import {
  GHOSTFACE_COUNTRY_TEMPLATE_ID,
  type Stage3TemplateConfig
} from "./stage3-template";
import {
  cloneTemplateCaptionHighlights,
  type TemplateCaptionHighlights,
  type TemplateHighlightSpan
} from "./template-highlights";

export type Stage3TemplateLayoutKind = "classic_top_bottom" | "channel_story";
export type Stage3TemplateFormatGroup = Stage3TemplateLayoutKind;
export type Stage3TemplateLeadMode = "off" | "template_default" | "clip_custom";
export type Stage3TemplateLeadTextFormat = "short" | "long";

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

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isGhostfaceCountryTemplate(input: {
  templateId?: string | null;
  templateConfig?: Stage3TemplateConfig | null | undefined;
}): boolean {
  return (
    input.templateId?.trim() === GHOSTFACE_COUNTRY_TEMPLATE_ID ||
    input.templateConfig?.author.handle === "@ghostfacecountry"
  );
}

function buildGhostfaceCountryFallbackTopHighlight(text: string): TemplateHighlightSpan[] {
  const firstVisibleIndex = text.search(/\S/);
  if (firstVisibleIndex < 0) {
    return [];
  }

  const maxChars = 68;
  const minBoundaryChars = 14;
  const visibleText = text.slice(firstVisibleIndex);
  const punctuationMatches = visibleText.matchAll(/[,.;!?](?=\s|$)/g);
  for (const match of punctuationMatches) {
    if (typeof match.index === "number" && match.index + 1 >= minBoundaryChars) {
      return [
        {
          start: firstVisibleIndex,
          end: firstVisibleIndex + Math.min(match.index + 1, maxChars),
          slotId: "slot1"
        }
      ];
    }
  }

  if (visibleText.length <= maxChars) {
    return [
      {
        start: firstVisibleIndex,
        end: firstVisibleIndex + visibleText.length,
        slotId: "slot1"
      }
    ];
  }

  const clipped = visibleText.slice(0, maxChars);
  const wordBoundary = clipped.lastIndexOf(" ");
  const endOffset = wordBoundary >= minBoundaryChars ? wordBoundary : maxChars;
  return [
    {
      start: firstVisibleIndex,
      end: firstVisibleIndex + endOffset,
      slotId: "slot1"
    }
  ];
}

function resolveChannelStoryClipCustomLengthTargets(
  templateConfig: Stage3TemplateConfig | null | undefined
): {
  topLengthMin: number;
  topLengthMax: number;
  bottomLengthMin: number;
  bottomLengthMax: number;
} {
  const channelStory = templateConfig?.channelStory;
  if (!templateConfig || !channelStory) {
    return {
      topLengthMin: 6,
      topLengthMax: 42,
      bottomLengthMin: 72,
      bottomLengthMax: 220
    };
  }

  if (channelStory.leadTextFormat === "long") {
    const longLeadMaxChars = Math.max(
      120,
      Math.min(
        templateConfig.typography.top.maxChars ?? 220,
        Math.round(Math.max(160, channelStory.leadHeight) * 1.15)
      )
    );
    const topLengthMax = clampNumber(longLeadMaxChars, 120, 240);
    return {
      topLengthMin: clampNumber(Math.round(topLengthMax * 0.34), 36, 90),
      topLengthMax,
      bottomLengthMin: 40,
      bottomLengthMax: Math.max(
        120,
        Math.min(
          templateConfig.typography.bottom.maxChars ?? 240,
          Math.round(Math.max(180, channelStory.bodyHeight) * 0.62)
        )
      )
    };
  }

  const leadMaxChars = Math.max(
    24,
    Math.min(
      templateConfig.typography.top.maxChars ?? 56,
      Math.round(Math.max(48, channelStory.leadHeight) * 0.58)
    )
  );
  const bodyMaxChars = Math.max(
    120,
    Math.min(
      templateConfig.typography.bottom.maxChars ?? 240,
      Math.round(Math.max(180, channelStory.bodyHeight) * 0.62)
    )
  );

  const topLengthMax = clampNumber(leadMaxChars, 24, 56);
  const topLengthMin = clampNumber(Math.round(topLengthMax * 0.22), 6, 18);
  const bottomLengthMax = clampNumber(bodyMaxChars, 120, 260);
  const bottomLengthMin = clampNumber(Math.round(bottomLengthMax * 0.38), 40, 120);

  return {
    topLengthMin,
    topLengthMax,
    bottomLengthMin,
    bottomLengthMax
  };
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
  templateId?: string | null;
  templateConfig: Stage3TemplateConfig | null | undefined;
  topText: string;
  bottomText: string;
  highlights: TemplateCaptionHighlights | null | undefined;
}): Stage3TemplateResolvedText {
  const leadMode = resolveTemplateLeadMode(input.templateConfig);
  const nextHighlights = cloneTemplateCaptionHighlights(input.highlights);
  if (resolveTemplateLayoutKind(input.templateConfig) === "classic_top_bottom") {
    if (
      nextHighlights.top.length === 0 &&
      isGhostfaceCountryTemplate({
        templateId: input.templateId,
        templateConfig: input.templateConfig
      })
    ) {
      nextHighlights.top = buildGhostfaceCountryFallbackTopHighlight(input.topText);
    }
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

export function resolveTemplateStage2HardConstraints<
  T extends {
    topLengthMin: number;
    topLengthMax: number;
    bottomLengthMin: number;
    bottomLengthMax: number;
  }
>(
  constraints: T,
  templateConfig: Stage3TemplateConfig | null | undefined
): T {
  const leadMode = resolveTemplateLeadMode(templateConfig);
  if (resolveTemplateLayoutKind(templateConfig) !== "channel_story") {
    return { ...constraints };
  }
  if (leadMode === "clip_custom") {
    const targetWindow = resolveChannelStoryClipCustomLengthTargets(templateConfig);
    return {
      ...constraints,
      topLengthMin: targetWindow.topLengthMin,
      topLengthMax: targetWindow.topLengthMax,
      bottomLengthMin: Math.max(targetWindow.bottomLengthMin, constraints.bottomLengthMin),
      bottomLengthMax: Math.max(targetWindow.bottomLengthMax, constraints.bottomLengthMax)
    };
  }
  return {
    ...constraints,
    topLengthMin: 0,
    topLengthMax: 0
  };
}
