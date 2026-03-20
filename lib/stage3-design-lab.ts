import {
  AMERICAN_NEWS_TEMPLATE_ID,
  SCIENCE_CARD_TEMPLATE_ID,
  SCIENCE_CARD_BLUE_TEMPLATE_ID,
  SCIENCE_CARD_RED_TEMPLATE_ID,
  SCIENCE_CARD_GREEN_TEMPLATE_ID,
  SCIENCE_CARD_V7_TEMPLATE_ID,
  HEDGES_OF_HONOR_TEMPLATE_ID
} from "./stage3-template";
import { getTemplateVariant } from "./stage3-template-registry";

export type Stage3DesignLabStatus = "queued" | "in-progress" | "review" | "approved";

export type Stage3DesignLabPreset = {
  templateId: string;
  label: string;
  channelName: string;
  channelHandle: string;
  topText: string;
  bottomText: string;
  note: string;
  defaultPreviewScale: number;
  initialStatus: Stage3DesignLabStatus;
  checklist: string[];
};

export const STAGE3_DESIGN_LAB_STATUS_LABELS: Record<Stage3DesignLabStatus, string> = {
  queued: "Queue",
  "in-progress": "In Progress",
  review: "Review",
  approved: "Approved"
};

function createScienceCardBorderPreset(input: {
  templateId: string;
  note: string;
}): Stage3DesignLabPreset {
  return {
    templateId: input.templateId,
    label: getTemplateVariant(input.templateId).label,
    channelName: "Science Snack",
    channelHandle: "@Science_Snack_1",
    topText:
      "Scientists found a way to splice two living plant stems, and the joined tissue starts acting like a single working system almost immediately.",
    bottomText:
      "You can watch the wound knit together, the fluids reroute, and the whole graft behave like the plant decided the surgery was always part of the plan.",
    note: input.note,
    defaultPreviewScale: 0.34,
    initialStatus: "queued",
    checklist: [
      "Бордер должен быть заметно толще базового Science Card и читаться как самостоятельный цветовой акцент.",
      "Геометрия карточки и внутренние отступы должны оставаться идентичными каноническому Science Card.",
      "Белая карточка не должна терять editorial-читаемость из-за более тяжёлой обводки."
    ]
  };
}

