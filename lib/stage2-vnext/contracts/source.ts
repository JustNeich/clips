export interface SampledFrame {
  frameId: string;
  tsSec: number;
  role: "setup" | "turn" | "payoff" | "extra";
  imageRef: string;
  sceneHash?: string;
}

export interface SourceComment {
  id: string;
  author: string;
  text: string;
  likes: number;
  postedAt: string | null;
}

export interface SourcePacket {
  sourceId: string;
  sourceUrl: string;
  title: string;
  description: string;
  transcript: string | null;
  durationSec: number | null;
  frames: SampledFrame[];
  comments: SourceComment[];
  metadata: {
    provider: string;
    downloadedAt: string;
    totalComments: number;
  };
}
