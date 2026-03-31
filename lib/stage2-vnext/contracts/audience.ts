export interface AudiencePacket {
  sentimentSummary: string;
  consensusLane: string;
  jokeLane: string;
  dissentLane: string;
  suspicionLane: string;
  shorthandPressure: "low" | "medium" | "high";
  allowedCues: string[];
  bannedCues: string[];
  normalizedSlang: Array<{
    raw: string;
    safeNativeEquivalent: string;
    keepRawAllowed: boolean;
  }>;
  moderationFindings: string[];
}
