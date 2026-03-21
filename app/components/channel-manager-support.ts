"use client";

import { Channel, ChannelAsset, ChannelAssetKind } from "./types";
import { Stage2CorpusExample } from "../../lib/stage2-channel-config";

export type TabId = "brand" | "stage2" | "render" | "assets" | "access";
export type AutosaveScope = "brand" | "stage2" | "stage2Defaults" | "render";
export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";
export type ChannelManagerTargetKind = "workspace_defaults" | "channel";

export type AutosaveState = Record<
  AutosaveScope,
  {
    status: AutosaveStatus;
    message: string | null;
  }
>;

export type ChannelManagerTarget = {
  id: string;
  label: string;
  kind: ChannelManagerTargetKind;
  channel: Channel | null;
};

export const CHANNEL_MANAGER_DEFAULT_SETTINGS_ID = "__workspace_default_settings__";

export function listByKind(assets: ChannelAsset[], kind: ChannelAssetKind): ChannelAsset[] {
  return assets.filter((item) => item.kind === kind);
}

export function canDeleteManagedChannel(channels: Channel[], activeChannel: Channel | null): boolean {
  return channels.length > 1 && Boolean(activeChannel?.currentUserCanDelete);
}

export function listChannelManagerTargets(
  channels: Channel[],
  isOwner: boolean
): ChannelManagerTarget[] {
  const channelTargets = channels.map((channel) => ({
    id: channel.id,
    label: `${channel.name} @${channel.username}`,
    kind: "channel" as const,
    channel
  }));

  if (!isOwner) {
    return channelTargets;
  }

  return [
    {
      id: CHANNEL_MANAGER_DEFAULT_SETTINGS_ID,
      label: "Общие настройки",
      kind: "workspace_defaults",
      channel: null
    },
    ...channelTargets
  ];
}

export function stringifyCorpusExamples(examples: Stage2CorpusExample[]): string {
  return JSON.stringify(examples, null, 2);
}

export function areCorpusExamplesEquivalent(
  left: Stage2CorpusExample[],
  right: Stage2CorpusExample[]
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
