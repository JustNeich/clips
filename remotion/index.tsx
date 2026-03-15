import React from "react";
import { Composition, registerRoot } from "remotion";
import { ScienceCardV1 } from "./science-card-v1";
import {
  SCIENCE_CARD_TEMPLATE_ID,
  TURBO_FACE_TEMPLATE_ID,
  SCIENCE_CARD_V2_TEMPLATE_ID,
  SCIENCE_CARD_V3_TEMPLATE_ID,
  SCIENCE_CARD_V4_TEMPLATE_ID,
  SCIENCE_CARD_V5_TEMPLATE_ID
} from "../lib/stage3-template";

export type ScienceCardV1Props = {
  templateId?: string;
  sourceVideoFileName?: string | null;
  topText: string;
  bottomText: string;
  clipStartSec: number;
  clipDurationSec: number;
  focusY: number;
  mirrorEnabled: boolean;
  cameraMotion: "disabled" | "top_to_bottom" | "bottom_to_top";
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
};

export const SCENE_ID = SCIENCE_CARD_TEMPLATE_ID;
export const TURBO_SCENE_ID = TURBO_FACE_TEMPLATE_ID;
export const SCIENCE_CARD_V2_SCENE_ID = SCIENCE_CARD_V2_TEMPLATE_ID;
export const SCIENCE_CARD_V3_SCENE_ID = SCIENCE_CARD_V3_TEMPLATE_ID;
export const SCIENCE_CARD_V4_SCENE_ID = SCIENCE_CARD_V4_TEMPLATE_ID;
export const SCIENCE_CARD_V5_SCENE_ID = SCIENCE_CARD_V5_TEMPLATE_ID;
const DEFAULT_TEXT_SCALE = 1.25;

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
        defaultProps={{
          templateId: SCIENCE_CARD_TEMPLATE_ID,
          sourceVideoFileName: "source.mp4",
          topText: "",
          bottomText: "",
          clipStartSec: 0,
          clipDurationSec: 6,
          focusY: 0.5,
          mirrorEnabled: true,
          cameraMotion: "disabled",
          videoZoom: 1,
          topFontScale: DEFAULT_TEXT_SCALE,
          bottomFontScale: DEFAULT_TEXT_SCALE,
          authorName: "Science Snack",
          authorHandle: "@Science_Snack_1",
          avatarAssetFileName: null,
          avatarAssetMimeType: null,
          backgroundAssetFileName: null,
          backgroundAssetMimeType: null,
          textFit: null
        }}
      />
      <Composition
        id={TURBO_SCENE_ID}
        component={ScienceCardV1}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={6 * 30}
        defaultProps={{
          templateId: TURBO_FACE_TEMPLATE_ID,
          sourceVideoFileName: "source.mp4",
          topText: "",
          bottomText: "",
          clipStartSec: 0,
          clipDurationSec: 6,
          focusY: 0.5,
          mirrorEnabled: true,
          cameraMotion: "disabled",
          videoZoom: 1,
          topFontScale: DEFAULT_TEXT_SCALE,
          bottomFontScale: DEFAULT_TEXT_SCALE,
          authorName: "Stone Face Turbo",
          authorHandle: "@StoneFaceTurbo",
          avatarAssetFileName: null,
          avatarAssetMimeType: null,
          backgroundAssetFileName: null,
          backgroundAssetMimeType: null,
          textFit: null
        }}
      />
      <Composition
        id={SCIENCE_CARD_V2_SCENE_ID}
        component={ScienceCardV1}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={6 * 30}
        defaultProps={{
          templateId: SCIENCE_CARD_V2_TEMPLATE_ID,
          sourceVideoFileName: "source.mp4",
          topText: "",
          bottomText: "",
          clipStartSec: 0,
          clipDurationSec: 6,
          focusY: 0.5,
          mirrorEnabled: true,
          cameraMotion: "disabled",
          videoZoom: 1,
          topFontScale: DEFAULT_TEXT_SCALE,
          bottomFontScale: DEFAULT_TEXT_SCALE,
          authorName: "Science Card",
          authorHandle: "@ScienceCard",
          avatarAssetFileName: null,
          avatarAssetMimeType: null,
          backgroundAssetFileName: null,
          backgroundAssetMimeType: null,
          textFit: null
        }}
      />
      <Composition
        id={SCIENCE_CARD_V3_SCENE_ID}
        component={ScienceCardV1}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={6 * 30}
        defaultProps={{
          templateId: SCIENCE_CARD_V3_TEMPLATE_ID,
          sourceVideoFileName: "source.mp4",
          topText: "",
          bottomText: "",
          clipStartSec: 0,
          clipDurationSec: 6,
          focusY: 0.5,
          mirrorEnabled: true,
          cameraMotion: "disabled",
          videoZoom: 1,
          topFontScale: DEFAULT_TEXT_SCALE,
          bottomFontScale: DEFAULT_TEXT_SCALE,
          authorName: "Science Snack",
          authorHandle: "@Science_Snack_1",
          avatarAssetFileName: null,
          avatarAssetMimeType: null,
          backgroundAssetFileName: null,
          backgroundAssetMimeType: null,
          textFit: null
        }}
      />
      <Composition
        id={SCIENCE_CARD_V4_SCENE_ID}
        component={ScienceCardV1}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={6 * 30}
        defaultProps={{
          templateId: SCIENCE_CARD_V4_TEMPLATE_ID,
          sourceVideoFileName: "source.mp4",
          topText: "",
          bottomText: "",
          clipStartSec: 0,
          clipDurationSec: 6,
          focusY: 0.5,
          mirrorEnabled: true,
          cameraMotion: "disabled",
          videoZoom: 1,
          topFontScale: DEFAULT_TEXT_SCALE,
          bottomFontScale: DEFAULT_TEXT_SCALE,
          authorName: "Science Snack",
          authorHandle: "@Science_Snack_1",
          avatarAssetFileName: null,
          avatarAssetMimeType: null,
          backgroundAssetFileName: null,
          backgroundAssetMimeType: null,
          textFit: null
        }}
      />
      <Composition
        id={SCIENCE_CARD_V5_SCENE_ID}
        component={ScienceCardV1}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={6 * 30}
        defaultProps={{
          templateId: SCIENCE_CARD_V5_TEMPLATE_ID,
          sourceVideoFileName: "source.mp4",
          topText: "",
          bottomText: "",
          clipStartSec: 0,
          clipDurationSec: 6,
          focusY: 0.5,
          mirrorEnabled: true,
          cameraMotion: "disabled",
          videoZoom: 1,
          topFontScale: DEFAULT_TEXT_SCALE,
          bottomFontScale: DEFAULT_TEXT_SCALE,
          authorName: "Science Snack",
          authorHandle: "@Science_Snack_1",
          avatarAssetFileName: null,
          avatarAssetMimeType: null,
          backgroundAssetFileName: null,
          backgroundAssetMimeType: null,
          textFit: null
        }}
      />
    </>
  );
};

registerRoot(RemotionRoot);

export default RemotionRoot;
