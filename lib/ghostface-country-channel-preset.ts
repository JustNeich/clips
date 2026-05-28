import type { ManagedTemplateVersionSnapshot } from "./managed-template-types";
import {
  GHOSTFACE_COUNTRY_TEMPLATE_ID,
  cloneStage3TemplateConfig,
  getTemplateById
} from "./stage3-template";

export const GHOSTFACE_COUNTRY_CHANNEL_NAME = "Ghostface Country";
export const GHOSTFACE_COUNTRY_CHANNEL_USERNAME = "ghostfacecountry";
export const GHOSTFACE_COUNTRY_TEMPLATE_NAME = "GHOSTFACE COUNTRY - Black Reference";
export const GHOSTFACE_COUNTRY_AUTHOR_NAME = "GHOSTFACE COUNTRY";
export const GHOSTFACE_COUNTRY_AUTHOR_HANDLE = "@ghostfacecountry";

export const GHOSTFACE_COUNTRY_TOP_TEXT =
  "100 battle rope: burn more calories, lose fat easier, boost calorie burn, speed up your metabolism, strengthen your abs and arms, improve endurance, and stay gentler on your joints.";

export const GHOSTFACE_COUNTRY_TOP_HIGHLIGHT =
  "100 battle rope: burn more calories,";

export const GHOSTFACE_COUNTRY_BOTTOM_TEXT =
  "Keep your ribs down and core tight while using the ropes, because most of the benefit is lost when the lower back starts taking over.";

export function createGhostfaceCountryManagedTemplateSnapshot(): ManagedTemplateVersionSnapshot {
  const templateConfig = cloneStage3TemplateConfig(getTemplateById(GHOSTFACE_COUNTRY_TEMPLATE_ID));
  return {
    name: GHOSTFACE_COUNTRY_TEMPLATE_NAME,
    description:
      "Black Ghostface Country fitness card based on the screenshot: heavy centered top copy with a yellow first-benefit highlight, wide straight media window, and Twitter-like author/footer treatment.",
    layoutFamily: GHOSTFACE_COUNTRY_TEMPLATE_ID,
    baseTemplateId: GHOSTFACE_COUNTRY_TEMPLATE_ID,
    content: {
      topText: GHOSTFACE_COUNTRY_TOP_TEXT,
      bottomText: GHOSTFACE_COUNTRY_BOTTOM_TEXT,
      channelName: GHOSTFACE_COUNTRY_AUTHOR_NAME,
      channelHandle: GHOSTFACE_COUNTRY_AUTHOR_HANDLE,
      highlights: {
        top: [
          {
            start: 0,
            end: GHOSTFACE_COUNTRY_TOP_HIGHLIGHT.length,
            slotId: "slot1"
          }
        ],
        bottom: []
      },
      topHighlightPhrases: [GHOSTFACE_COUNTRY_TOP_HIGHLIGHT],
      topFontScale: 1,
      bottomFontScale: 1,
      previewScale: 0.3,
      mediaAsset: null,
      backgroundAsset: null,
      avatarAsset: null
    },
    templateConfig,
    shadowLayers: []
  };
}

export function createGhostfaceCountryChannelPatch(input: { templateId: string }): {
  templateId: string;
} {
  return {
    templateId: input.templateId
  };
}
