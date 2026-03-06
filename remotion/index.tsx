import React from "react";
import { Composition, registerRoot } from "remotion";
import { ScienceCardV1 } from "./science-card-v1";
import {
  SCIENCE_CARD_TEMPLATE_ID,
  TURBO_FACE_TEMPLATE_ID
} from "../lib/stage3-template";

export type ScienceCardV1Props = {
  templateId?: string;
  topText: string;
  bottomText: string;
  clipStartSec: number;
  clipDurationSec: number;
  focusY: number;
  videoZoom: number;
  topFontScale: number;
  bottomFontScale: number;
  authorName: string;
  authorHandle: string;
  avatarAssetFileName?: string | null;
  avatarAssetMimeType?: string | null;
  backgroundAssetFileName?: string | null;
  backgroundAssetMimeType?: string | null;
};

export const SCENE_ID = SCIENCE_CARD_TEMPLATE_ID;
export const TURBO_SCENE_ID = TURBO_FACE_TEMPLATE_ID;
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
          topText: "",
          bottomText: "",
          clipStartSec: 0,
          clipDurationSec: 6,
          focusY: 0.5,
          videoZoom: 1,
          topFontScale: DEFAULT_TEXT_SCALE,
          bottomFontScale: DEFAULT_TEXT_SCALE,
          authorName: "Science Snack",
          authorHandle: "@Science_Snack_1",
          avatarAssetFileName: null,
          avatarAssetMimeType: null,
          backgroundAssetFileName: null,
          backgroundAssetMimeType: null
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
          topText: "",
          bottomText: "",
          clipStartSec: 0,
          clipDurationSec: 6,
          focusY: 0.5,
          videoZoom: 1,
          topFontScale: DEFAULT_TEXT_SCALE,
          bottomFontScale: DEFAULT_TEXT_SCALE,
          authorName: "Stone Face Turbo",
          authorHandle: "@StoneFaceTurbo",
          avatarAssetFileName: null,
          avatarAssetMimeType: null,
          backgroundAssetFileName: null,
          backgroundAssetMimeType: null
        }}
      />
    </>
  );
};

registerRoot(RemotionRoot);

export default RemotionRoot;
