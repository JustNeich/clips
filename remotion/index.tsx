import React from "react";
import { Composition, registerRoot, type CalculateMetadataFunction } from "remotion";
import { ScienceCardV1 } from "./science-card-v1";
import type { Stage3VariationProfile } from "../lib/stage3-render-variation";
import {
  AMERICAN_NEWS_TEMPLATE_ID,
  SCIENCE_CARD_TEMPLATE_ID,
  SCIENCE_CARD_BLUE_TEMPLATE_ID,
  SCIENCE_CARD_RED_TEMPLATE_ID,
  SCIENCE_CARD_GREEN_TEMPLATE_ID,
  SCIENCE_CARD_V7_TEMPLATE_ID,
  CHANNEL_STORY_TEMPLATE_ID,
  HEDGES_OF_HONOR_TEMPLATE_ID,
  GHOSTFACE_COUNTRY_TEMPLATE_ID,
  GHOSTFACE_WORKSHOP_TEMPLATE_ID
} from "../lib/stage3-template";
import type { Stage3TemplateConfig } from "../lib/stage3-template";
import type { TemplateCaptionHighlights } from "../lib/template-highlights";
import type {
  Stage3CameraKeyframe,
  Stage3PositionKeyframe,
  Stage3ScaleKeyframe
} from "../lib/stage3-camera";
import { DEFAULT_STAGE3_CLIP_DURATION_SEC } from "../lib/stage3-duration";
import {
  STAGE3_REMOTION_FPS,
  buildStage3CompositionMetadata
} from "./stage3-composition-metadata";
import {
  DEFAULT_STAGE3_VIDEO_FIT,
  type Stage3VideoFit
} from "../lib/stage3-video-fit";

type RemotionStage3TimingMode = "auto" | "compress" | "stretch";
type RemotionStage3Segment = {
  startSec: number;
  endSec: number | null;
  label: string;
  speed: number;
  focusX?: number | null;
  focusY?: number | null;
  videoZoom?: number | null;
  mirrorEnabled?: boolean | null;
};

export type ScienceCardV1Props = {
  templateId?: string;
  templateConfigOverride?: Stage3TemplateConfig | null;
  sourceVideoFileName?: string | null;
  topText: string;
  bottomText: string;
  sourceOverlayText: string;
  captionHighlights: TemplateCaptionHighlights;
  clipStartSec: number;
  clipDurationSec: number;
  focusX: number;
  focusY: number;
  mirrorEnabled: boolean;
  timingMode: RemotionStage3TimingMode;
  segments: RemotionStage3Segment[];
  cameraMotion: "disabled" | "top_to_bottom" | "bottom_to_top";
  cameraKeyframes: Stage3CameraKeyframe[];
  cameraPositionKeyframes: Stage3PositionKeyframe[];
  cameraScaleKeyframes: Stage3ScaleKeyframe[];
  videoZoom: number;
  mediaRegionHeightPx?: number | null;
  videoScaleY: number;
  videoScaleX: number;
  videoFit?: Stage3VideoFit;
  videoBrightness: number;
  videoExposure: number;
  videoContrast: number;
  videoSaturation: number;
  topFontScale: number;
  bottomFontScale: number;
  authorName: string;
  authorHandle: string;
  avatarAssetFileName?: string | null;
  avatarAssetMimeType?: string | null;
  backgroundAssetFileName?: string | null;
  backgroundAssetMimeType?: string | null;
  sourceBlurBackgroundDisabled?: boolean | null;
  textFit?: {
    topFontPx: number;
    bottomFontPx: number;
    topLineHeight: number;
    bottomLineHeight: number;
    topLines: number;
    bottomLines: number;
    topCompacted: boolean;
    bottomCompacted: boolean;
  } | null;
  variationProfile?: Stage3VariationProfile | null;
};

