import type { ExampleMode } from "./examples";

export interface StrategyAngle {
  angleId: string;
  label: string;
  rationale: string;
  hookMode: "hook_first" | "reveal_setup" | "contrast_first" | "insider_read";
  bottomEnergy: string;
  claimPolicy: string[];
  rejectPatterns: string[];
}

export interface StrategyPacket {
  primaryAngle: StrategyAngle;
  secondaryAngles: StrategyAngle[];
  rankedAngleIds: string[];
  revealPolicy: "hint_only" | "partial_cashout" | "full_cashout";
  commentUsagePolicy: string[];
  exampleMode: ExampleMode;
  writerDo: string[];
  writerDont: string[];
}
