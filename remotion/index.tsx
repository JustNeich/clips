import React from "react";
import { Composition, registerRoot } from "remotion";
import { ScienceCardV1 } from "./science-card-v1";
import type { Stage3VariationProfile } from "../lib/stage3-render-variation";
import {
  AMERICAN_NEWS_TEMPLATE_ID,
  SCIENCE_CARD_TEMPLATE_ID,
  SCIENCE_CARD_BLUE_TEMPLATE_ID,
  SCIENCE_CARD_RED_TEMPLATE_ID,
  SCIENCE_CARD_GREEN_TEMPLATE_ID,
  SCIENCE_CARD_V7_TEMPLATE_ID,
  HEDGES_OF_HONOR_TEMPLATE_ID
} from "../lib/stage3-template";
import type {
  Stage3CameraKeyframe,
  Stage3PositionKeyframe,
  Stage3ScaleKeyframe
} from "../lib/stage3-camera";

type RemotionStage3TimingMode = "auto" | "compress" | "stretch";
type RemotionStage3Segment = {
  startSec: number;
  endSec: number | null;
  label: string;
  speed: number;
  focusY?: number | null;
  videoZoom?: number | null;
  mirrorEnabled?: boolean | null;
};

export type ScienceCardV1Props = {
  templateId?: string;
  sourceVideoFileName?: string | null;
  topText: string;
  bottomText: string;
  clipStartSec: number;
  clipDurationSec: number;
  focusY: number;
  mirrorEnabled: boolean;
  timingMode: RemotionStage3TimingMode;
  segments: RemotionStage3Segment[];
  cameraMotion: "disabled" | "top_to_bottom" | "bottom_to_top";
  cameraKeyframes: Stage3CameraKeyframe[];
  cameraPositionKeyframes: Stage3PositionKeyframe[];
  cameraScaleKeyframes: Stage3ScaleKeyframe[];
  videoZoom: number;
  topFontScale: number;
  bottomFontScale: number;
  authorName: string;
  authorHandle: string;
  avatarAssetFileName?: string | null;
  avatarAssetMimeType?: string | null;
  backgroundAssetFileName?: string | null;
  backgroundAssetMimeType?: string | null;
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
export const HEDGES_OF_HONOR_SCENE_ID = HEDGES_OF_HONOR_TEMPLATE_ID;
const DEFAULT_TEXT_SCALE = 1.25;

function buildDefaultProps(templateId: string, authorName: string, authorHandle: string): ScienceCardV1Props {
  return {
    templateId,
    sourceVideoFileName: "source.mp4",
    topText: "",
    bottomText: "",
    clipStartSec: 0,
    clipDurationSec: 6,
    focusY: 0.5,
    mirrorEnabled: true,
    timingMode: "auto",
    segments: [],
    cameraMotion: "disabled",
    cameraKeyframes: [],
    cameraPositionKeyframes: [],
    cameraScaleKeyframes: [],
    videoZoom: 1,
    topFontScale: DEFAULT_TEXT_SCALE,
    bottomFontScale: DEFAULT_TEXT_SCALE,
    authorName,
    authorHandle,
    avatarAssetFileName: null,
    avatarAssetMimeType: null,
    backgroundAssetFileName: null,
    backgroundAssetMimeType: null,
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
        fps={30}
        durationInFrames={6 * 30}
        defaultProps={buildDefaultProps(SCIENCE_CARD_TEMPLATE_ID, "Science Snack", "@Science_Snack_1")}
      />
      <Composition
        id={AMERICAN_NEWS_SCENE_ID}
        component={ScienceCardV1}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={6 * 30}
        defaultProps={buildDefaultProps(AMERICAN_NEWS_TEMPLATE_ID, "American News", "@amnnews9")}
      />
      <Composition
        id={SCIENCE_CARD_BLUE_SCENE_ID}
        component={ScienceCardV1}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={6 * 30}
        defaultProps={buildDefaultProps(SCIENCE_CARD_BLUE_TEMPLATE_ID, "Science Snack", "@Science_Snack_1")}
      />
      <Composition
        id={SCIENCE_CARD_RED_SCENE_ID}
        component={ScienceCardV1}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={6 * 30}
        defaultProps={buildDefaultProps(SCIENCE_CARD_RED_TEMPLATE_ID, "Science Snack", "@Science_Snack_1")}
      />
      <Composition
        id={SCIENCE_CARD_GREEN_SCENE_ID}
        component={ScienceCardV1}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={6 * 30}
        defaultProps={buildDefaultProps(SCIENCE_CARD_GREEN_TEMPLATE_ID, "Science Snack", "@Science_Snack_1")}
      />
      <Composition
        id={SCIENCE_CARD_V7_SCENE_ID}
        component={ScienceCardV1}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={6 * 30}
        defaultProps={buildDefaultProps(SCIENCE_CARD_V7_TEMPLATE_ID, "Echoes Of Honor", "@EchoesOfHonor50")}
      />
      <Composition
        id={HEDGES_OF_HONOR_SCENE_ID}
        component={ScienceCardV1}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={6 * 30}
        defaultProps={buildDefaultProps(HEDGES_OF_HONOR_TEMPLATE_ID, "Echoes Of Honor", "@EchoesOfHonor50")}
      />
    </>
  );
};

registerRoot(RemotionRoot);

export default RemotionRoot;