export const SCENE_ID = SCIENCE_CARD_TEMPLATE_ID;
export const AMERICAN_NEWS_SCENE_ID = AMERICAN_NEWS_TEMPLATE_ID;
export const SCIENCE_CARD_BLUE_SCENE_ID = SCIENCE_CARD_BLUE_TEMPLATE_ID;
export const SCIENCE_CARD_RED_SCENE_ID = SCIENCE_CARD_RED_TEMPLATE_ID;
export const SCIENCE_CARD_GREEN_SCENE_ID = SCIENCE_CARD_GREEN_TEMPLATE_ID;
export const SCIENCE_CARD_V7_SCENE_ID = SCIENCE_CARD_V7_TEMPLATE_ID;
export const CHANNEL_STORY_SCENE_ID = CHANNEL_STORY_TEMPLATE_ID;
export const HEDGES_OF_HONOR_SCENE_ID = HEDGES_OF_HONOR_TEMPLATE_ID;
export const GHOSTFACE_COUNTRY_SCENE_ID = GHOSTFACE_COUNTRY_TEMPLATE_ID;
export const GHOSTFACE_WORKSHOP_SCENE_ID = GHOSTFACE_WORKSHOP_TEMPLATE_ID;
const DEFAULT_TEXT_SCALE = 1.25;
const DEFAULT_DURATION_IN_FRAMES = DEFAULT_STAGE3_CLIP_DURATION_SEC * STAGE3_REMOTION_FPS;
const calculateScienceCardMetadata: CalculateMetadataFunction<ScienceCardV1Props> = ({ props }) =>
  buildStage3CompositionMetadata(props);

