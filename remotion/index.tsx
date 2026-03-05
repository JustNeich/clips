import React from "react";
import { Composition, registerRoot } from "remotion";
import { ScienceCardV1 } from "./science-card-v1";

export type ScienceCardV1Props = {
  topText: string;
  bottomText: string;
  clipStartSec: number;
  clipDurationSec: number;
  focusY: number;
  authorName: string;
  authorHandle: string;
  avatarAssetFileName?: string | null;
  avatarAssetMimeType?: string | null;
  backgroundAssetFileName?: string | null;
  backgroundAssetMimeType?: string | null;
};

export const SCENE_ID = "science-card-v1";

export const RemotionRoot = () => {
  return (
    <Composition
      id={SCENE_ID}
      component={ScienceCardV1}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={6 * 30}
      defaultProps={{
        topText: "",
        bottomText: "",
        clipStartSec: 0,
        clipDurationSec: 6,
        focusY: 0.5,
        authorName: "Science Snack",
        authorHandle: "@Science_Snack_1",
        avatarAssetFileName: null,
        avatarAssetMimeType: null,
        backgroundAssetFileName: null,
        backgroundAssetMimeType: null
      }}
    />
  );
};

registerRoot(RemotionRoot);

export default RemotionRoot;
