import type { ChatDraft, Stage2Response, Stage3Version } from "../app/components/types";
import {
  cloneTemplateCaptionHighlights,
  mergeTemplateCaptionHighlightsByMode,
  type TemplateCaptionHighlights
} from "./template-highlights";

type Stage2CaptionOption = Stage2Response["output"]["captionOptions"][number];

export type Stage2SelectionDefaults = {
  captionOption: number | null;
  titleOption: number | null;
};

export type Stage2ToStage3TextSource =
  | "draft_override"
  | "latest_version"
  | "selected_caption"
  | "empty";

export type Stage2ToStage3HandoffSummary = {
  stage2Available: boolean;
  defaultCaptionOption: number | null;
  selectedCaptionOption: number | null;
  captionBlockedReason?: string | null;
  defaultTitleOption: number | null;
  selectedTitleOption: number | null;
  caption:
    | {
        option: number;
        top: string;
        bottom: string;
        highlights: TemplateCaptionHighlights;
      }
    | null;
  title:
    | {
        option: number;
        title: string;
      }
    | null;
  topText: string | null;
  bottomText: string | null;
  topTextSource: Stage2ToStage3TextSource;
  bottomTextSource: Stage2ToStage3TextSource;
  hasManualTextOverride: boolean;
  canResetToSelectedCaption: boolean;
  latestVersionId: string | null;
  hasStage3Overrides: boolean;
};

export function getStage2SelectionDefaults(
  stage2: Stage2Response | null | undefined
): Stage2SelectionDefaults {
  if (!stage2) {
    return {
      captionOption: null,
      titleOption: null
    };
  }
  return {
    captionOption: stage2.output.finalPick.option,
    titleOption: stage2.output.titleOptions[0]?.option ?? 1
  };
}

export function getSelectedStage2Caption(
  stage2: Stage2Response | null | undefined,
  preferredOption?: number | null
): Stage2Response["output"]["captionOptions"][number] | null {
  if (!stage2) {
    return null;
  }
  const defaults = getStage2SelectionDefaults(stage2);
  const resolvedOption = preferredOption ?? defaults.captionOption;
  const selected =
    stage2.output.captionOptions.find((item) => item.option === resolvedOption) ??
    stage2.output.captionOptions[0] ??
    null;
  if (!selected) {
    return null;
  }
  if (selected.constraintCheck?.passed === false) {
    return null;
  }
  return selected;
}

export function getSelectedStage2Title(
  stage2: Stage2Response | null | undefined,
  preferredOption?: number | null
): Stage2Response["output"]["titleOptions"][number] | null {
  if (!stage2) {
    return null;
  }
  const defaults = getStage2SelectionDefaults(stage2);
  const resolvedOption = preferredOption ?? defaults.titleOption ?? 1;
  return (
    stage2.output.titleOptions.find((item) => item.option === resolvedOption) ??
    stage2.output.titleOptions[0] ??
    null
  );
}

export type Stage3CaptionApplyMode = "all" | "top" | "bottom";

export function applyStage2CaptionToStage3Text(input: {
  currentTopText: string;
  currentBottomText: string;
  currentCaptionHighlights?: TemplateCaptionHighlights | null;
  caption: Pick<Stage2CaptionOption, "top" | "bottom" | "highlights"> | null;
  mode: Stage3CaptionApplyMode;
}): { topText: string; bottomText: string; captionHighlights: TemplateCaptionHighlights } {
  if (!input.caption) {
    return {
      topText: input.currentTopText,
      bottomText: input.currentBottomText,
      captionHighlights: cloneTemplateCaptionHighlights(input.currentCaptionHighlights)
    };
  }

  const captionHighlights = mergeTemplateCaptionHighlightsByMode({
    current: input.currentCaptionHighlights,
    next: input.caption.highlights,
    mode: input.mode
  });

  if (input.mode === "all") {
    return {
      topText: input.caption.top,
      bottomText: input.caption.bottom,
      captionHighlights
    };
  }

  if (input.mode === "top") {
    return {
      topText: input.caption.top,
      bottomText: input.currentBottomText,
      captionHighlights
    };
  }

  return {
    topText: input.currentTopText,
    bottomText: input.caption.bottom,
    captionHighlights
  };
}