function buildDefaultProps(templateId: string, authorName: string, authorHandle: string): ScienceCardV1Props {
  return {
    templateId,
    templateConfigOverride: null,
    sourceVideoFileName: "source.mp4",
    topText: "",
    bottomText: "",
    sourceOverlayText: "",
    captionHighlights: { top: [], bottom: [] },
    clipStartSec: 0,
    clipDurationSec: 6,
    focusX: 0.5,
    focusY: 0.5,
    mirrorEnabled: true,
    timingMode: "auto",
    segments: [],
    cameraMotion: "disabled",
    cameraKeyframes: [],
    cameraPositionKeyframes: [],
    cameraScaleKeyframes: [],
    videoZoom: 1,
    mediaRegionHeightPx: null,
    videoScaleY: 1,
    videoScaleX: 1,
    videoFit: DEFAULT_STAGE3_VIDEO_FIT,
    videoBrightness: 1,
    videoExposure: 0,
    videoContrast: 1,
    videoSaturation: 1,
    topFontScale: DEFAULT_TEXT_SCALE,
    bottomFontScale: DEFAULT_TEXT_SCALE,
    authorName,
    authorHandle,
    avatarAssetFileName: null,
    avatarAssetMimeType: null,
    backgroundAssetFileName: null,
    backgroundAssetMimeType: null,
    sourceBlurBackgroundDisabled: false,
    textFit: null,
    variationProfile: null
  };
}

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id={SCENE_ID}
        component={ScienceCardV1}
        width={1080}
        height={1920}
        fps={STAGE3_REMOTION_FPS}
        durationInFrames={DEFAULT_DURATION_IN_FRAMES}
        calculateMetadata={calculateScienceCardMetadata}
        defaultProps={buildDefaultProps(SCIENCE_CARD_TEMPLATE_ID, "Science Snack", "@Science_Snack_1")}
      />
      <Composition
        id={AMERICAN_NEWS_SCENE_ID}
        component={ScienceCardV1}
        width={1080}
        height={1920}
        fps={STAGE3_REMOTION_FPS}
        durationInFrames={DEFAULT_DURATION_IN_FRAMES}
        calculateMetadata={calculateScienceCardMetadata}
        defaultProps={buildDefaultProps(AMERICAN_NEWS_TEMPLATE_ID, "American News", "@amnnews9")}
      />
      <Composition
        id={SCIENCE_CARD_BLUE_SCENE_ID}
        component={ScienceCardV1}
        width={1080}
        height={1920}
        fps={STAGE3_REMOTION_FPS}
        durationInFrames={DEFAULT_DURATION_IN_FRAMES}
        calculateMetadata={calculateScienceCardMetadata}
        defaultProps={buildDefaultProps(SCIENCE_CARD_BLUE_TEMPLATE_ID, "Science Snack", "@Science_Snack_1")}
      />
      <Composition
        id={SCIENCE_CARD_RED_SCENE_ID}
        component={ScienceCardV1}
        width={1080}
        height={1920}
        fps={STAGE3_REMOTION_FPS}
        durationInFrames={DEFAULT_DURATION_IN_FRAMES}
        calculateMetadata={calculateScienceCardMetadata}
        defaultProps={buildDefaultProps(SCIENCE_CARD_RED_TEMPLATE_ID, "Science Snack", "@Science_Snack_1")}
      />
      <Composition
        id={SCIENCE_CARD_GREEN_SCENE_ID}
        component={ScienceCardV1}
        width={1080}
        height={1920}
        fps={STAGE3_REMOTION_FPS}
        durationInFrames={DEFAULT_DURATION_IN_FRAMES}
        calculateMetadata={calculateScienceCardMetadata}
        defaultProps={buildDefaultProps(SCIENCE_CARD_GREEN_TEMPLATE_ID, "Science Snack", "@Science_Snack_1")}
      />
      <Composition
        id={SCIENCE_CARD_V7_SCENE_ID}
        component={ScienceCardV1}
        width={1080}
        height={1920}
        fps={STAGE3_REMOTION_FPS}
        durationInFrames={DEFAULT_DURATION_IN_FRAMES}
        calculateMetadata={calculateScienceCardMetadata}
        defaultProps={buildDefaultProps(SCIENCE_CARD_V7_TEMPLATE_ID, "Echoes Of Honor", "@EchoesOfHonor50")}
      />
      <Composition
        id={CHANNEL_STORY_SCENE_ID}
        component={ScienceCardV1}
        width={1080}
        height={1920}
        fps={STAGE3_REMOTION_FPS}
        durationInFrames={DEFAULT_DURATION_IN_FRAMES}
        calculateMetadata={calculateScienceCardMetadata}
        defaultProps={buildDefaultProps(CHANNEL_STORY_TEMPLATE_ID, "History Club TV", "@historyclubtv")}
      />
      <Composition
        id={HEDGES_OF_HONOR_SCENE_ID}
        component={ScienceCardV1}
        width={1080}
        height={1920}
        fps={STAGE3_REMOTION_FPS}
        durationInFrames={DEFAULT_DURATION_IN_FRAMES}
        calculateMetadata={calculateScienceCardMetadata}
        defaultProps={buildDefaultProps(HEDGES_OF_HONOR_TEMPLATE_ID, "Echoes Of Honor", "@EchoesOfHonor50")}
      />
      <Composition
        id={GHOSTFACE_COUNTRY_SCENE_ID}
        component={ScienceCardV1}
        width={1080}
        height={1920}
        fps={STAGE3_REMOTION_FPS}
        durationInFrames={DEFAULT_DURATION_IN_FRAMES}
        calculateMetadata={calculateScienceCardMetadata}
        defaultProps={buildDefaultProps(
          GHOSTFACE_COUNTRY_TEMPLATE_ID,
          "GHOSTFACE COUNTRY",
          "@ghostfacecountry"
        )}
      />
      <Composition
        id={GHOSTFACE_WORKSHOP_SCENE_ID}
        component={ScienceCardV1}
        width={1080}
        height={1920}
        fps={STAGE3_REMOTION_FPS}
        durationInFrames={DEFAULT_DURATION_IN_FRAMES}
        calculateMetadata={calculateScienceCardMetadata}
        defaultProps={buildDefaultProps(
          GHOSTFACE_WORKSHOP_TEMPLATE_ID,
          "GHOSTFACE WORKSHOP",
          "@ghostfaceworkshop"
        )}
      />
    </>
  );
};

registerRoot(RemotionRoot);

export default RemotionRoot;
