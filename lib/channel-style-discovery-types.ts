import type { Stage2HardConstraints } from "./stage2-channel-config";
import type { Stage2StyleProfile } from "./stage2-channel-learning";

export type ChannelStyleDiscoveryRunStatus = "queued" | "running" | "completed" | "failed";

export type ChannelStyleDiscoveryRequest = {
  channelName: string;
  username: string;
  hardConstraints: Stage2HardConstraints;
  referenceUrls: string[];
};

export type ChannelStyleDiscoveryRunSummary = {
  runId: string;
  workspaceId: string;
  creatorUserId: string | null;
  status: ChannelStyleDiscoveryRunStatus;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
};

export type ChannelStyleDiscoveryRunDetail = ChannelStyleDiscoveryRunSummary & {
  request: ChannelStyleDiscoveryRequest;
  result: Stage2StyleProfile | null;
};
