import {
  SCIENCE_CARD_TEMPLATE_ID,
  TURBO_FACE_TEMPLATE_ID,
  SCIENCE_CARD_V2_TEMPLATE_ID,
  SCIENCE_CARD_V3_TEMPLATE_ID,
  SCIENCE_CARD_V4_TEMPLATE_ID,
  SCIENCE_CARD_V5_TEMPLATE_ID
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
    templateId: TURBO_FACE_TEMPLATE_ID,
    label: getTemplateVariant(TURBO_FACE_TEMPLATE_ID).label,
    channelName: "Stone Face Turbo",
    channelHandle: "@StoneFaceTurbo",
    topText:
      "This 2003 Ford F-250 is screaming across Vatnajokull Glacier at over 75mph. With massive custom flares and a tire inflation system, it is built to glide over the Icelandic deep freeze.",
    bottomText:
      "\"Making every 6.0 owner on earth proud.\" Most are afraid to drive these to the grocery, but this man is out here proving what a built Ford can actually handle.",
    note:
      "Expressive meme/news hybrid. Best when the top panel feels loud, the media window feels heavy, and the quote card stays premium instead of cheap.",
    defaultPreviewScale: 0.23,
    initialStatus: "in-progress",
    checklist: [
      "Top block должен быть агрессивным и мемным, но не скатываться в дешёвый Facebook card.",
      "Media-zone должен визуально держать массу и глубину, иначе Turbo теряет punch.",
      "Bottom card должен ощущаться как дорогой branded shell с очень читаемым авторским блоком."
    ]
  },
  {
    templateId: SCIENCE_CARD_V2_TEMPLATE_ID,
    label: getTemplateVariant(SCIENCE_CARD_V2_TEMPLATE_ID).label,
    channelName: "Zack The Bison",
    channelHandle: "@zackthebison",
    topText:
      "Because these tiny button quail chicks have imprinted on the man in the grey shorts, they instinctively follow his every move across the patterned rug.",
    bottomText:
      "The anxiety of watching this is unreal. One wrong step and it is a tragedy. He just scoops them up like a handful of fuzzy marbles at the end.",
    note: "Dark social-card science variant with green accent words, a muted premium bottom quote block and a hard green shell border.",
    defaultPreviewScale: 0.34,
    initialStatus: "queued",
    checklist: [
      "Схема должна визуально совпадать по отступам, чтобы метрики оставались стабильными.",
      "Проверьте авторский блок и bottom-текст в zoom 1x и в scale overlay.",
      "После утверждения переведите в Review и дождитесь стабильного pass."
    ]
  },
  {
    templateId: SCIENCE_CARD_V3_TEMPLATE_ID,
    label: getTemplateVariant(SCIENCE_CARD_V3_TEMPLATE_ID).label,
    channelName: "Science Snack",
    channelHandle: "@Science_Snack_1",
    topText:
      "Biologists watched a sea slug borrow functioning chloroplasts from the algae it eats, then keep using those stolen solar parts inside its own body for weeks.",
    bottomText:
      "It sounds fake until you see it move. The animal is basically carrying a pocket-size photosynthesis kit and treating sunlight like emergency rations.",
    note:
      "Bright editorial shell with cool halo light, glassy borders and a cleaner premium science-news read than the baseline card.",
    defaultPreviewScale: 0.31,
    initialStatus: "queued",
    checklist: [
      "Карточка должна ощущаться воздушной и lifted, а не просто белой с другой обводкой.",
      "Halo вокруг shell не должен спорить с читаемостью верхнего текста.",
      "Bottom block должен сохранять ту же иерархию, но выглядеть чище и дороже, чем в V1."
    ]
  },
  {
    templateId: SCIENCE_CARD_V4_TEMPLATE_ID,
    label: getTemplateVariant(SCIENCE_CARD_V4_TEMPLATE_ID).label,
    channelName: "Science Snack",
    channelHandle: "@Science_Snack_1",
    topText:
      "Researchers built a soft robotic fin that learns how a damaged fish tail would compensate, then adapts its stroke pattern on the fly instead of repeating a fixed loop.",
    bottomText:
      "The impressive part is not the hardware but the behavior. It stops acting like a demo rig and starts feeling like something alive is improvising its way back into rhythm.",
    note:
      "Dark nightglass variant with cyan edge-light, denser contrast and a more futuristic premium shell while keeping the same top-media-meta-bottom structure.",
    defaultPreviewScale: 0.31,
    initialStatus: "queued",
    checklist: [
      "Glow и edge-light должны добавлять energy, но не превращать карточку в gamer neon.",
      "Top block должен оставаться максимально читаемым на тёмной массе.",
      "Author/meta ряд обязан ощущаться собранным, а не растворяться в тёмном фоне."
    ]
  },
  {
    templateId: SCIENCE_CARD_V5_TEMPLATE_ID,
    label: getTemplateVariant(SCIENCE_CARD_V5_TEMPLATE_ID).label,
    channelName: "Science Snack",
    channelHandle: "@Science_Snack_1",
    topText:
      "Geologists cut open a volcanic bomb and found concentric mineral bands so precise that the rock reads almost like a pressure logbook from the instant it was thrown out of the crater.",
    bottomText:
      "The colors make it look decorative until you realize each ring marks a real shift in heat, gas and cooling speed. It is a disaster souvenir with perfect memory.",
    note:
      "Warm copperline variant with poster-like contrast, heavier border treatment and a more tactile quote block without changing the composition contract.",
    defaultPreviewScale: 0.31,
    initialStatus: "queued",
    checklist: [
      "Тёплый тон должен ощущаться intentional и print-like, а не грязно-коричневым.",
      "Обводка и тень должны собирать poster energy без визуальной тяжести Facebook-meme card.",
      "Italic bottom quote должен добавлять характера, но не ломать читаемость."
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