export const STAGE3_DESIGN_LAB_PRESETS: Stage3DesignLabPreset[] = [
  {
    templateId: SCIENCE_CARD_TEMPLATE_ID,
    label: getTemplateVariant(SCIENCE_CARD_TEMPLATE_ID).label,
    channelName: "Science Snack",
    channelHandle: "@Science_Snack_1",
    topText:
      "Scientists found a way to splice two living plant stems, and the joined tissue starts acting like a single working system almost immediately.",
    bottomText:
      "You can watch the wound knit together, the fluids reroute, and the whole graft behave like the plant decided the surgery was always part of the plan.",
    note:
      "Reference-friendly editorial card. Best for clearer hierarchy, sharper article feel and calm scientific authority.",
    defaultPreviewScale: 0.34,
    initialStatus: "approved",
    checklist: [
      "Top headline должен ощущаться как editorial slab, а не соцсеточный shout.",
      "Media-window остается чистым и не спорит с верхним текстом по контрасту.",
      "Bottom quote-card выглядит как часть журнальной карточки, а не как отдельный виджет."
    ]
  },
  {
    templateId: AMERICAN_NEWS_TEMPLATE_ID,
    label: getTemplateVariant(AMERICAN_NEWS_TEMPLATE_ID).label,
    channelName: "American News",
    channelHandle: "@amnnews9",
    topText:
      "This baby capybara just discovered his off switch. Someone found the exact pressure point on his side and now he goes into a total trance for the entire afternoon.",
    bottomText:
      "It is like his brain just short circuited from pure joy. He is definitely not moving until that stick goes away for good.",
    note:
      "Dark news-card shell with a gold border, bright headline copy, and a source-blur backdrop. The card should feel like a social-news explainer, not a science magazine panel.",
    defaultPreviewScale: 0.3,
    initialStatus: "queued",
    checklist: [
      "Тёмные top и bottom блоки должны читаться как единый card chrome, а не как отдельные плитки.",
      "Золотая рамка должна быть заметной, но не превращать карточку в sports-poster graphic.",
      "Нижний текст должен ощущаться более разговорным и слегка editorial-italic, чем у базового Science Card."
    ]
  },
  createScienceCardBorderPreset({
    templateId: SCIENCE_CARD_BLUE_TEMPLATE_ID,
    note: "Blue-border variant of the base Science Card with a thicker shell outline and otherwise identical card geometry."
  }),
  createScienceCardBorderPreset({
    templateId: SCIENCE_CARD_RED_TEMPLATE_ID,
    note: "Red-border variant of the base Science Card with the same editorial shell, spacing, and typography."
  }),
  createScienceCardBorderPreset({
    templateId: SCIENCE_CARD_GREEN_TEMPLATE_ID,
    note: "Green-border variant of the base Science Card with the same proportions and a more aggressive frame accent."
  }),
  {
    templateId: SCIENCE_CARD_V7_TEMPLATE_ID,
    label: getTemplateVariant(SCIENCE_CARD_V7_TEMPLATE_ID).label,
    channelName: "Echoes Of Honor",
    channelHandle: "@EchoesOfHonor50",
    topText:
      "This sailor is performing a mandatory abandon ship drill from the bow of hull to prove he can handle the height and keep his form tight before the unit heads back to sea.",
    bottomText:
      "You have to cover your nose and cross your arms or that water will hit you like a brick. It is a confidence builder that every new recruit has to pass to be ready.",
    note:
      "Reference-first maritime meme/news card with large white shell, rounded black headline, thin gray border and a hard offset shadow on top of a sky backdrop.",
    defaultPreviewScale: 0.28,
    initialStatus: "in-progress",
    checklist: [
      "Карточка должна занимать больше высоты кадра, чем базовый science card, с меньшими внешними полями.",
      "Top headline нужен очень тяжёлый и круглый по характеру, без editorial-холодности Inter.",
      "Тонкая серая рамка, жёсткая offset-тень и sky-background должны читаться как единая ссылка на референс."
    ]
  },
  {
    templateId: HEDGES_OF_HONOR_TEMPLATE_ID,
    label: getTemplateVariant(HEDGES_OF_HONOR_TEMPLATE_ID).label,
    channelName: "Echoes Of Honor",
    channelHandle: "@EchoesOfHonor50",
    topText:
      "A Drill Sergeant is testing a new soldier's balance by throwing extra gear at him while he is already struggling to hold two rucksacks and a pair of overstuffed duffels.",
    bottomText:
      "She is going full ham with that campaign hat on. That poor man is carrying enough weight to sink a boat and he still has to catch whatever she throws next.",
    note:
      "Black-border reference version of the white ScienceCard shell. Keep the same geometry, but make the card feel more physical with the inner shadow and full-frame sky backdrop.",
    defaultPreviewScale: 0.28,
    initialStatus: "review",
    checklist: [
      "Толщина и цвет обводки должны читаться как тонкий 2px black line, не как gray border.",
      "Внутренний inset-shadow должен давать карточке объём, но не превращать её в beveled button.",
      "Фон должен быть реальным backdrop layer, а не просто белым canvas позади."
    ]
  }
];

export function listStage3DesignLabPresets(): Stage3DesignLabPreset[] {
  return STAGE3_DESIGN_LAB_PRESETS;
}

export function getStage3DesignLabPreset(templateId: string | null | undefined): Stage3DesignLabPreset {
  return (
    STAGE3_DESIGN_LAB_PRESETS.find((item) => item.templateId === templateId) ??
    STAGE3_DESIGN_LAB_PRESETS[0]
  );
}

export function getStage3DesignLabLabel(templateId: string | null | undefined): string {
  return getStage3DesignLabPreset(templateId).label;
}
