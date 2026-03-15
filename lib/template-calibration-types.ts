export type TemplateCalibrationStatus = "queued" | "in-progress" | "review" | "approved";

export type TemplateCompareMode =
  | "side-by-side"
  | "overlay"
  | "difference"
  | "split-swipe"
  | "heatmap";

export type TemplateCompareScope =
  | "full"
  | "chrome-only"
  | "top-only"
  | "media-only"
  | "bottom-only"
  | "author-only";

export type TemplateOverlayBlendMode = "normal" | "difference";

export type TemplateContentFixture = {
  topText: string;
  bottomText: string;
  channelName: string;
  channelHandle: string;
  topHighlightPhrases?: string[];
  topFontScale: number;
  bottomFontScale: number;
  previewScale: number;
  mediaAsset: string | null;
  backgroundAsset: string | null;
  avatarAsset: string | null;
};

export type TemplateCalibrationSession = {
  templateId: string;
  status: TemplateCalibrationStatus;
  compareMode: TemplateCompareMode;
  compareScope: TemplateCompareScope;
  overlayOpacity: number;
  overlayBlendMode: TemplateOverlayBlendMode;
  referenceOffsetX: number;
  referenceOffsetY: number;
  referenceScale: number;
  referenceCropX: number;
  referenceCropY: number;
  referenceCropWidth: number;
  referenceCropHeight: number;
  zoom: number;
  panX: number;
  panY: number;
  splitPosition: number;
  acceptedMismatchThreshold: number;
};

export type TemplateDiffReport = {
  templateId: string;
  timestamp: string;
  compareScope: TemplateCompareScope;
  mismatchPercent: number;
  mismatchPixels: number;
  totalPixels: number;
  threshold: number;
  pass: boolean;
  chromeMismatchPercent: number | null;
};

export type TemplateCalibrationArtifacts = {
  currentPngUrl: string | null;
  diffPngUrl: string | null;
  heatmapPngUrl: string | null;
};

export type TemplateCalibrationBundle = {
  templateId: string;
  content: TemplateContentFixture;
  session: TemplateCalibrationSession;
  notes: string;
  referenceImageUrl: string | null;
  maskImageUrl: string | null;
  mediaAssetUrl: string | null;
  backgroundAssetUrl: string | null;
  avatarAssetUrl: string | null;
  artifacts: TemplateCalibrationArtifacts;
  report: TemplateDiffReport | null;
};
