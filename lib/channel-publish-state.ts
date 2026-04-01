import type { ChannelPublishIntegration } from "../app/components/types";

export function isChannelPublishIntegrationReady(
  integration: ChannelPublishIntegration | null | undefined
): integration is ChannelPublishIntegration {
  return Boolean(
    integration &&
      integration.status === "connected" &&
      integration.selectedYoutubeChannelId?.trim()
  );
}