function resolveStage3TextSource(input: {
  currentText: string | null;
  selectedText: string | null;
  latestVersionText: string | null;
}): Stage2ToStage3TextSource {
  const currentText = input.currentText ?? null;
  if (!currentText) {
    return "empty";
  }
  if (input.selectedText && currentText === input.selectedText) {
    return "selected_caption";
  }
  if (input.latestVersionText && currentText === input.latestVersionText) {
    return "latest_version";
  }
  return "draft_override";
}

export function buildStage2ToStage3HandoffSummary(input: {
  stage2: Stage2Response | null | undefined;
  draft: ChatDraft | null | undefined;
  latestVersion: Stage3Version | null | undefined;
  selectedCaptionOption?: number | null;
  selectedTitleOption?: number | null;
  currentTopText?: string | null;
  currentBottomText?: string | null;
}): Stage2ToStage3HandoffSummary {
  const defaults = getStage2SelectionDefaults(input.stage2);
  const requestedCaptionOption =
    input.draft?.stage2.selectedCaptionOption ?? input.selectedCaptionOption ?? defaults.captionOption;
  const requestedCaption =
    input.stage2?.output.captionOptions.find((item) => item.option === requestedCaptionOption) ?? null;
  const caption =
    getSelectedStage2Caption(
      input.stage2,
      requestedCaptionOption
    ) ?? null;
  const title =
    getSelectedStage2Title(
      input.stage2,
      input.draft?.stage2.selectedTitleOption ?? input.selectedTitleOption ?? defaults.titleOption
    ) ?? null;
  const resolvedTopText =
    input.currentTopText ??
    input.draft?.stage3.topText ??
    input.latestVersion?.final.topText ??
    caption?.top ??
    null;
  const resolvedBottomText =
    input.currentBottomText ??
    input.draft?.stage3.bottomText ??
    input.latestVersion?.final.bottomText ??
    caption?.bottom ??
    null;
  const topTextSource = resolveStage3TextSource({
    currentText: resolvedTopText,
    selectedText: caption?.top ?? null,
    latestVersionText: input.latestVersion?.final.topText ?? null
  });
  const bottomTextSource = resolveStage3TextSource({
    currentText: resolvedBottomText,
    selectedText: caption?.bottom ?? null,
    latestVersionText: input.latestVersion?.final.bottomText ?? null
  });
  const hasStage3Overrides = Boolean(
    input.draft &&
      (input.draft.stage3.topText !== null ||
        input.draft.stage3.bottomText !== null ||
        input.draft.stage3.clipStartSec !== null ||
        input.draft.stage3.focusY !== null ||
        input.draft.stage3.renderPlan !== null ||
        Boolean(input.draft.stage3.agentPrompt.trim()) ||
        input.draft.stage3.selectedVersionId !== null ||
        Object.keys(input.draft.stage3.passSelectionByVersion).length > 0)
  );

  return {
    stage2Available: Boolean(input.stage2),
    defaultCaptionOption: defaults.captionOption,
    selectedCaptionOption: caption?.option ?? null,
    captionBlockedReason:
      requestedCaption?.constraintCheck?.passed === false
        ? "selected_stage2_caption_failed_hard_constraints"
        : null,
    defaultTitleOption: defaults.titleOption,
    selectedTitleOption: title?.option ?? null,
    caption:
      caption
        ? {
            option: caption.option,
            top: caption.top,
            bottom: caption.bottom,
            highlights: cloneTemplateCaptionHighlights(caption.highlights)
          }
        : null,
    title:
      title
        ? {
            option: title.option,
            title: title.title
          }
        : null,
    topText: resolvedTopText,
    bottomText: resolvedBottomText,
    topTextSource,
    bottomTextSource,
    hasManualTextOverride:
      topTextSource === "draft_override" || bottomTextSource === "draft_override",
    canResetToSelectedCaption: Boolean(
      caption &&
        (resolvedTopText !== caption.top || resolvedBottomText !== caption.bottom)
    ),
    latestVersionId: input.latestVersion?.runId ?? null,
    hasStage3Overrides
  };
}
