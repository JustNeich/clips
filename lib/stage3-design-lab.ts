import {
  SCIENCE_CARD_TEMPLATE_ID,
  TURBO_FACE_TEMPLATE_ID
} from "./stage3-template";

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
    label: "Science Card V1",
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
    label: "Stone Face Turbo",
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
