export const TRACE_EXPORT_VERSION = "clip-trace-export-v1";
export const MAX_EXPORTED_COMMENTS = 15;

export function buildChatTraceExportFileName(input: {
  channelUsername: string | null | undefined;
  chatId: string;
  exportedAt: string;
}): string {
  const username = (input.channelUsername?.trim() || "channel").replace(/^@/, "") || "channel";
  const chatIdShort = input.chatId.slice(0, 8) || "chat";
  const stamp = input.exportedAt
    .replace(/[:]/g, "-")
    .replace("T", "_")
    .replace(/\.\d{3}Z$/, "")
    .replace(/Z$/, "");
  return `clip-trace-${username}-${chatIdShort}-${stamp}.json`;
}
